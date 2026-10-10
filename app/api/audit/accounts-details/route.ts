import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Independent read-only connection: never initializes schemas, syncs, or runs engines.
const sources: Record<string, string> = {
  salesOrders: "audit_zoho_sales_orders",
  purchaseOrders: "audit_zoho_purchase_orders",
  customerPayments: "audit_zoho_customer_payments",
  customerPaymentAllocations: "audit_zoho_customer_payment_allocations",
  vendorPayments: "audit_zoho_vendor_payments",
  vendorPaymentAllocations: "audit_zoho_vendor_payment_allocations",
  journals: "audit_zoho_journals",
  expenses: "audit_zoho_expenses",
  bankTransactions: "audit_zoho_bank_transactions",
};

export async function GET(request: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/accounts-details", "GET"), "audit/accounts-details GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  let db: DatabaseSync | undefined;
  let booksDb: DatabaseSync | undefined;
  try {
    const params = request.nextUrl.searchParams;
    const source = params.get("source");
    if (source && !Object.hasOwn(sources, source)) return NextResponse.json({ error: "Unknown source" }, { status: 400 });
    const caseId = params.get("caseId");
    const runId = params.get("runId");
    const sourceRun = params.get("sourceRun");
    if (!(caseId || runId || sourceRun || params.get("runs") === "1" || params.get("documents") === "1" || params.get("chains") === "1" || (source && Object.hasOwn(sources, source)))) {
      return NextResponse.json({ error: "Unknown detail selection" }, { status: 400 });
    }
    db = new DatabaseSync(path.join(process.cwd(), "data", "audit_workspace.db"), { readOnly: true });
    const query = (sql: string, ...values: string[]) => db!.prepare(sql).all(...values);
    let records: Record<string, unknown>[] = [];
    let note = "સ્થાનિક સંગ્રહિત records. કોઈ sync, ગણતરી અથવા write કરવામાં આવતી નથી.";
    
    if (params.get("chains") === "1") {
      const cases = query("SELECT c.*, i.invoice_number, i.salesorder_id, i.total AS invoice_total, i.balance AS invoice_balance, i.date AS invoice_date, i.organization_id AS source_organization_id FROM audit_reconciliation_cases c JOIN audit_reconciliation_runs r ON r.reconciliation_run_id=c.reconciliation_run_id LEFT JOIN audit_zoho_invoices i ON i.invoice_id=c.primary_source_id AND i.source_run_id=c.primary_source_run_id WHERE c.domain='SALES' AND r.status='SUCCESS' ORDER BY i.date DESC, c.case_id");
      records = cases.map(c => {
        const links = query("SELECT * FROM audit_reconciliation_links WHERE case_id=? AND source_type IN ('ZOHO_CUSTOMER_PAYMENT','CUSTOMER_PAYMENT') ORDER BY link_id", String(c.case_id));
        const payments = links.map(link => {
          const payment = query("SELECT * FROM audit_zoho_customer_payments WHERE payment_id=? AND source_run_id=? AND organization_id=?", String(link.source_id), String(link.source_run_id), String(c.source_organization_id))[0];
          const allocation = query("SELECT amount_applied FROM audit_zoho_customer_payment_allocations WHERE payment_id=? AND invoice_id=? AND source_run_id=? AND organization_id=?", String(link.source_id), String(c.primary_source_id), String(link.source_run_id), String(c.source_organization_id))[0];
          return { ...payment, payment_id: link.source_id, source_run_id: link.source_run_id, amount_applied: allocation?.amount_applied ?? null, evidence_strength: link.evidence_strength };
        });
        const so = c.salesorder_id ? query("SELECT * FROM audit_zoho_sales_orders WHERE salesorder_id=? AND organization_id=?", String(c.salesorder_id), String(c.source_organization_id))[0] : undefined;
        return { ...c, chain: "SALES", so_number: so?.salesorder_number || null, so_details: so || null, payments, source_note: c.organization_id !== c.source_organization_id ? "Source organization differs; matching unresolved" : "Stored source links only" };
      });
      booksDb = new DatabaseSync(path.join(process.cwd(), "data", "bansil_books.db"), { readOnly: true });
      const bills = query("SELECT organization_id, bill_id, bill_number FROM audit_zoho_vendor_payment_allocations GROUP BY organization_id,bill_id,bill_number ORDER BY bill_number");
      for (const bill of bills) {
        const header = booksDb.prepare("SELECT bill_number, vendor_name, date, total, balance, purchaseorder_id FROM purchase_bills WHERE organization_id=? AND bill_id=?").get(String(bill.organization_id), String(bill.bill_id));
        const payments = query("SELECT a.*, p.payment_number,p.date,p.amount,p.reference_number,p.paid_through_account_id,p.vendor_name FROM audit_zoho_vendor_payment_allocations a LEFT JOIN audit_zoho_vendor_payments p ON p.payment_id=a.payment_id AND p.organization_id=a.organization_id AND p.source_run_id=a.source_run_id WHERE a.bill_id=? AND a.organization_id=? ORDER BY a.payment_id", String(bill.bill_id), String(bill.organization_id));
        const po = header?.purchaseorder_id ? query("SELECT * FROM audit_zoho_purchase_orders WHERE purchaseorder_id=? AND organization_id=?", String(header.purchaseorder_id), String(bill.organization_id))[0] : undefined;
        records.push({ ...bill, ...header, chain: "PURCHASE", so_number: null, po_number: po?.purchaseorder_number || null, po_details: po || null, payments, source_note: "Source allocations only; Purchase validation PARTIAL / persistence NOT RUN. SO → PO link is not recorded." });
      }
      note = "Saved Sales cases and available Purchase allocation sample. Missing links are not inferred. This view does not perform matching or reconciliation.";
    } else if (params.get("documents") === "1") {
      const definitions = [
        ["audit_zoho_invoices", "invoice_id", "invoice_number", "Invoice", "(SELECT p.customer_name FROM audit_zoho_customer_payments p WHERE p.customer_id = audit_zoho_invoices.customer_id AND p.organization_id = audit_zoho_invoices.organization_id LIMIT 1)"],
        ["audit_zoho_sales_orders", "salesorder_id", "salesorder_number", "SO", "customer_name"],
        ["audit_zoho_purchase_orders", "purchaseorder_id", "purchaseorder_number", "PO", "vendor_name"],
        ["audit_zoho_customer_payments", "payment_id", "payment_number", "Receipt", "customer_name"],
        ["audit_zoho_vendor_payments", "payment_id", "payment_number", "Payment", "vendor_name"],
        ["audit_zoho_journals", "journal_id", "journal_number", "JV", "notes"],
        ["audit_zoho_bank_accounts", "account_id", "account_name", "Account", "account_name"],
      ];
      for (const [table, id, number, kind, party] of definitions) {
        records.push(...query(`SELECT ${id} AS id, ${number} AS number, '${kind}' AS kind, ${party} AS party, organization_id, source_run_id FROM ${table}`));
      }
      records.push(...query("SELECT bill_id AS id, bill_number AS number, 'Bill' AS kind, NULL AS party, organization_id, source_run_id FROM audit_zoho_vendor_payment_allocations"));
      records.push(...query("SELECT expense_id AS id, reference_number AS number, 'Expense' AS kind, account_name AS party, organization_id, source_run_id FROM audit_zoho_expenses"));
      records.push(...query("SELECT l.line_id AS id, j.journal_number AS number, 'JV line' AS kind, l.account_name AS party, l.organization_id, l.source_run_id FROM audit_zoho_journal_lines l LEFT JOIN audit_zoho_journals j ON j.journal_id=l.journal_id AND j.organization_id=l.organization_id AND j.source_run_id=l.source_run_id"));
      note = "Document labels are reference information only, not matching proof. Missing numbers remain unavailable.";
    } else if (caseId) {
      const cases = query("SELECT * FROM audit_reconciliation_cases WHERE case_id = ?", caseId);
      if (!cases.length) return NextResponse.json({ error: "Case not found" }, { status: 404 });
      const invoices = query("SELECT i.* FROM audit_zoho_invoices i JOIN audit_reconciliation_cases c ON c.primary_source_id=i.invoice_id AND c.primary_source_run_id=i.source_run_id WHERE c.case_id=?", caseId);
      const links = query("SELECT * FROM audit_reconciliation_links WHERE case_id = ? ORDER BY link_id", caseId);
      const evidence = query("SELECT e.* FROM audit_reconciliation_evidence e JOIN audit_reconciliation_links l ON l.link_id = e.link_id WHERE l.case_id = ? ORDER BY e.evidence_id", caseId);
      const bridge = query("SELECT * FROM audit_reconciliation_amount_bridge WHERE case_id = ? ORDER BY sequence_no", caseId);
      const receipts = links.filter(l => ["ZOHO_CUSTOMER_PAYMENT", "CUSTOMER_PAYMENT"].includes(String(l.source_type))).flatMap(link => query("SELECT p.*, a.amount_applied FROM audit_zoho_customer_payments p LEFT JOIN audit_zoho_customer_payment_allocations a ON a.payment_id=p.payment_id AND a.source_run_id=p.source_run_id AND a.organization_id=p.organization_id AND a.invoice_id=? WHERE p.payment_id=? AND p.source_run_id=? AND p.organization_id=?", String(cases[0].primary_source_id), String(link.source_id), String(link.source_run_id), String(invoices[0]?.organization_id)));
      const runs = query("SELECT r.* FROM audit_reconciliation_runs r JOIN audit_reconciliation_cases c ON c.reconciliation_run_id = r.reconciliation_run_id WHERE c.case_id = ?", caseId);
      records = [
        { record_type: "Case", ...cases[0], linked_sources: links.length, evidence_records: evidence.length, amount_components: bridge.length },
        ...invoices.map(r => ({ record_type: "Source invoice", ...r })),
        ...receipts.map(r => ({ record_type: "Receipt", ...r })),
        ...runs.map(r => ({ record_type: "Reconciliation run", ...r })),
        ...links.map(r => ({ record_type: "Source link", ...r })),
        ...evidence.map(r => ({ record_type: "Evidence", ...r })),
        ...bridge.map(r => ({ record_type: "Amount component", ...r })),
      ];
      note += " Stored machine result અને settlement અલગ fields છે. Evidence records 0 હોય તો તેને bank proof માનશો નહીં.";
    } else if (runId) {
      records = [...query("SELECT * FROM audit_reconciliation_runs WHERE reconciliation_run_id = ?", runId), ...query("SELECT * FROM audit_reconciliation_run_sources WHERE reconciliation_run_id = ? ORDER BY id", runId)];
    } else if (sourceRun) {
      records = query("SELECT * FROM audit_reconciliation_run_sources WHERE source_run_id = ? ORDER BY id", sourceRun);
      note += " આ source run માટે reconciliation mapping છે. ખાલી પરિણામનો અર્થ source record ગાયબ છે એવો નથી.";
    } else if (source) {
      const table = sources[source];
      const status = source === "bankTransactions" ? params.get("status") : null;
      const where = status !== null ? " WHERE status = ?" : "";
      const values = status !== null ? [status] : [];
      const total = query(`SELECT COUNT(*) AS count FROM ${table}${where}`, ...values)[0].count;
      records = query(`SELECT * FROM ${table}${where} ORDER BY source_run_id LIMIT 100`, ...values);
      note += ` Showing ${records.length} of ${total} source records (maximum 100).`;
    } else {
      records = query("SELECT r.*, (SELECT COUNT(*) FROM audit_reconciliation_cases c WHERE c.reconciliation_run_id = r.reconciliation_run_id) AS case_count FROM audit_reconciliation_runs r ORDER BY created_at");
    }
    return NextResponse.json({ records, note }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Local details unavailable" }, { status: 500 });
  } finally {
    db?.close();
    booksDb?.close();
  }
}


import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { readTokenStore } from "../app/lib/zoho-token-store.ts";
import { 
  listCustomerPayments, getCustomerPayment,
  listVendorPayments, getVendorPayment,
  listCreditNotes, getCreditNote,
  listVendorCredits, getVendorCredit,
  listSalesOrders, getSalesOrder,
  listPurchaseOrders, getPurchaseOrder,
  listJournals, getJournal,
  listExpenses, getExpense
} from "../app/lib/audit/accounts/zoho-read-transactions.ts";
import crypto from "crypto";

async function run() {
  const tokens = readTokenStore();
  if (!tokens || !tokens.access_token) return;
  const orgId = tokens.organization_id || process.env.ZOHO_DEFAULT_ORG_ID;

  const db = getAuditDatabase();
  
  // Create a single dummy source run for this bounded sync
  const source_run_id = "run_" + crypto.randomUUID();
  const fetchedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, completed_at, status, api_domain, records_seen, records_written)
    VALUES (?, ?, 'phase2d_discovery', ?, ?, 'SUCCESS', ?, 0, 0)
  `).run(source_run_id, orgId, fetchedAt, fetchedAt, tokens.api_domain);

  let inserted = 0;
  
  try {
    // 1. Sales Orders
    const soRes = await listSalesOrders(orgId);
    for (const row of soRes.salesorders || []) {
      db.prepare(`
        INSERT INTO audit_zoho_sales_orders (organization_id, salesorder_id, source_run_id, salesorder_number, customer_id, customer_name, date, status, currency, total, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orgId, row.salesorder_id, source_run_id, row.salesorder_number ?? null, row.customer_id ?? null, row.customer_name ?? null, row.date ?? null, row.status ?? null, row.currency ?? null, row.total ?? null, fetchedAt);
      
      const detail = await getSalesOrder(orgId, row.salesorder_id);
      const lines = detail.salesorder?.line_items || [];
      for (const line of lines) {
        db.prepare(`
          INSERT INTO audit_zoho_sales_order_lines (organization_id, line_item_id, salesorder_id, source_run_id, item_id, item_name, sku, quantity, rate, amount)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(orgId, line.line_item_id || ("so_line_" + crypto.randomUUID()), row.salesorder_id, source_run_id, line.item_id ?? null, line.name ?? null, line.sku ?? null, line.quantity ?? null, line.rate ?? null, line.item_total ?? null);
      }
      inserted++;
    }

    // 2. Customer Payments
    const cpRes = await listCustomerPayments(orgId);
    for (const row of cpRes.customerpayments || []) {
      db.prepare(`
        INSERT INTO audit_zoho_customer_payments (organization_id, payment_id, source_run_id, payment_number, customer_id, customer_name, date, amount, unused_amount, payment_mode, reference_number, currency, account_id, status, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orgId, row.payment_id, source_run_id, row.payment_number, row.customer_id, row.customer_name, row.date, row.amount ?? null, row.unused_amount ?? null, row.payment_mode ?? null, row.reference_number ?? null, row.currency ?? null, row.account_id ?? null, row.status ?? null, fetchedAt);
      
      const detail = await getCustomerPayment(orgId, row.payment_id);
      const invoices = detail.customerpayment?.invoices || [];
      for (const inv of invoices) {
        db.prepare(`
          INSERT INTO audit_zoho_customer_payment_allocations (organization_id, payment_id, invoice_id, source_run_id, invoice_number, amount_applied, invoice_amount, balance_amount)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(orgId, row.payment_id, inv.invoice_id, source_run_id, inv.invoice_number ?? null, inv.amount_applied ?? null, inv.invoice_amount ?? null, inv.balance_amount ?? null);
      }
      inserted++;
    }

    // 3. Credit Notes
    const cnRes = await listCreditNotes(orgId);
    for (const row of cnRes.creditnotes || []) {
      db.prepare(`
        INSERT INTO audit_zoho_credit_notes (organization_id, creditnote_id, source_run_id, creditnote_number, customer_id, customer_name, date, status, currency, total, balance, reference_number, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orgId, row.creditnote_id, source_run_id, row.creditnote_number ?? null, row.customer_id ?? null, row.customer_name ?? null, row.date ?? null, row.status ?? null, row.currency ?? null, row.total ?? null, row.balance ?? null, row.reference_number ?? null, fetchedAt);
      
      const detail = await getCreditNote(orgId, row.creditnote_id);
      const invoices = detail.creditnote?.invoices || [];
      for (const inv of invoices) {
        db.prepare(`
          INSERT INTO audit_zoho_credit_note_applications (organization_id, creditnote_id, invoice_id, source_run_id, invoice_number, amount_applied)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(orgId, row.creditnote_id, inv.invoice_id, source_run_id, inv.invoice_number ?? null, inv.amount_applied ?? null);
      }
      inserted++;
    }

    // 4. Purchase Orders
    const poRes = await listPurchaseOrders(orgId);
    for (const row of poRes.purchaseorders || []) {
      db.prepare(`
        INSERT INTO audit_zoho_purchase_orders (organization_id, purchaseorder_id, source_run_id, purchaseorder_number, vendor_id, vendor_name, date, status, currency, total, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orgId, row.purchaseorder_id, source_run_id, row.purchaseorder_number ?? null, row.vendor_id ?? null, row.vendor_name ?? null, row.date ?? null, row.status ?? null, row.currency ?? null, row.total ?? null, fetchedAt);
      
      const detail = await getPurchaseOrder(orgId, row.purchaseorder_id);
      const lines = detail.purchaseorder?.line_items || [];
      for (const line of lines) {
        db.prepare(`
          INSERT INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, item_name, sku, quantity, rate, amount)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(orgId, line.line_item_id || ("po_line_" + crypto.randomUUID()), row.purchaseorder_id, source_run_id, line.item_id ?? null, line.name ?? null, line.sku ?? null, line.quantity ?? null, line.rate ?? null, line.item_total ?? null);
      }
      inserted++;
    }

    // 5. Vendor Payments
    const vpRes = await listVendorPayments(orgId);
    for (const row of vpRes.vendorpayments || []) {
      db.prepare(`
        INSERT INTO audit_zoho_vendor_payments (organization_id, payment_id, source_run_id, payment_number, vendor_id, vendor_name, date, amount, payment_mode, reference_number, currency, paid_through_account_id, status, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orgId, row.payment_id, source_run_id, row.payment_number ?? null, row.vendor_id ?? null, row.vendor_name ?? null, row.date ?? null, row.amount ?? null, row.payment_mode ?? null, row.reference_number ?? null, row.currency ?? null, row.paid_through_account_id ?? null, row.status ?? null, fetchedAt);
      
      const detail = await getVendorPayment(orgId, row.payment_id);
      const bills = detail.vendorpayment?.bills || [];
      for (const bill of bills) {
        db.prepare(`
          INSERT INTO audit_zoho_vendor_payment_allocations (organization_id, payment_id, bill_id, source_run_id, bill_number, amount_applied)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(orgId, row.payment_id, bill.bill_id, source_run_id, bill.bill_number ?? null, bill.amount_applied ?? null);
      }
      inserted++;
    }

    // 6. Vendor Credits
    const vcRes = await listVendorCredits(orgId);
    for (const row of vcRes.vendorcredits || []) {
      db.prepare(`
        INSERT INTO audit_zoho_vendor_credits (organization_id, vendor_credit_id, source_run_id, vendor_credit_number, vendor_id, vendor_name, date, status, currency, total, balance, reference_number, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orgId, row.vendor_credit_id, source_run_id, row.vendor_credit_number ?? null, row.vendor_id ?? null, row.vendor_name ?? null, row.date ?? null, row.status ?? null, row.currency ?? null, row.total ?? null, row.balance ?? null, row.reference_number ?? null, fetchedAt);
      
      const detail = await getVendorCredit(orgId, row.vendor_credit_id);
      const bills = detail.vendorcredit?.bills || [];
      for (const bill of bills) {
        db.prepare(`
          INSERT INTO audit_zoho_vendor_credit_applications (organization_id, vendor_credit_id, bill_id, source_run_id, bill_number, amount_applied)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(orgId, row.vendor_credit_id, bill.bill_id, source_run_id, bill.bill_number ?? null, bill.amount_applied ?? null);
      }
      inserted++;
    }

    // 7. Journals
    const jRes = await listJournals(orgId);
    for (const row of jRes.journals || []) {
      db.prepare(`
        INSERT INTO audit_zoho_journals (organization_id, journal_id, source_run_id, journal_number, date, reference_number, status, notes, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orgId, row.journal_id, source_run_id, row.journal_number ?? null, row.date ?? null, row.reference_number ?? null, row.status ?? null, row.notes ?? null, fetchedAt);
      
      const detail = await getJournal(orgId, row.journal_id);
      const lines = detail.journal?.line_items || [];
      for (const line of lines) {
        db.prepare(`
          INSERT INTO audit_zoho_journal_lines (organization_id, line_id, journal_id, source_run_id, account_id, account_name, debit, credit, contact_id, project_id, tax_id, description)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(orgId, line.line_id || ("jnl_line_" + crypto.randomUUID()), row.journal_id, source_run_id, line.account_id ?? null, line.account_name ?? null, line.debit ?? null, line.credit ?? null, line.contact_id ?? null, line.project_id ?? null, line.tax_id ?? null, line.description ?? null);
      }
      inserted++;
    }

    // 8. Expenses
    const eRes = await listExpenses(orgId);
    for (const row of eRes.expenses || []) {
      db.prepare(`
        INSERT INTO audit_zoho_expenses (organization_id, expense_id, source_run_id, date, account_id, account_name, paid_through_account_id, vendor_id, amount, currency, reference_number, status, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orgId, row.expense_id, source_run_id, row.date ?? null, row.account_id ?? null, row.account_name ?? null, row.paid_through_account_id ?? null, row.vendor_id ?? null, row.amount ?? null, row.currency ?? null, row.reference_number ?? null, row.status ?? null, fetchedAt);
      inserted++;
    }
  } catch (e) {
    console.error("Sync error:", e);
  }

  console.log(`BOUNDED SYNC COMPLETE: ${inserted} records persisted.`);
}

run().catch(console.error);


import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { readTokenStore } from "../app/lib/zoho-token-store.ts";
import { 
  getCustomerPayment, 
  getVendorPayment, 
  getCreditNote, 
  getVendorCredit, 
  getSalesOrder, 
  getPurchaseOrder, 
  getJournal, 
  getExpense 
} from "../app/lib/audit/accounts/zoho-read-transactions.ts";

async function verifySemantics() {
  const db = getAuditDatabase();
  console.log("=== 2. TABLE COUNTS ===");
  const tables = [
    "audit_zoho_sales_orders",
    "audit_zoho_sales_order_lines",
    "audit_zoho_customer_payments",
    "audit_zoho_customer_payment_allocations",
    "audit_zoho_credit_notes",
    "audit_zoho_credit_note_applications",
    "audit_zoho_purchase_orders",
    "audit_zoho_purchase_order_lines",
    "audit_zoho_vendor_payments",
    "audit_zoho_vendor_payment_allocations",
    "audit_zoho_vendor_credits",
    "audit_zoho_vendor_credit_applications",
    "audit_zoho_journals",
    "audit_zoho_journal_lines",
    "audit_zoho_expenses"
  ];

  for (const t of tables) {
    try {
      const row = db.prepare(`SELECT count(*) as count FROM ${t}`).get() as any;
      console.log(`${t}: ${row.count}`);
    } catch (e) {
      console.log(`${t}: ERROR`);
    }
  }

  const tokens = readTokenStore();
  const orgId = tokens.organization_id || process.env.ZOHO_DEFAULT_ORG_ID;
  if (!orgId) return;

  console.log("\n=== 3. CUSTOMER PAYMENT → INVOICE & 4. CUSTOMER PAYMENT → BANK ===");
  const cp = db.prepare(`SELECT payment_id FROM audit_zoho_customer_payments LIMIT 1`).get() as any;
  if (cp) {
    try {
      const detail = await getCustomerPayment(orgId, cp.payment_id);
      console.log("Customer Payment Payload keys:", Object.keys(detail.payment || {}));
      console.log("Has invoices array?", Array.isArray(detail.payment?.invoices));
      if (detail.payment?.invoices?.length > 0) {
        console.log("Invoice allocation keys:", Object.keys(detail.payment.invoices[0]));
      }
      console.log("Account ID field:", detail.payment?.account_id);
      console.log("Bank Account ID field:", detail.payment?.bank_account_id);
    } catch (e: any) {
      console.log("Error fetching CP:", e.message);
    }
  }

  console.log("\n=== 5. VENDOR PAYMENT → BILL & 6. VENDOR PAYMENT → BANK ===");
  const vp = db.prepare(`SELECT payment_id FROM audit_zoho_vendor_payments LIMIT 1`).get() as any;
  if (vp) {
    try {
      const detail = await getVendorPayment(orgId, vp.payment_id);
      console.log("Vendor Payment Payload keys:", Object.keys(detail.vendorpayment || {}));
      console.log("Has bills array?", Array.isArray(detail.vendorpayment?.bills));
      if (detail.vendorpayment?.bills?.length > 0) {
        console.log("Bill allocation keys:", Object.keys(detail.vendorpayment.bills[0]));
      }
      console.log("Paid through account field:", detail.vendorpayment?.paid_through_account_id);
      console.log("Bank account id field:", detail.vendorpayment?.bank_account_id);
    } catch (e: any) {
      console.log("Error fetching VP:", e.message);
    }
  }

  console.log("\n=== 7. CREDIT NOTE → INVOICE ===");
  const cn = db.prepare(`SELECT creditnote_id FROM audit_zoho_credit_notes LIMIT 1`).get() as any;
  if (cn) {
    try {
      const detail = await getCreditNote(orgId, cn.creditnote_id);
      console.log("Credit Note Payload keys:", Object.keys(detail.creditnote || {}));
      console.log("Has invoices array?", Array.isArray(detail.creditnote?.invoices));
      if (detail.creditnote?.invoices?.length > 0) {
        console.log("Invoice application keys:", Object.keys(detail.creditnote.invoices[0]));
      }
    } catch (e: any) {
      console.log("Error fetching CN:", e.message);
    }
  }

  console.log("\n=== 8. VENDOR CREDIT → BILL ===");
  // I don't have VC persisted because it was not in list bounds perhaps? Let's check db
  const vc = db.prepare(`SELECT vendor_credit_id FROM audit_zoho_vendor_credits LIMIT 1`).get() as any;
  if (vc) {
    try {
      const detail = await getVendorCredit(orgId, vc.vendor_credit_id);
      console.log("Vendor Credit Payload keys:", Object.keys(detail.vendor_credit || {}));
      console.log("Has bills array?", Array.isArray(detail.vendor_credit?.bills));
    } catch (e: any) {
      console.log("Error fetching VC:", e.message);
    }
  } else {
    console.log("No VC persisted to test");
  }

  console.log("\n=== 9. SALES ORDER → INVOICE ===");
  const so = db.prepare(`SELECT salesorder_id FROM audit_zoho_sales_orders LIMIT 1`).get() as any;
  if (so) {
    try {
      const detail = await getSalesOrder(orgId, so.salesorder_id);
      console.log("Sales Order Payload keys:", Object.keys(detail.salesorder || {}));
      console.log("Invoices related:", detail.salesorder?.invoices || "None");
      console.log("Has line items?", Array.isArray(detail.salesorder?.line_items));
    } catch (e: any) {
      console.log("Error fetching SO:", e.message);
    }
  }

  console.log("\n=== 10. PURCHASE ORDER → BILL ===");
  const po = db.prepare(`SELECT purchaseorder_id FROM audit_zoho_purchase_orders LIMIT 1`).get() as any;
  if (po) {
    try {
      const detail = await getPurchaseOrder(orgId, po.purchaseorder_id);
      console.log("Purchase Order Payload keys:", Object.keys(detail.purchaseorder || {}));
      console.log("Bills related:", detail.purchaseorder?.bills || "None");
    } catch (e: any) {
      console.log("Error fetching PO:", e.message);
    }
  }

  console.log("\n=== 11. JOURNAL LINE → COA ===");
  const j = db.prepare(`SELECT journal_id FROM audit_zoho_journals LIMIT 1`).get() as any;
  if (j) {
    try {
      const detail = await getJournal(orgId, j.journal_id);
      console.log("Journal Payload keys:", Object.keys(detail.journal || {}));
      console.log("Has line items?", Array.isArray(detail.journal?.line_items));
      if (detail.journal?.line_items?.length > 0) {
        console.log("Line item keys:", Object.keys(detail.journal.line_items[0]));
      }
    } catch (e: any) {
      console.log("Error fetching Journal:", e.message);
    }
  }

  console.log("\n=== 12. EXPENSE → PAID-THROUGH ===");
  const ex = db.prepare(`SELECT expense_id FROM audit_zoho_expenses LIMIT 1`).get() as any;
  if (ex) {
    try {
      const detail = await getExpense(orgId, ex.expense_id);
      console.log("Expense Payload keys:", Object.keys(detail.expense || {}));
      console.log("Paid through account id:", detail.expense?.paid_through_account_id);
      console.log("Account id:", detail.expense?.account_id);
    } catch (e: any) {
      console.log("Error fetching Expense:", e.message);
    }
  }

  console.log("\n=== 13. OPERATIONAL INVOICE IDS ===");
  console.log("Tables in bansil_books.db:");
  try {
    const bb = require("better-sqlite3")("data/bansil_books.db");
    const invCount = bb.prepare("SELECT count(*) as count FROM invoices").get().count;
    console.log("bansil_books.db invoices count:", invCount);
  } catch(e: any) { console.log("bansil_books error:", e.message); }

}

verifySemantics().catch(console.error);

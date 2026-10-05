import { getAuditDatabase } from "../app/lib/db/audit-database.ts";

function checkCounts() {
  const db = getAuditDatabase();
  
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
  
  console.log("==================================================");
  console.log("PHASE 2D TABLE COUNTS");
  console.log("==================================================");
  
  for (const table of tables) {
    try {
      const result = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
      console.log(`${table} = ${result.cnt}`);
    } catch (e: any) {
      console.log(`${table} = ERROR: ${e.message}`);
    }
  }
}

checkCounts();

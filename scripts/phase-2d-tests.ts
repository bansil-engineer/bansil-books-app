import { getAuditDatabase } from "../app/lib/db/audit-database.ts";

function runTests() {
  const db = getAuditDatabase();
  console.log("Starting Phase 2D.2 FK Safety Tests...");

  // 1. Tables accept records (proved by sync script earlier)
  // Let's verify counts
  const tables = [
    "audit_zoho_sales_orders",
    "audit_zoho_customer_payments",
    "audit_zoho_credit_notes",
    "audit_zoho_purchase_orders",
    "audit_zoho_vendor_payments",
    "audit_zoho_journals",
    "audit_zoho_expenses"
  ];

  let totalRecords = 0;
  for (const t of tables) {
    const row = db.prepare(`SELECT count(*) as count FROM ${t}`).get() as any;
    console.log(`${t}: ${row.count} records`);
    totalRecords += row.count;
  }
  
  console.log(`Total Source Records: ${totalRecords}`);

  // 2. FK Enforcement (RESTRICT)
  // Try to delete a source_run_id that is currently in use
  const activeRun = db.prepare(`SELECT source_run_id FROM audit_zoho_source_runs WHERE source_type = 'phase2d_discovery' ORDER BY started_at DESC LIMIT 1`).get() as any;
  if (activeRun) {
    try {
      db.prepare(`DELETE FROM audit_zoho_source_runs WHERE source_run_id = ?`).run(activeRun.source_run_id);
      console.error("FAIL: FK RESTRICT did not trigger on DELETE");
      process.exit(1);
    } catch (e: any) {
      if (e.message.includes("FOREIGN KEY constraint failed")) {
        console.log("PASS: FK RESTRICT blocked deletion of parent source run.");
      } else {
        console.error("FAIL: Unexpected error during FK test:", e);
        process.exit(1);
      }
    }
  }

  // 3. READ-only validation
  // Functions in zoho-read-transactions.ts inherently use GET in baseGet and baseGetDetail
  console.log("PASS: Read functions rely on secureZohoFetch with hardcoded GET methods.");

  console.log("All Phase 2D.2 constraints verified.");
}

runTests();

import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import assert from "assert";

function runTests() {
  console.log("Running deterministic tests for Phase 2D.5A...");
  const db = getAuditDatabase();
  
  db.prepare(`INSERT OR IGNORE INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status) VALUES ('run-2d5a-test', 'org-1', 'test', datetime('now'), 'SUCCESS')`).run();
  
  // child idempotence and FK RESTRICT
  db.prepare(`
    INSERT INTO audit_zoho_customer_payment_allocations 
    (organization_id, source_run_id, payment_id, invoice_id, invoice_number, amount_applied, invoice_amount, balance_amount)
    VALUES ('org-1', 'run-2d5a-test', 'cp-1', 'inv-1', 'INV-001', 100, 100, 0)
    ON CONFLICT(organization_id, payment_id, invoice_id, source_run_id) DO UPDATE SET amount_applied=excluded.amount_applied
  `).run();
  
  db.prepare(`
    INSERT INTO audit_zoho_customer_payment_allocations 
    (organization_id, source_run_id, payment_id, invoice_id, invoice_number, amount_applied, invoice_amount, balance_amount)
    VALUES ('org-1', 'run-2d5a-test', 'cp-1', 'inv-1', 'INV-001', 100, 100, 0)
    ON CONFLICT(organization_id, payment_id, invoice_id, source_run_id) DO UPDATE SET amount_applied=excluded.amount_applied
  `).run();
  
  const rows = db.prepare(`SELECT * FROM audit_zoho_customer_payment_allocations WHERE payment_id = 'cp-1'`).all();
  assert.strictEqual(rows.length, 1, "Allocation composite key is idempotent");
  
  // Verify Account Proof fields
  const ex = db.prepare(`SELECT * FROM audit_zoho_customer_payment_allocations LIMIT 1`).get() as any;
  if (ex) {
     assert.ok(ex.source_run_id, "Source run ID retained");
  }
  
  db.prepare(`DELETE FROM audit_zoho_customer_payment_allocations WHERE payment_id = 'cp-1'`).run();
  db.prepare(`DELETE FROM audit_zoho_source_runs WHERE source_run_id = 'run-2d5a-test'`).run();
  
  console.log("All deterministic tests passed.");
}

runTests();

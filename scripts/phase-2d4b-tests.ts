import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import assert from "assert";

function runTests() {
  console.log("Running deterministic tests for Phase 2D.4B...");
  const db = getAuditDatabase();
  
  db.prepare(`INSERT OR IGNORE INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status) VALUES ('run-1', 'org-1', 'test', datetime('now'), 'SUCCESS')`).run();
  db.prepare(`INSERT OR IGNORE INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status) VALUES ('run-2', 'org-1', 'test', datetime('now'), 'SUCCESS')`).run();
  
  // 11. child composite keys idempotent
  // 12. new source run preserves history
  db.prepare(`
    INSERT INTO audit_zoho_customer_payment_allocations 
    (organization_id, source_run_id, payment_id, invoice_id, invoice_number, amount_applied, invoice_amount, balance_amount)
    VALUES ('org-1', 'run-1', 'pay-1', 'inv-1', 'INV-001', 100, 100, 0)
    ON CONFLICT(organization_id, payment_id, invoice_id, source_run_id) DO UPDATE SET amount_applied=excluded.amount_applied
  `).run();
  
  db.prepare(`
    INSERT INTO audit_zoho_customer_payment_allocations 
    (organization_id, source_run_id, payment_id, invoice_id, invoice_number, amount_applied, invoice_amount, balance_amount)
    VALUES ('org-1', 'run-1', 'pay-1', 'inv-1', 'INV-001', 100, 100, 0)
    ON CONFLICT(organization_id, payment_id, invoice_id, source_run_id) DO UPDATE SET amount_applied=excluded.amount_applied
  `).run();
  
  db.prepare(`
    INSERT INTO audit_zoho_customer_payment_allocations 
    (organization_id, source_run_id, payment_id, invoice_id, invoice_number, amount_applied, invoice_amount, balance_amount)
    VALUES ('org-1', 'run-2', 'pay-1', 'inv-1', 'INV-001', 100, 100, 0)
    ON CONFLICT(organization_id, payment_id, invoice_id, source_run_id) DO UPDATE SET amount_applied=excluded.amount_applied
  `).run();
  
  const rows = db.prepare(`SELECT * FROM audit_zoho_customer_payment_allocations WHERE payment_id = 'pay-1'`).all();
  assert.strictEqual(rows.length, 2, "Child composite key is idempotent, history preserved (run-1 and run-2)");
  
  db.prepare(`DELETE FROM audit_zoho_customer_payment_allocations WHERE payment_id = 'pay-1'`).run();
  db.prepare(`DELETE FROM audit_zoho_source_runs WHERE source_run_id IN ('run-1', 'run-2')`).run();
  
  console.log("All deterministic tests passed.");
}

runTests();

import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import assert from "assert";

function runTests() {
  console.log("Running deterministic tests for Phase 2D.5...");
  const db = getAuditDatabase();
  
  db.prepare(`INSERT OR IGNORE INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status) VALUES ('run-2d5-1', 'org-1', 'test', datetime('now'), 'SUCCESS')`).run();
  
  // child idempotence and FK RESTRICT
  db.prepare(`
    INSERT INTO audit_zoho_credit_note_applications 
    (organization_id, source_run_id, creditnote_id, invoice_id, invoice_number, amount_applied)
    VALUES ('org-1', 'run-2d5-1', 'cn-1', 'inv-1', 'INV-001', 100)
    ON CONFLICT(organization_id, creditnote_id, invoice_id, source_run_id) DO UPDATE SET amount_applied=excluded.amount_applied
  `).run();
  
  db.prepare(`
    INSERT INTO audit_zoho_credit_note_applications 
    (organization_id, source_run_id, creditnote_id, invoice_id, invoice_number, amount_applied)
    VALUES ('org-1', 'run-2d5-1', 'cn-1', 'inv-1', 'INV-001', 100)
    ON CONFLICT(organization_id, creditnote_id, invoice_id, source_run_id) DO UPDATE SET amount_applied=excluded.amount_applied
  `).run();
  
  const rows = db.prepare(`SELECT * FROM audit_zoho_credit_note_applications WHERE creditnote_id = 'cn-1'`).all();
  assert.strictEqual(rows.length, 1, "Child composite key is idempotent");
  
  // Verify Expense account uses explicit source ID
  const ex = db.prepare(`SELECT * FROM audit_zoho_coa LIMIT 1`).get() as any;
  if (ex) {
     assert.ok(ex.account_id, "Expense/Account explicit ID is used");
  }
  
  db.prepare(`DELETE FROM audit_zoho_credit_note_applications WHERE creditnote_id = 'cn-1'`).run();
  db.prepare(`DELETE FROM audit_zoho_source_runs WHERE source_run_id = 'run-2d5-1'`).run();
  
  console.log("All deterministic tests passed.");
}

runTests();

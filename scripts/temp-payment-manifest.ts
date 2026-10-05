import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/audit_workspace.db');
const sourceRunId = 'RUN-SCALE-TEST-1789818097620';
const uniquePayments = db.prepare(`
    SELECT DISTINCT p.* FROM audit_zoho_customer_payment_allocations a
    JOIN audit_zoho_customer_payments p ON a.payment_id = p.payment_id AND a.source_run_id = p.source_run_id
    WHERE a.source_run_id = ?
`).all(sourceRunId) as any[];

for (const p of uniquePayments) {
    console.log(`${p.payment_id} | ${p.account_id} | ${p.date} | ${p.source_run_id} | Exact snapshot match from Payment provenance`);
}

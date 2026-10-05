const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync('data/audit_workspace.db');
const run_id = '03b8e08e-f7f1-4cf8-859a-d342218dd245';

const rows = db.prepare(`SELECT checkpoint_key, evidence_json FROM pre_audit_checkpoint_results WHERE run_id = ? AND checkpoint_key IN ('Trial Balance', 'P&L', 'Cash', 'Accounting Equation')`).all(run_id);

for (const row of rows) {
    fs.writeFileSync(`evidence_${row.checkpoint_key.replace(/ /g, '_').replace(/&/g, 'and')}.json`, JSON.stringify(JSON.parse(row.evidence_json || '{}'), null, 2));
}

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = path.join(process.cwd(), 'data', 'audit_workspace.db');
const db = new Database(dbPath);

const poFiles = ['po-2627289.json', 'po-2627286.json'];

for (const file of poFiles) {
  const filePath = path.join(process.cwd(), 'scratch', file);
  if (!fs.existsSync(filePath)) {
    console.error(`File ${file} not found.`);
    continue;
  }

  const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const po = payload.purchaseorder || payload; // Depending on raw structure
  if (!po || !po.purchaseorder_number) {
    console.error(`No purchaseorder in ${file}`);
    continue;
  }

  const submitterId = po.submitter_id;
  const submittedByName = po.submitted_by_name;
  const poNumber = po.purchaseorder_number;

  const stmt = db.prepare(`
    UPDATE audit_zoho_purchase_orders 
    SET submitter_id = ?, submitted_by_name = ?
    WHERE purchaseorder_number = ?
  `);
  
  const result = stmt.run(submitterId, submittedByName, poNumber);
  console.log(`Updated ${poNumber} with submitter_id ${submitterId} and name ${submittedByName}: rows changed = ${result.changes}`);
}

process.loadEnvFile('.env.local');
import { getSalesOrderByNumber, getSalesOrder } from '../app/lib/audit/accounts/zoho-read-transactions';
import { getAuditWorkspaceDbPath } from '../app/lib/db/db-resolver';
import { DatabaseSync } from 'node:sqlite';

async function restore() {
  const orgId = process.env.ZOHO_ORGANIZATION_ID || '774390949';
  const so = await getSalesOrderByNumber(orgId, "SO-2627124");
  if (!so.salesorder || !so.salesorder.salesorder_id) {
    console.error("No salesorder_id found in getSalesOrderByNumber");
    return;
  }
  
  const fullSoResult = await getSalesOrder(orgId, so.salesorder.salesorder_id);
  if (!fullSoResult || !fullSoResult.salesorder || !fullSoResult.salesorder.line_items) {
    console.error("No line items found in full sales order");
    return;
  }
  
  const fullSo = fullSoResult.salesorder;
  
  const dbPath = getAuditWorkspaceDbPath();
  const db = new DatabaseSync(dbPath);
  
  const stmt = db.prepare(`
    INSERT INTO audit_sales_order_lines (
      line_item_id, salesorder_id, item_id, sku, description, quantity, unit, rate, amount, item_order, synced_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')
    ) ON CONFLICT(line_item_id) DO UPDATE SET
      sku=excluded.sku, description=excluded.description, quantity=excluded.quantity, unit=excluded.unit, rate=excluded.rate, amount=excluded.amount, item_order=excluded.item_order, synced_at=excluded.synced_at
  `);
  
  db.exec('BEGIN IMMEDIATE');
  try {
    let count = 0;
    for (const line of fullSo.line_items) {
      stmt.run(
        line.line_item_id,
        fullSo.salesorder_id,
        line.item_id || null,
        line.sku || '',
        line.description || '',
        String(line.quantity),
        line.unit || '',
        String(line.rate),
        String(line.item_total),
        line.item_order || 0
      );
      count++;
    }
    db.exec('COMMIT');
    console.log(`RESTORED ${count} lines for SO-2627124`);
  } catch (e) {
    db.exec('ROLLBACK');
    console.error(e);
  }
}

restore();

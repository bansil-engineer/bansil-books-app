process.loadEnvFile('.env.local');
import { getSalesOrder } from '../app/lib/audit/accounts/zoho-read-transactions';
import { getAuditWorkspaceDbPath } from '../app/lib/db/db-resolver';
import { DatabaseSync } from 'node:sqlite';

async function verify() {
  const orgId = process.env.ZOHO_ORGANIZATION_ID || '774390949';
  const soId = "3166667000020095001";
  const result = await getSalesOrder(orgId, soId);
  if (!result || !result.salesorder) throw new Error('fetch fail');
  const zohoLines = result.salesorder.line_items;

  const db = new DatabaseSync(getAuditWorkspaceDbPath());
  const localLines = db.prepare("SELECT * FROM audit_sales_order_lines WHERE salesorder_id = ?").all(soId) as any[];

  let matched = 0;
  let zoho_only = 0;
  let local_only = 0;
  let value_mismatch = 0;

  const localMap = new Map();
  for (const l of localLines) localMap.set(l.line_item_id, l);

  for (const zl of zohoLines) {
    if (localMap.has(zl.line_item_id)) {
       const ll = localMap.get(zl.line_item_id);
       let match = true;
       if (String(zl.quantity) !== ll.quantity) match = false;
       if (String(zl.rate) !== ll.rate) match = false;
       if (String(zl.item_total) !== ll.amount) match = false;
       
       if (match) matched++; else value_mismatch++;
       localMap.delete(zl.line_item_id);
    } else {
       zoho_only++;
    }
  }
  
  local_only = localMap.size;

  if (zoho_only === 0 && local_only === 0 && value_mismatch === 0) {
     console.log('MATCHED');
  } else {
     console.log('FAIL');
     console.log('ZOHO_ONLY:', zoho_only);
     console.log('LOCAL_ONLY:', local_only);
     console.log('VALUE_MISMATCH:', value_mismatch);
  }
}
verify();

import { getDatabase as getMainDatabase } from "../app/lib/db/database";
import { getPendingCustomersSummary } from "../app/lib/customer-material-control-engine";
import { getCustomerList } from "../app/lib/customer-details-engine";

async function main() {
  const db = getMainDatabase();
  const fy = "2026-27";
  
  // 1. CMC Canonical pending summary
  const pendingSummary = getPendingCustomersSummary(db, { financialYear: fy });
  const pendingIds = new Set(pendingSummary.customers.map(c => c.customer_id));

  // 2. V2 Route (simulated with the new logic, which also calls getPendingCustomersSummary)
  // We'll simulate exactly what the route does now.
  const targetCustomerIds = pendingSummary.customers.map(c => c.customer_id);
  const targetIdsSet = new Set(targetCustomerIds);

  console.log(`CMC pending customer count: ${pendingIds.size}`);
  console.log(`V2 target customer count: ${targetCustomerIds.length}`);

  let missing = 0;
  for (const id of pendingIds) {
    if (!targetIdsSet.has(id)) missing++;
  }

  let extra = 0;
  for (const id of targetIdsSet) {
    if (!pendingIds.has(id)) extra++;
  }

  console.log(`Missing IDs from V2: ${missing}`);
  console.log(`Extra IDs in V2: ${extra}`);
}

main().catch(console.error);

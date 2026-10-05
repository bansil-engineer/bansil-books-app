import { getValidAccessToken } from "./app/lib/zoho-api.ts";
import { getDatabase } from "./app/lib/db/database.ts";
import { secureZohoFetch } from "./app/lib/zoho-security-guard.ts";
import fs from 'fs';

async function run() {
  const db = getDatabase();
  const org = db.prepare(`SELECT organization_id FROM organizations LIMIT 1`).get() as any;
  const orgId = org.organization_id;
  const { token, store } = await getValidAccessToken();
  
  const query = new URLSearchParams({
    organization_id: orgId,
    filter_by: "TransactionDate.CustomDate",
    from_date: "1970-01-01",
    to_date: "2026-03-31",
    response_option: '2'
  });

  const res = await secureZohoFetch(`${store.api_domain}/books/v3/reports/trialbalance?${query.toString()}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` }
  });
  
  const data = await res.json();
  fs.writeFileSync('scratch/tb_1970.json', JSON.stringify(data, null, 2));
  console.log("Wrote tb_1970.json");
}

run().catch(console.error);

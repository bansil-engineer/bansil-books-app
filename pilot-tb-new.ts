import { getValidAccessToken } from "./app/lib/zoho-api.ts";
import { getDatabase } from "./app/lib/db/database.ts";
import { secureZohoFetch } from "./app/lib/zoho-security-guard.ts";

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
  console.log("RESPONSE APPLIED FILTER:", data.page_context?.applied_filter);
  console.log("FROM DATE:", data.page_context?.from_date);
  console.log("TO DATE:", data.page_context?.to_date);
  console.log("AS OF DATE:", data.page_context?.as_of_date);
  console.log("REPORT BASIS:", data.page_context?.report_basis);
  
  const cashCo = data.trialbalance.find((g: any) => g.account_transactions)?.account_transactions.find((l: any) => l.account_id === '3166667000000123049');
  
  console.log("CASH FOR COMPANY TB VALUE:");
  console.log("  Debit:", cashCo?.net_debit_total);
  console.log("  Credit:", cashCo?.net_credit_total);
}

run().catch(console.error);

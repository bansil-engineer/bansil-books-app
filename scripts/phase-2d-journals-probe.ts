import { readTokenStore } from "../app/lib/zoho-token-store";
import { secureZohoFetch } from "../app/lib/zoho-security-guard";

async function probe() {
  const tokens = readTokenStore();
  const organization_id = tokens?.organization_id || process.env.ZOHO_DEFAULT_ORG_ID;
  const api_domain = tokens?.api_domain;

  const listUrl = `${api_domain}/books/v3/journals?organization_id=${organization_id}&per_page=1`;
  const res = await secureZohoFetch(listUrl, {
    method: "GET",
    headers: { Authorization: `Zoho-oauthtoken ${tokens!.access_token}` }
  });
  const data = await res.json();
  
  if (!data.journals || data.journals.length === 0) {
    console.log("No journals found.");
    return;
  }
  
  const j = data.journals[0];
  console.log("LIST ITEM FIELDS:", Object.keys(j));
  console.log("Sample List Item:", j);

  const detailUrl = `${api_domain}/books/v3/journals/${j.journal_id}?organization_id=${organization_id}`;
  const detailRes = await secureZohoFetch(detailUrl, {
    method: "GET",
    headers: { Authorization: `Zoho-oauthtoken ${tokens!.access_token}` }
  });
  const detailData = await detailRes.json();
  
  const dj = detailData.journal;
  console.log("\nDETAIL ITEM FIELDS:", Object.keys(dj));
  console.log("Sample Detail Item:", dj);
  if (dj.line_items && dj.line_items.length > 0) {
    console.log("Sample Line Item:", dj.line_items[0]);
  }
}
probe().catch(console.error);

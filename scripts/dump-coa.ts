import { listChartOfAccounts } from "../app/lib/audit/accounts/zoho-read-source.ts";
import { getValidAccessToken } from "../app/lib/zoho-api.ts";
import fs from "fs";

async function dump() {
  const { store } = await getValidAccessToken();
  const orgId = store.organization_id || "774390949";
  const res = await listChartOfAccounts(orgId);
  fs.writeFileSync("coa.json", JSON.stringify(res.accounts, null, 2));
}

dump().catch(console.error);

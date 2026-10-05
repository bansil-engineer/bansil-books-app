import { getValidAccessToken } from "../app/lib/zoho-api.ts";
import { secureZohoFetch } from "../app/lib/zoho-security-guard.ts";

async function runControlTest() {
  try {
    const { token, store } = await getValidAccessToken();
    const orgId = store.organization_id || "774390949";
    const apiDomain = store.api_domain;

    async function probe(url: string) {
      try {
        const res = await secureZohoFetch(url, {
          method: "GET",
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            "Content-Type": "application/json",
          },
        });
        const data = await res.json().catch(() => ({}));
        return `HTTP ${res.status} | Code: ${data.code} | Message: ${data.message || "none"}`;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    }

    const orgUrl = `${apiDomain}/books/v3/organizations`;
    const invUrl = `${apiDomain}/books/v3/invoices?organization_id=${orgId}&per_page=1`;
    const coaUrl = `${apiDomain}/books/v3/chartofaccounts?organization_id=${orgId}&per_page=1`;
    const bankUrl = `${apiDomain}/books/v3/bankaccounts?organization_id=${orgId}&per_page=1`;

    console.log(`Organizations:\n${await probe(orgUrl)}`);
    console.log(`Invoices:\n${await probe(invUrl)}`);
    console.log(`Chart of Accounts:\n${await probe(coaUrl)}`);
    console.log(`Bank Accounts:\n${await probe(bankUrl)}`);

  } catch (err) {
    console.error("Failed to get token:", err);
  }
}

runControlTest().then(() => process.exit(0)).catch(() => process.exit(1));

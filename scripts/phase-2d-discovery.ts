import { readTokenStore } from "../app/lib/zoho-token-store";
import { secureZohoFetch } from "../app/lib/zoho-security-guard";

const endpoints = [
  { name: "Organizations", path: "/books/v3/organizations", expectedScope: "ZohoBooks.settings.READ" },
  { name: "Invoices", path: "/books/v3/invoices", expectedScope: "ZohoBooks.invoices.READ" },
  { name: "Bills", path: "/books/v3/bills", expectedScope: "ZohoBooks.bills.READ" },
  { name: "Journals", path: "/books/v3/journals", expectedScope: "ZohoBooks.accountants.READ" },
  { name: "Customer Payments", path: "/books/v3/customerpayments", expectedScope: "ZohoBooks.customerpayments.READ" },
  { name: "Vendor Payments", path: "/books/v3/vendorpayments", expectedScope: "ZohoBooks.vendorpayments.READ" },
  { name: "Credit Notes", path: "/books/v3/creditnotes", expectedScope: "ZohoBooks.creditnotes.READ" },
  { name: "Vendor Credits", path: "/books/v3/vendorcredits", expectedScope: "ZohoBooks.debitnotes.READ" },
  { name: "Sales Orders", path: "/books/v3/salesorders", expectedScope: "ZohoBooks.salesorders.READ" },
  { name: "Purchase Orders", path: "/books/v3/purchaseorders", expectedScope: "ZohoBooks.purchaseorders.READ" },
  { name: "Expenses", path: "/books/v3/expenses", expectedScope: "ZohoBooks.expenses.READ" }
];

async function probe() {
  const tokens = readTokenStore();
  if (!tokens || !tokens.access_token) {
    console.error("No valid tokens found.");
    return;
  }

  const organization_id = tokens.organization_id || process.env.ZOHO_DEFAULT_ORG_ID;
  const api_domain = tokens.api_domain;
  if (!organization_id || !api_domain) {
    console.error("Missing org ID or API domain.");
    return;
  }

  console.log("== ENDPOINT PROBE RESULTS ==");
  console.log(`API Domain: ${api_domain}, Org: ${organization_id}\n`);

  const results: any[] = [];

  for (const ep of endpoints) {
    let url = `${api_domain}${ep.path}`;
    if (ep.name !== "Organizations") {
      url += `?organization_id=${organization_id}`;
    }
    
    try {
      const res = await secureZohoFetch(url, {
        method: "GET",
        headers: {
          Authorization: `Zoho-oauthtoken ${tokens.access_token}`
        }
      });
      const data = await res.json();
      
      let status = "ERROR";
      let code = data.code;
      if (res.ok && data.code === 0) {
        status = "PASS";
      } else if (data.code === 6041) {
        status = "AUTH_BLOCKED (Invalid Scope)";
      } else if (data.code === 14) {
        status = "AUTH_BLOCKED (Invalid Token / Scope)";
      } else {
        status = `FAIL (${res.status} - Code: ${data.code})`;
      }

      results.push({
        source: ep.name,
        endpoint: ep.path,
        requiredScope: ep.expectedScope,
        authorized: status === "PASS" ? "YES" : "NO",
        result: status,
        message: data.message,
        code: data.code,
        httpStatus: res.status
      });

      console.log(`[${status}] ${ep.name} - ${ep.path} -> ${data.message || 'No message'}`);
    } catch (e: any) {
      console.log(`[EXCEPTION] ${ep.name} - ${ep.path} -> ${e.message}`);
    }
  }

  console.log("\n== MATRIX ==");
  console.log("SOURCE | HTTP | ZOHO CODE | MESSAGE | AUTHORIZED");
  for (const r of results) {
    console.log(`${r.source} | ${r.httpStatus} | ${r.code} | ${r.message} | ${r.authorized}`);
  }
}

probe().catch(console.error);

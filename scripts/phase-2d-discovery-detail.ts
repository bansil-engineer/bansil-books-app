import { readTokenStore } from "../app/lib/zoho-token-store";
import { secureZohoFetch } from "../app/lib/zoho-security-guard";

const endpoints = [
  { name: "Customer Payments", listPath: "/books/v3/customerpayments", idField: "payment_id" },
  { name: "Vendor Payments", listPath: "/books/v3/vendorpayments", idField: "payment_id" },
  { name: "Credit Notes", listPath: "/books/v3/creditnotes", idField: "creditnote_id" },
  { name: "Vendor Credits", listPath: "/books/v3/vendorcredits", idField: "vendor_credit_id" },
  { name: "Sales Orders", listPath: "/books/v3/salesorders", idField: "salesorder_id" },
  { name: "Purchase Orders", listPath: "/books/v3/purchaseorders", idField: "purchaseorder_id" },
  { name: "Journals", listPath: "/books/v3/journals", idField: "journal_id" },
  { name: "Expenses", listPath: "/books/v3/expenses", idField: "expense_id" }
];

async function discover() {
  const tokens = readTokenStore();
  if (!tokens || !tokens.access_token) return;

  const organization_id = tokens.organization_id || process.env.ZOHO_DEFAULT_ORG_ID;
  const api_domain = tokens.api_domain;

  for (const ep of endpoints) {
    console.log(`\n=== SOURCE: ${ep.name} ===`);
    let listUrl = `${api_domain}${ep.listPath}?organization_id=${organization_id}&per_page=3`;
    
    try {
      const listRes = await secureZohoFetch(listUrl, {
        headers: { Authorization: `Zoho-oauthtoken ${tokens.access_token}` }
      });
      const listData = await listRes.json();
      
      const records = listData[ep.listPath.split('/').pop()!] || [];
      console.log(`LIST COUNT: ${records.length}`);

      if (records.length > 0) {
        const firstRecordId = records[0][ep.idField];
        let detailUrl = `${api_domain}${ep.listPath}/${firstRecordId}?organization_id=${organization_id}`;
        
        const detailRes = await secureZohoFetch(detailUrl, {
          headers: { Authorization: `Zoho-oauthtoken ${tokens.access_token}` }
        });
        const detailData = await detailRes.json();
        
        const detailRecord = detailData[ep.listPath.split('/').pop()!.replace(/s$/, '')] || detailData[ep.listPath.split('/').pop()!]; // basic heuristic
        
        console.log(`DETAIL FETCH: ${detailRes.ok ? 'SUCCESS' : 'FAILED'}`);
        if (detailRecord) {
          const keys = Object.keys(detailRecord);
          console.log(`KEY HEADER FIELDS: ${keys.slice(0, 15).join(', ')}...`);
          
          const childKeys = keys.filter(k => Array.isArray(detailRecord[k]) || typeof detailRecord[k] === 'object');
          console.log(`KEY CHILD/RELATIONSHIP FIELDS: ${childKeys.join(', ')}`);

          if (ep.name === "Customer Payments") {
            const allocs = detailRecord.invoices || [];
            console.log(`INVOICE -> PAYMENT RELATIONSHIP: ${allocs.length > 0 ? 'EXPLICIT_ALLOCATION' : 'MISSING'}`);
            console.log(`PAYMENT -> BANK: ${detailRecord.account_id ? 'EXPLICIT_ID_LINK' : 'MISSING'}`);
          }
          if (ep.name === "Vendor Payments") {
            const allocs = detailRecord.bills || [];
            console.log(`BILL -> VENDOR PAYMENT: ${allocs.length > 0 ? 'EXPLICIT_ALLOCATION' : 'MISSING'}`);
            console.log(`VENDOR PAYMENT -> BANK: ${detailRecord.account_id || detailRecord.paid_through_account_id ? 'EXPLICIT_ID_LINK' : 'MISSING'}`);
          }
          if (ep.name === "Credit Notes") {
            const allocs = detailRecord.invoices || [];
            console.log(`INVOICE -> CREDIT NOTE: ${allocs.length > 0 ? 'EXPLICIT_ALLOCATION' : 'MISSING'}`);
          }
          if (ep.name === "Vendor Credits") {
            const allocs = detailRecord.bills || [];
            console.log(`BILL -> VENDOR CREDIT: ${allocs.length > 0 ? 'EXPLICIT_ALLOCATION' : 'MISSING'}`);
          }
          if (ep.name === "Sales Orders") {
            console.log(`SO -> INVOICE: ${detailRecord.invoices ? 'EXPLICIT_ID_LINK' : 'DETAIL_ONLY (or MISSING)'}`);
          }
          if (ep.name === "Purchase Orders") {
            console.log(`PO -> BILL: ${detailRecord.bills ? 'EXPLICIT_ID_LINK' : 'DETAIL_ONLY (or MISSING)'}`);
          }
          if (ep.name === "Journals") {
            const lines = detailRecord.line_items || [];
            console.log(`JOURNAL LINE -> COA: ${lines.some((l: any) => l.account_id) ? 'EXPLICIT_ID_LINK' : 'MISSING'}`);
          }
          if (ep.name === "Expenses") {
            console.log(`EXPENSE -> PAID-THROUGH ACCOUNT: ${detailRecord.paid_through_account_id || detailRecord.account_id ? 'EXPLICIT_ID_LINK' : 'MISSING'}`);
          }
        }
      }
    } catch (e: any) {
      console.log(`ERROR: ${e.message}`);
    }
  }
}

discover().catch(console.error);

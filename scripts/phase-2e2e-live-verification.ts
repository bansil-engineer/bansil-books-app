
import { getValidAccessToken } from "../app/lib/zoho-api.ts";
import { secureZohoFetch } from "../app/lib/zoho-security-guard.ts";

async function run() {
  const orgId = "774390949";
  const { token, store } = await getValidAccessToken();
  const domain = store.api_domain || "https://www.zohoapis.com";

  console.log("=== PHASE 2E.2E LIVE VERIFICATION EXECUTION ===");

  // 1. Bill 3166667000017971127
  const billId = "3166667000017971127";
  const billUrl = `${domain}/books/v3/bills/${billId}?organization_id=${orgId}`;
  const billStart = new Date().toISOString();
  console.log(`\n[${billStart}] Executing GET: ${billUrl}`);
  const billRes = await secureZohoFetch(billUrl, {
    method: "GET",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
  }, "audit_sync");
  const billEnd = new Date().toISOString();
  console.log(`[${billEnd}] Response Status: HTTP ${billRes.status} ${billRes.statusText}`);
  const billData = await billRes.json();
  const bill = billData.bill;
  console.log(`Bill ID: ${bill.bill_id}`);
  console.log(`Bill Number: ${bill.bill_number}`);
  console.log(`Date: ${bill.date}`);
  console.log(`Status: ${bill.status}`);
  console.log(`Total: ${bill.total}`);
  console.log(`Balance: ${bill.balance}`);
  console.log(`Vendor: ${bill.vendor_name}`);
  console.log(`Payments on Bill count: ${bill.payments?.length || 0}`);
  if (bill.payments) {
    for (const p of bill.payments) {
      console.log(`  - Payment ID: ${p.payment_id}, Payment Number: ${p.payment_number}, Date: ${p.date}, Amount: ${p.amount}, Reference: ${p.reference_number}, Mode: ${p.payment_mode}`);
    }
  }

  // Payments to verify: #3102, #3103, #3104
  const paymentIds = [
    { id: "3166667000019210027", num: "3102" },
    { id: "3166667000019210092", num: "3103" },
    { id: "3166667000019210139", num: "3104" },
  ];

  for (const item of paymentIds) {
    const payUrl = `${domain}/books/v3/vendorpayments/${item.id}?organization_id=${orgId}`;
    const startTs = new Date().toISOString();
    console.log(`\n[${startTs}] Executing GET: ${payUrl}`);
    const payRes = await secureZohoFetch(payUrl, {
      method: "GET",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
    }, "audit_sync");
    const endTs = new Date().toISOString();
    console.log(`[${endTs}] Response Status: HTTP ${payRes.status} ${payRes.statusText}`);
    const payData = await payRes.json();
    const vp = payData.vendorpayment;
    console.log(`Payment ID: ${vp.payment_id}`);
    console.log(`Payment Number: ${vp.payment_number}`);
    console.log(`Date: ${vp.date}`);
    console.log(`Vendor: ${vp.vendor_name}`);
    console.log(`Paid-Through Account ID: ${vp.paid_through_account_id}`);
    console.log(`Reference: ${vp.reference_number}`);
    console.log(`Total Amount: ${vp.amount}`);
    console.log(`Bills Allocated count: ${vp.bills?.length || 0}`);
    let sumAlloc = 0;
    if (vp.bills) {
      for (const b of vp.bills) {
        console.log(`  - Bill ID: ${b.bill_id}, Bill Number: ${b.bill_number}, Date: ${b.date}, Total: ${b.total}, Amount Applied: ${b.amount_applied}`);
        sumAlloc += Number(b.amount_applied || 0);
      }
    }
    console.log(`Sum Allocated: ${sumAlloc}, Header Total: ${vp.amount}, Discrepancy: ${Number(vp.amount) - sumAlloc}`);
  }

  console.log("\n=== LIVE VERIFICATION EXECUTION COMPLETE ===");
}

run().catch((err) => {
  console.error("Fatal Error:", err);
  process.exit(1);
});

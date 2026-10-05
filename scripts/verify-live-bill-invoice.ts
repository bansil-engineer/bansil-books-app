import fs from "node:fs";
import path from "node:path";

// Load .env.local without exposing values
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      process.env[k] = v;
    }
  }
}

import { getValidAccessToken } from "../app/lib/zoho-api.ts";
import { secureZohoFetch } from "../app/lib/zoho-security-guard.ts";

async function run() {
  const orgId = "774390949";
  const { token, store } = await getValidAccessToken();

  console.log("Connected to Zoho API domain:", store.api_domain);

  // 1. Search Bill AA2450002266
  console.log("\nFetching bill AA2450002266...");
  const billListUrl = `${store.api_domain}/books/v3/bills?bill_number=AA2450002266&organization_id=${orgId}`;
  const billListRes = await secureZohoFetch(billListUrl, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
  });

  const billListData = await billListRes.json();
  console.log("Bill search response code:", billListData.code, "message:", billListData.message);
  const bills = billListData.bills || [];
  console.log("Bills found:", bills.length);

  if (bills.length > 0) {
    const billId = bills[0].bill_id;
    console.log("Found bill_id:", billId, "vendor:", bills[0].vendor_name);

    // Fetch full bill detail
    const billDetailUrl = `${store.api_domain}/books/v3/bills/${billId}?organization_id=${orgId}`;
    const billDetailRes = await secureZohoFetch(billDetailUrl, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
    });
    const billDetailData = await billDetailRes.json();
    const bill = billDetailData.bill;
    console.log("Bill Detail Vendor:", bill.vendor_name);
    console.log("Bill Date:", bill.date);
    console.log("Bill Status:", bill.status);
    console.log("Bill Line Items Count:", bill.line_items?.length);

    let bbtQtySum = 0;
    let bbtAmtSum = 0;

    for (const line of bill.line_items || []) {
      const isEndCover = (line.name || "").toLowerCase().includes("end cover") || (line.description || "").toLowerCase().includes("end cover");
      const isBBT = (line.name || "").includes("BBT") || (line.description || "").includes("BBT") || (line.name || "").toLowerCase().includes("tap off box");
      
      console.log({
        line_item_id: line.line_item_id,
        item_id: line.item_id,
        name: line.name,
        description: line.description,
        quantity: line.quantity,
        rate: line.rate,
        item_total: line.item_total,
        bbt_customer_name: line.bbt_customer_name,
        customer_name: line.customer_name,
        customer_id: line.customer_id,
        isEndCover,
        isBBT,
      });

      if (!isEndCover) {
        bbtQtySum += Number(line.quantity) || 0;
        bbtAmtSum += Number(line.item_total) || 0;
      }
    }
    console.log(`TOTAL BBT (excl End Cover) - Qty: ${bbtQtySum}, Amount: ₹${bbtAmtSum.toFixed(2)}`);
  }

  // 2. Search Invoice INV-2526163
  console.log("\nFetching invoice INV-2526163...");
  const invListUrl = `${store.api_domain}/books/v3/invoices?invoice_number=INV-2526163&organization_id=${orgId}`;
  const invListRes = await secureZohoFetch(invListUrl, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
  });

  const invListData = await invListRes.json();
  console.log("Invoice search response code:", invListData.code, "message:", invListData.message);
  const invoices = invListData.invoices || [];
  console.log("Invoices found:", invoices.length);

  if (invoices.length > 0) {
    const invId = invoices[0].invoice_id;
    console.log("Found invoice_id:", invId, "customer:", invoices[0].customer_name);

    // Fetch full invoice detail
    const invDetailUrl = `${store.api_domain}/books/v3/invoices/${invId}?organization_id=${orgId}`;
    const invDetailRes = await secureZohoFetch(invDetailUrl, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
    });
    const invDetailData = await invDetailRes.json();
    const invoice = invDetailData.invoice;
    console.log("Invoice Detail Customer:", invoice.customer_name);
    console.log("Invoice Date:", invoice.date);
    console.log("Invoice Status:", invoice.status);
    console.log("Invoice Line Items Count:", invoice.line_items?.length);

    let invQtySum = 0;
    let invAmtSum = 0;

    for (const line of invoice.line_items || []) {
      console.log({
        line_item_id: line.line_item_id,
        item_id: line.item_id,
        name: line.name,
        description: line.description,
        quantity: line.quantity,
        rate: line.rate,
        item_total: line.item_total,
      });
      invQtySum += Number(line.quantity) || 0;
      invAmtSum += Number(line.item_total) || 0;
    }
    console.log(`TOTAL Sales Line Qty: ${invQtySum}, Amount: ₹${invAmtSum.toFixed(2)}`);
  }
}

run().catch((err) => {
  console.error("Error in run:", err);
});

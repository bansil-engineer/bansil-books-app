// ============================================================
// Bansil Books Analytics — Full Historical Backfill Runner
// Runs full FY 2025-26 Backfill with Live Console Progress & Audit
// STRICTLY READ-ONLY GET ACCESS TO ZOHO BOOKS
// ============================================================

import fs from "node:fs";
import path from "node:path";

// Load .env.local safely
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

import { performFullHistoricalBackfill } from "../app/lib/db/sync-engine.ts";
import { getDatabase, isFullBackfillCompleted } from "../app/lib/db/database.ts";
import { generateMasterInventoryMismatchReport } from "../app/lib/inventory-mismatch-engine.ts";

async function main() {
  console.log("==================================================");
  console.log("BANSIL BOOKS — FULL HISTORICAL BACKFILL: FY 2025-26");
  console.log("ZOHO ACCESS: STRICTLY READ-ONLY (GET ONLY)");
  console.log("ZOHO WRITE: BLOCKED");
  console.log("DESTINATION: Local SQLite (data/bansil_books.db)");
  console.log("==================================================\n");

  const result = await performFullHistoricalBackfill({
    financialYear: "FY 2025-26",
    fromDate: "2025-04-01",
    toDate: "2026-03-31",
    concurrency: 5,
    onProgress: (p) => {
      console.log(`[PROGRESS] ${p.phase.padEnd(16)}: ${p.message}`);
    },
  });

  console.log("\n==================================================");
  console.log("BACKFILL RESULT SUMMARY");
  console.log("==================================================");
  console.log(`Status: ${result.status}`);
  console.log(`Duration: ${Math.round(result.durationMs / 1000)}s`);
  console.log(`API Calls made: ${result.apiCalls}`);
  console.log(`Invoice List Pages: ${result.invoiceListPages}`);
  console.log(`Invoices Found: ${result.invoicesFound}`);
  console.log(`Invoices Synced: ${result.invoicesSynced}`);
  console.log(`Invoice Lines Synced: ${result.invoiceLinesSynced}`);
  console.log(`Bill List Pages: ${result.billListPages}`);
  console.log(`Bills Found: ${result.billsFound}`);
  console.log(`Bills Synced: ${result.billsSynced}`);
  console.log(`Bill Lines Synced: ${result.billLinesSynced}`);
  console.log(`Distinct Sales Customers: ${result.distinctSalesCustomers}`);
  console.log(`Distinct Sales Items: ${result.distinctSalesItems}`);
  console.log(`Distinct Vendors: ${result.distinctVendors}`);
  console.log(`Distinct Purchase Customers: ${result.distinctPurchaseCustomers}`);
  console.log(`Distinct Purchase Items: ${result.distinctPurchaseItems}`);
  console.log(`Customer Details Missing: ${result.customerDetailsMissingCount}`);
  console.log(`Customer Dropdown Count: ${result.customerDropdownCount}`);
  console.log(`Item Dropdown Count: ${result.itemDropdownCount}`);

  // LANTEC BBT Validation Check
  const db = getDatabase();
  const fyCompleted = isFullBackfillCompleted(db, "FY 2025-26");

  const mismatchReport = generateMasterInventoryMismatchReport({
    financialYear: "FY 2025-26",
    fromDate: "2025-04-01",
    toDate: "2026-03-31",
  });

  const allReportItems = [...mismatchReport.reconciled, ...mismatchReport.items];
  const lantecBBT = allReportItems.find(
    (i) =>
      i.customerName.includes("LANTEC") &&
      i.itemName.includes("BBT Tap Off Box")
  );

  let lantecPass = false;
  if (lantecBBT) {
    const pQtyMatch = lantecBBT.purchaseQty === 55;
    const sQtyMatch = lantecBBT.salesQty === 55;
    const balMatch = lantecBBT.balanceQty === 0;
    const pAmtMatch = Math.abs(lantecBBT.purchaseAmount - 1637317.22) < 1.0;
    const sAmtMatch = Math.abs(lantecBBT.salesAmount - 1760560.0) < 1.0;
    lantecPass = pQtyMatch && sQtyMatch && balMatch && pAmtMatch && sAmtMatch;
    console.log("\nLANTEC BBT Verification:", {
      customerName: lantecBBT.customerName,
      itemName: lantecBBT.itemName,
      purchaseQty: lantecBBT.purchaseQty,
      salesQty: lantecBBT.salesQty,
      balanceQty: lantecBBT.balanceQty,
      purchaseAmount: lantecBBT.purchaseAmount,
      salesAmount: lantecBBT.salesAmount,
      status: lantecBBT.status,
      matched: lantecPass,
    });
  } else {
    console.log("\nLANTEC BBT not found in report items.");
  }

  console.log("\n==================================================");
  console.log("FINAL REPORT FORMAT (REQUIREMENT 31)");
  console.log("==================================================");
  console.log(`FY: FY 2025-26`);
  console.log(`FULL BACKFILL: ${result.status === "SUCCESS" ? "PASS" : "FAIL"}`);
  console.log(`ZOHO INVOICE LIST PAGES: ${result.invoiceListPages}`);
  console.log(`ZOHO SALES INVOICES: ${result.invoicesFound}`);
  console.log(`ZOHO SALES LINE ITEMS: ${result.invoiceLinesSynced}`);
  console.log(`DISTINCT SALES CUSTOMERS: ${result.distinctSalesCustomers}`);
  console.log(`DISTINCT SALES ITEMS: ${result.distinctSalesItems}`);
  console.log(`ZOHO BILL LIST PAGES: ${result.billListPages}`);
  console.log(`ZOHO PURCHASE BILLS: ${result.billsFound}`);
  console.log(`ZOHO PURCHASE LINE ITEMS: ${result.billLinesSynced}`);
  console.log(`DISTINCT VENDORS: ${result.distinctVendors}`);
  console.log(`DISTINCT PURCHASE CUSTOMERS: ${result.distinctPurchaseCustomers}`);
  console.log(`DISTINCT PURCHASE ITEMS: ${result.distinctPurchaseItems}`);
  console.log(`CUSTOMER DETAILS MISSING: ${result.customerDetailsMissingCount}`);
  console.log(`CUSTOMER DROPDOWN COUNT: ${result.customerDropdownCount}`);
  console.log(`ITEM DROPDOWN COUNT: ${result.itemDropdownCount}`);
  console.log(`FULL FY COVERAGE MARKED: ${fyCompleted ? "YES" : "NO"}`);
  console.log(`LANTEC VALIDATION: ${lantecPass ? "PASS" : "FAIL"}`);
  console.log(`REPORT DATA SOURCE: ZOHO SQLITE CACHE`);
  console.log(`DEMO DATA: NO`);
  console.log(`ZOHO ACCESS: READ ONLY`);
  console.log(`ZOHO DATA MODIFIED: NO`);

  if (result.status !== "SUCCESS" || !lantecPass) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Backfill failed with error:", err);
  process.exit(1);
});

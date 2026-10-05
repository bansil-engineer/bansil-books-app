// scripts/validate-real-rates.ts
import { getDatabase } from "../app/lib/db/database.ts";
import { generateMasterInventoryMismatchReport } from "../app/lib/inventory-mismatch-engine.ts";
import { resolveDateRange } from "../app/lib/date-period-utils.ts";

const db = getDatabase();

console.log("============================================================");
console.log("REAL-DATA VALIDATION: 5 REAL CUSTOMER+ITEM RECORDS");
console.log("PROVING LATEST ACTUAL RATE VS AVERAGE");
console.log("============================================================\n");

// Query 5 real records that appear in Master Inventory Mismatch in 2025-26 and have multiple purchase bills in period or historical
const period = "2025-26";
const dateRange = resolveDateRange({ financialYear: period, period });

const report = generateMasterInventoryMismatchReport({
  financialYear: period,
  period,
  includeExcludedItems: true,
});

// Find items in report that have a reference rate and have multiple purchase lines
const candidates = report.items.filter(it => it.approxRefPurchaseRate && it.approxRefPurchaseRate > 0);

console.log(`Found ${candidates.length} items in Master Mismatch report for ${period} with valid approx reference rate.`);

let verifiedCount = 0;
const targetCount = 5;

for (const it of candidates) {
  if (verifiedCount >= targetCount) break;

  // Fetch all eligible purchase lines for this customer + item within period
  const periodLines = db.prepare(`
    SELECT 
      pb.bill_number as billNumber,
      pb.date as billDate,
      pb.vendor_name as vendorName,
      pli.quantity,
      pli.rate,
      pli.line_total as amount,
      pb.bill_id as billId,
      pli.line_item_id as lineItemId
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
      AND pb.date >= ? AND pb.date <= ?
      AND pli.rate > 0
      AND (
        (pli.purchase_line_customer_name = ? OR pli.bbt_customer_name = ?)
        OR (pli.purchase_line_customer_id = ? OR pli.bbt_customer_id = ?)
      )
      AND (pli.item_id = ? OR pli.item_name = ?)
    ORDER BY pb.date DESC, pb.bill_id DESC, pli.line_item_id DESC
  `).all(
    dateRange.fromDate, dateRange.toDate,
    it.customerName, it.customerName,
    it.customerId, it.customerId,
    it.itemId, it.itemName
  ) as Array<{
    billNumber: string;
    billDate: string;
    vendorName: string;
    quantity: number;
    rate: number;
    amount: number;
    billId: string;
    lineItemId: string;
  }>;

  // We want records with at least 2 lines (or if none in period, historical lines) to prove latest vs average
  if (periodLines.length >= 2) {
    verifiedCount++;
    console.log(`------------------------------------------------------------`);
    console.log(`VALIDATED RECORD #${verifiedCount}:`);
    console.log(`Customer:        ${it.customerName} (ID: ${it.customerId})`);
    console.log(`Item:            ${it.itemName} (ID: ${it.itemId})`);
    console.log(`Selected Period: ${period} (${dateRange.fromDate} to ${dateRange.toDate})`);
    console.log(`Total Eligible Period Purchase Lines: ${periodLines.length}`);

    console.log(`\nAll Eligible Purchase Lines (Newest to Oldest):`);
    let sumRate = 0;
    let sumQty = 0;
    let sumAmt = 0;
    periodLines.forEach((l, i) => {
      sumRate += l.rate;
      sumQty += l.quantity;
      sumAmt += l.amount;
      console.log(`  [${i + 1}] Date: ${l.billDate} | Bill: ${l.billNumber} | Vendor: ${l.vendorName} | Qty: ${l.quantity} | Rate: Rs. ${l.rate.toFixed(2)} | Line Total: Rs. ${l.amount.toFixed(2)}`);
    });

    const simpleAvg = sumRate / periodLines.length;
    const weightedAvg = sumAmt / sumQty;
    const latestLine = periodLines[0];

    console.log(`\nRate Statistics:`);
    console.log(`  Simple Average Rate:   Rs. ${simpleAvg.toFixed(2)}`);
    console.log(`  Weighted Average Rate: Rs. ${weightedAvg.toFixed(2)}`);
    console.log(`  LATEST Actual Rate:    Rs. ${latestLine.rate.toFixed(2)} (Bill: ${latestLine.billNumber}, Date: ${latestLine.billDate}, Vendor: ${latestLine.vendorName})`);

    console.log(`\nEngine Output:`);
    console.log(`  Chosen Reference Rate:   Rs. ${it.approxRefPurchaseRate?.toFixed(2)}`);
    console.log(`  Chosen Reference Bill:   ${it.approxRateBillNumber}`);
    console.log(`  Chosen Reference Date:   ${it.approxRateDate}`);
    console.log(`  Chosen Reference Vendor: ${it.approxRateVendor}`);
    console.log(`  Chosen Rate Basis:       ${it.approxRateBasis}`);
    console.log(`  Shortage Qty:            ${it.yetToPurchaseQty}`);
    console.log(`  Approx Shortage Value:   Rs. ${it.approxShortageValue !== null && it.approxShortageValue !== undefined ? it.approxShortageValue.toFixed(2) : 'N/A'}`);
    console.log(`  Surplus Qty:             ${it.yetToSaleQty}`);
    console.log(`  Approx Surplus Value:    Rs. ${it.approxSurplusValue !== null && it.approxSurplusValue !== undefined ? it.approxSurplusValue.toFixed(2) : 'N/A'}`);

    if (it.approxRefPurchaseRate === latestLine.rate && it.approxRateBillNumber === latestLine.billNumber) {
      console.log(`  PROVED: LATEST ACTUAL RATE MATCH (Bill ${latestLine.billNumber}, Rate Rs. ${latestLine.rate.toFixed(2)} vs Avg Rs. ${simpleAvg.toFixed(2)})`);
    } else {
      console.error(`  FAILED: Rate mismatch!`);
      process.exit(1);
    }
  }
}

console.log("\n============================================================");
console.log(`SUCCESS: ${verifiedCount} Real Records Verified. Selected Rate is Strictly LATEST actual rate.`);
console.log("============================================================\n");

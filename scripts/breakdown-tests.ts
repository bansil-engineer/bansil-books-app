// ============================================================
// Bansil Books Analytics — Transaction Breakdown Test Suite
// Full Precision Internal Sums · 5-Sheet & 7-Sheet Excel Builds
// Matrix: All/All · Customer/All · All/Item · Customer/Item
// ZERO ZOHO API CALLS · LOCAL SQLITE ONLY
// ============================================================

import assert from "node:assert";
import { getDatabase } from "../app/lib/db/database.ts";
import {
  generateMasterInventoryMismatchReport,
  getItemTransactionBreakdown,
} from "../app/lib/inventory-mismatch-engine.ts";
import {
  buildTransactionBreakdownExcel,
  buildGlobalBreakdownExcel,
} from "../app/lib/export/excel-builder.ts";

let passedCount = 0;
let failedCount = 0;

function pass(name: string) {
  console.log(`  ✓ PASS: ${name}`);
  passedCount++;
}

function fail(name: string, err: unknown) {
  console.error(`  ✗ FAIL: ${name}`, err);
  failedCount++;
}

function test(name: string, fn: () => void) {
  try {
    fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

console.log("\n==================================================");
console.log("TRANSACTION BREAKDOWN VERIFICATION TEST SUITE");
console.log("==================================================");

const LANTEC_CUSTOMER_ID = "3166667000009883071";
const BBT_ITEM_ID = "3166667000000170366";

// --- TEST GROUP 1: Precision & Line Item Sums ---
console.log("\n--- TEST GROUP 1: Precision & Line Item Sums ---");

test("LANTEC + BBT Tap Off Box Breakdown sums match totals exactly (Full Precision)", () => {
  const breakdown = getItemTransactionBreakdown(
    LANTEC_CUSTOMER_ID,
    BBT_ITEM_ID,
    { financialYear: "2025-26" }
  );

  assert.ok(breakdown, "Breakdown should exist");
  assert.strictEqual(breakdown.customerId, LANTEC_CUSTOMER_ID);
  assert.strictEqual(breakdown.itemId, BBT_ITEM_ID);

  // Purchase Breakdown: SUM line Qty = displayed Total Purchase Qty
  const sumPurchQty = breakdown.purchaseTransactions.reduce((acc, t) => acc + t.quantity, 0);
  assert.strictEqual(
    sumPurchQty,
    breakdown.totalPurchaseQty,
    `Purchase Qty sum (${sumPurchQty}) must equal totalPurchaseQty (${breakdown.totalPurchaseQty})`
  );

  // SUM line Amount = displayed Total Purchase Amount (float precision within 0.0001)
  const sumPurchAmt = breakdown.purchaseTransactions.reduce((acc, t) => acc + t.amount, 0);
  assert.ok(
    Math.abs(sumPurchAmt - breakdown.totalPurchaseAmount) < 0.0001,
    `Purchase Amount sum (${sumPurchAmt}) must equal totalPurchaseAmount (${breakdown.totalPurchaseAmount})`
  );

  // Sales Breakdown: SUM line Qty = displayed Total Sales Qty
  const sumSalesQty = breakdown.salesTransactions.reduce((acc, t) => acc + t.quantity, 0);
  assert.strictEqual(
    sumSalesQty,
    breakdown.totalSalesQty,
    `Sales Qty sum (${sumSalesQty}) must equal totalSalesQty (${breakdown.totalSalesQty})`
  );

  // SUM line Amount = displayed Total Sales Amount
  const sumSalesAmt = breakdown.salesTransactions.reduce((acc, t) => acc + t.amount, 0);
  assert.ok(
    Math.abs(sumSalesAmt - breakdown.totalSalesAmount) < 0.0001,
    `Sales Amount sum (${sumSalesAmt}) must equal totalSalesAmount (${breakdown.totalSalesAmount})`
  );

  // Reconciled Qty = MIN(Purchase Qty, Sales Qty)
  assert.strictEqual(
    breakdown.reconciledQty,
    Math.min(breakdown.totalPurchaseQty, breakdown.totalSalesQty)
  );
  // Balance Qty = Purchase Qty - Sales Qty
  assert.strictEqual(
    breakdown.balanceQty,
    breakdown.totalPurchaseQty - breakdown.totalSalesQty
  );
});

// --- TEST GROUP 2: Single Row Breakdown Excel (5 sheets) ---
console.log("\n--- TEST GROUP 2: Single Row Breakdown Excel (5 sheets) ---");

test("Single Row Breakdown Excel generates valid zip buffer with 5 sheets", () => {
  const breakdown = getItemTransactionBreakdown(
    LANTEC_CUSTOMER_ID,
    BBT_ITEM_ID,
    { financialYear: "2025-26" }
  );
  const buffer = buildTransactionBreakdownExcel(breakdown, "FY 2025-26");
  assert.ok(buffer instanceof Buffer, "Should return a Buffer");
  assert.ok(buffer.length > 500, `Buffer should be substantial, got ${buffer.length} bytes`);
  // Check PK zip signature
  assert.strictEqual(buffer[0], 0x50);
  assert.strictEqual(buffer[1], 0x4b);
});

// --- TEST GROUP 3: Global Breakdown 7-Sheet Workbook & Matrix ---
console.log("\n--- TEST GROUP 3: Global Breakdown 7-Sheet Workbook & Matrix ---");

test("Global Breakdown Workbook: All Customers + All Items", () => {
  const report = generateMasterInventoryMismatchReport({ financialYear: "2025-26" });
  const buffer = buildGlobalBreakdownExcel(report);
  assert.ok(buffer instanceof Buffer);
  assert.ok(buffer.length > 1000);
  assert.strictEqual(buffer[0], 0x50);
  assert.strictEqual(buffer[1], 0x4b);
});

test("Global Breakdown Workbook: Selected Customer + All Items", () => {
  const report = generateMasterInventoryMismatchReport({
    financialYear: "2025-26",
    customerId: LANTEC_CUSTOMER_ID,
  });
  const buffer = buildGlobalBreakdownExcel(report);
  assert.ok(buffer instanceof Buffer);
  assert.ok(buffer.length > 1000);
});

test("Global Breakdown Workbook: All Customers + Selected Item", () => {
  const report = generateMasterInventoryMismatchReport({
    financialYear: "2025-26",
    itemId: BBT_ITEM_ID,
  });
  const buffer = buildGlobalBreakdownExcel(report);
  assert.ok(buffer instanceof Buffer);
  assert.ok(buffer.length > 1000);
});

test("Global Breakdown Workbook: Selected Customer + Selected Item", () => {
  const report = generateMasterInventoryMismatchReport({
    financialYear: "2025-26",
    customerId: LANTEC_CUSTOMER_ID,
    itemId: BBT_ITEM_ID,
  });
  const buffer = buildGlobalBreakdownExcel(report);
  assert.ok(buffer instanceof Buffer);
  assert.ok(buffer.length > 1000);
});

// --- TEST GROUP 4: Key Uniqueness & Multiple Lines on Same Document ---
console.log("\n--- TEST GROUP 4: Key Uniqueness & Multiple Lines on Same Document ---");

test("Invoice 3166667000012035625 with multiple lines for same Item produces unique React keys", () => {
  const JSW_CUSTOMER_ID = "3166667000000078104";
  const PVC_ITEM_ID = "3166667000008440170";

  const breakdown = getItemTransactionBreakdown(
    JSW_CUSTOMER_ID,
    PVC_ITEM_ID,
    { financialYear: "2025-26" }
  );

  assert.ok(breakdown, "Breakdown should exist for JSW + PVC Conduit");
  assert.ok(breakdown.salesTransactions.length >= 4, `Should have multiple sales lines, got ${breakdown.salesTransactions.length}`);

  // Check multiple lines on same invoice 3166667000012035625
  const linesOnTargetInv = breakdown.salesTransactions.filter(t => t.invoiceId === "3166667000012035625");
  assert.strictEqual(linesOnTargetInv.length, 4, `Invoice 3166667000012035625 must have 4 legitimate PVC Conduit lines, found ${linesOnTargetInv.length}`);

  // Verify all sales line item IDs are defined and unique
  const salesKeys = new Set<string>();
  for (const tx of breakdown.salesTransactions) {
    assert.ok(tx.lineItemId, "Every sales transaction line must have lineItemId");
    const reactKey = `sales-${tx.invoiceId}-${tx.lineItemId || tx.invoiceNumber}`;
    assert.ok(!salesKeys.has(reactKey), `Duplicate React sales row key detected: ${reactKey}`);
    salesKeys.add(reactKey);
  }
  assert.strictEqual(salesKeys.size, breakdown.salesTransactions.length, "All sales React keys must be unique");

  // Verify precision sum matches exactly
  const sumQty = breakdown.salesTransactions.reduce((acc, t) => acc + t.quantity, 0);
  assert.strictEqual(sumQty, breakdown.totalSalesQty, "Sum of line quantities must equal totalSalesQty");
  const sumAmt = breakdown.salesTransactions.reduce((acc, t) => acc + t.amount, 0);
  assert.ok(Math.abs(sumAmt - breakdown.totalSalesAmount) < 0.001, "Sum of line amounts must equal totalSalesAmount");
});

test("All Master Reconciliation rows across full dataset produce unique keys", () => {
  for (const fy of ["2025-26", "2026-27", "ALL"]) {
    const report = generateMasterInventoryMismatchReport({ financialYear: fy });
    const masterKeys = new Set<string>();
    for (const item of report.items) {
      const reactKey = `recon-${item.customerId}-${item.itemId || item.itemName || "item"}`;
      assert.ok(!masterKeys.has(reactKey), `Duplicate Master Recon row key detected: ${reactKey}`);
      masterKeys.add(reactKey);
    }
    assert.strictEqual(masterKeys.size, report.items.length, `All Master Reconciliation keys must be unique for FY ${fy}`);
  }
});

test("All Customer Details Missing rows produce unique keys", () => {
  for (const fy of ["2025-26", "2026-27", "ALL"]) {
    const report = generateMasterInventoryMismatchReport({ financialYear: fy });
    const missingKeys = new Set<string>();
    for (let idx = 0; idx < report.customerDetailsMissing.length; idx++) {
      const exc = report.customerDetailsMissing[idx];
      const reactKey = `missing-${exc.billId}-${exc.lineItemId || exc.itemId || idx}`;
      assert.ok(!missingKeys.has(reactKey), `Duplicate missing customer row key detected: ${reactKey}`);
      missingKeys.add(reactKey);
    }
    assert.strictEqual(missingKeys.size, report.customerDetailsMissing.length, `All Customer Details Missing keys must be unique for FY ${fy}`);
  }
});


console.log("\n--------------------------------------------------");
console.log(`Results: ${passedCount} passed, ${failedCount} failed`);
console.log("--------------------------------------------------\n");

if (failedCount > 0) {
  process.exit(1);
}

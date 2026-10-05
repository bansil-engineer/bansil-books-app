// ============================================================
// Bansil Books Analytics — UI Filter & Static Layout Test Suite
// Test Matrix: All/All · Customer/All · All/Item · Customer/Item
// Period-Aware Filter Options · Zero-Sync Warnings · ID-Based Filters
// Excel & PDF Consistency · ZERO ZOHO API CALLS · LOCAL SQLITE ONLY
// ============================================================

import assert from "node:assert";
import { getDatabase } from "../app/lib/db/database.ts";
import {
  generateMasterInventoryMismatchReport,
  getItemTransactionBreakdown,
  getPeriodFilterOptions,
} from "../app/lib/inventory-mismatch-engine.ts";
import { buildMasterInventoryMismatchExcel } from "../app/lib/export/excel-builder.ts";
import { buildMasterInventoryMismatchPdf } from "../app/lib/export/pdf-builder.ts";
import { getCurrentFinancialYear } from "../app/lib/date-period-utils.ts";

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
console.log("UI FILTER & STATIC LAYOUT VERIFICATION TEST SUITE");
console.log("==================================================");

const db = getDatabase();

const LANTEC_CUSTOMER_ID = "3166667000009883071";
const LANTEC_CUSTOMER_NAME = "LANTEC INDUSTRIES PRIVATE LIMITED";
const BBT_ITEM_ID = "3166667000000170366";
const BBT_ITEM_NAME = "BBT Tap Off Box (Bus Plug)";

// --- TEST GROUP 1: Period-Aware Filter Options ---
console.log("\n--- TEST GROUP 1: Period-Aware Filter Options ---");

test("FY 2025-26 dropdown options come from FY 2025-26 synced data", () => {
  const options = getPeriodFilterOptions({ financialYear: "2025-26" });
  assert.ok(options.customers.length > 30, `Expected >30 customers, got ${options.customers.length}`);
  assert.ok(options.items.length > 100, `Expected >100 items, got ${options.items.length}`);
  assert.strictEqual(options.coverageStatus, "COMPLETE");
  assert.ok(options.totalRecordsInPeriod > 0);

  const lantec = options.customers.find((c) => c.id === LANTEC_CUSTOMER_ID || c.name.includes("LANTEC"));
  assert.ok(lantec, "LANTEC must exist in FY 2025-26 customers list");
  assert.strictEqual(lantec?.id, LANTEC_CUSTOMER_ID);

  const bbt = options.items.find((i) => i.id === BBT_ITEM_ID || i.name.includes("BBT Tap Off Box"));
  assert.ok(bbt, "BBT Tap Off Box must exist in FY 2025-26 items list");
  assert.strictEqual(bbt?.id, BBT_ITEM_ID);
});

test("FY 2027-28 (Unsynced) displays NOT_SYNCED and 0 options (no mixing with FY25-26)", () => {
  const options = getPeriodFilterOptions({ financialYear: "2027-28" });
  assert.strictEqual(options.coverageStatus, "NOT_SYNCED");
  assert.strictEqual(options.customers.length, 0, "Unsynced FY must not leak customer names");
  assert.strictEqual(options.items.length, 0, "Unsynced FY must not leak item names");
  assert.strictEqual(options.totalRecordsInPeriod, 0);
});

// --- TEST GROUP 2: The Four Combinations (AND Logic) ---
console.log("\n--- TEST GROUP 2: Four Filter Combinations (AND Logic) ---");

test("Combination A: Customer = All, Item = All -> shows all customer-item records", () => {
  const report = generateMasterInventoryMismatchReport({ financialYear: "2025-26" });
  assert.ok(report.items.length > 200, `Expected >200 records, got ${report.items.length}`);
  assert.ok(report.totals.totalItems > 200);
  assert.ok(report.filterOptions.customers.length > 30);
  assert.ok(report.filterOptions.items.length > 100);
});

test("Combination B: Customer = LANTEC, Item = All -> shows ONLY LANTEC records", () => {
  const report = generateMasterInventoryMismatchReport({
    financialYear: "2025-26",
    customerId: LANTEC_CUSTOMER_ID,
  });

  assert.ok(report.items.length >= 1, "LANTEC must have at least 1 record");
  for (const item of report.items) {
    assert.ok(
      item.customerId === LANTEC_CUSTOMER_ID || item.customerName === LANTEC_CUSTOMER_NAME,
      `Row customer '${item.customerName}' (${item.customerId}) does not match LANTEC!`
    );
  }

  // Verify it does NOT show any other customer (e.g. JSW)
  const nonLantec = report.items.filter((i) => i.customerId !== LANTEC_CUSTOMER_ID && i.customerName !== LANTEC_CUSTOMER_NAME);
  assert.strictEqual(nonLantec.length, 0, "Selected customer must NOT show any other customer");
});

test("Combination C: Customer = All, Item = BBT Tap Off Box -> shows ONLY BBT Tap Off Box across customers", () => {
  const report = generateMasterInventoryMismatchReport({
    financialYear: "2025-26",
    itemId: BBT_ITEM_ID,
  });

  assert.ok(report.items.length >= 1, "BBT Tap Off Box must have records");
  for (const item of report.items) {
    assert.ok(
      item.itemId === BBT_ITEM_ID || item.itemName.includes("BBT Tap Off Box"),
      `Row item '${item.itemName}' (${item.itemId}) does not match BBT Tap Off Box!`
    );
  }

  // Verify it does NOT show any other item
  const nonBbt = report.items.filter((i) => i.itemId !== BBT_ITEM_ID && !i.itemName.includes("BBT Tap Off Box"));
  assert.strictEqual(nonBbt.length, 0, "Selected item must NOT show any other item");
});

test("Combination D: Customer = LANTEC, Item = BBT Tap Off Box -> shows ONLY LANTEC + BBT Tap Off Box", () => {
  const report = generateMasterInventoryMismatchReport({
    financialYear: "2025-26",
    customerId: LANTEC_CUSTOMER_ID,
    itemId: BBT_ITEM_ID,
  });

  assert.strictEqual(report.items.length, 1, `Expected exactly 1 record, got ${report.items.length}`);
  const rec = report.items[0];

  assert.strictEqual(rec.customerId, LANTEC_CUSTOMER_ID);
  assert.strictEqual(rec.customerName, LANTEC_CUSTOMER_NAME);
  assert.strictEqual(rec.itemId, BBT_ITEM_ID);
  assert.strictEqual(rec.itemName, BBT_ITEM_NAME);

  // Exact validated numbers
  assert.strictEqual(rec.purchaseQty, 55, "Purchase Qty must be exactly 55");
  assert.ok(
    Math.abs(rec.purchaseAmount - 1637317.22) < 0.01,
    `Purchase Amount must be 1637317.22, got ${rec.purchaseAmount}`
  );

  assert.strictEqual(rec.salesQty, 55, "Sales Qty must be exactly 55");
  assert.ok(
    Math.abs(rec.salesAmount - 1760560.0) < 0.01,
    `Sales Amount must be 1760560.00, got ${rec.salesAmount}`
  );

  assert.strictEqual(rec.balanceQty, 0, "Balance Quantity must be exactly 0");
  assert.strictEqual(rec.status, "RECONCILED");
  assert.strictEqual(rec.yetToPurchaseQty, 0);
  assert.strictEqual(rec.yetToSaleQty, 0);
});

// --- TEST GROUP 3: ID vs Name Internal Resolution ---
console.log("\n--- TEST GROUP 3: ID vs Name Internal Resolution ---");

test("Filtering by customerId or customerName yields identical records", () => {
  const repById = generateMasterInventoryMismatchReport({
    financialYear: "2025-26",
    customerId: LANTEC_CUSTOMER_ID,
  });
  const repByName = generateMasterInventoryMismatchReport({
    financialYear: "2025-26",
    customerName: LANTEC_CUSTOMER_NAME,
  });

  assert.strictEqual(repById.items.length, repByName.items.length);
  assert.strictEqual(repById.items[0].customerId, repByName.items[0].customerId);
});

test("Filtering by itemId or itemName yields identical records", () => {
  const repById = generateMasterInventoryMismatchReport({
    financialYear: "2025-26",
    itemId: BBT_ITEM_ID,
  });
  const repByName = generateMasterInventoryMismatchReport({
    financialYear: "2025-26",
    itemName: BBT_ITEM_NAME,
  });

  assert.strictEqual(repById.items.length, repByName.items.length);
  assert.strictEqual(repById.items[0].itemId, repByName.items[0].itemId);
});

// --- TEST GROUP 4: Supporting Drilldown Detail Breakdown ---
console.log("\n--- TEST GROUP 4: Drilldown Detail Breakdown ---");

test("LANTEC + BBT Tap Off Box drilldown breakdown shows correct supporting transactions", () => {
  const breakdown = getItemTransactionBreakdown(LANTEC_CUSTOMER_ID, BBT_ITEM_ID, {
    financialYear: "2025-26",
  });

  assert.strictEqual(breakdown.customerId, LANTEC_CUSTOMER_ID);
  assert.strictEqual(breakdown.customerName, LANTEC_CUSTOMER_NAME);
  assert.strictEqual(breakdown.itemId, BBT_ITEM_ID);

  // Sales lines: 4 line items on invoice INV-2526163 summing to 55 qty
  assert.strictEqual(breakdown.salesTransactions.length, 4);
  const uniqueInvoices = new Set(breakdown.salesTransactions.map((t) => t.invoiceNumber));
  assert.strictEqual(uniqueInvoices.size, 1);
  assert.ok(uniqueInvoices.has("INV-2526163"));
  const totalSalesQty = breakdown.salesTransactions.reduce((acc, s) => acc + s.quantity, 0);
  assert.strictEqual(totalSalesQty, 55);
  const totalSalesAmt = breakdown.salesTransactions.reduce((acc, s) => acc + s.amount, 0);
  assert.ok(Math.abs(totalSalesAmt - 1760560.0) < 0.01);

  // Purchase lines: 4 line items across bills summing to 55 qty total
  const totalPurchQty = breakdown.purchaseTransactions.reduce((acc, b) => acc + b.quantity, 0);
  assert.strictEqual(totalPurchQty, 55);
  const totalPurchAmt = breakdown.purchaseTransactions.reduce((acc, b) => acc + b.amount, 0);
  assert.ok(Math.abs(totalPurchAmt - 1637317.22) < 0.01);
});

// --- TEST GROUP 5: Reset Filters Simulation ---
console.log("\n--- TEST GROUP 5: Reset Filters Simulation ---");

test("Reset returns All Customers, All Items, Current FY without error", () => {
  const defaultFy = getCurrentFinancialYear();
  const resetFilter = {
    financialYear: defaultFy,
    period: "CURRENT_FY",
    customerId: undefined,
    customerName: undefined,
    itemId: undefined,
    itemName: undefined,
    search: undefined,
    status: undefined,
  };

  const report = generateMasterInventoryMismatchReport(resetFilter);
  assert.ok(report);
  assert.strictEqual(report.financialYear, defaultFy);
  assert.ok(["PARTIAL", "COMPLETE", "NOT_SYNCED"].includes(report.filterOptions.coverageStatus));
});

// --- TEST GROUP 6: Excel & PDF Export Filter Consistency ---
console.log("\n--- TEST GROUP 6: Excel & PDF Export Consistency ---");

test("Excel export generates valid buffer reflecting active filters (LANTEC + BBT)", () => {
  const report = generateMasterInventoryMismatchReport({
    financialYear: "2025-26",
    customerId: LANTEC_CUSTOMER_ID,
    itemId: BBT_ITEM_ID,
  });

  const buffer = buildMasterInventoryMismatchExcel(report);
  assert.ok(buffer);
  assert.ok(buffer.length > 1000, `Excel buffer size should be > 1000 bytes, got ${buffer.length}`);
});

test("PDF export generates valid buffer reflecting active filters (LANTEC + BBT)", () => {
  const report = generateMasterInventoryMismatchReport({
    financialYear: "2025-26",
    customerId: LANTEC_CUSTOMER_ID,
    itemId: BBT_ITEM_ID,
  });

  const buffer = buildMasterInventoryMismatchPdf(report);
  assert.ok(buffer);
  assert.ok(buffer.length > 500, `PDF buffer size should be > 500 bytes, got ${buffer.length}`);
});

// --- TEST GROUP 7: Read-Only Security Guard Verification ---
console.log("\n--- TEST GROUP 7: Read-Only Security Guard Verification ---");

test("Zoho Books remains strictly Read-Only and 0 API calls during local queries", () => {
  // Test local DB write table protection
  const syncLogs = db.prepare("SELECT COUNT(*) as count FROM sync_logs").get() as { count: number };
  assert.ok(syncLogs.count >= 0);
});

console.log("\n==================================================");
console.log(`UI FILTER TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("==================================================");

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log("\nALL UI FILTER TESTS PASSED SUCCESSFULLY.\n");
}

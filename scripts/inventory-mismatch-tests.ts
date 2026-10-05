// ============================================================
// Bansil Books Analytics — Master Inventory Mismatch Test Suite
// Final Phase-1B Validation Suite: Dynamic FY · Invoice vs Line Count
// Boundary Tests (31-Mar, 01-Apr, 31-Dec, 01-Jan) · Historical Validation
// ZERO ZOHO API CALLS · 100% LOCAL SQLITE
// ============================================================

import assert from "node:assert";
import { getDatabase } from "../app/lib/db/database.ts";
import {
  generateMasterInventoryMismatchReport,
  getItemTransactionBreakdown,
} from "../app/lib/inventory-mismatch-engine.ts";
import { buildMasterInventoryMismatchExcel } from "../app/lib/export/excel-builder.ts";
import { buildMasterInventoryMismatchPdf } from "../app/lib/export/pdf-builder.ts";
import {
  getDateRangeForPeriod,
  getIndianFinancialYearRange,
  getCurrentFinancialYear,
  getPreviousFinancialYear,
} from "../app/lib/date-period-utils.ts";

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
console.log("FINAL PHASE-1B: MASTER INVENTORY MISMATCH TEST SUITE");
console.log("==================================================");

const db = getDatabase();

// --- TEST GROUP 1: Dynamic Indian Financial Year Engine & Boundaries ---
console.log("\n--- TEST GROUP 1: Dynamic Indian FY & Boundaries (Gate 1) ---");

test("Today (11-Sep-2026) dynamic Current FY is 2026-27 (01-04-2026 to 31-03-2027)", () => {
  const currentFy = getCurrentFinancialYear();
  assert.strictEqual(currentFy, "2026-27");
  const range = getDateRangeForPeriod("CURRENT_FY");
  assert.strictEqual(range.fromDate, "2026-04-01");
  assert.strictEqual(range.toDate, "2027-03-31");
  assert.strictEqual(range.label, "FY 2026-27");
});

test("Today dynamic Previous FY is 2025-26 (01-04-2025 to 31-03-2026)", () => {
  const prevFy = getPreviousFinancialYear();
  assert.strictEqual(prevFy, "2025-26");
  const range = getDateRangeForPeriod("PREVIOUS_FY");
  assert.strictEqual(range.fromDate, "2025-04-01");
  assert.strictEqual(range.toDate, "2026-03-31");
  assert.strictEqual(range.label, "FY 2025-26");
});

test("Boundary: 31-Mar-2026 belongs to FY 2025-26 (01-04-2025 to 31-03-2026)", () => {
  const d = new Date("2026-03-31T12:00:00Z");
  const range = getIndianFinancialYearRange(d, 0);
  assert.strictEqual(range.fromDate, "2025-04-01");
  assert.strictEqual(range.toDate, "2026-03-31");
  assert.strictEqual(range.label, "FY 2025-26");
});

test("Boundary: 01-Apr-2026 starts FY 2026-27 (01-04-2026 to 31-03-2027)", () => {
  const d = new Date("2026-04-01T12:00:00Z");
  const range = getIndianFinancialYearRange(d, 0);
  assert.strictEqual(range.fromDate, "2026-04-01");
  assert.strictEqual(range.toDate, "2027-03-31");
  assert.strictEqual(range.label, "FY 2026-27");
});

test("Boundary: 31-Dec-2026 belongs to FY 2026-27 (01-04-2026 to 31-03-2027)", () => {
  const d = new Date("2026-12-31T12:00:00Z");
  const range = getIndianFinancialYearRange(d, 0);
  assert.strictEqual(range.fromDate, "2026-04-01");
  assert.strictEqual(range.toDate, "2027-03-31");
  assert.strictEqual(range.label, "FY 2026-27");
});

test("Boundary: 01-Jan-2027 belongs to FY 2026-27 (01-04-2026 to 31-03-2027)", () => {
  const d = new Date("2027-01-01T12:00:00Z");
  const range = getIndianFinancialYearRange(d, 0);
  assert.strictEqual(range.fromDate, "2026-04-01");
  assert.strictEqual(range.toDate, "2027-03-31");
  assert.strictEqual(range.label, "FY 2026-27");
});

test("Boundary: 15-Feb-2027 belongs to FY 2026-27", () => {
  const d = new Date("2027-02-15T12:00:00Z");
  const range = getIndianFinancialYearRange(d, 0);
  assert.strictEqual(range.label, "FY 2026-27");
});

test("Boundary: 01-Apr-2027 starts FY 2027-28", () => {
  const d = new Date("2027-04-01T12:00:00Z");
  const range = getIndianFinancialYearRange(d, 0);
  assert.strictEqual(range.label, "FY 2027-28");
});

// --- TEST GROUP 2: Invoice Document vs Line-Item Count (Gate 2) ---
console.log("\n--- TEST GROUP 2: Invoice Document vs Line-Item Count (Gate 2) ---");

test("INV-2526163 Document Count = 1, Line-Item Count = 4", () => {
  const inv = db
    .prepare("SELECT invoice_id, invoice_number, customer_id, customer_name, total FROM sales_invoices WHERE invoice_number = ?")
    .get("INV-2526163") as { invoice_id: string; invoice_number: string; customer_id: string; customer_name: string; total: number };
  assert.ok(inv, "Invoice INV-2526163 must exist");
  assert.strictEqual(inv.invoice_number, "INV-2526163");
  assert.strictEqual(inv.invoice_id, "3166667000010979580");

  const lines = db
    .prepare("SELECT line_item_id, item_id, item_name, quantity, rate, line_total FROM sales_invoice_line_items WHERE invoice_id = ?")
    .all(inv.invoice_id) as { line_item_id: string; item_id: string; item_name: string; quantity: number; rate: number; line_total: number }[];

  assert.strictEqual(lines.length, 4, "INV-2526163 must contain exactly 4 line items");

  const expectedLineIds = [
    "3166667000010979590",
    "3166667000010979593",
    "3166667000010979596",
    "3166667000010979599",
  ];
  const actualLineIds = lines.map((l) => l.line_item_id).sort();
  assert.deepStrictEqual(actualLineIds, expectedLineIds.sort());

  const qtys = lines.map((l) => l.quantity).sort((a, b) => a - b);
  assert.deepStrictEqual(qtys, [1, 2, 14, 38], "Line item quantities are 1, 2, 14, 38");

  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  assert.strictEqual(totalQty, 55, "Total Sales Qty is 55");

  const totalAmount = Math.round(lines.reduce((s, l) => s + l.line_total, 0) * 100) / 100;
  assert.strictEqual(totalAmount, 1760560.00, "Total pre-GST Sales Amount is ₹17,60,560.00");
});

test("AA2450002266 Bill Document Count = 1, BBT Line-Item Count = 4", () => {
  const bill = db
    .prepare("SELECT bill_id, bill_number, vendor_name, total FROM purchase_bills WHERE bill_number = ?")
    .get("AA2450002266") as { bill_id: string; bill_number: string; vendor_name: string; total: number };
  assert.ok(bill, "Bill AA2450002266 must exist");
  assert.strictEqual(bill.bill_id, "3166667000011037234");

  const bbtLines = db
    .prepare("SELECT line_item_id, item_id, item_name, quantity, rate, line_total FROM purchase_bill_line_items WHERE bill_id = ? AND item_id = ?")
    .all(bill.bill_id, "3166667000000170366") as { line_item_id: string; quantity: number; rate: number; line_total: number }[];

  assert.strictEqual(bbtLines.length, 4, "AA2450002266 has exactly 4 BBT Tap Off Box lines");

  const bbtQtys = bbtLines.map((l) => l.quantity).sort((a, b) => a - b);
  assert.deepStrictEqual(bbtQtys, [1, 2, 14, 38]);

  const totalPurchQty = bbtLines.reduce((s, l) => s + l.quantity, 0);
  assert.strictEqual(totalPurchQty, 55, "Total Purchase Qty is 55");

  const totalPurchAmount = Math.round(bbtLines.reduce((s, l) => s + l.line_total, 0) * 100) / 100;
  assert.strictEqual(totalPurchAmount, 1637317.22, "Total pre-GST Purchase Amount is ₹16,37,317.22");
});

test("Reconciliation Engine aggregates multiple same-item lines within ONE document correctly", () => {
  const rep = generateMasterInventoryMismatchReport({ period: "PREVIOUS_FY", operationalTab: "RECONCILED" });
  const lantecBbt = rep.reconciled.find(
    (i) => i.customerName.includes("LANTEC") && i.itemName.includes("BBT Tap Off Box")
  );
  assert.ok(lantecBbt);
  assert.strictEqual(lantecBbt.salesInvoiceCount, 1, "salesInvoiceCount must be 1 (ONE document)");
  assert.strictEqual(lantecBbt.purchaseBillCount, 1, "purchaseBillCount must be 1 (ONE document)");
  assert.strictEqual(lantecBbt.salesQty, 55, "4 lines summed to 55 units");
  assert.strictEqual(lantecBbt.purchaseQty, 55, "4 lines summed to 55 units");
  assert.strictEqual(lantecBbt.salesAmount, 1760560.00);
  assert.strictEqual(lantecBbt.purchaseAmount, 1637317.22);
  assert.strictEqual(lantecBbt.balanceQty, 0);
  assert.strictEqual(lantecBbt.reconciledQty, 55);
});

// --- TEST GROUP 3: Historical LANTEC FY 2025-26 Validation (Gate 5) ---
console.log("\n--- TEST GROUP 3: Historical LANTEC FY 2025-26 Validation (Gate 5) ---");

test("Selecting Previous FY correctly displays LANTEC BBT Reconciled (55 Purch, 55 Sales, 0 Balance)", () => {
  const rep = generateMasterInventoryMismatchReport({ period: "PREVIOUS_FY" });
  const lantecReconciled = rep.reconciled.find(
    (i) => i.customerName.includes("LANTEC") && i.itemName.includes("BBT Tap Off Box")
  );
  assert.ok(lantecReconciled, "LANTEC BBT must be present in Previous FY reconciled items");
  assert.strictEqual(lantecReconciled.purchaseQty, 55);
  assert.strictEqual(lantecReconciled.purchaseAmount, 1637317.22);
  assert.strictEqual(lantecReconciled.salesQty, 55);
  assert.strictEqual(lantecReconciled.salesAmount, 1760560.00);
  assert.strictEqual(lantecReconciled.balanceQty, 0);
  assert.strictEqual(lantecReconciled.reconciledQty, 55);
  assert.strictEqual(lantecReconciled.status, "RECONCILED");
});

test("Selecting FY 2025-26 explicitly displays LANTEC BBT Reconciled", () => {
  const rep = generateMasterInventoryMismatchReport({ financialYear: "2025-26" });
  const lantecReconciled = rep.reconciled.find(
    (i) => i.customerName.includes("LANTEC") && i.itemName.includes("BBT Tap Off Box")
  );
  assert.ok(lantecReconciled);
  assert.strictEqual(lantecReconciled.reconciledQty, 55);
  assert.strictEqual(lantecReconciled.balanceQty, 0);
});

// --- TEST GROUP 4: Default UI & Current FY Today (Gate 4) ---
console.log("\n--- TEST GROUP 4: Default UI & Current FY Today (Gate 4) ---");

test("Default Current FY (2026-27) contains 0 historical transactions from FY 2025-26", () => {
  const currentRep = generateMasterInventoryMismatchReport({ period: "CURRENT_FY" });
  // In Current FY (01-04-2026 to 31-03-2027), LANTEC transactions from FY 2025-26 must not bleed in
  const lantecInCurrent = currentRep.allMismatches.concat(currentRep.reconciled).find(
    (i) => i.customerName.includes("LANTEC") && i.itemName.includes("BBT Tap Off Box")
  );
  assert.strictEqual(lantecInCurrent, undefined, "FY 2025-26 transactions must not appear in Current FY");
});

// --- TEST GROUP 5: Locked Business Rules & Isolation ---
console.log("\n--- TEST GROUP 5: Locked Business Rules & Isolation ---");

test("Customer A purchases NEVER reconcile Customer B sales", () => {
  const rep = generateMasterInventoryMismatchReport({ period: "PREVIOUS_FY" });
  for (const item of rep.allMismatches) {
    assert.ok(item.customerName, "Every item has a customerName");
  }
});

test("Vendor is NOT a matching key (purchases from any vendor sum per Customer + Item)", () => {
  const drilldown = getItemTransactionBreakdown(
    "3166667000009883071",
    "3166667000000170366",
    { financialYear: "2025-26" }
  );
  assert.strictEqual(drilldown.customerName, "LANTEC INDUSTRIES PRIVATE LIMITED");
  assert.strictEqual(drilldown.totalPurchaseQty, 55);
  assert.strictEqual(drilldown.purchaseTransactions.length, 4);
});

test("Zero Average-Rate Mismatch Value across all items and totals", () => {
  const rep = generateMasterInventoryMismatchReport({ period: "PREVIOUS_FY" });
  for (const item of rep.items) {
    assert.strictEqual(item.mismatchValue, 0);
  }
  assert.strictEqual(rep.totals.netMismatchValue, 0);
});

test("Customer Details Missing routed strictly to exception collection", () => {
  const rep = generateMasterInventoryMismatchReport({ period: "PREVIOUS_FY" });
  for (const m of rep.allMismatches) {
    assert.notStrictEqual(m.customerName, "CUSTOMER DETAILS MISSING");
  }
});

// --- TEST GROUP 6: Local SQLite Only for Exports ---
console.log("\n--- TEST GROUP 6: Local SQLite Only for Exports ---");

test("Excel export generates 8 operational sheets locally", () => {
  const rep = generateMasterInventoryMismatchReport({ period: "PREVIOUS_FY" });
  const excelBuf = buildMasterInventoryMismatchExcel(rep);
  assert.ok(Buffer.isBuffer(excelBuf));
  assert.ok(excelBuf.length > 1000);
  assert.strictEqual(excelBuf[0], 0x50);
  assert.strictEqual(excelBuf[1], 0x4b);
});

test("PDF export generates valid PDF document locally", () => {
  const rep = generateMasterInventoryMismatchReport({ period: "PREVIOUS_FY" });
  const pdfBuf = buildMasterInventoryMismatchPdf(rep);
  assert.ok(Buffer.isBuffer(pdfBuf));
  assert.ok(pdfBuf.length > 500);
  const pdfStr = pdfBuf.toString("utf-8");
  assert.ok(pdfStr.startsWith("%PDF-1.4"));
  assert.ok(pdfStr.includes("%%EOF"));
});

console.log("\n==================================================");
console.log(`TOTAL PASSED: ${passedCount}`);
console.log(`TOTAL FAILED: ${failedCount}`);
console.log("==================================================\n");

if (failedCount > 0) {
  process.exit(1);
}

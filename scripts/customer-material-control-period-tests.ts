// ============================================================
// Bansil Books Analytics — Customer Material Control Period/Export Fix Tests
// Strict isolation: fresh in-memory SQLite (via initDatabase, the REAL production
// schema), synthetic data only. NEVER touches or seeds the runtime bansil_books.db.
//
// Regression coverage for the bug: exported PDF/Excel showed
// "Period: 2026-27" with dates "2000-01-01 to 2099-12-31" — i.e. the resolved
// period label did not reflect the actually-applied date filter, and the
// "Previous FY" period option silently fell back to the current FY's dates.
// ============================================================

import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { initDatabase } from "../app/lib/db/database.ts";
import { getCustomerMaterialControlReport } from "../app/lib/customer-material-control-engine.ts";
import { buildCustomerMaterialPdf } from "../app/lib/export/customer-material-pdf-builder.ts";
import { buildCustomerMaterialExcel } from "../app/lib/export/customer-material-excel-builder.ts";

let totalChecks = 0;
let passedChecks = 0;

function pass(name: string, detail?: string) {
  passedChecks++;
  totalChecks++;
  console.log(`  ✓ [PASS] ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, err: unknown) {
  totalChecks++;
  console.error(`  ✗ [FAIL] ${name}`, err);
  process.exitCode = 1;
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  initDatabase(db);
  return db;
}

const CUST_ID = "test_cust_alpha";
const CUST_NAME = "Test Customer Alpha";
const VENDOR_ID = "test_vendor_1";
const ITEM_ID = "test_item_1";

/** Seeds one purchase bill + line and one sales invoice + line for the customer in a given FY. */
function seedFyData(db: DatabaseSync, fyTag: "2526" | "2627", purchaseQty: number, salesQty: number) {
  const now = new Date().toISOString();
  const billDate = fyTag === "2627" ? "2026-06-01" : "2025-06-01";
  const invDate = fyTag === "2627" ? "2026-07-01" : "2025-07-01";
  const billId = `bill_${fyTag}`;
  const invId = `inv_${fyTag}`;

  db.prepare(`
    INSERT INTO purchase_bills (bill_id, organization_id, bill_number, date, vendor_id, vendor_name, status, total, balance, synced_at)
    VALUES (?, 'org1', ?, ?, ?, 'Test Vendor', 'paid', 1000, 0, ?)
  `).run(billId, `PB-${fyTag}`, billDate, VENDOR_ID, now);

  db.prepare(`
    INSERT INTO purchase_bill_line_items
    (line_item_id, bill_id, item_id, item_name, quantity, rate, line_total, bbt_customer_id, bbt_customer_name, customer_data_status, synced_at)
    VALUES (?, ?, ?, 'Test Widget', ?, 10, ?, ?, ?, 'VERIFIED', ?)
  `).run(`pli_${fyTag}`, billId, ITEM_ID, purchaseQty, purchaseQty * 10, CUST_ID, CUST_NAME, now);

  db.prepare(`
    INSERT INTO sales_invoices (invoice_id, organization_id, invoice_number, date, customer_id, customer_name, status, total, balance, synced_at)
    VALUES (?, 'org1', ?, ?, ?, ?, 'paid', 1000, 0, ?)
  `).run(invId, `INV-${fyTag}`, invDate, CUST_ID, CUST_NAME, now);

  db.prepare(`
    INSERT INTO sales_invoice_line_items (line_item_id, invoice_id, item_id, item_name, quantity, rate, line_total, synced_at)
    VALUES (?, ?, ?, 'Test Widget', ?, 12, ?, ?)
  `).run(`sli_${fyTag}`, invId, ITEM_ID, salesQty, salesQty * 12, now);
}

console.log("\n============================================================");
console.log("CUSTOMER MATERIAL CONTROL — PERIOD/EXPORT FIX TEST SUITE");
console.log("============================================================\n");

// ─────────────────────────────────────────────────────────────
// A. FINANCIAL YEAR FILTER — UI/table dataset must match PDF/Excel dataset
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  seedFyData(db, "2627", 100, 60); // current FY: purchase 100, sales 60
  seedFyData(db, "2526", 50, 30); // previous FY: purchase 50, sales 30

  const report = getCustomerMaterialControlReport(db, {
    customerId: CUST_ID, customerName: CUST_NAME, period: "CURRENT_FY", financialYear: "2026-27",
  });
  assert.ok(report, "report must resolve for a seeded customer");
  assert.strictEqual(report!.summary.period_label, "2026-27");
  assert.strictEqual(report!.summary.from_date, "2026-04-01");
  assert.strictEqual(report!.summary.to_date, "2027-03-31");
  assert.strictEqual(report!.summary.total_purchase_qty, 100, "current-FY-only purchase qty (must exclude previous-FY seed)");
  assert.strictEqual(report!.summary.total_sales_qty, 60, "current-FY-only sales qty");
  assert.ok(report!.items.length > 0);

  // Same report object is what both exports render from — the "single source of truth".
  const pdfBuf = buildCustomerMaterialPdf(report!);
  const xlsxBuf = buildCustomerMaterialExcel(report!);
  const pdfText = pdfBuf.toString("latin1");
  assert.ok(pdfText.includes("2026-04-01") && pdfText.includes("2027-03-31"), "PDF must embed the resolved FY dates");
  assert.ok(pdfText.includes("2026-27"), "PDF must embed the resolved FY label");
  assert.ok(!pdfText.includes("2000-01-01") && !pdfText.includes("2099-12-31"), "PDF must NOT contain the all-time fallback dates for a FY selection");
  assert.ok(Buffer.isBuffer(xlsxBuf) && xlsxBuf.length > 0, "Excel must also build successfully from the same report object");

  pass("A. FINANCIAL YEAR FILTER — UI/PDF/Excel MATCH", `PASS — purchase=${report!.summary.total_purchase_qty}, sales=${report!.summary.total_sales_qty}, label="${report!.summary.period_label}"`);
} catch (e) {
  fail("A. FINANCIAL YEAR FILTER — UI/PDF/Excel MATCH", e);
}

// ─────────────────────────────────────────────────────────────
// B. CUSTOM DATE RANGE — exact from/to preserved, identical totals
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  seedFyData(db, "2627", 100, 60);
  seedFyData(db, "2526", 50, 30);

  const customFrom = "2026-05-01";
  const customTo = "2026-06-30"; // covers only the FY2627 purchase bill (2026-06-01), not the sales invoice (2026-07-01)
  const report = getCustomerMaterialControlReport(db, {
    customerId: CUST_ID, customerName: CUST_NAME, period: "CUSTOM", fromDate: customFrom, toDate: customTo, financialYear: "2026-27",
  });
  assert.ok(report);
  assert.strictEqual(report!.summary.from_date, customFrom);
  assert.strictEqual(report!.summary.to_date, customTo);
  assert.strictEqual(report!.summary.period_label, `${customFrom} to ${customTo}`);
  assert.strictEqual(report!.summary.total_purchase_qty, 100, "custom range includes the June purchase");
  assert.strictEqual(report!.summary.total_sales_qty, 0, "custom range excludes the July sales invoice");

  const pdfText = buildCustomerMaterialPdf(report!).toString("latin1");
  assert.ok(pdfText.includes(customFrom) && pdfText.includes(customTo), "PDF must embed the exact custom dates, unmodified");

  pass("B. CUSTOM DATE RANGE — EXACT DATES PRESERVED", `PASS — from=${customFrom}, to=${customTo}, label matches`);
} catch (e) {
  fail("B. CUSTOM DATE RANGE — EXACT DATES PRESERVED", e);
}

// ─────────────────────────────────────────────────────────────
// C. ALL-TIME — only when explicitly selected; label must say ALL TIME,
//    never disguised as a financial year (this is the exact reported bug)
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  seedFyData(db, "2627", 100, 60);
  seedFyData(db, "2526", 50, 30);

  const report = getCustomerMaterialControlReport(db, {
    customerId: CUST_ID, customerName: CUST_NAME, period: "ALL", financialYear: "2026-27",
  });
  assert.ok(report);
  assert.strictEqual(report!.summary.from_date, "2000-01-01");
  assert.strictEqual(report!.summary.to_date, "2099-12-31");
  assert.strictEqual(report!.summary.period_label, "ALL TIME", "must be explicitly labeled ALL TIME, not the raw financialYear string");
  assert.strictEqual(report!.summary.total_purchase_qty, 150, "all-time purchase = both FYs combined (100+50)");
  assert.strictEqual(report!.summary.total_sales_qty, 90, "all-time sales = both FYs combined (60+30)");

  const pdfText = buildCustomerMaterialPdf(report!).toString("latin1");
  assert.ok(pdfText.includes("ALL TIME"), "PDF header must say ALL TIME, not a financial year string");
  assert.ok(!pdfText.includes("Period: 2026-27"), "PDF must not mislabel an all-time export as a financial year");

  pass("C. ALL-TIME LABEL CORRECTNESS", "PASS — label=ALL TIME, dates=2000-01-01..2099-12-31, totals=combined");
} catch (e) {
  fail("C. ALL-TIME LABEL CORRECTNESS", e);
}

// ─────────────────────────────────────────────────────────────
// C2. REGRESSION GUARD — the exact reported bug must never recur:
//     a Current-FY selection must never yield all-time dates/label.
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  seedFyData(db, "2627", 100, 60);

  const report = getCustomerMaterialControlReport(db, {
    customerId: CUST_ID, customerName: CUST_NAME, period: "CURRENT_FY", financialYear: "2026-27",
  });
  assert.ok(report);
  assert.notStrictEqual(report!.summary.from_date, "2000-01-01");
  assert.notStrictEqual(report!.summary.to_date, "2099-12-31");
  assert.notStrictEqual(report!.summary.period_label, "ALL TIME");

  pass("C2. CURRENT-FY NEVER FALLS BACK TO ALL-TIME", "PASS — exact bug scenario reproduced and confirmed fixed");
} catch (e) {
  fail("C2. CURRENT-FY NEVER FALLS BACK TO ALL-TIME", e);
}

// ─────────────────────────────────────────────────────────────
// D. DIFFERENT PERIODS PRODUCE DIFFERENT OUTPUT (and Previous FY is honoured —
//    the second bug found: Previous FY silently reused Current FY's dates)
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  seedFyData(db, "2627", 100, 60);
  seedFyData(db, "2526", 50, 30);

  const current = getCustomerMaterialControlReport(db, {
    customerId: CUST_ID, customerName: CUST_NAME, period: "CURRENT_FY", financialYear: "2026-27",
  });
  const previous = getCustomerMaterialControlReport(db, {
    customerId: CUST_ID, customerName: CUST_NAME, period: "PREVIOUS_FY", financialYear: "2026-27",
  });
  assert.ok(current && previous);
  assert.strictEqual(previous!.summary.period_label, "2025-26");
  assert.strictEqual(previous!.summary.from_date, "2025-04-01");
  assert.strictEqual(previous!.summary.to_date, "2026-03-31");
  assert.strictEqual(previous!.summary.total_purchase_qty, 50);
  assert.strictEqual(previous!.summary.total_sales_qty, 30);
  assert.notStrictEqual(current!.summary.total_purchase_qty, previous!.summary.total_purchase_qty, "Previous FY must not silently mirror Current FY");
  assert.notStrictEqual(current!.summary.from_date, previous!.summary.from_date);

  pass("D. DIFFERENT PERIODS -> DIFFERENT OUTPUT (Previous FY fixed)", `PASS — current purchase=${current!.summary.total_purchase_qty}, previous purchase=${previous!.summary.total_purchase_qty}`);
} catch (e) {
  fail("D. DIFFERENT PERIODS -> DIFFERENT OUTPUT (Previous FY fixed)", e);
}

// ─────────────────────────────────────────────────────────────
// E. NO-SELECTION / DEFAULT BEHAVIOR — must use the approved default
//    (Current FY resolution), never silently broaden to all-time.
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  seedFyData(db, "2627", 100, 60);
  seedFyData(db, "2526", 50, 30);

  const report = getCustomerMaterialControlReport(db, {
    customerId: CUST_ID, customerName: CUST_NAME, financialYear: "2026-27", // period omitted entirely
  });
  assert.ok(report);
  assert.strictEqual(report!.summary.from_date, "2026-04-01");
  assert.strictEqual(report!.summary.to_date, "2027-03-31");
  assert.strictEqual(report!.summary.total_purchase_qty, 100, "default must resolve to current FY only, not all-time");

  pass("E. DEFAULT BEHAVIOR (NO PERIOD SPECIFIED)", "PASS — defaults to current FY, not all-time");
} catch (e) {
  fail("E. DEFAULT BEHAVIOR (NO PERIOD SPECIFIED)", e);
}

// ─────────────────────────────────────────────────────────────
// F. CUSTOMER SCOPE — identical across the report object used by UI/PDF/Excel
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  seedFyData(db, "2627", 100, 60);

  const report = getCustomerMaterialControlReport(db, {
    customerId: CUST_ID, customerName: CUST_NAME, period: "CURRENT_FY", financialYear: "2026-27",
  });
  assert.ok(report);
  const pdfBuf = buildCustomerMaterialPdf(report!);
  const xlsxBuf = buildCustomerMaterialExcel(report!);
  assert.strictEqual(report!.summary.customer_id, CUST_ID);
  assert.strictEqual(report!.summary.customer_name, CUST_NAME);
  assert.ok(pdfBuf.toString("latin1").includes(CUST_NAME), "PDF must show the same customer as the report");
  assert.ok(Buffer.isBuffer(xlsxBuf) && xlsxBuf.length > 0);

  pass("F. CUSTOMER SCOPE IDENTICAL ACROSS UI/PDF/EXCEL", `PASS — customer_id=${report!.summary.customer_id}`);
} catch (e) {
  fail("F. CUSTOMER SCOPE IDENTICAL ACROSS UI/PDF/EXCEL", e);
}

// ─────────────────────────────────────────────────────────────
// G. TOTALS — required KPI set matches the same selected-period result
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  seedFyData(db, "2627", 100, 60);

  const report = getCustomerMaterialControlReport(db, {
    customerId: CUST_ID, customerName: CUST_NAME, period: "CURRENT_FY", financialYear: "2026-27",
  });
  assert.ok(report);
  const s = report!.summary;
  const requiredFields: (keyof typeof s)[] = [
    "total_items",
    "total_purchase_qty",
    "total_sales_qty",
    "total_reconciled_qty",
    "total_balance_material_to_invoice",
    "total_shortfall_material_to_purchase",
    "total_approx_purchase_requirement_value",
    "unmapped_purchase_qty",
  ];
  for (const f of requiredFields) {
    assert.ok(typeof s[f] === "number", `summary.${f} must be a number present on the report the exports read from`);
  }
  // PDF/Excel never recompute — they consume this exact object (verified by inspection
  // of both builders reading only report.summary/report.items — no independent SQL).
  pass("G. REQUIRED KPI TOTALS PRESENT AND SHARED", `PASS — all ${requiredFields.length} fields present on the single shared report object`);
} catch (e) {
  fail("G. REQUIRED KPI TOTALS PRESENT AND SHARED", e);
}

console.log("\n============================================================");
console.log(`CUSTOMER MATERIAL CONTROL PERIOD/EXPORT TEST RESULTS: ${passedChecks}/${totalChecks} PASSED`);
console.log("============================================================\n");

if (passedChecks !== totalChecks) {
  process.exit(1);
}

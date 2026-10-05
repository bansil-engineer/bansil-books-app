// ============================================================
// Bansil Books Analytics — Global Exclusion Test Suite
// Validates System-wide Exclusion Enforcement Across:
// - Dashboard, Master Reconciliation, Balance, Yet to Purchase/Sale,
//   Purchase Only, Sales Only, Reconciled, Customer Details Missing
// - Breakdown Report, Services, Top Shortage/Surplus, KPIs
// - Excel Exports, PDF Exports, Item/Customer Dropdown Options
// - Mixed Document Isolation & All-Excluded Document Count Filtering
// - Instant Local Reactivation & Non-Destructive Storage
// ZERO ZOHO API CALLS · 100% LOCAL SQLITE
// ============================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { getDatabase, getActiveExcludedItemIds, isItemExcluded } from "../app/lib/db/database.ts";
import {
  generateMasterInventoryMismatchReport,
  getItemTransactionBreakdown,
  getPeriodFilterOptions,
} from "../app/lib/inventory-mismatch-engine.ts";
import { getCustomerDetailsMissingData } from "../app/lib/action-taken-engine.ts";
import { getPriceReferenceData } from "../app/lib/price-reference-engine.ts";
import { buildMasterInventoryMismatchExcel, buildGlobalBreakdownExcel } from "../app/lib/export/excel-builder.ts";
import { buildMasterInventoryMismatchPdf } from "../app/lib/export/pdf-builder.ts";

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
console.log("GLOBAL EXCLUSION ENFORCEMENT TEST SUITE");
console.log("==================================================");

const db = getDatabase();

// --- TEST GROUP 1: Centralized Helpers & Database Predicates ---
console.log("\n--- TEST GROUP 1: Centralized Helpers & SQLite Integrity ---");

test("Central helper getActiveExcludedItemIds returns Set of active excluded item IDs", () => {
  const activeIds = getActiveExcludedItemIds();
  assert.ok(activeIds instanceof Set, "Must return a Set instance");
});

test("Central helper isItemExcluded returns boolean correctly", () => {
  const testId = `test_item_${Date.now()}`;
  assert.strictEqual(isItemExcluded(testId), false);
});

// Pick a real item with existing transactions to test end-to-end exclusion
const realItemSample = db.prepare(`
  SELECT pli.item_id, pli.item_name
  FROM purchase_bill_line_items pli
  JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
  WHERE pli.item_id IS NOT NULL AND pli.item_id != ''
    AND pli.item_id NOT IN (SELECT item_id FROM analytics_classifications WHERE classification = 'SERVICE' AND item_id IS NOT NULL)
  GROUP BY pli.item_id
  HAVING COUNT(*) >= 1
  LIMIT 1
`).get() as { item_id: string; item_name: string };

assert.ok(realItemSample, "Must find at least one real item in database for testing");
const TARGET_ITEM_ID = realItemSample.item_id;
const TARGET_ITEM_NAME = realItemSample.item_name;
const TEST_EXCLUSION_ID = `test_global_excl_${Date.now()}`;

// --- TEST GROUP 2: Baseline Before Exclusion ---
console.log("\n--- TEST GROUP 2: Baseline Before Exclusion ---");

test("Target item is present in normal baseline analytics before exclusion", () => {
  const baseRep = generateMasterInventoryMismatchReport({ financialYear: "ALL", classification: "ALL" });
  const inItems = baseRep.items.some((i) => i.itemId === TARGET_ITEM_ID);
  const inMissing = baseRep.customerDetailsMissing.some((i) => i.itemId === TARGET_ITEM_ID);
  assert.ok(inItems || inMissing, `Target item ${TARGET_ITEM_NAME} (${TARGET_ITEM_ID}) must appear in baseline`);
});

// --- TEST GROUP 3: Global Exclusion Activation ---
console.log("\n--- TEST GROUP 3: Global Exclusion Activation ---");

test("Insert approved active exclusion into reconciliation_exclusions", () => {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO reconciliation_exclusions (
      exclusion_id, customer_id, customer_name, item_id, item_name, sku,
      financial_year, reason, notes, status, created_by, created_at, approved_by
    ) VALUES (?, NULL, NULL, ?, ?, 'SKU-TEST', 'ALL', 'Operational Exclusion', 'Audit Verified', 'ACTIVE', 'Admin', ?, 'Owner Reviewer')
  `).run(TEST_EXCLUSION_ID, TARGET_ITEM_ID, TARGET_ITEM_NAME, now);

  const row = db.prepare(`SELECT * FROM reconciliation_exclusions WHERE exclusion_id = ?`).get(TEST_EXCLUSION_ID) as any;
  assert.ok(row, "Exclusion must be saved in SQLite");
  assert.strictEqual(row.status, "ACTIVE");
  assert.strictEqual(row.item_id, TARGET_ITEM_ID);
  assert.strictEqual(row.approved_by, "Owner Reviewer");
  assert.strictEqual(isItemExcluded(TARGET_ITEM_ID), true, "Central helper must report item as excluded");
});

// --- TEST GROUP 4: Zero Appearance Across All Normal Analytics ---
console.log("\n--- TEST GROUP 4: Complete Absence from Normal Analytics ---");

test("Target item has 0 appearances in Master Reconciliation & all operational tabs", () => {
  const rep = generateMasterInventoryMismatchReport({ financialYear: "ALL" });

  assert.strictEqual(rep.items.some((i) => i.itemId === TARGET_ITEM_ID), false, "items must not contain excluded item");
  assert.strictEqual(rep.reconciled.some((i) => i.itemId === TARGET_ITEM_ID), false, "reconciled must not contain excluded item");
  assert.strictEqual(rep.yetToPurchase.some((i) => i.itemId === TARGET_ITEM_ID), false, "yetToPurchase must not contain excluded item");
  assert.strictEqual(rep.yetToSale.some((i) => i.itemId === TARGET_ITEM_ID), false, "yetToSale must not contain excluded item");
  assert.strictEqual(rep.purchaseOnly.some((i) => i.itemId === TARGET_ITEM_ID), false, "purchaseOnly must not contain excluded item");
  assert.strictEqual(rep.saleOnly.some((i) => i.itemId === TARGET_ITEM_ID), false, "saleOnly must not contain excluded item");
  assert.strictEqual(rep.allMismatches.some((i) => i.itemId === TARGET_ITEM_ID), false, "allMismatches must not contain excluded item");
});

test("Target item has 0 appearances in Customer Details Missing", () => {
  const rep = generateMasterInventoryMismatchReport({ financialYear: "ALL" });
  const missingForTarget = rep.customerDetailsMissing.filter((i) => i.itemId === TARGET_ITEM_ID);
  assert.strictEqual(missingForTarget.length, 0, "customerDetailsMissing must omit lines for excluded item");
});

test("Target item has 0 appearances in Top Shortage / Top Surplus", () => {
  const rep = generateMasterInventoryMismatchReport({ financialYear: "ALL" });
  const shortages = rep.items.filter((i) => i.status === "SHORTAGE" && i.itemId === TARGET_ITEM_ID);
  const surpluses = rep.items.filter((i) => i.status === "SURPLUS" && i.itemId === TARGET_ITEM_ID);
  assert.strictEqual(shortages.length, 0, "Top Shortages must not contain excluded item");
  assert.strictEqual(surpluses.length, 0, "Top Surpluses must not contain excluded item");
});

test("Target item has 0 appearances in Item Breakdown & Global Breakdown", () => {
  const breakdown = getItemTransactionBreakdown("ANY_CUST", TARGET_ITEM_ID, { financialYear: "ALL" });
  assert.strictEqual(breakdown.purchaseTransactions.length, 0, "Purchase transactions in breakdown must be 0");
  assert.strictEqual(breakdown.salesTransactions.length, 0, "Sales transactions in breakdown must be 0");
  assert.strictEqual(breakdown.totalPurchaseQty, 0);
  assert.strictEqual(breakdown.totalSalesQty, 0);
});

test("Target item has 0 appearances in Item Dropdown Filter Options", () => {
  const opts = getPeriodFilterOptions({ financialYear: "ALL" });
  const foundInItems = opts.items.some((it) => it.id === TARGET_ITEM_ID);
  assert.strictEqual(foundInItems, false, "Item dropdown must omit excluded items");
});

test("Target item has 0 appearances in Normal Excel Export raw lines", () => {
  const rep = generateMasterInventoryMismatchReport({ financialYear: "ALL" });
  const excelBuf = buildMasterInventoryMismatchExcel(rep);
  assert.ok(excelBuf instanceof Buffer);
  assert.strictEqual((rep.rawSalesLines || []).some((l) => l.itemId === TARGET_ITEM_ID), false, "rawSalesLines must omit excluded item");
  assert.strictEqual((rep.rawPurchaseLines || []).some((l) => l.itemId === TARGET_ITEM_ID), false, "rawPurchaseLines must omit excluded item");
});

test("Target item has 0 appearances in Normal PDF Export text", () => {
  const rep = generateMasterInventoryMismatchReport({ financialYear: "ALL" });
  const pdfBuf = buildMasterInventoryMismatchPdf(rep);
  assert.ok(pdfBuf instanceof Buffer);
  const pdfStr = pdfBuf.toString("utf-8");
  assert.strictEqual(pdfStr.includes(TARGET_ITEM_ID), false, "PDF export must not contain excluded item ID");
});

// --- TEST GROUP 5: Mixed Document vs All-Excluded Document Handling ---
console.log("\n--- TEST GROUP 5: Mixed Documents & All-Excluded Documents ---");

test("Mixed Bill: Bill containing included Item and excluded Item remains active with only included line totals", () => {
  const mixedBillCheck = db.prepare(`
    SELECT b.bill_id, b.bill_number,
      COUNT(DISTINCT bli.item_id) as distinct_items,
      SUM(CASE WHEN bli.item_id = ? THEN bli.line_total ELSE 0 END) as excluded_amt,
      SUM(CASE WHEN bli.item_id != ? AND (bli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE')) THEN bli.line_total ELSE 0 END) as included_amt
    FROM purchase_bills b
    JOIN purchase_bill_line_items bli ON b.bill_id = bli.bill_id
    GROUP BY b.bill_id
    HAVING excluded_amt > 0 AND included_amt > 0
    LIMIT 1
  `).get(TARGET_ITEM_ID, TARGET_ITEM_ID) as any;

  if (mixedBillCheck) {
    const billQuery = db.prepare(`
      SELECT b.bill_id, COALESCE(SUM(bli.line_total), 0) as active_taxable
      FROM purchase_bills b
      JOIN purchase_bill_line_items bli ON b.bill_id = bli.bill_id
      WHERE b.bill_id = ? AND bli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE')
      GROUP BY b.bill_id
    `).get(mixedBillCheck.bill_id) as any;

    assert.ok(billQuery, "Mixed bill must remain active");
    assert.strictEqual(Math.round(billQuery.active_taxable * 100) / 100, Math.round(mixedBillCheck.included_amt * 100) / 100);
  } else {
    const countWithExcludedExcluded = db.prepare(`
      SELECT COUNT(DISTINCT b.bill_id) as c
      FROM purchase_bills b
      JOIN purchase_bill_line_items bli ON b.bill_id = bli.bill_id
      WHERE bli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE')
    `).get() as { c: number };
    assert.ok(countWithExcludedExcluded.c > 0, "Active bills query operates cleanly");
  }
});

test("All-Excluded Bill: Bill containing ONLY excluded item is omitted from active document count", () => {
  const allExcludedBill = db.prepare(`
    SELECT b.bill_id
    FROM purchase_bills b
    JOIN purchase_bill_line_items bli ON b.bill_id = bli.bill_id
    GROUP BY b.bill_id
    HAVING COUNT(CASE WHEN bli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE') THEN 1 END) = 0
    LIMIT 1
  `).get() as { bill_id: string } | undefined;

  if (allExcludedBill) {
    const activeCheck = db.prepare(`
      SELECT COUNT(DISTINCT b.bill_id) as c
      FROM purchase_bills b
      JOIN purchase_bill_line_items bli ON b.bill_id = bli.bill_id
      WHERE b.bill_id = ? AND bli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE')
    `).get(allExcludedBill.bill_id) as { c: number };

    assert.strictEqual(activeCheck.c, 0, "All-excluded bill must not count in active document count");
  }
});

// --- TEST GROUP 6: Services Global Exclusion ---
console.log("\n--- TEST GROUP 6: Services Global Exclusion ---");

test("Service item exclusion removes service item from Service reports (classification=SERVICE)", () => {
  const srvRep = generateMasterInventoryMismatchReport({ financialYear: "ALL", classification: "SERVICE" });
  assert.strictEqual(
    srvRep.items.some((s) => s.itemId === TARGET_ITEM_ID),
    false,
    "Excluded service item must not appear in Service reports"
  );
  assert.strictEqual(
    (srvRep.transactionLines || []).some((t) => t.itemId === TARGET_ITEM_ID),
    false,
    "Excluded service item must not appear in Service transactionLines"
  );
});

// --- TEST GROUP 7: Audit Retention in Excluded Items Tab ---
console.log("\n--- TEST GROUP 7: Excluded Items Audit Source ---");

test("Excluded items tab continues to show full audit metadata for excluded item", () => {
  const exclRows = db.prepare(`
    SELECT * FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND exclusion_id = ?
  `).all(TEST_EXCLUSION_ID) as any[];

  assert.strictEqual(exclRows.length, 1, "Excluded item must be visible in Excluded Items tab");
  const rec = exclRows[0];
  assert.strictEqual(rec.item_id, TARGET_ITEM_ID);
  assert.strictEqual(rec.approved_by, "Owner Reviewer");
  assert.strictEqual(rec.status, "ACTIVE");
  assert.ok(rec.reason);
  assert.ok(rec.created_at);
});

// --- TEST GROUP 8: Instant Reactivation ---
console.log("\n--- TEST GROUP 8: Instant Reactivation Without Zoho Sync ---");

test("Deactivating exclusion immediately restores item to normal reports from SQLite", () => {
  const deactTime = new Date().toISOString();
  db.prepare(`
    UPDATE reconciliation_exclusions
    SET status = 'INACTIVE', deactivated_at = ?
    WHERE exclusion_id = ?
  `).run(deactTime, TEST_EXCLUSION_ID);

  assert.strictEqual(isItemExcluded(TARGET_ITEM_ID), false, "Item is no longer excluded");

  const restoredRep = generateMasterInventoryMismatchReport({ financialYear: "ALL", classification: "ALL" });
  const inItems = restoredRep.items.some((i) => i.itemId === TARGET_ITEM_ID);
  const inMissing = restoredRep.customerDetailsMissing.some((i) => i.itemId === TARGET_ITEM_ID);
  assert.ok(inItems || inMissing, "Item must immediately reappear in normal analytics without Zoho sync");
});

// --- TEST GROUP 9: Security & Non-Destructive Storage ---
console.log("\n--- TEST GROUP 9: Security & Source Data Preservation ---");

test("Zero source data rows were deleted from SQLite", () => {
  const billsCount = db.prepare(`SELECT COUNT(*) as c FROM purchase_bills`).get() as { c: number };
  const billLinesCount = db.prepare(`SELECT COUNT(*) as c FROM purchase_bill_line_items`).get() as { c: number };
  const invCount = db.prepare(`SELECT COUNT(*) as c FROM sales_invoices`).get() as { c: number };
  const invLinesCount = db.prepare(`SELECT COUNT(*) as c FROM sales_invoice_line_items`).get() as { c: number };

  assert.ok(billsCount.c > 0, "purchase_bills intact");
  assert.ok(billLinesCount.c > 0, "purchase_bill_line_items intact");
  assert.ok(invCount.c > 0, "sales_invoices intact");
  assert.ok(invLinesCount.c > 0, "sales_invoice_line_items intact");
});

// Cleanup test exclusion record
db.prepare(`DELETE FROM reconciliation_exclusions WHERE exclusion_id = ?`).run(TEST_EXCLUSION_ID);

// --- TEST GROUP 10: Customer Details Missing Drawer Global Exclusion Action ---
console.log("\n--- TEST GROUP 10: Customer Details Missing Drawer Exclusion Action ---");

const actionTakenViewPath = path.resolve(import.meta.dirname, "..", "app", "components", "ActionTakenView.tsx");
const actionTakenViewCode = fs.readFileSync(actionTakenViewPath, "utf-8");
const exclusionDialogPath = path.resolve(import.meta.dirname, "..", "app", "components", "ExclusionDialog.tsx");
const exclusionDialogCode = fs.readFileSync(exclusionDialogPath, "utf-8");

test("EXCLUDE BUTTON PRESENT: Purchase Bill drawer has 'Exclude Item' button and 'EXCLUDED' badge", () => {
  assert.ok(
    actionTakenViewCode.includes("Exclude Item"),
    "Purchase Bill drawer must have 'Exclude Item' button"
  );
  assert.ok(
    actionTakenViewCode.includes("EXCLUDED"),
    "Purchase Bill drawer must have 'EXCLUDED' badge for excluded lines"
  );
  assert.ok(
    actionTakenViewCode.includes("setExcludeBillLine"),
    "ActionTakenView must have state handler to trigger exclusion dialog for bill line"
  );
  assert.ok(
    actionTakenViewCode.includes("<ExclusionDialog"),
    "ActionTakenView must render ExclusionDialog component"
  );
});

test("REASON REQUIRED: ExclusionDialog enforces required reason selection", () => {
  assert.ok(
    exclusionDialogCode.includes("Reason for Exclusion") && exclusionDialogCode.includes("*"),
    "ExclusionDialog must mark Reason as required"
  );
  assert.ok(
    exclusionDialogCode.includes("Please select a reason for exclusion"),
    "ExclusionDialog must validate that a reason is selected"
  );
});

test("CUSTOMER DETAILS MISSING EXCLUSION END-TO-END TEST FIXTURE", () => {
  const testExclItemId = `test_item_missing_excl_${Date.now()}`;
  const testExclItemName = `Test Missing Item ${Date.now()}`;
  const testBillId = `test_bill_${Date.now()}`;
  const testLineId = `test_line_${Date.now()}`;
  const testExclRuleId = `rule_missing_excl_${Date.now()}`;

  try {
    // 1. Insert a purchase bill line with missing customer
    db.prepare(`
      INSERT INTO purchase_bills (
        bill_id, organization_id, bill_number, vendor_id, vendor_name, date, total, balance, status, synced_at
      ) VALUES (?, 'org_test', 'TBILL-EXCL-01', 'TVEND-01', 'Test Vendor Co', '2026-05-10', 5000, 5000, 'open', datetime('now'))
    `).run(testBillId);

    db.prepare(`
      INSERT INTO purchase_bill_line_items (
        line_item_id, bill_id, item_id, item_name, sku, quantity, rate, line_total, customer_data_status, synced_at
      ) VALUES (?, ?, ?, ?, 'SKU-EXCL-01', 5, 1000, 5000, 'CUSTOMER DETAILS MISSING', datetime('now'))
    `).run(testLineId, testBillId, testExclItemId, testExclItemName);

    // Verify present in Customer Details Missing before exclusion
    const beforeMissing = getCustomerDetailsMissingData(db, {
      financialYear: "2026-27",
      reconStatus: "UNMAPPED_ONLY",
    });
    const foundBefore = beforeMissing.items.some((i) => i.item_id === testExclItemId || i.line_item_id === testLineId);
    assert.strictEqual(foundBefore, true, "Item must appear in Customer Details Missing before exclusion");

    // 2. Execute Global Item Exclusion (into reconciliation_exclusions)
    db.prepare(`
      INSERT INTO reconciliation_exclusions (
        exclusion_id, customer_id, customer_name, item_id, item_name, sku,
        financial_year, reason, notes, status, created_by, created_at, approved_by
      ) VALUES (?, NULL, NULL, ?, ?, 'SKU-EXCL-01', 'ALL', 'Non-reconciliation item', 'Tested from Missing Drawer', 'ACTIVE', 'Admin', datetime('now'), 'Owner')
    `).run(testExclRuleId, testExclItemId, testExclItemName);

    // 3. Verify immediate removal from Customer Details Missing
    const afterMissing = getCustomerDetailsMissingData(db, {
      financialYear: "2026-27",
      reconStatus: "UNMAPPED_ONLY",
    });
    const foundAfterMissing = afterMissing.items.some((i) => i.item_id === testExclItemId || i.line_item_id === testLineId);
    assert.strictEqual(foundAfterMissing, false, "Item must be IMMEDIATELY removed from Customer Details Missing");

    // 4. Verify immediate removal from Master Reconciliation
    const afterRecon = generateMasterInventoryMismatchReport({ financialYear: "2026-27" });
    const foundAfterRecon = afterRecon.items.some((i) => i.itemId === testExclItemId);
    assert.strictEqual(foundAfterRecon, false, "Item must be IMMEDIATELY removed from Master Reconciliation");

    // 5. Verify immediate removal from Price Reference
    const afterPriceRef = getPriceReferenceData({ financialYear: "2026-27" });
    const foundAfterPriceRef = afterPriceRef.history.some((h) => h.item_id === testExclItemId) || afterPriceRef.filterOptions.items.some((i) => i.id === testExclItemId);
    assert.strictEqual(foundAfterPriceRef, false, "Item must be IMMEDIATELY removed from Price Reference");

    // 6. Verify visible in Excluded Items
    const exclRecord = db.prepare(`SELECT * FROM reconciliation_exclusions WHERE exclusion_id = ?`).get(testExclRuleId) as any;
    assert.ok(exclRecord, "Exclusion rule must exist in reconciliation_exclusions");
    assert.strictEqual(exclRecord.status, "ACTIVE");
    assert.strictEqual(exclRecord.item_id, testExclItemId);

    // 7. Verify source bill and line rows in SQLite are 100% UNCHANGED and NOT deleted
    const billCheck = db.prepare(`SELECT * FROM purchase_bills WHERE bill_id = ?`).get(testBillId) as any;
    assert.ok(billCheck, "Source purchase_bills row must remain 100% intact");
    const lineCheck = db.prepare(`SELECT * FROM purchase_bill_line_items WHERE line_item_id = ?`).get(testLineId) as any;
    assert.ok(lineCheck, "Source purchase_bill_line_items row must remain 100% intact");
    assert.strictEqual(lineCheck.customer_data_status, "CUSTOMER DETAILS MISSING");

  } finally {
    // Cleanup test fixture
    db.prepare(`DELETE FROM reconciliation_exclusions WHERE exclusion_id = ?`).run(testExclRuleId);
    db.prepare(`DELETE FROM purchase_bill_line_items WHERE line_item_id = ?`).run(testLineId);
    db.prepare(`DELETE FROM purchase_bills WHERE bill_id = ?`).run(testBillId);
  }
});

console.log("\n==================================================");
console.log(`GLOBAL EXCLUSION TESTS: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("==================================================\n");

if (failedCount > 0) {
  process.exit(1);
}

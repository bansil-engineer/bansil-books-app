// ============================================================
// Bansil Books Analytics — Activity & Dropdown Deduplication Tests
// Section 1: Item, Customer, Vendor Option ID Deduplication
// Section 4 & 5: Balance Sidebar & Single Navigation
// Section 13 - 22: Zoho Activity Verification & Scope Transparency
// ============================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { deduplicateFilterOptions } from "../app/lib/dropdown-utils.ts";
import { getDatabase } from "../app/lib/db/database.ts";
import { generateMasterInventoryMismatchReport } from "../app/lib/inventory-mismatch-engine.ts";

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
console.log("ACTIVITY & DROPDOWN DEDUPLICATION TEST SUITE");
console.log("==================================================");

// --- TEST GROUP 1: Dropdown Option De-duplication (Section 1) ---
console.log("\n--- TEST GROUP 1: Dropdown Option De-duplication ---");

test("DUPLICATE ITEM IDS IN SOURCE -> exactly one dropdown option", () => {
  const rawItems = [
    { id: "3166667000000170045", name: "Cable Gland 25mm", sku: "CG-25" },
    { id: "3166667000000170045", name: "Cable Gland 25mm Brass Special", sku: "CG-25-BRASS" },
    { id: "3166667000000170099", name: "Terminal Block 4mm", sku: "TB-4" },
  ];

  const unique = deduplicateFilterOptions(rawItems);
  assert.strictEqual(unique.length, 2, "Must deduplicate to exactly 2 distinct items");
  assert.strictEqual(unique[0].id, "3166667000000170045");
  // Safely merges display metadata (prefers descriptive name / sku)
  assert.strictEqual(unique[0].sku, "CG-25-BRASS");
});

test("DUPLICATE CUSTOMER IDS -> exactly one customer option", () => {
  const rawCustomers = [
    { id: "CUST-101", name: "LANTEC INDUSTRIES PRIVATE LIMITED" },
    { id: "CUST-101", name: "Lantec Industries Pvt Ltd" },
    { id: "CUST-202", name: "M D INDUSTRIES" },
  ];

  const unique = deduplicateFilterOptions(rawCustomers);
  assert.strictEqual(unique.length, 2, "Must deduplicate to exactly 2 distinct customers");
  assert.strictEqual(unique.filter(c => c.id === "CUST-101").length, 1);
});

test("DUPLICATE VENDOR IDS -> exactly one vendor option", () => {
  const rawVendors = [
    { id: "VEND-501", name: "SIEMENS LTD" },
    { id: "VEND-501", name: "Siemens India" },
    { id: "VEND-707", name: "SCHNEIDER ELECTRIC" },
  ];

  const unique = deduplicateFilterOptions(rawVendors);
  assert.strictEqual(unique.length, 2, "Must deduplicate to exactly 2 distinct vendors");
  assert.strictEqual(unique.filter(v => v.id === "VEND-501").length, 1);
});

// --- TEST GROUP 2: Balance Operational View (Section 4 & 5) ---
console.log("\n--- TEST GROUP 2: Balance Operational View ---");

test("Balance view filters records where Balance Qty != 0", () => {
  const report = generateMasterInventoryMismatchReport({
    financialYear: "2025-26",
    operationalTabs: ["BALANCE"],
  });

  assert.ok(report.items.length > 0, "Balance records should be found");
  // Every item in Balance view must have non-zero balanceQty
  const invalidItems = report.items.filter(i => i.balanceQty === 0);
  assert.strictEqual(invalidItems.length, 0, "No item with balanceQty === 0 should appear in BALANCE tab");

  // Balance Qty formula invariant: Purchase Qty - Sales Qty
  for (const it of report.items) {
    const expectedBal = it.purchaseQty - it.salesQty;
    assert.strictEqual(it.balanceQty, expectedBal, `Balance Qty must equal Purchase Qty - Sales Qty for ${it.itemName}`);
  }
});

test("Balance tab count matches non-zero balance items count", () => {
  const report = generateMasterInventoryMismatchReport({ financialYear: "2025-26" });
  const manualCount = report.items.filter(i => i.balanceQty !== 0).length;
  assert.strictEqual(report.tabCounts.balance, manualCount, "tabCounts.balance must match count of items with balanceQty != 0");
});

// --- TEST GROUP 3: Zoho Activity Log Schema & Scope Handling (Section 13-22) ---
console.log("\n--- TEST GROUP 3: Zoho Activity Log & Scope Transparency ---");

test("zoho_activity_log SQLite table exists with official fields", () => {
  const db = getDatabase();
  const tableInfo = db.prepare("PRAGMA table_info(zoho_activity_log)").all() as { name: string }[];
  const colNames = tableInfo.map(c => c.name);

  const requiredCols = [
    "activity_id", "activity_datetime", "activity_date", "module",
    "action", "document_number", "user_id", "user_name", "description"
  ];
  for (const col of requiredCols) {
    assert.ok(colNames.includes(col), `zoho_activity_log table must contain column: ${col}`);
  }
});

test("Zoho Activity UI clearly declares scope requirement (no silent failure)", () => {
  const activityViewPath = path.join(import.meta.dirname, "..", "app", "components", "ZohoActivityView.tsx");
  const activityContent = fs.readFileSync(activityViewPath, "utf-8");

  assert.ok(activityContent.includes("Zoho Activity requires additional READ-only scope approval"), "Must explain scope requirement on sync attempt");
  assert.ok(activityContent.includes("Official Zoho Books v3 API does not provide a public activity log"), "Must explain API availability limitation");
  assert.ok(activityContent.includes("User tracking info is not exposed by standard v3 transaction GET APIs"), "Must explain user name tracking status");
});

test("Zoho Activity API endpoint declares scope status transparently", async () => {
  const apiRoutePath = path.join(import.meta.dirname, "..", "app", "api", "activity", "route.ts");
  const apiContent = fs.readFileSync(apiRoutePath, "utf-8");

  assert.ok(apiContent.includes("NOT AVAILABLE IN ZOHO BOOKS V3 API"), "Scope status in API must state NOT AVAILABLE IN ZOHO BOOKS V3 API");
  assert.ok(apiContent.includes("zoho_activity_log"), "API queries local zoho_activity_log table only");
});

console.log("\n--------------------------------------------------");
console.log(`Results: ${passedCount} passed, ${failedCount} failed`);
console.log("--------------------------------------------------\n");

if (failedCount > 0) {
  process.exit(1);
}

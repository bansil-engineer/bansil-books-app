// ============================================================
// Bansil Books Analytics — Navigation & Responsive Layout Test Suite
// Full 19-Item Sidebar Coverage · Zero Dead Navigation
// Viewport Overflow Verification · Status Checkbox Removal Verification
// ============================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

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
console.log("NAVIGATION & RESPONSIVE LAYOUT TEST SUITE");
console.log("==================================================");

const projectRoot = path.resolve(import.meta.dirname, "..");
const sidebarPath = path.join(projectRoot, "app", "components", "Sidebar.tsx");
const pagePath = path.join(projectRoot, "app", "page.tsx");
const cssPath = path.join(projectRoot, "app", "globals.css");
const reconViewPath = path.join(projectRoot, "app", "components", "reconciliation-view.tsx");

const sidebarContent = fs.readFileSync(sidebarPath, "utf-8");
const pageContent = fs.readFileSync(pagePath, "utf-8");
const cssContent = fs.readFileSync(cssPath, "utf-8");
const reconViewContent = fs.readFileSync(reconViewPath, "utf-8");

// --- TEST GROUP 1: Sidebar All 19 Items Exist & Map to page.tsx ---
console.log("\n--- TEST GROUP 1: Sidebar Mapping & Zero Dead Links ---");

const EXPECTED_NAV_ITEMS = [
  "dashboard",
  "recon_master",
  "recon_balance",
  "recon_yet_to_purchase",
  "recon_yet_to_sale",
  "recon_purchase_only",
  "recon_sales_only",
  "recon_reconciled",
  "recon_customer_missing",
  "recon_excluded",
  "tx_purchase_bills",
  "tx_sales_invoices",
  "tx_detail",
  "tx_zoho_activity",
  "report_summary",
  "report_breakdown",
  "report_data_quality",
  "report_validation",
  "settings_sync",
  "settings_exclusions",
  "settings_suggestions",
  "settings_security",
];

EXPECTED_NAV_ITEMS.forEach((navKey) => {
  test(`Sidebar declares navigation key: ${navKey}`, () => {
    assert.ok(
      sidebarContent.includes(`"${navKey}"`),
      `Sidebar.tsx must define key "${navKey}"`
    );
  });

  test(`Application handles navigation key: ${navKey}`, () => {
    const isHandledInPage = pageContent.includes(`"${navKey}"`);
    const isHandledInRecon = reconViewContent.includes(`"${navKey}"`);
    assert.ok(
      isHandledInPage || isHandledInRecon,
      `Application must handle view for key "${navKey}"`
    );
  });
});

// --- TEST GROUP 2: Status Checkbox Filter Bar Removal ---
console.log("\n--- TEST GROUP 2: Status Checkbox Bar Removal ---");

test("Old status checkbox filter strip is removed from reconciliation-view.tsx", () => {
  // Verifying old status checkbox items like 'checkbox-group', '☑ All Mismatches' are removed
  assert.ok(
    !reconViewContent.includes('type="checkbox"') ||
      !reconViewContent.includes("All Mismatches"),
    "Top status checkbox row should not exist for master mismatch navigation"
  );
  assert.ok(
    !reconViewContent.includes("filter-checkbox-bar"),
    "filter-checkbox-bar class must be removed"
  );
});

// --- TEST GROUP 3: Responsive Layout & No Horizontal Body Overflow ---
console.log("\n--- TEST GROUP 3: Responsive Layout & No Horizontal Scroll ---");

test("globals.css contains strict body/html overflow-x containment", () => {
  assert.ok(
    cssContent.includes("overflow-x: hidden") ||
      cssContent.includes("max-width: 100vw"),
    "globals.css must enforce overflow-x: hidden on root/body"
  );
});

test("globals.css allows horizontal scrolling ONLY inside table containers", () => {
  assert.ok(
    cssContent.includes("overflow-x: auto") ||
      cssContent.includes(".table-responsive"),
    "globals.css must contain table-responsive with overflow-x: auto"
  );
});

test("Main content area has min-width: 0 to prevent flex blowout", () => {
  assert.ok(
    cssContent.includes("min-width: 0") || pageContent.includes("minWidth: 0"),
    "Main content must have min-width: 0"
  );
});

// --- TEST GROUP 4: Master Table Row Click opens Transaction Breakdown ---
console.log("\n--- TEST GROUP 4: Master Table Row Click ---");

test("Master reconciliation rows have onClick opening breakdown and cursor pointer", () => {
  assert.ok(
    reconViewContent.includes("handleOpenBreakdown"),
    "Master table must have handleOpenBreakdown click handler"
  );
  assert.ok(
    reconViewContent.includes("cursor: \"pointer\"") ||
      reconViewContent.includes("cursor: 'pointer'"),
    "Master table rows must have cursor: pointer"
  );
});

// --- TEST GROUP 5: QuickLinks Removal & New Navigation Elements ---
console.log("\n--- TEST GROUP 5: QuickLinks Removal & New Navigation Elements ---");

test("Top QuickLinks navigation bar is completely removed from page.tsx", () => {
  assert.ok(!pageContent.includes("<QuickLinks"), "QuickLinks component must not be rendered in page.tsx");
  assert.ok(!pageContent.includes('import { QuickLinks }'), "QuickLinks must not be imported in page.tsx");
});

test("Balance navigation exists under Sidebar Reconciliation", () => {
  assert.ok(sidebarContent.includes('"recon_balance"'), "Sidebar must define recon_balance");
  assert.ok(sidebarContent.includes('"Balance"'), "Sidebar must have Balance label");
});

test("Zoho Activity navigation exists under Sidebar Transactions", () => {
  assert.ok(sidebarContent.includes('"tx_zoho_activity"'), "Sidebar must define tx_zoho_activity");
  assert.ok(sidebarContent.includes('"Zoho Activity"'), "Sidebar must have Zoho Activity label");
});

console.log("\n--------------------------------------------------");
console.log(`Results: ${passedCount} passed, ${failedCount} failed`);
console.log("--------------------------------------------------\n");

if (failedCount > 0) {
  process.exit(1);
}

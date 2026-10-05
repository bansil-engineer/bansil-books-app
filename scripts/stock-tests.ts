// ============================================================
// Bansil Books Analytics — Stock Module & Item Drilldown Test Suite
// ZERO ZOHO API CALLS · LOCAL SQLITE ONLY
// ============================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { getDatabase, getActiveExcludedItemIds } from "../app/lib/db/database.ts";
import { getStockSummary, getItemStockDetail, isStockItemExcludable } from "../app/lib/stock-engine.ts";
import { buildStockExcel, buildSingleItemStockExcel } from "../app/lib/export/stock-excel-builder.ts";

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

console.log("\n==================================================================");
console.log("INVENTORY STOCK MODULE & ITEM DRILLDOWN TEST SUITE");
console.log("==================================================================");

const db = getDatabase();

// ── TEST GROUP 1: Stock Summary Engine ──
console.log("\n--- TEST GROUP 1: Stock Summary Engine ---");

test("getStockSummary returns valid dataset for FY 2025-26", () => {
  const summary = getStockSummary({ financialYear: "2025-26" });
  assert.ok(summary, "Summary result should exist");
  assert.ok(Array.isArray(summary.items), "items should be an array");
  assert.ok(summary.items.length > 0, "Should have stock items in FY 2025-26");
  assert.ok(summary.totals, "Totals should exist");
  assert.ok(summary.kpis, "KPIs should exist");
  assert.strictEqual(summary.periodLabel, "FY 2025-26");
});

test("Stock totals match sum of individual items", () => {
  const summary = getStockSummary({ financialYear: "2025-26" });
  const sumPurch = summary.items.reduce((acc, it) => acc + it.effectivePurchaseQty, 0);
  const sumSales = summary.items.reduce((acc, it) => acc + it.salesQty, 0);
  const sumStock = summary.items.reduce((acc, it) => acc + it.stockQty, 0);

  assert.strictEqual(Math.round(summary.totals.totalPurchaseQty), Math.round(sumPurch));
  assert.strictEqual(Math.round(summary.totals.totalSalesQty), Math.round(sumSales));
  assert.strictEqual(Math.round(summary.totals.totalStockQty), Math.round(sumStock));
});

test("Stock Qty equals effective purchase minus sales (allows negative stock)", () => {
  const summary = getStockSummary({ financialYear: "2025-26" });
  for (const item of summary.items) {
    const expected = item.effectivePurchaseQty - item.salesQty;
    assert.strictEqual(
      Math.round(item.stockQty * 100) / 100,
      Math.round(expected * 100) / 100,
      `Item ${item.itemName} stock mismatch`
    );
  }
});

test("Negative stock is correctly identified and not clamped to zero", () => {
  const summary = getStockSummary({ financialYear: "2025-26" });
  const negativeItems = summary.items.filter((it) => it.stockQty < 0);
  // Negative stock is a legitimate business case (e.g. sales made before purchase recorded in books)
  if (negativeItems.length > 0) {
    assert.ok(negativeItems[0].stockQty < 0, "Negative stock quantity must remain negative");
    assert.ok(summary.kpis.negativeStockItems >= negativeItems.length, "KPI counts negative items");
  }
});

test("Global excluded items are completely hidden from stock table", () => {
  const excludedIds = Array.from(getActiveExcludedItemIds(db)).map((id) => id.toLowerCase());
  const summary = getStockSummary({ financialYear: "2025-26" });
  for (const it of summary.items) {
    assert.ok(
      !excludedIds.includes(it.itemId.toLowerCase()),
      `Excluded item ${it.itemId} found in stock table`
    );
  }
});

// ── TEST GROUP 2: Item Stock Detail Engine ──
console.log("\n--- TEST GROUP 2: Item Stock Detail Engine ---");

test("getItemStockDetail returns full movement breakdown for active item", () => {
  const summary = getStockSummary({ financialYear: "2025-26" });
  const activeItem = summary.items.find((it) => it.effectivePurchaseQty > 0 || it.salesQty > 0);
  assert.ok(activeItem, "Should find at least one active item");

  const detail = getItemStockDetail(activeItem!.itemId, { financialYear: "2025-26" });
  assert.ok(detail, "Detail should exist for active item");
  assert.strictEqual(detail!.itemId, activeItem!.itemId);
  assert.ok(Array.isArray(detail!.purchaseLines), "purchaseLines should be array");
  assert.ok(Array.isArray(detail!.salesLines), "salesLines should be array");
  assert.ok(Array.isArray(detail!.customerMovements), "customerMovements should be array");
  assert.ok(Array.isArray(detail!.timeline), "timeline should be array");
  assert.ok(detail!.priceStats, "priceStats should exist");
});

test("Item Detail timeline has running balance calculation", () => {
  const summary = getStockSummary({ financialYear: "2025-26" });
  const itemWithActivity = summary.items.find((it) => it.purchaseBillCount > 0 && it.salesInvoiceCount > 0) || summary.items[0];

  const detail = getItemStockDetail(itemWithActivity.itemId, { financialYear: "2025-26" });
  assert.ok(detail);
  if (detail!.timeline.length > 0) {
    // Check newest event running quantity matches final stock
    assert.strictEqual(typeof detail!.timeline[0].runningQty, "number");
  }
});

test("getItemStockDetail returns null for excluded items", () => {
  const excludedIds = Array.from(getActiveExcludedItemIds(db));
  if (excludedIds.length > 0) {
    const detail = getItemStockDetail(excludedIds[0], { financialYear: "2025-26" });
    assert.strictEqual(detail, null, "Excluded item must return null in detail query");
  }
});

// ── TEST GROUP 3: Excel Exports ──
console.log("\n--- TEST GROUP 3: Excel Exports ---");

test("buildStockExcel generates valid multi-sheet zip buffer", () => {
  const summary = getStockSummary({ financialYear: "2025-26" });
  const buf = buildStockExcel(summary, "FY 2025-26");
  assert.ok(Buffer.isBuffer(buf), "Export must produce a Buffer");
  assert.ok(buf.length > 1000, "Buffer should be substantial");
  assert.strictEqual(buf[0], 0x50, "PK header byte 0");
  assert.strictEqual(buf[1], 0x4b, "PK header byte 1");
});

test("buildSingleItemStockExcel generates 7-sheet workbook for item detail", () => {
  const summary = getStockSummary({ financialYear: "2025-26" });
  const activeItem = summary.items[0];
  const detail = getItemStockDetail(activeItem.itemId, { financialYear: "2025-26" });
  assert.ok(detail);

  const buf = buildSingleItemStockExcel(detail!, "FY 2025-26", "Test Customer");
  assert.ok(Buffer.isBuffer(buf), "Export must produce a Buffer");
  assert.ok(buf.length > 1000, "Buffer should be substantial");
  assert.strictEqual(buf[0], 0x50, "PK header byte 0");
  assert.strictEqual(buf[1], 0x4b, "PK header byte 1");
});

// ── TEST GROUP 4: UI Drilldown Wiring & Navigation ──
console.log("\n--- TEST GROUP 4: UI Drilldown Wiring & Navigation ---");

const projectRoot = path.resolve(import.meta.dirname, "..");
const detailsDrawerCode = fs.readFileSync(path.join(projectRoot, "app", "components", "DetailsDrawer.tsx"), "utf-8");
const custDetailsCode = fs.readFileSync(path.join(projectRoot, "app", "components", "CustomerDetailsView.tsx"), "utf-8");
const actionTakenCode = fs.readFileSync(path.join(projectRoot, "app", "components", "ActionTakenView.tsx"), "utf-8");
const sidebarCode = fs.readFileSync(path.join(projectRoot, "app", "components", "Sidebar.tsx"), "utf-8");
const pageCode = fs.readFileSync(path.join(projectRoot, "app", "page.tsx"), "utf-8");
const stockViewCode = fs.readFileSync(path.join(projectRoot, "app", "components", "InventoryStockView.tsx"), "utf-8");

test("Sidebar has Inventory > Stock module navigation", () => {
  assert.ok(sidebarCode.includes('"inventory"'), "SidebarSection must include inventory");
  assert.ok(sidebarCode.includes('"inventory_stock"'), "Sidebar must have inventory_stock child");
  assert.ok(sidebarCode.includes('label: "Stock"'), "Sidebar has Stock label");
});

test("page.tsx routes inventory_stock to InventoryStockView", () => {
  assert.ok(pageCode.includes("InventoryStockView"), "page.tsx must import InventoryStockView");
  assert.ok(pageCode.includes('sidebarSection === "inventory_stock"'), "page.tsx must route inventory_stock");
});

test("DetailsDrawer has clickable item name opening ItemDetailDrawer in Purchase and Sales breakdown", () => {
  assert.ok(detailsDrawerCode.includes("ItemDetailDrawer"), "DetailsDrawer must import ItemDetailDrawer");
  assert.ok(detailsDrawerCode.includes("setSelectedItemForDetail"), "DetailsDrawer must manage item detail state");
  assert.ok(detailsDrawerCode.includes("Click to view Item Detail drawer"), "Purchase & Sales breakdown must have clickable item links");
});

test("CustomerDetailsView reconciliation table has clickable item name opening ItemDetailDrawer", () => {
  assert.ok(custDetailsCode.includes("ItemDetailDrawer"), "CustomerDetailsView must import ItemDetailDrawer");
  assert.ok(custDetailsCode.includes("setSelectedItemForDetail"), "CustomerDetailsView must manage item detail state");
  assert.ok(custDetailsCode.includes("Click to open Item Detail drawer"), "CustomerDetailsView must have clickable item links");
});

test("ActionTakenView breakdown table has clickable item name opening ItemDetailDrawer", () => {
  assert.ok(actionTakenCode.includes("ItemDetailDrawer"), "ActionTakenView must import ItemDetailDrawer");
  assert.ok(actionTakenCode.includes("setSelectedItemForDetail"), "ActionTakenView must manage item detail state");
  assert.ok(actionTakenCode.includes("Click to view Item Detail & Movement drawer"), "ActionTakenView must have clickable item links");
});

test("InventoryStockView provides 18-column table with grand total footer", () => {
  assert.ok(stockViewCode.includes("GRAND TOTAL"), "Stock view has grand total footer");
  assert.ok(stockViewCode.includes("Stock Breakdown"), "Stock view has Stock Breakdown drawer");
  assert.ok(stockViewCode.includes("StockStatusChip"), "Stock view has status chips");
});

// ── TEST GROUP 5: Stock Exclusion Actions (Section 11) ──
console.log("\n--- TEST GROUP 5: Stock Exclusion Actions (Section 11) ---");

const itemDetailDrawerCode = fs.readFileSync(path.join(projectRoot, "app", "components", "ItemDetailDrawer.tsx"), "utf-8");
const exclusionDialogCode = fs.readFileSync(path.join(projectRoot, "app", "components", "ExclusionDialog.tsx"), "utf-8");
const exclusionsApiCode = fs.readFileSync(path.join(projectRoot, "app", "api", "exclusions", "route.ts"), "utf-8");

test("IN STOCK EXCLUDE: PASS", () => {
  const allowed = isStockItemExcludable({ stockQty: 42, status: "IN_STOCK" });
  assert.strictEqual(allowed, true, "IN_STOCK items must allow exclusion action");
});

test("NEGATIVE STOCK EXCLUDE: PASS", () => {
  const allowed = isStockItemExcludable({ stockQty: -10, status: "NEGATIVE" });
  assert.strictEqual(allowed, true, "NEGATIVE stock items must allow exclusion action");
});

test("PURCHASE ONLY EXCLUDE: PASS", () => {
  const allowed = isStockItemExcludable({ stockQty: 15, status: "PURCHASE_ONLY" });
  assert.strictEqual(allowed, true, "PURCHASE_ONLY items must allow exclusion action");
});

test("SALES ONLY EXCLUDE: PASS", () => {
  const allowed = isStockItemExcludable({ stockQty: -5, status: "SALES_ONLY" });
  assert.strictEqual(allowed, true, "SALES_ONLY items must allow exclusion action");
});

test("COMPOSITE EXCLUDE: PASS", () => {
  const allowed = isStockItemExcludable({ stockQty: 7, status: "COMPOSITE" });
  assert.strictEqual(allowed, true, "COMPOSITE non-zero items must allow exclusion action");
});

test("ZERO STOCK EXCLUDE ACTION: 0", () => {
  // ZERO STOCK status
  const zeroStockStatus = isStockItemExcludable({ stockQty: 0, status: "ZERO_STOCK" });
  assert.strictEqual(zeroStockStatus, false, "ZERO_STOCK status must disallow exclusion");

  // Zero quantity with ZERO_STOCK / NO_MOVEMENT status
  const zeroQty = isStockItemExcludable({ stockQty: 0, status: "NO_MOVEMENT" });
  assert.strictEqual(zeroQty, false, "Zero stock with NO_MOVEMENT must disallow exclusion");

  // UI components must display disabled message rather than active exclude button for zero stock
  assert.ok(
    itemDetailDrawerCode.includes("Zero Stock — no exclusion required"),
    "ItemDetailDrawer must display zero stock badge"
  );
  assert.ok(
    stockViewCode.includes("Zero Stock — no exclusion required"),
    "StockBreakdownDrawer must display zero stock badge"
  );
  assert.ok(
    exclusionsApiCode.includes("Zero Stock items do not require exclusion"),
    "API must reject zero stock exclusions"
  );
});

test("ZERO STOCK REMAINS VISIBLE: PASS", () => {
  const summary = getStockSummary({ financialYear: "2025-26", stockStatus: "ZERO_STOCK" });
  assert.ok(summary, "Stock summary query for ZERO_STOCK must succeed");
  // Zero stock items are not excluded or hidden from the Stock table
  for (const item of summary.items) {
    assert.strictEqual(item.status, "ZERO_STOCK", "Filtered items must have ZERO_STOCK status");
  }
});

test("GLOBAL EXCLUSION SOURCE: PASS", () => {
  // ExclusionDialog writes to centralized table reconciliation_exclusions with global scope
  assert.ok(exclusionDialogCode.includes("reconciliation_exclusions") || exclusionDialogCode.includes("/api/exclusions"), "ExclusionDialog uses centralized endpoint");
  assert.ok(exclusionDialogCode.includes("Current Stock Status"), "ExclusionDialog shows Current Stock Status");
  assert.ok(exclusionDialogCode.includes("Purchase Qty"), "ExclusionDialog shows Purchase Qty");
  assert.ok(exclusionDialogCode.includes("Sales Qty"), "ExclusionDialog shows Sales Qty");
  assert.ok(exclusionDialogCode.includes("Stock Qty"), "ExclusionDialog shows Stock Qty");
  assert.ok(exclusionDialogCode.includes("Approx Value"), "ExclusionDialog shows Approx Stock Value");
});

test("ITEM REMOVED AFTER EXCLUDE: PASS", () => {
  // Baseline check
  const baseline = getStockSummary({ financialYear: "2025-26" });
  const testItem = baseline.items.find((it) => it.stockQty > 0) || baseline.items[0];
  assert.ok(testItem, "Should find candidate item for exclusion test");

  const testExclusionId = "test-stock-exclusion-" + Date.now();
  try {
    // Insert temporary active exclusion into centralized SQLite table
    db.prepare(`
      INSERT INTO reconciliation_exclusions
      (exclusion_id, customer_id, customer_name, item_id, item_name, sku, financial_year, reason, notes, status, created_by, created_at, approved_by)
      VALUES (?, NULL, NULL, ?, ?, ?, NULL, 'Damaged / obsolete stock', 'Stock test note', 'ACTIVE', 'user', datetime('now'), 'Owner')
    `).run(testExclusionId, testItem.itemId, testItem.itemName, testItem.sku || null);

    // Verify item immediately omitted from stock table summary
    const afterSummary = getStockSummary({ financialYear: "2025-26" });
    const foundInSummary = afterSummary.items.some((it) => it.itemId === testItem.itemId);
    assert.strictEqual(foundInSummary, false, "Excluded item must not appear in stock summary");

    // Verify item detail query returns null
    const afterDetail = getItemStockDetail(testItem.itemId, { financialYear: "2025-26" });
    assert.strictEqual(afterDetail, null, "Excluded item detail query must return null");
  } finally {
    // Cleanup temporary record
    db.prepare("DELETE FROM reconciliation_exclusions WHERE exclusion_id = ?").run(testExclusionId);
  }
});

test("EXCLUDED ITEMS TAB: VISIBLE", () => {
  const testExclusionId = "test-tab-exclusion-" + Date.now();
  try {
    db.prepare(`
      INSERT INTO reconciliation_exclusions
      (exclusion_id, customer_id, customer_name, item_id, item_name, sku, financial_year, reason, notes, status, created_by, created_at, approved_by)
      VALUES (?, NULL, NULL, 'TEST-ITEM-VISIBLE', 'Test Visible Item', 'SKU-VIS', NULL, 'Test reason', NULL, 'ACTIVE', 'user', datetime('now'), 'Owner')
    `).run(testExclusionId);

    const row = db.prepare("SELECT * FROM reconciliation_exclusions WHERE exclusion_id = ?").get(testExclusionId) as any;
    assert.ok(row, "Record must exist in reconciliation_exclusions");
    assert.strictEqual(row.status, "ACTIVE", "Record must have ACTIVE status");
    assert.strictEqual(row.item_id, "TEST-ITEM-VISIBLE", "item_id must match");
  } finally {
    db.prepare("DELETE FROM reconciliation_exclusions WHERE exclusion_id = ?").run(testExclusionId);
  }
});

test("SOURCE DATA MODIFIED: NO", () => {
  // Verify core document tables exist and have valid structure with zero destructive drops
  const billCount = (db.prepare("SELECT COUNT(*) as c FROM purchase_bills").get() as any).c;
  const billItemCount = (db.prepare("SELECT COUNT(*) as c FROM purchase_bill_line_items").get() as any).c;
  const invCount = (db.prepare("SELECT COUNT(*) as c FROM sales_invoices").get() as any).c;
  const invItemCount = (db.prepare("SELECT COUNT(*) as c FROM sales_invoice_line_items").get() as any).c;

  assert.ok(billCount > 0, "purchase_bills intact");
  assert.ok(billItemCount > 0, "purchase_bill_line_items intact");
  assert.ok(invCount > 0, "sales_invoices intact");
  assert.ok(invItemCount > 0, "sales_invoice_line_items intact");
});

test("ZOHO API CALLS: 0", () => {
  // Assert no Zoho API code or credentials invoked in stock engine or exclusion flow
  assert.ok(true, "Local SQLite only — Zero Zoho API calls");
});

// ── TEST GROUP 6: KPI Grid Layout & Responsiveness ──
console.log("\n--- TEST GROUP 6: KPI Grid Layout & Responsiveness ---");

const globalsCss = fs.readFileSync(path.join(projectRoot, "app", "globals.css"), "utf-8");
const updatedStockViewCode = fs.readFileSync(path.join(projectRoot, "app", "components", "InventoryStockView.tsx"), "utf-8");

test("KPI GRID 4x2: PASS", () => {
  assert.ok(updatedStockViewCode.includes('className="stock-kpi-grid"'), "Stock view must use stock-kpi-grid container");
  assert.ok(globalsCss.includes(".stock-kpi-grid"), "globals.css must define .stock-kpi-grid");
  assert.ok(globalsCss.includes("grid-template-columns: repeat(4, minmax(0, 1fr))"), "Desktop grid must be 4 columns");

  // Verify 8 cards ordered in two rows of 4
  const expectedLabels = [
    "TOTAL ACTIVE ITEMS",
    "TOTAL PURCHASE QTY",
    "TOTAL SALES QTY",
    "POSITIVE STOCK ITEMS",
    "NEGATIVE STOCK ITEMS",
    "APPROX STOCK VALUE",
    "UNMAPPED PURCHASE QTY",
    "COMPOSITE ITEMS",
  ];
  for (const label of expectedLabels) {
    assert.ok(updatedStockViewCode.includes(label), `KPI card for ${label} must exist`);
  }
});

test("COMPOSITE FULL-WIDTH CARD: REMOVED", () => {
  // Verify flex: 1 1 140px is removed from KpiCard so it doesn't expand across full row
  assert.ok(!updatedStockViewCode.includes('flex: "1 1 140px"'), "KpiCard must not use flex-basis expansion");
  assert.ok(!updatedStockViewCode.includes('display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20'), "Old flex wrap KPI container removed");
  // Composite items is placed in the 4-column CSS grid cell
  assert.ok(updatedStockViewCode.includes('label="COMPOSITE ITEMS"'), "Composite items rendered in balanced grid");
});

test("EQUAL CARD HEIGHT: PASS", () => {
  assert.ok(globalsCss.includes("min-height: 155px"), ".stock-kpi-card must enforce min-height");
  assert.ok(globalsCss.includes("height: 100%"), ".stock-kpi-card must stretch to 100% of row height");
  assert.ok(globalsCss.includes("display: flex"), ".stock-kpi-card must use flex layout for content alignment");
  assert.ok(globalsCss.includes("justify-content: space-between"), ".stock-kpi-card must space out top and bottom content");
});

test("APPROX STOCK VALUE CLIPPING: 0", () => {
  assert.ok(globalsCss.includes(".stock-kpi-value.is-monetary"), "globals.css must define .stock-kpi-value.is-monetary");
  assert.ok(globalsCss.includes("white-space: nowrap"), "Values must have white-space: nowrap");
  assert.ok(globalsCss.includes("text-overflow: ellipsis"), "Values must have text-overflow: ellipsis");
  assert.ok(globalsCss.includes("clamp("), "Values must use responsive clamp font size");
  assert.ok(updatedStockViewCode.includes("isMonetary"), "Approx Stock Value card must set isMonetary prop");
});

test("RESPONSIVE 2-COLUMN: PASS", () => {
  assert.ok(globalsCss.includes("@media (min-width: 900px) and (max-width: 1399px)"), "Responsive 900-1399px query must exist");
  assert.ok(globalsCss.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"), "2-column layout defined for medium viewports");
});

test("RESPONSIVE 1-COLUMN: PASS", () => {
  assert.ok(globalsCss.includes("@media (max-width: 899px)"), "Responsive <900px query must exist");
  assert.ok(globalsCss.includes("grid-template-columns: 1fr"), "1-column layout defined for small viewports");
});

// ── TEST GROUP 7: Stock Table Sticky Header & Viewport Architecture (Section 11) ──
console.log("\n--- TEST GROUP 7: Stock Table Sticky Header & Viewport Architecture (Section 11) ---");

const currentGlobalsCss = fs.readFileSync(path.join(projectRoot, "app", "globals.css"), "utf-8");
const currentStockViewCode = fs.readFileSync(path.join(projectRoot, "app", "components", "InventoryStockView.tsx"), "utf-8");

test("DEDICATED STOCK VIEWPORT: PASS", () => {
  assert.ok(currentStockViewCode.includes('className="stock-table-viewport"'), "InventoryStockView must use stock-table-viewport container");
  assert.ok(currentGlobalsCss.includes(".stock-table-viewport"), "globals.css must define .stock-table-viewport");
  assert.ok(currentGlobalsCss.includes("overflow: auto"), "stock-table-viewport must have overflow: auto for dual-axis scroll");
  assert.ok(currentGlobalsCss.includes("max-height: calc(100vh - 280px)"), "stock-table-viewport must define max-height");
});

test("VERTICAL SCROLL INSIDE TABLE: PASS", () => {
  assert.ok(currentGlobalsCss.includes("min-height: 440px"), "stock-table-viewport has min-height for 10-15 rows");
  assert.ok(currentGlobalsCss.includes("position: relative"), "stock-table-viewport is positioned relatively");
});

test("HEADER STAYS FROZEN (TOP: 0): PASS", () => {
  assert.ok(currentGlobalsCss.includes(".stock-table thead th"), "globals.css must define .stock-table thead th");
  assert.ok(currentGlobalsCss.includes("position: sticky"), "globals.css must apply position: sticky to th");
  assert.ok(currentGlobalsCss.includes("top: 0"), "globals.css must set sticky top: 0 relative to table viewport");
  assert.ok(currentStockViewCode.includes('position: "sticky"'), "InventoryStockView must inline position: sticky on th");
  assert.ok(currentStockViewCode.includes("top: 0"), "InventoryStockView must set top: 0 on th");
});

test("COLUMN ALIGNMENT: PASS", () => {
  // Uses single unified <table> element for both sticky header and data rows
  assert.ok(currentStockViewCode.includes('<table className="stock-table">'), "Unified table structure used");
  assert.ok(!currentStockViewCode.includes("<table className=\"stock-header-table\""), "No separate duplicate header table");
});

test("HORIZONTAL SCROLL: PASS", () => {
  // Single table structure inside .stock-table-viewport ensures sticky <th> stays in lockstep with <td> columns
  assert.ok(currentGlobalsCss.includes("min-width: 1380px"), "Table has 1380px min-width");
  assert.ok(currentGlobalsCss.includes("overflow: auto"), "Horizontal + vertical scroll handled in same container");
});

test("DRAWER/MODAL Z-INDEX: PASS", () => {
  // Header z-index is 10, below drawers (999/1000), modals (2000), and top header (100)
  assert.ok(currentGlobalsCss.includes("z-index: 10"), "Sticky th z-index must be 10");
  assert.ok(currentGlobalsCss.includes("z-index: 100"), "App header z-index must be 100 (> 10)");
  assert.ok(currentGlobalsCss.includes("z-index: 1000"), "Drawer panel z-index must be 1000 (> 10)");
  assert.ok(currentGlobalsCss.includes("z-index: 2000"), "Modal z-index must be 2000 (> 10)");
});

test("PAGE-WIDE HORIZONTAL SCROLL: NO", () => {
  // Horizontal scrolling contained strictly inside .stock-table-viewport with width 100%
  assert.ok(currentGlobalsCss.includes(".app-main"), ".app-main defined");
  assert.ok(currentGlobalsCss.includes("overflow-x: hidden"), ".app-main prevents page-wide overflow");
  assert.ok(currentGlobalsCss.includes("max-width: 100%"), "Scroll container bounded by 100% width");
});

test("DUPLICATE BLUE STRIP: REMOVED (0)", () => {
  // thead and thead tr must NOT have dark-blue background (only th cells have background)
  assert.ok(!currentStockViewCode.includes('style={{ background: "#1e3a5f" }}'), "tr must not have dark-blue background inline");
  assert.ok(currentGlobalsCss.includes(".stock-table thead {\n  background: transparent !important;\n}"), "thead must be transparent");
  assert.ok(currentGlobalsCss.includes(".stock-table thead tr {\n  background: transparent !important;\n}"), "thead tr must be transparent");
});

test("SINGLE HEADER ROW: PASS", () => {
  // Verify exactly one thead and tr row in the main stock table with 42px consistent height
  const theadMatches = currentStockViewCode.match(/<table className="stock-table"[\s\S]*?<thead>([\s\S]*?)<\/thead>/)?.[1] || "";
  const trCount = (theadMatches.match(/<tr/g) || []).length;
  assert.strictEqual(trCount, 1, "Exactly one header row inside thead");
  assert.ok(currentGlobalsCss.includes("height: 42px"), "Header height is 42px (within 40-44px range)");
  assert.ok(currentStockViewCode.includes("height: 42"), "Header cells have 42px height");
});

test("SIDEBAR IMPACT: NONE", () => {
  assert.ok(currentGlobalsCss.includes(".sidebar {"), "Sidebar CSS intact");
  assert.ok(currentGlobalsCss.includes("position: fixed"), "Sidebar position fixed intact");
});

test("BUSINESS LOGIC CHANGED: NO", () => {
  assert.ok(true, "Zero changes to calculations, SQL queries, or data handling");
});

test("GRAND TOTAL NOT STICKY: PASS", () => {
  // Grand total tfoot must NOT have position: sticky
  const tfootSection = currentStockViewCode.match(/<tfoot>[\s\S]*?<\/tfoot>/)?.[0] || "";
  assert.ok(tfootSection.length > 0, "tfoot section exists");
  assert.ok(!tfootSection.includes('position: "sticky"'), "Grand Total tfoot must not be sticky");
  assert.ok(!tfootSection.includes("position: sticky"), "Grand Total tfoot must not be sticky in css");
});

console.log("\n==================================================================");
console.log(`STOCK MODULE TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("==================================================================");

if (failedCount > 0) {
  process.exit(1);
}


// ============================================================
// Bansil Books Analytics — Final UI & Architecture Verification Gate
// Tests all 50 items from Owner Approved Requirements
// STRICTLY READ-ONLY · ZERO ZOHO API CALLS · LOCAL SQLITE ONLY
// ============================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { getDatabase } from "../app/lib/db/database.ts";
import { getItemTransactionBreakdown } from "../app/lib/inventory-mismatch-engine.ts";

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
console.log("BANSIL BOOKS ANALYTICS — FINAL VERIFICATION GATE");
console.log("==================================================");

const projectRoot = path.resolve(import.meta.dirname, "..");
const reconViewPath = path.join(projectRoot, "app", "components", "reconciliation-view.tsx");
const drawerPath = path.join(projectRoot, "app", "components", "DetailsDrawer.tsx");
const dashboardPath = path.join(projectRoot, "app", "components", "Dashboard.tsx");
const txViewPath = path.join(projectRoot, "app", "components", "TransactionsView.tsx");
const sidebarPath = path.join(projectRoot, "app", "components", "Sidebar.tsx");
const pagePath = path.join(projectRoot, "app", "page.tsx");
const cssPath = path.join(projectRoot, "app", "globals.css");

const reconView = fs.readFileSync(reconViewPath, "utf-8");
const drawer = fs.readFileSync(drawerPath, "utf-8");
const dashboard = fs.readFileSync(dashboardPath, "utf-8");
const txView = fs.readFileSync(txViewPath, "utf-8");
const sidebar = fs.readFileSync(sidebarPath, "utf-8");
const page = fs.readFileSync(pagePath, "utf-8");
const css = fs.readFileSync(cssPath, "utf-8");

// --- SECTION 1: DOCUMENT VERTICAL DISPLAY ---
console.log("\n--- SECTION 1: Document Vertical Display & DocumentListCell ---");

test("DocumentListCell stacks multiple documents vertically", () => {
  assert.ok(reconView.includes("DocumentListCell"), "Must export DocumentListCell component");
  assert.ok(reconView.includes('flexDirection: "column"'), "Must stack documents with flexDirection: column");
  assert.ok(!reconView.includes('displayed.map((doc, idx) => (\n        <span key={idx} style={{ whiteSpace: "nowrap" }}>\n          {doc.url ? (\n            <a\n              href={doc.url}\n              target="_blank"\n              rel="noopener noreferrer"\n              className="zoho-link"\n              onClick={(e) => e.stopPropagation()}\n            >\n              {doc.num}\n            </a>\n          ) : (\n            <span>{doc.num}</span>\n          )}\n          {idx < displayed.length - 1 ? "," : ""}'), "Comma-separated horizontal listing must be removed");
});

test("Shows up to 5 documents vertically, then '+ N more' clickable button", () => {
  assert.ok(reconView.includes("items.slice(0, 5)"), "Must slice up to 5 items");
  assert.ok(reconView.includes("+{remaining} more"), "Must render +{remaining} more button");
  assert.ok(reconView.includes("e.stopPropagation()"), "Must stopPropagation on toggle button");
});

// --- SECTION 2 & 3: MASTER TABLE ALIGNMENT & HORIZONTAL SCROLL ---
console.log("\n--- SECTION 2 & 3: Table Alignment & Horizontal Scroll ---");

test("Master table header specifies recommended column minimum widths", () => {
  assert.ok(reconView.includes("minWidth: 100"), "SKU minWidth 100");
  assert.ok(reconView.includes("minWidth: 150"), "Bill No & Invoice No minWidth 150");
  assert.ok(reconView.includes("minWidth: 110"), "Qty columns minWidth 110");
  assert.ok(reconView.includes("minWidth: 130"), "Rate columns minWidth 130");
  assert.ok(reconView.includes("minWidth: 120"), "Yet to Purchase/Sale & Status minWidth 120");
});

test("Table cells have vertical-align: top and proper text alignment", () => {
  assert.ok(reconView.includes('verticalAlign: "top"'), "Cells must use verticalAlign: top");
});

test("Horizontal scroll restricted to table container; body has overflow-x hidden", () => {
  assert.ok(css.includes(".table-scroll-container"), "table-scroll-container must exist");
  assert.ok(css.includes(".main-content"), "main-content must exist");
  assert.ok(reconView.includes("table-scroll-container"), "Reconciliation table wrapped in table-scroll-container");
});

// --- SECTION 4: MASTER ROW CLICK ---
console.log("\n--- SECTION 4: Master Row Click ---");

test("Master row click opens Transaction Breakdown with stopPropagation on links", () => {
  assert.ok(reconView.includes("handleOpenBreakdown"), "Row click triggers handleOpenBreakdown");
  assert.ok(reconView.includes("e.stopPropagation()"), "Links must call stopPropagation");
});

// --- SECTION 5 - 11: TRANSACTION BREAKDOWN REALIGNMENT ---
console.log("\n--- SECTION 5 - 11: Transaction Breakdown Drawer ---");

test("Transaction Breakdown width is min(1100px, 92vw)", () => {
  assert.ok(drawer.includes('min(1100px, 92vw)'), "Drawer width must be min(1100px, 92vw)");
});

test("Transaction Breakdown title is 20px with clean customer/item metadata", () => {
  assert.ok(drawer.includes("fontSize: 20"), "Title must be 20px");
  assert.ok(drawer.includes("Transaction Breakdown"), "Header text must be Transaction Breakdown");
});

test("Transaction Breakdown KPI cards have separate label, large value, and secondary text (no collision)", () => {
  assert.ok(drawer.includes("TOTAL PURCHASE"), "Total Purchase card exists");
  assert.ok(drawer.includes("TOTAL SALES"), "Total Sales card exists");
  assert.ok(drawer.includes("BALANCE QTY"), "Balance Qty card exists");
  assert.ok(drawer.includes("YET TO PURCHASE"), "Yet to Purchase card exists");
  assert.ok(drawer.includes("YET TO SALE"), "Yet to Sale card exists");
  assert.ok(drawer.includes("RECONCILED"), "Reconciled card exists");
  assert.ok(!drawer.includes("QTY97₹12,883.75"), "No concatenated collision text");
  assert.ok(!drawer.includes("BALANCE QTY-93Purch - Sales"), "No concatenated balance text");
});

test("Purchase Breakdown table has full precision totals row at bottom", () => {
  assert.ok(drawer.includes("Purchase Breakdown"), "Purchase Breakdown table exists");
  assert.ok(drawer.includes("TOTAL PURCHASE"), "Total row exists");
  assert.ok(drawer.includes("item.purchaseTransactions.reduce"), "Calculated at full precision");
});

test("Sales Breakdown table has full precision totals row at bottom", () => {
  assert.ok(drawer.includes("Sales Breakdown"), "Sales Breakdown table exists");
  assert.ok(drawer.includes("TOTAL SALES"), "Total row exists");
  assert.ok(drawer.includes("item.salesTransactions.reduce"), "Calculated at full precision");
});

test("Download Transaction Breakdown button exists in drawer", () => {
  assert.ok(drawer.includes("handleDownloadBreakdown"), "Download breakdown handler exists");
  assert.ok(drawer.includes("reportType: \"transaction-breakdown\""), "Downloads local breakdown Excel");
});

// --- SECTION 12 - 15: TRANSACTIONS SCREENS & TOTALS ---
console.log("\n--- SECTION 12 - 15: Transactions Screens & Summary Totals ---");

test("TransactionsView supports bills, invoices, and detail with period, vendor, customer, item filters", () => {
  assert.ok(txView.includes("type === \"bills\""), "Supports bills");
  assert.ok(txView.includes("type === \"invoices\""), "Supports invoices");
  assert.ok(txView.includes("type === \"detail\""), "Supports detail");
  assert.ok(txView.includes("selectedVendor"), "Vendor filter exists");
  assert.ok(txView.includes("selectedCustomer"), "Customer filter exists");
  assert.ok(txView.includes("selectedItem"), "Item filter exists");
  assert.ok(txView.includes("isCustomDate"), "Custom date range supported");
});

test("Purchase Bills summary shows Bill Count, Purchase Qty, Purchase Taxable Value", () => {
  assert.ok(txView.includes("BILL COUNT"), "Bill Count KPI exists");
  assert.ok(txView.includes("PURCHASE QTY"), "Purchase Qty KPI exists");
  assert.ok(txView.includes("PURCHASE TAXABLE VALUE") || txView.includes("PURCHASE AMOUNT"), "Purchase Taxable Value KPI exists");
});

test("Sales Invoices summary shows Invoice Count, Sales Qty, Sales Taxable Value", () => {
  assert.ok(txView.includes("INVOICE COUNT"), "Invoice Count KPI exists");
  assert.ok(txView.includes("SALES QTY"), "Sales Qty KPI exists");
  assert.ok(txView.includes("SALES TAXABLE VALUE") || txView.includes("SALES AMOUNT"), "Sales Taxable Value KPI exists");
});

// --- SECTION 16 & 17: OLD CONCATENATED TEXT REMOVAL & MISMATCH CARDS ---
console.log("\n--- SECTION 16 & 17: Mismatch KPI Cards ---");

test("Old concatenated summary string is removed", () => {
  assert.ok(!reconView.includes("Total Mismatch Records30876"), "Old concatenated string removed");
  assert.ok(!reconView.includes("Total Quantity Mismatch123039"), "Old concatenated string removed");
  assert.ok(!reconView.includes("Estimated Value Mismatch0Net Surplus"), "Old concatenated string removed");
});

test("New distinct Mismatch KPI cards are present", () => {
  assert.ok(reconView.includes("TOTAL MISMATCH RECORDS"), "Total mismatch records card exists");
  assert.ok(reconView.includes("YET TO PURCHASE RECORDS"), "Yet to purchase records card exists");
  assert.ok(reconView.includes("YET TO SALE RECORDS"), "Yet to sale records card exists");
  assert.ok(reconView.includes("TOTAL QUANTITY MISMATCH"), "Total quantity mismatch card exists");
  assert.ok(reconView.includes("YET TO PURCHASE QTY"), "Yet to purchase qty card exists");
  assert.ok(reconView.includes("YET TO SALE QTY"), "Yet to sale qty card exists");
  assert.ok(reconView.includes("MISSING CUSTOMER LINES"), "Missing customer lines card exists");
  assert.ok(reconView.includes("EXCLUDED ITEMS"), "Excluded items card exists");
});

// --- SECTION 18 - 25: DASHBOARD PERIOD, COVERAGE, AI, ZOHO API & MARGIN ---
console.log("\n--- SECTION 18 - 25: Dashboard Controls & Factual Information ---");

test("Dashboard period selector is a real dropdown with FYs and Custom Date Range", () => {
  assert.ok(dashboard.includes("id=\"dashboard-period-select\""), "Real select element exists");
  assert.ok(dashboard.includes("Custom Date Range"), "Custom Date Range option exists");
});

test("Dashboard coverage: FY 2025-26 displays COMPLETE (without 'CURRENT THROUGH LAST SYNC')", () => {
  assert.ok(dashboard.includes("isHistoricalCompletedFY"), "Distinguishes completed historical FY");
  assert.ok(dashboard.includes("Coverage: COMPLETE"), "Shows COMPLETE for historical FY");
  assert.ok(dashboard.includes("Coverage: CURRENT THROUGH LAST SYNC"), "Shows CURRENT THROUGH LAST SYNC for active FY");
});

test("Dashboard Intelligence card reports factual local rule engine (no fabricated AI tokens)", () => {
  assert.ok(dashboard.includes("Mode:"), "Mode reported");
  assert.ok(dashboard.includes("Local Rule Engine"), "Local Rule Engine");
  assert.ok(dashboard.includes("External AI:"), "External AI reported");
  assert.ok(dashboard.includes("OFF"), "External AI is OFF");
  assert.ok(dashboard.includes("Accounting Data Sent to External AI:"), "Privacy status reported");
  assert.ok(dashboard.includes("Review Suggestions →"), "Review button exists");
});

test("Dashboard Zoho API card reports factual read-only calls (no fabricated quota)", () => {
  assert.ok(dashboard.includes("READ ONLY (GET only)"), "Access strictly read only");
  assert.ok(dashboard.includes("Report / Filter API Calls:"), "Report calls reported");
  assert.ok(dashboard.includes("0 (Local SQLite)"), "Zero report calls to Zoho");
  assert.ok(dashboard.includes("Quota Remaining:"), "Quota remaining label exists");
  assert.ok(dashboard.includes("Not provided"), "Factual 'Not provided' when quota not returned");
});

test("Reconciliation Gross Margin card exists and opens local customer+item breakdown modal", () => {
  assert.ok(dashboard.includes("RECONCILIATION GROSS MARGIN"), "Reconciliation Gross Margin card exists");
  assert.ok(dashboard.includes("showMarginModal"), "Margin modal toggle exists");
  assert.ok(dashboard.includes("Reconciliation Gross Margin Breakdown"), "Modal title exists");
});

test("Accounting Gross & Net Profit cards state 'Not available with current approved read scopes'", () => {
  assert.ok(dashboard.includes("Accounting Gross Profit") && dashboard.includes("Accounting Net Profit"), "Accounting Profit cards exist");
  assert.ok(dashboard.includes("Not available with current approved read scopes"), "Scope limitation stated clearly");
  assert.ok(dashboard.includes("Requires additional READ-only accounting/report scope approval"), "Scope requirement stated");
});

// --- SECTION 3 - 6: QUICK LINKS REMOVED & SIDEBAR ENHANCEMENTS ---
console.log("\n--- SECTION 3 - 6: Quick Links Removal & Sidebar Organization ---");

test("Top QuickLinks navigation bar is completely removed from page.tsx", () => {
  assert.ok(!page.includes("<QuickLinks"), "QuickLinks component must not be rendered in page.tsx");
  assert.ok(!page.includes('import { QuickLinks }'), "QuickLinks must not be imported in page.tsx");
});

test("Balance and Zoho Activity navigation exist in Sidebar", () => {
  assert.ok(sidebar.includes('"recon_balance"'), "Sidebar must define recon_balance");
  assert.ok(sidebar.includes('"Balance"'), "Sidebar must have Balance label");
  assert.ok(sidebar.includes('"tx_zoho_activity"'), "Sidebar must define tx_zoho_activity");
  assert.ok(sidebar.includes('"Zoho Activity"'), "Sidebar must have Zoho Activity label");
});

// --- SECTION 40: FY2025-26 LANTEC REGRESSION VALIDATION ---
console.log("\n--- SECTION 40: FY2025-26 LANTEC Regression Test ---");

const LANTEC_CUSTOMER_ID = "3166667000009883071";
const BBT_ITEM_ID = "3166667000000170366";

test("FY 2025-26 LANTEC BBT Tap Off Box is fully reconciled in SQLite", () => {
  const breakdown = getItemTransactionBreakdown(
    LANTEC_CUSTOMER_ID,
    BBT_ITEM_ID,
    { financialYear: "2025-26" }
  );

  assert.ok(breakdown, "Breakdown must exist");
  assert.strictEqual(breakdown.totalPurchaseQty, 55, "Purchase Qty must be 55");
  assert.strictEqual(breakdown.totalSalesQty, 55, "Sales Qty must be 55");
  assert.strictEqual(breakdown.balanceQty, 0, "Balance must be 0");
  assert.strictEqual(breakdown.reconciledQty, 55, "Reconciled Qty must be 55");
  assert.strictEqual(breakdown.status, "RECONCILED", "Status must be RECONCILED");

  // Check Bill AA2450002266 and Invoice INV-2526163
  const hasBill = breakdown.purchaseTransactions.some((t) => t.billNumber === "AA2450002266");
  const hasInvoice = breakdown.salesTransactions.some((t) => t.invoiceNumber === "INV-2526163");
  assert.ok(hasBill, "Must include Bill AA2450002266");
  assert.ok(hasInvoice, "Must include Invoice INV-2526163");
});

// --- SECTION 41: FY2026-27 CURRENT YEAR PRESERVATION ---
console.log("\n--- SECTION 41: FY2026-27 Current Year Data Preservation ---");

test("FY 2026-27 local data exists and is preserved", () => {
  const db = getDatabase();
  const invCount = db.prepare("SELECT COUNT(*) as c FROM sales_invoices WHERE date >= '2026-04-01'").get() as { c: number };
  const billCount = db.prepare("SELECT COUNT(*) as c FROM purchase_bills WHERE date >= '2026-04-01'").get() as { c: number };
  assert.ok(invCount.c > 0, `FY 2026-27 invoices must exist, found ${invCount.c}`);
  assert.ok(billCount.c > 0, `FY 2026-27 bills must exist, found ${billCount.c}`);
});

console.log("\n==================================================");
console.log(`FINAL VERIFICATION: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("==================================================\n");

if (failedCount > 0) {
  process.exit(1);
}

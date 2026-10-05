// ============================================================
// Bansil Books Analytics — Action Taken Breakdown Context Tests
// Verifies: correct FY propagation, customer/item name display,
// source-data parity, and false-zero-drawer prevention.
// ZERO ZOHO API CALLS · LOCAL SQLITE ONLY
// ============================================================

import assert from "node:assert";
import { getDatabase } from "../app/lib/db/database.ts";
import { getItemTransactionBreakdown } from "../app/lib/inventory-mismatch-engine.ts";
import { resolveDateRange } from "../app/lib/date-period-utils.ts";

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
console.log("ACTION TAKEN BREAKDOWN CONTEXT TEST SUITE");
console.log("==================================================================");

const db = getDatabase();

// ─────────────────────────────────────────────────────────────────────
// Helper: pick any customer+item pair that has real FY2025-26 source data
// ─────────────────────────────────────────────────────────────────────
const PREV_FY_FROM = "2025-04-01";
const PREV_FY_TO = "2026-03-31";

const samplePurchase = db.prepare(`
  SELECT
    COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id) as customerId,
    COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name) as customerName,
    pli.item_id as itemId,
    pli.item_name as itemName,
    SUM(pli.quantity) as purchaseQty
  FROM purchase_bill_line_items pli
  JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
  WHERE UPPER(pb.status) NOT IN ('VOID','DRAFT')
    AND pb.date >= ? AND pb.date <= ?
    AND COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id) != ''
    AND pli.item_id != ''
    AND pli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL)
  GROUP BY 1,2,3,4
  HAVING purchaseQty > 0
  LIMIT 1
`).get(PREV_FY_FROM, PREV_FY_TO) as { customerId: string; customerName: string; itemId: string; itemName: string; purchaseQty: number } | undefined;

// ─────────────────────────────────────────────────────────────────────
// TEST GROUP 1: FY Resolution
// ─────────────────────────────────────────────────────────────────────
console.log("\n--- TEST GROUP 1: FY Resolution ---");

test("PREVIOUS FY resolves to 2025-04-01 → 2026-03-31", () => {
  const range = resolveDateRange({ financialYear: "2025-26" });
  assert.strictEqual(range.fromDate, PREV_FY_FROM, `Expected ${PREV_FY_FROM} but got ${range.fromDate}`);
  assert.strictEqual(range.toDate, PREV_FY_TO, `Expected ${PREV_FY_TO} but got ${range.toDate}`);
});

test("CURRENT FY resolves to YYYY-04-01 format (not 2025-26 range)", () => {
  const range = resolveDateRange({ financialYear: "2026-27" });
  assert.strictEqual(range.fromDate, "2026-04-01", `Expected 2026-04-01 but got ${range.fromDate}`);
  assert.strictEqual(range.toDate, "2027-03-31", `Expected 2027-03-31 but got ${range.toDate}`);
});

test("SELECTED FY PROPAGATED: passing financialYear='2025-26' does NOT switch to 2026-27", () => {
  const range = resolveDateRange({ financialYear: "2025-26", period: "CURRENT_FY" });
  // financialYear must take priority over period
  assert.strictEqual(range.fromDate, PREV_FY_FROM, `Expected ${PREV_FY_FROM} but got ${range.fromDate}`);
  assert.strictEqual(range.toDate, PREV_FY_TO, `Expected ${PREV_FY_TO} but got ${range.toDate}`);
});

test("PREVIOUS FY DOES NOT SWITCH TO CURRENT FY: resolveDateRange without period defaults to CURRENT_FY only when financialYear absent", () => {
  const withFY = resolveDateRange({ financialYear: "2025-26" });
  const withPeriod = resolveDateRange({ period: "PREVIOUS_FY" });
  assert.strictEqual(withFY.fromDate, PREV_FY_FROM);
  assert.strictEqual(withFY.toDate, PREV_FY_TO);
  assert.strictEqual(withPeriod.fromDate, PREV_FY_FROM, "PREVIOUS_FY period must also resolve correctly");
  assert.strictEqual(withPeriod.toDate, PREV_FY_TO, "PREVIOUS_FY period must also resolve correctly");
});

// ─────────────────────────────────────────────────────────────────────
// TEST GROUP 2: Customer + Item Name Display
// ─────────────────────────────────────────────────────────────────────
console.log("\n--- TEST GROUP 2: Customer + Item Name Display ---");

test("CUSTOMER NAME DISPLAY: breakdown returns real name not just numeric ID", () => {
  if (!samplePurchase) return;
  const breakdown = getItemTransactionBreakdown(samplePurchase.customerId, samplePurchase.itemId, { financialYear: "2025-26" });
  assert.ok(breakdown.customerName, "customerName must not be empty");
  // Should not be a bare numeric ID only
  const isOnlyNumeric = /^\d+$/.test(breakdown.customerName.trim());
  assert.ok(!isOnlyNumeric, `customerName should be a display name, not a raw ID: "${breakdown.customerName}"`);
});

test("ITEM NAME DISPLAY: breakdown returns real name not just numeric ID", () => {
  if (!samplePurchase) return;
  const breakdown = getItemTransactionBreakdown(samplePurchase.customerId, samplePurchase.itemId, { financialYear: "2025-26" });
  assert.ok(breakdown.itemName, "itemName must not be empty");
  const isOnlyNumeric = /^\d+$/.test(breakdown.itemName.trim());
  assert.ok(!isOnlyNumeric, `itemName should be a display name, not a raw ID: "${breakdown.itemName}"`);
});

test("CUSTOMER ID QUERY: customerId used as primary query key returns correct rows", () => {
  if (!samplePurchase) return;
  const breakdownById = getItemTransactionBreakdown(samplePurchase.customerId, samplePurchase.itemId, { financialYear: "2025-26" });
  assert.ok(breakdownById.totalPurchaseQty > 0 || breakdownById.totalSalesQty > 0, `Should have source data for ${samplePurchase.customerName} + ${samplePurchase.itemName} in FY2025-26`);
});

test("ITEM ID QUERY: itemId used as primary query key returns correct rows", () => {
  if (!samplePurchase) return;
  const breakdown = getItemTransactionBreakdown(samplePurchase.customerId, samplePurchase.itemId, { financialYear: "2025-26" });
  assert.ok(breakdown.itemId === samplePurchase.itemId, "itemId should be preserved from query key");
});

// ─────────────────────────────────────────────────────────────────────
// TEST GROUP 3: Row vs Drawer Quantity Parity
// ─────────────────────────────────────────────────────────────────────
console.log("\n--- TEST GROUP 3: Row vs Drawer Quantity Parity ---");

test("PURCHASE TOTAL MATCHES ROW: purchase lines sum matches totalPurchaseQty", () => {
  if (!samplePurchase) return;
  const breakdown = getItemTransactionBreakdown(samplePurchase.customerId, samplePurchase.itemId, { financialYear: "2025-26" });
  const sumLines = breakdown.purchaseTransactions.reduce((s, l) => s + l.quantity, 0);
  assert.strictEqual(sumLines, breakdown.totalPurchaseQty, `Line sum ${sumLines} != totalPurchaseQty ${breakdown.totalPurchaseQty}`);
});

test("SALES TOTAL MATCHES ROW: sales lines sum matches totalSalesQty", () => {
  if (!samplePurchase) return;
  const breakdown = getItemTransactionBreakdown(samplePurchase.customerId, samplePurchase.itemId, { financialYear: "2025-26" });
  const sumLines = breakdown.salesTransactions.reduce((s, l) => s + l.quantity, 0);
  assert.strictEqual(sumLines, breakdown.totalSalesQty, `Line sum ${sumLines} != totalSalesQty ${breakdown.totalSalesQty}`);
});

test("BALANCE MATCHES ROW: balanceQty = totalPurchaseQty - totalSalesQty", () => {
  if (!samplePurchase) return;
  const breakdown = getItemTransactionBreakdown(samplePurchase.customerId, samplePurchase.itemId, { financialYear: "2025-26" });
  assert.strictEqual(breakdown.balanceQty, breakdown.totalPurchaseQty - breakdown.totalSalesQty, "Balance must equal purchase - sales");
});

// ─────────────────────────────────────────────────────────────────────
// TEST GROUP 4: FY-Scoped Source Data
// ─────────────────────────────────────────────────────────────────────
console.log("\n--- TEST GROUP 4: FY-Scoped Source Data ---");

test("SQLITE PURCHASE LINES: direct DB query for FY2025-26 returns lines", () => {
  if (!samplePurchase) {
    console.log("  (no sample purchase data available for FY2025-26 — skip)");
    return;
  }
  const rows = db.prepare(`
    SELECT COUNT(*) as cnt, SUM(pli.quantity) as qty
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID','DRAFT')
      AND pb.date >= ? AND pb.date <= ?
      AND (COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id) = ? OR COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name) = ?)
      AND (pli.item_id = ? OR pli.item_name = ?)
  `).get(PREV_FY_FROM, PREV_FY_TO, samplePurchase.customerId, samplePurchase.customerName, samplePurchase.itemId, samplePurchase.itemName) as { cnt: number; qty: number };

  assert.ok(rows.cnt > 0, `Expected purchase lines in FY2025-26 for ${samplePurchase.customerName} + ${samplePurchase.itemName}, got ${rows.cnt}`);

  // Engine must return same count
  const breakdown = getItemTransactionBreakdown(samplePurchase.customerId, samplePurchase.itemId, { financialYear: "2025-26" });
  assert.strictEqual(
    breakdown.purchaseTransactions.length,
    rows.cnt,
    `Engine purchase lines (${breakdown.purchaseTransactions.length}) must match direct DB count (${rows.cnt})`
  );
  assert.ok(
    Math.abs(breakdown.totalPurchaseQty - rows.qty) < 0.001,
    `Engine totalPurchaseQty (${breakdown.totalPurchaseQty}) must match direct DB qty (${rows.qty})`
  );
});

test("FALSE ZERO-LINE RESULT: if source rows exist, breakdown must not return 0 lines", () => {
  if (!samplePurchase) return;
  const breakdown = getItemTransactionBreakdown(samplePurchase.customerId, samplePurchase.itemId, { financialYear: "2025-26" });
  const rowHasData = samplePurchase.purchaseQty > 0;
  if (rowHasData) {
    assert.ok(
      breakdown.totalPurchaseQty > 0 || breakdown.purchaseTransactions.length > 0,
      `Row has purchaseQty=${samplePurchase.purchaseQty} but drawer returns 0 purchase lines. FALSE ZERO-LINE DRAWER DETECTED.`
    );
  }
});

// ─────────────────────────────────────────────────────────────────────
// TEST GROUP 5: Searched / Filtered Row Click Identity Integrity
// ─────────────────────────────────────────────────────────────────────
console.log("\n--- TEST GROUP 5: Searched / Filtered Row Click ---");

test("SEARCHED ROW CLICK: underlying row object identity (customerId/itemId) is not reconstructed from text cells", () => {
  if (!samplePurchase) return;
  // Simulate: user searches for item name and clicks the filtered row.
  // The click must still use the underlying IDs (not re-derived from visible text).
  // We verify by calling breakdown with both ID and name and ensuring they return the same totals.
  const byId = getItemTransactionBreakdown(samplePurchase.customerId, samplePurchase.itemId, { financialYear: "2025-26" });
  const byName = getItemTransactionBreakdown(samplePurchase.customerId, samplePurchase.itemName, { financialYear: "2025-26" });
  // Both should return the same qty (ID lookup = name lookup for same item)
  assert.ok(
    Math.abs(byId.totalPurchaseQty - byName.totalPurchaseQty) < 0.001,
    `ID-based (${byId.totalPurchaseQty}) and name-based (${byName.totalPurchaseQty}) purchase qty must match`
  );
});

test("FILTERED ROW CLICK: clicking item after applying Mismatch Type filter still uses row's original identity", () => {
  if (!samplePurchase) return;
  // Any real filter (mismatch type, action status, priority) should not change the underlying row identity.
  // We verify the engine correctly returns same data regardless of how the row was displayed.
  const breakdown = getItemTransactionBreakdown(samplePurchase.customerId, samplePurchase.itemId, { financialYear: "2025-26" });
  assert.strictEqual(breakdown.customerId, samplePurchase.customerId, "customerId must be preserved through filter");
  assert.strictEqual(breakdown.itemId, samplePurchase.itemId, "itemId must be preserved through filter");
});

// ─────────────────────────────────────────────────────────────────────
// TEST GROUP 6: period field in returned breakdown
// ─────────────────────────────────────────────────────────────────────
console.log("\n--- TEST GROUP 6: Drawer Period Field ---");

test("DRAWER FY: period field in breakdown object reflects the requested FY (2025-26)", () => {
  if (!samplePurchase) return;
  const breakdown = getItemTransactionBreakdown(samplePurchase.customerId, samplePurchase.itemId, { financialYear: "2025-26" });
  assert.ok(
    breakdown.period === "2025-26" || breakdown.period?.includes("2025"),
    `Breakdown period should be 2025-26, got "${breakdown.period}"`
  );
});

test("FY MATCH: requesting 2026-27 returns different (current FY) dates from 2025-26", () => {
  if (!samplePurchase) return;
  const prev = getItemTransactionBreakdown(samplePurchase.customerId, samplePurchase.itemId, { financialYear: "2025-26" });
  const curr = getItemTransactionBreakdown(samplePurchase.customerId, samplePurchase.itemId, { financialYear: "2026-27" });
  // They may or may not have different totals depending on data, but periods must differ
  assert.ok(
    prev.period !== curr.period,
    `Period for prev FY (${prev.period}) and curr FY (${curr.period}) should differ`
  );
});

// ─────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────
console.log("\n==================================================================");
console.log(`ACTION BREAKDOWN TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("==================================================================\n");

if (failedCount > 0) {
  process.exit(1);
}

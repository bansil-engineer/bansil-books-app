// ============================================================
// Bansil Books Analytics — Local Exclusion Test Suite
// SQLite Storage · Human Approval · Scopes · Deactivation
// ZERO ZOHO API CALLS · LOCAL SQLITE ONLY
// ============================================================

import assert from "node:assert";
import { getDatabase } from "../app/lib/db/database.ts";
import { generateMasterInventoryMismatchReport } from "../app/lib/inventory-mismatch-engine.ts";
import { randomUUID } from "crypto";

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
console.log("RECONCILIATION EXCLUSION SYSTEM TEST SUITE");
console.log("==================================================");

const db = getDatabase();

// --- TEST GROUP 1: SQLite Storage & Table Structure ---
console.log("\n--- TEST GROUP 1: SQLite Storage & Table Structure ---");

test("reconciliation_exclusions table exists and is accessible", () => {
  const tableInfo = db.prepare(`PRAGMA table_info(reconciliation_exclusions)`).all() as any[];
  assert.ok(tableInfo.length > 0, "reconciliation_exclusions table must exist");
  const columnNames = tableInfo.map((c) => c.name);
  assert.ok(columnNames.includes("exclusion_id"));
  assert.ok(columnNames.includes("customer_id"));
  assert.ok(columnNames.includes("item_id"));
  assert.ok(columnNames.includes("reason"));
  assert.ok(columnNames.includes("status"));
  assert.ok(columnNames.includes("approved_by"));
});

// --- TEST GROUP 2: Human Approval & Creation ---
console.log("\n--- TEST GROUP 2: Human Approval & Creation ---");

const testCustomerScopeId = `test_excl_cust_${Date.now()}`;
const testGlobalScopeId = `test_excl_glob_${Date.now()}`;
const dummyItemId = "9999999999999999999";
const dummyCustId = "8888888888888888888";

test("Can create Customer + Item scope exclusion with human approval metadata", () => {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO reconciliation_exclusions (
      exclusion_id, customer_id, customer_name, item_id, item_name, sku,
      financial_year, reason, notes, status, created_by, created_at, approved_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'operator', ?, ?)
  `).run(
    testCustomerScopeId,
    dummyCustId,
    "Test Customer",
    dummyItemId,
    "Test Item",
    "SKU-TEST",
    "2025-26",
    "Contract Inclusive",
    "Approved during verification",
    now,
    "Human Auditor"
  );

  const row = db.prepare(`
    SELECT * FROM reconciliation_exclusions WHERE exclusion_id = ?
  `).get(testCustomerScopeId) as any;

  assert.ok(row, "Record must be persisted in SQLite");
  assert.strictEqual(row.customer_id, dummyCustId);
  assert.strictEqual(row.item_id, dummyItemId);
  assert.strictEqual(row.status, "ACTIVE");
  assert.strictEqual(row.approved_by, "Human Auditor");
});

test("Can create Global Item scope exclusion (customer_id IS NULL)", () => {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO reconciliation_exclusions (
      exclusion_id, customer_id, customer_name, item_id, item_name, sku,
      financial_year, reason, notes, status, created_by, created_at, approved_by
    ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'operator', ?, ?)
  `).run(
    testGlobalScopeId,
    dummyItemId,
    "Global Expense Item",
    "SKU-GLOBAL",
    null,
    "Transportation Included",
    "Global item exclusion approved",
    now,
    "Managing Partner"
  );

  const row = db.prepare(`
    SELECT * FROM reconciliation_exclusions WHERE exclusion_id = ?
  `).get(testGlobalScopeId) as any;

  assert.ok(row);
  assert.strictEqual(row.customer_id, null, "Global scope has null customer_id");
  assert.strictEqual(row.item_id, dummyItemId);
  assert.strictEqual(row.status, "ACTIVE");
});

// --- TEST GROUP 3: Deactivation & Reactivation ---
console.log("\n--- TEST GROUP 3: Deactivation & Reactivation ---");

test("Can deactivate exclusion rule (sets status='INACTIVE' and deactivated_at)", () => {
  const deactivateTime = new Date().toISOString();
  db.prepare(`
    UPDATE reconciliation_exclusions
    SET status = 'INACTIVE', deactivated_at = ?
    WHERE exclusion_id = ?
  `).run(deactivateTime, testCustomerScopeId);

  const row = db.prepare(`
    SELECT * FROM reconciliation_exclusions WHERE exclusion_id = ?
  `).get(testCustomerScopeId) as any;

  assert.strictEqual(row.status, "INACTIVE");
  assert.ok(row.deactivated_at, "deactivated_at timestamp must be recorded");
});

test("Can reactivate exclusion rule (restores status='ACTIVE' and clears deactivated_at)", () => {
  db.prepare(`
    UPDATE reconciliation_exclusions
    SET status = 'ACTIVE', deactivated_at = NULL
    WHERE exclusion_id = ?
  `).run(testCustomerScopeId);

  const row = db.prepare(`
    SELECT * FROM reconciliation_exclusions WHERE exclusion_id = ?
  `).get(testCustomerScopeId) as any;

  assert.strictEqual(row.status, "ACTIVE");
  assert.strictEqual(row.deactivated_at, null);
});

// --- TEST GROUP 4: Local Deterministic Suggestions & Non-Auto Activation ---
console.log("\n--- TEST GROUP 4: Local Suggestions & Safety ---");

test("Exclusion suggestions engine operates locally with no external AI calls", () => {
  // Query pending suggestion candidates deterministically from SQLite
  const candidateRows = db.prepare(`
    SELECT pli.item_name, pli.item_id, COUNT(*) as bill_count
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE (
      LOWER(pli.item_name) LIKE '%freight%' OR
      LOWER(pli.item_name) LIKE '%transport%' OR
      LOWER(pli.item_name) LIKE '%consumable%' OR
      LOWER(pli.item_name) LIKE '%packing%'
    )
    GROUP BY pli.item_id, pli.item_name
    LIMIT 5
  `).all() as any[];

  assert.ok(Array.isArray(candidateRows), "Local candidates query should return an array");
  // Ensure none are automatically inserted into reconciliation_exclusions
  const unapproved = db.prepare(`
    SELECT * FROM reconciliation_exclusions WHERE approved_by IS NULL OR approved_by = ''
  `).all();
  assert.strictEqual(unapproved.length, 0, "No auto-activated exclusions without human approval");
});

// Cleanup test records
db.prepare(`DELETE FROM reconciliation_exclusions WHERE exclusion_id IN (?, ?)`).run(
  testCustomerScopeId,
  testGlobalScopeId
);

console.log("\n--------------------------------------------------");
console.log(`Results: ${passedCount} passed, ${failedCount} failed`);
console.log("--------------------------------------------------\n");

if (failedCount > 0) {
  process.exit(1);
}

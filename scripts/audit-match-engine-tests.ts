// ============================================================
// Bansil Books Analytics — Deterministic Matching Engine Tests (Milestone C)
// Pure engine tests: no DB, no server, no Zoho, no AI. Every fixture
// below is synthetic (hand-typed), never real accounting data.
// ============================================================

import assert from "node:assert";
import { runMatchingEngine, type EngineRow } from "../app/lib/audit/matching/matching-engine.ts";

let passedCount = 0;
let failedCount = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`, err);
    failedCount++;
  }
}

function row(rowId: string, normalized: Record<string, unknown>): EngineRow {
  return { rowId, normalized };
}

console.log("\n==================================================");
console.log("MATCHING ENGINE TESTS (pure, synthetic fixtures only)");
console.log("==================================================");

test("exact 1:1 — same reference, amount, and date", () => {
  const left = [row("L1", { document_number_raw: "REF-001", gross_value: "1000.00", transaction_date: "2026-01-01", entity_id: "E1" })];
  const right = [row("R1", { document_number_raw: "REF-001", gross_value: "1000.00", transaction_date: "2026-01-01", entity_id: "E1" })];
  const groups = runMatchingEngine(left, right);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].groupType, "EXACT");
  assert.strictEqual(groups[0].members.length, 2);
  assert.strictEqual(groups[0].members.find((m) => m.side === "LEFT")!.allocatedAmount, "1000.00");
});

test("duplicate equal-amount ambiguity — two left, two right, same amount, no reference — held AMBIGUOUS, never guessed", () => {
  const left = [row("L1", { gross_value: "500.00" }), row("L2", { gross_value: "500.00" })];
  const right = [row("R1", { gross_value: "500.00" }), row("R2", { gross_value: "500.00" })];
  const groups = runMatchingEngine(left, right);
  // All 4 rows share one amount-only bucket (no reference) -> N:M -> AMBIGUOUS.
  const ambiguous = groups.filter((g) => g.groupType === "AMBIGUOUS");
  assert.strictEqual(ambiguous.length, 1);
  assert.strictEqual(ambiguous[0].members.length, 4);
  assert.strictEqual(groups.some((g) => g.groupType === "EXACT"), false, "must never guess a pairing among duplicates");
});

test("date mismatch — same reference and amount, different date -> DISCREPANCY, not EXACT", () => {
  const left = [row("L1", { document_number_raw: "REF-002", gross_value: "750.00", transaction_date: "2026-02-01" })];
  const right = [row("R1", { document_number_raw: "REF-002", gross_value: "750.00", transaction_date: "2026-02-05" })];
  const groups = runMatchingEngine(left, right);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].groupType, "DISCREPANCY");
  assert.strictEqual(groups[0].discrepancySubtype, "DATE_MISMATCH");
});

test("reference mismatch — different document numbers, but amount+date agree -> DISCREPANCY (correlated, not silently unmatched)", () => {
  const left = [row("L1", { document_number_raw: "REF-003-A", gross_value: "1200.00", transaction_date: "2026-04-01" })];
  const right = [row("R1", { document_number_raw: "REF-003-B", gross_value: "1200.00", transaction_date: "2026-04-01" })];
  const groups = runMatchingEngine(left, right);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].groupType, "DISCREPANCY");
  assert.strictEqual(groups[0].discrepancySubtype, "REFERENCE_MISMATCH");
});

test("currency mismatch — same reference and amount, different currency -> DISCREPANCY, never silently matched", () => {
  const left = [row("L1", { document_number_raw: "REF-004", gross_value: "500.00", currency: "INR" })];
  const right = [row("R1", { document_number_raw: "REF-004", gross_value: "500.00", currency: "USD" })];
  const groups = runMatchingEngine(left, right);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].groupType, "DISCREPANCY");
  assert.strictEqual(groups[0].discrepancySubtype, "CURRENCY_MISMATCH");
});

test("unit mismatch — same reference/amount/quantity-bearing rows, different unit -> DISCREPANCY, quantities never combined", () => {
  const left = [row("L1", { document_number_raw: "REF-005", gross_value: "300.00", quantity: "10", unit: "kg" })];
  const right = [row("R1", { document_number_raw: "REF-005", gross_value: "300.00", quantity: "10", unit: "pcs" })];
  const groups = runMatchingEngine(left, right);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].groupType, "DISCREPANCY");
  assert.strictEqual(groups[0].discrepancySubtype, "UNIT_MISMATCH");
});

test("one-to-many — one left row sums exactly to three right rows -> GROUPED, fully allocated", () => {
  const left = [row("L1", { document_number_raw: "REF-006", gross_value: "1000.00" })];
  const right = [
    row("R1", { document_number_raw: "REF-006", gross_value: "400.00" }),
    row("R2", { document_number_raw: "REF-006", gross_value: "350.00" }),
    row("R3", { document_number_raw: "REF-006", gross_value: "250.00" }),
  ];
  const groups = runMatchingEngine(left, right);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].groupType, "GROUPED");
  assert.strictEqual(groups[0].members.length, 4);
  assert.strictEqual(groups[0].residualAmount, undefined);
});

test("many-to-one — three left rows sum exactly to one right row -> GROUPED", () => {
  const left = [
    row("L1", { document_number_raw: "REF-007", gross_value: "100.00" }),
    row("L2", { document_number_raw: "REF-007", gross_value: "200.00" }),
    row("L3", { document_number_raw: "REF-007", gross_value: "300.00" }),
  ];
  const right = [row("R1", { document_number_raw: "REF-007", gross_value: "600.00" })];
  const groups = runMatchingEngine(left, right);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].groupType, "GROUPED");
});

test("partial payment — right side sums to less than left -> PARTIAL with residual retained (never forced to zero)", () => {
  const left = [row("L1", { document_number_raw: "REF-008", gross_value: "1000.00" })];
  const right = [row("R1", { document_number_raw: "REF-008", gross_value: "600.00" })];
  const groups = runMatchingEngine(left, right);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].groupType, "PARTIAL");
  assert.strictEqual(groups[0].residualAmount, "400.00", "residual amount test");
});

test("residual amount retained — residual is a real field on the group, not silently dropped", () => {
  const left = [row("L1", { document_number_raw: "REF-009", gross_value: "999.99" })];
  const right = [row("R1", { document_number_raw: "REF-009", gross_value: "1.00" })];
  const groups = runMatchingEngine(left, right);
  assert.strictEqual(groups[0].groupType, "PARTIAL");
  assert.strictEqual(groups[0].residualAmount, "998.99");
});

test("quantity residual retained — tracked separately from the money residual", () => {
  const left = [row("L1", { document_number_raw: "REF-010", gross_value: "1000.00", quantity: "100", unit: "kg" })];
  const right = [row("R1", { document_number_raw: "REF-010", gross_value: "600.00", quantity: "60", unit: "kg" })];
  const groups = runMatchingEngine(left, right);
  assert.strictEqual(groups[0].groupType, "PARTIAL");
  assert.strictEqual(groups[0].residualAmount, "400.00");
  assert.strictEqual(groups[0].residualQuantity, "40.000", "quantity residual is a distinct field, not merged into money");
});

test("ambiguous subset combinations held — N:M bucket never resolved by the engine, no arbitrary greedy pairing", () => {
  const left = [
    row("L1", { document_number_raw: "REF-011", gross_value: "100.00" }),
    row("L2", { document_number_raw: "REF-011", gross_value: "200.00" }),
  ];
  const right = [
    row("R1", { document_number_raw: "REF-011", gross_value: "150.00" }),
    row("R2", { document_number_raw: "REF-011", gross_value: "150.00" }),
  ];
  const groups = runMatchingEngine(left, right);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].groupType, "AMBIGUOUS");
  assert.strictEqual(groups[0].members.length, 4);
});

test("unmatched left/right — rows with no compatible counterpart surface individually", () => {
  const left = [row("L1", { document_number_raw: "REF-012", gross_value: "100.00" }), row("L2", { document_number_raw: "REF-LONELY-LEFT", gross_value: "50.00" })];
  const right = [row("R1", { document_number_raw: "REF-012", gross_value: "100.00" }), row("R2", { document_number_raw: "REF-LONELY-RIGHT", gross_value: "75.00" })];
  const groups = runMatchingEngine(left, right);
  assert.strictEqual(groups.some((g) => g.groupType === "EXACT"), true);
  assert.strictEqual(groups.some((g) => g.groupType === "UNMATCHED_LEFT" && g.members[0].rowId === "L2"), true);
  assert.strictEqual(groups.some((g) => g.groupType === "UNMATCHED_RIGHT" && g.members[0].rowId === "R2"), true);
});

test("cross-entity mismatch rejected — different entity_id rows never even bucketed together", () => {
  const left = [row("L1", { document_number_raw: "REF-013", gross_value: "500.00", entity_id: "ENTITY_A" })];
  const right = [row("R1", { document_number_raw: "REF-013", gross_value: "500.00", entity_id: "ENTITY_B" })];
  const groups = runMatchingEngine(left, right);
  assert.strictEqual(groups.some((g) => g.groupType === "EXACT"), false, "cross-entity rows must never produce an EXACT candidate");
  assert.strictEqual(groups.some((g) => g.groupType === "UNMATCHED_LEFT"), true);
  assert.strictEqual(groups.some((g) => g.groupType === "UNMATCHED_RIGHT"), true);
});

test("amount exceeding one side is never silently over-allocated into GROUPED — surfaced as DISCREPANCY instead", () => {
  const left = [row("L1", { document_number_raw: "REF-014", gross_value: "500.00" })];
  const right = [
    row("R1", { document_number_raw: "REF-014", gross_value: "300.00" }),
    row("R2", { document_number_raw: "REF-014", gross_value: "400.00" }),
  ];
  const groups = runMatchingEngine(left, right);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].groupType, "DISCREPANCY");
  assert.strictEqual(groups[0].discrepancySubtype, "AMOUNT_EXCEEDS_ON_ONE_SIDE");
});

test("no-reference amount-only match still requires date agreement when both sides supply one", () => {
  const left = [row("L1", { gross_value: "250.00", transaction_date: "2026-03-01" })];
  const right = [row("R1", { gross_value: "250.00", transaction_date: "2026-03-02" })];
  const groups = runMatchingEngine(left, right);
  assert.strictEqual(groups[0].groupType, "DISCREPANCY");
  assert.strictEqual(groups[0].discrepancySubtype, "DATE_MISMATCH");
});

console.log("\n==================================================");
console.log(`RESULTS: ${passedCount} passed, ${failedCount} failed`);
console.log("==================================================\n");
if (failedCount > 0) process.exit(1);

// ============================================================
// Bansil Books Analytics — Match Service Tests (Milestone C)
// ZERO ZOHO API CALLS · ISOLATED TEMP SQLITE FILES ONLY.
// Every fixture is synthetic. Normalized rows are inserted directly
// (bypassing the CSV/XLSX pipeline, which is already covered by the
// Milestone B intake-service test suite) so these tests focus purely
// on run creation, the deterministic engine's DB integration, the
// reviewer decision/allocation ledger, and immutability guarantees.
// ============================================================

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openAuditDatabaseAt, getAuditSchemaVersion, AUDIT_SCHEMA_VERSION } from "../app/lib/db/audit-database.ts";
import { createWorkspace, addWorkspaceSource } from "../app/lib/audit/audit-service.ts";
import {
  createRun,
  listMatchGroups,
  getGroupEvidence,
  decideMatchGroup,
  getRunSummary,
  MatchError,
  OverAllocationError,
  AmbiguousDecisionError,
  type MatchGroupRecord,
} from "../app/lib/audit/match-service.ts";

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

function tmpDb(label: string): DatabaseSync {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bansil-match-${label}-`));
  return openAuditDatabaseAt(path.join(dir, "audit_workspace.db"));
}

/** Directly inserts a source version + normalized rows, frozen or not, bypassing the file/CSV pipeline (already tested in Milestone B). */
function makeSourceVersion(
  conn: DatabaseSync,
  sourceId: string,
  rows: Array<Record<string, string>>,
  opts: { frozen?: boolean; mappingApproved?: boolean } = {}
): string {
  const versionId = randomUUID();
  const now = new Date().toISOString();
  const maxVersionRow = conn.prepare(`SELECT MAX(version_number) as m FROM audit_source_versions WHERE source_id = ?`).get(sourceId) as { m: number | null };
  const versionNumber = (maxVersionRow.m ?? 0) + 1;

  conn
    .prepare(
      `INSERT INTO audit_source_versions
        (version_id, source_id, version_number, origin_type, extraction_status, extraction_method, raw_row_count, parsed_row_count, exception_count,
         mapping_status, mapping_version, completeness_status, frozen, frozen_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'FILE', 'EXTRACTED', 'test-fixture', ?, ?, 0, ?, 1, 'NOT_CHECKED', ?, ?, 'TEST', ?, ?)`
    )
    .run(
      versionId,
      sourceId,
      versionNumber,
      rows.length,
      rows.length,
      opts.mappingApproved === false ? "UNMAPPED" : "APPROVED",
      opts.frozen === false ? 0 : 1,
      opts.frozen === false ? null : now,
      now,
      now
    );

  const insertRow = conn.prepare(
    `INSERT INTO audit_normalized_rows (row_id, source_version_id, record_uid, evidence_locator, raw_json, normalized_json, parse_status, parse_exception, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'OK', NULL, ?)`
  );
  rows.forEach((r, i) => {
    insertRow.run(randomUUID(), versionId, randomUUID(), `row:${i + 1}`, JSON.stringify(r), JSON.stringify(r), now);
  });

  return versionId;
}

function makeWorkspaceWithTwoSources(conn: DatabaseSync): { workspaceId: string; sourceAId: string; sourceBId: string } {
  const ws = createWorkspace({ name: "Synthetic Match Test Workspace", comparisonMode: "INTERNAL_EXTERNAL", sources: [] }, conn);
  const sourceA = addWorkspaceSource(ws.workspace_id, { roleLabel: "SOURCE_A", sourceOrigin: "INTERNAL" }, "OWNER", conn);
  const sourceB = addWorkspaceSource(ws.workspace_id, { roleLabel: "SOURCE_B", sourceOrigin: "EXTERNAL" }, "OWNER", conn);
  return { workspaceId: ws.workspace_id, sourceAId: sourceA.source_id, sourceBId: sourceB.source_id };
}

console.log("\n==================================================");
console.log("MATCH SERVICE TESTS (Milestone C, isolated temp DB, synthetic fixtures only)");
console.log("==================================================");

test("schema version matches AUDIT_SCHEMA_VERSION on a fresh database", () => {
  const conn = tmpDb("schema");
  assert.strictEqual(getAuditSchemaVersion(conn), AUDIT_SCHEMA_VERSION);
  conn.close();
});

test("run creation requires frozen source versions on both sides of every edge", () => {
  const conn = tmpDb("frozen-gate");
  const { workspaceId, sourceAId, sourceBId } = makeWorkspaceWithTwoSources(conn);
  const leftV = makeSourceVersion(conn, sourceAId, [{ document_number_raw: "X1", gross_value: "100.00" }], { frozen: false });
  const rightV = makeSourceVersion(conn, sourceBId, [{ document_number_raw: "X1", gross_value: "100.00" }], { frozen: true });

  assert.throws(
    () => createRun({ workspaceId, edges: [{ leftRoleLabel: "SOURCE_A", rightRoleLabel: "SOURCE_B", leftSourceVersionId: leftV, rightSourceVersionId: rightV }] }, "OWNER", conn),
    MatchError
  );
  conn.close();
});

test("run creation generates EXACT candidates from frozen sources and persists them", () => {
  const conn = tmpDb("basic-run");
  const { workspaceId, sourceAId, sourceBId } = makeWorkspaceWithTwoSources(conn);
  const leftV = makeSourceVersion(conn, sourceAId, [{ document_number_raw: "INV-1", gross_value: "1000.00", entity_id: "E1" }]);
  const rightV = makeSourceVersion(conn, sourceBId, [{ document_number_raw: "INV-1", gross_value: "1000.00", entity_id: "E1" }]);

  const { runId } = createRun(
    { workspaceId, edges: [{ leftRoleLabel: "SOURCE_A", rightRoleLabel: "SOURCE_B", leftSourceVersionId: leftV, rightSourceVersionId: rightV }] },
    "OWNER",
    conn
  );
  const groups = listMatchGroups(runId, {}, conn);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].group_type, "EXACT");
  assert.strictEqual(groups[0].status, "CANDIDATE");
  conn.close();
});

test("accepting a candidate group records a decision and moves status to ACCEPTED", () => {
  const conn = tmpDb("accept");
  const { workspaceId, sourceAId, sourceBId } = makeWorkspaceWithTwoSources(conn);
  const leftV = makeSourceVersion(conn, sourceAId, [{ document_number_raw: "INV-2", gross_value: "500.00" }]);
  const rightV = makeSourceVersion(conn, sourceBId, [{ document_number_raw: "INV-2", gross_value: "500.00" }]);
  const { runId } = createRun({ workspaceId, edges: [{ leftRoleLabel: "A", rightRoleLabel: "B", leftSourceVersionId: leftV, rightSourceVersionId: rightV }] }, "OWNER", conn);
  const group = listMatchGroups(runId, {}, conn)[0];

  const accepted = decideMatchGroup(group.group_id, "ACCEPTED", "OWNER", "Confirmed against statement", conn);
  assert.strictEqual(accepted.status, "ACCEPTED");

  const evidence = getGroupEvidence(group.group_id, conn);
  assert.strictEqual(evidence.decisions.length, 1);
  assert.strictEqual((evidence.decisions[0] as { reviewer: string }).reviewer, "OWNER");
  assert.strictEqual((evidence.decisions[0] as { reason: string }).reason, "Confirmed against statement");
  conn.close();
});

test("over-allocation rejected — re-running matching over the SAME frozen pair and accepting a second candidate for an already-consumed row fails atomically", () => {
  const conn = tmpDb("over-alloc");
  const { workspaceId, sourceAId, sourceBId } = makeWorkspaceWithTwoSources(conn);
  const leftV = makeSourceVersion(conn, sourceAId, [{ document_number_raw: "INV-3", gross_value: "1000.00" }]);
  const rightV = makeSourceVersion(conn, sourceBId, [{ document_number_raw: "INV-3", gross_value: "1000.00" }]);

  const { runId: run1 } = createRun({ workspaceId, edges: [{ leftRoleLabel: "A", rightRoleLabel: "B", leftSourceVersionId: leftV, rightSourceVersionId: rightV }] }, "OWNER", conn);
  const group1 = listMatchGroups(run1, {}, conn)[0];
  decideMatchGroup(group1.group_id, "ACCEPTED", "OWNER", "first acceptance consumes full 1000", conn);

  // A second run generated over the exact same (leftV, rightV) relationship
  // (e.g. the owner re-ran matching) produces an independent candidate
  // group referencing the SAME rows — this must be blocked, since the
  // underlying rows' amounts are already fully consumed within this
  // relationship.
  const { runId: run2 } = createRun({ workspaceId, edges: [{ leftRoleLabel: "A", rightRoleLabel: "B", leftSourceVersionId: leftV, rightSourceVersionId: rightV }] }, "OWNER", conn);
  const group2 = listMatchGroups(run2, {}, conn)[0];

  assert.throws(() => decideMatchGroup(group2.group_id, "ACCEPTED", "OWNER", "would over-allocate", conn), OverAllocationError);

  // Group must remain CANDIDATE — the failed attempt must not have partially applied.
  const reloaded = listMatchGroups(run2, {}, conn)[0];
  assert.strictEqual(reloaded.status, "CANDIDATE");
  conn.close();
});

test("same row cannot be consumed twice — a second full-amount acceptance against an already-fully-allocated row is rejected", () => {
  const conn = tmpDb("double-consume");
  const { workspaceId, sourceAId, sourceBId } = makeWorkspaceWithTwoSources(conn);
  const leftV = makeSourceVersion(conn, sourceAId, [{ document_number_raw: "INV-4", gross_value: "300.00" }]);
  const rightV = makeSourceVersion(conn, sourceBId, [{ document_number_raw: "INV-4", gross_value: "300.00" }]);
  const { runId } = createRun({ workspaceId, edges: [{ leftRoleLabel: "A", rightRoleLabel: "B", leftSourceVersionId: leftV, rightSourceVersionId: rightV }] }, "OWNER", conn);
  const group = listMatchGroups(runId, {}, conn)[0];
  decideMatchGroup(group.group_id, "ACCEPTED", "OWNER", undefined, conn);

  // Attempt to accept the SAME group again is blocked by the state machine (ACCEPTED is not a valid "from" state for ACCEPTED).
  assert.throws(() => decideMatchGroup(group.group_id, "ACCEPTED", "OWNER", undefined, conn), MatchError);
  conn.close();
});

test("reversed reviewer decision — reversing an ACCEPTED group frees its allocation for a later acceptance", () => {
  const conn = tmpDb("reverse");
  const { workspaceId, sourceAId, sourceBId } = makeWorkspaceWithTwoSources(conn);
  const leftV = makeSourceVersion(conn, sourceAId, [{ document_number_raw: "INV-5", gross_value: "800.00" }]);
  const rightV = makeSourceVersion(conn, sourceBId, [{ document_number_raw: "INV-5", gross_value: "800.00" }]);
  const { runId: run1 } = createRun({ workspaceId, edges: [{ leftRoleLabel: "A", rightRoleLabel: "B", leftSourceVersionId: leftV, rightSourceVersionId: rightV }] }, "OWNER", conn);
  const group1 = listMatchGroups(run1, {}, conn)[0];
  decideMatchGroup(group1.group_id, "ACCEPTED", "OWNER", "initial accept", conn);

  // A second run over the same (leftV, rightV) relationship produces an
  // independent competing candidate for the same rows.
  const { runId: run2 } = createRun({ workspaceId, edges: [{ leftRoleLabel: "A", rightRoleLabel: "B", leftSourceVersionId: leftV, rightSourceVersionId: rightV }] }, "OWNER", conn);
  const group2 = listMatchGroups(run2, {}, conn)[0];

  // Blocked while group1 still holds the allocation.
  assert.throws(() => decideMatchGroup(group2.group_id, "ACCEPTED", "OWNER", undefined, conn), OverAllocationError);

  const reversed = decideMatchGroup(group1.group_id, "REVERSED", "OWNER", "original acceptance was a data-entry duplicate", conn);
  assert.strictEqual(reversed.status, "REVERSED");

  // Now that group1 no longer counts as ACCEPTED, group2 may be accepted.
  const nowAccepted = decideMatchGroup(group2.group_id, "ACCEPTED", "OWNER", "corrected acceptance", conn);
  assert.strictEqual(nowAccepted.status, "ACCEPTED");
  conn.close();
});

test("rejected and held decisions transition correctly; held can later be accepted", () => {
  const conn = tmpDb("hold-reject");
  const { workspaceId, sourceAId, sourceBId } = makeWorkspaceWithTwoSources(conn);
  const leftV = makeSourceVersion(conn, sourceAId, [
    { document_number_raw: "INV-6", gross_value: "111.00" },
    { document_number_raw: "INV-7", gross_value: "222.00" },
  ]);
  const rightV = makeSourceVersion(conn, sourceBId, [
    { document_number_raw: "INV-6", gross_value: "111.00" },
    { document_number_raw: "INV-7", gross_value: "222.00" },
  ]);
  const { runId } = createRun({ workspaceId, edges: [{ leftRoleLabel: "A", rightRoleLabel: "B", leftSourceVersionId: leftV, rightSourceVersionId: rightV }] }, "OWNER", conn);
  const groups = listMatchGroups(runId, {}, conn);
  assert.strictEqual(groups.length, 2);

  const rejected = decideMatchGroup(groups[0].group_id, "REJECTED", "OWNER", "not a real match", conn);
  assert.strictEqual(rejected.status, "REJECTED");

  const held = decideMatchGroup(groups[1].group_id, "HELD", "OWNER", "needs more evidence", conn);
  assert.strictEqual(held.status, "HELD");
  const acceptedFromHeld = decideMatchGroup(groups[1].group_id, "ACCEPTED", "OWNER", "evidence received", conn);
  assert.strictEqual(acceptedFromHeld.status, "ACCEPTED");
  conn.close();
});

test("ambiguous and unmatched candidates cannot be accepted directly", () => {
  const conn = tmpDb("ambiguous-gate");
  const { workspaceId, sourceAId, sourceBId } = makeWorkspaceWithTwoSources(conn);
  const leftV = makeSourceVersion(conn, sourceAId, [
    { document_number_raw: "DUP", gross_value: "50.00" },
    { document_number_raw: "DUP", gross_value: "50.00" },
  ]);
  const rightV = makeSourceVersion(conn, sourceBId, [
    { document_number_raw: "DUP", gross_value: "50.00" },
    { document_number_raw: "DUP", gross_value: "50.00" },
  ]);
  const { runId } = createRun({ workspaceId, edges: [{ leftRoleLabel: "A", rightRoleLabel: "B", leftSourceVersionId: leftV, rightSourceVersionId: rightV }] }, "OWNER", conn);
  const groups = listMatchGroups(runId, { groupType: "AMBIGUOUS" }, conn);
  assert.strictEqual(groups.length, 1);
  assert.throws(() => decideMatchGroup(groups[0].group_id, "ACCEPTED", "OWNER", undefined, conn), AmbiguousDecisionError);

  const unmatchedLeft = makeSourceVersion(conn, sourceAId, [{ document_number_raw: "LONELY", gross_value: "9.00" }]);
  const unmatchedRight = makeSourceVersion(conn, sourceBId, [{ document_number_raw: "SOMETHING-ELSE", gross_value: "77.00" }]);
  const { runId: run2 } = createRun({ workspaceId, edges: [{ leftRoleLabel: "A", rightRoleLabel: "B", leftSourceVersionId: unmatchedLeft, rightSourceVersionId: unmatchedRight }] }, "OWNER", conn);
  const unmatchedGroups = listMatchGroups(run2, {}, conn);
  assert.strictEqual(unmatchedGroups.every((g) => g.group_type === "UNMATCHED_LEFT" || g.group_type === "UNMATCHED_RIGHT"), true);
  for (const g of unmatchedGroups) {
    assert.throws(() => decideMatchGroup(g.group_id, "ACCEPTED", "OWNER", undefined, conn), AmbiguousDecisionError);
  }
  conn.close();
});

test("evidence drill-back exposes original evidence_locator and raw/normalized JSON for every member", () => {
  const conn = tmpDb("evidence");
  const { workspaceId, sourceAId, sourceBId } = makeWorkspaceWithTwoSources(conn);
  const leftV = makeSourceVersion(conn, sourceAId, [{ document_number_raw: "INV-8", gross_value: "42.00" }]);
  const rightV = makeSourceVersion(conn, sourceBId, [{ document_number_raw: "INV-8", gross_value: "42.00" }]);
  const { runId } = createRun({ workspaceId, edges: [{ leftRoleLabel: "A", rightRoleLabel: "B", leftSourceVersionId: leftV, rightSourceVersionId: rightV }] }, "OWNER", conn);
  const group = listMatchGroups(runId, {}, conn)[0];
  const evidence = getGroupEvidence(group.group_id, conn);
  assert.strictEqual(evidence.members.length, 2);
  for (const m of evidence.members) {
    assert.strictEqual(m.evidence_locator, "row:1");
    assert.ok(m.raw_json.includes("INV-8"));
  }
  conn.close();
});

test("multi-source graph without double-counting — the same underlying row supporting two edges is reported per-edge, and the distinct-row count is not multiplied", () => {
  const conn = tmpDb("multi-edge");
  const ws = createWorkspace({ name: "Graph Test Workspace", comparisonMode: "INTERNAL_EXTERNAL", sources: [] }, conn);
  const bill = addWorkspaceSource(ws.workspace_id, { roleLabel: "BILL", sourceOrigin: "INTERNAL" }, "OWNER", conn);
  const vendorStatement = addWorkspaceSource(ws.workspace_id, { roleLabel: "VENDOR_STATEMENT", sourceOrigin: "EXTERNAL" }, "OWNER", conn);
  const payment = addWorkspaceSource(ws.workspace_id, { roleLabel: "PAYMENT", sourceOrigin: "INTERNAL" }, "OWNER", conn);

  const billV = makeSourceVersion(conn, bill.source_id, [{ document_number_raw: "BILL-1", gross_value: "5000.00" }]);
  const vendorStatementV = makeSourceVersion(conn, vendorStatement.source_id, [{ document_number_raw: "BILL-1", gross_value: "5000.00" }]);
  const paymentV = makeSourceVersion(conn, payment.source_id, [{ document_number_raw: "BILL-1", gross_value: "5000.00" }]);

  // Edge 1: Bill -> Vendor Statement (recognition). Edge 2: Vendor Statement -> Payment (settlement).
  // The vendor-statement row participates in BOTH edges — this must never
  // double its economic value in the run summary.
  const { runId } = createRun(
    {
      workspaceId: ws.workspace_id,
      edges: [
        { leftRoleLabel: "BILL", rightRoleLabel: "VENDOR_STATEMENT", leftSourceVersionId: billV, rightSourceVersionId: vendorStatementV },
        { leftRoleLabel: "VENDOR_STATEMENT", rightRoleLabel: "PAYMENT", leftSourceVersionId: vendorStatementV, rightSourceVersionId: paymentV },
      ],
    },
    "OWNER",
    conn
  );

  const groups = listMatchGroups(runId, {}, conn);
  assert.strictEqual(groups.length, 2, "one EXACT candidate per edge");
  for (const g of groups) {
    decideMatchGroup(g.group_id, "ACCEPTED", "OWNER", "recognition and settlement both evidenced", conn);
  }

  const summary = getRunSummary(runId, conn);
  assert.strictEqual(summary.perEdgeAcceptedTotal.length, 2, "totals are reported per edge, never combined into one grand sum");
  for (const edgeTotal of summary.perEdgeAcceptedTotal) {
    assert.strictEqual(edgeTotal.acceptedAllocatedTotal, "5000.00", "each edge independently reports the full amount — this is not double counting, it's two distinct assertions (recognition vs settlement)");
  }
  // 3 distinct rows total (bill, vendor statement, payment) even though the
  // vendor-statement row is referenced by two accepted groups.
  assert.strictEqual(summary.distinctAcceptedRowCount, 3);
  conn.close();
});

test("cross-entity mismatch persists as UNMATCHED, never EXACT, through the full DB round-trip", () => {
  const conn = tmpDb("cross-entity-db");
  const { workspaceId, sourceAId, sourceBId } = makeWorkspaceWithTwoSources(conn);
  const leftV = makeSourceVersion(conn, sourceAId, [{ document_number_raw: "INV-9", gross_value: "1234.00", entity_id: "ENTITY_A" }]);
  const rightV = makeSourceVersion(conn, sourceBId, [{ document_number_raw: "INV-9", gross_value: "1234.00", entity_id: "ENTITY_B" }]);
  const { runId } = createRun({ workspaceId, edges: [{ leftRoleLabel: "A", rightRoleLabel: "B", leftSourceVersionId: leftV, rightSourceVersionId: rightV }] }, "OWNER", conn);
  const groups = listMatchGroups(runId, {}, conn);
  assert.strictEqual(groups.some((g: MatchGroupRecord) => g.group_type === "EXACT"), false);
  assert.strictEqual(groups.some((g: MatchGroupRecord) => g.group_type === "UNMATCHED_LEFT"), true);
  assert.strictEqual(groups.some((g: MatchGroupRecord) => g.group_type === "UNMATCHED_RIGHT"), true);
  conn.close();
});

console.log("\n==================================================");
console.log(`RESULTS: ${passedCount} passed, ${failedCount} failed`);
console.log("==================================================\n");
if (failedCount > 0) process.exit(1);

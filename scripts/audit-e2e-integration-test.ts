// ============================================================
// Bansil Books Analytics — Milestone E: Full Synthetic End-to-End
// Integration Test (§17). ZERO ZOHO API CALLS. ISOLATED TEMP SQLITE
// FILE ONLY. Every fixture is synthetic — no production accounting data.
//
// Flow exercised:
//   Upload/source acquisition (direct fixture insert, Milestone B already
//   covers the parser/mapping pipeline itself)
//   -> mapping -> frozen snapshots
//   -> deterministic matching (Milestone C engine, unmodified)
//   -> ambiguity/residual
//   -> human decision (accept)
//   -> domain review (Milestone D)
//   -> finding -> action (Milestone D)
//   -> internal report -> Excel/PDF (Milestone D)
//   -> one controlled learning proposal (Milestone E)
//   -> proposal testing -> approval/activation
//   -> rollback
//   -> verify the earlier report/run is completely unchanged by the
//      later rollback (immutability across milestones)
// ============================================================

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openAuditDatabaseAt } from "../app/lib/db/audit-database.ts";
import { createWorkspace, addWorkspaceSource } from "../app/lib/audit/audit-service.ts";
import { createRun, listMatchGroups, decideMatchGroup, getRunSummary } from "../app/lib/audit/match-service.ts";
import { recordDomainReview } from "../app/lib/audit/domain-review-service.ts";
import { createFinding } from "../app/lib/audit/findings-service.ts";
import { createAction, assignAction, markInProgress, resolveAction, closeAction } from "../app/lib/audit/action-service.ts";
import { generateReport, getReport } from "../app/lib/audit/report-service.ts";
import { buildAuditReportData } from "../app/lib/audit/export/audit-report-data.ts";
import { buildAuditReportExcel } from "../app/lib/audit/export/audit-report-excel-builder.ts";
import { buildAuditReportPdf } from "../app/lib/audit/export/audit-report-pdf-builder.ts";
import { REPORT_SECTION_KEYS } from "../app/lib/audit/report-field-selector.ts";
import { createProposal, addExample, runProposalTests, submitForApproval, approveAndActivate, rollbackToVersion, getProposal } from "../app/lib/audit/learning/learning-service.ts";

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bansil-e2e-milestoneE-"));
const conn: DatabaseSync = openAuditDatabaseAt(path.join(dir, "audit_workspace.db"));

function makeFrozenSourceVersion(c: DatabaseSync, workspaceId: string, roleLabel: string, origin: "INTERNAL" | "EXTERNAL", filename: string) {
  const sourceId = randomUUID();
  const now = new Date().toISOString();
  c.prepare(`INSERT INTO audit_workspace_sources (source_id, workspace_id, role_label, source_origin, origin_description, provenance, basis_note, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    sourceId, workspaceId, roleLabel, origin, "Synthetic E2E source", "synthetic-provenance", "Synthetic E2E Entity", null, now
  );
  const fileId = randomUUID();
  c.prepare(`INSERT INTO audit_source_files (file_id, source_id, original_filename, file_type, size_bytes, sha256, storage_path, uploaded_by, uploaded_at) VALUES (?, ?, ?, 'CSV', 1024, ?, ?, 'TEST', ?)`).run(
    fileId, sourceId, filename, "synthetic-" + randomUUID().slice(0, 12), `synthetic/${fileId}.bin`, now
  );
  const versionId = randomUUID();
  c.prepare(
    `INSERT INTO audit_source_versions (version_id, source_id, version_number, origin_type, file_id, extraction_status, extraction_method, raw_row_count, parsed_row_count, exception_count, mapping_status, mapping_version, completeness_status, frozen, frozen_at, created_by, created_at, updated_at)
     VALUES (?, ?, 1, 'FILE', ?, 'EXTRACTED', 'test-fixture', 1, 1, 0, 'APPROVED', 1, 'COMPLETE', 1, ?, 'TEST', ?, ?)`
  ).run(versionId, sourceId, fileId, now, now, now);
  return { sourceId, versionId };
}
function insertNormalizedRow(c: DatabaseSync, versionId: string, evidenceLocator: string, normalized: Record<string, unknown>) {
  const now = new Date().toISOString();
  c.prepare(`INSERT INTO audit_normalized_rows (row_id, source_version_id, record_uid, evidence_locator, raw_json, normalized_json, parse_status, parse_exception, created_at) VALUES (?, ?, ?, ?, ?, ?, 'OK', NULL, ?)`).run(
    randomUUID(), versionId, randomUUID(), evidenceLocator, JSON.stringify(normalized), JSON.stringify(normalized), now
  );
}

console.log("\n=== FULL SYNTHETIC END-TO-END: Milestone A-E integration ===");

// ---- Step 1: workspace + 3 synthetic sources (bill, vendor statement, bank evidence) ----
const ws = createWorkspace({ name: "E2E Synthetic Audit Scenario", comparisonMode: "INTERNAL_EXTERNAL", sources: [] }, conn);
const wsId = ws.workspace_id;

const sourceA = makeFrozenSourceVersion(conn, wsId, "SOURCE_A", "INTERNAL", "internal_payable_bill_ledger.csv"); // Source A: internal payable/bill data
const sourceB = makeFrozenSourceVersion(conn, wsId, "SOURCE_B", "EXTERNAL", "synthetic_vendor_statement.csv"); // Source B: synthetic vendor statement
const sourceC = makeFrozenSourceVersion(conn, wsId, "SOURCE_C", "EXTERNAL", "synthetic_bank_payment_evidence.csv"); // Source C: synthetic payment/bank evidence

insertNormalizedRow(conn, sourceA.versionId, "row:1", { document_number_raw: "BILL-E2E-001", gross_value: "15750.00", entity_id: "VEND-E2E" });
insertNormalizedRow(conn, sourceB.versionId, "row:1", { document_number_raw: "BILL-E2E-001", gross_value: "15750.00", entity_id: "VEND-E2E" });
insertNormalizedRow(conn, sourceC.versionId, "row:1", { document_number_raw: "PAY-E2E-777", gross_value: "15750.00", entity_id: "VEND-E2E" }); // deliberately non-matching reference -> residual/ambiguity later

test("Step 1: three frozen synthetic sources acquired (internal bill ledger, vendor statement, bank evidence)", () => {
  assert.ok(sourceA.versionId && sourceB.versionId && sourceC.versionId);
});

// ---- Step 2: deterministic matching run across two edges ----
const { runId } = createRun(
  {
    workspaceId: wsId,
    edges: [
      { leftRoleLabel: "BILL", rightRoleLabel: "VENDOR_STATEMENT", leftSourceVersionId: sourceA.versionId, rightSourceVersionId: sourceB.versionId },
      { leftRoleLabel: "VENDOR_STATEMENT", rightRoleLabel: "BANK_EVIDENCE", leftSourceVersionId: sourceB.versionId, rightSourceVersionId: sourceC.versionId },
    ],
  },
  "OWNER",
  conn
);

test("Step 2: deterministic matching run produces an EXACT candidate for Bill<->Vendor Statement", () => {
  const exact = listMatchGroups(runId, { groupType: "EXACT" }, conn);
  assert.ok(exact.length >= 1);
});

test("Step 2: Vendor Statement<->Bank Evidence produces an unmatched/residual candidate (different reference numbers)", () => {
  const unresolved = listMatchGroups(runId, {}, conn).filter((g) => g.group_type !== "EXACT");
  assert.ok(unresolved.length >= 1, "expected at least one non-EXACT (ambiguous/unmatched) candidate for the deliberately mismatched bank evidence");
});

// ---- Step 3: human decision on the EXACT candidate ----
const [exactGroup] = listMatchGroups(runId, { groupType: "EXACT" }, conn);
decideMatchGroup(exactGroup.group_id, "ACCEPTED", "OWNER", "Vendor statement confirms bill amount and reference", conn);

test("Step 3: human decision recorded — Bill<->Vendor Statement ACCEPTED", () => {
  const [g] = listMatchGroups(runId, { groupType: "EXACT" }, conn);
  assert.strictEqual(g.status, "ACCEPTED");
});

const summary = getRunSummary(runId, conn);
test("Step 3: run summary reflects the accepted allocation", () => {
  assert.ok(summary.perEdgeAcceptedTotal.some((e) => Number(e.acceptedAllocatedTotal) > 0));
});

// ---- Step 4: domain review ----
recordDomainReview({ workspaceId: wsId, runId, domain: "PAYABLES", status: "REVIEWED", sourceSnapshotIds: [sourceA.versionId, sourceB.versionId, sourceC.versionId], matchedAmount: "15750.00", matchedCount: 1, unresolvedCount: 1, sourceCoverageNote: "Bill, vendor statement, and bank evidence all frozen and compared" }, "OWNER", conn);

test("Step 4: PAYABLES domain review recorded as REVIEWED with proven coverage", () => {
  const dr = conn.prepare(`SELECT status FROM audit_domain_reviews WHERE workspace_id = ? AND domain = 'PAYABLES'`).get(wsId) as { status: string };
  assert.strictEqual(dr.status, "REVIEWED");
});

// ---- Step 5: finding + action ----
const finding = createFinding(
  { workspaceId: wsId, runId, domain: "PAYABLES", severity: "MEDIUM", findingType: "REFERENCE_DOCUMENT_MISMATCH", title: "Bank evidence reference does not match vendor statement/bill reference", evidenceRefs: ["row:1 (synthetic_bank_payment_evidence.csv)"], financialImpact: "0.00", currency: "INR" },
  "OWNER",
  conn
);
const action = createAction({ findingId: finding.finding_id, actionRequired: "Confirm PAY-E2E-777 corresponds to BILL-E2E-001 with the bank", actionOwner: "accounts.payable@example" }, "OWNER", conn);
assignAction(action.action_id, {}, "OWNER", conn);
markInProgress(action.action_id, "OWNER", "Contacted bank", conn);
resolveAction(action.action_id, "OWNER", "Bank confirmed the payment reference maps to this bill", conn);
closeAction(action.action_id, "OWNER", "Confirmed via bank correspondence dated synthetic test date", conn);

test("Step 5: finding created and action closed without mutating the finding", () => {
  const findingAfterAll = conn.prepare(`SELECT financial_impact, confirmed_vs_suspected FROM audit_findings WHERE finding_id = ?`).get(finding.finding_id) as { financial_impact: string; confirmed_vs_suspected: string };
  assert.strictEqual(findingAfterAll.financial_impact, "0.00");
  assert.strictEqual(findingAfterAll.confirmed_vs_suspected, "SUSPECTED");
});

// ---- Step 6: internal report + Excel/PDF ----
const report = generateReport({ workspaceId: wsId, runId, entityName: "E2E Synthetic Entity Pvt Ltd", periodFrom: "2026-01-01", periodTo: "2026-03-31" }, "OWNER", conn);
const reportData = buildAuditReportData(report);
const excelBuffer = buildAuditReportExcel(reportData, REPORT_SECTION_KEYS);
const pdfBuffer = buildAuditReportPdf(reportData, REPORT_SECTION_KEYS);

test("Step 6: internal review report generated with a real source register (3 sources) and Excel/PDF both non-empty", () => {
  assert.strictEqual(reportData.sourceRegister.length, 3);
  assert.ok(excelBuffer.length > 500);
  assert.ok(pdfBuffer.length > 500);
  assert.strictEqual(pdfBuffer.subarray(0, 8).toString("ascii"), "%PDF-1.4");
});

// ---- Step 7: one controlled learning proposal (test -> approve/activate) ----
const proposal = createProposal(
  { proposalType: "PARTY_ALIAS", module: "reconciliation", workspaceId: wsId, scopeType: "VENDOR", ruleConfig: { matchField: "reference_prefix", matchPattern: "PAY-E2E" }, title: "Recognize PAY-E2E-* bank references as belonging to vendor VEND-E2E", rationale: "Confirmed via bank correspondence in Step 5" },
  "OWNER",
  conn
);
addExample(proposal.proposal_id, { exampleType: "POSITIVE", input: { reference_prefix: "PAY-E2E" } }, "OWNER", conn);
addExample(proposal.proposal_id, { exampleType: "NEGATIVE", input: { reference_prefix: "PAY-OTHER" } }, "OWNER", conn);
const { testResults } = runProposalTests(proposal.proposal_id, "OWNER", conn);

test("Step 7: learning proposal tests pass on its own declared examples", () => {
  assert.strictEqual(testResults.allPassed, true);
});

submitForApproval(proposal.proposal_id, "OWNER", conn);
const activated = approveAndActivate(proposal.proposal_id, { approver: "owner.reviewer", reason: "Confirmed pattern via bank correspondence; scoped to this one vendor only" }, conn);

test("Step 7: proposal approved and activated (scoped to VENDOR, not GLOBAL)", () => {
  assert.strictEqual(activated.status, "ACTIVE");
  assert.strictEqual(activated.scope_type, "VENDOR");
});

// ---- Step 8: rollback, then verify the earlier report is completely unchanged ----
const reportBeforeRollback = JSON.stringify(getReport(report.report_id, conn));

const v2 = createProposal({ ruleKey: proposal.rule_key, proposalType: "PARTY_ALIAS", module: "reconciliation", workspaceId: wsId, scopeType: "VENDOR", ruleConfig: { matchField: "reference_prefix", matchPattern: "PAY-E2E-NEW" }, title: "Attempted narrower pattern" }, "OWNER", conn);
addExample(v2.proposal_id, { exampleType: "POSITIVE", input: { reference_prefix: "PAY-E2E-NEW" } }, "OWNER", conn);
addExample(v2.proposal_id, { exampleType: "NEGATIVE", input: { reference_prefix: "PAY-E2E" } }, "OWNER", conn);
runProposalTests(v2.proposal_id, "OWNER", conn);
submitForApproval(v2.proposal_id, "OWNER", conn);
approveAndActivate(v2.proposal_id, { approver: "owner.reviewer", reason: "Testing a narrower variant" }, conn);

const rolledBack = rollbackToVersion(proposal.proposal_id, "owner.reviewer", "Narrower variant missed real cases — reverting to the original pattern", conn);

test("Step 8: rollback creates a new v3 activating the original (v1) config, disabling v2", () => {
  assert.strictEqual(rolledBack.version_number, 3);
  assert.strictEqual(rolledBack.rule_config_json, proposal.rule_config_json);
  const v2After = getProposal(v2.proposal_id, conn)!;
  assert.strictEqual(v2After.status, "DISABLED");
});

test("Step 8: the report generated in Step 6 (BEFORE any of this rollback activity) is byte-for-byte unchanged", () => {
  const reportAfterRollback = JSON.stringify(getReport(report.report_id, conn));
  assert.strictEqual(reportAfterRollback, reportBeforeRollback);
});

test("Step 8: the run/match decision from Step 3 is unaffected by the later learning-proposal activity", () => {
  const [g] = listMatchGroups(runId, { groupType: "EXACT" }, conn);
  assert.strictEqual(g.status, "ACCEPTED");
});

console.log(`\n${"=".repeat(60)}\nE2E INTEGRATION TEST SUMMARY: ${passedCount} passed, ${failedCount} failed\n${"=".repeat(60)}`);
if (failedCount > 0) process.exit(1);

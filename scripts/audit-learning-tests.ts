// ============================================================
// Bansil Books Analytics — Milestone E: Controlled Learning Test Suite
// ZERO ZOHO API CALLS. ISOLATED TEMP SQLITE FILES ONLY. Every fixture
// is synthetic. Tests the full governed rule-proposal lifecycle:
// create -> examples -> test -> submit -> approve/activate -> conflict
// detection -> disable -> rollback -> expiry -> one-time overrides ->
// unsupported-case workflow -> authorization surface.
// ============================================================

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openAuditDatabaseAt } from "../app/lib/db/audit-database.ts";
import { createWorkspace } from "../app/lib/audit/audit-service.ts";
import {
  createProposal,
  getProposal,
  listProposals,
  listRuleHistory,
  addExample,
  listExamples,
  runProposalTests,
  submitForApproval,
  approveAndActivate,
  rejectProposal,
  disableProposal,
  archiveProposal,
  rollbackToVersion,
  renewExpiry,
  checkAndExpireProposals,
  detectConflicts,
  listOpenConflicts,
  resolveConflict,
  listProposalEvents,
  previewImpact,
  LearningError,
} from "../app/lib/audit/learning/learning-service.ts";
import { evaluateRule, runExamplesAgainstRule } from "../app/lib/audit/learning/rule-evaluator.ts";
import { createOverride, listOverrides, OverrideError } from "../app/lib/audit/learning/override-service.ts";
import { createUnsupportedCase, listUnsupportedCases, resolveUnsupportedCase, markUnsupportedCaseResolved, UnsupportedCaseError } from "../app/lib/audit/learning/unsupported-case-service.ts";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bansil-learning-${label}-`));
  return openAuditDatabaseAt(path.join(dir, "audit_workspace.db"));
}

function makeWorkspace(conn: DatabaseSync): string {
  return createWorkspace({ name: "Synthetic Learning Test Workspace", comparisonMode: "INTERNAL_EXTERNAL", sources: [] }, conn).workspace_id;
}

// ============================================================
// Rule Evaluator (pure)
// ============================================================
console.log("\n=== Rule Evaluator (pure, deterministic) ===");
{
  test("evaluateRule: exact match", () => {
    assert.strictEqual(evaluateRule({ matchField: "party_name_raw", matchPattern: "ABC Traders" }, { party_name_raw: "ABC Traders" }), true);
    assert.strictEqual(evaluateRule({ matchField: "party_name_raw", matchPattern: "ABC Traders" }, { party_name_raw: "XYZ Traders" }), false);
  });

  test("evaluateRule: regex: prefix supported", () => {
    assert.strictEqual(evaluateRule({ matchField: "party_name_raw", matchPattern: "regex:^ABC" }, { party_name_raw: "ABC Traders Pvt Ltd" }), true);
    assert.strictEqual(evaluateRule({ matchField: "party_name_raw", matchPattern: "regex:^ABC" }, { party_name_raw: "Not ABC" }), false);
  });

  test("evaluateRule: malformed regex never throws — resolves to false (safe default)", () => {
    assert.strictEqual(evaluateRule({ matchField: "x", matchPattern: "regex:(" }, { x: "anything" }), false);
  });

  test("evaluateRule: missing field never throws — resolves to false", () => {
    assert.strictEqual(evaluateRule({ matchField: "missing_field", matchPattern: "x" }, { other: "y" }), false);
  });

  test("runExamplesAgainstRule: correctly reports per-example pass/fail, never forces a PASS", () => {
    const summary = runExamplesAgainstRule({ matchField: "f", matchPattern: "yes" }, [
      { exampleId: "1", exampleType: "POSITIVE", expectedApply: true, input: { f: "yes" } },
      { exampleId: "2", exampleType: "NEGATIVE", expectedApply: false, input: { f: "no" } },
      { exampleId: "3", exampleType: "NEGATIVE", expectedApply: false, input: { f: "yes" } }, // deliberately wrong — must show as failed
    ]);
    assert.strictEqual(summary.totalExamples, 3);
    assert.strictEqual(summary.passed, 2);
    assert.strictEqual(summary.failed, 1);
    assert.strictEqual(summary.allPassed, false);
  });
}

// ============================================================
// Proposal lifecycle: DRAFT -> TESTING -> PENDING_APPROVAL -> ACTIVE
// ============================================================
console.log("\n=== Proposal Lifecycle (SUGGEST_ONLY, versioned, tested-before-activate) ===");
{
  const conn = tmpDb("lifecycle");
  const wsId = makeWorkspace(conn);
  let proposalId = "";

  test("createProposal starts in DRAFT — never auto-activated", () => {
    const p = createProposal(
      { proposalType: "PARTY_ALIAS", module: "reconciliation", workspaceId: wsId, scopeType: "PARTY", ruleConfig: { matchField: "party_name_raw", matchPattern: "ABC Traders" }, title: "Alias ABC Traders to Customer C-001" },
      "OWNER",
      conn
    );
    proposalId = p.proposal_id;
    assert.strictEqual(p.status, "DRAFT");
    assert.strictEqual(p.version_number, 1);
  });

  test("runProposalTests refuses without at least one POSITIVE and one NEGATIVE example", () => {
    assert.throws(() => runProposalTests(proposalId, "OWNER", conn), LearningError);
  });

  test("addExample rejects an invalid example_type", () => {
    assert.throws(() => addExample(proposalId, { exampleType: "BOGUS" as any, input: {} }, "OWNER", conn), LearningError);
  });

  test("addExample accepts POSITIVE and NEGATIVE examples", () => {
    addExample(proposalId, { exampleType: "POSITIVE", input: { party_name_raw: "ABC Traders" } }, "OWNER", conn);
    addExample(proposalId, { exampleType: "NEGATIVE", input: { party_name_raw: "XYZ Traders" } }, "OWNER", conn);
    assert.strictEqual(listExamples(proposalId, conn).length, 2);
  });

  test("runProposalTests passes and moves proposal to TESTING", () => {
    const { proposal, testResults } = runProposalTests(proposalId, "OWNER", conn);
    assert.strictEqual(proposal.status, "TESTING");
    assert.strictEqual(testResults.allPassed, true);
  });

  test("submitForApproval refused for a DRAFT/ACTIVE proposal (must be TESTING)", () => {
    const other = createProposal({ proposalType: "PARTY_ALIAS", module: "reconciliation", scopeType: "PARTY", ruleConfig: { matchField: "x", matchPattern: "y" }, title: "not tested yet" }, "OWNER", conn);
    assert.throws(() => submitForApproval(other.proposal_id, "OWNER", conn), LearningError);
  });

  test("submitForApproval succeeds after a passing test run -> PENDING_APPROVAL", () => {
    const p = submitForApproval(proposalId, "OWNER", conn);
    assert.strictEqual(p.status, "PENDING_APPROVAL");
  });

  test("approveAndActivate refuses without approver/reason", () => {
    assert.throws(() => approveAndActivate(proposalId, { approver: "", reason: "" }, conn), LearningError);
  });

  test("approveAndActivate succeeds with approver + reason for a non-GLOBAL scope -> ACTIVE", () => {
    const p = approveAndActivate(proposalId, { approver: "owner.reviewer", reason: "Confirmed via vendor correspondence" }, conn);
    assert.strictEqual(p.status, "ACTIVE");
    assert.ok(p.approved_by);
    assert.ok(p.activated_at);
  });

  test("Full event trail is recorded: created -> example x2 -> tested -> submitted -> activated", () => {
    const events = listProposalEvents(proposalId, conn);
    const types = events.map((e) => e.event_type);
    assert.deepStrictEqual(types, ["PROPOSAL_CREATED", "EXAMPLE_ADDED", "EXAMPLE_ADDED", "TESTS_RUN", "SUBMITTED_FOR_APPROVAL", "ACTIVATED"]);
  });
}

// ============================================================
// "Test-before-activate" BLOCKS activation on a failing rule
// ============================================================
console.log("\n=== Test-Before-Activate: regressions BLOCK activation ===");
{
  const conn = tmpDb("blocking");
  let proposalId = "";

  test("A rule that fails its own hard-negative example never reaches TESTING allPassed=true", () => {
    const p = createProposal({ proposalType: "PARTY_ALIAS", module: "reconciliation", scopeType: "PARTY", ruleConfig: { matchField: "party_name_raw", matchPattern: "regex:ABC" }, title: "Overly broad ABC match" }, "OWNER", conn);
    proposalId = p.proposal_id;
    addExample(proposalId, { exampleType: "POSITIVE", input: { party_name_raw: "ABC Traders" } }, "OWNER", conn);
    // Hard negative: contains "ABC" as a substring of an unrelated name — the naive regex would wrongly match it.
    addExample(proposalId, { exampleType: "HARD_NEGATIVE", input: { party_name_raw: "GARABCHI Enterprises" } }, "OWNER", conn);
    const { testResults } = runProposalTests(proposalId, "OWNER", conn);
    assert.strictEqual(testResults.allPassed, false);
  });

  test("submitForApproval is refused for a proposal with failed tests — activation stays BLOCKED", () => {
    assert.throws(() => submitForApproval(proposalId, "OWNER", conn), /has not passed its own tests/);
  });

  test("Never alters an assertion to force a PASS: re-fetching the proposal shows the same failed result, untouched", () => {
    const p = getProposal(proposalId, conn)!;
    const results = JSON.parse(p.test_results_json);
    assert.strictEqual(results.allPassed, false);
  });
}

// ============================================================
// GLOBAL scope: hardest to approve — requires explicit second confirmation
// ============================================================
console.log("\n=== GLOBAL Scope Confirmation Gate ===");
{
  const conn = tmpDb("global");
  const p = createProposal({ proposalType: "SIGN_PERSPECTIVE_RULE", module: "reconciliation", scopeType: "GLOBAL", ruleConfig: { matchField: "source_role", matchPattern: "BANK_STATEMENT" }, title: "Global sign convention for bank statements" }, "OWNER", conn);
  addExample(p.proposal_id, { exampleType: "POSITIVE", input: { source_role: "BANK_STATEMENT" } }, "OWNER", conn);
  addExample(p.proposal_id, { exampleType: "NEGATIVE", input: { source_role: "VENDOR_STATEMENT" } }, "OWNER", conn);
  runProposalTests(p.proposal_id, "OWNER", conn);
  submitForApproval(p.proposal_id, "OWNER", conn);

  test("approveAndActivate refuses a GLOBAL-scope proposal without confirmGlobal:true", () => {
    assert.throws(() => approveAndActivate(p.proposal_id, { approver: "owner", reason: "test" }, conn), /GLOBAL scope requires an explicit second confirmation/);
  });

  test("approveAndActivate succeeds for GLOBAL scope once confirmGlobal:true is explicitly passed", () => {
    const activated = approveAndActivate(p.proposal_id, { approver: "owner", reason: "Confirmed with owner — applies bank-wide", confirmGlobal: true }, conn);
    assert.strictEqual(activated.status, "ACTIVE");
  });
}

// ============================================================
// Versioning & Rollback
// ============================================================
console.log("\n=== Rule Versioning & Rollback ===");
{
  const conn = tmpDb("rollback");
  const v1 = createProposal({ proposalType: "DATE_FORMAT_INTERPRETATION", module: "reconciliation", scopeType: "SOURCE_FORMAT", ruleConfig: { matchField: "date_raw", matchPattern: "regex:^\\d{2}/\\d{2}/\\d{4}$" }, title: "DD/MM/YYYY interpretation for Source X" }, "OWNER", conn);
  addExample(v1.proposal_id, { exampleType: "POSITIVE", input: { date_raw: "05/09/2026" } }, "OWNER", conn);
  addExample(v1.proposal_id, { exampleType: "NEGATIVE", input: { date_raw: "2026-09-05" } }, "OWNER", conn);
  runProposalTests(v1.proposal_id, "OWNER", conn);
  submitForApproval(v1.proposal_id, "OWNER", conn);
  approveAndActivate(v1.proposal_id, { approver: "owner", reason: "v1 approved" }, conn);

  let v2Id = "";
  test("A replacement version references the prior version as predecessor and increments version_number", () => {
    const v2 = createProposal({ ruleKey: v1.rule_key, proposalType: "DATE_FORMAT_INTERPRETATION", module: "reconciliation", scopeType: "SOURCE_FORMAT", ruleConfig: { matchField: "date_raw", matchPattern: "regex:^\\d{4}-\\d{2}-\\d{2}$" }, title: "Switched to YYYY-MM-DD after source vendor changed format" }, "OWNER", conn);
    v2Id = v2.proposal_id;
    assert.strictEqual(v2.version_number, 2);
    assert.strictEqual(v2.predecessor_version_id, v1.proposal_id);
  });

  test("createProposal rejects an unknown ruleKey", () => {
    assert.throws(() => createProposal({ ruleKey: "does-not-exist", proposalType: "DATE_FORMAT_INTERPRETATION", module: "x", scopeType: "GLOBAL", ruleConfig: { matchField: "a", matchPattern: "b" }, title: "x" }, "OWNER", conn), LearningError);
  });

  test("Activating v2 automatically disables (never deletes) the previously ACTIVE v1", () => {
    addExample(v2Id, { exampleType: "POSITIVE", input: { date_raw: "2026-09-05" } }, "OWNER", conn);
    addExample(v2Id, { exampleType: "NEGATIVE", input: { date_raw: "05/09/2026" } }, "OWNER", conn);
    runProposalTests(v2Id, "OWNER", conn);
    submitForApproval(v2Id, "OWNER", conn);
    approveAndActivate(v2Id, { approver: "owner", reason: "v2 approved after format change" }, conn);
    const v1After = getProposal(v1.proposal_id, conn)!;
    assert.strictEqual(v1After.status, "DISABLED");
    // v1's own identity fields are untouched — only status/disabled_* changed.
    assert.strictEqual(v1After.rule_config_json, v1.rule_config_json);
    assert.strictEqual(v1After.title, v1.title);
  });

  test("Rollback to v1 creates a NEW v3 (never mutates v1 or v2), and disables the current active v2", () => {
    const v3 = rollbackToVersion(v1.proposal_id, "owner", "Vendor reverted to the old DD/MM/YYYY format", conn);
    assert.strictEqual(v3.version_number, 3);
    assert.strictEqual(v3.rule_config_json, v1.rule_config_json);
    assert.strictEqual(v3.rollback_of_version_id, v1.proposal_id);
    assert.strictEqual(v3.status, "ACTIVE");

    const v2After = getProposal(v2Id, conn)!;
    assert.strictEqual(v2After.status, "DISABLED");

    const v1After = getProposal(v1.proposal_id, conn)!;
    assert.strictEqual(v1After.status, "DISABLED"); // preserved in history, unchanged identity, still not the live active row
  });

  test("Full rule history preserves every version in order, none rewritten", () => {
    const history = listRuleHistory(v1.rule_key, conn);
    assert.strictEqual(history.length, 3);
    assert.deepStrictEqual(history.map((h) => h.version_number), [1, 2, 3]);
  });
}

// ============================================================
// Conflict Detection — never silently picks a winner
// ============================================================
console.log("\n=== Conflict Detection ===");
{
  const conn = tmpDb("conflicts");

  function activatedProposal(scopeType: string, matchField: string, matchPattern: string, title: string): ReturnType<typeof createProposal> {
    const p = createProposal({ proposalType: "PARTY_ALIAS", module: "reconciliation", scopeType: scopeType as any, ruleConfig: { matchField, matchPattern }, title }, "OWNER", conn);
    addExample(p.proposal_id, { exampleType: "POSITIVE", input: { [matchField]: matchPattern } }, "OWNER", conn);
    addExample(p.proposal_id, { exampleType: "NEGATIVE", input: { [matchField]: "definitely-not-a-match" } }, "OWNER", conn);
    runProposalTests(p.proposal_id, "OWNER", conn);
    submitForApproval(p.proposal_id, "OWNER", conn);
    return p;
  }

  const active1 = activatedProposal("PARTY", "party_name_raw", "ABC Traders", "Alias ABC Traders -> Customer C-001");
  approveAndActivate(active1.proposal_id, { approver: "owner", reason: "approved" }, conn);

  test("A second active-type proposal with the exact same scope but a different config produces an OPEN OVERLAPPING_SCOPE conflict", () => {
    const p2 = createProposal({ proposalType: "PARTY_ALIAS", module: "reconciliation", scopeType: "PARTY", scopeValue: {}, ruleConfig: { matchField: "party_name_raw", matchPattern: "ABC Traders Ltd" }, title: "Conflicting alias for the same scope" }, "OWNER", conn);
    addExample(p2.proposal_id, { exampleType: "POSITIVE", input: { party_name_raw: "ABC Traders Ltd" } }, "OWNER", conn);
    addExample(p2.proposal_id, { exampleType: "NEGATIVE", input: { party_name_raw: "nope" } }, "OWNER", conn);
    runProposalTests(p2.proposal_id, "OWNER", conn);
    const conflicts = detectConflicts(p2.proposal_id, conn);
    assert.ok(conflicts.some((c) => c.conflict_type === "OVERLAPPING_SCOPE"), "expected an OVERLAPPING_SCOPE conflict");
  });

  test("submitForApproval still succeeds (conflicts are recorded, not silently blocking submission) but activation is refused while the conflict is OPEN", () => {
    const p2 = listProposals({}, conn).find((p) => p.title === "Conflicting alias for the same scope")!;
    submitForApproval(p2.proposal_id, "OWNER", conn);
    assert.throws(() => approveAndActivate(p2.proposal_id, { approver: "owner", reason: "try to activate anyway" }, conn), /unresolved conflict/);
  });

  test("Resolving the conflict requires a non-empty resolution note, and clears it from the OPEN list", () => {
    const before = listOpenConflicts(conn);
    assert.ok(before.length > 0);
    assert.throws(() => resolveConflict(before[0].conflict_id as string, "", "owner", conn), LearningError);
    resolveConflict(before[0].conflict_id as string, "Owner decided ABC Traders Ltd is the correct canonical name; disabled the old alias.", "owner", conn);
    const after = listOpenConflicts(conn);
    assert.strictEqual(after.length, before.length - 1);
  });

  test("GLOBAL vs scoped conflict is detected", () => {
    const globalP = createProposal({ proposalType: "PARTY_ALIAS", module: "reconciliation", scopeType: "GLOBAL", ruleConfig: { matchField: "party_name_raw", matchPattern: "GLOBALCO" }, title: "Global alias rule" }, "OWNER", conn);
    addExample(globalP.proposal_id, { exampleType: "POSITIVE", input: { party_name_raw: "GLOBALCO" } }, "OWNER", conn);
    addExample(globalP.proposal_id, { exampleType: "NEGATIVE", input: { party_name_raw: "nope" } }, "OWNER", conn);
    runProposalTests(globalP.proposal_id, "OWNER", conn);
    const conflicts = detectConflicts(globalP.proposal_id, conn);
    assert.ok(conflicts.some((c) => c.conflict_type === "GLOBAL_VS_SCOPED"), "expected a GLOBAL_VS_SCOPED conflict against the active PARTY-scoped alias");
  });
}

// ============================================================
// Expiry / Review-date workflow
// ============================================================
console.log("\n=== Expiry / Review-Date Workflow ===");
{
  const conn = tmpDb("expiry");
  const p = createProposal({ proposalType: "TIMING_WINDOW_RULE", module: "reconciliation", scopeType: "VENDOR", ruleConfig: { matchField: "vendor_id", matchPattern: "V-100" }, title: "Temporary timing window for Vendor V-100", expiryDate: "2020-01-01T00:00:00.000Z" }, "OWNER", conn);
  addExample(p.proposal_id, { exampleType: "POSITIVE", input: { vendor_id: "V-100" } }, "OWNER", conn);
  addExample(p.proposal_id, { exampleType: "NEGATIVE", input: { vendor_id: "V-200" } }, "OWNER", conn);
  runProposalTests(p.proposal_id, "OWNER", conn);
  submitForApproval(p.proposal_id, "OWNER", conn);
  approveAndActivate(p.proposal_id, { approver: "owner", reason: "temporary approval" }, conn);

  test("checkAndExpireProposals marks a past-due ACTIVE rule EXPIRED — never silently continues", () => {
    const expired = checkAndExpireProposals("SYSTEM", conn);
    assert.strictEqual(expired.length, 1);
    assert.strictEqual(expired[0].status, "EXPIRED");
  });

  test("renewExpiry moves an EXPIRED rule back to ACTIVE with a new expiry date, as an explicit owner action", () => {
    const renewed = renewExpiry(p.proposal_id, "2030-01-01T00:00:00.000Z", null, "owner", conn);
    assert.strictEqual(renewed.status, "ACTIVE");
    assert.strictEqual(renewed.expiry_date, "2030-01-01T00:00:00.000Z");
  });

  test("archiveProposal is refused for an ACTIVE rule (must be DISABLED/REJECTED/EXPIRED first)", () => {
    assert.throws(() => archiveProposal(p.proposal_id, "owner", conn), LearningError);
  });

  test("disableProposal then archiveProposal succeeds, preserving history", () => {
    disableProposal(p.proposal_id, "owner", "No longer needed", conn);
    const archived = archiveProposal(p.proposal_id, "owner", conn);
    assert.strictEqual(archived.status, "ARCHIVED");
  });
}

// ============================================================
// One-Time Overrides — structurally separate from learning proposals
// ============================================================
console.log("\n=== One-Time Overrides ===");
{
  const conn = tmpDb("overrides");
  const wsId = makeWorkspace(conn);

  test("createOverride requires target description, action, reviewer, and reason", () => {
    assert.throws(() => createOverride({ targetDescription: "", overrideAction: "", reviewer: "", reason: "" }, "OWNER", conn), OverrideError);
  });

  test("createOverride records a one-time override without touching any rule/proposal table", () => {
    const before = listProposals({}, conn).length;
    const override = createOverride(
      { workspaceId: wsId, targetDescription: "Bill PB-2026-00931 residual of Rs 50", overrideAction: "Treat as fully settled for this case only", reviewer: "owner.reviewer", reason: "Vendor confirmed rounding difference via email dated 2026-09-14", evidence: ["email:2026-09-14"] },
      "OWNER",
      conn
    );
    assert.ok(override.override_id);
    const after = listProposals({}, conn).length;
    assert.strictEqual(before, after, "creating an override must never create/alter a learning_proposals row");
  });

  test("listOverrides filters by workspace", () => {
    const overrides = listOverrides({ workspaceId: wsId }, conn);
    assert.strictEqual(overrides.length, 1);
  });
}

// ============================================================
// Unsupported / Uncertain Case Workflow
// ============================================================
console.log("\n=== Unsupported / Uncertain Case Workflow ===");
{
  const conn = tmpDb("unsupported");
  const wsId = makeWorkspace(conn);
  let caseId = "";

  test("createUnsupportedCase requires description and reasonNoSafeDecision", () => {
    assert.throws(() => createUnsupportedCase({ description: "", reasonNoSafeDecision: "" }, "OWNER", conn), UnsupportedCaseError);
  });

  test("createUnsupportedCase starts OPEN", () => {
    const kase = createUnsupportedCase(
      { workspaceId: wsId, description: "Two vendor statement formats found in the same PDF upload", reasonNoSafeDecision: "No approved column-mapping rule exists for the second format yet", affectedRecordsEstimate: 12, affectedAmount: "45000.00" },
      "OWNER",
      conn
    );
    caseId = kase.case_id;
    assert.strictEqual(kase.status, "OPEN");
  });

  test("resolveUnsupportedCase requires resolutionRefId for ONE_TIME_OVERRIDE / PROPOSE_RULE", () => {
    assert.throws(() => resolveUnsupportedCase(caseId, "ONE_TIME_OVERRIDE", undefined, "OWNER", conn), UnsupportedCaseError);
  });

  test("resolveUnsupportedCase(HOLD) does not require a ref id and moves status to HOLD", () => {
    const resolved = resolveUnsupportedCase(caseId, "HOLD", undefined, "OWNER", conn);
    assert.strictEqual(resolved.status, "HOLD");
    assert.strictEqual(resolved.resolution_type, "HOLD");
  });

  test("markUnsupportedCaseResolved finalizes to RESOLVED once a resolution path is chosen", () => {
    const finalized = markUnsupportedCaseResolved(caseId, "OWNER", conn);
    assert.strictEqual(finalized.status, "RESOLVED");
  });

  test("listUnsupportedCases filters by status", () => {
    const resolved = listUnsupportedCases({ workspaceId: wsId, status: "RESOLVED" }, conn);
    assert.strictEqual(resolved.length, 1);
  });
}

// ============================================================
// Impact Preview (read-only, never mutates)
// ============================================================
console.log("\n=== Impact Preview ===");
{
  test("previewImpact counts matches over a caller-supplied sample without mutating anything", () => {
    const result = previewImpact(JSON.stringify({ matchField: "vendor_id", matchPattern: "V-1" }), [{ vendor_id: "V-1" }, { vendor_id: "V-1" }, { vendor_id: "V-2" }]);
    assert.strictEqual(result.totalSampled, 3);
    assert.strictEqual(result.wouldApply, 2);
  });
}

// ============================================================
console.log(`\n${"=".repeat(60)}\nMILESTONE E LEARNING TEST SUMMARY: ${passedCount} passed, ${failedCount} failed\n${"=".repeat(60)}`);
if (failedCount > 0) process.exit(1);

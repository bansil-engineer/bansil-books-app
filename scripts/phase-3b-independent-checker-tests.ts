// ============================================================
// Bansil Books Analytics — Phase 3B: General Independent Checker Tests
// 32 Real Assertions for Permanent General Independent Verification
// Coexistence with Financial Reviewer, Independence, Risk Policy,
// Exact Outcomes, Finalization Gate, Authority Preservation & DB Safety
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";

// ============================================================
// STEP 0: TEST DATABASE ISOLATION
// Ensure test runs against an isolated temporary database.
// Operational DB (data/ai_workspace.db) must NOT be mutated.
// ============================================================

const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `phase3b_test_isolated_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.db`
);
process.env.AI_WORKSPACE_DB_PATH = TEST_DB_PATH;

const OPERATIONAL_DB_PATH = path.join(process.cwd(), "data", "ai_workspace.db");

function getOperationalSnapshot() {
  if (!fs.existsSync(OPERATIONAL_DB_PATH)) {
    return { hash: null, counts: {} };
  }
  const fileBuf = fs.readFileSync(OPERATIONAL_DB_PATH);
  const hash = crypto.createHash("sha256").update(fileBuf).digest("hex");

  const opDb = new DatabaseSync(OPERATIONAL_DB_PATH, { readOnly: true });
  const tables = [
    "ai_departments", "ai_agents", "ai_budget_periods",
    "ai_department_budgets", "ai_agent_budgets", "ai_task_budgets",
    "ai_usage_ledger", "ai_budget_transfers", "ai_tasks",
    "ai_memory_entries", "ai_runs", "ai_audit_events",
  ];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    try {
      const row = opDb.prepare(`SELECT count(*) as c FROM ${t}`).get() as { c: number };
      counts[t] = row.c;
    } catch {
      counts[t] = -1;
    }
  }
  opDb.close();
  return { hash, counts };
}

// Capture operational state before any module imports or test executions
const initialOperationalSnapshot = getOperationalSnapshot();

// Static imports after test DB environment variable setup
import { initAiDatabase, getAiDatabase } from "../app/lib/db/ai-database";
import {
  determineReviewRequirement,
  validateCheckerIndependence,
  getOrCreateIndependentChecker,
  evaluateEvidence,
  recordReview,
  getReviewRecordByRunId,
  listReviewRecordsByRunId,
  enforceFinalizationGate,
  validateAuthorityPreservation,
  selectCheckerModel,
  ensureReviewTable,
  CheckerEvidence,
} from "../app/lib/ai/ceo/independent-checker";
import { isZohoWriteAllowed, checkAuthority } from "../app/lib/ai/ceo/authority-policy";
import { getCurrentBudgetPeriod } from "../app/lib/ai/ceo/budget-governance";
import { initiateExecutionRun, executeExecutionRun } from "../app/lib/ai/ceo/execution-lifecycle";
import { GovernedAction } from "../app/lib/ai/ceo/governance-types";
import { registerAgent } from "../app/lib/ai/ceo/agent-registry";
import { getOrCreateSuitableAgent } from "../app/lib/ai/ceo/agent-reuse-engine";

let passedCount = 0;
let failedCount = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passedCount++;
    } catch (err: any) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      failedCount++;
    }
  })();
}

async function runSuite() {
  console.log("\n============================================================");
  console.log("PHASE 3B: PERMANENT GENERAL INDEPENDENT CHECKER TEST SUITE");
  console.log("============================================================\n");

  // Initialize isolated test database
  const db = getAiDatabase();
  initAiDatabase(db);
  ensureReviewTable();

  // Helper to create a test run
  function createTestRun(id: string, objective: string, reviewerRequired: boolean = false) {
    const convId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    db.prepare(`
      INSERT OR IGNORE INTO ai_conversations (id, title, user_identifier, created_at, updated_at)
      VALUES (?, ?, 'test_user', datetime('now'), datetime('now'))
    `).run(convId, "Test Conversation");

    db.prepare(`
      INSERT INTO ai_runs (
        id, conversation_id, objective, status, priority, risk_class,
        reviewer_required, reviewer_status, started_at
      ) VALUES (?, ?, ?, 'RUNNING', 'NORMAL', 'STANDARD', ?, ?, datetime('now'))
    `).run(id, convId, objective, reviewerRequired ? 1 : 0, reviewerRequired ? "PENDING_REVIEW" : null);
  }

  // 1. LOW deterministic task skips checker
  await runTest("T01: LOW deterministic task skips checker", () => {
    const req = determineReviewRequirement({
      objective: "Calculate simple sum of invoices",
      riskLevel: "LOW",
    });
    assert.strictEqual(req.required, false, "LOW deterministic task must not require checker");
    assert.strictEqual(req.riskLevel, "LOW");
  });

  // 2. LOW SQL result uses zero review model calls
  await runTest("T02: LOW SQL result uses zero review model calls", () => {
    const req = determineReviewRequirement({
      objective: "SELECT sum(amount) FROM sales_invoices",
      actionType: "DETERMINISTIC_CALCULATION",
      riskLevel: "LOW",
    });
    assert.strictEqual(req.required, false, "Deterministic SQL must skip checker");
    assert.strictEqual(req.modelTierPreference, "NONE", "Model tier must be NONE");
    const model = selectCheckerModel("LOW");
    assert.strictEqual(model.cost, 0.0, "Checker cost for LOW task must be exactly ₹0.00");
  });

  // 3. HIGH material task requires checker
  await runTest("T03: HIGH material task requires checker", () => {
    const req = determineReviewRequirement({
      objective: "Commercial analysis of vendor pricing and gross margin implications",
      riskLevel: "HIGH",
      isMaterial: true,
    });
    assert.strictEqual(req.required, true, "HIGH material task must require checker");
    assert.strictEqual(req.reviewType, "GENERAL", "Non-financial material task must use GENERAL checker");
  });

  // 4. CRITICAL task requires checker
  await runTest("T04: CRITICAL task requires checker", () => {
    const req = determineReviewRequirement({
      objective: "Initiate bank transfer ₹50,000 for vendor disbursement",
      actionType: "BANK_PAYMENT",
      riskLevel: "CRITICAL",
    });
    assert.strictEqual(req.required, true, "CRITICAL task must require checker");
    assert.strictEqual(req.riskLevel, "CRITICAL");
    assert.strictEqual(req.requiresOwnerApproval, true, "CRITICAL task must require Owner approval");
  });

  // 5. worker cannot review itself
  await runTest("T05: worker cannot review itself", () => {
    const check = validateCheckerIndependence("agent_worker_101", "agent_worker_101");
    assert.strictEqual(check.valid, false, "Same worker and checker ID must fail validation");
    assert.ok(check.reason?.includes("Worker cannot verify its own work"), "Reason must state worker cannot verify itself");
  });

  // 6. same agent worker/checker rejected
  await runTest("T06: same agent worker/checker rejected in recordReview", () => {
    assert.throws(
      () => {
        recordReview({
          runId: "run_test_06",
          workerId: "agent_ops_alpha",
          checkerId: "agent_ops_alpha",
          reviewType: "GENERAL",
          riskLevel: "HIGH",
          evidenceReviewed: ["item_1"],
          result: "PASS",
        });
      },
      /Independence violation/,
      "recordReview must throw when worker_id == checker_id"
    );
  });

  // 7. reusable existing checker preferred
  await runTest("T07: reusable existing checker preferred", () => {
    // Ensure an existing general reviewer exists
    getOrCreateSuitableAgent({
      department: "OPERATIONS",
      role: "General Reviewer",
      name: "Existing General Checker",
      level: "REVIEWER",
      requiredCapabilities: [
        "COMPANY_DATA_READ",
        "EVIDENCE_COMPARISON",
        "CALCULATION",
        "REPORT_GENERATION",
      ],
      created_reason: "Pre-existing general checker for testing",
    });

    const sel = getOrCreateIndependentChecker({
      workerId: "worker_agent_555",
      reviewType: "GENERAL",
      riskLevel: "HIGH",
    });

    assert.strictEqual(sel.action, "REUSED", "Must reuse existing general reviewer");
    assert.ok(sel.agent.role.toLowerCase().includes("general") || sel.agent.role.toLowerCase().includes("reviewer"));
  });

  // 8. duplicate checker not created unnecessarily
  await runTest("T08: duplicate checker not created unnecessarily", () => {
    const allBefore = db.prepare("SELECT count(*) as c FROM ai_agents WHERE role LIKE '%Reviewer%' OR role LIKE '%Checker%'").get() as { c: number };
    const sel = getOrCreateIndependentChecker({
      workerId: "worker_agent_777",
      reviewType: "GENERAL",
      riskLevel: "HIGH",
    });
    const allAfter = db.prepare("SELECT count(*) as c FROM ai_agents WHERE role LIKE '%Reviewer%' OR role LIKE '%Checker%'").get() as { c: number };

    assert.strictEqual(sel.action, "REUSED", "Must reuse existing checker");
    assert.strictEqual(allBefore.c, allAfter.c, "Reviewer agent count must not increase when reusable checker exists");
  });

  // 9. PASS allows finalization
  await runTest("T09: PASS allows finalization", () => {
    const runId = `run_pass_${Date.now()}`;
    createTestRun(runId, "Commercial analysis of vendor contracts", true);

    recordReview({
      runId,
      workerId: "worker_01",
      checkerId: "agent_existing_general_checker_001",
      reviewType: "GENERAL",
      riskLevel: "HIGH",
      evidenceReviewed: ["doc_rfq_01", "pricing_table_v2"],
      result: "PASS",
      notes: "All contractual terms and margin calculations verified.",
    });

    const gate = enforceFinalizationGate(runId);
    assert.strictEqual(gate.canFinalize, true, "PASS must allow finalization");
    assert.strictEqual(gate.status, "COMPLETED", "Status must be COMPLETED");
  });

  // 10. PASS_WITH_NOTES allows finalization with notes
  await runTest("T10: PASS_WITH_NOTES allows finalization with notes", () => {
    const runId = `run_notes_${Date.now()}`;
    createTestRun(runId, "Vendor comparison analysis", true);

    recordReview({
      runId,
      workerId: "worker_02",
      checkerId: "agent_existing_general_checker_001",
      reviewType: "GENERAL",
      riskLevel: "HIGH",
      evidenceReviewed: ["quote_v1", "quote_v2"],
      result: "PASS_WITH_NOTES",
      notes: "Provisional delivery lead time subject to logistics confirmation.",
    });

    const gate = enforceFinalizationGate(runId);
    assert.strictEqual(gate.canFinalize, true, "PASS_WITH_NOTES must allow finalization");
    assert.strictEqual(gate.status, "COMPLETED");
    assert.ok(gate.notes?.includes("Provisional delivery lead time"), "Notes must be preserved in gate output");
  });

  // 11. notes appear in Owner response
  await runTest("T11: notes appear in Owner response", async () => {
    const run = await initiateExecutionRun("Working-capital and sales versus purchase reconciliation");
    assert.ok(run.final_response?.includes("Provisional") || run.final_response?.includes("Reviewer Notes") || run.final_response?.includes("What Was Checked"), "Notes must appear in final response");
  });

  // 12. REJECT blocks successful finalization
  await runTest("T12: REJECT blocks successful finalization", () => {
    const runId = `run_reject_${Date.now()}`;
    createTestRun(runId, "Commercial feasibility proposal", true);

    recordReview({
      runId,
      workerId: "worker_03",
      checkerId: "agent_existing_general_checker_001",
      reviewType: "GENERAL",
      riskLevel: "HIGH",
      evidenceReviewed: ["proposal_doc"],
      result: "REJECT",
      notes: "Critical arithmetic error in cost-benefit model.",
    });

    const gate = enforceFinalizationGate(runId);
    assert.strictEqual(gate.canFinalize, false, "REJECT must block finalization");
    assert.strictEqual(gate.status, "BLOCKED", "Status must be BLOCKED");
    assert.ok(gate.blockerReason?.includes("REJECTED"), "Blocker reason must state rejection");
  });

  // 13. INSUFFICIENT_EVIDENCE blocks unsupported conclusion
  await runTest("T13: INSUFFICIENT_EVIDENCE blocks unsupported conclusion", () => {
    const runId = `run_in_ev_${Date.now()}`;
    createTestRun(runId, "Tender margin projection", true);

    recordReview({
      runId,
      workerId: "worker_04",
      checkerId: "agent_existing_general_checker_001",
      reviewType: "GENERAL",
      riskLevel: "HIGH",
      evidenceReviewed: [],
      result: "INSUFFICIENT_EVIDENCE",
      notes: "No verified historical bill rates provided for comparison.",
    });

    const gate = enforceFinalizationGate(runId);
    assert.strictEqual(gate.canFinalize, false, "INSUFFICIENT_EVIDENCE must block completion");
    assert.strictEqual(gate.status, "PARTIAL", "Status must be PARTIAL");
  });

  // 14. insufficient evidence can trigger evidence-gathering path
  await runTest("T14: insufficient evidence can trigger evidence-gathering path", () => {
    const evidence1: CheckerEvidence = {
      objective: "Project margin assessment",
      workerResult: "done",
      evidenceReferences: [],
      riskLevel: "HIGH",
    };
    const eval1 = evaluateEvidence(evidence1, "checker_01", "worker_01");
    assert.strictEqual(eval1.result, "INSUFFICIENT_EVIDENCE", "Worker saying 'done' without evidence must be INSUFFICIENT_EVIDENCE");

    // Gather evidence and re-evaluate
    const evidence2: CheckerEvidence = {
      objective: "Project margin assessment",
      workerResult: "Evaluated 12 purchase orders against job estimate #401",
      evidenceReferences: ["po_401_1", "po_401_2"],
      riskLevel: "HIGH",
      knownLimitations: ["Freight unexpanded"],
    };
    const eval2 = evaluateEvidence(evidence2, "checker_01", "worker_01");
    assert.strictEqual(eval2.result, "PASS_WITH_NOTES", "Once evidence gathered, re-review passes with notes");
  });

  // 15. missing required review blocks finalization
  await runTest("T15: missing required review blocks finalization", () => {
    const runId = `run_missing_rev_${Date.now()}`;
    createTestRun(runId, "Management recommendation on vendor consolidation", true);

    const gate = enforceFinalizationGate(runId);
    assert.strictEqual(gate.canFinalize, false, "Missing review must block finalization");
    assert.strictEqual(gate.status, "WAITING_REVIEW", "Status must be WAITING_REVIEW");
  });

  // 16. checker cannot override Owner approval requirement
  await runTest("T16: checker cannot override Owner approval requirement", () => {
    const action: GovernedAction = {
      actionType: "BANK_PAYMENT",
      target: "HDFC Bank",
      amount: 150000,
      riskLevel: "CRITICAL",
      category: "OWNER_APPROVAL_REQUIRED",
      requiresReview: true,
      description: "Vendor bank disbursement",
    };
    const res = validateAuthorityPreservation(action, "PASS");
    assert.strictEqual(res.allowed, false, "Checker PASS cannot override Owner approval requirement");
    assert.strictEqual(res.overrideAttemptBlocked, true);
  });

  // 17. checker cannot override ZOHO hard policy
  await runTest("T17: checker cannot override ZOHO hard policy", () => {
    const action: GovernedAction = {
      actionType: "ZOHO_WRITE",
      target: "Zoho Books API",
      riskLevel: "CRITICAL",
      category: "PROHIBITED",
      requiresReview: true,
      description: "Write bill to Zoho",
    };
    const res = validateAuthorityPreservation(action, "PASS");
    assert.strictEqual(res.allowed, false, "Checker PASS cannot override ZOHO hard policy");
    assert.strictEqual(res.overrideAttemptBlocked, true);
    assert.ok(res.reason.includes("ZOHO WRITE = 0"));
  });

  // 18. checker cannot override destructive-data safety
  await runTest("T18: checker cannot override destructive-data safety", () => {
    const action: GovernedAction = {
      actionType: "PERMANENT_DATA_DELETION",
      target: "Production database",
      riskLevel: "CRITICAL",
      category: "OWNER_APPROVAL_REQUIRED",
      requiresReview: true,
      description: "Drop operational tables",
    };
    const res = validateAuthorityPreservation(action, "PASS");
    assert.strictEqual(res.allowed, false, "Checker PASS cannot override destructive data policy");
    assert.strictEqual(res.overrideAttemptBlocked, true);
  });

  // 19. financial reviewer remains available
  await runTest("T19: financial reviewer remains available", () => {
    const sel = getOrCreateIndependentChecker({
      workerId: "worker_agent_fin_test",
      reviewType: "FINANCIAL",
      riskLevel: "HIGH",
    });
    assert.ok(sel.agent, "Financial reviewer agent must be returned");
    assert.ok(
      sel.agent.role.toLowerCase().includes("financial reviewer") || sel.agent.department === "FINANCE",
      "Must be a financial reviewer"
    );
  });

  // 20. general checker does not replace financial reviewer incorrectly
  await runTest("T20: general checker does not replace financial reviewer incorrectly", () => {
    const finReq = determineReviewRequirement({
      objective: "Audit balance sheet and statutory tax reconciliations",
    });
    assert.strictEqual(finReq.reviewType, "FINANCIAL", "Balance sheet must route to FINANCIAL reviewer");

    const genReq = determineReviewRequirement({
      objective: "Cross-department commercial analysis of Schneider vs ABB pricing",
      isMaterial: true,
    });
    assert.strictEqual(genReq.reviewType, "GENERAL", "Commercial vendor comparison must route to GENERAL reviewer");
  });

  // 21. review record persists worker/checker IDs
  await runTest("T21: review record persists worker/checker IDs", () => {
    const runId = `run_ids_${Date.now()}`;
    createTestRun(runId, "Independent review test", true);

    const record = recordReview({
      runId,
      workerId: "agent_specialist_sales_42",
      checkerId: "agent_existing_general_checker_001",
      reviewType: "GENERAL",
      riskLevel: "HIGH",
      evidenceReviewed: ["evidence_ref_99"],
      result: "PASS",
      notes: "IDs preserved test",
    });

    const fetched = getReviewRecordByRunId(runId);
    assert.strictEqual(fetched?.workerId, "agent_specialist_sales_42");
    assert.strictEqual(fetched?.checkerId, "agent_existing_general_checker_001");
    assert.strictEqual(fetched?.id, record.id);
  });

  // 22. review evidence references preserved
  await runTest("T22: review evidence references preserved", () => {
    const runId = `run_ev_${Date.now()}`;
    createTestRun(runId, "Evidence preservation test", true);

    const refs = ["sales_inv_#1126", "bill_#3084", "freight_ledger_line_210"];
    recordReview({
      runId,
      workerId: "agent_specialist_01",
      checkerId: "agent_existing_general_checker_001",
      reviewType: "GENERAL",
      riskLevel: "HIGH",
      evidenceReviewed: refs,
      result: "PASS",
    });

    const fetched = getReviewRecordByRunId(runId);
    assert.deepStrictEqual(fetched?.evidenceReviewed, refs, "Evidence references must be exactly preserved");
  });

  // 23. risk determines review requirement deterministically
  await runTest("T23: risk determines review requirement deterministically", () => {
    const low = determineReviewRequirement({ objective: "Lookup phone number", riskLevel: "LOW" });
    const high = determineReviewRequirement({ objective: "Vendor commercial recommendation", riskLevel: "HIGH", isMaterial: true });
    const crit = determineReviewRequirement({ objective: "Bank disbursement", actionType: "BANK_PAYMENT", riskLevel: "CRITICAL" });

    assert.strictEqual(low.required, false);
    assert.strictEqual(high.required, true);
    assert.strictEqual(crit.required, true);
  });

  // 24. no model required to classify review requirement
  await runTest("T24: no model required to classify review requirement", () => {
    const startTime = Date.now();
    const req = determineReviewRequirement({
      objective: "Any complex non-financial commercial analysis",
      isMaterial: true,
    });
    const durationMs = Date.now() - startTime;
    assert.ok(durationMs < 20, "Must execute in sub-millisecond time without network/model invocation");
    assert.strictEqual(typeof req.required, "boolean");
  });

  // 25. cheap checker preferred where sufficient
  await runTest("T25: cheap checker preferred where sufficient", () => {
    const selection = selectCheckerModel("HIGH", false);
    assert.strictEqual(selection.modelTier, "CHEAP", "Standard high-risk review must use CHEAP tier");
    assert.strictEqual(selection.cost, 0.5, "Standard cost must be ₹0.50");
  });

  // 26. stronger checker escalation records reason
  await runTest("T26: stronger checker escalation records reason", () => {
    const selection = selectCheckerModel("CRITICAL", true);
    assert.strictEqual(selection.modelTier, "STRONG", "Critical complex review escalates to STRONG tier");
    assert.ok(selection.escalationReason?.includes("Strong reviewer model escalated"), "Escalation reason must be recorded");
  });

  // 27. rejected worker result never marked COMPLETED successfully
  await runTest("T27: rejected worker result never marked COMPLETED successfully", () => {
    const runId = `run_no_complete_${Date.now()}`;
    createTestRun(runId, "Flawed proposal", true);

    recordReview({
      runId,
      workerId: "worker_flawed",
      checkerId: "agent_existing_general_checker_001",
      reviewType: "GENERAL",
      riskLevel: "HIGH",
      evidenceReviewed: ["flawed_calc"],
      result: "REJECT",
      notes: "Arithmetically flawed",
    });

    const run = db.prepare("SELECT * FROM ai_runs WHERE id = ?").get(runId) as any;
    assert.notStrictEqual(run.status, "COMPLETED", "Run status in DB must never be COMPLETED when rejected");
    assert.strictEqual(run.reviewer_status, "REJECTED");
  });

  // 28. retry/correction can be re-reviewed independently
  await runTest("T28: retry/correction can be re-reviewed independently", () => {
    const runId = `run_retry_${Date.now()}`;
    createTestRun(runId, "Project estimation retry", true);

    // Initial review: REJECT
    recordReview({
      runId,
      workerId: "worker_initial",
      checkerId: "agent_existing_general_checker_001",
      reviewType: "GENERAL",
      riskLevel: "HIGH",
      evidenceReviewed: ["draft_v1"],
      result: "REJECT",
      notes: "Draft v1 contained outdated bill prices",
    });

    let gate1 = enforceFinalizationGate(runId);
    assert.strictEqual(gate1.canFinalize, false, "Initial reject blocks completion");

    // Corrected run submitted: Re-reviewed independently
    recordReview({
      runId,
      workerId: "worker_corrected",
      checkerId: "agent_existing_general_checker_001",
      reviewType: "GENERAL",
      riskLevel: "HIGH",
      evidenceReviewed: ["draft_v2_updated_rates"],
      result: "PASS_WITH_NOTES",
      notes: "Updated rates verified against Sep 2026 purchase bills.",
    });

    let gate2 = enforceFinalizationGate(runId);
    assert.strictEqual(gate2.canFinalize, true, "Corrected re-review allows finalization");
    const records = listReviewRecordsByRunId(runId);
    assert.strictEqual(records.length, 2, "Both review records must be preserved for audit trail");
  });

  // 29. cross-department material conclusion receives checker
  await runTest("T29: cross-department material conclusion receives checker", () => {
    const req = determineReviewRequirement({
      objective: "Cross-department alignment on procurement lead times and sales SLA commitments",
      isMaterial: true,
    });
    assert.strictEqual(req.required, true, "Cross-department material conclusion must receive checker");
    assert.strictEqual(req.reviewType, "GENERAL");
  });

  // 30. simple reformat does not receive checker
  await runTest("T30: simple reformat does not receive checker", () => {
    const req = determineReviewRequirement({
      objective: "Reformat customer address table for display in report",
      riskLevel: "LOW",
    });
    assert.strictEqual(req.required, false, "Simple reformat must not receive checker");
  });

  // 31. AI budget ceiling still enforced
  await runTest("T31: AI budget ceiling still enforced", () => {
    const period = getCurrentBudgetPeriod();
    assert.strictEqual(period.monthly_limit, 15000, "AI monthly budget ceiling must remain ₹15,000");
    assert.ok(period.available_amount >= 0, "Available budget must be non-negative");
  });

  // 32. ZOHO WRITE remains 0
  await runTest("T32: ZOHO WRITE remains 0", () => {
    assert.strictEqual(isZohoWriteAllowed(), false, "isZohoWriteAllowed() must always return false");
  });

  // Operational DB Safety Check
  const finalOperationalSnapshot = getOperationalSnapshot();
  assert.strictEqual(
    finalOperationalSnapshot.hash,
    initialOperationalSnapshot.hash,
    "Operational DB (data/ai_workspace.db) SHA256 must NOT change after running Phase 3B test suite"
  );
  console.log(`\n  ✓ Operational DB SHA256 invariant verified (${initialOperationalSnapshot.hash?.slice(0, 16)}...)`);

  // Cleanup test DB
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  console.log("\n============================================================");
  console.log(`Phase 3B Independent Checker Tests: ${passedCount} passed, ${failedCount} failed out of 32`);
  console.log("============================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error("Suite failed with error:", err);
  process.exit(1);
});

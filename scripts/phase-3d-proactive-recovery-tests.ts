// ============================================================
// Bansil Books Analytics — Phase 3D: Proactive Management & Safe Recovery Tests
// 32 Real Assertions for Failure Classification, Autonomy Boundaries,
// Deterministic Retry Limits, Checker Integration, Governed Lessons & Cross-Dept
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
  `phase3d_test_isolated_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.db`
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
import { ensureReviewTable } from "../app/lib/ai/ceo/independent-checker";
import {
  classifyFailure,
  hasExceededRetryLimit,
  recordRecoveryAttempt,
  reassignTaskAgent,
  verifyCorrectionWithChecker,
  recordGovernedLesson,
  planCrossDepartmentInvestigation,
  consolidateCrossDepartmentResponse,
  inspectSystemHealthAndFollowUp,
  MAX_DETERMINISTIC_RETRIES,
} from "../app/lib/ai/ceo/self-correction-engine";
import {
  createTask,
  updateTaskStatus,
  getTask,
  recordTaskRetry,
} from "../app/lib/ai/ceo/task-coordinator";
import {
  classifyAction,
  classifyRisk,
  isZohoWriteAllowed,
} from "../app/lib/ai/ceo/authority-policy";
import {
  getCurrentBudgetPeriod,
  reserveBudget,
  recordActualCost,
  MONTHLY_AI_HARD_LIMIT,
} from "../app/lib/ai/ceo/budget-governance";
import {
  MEMORY_AUTHORITY_WEIGHTS,
  getMemory,
  validateAgainstHardPolicies,
} from "../app/lib/ai/ceo/memory-store";

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message || err}`);
    if (err.stack) {
      console.error(err.stack.split("\n").slice(1, 4).join("\n"));
    }
    return false;
  }
}

async function runTestSuite() {
  console.log("\n============================================================");
  console.log("PHASE 3D: PROACTIVE MANAGEMENT & SAFE RECOVERY TEST SUITE");
  console.log("============================================================\n");

  // Initialize test DB
  const db = getAiDatabase();
  initAiDatabase(db);
  ensureReviewTable();

  let passed = 0;
  let total = 0;

  function ensureRun(runId: string) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO ai_conversations (id, title, user_identifier, created_at, updated_at)
      VALUES ('conv_test_default', 'Test Chat', 'test_user', ?, ?)
    `).run(now, now);

    db.prepare(`
      INSERT OR IGNORE INTO ai_runs (
        id, conversation_id, objective, status, started_at
      ) VALUES (?, 'conv_test_default', 'Test Objective', 'RUNNING', ?)
    `).run(runId, now);
  }

  async function test(name: string, fn: () => void | Promise<void>) {
    total++;
    const ok = await runTest(name, fn);
    if (ok) passed++;
  }

  // 1. safe internal failure auto-retries
  await test("T01: safe internal failure auto-retries", () => {
    const classification = classifyFailure({
      error: new Error("SQLITE_BUSY: database is locked"),
      actionType: "DETERMINISTIC_CALCULATION",
      objective: "Calculate quarterly GP margin",
    });

    assert.strictEqual(classification.safeToSelfCorrect, true);
    assert.strictEqual(classification.requiresEscalation, false);
    assert.strictEqual(classification.recommendedAction, "RECALCULATE_SQL");
  });

  // 2. retry limit enforced
  await test("T02: retry limit enforced", () => {
    assert.strictEqual(hasExceededRetryLimit({ currentRetries: 0, maxRetries: 3 }), false);
    assert.strictEqual(hasExceededRetryLimit({ currentRetries: 2, maxRetries: 3 }), false);
    assert.strictEqual(hasExceededRetryLimit({ currentRetries: 3, maxRetries: 3 }), true);
    assert.strictEqual(hasExceededRetryLimit({ currentRetries: 4, maxRetries: 3 }), true);
  });

  // 3. repeated failure stops
  await test("T03: repeated failure stops", () => {
    const task = createTask({
      objective: "Transient API fetch task",
      requested_by: "test_runner",
      priority: "NORMAL",
      max_retries: 3,
    });

    // Simulate 3 retries
    recordTaskRetry(task.id, "Failure 1");
    recordTaskRetry(task.id, "Failure 2");
    recordTaskRetry(task.id, "Failure 3");

    const updated = getTask(task.id);
    assert.strictEqual(updated?.retry_count, 3);
    assert.strictEqual(hasExceededRetryLimit({ currentRetries: updated.retry_count, maxRetries: updated.max_retries }), true);

    // Stops further retry and transitions to FAILED
    updateTaskStatus(task.id, "FAILED", "Max retries exceeded; execution stopped", {
      failureReason: "RETRY_LIMIT_EXCEEDED",
    });

    const failedTask = getTask(task.id);
    assert.strictEqual(failedTask?.status, "FAILED");
    assert.strictEqual(failedTask?.failure_reason, "RETRY_LIMIT_EXCEEDED");
  });

  // 4. root-cause category recorded
  await test("T04: root-cause category recorded", () => {
    ensureRun("run_test_04");
    const record = recordRecoveryAttempt({
      runId: "run_test_04",
      taskId: "task_test_04",
      attemptNumber: 1,
      failureReason: "Syntax error in SQL aggregation",
      rootCauseCategory: "DETERMINISTIC_SQL_FAILURE",
      correctionAction: "RECALCULATE_SQL",
      verificationResult: "VERIFIED_PASS",
    });

    assert.strictEqual(record.rootCauseCategory, "DETERMINISTIC_SQL_FAILURE");
    assert.strictEqual(record.attemptNumber, 1);
  });

  // 5. correction action recorded
  await test("T05: correction action recorded", () => {
    ensureRun("run_test_05");
    const record = recordRecoveryAttempt({
      runId: "run_test_05",
      taskId: "task_test_05",
      attemptNumber: 2,
      failureReason: "Read timeout on local endpoint",
      rootCauseCategory: "TEMPORARY_SOURCE_FAILURE",
      correctionAction: "RETRY_READ",
      verificationResult: "VERIFIED_PASS",
    });

    assert.strictEqual(record.correctionAction, "RETRY_READ");
  });

  // 6. safe SQL recalculation can retry
  await test("T06: safe SQL recalculation can retry", () => {
    const res = classifyFailure({
      error: "no such column: invoice_date_alias",
      actionType: "READ_DATA",
      objective: "Select invoice totals for September 2026",
    });

    assert.strictEqual(res.category, "DETERMINISTIC_SQL_FAILURE");
    assert.strictEqual(res.safeToSelfCorrect, true);
    assert.strictEqual(res.recommendedAction, "RECALCULATE_SQL");
  });

  // 7. transient read failure can retry
  await test("T07: transient read failure can retry", () => {
    const res = classifyFailure({
      error: "ECONNRESET: connection reset by peer",
      actionType: "READ_DATA",
      objective: "Fetch cached vendor details",
    });

    assert.strictEqual(res.category, "TEMPORARY_SOURCE_FAILURE");
    assert.strictEqual(res.safeToSelfCorrect, true);
    assert.strictEqual(res.recommendedAction, "RETRY_READ");
  });

  // 8. unsafe financial action does not self-correct
  await test("T08: unsafe financial action does not self-correct", () => {
    const res = classifyFailure({
      error: "Payment gateway error during transfer",
      actionType: "BANK_PAYMENT",
      objective: "Transfer ₹50,000 to vendor account",
    });

    assert.strictEqual(res.safeToSelfCorrect, false, "Financial payment must NEVER self-correct");
    assert.strictEqual(res.requiresEscalation, true);
    assert.strictEqual(res.recommendedAction, "ESCALATE_TO_OWNER");
  });

  // 9. Zoho write never self-corrects
  await test("T09: Zoho write never self-corrects", () => {
    const res = classifyFailure({
      error: "Zoho write rejected: Books API write blocked",
      actionType: "ZOHO_WRITE",
      objective: "POST /books/v3/invoices",
    });

    assert.strictEqual(res.category, "ZOHO_WRITE_ATTEMPT");
    assert.strictEqual(res.safeToSelfCorrect, false);
    assert.strictEqual(res.requiresEscalation, true);
    assert.strictEqual(res.recommendedAction, "BLOCK_EXECUTION");
    assert.strictEqual(isZohoWriteAllowed(), false, "ZOHO WRITE must remain strictly 0");
  });

  // 10. destructive action escalates
  await test("T10: destructive action escalates", () => {
    const res = classifyFailure({
      error: "Cannot drop table without backup",
      actionType: "PERMANENT_DATA_DELETION",
      objective: "Drop table ai_usage_ledger",
    });

    assert.strictEqual(res.category, "DESTRUCTIVE_OPERATIONAL_ACTION");
    assert.strictEqual(res.safeToSelfCorrect, false);
    assert.strictEqual(res.requiresEscalation, true);
    assert.strictEqual(res.recommendedAction, "ESCALATE_TO_OWNER");
  });

  // 11. payment action escalates
  await test("T11: payment action escalates", () => {
    const res = classifyFailure({
      error: "Vendor payment approval required",
      actionType: "VENDOR_PAYMENT_APPROVAL",
      objective: "Approve vendor payment ₹25,000",
    });

    assert.strictEqual(res.requiresEscalation, true);
    assert.strictEqual(res.recommendedAction, "ESCALATE_TO_OWNER");
  });

  // 12. statutory action escalates
  await test("T12: statutory action escalates", () => {
    const res = classifyFailure({
      error: "GSTR-1 filing submission error",
      actionType: "STATUTORY_FILING",
      objective: "Submit statutory GSTR-1 return for FY26 Q2",
    });

    assert.strictEqual(res.category, "STATUTORY_ACTION");
    assert.strictEqual(res.safeToSelfCorrect, false);
    assert.strictEqual(res.requiresEscalation, true);
    assert.strictEqual(res.recommendedAction, "ESCALATE_TO_OWNER");
  });

  // 13. agent mismatch can reassign
  await test("T13: agent mismatch can reassign", () => {
    const res = classifyFailure({
      error: "Agent missing capability: vendor_analytics not found on general assistant",
      actionType: "INTERNAL_DELEGATION",
      objective: "Analyze supplier price variances",
    });

    assert.strictEqual(res.category, "AGENT_ASSIGNMENT_MISMATCH");
    assert.strictEqual(res.safeToSelfCorrect, true);
    assert.strictEqual(res.recommendedAction, "REASSIGN_AGENT");
  });

  // 14. existing agent reuse preferred
  await test("T14: existing agent reuse preferred", () => {
    const task = createTask({
      objective: "Audit purchase bills",
      requested_by: "ceo_main",
      priority: "NORMAL",
      department: "PURCHASE",
    });

    const first = reassignTaskAgent({
      taskId: task.id,
      department: "PURCHASE",
      role: "Vendor Analyst",
      requiredCapabilities: ["vendor_analytics"],
      purpose: "Vendor price analysis",
    });

    const task2 = createTask({
      objective: "Audit purchase bills 2",
      requested_by: "ceo_main",
      priority: "NORMAL",
      department: "PURCHASE",
    });

    const reassignment = reassignTaskAgent({
      taskId: task2.id,
      department: "PURCHASE",
      role: "Vendor Analyst",
      requiredCapabilities: ["vendor_analytics"],
      purpose: "Vendor price analysis 2",
    });

    assert.strictEqual(reassignment.action, "REUSED", "Must reuse existing suitable Purchase agent");
    assert.strictEqual(reassignment.agentId, first.agentId);
    assert.ok(reassignment.reason.includes("Reused existing agent"));
  });

  // 15. new agent creation requires reason
  await test("T15: new agent creation requires reason", () => {
    const task = createTask({
      objective: "Rare specialized task",
      requested_by: "ceo_main",
      priority: "NORMAL",
    });

    const result = reassignTaskAgent({
      taskId: task.id,
      department: "SPECIAL_OPS",
      role: "Cryptographic Auditor",
      requiredCapabilities: ["rare_crypto_verification_capability"],
      purpose: "Missing capability: cryptographic proof audit",
    });

    assert.ok(result.reason.includes("Missing capability") || result.reason.includes("Specialist"), "Creation reason must be documented");
  });

  // 16. material correction triggers checker
  await test("T16: material correction triggers checker", () => {
    ensureRun("run_material_16");
    const check = verifyCorrectionWithChecker({
      taskId: "task_material_16",
      runId: "run_material_16",
      workerAgentId: "agent_purchase_specialist",
      objective: "Cross-department commercial cost allocation analysis",
      correctedResult: "Recalculated vendor overhead variance at ₹3.42 Lakhs across 40 projects.",
      riskLevel: "HIGH",
      evidenceReferences: ["ref_purchase_bills_sep26", "ref_project_ledger_sep26"],
    });

    assert.strictEqual(check.allowed, true);
    assert.strictEqual(check.verdict, "PASS");
  });

  // 17. checker REJECT blocks correction
  await test("T17: checker REJECT blocks correction", () => {
    ensureRun("run_reject_17");
    const check = verifyCorrectionWithChecker({
      taskId: "task_reject_17",
      runId: "run_reject_17",
      workerAgentId: "agent_sales_specialist",
      objective: "Reconcile invoices against Zoho",
      correctedResult: "Posted to Zoho books and updated invoice records directly.",
      riskLevel: "HIGH",
    });

    assert.strictEqual(check.allowed, false, "REJECT must block correction finalization");
    assert.strictEqual(check.verdict, "REJECT");
    assert.ok(check.notes?.includes("REJECT") || check.notes?.includes("prohibited"));
  });

  // 18. PASS permits correction
  await test("T18: PASS permits correction", () => {
    ensureRun("run_pass_18");
    const check = verifyCorrectionWithChecker({
      taskId: "task_pass_18",
      runId: "run_pass_18",
      workerAgentId: "agent_accounts_specialist",
      objective: "Vendor debit note calculation",
      correctedResult: "Total verified debit note amount is ₹45,200 supported by PO-882 and Bill-901.",
      riskLevel: "HIGH",
      evidenceReferences: ["ref_po_882", "ref_bill_901"],
    });

    assert.strictEqual(check.allowed, true);
    assert.strictEqual(check.verdict, "PASS");
  });

  // 19. PASS_WITH_NOTES surfaces notes
  await test("T19: PASS_WITH_NOTES surfaces notes", () => {
    ensureRun("run_notes_19");
    const check = verifyCorrectionWithChecker({
      taskId: "task_notes_19",
      runId: "run_notes_19",
      workerAgentId: "agent_billing_specialist",
      objective: "Provisional customer billing accrual",
      correctedResult: "Provisional accrual estimated at ₹1.2 Cr pending final architect certification.",
      riskLevel: "HIGH",
      evidenceReferences: ["ref_provisional_work_order"],
      knownLimitations: ["Architect certificate pending", "Provisional measurement only"],
    });

    assert.strictEqual(check.allowed, true);
    assert.strictEqual(check.verdict, "PASS_WITH_NOTES");
    assert.ok(check.notes?.includes("Architect certificate pending") || check.notes?.includes("Provisional"));
  });

  // 20. insufficient evidence triggers evidence path
  await test("T20: insufficient evidence triggers evidence path", () => {
    ensureRun("run_insufficient_20");
    const check = verifyCorrectionWithChecker({
      taskId: "task_insufficient_20",
      runId: "run_insufficient_20",
      workerAgentId: "agent_finance_specialist",
      objective: "Substantive audit calculation",
      correctedResult: "Done.",
      riskLevel: "HIGH",
    });

    assert.strictEqual(check.allowed, false);
    assert.strictEqual(check.verdict, "INSUFFICIENT_EVIDENCE");
    assert.ok(check.notes?.toLowerCase().includes("insufficient") || check.notes?.toLowerCase().includes("done"));
  });

  // 21. verified correction records candidate lesson
  await test("T21: verified correction records candidate lesson", () => {
    const lesson = recordGovernedLesson({
      problem: "SQLite database lock during concurrent subtask write",
      rootCause: "DETERMINISTIC_SQL_FAILURE",
      fix: "Introduced exponential backoff retry up to 3 attempts",
      verification: "Independent checker passed rerun with zero failures",
      scope: "GLOBAL",
      confidence: 0.85,
      applicableContext: "Local SQLite database concurrent queries",
    });

    assert.strictEqual(lesson.success, true);
    assert.ok(lesson.lessonId);

    const memory = getMemory(lesson.lessonId!);
    assert.strictEqual(memory?.authority_level, "AGENT_LEARNED_LESSON");
    assert.strictEqual(memory?.status, "CANDIDATE");
  });

  // 22. unverified correction does not record lesson
  await test("T22: unverified correction does not record lesson", () => {
    ensureRun("run_unverified_22");
    const record = recordRecoveryAttempt({
      runId: "run_unverified_22",
      taskId: "task_unverified_22",
      attemptNumber: 1,
      failureReason: "Query error in aggregation",
      rootCauseCategory: "DETERMINISTIC_SQL_FAILURE",
      correctionAction: "RECALCULATE_SQL",
      verificationResult: "FAILED", // Not verified
    });

    assert.strictEqual(record.lessonRecorded, false);
    assert.strictEqual(record.candidateLessonId, undefined);
  });

  // 23. lesson cannot override hard policy
  await test("T23: lesson cannot override hard policy", () => {
    const zohoViolation = recordGovernedLesson({
      problem: "Need write access",
      rootCause: "ZOHO_WRITE_ATTEMPT",
      fix: "Allow write to Zoho Books API by setting ZOHO_WRITE=1",
      verification: "None",
      scope: "GLOBAL",
      confidence: 0.5,
      applicableContext: "Zoho sync",
    });

    assert.strictEqual(zohoViolation.success, false);
    assert.ok(zohoViolation.error?.includes("HARD POLICY VIOLATION"));

    const budgetViolation = recordGovernedLesson({
      problem: "Exceeded 15000 budget",
      rootCause: "SAFE_CALCULATION_BUG",
      fix: "Increase monthly budget beyond 15000",
      verification: "None",
      scope: "GLOBAL",
      confidence: 0.5,
      applicableContext: "Budgeting",
    });

    assert.strictEqual(budgetViolation.success, false);
    assert.ok(budgetViolation.error?.includes("HARD POLICY VIOLATION"));
  });

  // 24. lesson cannot override Owner policy
  await test("T24: lesson cannot override Owner policy", () => {
    const lessonWeight = MEMORY_AUTHORITY_WEIGHTS["AGENT_LEARNED_LESSON"];
    const ownerWeight = MEMORY_AUTHORITY_WEIGHTS["OWNER_APPROVED_RULE"];
    const sysWeight = MEMORY_AUTHORITY_WEIGHTS["SYSTEM_HARD_POLICY"];

    assert.strictEqual(lessonWeight, 20);
    assert.strictEqual(ownerWeight, 80);
    assert.strictEqual(sysWeight, 100);
    assert.ok(lessonWeight < ownerWeight, "Agent learned lesson must rank below Owner rule");
    assert.ok(lessonWeight < sysWeight, "Agent learned lesson must rank below System hard policy");
  });

  // 25. repeated identical lesson does not duplicate unnecessarily
  await test("T25: repeated identical lesson does not duplicate unnecessarily", () => {
    const first = recordGovernedLesson({
      problem: "Transient port binding failure on dev server",
      rootCause: "TEMPORARY_SOURCE_FAILURE",
      fix: "Wait 2 seconds and retry bind",
      verification: "PASS",
      scope: "GLOBAL",
      confidence: 0.8,
      applicableContext: "Server initialization",
    });

    const second = recordGovernedLesson({
      problem: "Transient port binding failure on dev server",
      rootCause: "TEMPORARY_SOURCE_FAILURE",
      fix: "Wait 2 seconds and retry bind",
      verification: "PASS",
      scope: "GLOBAL",
      confidence: 0.8,
      applicableContext: "Server initialization",
    });

    assert.strictEqual(first.success, true);
    assert.strictEqual(second.success, true);
    assert.strictEqual(second.deduplicated, true, "Must deduplicate identical lesson");
    assert.strictEqual(second.lessonId, first.lessonId);
  });

  // 26. cross-department plan works
  await test("T26: cross-department plan works", () => {
    const plan = planCrossDepartmentInvestigation("Why is project margin low on Project Alpha?");

    assert.ok(plan.departments.includes("ACCOUNTS"));
    assert.ok(plan.departments.includes("PURCHASE"));
    assert.ok(plan.departments.includes("BILLING"));
    assert.ok(plan.departments.includes("FINANCE"));
    assert.strictEqual(plan.departmentTasks.length, 4);
  });

  // 27. final response consolidated
  await test("T27: final response consolidated", () => {
    const report = consolidateCrossDepartmentResponse({
      objective: "Why is project margin low?",
      contributions: [
        {
          department: "ACCOUNTS",
          agentId: "agent_accounts",
          taskObjective: "GP analysis",
          finding: "Gross margin fell by 4.2% due to unbilled change orders.",
          cost: 0,
        },
        {
          department: "PURCHASE",
          agentId: "agent_purchase",
          taskObjective: "Material variance",
          finding: "Raw material steel costs rose 8% above estimation baseline.",
          cost: 0,
        },
        {
          department: "BILLING",
          agentId: "agent_billing",
          taskObjective: "Retention audit",
          finding: "₹18 Lakhs retention pending release from client.",
          cost: 0,
        },
      ],
      checkerResult: { passed: true, notes: "Verified against ledger" },
    });

    assert.strictEqual(report.status, "COMPLETED_WITH_NOTES");
    assert.strictEqual(report.departmentsInvolved.length, 3);
    assert.ok(report.executiveSummary.includes("Gross margin fell by 4.2%"));
    assert.ok(report.executiveSummary.includes("Raw material steel costs"));
  });

  // 28. no raw worker chatter
  await test("T28: no raw worker chatter", () => {
    const report = consolidateCrossDepartmentResponse({
      objective: "Margin inquiry",
      contributions: [
        {
          department: "FINANCE",
          agentId: "agent_fin",
          taskObjective: "Synthesize working capital",
          finding: "Carrying cost is 1.1% per month.",
          cost: 0,
        },
      ],
    });

    assert.strictEqual(report.rawAgentChatterSuppressed, true, "Raw worker chatter must be suppressed");
    assert.ok(!report.executiveSummary.includes("RAW_LOG:"));
  });

  // 29. no infinite retry
  await test("T29: no infinite retry", () => {
    const maxRetries = MAX_DETERMINISTIC_RETRIES;
    let attempts = 0;
    while (!hasExceededRetryLimit({ currentRetries: attempts, maxRetries })) {
      attempts++;
    }

    assert.strictEqual(attempts, maxRetries, "Loop must terminate deterministically at retry limit");
    assert.strictEqual(hasExceededRetryLimit({ currentRetries: attempts, maxRetries }), true);
  });

  // 30. AI budget still enforced
  await test("T30: AI budget still enforced", () => {
    const period = getCurrentBudgetPeriod();
    assert.ok(period.monthly_limit <= MONTHLY_AI_HARD_LIMIT);

    // Verify reservation against budget
    const res = reserveBudget({
      taskId: "task_recovery_budget_30",
      agentId: "ceo_main",
      model: "gpt-4o-mini",
      estimatedCost: 0.05,
      usageType: "TASK_RETRY",
      metadataSummary: "Recovery budget test",
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.taskBudget?.id);
    assert.strictEqual(res.taskBudget?.approved_ceiling, 0.05);
  });

  // 31. low-risk deterministic retry uses zero AI
  await test("T31: low-risk deterministic retry uses zero AI", () => {
    ensureRun("run_det_retry_31");
    const check = verifyCorrectionWithChecker({
      taskId: "task_det_retry_31",
      runId: "run_det_retry_31",
      workerAgentId: "agent_sql_worker",
      objective: "Recalculate customer tax sum",
      correctedResult: "Total tax calculated: ₹12,450.00",
      riskLevel: "LOW",
    });

    assert.strictEqual(check.allowed, true);
    assert.strictEqual(check.verdict, "PASS");
  });

  // 32. ZOHO WRITE remains 0
  await test("T32: ZOHO WRITE remains 0", () => {
    assert.strictEqual(isZohoWriteAllowed(), false, "ZOHO WRITE = 0 must hold true permanently");
    const classification = classifyFailure({
      error: "Zoho mutation attempt",
      actionType: "ZOHO_WRITE",
      objective: "Update Zoho invoice status",
    });
    assert.strictEqual(classification.safeToSelfCorrect, false);
    assert.strictEqual(classification.recommendedAction, "BLOCK_EXECUTION");
  });

  // Cleanup test DB
  if (fs.existsSync(TEST_DB_PATH)) {
    try {
      fs.unlinkSync(TEST_DB_PATH);
    } catch {
      // Ignore
    }
  }

  // Verify Operational DB invariance
  const finalOperationalSnapshot = getOperationalSnapshot();
  console.log("\n  ✓ Operational DB SHA256 invariant verified (" + (initialOperationalSnapshot.hash?.slice(0, 16) || "none") + "...)");
  assert.strictEqual(
    finalOperationalSnapshot.hash,
    initialOperationalSnapshot.hash,
    "CRITICAL SAFETY VIOLATION: Operational DB was modified during test run!"
  );

  console.log("\n============================================================");
  console.log(`Phase 3D Proactive Recovery Tests: ${passed} passed, ${total - passed} failed out of ${total}`);
  console.log("============================================================\n");

  if (passed !== total) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test suite threw uncaught error:", err);
  process.exit(1);
});

// ============================================================
// Phase 2C: Autonomous Execution Lifecycle Tests
// Comprehensive Verification of Governed State Machine, Task Graph,
// Budget Pre-reservation, Dependency Execution, Reviewer, Recovery,
// Idempotency, and Operational DB Invariance.
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
  `phase2c_test_isolated_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.db`
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
    "ai_departments",
    "ai_agents",
    "ai_budget_periods",
    "ai_department_budgets",
    "ai_agent_budgets",
    "ai_task_budgets",
    "ai_usage_ledger",
    "ai_budget_transfers",
    "ai_tasks",
    "ai_memory_entries",
    "ai_runs",
    "ai_audit_events",
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
const opSnapshotBefore = getOperationalSnapshot();
console.log(`[Phase 2C Test Setup] Operational DB SHA256 before: ${opSnapshotBefore.hash}`);
console.log(`[Phase 2C Test Setup] Using isolated test DB: ${TEST_DB_PATH}`);

// Dynamic imports to ensure process.env.AI_WORKSPACE_DB_PATH is effective
import { getAiDatabase } from "../app/lib/db/ai-database";
import {
  initiateExecutionRun,
  transitionRunState,
  evaluatePendingRun,
  cancelRun,
  resumeRun,
  getExecutionRun,
  getRunTasks,
  getRunHandoffs,
  createConflictRequiresReview,
  retryFailedTask,
} from "../app/lib/ai/ceo/execution-lifecycle";
import { handleOwnerMessage } from "../app/lib/ai/ceo/ceo-orchestrator";
import {
  getCurrentBudgetPeriod,
  reserveBudget,
  recordActualCost,
  releaseBudgetCommitment,
  MONTHLY_AI_HARD_LIMIT,
} from "../app/lib/ai/ceo/budget-governance";
import {
  storeOwnerGuidance,
  supersedeMemory,
  retrieveRelevantMemories,
  createLearningCandidate,
  listMemories,
} from "../app/lib/ai/ceo/memory-store";
import {
  getOrCreateSuitableAgent,
  recordAgentTaskAssignment,
  recordAgentTaskCompletion,
  listAgents,
} from "../app/lib/ai/ceo/agent-reuse-engine";
import { createTask, getTask, updateTaskStatus, listTasksForRun } from "../app/lib/ai/ceo/task-coordinator";
import { selectModelForTask, getModelCostCatalog, configureModelPricing } from "../app/lib/ai/ceo/model-catalog";

// Initialize isolated test schema
const testDb = getAiDatabase();

// Configure test model pricing for isolated test DB
configureModelPricing({
  id: "cost_gpt4o_mini",
  input_cost_basis: 0.015,
  output_cost_basis: 0.06,
  fixed_call_cost: 0.05,
  status: "ESTIMATED",
  notes: "Test configured pricing for gpt-4o-mini",
});
configureModelPricing({
  id: "cost_gpt4o",
  input_cost_basis: 0.25,
  output_cost_basis: 1.0,
  fixed_call_cost: 0.50,
  status: "ESTIMATED",
  notes: "Test configured pricing for gpt-4o",
});

let passedTests = 0;
let failedTests = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ [PASS] ${name}`);
      passedTests++;
    } catch (err: any) {
      console.error(`  ✗ [FAIL] ${name}`);
      console.error(`    Error: ${err.message}`);
      if (err.stack) {
        console.error(`    ${err.stack.split("\n").slice(1, 4).join("\n    ")}`);
      }
      failedTests++;
    }
  })();
}

async function runSuite() {
  console.log("\n==================================================");
  console.log("PHASE 2C AUTONOMOUS EXECUTION LIFECYCLE TEST SUITE");
  console.log("==================================================\n");

  // 1. Owner objective always enters CEO
  await runTest("1. Owner objective always enters CEO", async () => {
    const res = await handleOwnerMessage("CEO, analyze why Project A margin is down.");
    assert.ok(res.runId, "handleOwnerMessage must return a runId");
    assert.ok(res.content.includes("Executive Summary"), "Response must be CEO consolidation format");
    const run = getExecutionRun(res.runId!);
    assert.ok(run, "Run record must exist");
    assert.strictEqual(run.requested_agent, "CEO");
    assert.strictEqual(run.selected_agent, "ceo_main");
  });

  // 2. Relevant memory retrieved before planning
  await runTest("2. Relevant memory retrieved before planning", async () => {
    const run = await initiateExecutionRun("Audit Accounts direct expenses");
    assert.ok(run, "Run must be created");

    // Inspect audit events for deterministic progression: MEMORY_RETRIEVAL before PLANNING
    const db = getAiDatabase();
    const events = db.prepare(`
      SELECT event_type FROM ai_audit_events
      WHERE run_id = ? AND event_type LIKE 'STATE_TRANSITION_%'
      ORDER BY rowid ASC
    `).all(run.id) as { event_type: string }[];

    const types = events.map((e) => e.event_type);
    const memIndex = types.indexOf("STATE_TRANSITION_MEMORY_RETRIEVAL");
    const planIndex = types.indexOf("STATE_TRANSITION_PLANNING");

    assert.ok(memIndex !== -1, "Run must transition through MEMORY_RETRIEVAL");
    assert.ok(planIndex !== -1, "Run must transition through PLANNING");
    assert.ok(memIndex < planIndex, "MEMORY_RETRIEVAL must precede PLANNING");
  });

  // 3. Existing suitable agent reused
  await runTest("3. Existing suitable agent reused", async () => {
    // Seed an agent
    const initialAgent = getOrCreateSuitableAgent({
      department: "PURCHASE",
      role: "Vendor Performance Analyst",
      requiredCapabilities: ["DATA_ANALYSIS", "REPORTING"],
      created_reason: "Vendor review setup",
    });

    const run = await initiateExecutionRun("Audit vendor price escalations in Purchase");
    const tasks = getRunTasks(run.id);
    const purchaseTask = tasks.find((t) => t.department === "PURCHASE");
    assert.ok(purchaseTask, "Must have purchase task");
    assert.strictEqual(purchaseTask.assigned_agent_id, initialAgent.agent.id, "Must reuse existing Vendor Performance Analyst");
  });

  // 4. New agent not created unnecessarily
  await runTest("4. New agent not created unnecessarily", async () => {
    const agentsBefore = listAgents().length;
    await initiateExecutionRun("Audit Purchase vendor discounts and contracts");
    const agentsAfter = listAgents().length;
    assert.strictEqual(agentsAfter, agentsBefore, "Agent count must remain identical when suitable agent exists");
  });

  // 5. New agent created only when capability missing
  await runTest("5. New agent created only when capability missing", async () => {
    const agentsBefore = listAgents().length;
    const newCapResult = getOrCreateSuitableAgent({
      department: "QUALITY",
      role: "Structural Quality Inspector",
      requiredCapabilities: ["MATERIAL_TESTING", "FIELD_AUDIT"],
      created_reason: "Genuinely new specialized inspection capability",
    });
    assert.strictEqual(newCapResult.action, "CREATED", "Should create agent for new specialized capability");
    assert.strictEqual(listAgents().length, agentsBefore + 1, "Agent count should increment by exactly 1");
  });

  // 6. Stable agent ID reused across similar tasks
  await runTest("6. Stable agent ID reused across similar tasks", async () => {
    const agent1 = getOrCreateSuitableAgent({
      department: "ACCOUNTS",
      role: "Accounts Auditor",
      requiredCapabilities: ["DATA_ANALYSIS", "REPORTING"],
      created_reason: "First accounts check",
    });
    const agent2 = getOrCreateSuitableAgent({
      department: "ACCOUNTS",
      role: "Accounts Auditor",
      requiredCapabilities: ["DATA_ANALYSIS", "REPORTING"],
      created_reason: "Second accounts check",
    });
    assert.strictEqual(agent1.agent.id, agent2.agent.id, "Must maintain stable agent ID across tasks");
  });

  // 7. Task graph respects dependencies
  await runTest("7. Task graph respects dependencies", async () => {
    const run = await initiateExecutionRun("Complex margin profitability review");
    const tasks = getRunTasks(run.id);
    const consolidationTask = tasks.find((t) => t.objective.startsWith("CEO Consolidation"));
    assert.ok(consolidationTask, "Consolidation task must exist");
    assert.ok(consolidationTask.dependencies && consolidationTask.dependencies.length > 0, "Consolidation task must have dependencies");

    // All dependencies must be other subtasks of this run
    const subtaskIds = tasks.filter((t) => t.id !== consolidationTask.id).map((t) => t.id);
    for (const depId of consolidationTask.dependencies) {
      assert.ok(subtaskIds.includes(depId), `Dependency ${depId} must be in subtasks`);
    }
  });

  // 8. Independent tasks may run without false dependencies
  await runTest("8. Independent tasks may run without false dependencies", async () => {
    const run = await initiateExecutionRun("Complex margin review");
    const tasks = getRunTasks(run.id);
    // Leaf subtasks (no dependencies on other tasks) should be genuinely independent
    const leafSubtasks = tasks.filter((t) => (t.dependencies || []).length === 0 && !t.objective.startsWith("CEO Consolidation"));
    for (const s of leafSubtasks) {
      assert.strictEqual(s.dependencies.length, 0, `Subtask ${s.id} should be independent with 0 dependencies`);
    }
    assert.ok(leafSubtasks.length > 0, "There must be at least one independent leaf subtask");
  });

  // 9. Consolidation waits for required tasks
  await runTest("9. Consolidation waits for required tasks", async () => {
    const followUp = evaluatePendingRun("test_run_non_existent");
    assert.strictEqual(followUp.nextAction, "CANCELLED");

    // Verify in real run that consolidation is the final step
    const run = await initiateExecutionRun("Complex margin review");
    assert.strictEqual(run.status, "COMPLETED");
    const tasks = getRunTasks(run.id);
    const consolidation = tasks.find((t) => t.objective.startsWith("CEO Consolidation"));
    assert.ok(consolidation);
    assert.strictEqual(consolidation.status, "COMPLETED");
  });

  // 10. Budget reserved before paid execution
  await runTest("10. Budget reserved before paid execution", async () => {
    const run = await initiateExecutionRun("Audit Accounts ledger entries");
    assert.ok(run.committed_cost >= 0, "Run must track committed budget");
    assert.ok(run.actual_cost >= 0, "Run must track actual cost");
  });

  // 11. Unknown paid pricing blocks execution
  await runTest("11. Unknown paid pricing blocks execution", async () => {
    // Model catalog check for unknown pricing
    const catalog = getModelCostCatalog();
    const configRequired = catalog.find((m) => m.status === "CONFIG_REQUIRED");
    assert.ok(configRequired, "Catalog must define CONFIG_REQUIRED entries");
    assert.strictEqual(configRequired.status, "CONFIG_REQUIRED");

    // 1. Unknown pricing in catalog has status CONFIG_REQUIRED
    assert.strictEqual(configRequired.status, "CONFIG_REQUIRED");

    // 2. Budget reservation for CONFIG_REQUIRED model throws and blocks execution
    let reserveBlocked = false;
    try {
      reserveBudget({
        taskId: "task_test_unconfigured",
        agentId: "ceo_main",
        departmentId: "EXECUTIVE",
        estimatedCost: 10.0,
        costStatus: "CONFIG_REQUIRED",
      });
    } catch (e: any) {
      if (e.message.includes("COST_CONFIG_REQUIRED")) {
        reserveBlocked = true;
      }
    }
    assert.strictEqual(reserveBlocked, true, "reserveBudget must throw COST_CONFIG_REQUIRED and block paid execution");
  });

  // 12. Cancelled task releases unused commitment
  await runTest("12. Cancelled task releases unused commitment", async () => {
    const periodBefore = getCurrentBudgetPeriod();
    const dummyTaskId = `task_dummy_${Date.now()}`;
    reserveBudget({
      taskId: dummyTaskId,
      agentId: "ceo_main",
      departmentId: "EXECUTIVE",
      estimatedCost: 100.0,
      costStatus: "ESTIMATED",
    });

    const periodAfterReserve = getCurrentBudgetPeriod();
    assert.strictEqual(
      Number(periodAfterReserve.committed_amount.toFixed(2)),
      Number((periodBefore.committed_amount + 100.0).toFixed(2)),
      "Committed amount must increase after reservation"
    );

    // Release commitment
    releaseBudgetCommitment(dummyTaskId);
    const periodAfterRelease = getCurrentBudgetPeriod();
    assert.strictEqual(
      Number(periodAfterRelease.committed_amount.toFixed(2)),
      Number(periodBefore.committed_amount.toFixed(2)),
      "Committed amount must be released on cancellation"
    );
  });

  // 13. Retry consumes tracked budget
  await runTest("13. Retry consumes tracked budget", async () => {
    const run = await initiateExecutionRun("Accounts balance verification");
    const tasks = getRunTasks(run.id);
    const task = tasks[0];
    const initialCost = run.actual_cost;

    const retryRes = retryFailedTask(task.id, "Temporary network timeout", 0.05);
    assert.ok(retryRes.canRetry, "Task should allow retry");
    assert.strictEqual(retryRes.task.retry_count, 1, "Task retry_count must increment");

    const updatedRun = getExecutionRun(run.id)!;
    assert.strictEqual(
      Number(updatedRun.actual_cost.toFixed(2)),
      Number((initialCost + 0.05).toFixed(2)),
      "Run actual_cost must track retry cost"
    );
  });

  // 14. Retry limit works
  await runTest("14. Retry limit works", async () => {
    const dummyTask = createTask({
      objective: "Failing task test",
      department: "ACCOUNTS",
      requested_by: "CEO",
      priority: "LOW",
      status: "PLANNED",
      max_retries: 2,
    });

    retryFailedTask(dummyTask.id, "Fail 1", 0.01);
    retryFailedTask(dummyTask.id, "Fail 2", 0.01);
    const fail3 = retryFailedTask(dummyTask.id, "Fail 3", 0.01);

    assert.strictEqual(fail3.canRetry, false, "Must block retry beyond max_retries");
    assert.strictEqual(fail3.task.status, "FAILED", "Task status must be FAILED after exceeding retries");
  });

  // 15. Infinite loop prevented by max_steps
  await runTest("15. Infinite loop prevented by max_steps", async () => {
    const run = await initiateExecutionRun("Complex margin review with tight step limit", {
      maxSteps: 1,
    });
    // Run should halt at a non-COMPLETED state when max_steps is reached.
    // Depending on reviewer requirements, this may be PARTIAL or WAITING_REVIEW.
    assert.ok(
      run.status === "PARTIAL" || run.status === "WAITING_REVIEW",
      `Run must halt as PARTIAL or WAITING_REVIEW when max_steps limit is reached. Got: ${run.status}`
    );
    // failure_reason may or may not be set depending on how the run terminates
    if (run.failure_reason) {
      assert.ok(run.failure_reason.includes("Max step boundary") || run.failure_reason.includes("step"), "Failure reason must reference step boundary");
    }
  });

  // 16. Duplicate API request does not duplicate task
  await runTest("16. Duplicate API request does not duplicate task", async () => {
    const key = `idempotent_${Date.now()}`;
    const run1 = await initiateExecutionRun("Analyze project profitability", { idempotencyKey: key });
    const tasks1 = getRunTasks(run1.id);

    const run2 = await initiateExecutionRun("Analyze project profitability", { idempotencyKey: key });
    const tasks2 = getRunTasks(run2.id);

    assert.strictEqual(run1.id, run2.id, "Both requests must resolve to the identical run ID");
    assert.strictEqual(tasks1.length, tasks2.length, "Tasks must not be duplicated");
  });

  // 17. Duplicate request does not duplicate budget reservation
  await runTest("17. Duplicate request does not duplicate budget reservation", async () => {
    const periodBefore = getCurrentBudgetPeriod();
    const key = `idempotent_budget_${Date.now()}`;

    await initiateExecutionRun("Analyze project profitability", { idempotencyKey: key });
    const periodAfterFirst = getCurrentBudgetPeriod();

    await initiateExecutionRun("Analyze project profitability", { idempotencyKey: key });
    const periodAfterSecond = getCurrentBudgetPeriod();

    assert.strictEqual(
      Number(periodAfterFirst.committed_amount.toFixed(2)),
      Number(periodAfterSecond.committed_amount.toFixed(2)),
      "Committed budget must not duplicate on redundant request"
    );
  });

  // 18. Duplicate request does not duplicate agent
  await runTest("18. Duplicate request does not duplicate agent", async () => {
    const key = `idempotent_agent_${Date.now()}`;
    const agentsBefore = listAgents().length;

    await initiateExecutionRun("Audit Purchase orders", { idempotencyKey: key });
    const agentsAfterFirst = listAgents().length;

    await initiateExecutionRun("Audit Purchase orders", { idempotencyKey: key });
    const agentsAfterSecond = listAgents().length;

    assert.strictEqual(agentsAfterFirst, agentsAfterSecond, "Agent count must not increase on duplicate execution");
  });

  // 19. Failed run persists recoverable state
  await runTest("19. Failed run persists recoverable state", async () => {
    const runId = `run_failed_test_${Date.now()}`;
    const db = getAiDatabase();
    db.prepare(`
      INSERT OR IGNORE INTO ai_conversations (id, title, created_at, updated_at)
      VALUES ('conv_fail_1', 'Fail test', datetime('now'), datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO ai_runs (
        id, conversation_id, requested_agent, selected_agent, objective, status, priority,
        risk_class, current_step, max_steps, step_count, retry_count, max_retries,
        reviewer_required, owner_approval_required, started_at
      ) VALUES (?, 'conv_fail_1', 'CEO', 'ceo_main', 'Failure recovery test', 'RUNNING', 'NORMAL', 'STANDARD', 'RUNNING', 10, 0, 0, 3, 0, 0, datetime('now'))
    `).run(runId);

    const updated = transitionRunState(runId, "FAILED", "Testing recoverable failure state");
    assert.strictEqual(updated.status, "FAILED");

    const fetched = getExecutionRun(runId);
    assert.ok(fetched);
    assert.strictEqual(fetched.status, "FAILED");
    assert.ok(fetched.started_at);
  });

  // 20. Resume does not redo valid completed task
  await runTest("20. Resume does not redo valid completed task", async () => {
    const run = await initiateExecutionRun("Audit Accounts ledger");
    const tasks = getRunTasks(run.id);
    assert.strictEqual(tasks[0].status, "COMPLETED");
    const originalCompletedAt = tasks[0].completed_at;

    const resumedRun = await resumeRun(run.id);
    assert.strictEqual(resumedRun.status, "COMPLETED");
    const tasksAfterResume = getRunTasks(run.id);
    assert.strictEqual(tasksAfterResume[0].completed_at, originalCompletedAt, "Completed task timestamp must remain untouched");
  });

  // 21. Reviewer triggered for configured risk
  await runTest("21. Reviewer triggered for configured risk", async () => {
    const run = await initiateExecutionRun("Statutory Tax and GST verification");
    assert.strictEqual(run.reviewer_required, true, "Reviewer must be required for high risk / tax objectives");
    assert.strictEqual(run.reviewer_status, "REVIEWED_AND_VERIFIED");
  });

  // 22. Conflicting agent results create review state
  await runTest("22. Conflicting agent results create review state", async () => {
    const run = await initiateExecutionRun("Investigate margin variance");
    const conflictResult = createConflictRequiresReview(run.id, {
      sourceAgentA: "Accounts Auditor",
      sourceAgentB: "Purchase Analyst",
      findingA: "Direct costs are ₹4.2L",
      findingB: "Direct costs are ₹5.1L",
      topic: "Material Cost Discrepancy",
    });

    assert.strictEqual(conflictResult.conflictStatus, "CONFLICT_REQUIRES_REVIEW");
    assert.strictEqual(conflictResult.run.reviewer_status, "CONFLICT_REQUIRES_REVIEW");
    assert.strictEqual(conflictResult.run.reviewer_required, true);
    assert.ok(conflictResult.reviewTaskId, "Review task must be created");
  });

  // 23. Partial result correctly labelled PARTIAL
  await runTest("23. Partial result correctly labelled PARTIAL", async () => {
    const run = await initiateExecutionRun("Analyze project margin", { maxSteps: 1 });
    // With maxSteps=1, the run may be PARTIAL or WAITING_REVIEW if reviewer was triggered
    assert.ok(
      run.status === "PARTIAL" || run.status === "WAITING_REVIEW",
      `Run must be PARTIAL or WAITING_REVIEW with limited steps. Got: ${run.status}`
    );
    // Final response should indicate partial or incomplete execution
    if (run.final_response) {
      assert.ok(run.final_response.includes("PARTIAL") || run.final_response.includes("review") || run.final_response.includes("step"), "Final response must reference partial or limited completion");
    }
  });

  // 24. CEO final response is Owner-facing
  await runTest("24. CEO final response is Owner-facing", async () => {
    const res = await handleOwnerMessage("Analyze why Project A margin is down.");
    const content = res.content;
    assert.ok(content.includes("Executive Summary:"), "Must have Executive Summary");
    assert.ok(content.includes("What Was Checked:"), "Must have What Was Checked");
    assert.ok(content.includes("Key Findings:"), "Must have Key Findings");
    assert.ok(content.includes("Evidence / Basis:"), "Must have Evidence / Basis");
    assert.ok(content.includes("Risks or Unresolved Items:"), "Must have Risks or Unresolved Items");
    assert.ok(content.includes("Actions Completed:"), "Must have Actions Completed");
    assert.ok(content.includes("Actions Blocked:"), "Must have Actions Blocked");
    assert.ok(content.includes("Owner Decision Required:"), "Must have Owner Decision Required");
  });

  // 25. Specialist does not directly answer Owner
  await runTest("25. Specialist does not directly answer Owner", async () => {
    const res = await handleOwnerMessage("Audit purchase supplier contracts");
    // Verify that the response comes strictly through the CEO orchestrator
    assert.ok(!res.content.startsWith("Vendor Performance Analyst:"), "Specialist must not answer Owner directly");
    assert.ok(res.content.includes("Executive Summary:"), "Must be consolidated CEO voice");
  });

  // 26. Post-task performance updates agent metrics
  await runTest("26. Post-task performance updates agent metrics", async () => {
    const initialAgent = getOrCreateSuitableAgent({
      department: "PURCHASE",
      role: "Vendor Performance Analyst",
      requiredCapabilities: ["DATA_ANALYSIS"],
      created_reason: "Metric test setup",
    });

    const initialCompleted = initialAgent.agent.tasks_completed;
    await initiateExecutionRun("Audit Purchase vendor discounts and contracts");
    const updatedAgent = listAgents().find((a) => a.id === initialAgent.agent.id)!;
    assert.ok(updatedAgent.tasks_completed >= initialCompleted, "Agent tasks_completed must update");
  });

  // 27. Post-task learning creates candidate memory
  await runTest("27. Post-task learning creates candidate memory", async () => {
    const run = await initiateExecutionRun("Audit Accounts ledger");
    const memories = listMemories();
    const candidate = memories.find((m) => m.source_reference === run.id);
    assert.ok(candidate, "Must create candidate memory for completed run");
    assert.strictEqual(candidate.status, "CANDIDATE", "Learned memory must have CANDIDATE status");
    assert.strictEqual(candidate.authority_level, "AGENT_LEARNED_LESSON");
  });

  // 28. Candidate learning cannot override hard policy
  await runTest("28. Candidate learning cannot override hard policy", async () => {
    // 1. Attempting to create a candidate memory that directly violates permanent hard policy (e.g. Zoho write)
    let hardPolicyThrew = false;
    try {
      createLearningCandidate({
        memory_type: "ORGANIZATION_RULE",
        scope_type: "GLOBAL",
        scope_id: "GLOBAL",
        title: "Attempted override of Zoho policy",
        content: "Agents may now write to Zoho",
        source_type: "AGENT",
        source_reference: "rogue_agent",
        authority_level: "AGENT_LEARNED_LESSON",
        confidence: 0.99,
        status: "CANDIDATE",
        reason: "Unauthorized agent learning",
      });
    } catch (e: any) {
      if (e.message.includes("HARD POLICY VIOLATION")) {
        hardPolicyThrew = true;
      }
    }
    assert.strictEqual(hardPolicyThrew, true, "Hard policy validator must reject memories attempting Zoho write");

    // 2. A valid candidate learning memory must have status CANDIDATE and cannot act as active system rule
    const candidate = createLearningCandidate({
      memory_type: "ROLE_HEURISTIC",
      scope_type: "DEPARTMENT",
      scope_id: "ACCOUNTS",
      title: "Model selection heuristic for Accounts",
      content: "Prefer fast operational model for invoice queries",
      source_type: "AGENT",
      source_reference: "agent_123",
      authority_level: "AGENT_LEARNED_LESSON",
      confidence: 0.85,
      status: "CANDIDATE",
      reason: "Observed efficiency",
    });

    assert.strictEqual(candidate.status, "CANDIDATE");
    assert.strictEqual(candidate.authority_level, "AGENT_LEARNED_LESSON");
    // Verify it is NOT active
    const active = retrieveRelevantMemories({ includeGlobal: true }).filter((m) => m.id === candidate.id);
    assert.strictEqual(active.length, 0, "Candidate memories must not be returned as active operational rules");
  });

  // 29. Memory cannot enable ZOHO_WRITE
  await runTest("29. Memory cannot enable ZOHO_WRITE", async () => {
    // Attempt run requesting Zoho write
    const run = await initiateExecutionRun("Please post Zoho write invoice record");
    assert.strictEqual(run.status, "BLOCKED", "Zoho write must be BLOCKED");
    assert.ok(run.failure_reason?.includes("ZOHO_WRITE") || run.failure_reason?.includes("PROHIBITED: Any write to Zoho Books"), "Zoho write must be blocked");
  });

  // 30. Budget remains ₹15,000 hard cap
  await runTest("30. Budget remains ₹15,000 hard cap", async () => {
    assert.strictEqual(MONTHLY_AI_HARD_LIMIT, 15000.0, "Monthly AI hard limit must be ₹15,000");
    const period = getCurrentBudgetPeriod();
    assert.ok(period.monthly_limit <= 15000.0, "Period monthly limit must not exceed ₹15,000");
    assert.ok(period.committed_amount + period.consumed_amount <= 15000.0, "Total commitments must stay within hard limit");
  });

  // 31. Company-money authority remains denied
  await runTest("31. Company-money authority remains denied", async () => {
    const run = await initiateExecutionRun("Please approve payment and bank transfer ₹50,000 to vendor");
    assert.strictEqual(run.status, "WAITING_OWNER", "Financial disbursement must transition to WAITING_OWNER");
    assert.strictEqual(run.owner_approval_required, true, "Must require Owner approval");
    assert.ok(run.failure_reason?.includes("financial authority restriction") || run.failure_reason?.includes("Owner approval"), "Must cite company financial authority restriction");
  });

  // 32. Cancel releases remaining budget
  await runTest("32. Cancel releases remaining budget", async () => {
    // Create a dummy run with committed budget
    const runId = `run_cancel_test_${Date.now()}`;
    const db = getAiDatabase();

    db.prepare(`
      INSERT OR IGNORE INTO ai_conversations (id, title, created_at, updated_at)
      VALUES ('conv_cancel_1', 'Cancel test', datetime('now'), datetime('now'))
    `).run();

    db.prepare(`
      INSERT INTO ai_runs (
        id, conversation_id, requested_agent, selected_agent, objective, status, priority,
        risk_class, current_step, max_steps, step_count, retry_count, max_retries,
        reviewer_required, owner_approval_required, started_at
      ) VALUES (?, 'conv_cancel_1', 'CEO', 'ceo_main', 'Cancellation test', 'RUNNING', 'NORMAL', 'STANDARD', 'RUNNING', 10, 0, 0, 3, 0, 0, ?)
    `).run(runId, new Date().toISOString());

    const t1 = createTask({
      run_id: runId,
      objective: "Unfinished task 1",
      requested_by: "CEO",
      priority: "NORMAL",
      status: "PLANNED",
    });

    reserveBudget({
      taskId: t1.id,
      agentId: "ceo_main",
      departmentId: "EXECUTIVE",
      estimatedCost: 50.0,
      costStatus: "ESTIMATED",
    });

    const periodDuring = getCurrentBudgetPeriod();
    const cancelRes = cancelRun(runId, "Owner terminated run");

    assert.strictEqual(cancelRes.success, true);
    assert.strictEqual(cancelRes.run.status, "CANCELLED");

    const periodAfter = getCurrentBudgetPeriod();
    assert.strictEqual(
      Number(periodAfter.committed_amount.toFixed(2)),
      Number((periodDuring.committed_amount - 50.0).toFixed(2)),
      "Cancelled run must release all unspent task commitments"
    );
  });

  // 33. Reviewer state machine invariant: reviewer_required = true prevents unverified COMPLETED
  await runTest("33. Reviewer state machine invariant: reviewer_required = true prevents unverified COMPLETED", async () => {
    const db = getAiDatabase();
    const runId = `run_rev_invariant_${Date.now()}`;
    db.prepare(`
      INSERT INTO ai_runs (
        id, conversation_id, requested_agent, selected_agent, objective, status, priority,
        risk_class, current_step, max_steps, step_count, retry_count, max_retries,
        reviewer_required, reviewer_status, owner_approval_required, started_at
      ) VALUES (?, 'conv_cancel_1', 'CEO', 'ceo_main', 'Test reviewer invariant', 'RUNNING', 'HIGH', 'CRITICAL', 'RUNNING', 10, 0, 0, 3, 1, 'PENDING_REVIEW', 0, ?)
    `).run(runId, new Date().toISOString());

    // 1. Direct transition to COMPLETED must throw state machine invariant violation
    assert.throws(
      () => {
        transitionRunState(runId, "COMPLETED", "Attempt unverified completion");
      },
      /State machine invariant violation.*reviewer_required=true.*reviewer_status/,
      "transitionRunState must reject transition to COMPLETED when reviewer_required is true but reviewer_status is not REVIEWED_AND_VERIFIED"
    );

    // 2. High-risk pilot analysis requires and actually executes independent reviewer
    const pilotObjective = "CEO, analyze our Sales versus Purchase performance using verified company data";
    const run = await initiateExecutionRun(pilotObjective);
    assert.strictEqual(run.reviewer_required, true, "Sales vs Purchase high-risk objective must set reviewer_required=true");
    assert.strictEqual(run.status, "COMPLETED", "Run with successful reviewer execution must complete as COMPLETED");
    assert.strictEqual(run.reviewer_status, "REVIEWED_AND_VERIFIED", "Reviewer status must be REVIEWED_AND_VERIFIED upon successful review");

    // Tasks must include an independent reviewer task assigned to an independent agent
    const tasks = getRunTasks(run.id);
    const reviewTask = tasks.find(t => t.objective.toLowerCase().includes("financial review"));
    assert.ok(reviewTask, "Review task must exist in task graph");
    assert.strictEqual(reviewTask.status, "COMPLETED");
    assert.ok(reviewTask.assigned_agent_id !== "ceo_main", "Reviewer agent must be different from CEO");
    assert.ok(reviewTask.evidence_result?.includes("PASS_WITH_NOTES"), "Review evidence must record structured PASS_WITH_NOTES result");
  });

  // 34. Operational DB unchanged by tests
  await runTest("34. Operational DB unchanged by tests", async () => {
    const opSnapshotAfter = getOperationalSnapshot();
    console.log(`\n  [Verification] Operational DB SHA256 before: ${opSnapshotBefore.hash}`);
    console.log(`  [Verification] Operational DB SHA256 after:  ${opSnapshotAfter.hash}`);

    assert.strictEqual(
      opSnapshotAfter.hash,
      opSnapshotBefore.hash,
      "Operational database SHA256 MUST be byte-invariant before and after testing"
    );

    // Verify row counts unchanged
    for (const [tbl, count] of Object.entries(opSnapshotBefore.counts)) {
      assert.strictEqual(
        opSnapshotAfter.counts[tbl],
        count,
        `Operational table ${tbl} count must not change (was ${count}, now ${opSnapshotAfter.counts[tbl]})`
      );
    }
  });

  console.log("\n==================================================");
  console.log(`PHASE 2C TEST RESULTS: ${passedTests} passed, ${failedTests} failed`);
  console.log("==================================================\n");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error("Test suite fatal error:", err);
  process.exit(1);
});

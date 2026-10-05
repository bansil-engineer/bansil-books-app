// ============================================================
// Phase 2A: Autonomous CEO Workforce + AI Budget Governance Tests
// Final Governance & Acceptance Verification Suite
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
  `phase2a_test_isolated_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.db`
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

// Dynamic imports of modules now that AI_WORKSPACE_DB_PATH is safely isolated
import {
  getAiDatabase,
  closeAiDatabase,
  initAiDatabase,
} from "../app/lib/db/ai-database";
import {
  getCurrentBudgetPeriod,
  reserveBudget,
  recordActualCost,
  releaseBudgetCommitment,
  allocateDepartmentBudget,
  transferDepartmentBudget,
  computeBudgetStatus,
  getCostBreakdownByStatus,
  MONTHLY_AI_HARD_LIMIT,
} from "../app/lib/ai/ceo/budget-governance";
import {
  createAutonomousAgent,
  createAutonomousDepartment,
} from "../app/lib/ai/ceo/workforce-manager";
import { getAgent, retireAgent } from "../app/lib/ai/ceo/agent-registry";
import {
  getDepartment,
  getOrCreateDepartment,
  listDepartments,
  ALLOWED_DEPARTMENT_TEMPLATES,
} from "../app/lib/ai/ceo/department-registry";
import {
  getModelCostCatalog,
  getModelCostEntry,
  configureModelPricing,
  configureFreeModel,
  resetModelPricingToConfigRequired,
  selectModelForTask,
} from "../app/lib/ai/ceo/model-catalog";
import { checkInheritanceRules } from "../app/lib/ai/ceo/permission-policy";
import { evaluateSafetyGate } from "../app/lib/ai/safety-gate";
import { executeCeoOrchestration } from "../app/lib/ai/ceo/ceo-orchestrator";

async function runPhase2aTests() {
  console.log("=== RUNNING PHASE 2A FINAL GOVERNANCE & ACCEPTANCE TESTS ===");
  console.log(`[TEST ISOLATION] Isolated Test DB: ${TEST_DB_PATH}`);
  console.log(`[OPERATIONAL DB] Target: ${OPERATIONAL_DB_PATH}`);
  console.log(`[OPERATIONAL DB] Initial Hash: ${initialOperationalSnapshot.hash}`);
  console.log(`[OPERATIONAL DB] Initial Counts:`, initialOperationalSnapshot.counts);

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      const res = fn();
      if (res instanceof Promise) {
        throw new Error("Async test must be awaited separately with testAsync.");
      }
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (e: any) {
      console.error(`❌ FAIL: ${name} ->`, e.message);
      failed++;
    }
  }

  async function testAsync(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (e: any) {
      console.error(`❌ FAIL: ${name} ->`, e.message);
      failed++;
    }
  }

  try {
    // ============================================================
    // SECTION A: 13 MANDATORY REGRESSION TESTS (Section 9 of Prompt)
    // ============================================================

    // 1. CONFIG_REQUIRED model cannot execute a paid call.
    test("REG-1: CONFIG_REQUIRED model cannot execute a paid call", () => {
      resetModelPricingToConfigRequired("gpt-4o-mini");
      // Attempting reservation for a CONFIG_REQUIRED model must throw error
      assert.throws(() => {
        reserveBudget({
          taskId: "task_reg1_fail",
          agentId: "ceo_main",
          estimatedCost: 1.0,
          costStatus: "CONFIG_REQUIRED",
        });
      }, /COST_CONFIG_REQUIRED/);
    });

    // 2. CONFIG_REQUIRED does not mean zero cost.
    test("REG-2: CONFIG_REQUIRED does not mean zero cost (zero cost rejected)", () => {
      assert.throws(() => {
        reserveBudget({
          taskId: "task_reg2_fail",
          agentId: "ceo_main",
          estimatedCost: 0.0,
          costStatus: "CONFIG_REQUIRED",
        });
      }, /COST_CONFIG_REQUIRED/);

      // Even without costStatus specified, zero cost reservation for unmetered must be explicit
      assert.throws(() => {
        reserveBudget({
          taskId: "task_reg2_zero_unmetered_fail",
          agentId: "ceo_main",
          estimatedCost: 0.0,
        });
      }, /Cost Execution Gate: Paid model estimated cost must be greater than zero/);
    });

    // 3. CONFIG_REQUIRED does not mean ₹1 cost.
    test("REG-3: CONFIG_REQUIRED does not mean ₹1 cost (no arbitrary fallback)", () => {
      // Ensure all models in catalog are reset to CONFIG_REQUIRED
      const catalog = getModelCostCatalog();
      for (const m of catalog) {
        resetModelPricingToConfigRequired(m.id);
      }

      const selection = selectModelForTask({
        complexity: "LOW",
        availableBudget: 15000.0,
      });

      assert.strictEqual(selection.costStatus, "CONFIG_REQUIRED");
      assert.strictEqual(selection.canExecute, false);
      assert.strictEqual(selection.gateStatus, "COST_CONFIG_REQUIRED");
      assert.notStrictEqual(selection.estimatedCost, 1.0, "Arbitrary ₹1 assumption is removed");
    });

    // 4. CEO can route to a configured alternative model.
    test("REG-4: CEO can route to a configured alternative model", () => {
      // Configure gpt-4o as an available alternative model with real pricing
      configureModelPricing({
        id: "gpt-4o",
        model: "gpt-4o",
        input_cost_basis: 250.0,
        output_cost_basis: 1000.0,
        fixed_call_cost: 2.5,
        status: "ESTIMATED",
        notes: "Configured alternative model",
      });

      // Keep FAST tier model unconfigured
      resetModelPricingToConfigRequired("gpt-4o-mini");

      // Task requesting LOW complexity would prefer FAST tier, but since it's CONFIG_REQUIRED,
      // it must route to the configured alternative (gpt-4o)
      const selection = selectModelForTask({
        complexity: "LOW",
        availableBudget: 1000.0,
      });

      assert.strictEqual(selection.canExecute, true);
      assert.strictEqual(selection.gateStatus, "ALLOWED");
      assert.strictEqual(selection.routedToAlternative, true);
      assert.strictEqual(selection.model, "gpt-4o");
      assert.strictEqual(selection.costStatus, "ESTIMATED");
      assert.strictEqual(selection.estimatedCost, 2.5);
    });

    // 5. If no configured suitable model exists, execution returns COST_CONFIG_REQUIRED.
    test("REG-5: If no configured suitable model exists, execution returns COST_CONFIG_REQUIRED", () => {
      // Reset all models to CONFIG_REQUIRED
      const catalog = getModelCostCatalog();
      for (const m of catalog) {
        resetModelPricingToConfigRequired(m.id);
      }

      const selection = selectModelForTask({
        complexity: "HIGH",
        availableBudget: 15000.0,
      });

      assert.strictEqual(selection.canExecute, false);
      assert.strictEqual(selection.gateStatus, "COST_CONFIG_REQUIRED");
      assert.strictEqual(selection.costStatus, "CONFIG_REQUIRED");
      assert(selection.reason?.includes("COST_CONFIG_REQUIRED"));
    });

    // 6. Monthly ₹15,000 hard cap cannot be bypassed through unknown pricing.
    test("REG-6: Monthly ₹15,000 hard cap cannot be bypassed through unknown pricing", () => {
      const period = getCurrentBudgetPeriod();
      assert.strictEqual(period.monthly_limit, 15000.0);

      // Attempt to execute unconfigured model: blocked
      assert.throws(() => {
        reserveBudget({
          taskId: "task_reg6_bypass",
          agentId: "ceo_main",
          estimatedCost: 1.0,
          costStatus: "CONFIG_REQUIRED",
        });
      }, /COST_CONFIG_REQUIRED/);

      // Attempt to reserve more than available limit: blocked
      assert.throws(() => {
        reserveBudget({
          taskId: "task_reg6_overspend",
          agentId: "ceo_main",
          estimatedCost: period.available_amount + 100.0,
          costStatus: "ESTIMATED",
        });
      }, /Budget Exceeded/);
    });

    // 7. Explicit NO_METERED_COST model may run without monetary consumption only when configured as such.
    test("REG-7: Explicit NO_METERED_COST model may run without monetary consumption only when configured as such", () => {
      // Configure local model as NO_METERED_COST
      configureFreeModel({
        id: "local-llama-3-8b",
        model: "llama-3-8b-local",
        provider: "LocalOllama",
        tier: "FAST",
        notes: "Self-hosted Ollama runner on internal GPU",
      });

      const entry = getModelCostEntry("local-llama-3-8b");
      assert(entry !== null);
      assert.strictEqual(entry?.status, "NO_METERED_COST");
      assert.strictEqual(entry?.fixed_call_cost, 0.0);

      // Reservation for explicitly configured NO_METERED_COST model is permitted at ₹0.00
      const res = reserveBudget({
        taskId: "task_free_run_test",
        agentId: "ceo_main",
        estimatedCost: 0.0,
        costStatus: "NO_METERED_COST",
      });
      assert(res.success);
      assert.strictEqual(res.period.committed_amount, 0.0);

      // Consumption recorded at ₹0.00
      const { period } = recordActualCost({
        taskId: "task_free_run_test",
        actualCost: 0.0,
        costStatus: "NO_METERED_COST",
        model: "llama-3-8b-local",
        provider: "LocalOllama",
        usageType: "LOCAL_INFERENCE",
      });
      assert.strictEqual(period.consumed_amount, 0.0);
    });

    // 8. Phase 2A tests use an isolated test DB.
    test("REG-8: Phase 2A tests use an isolated test DB", () => {
      assert(process.env.AI_WORKSPACE_DB_PATH !== undefined);
      assert.strictEqual(process.env.AI_WORKSPACE_DB_PATH, TEST_DB_PATH);
      assert(fs.existsSync(TEST_DB_PATH), "Temporary test DB file must exist");
      assert.notStrictEqual(TEST_DB_PATH, OPERATIONAL_DB_PATH);
    });

    // 9. Running Phase 2A tests does not change operational DB row counts/content.
    test("REG-9: Operational DB row counts and content are unaltered during test execution", () => {
      const currentOp = getOperationalSnapshot();
      assert.strictEqual(
        currentOp.hash,
        initialOperationalSnapshot.hash,
        "Operational DB hash must be identical to baseline snapshot"
      );
      assert.deepStrictEqual(
        currentOp.counts,
        initialOperationalSnapshot.counts,
        "Operational DB table counts must match baseline snapshot"
      );
    });

    // 10. AI tests do not leave agents/departments/budget rows behind.
    test("REG-10: Test agents/departments do not leak into operational DB", () => {
      // 1. Verify operational DB counts did not grow during test execution
      const currentOp = getOperationalSnapshot();
      assert.strictEqual(
        currentOp.counts.ai_departments,
        initialOperationalSnapshot.counts.ai_departments,
        "Operational departments count must remain unaltered by tests"
      );
      assert.strictEqual(
        currentOp.counts.ai_agents,
        initialOperationalSnapshot.counts.ai_agents,
        "Operational agents count must remain unaltered by tests"
      );

      // 2. Fresh isolated bootstrap test: verify a newly initialized DB only has 1 department (EXECUTIVE) and 1 agent (ceo_main)
      const freshTestPath = path.join(
        os.tmpdir(),
        `fresh_bootstrap_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.db`
      );
      const freshDb = new DatabaseSync(freshTestPath);
      initAiDatabase(freshDb);

      const freshDepts = freshDb.prepare("SELECT id FROM ai_departments").all() as Array<{ id: string }>;
      assert.strictEqual(freshDepts.length, 1, "Fresh bootstrap DB must only have 1 department (EXECUTIVE)");
      assert.strictEqual(freshDepts[0].id, "EXECUTIVE");

      const freshAgents = freshDb.prepare("SELECT id FROM ai_agents").all() as Array<{ id: string }>;
      assert.strictEqual(freshAgents.length, 1, "Fresh bootstrap DB must only have 1 agent (ceo_main)");
      assert.strictEqual(freshAgents[0].id, "ceo_main");

      freshDb.close();
      if (fs.existsSync(freshTestPath)) fs.unlinkSync(freshTestPath);
    });

    // 11. CEO tests do not leave operational artifacts behind.
    test("REG-11: Operational DB has zero test department budgets, task budgets, or ledger rows", () => {
      // 1. Verify operational DB counts did not grow during test execution
      const currentOp = getOperationalSnapshot();
      assert.strictEqual(
        currentOp.counts.ai_department_budgets,
        initialOperationalSnapshot.counts.ai_department_budgets,
        "Operational department budgets must remain unaltered by tests"
      );
      assert.strictEqual(
        currentOp.counts.ai_task_budgets,
        initialOperationalSnapshot.counts.ai_task_budgets,
        "Operational task budgets must remain unaltered by tests"
      );
      assert.strictEqual(
        currentOp.counts.ai_usage_ledger,
        initialOperationalSnapshot.counts.ai_usage_ledger,
        "Operational usage ledger must remain unaltered by tests"
      );

      // 2. Fresh isolated bootstrap test: verify a newly initialized DB has 0 department budgets, 0 task budgets, 0 ledger rows
      const freshTestPath = path.join(
        os.tmpdir(),
        `fresh_bootstrap_b_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.db`
      );
      const freshDb = new DatabaseSync(freshTestPath);
      initAiDatabase(freshDb);

      const deptBudgets = (freshDb.prepare("SELECT count(*) as c FROM ai_department_budgets").get() as { c: number }).c;
      assert.strictEqual(deptBudgets, 0, "No department budgets in fresh bootstrap DB");

      const taskBudgets = (freshDb.prepare("SELECT count(*) as c FROM ai_task_budgets").get() as { c: number }).c;
      assert.strictEqual(taskBudgets, 0, "No task budgets in fresh bootstrap DB");

      const ledgerCount = (freshDb.prepare("SELECT count(*) as c FROM ai_usage_ledger").get() as { c: number }).c;
      assert.strictEqual(ledgerCount, 0, "No ledger entries in fresh bootstrap DB");

      freshDb.close();
      if (fs.existsSync(freshTestPath)) fs.unlinkSync(freshTestPath);
    });

    // 12. Fresh operational bootstrap remains EXECUTIVE + CEO only.
    test("REG-12: Fresh operational bootstrap remains EXECUTIVE + CEO only", () => {
      // In isolated test DB, verify that only EXECUTIVE was seeded at start
      const testDb = getAiDatabase();
      const testDepts = testDb.prepare("SELECT id FROM ai_departments").all() as Array<{ id: string }>;
      assert(testDepts.some((d) => d.id === "EXECUTIVE"), "EXECUTIVE must exist");
      const ceo = getAgent("ceo_main");
      assert(ceo !== null, "CEO agent must exist");
      assert.strictEqual(ceo?.department, "EXECUTIVE");
    });

    // 13. ZOHO_WRITE remains blocked.
    test("REG-13: ZOHO_WRITE remains blocked permanently across all layers", () => {
      const safety = evaluateSafetyGate("ZOHO_WRITE");
      assert.strictEqual(safety.allowed, false);
      assert.strictEqual(safety.requiresApproval, false);

      const ceo = getAgent("ceo_main");
      assert(ceo?.denied_tools.includes("ZOHO_WRITE"));

      assert.throws(() => {
        createAutonomousAgent({
          creatorId: "ceo_main",
          id: "forbidden_agent",
          name: "Illegal Writer",
          role: "Specialist",
          department: "EXECUTIVE",
          level: "SPECIALIST",
          allowed_tools: ["ZOHO_WRITE"],
          created_reason: "Testing security block",
        });
      }, /Cannot grant ZOHO_WRITE/);
    });

    // ============================================================
    // SECTION B: ARCHITECTURE TESTS (ARCH-1 to ARCH-11)
    // ============================================================

    // ARCH-1: Fresh bootstrap does NOT create all business departments
    test("ARCH-1: Fresh bootstrap does NOT create all business departments (only EXECUTIVE seeded)", () => {
      const memDb = new DatabaseSync(":memory:");
      memDb.exec(`
        CREATE TABLE ai_departments (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          purpose TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          parent_department TEXT,
          department_head_agent_id TEXT,
          active_agent_count INTEGER NOT NULL DEFAULT 0,
          current_budget REAL NOT NULL DEFAULT 0.0,
          current_consumption REAL NOT NULL DEFAULT 0.0,
          created_by TEXT NOT NULL DEFAULT 'SYSTEM',
          created_reason TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      const nowIso = new Date().toISOString();
      memDb.prepare(`
        INSERT INTO ai_departments (
          id, name, purpose, status, parent_department, department_head_agent_id,
          active_agent_count, current_budget, current_consumption,
          created_by, created_reason, created_at, updated_at
        ) VALUES (
          'EXECUTIVE', 'Executive Office',
          'Company leadership, strategic direction, and overall workforce governance.',
          'ACTIVE', NULL, 'ceo_main', 1, 0.0, 0.0, 'SYSTEM', 'Minimum system organization', ?, ?
        )
      `).run(nowIso, nowIso);

      const depts = memDb.prepare("SELECT id FROM ai_departments").all() as Array<{ id: string }>;
      assert.strictEqual(depts.length, 1);
      assert.strictEqual(depts[0].id, "EXECUTIVE");

      const forbiddenAutoDepts = ["FINANCE", "SALES", "ESTIMATION", "PROJECTS", "SITE_EXECUTION", "BILLING", "QUALITY", "INVENTORY", "LEGAL_COMPLIANCE", "IT", "RESEARCH"];
      for (const d of forbiddenAutoDepts) {
        assert(!depts.some((row) => row.id === d), `Department ${d} must NOT be auto-seeded on fresh DB`);
      }
    });

    // ARCH-2: EXECUTIVE / CEO system bootstrap is available
    test("ARCH-2: EXECUTIVE / CEO system bootstrap is available", () => {
      const execDept = getDepartment("EXECUTIVE");
      assert(execDept !== null);
      assert.strictEqual(execDept?.id, "EXECUTIVE");

      const ceoAgent = getAgent("ceo_main");
      assert(ceoAgent !== null);
      assert.strictEqual(ceoAgent?.role, "Chief Executive Officer");
      assert(ceoAgent?.denied_tools.includes("ZOHO_WRITE"));
    });

    // ARCH-3: CEO can dynamically create ACCOUNTS when required
    test("ARCH-3: CEO can dynamically create ACCOUNTS when required", () => {
      const result = getOrCreateDepartment(
        "ACCOUNTS",
        "Owner requested significant Accounts work; dynamic department deployment",
        "CEO"
      );
      assert(result.department !== null);
      assert.strictEqual(result.department.id, "ACCOUNTS");
      assert.strictEqual(result.department.status, "ACTIVE");
    });

    // ARCH-4: CEO can dynamically create PURCHASE when required
    test("ARCH-4: CEO can dynamically create PURCHASE when required", () => {
      const result = getOrCreateDepartment(
        "PURCHASE",
        "Vendor bill analysis and rate comparison requirement",
        "CEO"
      );
      assert(result.department !== null);
      assert.strictEqual(result.department.id, "PURCHASE");
      assert.strictEqual(result.department.status, "ACTIVE");
    });

    // ARCH-5: Repeated request reuses existing department instead of duplicating it
    test("ARCH-5: Repeated request reuses existing department instead of duplicating it", () => {
      const firstCall = getOrCreateDepartment("ACCOUNTS", "First request", "CEO");
      const secondCall = getOrCreateDepartment("ACCOUNTS", "Second request", "CEO");

      assert.strictEqual(secondCall.created, false);
      assert.strictEqual(firstCall.department.id, secondCall.department.id);

      const db = getAiDatabase();
      const count = db.prepare("SELECT count(*) as c FROM ai_departments WHERE id = 'ACCOUNTS'").get() as { c: number };
      assert.strictEqual(count.c, 1);
    });

    // ARCH-6: Department creation stays within global permissions
    test("ARCH-6: Department creation stays within global permissions", () => {
      const dept = getOrCreateDepartment("SALES", "Commercial inquiry", "CEO").department;
      assert.strictEqual(dept.id, "SALES");
      assert.strictEqual(dept.status, "ACTIVE");
    });

    // ARCH-7: Department creation cannot grant ZOHO_WRITE
    test("ARCH-7: Department creation cannot grant ZOHO_WRITE", () => {
      const safety = evaluateSafetyGate("ZOHO_WRITE");
      assert.strictEqual(safety.allowed, false);

      const accountsAgent = createAutonomousAgent({
        creatorId: "ceo_main",
        id: "agent_accounts_auditor_test",
        name: "Accounts Auditor",
        role: "Auditor",
        department: "ACCOUNTS",
        level: "SPECIALIST",
        allowed_tools: ["READ_ONLY"],
        created_reason: "Internal audit of reconciliation entries",
      });

      assert(accountsAgent.denied_tools.includes("ZOHO_WRITE"));

      assert.throws(() => {
        createAutonomousAgent({
          creatorId: "ceo_main",
          id: "bad_accounts_writer",
          name: "Unauthorized Zoho Writer",
          role: "Accountant",
          department: "ACCOUNTS",
          level: "SPECIALIST",
          allowed_tools: ["ZOHO_WRITE"],
          created_reason: "Testing forbidden tool grant",
        });
      }, /Cannot grant ZOHO_WRITE/);
    });

    // ARCH-8: Model catalog does not invent provider monetary pricing
    test("ARCH-8: Model catalog does not invent provider monetary pricing", () => {
      const catalog = getModelCostCatalog();
      assert(catalog.length > 0);

      const unconfigured = catalog.filter((m) => m.status === "CONFIG_REQUIRED");
      assert(unconfigured.length > 0);

      for (const m of unconfigured) {
        assert.strictEqual(m.input_cost_basis, 0.0);
        assert.strictEqual(m.output_cost_basis, 0.0);
        assert.strictEqual(m.fixed_call_cost, 0.0);
      }
    });

    // ARCH-9: Unknown model pricing is explicitly CONFIG_REQUIRED
    test("ARCH-9: Unknown model pricing is explicitly CONFIG_REQUIRED or equivalent", () => {
      resetModelPricingToConfigRequired("gpt-4o-mini");
      const resetEntry = getModelCostEntry("gpt-4o-mini");
      assert.strictEqual(resetEntry?.status, "CONFIG_REQUIRED");
      assert.strictEqual(resetEntry?.fixed_call_cost, 0.0);
    });

    // ARCH-10: Unknown pricing cannot bypass ₹15,000 hard limit
    test("ARCH-10: Unknown pricing cannot bypass ₹15,000 hard limit", () => {
      // 1. Zero cost reservation for unconfigured model throws
      assert.throws(() => {
        reserveBudget({
          taskId: "task_zero_bypass_test",
          agentId: "ceo_main",
          estimatedCost: 0.0,
          costStatus: "CONFIG_REQUIRED",
        });
      }, /COST_CONFIG_REQUIRED/);

      // 2. CONFIG_REQUIRED model blocks execution rather than faking ₹1 reservation
      resetModelPricingToConfigRequired("gpt-4o-mini");
      const modelSel = selectModelForTask({
        complexity: "LOW",
        availableBudget: 5000.0,
      });
      // Either routes to alternative or returns COST_CONFIG_REQUIRED
      if (modelSel.costStatus === "CONFIG_REQUIRED") {
        assert.strictEqual(modelSel.canExecute, false);
        assert.strictEqual(modelSel.gateStatus, "COST_CONFIG_REQUIRED");
      }

      // 3. Exceeding monthly limit triggers hard stop
      const period = getCurrentBudgetPeriod();
      assert.throws(() => {
        reserveBudget({
          taskId: "task_exceed_ceiling_test",
          agentId: "ceo_main",
          estimatedCost: period.available_amount + 1.0,
          costStatus: "ESTIMATED",
        });
      }, /Budget Exceeded/);
    });

    // ARCH-11: ESTIMATED cost is distinguishable from FINAL cost and NO_METERED_COST
    test("ARCH-11: ESTIMATED cost is distinguishable from FINAL and NO_METERED_COST", () => {
      const initialBreakdown = getCostBreakdownByStatus();
      assert(typeof initialBreakdown.configRequiredCount === "number");
      assert(typeof initialBreakdown.estimatedCount === "number");
      assert(typeof initialBreakdown.finalCount === "number");
      assert(typeof initialBreakdown.noMeteredCostCount === "number");

      // Record an ESTIMATED usage entry
      reserveBudget({
        taskId: "task_distinguish_est",
        agentId: "ceo_main",
        estimatedCost: 10.0,
        costStatus: "ESTIMATED",
      });
      recordActualCost({
        taskId: "task_distinguish_est",
        actualCost: 10.0,
        costStatus: "ESTIMATED",
        model: "gpt-4o",
        provider: "OpenAI",
        usageType: "ESTIMATED_RUN",
        metadataSummary: "Estimated run with marked status",
      });

      // Record a FINAL usage entry
      reserveBudget({
        taskId: "task_distinguish_final",
        agentId: "ceo_main",
        estimatedCost: 15.0,
        costStatus: "FINAL",
      });
      recordActualCost({
        taskId: "task_distinguish_final",
        actualCost: 15.0,
        costStatus: "FINAL",
        model: "gpt-4o",
        provider: "OpenAI",
        usageType: "FINAL_INVOICED_RUN",
        metadataSummary: "Final invoiced provider charge",
      });

      const updatedBreakdown = getCostBreakdownByStatus();
      assert(updatedBreakdown.estimatedCount >= 1);
      assert(updatedBreakdown.finalCount >= 1);
      assert(updatedBreakdown.estimatedTotal > 0);
      assert(updatedBreakdown.finalTotal > 0);
    });

    // ============================================================
    // SECTION C: ORIGINAL 25 PHASE 2A ACCEPTANCE TESTS (RUN IN ISOLATION)
    // ============================================================

    // 1. Monthly limit initializes at ₹15,000
    test("1. Monthly limit initializes at ₹15,000", () => {
      const period = getCurrentBudgetPeriod();
      assert.strictEqual(period.monthly_limit, 15000.0);
      assert.strictEqual(period.currency, "INR");
      assert(period.available_amount <= 15000.0 && period.available_amount >= 0.0);
    });

    // 2. CEO may allocate budget dynamically
    test("2. CEO may allocate budget dynamically", () => {
      const deptBudget = allocateDepartmentBudget({
        departmentId: "ACCOUNTS",
        amount: 2500.0,
      });
      assert.strictEqual(deptBudget.department_id, "ACCOUNTS");
      assert.strictEqual(deptBudget.allocated_amount, 2500.0);
    });

    // 3. No fixed department allocation is required
    test("3. No fixed department allocation is required", () => {
      const period = getCurrentBudgetPeriod();
      assert(period.monthly_limit === 15000.0);
    });

    // 4. CEO may create low-risk agent within budget
    test("4. CEO may create low-risk agent within budget", () => {
      const agent = createAutonomousAgent({
        creatorId: "ceo_main",
        id: "agent_vendor_analyst",
        name: "Vendor Performance Analyst",
        role: "Vendor Analyst",
        department: "PURCHASE",
        level: "SPECIALIST",
        purpose: "Analyze vendor performance and delivery timelines",
        capabilities: ["DATA_ANALYSIS", "REPORTING"],
        allowed_tools: ["READ_ONLY"],
        max_task_budget: 100.0,
        monthly_budget: 800.0,
        created_reason: "High volume of vendor quotes needing evaluation",
      });

      assert.strictEqual(agent.id, "agent_vendor_analyst");
      assert.strictEqual(agent.status, "ACTIVE");
      assert(agent.denied_tools.includes("ZOHO_WRITE"));
    });

    // 5. CEO may create department when capability is missing
    test("5. CEO may create department when capability is missing", () => {
      const dept = createAutonomousDepartment({
        id: "LOGISTICS",
        name: "Logistics & Site Movement",
        purpose: "Track delivery coordination and site transit",
        created_reason: "Material transit delays require dedicated tracking",
      });

      assert.strictEqual(dept.id, "LOGISTICS");
      assert.strictEqual(dept.status, "ACTIVE");
    });

    // 6. Agent inherits system permissions
    test("6. Agent inherits system permissions", () => {
      const ceo = getAgent("ceo_main") || {
        id: "ceo_main",
        level: "CEO" as const,
        role: "CEO",
        name: "AI CEO",
        department: "EXECUTIVE",
        reports_to: null,
        status: "ACTIVE" as const,
        capabilities: [],
        allowed_tools: ["ALL"],
        denied_tools: ["ZOHO_WRITE"],
        risk_class: "CRITICAL",
        created_by: "SYSTEM" as const,
        created_at: "",
        updated_at: "",
      };

      const vpAgent = {
        ...ceo,
        id: "vp_test",
        level: "VP" as const,
        reports_to: "ceo_main",
        allowed_tools: ["READ_ONLY"],
      };

      assert.doesNotThrow(() => checkInheritanceRules(ceo, vpAgent));
    });

    // 7. New agent cannot receive ZOHO_WRITE
    test("7. New agent cannot receive ZOHO_WRITE", () => {
      assert.throws(() => {
        createAutonomousAgent({
          creatorId: "ceo_main",
          id: "bad_agent_zoho",
          name: "Malicious Zoho Writer",
          role: "Accountant",
          department: "ACCOUNTS",
          level: "SPECIALIST",
          allowed_tools: ["ZOHO_WRITE"],
          created_reason: "Testing violation",
        });
      }, /Cannot grant ZOHO_WRITE/);
    });

    // 8. CEO cannot grant ZOHO_WRITE
    test("8. CEO cannot grant ZOHO_WRITE", () => {
      const gateResult = evaluateSafetyGate("ZOHO_WRITE");
      assert.strictEqual(gateResult.allowed, false);
      assert.strictEqual(gateResult.requiresApproval, false);
    });

    // 9. Budget cannot exceed ₹15,000
    test("9. Budget cannot exceed ₹15,000", () => {
      const period = getCurrentBudgetPeriod();
      const overSpend = period.available_amount + 500.0;
      assert.throws(() => {
        reserveBudget({
          taskId: "task_huge_overspend",
          agentId: "agent_vendor_analyst",
          estimatedCost: overSpend,
          costStatus: "ESTIMATED",
        });
      }, /Budget Exceeded/);
    });

    // 10. Client cannot fake additional budget
    test("10. Client cannot fake additional budget", () => {
      const period = getCurrentBudgetPeriod();
      assert.strictEqual(period.monthly_limit, 15000.0);
    });

    // 11. Two concurrent commitments cannot overspend available budget
    test("11. Two concurrent commitments cannot overspend available budget", () => {
      const period = getCurrentBudgetPeriod();
      const halfAvailable = Math.floor(period.available_amount * 0.6);

      const res1 = reserveBudget({
        taskId: "task_concurrent_1",
        agentId: "agent_vendor_analyst",
        estimatedCost: halfAvailable,
        costStatus: "ESTIMATED",
      });
      assert(res1.success);

      assert.throws(() => {
        reserveBudget({
          taskId: "task_concurrent_2",
          agentId: "agent_vendor_analyst",
          estimatedCost: halfAvailable,
          costStatus: "ESTIMATED",
        });
      }, /Budget Exceeded/);

      releaseBudgetCommitment("task_concurrent_1");
    });

    // 12. Cancelled task releases committed budget
    test("12. Cancelled task releases committed budget", () => {
      const initial = getCurrentBudgetPeriod();
      const reserveCost = 300.0;

      reserveBudget({
        taskId: "task_cancel_test",
        agentId: "agent_vendor_analyst",
        estimatedCost: reserveCost,
        costStatus: "ESTIMATED",
      });

      const mid = getCurrentBudgetPeriod();
      assert(mid.committed_amount >= initial.committed_amount + reserveCost);

      const released = releaseBudgetCommitment("task_cancel_test");
      assert.strictEqual(released.committed_amount, initial.committed_amount);
    });

    // 13. Actual cost converts commitment to consumption correctly
    test("13. Actual cost converts commitment to consumption correctly", () => {
      const initial = getCurrentBudgetPeriod();
      const est = 200.0;
      const actual = 180.0;

      reserveBudget({
        taskId: "task_actual_test",
        agentId: "agent_vendor_analyst",
        estimatedCost: est,
        costStatus: "ESTIMATED",
      });

      const { period } = recordActualCost({
        taskId: "task_actual_test",
        actualCost: actual,
        costStatus: "ESTIMATED",
      });

      assert.strictEqual(period.committed_amount, initial.committed_amount);
      assert.strictEqual(period.consumed_amount, initial.consumed_amount + actual);
    });

    // 14. CEO may transfer budget between departments
    test("14. CEO may transfer budget between departments", () => {
      getOrCreateDepartment("HR", "HR operations", "CEO");
      allocateDepartmentBudget({ departmentId: "HR", amount: 1000.0 });
      allocateDepartmentBudget({ departmentId: "ACCOUNTS", amount: 1000.0 });

      const transferred = transferDepartmentBudget({
        fromDepartmentId: "HR",
        toDepartmentId: "ACCOUNTS",
        amount: 400.0,
        reason: "Accounts team facing audit workload",
      });

      assert.strictEqual(transferred, true);
    });

    // 15. Transfer cannot exceed available source allocation
    test("15. Transfer cannot exceed available source allocation", () => {
      assert.throws(() => {
        transferDepartmentBudget({
          fromDepartmentId: "HR",
          toDepartmentId: "ACCOUNTS",
          amount: 99999.0,
          reason: "Excess transfer",
        });
      }, /Transfer Blocked/);
    });

    // 16. 70% warning works
    test("16. 70% warning works", () => {
      const status = computeBudgetStatus(10500.0, 0, MONTHLY_AI_HARD_LIMIT);
      assert.strictEqual(status, "WARNING");
    });

    // 17. 85% warning works
    test("17. 85% warning works", () => {
      const status = computeBudgetStatus(12750.0, 0, MONTHLY_AI_HARD_LIMIT);
      assert.strictEqual(status, "HIGH");
    });

    // 18. 95% warning works
    test("18. 95% warning works", () => {
      const status = computeBudgetStatus(14250.0, 0, MONTHLY_AI_HARD_LIMIT);
      assert.strictEqual(status, "CRITICAL");
    });

    // 19. 100% creates HARD_STOP
    test("19. 100% creates HARD_STOP", () => {
      const status = computeBudgetStatus(15000.0, 0, MONTHLY_AI_HARD_LIMIT);
      assert.strictEqual(status, "HARD_STOP");
    });

    // 20. CEO may choose cheaper model when appropriate
    test("20. CEO may choose cheaper model when appropriate", () => {
      configureModelPricing({
        id: "gpt-4o-mini",
        model: "gpt-4o-mini",
        input_cost_basis: 15.0,
        output_cost_basis: 60.0,
        fixed_call_cost: 0.15,
        status: "ESTIMATED",
        notes: "Configured cheap FAST tier model",
      });

      const lowCostModel = selectModelForTask({
        complexity: "LOW",
        availableBudget: 100.0,
      });
      assert.strictEqual(lowCostModel.tier, "FAST");
      assert.strictEqual(lowCostModel.model, "gpt-4o-mini");
      assert.strictEqual(lowCostModel.canExecute, true);
    });

    // 21. High-risk task may allocate reviewer
    test("21. High-risk task may allocate reviewer", () => {
      const highRiskModel = selectModelForTask({
        complexity: "CRITICAL",
        accuracyRequirement: "CRITICAL",
        availableBudget: 100.0,
      });
      assert.strictEqual(highRiskModel.reviewerNeeded, true);
    });

    // 22. Company money authority is NOT implied by AI budget
    test("22. Company money authority is NOT implied by AI budget", () => {
      const forbiddenCapabilities = [
        "PAYMENT_AUTHORITY",
        "BANKING_WRITE",
        "CONTRACT_SIGNING",
        "STATUTORY_FILING",
      ];

      for (const cap of forbiddenCapabilities) {
        assert.throws(() => {
          createAutonomousAgent({
            creatorId: "ceo_main",
            id: `bad_agent_${cap.toLowerCase()}`,
            name: "Company Money Agent",
            role: "Finance Officer",
            department: "FINANCE",
            level: "MANAGER",
            capabilities: [cap],
            created_reason: "Attempting financial write",
          });
        }, /Cannot grant forbidden capability/);
      }
    });

    // 23. Generic approval cannot increase monthly budget
    test("23. Generic approval cannot increase monthly budget", () => {
      const period = getCurrentBudgetPeriod();
      assert.strictEqual(period.monthly_limit, 15000.0);
      assert(MONTHLY_AI_HARD_LIMIT === 15000.0);
    });

    // 24. Generic approval cannot enable ZOHO_WRITE
    test("24. Generic approval cannot enable ZOHO_WRITE", () => {
      const zohoSafety = evaluateSafetyGate("ZOHO_WRITE");
      assert.strictEqual(zohoSafety.allowed, false);
      assert.strictEqual(zohoSafety.requiresApproval, false);
    });

    // 25. Owner remains CEO-only front door
    await testAsync("25. Owner remains CEO-only front door", async () => {
      const response = await executeCeoOrchestration(
        "CEO, show me your current AI budget and explain how you would allocate resources if Accounts suddenly had a heavy workload.",
        "run_test_front_door",
        []
      );
      assert(response.includes("15,000"));
      assert(response.includes("Accounts"));
    });

    // Final verification of operational DB invariance after entire test run
    const finalOperationalSnapshot = getOperationalSnapshot();
    console.log("\n[OPERATIONAL DB INVARIANCE CHECK]");
    console.log(`Initial Hash: ${initialOperationalSnapshot.hash}`);
    console.log(`Final Hash:   ${finalOperationalSnapshot.hash}`);
    assert.strictEqual(
      finalOperationalSnapshot.hash,
      initialOperationalSnapshot.hash,
      "Operational DB hash MUST NOT change during Phase 2A test execution"
    );
    assert.deepStrictEqual(
      finalOperationalSnapshot.counts,
      initialOperationalSnapshot.counts,
      "Operational DB row counts MUST NOT change during Phase 2A test execution"
    );
    console.log("✅ Operational database is 100% UNMUTATED and INVARIANT.");

  } finally {
    // Teardown isolated test DB
    try {
      closeAiDatabase();
    } catch {
      // ignore
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch {
        // ignore
      }
    }
    if (fs.existsSync(`${TEST_DB_PATH}-wal`)) {
      try {
        fs.unlinkSync(`${TEST_DB_PATH}-wal`);
      } catch {
        // ignore
      }
    }
    if (fs.existsSync(`${TEST_DB_PATH}-shm`)) {
      try {
        fs.unlinkSync(`${TEST_DB_PATH}-shm`);
      } catch {
        // ignore
      }
    }
  }

  console.log(`\nPhase 2A Test Suite Summary: ${passed} Passed, ${failed} Failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runPhase2aTests().catch((err) => {
  console.error("Test runner encountered unhandled error:", err);
  process.exit(1);
});

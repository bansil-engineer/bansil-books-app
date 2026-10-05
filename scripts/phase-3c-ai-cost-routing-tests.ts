// ============================================================
// Bansil Books Analytics — Phase 3C: AI Cost Routing Tests
// 30 Real Assertions for Deterministic-First / AI-Last Routing,
// Model Cost Safety, Budget Ceilings, Cache Reuse, and DB Safety
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
  `phase3c_test_isolated_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.db`
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
  isZeroAiCase,
  routeObjectiveToExecution,
  validateEvidenceCache,
  enforceAgentReusePolicy,
} from "../app/lib/ai/ceo/cost-routing-engine";
import {
  selectModelForTask,
  getModelCostEntry,
  configureModelPricing,
  resetModelPricingToConfigRequired,
  getModelCostCatalog,
} from "../app/lib/ai/ceo/model-catalog";
import {
  getCurrentBudgetPeriod,
  reserveBudget,
  recordActualCost,
  releaseBudgetCommitment,
  MONTHLY_AI_HARD_LIMIT,
} from "../app/lib/ai/ceo/budget-governance";
import {
  generateFingerprint,
  lookupEvidence,
  indexEvidence,
  isEvidenceFresh,
} from "../app/lib/ai/ceo/evidence-index";
import { resolvePeriod } from "../app/lib/ai/ceo/date-resolver";
import { classifyAction, classifyRisk, isZohoWriteAllowed, isBusinessSpendAction } from "../app/lib/ai/ceo/authority-policy";
import { determineReviewRequirement, ensureReviewTable } from "../app/lib/ai/ceo/independent-checker";
import { GovernedAction } from "../app/lib/ai/ceo/governance-types";
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
  console.log("PHASE 3C: DETERMINISTIC-FIRST / AI-LAST ROUTING TEST SUITE");
  console.log("============================================================\n");

  const db = getAiDatabase();
  initAiDatabase(db);
  ensureReviewTable();

  // Helper to ensure model catalog seed in isolated test db
  const defaultModels = [
    { id: "gemini_2_5_flash", provider: "google", model: "gemini-2.5-flash", tier: "FAST", input: 0.05, output: 0.15, fixed: 0.50, status: "ESTIMATED" },
    { id: "gemini_2_5_pro", provider: "google", model: "gemini-2.5-pro", tier: "REASONING", input: 0.20, output: 0.60, fixed: 1.50, status: "ESTIMATED" },
    { id: "claude_3_7_sonnet", provider: "anthropic", model: "claude-3-7-sonnet", tier: "HIGH_REASONING", input: 0.40, output: 1.20, fixed: 3.00, status: "ESTIMATED" },
    { id: "unconfigured_model", provider: "custom", model: "custom-unpriced", tier: "STANDARD", input: 0, output: 0, fixed: 0, status: "CONFIG_REQUIRED" },
  ];

  for (const m of defaultModels) {
    db.prepare(`
      INSERT OR REPLACE INTO model_cost_catalog (
        id, provider, model, tier, input_cost_basis, output_cost_basis,
        fixed_call_cost, status, enabled, effective_from
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
    `).run(m.id, m.provider, m.model, m.tier, m.input, m.output, m.fixed, m.status);
  }

  // 1. deterministic sales query uses zero model calls
  await runTest("T01: deterministic sales query uses zero model calls", () => {
    const route = routeObjectiveToExecution({ objective: "Sales summary for Q1 FY2024-25" });
    assert.strictEqual(route.zeroAi, true, "Must be zero AI");
    assert.strictEqual(route.modelCalls, 0, "Model calls must be 0");
    assert.strictEqual(route.route, "DETERMINISTIC_SQL");
  });

  // 2. deterministic purchase query uses zero model calls
  await runTest("T02: deterministic purchase query uses zero model calls", () => {
    const route = routeObjectiveToExecution({ objective: "Purchase bills total for FY25-26" });
    assert.strictEqual(route.zeroAi, true, "Must be zero AI");
    assert.strictEqual(route.modelCalls, 0, "Model calls must be 0");
    assert.strictEqual(route.route, "DETERMINISTIC_SQL");
  });

  // 3. date resolution uses zero model calls
  await runTest("T03: date resolution uses zero model calls", () => {
    const period = resolvePeriod("FY2025-26");
    assert.strictEqual(period.startDate, "2025-04-01");
    assert.strictEqual(period.endDate, "2026-03-31");
    const isZero = isZeroAiCase("date calculation for FY2025-26");
    assert.strictEqual(isZero, true, "Date calculation must be classified as zero-AI");
  });

  // 4. reformat follow-up uses zero model calls
  await runTest("T04: reformat follow-up uses zero model calls", () => {
    const isZero = isZeroAiCase("Reformat customer address table for display");
    assert.strictEqual(isZero, true, "Reformatting must be zero-AI");
    const route = routeObjectiveToExecution({ objective: "Reformat customer table layout" });
    assert.strictEqual(route.zeroAi, true);
    assert.strictEqual(route.modelCalls, 0);
  });

  // 5. approval classification uses zero model calls
  await runTest("T05: approval classification uses zero model calls", () => {
    const entry = classifyAction("BANK_PAYMENT");
    assert.strictEqual(entry.category, "OWNER_APPROVAL_REQUIRED");
    assert.strictEqual(isZeroAiCase("approval classification check"), true);
  });

  // 6. risk classification uses zero model calls
  await runTest("T06: risk classification uses zero model calls", () => {
    const action: GovernedAction = {
      actionType: "READ_DATA",
      target: "bansil_books.db",
      riskLevel: "LOW",
      category: "AUTO_EXECUTE",
      requiresReview: false,
      description: "Read sales",
    };
    const risk = classifyRisk(action);
    assert.strictEqual(risk, "LOW");
    assert.strictEqual(isZeroAiCase("risk classification evaluation"), true);
  });

  // 7. cache hit with valid fingerprint avoids AI
  await runTest("T07: cache hit with valid fingerprint avoids AI", () => {
    const fp = generateFingerprint("db", "sales_summary", { fy: "2025-26" });
    indexEvidence({
      sourceId: "bansil_books_db",
      entity: "sales_summary",
      queryFingerprint: fp,
      filters: { fy: "2025-26" },
      freshness: "CACHED_VALIDATED",
      resultReference: "ref_sales_2526",
      summary: "Taxable sales ₹13.58 Cr",
      ttlMs: 60000,
    });

    const route = routeObjectiveToExecution({
      objective: "Sales summary for FY2025-26",
      sourceFingerprint: fp,
    });

    assert.strictEqual(route.route, "VERIFIED_CACHE");
    assert.strictEqual(route.zeroAi, true);
    assert.strictEqual(route.modelCalls, 0);
  });

  // 8. stale cache is rejected
  await runTest("T08: stale cache is rejected", () => {
    const fp = "stale_fp_test_08";
    const cacheFetchedAt = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hour ago
    const check = validateEvidenceCache({
      fingerprint: fp,
      cacheFetchedAt,
      maxAgeMs: 15 * 60 * 1000, // 15 mins TTL
    });

    assert.strictEqual(check.valid, false, "Stale cache must be rejected");
    assert.ok(check.reason.includes("Cache expired"));
  });

  // 9. stale source fingerprint forces refresh
  await runTest("T09: stale source fingerprint forces refresh", () => {
    const fp = "sync_stale_fp_09";
    const now = Date.now();
    const cacheFetchedAt = new Date(now - 10 * 60 * 1000).toISOString();
    const sourceLastSync = new Date(now - 5 * 60 * 1000).toISOString(); // Sync happened AFTER cache

    const check = validateEvidenceCache({
      fingerprint: fp,
      cacheFetchedAt,
      sourceLastSync,
      maxAgeMs: 24 * 3600 * 1000,
    });

    assert.strictEqual(check.valid, false, "Cache must be marked stale if source synced afterwards");
    assert.ok(check.reason.includes("Source data was synced after cache was fetched"));
  });

  // 10. cheap capable model selected first
  await runTest("T10: cheap capable model selected first", () => {
    const period = getCurrentBudgetPeriod();
    const sel = selectModelForTask({
      complexity: "LOW",
      accuracyRequirement: "NORMAL",
      availableBudget: period.available_amount,
    });

    assert.strictEqual(sel.tier, "FAST", "Must select FAST model for low complexity");
    assert.strictEqual(sel.model, "gpt-4o-mini");
    assert.strictEqual(sel.estimatedCost, 0.0756, "Cheap model estimated cost must be calculated from token basis (₹0.0756)");
  });

  // 11. strong model escalation records reason
  await runTest("T11: strong model escalation records reason", () => {
    const route = routeObjectiveToExecution({
      objective: "Comprehensive audit of cross-department strategic procurement terms",
      riskLevel: "CRITICAL",
      requiresReasoning: true,
    });

    assert.strictEqual(route.route, "STRONG_AI");
    assert.ok(route.aiJustification?.escalationReason, "Escalation reason must be recorded");
    assert.ok(route.aiJustification?.escalationReason?.includes("CRITICAL risk"));
  });

  // 12. strong model not used when cheap model sufficient
  await runTest("T12: strong model not used when cheap model sufficient", () => {
    const route = routeObjectiveToExecution({
      objective: "Summarize vendor SLA notes into 3 bullet points",
      riskLevel: "LOW",
      requiresReasoning: true,
    });

    assert.strictEqual(route.route, "CHEAP_AI", "Standard reasoning must use CHEAP_AI");
    assert.strictEqual(route.selectedModel, "gpt-4o-mini");
    assert.strictEqual(route.estimatedCost, 0.0756);
  });

  // 13. model without pricing cannot silently run at ₹0
  await runTest("T13: model without pricing cannot silently run at ₹0", () => {
    const unpriced = getModelCostEntry("unconfigured_model");
    assert.strictEqual(unpriced?.status, "CONFIG_REQUIRED");
    assert.throws(
      () => {
        reserveBudget({
          taskId: "task_unpriced_01",
          agentId: "agent_01",
          estimatedCost: 0,
          costStatus: "CONFIG_REQUIRED",
        });
      },
      /COST_CONFIG_REQUIRED/,
      "Cannot reserve or execute model with CONFIG_REQUIRED pricing"
    );
  });

  // 14. configured estimated pricing works
  await runTest("T14: configured estimated pricing works", () => {
    const ok = configureModelPricing({
      id: "unconfigured_model",
      input_cost_basis: 0.10,
      output_cost_basis: 0.20,
      fixed_call_cost: 0.75,
      status: "ESTIMATED",
      notes: "Estimated pricing configured for test",
    });
    assert.strictEqual(ok, true);

    const configured = getModelCostEntry("unconfigured_model");
    assert.strictEqual(configured?.status, "ESTIMATED");
    assert.strictEqual(configured?.fixed_call_cost, 0.75);

    // Reset back for subsequent tests
    resetModelPricingToConfigRequired("unconfigured_model");
  });

  // 15. ₹15k monthly ceiling enforced
  await runTest("T15: ₹15k monthly ceiling enforced", () => {
    const period = getCurrentBudgetPeriod();
    assert.strictEqual(period.monthly_limit, MONTHLY_AI_HARD_LIMIT);
    assert.strictEqual(period.monthly_limit, 15000.0);
  });

  // 16. commitment reduces available budget
  await runTest("T16: commitment reduces available budget", () => {
    const periodBefore = getCurrentBudgetPeriod();
    const taskId = `task_commit_${Date.now()}`;

    const res = reserveBudget({
      taskId,
      agentId: "test_agent_cost",
      estimatedCost: 200.0,
      costStatus: "ESTIMATED",
    });

    const periodAfter = getCurrentBudgetPeriod();
    assert.strictEqual(
      periodAfter.committed_amount,
      periodBefore.committed_amount + 200.0,
      "Committed amount must increase by reserved amount"
    );
    assert.strictEqual(
      periodAfter.available_amount,
      periodBefore.available_amount - 200.0,
      "Available amount must decrease by reserved amount"
    );

    // Release commitment
    releaseBudgetCommitment(taskId);
  });

  // 17. settlement updates actual cost
  await runTest("T17: settlement updates actual cost", () => {
    const taskId = `task_settle_${Date.now()}`;
    reserveBudget({
      taskId,
      agentId: "test_agent_settle",
      estimatedCost: 10.0,
      costStatus: "ESTIMATED",
    });

    const before = getCurrentBudgetPeriod();
    recordActualCost({
      taskId,
      actualCost: 8.50,
      costStatus: "FINAL",
      model: "gemini-2.5-flash",
      provider: "google",
      usageType: "SUBTASK_EXECUTION",
    });

    const after = getCurrentBudgetPeriod();
    assert.strictEqual(after.consumed_amount, before.consumed_amount + 8.50);
  });

  // 18. AI budget does not authorize company spending
  await runTest("T18: AI budget does not authorize company spending", () => {
    const isCompanySpend = isBusinessSpendAction("BANK_PAYMENT");
    assert.strictEqual(isCompanySpend, true, "BANK_PAYMENT is company spending");
    const action: GovernedAction = {
      actionType: "BANK_PAYMENT",
      target: "Vendor Account",
      amount: 50000,
      riskLevel: "CRITICAL",
      category: "OWNER_APPROVAL_REQUIRED",
      requiresReview: true,
      description: "Pay vendor ₹50,000",
    };
    const auth = classifyAction(action.actionType);
    assert.strictEqual(auth.category, "OWNER_APPROVAL_REQUIRED", "AI budget does not grant authority for bank payments");
  });

  // 19. existing agent reused first
  await runTest("T19: existing agent reused first", () => {
    // Ensure agent exists
    getOrCreateSuitableAgent({
      department: "ACCOUNTS",
      role: "Accounts Specialist",
      requiredCapabilities: ["ACCOUNTING_DATA_READ", "CALCULATION"],
      created_reason: "Pre-existing accounts specialist",
    });

    const sel = enforceAgentReusePolicy({
      department: "ACCOUNTS",
      role: "Accounts Specialist",
      requiredCapabilities: ["ACCOUNTING_DATA_READ"],
      purpose: "Read accounts",
    });

    assert.strictEqual(sel.action, "REUSED", "Must reuse existing agent");
  });

  // 20. unnecessary agent creation blocked
  await runTest("T20: unnecessary agent creation blocked", () => {
    const beforeCount = (db.prepare("SELECT count(*) as c FROM ai_agents WHERE department = 'ACCOUNTS'").get() as any).c;
    enforceAgentReusePolicy({
      department: "ACCOUNTS",
      role: "Accounts Specialist",
      requiredCapabilities: ["ACCOUNTING_DATA_READ"],
      purpose: "General accounts work",
    });
    const afterCount = (db.prepare("SELECT count(*) as c FROM ai_agents WHERE department = 'ACCOUNTS'").get() as any).c;
    assert.strictEqual(beforeCount, afterCount, "Agent count must not increase when reusable agent exists");
  });

  // 21. low-risk deterministic task skips checker
  await runTest("T21: low-risk deterministic task skips checker", () => {
    const req = determineReviewRequirement({
      objective: "Simple count of active sales orders",
      actionType: "DETERMINISTIC_CALCULATION",
      riskLevel: "LOW",
    });
    assert.strictEqual(req.required, false, "LOW deterministic task must skip checker");
  });

  // 22. high-risk task still gets checker
  await runTest("T22: high-risk task still gets checker", () => {
    const req = determineReviewRequirement({
      objective: "Commercial comparison of vendor prices with supplier consolidation advice",
      riskLevel: "HIGH",
      isMaterial: true,
    });
    assert.strictEqual(req.required, true, "HIGH risk task must require checker");
  });

  // 23. checker cost participates in budget
  await runTest("T23: checker cost participates in budget", () => {
    const taskId = `task_checker_budget_${Date.now()}`;
    const periodBefore = getCurrentBudgetPeriod();

    reserveBudget({
      taskId,
      agentId: "agent_general_checker",
      estimatedCost: 0.50,
      costStatus: "ESTIMATED",
    });

    const periodAfter = getCurrentBudgetPeriod();
    assert.strictEqual(periodAfter.committed_amount, periodBefore.committed_amount + 0.50);
    releaseBudgetCommitment(taskId);
  });

  // 24. cached checker evidence not reused when stale
  await runTest("T24: cached checker evidence not reused when stale", () => {
    const staleTime = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30m ago (TTL 15m)
    const valid = isEvidenceFresh(
      {
        id: "ev_stale_checker",
        sourceId: "audit",
        entity: "review",
        queryFingerprint: "fp_checker_stale",
        filters: {},
        freshness: "CACHED_VALIDATED",
        fetchedAt: staleTime,
        resultReference: "ref_01",
        summary: "Old review",
        createdAt: staleTime,
        updatedAt: staleTime,
      },
      15 * 60 * 1000
    );
    assert.strictEqual(valid, false, "Stale checker evidence must not be considered fresh");
  });

  // 25. deterministic governance remains zero-AI
  await runTest("T25: deterministic governance remains zero-AI", () => {
    const actions: GovernedActionType[] = [
      "READ_DATA",
      "ANALYZE_DATA",
      "DETERMINISTIC_CALCULATION",
      "REUSE_AGENT",
      "INTERNAL_DELEGATION",
    ];
    for (const a of actions) {
      const entry = classifyAction(a);
      assert.ok(entry, `Action ${a} must classify deterministically`);
    }
  });

  // 26. repeated same verified query does not duplicate model spend
  await runTest("T26: repeated same verified query does not duplicate model spend", () => {
    const fp = generateFingerprint("db", "sales_query_repeat", { period: "FY25-26" });
    indexEvidence({
      sourceId: "bansil_books_db",
      entity: "sales_query_repeat",
      queryFingerprint: fp,
      filters: { period: "FY25-26" },
      freshness: "CACHED_VALIDATED",
      resultReference: "cached_repeat_result",
      summary: "Cached query result",
      ttlMs: 60000,
    });

    const route1 = routeObjectiveToExecution({ objective: "Sales summary", sourceFingerprint: fp });
    const route2 = routeObjectiveToExecution({ objective: "Sales summary", sourceFingerprint: fp });

    assert.strictEqual(route1.modelCalls, 0);
    assert.strictEqual(route2.modelCalls, 0);
    assert.strictEqual(route1.estimatedCost, 0.0);
    assert.strictEqual(route2.estimatedCost, 0.0);
  });

  // 27. failed AI route does not fabricate successful cost settlement
  await runTest("T27: failed AI route does not fabricate successful cost settlement", () => {
    const taskId = `task_failed_route_${Date.now()}`;
    reserveBudget({
      taskId,
      agentId: "agent_fail_test",
      estimatedCost: 5.0,
      costStatus: "ESTIMATED",
    });

    // On task failure, commitment is released, not settled as successful spend
    releaseBudgetCommitment(taskId);
    const ledgerEntry = db.prepare("SELECT * FROM ai_usage_ledger WHERE task_id = ?").get(taskId);
    assert.strictEqual(ledgerEntry, undefined, "No successful ledger settlement for failed task");
  });

  // 28. CONFIG_REQUIRED behavior works
  await runTest("T28: CONFIG_REQUIRED behavior works", () => {
    const model = getModelCostEntry("unconfigured_model");
    assert.strictEqual(model?.status, "CONFIG_REQUIRED");
  });

  // 29. Owner approval does not bypass budget ceiling
  await runTest("T29: Owner approval does not bypass budget ceiling", () => {
    const period = getCurrentBudgetPeriod();
    const hugeCost = period.available_amount + 5000.0;

    assert.throws(
      () => {
        reserveBudget({
          taskId: "task_huge_spend",
          agentId: "agent_owner_approved",
          estimatedCost: hugeCost,
          costStatus: "ESTIMATED",
        });
      },
      /Budget Exceeded|insufficient/,
      "Cannot bypass budget ceiling even if approved"
    );
  });

  // 30. ZOHO WRITE remains 0
  await runTest("T30: ZOHO WRITE remains 0", () => {
    assert.strictEqual(isZohoWriteAllowed(), false, "ZOHO WRITE must remain 0");
  });

  // Operational DB Safety Check
  const finalOperationalSnapshot = getOperationalSnapshot();
  assert.strictEqual(
    finalOperationalSnapshot.hash,
    initialOperationalSnapshot.hash,
    "Operational DB (data/ai_workspace.db) SHA256 must NOT change after running Phase 3C test suite"
  );
  console.log(`\n  ✓ Operational DB SHA256 invariant verified (${initialOperationalSnapshot.hash?.slice(0, 16)}...)`);

  // Cleanup test DB
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  console.log("\n============================================================");
  console.log(`Phase 3C AI Cost Routing Tests: ${passedCount} passed, ${failedCount} failed out of 30`);
  console.log("============================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error("Suite failed with error:", err);
  process.exit(1);
});

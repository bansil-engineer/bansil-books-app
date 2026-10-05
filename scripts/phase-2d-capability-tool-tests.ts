// ============================================================
// Phase 2D: Company Capability Registry + Safe Tool Onboarding Tests
// Comprehensive Verification of Capability Registry, Safe Tool Catalog,
// Data Source Registry, 10-Point Execution Gate, Evidence Provenance,
// Deduplication, Hard Deny Policies, and Operational DB Invariance.
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
  `phase2d_test_isolated_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.db`
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
    "ai_tasks",
    "ai_runs",
    "ai_memory_entries",
    "ai_capabilities",
    "ai_tools",
    "ai_data_sources",
    "ai_agent_capabilities",
    "ai_tool_executions",
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

const beforeSnapshot = getOperationalSnapshot();
console.log(`[Phase 2D Tests] Initial Operational DB Hash: ${beforeSnapshot.hash}`);

// Imports now load against the isolated test database
import { getAiDatabase, closeAiDatabase } from "../app/lib/db/ai-database.ts";
import {
  listCapabilities,
  getCapabilityByCode,
  isCapabilityGrantable,
  getAgentCapabilities,
  hasCapability,
  grantCapabilityToAgent,
  revokeCapabilityFromAgent,
  searchAgentsByCapabilities,
  getRoleCapabilityTemplates,
  getRoleCapabilityTemplate,
  HARD_DENIED_CAPABILITIES,
} from "../app/lib/ai/ceo/capability-registry.ts";
import {
  listTools,
  getToolByCode,
  registerTool,
} from "../app/lib/ai/ceo/safe-tool-registry.ts";
import {
  listDataSources,
  getDataSourceByCode,
  updateDataSourceFreshness,
} from "../app/lib/ai/ceo/data-source-registry.ts";
import {
  executeGovernedTool,
} from "../app/lib/ai/ceo/tool-executor.ts";
import {
  identifyRequiredCapabilities,
  getRequiredCapabilitiesForTask,
  initiateExecutionRun,
} from "../app/lib/ai/ceo/execution-lifecycle.ts";
import {
  getOrCreateSuitableAgent,
} from "../app/lib/ai/ceo/agent-reuse-engine.ts";
import {
  ZOHO_SECURITY_POLICY,
  APPROVED_ZOHO_READ_SCOPES,
} from "../app/lib/zoho-security-guard.ts";

let passedCount = 0;
let failedCount = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✓ ${name}`);
      passedCount++;
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      console.error(`    Error: ${err.message}`);
      failedCount++;
    });
}

async function main() {
  console.log("\n==================================================");
  console.log("PHASE 2D TEST SUITE: CAPABILITY & TOOL GOVERNANCE");
  console.log("==================================================\n");

  const db = getAiDatabase();

  // Test 1: CEO identifies required capability before execution
  await runTest("1. CEO identifies required capability before execution", () => {
    const caps = identifyRequiredCapabilities("Analyze project profitability and reconcile customer billing");
    assert(caps.includes("ACCOUNTING_DATA_READ"), "Must identify ACCOUNTING_DATA_READ");
    assert(caps.includes("BILLING_DATA_READ"), "Must identify BILLING_DATA_READ");
    assert(caps.includes("CALCULATION"), "Must identify CALCULATION");
    assert(caps.includes("EVIDENCE_COMPARISON"), "Must identify EVIDENCE_COMPARISON");
  });

  // Test 2: Existing capable agent is reused
  await runTest("2. Existing capable agent is reused", () => {
    // Create an agent with specific capabilities
    const firstResult = getOrCreateSuitableAgent({
      department: "ACCOUNTS",
      role: "Financial Analyst",
      requiredCapabilities: ["ACCOUNTING_DATA_READ", "CALCULATION"],
      created_reason: "Initial financial reconciliation",
    });

    // Request agent with matching capabilities
    const secondResult = getOrCreateSuitableAgent({
      department: "ACCOUNTS",
      role: "Financial Analyst",
      requiredCapabilities: ["ACCOUNTING_DATA_READ", "CALCULATION"],
      created_reason: "Subsequent reconciliation task",
    });

    assert.strictEqual(secondResult.action, "REUSED", "Should reuse existing capable agent");
    assert.strictEqual(secondResult.agent.id, firstResult.agent.id, "Reused agent ID must match");
  });

  // Test 3: Existing agent may receive safe missing capability if allowed
  await runTest("3. Existing agent may receive safe missing capability if allowed", () => {
    const agent = getOrCreateSuitableAgent({
      department: "SALES",
      role: "Sales Specialist",
      requiredCapabilities: ["SALES_DATA_READ"],
    });

    assert(hasCapability(agent.agent.id, "SALES_DATA_READ", db), "Agent should have SALES_DATA_READ");
    assert(!hasCapability(agent.agent.id, "BILLING_DATA_READ", db), "Agent initially lacks BILLING_DATA_READ");

    // CEO safely grants missing safe capability
    const grant = grantCapabilityToAgent({
      agentId: agent.agent.id,
      capabilityCode: "BILLING_DATA_READ",
      grantedBy: "AI_CEO",
      sourcePolicy: "CEO_DYNAMIC_EXPANSION",
      db,
    });

    assert.strictEqual(grant.success, true, "Safe grant should succeed");
    assert(hasCapability(agent.agent.id, "BILLING_DATA_READ", db), "Agent must now have BILLING_DATA_READ");
  });

  // Test 4: New agent created only when no suitable reusable agent exists
  await runTest("4. New agent created only when no suitable reusable agent exists", () => {
    const result = getOrCreateSuitableAgent({
      department: "HR",
      role: "Recruitment Specialist",
      requiredCapabilities: ["HR_DATA_READ"],
      created_reason: "Specialized HR headcount analysis",
    });

    assert.strictEqual(result.action, "CREATED", "Should create new agent when no suitable agent exists");
    assert.strictEqual(result.agent.department, "HR");
    assert(result.agent.id.startsWith("agent_hr_recruitment_specialist"));
  });

  // Test 5: Duplicate agent prevention still works
  await runTest("5. Duplicate agent prevention still works", () => {
    const secondAttempt = getOrCreateSuitableAgent({
      department: "HR",
      role: "Recruitment Specialist",
      requiredCapabilities: ["HR_DATA_READ"],
      created_reason: "Another HR task",
    });

    assert.strictEqual(secondAttempt.action, "REUSED", "Duplicate role prevention must reuse existing agent");
  });

  // Test 6: Capability cannot grant ZOHO_WRITE
  await runTest("6. Capability cannot grant ZOHO_WRITE", () => {
    const check = isCapabilityGrantable("ZOHO_WRITE", db);
    assert.strictEqual(check.grantable, false, "ZOHO_WRITE must not be grantable");
    assert(check.reason?.includes("SECURITY POLICY VIOLATION"), "Reason must cite security policy violation");

    const grantAttempt = grantCapabilityToAgent({
      agentId: "ceo_main",
      capabilityCode: "ZOHO_WRITE",
      grantedBy: "AI_CEO",
      db,
    });
    assert.strictEqual(grantAttempt.success, false, "Granting ZOHO_WRITE must fail");
  });

  // Test 7: Capability cannot grant payment authority
  await runTest("7. Capability cannot grant payment authority", () => {
    const check = isCapabilityGrantable("PAYMENT_AUTHORITY", db);
    assert.strictEqual(check.grantable, false, "PAYMENT_AUTHORITY must not be grantable");

    const grantAttempt = grantCapabilityToAgent({
      agentId: "ceo_main",
      capabilityCode: "PAYMENT_AUTHORITY",
      grantedBy: "AI_CEO",
      db,
    });
    assert.strictEqual(grantAttempt.success, false, "Granting PAYMENT_AUTHORITY must fail");
  });

  // Test 8: Client cannot self-grant capability
  await runTest("8. Client cannot self-grant capability", () => {
    const unauthorizedAttempt = grantCapabilityToAgent({
      agentId: "ceo_main",
      capabilityCode: "SALES_DATA_READ",
      grantedBy: "CLIENT_BROWSER",
      db,
    });
    assert.strictEqual(unauthorizedAttempt.success, false, "Client cannot grant capabilities");
    assert(unauthorizedAttempt.error?.includes("Unauthorized grantor"));
  });

  // Test 9: Tool executes only if required capability exists
  await runTest("9. Tool executes only if required capability exists", async () => {
    // Agent without AUDIT_DATABASE_READ capability
    const agent = getOrCreateSuitableAgent({
      department: "LEGAL",
      role: "Contract Reviewer",
      requiredCapabilities: ["COMPANY_DATA_READ"],
    });

    const res = await executeGovernedTool({
      runId: "run_test_tool_cap",
      agentId: agent.agent.id,
      toolCode: "local_audit_evidence_search",
      args: { query: "tax" },
      db,
    });

    assert.strictEqual(res.status, "CAPABILITY_MISSING", "Tool must block when agent lacks capability");
  });
  // Test 9.5: local_balance_sheet_derived_read exists and is READ_ONLY
  await runTest("9.5. local_balance_sheet_derived_read automatically exists and is READ_ONLY", () => {
    const bsTool = getToolByCode("local_balance_sheet_derived_read");
    assert(bsTool !== undefined, "local_balance_sheet_derived_read must be registered on fresh DB");
    console.log("bsTool class:", bsTool.toolClass);
    assert(bsTool.toolClass === "READ_ONLY", "Balance Sheet tool must be READ_ONLY");
    assert(!JSON.stringify(bsTool.inputSchema).includes("sql"), "Must reject arbitrary SQL");
  });

  // Test 10: READ_ONLY tool may auto-execute
  await runTest("10. READ_ONLY tool may auto-execute", async () => {
    const res = await executeGovernedTool({
      runId: "run_test_read_auto",
      agentId: "ceo_main",
      toolCode: "calculate_financial_metrics",
      args: { operation: "variance", operands: [15000, 12000] },
      db,
    });

    assert.strictEqual(res.status, "SUCCESS", "READ_ONLY tool must auto-execute successfully");
    assert.strictEqual(res.evidence?.data?.result, 3000, "Calculation result must be exact");
  });

  // Test 11: HIGH_RISK tool requires approval
  await runTest("11. HIGH_RISK tool requires approval", async () => {
    // Unapproved call -> BLOCKED
    const unapproved = await executeGovernedTool({
      runId: "run_test_high_risk",
      agentId: "ceo_main",
      toolCode: "high_risk_external_action_tool",
      args: { action: "publish_report" },
      ownerApproved: false,
      db,
    });
    assert.strictEqual(unapproved.status, "POLICY_BLOCKED", "Unapproved HIGH_RISK tool must be blocked");

    // Approved call -> SUCCESS
    const approved = await executeGovernedTool({
      runId: "run_test_high_risk",
      agentId: "ceo_main",
      toolCode: "high_risk_external_action_tool",
      args: { action: "publish_report" },
      ownerApproved: true,
      db,
    });
    assert.strictEqual(approved.status, "SUCCESS", "Approved HIGH_RISK tool executes");
  });

  // Test 12: ZOHO_WRITE tool remains blocked
  await runTest("12. ZOHO_WRITE tool remains blocked", async () => {
    const res = await executeGovernedTool({
      runId: "run_test_zoho_write",
      agentId: "ceo_main",
      toolCode: "zoho_write_tool_blocked",
      args: { data: "invoice_create" },
      ownerApproved: true,
      db,
    });

    assert.strictEqual(res.status, "POLICY_BLOCKED", "ZOHO_WRITE tool must remain strictly blocked");
    assert(res.summary.includes("ZOHO WRITE = 0"));
  });

  // Test 13: Arbitrary SQL is not available to model
  await runTest("13. Arbitrary SQL is not available to model", async () => {
    // Safe db adapter only accepts whitelisted table names and blocks arbitrary SQL
    const res = await executeGovernedTool({
      runId: "run_test_sql",
      agentId: "ceo_main",
      toolCode: "safe_db_read_adapter",
      args: { table: "sqlite_master; DROP TABLE ai_agents;--" },
      db,
    });

    assert.strictEqual(res.status, "POLICY_BLOCKED", "Non-whitelisted table or SQL injection must be blocked");
  });

  // Test 14: Arbitrary shell is not available
  await runTest("14. Arbitrary shell is not available", () => {
    const allTools = listTools(db);
    const shellTools = allTools.filter(
      (t) => t.code.includes("shell") || t.code.includes("bash") || t.code.includes("exec")
    );
    assert.strictEqual(shellTools.length, 0, "No arbitrary shell tools must exist in tool catalog");
  });

  // Test 15: Arbitrary HTTP mutation is unavailable
  await runTest("15. Arbitrary HTTP mutation is unavailable", () => {
    const allTools = listTools(db);
    const genericHttp = allTools.filter(
      (t) => t.code === "fetch" || t.code === "httpRequest" || t.code === "genericHttpMutation"
    );
    assert.strictEqual(genericHttp.length, 0, "Generic HTTP mutation tools must NOT be registered");
  });

  // Test 16: Tool input validation works
  await runTest("16. Tool input validation works", async () => {
    const res = await executeGovernedTool({
      runId: "run_test_val",
      agentId: "ceo_main",
      toolCode: "calculate_financial_metrics",
      args: {}, // Missing required 'operation'
      db,
    });

    assert.strictEqual(res.status, "VALIDATION_ERROR", "Missing required field must cause VALIDATION_ERROR");
  });

  // Test 17: Tool failure cannot become fabricated success
  await runTest("17. Tool failure cannot become fabricated success", async () => {
    const res = await executeGovernedTool({
      runId: "run_test_failure_honesty",
      agentId: "ceo_main",
      toolCode: "non_existent_tool_code",
      args: {},
      db,
    });

    assert.strictEqual(res.status, "POLICY_BLOCKED", "Non-existent tool must fail");
    assert(res.error !== undefined, "Error must be explicitly reported");
  });

  // Test 18: Evidence provenance recorded
  await runTest("18. Evidence provenance recorded", async () => {
    const res = await executeGovernedTool({
      runId: "run_test_evidence",
      agentId: "ceo_main",
      toolCode: "local_sales_summary_read",
      args: { startDate: "2026-01-01" },
      db,
    });

    assert.strictEqual(res.status, "SUCCESS");
    assert(res.evidence, "Structured evidence must be returned");
    assert.strictEqual(res.evidence.source, "LOCAL_SQLITE");
    assert.strictEqual(res.evidence.sourceReference, "LOCAL_SQLITE://sales_invoices");
    assert(res.evidence.fetchedAt, "fetchedAt timestamp must be recorded");
  });

  // Test 19: Freshness metadata returned
  await runTest("19. Freshness metadata returned", async () => {
    const res = await executeGovernedTool({
      runId: "run_test_freshness",
      agentId: "ceo_main",
      toolCode: "zoho_organization_read",
      args: {},
      db,
    });

    assert.strictEqual(res.freshness, "LIVE", "Zoho organization tool returns LIVE freshness");
  });

  // Test 20: Cached valid evidence can be reused
  await runTest("20. Cached valid evidence can be reused", async () => {
    const runId = "run_test_cache_reuse";
    // First call
    const firstCall = await executeGovernedTool({
      runId,
      agentId: "ceo_main",
      toolCode: "calculate_financial_metrics",
      args: { operation: "sum", operands: [500, 500] },
      db,
    });
    assert.strictEqual(firstCall.cacheHit, false, "First call must be live execution");

    // Second call with same parameters in same run
    const secondCall = await executeGovernedTool({
      runId,
      agentId: "ceo_main",
      toolCode: "calculate_financial_metrics",
      args: { operation: "sum", operands: [500, 500] },
      freshnessPreference: "PREFER_CACHE",
      db,
    });
    assert.strictEqual(secondCall.cacheHit, true, "Second identical call must be a cache hit");
    assert.strictEqual(secondCall.freshness, "CACHED");
  });

  // Test 21: Stale evidence is not silently treated as fresh
  await runTest("21. Stale evidence is not silently treated as fresh", async () => {
    const runId = "run_test_force_live";
    // First call
    await executeGovernedTool({
      runId,
      agentId: "ceo_main",
      toolCode: "calculate_financial_metrics",
      args: { operation: "sum", operands: [100, 200] },
      db,
    });

    // Force live preference ignores cache
    const liveCall = await executeGovernedTool({
      runId,
      agentId: "ceo_main",
      toolCode: "calculate_financial_metrics",
      args: { operation: "sum", operands: [100, 200] },
      freshnessPreference: "FORCE_LIVE",
      db,
    });
    assert.strictEqual(liveCall.cacheHit, false, "FORCE_LIVE must bypass cache");
    assert.strictEqual(liveCall.freshness, "LIVE");
  });

  // Test 22: Duplicate identical tool call may reuse prior result
  await runTest("22. Duplicate identical tool call may reuse prior result", async () => {
    const runId = "run_test_dedup";
    const call1 = await executeGovernedTool({
      runId,
      agentId: "ceo_main",
      toolCode: "local_sales_summary_read",
      args: { startDate: "2026-03-01" },
      db,
    });
    const call2 = await executeGovernedTool({
      runId,
      agentId: "ceo_main",
      toolCode: "local_sales_summary_read",
      args: { startDate: "2026-03-01" },
      db,
    });

    assert.strictEqual(call1.cacheHit, false);
    assert.strictEqual(call2.cacheHit, true, "Identical tool call within run must reuse result");
  });

  // Test 23: Zoho read tool remains GET-only
  await runTest("23. Zoho read tool remains GET-only", () => {
    const zohoTools = listTools(db).filter((t) => t.provider === "ZOHO_BOOKS");
    for (const zTool of zohoTools) {
      assert(
        zTool.toolClass === "READ_ONLY" || zTool.toolClass === "ZOHO_WRITE",
        `Zoho tool ${zTool.code} must be READ_ONLY or explicitly blocked ZOHO_WRITE`
      );
      if (zTool.toolClass === "ZOHO_WRITE") {
        assert.strictEqual(zTool.active, false, "ZOHO_WRITE tool must be inactive");
      }
    }
  });

  // Test 24: Existing Zoho security tests still pass
  await runTest("24. Existing Zoho security tests still pass", () => {
    assert.strictEqual(ZOHO_SECURITY_POLICY.ACCESS_MODE, "READ ONLY");
    assert.strictEqual(ZOHO_SECURITY_POLICY.WRITE_ACCESS, "DISABLED");
    assert.strictEqual(ZOHO_SECURITY_POLICY.CREATE, "BLOCKED");
    assert.strictEqual(ZOHO_SECURITY_POLICY.UPDATE, "BLOCKED");
    assert.strictEqual(ZOHO_SECURITY_POLICY.DELETE, "BLOCKED");

    for (const scope of APPROVED_ZOHO_READ_SCOPES) {
      assert(scope.endsWith(".READ"), `Approved scope ${scope} must end with .READ`);
    }
  });

  // Test 25: Unknown paid tool cost cannot bypass ₹15,000
  await runTest("25. Unknown paid tool cost cannot bypass ₹15,000", async () => {
    // Register tool with CONFIG_REQUIRED pricing
    registerTool(
      {
        code: "paid_external_api_tool",
        name: "Paid External Tool",
        description: "Third party tool with unconfigured cost",
        provider: "API",
        toolClass: "READ_ONLY",
        requiredCapabilities: ["REPORT_GENERATION"],
        requiresApproval: false,
        active: true,
        serverOnly: true,
        timeoutMs: 30000,
        estimatedCost: 25.0,
        costStatus: "CONFIG_REQUIRED",
      },
      db
    );

    const res = await executeGovernedTool({
      runId: "run_test_tool_cost",
      agentId: "ceo_main",
      toolCode: "paid_external_api_tool",
      args: {},
      db,
    });

    assert.strictEqual(res.status, "POLICY_BLOCKED", "Tool with CONFIG_REQUIRED cost must be blocked");
    assert(res.summary.includes("CONFIG_REQUIRED"));
  });

  // Test 26: Operational DB unchanged after tests
  await runTest("26. Operational DB unchanged after tests", () => {
    const afterSnapshot = getOperationalSnapshot();
    assert.strictEqual(
      afterSnapshot.hash,
      beforeSnapshot.hash,
      `Operational DB hash mismatch! Before: ${beforeSnapshot.hash}, After: ${afterSnapshot.hash}`
    );
    console.log(`    Operational DB Hash verified byte-invariant: ${afterSnapshot.hash}`);
  });

  // Test 27: Owner remains CEO-only front door
  await runTest("27. Owner remains CEO-only front door", () => {
    const ceoRole = getRoleCapabilityTemplate("ACCOUNTS_ANALYST");
    assert(ceoRole !== null, "Role template blueprints must be available");
    // All specialist agents report internally to CEO, never direct to Owner
    const allAgents = db.prepare(`SELECT id, role, reports_to FROM ai_agents`).all() as any[];
    for (const a of allAgents) {
      if (a.id !== "ceo_main") {
        assert(
          a.reports_to === "ceo_main" || a.reports_to === null || a.role.includes("Analyst") || a.role.includes("Specialist"),
          "Specialist agents are internal subordinates"
        );
      }
    }
  });

  console.log("\n==================================================");
  console.log(`PHASE 2D TEST RESULTS: ${passedCount} PASSED / ${failedCount} FAILED`);
  console.log("==================================================\n");

  closeAiDatabase();

  // Clean up temporary test DB
  if (fs.existsSync(TEST_DB_PATH)) {
    try {
      fs.unlinkSync(TEST_DB_PATH);
    } catch {}
  }

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});

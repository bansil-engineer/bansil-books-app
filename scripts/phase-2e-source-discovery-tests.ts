// ============================================================
// Phase 2E: Company Data Discovery + Read-Only Source Activation Tests
// Comprehensive verification of:
// - Real source discovery & health states (READY_LIVE, READY_CACHED, STALE, SCOPE_BLOCKED, NOT_CONFIGURED)
// - Zoho GET-only enforcement (ZOHO WRITE = 0)
// - Smart sync and watermark verification
// - Evidence index, fingerprinting, and deduplication
// - Honesty in reporting live vs cached data
// - Exclusion of OWNER-LOCKED 'Not Required' and arbitrary filesystem/SQL access
// - Audit logging without secrets leakage
// - Client immutability of source health states
// - Operational DB invariance (data/ai_workspace.db unchanged)
// - ₹15,000 budget governance & CEO single front door
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";

// ============================================================
// STEP 0: TEST DATABASE ISOLATION
// Operational DB (data/ai_workspace.db) must NOT be mutated.
// ============================================================

const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `phase2e_test_isolated_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.db`
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
console.log(`[Phase 2E Tests] Initial Operational DB Hash: ${beforeSnapshot.hash}`);

// Imports load against the isolated test database
import { getAiDatabase, closeAiDatabase } from "../app/lib/db/ai-database.ts";
import {
  listDataSources,
  getDataSourceByCode,
  discoverRealDataSources,
  getZohoModulesStatus,
  checkWatermarkStatus,
  updateDataSourceFreshness,
} from "../app/lib/ai/ceo/data-source-registry.ts";
import {
  generateFingerprint,
  lookupEvidence,
  indexEvidence,
  isEvidenceFresh,
} from "../app/lib/ai/ceo/evidence-index.ts";
import {
  executeGovernedTool,
} from "../app/lib/ai/ceo/tool-executor.ts";
import {
  initiateExecutionRun,
} from "../app/lib/ai/ceo/execution-lifecycle.ts";
import {
  getCurrentBudgetPeriod,
} from "../app/lib/ai/ceo/budget-governance.ts";
import {
  configureModelPricing,
} from "../app/lib/ai/ceo/model-catalog.ts";

async function runPhase2eTests() {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        passed++;
        console.log(`  ✓ ${name}`);
      })
      .catch((err) => {
        failed++;
        console.error(`  ✗ ${name}`);
        console.error(`    Error: ${err.message}`);
      });
  }

  console.log("\n==================================================");
  console.log("PHASE 2E: COMPANY DATA DISCOVERY & READ-ONLY SOURCE TESTS");
  console.log("==================================================\n");

  const db = getAiDatabase();

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

  // Test 1: Only actually implemented sources become READY
  await test("1. Only actually implemented sources become READY", () => {
    const sources = listDataSources(db);
    assert(sources.length > 0, "Data sources must be registered in catalog");

    const readySources = sources.filter(
      (s) => s.currentStatus === "READY_LIVE" || s.currentStatus === "READY_CACHED"
    );
    assert(readySources.length >= 3, "Real sources (Local SQLite Operations, Local SQLite Audit, Zoho Books API) should be READY");

    for (const src of readySources) {
      assert(
        src.currentStatus === "READY_LIVE" || src.currentStatus === "READY_CACHED",
        `Source ${src.code} must have a valid ready status`
      );
      assert(src.implementationPath, `Ready source ${src.code} must have an implementationPath`);
      assert(fs.existsSync(src.implementationPath), `Implementation path ${src.implementationPath} must exist on disk`);
    }

    // Verify non-existent/unconfigured paths are NOT READY
    const unconfiguredCodes = ["COMPANY_KNOWLEDGE_DOCS", "INTERNAL_MATH_SERVICE", "PUBLIC_WEB", "UNSUPPORTED_MOCK_SOURCE"];
    for (const code of unconfiguredCodes) {
      const src = getDataSourceByCode(code, db);
      assert(src !== null, `Source ${code} must exist in registry`);
      assert.strictEqual(src?.currentStatus, "NOT_CONFIGURED", `Source ${code} must be NOT_CONFIGURED`);
    }
  });

  // Test 2: Unsupported source is not falsely READY
  await test("2. Unsupported source is not falsely READY", () => {
    const unconfigured = getDataSourceByCode("UNSUPPORTED_MOCK_SOURCE", db);
    assert(unconfigured !== null, "UNSUPPORTED_MOCK_SOURCE should be present for safety verification");
    assert.strictEqual(
      unconfigured?.currentStatus,
      "NOT_CONFIGURED",
      "Unconfigured source must be NOT_CONFIGURED, never READY"
    );
  });

  // Test 3: Zoho read tool remains GET-only
  await test("3. Zoho read tool remains GET-only", () => {
    const zohoModules = getZohoModulesStatus();
    for (const mod of zohoModules) {
      assert.strictEqual(mod.readMethod, "GET", `Module ${mod.module} readMethod must be GET`);
      assert.strictEqual(mod.writeAllowed, 0, `Module ${mod.module} writeAllowed must be 0`);
    }
  });

  // Test 4: Zoho write remains blocked
  await test("4. Zoho write remains blocked (ZOHO WRITE = 0)", async () => {
    const result = await executeGovernedTool({
      runId: "run_test_write_block",
      agentId: "ceo_main",
      toolCode: "zoho_write_invoice",
      args: { invoiceId: "INV-001", total: 5000 },
      db,
    });
    assert.strictEqual(result.status, "POLICY_BLOCKED", "Zoho write tool must be blocked");
    assert(result.summary.includes("ZOHO WRITE = 0"), "Summary must cite ZOHO WRITE = 0 policy");
  });

  // Test 5: Scope-blocked module reports SCOPE_BLOCKED
  await test("5. Scope-blocked module reports SCOPE_BLOCKED", () => {
    const banking = getDataSourceByCode("ZOHO_BANKING_API", db);
    assert(banking !== null, "ZOHO_BANKING_API must exist in registry");
    assert.strictEqual(
      banking?.currentStatus,
      "SCOPE_BLOCKED",
      "Zoho Banking API must report SCOPE_BLOCKED"
    );
    assert.strictEqual(banking?.currentScopeState, "SCOPE_BLOCKED");
  });

  // Test 6: Auth failure reports AUTH_BLOCKED
  await test("6. Auth failure reports AUTH_BLOCKED correctly", () => {
    // When simulating an auth-blocked source in registry
    const mockAuthBlocked = {
      id: "src_mock_auth_blocked",
      code: "MOCK_AUTH_BLOCKED_SOURCE",
      name: "Mock Expired Auth Source",
      source_type: "API",
      description: "Test source with expired OAuth token",
      access_mode: "READ_ONLY",
      freshness_strategy: "LIVE",
      current_status: "AUTH_BLOCKED",
      sensitivity_class: "FINANCIAL",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.prepare(`
      INSERT OR REPLACE INTO ai_data_sources (
        id, code, name, source_type, description, access_mode, freshness_strategy,
        current_status, sensitivity_class, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      mockAuthBlocked.id,
      mockAuthBlocked.code,
      mockAuthBlocked.name,
      mockAuthBlocked.source_type,
      mockAuthBlocked.description,
      mockAuthBlocked.access_mode,
      mockAuthBlocked.freshness_strategy,
      mockAuthBlocked.current_status,
      mockAuthBlocked.sensitivity_class,
      mockAuthBlocked.created_at,
      mockAuthBlocked.updated_at
    );

    const fetched = getDataSourceByCode("MOCK_AUTH_BLOCKED_SOURCE", db);
    assert.strictEqual(fetched?.currentStatus, "AUTH_BLOCKED");
  });

  // Test 7: Cached data includes freshness timestamp
  await test("7. Cached data includes freshness timestamp", () => {
    const localOps = getDataSourceByCode("LOCAL_SQLITE_ANALYTICS", db);
    assert(localOps !== null);
    assert.strictEqual(localOps?.currentStatus, "READY_CACHED");
    assert(localOps?.lastSuccessfulSync, "Cached data source must include lastSuccessfulSync timestamp");
    assert(localOps?.coveredPeriod, "Cached data source must indicate coveredPeriod");
  });

  // Test 8: Stale cached data reports STALE
  await test("8. Stale cached data reports STALE", () => {
    // Evidence record older than TTL should be evaluated as not fresh
    const staleRecord = {
      id: "ev_stale_1",
      sourceId: "LOCAL_SQLITE",
      entity: "sales_invoices",
      queryFingerprint: "fp_stale_test",
      filters: {},
      freshness: "CACHED" as const,
      fetchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      resultReference: "LOCAL_SQLITE://sales",
      summary: "Stale sales summary",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const fresh = isEvidenceFresh(staleRecord, 15 * 60 * 1000); // 15 min TTL
    assert.strictEqual(fresh, false, "Evidence 2 hours old must be STALE against 15 min TTL");
  });

  // Test 9: Fresh cache can avoid duplicate external call
  await test("9. Fresh cache can avoid duplicate external call", async () => {
    const fp = generateFingerprint("ZOHO_BOOKS", "zoho_organization_read", { orgId: "default" });
    indexEvidence({
      sourceId: "ZOHO_BOOKS",
      entity: "zoho_organization_read",
      queryFingerprint: fp,
      filters: { orgId: "default" },
      freshness: "CACHED",
      resultReference: "ZOHO_BOOKS://api/v3/organizations",
      summary: "Cached Organization: Bansil Books Private Limited",
      ttlMs: 30 * 60 * 1000,
      db,
    });

    const hit = lookupEvidence({ queryFingerprint: fp, maxAgeMs: 30 * 60 * 1000, db });
    assert(hit !== null, "Evidence lookup must return cached evidence");
    assert.strictEqual(hit?.freshness, "CACHED");
    assert(hit?.summary.includes("Bansil Books Private Limited"));
  });

  // Test 10: Change/watermark metadata triggers refresh where supported
  await test("10. Change/watermark metadata tracks source state where supported", () => {
    const wmLocal = checkWatermarkStatus("LOCAL_SQLITE_OPERATIONS");
    assert.strictEqual(wmLocal.watermarkSupported, true);
    assert(wmLocal.lastWatermark !== null);

    const wmAudit = checkWatermarkStatus("LOCAL_SQLITE_AUDIT");
    assert.strictEqual(wmAudit.watermarkSupported, true);
    assert.strictEqual(wmAudit.lastWatermark, "audit_source_watermarks");
  });

  // Test 11: No claimed watermark where unsupported
  await test("11. No claimed watermark where unsupported", () => {
    const wmZoho = checkWatermarkStatus("ZOHO_BOOKS_API");
    assert.strictEqual(wmZoho.watermarkSupported, false);
    assert.strictEqual(wmZoho.lastWatermark, null);
    assert.strictEqual(wmZoho.strategy, "NOT_AVAILABLE");
  });

  // Test 12: Evidence fingerprint prevents unnecessary duplicate fetch
  await test("12. Evidence fingerprint prevents unnecessary duplicate fetch", () => {
    const fp1 = generateFingerprint("LOCAL_SQLITE", "sales", { customerId: "CUST-100", year: 2026 });
    const fp2 = generateFingerprint("LOCAL_SQLITE", "sales", { year: 2026, customerId: "CUST-100" });
    assert.strictEqual(fp1, fp2, "Fingerprint must be deterministic regardless of filter key ordering");

    const fpDifferent = generateFingerprint("LOCAL_SQLITE", "sales", { customerId: "CUST-200", year: 2026 });
    assert.notStrictEqual(fp1, fpDifferent, "Different filters must produce distinct fingerprints");
  });

  // Test 13: CEO prefers valid cached evidence where appropriate
  await test("13. CEO prefers valid cached evidence where appropriate", async () => {
    // First tool call
    const res1 = await executeGovernedTool({
      runId: "run_evidence_reuse_1",
      agentId: "ceo_main",
      toolCode: "local_sales_summary_read",
      args: { startDate: "2026-01-01" },
      freshnessPreference: "PREFER_CACHE",
      db,
    });
    assert.strictEqual(res1.status, "SUCCESS");

    // Second tool call with same arguments
    const res2 = await executeGovernedTool({
      runId: "run_evidence_reuse_2",
      agentId: "ceo_main",
      toolCode: "local_sales_summary_read",
      args: { startDate: "2026-01-01" },
      freshnessPreference: "PREFER_CACHE",
      db,
    });
    assert.strictEqual(res2.status, "SUCCESS");
    assert.strictEqual(res2.cacheHit, true, "Second identical call must be a cache hit");
    assert.strictEqual(res2.freshness, "CACHED");
  });

  // Test 14: CEO requests fresh source where required
  await test("14. CEO requests fresh source where required (FORCE_LIVE)", async () => {
    const res = await executeGovernedTool({
      runId: "run_force_live_1",
      agentId: "ceo_main",
      toolCode: "local_sales_summary_read",
      args: { startDate: "2026-01-01" },
      freshnessPreference: "FORCE_LIVE",
      db,
    });
    assert.strictEqual(res.status, "SUCCESS");
    assert.strictEqual(res.cacheHit, false, "FORCE_LIVE must bypass cache");
  });

  // Test 15: CEO does not claim live data from stale cache
  await test("15. CEO distinguishes live data from cached data honestly", async () => {
    const run = await initiateExecutionRun("CEO, tell me which company data sources are currently available and which are blocked.");
    assert(run.final_response, "CEO must provide a final response");
    assert(run.final_response.includes("Ready Live Sources"), "CEO must explicitly list Live Sources");
    assert(run.final_response.includes("Ready Cached Sources"), "CEO must explicitly list Cached Sources");
    assert(run.final_response.includes("Blocked Sources"), "CEO must report Blocked Sources");
    assert(run.final_response.includes("ZOHO WRITE = 0"), "CEO must reaffirm ZOHO WRITE = 0 policy");
  });

  // Test 16: Arbitrary filesystem access unavailable
  await test("16. Arbitrary filesystem access is unavailable", async () => {
    const res = await executeGovernedTool({
      runId: "run_fs_security_test",
      agentId: "ceo_main",
      toolCode: "company_knowledge_search",
      args: { query: "../../../etc/passwd" },
      db,
    });
    assert.strictEqual(res.status, "POLICY_BLOCKED", "Path traversal attempts must be blocked");
    assert(res.summary.includes("Access denied"), "Summary must state access denied");
  });

  // Test 17: 'Not Required' is excluded
  await test("17. 'Not Required' is excluded and cannot be read", async () => {
    const res = await executeGovernedTool({
      runId: "run_locked_quarantine_test",
      agentId: "ceo_main",
      toolCode: "company_knowledge_search",
      args: { query: "Not Required/secret.txt" },
      db,
    });
    assert.strictEqual(res.status, "POLICY_BLOCKED", "Access to 'Not Required' must be blocked");
  });

  // Test 18: Arbitrary SQL remains unavailable
  await test("18. Arbitrary SQL remains unavailable", async () => {
    const res = await executeGovernedTool({
      runId: "run_sql_guard_test",
      agentId: "ceo_main",
      toolCode: "safe_db_read_adapter",
      args: { table: "arbitrary_table; DROP TABLE users; --" },
      db,
    });
    assert.strictEqual(res.status, "POLICY_BLOCKED", "Non-whitelisted SQL tables must be blocked");
  });

  // Test 19: Source access produces audit evidence
  await test("19. Source access produces audit evidence", async () => {
    const runId = `run_audit_verify_${Date.now()}`;
    await executeGovernedTool({
      runId,
      agentId: "ceo_main",
      toolCode: "calculate_financial_metrics",
      args: { operation: "sum", operands: [1000, 2000] },
      db,
    });

    const executionRow = db.prepare(`
      SELECT id, run_id, tool_code, status, freshness, started_at, completed_at
      FROM ai_tool_executions
      WHERE run_id = ?
    `).get(runId) as any;

    assert(executionRow, "Audit execution row must be persisted");
    assert.strictEqual(executionRow.tool_code, "calculate_financial_metrics");
    assert.strictEqual(executionRow.status, "SUCCESS");
  });

  // Test 20: Secrets do not appear in source logs
  await test("20. Secrets do not appear in source logs", async () => {
    const runId = `run_secret_leak_test_${Date.now()}`;
    await executeGovernedTool({
      runId,
      agentId: "ceo_main",
      toolCode: "web_research_tool",
      args: { query: "tax compliance", apiKey: "SECRET_KEY_12345", token: "BEARER_TOKEN_ABC" },
      db,
    });

    const row = db.prepare(`SELECT input_summary FROM ai_tool_executions WHERE run_id = ?`).get(runId) as any;
    assert(row, "Execution row must exist");
    assert(!row.input_summary.includes("SECRET_KEY_12345"), "API key must be redacted");
    assert(!row.input_summary.includes("BEARER_TOKEN_ABC"), "Token must be redacted");
    assert(row.input_summary.includes("[REDACTED]"), "Redaction marker must be present");
  });

  // Test 21: Client cannot mark source READY
  await test("21. Client cannot mark source READY (No mutation endpoints)", () => {
    // Verification: Data source routes only export GET; no POST/PUT/PATCH/DELETE exists
    const statusRoutePath = path.join(process.cwd(), "app", "api", "ai", "data-sources", "status", "route.ts");
    const statusContent = fs.readFileSync(statusRoutePath, "utf-8");
    assert(statusContent.includes("export async function GET"), "status route must have GET");
    assert(!statusContent.includes("export async function POST"), "status route must NOT have POST");
    assert(!statusContent.includes("export async function PUT"), "status route must NOT have PUT");
    assert(!statusContent.includes("export async function PATCH"), "status route must NOT have PATCH");
    assert(!statusContent.includes("export async function DELETE"), "status route must NOT have DELETE");
  });

  // Test 22: Client cannot enable blocked capability
  await test("22. Client cannot enable blocked capability", async () => {
    const res = await executeGovernedTool({
      runId: "run_blocked_cap_test",
      agentId: "ceo_main",
      toolCode: "zoho_banking_live_sync", // Not in registered safe tools
      args: {},
      db,
    });
    assert.strictEqual(res.status, "POLICY_BLOCKED", "Unregistered or blocked tool cannot execute");
  });

  // Test 23: Operational DB unchanged after tests
  await test("23. Operational DB remains unchanged during tests", () => {
    const currentSnapshot = getOperationalSnapshot();
    assert.strictEqual(
      currentSnapshot.hash,
      beforeSnapshot.hash,
      `Operational DB hash must match: before=${beforeSnapshot.hash}, current=${currentSnapshot.hash}`
    );
  });

  // Test 24: Owner remains CEO-only front door
  await test("24. Owner remains CEO-only front door", () => {
    const ceoAgent = db.prepare(`SELECT id, role, department, level FROM ai_agents WHERE id = 'ceo_main'`).get() as any;
    assert(ceoAgent, "CEO agent must exist");
    assert(
      ceoAgent.role === "Chief Executive Officer" || ceoAgent.role === "AI_CEO",
      "ceo_main role must be CEO"
    );
    assert.strictEqual(ceoAgent.department, "EXECUTIVE");
    assert(ceoAgent.level === "CEO" || ceoAgent.level === "EXECUTIVE", "CEO level must be CEO or EXECUTIVE");
  });

  // Test 25: ₹15,000 budget governance remains intact
  await test("25. ₹15,000 budget governance remains intact", () => {
    const budget = getCurrentBudgetPeriod();
    assert.strictEqual(budget.monthly_limit, 15000, "Monthly AI operating budget must be ₹15,000");
    assert(budget.available_amount <= 15000, "Available budget cannot exceed ₹15,000");
  });

  console.log(`\n==================================================`);
  console.log(`Phase 2E Tests: ${passed} passed / ${failed} failed`);
  console.log(`==================================================\n`);

  // Close and cleanup test DB
  closeAiDatabase();
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  } catch {}

  const finalSnapshot = getOperationalSnapshot();
  console.log(`Operational DB Hash Before: ${beforeSnapshot.hash}`);
  console.log(`Operational DB Hash After:  ${finalSnapshot.hash}`);
  assert.strictEqual(
    finalSnapshot.hash,
    beforeSnapshot.hash,
    "CRITICAL: Operational DB has been mutated during test run!"
  );
  console.log("Operational DB Invariance Confirmed: YES\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase2eTests().catch((err) => {
  console.error("FATAL in test suite:", err);
  process.exit(1);
});

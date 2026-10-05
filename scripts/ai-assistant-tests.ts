// ============================================================
// Bansil Books Analytics — AI Assistant Foundation Tests
// Isolated Test Environment
// ============================================================

import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Isolate test database before importing any AI modules
const TEST_DB_PATH = path.join(os.tmpdir(), `ai_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`);
process.env.AI_WORKSPACE_DB_PATH = TEST_DB_PATH;

import { routeQueryToAgent } from "../app/lib/ai/agent-router";
import { evaluateSafetyGate } from "../app/lib/ai/safety-gate";
import { closeAiDatabase } from "../app/lib/db/ai-database";

async function runAiTests() {
  console.log("=== RUNNING AI FOUNDATION TESTS (ISOLATED TEST DB) ===");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
      failed++;
    }
  }

  try {
    // 1. General chat routes to GENERAL_ASSISTANT
    assert(routeQueryToAgent("how are you today") === "GENERAL_ASSISTANT", "General chat routes correctly");

    // 2. Sales question routes correctly
    assert(routeQueryToAgent("show me the latest invoice") === "SALES_ANALYST", "Sales question routes correctly");

    // 3. Purchase question routes correctly
    assert(routeQueryToAgent("how much did we pay the vendor") === "PURCHASE_ANALYST", "Purchase question routes correctly");

    // 4. Accounts question routes correctly
    assert(routeQueryToAgent("show the P&L") === "ACCOUNTS_ANALYST", "Accounts question routes correctly");

    // 5. Company knowledge query routes correctly
    assert(routeQueryToAgent("what is the company policy on this") === "COMPANY_KNOWLEDGE", "Company knowledge query routes correctly");

    // 6. Web research query routes correctly
    assert(routeQueryToAgent("search web for latest news") === "WEB_RESEARCH", "Web research query routes correctly");

    // 7. READ_ONLY tool can pass safety gate
    const readOnlySafety = evaluateSafetyGate("READ_ONLY");
    assert(readOnlySafety.allowed === true && readOnlySafety.requiresApproval === false, "READ_ONLY tool passes safety gate");

    // 8. EXTERNAL_WRITE requires approval
    const extWriteSafety = evaluateSafetyGate("EXTERNAL_WRITE");
    assert(extWriteSafety.allowed === false && extWriteSafety.requiresApproval === true, "EXTERNAL_WRITE requires approval");

    // 9. HIGH_RISK requires approval
    const highRiskSafety = evaluateSafetyGate("HIGH_RISK");
    assert(highRiskSafety.allowed === false && highRiskSafety.requiresApproval === true, "HIGH_RISK requires approval");

    // 10. ZOHO_WRITE is blocked
    const zohoWriteSafety = evaluateSafetyGate("ZOHO_WRITE");
    assert(zohoWriteSafety.allowed === false && zohoWriteSafety.requiresApproval === false, "ZOHO_WRITE is strictly blocked");

    console.log(`\nTest Summary: ${passed} Passed, ${failed} Failed`);

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    closeAiDatabase();
    try {
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
      if (fs.existsSync(TEST_DB_PATH + "-wal")) fs.unlinkSync(TEST_DB_PATH + "-wal");
      if (fs.existsSync(TEST_DB_PATH + "-shm")) fs.unlinkSync(TEST_DB_PATH + "-shm");
    } catch {}
  }
}

runAiTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

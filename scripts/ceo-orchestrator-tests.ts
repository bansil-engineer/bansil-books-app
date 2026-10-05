// ============================================================
// Bansil Books Analytics — CEO Orchestrator Tests
// Isolated Test DB Suite
// ============================================================

import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Isolate test database before importing DB modules
const TEST_DB_PATH = path.join(os.tmpdir(), `ceo_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`);
process.env.AI_WORKSPACE_DB_PATH = TEST_DB_PATH;

import { executeCeoOrchestration } from "../app/lib/ai/ceo/ceo-orchestrator";
import { evaluateSafetyGate } from "../app/lib/ai/safety-gate";
import { checkInheritanceRules } from "../app/lib/ai/ceo/permission-policy";
import { AiAgentConfig, AgentLevel } from "../app/lib/ai/ceo/ceo-types";
import { getAiDatabase, closeAiDatabase } from "../app/lib/db/ai-database";
import { configureModelPricing } from "../app/lib/ai/ceo/model-catalog";

async function runCeoTests() {
  console.log("=== RUNNING CEO ORCHESTRATION TESTS (ISOLATED TEST DB) ===");

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
    // Initialize isolated test DB and configure test model pricing
    getAiDatabase();
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

    // 1. Simple request direct answer
    const res1 = await executeCeoOrchestration("What is the time?", "run_1", []);
    assert(res1.startsWith("CEO:") || res1.startsWith("CEO Notice:") || res1.startsWith("CEO Orchestrator:"), "Simple request answered by CEO voice");

    // 2. Complex request delegates to multiple tasks
    const res2 = await executeCeoOrchestration("Check profitability of Project A", "run_2", []);
    assert(res2.includes("CEO Orchestrator: I have broken down your request"), "Complex request creates internal tasks");

    // 3. New agent cannot exceed parent permissions
    const ceoAgent: AiAgentConfig = {
      id: "ceo_1", name: "AI CEO", role: "CEO", department: "EXECUTIVE", level: "CEO",
      reports_to: null, status: "ACTIVE", capabilities: [], allowed_tools: ["ALL"], denied_tools: ["ZOHO_WRITE"],
      risk_class: "LOW", created_by: "SYSTEM", created_at: "", updated_at: ""
    };

    const vpAgent: AiAgentConfig = {
      id: "vp_1", name: "Finance VP", role: "VP", department: "FINANCE", level: "VP",
      reports_to: "ceo_1", status: "ACTIVE", capabilities: [], allowed_tools: ["READ_ONLY"], denied_tools: [],
      risk_class: "LOW", created_by: "CEO", created_at: "", updated_at: ""
    };

    const maliciousAgent: AiAgentConfig = {
      ...vpAgent, id: "bad_1", level: "VP", created_by: "CEO"
    };
    try {
      checkInheritanceRules(vpAgent, maliciousAgent);
      assert(false, "Agent cannot self-escalate level");
    } catch (e: any) {
      assert(e.message.includes("Permission Escalation Blocked"), "Agent cannot self-escalate level");
    }

    // 4. New agent cannot receive Zoho write
    const badZohoAgent: AiAgentConfig = {
      ...vpAgent, id: "bad_2", level: "MANAGER", allowed_tools: ["ZOHO_WRITE"]
    };
    try {
      checkInheritanceRules(ceoAgent, badZohoAgent);
      assert(false, "New agent cannot receive ZOHO_WRITE");
    } catch (e: any) {
      assert(e.message.includes("ZOHO_WRITE"), "New agent cannot receive ZOHO_WRITE");
    }

    // 5. External write requires human approval
    const extWriteSafety = evaluateSafetyGate("EXTERNAL_WRITE");
    assert(extWriteSafety.allowed === false && extWriteSafety.requiresApproval === true, "EXTERNAL_WRITE requires human approval");

    // 6. Generic approval does NOT unblock ZOHO_WRITE
    const zohoWriteSafety = evaluateSafetyGate("ZOHO_WRITE");
    assert(zohoWriteSafety.allowed === false && zohoWriteSafety.requiresApproval === false, "ZOHO_WRITE remains permanently blocked");

    // Output test summary
    console.log(`\nTest Summary: ${passed} Passed, ${failed} Failed`);

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    // Teardown isolated test database
    closeAiDatabase();
    try {
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
      if (fs.existsSync(TEST_DB_PATH + "-wal")) fs.unlinkSync(TEST_DB_PATH + "-wal");
      if (fs.existsSync(TEST_DB_PATH + "-shm")) fs.unlinkSync(TEST_DB_PATH + "-shm");
    } catch {}
  }
}

runCeoTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

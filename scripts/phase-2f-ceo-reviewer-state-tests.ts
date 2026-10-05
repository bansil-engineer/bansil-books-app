import * as assert from "assert";
import {
  assertOperationalDbsUnchanged,
  assertPathIsolated,
  isolateTestDatabases,
  snapshotOperationalHashes,
} from "./test-db-isolation";

// Test isolation: every DB resolver points at a unique temp dir BEFORE any app
// module is imported (app modules are loaded dynamically inside runTests).
const ISO = isolateTestDatabases("phase2f");
const OPERATIONAL_BEFORE = snapshotOperationalHashes();
process.on("exit", () => ISO.cleanup());

async function runTests() {
  const { getAiDatabase: getDb, getDbFilePath, closeAiDatabase } = await import("../app/lib/db/ai-database");
  const { handleOwnerMessage } = await import("../app/lib/ai/ceo/ceo-orchestrator");
  assertPathIsolated(getDbFilePath(), ISO, "AI workspace DB");

  const db = getDb();
  const nowIso = new Date().toISOString();

  console.log("Setting up model cost catalog...");
  db.exec("DELETE FROM model_cost_catalog");
  const insert = db.prepare(`
    INSERT INTO model_cost_catalog (
      id, provider, model, tier, input_cost_basis, output_cost_basis, fixed_call_cost, status, enabled, notes, effective_from
    ) VALUES (?, ?, ?, ?, ?, ?, 0.0, ?, 1, ?, ?)
  `);
  const miniNotes = "Configured provider pricing.";
  insert.run("cost_gpt4o_mini", "OpenAI", "gpt-4o-mini", "FAST", 0.0126, 0.0504, "ESTIMATED", miniNotes, nowIso);
  insert.run("cost_reviewer", "OpenAI", "gpt-4o-mini", "REVIEWER", 0.0126, 0.0504, "ESTIMATED", miniNotes, nowIso);
  insert.run("cost_gpt4o", "OpenAI", "gpt-4o", "STANDARD", 0.0, 0.0, "CONFIG_REQUIRED", "Capability tier STANDARD", nowIso);

  console.log("Test 1: Balance Sheet analysis executes correctly with reviewer");
  const response1 = await handleOwnerMessage("analise fy 2025-26 balance sheet", [], { priority: "NORMAL", riskClass: "STANDARD" });
  assert.ok(response1.runId, "runId should be returned");
  let run = db.prepare("SELECT * FROM ai_runs WHERE id = ?").get(response1.runId) as any;
  assert.strictEqual(run.status, "COMPLETED", "Status should be COMPLETED");
  assert.strictEqual(run.reviewer_required, 1, "Reviewer should be required");
  assert.strictEqual(run.reviewer_status, "REVIEWED_AND_VERIFIED", "Reviewer status should be VERIFIED");
  assert.ok(response1.content.includes("FY2025-26 BALANCE SHEET REVIEW"), "Should return Balance Sheet result");

  console.log("Test 2: CONFIG_REQUIRED blocks execution with BLOCKED status");
  db.exec("DELETE FROM model_cost_catalog");
  insert.run("cost_gpt4o_blocked", "OpenAI", "gpt-4o", "STANDARD", 0.0, 0.0, "CONFIG_REQUIRED", "Capability tier STANDARD", nowIso);
  insert.run("cost_gpt4o_mini_blocked", "OpenAI", "gpt-4o-mini", "FAST", 0.0, 0.0, "CONFIG_REQUIRED", "Unconfigured", nowIso);
  insert.run("cost_reviewer_blocked", "OpenAI", "gpt-4o-mini", "REVIEWER", 0.0, 0.0, "CONFIG_REQUIRED", "Unconfigured", nowIso);

  const response2 = await handleOwnerMessage("analise fy 2025-26 balance sheet", [], { priority: "NORMAL", riskClass: "STANDARD" });
  run = db.prepare("SELECT * FROM ai_runs WHERE id = ?").get(response2.runId) as any;
  assert.strictEqual(run.status, "BLOCKED", "Status should be BLOCKED");
  assert.ok(run.failure_reason.includes("COST_CONFIG_REQUIRED"), "Failure reason should reflect missing config");

  console.log("Test 3: Approval required action triggers WAITING_OWNER");
  db.exec("DELETE FROM model_cost_catalog");
  insert.run("cost_gpt4o_mini2", "OpenAI", "gpt-4o-mini", "FAST", 0.0126, 0.0504, "ESTIMATED", miniNotes, nowIso);
  insert.run("cost_reviewer2", "OpenAI", "gpt-4o-mini", "REVIEWER", 0.0126, 0.0504, "ESTIMATED", miniNotes, nowIso);
  insert.run("cost_gpt4o2", "OpenAI", "gpt-4o", "STANDARD", 0.0, 0.0, "CONFIG_REQUIRED", "Capability tier STANDARD", nowIso);

  const response3 = await handleOwnerMessage("review and approve payment to vendor X", [], { priority: "NORMAL", riskClass: "STANDARD" });
  run = db.prepare("SELECT * FROM ai_runs WHERE id = ?").get(response3.runId) as any;
  assert.strictEqual(run.status, "WAITING_OWNER", "Status should be WAITING_OWNER");
  assert.strictEqual(run.owner_approval_required, 1, "Owner approval flag should be set");

  closeAiDatabase();
  assertOperationalDbsUnchanged(OPERATIONAL_BEFORE, "phase-2f");
  console.log("All tests passed!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exitCode = 1;
});

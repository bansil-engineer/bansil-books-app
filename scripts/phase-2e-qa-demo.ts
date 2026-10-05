// ============================================================
// Phase 2E QA Demonstration Script
// Demonstrates Owner Question:
// "CEO, tell me which company data sources are currently available and which are blocked."
// Response is grounded in real discovered source metadata.
// Uses isolated QA database to preserve operational DB.
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert";

const QA_DB_PATH = path.join(
  os.tmpdir(),
  `phase2e_qa_isolated_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.db`
);
process.env.AI_WORKSPACE_DB_PATH = QA_DB_PATH;

const OPERATIONAL_DB_PATH = path.join(process.cwd(), "data", "ai_workspace.db");
function getOpHash() {
  if (!fs.existsSync(OPERATIONAL_DB_PATH)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(OPERATIONAL_DB_PATH)).digest("hex");
}
const hashBefore = getOpHash();

import { getAiDatabase, closeAiDatabase } from "../app/lib/db/ai-database.ts";
import { initiateExecutionRun } from "../app/lib/ai/ceo/execution-lifecycle.ts";
import { discoverRealDataSources, getZohoModulesStatus } from "../app/lib/ai/ceo/data-source-registry.ts";
import { configureModelPricing } from "../app/lib/ai/ceo/model-catalog.ts";

async function runQaDemo() {
  console.log("==================================================");
  console.log("PHASE 2E QA DEMONSTRATION");
  console.log("==================================================\n");

  const db = getAiDatabase();

  // Configure test model pricing for isolated test DB
  configureModelPricing({
    id: "cost_gpt4o_mini",
    input_cost_basis: 0.015,
    output_cost_basis: 0.06,
    fixed_call_cost: 0.05,
    status: "ESTIMATED",
    notes: "QA configured pricing for gpt-4o-mini",
  });
  configureModelPricing({
    id: "cost_gpt4o",
    input_cost_basis: 0.25,
    output_cost_basis: 1.0,
    fixed_call_cost: 0.50,
    status: "ESTIMATED",
    notes: "QA configured pricing for gpt-4o",
  });

  console.log("1. Direct Source Discovery Inspection:");
  const report = discoverRealDataSources(db);
  console.log(`  Total Registered Sources: ${report.totalSources}`);
  console.log(`  Ready Live Sources:       ${report.readyLiveCount}`);
  console.log(`  Ready Cached Sources:     ${report.readyCachedCount}`);
  console.log(`  Scope Blocked Sources:    ${report.scopeBlockedCount}`);
  console.log(`  Not Configured Sources:   ${report.notConfiguredCount}`);

  console.log("\n2. Zoho Books Read-Only Module Status Table:");
  const zohoMods = getZohoModulesStatus();
  console.table(
    zohoMods.map((m) => ({
      Module: m.module,
      Implemented: m.implemented ? "YES" : "NO",
      "Current Access": m.currentAccess,
      "Read Method": m.readMethod,
      "Write Allowed": m.writeAllowed,
      "Covered Period / Note": m.coveredPeriod || "N/A",
    }))
  );

  console.log("\n3. Owner Ask CEO:");
  const prompt = "CEO, tell me which company data sources are currently available and which are blocked.";
  console.log(`  Owner: "${prompt}"\n`);

  const run = await initiateExecutionRun(prompt);

  console.log("4. CEO Response (Based on Real Discovered Metadata):");
  console.log("--------------------------------------------------");
  console.log(run.final_response);
  console.log("--------------------------------------------------");

  assert(run.final_response, "CEO response must not be empty");
  assert(run.final_response.includes("Ready Live Sources"), "Must specify Ready Live Sources");
  assert(run.final_response.includes("Ready Cached Sources"), "Must specify Ready Cached Sources");
  assert(run.final_response.includes("Blocked Sources"), "Must specify Blocked Sources");
  assert(run.final_response.includes("ZOHO WRITE = 0"), "Must cite ZOHO WRITE = 0");

  closeAiDatabase();
  try {
    if (fs.existsSync(QA_DB_PATH)) fs.unlinkSync(QA_DB_PATH);
  } catch {}

  const hashAfter = getOpHash();
  assert.strictEqual(hashBefore, hashAfter, "Operational DB must remain unchanged!");
  console.log(`\nOperational DB Invariance Confirmed (SHA256: ${hashAfter})`);
  console.log("Phase 2E QA Demonstration Completed Successfully.\n");
}

runQaDemo().catch((err) => {
  console.error("QA Demo Failed:", err);
  process.exit(1);
});

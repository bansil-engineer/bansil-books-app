// ============================================================
// Phase 2D: Safe QA Demo
// Demonstrates CEO handling Owner objective:
// "CEO, prepare a read-only analysis plan for sales versus purchase."
// Runs against strictly isolated temporary database.
// ============================================================

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert";

// STEP 0: ISOLATION
const QA_DB_PATH = path.join(
  os.tmpdir(),
  `phase2d_qa_demo_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.db`
);
process.env.AI_WORKSPACE_DB_PATH = QA_DB_PATH;

const OPERATIONAL_DB_PATH = path.join(process.cwd(), "data", "ai_workspace.db");
function getOperationalHash() {
  if (!fs.existsSync(OPERATIONAL_DB_PATH)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(OPERATIONAL_DB_PATH)).digest("hex");
}

const opHashBefore = getOperationalHash();

import { getAiDatabase, closeAiDatabase } from "../app/lib/db/ai-database.ts";
import {
  initiateExecutionRun,
  identifyRequiredCapabilities,
  getExecutionRun,
  getRunTasks,
} from "../app/lib/ai/ceo/execution-lifecycle.ts";
import { executeGovernedTool } from "../app/lib/ai/ceo/tool-executor.ts";
import { listCapabilities, getAgentCapabilities } from "../app/lib/ai/ceo/capability-registry.ts";
import { listTools } from "../app/lib/ai/ceo/safe-tool-registry.ts";
import { listDataSources } from "../app/lib/ai/ceo/data-source-registry.ts";

async function runDemo() {
  console.log("==================================================");
  console.log("PHASE 2D SAFE QA DEMO: READ-ONLY CAPABILITY & TOOL ONBOARDING");
  console.log("==================================================");
  console.log(`[QA Demo Setup] Isolated DB: ${QA_DB_PATH}`);
  console.log(`[QA Demo Setup] Operational DB Hash: ${opHashBefore}`);

  const db = getAiDatabase();

  const objective = "CEO, prepare a read-only analysis plan for sales versus purchase.";
  console.log(`\nOwner Objective: "${objective}"`);

  // 1. Identify capabilities
  const identifiedCaps = identifyRequiredCapabilities(objective);
  console.log("\n1. CAPABILITY REQUIREMENTS IDENTIFIED BY CEO:");
  identifiedCaps.forEach(c => console.log(`   - ${c}`));

  // 2. Initiate execution lifecycle run
  const run = await initiateExecutionRun(objective, {
    conversationId: "conv_qa_demo_001",
    userIdentifier: "Owner",
    priority: "HIGH",
  });

  console.log(`\n2. CEO EXECUTION RUN INITIATED:`);
  console.log(`   Run ID: ${run.id}`);
  console.log(`   Status: ${run.status}`);
  console.log(`   Orchestrator: ${run.selected_agent}`);
  console.log(`   Model Tier: ${run.selected_model_tier}`);

  // 3. Inspect generated tasks and workforce assignments
  const tasks = getRunTasks(run.id, db);
  console.log(`\n3. WORKFORCE TASKS & AGENT SELECTION (${tasks.length} tasks generated):`);
  for (const t of tasks) {
    const agentCaps = t.assigned_agent_id ? getAgentCapabilities(t.assigned_agent_id, db).map(c => c.capabilityCode) : [];
    console.log(`   [Task ${t.id}] ${t.title}`);
    console.log(`     Assigned Agent: ${t.assigned_agent_id} (${t.department})`);
    console.log(`     Agent Active Capabilities: ${agentCaps.join(", ") || "STANDARD"}`);
  }

  // 4. Execute governed safe read-only tools
  console.log("\n4. SAFE READ-ONLY TOOL EXECUTION VIA 10-POINT GOVERNED GATE:");

  const salesToolResult = await executeGovernedTool({
    runId: run.id,
    agentId: "ceo_main",
    toolCode: "local_sales_summary_read",
    args: { startDate: "2026-01-01" },
    db,
  });
  console.log(`   Tool: local_sales_summary_read`);
  console.log(`     Gate Status: ${salesToolResult.status}`);
  console.log(`     Classification: ${salesToolResult.classification}`);
  console.log(`     Freshness: ${salesToolResult.freshness}`);
  console.log(`     Source: ${salesToolResult.evidence?.source}`);
  console.log(`     Summary: ${salesToolResult.summary}`);

  const purchaseToolResult = await executeGovernedTool({
    runId: run.id,
    agentId: "ceo_main",
    toolCode: "local_purchase_summary_read",
    args: { startDate: "2026-01-01" },
    db,
  });
  console.log(`\n   Tool: local_purchase_summary_read`);
  console.log(`     Gate Status: ${purchaseToolResult.status}`);
  console.log(`     Classification: ${purchaseToolResult.classification}`);
  console.log(`     Freshness: ${purchaseToolResult.freshness}`);
  console.log(`     Source: ${purchaseToolResult.evidence?.source}`);
  console.log(`     Summary: ${purchaseToolResult.summary}`);

  // 5. Deduplication verification within run
  console.log("\n5. DEMONSTRATING TOOL CALL DEDUPLICATION (SMART EVIDENCE REUSE):");
  const repeatSalesResult = await executeGovernedTool({
    runId: run.id,
    agentId: "ceo_main",
    toolCode: "local_sales_summary_read",
    args: { startDate: "2026-01-01" },
    freshnessPreference: "PREFER_CACHE",
    db,
  });
  console.log(`   Repeat Call Cache Hit: ${repeatSalesResult.cacheHit}`);
  console.log(`   Freshness: ${repeatSalesResult.freshness}`);
  console.log(`   Summary: ${repeatSalesResult.summary}`);

  // 6. Security verification: attempt blocked Zoho write tool
  console.log("\n6. DEMONSTRATING HARD SECURITY GATE (ZOHO WRITE = 0):");
  const blockedZohoWrite = await executeGovernedTool({
    runId: run.id,
    agentId: "ceo_main",
    toolCode: "zoho_invoice_create",
    args: { invoice_number: "INV-999" },
    db,
  });
  console.log(`   Tool: zoho_invoice_create`);
  console.log(`   Gate Status: ${blockedZohoWrite.status} (PERMANENTLY BLOCKED)`);
  console.log(`   Reason: ${blockedZohoWrite.error}`);

  // 7. Verify Operational DB Hash Invariance
  const opHashAfter = getOperationalHash();
  console.log(`\n7. OPERATIONAL DATABASE INVARIANCE CHECK:`);
  console.log(`   Hash Before: ${opHashBefore}`);
  console.log(`   Hash After:  ${opHashAfter}`);
  assert.strictEqual(opHashBefore, opHashAfter, "Operational DB must remain byte-invariant!");
  console.log(`   Byte-Invariant: YES (100% unmutated)`);

  console.log("\n==================================================");
  console.log("SAFE QA DEMO COMPLETED SUCCESSFULLY");
  console.log("==================================================");

  closeAiDatabase();
  try {
    if (fs.existsSync(QA_DB_PATH)) fs.unlinkSync(QA_DB_PATH);
  } catch {}
}

runDemo().catch(err => {
  console.error("QA Demo failed:", err);
  process.exit(1);
});

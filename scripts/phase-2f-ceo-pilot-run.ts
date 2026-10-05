// ============================================================
// Phase 2F: First Real CEO Business Operation Pilot Execution Script
// Runs the Owner's real business objective through AI CEO lifecycle
// ============================================================

import { getAiDatabase } from "../app/lib/db/ai-database.ts";
import { initiateExecutionRun, getExecutionRun } from "../app/lib/ai/ceo/execution-lifecycle.ts";
import { getCurrentBudgetPeriod } from "../app/lib/ai/ceo/budget-governance.ts";
import { listAgents } from "../app/lib/ai/ceo/agent-registry.ts";
import { listTasksForRun } from "../app/lib/ai/ceo/task-coordinator.ts";
import { configureModelPricing } from "../app/lib/ai/ceo/model-catalog.ts";

async function main() {
  console.log("==================================================");
  console.log("PHASE 2F: REAL OPERATIONAL AI CEO PILOT RUN");
  console.log("==================================================");

  const db = getAiDatabase();

  // Configure operational model pricing for pilot within ₹15,000 budget (simulation estimates)
  configureModelPricing({
    id: "cost_gpt4o_mini",
    input_cost_basis: 0.15,
    output_cost_basis: 0.60,
    fixed_call_cost: 0.50,
    status: "ESTIMATED",
    notes: "Operational simulation estimate for subtask routines; not authoritative provider billing",
  });

  configureModelPricing({
    id: "cost_gpt4o",
    input_cost_basis: 2.50,
    output_cost_basis: 10.00,
    fixed_call_cost: 2.00,
    status: "ESTIMATED",
    notes: "Operational simulation estimate for synthesis; not authoritative provider billing",
  });

  // 1. Initial State Check
  const budgetBefore = getCurrentBudgetPeriod();
  const agentsBefore = listAgents();
  console.log(`[Operational State Before Run]`);
  console.log(`• Monthly AI Budget: ₹${budgetBefore.monthly_limit.toLocaleString("en-IN")}`);
  console.log(`• Available Budget:  ₹${budgetBefore.available_amount.toLocaleString("en-IN")}`);
  console.log(`• Committed Budget:  ₹${budgetBefore.committed_amount.toLocaleString("en-IN")}`);
  console.log(`• Consumed Budget:   ₹${budgetBefore.consumed_amount.toLocaleString("en-IN")}`);
  console.log(`• Existing Workforce Count: ${agentsBefore.length} (${agentsBefore.map(a => `${a.name} [${a.id}]`).join(", ")})`);

  // 2. The Owner's exact prompt
  const ownerObjective = "CEO, analyze our Sales versus Purchase performance using the latest verified company data available to you. Show me the management-level picture, important trends, major gaps or risks, and what needs deeper investigation. Use read-only data only. Do not make or post any accounting, inventory, payment, or Zoho changes.";

  console.log("\n[Owner Objective Initiated]");
  console.log(`"${ownerObjective}"\n`);

  const runStartTime = Date.now();
  const run = await initiateExecutionRun(ownerObjective, {
    priority: "HIGH",
    riskClass: "STANDARD",
  });
  const durationMs = Date.now() - runStartTime;

  console.log("==================================================");
  console.log("PILOT EXECUTION COMPLETE");
  console.log("==================================================");
  console.log(`• Run ID: ${run.id}`);
  console.log(`• Run Status: ${run.status}`);
  console.log(`• Selected Model Tier: ${run.selected_model_tier}`);
  console.log(`• Selected Model: ${run.selected_model}`);
  console.log(`• Execution Time: ${durationMs}ms`);
  console.log(`• Step Count: ${run.step_count}`);
  console.log(`• Reviewer Triggered: ${run.reviewer_required ? "YES" : "NO"} (Status: ${run.reviewer_status || "N/A"})`);
  console.log(`• Actual AI Cost: ₹${run.actual_cost?.toFixed(2) || "0.00"}`);

  // 3. Inspect Tasks and Workforce Resolution
  const tasks = listTasksForRun(run.id);
  console.log(`\n[Tasks Executed in Run (${tasks.length} total)]`);
  for (const t of tasks) {
    console.log(`  - [${t.status}] ${t.department}: "${t.objective}"`);
    console.log(`    Assigned Agent: ${t.assigned_agent_id} | Cost: ₹${t.actual_cost?.toFixed(2) || "0.00"}`);
  }

  // 4. Workforce Resolution Check
  const agentsAfter = listAgents();
  console.log(`\n[Workforce Status After Run]`);
  console.log(`• Total Agents Now: ${agentsAfter.length}`);
  const reusedAgents: string[] = [];
  const createdAgents: string[] = [];
  for (const agent of agentsAfter) {
    const wasBefore = agentsBefore.some(a => a.id === agent.id);
    if (wasBefore) {
      reusedAgents.push(`${agent.name} (${agent.id})`);
    } else {
      createdAgents.push(`${agent.name} (${agent.id})`);
    }
  }
  console.log(`• Agents Reused: ${reusedAgents.join(", ") || "None"}`);
  console.log(`• Agents Created: ${createdAgents.join(", ") || "None"}`);

  // 5. Audit Events
  const auditEvents = db.prepare(`SELECT event_type, details, created_at FROM ai_audit_events WHERE run_id = ? ORDER BY created_at ASC`).all(run.id) as any[];
  console.log(`\n[Audit Trail Events (${auditEvents.length})]`);
  for (const ev of auditEvents) {
    console.log(`  [${ev.event_type}] ${ev.details}`);
  }

  // 6. Evidence and Tool Executions
  const toolExecs = db.prepare(`SELECT tool_code, status, freshness, result_summary, evidence_reference FROM ai_tool_executions WHERE run_id = ? ORDER BY started_at ASC`).all(run.id) as any[];
  console.log(`\n[Governed Safe Tool Executions (${toolExecs.length})]`);
  for (const te of toolExecs) {
    console.log(`  - [${te.status}] ${te.tool_code} (${te.freshness}): ${te.result_summary}`);
    console.log(`    Evidence Reference: ${te.evidence_reference}`);
  }

  // 7. Budget State After Run
  const budgetAfter = getCurrentBudgetPeriod();
  console.log(`\n[Budget State After Run]`);
  console.log(`• Monthly AI Limit: ₹${budgetAfter.monthly_limit.toLocaleString("en-IN")}`);
  console.log(`• Consumed This Period: ₹${budgetAfter.consumed_amount.toFixed(2)}`);
  console.log(`• Committed Active:  ₹${budgetAfter.committed_amount.toFixed(2)}`);
  console.log(`• Remaining Budget:  ₹${budgetAfter.available_amount.toFixed(2)}`);

  // 8. Candidate Memories Generated
  const candidateMemories = db.prepare(`SELECT title, authority_level, status, confidence FROM ai_memory_entries WHERE source_reference = ?`).all(run.id) as any[];
  console.log(`\n[Candidate Learning Memories Generated (${candidateMemories.length})]`);
  for (const cm of candidateMemories) {
    console.log(`  - [${cm.status} | ${cm.authority_level} | conf: ${cm.confidence}] ${cm.title}`);
  }

  // 9. Final CEO Owner-Facing Response
  console.log("\n==================================================");
  console.log("FINAL CEO OWNER-FACING REPORT");
  console.log("==================================================");
  console.log(run.final_response);
}

main().catch((err) => {
  console.error("Pilot execution failed:", err);
  process.exit(1);
});

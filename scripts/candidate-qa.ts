/**
 * Application QA using the clean candidate DB.
 * Verifies: CEO opens, new run created, tasks persist, agent reuse, balance sheet tool, budget gate.
 */
import path from "node:path";
import os from "node:os";

const CANDIDATE_PATH = path.join(process.cwd(), "data", "ai_workspace.clean_candidate.db");
process.env.AI_WORKSPACE_DB_PATH = CANDIDATE_PATH;

import { getAiDatabase } from "../app/lib/db/ai-database.ts";
import { executeGovernedTool } from "../app/lib/ai/ceo/tool-executor.ts";
import { initiateExecutionRun, getRunTasks, getExecutionRun } from "../app/lib/ai/ceo/execution-lifecycle.ts";

async function runQA() {
  console.log("\n=== APPLICATION QA: CANDIDATE DB ===");
  console.log(`Candidate: ${CANDIDATE_PATH}\n`);

  let passed = 0;
  let failed = 0;

  function check(name: string, condition: boolean, detail = "") {
    if (condition) {
      console.log(`  ✓ ${name}${detail ? ": " + detail : ""}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${name}${detail ? ": " + detail : ""}`);
      failed++;
    }
  }

  const db = getAiDatabase();

  // 1. AI CEO workspace DB opens
  check("AI CEO workspace DB opens", !!db);

  // 2. All 5 agents exist
  const agents = db.prepare("SELECT id, department FROM ai_agents").all() as any[];
  check("5 agents (full workforce)", agents.length === 5, `found: ${agents.map(a => a.id).join(", ")}`);

  // 3. Accounts agent exists
  const accountsAgent = agents.find(a => a.id === "agent_accounts_accounts_auditor_001");
  check("Accounts Auditor agent exists", !!accountsAgent);

  // 4. Financial Reviewer exists
  const reviewerAgent = agents.find(a => a.id === "agent_finance_financial_reviewer_001");
  check("Financial Reviewer agent exists", !!reviewerAgent);

  // 5. Conversations imported
  const convCount = (db.prepare("SELECT count(*) as c FROM ai_conversations").get() as any).c;
  check("Conversations imported (33)", convCount === 33, `got ${convCount}`);

  // 6. Messages imported
  const msgCount = (db.prepare("SELECT count(*) as c FROM ai_messages").get() as any).c;
  check("Messages imported (42)", msgCount === 42, `got ${msgCount}`);

  // 7. Balance sheet tool registered
  const bsTool = db.prepare("SELECT * FROM ai_tools WHERE code = 'local_balance_sheet_derived_read'").get() as any;
  check("local_balance_sheet_derived_read registered", !!bsTool);
  check("Balance sheet tool is READ_ONLY", bsTool?.tool_class === "READ_ONLY", `class: ${bsTool?.tool_class}`);

  // 8. No broken run/task history imported
  const runCount = (db.prepare("SELECT count(*) as c FROM ai_runs").get() as any).c;
  const taskCount = (db.prepare("SELECT count(*) as c FROM ai_tasks").get() as any).c;
  check("No old broken runs imported", runCount === 0, `runs: ${runCount}`);
  check("No old broken tasks imported", taskCount === 0, `tasks: ${taskCount}`);

  // 9. Budget period correct
  const period = db.prepare("SELECT * FROM ai_budget_periods ORDER BY period_start DESC LIMIT 1").get() as any;
  check("Budget period exists", !!period);
  check("Monthly limit is ₹15,000", period?.monthly_limit === 15000, `limit: ${period?.monthly_limit}`);

  // 10. New run can be created — balance sheet analysis
  console.log("\n  --- Running QA: balance sheet analysis ---");
  const bsRun = await initiateExecutionRun("analise FY 2025-26 balance sheet");
  check("New run created", !!bsRun?.id, `runId: ${bsRun?.id}`);
  const newRunId = bsRun?.id;

  const newTasks = getRunTasks(newRunId);
  const newTaskCount = newTasks.length;
  check("New run has tasks", newTaskCount > 0, `task count: ${newTaskCount}`);
  check("Accounts agent task exists", newTasks.some(t => t.department === "ACCOUNTS"), `tasks: ${newTasks.map(t => t.department).join(",")}`);
  check("Financial reviewer task exists", newTasks.some(t => t.department === "FINANCE"), `tasks: ${newTasks.map(t => t.department).join(",")}`);

  // 11. REFRESH PERSISTENCE: Re-fetch run by ID to simulate page refresh
  console.log("\n  --- Refresh persistence check ---");
  const refetchedRun = getExecutionRun(newRunId);
  check("Refresh restores same run", refetchedRun?.id === newRunId, `refetched: ${refetchedRun?.id}`);
  
  const refetchedTasks = getRunTasks(newRunId);
  check("Refresh restores same task count", refetchedTasks.length === newTaskCount, `tasks after refresh: ${refetchedTasks.length}`);
  
  // No duplicate check (no new run created on refresh)
  const totalRuns = (db.prepare("SELECT count(*) as c FROM ai_runs").get() as any).c;
  check("No duplicate run on refresh", totalRuns === 1, `total runs: ${totalRuns}`);
  
  const totalTasks = (db.prepare("SELECT count(*) as c FROM ai_tasks").get() as any).c;
  check("No duplicate tasks on refresh", totalTasks === newTaskCount, `total tasks: ${totalTasks}`);

  // 12. Balance sheet tool executes
  console.log("\n  --- Balance sheet tool QA ---");
  const toolResult = await executeGovernedTool({
    runId: newRunId,
    agentId: "ceo_main",
    toolCode: "local_balance_sheet_derived_read",
    args: { asOfDate: "2026-03-31" }
  });
  check("Balance sheet tool executes", toolResult.status === "SUCCESS" || toolResult.status === "CACHED", `status: ${toolResult.status}`);
  check("Balance sheet has assets figure", toolResult.summary?.includes("Total Assets"), `summary: ${toolResult.summary?.substring(0, 80)}`);

  // 13. Integrity still clean after QA
  const integrity = (db.prepare("PRAGMA integrity_check").get() as any);
  check("DB integrity_check still ok after QA", integrity.integrity_check === "ok");
  
  const fkCheck = (db.prepare("PRAGMA foreign_key_check").all() as any[]);
  check("DB foreign_key_check still passes after QA", fkCheck.length === 0, `failures: ${fkCheck.length}`);

  console.log(`\n=== QA RESULTS: ${passed} passed, ${failed} failed ===`);
  console.log(`NEW RUN ID: ${newRunId}`);
  console.log(`NEW TASK COUNT: ${newTaskCount}`);
  
  return { passed, failed, newRunId, newTaskCount };
}

runQA().then(r => {
  if (r.failed > 0) process.exit(1);
}).catch(err => {
  console.error("QA Error:", err);
  process.exit(1);
});

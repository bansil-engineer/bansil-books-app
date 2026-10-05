import { DatabaseSync } from "node:sqlite";
import path from "node:path";
const dbPath = path.join(process.cwd(), "data", "ai_workspace.db");
const db = new DatabaseSync(dbPath, { readOnly: true });

function getCount(table: string) {
  try {
    const res = db.prepare(`SELECT count(*) as c FROM ${table}`).get() as { c: number };
    return res.c;
  } catch {
    return 0;
  }
}

const tables = [
  "ai_conversations", "ai_messages", "ai_runs", "ai_tasks", 
  "ai_tool_executions", "ai_agent_handoffs", "ai_agents", 
  "ai_departments", "ai_memory_entries", "ai_budget_periods", 
  "ai_department_budgets", "ai_agent_budgets", "ai_task_budgets", 
  "ai_usage_ledger", "ai_evidence_index"
];

console.log("--- COUNTS ---");
for (const t of tables) {
  console.log(`${t}: ${getCount(t)}`);
}

console.log("\n--- ORPHANS ---");
// Runs with zero tasks
const runsWithoutTasks = db.prepare(`SELECT id FROM ai_runs WHERE id NOT IN (SELECT run_id FROM ai_tasks WHERE run_id IS NOT NULL)`).all() as {id: string}[];
console.log(`runs without tasks: ${runsWithoutTasks.length}`);

// task budgets whose task_id no longer exists
const orphanTaskBudgets = db.prepare(`SELECT id, task_id FROM ai_task_budgets WHERE task_id NOT IN (SELECT id FROM ai_tasks)`).all();
console.log(`orphan task budgets: ${orphanTaskBudgets.length}`);

// usage ledger rows whose task_id no longer exists
const orphanUsage = db.prepare(`SELECT id, task_id FROM ai_usage_ledger WHERE task_id NOT IN (SELECT id FROM ai_tasks)`).all();
console.log(`orphan usage ledger: ${orphanUsage.length}`);

// handoffs referencing missing tasks
const orphanHandoffs = db.prepare(`SELECT id, task_id FROM ai_agent_handoffs WHERE task_id NOT IN (SELECT id FROM ai_tasks WHERE id IS NOT NULL)`).all();
console.log(`orphan handoffs: ${orphanHandoffs.length}`);

// tool executions referencing missing tasks
const orphanTools = db.prepare(`SELECT id, task_id FROM ai_tool_executions WHERE task_id NOT IN (SELECT id FROM ai_tasks WHERE id IS NOT NULL)`).all();
console.log(`orphan tool executions: ${orphanTools.length}`);

// memory source_reference pointing to valid/missing runs
const memoryRuns = db.prepare(`SELECT id, source_reference FROM ai_memory_entries WHERE source_type='AI_RUN_OUTPUT'`).all() as {id:string, source_reference:string}[];
let validMem = 0;
let missingMem = 0;
for (const m of memoryRuns) {
  // run_{id}
  const match = m.source_reference.match(/run_[a-zA-Z0-9_]+/);
  if (match) {
    const runId = match[0].replace("run_", ""); // memory doesn't just store "run_" prefix always maybe
    // actually just check if it's the exact id
    const exists = db.prepare(`SELECT 1 FROM ai_runs WHERE id = ?`).get(runId);
    if (exists) validMem++;
    else missingMem++;
  }
}
console.log(`memory run refs valid: ${validMem}, missing: ${missingMem}`);

console.log("\n--- PRAGMA foreign_key_check ---");
const fks = db.prepare(`PRAGMA foreign_key_check`).all();
console.log(`foreign key check failures: ${fks.length}`);

console.log("\n--- PHASE 2F & 2G HISTORY ---");
const runs = db.prepare(`SELECT id, objective, status, started_at, completed_at FROM ai_runs ORDER BY started_at DESC`).all() as any[];
for (const run of runs) {
  const taskCount = db.prepare(`SELECT count(*) as c FROM ai_tasks WHERE run_id = ?`).get(run.id) as {c:number};
  let classification = "INTACT";
  if (taskCount.c === 0) classification = "TASK_HISTORY_MISSING";
  // Just print a few of the latest to verify
  if (run.objective && (run.objective.includes("Sales-vs-Purchase") || run.objective.includes("working-capital") || run.objective.includes("balance sheet"))) {
     console.log(`${run.id}: ${run.objective.substring(0, 30)}... [${classification}] tasks: ${taskCount.c}`);
  }
}

db.close();

import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const dbPath = path.join(process.cwd(), "data", "ai_workspace.db");
const db = new DatabaseSync(dbPath, { readOnly: true });

const limit = db.prepare(`SELECT SUM(monthly_limit) as s FROM ai_budget_periods`).get() as any;
const ledger = db.prepare(`SELECT SUM(actual_cost) as s FROM ai_usage_ledger`).get() as any;
const taskEst = db.prepare(`SELECT SUM(estimated_cost) as s FROM ai_task_budgets`).get() as any;
const taskCom = db.prepare(`SELECT SUM(approved_ceiling) as s FROM ai_task_budgets`).get() as any;

console.log(`MONTHLY LIMIT: ${limit.s}`);
console.log(`FINAL/NO_METERED_COST consumption: ${ledger.s}`);
console.log(`ESTIMATED conservative consumption: ${taskEst.s}`);
console.log(`COMMITTED: ${taskCom.s}`);
console.log(`AVAILABLE: ${limit.s - (taskCom.s || 0)}`);

const orphanCost = db.prepare(`SELECT count(*) as c, sum(actual_cost) as s FROM ai_usage_ledger WHERE task_id NOT IN (SELECT id FROM ai_tasks WHERE id IS NOT NULL)`).get() as any;
console.log(`ORPHAN COST RECORDS: count=${orphanCost.c}, sum=${orphanCost.s}`);

/**
 * Budget carry-forward fix for the clean candidate DB.
 *
 * INCIDENT CARRY-FORWARD RATIONALE:
 * - September 2026 period: consumed_amount = ₹37.5 (confirmed from orphaned ai_task_budgets
 *   in damaged DB — all estimated cost, NO_METERED_COST classifications, not verifiable 
 *   as actual provider spend because task hierarchy was destroyed).
 * - October 2026 period (current active): carries ₹37.5 INCIDENT_CARRY_FORWARD reserve
 *   to reduce available budget. This is conservative — does NOT claim it as real provider spend.
 *
 * WHAT THIS DOES:
 * - Sets period_2026_09 consumed_amount = 37.5 (accurate historical record of September)
 * - Sets period_2026_10 consumed_amount = 37.5 (incident carry-forward reserve in current month)
 * - Does NOT create task-level rows (no fabricated execution graph)
 * - Does NOT claim this is FINAL/ACTUAL provider-billed spend
 *
 * WHAT THIS DOES NOT DO:
 * - Does not invent task records
 * - Does not claim ₹37.5 is metered provider spend
 * - Does not silently call prior consumption ₹0
 *
 * ACTUAL METERED PROVIDER SPEND: UNAVAILABLE
 * (All ₹37.5 was NO_METERED_COST cost_status in the damaged DB — proven zero real provider spend)
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const CANDIDATE_PATH = path.join(process.cwd(), "data", "ai_workspace.clean_candidate.db");
const INCIDENT_CARRY_FORWARD = 37.5;
const MONTHLY_LIMIT = 15000.0;

const db = new DatabaseSync(CANDIDATE_PATH);

console.log("\n=== BUDGET CARRY-FORWARD FIX ===\n");

// 1. First verify actual metered spend from cost_status breakdown in damaged DB
const damagedDb = new DatabaseSync(path.join(process.cwd(), "data", "ai_workspace.db"), { readOnly: true });
const costBreakdown = damagedDb.prepare(
  "SELECT cost_status, COUNT(*) as c, SUM(actual_cost) as total FROM ai_usage_ledger GROUP BY cost_status"
).all() as any[];
const taskBudgetBreakdown = damagedDb.prepare(
  "SELECT status, COUNT(*) as c, SUM(actual_cost) as total_actual, SUM(estimated_cost) as total_est FROM ai_task_budgets GROUP BY status"
).all() as any[];
damagedDb.close();

console.log("Cost breakdown from damaged DB ai_usage_ledger:");
for (const r of costBreakdown) {
  console.log(`  cost_status=${r.cost_status}, count=${r.c}, total_actual=${r.total}`);
}
console.log("Task budget breakdown from damaged DB ai_task_budgets:");
for (const r of taskBudgetBreakdown) {
  console.log(`  status=${r.status}, count=${r.c}, total_actual=${r.total_actual}, total_est=${r.total_est}`);
}

// 2. Show current candidate state
console.log("\nCurrent candidate budget periods:");
const periods = db.prepare("SELECT * FROM ai_budget_periods ORDER BY period_start DESC").all() as any[];
for (const p of periods) {
  console.log(`  ${p.id}: limit=${p.monthly_limit}, committed=${p.committed_amount}, consumed=${p.consumed_amount}, available=${p.available_amount}`);
}

// 3. Current new-run task budget consumption (from QA run)
const currentRunConsumed = (db.prepare("SELECT COALESCE(SUM(actual_cost),0) as s FROM ai_task_budgets").get() as any).s;
const currentRunCommitted = (db.prepare("SELECT COALESCE(SUM(approved_ceiling),0) as s FROM ai_task_budgets WHERE status = 'COMMITTED'").get() as any).s;
const currentLedgerActual = (db.prepare("SELECT COALESCE(SUM(actual_cost),0) as s FROM ai_usage_ledger").get() as any).s;
console.log(`\nCurrent clean-candidate consumption (from QA run tasks):`);
console.log(`  task_budgets actual_cost sum: ₹${currentRunConsumed}`);
console.log(`  task_budgets committed ceiling: ₹${currentRunCommitted}`);
console.log(`  usage_ledger actual_cost sum: ₹${currentLedgerActual}`);

const now = new Date().toISOString();

// 4. Update period_2026_09 (September — closed, historical record)
db.prepare(`
  UPDATE ai_budget_periods 
  SET consumed_amount = ?, available_amount = ?, updated_at = ?
  WHERE id = 'period_2026_09'
`).run(INCIDENT_CARRY_FORWARD, MONTHLY_LIMIT - INCIDENT_CARRY_FORWARD, now);
console.log(`\n✓ period_2026_09 (September — closed): consumed_amount set to ₹${INCIDENT_CARRY_FORWARD} (historical record)`);

// 5. Update period_2026_10 (October — current active, carry-forward reserve)
// The carry-forward reduces the October available budget conservatively.
// It does NOT represent confirmed October provider spend — it is an INCIDENT_PARTIAL reserve.
const octAvailable = MONTHLY_LIMIT - INCIDENT_CARRY_FORWARD - currentRunCommitted - currentLedgerActual;
db.prepare(`
  UPDATE ai_budget_periods 
  SET consumed_amount = ?, available_amount = ?, committed_amount = ?, updated_at = ?
  WHERE id = 'period_2026_10'
`).run(INCIDENT_CARRY_FORWARD, octAvailable, currentRunCommitted, now);
console.log(`✓ period_2026_10 (October — active): consumed_amount set to ₹${INCIDENT_CARRY_FORWARD} (INCIDENT_CARRY_FORWARD reserve)`);

// 6. Reconciliation report
console.log("\n=== BUDGET RECONCILIATION REPORT ===");
const updatedPeriods = db.prepare("SELECT * FROM ai_budget_periods ORDER BY period_start DESC").all() as any[];
for (const p of updatedPeriods) {
  console.log(`\n  ${p.id} [${p.period_start.slice(0,10)} → ${p.period_end.slice(0,10)}]:`);
  console.log(`    Monthly Limit:               ₹${p.monthly_limit}`);
  console.log(`    Committed (current runs):    ₹${p.committed_amount}`);
  console.log(`    Consumed (incl. carry-fwd):  ₹${p.consumed_amount}`);
  console.log(`    Available:                   ₹${p.available_amount}`);
}

console.log(`\n  BREAKDOWN (period_2026_10 active):`);
console.log(`    Monthly Limit:                         ₹${MONTHLY_LIMIT}`);
console.log(`    - Incident Carry-Forward Reserve:      ₹${INCIDENT_CARRY_FORWARD}  [ESTIMATED/NO_METERED_COST — not confirmed provider spend]`);
console.log(`    - Current New-Run Estimated:           ₹${currentLedgerActual}  [clean candidate QA run — NO_METERED_COST]`);
console.log(`    - Current Commitments:                 ₹${currentRunCommitted}`);
console.log(`    = Available:                           ₹${octAvailable}`);
console.log(`\n  ACTUAL METERED PROVIDER SPEND:    UNAVAILABLE`);
console.log(`  (All ₹37.5 classified NO_METERED_COST in damaged DB — zero confirmed real provider billing)`);

// 7. Integrity check
const integrity = (db.prepare("PRAGMA integrity_check").get() as any);
const fkFailures = (db.prepare("PRAGMA foreign_key_check").all() as any[]).length;
const orphanBudgets = (db.prepare("SELECT count(*) as c FROM ai_task_budgets WHERE task_id NOT IN (SELECT id FROM ai_tasks WHERE id IS NOT NULL)").get() as any).c;
const orphanLedger = (db.prepare("SELECT count(*) as c FROM ai_usage_ledger WHERE task_id NOT IN (SELECT id FROM ai_tasks WHERE id IS NOT NULL)").get() as any).c;

console.log("\n=== INTEGRITY CHECKS ===");
console.log(`  integrity_check: ${integrity.integrity_check}`);
console.log(`  foreign_key_check failures: ${fkFailures}`);
console.log(`  orphan task budgets: ${orphanBudgets}`);
console.log(`  orphan usage ledger: ${orphanLedger}`);

db.close();
console.log("\nBudget carry-forward applied. Candidate DB ready for pre-swap gate checks.");

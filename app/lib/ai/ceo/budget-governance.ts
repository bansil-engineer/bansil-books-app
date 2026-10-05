import { getAiDatabase } from "@/app/lib/db/ai-database";
import { AiBudgetPeriod, BudgetPeriodStatus, AiDepartmentBudget, AiTaskBudget, CostStatus, AiUsageLedgerEntry } from "./ceo-types";
import { getOrCreateDepartment, updateDepartmentBudget } from "./department-registry";

export const MONTHLY_AI_HARD_LIMIT = 15000.0;
export const THRESHOLD_WARNING = 0.70 * MONTHLY_AI_HARD_LIMIT; // ₹10,500
export const THRESHOLD_HIGH = 0.85 * MONTHLY_AI_HARD_LIMIT;    // ₹12,750
export const THRESHOLD_CRITICAL = 0.95 * MONTHLY_AI_HARD_LIMIT;// ₹14,250

export function computeBudgetStatus(committed: number, consumed: number, limit: number = MONTHLY_AI_HARD_LIMIT): BudgetPeriodStatus {
  const total = committed + consumed;
  if (total >= limit) {
    return "HARD_STOP";
  }
  if (total >= THRESHOLD_CRITICAL) {
    return "CRITICAL";
  }
  if (total >= THRESHOLD_HIGH) {
    return "HIGH";
  }
  if (total >= THRESHOLD_WARNING) {
    return "WARNING";
  }
  return "NORMAL";
}

export function getCurrentBudgetPeriod(): AiBudgetPeriod {
  const db = getAiDatabase();
  const row = db.prepare(`
    SELECT * FROM ai_budget_periods
    ORDER BY period_start DESC
    LIMIT 1
  `).get() as Record<string, any> | undefined;

  if (row) {
    const committed = Number(row.committed_amount || 0);
    const consumed = Number(row.consumed_amount || 0);
    const limit = Number(row.monthly_limit || MONTHLY_AI_HARD_LIMIT);
    const available = Math.max(0.0, limit - committed - consumed);
    const status = computeBudgetStatus(committed, consumed, limit);

    return {
      id: row.id,
      period_start: row.period_start,
      period_end: row.period_end,
      currency: row.currency || "INR",
      monthly_limit: limit,
      committed_amount: committed,
      consumed_amount: consumed,
      available_amount: available,
      status: status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  // Create initial period
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1).toISOString();
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999).toISOString();
  const nowIso = now.toISOString();
  const id = `period_${year}_${String(month + 1).padStart(2, "0")}`;

  db.prepare(`
    INSERT INTO ai_budget_periods (
      id, period_start, period_end, currency, monthly_limit,
      committed_amount, consumed_amount, available_amount, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'INR', ?, 0.0, 0.0, ?, 'NORMAL', ?, ?)
  `).run(id, start, end, MONTHLY_AI_HARD_LIMIT, MONTHLY_AI_HARD_LIMIT, nowIso, nowIso);

  return getCurrentBudgetPeriod();
}

/**
 * Concurrency-safe budget reservation for an AI task.
 * Atomic check-and-reserve inside SQLite transaction.
 *
 * Rules:
 * - NO_METERED_COST: Valid zero monetary reservation for explicitly configured free/local models.
 * - CONFIG_REQUIRED: Throws COST_CONFIG_REQUIRED; cannot reserve or execute paid unconfigured models.
 * - Paid models: Must have positive estimated cost (> 0) and cannot exceed available monthly budget.
 */
export function reserveBudget(params: {
  taskId: string;
  agentId: string;
  departmentId?: string;
  estimatedCost: number;
  costStatus?: CostStatus;
}): { success: boolean; period: AiBudgetPeriod; taskBudget: AiTaskBudget } {
  const db = getAiDatabase();
  const cost = Number(params.estimatedCost);

  // 1. Block unconfigured model execution
  if (params.costStatus === "CONFIG_REQUIRED") {
    throw new Error(
      "COST_CONFIG_REQUIRED: Cannot reserve or execute paid model calls with unconfigured pricing."
    );
  }

  // 2. Free / unmetered model handling (explicitly configured NO_METERED_COST)
  const isNoMeteredCost = params.costStatus === "NO_METERED_COST";

  if (!isNoMeteredCost && cost <= 0) {
    throw new Error(
      "Cost Execution Gate: Paid model estimated cost must be greater than zero. Cannot bypass budget with zero-cost reservation."
    );
  }

  // Begin transaction
  db.exec("BEGIN IMMEDIATE;");
  try {
    const period = getCurrentBudgetPeriod();

    if (!isNoMeteredCost && period.available_amount < cost) {
      db.exec("ROLLBACK;");
      throw new Error(
        `Budget Exceeded: Requested ₹${cost.toFixed(2)} exceeds available ₹${period.available_amount.toFixed(2)}. Status: OWNER_APPROVAL_REQUIRED`
      );
    }

    const newCommitted = isNoMeteredCost ? period.committed_amount : period.committed_amount + cost;
    const newAvailable = Math.max(0.0, period.monthly_limit - newCommitted - period.consumed_amount);
    const newStatus = computeBudgetStatus(newCommitted, period.consumed_amount, period.monthly_limit);
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE ai_budget_periods
      SET committed_amount = ?, available_amount = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(newCommitted, newAvailable, newStatus, nowIso, period.id);

    // Ensure agent exists
    db.prepare(`
      INSERT OR IGNORE INTO ai_agents (
        id, name, role, department, level, status, risk_class, created_by, created_at, updated_at
      ) VALUES (?, ?, 'Worker', 'EXECUTIVE', 'SPECIALIST', 'ACTIVE', 'STANDARD', 'SYSTEM', ?, ?)
    `).run(params.agentId, params.agentId, nowIso, nowIso);

    // Ensure task exists
    db.prepare(`
      INSERT OR IGNORE INTO ai_tasks (
        id, objective, assigned_agent_id, requested_by, priority, status, created_at
      ) VALUES (?, ?, ?, 'CEO', 'MEDIUM', 'PLANNED', ?)
    `).run(params.taskId, `Task ${params.taskId}`, params.agentId, nowIso);

    const taskBudgetId = `tb_${params.taskId}`;
    db.prepare(`
      INSERT INTO ai_task_budgets (
        id, task_id, agent_id, estimated_cost, approved_ceiling, actual_cost, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 0.0, 'COMMITTED', ?)
      ON CONFLICT(id) DO UPDATE SET
        estimated_cost = excluded.estimated_cost,
        approved_ceiling = excluded.approved_ceiling,
        status = 'COMMITTED'
    `).run(taskBudgetId, params.taskId, params.agentId, isNoMeteredCost ? 0.0 : cost, isNoMeteredCost ? 0.0 : cost, nowIso);

    db.exec("COMMIT;");

    const updatedPeriod: AiBudgetPeriod = {
      ...period,
      committed_amount: newCommitted,
      available_amount: newAvailable,
      status: newStatus,
      updated_at: nowIso,
    };

    const taskBudget: AiTaskBudget = {
      id: taskBudgetId,
      task_id: params.taskId,
      agent_id: params.agentId,
      estimated_cost: isNoMeteredCost ? 0.0 : cost,
      approved_ceiling: isNoMeteredCost ? 0.0 : cost,
      actual_cost: 0.0,
      status: "COMMITTED",
      created_at: nowIso,
      completed_at: null,
    };

    return { success: true, period: updatedPeriod, taskBudget };
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore
    }
    throw err;
  }
}

/**
 * Record actual cost when task execution completes.
 * Converts commitment to consumption and logs into usage ledger with explicit cost status.
 * Distinguishes CONFIG_REQUIRED, ESTIMATED, FINAL, and NO_METERED_COST costs.
 */
export function recordActualCost(params: {
  taskId: string;
  actualCost: number;
  costStatus?: CostStatus;
  provider?: string;
  model?: string;
  usageType?: string;
  metadataSummary?: string;
}): { period: AiBudgetPeriod; variance: number; costStatus: CostStatus } {
  const db = getAiDatabase();
  const actual = Number(params.actualCost);

  db.exec("BEGIN IMMEDIATE;");
  try {
    const period = getCurrentBudgetPeriod();

    const taskBudgetRow = db.prepare(`
      SELECT * FROM ai_task_budgets WHERE task_id = ? AND status = 'COMMITTED'
    `).get(params.taskId) as Record<string, any> | undefined;

    const estimated = taskBudgetRow ? Number(taskBudgetRow.estimated_cost || 0) : 0;
    const agentId = taskBudgetRow?.agent_id || null;

    // Determine cost status
    let resolvedCostStatus: CostStatus = params.costStatus || "CONFIG_REQUIRED";
    if (!params.costStatus && params.model) {
      const modelRow = db.prepare(`SELECT status FROM model_cost_catalog WHERE model = ? OR id = ? LIMIT 1`).get(params.model, params.model) as { status: CostStatus } | undefined;
      if (modelRow?.status === "FINAL") {
        resolvedCostStatus = "FINAL";
      } else if (modelRow?.status === "ESTIMATED") {
        resolvedCostStatus = "ESTIMATED";
      } else if (modelRow?.status === "NO_METERED_COST") {
        resolvedCostStatus = "NO_METERED_COST";
      } else {
        resolvedCostStatus = "CONFIG_REQUIRED";
      }
    }

    const isNoMeteredCost = resolvedCostStatus === "NO_METERED_COST";

    // Convert commitment to consumption
    const newCommitted = Math.max(0.0, period.committed_amount - (isNoMeteredCost ? 0.0 : estimated));
    const newConsumed = isNoMeteredCost ? period.consumed_amount : period.consumed_amount + actual;
    const newAvailable = Math.max(0.0, period.monthly_limit - newCommitted - newConsumed);
    const newStatus = computeBudgetStatus(newCommitted, newConsumed, period.monthly_limit);
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE ai_budget_periods
      SET committed_amount = ?, consumed_amount = ?, available_amount = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(newCommitted, newConsumed, newAvailable, newStatus, nowIso, period.id);

    if (taskBudgetRow) {
      db.prepare(`
        UPDATE ai_task_budgets
        SET actual_cost = ?, status = 'CONSUMED', completed_at = ?
        WHERE id = ?
      `).run(isNoMeteredCost ? 0.0 : actual, nowIso, taskBudgetRow.id);
    }

    // Ledger entry with explicit cost_status
    const ledgerId = `ledger_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    db.prepare(`
      INSERT INTO ai_usage_ledger (
        id, budget_period_id, task_id, agent_id, provider, model,
        usage_type, cost_status, estimated_cost, actual_cost, currency, metadata_summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?)
    `).run(
      ledgerId,
      period.id,
      params.taskId,
      agentId,
      params.provider || "OpenAI",
      params.model || "gpt-4o-mini",
      params.usageType || "TASK_EXECUTION",
      resolvedCostStatus,
      isNoMeteredCost ? 0.0 : estimated,
      isNoMeteredCost ? 0.0 : actual,
      params.metadataSummary || null,
      nowIso
    );

    db.exec("COMMIT;");

    const updatedPeriod: AiBudgetPeriod = {
      ...period,
      committed_amount: newCommitted,
      consumed_amount: newConsumed,
      available_amount: newAvailable,
      status: newStatus,
      updated_at: nowIso,
    };

    return { period: updatedPeriod, variance: isNoMeteredCost ? 0.0 : actual - estimated, costStatus: resolvedCostStatus };
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore
    }
    throw err;
  }
}

/**
 * Release committed budget when task is cancelled or rejected.
 */
export function releaseBudgetCommitment(taskId: string): AiBudgetPeriod {
  const db = getAiDatabase();

  db.exec("BEGIN IMMEDIATE;");
  try {
    const period = getCurrentBudgetPeriod();

    const taskBudgetRow = db.prepare(`
      SELECT * FROM ai_task_budgets WHERE task_id = ? AND status = 'COMMITTED'
    `).get(taskId) as Record<string, any> | undefined;

    if (!taskBudgetRow) {
      db.exec("ROLLBACK;");
      return period;
    }

    const estimated = Number(taskBudgetRow.estimated_cost || 0);
    const newCommitted = Math.max(0.0, period.committed_amount - estimated);
    const newAvailable = Math.max(0.0, period.monthly_limit - newCommitted - period.consumed_amount);
    const newStatus = computeBudgetStatus(newCommitted, period.consumed_amount, period.monthly_limit);
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE ai_budget_periods
      SET committed_amount = ?, available_amount = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(newCommitted, newAvailable, newStatus, nowIso, period.id);

    db.prepare(`
      UPDATE ai_task_budgets
      SET status = 'CANCELLED', completed_at = ?
      WHERE id = ?
    `).run(nowIso, taskBudgetRow.id);

    db.exec("COMMIT;");

    return {
      ...period,
      committed_amount: newCommitted,
      available_amount: newAvailable,
      status: newStatus,
      updated_at: nowIso,
    };
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore
    }
    throw err;
  }
}

/**
 * Dynamic Department Budget Allocation by CEO.
 */
export function allocateDepartmentBudget(params: {
  departmentId: string;
  amount: number;
}): AiDepartmentBudget {
  const db = getAiDatabase();
  const period = getCurrentBudgetPeriod();
  const amt = Number(params.amount);
  const nowIso = new Date().toISOString();
  const id = `dept_budg_${period.id}_${params.departmentId}`;

  // Ensure department exists dynamically via registry
  getOrCreateDepartment(params.departmentId, "Auto-created on budget allocation", "CEO");

  db.prepare(`
    INSERT INTO ai_department_budgets (
      id, budget_period_id, department_id, allocated_amount,
      committed_amount, consumed_amount, available_amount, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0.0, 0.0, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      allocated_amount = excluded.allocated_amount,
      available_amount = excluded.allocated_amount - committed_amount - consumed_amount,
      updated_at = excluded.updated_at
  `).run(id, period.id, params.departmentId, amt, amt, nowIso, nowIso);

  updateDepartmentBudget(params.departmentId, amt, 0);

  const row = db.prepare(`SELECT * FROM ai_department_budgets WHERE id = ?`).get(id) as Record<string, any>;
  return {
    id: row.id,
    budget_period_id: row.budget_period_id,
    department_id: row.department_id,
    allocated_amount: Number(row.allocated_amount),
    committed_amount: Number(row.committed_amount),
    consumed_amount: Number(row.consumed_amount),
    available_amount: Number(row.available_amount),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Dynamic CEO Budget Reallocation between departments.
 * Reallocates budget without exceeding ₹15,000 hard limit.
 */
export function transferDepartmentBudget(params: {
  fromDepartmentId: string;
  toDepartmentId: string;
  amount: number;
  reason: string;
  initiatedBy?: string;
}): boolean {
  const db = getAiDatabase();
  const period = getCurrentBudgetPeriod();
  const amt = Number(params.amount);

  if (amt <= 0) {
    throw new Error("Transfer amount must be positive.");
  }

  db.exec("BEGIN IMMEDIATE;");
  try {
    const fromId = `dept_budg_${period.id}_${params.fromDepartmentId}`;
    const toId = `dept_budg_${period.id}_${params.toDepartmentId}`;

    const fromRow = db.prepare(`SELECT * FROM ai_department_budgets WHERE id = ?`).get(fromId) as Record<string, any> | undefined;

    if (!fromRow || Number(fromRow.available_amount || 0) < amt) {
      db.exec("ROLLBACK;");
      throw new Error(`Transfer Blocked: Source department '${params.fromDepartmentId}' has insufficient available budget (has ₹${Number(fromRow?.available_amount || 0)}, requested ₹${amt}).`);
    }

    const nowIso = new Date().toISOString();

    // Deduct from source
    const newFromAllocated = Number(fromRow.allocated_amount) - amt;
    const newFromAvailable = Number(fromRow.available_amount) - amt;
    db.prepare(`
      UPDATE ai_department_budgets
      SET allocated_amount = ?, available_amount = ?, updated_at = ?
      WHERE id = ?
    `).run(newFromAllocated, newFromAvailable, nowIso, fromId);

    // Add to target
    const toRow = db.prepare(`SELECT * FROM ai_department_budgets WHERE id = ?`).get(toId) as Record<string, any> | undefined;
    if (toRow) {
      const newToAllocated = Number(toRow.allocated_amount) + amt;
      const newToAvailable = Number(toRow.available_amount) + amt;
      db.prepare(`
        UPDATE ai_department_budgets
        SET allocated_amount = ?, available_amount = ?, updated_at = ?
        WHERE id = ?
      `).run(newToAllocated, newToAvailable, nowIso, toId);
    } else {
      getOrCreateDepartment(params.toDepartmentId, "Auto-created on transfer", "CEO");

      db.prepare(`
        INSERT INTO ai_department_budgets (
          id, budget_period_id, department_id, allocated_amount,
          committed_amount, consumed_amount, available_amount, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0.0, 0.0, ?, ?, ?)
      `).run(toId, period.id, params.toDepartmentId, amt, amt, nowIso, nowIso);
    }

    // Record transfer log
    const transferId = `xfer_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    db.prepare(`
      INSERT INTO ai_budget_transfers (
        id, budget_period_id, from_department_id, to_department_id, amount, reason, initiated_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transferId,
      period.id,
      params.fromDepartmentId,
      params.toDepartmentId,
      amt,
      params.reason,
      params.initiatedBy || "CEO",
      nowIso
    );

    db.exec("COMMIT;");
    return true;
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore
    }
    throw err;
  }
}

/**
 * Cost status analytics breakdown:
 * Distinguishes CONFIG_REQUIRED, ESTIMATED, and FINAL monetary figures.
 */
export function getCostBreakdownByStatus(): {
  configRequiredCount: number;
  configRequiredCommitted: number;
  noMeteredCostCount: number;
  estimatedCount: number;
  estimatedTotal: number;
  finalCount: number;
  finalTotal: number;
} {
  const db = getAiDatabase();
  const rows = db.prepare(`
    SELECT cost_status, COUNT(*) as count, SUM(actual_cost) as total_actual, SUM(estimated_cost) as total_estimated
    FROM ai_usage_ledger
    GROUP BY cost_status
  `).all() as Array<{ cost_status: string; count: number; total_actual: number; total_estimated: number }>;

  const result = {
    configRequiredCount: 0,
    configRequiredCommitted: 0,
    noMeteredCostCount: 0,
    estimatedCount: 0,
    estimatedTotal: 0,
    finalCount: 0,
    finalTotal: 0,
  };

  for (const r of rows) {
    if (r.cost_status === "CONFIG_REQUIRED") {
      result.configRequiredCount = Number(r.count || 0);
      result.configRequiredCommitted = Number(r.total_estimated || 0);
    } else if (r.cost_status === "NO_METERED_COST") {
      result.noMeteredCostCount = Number(r.count || 0);
    } else if (r.cost_status === "ESTIMATED") {
      result.estimatedCount = Number(r.count || 0);
      result.estimatedTotal = Number(r.total_actual || r.total_estimated || 0);
    } else if (r.cost_status === "FINAL") {
      result.finalCount = Number(r.count || 0);
      result.finalTotal = Number(r.total_actual || 0);
    }
  }

  return result;
}

export function listUsageLedger(limit: number = 50): AiUsageLedgerEntry[] {
  const db = getAiDatabase();
  const rows = db.prepare(`
    SELECT * FROM ai_usage_ledger
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Record<string, any>[];

  return rows.map((r) => ({
    id: r.id,
    budget_period_id: r.budget_period_id,
    task_id: r.task_id || null,
    agent_id: r.agent_id || null,
    department_id: r.department_id || null,
    provider: r.provider,
    model: r.model,
    usage_type: r.usage_type,
    cost_status: (r.cost_status as CostStatus) || "CONFIG_REQUIRED",
    estimated_cost: Number(r.estimated_cost || 0),
    actual_cost: Number(r.actual_cost || 0),
    currency: r.currency || "INR",
    metadata_summary: r.metadata_summary || null,
    created_at: r.created_at,
  }));
}

export function listDepartmentBudgets(): AiDepartmentBudget[] {
  const db = getAiDatabase();
  const period = getCurrentBudgetPeriod();
  const rows = db.prepare(`
    SELECT * FROM ai_department_budgets WHERE budget_period_id = ?
  `).all(period.id) as Record<string, any>[];

  return rows.map((r) => ({
    id: r.id,
    budget_period_id: r.budget_period_id,
    department_id: r.department_id,
    allocated_amount: Number(r.allocated_amount),
    committed_amount: Number(r.committed_amount),
    consumed_amount: Number(r.consumed_amount),
    available_amount: Number(r.available_amount),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

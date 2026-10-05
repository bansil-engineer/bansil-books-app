import { getAiDatabase } from "@/app/lib/db/ai-database";
import { AiAgentConfig, AgentStatus } from "./ceo-types";

export function getAgent(id: string): AiAgentConfig | null {
  const db = getAiDatabase();
  const row = db.prepare(`
    SELECT * FROM ai_agents WHERE id = ?
  `).get(id) as Record<string, any> | undefined;

  if (!row) return null;
  return deserializeAgent(row);
}

export function registerAgent(agent: AiAgentConfig): void {
  const db = getAiDatabase();

  db.prepare(`
    INSERT INTO ai_agents (
      id, name, title, role, department, level, reports_to, status,
      purpose, responsibilities, capabilities, allowed_tools, denied_tools,
      max_task_budget, monthly_budget, temporary, risk_class,
      created_by, created_reason, performance_metrics,
      last_used_at, current_workload, tasks_completed, tasks_failed, retries,
      reviewer_rework_count, average_cost_per_task, relevant_memory_count,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      title=excluded.title,
      role=excluded.role,
      department=excluded.department,
      level=excluded.level,
      reports_to=excluded.reports_to,
      status=excluded.status,
      purpose=excluded.purpose,
      responsibilities=excluded.responsibilities,
      capabilities=excluded.capabilities,
      allowed_tools=excluded.allowed_tools,
      denied_tools=excluded.denied_tools,
      max_task_budget=excluded.max_task_budget,
      monthly_budget=excluded.monthly_budget,
      temporary=excluded.temporary,
      risk_class=excluded.risk_class,
      created_reason=excluded.created_reason,
      performance_metrics=excluded.performance_metrics,
      last_used_at=coalesce(excluded.last_used_at, ai_agents.last_used_at),
      current_workload=coalesce(excluded.current_workload, ai_agents.current_workload),
      tasks_completed=coalesce(excluded.tasks_completed, ai_agents.tasks_completed),
      tasks_failed=coalesce(excluded.tasks_failed, ai_agents.tasks_failed),
      retries=coalesce(excluded.retries, ai_agents.retries),
      reviewer_rework_count=coalesce(excluded.reviewer_rework_count, ai_agents.reviewer_rework_count),
      average_cost_per_task=coalesce(excluded.average_cost_per_task, ai_agents.average_cost_per_task),
      relevant_memory_count=coalesce(excluded.relevant_memory_count, ai_agents.relevant_memory_count),
      updated_at=excluded.updated_at
  `).run(
    agent.id,
    agent.name,
    agent.title || agent.role,
    agent.role,
    agent.department,
    agent.level,
    agent.reports_to,
    agent.status,
    agent.purpose || null,
    JSON.stringify(agent.responsibilities || []),
    JSON.stringify(agent.capabilities),
    JSON.stringify(agent.allowed_tools),
    JSON.stringify(agent.denied_tools),
    agent.max_task_budget || 0,
    agent.monthly_budget || 0,
    agent.temporary ? 1 : 0,
    agent.risk_class,
    agent.created_by,
    agent.created_reason || null,
    JSON.stringify(agent.performance_metrics || {}),
    agent.last_used_at || null,
    agent.current_workload || 0,
    agent.tasks_completed || 0,
    agent.tasks_failed || 0,
    agent.retries || 0,
    agent.reviewer_rework_count || 0,
    agent.average_cost_per_task || 0,
    agent.relevant_memory_count || 0,
    agent.created_at,
    agent.updated_at
  );
}

export function updateAgentStatus(id: string, status: AgentStatus): boolean {
  const db = getAiDatabase();
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE ai_agents SET status = ?, updated_at = ? WHERE id = ?
  `).run(status, now, id);
  return result.changes > 0;
}

export function updateAgentWorkload(id: string, delta: number): void {
  const db = getAiDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE ai_agents
    SET current_workload = max(0, coalesce(current_workload, 0) + ?),
        last_used_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(delta, now, now, id);
}

export function recordAgentTaskOutcome(
  id: string,
  success: boolean,
  actualCost: number,
  reworkCount: number = 0
): void {
  const db = getAiDatabase();
  const now = new Date().toISOString();

  // Retrieve current metrics
  const agent = getAgent(id);
  if (!agent) return;

  const prevCompleted = agent.tasks_completed || 0;
  const prevFailed = agent.tasks_failed || 0;
  const prevAvgCost = agent.average_cost_per_task || 0;
  const prevRework = agent.reviewer_rework_count || 0;

  const newCompleted = success ? prevCompleted + 1 : prevCompleted;
  const newFailed = success ? prevFailed : prevFailed + 1;
  const totalTasks = newCompleted + newFailed;
  const newAvgCost = totalTasks > 0 ? (prevAvgCost * (totalTasks - 1) + actualCost) / totalTasks : actualCost;
  const newRework = prevRework + reworkCount;

  const updatedMetrics = {
    tasks_assigned: totalTasks,
    tasks_completed: newCompleted,
    failed_tasks: newFailed,
    retries: (agent.retries || 0) + reworkCount,
    average_cost: Number(newAvgCost.toFixed(2)),
    budget_consumed: Number(((agent.performance_metrics?.budget_consumed || 0) + actualCost).toFixed(2)),
  };

  db.prepare(`
    UPDATE ai_agents
    SET current_workload = max(0, coalesce(current_workload, 0) - 1),
        tasks_completed = ?,
        tasks_failed = ?,
        reviewer_rework_count = ?,
        average_cost_per_task = ?,
        performance_metrics = ?,
        last_used_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    newCompleted,
    newFailed,
    newRework,
    Number(newAvgCost.toFixed(2)),
    JSON.stringify(updatedMetrics),
    now,
    now,
    id
  );
}

export function retireAgent(id: string, reason?: string): boolean {
  const db = getAiDatabase();
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE ai_agents
    SET status = 'RETIRED',
        created_reason = CASE WHEN ? IS NOT NULL THEN coalesce(created_reason, '') || ' [Retired: ' || ? || ']' ELSE created_reason END,
        updated_at = ?
    WHERE id = ?
  `).run(reason || null, reason || null, now, id);
  return result.changes > 0;
}

export function listAgents(): AiAgentConfig[] {
  const db = getAiDatabase();
  const rows = db.prepare(`SELECT * FROM ai_agents ORDER BY level ASC, name ASC`).all() as Record<string, any>[];
  return rows.map(deserializeAgent);
}

function deserializeAgent(row: Record<string, any>): AiAgentConfig {
  const perf = row.performance_metrics ? JSON.parse(row.performance_metrics) : {};
  return {
    id: row.id,
    name: row.name,
    title: row.title || undefined,
    role: row.role,
    department: row.department,
    level: row.level,
    reports_to: row.reports_to,
    status: row.status,
    purpose: row.purpose || undefined,
    responsibilities: JSON.parse(row.responsibilities || "[]"),
    capabilities: JSON.parse(row.capabilities || "[]"),
    allowed_tools: JSON.parse(row.allowed_tools || "[]"),
    denied_tools: JSON.parse(row.denied_tools || "[]"),
    max_task_budget: row.max_task_budget ? Number(row.max_task_budget) : 0,
    monthly_budget: row.monthly_budget ? Number(row.monthly_budget) : 0,
    temporary: Boolean(row.temporary),
    risk_class: row.risk_class,
    created_by: row.created_by,
    created_reason: row.created_reason || undefined,
    performance_metrics: perf,
    last_used_at: row.last_used_at || null,
    current_workload: row.current_workload ? Number(row.current_workload) : 0,
    tasks_completed: row.tasks_completed ? Number(row.tasks_completed) : (perf.tasks_completed || 0),
    tasks_failed: row.tasks_failed ? Number(row.tasks_failed) : (perf.failed_tasks || 0),
    retries: row.retries ? Number(row.retries) : (perf.retries || 0),
    reviewer_rework_count: row.reviewer_rework_count ? Number(row.reviewer_rework_count) : 0,
    average_cost_per_task: row.average_cost_per_task ? Number(row.average_cost_per_task) : (perf.average_cost || 0),
    relevant_memory_count: row.relevant_memory_count ? Number(row.relevant_memory_count) : 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

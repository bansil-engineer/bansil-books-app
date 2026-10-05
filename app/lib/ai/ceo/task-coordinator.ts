import { getAiDatabase } from "@/app/lib/db/ai-database";
import { AiTask, TaskStatus } from "./ceo-types";

export function createTask(task: Partial<AiTask> & { objective: string, requested_by: string, priority: AiTask["priority"] }): AiTask {
  const db = getAiDatabase();
  const id = task.id || `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const now = new Date().toISOString();

  const dependenciesArr = task.dependencies || [];
  const dependenciesJson = JSON.stringify(dependenciesArr);
  const inputsStr = typeof task.inputs === "object" && task.inputs !== null ? JSON.stringify(task.inputs) : (task.inputs || null);

  const newTask: AiTask = {
    id,
    parent_task_id: task.parent_task_id || null,
    run_id: task.run_id || null,
    objective: task.objective,
    assigned_agent_id: task.assigned_agent_id || null,
    department: task.department || null,
    requested_by: task.requested_by,
    priority: task.priority,
    status: task.status || "PLANNED",
    dependency_status: task.dependency_status || (dependenciesArr.length > 0 ? "WAITING" : "RESOLVED"),
    dependencies: dependenciesArr,
    inputs: task.inputs || null,
    expected_output: task.expected_output || null,
    evidence_requirements: task.evidence_requirements || null,
    evidence_result: task.evidence_result || null,
    estimated_cost: task.estimated_cost || 0.0,
    committed_cost: task.committed_cost || 0.0,
    actual_cost: task.actual_cost || 0.0,
    retry_count: task.retry_count || 0,
    max_retries: task.max_retries || 3,
    failure_reason: task.failure_reason || null,
    idempotency_key: task.idempotency_key || null,
    input_summary: task.input_summary || null,
    result_summary: task.result_summary || null,
    created_at: now,
    assigned_at: task.assigned_agent_id ? now : null,
    started_at: null,
    completed_at: null,
  };

  db.prepare(`
    INSERT INTO ai_tasks (
      id, parent_task_id, run_id, objective, assigned_agent_id, department, requested_by,
      priority, status, dependency_status, dependencies, inputs, expected_output,
      evidence_requirements, evidence_result, estimated_cost, committed_cost, actual_cost,
      retry_count, max_retries, failure_reason, idempotency_key, input_summary, result_summary,
      created_at, assigned_at, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newTask.id, newTask.parent_task_id, newTask.run_id, newTask.objective,
    newTask.assigned_agent_id, newTask.department, newTask.requested_by, newTask.priority, newTask.status,
    newTask.dependency_status, dependenciesJson, inputsStr, newTask.expected_output,
    newTask.evidence_requirements, newTask.evidence_result, newTask.estimated_cost,
    newTask.committed_cost, newTask.actual_cost, newTask.retry_count, newTask.max_retries,
    newTask.failure_reason, newTask.idempotency_key, newTask.input_summary, newTask.result_summary,
    newTask.created_at, newTask.assigned_at, newTask.started_at, newTask.completed_at
  );

  return newTask;
}

export function getTask(id: string): AiTask | null {
  const db = getAiDatabase();
  const row = db.prepare("SELECT * FROM ai_tasks WHERE id = ?").get(id) as Record<string, any> | undefined;
  if (!row) return null;
  return deserializeTask(row);
}

export function listTasksForRun(runId: string): AiTask[] {
  const db = getAiDatabase();
  const rows = db.prepare("SELECT * FROM ai_tasks WHERE run_id = ? ORDER BY created_at ASC").all(runId) as Record<string, any>[];
  return rows.map(deserializeTask);
}

export function updateTaskStatus(
  id: string,
  status: TaskStatus,
  resultSummary?: string,
  extra?: { failureReason?: string; evidenceResult?: string; actualCost?: number }
) {
  const db = getAiDatabase();
  const now = new Date().toISOString();

  if (status === "COMPLETED") {
    db.prepare(`
      UPDATE ai_tasks
      SET status = ?, completed_at = ?, result_summary = COALESCE(?, result_summary),
          evidence_result = COALESCE(?, evidence_result),
          actual_cost = COALESCE(?, actual_cost)
      WHERE id = ?
    `).run(status, now, resultSummary || null, extra?.evidenceResult || null, extra?.actualCost ?? null, id);
  } else if (status === "FAILED" || status === "CANCELLED") {
    db.prepare(`
      UPDATE ai_tasks
      SET status = ?, completed_at = ?, result_summary = COALESCE(?, result_summary),
          failure_reason = COALESCE(?, failure_reason)
      WHERE id = ?
    `).run(status, now, resultSummary || null, extra?.failureReason || null, id);
  } else if (status === "IN_PROGRESS") {
    db.prepare(`
      UPDATE ai_tasks SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?
    `).run(status, now, id);
  } else {
    db.prepare(`
      UPDATE ai_tasks SET status = ? WHERE id = ?
    `).run(status, id);
  }
}

export function recordTaskRetry(taskId: string, reason: string): AiTask {
  const db = getAiDatabase();
  db.prepare(`
    UPDATE ai_tasks
    SET retry_count = retry_count + 1, failure_reason = ?, status = 'PLANNED'
    WHERE id = ?
  `).run(reason, taskId);

  const updated = getTask(taskId);
  if (!updated) throw new Error(`Task ${taskId} not found for retry`);
  return updated;
}

function deserializeTask(row: Record<string, any>): AiTask {
  let deps: string[] = [];
  try {
    if (row.dependencies) deps = JSON.parse(row.dependencies);
  } catch {
    deps = [];
  }

  let inputs: any = null;
  try {
    if (row.inputs) inputs = JSON.parse(row.inputs);
  } catch {
    inputs = row.inputs || null;
  }

  return {
    id: row.id,
    parent_task_id: row.parent_task_id || null,
    run_id: row.run_id || null,
    objective: row.objective,
    assigned_agent_id: row.assigned_agent_id || null,
    department: row.department || null,
    requested_by: row.requested_by,
    priority: row.priority || "NORMAL",
    status: row.status as TaskStatus,
    dependency_status: row.dependency_status || null,
    dependencies: deps,
    inputs,
    expected_output: row.expected_output || null,
    evidence_requirements: row.evidence_requirements || null,
    evidence_result: row.evidence_result || null,
    estimated_cost: Number(row.estimated_cost || 0.0),
    committed_cost: Number(row.committed_cost || 0.0),
    actual_cost: Number(row.actual_cost || 0.0),
    retry_count: Number(row.retry_count || 0),
    max_retries: Number(row.max_retries || 3),
    failure_reason: row.failure_reason || null,
    idempotency_key: row.idempotency_key || null,
    input_summary: row.input_summary || null,
    result_summary: row.result_summary || null,
    created_at: row.created_at,
    assigned_at: row.assigned_at || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
  };
}

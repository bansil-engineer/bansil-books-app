import { getAiDatabase } from "@/app/lib/db/ai-database";
import { AiAgentConfig, AiDepartment, AgentLevel, AgentStatus } from "./ceo-types";
import { registerAgent, getAgent, listAgents, retireAgent } from "./agent-registry";
import { createDepartment, getDepartment, listDepartments, getOrCreateDepartment } from "./department-registry";
import { checkInheritanceRules } from "./permission-policy";
import { getCurrentBudgetPeriod, reserveBudget, recordActualCost, releaseBudgetCommitment } from "./budget-governance";
import { selectModelForTask } from "./model-catalog";

export function createAutonomousAgent(params: {
  creatorId: string;
  id: string;
  name: string;
  title?: string;
  role: string;
  department: string;
  level: AgentLevel;
  reports_to?: string | null;
  purpose?: string;
  responsibilities?: string[];
  capabilities?: string[];
  allowed_tools?: string[];
  max_task_budget?: number;
  monthly_budget?: number;
  temporary?: boolean;
  created_reason: string;
}): AiAgentConfig {
  // Dynamically ensure department exists on demand without duplicate creation
  getOrCreateDepartment(params.department, params.created_reason || "Dynamic department created for agent assignment", "CEO");

  const creator = getAgent(params.creatorId) || {
    id: "ceo_main",
    name: "AI CEO",
    role: "Chief Executive Officer",
    department: "EXECUTIVE",
    level: "CEO" as AgentLevel,
    reports_to: null,
    status: "ACTIVE" as AgentStatus,
    capabilities: ["SYSTEM_ORCHESTRATION", "DELEGATION", "BUDGET_MANAGEMENT"],
    allowed_tools: ["ALL"],
    denied_tools: ["ZOHO_WRITE"],
    risk_class: "CRITICAL",
    created_by: "SYSTEM" as const,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const candidateAgent: AiAgentConfig = {
    id: params.id,
    name: params.name,
    title: params.title || params.role,
    role: params.role,
    department: params.department,
    level: params.level,
    reports_to: params.reports_to || creator.id,
    status: "ACTIVE",
    purpose: params.purpose,
    responsibilities: params.responsibilities || [],
    capabilities: params.capabilities || [],
    allowed_tools: params.allowed_tools || ["READ_ONLY"],
    denied_tools: ["ZOHO_WRITE"],
    max_task_budget: params.max_task_budget || 50.0,
    monthly_budget: params.monthly_budget || 500.0,
    temporary: Boolean(params.temporary),
    risk_class: params.level === "REVIEWER" ? "HIGH" : "STANDARD",
    created_by: "CEO",
    created_reason: params.created_reason,
    performance_metrics: {
      tasks_assigned: 0,
      tasks_completed: 0,
      failed_tasks: 0,
      retries: 0,
      average_cost: 0,
      budget_consumed: 0,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Enforce inheritance and security rules (cannot grant ZOHO_WRITE)
  checkInheritanceRules(creator, candidateAgent);

  // Enforce that monthly budget requested does not exceed remaining budget
  const period = getCurrentBudgetPeriod();
  if ((candidateAgent.monthly_budget || 0) > period.available_amount) {
    throw new Error(
      `Agent Creation Blocked: Requested agent monthly budget ₹${candidateAgent.monthly_budget} exceeds available period budget ₹${period.available_amount}.`
    );
  }

  registerAgent(candidateAgent);

  // Update active_agent_count in department
  const dept = getDepartment(params.department);
  if (dept) {
    const db = getAiDatabase();
    db.prepare(`UPDATE ai_departments SET active_agent_count = active_agent_count + 1 WHERE id = ?`).run(dept.id);
  }

  return candidateAgent;
}

export function createAutonomousDepartment(params: {
  id: string;
  name: string;
  purpose: string;
  headAgentId?: string | null;
  initialBudget?: number;
  created_reason: string;
}): AiDepartment {
  return createDepartment({
    id: params.id,
    name: params.name,
    purpose: params.purpose,
    status: "ACTIVE",
    department_head_agent_id: params.headAgentId || null,
    created_by: "CEO",
    created_reason: params.created_reason,
  });
}

export function planAndAssignWorkforceTask(params: {
  taskId: string;
  objective: string;
  department: string;
  preferredAgentId?: string;
  complexity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}) {
  const db = getAiDatabase();
  const period = getCurrentBudgetPeriod();

  // Dynamically ensure department exists when assigning task
  getOrCreateDepartment(params.department, `Dynamic creation for task: ${params.objective}`, "CEO");

  const modelSelection = selectModelForTask({
    complexity: params.complexity || "MEDIUM",
    availableBudget: period.available_amount,
  });

  if (!modelSelection.canExecute) {
    throw new Error(modelSelection.reason || `Task execution blocked: ${modelSelection.gateStatus}`);
  }

  const estimatedCost = modelSelection.estimatedCost;

  // Reserve budget
  const agentId = params.preferredAgentId || "agent_analyst_general";
  const reservation = reserveBudget({
    taskId: params.taskId,
    agentId,
    departmentId: params.department,
    estimatedCost,
    costStatus: modelSelection.costStatus,
  });

  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO ai_tasks (
      id, objective, assigned_agent_id, requested_by, priority, status, created_at, assigned_at
    ) VALUES (?, ?, ?, 'CEO', ?, 'ASSIGNED', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      assigned_agent_id = excluded.assigned_agent_id,
      status = 'ASSIGNED',
      assigned_at = excluded.assigned_at
  `).run(params.taskId, params.objective, agentId, params.priority || "MEDIUM", nowIso, nowIso);

  return {
    taskId: params.taskId,
    assignedAgentId: agentId,
    modelSelection,
    reservation,
  };
}

export function getWorkforceOverview() {
  const departments = listDepartments();
  const agents = listAgents();
  const budgetPeriod = getCurrentBudgetPeriod();

  return {
    budgetPeriod,
    departments,
    agents,
    totalAgents: agents.length,
    activeAgents: agents.filter((a) => a.status === "ACTIVE" || a.status === "BUSY").length,
  };
}

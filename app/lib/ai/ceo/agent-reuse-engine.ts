// ============================================================
// Bansil Books Analytics — Agent Reuse & Workforce Optimization Engine
// Phase 2B: Persistent Agent Identity, Default Reuse, Duplicate Prevention
// ============================================================

import {
  AiAgentConfig,
  AgentMatchCriteria,
  AgentReuseResult,
  AgentLevel,
} from "./ceo-types";
import {
  listAgents,
  getAgent,
  updateAgentWorkload,
  recordAgentTaskOutcome,
} from "./agent-registry";

export { listAgents };
import { createAutonomousAgent } from "./workforce-manager";
import { getOrCreateDepartment } from "./department-registry";
import {
  getAgentCapabilities,
  grantCapabilityToAgent,
  hasCapability,
  getRoleCapabilityTemplate,
} from "./capability-registry";

export interface SuitableAgentMatch extends AiAgentConfig {
  agent: AiAgentConfig;
  score: number;
  reused: boolean;
}

/**
 * Match and find an existing suitable agent for a task.
 *
 * Scoring Criteria:
 * - Exact role match (+50 pts)
 * - Department match (+30 pts)
 * - Capability match (+20 pts)
 * - Prior successful experience (+tasks_completed, up to 20 pts)
 * - Failure penalty (-tasks_failed * 2)
 * - Workload penalty (-current_workload * 10)
 *
 * Rule: Measurable operational data only (no subjective pseudo-IQ scores).
 */
export function findSuitableAgent(criteria: AgentMatchCriteria & { capabilities?: string[] }): SuitableAgentMatch | null {
  const allAgents = listAgents();

  // Filter out retired agents, and exclude ceo_main from department specialist workforce reuse
  const availableAgents = allAgents.filter(
    (a) =>
      (a.status === "ACTIVE" || a.status === "IDLE" || a.status === "BUSY") &&
      (a.id !== "ceo_main" || criteria.department?.toUpperCase() === "EXECUTIVE" || criteria.role?.toLowerCase().includes("ceo"))
  );

  if (availableAgents.length === 0) {
    return null;
  }

  const targetCapabilities = criteria.requiredCapabilities || criteria.capabilities || [];
  const scoredCandidates: Array<{ agent: AiAgentConfig; score: number }> = [];

  for (const agent of availableAgents) {
    let score = 0;
    let matched = false;

    // Check department match
    const deptMatch =
      criteria.department &&
      agent.department.toUpperCase() === criteria.department.toUpperCase();
    if (deptMatch) {
      score += 30;
      matched = true;
    }

    // Check role match
    if (criteria.role) {
      const targetRole = criteria.role.toLowerCase().trim();
      const agentRole = agent.role.toLowerCase().trim();
      if (agentRole === targetRole) {
        score += 50;
        matched = true;
      } else if (agentRole.includes(targetRole) || targetRole.includes(agentRole)) {
        score += 30;
        matched = true;
      }
    }

    // Check capabilities match
    if (targetCapabilities.length > 0) {
      const assignedCaps = getAgentCapabilities(agent.id).map((c) => c.capabilityCode.toUpperCase());
      const rawCaps = (agent.capabilities || []).map((c) => c.toUpperCase());
      const allCaps = new Set([...rawCaps, ...assignedCaps]);

      const hasAll = targetCapabilities.every((cap) =>
        allCaps.has(cap.toUpperCase())
      );
      if (hasAll) {
        score += 20;
        matched = true;
      } else {
        const hasSome = targetCapabilities.some((cap) =>
          allCaps.has(cap.toUpperCase())
        );
        if (hasSome) {
          score += 10;
          matched = true;
        }
      }
    }

    // Level preference (if matching specific level)
    if (criteria.level && agent.level === criteria.level) {
      score += 10;
    }

    // Operational experience boost: tasks completed
    const completed = agent.tasks_completed || 0;
    score += Math.min(25, completed * 5);

    // Operational penalties: failed tasks and rework
    const failed = agent.tasks_failed || 0;
    const rework = agent.reviewer_rework_count || 0;
    score -= failed * 2;
    score -= rework * 3;

    // Workload penalty: prefer idle/less busy agents
    const workload = agent.current_workload || 0;
    score -= workload * 10;

    // If criteria specifies a department, candidate must match department or have role match
    if (criteria.department && !deptMatch && agent.role.toLowerCase().trim() !== (criteria.role || "").toLowerCase().trim()) {
      continue;
    }

    // If candidate had at least one meaningful match (role, department, or capability)
    if (matched || (criteria.department && deptMatch) || (criteria.role && score >= 30)) {
      if (score > 0) {
        scoredCandidates.push({ agent, score });
      }
    }
  }

  if (scoredCandidates.length === 0) {
    return null;
  }

  // Sort by highest score first
  scoredCandidates.sort((a, b) => b.score - a.score);

  const best = scoredCandidates[0];
  const combined = Object.assign({}, best.agent, {
    agent: best.agent,
    score: best.score,
    reused: true,
  });

  return combined as SuitableAgentMatch;
}

export type AugmentedAgentReuseResult = AgentReuseResult & AiAgentConfig;

/**
 * Get or create suitable agent.
 *
 * Enforces DEFAULT REUSE:
 * 1. Searches existing workforce for matching agent.
 * 2. If suitable agent exists -> REUSE.
 * 3. Checks duplicate role prevention: if an agent with same role and department exists, reuse it.
 * 4. Only creates a new agent if no suitable agent exists and new specialization is genuinely required.
 * 5. Generated agent receives a deterministic, stable persistent ID (not a random disposable ID).
 */
export function getOrCreateSuitableAgent(params: {
  department: string;
  role: string;
  name?: string;
  level?: AgentLevel;
  requiredCapabilities?: string[];
  capabilities?: string[];
  purpose?: string;
  created_reason?: string;
  creatorId?: string;
}): AugmentedAgentReuseResult {
  const targetCapabilities = params.requiredCapabilities || params.capabilities || [];

  // Step 1: Search existing workforce for suitable agent
  const match = findSuitableAgent({
    department: params.department,
    role: params.role,
    requiredCapabilities: targetCapabilities,
    level: params.level,
  });

  if (match) {
    const existing = match.agent;
    // Backfill any missing safe capabilities to the reused agent within policy
    for (const cap of targetCapabilities) {
      if (!hasCapability(existing.id, cap)) {
        grantCapabilityToAgent({
          agentId: existing.id,
          capabilityCode: cap,
          grantedBy: "AI_CEO",
          sourcePolicy: "WORKFORCE_REUSE_GRANT",
        });
      }
    }

    const baseResult: AgentReuseResult = {
      action: "REUSED",
      agent: existing,
      reason: `Reused existing suitable agent '${existing.name}' (${existing.id}) in ${existing.department}. Experience: ${existing.tasks_completed || 0} tasks completed.`,
    };
    return Object.assign({}, existing, baseResult) as AugmentedAgentReuseResult;
  }

  // Step 2: Duplicate Role Prevention Check
  // Check if an agent already exists in the same department with the exact same role
  const allAgents = listAgents();
  const normalizedTargetRole = params.role.toLowerCase().trim();
  const duplicateRoleAgent = allAgents.find(
    (a) =>
      a.department.toUpperCase() === params.department.toUpperCase() &&
      a.role.toLowerCase().trim() === normalizedTargetRole &&
      a.status !== "RETIRED"
  );

  if (duplicateRoleAgent) {
    // Backfill any missing safe capabilities to the duplicate-prevention reused agent
    for (const cap of targetCapabilities) {
      if (!hasCapability(duplicateRoleAgent.id, cap)) {
        grantCapabilityToAgent({
          agentId: duplicateRoleAgent.id,
          capabilityCode: cap,
          grantedBy: "AI_CEO",
          sourcePolicy: "DUPLICATE_PREVENTION_GRANT",
        });
      }
    }

    const baseResult: AgentReuseResult = {
      action: "REUSED",
      agent: duplicateRoleAgent,
      reason: `Duplicate Role Prevention: Reused existing agent '${duplicateRoleAgent.name}' (${duplicateRoleAgent.id}) in ${duplicateRoleAgent.department} instead of creating duplicate role.`,
    };
    return Object.assign({}, duplicateRoleAgent, baseResult) as AugmentedAgentReuseResult;
  }

  // Step 3: No suitable agent exists -> Create new specialized agent with stable identity
  // Dynamically ensure department exists
  const reason = params.created_reason || `Genuinely new specialization required for ${params.role}`;
  getOrCreateDepartment(params.department, reason, "CEO");

  const roleSlug = params.role
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const deptSlug = params.department.toLowerCase();

  // Stable persistent ID format (e.g. agent_purchase_vendor_analyst_001)
  const baseId = `agent_${deptSlug}_${roleSlug}`;
  let stableId = `${baseId}_001`;

  // If stableId exists (e.g. previously retired), find next sequence number
  let counter = 1;
  while (allAgents.some((a) => a.id === stableId)) {
    counter++;
    stableId = `${baseId}_${String(counter).padStart(3, "0")}`;
  }

  const newAgent = createAutonomousAgent({
    creatorId: params.creatorId || "ceo_main",
    id: stableId,
    name: params.name || `${params.role} Specialist`,
    role: params.role,
    department: params.department,
    level: params.level || "SPECIALIST",
    purpose: params.purpose || `Execute ${params.role} responsibilities in ${params.department}`,
    capabilities: targetCapabilities.length > 0 ? targetCapabilities : ["COMPANY_DATA_READ", "DOCUMENT_SEARCH"],
    allowed_tools: ["READ_ONLY"],
    max_task_budget: 100.0,
    monthly_budget: 800.0,
    created_reason: reason,
  });

  // Grant role template blueprint capabilities
  const template = getRoleCapabilityTemplate(params.role);
  const initialCaps = template
    ? Array.from(new Set([...(template.standardCapabilities || []), ...targetCapabilities]))
    : targetCapabilities.length > 0
    ? targetCapabilities
    : ["COMPANY_DATA_READ", "DOCUMENT_SEARCH"];

  for (const cap of initialCaps) {
    grantCapabilityToAgent({
      agentId: newAgent.id,
      capabilityCode: cap,
      grantedBy: "AI_CEO",
      sourcePolicy: "ROLE_TEMPLATE_INIT",
    });
  }

  const baseResult: AgentReuseResult = {
    action: "CREATED",
    agent: newAgent,
    reason: `Genuinely new specialization required. Created stable specialist agent '${newAgent.name}' (${newAgent.id}) in ${newAgent.department}.`,
  };

  return Object.assign({}, newAgent, baseResult) as AugmentedAgentReuseResult;
}

/**
 * Record agent assignment to increment current workload.
 */
export function recordAgentTaskAssignment(agentId: string, taskId?: string): void {
  updateAgentWorkload(agentId, 1);
}

/**
 * Record agent task completion to decrement workload and update performance metrics.
 * Supports both signatures:
 * (agentId, taskId, success, actualCost, reworkCount)
 * (agentId, success, actualCost, reworkCount)
 */
export function recordAgentTaskCompletion(
  agentId: string,
  taskIdOrSuccess: string | boolean,
  successOrCost?: boolean | number,
  costOrRework?: number,
  reworkCount: number = 0
): void {
  let success = true;
  let actualCost = 0;
  let rework = 0;

  if (typeof taskIdOrSuccess === "boolean") {
    success = taskIdOrSuccess;
    actualCost = typeof successOrCost === "number" ? successOrCost : 0;
    rework = costOrRework || 0;
  } else {
    success = typeof successOrCost === "boolean" ? successOrCost : true;
    actualCost = typeof costOrRework === "number" ? costOrRework : 0;
    rework = reworkCount || 0;
  }

  recordAgentTaskOutcome(agentId, success, actualCost, rework);
}

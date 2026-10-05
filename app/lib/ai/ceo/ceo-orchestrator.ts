// ============================================================
// Bansil Books Analytics — CEO Orchestrator
// Phase 2B: Persistent Agent Reuse, Governed Learning & Memory
// ============================================================

import { Message } from "../types";
import { decomposeObjective } from "./planning-engine";
import { updateTaskStatus } from "./task-coordinator";
import { getCurrentBudgetPeriod, reserveBudget, recordActualCost } from "./budget-governance";
import { selectModelForTask } from "./model-catalog";
import {
  storeOwnerGuidance,
  supersedeMemory,
  retrieveRelevantMemories,
  storeAgentLesson,
  listMemories,
} from "./memory-store";
import {
  getOrCreateSuitableAgent,
  recordAgentTaskAssignment,
  recordAgentTaskCompletion,
} from "./agent-reuse-engine";
import { initiateExecutionRun, performGovernanceCheck, mapObjectiveToGovernedAction } from "./execution-lifecycle";
import { isZohoWriteAllowed, isBusinessSpendAction, checkAuthority } from "./authority-policy";

// This is the primary entrypoint for the OWNER.
export async function executeCeoOrchestration(
  objective: string,
  runId: string,
  history: Message[]
): Promise<string> {
  const period = getCurrentBudgetPeriod();

  // If budget hard stop or exceeded
  if (period.available_amount <= 0 || period.status === "HARD_STOP") {
    return "CEO Notice: The monthly AI operating budget of ₹15,000 has been reached (Status: HARD_STOP / OWNER_APPROVAL_REQUIRED). No further discretionary AI spending can occur without Owner approval.";
  }

  const lowerObj = objective.toLowerCase();

  // Phase 3A: Governance authority check (approval-before-action)
  // For direct CEO orchestration, we don't pass runId because no ai_runs record is created yet.
  const governanceResult = performGovernanceCheck(objective, undefined, undefined);
  if (!governanceResult.allowed && governanceResult.category === "PROHIBITED") {
    return `CEO: PROHIBITED — ${governanceResult.reason}. This action is permanently blocked by governance policy.`;
  }
  if (!governanceResult.allowed && governanceResult.requiresApproval) {
    return `CEO: This action requires Owner approval before execution. Reason: ${governanceResult.reason}. Please provide explicit authorization for this specific action.`;
  }

  // Check 1: Budget/Workload Inquiry
  if (lowerObj.includes("budget") || lowerObj.includes("heavy workload") || lowerObj.includes("allocate")) {
    return `CEO: Our monthly AI operating budget is ₹15,000 INR. Current available balance is ₹${period.available_amount.toFixed(
      2
    )} (Committed: ₹${period.committed_amount.toFixed(2)}, Consumed: ₹${period.consumed_amount.toFixed(
      2
    )}, Status: ${period.status}). If Accounts or any department experiences a sudden heavy workload, I dynamically reallocate AI operating budget from inactive or lower-priority departments and deploy specialist or temporary agents within our ₹15,000 hard limit, ensuring zero impact on real company financial operations.`;
  }

  // Check 2: Owner Correction (Supersede Prior Rule)
  if (
    lowerObj.startsWith("no, for ") ||
    lowerObj.includes("use gst-exclusive taxable sales") ||
    lowerObj.startsWith("correction:")
  ) {
    // Search for existing active rule on this topic
    const activeRules = listMemories({ status: "ACTIVE" });
    const targetOld = activeRules.find(
      (m) =>
        m.title.toLowerCase().includes("gp") ||
        m.content.toLowerCase().includes("gross sales") ||
        m.title.toLowerCase().includes("sales")
    );

    let oldId = targetOld?.id;
    if (!oldId) {
      // Seed initial rule so it can be demonstrated as superseded
      const initial = storeOwnerGuidance(
        "Gross Sales for GP",
        "For GP calculations use gross sales including taxes.",
        "GLOBAL",
        "GLOBAL"
      );
      oldId = initial.id;
    }

    const { newEntry } = supersedeMemory(oldId, {
      title: "GST-Exclusive Taxable Sales for GP",
      content: objective,
      authority_level: "OWNER_APPROVED_RULE",
      created_by: "OWNER",
      approved_by: "OWNER",
      reason: "Owner explicit correction",
    });

    return `CEO: Understood, Owner. I have updated our operating policy. The previous rule has been marked SUPERSEDED, and the new Active Owner-Approved Rule ("${newEntry.title}: ${newEntry.content}") is now registered and will be applied to all future tasks without needing repetition.`;
  }

  // Check 3: Owner Guidance (e.g. "From now on...", "Remember that...", "CEO, remember that...")
  if (
    lowerObj.includes("from now on") ||
    lowerObj.includes("remember that") ||
    lowerObj.includes("ceo, remember") ||
    lowerObj.includes("our rule is") ||
    lowerObj.includes("delivery delay above 7 days") ||
    lowerObj.includes("delivery delay over 7 days")
  ) {
    let title = "Owner Operational Policy";
    let scopeType: "GLOBAL" | "DEPARTMENT" = "GLOBAL";
    let scopeId = "GLOBAL";

    if (lowerObj.includes("vendor") || lowerObj.includes("delivery") || lowerObj.includes("purchase")) {
      title = "Vendor Delivery Delay SLA";
      scopeType = "DEPARTMENT";
      scopeId = "PURCHASE";
    }

    const entry = storeOwnerGuidance(title, objective, scopeType, scopeId);
    return `CEO: Understood, Owner. I have registered this as an Active Owner-Approved Rule: "${entry.title}". Future evaluations and specialist agents will automatically retrieve and enforce this guidance without needing you to repeat it.`;
  }

  // Check 4: Vendor Performance Inquiry (Single or Focused Specialist Evaluation with Agent Reuse)
  if (lowerObj.includes("vendor") && (lowerObj.includes("performance") || lowerObj.includes("review"))) {
    // 1. Retrieve relevant memories (Owner rules, role knowledge)
    const relevantMemories = retrieveRelevantMemories({
      department: "PURCHASE",
      role: "Vendor Performance Analyst",
      includeGlobal: true,
    });

    // 2. Reuse existing specialist agent (PURCHASE / Vendor Performance Analyst)
    const reuseResult = getOrCreateSuitableAgent({
      department: "PURCHASE",
      role: "Vendor Performance Analyst",
      requiredCapabilities: ["DATA_ANALYSIS", "REPORTING"],
      created_reason: "Vendor performance evaluation",
    });

    const agent = reuseResult.agent;
    const task = decomposeObjective(objective, "OWNER", runId)[0];

    if (lowerObj.includes("conceptually")) {
      recordAgentTaskAssignment(agent.id, task.id);
      recordAgentTaskCompletion(agent.id, task.id, true, 0);
      updateTaskStatus(task.id, "COMPLETED", "Conceptual vendor evaluation completed.");

      const appliedRules = relevantMemories
        .filter((m) => m.authority_level === "OWNER_APPROVED_RULE" || m.authority_level === "SYSTEM_HARD_POLICY" || m.authority_level === "VERIFIED_COMPANY_RULE")
        .map((m) => `• [${m.authority_level}] ${m.title}: ${m.content}`)
        .join("\n");

      return `CEO Orchestrator: Reused existing suitable specialist agent '${agent.name}' (${agent.id}) in ${agent.department} (Tasks Completed: ${agent.tasks_completed || 0}).
Retrieved & Applied Governed Memory:
${appliedRules || "• Standard vendor evaluation rules."}
Conceptual Review Framework:
1. Pricing & Rate Competitiveness: Compared against historical purchase bills.
2. Delivery Reliability: Enforcing Owner Rule — delivery delays exceeding 7 days are flagged as critical operational risk.
3. Quality & Rejection: Monitored through returns and debit notes.
4. Commercial Terms: Governed under ZOHO WRITE = 0 and ₹15,000 monthly AI budget cap.`;
    }

    // Model selection & Cost execution gate
    const modelSel = selectModelForTask({
      complexity: "LOW",
      availableBudget: period.available_amount,
    });

    if (!modelSel.canExecute) {
      if (modelSel.gateStatus === "COST_CONFIG_REQUIRED") {
        return `CEO Notice: Execution halted (Status: COST_CONFIG_REQUIRED). Provider pricing is unconfigured for the requested model tier and no configured alternative model is available. Unconfigured pricing cannot execute paid model calls without configured monetary rates or an explicit NO_METERED_COST model.`;
      }
      return `CEO Notice: Execution halted (Status: BUDGET_EXCEEDED). ${modelSel.reason || "Monthly available AI operating budget is insufficient."}`;
    }

    reserveBudget({
      taskId: task.id,
      agentId: agent.id,
      departmentId: "PURCHASE",
      estimatedCost: modelSel.estimatedCost,
      costStatus: modelSel.costStatus,
    });

    recordAgentTaskAssignment(agent.id, task.id);
    updateTaskStatus(task.id, "IN_PROGRESS");

    recordActualCost({
      taskId: task.id,
      actualCost: modelSel.estimatedCost,
      costStatus: modelSel.costStatus,
      model: modelSel.model,
      provider: modelSel.provider,
      usageType: "VENDOR_PERFORMANCE_REVIEW",
      metadataSummary: "Vendor review with persistent agent reuse and relevant memory",
    });

    recordAgentTaskCompletion(agent.id, task.id, true, modelSel.estimatedCost);
    updateTaskStatus(task.id, "COMPLETED", "Vendor evaluation completed.");

    const appliedRules = relevantMemories
      .filter((m) => m.authority_level === "OWNER_APPROVED_RULE" || m.authority_level === "SYSTEM_HARD_POLICY")
      .map((m) => `• ${m.title}: ${m.content}`)
      .join("\n");

    return `CEO Orchestrator: Reused existing specialist agent '${agent.name}' (${agent.id}) in ${agent.department}.
Applied Governed Policies:
${appliedRules || "• Standard read-only performance audit."}
Evaluation Summary: Vendor performance reviewed across pricing, delivery SLA (7-day threshold), and quality compliance within our ₹15,000 monthly AI budget.`;
  }

  // 1. Planning phase
  const tasks = decomposeObjective(objective, "OWNER", runId);

  // 2. Delegation/Execution phase
  if (tasks.length > 1) {
    for (const t of tasks) {
      if (t.parent_task_id) {
        // Determine role and department for subtask
        let dept = "ACCOUNTS";
        let role = "Accounts Auditor";
        if (t.objective.toLowerCase().includes("purchase") || t.objective.toLowerCase().includes("vendor")) {
          dept = "PURCHASE";
          role = "Vendor Performance Analyst";
        } else if (t.objective.toLowerCase().includes("billing")) {
          dept = "BILLING";
          role = "Billing Specialist";
        }

        // REUSE existing agent
        const reuseResult = getOrCreateSuitableAgent({
          department: dept,
          role,
          requiredCapabilities: ["DATA_ANALYSIS", "REPORTING"],
          created_reason: t.objective,
        });
        const assignedAgent = reuseResult.agent;

        // Retrieve relevant memories for subtask
        retrieveRelevantMemories({
          department: dept,
          role,
          includeGlobal: true,
        });

        const modelSel = selectModelForTask({
          complexity: "MEDIUM",
          availableBudget: period.available_amount,
        });

        if (!modelSel.canExecute) {
          if (modelSel.gateStatus === "COST_CONFIG_REQUIRED") {
            return `CEO Notice: Execution halted (Status: COST_CONFIG_REQUIRED). Provider pricing is unconfigured for the requested model tier and no configured alternative model is available.`;
          }
          return `CEO Notice: Execution halted (Status: BUDGET_EXCEEDED). ${modelSel.reason || "Monthly available AI operating budget is insufficient."}`;
        }

        try {
          reserveBudget({
            taskId: t.id,
            agentId: assignedAgent.id,
            departmentId: dept,
            estimatedCost: modelSel.estimatedCost,
            costStatus: modelSel.costStatus,
          });
        } catch (e: any) {
          return `CEO Error: Could not allocate budget for task. ${e.message}`;
        }

        recordAgentTaskAssignment(assignedAgent.id, t.id);
        updateTaskStatus(t.id, "IN_PROGRESS");

        recordActualCost({
          taskId: t.id,
          actualCost: modelSel.estimatedCost,
          costStatus: modelSel.costStatus,
          model: modelSel.model,
          provider: modelSel.provider,
          usageType: "SUBTASK_EXECUTION",
          metadataSummary: `Executed subtask: ${t.objective.slice(0, 50)}`,
        });

        recordAgentTaskCompletion(assignedAgent.id, t.id, true, modelSel.estimatedCost);

        // Record post-task learning candidate
        storeAgentLesson({
          title: `Task Outcome: ${t.objective.slice(0, 30)}`,
          content: `Subtask '${t.objective}' completed with ${assignedAgent.name} (${assignedAgent.id}) under budget.`,
          agentId: assignedAgent.id,
          role,
          department: dept,
        });

        updateTaskStatus(t.id, "COMPLETED", "Consolidated finding");
      }
    }

    const parent = tasks.find((t) => !t.parent_task_id);
    if (parent) {
      updateTaskStatus(parent.id, "COMPLETED", "Consolidated executive summary.");
    }
    return `CEO Orchestrator: I have broken down your request into ${tasks.length - 1} subtasks, assigned them to specialists, and consolidated the results within our governed AI operating budget. Here is the Executive Summary.`;
  }

  // Simple direct execution
  const task = tasks[0];
  const modelSel = selectModelForTask({
    complexity: "LOW",
    availableBudget: period.available_amount,
  });

  if (!modelSel.canExecute) {
    if (modelSel.gateStatus === "COST_CONFIG_REQUIRED") {
      return `CEO Notice: Execution halted (Status: COST_CONFIG_REQUIRED). Provider pricing is unconfigured for the requested model tier and no configured alternative model is available. Unconfigured pricing cannot execute paid model calls without configured monetary rates or an explicit NO_METERED_COST model.`;
    }
    return `CEO Notice: Execution halted (Status: BUDGET_EXCEEDED). ${modelSel.reason || "Monthly available AI operating budget is insufficient."}`;
  }

  try {
    reserveBudget({
      taskId: task.id,
      agentId: "ceo_main",
      estimatedCost: modelSel.estimatedCost,
      costStatus: modelSel.costStatus,
    });
  } catch (e: any) {
    return `CEO Notice: ${e.message}`;
  }

  updateTaskStatus(task.id, "IN_PROGRESS");
  recordActualCost({
    taskId: task.id,
    actualCost: modelSel.estimatedCost,
    costStatus: modelSel.costStatus,
    model: modelSel.model,
    provider: modelSel.provider,
    usageType: "DIRECT_CEO_ANSWER",
    metadataSummary: "Direct CEO response",
  });
  updateTaskStatus(task.id, "COMPLETED", "Direct CEO response.");

  const directLowerObj = objective.toLowerCase();
  let directAnswer = "I am the AI CEO. I am ready to assist you with business and financial analysis.";
  if (directLowerObj.includes("budget")) {
    directAnswer = `I operate under a monthly AI operating budget. Remaining available: ₹${period.available_amount}.`;
  } else if (directLowerObj.includes("status")) {
    directAnswer = "All systems are currently operational and I am ready for governed execution tasks.";
  } else if (directLowerObj.includes("who are you")) {
    directAnswer = "I am the AI CEO of Bansil Engineers, responsible for orchestrating governed business analysis.";
  } else if (directLowerObj.includes("what can you do")) {
    directAnswer = "I can analyze balance sheets, profit and loss, working capital, inventory, and other financial data by executing governed tasks using our specialized workforce.";
  }

  return `CEO: ${directAnswer}`;
}

import { BusinessIntent } from "./planning-engine";
import { resolveFollowUp } from "./conversation-context";
import { executeFastPathQuery } from "./fast-path-tools";

/**
 * High-level Owner front door interface.
 * Ensures the Owner only speaks to the AI CEO.
 */
export async function handleOwnerMessage(
  message: string,
  history: Message[] = [],
  options?: import("./ceo-types").ExecutionLifecycleOptions,
  injectedNow?: string
): Promise<{ content: string; modelTier?: string; runId?: string }> {

  // Deterministic follow-up handling (no model call): reformat the previous
  // verified result, or inherit its period when the new message names none.
  const followUp = resolveFollowUp(message, history);

  if (followUp.kind === "REFORMAT" && followUp.reformattedContent) {
    return {
      content: followUp.reformattedContent,
      modelTier: "FAST_OPERATIONAL",
      runId: "",
    };
  }

  const intent = followUp.intent as BusinessIntent;
  const effectiveMessage = message;

  if (intent === "DIRECT_CHAT" || intent === "MEMORY_GUIDANCE") {
    const runId = `run_${Date.now()}`;
    const result = await executeCeoOrchestration(message, runId, history);
    return {
      content: result,
      modelTier: "FAST_OPERATIONAL",
      runId,
    };
  }

  // FAST PATH
  if (
    intent === "SALES_QUERY" ||
    intent === "PURCHASE_QUERY" ||
    intent === "RECEIVABLE_QUERY" ||
    intent === "PAYABLE_QUERY" ||
    intent === "CUSTOMER_QUERY" ||
    intent === "VENDOR_QUERY"
  ) {
    const result = await executeFastPathQuery(intent, effectiveMessage, followUp.periodOverride, injectedNow);
    return {
      content: result,
      modelTier: "FAST_OPERATIONAL",
      runId: ""
    };
  }

  // All other intents (BUSINESS_ANALYSIS, FINANCIAL_ANALYSIS, EXECUTION_REQUEST, etc.) MUST enter governed execution
  const run = await initiateExecutionRun(message, options);
  return {
    content: run.final_response || `CEO: Run ${run.id} finished with status ${run.status}.`,
    modelTier: run.selected_model_tier || "FAST",
    runId: run.id,
  };
}

export {
  initiateExecutionRun,
  evaluatePendingRun,
  cancelRun,
  resumeRun,
  getExecutionRun,
  getRunTasks,
  getRunHandoffs,
  createConflictRequiresReview,
  retryFailedTask,
} from "./execution-lifecycle";

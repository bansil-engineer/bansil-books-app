// ============================================================
// Bansil Books Analytics — Phase 3D: Self-Correction & Proactive Management Engine
// Detect -> Classify -> Root Cause -> Safe Check -> Correct -> Rerun ->
// Independent Checker Verify -> Governed Candidate Lesson -> Prevent Recurrence
// ============================================================

import crypto from "node:crypto";
import { getAiDatabase } from "../../db/ai-database";
import {
  GovernedActionType,
  RiskLevel,
  CeoResponseStatus,
} from "./governance-types";
import {
  classifyAction,
  classifyRisk,
  isZohoWriteAllowed,
  requiresEscalation,
} from "./authority-policy";
import {
  determineReviewRequirement,
  getOrCreateIndependentChecker,
  evaluateEvidence,
  recordReview,
  CheckerOutcome,
  ReviewType,
} from "./independent-checker";
import {
  recordMemoryEntry,
  validateAgainstHardPolicies,
  storeAgentLesson,
} from "./memory-store";
import { enforceAgentReusePolicy } from "./cost-routing-engine";
import { listAgents } from "./agent-registry";
import { recordTaskRetry, updateTaskStatus, getTask } from "./task-coordinator";
import { reserveBudget, getCurrentBudgetPeriod } from "./budget-governance";

// ==================== ROOT CAUSE CATEGORIES ====================

export type RootCauseCategory =
  | "READ_ONLY_API_FAILURE"
  | "DETERMINISTIC_SQL_FAILURE"
  | "TEMPORARY_SOURCE_FAILURE"
  | "SAFE_CALCULATION_BUG"
  | "AGENT_ASSIGNMENT_MISMATCH"
  | "INTERNAL_FORMATTING_ISSUE"
  | "NON_DESTRUCTIVE_PLANNING_ERROR"
  | "UNSAFE_FINANCIAL_ACTION"
  | "ZOHO_WRITE_ATTEMPT"
  | "DESTRUCTIVE_OPERATIONAL_ACTION"
  | "PAYMENT_ACTION"
  | "STATUTORY_ACTION"
  | "ACCOUNTING_WRITE"
  | "CONTRACT_COMMITMENT"
  | "UNKNOWN_FAILURE";

export type CorrectionActionType =
  | "RETRY_READ"
  | "RECALCULATE_SQL"
  | "REASSIGN_AGENT"
  | "REFORMAT_OUTPUT"
  | "GATHER_MORE_EVIDENCE"
  | "REQUEST_CHECKER"
  | "ESCALATE_TO_OWNER"
  | "BLOCK_EXECUTION";

export interface FailureClassification {
  category: RootCauseCategory;
  safeToSelfCorrect: boolean;
  requiresEscalation: boolean;
  escalationReason?: string;
  recommendedAction: CorrectionActionType;
  description: string;
}

export interface SelfCorrectionRecord {
  id: string;
  runId: string;
  taskId: string;
  attemptNumber: number;
  failureReason: string;
  rootCauseCategory: RootCauseCategory;
  correctionAction: CorrectionActionType;
  verificationResult: "PENDING" | "VERIFIED_PASS" | "CHECKER_REJECT" | "ESCALATED" | "FAILED";
  checkerNotes?: string;
  lessonRecorded: boolean;
  candidateLessonId?: string;
  createdAt: string;
}

export interface CandidateLessonPayload {
  problem: string;
  rootCause: RootCauseCategory;
  fix: string;
  verification: string;
  scope: "AGENT" | "DEPARTMENT" | "GLOBAL";
  confidence: number;
  applicableContext: string;
  agentId?: string;
}

// ==================== FAILURE DETECTION & CLASSIFICATION ====================

/**
 * Classifies an internal or external failure deterministically into a root cause category.
 * Evaluates whether it is safe for the CEO to self-correct autonomously.
 */
export function classifyFailure(params: {
  error: any;
  actionType: GovernedActionType;
  target?: string;
  objective?: string;
}): FailureClassification {
  const { error, actionType, target = "", objective = "" } = params;
  const errMsg = typeof error === "string" ? error : error?.message || String(error || "");
  const lowerMsg = errMsg.toLowerCase();
  const lowerObj = objective.toLowerCase();
  const lowerTarget = target.toLowerCase();

  // 1. ZOHO WRITE ATTEMPTS — Strictly Prohibited / Escalate
  if (
    actionType === "ZOHO_WRITE" ||
    lowerMsg.includes("zoho_write") ||
    lowerMsg.includes("zoho write") ||
    lowerObj.includes("zoho write") ||
    (lowerTarget.includes("zoho") && (lowerObj.includes("post") || lowerObj.includes("put") || lowerObj.includes("delete")))
  ) {
    return {
      category: "ZOHO_WRITE_ATTEMPT",
      safeToSelfCorrect: false,
      requiresEscalation: true,
      escalationReason: "ZOHO WRITE is strictly prohibited (ZOHO WRITE = 0). Cannot self-correct mutation of Zoho data.",
      recommendedAction: "BLOCK_EXECUTION",
      description: "Attempted prohibited write to Zoho Books",
    };
  }

  // 2. UNSAFE FINANCIAL & PAYMENT ACTIONS — Escalate to Owner
  if (
    actionType === "BANK_PAYMENT" ||
    actionType === "VENDOR_PAYMENT_APPROVAL" ||
    actionType === "ACCEPT_PURCHASE" ||
    lowerObj.includes("pay vendor") ||
    lowerObj.includes("bank transfer") ||
    lowerObj.includes("disburse") ||
    lowerMsg.includes("payment")
  ) {
    return {
      category: "PAYMENT_ACTION",
      safeToSelfCorrect: false,
      requiresEscalation: true,
      escalationReason: "Real bank/vendor payment requires explicit Owner approval and cannot be self-corrected by AI CEO.",
      recommendedAction: "ESCALATE_TO_OWNER",
      description: "Financial disbursement requires Owner authorization",
    };
  }

  // 3. STATUTORY ACTIONS — Escalate to Owner
  if (
    actionType === "STATUTORY_FILING" ||
    lowerObj.includes("statutory") ||
    lowerObj.includes("gst filing") ||
    lowerObj.includes("tds return")
  ) {
    return {
      category: "STATUTORY_ACTION",
      safeToSelfCorrect: false,
      requiresEscalation: true,
      escalationReason: "Statutory filings and tax compliance submissions require human Owner verification and sign-off.",
      recommendedAction: "ESCALATE_TO_OWNER",
      description: "Statutory filing requires human sign-off",
    };
  }

  // 4. CONTRACT & QUOTATION COMMITMENTS — Escalate to Owner
  if (
    actionType === "SIGN_CONTRACT" ||
    actionType === "BINDING_QUOTATION" ||
    lowerObj.includes("sign contract") ||
    lowerObj.includes("binding quotation")
  ) {
    return {
      category: "CONTRACT_COMMITMENT",
      safeToSelfCorrect: false,
      requiresEscalation: true,
      escalationReason: "Legally binding commitments require explicit Owner execution authority.",
      recommendedAction: "ESCALATE_TO_OWNER",
      description: "Contractual commitment requires Owner signature",
    };
  }

  // 5. ACCOUNTING WRITES & SALARY CHANGES — Escalate to Owner
  if (
    actionType === "ACCOUNTING_WRITE" ||
    actionType === "CHANGE_SALARY" ||
    lowerObj.includes("salary change") ||
    lowerObj.includes("modify journal")
  ) {
    return {
      category: "ACCOUNTING_WRITE",
      safeToSelfCorrect: false,
      requiresEscalation: true,
      escalationReason: "Direct accounting ledger mutations and payroll modifications require Owner sign-off.",
      recommendedAction: "ESCALATE_TO_OWNER",
      description: "Accounting/payroll alteration requires Owner approval",
    };
  }

  // 6. DESTRUCTIVE ACTIONS (Deletion without backup) — Escalate
  if (
    actionType === "PERMANENT_DATA_DELETION" ||
    lowerObj.includes("delete permanently") ||
    lowerObj.includes("drop table") ||
    lowerMsg.includes("destructive")
  ) {
    return {
      category: "DESTRUCTIVE_OPERATIONAL_ACTION",
      safeToSelfCorrect: false,
      requiresEscalation: true,
      escalationReason: "Destructive operations on databases or company assets require Owner approval and verified backup.",
      recommendedAction: "ESCALATE_TO_OWNER",
      description: "Destructive data deletion attempt",
    };
  }

  // 7. SAFE INTERNAL FAILURES — Safe to Self-Correct

  // A. Agent assignment mismatch
  if (
    lowerMsg.includes("agent mismatch") ||
    lowerMsg.includes("missing capability") ||
    lowerMsg.includes("unsuitable agent") ||
    lowerMsg.includes("capability not found")
  ) {
    return {
      category: "AGENT_ASSIGNMENT_MISMATCH",
      safeToSelfCorrect: true,
      requiresEscalation: false,
      recommendedAction: "REASSIGN_AGENT",
      description: "Task was routed to an agent lacking required capability; reassigning to suitable agent.",
    };
  }

  // B. Safe deterministic SQL failure (e.g. syntax, lock, table alias)
  if (
    lowerMsg.includes("sqlite") ||
    lowerMsg.includes("no such column") ||
    lowerMsg.includes("syntax error in sql") ||
    lowerMsg.includes("database is locked") ||
    lowerMsg.includes("query_error")
  ) {
    return {
      category: "DETERMINISTIC_SQL_FAILURE",
      safeToSelfCorrect: true,
      requiresEscalation: false,
      recommendedAction: "RECALCULATE_SQL",
      description: "Deterministic local SQL error or lock contention; safe to retry or recalculate query.",
    };
  }

  // C. Temporary read-only API or source failure
  if (
    lowerMsg.includes("network") ||
    lowerMsg.includes("timeout") ||
    lowerMsg.includes("econnrefused") ||
    lowerMsg.includes("econnreset") ||
    lowerMsg.includes("temporary source failure") ||
    lowerMsg.includes("stale_data")
  ) {
    return {
      category: "TEMPORARY_SOURCE_FAILURE",
      safeToSelfCorrect: true,
      requiresEscalation: false,
      recommendedAction: "RETRY_READ",
      description: "Transient read-only source failure; safe to retry fetch.",
    };
  }

  // D. Safe calculation bug / math inconsistency
  if (
    lowerMsg.includes("calculation_error") ||
    lowerMsg.includes("math error") ||
    lowerMsg.includes("division by zero") ||
    lowerMsg.includes("rounding mismatch")
  ) {
    return {
      category: "SAFE_CALCULATION_BUG",
      safeToSelfCorrect: true,
      requiresEscalation: false,
      recommendedAction: "RECALCULATE_SQL",
      description: "Deterministic calculation bug; safe to recalculate with corrected formula.",
    };
  }

  // E. Formatting / table presentation issue
  if (
    lowerMsg.includes("format_error") ||
    lowerMsg.includes("json parse") ||
    lowerMsg.includes("invalid markdown table")
  ) {
    return {
      category: "INTERNAL_FORMATTING_ISSUE",
      safeToSelfCorrect: true,
      requiresEscalation: false,
      recommendedAction: "REFORMAT_OUTPUT",
      description: "Output formatting error; safe to reformat deterministic output.",
    };
  }

  // Default: Check authority policy matrix
  const matrix = classifyAction(actionType);
  if (matrix.category === "OWNER_APPROVAL_REQUIRED" || matrix.category === "PROHIBITED") {
    return {
      category: "UNSAFE_FINANCIAL_ACTION",
      safeToSelfCorrect: false,
      requiresEscalation: true,
      escalationReason: `Action ${actionType} is classified as ${matrix.category} and cannot be self-corrected autonomously.`,
      recommendedAction: "ESCALATE_TO_OWNER",
      description: `Governed action ${actionType} requires Owner intervention`,
    };
  }

  return {
    category: "READ_ONLY_API_FAILURE",
    safeToSelfCorrect: true,
    requiresEscalation: false,
    recommendedAction: "RETRY_READ",
    description: "Generic read failure; safe to retry read-only operation.",
  };
}

// ==================== DETERMINISTIC RETRY & BOUNDARY SAFETY ====================

export const MAX_DETERMINISTIC_RETRIES = 3;

/**
 * Checks whether retry count exceeds the allowed threshold.
 * Prevents infinite loops.
 */
export function hasExceededRetryLimit(params: {
  currentRetries: number;
  maxRetries?: number;
}): boolean {
  const max = params.maxRetries ?? MAX_DETERMINISTIC_RETRIES;
  return params.currentRetries >= max;
}

/**
 * Records a self-correction recovery attempt in the database audit log.
 */
export function recordRecoveryAttempt(params: {
  runId: string;
  taskId: string;
  attemptNumber: number;
  failureReason: string;
  rootCauseCategory: RootCauseCategory;
  correctionAction: CorrectionActionType;
  verificationResult: "PENDING" | "VERIFIED_PASS" | "CHECKER_REJECT" | "ESCALATED" | "FAILED";
  checkerNotes?: string;
  candidateLessonId?: string;
}): SelfCorrectionRecord {
  const db = getAiDatabase();
  const id = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const now = new Date().toISOString();

  const record: SelfCorrectionRecord = {
    id,
    runId: params.runId,
    taskId: params.taskId,
    attemptNumber: params.attemptNumber,
    failureReason: params.failureReason,
    rootCauseCategory: params.rootCauseCategory,
    correctionAction: params.correctionAction,
    verificationResult: params.verificationResult,
    checkerNotes: params.checkerNotes,
    lessonRecorded: Boolean(params.candidateLessonId),
    candidateLessonId: params.candidateLessonId,
    createdAt: now,
  };

  db.prepare(`
    INSERT INTO ai_audit_events (id, run_id, event_type, details, created_at)
    VALUES (?, ?, 'SELF_CORRECTION_ATTEMPT', ?, ?)
  `).run(id, params.runId, JSON.stringify(record), now);

  return record;
}

// ==================== AGENT REASSIGNMENT LOGIC ====================

/**
 * Reassigns a task to an existing suitable agent, or creates one only if capability is genuinely missing.
 */
export function reassignTaskAgent(params: {
  taskId: string;
  requiredCapabilities: string[];
  department: string;
  role: string;
  purpose: string;
}): { agentId: string; action: "REUSED" | "CREATED" | "FALLBACK_CEO"; reason: string } {
  const result = enforceAgentReusePolicy({
    department: params.department,
    role: params.role,
    requiredCapabilities: params.requiredCapabilities,
    purpose: params.purpose,
  });

  const db = getAiDatabase();
  db.prepare(`
    UPDATE ai_tasks
    SET assigned_agent_id = ?, department = ?
    WHERE id = ?
  `).run(result.agent.id, params.department, params.taskId);

  return {
    agentId: result.agent.id,
    action: result.action,
    reason: result.reason,
  };
}

// ==================== CHECKER INTEGRATION FOR CORRECTIONS ====================

/**
 * Verifies a material self-correction result using the Independent Checker.
 */
export function verifyCorrectionWithChecker(params: {
  taskId: string;
  runId: string;
  workerAgentId: string;
  objective: string;
  correctedResult: string;
  riskLevel: RiskLevel;
  evidenceReferences?: string[];
  knownLimitations?: string[];
}): {
  allowed: boolean;
  verdict: CheckerOutcome;
  notes?: string;
  evidenceRef?: string;
} {
  // Low-risk deterministic corrections do not require expensive checker
  if (params.riskLevel === "LOW") {
    return {
      allowed: true,
      verdict: "PASS",
    };
  }

  // Material corrections require Independent Checker
  const req = determineReviewRequirement({
    objective: params.objective,
    riskLevel: params.riskLevel,
    isMaterial: true,
  });

  if (!req.required) {
    return { allowed: true, verdict: "PASS" };
  }

  // Pick/reuse suitable checker agent
  const checkerSelection = getOrCreateIndependentChecker({
    workerId: params.workerAgentId,
    reviewType: req.reviewType,
    riskLevel: params.riskLevel,
  });

  // Evaluate evidence independently
  const evalResult = evaluateEvidence(
    {
      objective: params.objective,
      workerResult: params.correctedResult,
      evidenceReferences: params.evidenceReferences || [],
      riskLevel: params.riskLevel,
      knownLimitations: params.knownLimitations,
    },
    checkerSelection.agent.id,
    params.workerAgentId
  );

  // Persist review record
  recordReview({
    runId: params.runId,
    taskId: params.taskId,
    workerId: params.workerAgentId,
    checkerId: checkerSelection.agent.id,
    reviewType: req.reviewType,
    riskLevel: params.riskLevel,
    evidenceReviewed: evalResult.evidenceReferences,
    result: evalResult.result,
    notes: evalResult.notes,
  });

  const verdict = evalResult.result;
  const notes = evalResult.notes;

  if (verdict === "PASS") {
    return { allowed: true, verdict: "PASS", notes };
  }

  if (verdict === "PASS_WITH_NOTES") {
    return { allowed: true, verdict: "PASS_WITH_NOTES", notes };
  }

  if (verdict === "INSUFFICIENT_EVIDENCE") {
    return {
      allowed: false,
      verdict: "INSUFFICIENT_EVIDENCE",
      notes: notes || "Insufficient evidence provided for correction verification",
    };
  }

  // REJECT
  return {
    allowed: false,
    verdict: "REJECT",
    notes: notes || "Independent checker rejected corrected result",
  };
}

// ==================== GOVERNED CANDIDATE LESSON ====================

/**
 * Records a candidate lesson strictly after verified self-correction.
 *
 * Rules:
 * 1. Must never override SYSTEM_HARD_POLICY (100) or OWNER_APPROVED_RULE (80).
 * 2. Starts with authority AGENT_LEARNED_LESSON (20) and status CANDIDATE.
 * 3. Never auto-promoted to hard policy.
 * 4. Deduplicates identical lessons to avoid redundant entries.
 */
export function recordGovernedLesson(payload: CandidateLessonPayload): {
  success: boolean;
  lessonId?: string;
  deduplicated: boolean;
  error?: string;
} {
  // 1. Verify against hard policies (ZOHO WRITE = 0, ₹15k budget, no company money, no security bypass)
  try {
    validateAgainstHardPolicies(payload.problem, `${payload.rootCause} ${payload.fix}`);
  } catch (err: any) {
    return {
      success: false,
      deduplicated: false,
      error: `Hard policy violation: ${err.message}`,
    };
  }

  const db = getAiDatabase();
  const title = `Self-Correction Lesson: ${payload.rootCause}`;
  const content = JSON.stringify({
    problem: payload.problem,
    rootCause: payload.rootCause,
    fix: payload.fix,
    verification: payload.verification,
    context: payload.applicableContext,
  });

  // 2. Deduplication check: check if an identical or near-identical lesson already exists
  const existing = db.prepare(`
    SELECT id, title, content, status FROM ai_memory_entries
    WHERE title = ? AND scope_type = ? AND status IN ('ACTIVE', 'CANDIDATE')
    LIMIT 1
  `).get(title, payload.scope) as { id: string; content: string } | undefined;

  if (existing) {
    try {
      const parsed = JSON.parse(existing.content);
      if (parsed.problem === payload.problem && parsed.fix === payload.fix) {
        return {
          success: true,
          lessonId: existing.id,
          deduplicated: true,
        };
      }
    } catch {
      // not JSON, continue
    }
  }

  // 3. Record governed memory entry at lowest authority level (AGENT_LEARNED_LESSON, status CANDIDATE)
  const entry = recordMemoryEntry({
    memory_type: "AGENT_LEARNING",
    scope_type: payload.scope,
    scope_id: payload.scope,
    title,
    content,
    source_type: "SYSTEM",
    source_reference: `Self-Correction Engine: ${payload.rootCause}`,
    authority_level: "AGENT_LEARNED_LESSON", // Weight 20 (strictly below hard policy and owner rule)
    confidence: payload.confidence || 0.75,
    status: "CANDIDATE",
    effective_from: new Date().toISOString(),
    created_by: payload.agentId || "ceo_self_correction_engine",
    metadata: {
      rootCause: payload.rootCause,
      verification: payload.verification,
      problem: payload.problem,
    },
  });

  return {
    success: true,
    lessonId: entry.id,
    deduplicated: false,
  };
}

// ==================== CROSS-DEPARTMENT COORDINATION ====================

export interface DepartmentContribution {
  department: string;
  agentId: string;
  taskObjective: string;
  finding: string;
  evidenceRef?: string;
  cost: number;
}

export interface ConsolidatedCeoReport {
  objective: string;
  executiveSummary: string;
  departmentsInvolved: string[];
  findingsByDepartment: Record<string, string>;
  checkerStatus: "CHECKED" | "NOT_REQUIRED" | "REJECTED";
  checkerNotes?: string;
  rawAgentChatterSuppressed: boolean;
  totalEstimatedCost: number;
  status: CeoResponseStatus;
}

/**
 * Plans and coordinates tasks across multiple departments for complex management questions
 * (e.g., "Why is project margin low?").
 */
export function planCrossDepartmentInvestigation(objective: string): {
  departments: string[];
  departmentTasks: Array<{ department: string; subObjective: string; requiredCapability: string }>;
} {
  const lower = objective.toLowerCase();
  const departments: string[] = [];
  const departmentTasks: Array<{ department: string; subObjective: string; requiredCapability: string }> = [];

  // Project margin analysis cross-department plan
  if (lower.includes("margin") || lower.includes("profitability") || lower.includes("cost overrun")) {
    departments.push("ACCOUNTS", "PURCHASE", "BILLING", "FINANCE");
    departmentTasks.push(
      {
        department: "ACCOUNTS",
        subObjective: "Analyze ledger gross profit and billed revenue trends",
        requiredCapability: "data_analysis",
      },
      {
        department: "PURCHASE",
        subObjective: "Identify material purchase price variances and raw material inflation",
        requiredCapability: "vendor_analytics",
      },
      {
        department: "BILLING",
        subObjective: "Audit unbilled retention and customer milestone delays",
        requiredCapability: "commercial_trace",
      },
      {
        department: "FINANCE",
        subObjective: "Synthesize working capital carrying cost and overall project margin impact",
        requiredCapability: "financial_review",
      }
    );
  } else {
    // General multi-department fallback
    departments.push("SALES", "PURCHASE");
    departmentTasks.push(
      {
        department: "SALES",
        subObjective: `Extract sales metrics for: ${objective}`,
        requiredCapability: "data_analysis",
      },
      {
        department: "PURCHASE",
        subObjective: `Extract vendor expense metrics for: ${objective}`,
        requiredCapability: "vendor_analytics",
      }
    );
  }

  return { departments, departmentTasks };
}

/**
 * Consolidates department contributions into a single, clean executive response for the Owner.
 * Strictly suppresses internal raw worker chatter.
 */
export function consolidateCrossDepartmentResponse(params: {
  objective: string;
  contributions: DepartmentContribution[];
  checkerResult?: { passed: boolean; notes?: string };
}): ConsolidatedCeoReport {
  const departmentsInvolved = Array.from(new Set(params.contributions.map((c) => c.department)));
  const findingsByDepartment: Record<string, string> = {};
  let totalEstimatedCost = 0;

  for (const contrib of params.contributions) {
    findingsByDepartment[contrib.department] = contrib.finding;
    totalEstimatedCost += contrib.cost || 0;
  }

  const executiveSummary =
    `Executive Synthesis for '${params.objective}':\n` +
    `Cross-department coordination completed across ${departmentsInvolved.join(", ")}. ` +
    `Key drivers: ${params.contributions.map((c) => `${c.department}: ${c.finding.slice(0, 80)}...`).join(" | ")}`;

  let checkerStatus: "CHECKED" | "NOT_REQUIRED" | "REJECTED" = "NOT_REQUIRED";
  let status: CeoResponseStatus = "COMPLETED";

  if (params.checkerResult) {
    if (params.checkerResult.passed) {
      checkerStatus = "CHECKED";
      if (params.checkerResult.notes) {
        status = "COMPLETED_WITH_NOTES";
      }
    } else {
      checkerStatus = "REJECTED";
      status = "FAILED";
    }
  }

  return {
    objective: params.objective,
    executiveSummary,
    departmentsInvolved,
    findingsByDepartment,
    checkerStatus,
    checkerNotes: params.checkerResult?.notes,
    rawAgentChatterSuppressed: true,
    totalEstimatedCost,
    status,
  };
}

// ==================== PROACTIVE FOLLOW-UP INSPECTION ====================

export interface SystemHealthIssue {
  type: "BLOCKED_TASK" | "MISSING_EVIDENCE" | "FAILED_INTERNAL_JOB" | "REVIEW_REJECTION" | "BUDGET_EXHAUSTION";
  entityId: string;
  severity: "LOW" | "HIGH" | "CRITICAL";
  details: string;
  recommendedAction: "RETRY" | "REASSIGN" | "COLLECT_EVIDENCE" | "ESCALATE";
}

/**
 * Proactively inspects the system state for blocked tasks, failed jobs, or review rejections.
 * Pure deterministic run logic — does NOT run uncontrolled background loops.
 */
export function inspectSystemHealthAndFollowUp(): SystemHealthIssue[] {
  const db = getAiDatabase();
  const issues: SystemHealthIssue[] = [];

  // 1. Check for failed/blocked tasks that can be retried
  const failedTasks = db.prepare(`
    SELECT id, objective, failure_reason, retry_count, max_retries
    FROM ai_tasks
    WHERE status = 'FAILED' AND retry_count < max_retries
    ORDER BY created_at DESC LIMIT 5
  `).all() as Array<{ id: string; objective: string; failure_reason: string; retry_count: number; max_retries: number }>;

  for (const t of failedTasks) {
    issues.push({
      type: "FAILED_INTERNAL_JOB",
      entityId: t.id,
      severity: "LOW",
      details: `Task '${t.id}' failed (${t.failure_reason}); eligible for retry (${t.retry_count}/${t.max_retries}).`,
      recommendedAction: "RETRY",
    });
  }

  // 2. Check for review rejections
  const rejectedRuns = db.prepare(`
    SELECT id, failure_reason FROM ai_runs
    WHERE status = 'FAILED' AND reviewer_required = 1
    ORDER BY created_at DESC LIMIT 3
  `).all() as Array<{ id: string; failure_reason: string }>;

  for (const r of rejectedRuns) {
    issues.push({
      type: "REVIEW_REJECTION",
      entityId: r.id,
      severity: "HIGH",
      details: `Run '${r.id}' was rejected by independent reviewer: ${r.failure_reason}`,
      recommendedAction: "COLLECT_EVIDENCE",
    });
  }

  // 3. Check for budget exhaustion
  const period = getCurrentBudgetPeriod();
  if (period.available_amount <= 0) {
    issues.push({
      type: "BUDGET_EXHAUSTION",
      entityId: period.id,
      severity: "CRITICAL",
      details: `Monthly AI budget ceiling reached (Committed + Spent >= ₹15,000). Available: ₹${period.available_amount.toFixed(2)}.`,
      recommendedAction: "ESCALATE",
    });
  }

  return issues;
}

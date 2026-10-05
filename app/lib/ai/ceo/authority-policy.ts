// ============================================================
// Bansil Books Analytics — Phase 3A: Authority Policy
// CEO Governance: Action Classification, Approval Matrix,
// Authority Checking, Deterministic-First Policy, Zoho Hard Policy
// ============================================================
//
// DESIGN PRINCIPLES:
// 1. Classification is deterministic — zero AI/model calls
// 2. ZOHO WRITE = 0 — permanent, no override path
// 3. Approval is action-specific — approval for A does not authorize B
// 4. Approval must occur BEFORE action — never post-facto
// 5. ₹15,000 monthly AI budget is MAXIMUM CEILING, not spending target
// 6. CEO cannot grant agent higher permission than CEO itself has
// ============================================================

import {
  ActionCategory,
  RiskLevel,
  GovernedActionType,
  ApprovalMatrixEntry,
  AuthorityCheckResult,
  GovernedAction,
  ApprovalGrant,
  ApprovalRequest,
  ApprovalScope,
  CeoResponseStatus,
  GovernancePrecedenceLevel,
  GOVERNANCE_PRECEDENCE,
} from "./governance-types";

// ==================== APPROVAL MATRIX ====================

/**
 * The canonical source-controlled approval policy.
 * Each action type maps to exactly one category, risk level, and constraint set.
 * This is entirely deterministic — no AI model involved.
 */
export const APPROVAL_MATRIX: ReadonlyArray<ApprovalMatrixEntry> = [
  // AUTO_EXECUTE: read-only, analysis, reporting
  { actionType: "READ_DATA", category: "AUTO_EXECUTE", riskLevel: "LOW", description: "Read/query any internal data source" },
  { actionType: "ANALYZE_DATA", category: "AUTO_EXECUTE", riskLevel: "LOW", description: "Analyze data using deterministic or AI methods" },
  { actionType: "GENERATE_REPORT", category: "AUTO_EXECUTE", riskLevel: "LOW", description: "Generate management reports from analyzed data" },
  { actionType: "DETERMINISTIC_CALCULATION", category: "AUTO_EXECUTE", riskLevel: "LOW", description: "SQL, math, rules-based computation" },
  { actionType: "COMPARE_RESULTS", category: "AUTO_EXECUTE", riskLevel: "LOW", description: "Compare results from different agents/sources" },
  { actionType: "RESOLVE_WORKFLOW_ISSUE", category: "AUTO_EXECUTE", riskLevel: "LOW", description: "Fix non-material internal workflow issues" },
  { actionType: "IDENTIFY_RISK", category: "AUTO_EXECUTE", riskLevel: "LOW", description: "Identify and flag risks for reporting" },
  { actionType: "PROPOSE_ACTION", category: "AUTO_EXECUTE", riskLevel: "LOW", description: "Propose actions for Owner consideration" },
  { actionType: "SCHEDULE_FOLLOWUP", category: "AUTO_EXECUTE", riskLevel: "LOW", description: "Schedule internal follow-up logic" },
  { actionType: "INTERNAL_REVIEW", category: "AUTO_EXECUTE", riskLevel: "LOW", description: "Request internal review of work" },
  { actionType: "RETRY_FAILED_TASK", category: "AUTO_EXECUTE", riskLevel: "LOW", description: "Retry failed internal work" },

  // AUTO_EXECUTE with governance constraints
  { actionType: "REUSE_AGENT", category: "AUTO_EXECUTE", riskLevel: "LOW", description: "Reuse existing suitable agent", constraints: "Agent must exist and be suitable" },
  { actionType: "CREATE_AGENT", category: "AUTO_EXECUTE", riskLevel: "MEDIUM", description: "Create new agent when justified", constraints: "Subject to agent-governance policy; no escalation" },
  { actionType: "INTERNAL_DELEGATION", category: "AUTO_EXECUTE", riskLevel: "LOW", description: "Delegate to existing workforce", constraints: "Within existing authority scope" },
  { actionType: "USE_AI_MODEL", category: "AUTO_EXECUTE", riskLevel: "MEDIUM", description: "Use AI model within budget", constraints: "Subject to model/budget policy; deterministic-first" },
  { actionType: "SELECT_MODEL", category: "AUTO_EXECUTE", riskLevel: "LOW", description: "Select appropriate AI model", constraints: "Cheap before strong; reason required for escalation" },

  // OWNER_APPROVAL_REQUIRED: binding, financial, external
  { actionType: "SEND_EXTERNAL_RFQ", category: "OWNER_APPROVAL_REQUIRED", riskLevel: "MEDIUM", description: "Send RFQ to external vendor" },
  { actionType: "BINDING_QUOTATION", category: "OWNER_APPROVAL_REQUIRED", riskLevel: "HIGH", description: "Issue binding quotation to customer" },
  { actionType: "ACCEPT_PURCHASE", category: "OWNER_APPROVAL_REQUIRED", riskLevel: "HIGH", description: "Accept purchase order" },
  { actionType: "BANK_PAYMENT", category: "OWNER_APPROVAL_REQUIRED", riskLevel: "CRITICAL", description: "Make bank payment" },
  { actionType: "VENDOR_PAYMENT_APPROVAL", category: "OWNER_APPROVAL_REQUIRED", riskLevel: "CRITICAL", description: "Approve vendor payment" },
  { actionType: "PURCHASE_ORDER_APPROVAL", category: "OWNER_APPROVAL_REQUIRED", riskLevel: "HIGH", description: "Approve purchase order" },
  { actionType: "SIGN_CONTRACT", category: "OWNER_APPROVAL_REQUIRED", riskLevel: "CRITICAL", description: "Sign or bind company commercially" },
  { actionType: "HIRE_FIRE_STAFF", category: "OWNER_APPROVAL_REQUIRED", riskLevel: "CRITICAL", description: "Hire or fire staff with legal/material consequence" },
  { actionType: "CHANGE_SALARY", category: "OWNER_APPROVAL_REQUIRED", riskLevel: "CRITICAL", description: "Change employee salary" },
  { actionType: "STATUTORY_FILING", category: "OWNER_APPROVAL_REQUIRED", riskLevel: "CRITICAL", description: "File GST/TDS/Income Tax/statutory returns" },
  { actionType: "PERMANENT_DATA_DELETION", category: "OWNER_APPROVAL_REQUIRED", riskLevel: "CRITICAL", description: "Permanently destroy operational data", constraints: "Requires backup/destructive safety workflow" },
  { actionType: "INVENTORY_ADJUSTMENT", category: "OWNER_APPROVAL_REQUIRED", riskLevel: "HIGH", description: "Make inventory adjustments" },
  { actionType: "BANK_RECONCILIATION_POST", category: "OWNER_APPROVAL_REQUIRED", riskLevel: "HIGH", description: "Post bank reconciliation entries" },
  { actionType: "JOURNAL_ENTRY", category: "OWNER_APPROVAL_REQUIRED", riskLevel: "HIGH", description: "Create journal entries" },

  // PROHIBITED: permanent governance blocks
  { actionType: "ACCOUNTING_WRITE", category: "PROHIBITED", riskLevel: "CRITICAL", description: "Write to accounting books" },
  { actionType: "ZOHO_WRITE", category: "PROHIBITED", riskLevel: "CRITICAL", description: "Any write to Zoho Books (POST/PUT/PATCH/DELETE)" },
];

// Build lookup maps — deterministic, computed once at module load
const MATRIX_BY_ACTION = new Map<GovernedActionType, ApprovalMatrixEntry>();
for (const entry of APPROVAL_MATRIX) {
  MATRIX_BY_ACTION.set(entry.actionType, entry);
}

// ==================== CLASSIFICATION ====================

/**
 * Classify a governed action type. Deterministic — zero AI calls.
 * Returns the approval matrix entry for the action type.
 */
export function classifyAction(actionType: GovernedActionType): ApprovalMatrixEntry {
  const entry = MATRIX_BY_ACTION.get(actionType);
  if (!entry) {
    // Unknown action type defaults to OWNER_APPROVAL_REQUIRED / CRITICAL
    return {
      actionType,
      category: "OWNER_APPROVAL_REQUIRED",
      riskLevel: "CRITICAL",
      description: `Unknown action type: ${actionType}`,
    };
  }
  return entry;
}

// ==================== RISK CLASSIFICATION ====================

const RISK_WEIGHTS: Record<RiskLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export function getRiskWeight(level: RiskLevel): number {
  return RISK_WEIGHTS[level] || 4;
}

/**
 * Determine risk level for a task based on its action and context.
 * Deterministic classification — no AI.
 */
export function classifyRisk(action: GovernedAction): RiskLevel {
  const matrixEntry = classifyAction(action.actionType);
  return matrixEntry.riskLevel;
}

/**
 * Determine if review is required based on risk level.
 */
export function isReviewRequired(riskLevel: RiskLevel): boolean {
  return riskLevel === "HIGH" || riskLevel === "CRITICAL";
}

/**
 * Determine review type based on action context.
 */
export function getReviewType(action: GovernedAction): string | undefined {
  if (action.actionType === "ACCOUNTING_WRITE" || action.actionType === "JOURNAL_ENTRY" ||
      action.actionType === "BANK_RECONCILIATION_POST" || action.actionType === "BANK_PAYMENT") {
    return "FINANCIAL";
  }
  if (action.actionType === "STATUTORY_FILING") {
    return "COMPLIANCE";
  }
  if (action.actionType === "SIGN_CONTRACT" || action.actionType === "BINDING_QUOTATION") {
    return "COMPLIANCE";
  }
  if (action.riskLevel === "HIGH" || action.riskLevel === "CRITICAL") {
    return "OPERATIONAL";
  }
  return undefined;
}

// ==================== AUTHORITY CHECK ====================

/**
 * Check whether the CEO (or any agent) has authority to perform an action.
 * This MUST be called BEFORE the action is executed — never post-facto.
 *
 * Returns deterministic result — no AI model used.
 */
export function checkAuthority(action: GovernedAction, activeGrants?: ApprovalGrant[]): AuthorityCheckResult {
  const matrixEntry = classifyAction(action.actionType);
  const riskLevel = matrixEntry.riskLevel;
  const reviewRequired = isReviewRequired(riskLevel);
  const reviewType = getReviewType(action);

  // PROHIBITED actions — always blocked, no override
  if (matrixEntry.category === "PROHIBITED") {
    return {
      allowed: false,
      category: "PROHIBITED",
      riskLevel,
      requiresApproval: false,
      requiresReview: false,
      reason: `PROHIBITED: ${matrixEntry.description}. No agent, CEO, or approval can override this.`,
    };
  }

  // AUTO_EXECUTE — CEO may proceed autonomously
  if (matrixEntry.category === "AUTO_EXECUTE" || matrixEntry.category === "AUTO_EXECUTE_AND_REPORT") {
    return {
      allowed: true,
      category: matrixEntry.category,
      riskLevel,
      requiresApproval: false,
      requiresReview: reviewRequired,
      reviewType,
      reason: `Auto-execute: ${matrixEntry.description}`,
    };
  }

  // REVIEW_REQUIRED — can proceed but needs review hook
  if (matrixEntry.category === "REVIEW_REQUIRED") {
    return {
      allowed: true,
      category: "REVIEW_REQUIRED",
      riskLevel,
      requiresApproval: false,
      requiresReview: true,
      reviewType,
      reason: `Review required: ${matrixEntry.description}`,
    };
  }

  // OWNER_APPROVAL_REQUIRED — check for existing valid grant
  if (matrixEntry.category === "OWNER_APPROVAL_REQUIRED") {
    const validGrant = findValidGrant(action, activeGrants || []);
    if (validGrant) {
      return {
        allowed: true,
        category: "OWNER_APPROVAL_REQUIRED",
        riskLevel,
        requiresApproval: false,
        requiresReview: reviewRequired,
        reviewType,
        reason: `Owner-approved via grant ${validGrant.id}`,
        existingGrantId: validGrant.id,
      };
    }

    return {
      allowed: false,
      category: "OWNER_APPROVAL_REQUIRED",
      riskLevel,
      requiresApproval: true,
      requiresReview: reviewRequired,
      reviewType,
      reason: `Owner approval required: ${matrixEntry.description}`,
    };
  }

  // Fallback — unknown category
  return {
    allowed: false,
    category: "OWNER_APPROVAL_REQUIRED",
    riskLevel: "CRITICAL",
    requiresApproval: true,
    requiresReview: true,
    reason: `Unknown category for action ${action.actionType}`,
  };
}

// ==================== APPROVAL SCOPE & VALIDATION ====================

/**
 * An Owner approval is ACTION-SPECIFIC.
 * Approval for sending one vendor RFQ does NOT grant:
 * - general email authority
 * - purchase approval
 * - payment authority
 * - contract authority
 */
export function isApprovalScopeMatch(grant: ApprovalGrant, action: GovernedAction): boolean {
  const scope = grant.scope;

  // Action type MUST match exactly
  if (scope.actionType !== action.actionType) return false;

  // Target must match if specified
  if (scope.target && scope.target !== action.target && scope.target !== "*") return false;

  // Amount constraint if applicable
  if (scope.amount !== undefined && action.amount !== undefined) {
    if (action.amount > scope.amount) return false;
  }

  // Department constraint if applicable
  if (scope.department && action.department && scope.department !== action.department) return false;

  return true;
}

/**
 * Find a valid (non-expired, non-revoked, non-consumed) grant for an action.
 */
export function findValidGrant(action: GovernedAction, grants: ApprovalGrant[]): ApprovalGrant | null {
  const now = new Date().toISOString();

  for (const grant of grants) {
    // Skip consumed single-use grants
    if (grant.consumed && grant.scope.singleUse) continue;

    // Skip revoked grants
    if (grant.revokedAt) continue;

    // Skip expired grants
    if (grant.expiresAt && grant.expiresAt < now) continue;

    // Check scope match (action-specific)
    if (isApprovalScopeMatch(grant, action)) {
      return grant;
    }
  }

  return null;
}

// ==================== DETERMINISTIC-FIRST POLICY ====================

/**
 * Governance-level rule: DEFAULT = NO AI.
 * Use SQL, rules, math, cached evidence, local tools, existing deterministic APIs first.
 * Only use AI when ambiguity, unstructured interpretation, cross-domain synthesis,
 * complex reasoning, or judgment genuinely requires it.
 *
 * Returns true if the task should use deterministic execution.
 */
export function shouldUseDeterministicPath(taskDescription: string): boolean {
  const lower = taskDescription.toLowerCase();

  // Deterministic indicators
  const deterministicIndicators = [
    "sum", "total", "count", "calculate", "compute", "average", "median",
    "list all", "show all", "how many", "what is the total",
    "balance", "reconcile", "compare amounts", "match",
    "sort by", "group by", "filter by", "aggregate",
    "sql", "query", "lookup", "fetch",
  ];

  // AI-required indicators
  const aiRequiredIndicators = [
    "why", "explain why", "interpret", "what does this mean",
    "recommend", "suggest", "advise", "opinion",
    "summarize in plain language", "describe the trend",
    "cross-reference with", "synthesize",
    "what should we do", "root cause",
    "draft", "compose", "write a",
  ];

  const hasDeterministicSignal = deterministicIndicators.some(ind => lower.includes(ind));
  const hasAiSignal = aiRequiredIndicators.some(ind => lower.includes(ind));

  // If task has clear deterministic signals and no AI signals, prefer deterministic
  if (hasDeterministicSignal && !hasAiSignal) return true;

  // If task has no AI signals at all, default to deterministic
  if (!hasAiSignal) return true;

  // If task explicitly requires AI, use AI
  return false;
}

/**
 * Determine if strong model escalation is needed.
 * Returns the reason if escalation is required.
 */
export function requiresStrongModel(taskDescription: string, riskLevel: RiskLevel): { required: boolean; reason?: string } {
  // CRITICAL risk always needs strong model when AI is used
  if (riskLevel === "CRITICAL") {
    return { required: true, reason: "CRITICAL risk level requires strong model for AI analysis" };
  }

  const lower = taskDescription.toLowerCase();

  // Complex reasoning needs
  const complexIndicators = [
    "cross-domain", "multi-department", "comprehensive audit",
    "statutory compliance", "legal interpretation", "financial modeling",
    "risk assessment across", "root cause analysis",
  ];

  for (const ind of complexIndicators) {
    if (lower.includes(ind)) {
      return { required: true, reason: `Complex reasoning required: ${ind}` };
    }
  }

  return { required: false };
}

// ==================== ZOHO HARD POLICY ====================

/**
 * Permanent governance rule: ZOHO WRITE = 0.
 * No POST, PUT, PATCH, DELETE to Zoho Books endpoints.
 * No agent, no department, no CEO decision, no learned memory,
 * no approval matrix default may override this.
 * Only a NEW explicit specific Owner authorization may allow an exact narrowly-scoped write.
 *
 * This function always returns false (blocked) unless a specific new Owner
 * authorization exists for the exact operation. Currently, no such mechanism exists.
 */
export function isZohoWriteAllowed(): boolean {
  // PERMANENT HARD POLICY: ZOHO WRITE = 0
  // This function intentionally has no code path that returns true.
  return false;
}

// ==================== AGENT PERMISSION ESCALATION CHECK ====================

/**
 * A new agent inherits only the permissions explicitly granted to its role/task.
 * CEO cannot create an agent with authority CEO itself does not possess.
 */
export function validateAgentPermissions(
  creatorLevel: string,
  creatorCapabilities: string[],
  childCapabilities: string[]
): { valid: boolean; reason: string } {
  // Check that child doesn't have capabilities the creator lacks
  for (const cap of childCapabilities) {
    const upperCap = cap.toUpperCase();

    // ZOHO_WRITE is always forbidden regardless
    if (upperCap === "ZOHO_WRITE" || upperCap === "ZOHO_BOOKS_WRITE") {
      return { valid: false, reason: `Cannot grant ZOHO_WRITE to any agent. ZOHO WRITE = 0.` };
    }

    // Check if creator has this capability (or it's a standard operational one)
    const standardOperationalCaps = [
      "DATA_ANALYSIS", "REPORTING", "QUERY_EXECUTION", "INTERNAL_COMMUNICATION",
      "TASK_MANAGEMENT", "EVIDENCE_COLLECTION", "RISK_IDENTIFICATION",
    ];

    if (!standardOperationalCaps.includes(upperCap) && !creatorCapabilities.includes(cap)) {
      return { valid: false, reason: `Permission escalation blocked: Creator lacks capability '${cap}', cannot grant it to child agent.` };
    }
  }

  return { valid: true, reason: "Agent permissions valid — no escalation detected." };
}

// ==================== LEARNING PRECEDENCE ENFORCEMENT ====================

/**
 * Validate that a candidate lesson does not override higher-precedence policies.
 * Candidate lessons (lowest level) must NEVER override:
 * - ZOHO WRITE = 0
 * - Budget limits
 * - Approval requirements
 * - Security rules
 * - Destructive-data rules
 */
export function validateLearningPrecedence(
  candidateLevel: GovernancePrecedenceLevel,
  existingLevel: GovernancePrecedenceLevel
): { allowed: boolean; reason: string } {
  const candidateIdx = GOVERNANCE_PRECEDENCE.indexOf(candidateLevel);
  const existingIdx = GOVERNANCE_PRECEDENCE.indexOf(existingLevel);

  // Lower index = higher precedence
  if (candidateIdx > existingIdx) {
    // Candidate is lower precedence — cannot override existing
    return {
      allowed: false,
      reason: `Learning precedence violation: ${candidateLevel} (level ${candidateIdx}) cannot override ${existingLevel} (level ${existingIdx})`,
    };
  }

  return {
    allowed: true,
    reason: `Precedence valid: ${candidateLevel} may coexist with or override ${existingLevel}`,
  };
}

/**
 * Check if a lesson content attempts to override hard policies.
 */
export function isHardPolicyViolation(content: string): boolean {
  const lower = content.toLowerCase();

  const hardPolicyPatterns = [
    "override zoho write",
    "enable zoho write",
    "allow zoho write",
    "zoho_write = 1",
    "zoho_write=1",
    "bypass budget",
    "exceed 15000",
    "exceed budget",
    "ignore budget",
    "bypass approval",
    "skip approval",
    "ignore approval",
    "auto-approve payment",
    "auto approve payment",
    "skip security",
    "bypass security",
    "delete without backup",
    "skip destructive safety",
  ];

  return hardPolicyPatterns.some(pat => lower.includes(pat));
}

// ==================== SELF-CORRECTION POLICY ====================

/**
 * Determine if an error can be safely self-corrected by the CEO
 * without requiring Owner escalation.
 */
export function canSelfCorrect(errorType: string, actionType: GovernedActionType): boolean {
  const matrixEntry = classifyAction(actionType);

  // PROHIBITED actions can never be self-corrected (they shouldn't have executed)
  if (matrixEntry.category === "PROHIBITED") return false;

  // Actions requiring Owner approval cannot be self-corrected
  if (matrixEntry.category === "OWNER_APPROVAL_REQUIRED") return false;

  // The following error types are safe to self-correct for AUTO_EXECUTE actions:
  const safeErrors = [
    "TIMEOUT", "RETRY_NEEDED", "AGENT_BUSY", "DEPENDENCY_NOT_MET",
    "STALE_DATA", "FORMAT_ERROR", "CALCULATION_ERROR", "QUERY_ERROR",
    "AGENT_SELECTION_ERROR", "TASK_DECOMPOSITION_ERROR",
  ];

  return safeErrors.includes(errorType.toUpperCase());
}

/**
 * Determine if a self-correction requires escalation because it would
 * involve money, external commitment, or accounting writes.
 */
export function requiresEscalation(correctionAction: GovernedActionType): boolean {
  const matrixEntry = classifyAction(correctionAction);
  return (
    matrixEntry.category === "OWNER_APPROVAL_REQUIRED" ||
    matrixEntry.category === "PROHIBITED" ||
    matrixEntry.riskLevel === "CRITICAL"
  );
}

// ==================== CEO RESPONSE STATUS MAPPING ====================

/**
 * Map a run/task outcome to the appropriate CEO response status.
 * CEO must not fabricate completion — use truthful statuses.
 */
export function mapToResponseStatus(
  completed: boolean,
  hasNotes: boolean,
  blocked: boolean,
  awaitingApproval: boolean,
  insufficientEvidence: boolean,
  failed: boolean
): CeoResponseStatus {
  if (failed) return "FAILED";
  if (blocked) return "BLOCKED";
  if (awaitingApproval) return "OWNER_APPROVAL_REQUIRED";
  if (insufficientEvidence) return "INSUFFICIENT_EVIDENCE";
  if (completed && hasNotes) return "COMPLETED_WITH_NOTES";
  if (completed) return "COMPLETED";
  return "FAILED"; // Never fabricate success
}

// ==================== AI BUDGET vs BUSINESS SPEND ====================

/**
 * Verify that AI budget is not confused with company operating cash.
 * AI budget (₹15,000/month) is for model/compute costs only.
 * It does NOT authorize business spending (payments, purchases, etc.).
 */
export function isAiBudgetAction(actionType: GovernedActionType): boolean {
  const aiBudgetActions: GovernedActionType[] = [
    "USE_AI_MODEL", "SELECT_MODEL", "CREATE_AGENT",
  ];
  return aiBudgetActions.includes(actionType);
}

export function isBusinessSpendAction(actionType: GovernedActionType): boolean {
  const businessSpendActions: GovernedActionType[] = [
    "BANK_PAYMENT", "ACCEPT_PURCHASE", "VENDOR_PAYMENT_APPROVAL",
    "PURCHASE_ORDER_APPROVAL", "SIGN_CONTRACT",
  ];
  return businessSpendActions.includes(actionType);
}

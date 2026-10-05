// ============================================================
// Bansil Books Analytics — Phase 3A: CEO Governance Types
// Defines action classification, approval matrix, risk levels,
// governed action lifecycle, CEO response contract.
// ============================================================

// ==================== ACTION CLASSIFICATION ====================

/**
 * Every governed action is classified into exactly one category.
 * Classification is deterministic — no AI/model call.
 */
export type ActionCategory =
  | "AUTO_EXECUTE"
  | "AUTO_EXECUTE_AND_REPORT"
  | "REVIEW_REQUIRED"
  | "OWNER_APPROVAL_REQUIRED"
  | "PROHIBITED";

/**
 * Risk levels for governed actions.
 * Influences review requirement, model selection, approval threshold.
 */
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/**
 * Action types that the governance system recognizes.
 */
export type GovernedActionType =
  | "READ_DATA"
  | "ANALYZE_DATA"
  | "GENERATE_REPORT"
  | "DETERMINISTIC_CALCULATION"
  | "CREATE_AGENT"
  | "REUSE_AGENT"
  | "USE_AI_MODEL"
  | "INTERNAL_DELEGATION"
  | "INTERNAL_REVIEW"
  | "RETRY_FAILED_TASK"
  | "COMPARE_RESULTS"
  | "RESOLVE_WORKFLOW_ISSUE"
  | "SCHEDULE_FOLLOWUP"
  | "IDENTIFY_RISK"
  | "PROPOSE_ACTION"
  | "SELECT_MODEL"
  | "SEND_EXTERNAL_RFQ"
  | "BINDING_QUOTATION"
  | "ACCEPT_PURCHASE"
  | "BANK_PAYMENT"
  | "ACCOUNTING_WRITE"
  | "ZOHO_WRITE"
  | "STATUTORY_FILING"
  | "PERMANENT_DATA_DELETION"
  | "HIRE_FIRE_STAFF"
  | "SIGN_CONTRACT"
  | "CHANGE_SALARY"
  | "INVENTORY_ADJUSTMENT"
  | "BANK_RECONCILIATION_POST"
  | "JOURNAL_ENTRY"
  | "VENDOR_PAYMENT_APPROVAL"
  | "PURCHASE_ORDER_APPROVAL";

// ==================== APPROVAL MATRIX ====================

export interface ApprovalMatrixEntry {
  actionType: GovernedActionType;
  category: ActionCategory;
  riskLevel: RiskLevel;
  description: string;
  constraints?: string;
  requiresReview?: boolean;
  reviewType?: "FINANCIAL" | "COMPLIANCE" | "OPERATIONAL" | "INDEPENDENT";
}

// ==================== APPROVAL REQUEST / GRANT ====================

export interface ApprovalRequest {
  id: string;
  actionType: GovernedActionType;
  target: string;
  amount?: number;
  department?: string;
  description: string;
  impact: string;
  risk: RiskLevel;
  cost?: number;
  scope: ApprovalScope;
  whatHappensIfNotApproved: string;
  requestedBy: string;
  requestedAt: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "REVOKED";
  expiresAt?: string;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface ApprovalScope {
  actionType: GovernedActionType;
  target: string;
  amount?: number;
  department?: string;
  validityPeriod?: string;
  singleUse: boolean;
  constraints?: string;
}

export interface ApprovalGrant {
  id: string;
  requestId: string;
  scope: ApprovalScope;
  approvedBy: string;
  approvedAt: string;
  expiresAt?: string;
  consumed: boolean;
  revokedAt?: string;
}

// ==================== GOVERNED ACTION LIFECYCLE ====================

export interface GovernedAction {
  actionType: GovernedActionType;
  target: string;
  department?: string;
  amount?: number;
  riskLevel: RiskLevel;
  category: ActionCategory;
  requiresReview: boolean;
  reviewType?: string;
  description: string;
}

export interface AuthorityCheckResult {
  allowed: boolean;
  category: ActionCategory;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  requiresReview: boolean;
  reviewType?: string;
  reason: string;
  existingGrantId?: string;
}

// ==================== SELF-CORRECTION ====================

export interface SelfCorrectionAttempt {
  id: string;
  runId: string;
  taskId: string;
  errorType: string;
  rootCause: string;
  safeToSelfCorrect: boolean;
  correctionApplied: boolean;
  requiresEscalation: boolean;
  escalationReason?: string;
  lessonRecorded: boolean;
  createdAt: string;
}

// ==================== CEO RESPONSE CONTRACT ====================

export interface CeoConsolidatedResponse {
  objective: string;
  result: string;
  keyEvidence?: string[];
  risksOrExceptions?: string[];
  actionsCompleted?: string[];
  approvalRequired?: ApprovalRequest;
  recommendedNextStep?: string;
  status: CeoResponseStatus;
}

export type CeoResponseStatus =
  | "COMPLETED"
  | "COMPLETED_WITH_NOTES"
  | "BLOCKED"
  | "OWNER_APPROVAL_REQUIRED"
  | "INSUFFICIENT_EVIDENCE"
  | "FAILED";

// ==================== LEARNING PRECEDENCE ====================

/**
 * Governance precedence hierarchy (immutable order):
 * 1. SYSTEM_HARD_POLICY — never overridden
 * 2. OWNER_APPROVED_POLICY — only Owner can change
 * 3. VERIFIED_COMPANY_RULE — verified and approved
 * 4. REVIEWED_SUCCESSFUL_WORKFLOW — demonstrated working
 * 5. CANDIDATE_AGENT_LESSON — lowest, cannot override above
 */
export const GOVERNANCE_PRECEDENCE = [
  "SYSTEM_HARD_POLICY",
  "OWNER_APPROVED_POLICY",
  "VERIFIED_COMPANY_RULE",
  "REVIEWED_SUCCESSFUL_WORKFLOW",
  "CANDIDATE_AGENT_LESSON",
] as const;

export type GovernancePrecedenceLevel = typeof GOVERNANCE_PRECEDENCE[number];

// ==================== AUDIT TRAIL ====================

export interface GovernanceAuditEntry {
  id: string;
  runId?: string;
  taskId?: string;
  objective: string;
  decision: string;
  policyEvaluated: string;
  authorityResult: string;
  approvalRequired: boolean;
  agentAssigned?: string;
  modelSelected?: string;
  estimatedAiCost?: number;
  actualAiCost?: number;
  reviewResult?: string;
  finalOutcome: string;
  createdAt: string;
}

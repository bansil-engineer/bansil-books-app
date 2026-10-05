// ============================================================
// Bansil Books Analytics — Phase 4A: Estimation Authority Integration
// Maps estimation actions onto the Phase 3A approval matrix,
// risk-tiers estimation outputs for the Phase 3B checker, routes
// work deterministic-first (Phase 3C), and bounds self-correction
// (Phase 3D). Reuses existing governance — does not modify it.
// ============================================================

import { checkAuthority, classifyAction, isZohoWriteAllowed, requiresEscalation } from "../ceo/authority-policy";
import type {
  ApprovalGrant,
  AuthorityCheckResult,
  GovernedAction,
  GovernedActionType,
  RiskLevel,
} from "../ceo/governance-types";
import {
  determineReviewRequirement,
  validateAuthorityPreservation,
  type CheckerOutcome,
  type ReviewType,
} from "../ceo/independent-checker";
import { isZeroAiCase } from "../ceo/cost-routing-engine";
import { MAX_DETERMINISTIC_RETRIES } from "../ceo/self-correction-engine";

/** Existing department (department-registry.ts) — no new department/agent. */
export const ESTIMATION_DEPARTMENT = "ESTIMATION";

// ==================== ACTION MAPPING ====================

export type EstimationAction =
  // Internal — AUTO_EXECUTE
  | "READ_TENDER"
  | "EXTRACT_FACTS"
  | "STRUCTURE_BOQ"
  | "SEARCH_HISTORICAL_RATE"
  | "CALCULATE_COST"
  | "COMPARE_VENDORS"
  | "DRAFT_OFFER"
  | "DRAFT_CLARIFICATION"
  | "DRAFT_RFQ"
  // External / binding / financial — OWNER_APPROVAL_REQUIRED
  | "SEND_VENDOR_RFQ"
  | "SEND_CLARIFICATION"
  | "SEND_QUOTATION"
  | "SUBMIT_TENDER"
  | "ACCEPT_COMMERCIAL_COMMITMENT"
  | "ACCEPT_VENDOR_OFFER"
  | "PLACE_PO"
  | "MAKE_PAYMENT"
  // PROHIBITED (stricter than Owner approval — Phase 3A matrix)
  | "CHANGE_ACCOUNTING_BOOKS"
  | "ZOHO_WRITE";

/**
 * Estimation action → existing Phase 3A governed action type.
 * External sends without a dedicated matrix entry reuse the closest
 * Owner-approval type; grants are additionally pinned to the exact
 * estimation target (see checkEstimationAuthority).
 */
export const ESTIMATION_ACTION_MAP: Readonly<Record<EstimationAction, GovernedActionType>> = {
  READ_TENDER: "READ_DATA",
  EXTRACT_FACTS: "ANALYZE_DATA",
  STRUCTURE_BOQ: "ANALYZE_DATA",
  SEARCH_HISTORICAL_RATE: "READ_DATA",
  CALCULATE_COST: "DETERMINISTIC_CALCULATION",
  COMPARE_VENDORS: "COMPARE_RESULTS",
  DRAFT_OFFER: "PROPOSE_ACTION",
  DRAFT_CLARIFICATION: "PROPOSE_ACTION",
  DRAFT_RFQ: "PROPOSE_ACTION",
  SEND_VENDOR_RFQ: "SEND_EXTERNAL_RFQ",
  SEND_CLARIFICATION: "SEND_EXTERNAL_RFQ",
  SEND_QUOTATION: "BINDING_QUOTATION",
  SUBMIT_TENDER: "SIGN_CONTRACT",
  ACCEPT_COMMERCIAL_COMMITMENT: "SIGN_CONTRACT",
  ACCEPT_VENDOR_OFFER: "ACCEPT_PURCHASE",
  PLACE_PO: "PURCHASE_ORDER_APPROVAL",
  MAKE_PAYMENT: "VENDOR_PAYMENT_APPROVAL",
  CHANGE_ACCOUNTING_BOOKS: "ACCOUNTING_WRITE",
  ZOHO_WRITE: "ZOHO_WRITE",
};

/** Target namespace keeps one estimation approval from authorizing another. */
export function estimationTarget(action: EstimationAction, ref: string): string {
  return `estimation:${action}:${ref}`;
}

export function toGovernedAction(action: EstimationAction, ref: string, amount?: number): GovernedAction {
  const actionType = ESTIMATION_ACTION_MAP[action];
  const entry = classifyAction(actionType);
  return {
    actionType,
    target: estimationTarget(action, ref),
    department: ESTIMATION_DEPARTMENT,
    amount,
    riskLevel: entry.riskLevel,
    category: entry.category,
    requiresReview: entry.riskLevel === "HIGH" || entry.riskLevel === "CRITICAL",
    description: `Estimation ${action} (${ref})`,
  };
}

/**
 * Deterministic authority check for an estimation action.
 * Grants must name the EXACT estimation target — wildcard ("*") grants
 * and grants for other estimation actions/refs are ignored.
 */
export function checkEstimationAuthority(
  action: EstimationAction,
  ref: string,
  grants: ApprovalGrant[] = [],
  amount?: number,
): AuthorityCheckResult & { governedActionType: GovernedActionType } {
  const governed = toGovernedAction(action, ref, amount);
  if (governed.actionType === "ZOHO_WRITE" && isZohoWriteAllowed()) {
    // Unreachable by design (isZohoWriteAllowed() === false); defensive.
    throw new Error("ZOHO WRITE = 0 invariant violated");
  }
  const pinned = grants.filter((g) => g.scope.target === governed.target);
  return { ...checkAuthority(governed, pinned), governedActionType: governed.actionType };
}

// ==================== CHECKER (PHASE 3B) RISK TIERS ====================

export type EstimationOutputKind =
  | "HISTORICAL_RATE_LOOKUP"
  | "VENDOR_COMPARISON"
  | "FINAL_COMMERCIAL_COSTING"
  | "MARGIN_RECOMMENDATION"
  | "TENDER_RISK_SUMMARY"
  | "BINDING_OFFER";

export const ESTIMATION_OUTPUT_RISK: Readonly<Record<EstimationOutputKind, RiskLevel>> = {
  HISTORICAL_RATE_LOOKUP: "LOW",
  VENDOR_COMPARISON: "MEDIUM",
  FINAL_COMMERCIAL_COSTING: "HIGH",
  MARGIN_RECOMMENDATION: "HIGH",
  TENDER_RISK_SUMMARY: "HIGH",
  BINDING_OFFER: "CRITICAL",
};

// Objective strings are phrased to hit the Phase 3B rules deliberately.
const OUTPUT_OBJECTIVE: Readonly<Record<EstimationOutputKind, string>> = {
  HISTORICAL_RATE_LOOKUP: "known-source lookup: historical rate evidence",
  VENDOR_COMPARISON: "estimation vendor comparison",
  FINAL_COMMERCIAL_COSTING: "estimation conclusion: final commercial costing",
  MARGIN_RECOMMENDATION: "estimation conclusion: margin recommendation",
  TENDER_RISK_SUMMARY: "estimation conclusion: tender risk summary",
  BINDING_OFFER: "estimation conclusion: binding offer for tender submission",
};

export interface EstimationReviewHook {
  kind: EstimationOutputKind;
  riskLevel: RiskLevel;
  reviewRequired: boolean;
  reviewType: ReviewType;
  requiresOwnerApproval: boolean;
  reason: string;
}

/** Deterministic review requirement via the existing Phase 3B classifier. */
export function getEstimationReviewHook(kind: EstimationOutputKind): EstimationReviewHook {
  const riskLevel = ESTIMATION_OUTPUT_RISK[kind];
  const r = determineReviewRequirement({
    objective: OUTPUT_OBJECTIVE[kind],
    department: ESTIMATION_DEPARTMENT,
    actionType: kind === "HISTORICAL_RATE_LOOKUP" ? "DETERMINISTIC_CALCULATION"
      : kind === "BINDING_OFFER" ? "SIGN_CONTRACT" : undefined,
    riskLevel,
    isMaterial: riskLevel !== "LOW",
  });
  // Floor: HIGH/CRITICAL estimation outputs ALWAYS require independent review.
  const reviewRequired = r.required || riskLevel === "HIGH" || riskLevel === "CRITICAL";
  return {
    kind,
    riskLevel,
    reviewRequired,
    reviewType: r.reviewType,
    requiresOwnerApproval: kind === "BINDING_OFFER" || r.requiresOwnerApproval,
    reason: r.reason,
  };
}

/**
 * Finalization gate for an estimation output.
 *  - Review-required outputs need checker PASS / PASS_WITH_NOTES.
 *  - Owner-approval outputs additionally need an exact Owner grant;
 *    checker PASS can never substitute for it.
 */
export function canFinalizeEstimationOutput(params: {
  kind: EstimationOutputKind;
  ref: string;
  checkerOutcome?: CheckerOutcome;
  grants?: ApprovalGrant[];
  /** External binding action this output would trigger (default SUBMIT_TENDER). */
  externalAction?: "SEND_QUOTATION" | "SUBMIT_TENDER";
}): { allowed: boolean; blockers: string[] } {
  const external = params.externalAction ?? "SUBMIT_TENDER";
  const hook = getEstimationReviewHook(params.kind);
  const blockers: string[] = [];
  if (hook.reviewRequired && params.checkerOutcome !== "PASS" && params.checkerOutcome !== "PASS_WITH_NOTES") {
    blockers.push(`INDEPENDENT_REVIEW_REQUIRED:${params.checkerOutcome ?? "NOT_REVIEWED"}`);
  }
  if (hook.requiresOwnerApproval) {
    const auth = checkEstimationAuthority(external, params.ref, params.grants ?? []);
    if (!auth.allowed) {
      const pres = validateAuthorityPreservation(toGovernedAction(external, params.ref), params.checkerOutcome ?? "PASS");
      blockers.push(`OWNER_APPROVAL_REQUIRED:${pres.reason}`);
    }
  }
  return { allowed: blockers.length === 0, blockers };
}

// ==================== DETERMINISTIC-FIRST (PHASE 3C) ====================

export type EstimationTaskKind =
  // deterministic
  | "RATE_LOOKUP"
  | "COST_CALCULATION"
  | "UOM_NORMALIZATION"
  | "TAX_SPLIT"
  | "MARGIN_MATH"
  | "VENDOR_RATE_COMPARISON"
  | "REVISION_CHECK"
  | "PROVENANCE_VALIDATION"
  // AI-assist permitted (output is never a commercial fact)
  | "TENDER_TEXT_INTERPRETATION"
  | "SCOPE_AMBIGUITY_DETECTION"
  | "SPECIFICATION_INTERPRETATION"
  | "DOCUMENT_SYNTHESIS"
  | "COMMERCIAL_NARRATIVE";

const AI_ASSIST_TASKS = new Set<EstimationTaskKind>([
  "TENDER_TEXT_INTERPRETATION",
  "SCOPE_AMBIGUITY_DETECTION",
  "SPECIFICATION_INTERPRETATION",
  "DOCUMENT_SYNTHESIS",
  "COMMERCIAL_NARRATIVE",
]);

export interface EstimationRoute {
  route: "DETERMINISTIC" | "AI_ASSIST";
  /** Max planned model calls: 0 for deterministic routes. */
  maxModelCalls: number;
  /** Phase 3C isZeroAiCase() agreement for the mapped governed action. */
  zeroAi: boolean;
  aiOutputStatus?: "AI_INFERENCE";
  reason: string;
}

export function routeEstimationTask(kind: EstimationTaskKind): EstimationRoute {
  if (!AI_ASSIST_TASKS.has(kind)) {
    const governed: GovernedActionType = kind === "RATE_LOOKUP" ? "READ_DATA" : "DETERMINISTIC_CALCULATION";
    return {
      route: "DETERMINISTIC",
      maxModelCalls: 0,
      zeroAi: isZeroAiCase(kind, governed),
      reason: "Deterministic-first: SQL/rules/math only; zero model calls.",
    };
  }
  return {
    route: "AI_ASSIST",
    maxModelCalls: 1,
    zeroAi: false,
    aiOutputStatus: "AI_INFERENCE",
    reason: "Unstructured interpretation only; output labelled AI_INFERENCE and never used as rate/qty/fact.",
  };
}

// ==================== SELF-CORRECTION (PHASE 3D) ====================

export type EstimationCorrection =
  // safe, automatic
  | "RECALCULATE"
  | "REQUERY_RATE_HISTORY"
  | "RENORMALIZE_UOM"
  | "RERUN_VALIDATION"
  | "REQUEST_ADDITIONAL_EVIDENCE"
  // must escalate
  | "CHANGE_COMMERCIAL_COMMITMENT"
  | "SEND_EXTERNAL_DOCUMENT"
  | "FINANCIAL_ACTION"
  | "ACCOUNTING_WRITE"
  | "DESTRUCTIVE_ACTION";

const CORRECTION_ACTION: Readonly<Record<EstimationCorrection, GovernedActionType>> = {
  RECALCULATE: "DETERMINISTIC_CALCULATION",
  REQUERY_RATE_HISTORY: "READ_DATA",
  RENORMALIZE_UOM: "DETERMINISTIC_CALCULATION",
  RERUN_VALIDATION: "DETERMINISTIC_CALCULATION",
  REQUEST_ADDITIONAL_EVIDENCE: "READ_DATA",
  CHANGE_COMMERCIAL_COMMITMENT: "SIGN_CONTRACT",
  SEND_EXTERNAL_DOCUMENT: "SEND_EXTERNAL_RFQ",
  FINANCIAL_ACTION: "BANK_PAYMENT",
  ACCOUNTING_WRITE: "ACCOUNTING_WRITE",
  DESTRUCTIVE_ACTION: "PERMANENT_DATA_DELETION",
};

export function planEstimationCorrection(
  correction: EstimationCorrection,
  attemptsSoFar: number,
): { autoExecute: boolean; escalate: boolean; reason: string } {
  const governed = CORRECTION_ACTION[correction];
  if (requiresEscalation(governed)) {
    return { autoExecute: false, escalate: true, reason: `${correction} maps to ${governed}: Owner escalation required.` };
  }
  if (attemptsSoFar >= MAX_DETERMINISTIC_RETRIES) {
    return { autoExecute: false, escalate: true, reason: `Retry limit ${MAX_DETERMINISTIC_RETRIES} reached; escalate.` };
  }
  return { autoExecute: true, escalate: false, reason: `${correction} is a safe internal deterministic correction.` };
}

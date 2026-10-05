// ============================================================
// Bansil Books Analytics — Phase 4A: Estimation Safety Policy
// Deterministic hard rules applied before any estimate output is
// accepted. Zero AI calls. Rules:
//   NO fabricated rates          NO silent quantity invention
//   NO silent UOM conversion     NO commitment without approval
//   NO external send w/o approval NO Zoho write
//   NO superseded revision       NO high-risk costing w/o checker
//   NO silently-assumed ambiguity
// ============================================================

import { isZohoWriteAllowed } from "../ceo/authority-policy";
import type { ApprovalGrant } from "../ceo/governance-types";
import type { CheckerOutcome } from "../ceo/independent-checker";
import { canFinalizeEstimationOutput, checkEstimationAuthority, type EstimationAction } from "./authority";
import {
  assertDocumentUsableForCurrentEstimate,
  canonicalizeUom,
  validateBoqItem,
  validateRateEvidence,
} from "./evidence";
import { isFactualTier } from "./source-registry";
import type {
  BoqItem,
  ClarificationDeciderRole,
  ClarificationRecord,
  ClarificationStatus,
  EstimationDocument,
  Provenance,
  RateEvidence,
  RateVerificationStatus,
  ScopeItem,
} from "./types";

// ==================== AI FACT GUARD ====================

export type CommercialFactKind = "RATE" | "QUANTITY" | "VENDOR_QUOTE" | "COMMERCIAL_FACT" | "CONTRACT_REQUIREMENT";

export interface ResolvedFact<T> {
  kind: CommercialFactKind;
  value: T | null;
  status: RateVerificationStatus;
  provenance: Provenance | null;
  /** AI text is retained only as a non-factual note for human review. */
  aiNote?: string;
}

/**
 * Resolve a commercial fact. A value is accepted only from a sourced,
 * non-AI provenance. AI suggestions NEVER fill the value — a missing
 * fact stays MISSING / REQUIRES_OWNER_REVIEW with value null.
 */
export function resolveCommercialFact<T>(params: {
  kind: CommercialFactKind;
  sourced?: { value: T; provenance: Provenance } | null;
  aiSuggestion?: string;
}): ResolvedFact<T> {
  const { kind, sourced, aiSuggestion } = params;
  const p = sourced?.provenance;
  const traceable = !!p && !!p.sourceId && !!p.recordRef && !!p.recordDate && p.tier !== "AI_INFERENCE";
  if (sourced && traceable && isFactualTier(p!.tier)) {
    return { kind, value: sourced.value, status: "VERIFIED", provenance: p!, aiNote: aiSuggestion };
  }
  if (sourced && traceable && p!.tier === "APPROVED_ESTIMATOR_ASSUMPTION") {
    // Labelled non-source value — never VERIFIED.
    return { kind, value: sourced.value, status: "ASSUMPTION", provenance: p!, aiNote: aiSuggestion };
  }
  return {
    kind,
    value: null,
    status: kind === "RATE" ? "MISSING_RATE" : "REQUIRES_OWNER_REVIEW",
    provenance: null,
    aiNote: aiSuggestion,
  };
}

// ==================== CLARIFICATION / DEVIATION FLOW ====================

const CLARIFICATION_TRANSITIONS: Readonly<Record<ClarificationStatus, ReadonlyArray<ClarificationStatus>>> = {
  OPEN: ["REVIEWED"],
  REVIEWED: ["OWNER_DECISION_REQUIRED", "ACCEPTED", "REJECTED"],
  OWNER_DECISION_REQUIRED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["INCORPORATED"],
  REJECTED: [],
  INCORPORATED: [],
};

export function canTransitionClarification(from: ClarificationStatus, to: ClarificationStatus): boolean {
  return CLARIFICATION_TRANSITIONS[from].includes(to);
}

const BUSINESS_DECISIONS: ReadonlySet<ClarificationStatus> = new Set(["ACCEPTED", "REJECTED", "INCORPORATED"]);

/**
 * Apply a transition; ACCEPTED / REJECTED require a recorded human decider.
 * Authority: a CHECKER / REVIEWER may assess evidence quality (PASS,
 * PASS_WITH_NOTES, REJECT, INSUFFICIENT_EVIDENCE) but can never set a business
 * decision, and an OWNER_DECISION_REQUIRED clarification can only be accepted
 * or rejected by an explicit OWNER decider.
 */
export function transitionClarification(
  rec: ClarificationRecord,
  to: ClarificationStatus,
  decision?: { decidedBy: string; decidedAt: string; decision: string; deciderRole?: ClarificationDeciderRole },
): ClarificationRecord {
  if (!canTransitionClarification(rec.status, to)) {
    throw new Error(`INVALID_CLARIFICATION_TRANSITION:${rec.status}->${to}`);
  }
  if ((to === "ACCEPTED" || to === "REJECTED") && (!decision?.decidedBy || !decision?.decidedAt)) {
    throw new Error(`CLARIFICATION_DECISION_REQUIRES_DECIDER:${to}`);
  }
  if (BUSINESS_DECISIONS.has(to) && (decision?.deciderRole === "CHECKER" || decision?.deciderRole === "REVIEWER")) {
    throw new Error(`CHECKER_CANNOT_DECIDE_CLARIFICATION:${to}`);
  }
  if (rec.status === "OWNER_DECISION_REQUIRED" && (to === "ACCEPTED" || to === "REJECTED") && decision?.deciderRole !== "OWNER") {
    throw new Error(`OWNER_DECISION_REQUIRES_OWNER:${decision?.deciderRole ?? "ROLE_NOT_STATED"}`);
  }
  if (!decision) return { ...rec, status: to };
  return {
    ...rec,
    status: to,
    decision: decision.decision,
    decidedBy: decision.decidedBy,
    decidedAt: decision.decidedAt,
    ...(decision.deciderRole ? { decidedByRole: decision.deciderRole } : {}),
  };
}

/** Ambiguous scope always opens a clarification — never silently assumed. */
export function openClarificationForAmbiguity(item: ScopeItem, clarificationId: string): ClarificationRecord | null {
  if (item.inclusion !== "AMBIGUOUS") return null;
  return {
    clarificationId,
    kind: "CLARIFICATION",
    subject: `Scope ambiguity: ${item.description}`,
    raisedFrom: item.provenance,
    status: "OPEN",
  };
}

const RESOLVED: ReadonlySet<ClarificationStatus> = new Set(["ACCEPTED", "REJECTED", "INCORPORATED"]);

export function findUnresolvedAmbiguities(scope: ScopeItem[], clarifications: ClarificationRecord[]): string[] {
  const byId = new Map(clarifications.map((c) => [c.clarificationId, c]));
  return scope
    .filter((s) => s.inclusion === "AMBIGUOUS")
    .filter((s) => {
      const c = s.clarificationId ? byId.get(s.clarificationId) : undefined;
      return !c || !RESOLVED.has(c.status);
    })
    .map((s) => s.scopeId);
}

// ==================== AGGREGATE SAFETY GATE ====================

export interface EstimationSafetyInput {
  projectRef: string;
  documents: EstimationDocument[];
  /** Documents the estimate was derived from. */
  usedDocumentIds: string[];
  boqItems: BoqItem[];
  rates: RateEvidence[];
  scope: ScopeItem[];
  clarifications: ClarificationRecord[];
  /** UOM pairs used when pricing BOQ lines (BOQ UOM vs rate UOM). */
  uomPairs?: Array<{ boqUom: string; rateUom: string; validatedRuleApplied: boolean }>;
  isFinalCosting: boolean;
  checkerOutcome?: CheckerOutcome;
  /** Requested external / binding actions. */
  requestedActions?: EstimationAction[];
  grants?: ApprovalGrant[];
  zohoWriteRequested?: boolean;
}

export interface EstimationSafetyResult {
  pass: boolean;
  violations: string[];
}

export function evaluateEstimationSafety(input: EstimationSafetyInput): EstimationSafetyResult {
  const v: string[] = [];

  // NO Zoho write — permanent
  if (input.zohoWriteRequested || isZohoWriteAllowed()) v.push("ZOHO_WRITE_PROHIBITED");

  // NO superseded revision
  for (const id of input.usedDocumentIds) {
    const doc = input.documents.find((d) => d.documentId === id);
    if (!doc) { v.push(`DOCUMENT_UNKNOWN:${id}`); continue; }
    const r = assertDocumentUsableForCurrentEstimate(doc, input.documents);
    if (!r.valid) v.push(...r.violations.map((x) => `${x}:${id}`));
  }

  // NO silent quantity invention
  for (const b of input.boqItems) {
    const r = validateBoqItem(b);
    if (!r.valid) v.push(...r.violations.map((x) => `${x}:${b.lineNumber}`));
  }

  // NO fabricated rates
  for (const rate of input.rates) {
    const r = validateRateEvidence(rate);
    if (!r.valid) v.push(...r.violations.map((x) => `${x}:${rate.rateId}`));
  }

  // NO silent UOM conversion
  for (const p of input.uomPairs ?? []) {
    if (canonicalizeUom(p.boqUom) !== canonicalizeUom(p.rateUom) && !p.validatedRuleApplied) {
      v.push(`SILENT_UOM_CONVERSION:${p.rateUom}->${p.boqUom}`);
    }
  }

  // NO silently-assumed ambiguity in a final costing
  if (input.isFinalCosting) {
    for (const id of findUnresolvedAmbiguities(input.scope, input.clarifications)) v.push(`UNRESOLVED_AMBIGUITY:${id}`);
  }

  // NO high-risk final costing without independent checker
  if (input.isFinalCosting) {
    const fin = canFinalizeEstimationOutput({
      kind: "FINAL_COMMERCIAL_COSTING",
      ref: input.projectRef,
      checkerOutcome: input.checkerOutcome,
    });
    v.push(...fin.blockers);
  }

  // NO commitment / external send without exact Owner approval
  for (const a of input.requestedActions ?? []) {
    const auth = checkEstimationAuthority(a, input.projectRef, input.grants ?? []);
    if (!auth.allowed) v.push(`${auth.category}:${a}`);
  }

  return { pass: v.length === 0, violations: [...new Set(v)] };
}

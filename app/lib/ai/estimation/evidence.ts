// ============================================================
// Bansil Books Analytics — Phase 4A: Evidence, Provenance, Revision
// Control, Rate Validation, Freshness and Normalization contracts.
// Pure deterministic functions — zero AI/model calls, no DB writes.
// ============================================================

import crypto from "node:crypto";
import { getTierRank, isFactualTier } from "./source-registry";
import type {
  BoqItem,
  CommercialAssumption,
  DerivedOutputStamp,
  DocumentRevisionRef,
  EstimationDocument,
  Provenance,
  RateEvidence,
  RateFreshness,
  TaxBasis,
} from "./types";

export interface ValidationResult {
  valid: boolean;
  violations: string[];
}

const ok = (): ValidationResult => ({ valid: true, violations: [] });
const result = (violations: string[]): ValidationResult => ({ valid: violations.length === 0, violations });

// ==================== FINGERPRINTING ====================

/** SHA-256 of raw file bytes (hex). Same algorithm as audit intake. */
export function fingerprintContent(content: Buffer | string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function isValidSha256(value: string | undefined | null): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function toRevisionRef(doc: EstimationDocument): DocumentRevisionRef {
  return { documentId: doc.documentId, familyKey: doc.familyKey, revision: doc.revision, sha256: doc.sha256 };
}

// ==================== REVISION CONTROL ====================

/**
 * Current revision of a document family = highest revision with status CURRENT.
 * Returns null when the family has no current revision.
 */
export function selectCurrentRevision(docs: EstimationDocument[], familyKey: string): EstimationDocument | null {
  const current = docs
    .filter((d) => d.familyKey === familyKey && d.status === "CURRENT" && !d.supersededByDocumentId)
    .sort((a, b) => b.revision - a.revision);
  return current[0] ?? null;
}

/**
 * A document may feed a CURRENT estimate only if it is the current
 * revision of its family and its fingerprint is valid.
 */
export function assertDocumentUsableForCurrentEstimate(
  doc: EstimationDocument,
  allDocs: EstimationDocument[],
): ValidationResult {
  const v: string[] = [];
  if (!isValidSha256(doc.sha256)) v.push("DOCUMENT_FINGERPRINT_MISSING_OR_INVALID");
  if (doc.status !== "CURRENT" || doc.supersededByDocumentId) v.push("SUPERSEDED_REVISION_REJECTED");
  const current = selectCurrentRevision(allDocs, doc.familyKey);
  if (current && current.documentId !== doc.documentId) v.push("NEWER_REVISION_EXISTS");
  return result(v);
}

/**
 * Derived output is fresh only if every revision it used is still the
 * current revision AND its fingerprint is unchanged. Any change ⇒ STALE.
 */
export function checkDerivedOutputFreshness(
  stamp: DerivedOutputStamp,
  allDocs: EstimationDocument[],
): { fresh: boolean; staleReasons: string[] } {
  const reasons: string[] = [];
  if (stamp.usedRevisions.length === 0) reasons.push("NO_SOURCE_REVISIONS_RECORDED");
  for (const used of stamp.usedRevisions) {
    const current = selectCurrentRevision(allDocs, used.familyKey);
    if (!current) {
      reasons.push(`NO_CURRENT_REVISION:${used.familyKey}`);
    } else if (current.documentId !== used.documentId || current.revision !== used.revision) {
      reasons.push(`REVISION_CHANGED:${used.familyKey}:${used.revision}->${current.revision}`);
    } else if (current.sha256 !== used.sha256) {
      reasons.push(`FINGERPRINT_CHANGED:${used.familyKey}`);
    }
  }
  return { fresh: reasons.length === 0, staleReasons: reasons };
}

// ==================== PROVENANCE ====================

export function validateProvenance(p: Provenance | null | undefined): ValidationResult {
  if (!p) return result(["PROVENANCE_MISSING"]);
  const v: string[] = [];
  if (!p.sourceId) v.push("PROVENANCE_SOURCE_MISSING");
  if (!p.recordRef) v.push("PROVENANCE_RECORD_REF_MISSING");
  if (!p.recordDate || Number.isNaN(Date.parse(p.recordDate))) v.push("PROVENANCE_DATE_MISSING");
  if (getTierRank(p.tier) > 9) v.push("PROVENANCE_TIER_UNKNOWN");
  if (p.documentRevision && !isValidSha256(p.documentRevision.sha256)) v.push("PROVENANCE_REVISION_FINGERPRINT_INVALID");
  return result(v);
}

/** BOQ quantities are never invented: qty + UOM + provenance are mandatory. */
export function validateBoqItem(item: BoqItem): ValidationResult {
  const v: string[] = [];
  if (item.quantity === null || !Number.isFinite(item.quantity) || item.quantity <= 0) v.push("BOQ_QUANTITY_MISSING");
  if (!item.uom || !item.uom.trim()) v.push("BOQ_UOM_MISSING");
  const pv = validateProvenance(item.quantityProvenance);
  if (!pv.valid) v.push(...pv.violations.map((x) => `BOQ_QTY_${x}`));
  if (item.quantityProvenance && item.quantityProvenance.tier === "AI_INFERENCE") v.push("BOQ_QUANTITY_FROM_AI_INFERENCE");
  return result(v);
}

// ==================== ASSUMPTIONS ====================

export function validateAssumption(a: CommercialAssumption | undefined): ValidationResult {
  if (!a) return result(["ASSUMPTION_MISSING"]);
  const v: string[] = [];
  if (!a.basis || !a.basis.trim()) v.push("ASSUMPTION_BASIS_MISSING");
  if (a.approvalStatus === "OWNER_APPROVED" && (!a.approval?.approvedBy || !a.approval?.approvedAt)) {
    v.push("ASSUMPTION_APPROVAL_STAMP_MISSING");
  }
  if (a.approvalStatus === "REJECTED") v.push("ASSUMPTION_REJECTED");
  return result(v);
}

export function isAssumptionOwnerApproved(a: CommercialAssumption | undefined): boolean {
  return !!a && a.approvalStatus === "OWNER_APPROVED" && validateAssumption(a).valid;
}

// ==================== RATE EVIDENCE ====================

const MANUAL_CLASSES = new Set(["MANUAL_APPROVED_RATE", "PROVISIONAL_RATE"]);

/**
 * Hard rules for a rate to be usable at all (any status):
 *  - provenance with source + date, tax basis, UOM, currency.
 * Additional rules for VERIFIED:
 *  - numeric rate > 0, factual tier, not AI.
 * Manual / provisional rates require an assumption record;
 * MANUAL_APPROVED_RATE requires Owner approval.
 */
export function validateRateEvidence(r: RateEvidence): ValidationResult {
  const v: string[] = [];

  if (r.verificationStatus === "MISSING_RATE") {
    // Explicit gap marker: must NOT carry a number.
    if (r.rate !== null) v.push("MISSING_RATE_MUST_NOT_CARRY_VALUE");
    return result(v);
  }

  if (!r.provenance) v.push("RATE_SOURCE_MISSING");
  else {
    if (!r.provenance.sourceId || !r.provenance.recordRef) v.push("RATE_SOURCE_MISSING");
    if (!r.provenance.recordDate) v.push("RATE_DATE_MISSING");
  }
  if (!r.rateDate || Number.isNaN(Date.parse(r.rateDate))) v.push("RATE_DATE_MISSING");
  if (!r.taxBasis) v.push("RATE_TAX_BASIS_MISSING");
  if (!r.uom || !r.uom.trim()) v.push("RATE_UOM_MISSING");
  if (!r.currency) v.push("RATE_CURRENCY_MISSING");
  if (!r.freightBasis) v.push("RATE_FREIGHT_BASIS_MISSING");
  if (r.rate === null || !Number.isFinite(r.rate) || r.rate <= 0) v.push("RATE_VALUE_INVALID");

  if (r.verificationStatus === "VERIFIED") {
    if (r.provenance && !isFactualTier(r.provenance.tier)) v.push("VERIFIED_RATE_REQUIRES_FACTUAL_SOURCE");
    if (r.taxBasis === "UNKNOWN") v.push("VERIFIED_RATE_REQUIRES_KNOWN_TAX_BASIS");
    // Manual/provisional values stay labelled ASSUMPTION even when Owner-approved.
    if (MANUAL_CLASSES.has(r.rateClass)) v.push("MANUAL_RATE_CANNOT_BE_VERIFIED");
  }

  if (r.verificationStatus === "AI_INFERENCE" || r.provenance?.tier === "AI_INFERENCE") {
    // AI may annotate, never price.
    v.push("AI_INFERENCE_CANNOT_BE_A_COMMERCIAL_RATE");
  }

  if (MANUAL_CLASSES.has(r.rateClass)) {
    const av = validateAssumption(r.assumption);
    if (!av.valid) v.push(...av.violations.map((x) => `MANUAL_RATE_${x}`));
    if (r.rateClass === "MANUAL_APPROVED_RATE" && !isAssumptionOwnerApproved(r.assumption)) {
      v.push("MANUAL_RATE_REQUIRES_OWNER_APPROVAL");
    }
  }

  if (r.verificationStatus === "ASSUMPTION" || r.verificationStatus === "ESTIMATE") {
    const av = validateAssumption(r.assumption);
    if (!av.valid) v.push(...av.violations.map((x) => `NON_SOURCE_RATE_${x}`));
  }

  return result([...new Set(v)]);
}

/**
 * Promotion to VERIFIED is the only path to a factual rate.
 * Requires a factual source tier. AI inference and manual/provisional
 * values (even Owner-approved) can never be promoted — they remain
 * ASSUMPTION / REQUIRES_OWNER_REVIEW.
 */
export function canPromoteToVerified(r: RateEvidence): { allowed: boolean; reason: string } {
  if (r.verificationStatus === "AI_INFERENCE" || r.provenance?.tier === "AI_INFERENCE") {
    return { allowed: false, reason: "AI_INFERENCE can never become a VERIFIED commercial rate." };
  }
  if (MANUAL_CLASSES.has(r.rateClass)) {
    return { allowed: false, reason: "Manual/provisional rates remain labelled ASSUMPTION; never VERIFIED." };
  }
  if (!r.provenance || !isFactualTier(r.provenance.tier)) {
    return { allowed: false, reason: "VERIFIED requires a factual source tier." };
  }
  const check = validateRateEvidence({ ...r, verificationStatus: "VERIFIED" });
  return check.valid
    ? { allowed: true, reason: "All evidence requirements satisfied." }
    : { allowed: false, reason: check.violations.join(", ") };
}

// ==================== RATE FRESHNESS ====================

/**
 * Freshness thresholds are POLICY, supplied by Owner/company config.
 * There is deliberately no default: without a policy, status is UNKNOWN.
 */
export interface RateFreshnessPolicy {
  currentMaxAgeDays: number;
  agingMaxAgeDays: number;   // > this ⇒ STALE
  policyRef: string;         // who/what defined it
}

export function rateAgeDays(rateDate: string | null, asOf: string): number | null {
  if (!rateDate) return null;
  const a = Date.parse(rateDate);
  const b = Date.parse(asOf);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

export function classifyRateFreshness(
  rateDate: string | null,
  asOf: string,
  policy?: RateFreshnessPolicy | null,
  validUntil?: string,
): { ageDays: number | null; status: RateFreshness; reason: string } {
  const ageDays = rateAgeDays(rateDate, asOf);
  if (ageDays === null) return { ageDays, status: "UNKNOWN", reason: "Rate date missing/invalid." };
  if (validUntil && !Number.isNaN(Date.parse(validUntil)) && Date.parse(validUntil) < Date.parse(asOf)) {
    return { ageDays, status: "STALE", reason: "Vendor validity expired." };
  }
  if (!policy) return { ageDays, status: "UNKNOWN", reason: "No Owner freshness policy configured." };
  if (policy.currentMaxAgeDays < 0 || policy.agingMaxAgeDays < policy.currentMaxAgeDays) {
    return { ageDays, status: "UNKNOWN", reason: "Invalid freshness policy." };
  }
  if (ageDays <= policy.currentMaxAgeDays) return { ageDays, status: "CURRENT", reason: policy.policyRef };
  if (ageDays <= policy.agingMaxAgeDays) return { ageDays, status: "AGING", reason: policy.policyRef };
  return { ageDays, status: "STALE", reason: policy.policyRef };
}

// ==================== NORMALIZATION CONTRACTS ====================

/**
 * UOM canonicalization: ONLY case/whitespace/known-spelling aliases of the
 * SAME unit. Observed variants in bill lines: Nos/NOS/nos, M, SET, kg, Lot…
 * This never converts between different units.
 */
const UOM_SPELLING_ALIASES: Record<string, string> = {
  nos: "NOS", no: "NOS", "no.": "NOS", pcs: "PCS", pc: "PCS",
  m: "M", mtr: "M", mtrs: "M", meter: "M", metre: "M", meters: "M", metres: "M",
  kg: "KG", kgs: "KG",
  set: "SET", sets: "SET",
  lot: "LOT", job: "JOB", ton: "TON", month: "MONTH", "man-day": "MAN_DAY", manday: "MAN_DAY",
};

export function canonicalizeUom(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase();
  if (!k) return null;
  return UOM_SPELLING_ALIASES[k] ?? raw.trim().toUpperCase();
}

/** A validated conversion between DIFFERENT units (e.g. ROLL→M). Owner-approved only. */
export interface UomConversionRule {
  fromUom: string;
  toUom: string;
  factor: number;          // qty_to = qty_from × factor
  itemRef?: string;        // pack sizes are item-specific
  approvedBy: string;
  approvedAt: string;
}

/**
 * Convert a quantity between units. Same canonical unit ⇒ identity.
 * Different units ⇒ requires an explicit, approved rule. Never silent.
 */
export function convertQuantity(
  qty: number,
  fromUom: string,
  toUom: string,
  rules: UomConversionRule[],
  itemRef?: string,
): { ok: true; qty: number; ruleApplied?: UomConversionRule } | { ok: false; reason: string } {
  const f = canonicalizeUom(fromUom);
  const t = canonicalizeUom(toUom);
  if (!f || !t) return { ok: false, reason: "UOM_MISSING" };
  if (f === t) return { ok: true, qty };
  const rule = rules.find(
    (r) => canonicalizeUom(r.fromUom) === f && canonicalizeUom(r.toUom) === t &&
      (!r.itemRef || r.itemRef === itemRef) && r.approvedBy && r.approvedAt && r.factor > 0,
  );
  if (!rule) return { ok: false, reason: `NO_VALIDATED_UOM_RULE:${f}->${t}` };
  return { ok: true, qty: qty * rule.factor, ruleApplied: rule };
}

/** Item/vendor/make naming: deterministic key only (no fuzzy/AI matching in 4A). */
export function normalizeNameKey(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/**
 * GST-inclusive → taxable conversion. Requires the GST rate from the SOURCE
 * record; never assumes a rate. Returns null if not derivable.
 */
export function toGstExclusiveRate(rate: number, taxBasis: TaxBasis, gstRatePercent?: number): number | null {
  if (taxBasis === "GST_EXCLUSIVE") return rate;
  if (taxBasis === "GST_INCLUSIVE" && typeof gstRatePercent === "number" && gstRatePercent >= 0) {
    return Math.round((rate / (1 + gstRatePercent / 100)) * 10000) / 10000;
  }
  return null;
}

/** Currency must match the project currency; FX conversion is out of scope for 4A. */
export function assertSameCurrency(rateCurrency: string, projectCurrency: string): ValidationResult {
  return rateCurrency.toUpperCase() === projectCurrency.toUpperCase()
    ? ok()
    : result([`CURRENCY_MISMATCH_NO_FX_RULE:${rateCurrency}->${projectCurrency}`]);
}

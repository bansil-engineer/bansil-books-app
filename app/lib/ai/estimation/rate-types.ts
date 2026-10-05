// ============================================================
// Bansil Books Analytics — Phase 4D: Vendor / Historical Rate Engine
// Types + truthful rate-source capability matrix.
//
// Phase 4D answers ONE question per BOQ/item/UOM:
//   "What verified commercial rate evidence exists?"
// It never computes qty × rate totals, project cost or margin,
// never selects a vendor, never sends an RFQ, never writes to the
// business / audit DBs, and never writes to Zoho (ZOHO WRITE = 0).
// ============================================================

import type { RateClass, RateFreshness, SourceTier, TaxBasis } from "./types";

/** Phase 4D source types are exactly the Phase 4A rate classes. */
export type RateSourceType = RateClass;

// ==================== SOURCE CAPABILITY (TRUTHFUL) ====================

export type RateSourceAvailability =
  | "VERIFIED_AVAILABLE"      // backed by real records in an operational snapshot
  | "DERIVED_FROM_VERIFIED"   // deterministic view over a VERIFIED_AVAILABLE source
  | "ESTIMATION_STORE_ONLY"   // only exists when entered into estimation.sqlite (never VERIFIED)
  | "NOT_AVAILABLE";          // no store / no records — never advertised as usable

export interface RateSourceCapability {
  sourceType: RateSourceType;
  availability: RateSourceAvailability;
  physicalSource: string | null;
  /** Can evidence of this type ever be VERIFIED? */
  canBeVerified: boolean;
  evidence: string;
  limitation: string;
}

/**
 * Discovered READ-ONLY against the immutable snapshot
 * claude-readonly-rate-source-20261004 (bansil_books.db sha256 16338bb7…,
 * audit_workspace.db sha256 10ef40ac…).
 */
export const RATE_SOURCE_CAPABILITIES: ReadonlyArray<RateSourceCapability> = [
  {
    sourceType: "BILL_RATE",
    availability: "VERIFIED_AVAILABLE",
    physicalSource: "bansil_books.purchase_bills + purchase_bill_line_items",
    canBeVerified: true,
    evidence: "3097 bills / 6851 lines, 2022-04-01..2026-09-26, 369 vendors; line rate, qty, line_total, item_id (6280 lines), unit (3697 lines), purchaseorder_item_id (1935 lines).",
    limitation: "No per-line GST rate or tax flag; unit missing on 3154 lines; no freight/pack fields; 21 lines qty×rate≠line_total.",
  },
  {
    sourceType: "LAST_PURCHASE_RATE",
    availability: "DERIVED_FROM_VERIFIED",
    physicalSource: "derived from BILL_RATE evidence",
    canBeVerified: true,
    evidence: "Latest VERIFIED comparable bill line (date, document no., line id tie-break).",
    limitation: "Only as good as BILL_RATE; never an unexplained number.",
  },
  {
    sourceType: "HISTORICAL_PURCHASE_RATE",
    availability: "DERIVED_FROM_VERIFIED",
    physicalSource: "derived from BILL_RATE evidence",
    canBeVerified: true,
    evidence: "Deterministic series metrics (last/min/max/median/weighted average) over VERIFIED comparable bill lines.",
    limitation: "Evidence metrics only — never auto-selected as a tender rate.",
  },
  {
    sourceType: "PO_RATE",
    availability: "VERIFIED_AVAILABLE",
    physicalSource: "audit_workspace.audit_purchase_orders + audit_purchase_order_lines",
    canBeVerified: true,
    evidence: "813 POs / 2789 lines, 2025-04-01..2026-10-03, 134 vendors; unit on 2742 lines; statuses billed/partially_billed/open/approved/draft/pending_approval/cancelled.",
    limitation: "Committed/provisional only — kept separate from bills; cancelled excluded; draft/pending_approval require review; history starts 2025-04.",
  },
  {
    sourceType: "MANUAL_APPROVED_RATE",
    availability: "ESTIMATION_STORE_ONLY",
    physicalSource: "estimation.sqlite estimation_rate_evidence (record_kind = MANUAL_ENTRY)",
    canBeVerified: false,
    evidence: "Phase 4D manual-rate capture with approval provenance.",
    limitation: "Always ASSUMPTION or OWNER_APPROVED_MANUAL_RATE — never VERIFIED.",
  },
  {
    sourceType: "PROVISIONAL_RATE",
    availability: "ESTIMATION_STORE_ONLY",
    physicalSource: "estimation.sqlite estimation_rate_evidence (record_kind = MANUAL_ENTRY)",
    canBeVerified: false,
    evidence: "Estimator provisional value with basis.",
    limitation: "Always ASSUMPTION — never VERIFIED.",
  },
  {
    sourceType: "CURRENT_VENDOR_QUOTE",
    availability: "NOT_AVAILABLE",
    physicalSource: null,
    canBeVerified: false,
    evidence: "No vendor-quotation table or intake in either snapshot.",
    limitation: "Cannot be produced until vendor-quotation intake exists.",
  },
  {
    sourceType: "LIST_RATE",
    availability: "NOT_AVAILABLE",
    physicalSource: null,
    canBeVerified: false,
    evidence: "audit_item_master.rate is the Zoho SALES rate, not a vendor list price.",
    limitation: "Not used as purchase-cost evidence.",
  },
  {
    sourceType: "CONTRACT_RATE",
    availability: "NOT_AVAILABLE",
    physicalSource: null,
    canBeVerified: false,
    evidence: "No rate-contract table in either snapshot.",
    limitation: "Not advertised.",
  },
];

export function getRateSourceCapability(t: RateSourceType): RateSourceCapability {
  const c = RATE_SOURCE_CAPABILITIES.find((x) => x.sourceType === t);
  if (!c) throw new Error(`Unknown rate source type: ${t}`);
  return c;
}

/** Source types that may actually be returned by the engine. */
export function listAdvertisedRateSourceTypes(): RateSourceType[] {
  return RATE_SOURCE_CAPABILITIES.filter((c) => c.availability !== "NOT_AVAILABLE").map((c) => c.sourceType);
}

// ==================== EVIDENCE ====================

export type RateFreightBasis = "INCLUDED" | "EXCLUDED" | "UNKNOWN";

export type RateEvidenceStatus =
  | "VERIFIED"                      // factual source record, all gates passed
  | "PROVISIONAL"                   // factual record of a non-final commitment (e.g. PO not yet billed)
  | "ASSUMPTION"                    // manual / provisional value without Owner approval
  | "OWNER_APPROVED_MANUAL_RATE"    // manual value with Owner approval stamp — still NOT verified
  | "CANDIDATE_ONLY"                // from a fuzzy / AI item match — never commercial evidence
  | "REQUIRES_OWNER_REVIEW";        // factual record failing a gate (UOM/tax/arithmetic/status)

export type CommitmentStatus =
  | "ACTUAL_PURCHASE"   // bill
  | "COMMITTED_PO"      // PO billed / partially billed / linked to a bill line
  | "PROVISIONAL_PO"    // PO open/approved with no bill
  | "UNAPPROVED_PO"     // draft / pending approval
  | "MANUAL"
  | "NOT_APPLICABLE";

export type EvidenceQuality = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type ItemMatchMethod =
  | "EXACT_ITEM_ID"
  | "EXACT_ITEM_CODE"
  | "EXACT_NORMALIZED_NAME"
  | "APPROVED_ALIAS"
  | "CANDIDATE_MATCH"
  | "AI_SUGGESTION"
  | "AMBIGUOUS"
  | "UNRESOLVED";

export type ItemMatchStatus = "MATCHED" | "CANDIDATE_ONLY" | "AMBIGUOUS" | "UNRESOLVED";

export type UomNormalization = "IDENTICAL" | "SPELLING_ALIAS" | "APPROVED_ALIAS" | "NONE";

export interface RateProvenance {
  sourceSystem: "BANSIL_BOOKS_DB" | "AUDIT_WORKSPACE_DB" | "ESTIMATION_DB";
  table: string;
  recordId: string;
  documentId: string | null;
  documentNumber: string | null;
  recordDate: string;
  tier: SourceTier;
  /** sha256 over the exact source row values used. */
  sourceFingerprint: string;
  basis: string;
}

export interface PackBasis {
  /** "UNIT" = rate per uom; "PACK" = rate per pack of pack_quantity × pack_uom. */
  rate_per: "UNIT" | "PACK" | "UNKNOWN";
  pack_quantity: number | null;
  pack_uom: string | null;
}

export interface LandedChargeRef {
  source_record_id: string;
  description: string;
  amount: number;
  source_document: string | null;
}

export interface ManualApproval {
  assumptionId: string;
  basis: string;
  enteredBy: string;
  enteredAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface RateEvidenceRecord {
  rate_evidence_id: string;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  description: string | null;
  item_match_method: ItemMatchMethod;
  vendor_name: string | null;
  vendor_id: string | null;
  rate: number | null;
  currency: string;
  source_type: RateSourceType;
  source_record_id: string | null;
  source_document: string | null;
  source_document_id: string | null;
  source_date: string | null;
  age_days: number | null;
  quantity: number | null;
  /** Source UOM exactly as recorded. */
  uom: string | null;
  /** Only set when an approved spelling alias / alias rule applies. */
  normalized_uom: string | null;
  uom_normalization: UomNormalization;
  tax_basis: TaxBasis;
  gst_rate_percent: number | null;
  tax_basis_source: string;
  freight_basis: RateFreightBasis;
  freight_basis_source: string;
  /** Basic rate is never treated as landed. */
  landed_cost_basis: "BASIC_RATE_ONLY" | "DECLARED_INCLUDES_LANDED" | "UNKNOWN";
  same_document_landed_charges: LandedChargeRef[];
  is_landed_charge_line: boolean;
  pack: PackBasis;
  validity_date: string | null;
  commitment_status: CommitmentStatus;
  verification_status: RateEvidenceStatus;
  evidence_quality: EvidenceQuality;
  freshness: RateFreshness;
  freshness_reason: string;
  provenance: RateProvenance | null;
  linked_po_line_id: string | null;
  linked_bill_line_ids: string[];
  approval: ManualApproval | null;
  warnings: string[];
}

// ==================== COMPARABILITY / SERIES ====================

export interface UomAliasRule {
  /** Label alias of the SAME unit, e.g. "Nos." → "NOS". */
  alias: string;
  canonical: string;
  approvedBy: string;
  approvedAt: string;
}

export interface ComparableRate {
  rate_evidence_id: string;
  status: "COMPARABLE" | "RATE_NOT_COMPARABLE";
  /** GST-exclusive rate per BOQ UOM. null when not comparable. */
  comparable_rate: number | null;
  comparable_quantity: number | null;
  comparable_uom: string | null;
  reasons: string[];
  conversion_applied: string | null;
}

export interface RateSeriesPoint {
  rate_evidence_id: string;
  source_record_id: string;
  date: string;
  rate: number;
  quantity: number;
  vendor_id: string | null;
}

export interface RateSeriesMetrics {
  source_family: "ACTUAL_PURCHASE_BILL" | "PURCHASE_ORDER";
  uom: string | null;
  tax_basis: "GST_EXCLUSIVE";
  count: number;
  points: RateSeriesPoint[]; // sorted by date asc, then evidence id
  last: RateSeriesPoint | null;
  min: number | null;
  max: number | null;
  median: number | null;
  weighted_average: number | null;
  total_quantity: number;
  /** Evidence metrics only. Never a tender rate. */
  is_tender_rate: false;
}

export interface VendorRateHistory {
  vendor_id: string | null;
  vendor_name: string | null;
  bill_series: RateSeriesMetrics;
  po_series: RateSeriesMetrics;
}

export interface LastPurchaseRate {
  rate_evidence_id: string;
  vendor_id: string | null;
  vendor_name: string | null;
  date: string;
  quantity: number;
  rate: number;
  uom: string;
  comparable_rate: number;
  comparable_uom: string;
  source_type: "BILL_RATE";
  source_document: string | null;
  source_record_id: string;
  tax_basis: TaxBasis;
  freight_basis: RateFreightBasis;
  age_days: number | null;
  freshness: RateFreshness;
  same_date_evidence_count: number;
}

// ==================== ITEM MATCH ====================

export interface ItemIdentityQuery {
  itemId?: string | null;
  itemCode?: string | null;
  description?: string | null;
}

export interface ItemMasterRow {
  item_id: string;
  name: string | null;
  sku: string | null;
  unit: string | null;
  status: string | null;
}

export interface ItemCandidate {
  item_id: string;
  item_name: string | null;
  method: "CANDIDATE_MATCH" | "AI_SUGGESTION";
  score: number | null;
  status: "CANDIDATE_ONLY";
}

/** Owner-approved alias (estimation_item_match_candidates.status = OWNER_APPROVED). */
export interface ApprovedItemAlias {
  query_key: string;          // "NAME:<normalized>" or "CODE:<normalized>"
  item_id: string;
  approved_by: string;
  approved_at: string;
}

export interface ItemMatchResult {
  status: ItemMatchStatus;
  method: ItemMatchMethod;
  item: ItemMasterRow | null;
  candidates: ItemCandidate[];
  reason: string;
}

// ==================== BOQ INTEGRATION ====================

export interface BoqLineRateInput {
  boq_line_id: string;
  project_id: string;
  description: string;
  uom: string | null;
  item_code?: string | null;
  /** Optional, only when already resolved upstream against the item master. */
  item_id?: string | null;
}

export type BoqRateStatus =
  | "EVIDENCE_AVAILABLE"
  | "RATE_NOT_COMPARABLE"
  | "MISSING_RATE"
  | "UNRESOLVED_ITEM"
  | "CANDIDATE_ONLY";

export interface BestAvailableEvidence {
  rate_evidence_id: string;
  selection_basis: "EVIDENCE_PRECEDENCE_THEN_RECENCY";
  /** Phase 4D never decides the tender rate. */
  use_as_tender_rate: false;
  decision: "ESTIMATOR_DECISION_REQUIRED";
}

export interface PossibleNextAction {
  action: "OWNER_APPROVED_MANUAL_ASSUMPTION" | "VENDOR_RFQ" | "ADDITIONAL_RESEARCH" | "OWNER_ITEM_MAPPING";
  requires_owner_approval: boolean;
  /** Phase 4D only lists actions. It never executes them. */
  executed: false;
}

export interface RateReviewHookResult {
  kind: "HISTORICAL_RATE_LOOKUP" | "VENDOR_COMPARISON" | "FINAL_COMMERCIAL_COSTING";
  riskLevel: string;
  reviewRequired: boolean;
  reason: string;
}

export interface BoqLineRateResult {
  boq_line_id: string;
  project_id: string;
  boq_description: string;
  boq_uom: string | null;
  boq_item_code: string | null;
  item_match_status: ItemMatchStatus;
  item_match: ItemMatchResult;
  rate_status: BoqRateStatus;
  evidence: RateEvidenceRecord[];
  comparable: ComparableRate[];
  comparable_evidence_count: number;
  bill_series: RateSeriesMetrics;
  po_series: RateSeriesMetrics;
  vendor_history: VendorRateHistory[];
  last_purchase: LastPurchaseRate | null;
  best_available_evidence: BestAvailableEvidence | null;
  /** Always false — vendor selection belongs to a later decision layer. */
  vendor_auto_selected: false;
  warnings: string[];
  clarifications: string[];
  possible_next_actions: PossibleNextAction[];
  review_hook: RateReviewHookResult;
  model_calls: 0;
}

export interface RateLookupRunSummary {
  run_id: string;
  project_id: string;
  as_of_date: string;
  method: "DETERMINISTIC";
  model_calls: 0;
  boq_line_count: number;
  evidence_available_count: number;
  missing_rate_count: number;
  unresolved_count: number;
  cache_hits: number;
  cache_misses: number;
  cache_invalidated: number;
  source_fingerprint_books: string | null;
  source_fingerprint_audit: string | null;
  results: BoqLineRateResult[];
}

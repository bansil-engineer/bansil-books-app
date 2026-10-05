// ============================================================
// Bansil Books Analytics — Phase 4E: Technical Equivalence Engine
// Types for deterministic technical-equivalence assessment.
//
// Phase 4E answers ONE question per (RateEvidenceRecord, BoqLineRateInput):
//   "Is this rate evidence technically applicable to this BOQ item?"
//
// Entirely separate from:
//   - Rate value / price selection (Phase 4D preserved unchanged)
//   - Commercial decisions (vendor preference, cheapest, newest)
//   - Owner approval (never fabricated)
//
// Constraints enforced by these types:
//   6. Known technical conflict MUST override description similarity or rate preference.
//   7. Cheapest/newest/historically-frequent rate MUST NEVER change technical-equivalence status.
//   8. Unknown evidence MUST remain UNKNOWN / INSUFFICIENT_EVIDENCE.
//   9. System result MUST NEVER fabricate Owner approval.
//  10. Phase 4D rate/provenance preserved unchanged.
//  11. Same inputs → deterministic results.
//  12. Technical result, commercial decision, Owner approval are separate layers.
// ============================================================

import type {
  RateEvidenceRecord,
  BoqLineRateInput,
  UomAliasRule,
  UomNormalization,
} from "./rate-types";

// ==================== EQUIVALENCE STATUS ====================

/**
 * Overall technical-equivalence status between a rate evidence record
 * and a BOQ line.
 *
 * TECHNICALLY_EQUIVALENT:  all checked dimensions match.
 * TECHNICALLY_CONFLICT:    at least one dimension is a known conflict.
 *                          ALWAYS overrides description similarity or rate preference.
 * INSUFFICIENT_EVIDENCE:   missing attributes prevent determination.
 *                          Never promoted — unknown stays unknown.
 * UOM_INCOMPATIBLE:        units cannot be reconciled technically.
 * MAKE_CONFLICT:           BOQ specifies make; evidence is different make.
 * SPEC_CONFLICT:           rating/capacity/grade/standard mismatch.
 */
export type TechnicalEquivalenceStatus =
  | "TECHNICALLY_EQUIVALENT"
  | "TECHNICALLY_CONFLICT"
  | "INSUFFICIENT_EVIDENCE"
  | "UOM_INCOMPATIBLE"
  | "MAKE_CONFLICT"
  | "SPEC_CONFLICT";

/** All statuses that represent a hard technical conflict. */
export const CONFLICT_STATUSES: ReadonlySet<TechnicalEquivalenceStatus> = new Set([
  "TECHNICALLY_CONFLICT",
  "UOM_INCOMPATIBLE",
  "MAKE_CONFLICT",
  "SPEC_CONFLICT",
]);

// ==================== DIMENSION COMPARISON ====================

/**
 * Technical dimensions checked by the engine.
 * Each is evaluated independently; a CONFLICT on ANY dimension
 * makes the overall result a conflict status.
 */
export type TechnicalDimensionName =
  | "SPEC"       // rating, capacity, size from description
  | "UOM"        // unit of measurement compatibility
  | "MAKE"       // manufacturer / brand
  | "GRADE"      // material grade / class (e.g. IS2062 E250 vs E350)
  | "STANDARD";  // IS / IEC / BS standard reference

/**
 * Result of comparing one technical dimension.
 *
 * MATCH:    values present and identical after normalization.
 * CONFLICT: values present and different — hard override.
 * UNKNOWN:  one or both values missing — cannot determine (constraint 8).
 */
export type DimensionStatus = "MATCH" | "CONFLICT" | "UNKNOWN";

export interface TechnicalDimensionResult {
  dimension: TechnicalDimensionName;
  status: DimensionStatus;
  /** Value from the BOQ line side. */
  boqValue: string | null;
  /** Value from the rate evidence side. */
  evidenceValue: string | null;
  /** Explanation when CONFLICT. null otherwise. */
  conflictNote: string | null;
}

// ==================== EQUIVALENCE RESULT ====================

/**
 * Complete result of assessing technical equivalence between one
 * RateEvidenceRecord and one BoqLineRateInput.
 *
 * Immutable after creation. This is a TECHNICAL result only.
 * Commercial decision (which rate to use) is separate.
 * Owner approval is separate.
 * Phase 4D rate/provenance is NOT included and NOT modified.
 */
export interface TechnicalEquivalenceResult {
  status: TechnicalEquivalenceStatus;
  /** Per-dimension breakdown — the full reasoning chain. */
  dimensions: TechnicalDimensionResult[];
  /**
   * Never populated by the engine — only by Owner action (constraint 9).
   * Always null in 4E output.
   */
  ownerOverride: null;
  /** ISO timestamp of the assessment. */
  assessedAt: string;
  /** Engine version. */
  engineVersion: string;
  /** Literal true — no AI calls possible (constraint 4/11). */
  deterministic: true;
  /** Zero model calls — fully deterministic. */
  model_calls: 0;
}

// ==================== BATCH RESULT ====================

/**
 * Result of assessing technical equivalence for one BOQ line
 * against all its rate evidence records.
 */
export interface BoqLineTechnicalEquivalenceResult {
  boq_line_id: string;
  boq_description: string;
  boq_uom: string | null;
  /** Rate evidence IDs that are TECHNICALLY_EQUIVALENT. */
  equivalent_evidence_ids: string[];
  /** Rate evidence IDs with a conflict status. */
  conflict_evidence: Array<{
    rate_evidence_id: string;
    status: TechnicalEquivalenceStatus;
    conflict_dimensions: TechnicalDimensionName[];
    reason: string;
  }>;
  /** Rate evidence IDs where equivalence could not be determined. */
  insufficient_evidence: Array<{
    rate_evidence_id: string;
    unknown_dimensions: TechnicalDimensionName[];
    reason: string;
  }>;
  /** Total comparisons performed. */
  comparison_count: number;
  /** Literal zero — deterministic only. */
  model_calls: 0;
}

/**
 * Summary of a batch technical-equivalence run across all BOQ lines.
 */
export interface TechnicalEquivalenceRunSummary {
  run_id: string;
  project_id: string;
  as_of_date: string;
  method: "DETERMINISTIC";
  model_calls: 0;
  boq_line_count: number;
  total_comparisons: number;
  equivalent_count: number;
  conflict_count: number;
  insufficient_count: number;
  boq_results: BoqLineTechnicalEquivalenceResult[];
  engine_version: string;
}

// ==================== SPECIFICATION PARSING ====================

/**
 * A parsed specification token extracted from a description string.
 * Used for deterministic specification comparison.
 */
export type SpecTokenCategory =
  | "SIZE"       // physical dimension / cross-section (e.g. "4 SQ MM", "100MM")
  | "RATING"     // electrical rating / capacity (e.g. "6A", "415V", "20W")
  | "MATERIAL"   // material composition (e.g. "COPPER", "ALUMINIUM", "GI")
  | "STANDARD"   // standard reference (e.g. "IS2062", "IEC60947", "BS7671")
  | "TYPE"       // product type / sub-type (e.g. "SP", "TP", "C-CURVE")
  | "BRAND"      // manufacturer / brand (e.g. "HAVELLS", "ANCHOR", "POLYCAB")
  | "GENERAL";   // unclassified spec token

export interface SpecificationToken {
  category: SpecTokenCategory;
  /** Normalized value for comparison. */
  normalized_value: string;
  /** Original text from the description. */
  raw_value: string;
}

// ==================== KNOWN CONFLICT RULES ====================

/**
 * A known technical conflict rule. When both values match their
 * respective patterns, the items are ALWAYS technically different,
 * regardless of description similarity or commercial preference.
 */
export interface TechnicalConflictRule {
  rule_id: string;
  dimension: TechnicalDimensionName;
  /** Regex pattern for value A. */
  pattern_a: RegExp;
  /** Regex pattern for value B. */
  pattern_b: RegExp;
  /** Why these are technically different. */
  reason: string;
}

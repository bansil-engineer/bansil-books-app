// ============================================================
// Bansil Books Analytics — Phase 4E: Technical Equivalence Engine
//
// Deterministic technical-equivalence assessment. Zero AI/model calls.
// For each (RateEvidenceRecord, BoqLineRateInput) pair it answers:
//   "Is this rate evidence technically applicable to this BOQ item?"
//
// Never: infers missing attributes, fabricates Owner approval,
// changes Phase 4D rate/provenance, uses price/recency/frequency
// to determine equivalence, writes to Zoho (ZOHO WRITE = 0),
// calls any AI or network service.
//
// Constraint enforcement:
//   6. Known technical conflict overrides description similarity or rate preference.
//   7. Cheapest/newest/historically-frequent rate never changes equivalence status.
//   8. Unknown evidence remains UNKNOWN / INSUFFICIENT_EVIDENCE.
//   9. System never fabricates Owner approval.
//  10. Phase 4D rate/provenance preserved unchanged.
//  11. Same inputs → deterministic results.
//  12. Technical result, commercial decision, Owner approval are separate.
// ============================================================

import { canonicalizeUom } from "./evidence";
import type { RateEvidenceRecord, BoqLineRateInput, UomAliasRule } from "./rate-types";
import type {
  TechnicalEquivalenceStatus,
  TechnicalEquivalenceResult,
  TechnicalDimensionResult,
  TechnicalDimensionName,
  DimensionStatus,
  SpecificationToken,
  SpecTokenCategory,
  TechnicalConflictRule,
  BoqLineTechnicalEquivalenceResult,
  TechnicalEquivalenceRunSummary,
} from "./technical-equivalence-types";
import { CONFLICT_STATUSES } from "./technical-equivalence-types";

export const TECHNICAL_EQUIVALENCE_ENGINE_VERSION = "4E.3";

// ==================== SPECIFICATION PARSING ====================

/**
 * Electrical rating patterns: current (A/Amp), voltage (V/kV), power (W/kW/HP),
 * breaking capacity (kA), apparent power (VA/kVA/MVA).
 * Captures the numeric value and unit.
 * Alternation ordered longest-first to prevent partial matches (e.g. KVA before KV before V).
 */
const RATING_PATTERN = /\b(\d+(?:\.\d+)?)\s*(AMPS|AMP|KVA|MVA|KA|KV|KW|HP|VA|A|V|W)\b/gi;

/**
 * Physical size patterns: cross-section (sq mm), length (mm/m/cm), diameter.
 */
const SIZE_PATTERN = /\b(\d+(?:\.\d+)?)\s*(SQ\s*MM|SQMM|MM2|MM|CM|M|INCH|INCHES|IN)\b/gi;

/**
 * Standard reference patterns: IS/IEC/BS/ASTM followed by number.
 */
const STANDARD_PATTERN = /\b(IS|IEC|BS|ASTM|DIN|EN|IEEE)\s*(\d+(?:[:\-/]\d+)*)\b/gi;

/**
 * Material grade patterns: captures grade designators (e.g. E250, E350, GR\.A, GR\.B).
 */
const GRADE_PATTERN = /\b(E\d{3}[A-Z]?|GR(?:ADE)?\.?\s*[A-Z0-9]+|CLASS\s*[A-Z0-9]+)\b/gi;

/**
 * Material type keywords.
 */
const MATERIAL_KEYWORDS = new Set([
  "COPPER", "CU", "ALUMINIUM", "ALUMINUM", "AL", "ALU",
  "GI", "GALVANIZED", "GALVANISED", "MS", "MILD STEEL",
  "SS", "STAINLESS STEEL", "XLPE", "PVC", "HDPE",
  "BRASS", "CAST IRON", "CI", "FRP", "GRP",
]);

/**
 * Known brand names in electrical / construction.
 */
const BRAND_KEYWORDS = new Set([
  "HAVELLS", "ANCHOR", "POLYCAB", "FINOLEX", "KEI",
  "SIEMENS", "ABB", "SCHNEIDER", "LEGRAND", "L&T",
  "CROMPTON", "BAJAJ", "PHILIPS", "ORIENT", "WIPRO",
  "HPL", "INDO ASIAN", "C&S", "GE", "EATON",
  "LARSEN", "TOUBRO", "RR KABEL", "GLOSTER", "UNIVERSAL",
]);

/**
 * Product type / sub-type keywords.
 */
const TYPE_KEYWORDS = new Set([
  "SP", "DP", "TP", "TPN", "FP", "4P",
  "C-CURVE", "C CURVE", "B-CURVE", "B CURVE", "D-CURVE",
  "SINGLE POLE", "DOUBLE POLE", "TRIPLE POLE", "FOUR POLE",
  "PANEL", "BOARD", "BOX", "TRAY", "CONDUIT", "DUCT",
  "MCB", "MCCB", "RCCB", "ELCB", "ACB", "MPCB",
  "CONTACTOR", "RELAY", "STARTER", "VFD", "DOL",
]);

/**
 * Parse specification tokens from a description string.
 * Deterministic: same input always produces same output.
 */
export function parseSpecificationTokens(description: string | null): SpecificationToken[] {
  if (!description) return [];
  const upper = description.toUpperCase();
  const tokens: SpecificationToken[] = [];
  const seen = new Set<string>();

  const addToken = (category: SpecTokenCategory, normalized: string, raw: string) => {
    const key = `${category}:${normalized}`;
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push({ category, normalized_value: normalized, raw_value: raw });
    }
  };

  // Extract ratings
  for (const m of upper.matchAll(RATING_PATTERN)) {
    const normalized = `${m[1]}${m[2].toUpperCase().replace(/AMPS?/, "A")}`;
    addToken("RATING", normalized, m[0].trim());
  }

  // Extract sizes
  for (const m of upper.matchAll(SIZE_PATTERN)) {
    const unit = m[2].toUpperCase().replace(/\s+/g, "").replace("SQMM", "SQMM").replace("MM2", "SQMM");
    const normalized = `${m[1]}${unit}`;
    addToken("SIZE", normalized, m[0].trim());
  }

  // Extract standards
  for (const m of upper.matchAll(STANDARD_PATTERN)) {
    const normalized = `${m[1].toUpperCase()}${m[2]}`;
    addToken("STANDARD", normalized, m[0].trim());
  }

  // Extract grades
  for (const m of upper.matchAll(GRADE_PATTERN)) {
    const normalized = m[1].toUpperCase().replace(/[\s.]+/g, "");
    addToken("MATERIAL", normalized, m[0].trim());
  }

  // Extract material keywords
  const words = upper.replace(/[^A-Z0-9&\s]/g, " ").split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    // Check single word
    if (MATERIAL_KEYWORDS.has(words[i])) {
      addToken("MATERIAL", words[i], words[i]);
    }
    // Check two-word combo (e.g. "MILD STEEL", "STAINLESS STEEL", "CAST IRON")
    if (i + 1 < words.length) {
      const pair = `${words[i]} ${words[i + 1]}`;
      if (MATERIAL_KEYWORDS.has(pair)) {
        addToken("MATERIAL", pair, pair);
      }
    }
  }

  // Extract brand keywords
  for (const w of words) {
    if (BRAND_KEYWORDS.has(w)) {
      addToken("BRAND", w, w);
    }
  }
  // Two-word brands (L&T)
  for (let i = 0; i < words.length; i++) {
    if (i + 1 < words.length) {
      const pair = `${words[i]} ${words[i + 1]}`;
      if (BRAND_KEYWORDS.has(pair)) {
        addToken("BRAND", pair, pair);
      }
    }
    // Handle L&T style
    const wAmp = words[i];
    if (BRAND_KEYWORDS.has(wAmp)) {
      addToken("BRAND", wAmp, wAmp);
    }
  }

  // Extract type keywords
  for (const w of words) {
    if (TYPE_KEYWORDS.has(w)) {
      addToken("TYPE", w, w);
    }
  }
  // Two-word type combos
  for (let i = 0; i < words.length; i++) {
    if (i + 1 < words.length) {
      const pair = `${words[i]} ${words[i + 1]}`;
      if (TYPE_KEYWORDS.has(pair)) {
        addToken("TYPE", pair, pair);
      }
    }
  }

  return tokens;
}

/**
 * Extract the make/brand from a description, if present.
 */
export function extractMakeBrand(description: string | null): string | null {
  if (!description) return null;
  const tokens = parseSpecificationTokens(description);
  const brand = tokens.find((t) => t.category === "BRAND");
  return brand?.normalized_value ?? null;
}

/**
 * Extract rating/capacity from a description, if present.
 */
export function extractRating(description: string | null): string | null {
  if (!description) return null;
  const tokens = parseSpecificationTokens(description);
  const ratings = tokens.filter((t) => t.category === "RATING");
  if (ratings.length === 0) return null;
  // Sort for determinism
  return ratings.map((r) => r.normalized_value).sort().join("+");
}

/**
 * Extract size specification from a description, if present.
 */
export function extractSize(description: string | null): string | null {
  if (!description) return null;
  const tokens = parseSpecificationTokens(description);
  const sizes = tokens.filter((t) => t.category === "SIZE");
  if (sizes.length === 0) return null;
  return sizes.map((s) => s.normalized_value).sort().join("+");
}

/**
 * Extract standard references from a description, if present.
 */
export function extractStandard(description: string | null): string | null {
  if (!description) return null;
  const tokens = parseSpecificationTokens(description);
  const standards = tokens.filter((t) => t.category === "STANDARD");
  if (standards.length === 0) return null;
  return standards.map((s) => s.normalized_value).sort().join("+");
}

/**
 * Extract material grade from a description, if present.
 */
export function extractGrade(description: string | null): string | null {
  if (!description) return null;
  const tokens = parseSpecificationTokens(description);
  const grades = tokens.filter((t) => t.category === "MATERIAL");
  if (grades.length === 0) return null;
  return grades.map((g) => g.normalized_value).sort().join("+");
}

// ==================== PER-ATTRIBUTE SPEC COMPARISON ====================

/**
 * A structured spec attribute parsed from a description.
 * Each attribute has a kind (RATING or SIZE) and a semantic unit type,
 * enabling independent per-attribute comparison.
 */
interface SpecAttribute {
  kind: "RATING" | "SIZE";
  /** Semantic unit type: "A", "KA", "V", "KV", "SQMM", "MM", etc. */
  unitType: string;
  /** Full normalized value: "100A", "25KA", "4SQMM", etc. */
  value: string;
}

/**
 * Extract the semantic unit type from a normalized rating value.
 * E.g. "100A" → "A", "25KA" → "KA", "415V" → "V".
 *
 * Each unit type is distinct — no cross-unit equivalence assumed.
 * 20A ≠ 20kA, 100A ≠ 100V (constraint: no engineering conversions).
 */
function getRatingUnitType(normalizedValue: string): string {
  const match = normalizedValue.match(/^[\d.]+(.+)$/);
  return match ? match[1] : "UNKNOWN";
}

/**
 * Extract the semantic unit type from a normalized size value.
 * E.g. "4SQMM" → "SQMM", "100MM" → "MM".
 */
function getSizeUnitType(normalizedValue: string): string {
  const match = normalizedValue.match(/^[\d.]+(.+)$/);
  return match ? match[1] : "UNKNOWN";
}

/**
 * Extract structured spec attributes from a description.
 * Each token is classified by kind (RATING/SIZE) and semantic unit type
 * for independent per-attribute comparison.
 *
 * Deduplicates by kind:unitType:value — all UNIQUE values of the same
 * semantic unit type are retained. "100A 160A" produces two distinct
 * attributes [{A,100A}, {A,160A}]. Only exact duplicates ("100A 100A")
 * are collapsed. No same-unit values are arbitrarily dropped.
 *
 * 4E.3 correction: previous 4E.2 dedup key was kind:unitType only,
 * which silently dropped subsequent unique values (e.g. 160A when 100A
 * had already claimed the RATING:A slot). This caused false
 * TECHNICALLY_EQUIVALENT results when BOQ had multiple same-unit
 * requirements and the candidate satisfied only the first.
 */
function extractSpecAttributes(description: string | null): SpecAttribute[] {
  if (!description) return [];
  const tokens = parseSpecificationTokens(description);
  const attrs: SpecAttribute[] = [];
  const seen = new Set<string>();

  for (const t of tokens) {
    if (t.category === "RATING") {
      const unitType = getRatingUnitType(t.normalized_value);
      const key = `RATING:${unitType}:${t.normalized_value}`;
      if (!seen.has(key)) {
        seen.add(key);
        attrs.push({ kind: "RATING", unitType, value: t.normalized_value });
      }
    } else if (t.category === "SIZE") {
      const unitType = getSizeUnitType(t.normalized_value);
      const key = `SIZE:${unitType}:${t.normalized_value}`;
      if (!seen.has(key)) {
        seen.add(key);
        attrs.push({ kind: "SIZE", unitType, value: t.normalized_value });
      }
    }
  }
  return attrs;
}

// ==================== DIMENSION COMPARATORS ====================

/**
 * Compare the SPEC dimension using per-attribute comparison.
 *
 * REQUIRED INVARIANT: Every explicit BOQ technical requirement is
 * evaluated independently against the candidate.
 *
 * For each required attribute in the BOQ:
 *   - candidate has exact same value → MATCH for that attribute
 *   - candidate has same kind:unitType with different value(s) and
 *     BOQ has only ONE attribute of that kind:unitType → CONFLICT
 *   - candidate has same kind:unitType with different value(s) and
 *     BOQ has MULTIPLE attributes of that kind:unitType → UNKNOWN
 *     (ambiguous semantics — could be alternatives, frame/operating
 *     ratings, range, etc. — no interpretation without approved rule)
 *   - candidate has no attributes of that kind:unitType → UNKNOWN
 *
 * Extra candidate attributes (not required by BOQ) are informational
 * and do NOT cause conflict.
 *
 * No equal-or-better assumption: 25kA ≠ 36kA without an explicit
 * approved rule (constraint: no engineering superiority rules).
 *
 * Semantic unit types are preserved: A ≠ KA, A ≠ V, W ≠ KW.
 * Numeric equality across different units is meaningless.
 *
 * 4E.3: evidence indexed as multimap (kind:unitType → SpecAttribute[])
 * to support multiple same-unit values on both BOQ and candidate sides.
 */
function compareSpec(
  boqDesc: string | null,
  evidenceDesc: string | null,
  evidenceItemName: string | null,
): TechnicalDimensionResult {
  const evDesc = evidenceDesc ?? evidenceItemName;
  const boqAttrs = extractSpecAttributes(boqDesc);
  const evAttrs = extractSpecAttributes(evDesc);

  // Build display values for dimension result
  const boqValue = boqAttrs.length > 0
    ? boqAttrs.map((a) => a.value).sort().join("; ")
    : null;
  const evValue = evAttrs.length > 0
    ? evAttrs.map((a) => a.value).sort().join("; ")
    : null;

  // If neither side has spec attributes, UNKNOWN
  if (boqAttrs.length === 0 && evAttrs.length === 0) {
    return { dimension: "SPEC", status: "UNKNOWN", boqValue: null, evidenceValue: null, conflictNote: null };
  }

  // If BOQ has no spec attributes but evidence does, UNKNOWN (BOQ side missing)
  if (boqAttrs.length === 0) {
    return { dimension: "SPEC", status: "UNKNOWN", boqValue: null, evidenceValue: evValue, conflictNote: null };
  }

  // If evidence has no spec attributes but BOQ does, UNKNOWN (evidence side missing)
  if (evAttrs.length === 0) {
    return { dimension: "SPEC", status: "UNKNOWN", boqValue: boqValue, evidenceValue: null, conflictNote: null };
  }

  // Index evidence attributes as multimap: kind:unitType → SpecAttribute[]
  const evByKey = new Map<string, SpecAttribute[]>();
  for (const a of evAttrs) {
    const key = `${a.kind}:${a.unitType}`;
    const arr = evByKey.get(key);
    if (arr) {
      arr.push(a);
    } else {
      evByKey.set(key, [a]);
    }
  }

  // Count BOQ attributes per kind:unitType (for ambiguity detection)
  const boqCountByKey = new Map<string, number>();
  for (const a of boqAttrs) {
    const key = `${a.kind}:${a.unitType}`;
    boqCountByKey.set(key, (boqCountByKey.get(key) ?? 0) + 1);
  }

  // Evaluate each BOQ requirement independently
  let hasConflict = false;
  let hasMissing = false;
  let matchCount = 0;
  const conflictNotes: string[] = [];

  for (const boqAttr of boqAttrs) {
    const key = `${boqAttr.kind}:${boqAttr.unitType}`;
    const evGroup = evByKey.get(key);

    if (!evGroup || evGroup.length === 0) {
      // Candidate has no evidence for this kind:unitType at all
      hasMissing = true;
    } else {
      // Check if exact value exists in evidence group
      const exactMatch = evGroup.some((e) => e.value === boqAttr.value);
      if (exactMatch) {
        matchCount++;
      } else {
        // Candidate has same-unit attributes but not this exact value.
        // When BOQ has multiple values of the same unit type, the
        // semantics are ambiguous (alternatives? frame/operating?
        // range?) — treat unmatched ones as missing evidence rather
        // than asserting a conflict we cannot justify.
        const boqCount = boqCountByKey.get(key) ?? 1;
        if (boqCount > 1) {
          // Multiple BOQ same-unit values → ambiguous → safe missing
          hasMissing = true;
        } else {
          // Single BOQ value, candidate has different value → clear conflict
          hasConflict = true;
          conflictNotes.push(
            `${boqAttr.unitType} mismatch: BOQ=${boqAttr.value} vs Evidence=${evGroup.map((e) => e.value).join(",")}`,
          );
        }
      }
    }
  }

  // Priority: conflict > missing > match
  if (hasConflict) {
    return {
      dimension: "SPEC",
      status: "CONFLICT",
      boqValue: boqValue,
      evidenceValue: evValue,
      conflictNote: conflictNotes.join("; "),
    };
  }

  if (hasMissing) {
    return {
      dimension: "SPEC",
      status: "UNKNOWN",
      boqValue: boqValue,
      evidenceValue: evValue,
      conflictNote: null,
    };
  }

  // All BOQ requirements matched by evidence
  return {
    dimension: "SPEC",
    status: "MATCH",
    boqValue: boqValue,
    evidenceValue: evValue,
    conflictNote: null,
  };
}

/**
 * Compare UOM dimension.
 *
 * Only IDENTICAL or APPROVED_ALIAS counts as compatible.
 * SPELLING_ALIAS alone is insufficient without explicit approval
 * (per handoff spec). Incompatible types → UOM_INCOMPATIBLE.
 */
function compareUom(
  boqUom: string | null,
  evidenceUom: string | null,
  evidenceNormalizedUom: string | null,
  evidenceUomNormalization: string | null,
  uomAliases: readonly UomAliasRule[],
): TechnicalDimensionResult {
  if (!boqUom && !evidenceUom) {
    return { dimension: "UOM", status: "UNKNOWN", boqValue: null, evidenceValue: null, conflictNote: null };
  }
  if (!boqUom || !evidenceUom) {
    return {
      dimension: "UOM",
      status: "UNKNOWN",
      boqValue: boqUom,
      evidenceValue: evidenceUom,
      conflictNote: null,
    };
  }

  const boqCanonical = canonicalizeUom(boqUom);
  const evCanonical = canonicalizeUom(evidenceUom);

  if (!boqCanonical || !evCanonical) {
    return { dimension: "UOM", status: "UNKNOWN", boqValue: boqUom, evidenceValue: evidenceUom, conflictNote: null };
  }

  // Identical canonical UOM
  if (boqCanonical === evCanonical) {
    return { dimension: "UOM", status: "MATCH", boqValue: boqUom, evidenceValue: evidenceUom, conflictNote: null };
  }

  // Check approved alias rules
  const hasApprovedAlias = uomAliases.some(
    (a) =>
      (canonicalizeUom(a.alias) === boqCanonical && canonicalizeUom(a.canonical) === evCanonical) ||
      (canonicalizeUom(a.alias) === evCanonical && canonicalizeUom(a.canonical) === boqCanonical),
  );

  if (hasApprovedAlias) {
    return { dimension: "UOM", status: "MATCH", boqValue: boqUom, evidenceValue: evidenceUom, conflictNote: null };
  }

  // Different canonical UOMs without approved alias = CONFLICT
  return {
    dimension: "UOM",
    status: "CONFLICT",
    boqValue: boqUom,
    evidenceValue: evidenceUom,
    conflictNote: `UOM incompatible: BOQ=${boqCanonical} vs Evidence=${evCanonical}; no approved alias rule`,
  };
}

/**
 * Compare MAKE/brand dimension.
 * BOQ specifies make; evidence is different make → MAKE_CONFLICT.
 */
function compareMake(
  boqDesc: string | null,
  evidenceDesc: string | null,
  evidenceItemName: string | null,
): TechnicalDimensionResult {
  const boqMake = extractMakeBrand(boqDesc);
  const evMake = extractMakeBrand(evidenceDesc) ?? extractMakeBrand(evidenceItemName);

  if (!boqMake && !evMake) {
    return { dimension: "MAKE", status: "UNKNOWN", boqValue: null, evidenceValue: null, conflictNote: null };
  }
  if (!boqMake || !evMake) {
    return { dimension: "MAKE", status: "UNKNOWN", boqValue: boqMake, evidenceValue: evMake, conflictNote: null };
  }
  if (boqMake === evMake) {
    return { dimension: "MAKE", status: "MATCH", boqValue: boqMake, evidenceValue: evMake, conflictNote: null };
  }
  return {
    dimension: "MAKE",
    status: "CONFLICT",
    boqValue: boqMake,
    evidenceValue: evMake,
    conflictNote: `Make conflict: BOQ=${boqMake} vs Evidence=${evMake}`,
  };
}

/**
 * Compare GRADE dimension.
 * Material grade / class mismatch → SPEC_CONFLICT.
 */
function compareGrade(
  boqDesc: string | null,
  evidenceDesc: string | null,
  evidenceItemName: string | null,
): TechnicalDimensionResult {
  const boqGrade = extractGrade(boqDesc);
  const evGrade = extractGrade(evidenceDesc) ?? extractGrade(evidenceItemName);

  if (!boqGrade && !evGrade) {
    return { dimension: "GRADE", status: "UNKNOWN", boqValue: null, evidenceValue: null, conflictNote: null };
  }
  if (!boqGrade || !evGrade) {
    return { dimension: "GRADE", status: "UNKNOWN", boqValue: boqGrade, evidenceValue: evGrade, conflictNote: null };
  }
  if (boqGrade === evGrade) {
    return { dimension: "GRADE", status: "MATCH", boqValue: boqGrade, evidenceValue: evGrade, conflictNote: null };
  }
  return {
    dimension: "GRADE",
    status: "CONFLICT",
    boqValue: boqGrade,
    evidenceValue: evGrade,
    conflictNote: `Grade mismatch: BOQ=${boqGrade} vs Evidence=${evGrade}`,
  };
}

/**
 * Compare STANDARD dimension.
 * IS/IEC/BS standard reference mismatch → SPEC_CONFLICT.
 */
function compareStandard(
  boqDesc: string | null,
  evidenceDesc: string | null,
  evidenceItemName: string | null,
): TechnicalDimensionResult {
  const boqStd = extractStandard(boqDesc);
  const evStd = extractStandard(evidenceDesc) ?? extractStandard(evidenceItemName);

  if (!boqStd && !evStd) {
    return { dimension: "STANDARD", status: "UNKNOWN", boqValue: null, evidenceValue: null, conflictNote: null };
  }
  if (!boqStd || !evStd) {
    return { dimension: "STANDARD", status: "UNKNOWN", boqValue: boqStd, evidenceValue: evStd, conflictNote: null };
  }
  if (boqStd === evStd) {
    return { dimension: "STANDARD", status: "MATCH", boqValue: boqStd, evidenceValue: evStd, conflictNote: null };
  }
  return {
    dimension: "STANDARD",
    status: "CONFLICT",
    boqValue: boqStd,
    evidenceValue: evStd,
    conflictNote: `Standard mismatch: BOQ=${boqStd} vs Evidence=${evStd}`,
  };
}

// ==================== CORE ASSESSMENT ====================

/**
 * Assess technical equivalence between one rate evidence record
 * and one BOQ line input.
 *
 * Rules:
 *   - If ANY dimension is CONFLICT → overall status is a conflict type.
 *   - If NO conflicts but ANY required dimension is UNKNOWN → INSUFFICIENT_EVIDENCE.
 *   - Only if all checked dimensions are MATCH → TECHNICALLY_EQUIVALENT.
 *   - Price, recency, frequency are NEVER considered (constraint 7).
 *   - Missing attributes are NEVER inferred (constraint 5).
 *   - Owner approval is NEVER fabricated (constraint 9).
 *   - Phase 4D rate/provenance is NOT modified (constraint 10).
 *   - Same inputs → same output (constraint 11).
 *
 * SPEC comparison invariants (4E.3):
 *   - Every explicit BOQ requirement is evaluated independently.
 *   - Missing candidate evidence for a BOQ requirement = UNKNOWN (never hidden by a matching attribute).
 *   - Multiple same-unit values are all retained (4E.3: dedup by kind:unitType:value, not kind:unitType).
 *   - BOQ with multiple same-unit values: each is an independent requirement.
 *   - Extra candidate metadata not required by BOQ is informational (not conflict).
 *   - No equal-or-better assumption without an explicit approved rule.
 *   - No automatic range/alternative interpretation of multiple same-unit values.
 *   - Semantic unit types preserved: A ≠ KA, A ≠ V, W ≠ KW.
 */
export function assessTechnicalEquivalence(
  evidence: RateEvidenceRecord,
  boqLine: BoqLineRateInput,
  uomAliases: readonly UomAliasRule[],
): TechnicalEquivalenceResult {
  const now = new Date().toISOString();

  // Compute all dimensions
  const evDesc = evidence.description ?? evidence.item_name;
  const dimensions: TechnicalDimensionResult[] = [
    compareSpec(boqLine.description, evDesc, evidence.item_name),
    compareUom(boqLine.uom, evidence.uom, evidence.normalized_uom, evidence.uom_normalization, uomAliases),
    compareMake(boqLine.description, evDesc, evidence.item_name),
    compareGrade(boqLine.description, evDesc, evidence.item_name),
    compareStandard(boqLine.description, evDesc, evidence.item_name),
  ];

  // Determine overall status
  const status = determineOverallStatus(dimensions);

  return {
    status,
    dimensions,
    ownerOverride: null,
    assessedAt: now,
    engineVersion: TECHNICAL_EQUIVALENCE_ENGINE_VERSION,
    deterministic: true,
    model_calls: 0,
  };
}

/**
 * Determine the overall technical equivalence status from dimension results.
 *
 * Priority order:
 *   1. ANY CONFLICT → conflict status (specific type based on which dimension)
 *   2. ANY UNKNOWN (no conflicts) → INSUFFICIENT_EVIDENCE
 *   3. ALL MATCH → TECHNICALLY_EQUIVALENT
 */
function determineOverallStatus(dimensions: TechnicalDimensionResult[]): TechnicalEquivalenceStatus {
  // Check for conflicts (highest priority — constraint 6)
  const conflicts = dimensions.filter((d) => d.status === "CONFLICT");
  if (conflicts.length > 0) {
    // Return the most specific conflict type
    for (const c of conflicts) {
      if (c.dimension === "UOM") return "UOM_INCOMPATIBLE";
      if (c.dimension === "MAKE") return "MAKE_CONFLICT";
    }
    // SPEC, GRADE, STANDARD conflicts → SPEC_CONFLICT
    if (conflicts.some((c) => c.dimension === "SPEC" || c.dimension === "GRADE" || c.dimension === "STANDARD")) {
      return "SPEC_CONFLICT";
    }
    return "TECHNICALLY_CONFLICT";
  }

  // Check for unknowns (constraint 8).
  // A dimension is "meaningfully unknown" when at least one side provided
  // a value and the other did not — that is genuine missing evidence.
  // When BOTH sides are null (neither mentioned a standard/grade/make),
  // there is nothing to conflict on and nothing unknown; it is neutral.
  const meaningfulUnknowns = dimensions.filter(
    (d) => d.status === "UNKNOWN" && (d.boqValue !== null || d.evidenceValue !== null),
  );
  if (meaningfulUnknowns.length > 0) {
    return "INSUFFICIENT_EVIDENCE";
  }

  // Check if ALL dimensions are either MATCH or both-null UNKNOWN.
  // If every dimension with data is MATCH and the rest are both-null,
  // and at least one dimension actually matched on real data, it's equivalent.
  const matched = dimensions.filter((d) => d.status === "MATCH");
  const bothNullUnknowns = dimensions.filter(
    (d) => d.status === "UNKNOWN" && d.boqValue === null && d.evidenceValue === null,
  );
  // If everything is both-null UNKNOWN (no data at all), it's insufficient
  if (matched.length === 0 && bothNullUnknowns.length > 0) {
    return "INSUFFICIENT_EVIDENCE";
  }
  // At least one SPEC-class dimension (SPEC, MAKE, GRADE, STANDARD) must
  // match on real data. UOM match alone is not enough to declare equivalence.
  const specClassMatch = matched.some(
    (d) => d.dimension === "SPEC" || d.dimension === "MAKE" || d.dimension === "GRADE" || d.dimension === "STANDARD",
  );
  if (!specClassMatch && bothNullUnknowns.length > 0) {
    return "INSUFFICIENT_EVIDENCE";
  }

  // All dimensions are MATCH
  return "TECHNICALLY_EQUIVALENT";
}

// ==================== BATCH ASSESSMENT ====================

/**
 * Assess technical equivalence for one BOQ line against all its
 * rate evidence records.
 */
export function assessBoqLineEquivalence(
  boqLine: BoqLineRateInput,
  evidence: readonly RateEvidenceRecord[],
  uomAliases: readonly UomAliasRule[],
): BoqLineTechnicalEquivalenceResult {
  const equivalentIds: string[] = [];
  const conflictEvidence: BoqLineTechnicalEquivalenceResult["conflict_evidence"] = [];
  const insufficientEvidence: BoqLineTechnicalEquivalenceResult["insufficient_evidence"] = [];

  for (const ev of evidence) {
    const result = assessTechnicalEquivalence(ev, boqLine, uomAliases);

    if (result.status === "TECHNICALLY_EQUIVALENT") {
      equivalentIds.push(ev.rate_evidence_id);
    } else if (CONFLICT_STATUSES.has(result.status)) {
      const conflictDims = result.dimensions
        .filter((d) => d.status === "CONFLICT")
        .map((d) => d.dimension);
      const reasons = result.dimensions
        .filter((d) => d.status === "CONFLICT" && d.conflictNote)
        .map((d) => d.conflictNote!);
      conflictEvidence.push({
        rate_evidence_id: ev.rate_evidence_id,
        status: result.status,
        conflict_dimensions: conflictDims,
        reason: reasons.join("; ") || result.status,
      });
    } else {
      // INSUFFICIENT_EVIDENCE
      const unknownDims = result.dimensions
        .filter((d) => d.status === "UNKNOWN")
        .map((d) => d.dimension);
      insufficientEvidence.push({
        rate_evidence_id: ev.rate_evidence_id,
        unknown_dimensions: unknownDims,
        reason: `Insufficient evidence on: ${unknownDims.join(", ")}`,
      });
    }
  }

  return {
    boq_line_id: boqLine.boq_line_id,
    boq_description: boqLine.description,
    boq_uom: boqLine.uom,
    equivalent_evidence_ids: equivalentIds,
    conflict_evidence: conflictEvidence,
    insufficient_evidence: insufficientEvidence,
    comparison_count: evidence.length,
    model_calls: 0,
  };
}

/**
 * Run a batch technical-equivalence assessment across multiple BOQ lines,
 * each with its associated rate evidence.
 */
export function runTechnicalEquivalenceAssessment(params: {
  project_id: string;
  as_of_date: string;
  boq_lines: readonly BoqLineRateInput[];
  evidence_by_boq_line: ReadonlyMap<string, readonly RateEvidenceRecord[]>;
  uom_aliases: readonly UomAliasRule[];
}): TechnicalEquivalenceRunSummary {
  const { project_id, as_of_date, boq_lines, evidence_by_boq_line, uom_aliases } = params;

  const boqResults: BoqLineTechnicalEquivalenceResult[] = [];
  let totalComparisons = 0;
  let equivalentCount = 0;
  let conflictCount = 0;
  let insufficientCount = 0;

  for (const boqLine of boq_lines) {
    const evidence = evidence_by_boq_line.get(boqLine.boq_line_id) ?? [];
    const result = assessBoqLineEquivalence(boqLine, evidence, uom_aliases);
    boqResults.push(result);
    totalComparisons += result.comparison_count;
    equivalentCount += result.equivalent_evidence_ids.length;
    conflictCount += result.conflict_evidence.length;
    insufficientCount += result.insufficient_evidence.length;
  }

  // Deterministic run_id: hash of inputs for reproducibility
  const runIdInput = `${project_id}:${as_of_date}:${boq_lines.map((b) => b.boq_line_id).join(",")}`;
  const run_id = `TEQ-${hashString(runIdInput).substring(0, 12)}`;

  return {
    run_id,
    project_id,
    as_of_date,
    method: "DETERMINISTIC",
    model_calls: 0,
    boq_line_count: boq_lines.length,
    total_comparisons: totalComparisons,
    equivalent_count: equivalentCount,
    conflict_count: conflictCount,
    insufficient_count: insufficientCount,
    boq_results: boqResults,
    engine_version: TECHNICAL_EQUIVALENCE_ENGINE_VERSION,
  };
}

// ==================== HELPERS ====================

/**
 * Simple deterministic string hash (not cryptographic — for run IDs only).
 */
function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Normalize a description for comparison. Deterministic.
 */
export function normalizeDescription(desc: string | null): string {
  if (!desc) return "";
  return desc
    .toUpperCase()
    .replace(/[^A-Z0-9\s.&/\-+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

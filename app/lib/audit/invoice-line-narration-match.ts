// ============================================================
// Bansil Books Analytics — Invoice↔SO Narration Match Engine (R1A)
//
// Deterministic narration comparison for Invoice↔SO line matching.
// NO AI. NO LLM. NO embeddings. NO fuzzy black box.
//
// All scoring is explainable — token overlap, numeric conflict
// detection, item number extraction, UOM comparison.
//
// Narration similarity NEVER auto-maps. It produces CANDIDATE
// SUGGESTIONS only. OWNER confirmation is always required.
//
// ZOHO WRITE = 0. No network calls. No persistence.
// ============================================================

// ── Types ──────────────────────────────────────────────────

export type NarrationMatchLevel = "EXACT" | "HIGH" | "MEDIUM" | "LOW" | "CONFLICT";

export type ItemNumberResult = "MATCH" | "MISMATCH" | "UNKNOWN";

export interface NarrationMatchResult {
  level: NarrationMatchLevel;
  score: number;
  matchedTokens: string[];
  conflictingTokens: string[];
  numericConflicts: string[];
  itemNumber: ItemNumberResult;
  invoiceNormalized: string;
  soNormalized: string;
}

export type UomEvidence = "MATCH" | "MISMATCH" | "UNKNOWN";
export type ItemIdEvidence = "EXACT" | "DIFFERENT" | "UNKNOWN";
export type OverallSuggestion = "SUGGESTED" | "NOT_RECOMMENDED";

export interface CandidateRanking {
  itemId: ItemIdEvidence;
  narration: NarrationMatchLevel;
  numeric: "MATCH" | "CONFLICT" | "UNKNOWN";
  itemNumber: ItemNumberResult;
  uom: UomEvidence;
  quantity: "MATCH" | "DIFFERENT" | "UNKNOWN";
  rate: "MATCH" | "DIFFERENT" | "UNKNOWN";
  overall: OverallSuggestion;
  /** Combined deterministic score for sorting. Higher = better match. */
  sortScore: number;
  narrationDetail: NarrationMatchResult;
}

// ── Normalization ──────────────────────────────────────────

/**
 * Deterministic text normalization for narration comparison.
 *
 * Allowed operations:
 *  - lowercase
 *  - trim
 *  - collapse whitespace
 *  - normalize dimension separators (× X x → x)
 *  - normalize common metric formatting (sq.mm, sq mm, sqmm → sqmm)
 *  - normalize safe spacing around units
 *  - harmless punctuation normalization
 *
 * DO NOT remove meaningful numeric tokens.
 */
export function normalizeNarrationText(text: string | null | undefined): string {
  if (!text) return "";
  let s = text
    .trim()
    .toLowerCase()
    // Collapse whitespace
    .replace(/\s+/g, " ")
    // Normalize dimension separators: × X → x (when between terms)
    .replace(/\s*[×Xx]\s*/g, "x")
    // Normalize sq.mm, sq mm, sq. mm → sqmm
    .replace(/sq\.?\s*mm/gi, "sqmm")
    // Normalize sq.m, sq m → sqm
    .replace(/sq\.?\s*m(?!m)/gi, "sqm")
    // Remove trailing/leading punctuation that doesn't affect meaning
    .replace(/^[,.\s]+|[,.\s]+$/g, "")
    // Normalize multiple hyphens to single
    .replace(/-{2,}/g, "-")
    // Normalize multiple dots to single
    .replace(/\.{2,}/g, ".")
    // Normalize colons with spaces: " : " → ": "
    .replace(/\s*:\s*/g, ": ");
  return s.trim();
}

// ── Item Number Extraction ─────────────────────────────────

/**
 * Extract item number from narration text.
 *
 * Recognizes patterns:
 *  - "Item No : 01"
 *  - "Item No. 01"
 *  - "Item No 1"
 *  - "item no:01"
 *
 * Normalizes numeric value: "01" and "1" → same integer.
 * Returns null if no item number found.
 */
export function extractItemNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  // Pattern: "Item" followed by optional "No", optional ".", optional ":", then digits
  const match = text.match(/item\s*no\.?\s*:?\s*(\d+)/i);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/**
 * Compare item numbers from two narrations.
 */
export function compareItemNumbers(
  invoiceText: string | null | undefined,
  soText: string | null | undefined
): ItemNumberResult {
  const invNum = extractItemNumber(invoiceText);
  const soNum = extractItemNumber(soText);

  if (invNum === null || soNum === null) return "UNKNOWN";
  return invNum === soNum ? "MATCH" : "MISMATCH";
}

// ── Technical Numeric Conflict Detection ───────────────────

/**
 * Patterns for meaningful technical numeric tokens in industrial narrations.
 *
 * These represent physical specifications where different values mean
 * fundamentally different products:
 *  - 50mm vs 100mm (dimensions)
 *  - 16A vs 32A (amperage)
 *  - 1P vs 4P (poles)
 *  - 2.5 sqmm vs 4 sqmm (cross-section)
 *  - 4CX10 vs 5CX6 (cable cores × size)
 *  - 1.6mm vs 2mm (thickness)
 */
const NUMERIC_SPEC_PATTERNS: RegExp[] = [
  // Dimensions: 50mm, 100mm, 1.6mm
  /(\d+(?:\.\d+)?)\s*mm(?![\w])/gi,
  // Amperage: 16A, 32A
  /(\d+(?:\.\d+)?)\s*a(?![a-z])/gi,
  // Poles: 1P, 4P
  /(\d+)\s*p(?![a-z])/gi,
  // Cross-section: 2.5sqmm, 4sqmm
  /(\d+(?:\.\d+)?)\s*sqmm/gi,
  // Cable spec: 4CX10, 5CX6, 4cx2.5
  /(\d+)c\s*x\s*(\d+(?:\.\d+)?)/gi,
  // Generic sq mm at word boundary
  /(\d+(?:\.\d+)?)\s*sq\.?\s*mm/gi,
];

interface NumericToken {
  pattern: string;  // e.g. "50mm", "4CX10"
  value: string;    // normalized for comparison
}

/**
 * Extract all meaningful technical numeric tokens from text.
 */
function extractNumericTokens(text: string): NumericToken[] {
  const tokens: NumericToken[] = [];
  const normalized = text.toLowerCase();

  // Cable spec: 4CX10, 5CX6
  for (const m of normalized.matchAll(/(\d+)c\s*x\s*(\d+(?:\.\d+)?)/gi)) {
    tokens.push({ pattern: m[0], value: `${m[1]}cx${m[2]}` });
  }

  // Dimensions with mm: 50mm, 100mm, 1.6mm
  for (const m of normalized.matchAll(/(\d+(?:\.\d+)?)\s*mm(?![\w])/gi)) {
    tokens.push({ pattern: m[0], value: `${m[1]}mm` });
  }

  // Amperage: 16A, 32A
  for (const m of normalized.matchAll(/(\d+(?:\.\d+)?)\s*a(?![a-z])/gi)) {
    tokens.push({ pattern: m[0], value: `${m[1]}a` });
  }

  // Poles: 1P, 4P
  for (const m of normalized.matchAll(/(\d+)\s*p(?![a-z])/gi)) {
    tokens.push({ pattern: m[0], value: `${m[1]}p` });
  }

  // Cross-section: 2.5sqmm, 4sqmm
  for (const m of normalized.matchAll(/(\d+(?:\.\d+)?)\s*sqmm/gi)) {
    tokens.push({ pattern: m[0], value: `${m[1]}sqmm` });
  }

  return tokens;
}

/**
 * Detect meaningful technical numeric conflicts between two texts.
 *
 * Returns array of conflict descriptions.
 * An empty array means no conflicts detected.
 */
export function detectNumericConflicts(
  invoiceText: string,
  soText: string
): string[] {
  const invTokens = extractNumericTokens(invoiceText);
  const soTokens = extractNumericTokens(soText);
  const conflicts: string[] = [];

  // For each spec category, check if values differ
  // Group tokens by their unit suffix
  const invByUnit = new Map<string, string[]>();
  const soByUnit = new Map<string, string[]>();

  for (const t of invTokens) {
    const unit = t.value.replace(/^[\d.]+/, "");
    if (!invByUnit.has(unit)) invByUnit.set(unit, []);
    invByUnit.get(unit)!.push(t.value);
  }
  for (const t of soTokens) {
    const unit = t.value.replace(/^[\d.]+/, "");
    if (!soByUnit.has(unit)) soByUnit.set(unit, []);
    soByUnit.get(unit)!.push(t.value);
  }

  // Compare matching unit categories
  for (const [unit, invValues] of invByUnit) {
    const soValues = soByUnit.get(unit);
    if (!soValues) continue;

    // Check for ANY mismatch in the same category
    for (const iv of invValues) {
      for (const sv of soValues) {
        if (iv !== sv) {
          conflicts.push(`${iv} vs ${sv}`);
        }
      }
    }
  }

  // Special case: cable spec comparison (CX patterns)
  const invCx = invTokens.filter(t => t.value.includes("cx"));
  const soCx = soTokens.filter(t => t.value.includes("cx"));
  if (invCx.length > 0 && soCx.length > 0) {
    for (const ic of invCx) {
      for (const sc of soCx) {
        if (ic.value !== sc.value && !conflicts.includes(`${ic.value} vs ${sc.value}`)) {
          conflicts.push(`${ic.value} vs ${sc.value}`);
        }
      }
    }
  }

  return [...new Set(conflicts)]; // deduplicate
}

// ── Token Overlap ──────────────────────────────────────────

/**
 * Tokenize normalized text into meaningful comparison tokens.
 * Filters out very short stop words.
 */
function tokenize(text: string): string[] {
  return text
    .split(/[\s,;()\[\]{}|/\\]+/)
    .map(t => t.replace(/^[-.]+|[-.]+$/g, ""))
    .filter(t => t.length > 0);
}

const STOP_WORDS = new Set([
  "a", "an", "the", "of", "for", "and", "or", "in", "to", "on",
  "at", "by", "no", "nos", "is", "it", "as", "with", "&",
]);

/**
 * Compute token overlap between two normalized texts.
 * Returns matched and unique tokens.
 */
function computeTokenOverlap(text1: string, text2: string): {
  matched: string[];
  text1Only: string[];
  text2Only: string[];
  overlapRatio: number;
} {
  const tokens1 = tokenize(text1).filter(t => !STOP_WORDS.has(t));
  const tokens2 = tokenize(text2).filter(t => !STOP_WORDS.has(t));

  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);

  const matched = tokens1.filter(t => set2.has(t));
  const text1Only = tokens1.filter(t => !set2.has(t));
  const text2Only = tokens2.filter(t => !set1.has(t));

  const uniqueMatched = [...new Set(matched)];
  const totalUnique = new Set([...tokens1, ...tokens2]).size;
  const overlapRatio = totalUnique > 0 ? uniqueMatched.length / totalUnique : 0;

  return {
    matched: uniqueMatched,
    text1Only: [...new Set(text1Only)],
    text2Only: [...new Set(text2Only)],
    overlapRatio,
  };
}

// ── Main Narration Comparison ──────────────────────────────

/**
 * Compare Invoice narration against SO narration.
 *
 * Deterministic, explainable result:
 *  - EXACT: normalized narration is identical
 *  - HIGH: strong token overlap, no technical numeric conflict, Item Number matches where both exist
 *  - MEDIUM: useful overlap, no critical conflict
 *  - LOW: weak evidence
 *  - CONFLICT: meaningful technical numeric contradiction or Item Number contradiction
 *
 * Thresholds (deterministic, documented):
 *  - EXACT: normalized equality
 *  - HIGH: overlap ≥ 0.70 AND no numeric conflict AND no item number mismatch
 *  - MEDIUM: overlap ≥ 0.40 AND no numeric conflict
 *  - LOW: overlap < 0.40 OR some overlap but with issues
 *  - CONFLICT: any numeric conflict detected
 */
export function compareNarrations(
  invoiceItemName: string | null | undefined,
  invoiceDescription: string | null | undefined,
  soItemName: string | null | undefined,
  soDescription: string | null | undefined,
  invoiceUnit?: string | null,
  soUnit?: string | null
): NarrationMatchResult {
  // Combine item name + description for each side
  const invRaw = [invoiceItemName ?? "", invoiceDescription ?? ""].filter(Boolean).join(" ");
  const soRaw = [soItemName ?? "", soDescription ?? ""].filter(Boolean).join(" ");

  const invoiceNormalized = normalizeNarrationText(invRaw);
  const soNormalized = normalizeNarrationText(soRaw);

  // Both empty → EXACT (vacuously)
  if (invoiceNormalized === "" && soNormalized === "") {
    return {
      level: "EXACT",
      score: 1.0,
      matchedTokens: [],
      conflictingTokens: [],
      numericConflicts: [],
      itemNumber: "UNKNOWN",
      invoiceNormalized,
      soNormalized,
    };
  }

  // One empty, other not → LOW
  if (invoiceNormalized === "" || soNormalized === "") {
    return {
      level: "LOW",
      score: 0,
      matchedTokens: [],
      conflictingTokens: [],
      numericConflicts: [],
      itemNumber: "UNKNOWN",
      invoiceNormalized,
      soNormalized,
    };
  }

  // Check exact normalized match
  if (invoiceNormalized === soNormalized) {
    return {
      level: "EXACT",
      score: 1.0,
      matchedTokens: tokenize(invoiceNormalized),
      conflictingTokens: [],
      numericConflicts: [],
      itemNumber: compareItemNumbers(invRaw, soRaw),
      invoiceNormalized,
      soNormalized,
    };
  }

  // Detect numeric conflicts
  const numericConflicts = detectNumericConflicts(invoiceNormalized, soNormalized);

  // Item number comparison
  const itemNumber = compareItemNumbers(invRaw, soRaw);

  // Token overlap
  const overlap = computeTokenOverlap(invoiceNormalized, soNormalized);

  // Determine level
  let level: NarrationMatchLevel;
  let score = overlap.overlapRatio;

  if (numericConflicts.length > 0 || itemNumber === "MISMATCH") {
    level = "CONFLICT";
    score = Math.min(score, 0.2); // Cap score for conflicts
  } else if (score >= 0.70) {
    level = "HIGH";
  } else if (score >= 0.40) {
    level = "MEDIUM";
  } else {
    level = "LOW";
  }

  return {
    level,
    score,
    matchedTokens: overlap.matched,
    conflictingTokens: [...overlap.text1Only, ...overlap.text2Only],
    numericConflicts,
    itemNumber,
    invoiceNormalized,
    soNormalized,
  };
}

// ── UOM Comparison ─────────────────────────────────────────

/**
 * Compare UOM between Invoice and SO lines.
 *
 * No conversion. Simple string comparison after normalization.
 *
 * Returns:
 *  - MATCH: same UOM (case-insensitive, trimmed)
 *  - MISMATCH: different UOM
 *  - UNKNOWN: one or both sides missing
 */
export function compareUom(
  invoiceUnit: string | null | undefined,
  soUnit: string | null | undefined
): UomEvidence {
  const inv = (invoiceUnit ?? "").trim().toLowerCase();
  const so = (soUnit ?? "").trim().toLowerCase();

  if (!inv || !so) return "UNKNOWN";
  return inv === so ? "MATCH" : "MISMATCH";
}

// ── Candidate Ranking ──────────────────────────────────────

export interface CandidateLine {
  line_item_id: string;
  item_id: string | null;
  item_name: string | null;
  description: string | null;
  quantity: number | null;
  rate: number | null;
  unit: string | null;
}

/**
 * Rank a single SO candidate line against an Invoice line.
 *
 * Pure deterministic helper — no persistence, no network, no AI.
 *
 * Evidence dimensions:
 *  1. itemId: EXACT / DIFFERENT / UNKNOWN
 *  2. narration: EXACT / HIGH / MEDIUM / LOW / CONFLICT
 *  3. numeric: MATCH / CONFLICT / UNKNOWN
 *  4. itemNumber: MATCH / MISMATCH / UNKNOWN
 *  5. uom: MATCH / MISMATCH / UNKNOWN
 *  6. quantity: supporting evidence
 *  7. rate: supporting evidence
 *
 * Overall: SUGGESTED / NOT_RECOMMENDED
 *
 * Rate equality alone DOES NOT prove identity.
 * Quantity equality alone DOES NOT prove identity.
 * Narration similarity alone DOES NOT prove identity.
 */
export function rankCandidate(
  invoiceLine: CandidateLine,
  soLine: CandidateLine
): CandidateRanking {
  // Item ID evidence
  let itemId: ItemIdEvidence;
  if (!invoiceLine.item_id || !soLine.item_id) {
    itemId = "UNKNOWN";
  } else if (invoiceLine.item_id === soLine.item_id) {
    itemId = "EXACT";
  } else {
    itemId = "DIFFERENT";
  }

  // Narration comparison
  const narrationDetail = compareNarrations(
    invoiceLine.item_name,
    invoiceLine.description,
    soLine.item_name,
    soLine.description,
    invoiceLine.unit,
    soLine.unit
  );

  // Numeric evidence (from narration)
  let numeric: "MATCH" | "CONFLICT" | "UNKNOWN";
  if (narrationDetail.numericConflicts.length > 0) {
    numeric = "CONFLICT";
  } else if (narrationDetail.matchedTokens.length > 0) {
    numeric = "MATCH";
  } else {
    numeric = "UNKNOWN";
  }

  // UOM comparison
  const uom = compareUom(invoiceLine.unit, soLine.unit);

  // Quantity comparison (supporting only)
  let quantity: "MATCH" | "DIFFERENT" | "UNKNOWN";
  if (invoiceLine.quantity == null || soLine.quantity == null) {
    quantity = "UNKNOWN";
  } else if (Math.abs(invoiceLine.quantity - soLine.quantity) < 0.001) {
    quantity = "MATCH";
  } else {
    quantity = "DIFFERENT";
  }

  // Rate comparison (supporting only)
  let rate: "MATCH" | "DIFFERENT" | "UNKNOWN";
  if (invoiceLine.rate == null || soLine.rate == null) {
    rate = "UNKNOWN";
  } else if (Math.abs(invoiceLine.rate - soLine.rate) < 0.001) {
    rate = "MATCH";
  } else {
    rate = "DIFFERENT";
  }

  // ── Overall determination ──────────────────────────────
  //
  // Priority (documented):
  //  1. Hard numeric conflict → NOT_RECOMMENDED
  //  2. Item number mismatch → NOT_RECOMMENDED
  //  3. Exact item_id → SUGGESTED (strongest identity)
  //  4. Strong narration + no conflict → SUGGESTED
  //  5. UOM mismatch lowers confidence
  //  6. Quantity/rate are supporting, never decisive
  //
  // Rate equality alone DOES NOT prove identity.
  // Quantity equality alone DOES NOT prove identity.
  // Narration similarity alone DOES NOT prove identity
  //   (but narration is used for candidate suggestion ranking).

  let overall: OverallSuggestion;

  // Hard reject: numeric conflict or item number mismatch
  if (narrationDetail.level === "CONFLICT" || narrationDetail.itemNumber === "MISMATCH") {
    overall = "NOT_RECOMMENDED";
  }
  // Exact item_id is strongest identity evidence
  else if (itemId === "EXACT") {
    overall = "SUGGESTED";
  }
  // Strong narration agreement without conflicts
  else if (narrationDetail.level === "HIGH" || narrationDetail.level === "EXACT") {
    overall = "SUGGESTED";
  }
  // Medium narration with no conflicts
  else if (narrationDetail.level === "MEDIUM" && numeric !== "CONFLICT") {
    overall = "SUGGESTED";
  }
  // Everything else
  else {
    overall = "NOT_RECOMMENDED";
  }

  // UOM mismatch degrades to NOT_RECOMMENDED unless item_id is EXACT
  if (uom === "MISMATCH" && itemId !== "EXACT" && overall === "SUGGESTED") {
    overall = "NOT_RECOMMENDED";
  }

  // ── Sort score ─────────────────────────────────────────
  // Deterministic numeric score for stable sorting.
  // Higher = better candidate.
  let sortScore = 0;

  // Hard reject: low base
  if (overall === "NOT_RECOMMENDED") {
    sortScore = 0;
  } else {
    // Base from narration
    if (narrationDetail.level === "EXACT") sortScore += 100;
    else if (narrationDetail.level === "HIGH") sortScore += 80;
    else if (narrationDetail.level === "MEDIUM") sortScore += 50;
    else if (narrationDetail.level === "LOW") sortScore += 20;

    // Item ID bonus
    if (itemId === "EXACT") sortScore += 50;

    // Item number bonus
    if (narrationDetail.itemNumber === "MATCH") sortScore += 30;

    // UOM
    if (uom === "MATCH") sortScore += 10;
    if (uom === "MISMATCH") sortScore -= 20;

    // Supporting evidence
    if (quantity === "MATCH") sortScore += 5;
    if (rate === "MATCH") sortScore += 5;
  }

  return {
    itemId,
    narration: narrationDetail.level,
    numeric,
    itemNumber: narrationDetail.itemNumber,
    uom,
    quantity,
    rate,
    overall,
    sortScore,
    narrationDetail,
  };
}

/**
 * Rank multiple SO candidate lines against a single Invoice line.
 * Returns candidates sorted by sortScore descending (best first).
 *
 * Pure deterministic. No persistence. No network. No AI.
 * Suggestions are NOT persisted.
 */
export function rankCandidates(
  invoiceLine: CandidateLine,
  soCandidates: CandidateLine[]
): Array<{ candidate: CandidateLine; ranking: CandidateRanking }> {
  const results = soCandidates.map(candidate => ({
    candidate,
    ranking: rankCandidate(invoiceLine, candidate),
  }));

  // Stable deterministic sort: sortScore DESC, then line_item_id ASC for tie-break
  results.sort((a, b) => {
    if (b.ranking.sortScore !== a.ranking.sortScore) {
      return b.ranking.sortScore - a.ranking.sortScore;
    }
    return a.candidate.line_item_id.localeCompare(b.candidate.line_item_id);
  });

  return results;
}

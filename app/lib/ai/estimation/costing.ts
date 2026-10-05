// ============================================================
// Bansil Books Analytics — Phase 4A: Costing Architecture
// Pure deterministic math for the cost build-up. Zero AI calls.
//  - All costs on GST-exclusive taxable basis.
//  - Recoverable GST never enters cost; only non-recoverable tax does.
//  - Landed cost is separate lines, never folded into basic rate.
//  - Margin is computed AFTER and SEPARATE from cost, from explicit
//    input only — there is no universal default margin.
// ============================================================

import { isAssumptionOwnerApproved, validateAssumption } from "./evidence";
import {
  COST_LAYERS,
  type CostLayer,
  type CostLine,
  type CostSummary,
  type MarginInput,
  type OfferValuation,
  type TaxComponents,
} from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ==================== TAX SEPARATION ====================

/**
 * Split a taxable value into GST components.
 * `recoverableFraction` (0..1) is the input-tax-credit eligible share,
 * supplied by Accounts policy — never assumed here.
 */
export function computeTaxComponents(
  taxableValue: number,
  gstRatePercent: number,
  recoverableFraction: number,
): TaxComponents {
  if (!(gstRatePercent >= 0)) throw new Error("GST rate must be explicit and >= 0");
  if (!(recoverableFraction >= 0 && recoverableFraction <= 1)) throw new Error("recoverableFraction must be 0..1");
  const gstAmount = round2(taxableValue * gstRatePercent / 100);
  const recoverableTax = round2(gstAmount * recoverableFraction);
  const nonRecoverableTax = round2(gstAmount - recoverableTax);
  return { taxableValue: round2(taxableValue), gstAmount, recoverableTax, nonRecoverableTax, grossValue: round2(taxableValue + gstAmount) };
}

/** Cost contribution of tax = non-recoverable portion only. */
export function costBearingTax(t: TaxComponents): number {
  return t.nonRecoverableTax;
}

// ==================== LANDED COST ====================

export interface LandedCostBreakdown {
  basicMaterial: number;
  landedComponents: number;
  landedMaterial: number;
}

/** Basic material vs landed: landed = basic + FREIGHT/PACKING/… lines (kept as separate layers). */
export function computeLandedCost(lines: CostLine[]): LandedCostBreakdown {
  const basicMaterial = round2(lines.filter((l) => l.layer === "MATERIAL").reduce((s, l) => s + l.amount, 0));
  const landedComponents = round2(
    lines.filter((l) => l.layer === "FREIGHT_TRANSPORT" || l.layer === "PACKING" ||
      (l.layer === "INSURANCE_STATUTORY" && l.subCategory === "TRANSIT_INSURANCE"))
      .reduce((s, l) => s + l.amount, 0),
  );
  return { basicMaterial, landedComponents, landedMaterial: round2(basicMaterial + landedComponents) };
}

// ==================== COST LINE VALIDATION ====================

export function validateCostLine(l: CostLine): string[] {
  const v: string[] = [];
  if (!COST_LAYERS.includes(l.layer)) v.push("COST_LAYER_UNKNOWN");
  if (!Number.isFinite(l.quantity) || l.quantity < 0) v.push("COST_QTY_INVALID");
  if (!Number.isFinite(l.unitCost) || l.unitCost < 0) v.push("COST_UNIT_INVALID");
  if (Math.abs(round2(l.quantity * l.unitCost) - round2(l.amount)) > 0.01) v.push("COST_AMOUNT_MISMATCH");
  if (l.nonRecoverableTax < 0) v.push("COST_TAX_INVALID");
  if (l.verificationStatus === "AI_INFERENCE") v.push("COST_FROM_AI_INFERENCE");
  if (l.verificationStatus === "VERIFIED" && !l.provenance) v.push("VERIFIED_COST_WITHOUT_PROVENANCE");
  if ((l.verificationStatus === "ASSUMPTION" || l.verificationStatus === "ESTIMATE") && !validateAssumption(l.assumption).valid) {
    v.push("NON_SOURCE_COST_WITHOUT_ASSUMPTION");
  }
  return v;
}

// ==================== COST BUILD-UP ====================

/**
 * TOTAL ESTIMATED COST = Σ layers (taxable amount + non-recoverable tax).
 * MISSING_RATE lines contribute 0 and are counted so the gap is visible.
 * Throws on invalid lines — never silently drops them.
 */
export function computeCostSummary(lines: CostLine[]): CostSummary {
  const byLayer = Object.fromEntries(COST_LAYERS.map((k) => [k, 0])) as Record<CostLayer, number>;
  let unverified = 0;
  let missing = 0;
  for (const l of lines) {
    if (l.verificationStatus === "MISSING_RATE") { missing++; continue; }
    const errs = validateCostLine(l);
    if (errs.length) throw new Error(`INVALID_COST_LINE ${l.costLineId}: ${errs.join(",")}`);
    if (l.verificationStatus !== "VERIFIED") unverified++;
    byLayer[l.layer] = round2(byLayer[l.layer] + l.amount + l.nonRecoverableTax);
  }
  const total = round2(Object.values(byLayer).reduce((s, n) => s + n, 0));
  return { byLayer, totalEstimatedCost: total, unverifiedLineCount: unverified, missingRateLineCount: missing, lineCount: lines.length };
}

// ==================== MARGIN (SEPARATE FROM COST) ====================

/**
 * PROPOSED OFFER VALUE = TOTAL ESTIMATED COST + risk loading + margin.
 * Requires explicit margin input backed by a valid assumption record.
 * Result is always a DRAFT that requires checker review + Owner approval.
 */
export function computeOfferValuation(summary: CostSummary, margin: MarginInput | null | undefined): OfferValuation {
  if (!margin) throw new Error("MARGIN_INPUT_REQUIRED: no universal default margin exists.");
  if (!Number.isFinite(margin.percent) || margin.percent < 0) throw new Error("MARGIN_PERCENT_INVALID");
  if (margin.method === "GROSS_MARGIN_ON_PRICE" && margin.percent >= 100) throw new Error("GROSS_MARGIN_MUST_BE_BELOW_100");
  const av = validateAssumption(margin.assumption);
  if (!av.valid) throw new Error(`MARGIN_ASSUMPTION_INVALID: ${av.violations.join(",")}`);

  const cost = summary.totalEstimatedCost;
  const riskLoading = round2(cost * ((margin.riskLoadingPercent ?? 0) / 100));
  const loadedCost = cost + riskLoading;
  const offer = margin.method === "MARKUP_ON_COST"
    ? round2(loadedCost * (1 + margin.percent / 100))
    : round2(loadedCost / (1 - margin.percent / 100));
  const marginAmount = round2(offer - loadedCost);
  return {
    totalEstimatedCost: cost,
    riskLoading,
    marginAmount,
    proposedOfferValue: offer,
    grossMarginPercent: offer > 0 ? round2(((offer - cost) / offer) * 100) : 0,
    markupPercent: cost > 0 ? round2(((offer - cost) / cost) * 100) : 0,
    status: "DRAFT_REQUIRES_REVIEW_AND_OWNER_APPROVAL",
  };
}

/** True only when the margin assumption itself carries Owner approval. */
export function isMarginOwnerApproved(margin: MarginInput): boolean {
  return isAssumptionOwnerApproved(margin.assumption);
}

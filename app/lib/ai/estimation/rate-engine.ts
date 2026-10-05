// ============================================================
// Bansil Books Analytics — Phase 4D: Vendor / Historical Rate Engine
//
// Deterministic rate-EVIDENCE engine. Zero AI/model calls.
// For each BOQ line / item / UOM it answers only:
//   "What verified commercial rate evidence exists?"
//
// Never: invents a rate, vendor quote, item mapping, UOM conversion,
// GST rate, freight basis or pack size; computes qty × rate, project
// cost or margin; selects a vendor or a tender rate; sends an RFQ;
// places a purchase; writes to bansil_books.db / audit_workspace.db;
// writes to Zoho (ZOHO WRITE = 0).
// ============================================================

import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isZohoWriteAllowed } from "../ceo/authority-policy";
import { checkEstimationAuthority, getEstimationReviewHook, routeEstimationTask } from "./authority";
import {
  canonicalizeUom,
  classifyRateFreshness,
  convertQuantity,
  normalizeNameKey,
  rateAgeDays,
  toGstExclusiveRate,
  type RateFreshnessPolicy,
  type UomConversionRule,
} from "./evidence";
import { resolveCommercialFact } from "./safety";
import { fingerprintRow, type BillLineRow, type PoLineRow, type RateSourceReader } from "./rate-source-reader";
import type { RateEvidenceStore } from "./rate-store";
import type {
  ApprovedItemAlias,
  BestAvailableEvidence,
  BoqLineRateInput,
  BoqLineRateResult,
  BoqRateStatus,
  CommitmentStatus,
  ComparableRate,
  EvidenceQuality,
  ItemCandidate,
  ItemIdentityQuery,
  ItemMasterRow,
  ItemMatchMethod,
  ItemMatchResult,
  LandedChargeRef,
  LastPurchaseRate,
  PackBasis,
  PossibleNextAction,
  RateEvidenceRecord,
  RateEvidenceStatus,
  RateFreightBasis,
  RateLookupRunSummary,
  RateProvenance,
  RateReviewHookResult,
  RateSeriesMetrics,
  RateSeriesPoint,
  RateSourceType,
  UomAliasRule,
  VendorRateHistory,
} from "./rate-types";
import type { TaxBasis } from "./types";

export const RATE_ENGINE_VERSION = "4D.1";

/**
 * Arithmetic-consistency tolerance (₹) for qty × rate vs line total —
 * the same tolerance used in the Phase 4A source discovery. It is a
 * data-integrity check, not a commercial threshold.
 */
export const LINE_ARITHMETIC_TOLERANCE = 0.5;

/**
 * Highest statutory GST slab (28%). Used ONLY to recognise that a bill /
 * PO header total equals taxable line values plus tax added on top
 * (⇒ line values are GST-exclusive). It is never used to derive or
 * assume the GST rate of any line — gst_rate_percent stays null.
 */
export const MAX_STATUTORY_GST_FRACTION = 0.28;

/** Fuzzy token overlap — produces CANDIDATE_ONLY suggestions, never matches. */
export const CANDIDATE_MIN_TOKEN_OVERLAP = 0.5;

/** Item names on bill lines that denote landed-cost charges, kept separate from item rates. */
const LANDED_CHARGE_PATTERN =
  /\b(FREIGHT|TRANSPORT|TRANSPORTATION|CARTAGE|PACKING|FORWARDING|LOADING|UNLOADING|LANDING|OCTROI|COURIER|TRANSIT INSURANCE)\b/;

const POSTED_BILL_EXCLUDED_STATUSES = new Set(["draft", "void"]);
const PO_COMMITTED_STATUSES = new Set(["billed", "partially_billed"]);
const PO_PROVISIONAL_STATUSES = new Set(["open", "approved", "issued"]);
const PO_UNAPPROVED_STATUSES = new Set(["draft", "pending_approval"]);
const PO_EXCLUDED_STATUSES = new Set(["cancelled", "void"]);

const BLOCKING_WARNINGS = new Set([
  "UOM_MISSING",
  "TAX_BASIS_UNKNOWN",
  "RATE_ARITHMETIC_MISMATCH",
  "INVALID_RATE",
  "INVALID_QUANTITY",
  "LANDED_CHARGE_LINE",
  "BILL_NOT_POSTED",
  "PO_NOT_APPROVED",
  "PO_STATUS_UNRECOGNISED",
  "PROVENANCE_MISSING",
  "SOURCE_DATE_MISSING",
]);

const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

function evidenceId(sourceType: RateSourceType, table: string, recordId: string): string {
  return `RE-${crypto.createHash("sha256").update(`${sourceType}|${table}|${recordId}`).digest("hex").slice(0, 24)}`;
}

export function isLandedChargeName(name: string | null | undefined): boolean {
  return LANDED_CHARGE_PATTERN.test(normalizeNameKey(name));
}

// ==================== TAX BASIS (header arithmetic) ====================

/**
 * Line values are GST-exclusive when the document header total exceeds the
 * taxable line sum by an amount within the statutory GST range (0 < tax ≤ 28%).
 * Equal totals (zero tax OR tax-inclusive lines) and lower totals
 * (discount / adjustment) are indistinguishable ⇒ UNKNOWN. The GST rate itself
 * is never derived.
 */
export function determineDocumentTaxBasis(headerTotal: number, taxableLineSum: number): { basis: TaxBasis; source: string } {
  if (!Number.isFinite(headerTotal) || !Number.isFinite(taxableLineSum) || taxableLineSum <= 0) {
    return { basis: "UNKNOWN", source: "HEADER_OR_LINE_TOTAL_UNAVAILABLE" };
  }
  const tax = headerTotal - taxableLineSum;
  if (tax > LINE_ARITHMETIC_TOLERANCE && tax <= taxableLineSum * MAX_STATUTORY_GST_FRACTION + LINE_ARITHMETIC_TOLERANCE) {
    return { basis: "GST_EXCLUSIVE", source: "HEADER_TOTAL_EXCEEDS_TAXABLE_LINE_SUM_WITHIN_STATUTORY_GST_RANGE" };
  }
  if (Math.abs(tax) <= LINE_ARITHMETIC_TOLERANCE) {
    return { basis: "UNKNOWN", source: "HEADER_EQUALS_LINE_SUM_ZERO_TAX_OR_INCLUSIVE_INDISTINGUISHABLE" };
  }
  return { basis: "UNKNOWN", source: tax < 0 ? "HEADER_BELOW_LINE_SUM_ADJUSTMENT_OR_DISCOUNT" : "HEADER_EXCESS_OUTSIDE_STATUTORY_GST_RANGE" };
}

// ==================== PROVENANCE / STATUS GATES ====================

export function isProvenanceComplete(p: RateProvenance | null | undefined): boolean {
  return !!p && !!p.sourceSystem && !!p.table && !!p.recordId && !!p.recordDate &&
    !Number.isNaN(Date.parse(p.recordDate)) && /^[a-f0-9]{64}$/.test(p.sourceFingerprint ?? "") && !!p.tier;
}

/**
 * Provenance is mandatory. Evidence without complete provenance can never be
 * VERIFIED or PROVISIONAL — it is demoted to REQUIRES_OWNER_REVIEW.
 */
export function enforceProvenanceGate(e: RateEvidenceRecord): RateEvidenceRecord {
  if (isProvenanceComplete(e.provenance)) return e;
  if (e.verification_status === "VERIFIED" || e.verification_status === "PROVISIONAL") {
    return {
      ...e,
      verification_status: "REQUIRES_OWNER_REVIEW",
      evidence_quality: "NONE",
      warnings: [...new Set([...e.warnings, "PROVENANCE_MISSING"])],
    };
  }
  return { ...e, warnings: [...new Set([...e.warnings, "PROVENANCE_MISSING"])] };
}

function qualityOf(status: RateEvidenceStatus, commitment: CommitmentStatus): EvidenceQuality {
  if (status === "VERIFIED" && commitment === "ACTUAL_PURCHASE") return "HIGH";
  if (status === "VERIFIED" && commitment === "COMMITTED_PO") return "MEDIUM";
  if (status === "PROVISIONAL" || status === "OWNER_APPROVED_MANUAL_RATE") return "LOW";
  return "NONE";
}

/**
 * The only way to VERIFIED. AI inference, candidate matches, manual /
 * provisional values and evidence without provenance can never be promoted.
 */
export function canPromoteRateEvidenceToVerified(e: RateEvidenceRecord): { allowed: boolean; reason: string } {
  if (e.provenance?.tier === "AI_INFERENCE") return { allowed: false, reason: "AI_INFERENCE_CANNOT_BE_VERIFIED" };
  if (e.verification_status === "CANDIDATE_ONLY" || e.item_match_method === "CANDIDATE_MATCH" || e.item_match_method === "AI_SUGGESTION") {
    return { allowed: false, reason: "CANDIDATE_MATCH_CANNOT_BE_VERIFIED" };
  }
  if (e.source_type === "MANUAL_APPROVED_RATE" || e.source_type === "PROVISIONAL_RATE") {
    return { allowed: false, reason: "MANUAL_RATE_NEVER_VERIFIED" };
  }
  if (!isProvenanceComplete(e.provenance)) return { allowed: false, reason: "PROVENANCE_MISSING" };
  const blocking = e.warnings.filter((w) => BLOCKING_WARNINGS.has(w));
  if (blocking.length) return { allowed: false, reason: blocking.join(",") };
  if (e.commitment_status === "PROVISIONAL_PO") return { allowed: false, reason: "PO_NOT_BILLED_REMAINS_PROVISIONAL" };
  return { allowed: true, reason: "ALL_GATES_PASSED" };
}

/**
 * AI may never supply a commercial rate. Any AI-proposed number is discarded;
 * the outcome is MISSING_RATE with value null (Phase 4A resolveCommercialFact).
 */
export function guardAiRateSuggestion(aiText: string): { accepted: false; value: null; status: "MISSING_RATE"; note: string } {
  const fact = resolveCommercialFact<number>({ kind: "RATE", sourced: null, aiSuggestion: aiText });
  return { accepted: false, value: null, status: fact.status as "MISSING_RATE", note: fact.aiNote ?? "" };
}

// ==================== EVIDENCE BUILDERS ====================

interface BuildCtx {
  asOfDate: string;
  freshnessPolicy: RateFreshnessPolicy | null;
}

function finalizeStatus(warnings: string[], whenClean: RateEvidenceStatus): RateEvidenceStatus {
  return warnings.some((w) => BLOCKING_WARNINGS.has(w)) ? "REQUIRES_OWNER_REVIEW" : whenClean;
}

function withFreshness(e: RateEvidenceRecord, ctx: BuildCtx): RateEvidenceRecord {
  const f = classifyRateFreshness(e.source_date, ctx.asOfDate, ctx.freshnessPolicy, e.validity_date ?? undefined);
  const warnings = e.warnings.filter((w) => !w.startsWith("STALE_BY_POLICY") && w !== "VALIDITY_EXPIRED");
  if (f.status === "STALE") warnings.push(e.validity_date && f.reason === "Vendor validity expired." ? "VALIDITY_EXPIRED" : `STALE_BY_POLICY:${f.reason}`);
  return { ...e, age_days: rateAgeDays(e.source_date, ctx.asOfDate), freshness: f.status, freshness_reason: f.reason, warnings };
}

export function buildBillEvidence(
  row: BillLineRow,
  item: ItemMasterRow | null,
  matchMethod: ItemMatchMethod,
  landedOnDocument: LandedChargeRef[],
  ctx: BuildCtx,
): RateEvidenceRecord {
  const warnings: string[] = [];
  const tax = determineDocumentTaxBasis(row.bill_total, row.bill_line_sum);
  const landed = isLandedChargeName(row.item_name);
  if (!row.unit || !row.unit.trim()) warnings.push("UOM_MISSING");
  if (tax.basis === "UNKNOWN") warnings.push("TAX_BASIS_UNKNOWN");
  if (!(row.rate > 0)) warnings.push("INVALID_RATE");
  if (!(row.quantity > 0)) warnings.push("INVALID_QUANTITY");
  if (Number.isFinite(row.rate) && Number.isFinite(row.quantity) && Math.abs(row.quantity * row.rate - row.line_total) > LINE_ARITHMETIC_TOLERANCE) {
    warnings.push("RATE_ARITHMETIC_MISMATCH");
  }
  if (landed) warnings.push("LANDED_CHARGE_LINE");
  if (POSTED_BILL_EXCLUDED_STATUSES.has(row.bill_status.toLowerCase())) warnings.push("BILL_NOT_POSTED");
  if (!row.date || Number.isNaN(Date.parse(row.date))) warnings.push("SOURCE_DATE_MISSING");
  if (matchMethod === "EXACT_NORMALIZED_NAME") warnings.push("MATCHED_BY_EXACT_NORMALIZED_NAME_ONLY");
  warnings.push("FREIGHT_BASIS_NOT_RECORDED_ON_SOURCE");
  if (landedOnDocument.length) warnings.push("LANDED_CHARGES_ON_SAME_DOCUMENT_NOT_ALLOCATED");
  warnings.push("SPECIFICATION_EQUIVALENCE_NOT_VERIFIED");

  const status = finalizeStatus(warnings, "VERIFIED");
  const provenance: RateProvenance = {
    sourceSystem: "BANSIL_BOOKS_DB",
    table: "purchase_bill_line_items",
    recordId: row.line_item_id,
    documentId: row.bill_id,
    documentNumber: row.bill_number,
    recordDate: row.date,
    tier: "VERIFIED_HISTORICAL_PURCHASE",
    sourceFingerprint: fingerprintRow(row),
    basis: "Zoho Books bill line: rate per line unit, taxable (pre-GST) line value",
  };
  const e: RateEvidenceRecord = {
    rate_evidence_id: evidenceId("BILL_RATE", "purchase_bill_line_items", row.line_item_id),
    item_id: row.item_id || item?.item_id || null,
    item_code: row.sku || item?.sku || null,
    item_name: row.item_name || null,
    description: row.description,
    item_match_method: matchMethod,
    vendor_name: row.vendor_name,
    vendor_id: row.vendor_id,
    rate: Number.isFinite(row.rate) ? row.rate : null,
    currency: "INR",
    source_type: "BILL_RATE",
    source_record_id: row.line_item_id,
    source_document: row.bill_number,
    source_document_id: row.bill_id,
    source_date: row.date,
    age_days: null,
    quantity: Number.isFinite(row.quantity) ? row.quantity : null,
    uom: row.unit && row.unit.trim() ? row.unit : null,
    normalized_uom: null,
    uom_normalization: "NONE",
    tax_basis: tax.basis,
    gst_rate_percent: null,
    tax_basis_source: tax.source,
    freight_basis: "UNKNOWN",
    freight_basis_source: "NO_FREIGHT_FIELD_ON_SOURCE",
    landed_cost_basis: "UNKNOWN",
    same_document_landed_charges: landedOnDocument,
    is_landed_charge_line: landed,
    pack: { rate_per: "UNIT", pack_quantity: null, pack_uom: null },
    validity_date: null,
    commitment_status: "ACTUAL_PURCHASE",
    verification_status: status,
    evidence_quality: qualityOf(status, "ACTUAL_PURCHASE"),
    freshness: "UNKNOWN",
    freshness_reason: "",
    provenance,
    linked_po_line_id: row.purchaseorder_item_id || null,
    linked_bill_line_ids: [],
    approval: null,
    warnings,
  };
  return withFreshness(enforceProvenanceGate(e), ctx);
}

export function buildPoEvidence(
  row: PoLineRow,
  item: ItemMasterRow | null,
  linkedBillLineIds: string[],
  ctx: BuildCtx,
): RateEvidenceRecord | null {
  const st = (row.po_status ?? "").toLowerCase();
  if (PO_EXCLUDED_STATUSES.has(st)) return null; // cancelled / void are not rate evidence
  const warnings: string[] = [];
  const tax = determineDocumentTaxBasis(row.po_total, row.po_line_sum);
  let commitment: CommitmentStatus;
  let clean: RateEvidenceStatus;
  if (PO_UNAPPROVED_STATUSES.has(st)) {
    commitment = "UNAPPROVED_PO";
    clean = "REQUIRES_OWNER_REVIEW";
    warnings.push("PO_NOT_APPROVED");
  } else if (PO_COMMITTED_STATUSES.has(st) || linkedBillLineIds.length > 0) {
    commitment = "COMMITTED_PO";
    clean = "VERIFIED";
  } else if (PO_PROVISIONAL_STATUSES.has(st)) {
    commitment = "PROVISIONAL_PO";
    clean = "PROVISIONAL";
    warnings.push("PO_NOT_BILLED_PROVISIONAL");
  } else {
    commitment = "UNAPPROVED_PO";
    clean = "REQUIRES_OWNER_REVIEW";
    warnings.push("PO_STATUS_UNRECOGNISED");
  }
  if (!row.unit || !row.unit.trim()) warnings.push("UOM_MISSING");
  if (tax.basis === "UNKNOWN") warnings.push("TAX_BASIS_UNKNOWN");
  if (!(row.rate > 0)) warnings.push("INVALID_RATE");
  if (!(row.quantity > 0)) warnings.push("INVALID_QUANTITY");
  if (Number.isFinite(row.rate) && Number.isFinite(row.quantity) && Number.isFinite(row.amount) &&
      Math.abs(row.quantity * row.rate - row.amount) > LINE_ARITHMETIC_TOLERANCE) {
    warnings.push("RATE_ARITHMETIC_MISMATCH");
  }
  if (!row.date || Number.isNaN(Date.parse(row.date))) warnings.push("SOURCE_DATE_MISSING");
  warnings.push("FREIGHT_BASIS_NOT_RECORDED_ON_SOURCE", "SPECIFICATION_EQUIVALENCE_NOT_VERIFIED");

  const status = finalizeStatus(warnings, clean);
  const provenance: RateProvenance = {
    sourceSystem: "AUDIT_WORKSPACE_DB",
    table: "audit_purchase_order_lines",
    recordId: row.line_item_id,
    documentId: row.purchaseorder_id,
    documentNumber: row.purchaseorder_number,
    recordDate: row.date ?? "",
    tier: "VERIFIED_HISTORICAL_PO",
    sourceFingerprint: fingerprintRow(row),
    basis: "Zoho Books purchase order line (committed/provisional, not actual purchase)",
  };
  const e: RateEvidenceRecord = {
    rate_evidence_id: evidenceId("PO_RATE", "audit_purchase_order_lines", row.line_item_id),
    item_id: row.item_id || item?.item_id || null,
    item_code: row.sku || item?.sku || null,
    item_name: item?.name ?? null,
    description: row.description,
    item_match_method: "EXACT_ITEM_ID",
    vendor_name: row.vendor_name,
    vendor_id: row.vendor_id,
    rate: Number.isFinite(row.rate) ? row.rate : null,
    currency: "INR",
    source_type: "PO_RATE",
    source_record_id: row.line_item_id,
    source_document: row.purchaseorder_number,
    source_document_id: row.purchaseorder_id,
    source_date: row.date,
    age_days: null,
    quantity: Number.isFinite(row.quantity) ? row.quantity : null,
    uom: row.unit && row.unit.trim() ? row.unit : null,
    normalized_uom: null,
    uom_normalization: "NONE",
    tax_basis: tax.basis,
    gst_rate_percent: null,
    tax_basis_source: tax.source,
    freight_basis: "UNKNOWN",
    freight_basis_source: "NO_FREIGHT_FIELD_ON_SOURCE",
    landed_cost_basis: "UNKNOWN",
    same_document_landed_charges: [],
    is_landed_charge_line: false,
    pack: { rate_per: "UNIT", pack_quantity: null, pack_uom: null },
    validity_date: null,
    commitment_status: commitment,
    verification_status: status,
    evidence_quality: qualityOf(status, commitment),
    freshness: "UNKNOWN",
    freshness_reason: "",
    provenance,
    linked_po_line_id: null,
    linked_bill_line_ids: [...linkedBillLineIds],
    approval: null,
    warnings,
  };
  return withFreshness(enforceProvenanceGate(e), ctx);
}

export interface ManualRateInput {
  sourceType: "MANUAL_APPROVED_RATE" | "PROVISIONAL_RATE";
  itemId?: string | null;
  itemCode?: string | null;
  description: string;
  vendorName?: string | null;
  vendorId?: string | null;
  rate: number;
  currency?: string;
  uom: string;
  taxBasis: TaxBasis;
  /** Only when explicitly stated by the person/source entering it. */
  gstRatePercent?: number | null;
  freightBasis: RateFreightBasis;
  landedCostBasis?: "BASIC_RATE_ONLY" | "DECLARED_INCLUDES_LANDED" | "UNKNOWN";
  pack?: PackBasis;
  validityDate?: string | null;
  sourceDate: string;
  basis: string;
  enteredBy: string;
  enteredAt: string;
  /** Owner approval stamp. Without it the rate is an ASSUMPTION. */
  ownerApproval?: { approvedBy: string; approvedAt: string } | null;
}

/**
 * Manual / provisional rates: ASSUMPTION, or OWNER_APPROVED_MANUAL_RATE when an
 * Owner stamp exists on a MANUAL_APPROVED_RATE. NEVER VERIFIED.
 */
export function buildManualRateEvidence(m: ManualRateInput, ctx: BuildCtx): RateEvidenceRecord {
  if (!m.basis || !m.basis.trim()) throw new Error("MANUAL_RATE_BASIS_REQUIRED");
  if (!(m.rate > 0)) throw new Error("MANUAL_RATE_VALUE_INVALID");
  if (!m.uom || !m.uom.trim()) throw new Error("MANUAL_RATE_UOM_REQUIRED");
  if (!m.enteredBy || !m.enteredAt) throw new Error("MANUAL_RATE_ENTRY_PROVENANCE_REQUIRED");
  const warnings: string[] = [];
  const approved = m.sourceType === "MANUAL_APPROVED_RATE" && !!m.ownerApproval?.approvedBy?.trim() &&
    !!m.ownerApproval?.approvedAt && !Number.isNaN(Date.parse(m.ownerApproval.approvedAt));
  if (m.sourceType === "MANUAL_APPROVED_RATE" && !approved) warnings.push("OWNER_APPROVAL_MISSING");
  if (m.taxBasis === "GST_INCLUSIVE" && (m.gstRatePercent === null || m.gstRatePercent === undefined)) warnings.push("GST_RATE_NOT_EXPLICIT");
  if (m.taxBasis === "UNKNOWN") warnings.push("TAX_BASIS_UNKNOWN_DECLARED");
  warnings.push("MANUAL_RATE_NOT_VERIFIED");
  const status: RateEvidenceStatus = approved ? "OWNER_APPROVED_MANUAL_RATE" : "ASSUMPTION";
  const assumptionId = `ASM-${crypto.randomUUID()}`;
  const fp = fingerprintRow({ ...m, assumptionId });
  const e: RateEvidenceRecord = {
    rate_evidence_id: `RE-MAN-${fp.slice(0, 24)}`,
    item_id: m.itemId ?? null,
    item_code: m.itemCode ?? null,
    item_name: null,
    description: m.description,
    item_match_method: m.itemId ? "EXACT_ITEM_ID" : "UNRESOLVED",
    vendor_name: m.vendorName ?? null,
    vendor_id: m.vendorId ?? null,
    rate: m.rate,
    currency: m.currency ?? "INR",
    source_type: m.sourceType,
    source_record_id: assumptionId,
    source_document: null,
    source_document_id: null,
    source_date: m.sourceDate,
    age_days: null,
    quantity: null,
    uom: m.uom,
    normalized_uom: null,
    uom_normalization: "NONE",
    tax_basis: m.taxBasis,
    gst_rate_percent: typeof m.gstRatePercent === "number" ? m.gstRatePercent : null,
    tax_basis_source: "DECLARED_BY_ENTRY",
    freight_basis: m.freightBasis,
    freight_basis_source: "DECLARED_BY_ENTRY",
    landed_cost_basis: m.landedCostBasis ?? "UNKNOWN",
    same_document_landed_charges: [],
    is_landed_charge_line: false,
    pack: m.pack ?? { rate_per: "UNIT", pack_quantity: null, pack_uom: null },
    validity_date: m.validityDate ?? null,
    commitment_status: "MANUAL",
    verification_status: status,
    evidence_quality: qualityOf(status, "MANUAL"),
    freshness: "UNKNOWN",
    freshness_reason: "",
    provenance: {
      sourceSystem: "ESTIMATION_DB",
      table: "estimation_rate_evidence",
      recordId: assumptionId,
      documentId: null,
      documentNumber: null,
      recordDate: m.sourceDate,
      tier: "APPROVED_ESTIMATOR_ASSUMPTION",
      sourceFingerprint: fp,
      basis: m.basis,
    },
    linked_po_line_id: null,
    linked_bill_line_ids: [],
    approval: {
      assumptionId,
      basis: m.basis,
      enteredBy: m.enteredBy,
      enteredAt: m.enteredAt,
      approvedBy: approved ? m.ownerApproval!.approvedBy : null,
      approvedAt: approved ? m.ownerApproval!.approvedAt : null,
    },
    warnings,
  };
  return withFreshness(e, ctx);
}

/** Persist a manual rate (estimation DB only). itemKey = item_id, or "BOQ:<boq_line_id>". */
export function recordManualRate(store: RateEvidenceStore, projectId: string, itemKey: string, m: ManualRateInput, asOfDate: string): RateEvidenceRecord {
  const e = buildManualRateEvidence(m, { asOfDate, freshnessPolicy: null });
  store.putManualRate(projectId, itemKey, e);
  return e;
}

// ==================== ITEM MATCHING ====================

const normCode = (c: string | null | undefined): string => (c ?? "").trim().toUpperCase();

export function aliasKeyForName(description: string | null | undefined): string {
  return `NAME:${normalizeNameKey(description)}`;
}
export function aliasKeyForCode(code: string | null | undefined): string {
  return `CODE:${normCode(code)}`;
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalizeNameKey(a).split(" ").filter((t) => t.length >= 2));
  const tb = new Set(normalizeNameKey(b).split(" ").filter((t) => t.length >= 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Deterministic item resolution. Automatic matches only by exact item_id,
 * exact item_code (SKU), Owner-approved alias, or exact normalized name.
 * Anything fuzzy or AI-suggested is CANDIDATE_ONLY.
 */
export function resolveItemMatch(
  reader: RateSourceReader,
  q: ItemIdentityQuery,
  approvedAliases: ApprovedItemAlias[] = [],
  aiSuggestions: Array<{ item_id: string }> = [],
): ItemMatchResult {
  const items = reader.listItems();
  if (q.itemId) {
    const it = reader.getItemById(q.itemId);
    if (it) return { status: "MATCHED", method: "EXACT_ITEM_ID", item: it, candidates: [], reason: "Exact item_id." };
  }
  if (q.itemCode && normCode(q.itemCode)) {
    const hits = items.filter((i) => normCode(i.sku) === normCode(q.itemCode));
    if (hits.length === 1) return { status: "MATCHED", method: "EXACT_ITEM_CODE", item: hits[0], candidates: [], reason: "Exact item_code (SKU)." };
    if (hits.length > 1) return { status: "AMBIGUOUS", method: "AMBIGUOUS", item: null, candidates: [], reason: `item_code matches ${hits.length} items.` };
  }
  const keys = [q.itemCode ? aliasKeyForCode(q.itemCode) : null, q.description ? aliasKeyForName(q.description) : null].filter(Boolean) as string[];
  const alias = approvedAliases.find((a) => keys.includes(a.query_key) && a.approved_by && a.approved_at);
  if (alias) {
    const it = reader.getItemById(alias.item_id);
    if (it) return { status: "MATCHED", method: "APPROVED_ALIAS", item: it, candidates: [], reason: `Owner-approved alias by ${alias.approved_by} at ${alias.approved_at}.` };
  }
  const nameKey = normalizeNameKey(q.description);
  if (nameKey) {
    const hits = items.filter((i) => normalizeNameKey(i.name) === nameKey);
    if (hits.length === 1) return { status: "MATCHED", method: "EXACT_NORMALIZED_NAME", item: hits[0], candidates: [], reason: "Exact normalized name." };
    if (hits.length > 1) return { status: "AMBIGUOUS", method: "AMBIGUOUS", item: null, candidates: [], reason: `Normalized name matches ${hits.length} items.` };
  }
  const candidates: ItemCandidate[] = [];
  if (q.description) {
    for (const i of items) {
      const s = tokenOverlap(q.description, i.name ?? "");
      if (s >= CANDIDATE_MIN_TOKEN_OVERLAP) candidates.push({ item_id: i.item_id, item_name: i.name, method: "CANDIDATE_MATCH", score: round4(s), status: "CANDIDATE_ONLY" });
    }
  }
  candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.item_id.localeCompare(b.item_id));
  const top = candidates.slice(0, 5);
  for (const s of aiSuggestions) {
    const it = items.find((i) => i.item_id === s.item_id);
    top.push({ item_id: s.item_id, item_name: it?.name ?? null, method: "AI_SUGGESTION", score: null, status: "CANDIDATE_ONLY" });
  }
  if (top.length) return { status: "CANDIDATE_ONLY", method: top[0].method, item: null, candidates: top, reason: "Uncertain match — candidates require Owner mapping." };
  return { status: "UNRESOLVED", method: "UNRESOLVED", item: null, candidates: [], reason: "No exact, alias or candidate match." };
}

// ==================== COMPARABILITY ====================

function canonicalWithAliases(raw: string | null, aliases: UomAliasRule[]): { canon: string | null; via: "IDENTICAL" | "SPELLING_ALIAS" | "APPROVED_ALIAS" } {
  const c = canonicalizeUom(raw);
  if (!c) return { canon: null, via: "IDENTICAL" };
  const a = aliases.find((x) => x.approvedBy && x.approvedAt && canonicalizeUom(x.alias) === c);
  if (a) return { canon: canonicalizeUom(a.canonical), via: "APPROVED_ALIAS" };
  return { canon: c, via: raw && raw.trim() === c ? "IDENTICAL" : "SPELLING_ALIAS" };
}

/**
 * Comparable GST-exclusive rate per BOQ UOM, or RATE_NOT_COMPARABLE.
 * No unit conversion without an explicit approved rule; no pack division
 * without explicit pack quantity; no GST conversion without explicit GST %.
 */
export function assessComparability(
  e: RateEvidenceRecord,
  boqUom: string | null,
  opts: { uomAliases?: UomAliasRule[]; uomConversions?: UomConversionRule[]; projectCurrency?: string } = {},
): ComparableRate {
  const reasons: string[] = [];
  const nc = (r: string[]): ComparableRate => ({
    rate_evidence_id: e.rate_evidence_id, status: "RATE_NOT_COMPARABLE", comparable_rate: null,
    comparable_quantity: null, comparable_uom: null, reasons: r, conversion_applied: null,
  });
  if (e.verification_status === "CANDIDATE_ONLY") return nc(["CANDIDATE_MATCH_NOT_COMMERCIAL_EVIDENCE"]);
  if (e.verification_status === "REQUIRES_OWNER_REVIEW") return nc(["EVIDENCE_REQUIRES_OWNER_REVIEW", ...e.warnings.filter((w) => BLOCKING_WARNINGS.has(w))]);
  if (e.is_landed_charge_line) return nc(["LANDED_CHARGE_NOT_ITEM_RATE"]);
  if (e.rate === null || !(e.rate > 0)) return nc(["INVALID_RATE"]);
  if ((opts.projectCurrency ?? "INR").toUpperCase() !== e.currency.toUpperCase()) return nc([`CURRENCY_MISMATCH_NO_FX_RULE:${e.currency}`]);

  // Tax basis → GST-exclusive
  const exclusive = toGstExclusiveRate(e.rate, e.tax_basis, e.gst_rate_percent ?? undefined);
  if (exclusive === null) {
    return nc([e.tax_basis === "GST_INCLUSIVE" ? "GST_RATE_NOT_EXPLICIT" : "TAX_BASIS_UNKNOWN"]);
  }

  // Pack basis → per unit
  let unitRate = exclusive;
  let unitQty = e.quantity;
  let unitUom = e.uom;
  let conversion: string | null = null;
  if (e.pack.rate_per === "UNKNOWN") return nc(["PACK_BASIS_UNKNOWN"]);
  if (e.pack.rate_per === "PACK") {
    if (!(e.pack.pack_quantity && e.pack.pack_quantity > 0) || !e.pack.pack_uom) return nc(["PACK_SIZE_UNKNOWN"]);
    unitRate = exclusive / e.pack.pack_quantity;
    unitQty = e.quantity === null ? null : e.quantity * e.pack.pack_quantity;
    unitUom = e.pack.pack_uom;
    conversion = `PACK:${e.pack.pack_quantity} ${e.pack.pack_uom} per ${e.uom ?? "pack"}`;
  }

  if (!boqUom || !boqUom.trim()) return nc(["BOQ_UOM_MISSING"]);
  if (!unitUom) return nc(["SOURCE_UOM_MISSING"]);
  const src = canonicalWithAliases(unitUom, opts.uomAliases ?? []);
  const dst = canonicalWithAliases(boqUom, opts.uomAliases ?? []);
  if (src.canon && dst.canon && src.canon === dst.canon) {
    return {
      rate_evidence_id: e.rate_evidence_id, status: "COMPARABLE", comparable_rate: round4(unitRate),
      comparable_quantity: unitQty, comparable_uom: dst.canon, reasons,
      conversion_applied: conversion ?? (src.via === "APPROVED_ALIAS" || dst.via === "APPROVED_ALIAS" ? "APPROVED_UOM_ALIAS" : null),
    };
  }
  const conv = convertQuantity(1, unitUom, boqUom, opts.uomConversions ?? [], e.item_id ?? undefined);
  if (conv.ok && conv.ruleApplied) {
    const factor = conv.qty; // 1 source unit = factor BOQ units
    return {
      rate_evidence_id: e.rate_evidence_id, status: "COMPARABLE", comparable_rate: round4(unitRate / factor),
      comparable_quantity: unitQty === null ? null : unitQty * factor, comparable_uom: dst.canon, reasons,
      conversion_applied: `${conversion ? conversion + "; " : ""}APPROVED_RULE:${conv.ruleApplied.fromUom}->${conv.ruleApplied.toUom}×${factor} by ${conv.ruleApplied.approvedBy}`,
    };
  }
  return nc([`UOM_MISMATCH_NO_APPROVED_CONVERSION:${src.canon}->${dst.canon}`]);
}

// ==================== SERIES / VENDOR HISTORY ====================

function sortPoints(points: RateSeriesPoint[]): RateSeriesPoint[] {
  return [...points].sort((a, b) => a.date.localeCompare(b.date) || a.source_record_id.localeCompare(b.source_record_id));
}

export function computeSeries(points: RateSeriesPoint[], family: RateSeriesMetrics["source_family"], uom: string | null): RateSeriesMetrics {
  const pts = sortPoints(points);
  const rates = pts.map((p) => p.rate).sort((a, b) => a - b);
  const n = rates.length;
  const median = n === 0 ? null : n % 2 === 1 ? rates[(n - 1) / 2] : (rates[n / 2 - 1] + rates[n / 2]) / 2;
  const totalQty = pts.reduce((s, p) => s + p.quantity, 0);
  const weighted = totalQty > 0 ? pts.reduce((s, p) => s + p.rate * p.quantity, 0) / totalQty : null;
  return {
    source_family: family,
    uom,
    tax_basis: "GST_EXCLUSIVE",
    count: n,
    points: pts,
    last: n ? pts[n - 1] : null,
    min: n ? rates[0] : null,
    max: n ? rates[n - 1] : null,
    median: median === null ? null : round4(median),
    weighted_average: weighted === null ? null : round4(weighted),
    total_quantity: round4(totalQty),
    is_tender_rate: false,
  };
}

function toPoints(evidence: RateEvidenceRecord[], comparable: Map<string, ComparableRate>, filter: (e: RateEvidenceRecord) => boolean): RateSeriesPoint[] {
  const out: RateSeriesPoint[] = [];
  for (const e of evidence) {
    const c = comparable.get(e.rate_evidence_id);
    if (!c || c.status !== "COMPARABLE" || c.comparable_rate === null || !filter(e)) continue;
    out.push({
      rate_evidence_id: e.rate_evidence_id, source_record_id: e.source_record_id ?? "",
      date: e.source_date ?? "", rate: c.comparable_rate, quantity: c.comparable_quantity ?? 0, vendor_id: e.vendor_id,
    });
  }
  return out;
}

const isVerifiedBill = (e: RateEvidenceRecord) => e.source_type === "BILL_RATE" && e.verification_status === "VERIFIED";
const isUsablePo = (e: RateEvidenceRecord) => e.source_type === "PO_RATE" && (e.verification_status === "VERIFIED" || e.verification_status === "PROVISIONAL");

/** Comparable history per vendor. Ordered by vendor name/id — never by price. */
export function buildVendorHistory(evidence: RateEvidenceRecord[], comparable: Map<string, ComparableRate>, uom: string | null): VendorRateHistory[] {
  const vendors = new Map<string, { id: string | null; name: string | null }>();
  for (const e of evidence) {
    const c = comparable.get(e.rate_evidence_id);
    if (!c || c.status !== "COMPARABLE" || !(isVerifiedBill(e) || isUsablePo(e))) continue;
    vendors.set(e.vendor_id ?? `name:${e.vendor_name}`, { id: e.vendor_id, name: e.vendor_name });
  }
  return [...vendors.entries()]
    .sort(([ka, a], [kb, b]) => (a.name ?? "").localeCompare(b.name ?? "") || ka.localeCompare(kb))
    .map(([key, v]) => {
      const mine = evidence.filter((e) => (e.vendor_id ?? `name:${e.vendor_name}`) === key);
      return {
        vendor_id: v.id,
        vendor_name: v.name,
        bill_series: computeSeries(toPoints(mine, comparable, isVerifiedBill), "ACTUAL_PURCHASE_BILL", uom),
        po_series: computeSeries(toPoints(mine, comparable, isUsablePo), "PURCHASE_ORDER", uom),
      };
    });
}

export function deriveLastPurchaseRate(evidence: RateEvidenceRecord[], comparable: Map<string, ComparableRate>, series: RateSeriesMetrics): LastPurchaseRate | null {
  if (!series.last) return null;
  const e = evidence.find((x) => x.rate_evidence_id === series.last!.rate_evidence_id);
  const c = comparable.get(series.last.rate_evidence_id);
  if (!e || !c || e.rate === null || e.quantity === null || !e.uom || c.comparable_rate === null || !c.comparable_uom) return null;
  return {
    rate_evidence_id: e.rate_evidence_id,
    vendor_id: e.vendor_id,
    vendor_name: e.vendor_name,
    date: e.source_date ?? "",
    quantity: e.quantity,
    rate: e.rate,
    uom: e.uom,
    comparable_rate: c.comparable_rate,
    comparable_uom: c.comparable_uom,
    source_type: "BILL_RATE",
    source_document: e.source_document,
    source_record_id: e.source_record_id ?? "",
    tax_basis: e.tax_basis,
    freight_basis: e.freight_basis,
    age_days: e.age_days,
    freshness: e.freshness,
    same_date_evidence_count: series.points.filter((p) => p.date === series.last!.date).length,
  };
}

/**
 * Best available evidence = highest-precedence VERIFIED tier (actual bill,
 * then committed PO), most recent date — ONLY when safely deterministic:
 * one distinct comparable rate on that date and homogeneous line
 * descriptions. It is an evidence pointer, never a tender rate.
 */
export function selectBestAvailableEvidence(
  evidence: RateEvidenceRecord[],
  comparable: Map<string, ComparableRate>,
): { best: BestAvailableEvidence | null; warnings: string[]; clarifications: string[] } {
  const tiers: Array<(e: RateEvidenceRecord) => boolean> = [
    isVerifiedBill,
    (e) => e.source_type === "PO_RATE" && e.verification_status === "VERIFIED",
  ];
  for (const tier of tiers) {
    const pool = evidence.filter((e) => tier(e) && comparable.get(e.rate_evidence_id)?.status === "COMPARABLE");
    if (!pool.length) continue;
    const descKeys = new Set(pool.map((e) => normalizeNameKey(e.description)));
    if (descKeys.size > 1) {
      return {
        best: null,
        warnings: ["ITEM_SPECIFICATION_HETEROGENEOUS"],
        clarifications: [`Evidence for this item spans ${descKeys.size} distinct line descriptions — estimator must choose evidence matching the BOQ specification.`],
      };
    }
    const latest = pool.map((e) => e.source_date ?? "").sort().pop()!;
    const onLatest = pool.filter((e) => e.source_date === latest);
    const distinctRates = new Set(onLatest.map((e) => comparable.get(e.rate_evidence_id)!.comparable_rate));
    if (distinctRates.size > 1) {
      return { best: null, warnings: ["SAME_DATE_CONFLICTING_EVIDENCE"], clarifications: [`${onLatest.length} conflicting evidence records on ${latest}.`] };
    }
    const pick = [...onLatest].sort((a, b) => (b.source_record_id ?? "").localeCompare(a.source_record_id ?? ""))[0];
    return {
      best: { rate_evidence_id: pick.rate_evidence_id, selection_basis: "EVIDENCE_PRECEDENCE_THEN_RECENCY", use_as_tender_rate: false, decision: "ESTIMATOR_DECISION_REQUIRED" },
      warnings: [],
      clarifications: [],
    };
  }
  return { best: null, warnings: [], clarifications: [] };
}

// ==================== REVIEW / CHECKER HOOKS ====================

export type RateResultPurpose = "EVIDENCE_LOOKUP" | "TENDER_RATE_RECOMMENDATION";

/**
 * Plain lookup = LOW (no checker). Multi-vendor comparison = MEDIUM.
 * Any recommendation feeding a tender rate = HIGH (independent review mandatory,
 * Phase 4A floor via getEstimationReviewHook).
 */
export function getRateReviewHook(result: Pick<BoqLineRateResult, "vendor_history">, purpose: RateResultPurpose): RateReviewHookResult {
  const kind = purpose === "TENDER_RATE_RECOMMENDATION" ? "FINAL_COMMERCIAL_COSTING"
    : result.vendor_history.length > 1 ? "VENDOR_COMPARISON" : "HISTORICAL_RATE_LOOKUP";
  const h = getEstimationReviewHook(kind);
  return { kind, riskLevel: h.riskLevel, reviewRequired: h.reviewRequired, reason: h.reason };
}

export interface CheckerRateReview {
  outcome: "PASS" | "PASS_WITH_NOTES" | "REJECT" | "INSUFFICIENT_EVIDENCE";
  notes?: string;
  /** Anything a checker proposes as a number is discarded. */
  proposedRate?: number | null;
  proposedVendorId?: string | null;
}

/**
 * A checker reviews; it cannot fabricate. A proposed rate / vendor never
 * fills a MISSING_RATE line or changes evidence — it is rejected and logged.
 */
export function applyCheckerReview(result: BoqLineRateResult, review: CheckerRateReview): { result: BoqLineRateResult; fabricationRejected: boolean } {
  const warnings = [...result.warnings];
  const clarifications = [...result.clarifications];
  let rejected = false;
  if (review.proposedRate !== undefined && review.proposedRate !== null) {
    warnings.push("CHECKER_RATE_PROPOSAL_REJECTED");
    rejected = true;
  }
  if (review.proposedVendorId) {
    warnings.push("CHECKER_VENDOR_PROPOSAL_REJECTED");
    rejected = true;
  }
  if (review.outcome === "REJECT" || review.outcome === "INSUFFICIENT_EVIDENCE") {
    clarifications.push(`Independent checker: ${review.outcome}${review.notes ? ` — ${review.notes}` : ""}`);
  }
  return { result: { ...result, warnings, clarifications }, fabricationRejected: rejected };
}

// ==================== BOQ LINE LOOKUP ====================

export interface RateLookupOptions {
  reader: RateSourceReader;
  asOfDate: string;
  projectCurrency?: string;
  freshnessPolicy?: RateFreshnessPolicy | null;
  uomAliases?: UomAliasRule[];
  uomConversions?: UomConversionRule[];
  approvedAliases?: ApprovedItemAlias[];
  aiItemSuggestions?: Record<string, Array<{ item_id: string }>>; // by boq_line_id → CANDIDATE_ONLY
  /** In-memory manual rates keyed by item_id or "BOQ:<boq_line_id>". */
  manualRates?: Array<{ itemKey: string; evidence: RateEvidenceRecord }>;
  store?: RateEvidenceStore | null;
}

interface CacheStats { hits: number; misses: number; invalidated: number }

function nextActions(status: BoqRateStatus): PossibleNextAction[] {
  if (status === "EVIDENCE_AVAILABLE") return [];
  const rfq = checkEstimationAuthority("SEND_VENDOR_RFQ", "rate-lookup", []);
  const actions: PossibleNextAction[] = [];
  if (status === "UNRESOLVED_ITEM" || status === "CANDIDATE_ONLY") {
    actions.push({ action: "OWNER_ITEM_MAPPING", requires_owner_approval: true, executed: false });
  }
  actions.push(
    { action: "OWNER_APPROVED_MANUAL_ASSUMPTION", requires_owner_approval: true, executed: false },
    { action: "VENDOR_RFQ", requires_owner_approval: !rfq.allowed, executed: false },
    { action: "ADDITIONAL_RESEARCH", requires_owner_approval: false, executed: false },
  );
  return actions;
}

function materialize(
  opts: RateLookupOptions,
  itemKey: string,
  built: Array<{ evidence: RateEvidenceRecord; cacheFingerprint: string }>,
  stats: CacheStats,
): RateEvidenceRecord[] {
  const store = opts.store;
  if (!store) return built.map((b) => b.evidence);
  const ctx: BuildCtx = { asOfDate: opts.asOfDate, freshnessPolicy: opts.freshnessPolicy ?? null };
  const valid = store.getValidCache(itemKey);
  const byId = new Map(valid.map((v) => [v.rate_evidence_id, v]));
  const seen = new Set<string>();
  const out: RateEvidenceRecord[] = [];
  for (const b of built) {
    seen.add(b.evidence.rate_evidence_id);
    const cached = byId.get(b.evidence.rate_evidence_id);
    if (cached && cached.source_fingerprint === b.cacheFingerprint) {
      stats.hits++;
      out.push(withFreshness(cached.evidence, ctx)); // age/freshness are as-of dependent
      continue;
    }
    if (cached) {
      store.invalidateCache(cached.cache_id, "SOURCE_FINGERPRINT_CHANGED");
      stats.invalidated++;
    }
    stats.misses++;
    store.putCache(itemKey, b.evidence, b.cacheFingerprint);
    out.push(b.evidence);
  }
  for (const v of valid) {
    if (!seen.has(v.rate_evidence_id)) {
      store.invalidateCache(v.cache_id, "SOURCE_RECORD_MISSING");
      stats.invalidated++;
    }
  }
  return out;
}

function collectSourceEvidence(opts: RateLookupOptions, item: ItemMasterRow, stats: CacheStats): RateEvidenceRecord[] {
  const r = opts.reader;
  const ctx: BuildCtx = { asOfDate: opts.asOfDate, freshnessPolicy: opts.freshnessPolicy ?? null };
  const nameKey = normalizeNameKey(item.name);
  const billRows: Array<{ row: BillLineRow; method: ItemMatchMethod }> = [
    ...r.getBillLinesByItemId(item.item_id).map((row) => ({ row, method: "EXACT_ITEM_ID" as ItemMatchMethod })),
    ...(nameKey ? r.getBillLinesWithoutItemId().filter((row) => normalizeNameKey(row.item_name) === nameKey)
      .map((row) => ({ row, method: "EXACT_NORMALIZED_NAME" as ItemMatchMethod })) : []),
  ];
  const billIds = [...new Set(billRows.map((b) => b.row.bill_id))];
  const landedByBill = new Map<string, LandedChargeRef[]>();
  for (const l of r.getBillLinesForBills(billIds)) {
    if (!isLandedChargeName(l.item_name)) continue;
    landedByBill.set(l.bill_id, [...(landedByBill.get(l.bill_id) ?? []), {
      source_record_id: l.line_item_id, description: l.item_name, amount: l.line_total, source_document: l.bill_number,
    }]);
  }
  const built: Array<{ evidence: RateEvidenceRecord; cacheFingerprint: string }> = [];
  for (const { row, method } of billRows) {
    const landed = (landedByBill.get(row.bill_id) ?? []).filter((x) => x.source_record_id !== row.line_item_id);
    const ev = buildBillEvidence(row, item, method, landed, ctx);
    built.push({ evidence: ev, cacheFingerprint: fingerprintRow({ v: RATE_ENGINE_VERSION, row, landed, method, item: item.item_id }) });
  }
  const poRows = r.getPoLinesByItemId(item.item_id);
  const links = r.getBillLineIdsLinkedToPoLines(poRows.map((p) => p.line_item_id));
  for (const row of poRows) {
    const linked = links.get(row.line_item_id) ?? [];
    const ev = buildPoEvidence(row, item, linked, ctx);
    if (ev) built.push({ evidence: ev, cacheFingerprint: fingerprintRow({ v: RATE_ENGINE_VERSION, row, linked, item: item.item_id }) });
  }
  return materialize(opts, item.item_id, built, stats);
}

export function lookupBoqLineRate(opts: RateLookupOptions, line: BoqLineRateInput, stats: CacheStats = { hits: 0, misses: 0, invalidated: 0 }): BoqLineRateResult {
  if (isZohoWriteAllowed()) throw new Error("ZOHO WRITE = 0 invariant violated");
  const route = routeEstimationTask("RATE_LOOKUP");
  if (route.route !== "DETERMINISTIC" || route.maxModelCalls !== 0) throw new Error("RATE_LOOKUP must be deterministic");

  const match = resolveItemMatch(
    opts.reader,
    { itemId: line.item_id, itemCode: line.item_code, description: line.description },
    opts.approvedAliases ?? [],
    opts.aiItemSuggestions?.[line.boq_line_id] ?? [],
  );
  const warnings: string[] = [];
  const clarifications: string[] = [];
  let evidence: RateEvidenceRecord[] = [];
  if (match.status === "MATCHED" && match.item) {
    evidence = collectSourceEvidence(opts, match.item, stats);
    if (match.method === "EXACT_ITEM_CODE") warnings.push("MATCHED_BY_ITEM_CODE_VERIFY_TENDER_CODE_IS_COMPANY_SKU");
  }
  const manualKeys = new Set([match.item?.item_id, `BOQ:${line.boq_line_id}`].filter(Boolean) as string[]);
  const manual = (opts.manualRates ?? []).filter((m) => manualKeys.has(m.itemKey)).map((m) => m.evidence)
    .concat(opts.store ? opts.store.listManualRates(line.project_id, [...manualKeys]) : []);
  const ctx: BuildCtx = { asOfDate: opts.asOfDate, freshnessPolicy: opts.freshnessPolicy ?? null };
  const seenManual = new Set<string>();
  for (const m of manual) {
    if (seenManual.has(m.rate_evidence_id)) continue;
    seenManual.add(m.rate_evidence_id);
    evidence.push(withFreshness(m, ctx));
  }

  const comparableList = evidence.map((e) => assessComparability(e, line.uom, opts));
  const comparable = new Map(comparableList.map((c) => [c.rate_evidence_id, c]));
  const canonBoqUom = canonicalizeUom(line.uom);
  const billSeries = computeSeries(toPoints(evidence, comparable, isVerifiedBill), "ACTUAL_PURCHASE_BILL", canonBoqUom);
  const poSeries = computeSeries(toPoints(evidence, comparable, isUsablePo), "PURCHASE_ORDER", canonBoqUom);
  const vendorHistory = buildVendorHistory(evidence, comparable, canonBoqUom);
  const last = deriveLastPurchaseRate(evidence, comparable, billSeries);
  const verifiedComparable = evidence.filter((e) => e.verification_status === "VERIFIED" && comparable.get(e.rate_evidence_id)?.status === "COMPARABLE");
  const comparableCount = comparableList.filter((c) => c.status === "COMPARABLE").length;

  let rateStatus: BoqRateStatus;
  if (match.status === "UNRESOLVED" || match.status === "AMBIGUOUS") rateStatus = "UNRESOLVED_ITEM";
  else if (match.status === "CANDIDATE_ONLY") rateStatus = "CANDIDATE_ONLY";
  else if (verifiedComparable.length > 0) rateStatus = "EVIDENCE_AVAILABLE";
  else if (evidence.some((e) => e.source_type === "BILL_RATE" || e.source_type === "PO_RATE") && comparableCount === 0) rateStatus = "RATE_NOT_COMPARABLE";
  else rateStatus = "MISSING_RATE";

  let best: BestAvailableEvidence | null = null;
  if (rateStatus === "EVIDENCE_AVAILABLE") {
    const sel = selectBestAvailableEvidence(evidence, comparable);
    best = sel.best;
    warnings.push(...sel.warnings);
    clarifications.push(...sel.clarifications);
  }
  if (rateStatus === "MISSING_RATE") {
    clarifications.push(`BOQ line ${line.boq_line_id}: no verified comparable rate evidence (MISSING_RATE).`);
    if (comparableCount > 0) warnings.push("ONLY_PROVISIONAL_OR_ASSUMPTION_EVIDENCE");
  }
  if (rateStatus === "RATE_NOT_COMPARABLE") clarifications.push(`BOQ line ${line.boq_line_id}: evidence exists but none is comparable to BOQ UOM "${line.uom ?? ""}" / tax basis.`);
  if (rateStatus === "UNRESOLVED_ITEM") clarifications.push(`BOQ line ${line.boq_line_id}: item could not be resolved (${match.reason}).`);
  if (rateStatus === "CANDIDATE_ONLY") clarifications.push(`BOQ line ${line.boq_line_id}: only candidate item matches — Owner mapping required before rates are used.`);
  if (!opts.freshnessPolicy) warnings.push("FRESHNESS_POLICY_NOT_CONFIGURED");
  if (evidence.some((e) => e.warnings.some((w) => w.startsWith("STALE_BY_POLICY")))) warnings.push("STALE_EVIDENCE_PRESENT");

  const partial = {
    boq_line_id: line.boq_line_id,
    project_id: line.project_id,
    boq_description: line.description,
    boq_uom: line.uom,
    boq_item_code: line.item_code ?? null,
    item_match_status: match.status,
    item_match: match,
    rate_status: rateStatus,
    evidence,
    comparable: comparableList,
    comparable_evidence_count: comparableCount,
    bill_series: billSeries,
    po_series: poSeries,
    vendor_history: vendorHistory,
    last_purchase: last,
    best_available_evidence: best,
    vendor_auto_selected: false as const,
    warnings: [...new Set(warnings)],
    clarifications,
    possible_next_actions: nextActions(rateStatus),
    model_calls: 0 as const,
  };
  return { ...partial, review_hook: getRateReviewHook(partial, "EVIDENCE_LOOKUP") };
}

/** Run a deterministic lookup over BOQ lines. Persists only to estimation.sqlite when a store is given. */
export function runRateLookup(opts: RateLookupOptions & { projectId: string; boqLines: BoqLineRateInput[] }): RateLookupRunSummary {
  const fp = opts.reader.getSourceFingerprints();
  const store = opts.store ?? null;
  const approvedAliases = [...(opts.approvedAliases ?? []), ...(store ? store.listApprovedAliases() : [])];
  const runId = store ? store.startRun(opts.projectId, opts.asOfDate, fp, opts.freshnessPolicy?.policyRef ?? null) : `RLR-${crypto.randomUUID()}`;
  const stats: CacheStats = { hits: 0, misses: 0, invalidated: 0 };
  const results = opts.boqLines.map((l) => lookupBoqLineRate({ ...opts, approvedAliases }, l, stats));
  const summary: RateLookupRunSummary = {
    run_id: runId,
    project_id: opts.projectId,
    as_of_date: opts.asOfDate,
    method: "DETERMINISTIC",
    model_calls: 0,
    boq_line_count: results.length,
    evidence_available_count: results.filter((r) => r.rate_status === "EVIDENCE_AVAILABLE").length,
    missing_rate_count: results.filter((r) => r.rate_status === "MISSING_RATE").length,
    unresolved_count: results.filter((r) => r.rate_status === "UNRESOLVED_ITEM" || r.rate_status === "CANDIDATE_ONLY").length,
    cache_hits: stats.hits,
    cache_misses: stats.misses,
    cache_invalidated: stats.invalidated,
    source_fingerprint_books: fp.books,
    source_fingerprint_audit: fp.audit,
    results,
  };
  if (store) {
    for (const r of results) store.saveSelection(runId, r);
    store.completeRun(summary);
  }
  return summary;
}

/** Load Phase 4C BOQ lines (estimation DB) as rate-lookup inputs. Read-only. */
export function loadBoqLinesForRateLookup(
  db: DatabaseSync,
  projectId: string,
  documentId?: string,
): BoqLineRateInput[] {
  const rows = (documentId
    ? db.prepare("SELECT boq_line_id, project_id, description, uom, item_code FROM estimation_boq_lines WHERE project_id = ? AND document_id = ? ORDER BY boq_line_id").all(projectId, documentId)
    : db.prepare("SELECT boq_line_id, project_id, description, uom, item_code FROM estimation_boq_lines WHERE project_id = ? ORDER BY boq_line_id").all(projectId)) as Record<string, unknown>[];
  return rows.map((r) => ({
    boq_line_id: String(r.boq_line_id),
    project_id: String(r.project_id),
    description: String(r.description),
    uom: r.uom === null || r.uom === undefined ? null : String(r.uom),
    item_code: r.item_code === null || r.item_code === undefined ? null : String(r.item_code),
  }));
}

/** Record an AI item-match suggestion: stored as CANDIDATE only, never a match. */
export function recordAiItemMatchSuggestion(
  store: RateEvidenceStore,
  p: { projectId: string; boqLineId: string; description: string; itemId: string; model: string },
): string {
  return store.addCandidate({
    projectId: p.projectId, boqLineId: p.boqLineId, queryKey: aliasKeyForName(p.description),
    candidateItemId: p.itemId, method: "AI_SUGGESTION", score: null, suggestedBy: `AI:${p.model}`,
    notes: "AI suggestion — CANDIDATE_ONLY until Owner approval.",
  });
}

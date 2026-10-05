// ============================================================
// Bansil Books Analytics — Phase 4A: Estimation & Tender Domain Model
// Pure types + closed enumerations. No I/O, no AI, no DB.
// Later phases (4B–4I) persist / populate these shapes.
// ============================================================

// ==================== SOURCES ====================

/** Truthful availability classification. Never inflate. */
export type SourceAvailability =
  | "VERIFIED_AVAILABLE"
  | "AVAILABLE_PARTIAL"
  | "AVAILABLE_UNVERIFIED"
  | "NOT_AVAILABLE"
  | "FUTURE_CONNECTOR_REQUIRED";

/**
 * Source-of-truth precedence tiers (lower number = higher authority).
 * AI_INFERENCE is the floor and can NEVER produce a factual rate.
 */
export type SourceTier =
  | "CURRENT_TENDER_DOCUMENT"        // 1
  | "OWNER_APPROVED_CLARIFICATION"   // 2
  | "VERIFIED_COMPANY_MASTER"        // 3
  | "VERIFIED_CURRENT_VENDOR_QUOTE"  // 4
  | "VERIFIED_HISTORICAL_PURCHASE"   // 5 (bills = actual purchase)
  | "VERIFIED_HISTORICAL_PO"         // 6
  | "VERIFIED_LIST_OR_CONTRACT_RATE" // 7
  | "APPROVED_ESTIMATOR_ASSUMPTION"  // 8
  | "AI_INFERENCE";                  // 9

// ==================== DOCUMENTS & REVISIONS ====================

export type EstimationDocumentType =
  | "TENDER"
  | "RFQ"
  | "ADDENDUM"
  | "CLARIFICATION"
  | "BOQ"
  | "DRAWING"
  | "SPECIFICATION"
  | "GCC"
  | "SCC"
  | "VENDOR_QUOTATION"
  | "OFFER"
  | "OTHER";

export type DocumentFileFormat = "PDF" | "XLSX" | "XLS" | "CSV" | "DOC" | "DOCX" | "IMAGE" | "OTHER";

export interface EstimationDocument {
  documentId: string;
  projectId: string;
  type: EstimationDocumentType;
  /** Logical document family (e.g. "BOQ"); revisions share a family key. */
  familyKey: string;
  revision: number;
  revisionLabel?: string;         // e.g. "Rev 2", "Addendum 1"
  format: DocumentFileFormat;
  sourceId: string;               // EstimationSourceId it arrived through
  receivedAt: string;             // ISO date
  sha256: string;                 // content fingerprint (64 hex)
  supersededByDocumentId?: string;
  status: "CURRENT" | "SUPERSEDED" | "WITHDRAWN";
}

/** Revision pin carried by every derived output. */
export interface DocumentRevisionRef {
  documentId: string;
  familyKey: string;
  revision: number;
  sha256: string;
}

// ==================== PROJECT ====================

export type TaxBasis = "GST_EXCLUSIVE" | "GST_INCLUSIVE" | "UNKNOWN";

export type SubmissionStatus =
  | "DRAFT"
  | "IN_ESTIMATION"
  | "UNDER_INTERNAL_REVIEW"
  | "AWAITING_OWNER_APPROVAL"
  | "OWNER_APPROVED"
  | "SUBMITTED"   // only after Owner approval + controlled external action (4H)
  | "WITHDRAWN"
  | "CLOSED";

export interface EstimationProject {
  projectId: string;
  tenderReference: string;
  customerName: string;
  customerId?: string;           // only when resolved against verified master
  projectName: string;
  estimateRevision: number;
  dueDate?: string;
  currency: string;              // ISO 4217, e.g. "INR"
  taxBasis: TaxBasis;
  offerValidityDays?: number;    // from tender / Owner — never defaulted silently
  submissionStatus: SubmissionStatus;
}

// ==================== PROVENANCE ====================

/** VALUE → SOURCE → DOCUMENT/DB RECORD → DATE → REVISION → BASIS */
export interface Provenance {
  sourceId: string;
  tier: SourceTier;
  /** Document id, or DB locator such as "bansil_books.purchase_bill_line_items#<line_id>". */
  recordRef: string;
  recordDate: string;            // ISO date of the underlying record
  documentRevision?: DocumentRevisionRef;
  basis?: string;                // free-text basis, e.g. "GST-exclusive taxable line rate"
}

// ==================== SCOPE / BOQ / BOM ====================

export type ClarificationStatus =
  | "OPEN"
  | "REVIEWED"
  | "OWNER_DECISION_REQUIRED"
  | "ACCEPTED"
  | "REJECTED"
  | "INCORPORATED";

export interface ScopeItem {
  scopeId: string;
  description: string;
  category: string;
  inclusion: "INCLUDED" | "EXCLUDED" | "AMBIGUOUS";
  provenance: Provenance;
  clarificationStatus?: ClarificationStatus;
  clarificationId?: string;
}

export interface BoqItem {
  lineNumber: string;
  itemCode?: string;
  description: string;
  quantity: number | null;
  uom: string | null;
  /** Mandatory: where qty and UOM came from. */
  quantityProvenance: Provenance | null;
  requiredSpecification?: string;
  makeBrand?: string;
  technicalNotes?: string;
}

export interface BomComponent {
  parentBoqLine: string;
  componentCode?: string;
  componentDescription: string;
  qtyPerUnit: number;
  uom: string;
  /** Fraction, e.g. 0.05 = 5%. Must be sourced or an approved assumption. */
  wastageFactor: number;
  provenance: Provenance;
}

// ==================== RATES ====================

export type RateClass =
  | "CURRENT_VENDOR_QUOTE"
  | "LAST_PURCHASE_RATE"
  | "HISTORICAL_PURCHASE_RATE"
  | "PO_RATE"
  | "BILL_RATE"
  | "LIST_RATE"
  | "CONTRACT_RATE"
  | "MANUAL_APPROVED_RATE"
  | "PROVISIONAL_RATE";

/**
 * Verification status. Only VERIFIED is factual.
 * AI_INFERENCE can never be promoted to VERIFIED.
 */
export type RateVerificationStatus =
  | "VERIFIED"
  | "ASSUMPTION"
  | "ESTIMATE"
  | "MISSING_RATE"
  | "REQUIRES_OWNER_REVIEW"
  | "AI_INFERENCE";

export type FreightBasis =
  | "EX_WORKS"
  | "FOR_DESTINATION"   // freight included to site
  | "FREIGHT_EXTRA"
  | "UNKNOWN";

export type RateFreshness = "CURRENT" | "AGING" | "STALE" | "UNKNOWN";

export interface ApprovalStamp {
  approvedBy: string;
  approvedAt: string;
}

export interface RateEvidence {
  rateId: string;
  itemRef: string;               // item code / normalized key
  vendorName?: string;
  rateClass: RateClass;
  verificationStatus: RateVerificationStatus;
  rate: number | null;           // per-unit, in `currency`, in `uom`
  currency: string;
  uom: string | null;
  quantityBasis?: number;        // qty on the source record
  taxBasis: TaxBasis;
  gstRatePercent?: number;       // only when present on the source
  freightBasis: FreightBasis;
  rateDate: string | null;       // ISO date of source record
  validUntil?: string;           // vendor-quoted validity
  provenance: Provenance | null;
  /** Mandatory for MANUAL_APPROVED_RATE / PROVISIONAL_RATE / ASSUMPTION. */
  assumption?: CommercialAssumption;
}

// ==================== COST BUILD-UP ====================

export const COST_LAYERS = [
  "MATERIAL",
  "LABOUR",
  "FREIGHT_TRANSPORT",
  "PACKING",
  "TESTING",
  "COMMISSIONING",
  "SITE_EXECUTION",
  "TRAVEL_STAY",
  "TOOLS_TACKLES",
  "INSURANCE_STATUTORY",
  "WARRANTY_PROVISION",
  "FINANCE_CREDIT",
  "OVERHEAD_ALLOCATION",
  "CONTINGENCY",
  "OTHER",
] as const;
export type CostLayer = typeof COST_LAYERS[number];

/** Landed-cost components kept separate from the vendor basic rate. */
export const LANDED_COST_COMPONENTS = [
  "FREIGHT",
  "TRANSPORT",
  "PACKING",
  "LANDING",
  "LOADING_UNLOADING",
  "TRANSIT_INSURANCE",
  "OTHER_LANDED",
] as const;
export type LandedCostComponent = typeof LANDED_COST_COMPONENTS[number];

/** Labour / site sub-categories (structure only in 4A; calculated in 4E). */
export const LABOUR_SITE_CATEGORIES = [
  "ENGINEERING",
  "SUPERVISION",
  "INSTALLATION",
  "TESTING",
  "COMMISSIONING",
  "SITE_LABOUR",
  "TRAVEL",
  "STAY",
  "MOBILIZATION",
  "DEMOBILIZATION",
  "TOOLS",
  "SAFETY",
  "SITE_OVERHEAD",
] as const;
export type LabourSiteCategory = typeof LABOUR_SITE_CATEGORIES[number];

export interface TaxComponents {
  taxableValue: number;
  gstAmount: number;
  /** Input-tax-credit eligible portion — excluded from cost. */
  recoverableTax: number;
  /** Non-creditable tax — part of cost. */
  nonRecoverableTax: number;
  grossValue: number;
}

export interface CostLine {
  costLineId: string;
  layer: CostLayer;
  subCategory?: LabourSiteCategory | LandedCostComponent | string;
  boqLine?: string;
  description: string;
  quantity: number;
  uom: string;
  /** Unit cost, GST-exclusive taxable basis. */
  unitCost: number;
  amount: number;                // quantity × unitCost (taxable basis)
  nonRecoverableTax: number;     // added to cost; recoverable GST never enters cost
  verificationStatus: RateVerificationStatus;
  rateEvidenceId?: string;
  provenance: Provenance | null;
  assumption?: CommercialAssumption;
}

// ==================== ASSUMPTIONS / TERMS / RISK / MARGIN ====================

export type AssumptionApprovalStatus = "PROPOSED" | "OWNER_APPROVED" | "REJECTED";

export interface CommercialAssumption {
  assumptionId: string;
  type: string;                  // e.g. "RATE", "WASTAGE", "MARGIN", "FREIGHT"
  value: string | number;
  basis: string;                 // why — must be non-empty
  approvalStatus: AssumptionApprovalStatus;
  approval?: ApprovalStamp;
  createdAt: string;
}

export const COMMERCIAL_TERM_TYPES = [
  "PAYMENT_TERMS",
  "DELIVERY",
  "VALIDITY",
  "WARRANTY",
  "LIQUIDATED_DAMAGES",
  "PBG",
  "ABG",
  "RETENTION",
  "INSPECTION",
  "TAX",
  "FREIGHT",
  "INSURANCE",
  "SCOPE_EXCLUSIONS",
  "DEVIATIONS",
  "SPECIAL_CONDITIONS",
] as const;
export type CommercialTermType = typeof COMMERCIAL_TERM_TYPES[number];

export interface CommercialTerm {
  termType: CommercialTermType;
  tenderRequirement?: string;    // as stated in tender (with provenance)
  proposedPosition?: string;     // our draft position
  provenance?: Provenance;
  deviationStatus?: ClarificationStatus;
  /** Always false in 4A — no binding commitments. */
  binding: false;
}

export type ClarificationKind = "CLARIFICATION" | "DEVIATION";

/** Who records a clarification decision. Checkers/reviewers never decide business meaning. */
export type ClarificationDeciderRole = "OWNER" | "ESTIMATOR" | "CHECKER" | "REVIEWER";

export interface ClarificationRecord {
  clarificationId: string;
  kind: ClarificationKind;
  subject: string;
  raisedFrom: Provenance;
  status: ClarificationStatus;
  decision?: string;
  decidedBy?: string;
  decidedAt?: string;
  decidedByRole?: ClarificationDeciderRole;
}

export const RISK_CATEGORIES = [
  "TECHNICAL",
  "COMMERCIAL",
  "EXECUTION",
  "SUPPLY",
  "PRICE",
  "SCHEDULE",
  "CASH_FLOW",
  "CONTRACTUAL",
] as const;
export type EstimationRiskCategory = typeof RISK_CATEGORIES[number];

export interface EstimationRisk {
  riskId: string;
  category: EstimationRiskCategory;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  mitigation?: string;
  provenance?: Provenance;
}

/**
 * Margin policy is ALWAYS explicit input — there is no universal default.
 * Exactly one of markupPercent / targetGrossMarginPercent is used.
 */
export interface MarginInput {
  method: "MARKUP_ON_COST" | "GROSS_MARGIN_ON_PRICE";
  percent: number;
  riskLoadingPercent?: number;   // optional, explicit, applied on cost
  assumption: CommercialAssumption; // who set it and why
}

export interface CostSummary {
  byLayer: Record<CostLayer, number>;
  totalEstimatedCost: number;    // GST-exclusive, incl. non-recoverable tax only
  unverifiedLineCount: number;
  missingRateLineCount: number;
  lineCount: number;
}

export interface OfferValuation {
  totalEstimatedCost: number;
  riskLoading: number;
  marginAmount: number;
  proposedOfferValue: number;    // taxable (GST-exclusive) offer value
  grossMarginPercent: number;
  markupPercent: number;
  /** Non-final until Owner approval in 4H. */
  status: "DRAFT_REQUIRES_REVIEW_AND_OWNER_APPROVAL";
}

// ==================== DERIVED OUTPUT FRESHNESS ====================

export interface DerivedOutputStamp {
  outputId: string;
  outputType: "SCOPE_MATRIX" | "BOQ_STRUCTURE" | "RATE_SET" | "COST_BUILDUP" | "OFFER_DRAFT";
  producedAt: string;
  /** Every document revision this output was derived from. */
  usedRevisions: DocumentRevisionRef[];
}

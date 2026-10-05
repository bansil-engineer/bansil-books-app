// ============================================================
// Bansil Books Analytics — Phase 4A: Estimation Source Registry
// Deterministic, source-controlled registry of every source the
// estimation capability may use, with TRUTHFUL availability as
// discovered read-only at baseline 94d90d0 (2026-10-04).
//
// Rules:
//  - Never mark an unavailable source as available.
//  - Every source is READ-ONLY for estimation. Zoho is READ ONLY
//    and ZOHO WRITE = 0 permanently (authority-policy.isZohoWriteAllowed).
//  - Precedence is a fixed tier order; AI_INFERENCE is the floor and
//    can never yield a factual (VERIFIED) rate.
// ============================================================

import { isZohoWriteAllowed } from "../ceo/authority-policy";
import type { SourceAvailability, SourceTier } from "./types";

// ==================== SOURCE-OF-TRUTH HIERARCHY ====================

/** Fixed precedence. Index 0 = highest authority. */
export const SOURCE_TIER_PRECEDENCE: ReadonlyArray<SourceTier> = [
  "CURRENT_TENDER_DOCUMENT",
  "OWNER_APPROVED_CLARIFICATION",
  "VERIFIED_COMPANY_MASTER",
  "VERIFIED_CURRENT_VENDOR_QUOTE",
  "VERIFIED_HISTORICAL_PURCHASE",
  "VERIFIED_HISTORICAL_PO",
  "VERIFIED_LIST_OR_CONTRACT_RATE",
  "APPROVED_ESTIMATOR_ASSUMPTION",
  "AI_INFERENCE",
];

/** 1-based priority rank (1 = highest). Unknown tiers rank last. */
export function getTierRank(tier: SourceTier): number {
  const idx = SOURCE_TIER_PRECEDENCE.indexOf(tier);
  return idx === -1 ? SOURCE_TIER_PRECEDENCE.length + 1 : idx + 1;
}

/** Tiers whose values may be treated as factual commercial evidence. */
export function isFactualTier(tier: SourceTier): boolean {
  return tier !== "AI_INFERENCE" && tier !== "APPROVED_ESTIMATOR_ASSUMPTION";
}

// ==================== REGISTRY ====================

export type EstimationSourceId =
  // Operational data sources
  | "ZOHO_BOOKS_READ_ONLY"
  | "BANSIL_BOOKS_DB"
  | "AUDIT_WORKSPACE_DB"
  | "PRICE_REFERENCE_ENGINE"
  // Capability matrix A–T
  | "A_TENDER_RFQ_UPLOAD"
  | "B_PDF_READING"
  | "C_EXCEL_READING"
  | "D_WORD_READING"
  | "E_DRAWINGS_IMAGES"
  | "F_BOQ_SPREADSHEETS"
  | "G_VENDOR_HISTORICAL_RATES"
  | "H_PURCHASE_ORDER_HISTORY"
  | "I_BILL_HISTORY"
  | "J_CUSTOMER_SO_HISTORY"
  | "K_ITEM_MASTER"
  | "L_UOM"
  | "M_LANDED_COST_EVIDENCE"
  | "N_PREVIOUS_QUOTATIONS"
  | "O_COMMERCIAL_TERMS_TEMPLATES"
  | "P_VENDOR_QUOTATIONS"
  | "Q_LOCAL_FOLDER"
  | "R_EMAIL"
  | "S_ONLINE_PUBLIC_RATES"
  | "T_MANUAL_ESTIMATOR_ASSUMPTIONS";

export interface EstimationSource {
  id: EstimationSourceId;
  label: string;
  availability: SourceAvailability;
  /** Estimation may only read. No source is writable by estimation. */
  readCapability: boolean;
  writeCapability: false;
  /** Precedence tier for values originating here (null = capability, not a value source). */
  tier: SourceTier | null;
  freshness: "LIVE" | "SYNCED_SNAPSHOT" | "PER_DOCUMENT" | "STATIC" | "NONE";
  evidenceCapability: "RECORD_LEVEL" | "DOCUMENT_LEVEL" | "NONE";
  evidence: string;      // what was actually found
  limitation: string;    // what is missing / risky
  nextPhaseUse: string;  // 4B–4I usage
}

export const ESTIMATION_SOURCE_REGISTRY: ReadonlyArray<EstimationSource> = [
  // ---------- Operational data sources ----------
  {
    id: "ZOHO_BOOKS_READ_ONLY", label: "Zoho Books API (read only)",
    availability: "AVAILABLE_UNVERIFIED", readCapability: true, writeCapability: false,
    tier: "VERIFIED_COMPANY_MASTER", freshness: "LIVE", evidenceCapability: "RECORD_LEVEL",
    evidence: "Read-only Zoho connector exists (app/api/zoho/*); isZohoWriteAllowed() === false.",
    limitation: "Not called in Phase 4A (no live verification). ZOHO WRITE = 0 permanently.",
    nextPhaseUse: "4D: only via existing Smart Sync snapshots; never written.",
  },
  {
    id: "BANSIL_BOOKS_DB", label: "data/bansil_books.db (business snapshot)",
    availability: "VERIFIED_AVAILABLE", readCapability: true, writeCapability: false,
    tier: "VERIFIED_HISTORICAL_PURCHASE", freshness: "SYNCED_SNAPSHOT", evidenceCapability: "RECORD_LEVEL",
    evidence: "purchase_bills 3097 (2022-04-01..2026-09-26, 369 vendors); purchase_bill_line_items 6851; sales_invoices 1136; sales_invoice_line_items 4025.",
    limitation: "No item/vendor/PO/SO tables; bill→PO link populated on 0 bills; line unit on 54%; no per-line GST fields.",
    nextPhaseUse: "4D historical bill rates (GST-exclusive taxable line rate).",
  },
  {
    id: "AUDIT_WORKSPACE_DB", label: "data/audit_workspace.db (audit snapshot)",
    availability: "VERIFIED_AVAILABLE", readCapability: true, writeCapability: false,
    tier: "VERIFIED_COMPANY_MASTER", freshness: "SYNCED_SNAPSHOT", evidenceCapability: "RECORD_LEVEL",
    evidence: "audit_item_master 601; audit_purchase_orders 813 / lines 2789; audit_sales_orders 253; audit_zoho_bills 285; audit_zoho_expenses 606.",
    limitation: "BOM / item-mapping tables exist but contain 0 rows; PO history starts 2025-04-01.",
    nextPhaseUse: "4C item master / UOM lookup; 4D PO rates.",
  },
  {
    id: "PRICE_REFERENCE_ENGINE", label: "app/lib/price-reference-engine.ts (read-only, Reports-locked)",
    availability: "VERIFIED_AVAILABLE", readCapability: true, writeCapability: false,
    tier: "VERIFIED_HISTORICAL_PURCHASE", freshness: "SYNCED_SNAPSHOT", evidenceCapability: "RECORD_LEVEL",
    evidence: "getPriceReferenceData(): taxable pre-GST latest/lowest/highest/weighted rates with per-line evidence (doc no, date, vendor, qty).",
    limitation: "Shared with LOCKED Reports module — consume only, never modify.",
    nextPhaseUse: "4D rate engine consumes it as a read-only evidence provider.",
  },

  // ---------- Capability matrix A–T ----------
  {
    id: "A_TENDER_RFQ_UPLOAD", label: "Tender / RFQ document upload",
    availability: "AVAILABLE_PARTIAL", readCapability: true, writeCapability: false,
    tier: "CURRENT_TENDER_DOCUMENT", freshness: "PER_DOCUMENT", evidenceCapability: "DOCUMENT_LEVEL",
    evidence: "Audit intake stores immutable uploads with SHA256 (app/lib/audit/intake/file-storage.ts, intake-service.ts).",
    limitation: "No estimation/tender intake route; accepted types PDF/XLSX/CSV only.",
    nextPhaseUse: "4B tender intake reuses storage + SHA256 pattern.",
  },
  {
    id: "B_PDF_READING", label: "PDF reading",
    availability: "AVAILABLE_PARTIAL", readCapability: true, writeCapability: false,
    tier: null, freshness: "PER_DOCUMENT", evidenceCapability: "DOCUMENT_LEVEL",
    evidence: "extractPdfText() in app/lib/audit/intake/pdf-text-extractor.ts (digital text layer).",
    limitation: "No OCR: scanned pages return OCR_REQUIRED; encrypted PDFs unsupported.",
    nextPhaseUse: "4B digital tender PDFs.",
  },
  {
    id: "C_EXCEL_READING", label: "Excel reading",
    availability: "VERIFIED_AVAILABLE", readCapability: true, writeCapability: false,
    tier: null, freshness: "PER_DOCUMENT", evidenceCapability: "DOCUMENT_LEVEL",
    evidence: "parseXlsxBuffer() in app/lib/audit/intake/xlsx-reader.ts (XLSX; exercised by Phase 4A tests).",
    limitation: "Legacy .xls is intentionally rejected; formulas preserved as text, not evaluated.",
    nextPhaseUse: "4B/4C BOQ spreadsheets.",
  },
  {
    id: "D_WORD_READING", label: "Word / DOC / DOCX reading",
    availability: "NOT_AVAILABLE", readCapability: false, writeCapability: false,
    tier: null, freshness: "NONE", evidenceCapability: "NONE",
    evidence: "file-storage.ts detectFileType(): DOCX intentionally not accepted.",
    limitation: "No parser present.",
    nextPhaseUse: "4B decision: add parser or require PDF.",
  },
  {
    id: "E_DRAWINGS_IMAGES", label: "Drawings / image-based technical documents",
    availability: "NOT_AVAILABLE", readCapability: false, writeCapability: false,
    tier: null, freshness: "NONE", evidenceCapability: "NONE",
    evidence: "No OCR or image pipeline in repository; images not accepted by intake.",
    limitation: "Quantities must never be inferred from drawings by AI without verified extraction.",
    nextPhaseUse: "Future connector; manual BOQ entry until then.",
  },
  {
    id: "F_BOQ_SPREADSHEETS", label: "BOQ spreadsheets",
    availability: "AVAILABLE_PARTIAL", readCapability: true, writeCapability: false,
    tier: "CURRENT_TENDER_DOCUMENT", freshness: "PER_DOCUMENT", evidenceCapability: "DOCUMENT_LEVEL",
    evidence: "XLSX cells readable via parseXlsxBuffer().",
    limitation: "No BOQ column mapping / structuring exists.",
    nextPhaseUse: "4C BOQ extraction.",
  },
  {
    id: "G_VENDOR_HISTORICAL_RATES", label: "Vendor historical rates",
    availability: "AVAILABLE_PARTIAL", readCapability: true, writeCapability: false,
    tier: "VERIFIED_HISTORICAL_PURCHASE", freshness: "SYNCED_SNAPSHOT", evidenceCapability: "RECORD_LEVEL",
    evidence: "purchase_bill_line_items rate/qty/vendor/date; header total ≈ Σline_total × 1.18 ⇒ line rate is GST-exclusive.",
    limitation: "Unit missing on 46% of bill lines (rate unusable without UOM); inconsistent unit casing; 21 lines qty×rate≠line_total.",
    nextPhaseUse: "4D rate engine with UOM gate.",
  },
  {
    id: "H_PURCHASE_ORDER_HISTORY", label: "Purchase order history",
    availability: "VERIFIED_AVAILABLE", readCapability: true, writeCapability: false,
    tier: "VERIFIED_HISTORICAL_PO", freshness: "SYNCED_SNAPSHOT", evidenceCapability: "RECORD_LEVEL",
    evidence: "audit_purchase_orders 813 (2025-04-01..2026-10-03, 134 vendors); lines 2789 (unit 98%).",
    limitation: "Only FY2025-26 onward; mixed statuses (filter required).",
    nextPhaseUse: "4D PO_RATE evidence.",
  },
  {
    id: "I_BILL_HISTORY", label: "Bill history",
    availability: "VERIFIED_AVAILABLE", readCapability: true, writeCapability: false,
    tier: "VERIFIED_HISTORICAL_PURCHASE", freshness: "SYNCED_SNAPSHOT", evidenceCapability: "RECORD_LEVEL",
    evidence: "purchase_bills 3097 / lines 6851 (bansil_books.db); audit_zoho_bills 285 / lines 607.",
    limitation: "Bill→PO linkage absent (0 populated).",
    nextPhaseUse: "4D BILL_RATE / LAST_PURCHASE_RATE.",
  },
  {
    id: "J_CUSTOMER_SO_HISTORY", label: "Customer / sales order history",
    availability: "VERIFIED_AVAILABLE", readCapability: true, writeCapability: false,
    tier: "VERIFIED_COMPANY_MASTER", freshness: "SYNCED_SNAPSHOT", evidenceCapability: "RECORD_LEVEL",
    evidence: "sales_invoices 1136 (97 customers) / lines 4025; audit_sales_orders 253; audit_zoho_sales_orders 221 / lines 1821.",
    limitation: "Invoice→SO link on 113/1136 invoices only.",
    nextPhaseUse: "4D customer-wise selling-rate reference; 4I actual-vs-estimate.",
  },
  {
    id: "K_ITEM_MASTER", label: "Item master",
    availability: "VERIFIED_AVAILABLE", readCapability: true, writeCapability: false,
    tier: "VERIFIED_COMPANY_MASTER", freshness: "SYNCED_SNAPSHOT", evidenceCapability: "RECORD_LEVEL",
    evidence: "audit_item_master 601 items (unit on 591).",
    limitation: "Item `rate` is Zoho sales/list rate (331 items > 0), NOT a purchase rate.",
    nextPhaseUse: "4C item resolution; LIST_RATE only.",
  },
  {
    id: "L_UOM", label: "Units of measure",
    availability: "AVAILABLE_PARTIAL", readCapability: true, writeCapability: false,
    tier: "VERIFIED_COMPANY_MASTER", freshness: "SYNCED_SNAPSHOT", evidenceCapability: "RECORD_LEVEL",
    evidence: "Item master unit 591/601; PO lines 98%; bill lines 54%.",
    limitation: "No UOM conversion table exists; only case/spelling canonicalization is safe.",
    nextPhaseUse: "4C/4D: conversions only via Owner-validated rules.",
  },
  {
    id: "M_LANDED_COST_EVIDENCE", label: "Freight / packing / landed-cost evidence",
    availability: "AVAILABLE_PARTIAL", readCapability: true, writeCapability: false,
    tier: "VERIFIED_HISTORICAL_PURCHASE", freshness: "SYNCED_SNAPSHOT", evidenceCapability: "RECORD_LEVEL",
    evidence: "~212 bill lines keyword-match freight/transport/packing (item_name/description); Transportation/Site expense accounts in audit_zoho_expenses.",
    limitation: "Not allocated to items; no landed-cost allocation records.",
    nextPhaseUse: "4E landed-cost layer as separate lines.",
  },
  {
    id: "N_PREVIOUS_QUOTATIONS", label: "Previous quotations / offers",
    availability: "NOT_AVAILABLE", readCapability: false, writeCapability: false,
    tier: null, freshness: "NONE", evidenceCapability: "NONE",
    evidence: "No estimate/quotation/offer tables in bansil_books.db or audit_workspace.db.",
    limitation: "No historical offer baseline.",
    nextPhaseUse: "4G will create offers; 4I learns from them.",
  },
  {
    id: "O_COMMERCIAL_TERMS_TEMPLATES", label: "Company commercial terms / templates",
    availability: "NOT_AVAILABLE", readCapability: false, writeCapability: false,
    tier: null, freshness: "NONE", evidenceCapability: "NONE",
    evidence: "No terms/template tables or files found.",
    limitation: "Owner must supply standard terms.",
    nextPhaseUse: "4G offer pack (Owner-provided).",
  },
  {
    id: "P_VENDOR_QUOTATIONS", label: "Vendor quotations",
    availability: "NOT_AVAILABLE", readCapability: false, writeCapability: false,
    tier: "VERIFIED_CURRENT_VENDOR_QUOTE", freshness: "NONE", evidenceCapability: "NONE",
    evidence: "No vendor-quotation store.",
    limitation: "CURRENT_VENDOR_QUOTE rates cannot be produced until intake exists.",
    nextPhaseUse: "4B intake + 4D CURRENT_VENDOR_QUOTE.",
  },
  {
    id: "Q_LOCAL_FOLDER", label: "Local folder source",
    availability: "FUTURE_CONNECTOR_REQUIRED", readCapability: false, writeCapability: false,
    tier: null, freshness: "NONE", evidenceCapability: "NONE",
    evidence: "No folder-watch/ingest connector; reference/ holds one reconciliation xlsx (not a tender source).",
    limitation: "Manual upload only.",
    nextPhaseUse: "Optional future connector.",
  },
  {
    id: "R_EMAIL", label: "Email source",
    availability: "FUTURE_CONNECTOR_REQUIRED", readCapability: false, writeCapability: false,
    tier: null, freshness: "NONE", evidenceCapability: "NONE",
    evidence: "No email connector in repository.",
    limitation: "External send also requires Owner approval (4H).",
    nextPhaseUse: "Future connector.",
  },
  {
    id: "S_ONLINE_PUBLIC_RATES", label: "Online / public rate source",
    availability: "NOT_AVAILABLE", readCapability: false, writeCapability: false,
    tier: null, freshness: "NONE", evidenceCapability: "NONE",
    evidence: "tool-executor web_research_tool is a stub (no fetch); no rate feed.",
    limitation: "Must not be presented as available.",
    nextPhaseUse: "None planned.",
  },
  {
    id: "T_MANUAL_ESTIMATOR_ASSUMPTIONS", label: "Manually entered estimator assumptions",
    availability: "AVAILABLE_PARTIAL", readCapability: true, writeCapability: false,
    tier: "APPROVED_ESTIMATOR_ASSUMPTION", freshness: "PER_DOCUMENT", evidenceCapability: "DOCUMENT_LEVEL",
    evidence: "Phase 4A CommercialAssumption contract + approval validation (app/lib/ai/estimation).",
    limitation: "No capture UI or persistence yet.",
    nextPhaseUse: "4E/4F assumption capture with Owner approval.",
  },
];

const REGISTRY_BY_ID = new Map<EstimationSourceId, EstimationSource>(
  ESTIMATION_SOURCE_REGISTRY.map((s) => [s.id, s]),
);

export function getEstimationSource(id: EstimationSourceId): EstimationSource | undefined {
  return REGISTRY_BY_ID.get(id);
}

/** Only sources that can actually be read today (VERIFIED or PARTIAL). */
export function isSourceUsable(id: EstimationSourceId): boolean {
  const s = REGISTRY_BY_ID.get(id);
  if (!s || !s.readCapability) return false;
  return s.availability === "VERIFIED_AVAILABLE" || s.availability === "AVAILABLE_PARTIAL";
}

export function listSourcesByAvailability(a: SourceAvailability): EstimationSource[] {
  return ESTIMATION_SOURCE_REGISTRY.filter((s) => s.availability === a);
}

/**
 * Deterministic ordering of sources by precedence tier, then id.
 * Capability-only sources (tier null) sort after value sources.
 */
export function sortSourcesByPriority(ids: EstimationSourceId[]): EstimationSourceId[] {
  const rank = (id: EstimationSourceId) => {
    const t = REGISTRY_BY_ID.get(id)?.tier;
    return t ? getTierRank(t) : 99;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Estimation never writes to any source. Zoho write is permanently
 * disabled; this throws if anything ever tries to request write access.
 */
export function assertEstimationReadOnly(id: EstimationSourceId, requestWrite: boolean): void {
  const s = REGISTRY_BY_ID.get(id);
  if (!s) throw new Error(`Unknown estimation source: ${id}`);
  if (requestWrite || s.writeCapability !== false || (id === "ZOHO_BOOKS_READ_ONLY" && isZohoWriteAllowed())) {
    throw new Error(`ESTIMATION_READ_ONLY: write access to ${id} is prohibited (ZOHO WRITE = 0).`);
  }
}

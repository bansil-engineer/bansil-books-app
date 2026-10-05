// ============================================================
// Bansil Books Analytics — Item Traceability Phase 1 Types
// Zoho / the approved Zoho ecosystem is MASTER DATA. Bansil Audit only
// reads, inspects, cross-verifies, reconciles, and alerts — it never
// authors Sales Orders, Purchase Orders, Bills, Invoices, or Items.
// ============================================================

export const TRACEABILITY_SOURCE_KEYS = ["SALES_ORDER", "PURCHASE_ORDER", "ITEM_MASTER"] as const;
export type TraceabilitySourceKey = (typeof TRACEABILITY_SOURCE_KEYS)[number];

export const DOC_TYPES = ["SALES_ORDER", "PURCHASE_ORDER", "PURCHASE_BILL", "SALES_INVOICE"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const MATCH_METHODS = [
  "NATIVE_LINE_LINKAGE", // a real Zoho-provided line-level field (e.g. PO line's salesorder_item_id) — the single highest-priority tier, ahead of every heuristic
  "EXPLICIT_LINKAGE", // document-number-level proxy (e.g. PO reference_number == SO salesorder_number) — used only when no native line-level field is populated
  "ITEM_ID",
  "SKU",
  "OWNER_APPROVED_MAPPING",
  "BOM_RELATIONSHIP",
  "DESCRIPTION_CANDIDATE",
  "MANUAL_REVIEW",
] as const;
export type TraceabilityMatchMethod = (typeof MATCH_METHODS)[number];

export const TRACEABILITY_ALERT_TYPES = [
  "SO_NOT_INVOICED",
  "SO_ITEM_NOT_PROCURED",
  "SO_PARTIALLY_PROCURED",
  "OVER_PROCURED",
  "PO_NOT_BILLED",
  "PO_PARTIALLY_BILLED",
  "BILL_EXCEEDS_PO",
  "INVOICE_EXCEEDS_SO",
  "WRONG_ITEM",
  "SKU_MISMATCH",
  "UOM_MISMATCH",
  "UOM_NOT_AVAILABLE",
  "RATE_MISMATCH",
  "UNLINKED_PO_ITEM",
  "UNLINKED_BILL_ITEM",
  "UNLINKED_INVOICE_ITEM",
  "DUPLICATE_CONSUMPTION",
  "UNAPPROVED_SUBSTITUTION",
  "AMBIGUOUS_ITEM_MATCH",
] as const;
export type TraceabilityAlertType = (typeof TRACEABILITY_ALERT_TYPES)[number];

export const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const DETECTION_STATES = ["AUTO_DETECTED", "REVIEW_REQUIRED", "PROFESSIONAL_REVIEW_REQUIRED", "NOT_TESTED", "NOT_AVAILABLE"] as const;
export type DetectionState = (typeof DETECTION_STATES)[number];

export interface SalesOrderLineRecord {
  line_item_id: string;
  salesorder_id: string;
  item_id: string | null;
  sku: string | null;
  description: string | null;
  quantity: string;
  unit: string | null;
  rate: string | null;
  amount: string | null;
  item_order: number | null;
}

export interface SalesOrderRecord {
  salesorder_id: string;
  organization_id: string;
  salesorder_number: string | null;
  customer_id: string | null;
  customer_name: string | null;
  date: string | null;
  status: string | null;
  reference_number: string | null;
  total: string | null;
  last_modified_time: string | null;
}

export interface PurchaseOrderLineRecord {
  line_item_id: string;
  purchaseorder_id: string;
  item_id: string | null;
  sku: string | null;
  description: string | null;
  quantity: string;
  unit: string | null;
  rate: string | null;
  amount: string | null;
  item_order: number | null;
  salesorder_item_id: string | null;
}

export interface PurchaseOrderRecord {
  purchaseorder_id: string;
  organization_id: string;
  purchaseorder_number: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  date: string | null;
  status: string | null;
  reference_number: string | null;
  total: string | null;
  last_modified_time: string | null;
}

export interface ItemMasterRecord {
  item_id: string;
  organization_id: string;
  name: string | null;
  sku: string | null;
  unit: string | null;
  status: string | null;
  rate: string | null;
  item_type: string | null;
  product_type: string | null;
  last_modified_time: string | null;
}

export interface TraceabilityLink {
  fromDocType: DocType;
  fromDocId: string;
  fromLineId: string;
  toDocType: DocType;
  toDocId: string;
  toLineId: string;
  itemId: string | null;
  matchMethod: TraceabilityMatchMethod;
  allocatedQty: number;
}

export interface ChainSummary {
  soLineId: string;
  itemId: string | null;
  requiredQty: number;
  orderedQty: number;
  purchasedQty: number;
  billedQty: number;
  invoicedQty: number;
  allocatedQty: number;
  remainingQty: number;
  excessQty: number;
}

export interface TraceabilityAlertDraft {
  alertType: TraceabilityAlertType;
  entityType: "SO_LINE" | "PO_LINE" | "BILL_LINE" | "INVOICE_LINE";
  entityId: string;
  ruleId: string;
  severity: Severity;
  detectionState: DetectionState;
  title: string;
  description: string;
  affectedQty: number | null;
  affectedAmount: number | null;
  evidence: Record<string, unknown>;
  recommendedAction: string;
  zohoModifiedAt: string | null;
  dedupKey: string;
}

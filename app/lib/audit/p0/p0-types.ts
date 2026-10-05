// ============================================================
// Bansil Books Analytics — Phase F.0 P0 Types (360° Accounting Audit)
// Read-only, deterministic, no external AI. See MASTER_360_ACCOUNTING_
// AUDIT_REQUIREMENTS.md for the full design this implements.
// ============================================================

export const P0_SOURCE_KEYS = [
  "BANK",
  "GL",
  "CUSTOMER_OUTSTANDING",
  "VENDOR_OUTSTANDING",
  "CUSTOMER_PAYMENTS",
  "VENDOR_PAYMENTS",
  "JOURNALS",
] as const;
export type P0SourceKey = (typeof P0_SOURCE_KEYS)[number];

/**
 * Sources that require a Zoho OAuth READ scope NOT in
 * APPROVED_ZOHO_READ_SCOPES (app/lib/zoho-security-guard.ts). Per the
 * owner's explicit Phase F.0 instruction, any such source is STOPPED —
 * no adapter is implemented, no scope is requested, and the source is
 * registered NOT_IMPLEMENTED / NOT_AVAILABLE until a separate, explicit
 * owner approval for that scope is given.
 */
export const P0_SOURCES_BLOCKED_ON_NEW_SCOPE: Readonly<Record<string, string>> = Object.freeze({
  BANK: "requires ZohoBooks.banking.READ — not in APPROVED_ZOHO_READ_SCOPES",
  GL: "requires GL/account-transactions endpoint scope confirmation — not verified against APPROVED_ZOHO_READ_SCOPES",
  CUSTOMER_PAYMENTS: "requires ZohoBooks.customerpayments.READ — not in APPROVED_ZOHO_READ_SCOPES",
  VENDOR_PAYMENTS: "requires ZohoBooks.vendorpayments.READ — not in APPROVED_ZOHO_READ_SCOPES",
  JOURNALS: "requires ZohoBooks.journals.READ — not in APPROVED_ZOHO_READ_SCOPES",
});

export const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const DETECTION_STATES = [
  "AUTO_DETECTED",
  "REVIEW_REQUIRED",
  "PROFESSIONAL_REVIEW_REQUIRED",
  "NOT_TESTED",
  "NOT_AVAILABLE",
] as const;
export type DetectionState = (typeof DETECTION_STATES)[number];

export interface AgeingBuckets {
  bucket0to30: string;
  bucket31to60: string;
  bucket61to90: string;
  bucket90plus: string;
}

export interface P0Alert {
  alertId: string;
  sourceKey: P0SourceKey;
  entityType: "INVOICE" | "BILL" | "CUSTOMER" | "VENDOR";
  entityId: string;
  ruleId: string;
  severity: Severity;
  detectionState: DetectionState;
  title: string;
  description: string;
  affectedAmount: string | null;
  evidence: Record<string, unknown>;
  recommendedAction: string;
  requiresProfessionalReview: boolean;
  zohoModifiedAt: string | null;
  fetchedAt: string;
  checkedAt: string;
  alertCreatedAt: string;
  dedupKey: string;
}

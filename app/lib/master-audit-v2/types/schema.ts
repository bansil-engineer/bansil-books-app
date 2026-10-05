/** Phase 1 contracts only. No legacy imports, network client or UI. */
export type DocumentType = "SO" | "PO" | "INVOICE" | "BILL" | "CREDIT_NOTE" | "VENDOR_CREDIT" | "CUSTOMER_PAYMENT" | "VENDOR_PAYMENT" | "STOCK_ADJUSTMENT" | "ASSEMBLY";
export type SyncState = "NEW" | "UNCHANGED" | "CHANGED" | "INCOMPLETE";
export type EvidenceValue = { value: string; scale: number; missingReason: null } | { value: null; scale: null; missingReason: string };
export interface DocumentIdentity { organizationId: string; documentType: DocumentType; remoteId: string }
export interface VersionIdentity { organizationId: string; documentId: string; versionId: string }
export interface SourceVersion extends VersionIdentity {
  revision: string | null; observedAt: string; documentDate: string;
  rawPayload: string; payloadSha256: string; expectedLineCount: number;
}
/** Discriminated contract prevents UNCHANGED from requesting detail. */
export type SyncClassification =
  | { state: "UNCHANGED"; reason: string; detailRequired: false }
  | { state: "NEW" | "CHANGED" | "INCOMPLETE"; reason: string; detailRequired: true };
export const FOUNDATION_SCHEMA_VERSION = 1;
export const TARGET_DB_RELATIVE_PATH = "data/master-audit-v2/db/master-audit-v2.sqlite";

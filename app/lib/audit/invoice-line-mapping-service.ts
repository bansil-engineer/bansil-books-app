// ============================================================
// Bansil Books Analytics — Invoice↔SO Line Mapping Service (R1A)
//
// OWNER-approved local mapping: one Invoice line → one SO line.
// Many Invoice lines may map to the same SO line (partial billing).
// A single Invoice line may NOT have multiple simultaneously
// non-revoked mappings.
//
// Identity is always stable source IDs (line_item_id), never
// human display Sr.No.
//
// ZOHO WRITE = 0. No network calls. Pure local SQLite operations.
// ============================================================

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

// ── Types ──────────────────────────────────────────────────

export type InvoiceMappingKind = "OWNER_FALLBACK" | "OWNER_OVERRIDE";
export type InvoiceMappingStatus = "ACTIVE" | "REVIEW_REQUIRED" | "REVOKED";
export type InvoiceStaleResult = "VALID" | "REVIEW_REQUIRED" | "MISSING_LINE";

export type InvoiceMappingHistoryEvent =
  | "MAPPING_CREATED"
  | "MAPPING_MARKED_REVIEW_REQUIRED"
  | "MAPPING_RECONFIRMED"
  | "MAPPING_REVOKED";

export interface InvoiceLineMappingRecord {
  mapping_id: string;
  organization_id: string;
  invoice_id: string;
  invoice_line_item_id: string;
  salesorder_id: string;
  so_line_item_id: string;
  mapping_kind: InvoiceMappingKind;
  status: InvoiceMappingStatus;
  invoice_fingerprint: string;
  so_fingerprint: string;
  decision_source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  review_required_at: string | null;
  revoked_at: string | null;
}

export interface InvoiceLineMappingHistoryRecord {
  history_id: string;
  mapping_id: string;
  event_type: InvoiceMappingHistoryEvent;
  previous_status: string | null;
  new_status: string;
  occurred_at: string;
  note: string | null;
}

export type CreateInvoiceMappingResult =
  | { outcome: "CREATED"; mapping: InvoiceLineMappingRecord }
  | { outcome: "DUPLICATE"; mapping: InvoiceLineMappingRecord }
  | { outcome: "CONFLICT"; existing: InvoiceLineMappingRecord }
  | { outcome: "VALIDATION_FAILED"; reason: string };

export type RevokeInvoiceMappingResult =
  | { outcome: "REVOKED"; mapping: InvoiceLineMappingRecord }
  | { outcome: "ALREADY_REVOKED"; mapping: InvoiceLineMappingRecord }
  | { outcome: "NOT_FOUND" };

export type ReconfirmInvoiceMappingResult =
  | { outcome: "RECONFIRMED"; mapping: InvoiceLineMappingRecord }
  | { outcome: "VALIDATION_FAILED"; reason: string }
  | { outcome: "NOT_REVIEW_REQUIRED"; mapping: InvoiceLineMappingRecord }
  | { outcome: "NOT_FOUND" };

// ── Fingerprint ────────────────────────────────────────────

/** Fields included in Invoice/SO line fingerprint computation */
const FINGERPRINT_FIELDS = [
  "line_item_id",
  "item_id",
  "item_name",
  "description",
  "quantity",
  "rate",
  "unit",
] as const;

export interface InvoiceLineEvidence {
  line_item_id: string | null;
  item_id: string | null;
  item_name: string | null;
  description: string | null;
  quantity: number | null;
  rate: number | null;
  unit: string | null;
}

/**
 * Compute a deterministic SHA-256 fingerprint for a line's business evidence.
 *
 * Normalization:
 *  - null stays null (serialized as JSON null)
 *  - strings are trimmed
 *  - numbers use JSON serialization (no arbitrary rounding)
 *  - property order is fixed (FINGERPRINT_FIELDS order)
 *
 * Excluded: rowid, human display Sr.No, fetched_at, source_run_id
 */
export function computeInvoiceLineFingerprint(line: InvoiceLineEvidence): string {
  const canonical: Record<string, string | number | null> = {};
  for (const field of FINGERPRINT_FIELDS) {
    const val = line[field];
    if (val === null || val === undefined) {
      canonical[field] = null;
    } else if (typeof val === "string") {
      canonical[field] = val.trim();
    } else {
      canonical[field] = val;
    }
  }
  const serialized = JSON.stringify(canonical);
  return createHash("sha256").update(serialized).digest("hex");
}

// ── Local Line Retrieval ───────────────────────────────────

/**
 * Retrieve the current Invoice line evidence from the newest coherent
 * invoice snapshot.
 *
 * Follows the same Phase-3 coherent snapshot pattern as PO mapping:
 *  1. Resolve the newest HEADER (audit_zoho_invoices) for the invoice_id,
 *     ordered by fetched_at DESC (rowid DESC tie-break).
 *  2. Look up the line ONLY inside that header's source_run_id.
 *  3. If the line is absent from that snapshot → null (MISSING_LINE).
 *
 * Legacy: when no header snapshot exists, fall back to line-level lookup.
 */
function getLocalInvoiceLine(
  db: DatabaseSync,
  orgId: string,
  invoiceId: string,
  invoiceLineItemId: string
): InvoiceLineEvidence | null {
  const header = db
    .prepare(
      `SELECT source_run_id FROM audit_zoho_invoices
       WHERE organization_id = ? AND invoice_id = ?
       ORDER BY fetched_at DESC, rowid DESC LIMIT 1`
    )
    .get(orgId, invoiceId) as unknown as { source_run_id: string } | undefined;

  let row: (InvoiceLineEvidence & Record<string, unknown>) | undefined;
  if (header) {
    row = db
      .prepare(
        `SELECT line_item_id, item_id, item_name, description, quantity, rate, unit, invoice_id
         FROM audit_zoho_invoice_lines
         WHERE organization_id = ? AND invoice_id = ? AND source_run_id = ? AND line_item_id = ?
         LIMIT 1`
      )
      .get(orgId, invoiceId, header.source_run_id, invoiceLineItemId) as unknown as
      (InvoiceLineEvidence & Record<string, unknown>) | undefined;
    if (!row) return null;
  } else {
    row = db
      .prepare(
        `SELECT line_item_id, item_id, item_name, description, quantity, rate, unit, invoice_id
         FROM audit_zoho_invoice_lines
         WHERE organization_id = ? AND line_item_id = ?
         ORDER BY rowid DESC LIMIT 1`
      )
      .get(orgId, invoiceLineItemId) as unknown as
      (InvoiceLineEvidence & Record<string, unknown>) | undefined;
    if (!row) return null;
    if (row.invoice_id !== invoiceId) return null;
  }

  return {
    line_item_id: row.line_item_id,
    item_id: row.item_id,
    item_name: row.item_name,
    description: row.description,
    quantity: row.quantity,
    rate: row.rate,
    unit: row.unit,
  };
}

/** Current SO line evidence from the newest coherent SO snapshot. */
function getLocalSoLine(
  db: DatabaseSync,
  orgId: string,
  salesorderId: string,
  soLineItemId: string
): InvoiceLineEvidence | null {
  const header = db
    .prepare(
      `SELECT source_run_id FROM audit_zoho_sales_orders
       WHERE organization_id = ? AND salesorder_id = ?
       ORDER BY fetched_at DESC, rowid DESC LIMIT 1`
    )
    .get(orgId, salesorderId) as unknown as { source_run_id: string } | undefined;

  let row: (InvoiceLineEvidence & Record<string, unknown>) | undefined;
  if (header) {
    row = db
      .prepare(
        `SELECT line_item_id, item_id, item_name, description, quantity, rate, unit, salesorder_id
         FROM audit_zoho_sales_order_lines
         WHERE organization_id = ? AND salesorder_id = ? AND source_run_id = ? AND line_item_id = ?
         LIMIT 1`
      )
      .get(orgId, salesorderId, header.source_run_id, soLineItemId) as unknown as
      (InvoiceLineEvidence & Record<string, unknown>) | undefined;
    if (!row) return null;
  } else {
    row = db
      .prepare(
        `SELECT line_item_id, item_id, item_name, description, quantity, rate, unit, salesorder_id
         FROM audit_zoho_sales_order_lines
         WHERE organization_id = ? AND line_item_id = ?
         ORDER BY rowid DESC LIMIT 1`
      )
      .get(orgId, soLineItemId) as unknown as
      (InvoiceLineEvidence & Record<string, unknown>) | undefined;
    if (!row) return null;
    if (row.salesorder_id !== salesorderId) return null;
  }

  return {
    line_item_id: row.line_item_id,
    item_id: row.item_id,
    item_name: row.item_name,
    description: row.description,
    quantity: row.quantity,
    rate: row.rate,
    unit: row.unit,
  };
}

// ── Validation ─────────────────────────────────────────────

interface InvoiceValidationContext {
  invoiceLine: InvoiceLineEvidence;
  soLine: InvoiceLineEvidence;
}

/**
 * Validate that both Invoice and SO lines exist locally and belong to
 * the claimed documents under the same organization.
 */
function validateInvoiceOwnership(
  db: DatabaseSync,
  orgId: string,
  invoiceId: string,
  invoiceLineItemId: string,
  salesorderId: string,
  soLineItemId: string
): { valid: true; ctx: InvoiceValidationContext } | { valid: false; reason: string } {
  const invoiceLine = getLocalInvoiceLine(db, orgId, invoiceId, invoiceLineItemId);
  if (!invoiceLine) {
    const anyRow = db
      .prepare(
        `SELECT invoice_id FROM audit_zoho_invoice_lines
         WHERE organization_id = ? AND line_item_id = ? LIMIT 1`
      )
      .get(orgId, invoiceLineItemId) as unknown as { invoice_id: string } | undefined;
    if (!anyRow) {
      return { valid: false, reason: `Invoice line ${invoiceLineItemId} not found locally for organization ${orgId}` };
    }
    return {
      valid: false,
      reason: `Invoice line ${invoiceLineItemId} belongs to Invoice ${anyRow.invoice_id}, not ${invoiceId}`,
    };
  }

  const soLine = getLocalSoLine(db, orgId, salesorderId, soLineItemId);
  if (!soLine) {
    const anyRow = db
      .prepare(
        `SELECT salesorder_id FROM audit_zoho_sales_order_lines
         WHERE organization_id = ? AND line_item_id = ? LIMIT 1`
      )
      .get(orgId, soLineItemId) as unknown as { salesorder_id: string } | undefined;
    if (!anyRow) {
      return { valid: false, reason: `SO line ${soLineItemId} not found locally for organization ${orgId}` };
    }
    return {
      valid: false,
      reason: `SO line ${soLineItemId} belongs to SO ${anyRow.salesorder_id}, not ${salesorderId}`,
    };
  }

  return { valid: true, ctx: { invoiceLine, soLine } };
}

// ── History Persistence ────────────────────────────────────

function recordInvoiceHistory(
  db: DatabaseSync,
  mappingId: string,
  eventType: InvoiceMappingHistoryEvent,
  previousStatus: string | null,
  newStatus: string,
  note: string | null
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_invoice_so_line_mapping_history
       (history_id, mapping_id, event_type, previous_status, new_status, occurred_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), mappingId, eventType, previousStatus, newStatus, now, note);
}

// ── Stale Evaluation ───────────────────────────────────────

/**
 * Evaluate whether an existing Invoice mapping is still valid against
 * current local line evidence. Pure — does NOT update the DB.
 *
 * Returns:
 *  - VALID: fingerprints match current evidence
 *  - REVIEW_REQUIRED: business evidence changed
 *  - MISSING_LINE: one or both lines no longer exist locally
 */
export function evaluateInvoiceMappingStaleness(
  db: DatabaseSync,
  mapping: InvoiceLineMappingRecord
): InvoiceStaleResult {
  const invoiceLine = getLocalInvoiceLine(
    db, mapping.organization_id, mapping.invoice_id, mapping.invoice_line_item_id
  );
  const soLine = getLocalSoLine(
    db, mapping.organization_id, mapping.salesorder_id, mapping.so_line_item_id
  );

  if (!invoiceLine || !soLine) return "MISSING_LINE";

  const invoiceFP = computeInvoiceLineFingerprint(invoiceLine);
  const soFP = computeInvoiceLineFingerprint(soLine);

  if (invoiceFP !== mapping.invoice_fingerprint || soFP !== mapping.so_fingerprint) {
    return "REVIEW_REQUIRED";
  }

  return "VALID";
}

// ── Usability ──────────────────────────────────────────────

/**
 * Determine if an Invoice mapping is currently usable.
 *
 * Usable requires:
 *  - status = ACTIVE
 *  - AND both fingerprints still match current source evidence
 *
 * REVIEW_REQUIRED and REVOKED are NEVER usable.
 */
export function isInvoiceMappingUsable(
  db: DatabaseSync,
  mapping: InvoiceLineMappingRecord
): boolean {
  if (mapping.status !== "ACTIVE") return false;
  return evaluateInvoiceMappingStaleness(db, mapping) === "VALID";
}

// ── Create ─────────────────────────────────────────────────

/**
 * Create an OWNER manual Invoice↔SO line mapping.
 *
 * Validates ownership, captures fingerprints, enforces uniqueness.
 *
 * Returns:
 *  - CREATED: new mapping stored
 *  - DUPLICATE: exact same active mapping already exists
 *  - CONFLICT: Invoice line already has a current mapping to a different SO line
 *  - VALIDATION_FAILED: ownership/existence check failed
 */
export function createOwnerInvoiceLineMapping(
  db: DatabaseSync,
  args: {
    organizationId: string;
    invoiceId: string;
    invoiceLineItemId: string;
    salesorderId: string;
    soLineItemId: string;
    mappingKind: InvoiceMappingKind;
    note?: string;
  }
): CreateInvoiceMappingResult {
  const { organizationId, invoiceId, invoiceLineItemId, salesorderId, soLineItemId, mappingKind, note } = args;

  // 1. Validate ownership
  const validation = validateInvoiceOwnership(db, organizationId, invoiceId, invoiceLineItemId, salesorderId, soLineItemId);
  if (!validation.valid) {
    return { outcome: "VALIDATION_FAILED", reason: validation.reason };
  }
  const { invoiceLine, soLine } = validation.ctx;

  // 2. Check for existing current (non-revoked) mapping for this Invoice line
  const existing = db
    .prepare(
      `SELECT * FROM audit_invoice_so_line_mappings
       WHERE organization_id = ? AND invoice_id = ? AND invoice_line_item_id = ?
         AND status IN ('ACTIVE', 'REVIEW_REQUIRED')`
    )
    .get(organizationId, invoiceId, invoiceLineItemId) as unknown as InvoiceLineMappingRecord | undefined;

  if (existing) {
    // Same exact mapping? → DUPLICATE
    if (existing.so_line_item_id === soLineItemId && existing.salesorder_id === salesorderId) {
      return { outcome: "DUPLICATE", mapping: existing };
    }
    // Different SO line → CONFLICT
    return { outcome: "CONFLICT", existing };
  }

  // 3. Compute fingerprints
  const invoiceFingerprint = computeInvoiceLineFingerprint(invoiceLine);
  const soFingerprint = computeInvoiceLineFingerprint(soLine);

  // 4. Insert
  const mappingId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_invoice_so_line_mappings
       (mapping_id, organization_id, invoice_id, invoice_line_item_id,
        salesorder_id, so_line_item_id, mapping_kind, status,
        invoice_fingerprint, so_fingerprint, decision_source, notes,
        created_at, updated_at, review_required_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 'OWNER', ?, ?, ?, NULL, NULL)`
  ).run(
    mappingId, organizationId, invoiceId, invoiceLineItemId,
    salesorderId, soLineItemId, mappingKind,
    invoiceFingerprint, soFingerprint, note ?? null, now, now
  );

  const created = db.prepare(
    `SELECT * FROM audit_invoice_so_line_mappings WHERE mapping_id = ?`
  ).get(mappingId) as unknown as InvoiceLineMappingRecord;

  // 5. Record history
  recordInvoiceHistory(db, mappingId, "MAPPING_CREATED", null, "ACTIVE", note ?? null);

  return { outcome: "CREATED", mapping: created };
}

// ── Revoke ─────────────────────────────────────────────────

/**
 * Revoke an existing Invoice mapping. Sets status to REVOKED.
 * ACTIVE or REVIEW_REQUIRED → REVOKED. Already REVOKED is idempotent.
 * Never hard-deletes.
 */
export function revokeOwnerInvoiceLineMapping(
  db: DatabaseSync,
  mappingId: string,
  note?: string
): RevokeInvoiceMappingResult {
  const existing = db
    .prepare(`SELECT * FROM audit_invoice_so_line_mappings WHERE mapping_id = ?`)
    .get(mappingId) as unknown as InvoiceLineMappingRecord | undefined;

  if (!existing) return { outcome: "NOT_FOUND" };

  if (existing.status === "REVOKED") {
    return { outcome: "ALREADY_REVOKED", mapping: existing };
  }

  const now = new Date().toISOString();
  const previousStatus = existing.status;
  db.prepare(
    `UPDATE audit_invoice_so_line_mappings
     SET status = 'REVOKED', revoked_at = ?, updated_at = ?
     WHERE mapping_id = ?`
  ).run(now, now, mappingId);

  recordInvoiceHistory(db, mappingId, "MAPPING_REVOKED", previousStatus, "REVOKED", note ?? null);

  const updated = db.prepare(
    `SELECT * FROM audit_invoice_so_line_mappings WHERE mapping_id = ?`
  ).get(mappingId) as unknown as InvoiceLineMappingRecord;
  return { outcome: "REVOKED", mapping: updated };
}

// ── Reconfirm ──────────────────────────────────────────────

/**
 * Reconfirm a REVIEW_REQUIRED Invoice mapping. Re-reads current local
 * evidence, refreshes fingerprints, sets ACTIVE — only if both lines
 * still exist.
 */
export function reconfirmOwnerInvoiceLineMapping(
  db: DatabaseSync,
  mappingId: string,
  note?: string
): ReconfirmInvoiceMappingResult {
  const existing = db
    .prepare(`SELECT * FROM audit_invoice_so_line_mappings WHERE mapping_id = ?`)
    .get(mappingId) as unknown as InvoiceLineMappingRecord | undefined;

  if (!existing) return { outcome: "NOT_FOUND" };

  if (existing.status !== "REVIEW_REQUIRED") {
    return { outcome: "NOT_REVIEW_REQUIRED", mapping: existing };
  }

  // Re-read current local evidence
  const invoiceLine = getLocalInvoiceLine(
    db, existing.organization_id, existing.invoice_id, existing.invoice_line_item_id
  );
  if (!invoiceLine) {
    return { outcome: "VALIDATION_FAILED", reason: `Invoice line ${existing.invoice_line_item_id} no longer exists locally` };
  }

  const soLine = getLocalSoLine(
    db, existing.organization_id, existing.salesorder_id, existing.so_line_item_id
  );
  if (!soLine) {
    return { outcome: "VALIDATION_FAILED", reason: `SO line ${existing.so_line_item_id} no longer exists locally` };
  }

  // Refresh fingerprints and reactivate
  const invoiceFingerprint = computeInvoiceLineFingerprint(invoiceLine);
  const soFingerprint = computeInvoiceLineFingerprint(soLine);
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE audit_invoice_so_line_mappings
     SET status = 'ACTIVE', invoice_fingerprint = ?, so_fingerprint = ?,
         review_required_at = NULL, updated_at = ?
     WHERE mapping_id = ?`
  ).run(invoiceFingerprint, soFingerprint, now, mappingId);

  recordInvoiceHistory(db, mappingId, "MAPPING_RECONFIRMED", "REVIEW_REQUIRED", "ACTIVE", note ?? null);

  const updated = db.prepare(
    `SELECT * FROM audit_invoice_so_line_mappings WHERE mapping_id = ?`
  ).get(mappingId) as unknown as InvoiceLineMappingRecord;
  return { outcome: "RECONFIRMED", mapping: updated };
}

// ── Mark Review Required ─────────────────────────────────

/**
 * Mark an Invoice mapping as REVIEW_REQUIRED. Used by stale evaluation
 * when evidence changes are detected.
 */
export function markInvoiceMappingReviewRequired(
  db: DatabaseSync,
  mappingId: string,
  note?: string
): InvoiceLineMappingRecord | null {
  const existing = db
    .prepare(`SELECT * FROM audit_invoice_so_line_mappings WHERE mapping_id = ?`)
    .get(mappingId) as unknown as InvoiceLineMappingRecord | undefined;
  if (!existing || existing.status !== "ACTIVE") return null;

  const now = new Date().toISOString();
  const res = db.prepare(
    `UPDATE audit_invoice_so_line_mappings
     SET status = 'REVIEW_REQUIRED', review_required_at = ?, updated_at = ?
     WHERE mapping_id = ? AND status = 'ACTIVE'`
  ).run(now, now, mappingId);
  if (Number(res.changes) !== 1) return null;

  recordInvoiceHistory(db, mappingId, "MAPPING_MARKED_REVIEW_REQUIRED", "ACTIVE", "REVIEW_REQUIRED", note ?? null);

  return db.prepare(
    `SELECT * FROM audit_invoice_so_line_mappings WHERE mapping_id = ?`
  ).get(mappingId) as unknown as InvoiceLineMappingRecord;
}

// ── Query Helpers ──────────────────────────────────────────

/**
 * Get the current (non-revoked) mapping for an Invoice line, if any.
 */
export function getCurrentMappingForInvoiceLine(
  db: DatabaseSync,
  orgId: string,
  invoiceId: string,
  invoiceLineItemId: string
): InvoiceLineMappingRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM audit_invoice_so_line_mappings
       WHERE organization_id = ? AND invoice_id = ? AND invoice_line_item_id = ?
         AND status IN ('ACTIVE', 'REVIEW_REQUIRED')
       LIMIT 1`
    )
    .get(orgId, invoiceId, invoiceLineItemId) as unknown as InvoiceLineMappingRecord | undefined;
  return row ?? null;
}

/**
 * Get all mappings (including revoked) for an Invoice line, ordered by creation time.
 */
export function getMappingHistoryForInvoiceLine(
  db: DatabaseSync,
  orgId: string,
  invoiceId: string,
  invoiceLineItemId: string
): InvoiceLineMappingRecord[] {
  return db
    .prepare(
      `SELECT * FROM audit_invoice_so_line_mappings
       WHERE organization_id = ? AND invoice_id = ? AND invoice_line_item_id = ?
       ORDER BY created_at ASC`
    )
    .all(orgId, invoiceId, invoiceLineItemId) as unknown as InvoiceLineMappingRecord[];
}

// ── History Events ─────────────────────────────────────────

/**
 * Get all history events for mappings belonging to an Invoice line,
 * from the audit_invoice_so_line_mapping_history table.
 * Returns events ordered by occurred_at ASC.
 */
export function getHistoryEventsForInvoiceLine(
  db: DatabaseSync,
  orgId: string,
  invoiceId: string,
  invoiceLineItemId: string
): InvoiceLineMappingHistoryRecord[] {
  return db
    .prepare(
      `SELECT h.* FROM audit_invoice_so_line_mapping_history h
       JOIN audit_invoice_so_line_mappings m ON h.mapping_id = m.mapping_id
       WHERE m.organization_id = ? AND m.invoice_id = ? AND m.invoice_line_item_id = ?
       ORDER BY h.occurred_at ASC`
    )
    .all(orgId, invoiceId, invoiceLineItemId) as unknown as InvoiceLineMappingHistoryRecord[];
}

// ── R1B: Candidate Retrieval with Narration Ranking ──────

import {
  rankCandidates,
  type CandidateLine,
  type CandidateRanking,
} from "./invoice-line-narration-match.ts";

export interface InvoiceCandidateResult {
  candidate: CandidateLine;
  ranking: CandidateRanking;
}

/**
 * Retrieve candidate SO lines for an Invoice line and rank them
 * using the deterministic narration engine.
 *
 * Flow:
 *  1. Read the Invoice line from local data (for the ranking input)
 *  2. Read all SO lines for the given salesorderId
 *  3. Rank each SO line against the Invoice line using rankCandidates()
 *
 * The candidate endpoint RANKS only — it NEVER creates a mapping automatically.
 * Results carry SUGGESTED / NOT_RECOMMENDED but OWNER must confirm.
 *
 * ZOHO WRITE = 0. No network calls. No AI. Pure local SQLite + deterministic scoring.
 */
export function getCandidatesForInvoiceLine(
  db: DatabaseSync,
  orgId: string,
  invoiceId: string,
  invoiceLineItemId: string,
  salesorderId: string
): {
  invoiceLine: CandidateLine | null;
  ranked: InvoiceCandidateResult[];
} {
  // 1. Get the Invoice line evidence
  const invLine = getLocalInvoiceLine(db, orgId, invoiceId, invoiceLineItemId);
  if (!invLine) {
    return { invoiceLine: null, ranked: [] };
  }

  const invoiceCandidateLine: CandidateLine = {
    line_item_id: invLine.line_item_id ?? invoiceLineItemId,
    item_id: invLine.item_id ?? null,
    item_name: invLine.item_name ?? null,
    description: invLine.description ?? null,
    quantity: invLine.quantity ?? null,
    rate: invLine.rate ?? null,
    unit: invLine.unit ?? null,
  };

  // 2. Get all SO lines for the linked SO (latest coherent snapshot)
  const soHeader = db
    .prepare(
      `SELECT source_run_id, organization_id FROM audit_zoho_sales_orders
       WHERE organization_id = ? AND salesorder_id = ?
       ORDER BY fetched_at DESC, rowid DESC LIMIT 1`
    )
    .get(orgId, salesorderId) as unknown as { source_run_id: string; organization_id: string } | undefined;

  if (!soHeader) {
    return { invoiceLine: invoiceCandidateLine, ranked: [] };
  }

  const soLineRows = db
    .prepare(
      `SELECT line_item_id, item_id, item_name, description, quantity, rate, unit
       FROM audit_zoho_sales_order_lines
       WHERE organization_id = ? AND salesorder_id = ? AND source_run_id = ?
       ORDER BY rowid ASC`
    )
    .all(orgId, salesorderId, soHeader.source_run_id) as unknown as CandidateLine[];

  if (soLineRows.length === 0) {
    return { invoiceLine: invoiceCandidateLine, ranked: [] };
  }

  // 3. Rank using deterministic narration engine
  const ranked = rankCandidates(invoiceCandidateLine, soLineRows);

  return { invoiceLine: invoiceCandidateLine, ranked };
}

// ── R1B: Mapping-Aware Line Resolution for AP Verification ──

export type InvoiceLineResolutionSource =
  | "MANUAL_MAPPING"         // ACTIVE + fingerprint-valid manual mapping
  | "ITEM_ID_UNIQUE"         // Single SO line shares item_id
  | "ITEM_ID_AMBIGUOUS"      // Multiple SO lines share item_id
  | "ITEM_NOT_FOUND";        // No SO line shares item_id

export interface InvoiceLineResolution {
  source: InvoiceLineResolutionSource;
  soLine: any | null;  // The resolved SO line row, or null
  mappingId: string | null; // mapping_id if resolved via manual mapping
}

/**
 * Resolve which SO line an Invoice line maps to, applying the
 * R1B mapping precedence:
 *
 *   1. ACTIVE + fingerprint-valid manual mapping  → authoritative
 *   2. Native Zoho source relationship            → (not applicable here, handled upstream)
 *   3. Exact item_id with unique match            → deterministic
 *   4. item_id with multiple matches              → AMBIGUOUS
 *   5. No item_id match                           → NOT_FOUND
 *
 * REVIEW_REQUIRED and REVOKED mappings are NEVER authoritative.
 * Stale ACTIVE (fingerprint mismatch) is NOT authoritative.
 * Manual mapping proves LINE IDENTITY ONLY — does not force MATCHED verification.
 *
 * ZOHO WRITE = 0.
 */
export function resolveInvoiceLineWithMapping(
  db: DatabaseSync,
  orgId: string,
  invoiceId: string,
  invoiceLineItemId: string,
  soLines: any[]
): InvoiceLineResolution {
  // 1. Check for active manual mapping
  const mapping = getCurrentMappingForInvoiceLine(db, orgId, invoiceId, invoiceLineItemId);
  if (mapping && mapping.status === "ACTIVE") {
    // Verify fingerprint validity
    const staleness = evaluateInvoiceMappingStaleness(db, mapping);
    if (staleness === "VALID") {
      // Find the SO line in the provided list
      const matchedSoLine = soLines.find(
        (sl: any) => sl.line_item_id === mapping.so_line_item_id
      );
      if (matchedSoLine) {
        return {
          source: "MANUAL_MAPPING",
          soLine: matchedSoLine,
          mappingId: mapping.mapping_id,
        };
      }
      // Mapping points to a valid SO line but it's not in the current SO lines list
      // (shouldn't happen normally — SO line was deleted from latest snapshot)
      // Fall through to item_id matching
    }
    // Stale or missing — fall through, mapping is NOT authoritative
  }

  // 2. Item_id matching (existing deterministic logic)
  const invLine = getLocalInvoiceLine(db, orgId, invoiceId, invoiceLineItemId);
  if (!invLine || !invLine.item_id) {
    return { source: "ITEM_NOT_FOUND", soLine: null, mappingId: null };
  }

  const candidateSoLines = soLines.filter(
    (sl: any) => sl.item_id === invLine.item_id
  );

  if (candidateSoLines.length === 1) {
    return {
      source: "ITEM_ID_UNIQUE",
      soLine: candidateSoLines[0],
      mappingId: null,
    };
  }

  if (candidateSoLines.length > 1) {
    return {
      source: "ITEM_ID_AMBIGUOUS",
      soLine: null,
      mappingId: null,
    };
  }

  return { source: "ITEM_NOT_FOUND", soLine: null, mappingId: null };
}

// ============================================================
// R1C: Invoice→SO Stale-Mapping Validation for Smart Sync
// ============================================================

// ── Private: detailed staleness evaluation ─────────────────

interface InvoiceStaleDetail {
  result: InvoiceStaleResult;
  /** Which side(s) triggered a non-VALID result (empty when VALID). */
  sides: Array<"INVOICE" | "SO">;
}

/**
 * Same evaluation as evaluateInvoiceMappingStaleness, additionally reporting
 * which side caused the result (used for lifecycle history notes). Pure — no writes.
 */
function evaluateInvoiceMappingStalenessDetail(
  db: DatabaseSync,
  mapping: InvoiceLineMappingRecord
): InvoiceStaleDetail {
  const invoiceLine = getLocalInvoiceLine(
    db, mapping.organization_id, mapping.invoice_id, mapping.invoice_line_item_id
  );
  const soLine = getLocalSoLine(
    db, mapping.organization_id, mapping.salesorder_id, mapping.so_line_item_id
  );

  if (!invoiceLine || !soLine) {
    const sides: Array<"INVOICE" | "SO"> = [];
    if (!invoiceLine) sides.push("INVOICE");
    if (!soLine) sides.push("SO");
    return { result: "MISSING_LINE", sides };
  }

  const sides: Array<"INVOICE" | "SO"> = [];
  if (computeInvoiceLineFingerprint(invoiceLine) !== mapping.invoice_fingerprint) sides.push("INVOICE");
  if (computeInvoiceLineFingerprint(soLine) !== mapping.so_fingerprint) sides.push("SO");

  return sides.length > 0 ? { result: "REVIEW_REQUIRED", sides } : { result: "VALID", sides };
}

// ── Exported: InvoiceMappingValidationSummary ──────────────

export interface InvoiceMappingValidationSummary {
  /** ACTIVE mappings evaluated */
  checked: number;
  /** Evaluated mappings whose evidence still matches (status unchanged) */
  stillValid: number;
  /** Mappings transitioned ACTIVE → REVIEW_REQUIRED (includes missingLines) */
  markedReviewRequired: number;
  /** Subset of markedReviewRequired caused by a mapped line missing from the newest coherent snapshot */
  missingLines: number;
  /** Mappings (or the whole run) that could not be evaluated/transitioned */
  failed: number;
  /** First error message, when failed > 0 */
  error?: string;
}

const INVOICE_VALIDATION_ID_CHUNK = 400;

function invoiceUniqueNonEmpty(ids: string[] | undefined): string[] {
  return Array.from(new Set((ids || []).filter((v) => typeof v === "string" && v.length > 0))).sort();
}

// ── Exported: validateActiveInvoiceMappingsForDocuments ─────

/**
 * R1C Phase-3: validate ACTIVE OWNER Invoice→SO mappings touching the given
 * Invoice/SO documents against the newest coherent committed local evidence.
 *
 *  - ACTIVE only (REVIEW_REQUIRED / REVOKED are never evaluated or changed)
 *  - organization-scoped, bounded by supplied document IDs (no IDs → no-op,
 *    never a full-table scan)
 *  - VALID → no DB change
 *  - REVIEW_REQUIRED / MISSING_LINE → ACTIVE → REVIEW_REQUIRED with exactly
 *    one MAPPING_MARKED_REVIEW_REQUIRED history event (status-preconditioned)
 *  - never remaps, replaces, revokes, deletes or reconfirms
 *  - local SQLite only: no network, no AI
 *
 * Must be called AFTER the source evidence transaction has COMMITted.
 * Never throws: failures are reported through `failed` / `error` so callers
 * can surface them without rolling back committed source evidence.
 */
export function validateActiveInvoiceMappingsForDocuments(
  db: DatabaseSync,
  scope: { organizationId: string; invoiceIds?: string[]; salesorderIds?: string[] }
): InvoiceMappingValidationSummary {
  const summary: InvoiceMappingValidationSummary = {
    checked: 0,
    stillValid: 0,
    markedReviewRequired: 0,
    missingLines: 0,
    failed: 0,
  };
  const noteError = (e: unknown) => {
    summary.failed++;
    if (!summary.error) summary.error = e instanceof Error ? e.message : String(e);
  };

  try {
    const orgId = scope?.organizationId;
    const invIds = invoiceUniqueNonEmpty(scope?.invoiceIds);
    const soIds = invoiceUniqueNonEmpty(scope?.salesorderIds);
    if (!orgId || (invIds.length === 0 && soIds.length === 0)) return summary;

    // 1. Collect ACTIVE mappings touching the affected documents (index-bounded)
    const byId = new Map<string, InvoiceLineMappingRecord>();
    const collect = (column: "invoice_id" | "salesorder_id", ids: string[]) => {
      for (let i = 0; i < ids.length; i += INVOICE_VALIDATION_ID_CHUNK) {
        const chunk = ids.slice(i, i + INVOICE_VALIDATION_ID_CHUNK);
        const placeholders = chunk.map(() => "?").join(", ");
        const rows = db
          .prepare(
            `SELECT * FROM audit_invoice_so_line_mappings
             WHERE organization_id = ? AND ${column} IN (${placeholders}) AND status = 'ACTIVE'`
          )
          .all(orgId, ...chunk) as unknown as InvoiceLineMappingRecord[];
        for (const r of rows) byId.set(r.mapping_id, r);
      }
    };
    collect("invoice_id", invIds);
    collect("salesorder_id", soIds);

    const mappings = Array.from(byId.values()).sort((a, b) => a.mapping_id.localeCompare(b.mapping_id));

    // 2. Evaluate (pure reads) and transition stale mappings one at a time
    for (const mapping of mappings) {
      summary.checked++;
      let detail: InvoiceStaleDetail;
      try {
        detail = evaluateInvoiceMappingStalenessDetail(db, mapping);
      } catch (e) {
        noteError(e);
        continue;
      }

      if (detail.result === "VALID") {
        summary.stillValid++;
        continue;
      }

      const reason = detail.result === "MISSING_LINE" ? "MISSING_LINE" : "EVIDENCE_CHANGED";
      const note = `AUTO_STALE_VALIDATION: ${reason} (${detail.sides.join("+")})`;

      // Atomic per-mapping transition (status UPDATE + one history row)
      const sp = "inv_mlm_phase3_transition";
      try {
        db.exec(`SAVEPOINT ${sp}`);
        let transitioned: InvoiceLineMappingRecord | null = null;
        try {
          transitioned = markInvoiceMappingReviewRequired(db, mapping.mapping_id, note);
          db.exec(`RELEASE ${sp}`);
        } catch (e) {
          try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch { /* ignore */ }
          throw e;
        }
        if (transitioned) {
          summary.markedReviewRequired++;
          if (detail.result === "MISSING_LINE") summary.missingLines++;
        }
        // transitioned === null → mapping no longer ACTIVE (concurrently changed): skipped, no history
      } catch (e) {
        noteError(e);
      }
    }
  } catch (e) {
    noteError(e);
  }

  return summary;
}

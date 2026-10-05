// ============================================================
// Bansil Books Analytics — Manual SO↔PO Line Mapping Service (Phase 1)
//
// OWNER-approved local mapping: one PO line → one SO line.
// Many PO lines may map to the same SO line. A single PO line
// may NOT have multiple simultaneously non-revoked mappings.
//
// Identity is always stable source IDs (line_item_id), never
// human display Sr.No.
//
// ZOHO WRITE = 0. No network calls. Pure local SQLite operations.
// ============================================================

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

// ── Types ──────────────────────────────────────────────────

export type MappingKind = "OWNER_FALLBACK" | "OWNER_OVERRIDE";
export type MappingStatus = "ACTIVE" | "REVIEW_REQUIRED" | "REVOKED";
export type StaleResult = "VALID" | "REVIEW_REQUIRED" | "MISSING_LINE";

export type MappingHistoryEvent =
  | "MAPPING_CREATED"
  | "MAPPING_MARKED_REVIEW_REQUIRED"
  | "MAPPING_RECONFIRMED"
  | "MAPPING_REVOKED"
  | "MAPPING_REPLACED";

export interface LineMappingRecord {
  mapping_id: string;
  organization_id: string;
  salesorder_id: string;
  so_line_item_id: string;
  purchaseorder_id: string;
  po_line_item_id: string;
  mapping_kind: MappingKind;
  status: MappingStatus;
  so_fingerprint: string;
  po_fingerprint: string;
  decision_source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  review_required_at: string | null;
  revoked_at: string | null;
}

export interface LineMappingHistoryRecord {
  history_id: string;
  mapping_id: string;
  event_type: MappingHistoryEvent;
  previous_status: string | null;
  new_status: string;
  occurred_at: string;
  note: string | null;
}

export type CreateMappingResult =
  | { outcome: "CREATED"; mapping: LineMappingRecord }
  | { outcome: "DUPLICATE"; mapping: LineMappingRecord }
  | { outcome: "CONFLICT"; existing: LineMappingRecord }
  | { outcome: "VALIDATION_FAILED"; reason: string };

export type RevokeMappingResult =
  | { outcome: "REVOKED"; mapping: LineMappingRecord }
  | { outcome: "ALREADY_REVOKED"; mapping: LineMappingRecord }
  | { outcome: "NOT_FOUND" };

export type ReconfirmMappingResult =
  | { outcome: "RECONFIRMED"; mapping: LineMappingRecord }
  | { outcome: "VALIDATION_FAILED"; reason: string }
  | { outcome: "NOT_REVIEW_REQUIRED"; mapping: LineMappingRecord }
  | { outcome: "NOT_FOUND" };

export type ReplaceMappingResult =
  | { outcome: "REPLACED"; revoked: LineMappingRecord; created: LineMappingRecord }
  | { outcome: "VALIDATION_FAILED"; reason: string }
  | { outcome: "NOT_FOUND" };

// ── Fingerprint ────────────────────────────────────────────

/** Fields included in line fingerprint computation */
const FINGERPRINT_FIELDS = [
  "line_item_id",
  "item_id",
  "item_name",
  "description",
  "quantity",
  "rate",
  "unit",
] as const;

interface LineEvidence {
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
export function computeLineFingerprint(line: LineEvidence): string {
  const canonical: Record<string, string | number | null> = {};
  for (const field of FINGERPRINT_FIELDS) {
    const val = line[field];
    if (val === null || val === undefined) {
      canonical[field] = null;
    } else if (typeof val === "string") {
      canonical[field] = val.trim();
    } else {
      // number — use as-is (JSON.stringify handles consistent serialization)
      canonical[field] = val;
    }
  }
  const serialized = JSON.stringify(canonical);
  return createHash("sha256").update(serialized).digest("hex");
}

// ── Local Line Retrieval ───────────────────────────────────

type DocKind = "SO" | "PO";

const DOC_TABLES: Record<DocKind, { header: string; lines: string; idColumn: "salesorder_id" | "purchaseorder_id" }> = {
  SO: { header: "audit_zoho_sales_orders", lines: "audit_zoho_sales_order_lines", idColumn: "salesorder_id" },
  PO: { header: "audit_zoho_purchase_orders", lines: "audit_zoho_purchase_order_lines", idColumn: "purchaseorder_id" },
};

/**
 * Retrieve the current line evidence for a SO/PO line, tied to the newest
 * coherent document snapshot.
 *
 * Snapshot selection (Phase-3):
 *  1. Resolve the newest HEADER snapshot for (organization_id, document id),
 *     ordered by fetched_at DESC (rowid DESC as deterministic tie-break).
 *  2. Look up the line ONLY inside that header's source_run_id.
 *  3. If the line is absent from that snapshot → null (MISSING_LINE).
 *     An older source_run_id that still contains the line is NEVER used to
 *     resurrect it.
 *
 * Legacy compatibility: when NO header snapshot exists at all for the
 * document in this organization (line-only evidence, e.g. pre-header
 * fixtures), the Phase-1 line-level lookup is used. A header-less document
 * has no newer coherent snapshot that could have removed the line.
 */
function getCoherentLocalLine(
  db: DatabaseSync,
  kind: DocKind,
  orgId: string,
  documentId: string,
  lineItemId: string
): LineEvidence | null {
  const t = DOC_TABLES[kind];
  const header = db
    .prepare(
      `SELECT source_run_id FROM ${t.header}
       WHERE organization_id = ? AND ${t.idColumn} = ?
       ORDER BY fetched_at DESC, rowid DESC LIMIT 1`
    )
    .get(orgId, documentId) as unknown as { source_run_id: string } | undefined;

  let row: (LineEvidence & Record<string, unknown>) | undefined;
  if (header) {
    row = db
      .prepare(
        `SELECT line_item_id, item_id, item_name, description, quantity, rate, unit, ${t.idColumn}
         FROM ${t.lines}
         WHERE organization_id = ? AND ${t.idColumn} = ? AND source_run_id = ? AND line_item_id = ?
         LIMIT 1`
      )
      .get(orgId, documentId, header.source_run_id, lineItemId) as unknown as (LineEvidence & Record<string, unknown>) | undefined;
    if (!row) return null;
  } else {
    row = db
      .prepare(
        `SELECT line_item_id, item_id, item_name, description, quantity, rate, unit, ${t.idColumn}
         FROM ${t.lines}
         WHERE organization_id = ? AND line_item_id = ?
         ORDER BY rowid DESC LIMIT 1`
      )
      .get(orgId, lineItemId) as unknown as (LineEvidence & Record<string, unknown>) | undefined;
    if (!row) return null;
    // Validate ownership: line must belong to the claimed document
    if (row[t.idColumn] !== documentId) return null;
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
): LineEvidence | null {
  return getCoherentLocalLine(db, "SO", orgId, salesorderId, soLineItemId);
}

/** Current PO line evidence from the newest coherent PO snapshot. */
function getLocalPoLine(
  db: DatabaseSync,
  orgId: string,
  purchaseorderId: string,
  poLineItemId: string
): LineEvidence | null {
  return getCoherentLocalLine(db, "PO", orgId, purchaseorderId, poLineItemId);
}

// ── Validation ─────────────────────────────────────────────

interface ValidationContext {
  soLine: LineEvidence;
  poLine: LineEvidence;
}

/**
 * Validate that both SO and PO lines exist locally and belong to
 * the claimed documents under the same organization.
 */
function validateOwnership(
  db: DatabaseSync,
  orgId: string,
  salesorderId: string,
  soLineItemId: string,
  purchaseorderId: string,
  poLineItemId: string
): { valid: true; ctx: ValidationContext } | { valid: false; reason: string } {
  const soLine = getLocalSoLine(db, orgId, salesorderId, soLineItemId);
  if (!soLine) {
    // Distinguish: line missing entirely vs. wrong SO
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

  const poLine = getLocalPoLine(db, orgId, purchaseorderId, poLineItemId);
  if (!poLine) {
    const anyRow = db
      .prepare(
        `SELECT purchaseorder_id FROM audit_zoho_purchase_order_lines
         WHERE organization_id = ? AND line_item_id = ? LIMIT 1`
      )
      .get(orgId, poLineItemId) as unknown as { purchaseorder_id: string } | undefined;
    if (!anyRow) {
      return { valid: false, reason: `PO line ${poLineItemId} not found locally for organization ${orgId}` };
    }
    return {
      valid: false,
      reason: `PO line ${poLineItemId} belongs to PO ${anyRow.purchaseorder_id}, not ${purchaseorderId}`,
    };
  }

  return { valid: true, ctx: { soLine, poLine } };
}

// ── History Persistence ────────────────────────────────────

function recordHistory(
  db: DatabaseSync,
  mappingId: string,
  eventType: MappingHistoryEvent,
  previousStatus: string | null,
  newStatus: string,
  note: string | null
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_so_po_line_mapping_history
       (history_id, mapping_id, event_type, previous_status, new_status, occurred_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), mappingId, eventType, previousStatus, newStatus, now, note);
}

// ── Stale Evaluation ───────────────────────────────────────

/**
 * Evaluate whether an existing mapping is still valid against current
 * local line evidence. Pure — does NOT update the DB.
 *
 * Returns:
 *  - VALID: fingerprints match current evidence
 *  - REVIEW_REQUIRED: business evidence changed
 *  - MISSING_LINE: one or both lines no longer exist locally
 */
export function evaluateMappingStaleness(
  db: DatabaseSync,
  mapping: LineMappingRecord
): StaleResult {
  return evaluateMappingStalenessDetail(db, mapping).result;
}

interface StaleDetail {
  result: StaleResult;
  /** Which side(s) triggered a non-VALID result (empty when VALID). */
  sides: Array<"SO" | "PO">;
}

/**
 * Same evaluation as evaluateMappingStaleness, additionally reporting which
 * side caused the result (used for lifecycle history notes). Pure — no writes.
 */
function evaluateMappingStalenessDetail(
  db: DatabaseSync,
  mapping: LineMappingRecord
): StaleDetail {
  const soLine = getLocalSoLine(db, mapping.organization_id, mapping.salesorder_id, mapping.so_line_item_id);
  const poLine = getLocalPoLine(db, mapping.organization_id, mapping.purchaseorder_id, mapping.po_line_item_id);

  if (!soLine || !poLine) {
    const sides: Array<"SO" | "PO"> = [];
    if (!soLine) sides.push("SO");
    if (!poLine) sides.push("PO");
    return { result: "MISSING_LINE", sides };
  }

  const sides: Array<"SO" | "PO"> = [];
  if (computeLineFingerprint(soLine) !== mapping.so_fingerprint) sides.push("SO");
  if (computeLineFingerprint(poLine) !== mapping.po_fingerprint) sides.push("PO");

  return sides.length > 0 ? { result: "REVIEW_REQUIRED", sides } : { result: "VALID", sides };
}

// ── Usability ──────────────────────────────────────────────

/**
 * Determine if a mapping is currently usable for authoritative line identity.
 *
 * Usable requires:
 *  - status = ACTIVE
 *  - AND both fingerprints still match current source evidence
 *
 * REVIEW_REQUIRED and REVOKED are NEVER usable.
 */
export function isMappingUsable(
  db: DatabaseSync,
  mapping: LineMappingRecord
): boolean {
  if (mapping.status !== "ACTIVE") return false;
  return evaluateMappingStaleness(db, mapping) === "VALID";
}

// ── Create ─────────────────────────────────────────────────

/**
 * Create an OWNER manual line mapping.
 *
 * Validates ownership, captures fingerprints, enforces uniqueness.
 *
 * Returns:
 *  - CREATED: new mapping stored
 *  - DUPLICATE: exact same active mapping already exists
 *  - CONFLICT: PO line already has a current mapping to a different SO line
 *  - VALIDATION_FAILED: ownership/existence check failed
 */
export function createOwnerLineMapping(
  db: DatabaseSync,
  args: {
    organizationId: string;
    salesorderId: string;
    soLineItemId: string;
    purchaseorderId: string;
    poLineItemId: string;
    mappingKind: MappingKind;
    note?: string;
  }
): CreateMappingResult {
  const { organizationId, salesorderId, soLineItemId, purchaseorderId, poLineItemId, mappingKind, note } = args;

  // 1. Validate ownership
  const validation = validateOwnership(db, organizationId, salesorderId, soLineItemId, purchaseorderId, poLineItemId);
  if (!validation.valid) {
    return { outcome: "VALIDATION_FAILED", reason: validation.reason };
  }
  const { soLine, poLine } = validation.ctx;

  // 2. Check for existing current (non-revoked) mapping for this PO line
  const existing = db
    .prepare(
      `SELECT * FROM audit_so_po_line_mappings
       WHERE organization_id = ? AND purchaseorder_id = ? AND po_line_item_id = ?
         AND status IN ('ACTIVE', 'REVIEW_REQUIRED')`
    )
    .get(organizationId, purchaseorderId, poLineItemId) as unknown as LineMappingRecord | undefined;

  if (existing) {
    // Same exact mapping? → DUPLICATE
    if (existing.so_line_item_id === soLineItemId && existing.salesorder_id === salesorderId) {
      return { outcome: "DUPLICATE", mapping: existing };
    }
    // Different SO line → CONFLICT
    return { outcome: "CONFLICT", existing };
  }

  // 3. Compute fingerprints
  const soFingerprint = computeLineFingerprint(soLine);
  const poFingerprint = computeLineFingerprint(poLine);

  // 4. Insert
  const mappingId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_so_po_line_mappings
       (mapping_id, organization_id, salesorder_id, so_line_item_id,
        purchaseorder_id, po_line_item_id, mapping_kind, status,
        so_fingerprint, po_fingerprint, decision_source, notes,
        created_at, updated_at, review_required_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 'OWNER', ?, ?, ?, NULL, NULL)`
  ).run(
    mappingId, organizationId, salesorderId, soLineItemId,
    purchaseorderId, poLineItemId, mappingKind,
    soFingerprint, poFingerprint, note ?? null, now, now
  );

  const created = db.prepare(`SELECT * FROM audit_so_po_line_mappings WHERE mapping_id = ?`).get(mappingId) as unknown as LineMappingRecord;

  // 5. Record history
  recordHistory(db, mappingId, "MAPPING_CREATED", null, "ACTIVE", note ?? null);

  return { outcome: "CREATED", mapping: created };
}

// ── Revoke ─────────────────────────────────────────────────

/**
 * Revoke an existing mapping. Sets status to REVOKED.
 * ACTIVE or REVIEW_REQUIRED → REVOKED. Already REVOKED is idempotent.
 * Never hard-deletes.
 */
export function revokeOwnerLineMapping(
  db: DatabaseSync,
  mappingId: string,
  note?: string
): RevokeMappingResult {
  const existing = db
    .prepare(`SELECT * FROM audit_so_po_line_mappings WHERE mapping_id = ?`)
    .get(mappingId) as unknown as LineMappingRecord | undefined;

  if (!existing) return { outcome: "NOT_FOUND" };

  if (existing.status === "REVOKED") {
    return { outcome: "ALREADY_REVOKED", mapping: existing };
  }

  const now = new Date().toISOString();
  const previousStatus = existing.status;
  db.prepare(
    `UPDATE audit_so_po_line_mappings
     SET status = 'REVOKED', revoked_at = ?, updated_at = ?
     WHERE mapping_id = ?`
  ).run(now, now, mappingId);

  recordHistory(db, mappingId, "MAPPING_REVOKED", previousStatus, "REVOKED", note ?? null);

  const updated = db.prepare(`SELECT * FROM audit_so_po_line_mappings WHERE mapping_id = ?`).get(mappingId) as unknown as LineMappingRecord;
  return { outcome: "REVOKED", mapping: updated };
}

// ── Reconfirm ──────────────────────────────────────────────

/**
 * Reconfirm a REVIEW_REQUIRED mapping. Re-reads current local evidence,
 * refreshes fingerprints, sets ACTIVE — only if both lines still exist.
 */
export function reconfirmOwnerLineMapping(
  db: DatabaseSync,
  mappingId: string,
  note?: string
): ReconfirmMappingResult {
  const existing = db
    .prepare(`SELECT * FROM audit_so_po_line_mappings WHERE mapping_id = ?`)
    .get(mappingId) as unknown as LineMappingRecord | undefined;

  if (!existing) return { outcome: "NOT_FOUND" };

  if (existing.status !== "REVIEW_REQUIRED") {
    return { outcome: "NOT_REVIEW_REQUIRED", mapping: existing };
  }

  // Re-read current local evidence
  const soLine = getLocalSoLine(db, existing.organization_id, existing.salesorder_id, existing.so_line_item_id);
  if (!soLine) {
    return { outcome: "VALIDATION_FAILED", reason: `SO line ${existing.so_line_item_id} no longer exists locally` };
  }

  const poLine = getLocalPoLine(db, existing.organization_id, existing.purchaseorder_id, existing.po_line_item_id);
  if (!poLine) {
    return { outcome: "VALIDATION_FAILED", reason: `PO line ${existing.po_line_item_id} no longer exists locally` };
  }

  // Refresh fingerprints and reactivate
  const soFingerprint = computeLineFingerprint(soLine);
  const poFingerprint = computeLineFingerprint(poLine);
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE audit_so_po_line_mappings
     SET status = 'ACTIVE', so_fingerprint = ?, po_fingerprint = ?,
         review_required_at = NULL, updated_at = ?
     WHERE mapping_id = ?`
  ).run(soFingerprint, poFingerprint, now, mappingId);

  recordHistory(db, mappingId, "MAPPING_RECONFIRMED", "REVIEW_REQUIRED", "ACTIVE", note ?? null);

  const updated = db.prepare(`SELECT * FROM audit_so_po_line_mappings WHERE mapping_id = ?`).get(mappingId) as unknown as LineMappingRecord;
  return { outcome: "RECONFIRMED", mapping: updated };
}

// ── Replace ────────────────────────────────────────────────

/**
 * Atomically replace an existing current mapping for a PO line with a new one
 * pointing to a different SO line. The old mapping is REVOKED, the new one is
 * created ACTIVE. Both historical records preserved.
 */
export function replaceOwnerLineMapping(
  db: DatabaseSync,
  args: {
    existingMappingId: string;
    newSalesorderId: string;
    newSoLineItemId: string;
    mappingKind: MappingKind;
    note?: string;
  }
): ReplaceMappingResult {
  const { existingMappingId, newSalesorderId, newSoLineItemId, mappingKind, note } = args;

  const existing = db
    .prepare(`SELECT * FROM audit_so_po_line_mappings WHERE mapping_id = ?`)
    .get(existingMappingId) as unknown as LineMappingRecord | undefined;

  if (!existing) return { outcome: "NOT_FOUND" };

  // Validate new SO line ownership
  const validation = validateOwnership(
    db,
    existing.organization_id,
    newSalesorderId,
    newSoLineItemId,
    existing.purchaseorder_id,
    existing.po_line_item_id
  );
  if (!validation.valid) {
    return { outcome: "VALIDATION_FAILED", reason: validation.reason };
  }
  const { soLine, poLine } = validation.ctx;

  const now = new Date().toISOString();

  // Revoke old
  const previousStatus = existing.status;
  db.prepare(
    `UPDATE audit_so_po_line_mappings
     SET status = 'REVOKED', revoked_at = ?, updated_at = ?
     WHERE mapping_id = ?`
  ).run(now, now, existingMappingId);
  recordHistory(db, existingMappingId, "MAPPING_REPLACED", previousStatus, "REVOKED", note ?? null);

  // Create new
  const soFingerprint = computeLineFingerprint(soLine);
  const poFingerprint = computeLineFingerprint(poLine);
  const newMappingId = randomUUID();

  db.prepare(
    `INSERT INTO audit_so_po_line_mappings
       (mapping_id, organization_id, salesorder_id, so_line_item_id,
        purchaseorder_id, po_line_item_id, mapping_kind, status,
        so_fingerprint, po_fingerprint, decision_source, notes,
        created_at, updated_at, review_required_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 'OWNER', ?, ?, ?, NULL, NULL)`
  ).run(
    newMappingId, existing.organization_id, newSalesorderId, newSoLineItemId,
    existing.purchaseorder_id, existing.po_line_item_id, mappingKind,
    soFingerprint, poFingerprint, note ?? null, now, now
  );
  recordHistory(db, newMappingId, "MAPPING_CREATED", null, "ACTIVE", note ?? null);

  const revokedMapping = db.prepare(`SELECT * FROM audit_so_po_line_mappings WHERE mapping_id = ?`).get(existingMappingId) as unknown as LineMappingRecord;
  const createdMapping = db.prepare(`SELECT * FROM audit_so_po_line_mappings WHERE mapping_id = ?`).get(newMappingId) as unknown as LineMappingRecord;

  return { outcome: "REPLACED", revoked: revokedMapping, created: createdMapping };
}

// ── Query Helpers ──────────────────────────────────────────

/**
 * Get the current (non-revoked) mapping for a PO line, if any.
 */
export function getCurrentMappingForPoLine(
  db: DatabaseSync,
  orgId: string,
  purchaseorderId: string,
  poLineItemId: string
): LineMappingRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM audit_so_po_line_mappings
       WHERE organization_id = ? AND purchaseorder_id = ? AND po_line_item_id = ?
         AND status IN ('ACTIVE', 'REVIEW_REQUIRED')
       LIMIT 1`
    )
    .get(orgId, purchaseorderId, poLineItemId) as unknown as LineMappingRecord | undefined;
  return row ?? null;
}

/**
 * Get all mappings (including revoked) for a PO line, ordered by creation time.
 */
export function getMappingHistoryForPoLine(
  db: DatabaseSync,
  orgId: string,
  purchaseorderId: string,
  poLineItemId: string
): LineMappingRecord[] {
  return db
    .prepare(
      `SELECT * FROM audit_so_po_line_mappings
       WHERE organization_id = ? AND purchaseorder_id = ? AND po_line_item_id = ?
       ORDER BY created_at ASC`
    )
    .all(orgId, purchaseorderId, poLineItemId) as unknown as LineMappingRecord[];
}

/**
 * Mark a mapping as REVIEW_REQUIRED. Used by stale evaluation when
 * evidence changes are detected.
 */
export function markMappingReviewRequired(
  db: DatabaseSync,
  mappingId: string,
  note?: string
): LineMappingRecord | null {
  const existing = db
    .prepare(`SELECT * FROM audit_so_po_line_mappings WHERE mapping_id = ?`)
    .get(mappingId) as unknown as LineMappingRecord | undefined;
  if (!existing || existing.status !== "ACTIVE") return null;

  const now = new Date().toISOString();
  // Status precondition: only an ACTIVE mapping can transition. Guarantees
  // idempotency (no duplicate history, no timestamp churn) even if the row
  // changed between the read above and this write.
  const res = db.prepare(
    `UPDATE audit_so_po_line_mappings
     SET status = 'REVIEW_REQUIRED', review_required_at = ?, updated_at = ?
     WHERE mapping_id = ? AND status = 'ACTIVE'`
  ).run(now, now, mappingId);
  if (Number(res.changes) !== 1) return null;

  recordHistory(db, mappingId, "MAPPING_MARKED_REVIEW_REQUIRED", "ACTIVE", "REVIEW_REQUIRED", note ?? null);

  return db.prepare(`SELECT * FROM audit_so_po_line_mappings WHERE mapping_id = ?`).get(mappingId) as unknown as LineMappingRecord;
}

// ── History Events ─────────────────────────────────────────

/**
 * Get all history events for mappings belonging to a PO line,
 * from the audit_so_po_line_mapping_history table.
 * Returns events ordered by occurred_at ASC.
 */
export function getHistoryEventsForPoLine(
  db: DatabaseSync,
  orgId: string,
  purchaseorderId: string,
  poLineItemId: string
): LineMappingHistoryRecord[] {
  return db
    .prepare(
      `SELECT h.* FROM audit_so_po_line_mapping_history h
       JOIN audit_so_po_line_mappings m ON h.mapping_id = m.mapping_id
       WHERE m.organization_id = ? AND m.purchaseorder_id = ? AND m.po_line_item_id = ?
       ORDER BY h.occurred_at ASC`
    )
    .all(orgId, purchaseorderId, poLineItemId) as unknown as LineMappingHistoryRecord[];
}

// ── Phase-3: Automatic Stale Validation ────────────────────

export interface MappingValidationSummary {
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

const VALIDATION_ID_CHUNK = 400;

function uniqueNonEmpty(ids: string[] | undefined): string[] {
  return Array.from(new Set((ids || []).filter((v) => typeof v === "string" && v.length > 0))).sort();
}

/**
 * Phase-3: validate ACTIVE OWNER mappings touching the given SO/PO documents
 * against the newest coherent committed local evidence.
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
export function validateActiveMappingsForDocuments(
  db: DatabaseSync,
  scope: { organizationId: string; purchaseorderIds?: string[]; salesorderIds?: string[] }
): MappingValidationSummary {
  const summary: MappingValidationSummary = {
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
    const poIds = uniqueNonEmpty(scope?.purchaseorderIds);
    const soIds = uniqueNonEmpty(scope?.salesorderIds);
    if (!orgId || (poIds.length === 0 && soIds.length === 0)) return summary;

    // 1. Collect ACTIVE mappings touching the affected documents (index-bounded)
    const byId = new Map<string, LineMappingRecord>();
    const collect = (column: "purchaseorder_id" | "salesorder_id", ids: string[]) => {
      for (let i = 0; i < ids.length; i += VALIDATION_ID_CHUNK) {
        const chunk = ids.slice(i, i + VALIDATION_ID_CHUNK);
        const placeholders = chunk.map(() => "?").join(", ");
        const rows = db
          .prepare(
            `SELECT * FROM audit_so_po_line_mappings
             WHERE organization_id = ? AND ${column} IN (${placeholders}) AND status = 'ACTIVE'`
          )
          .all(orgId, ...chunk) as unknown as LineMappingRecord[];
        for (const r of rows) byId.set(r.mapping_id, r);
      }
    };
    collect("purchaseorder_id", poIds);
    collect("salesorder_id", soIds);

    const mappings = Array.from(byId.values()).sort((a, b) => a.mapping_id.localeCompare(b.mapping_id));

    // 2. Evaluate (pure reads) and transition stale mappings one at a time
    for (const mapping of mappings) {
      summary.checked++;
      let detail: StaleDetail;
      try {
        detail = evaluateMappingStalenessDetail(db, mapping);
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
      const sp = "mlm_phase3_transition";
      try {
        db.exec(`SAVEPOINT ${sp}`);
        let transitioned: LineMappingRecord | null = null;
        try {
          transitioned = markMappingReviewRequired(db, mapping.mapping_id, note);
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

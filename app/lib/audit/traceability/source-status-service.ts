// ============================================================
// Bansil Books Analytics — Item Traceability Source Status Registry
// Mirrors app/lib/audit/p0/source-status-service.ts exactly.
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { TRACEABILITY_SOURCE_KEYS, type TraceabilitySourceKey } from "./traceability-types.ts";

const DISPLAY_NAMES: Record<TraceabilitySourceKey, string> = {
  SALES_ORDER: "Sales Orders",
  PURCHASE_ORDER: "Purchase Orders",
  ITEM_MASTER: "Item Master",
};

/** Sales Order / Purchase Order require ZohoBooks.salesorders.READ / .purchaseorders.READ — owner-approved but the stored token predates the approval, so both remain unusable until a reconnect. Item Master uses the already-granted ZohoBooks.settings.READ. */
const BLOCKED_PENDING_RECONNECT: Readonly<Record<string, string>> = Object.freeze({
  SALES_ORDER: "ZohoBooks.salesorders.READ approved but not yet granted on the current token — reconnect required",
  PURCHASE_ORDER: "ZohoBooks.purchaseorders.READ approved but not yet granted on the current token — reconnect required",
});

export function ensureTraceabilitySourceStatusSeeded(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO audit_traceability_source_status
     (source_key, display_name, implementation_status, coverage_status, blocked_reason, api_call_count, record_count, created_at, updated_at)
     VALUES (?, ?, 'IMPLEMENTED', ?, ?, 0, 0, ?, ?)`
  );
  for (const key of TRACEABILITY_SOURCE_KEYS) {
    const blocked = BLOCKED_PENDING_RECONNECT[key];
    // Honest status vocabulary (owner directive 2026-09-15): a source whose adapter
    // exists but whose scope isn't yet granted on the live token is
    // BLOCKED_PENDING_OAUTH_RECONNECT, never a bare PASS/NOT_AVAILABLE. A source with
    // a granted scope but no live call made yet is IMPLEMENTED_NOT_LIVE_VERIFIED.
    stmt.run(key, DISPLAY_NAMES[key], blocked ? "BLOCKED_PENDING_OAUTH_RECONNECT" : "IMPLEMENTED_NOT_LIVE_VERIFIED", blocked ?? null, now, now);
  }
}

export function listTraceabilitySourceStatus(db: DatabaseSync): Array<Record<string, unknown>> {
  ensureTraceabilitySourceStatusSeeded(db);
  return db.prepare(`SELECT * FROM audit_traceability_source_status ORDER BY source_key ASC`).all() as Array<Record<string, unknown>>;
}

export function getTraceabilitySourceStatus(db: DatabaseSync, sourceKey: string): Record<string, unknown> | undefined {
  ensureTraceabilitySourceStatusSeeded(db);
  return db.prepare(`SELECT * FROM audit_traceability_source_status WHERE source_key = ?`).get(sourceKey) as Record<string, unknown> | undefined;
}

/** Clears a source's blocked_reason once a live-discovery pass confirms its OAuth scope is actually granted on the token — the only authoritative way a source stops being BLOCKED_PENDING_OAUTH_RECONNECT. Never called automatically; only from an explicit, owner-directed reconnect-verification step. */
export function clearTraceabilitySourceBlock(db: DatabaseSync, sourceKey: string): void {
  ensureTraceabilitySourceStatusSeeded(db);
  db.prepare(`UPDATE audit_traceability_source_status SET blocked_reason = NULL, coverage_status = 'IMPLEMENTED_NOT_LIVE_VERIFIED', updated_at = ? WHERE source_key = ?`).run(new Date().toISOString(), sourceKey);
}

export function updateTraceabilitySourceStatus(
  db: DatabaseSync,
  sourceKey: string,
  fields: { coverageStatus?: string; lastSyncedAt?: string; lastCheckpoint?: string; apiCallDelta?: number; recordCount?: number; resetFailures?: boolean; incrementFailures?: boolean }
): void {
  const current = getTraceabilitySourceStatus(db, sourceKey);
  if (!current) return;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE audit_traceability_source_status SET
       coverage_status = COALESCE(?, coverage_status),
       last_synced_at = COALESCE(?, last_synced_at),
       last_checkpoint = COALESCE(?, last_checkpoint),
       api_call_count = api_call_count + ?,
       record_count = COALESCE(?, record_count),
       consecutive_failures = CASE WHEN ? = 1 THEN 0 WHEN ? = 1 THEN consecutive_failures + 1 ELSE consecutive_failures END,
       updated_at = ?
     WHERE source_key = ?`
  ).run(
    fields.coverageStatus ?? null,
    fields.lastSyncedAt ?? null,
    fields.lastCheckpoint ?? null,
    fields.apiCallDelta ?? 0,
    fields.recordCount ?? null,
    fields.resetFailures ? 1 : 0,
    fields.incrementFailures ? 1 : 0,
    now,
    sourceKey
  );
}

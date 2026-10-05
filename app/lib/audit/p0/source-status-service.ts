// ============================================================
// Bansil Books Analytics — Phase F.0 P0 Source Status Registry
// One row per P0 source key, seeded on first access. Sources requiring
// a new Zoho OAuth scope are seeded NOT_IMPLEMENTED / NOT_AVAILABLE and
// are never silently reported as anything else.
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { P0_SOURCE_KEYS, P0_SOURCES_BLOCKED_ON_NEW_SCOPE, type P0SourceKey } from "./p0-types.ts";

const DISPLAY_NAMES: Record<P0SourceKey, string> = {
  BANK: "Bank / Bank-Account Transactions",
  GL: "General Ledger / Account Transactions",
  CUSTOMER_OUTSTANDING: "Customer Outstanding / Receivables",
  VENDOR_OUTSTANDING: "Vendor Outstanding / Payables",
  CUSTOMER_PAYMENTS: "Customer Payments",
  VENDOR_PAYMENTS: "Vendor Payments",
  JOURNALS: "Journals / Manual Journal Entries",
};

/** Idempotent seed — safe to call on every request; INSERT OR IGNORE never overwrites an already-progressed source's counters. */
export function ensureP0SourceStatusSeeded(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO audit_p0_source_status
     (source_key, display_name, implementation_status, coverage_status, blocked_reason, api_call_count, record_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`
  );
  for (const key of P0_SOURCE_KEYS) {
    const blocked = P0_SOURCES_BLOCKED_ON_NEW_SCOPE[key];
    const implementationStatus = blocked ? "NOT_IMPLEMENTED" : "IMPLEMENTED";
    const coverageStatus = blocked ? "NOT_AVAILABLE" : "NOT_TESTED";
    stmt.run(key, DISPLAY_NAMES[key], implementationStatus, coverageStatus, blocked ?? null, now, now);
  }
}

export function listP0SourceStatus(db: DatabaseSync): Array<Record<string, unknown>> {
  ensureP0SourceStatusSeeded(db);
  return db.prepare(`SELECT * FROM audit_p0_source_status ORDER BY source_key ASC`).all() as Array<Record<string, unknown>>;
}

export function getP0SourceStatus(db: DatabaseSync, sourceKey: string): Record<string, unknown> | undefined {
  ensureP0SourceStatusSeeded(db);
  return db.prepare(`SELECT * FROM audit_p0_source_status WHERE source_key = ?`).get(sourceKey) as Record<string, unknown> | undefined;
}

export function updateP0SourceStatus(
  db: DatabaseSync,
  sourceKey: string,
  fields: { coverageStatus?: string; lastSyncedAt?: string; lastCheckpoint?: string; apiCallDelta?: number; recordCount?: number; resetFailures?: boolean; incrementFailures?: boolean }
): void {
  const current = getP0SourceStatus(db, sourceKey);
  if (!current) return;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE audit_p0_source_status SET
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

// ============================================================
// Bansil Books Analytics — Phase F.0 P0 Alert Persistence
// Alerts are deduplicated by a stable dedup_key (rule + entity) so a
// repeated sync/detection pass never creates a second alert for the
// same underlying condition — it only updates checked_at/evidence on
// the existing OPEN alert. Alerts are never auto-resolved by a later
// sync; only an explicit owner action changes `status`.
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { AlertDraft } from "./detection-engine.ts";

export interface UpsertResult {
  created: number;
  updated: number;
}

/**
 * Inserts each draft as a new OPEN alert, unless an alert with the same
 * dedup_key already exists — in which case only checked_at/evidence/
 * zoho_modified_at are refreshed (never severity/status, which a human
 * or a later explicit re-detection may have already acted on).
 */
export function upsertAlerts(db: DatabaseSync, sourceKey: string, drafts: AlertDraft[], fetchedAt: string, checkedAt: string): UpsertResult {
  let created = 0;
  let updated = 0;
  const now = new Date().toISOString();

  const findExisting = db.prepare(`SELECT alert_id, status FROM audit_p0_alerts WHERE dedup_key = ?`);
  const insertStmt = db.prepare(
    `INSERT INTO audit_p0_alerts
     (alert_id, source_key, entity_type, entity_id, rule_id, severity, detection_state, title, description,
      affected_amount, evidence_json, recommended_action, requires_professional_review, zoho_modified_at,
      fetched_at, checked_at, alert_created_at, status, dedup_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`
  );
  const refreshStmt = db.prepare(
    `UPDATE audit_p0_alerts SET evidence_json = ?, zoho_modified_at = ?, checked_at = ?, updated_at = ? WHERE alert_id = ?`
  );

  for (const d of drafts) {
    const existing = findExisting.get(d.dedupKey) as { alert_id: string; status: string } | undefined;
    if (existing) {
      refreshStmt.run(JSON.stringify(d.evidence), d.zohoModifiedAt, checkedAt, now, existing.alert_id);
      updated++;
      continue;
    }
    insertStmt.run(
      randomUUID(),
      sourceKey,
      d.entityType,
      d.entityId,
      d.ruleId,
      d.severity,
      d.detectionState,
      d.title,
      d.description,
      d.affectedAmount,
      JSON.stringify(d.evidence),
      d.recommendedAction,
      d.requiresProfessionalReview ? 1 : 0,
      d.zohoModifiedAt,
      fetchedAt,
      checkedAt,
      checkedAt,
      d.dedupKey,
      now,
      now
    );
    created++;
  }
  return { created, updated };
}

export function listAlerts(
  db: DatabaseSync,
  filter: { sourceKey?: string; severity?: string; status?: string } = {}
): Array<Record<string, unknown>> {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.sourceKey) { clauses.push("source_key = ?"); params.push(filter.sourceKey); }
  if (filter.severity) { clauses.push("severity = ?"); params.push(filter.severity); }
  if (filter.status) { clauses.push("status = ?"); params.push(filter.status); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM audit_p0_alerts ${where} ORDER BY severity ASC, alert_created_at DESC`).all(...params) as Array<Record<string, unknown>>;
}

export function getAlert(db: DatabaseSync, alertId: string): Record<string, unknown> | undefined {
  return db.prepare(`SELECT * FROM audit_p0_alerts WHERE alert_id = ?`).get(alertId) as Record<string, unknown> | undefined;
}

/** Owner-only status change (acknowledge/dismiss) — never automated. */
export function setAlertStatus(db: DatabaseSync, alertId: string, status: "OPEN" | "ACKNOWLEDGED" | "DISMISSED"): void {
  db.prepare(`UPDATE audit_p0_alerts SET status = ?, updated_at = ? WHERE alert_id = ?`).run(status, new Date().toISOString(), alertId);
}

/**
 * Alert lifecycle: when a detection pass for (sourceKey, ruleId) no longer
 * finds a condition for a previously-alerted entity (e.g. an overdue
 * invoice was paid), the OPEN/ACKNOWLEDGED alert is moved to
 * RESOLVED_BY_SOURCE_CHANGE with a resolved_at stamp — the row is never
 * deleted, and a DISMISSED alert (an explicit owner decision) is never
 * silently reopened or altered by this function. `activeDedupKeys` is the
 * complete set of dedup_keys the CURRENT detection pass actually produced
 * for this exact ruleId — anything previously open under that ruleId but
 * absent from this set is resolved.
 */
export function resolveStaleAlerts(db: DatabaseSync, sourceKey: string, ruleId: string, activeDedupKeys: Set<string>): number {
  const candidates = db
    .prepare(`SELECT alert_id, dedup_key FROM audit_p0_alerts WHERE source_key = ? AND rule_id = ? AND status IN ('OPEN', 'ACKNOWLEDGED')`)
    .all(sourceKey, ruleId) as Array<{ alert_id: string; dedup_key: string }>;
  const now = new Date().toISOString();
  let resolvedCount = 0;
  const resolveStmt = db.prepare(`UPDATE audit_p0_alerts SET status = 'RESOLVED_BY_SOURCE_CHANGE', resolved_at = ?, updated_at = ? WHERE alert_id = ?`);
  for (const c of candidates) {
    if (!activeDedupKeys.has(c.dedup_key)) {
      resolveStmt.run(now, now, c.alert_id);
      resolvedCount++;
    }
  }
  return resolvedCount;
}

/** Average and max latency (ms) between zoho_modified_at and alert_created_at, for alerts where both timestamps are known. Null fields are excluded, never coerced to zero. */
export function computeDetectionLatency(db: DatabaseSync, sourceKey?: string): { sampleSize: number; avgMs: number | null; maxMs: number | null } {
  const rows = (sourceKey
    ? db.prepare(`SELECT zoho_modified_at, alert_created_at FROM audit_p0_alerts WHERE source_key = ? AND zoho_modified_at IS NOT NULL`).all(sourceKey)
    : db.prepare(`SELECT zoho_modified_at, alert_created_at FROM audit_p0_alerts WHERE zoho_modified_at IS NOT NULL`).all()
  ) as Array<{ zoho_modified_at: string; alert_created_at: string }>;

  if (rows.length === 0) return { sampleSize: 0, avgMs: null, maxMs: null };
  const diffs = rows
    .map((r) => new Date(r.alert_created_at).getTime() - new Date(r.zoho_modified_at).getTime())
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  if (diffs.length === 0) return { sampleSize: 0, avgMs: null, maxMs: null };
  const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const max = Math.max(...diffs);
  return { sampleSize: diffs.length, avgMs: avg, maxMs: max };
}

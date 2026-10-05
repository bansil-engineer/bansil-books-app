// ============================================================
// Bansil Books Analytics — Item Traceability Alert Persistence
// Same dedup/lifecycle discipline as app/lib/audit/p0/alert-service.ts:
// deduplicated by dedup_key, never deleted, only an explicit owner
// action changes status, and a resolved-by-source-change transition
// (never auto-reopen of a DISMISSED row) when a later pass no longer
// finds the condition.
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { TraceabilityAlertDraft } from "./traceability-types.ts";

export interface UpsertResult {
  created: number;
  updated: number;
}

export function upsertTraceabilityAlerts(db: DatabaseSync, drafts: TraceabilityAlertDraft[], fetchedAt: string, checkedAt: string): UpsertResult {
  let created = 0;
  let updated = 0;
  const now = new Date().toISOString();

  const findExisting = db.prepare(`SELECT alert_id, status FROM audit_traceability_alerts WHERE dedup_key = ?`);
  const insertStmt = db.prepare(
    `INSERT INTO audit_traceability_alerts
     (alert_id, alert_type, entity_type, entity_id, rule_id, severity, detection_state, title, description,
      affected_qty, affected_amount, evidence_json, recommended_action, zoho_modified_at,
      fetched_at, checked_at, alert_created_at, status, dedup_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`
  );
  const refreshStmt = db.prepare(
    `UPDATE audit_traceability_alerts SET evidence_json = ?, zoho_modified_at = ?, checked_at = ?, updated_at = ? WHERE alert_id = ?`
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
      d.alertType,
      d.entityType,
      d.entityId,
      d.ruleId,
      d.severity,
      d.detectionState,
      d.title,
      d.description,
      d.affectedQty != null ? String(d.affectedQty) : null,
      d.affectedAmount != null ? String(d.affectedAmount) : null,
      JSON.stringify(d.evidence),
      d.recommendedAction,
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

export function listTraceabilityAlerts(db: DatabaseSync, filter: { alertType?: string; severity?: string; status?: string } = {}): Array<Record<string, unknown>> {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.alertType) { clauses.push("alert_type = ?"); params.push(filter.alertType); }
  if (filter.severity) { clauses.push("severity = ?"); params.push(filter.severity); }
  if (filter.status) { clauses.push("status = ?"); params.push(filter.status); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM audit_traceability_alerts ${where} ORDER BY severity ASC, alert_created_at DESC`).all(...params) as Array<Record<string, unknown>>;
}

export function setTraceabilityAlertStatus(db: DatabaseSync, alertId: string, status: "OPEN" | "ACKNOWLEDGED" | "DISMISSED"): void {
  db.prepare(`UPDATE audit_traceability_alerts SET status = ?, updated_at = ? WHERE alert_id = ?`).run(status, new Date().toISOString(), alertId);
}

/** Same never-reopen-DISMISSED, resolve-only-OPEN/ACKNOWLEDGED discipline as the P0 alert service. `activeDedupKeys` is the full set this pass produced for this exact ruleId. */
export function resolveStaleTraceabilityAlerts(db: DatabaseSync, ruleId: string, activeDedupKeys: Set<string>): number {
  const candidates = db
    .prepare(`SELECT alert_id, dedup_key FROM audit_traceability_alerts WHERE rule_id = ? AND status IN ('OPEN', 'ACKNOWLEDGED')`)
    .all(ruleId) as Array<{ alert_id: string; dedup_key: string }>;
  const now = new Date().toISOString();
  let resolvedCount = 0;
  const resolveStmt = db.prepare(`UPDATE audit_traceability_alerts SET status = 'RESOLVED_BY_SOURCE_CHANGE', resolved_at = ?, updated_at = ? WHERE alert_id = ?`);
  for (const c of candidates) {
    if (!activeDedupKeys.has(c.dedup_key)) {
      resolveStmt.run(now, now, c.alert_id);
      resolvedCount++;
    }
  }
  return resolvedCount;
}

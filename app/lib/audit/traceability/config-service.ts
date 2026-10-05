// ============================================================
// Bansil Books Analytics — Item Traceability Governed Config
// Same TEMPORARY_OWNER_REVIEW_REQUIRED discipline as
// app/lib/audit/p0/severity-config-service.ts — nothing here is a
// hardcoded policy constant in application code.
// ============================================================

import { DatabaseSync } from "node:sqlite";
import type { TraceabilityConfig } from "./alert-engine.ts";

export interface StoredTraceabilityConfig extends TraceabilityConfig {
  reviewStatus: "TEMPORARY_OWNER_REVIEW_REQUIRED" | "OWNER_CONFIRMED";
  updatedBy: string;
  updatedAt: string;
}

const SEED_DEFAULT: Omit<StoredTraceabilityConfig, "updatedBy" | "updatedAt"> = {
  graceDays: 30,
  overTolerancePercent: 2,
  rateTolerancePercent: 5,
  reviewStatus: "TEMPORARY_OWNER_REVIEW_REQUIRED",
};

function ensureSeeded(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_traceability_config (
      config_key TEXT PRIMARY KEY,
      grace_days INTEGER NOT NULL,
      over_tolerance_percent REAL NOT NULL,
      rate_tolerance_percent REAL NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'TEMPORARY_OWNER_REVIEW_REQUIRED',
      updated_by TEXT NOT NULL DEFAULT 'SYSTEM',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const existing = db.prepare(`SELECT config_key FROM audit_traceability_config WHERE config_key = 'DEFAULT'`).get();
  if (existing) return;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_traceability_config (config_key, grace_days, over_tolerance_percent, rate_tolerance_percent, review_status, updated_by, created_at, updated_at)
     VALUES ('DEFAULT', ?, ?, ?, ?, 'SYSTEM', ?, ?)`
  ).run(SEED_DEFAULT.graceDays, SEED_DEFAULT.overTolerancePercent, SEED_DEFAULT.rateTolerancePercent, SEED_DEFAULT.reviewStatus, now, now);
}

export function getTraceabilityConfig(db: DatabaseSync): StoredTraceabilityConfig {
  ensureSeeded(db);
  const row = db.prepare(`SELECT * FROM audit_traceability_config WHERE config_key = 'DEFAULT'`).get() as Record<string, unknown>;
  return {
    graceDays: Number(row.grace_days),
    overTolerancePercent: Number(row.over_tolerance_percent),
    rateTolerancePercent: Number(row.rate_tolerance_percent),
    reviewStatus: row.review_status as StoredTraceabilityConfig["reviewStatus"],
    updatedBy: String(row.updated_by),
    updatedAt: String(row.updated_at),
  };
}

export function updateTraceabilityConfig(
  db: DatabaseSync,
  fields: { graceDays: number; overTolerancePercent: number; rateTolerancePercent: number; reviewStatus: "TEMPORARY_OWNER_REVIEW_REQUIRED" | "OWNER_CONFIRMED" },
  actor: string
): StoredTraceabilityConfig {
  ensureSeeded(db);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE audit_traceability_config SET grace_days = ?, over_tolerance_percent = ?, rate_tolerance_percent = ?, review_status = ?, updated_by = ?, updated_at = ? WHERE config_key = 'DEFAULT'`
  ).run(fields.graceDays, fields.overTolerancePercent, fields.rateTolerancePercent, fields.reviewStatus, actor, now);
  return getTraceabilityConfig(db);
}

// ============================================================
// Bansil Books Analytics — Phase F.0 Governed Materiality/Severity Config
// NOT a hardcoded accounting policy. Every threshold here is stored,
// owner-editable, and the seed row is explicitly labeled
// TEMPORARY_OWNER_REVIEW_REQUIRED until the owner explicitly confirms it
// via OWNER_CONFIRMED — matching the owner's instruction that this must
// never be treated as permanent policy without their sign-off.
// ============================================================

import { DatabaseSync } from "node:sqlite";

export interface SeverityConfig {
  amountMaterialityThreshold: number;
  overdueBandMediumDays: number;
  overdueBandHighDays: number;
  overdueBandCriticalDays: number;
  reviewStatus: "TEMPORARY_OWNER_REVIEW_REQUIRED" | "OWNER_CONFIRMED";
  updatedBy: string;
  updatedAt: string;
}

/** First-pass defaults — deliberately conservative, explicitly NOT owner-approved policy until confirmed. */
const SEED_DEFAULT: Omit<SeverityConfig, "updatedBy" | "updatedAt"> = {
  amountMaterialityThreshold: 100000,
  overdueBandMediumDays: 60,
  overdueBandHighDays: 90,
  overdueBandCriticalDays: 90, // same threshold as HIGH — materiality is what escalates HIGH -> CRITICAL, not age alone
  reviewStatus: "TEMPORARY_OWNER_REVIEW_REQUIRED",
};

function ensureSeeded(db: DatabaseSync): void {
  const existing = db.prepare(`SELECT config_key FROM audit_p0_severity_config WHERE config_key = 'DEFAULT'`).get();
  if (existing) return;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_p0_severity_config
     (config_key, amount_materiality_threshold, overdue_band_medium_days, overdue_band_high_days, overdue_band_critical_days, review_status, updated_by, created_at, updated_at)
     VALUES ('DEFAULT', ?, ?, ?, ?, ?, 'SYSTEM', ?, ?)`
  ).run(
    String(SEED_DEFAULT.amountMaterialityThreshold),
    SEED_DEFAULT.overdueBandMediumDays,
    SEED_DEFAULT.overdueBandHighDays,
    SEED_DEFAULT.overdueBandCriticalDays,
    SEED_DEFAULT.reviewStatus,
    now,
    now
  );
}

export function getSeverityConfig(db: DatabaseSync): SeverityConfig {
  ensureSeeded(db);
  const row = db.prepare(`SELECT * FROM audit_p0_severity_config WHERE config_key = 'DEFAULT'`).get() as Record<string, unknown>;
  return {
    amountMaterialityThreshold: Number(row.amount_materiality_threshold),
    overdueBandMediumDays: Number(row.overdue_band_medium_days),
    overdueBandHighDays: Number(row.overdue_band_high_days),
    overdueBandCriticalDays: Number(row.overdue_band_critical_days),
    reviewStatus: row.review_status as SeverityConfig["reviewStatus"],
    updatedBy: String(row.updated_by),
    updatedAt: String(row.updated_at),
  };
}

/** Owner-only update — every field explicitly supplied, no partial-merge surprises. Setting reviewStatus to OWNER_CONFIRMED is itself an explicit owner action, never automatic. */
export function updateSeverityConfig(
  db: DatabaseSync,
  fields: { amountMaterialityThreshold: number; overdueBandMediumDays: number; overdueBandHighDays: number; overdueBandCriticalDays: number; reviewStatus: "TEMPORARY_OWNER_REVIEW_REQUIRED" | "OWNER_CONFIRMED" },
  actor: string
): SeverityConfig {
  ensureSeeded(db);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE audit_p0_severity_config SET
       amount_materiality_threshold = ?, overdue_band_medium_days = ?, overdue_band_high_days = ?, overdue_band_critical_days = ?,
       review_status = ?, updated_by = ?, updated_at = ?
     WHERE config_key = 'DEFAULT'`
  ).run(
    String(fields.amountMaterialityThreshold),
    fields.overdueBandMediumDays,
    fields.overdueBandHighDays,
    fields.overdueBandCriticalDays,
    fields.reviewStatus,
    actor,
    now
  );
  return getSeverityConfig(db);
}

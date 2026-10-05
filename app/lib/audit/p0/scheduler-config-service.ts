// ============================================================
// Bansil Books Analytics — Phase F.0 STEP 3: Automatic Audit Cycle Config
// Owner decision (this pass): default interval 4 hours, freshness bands
// 0-4h FRESH / 4-8h STALE / >8h or repeated failure SYNC_FAILED/
// REVIEW_REQUIRED. Fully owner-editable — never hardcoded in application
// logic; every consumer reads this table.
// ============================================================

import { DatabaseSync } from "node:sqlite";

export interface SchedulerConfig {
  intervalHours: number;
  freshBandHours: number;
  staleBandHours: number;
  enabled: boolean;
  lastAutomaticRunAt: string | null;
  nextScheduledRunAt: string | null;
  reviewStatus: "OWNER_CONFIRMED" | "TEMPORARY_OWNER_REVIEW_REQUIRED";
  updatedBy: string;
  updatedAt: string;
}

const SEED_DEFAULT = {
  intervalHours: 4,
  freshBandHours: 4,
  staleBandHours: 8,
  enabled: true,
  reviewStatus: "OWNER_CONFIRMED" as const,
};

function ensureSeeded(db: DatabaseSync): void {
  const existing = db.prepare(`SELECT config_key FROM audit_p0_scheduler_config WHERE config_key = 'DEFAULT'`).get();
  if (existing) return;
  const now = new Date().toISOString();
  // next_scheduled_run_at starts NULL, never a computed future timestamp — a scheduler
  // that has never run must report "due immediately" via isAutomaticCycleDue's own
  // `!config.nextScheduledRunAt` fast-path. Seeding a non-null value here (previously
  // derived from the real wall clock) defeated that fast-path and made "never run"
  // depend on clock alignment with whatever `now` a caller later checks against.
  db.prepare(
    `INSERT INTO audit_p0_scheduler_config
     (config_key, interval_hours, fresh_band_hours, stale_band_hours, enabled, last_automatic_run_at, next_scheduled_run_at, review_status, updated_by, created_at, updated_at)
     VALUES ('DEFAULT', ?, ?, ?, ?, NULL, NULL, ?, 'SYSTEM', ?, ?)`
  ).run(
    SEED_DEFAULT.intervalHours,
    SEED_DEFAULT.freshBandHours,
    SEED_DEFAULT.staleBandHours,
    SEED_DEFAULT.enabled ? 1 : 0,
    SEED_DEFAULT.reviewStatus,
    now,
    now
  );
}

function rowToConfig(row: Record<string, unknown>): SchedulerConfig {
  return {
    intervalHours: Number(row.interval_hours),
    freshBandHours: Number(row.fresh_band_hours),
    staleBandHours: Number(row.stale_band_hours),
    enabled: Number(row.enabled) === 1,
    lastAutomaticRunAt: (row.last_automatic_run_at as string | null) ?? null,
    nextScheduledRunAt: (row.next_scheduled_run_at as string | null) ?? null,
    reviewStatus: row.review_status as SchedulerConfig["reviewStatus"],
    updatedBy: String(row.updated_by),
    updatedAt: String(row.updated_at),
  };
}

export function getSchedulerConfig(db: DatabaseSync): SchedulerConfig {
  ensureSeeded(db);
  const row = db.prepare(`SELECT * FROM audit_p0_scheduler_config WHERE config_key = 'DEFAULT'`).get() as Record<string, unknown>;
  return rowToConfig(row);
}

/** Owner-only. Changing intervalHours/bands takes effect on the next due-check — never retroactively reclassifies history. */
export function updateSchedulerConfig(
  db: DatabaseSync,
  fields: { intervalHours: number; freshBandHours: number; staleBandHours: number; enabled: boolean },
  actor: string
): SchedulerConfig {
  ensureSeeded(db);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE audit_p0_scheduler_config SET interval_hours = ?, fresh_band_hours = ?, stale_band_hours = ?, enabled = ?, updated_by = ?, updated_at = ? WHERE config_key = 'DEFAULT'`
  ).run(fields.intervalHours, fields.freshBandHours, fields.staleBandHours, fields.enabled ? 1 : 0, actor, now);
  return getSchedulerConfig(db);
}

export function recordAutomaticRun(db: DatabaseSync, ranAt: string): void {
  const config = getSchedulerConfig(db);
  const next = new Date(new Date(ranAt).getTime() + config.intervalHours * 3600000).toISOString();
  db.prepare(`UPDATE audit_p0_scheduler_config SET last_automatic_run_at = ?, next_scheduled_run_at = ?, updated_at = ? WHERE config_key = 'DEFAULT'`).run(ranAt, next, new Date().toISOString());
}

/** Whether an automatic cycle is currently due — pure function of stored state, never a side effect. */
export function isAutomaticCycleDue(db: DatabaseSync, now: Date = new Date()): boolean {
  const config = getSchedulerConfig(db);
  if (!config.enabled) return false;
  if (!config.nextScheduledRunAt) return true;
  return now.getTime() >= new Date(config.nextScheduledRunAt).getTime();
}

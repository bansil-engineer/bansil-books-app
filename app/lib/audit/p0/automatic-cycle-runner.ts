// ============================================================
// Bansil Books Analytics — Phase F.0 STEP 3: Automatic Audit Cycle
// Runs the SAME runP0Sync pipeline manual "Sync Now" uses — never a
// separate/duplicate code path. Overlap between an automatic tick and a
// manual click is prevented by the sync_locks table (see sync-scheduler.ts)
// shared with every other sync mechanism in this app.
// ============================================================

import { getAuditDatabase } from "../../db/audit-database.ts";
import { runP0Sync } from "./sync-scheduler.ts";
import { getSchedulerConfig, isAutomaticCycleDue, recordAutomaticRun } from "./scheduler-config-service.ts";
import { featureEnabled } from "../../feature-guard.ts";

let cycleInFlight = false;

/**
 * Checks whether an automatic cycle is due and, if so, runs both
 * Customer and Vendor Outstanding (P0) through the real sync pipeline,
 * and — per "Item Traceability must join the already-approved audit
 * cycle" — Item Traceability (Sales Order / Purchase Order / Item
 * Master + chain recompute) through its own pipeline, sharing this same
 * 4-hour due-check/timer rather than running a second independent one.
 * Item Traceability is independently feature-gated
 * (audit_feat_trace_scheduler) and its failure never blocks P0's own run
 * or vice versa. Safe to call frequently (e.g. every few minutes) — it
 * is a no-op read of local state on every call except when actually
 * due, and a process-local `cycleInFlight` flag plus the DB-level
 * sync_locks table both prevent overlapping runs.
 */
export async function runAutomaticP0CycleIfDue(now: Date = new Date()): Promise<{ ran: boolean; results?: Array<{ sourceKey: string; status: string }>; traceability?: { ran: boolean; error?: string } }> {
  if (cycleInFlight) return { ran: false };
  const db = getAuditDatabase();
  const p0Enabled = featureEnabled("audit_feat_p0_scheduler");
  const traceEnabled = featureEnabled("audit_feat_trace_scheduler");
  if (!p0Enabled && !traceEnabled) return { ran: false };
  if (!isAutomaticCycleDue(db, now)) return { ran: false };

  cycleInFlight = true;
  try {
    const results: Array<{ sourceKey: string; status: string }> = [];
    if (p0Enabled) {
      for (const sourceKey of ["CUSTOMER_OUTSTANDING", "VENDOR_OUTSTANDING"] as const) {
        const result = await runP0Sync(db, sourceKey, now);
        results.push({ sourceKey, status: result.status });
      }
    }

    let traceability: { ran: boolean; error?: string } | undefined;
    if (traceEnabled) {
      try {
        const { runFullTraceabilitySync } = await import("../traceability/sync-scheduler.ts");
        const { getDatabase } = await import("../../db/database.ts");
        const { resolveOrganizationId } = await import("../traceability/organization-resolver.ts");
        const booksAppDb = getDatabase();
        await runFullTraceabilitySync(db, booksAppDb, resolveOrganizationId());
        traceability = { ran: true };
      } catch (e) {
        traceability = { ran: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    recordAutomaticRun(db, now.toISOString());
    return { ran: true, results, traceability };
  } finally {
    cycleInFlight = false;
  }
}

/** Exposed for tests/diagnostics only — never call directly from a request handler to force a sync (use the explicit /api/audit/p0/sync route for that). */
export function getSchedulerConfigSnapshot() {
  const db = getAuditDatabase();
  return getSchedulerConfig(db);
}

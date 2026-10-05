// ============================================================
// Bansil Books Analytics — Item Traceability Sync Scheduler
// Mirrors app/lib/audit/p0/sync-scheduler.ts's shape: sync_locks overlap
// prevention, checkpoint-never-advances-on-failure, consecutive-failure
// escalation, and injectable Zoho calls so tests never touch the network.
// Each of the 3 sources syncs independently and recomputes the shared
// chain/alerts afterward — a failure in one source never blocks the
// others, and the chain recompute always runs against whatever is
// currently cached (never blocked entirely by one source's failure).
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { syncSalesOrders, syncPurchaseOrders, syncItemMaster, type SyncOutcome } from "./traceability-sync.ts";
import { recomputeTraceabilityChain } from "./chain-service.ts";
import { getTraceabilitySourceStatus, updateTraceabilitySourceStatus, ensureTraceabilitySourceStatusSeeded } from "./source-status-service.ts";
import type { TraceabilitySourceKey } from "./traceability-types.ts";

const REVIEW_REQUIRED_AFTER_CONSECUTIVE_FAILURES = 3;

function lockKeyFor(sourceKey: string): string {
  return `traceability_sync_${sourceKey.toLowerCase()}`;
}

export type TraceabilitySyncFn = (db: DatabaseSync, organizationId: string, sinceModifiedTime?: string) => Promise<SyncOutcome>;

export interface TraceabilitySyncInjections {
  syncSalesOrders?: TraceabilitySyncFn;
  syncPurchaseOrders?: TraceabilitySyncFn;
  syncItemMaster?: TraceabilitySyncFn;
}

export interface TraceabilitySyncRunResult {
  sourceKey: TraceabilitySourceKey;
  status: "SUCCESS" | "FAILED" | "BLOCKED_PENDING_OAUTH_RECONNECT" | "SKIPPED_CONCURRENT";
  recordsFetched: number;
  recordsNew: number;
  recordsChanged: number;
  apiCallCount: number;
  errorMessage?: string;
}

function classifyCoverage(lastSyncedAt: string | null, freshBandHours: number, staleBandHours: number, consecutiveFailures: number, failed: boolean): string {
  if (consecutiveFailures >= REVIEW_REQUIRED_AFTER_CONSECUTIVE_FAILURES) return "REVIEW_REQUIRED";
  if (failed) return "SYNC_FAILED";
  if (!lastSyncedAt) return "NOT_TESTED";
  const ageHours = (Date.now() - new Date(lastSyncedAt).getTime()) / 3600000;
  if (!Number.isFinite(ageHours) || ageHours < 0) return "NOT_TESTED";
  if (ageHours <= freshBandHours) return "AVAILABLE_AND_FRESH";
  if (ageHours <= staleBandHours) return "AVAILABLE_BUT_STALE";
  return "SYNC_FAILED";
}

/** Runs one source's sync. A source still carrying a blocked_reason (its OAuth scope isn't yet granted on the live token) returns BLOCKED_PENDING_OAUTH_RECONNECT and makes zero Zoho calls — blocked_reason is the sole authoritative gate, cleared explicitly once a reconnect verification confirms the scope is live. */
export async function runTraceabilitySourceSync(
  auditDb: DatabaseSync,
  sourceKey: TraceabilitySourceKey,
  organizationId: string | null,
  injections: TraceabilitySyncInjections = {}
): Promise<TraceabilitySyncRunResult> {
  ensureTraceabilitySourceStatusSeeded(auditDb);
  const status = getTraceabilitySourceStatus(auditDb, sourceKey);
  if (status?.blocked_reason) {
    return { sourceKey, status: "BLOCKED_PENDING_OAUTH_RECONNECT", recordsFetched: 0, recordsNew: 0, recordsChanged: 0, apiCallCount: 0, errorMessage: String(status.blocked_reason) };
  }
  if (!organizationId) {
    return { sourceKey, status: "FAILED", recordsFetched: 0, recordsNew: 0, recordsChanged: 0, apiCallCount: 0, errorMessage: "No Zoho organization connected." };
  }

  const { getDatabase, acquireSyncLock, releaseSyncLock } = await import("../../db/database.ts");
  const booksWriteDb = getDatabase();
  const lockKey = lockKeyFor(sourceKey);
  if (!acquireSyncLock(booksWriteDb, lockKey, 120000, "traceability-scheduler")) {
    return { sourceKey, status: "SKIPPED_CONCURRENT", recordsFetched: 0, recordsNew: 0, recordsChanged: 0, apiCallCount: 0, errorMessage: `Another ${sourceKey} sync is already running` };
  }

  const consecutiveFailures = Number(status?.consecutive_failures ?? 0);
  const lastCheckpoint = (status?.last_checkpoint as string | null) ?? undefined;

  const syncFn: TraceabilitySyncFn =
    sourceKey === "SALES_ORDER" ? (injections.syncSalesOrders ?? syncSalesOrders)
    : sourceKey === "PURCHASE_ORDER" ? (injections.syncPurchaseOrders ?? syncPurchaseOrders)
    : (injections.syncItemMaster ?? syncItemMaster);

  const now = new Date().toISOString();
  try {
    const outcome = await syncFn(auditDb, organizationId, lastCheckpoint);
    updateTraceabilitySourceStatus(auditDb, sourceKey, {
      coverageStatus: "AVAILABLE_AND_FRESH",
      lastSyncedAt: now,
      lastCheckpoint: now,
      apiCallDelta: outcome.apiCallCount,
      recordCount: outcome.recordsFetched,
      resetFailures: true,
    });
    return { sourceKey, status: "SUCCESS", recordsFetched: outcome.recordsFetched, recordsNew: outcome.recordsNew, recordsChanged: outcome.recordsChanged, apiCallCount: outcome.apiCallCount };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const coverageStatus = consecutiveFailures + 1 >= REVIEW_REQUIRED_AFTER_CONSECUTIVE_FAILURES ? "REVIEW_REQUIRED" : "SYNC_FAILED";
    updateTraceabilitySourceStatus(auditDb, sourceKey, { coverageStatus, incrementFailures: true });
    return { sourceKey, status: "FAILED", recordsFetched: 0, recordsNew: 0, recordsChanged: 0, apiCallCount: 0, errorMessage: message };
  } finally {
    releaseSyncLock(booksWriteDb, lockKey);
  }
}

export interface FullSyncResult {
  sources: TraceabilitySyncRunResult[];
  chain?: ReturnType<typeof recomputeTraceabilityChain>;
}

/** Syncs every non-blocked source, then always recomputes the chain+alerts from whatever is cached (even if a source sync failed) — never leaves the dashboard silently stale after a partial failure. */
export async function runFullTraceabilitySync(auditDb: DatabaseSync, booksAppDb: DatabaseSync, organizationId: string | null, injections: TraceabilitySyncInjections = {}): Promise<FullSyncResult> {
  const sources: TraceabilitySyncRunResult[] = [];
  for (const sourceKey of ["ITEM_MASTER", "SALES_ORDER", "PURCHASE_ORDER"] as TraceabilitySourceKey[]) {
    sources.push(await runTraceabilitySourceSync(auditDb, sourceKey, organizationId, injections));
  }
  const chain = recomputeTraceabilityChain(auditDb, booksAppDb, "OWNER");
  return { sources, chain };
}

export { classifyCoverage };

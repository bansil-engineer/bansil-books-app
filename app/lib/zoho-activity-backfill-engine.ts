// ============================================================
// Bansil Books Analytics — Zoho Activity Durable Month-Wise Backfill
// Resumable, budgeted, read-only (GET) historical activity backfill.
// Separate from zoho-activity-engine.ts (current-FY incremental/full sync),
// which is untouched by this file.
// ============================================================

import {
  getDatabase,
  acquireSyncLock,
  releaseSyncLock,
  findResumableActivityBackfillJob,
  createActivityBackfillJob,
  getActivityBackfillJob,
  getActivityBackfillWindows,
  setActivityBackfillJobStatus,
  recordActivityBackfillWindowProgress,
  saveActivityLogsBatch,
  recordApiCall,
  type ZohoActivityLogRecord,
  type ActivityBackfillWindowRecord,
} from "./db/database.ts";
import { getIndianFinancialYearRange } from "./date-period-utils.ts";
import { fetchActivityLogs, type ZohoActivityEvent, type ZohoActivityLogsResponse } from "./zoho-api.ts";
import type { DatabaseSync } from "node:sqlite";

export type FetchActivityPageFn = (options: {
  organizationId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  perPage?: number;
}) => Promise<ZohoActivityLogsResponse>;

export interface ActivityBackfillOptions {
  organizationId?: string;
  fromDate?: string;
  toDate?: string;
  maxRequests?: number;
  fetchPageFn?: FetchActivityPageFn;
  /** Test-only: inject an isolated DatabaseSync instead of the production singleton. */
  db?: DatabaseSync;
}

export interface ActivityBackfillWindowResult {
  from: string;
  to: string;
  status: ActivityBackfillWindowRecord["status"];
  pagesSaved: number;
  uniqueRecords: number;
  nextPage: number;
  outOfWindowCount: number;
  lastError: string | null;
}

export interface ActivityBackfillRunResult {
  jobId: string;
  overallStatus: "COMPLETE" | "PARTIAL" | "PAUSED" | "BLOCKED" | "FAILED";
  requestBudget: number;
  actualRequests: number;
  windows: ActivityBackfillWindowResult[];
  rowsBefore: number;
  rowsAfter: number;
  newRecords: number;
  refreshedRecords: number;
  blockedReason?: string;
}

/**
 * Splits [fromDate, toDate] into calendar-month-aligned windows, the last one
 * truncated at toDate. E.g. 2026-04-01..2026-07-06 -> Apr, May, Jun, Jul 1-6.
 */
export function splitIntoMonthWindows(fromDate: string, toDate: string): { from: string; to: string }[] {
  const windows: { from: string; to: string }[] = [];
  let cursor = fromDate;
  while (cursor <= toDate) {
    const [y, m] = cursor.split("-").map(Number);
    const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDayOfMonth).padStart(2, "0")}`;
    const windowEnd = monthEnd < toDate ? monthEnd : toDate;
    windows.push({ from: cursor, to: windowEnd });

    const next = new Date(Date.UTC(y, m, 1)); // first day of next month
    cursor = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  return windows;
}

/**
 * Maps a parsed ZohoActivityEvent to the storage record. Mirrors the mapping in
 * zoho-activity-engine.ts's syncZohoActivityLogs (kept as a separate copy here
 * deliberately — that engine is left untouched per instruction, this backfill engine
 * owns its own copy so the two can never accidentally diverge from an edit meant for
 * only one of them).
 */
function mapEventToRecord(event: ZohoActivityEvent, syncedAt: string): ZohoActivityLogRecord {
  const eventDate = event.date || event.activity_date || (event.activity_datetime ? event.activity_datetime.slice(0, 10) : "");
  return {
    activity_id: event.activity_id,
    date: eventDate,
    time: event.time || null,
    user_name: event.user_name || null,
    user_id: event.user_id || null,
    module: event.module,
    action: event.action,
    description: event.description || null,
    entity_id: event.entity_id || null,
    entity_number: event.entity_number || event.document_number || null,
    ip_address: event.ip_address || event.source_ip || null,
    source: event.source || null,
    created_time: event.created_time || null,
    activity_type: event.activity_type || null,
    module_source: event.module_source || null,
    reference_type: event.reference_type || null,
    reference_id: event.reference_id || null,
    reference_number: event.reference_number || null,
    linked_bill_id: event.linked_bill_id || null,
    linked_invoice_id: event.linked_invoice_id || null,
    raw_payload_json: event.raw_payload_json || null,
    detail_party_name: event.detail_party_name || null,
    detail_party_id: event.detail_party_id || null,
    synced_at: syncedAt,
  };
}

const DEFAULT_BACKFILL_FROM = "2026-04-01";
const DEFAULT_BACKFILL_TO = "2026-07-06";

/**
 * Runs (or resumes) a durable, budgeted, month-wise Zoho Activity backfill.
 *
 * - Never restarts a job that already has progress for the same org+date-range; it
 *   resumes from each window's saved next_page.
 * - Spends at most `maxRequests` external calls this invocation (default 50), then
 *   saves progress and returns PAUSED — safe to call again to continue.
 * - A window is only ever marked COMPLETE when the API's own hasMore reaches false
 *   for that window; row counts/min-max dates are never used as a completion proxy.
 * - Every page's cache writes + progress bookkeeping commit together in one short
 *   transaction, opened only after the network response is already in hand.
 * - A sync_locks-based lock prevents two backfill runs overlapping for the same org.
 */
export async function runActivityBackfill(options: ActivityBackfillOptions = {}): Promise<ActivityBackfillRunResult> {
  const db = options.db || getDatabase();
  const organizationId = options.organizationId || "774390949";
  const fromDate = options.fromDate || DEFAULT_BACKFILL_FROM;
  const toDate = options.toDate || DEFAULT_BACKFILL_TO;
  const maxRequests = options.maxRequests ?? 50;
  const fetchPage: FetchActivityPageFn = options.fetchPageFn || fetchActivityLogs;

  const lockKey = `activity_backfill:${organizationId}`;
  const gotLock = acquireSyncLock(db, lockKey, 10 * 60 * 1000, "activity_backfill");
  if (!gotLock) {
    return {
      jobId: "",
      overallStatus: "BLOCKED",
      requestBudget: maxRequests,
      actualRequests: 0,
      windows: [],
      rowsBefore: 0,
      rowsAfter: 0,
      newRecords: 0,
      refreshedRecords: 0,
      blockedReason: "Another Activity backfill job is already running for this organization.",
    };
  }

  try {
    const fyLabel = getIndianFinancialYearRange(new Date(), 0).label;
    const existingJob = findResumableActivityBackfillJob(db, organizationId, fromDate, toDate);
    let jobId: string;
    if (existingJob) {
      jobId = existingJob.job_id;
    } else {
      jobId = `actbf_${organizationId}_${fromDate}_${toDate}`;
      const windows = splitIntoMonthWindows(fromDate, toDate);
      createActivityBackfillJob(db, { jobId, organizationId, financialYear: fyLabel, fromDate, toDate, windows });
    }
    setActivityBackfillJobStatus(db, jobId, "RUNNING");

    const rowsBefore = (db.prepare("SELECT COUNT(*) c FROM zoho_activity_logs").get() as { c: number }).c;

    let requestsUsed = 0;
    let newTotal = 0;
    let updatedTotal = 0;
    let blockedError: string | undefined;
    let hitBudget = false;

    const windows = getActivityBackfillWindows(db, jobId);
    const windowResults: ActivityBackfillWindowResult[] = [];

    for (const w of windows) {
      if (w.status === "COMPLETE") {
        windowResults.push({
          from: w.window_from, to: w.window_to, status: "COMPLETE",
          pagesSaved: w.next_page - 1, uniqueRecords: w.records_seen,
          nextPage: w.next_page, outOfWindowCount: w.out_of_window_count, lastError: w.last_error,
        });
        continue;
      }

      if (requestsUsed >= maxRequests || blockedError) {
        // Budget already spent (or a hard error already occurred) — report this
        // window's current saved state untouched, don't touch it this run.
        windowResults.push({
          from: w.window_from, to: w.window_to, status: w.status,
          pagesSaved: w.next_page - 1, uniqueRecords: w.records_seen,
          nextPage: w.next_page, outOfWindowCount: w.out_of_window_count, lastError: w.last_error,
        });
        continue;
      }

      let page = w.next_page;
      let hasMore = true;
      let previousFingerprint: string | null = w.last_page_fingerprint;
      recordActivityBackfillWindowProgress(db, jobId, w.window_from, w.window_to, { status: "RUNNING" });

      while (hasMore && requestsUsed < maxRequests) {
        let res: ZohoActivityLogsResponse;
        try {
          res = await fetchPage({ organizationId, fromDate: w.window_from, toDate: w.window_to, page, perPage: w.page_size });
        } catch (err) {
          // A real external attempt was made (and failed) — record it exactly once,
          // via the same shared counter every other Zoho caller uses, so this failed
          // attempt is never invisible to the app's global API-usage accounting.
          requestsUsed++;
          recordApiCall(db);
          const msg = err instanceof Error ? err.message : "network_error";
          recordActivityBackfillWindowProgress(db, jobId, w.window_from, w.window_to, { status: "PARTIAL", lastError: msg, apiCallsDelta: 1 });
          blockedError = msg;
          hasMore = false;
          break;
        }
        requestsUsed++;
        // Single source of truth for "a real Zoho HTTP request happened" — mirrors the
        // exact placement used by the existing incremental/full-FY engine
        // (zoho-activity-engine.ts: apiCallsUsed++ / recordApiCall(db) immediately after
        // the awaited fetch settles). Called once per fetchPage() call regardless of the
        // response outcome below (success, NOT_AUTHORIZED, error status, repeated page)
        // so a single attempt is never counted twice.
        recordApiCall(db);

        if (res.isNotAuthorized || res.statusCode === 401 || res.code === 57) {
          recordActivityBackfillWindowProgress(db, jobId, w.window_from, w.window_to, {
            status: "PARTIAL", lastError: "NOT_AUTHORIZED", apiCallsDelta: 1,
          });
          blockedError = "NOT_AUTHORIZED";
          hasMore = false;
          break;
        }

        if (res.statusCode !== 200 || !Array.isArray(res.activities)) {
          const msg = `fetch_error_${res.statusCode}`;
          recordActivityBackfillWindowProgress(db, jobId, w.window_from, w.window_to, {
            status: "PARTIAL", lastError: msg, apiCallsDelta: 1,
          });
          blockedError = msg;
          hasMore = false;
          break;
        }

        // Repeated-page guard: identical activity_id set as last page => stuck
        // pagination. Stop this window without unlimited retries.
        const fingerprint = res.activities.map((a) => a.activity_id).sort().join(",");
        if (fingerprint && fingerprint === previousFingerprint) {
          recordActivityBackfillWindowProgress(db, jobId, w.window_from, w.window_to, {
            status: "PARTIAL", lastError: "repeated_page", apiCallsDelta: 1,
          });
          blockedError = "repeated_page";
          hasMore = false;
          break;
        }

        // Every returned record is saved under its own real date — an out-of-window
        // record is still genuine Zoho activity and must not be silently dropped, but
        // its presence never counts toward "this window is complete" either.
        const syncedAt = new Date().toISOString();
        let outOfWindowCount = 0;
        const recordsToSave: ZohoActivityLogRecord[] = res.activities.map((ev) => {
          const d = ev.date || ev.activity_date || "";
          if (d < w.window_from || d > w.window_to) outOfWindowCount++;
          return mapEventToRecord(ev, syncedAt);
        });

        const nextPage = page + 1;
        const nextHasMore = res.hasMore;

        // Short local transaction: cache write + progress bookkeeping commit together,
        // opened only now that the network round-trip is already finished.
        db.exec("BEGIN");
        try {
          let newC = 0;
          let updC = 0;
          if (recordsToSave.length > 0) {
            const r = saveActivityLogsBatch(db, recordsToSave);
            newC = r.newActivities;
            updC = r.updatedActivities;
          }
          recordActivityBackfillWindowProgress(db, jobId, w.window_from, w.window_to, {
            nextPage,
            lastPageFingerprint: fingerprint || null,
            recordsSeenDelta: res.activities.length,
            recordsNewDelta: newC,
            recordsUpdatedDelta: updC,
            outOfWindowDelta: outOfWindowCount,
            apiCallsDelta: 1,
            status: nextHasMore ? "RUNNING" : "COMPLETE",
            markCompleted: !nextHasMore,
          });
          db.exec("COMMIT");
          newTotal += newC;
          updatedTotal += updC;
        } catch (txErr) {
          db.exec("ROLLBACK");
          throw txErr;
        }

        previousFingerprint = fingerprint || null;
        page = nextPage;
        hasMore = nextHasMore;
      }

      if (requestsUsed >= maxRequests && hasMore) {
        hitBudget = true;
      }

      const refreshed = getActivityBackfillWindows(db, jobId).find(
        (x) => x.window_from === w.window_from && x.window_to === w.window_to
      )!;
      windowResults.push({
        from: w.window_from, to: w.window_to, status: refreshed.status,
        pagesSaved: refreshed.next_page - 1, uniqueRecords: refreshed.records_seen,
        nextPage: refreshed.next_page, outOfWindowCount: refreshed.out_of_window_count, lastError: refreshed.last_error,
      });

      if (requestsUsed >= maxRequests || blockedError) break;
    }

    // Any windows this run never reached (budget spent, or a hard error) are still
    // reported with their current (untouched) saved state, so the caller always sees
    // the full picture of what remains — not just what happened to run this time.
    const reportedKeys = new Set(windowResults.map((w) => `${w.from}|${w.to}`));
    for (const w of windows) {
      const key = `${w.window_from}|${w.window_to}`;
      if (reportedKeys.has(key)) continue;
      windowResults.push({
        from: w.window_from, to: w.window_to, status: w.status,
        pagesSaved: w.next_page - 1, uniqueRecords: w.records_seen,
        nextPage: w.next_page, outOfWindowCount: w.out_of_window_count, lastError: w.last_error,
      });
    }

    const rowsAfter = (db.prepare("SELECT COUNT(*) c FROM zoho_activity_logs").get() as { c: number }).c;

    const finalWindows = getActivityBackfillWindows(db, jobId);
    const allComplete = finalWindows.every((w) => w.status === "COMPLETE");

    let overallStatus: ActivityBackfillRunResult["overallStatus"];
    let jobStatus: "PENDING" | "RUNNING" | "PAUSED" | "PARTIAL" | "COMPLETE" | "FAILED";
    if (blockedError === "NOT_AUTHORIZED") {
      overallStatus = "FAILED";
      jobStatus = "FAILED";
    } else if (allComplete) {
      overallStatus = "COMPLETE";
      jobStatus = "COMPLETE";
    } else if (hitBudget) {
      overallStatus = "PAUSED";
      jobStatus = "PAUSED";
    } else {
      overallStatus = "PARTIAL";
      jobStatus = "PARTIAL";
    }
    setActivityBackfillJobStatus(db, jobId, jobStatus, blockedError || null);

    return {
      jobId,
      overallStatus,
      requestBudget: maxRequests,
      actualRequests: requestsUsed,
      windows: windowResults,
      rowsBefore,
      rowsAfter,
      newRecords: newTotal,
      refreshedRecords: updatedTotal,
      blockedReason: blockedError,
    };
  } finally {
    releaseSyncLock(db, lockKey);
  }
}

/**
 * Read-only status check for the UI: current job (if any) for this org+range and its
 * per-window progress, without starting or resuming anything.
 */
export function getActivityBackfillStatus(
  organizationId: string = "774390949",
  fromDate: string = DEFAULT_BACKFILL_FROM,
  toDate: string = DEFAULT_BACKFILL_TO,
  db?: DatabaseSync
) {
  const conn = db || getDatabase();
  const job = findResumableActivityBackfillJob(conn, organizationId, fromDate, toDate) || getActivityBackfillJob(conn, `actbf_${organizationId}_${fromDate}_${toDate}`);
  if (!job) {
    return { exists: false as const };
  }
  const windows = getActivityBackfillWindows(conn, job.job_id);
  const unverifiedRow = conn.prepare(
    "SELECT COUNT(*) c FROM zoho_activity_logs WHERE date >= ? AND date <= ? AND raw_payload_json IS NULL"
  ).get(fromDate, toDate) as { c: number };
  return { exists: true as const, job, windows, unverifiedLegacyCount: unverifiedRow.c };
}

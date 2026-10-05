// ============================================================
// Bansil Books Analytics — Zoho Books Activity Sync Engine
// Official Reports Activity Logs API · Strictly Read-Only (GET)
// Current Financial Year Only · Incremental Sync · Local SQLite
// ============================================================

import {
  getDatabase,
  getSyncMetadata,
  setSyncMetadata,
  recordApiCall,
  saveActivityLogsBatch,
  getActivityKpis,
  getActivitySyncStats,
  setActivitySyncStats,
  type ZohoActivityLogRecord,
} from "./db/database.ts";
import { getCurrentFyStart, getCurrentFyActivityRange, getIndianFinancialYearRange } from "./date-period-utils.ts";
import { fetchActivityLogs, parseZohoActivityLogItem, type ZohoActivityEvent } from "./zoho-api.ts";
import type { DatabaseSync } from "node:sqlite";

export interface ActivitySyncOptions {
  forceFullFy?: boolean;
  refDate?: Date;
  organizationId?: string;
}

export interface ActivitySyncExecutionResult {
  success: boolean;
  message: string;
  currentFy: string;
  fyStart: string;
  fromDate: string;
  toDate: string;
  activitiesRetrieved: number;
  newActivities: number;
  updatedActivities: number;
  previousFyRecordsFetched: number;
  apiCallsUsed: number;
  lastSync: string | null;
  status?: string;
  authorization?: "PASS" | "FAIL";
  statusCode?: number;
  code?: number;
  error?: string;
  // COMPLETE: pagination ran to the API's own end-of-data (hasMore === false) with no
  // errors. PARTIAL: stopped early — page cap hit while more data remained, a page
  // fetch error, or the API repeating the same page without advancing. Only a COMPLETE
  // full-FY run is allowed to advance last_successful_activity_sync, since that value
  // is what the next incremental sync trusts as "everything before this date is in".
  refreshStatus: "COMPLETE" | "PARTIAL";
  pagesCompleted: number;
  stoppedReason?: "page_cap" | "repeated_page" | "fetch_error";
}

/**
 * Formats a Date object to YYYY-MM-DD.
 */
function toDateStr(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Synchronizes Zoho Books Activity Logs into local SQLite cache.
 * Strictly adheres to:
 * - Current Financial Year only (01/04/2026 onwards for FY 2026-27).
 * - Previous FY Fetch = 0 (never downloads FY 2025-26 or earlier).
 * - Incremental Sync by default (newer than last_successful_activity_sync).
 * - Force Full FY Sync downloads strictly from FY start to current date.
 * - Strictly GET-only (zero write calls to Zoho).
 */
export async function syncZohoActivityLogs(
  options: ActivitySyncOptions = {}
): Promise<ActivitySyncExecutionResult> {
  const db = getDatabase();
  const refDate = options.refDate || new Date();
  const fyStart = getCurrentFyStart(refDate); // Dynamic rollover: >= 1 Apr -> curr year, < 1 Apr -> prev year
  const currentDate = toDateStr(refDate);
  const fyRange = getIndianFinancialYearRange(refDate, 0);
  const currentFy = fyRange.label;

  const lastSuccessfulSync = getSyncMetadata(db, "last_successful_activity_sync");

  // Determine date bounds
  let fromDate = fyStart;
  const toDate = currentDate;

  if (options.forceFullFy || !lastSuccessfulSync) {
    // Full FY sync: strictly from FY start (01/04/2026 for 2026-27) to current date
    fromDate = fyStart;
  } else {
    // Incremental sync: newer than last_successful_activity_sync
    // Extract date portion from last sync timestamp
    const checkpointDate = lastSuccessfulSync.slice(0, 10);
    // Never allow fromDate to precede current FY start
    fromDate = checkpointDate >= fyStart ? checkpointDate : fyStart;
  }

  // Safety invariant: Ensure fromDate is NEVER earlier than current FY start
  if (fromDate < fyStart) {
    fromDate = fyStart;
  }

  let apiCallsUsed = 0;
  let totalRetrieved = 0;
  let newActivities = 0;
  let updatedActivities = 0;
  let previousFyRecordsFetched = 0;
  let pagesCompleted = 0;
  let stoppedReason: "page_cap" | "repeated_page" | "fetch_error" | undefined;

  const nowIso = new Date().toISOString();
  const MAX_PAGES = 50;

  try {
    let page = 1;
    let hasMore = true;
    let previousPageIdSignature: string | null = null;
    const allFetchedEvents: ZohoActivityEvent[] = [];

    // Paginate through activity logs
    while (hasMore && page <= MAX_PAGES) {
      const res = await fetchActivityLogs({
        organizationId: options.organizationId,
        fromDate,
        toDate,
        page,
        perPage: 200,
      });

      apiCallsUsed++;
      recordApiCall(db);

      if (res.isNotAuthorized || res.statusCode === 401 || res.code === 57) {
        setSyncMetadata(db, "activity_sync_status", "NOT_AUTHORIZED");
        setSyncMetadata(
          db,
          "activity_sync_message",
          "ZOHO ACTIVITY ACCESS: NOT AUTHORIZED (code 57). Re-consent for ZohoBooks.reports.READ is required."
        );
        setActivitySyncStats(db, {
          lastSync: nowIso,
          activitiesRetrieved: 0,
          newActivities: 0,
          updatedActivities: 0,
          apiCallsUsed,
        });

        return {
          success: false,
          status: "NOT_AUTHORIZED",
          authorization: "FAIL",
          statusCode: res.statusCode,
          code: res.code,
          message: "ZOHO ACTIVITY ACCESS: NOT AUTHORIZED (code 57). Re-consent for ZohoBooks.reports.READ is required.",
          currentFy,
          fyStart,
          fromDate,
          toDate,
          activitiesRetrieved: 0,
          newActivities: 0,
          updatedActivities: 0,
          previousFyRecordsFetched: 0,
          apiCallsUsed,
          lastSync: nowIso,
          error: "NOT_AUTHORIZED",
          refreshStatus: "PARTIAL",
          pagesCompleted,
          stoppedReason: "fetch_error",
        };
      }

      if (res.statusCode === 200 && Array.isArray(res.activities)) {
        // Repeated-page guard: if the API returns the exact same set of activity_ids as
        // the previous page (a stuck-pagination symptom), stop instead of looping to the
        // page cap uselessly re-fetching the same data.
        const pageIdSignature = res.activities.map((a) => a.activity_id).sort().join(",");
        if (pageIdSignature && pageIdSignature === previousPageIdSignature) {
          stoppedReason = "repeated_page";
          hasMore = false;
          break;
        }
        previousPageIdSignature = pageIdSignature || null;

        allFetchedEvents.push(...res.activities);
        pagesCompleted++;
        hasMore = res.hasMore;
        page++;
      } else {
        // A genuine fetch error on this page (non-200, not an auth failure) — stop
        // immediately rather than silently treating it as "no more data".
        stoppedReason = "fetch_error";
        hasMore = false;
      }
    }

    if (!stoppedReason && page > MAX_PAGES && hasMore) {
      stoppedReason = "page_cap";
    }

    const refreshStatus: "COMPLETE" | "PARTIAL" = stoppedReason ? "PARTIAL" : "COMPLETE";

    setSyncMetadata(db, "activity_sync_status", "AUTHORIZED");
    setSyncMetadata(db, "last_activity_refresh_status", refreshStatus);
    if (stoppedReason) {
      setSyncMetadata(db, "last_activity_refresh_stopped_reason", stoppedReason);
    }

    totalRetrieved = allFetchedEvents.length;

    // Filter strictly for current FY: discard any record before fyStart
    const validRecords: ZohoActivityLogRecord[] = [];
    for (const event of allFetchedEvents) {
      const eventDate = event.date || event.activity_date || (event.activity_datetime ? event.activity_datetime.slice(0, 10) : "");
      if (eventDate < fyStart) {
        previousFyRecordsFetched++;
        continue; // Strictly reject previous FY records
      }

      validRecords.push({
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
        synced_at: nowIso,
      });
    }

    // Save batch to local SQLite
    if (validRecords.length > 0) {
      const batchResult = saveActivityLogsBatch(db, validRecords);
      newActivities = batchResult.newActivities;
      updatedActivities = batchResult.updatedActivities;
    }

    // Record sync metadata. The checkpoint that the NEXT incremental sync trusts
    // (last_successful_activity_sync) must only advance when this run actually reached
    // the API's own end-of-data for the requested range — never on a partial run (page
    // cap hit, a repeated/stuck page, or a fetch error), or a later incremental sync
    // would wrongly believe a gap in the middle of the range was already covered.
    setActivitySyncStats(db, {
      lastSync: refreshStatus === "COMPLETE" ? nowIso : null,
      activitiesRetrieved: totalRetrieved,
      newActivities,
      updatedActivities,
      apiCallsUsed,
    });

    const statusNote =
      refreshStatus === "PARTIAL"
        ? ` [PARTIAL — stopped early: ${stoppedReason}; sync checkpoint NOT advanced, safe to re-run]`
        : "";

    return {
      success: true,
      message: `Activity sync completed. ${totalRetrieved} activities retrieved (${newActivities} new, ${updatedActivities} updated).${statusNote}`,
      currentFy,
      fyStart,
      fromDate,
      toDate,
      refreshStatus,
      pagesCompleted,
      stoppedReason,
      activitiesRetrieved: totalRetrieved,
      newActivities,
      updatedActivities,
      previousFyRecordsFetched,
      apiCallsUsed,
      lastSync: refreshStatus === "COMPLETE" ? nowIso : (lastSuccessfulSync || null),
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Activity sync encountered an error";
    console.error("[ZohoActivityEngine] Sync failed:", errorMsg);
    setSyncMetadata(db, "last_activity_refresh_status", "PARTIAL");
    setSyncMetadata(db, "last_activity_refresh_stopped_reason", "fetch_error");

    return {
      success: false,
      message: `Activity sync completed with warning: ${errorMsg} [PARTIAL — sync checkpoint NOT advanced, safe to re-run]`,
      currentFy,
      fyStart,
      fromDate,
      toDate,
      refreshStatus: "PARTIAL",
      pagesCompleted,
      stoppedReason: "fetch_error",
      activitiesRetrieved: 0,
      newActivities: 0,
      updatedActivities: 0,
      previousFyRecordsFetched: 0,
      apiCallsUsed,
      lastSync: lastSuccessfulSync || null,
      error: errorMsg,
    };
  }
}

/**
 * Corrects previously-cached zoho_activity_logs rows by re-deriving every field from the
 * raw_payload_json already stored for each row, using the exact same parser as a live sync
 * (parseZohoActivityLogItem). This fixes rows written before the Activity Detail mapping
 * fix — in particular, the fabricated wall-clock time/created_time values and the missing
 * activity_details.customer_name/id — WITHOUT any new Zoho API call and WITHOUT deleting
 * any activity history. Idempotent: uses the same activity_id-keyed upsert as a live sync,
 * so re-running it produces no duplicates.
 */
export function reprocessActivityLogsFromRawPayload(db: DatabaseSync): { reprocessed: number; skipped: number } {
  const rows = db.prepare(
    "SELECT activity_id, raw_payload_json FROM zoho_activity_logs WHERE raw_payload_json IS NOT NULL"
  ).all() as { activity_id: string; raw_payload_json: string }[];

  let reprocessed = 0;
  let skipped = 0;
  const nowIso = new Date().toISOString();
  const records: ZohoActivityLogRecord[] = [];

  for (const row of rows) {
    try {
      const item = JSON.parse(row.raw_payload_json);
      const event: ZohoActivityEvent = parseZohoActivityLogItem(item);
      records.push({
        activity_id: event.activity_id,
        date: event.date || event.activity_date,
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
        raw_payload_json: event.raw_payload_json || row.raw_payload_json,
        detail_party_name: event.detail_party_name || null,
        detail_party_id: event.detail_party_id || null,
        synced_at: nowIso,
      });
      reprocessed++;
    } catch {
      skipped++;
    }
  }

  if (records.length > 0) {
    saveActivityLogsBatch(db, records);
  }

  return { reprocessed, skipped };
}

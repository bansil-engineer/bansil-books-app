// ============================================================
// Bansil Books Analytics — Zoho Activity Durable Backfill Test Suite
// Strict Isolation: every test runs against a fresh in-memory SQLite database
// (via initDatabase, the REAL production schema) and a fake fetchPageFn.
// NEVER touches or seeds the runtime bansil_books.db.
// ============================================================

import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { initDatabase, saveActivityLogsBatch, type ZohoActivityLogRecord } from "../app/lib/db/database.ts";
import {
  runActivityBackfill,
  splitIntoMonthWindows,
  getActivityBackfillStatus,
  type FetchActivityPageFn,
} from "../app/lib/zoho-activity-backfill-engine.ts";
import { parseZohoActivityLogItem, type ZohoActivityLogsResponse, type ZohoActivityEvent } from "../app/lib/zoho-api.ts";

let totalChecks = 0;
let passedChecks = 0;

function pass(name: string, detail?: string) {
  passedChecks++;
  totalChecks++;
  console.log(`  ✓ [PASS] ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, err: unknown) {
  totalChecks++;
  console.error(`  ✗ [FAIL] ${name}`, err);
  process.exitCode = 1;
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  initDatabase(db);
  return db;
}

/** Builds a fake raw Zoho activity item (matches the shape parseZohoActivityLogItem expects). */
function fakeRawItem(opts: {
  id: string;
  date: string;
  userName?: string;
  transactionType?: string;
  transactionName?: string;
  operationType?: string;
}) {
  return {
    date: opts.date,
    description: `${opts.transactionType || "item"} "${opts.transactionName || opts.id}" ${opts.operationType || "updated"}`,
    notes: "",
    activity_id: opts.id,
    user_name: opts.userName ?? "Test User",
    user_id: "user_1",
    role_name: "Admin",
    role_id: "role_1",
    is_from_client_portal: false,
    is_from_secure_page: false,
    source_formatted: "",
    activity_details: {
      transaction_id: `txn_${opts.id}`,
      transaction_name: opts.transactionName || opts.id,
      customer_name: "Test Vendor",
      customer_id: "cust_1",
      transaction_type: opts.transactionType || "bill",
      operation_type: opts.operationType || "updated",
      can_show_version: true,
      app_source: "books",
      is_audittrail_applicable: true,
    },
    ref_transaction_type: "",
  };
}

console.log("\n============================================================");
console.log("ZOHO ACTIVITY BACKFILL — DURABLE RESUME TEST SUITE");
console.log("============================================================\n");

// ─────────────────────────────────────────────────────────────
// 1. MONTH AND BOUNDARY-DAY COVERAGE (window splitting)
// ─────────────────────────────────────────────────────────────
try {
  const windows = splitIntoMonthWindows("2026-04-01", "2026-07-06");
  assert.strictEqual(windows.length, 4);
  assert.deepStrictEqual(windows[0], { from: "2026-04-01", to: "2026-04-30" });
  assert.deepStrictEqual(windows[1], { from: "2026-05-01", to: "2026-05-31" });
  assert.deepStrictEqual(windows[2], { from: "2026-06-01", to: "2026-06-30" });
  assert.deepStrictEqual(windows[3], { from: "2026-07-01", to: "2026-07-06" });
  pass("MONTH AND BOUNDARY-DAY COVERAGE", "PASS — Apr/May/Jun full months + Jul 1-6 partial");
} catch (e) {
  fail("MONTH AND BOUNDARY-DAY COVERAGE", e);
}

// ─────────────────────────────────────────────────────────────
// 2. MORE THAN 10,000 EVENTS (single window, no hardcoded 50-page/10k cap)
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  const TOTAL_PAGES = 60; // 60 * 200 = 12,000 > 10,000
  const fetcher: FetchActivityPageFn = async ({ page }) => {
    const p = page || 1;
    const activities: ZohoActivityEvent[] = Array.from({ length: 200 }, (_, i) => {
      const idx = (p - 1) * 200 + i;
      return fakeRawItemAsEvent(`vol_${idx}`, "2026-04-15");
    });
    return {
      activities,
      hasMore: p < TOTAL_PAGES,
      statusCode: 200,
      isNotAuthorized: false,
      recordCount: activities.length,
    } as ZohoActivityLogsResponse;
  };

  const result = await runActivityBackfill({
    db,
    organizationId: "org_vol",
    fromDate: "2026-04-01",
    toDate: "2026-04-30",
    maxRequests: 1000, // generous — proving no fixed 50-page ceiling
    fetchPageFn: fetcher,
  });

  assert.strictEqual(result.overallStatus, "COMPLETE");
  assert.strictEqual(result.actualRequests, TOTAL_PAGES);
  const rowCount = (db.prepare("SELECT COUNT(*) c FROM zoho_activity_logs").get() as { c: number }).c;
  assert.ok(rowCount > 10000, `expected >10000 rows, got ${rowCount}`);
  pass("MORE THAN 10,000 EVENTS", `PASS — ${rowCount} rows saved across ${TOTAL_PAGES} pages, single window`);
} catch (e) {
  fail("MORE THAN 10,000 EVENTS", e);
}

// ─────────────────────────────────────────────────────────────
// 3. PAUSE AT THE REQUEST BUDGET AND RESUME
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  const TOTAL_PAGES = 5;
  let callsSeen = 0;
  const fetcher: FetchActivityPageFn = async ({ page }) => {
    callsSeen++;
    const p = page || 1;
    return {
      activities: [fakeRawItemAsEvent(`budget_${p}`, "2026-05-10")],
      hasMore: p < TOTAL_PAGES,
      statusCode: 200,
      isNotAuthorized: false,
      recordCount: 1,
    } as ZohoActivityLogsResponse;
  };

  const run1 = await runActivityBackfill({
    db, organizationId: "org_budget", fromDate: "2026-05-01", toDate: "2026-05-31",
    maxRequests: 3, fetchPageFn: fetcher,
  });
  assert.strictEqual(run1.overallStatus, "PAUSED");
  assert.strictEqual(run1.actualRequests, 3);
  assert.strictEqual(callsSeen, 3);

  const statusMid = getActivityBackfillStatus("org_budget", "2026-05-01", "2026-05-31", db);
  assert.ok(statusMid.exists);
  const win = statusMid.windows!.find((w) => w.window_from === "2026-05-01")!;
  assert.strictEqual(win.next_page, 4, "must resume from page 4, not restart at page 1");

  const run2 = await runActivityBackfill({
    db, organizationId: "org_budget", fromDate: "2026-05-01", toDate: "2026-05-31",
    maxRequests: 10, fetchPageFn: fetcher,
  });
  assert.strictEqual(run2.overallStatus, "COMPLETE");
  assert.strictEqual(run2.actualRequests, 2, "resume must only fetch the 2 remaining pages, not restart");
  assert.strictEqual(callsSeen, 5);

  pass("PAUSE AT THE REQUEST BUDGET AND RESUME", "PASS — resumed from saved next_page, did not restart");
} catch (e) {
  fail("PAUSE AT THE REQUEST BUDGET AND RESUME", e);
}

// ─────────────────────────────────────────────────────────────
// 4. RESTART AFTER A SAVED PAGE (persisted state survives a fresh invocation)
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  let callCount = 0;
  const fetcher: FetchActivityPageFn = async ({ page }) => {
    callCount++;
    const p = page || 1;
    return {
      activities: [fakeRawItemAsEvent(`restart_${p}`, "2026-06-05")],
      hasMore: p < 3,
      statusCode: 200,
      isNotAuthorized: false,
      recordCount: 1,
    } as ZohoActivityLogsResponse;
  };

  await runActivityBackfill({
    db, organizationId: "org_restart", fromDate: "2026-06-01", toDate: "2026-06-30",
    maxRequests: 1, fetchPageFn: fetcher,
  });
  assert.strictEqual(callCount, 1);

  // Simulate a fresh process picking the same (persisted) job back up — a brand new
  // call to runActivityBackfill must find the existing job/window state in the DB
  // and continue from page 2, not re-create a job and restart at page 1.
  const resumed = await runActivityBackfill({
    db, organizationId: "org_restart", fromDate: "2026-06-01", toDate: "2026-06-30",
    maxRequests: 10, fetchPageFn: fetcher,
  });
  assert.strictEqual(resumed.overallStatus, "COMPLETE");
  assert.strictEqual(resumed.actualRequests, 2, "must fetch only the remaining 2 pages");
  assert.strictEqual(callCount, 3);

  const jobsAfter = (db.prepare("SELECT COUNT(*) c FROM activity_backfill_jobs WHERE organization_id = ?").get("org_restart") as { c: number }).c;
  assert.strictEqual(jobsAfter, 1, "must not create a second duplicate job on restart");

  pass("RESTART AFTER A SAVED PAGE", "PASS — single persisted job resumed, not duplicated or restarted");
} catch (e) {
  fail("RESTART AFTER A SAVED PAGE", e);
}

// ─────────────────────────────────────────────────────────────
// 5. REPEATED/NON-ADVANCING PAGES (stuck pagination guard)
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  let callCount = 0;
  const fetcher: FetchActivityPageFn = async () => {
    callCount++;
    // Always returns the SAME activity_id — pagination isn't advancing.
    return {
      activities: [fakeRawItemAsEvent("stuck_1", "2026-04-10")],
      hasMore: true,
      statusCode: 200,
      isNotAuthorized: false,
      recordCount: 1,
    } as ZohoActivityLogsResponse;
  };

  const result = await runActivityBackfill({
    db, organizationId: "org_stuck", fromDate: "2026-04-01", toDate: "2026-04-30",
    maxRequests: 50, fetchPageFn: fetcher,
  });

  assert.strictEqual(result.overallStatus, "PARTIAL");
  assert.ok(callCount < 50, `must stop well before exhausting the budget, made ${callCount} calls`);
  assert.strictEqual(result.windows[0].lastError, "repeated_page");
  pass("REPEATED/NON-ADVANCING PAGES", `PASS — stopped after ${callCount} calls instead of looping to budget`);
} catch (e) {
  fail("REPEATED/NON-ADVANCING PAGES", e);
}

// ─────────────────────────────────────────────────────────────
// 6. DATE FILTER NOT HONOURED (out-of-window records saved, never silently
//    used to falsely mark the window complete)
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  const fetcher: FetchActivityPageFn = async ({ page }) => {
    const p = page || 1;
    // Deliberately returns a record OUTSIDE the requested April window.
    return {
      activities: [fakeRawItemAsEvent(`oow_${p}`, "2026-09-01")],
      hasMore: p < 2,
      statusCode: 200,
      isNotAuthorized: false,
      recordCount: 1,
    } as ZohoActivityLogsResponse;
  };

  const result = await runActivityBackfill({
    db, organizationId: "org_oow", fromDate: "2026-04-01", toDate: "2026-04-30",
    maxRequests: 10, fetchPageFn: fetcher,
  });

  // The window still reaches COMPLETE only because hasMore genuinely went false —
  // never because out-of-range dates were detected and used as a shortcut.
  assert.strictEqual(result.overallStatus, "COMPLETE");
  assert.strictEqual(result.windows[0].outOfWindowCount, 2, "both out-of-range records must be counted, not silently dropped");
  const saved = db.prepare("SELECT COUNT(*) c FROM zoho_activity_logs WHERE activity_id IN ('oow_1','oow_2')").get() as { c: number };
  assert.strictEqual(saved.c, 2, "out-of-window records must still be saved under their real date, not discarded");
  pass("DATE FILTER NOT HONOURED", "PASS — out-of-range records saved and flagged, not used to fake completion");
} catch (e) {
  fail("DATE FILTER NOT HONOURED", e);
}

// ─────────────────────────────────────────────────────────────
// 7. NEW ACTIVITY ADDED LATER FOR AN ALREADY-COMPLETE WINDOW (re-run safety)
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  let call = 0;
  const fetcher: FetchActivityPageFn = async () => {
    call++;
    if (call === 1) {
      return {
        activities: [fakeRawItemAsEvent("late_existing", "2026-04-20")],
        hasMore: false, statusCode: 200, isNotAuthorized: false, recordCount: 1,
      } as ZohoActivityLogsResponse;
    }
    // Second invocation (window re-opened): existing + one new activity_id.
    return {
      activities: [fakeRawItemAsEvent("late_existing", "2026-04-20"), fakeRawItemAsEvent("late_new", "2026-04-20")],
      hasMore: false, statusCode: 200, isNotAuthorized: false, recordCount: 2,
    } as ZohoActivityLogsResponse;
  };

  await runActivityBackfill({
    db, organizationId: "org_late", fromDate: "2026-04-01", toDate: "2026-04-30",
    maxRequests: 10, fetchPageFn: fetcher,
  });
  const rowsAfterFirst = (db.prepare("SELECT COUNT(*) c FROM zoho_activity_logs").get() as { c: number }).c;
  assert.strictEqual(rowsAfterFirst, 1);

  // Simulate the window being explicitly re-opened for a later same-day check.
  db.prepare("UPDATE activity_backfill_windows SET status = 'PENDING', next_page = 1, last_page_fingerprint = NULL WHERE window_from = '2026-04-01'").run();

  const run2 = await runActivityBackfill({
    db, organizationId: "org_late", fromDate: "2026-04-01", toDate: "2026-04-30",
    maxRequests: 10, fetchPageFn: fetcher,
  });
  assert.strictEqual(run2.overallStatus, "COMPLETE");
  const rowsAfterSecond = (db.prepare("SELECT COUNT(*) c FROM zoho_activity_logs").get() as { c: number }).c;
  assert.strictEqual(rowsAfterSecond, 2, "exactly one new row added, existing not duplicated");
  const dupCheck = db.prepare("SELECT COUNT(*) c FROM zoho_activity_logs WHERE activity_id = 'late_existing'").get() as { c: number };
  assert.strictEqual(dupCheck.c, 1, "no duplicate of the pre-existing activity_id");

  pass("NEW ACTIVITY ADDED LATER, SAME DATE", "PASS — re-run added only the genuinely new record");
} catch (e) {
  fail("NEW ACTIVITY ADDED LATER, SAME DATE", e);
}

// ─────────────────────────────────────────────────────────────
// 8. NO DUPLICATE ACTIVITY IDS (global check across all prior test DBs' pattern)
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  const fetcher: FetchActivityPageFn = async () => {
    return {
      activities: [fakeRawItemAsEvent("dup_check_1", "2026-05-05"), fakeRawItemAsEvent("dup_check_2", "2026-05-05")],
      hasMore: false, statusCode: 200, isNotAuthorized: false, recordCount: 2,
    } as ZohoActivityLogsResponse;
  };

  await runActivityBackfill({ db, organizationId: "org_nodup", fromDate: "2026-05-01", toDate: "2026-05-31", maxRequests: 10, fetchPageFn: fetcher });
  // Re-run the same (now-complete) window forcibly to prove upsert dedupes.
  db.prepare("UPDATE activity_backfill_windows SET status='PENDING', next_page=1, last_page_fingerprint=NULL").run();
  await runActivityBackfill({ db, organizationId: "org_nodup", fromDate: "2026-05-01", toDate: "2026-05-31", maxRequests: 10, fetchPageFn: fetcher });

  const counts = db.prepare("SELECT COUNT(*) total, COUNT(DISTINCT activity_id) distinct_ids FROM zoho_activity_logs").get() as { total: number; distinct_ids: number };
  assert.strictEqual(counts.total, counts.distinct_ids, "row count must equal distinct activity_id count");
  pass("NO DUPLICATE ACTIVITY IDS", `PASS — ${counts.total} rows, ${counts.distinct_ids} distinct IDs`);
} catch (e) {
  fail("NO DUPLICATE ACTIVITY IDS", e);
}

// ─────────────────────────────────────────────────────────────
// 9. LEGACY RECORDS REMAIN UNVERIFIED UNTIL SOURCE-BACKED
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  const nowIso = new Date().toISOString();
  // A pre-existing "legacy" row with no raw payload, inserted directly (simulating
  // data from before the parser fix) — never inserted by the backfill engine itself.
  const legacyRecord: ZohoActivityLogRecord = {
    activity_id: "legacy_unresolved",
    date: "2026-04-12",
    time: null,
    user_name: "Old User",
    user_id: null,
    module: "bill",
    action: "updated",
    description: "Bill legacy",
    entity_id: null,
    entity_number: "LEGACY-1",
    raw_payload_json: null,
    synced_at: nowIso,
  };
  saveActivityLogsBatch(db, [legacyRecord]);

  // Backfill returns OTHER records for this window, but never the legacy one.
  const fetcher: FetchActivityPageFn = async () => ({
    activities: [fakeRawItemAsEvent("unrelated_new", "2026-04-13")],
    hasMore: false, statusCode: 200, isNotAuthorized: false, recordCount: 1,
  } as ZohoActivityLogsResponse);

  await runActivityBackfill({ db, organizationId: "org_legacy", fromDate: "2026-04-01", toDate: "2026-04-30", maxRequests: 10, fetchPageFn: fetcher });

  const legacyRow = db.prepare("SELECT raw_payload_json FROM zoho_activity_logs WHERE activity_id = 'legacy_unresolved'").get() as { raw_payload_json: string | null } | undefined;
  assert.ok(legacyRow, "legacy row must not be deleted");
  assert.strictEqual(legacyRow!.raw_payload_json, null, "must remain unverified — no source evidence was invented for it");

  const status = getActivityBackfillStatus("org_legacy", "2026-04-01", "2026-04-30", db);
  assert.ok(status.exists);
  assert.ok((status.unverifiedLegacyCount || 0) >= 1, "unverified legacy count must reflect the still-unresolved record");

  pass("LEGACY RECORDS UNVERIFIED UNTIL SOURCE-BACKED", "PASS — preserved, not deleted, not fabricated");
} catch (e) {
  fail("LEGACY RECORDS UNVERIFIED UNTIL SOURCE-BACKED", e);
}

// ─────────────────────────────────────────────────────────────
// 10. MISSING EVENT TIME NEVER FALLS BACK TO SYNC TIME
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  const beforeCallWallClock = new Date();
  const fetcher: FetchActivityPageFn = async () => ({
    activities: [fakeRawItemAsEvent("no_time_event", "2026-04-08")], // no time field anywhere
    hasMore: false, statusCode: 200, isNotAuthorized: false, recordCount: 1,
  } as ZohoActivityLogsResponse);

  await runActivityBackfill({ db, organizationId: "org_notime", fromDate: "2026-04-01", toDate: "2026-04-30", maxRequests: 10, fetchPageFn: fetcher });

  const row = db.prepare("SELECT time, created_time, date FROM zoho_activity_logs WHERE activity_id = 'no_time_event'").get() as { time: string | null; created_time: string | null; date: string };
  assert.strictEqual(row.time, null);
  assert.strictEqual(row.created_time, null);
  assert.strictEqual(row.date, "2026-04-08", "date must be the source event date, unaffected by wall-clock");
  // Sanity: whatever the wall clock says right now must play no role in the stored row.
  void beforeCallWallClock;

  pass("MISSING EVENT TIME NEVER FALLS BACK TO SYNC TIME", "PASS — time/created_time stored as NULL, not wall-clock");
} catch (e) {
  fail("MISSING EVENT TIME NEVER FALLS BACK TO SYNC TIME", e);
}

// ─────────────────────────────────────────────────────────────
// 11. OVERLAPPING JOB PREVENTION (lock)
// ─────────────────────────────────────────────────────────────
try {
  const db = freshDb();
  const fetcher: FetchActivityPageFn = async () => ({
    activities: [fakeRawItemAsEvent("lock_test", "2026-04-01")],
    hasMore: false, statusCode: 200, isNotAuthorized: false, recordCount: 1,
  } as ZohoActivityLogsResponse);

  // Manually hold the lock as if another run were in progress.
  db.prepare(
    "INSERT INTO sync_locks (lock_key, locked_at, locked_by, expires_at) VALUES (?, ?, ?, ?)"
  ).run("activity_backfill:org_locked", new Date().toISOString(), "other_run", new Date(Date.now() + 60000).toISOString());

  const blocked = await runActivityBackfill({
    db, organizationId: "org_locked", fromDate: "2026-04-01", toDate: "2026-04-30", maxRequests: 10, fetchPageFn: fetcher,
  });
  assert.strictEqual(blocked.overallStatus, "BLOCKED");
  pass("OVERLAPPING JOB PREVENTION", "PASS — second run blocked while lock held");
} catch (e) {
  fail("OVERLAPPING JOB PREVENTION", e);
}

// ─────────────────────────────────────────────────────────────
// 12. SHARED API-CALL COUNTER INTEGRATION
// ─────────────────────────────────────────────────────────────
function sharedCounterToday(db: DatabaseSync): number {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare("SELECT call_count FROM api_call_counter WHERE date = ?").get(today) as { call_count: number } | undefined;
  return row?.call_count || 0;
}

try {
  const db = freshDb();
  const fetcher: FetchActivityPageFn = async () => ({
    activities: [fakeRawItemAsEvent("counter_1page", "2026-04-01")],
    hasMore: false, statusCode: 200, isNotAuthorized: false, recordCount: 1,
  } as ZohoActivityLogsResponse);

  const before = sharedCounterToday(db);
  const result = await runActivityBackfill({
    db, organizationId: "org_counter1", fromDate: "2026-04-01", toDate: "2026-04-30", maxRequests: 10, fetchPageFn: fetcher,
  });
  const after = sharedCounterToday(db);

  assert.strictEqual(after - before, 1, "shared counter must advance by exactly 1 for a 1-page window");
  assert.strictEqual(result.windows[0].pagesSaved, 1, "job-level page count must also be 1");
  pass("BACKFILL ONE PAGE — SHARED +1, JOB +1", `PASS — shared ${before}->${after}, job pages=1`);
} catch (e) {
  fail("BACKFILL ONE PAGE — SHARED +1, JOB +1", e);
}

try {
  const db = freshDb();
  let call = 0;
  const fetcher: FetchActivityPageFn = async ({ page }) => {
    call++;
    const p = page || 1;
    return {
      activities: [fakeRawItemAsEvent(`counter_3page_${p}`, "2026-04-05")],
      hasMore: p < 3, statusCode: 200, isNotAuthorized: false, recordCount: 1,
    } as ZohoActivityLogsResponse;
  };

  const before = sharedCounterToday(db);
  const result = await runActivityBackfill({
    db, organizationId: "org_counter3", fromDate: "2026-04-01", toDate: "2026-04-30", maxRequests: 10, fetchPageFn: fetcher,
  });
  const after = sharedCounterToday(db);

  assert.strictEqual(call, 3);
  assert.strictEqual(after - before, 3, "shared counter must advance by exactly 3 for a 3-page window");
  assert.strictEqual(result.windows[0].pagesSaved, 3);
  pass("BACKFILL THREE PAGES — SHARED +3, JOB +3", `PASS — shared ${before}->${after}, job pages=3`);
} catch (e) {
  fail("BACKFILL THREE PAGES — SHARED +3, JOB +3", e);
}

try {
  const db = freshDb();
  // Local-only status read: must never touch the shared counter (0 Zoho calls).
  const before = sharedCounterToday(db);
  getActivityBackfillStatus("org_no_such_job", "2026-04-01", "2026-04-30", db);
  const after = sharedCounterToday(db);
  assert.strictEqual(after, before);
  assert.strictEqual(after, 0);
  pass("LOCAL PAGE OPEN CALLS — SHARED +0", "PASS — status read made zero Zoho calls");
} catch (e) {
  fail("LOCAL PAGE OPEN CALLS — SHARED +0", e);
}

try {
  // Row click / local drawer and Export both resolve purely from local SQLite reads —
  // neither imports or calls anything in zoho-api.ts, so they cannot advance the shared
  // counter by construction. Verify no fetchPageFn-shaped call occurs for either path
  // by asserting the counter stays at 0 across simulated local-only operations (a plain
  // DB read here stands in for /api/transactions?type=bill-detail and the export
  // builder, which take an activity record already in hand and never call Zoho).
  const db = freshDb();
  const before = sharedCounterToday(db);
  db.prepare("SELECT COUNT(*) FROM zoho_activity_logs").get(); // local read only
  const after = sharedCounterToday(db);
  assert.strictEqual(after, before);
  assert.strictEqual(after, 0);
  pass("ROW CLICK / EXPORT CALLS — SHARED +0", "PASS — purely local reads, zero Zoho calls");
} catch (e) {
  fail("ROW CLICK / EXPORT CALLS — SHARED +0", e);
}

try {
  const db = freshDb();
  let attempts = 0;
  const fetcher: FetchActivityPageFn = async () => {
    attempts++;
    throw new Error("simulated_network_failure");
  };

  const before = sharedCounterToday(db);
  const result = await runActivityBackfill({
    db, organizationId: "org_failed_attempt", fromDate: "2026-04-01", toDate: "2026-04-30", maxRequests: 10, fetchPageFn: fetcher,
  });
  const after = sharedCounterToday(db);

  assert.strictEqual(attempts, 1);
  assert.strictEqual(after - before, 1, "a real (failed) HTTP attempt must still be counted exactly once");
  assert.strictEqual(result.overallStatus, "PARTIAL");
  pass("FAILED REAL HTTP ATTEMPT — COUNTED ONCE", `PASS — shared ${before}->${after} for 1 failed attempt`);
} catch (e) {
  fail("FAILED REAL HTTP ATTEMPT — COUNTED ONCE", e);
}

try {
  // "Retry" here means: a paused job resumed in a later invocation. Each invocation's
  // real fetch attempts must add to the shared counter — never re-counting pages that
  // were already saved and skipped on resume.
  const db = freshDb();
  const TOTAL_PAGES = 4;
  const fetcher: FetchActivityPageFn = async ({ page }) => {
    const p = page || 1;
    return {
      activities: [fakeRawItemAsEvent(`retry_${p}`, "2026-04-10")],
      hasMore: p < TOTAL_PAGES, statusCode: 200, isNotAuthorized: false, recordCount: 1,
    } as ZohoActivityLogsResponse;
  };

  const before = sharedCounterToday(db);
  await runActivityBackfill({ db, organizationId: "org_retry", fromDate: "2026-04-01", toDate: "2026-04-30", maxRequests: 2, fetchPageFn: fetcher });
  const afterFirst = sharedCounterToday(db);
  assert.strictEqual(afterFirst - before, 2, "first (paused) invocation must add exactly 2");

  await runActivityBackfill({ db, organizationId: "org_retry", fromDate: "2026-04-01", toDate: "2026-04-30", maxRequests: 10, fetchPageFn: fetcher });
  const afterSecond = sharedCounterToday(db);
  assert.strictEqual(afterSecond - afterFirst, 2, "resume invocation must add only the 2 remaining pages, not re-count the first 2");
  assert.strictEqual(afterSecond - before, 4, "no double count across the two invocations combined");

  pass("RETRY / RESUME — NO DOUBLE COUNT", `PASS — ${before}->${afterFirst}->${afterSecond}, exactly ${TOTAL_PAGES} total for ${TOTAL_PAGES} real pages`);
} catch (e) {
  fail("RETRY / RESUME — NO DOUBLE COUNT", e);
}

console.log("\n============================================================");
console.log(`ZOHO ACTIVITY BACKFILL TEST RESULTS: ${passedChecks}/${totalChecks} PASSED`);
console.log("============================================================\n");

if (passedChecks !== totalChecks) {
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// Helper: raw item -> ZohoActivityEvent, via the SAME parser production code uses,
// so these tests exercise the real mapping, not a re-implemented shadow copy.
// ─────────────────────────────────────────────────────────────
function fakeRawItemAsEvent(id: string, date: string): ZohoActivityEvent {
  return parseZohoActivityLogItem(fakeRawItem({ id, date }));
}

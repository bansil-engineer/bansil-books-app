// ============================================================
// Bansil Books Analytics — Phase F.0 P0 Incremental Sync Scheduler
// Only invoked explicitly (via POST /api/audit/p0/sync, gated by
// requireOwnerSession + the per-source Feature Registry key) — never
// on page open/filter/export. A blocked source (missing OAuth scope)
// makes zero calls of any kind and is reported NOT_AVAILABLE, never
// silently skipped without a trace.
//
// FULL FRESHNESS CHAIN (owner-review remediation): each Customer/Vendor
// Outstanding sync now runs the REAL, already-approved-scope incremental
// invoice/bill refresh (the exact same `performSync({type:"INCREMENTAL"})`
// used by the dashboard's own "Smart Sync All Changed" button — a
// modified-since, checkpointed, paginated fetch, never a full-org resync)
// as its first step, before recomputing outstanding and running detection.
// This is injectable (`zohoIncrementalRefresh`) so automated tests never
// make a live Zoho call.
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  computeCustomerOutstanding,
  computeVendorOutstanding,
  snapshotCustomerOutstanding,
  snapshotVendorOutstanding,
  booksDbExists,
  getBooksCacheFreshness,
} from "./outstanding-service.ts";
import { detectOverdueReceivables, detectOverduePayables, detectDuplicateInvoiceNumbers, detectDuplicateBillNumbers, type ReceivablePayableRow } from "./detection-engine.ts";
import { upsertAlerts, resolveStaleAlerts } from "./alert-service.ts";
import { getP0SourceStatus, updateP0SourceStatus, ensureP0SourceStatusSeeded } from "./source-status-service.ts";
import { getSeverityConfig } from "./severity-config-service.ts";
import { getSchedulerConfig } from "./scheduler-config-service.ts";
import { P0_SOURCES_BLOCKED_ON_NEW_SCOPE, type P0SourceKey } from "./p0-types.ts";
import fs from "node:fs";
import * as path from "node:path";

const BOOKS_DB_FILE = path.join(process.cwd(), "data", "bansil_books.db");

/** How many consecutive sync failures escalate a source from SYNC_FAILED to REVIEW_REQUIRED (repeated failure, not just one transient blip). */
const REVIEW_REQUIRED_AFTER_CONSECUTIVE_FAILURES = 3;

/** A source-level lock, reusing the exact same sync_locks table/mechanism already used by the pre-existing Zoho activity backfill engine — prevents an automatic cycle and a manual "Sync Now" click from ever running the same source concurrently. */
function lockKeyFor(sourceKey: string): string {
  return `p0_sync_${sourceKey.toLowerCase()}`;
}

export class SyncError extends Error {}

export interface ZohoIncrementalRefreshResult {
  apiCalls: number;
  status: "SUCCESS" | "PARTIAL" | "OFFLINE" | "FAILED";
  invoicesChecked: number;
  invoicesUpdated: number;
  billsChecked: number;
  billsUpdated: number;
  lastSuccessfulSyncTime: string;
}

export type ZohoIncrementalRefreshFn = () => Promise<ZohoIncrementalRefreshResult>;

/** Real refresh: the exact same incremental invoice+bill sync already used elsewhere in this app. Dynamically imported so test code that never calls this path never needs live Zoho credentials. */
async function realZohoIncrementalRefresh(): Promise<ZohoIncrementalRefreshResult> {
  const { performSync } = await import("../../db/sync-engine.ts");
  const result = await performSync({ type: "INCREMENTAL" });
  return {
    apiCalls: result.apiCalls,
    status: result.status,
    invoicesChecked: result.invoicesChecked,
    invoicesUpdated: result.invoicesUpdated,
    billsChecked: result.billsChecked,
    billsUpdated: result.billsUpdated,
    lastSuccessfulSyncTime: result.lastSuccessfulSyncTime,
  };
}

export interface SyncRunResult {
  runId: string;
  sourceKey: string;
  status: "SUCCESS" | "FAILED" | "NOT_AVAILABLE" | "SKIPPED_CONCURRENT";
  recordsFetched: number;
  recordsNew: number;
  recordsChanged: number;
  apiCallCount: number;
  alertsCreated: number;
  alertsUpdated: number;
  alertsResolved: number;
  zohoRefreshStatus?: string;
  errorMessage?: string;
}

function openBooksReadOnly(): DatabaseSync | null {
  if (!fs.existsSync(BOOKS_DB_FILE)) return null;
  try {
    return new DatabaseSync(BOOKS_DB_FILE, { readOnly: true });
  } catch {
    return null;
  }
}

function startRun(db: DatabaseSync, sourceKey: string): string {
  const runId = randomUUID();
  db.prepare(
    `INSERT INTO audit_p0_sync_runs (run_id, source_key, started_at, status, triggered_by) VALUES (?, ?, ?, 'RUNNING', 'OWNER')`
  ).run(runId, sourceKey, new Date().toISOString());
  return runId;
}

function finishRun(
  db: DatabaseSync,
  runId: string,
  fields: { recordsFetched: number; recordsNew: number; recordsChanged: number; apiCallCount: number; status: "SUCCESS" | "FAILED"; checkpointBefore: string | null; checkpointAfter: string | null; errorMessage?: string }
): void {
  db.prepare(
    `UPDATE audit_p0_sync_runs SET finished_at = ?, records_fetched = ?, records_new = ?, records_changed = ?, api_call_count = ?, status = ?, checkpoint_before = ?, checkpoint_after = ?, error_message = ? WHERE run_id = ?`
  ).run(
    new Date().toISOString(),
    fields.recordsFetched,
    fields.recordsNew,
    fields.recordsChanged,
    fields.apiCallCount,
    fields.status,
    fields.checkpointBefore,
    fields.checkpointAfter,
    fields.errorMessage ?? null,
    runId
  );
}

/**
 * Classifies coverage from REAL, just-read state — never assumed "fresh"
 * just because a sync ran without checking its age/result. Bands come from
 * the owner-governed SchedulerConfig (default 0-4h FRESH / 4-8h STALE /
 * >8h SYNC_FAILED), never a hardcoded constant. Repeated consecutive
 * failures escalate to REVIEW_REQUIRED even within the STALE/FRESH age
 * window, since a string of failures is a different, worse signal than
 * mere staleness.
 */
function classifyCoverage(
  freshness: ReturnType<typeof getBooksCacheFreshness>,
  freshBandHours: number,
  staleBandHours: number,
  consecutiveFailures: number
): "AVAILABLE_AND_FRESH" | "AVAILABLE_BUT_STALE" | "SYNC_FAILED" | "REVIEW_REQUIRED" | "PARTIAL" {
  if (consecutiveFailures >= REVIEW_REQUIRED_AFTER_CONSECUTIVE_FAILURES) return "REVIEW_REQUIRED";
  if (freshness.lastSyncStatus === "FAILED" || freshness.lastSyncStatus === "OFFLINE") return "SYNC_FAILED";
  if (!freshness.lastSuccessfulSyncTime) return "PARTIAL";
  const ageMs = Date.now() - new Date(freshness.lastSuccessfulSyncTime).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return "PARTIAL";
  const ageHours = ageMs / 3600000;
  if (ageHours <= freshBandHours) return "AVAILABLE_AND_FRESH";
  if (ageHours <= staleBandHours) return "AVAILABLE_BUT_STALE";
  return "SYNC_FAILED";
}

/**
 * Runs one explicit sync+detection pass for a single P0 source.
 * Blocked sources (no approved Zoho scope) return NOT_AVAILABLE and make
 * zero calls of any kind — no sync_run row is created for them, since no
 * attempt is made; the source's own status row already records why.
 */
export async function runP0Sync(
  auditDb: DatabaseSync,
  sourceKey: P0SourceKey,
  asOf: Date = new Date(),
  zohoIncrementalRefresh: ZohoIncrementalRefreshFn = realZohoIncrementalRefresh
): Promise<SyncRunResult> {
  ensureP0SourceStatusSeeded(auditDb);

  if (P0_SOURCES_BLOCKED_ON_NEW_SCOPE[sourceKey]) {
    return {
      runId: "",
      sourceKey,
      status: "NOT_AVAILABLE",
      recordsFetched: 0,
      recordsNew: 0,
      recordsChanged: 0,
      apiCallCount: 0,
      alertsCreated: 0,
      alertsUpdated: 0,
      alertsResolved: 0,
      errorMessage: P0_SOURCES_BLOCKED_ON_NEW_SCOPE[sourceKey],
    };
  }

  if (sourceKey === "CUSTOMER_OUTSTANDING") return runCustomerOutstandingSync(auditDb, asOf, zohoIncrementalRefresh);
  if (sourceKey === "VENDOR_OUTSTANDING") return runVendorOutstandingSync(auditDb, asOf, zohoIncrementalRefresh);

  return {
    runId: "",
    sourceKey,
    status: "NOT_AVAILABLE",
    recordsFetched: 0,
    recordsNew: 0,
    recordsChanged: 0,
    apiCallCount: 0,
    alertsCreated: 0,
    alertsUpdated: 0,
    alertsResolved: 0,
    errorMessage: "Unrecognized or unimplemented P0 source key",
  };
}

async function runCustomerOutstandingSync(auditDb: DatabaseSync, asOf: Date, zohoIncrementalRefresh: ZohoIncrementalRefreshFn): Promise<SyncRunResult> {
  const { getDatabase, acquireSyncLock, releaseSyncLock } = await import("../../db/database.ts");
  const booksWriteDb = getDatabase();
  const lockKey = lockKeyFor("CUSTOMER_OUTSTANDING");
  if (!acquireSyncLock(booksWriteDb, lockKey, 120000, "p0-scheduler")) {
    return { runId: "", sourceKey: "CUSTOMER_OUTSTANDING", status: "SKIPPED_CONCURRENT", recordsFetched: 0, recordsNew: 0, recordsChanged: 0, apiCallCount: 0, alertsCreated: 0, alertsUpdated: 0, alertsResolved: 0, errorMessage: "Another CUSTOMER_OUTSTANDING sync is already running" };
  }

  const status = getP0SourceStatus(auditDb, "CUSTOMER_OUTSTANDING");
  const checkpointBefore = (status?.last_checkpoint as string | null) ?? null;
  const consecutiveFailures = Number(status?.consecutive_failures ?? 0);
  const runId = startRun(auditDb, "CUSTOMER_OUTSTANDING");
  const now = new Date().toISOString();
  let apiCallCount = 0;
  let zohoRefreshStatus = "SKIPPED";

  try {
    // Step 1 of the freshness chain: refresh the LOCAL invoice/bill cache
    // via the real, already-approved-scope incremental sync — modified-
    // since only, never a full-org resync. If this step itself fails, the
    // outstanding recompute below still runs against whatever cache
    // currently exists, but the source is honestly reported SYNC_FAILED /
    // AVAILABLE_BUT_STALE rather than silently claiming freshness.
    try {
      const refresh = await zohoIncrementalRefresh();
      apiCallCount += refresh.apiCalls;
      zohoRefreshStatus = refresh.status;
    } catch {
      zohoRefreshStatus = "FAILED";
    }

    if (!booksDbExists()) throw new SyncError("Books DB (data/bansil_books.db) is missing or unreadable — cannot recompute outstanding balances.");
    const rows = computeCustomerOutstanding(asOf);
    snapshotCustomerOutstanding(auditDb, rows, now);

    const severityConfig = getSeverityConfig(auditDb);
    const booksDb = openBooksReadOnly();
    let alertsCreated = 0;
    let alertsUpdated = 0;
    let alertsResolved = 0;
    if (booksDb) {
      try {
        const invoiceRows = booksDb
          .prepare(`SELECT invoice_id, invoice_number, customer_id, customer_name, due_date, balance, last_modified_time FROM sales_invoices WHERE customer_id IS NOT NULL AND LOWER(COALESCE(status, '')) NOT IN ('void', 'cancelled', 'canceled')`)
          .all() as Array<{ invoice_id: string; invoice_number: string; customer_id: string; customer_name: string; due_date: string | null; balance: string; last_modified_time: string | null }>;

        const overdueCandidates: ReceivablePayableRow[] = invoiceRows
          .filter((r) => Number(r.balance) > 0)
          .map((r) => ({ id: r.invoice_id, number: r.invoice_number, partyId: r.customer_id, partyName: r.customer_name, dueDate: r.due_date, balance: Number(r.balance), lastModifiedTime: r.last_modified_time }));
        const allForDuplicateCheck: ReceivablePayableRow[] = invoiceRows.map((r) => ({ id: r.invoice_id, number: r.invoice_number, partyId: r.customer_id, partyName: r.customer_name, dueDate: r.due_date, balance: Number(r.balance), lastModifiedTime: r.last_modified_time }));

        const overdueDrafts = detectOverdueReceivables(overdueCandidates, severityConfig, asOf);
        const dupDrafts = detectDuplicateInvoiceNumbers(allForDuplicateCheck);

        const result = upsertAlerts(auditDb, "CUSTOMER_OUTSTANDING", [...overdueDrafts, ...dupDrafts], now, now);
        alertsCreated = result.created;
        alertsUpdated = result.updated;

        // Alert lifecycle: anything previously OPEN/ACKNOWLEDGED under
        // OVERDUE_RECEIVABLE that is no longer in this pass's active set
        // (e.g. the invoice was paid) is resolved, never left open forever.
        alertsResolved += resolveStaleAlerts(auditDb, "CUSTOMER_OUTSTANDING", "OVERDUE_RECEIVABLE", new Set(overdueDrafts.map((d) => d.dedupKey)));
        alertsResolved += resolveStaleAlerts(auditDb, "CUSTOMER_OUTSTANDING", "DUPLICATE_INVOICE_NUMBER", new Set(dupDrafts.map((d) => d.dedupKey)));
      } finally {
        booksDb.close();
      }
    }

    const schedulerConfig = getSchedulerConfig(auditDb);
    const freshness = getBooksCacheFreshness();
    const coverageStatus = classifyCoverage(freshness, schedulerConfig.freshBandHours, schedulerConfig.staleBandHours, 0);

    updateP0SourceStatus(auditDb, "CUSTOMER_OUTSTANDING", { coverageStatus, lastSyncedAt: now, lastCheckpoint: now, apiCallDelta: apiCallCount, recordCount: rows.length, resetFailures: true });
    finishRun(auditDb, runId, { recordsFetched: rows.length, recordsNew: rows.length, recordsChanged: 0, apiCallCount, status: "SUCCESS", checkpointBefore, checkpointAfter: now });

    return { runId, sourceKey: "CUSTOMER_OUTSTANDING", status: "SUCCESS", recordsFetched: rows.length, recordsNew: rows.length, recordsChanged: 0, apiCallCount, alertsCreated, alertsUpdated, alertsResolved, zohoRefreshStatus };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    finishRun(auditDb, runId, { recordsFetched: 0, recordsNew: 0, recordsChanged: 0, apiCallCount, status: "FAILED", checkpointBefore, checkpointAfter: checkpointBefore, errorMessage: message });
    const coverageStatus = consecutiveFailures + 1 >= REVIEW_REQUIRED_AFTER_CONSECUTIVE_FAILURES ? "REVIEW_REQUIRED" : "SYNC_FAILED";
    updateP0SourceStatus(auditDb, "CUSTOMER_OUTSTANDING", { coverageStatus, apiCallDelta: apiCallCount, incrementFailures: true });
    return { runId, sourceKey: "CUSTOMER_OUTSTANDING", status: "FAILED", recordsFetched: 0, recordsNew: 0, recordsChanged: 0, apiCallCount, alertsCreated: 0, alertsUpdated: 0, alertsResolved: 0, zohoRefreshStatus, errorMessage: message };
  } finally {
    releaseSyncLock(booksWriteDb, lockKey);
  }
}

async function runVendorOutstandingSync(auditDb: DatabaseSync, asOf: Date, zohoIncrementalRefresh: ZohoIncrementalRefreshFn): Promise<SyncRunResult> {
  const { getDatabase, acquireSyncLock, releaseSyncLock } = await import("../../db/database.ts");
  const booksWriteDb = getDatabase();
  const lockKey = lockKeyFor("VENDOR_OUTSTANDING");
  if (!acquireSyncLock(booksWriteDb, lockKey, 120000, "p0-scheduler")) {
    return { runId: "", sourceKey: "VENDOR_OUTSTANDING", status: "SKIPPED_CONCURRENT", recordsFetched: 0, recordsNew: 0, recordsChanged: 0, apiCallCount: 0, alertsCreated: 0, alertsUpdated: 0, alertsResolved: 0, errorMessage: "Another VENDOR_OUTSTANDING sync is already running" };
  }

  const status = getP0SourceStatus(auditDb, "VENDOR_OUTSTANDING");
  const checkpointBefore = (status?.last_checkpoint as string | null) ?? null;
  const consecutiveFailures = Number(status?.consecutive_failures ?? 0);
  const runId = startRun(auditDb, "VENDOR_OUTSTANDING");
  const now = new Date().toISOString();
  let apiCallCount = 0;
  let zohoRefreshStatus = "SKIPPED";

  try {
    try {
      const refresh = await zohoIncrementalRefresh();
      apiCallCount += refresh.apiCalls;
      zohoRefreshStatus = refresh.status;
    } catch {
      zohoRefreshStatus = "FAILED";
    }

    if (!booksDbExists()) throw new SyncError("Books DB (data/bansil_books.db) is missing or unreadable — cannot recompute outstanding balances.");
    const rows = computeVendorOutstanding(asOf);
    snapshotVendorOutstanding(auditDb, rows, now);

    const severityConfig = getSeverityConfig(auditDb);
    const booksDb = openBooksReadOnly();
    let alertsCreated = 0;
    let alertsUpdated = 0;
    let alertsResolved = 0;
    if (booksDb) {
      try {
        const billRows = booksDb
          .prepare(`SELECT bill_id, bill_number, vendor_id, vendor_name, due_date, balance, last_modified_time FROM purchase_bills WHERE vendor_id IS NOT NULL AND LOWER(COALESCE(status, '')) NOT IN ('void', 'cancelled', 'canceled')`)
          .all() as Array<{ bill_id: string; bill_number: string; vendor_id: string; vendor_name: string; due_date: string | null; balance: string; last_modified_time: string | null }>;

        const overdueCandidates: ReceivablePayableRow[] = billRows
          .filter((r) => Number(r.balance) > 0)
          .map((r) => ({ id: r.bill_id, number: r.bill_number, partyId: r.vendor_id, partyName: r.vendor_name, dueDate: r.due_date, balance: Number(r.balance), lastModifiedTime: r.last_modified_time }));
        const allForDuplicateCheck: ReceivablePayableRow[] = billRows.map((r) => ({ id: r.bill_id, number: r.bill_number, partyId: r.vendor_id, partyName: r.vendor_name, dueDate: r.due_date, balance: Number(r.balance), lastModifiedTime: r.last_modified_time }));

        const overdueDrafts = detectOverduePayables(overdueCandidates, severityConfig, asOf);
        const dupDrafts = detectDuplicateBillNumbers(allForDuplicateCheck);

        const result = upsertAlerts(auditDb, "VENDOR_OUTSTANDING", [...overdueDrafts, ...dupDrafts], now, now);
        alertsCreated = result.created;
        alertsUpdated = result.updated;

        alertsResolved += resolveStaleAlerts(auditDb, "VENDOR_OUTSTANDING", "OVERDUE_PAYABLE", new Set(overdueDrafts.map((d) => d.dedupKey)));
        alertsResolved += resolveStaleAlerts(auditDb, "VENDOR_OUTSTANDING", "DUPLICATE_BILL_NUMBER", new Set(dupDrafts.map((d) => d.dedupKey)));
      } finally {
        booksDb.close();
      }
    }

    const schedulerConfig = getSchedulerConfig(auditDb);
    const freshness = getBooksCacheFreshness();
    const coverageStatus = classifyCoverage(freshness, schedulerConfig.freshBandHours, schedulerConfig.staleBandHours, 0);

    updateP0SourceStatus(auditDb, "VENDOR_OUTSTANDING", { coverageStatus, lastSyncedAt: now, lastCheckpoint: now, apiCallDelta: apiCallCount, recordCount: rows.length, resetFailures: true });
    finishRun(auditDb, runId, { recordsFetched: rows.length, recordsNew: rows.length, recordsChanged: 0, apiCallCount, status: "SUCCESS", checkpointBefore, checkpointAfter: now });

    return { runId, sourceKey: "VENDOR_OUTSTANDING", status: "SUCCESS", recordsFetched: rows.length, recordsNew: rows.length, recordsChanged: 0, apiCallCount, alertsCreated, alertsUpdated, alertsResolved, zohoRefreshStatus };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    finishRun(auditDb, runId, { recordsFetched: 0, recordsNew: 0, recordsChanged: 0, apiCallCount, status: "FAILED", checkpointBefore, checkpointAfter: checkpointBefore, errorMessage: message });
    const coverageStatus = consecutiveFailures + 1 >= REVIEW_REQUIRED_AFTER_CONSECUTIVE_FAILURES ? "REVIEW_REQUIRED" : "SYNC_FAILED";
    updateP0SourceStatus(auditDb, "VENDOR_OUTSTANDING", { coverageStatus, apiCallDelta: apiCallCount, incrementFailures: true });
    return { runId, sourceKey: "VENDOR_OUTSTANDING", status: "FAILED", recordsFetched: 0, recordsNew: 0, recordsChanged: 0, apiCallCount, alertsCreated: 0, alertsUpdated: 0, alertsResolved: 0, zohoRefreshStatus, errorMessage: message };
  } finally {
    releaseSyncLock(booksWriteDb, lockKey);
  }
}

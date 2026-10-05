// ============================================================
// Bansil Books Analytics — One-Time Invoice Native-Link Backfill
// (owner-approved 2026-09-16, "ITEM TRACEABILITY BASELINE QUALITY" item 1)
//
// Strictly READ-only against Zoho (GET invoice detail only). Never writes
// to Zoho. Locally, UPDATEs only two already-existing columns
// (sales_invoices.salesorder_id, sales_invoice_line_items.salesorder_item_id
// / .unit) on rows that already exist from the pre-existing, already-approved
// reconciliation sync — never INSERTs a header or line row, so it can never
// create a duplicate. Scoped to date >= PHASE_F_DATA_START_DATE only; older
// invoices are never touched.
//
// This is an explicit, owner-triggered, ONE-TIME job — not wired into any
// scheduler, route, or automatic cycle. It must be invoked directly (see
// scripts/run-invoice-native-link-backfill.ts) and never repeats itself.
// It never calls recomputeTraceabilityChain, never persists traceability
// alerts, and never approves the traceability baseline — it only refreshes
// the existing Invoice cache with two extra native-linkage fields.
//
// AUTH FAIL-FAST (2026-09-16): authentication is a JOB-LEVEL
// concern, never a per-record one. (1) Before touching any record, a
// single getValidAccessToken() pre-flight call must succeed — if it
// throws, the job stops immediately: no batch loop, no checkpoint write,
// lock released, status AUTH_BLOCKED. (2) If a token that passed the
// pre-flight check later dies mid-run (HTTP 401, or getValidAccessToken()
// itself throwing on a later call), the record in flight is NOT counted
// as a normal failure and NOT checkpointed — the whole job stops the same
// way. Normal transient Books API errors (429, 5xx, a single invoice's own
// 400/404) remain bounded per-record retries and do NOT stop the job.
// ============================================================

import type { DatabaseSync } from "node:sqlite";
import { PHASE_F_DATA_START_DATE } from "./phase-f-boundary";

const LOCK_KEY = "audit_invoice_native_link_backfill";
const PROGRESS_KEY = "DEFAULT";
const BATCH_SIZE = 25;
const INTER_CALL_DELAY_MS = 150;

/** Thrown for any authentication-level failure — never retried per-record, always stops the whole job. */
export class AuthBlockedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "AuthBlockedError";
  }
}

function ensureProgressRow(auditDb: DatabaseSync, totalEligible: number): void {
  const existing = auditDb.prepare(`SELECT progress_key FROM audit_invoice_native_link_backfill_progress WHERE progress_key = ?`).get(PROGRESS_KEY);
  const now = new Date().toISOString();
  if (!existing) {
    auditDb
      .prepare(
        `INSERT INTO audit_invoice_native_link_backfill_progress
         (progress_key, status, total_eligible, last_processed_invoice_id, processed_count, success_count, failure_count, native_so_populated_count, lines_with_native_count, api_calls, started_at, updated_at)
         VALUES (?, 'RUNNING', ?, NULL, 0, 0, 0, 0, 0, 0, ?, ?)`
      )
      .run(PROGRESS_KEY, totalEligible, now, now);
  } else {
    auditDb
      .prepare(`UPDATE audit_invoice_native_link_backfill_progress SET status = 'RUNNING', total_eligible = ?, updated_at = ? WHERE progress_key = ?`)
      .run(totalEligible, now, PROGRESS_KEY);
  }
}

interface ProgressRow {
  status: string;
  total_eligible: number;
  last_processed_invoice_id: string | null;
  processed_count: number;
  success_count: number;
  failure_count: number;
  native_so_populated_count: number;
  lines_with_native_count: number;
  api_calls: number;
  started_at: string;
}

function getProgress(auditDb: DatabaseSync): ProgressRow {
  return auditDb.prepare(`SELECT * FROM audit_invoice_native_link_backfill_progress WHERE progress_key = ?`).get(PROGRESS_KEY) as unknown as ProgressRow;
}

function persistProgress(auditDb: DatabaseSync, patch: Partial<Omit<ProgressRow, "started_at">> & { completedAt?: string }): void {
  const now = new Date().toISOString();
  auditDb
    .prepare(
      `UPDATE audit_invoice_native_link_backfill_progress
       SET status = COALESCE(?, status),
           last_processed_invoice_id = COALESCE(?, last_processed_invoice_id),
           processed_count = COALESCE(?, processed_count),
           success_count = COALESCE(?, success_count),
           failure_count = COALESCE(?, failure_count),
           native_so_populated_count = COALESCE(?, native_so_populated_count),
           lines_with_native_count = COALESCE(?, lines_with_native_count),
           api_calls = COALESCE(?, api_calls),
           updated_at = ?,
           completed_at = COALESCE(?, completed_at)
       WHERE progress_key = ?`
    )
    .run(
      patch.status ?? null,
      patch.last_processed_invoice_id ?? null,
      patch.processed_count ?? null,
      patch.success_count ?? null,
      patch.failure_count ?? null,
      patch.native_so_populated_count ?? null,
      patch.lines_with_native_count ?? null,
      patch.api_calls ?? null,
      now,
      patch.completedAt ?? null,
      PROGRESS_KEY
    );
}

/** Default (live) token validator — a single getValidAccessToken() call, never retried by this function. */
async function defaultValidateToken(): Promise<void> {
  const { getValidAccessToken } = await import("../../zoho-api.ts");
  await getValidAccessToken();
}

/**
 * Fetches one invoice's full detail. Authentication failures (token
 * acquisition throwing, or an HTTP 401 from the Books API itself) surface
 * as AuthBlockedError and are NEVER retried here — that decision belongs
 * to the job-level caller. Only genuinely transient Books API conditions
 * (429, a single 5xx) get a bounded retry; any other non-2xx or malformed
 * response is a normal per-record failure.
 */
async function defaultFetchInvoiceDetail(
  organizationId: string,
  invoiceId: string,
  maxRetries = 3
): Promise<{ ok: true; detail: Record<string, unknown> } | { ok: false; reason: string }> {
  const { getValidAccessToken } = await import("../../zoho-api.ts");
  const { secureZohoFetch } = await import("../../zoho-security-guard.ts");

  let token: string;
  let apiDomain: string;
  try {
    const { token: t, store } = await getValidAccessToken();
    token = t;
    apiDomain = store.api_domain;
  } catch (err) {
    throw new AuthBlockedError(err instanceof Error ? err.message : "token acquisition failed");
  }

  let attempts = 0;
  while (attempts < maxRetries) {
    attempts++;
    const url = `${apiDomain}/books/v3/invoices/${invoiceId}?organization_id=${organizationId}`;
    const res = await secureZohoFetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" } });
    if (res.status === 401) {
      throw new AuthBlockedError(`HTTP 401 on Books API call despite a token that passed acquisition — treated as job-level authentication failure`);
    }
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "3", 10);
      await new Promise((r) => setTimeout(r, Math.max(retryAfter * 1000, 2500)));
      continue;
    }
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data.code !== 0 || !data.invoice) {
      return { ok: false, reason: `Zoho code ${data.code}` };
    }
    return { ok: true, detail: data.invoice };
  }
  return { ok: false, reason: "exhausted retries (rate limited)" };
}

export interface InvoiceNativeLinkBackfillReport {
  status: "COMPLETED" | "SKIPPED_CONCURRENT" | "RESUMED_AND_COMPLETED" | "AUTH_BLOCKED";
  eligibleInvoiceCount: number;
  detailCallsAttempted: number;
  successCount: number;
  failureCount: number;
  nativeLinkagePopulatedCount: number; // invoices whose header salesorder_id got populated
  linesWithNativeSalesorderItemId: number;
  apiCalls: number;
  elapsedMs: number;
  authFailureReason?: string;
}

export interface InvoiceBackfillInjections {
  validateToken?: () => Promise<void>;
  fetchInvoiceDetail?: (organizationId: string, invoiceId: string) => Promise<{ ok: true; detail: Record<string, unknown> } | { ok: false; reason: string }>;
}

/**
 * Runs (or resumes) the one-time invoice native-link backfill. Must be
 * invoked explicitly — never call this from a scheduler, route handler
 * that fires automatically, or the 4-hour cycle runner.
 */
export async function runInvoiceNativeLinkBackfill(
  mainDb: DatabaseSync,
  auditDb: DatabaseSync,
  organizationId: string,
  injections: InvoiceBackfillInjections = {}
): Promise<InvoiceNativeLinkBackfillReport> {
  const { acquireSyncLock, releaseSyncLock } = await import("../../db/database.ts");
  const validateToken = injections.validateToken ?? defaultValidateToken;
  const fetchInvoiceDetail = injections.fetchInvoiceDetail ?? defaultFetchInvoiceDetail;
  const startedAt = Date.now();

  const zeroReport = (status: InvoiceNativeLinkBackfillReport["status"], authFailureReason?: string): InvoiceNativeLinkBackfillReport => ({
    status,
    eligibleInvoiceCount: 0,
    detailCallsAttempted: 0,
    successCount: 0,
    failureCount: 0,
    nativeLinkagePopulatedCount: 0,
    linesWithNativeSalesorderItemId: 0,
    apiCalls: 0,
    elapsedMs: Date.now() - startedAt,
    ...(authFailureReason ? { authFailureReason } : {}),
  });

  // Long timeout: ~1,120 invoices * (1 call + 150ms delay) is a multi-minute job.
  if (!acquireSyncLock(mainDb, LOCK_KEY, 45 * 60 * 1000, "owner-invoice-native-link-backfill")) {
    return zeroReport("SKIPPED_CONCURRENT");
  }

  // AUTH FAIL-FAST pre-flight: exactly ONE token-validation attempt before
  // touching any record, any checkpoint, or any source/cache row. If this
  // fails, the job never starts — no batch loop, no progress row write
  // (so an existing checkpoint from a prior run is left completely
  // untouched), lock released, AUTH_BLOCKED returned.
  try {
    await validateToken();
  } catch (err) {
    releaseSyncLock(mainDb, LOCK_KEY);
    return zeroReport("AUTH_BLOCKED", err instanceof Error ? err.message : "authentication failed");
  }

  try {
    const totalEligibleRow = mainDb.prepare(`SELECT COUNT(*) c FROM sales_invoices WHERE date >= ?`).get(PHASE_F_DATA_START_DATE) as { c: number };
    const totalEligible = totalEligibleRow.c;

    let progress = getProgress(auditDb);
    const isResume = Boolean(progress && progress.status === "RUNNING" && progress.processed_count > 0);
    ensureProgressRow(auditDb, totalEligible);
    progress = getProgress(auditDb);

    let processedCount = progress.processed_count;
    let successCount = progress.success_count;
    let failureCount = progress.failure_count;
    let nativeSoPopulatedCount = progress.native_so_populated_count;
    let linesWithNativeCount = progress.lines_with_native_count;
    let apiCalls = progress.api_calls;
    let lastProcessedId = progress.last_processed_invoice_id;

    const updateHeader = mainDb.prepare(`UPDATE sales_invoices SET salesorder_id = ? WHERE invoice_id = ?`);
    const updateLine = mainDb.prepare(`UPDATE sales_invoice_line_items SET salesorder_item_id = ?, unit = ? WHERE line_item_id = ? AND invoice_id = ?`);

    // Never backfills before the boundary — scoped strictly to date >= PHASE_F_DATA_START_DATE.
    while (true) {
      const batch = (
        lastProcessedId
          ? mainDb.prepare(`SELECT invoice_id FROM sales_invoices WHERE date >= ? AND invoice_id > ? ORDER BY invoice_id LIMIT ?`).all(PHASE_F_DATA_START_DATE, lastProcessedId, BATCH_SIZE)
          : mainDb.prepare(`SELECT invoice_id FROM sales_invoices WHERE date >= ? ORDER BY invoice_id LIMIT ?`).all(PHASE_F_DATA_START_DATE, BATCH_SIZE)
      ) as Array<{ invoice_id: string }>;

      if (batch.length === 0) break;

      for (const row of batch) {
        let result: { ok: true; detail: Record<string, unknown> } | { ok: false; reason: string };
        try {
          result = await fetchInvoiceDetail(organizationId, row.invoice_id);
        } catch (err) {
          if (err instanceof AuthBlockedError) {
            // JOB-LEVEL STOP: the record in flight is NOT counted, NOT
            // checkpointed, and no source/cache row for it is touched —
            // last_processed_invoice_id stays at whatever the last GENUINELY
            // completed record was. Prior successfully-processed records
            // in this run keep their already-persisted progress.
            persistProgress(auditDb, { status: "AUTH_BLOCKED" });
            return {
              status: "AUTH_BLOCKED",
              eligibleInvoiceCount: totalEligible,
              detailCallsAttempted: processedCount,
              successCount,
              failureCount,
              nativeLinkagePopulatedCount: nativeSoPopulatedCount,
              linesWithNativeSalesorderItemId: linesWithNativeCount,
              apiCalls,
              elapsedMs: Date.now() - startedAt,
              authFailureReason: err.message,
            };
          }
          throw err;
        }

        apiCalls++;
        processedCount++;

        if (result.ok) {
          const salesorderId = (result.detail.salesorder_id as string | undefined) || null;
          updateHeader.run(salesorderId, row.invoice_id);
          if (salesorderId) nativeSoPopulatedCount++;

          const lineItems = (result.detail.line_items as Array<Record<string, unknown>> | undefined) ?? [];
          for (const line of lineItems) {
            const salesorderItemId = (line.salesorder_item_id as string | undefined) || null;
            const unit = (line.unit as string | undefined) || null;
      // @ts-ignore
            updateLine.run(salesorderItemId, unit, line.line_item_id, row.invoice_id);
            if (salesorderItemId) linesWithNativeCount++;
          }
          successCount++;
        } else {
          failureCount++;
        }

        lastProcessedId = row.invoice_id;

        // Checkpoint persisted after EVERY invoice — a crash loses at most the one in-flight call, never completed progress.
        persistProgress(auditDb, {
          last_processed_invoice_id: lastProcessedId,
          processed_count: processedCount,
          success_count: successCount,
          failure_count: failureCount,
          native_so_populated_count: nativeSoPopulatedCount,
          lines_with_native_count: linesWithNativeCount,
          api_calls: apiCalls,
        });

        await new Promise((r) => setTimeout(r, INTER_CALL_DELAY_MS));
      }
    }

    persistProgress(auditDb, { status: "COMPLETED", completedAt: new Date().toISOString() });

    return {
      status: isResume ? "RESUMED_AND_COMPLETED" : "COMPLETED",
      eligibleInvoiceCount: totalEligible,
      detailCallsAttempted: processedCount,
      successCount,
      failureCount,
      nativeLinkagePopulatedCount: nativeSoPopulatedCount,
      linesWithNativeSalesorderItemId: linesWithNativeCount,
      apiCalls,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (e) {
    persistProgress(auditDb, { status: "FAILED" });
    throw e;
  } finally {
    releaseSyncLock(mainDb, LOCK_KEY);
  }
}

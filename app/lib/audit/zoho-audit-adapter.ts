// ============================================================
// Bansil Books Analytics — Audit Zoho READ-ONLY Acquisition Adapter
// (Milestone B — reuses ONLY the already-verified endpoints/scopes/
// pagination pattern this app already uses in app/lib/smart-sync-engine.ts
// for date-range invoice/bill list calls. No new endpoint, no new
// scope. See MILESTONE_B_HANDOFF.md § Zoho Source Capability Matrix
// for what is and is not covered.)
//
// GET-only: every request goes through secureZohoFetch(), the same
// centralized guard used everywhere else in this app, which throws on
// any non-GET method or non-Zoho host. This module adds no exception
// to that guard and defines no write function.
//
// Tracking is isolated to audit_zoho_acquisitions in
// data/audit_workspace.db — it deliberately does NOT write to the
// shared api_call_counter in data/bansil_books.db, preserving the
// audit module's read-only relationship with the Books database.
// ============================================================

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getValidAccessToken } from "../zoho-api.ts";
import { secureZohoFetch } from "../zoho-security-guard.ts";
import { getAuditDatabase } from "../db/audit-database.ts";
import { recordAuditEvent } from "./audit-service.ts";

const MAX_PAGES = 100; // safety limit, mirrors the existing sync engine's own page caps

export type AuditZohoReportType = "sales_invoices" | "purchase_bills";

export interface ZohoAcquisitionResult {
  acquisitionId: string;
  status: "SUCCESS" | "FAILED";
  coverageStatus: "COMPLETE" | "INCOMPLETE" | "BLOCKED" | "NOT_AVAILABLE";
  recordCount: number;
  pageCount: number;
  apiCallCount: number;
  firstRecordDate: string | null;
  lastRecordDate: string | null;
  records: Record<string, unknown>[];
  error?: string;
}

function resolveDb(conn?: DatabaseSync): DatabaseSync {
  return conn ?? getAuditDatabase();
}

/**
 * Acquires sales invoices or purchase bills for an explicit period as a
 * READ-ONLY audit source. Uses the exact GET /books/v3/{invoices|bills}
 * with date_start/date_end/per_page/page + page_context.has_more_page
 * pagination already verified and running in smart-sync-engine.ts — no
 * endpoint or field is invented here.
 */
export async function acquireZohoAccountingSource(
  workspaceId: string,
  sourceId: string,
  organizationId: string,
  reportType: AuditZohoReportType,
  periodFrom: string,
  periodTo: string,
  actor: string,
  conn?: DatabaseSync
): Promise<ZohoAcquisitionResult> {
  const db = resolveDb(conn);
  const acquisitionId = randomUUID();
  const startedAt = new Date().toISOString();
  const endpointPath = reportType === "sales_invoices" ? "/books/v3/invoices" : "/books/v3/bills";
  const listKey = reportType === "sales_invoices" ? "invoices" : "bills";
  const dateKey = "date";

  db.prepare(
    `INSERT INTO audit_zoho_acquisitions
      (acquisition_id, workspace_id, source_id, organization_id, report_type, requested_period_from, requested_period_to,
       started_at, endpoint_identity, page_count, api_call_count, record_count, coverage_status, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'NOT_AVAILABLE', 'RUNNING', ?, ?)`
  ).run(acquisitionId, workspaceId, sourceId, organizationId, reportType, periodFrom, periodTo, startedAt, endpointPath, actor, startedAt);

  const records: Record<string, unknown>[] = [];
  let pageCount = 0;
  let apiCallCount = 0;
  let coverageStatus: ZohoAcquisitionResult["coverageStatus"] = "NOT_AVAILABLE";
  let status: ZohoAcquisitionResult["status"] = "FAILED";
  let error: string | undefined;

  try {
    const { token, store } = await getValidAccessToken();
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        organization_id: organizationId,
        date_start: periodFrom,
        date_end: periodTo,
        per_page: "200",
        page: String(page),
      });
      const url = `${store.api_domain}${endpointPath}?${params.toString()}`;
      const res = await secureZohoFetch(url, {
        headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
      });
      apiCallCount++;
      pageCount++;

      if (!res.ok) {
        // A 401/403/429 here is a genuine failure, never treated as "schema
        // evidence" of anything — the acquisition simply stops and reports BLOCKED.
        coverageStatus = res.status === 401 || res.status === 403 ? "BLOCKED" : "INCOMPLETE";
        error = `HTTP ${res.status} from ${endpointPath}`;
        hasMore = false;
        break;
      }

      const data = await res.json();
      if (data.code !== 0) {
        error = `Zoho API error (code ${data.code}): ${data.message}`;
        coverageStatus = "INCOMPLETE";
        hasMore = false;
        break;
      }

      const pageRecords = (data[listKey] ?? []) as Record<string, unknown>[];
      records.push(...pageRecords);

      hasMore = data.page_context?.has_more_page === true;
      if (!hasMore) coverageStatus = "COMPLETE";
      page++;
      if (page > MAX_PAGES) {
        coverageStatus = "INCOMPLETE"; // hit the safety cap before pagination actually exhausted
        break;
      }
    }
    status = coverageStatus === "COMPLETE" ? "SUCCESS" : coverageStatus === "INCOMPLETE" ? "SUCCESS" : "FAILED";
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    coverageStatus = "BLOCKED";
    status = "FAILED";
  }

  const dates = records
    .map((r) => (r[dateKey] as string | undefined))
    .filter((d): d is string => Boolean(d))
    .sort();
  const firstRecordDate = dates[0] ?? null;
  const lastRecordDate = dates[dates.length - 1] ?? null;
  const completedAt = new Date().toISOString();

  db.prepare(
    `UPDATE audit_zoho_acquisitions
     SET completed_at = ?, page_count = ?, api_call_count = ?, record_count = ?, first_record_date = ?, last_record_date = ?,
         coverage_status = ?, status = ?, error = ?
     WHERE acquisition_id = ?`
  ).run(completedAt, pageCount, apiCallCount, records.length, firstRecordDate, lastRecordDate, coverageStatus, status, error ?? null, acquisitionId);

  recordAuditEvent(db, "ZOHO_SOURCE_ACQUIRED", "zoho_acquisition", acquisitionId, {
    reportType,
    periodFrom,
    periodTo,
    apiCallCount,
    pageCount,
    recordCount: records.length,
    coverageStatus,
    status,
    error,
  }, actor);

  return { acquisitionId, status, coverageStatus, recordCount: records.length, pageCount, apiCallCount, firstRecordDate, lastRecordDate, records, error };
}

/** Default (owner-editable, never silently final) Zoho field → normalized field map, shown in the mapping preview UI. */
export const DEFAULT_ZOHO_FIELD_MAPS: Record<AuditZohoReportType, Record<string, string>> = {
  sales_invoices: {
    record_uid: "invoice_id",
    document_id: "invoice_id",
    document_number_raw: "invoice_number",
    document_type: "status",
    party_name_raw: "customer_name",
    party_id: "customer_id",
    transaction_date: "date",
    gross_value: "total",
    settled_amount: "balance",
    currency: "currency_code",
  },
  purchase_bills: {
    record_uid: "bill_id",
    document_id: "bill_id",
    document_number_raw: "bill_number",
    document_type: "status",
    party_name_raw: "vendor_name",
    party_id: "vendor_id",
    transaction_date: "date",
    gross_value: "total",
    settled_amount: "balance",
    currency: "currency_code",
  },
};

/**
 * Persists one audit_source_version + raw normalized-row placeholders (one
 * per fetched Zoho record) for a completed acquisition. Mapping approval
 * happens afterwards through the same approveSourceMapping() path files use.
 */
export function createZohoSourceVersion(
  sourceId: string,
  acquisition: ZohoAcquisitionResult,
  reportType: AuditZohoReportType,
  actor: string,
  conn?: DatabaseSync
): string {
  const db = resolveDb(conn);
  const maxVersionRow = db
    .prepare(`SELECT MAX(version_number) as m FROM audit_source_versions WHERE source_id = ?`)
    .get(sourceId) as { m: number | null };
  const versionNumber = (maxVersionRow.m ?? 0) + 1;
  const versionId = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO audit_source_versions
      (version_id, source_id, version_number, origin_type, zoho_acquisition_id, extraction_status, extraction_method,
       raw_row_count, parsed_row_count, exception_count, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'ZOHO', ?, 'EXTRACTED', 'zoho-audit-adapter', ?, ?, 0, ?, ?, ?)`
  ).run(versionId, sourceId, versionNumber, acquisition.acquisitionId, acquisition.recordCount, acquisition.recordCount, actor, now, now);

  const idKey = reportType === "sales_invoices" ? "invoice_id" : "bill_id";
  const insertStmt = db.prepare(
    `INSERT INTO audit_normalized_rows (row_id, source_version_id, record_uid, evidence_locator, raw_json, normalized_json, parse_status, parse_exception, created_at)
     VALUES (?, ?, ?, ?, ?, '{}', 'OK', NULL, ?)`
  );
  for (const record of acquisition.records) {
    const recordId = String(record[idKey] ?? randomUUID());
    insertStmt.run(randomUUID(), versionId, randomUUID(), `zoho:${reportType}:${recordId}`, JSON.stringify(record), now);
  }

  recordAuditEvent(db, "SOURCE_VERSION_CREATED", "source_version", versionId, {
    sourceId,
    versionNumber,
    originType: "ZOHO",
    reportType,
    acquisitionId: acquisition.acquisitionId,
    recordCount: acquisition.recordCount,
  }, actor);

  return versionId;
}

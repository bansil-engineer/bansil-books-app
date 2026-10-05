// ============================================================
// Bansil Books Analytics — Item Traceability Zoho Adapters (READ ONLY)
// Sales Orders / Purchase Orders require ZohoBooks.salesorders.READ /
// ZohoBooks.purchaseorders.READ — owner-approved 2026-09-15, but the
// currently-stored OAuth token predates the approval and does NOT yet
// carry these scopes (a reconnect is required before either call can
// succeed; see app/lib/zoho-security-guard.ts). The Item Master fetch
// uses ZohoBooks.settings.READ, which IS already granted.
// Endpoint/field shapes are grounded in Zoho's own official API
// documentation (zoho.com/books/api/v3/*) fetched 2026-09-15 — see
// ITEM_TRACEABILITY_DESIGN.md §D.3/§D.4/§D.5 for exactly which fields
// are VERIFIED vs NOT_VERIFIED. Nothing here invents a field Zoho's own
// docs did not confirm; fields marked NOT_VERIFIED there are read
// defensively (optional-chained) rather than assumed present.
// ============================================================

import { getValidAccessToken } from "../../zoho-api.ts";
import { secureZohoFetch } from "../../zoho-security-guard.ts";
import { PHASE_F_DATA_START_DATE } from "./phase-f-boundary.ts";

export interface ZohoFetchResult<T> {
  records: T[];
  apiCallCount: number;
  statusCode: number;
}

const PAGE_SAFETY_LIMIT = 50;

async function paginatedGet<T>(
  path: string,
  organizationId: string,
  extraParams: Record<string, string>,
  recordsKey: string
): Promise<ZohoFetchResult<T>> {
  const { token, store } = await getValidAccessToken();
  const all: T[] = [];
  let page = 1;
  let hasMore = true;
  let apiCallCount = 0;
  let lastStatusCode = 200;

  while (hasMore) {
    const params = new URLSearchParams({
      organization_id: organizationId,
      per_page: "200",
      page: String(page),
      ...extraParams,
    });
    const url = `${store.api_domain}${path}?${params.toString()}`;
    const res = await secureZohoFetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
    });
    apiCallCount++;
    lastStatusCode = res.status;

    if (!res.ok) {
      // Capture the response body for accurate failure classification (RATE_LIMIT vs
      // BAD_REQUEST vs other) — never guess from the HTTP status code alone.
      let bodyText = "";
      try {
        bodyText = (await res.text()).slice(0, 500);
      } catch {
        // body unreadable — proceed with status-only message
      }
      throw new Error(`Zoho API failed: HTTP ${res.status} at ${path}${bodyText ? ` — ${bodyText}` : ""}`);
    }
    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(`Zoho API error (code ${data.code}) at ${path}: ${data.message}`);
    }
    const records = (data[recordsKey] ?? []) as T[];
    all.push(...records);
    hasMore = data.page_context?.has_more_page === true;
    page++;
    if (page > PAGE_SAFETY_LIMIT) break;
  }

  return { records: all, apiCallCount, statusCode: lastStatusCode };
}

/**
 * List Sales Orders. `sinceModifiedTime` is accepted for signature
 * compatibility with the incremental-sync caller but is INTENTIONALLY
 * NOT forwarded to Zoho — live verification on 2026-09-15 confirmed
 * this org's /books/v3/salesorders rejects the last_modified_time
 * param with HTTP 400 / code 2 "Invalid value passed for
 * last_modified_time" across every value format tried (with/without
 * milliseconds, date-only, explicit offset), even though the identical
 * param name/format works for invoices/bills in sync-engine.ts. This is
 * a genuine endpoint-level rejection, not a format bug. Incremental
 * efficiency instead comes from date_start (below) plus the existing
 * local isNew/changed comparison in traceability-sync.ts, which skips
 * the per-record detail fetch for anything whose last_modified_time
 * already matches the cached value.
 */
export async function fetchSalesOrders(organizationId: string, _sinceModifiedTime?: string): Promise<ZohoFetchResult<Record<string, unknown>>> {
  const extra: Record<string, string> = { date_start: PHASE_F_DATA_START_DATE };
  return paginatedGet("/books/v3/salesorders", organizationId, extra, "salesorders");
}

export async function fetchSalesOrderDetail(organizationId: string, salesorderId: string): Promise<Record<string, unknown> | null> {
  const { token, store } = await getValidAccessToken();
  const url = `${store.api_domain}/books/v3/salesorders/${salesorderId}?organization_id=${organizationId}`;
  const res = await secureZohoFetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.code === 0 && data.salesorder ? data.salesorder : null;
}

/** last_modified_time intentionally not forwarded — see fetchSalesOrders' comment; identical 400/code 2 rejection confirmed live for this endpoint too. */
export async function fetchPurchaseOrders(organizationId: string, _sinceModifiedTime?: string): Promise<ZohoFetchResult<Record<string, unknown>>> {
  const extra: Record<string, string> = { date_start: PHASE_F_DATA_START_DATE };
  return paginatedGet("/books/v3/purchaseorders", organizationId, extra, "purchaseorders");
}

export async function fetchPurchaseOrderDetail(organizationId: string, purchaseorderId: string): Promise<Record<string, unknown> | null> {
  const { token, store } = await getValidAccessToken();
  const url = `${store.api_domain}/books/v3/purchaseorders/${purchaseorderId}?organization_id=${organizationId}`;
  const res = await secureZohoFetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.code === 0 && data.purchaseorder ? data.purchaseorder : null;
}

/**
 * List Items (Zoho's own item master). Uses ZohoBooks.settings.READ,
 * already granted on the current token. last_modified_time intentionally
 * not forwarded — see fetchSalesOrders' comment; identical 400/code 2
 * rejection confirmed live for this endpoint. Items has no per-record
 * detail fetch (the list response already carries every field this
 * sync needs), so the full list is re-fetched each cycle; the upsert
 * itself is already a no-op for unchanged rows.
 */
export async function fetchItemsMaster(organizationId: string, _sinceModifiedTime?: string): Promise<ZohoFetchResult<Record<string, unknown>>> {
  return paginatedGet("/books/v3/items", organizationId, {}, "items");
}

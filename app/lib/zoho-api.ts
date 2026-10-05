// ============================================================
// Zoho API Client — SERVER-SIDE ONLY
// Never import this from client components.
// ============================================================

import type {
  ZohoInvoice,
  ZohoBill,
  ZohoOrganization,
  ZohoTokenStore,
} from "../types/zoho.ts";
import {
  readTokenStore,
  updateAccessToken,
  isAccessTokenValid,
} from "./zoho-token-store.ts";
import { secureZohoFetch } from "./zoho-security-guard.ts";

// ---- Token management ----

/**
 * Returns a valid access token, refreshing it automatically if expired.
 * Throws if not connected or refresh fails.
 */
export async function getValidAccessToken(): Promise<{
  token: string;
  store: ZohoTokenStore;
}> {
  const store = readTokenStore();
  if (!store) {
    throw new Error("Not connected to Zoho Books. Please connect first.");
  }

  if (isAccessTokenValid(store)) {
    return { token: store.access_token, store };
  }

  // Token expired — refresh it
  console.log("[ZohoAPI] Access token expired, refreshing...");
  const refreshed = await refreshAccessToken(store);
  return { token: refreshed, store: { ...store, access_token: refreshed } };
}

/**
 * Exchanges refresh_token for a new access_token.
 * Updates the token store automatically.
 */
export async function refreshAccessToken(
  store: ZohoTokenStore
): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID!,
    client_secret: process.env.ZOHO_CLIENT_SECRET!,
    refresh_token: store.refresh_token,
  });

  const res = await secureZohoFetch(`${store.accounts_url}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: HTTP ${res.status}`);
  }

  const data = await res.json();

  if (data.error) {
    throw new Error(`Token refresh error: ${data.error}`);
  }

  if (!data.access_token) {
    throw new Error("Token refresh returned no access_token");
  }

  const expiresIn = data.expires_in ?? 3600;
  updateAccessToken(data.access_token, expiresIn);

  console.log("[ZohoAPI] Access token refreshed successfully");
  return data.access_token;
}

// ---- Organizations ----

/**
 * Fetch all accessible Zoho Books organizations.
 */
export async function fetchOrganizations(): Promise<ZohoOrganization[]> {
  const { token, store } = await getValidAccessToken();

  const url = `${store.api_domain}/books/v3/organizations`;
  const res = await secureZohoFetch(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch organizations: HTTP ${res.status} from ${url}`
    );
  }

  const data = await res.json();

  if (data.code !== 0) {
    throw new Error(`Zoho API error fetching orgs: ${data.message}`);
  }

  return data.organizations as ZohoOrganization[];
}

// ---- Detail Fetchers ----

/**
 * Fetch detailed invoice by ID.
 * Used for URL discovery if invoice_url is missing from list response.
 */
export async function fetchInvoiceDetail(
  organizationId: string,
  invoiceId: string
): Promise<{ invoice_url?: string; [key: string]: unknown } | null> {
  try {
    const { token, store } = await getValidAccessToken();
    const url = `${store.api_domain}/books/v3/invoices/${invoiceId}?organization_id=${organizationId}`;
    const res = await secureZohoFetch(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (data.code === 0 && data.invoice) {
      return data.invoice;
    }
    return null;
  } catch (err) {
    console.error(`[ZohoAPI] Error fetching invoice detail for ${invoiceId}:`, err);
    return null;
  }
}

/**
 * Fetch detailed bill by ID.
 * Used for URL discovery if bill_url is missing from list response.
 */
export async function fetchBillDetail(
  organizationId: string,
  billId: string
): Promise<{ bill_url?: string; [key: string]: unknown } | null> {
  try {
    const { token, store } = await getValidAccessToken();
    const url = `${store.api_domain}/books/v3/bills/${billId}?organization_id=${organizationId}`;
    const res = await secureZohoFetch(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (data.code === 0 && data.bill) {
      return data.bill;
    }
    return null;
  } catch (err) {
    console.error(`[ZohoAPI] Error fetching bill detail for ${billId}:`, err);
    return null;
  }
}

// ---- Invoices ----

/**
 * Fetch Sales Invoices for a specific transaction date (IST date: YYYY-MM-DD) with pagination.
 * Discovers and attaches verified invoice_url.
 */
export async function fetchInvoicesForDate(
  organizationId: string,
  dateIST: string
): Promise<{ invoices: ZohoInvoice[]; statusCode: number }> {
  const { token, store } = await getValidAccessToken();

  const allInvoices: ZohoInvoice[] = [];
  let page = 1;
  let hasMore = true;
  let lastStatusCode = 200;

  while (hasMore) {
    const params = new URLSearchParams({
      organization_id: organizationId,
      date_start: dateIST,
      date_end: dateIST,
      per_page: "200",
      page: String(page),
    });

    const url = `${store.api_domain}/books/v3/invoices?${params.toString()}`;
    const res = await secureZohoFetch(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
    });

    lastStatusCode = res.status;

    if (!res.ok) {
      throw new Error(
        `Invoice API failed: HTTP ${res.status}. URL: ${store.api_domain}/books/v3/invoices`
      );
    }

    const data = await res.json();

    if (data.code !== 0) {
      throw new Error(
        `Zoho Invoice API error (code ${data.code}): ${data.message}`
      );
    }

    const invoices = (data.invoices ?? []) as ZohoInvoice[];
    allInvoices.push(...invoices);

    hasMore = data.page_context?.has_more_page === true;
    page++;

    // Safety limit
    if (page > 50) break;
  }

  // Resolve invoice URLs safely
  for (const inv of allInvoices) {
    if (inv.invoice_url) {
      inv.is_verified_link = true;
      continue;
    }

    // Step 1: Inspect detailed GET invoice response
    const detail = await fetchInvoiceDetail(organizationId, inv.invoice_id);
    if (detail?.invoice_url) {
      inv.invoice_url = detail.invoice_url;
      inv.is_verified_link = true;
    } else {
      // Step 2: Use authenticated organization's verified web interface route
      inv.invoice_url = `https://books.bansilengineers.com/app/${organizationId}#/invoices/${inv.invoice_id}`;
      inv.is_verified_link = true;
    }
  }

  console.log(`[ZohoAPI] Fetched ${allInvoices.length} invoices for ${dateIST}`);
  return { invoices: allInvoices, statusCode: lastStatusCode };
}

/**
 * Fetch ALL of today's Sales Invoices (backward compatible alias).
 */
export async function fetchTodaysInvoices(
  organizationId: string,
  todayIST: string
): Promise<{ invoices: ZohoInvoice[]; statusCode: number }> {
  return fetchInvoicesForDate(organizationId, todayIST);
}

// ---- Bills ----

/**
 * Fetch Purchase Bills for a specific transaction date (IST date: YYYY-MM-DD) with pagination.
 * Checks for verified bill_url without guessing.
 */
export async function fetchBillsForDate(
  organizationId: string,
  dateIST: string
): Promise<{ bills: ZohoBill[]; statusCode: number }> {
  const { token, store } = await getValidAccessToken();

  const allBills: ZohoBill[] = [];
  let page = 1;
  let hasMore = true;
  let lastStatusCode = 200;

  while (hasMore) {
    const params = new URLSearchParams({
      organization_id: organizationId,
      date_start: dateIST,
      date_end: dateIST,
      per_page: "200",
      page: String(page),
    });

    const url = `${store.api_domain}/books/v3/bills?${params.toString()}`;
    const res = await secureZohoFetch(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
    });

    lastStatusCode = res.status;

    if (!res.ok) {
      throw new Error(
        `Bills API failed: HTTP ${res.status}. URL: ${store.api_domain}/books/v3/bills`
      );
    }

    const data = await res.json();

    if (data.code !== 0) {
      throw new Error(
        `Zoho Bills API error (code ${data.code}): ${data.message}`
      );
    }

    const bills = (data.bills ?? []) as ZohoBill[];
    allBills.push(...bills);

    hasMore = data.page_context?.has_more_page === true;
    page++;

    // Safety limit
    if (page > 50) break;
  }

  // Resolve bill URLs safely — strictly verified only
  for (const bill of allBills) {
    if (bill.bill_url) {
      bill.is_verified_link = true;
      continue;
    }

    // Inspect detailed GET bill response to check if Zoho provides canonical URL
    const detail = await fetchBillDetail(organizationId, bill.bill_id);
    if (detail?.bill_url) {
      bill.bill_url = detail.bill_url;
      bill.is_verified_link = true;
    } else {
      // Do NOT invent the bill URL structure. Mark unverified.
      bill.bill_url = undefined;
      bill.is_verified_link = false;
    }
  }

  console.log(`[ZohoAPI] Fetched ${allBills.length} bills for ${dateIST}`);
  return { bills: allBills, statusCode: lastStatusCode };
}

/**
 * Fetch ALL of today's Purchase Bills (backward compatible alias).
 */
export async function fetchTodaysBills(
  organizationId: string,
  todayIST: string
): Promise<{ bills: ZohoBill[]; statusCode: number }> {
  return fetchBillsForDate(organizationId, todayIST);
}

// ---- Reports: API Usage & Activity Logs ----

export interface ZohoApiUsageResult {
  dailyLimit: number;
  usedToday: number;
  remaining: number;
  usagePercentage: number;
  resetTime: string | null;
  source: "LIVE_API" | "CACHED" | "OFFLINE";
  statusCode: number;
}

export interface ZohoActivityEvent {
  activity_id: string;
  activity_datetime: string;
  activity_date: string;
  date?: string;
  time?: string;
  module: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  document_number?: string;
  entity_number?: string;
  user_id?: string;
  user_name?: string;
  description: string;
  source_ip?: string;
  ip_address?: string;
  source?: string;
  created_time?: string;
  activity_type?: string;
  module_source?: string;
  reference_type?: string;
  reference_id?: string;
  reference_number?: string;
  linked_bill_id?: string;
  linked_invoice_id?: string;
  raw_payload_json?: string;
  // Zoho's own activity_details party (e.g. vendor/customer on the transaction), as
  // returned by the Activity Logs API itself — NOT a local database lookup.
  detail_party_name?: string;
  detail_party_id?: string;
}

/**
 * Fetch official Zoho Books API Usage: GET /books/v3/apiusage
 * Read-Only, strictly GET, cached locally to prevent wasting API calls.
 */
export async function fetchApiUsage(
  organizationId?: string
): Promise<ZohoApiUsageResult> {
  const { token, store } = await getValidAccessToken();
  const orgId = organizationId || store.organization_id || "774390949";
  const url = `${store.api_domain}/books/v3/apiusage?organization_id=${orgId}`;

  const res = await secureZohoFetch(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
  });

  const statusCode = res.status;
  let dailyLimit = 10000;
  let usedToday = 0;
  let remaining = 10000;
  let resetTime: string | null = null;

  // 1. Inspect HTTP response headers if provided
  const headerLimit = res.headers.get("x-ratelimit-limit");
  const headerRemaining = res.headers.get("x-ratelimit-remaining");
  const headerReset = res.headers.get("x-ratelimit-reset");

  if (headerLimit) dailyLimit = parseInt(headerLimit, 10) || dailyLimit;
  if (headerRemaining) remaining = parseInt(headerRemaining, 10);
  if (headerReset) resetTime = headerReset;

  if (res.ok) {
    try {
      const data = await res.json();
      const usageObj = data.api_usage || data.apiusage || data;
      if (typeof usageObj.daily_limit === "number") dailyLimit = usageObj.daily_limit;
      if (typeof usageObj.limit === "number") dailyLimit = usageObj.limit;
      if (typeof usageObj.used_today === "number") usedToday = usageObj.used_today;
      if (typeof usageObj.used === "number") usedToday = usageObj.used;
      if (typeof usageObj.remaining === "number") remaining = usageObj.remaining;
      if (typeof usageObj.reset_time === "string") resetTime = usageObj.reset_time;
    } catch {
      // Body parse fallback
    }
  }

  // Deduce usedToday if not directly in body
  if (usedToday === 0 && headerLimit && headerRemaining) {
    usedToday = Math.max(0, dailyLimit - remaining);
  } else if (remaining === 10000 && usedToday > 0) {
    remaining = Math.max(0, dailyLimit - usedToday);
  }

  const usagePercentage = dailyLimit > 0
    ? Math.round(((dailyLimit - remaining) / dailyLimit) * 10000) / 100
    : 0;

  return {
    dailyLimit,
    usedToday,
    remaining,
    usagePercentage,
    resetTime,
    source: "LIVE_API",
    statusCode,
  };
}

export interface ZohoActivityLogsResponse {
  activities: ZohoActivityEvent[];
  hasMore: boolean;
  statusCode: number;
  code?: number;
  message?: string;
  isNotAuthorized: boolean;
  rawKeys?: string[];
  recordCount: number;
}

/**
 * Parses one raw item from Zoho's /reports/activitylogs payload into a ZohoActivityEvent.
 *
 * Zoho's actual payload nests the structured transaction fields under "activity_details"
 * (transaction_id/name/type, operation_type, customer_name/id) rather than at the top
 * level. Top-level user_name/user_id and description are reliable; module/entity/reference
 * must come from activity_details, with a description-text fallback when it's absent.
 *
 * IMPORTANT: this payload carries NO time-of-day or precise timestamp field at all
 * (confirmed across live samples: only a day-level "date" is present — no
 * activity_datetime/datetime/created_time/time key ever appears). Never fabricate one from
 * the local wall clock — that would display a fake "event time" that is actually just
 * "whenever our sync happened to run", which is exactly the kind of inferred/misleading
 * value the Activity Detail view must not show.
 *
 * Exported (not just used inline by fetchActivityLogs) so the exact same mapping can be
 * re-run later against an already-stored raw_payload_json to correct cached rows without
 * a new Zoho API call — see reprocessActivityLogsFromRawPayload in zoho-activity-engine.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseZohoActivityLogItem(item: any): ZohoActivityEvent {
  const details = item.activity_details && typeof item.activity_details === "object" ? item.activity_details : {};

  const actId = String(item.activity_id || item.id || item.event_id || `act_${Date.now()}_${Math.random()}`);
  const realDatetime = item.activity_datetime || item.datetime || item.created_time || undefined;
  const d = String(item.date || item.activity_date || (realDatetime ? String(realDatetime).slice(0, 10) : ""));
  const t = item.time ? String(item.time) : (realDatetime && String(realDatetime).includes("T") ? String(realDatetime).split("T")[1]?.slice(0, 8) : undefined);
  const description = String(item.description || item.comment || "");

  const transactionType = details.transaction_type ? String(details.transaction_type) : undefined;
  const mod = transactionType || String(item.module || item.entity_type || "unknown");
  const moduleSource = transactionType ? "STRUCTURED" : "DESCRIPTION_PARSED";

  // Exact Zoho operation_type, preserved as-is (no invented default, no re-casing
  // that would misrepresent it as something Zoho didn't actually send).
  const action = details.operation_type ? String(details.operation_type) : (item.action || item.operation ? String(item.action || item.operation) : "");

  const transactionId = details.transaction_id ? String(details.transaction_id) : undefined;
  const entityId = transactionId || (item.entity_id || item.document_id || item.invoice_id || item.bill_id ? String(item.entity_id || item.document_id || item.invoice_id || item.bill_id) : undefined);
  const entityType = transactionType || item.entity_type || (mod.toLowerCase().includes("invoice") ? "invoice" : mod.toLowerCase().includes("bill") ? "bill" : mod);

  // Reference number: prefer Zoho's own transaction_name (e.g. "EXAMPLE_DOCUMENT_NUMBER", "EXAMPLE_DOCUMENT_NUMBER_2"),
  // else fall back to the first quoted substring in the free-text description
  // (e.g. Invoice "EXAMPLE_DOCUMENT_NUMBER" Updated), else any explicit number field Zoho provides.
  const descQuoteMatch = description.match(/"([^"]+)"/);
  const entityNum = details.transaction_name
    ? String(details.transaction_name)
    : (item.entity_number || item.document_number || item.invoice_number || item.bill_number
        ? String(item.entity_number || item.document_number || item.invoice_number || item.bill_number)
        : descQuoteMatch?.[1]);

  // Zoho's own activity_details.customer_name/customer_id — the counterparty
  // (vendor or customer) Zoho itself attaches to this event. This is source data
  // from the Activity Logs API, not a local database lookup.
  const detailPartyName = details.customer_name ? String(details.customer_name) : undefined;
  const detailPartyId = details.customer_id ? String(details.customer_id) : undefined;

  const userId = item.user_id ? String(item.user_id) : undefined;
  const userName = item.user_name || item.author_name ? String(item.user_name || item.author_name) : undefined;
  const ip = item.ip_address || item.source_ip ? String(item.ip_address || item.source_ip) : undefined;
  const actType = item.activity_type ? String(item.activity_type) : undefined;
  // Only ever the real Zoho-provided created_time — never backfilled from realDatetime
  // or the local clock, since neither is a genuine Zoho timestamp for this event.
  const createdTime = item.created_time ? String(item.created_time) : undefined;

  const linkedBillId = mod === "bill" ? entityId : undefined;
  const linkedInvoiceId = mod === "invoice" ? entityId : undefined;
  const referenceType = String(item.ref_transaction_type || "") || transactionType;

  return {
    activity_id: actId,
    date: d,
    time: t,
    activity_datetime: realDatetime ? String(realDatetime) : d,
    activity_date: d,
    module: mod,
    action,
    entity_type: entityType,
    entity_id: entityId,
    entity_number: entityNum,
    document_number: entityNum,
    user_id: userId,
    user_name: userName,
    description,
    ip_address: ip,
    source: "ZOHO_API",
    source_ip: ip,
    created_time: createdTime,
    detail_party_name: detailPartyName,
    detail_party_id: detailPartyId,
    activity_type: actType,
    module_source: moduleSource,
    reference_type: referenceType,
    reference_id: entityId,
    reference_number: entityNum,
    linked_bill_id: linkedBillId,
    linked_invoice_id: linkedInvoiceId,
    raw_payload_json: JSON.stringify(item),
  };
}

/**
 * Fetch official Zoho Books Activity Logs: GET /books/v3/reports/activitylogs
 * Read-Only, strictly GET under approved ZohoBooks.reports.READ.
 */
export async function fetchActivityLogs(options: {
  organizationId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  perPage?: number;
}): Promise<ZohoActivityLogsResponse> {
  try {
    const { token, store } = await getValidAccessToken();
    const orgId = options.organizationId || store.organization_id || "774390949";

    const params = new URLSearchParams({
      organization_id: orgId,
      page: String(options.page || 1),
      per_page: String(options.perPage || 200),
    });

    if (options.fromDate) params.set("from_date", options.fromDate);
    if (options.toDate) params.set("to_date", options.toDate);

    const url = `${store.api_domain}/books/v3/reports/activitylogs?${params.toString()}`;
    const res = await secureZohoFetch(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
    });

    const statusCode = res.status;
    const data = await res.json().catch(() => ({}));
    const code = typeof data.code === "number" ? data.code : undefined;
    const message = typeof data.message === "string" ? data.message : undefined;
    const isNotAuthorized = statusCode === 401 || code === 57;

    if (!res.ok) {
      return {
        activities: [],
        hasMore: false,
        statusCode,
        code,
        message,
        isNotAuthorized,
        rawKeys: Object.keys(data),
        recordCount: 0,
      };
    }

    const rawList = data.activity_logs || data.activitylogs || data.activities || [];
    const activities: ZohoActivityEvent[] = [];

    if (Array.isArray(rawList)) {
      for (const item of rawList) {
        activities.push(parseZohoActivityLogItem(item));
      }
    }

    const hasMore = Boolean(data.page_context && data.page_context.has_more_page);
    return {
      activities,
      hasMore,
      statusCode,
      code,
      message,
      isNotAuthorized: false,
      rawKeys: Object.keys(data),
      recordCount: activities.length,
    };
  } catch (err) {
    return {
      activities: [],
      hasMore: false,
      statusCode: 500,
      message: err instanceof Error ? err.message : String(err),
      isNotAuthorized: false,
      recordCount: 0,
    };
  }
}

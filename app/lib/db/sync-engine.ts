// ============================================================
// Bansil Books Analytics — Incremental Sync Engine
// GET Only · Local SQLite UPSERT · Zero Duplicate Guarantee
// ============================================================

import {
  getDatabase,
  setSyncMetadata,
  getSyncMetadata,
  recordApiCall,
  recordSyncLog,
  recordSyncCoverage,
  isFullBackfillCompleted,
} from "./database.ts";
import { secureZohoFetch } from "../zoho-security-guard.ts";
import { readTokenStore } from "../zoho-token-store.ts";
import { getValidAccessToken } from "../zoho-api.ts";
import { parseFyToDateRange } from "../date-period-utils.ts";

export interface SyncOptions {
  type: "INITIAL" | "INCREMENTAL" | "MANUAL" | "FULL";
  financialYear?: string;
  fromDate?: string;
  toDate?: string;
  organizationId?: string;
}

export interface SyncResult {
  syncId: string;
  syncType: string;
  status: "SUCCESS" | "PARTIAL" | "OFFLINE" | "FAILED";
  invoicesChecked: number;
  invoicesAdded: number;
  invoicesUpdated: number;
  invoiceLinesSynced: number;
  billsChecked: number;
  billsAdded: number;
  billsUpdated: number;
  billLinesSynced: number;
  unchangedRecords: number;
  exceptionsCount: number;
  apiCalls: number;
  durationMs: number;
  lastSuccessfulSyncTime: string;
  message: string;
}

/**
 * Executes synchronization between Zoho Books (READ-ONLY GET) and SQLite local database.
 * Follows strict UPSERT semantics: INSERT if new, UPDATE LOCAL if modified, SKIP if unchanged.
 */
export async function performSync(options: SyncOptions): Promise<SyncResult> {
  const db = getDatabase();
  const startTime = new Date().toISOString();
  const startTs = Date.now();
  const syncId = `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  let apiCalls = 0;
  let invoicesChecked = 0;
  let invoicesAdded = 0;
  let invoicesUpdated = 0;
  const invoiceLinesSynced = 0;
  let billsChecked = 0;
  let billsAdded = 0;
  let billsUpdated = 0;
  const billLinesSynced = 0;
  let unchangedRecords = 0;
  const exceptionsCount = 0;
  let errors: string | undefined = undefined;
  let status: SyncResult["status"] = "SUCCESS";
  let message = "";

  setSyncMetadata(db, "last_attempted_sync_time", startTime);
  setSyncMetadata(db, "last_sync_status", "IN_PROGRESS");

  // Check connectivity
  const tokenStore = readTokenStore();
  const isOnline = Boolean(tokenStore && tokenStore.access_token);

  if (!isOnline) {
    // Offline mode: database remains active with existing cached records
    const durationMs = Date.now() - startTs;
    const lastSuccess = getSyncMetadata(db, "last_successful_sync_time") || startTime;
    status = "OFFLINE";
    message = "Offline mode active — utilizing cached local database records.";

    recordSyncLog(db, {
      syncId,
      startTime,
      endTime: new Date().toISOString(),
      syncType: options.type,
      invoicesChecked: 0,
      invoicesAdded: 0,
      invoicesUpdated: 0,
      invoiceLinesSynced: 0,
      billsChecked: 0,
      billsAdded: 0,
      billsUpdated: 0,
      billLinesSynced: 0,
      unchangedRecords: 0,
      exceptionsCount: 0,
      apiCalls: 0,
      status: "OFFLINE",
      errors: "Zoho Books credentials not present or offline",
    });

    setSyncMetadata(db, "last_sync_status", "OFFLINE");

    return {
      syncId,
      syncType: options.type,
      status,
      invoicesChecked: 0,
      invoicesAdded: 0,
      invoicesUpdated: 0,
      invoiceLinesSynced: 0,
      billsChecked: 0,
      billsAdded: 0,
      billsUpdated: 0,
      billLinesSynced: 0,
      unchangedRecords: 0,
      exceptionsCount: 0,
      apiCalls: 0,
      durationMs,
      lastSuccessfulSyncTime: lastSuccess,
      message,
    };
  }

  if (options.type === "FULL") {
    const fy = options.financialYear || "FY 2025-26";
    const res = await performFullHistoricalBackfill({
      financialYear: fy,
      fromDate: options.fromDate,
      toDate: options.toDate,
      organizationId: options.organizationId,
    });
    const backfillSuccess = res.status === "SUCCESS";
    const currentLastSuccess = getSyncMetadata(db, "last_successful_sync_time") || new Date().toISOString();
    const effectiveLastSuccess = backfillSuccess ? new Date().toISOString() : currentLastSuccess;
    if (backfillSuccess) {
      setSyncMetadata(db, "last_successful_sync_time", effectiveLastSuccess);
      setSyncMetadata(db, "last_sync_status", "SUCCESS");
    } else {
      setSyncMetadata(db, "last_sync_status", "FAILED");
    }
    return {
      syncId,
      syncType: "FULL",
      status: backfillSuccess ? "SUCCESS" : "FAILED",
      invoicesChecked: res.invoicesFound,
      invoicesAdded: res.invoicesSynced,
      invoicesUpdated: 0,
      invoiceLinesSynced: res.invoiceLinesSynced,
      billsChecked: res.billsFound,
      billsAdded: res.billsSynced,
      billsUpdated: 0,
      billLinesSynced: res.billLinesSynced,
      unchangedRecords: 0,
      exceptionsCount: res.customerDetailsMissingCount,
      apiCalls: res.apiCalls,
      durationMs: res.durationMs,
      lastSuccessfulSyncTime: effectiveLastSuccess,
      message:
        res.status === "SUCCESS"
          ? `Full Historical Backfill for ${fy} complete: ${res.invoicesSynced} invoices, ${res.billsSynced} bills.`
          : `Full Historical Backfill failed: ${res.error || "Unknown error"}`,
    };
  }

  try {
    const { token, store } = await getValidAccessToken();
    const orgId = options.organizationId || store.organization_id || "774390949";
    const lastSync = getSyncMetadata(db, "last_successful_sync_time");
    const isBackfillDone = isFullBackfillCompleted(db, "FY 2025-26");

    // 1. Fetch Invoices from Zoho Books (GET only, Paginated)
    let invoicePage = 1;
    let hasMoreInvoices = true;

    while (hasMoreInvoices) {
      const invParams = new URLSearchParams({
        organization_id: orgId,
        per_page: "200",
        page: String(invoicePage),
      });

      if (options.type === "INCREMENTAL" && lastSync && isBackfillDone) {
        invParams.set("last_modified_time", lastSync);
      } else if (options.fromDate && options.toDate) {
        invParams.set("date_start", options.fromDate);
        invParams.set("date_end", options.toDate);
      } else if (options.financialYear && options.financialYear !== "ALL") {
        const fyRange = parseFyToDateRange(options.financialYear);
        invParams.set("date_start", fyRange.fromDate);
        invParams.set("date_end", fyRange.toDate);
      } else if (!options.financialYear && !options.fromDate) {
        invParams.set("date_start", "2025-04-01");
        invParams.set("date_end", "2026-03-31");
      }

      const invUrl = `${store.api_domain}/books/v3/invoices?${invParams.toString()}`;
      const invRes = await secureZohoFetch(invUrl, {
        method: "GET",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
      });

      apiCalls++;
      recordApiCall(db);

      if (invRes.ok) {
        const invData = await invRes.json();
        if (invData.code === 0 && Array.isArray(invData.invoices)) {
          for (const inv of invData.invoices) {
            invoicesChecked++;
            const existing = db
              .prepare("SELECT last_modified_time FROM sales_invoices WHERE invoice_id = ?")
              .get(inv.invoice_id) as { last_modified_time: string } | undefined;

            let shouldFetchDetail = false;

            if (!existing) {
              // INSERT NEW INVOICE
              db.prepare(`
                INSERT INTO sales_invoices
                (invoice_id, organization_id, invoice_number, date, due_date, customer_id, customer_name, reference_number, status, total, balance, invoice_url, is_verified_link, created_time, last_modified_time, source, synced_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
              `).run(
                inv.invoice_id,
                orgId,
                inv.invoice_number || "",
                inv.date || "",
                inv.due_date || "",
                inv.customer_id || "",
                inv.customer_name || "",
                inv.reference_number || "",
                inv.status || "DRAFT",
                inv.total || 0,
                inv.balance || 0,
                inv.invoice_url || `https://books.bansilengineers.com/app/${orgId}#/invoices/${inv.invoice_id}`,
                1,
                inv.created_time || null,
                inv.last_modified_time || null,
                startTime
              );
              invoicesAdded++;
              shouldFetchDetail = true;
            } else if (inv.last_modified_time && inv.last_modified_time > existing.last_modified_time) {
              // UPDATE LOCAL COPY ONLY
              db.prepare(`
                UPDATE sales_invoices
                SET invoice_number = ?, date = ?, due_date = ?, customer_id = ?, customer_name = ?,
                    reference_number = ?, status = ?, total = ?, balance = ?,
                    last_modified_time = ?, synced_at = ?
                WHERE invoice_id = ?
              `).run(
                inv.invoice_number || "",
                inv.date || "",
                inv.due_date || "",
                inv.customer_id || "",
                inv.customer_name || "",
                inv.reference_number || "",
                inv.status || "DRAFT",
                inv.total || 0,
                inv.balance || 0,
                inv.last_modified_time || null,
                startTime,
                inv.invoice_id
              );
              invoicesUpdated++;
              shouldFetchDetail = true;
            } else {
              unchangedRecords++;
            }

            // Sync invoice line items if new or updated
            if (shouldFetchDetail) {
              try {
                const detailRes = await secureZohoFetch(
                  `${store.api_domain}/books/v3/invoices/${inv.invoice_id}?organization_id=${orgId}`,
                  {
                    method: "GET",
                    headers: {
                      Authorization: `Zoho-oauthtoken ${token}`,
                      "Content-Type": "application/json",
                    },
                  }
                );
                apiCalls++;
                recordApiCall(db);

                if (detailRes.ok) {
                  const detailData = await detailRes.json();
                  const fullInv = detailData.invoice;
                  if (fullInv && Array.isArray(fullInv.line_items)) {
                    db.prepare("DELETE FROM sales_invoice_line_items WHERE invoice_id = ?").run(inv.invoice_id);
                    for (const line of fullInv.line_items) {
                      db.prepare(`
                        INSERT OR REPLACE INTO sales_invoice_line_items
                        (line_item_id, invoice_id, item_id, item_name, sku, quantity, rate, line_total, bbt_customer_id, bbt_customer_name, description, source, synced_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
                      `).run(
                        line.line_item_id,
                        inv.invoice_id,
                        line.item_id,
                        line.name || "",
                        line.sku || "",
                        line.quantity || 0,
                        line.rate || 0,
                        line.item_total || (line.quantity * line.rate) || 0,
                        fullInv.customer_id || "",
                        fullInv.customer_name || "",
                        line.description || "",
                        startTime
                      );
                    }
                  }
                }
              } catch {
                // If detail fetch fails, keep existing invoice header
              }
            }
          }

          hasMoreInvoices = Boolean(invData.page_context && invData.page_context.has_more_page);
          invoicePage++;
        } else {
          hasMoreInvoices = false;
        }
      } else {
        hasMoreInvoices = false;
      }
    }

    // 2. Fetch Bills from Zoho Books (GET only, Paginated)
    let billPage = 1;
    let hasMoreBills = true;

    while (hasMoreBills) {
      const billParams = new URLSearchParams({
        organization_id: orgId,
        per_page: "200",
        page: String(billPage),
      });

      if (options.type === "INCREMENTAL" && lastSync && isBackfillDone) {
        billParams.set("last_modified_time", lastSync);
      } else if (options.fromDate && options.toDate) {
        billParams.set("date_start", options.fromDate);
        billParams.set("date_end", options.toDate);
      } else if (options.financialYear && options.financialYear !== "ALL") {
        const fyRange = parseFyToDateRange(options.financialYear);
        billParams.set("date_start", fyRange.fromDate);
        billParams.set("date_end", fyRange.toDate);
      } else if (!options.financialYear && !options.fromDate) {
        billParams.set("date_start", "2025-04-01");
        billParams.set("date_end", "2026-03-31");
      }

      const billUrl = `${store.api_domain}/books/v3/bills?${billParams.toString()}`;
      const billRes = await secureZohoFetch(billUrl, {
        method: "GET",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
      });

      apiCalls++;
      recordApiCall(db);

      if (billRes.ok) {
        const billData = await billRes.json();
        if (billData.code === 0 && Array.isArray(billData.bills)) {
          for (const b of billData.bills) {
            billsChecked++;
            const existing = db
              .prepare("SELECT last_modified_time FROM purchase_bills WHERE bill_id = ?")
              .get(b.bill_id) as { last_modified_time: string } | undefined;

            let shouldFetchDetail = false;

            if (!existing) {
              // INSERT NEW BILL
              db.prepare(`
                INSERT INTO purchase_bills
                (bill_id, organization_id, bill_number, date, due_date, vendor_id, vendor_name, reference_number, status, total, balance, bill_url, is_verified_link, created_time, last_modified_time, source, synced_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
              `).run(
                b.bill_id,
                orgId,
                b.bill_number || "",
                b.date || "",
                b.due_date || "",
                b.vendor_id || "",
                b.vendor_name || "",
                b.reference_number || "",
                b.status || "DRAFT",
                b.total || 0,
                b.balance || 0,
                b.bill_url || `https://books.bansilengineers.com/app/${orgId}#/bills/${b.bill_id}`,
                1,
                b.created_time || null,
                b.last_modified_time || null,
                startTime
              );
              billsAdded++;
              shouldFetchDetail = true;
            } else if (b.last_modified_time && b.last_modified_time > existing.last_modified_time) {
              // UPDATE LOCAL COPY ONLY
              db.prepare(`
                UPDATE purchase_bills
                SET bill_number = ?, date = ?, due_date = ?, vendor_id = ?, vendor_name = ?,
                    reference_number = ?, status = ?, total = ?, balance = ?,
                    last_modified_time = ?, synced_at = ?
                WHERE bill_id = ?
              `).run(
                b.bill_number || "",
                b.date || "",
                b.due_date || "",
                b.vendor_id || "",
                b.vendor_name || "",
                b.reference_number || "",
                b.status || "DRAFT",
                b.total || 0,
                b.balance || 0,
                b.last_modified_time || null,
                startTime,
                b.bill_id
              );
              billsUpdated++;
              shouldFetchDetail = true;
            } else {
              unchangedRecords++;
            }

            // Sync bill line items if new or updated
            if (shouldFetchDetail) {
              try {
                const detailRes = await secureZohoFetch(
                  `${store.api_domain}/books/v3/bills/${b.bill_id}?organization_id=${orgId}`,
                  {
                    method: "GET",
                    headers: {
                      Authorization: `Zoho-oauthtoken ${token}`,
                      "Content-Type": "application/json",
                    },
                  }
                );
                apiCalls++;
                recordApiCall(db);

                if (detailRes.ok) {
                  const detailData = await detailRes.json();
                  const fullBill = detailData.bill;
                  if (fullBill && Array.isArray(fullBill.line_items)) {
                    db.prepare("DELETE FROM purchase_bill_line_items WHERE bill_id = ?").run(b.bill_id);
                    for (const line of fullBill.line_items) {
                      const custId = line.customer_id || "";
                      const custName = line.customer_name || line.bbt_customer_name || "";
                      const status = custName ? "VERIFIED" : "CUSTOMER DETAILS MISSING";

                      db.prepare(`
                        INSERT OR REPLACE INTO purchase_bill_line_items
                        (line_item_id, bill_id, item_id, item_name, sku, quantity, rate, line_total, bbt_customer_id, bbt_customer_name, purchase_line_customer_id, purchase_line_customer_name, description, customer_data_status, source, synced_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
                      `).run(
                        line.line_item_id,
                        b.bill_id,
                        line.item_id,
                        line.name || "",
                        line.sku || "",
                        line.quantity || 0,
                        line.rate || 0,
                        line.item_total || (line.quantity * line.rate) || 0,
                        custId,
                        custName,
                        custId,
                        custName,
                        line.description || "",
                        status,
                        startTime
                      );
                    }
                  }
                }
              } catch {
                // If detail fetch fails, keep existing bill header
              }
            }
          }

          hasMoreBills = Boolean(billData.page_context && billData.page_context.has_more_page);
          billPage++;
        } else {
          hasMoreBills = false;
        }
      } else {
        hasMoreBills = false;
      }
    }

    message = `Sync completed: ${invoicesAdded + billsAdded} added, ${invoicesUpdated + billsUpdated} updated, ${unchangedRecords} unchanged.`;
  } catch (err: unknown) {
    const recordsProcessed = invoicesChecked + billsChecked + invoicesAdded + billsAdded;
    status = recordsProcessed > 0 ? "PARTIAL" : "FAILED";
    errors = err instanceof Error ? err.message : "Sync error";
    message =
      status === "PARTIAL"
        ? `Sync completed with notice (PARTIAL): ${errors}. Cached local records retained.`
        : `Sync failed: ${errors}. Previous local cache retained.`;
  }

  const endTime = new Date().toISOString();
  const durationMs = Date.now() - startTs;

  let effectiveLastSuccess = getSyncMetadata(db, "last_successful_sync_time") || endTime;
  if (status === "SUCCESS" || status === "PARTIAL") {
    effectiveLastSuccess = endTime;
    setSyncMetadata(db, "last_successful_sync_time", endTime);
  }
  setSyncMetadata(db, "last_sync_status", status);

  recordSyncLog(db, {
    syncId,
    startTime,
    endTime,
    syncType: options.type,
    invoicesChecked,
    invoicesAdded,
    invoicesUpdated,
    invoiceLinesSynced,
    billsChecked,
    billsAdded,
    billsUpdated,
    billLinesSynced,
    unchangedRecords,
    exceptionsCount,
    apiCalls,
    status,
    errors,
  });

  return {
    syncId,
    syncType: options.type,
    status,
    invoicesChecked,
    invoicesAdded,
    invoicesUpdated,
    invoiceLinesSynced,
    billsChecked,
    billsAdded,
    billsUpdated,
    billLinesSynced,
    unchangedRecords,
    exceptionsCount,
    apiCalls,
    durationMs,
    lastSuccessfulSyncTime: effectiveLastSuccess,
    message,
  };
}

export interface BackfillProgress {
  phase:
    | "START"
    | "INVOICES_LIST"
    | "INVOICES_FOUND"
    | "INVOICE_DETAILS"
    | "BILLS_LIST"
    | "BILLS_FOUND"
    | "BILL_DETAILS"
    | "SAVING"
    | "INDEXING"
    | "COMPLETE"
    | "ERROR";
  current?: number;
  total?: number;
  message: string;
  data?: Record<string, unknown>;
}

export interface BackfillOptions {
  financialYear: string;
  fromDate?: string;
  toDate?: string;
  organizationId?: string;
  concurrency?: number;
  onProgress?: (progress: BackfillProgress) => void;
}

export interface BackfillResult {
  financialYear: string;
  fromDate: string;
  toDate: string;
  fullBackfillCompleted: boolean;
  totalSalesInvoices: number;
  totalPurchaseBills: number;
  invoiceListPages: number;
  invoicesFound: number;
  invoicesSynced: number;
  invoiceLinesSynced: number;
  billListPages: number;
  billsFound: number;
  billsSynced: number;
  billLinesSynced: number;
  distinctSalesCustomers: number;
  distinctSalesItems: number;
  distinctVendors: number;
  distinctPurchaseCustomers: number;
  distinctPurchaseItems: number;
  customerDetailsMissingCount: number;
  customerDropdownCount: number;
  itemDropdownCount: number;
  apiCalls: number;
  durationMs: number;
  status: "SUCCESS" | "FAILED";
  error?: string;
}

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 3): Promise<Response> {
  let attempts = 0;
  while (attempts < maxRetries) {
    attempts++;
    const res = await secureZohoFetch(url, init);
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "3", 10);
      console.warn(`[ZohoAPI] 429 Rate limited. Pausing for ${retryAfter}s (attempt ${attempts}/${maxRetries})...`);
      await new Promise((r) => setTimeout(r, Math.max(retryAfter * 1000, 2500)));
      continue;
    }
    return res;
  }
  return await secureZohoFetch(url, init);
}

/**
 * Performs a FULL HISTORICAL BACKFILL for a designated Financial Year.
 * Retrieves all paginated Invoice and Bill headers, then fetches full line item details.
 * Strictly READ-ONLY GET requests to Zoho Books. Saves and indexes locally in SQLite via UPSERT.
 */
export async function performFullHistoricalBackfill(
  options: BackfillOptions
): Promise<BackfillResult> {
  const db = getDatabase();
  const startTs = Date.now();
  const startTime = new Date().toISOString();
  let apiCalls = 0;

  const fy = options.financialYear.toUpperCase().includes("2025-26") ? "FY 2025-26" : options.financialYear;
  const fromDate = options.fromDate || "2025-04-01";
  const toDate = options.toDate || "2026-03-31";
  const concurrency = options.concurrency || 5;

  options.onProgress?.({
    phase: "START",
    message: `Starting Full Historical Backfill for ${fy} (${fromDate} to ${toDate})...`,
  });

  const { token, store } = await getValidAccessToken();
  const orgId = options.organizationId || store.organization_id || "774390949";

  // Initialize coverage record as IN_PROGRESS
  recordSyncCoverage(db, {
    financialYear: fy,
    fromDate,
    toDate,
    fullBackfillCompleted: false,
    invoiceListPages: 0,
    invoicesFound: 0,
    invoicesSynced: 0,
    billListPages: 0,
    billsFound: 0,
    billsSynced: 0,
    startedAt: startTime,
    status: "IN_PROGRESS",
  });

  try {
    // -------------------------------------------------------------
    // PHASE 1: Fetch Invoice List Pages
    // -------------------------------------------------------------
    options.onProgress?.({
      phase: "INVOICES_LIST",
      message: "Fetching Invoice List from Zoho Books...",
    });

    let invoicePage = 1;
    let hasMoreInvoices = true;
    const allInvoices: Array<{
      invoice_id: string;
      invoice_number: string;
      date: string;
      due_date: string;
      customer_id: string;
      customer_name: string;
      reference_number: string;
      status: string;
      total: number;
      balance: number;
      invoice_url?: string;
      created_time?: string;
      last_modified_time?: string;
    }> = [];

    while (hasMoreInvoices) {
      const invParams = new URLSearchParams({
        organization_id: orgId,
        date_start: fromDate,
        date_end: toDate,
        per_page: "200",
        page: String(invoicePage),
      });

      const invUrl = `${store.api_domain}/books/v3/invoices?${invParams.toString()}`;
      const invRes = await fetchWithRetry(invUrl, {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
      });
      apiCalls++;
      recordApiCall(db);

      if (!invRes.ok) {
        throw new Error(`Failed to fetch invoice list page ${invoicePage}: HTTP ${invRes.status}`);
      }

      const invData = await invRes.json();
      if (invData.code !== 0) {
        throw new Error(`Zoho error fetching invoice list page ${invoicePage}: ${invData.message}`);
      }

      const invoices = (invData.invoices || []) as typeof allInvoices;
      allInvoices.push(...invoices);

      hasMoreInvoices = invData.page_context?.has_more_page === true;
      invoicePage++;
    }

    const invoiceListPages = invoicePage - 1;
    options.onProgress?.({
      phase: "INVOICES_FOUND",
      total: allInvoices.length,
      message: `Invoices Found: ${allInvoices.length} across ${invoiceListPages} pages`,
    });

    // -------------------------------------------------------------
    // PHASE 2: Fetch Invoice Details & UPSERT into SQLite
    // -------------------------------------------------------------
    const activeInvoices = allInvoices.filter((inv) => inv.status.toLowerCase() !== "void");

    for (let i = 0; i < activeInvoices.length; i += concurrency) {
      const chunk = activeInvoices.slice(i, i + concurrency);
      await Promise.all(
        chunk.map(async (inv, idxInChunk) => {
          const currentIndex = i + idxInChunk + 1;
          // Check if already in DB with identical last_modified_time and line items
          const existingLineCount = (
            db
              .prepare("SELECT COUNT(*) as count FROM sales_invoice_line_items WHERE invoice_id = ?")
              .get(inv.invoice_id) as { count: number }
          ).count;
          const existingInv = db
            .prepare("SELECT last_modified_time FROM sales_invoices WHERE invoice_id = ?")
            .get(inv.invoice_id) as { last_modified_time?: string } | undefined;

          // Always UPSERT invoice header
          db.prepare(`
            INSERT INTO sales_invoices
            (invoice_id, organization_id, invoice_number, date, due_date, customer_id, customer_name, reference_number, status, total, balance, invoice_url, is_verified_link, created_time, last_modified_time, source, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'ZOHO_BOOKS', ?)
            ON CONFLICT(invoice_id) DO UPDATE SET
              invoice_number = excluded.invoice_number,
              date = excluded.date,
              due_date = excluded.due_date,
              customer_id = excluded.customer_id,
              customer_name = excluded.customer_name,
              reference_number = excluded.reference_number,
              status = excluded.status,
              total = excluded.total,
              balance = excluded.balance,
              invoice_url = excluded.invoice_url,
              last_modified_time = excluded.last_modified_time,
              synced_at = excluded.synced_at
          `).run(
            inv.invoice_id,
            orgId,
            inv.invoice_number || "",
            inv.date || "",
            inv.due_date || "",
            inv.customer_id || "",
            inv.customer_name || "",
            inv.reference_number || "",
            inv.status || "DRAFT",
            inv.total || 0,
            inv.balance || 0,
            inv.invoice_url || `https://books.bansilengineers.com/app/${orgId}#/invoices/${inv.invoice_id}`,
            inv.created_time || null,
            inv.last_modified_time || null,
            startTime
          );

          // If line items already synced and modified time matches, skip detail GET (resumable)
          if (
            existingInv &&
            existingLineCount > 0 &&
            inv.last_modified_time &&
            existingInv.last_modified_time === inv.last_modified_time
          ) {
            return;
          }

          // Fetch Invoice Detail
          try {
            const detailRes = await fetchWithRetry(
              `${store.api_domain}/books/v3/invoices/${inv.invoice_id}?organization_id=${orgId}`,
              {
                headers: {
                  Authorization: `Zoho-oauthtoken ${token}`,
                  "Content-Type": "application/json",
                },
              }
            );
            apiCalls++;
            recordApiCall(db);

            if (detailRes.ok) {
              const detailData = await detailRes.json();
              const fullInv = detailData.invoice;
              if (fullInv && Array.isArray(fullInv.line_items)) {
                db.prepare("DELETE FROM sales_invoice_line_items WHERE invoice_id = ?").run(inv.invoice_id);
                for (const line of fullInv.line_items) {
                  db.prepare(`
                    INSERT OR REPLACE INTO sales_invoice_line_items
                    (line_item_id, invoice_id, item_id, item_name, sku, quantity, rate, line_total, bbt_customer_id, bbt_customer_name, description, source, synced_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
                  `).run(
                    line.line_item_id,
                    inv.invoice_id,
                    line.item_id,
                    line.name || "",
                    line.sku || "",
                    line.quantity || 0,
                    line.rate || 0,
                    line.item_total || (line.quantity * line.rate) || 0,
                    fullInv.customer_id || "",
                    fullInv.customer_name || "",
                    line.description || "",
                    startTime
                  );
                }
              }
            }
          } catch (detailErr) {
            console.warn(`[ZohoAPI] Detail fetch failed for invoice ${inv.invoice_number}:`, detailErr);
          }

          if (currentIndex % 25 === 0 || currentIndex === activeInvoices.length) {
            options.onProgress?.({
              phase: "INVOICE_DETAILS",
              current: currentIndex,
              total: activeInvoices.length,
              message: `Fetching Invoice Details: ${currentIndex} / ${activeInvoices.length}`,
            });
          }
        })
      );
      // Small pause between chunks to respect Zoho rate limits
      await new Promise((r) => setTimeout(r, 60));
    }

    // Also store any void invoices (no line items needed)
    for (const voidInv of allInvoices.filter((inv) => inv.status.toLowerCase() === "void")) {
      db.prepare(`
        INSERT INTO sales_invoices
        (invoice_id, organization_id, invoice_number, date, due_date, customer_id, customer_name, reference_number, status, total, balance, invoice_url, is_verified_link, created_time, last_modified_time, source, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'ZOHO_BOOKS', ?)
        ON CONFLICT(invoice_id) DO UPDATE SET status = 'VOID', synced_at = excluded.synced_at
      `).run(
        voidInv.invoice_id,
        orgId,
        voidInv.invoice_number || "",
        voidInv.date || "",
        voidInv.due_date || "",
        voidInv.customer_id || "",
        voidInv.customer_name || "",
        voidInv.reference_number || "",
        "VOID",
        voidInv.total || 0,
        voidInv.balance || 0,
        voidInv.invoice_url || `https://books.bansilengineers.com/app/${orgId}#/invoices/${voidInv.invoice_id}`,
        voidInv.created_time || null,
        voidInv.last_modified_time || null,
        startTime
      );
    }

    // -------------------------------------------------------------
    // PHASE 3: Fetch Bill List Pages
    // -------------------------------------------------------------
    options.onProgress?.({
      phase: "BILLS_LIST",
      message: "Fetching Bill List from Zoho Books...",
    });

    let billPage = 1;
    let hasMoreBills = true;
    const allBills: Array<{
      bill_id: string;
      bill_number: string;
      date: string;
      due_date: string;
      vendor_id: string;
      vendor_name: string;
      reference_number: string;
      status: string;
      total: number;
      balance: number;
      bill_url?: string;
      created_time?: string;
      last_modified_time?: string;
    }> = [];

    while (hasMoreBills) {
      const billParams = new URLSearchParams({
        organization_id: orgId,
        date_start: fromDate,
        date_end: toDate,
        per_page: "200",
        page: String(billPage),
      });

      const billUrl = `${store.api_domain}/books/v3/bills?${billParams.toString()}`;
      const billRes = await fetchWithRetry(billUrl, {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
      });
      apiCalls++;
      recordApiCall(db);

      if (!billRes.ok) {
        throw new Error(`Failed to fetch bill list page ${billPage}: HTTP ${billRes.status}`);
      }

      const billData = await billRes.json();
      if (billData.code !== 0) {
        throw new Error(`Zoho error fetching bill list page ${billPage}: ${billData.message}`);
      }

      const bills = (billData.bills || []) as typeof allBills;
      allBills.push(...bills);

      hasMoreBills = billData.page_context?.has_more_page === true;
      billPage++;
    }

    const billListPages = billPage - 1;
    options.onProgress?.({
      phase: "BILLS_FOUND",
      total: allBills.length,
      message: `Bills Found: ${allBills.length} across ${billListPages} pages`,
    });

    // -------------------------------------------------------------
    // PHASE 4: Fetch Bill Details & UPSERT into SQLite
    // -------------------------------------------------------------
    const activeBills = allBills.filter((b) => b.status.toLowerCase() !== "void");

    for (let i = 0; i < activeBills.length; i += concurrency) {
      const chunk = activeBills.slice(i, i + concurrency);
      await Promise.all(
        chunk.map(async (b, idxInChunk) => {
          const currentIndex = i + idxInChunk + 1;
          const existingLineCount = (
            db
              .prepare("SELECT COUNT(*) as count FROM purchase_bill_line_items WHERE bill_id = ?")
              .get(b.bill_id) as { count: number }
          ).count;
          const existingBill = db
            .prepare("SELECT last_modified_time FROM purchase_bills WHERE bill_id = ?")
            .get(b.bill_id) as { last_modified_time?: string } | undefined;

          // Always UPSERT bill header
          db.prepare(`
            INSERT INTO purchase_bills
            (bill_id, organization_id, bill_number, date, due_date, vendor_id, vendor_name, reference_number, status, total, balance, bill_url, is_verified_link, created_time, last_modified_time, source, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'ZOHO_BOOKS', ?)
            ON CONFLICT(bill_id) DO UPDATE SET
              bill_number = excluded.bill_number,
              date = excluded.date,
              due_date = excluded.due_date,
              vendor_id = excluded.vendor_id,
              vendor_name = excluded.vendor_name,
              reference_number = excluded.reference_number,
              status = excluded.status,
              total = excluded.total,
              balance = excluded.balance,
              bill_url = excluded.bill_url,
              last_modified_time = excluded.last_modified_time,
              synced_at = excluded.synced_at
          `).run(
            b.bill_id,
            orgId,
            b.bill_number || "",
            b.date || "",
            b.due_date || "",
            b.vendor_id || "",
            b.vendor_name || "",
            b.reference_number || "",
            b.status || "DRAFT",
            b.total || 0,
            b.balance || 0,
            b.bill_url || `https://books.bansilengineers.com/app/${orgId}#/bills/${b.bill_id}`,
            b.created_time || null,
            b.last_modified_time || null,
            startTime
          );

          // If line items already synced and modified time matches, skip detail GET (resumable)
          if (
            existingBill &&
            existingLineCount > 0 &&
            b.last_modified_time &&
            existingBill.last_modified_time === b.last_modified_time
          ) {
            return;
          }

          // Fetch Bill Detail
          try {
            const detailRes = await fetchWithRetry(
              `${store.api_domain}/books/v3/bills/${b.bill_id}?organization_id=${orgId}`,
              {
                headers: {
                  Authorization: `Zoho-oauthtoken ${token}`,
                  "Content-Type": "application/json",
                },
              }
            );
            apiCalls++;
            recordApiCall(db);

            if (detailRes.ok) {
              const detailData = await detailRes.json();
              const fullBill = detailData.bill;
              if (fullBill && Array.isArray(fullBill.line_items)) {
                db.prepare("DELETE FROM purchase_bill_line_items WHERE bill_id = ?").run(b.bill_id);
                for (const line of fullBill.line_items) {
                  const custId = line.customer_id || "";
                  const rawCustName = line.customer_name || line.bbt_customer_name || "";
                  const custName = typeof rawCustName === "string" ? rawCustName.trim() : "";
                  const isMissing = !custName || custName === "CUSTOMER DETAILS MISSING";
                  const customerDataStatus = isMissing ? "CUSTOMER DETAILS MISSING" : "VERIFIED";

                  db.prepare(`
                    INSERT OR REPLACE INTO purchase_bill_line_items
                    (line_item_id, bill_id, item_id, item_name, sku, quantity, rate, line_total, bbt_customer_id, bbt_customer_name, purchase_line_customer_id, purchase_line_customer_name, description, customer_data_status, source, synced_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
                  `).run(
                    line.line_item_id,
                    b.bill_id,
                    line.item_id,
                    line.name || "",
                    line.sku || "",
                    line.quantity || 0,
                    line.rate || 0,
                    line.item_total || (line.quantity * line.rate) || 0,
                    custId,
                    custName || "CUSTOMER DETAILS MISSING",
                    custId,
                    custName || "CUSTOMER DETAILS MISSING",
                    line.description || "",
                    customerDataStatus,
                    startTime
                  );
                }
              }
            }
          } catch (detailErr) {
            console.warn(`[ZohoAPI] Detail fetch failed for bill ${b.bill_number}:`, detailErr);
          }

          if (currentIndex % 50 === 0 || currentIndex === activeBills.length) {
            options.onProgress?.({
              phase: "BILL_DETAILS",
              current: currentIndex,
              total: activeBills.length,
              message: `Fetching Bill Details: ${currentIndex} / ${activeBills.length}`,
            });
          }
        })
      );
      await new Promise((r) => setTimeout(r, 60));
    }

    // -------------------------------------------------------------
    // PHASE 5: Save Metadata & Build Indexes
    // -------------------------------------------------------------
    options.onProgress?.({
      phase: "SAVING",
      message: "Saving Local SQLite... Building Reconciliation Index...",
    });

    const endTime = new Date().toISOString();
    const durationMs = Date.now() - startTs;

    // Record complete sync coverage
    recordSyncCoverage(db, {
      financialYear: fy,
      fromDate,
      toDate,
      fullBackfillCompleted: true,
      invoiceListPages,
      invoicesFound: allInvoices.length,
      invoicesSynced: activeInvoices.length,
      billListPages,
      billsFound: allBills.length,
      billsSynced: activeBills.length,
      startedAt: startTime,
      completedAt: endTime,
      status: "COMPLETED",
    });

    setSyncMetadata(db, "last_successful_sync_time", endTime);
    setSyncMetadata(db, "last_sync_status", "SUCCESS");

    // -------------------------------------------------------------
    // PHASE 6: Calculate Data Completeness Metrics
    // -------------------------------------------------------------
    const salesInvCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM sales_invoices WHERE date >= ? AND date <= ? AND status != 'VOID'").get(fromDate, toDate) as { cnt: number }
    ).cnt;

    const salesLinesCount = (
      db.prepare(`
        SELECT COUNT(*) as cnt FROM sales_invoice_line_items sli
        JOIN sales_invoices si ON sli.invoice_id = si.invoice_id
        WHERE si.date >= ? AND si.date <= ? AND si.status != 'VOID'
      `).get(fromDate, toDate) as { cnt: number }
    ).cnt;

    const distinctSalesCustomers = (
      db.prepare(`
        SELECT COUNT(DISTINCT si.customer_name) as cnt FROM sales_invoices si
        WHERE si.date >= ? AND si.date <= ? AND si.status != 'VOID' AND si.customer_name IS NOT NULL AND TRIM(si.customer_name) != ''
      `).get(fromDate, toDate) as { cnt: number }
    ).cnt;

    const distinctSalesItems = (
      db.prepare(`
        SELECT COUNT(DISTINCT sli.item_name) as cnt FROM sales_invoice_line_items sli
        JOIN sales_invoices si ON sli.invoice_id = si.invoice_id
        WHERE si.date >= ? AND si.date <= ? AND si.status != 'VOID' AND sli.item_name IS NOT NULL AND TRIM(sli.item_name) != ''
      `).get(fromDate, toDate) as { cnt: number }
    ).cnt;

    const purchaseBillsCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM purchase_bills WHERE date >= ? AND date <= ? AND status != 'VOID'").get(fromDate, toDate) as { cnt: number }
    ).cnt;

    const purchaseLinesCount = (
      db.prepare(`
        SELECT COUNT(*) as cnt FROM purchase_bill_line_items pli
        JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
        WHERE pb.date >= ? AND pb.date <= ? AND pb.status != 'VOID'
      `).get(fromDate, toDate) as { cnt: number }
    ).cnt;

    const distinctVendors = (
      db.prepare(`
        SELECT COUNT(DISTINCT pb.vendor_name) as cnt FROM purchase_bills pb
        WHERE pb.date >= ? AND pb.date <= ? AND pb.status != 'VOID' AND pb.vendor_name IS NOT NULL AND TRIM(pb.vendor_name) != ''
      `).get(fromDate, toDate) as { cnt: number }
    ).cnt;

    const distinctPurchaseCustomers = (
      db.prepare(`
        SELECT COUNT(DISTINCT pli.bbt_customer_name) as cnt FROM purchase_bill_line_items pli
        JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
        WHERE pb.date >= ? AND pb.date <= ? AND pb.status != 'VOID'
          AND pli.bbt_customer_name IS NOT NULL AND TRIM(pli.bbt_customer_name) != ''
          AND pli.customer_data_status != 'CUSTOMER DETAILS MISSING'
      `).get(fromDate, toDate) as { cnt: number }
    ).cnt;

    const distinctPurchaseItems = (
      db.prepare(`
        SELECT COUNT(DISTINCT pli.item_name) as cnt FROM purchase_bill_line_items pli
        JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
        WHERE pb.date >= ? AND pb.date <= ? AND pb.status != 'VOID' AND pli.item_name IS NOT NULL AND TRIM(pli.item_name) != ''
      `).get(fromDate, toDate) as { cnt: number }
    ).cnt;

    const missingCustomerCount = (
      db.prepare(`
        SELECT COUNT(*) as cnt FROM purchase_bill_line_items pli
        JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
        WHERE pb.date >= ? AND pb.date <= ? AND pb.status != 'VOID'
          AND pli.customer_data_status = 'CUSTOMER DETAILS MISSING'
      `).get(fromDate, toDate) as { cnt: number }
    ).cnt;

    const customerDropdownCount = (
      db.prepare(`
        SELECT COUNT(DISTINCT customer_name) as cnt FROM (
          SELECT si.customer_name FROM sales_invoices si WHERE si.date >= ? AND si.date <= ? AND si.status != 'VOID' AND si.customer_name IS NOT NULL AND TRIM(si.customer_name) != ''
          UNION
          SELECT pli.bbt_customer_name FROM purchase_bill_line_items pli JOIN purchase_bills pb ON pli.bill_id = pb.bill_id WHERE pb.date >= ? AND pb.date <= ? AND pb.status != 'VOID' AND pli.customer_data_status != 'CUSTOMER DETAILS MISSING' AND pli.bbt_customer_name IS NOT NULL AND TRIM(pli.bbt_customer_name) != ''
        )
      `).get(fromDate, toDate, fromDate, toDate) as { cnt: number }
    ).cnt;

    const itemDropdownCount = (
      db.prepare(`
        SELECT COUNT(DISTINCT item_name) as cnt FROM (
          SELECT sli.item_name FROM sales_invoice_line_items sli JOIN sales_invoices si ON sli.invoice_id = si.invoice_id WHERE si.date >= ? AND si.date <= ? AND si.status != 'VOID'
          UNION
          SELECT pli.item_name FROM purchase_bill_line_items pli JOIN purchase_bills pb ON pli.bill_id = pb.bill_id WHERE pb.date >= ? AND pb.date <= ? AND pb.status != 'VOID'
        )
      `).get(fromDate, toDate, fromDate, toDate) as { cnt: number }
    ).cnt;

    const result: BackfillResult = {
      financialYear: fy,
      fromDate,
      toDate,
      fullBackfillCompleted: true,
      totalSalesInvoices: salesInvCount,
      totalPurchaseBills: purchaseBillsCount,
      invoiceListPages,
      invoicesFound: allInvoices.length,
      invoicesSynced: activeInvoices.length,
      invoiceLinesSynced: salesLinesCount,
      billListPages,
      billsFound: allBills.length,
      billsSynced: activeBills.length,
      billLinesSynced: purchaseLinesCount,
      distinctSalesCustomers,
      distinctSalesItems,
      distinctVendors,
      distinctPurchaseCustomers,
      distinctPurchaseItems,
      customerDetailsMissingCount: missingCustomerCount,
      customerDropdownCount,
      itemDropdownCount,
      apiCalls,
      durationMs,
      status: "SUCCESS",
    };

    options.onProgress?.({
      phase: "COMPLETE",
      message: `Full Historical Backfill for ${fy} completed in ${Math.round(durationMs / 1000)}s.`,
      data: result as unknown as Record<string, unknown>,
    });

    return result;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Backfill execution error";
    recordSyncCoverage(db, {
      financialYear: fy,
      fromDate,
      toDate,
      fullBackfillCompleted: false,
      invoiceListPages: 0,
      invoicesFound: 0,
      invoicesSynced: 0,
      billListPages: 0,
      billsFound: 0,
      billsSynced: 0,
      startedAt: startTime,
      status: "FAILED",
      error: errorMsg,
    });

    options.onProgress?.({
      phase: "ERROR",
      message: `BACKFILL INCOMPLETE: ${errorMsg}`,
      data: { error: errorMsg },
    });

    return {
      financialYear: fy,
      fromDate,
      toDate,
      fullBackfillCompleted: false,
      totalSalesInvoices: 0,
      totalPurchaseBills: 0,
      invoiceListPages: 0,
      invoicesFound: 0,
      invoicesSynced: 0,
      invoiceLinesSynced: 0,
      billListPages: 0,
      billsFound: 0,
      billsSynced: 0,
      billLinesSynced: 0,
      distinctSalesCustomers: 0,
      distinctSalesItems: 0,
      distinctVendors: 0,
      distinctPurchaseCustomers: 0,
      distinctPurchaseItems: 0,
      customerDetailsMissingCount: 0,
      customerDropdownCount: 0,
      itemDropdownCount: 0,
      apiCalls,
      durationMs: Date.now() - startTs,
      status: "FAILED",
      error: errorMsg,
    };
  }
}


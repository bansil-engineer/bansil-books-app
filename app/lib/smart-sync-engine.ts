// ============================================================
// Bansil Books Analytics — Smart Selective / Incremental Sync Engine
// Section-Wise · Customer-Wise · Change-Aware · Zero Zoho Mutation (GET Only)
// ============================================================

import crypto from "node:crypto";
import {
  getDatabase,
  setSyncMetadata,
  getSyncMetadata,
  recordApiCall,
  recordSyncLog,
  getSyncState,
  setSyncState,
  acquireSyncLock,
  releaseSyncLock,
  getDocumentSyncFingerprint,
  setDocumentSyncFingerprint,
  getFeatureSettings,
  getActivitySyncCheckpoint,
  setActivitySyncCheckpoint,
  getApiUsageCache,
  setApiUsageCache,
  type ActivitySyncCheckpoint,
  type ApiUsageCacheRecord,
} from "./db/database.ts";
import { secureZohoFetch } from "./zoho-security-guard.ts";
import { readTokenStore } from "./zoho-token-store.ts";
import { getValidAccessToken, fetchApiUsage, fetchActivityLogs, type ZohoActivityEvent, type ZohoApiUsageResult } from "./zoho-api.ts";
import { parseFyToDateRange } from "./date-period-utils.ts";
import { validateCompositeAssemblies } from "./composite-assembly-engine.ts";

export type SmartSyncMode = "SMART" | "SELECTIVE" | "FORCE" | "ACTIVITY_DRIVEN";
export type SmartSyncModule = "sales_invoices" | "purchase_bills" | "customers" | "stock" | "all";

export interface SmartSyncOptions {
  mode: SmartSyncMode;
  modules?: SmartSyncModule[];
  customerId?: string;
  customerName?: string;
  financialYear?: string;
  fromDate?: string;
  toDate?: string;
  organizationId?: string;
  forceDetail?: boolean;
}

export interface ModuleSyncSummary {
  module: string;
  checked: number;
  newCount: number;
  modifiedCount: number;
  unchangedCount: number;
  upserts: number;
  apiCalls: number;
  detailCalls: number;
  status: "SUCCESS" | "SKIPPED" | "FAILED";
  error?: string;
}

export interface SmartSyncResult {
  syncId: string;
  mode: SmartSyncMode;
  status: "SUCCESS" | "PARTIAL" | "OFFLINE" | "FAILED" | "LOCKED";
  message: string;
  modules: ModuleSyncSummary[];
  totalChecked: number;
  totalNew: number;
  totalModified: number;
  totalUnchanged: number;
  totalUpserts: number;
  apiCallsUsed: number;
  durationMs: number;
  customerPurchaseLimitationNote?: string;
  lastSuccessfulSyncAt: string | null;
  syncedThrough: string | null;
  checkpoint?: ActivitySyncCheckpoint | null;
  apiUsage?: ZohoApiUsageResult | null;
}

/**
 * Calculates a SHA-256 fingerprint for document header & basic metadata
 * to detect modifications without needing full detail payload.
 */
export function calculateDocumentFingerprint(doc: Record<string, any>): string {
  const payload = [
    doc.invoice_id || doc.bill_id || "",
    doc.invoice_number || doc.bill_number || "",
    doc.date || "",
    doc.due_date || "",
    doc.customer_id || doc.vendor_id || "",
    String(doc.total ?? 0),
    String(doc.balance ?? 0),
    doc.status || "",
    doc.last_modified_time || "",
  ].join("|");

  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

/**
 * Checks if local data is stale according to configured threshold hours
 */
export function checkSyncStaleness(lastSyncIso?: string | null, thresholdHours: number = 24): {
  isStale: boolean;
  ageHours: number;
  message: string;
} {
  if (!lastSyncIso) {
    return {
      isStale: true,
      ageHours: 9999,
      message: "Data has never been synced or timestamp is missing.",
    };
  }

  const lastSyncTime = new Date(lastSyncIso).getTime();
  if (isNaN(lastSyncTime)) {
    return { isStale: true, ageHours: 9999, message: "Invalid sync timestamp." };
  }

  const diffMs = Date.now() - lastSyncTime;
  const ageHours = Math.max(0, diffMs / (1000 * 60 * 60));
  const isStale = ageHours >= thresholdHours;

  return {
    isStale,
    ageHours: Math.round(ageHours * 10) / 10,
    message: isStale
      ? `Data may be outdated (${Math.round(ageHours)} hours old, threshold is ${thresholdHours}h).`
      : "Data is current.",
  };
}

/**
 * Primary engine for Smart, Selective, and Force Sync.
 * Implements strict GET-only reads from Zoho, skipping unchanged document detail fetches.
 */
export async function performSmartSync(options: SmartSyncOptions): Promise<SmartSyncResult> {
  if (options.mode === "ACTIVITY_DRIVEN") {
    return performActivityDrivenSync(options);
  }

  const db = getDatabase();
  const startTime = new Date().toISOString();
  const startTs = Date.now();
  const syncId = `smart_sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // Determine lock key based on target modules and scope
  const targetModules = options.modules && options.modules.length > 0
    ? options.modules
    : (["sales_invoices", "purchase_bills"] as SmartSyncModule[]);

  const scopeKey = options.customerId
    ? `customer:${options.customerId}`
    : options.financialYear
    ? `fy:${options.financialYear}`
    : "all";

  const lockKey = `lock:${targetModules.join("_")}:${scopeKey}`;

  // Acquire lock to prevent concurrent syncs on same scope
  const lockAcquired = acquireSyncLock(db, lockKey, 120000, "smart_sync");
  if (!lockAcquired) {
    return {
      syncId,
      mode: options.mode,
      status: "LOCKED",
      message: "Sync already in progress for this scope. Please wait for current sync to finish.",
      modules: [],
      totalChecked: 0,
      totalNew: 0,
      totalModified: 0,
      totalUnchanged: 0,
      totalUpserts: 0,
      apiCallsUsed: 0,
      durationMs: 0,
      lastSuccessfulSyncAt: getSyncMetadata(db, "last_successful_sync_time"),
      syncedThrough: null,
    };
  }

  const moduleSummaries: ModuleSyncSummary[] = [];
  let totalApiCalls = 0;
  let hasCustomerPurchaseLimitation = false;

  try {
    setSyncMetadata(db, "last_attempted_sync_time", startTime);
    setSyncMetadata(db, "last_sync_status", "IN_PROGRESS");

    // Check online credentials
    const tokenStore = readTokenStore();
    const isOnline = Boolean(tokenStore && tokenStore.access_token);

    if (!isOnline) {
      releaseSyncLock(db, lockKey);
      return {
        syncId,
        mode: options.mode,
        status: "OFFLINE",
        message: "Offline mode active — utilizing cached local SQLite records.",
        modules: [],
        totalChecked: 0,
        totalNew: 0,
        totalModified: 0,
        totalUnchanged: 0,
        totalUpserts: 0,
        apiCallsUsed: 0,
        durationMs: Date.now() - startTs,
        lastSuccessfulSyncAt: getSyncMetadata(db, "last_successful_sync_time"),
        syncedThrough: null,
      };
    }

    const { token, store } = await getValidAccessToken();
    const orgId = options.organizationId || store.organization_id || "774390949";

    // 1. Determine date filter range
    let dateStart: string | undefined = options.fromDate;
    let dateEnd: string | undefined = options.toDate;

    if (!dateStart && !dateEnd && options.financialYear && options.financialYear !== "ALL") {
      const fyRange = parseFyToDateRange(options.financialYear);
      dateStart = fyRange.fromDate;
      dateEnd = fyRange.toDate;
    }

    // Process Sales Invoices if requested
    if (targetModules.includes("sales_invoices") || targetModules.includes("all")) {
      const invSummary = await syncSalesInvoicesModule({
        db,
        token,
        apiDomain: store.api_domain,
        orgId,
        mode: options.mode,
        scopeKey,
        dateStart,
        dateEnd,
        customerId: options.customerId,
        forceDetail: options.mode === "FORCE" || options.forceDetail,
        startTime,
      });
      moduleSummaries.push(invSummary);
      totalApiCalls += invSummary.apiCalls;
    }

    // Process Purchase Bills if requested
    if (targetModules.includes("purchase_bills") || targetModules.includes("all")) {
      if (options.customerId) {
        hasCustomerPurchaseLimitation = true;
      }
      const billSummary = await syncPurchaseBillsModule({
        db,
        token,
        apiDomain: store.api_domain,
        orgId,
        mode: options.mode,
        scopeKey,
        dateStart,
        dateEnd,
        customerId: options.customerId,
        customerName: options.customerName,
        forceDetail: options.mode === "FORCE" || options.forceDetail,
        startTime,
      });
      moduleSummaries.push(billSummary);
      totalApiCalls += billSummary.apiCalls;
    }

    // Process Stock if requested explicitly (skips if 'all' because 'all' covers invoices & bills)
    if (targetModules.includes("stock") && !targetModules.includes("all")) {
      const stockSummary = await syncStockModule({
        db,
        token,
        apiDomain: store.api_domain,
        orgId,
        mode: options.mode,
        scopeKey,
        dateStart,
        dateEnd,
        customerId: options.customerId,
        forceDetail: options.mode === "FORCE" || options.forceDetail,
        startTime,
      });
      moduleSummaries.push(stockSummary);
      totalApiCalls += stockSummary.apiCalls;
    }

    // Aggregate statistics
    let totalChecked = 0;
    let totalNew = 0;
    let totalModified = 0;
    let totalUnchanged = 0;
    let totalUpserts = 0;
    let hasFailure = false;

    for (const mod of moduleSummaries) {
      totalChecked += mod.checked;
      totalNew += mod.newCount;
      totalModified += mod.modifiedCount;
      totalUnchanged += mod.unchangedCount;
      totalUpserts += mod.upserts;
      if (mod.status === "FAILED") hasFailure = true;
    }

    const finalStatus: SmartSyncResult["status"] = hasFailure
      ? moduleSummaries.some(m => m.status === "SUCCESS")
        ? "PARTIAL"
        : "FAILED"
      : "SUCCESS";

    if (finalStatus === "SUCCESS") {
      setSyncMetadata(db, "last_successful_sync_time", startTime);
    }
    setSyncMetadata(db, "last_sync_status", finalStatus);

    // Log to sync_logs
    recordSyncLog(db, {
      syncId,
      startTime,
      endTime: new Date().toISOString(),
      syncType: `SMART_${options.mode}`,
      invoicesChecked: moduleSummaries.find(m => m.module === "sales_invoices")?.checked || 0,
      invoicesAdded: moduleSummaries.find(m => m.module === "sales_invoices")?.newCount || 0,
      invoicesUpdated: moduleSummaries.find(m => m.module === "sales_invoices")?.modifiedCount || 0,
      invoiceLinesSynced: 0,
      billsChecked: moduleSummaries.find(m => m.module === "purchase_bills")?.checked || 0,
      billsAdded: moduleSummaries.find(m => m.module === "purchase_bills")?.newCount || 0,
      billsUpdated: moduleSummaries.find(m => m.module === "purchase_bills")?.modifiedCount || 0,
      billLinesSynced: 0,
      unchangedRecords: totalUnchanged,
      exceptionsCount: 0,
      apiCalls: totalApiCalls,
      status: finalStatus,
      errors: moduleSummaries.filter(m => m.error).map(m => `${m.module}: ${m.error}`).join("; ") || undefined,
    });

    const limitationNote = hasCustomerPurchaseLimitation
      ? "Zoho Books API lacks line-level customer filtering on Purchase Bills; changed bills in the period were fetched and matched locally by line item customer details."
      : undefined;

    return {
      syncId,
      mode: options.mode,
      status: finalStatus,
      message:
        finalStatus === "SUCCESS"
          ? `Smart Sync completed successfully. ${totalChecked} checked, ${totalUpserts} updated/added, ${totalUnchanged} skipped (${totalApiCalls} API calls used).`
          : `Sync finished with ${finalStatus} status.`,
      modules: moduleSummaries,
      totalChecked,
      totalNew,
      totalModified,
      totalUnchanged,
      totalUpserts,
      apiCallsUsed: totalApiCalls,
      durationMs: Date.now() - startTs,
      customerPurchaseLimitationNote: limitationNote,
      lastSuccessfulSyncAt: startTime,
      syncedThrough: startTime.split("T")[0],
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Sync execution failed";
    setSyncMetadata(db, "last_sync_status", "FAILED");
    return {
      syncId,
      mode: options.mode,
      status: "FAILED",
      message: errorMsg,
      modules: moduleSummaries,
      totalChecked: 0,
      totalNew: 0,
      totalModified: 0,
      totalUnchanged: 0,
      totalUpserts: 0,
      apiCallsUsed: totalApiCalls,
      durationMs: Date.now() - startTs,
      lastSuccessfulSyncAt: getSyncMetadata(db, "last_successful_sync_time"),
      syncedThrough: null,
    };
  } finally {
    releaseSyncLock(db, lockKey);
  }
}

/**
 * Sync Stock Module
 * This is a composite sync that guarantees stock accuracy by synchronizing both 
 * Sales Invoices and Purchase Bills, which act as the source of truth for stock quantities.
 */
async function syncStockModule(params: {
  db: any;
  token: string;
  apiDomain: string;
  orgId: string;
  mode: SmartSyncMode;
  scopeKey: string;
  dateStart?: string;
  dateEnd?: string;
  customerId?: string;
  forceDetail?: boolean;
  startTime: string;
}): Promise<ModuleSyncSummary> {
  const invSummary = await syncSalesInvoicesModule(params);
  const billSummary = await syncPurchaseBillsModule(params);
  
  const summary = {
    module: "stock" as const,
    checked: invSummary.checked + billSummary.checked,
    newCount: invSummary.newCount + billSummary.newCount,
    modifiedCount: invSummary.modifiedCount + billSummary.modifiedCount,
    unchangedCount: invSummary.unchangedCount + billSummary.unchangedCount,
    upserts: invSummary.upserts + billSummary.upserts,
    apiCalls: invSummary.apiCalls + billSummary.apiCalls,
    detailCalls: invSummary.detailCalls + billSummary.detailCalls,
    status: (invSummary.status === "FAILED" || billSummary.status === "FAILED" ? "FAILED" : "SUCCESS") as "SUCCESS" | "FAILED",
    error: [invSummary.error, billSummary.error].filter(Boolean).join(" | ") || undefined,
    details: undefined as string | undefined
  };

  const cancelledAssemblies = validateCompositeAssemblies(params.db);
  if (cancelledAssemblies > 0) {
    summary.details = (summary.details ? summary.details + " | " : "") + `Cancelled ${cancelledAssemblies} orphaned local composite assemblies due to missing purchase bill lines`;
  }

  return summary;
}

/**
 * Sync Sales Invoices with change-awareness and detail fetch skip optimization
 */
async function syncSalesInvoicesModule(params: {
  db: any;
  token: string;
  apiDomain: string;
  orgId: string;
  mode: SmartSyncMode;
  scopeKey: string;
  dateStart?: string;
  dateEnd?: string;
  customerId?: string;
  forceDetail?: boolean;
  startTime: string;
}): Promise<ModuleSyncSummary> {
  const { db, token, apiDomain, orgId, mode, scopeKey, dateStart, dateEnd, customerId, forceDetail, startTime } = params;

  let page = 1;
  let hasMore = true;
  let checked = 0;
  let newCount = 0;
  let modifiedCount = 0;
  let unchangedCount = 0;
  let apiCalls = 0;
  let detailCalls = 0;

  setSyncState(db, {
    module: "sales_invoices",
    scope_key: scopeKey,
    status: "RUNNING",
    last_attempt_at: startTime,
  });

  const lastSyncState = getSyncState(db, "sales_invoices", scopeKey);
  const lastSyncTime = mode !== "FORCE" ? lastSyncState?.last_successful_sync_at : null;

  try {
    while (hasMore) {
      const urlParams = new URLSearchParams({
        organization_id: orgId,
        per_page: "200",
        page: String(page),
      });

      if (customerId) {
        urlParams.set("customer_id", customerId);
      }

      if (mode === "SMART" && lastSyncTime) {
        let fmtSync = lastSyncTime.includes('.') ? lastSyncTime.split('.')[0] + 'Z' : lastSyncTime;
        fmtSync = fmtSync.replace('Z', '+0000');
        urlParams.set("last_modified_time", fmtSync);
      } else if (dateStart && dateEnd) {
        urlParams.set("date_start", dateStart);
        urlParams.set("date_end", dateEnd);
      }

      const listUrl = `${apiDomain}/books/v3/invoices?${urlParams.toString()}`;
      const listRes = await secureZohoFetch(listUrl, {
        method: "GET",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
      });

      apiCalls++;
      recordApiCall(db);

      if (!listRes.ok) {
        throw new Error(`Invoices list API failed with HTTP ${listRes.status}`);
      }

      const listData = await listRes.json();
      if (listData.code !== 0 || !Array.isArray(listData.invoices)) {
        break;
      }

      for (const inv of listData.invoices) {
        checked++;
        const invFingerprint = calculateDocumentFingerprint(inv);
        const existingFingerprint = getDocumentSyncFingerprint(db, "INVOICE", inv.invoice_id);
        const existingRow = db
          .prepare("SELECT invoice_id, last_modified_time FROM sales_invoices WHERE invoice_id = ?")
          .get(inv.invoice_id) as { invoice_id: string; last_modified_time: string | null } | undefined;

        const isNew = !existingRow;
        const isModified = Boolean(
          existingRow &&
            (forceDetail ||
              (inv.last_modified_time && existingRow.last_modified_time && inv.last_modified_time > existingRow.last_modified_time) ||
              (existingFingerprint && existingFingerprint.content_fingerprint !== invFingerprint))
        );

        // Check if unchanged
        if (!isNew && !isModified && !forceDetail) {
          unchangedCount++;
          continue;
        }

        const shouldFetchDetail = isNew || isModified || forceDetail;

        if (isNew) {
          db.prepare(`
            INSERT INTO sales_invoices
            (invoice_id, organization_id, invoice_number, date, due_date, customer_id, customer_name,
             reference_number, status, total, balance, invoice_url, is_verified_link, created_time,
             last_modified_time, source, content_fingerprint, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?, ?)
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
            invFingerprint,
            startTime
          );
          newCount++;
        } else if (isModified) {
          db.prepare(`
            UPDATE sales_invoices
            SET invoice_number = ?, date = ?, due_date = ?, customer_id = ?, customer_name = ?,
                reference_number = ?, status = ?, total = ?, balance = ?,
                last_modified_time = ?, content_fingerprint = ?, synced_at = ?
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
            invFingerprint,
            startTime,
            inv.invoice_id
          );
          modifiedCount++;
        }

        // Fetch detail if needed
        if (shouldFetchDetail) {
          try {
            const detailUrl = `${apiDomain}/books/v3/invoices/${inv.invoice_id}?organization_id=${orgId}`;
            const detailRes = await secureZohoFetch(detailUrl, {
              method: "GET",
              headers: {
                Authorization: `Zoho-oauthtoken ${token}`,
                "Content-Type": "application/json",
              },
            });

            apiCalls++;
            detailCalls++;
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
                    line.item_id || "",
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
            // Keep header on detail failure
          }
        }

        // Store fingerprint cache
        setDocumentSyncFingerprint(db, "INVOICE", inv.invoice_id, inv.last_modified_time || null, invFingerprint);
      }

      hasMore = Boolean(listData.page_context && listData.page_context.has_more_page);
      page++;
    }

    setSyncState(db, {
      module: "sales_invoices",
      scope_key: scopeKey,
      last_successful_sync_at: startTime,
      status: "SUCCESS",
      records_checked: checked,
      records_changed: newCount + modifiedCount,
      records_skipped: unchangedCount,
      api_calls_used: apiCalls,
      last_attempt_at: startTime,
      last_error: null,
    });

    return {
      module: "sales_invoices",
      checked,
      newCount,
      modifiedCount,
      unchangedCount,
      upserts: newCount + modifiedCount,
      apiCalls,
      detailCalls,
      status: "SUCCESS",
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : "Invoice sync failed";
    setSyncState(db, {
      module: "sales_invoices",
      scope_key: scopeKey,
      status: "FAILED",
      last_error: error,
    });
    return {
      module: "sales_invoices",
      checked,
      newCount,
      modifiedCount,
      unchangedCount,
      upserts: newCount + modifiedCount,
      apiCalls,
      detailCalls,
      status: "FAILED",
      error,
    };
  }
}

/**
 * Sync Purchase Bills with change-awareness and line-level customer matching
 */
async function syncPurchaseBillsModule(params: {
  db: any;
  token: string;
  apiDomain: string;
  orgId: string;
  mode: SmartSyncMode;
  scopeKey: string;
  dateStart?: string;
  dateEnd?: string;
  customerId?: string;
  customerName?: string;
  forceDetail?: boolean;
  startTime: string;
}): Promise<ModuleSyncSummary> {
  const { db, token, apiDomain, orgId, mode, scopeKey, dateStart, dateEnd, customerId, customerName, forceDetail, startTime } = params;

  let page = 1;
  let hasMore = true;
  let checked = 0;
  let newCount = 0;
  let modifiedCount = 0;
  let unchangedCount = 0;
  let apiCalls = 0;
  let detailCalls = 0;

  setSyncState(db, {
    module: "purchase_bills",
    scope_key: scopeKey,
    status: "RUNNING",
    last_attempt_at: startTime,
  });

  const lastSyncState = getSyncState(db, "purchase_bills", scopeKey);
  const lastSyncTime = mode !== "FORCE" ? lastSyncState?.last_successful_sync_at : null;

  try {
    while (hasMore) {
      const urlParams = new URLSearchParams({
        organization_id: orgId,
        per_page: "200",
        page: String(page),
      });

      if (mode === "SMART" && lastSyncTime) {
        let fmtSync = lastSyncTime.includes('.') ? lastSyncTime.split('.')[0] + 'Z' : lastSyncTime;
        fmtSync = fmtSync.replace('Z', '+0000');
        urlParams.set("last_modified_time", fmtSync);
      } else if (dateStart && dateEnd) {
        urlParams.set("date_start", dateStart);
        urlParams.set("date_end", dateEnd);
      }

      // NOTE: Zoho Books API does NOT support line-level customer filtering on /bills endpoint.
      // We fetch the bills for the period / changed set and match line-items locally.
      
      const listUrl = `${apiDomain}/books/v3/bills?${urlParams.toString()}`;
      const listRes = await secureZohoFetch(listUrl, {
        method: "GET",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
      });

      apiCalls++;
      recordApiCall(db);

      if (!listRes.ok) {
        throw new Error(`Purchase Bills list API failed with HTTP ${listRes.status}`);
      }

      const listData = await listRes.json();
      if (listData.code !== 0 || !Array.isArray(listData.bills)) {
        break;
      }

      for (const bill of listData.bills) {
        checked++;
        const billFingerprint = calculateDocumentFingerprint(bill);
        const existingFingerprint = getDocumentSyncFingerprint(db, "BILL", bill.bill_id);
        const existingRow = db
          .prepare("SELECT bill_id, last_modified_time FROM purchase_bills WHERE bill_id = ?")
          .get(bill.bill_id) as { bill_id: string; last_modified_time: string | null } | undefined;

        const isNew = !existingRow;
        const isModified = Boolean(
          existingRow &&
            (forceDetail ||
              (bill.last_modified_time && existingRow.last_modified_time && bill.last_modified_time > existingRow.last_modified_time) ||
              (existingFingerprint && existingFingerprint.content_fingerprint !== billFingerprint))
        );

        if (!isNew && !isModified && !forceDetail) {
          unchangedCount++;
          continue;
        }

        const shouldFetchDetail = isNew || isModified || forceDetail;

        if (isNew) {
          db.prepare(`
            INSERT INTO purchase_bills
            (bill_id, organization_id, bill_number, date, due_date, vendor_id, vendor_name,
             reference_number, status, total, balance, bill_url, is_verified_link, created_time,
             last_modified_time, source, content_fingerprint, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?, ?)
          `).run(
            bill.bill_id,
            orgId,
            bill.bill_number || "",
            bill.date || "",
            bill.due_date || "",
            bill.vendor_id || "",
            bill.vendor_name || "",
            bill.reference_number || "",
            bill.status || "DRAFT",
            bill.total || 0,
            bill.balance || 0,
            bill.bill_url || `https://books.bansilengineers.com/app/${orgId}#/bills/${bill.bill_id}`,
            1,
            bill.created_time || null,
            bill.last_modified_time || null,
            billFingerprint,
            startTime
          );
          newCount++;
        } else if (isModified) {
          db.prepare(`
            UPDATE purchase_bills
            SET bill_number = ?, date = ?, due_date = ?, vendor_id = ?, vendor_name = ?,
                reference_number = ?, status = ?, total = ?, balance = ?,
                last_modified_time = ?, content_fingerprint = ?, synced_at = ?
            WHERE bill_id = ?
          `).run(
            bill.bill_number || "",
            bill.date || "",
            bill.due_date || "",
            bill.vendor_id || "",
            bill.vendor_name || "",
            bill.reference_number || "",
            bill.status || "DRAFT",
            bill.total || 0,
            bill.balance || 0,
            bill.last_modified_time || null,
            billFingerprint,
            startTime,
            bill.bill_id
          );
          modifiedCount++;
        }

        if (shouldFetchDetail) {
          try {
            const detailUrl = `${apiDomain}/books/v3/bills/${bill.bill_id}?organization_id=${orgId}`;
            const detailRes = await secureZohoFetch(detailUrl, {
              method: "GET",
              headers: {
                Authorization: `Zoho-oauthtoken ${token}`,
                "Content-Type": "application/json",
              },
            });

            apiCalls++;
            detailCalls++;
            recordApiCall(db);

            if (detailRes.ok) {
              const detailData = await detailRes.json();
              const fullBill = detailData.bill;
              if (fullBill && Array.isArray(fullBill.line_items)) {
                db.prepare("DELETE FROM purchase_bill_line_items WHERE bill_id = ?").run(bill.bill_id);
                for (const line of fullBill.line_items) {
                  // Customer details extraction from line items
                  const lineCustId = line.customer_id || "";
                  let lineCustName = line.customer_name || "";

                  // If custom fields or line details contain customer info
                  if (!lineCustName && Array.isArray(line.custom_fields)) {
                    const custField = line.custom_fields.find(
                      (cf: any) => cf.label === "Customer Details" || cf.api_name === "cf_customer_details"
                    );
                    if (custField && custField.value) {
                      lineCustName = String(custField.value);
                    }
                  }

                  const custDataStatus = lineCustName ? "VERIFIED" : "UNVERIFIED";

                  db.prepare(`
                    INSERT OR REPLACE INTO purchase_bill_line_items
                    (line_item_id, bill_id, item_id, item_name, sku, quantity, rate, line_total, bbt_customer_id, bbt_customer_name, description, customer_data_status, source, synced_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
                  `).run(
                    line.line_item_id,
                    bill.bill_id,
                    line.item_id || "",
                    line.name || "",
                    line.sku || "",
                    line.quantity || 0,
                    line.rate || 0,
                    line.item_total || (line.quantity * line.rate) || 0,
                    lineCustId,
                    lineCustName,
                    line.description || "",
                    custDataStatus,
                    startTime
                  );
                }
              }
            }
          } catch {
            // Keep header on detail failure
          }
        }

        setDocumentSyncFingerprint(db, "BILL", bill.bill_id, bill.last_modified_time || null, billFingerprint);
      }

      hasMore = Boolean(listData.page_context && listData.page_context.has_more_page);
      page++;
    }

    setSyncState(db, {
      module: "purchase_bills",
      scope_key: scopeKey,
      last_successful_sync_at: startTime,
      status: "SUCCESS",
      records_checked: checked,
      records_changed: newCount + modifiedCount,
      records_skipped: unchangedCount,
      api_calls_used: apiCalls,
      last_attempt_at: startTime,
      last_error: null,
    });

    return {
      module: "purchase_bills",
      checked,
      newCount,
      modifiedCount,
      unchangedCount,
      upserts: newCount + modifiedCount,
      apiCalls,
      detailCalls,
      status: "SUCCESS",
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : "Purchase Bill sync failed";
    setSyncState(db, {
      module: "purchase_bills",
      scope_key: scopeKey,
      status: "FAILED",
      last_error: error,
    });
    return {
      module: "purchase_bills",
      checked,
      newCount,
      modifiedCount,
      unchangedCount,
      upserts: newCount + modifiedCount,
      apiCalls,
      detailCalls,
      status: "FAILED",
      error,
    };
  }
}

/**
 * SMART ACTIVITY-DRIVEN SYNC
 * Uses Zoho Activity Logs strictly for CHANGE DETECTION.
 * Identifies affected Invoice & Bill entity IDs, deduplicates, and fetches GET detail ONLY for changed documents.
 * Preserves checkpoint integrity: on failed sync, does NOT advance checkpoint.
 * Falls back to incremental scan if activity logs do not provide usable entity IDs.
 */
export async function performActivityDrivenSync(
  options: Partial<SmartSyncOptions> = {}
): Promise<SmartSyncResult> {
  const db = getDatabase();
  const startTime = new Date().toISOString();
  const startTs = Date.now();
  const syncId = `act_sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const lockKey = "lock:activity_driven_sync:all";

  const lockAcquired = acquireSyncLock(db, lockKey, 120000, "activity_sync");
  if (!lockAcquired) {
    const existingCheckpoint = getActivitySyncCheckpoint(db);
    return {
      syncId,
      mode: "ACTIVITY_DRIVEN",
      status: "LOCKED",
      message: "Activity-driven sync already in progress. Please wait for current sync to finish.",
      modules: [],
      totalChecked: 0,
      totalNew: 0,
      totalModified: 0,
      totalUnchanged: 0,
      totalUpserts: 0,
      apiCallsUsed: 0,
      durationMs: 0,
      lastSuccessfulSyncAt: existingCheckpoint?.lastSuccessfulSyncAt || getSyncMetadata(db, "last_successful_sync_time"),
      syncedThrough: null,
      checkpoint: existingCheckpoint,
    };
  }

  try {
    const tokenStore = readTokenStore();
    const isOnline = Boolean(tokenStore && tokenStore.access_token);
    const existingCheckpoint = getActivitySyncCheckpoint(db);

    if (!isOnline) {
      releaseSyncLock(db, lockKey);
      return {
        syncId,
        mode: "ACTIVITY_DRIVEN",
        status: "OFFLINE",
        message: "Offline mode active — utilizing cached local SQLite records.",
        modules: [],
        totalChecked: 0,
        totalNew: 0,
        totalModified: 0,
        totalUnchanged: 0,
        totalUpserts: 0,
        apiCallsUsed: 0,
        durationMs: Date.now() - startTs,
        lastSuccessfulSyncAt: existingCheckpoint?.lastSuccessfulSyncAt || null,
        syncedThrough: null,
        checkpoint: existingCheckpoint,
      };
    }

    const { token, store } = await getValidAccessToken();
    const orgId = options.organizationId || store.organization_id || "774390949";
    const apiDomain = store.api_domain || "https://www.zohoapis.com";

    // 1. Determine checkpoint date
    const fromDate = existingCheckpoint?.lastActivityEventTime
      ? existingCheckpoint.lastActivityEventTime.slice(0, 10)
      : options.fromDate || "2026-04-01";

    // 2. Fetch Activity Logs GET /books/v3/reports/activitylogs
    let apiCallsUsed = 0;
    const actResult = await fetchActivityLogs({
      organizationId: orgId,
      fromDate,
    });
    apiCallsUsed += 1;
    recordApiCall(db);

    const activities = actResult.activities;
    let latestEventId: string | null = existingCheckpoint?.lastActivityEventId || null;
    let latestEventTime: string | null = existingCheckpoint?.lastActivityEventTime || null;

    // Filter for supported modules only: invoices, bills
    const invoiceChanges: { id: string; action: string }[] = [];
    const billChanges: { id: string; action: string }[] = [];
    let hasUnidentifiableEvents = false;

    for (const act of activities) {
      if (!latestEventTime || act.activity_datetime > latestEventTime) {
        latestEventTime = act.activity_datetime;
        latestEventId = act.activity_id;
      }

      // Record activity log locally into SQLite
      db.prepare(`
        INSERT INTO zoho_activity_log
        (activity_id, activity_datetime, activity_date, module, action, entity_type, entity_id, document_number, user_id, user_name, description, source_ip, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(activity_id) DO UPDATE SET
          activity_datetime = excluded.activity_datetime,
          description = excluded.description,
          synced_at = excluded.synced_at
      `).run(
        act.activity_id,
        act.activity_datetime,
        act.activity_date,
        act.module,
        act.action,
        act.entity_type || null,
        act.entity_id || null,
        act.document_number || null,
        act.user_id || null,
        act.user_name || null,
        act.description,
        act.source_ip || null,
        startTime
      );

      const modLower = act.module.toLowerCase();
      const entityLower = (act.entity_type || "").toLowerCase();

      const isInvoice = modLower.includes("invoice") || entityLower.includes("invoice");
      const isBill = modLower.includes("bill") || entityLower.includes("bill");

      if (isInvoice) {
        if (act.entity_id) {
          invoiceChanges.push({ id: act.entity_id, action: act.action });
        } else {
          hasUnidentifiableEvents = true;
        }
      } else if (isBill) {
        if (act.entity_id) {
          billChanges.push({ id: act.entity_id, action: act.action });
        } else {
          hasUnidentifiableEvents = true;
        }
      }
    }

    // 3. Fallback check: If activity logs do not provide usable entity IDs or failed endpoint
    if (hasUnidentifiableEvents || (activities.length === 0 && actResult.statusCode !== 200)) {
      console.log("[ActivitySync] Unusable activity entity IDs detected, gracefully falling back to incremental change fingerprint scan");
      const fallbackResult = await performSmartSync({
        mode: "SMART",
        modules: ["sales_invoices", "purchase_bills"],
        financialYear: options.financialYear,
        fromDate: options.fromDate,
        toDate: options.toDate,
        organizationId: orgId,
      });

      if (fallbackResult.status === "SUCCESS" || fallbackResult.status === "PARTIAL") {
        setActivitySyncCheckpoint(db, {
          lastActivitySyncAt: startTime,
          lastActivityEventId: latestEventId,
          lastActivityEventTime: latestEventTime || startTime,
          lastSuccessfulSyncAt: startTime,
        });
      }

      releaseSyncLock(db, lockKey);
      return {
        ...fallbackResult,
        mode: "ACTIVITY_DRIVEN",
        message: `Activity-driven sync executed (fallback incremental scan used: ${fallbackResult.message})`,
        checkpoint: getActivitySyncCheckpoint(db),
      };
    }

    // 4. Deduplicate document IDs
    const uniqueInvoiceIds = Array.from(new Set(invoiceChanges.map((c) => c.id)));
    const uniqueBillIds = Array.from(new Set(billChanges.map((c) => c.id)));

    const invoicesChecked = uniqueInvoiceIds.length;
    let invoicesUpserted = 0;
    const billsChecked = uniqueBillIds.length;
    let billsUpserted = 0;
    let detailApiCalls = 0;

    // Fetch detail GET ONLY for changed invoices
    for (const invId of uniqueInvoiceIds) {
      const url = `${apiDomain}/books/v3/invoices/${invId}?organization_id=${orgId}`;
      const res = await secureZohoFetch(url, {
        method: "GET",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
      });
      apiCallsUsed++;
      detailApiCalls++;
      recordApiCall(db);

      if (res.ok) {
        const json = await res.json();
        const invoice = json.invoice;
        if (invoice) {
          const invFingerprint = calculateDocumentFingerprint(invoice);
          db.prepare(`
            INSERT INTO sales_invoices
            (invoice_id, organization_id, invoice_number, date, due_date, customer_id, customer_name,
             reference_number, status, total, balance, invoice_url, is_verified_link, created_time,
             last_modified_time, source, content_fingerprint, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?, ?)
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
              last_modified_time = excluded.last_modified_time,
              content_fingerprint = excluded.content_fingerprint,
              synced_at = excluded.synced_at
          `).run(
            invoice.invoice_id,
            orgId,
            invoice.invoice_number || "",
            invoice.date || "",
            invoice.due_date || "",
            invoice.customer_id || "",
            invoice.customer_name || "",
            invoice.reference_number || "",
            invoice.status || "DRAFT",
            invoice.total || 0,
            invoice.balance || 0,
            invoice.invoice_url || `https://books.bansilengineers.com/app/${orgId}#/invoices/${invoice.invoice_id}`,
            1,
            invoice.created_time || null,
            invoice.last_modified_time || null,
            invFingerprint,
            startTime
          );

          if (Array.isArray(invoice.line_items)) {
            db.prepare("DELETE FROM sales_invoice_line_items WHERE invoice_id = ?").run(invoice.invoice_id);
            for (const line of invoice.line_items) {
              db.prepare(`
                INSERT OR REPLACE INTO sales_invoice_line_items
                (line_item_id, invoice_id, item_id, item_name, sku, quantity, rate, line_total, bbt_customer_id, bbt_customer_name, description, source, synced_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
              `).run(
                line.line_item_id,
                invoice.invoice_id,
                line.item_id || "",
                line.name || "",
                line.sku || "",
                line.quantity || 0,
                line.rate || 0,
                line.item_total || (line.quantity * line.rate) || 0,
                invoice.customer_id || "",
                invoice.customer_name || "",
                line.description || "",
                startTime
              );
            }
          }

          setDocumentSyncFingerprint(db, "INVOICE", invoice.invoice_id, invoice.last_modified_time || null, invFingerprint);
          invoicesUpserted++;
        }
      }
    }

    // Fetch detail GET ONLY for changed bills
    for (const billId of uniqueBillIds) {
      const url = `${apiDomain}/books/v3/bills/${billId}?organization_id=${orgId}`;
      const res = await secureZohoFetch(url, {
        method: "GET",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
      });
      apiCallsUsed++;
      detailApiCalls++;
      recordApiCall(db);

      if (res.ok) {
        const json = await res.json();
        const bill = json.bill;
        if (bill) {
          const billFingerprint = calculateDocumentFingerprint(bill);
          db.prepare(`
            INSERT INTO purchase_bills
            (bill_id, organization_id, bill_number, date, due_date, vendor_id, vendor_name,
             reference_number, status, total, balance, bill_url, is_verified_link, created_time,
             last_modified_time, source, content_fingerprint, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?, ?)
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
              last_modified_time = excluded.last_modified_time,
              content_fingerprint = excluded.content_fingerprint,
              synced_at = excluded.synced_at
          `).run(
            bill.bill_id,
            orgId,
            bill.bill_number || "",
            bill.date || "",
            bill.due_date || "",
            bill.vendor_id || "",
            bill.vendor_name || "",
            bill.reference_number || "",
            bill.status || "DRAFT",
            bill.total || 0,
            bill.balance || 0,
            bill.bill_url || `https://books.bansilengineers.com/app/${orgId}#/bills/${bill.bill_id}`,
            1,
            bill.created_time || null,
            bill.last_modified_time || null,
            billFingerprint,
            startTime
          );

          if (Array.isArray(bill.line_items)) {
            db.prepare("DELETE FROM purchase_bill_line_items WHERE bill_id = ?").run(bill.bill_id);
            for (const line of bill.line_items) {
              const lineCustId = line.customer_id || "";
              let lineCustName = line.customer_name || "";
              if (!lineCustName && Array.isArray(line.custom_fields)) {
                const cf = line.custom_fields.find(
                  (f: any) => f.label === "Customer Details" || f.api_name === "cf_customer_details"
                );
                if (cf && cf.value) lineCustName = String(cf.value);
              }
              const custDataStatus = lineCustName ? "VERIFIED" : "UNVERIFIED";

              db.prepare(`
                INSERT OR REPLACE INTO purchase_bill_line_items
                (line_item_id, bill_id, item_id, item_name, sku, quantity, rate, line_total, bbt_customer_id, bbt_customer_name, description, customer_data_status, source, synced_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
              `).run(
                line.line_item_id,
                bill.bill_id,
                line.item_id || "",
                line.name || "",
                line.sku || "",
                line.quantity || 0,
                line.rate || 0,
                line.item_total || (line.quantity * line.rate) || 0,
                lineCustId,
                lineCustName,
                line.description || "",
                custDataStatus,
                startTime
              );
            }
          }

          setDocumentSyncFingerprint(db, "BILL", bill.bill_id, bill.last_modified_time || null, billFingerprint);
          billsUpserted++;
        }
      }
    }

    // 5. Update checkpoint upon success
    setActivitySyncCheckpoint(db, {
      lastActivitySyncAt: startTime,
      lastActivityEventId: latestEventId,
      lastActivityEventTime: latestEventTime || startTime,
      lastSuccessfulSyncAt: startTime,
    });
    setSyncMetadata(db, "last_successful_sync_time", startTime);
    setSyncMetadata(db, "last_sync_status", "SUCCESS");

    // 6. Refresh and Cache API Usage (after sync)
    let apiUsageInfo = null;
    try {
      const usageRes = await fetchApiUsage(orgId);
      setApiUsageCache(db, usageRes);
      apiUsageInfo = usageRes;
    } catch {
      // Non-critical
    }

    const durationMs = Date.now() - startTs;
    releaseSyncLock(db, lockKey);

    const modules: ModuleSyncSummary[] = [
      {
        module: "sales_invoices",
        checked: invoicesChecked,
        newCount: 0,
        modifiedCount: invoicesUpserted,
        unchangedCount: 0,
        upserts: invoicesUpserted,
        apiCalls: uniqueInvoiceIds.length,
        detailCalls: uniqueInvoiceIds.length,
        status: "SUCCESS",
      },
      {
        module: "purchase_bills",
        checked: billsChecked,
        newCount: 0,
        modifiedCount: billsUpserted,
        unchangedCount: 0,
        upserts: billsUpserted,
        apiCalls: uniqueBillIds.length,
        detailCalls: uniqueBillIds.length,
        status: "SUCCESS",
      },
    ];

    return {
      syncId,
      mode: "ACTIVITY_DRIVEN",
      status: "SUCCESS",
      message: `Activity-driven sync completed. ${uniqueInvoiceIds.length} invoice(s) and ${uniqueBillIds.length} bill(s) processed.`,
      modules,
      totalChecked: invoicesChecked + billsChecked,
      totalNew: 0,
      totalModified: invoicesUpserted + billsUpserted,
      totalUnchanged: 0,
      totalUpserts: invoicesUpserted + billsUpserted,
      apiCallsUsed,
      durationMs,
      lastSuccessfulSyncAt: startTime,
      syncedThrough: null,
      checkpoint: getActivitySyncCheckpoint(db),
      apiUsage: apiUsageInfo,
    };
  } catch (err: unknown) {
    releaseSyncLock(db, lockKey);
    const errorMsg = err instanceof Error ? err.message : "Activity-driven sync failed";
    console.error("[ActivitySync] Sync failed:", errorMsg);
    // On failed sync: do NOT advance successful checkpoint.
    setSyncMetadata(db, "last_sync_status", "FAILED");

    return {
      syncId,
      mode: "ACTIVITY_DRIVEN",
      status: "FAILED",
      message: `Activity sync failed: ${errorMsg}. Checkpoint preserved.`,
      modules: [],
      totalChecked: 0,
      totalNew: 0,
      totalModified: 0,
      totalUnchanged: 0,
      totalUpserts: 0,
      apiCallsUsed: 0,
      durationMs: Date.now() - startTs,
      lastSuccessfulSyncAt: getActivitySyncCheckpoint(db)?.lastSuccessfulSyncAt || null,
      syncedThrough: null,
      checkpoint: getActivitySyncCheckpoint(db),
    };
  }
}


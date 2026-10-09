import { NextRequest, NextResponse } from "next/server";
import { performSmartSync, checkSyncStaleness, SmartSyncMode, SmartSyncModule } from "@/app/lib/smart-sync-engine";
import { performSync } from "@/app/lib/db/sync-engine";
import {
  getDatabase,
  getSyncMetadata,
  getApiCallStats,
  getRecentSyncLogs,
  getLatestSyncedDocumentDate,
  getAllSyncStates,
  getAllSyncCoverage,
  getFeatureSettings,
} from "@/app/lib/db/database";
import { formatDisplayDateTime, formatDisplayDate } from "@/app/lib/date-utils";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";
import { requireOwnerSessionOrForbid } from "@/app/lib/audit/api-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDatabase();
    const lastSuccessfulSyncTime = getSyncMetadata(db, "last_successful_sync_time");
    const lastAttemptedSyncTime = getSyncMetadata(db, "last_attempted_sync_time");
    const lastSyncStatus = getSyncMetadata(db, "last_sync_status") || "UP_TO_DATE";
    const apiCallStats = getApiCallStats(db);
    const recentLogs = getRecentSyncLogs(db, 10);
    const latestDocDate = getLatestSyncedDocumentDate(db);
    const syncStates = getAllSyncStates(db);
    const coverage = getAllSyncCoverage(db);
    const settings = getFeatureSettings(db);

    const staleWarningHours = 24;
    const staleness = checkSyncStaleness(lastSuccessfulSyncTime, staleWarningHours);

    return NextResponse.json({
      success: true,
      connected: true,
      lastSyncAt: lastSuccessfulSyncTime ? formatDisplayDateTime(lastSuccessfulSyncTime) : null,
      lastSuccessfulSyncTime,
      lastAttemptedSyncTime,
      lastAttemptedSyncAt: lastAttemptedSyncTime ? formatDisplayDateTime(lastAttemptedSyncTime) : null,
      syncedThrough: latestDocDate,
      syncedThroughDisplay: formatDisplayDate(latestDocDate),
      syncStatus:
        lastSyncStatus === "SUCCESS" || lastSyncStatus === "UP_TO_DATE"
          ? "Up to Date"
          : lastSyncStatus === "PARTIAL"
          ? "Partial"
          : lastSyncStatus === "FAILED"
          ? "Failed"
          : lastSyncStatus === "IN_PROGRESS"
          ? "In Progress"
          : lastSyncStatus,
      apiCallsToday: apiCallStats.today,
      lastSyncApiCalls: apiCallStats.lastSync,
      staleness,
      syncStates,
      coverage,
      settings,
      recentLogs,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load sync status";
    return NextResponse.json({ error: message, success: false }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // C-1: Owner-only guard — sync mutation is a privileged operation.
  // Middleware already verified JWT (401 for unauthenticated);
  // this returns 403 for authenticated-but-not-Owner users.
  const denied = await requireOwnerSessionOrForbid(request);
  if (denied) return denied;

  const disabled = requireFeaturesEnabled("action_zoho_manual_sync");
  if (disabled) return disabled;
  try {
    const body = await request.json().catch(() => ({}));
    
    // Check if this is a SMART / SELECTIVE / FORCE sync request
    const mode = (body.mode as SmartSyncMode) || (body.type === "FULL" ? undefined : "SMART");
    
    if (mode && ["SMART", "SELECTIVE", "FORCE"].includes(mode)) {
      const modules = (body.modules as SmartSyncModule[]) || (body.module ? [body.module] : ["sales_invoices", "purchase_bills"]);
      const result = await performSmartSync({
        mode,
        modules,
        customerId: body.customerId,
        customerName: body.customerName,
        financialYear: body.financialYear,
        fromDate: body.fromDate,
        toDate: body.toDate,
        forceDetail: body.forceDetail || mode === "FORCE",
      });

      const db = getDatabase();
      const lastSuccessfulSyncTime = getSyncMetadata(db, "last_successful_sync_time");
      const lastAttemptedSyncTime = getSyncMetadata(db, "last_attempted_sync_time");
      const apiCallStats = getApiCallStats(db);
      const latestDocDate = getLatestSyncedDocumentDate(db);

      return NextResponse.json({
        ...result,
        success: result.status === "SUCCESS" || result.status === "PARTIAL",
        lastSyncAt: lastSuccessfulSyncTime ? formatDisplayDateTime(lastSuccessfulSyncTime) : null,
        lastSuccessfulSyncTime,
        lastAttemptedSyncTime,
        lastAttemptedSyncAt: lastAttemptedSyncTime ? formatDisplayDateTime(lastAttemptedSyncTime) : null,
        syncedThrough: latestDocDate,
        syncedThroughDisplay: formatDisplayDate(latestDocDate),
        apiCallsUsed: result.apiCallsUsed,
        apiCallsToday: apiCallStats.today,
      });
    }

    // Legacy fallback for FULL historical backfill
    const syncType = (body.type as "INITIAL" | "INCREMENTAL" | "MANUAL" | "FULL") || "INCREMENTAL";
    const financialYear = body.financialYear || "2025-26";

    const result = await performSync({
      type: syncType,
      financialYear,
    });

    const db = getDatabase();
    const lastSuccessfulSyncTime = getSyncMetadata(db, "last_successful_sync_time");
    const lastAttemptedSyncTime = getSyncMetadata(db, "last_attempted_sync_time");
    const apiCallStats = getApiCallStats(db);
    const latestDocDate = getLatestSyncedDocumentDate(db);

    return NextResponse.json({
      ...result,
      success: result.status === "SUCCESS" || result.status === "PARTIAL",
      lastSyncAt: lastSuccessfulSyncTime ? formatDisplayDateTime(lastSuccessfulSyncTime) : null,
      lastSuccessfulSyncTime,
      lastAttemptedSyncTime,
      lastAttemptedSyncAt: lastAttemptedSyncTime ? formatDisplayDateTime(lastAttemptedSyncTime) : null,
      syncedThrough: latestDocDate,
      syncedThroughDisplay: formatDisplayDate(latestDocDate),
      apiCallsUsed: result.apiCalls,
      apiCallsToday: apiCallStats.today,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Sync execution failed";
    return NextResponse.json({ error: message, success: false }, { status: 500 });
  }
}


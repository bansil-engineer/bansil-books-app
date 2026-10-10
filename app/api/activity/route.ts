import { NextRequest, NextResponse } from "next/server";
import {
  getDatabase,
  getActivityLogs,
  getActivityKpis,
  getActivitySyncStats,
  getApiUsageCache,
  getSyncMetadata,
} from "@/app/lib/db/database";
import { getCurrentFyStart, getActivityDateRange } from "@/app/lib/date-period-utils";
import { syncZohoActivityLogs } from "@/app/lib/zoho-activity-engine";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

/**
 * GET /api/activity
 * LOCAL-FIRST: Queries local SQLite zoho_activity_logs (and zoho_activity_log).
 * ZOHO API CALLS: 0 on page open.
 */
export async function GET(req: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("activity", "GET"), "activity GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const disabled = requireFeaturesEnabled("module_zoho_activity", "sub_trans_zoho_activity");
  if (disabled) return disabled;
  try {
    const searchParams = req.nextUrl.searchParams;
    const preset = searchParams.get("preset") || searchParams.get("period") || "CURRENT_FY";
    const customFrom = searchParams.get("fromDate");
    const customTo = searchParams.get("toDate");
    const user = searchParams.get("user") || "";
    const moduleFilter = searchParams.get("module") || "";
    const action = searchParams.get("action") || "";
    const search = searchParams.get("search") || "";
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 500;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : 0;

    const db = getDatabase();
    const now = new Date();
    const fyStart = getCurrentFyStart(now);

    // Resolve date range based on preset (Default: Current FY)
    const range = getActivityDateRange(preset, customFrom || undefined, customTo || undefined, now);

    // Retrieve activity logs from SQLite zoho_activity_logs / zoho_activity_log
    const { activities, totalCount } = getActivityLogs(db, {
      fromDate: range.fromDate,
      toDate: range.toDate,
      user: user || undefined,
      module: moduleFilter || undefined,
      action: action || undefined,
      search: search || undefined,
      limit,
      offset,
    });

    // 7 Required KPIs: Total Activities, Today, This Week, This Month, Users, Modules, Last Sync
    const kpis = getActivityKpis(db, fyStart, range.toDate, now);

    // 5 API Usage / Sync Metrics
    const syncStats = getActivitySyncStats(db);
    const apiQuota = getApiUsageCache(db);

    // Dynamic authorization status
    const syncStatus = getSyncMetadata(db, "activity_sync_status");
    const syncMsg = getSyncMetadata(db, "activity_sync_message");
    const isAuthorized = syncStatus !== "NOT_AUTHORIZED";

    // Distinct dropdown filter options
    const users = db.prepare(`
      SELECT DISTINCT user_name as name FROM zoho_activity_logs
      WHERE user_name IS NOT NULL AND TRIM(user_name) != ''
      ORDER BY user_name ASC
    `).all() as { name: string }[];

    const modules = db.prepare(`
      SELECT DISTINCT module as name FROM zoho_activity_logs
      WHERE module IS NOT NULL AND TRIM(module) != ''
      ORDER BY module ASC
    `).all() as { name: string }[];

    const actions = db.prepare(`
      SELECT DISTINCT action as name FROM zoho_activity_logs
      WHERE action IS NOT NULL AND TRIM(action) != ''
      ORDER BY action ASC
    `).all() as { name: string }[];

    return NextResponse.json({
      success: true,
      activities,
      totalCount,
      dateRange: range,
      kpis,
      syncStats,
      apiUsage: {
        lastSync: syncStats.lastSync || kpis.lastSync,
        activitiesRetrieved: syncStats.activitiesRetrieved,
        newActivities: syncStats.newActivities,
        updatedActivities: syncStats.updatedActivities,
        apiCallsUsed: syncStats.apiCallsUsed,
        dailyLimit: apiQuota?.dailyLimit ?? 10000,
        usedToday: apiQuota?.usedToday ?? 0,
        remaining: apiQuota?.remaining ?? 10000,
        usagePercentage: apiQuota?.usagePercentage ?? 0,
      },
      filterOptions: {
        users: users.map((u) => u.name),
        modules: modules.map((m) => m.name),
        actions: actions.map((a) => a.name),
      },
      scopeStatus: {
        authorized: isAuthorized,
        authorization: isAuthorized ? "PASS" : "FAIL",
        status: syncStatus || (isAuthorized ? "AUTHORIZED" : "NOT_AUTHORIZED"),
        reportsReadApproved: isAuthorized,
        approvedScope: "ZohoBooks.reports.READ",
        accessMode: "READ ONLY",
        endpoint: "/books/v3/reports/activitylogs",
        notice:
          syncMsg ||
          (isAuthorized
            ? "Reports READ scope approved."
            : "ZOHO ACTIVITY ACCESS: NOT AUTHORIZED (code 57). Re-consent for ZohoBooks.reports.READ is required."),
        // Legacy notes preserved for test compatibility
        legacyNote:
          "NOT AVAILABLE IN ZOHO BOOKS V3 API under invoices/bills GET. Requires reports/activitylogs.",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch activity logs from SQLite cache",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/activity
 * Triggers sync from official Zoho Books Activity Logs API.
 * Supports incremental sync (default) or force full FY sync (01/04/2026 to current date).
 * Strictly GET from Zoho. Zero writes.
 */
export async function POST(req: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("activity", "POST"), "activity POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  const disabled = requireFeaturesEnabled("module_zoho_activity", "action_zoho_manual_sync");
  if (disabled) return disabled;
  try {
    let body: { forceFullFy?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is acceptable
    }

    const result = await syncZohoActivityLogs({
      forceFullFy: Boolean(body?.forceFullFy),
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Activity sync trigger failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

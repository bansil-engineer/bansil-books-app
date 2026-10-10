// GET /api/zoho/api-usage
// Returns the current Zoho Books API usage metrics (Daily Limit, Used Today, Remaining, Usage %).
// Strictly READ-ONLY. Caches responses to prevent wasting API calls.

import { NextRequest, NextResponse } from "next/server";
import { getDatabase, getApiUsageCache, setApiUsageCache } from "@/app/lib/db/database";
import { fetchApiUsage } from "@/app/lib/zoho-api";
import { readTokenStore } from "@/app/lib/zoho-token-store";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("zoho/api-usage", "GET"), "zoho/api-usage GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const db = getDatabase();
    const searchParams = request.nextUrl.searchParams;
    const forceRefresh = searchParams.get("refresh") === "true";

    const cached = getApiUsageCache(db);
    const tokenStore = readTokenStore();
    const isOnline = Boolean(tokenStore && tokenStore.access_token);

    // If forceRefresh requested and system is connected online, fetch fresh snapshot
    if (forceRefresh && isOnline) {
      try {
        const live = await fetchApiUsage();
        setApiUsageCache(db, live);
        return NextResponse.json({
          success: true,
          dailyLimit: live.dailyLimit,
          usedToday: live.usedToday,
          remaining: live.remaining,
          usagePercentage: live.usagePercentage,
          resetTime: live.resetTime,
          updatedAt: new Date().toISOString(),
          source: "LIVE_API",
        });
      } catch (err: unknown) {
        console.warn("[ApiUsageRoute] Live fetch failed, serving cache:", err);
      }
    }

    // Serve from SQLite cache if available
    if (cached) {
      return NextResponse.json({
        success: true,
        dailyLimit: cached.dailyLimit,
        usedToday: cached.usedToday,
        remaining: cached.remaining,
        usagePercentage: cached.usagePercentage,
        resetTime: cached.resetTime,
        updatedAt: cached.updatedAt,
        source: "CACHED",
      });
    }

    // Default fallback if no sync has occurred yet
    return NextResponse.json({
      success: true,
      dailyLimit: 10000,
      usedToday: 0,
      remaining: 10000,
      usagePercentage: 0,
      resetTime: null,
      updatedAt: new Date().toISOString(),
      source: "DEFAULT_OFFLINE",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to retrieve API usage";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ============================================================
// Bansil Books Analytics — API: Company Data Sources Registry
// ============================================================

import { NextResponse } from "next/server";
import { listDataSources } from "@/app/lib/ai/ceo/data-source-registry";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("ai/data-sources", "GET"), "ai/data-sources GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const dataSources = listDataSources();
    return NextResponse.json({
      success: true,
      count: dataSources.length,
      dataSources,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

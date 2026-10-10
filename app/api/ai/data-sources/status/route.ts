// ============================================================
// Bansil Books Analytics — API: Company Data Sources Status
// Phase 2E: Governed read-only discovery & health status
// ============================================================

import { NextResponse } from "next/server";
import { discoverRealDataSources } from "@/app/lib/ai/ceo/data-source-registry";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("ai/data-sources/status", "GET"), "ai/data-sources/status GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const report = discoverRealDataSources();
    return NextResponse.json({
      success: true,
      report,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to discover data sources" },
      { status: 500 }
    );
  }
}

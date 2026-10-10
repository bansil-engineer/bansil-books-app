// ============================================================
// Bansil Books Analytics — API: Specific Company Data Source Status
// Phase 2E: Governed read-only status and watermark check
// ============================================================

import { NextResponse } from "next/server";
import {
  listDataSources,
  getDataSourceByCode,
  checkWatermarkStatus,
} from "@/app/lib/ai/ceo/data-source-registry";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("ai/data-sources/[id]/status", "GET"), "ai/data-sources/[id]/status GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const { id } = await params;
    let source = getDataSourceByCode(id);

    if (!source) {
      const all = listDataSources();
      source = all.find((s) => s.id === id || s.code.toLowerCase() === id.toLowerCase()) || null;
    }

    if (!source) {
      return NextResponse.json(
        { success: false, error: `Data source '${id}' not found.` },
        { status: 404 }
      );
    }

    const watermark = checkWatermarkStatus(source.code);

    return NextResponse.json({
      success: true,
      source,
      watermark,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to retrieve source status" },
      { status: 500 }
    );
  }
}

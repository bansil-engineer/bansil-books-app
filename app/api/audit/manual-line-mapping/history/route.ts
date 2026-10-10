// ============================================================
// Manual SO↔PO Line Mapping — History API (Phase 2)
//
// GET: Return mapping history for a PO line.
//
// ZOHO WRITE = 0. Pure local SQLite read operations.
// ============================================================

import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { getHistoryEventsForPoLine } from "@/app/lib/audit/manual-line-mapping-service";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/manual-line-mapping/history", "GET"), "audit/manual-line-mapping/history GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("orgId");
    const purchaseorderId = searchParams.get("purchaseorderId");
    const poLineItemId = searchParams.get("poLineItemId");

    if (!orgId || !purchaseorderId || !poLineItemId) {
      return NextResponse.json(
        { error: "Missing required parameters: orgId, purchaseorderId, poLineItemId" },
        { status: 400 }
      );
    }

    const db = getAuditDatabase();
    const history = getHistoryEventsForPoLine(db, orgId, purchaseorderId, poLineItemId);

    return NextResponse.json({ history });
  } catch (error) {
    console.error("Manual line mapping history error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ============================================================
// Manual SO↔PO Line Mapping — Revoke API (Phase 2)
//
// POST: Revoke an existing mapping.
//
// ZOHO WRITE = 0. Pure local SQLite operations.
// ============================================================

import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { revokeOwnerLineMapping } from "@/app/lib/audit/manual-line-mapping-service";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function POST(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/manual-line-mapping/revoke", "POST"), "audit/manual-line-mapping/revoke POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const body = await request.json();
    const { mappingId, note } = body;

    if (!mappingId) {
      return NextResponse.json(
        { error: "Missing required field: mappingId" },
        { status: 400 }
      );
    }

    const db = getAuditDatabase();
    const result = revokeOwnerLineMapping(db, mappingId, note || undefined);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Manual line mapping revoke error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

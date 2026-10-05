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

export async function POST(request: Request) {
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

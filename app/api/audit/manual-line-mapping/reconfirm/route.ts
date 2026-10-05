// ============================================================
// Manual SO↔PO Line Mapping — Reconfirm API (Phase 2)
//
// POST: Reconfirm a REVIEW_REQUIRED mapping after OWNER review.
//
// ZOHO WRITE = 0. Pure local SQLite operations.
// ============================================================

import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { reconfirmOwnerLineMapping } from "@/app/lib/audit/manual-line-mapping-service";

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
    const result = reconfirmOwnerLineMapping(db, mappingId, note || undefined);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Manual line mapping reconfirm error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

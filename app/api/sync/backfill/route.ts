// ============================================================
// Bansil Books Analytics — Full Historical Backfill API Route
// GET Status / POST Run Full Historical Backfill (READ-ONLY GET)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { performFullHistoricalBackfill } from "@/app/lib/db/sync-engine";
import { getDatabase, getSyncCoverage, isFullBackfillCompleted } from "@/app/lib/db/database";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const db = getDatabase();
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get("financialYear") || "FY 2025-26";
    const coverage = getSyncCoverage(db, fy);
    const completed = isFullBackfillCompleted(db, fy);

    return NextResponse.json({
      success: true,
      financialYear: fy,
      coverage,
      isCompleted: completed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load backfill status";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const disabled = requireFeaturesEnabled("action_zoho_manual_sync");
  if (disabled) return disabled;
  try {
    const body = await request.json().catch(() => ({}));
    const financialYear = body.financialYear || "FY 2025-26";
    const fromDate = body.fromDate || "2025-04-01";
    const toDate = body.toDate || "2026-03-31";

    const result = await performFullHistoricalBackfill({
      financialYear,
      fromDate,
      toDate,
    });

    return NextResponse.json({
      success: result.status === "SUCCESS",
      result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Backfill execution failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

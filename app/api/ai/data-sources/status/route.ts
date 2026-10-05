// ============================================================
// Bansil Books Analytics — API: Company Data Sources Status
// Phase 2E: Governed read-only discovery & health status
// ============================================================

import { NextResponse } from "next/server";
import { discoverRealDataSources } from "@/app/lib/ai/ceo/data-source-registry";

export async function GET() {
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

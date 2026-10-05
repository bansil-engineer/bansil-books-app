// ============================================================
// Bansil Books Analytics — API: Company Data Sources Registry
// ============================================================

import { NextResponse } from "next/server";
import { listDataSources } from "@/app/lib/ai/ceo/data-source-registry";

export async function GET() {
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

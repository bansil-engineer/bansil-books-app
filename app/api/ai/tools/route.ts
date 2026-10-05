// ============================================================
// Bansil Books Analytics — API: Safe Tool Catalog
// ============================================================

import { NextResponse } from "next/server";
import { listTools } from "@/app/lib/ai/ceo/safe-tool-registry";

export async function GET() {
  try {
    const tools = listTools();
    return NextResponse.json({
      success: true,
      count: tools.length,
      tools,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

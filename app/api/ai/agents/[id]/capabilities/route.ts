// ============================================================
// Bansil Books Analytics — API: Agent Capabilities
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getAgentCapabilities } from "@/app/lib/ai/ceo/capability-registry";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const capabilities = getAgentCapabilities(id);
    return NextResponse.json({
      success: true,
      agentId: id,
      count: capabilities.length,
      capabilities,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

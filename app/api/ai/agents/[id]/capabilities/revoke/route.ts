// ============================================================
// Bansil Books Analytics — API: Revoke Agent Capability
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { revokeCapabilityFromAgent } from "@/app/lib/ai/ceo/capability-registry";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const capabilityCode = body.capabilityCode || body.capability;
    if (!capabilityCode) {
      return NextResponse.json(
        { success: false, error: "Missing required parameter 'capabilityCode'." },
        { status: 400 }
      );
    }

    const result = revokeCapabilityFromAgent({
      agentId: id,
      capabilityCode,
      revokedBy: body.revokedBy || "AI_CEO",
    });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      agentId: id,
      capabilityCode,
      status: "REVOKED",
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

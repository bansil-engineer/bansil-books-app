// ============================================================
// Bansil Books Analytics — API: Grant Agent Capability
// Server is authoritative: Rejects client elevation and hard-denies.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { grantCapabilityToAgent, isCapabilityGrantable } from "@/app/lib/ai/ceo/capability-registry";

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

    // Security Check: Client cannot self-grant or bypass server authority
    if (body.allowZohoWrite === true || body.grantZohoWrite === true) {
      return NextResponse.json(
        { success: false, error: "SECURITY POLICY VIOLATION: ZOHO WRITE = 0. Client elevation rejected." },
        { status: 403 }
      );
    }

    // Authoritative check
    const grantCheck = isCapabilityGrantable(capabilityCode);
    if (!grantCheck.grantable) {
      return NextResponse.json(
        { success: false, error: grantCheck.reason },
        { status: 403 }
      );
    }

    const grantor = body.grantedBy === "AI_CEO" || body.grantedBy === "SYSTEM" ? body.grantedBy : "AI_CEO";
    const result = grantCapabilityToAgent({
      agentId: id,
      capabilityCode,
      grantedBy: grantor,
      sourcePolicy: body.sourcePolicy || "CEO_DIRECT_GRANT",
    });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      agentId: id,
      capability: result.agentCapability,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

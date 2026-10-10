// ============================================================
// Bansil Books Analytics — API: Revoke Agent Capability
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { revokeCapabilityFromAgent } from "@/app/lib/ai/ceo/capability-registry";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("ai/agents/[id]/capabilities/revoke", "POST"), "ai/agents/[id]/capabilities/revoke POST");
  if (!rbacGuard.ok) return rbacGuard.response;
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

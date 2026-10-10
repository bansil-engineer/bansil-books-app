// ============================================================
// Bansil Books Analytics — API: Agent Capabilities
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getAgentCapabilities } from "@/app/lib/ai/ceo/capability-registry";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("ai/agents/[id]/capabilities", "GET"), "ai/agents/[id]/capabilities GET");
  if (!rbacGuard.ok) return rbacGuard.response;
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

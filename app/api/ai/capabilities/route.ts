// ============================================================
// Bansil Books Analytics — API: Capabilities Registry
// ============================================================

import { NextResponse } from "next/server";
import { listCapabilities, getRoleCapabilityTemplates } from "@/app/lib/ai/ceo/capability-registry";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("ai/capabilities", "GET"), "ai/capabilities GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const capabilities = listCapabilities();
    const templates = getRoleCapabilityTemplates();
    return NextResponse.json({
      success: true,
      count: capabilities.length,
      capabilities,
      roleTemplates: templates,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

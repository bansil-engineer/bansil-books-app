// ============================================================
// Bansil Books Analytics — API: Safe Tool Catalog
// ============================================================

import { NextResponse } from "next/server";
import { listTools } from "@/app/lib/ai/ceo/safe-tool-registry";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("ai/tools", "GET"), "ai/tools GET");
  if (!rbacGuard.ok) return rbacGuard.response;
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

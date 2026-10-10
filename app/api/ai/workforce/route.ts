import { NextResponse } from "next/server";
import { getWorkforceOverview } from "@/app/lib/ai/ceo/workforce-manager";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("ai/workforce", "GET"), "ai/workforce GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const overview = getWorkforceOverview();
    return NextResponse.json(overview);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

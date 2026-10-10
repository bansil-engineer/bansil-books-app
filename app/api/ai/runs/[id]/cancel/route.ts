import { NextResponse } from "next/server";
import { cancelRun } from "@/app/lib/ai/ceo/execution-lifecycle";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("ai/runs/[id]/cancel", "POST"), "ai/runs/[id]/cancel POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const { id } = await params;
    let body: { reason?: string } = {};
    try {
      body = await req.json();
    } catch {
      // empty body is fine
    }

    const result = cancelRun(id, body.reason || "Cancelled by Owner request");
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("POST /api/ai/runs/[id]/cancel error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

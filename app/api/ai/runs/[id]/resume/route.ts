import { NextResponse } from "next/server";
import { resumeRun } from "@/app/lib/ai/ceo/execution-lifecycle";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("ai/runs/[id]/resume", "POST"), "ai/runs/[id]/resume POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const { id } = await params;
    const run = await resumeRun(id);
    return NextResponse.json({ success: true, run });
  } catch (err: any) {
    console.error("POST /api/ai/runs/[id]/resume error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

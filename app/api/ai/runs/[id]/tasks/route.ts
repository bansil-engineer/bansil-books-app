import { NextResponse } from "next/server";
import { listTasksForRun } from "@/app/lib/ai/ceo/task-coordinator";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("ai/runs/[id]/tasks", "GET"), "ai/runs/[id]/tasks GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const { id } = await params;
    const tasks = listTasksForRun(id);
    return NextResponse.json({
      runId: id,
      count: tasks.length,
      tasks,
    });
  } catch (err: any) {
    console.error("GET /api/ai/runs/[id]/tasks error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

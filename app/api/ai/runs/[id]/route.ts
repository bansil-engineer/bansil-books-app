import { NextResponse } from "next/server";
import { getExecutionRun, getRunHandoffs } from "@/app/lib/ai/ceo/execution-lifecycle";
import { getAiDatabase } from "@/app/lib/db/ai-database";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("ai/runs/[id]", "GET"), "ai/runs/[id] GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const { id } = await params;
    const run = getExecutionRun(id);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const db = getAiDatabase();
    const auditEvents = db
      .prepare("SELECT * FROM ai_audit_events WHERE run_id = ? ORDER BY created_at ASC")
      .all(id);

    const handoffs = getRunHandoffs(id);

    return NextResponse.json({
      run,
      auditEvents,
      handoffs,
    });
  } catch (err: any) {
    console.error("GET /api/ai/runs/[id] error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

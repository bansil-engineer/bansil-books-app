import { NextResponse } from "next/server";
import { getAiDatabase } from "@/app/lib/db/ai-database";
import { getExecutionRun, getRunHandoffs } from "@/app/lib/ai/ceo/execution-lifecycle";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(req: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("ai/runs/latest", "GET"), "ai/runs/latest GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversationId");

    const db = getAiDatabase();

    let runRecord;

    if (conversationId) {
      // 1. Active run for this conversation
      runRecord = db.prepare(`
        SELECT id FROM ai_runs
        WHERE conversation_id = ? AND status NOT IN ('COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'BLOCKED')
        ORDER BY started_at DESC
        LIMIT 1
      `).get(conversationId) as { id: string } | undefined;

      // 2. Or just latest run for this conversation
      if (!runRecord) {
        runRecord = db.prepare(`
          SELECT id FROM ai_runs
          WHERE conversation_id = ?
          ORDER BY started_at DESC
          LIMIT 1
        `).get(conversationId) as { id: string } | undefined;
      }
    } else {
      // 1. Global active run
      runRecord = db.prepare(`
        SELECT id FROM ai_runs
        WHERE status NOT IN ('COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'BLOCKED')
        ORDER BY started_at DESC
        LIMIT 1
      `).get() as { id: string } | undefined;

      // 2. Global latest run
      if (!runRecord) {
        runRecord = db.prepare(`
          SELECT id FROM ai_runs
          ORDER BY started_at DESC
          LIMIT 1
        `).get() as { id: string } | undefined;
      }
    }

    if (!runRecord) {
      return NextResponse.json({ error: "No runs found" }, { status: 404 });
    }

    const run = getExecutionRun(runRecord.id);
    if (!run) {
      return NextResponse.json({ error: "Run details not found" }, { status: 404 });
    }

    const auditEvents = db
      .prepare("SELECT * FROM ai_audit_events WHERE run_id = ? ORDER BY created_at ASC")
      .all(run.id);

    const handoffs = getRunHandoffs(run.id);

    return NextResponse.json({
      run,
      auditEvents,
      handoffs,
    });
  } catch (err: any) {
    console.error("GET /api/ai/runs/latest error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

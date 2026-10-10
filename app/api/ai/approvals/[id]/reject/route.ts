import { NextResponse } from "next/server";
import { getAiDatabase } from "@/app/lib/db/ai-database";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("ai/approvals/[id]/reject", "POST"), "ai/approvals/[id]/reject POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const id = (await params).id;
    const db = getAiDatabase();

    db.prepare(`
      UPDATE ai_approvals
      SET status = 'REJECTED'
      WHERE id = ?
    `).run(id);

    return NextResponse.json({ success: true, status: "REJECTED" });
  } catch (err: any) {
    console.error("Error rejecting action:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getAiDatabase } from "@/app/lib/db/ai-database";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("ai/conversations/[id]/messages", "GET"), "ai/conversations/[id]/messages GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const id = (await params).id;
    const db = getAiDatabase();
    const messages = db.prepare(`
      SELECT id, role, content, agent, created_at
      FROM ai_messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(id);

    return NextResponse.json(messages);
  } catch (err: any) {
    console.error("Error fetching messages:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

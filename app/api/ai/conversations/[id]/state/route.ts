import { NextResponse } from "next/server";
import { getAiDatabase } from "@/app/lib/db/ai-database";
import { applyBinAction, deleteBinnedConversationPermanently } from "@/app/lib/ai/conversation-bin";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

// POST { action: "MOVE_TO_BIN" | "RESTORE" | "DELETE_PERMANENTLY" (+ { confirm: true, conversationId, previewFingerprint }) }
// The client names an action, never a state. Only ACTIVE->BINNED and BINNED->ACTIVE succeed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("ai/conversations/[id]/state", "POST"), "ai/conversations/[id]/state POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const id = (await params).id;
    let body: any = null;
    try { body = await req.json(); } catch {}
    const db = getAiDatabase();

    // High-risk, irreversible. Bin-only, explicit confirmation naming this conversation.
    if (body?.action === "DELETE_PERMANENTLY") {
      const del = deleteBinnedConversationPermanently(db, id, body);
      // Backup file name + hash only; never a filesystem path.
      if (del.ok) return NextResponse.json({ deleted: true, impact: del.deleted, backup: del.backup });
      const st =
        del.code === "NOT_FOUND" ? 404
        : del.code === "CONFIRMATION_REQUIRED" || del.code === "PREVIEW_REQUIRED" ? 400
        : del.code === "FAILED" || del.code === "BACKUP_FAILED" ? 500
        : 409;
      return NextResponse.json({ error: del.message, code: del.code }, { status: st });
    }

    const result = applyBinAction(db, id, body?.action);
    if (result.ok) return NextResponse.json(result.conversation);
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "INVALID_ACTION" ? 400 : 409;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  } catch (err: any) {
    console.error("Error changing conversation state:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

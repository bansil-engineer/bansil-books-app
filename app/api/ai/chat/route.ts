import { NextResponse } from "next/server";
import { getAiDatabase } from "@/app/lib/db/ai-database";
import { evaluateSafetyGate } from "@/app/lib/ai/safety-gate";
import { TOOL_REGISTRY } from "@/app/lib/ai/tool-registry";
import { Role, Message } from "@/app/lib/ai/types";
import { executeCeoOrchestration, handleOwnerMessage } from "@/app/lib/ai/ceo/ceo-orchestrator";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function POST(req: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("ai/chat", "POST"), "ai/chat POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const { message, conversationId } = await req.json();

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const db = getAiDatabase();

    // Create or retrieve conversation
    let currentConvId = conversationId;
    const now = new Date().toISOString();
    const derivedTitle = message.trim().replace(/\s+/g, ' ').substring(0, 40);

    if (!currentConvId) {
      currentConvId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO ai_conversations (id, title, user_identifier, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(currentConvId, derivedTitle, "current-user", now, now);
    } else {
      const existing = db.prepare(`SELECT id, title, status FROM ai_conversations WHERE id = ?`).get(currentConvId) as { id: string, title: string, status?: string } | undefined;
      if (existing && existing.status === "BINNED") {
        return NextResponse.json({ error: "This conversation is in Bin. Restore it before sending messages." }, { status: 409 });
      }
      if (!existing) {
        db.prepare(`
          INSERT INTO ai_conversations (id, title, user_identifier, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(currentConvId, derivedTitle, "current-user", now, now);
      } else {
        if (existing.title === "New Conversation" || !existing.title) {
          db.prepare(`UPDATE ai_conversations SET title = ?, updated_at = ? WHERE id = ?`).run(derivedTitle, now, currentConvId);
        } else {
          db.prepare(`UPDATE ai_conversations SET updated_at = ? WHERE id = ?`).run(now, currentConvId);
        }
      }
    }

    // Generate message ID and store user message
    const userMsgId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO ai_messages (id, conversation_id, role, content, agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userMsgId, currentConvId, "user", message, "CEO", now);

    // Fetch previous messages for context
    const rawMessages = db.prepare(`
      SELECT id, role, content FROM ai_messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(currentConvId) as unknown as Message[];

    let responseText = "";
    let runStatus = "COMPLETED";
    let runId = "";

    try {
      const ceoResult = await handleOwnerMessage(message, rawMessages, {
        conversationId: currentConvId,
        ownerMessageId: userMsgId
      });
      responseText = ceoResult.content;
      runId = ceoResult.runId || "";
    } catch (error: any) {
      console.error("AI CEO Orchestrator error:", error);
      responseText = `Error generating response: ${error.message}`;
      runStatus = "ERROR";
      runId = "";
    }

    // Store CEO Message
    const asstMsgId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO ai_messages (id, conversation_id, role, content, model, agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(asstMsgId, currentConvId, "assistant", responseText, "ceo-orchestrator", "CEO", new Date().toISOString());

    // Fetch actual run status if it exists
    if (runId) {
      const existingRun = db.prepare(`SELECT status FROM ai_runs WHERE id = ?`).get(runId) as any;
      if (existingRun) {
        runStatus = existingRun.status;
      }
    }

    return NextResponse.json({
      response: responseText,
      conversationId: currentConvId,
      runId: runId,
      status: runStatus
    });

  } catch (err: any) {
    console.error("Chat API Error:", err);
    return NextResponse.json({ error: "An unexpected error occurred during execution. Technical details have been securely logged." }, { status: 500 });
  }
}

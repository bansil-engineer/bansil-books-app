import { NextResponse } from "next/server";
import { getAiDatabase } from "@/app/lib/db/ai-database";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

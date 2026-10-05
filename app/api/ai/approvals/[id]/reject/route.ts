import { NextResponse } from "next/server";
import { getAiDatabase } from "@/app/lib/db/ai-database";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

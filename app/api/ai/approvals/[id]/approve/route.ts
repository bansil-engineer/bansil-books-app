import { NextResponse } from "next/server";
import { getAiDatabase } from "@/app/lib/db/ai-database";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    const db = getAiDatabase();
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE ai_approvals
      SET status = 'APPROVED', approved_at = ?, approved_by = 'OWNER'
      WHERE id = ?
    `).run(now, id);

    return NextResponse.json({ success: true, status: "APPROVED" });
  } catch (err: any) {
    console.error("Error approving action:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

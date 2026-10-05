import { NextResponse } from "next/server";
import { getAiDatabase } from "@/app/lib/db/ai-database";
import { getConversation } from "@/app/lib/ai/conversation-bin";

// Read-only metadata for one conversation (lets the UI tell the truth about a binned URL).
// No DELETE handler exists: permanent deletion is intentionally not implemented.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    const conv = getConversation(getAiDatabase(), id);
    if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(conv);
  } catch (err: any) {
    console.error("Error fetching conversation:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

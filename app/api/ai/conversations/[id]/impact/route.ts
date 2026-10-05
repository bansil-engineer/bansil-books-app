import { NextResponse } from "next/server";
import { getAiDatabase } from "@/app/lib/db/ai-database";
import { getDeleteImpact } from "@/app/lib/ai/conversation-bin";

// Read-only impact preview shown BEFORE any permanent deletion. Mutates nothing.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    const impact = getDeleteImpact(getAiDatabase(), id);
    if (!impact) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(impact);
  } catch (err: any) {
    console.error("Error computing delete impact:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getMemory } from "@/app/lib/ai/ceo/memory-store";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const memory = getMemory(id);
    if (!memory) {
      return NextResponse.json({ error: "Memory entry not found." }, { status: 404 });
    }
    return NextResponse.json(memory);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

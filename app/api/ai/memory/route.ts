import { NextRequest, NextResponse } from "next/server";
import {
  listMemories,
  storeOwnerGuidance,
  validateAgainstHardPolicies,
} from "@/app/lib/ai/ceo/memory-store";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") as any;
    const scopeType = searchParams.get("scopeType") as any;
    const memoryType = searchParams.get("memoryType") as any;
    const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined;

    const memories = listMemories({
      status,
      scope_type: scopeType,
      memory_type: memoryType,
    });

    return NextResponse.json({ memories, count: memories.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, content, scopeType, scopeId } = body;

    if (!title || !content) {
      return NextResponse.json(
        { error: "Title and content are required." },
        { status: 400 }
      );
    }

    // Server-side hard policy verification
    validateAgainstHardPolicies(title, content);

    const memory = storeOwnerGuidance(
      title,
      content,
      scopeType || "GLOBAL",
      scopeId || "GLOBAL"
    );

    return NextResponse.json({ success: true, memory });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

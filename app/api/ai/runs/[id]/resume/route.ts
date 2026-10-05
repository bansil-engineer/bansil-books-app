import { NextResponse } from "next/server";
import { resumeRun } from "@/app/lib/ai/ceo/execution-lifecycle";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const run = await resumeRun(id);
    return NextResponse.json({ success: true, run });
  } catch (err: any) {
    console.error("POST /api/ai/runs/[id]/resume error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

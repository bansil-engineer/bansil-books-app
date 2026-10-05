import { NextResponse } from "next/server";
import { listTasksForRun } from "@/app/lib/ai/ceo/task-coordinator";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tasks = listTasksForRun(id);
    return NextResponse.json({
      runId: id,
      count: tasks.length,
      tasks,
    });
  } catch (err: any) {
    console.error("GET /api/ai/runs/[id]/tasks error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

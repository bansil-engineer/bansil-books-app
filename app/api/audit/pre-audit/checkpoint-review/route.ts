import { NextResponse } from "next/server";
import { updateCheckpointHumanReviewStatus } from "../../../../lib/db/audit-database";

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { run_id, checkpoint_key, status, note } = body;

    if (!run_id || !checkpoint_key || !status) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Ensure status is valid
    const validStatuses = ["PENDING HUMAN REVIEW", "HUMAN VERIFIED", "HUMAN ISSUE FOUND"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    updateCheckpointHumanReviewStatus(run_id, checkpoint_key, status, note || null);

    return NextResponse.json({ success: true, message: "Review status updated" });
  } catch (error: any) {
    console.error("Failed to update human review status:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}

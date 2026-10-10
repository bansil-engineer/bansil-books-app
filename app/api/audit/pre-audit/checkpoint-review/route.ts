import { NextResponse } from "next/server";
import { updateCheckpointHumanReviewStatus } from "../../../../lib/db/audit-database";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function PATCH(req: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("audit/pre-audit/checkpoint-review", "PATCH"), "audit/pre-audit/checkpoint-review PATCH");
  if (!rbacGuard.ok) return rbacGuard.response;
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

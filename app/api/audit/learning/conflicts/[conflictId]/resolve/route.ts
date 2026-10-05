import { NextRequest, NextResponse } from "next/server";
import { resolveConflict, LearningError } from "@/app/lib/audit/learning/learning-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

/** Requires an explicit resolution note — a conflict is never silently picked for the owner. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ conflictId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_learning", "audit_feat_learning_rule_conflict_review");
  if (disabled) return disabled;

  try {
    const { conflictId } = await params;
    const body = await req.json();
    if (!body.resolution) return NextResponse.json({ success: false, error: "resolution is required" }, { status: 400 });
    const conflict = resolveConflict(conflictId, body.resolution, OWNER_ACTOR);
    return NextResponse.json({ success: true, conflict });
  } catch (error) {
    if (error instanceof LearningError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to resolve conflict" }, { status: 500 });
  }
}

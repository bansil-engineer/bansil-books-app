import { NextRequest, NextResponse } from "next/server";
import { decideMatchGroup, MatchError, OverAllocationError, AmbiguousDecisionError, type Decision } from "@/app/lib/audit/match-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

const VALID_DECISIONS: Decision[] = ["ACCEPTED", "REJECTED", "HELD", "REVERSED"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string; groupId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_match_review", "audit_feat_reviewer_decisions");
  if (disabled) return disabled;

  try {
    const { groupId } = await params;
    const body = await req.json();
    const decision = body.decision as Decision;
    if (!VALID_DECISIONS.includes(decision)) {
      return NextResponse.json({ success: false, error: `decision must be one of ${VALID_DECISIONS.join(", ")}` }, { status: 400 });
    }
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const group = decideMatchGroup(groupId, decision, OWNER_ACTOR, reason);
    return NextResponse.json({ success: true, group });
  } catch (error) {
    if (error instanceof OverAllocationError || error instanceof AmbiguousDecisionError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    if (error instanceof MatchError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to record decision" }, { status: 500 });
  }
}

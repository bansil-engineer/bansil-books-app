import { NextRequest, NextResponse } from "next/server";
import { getGroupEvidence, MatchError } from "@/app/lib/audit/match-service";
import { requireOwnerSession } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string; groupId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_match_review", "audit_feat_evidence_drillback");
  if (disabled) return disabled;
  try {
    const { groupId } = await params;
    const evidence = getGroupEvidence(groupId);
    return NextResponse.json({ success: true, evidence });
  } catch (error) {
    if (error instanceof MatchError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to load evidence" }, { status: 500 });
  }
}

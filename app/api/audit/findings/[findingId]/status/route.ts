import { NextRequest, NextResponse } from "next/server";
import { setFindingStatus, FindingError, FINDING_STATUSES, type FindingStatus } from "@/app/lib/audit/findings-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ findingId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_findings", "audit_feat_findings_register");
  if (disabled) return disabled;

  try {
    const { findingId } = await params;
    const body = await req.json();
    const status = body.status as FindingStatus;
    if (!FINDING_STATUSES.includes(status)) {
      return NextResponse.json({ success: false, error: `status must be one of ${FINDING_STATUSES.join(", ")}` }, { status: 400 });
    }
    const reviewer = typeof body.reviewer === "string" && body.reviewer.trim() ? body.reviewer : OWNER_ACTOR;
    const comment = typeof body.comment === "string" ? body.comment : undefined;
    const finding = setFindingStatus(findingId, status, reviewer, comment);
    return NextResponse.json({ success: true, finding });
  } catch (error) {
    if (error instanceof FindingError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to set finding status" }, { status: 500 });
  }
}

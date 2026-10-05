import { NextRequest, NextResponse } from "next/server";
import { setFindingConfirmation, FindingError, CONFIRMATION_STATES, type ConfirmationState } from "@/app/lib/audit/findings-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

/**
 * Explicitly promotes/demotes confirmed_vs_suspected. Always requires a
 * named reviewer + reason — never automatic, never inferred.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ findingId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_findings", "audit_feat_reviewer_signoff");
  if (disabled) return disabled;

  try {
    const { findingId } = await params;
    const body = await req.json();
    const confirmedVsSuspected = body.confirmedVsSuspected as ConfirmationState;
    if (!CONFIRMATION_STATES.includes(confirmedVsSuspected)) {
      return NextResponse.json({ success: false, error: `confirmedVsSuspected must be one of ${CONFIRMATION_STATES.join(", ")}` }, { status: 400 });
    }
    const reviewer = typeof body.reviewer === "string" && body.reviewer.trim() ? body.reviewer : OWNER_ACTOR;
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!reason.trim()) {
      return NextResponse.json({ success: false, error: "A reason is required to change confirmed_vs_suspected." }, { status: 400 });
    }
    const finding = setFindingConfirmation(findingId, confirmedVsSuspected, reviewer, reason);
    return NextResponse.json({ success: true, finding });
  } catch (error) {
    if (error instanceof FindingError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to set finding confirmation" }, { status: 500 });
  }
}

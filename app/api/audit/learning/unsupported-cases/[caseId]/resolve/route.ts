import { NextRequest, NextResponse } from "next/server";
import { resolveUnsupportedCase, markUnsupportedCaseResolved, UnsupportedCaseError } from "@/app/lib/audit/learning/unsupported-case-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

/**
 * Body: { resolutionType: "HOLD"|"REQUEST_EVIDENCE"|"ONE_TIME_OVERRIDE"|"PROPOSE_RULE", resolutionRefId? }
 * or { finalize: true } to mark a case RESOLVED once its chosen path has completed.
 * The owner must explicitly choose the path — nothing here defaults silently.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_learning", "audit_feat_learning_unsupported_case_review");
  if (disabled) return disabled;

  try {
    const { caseId } = await params;
    const body = await req.json();
    if (body.finalize === true) {
      const kase = markUnsupportedCaseResolved(caseId, OWNER_ACTOR);
      return NextResponse.json({ success: true, case: kase });
    }
    if (!body.resolutionType) return NextResponse.json({ success: false, error: "resolutionType is required" }, { status: 400 });
    const kase = resolveUnsupportedCase(caseId, body.resolutionType, body.resolutionRefId, OWNER_ACTOR);
    return NextResponse.json({ success: true, case: kase });
  } catch (error) {
    if (error instanceof UnsupportedCaseError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to resolve case" }, { status: 500 });
  }
}

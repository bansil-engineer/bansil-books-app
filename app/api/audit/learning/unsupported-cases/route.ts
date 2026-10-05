import { NextRequest, NextResponse } from "next/server";
import { createUnsupportedCase, listUnsupportedCases, UnsupportedCaseError } from "@/app/lib/audit/learning/unsupported-case-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_learning", "audit_feat_learning_unsupported_case_review");
  if (disabled) return disabled;

  const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? undefined;
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  return NextResponse.json({ success: true, cases: listUnsupportedCases({ workspaceId, status }) });
}

export async function POST(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_learning", "audit_feat_learning_unsupported_case_review");
  if (disabled) return disabled;

  try {
    const body = await req.json();
    const kase = createUnsupportedCase(
      {
        workspaceId: body.workspaceId,
        findingId: body.findingId,
        description: body.description,
        affectedRecordsEstimate: body.affectedRecordsEstimate,
        affectedAmount: body.affectedAmount,
        evidence: body.evidence,
        currentRules: body.currentRules,
        reasonNoSafeDecision: body.reasonNoSafeDecision,
      },
      OWNER_ACTOR
    );
    return NextResponse.json({ success: true, case: kase });
  } catch (error) {
    if (error instanceof UnsupportedCaseError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to create unsupported case" }, { status: 500 });
  }
}

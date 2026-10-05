import { NextRequest, NextResponse } from "next/server";
import { createOverride, listOverrides, OverrideError } from "@/app/lib/audit/learning/override-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_learning", "audit_feat_learning_one_time_overrides");
  if (disabled) return disabled;

  const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? undefined;
  const findingId = req.nextUrl.searchParams.get("findingId") ?? undefined;
  return NextResponse.json({ success: true, overrides: listOverrides({ workspaceId, findingId }) });
}

/** Records a one-time approved override — applies only to the approved case, never edits the rule set, never trains anything automatically. */
export async function POST(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_learning", "audit_feat_learning_one_time_overrides");
  if (disabled) return disabled;

  try {
    const body = await req.json();
    const override = createOverride(
      {
        workspaceId: body.workspaceId,
        findingId: body.findingId,
        unsupportedCaseId: body.unsupportedCaseId,
        targetDescription: body.targetDescription,
        overrideAction: body.overrideAction,
        reviewer: body.reviewer,
        reason: body.reason,
        evidence: body.evidence,
      },
      OWNER_ACTOR
    );
    return NextResponse.json({ success: true, override });
  } catch (error) {
    if (error instanceof OverrideError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to create override" }, { status: 500 });
  }
}

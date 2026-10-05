import { NextRequest, NextResponse } from "next/server";
import { createProposal, listProposals, LearningError } from "@/app/lib/audit/learning/learning-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_learning", "audit_feat_learning_proposals");
  if (disabled) return disabled;

  try {
    const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? undefined;
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const ruleKey = req.nextUrl.searchParams.get("ruleKey") ?? undefined;
    return NextResponse.json({ success: true, proposals: listProposals({ workspaceId, status, ruleKey }) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to load proposals" }, { status: 500 });
  }
}

/**
 * SUGGEST_ONLY: creating a proposal never activates anything. A brand-new
 * rule gets a fresh rule_key; passing an existing ruleKey proposes a
 * replacement version (predecessor tracked automatically).
 */
export async function POST(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_learning", "audit_feat_learning_proposals");
  if (disabled) return disabled;

  try {
    const body = await req.json();
    const proposal = createProposal(
      {
        ruleKey: body.ruleKey,
        proposalType: body.proposalType,
        module: body.module,
        workspaceId: body.workspaceId,
        scopeType: body.scopeType,
        scopeValue: body.scopeValue,
        sourceFormatScope: body.sourceFormatScope,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo,
        ruleConfig: body.ruleConfig,
        title: body.title,
        evidence: body.evidence,
        rationale: body.rationale,
        expectedImpact: body.expectedImpact,
        affectedRecordsEstimate: body.affectedRecordsEstimate,
        expiryDate: body.expiryDate,
        reviewByDate: body.reviewByDate,
      },
      OWNER_ACTOR
    );
    return NextResponse.json({ success: true, proposal });
  } catch (error) {
    if (error instanceof LearningError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to create proposal" }, { status: 500 });
  }
}

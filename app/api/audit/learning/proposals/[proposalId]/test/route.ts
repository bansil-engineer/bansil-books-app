import { NextRequest, NextResponse } from "next/server";
import { runProposalTests, LearningError } from "@/app/lib/audit/learning/learning-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

/** Runs the proposal's declared examples against its own rule config. Never alters an assertion to force a PASS — a failing example stays failing. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ proposalId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_learning", "audit_feat_learning_rule_testing");
  if (disabled) return disabled;

  try {
    const { proposalId } = await params;
    const { proposal, testResults } = runProposalTests(proposalId, OWNER_ACTOR);
    return NextResponse.json({ success: true, proposal, testResults });
  } catch (error) {
    if (error instanceof LearningError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to run tests" }, { status: 500 });
  }
}

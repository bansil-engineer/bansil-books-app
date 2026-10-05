import { NextRequest, NextResponse } from "next/server";
import { getProposal, listRuleHistory, listExamples, listProposalEvents } from "@/app/lib/audit/learning/learning-service";
import { requireOwnerSession } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ proposalId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_learning", "audit_feat_learning_proposals");
  if (disabled) return disabled;

  const { proposalId } = await params;
  const proposal = getProposal(proposalId);
  if (!proposal) return NextResponse.json({ success: false, error: "Proposal not found" }, { status: 404 });

  const history = listRuleHistory(proposal.rule_key);
  const examples = listExamples(proposalId);
  const events = listProposalEvents(proposalId);
  return NextResponse.json({ success: true, proposal, history, examples, events });
}

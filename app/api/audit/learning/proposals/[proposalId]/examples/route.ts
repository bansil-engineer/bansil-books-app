import { NextRequest, NextResponse } from "next/server";
import { addExample, listExamples, LearningError } from "@/app/lib/audit/learning/learning-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ proposalId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_learning", "audit_feat_learning_proposals");
  if (disabled) return disabled;

  const { proposalId } = await params;
  return NextResponse.json({ success: true, examples: listExamples(proposalId) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ proposalId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_learning", "audit_feat_learning_proposals");
  if (disabled) return disabled;

  try {
    const { proposalId } = await params;
    const body = await req.json();
    const proposal = addExample(proposalId, { exampleType: body.exampleType, input: body.input, description: body.description }, OWNER_ACTOR);
    return NextResponse.json({ success: true, proposal });
  } catch (error) {
    if (error instanceof LearningError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to add example" }, { status: 500 });
  }
}

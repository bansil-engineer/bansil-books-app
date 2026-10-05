import { NextRequest, NextResponse } from "next/server";
import {
  submitForApproval,
  approveAndActivate,
  rejectProposal,
  disableProposal,
  archiveProposal,
  rollbackToVersion,
  renewExpiry,
  detectConflicts,
  LearningError,
} from "@/app/lib/audit/learning/learning-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

const VALID_TRANSITIONS = ["submit", "approve", "reject", "disable", "archive", "rollback", "renew_expiry", "detect_conflicts"] as const;
type Transition = (typeof VALID_TRANSITIONS)[number];

// Every privileged transition requires the additional feature key for that specific action, on top of owner session — matching the project-wide "server-side guard for every privileged action" rule.
const FEATURE_KEY_FOR_TRANSITION: Record<Transition, string> = {
  submit: "audit_feat_learning_rule_testing",
  approve: "audit_feat_learning_rule_approval",
  reject: "audit_feat_learning_rule_approval",
  disable: "audit_feat_learning_rule_disable",
  archive: "audit_feat_learning_rule_disable",
  rollback: "audit_feat_learning_rule_rollback",
  renew_expiry: "audit_feat_learning_rule_expiry_review",
  detect_conflicts: "audit_feat_learning_rule_conflict_review",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ proposalId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;

  try {
    const { proposalId } = await params;
    const body = await req.json();
    const transition = body.transition as Transition;
    if (!VALID_TRANSITIONS.includes(transition)) {
      return NextResponse.json({ success: false, error: `transition must be one of ${VALID_TRANSITIONS.join(", ")}` }, { status: 400 });
    }

    const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_learning", FEATURE_KEY_FOR_TRANSITION[transition]);
    if (disabled) return disabled;

    const actor = typeof body.actor === "string" && body.actor.trim() ? body.actor : OWNER_ACTOR;
    let proposal;
    let conflicts;

    switch (transition) {
      case "submit":
        proposal = submitForApproval(proposalId, actor);
        break;
      case "approve": {
        if (!body.approver || !body.reason) {
          return NextResponse.json({ success: false, error: "approver and reason are required to activate a rule" }, { status: 400 });
        }
        proposal = approveAndActivate(proposalId, { approver: body.approver, reason: body.reason, confirmGlobal: body.confirmGlobal === true });
        break;
      }
      case "reject":
        if (!body.reason) return NextResponse.json({ success: false, error: "reason is required to reject a proposal" }, { status: 400 });
        proposal = rejectProposal(proposalId, actor, body.reason);
        break;
      case "disable":
        if (!body.reason) return NextResponse.json({ success: false, error: "reason is required to disable an active rule" }, { status: 400 });
        proposal = disableProposal(proposalId, actor, body.reason);
        break;
      case "archive":
        proposal = archiveProposal(proposalId, actor);
        break;
      case "rollback":
        if (!body.reason) return NextResponse.json({ success: false, error: "reason is required to roll back to a version" }, { status: 400 });
        proposal = rollbackToVersion(proposalId, actor, body.reason);
        break;
      case "renew_expiry":
        proposal = renewExpiry(proposalId, body.newExpiryDate ?? null, body.newReviewByDate ?? null, actor);
        break;
      case "detect_conflicts":
        conflicts = detectConflicts(proposalId);
        break;
    }

    return NextResponse.json({ success: true, proposal, conflicts });
  } catch (error) {
    if (error instanceof LearningError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to transition proposal" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  assignAction,
  markInProgress,
  markWaitingEvidence,
  resolveAction,
  closeAction,
  reopenAction,
  cancelAction,
  addActionEvidence,
  ActionError,
} from "@/app/lib/audit/action-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

const VALID_TRANSITIONS = ["assign", "in_progress", "waiting_evidence", "resolve", "close", "reopen", "cancel", "add_evidence"] as const;
type Transition = (typeof VALID_TRANSITIONS)[number];

/**
 * Single transition endpoint for the Action Taken workflow. `close` is
 * the only transition that may set CLOSED, and action-service.ts's
 * closeAction() is structurally incapable of touching the underlying
 * finding, any match allocation, or any source evidence — see the
 * CRITICAL comments in app/lib/audit/action-service.ts.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ actionId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_findings", "audit_feat_action_taken");
  if (disabled) return disabled;

  try {
    const { actionId } = await params;
    const body = await req.json();
    const transition = body.transition as Transition;
    if (!VALID_TRANSITIONS.includes(transition)) {
      return NextResponse.json({ success: false, error: `transition must be one of ${VALID_TRANSITIONS.join(", ")}` }, { status: 400 });
    }
    const actor = typeof body.actor === "string" && body.actor.trim() ? body.actor : OWNER_ACTOR;
    const comment = typeof body.comment === "string" ? body.comment : undefined;

    let action;
    switch (transition) {
      case "assign":
        action = assignAction(actionId, { actionOwner: body.actionOwner, dueDate: body.dueDate, priority: body.priority, comment }, actor);
        break;
      case "in_progress":
        action = markInProgress(actionId, actor, comment);
        break;
      case "waiting_evidence":
        action = markWaitingEvidence(actionId, actor, comment);
        break;
      case "resolve":
        action = resolveAction(actionId, actor, comment);
        break;
      case "close": {
        const closureComment = typeof body.closureComment === "string" ? body.closureComment : comment;
        if (!closureComment || !closureComment.trim()) {
          return NextResponse.json({ success: false, error: "closureComment is required to close an action." }, { status: 400 });
        }
        action = closeAction(actionId, actor, closureComment);
        break;
      }
      case "reopen": {
        if (!comment || !comment.trim()) {
          return NextResponse.json({ success: false, error: "A reason is required to reopen an action." }, { status: 400 });
        }
        action = reopenAction(actionId, actor, comment);
        break;
      }
      case "cancel":
        action = cancelAction(actionId, actor, comment);
        break;
      case "add_evidence": {
        const evidenceLocators = Array.isArray(body.evidenceLocators) ? body.evidenceLocators.filter((v: unknown) => typeof v === "string") : [];
        if (evidenceLocators.length === 0) {
          return NextResponse.json({ success: false, error: "evidenceLocators must be a non-empty array of strings." }, { status: 400 });
        }
        action = addActionEvidence(actionId, evidenceLocators, actor);
        break;
      }
    }

    return NextResponse.json({ success: true, action });
  } catch (error) {
    if (error instanceof ActionError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to transition action" }, { status: 500 });
  }
}

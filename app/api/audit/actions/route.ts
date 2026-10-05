import { NextRequest, NextResponse } from "next/server";
import { createAction, listActions, listActionsByWorkspace, ActionError } from "@/app/lib/audit/action-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_findings", "audit_feat_action_taken");
  if (disabled) return disabled;

  try {
    const findingId = req.nextUrl.searchParams.get("findingId");
    const workspaceId = req.nextUrl.searchParams.get("workspaceId");
    if (findingId) return NextResponse.json({ success: true, actions: listActions(findingId) });
    if (workspaceId) return NextResponse.json({ success: true, actions: listActionsByWorkspace(workspaceId) });
    return NextResponse.json({ success: false, error: "Either findingId or workspaceId is required" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to load actions" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_findings", "audit_feat_action_taken");
  if (disabled) return disabled;

  try {
    const body = await req.json();
    const action = createAction(
      {
        findingId: body.findingId,
        actionRequired: body.actionRequired,
        actionOwner: body.actionOwner,
        dueDate: body.dueDate,
        priority: body.priority,
      },
      OWNER_ACTOR
    );
    return NextResponse.json({ success: true, action });
  } catch (error) {
    if (error instanceof ActionError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to create action" }, { status: 500 });
  }
}

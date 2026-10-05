import { NextRequest, NextResponse } from "next/server";
import { getAction, listActionEvents } from "@/app/lib/audit/action-service";
import { requireOwnerSession } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ actionId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_findings", "audit_feat_action_taken");
  if (disabled) return disabled;

  const { actionId } = await params;
  const action = getAction(actionId);
  if (!action) return NextResponse.json({ success: false, error: "Action not found" }, { status: 404 });
  const events = listActionEvents(actionId);
  return NextResponse.json({ success: true, action, events });
}

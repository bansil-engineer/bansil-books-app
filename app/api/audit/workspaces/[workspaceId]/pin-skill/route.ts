import { NextRequest, NextResponse } from "next/server";
import { pinWorkspaceSkillVersion, WorkspacePinError } from "@/app/lib/audit/audit-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

// SKILL_ROLLBACK — privileged, owner session required. Pins a workspace to
// an explicit, immutable skill VERSION (used both for the initial pin and
// for a rollback: re-pinning the same workspace to a historical version
// id). See app/lib/audit/audit-service.ts for the immutability guarantee.
export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_workspaces", "sub_settings_skills");
  if (disabled) return disabled;

  try {
    const { workspaceId } = await params;
    const body = await req.json();
    if (typeof body.versionId !== "string" || !body.versionId.trim()) {
      return NextResponse.json({ success: false, error: "versionId is required" }, { status: 400 });
    }

    const workspace = pinWorkspaceSkillVersion(workspaceId, body.versionId.trim(), OWNER_ACTOR);
    return NextResponse.json({ success: true, workspace });
  } catch (error) {
    if (error instanceof WorkspacePinError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to pin workspace skill version" },
      { status: 500 }
    );
  }
}

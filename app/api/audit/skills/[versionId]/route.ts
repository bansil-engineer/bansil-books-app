import { NextRequest, NextResponse } from "next/server";
import { deleteDraftSkillVersion, SkillLifecycleError } from "@/app/lib/audit/audit-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

// SKILL_UPLOAD-adjacent cleanup — privileged, owner session required.
// Deletes an unused DRAFT skill version only. Anything that has left DRAFT
// (validated, tested, approved, activated, or bound to a module) must be
// retired via the ARCHIVE transition instead — this route refuses those.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_settings_skills");
  if (disabled) return disabled;

  try {
    const { versionId } = await params;
    deleteDraftSkillVersion(versionId, OWNER_ACTOR);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SkillLifecycleError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to delete draft skill version" },
      { status: 500 }
    );
  }
}

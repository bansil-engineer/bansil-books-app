import { NextRequest, NextResponse } from "next/server";
import { transitionSkillVersion, SkillLifecycleError } from "@/app/lib/audit/audit-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

const VALID_ACTIONS = ["VALIDATE", "MARK_TESTED", "SUBMIT_FOR_APPROVAL", "APPROVE_AND_ACTIVATE", "DEACTIVATE", "ARCHIVE"];

// SKILL_VALIDATE / SKILL_TEST / SKILL_SUBMIT_APPROVAL / SKILL_APPROVE_ACTIVATE /
// SKILL_DEACTIVATE / SKILL_ARCHIVE — every lifecycle action here is
// privileged; the owner session gate applies uniformly regardless of
// which action is requested.
export async function POST(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_settings_skills");
  if (disabled) return disabled;

  try {
    const { versionId } = await params;
    const body = await req.json();

    if (!VALID_ACTIONS.includes(body.action)) {
      return NextResponse.json(
        { success: false, error: `action must be one of ${VALID_ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }

    // The reviewer identity is always the authenticated OWNER session,
    // never whatever `actor` string a client might send.
    const version = transitionSkillVersion(versionId, body.action, OWNER_ACTOR, body.moduleScope);
    return NextResponse.json({ success: true, version });
  } catch (error) {
    if (error instanceof SkillLifecycleError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to transition skill version" },
      { status: 500 }
    );
  }
}

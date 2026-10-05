import { NextResponse } from "next/server";
import { listSkills, listSkillVersions } from "@/app/lib/audit/audit-service";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_settings_skills");
  if (disabled) return disabled;
  try {
    const skills = listSkills().map((skill) => ({
      ...skill,
      versions: listSkillVersions(skill.skill_id).map((v) => ({
        ...v,
        guard_reasons: JSON.parse(v.guard_reasons_json || "[]"),
      })),
    }));
    return NextResponse.json({ success: true, skills });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load skills registry" },
      { status: 500 }
    );
  }
}

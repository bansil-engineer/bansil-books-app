import { NextResponse } from "next/server";
import { listSkills, listSkillVersions } from "@/app/lib/audit/audit-service";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/skills", "GET"), "audit/skills GET");
  if (!rbacGuard.ok) return rbacGuard.response;
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

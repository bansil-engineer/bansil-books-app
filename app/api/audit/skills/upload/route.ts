import { NextRequest, NextResponse } from "next/server";
import { uploadSkillDraft } from "@/app/lib/audit/audit-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

const MAX_PACKAGE_BYTES = 15 * 1024 * 1024;

// SKILL_UPLOAD — privileged, owner session required. Imports a Skill
// package as an immutable DRAFT version only. The uploaded ZIP is
// inspected for a filename/content preview and scanned by the static
// content guard (app/lib/audit/skill-guard.ts) — it is NEVER executed,
// require()'d, or unzipped to disk here or anywhere else in this route.
export async function POST(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_settings_skills");
  if (disabled) return disabled;

  try {
    const form = await req.formData();
    const file = form.get("package");
    const skillName = form.get("skillName");
    const moduleScope = form.get("moduleScope");
    const version = form.get("version");
    const description = form.get("description");

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "package file is required" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json({ success: false, error: "Only .zip Skill packages are accepted" }, { status: 400 });
    }
    if (file.size > MAX_PACKAGE_BYTES) {
      return NextResponse.json(
        { success: false, error: `Package exceeds ${MAX_PACKAGE_BYTES / (1024 * 1024)}MB limit` },
        { status: 400 }
      );
    }
    if (typeof skillName !== "string" || !skillName.trim()) {
      return NextResponse.json({ success: false, error: "skillName is required" }, { status: 400 });
    }
    if (typeof moduleScope !== "string" || !moduleScope.trim()) {
      return NextResponse.json({ success: false, error: "moduleScope is required" }, { status: 400 });
    }
    if (typeof version !== "string" || !version.trim()) {
      return NextResponse.json({ success: false, error: "version is required" }, { status: 400 });
    }

    const packageBuffer = Buffer.from(await file.arrayBuffer());

    let result;
    try {
      result = uploadSkillDraft({
        skillName: skillName.trim(),
        moduleScope: moduleScope.trim(),
        description: typeof description === "string" ? description : undefined,
        version: version.trim(),
        packageFilename: file.name,
        packageBuffer,
        createdBy: OWNER_ACTOR, // never a client-supplied identity string
      });
    } catch (zipError) {
      return NextResponse.json(
        {
          success: false,
          error:
            zipError instanceof Error
              ? `Package could not be read as a ZIP archive: ${zipError.message}`
              : "Package could not be read as a ZIP archive",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      skill: result.skill,
      version: { ...result.version, guard_reasons: JSON.parse(result.version.guard_reasons_json || "[]") },
      guard: result.guard,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to import skill package" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { listModuleSkillBindings } from "@/app/lib/audit/audit-service";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/bindings", "GET"), "audit/bindings GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_settings_skills");
  if (disabled) return disabled;
  try {
    const bindings = listModuleSkillBindings();
    return NextResponse.json({ success: true, bindings });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load module skill bindings" },
      { status: 500 }
    );
  }
}

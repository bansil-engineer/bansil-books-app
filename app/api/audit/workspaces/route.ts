import { NextRequest, NextResponse } from "next/server";
import { createWorkspace, listWorkspaces, getWorkspaceSources, type ComparisonMode } from "@/app/lib/audit/audit-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

const VALID_MODES: ComparisonMode[] = ["INTERNAL_EXTERNAL", "EXTERNAL_EXTERNAL", "INTERNAL_INTERNAL"];

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/workspaces", "GET"), "audit/workspaces GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_workspaces");
  if (disabled) return disabled;

  try {
    const workspaces = listWorkspaces().map((w) => ({
      ...w,
      sources: getWorkspaceSources(w.workspace_id),
    }));
    return NextResponse.json({ success: true, workspaces });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load audit workspaces" },
      { status: 500 }
    );
  }
}

// AUDIT_WORKSPACE_CREATE — privileged, owner session required.
export async function POST(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_workspaces");
  if (disabled) return disabled;

  try {
    const body = await req.json();

    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ success: false, error: "name is required" }, { status: 400 });
    }
    if (!VALID_MODES.includes(body.comparisonMode)) {
      return NextResponse.json(
        { success: false, error: `comparisonMode must be one of ${VALID_MODES.join(", ")}` },
        { status: 400 }
      );
    }
    if (!Array.isArray(body.sources)) {
      return NextResponse.json({ success: false, error: "sources[] is required (may be empty)" }, { status: 400 });
    }

    const workspace = createWorkspace({
      name: body.name,
      comparisonMode: body.comparisonMode,
      purpose: body.purpose,
      entityId: body.entityId,
      entityName: body.entityName,
      periodFrom: body.periodFrom,
      periodTo: body.periodTo,
      amountBasis: body.amountBasis,
      createdBy: OWNER_ACTOR, // never a client-supplied identity string
      sources: body.sources,
    });

    return NextResponse.json({ success: true, workspace });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create audit workspace" },
      { status: 500 }
    );
  }
}

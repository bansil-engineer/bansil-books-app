import { NextRequest, NextResponse } from "next/server";
import { addWorkspaceSource } from "@/app/lib/audit/audit-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

// AUDIT_WORKSPACE_CREATE-adjacent — privileged, owner session required.
export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_uploads");
  if (disabled) return disabled;

  try {
    const { workspaceId } = await params;
    const body = await req.json();
    if (typeof body.roleLabel !== "string" || !body.roleLabel.trim()) {
      return NextResponse.json({ success: false, error: "roleLabel is required" }, { status: 400 });
    }
    if (body.sourceOrigin !== "INTERNAL" && body.sourceOrigin !== "EXTERNAL") {
      return NextResponse.json({ success: false, error: "sourceOrigin must be INTERNAL or EXTERNAL" }, { status: 400 });
    }

    const source = addWorkspaceSource(
      workspaceId,
      {
        roleLabel: body.roleLabel,
        sourceOrigin: body.sourceOrigin,
        originDescription: body.originDescription,
        provenance: body.provenance,
        sourceVersionRef: body.sourceVersionRef,
        basisNote: body.basisNote,
        notes: body.notes,
      },
      OWNER_ACTOR
    );
    return NextResponse.json({ success: true, source });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to add workspace source" },
      { status: 500 }
    );
  }
}

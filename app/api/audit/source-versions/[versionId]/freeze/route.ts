import { NextRequest, NextResponse } from "next/server";
import { freezeSourceVersion, IntakeError } from "@/app/lib/audit/intake-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_uploads", "audit_feat_frozen_snapshots");
  if (disabled) return disabled;

  try {
    const { versionId } = await params;
    freezeSourceVersion(versionId, OWNER_ACTOR);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof IntakeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to freeze source version" },
      { status: 500 }
    );
  }
}

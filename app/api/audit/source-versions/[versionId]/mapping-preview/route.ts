import { NextRequest, NextResponse } from "next/server";
import { getMappingPreview, IntakeError } from "@/app/lib/audit/intake-service";
import { requireOwnerSession } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_uploads", "audit_feat_source_mapping");
  if (disabled) return disabled;

  try {
    const { versionId } = await params;
    const preview = getMappingPreview(versionId);
    return NextResponse.json({ success: true, preview });
  } catch (error) {
    if (error instanceof IntakeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load mapping preview" },
      { status: 500 }
    );
  }
}

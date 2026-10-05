import { NextRequest, NextResponse } from "next/server";
import { getRawRowsPreview, IntakeError } from "@/app/lib/audit/intake-service";
import { requireOwnerSession } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

// Feeds the owner's header/data-start row picker — every physical row,
// completely unheadered. Never guesses which row is the header.
export async function GET(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_uploads", "audit_feat_source_mapping");
  if (disabled) return disabled;

  try {
    const { versionId } = await params;
    const preview = getRawRowsPreview(versionId, 30);
    return NextResponse.json({ success: true, preview });
  } catch (error) {
    if (error instanceof IntakeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load raw rows preview" },
      { status: 500 }
    );
  }
}

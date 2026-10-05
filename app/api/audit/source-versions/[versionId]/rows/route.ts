import { NextRequest, NextResponse } from "next/server";
import { getNormalizedRows } from "@/app/lib/audit/intake-service";
import { requireOwnerSession } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

// Evidence drill-back: read-only, but still gated — normalized rows can
// contain accounting figures, so this is not left open like the pure
// summary/list endpoints.
export async function GET(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_uploads", "audit_feat_evidence_drillback");
  if (disabled) return disabled;

  try {
    const { versionId } = await params;
    const rows = getNormalizedRows(versionId, 500).map((r) => ({
      ...r,
      raw: JSON.parse((r as { raw_json: string }).raw_json),
      normalized: JSON.parse((r as { normalized_json: string }).normalized_json),
    }));
    return NextResponse.json({ success: true, rows });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load normalized rows" },
      { status: 500 }
    );
  }
}

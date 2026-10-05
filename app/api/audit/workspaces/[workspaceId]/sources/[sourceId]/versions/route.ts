import { NextRequest, NextResponse } from "next/server";
import { listSourceVersions } from "@/app/lib/audit/intake-service";
import { requireOwnerSession } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_uploads");
  if (disabled) return disabled;

  try {
    const { sourceId } = await params;
    const versions = listSourceVersions(sourceId);
    return NextResponse.json({ success: true, versions });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to list source versions" },
      { status: 500 }
    );
  }
}

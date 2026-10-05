import { NextRequest, NextResponse } from "next/server";
import { computeCompleteness, IntakeError } from "@/app/lib/audit/intake-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_uploads", "audit_feat_completeness_controls");
  if (disabled) return disabled;

  try {
    const { versionId } = await params;
    const body = await req.json().catch(() => ({}));
    const check = computeCompleteness(
      versionId,
      {
        openingBalance: typeof body.openingBalance === "number" ? body.openingBalance : undefined,
        closingBalance: typeof body.closingBalance === "number" ? body.closingBalance : undefined,
      },
      OWNER_ACTOR
    );
    return NextResponse.json({ success: true, check });
  } catch (error) {
    if (error instanceof IntakeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Completeness check failed" },
      { status: 500 }
    );
  }
}

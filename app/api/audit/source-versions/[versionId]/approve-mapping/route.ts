import { NextRequest, NextResponse } from "next/server";
import { approveSourceMapping, IntakeError, HeaderAmbiguousError } from "@/app/lib/audit/intake-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_uploads", "audit_feat_source_mapping");
  if (disabled) return disabled;

  try {
    const { versionId } = await params;
    const body = await req.json();
    if (typeof body.fieldMap !== "object" || body.fieldMap === null) {
      return NextResponse.json({ success: false, error: "fieldMap object is required" }, { status: 400 });
    }

    approveSourceMapping(
      versionId,
      {
        fieldMap: body.fieldMap,
        amountBasis: body.amountBasis,
        debitCreditPerspective: body.debitCreditPerspective,
        dateFormatNote: body.dateFormatNote,
        warnings: body.warnings,
        headerRowNumber: typeof body.headerRowNumber === "number" ? body.headerRowNumber : undefined,
        dataStartRowNumber: typeof body.dataStartRowNumber === "number" ? body.dataStartRowNumber : undefined,
        acknowledgeAmbiguousHeader: body.acknowledgeAmbiguousHeader === true,
      },
      OWNER_ACTOR
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof HeaderAmbiguousError) {
      return NextResponse.json({ success: false, error: error.message, reasons: error.reasons, needsReview: true }, { status: 409 });
    }
    if (error instanceof IntakeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to approve mapping" },
      { status: 500 }
    );
  }
}

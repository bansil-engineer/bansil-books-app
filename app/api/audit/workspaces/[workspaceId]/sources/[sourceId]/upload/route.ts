import { NextRequest, NextResponse } from "next/server";
import { addWorkspaceSourceFile, IntakeError } from "@/app/lib/audit/intake-service";
import { detectFileType } from "@/app/lib/audit/intake/file-storage";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

const FILE_TYPE_FEATURE_KEY: Record<string, string> = {
  PDF: "audit_feat_pdf_intake",
  XLSX: "audit_feat_xlsx_intake",
  CSV: "audit_feat_csv_intake",
};

// Evidence intake — privileged, owner session required. Accepts .pdf/.xlsx/.csv
// only; the uploaded bytes are stored immutably and are never executed.
export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string; sourceId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_uploads");
  if (disabled) return disabled;

  try {
    const { sourceId } = await params;
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "file is required" }, { status: 400 });
    }

    const fileType = detectFileType(file.name);
    if (fileType && FILE_TYPE_FEATURE_KEY[fileType]) {
      const typeDisabled = requireAuditFeaturesEnabled(FILE_TYPE_FEATURE_KEY[fileType]);
      if (typeDisabled) return typeDisabled;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = addWorkspaceSourceFile(sourceId, file.name, buffer, OWNER_ACTOR);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof IntakeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
}

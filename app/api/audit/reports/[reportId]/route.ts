import { NextRequest, NextResponse } from "next/server";
import { getReport, setReportStatus, ReportError, REPORT_STATUSES, type ReportStatus } from "@/app/lib/audit/report-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_reports");
  if (disabled) return disabled;

  const { reportId } = await params;
  const report = getReport(reportId);
  if (!report) return NextResponse.json({ success: false, error: "Report not found" }, { status: 404 });
  return NextResponse.json({ success: true, report });
}

/**
 * Lifecycle transition only — DRAFT/UNDER_REVIEW/REVIEWED/ISSUED_INTERNAL/
 * SUPERSEDED. Never touches any snapshot column; never CERTIFIED/AUDITED/
 * CA SIGNED — this app produces an internal review working paper only.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_reports", "audit_feat_reviewer_signoff");
  if (disabled) return disabled;

  try {
    const { reportId } = await params;
    const body = await req.json();
    const status = body.status as ReportStatus;
    if (!REPORT_STATUSES.includes(status)) {
      return NextResponse.json({ success: false, error: `status must be one of ${REPORT_STATUSES.join(", ")}` }, { status: 400 });
    }
    const reviewer = typeof body.reviewer === "string" && body.reviewer.trim() ? body.reviewer : OWNER_ACTOR;
    const comment = typeof body.comment === "string" ? body.comment : undefined;
    const report = setReportStatus(reportId, status, reviewer, comment);
    return NextResponse.json({ success: true, report });
  } catch (error) {
    if (error instanceof ReportError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to update report status" }, { status: 500 });
  }
}

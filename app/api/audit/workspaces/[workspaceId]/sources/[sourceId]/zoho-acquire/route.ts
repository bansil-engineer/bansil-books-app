import { NextRequest, NextResponse } from "next/server";
import { acquireZohoAccountingSource, createZohoSourceVersion, type AuditZohoReportType } from "@/app/lib/audit/zoho-audit-adapter";
import { getBooksSourceSummary } from "@/app/lib/audit/books-source-adapter";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

const VALID_REPORT_TYPES: AuditZohoReportType[] = ["sales_invoices", "purchase_bills"];

// EXPLICIT OWNER ACTION ONLY — this is the one route in Milestone B that
// calls the live Zoho API. It is never invoked by a page open, filter,
// search, row click, or export. READ-only (GET) — see zoho-audit-adapter.ts.
// Feature-gated FIRST, before any Zoho call is even attempted: if
// audit_feat_zoho_sources (or a parent) is OFF, this returns 403 without
// touching the network.
export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string; sourceId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_uploads", "audit_feat_zoho_sources");
  if (disabled) return disabled;

  try {
    const { workspaceId, sourceId } = await params;
    const body = await req.json();

    if (!VALID_REPORT_TYPES.includes(body.reportType)) {
      return NextResponse.json({ success: false, error: `reportType must be one of ${VALID_REPORT_TYPES.join(", ")}` }, { status: 400 });
    }
    if (typeof body.periodFrom !== "string" || typeof body.periodTo !== "string") {
      return NextResponse.json({ success: false, error: "periodFrom and periodTo (YYYY-MM-DD) are required" }, { status: 400 });
    }

    let organizationId = typeof body.organizationId === "string" ? body.organizationId : undefined;
    if (!organizationId) {
      const summary = getBooksSourceSummary();
      organizationId = summary.organizationId ?? undefined;
    }
    if (!organizationId) {
      return NextResponse.json({ success: false, error: "No organization_id available — connect Zoho or supply organizationId" }, { status: 400 });
    }

    const acquisition = await acquireZohoAccountingSource(
      workspaceId,
      sourceId,
      organizationId,
      body.reportType,
      body.periodFrom,
      body.periodTo,
      OWNER_ACTOR
    );

    let versionId: string | null = null;
    if (acquisition.status === "SUCCESS") {
      versionId = createZohoSourceVersion(sourceId, acquisition, body.reportType, OWNER_ACTOR);
    }

    return NextResponse.json({
      success: true,
      versionId,
      acquisitionId: acquisition.acquisitionId,
      status: acquisition.status,
      coverageStatus: acquisition.coverageStatus,
      recordCount: acquisition.recordCount,
      pageCount: acquisition.pageCount,
      apiCallCount: acquisition.apiCallCount,
      firstRecordDate: acquisition.firstRecordDate,
      lastRecordDate: acquisition.lastRecordDate,
      error: acquisition.error,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Zoho acquisition failed" },
      { status: 500 }
    );
  }
}

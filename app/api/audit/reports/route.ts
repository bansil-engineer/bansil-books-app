import { NextRequest, NextResponse } from "next/server";
import { generateReport, listReports, ReportError } from "@/app/lib/audit/report-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_reports");
  if (disabled) return disabled;

  try {
    const workspaceId = req.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ success: false, error: "workspaceId is required" }, { status: 400 });
    return NextResponse.json({ success: true, reports: listReports(workspaceId) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to load reports" }, { status: 500 });
  }
}

/**
 * Generates a NEW immutable report version from the current state of
 * domain reviews, findings, actions, and reviewer decisions. Never
 * reruns matching/AI/Zoho/file parsing — see report-service.ts.
 */
export async function POST(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_reports");
  if (disabled) return disabled;

  try {
    const body = await req.json();
    const report = generateReport(
      {
        workspaceId: body.workspaceId,
        runId: body.runId,
        entityName: body.entityName,
        periodFrom: body.periodFrom,
        periodTo: body.periodTo,
        purpose: body.purpose,
        comparisonModes: body.comparisonModes,
        assumptions: body.assumptions,
        limitations: body.limitations,
        exclusions: body.exclusions,
      },
      OWNER_ACTOR
    );
    return NextResponse.json({ success: true, report });
  } catch (error) {
    if (error instanceof ReportError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to generate report" }, { status: 500 });
  }
}

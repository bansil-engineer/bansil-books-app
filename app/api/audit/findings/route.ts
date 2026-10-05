import { NextRequest, NextResponse } from "next/server";
import { createFinding, listFindings, FindingError, type Severity, type FindingType } from "@/app/lib/audit/findings-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_findings", "audit_feat_findings_register");
  if (disabled) return disabled;

  try {
    const workspaceId = req.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ success: false, error: "workspaceId is required" }, { status: 400 });

    const domain = req.nextUrl.searchParams.get("domain") ?? undefined;
    const severity = req.nextUrl.searchParams.get("severity") ?? undefined;
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const findings = listFindings(workspaceId, { domain, severity, status });
    return NextResponse.json({ success: true, findings });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to load findings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_findings", "audit_feat_findings_register");
  if (disabled) return disabled;

  try {
    const body = await req.json();
    const finding = createFinding(
      {
        workspaceId: body.workspaceId,
        runId: body.runId,
        domainReviewId: body.domainReviewId,
        domain: body.domain,
        severity: body.severity as Severity,
        findingType: body.findingType as FindingType,
        title: body.title,
        description: body.description,
        confirmedVsSuspected: body.confirmedVsSuspected,
        financialImpact: body.financialImpact,
        quantityImpact: body.quantityImpact,
        currency: body.currency,
        unit: body.unit,
        affectedRefs: body.affectedRefs,
        evidenceRefs: body.evidenceRefs,
        sourceSnapshot: body.sourceSnapshot,
        ruleVersion: body.ruleVersion,
      },
      OWNER_ACTOR
    );
    return NextResponse.json({ success: true, finding });
  } catch (error) {
    if (error instanceof FindingError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to create finding" }, { status: 500 });
  }
}

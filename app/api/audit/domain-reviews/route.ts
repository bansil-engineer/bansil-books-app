import { NextRequest, NextResponse } from "next/server";
import { recordDomainReview, listDomainReviews, getCoverageMatrix, DomainReviewError, type DomainStatus, type ReviewDomain } from "@/app/lib/audit/domain-review-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_findings", "audit_feat_coverage_matrix");
  if (disabled) return disabled;

  try {
    const workspaceId = req.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ success: false, error: "workspaceId is required" }, { status: 400 });

    const view = req.nextUrl.searchParams.get("view");
    if (view === "matrix") {
      return NextResponse.json({ success: true, coverage: getCoverageMatrix(workspaceId) });
    }
    return NextResponse.json({ success: true, reviews: listDomainReviews(workspaceId) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to load domain reviews" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_findings", "audit_feat_domain_review");
  if (disabled) return disabled;

  try {
    const body = await req.json();
    const review = recordDomainReview(
      {
        workspaceId: body.workspaceId,
        runId: body.runId,
        domain: body.domain as ReviewDomain,
        entityName: body.entityName,
        periodFrom: body.periodFrom,
        periodTo: body.periodTo,
        sourceSnapshotIds: body.sourceSnapshotIds,
        sourceCoverageNote: body.sourceCoverageNote,
        testsPerformed: body.testsPerformed,
        matchedAmount: body.matchedAmount,
        matchedCount: body.matchedCount,
        unresolvedAmount: body.unresolvedAmount,
        unresolvedCount: body.unresolvedCount,
        exceptionCount: body.exceptionCount,
        limitations: body.limitations,
        status: body.status as DomainStatus,
      },
      OWNER_ACTOR
    );
    return NextResponse.json({ success: true, review });
  } catch (error) {
    if (error instanceof DomainReviewError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to record domain review" }, { status: 500 });
  }
}

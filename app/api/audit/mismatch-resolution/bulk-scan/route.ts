import { NextRequest, NextResponse } from "next/server";
import { getDatabase as getMainDatabase } from "../../../../lib/db/database";
import { getAuditDatabase } from "../../../../lib/db/audit-database";
import { requireFeaturesEnabled } from "../../../../lib/feature-guard";
import { buildBulkMismatchResolutionContext } from "../../../../lib/audit/mismatch-resolution/candidate-query";
import { suggestBulkResolutionsWithConflictDetection } from "../../../../lib/audit/mismatch-resolution/mismatch-suggestion-engine";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function POST(request: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/mismatch-resolution/bulk-scan", "POST"), "audit/mismatch-resolution/bulk-scan POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  const disabled = requireFeaturesEnabled("module_audit_workspace", "sub_mismatch_resolution", "mismatch_feat_intelligent_suggestions");
  if (disabled) return disabled;

  try {
    const body = await request.json();
    const { customerId, period, financialYear, fromDate, toDate } = body;

    if (!customerId) {
      return NextResponse.json({ error: "customerId is required" }, { status: 400 });
    }

    const mainDb = getMainDatabase();
    const auditDb = getAuditDatabase();

    const bulkContextResult = buildBulkMismatchResolutionContext(mainDb, auditDb, {
      customerId,
      period,
      financialYear,
      fromDate,
      toDate,
    });

    if (!bulkContextResult.ok) {
      return NextResponse.json({ error: bulkContextResult.error }, { status: 400 });
    }

    const shortageItems = bulkContextResult.contexts.map((ctx) => ctx.mismatchItem);
    const surplusCandidatesByMismatch = new Map();
    bulkContextResult.contexts.forEach((ctx) => {
      let fullCandidates = [...ctx.candidates];
      if (ctx.bomComponents && ctx.bomComponents.length > 0) {
        const bomItemIds = new Set(ctx.bomComponents.map(c => c.itemId));
        fullCandidates = fullCandidates.filter(c => !bomItemIds.has(c.itemId));
        fullCandidates.push(...ctx.bomComponents);
      }
      surplusCandidatesByMismatch.set(ctx.mismatchItem.itemId, fullCandidates);
    });

    const suggestions = suggestBulkResolutionsWithConflictDetection(shortageItems, surplusCandidatesByMismatch);

    return NextResponse.json({
      success: true,
      reportSummary: bulkContextResult.contexts.length > 0 ? bulkContextResult.contexts[0].reportSummary : null,
      suggestions,
    });
  } catch (error) {
    console.error("Bulk mismatch resolution error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

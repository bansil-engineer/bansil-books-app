// ============================================================
// Bansil Books Analytics — Intelligent Inventory Mismatch Resolution
// Assistant: Suggest Endpoint (Phase 2, read-only).
//
// POST only. Resolves the candidate set from the CANONICAL Customer
// Material Control report (never trusts client-supplied candidate rows
// as truth). No DB write. No Zoho call. No AI call. Returns a
// suggestion for OWNER review only — nothing here is ever auto-applied.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/app/lib/db/database";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";
import { buildMismatchResolutionContext } from "@/app/lib/audit/mismatch-resolution/candidate-query";
import { suggestResolution, suggestBomResolution } from "@/app/lib/audit/mismatch-resolution/mismatch-suggestion-engine";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("audit/mismatch-resolution/suggest", "POST"), "audit/mismatch-resolution/suggest POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  const disabled = requireFeaturesEnabled("module_audit_workspace", "sub_mismatch_resolution", "mismatch_feat_intelligent_suggestions");
  if (disabled) return disabled;

  let body: {
    customerId?: unknown;
    itemId?: unknown;
    period?: unknown;
    financialYear?: unknown;
    fromDate?: unknown;
    toDate?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const customerId = typeof body.customerId === "string" ? body.customerId.trim() : "";
  const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
  if (!customerId || !itemId) {
    return NextResponse.json({ success: false, error: "customerId and itemId are required." }, { status: 400 });
  }

  const period = typeof body.period === "string" ? body.period : undefined;
  const financialYear = typeof body.financialYear === "string" ? body.financialYear : undefined;
  const fromDate = typeof body.fromDate === "string" ? body.fromDate : undefined;
  const toDate = typeof body.toDate === "string" ? body.toDate : undefined;

  try {
    const mainDb = getDatabase();
    const auditDb = getAuditDatabase();

    const result = buildMismatchResolutionContext(mainDb, auditDb, {
      customerId,
      itemId,
      period,
      financialYear,
      fromDate,
      toDate,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: 404 });
    }

    const { mismatchItem, candidates, bomComponents, reportSummary } = result.context;

    const bomAllowed = bomComponents && bomComponents.length > 0 && (await featureAllowed("mismatch_feat_bom_resolution"));
    const groupedAllowed = await featureAllowed("mismatch_feat_grouped_resolution");

    const suggestion = bomAllowed
      ? suggestBomResolution(mismatchItem, bomComponents!)
      : suggestResolution(mismatchItem, groupedAllowed ? candidates : []);

    // Coverage percentage — never forced, derived from matched vs expected.
    const coveragePct = suggestion.expectedQty > 0
      ? Math.round((suggestion.matchedQty / suggestion.expectedQty) * 10000) / 100
      : 0;

    return NextResponse.json({
      success: true,
      reportSummary,
      mismatchItem,
      candidateCount: candidates.length,
      bomAvailable: Boolean(bomComponents && bomComponents.length > 0),
      suggestion: {
        ...suggestion,
        coveragePct,
      },
    });
  } catch (error) {
    console.error("Mismatch resolution suggest API error:", error);
    return NextResponse.json({ success: false, error: "Failed to build mismatch resolution suggestion." }, { status: 500 });
  }
}

/** Local helper — a sub-capability OFF degrades that suggestion path
 *  (never crashes the whole request); the top-level
 *  requireFeaturesEnabled() above already gates the endpoint. */
async function featureAllowed(key: string): Promise<boolean> {
  const { featureEnabled } = await import("@/app/lib/feature-guard");
  return featureEnabled(key);
}

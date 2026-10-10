// ============================================================
// Bansil Books Analytics — Price Reference API Route
// Serves historical Purchase and Sales price analytics & evidence from Local SQLite
// STRICTLY READ-ONLY · ZERO ZOHO API CALLS
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getPriceReferenceData } from "@/app/lib/price-reference-engine";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("price-reference", "GET"), "price-reference GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const disabled = requireFeaturesEnabled("module_reports", "sub_rep_price_reference");
  if (disabled) return disabled;
  try {
    const { searchParams } = new URL(request.url);
    const financialYear = searchParams.get("financialYear") || "2026-27";
    const fromDate = searchParams.get("fromDate") || undefined;
    const toDate = searchParams.get("toDate") || undefined;
    const priceType = (searchParams.get("priceType") || "ALL").toUpperCase() as "PURCHASE" | "SALES" | "ALL";
    const itemId = searchParams.get("itemId") || undefined;
    const sku = searchParams.get("sku") || undefined;
    const customerId = searchParams.get("customerId") || undefined;
    const vendorId = searchParams.get("vendorId") || undefined;
    const priceFilter = (searchParams.get("priceFilter") || "ALL").toUpperCase() as "ALL" | "LOWEST" | "HIGHEST" | "LATEST";
    const search = searchParams.get("search") || undefined;
    const sort = (searchParams.get("sort") || "NEWEST").toUpperCase() as "NEWEST" | "OLDEST" | "PRICE_DESC" | "PRICE_ASC" | "QTY_DESC";

    const result = getPriceReferenceData({
      financialYear,
      fromDate,
      toDate,
      priceType,
      itemId,
      sku,
      customerId,
      vendorId,
      priceFilter,
      search,
      sort,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load price reference data";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

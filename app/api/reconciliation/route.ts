// ============================================================
// Bansil Books Analytics — Reconciliation Report Data API Route
// Common Calculation Engine for Screen UI
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { generateReconciliationReport } from "@/app/lib/reconciliation-engine";
import type { ReconciliationFilter } from "@/app/types/reconciliation";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";

export const dynamic = "force-dynamic";

// Shared by Dashboard + Reconciliation + Reports (see
// PROJECT_FEATURE_CONTROLS.md consumer matrix) — same exclusive-vs-
// ambiguous distinction as /api/inventory-mismatch. `operationalTab`
// is not itself used to filter this route's output, but its presence
// is still a reliable signal of which single sub_recon_* leaf is
// calling (set only by reconciliation-view.tsx's sidebarSection-sync
// effect), so it is still worth gating on.
const EXCLUSIVE_OPERATIONAL_TAB_FEATURE: Record<string, string> = {
  BALANCE: "sub_recon_balance",
  YET_TO_PURCHASE: "sub_recon_yet_to_purchase",
  YET_TO_SALE: "sub_recon_yet_to_sale",
  PURCHASE_ONLY: "sub_recon_purchase_only",
  SALE_ONLY: "sub_recon_sale_only",
  RECONCILED: "sub_recon_reconciled",
  MISSING_CUSTOMER: "sub_recon_customer_missing",
};

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;

    const operationalTabParam = sp.get("operationalTab");
    const exclusiveKey = operationalTabParam ? EXCLUSIVE_OPERATIONAL_TAB_FEATURE[operationalTabParam] : undefined;
    if (exclusiveKey) {
      const disabled = requireFeaturesEnabled("module_reconciliation", exclusiveKey);
      if (disabled) return disabled;
    }

    const filter: ReconciliationFilter = {
      financialYear: sp.get("financialYear") || "2025-26",
      fromDate: sp.get("fromDate") || undefined,
      toDate: sp.get("toDate") || undefined,
      period: sp.get("period") || undefined,
      customerId: sp.get("customerId") || undefined,
      customerName: sp.get("customerName") || undefined,
      itemId: sp.get("itemId") || undefined,
      itemName: sp.get("itemName") || undefined,
      sku: sp.get("sku") || undefined,
      vendorName: sp.get("vendorName") || undefined,
      search: sp.get("search") || undefined,
      status: sp.get("status") || undefined,
    };

    const report = generateReconciliationReport(filter);
    return NextResponse.json(report);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to generate report";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

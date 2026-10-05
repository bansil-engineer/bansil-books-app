// ============================================================
// Bansil Books Analytics — Master Inventory Mismatch API Route
// Serves item balance and mismatch analytics strictly from local SQLite cache
// ZERO ZOHO API CALLS
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  generateMasterInventoryMismatchReport,
  getItemTransactionBreakdown,
} from "../../lib/inventory-mismatch-engine.ts";
import type { ReconciliationFilter } from "../../types/reconciliation.ts";
import { requireFeaturesEnabled } from "../../lib/feature-guard.ts";

// This route is shared by Dashboard, Reconciliation, Reports, Services,
// Customer Details, and Action Taken (see PROJECT_FEATURE_CONTROLS.md's
// consumer matrix) — most call shapes carry no reliable per-feature
// signal and are deliberately left ungated (gating them would either do
// nothing, since a sibling always-on feature exposes the same data, or
// would break unrelated approved behavior). The seven `operationalTab`
// values below ARE exclusive to one sub_recon_* leaf each (confirmed by
// code search of reconciliation-view.tsx's own sidebarSection-sync
// effect — no other caller ever sets these); "ALL_MISMATCHES" (the
// default, also left unset by report_summary/data_quality/validation)
// remains intentionally ungated as genuinely ambiguous/shared.
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
    const { searchParams } = new URL(request.url);

    const operationalTabParam = searchParams.get("operationalTab");
    const exclusiveKey = operationalTabParam ? EXCLUSIVE_OPERATIONAL_TAB_FEATURE[operationalTabParam] : undefined;
    if (exclusiveKey) {
      const disabled = requireFeaturesEnabled("module_reconciliation", exclusiveKey);
      if (disabled) return disabled;
    }

    const filter: ReconciliationFilter = {
      financialYear: searchParams.get("financialYear") || undefined,
      fromDate: searchParams.get("fromDate") || undefined,
      toDate: searchParams.get("toDate") || undefined,
      period: searchParams.get("period") || (searchParams.get("financialYear") ? undefined : "CURRENT_FY"),
      operationalTab: (searchParams.get("operationalTab") as ReconciliationFilter["operationalTab"]) || undefined,
      operationalTabs: searchParams.get("operationalTabs") ? (searchParams.get("operationalTabs") as string).split(",") as any : undefined,
      search: searchParams.get("search") || undefined,
      status: searchParams.get("status") || undefined,
      itemId: searchParams.get("itemId") || searchParams.get("breakdownItemId") || undefined,
      itemName: searchParams.get("itemName") || searchParams.get("breakdownItemName") || undefined,
      customerId: searchParams.get("customerId") || searchParams.get("breakdownCustomerId") || undefined,
      customerName: searchParams.get("customerName") || searchParams.get("breakdownCustomerName") || undefined,
      sku: searchParams.get("sku") || searchParams.get("breakdownSku") || undefined,
      classification: (searchParams.get("classification") as any) || undefined,
    };

    // If a specific itemId or customer+item is requested for drilldown breakdown
    const breakdownItemId = searchParams.get("breakdownItemId") || searchParams.get("itemId");
    const breakdownCustomerId = searchParams.get("breakdownCustomerId") || searchParams.get("customerId");
    if (breakdownItemId) {
      const breakdown = breakdownCustomerId
        ? getItemTransactionBreakdown(breakdownCustomerId, breakdownItemId, filter)
        : getItemTransactionBreakdown(breakdownItemId, filter);
      return NextResponse.json({
        success: true,
        breakdown,
      });
    }

    // Otherwise return full master mismatch report
    const report = generateMasterInventoryMismatchReport(filter);

    return NextResponse.json({
      success: true,
      report,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        success: false,
        error: `Failed to generate Master Inventory Mismatch report: ${message}`,
      },
      { status: 500 }
    );
  }
}

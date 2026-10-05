// ============================================================
// Bansil Books Analytics — Stock API Route
// GET /api/stock
// STRICTLY READ-ONLY · ZERO ZOHO API CALLS
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getStockSummary, getItemStockDetail } from "@/app/lib/stock-engine";
import type { StockFilter } from "@/app/lib/stock-engine";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const disabled = requireFeaturesEnabled("module_inventory", "sub_inv_stock");
  if (disabled) return disabled;
  try {
    const sp = req.nextUrl.searchParams;
    const action = sp.get("action") || "summary";

    const filter: StockFilter = {
      financialYear: sp.get("financialYear") || undefined,
      fromDate: sp.get("fromDate") || undefined,
      toDate: sp.get("toDate") || undefined,
      itemSearch: sp.get("itemSearch") || undefined,
      classification: (sp.get("classification") as StockFilter["classification"]) || undefined,
      stockStatus: sp.get("stockStatus") || undefined,
      customerId: sp.get("customerId") || undefined,
      customerName: sp.get("customerName") || undefined,
      vendorName: sp.get("vendorName") || undefined,
      sortBy: (sp.get("sortBy") as StockFilter["sortBy"]) || "name",
      sortOrder: (sp.get("sortOrder") as StockFilter["sortOrder"]) || "asc",
    };

    if (action === "detail") {
      const itemId = sp.get("itemId");
      if (!itemId) {
        return NextResponse.json({ error: "itemId required for detail action" }, { status: 400 });
      }
      const detail = getItemStockDetail(itemId, filter);
      if (!detail) {
        return NextResponse.json({ error: "Item not found or excluded", excluded: true }, { status: 404 });
      }
      return NextResponse.json({ detail });
    }

    // Default: summary
    const result = getStockSummary(filter);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/stock] Error:", err);
    return NextResponse.json({ error: "Internal error", detail: String(err) }, { status: 500 });
  }
}

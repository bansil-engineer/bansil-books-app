// ============================================================
// Bansil Books Analytics — Customer 360 / Customer Details API Route
// Strictly Local SQLite · Zero Zoho API Calls
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/app/lib/db/database";
import {
  getCustomerList,
  getCustomerDetailsData,
} from "@/app/lib/customer-details-engine";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("customer-details", "GET"), "customer-details GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const disabled = requireFeaturesEnabled("module_customers", "sub_cust_customer_details");
  if (disabled) return disabled;
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const customerId = searchParams.get("customerId");
    const customerName = searchParams.get("customerName");
    const financialYear = searchParams.get("financialYear") || "2026-27";
    const period = searchParams.get("period") || "CURRENT_FY";
    const fromDate = searchParams.get("fromDate") || undefined;
    const toDate = searchParams.get("toDate") || undefined;
    const search = searchParams.get("search") || undefined;

    const db = getDatabase();

    // 1. List of customers for selector
    if (action === "list" || (!customerId && !customerName)) {
      const customers = getCustomerList(db, { search, financialYear });
      return NextResponse.json({
        success: true,
        customers,
      });
    }

    // 2. Full Customer 360 analytics
    const data = getCustomerDetailsData(db, {
      customerId: customerId || undefined,
      customerName: customerName || undefined,
      financialYear,
      period,
      fromDate,
      toDate,
    });

    if (!data) {
      return NextResponse.json(
        { success: false, error: "Customer not found in local cache" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (err) {
    console.error("Failed to fetch customer details:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

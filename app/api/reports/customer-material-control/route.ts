// ============================================================
// Bansil Books Analytics — Customer Material Control API Route
// FOR SITE ENGINEER / SITE IN-CHARGE
// Pure Local SQLite · Zero Zoho Mutation · Read-Only Zoho Guard
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/app/lib/db/database";
import {
  getCustomerMaterialControlReport,
  getPendingCustomersSummary,
  saveSiteAction,
  SiteActionStatus,
} from "@/app/lib/customer-material-control-engine";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("reports/customer-material-control", "GET"), "reports/customer-material-control GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const disabled = requireFeaturesEnabled("module_reports", "sub_rep_customer_material");
  if (disabled) return disabled;
  try {
    const searchParams = request.nextUrl.searchParams;
    const customerId = searchParams.get("customerId") || undefined;
    const customerName = searchParams.get("customerName") || undefined;
    const period = searchParams.get("period") || undefined;
    const financialYear = searchParams.get("financialYear") || "2026-27";
    const fromDate = searchParams.get("fromDate") || undefined;
    const toDate = searchParams.get("toDate") || undefined;
    const itemSearch = searchParams.get("itemSearch") || undefined;
    const statusFilter = searchParams.get("statusFilter") || undefined;
    const vendorFilter = searchParams.get("vendorFilter") || undefined;
    const actionStatusFilter = searchParams.get("actionStatus") || undefined;
    const showReconciled = searchParams.get("showReconciled") === "true";
    const pendingSummary = searchParams.get("pendingSummary") === "true" || customerId === "ALL_PENDING";

    const db = getDatabase();

    if (pendingSummary) {
      const summary = getPendingCustomersSummary(db, {
        financialYear,
        period,
        fromDate,
        toDate,
      });
      return NextResponse.json(summary, {
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }

    if (!customerId && !customerName) {
      return NextResponse.json(
        { error: "Customer ID or Customer Name is required" },
        { status: 400 }
      );
    }

    const report = getCustomerMaterialControlReport(db, {
      customerId,
      customerName,
      period,
      financialYear,
      fromDate,
      toDate,
      itemSearch,
      statusFilter,
      vendorFilter,
      actionStatusFilter,
      showReconciled,
    });

    if (!report) {
      return NextResponse.json(
        { error: "Customer not found or has no matching activity" },
        { status: 404 }
      );
    }

    return NextResponse.json(report, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("reports/customer-material-control", "POST"), "reports/customer-material-control POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  const disabled = requireFeaturesEnabled("module_reports", "sub_rep_customer_material");
  if (disabled) return disabled;
  try {
    const body = await request.json();
    const {
      customerId,
      itemId,
      siteRemark,
      actionRequired,
      responsiblePerson,
      targetDate,
      actionStatus,
    } = body;

    if (!customerId || !itemId) {
      return NextResponse.json(
        { error: "customerId and itemId are required" },
        { status: 400 }
      );
    }

    const db = getDatabase();
    saveSiteAction(db, {
      customerId,
      itemId,
      siteRemark,
      actionRequired,
      responsiblePerson,
      targetDate,
      actionStatus: (actionStatus as SiteActionStatus) || "OPEN",
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to save site action";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

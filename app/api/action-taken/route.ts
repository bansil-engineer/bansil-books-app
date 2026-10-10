import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/app/lib/db/database";
import {
  getActionTakenData,
  saveCustomerAction,
  getCustomerActionHistory,
  getCustomerDetailsMissingData,
  savePurchaseLineAction,
  type ActionTakenFilterOptions,
  type CustomerDetailsMissingFilterOptions,
} from "@/app/lib/action-taken-engine";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("action-taken", "GET"), "action-taken GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const disabled = requireFeaturesEnabled("module_customers", "sub_cust_action_taken");
  if (disabled) return disabled;
  try {
    const db = getDatabase();
    const { searchParams } = new URL(req.url);

    const historyCustomerId = searchParams.get("historyCustomerId");
    if (historyCustomerId) {
      const history = getCustomerActionHistory(db, historyCustomerId);
      return NextResponse.json({ history });
    }

    const tab = searchParams.get("tab");
    if (tab === "missing-details") {
      const options: CustomerDetailsMissingFilterOptions = {
        financialYear: searchParams.get("financialYear") || undefined,
        fromDate: searchParams.get("fromDate") || undefined,
        toDate: searchParams.get("toDate") || undefined,
        vendor: searchParams.get("vendor") || undefined,
        item: searchParams.get("item") || undefined,
        search: searchParams.get("search") || undefined,
        reconStatusFilter: (searchParams.get("reconStatusFilter") as any) || "UNMAPPED_ONLY",
        actionStatusFilter: searchParams.get("actionStatusFilter") || undefined,
      };

      const data = getCustomerDetailsMissingData(db, options);
      return NextResponse.json(data);
    }

    const actionStatus = searchParams.get("actionStatus") || searchParams.get("actionStatusFilter") || undefined;
    const actionOwner = searchParams.get("actionOwner") || searchParams.get("actionOwnerFilter") || undefined;
    const mismatchType = searchParams.get("mismatchType") || searchParams.get("mismatchTypeFilter") || undefined;
    const priority = searchParams.get("priority") || searchParams.get("priorityFilter") || undefined;

    const options: ActionTakenFilterOptions = {
      financialYear: searchParams.get("financialYear") || undefined,
      fromDate: searchParams.get("fromDate") || undefined,
      toDate: searchParams.get("toDate") || undefined,
      statusFilter: (searchParams.get("statusFilter") as any) || "MISMATCH_ONLY",
      search: searchParams.get("search") || undefined,
      itemSearch: searchParams.get("itemSearch") || undefined,
      actionStatusFilter: actionStatus && actionStatus !== "ALL" ? actionStatus : undefined,
      actionOwnerFilter: actionOwner && actionOwner !== "ALL" ? actionOwner : undefined,
      mismatchTypeFilter: mismatchType && mismatchType !== "ALL" ? (mismatchType as any) : undefined,
      priorityFilter: priority && priority !== "ALL" ? priority : undefined,
    };

    const data = getActionTakenData(db, options);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Action Taken API error:", err);
    return NextResponse.json(
      { error: "Failed to fetch action taken data" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("action-taken", "POST"), "action-taken POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  const disabled = requireFeaturesEnabled("module_customers", "sub_cust_action_taken");
  if (disabled) return disabled;
  try {
    const db = getDatabase();
    const body = await req.json();

    if (body.type === "purchase_line_action" || body.lineItemId) {
      if (!body.lineItemId || !body.billId) {
        return NextResponse.json(
          { error: "lineItemId and billId are required" },
          { status: 400 }
        );
      }

      const result = savePurchaseLineAction(db, {
        lineItemId: body.lineItemId,
        billId: body.billId,
        actionStatus: body.actionStatus || "Open",
        actionOwner: body.actionOwner || "",
        nextFollowUpDate: body.nextFollowUpDate || "",
        remarks: body.remarks || "",
      });

      return NextResponse.json(result);
    }

    if (!body.customerId || !body.customerName) {
      return NextResponse.json(
        { error: "customerId and customerName are required" },
        { status: 400 }
      );
    }

    const result = saveCustomerAction(db, {
      customerId: body.customerId,
      customerName: body.customerName,
      itemId: body.itemId,
      itemName: body.itemName,
      actionStatus: body.actionStatus || "Open",
      actionTaken: body.actionTaken || "",
      actionOwner: body.actionOwner || "",
      priority: body.priority || "MEDIUM",
      nextFollowUpDate: body.nextFollowUpDate || "",
      remarks: body.remarks || "",
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("Action Taken Save error:", err);
    return NextResponse.json(
      { error: "Failed to save action record" },
      { status: 500 }
    );
  }
}


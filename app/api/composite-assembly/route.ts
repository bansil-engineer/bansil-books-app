import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/app/lib/db/database";
import {
  getAssemblyList,
  getAssemblyDetail,
  getAssemblyAuditLogs,
  getEligibleComponentPurchaseLines,
  getConfirmedAssemblyImpact,
  createAssemblyDraft,
  updateAssemblyDraft,
  confirmAssembly,
  cancelOrReverseAssembly,
} from "@/app/lib/composite-assembly-engine";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const disabled = requireFeaturesEnabled("module_reconciliation", "sub_recon_composite_assembly");
  if (disabled) return disabled;
  try {
    const db = getDatabase();
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");

    // 1. Eligible Purchase Lines for Customer
    if (action === "eligible-lines") {
      const customerId = searchParams.get("customerId");
      if (!customerId) {
        return NextResponse.json({ error: "customerId is required" }, { status: 400 });
      }
      const financialYear = searchParams.get("financialYear") || undefined;
      const fromDate = searchParams.get("fromDate") || undefined;
      const toDate = searchParams.get("toDate") || undefined;
      const excludeAssemblyId = searchParams.get("excludeAssemblyId") || undefined;

      const lines = getEligibleComponentPurchaseLines(db, customerId, {
        financialYear,
        fromDate,
        toDate,
        excludeAssemblyId,
      });

      return NextResponse.json({ lines });
    }

    // 2. Full Assembly Detail & Audit Trail
    if (action === "detail") {
      const assemblyId = searchParams.get("assemblyId");
      if (!assemblyId) {
        return NextResponse.json({ error: "assemblyId is required" }, { status: 400 });
      }

      const assembly = getAssemblyDetail(db, assemblyId);
      if (!assembly) {
        return NextResponse.json({ error: "Assembly not found" }, { status: 404 });
      }

      const auditLogs = getAssemblyAuditLogs(db, assemblyId);
      return NextResponse.json({ assembly, auditLogs });
    }

    // 3. Confirmed Assembly Impact map
    if (action === "impact") {
      const customerId = searchParams.get("customerId") || undefined;
      const financialYear = searchParams.get("financialYear") || undefined;
      const fromDate = searchParams.get("fromDate") || undefined;
      const toDate = searchParams.get("toDate") || undefined;

      const impactMap = getConfirmedAssemblyImpact(db, {
        customerId,
        financialYear,
        fromDate,
        toDate,
      });

      const impactObj: Record<string, any> = {};
      for (const [k, v] of impactMap.entries()) {
        impactObj[k] = v;
      }

      return NextResponse.json({ impact: impactObj });
    }

    // 4. Default: Assembly List with summary
    const filter = {
      customerId: searchParams.get("customerId") || undefined,
      compositeItemId: searchParams.get("compositeItemId") || undefined,
      status: searchParams.get("status") || undefined,
      search: searchParams.get("search") || undefined,
      financialYear: searchParams.get("financialYear") || undefined,
      fromDate: searchParams.get("fromDate") || undefined,
      toDate: searchParams.get("toDate") || undefined,
    };

    const data = getAssemblyList(db, filter);
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("Composite Assembly GET API error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to process composite assembly GET request" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const disabled = requireFeaturesEnabled("module_reconciliation", "sub_recon_composite_assembly");
  if (disabled) return disabled;
  try {
    const db = getDatabase();
    const body = await req.json();
    const action = body.action || "create-draft";

    // 1. Create Draft
    if (action === "create-draft") {
      const draft = createAssemblyDraft(db, {
        customerId: body.customerId,
        customerName: body.customerName,
        compositeItemId: body.compositeItemId,
        compositeItemName: body.compositeItemName,
        compositeSku: body.compositeSku,
        generatedQty: Number(body.generatedQty),
        unit: body.unit || "BUN",
        assemblyDate: body.assemblyDate,
        referenceNo: body.referenceNo,
        remarks: body.remarks,
        components: body.components || [],
        createdBy: body.createdBy || "Local User",
      });

      return NextResponse.json({ success: true, assembly: draft });
    }

    // 2. Update Draft
    if (action === "update-draft") {
      if (!body.assemblyId) {
        return NextResponse.json({ error: "assemblyId is required" }, { status: 400 });
      }

      const updated = updateAssemblyDraft(db, body.assemblyId, {
        compositeItemId: body.compositeItemId,
        compositeItemName: body.compositeItemName,
        compositeSku: body.compositeSku,
        generatedQty: body.generatedQty !== undefined ? Number(body.generatedQty) : undefined,
        unit: body.unit,
        assemblyDate: body.assemblyDate,
        referenceNo: body.referenceNo,
        remarks: body.remarks,
        components: body.components,
        updatedBy: body.updatedBy || "Local User",
      });

      return NextResponse.json({ success: true, assembly: updated });
    }

    // 3. Confirm Assembly
    if (action === "confirm") {
      if (!body.assemblyId) {
        return NextResponse.json({ error: "assemblyId is required" }, { status: 400 });
      }

      const confirmed = confirmAssembly(db, body.assemblyId, body.confirmedBy || "Local User");
      return NextResponse.json({ success: true, assembly: confirmed });
    }

    // 4. Cancel / Reverse Assembly
    if (action === "cancel" || action === "reverse") {
      if (!body.assemblyId) {
        return NextResponse.json({ error: "assemblyId is required" }, { status: 400 });
      }

      const cancelled = cancelOrReverseAssembly(
        db,
        body.assemblyId,
        body.reason || "User initiated reversal",
        body.cancelledBy || "Local User"
      );

      return NextResponse.json({ success: true, assembly: cancelled });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    console.error("Composite Assembly POST API error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to process composite assembly mutation" },
      { status: 400 }
    );
  }
}

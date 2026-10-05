// ============================================================
// Manual SO↔PO Line Mapping — Candidate SO Lines API (Phase 2)
//
// GET: Return all SO lines for the SO linked to a given PO,
//      so OWNER can pick which SO line to map a PO line to.
//
// ZOHO WRITE = 0. Pure local SQLite read operations.
// ============================================================

import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import {
  buildGlobalSoLookup,
  resolveUniqueSalesOrder,
} from "@/app/lib/audit/so-po-mapping";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const purchaseorderId = searchParams.get("purchaseorderId");

    if (!purchaseorderId) {
      return NextResponse.json(
        { error: "Missing required parameter: purchaseorderId" },
        { status: 400 }
      );
    }

    const db = getAuditDatabase();

    // Step 1: Get the PO header to find its SO reference
    const po = db.prepare(
      `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER(PARTITION BY purchaseorder_id ORDER BY fetched_at DESC) as rn
         FROM audit_zoho_purchase_orders
       ) WHERE rn = 1 AND purchaseorder_id = ?`
    ).get(purchaseorderId) as any;

    if (!po) {
      return NextResponse.json(
        { error: "Purchase order not found in local data" },
        { status: 404 }
      );
    }

    // Step 2: Extract SO reference from PO custom fields
    let soRef: string | null = null;
    try {
      const customFields = JSON.parse(po.custom_fields_json || "[]");
      const soField = customFields.find(
        (f: any) =>
          (f.label || "").toLowerCase() === "sales order no" ||
          f.api_name === "cf_sales_order_no"
      );
      soRef = soField?.value?.trim() || po.reference_number || null;
    } catch {
      soRef = po.reference_number || null;
    }

    if (!soRef) {
      return NextResponse.json({
        candidates: [],
        salesorderId: null,
        salesorderNumber: null,
        resolution: "SO_REFERENCE_MISSING",
      });
    }

    // Step 3: Resolve SO using deterministic lookup
    const globalSoLookup = buildGlobalSoLookup(db);
    const resolution = resolveUniqueSalesOrder(globalSoLookup, soRef);

    if (resolution.status !== "MATCH") {
      return NextResponse.json({
        candidates: [],
        salesorderId: null,
        salesorderNumber: null,
        resolution: resolution.status,
      });
    }

    const so = resolution.so;

    // Step 4: Get all SO lines (latest snapshot)
    const soLines = getLatestSoLines(db, so.salesorder_id);

    const candidates = soLines.map((line: any) => ({
      lineItemId: line.line_item_id,
      displayLineNumber: line.displayLineNumber,
      itemId: line.item_id,
      itemName: line.item_name,
      description: line.description,
      sku: line.sku || null,
      quantity: line.quantity,
      rate: line.rate,
      amount: line.amount,
      unit: line.unit || null,
    }));

    return NextResponse.json({
      candidates,
      salesorderId: so.salesorder_id,
      salesorderNumber: so.salesorder_number,
      organizationId: so.organization_id,
      resolution: "MATCH",
    });
  } catch (error) {
    console.error("Manual line mapping candidates error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * Get latest SO lines for a salesorder_id.
 * Mirrors the pattern from approval-pending-service.ts getLatestLines().
 */
function getLatestSoLines(db: any, salesorderId: string): any[] {
  const latestHeader = db.prepare(
    `SELECT source_run_id, organization_id FROM audit_zoho_sales_orders
     WHERE salesorder_id = ? ORDER BY fetched_at DESC LIMIT 1`
  ).get(salesorderId) as any;
  if (!latestHeader) return [];
  return db.prepare(
    `SELECT *, ROW_NUMBER() OVER(ORDER BY rowid ASC) as displayLineNumber
     FROM audit_zoho_sales_order_lines
     WHERE salesorder_id = ? AND source_run_id = ? AND organization_id = ?
     ORDER BY rowid ASC`
  ).all(salesorderId, latestHeader.source_run_id, latestHeader.organization_id) as any[];
}

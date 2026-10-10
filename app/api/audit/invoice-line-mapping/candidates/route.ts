// ============================================================
// Invoice↔SO Line Mapping — Candidate SO Lines with Narration Ranking (R1B)
//
// GET: Return all SO lines for the SO linked to a given Invoice,
//      ranked by the deterministic narration engine.
//
// Results carry SUGGESTED / NOT_RECOMMENDED but NEVER create mapping automatically.
//
// ZOHO WRITE = 0. No AI. Pure local SQLite + deterministic scoring.
// ============================================================

import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import {
  getCandidatesForInvoiceLine,
} from "@/app/lib/audit/invoice-line-mapping-service";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/invoice-line-mapping/candidates", "GET"), "audit/invoice-line-mapping/candidates GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const { searchParams } = new URL(request.url);
    const invoiceId = searchParams.get("invoiceId");
    const invoiceLineItemId = searchParams.get("invoiceLineItemId");
    const salesorderId = searchParams.get("salesorderId");
    let orgId = searchParams.get("orgId");

    if (!invoiceId || !invoiceLineItemId) {
      return NextResponse.json(
        { error: "Missing required parameters: invoiceId, invoiceLineItemId" },
        { status: 400 }
      );
    }

    const db = getAuditDatabase();

    // Derive orgId from Invoice header if not explicitly provided
    if (!orgId) {
      const inv = db.prepare(
        `SELECT organization_id FROM audit_zoho_invoices WHERE invoice_id = ? ORDER BY fetched_at DESC LIMIT 1`
      ).get(invoiceId) as any;
      if (!inv) {
        return NextResponse.json(
          { error: "Invoice not found — cannot derive organization_id" },
          { status: 404 }
        );
      }
      orgId = inv.organization_id;
    }

    // Resolve SO from Invoice header if salesorderId not provided
    let resolvedSoId = salesorderId;
    let salesorderNumber: string | null = null;

    if (!resolvedSoId) {
      // Try native salesorder_id from Invoice
      const inv = db.prepare(
        `SELECT salesorder_id, custom_fields_json FROM audit_zoho_invoices
         WHERE invoice_id = ? ORDER BY fetched_at DESC LIMIT 1`
      ).get(invoiceId) as any;

      if (inv?.salesorder_id) {
        resolvedSoId = inv.salesorder_id;
      } else if (inv) {
        // Fallback to custom field cf_sales_order_no
        try {
          const cf = JSON.parse(inv.custom_fields_json || "[]");
          const soField = cf.find(
            (f: any) =>
              (f.label || "").toLowerCase() === "sales order no" ||
              f.api_name === "cf_sales_order_no"
          );
          const cfRef = soField?.value?.trim();
          if (cfRef) {
            // Look up the SO by number
            const { buildGlobalSoLookup, resolveUniqueSalesOrder } = await import("@/app/lib/audit/so-po-mapping");
            const globalSoLookup = buildGlobalSoLookup(db);
            const resolution = resolveUniqueSalesOrder(globalSoLookup, cfRef);
            if (resolution.status === "MATCH") {
              resolvedSoId = resolution.so.salesorder_id;
              salesorderNumber = resolution.so.salesorder_number;
            } else {
              return NextResponse.json({
                candidates: [],
                invoiceLine: null,
                salesorderId: null,
                salesorderNumber: null,
                resolution: resolution.status,
              });
            }
          }
        } catch {}
      }
    }

    if (!resolvedSoId) {
      return NextResponse.json({
        candidates: [],
        invoiceLine: null,
        salesorderId: null,
        salesorderNumber: null,
        resolution: "SO_REFERENCE_MISSING",
      });
    }

    // Get SO number if we don't have it yet
    if (!salesorderNumber) {
      const so = db.prepare(
        `SELECT salesorder_number FROM audit_zoho_sales_orders
         WHERE salesorder_id = ? ORDER BY fetched_at DESC LIMIT 1`
      ).get(resolvedSoId) as any;
      salesorderNumber = so?.salesorder_number || null;
    }

    // Get ranked candidates
    const result = getCandidatesForInvoiceLine(
      db, orgId!, invoiceId, invoiceLineItemId, resolvedSoId
    );

    const candidates = result.ranked.map(r => ({
      lineItemId: r.candidate.line_item_id,
      itemId: r.candidate.item_id,
      itemName: r.candidate.item_name,
      description: r.candidate.description,
      quantity: r.candidate.quantity,
      rate: r.candidate.rate,
      unit: r.candidate.unit,
      ranking: r.ranking,
    }));

    return NextResponse.json({
      candidates,
      invoiceLine: result.invoiceLine,
      salesorderId: resolvedSoId,
      salesorderNumber,
      organizationId: orgId,
      resolution: "MATCH",
    });
  } catch (error) {
    console.error("Invoice line mapping candidates error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

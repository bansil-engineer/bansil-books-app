// ============================================================
// Invoice↔SO Line Mapping — API Route (R1B)
//
// GET:  Query current mapping for an Invoice line
// POST: Create a new mapping
//
// SEPARATE from PO manual-line-mapping routes.
// ZOHO WRITE = 0. Pure local SQLite operations.
// ============================================================

import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import {
  createOwnerInvoiceLineMapping,
  getCurrentMappingForInvoiceLine,
  evaluateInvoiceMappingStaleness,
  type InvoiceMappingKind,
} from "@/app/lib/audit/invoice-line-mapping-service";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/invoice-line-mapping", "GET"), "audit/invoice-line-mapping GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const { searchParams } = new URL(request.url);
    let orgId = searchParams.get("orgId");
    const invoiceId = searchParams.get("invoiceId");
    const invoiceLineItemId = searchParams.get("invoiceLineItemId");

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

    const mapping = getCurrentMappingForInvoiceLine(db, orgId!, invoiceId, invoiceLineItemId);

    if (!mapping) {
      return NextResponse.json({ mapping: null, staleness: null });
    }

    const staleness = evaluateInvoiceMappingStaleness(db, mapping);

    return NextResponse.json({ mapping, staleness });
  } catch (error) {
    console.error("Invoice line mapping GET error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/invoice-line-mapping", "POST"), "audit/invoice-line-mapping POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const body = await request.json();
    const {
      orgId,
      salesorderId,
      soLineItemId,
      invoiceId,
      invoiceLineItemId,
      mappingKind,
      notes,
    } = body;

    if (!orgId || !salesorderId || !soLineItemId || !invoiceId || !invoiceLineItemId || !mappingKind) {
      return NextResponse.json(
        { error: "Missing required fields: orgId, salesorderId, soLineItemId, invoiceId, invoiceLineItemId, mappingKind" },
        { status: 400 }
      );
    }

    const validKinds: InvoiceMappingKind[] = ["OWNER_FALLBACK", "OWNER_OVERRIDE"];
    if (!validKinds.includes(mappingKind)) {
      return NextResponse.json(
        { error: `Invalid mappingKind. Must be one of: ${validKinds.join(", ")}` },
        { status: 400 }
      );
    }

    const db = getAuditDatabase();
    const result = createOwnerInvoiceLineMapping(db, {
      organizationId: orgId,
      invoiceId,
      invoiceLineItemId,
      salesorderId,
      soLineItemId,
      mappingKind,
      note: notes || null,
    });

    const statusCode = result.outcome === "CREATED" ? 201 : 200;
    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
    console.error("Invoice line mapping POST error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

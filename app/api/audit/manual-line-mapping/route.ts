// ============================================================
// Manual SO↔PO Line Mapping — API Route (Phase 2)
//
// GET:  Query current mapping for a PO line
// POST: Create a new mapping
//
// ZOHO WRITE = 0. Pure local SQLite operations.
// ============================================================

import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import {
  createOwnerLineMapping,
  getCurrentMappingForPoLine,
  evaluateMappingStaleness,
  type MappingKind,
} from "@/app/lib/audit/manual-line-mapping-service";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/manual-line-mapping", "GET"), "audit/manual-line-mapping GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const { searchParams } = new URL(request.url);
    let orgId = searchParams.get("orgId");
    const purchaseorderId = searchParams.get("purchaseorderId");
    const poLineItemId = searchParams.get("poLineItemId");

    if (!purchaseorderId || !poLineItemId) {
      return NextResponse.json(
        { error: "Missing required parameters: purchaseorderId, poLineItemId" },
        { status: 400 }
      );
    }

    const db = getAuditDatabase();

    // Derive orgId from PO header if not explicitly provided
    if (!orgId) {
      const po = db.prepare(
        `SELECT organization_id FROM audit_zoho_purchase_orders WHERE purchaseorder_id = ? ORDER BY fetched_at DESC LIMIT 1`
      ).get(purchaseorderId) as any;
      if (!po) {
        return NextResponse.json(
          { error: "Purchase order not found — cannot derive organization_id" },
          { status: 404 }
        );
      }
      orgId = po.organization_id;
    }

    const mapping = getCurrentMappingForPoLine(db, orgId!, purchaseorderId, poLineItemId);

    if (!mapping) {
      return NextResponse.json({ mapping: null, staleness: null });
    }

    const staleness = evaluateMappingStaleness(db, mapping);

    return NextResponse.json({ mapping, staleness });
  } catch (error) {
    console.error("Manual line mapping GET error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/manual-line-mapping", "POST"), "audit/manual-line-mapping POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const body = await request.json();
    const {
      orgId,
      salesorderId,
      soLineItemId,
      purchaseorderId,
      poLineItemId,
      mappingKind,
      notes,
      decisionSource,
    } = body;

    if (!orgId || !salesorderId || !soLineItemId || !purchaseorderId || !poLineItemId || !mappingKind) {
      return NextResponse.json(
        { error: "Missing required fields: orgId, salesorderId, soLineItemId, purchaseorderId, poLineItemId, mappingKind" },
        { status: 400 }
      );
    }

    const validKinds: MappingKind[] = ["OWNER_FALLBACK", "OWNER_OVERRIDE"];
    if (!validKinds.includes(mappingKind)) {
      return NextResponse.json(
        { error: `Invalid mappingKind. Must be one of: ${validKinds.join(", ")}` },
        { status: 400 }
      );
    }

    const db = getAuditDatabase();
    const result = createOwnerLineMapping(db, {
      organizationId: orgId,
      salesorderId,
      soLineItemId,
      purchaseorderId,
      poLineItemId,
      mappingKind,
      note: notes || null,
    });

    const statusCode = result.outcome === "CREATED" ? 201 : 200;
    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
    console.error("Manual line mapping POST error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

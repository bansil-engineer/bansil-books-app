// ============================================================
// Invoice↔SO Line Mapping — History API (R1B)
//
// GET: Return mapping history for an Invoice line.
//
// ZOHO WRITE = 0. Pure local SQLite read operations.
// ============================================================

import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { getHistoryEventsForInvoiceLine } from "@/app/lib/audit/invoice-line-mapping-service";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/invoice-line-mapping/history", "GET"), "audit/invoice-line-mapping/history GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("orgId");
    const invoiceId = searchParams.get("invoiceId");
    const invoiceLineItemId = searchParams.get("invoiceLineItemId");

    if (!orgId || !invoiceId || !invoiceLineItemId) {
      return NextResponse.json(
        { error: "Missing required parameters: orgId, invoiceId, invoiceLineItemId" },
        { status: 400 }
      );
    }

    const db = getAuditDatabase();
    const history = getHistoryEventsForInvoiceLine(db, orgId, invoiceId, invoiceLineItemId);

    return NextResponse.json({ history });
  } catch (error) {
    console.error("Invoice line mapping history error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

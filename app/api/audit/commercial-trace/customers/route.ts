import { NextRequest, NextResponse } from "next/server";
import { getAuditDatabase } from "../../../../lib/db/audit-database";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("audit/commercial-trace/customers", "GET"), "audit/commercial-trace/customers GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const db = getAuditDatabase();

    // Fetch distinct customers that have at least one SO in the local database
    const customers = db.prepare(`
      SELECT DISTINCT customer_id, customer_name
      FROM audit_zoho_sales_orders
      WHERE customer_id IS NOT NULL AND customer_name IS NOT NULL
      ORDER BY customer_name ASC
    `).all() as { customer_id: string; customer_name: string }[];

    return NextResponse.json({ customers });
  } catch (error: any) {
    console.error("Local Customers error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getAuditDatabase } from "../../../../lib/db/audit-database";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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

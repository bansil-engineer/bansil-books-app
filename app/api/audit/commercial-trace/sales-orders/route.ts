import { NextRequest, NextResponse } from "next/server";
import { getAuditDatabase } from "../../../../lib/db/audit-database";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customer_id");

    if (!customerId) {
      return NextResponse.json(
        { error: "customer_id is required" },
        { status: 400 }
      );
    }

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const period = searchParams.get("period");

    const db = getAuditDatabase();

    let query = `
      SELECT salesorder_id, salesorder_number, date, status, total, currency
      FROM audit_zoho_sales_orders
      WHERE customer_id = ?
    `;
    const params: any[] = [customerId];

    if (period !== 'ALL_PERIODS' && from && to) {
      query += ` AND date >= ? AND date <= ?`;
      params.push(from, to);
    }

    query += `
      GROUP BY salesorder_number
      ORDER BY date DESC
    `;

    // Fetch SOs for this customer, filtering by period if provided
    const salesOrders = db.prepare(query).all(...params) as any[];

    return NextResponse.json({ salesOrders });
  } catch (error: any) {
    console.error("Local Sales Orders error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}

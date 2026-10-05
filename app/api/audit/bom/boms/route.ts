import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";

export async function GET(req: Request) {
  const auditDb = getAuditDatabase();
  const { searchParams } = new URL(req.url);
  const compositeItemId = searchParams.get("compositeItemId");

  let query = "SELECT * FROM audit_bom_masters";
  const params: any[] = [];
  if (compositeItemId) {
    query += " WHERE item_id = ?";
    params.push(compositeItemId);
  }
  query += " ORDER BY created_at DESC";
  
  const rawBoms = auditDb.prepare(query).all(...params) as any[];

  const boms = rawBoms.map(b => ({
    ...b,
    composite_item_id: b.item_id,
    composite_item_name: `Composite ${b.item_id}`,
  }));

  return NextResponse.json({ success: true, boms });
}

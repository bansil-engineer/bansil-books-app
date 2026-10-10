import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(req: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("audit/bom/boms", "GET"), "audit/bom/boms GET");
  if (!rbacGuard.ok) return rbacGuard.response;
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

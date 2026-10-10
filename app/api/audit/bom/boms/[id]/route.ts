import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { listComponents } from "@/app/lib/audit/bom/bom-service";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(req: Request, context: any) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("audit/bom/boms/[id]", "GET"), "audit/bom/boms/[id] GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const auditDb = getAuditDatabase();
  const params = await context.params;
  
  const rawBom = auditDb.prepare("SELECT * FROM audit_bom_masters WHERE bom_id = ?").get(params.id) as any;
  if (!rawBom) {
    return NextResponse.json({ success: false, error: "BOM not found" }, { status: 404 });
  }

  const bom = {
    ...rawBom,
    composite_item_id: rawBom.item_id,
    composite_item_name: `Composite ${rawBom.item_id}`,
  };

  const components = listComponents(auditDb, params.id).map(c => ({
    ...c,
    bom_component_id: c.component_id,
    required_flag: true
  }));

  // Dummy events for now
  const events: any[] = [];

  return NextResponse.json({ success: true, bom, components, events });
}

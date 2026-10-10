import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { updateP0AlertStatus } from "@/app/lib/audit/p0/p0-service";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function PATCH(req: Request, context: any) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("audit/p0/alerts/[id]", "PATCH"), "audit/p0/alerts/[id] PATCH");
  if (!rbacGuard.ok) return rbacGuard.response;
  const auditDb = getAuditDatabase();
  const params = await context.params;
  
  try {
    const { status } = await req.json();
    if (!status) {
      return NextResponse.json({ success: false, error: "Missing status" }, { status: 400 });
    }

    const updated = updateP0AlertStatus(auditDb, params.id, status);
    
    if (updated) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ success: false, error: "Alert not found" }, { status: 404 });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

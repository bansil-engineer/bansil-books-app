import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(req: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("audit/p0/alerts", "GET"), "audit/p0/alerts GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const auditDb = getAuditDatabase();
  const { searchParams } = new URL(req.url);
  const severity = searchParams.get("severity");

  let query = "SELECT * FROM audit_p0_alerts";
  const params: any[] = [];

  if (severity) {
    query += " WHERE severity = ?";
    params.push(severity);
  }
  query += " ORDER BY created_at DESC";

  const alerts = auditDb.prepare(query).all(...params);

  return NextResponse.json({
    success: true,
    alerts
  });
}

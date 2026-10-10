import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { listTraceabilityAlerts } from "@/app/lib/audit/traceability/traceability-service";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(req: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("audit/traceability/alerts", "GET"), "audit/traceability/alerts GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const auditDb = getAuditDatabase();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;

  const alerts = listTraceabilityAlerts(auditDb, status);

  return NextResponse.json({ success: true, alerts });
}

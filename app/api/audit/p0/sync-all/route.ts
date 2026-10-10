import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { getDatabase } from "@/app/lib/db/database";
import { syncP0Alerts } from "@/app/lib/audit/p0/p0-service";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function POST(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/p0/sync-all", "POST"), "audit/p0/sync-all POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const auditDb = getAuditDatabase();
    const mainDb = getDatabase();

    const result = syncP0Alerts(mainDb, auditDb);

    return NextResponse.json({
      success: true,
      results: [
        {
          sourceKey: "all",
          status: "SUCCESS",
          alertsCreated: result.added,
          alertsResolved: 0
        }
      ]
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

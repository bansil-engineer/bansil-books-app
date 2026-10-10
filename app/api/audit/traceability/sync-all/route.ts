import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { getDatabase } from "@/app/lib/db/database";
import { syncTraceabilityAlerts } from "@/app/lib/audit/traceability/traceability-service";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function POST(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/traceability/sync-all", "POST"), "audit/traceability/sync-all POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const auditDb = getAuditDatabase();
    const mainDb = getDatabase();

    const result = syncTraceabilityAlerts(mainDb, auditDb);

    return NextResponse.json({
      success: true,
      result: {
        chain: {
          soToPoLinks: result.links.soToPoLinks,
          poToBillLinks: result.links.poToBillLinks,
          soToInvoiceLinks: result.links.soToInvoiceLinks,
          alertsCreated: result.added,
          alertsResolved: 0
        }
      }
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

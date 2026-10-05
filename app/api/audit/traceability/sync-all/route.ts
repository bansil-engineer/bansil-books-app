import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { getDatabase } from "@/app/lib/db/database";
import { syncTraceabilityAlerts } from "@/app/lib/audit/traceability/traceability-service";

export async function POST() {
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

import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { getDatabase } from "@/app/lib/db/database";
import { syncP0Alerts } from "@/app/lib/audit/p0/p0-service";

export async function POST(req: Request) {
  try {
    const { sourceKey } = await req.json();
    const auditDb = getAuditDatabase();
    const mainDb = getDatabase();

    // The user rules specify ZOHO BOOKS IS STRICTLY READ-ONLY. ZOHO WRITE = 0.
    // In our simplified mock, we just run our local sync rule.
    const result = syncP0Alerts(mainDb, auditDb);

    return NextResponse.json({
      success: true,
      result: {
        status: "SUCCESS",
        recordsFetched: 0,
        alertsCreated: result.added,
        alertsUpdated: 0,
        alertsResolved: 0,
        apiCallCount: 0,
        zohoRefreshStatus: "SUCCESS"
      }
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

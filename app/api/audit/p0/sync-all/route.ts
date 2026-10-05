import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { getDatabase } from "@/app/lib/db/database";
import { syncP0Alerts } from "@/app/lib/audit/p0/p0-service";

export async function POST() {
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

import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { updateTraceabilityAlertStatus } from "@/app/lib/audit/traceability/traceability-service";

export async function PATCH(req: Request, context: any) {
  const auditDb = getAuditDatabase();
  const params = await context.params;
  
  try {
    const { status } = await req.json();
    if (!status) {
      return NextResponse.json({ success: false, error: "Missing status" }, { status: 400 });
    }

    const updated = updateTraceabilityAlertStatus(auditDb, params.id, status);
    
    if (updated) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ success: false, error: "Alert not found" }, { status: 404 });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

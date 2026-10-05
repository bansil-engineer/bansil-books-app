import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { listTraceabilityAlerts } from "@/app/lib/audit/traceability/traceability-service";

export async function GET(req: Request) {
  const auditDb = getAuditDatabase();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;

  const alerts = listTraceabilityAlerts(auditDb, status);

  return NextResponse.json({ success: true, alerts });
}

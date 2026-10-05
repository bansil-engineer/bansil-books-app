import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";

export async function GET(req: Request) {
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

import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";

export async function POST(req: Request, context: any) {
  const auditDb = getAuditDatabase();
  
  try {
    const params = await context.params;
    const { reason } = await req.json();
    const result = auditDb.prepare("UPDATE audit_bom_masters SET status = 'DISABLED' WHERE bom_id = ?").run(params.id);
    
    if (result.changes > 0) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ success: false, error: "BOM not found" }, { status: 404 });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

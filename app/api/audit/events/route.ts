import { NextResponse } from "next/server";
import { listAuditEvents } from "@/app/lib/audit/audit-service";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace");
  if (disabled) return disabled;
  try {
    const events = listAuditEvents(200).map((e) => ({
      ...e,
      details: e.details_json ? JSON.parse(e.details_json as string) : null,
    }));
    return NextResponse.json({ success: true, events });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load audit events" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getFinding } from "@/app/lib/audit/findings-service";
import { requireOwnerSession } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ findingId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_findings", "audit_feat_findings_register");
  if (disabled) return disabled;

  const { findingId } = await params;
  const finding = getFinding(findingId);
  if (!finding) return NextResponse.json({ success: false, error: "Finding not found" }, { status: 404 });
  return NextResponse.json({ success: true, finding });
}

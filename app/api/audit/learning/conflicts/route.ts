import { NextRequest, NextResponse } from "next/server";
import { listOpenConflicts } from "@/app/lib/audit/learning/learning-service";
import { requireOwnerSession } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_learning", "audit_feat_learning_rule_conflict_review");
  if (disabled) return disabled;

  return NextResponse.json({ success: true, conflicts: listOpenConflicts() });
}

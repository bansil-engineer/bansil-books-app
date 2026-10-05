import { NextRequest, NextResponse } from "next/server";
import { getRunSummary, listRunEdges, listMatchGroups, MatchError } from "@/app/lib/audit/match-service";
import { requireOwnerSession } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled, allAuditSettings } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_match_review");
  if (disabled) return disabled;
  try {
    const { runId } = await params;
    const summary = getRunSummary(runId);
    const edges = listRunEdges(runId);
    const groupType = req.nextUrl.searchParams.get("groupType") ?? undefined;
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const groups = listMatchGroups(runId, { groupType, status }, undefined, allAuditSettings());
    return NextResponse.json({ success: true, summary, edges, groups });
  } catch (error) {
    if (error instanceof MatchError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to load run summary" }, { status: 500 });
  }
}

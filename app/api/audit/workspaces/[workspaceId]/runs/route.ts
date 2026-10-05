import { NextRequest, NextResponse } from "next/server";
import { createRun, listRuns, MatchError } from "@/app/lib/audit/match-service";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled, allAuditSettings } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_match_review");
  if (disabled) return disabled;
  const { workspaceId } = await params;
  const runs = listRuns(workspaceId);
  return NextResponse.json({ success: true, runs });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_match_review");
  if (disabled) return disabled;

  try {
    const { workspaceId } = await params;
    const body = await req.json();
    if (!Array.isArray(body.edges) || body.edges.length === 0) {
      return NextResponse.json({ success: false, error: "At least one comparison edge is required" }, { status: 400 });
    }
    const result = createRun(
      {
        workspaceId,
        edges: body.edges.map((e: Record<string, unknown>) => ({
          leftRoleLabel: String(e.leftRoleLabel ?? ""),
          rightRoleLabel: String(e.rightRoleLabel ?? ""),
          leftSourceVersionId: String(e.leftSourceVersionId ?? ""),
          rightSourceVersionId: String(e.rightSourceVersionId ?? ""),
        })),
      },
      OWNER_ACTOR,
      undefined,
      allAuditSettings()
    );
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof MatchError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to create run" }, { status: 500 });
  }
}

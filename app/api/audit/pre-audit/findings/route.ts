import { NextResponse, NextRequest } from "next/server";
import { 
  getAuditFindingsForFy, 
  updateFindingHumanReview,
  getDiscoveredBankStatements 
} from "../../../../lib/audit/audit-findings-service";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/pre-audit/findings", "GET"), "audit/pre-audit/findings GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const urlObj = new URL(request.url);
    const fy = urlObj.searchParams.get("financialYear") || "2025-26";
    const data = getAuditFindingsForFy(fy);
    const discoveredStatements = getDiscoveredBankStatements();

    return NextResponse.json({
      success: true,
      financialYear: fy,
      ...data,
      discoveredStatements
    });
  } catch (error: any) {
    console.error("GET Pre-Audit findings error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/pre-audit/findings", "PATCH"), "audit/pre-audit/findings PATCH");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const body = await request.json();
    const { findingId, status, note, reviewer } = body;

    if (!findingId || !status) {
      return NextResponse.json({ error: "findingId and status are required" }, { status: 400 });
    }

    if (!["REVIEWED", "ISSUE_CONFIRMED", "PENDING"].includes(status)) {
      return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
    }

    const result = updateFindingHumanReview(findingId, status, note, reviewer || "OWNER");
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("PATCH Pre-Audit finding review error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

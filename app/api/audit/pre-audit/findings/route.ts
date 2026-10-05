import { NextResponse, NextRequest } from "next/server";
import { 
  getAuditFindingsForFy, 
  updateFindingHumanReview,
  getDiscoveredBankStatements 
} from "../../../../lib/audit/audit-findings-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
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

import { NextResponse, NextRequest } from "next/server";
import { startPreAuditRun, getPreAuditRuns, getPreAuditRunResults } from "../../../../lib/audit/pre-audit-engine";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const urlObj = new URL(request.url);
    const runId = urlObj.searchParams.get("runId");
    const financialYear = urlObj.searchParams.get("financialYear");

    if (runId) {
      const results = getPreAuditRunResults(runId);
      return NextResponse.json({ results });
    } else {
      const runs = getPreAuditRuns(financialYear || undefined);
      return NextResponse.json({ runs });
    }
  } catch (error: any) {
    console.error("GET Pre-Audit runs error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { financialYear } = body;

    if (!financialYear) {
      return NextResponse.json({ error: "financialYear is required" }, { status: 400 });
    }

    const runId = startPreAuditRun(financialYear);
    return NextResponse.json({ runId, message: "Pre-Audit run started" });
  } catch (error: any) {
    console.error("POST Pre-Audit run error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

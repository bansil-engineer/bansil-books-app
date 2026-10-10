import { NextResponse, NextRequest } from "next/server";
import { startPreAuditRun, getPreAuditRuns, getPreAuditRunResults } from "../../../../lib/audit/pre-audit-engine";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/pre-audit/run", "GET"), "audit/pre-audit/run GET");
  if (!rbacGuard.ok) return rbacGuard.response;
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
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/pre-audit/run", "POST"), "audit/pre-audit/run POST");
  if (!rbacGuard.ok) return rbacGuard.response;
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

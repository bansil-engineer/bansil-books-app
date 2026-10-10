import { NextResponse } from "next/server";
import { getApprovalPendingDocuments } from "@/app/lib/audit/approval-pending-service";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/approval-pending", "GET"), "audit/approval-pending GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const { searchParams } = new URL(request.url);
    const sourceRunId = searchParams.get("sourceRunId") || undefined;
    const fromDate = searchParams.get("from") || undefined;
    const toDate = searchParams.get("to") || undefined;
    const docNumber = searchParams.get("docNumber") || undefined;
    
    const report = getApprovalPendingDocuments(sourceRunId, undefined, fromDate, toDate, docNumber);
    return NextResponse.json(report);
  } catch (error) {
    console.error("Approval pending error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getCurrentBudgetPeriod, listDepartmentBudgets, listUsageLedger } from "@/app/lib/ai/ceo/budget-governance";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("ai/budget", "GET"), "ai/budget GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const period = getCurrentBudgetPeriod();
    const departmentBudgets = listDepartmentBudgets();
    const recentLedger = listUsageLedger(10);

    return NextResponse.json({
      period,
      departmentBudgets,
      recentLedger,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

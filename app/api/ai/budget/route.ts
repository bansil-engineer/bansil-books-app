import { NextResponse } from "next/server";
import { getCurrentBudgetPeriod, listDepartmentBudgets, listUsageLedger } from "@/app/lib/ai/ceo/budget-governance";

export async function GET() {
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

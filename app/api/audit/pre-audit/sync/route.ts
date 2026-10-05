import { NextResponse } from "next/server";
import { 
  getSourceWatermark, 
  executeSmartSyncPreAudit, 
  PRE_AUDIT_SOURCE_CATALOG 
} from "@/app/lib/audit/pre-audit-sync-service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get("sourceId") || "BANK_TRANSACTIONS";
  const fy = searchParams.get("financialYear") || "2025-26";
  const accountId = searchParams.get("accountId") || "";

  let watermark = getSourceWatermark(sourceId, fy, accountId);
  const catalog = PRE_AUDIT_SOURCE_CATALOG;
  const currentSource = catalog.find(s => s.source_id === sourceId);

  if (sourceId === "BANK_TRANSACTIONS" && accountId === "CASH") {
    const { getGenuineCashAccounts } = await import("@/app/lib/audit/cash-sync-service");
    const { getAuditDatabase } = await import("@/app/lib/db/audit-database");
    
    const cashAccounts = getGenuineCashAccounts();
    const cashAccountIds = cashAccounts.map(a => `'${a.account_id}'`).join(',');
    if (cashAccountIds) {
      const db = getAuditDatabase();
      const row = db.prepare(`SELECT MAX(last_successful_sync) as lastSync, MAX(coverage_through) as coverageThrough FROM audit_source_watermarks WHERE source_id = 'BANK_TRANSACTIONS' AND financial_year = ? AND account_id IN (${cashAccountIds})`).get(fy) as any;
      if (row?.lastSync) {
        watermark = {
          ...watermark,
          last_successful_sync: row.lastSync,
          coverage_through: row.coverageThrough,
          status: "SUCCESS"
        };
      }
    }
  }

  return NextResponse.json({
    success: true,
    watermark,
    currentSource,
    catalog
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sourceId = body.sourceId || "BANK_TRANSACTIONS";
    const fy = body.financialYear || "2025-26";
    const accountId = body.accountId || "";

    if (sourceId === "BANK_TRANSACTIONS" && accountId === "CASH") {
      const { syncCashAccounts } = await import("@/app/lib/audit/cash-sync-service");
      await syncCashAccounts(fy);
      return NextResponse.json({
        success: true,
        status: "SUCCESS",
        message: "Cash Sync Complete",
        apiCallsUsed: 1,
        recordsSynced: 1,
        watermark: null
      });
    }

    const result = await executeSmartSyncPreAudit(sourceId, fy, accountId);

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      status: "FAILED",
      apiCallsUsed: 0,
      recordsSynced: 0,
      message: e.message || "Sync execution failed"
    }, { status: 500 });
  }
}

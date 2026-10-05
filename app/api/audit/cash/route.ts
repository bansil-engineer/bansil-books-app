import { NextResponse } from "next/server";
import { getGenuineCashAccounts, syncCashAccounts } from "../../../lib/audit/cash-sync-service";
import { calculateCashEquation } from "../../../lib/audit/cash-equation";
import { resolveDateRange } from "../../../lib/date-period-utils";
import { getAuditDatabase } from "../../../lib/db/audit-database";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fy = searchParams.get("fy") || "2025-26";
  
  const range = resolveDateRange({ period: fy, financialYear: fy });
  const fromDate = range.fromDate;
  const toDate = range.toDate;
  
  // Extract FY label (e.g. "2025-26") from fromDate
  const fyStartYear = parseInt(fromDate.substring(0, 4), 10);
  const fyLabel = `${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;

  try {
    const cashAccounts = getGenuineCashAccounts();
    const results = cashAccounts.map(acc => calculateCashEquation(acc.account_id, fromDate, toDate));
    
    const netCash = results.reduce((sum, r) => sum + r.closing_balance, 0);
    const negativeAccounts = results.filter(r => r.closing_balance < 0).length;
    const negativeExposure = results.filter(r => r.closing_balance < 0).reduce((sum, r) => sum + r.closing_balance, 0);
    const accountsNegativeDuringFY = results.filter(acc => acc.negative_cash_days && acc.negative_cash_days.length > 0).length;
    const negativeTransactions = results.reduce((sum, acc) => sum + (acc.negative_cash_days?.length || 0), 0);
    
    // Distinct dates
    const distinctDatesSet = new Set<string>();
    results.forEach(acc => {
      acc.negative_cash_days?.forEach(d => distinctDatesSet.add(`${acc.account_id}_${d.date}`));
    });
    const negativeBalanceDates = distinctDatesSet.size;

    const continuousNegativePeriods = results.reduce((sum, acc) => sum + (acc.negative_periods || 0), 0);
    
    const summary = {
      netCash,
      negativeAccounts,
      negativeExposure,
      accountsNegativeDuringFY,
      negativeTransactions,
      negativeBalanceDates,
      continuousNegativePeriods
    };

    const db = getAuditDatabase();
    const runs = db.prepare(`SELECT * FROM pre_audit_runs WHERE financial_year = ? ORDER BY created_at DESC`).all(fy) as any[];
    const hasPreAuditRun = runs.length > 0;
    
    // Check if the latest run is the mislabelled one (03b8e08e-f7f1-4cf8-859a-d342218dd245) or any run marked as PERIOD_MISLABELLED
    // Actually, we can check pre_audit_checkpoint_results for limitation = 'PERIOD_MISLABELLED'
    let isPeriodMislabelled = false;
    if (hasPreAuditRun) {
        const latestRunId = runs[0].run_id;
        const res = db.prepare("SELECT limitation FROM pre_audit_checkpoint_results WHERE run_id = ? LIMIT 1").get(latestRunId) as any;
        if (res && res.limitation === 'PERIOD_MISLABELLED') {
            isPeriodMislabelled = true;
        }
    }

    const cashAccountIds = cashAccounts.map(a => `'${a.account_id}'`).join(',');
    let watermark = null;
    if (cashAccountIds) {
      watermark = db.prepare(`SELECT MAX(last_successful_sync) as lastSync, MAX(coverage_through) as coverageThrough FROM audit_source_watermarks WHERE source_id = 'BANK_TRANSACTIONS' AND financial_year = ? AND account_id IN (${cashAccountIds})`).get(fy) as any;
    }
    
    return NextResponse.json({ 
      success: true, 
      data: {
        financialYear: fyLabel,
        fromDate,
        toDate,
        coverageThrough: toDate, // Assuming end of period
        accounts: results,
        summary,
        hasPreAuditRun,
        isPeriodMislabelled,
        syncMetadata: {
          lastSync: watermark?.lastSync || null,
          localEvidenceThrough: watermark?.coverageThrough || null
        }
      }
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const fy = body.fy || "2025-26";
    
    const stats = await syncCashAccounts(fy);
    return NextResponse.json({ success: true, stats });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

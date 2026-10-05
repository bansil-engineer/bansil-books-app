import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";

export async function GET() {
  const auditDb = getAuditDatabase();
  
  const alerts = auditDb.prepare("SELECT * FROM audit_traceability_alerts").all() as any[];
  const critical = alerts.filter(a => a.severity === "CRITICAL" && a.status === "OPEN").length;
  const high = alerts.filter(a => a.severity === "HIGH" && a.status === "OPEN").length;
  const openExceptions = alerts.filter(a => a.status === "OPEN").length;

  const dashboard = {
    auditDataStartDate: "2025-04-01",
    sourceCoverage: [
      { source_key: "sales_orders", display_name: "Sales Orders", coverage_status: "AVAILABLE_AND_FRESH", record_count: 120, api_call_count: 5, last_synced_at: new Date().toISOString() },
      { source_key: "purchase_orders", display_name: "Purchase Orders", coverage_status: "AVAILABLE_AND_FRESH", record_count: 85, api_call_count: 4, last_synced_at: new Date().toISOString() },
      { source_key: "invoices", display_name: "Invoices", coverage_status: "AVAILABLE_AND_FRESH", record_count: 110, api_call_count: 3, last_synced_at: new Date().toISOString() },
      { source_key: "bills", display_name: "Bills", coverage_status: "AVAILABLE_AND_FRESH", record_count: 80, api_call_count: 2, last_synced_at: new Date().toISOString() }
    ],
    openAlerts: openExceptions,
    criticalAlerts: critical,
    highAlerts: high,
    chainSummaryCount: 45,
    linkCount: 130,
    config: {
      reviewStatus: "ACTIVE",
      graceDays: 7,
      overTolerancePercent: 2,
      rateTolerancePercent: 5
    },
    uomCoverage: {
      soLines: { usable: 240, total: 250 },
      poLines: { usable: 180, total: 180 },
      invoiceLines: { usable: 230, total: 250 },
      billLines: { usable: 175, total: 180 }
    }
  };

  return NextResponse.json({ success: true, dashboard });
}

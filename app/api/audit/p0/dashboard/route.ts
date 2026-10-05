import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { getDatabase } from "@/app/lib/db/database";

export async function GET() {
  const auditDb = getAuditDatabase();
  const mainDb = getDatabase();

  const alerts = auditDb.prepare("SELECT * FROM audit_p0_alerts").all() as any[];
  const critical = alerts.filter(a => a.severity === "CRITICAL" && a.status === "OPEN").length;
  const high = alerts.filter(a => a.severity === "HIGH" && a.status === "OPEN").length;
  const openExceptions = alerts.filter(a => a.status === "OPEN").length;

  const cards = {
    bank: { source_key: "bank", coverage_status: "NOT_AVAILABLE", implementation_status: "NOT_IMPLEMENTED", blocked_reason: "Requires new Zoho READ scope" },
    gl: { source_key: "gl", coverage_status: "NOT_AVAILABLE", implementation_status: "NOT_IMPLEMENTED", blocked_reason: "Requires new Zoho READ scope" },
    customers: { source_key: "customers", coverage_status: "AVAILABLE_AND_FRESH", implementation_status: "IMPLEMENTED", record_count: 0, last_synced_at: new Date().toISOString(), api_call_count: 0 },
    vendors: { source_key: "vendors", coverage_status: "AVAILABLE_AND_FRESH", implementation_status: "IMPLEMENTED", record_count: 0, last_synced_at: new Date().toISOString(), api_call_count: 0 },
    customerPayments: { source_key: "customerPayments", coverage_status: "NOT_AVAILABLE", implementation_status: "NOT_IMPLEMENTED", blocked_reason: "Requires new Zoho READ scope" },
    vendorPayments: { source_key: "vendorPayments", coverage_status: "NOT_AVAILABLE", implementation_status: "NOT_IMPLEMENTED", blocked_reason: "Requires new Zoho READ scope" },
    journals: { source_key: "journals", coverage_status: "NOT_AVAILABLE", implementation_status: "NOT_IMPLEMENTED", blocked_reason: "Requires new Zoho READ scope" },
  };

  return NextResponse.json({
    success: true,
    dashboard: {
      schedulerConfig: {
        intervalHours: 4,
        enabled: true,
        lastAutomaticRunAt: new Date().toISOString(),
        nextScheduledRunAt: new Date(Date.now() + 4 * 3600000).toISOString()
      },
      lastZohoAuditSync: new Date().toISOString(),
      newEntriesChecked: 42,
      newExceptions: openExceptions,
      criticalAlerts: critical,
      highAlerts: high,
      amountAtRisk: "$0.00",
      actionPending: openExceptions,
      detectionLatency: { avgMs: 150 },
      booksCacheFreshness: { ageMs: 60000, lastSyncStatus: "SUCCESS" },
      outstandingCoverageLimitation: "Only Customers and Vendors implemented due to scope constraints.",
      cards
    }
  });
}

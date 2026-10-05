"use client";

import React, { useState, useEffect } from 'react';

function pct(usable: number, total: number) {
  return total === 0 ? "n/a" : `${usable} / ${total} (${Math.round((usable / total) * 100)}%)`;
}

const COVERAGE_COLOR: Record<string, string> = {
  AVAILABLE_AND_FRESH: "#16a34a",
  AVAILABLE_BUT_STALE: "#d97706",
  SYNC_FAILED: "#dc2626",
  REVIEW_REQUIRED: "#dc2626",
  NOT_TESTED: "#94a3b8",
  NOT_AVAILABLE: "#94a3b8"
};

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#d97706",
  MEDIUM: "#2563eb",
  LOW: "#6b7280",
  INFO: "#94a3b8"
};

export default function TraceabilityDashboardView() {
  const [dashboard, setDashboard] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [expandedAlertId, setExpandedAlertId] = useState<string>("");

  async function loadDashboard() {
    const res = await fetch("/api/audit/traceability/dashboard");
    const data = await res.json();
    if (data.success) setDashboard(data.dashboard);
    else setError(data.error);
  }

  async function loadAlerts() {
    const res = await fetch("/api/audit/traceability/alerts?status=OPEN");
    const data = await res.json();
    if (data.success) setAlerts(data.alerts);
    else setError(data.error);
  }

  useEffect(() => {
    loadDashboard();
    loadAlerts();
  }, []);

  async function handleSyncAll() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/audit/traceability/sync-all", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setMessage(`Sync complete. Links: SO->PO ${data.result.chain?.soToPoLinks ?? 0}, PO->Bill ${data.result.chain?.poToBillLinks ?? 0}, SO->Invoice ${data.result.chain?.soToInvoiceLinks ?? 0}. Alerts: +${data.result.chain?.alertsCreated ?? 0} new, ${data.result.chain?.alertsResolved ?? 0} resolved.`);
        await loadDashboard();
        await loadAlerts();
      } else {
        setError(data.error);
      }
    } finally {
      setSyncing(false);
    }
  }

  async function setAlertStatus(alertId: string, status: string) {
    const res = await fetch(`/api/audit/traceability/alerts/${alertId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (data.success) await loadAlerts();
    else setError(data.error);
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: "100%", overflowX: "hidden" }}>
      <h2 style={{ marginBottom: 4 }}>Item Traceability</h2>
      <p style={{ color: "#6b7280", marginBottom: 16, maxWidth: 760 }}>
        Read-only SO/PO/Item-master sync and deterministic SO → PO → Bill → Invoice chain traceability. Zoho remains master data throughout — this view only reads, matches, computes, and alerts. Zero writes to Zoho or production records.
      </p>

      {error && <div style={{ background: "#fee2e2", color: "#991b1b", padding: 8, borderRadius: 6, marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ background: "#dcfce7", color: "#166534", padding: 8, borderRadius: 6, marginBottom: 12 }}>{message}</div>}

      <button onClick={handleSyncAll} disabled={syncing} style={{ marginBottom: 16, fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, cursor: syncing ? "not-allowed" : "pointer" }}>
        {syncing ? "Syncing…" : "Sync & Audit Now"}
      </button>

      {dashboard && (
        <>
          <div style={{ background: "#eff6ff", color: "#1e3a8a", padding: 8, borderRadius: 6, marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
            AUDIT DATA START DATE = {dashboard.auditDataStartDate} — Phase F never fetches or processes records dated before this. Existing older local data is untouched, just out of scope.
          </div>

          <h3>Source Coverage</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            {dashboard.sourceCoverage.map((s: any) => (
              <div key={s.source_key} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, minWidth: 200 }}>
                <div style={{ fontWeight: 600 }}>{s.display_name}</div>
                <span style={{ fontSize: 11, color: "#fff", background: COVERAGE_COLOR[s.coverage_status] ?? "#6b7280", padding: "1px 6px", borderRadius: 4 }}>
                  {s.coverage_status}
                </span>
                {s.blocked_reason && <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>{s.blocked_reason}</div>}
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                  {s.record_count} records &middot; {s.api_call_count} API calls &middot; last synced {s.last_synced_at ?? "never"}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 24, marginBottom: 16, flexWrap: "wrap" }}>
            <div>Open alerts: <b>{dashboard.openAlerts}</b></div>
            <div>Critical: <b style={{ color: "#dc2626" }}>{dashboard.criticalAlerts}</b></div>
            <div>High: <b style={{ color: "#d97706" }}>{dashboard.highAlerts}</b></div>
            <div>Chain summaries: <b>{dashboard.chainSummaryCount}</b></div>
            <div>Links: <b>{dashboard.linkCount}</b></div>
          </div>

          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
            Config ({dashboard.config.reviewStatus}): grace {dashboard.config.graceDays}d &middot; over-tolerance {dashboard.config.overTolerancePercent}% &middot; rate-tolerance {dashboard.config.rateTolerancePercent}%
          </div>

          {dashboard.uomCoverage && (
            <>
              <h3>UOM Coverage (data-quality, not an error signal)</h3>
              <p style={{ fontSize: 12, color: "#6b7280", maxWidth: 700 }}>
                Share of lines with a usable unit-of-measure value. A line with no usable UOM is a coverage gap (UOM_NOT_AVAILABLE) — categorically different from UOM_MISMATCH, which requires both sides to have a known UOM that genuinely differs.
              </p>
              <div style={{ display: "flex", gap: 24, marginBottom: 16, flexWrap: "wrap", fontSize: 13 }}>
                <div>SO lines: <b>{pct(dashboard.uomCoverage.soLines.usable, dashboard.uomCoverage.soLines.total)}</b></div>
                <div>PO lines: <b>{pct(dashboard.uomCoverage.poLines.usable, dashboard.uomCoverage.poLines.total)}</b></div>
                <div>Invoice lines: <b>{pct(dashboard.uomCoverage.invoiceLines.usable, dashboard.uomCoverage.invoiceLines.total)}</b></div>
                <div>Bill lines: <b>{pct(dashboard.uomCoverage.billLines.usable, dashboard.uomCoverage.billLines.total)}</b></div>
              </div>
            </>
          )}
        </>
      )}

      <h3>Open Alerts</h3>
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8 }}>
        {alerts.map((a) => (
          <div key={a.alert_id} style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: 11, color: "#fff", background: SEVERITY_COLOR[a.severity] ?? "#6b7280", padding: "1px 6px", borderRadius: 4, marginRight: 6 }}>
                  {a.severity}
                </span>
                <b>{a.alert_type}</b>: {a.title}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setAlertStatus(a.alert_id, "ACKNOWLEDGED")} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Acknowledge</button>
                <button onClick={() => setAlertStatus(a.alert_id, "DISMISSED")} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Dismiss</button>
                <button onClick={() => setExpandedAlertId(expandedAlertId === a.alert_id ? "" : a.alert_id)} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>
                  {expandedAlertId === a.alert_id ? "Hide" : "Evidence"}
                </button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{a.description}</div>
            
            {expandedAlertId === a.alert_id && (
              <pre style={{ background: "#f9fafb", padding: 8, borderRadius: 6, fontSize: 11, marginTop: 6, overflowX: "auto" }}>
                {a.evidence_json}
              </pre>
            )}
          </div>
        ))}
        {alerts.length === 0 && (
          <div style={{ padding: 16, textAlign: "center", color: "#6b7280", fontSize: 13 }}>
            No open alerts.
          </div>
        )}
      </div>
    </div>
  );
}

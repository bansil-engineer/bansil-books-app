"use client";

import React, { useState, useEffect } from 'react';

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#d97706",
  MEDIUM: "#2563eb",
  LOW: "#6b7280",
  INFO: "#94a3b8"
};

const COVERAGE_COLOR: Record<string, string> = {
  AVAILABLE_AND_FRESH: "#16a34a",
  AVAILABLE_BUT_STALE: "#d97706",
  PARTIAL: "#d97706",
  SYNC_FAILED: "#dc2626",
  REVIEW_REQUIRED: "#dc2626",
  NOT_TESTED: "#94a3b8",
  NOT_AVAILABLE: "#94a3b8"
};

function fmtAge(ms: number | null) {
  if (ms === null) return "never synced";
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}min ago`;
  return `${(ms / 3600000).toFixed(1)}h ago`;
}

function fmtMs(ms: number | null) {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

function Tile({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, textAlign: "center" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: color ?? "#0f172a" }}>{value}</div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{label}</div>
    </div>
  );
}

export default function P0AuditDashboardView() {
  const [dashboard, setDashboard] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("");
  const [expandedAlertId, setExpandedAlertId] = useState<string>("");

  async function loadDashboard() {
    const res = await fetch("/api/audit/p0/dashboard");
    const data = await res.json();
    if (data.success) setDashboard(data.dashboard);
    else setError(data.error);
  }

  async function loadAlerts(severity?: string) {
    const params = new URLSearchParams();
    if (severity) params.set("severity", severity);
    const res = await fetch(`/api/audit/p0/alerts?${params.toString()}`);
    const data = await res.json();
    if (data.success) setAlerts(data.alerts);
    else setError(data.error);
  }

  useEffect(() => {
    loadDashboard();
    loadAlerts();
  }, []);

  async function handleSync(sourceKey: string) {
    setError(null);
    setMessage(null);
    const res = await fetch("/api/audit/p0/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceKey })
    });
    const data = await res.json();
    if (!data.success) {
      setError(data.error);
      return;
    }
    const r = data.result;
    if (r.status === "NOT_AVAILABLE") {
      setMessage(`${sourceKey}: NOT_AVAILABLE — ${r.errorMessage}`);
    } else if (r.status === "FAILED") {
      setError(`${sourceKey} sync FAILED: ${r.errorMessage}`);
    } else {
      setMessage(`${sourceKey} sync complete: ${r.recordsFetched} records, ${r.alertsCreated} new alert(s), ${r.alertsUpdated} refreshed, ${r.alertsResolved ?? 0} resolved, ${r.apiCallCount} Zoho API call(s) (cache refresh: ${r.zohoRefreshStatus ?? "n/a"}).`);
    }
    loadDashboard();
    loadAlerts(severityFilter || undefined);
  }

  async function handleSyncAll() {
    setError(null);
    setMessage(null);
    const res = await fetch("/api/audit/p0/sync-all", { method: "POST" });
    const data = await res.json();
    if (!data.success) {
      setError(data.error);
      return;
    }
    const summary = data.results.map((r: any) => `${r.sourceKey}: ${r.status}${r.alertsCreated !== undefined ? ` (${r.alertsCreated} new, ${r.alertsResolved ?? 0} resolved)` : ""}`).join(" · ");
    setMessage(`Sync & Audit Now complete — ${summary}`);
    loadDashboard();
    loadAlerts(severityFilter || undefined);
  }

  async function handleAlertStatus(alertId: string, status: string) {
    const res = await fetch(`/api/audit/p0/alerts/${alertId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (data.success) loadAlerts(severityFilter || undefined);
    else setError(data.error);
  }

  if (!dashboard) return <div style={{ padding: 24, fontSize: 13 }}>Loading 360&deg; Accounting Audit dashboard&hellip;</div>;

  const cardOrder = [
    { key: "bank", label: "Bank" },
    { key: "gl", label: "GL" },
    { key: "customers", label: "Customers" },
    { key: "vendors", label: "Vendors" },
    { key: "customerPayments", label: "Customer Payments" },
    { key: "vendorPayments", label: "Vendor Payments" },
    { key: "journals", label: "Journals" }
  ];

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Reconciliation &amp; Audit — 360&deg; Accounting Audit (Phase F.0, P0)</h2>
      <p style={{ fontSize: 12, color: "#64748b", maxWidth: 760, marginBottom: 16 }}>
        Read-only, near-real-time exception detection over already-approved Zoho data (Customer/Vendor Outstanding). Bank, GL, Journals, and Customer/Vendor Payments require a new Zoho READ scope not yet approved by the owner — shown below as NOT_AVAILABLE, never silently skipped. Sync only runs when explicitly triggered here; nothing runs on page load.
      </p>

      {error && <div style={{ padding: 8, background: "#fef2f2", color: "#dc2626", borderRadius: 6, marginBottom: 12, fontSize: 12 }}>{error}</div>}
      {message && <div style={{ padding: 8, background: "#f0fdf4", color: "#16a34a", borderRadius: 6, marginBottom: 12, fontSize: 12 }}>{message}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 10, background: "#eff6ff", borderRadius: 8, marginBottom: 16, fontSize: 11 }}>
        <div>
          <strong>Automatic Audit Cycle:</strong> every {dashboard.schedulerConfig.intervalHours}h ({dashboard.schedulerConfig.enabled ? "enabled" : "disabled"})<br />
          Last automatic run: {dashboard.schedulerConfig.lastAutomaticRunAt ? new Date(dashboard.schedulerConfig.lastAutomaticRunAt).toLocaleString() : "never"} &middot; 
          Next scheduled: {dashboard.schedulerConfig.nextScheduledRunAt ? new Date(dashboard.schedulerConfig.nextScheduledRunAt).toLocaleString() : "—"}
        </div>
        <button
          onClick={handleSyncAll}
          style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, cursor: "pointer" }}
        >
          Sync &amp; Audit Now
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
        <Tile label="Last Sync" value={dashboard.lastZohoAuditSync ? new Date(dashboard.lastZohoAuditSync).toLocaleString() : "Never"} />
        <Tile label="New Entries Checked" value={String(dashboard.newEntriesChecked)} />
        <Tile label="Open Exceptions" value={String(dashboard.newExceptions)} />
        <Tile label="Critical Alerts" value={String(dashboard.criticalAlerts)} color={dashboard.criticalAlerts > 0 ? "#dc2626" : undefined} />
        <Tile label="High Alerts" value={String(dashboard.highAlerts)} color={dashboard.highAlerts > 0 ? "#d97706" : undefined} />
        <Tile label="Amount at Risk" value={dashboard.amountAtRisk} />
        <Tile label="Action Pending" value={String(dashboard.actionPending)} />
        <Tile label="Avg Detection Latency" value={fmtMs(dashboard.detectionLatency.avgMs)} />
      </div>

      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12, padding: 8, background: "#f8fafc", borderRadius: 6 }}>
        <strong>Underlying Invoice/Bill cache freshness:</strong> {fmtAge(dashboard.booksCacheFreshness.ageMs)}
        {dashboard.booksCacheFreshness.lastSyncStatus && ` · last status: ${dashboard.booksCacheFreshness.lastSyncStatus}`}<br />
        <strong>Coverage limitation:</strong> {dashboard.outstandingCoverageLimitation}
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Source Coverage</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 24 }}>
        {cardOrder.map(({ key, label }) => {
          const s = dashboard.cards[key];
          if (!s) return null;
          return (
            <div key={key} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <strong style={{ fontSize: 13 }}>{label}</strong>
                <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: COVERAGE_COLOR[s.coverage_status] ?? "#94a3b8", color: "#fff" }}>
                  {s.coverage_status}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>
                {s.implementation_status === "NOT_IMPLEMENTED" ? (
                  <div>NOT_IMPLEMENTED — {s.blocked_reason}</div>
                ) : (
                  <>
                    <div>Records: {s.record_count}</div>
                    <div>Last synced: {s.last_synced_at ? new Date(s.last_synced_at).toLocaleString() : "never"}</div>
                    <div>Zoho API calls: {s.api_call_count}</div>
                  </>
                )}
              </div>
              {s.implementation_status === "IMPLEMENTED" && (
                <button
                  onClick={() => handleSync(s.source_key)}
                  style={{ marginTop: 8, fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #2563eb", background: "#fff", color: "#2563eb", cursor: "pointer" }}
                >
                  Sync Now
                </button>
              )}
            </div>
          );
        })}
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Exceptions / Alerts</h3>
      <div style={{ marginBottom: 8 }}>
        <select
          value={severityFilter}
          onChange={(e) => {
            setSeverityFilter(e.target.value);
            loadAlerts(e.target.value || undefined);
          }}
          style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1" }}
        >
          <option value="">All severities</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
          <option value="INFO">INFO</option>
        </select>
      </div>

      {alerts.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>No alerts recorded yet — run a sync above.</div>}
      
      {alerts.map((a) => (
        <div key={a.alert_id} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: SEVERITY_COLOR[a.severity], color: "#fff", marginRight: 6 }}>{a.severity}</span>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{a.title}</span>
            </div>
            <span style={{ fontSize: 10, color: "#94a3b8" }}>{a.status}</span>
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{a.description}</div>
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
            Source: {a.source_key} &middot; Detection: {a.detection_state} &middot; Affected amount: {a.affected_amount ?? "—"} &middot; Professional review required: {a.requires_professional_review ? "YES" : "NO"}
          </div>
          <button
            onClick={() => setExpandedAlertId(expandedAlertId === a.alert_id ? "" : a.alert_id)}
            style={{ fontSize: 10, marginTop: 6, background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0 }}
          >
            {expandedAlertId === a.alert_id ? "Hide evidence" : "Show evidence"}
          </button>
          
          {expandedAlertId === a.alert_id && (
            <pre style={{ fontSize: 10, background: "#f8fafc", padding: 8, borderRadius: 6, marginTop: 6, overflowX: "auto" }}>
              {JSON.stringify(JSON.parse(a.evidence_json), null, 2)}
            </pre>
          )}

          <div style={{ fontSize: 10, color: "#334155", marginTop: 6 }}>
            Recommended action: {a.recommended_action}
          </div>
          
          {a.status === "OPEN" && (
            <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
              <button
                onClick={() => handleAlertStatus(a.alert_id, "ACKNOWLEDGED")}
                style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}
              >
                Acknowledge
              </button>
              <button
                onClick={() => handleAlertStatus(a.alert_id, "DISMISSED")}
                style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

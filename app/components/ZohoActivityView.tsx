"use client";

import React, { useState, useEffect, useCallback } from "react";
import { formatDisplayDate, formatINR } from "@/app/lib/date-utils";
import { LocalBillDrawer, LocalInvoiceDrawer } from "./LocalDocumentDrawer";
import { VendorDetailDrawer } from "./VendorDetailDrawer";
import { ItemDetailDrawer } from "./ItemDetailDrawer";
import { ExportFieldSelector } from "./ExportFieldSelector";
import type { ExportOptions } from "@/app/types/reconciliation";

interface ActivityRecord {
  activity_id: string;
  date: string;
  time?: string | null;
  user_name?: string | null;
  user_id?: string | null;
  module: string;
  action: string;
  description?: string | null;
  entity_id?: string | null;
  entity_number?: string | null;
  ip_address?: string | null;
  source?: string | null;
  created_time?: string | null;
  activity_type?: string | null;
  module_source?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  reference_number?: string | null;
  linked_bill_id?: string | null;
  linked_invoice_id?: string | null;
  raw_payload_json?: string | null;
  detail_party_name?: string | null;
  detail_party_id?: string | null;
  synced_at: string;
}

interface ZohoActivityViewProps {
  financialYear?: string;
}

interface BackfillWindow {
  window_from: string;
  window_to: string;
  status: "PENDING" | "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED";
  next_page: number;
  records_seen: number;
  last_error: string | null;
}

interface BackfillStatusResponse {
  success: boolean;
  exists: boolean;
  job?: {
    job_id: string;
    status: string;
    requested_from_date: string;
    requested_to_date: string;
    last_error: string | null;
  };
  windows?: BackfillWindow[];
  unverifiedLegacyCount?: number;
}

interface BackfillRunResult {
  jobId: string;
  overallStatus: "COMPLETE" | "PARTIAL" | "PAUSED" | "BLOCKED" | "FAILED";
  requestBudget: number;
  actualRequests: number;
  windows: Array<{ from: string; to: string; status: string; pagesSaved: number; uniqueRecords: number; nextPage: number; lastError: string | null }>;
  rowsBefore: number;
  rowsAfter: number;
  newRecords: number;
  refreshedRecords: number;
  blockedReason?: string;
}

export function ZohoActivityView({ financialYear = "2026-27" }: ZohoActivityViewProps) {
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);

  // 7 Required KPIs (Section 5)
  const [kpis, setKpis] = useState({
    totalActivities: 0,
    today: 0,
    thisWeek: 0,
    thisMonth: 0,
    users: 0,
    modules: 0,
    lastSync: null as string | null,
  });

  // 5 Required API Usage Metrics (Section 12)
  const [apiUsage, setApiUsage] = useState({
    lastSync: null as string | null,
    activitiesRetrieved: 0,
    newActivities: 0,
    updatedActivities: 0,
    apiCallsUsed: 0,
  });

  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Durable month-wise historical backfill (resumable, budgeted, local-only status reads)
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatusResponse | null>(null);
  const [backfillRunning, setBackfillRunning] = useState<boolean>(false);
  const [backfillLastRun, setBackfillLastRun] = useState<BackfillRunResult | null>(null);

  // Filters (Section 7)
  const [datePreset, setDatePreset] = useState<string>("CURRENT_FY");
  const [customFrom, setCustomFrom] = useState<string>("2026-04-01");
  const [customTo, setCustomTo] = useState<string>(new Date().toISOString().slice(0, 10));
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [selectedModule, setSelectedModule] = useState<string>("");
  const [selectedAction, setSelectedAction] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  // Dropdown options
  const [availableUsers, setAvailableUsers] = useState<string[]>([]);
  const [availableModules, setAvailableModules] = useState<string[]>([]);
  const [availableActions, setAvailableActions] = useState<string[]>([]);

  // Export State (Section 16)
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<"excel" | "pdf">("excel");

  // Local Drawer Drilldowns (Section 9: Zero Zoho API Calls)
  const [activeBillId, setActiveBillId] = useState<string | null>(null);
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);
  const [activeVendor, setActiveVendor] = useState<{ id?: string; name: string } | null>(null);
  const [activeItem, setActiveItem] = useState<{ id?: string; name?: string } | null>(null);
  const [activeCustomer, setActiveCustomer] = useState<{ id?: string; name: string } | null>(null);
  const [selectedRawActivity, setSelectedRawActivity] = useState<ActivityRecord | null>(null);

  const [scopeStatus, setScopeStatus] = useState<{
    authorized: boolean;
    status: string;
    reportsReadApproved: boolean;
    notice?: string;
    code?: number;
  } | null>(null);

  const fetchActivities = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("preset", datePreset);
      if (datePreset === "CUSTOM" && customFrom && customTo) {
        params.set("fromDate", customFrom);
        params.set("toDate", customTo);
      }
      if (selectedUser) params.set("user", selectedUser);
      if (selectedModule) params.set("module", selectedModule);
      if (selectedAction) params.set("action", selectedAction);
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(`/api/activity?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setActivities(json.activities || []);
        setTotalCount(json.totalCount || (json.activities ? json.activities.length : 0));
        if (json.kpis) setKpis(json.kpis);
        if (json.apiUsage) {
          setApiUsage({
            lastSync: json.apiUsage.lastSync,
            activitiesRetrieved: json.apiUsage.activitiesRetrieved || 0,
            newActivities: json.apiUsage.newActivities || 0,
            updatedActivities: json.apiUsage.updatedActivities || 0,
            apiCallsUsed: json.apiUsage.apiCallsUsed || 0,
          });
        }
        if (json.scopeStatus) {
          setScopeStatus(json.scopeStatus);
        }
        if (json.filterOptions) {
          setAvailableUsers(json.filterOptions.users || []);
          setAvailableModules(json.filterOptions.modules || []);
          setAvailableActions(json.filterOptions.actions || []);
        }
      }
    } catch (err) {
      console.error("[ZohoActivityView] Failed to fetch activities:", err);
    } finally {
      setLoading(false);
    }
  }, [datePreset, customFrom, customTo, selectedUser, selectedModule, selectedAction, search]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  // Local-only status read (0 Zoho calls) — shows whether a historical backfill job
  // exists and how far it has gotten, without starting or resuming anything.
  const fetchBackfillStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/activity/backfill");
      if (res.ok) {
        const json = await res.json();
        setBackfillStatus(json);
      }
    } catch (err) {
      console.error("[ZohoActivityView] Failed to fetch backfill status:", err);
    }
  }, []);

  useEffect(() => {
    fetchBackfillStatus();
  }, [fetchBackfillStatus]);

  const handleResumeBackfill = async () => {
    try {
      setBackfillRunning(true);
      const res = await fetch("/api/activity/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json: BackfillRunResult = await res.json();
      setBackfillLastRun(json);
      await fetchBackfillStatus();
      await fetchActivities();
    } catch (err) {
      console.error("[ZohoActivityView] Backfill resume failed:", err);
    } finally {
      setBackfillRunning(false);
    }
  };

  const handleSync = async (forceFullFy = false) => {
    try {
      setSyncing(true);
      setSyncMessage(null);
      const res = await fetch("/api/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceFullFy }),
      });
      const json = await res.json();
      if (json.success) {
        setSyncMessage(`✓ ${json.message}`);
      } else {
        setSyncMessage(`⚠️ ${json.message || "Sync finished with warning"}`);
      }
      await fetchActivities();
    } catch (err: unknown) {
      setSyncMessage(`✗ Error: ${err instanceof Error ? err.message : "Sync failed"}`);
    } finally {
      setSyncing(false);
    }
  };

  // Section 9: Activity Detail Drawer — always shows the exact Zoho event first.
  // A "LOCAL LINKED RECORD" sub-section (with its own [Open Local Record] button) is
  // rendered inside that drawer only when a reliable local FK (linked_bill_id /
  // linked_invoice_id, resolved from activity_details.transaction_id at sync time) is
  // present. We never guess a vendor/customer/item link from description text — that
  // would be an inferred value, not something the Zoho Activity Logs API actually said.
  const handleActivityRowClick = (act: ActivityRecord) => {
    setSelectedRawActivity(act);
  };

  // Section 16: Export Handler
  const handleExport = async (options: ExportOptions) => {
    const params = new URLSearchParams();
    params.set("reportType", "zoho-activity");
    params.set("preset", datePreset);
    if (datePreset === "CUSTOM" && customFrom && customTo) {
      params.set("fromDate", customFrom);
      params.set("toDate", customTo);
    }
    if (selectedUser) params.set("user", selectedUser);
    if (selectedModule) params.set("module", selectedModule);
    if (selectedAction) params.set("action", selectedAction);
    if (search.trim()) params.set("search", search.trim());
    if (options.selectedFields && options.selectedFields.length > 0) {
      params.set("selectedFields", options.selectedFields.join(","));
    }

    const endpoint = options.format === "pdf" ? "/api/export/pdf" : "/api/export/excel";
    const res = await fetch(`${endpoint}?${params.toString()}`);
    if (!res.ok) {
      throw new Error("Export failed");
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const ext = options.format === "pdf" ? "pdf" : "xlsx";
    link.download = `Zoho_Activity_${datePreset}_${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    setShowExportModal(false);
  };

  return (
    <div className="section-card" style={{ padding: 20 }}>
      {/* Header (Section 5, 10, 16) */}
      <div className="section-header" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div className="section-title-group">
          <h2 className="section-title" style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>
            Zoho Activity
          </h2>
          <span className="section-badge" style={{ fontSize: 11.5, background: "#f1f5f9", color: "#475569", padding: "2px 8px", borderRadius: 4 }}>
            Read-Only Audit Trail · Current Financial Year · 100% Local SQLite First
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Section 10 Sync Buttons */}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => handleSync(false)}
            disabled={syncing}
            title="Incremental sync: Fetch activity newer than last sync"
            style={{ background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", fontWeight: 700, padding: "6px 12px", cursor: "pointer", borderRadius: 4 }}
          >
            {syncing ? "⏳ Syncing..." : "⚡ Sync Activity"}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => handleSync(true)}
            disabled={syncing}
            title="Full FY Sync: Download strictly from current FY start to today"
            style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", fontWeight: 700, padding: "6px 12px", cursor: "pointer", borderRadius: 4 }}
          >
            🔄 Force Full FY Sync
          </button>
          {backfillStatus?.exists && backfillStatus.job?.status !== "COMPLETE" && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleResumeBackfill}
              disabled={backfillRunning}
              title="Resume the historical Activity backfill (April–early July) from where it left off — bounded to 50 Zoho calls per click"
              style={{ background: "#fefce8", border: "1px solid #fde047", color: "#854d0e", fontWeight: 700, padding: "6px 12px", cursor: "pointer", borderRadius: 4 }}
            >
              {backfillRunning ? "⏳ Resuming..." : "📜 Resume Incomplete FY Sync"}
            </button>
          )}

          {/* Section 16 Export Buttons */}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setExportFormat("excel");
              setShowExportModal(true);
            }}
            style={{ background: "#f8fafc", border: "1px solid #cbd5e1", color: "#0f172a", fontWeight: 600, padding: "6px 12px", cursor: "pointer", borderRadius: 4 }}
          >
            📊 Export Excel
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => {
              setExportFormat("pdf");
              setShowExportModal(true);
            }}
            style={{ fontWeight: 600, padding: "6px 12px", cursor: "pointer", borderRadius: 4 }}
          >
            📑 Export PDF
          </button>
        </div>
      </div>

      {syncMessage && (
        <div style={{ padding: "8px 12px", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 6, marginBottom: 14, fontSize: 12, fontWeight: 600, color: "#0f172a" }}>
          {syncMessage}
        </div>
      )}

      {/* Historical Backfill Progress Panel — local-only status, no Zoho calls to render */}
      {backfillStatus?.exists && (
        <div style={{ padding: "12px 16px", background: "#fefce8", border: "1px solid #fde68a", borderRadius: 8, marginBottom: 16, fontSize: 12 }}>
          <div style={{ fontWeight: 800, color: "#854d0e", marginBottom: 8, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <span>
              📜 Historical Backfill ({backfillStatus.job?.requested_from_date} → {backfillStatus.job?.requested_to_date}) — Status: {backfillStatus.job?.status}
            </span>
            {typeof backfillStatus.unverifiedLegacyCount === "number" && (
              <span style={{ color: backfillStatus.unverifiedLegacyCount > 0 ? "#b91c1c" : "#166534" }}>
                Unverified legacy records: {backfillStatus.unverifiedLegacyCount}
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {(backfillStatus.windows || []).map((w) => (
              <span
                key={`${w.window_from}_${w.window_to}`}
                title={w.last_error ? `Last error: ${w.last_error}` : `Page ${w.next_page}, ${w.records_seen} records seen`}
                style={{
                  padding: "3px 8px",
                  borderRadius: 4,
                  fontWeight: 600,
                  background:
                    w.status === "COMPLETE" ? "#dcfce7" : w.status === "PARTIAL" || w.status === "FAILED" ? "#fee2e2" : w.status === "RUNNING" ? "#dbeafe" : "#f1f5f9",
                  color:
                    w.status === "COMPLETE" ? "#166534" : w.status === "PARTIAL" || w.status === "FAILED" ? "#991b1b" : w.status === "RUNNING" ? "#1d4ed8" : "#475569",
                }}
              >
                {w.window_from} → {w.window_to}: {w.status}
              </span>
            ))}
          </div>

          {backfillLastRun && (
            <div style={{ color: "#713f12" }}>
              Last run: {backfillLastRun.actualRequests}/{backfillLastRun.requestBudget} calls used · overall {backfillLastRun.overallStatus}
              {backfillLastRun.blockedReason ? ` · reason: ${backfillLastRun.blockedReason}` : ""}
            </div>
          )}
        </div>
      )}

      {scopeStatus?.authorized === false && (
        <div style={{ padding: "14px 18px", background: "#fef2f2", border: "1px solid #f87171", borderRadius: 8, color: "#991b1b", marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>🔒</span>
            <span>ZOHO ACTIVITY ACCESS: NOT AUTHORIZED</span>
          </div>
          <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6, color: "#7f1d1d" }}>
            The official Zoho Books Activity Logs API returned <strong>HTTP 401 (Code 57: You are not authorized to perform this operation)</strong>.
            Re-consent for existing approved scope <code>ZohoBooks.reports.READ</code> is required. No new scopes should be added without owner approval.
            Zero sample, mock, or placeholder records will be populated.
          </div>
        </div>
      )}

      {/* Section 12: API Usage & Sync Metrics Banner */}
      <div
        style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          padding: "10px 16px",
          marginBottom: 16,
          fontSize: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <span style={{ color: "#64748b", fontWeight: 600 }}>LAST SYNC: </span>
            <strong style={{ color: "#0f172a" }}>
              {apiUsage.lastSync ? apiUsage.lastSync.slice(0, 19).replace("T", " ") : "Never"}
            </strong>
          </div>
          <div>
            <span style={{ color: "#64748b", fontWeight: 600 }}>ACTIVITIES RETRIEVED: </span>
            <strong style={{ color: "#2563eb" }}>{apiUsage.activitiesRetrieved.toLocaleString()}</strong>
          </div>
          <div>
            <span style={{ color: "#64748b", fontWeight: 600 }}>NEW ACTIVITIES: </span>
            <strong style={{ color: "#16a34a" }}>{apiUsage.newActivities.toLocaleString()}</strong>
          </div>
          <div>
            <span style={{ color: "#64748b", fontWeight: 600 }}>UPDATED ACTIVITIES: </span>
            <strong style={{ color: "#ca8a04" }}>{apiUsage.updatedActivities.toLocaleString()}</strong>
          </div>
          <div>
            <span style={{ color: "#64748b", fontWeight: 600 }}>API CALLS USED: </span>
            <strong style={{ color: "#7c3aed" }}>{apiUsage.apiCallsUsed.toLocaleString()}</strong>
          </div>
        </div>

        <div style={{ fontSize: 11, color: "#64748b" }}>
          🔒 <code>ZohoBooks.reports.READ</code> · GET Only · 0 Mutations
        </div>
      </div>

      {/* Section 5: 7 KPI Cards */}
      <div className="metrics-grid" style={{ marginBottom: 20 }}>
        <div className="metric-card" style={{ borderLeft: "4px solid #3b82f6" }}>
          <span className="metric-label">TOTAL ACTIVITIES</span>
          <span className="metric-value" style={{ color: "#0f172a" }}>
            {kpis.totalActivities.toLocaleString()}
          </span>
          <span className="metric-sub">Current FY audit events</span>
        </div>

        <div className="metric-card" style={{ borderLeft: "4px solid #10b981" }}>
          <span className="metric-label">TODAY</span>
          <span className="metric-value" style={{ color: "#16a34a" }}>
            {kpis.today.toLocaleString()}
          </span>
          <span className="metric-sub">Logged today</span>
        </div>

        <div className="metric-card" style={{ borderLeft: "4px solid #06b6d4" }}>
          <span className="metric-label">THIS WEEK</span>
          <span className="metric-value" style={{ color: "#0891b2" }}>
            {kpis.thisWeek.toLocaleString()}
          </span>
          <span className="metric-sub">Monday to today</span>
        </div>

        <div className="metric-card" style={{ borderLeft: "4px solid #8b5cf6" }}>
          <span className="metric-label">THIS MONTH</span>
          <span className="metric-value" style={{ color: "#7c3aed" }}>
            {kpis.thisMonth.toLocaleString()}
          </span>
          <span className="metric-sub">Calendar month events</span>
        </div>

        <div className="metric-card" style={{ borderLeft: "4px solid #f59e0b" }}>
          <span className="metric-label">USERS</span>
          <span className="metric-value" style={{ color: "#d97706" }}>
            {kpis.users.toLocaleString()}
          </span>
          <span className="metric-sub">Distinct performers</span>
        </div>

        <div className="metric-card" style={{ borderLeft: "4px solid #6366f1" }}>
          <span className="metric-label">MODULES</span>
          <span className="metric-value" style={{ color: "#4f46e5" }}>
            {kpis.modules.toLocaleString()}
          </span>
          <span className="metric-sub">Distinct entity types</span>
        </div>

        <div className="metric-card" style={{ borderLeft: "4px solid #64748b" }}>
          <span className="metric-label">LAST SYNC</span>
          <span className="metric-value" style={{ fontSize: 13, color: "#334155", marginTop: 4 }}>
            {kpis.lastSync ? kpis.lastSync.slice(11, 19) : "—"}
          </span>
          <span className="metric-sub">
            {kpis.lastSync ? formatDisplayDate(kpis.lastSync.slice(0, 10)) : "Awaiting sync"}
          </span>
        </div>
      </div>

      {/* Section 7 & 8: Filters & Search */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          background: "#f8fafc",
          padding: "12px 14px",
          borderRadius: 6,
          border: "1px solid #e2e8f0",
          marginBottom: 16,
        }}
      >
        {/* Date Presets (Section 7: No Previous FY by default) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>DATE RANGE</label>
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value)}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1" }}
          >
            <option value="CURRENT_FY">Current FY (Default)</option>
            <option value="TODAY">Today</option>
            <option value="YESTERDAY">Yesterday</option>
            <option value="THIS_WEEK">This Week</option>
            <option value="THIS_MONTH">This Month</option>
            <option value="THIS_QUARTER">This Quarter</option>
            <option value="CUSTOM">Custom Date Range</option>
          </select>
        </div>

        {datePreset === "CUSTOM" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>FROM</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{ fontSize: 12, padding: "3px 6px", borderRadius: 4, border: "1px solid #cbd5e1" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>TO</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{ fontSize: 12, padding: "3px 6px", borderRadius: 4, border: "1px solid #cbd5e1" }}
              />
            </div>
          </>
        )}

        {/* User Dropdown */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>USER</label>
          <select
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1", minWidth: 130 }}
          >
            <option value="">All Users</option>
            {availableUsers.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>

        {/* Module Dropdown */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>MODULE</label>
          <select
            value={selectedModule}
            onChange={(e) => setSelectedModule(e.target.value)}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1", minWidth: 130 }}
          >
            <option value="">All Modules</option>
            {availableModules.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* Action Dropdown */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>ACTION</label>
          <select
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1", minWidth: 130 }}
          >
            <option value="">All Actions</option>
            {availableActions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {/* Section 8: Search Box */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>SEARCH</label>
          <input
            type="text"
            placeholder="Search user, module, action, description, reference…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1", width: "100%" }}
          />
        </div>
      </div>

      {/* Section 6: Table Columns based on actual Zoho response */}
      <div className="table-scroll-container table-responsive">
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              <th style={{ padding: "8px 12px", textAlign: "left", minWidth: 140 }}>Date / Time</th>
              <th style={{ padding: "8px 12px", textAlign: "left", minWidth: 130 }}>User</th>
              <th style={{ padding: "8px 12px", textAlign: "left", minWidth: 110 }}>Module</th>
              <th style={{ padding: "8px 12px", textAlign: "left", minWidth: 100 }}>Action</th>
              <th style={{ padding: "8px 12px", textAlign: "left", minWidth: 220 }}>Description</th>
              <th style={{ padding: "8px 12px", textAlign: "left", minWidth: 140 }}>Reference / Transaction</th>
              <th style={{ padding: "8px 12px", textAlign: "left", minWidth: 110 }}>Activity Type</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                  Loading activities from local SQLite cache…
                </td>
              </tr>
            ) : activities.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", marginBottom: 6 }}>
                    No Zoho activities found for Current FY.
                  </div>
                  <div style={{ fontSize: 12.5, color: "#64748b", maxWidth: 540, margin: "0 auto", lineHeight: 1.6 }}>
                    No Zoho activity records found for the selected period.
                    Zero sample or mock activities are displayed. Click <strong>[Sync Activity]</strong> above to query the official Zoho Books Activity Logs API.
                  </div>
                </td>
              </tr>
            ) : (
              activities.map((act) => (
                <tr
                  key={act.activity_id}
                  onClick={() => handleActivityRowClick(act)}
                  title="Click to view local details (Zero Zoho calls)"
                  style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                >
                  <td style={{ padding: "8px 12px" }}>
                    <strong>{formatDisplayDate(act.date)}</strong>{" "}
                    <span style={{ color: "#64748b", fontSize: 11 }}>
                      {act.time || (act.created_time ? act.created_time.slice(11, 19) : "")}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", fontWeight: 600, color: "#0f172a" }}>
                    {act.user_name || "—"}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600, color: "#334155" }}>
                      {act.module}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ fontWeight: 600, color: act.action.toLowerCase().includes("create") ? "#16a34a" : act.action.toLowerCase().includes("delete") ? "#dc2626" : "#2563eb" }}>
                      {act.action}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", color: "#475569" }}>
                    {act.description || "—"}
                  </td>
                  <td style={{ padding: "8px 12px", fontWeight: 500, color: "#0284c7" }}>
                    {act.reference_number || act.entity_number || act.entity_id || "—"}
                    {(act.linked_bill_id || act.linked_invoice_id) && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#16a34a" }} title="Opens local record — zero Zoho calls">
                        🔗
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 11.5, color: "#64748b" }}>
                    {act.activity_type || act.module}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Scope Transparency Footnote (Required by activity-and-dropdown-tests) */}
      <div style={{ marginTop: 14, fontSize: 11, color: "#64748b", lineHeight: 1.5, borderTop: "1px solid #f1f5f9", paddingTop: 10 }}>
        <div style={{ fontWeight: 600, color: scopeStatus?.authorized === false ? "#b91c1c" : "#166534", marginBottom: 4 }}>
          {scopeStatus?.authorized === false
            ? "🔒 Zoho Activity Scope Status: Reports READ authorization required (HTTP 401, Code 57)"
            : "✓ Zoho Activity Scope Status: Connected & Authorized"}
          {" · "}
          <span>Endpoint: <code>/books/v3/reports/activitylogs</code></span>
        </div>
        <div style={{ color: "#64748b" }}>
          ℹ️ Zoho Activity requires additional READ-only scope approval: <code>ZohoBooks.reports.READ</code>. Official Zoho Books v3 API does not provide a public activity log endpoint under standard transaction scopes. User tracking info is not exposed by standard v3 transaction GET APIs.
        </div>
      </div>

      {/* Section 16: Global Export Field Selector Modal */}
      <ExportFieldSelector
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        reportType="zoho-activity"
        totalRecords={totalCount}
        onExport={handleExport}
        excelEnabled={exportFormat === "excel"}
        pdfEnabled={exportFormat === "pdf"}
      />

      {/* Section 9: Local Drawers (Zero Zoho Calls on Click) */}
      {activeBillId && (
        <LocalBillDrawer
          billId={activeBillId}
          onClose={() => setActiveBillId(null)}
          onOpenVendor={(vendorName, vendorId) => {
            setActiveVendor({ id: vendorId, name: vendorName });
          }}
          onOpenItem={(itemId, itemName) => {
            setActiveItem({ id: itemId, name: itemName });
          }}
        />
      )}

      {activeInvoiceId && (
        <LocalInvoiceDrawer
          invoiceId={activeInvoiceId}
          onClose={() => setActiveInvoiceId(null)}
          onOpenItem={(itemId, itemName) => {
            setActiveItem({ id: itemId, name: itemName });
          }}
        />
      )}

      {activeVendor && (
        <VendorDetailDrawer
          vendorId={activeVendor.id || ""}
          vendorName={activeVendor.name}
          financialYear={financialYear}
          onClose={() => setActiveVendor(null)}
        />
      )}

      {activeItem && (
        <ItemDetailDrawer
          itemId={activeItem.id || ""}
          itemName={activeItem.name}
          financialYear={financialYear}
          onClose={() => setActiveItem(null)}
        />
      )}

      {/* Customer Detail Local Modal */}
      {activeCustomer && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.45)",
            backdropFilter: "blur(2px)",
            zIndex: 1050,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setActiveCustomer(null)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 8,
              width: "500px",
              maxWidth: "96vw",
              boxShadow: "0 12px 28px rgba(0,0,0,0.15)",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#0f172a" }}>Customer Details</h3>
              <button
                type="button"
                onClick={() => setActiveCustomer(null)}
                style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer", color: "#64748b" }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: 18, fontSize: 13, color: "#334155" }}>
              <div style={{ marginBottom: 8 }}>
                <span style={{ color: "#64748b" }}>Customer: </span>
                <strong>{activeCustomer.name}</strong>
              </div>
              {activeCustomer.id && (
                <div style={{ marginBottom: 12 }}>
                  <span style={{ color: "#64748b" }}>Customer ID: </span>
                  <code>{activeCustomer.id}</code>
                </div>
              )}
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "10px 12px", borderRadius: 6, fontSize: 12, color: "#166534" }}>
                ✓ Local record resolved from SQLite cache. Zero Zoho API calls used.
              </div>
            </div>
            <div style={{ padding: "10px 18px", borderTop: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-primary" onClick={() => setActiveCustomer(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Raw Activity Details Modal (If entity cannot be resolved locally) */}
      {selectedRawActivity && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.45)",
            backdropFilter: "blur(2px)",
            zIndex: 1050,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setSelectedRawActivity(null)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 8,
              width: "560px",
              maxWidth: "96vw",
              boxShadow: "0 12px 28px rgba(0,0,0,0.15)",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#0f172a" }}>Activity Event Details</h3>
              <button
                type="button"
                onClick={() => setSelectedRawActivity(null)}
                style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer", color: "#64748b" }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: 18, fontSize: 12.5, color: "#334155", display: "flex", flexDirection: "column", gap: 14 }}>
              {/* ZOHO ACTIVITY EVENT — every value here comes directly from that activity_id's
                  Zoho Activity Logs API payload. Nothing here is inferred from local transaction
                  data; a missing field is labeled "Not provided by Zoho API", never guessed. */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#1d4ed8", letterSpacing: 0.4, marginBottom: 8 }}>
                  ZOHO ACTIVITY EVENT
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "10px 12px" }}>
                  <div>
                    <span style={{ color: "#64748b", fontWeight: 600 }}>Activity ID: </span>
                    <code>{selectedRawActivity.activity_id}</code>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", fontWeight: 600 }}>Date / Time: </span>
                    <strong>{selectedRawActivity.date}{selectedRawActivity.time ? ` ${selectedRawActivity.time}` : ""}</strong>
                    {!selectedRawActivity.time && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>
                        (time-of-day not provided by Zoho API — only the date is returned)
                      </span>
                    )}
                  </div>
                  <div>
                    <span style={{ color: "#64748b", fontWeight: 600 }}>Activity Details: </span>
                    <strong>
                      {selectedRawActivity.reference_number || selectedRawActivity.detail_party_name
                        ? [selectedRawActivity.reference_number, selectedRawActivity.detail_party_name].filter(Boolean).join(" — ")
                        : "Not provided by Zoho API"}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", fontWeight: 600 }}>Description: </span>
                    <span>{selectedRawActivity.description || "Not provided by Zoho API"}</span>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", fontWeight: 600 }}>Performed By: </span>
                    <strong>{selectedRawActivity.user_name || "Not provided by Zoho API"}</strong>
                    {selectedRawActivity.user_id ? <span style={{ marginLeft: 6, fontSize: 11, color: "#64748b" }}>({selectedRawActivity.user_id})</span> : null}
                  </div>
                  <div>
                    <span style={{ color: "#64748b", fontWeight: 600 }}>Operation: </span>
                    <strong>{selectedRawActivity.action || "Not provided by Zoho API"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", fontWeight: 600 }}>Transaction Type: </span>
                    <span style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: 4 }}>
                      {selectedRawActivity.module_source === "STRUCTURED" ? selectedRawActivity.module : "Not provided by Zoho API"}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", fontWeight: 600 }}>Transaction ID: </span>
                    <span>{selectedRawActivity.reference_id || selectedRawActivity.entity_id || "Not provided by Zoho API"}</span>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", fontWeight: 600 }}>Transaction Name / Number: </span>
                    <strong>{selectedRawActivity.reference_number || "Not provided by Zoho API"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", fontWeight: 600 }}>Source: </span>
                    <span>{selectedRawActivity.source || "ZOHO_API"} {selectedRawActivity.ip_address ? `(${selectedRawActivity.ip_address})` : ""}</span>
                  </div>
                </div>
              </div>

              {/* LOCAL LINKED RECORD — a separate section, never merged into the Zoho event
                  fields above. Only shown when we have a reliable local foreign key
                  (linked_bill_id / linked_invoice_id, resolved 1:1 from Zoho's own
                  activity_details.transaction_id at sync time — not a text guess). */}
              {(selectedRawActivity.linked_bill_id || selectedRawActivity.linked_invoice_id) && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#166534", letterSpacing: 0.4, marginBottom: 8 }}>
                    LOCAL LINKED RECORD
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "10px 12px" }}>
                    <div>
                      <span style={{ color: "#64748b", fontWeight: 600 }}>Type: </span>
                      <strong>{selectedRawActivity.linked_bill_id ? "Purchase Bill" : "Sales Invoice"}</strong>
                    </div>
                    <div>
                      <span style={{ color: "#64748b", fontWeight: 600 }}>Local ID: </span>
                      <code>{selectedRawActivity.linked_bill_id || selectedRawActivity.linked_invoice_id}</code>
                    </div>
                    <div>
                      <span style={{ color: "#64748b", fontWeight: 600 }}>Reference: </span>
                      <span>{selectedRawActivity.reference_number || "—"}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      style={{ alignSelf: "flex-start", marginTop: 4 }}
                      onClick={() => {
                        if (selectedRawActivity.linked_bill_id) setActiveBillId(selectedRawActivity.linked_bill_id);
                        else if (selectedRawActivity.linked_invoice_id) setActiveInvoiceId(selectedRawActivity.linked_invoice_id);
                        setSelectedRawActivity(null);
                      }}
                    >
                      Open Local Record
                    </button>
                  </div>
                </div>
              )}

              {selectedRawActivity.raw_payload_json && (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 600, color: "#334155", fontSize: 12 }}>
                    Raw Zoho Payload (audit trail)
                  </summary>
                  <pre
                    style={{
                      marginTop: 6,
                      maxHeight: 220,
                      overflow: "auto",
                      background: "#0f172a",
                      color: "#e2e8f0",
                      padding: "10px 12px",
                      borderRadius: 6,
                      fontSize: 11,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {(() => {
                      try {
                        return JSON.stringify(JSON.parse(selectedRawActivity.raw_payload_json), null, 2);
                      } catch {
                        return selectedRawActivity.raw_payload_json;
                      }
                    })()}
                  </pre>
                </details>
              )}
            </div>
            <div style={{ padding: "10px 18px", borderTop: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-primary" onClick={() => setSelectedRawActivity(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

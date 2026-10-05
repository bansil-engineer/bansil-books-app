"use client";

import React, { useEffect, useState } from "react";

interface WorkspaceRecord {
  workspace_id: string;
  name: string;
}
interface ReportRecord {
  report_id: string;
  report_version: number;
  status: string;
  entity_name: string | null;
  period_from: string | null;
  period_to: string | null;
  generated_at: string;
  matching_summary_json: string;
}

const REPORT_SECTIONS = [
  { key: "summary", label: "Summary" },
  { key: "scope_coverage", label: "Scope & Coverage" },
  { key: "sources", label: "Sources" },
  { key: "matching_summary", label: "Matching Summary" },
  { key: "findings", label: "Findings" },
  { key: "action_taken", label: "Action Taken" },
  { key: "unmatched_residual", label: "Unmatched / Residual" },
  { key: "reviewer_decisions", label: "Reviewer Decisions" },
];

const REPORT_STATUSES = ["DRAFT", "UNDER_REVIEW", "REVIEWED", "ISSUED_INTERNAL", "SUPERSEDED"];

// Field/Column selector configs — MUST mirror app/lib/audit/report-field-selector.ts exactly (both server and client read the same column keys/labels).
const TABLE_FIELD_CONFIGS: Record<string, Array<{ key: string; label: string }>> = {
  findings: [
    { key: "finding_id", label: "Finding ID" },
    { key: "domain", label: "Domain" },
    { key: "severity", label: "Severity" },
    { key: "finding_type", label: "Finding Type" },
    { key: "title", label: "Title" },
    { key: "confirmed_vs_suspected", label: "Confirmed/Suspected" },
    { key: "financial_impact", label: "Financial Impact" },
    { key: "residual", label: "Residual" },
    { key: "status", label: "Status" },
    { key: "evidence_ref", label: "Evidence Ref" },
  ],
  action_taken: [
    { key: "action_id", label: "Action ID" },
    { key: "finding_id", label: "Finding ID" },
    { key: "action_owner", label: "Owner" },
    { key: "priority", label: "Priority" },
    { key: "due_date", label: "Due Date" },
    { key: "action_status", label: "Status" },
    { key: "action_comment", label: "Comment" },
    { key: "closed_by", label: "Closed By" },
    { key: "completed_at", label: "Closure Date" },
  ],
  scope_coverage: [
    { key: "domain", label: "Domain" },
    { key: "status", label: "Status" },
    { key: "source_coverage_note", label: "Source Coverage" },
    { key: "tests_performed", label: "Tests Performed" },
    { key: "matched_amount", label: "Matched" },
    { key: "unresolved_amount", label: "Unresolved" },
    { key: "limitations", label: "Limitations" },
  ],
  matching_summary: [
    { key: "match_type", label: "Match Type" },
    { key: "count", label: "Count" },
    { key: "allocated_amount", label: "Allocated Amount" },
    { key: "residual", label: "Residual" },
    { key: "absolute_residual", label: "Absolute Residual" },
  ],
};
const TABLE_SECTION_LABELS: Record<string, string> = {
  findings: "Findings",
  action_taken: "Action Taken",
  scope_coverage: "Scope & Coverage",
  matching_summary: "Matching Summary",
};

const STORAGE_KEY_PREFIX = "bansil.audit.reportFieldSelection.";

export function ReviewReportsView() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [entityName, setEntityName] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");

  // undefined = no saved selection exists yet (server/client both use approved defaults);
  // once the owner touches any checkbox, this becomes a real (possibly empty) array that is
  // persisted to localStorage as the "saved selection" for this workspace.
  const [selectedSections, setSelectedSections] = useState<string[] | undefined>(undefined);
  const [selectedTableFields, setSelectedTableFields] = useState<Record<string, string[] | undefined>>({});

  async function loadWorkspaces() {
    const res = await fetch("/api/audit/workspaces");
    const json = await res.json();
    if (json.success) {
      setWorkspaces(json.workspaces);
      if (!selectedWorkspaceId && json.workspaces.length > 0) setSelectedWorkspaceId(json.workspaces[0].workspace_id);
    }
  }
  useEffect(() => {
    loadWorkspaces();
  }, []);

  // Load any saved selection for this workspace from localStorage (a per-viewer convenience — never sent anywhere but back to this workspace's own export call).
  useEffect(() => {
    if (!selectedWorkspaceId) return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + selectedWorkspaceId);
      if (raw) {
        const saved = JSON.parse(raw);
        setSelectedSections(saved.sections ?? undefined);
        setSelectedTableFields(saved.tableFields ?? {});
      } else {
        setSelectedSections(undefined);
        setSelectedTableFields({});
      }
    } catch {
      setSelectedSections(undefined);
      setSelectedTableFields({});
    }
  }, [selectedWorkspaceId]);

  function persistSelection(sections: string[] | undefined, tableFields: Record<string, string[] | undefined>) {
    if (!selectedWorkspaceId) return;
    try {
      window.localStorage.setItem(STORAGE_KEY_PREFIX + selectedWorkspaceId, JSON.stringify({ sections, tableFields }));
    } catch {
      // localStorage unavailable (private mode, etc.) — selection still works for this page load, just isn't saved across reloads.
    }
  }

  async function loadReports() {
    if (!selectedWorkspaceId) return;
    const res = await fetch(`/api/audit/reports?workspaceId=${selectedWorkspaceId}`);
    const json = await res.json();
    if (json.success) setReports(json.reports);
  }
  useEffect(() => {
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkspaceId]);

  function toggleSection(key: string) {
    setSelectedSections((prev) => {
      const base = prev ?? REPORT_SECTIONS.map((s) => s.key); // first touch starts from "all selected"
      const next = base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
      persistSelection(next, selectedTableFields);
      return next;
    });
  }

  function toggleTableField(tableKey: string, fieldKey: string) {
    setSelectedTableFields((prev) => {
      const config = TABLE_FIELD_CONFIGS[tableKey];
      const base = prev[tableKey] ?? config.map((f) => f.key);
      const next = base.includes(fieldKey) ? base.filter((k) => k !== fieldKey) : [...base, fieldKey];
      const nextAll = { ...prev, [tableKey]: next };
      persistSelection(selectedSections, nextAll);
      return nextAll;
    });
  }

  async function handleGenerateReport() {
    setError(null);
    setMessage(null);
    const res = await fetch("/api/audit/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: selectedWorkspaceId, entityName: entityName || undefined, periodFrom: periodFrom || undefined, periodTo: periodTo || undefined }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to generate report");
      return;
    }
    setMessage(`Report v${json.report.report_version} generated (DRAFT).`);
    await loadReports();
  }

  async function handleSetStatus(reportId: string, status: string) {
    const res = await fetch(`/api/audit/reports/${reportId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to update report status");
      return;
    }
    await loadReports();
  }

  async function handleExport(reportId: string, reportVersion: number, format: "EXCEL" | "PDF") {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/audit/reports/${reportId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format, selectedFields: selectedSections, selectedTableFields }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error || `Failed to export ${format}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `internal-review-report-v${reportVersion}.${format === "EXCEL" ? "xlsx" : "pdf"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMessage(`${format} export downloaded.`);
  }

  const effectiveSections = selectedSections ?? REPORT_SECTIONS.map((s) => s.key);
  const isSectionsExplicitEmpty = selectedSections !== undefined && selectedSections.length === 0;
  const tabularSectionsIncluded = Object.keys(TABLE_FIELD_CONFIGS).filter((k) => effectiveSections.includes(k));
  const hasEmptyTableFieldSelection = tabularSectionsIncluded.some((k) => selectedTableFields[k] !== undefined && (selectedTableFields[k] as string[]).length === 0);
  const isExportBlocked = isSectionsExplicitEmpty || hasEmptyTableFieldSelection;

  return (
    <div className="section-card" style={{ padding: 24, maxWidth: 1100 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>Reconciliation &amp; Audit — Review Reports</h2>
      <p style={{ fontSize: 12, color: "#64748b", margin: "6px 0 16px 0" }}>
        This app produces an <strong>INTERNAL REVIEW WORKING PAPER</strong> — never a statutory audit opinion. Each generated report is an immutable snapshot; regenerating creates a
        new version, past reports never change. Excel and PDF are both built from the same frozen snapshot — no rerun of matching, AI, Zoho, or file parsing.
      </p>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ marginBottom: 12, fontSize: 12, color: "#166534", background: "#f0fdf4", padding: "8px 12px", borderRadius: 6 }}>{message}</div>}

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Workspace</label>
        <select value={selectedWorkspaceId} onChange={(e) => setSelectedWorkspaceId(e.target.value)} style={{ display: "block", marginTop: 4, padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #cbd5e1", minWidth: 320 }}>
          {workspaces.map((w) => (
            <option key={w.workspace_id} value={w.workspace_id}>{w.name}</option>
          ))}
        </select>
      </div>

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px 0" }}>Generate New Report Version</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Entity name" value={entityName} onChange={(e) => setEntityName(e.target.value)} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 200 }} />
          <input placeholder="Period from (YYYY-MM-DD)" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 160 }} />
          <input placeholder="Period to (YYYY-MM-DD)" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 160 }} />
          <button onClick={handleGenerateReport} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Generate Report</button>
        </div>
      </div>

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px 0" }}>Section Selector</h3>
        <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 0, marginBottom: 8 }}>Controls which report SECTIONS appear at all. For per-column control within a table, use the Field / Column Selector below.</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {REPORT_SECTIONS.map((s) => (
            <label key={s.key} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={effectiveSections.includes(s.key)} onChange={() => toggleSection(s.key)} />
              {s.label}
            </label>
          ))}
        </div>
        <p style={{ fontSize: 11, color: isSectionsExplicitEmpty ? "#dc2626" : "#94a3b8", marginTop: 8 }}>
          {isSectionsExplicitEmpty
            ? "No sections selected — export is blocked until at least one section is checked."
            : selectedSections === undefined
            ? "No saved selection exists yet — export will use the approved section defaults (all sections)."
            : "Custom selection active (saved for this workspace)."}
        </p>
      </div>

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px 0" }}>Field / Column Selector</h3>
        <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 0, marginBottom: 10 }}>
          Controls which COLUMNS render within each tabular section that is currently included above. Only additive numeric/currency columns ever receive a totals row; IDs, text, and
          status columns never do.
        </p>
        {tabularSectionsIncluded.length === 0 && <p style={{ fontSize: 12, color: "#94a3b8" }}>No tabular sections are currently included in the Section Selector.</p>}
        {tabularSectionsIncluded.map((tableKey) => {
          const config = TABLE_FIELD_CONFIGS[tableKey];
          const effective = selectedTableFields[tableKey] ?? config.map((f) => f.key);
          const isEmpty = selectedTableFields[tableKey] !== undefined && (selectedTableFields[tableKey] as string[]).length === 0;
          return (
            <div key={tableKey} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px dashed #f1f5f9" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{TABLE_SECTION_LABELS[tableKey]}</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {config.map((f) => (
                  <label key={f.key} style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 4 }}>
                    <input type="checkbox" checked={effective.includes(f.key)} onChange={() => toggleTableField(tableKey, f.key)} />
                    {f.label}
                  </label>
                ))}
              </div>
              {isEmpty && <p style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>No columns selected for {TABLE_SECTION_LABELS[tableKey]} — export is blocked until at least one column is checked.</p>}
            </div>
          );
        })}
      </div>

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px 0" }}>Report History</h3>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>
              <th style={{ padding: "4px" }}>Version</th><th>Status</th><th>Entity</th><th>Period</th><th>Generated At</th><th></th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.report_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "4px", fontWeight: 600 }}>v{r.report_version}</td>
                <td>{r.status}</td>
                <td>{r.entity_name || "—"}</td>
                <td>{r.period_from || "-"} to {r.period_to || "-"}</td>
                <td style={{ fontSize: 11 }}>{r.generated_at}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button disabled={isExportBlocked} onClick={() => handleExport(r.report_id, r.report_version, "EXCEL")} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: isExportBlocked ? "#f1f5f9" : "#fff", cursor: isExportBlocked ? "not-allowed" : "pointer" }}>Excel</button>
                    <button disabled={isExportBlocked} onClick={() => handleExport(r.report_id, r.report_version, "PDF")} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: isExportBlocked ? "#f1f5f9" : "#fff", cursor: isExportBlocked ? "not-allowed" : "pointer" }}>PDF</button>
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) handleSetStatus(r.report_id, e.target.value);
                      }}
                      style={{ fontSize: 11, padding: "3px 6px", borderRadius: 5, border: "1px solid #cbd5e1" }}
                    >
                      <option value="">Set status…</option>
                      {REPORT_STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {reports.length === 0 && <p style={{ fontSize: 12, color: "#94a3b8" }}>No reports generated yet for this workspace.</p>}
      </div>
    </div>
  );
}

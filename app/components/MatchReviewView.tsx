"use client";

import React, { useEffect, useState } from "react";

interface WorkspaceRecord {
  workspace_id: string;
  name: string;
  sources: SourceRecord[];
}
interface SourceRecord {
  source_id: string;
  role_label: string;
  source_origin: "INTERNAL" | "EXTERNAL";
}
interface VersionRecord {
  version_id: string;
  version_number: number;
  origin_type: string;
  frozen: number;
  mapping_status: string;
}
interface EdgeDraft {
  leftRoleLabel: string;
  rightRoleLabel: string;
  leftSourceVersionId: string;
  rightSourceVersionId: string;
}
interface MatchGroup {
  group_id: string;
  edge_id: string;
  group_type: string;
  discrepancy_subtype: string | null;
  status: string;
  residual_amount: string | null;
  residual_quantity: string | null;
  notes_json: string;
}
interface RunSummary {
  runId: string;
  edgeCount: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  perEdgeAcceptedTotal: Array<{ edgeId: string; leftRole: string; rightRole: string; acceptedGroupCount: number; acceptedAllocatedTotal: string }>;
  distinctAcceptedRowCount: number;
}

const GROUP_TYPES = ["EXACT", "GROUPED", "PARTIAL", "AMBIGUOUS", "DISCREPANCY", "UNMATCHED_LEFT", "UNMATCHED_RIGHT"];

export function MatchReviewView() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [versionsBySource, setVersionsBySource] = useState<Record<string, VersionRecord[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [edges, setEdges] = useState<EdgeDraft[]>([{ leftRoleLabel: "", rightRoleLabel: "", leftSourceVersionId: "", rightSourceVersionId: "" }]);

  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [groups, setGroups] = useState<MatchGroup[]>([]);
  const [filterType, setFilterType] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");

  const [evidence, setEvidence] = useState<any>(null);
  const [reasonInput, setReasonInput] = useState("");

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

  const selectedWorkspace = workspaces.find((w) => w.workspace_id === selectedWorkspaceId);

  async function loadVersions(sourceId: string) {
    const res = await fetch(`/api/audit/workspaces/${selectedWorkspaceId}/sources/${sourceId}/versions`);
    const json = await res.json();
    if (json.success) setVersionsBySource((prev) => ({ ...prev, [sourceId]: json.versions }));
  }
  useEffect(() => {
    if (selectedWorkspace) {
      for (const s of selectedWorkspace.sources) loadVersions(s.source_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkspaceId, workspaces.length]);

  async function loadRuns() {
    if (!selectedWorkspaceId) return;
    const res = await fetch(`/api/audit/workspaces/${selectedWorkspaceId}/runs`);
    const json = await res.json();
    if (json.success) setRuns(json.runs);
  }
  useEffect(() => {
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkspaceId]);

  async function loadRunDetail(runId: string) {
    setSelectedRunId(runId);
    setEvidence(null);
    const params = new URLSearchParams();
    if (filterType) params.set("groupType", filterType);
    if (filterStatus) params.set("status", filterStatus);
    const res = await fetch(`/api/audit/runs/${runId}/summary?${params.toString()}`);
    const json = await res.json();
    if (json.success) {
      setSummary(json.summary);
      setGroups(json.groups);
    }
  }

  useEffect(() => {
    if (selectedRunId) loadRunDetail(selectedRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterStatus]);

  function frozenVersionsForSource(sourceId: string): VersionRecord[] {
    return (versionsBySource[sourceId] || []).filter((v) => v.frozen);
  }

  function updateEdge(i: number, patch: Partial<EdgeDraft>) {
    setEdges((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }

  async function handleCreateRun() {
    setError(null);
    setMessage(null);
    const validEdges = edges.filter((e) => e.leftSourceVersionId && e.rightSourceVersionId);
    if (validEdges.length === 0) {
      setError("At least one complete comparison edge (both sides selected) is required.");
      return;
    }
    const res = await fetch(`/api/audit/workspaces/${selectedWorkspaceId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edges: validEdges }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to create run");
      return;
    }
    setMessage(`Run created: ${json.runId}`);
    await loadRuns();
    await loadRunDetail(json.runId);
  }

  async function handleOpenEvidence(groupId: string) {
    const res = await fetch(`/api/audit/runs/${selectedRunId}/groups/${groupId}/evidence`);
    const json = await res.json();
    if (json.success) setEvidence(json.evidence);
  }

  async function handleDecision(groupId: string, decision: "ACCEPTED" | "REJECTED" | "HELD" | "REVERSED") {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/audit/runs/${selectedRunId}/groups/${groupId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reason: reasonInput || undefined }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || `Failed to record ${decision}`);
      return;
    }
    setMessage(`${decision} recorded.`);
    setReasonInput("");
    await loadRunDetail(selectedRunId);
    if (evidence && evidence.group.group_id === groupId) await handleOpenEvidence(groupId);
  }

  return (
    <div className="section-card" style={{ padding: 24, maxWidth: 1100 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>Reconciliation &amp; Audit — Match Review</h2>
      <p style={{ fontSize: 12, color: "#64748b", margin: "6px 0 16px 0" }}>
        Deterministic matching over frozen source snapshots only. No AI decides a financial match — every acceptance is an explicit reviewer decision.
      </p>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      {message && (
        <div style={{ marginBottom: 12, fontSize: 12, color: "#166534", background: "#f0fdf4", padding: "8px 12px", borderRadius: 6 }}>{message}</div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Workspace</label>
        <select
          value={selectedWorkspaceId}
          onChange={(e) => setSelectedWorkspaceId(e.target.value)}
          style={{ display: "block", marginTop: 4, padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #cbd5e1", minWidth: 320 }}
        >
          {workspaces.map((w) => (
            <option key={w.workspace_id} value={w.workspace_id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px 0" }}>New Run — Comparison Edges (frozen sources only)</h3>
        {edges.map((edge, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <input
              placeholder="Left role (e.g. BILL)"
              value={edge.leftRoleLabel}
              onChange={(e) => updateEdge(i, { leftRoleLabel: e.target.value })}
              style={{ padding: "6px 8px", fontSize: 12.5, borderRadius: 6, border: "1px solid #cbd5e1", width: 140 }}
            />
            <select
              value={edge.leftSourceVersionId}
              onChange={(e) => updateEdge(i, { leftSourceVersionId: e.target.value })}
              style={{ padding: "6px 8px", fontSize: 12.5, borderRadius: 6, border: "1px solid #cbd5e1" }}
            >
              <option value="">— left frozen version —</option>
              {(selectedWorkspace?.sources || []).flatMap((s) =>
                frozenVersionsForSource(s.source_id).map((v) => (
                  <option key={v.version_id} value={v.version_id}>
                    {s.role_label} v{v.version_number}
                  </option>
                ))
              )}
            </select>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>vs</span>
            <input
              placeholder="Right role (e.g. VENDOR_STATEMENT)"
              value={edge.rightRoleLabel}
              onChange={(e) => updateEdge(i, { rightRoleLabel: e.target.value })}
              style={{ padding: "6px 8px", fontSize: 12.5, borderRadius: 6, border: "1px solid #cbd5e1", width: 170 }}
            />
            <select
              value={edge.rightSourceVersionId}
              onChange={(e) => updateEdge(i, { rightSourceVersionId: e.target.value })}
              style={{ padding: "6px 8px", fontSize: 12.5, borderRadius: 6, border: "1px solid #cbd5e1" }}
            >
              <option value="">— right frozen version —</option>
              {(selectedWorkspace?.sources || []).flatMap((s) =>
                frozenVersionsForSource(s.source_id).map((v) => (
                  <option key={v.version_id} value={v.version_id}>
                    {s.role_label} v{v.version_number}
                  </option>
                ))
              )}
            </select>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setEdges((prev) => [...prev, { leftRoleLabel: "", rightRoleLabel: "", leftSourceVersionId: "", rightSourceVersionId: "" }])}
            style={{ fontSize: 12, padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}
          >
            + Add another edge
          </button>
          <button
            onClick={handleCreateRun}
            style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            Create Run &amp; Generate Candidates
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Run</label>
        <select
          value={selectedRunId}
          onChange={(e) => loadRunDetail(e.target.value)}
          style={{ display: "block", marginTop: 4, padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #cbd5e1", minWidth: 320 }}
        >
          <option value="">— select a run —</option>
          {runs.map((r) => (
            <option key={r.run_id as string} value={r.run_id as string}>
              {(r.run_id as string).slice(0, 8)} — {r.status as string} — {r.created_at as string}
            </option>
          ))}
        </select>
      </div>

      {summary && (
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px 0" }}>Run Summary</h3>
          <p style={{ fontSize: 12, color: "#475569" }}>
            Edges: {summary.edgeCount} · By type: {JSON.stringify(summary.byType)} · By status: {JSON.stringify(summary.byStatus)}
          </p>
          <p style={{ fontSize: 12, color: "#475569" }}>Distinct accepted rows (deduplicated across edges): {summary.distinctAcceptedRowCount}</p>
          <table style={{ width: "100%", fontSize: 12, marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#64748b" }}>
                <th>Edge</th>
                <th>Accepted groups</th>
                <th>Accepted total (this edge only)</th>
              </tr>
            </thead>
            <tbody>
              {summary.perEdgeAcceptedTotal.map((e) => (
                <tr key={e.edgeId}>
                  <td>
                    {e.leftRole} vs {e.rightRole}
                  </td>
                  <td>{e.acceptedGroupCount}</td>
                  <td>{e.acceptedAllocatedTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
            Totals are reported per edge — never combined into one grand sum, so a document supporting multiple edges is never double-counted.
          </p>
        </div>
      )}

      {selectedRunId && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1" }}>
            <option value="">All types</option>
            {GROUP_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1" }}>
            <option value="">All statuses</option>
            {["CANDIDATE", "ACCEPTED", "REJECTED", "HELD", "REVERSED"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}

      {groups.length > 0 && (
        <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse", marginBottom: 20 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", color: "#64748b" }}>
              <th style={{ padding: "6px 4px" }}>Type</th>
              <th>Subtype</th>
              <th>Status</th>
              <th>Residual (₹)</th>
              <th>Residual (qty)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.group_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "6px 4px", fontWeight: 600 }}>{g.group_type}</td>
                <td>{g.discrepancy_subtype || "—"}</td>
                <td>{g.status}</td>
                <td>{g.residual_amount || "—"}</td>
                <td>{g.residual_quantity || "—"}</td>
                <td>
                  <button onClick={() => handleOpenEvidence(g.group_id)} style={{ fontSize: 11.5, padding: "4px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>
                    View evidence
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {evidence && (
        <div style={{ border: "1px solid #2563eb", borderRadius: 8, padding: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px 0" }}>
            Evidence Drill-back — {evidence.group.group_type} ({evidence.group.status})
          </h3>
          <table style={{ width: "100%", fontSize: 12, marginBottom: 10 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#64748b" }}>
                <th>Side</th>
                <th>Evidence locator</th>
                <th>Allocated</th>
                <th>Source version</th>
              </tr>
            </thead>
            <tbody>
              {evidence.members.map((m: any) => (
                <tr key={m.member_id}>
                  <td>{m.side}</td>
                  <td>{m.evidence_locator}</td>
                  <td>{m.allocated_amount || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 10.5 }}>{m.source_version_id.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <input
              placeholder="Reason / comment (recorded with the decision)"
              value={reasonInput}
              onChange={(e) => setReasonInput(e.target.value)}
              style={{ flex: 1, padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => handleDecision(evidence.group.group_id, "ACCEPTED")} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "none", background: "#16a34a", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
              Accept
            </button>
            <button onClick={() => handleDecision(evidence.group.group_id, "REJECTED")} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "none", background: "#dc2626", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
              Reject
            </button>
            <button onClick={() => handleDecision(evidence.group.group_id, "HELD")} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>
              Hold
            </button>
            <button onClick={() => handleDecision(evidence.group.group_id, "REVERSED")} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>
              Reverse (undo a prior Accept)
            </button>
          </div>

          {evidence.decisions.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ fontSize: 12.5, fontWeight: 700, margin: "0 0 6px 0" }}>Decision History</h4>
              {evidence.decisions.map((d: any) => (
                <p key={d.decision_id} style={{ fontSize: 11.5, color: "#475569", margin: "2px 0" }}>
                  {d.decided_at} — <strong>{d.decision}</strong> by {d.reviewer}
                  {d.reason ? ` — "${d.reason}"` : ""}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

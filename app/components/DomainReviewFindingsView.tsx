"use client";

import React, { useEffect, useState } from "react";

interface WorkspaceRecord {
  workspace_id: string;
  name: string;
}
interface CoverageRow {
  review_id: string;
  domain: string;
  status: string;
  reviewer: string | null;
  matched_amount: string | null;
  matched_count: number | null;
  unresolved_amount: string | null;
  unresolved_count: number | null;
  exception_count: number | null;
  limitations: string | null;
}
interface FindingRow {
  finding_id: string;
  domain: string;
  severity: string;
  finding_type: string;
  title: string;
  description: string | null;
  confirmed_vs_suspected: string;
  financial_impact: string | null;
  currency: string | null;
  status: string;
  evidence_refs_json: string;
}
interface ActionRow {
  action_id: string;
  finding_id: string;
  action_required: string;
  action_owner: string | null;
  action_status: string;
  due_date: string | null;
  closure_comment: string | null;
}

const REVIEW_DOMAINS = ["BANK_CASH", "RECEIVABLES", "PAYABLES", "PURCHASE_CHAIN", "SALES_CHAIN", "MATERIAL_STOCK", "TRIAL_BALANCE", "OVERALL_SUMMARY", "TAX", "PAYROLL", "FIXED_ASSETS", "LOANS", "STATUTORY_LEGAL"];
const DOMAIN_STATUSES = ["REVIEWED", "PARTIAL", "BLOCKED", "EXCLUDED", "NOT_TESTED", "NOT_AVAILABLE"];
const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const FINDING_TYPES = [
  "UNMATCHED_TRANSACTION", "AMOUNT_VARIANCE", "TIMING_DATE_VARIANCE", "REFERENCE_DOCUMENT_MISMATCH", "CURRENCY_MISMATCH",
  "QUANTITY_MISMATCH", "UNIT_MISMATCH", "DUPLICATE_AMBIGUOUS_EVIDENCE", "UNSUPPORTED_DEDUCTION", "MISSING_DOCUMENT_EVIDENCE",
  "OPENING_CLOSING_BALANCE_INCONSISTENCY", "SOURCE_COMPLETENESS_LIMITATION", "MAPPING_PARSING_LIMITATION", "POTENTIAL_DUPLICATE",
  "POSSIBLE_WRONG_PARTY_ACCOUNT", "REVIEW_LIMITATION",
];

const statusColor: Record<string, string> = {
  REVIEWED: "#16a34a", PARTIAL: "#d97706", BLOCKED: "#dc2626", EXCLUDED: "#6b7280", NOT_TESTED: "#94a3b8", NOT_AVAILABLE: "#94a3b8",
};

export function DomainReviewFindingsView() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [actionsByFinding, setActionsByFinding] = useState<Record<string, ActionRow[]>>({});
  const [expandedFindingId, setExpandedFindingId] = useState<string>("");

  const [domainDraft, setDomainDraft] = useState({ domain: "BANK_CASH", status: "REVIEWED", sourceSnapshotIds: "", testsPerformed: "", matchedAmount: "", unresolvedAmount: "", limitations: "" });
  const [findingDraft, setFindingDraft] = useState({ domain: "BANK_CASH", severity: "MEDIUM", findingType: "AMOUNT_VARIANCE", title: "", description: "", financialImpact: "", currency: "INR", evidenceRefs: "" });
  const [newActionText, setNewActionText] = useState<Record<string, string>>({});

  // Inline reason/comment prompt — replaces window.prompt (unsupported in some embedded browser panes) with an on-page input.
  const [pendingPrompt, setPendingPrompt] = useState<{ kind: "confirmation" | "close" | "reopen" | "cancel"; findingId: string; actionId?: string; next?: "CONFIRMED" | "SUSPECTED" | "UNKNOWN" } | null>(null);
  const [promptInput, setPromptInput] = useState("");

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

  async function loadCoverage() {
    if (!selectedWorkspaceId) return;
    const res = await fetch(`/api/audit/domain-reviews?workspaceId=${selectedWorkspaceId}&view=matrix`);
    const json = await res.json();
    if (json.success) setCoverage(json.coverage);
  }
  async function loadFindings() {
    if (!selectedWorkspaceId) return;
    const res = await fetch(`/api/audit/findings?workspaceId=${selectedWorkspaceId}`);
    const json = await res.json();
    if (json.success) setFindings(json.findings);
  }
  useEffect(() => {
    loadCoverage();
    loadFindings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkspaceId]);

  async function loadActions(findingId: string) {
    const res = await fetch(`/api/audit/actions?findingId=${findingId}`);
    const json = await res.json();
    if (json.success) setActionsByFinding((prev) => ({ ...prev, [findingId]: json.actions }));
  }

  function toggleFinding(findingId: string) {
    if (expandedFindingId === findingId) {
      setExpandedFindingId("");
      return;
    }
    setExpandedFindingId(findingId);
    if (!actionsByFinding[findingId]) loadActions(findingId);
  }

  async function handleRecordDomainReview() {
    setError(null);
    setMessage(null);
    const res = await fetch("/api/audit/domain-reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: selectedWorkspaceId,
        domain: domainDraft.domain,
        status: domainDraft.status,
        sourceSnapshotIds: domainDraft.sourceSnapshotIds ? domainDraft.sourceSnapshotIds.split(",").map((s) => s.trim()).filter(Boolean) : [],
        testsPerformed: domainDraft.testsPerformed ? domainDraft.testsPerformed.split(",").map((s) => s.trim()).filter(Boolean) : [],
        matchedAmount: domainDraft.matchedAmount || undefined,
        unresolvedAmount: domainDraft.unresolvedAmount || undefined,
        limitations: domainDraft.limitations || undefined,
      }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to record domain review");
      return;
    }
    setMessage(`Domain review recorded: ${domainDraft.domain} -> ${domainDraft.status}`);
    await loadCoverage();
  }

  async function handleCreateFinding() {
    setError(null);
    setMessage(null);
    if (!findingDraft.title.trim()) {
      setError("Finding title is required.");
      return;
    }
    const res = await fetch("/api/audit/findings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: selectedWorkspaceId,
        domain: findingDraft.domain,
        severity: findingDraft.severity,
        findingType: findingDraft.findingType,
        title: findingDraft.title,
        description: findingDraft.description || undefined,
        financialImpact: findingDraft.financialImpact || undefined,
        currency: findingDraft.currency || undefined,
        evidenceRefs: findingDraft.evidenceRefs ? findingDraft.evidenceRefs.split(",").map((s) => s.trim()).filter(Boolean) : [],
      }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to create finding");
      return;
    }
    setMessage("Finding created (confirmed_vs_suspected defaults to SUSPECTED).");
    setFindingDraft((prev) => ({ ...prev, title: "", description: "", financialImpact: "", evidenceRefs: "" }));
    await loadFindings();
  }

  function requestConfirmationChange(findingId: string, next: "CONFIRMED" | "SUSPECTED" | "UNKNOWN") {
    setPendingPrompt({ kind: "confirmation", findingId, next });
    setPromptInput("");
  }

  async function handleSetConfirmation(findingId: string, next: "CONFIRMED" | "SUSPECTED" | "UNKNOWN", reason: string) {
    const res = await fetch(`/api/audit/findings/${findingId}/confirmation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmedVsSuspected: next, reason }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to set confirmation");
      return;
    }
    await loadFindings();
  }

  async function handleCreateAction(findingId: string) {
    const text = newActionText[findingId];
    if (!text || !text.trim()) return;
    const res = await fetch("/api/audit/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ findingId, actionRequired: text }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to create action");
      return;
    }
    setNewActionText((prev) => ({ ...prev, [findingId]: "" }));
    await loadActions(findingId);
  }

  function requestActionTransition(actionId: string, findingId: string, transition: string) {
    if (transition === "close" || transition === "reopen" || transition === "cancel") {
      setPendingPrompt({ kind: transition as "close" | "reopen" | "cancel", findingId, actionId });
      setPromptInput("");
      return;
    }
    handleActionTransition(actionId, findingId, transition);
  }

  async function handleActionTransition(actionId: string, findingId: string, transition: string, text?: string) {
    const closureComment = transition === "close" ? text : undefined;
    const comment = transition === "reopen" || transition === "cancel" ? text : undefined;
    const res = await fetch(`/api/audit/actions/${actionId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transition, closureComment, comment }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || `Failed to transition action (${transition})`);
      return;
    }
    await loadActions(findingId);
  }

  async function submitPendingPrompt() {
    if (!pendingPrompt) return;
    const text = promptInput.trim();
    if (!text) return;
    if (pendingPrompt.kind === "confirmation" && pendingPrompt.next) {
      await handleSetConfirmation(pendingPrompt.findingId, pendingPrompt.next, text);
    } else if (pendingPrompt.actionId) {
      await handleActionTransition(pendingPrompt.actionId, pendingPrompt.findingId, pendingPrompt.kind, text);
    }
    setPendingPrompt(null);
    setPromptInput("");
  }

  return (
    <div className="section-card" style={{ padding: 24, maxWidth: 1150 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>Reconciliation &amp; Audit — Findings &amp; Action Taken</h2>
      <p style={{ fontSize: 12, color: "#64748b", margin: "6px 0 16px 0" }}>
        Domain review coverage must be proven — never inferred from an absence of mismatches. Finding status and action-taken workflow are kept independent: closing an action never
        changes the underlying finding, its confirmed/suspected state, or any match allocation.
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

      {/* Coverage Matrix */}
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px 0" }}>Scope Completeness / Coverage Matrix</h3>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", marginBottom: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>
              <th style={{ padding: "4px" }}>Domain</th><th>Status</th><th>Reviewer</th><th>Matched</th><th>Unresolved</th><th>Exceptions</th><th>Limitations</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((c) => (
              <tr key={c.domain} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "4px", fontWeight: 600 }}>{c.domain}</td>
                <td><span style={{ color: statusColor[c.status] || "#334155", fontWeight: 600 }}>{c.status}</span></td>
                <td>{c.reviewer || "—"}</td>
                <td>{c.matched_amount ?? "—"} {c.matched_count != null ? `(${c.matched_count})` : ""}</td>
                <td>{c.unresolved_amount ?? "—"} {c.unresolved_count != null ? `(${c.unresolved_count})` : ""}</td>
                <td>{c.exception_count ?? 0}</td>
                <td style={{ maxWidth: 220, fontSize: 11, color: "#64748b" }}>{c.limitations || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 style={{ fontSize: 12.5, fontWeight: 700, margin: "0 0 8px 0" }}>Record Domain Review</h4>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={domainDraft.domain} onChange={(e) => setDomainDraft((p) => ({ ...p, domain: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}>
            {REVIEW_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={domainDraft.status} onChange={(e) => setDomainDraft((p) => ({ ...p, status: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}>
            {DOMAIN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input placeholder="Source snapshot IDs (comma-separated)" value={domainDraft.sourceSnapshotIds} onChange={(e) => setDomainDraft((p) => ({ ...p, sourceSnapshotIds: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 220 }} />
          <input placeholder="Tests performed (comma-separated)" value={domainDraft.testsPerformed} onChange={(e) => setDomainDraft((p) => ({ ...p, testsPerformed: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 200 }} />
          <input placeholder="Matched amount" value={domainDraft.matchedAmount} onChange={(e) => setDomainDraft((p) => ({ ...p, matchedAmount: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 110 }} />
          <input placeholder="Unresolved amount" value={domainDraft.unresolvedAmount} onChange={(e) => setDomainDraft((p) => ({ ...p, unresolvedAmount: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 120 }} />
          <input placeholder="Limitations" value={domainDraft.limitations} onChange={(e) => setDomainDraft((p) => ({ ...p, limitations: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 200 }} />
          <button onClick={handleRecordDomainReview} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Record</button>
        </div>
        <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>REVIEWED requires at least one source snapshot ID or one test performed — the server refuses otherwise.</p>
      </div>

      {/* Findings Register */}
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px 0" }}>Findings Register</h3>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid #f1f5f9" }}>
          <select value={findingDraft.domain} onChange={(e) => setFindingDraft((p) => ({ ...p, domain: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}>
            {REVIEW_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={findingDraft.severity} onChange={(e) => setFindingDraft((p) => ({ ...p, severity: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={findingDraft.findingType} onChange={(e) => setFindingDraft((p) => ({ ...p, findingType: e.target.value }))} style={{ padding: "6px 8px", fontSize: 11.5, borderRadius: 6, border: "1px solid #cbd5e1" }}>
            {FINDING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input placeholder="Title" value={findingDraft.title} onChange={(e) => setFindingDraft((p) => ({ ...p, title: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 220 }} />
          <input placeholder="Financial impact" value={findingDraft.financialImpact} onChange={(e) => setFindingDraft((p) => ({ ...p, financialImpact: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 120 }} />
          <input placeholder="Evidence refs (comma-separated)" value={findingDraft.evidenceRefs} onChange={(e) => setFindingDraft((p) => ({ ...p, evidenceRefs: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 220 }} />
          <button onClick={handleCreateFinding} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Create Finding</button>
        </div>

        {findings.map((f) => (
          <div key={f.finding_id} style={{ border: "1px solid #f1f5f9", borderRadius: 6, padding: 10, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => toggleFinding(f.finding_id)}>
              <div>
                <strong style={{ fontSize: 13 }}>[{f.severity}] {f.title}</strong>
                <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>{f.domain} · {f.finding_type}</span>
              </div>
              <div style={{ fontSize: 11 }}>
                <span style={{ color: f.confirmed_vs_suspected === "CONFIRMED" ? "#dc2626" : "#d97706", fontWeight: 600, marginRight: 10 }}>{f.confirmed_vs_suspected}</span>
                <span style={{ color: "#64748b" }}>{f.status}</span>
              </div>
            </div>

            {expandedFindingId === f.finding_id && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f1f5f9" }}>
                {f.description && <p style={{ fontSize: 12, color: "#475569" }}>{f.description}</p>}
                <p style={{ fontSize: 11.5, color: "#475569" }}>Financial impact: {f.financial_impact ?? "—"} {f.currency ?? ""}</p>
                <p style={{ fontSize: 11, color: "#94a3b8" }}>
                  Evidence drill-back: {(() => { try { const refs = JSON.parse(f.evidence_refs_json); return Array.isArray(refs) && refs.length ? refs.join(", ") : "(none)"; } catch { return "(none)"; } })()}
                </p>

                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <button onClick={() => requestConfirmationChange(f.finding_id, "CONFIRMED")} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Mark CONFIRMED</button>
                  <button onClick={() => requestConfirmationChange(f.finding_id, "SUSPECTED")} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Mark SUSPECTED</button>
                  <button onClick={() => requestConfirmationChange(f.finding_id, "UNKNOWN")} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Mark UNKNOWN</button>
                </div>

                {pendingPrompt && pendingPrompt.kind === "confirmation" && pendingPrompt.findingId === f.finding_id && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10, background: "#fffbeb", padding: 8, borderRadius: 6 }}>
                    <span style={{ fontSize: 11 }}>Reason for setting confirmed_vs_suspected to {pendingPrompt.next}:</span>
                    <input autoFocus value={promptInput} onChange={(e) => setPromptInput(e.target.value)} style={{ flex: 1, padding: "4px 6px", fontSize: 11, borderRadius: 5, border: "1px solid #cbd5e1" }} />
                    <button onClick={submitPendingPrompt} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>Submit</button>
                    <button onClick={() => setPendingPrompt(null)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Cancel</button>
                  </div>
                )}

                <h4 style={{ fontSize: 12, fontWeight: 700, margin: "0 0 6px 0" }}>Action Taken</h4>
                {(actionsByFinding[f.finding_id] || []).map((a) => (
                  <div key={a.action_id} style={{ fontSize: 11.5, padding: "6px 0", borderBottom: "1px dashed #f1f5f9" }}>
                    <div>
                      <strong>{a.action_required}</strong> — owner: {a.action_owner || "unassigned"} — <span style={{ fontWeight: 600 }}>{a.action_status}</span>
                      {a.closure_comment && <span style={{ color: "#94a3b8" }}> ({a.closure_comment})</span>}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      {a.action_status === "OPEN" && <button onClick={() => requestActionTransition(a.action_id, f.finding_id, "assign")} style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Assign</button>}
                      {["ASSIGNED", "WAITING_EVIDENCE"].includes(a.action_status) && <button onClick={() => requestActionTransition(a.action_id, f.finding_id, "in_progress")} style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Start</button>}
                      {a.action_status === "IN_PROGRESS" && <button onClick={() => requestActionTransition(a.action_id, f.finding_id, "waiting_evidence")} style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Waiting Evidence</button>}
                      {["IN_PROGRESS", "WAITING_EVIDENCE"].includes(a.action_status) && <button onClick={() => requestActionTransition(a.action_id, f.finding_id, "resolve")} style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 5, border: "1px solid #16a34a", color: "#16a34a", background: "#fff", cursor: "pointer" }}>Resolve</button>}
                      {a.action_status === "RESOLVED" && <button onClick={() => requestActionTransition(a.action_id, f.finding_id, "close")} style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 5, border: "1px solid #2563eb", color: "#2563eb", background: "#fff", cursor: "pointer" }}>Close</button>}
                      {["CLOSED", "RESOLVED"].includes(a.action_status) && <button onClick={() => requestActionTransition(a.action_id, f.finding_id, "reopen")} style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Reopen</button>}
                      {!["CLOSED", "CANCELLED"].includes(a.action_status) && <button onClick={() => requestActionTransition(a.action_id, f.finding_id, "cancel")} style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 5, border: "1px solid #dc2626", color: "#dc2626", background: "#fff", cursor: "pointer" }}>Cancel</button>}
                    </div>
                    {pendingPrompt && pendingPrompt.actionId === a.action_id && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, background: "#fffbeb", padding: 6, borderRadius: 5 }}>
                        <span style={{ fontSize: 10.5 }}>
                          {pendingPrompt.kind === "close" ? "Closure comment (does not alter the finding):" : "Comment (required):"}
                        </span>
                        <input autoFocus value={promptInput} onChange={(e) => setPromptInput(e.target.value)} style={{ flex: 1, padding: "3px 6px", fontSize: 10.5, borderRadius: 5, border: "1px solid #cbd5e1" }} />
                        <button onClick={submitPendingPrompt} style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 5, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>Submit</button>
                        <button onClick={() => setPendingPrompt(null)} style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Cancel</button>
                      </div>
                    )}
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <input placeholder="New action required..." value={newActionText[f.finding_id] || ""} onChange={(e) => setNewActionText((prev) => ({ ...prev, [f.finding_id]: e.target.value }))} style={{ flex: 1, padding: "5px 8px", fontSize: 11.5, borderRadius: 5, border: "1px solid #cbd5e1" }} />
                  <button onClick={() => handleCreateAction(f.finding_id)} style={{ fontSize: 11, padding: "5px 10px", borderRadius: 5, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, cursor: "pointer" }}>+ Add Action</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {findings.length === 0 && <p style={{ fontSize: 12, color: "#94a3b8" }}>No findings recorded yet for this workspace.</p>}
      </div>
    </div>
  );
}

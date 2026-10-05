"use client";

import React, { useEffect, useState } from "react";

interface WorkspaceRecord {
  workspace_id: string;
  name: string;
}
interface ProposalRecord {
  proposal_id: string;
  rule_key: string;
  version_number: number;
  proposal_type: string;
  scope_type: string;
  title: string;
  status: string;
  test_results_json: string;
  expiry_date: string | null;
  disabled_reason: string | null;
}
interface ConflictRecord {
  conflict_id: string;
  proposal_a_id: string;
  proposal_b_id: string;
  conflict_type: string;
  description: string;
  status: string;
}
interface UnsupportedCaseRecord {
  case_id: string;
  description: string;
  reason_no_safe_decision: string;
  affected_records_estimate: number | null;
  affected_amount: string | null;
  status: string;
  resolution_type: string | null;
}
interface OverrideRecord {
  override_id: string;
  target_description: string;
  override_action: string;
  reviewer: string;
  reason: string;
  created_at: string;
}

const PROPOSAL_TYPES = [
  "STATEMENT_FORMAT_MAPPING", "PARTY_ALIAS", "DOCUMENT_REFERENCE_NORMALIZATION", "DATE_FORMAT_INTERPRETATION",
  "SIGN_PERSPECTIVE_RULE", "SOURCE_COLUMN_MAPPING", "TIMING_WINDOW_RULE", "DEDUCTION_EVIDENCE_PATTERN",
  "UNIT_NORMALIZATION", "REVIEW_CLASSIFICATION_RULE", "PARSING_CORRECTION", "IGNORE_HEADER_FOOTER_RULE",
];
const SCOPE_TYPES = ["PARTY", "CUSTOMER", "VENDOR", "SOURCE_FORMAT", "SOURCE_TYPE", "WORKSPACE", "DATE_RANGE", "ENTITY", "MODULE", "GLOBAL"];

const statusColor: Record<string, string> = {
  DRAFT: "#94a3b8", TESTING: "#d97706", PENDING_APPROVAL: "#2563eb", ACTIVE: "#16a34a",
  DISABLED: "#6b7280", EXPIRED: "#dc2626", REJECTED: "#dc2626", ARCHIVED: "#94a3b8",
};

export function LearningProposalsView() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [cases, setCases] = useState<UnsupportedCaseRecord[]>([]);
  const [overrides, setOverrides] = useState<OverrideRecord[]>([]);
  const [expandedId, setExpandedId] = useState("");
  const [examplesByProposal, setExamplesByProposal] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const [eventsByProposal, setEventsByProposal] = useState<Record<string, Array<Record<string, unknown>>>>({});

  const [draft, setDraft] = useState({
    proposalType: "PARTY_ALIAS", module: "reconciliation", scopeType: "PARTY", title: "",
    matchField: "party_name_raw", matchPattern: "", rationale: "",
  });
  const [exampleDraft, setExampleDraft] = useState<Record<string, { field: string; value: string; type: "POSITIVE" | "NEGATIVE" | "HARD_NEGATIVE" }>>({});

  const [caseDraft, setCaseDraft] = useState({ description: "", reasonNoSafeDecision: "" });
  const [overrideDraft, setOverrideDraft] = useState({ targetDescription: "", overrideAction: "", reviewer: "", reason: "" });

  // Inline reason/approver/resolution prompt — replaces window.prompt/confirm
  // (unsupported in some embedded browser panes) with an on-page form.
  const [pendingPrompt, setPendingPrompt] = useState<{ kind: "approve" | "reject" | "disable" | "rollback" | "resolveConflict"; proposalId?: string; conflictId?: string; isGlobal?: boolean } | null>(null);
  const [promptReason, setPromptReason] = useState("");
  const [promptApprover, setPromptApprover] = useState("");
  const [promptConfirmGlobal, setPromptConfirmGlobal] = useState(false);

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

  async function loadProposals() {
    const params = new URLSearchParams();
    if (selectedWorkspaceId) params.set("workspaceId", selectedWorkspaceId);
    const res = await fetch(`/api/audit/learning/proposals?${params.toString()}`);
    const json = await res.json();
    if (json.success) setProposals(json.proposals);
  }
  async function loadConflicts() {
    const res = await fetch("/api/audit/learning/conflicts");
    const json = await res.json();
    if (json.success) setConflicts(json.conflicts);
  }
  async function loadCases() {
    const params = new URLSearchParams();
    if (selectedWorkspaceId) params.set("workspaceId", selectedWorkspaceId);
    const res = await fetch(`/api/audit/learning/unsupported-cases?${params.toString()}`);
    const json = await res.json();
    if (json.success) setCases(json.cases);
  }
  async function loadOverrides() {
    const params = new URLSearchParams();
    if (selectedWorkspaceId) params.set("workspaceId", selectedWorkspaceId);
    const res = await fetch(`/api/audit/learning/overrides?${params.toString()}`);
    const json = await res.json();
    if (json.success) setOverrides(json.overrides);
  }
  useEffect(() => {
    loadProposals();
    loadConflicts();
    loadCases();
    loadOverrides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkspaceId]);

  async function loadDetail(proposalId: string) {
    const res = await fetch(`/api/audit/learning/proposals/${proposalId}`);
    const json = await res.json();
    if (json.success) {
      setExamplesByProposal((prev) => ({ ...prev, [proposalId]: json.examples }));
      setEventsByProposal((prev) => ({ ...prev, [proposalId]: json.events }));
    }
  }
  function toggleExpand(proposalId: string) {
    if (expandedId === proposalId) {
      setExpandedId("");
      return;
    }
    setExpandedId(proposalId);
    loadDetail(proposalId);
  }

  async function handleCreateProposal() {
    setError(null);
    setMessage(null);
    if (!draft.title.trim() || !draft.matchPattern.trim()) {
      setError("Title and match pattern are required.");
      return;
    }
    const res = await fetch("/api/audit/learning/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalType: draft.proposalType,
        module: draft.module,
        workspaceId: selectedWorkspaceId || undefined,
        scopeType: draft.scopeType,
        ruleConfig: { matchField: draft.matchField, matchPattern: draft.matchPattern },
        title: draft.title,
        rationale: draft.rationale || undefined,
      }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to create proposal");
      return;
    }
    setMessage(`Proposal created (DRAFT): ${json.proposal.title}`);
    setDraft((p) => ({ ...p, title: "", matchPattern: "", rationale: "" }));
    await loadProposals();
  }

  const [replaceDraft, setReplaceDraft] = useState<Record<string, string>>({});

  /** Proposes a NEW version of an existing rule_key — never mutates the current version; predecessor tracking is automatic server-side. */
  async function handleCreateReplacement(p: ProposalRecord) {
    const newPattern = replaceDraft[p.proposal_id];
    if (!newPattern || !newPattern.trim()) return;
    const res = await fetch("/api/audit/learning/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ruleKey: p.rule_key,
        proposalType: p.proposal_type,
        module: "reconciliation",
        scopeType: p.scope_type,
        ruleConfig: { matchField: "party_name_raw", matchPattern: newPattern },
        title: `${p.title} (v${p.version_number + 1})`,
        rationale: "Replacement version proposed during the Milestone E browser walkthrough",
      }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to create replacement version");
      return;
    }
    setMessage(`Replacement proposal created: v${json.proposal.version_number} (DRAFT).`);
    setReplaceDraft((prev) => ({ ...prev, [p.proposal_id]: "" }));
    await loadProposals();
  }

  async function handleAddExample(proposalId: string) {
    const d = exampleDraft[proposalId];
    if (!d || !d.field.trim() || !d.value.trim()) return;
    const res = await fetch(`/api/audit/learning/proposals/${proposalId}/examples`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exampleType: d.type, input: { [d.field]: d.value } }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to add example");
      return;
    }
    setExampleDraft((prev) => ({ ...prev, [proposalId]: { ...prev[proposalId], value: "" } }));
    await loadDetail(proposalId);
  }

  async function handleRunTests(proposalId: string) {
    setError(null);
    const res = await fetch(`/api/audit/learning/proposals/${proposalId}/test`, { method: "POST" });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to run tests");
      return;
    }
    setMessage(`Tests run: ${json.testResults.passed}/${json.testResults.totalExamples} passed.`);
    await loadProposals();
    await loadDetail(proposalId);
  }

  async function handleTransition(proposalId: string, transition: string, extra: Record<string, unknown> = {}) {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/audit/learning/proposals/${proposalId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transition, ...extra }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || `Failed to ${transition}`);
      return;
    }
    setMessage(`${transition} succeeded.`);
    await loadProposals();
    await loadConflicts();
    await loadDetail(proposalId);
  }

  function requestPrompt(kind: "approve" | "reject" | "disable" | "rollback" | "resolveConflict", proposalId?: string, conflictId?: string, isGlobal = false) {
    setPendingPrompt({ kind, proposalId, conflictId, isGlobal });
    setPromptReason("");
    setPromptApprover("");
    setPromptConfirmGlobal(false);
  }

  async function handleResolveConflict(conflictId: string, resolution: string) {
    const res = await fetch(`/api/audit/learning/conflicts/${conflictId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to resolve conflict");
      return;
    }
    await loadConflicts();
  }

  async function submitPendingPrompt() {
    if (!pendingPrompt) return;
    const reason = promptReason.trim();

    if (pendingPrompt.kind === "resolveConflict") {
      if (!reason || !pendingPrompt.conflictId) return;
      await handleResolveConflict(pendingPrompt.conflictId, reason);
      setPendingPrompt(null);
      return;
    }

    if (!pendingPrompt.proposalId) return;
    if (pendingPrompt.kind === "approve") {
      const approver = promptApprover.trim();
      if (!approver || !reason) return;
      if (pendingPrompt.isGlobal && !promptConfirmGlobal) return;
      await handleTransition(pendingPrompt.proposalId, "approve", { approver, reason, confirmGlobal: pendingPrompt.isGlobal ? true : undefined });
    } else {
      if (!reason) return;
      await handleTransition(pendingPrompt.proposalId, pendingPrompt.kind, { reason });
    }
    setPendingPrompt(null);
  }

  async function handleCreateCase() {
    if (!caseDraft.description.trim() || !caseDraft.reasonNoSafeDecision.trim()) {
      setError("Description and reason are required.");
      return;
    }
    const res = await fetch("/api/audit/learning/unsupported-cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: selectedWorkspaceId || undefined, description: caseDraft.description, reasonNoSafeDecision: caseDraft.reasonNoSafeDecision }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to create case");
      return;
    }
    setCaseDraft({ description: "", reasonNoSafeDecision: "" });
    await loadCases();
  }

  /** Records a one-time approved override. Structurally separate from learning proposals: this never creates/edits any learning_proposals row, applies only to the described case, and never trains anything automatically. */
  async function handleCreateOverride() {
    if (!overrideDraft.targetDescription.trim() || !overrideDraft.overrideAction.trim() || !overrideDraft.reviewer.trim() || !overrideDraft.reason.trim()) {
      setError("Target description, action, reviewer, and reason are all required for a one-time override.");
      return;
    }
    const res = await fetch("/api/audit/learning/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: selectedWorkspaceId || undefined, ...overrideDraft }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to create override");
      return;
    }
    setMessage("One-time override recorded — applies only to this case, does not edit any reusable rule.");
    setOverrideDraft({ targetDescription: "", overrideAction: "", reviewer: "", reason: "" });
    await loadOverrides();
  }

  async function handleResolveCase(caseId: string, resolutionType: string) {
    const res = await fetch(`/api/audit/learning/unsupported-cases/${caseId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolutionType }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to resolve case");
      return;
    }
    await loadCases();
  }

  return (
    <div className="section-card" style={{ padding: 24, maxWidth: 1150 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>Reconciliation &amp; Audit — Learning Proposals</h2>
      <p style={{ fontSize: 12, color: "#64748b", margin: "6px 0 16px 0" }}>
        Default behavior is <strong>SUGGEST_ONLY</strong>. A correction never automatically becomes a reusable rule — every rule is versioned, must be tested against its own positive/negative
        examples, and only reaches ACTIVE through an explicit owner approval. GLOBAL scope requires an extra confirmation. Rollback preserves history; it never rewrites past runs or reports.
      </p>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ marginBottom: 12, fontSize: 12, color: "#166534", background: "#f0fdf4", padding: "8px 12px", borderRadius: 6 }}>{message}</div>}

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Workspace (optional filter)</label>
        <select value={selectedWorkspaceId} onChange={(e) => setSelectedWorkspaceId(e.target.value)} style={{ display: "block", marginTop: 4, padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #cbd5e1", minWidth: 320 }}>
          <option value="">— all workspaces —</option>
          {workspaces.map((w) => (
            <option key={w.workspace_id} value={w.workspace_id}>{w.name}</option>
          ))}
        </select>
      </div>

      {conflicts.length > 0 && (
        <div style={{ border: "1px solid #fca5a5", background: "#fef2f2", borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px 0", color: "#991b1b" }}>Open Rule Conflicts — Activation Blocked</h3>
          {conflicts.map((c) => (
            <div key={c.conflict_id} style={{ fontSize: 12, marginBottom: 8, paddingBottom: 8, borderBottom: "1px dashed #fca5a5" }}>
              <div><strong>{c.conflict_type}</strong>: {c.description}</div>
              <button onClick={() => requestPrompt("resolveConflict", undefined, c.conflict_id)} style={{ marginTop: 4, fontSize: 11, padding: "3px 8px", borderRadius: 5, border: "1px solid #dc2626", color: "#dc2626", background: "#fff", cursor: "pointer" }}>Resolve</button>
              {pendingPrompt && pendingPrompt.conflictId === c.conflict_id && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                  <span style={{ fontSize: 11 }}>Resolution note:</span>
                  <input autoFocus value={promptReason} onChange={(e) => setPromptReason(e.target.value)} style={{ flex: 1, padding: "4px 6px", fontSize: 11, borderRadius: 5, border: "1px solid #cbd5e1" }} />
                  <button onClick={submitPendingPrompt} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>Submit</button>
                  <button onClick={() => setPendingPrompt(null)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px 0" }}>New Learning Proposal (DRAFT)</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <select value={draft.proposalType} onChange={(e) => setDraft((p) => ({ ...p, proposalType: e.target.value }))} style={{ padding: "6px 8px", fontSize: 11.5, borderRadius: 6, border: "1px solid #cbd5e1" }}>
            {PROPOSAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={draft.scopeType} onChange={(e) => setDraft((p) => ({ ...p, scopeType: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}>
            {SCOPE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input placeholder="Module (e.g. reconciliation)" value={draft.module} onChange={(e) => setDraft((p) => ({ ...p, module: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 160 }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input placeholder="Title" value={draft.title} onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 260 }} />
          <input placeholder="Match field (e.g. party_name_raw)" value={draft.matchField} onChange={(e) => setDraft((p) => ({ ...p, matchField: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 200 }} />
          <input placeholder="Match pattern (or regex:...)" value={draft.matchPattern} onChange={(e) => setDraft((p) => ({ ...p, matchPattern: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 200 }} />
        </div>
        <textarea placeholder="Rationale / owner reviewer notes" value={draft.rationale} onChange={(e) => setDraft((p) => ({ ...p, rationale: e.target.value }))} style={{ width: "100%", padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", marginBottom: 8, minHeight: 40 }} />
        <button onClick={handleCreateProposal} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Create Proposal (DRAFT)</button>
      </div>

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px 0" }}>Proposals</h3>
        {proposals.map((p) => (
          <div key={p.proposal_id} style={{ border: "1px solid #f1f5f9", borderRadius: 6, padding: 10, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }} onClick={() => toggleExpand(p.proposal_id)}>
              <div>
                <strong style={{ fontSize: 13 }}>{p.title}</strong>
                <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>{p.proposal_type} · {p.scope_type} · v{p.version_number}</span>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: statusColor[p.status] || "#334155" }}>{p.status}</span>
            </div>

            {expandedId === p.proposal_id && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f1f5f9" }}>
                <h4 style={{ fontSize: 12, fontWeight: 700, margin: "0 0 6px 0" }}>Examples</h4>
                {(examplesByProposal[p.proposal_id] || []).map((ex: any) => (
                  <div key={ex.example_id} style={{ fontSize: 11, color: "#475569" }}>[{ex.example_type}] {ex.input_json}</div>
                ))}
                <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                  <select value={exampleDraft[p.proposal_id]?.type || "POSITIVE"} onChange={(e) => setExampleDraft((prev) => ({ ...prev, [p.proposal_id]: { field: prev[p.proposal_id]?.field || "party_name_raw", value: prev[p.proposal_id]?.value || "", type: e.target.value as any } }))} style={{ fontSize: 11, padding: "3px 6px", borderRadius: 5, border: "1px solid #cbd5e1" }}>
                    <option value="POSITIVE">POSITIVE</option>
                    <option value="NEGATIVE">NEGATIVE</option>
                    <option value="HARD_NEGATIVE">HARD_NEGATIVE</option>
                  </select>
                  <input placeholder="field name" value={exampleDraft[p.proposal_id]?.field || ""} onChange={(e) => setExampleDraft((prev) => ({ ...prev, [p.proposal_id]: { field: e.target.value, value: prev[p.proposal_id]?.value || "", type: prev[p.proposal_id]?.type || "POSITIVE" } }))} style={{ fontSize: 11, padding: "3px 6px", borderRadius: 5, border: "1px solid #cbd5e1", width: 120 }} />
                  <input placeholder="field value" value={exampleDraft[p.proposal_id]?.value || ""} onChange={(e) => setExampleDraft((prev) => ({ ...prev, [p.proposal_id]: { field: prev[p.proposal_id]?.field || "party_name_raw", value: e.target.value, type: prev[p.proposal_id]?.type || "POSITIVE" } }))} style={{ fontSize: 11, padding: "3px 6px", borderRadius: 5, border: "1px solid #cbd5e1", width: 140 }} />
                  <button onClick={() => handleAddExample(p.proposal_id)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>+ Add Example</button>
                </div>

                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  {["DRAFT", "TESTING"].includes(p.status) && <button onClick={() => handleRunTests(p.proposal_id)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Run Tests</button>}
                  {p.status === "TESTING" && <button onClick={() => handleTransition(p.proposal_id, "submit")} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #2563eb", color: "#2563eb", background: "#fff", cursor: "pointer" }}>Submit for Approval</button>}
                  {p.status === "PENDING_APPROVAL" && <button onClick={() => requestPrompt("approve", p.proposal_id, undefined, p.scope_type === "GLOBAL")} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #16a34a", color: "#16a34a", background: "#fff", cursor: "pointer" }}>Approve &amp; Activate</button>}
                  {["TESTING", "PENDING_APPROVAL"].includes(p.status) && <button onClick={() => requestPrompt("reject", p.proposal_id)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #dc2626", color: "#dc2626", background: "#fff", cursor: "pointer" }}>Reject</button>}
                  {p.status === "ACTIVE" && <button onClick={() => requestPrompt("disable", p.proposal_id)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #dc2626", color: "#dc2626", background: "#fff", cursor: "pointer" }}>Disable</button>}
                  {["ACTIVE", "DISABLED"].includes(p.status) && <button onClick={() => requestPrompt("rollback", p.proposal_id)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Rollback to this version</button>}
                  {["DISABLED", "REJECTED", "EXPIRED"].includes(p.status) && <button onClick={() => handleTransition(p.proposal_id, "archive")} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Archive</button>}
                </div>

                {["ACTIVE", "DISABLED"].includes(p.status) && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>Propose replacement (new pattern):</span>
                    <input value={replaceDraft[p.proposal_id] || ""} onChange={(e) => setReplaceDraft((prev) => ({ ...prev, [p.proposal_id]: e.target.value }))} placeholder="e.g. Synthetic Vendor Co Ltd" style={{ flex: 1, padding: "4px 6px", fontSize: 11, borderRadius: 5, border: "1px solid #cbd5e1" }} />
                    <button onClick={() => handleCreateReplacement(p)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>+ Propose Replacement Version</button>
                  </div>
                )}

                {(() => {
                  const history = proposals.filter((h) => h.rule_key === p.rule_key).sort((a, b) => a.version_number - b.version_number);
                  if (history.length <= 1) return null;
                  return (
                    <div style={{ marginTop: 8, fontSize: 11 }}>
                      <strong>Version history:</strong>{" "}
                      {history.map((h) => (
                        <span key={h.proposal_id} style={{ marginRight: 10, color: statusColor[h.status] || "#334155" }}>
                          v{h.version_number}: {h.status}
                        </span>
                      ))}
                    </div>
                  );
                })()}

                {pendingPrompt && pendingPrompt.proposalId === p.proposal_id && (
                  <div style={{ marginTop: 8, background: "#fffbeb", padding: 8, borderRadius: 6 }}>
                    {pendingPrompt.kind === "approve" && (
                      <>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                          <span style={{ fontSize: 11 }}>Approver identity:</span>
                          <input autoFocus value={promptApprover} onChange={(e) => setPromptApprover(e.target.value)} style={{ flex: 1, padding: "4px 6px", fontSize: 11, borderRadius: 5, border: "1px solid #cbd5e1" }} />
                        </div>
                        {pendingPrompt.isGlobal && (
                          <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, fontSize: 11, color: "#991b1b" }}>
                            <input type="checkbox" checked={promptConfirmGlobal} onChange={(e) => setPromptConfirmGlobal(e.target.checked)} />
                            This rule is scoped GLOBAL — the hardest level to approve. I confirm activation.
                          </label>
                        )}
                      </>
                    )}
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 11 }}>
                        {pendingPrompt.kind === "approve" ? "Reason:" : `Reason for ${pendingPrompt.kind}:`}
                      </span>
                      <input value={promptReason} onChange={(e) => setPromptReason(e.target.value)} style={{ flex: 1, padding: "4px 6px", fontSize: 11, borderRadius: 5, border: "1px solid #cbd5e1" }} />
                      <button
                        onClick={submitPendingPrompt}
                        disabled={pendingPrompt.kind === "approve" && pendingPrompt.isGlobal && !promptConfirmGlobal}
                        style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}
                      >
                        Submit
                      </button>
                      <button onClick={() => setPendingPrompt(null)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {proposals.length === 0 && <p style={{ fontSize: 12, color: "#94a3b8" }}>No learning proposals recorded yet.</p>}
      </div>

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px 0" }}>Unsupported / Uncertain Cases</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input placeholder="What is unsupported/uncertain" value={caseDraft.description} onChange={(e) => setCaseDraft((p) => ({ ...p, description: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 320 }} />
          <input placeholder="Why no safe decision was possible" value={caseDraft.reasonNoSafeDecision} onChange={(e) => setCaseDraft((p) => ({ ...p, reasonNoSafeDecision: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 320 }} />
          <button onClick={handleCreateCase} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, cursor: "pointer" }}>+ Log Case</button>
        </div>
        {cases.map((c) => (
          <div key={c.case_id} style={{ fontSize: 12, borderBottom: "1px solid #f1f5f9", padding: "6px 0" }}>
            <div><strong>{c.description}</strong> — <span style={{ color: "#64748b" }}>{c.status}</span></div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{c.reason_no_safe_decision}</div>
            {c.status === "OPEN" && (
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button onClick={() => handleResolveCase(c.case_id, "HOLD")} style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Hold</button>
                <button onClick={() => handleResolveCase(c.case_id, "REQUEST_EVIDENCE")} style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Request Evidence</button>
              </div>
            )}
          </div>
        ))}
        {cases.length === 0 && <p style={{ fontSize: 12, color: "#94a3b8" }}>No unsupported cases logged.</p>}
      </div>

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginTop: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 6px 0" }}>One-Time Overrides</h3>
        <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 0, marginBottom: 10 }}>
          Applies only to the described case. Never edits a reusable rule, never becomes training automatically. Kept structurally separate from Learning Proposals above.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <input placeholder="Target description (what this applies to)" value={overrideDraft.targetDescription} onChange={(e) => setOverrideDraft((p) => ({ ...p, targetDescription: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 260 }} />
          <input placeholder="Action taken (this case only)" value={overrideDraft.overrideAction} onChange={(e) => setOverrideDraft((p) => ({ ...p, overrideAction: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 220 }} />
          <input placeholder="Reviewer" value={overrideDraft.reviewer} onChange={(e) => setOverrideDraft((p) => ({ ...p, reviewer: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 140 }} />
          <input placeholder="Reason / evidence" value={overrideDraft.reason} onChange={(e) => setOverrideDraft((p) => ({ ...p, reason: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", width: 220 }} />
          <button onClick={handleCreateOverride} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, cursor: "pointer" }}>+ Record One-Time Override</button>
        </div>
        {overrides.map((o) => (
          <div key={o.override_id} style={{ fontSize: 12, borderBottom: "1px solid #f1f5f9", padding: "6px 0" }}>
            <div><strong>{o.target_description}</strong> — {o.override_action}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Reviewer: {o.reviewer} · {o.reason}</div>
          </div>
        ))}
        {overrides.length === 0 && <p style={{ fontSize: 12, color: "#94a3b8" }}>No one-time overrides recorded.</p>}
      </div>
    </div>
  );
}

"use client";

import React, { useEffect, useState } from "react";

type ComparisonMode = "INTERNAL_EXTERNAL" | "EXTERNAL_EXTERNAL" | "INTERNAL_INTERNAL";

const COMPARISON_MODES: { value: ComparisonMode; label: string; hint: string }[] = [
  { value: "INTERNAL_EXTERNAL", label: "Internal vs External", hint: "e.g. internal payable ledger vs supplier statement" },
  { value: "EXTERNAL_EXTERNAL", label: "External vs External", hint: "e.g. supplier statement vs bank statement" },
  { value: "INTERNAL_INTERNAL", label: "Internal vs Internal", hint: "e.g. bills register vs payable GL" },
];

interface WorkspaceSourceDraft {
  roleLabel: string;
  sourceOrigin: "INTERNAL" | "EXTERNAL";
  originDescription: string;
  provenance: string;
  sourceVersionRef: string;
  basisNote: string;
}

interface WorkspaceRecord {
  workspace_id: string;
  name: string;
  comparison_mode: ComparisonMode;
  purpose: string | null;
  entity_name: string | null;
  period_from: string | null;
  period_to: string | null;
  amount_basis: string | null;
  status: string;
  created_at: string;
  sources: Array<{ role_label: string; source_origin: string; provenance: string | null }>;
}

interface BooksSourceSummary {
  organizationName: string | null;
  salesInvoiceCount: number;
  purchaseBillCount: number;
  distinctVendorCount: number;
  distinctCustomerCount: number;
}

function emptySource(): WorkspaceSourceDraft {
  return { roleLabel: "", sourceOrigin: "INTERNAL", originDescription: "", provenance: "", sourceVersionRef: "", basisNote: "" };
}

export function AuditWorkspaceView() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [summary, setSummary] = useState<BooksSourceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("INTERNAL_EXTERNAL");
  const [purpose, setPurpose] = useState("");
  const [entityName, setEntityName] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [amountBasis, setAmountBasis] = useState("");
  const [sources, setSources] = useState<WorkspaceSourceDraft[]>([emptySource(), emptySource()]);

  async function load() {
    setLoading(true);
    try {
      const [wsRes, summaryRes] = await Promise.all([
        fetch("/api/audit/workspaces"),
        fetch("/api/audit/source-summary"),
      ]);
      const wsJson = await wsRes.json();
      const summaryJson = await summaryRes.json();
      if (wsJson.success) setWorkspaces(wsJson.workspaces);
      if (summaryJson.success) setSummary(summaryJson.summary);
    } catch {
      // keep prior state; view still renders
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetWizard() {
    setName("");
    setComparisonMode("INTERNAL_EXTERNAL");
    setPurpose("");
    setEntityName("");
    setPeriodFrom("");
    setPeriodTo("");
    setAmountBasis("");
    setSources([emptySource(), emptySource()]);
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError("Workspace name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/audit/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          comparisonMode,
          purpose: purpose || undefined,
          entityName: entityName || undefined,
          periodFrom: periodFrom || undefined,
          periodTo: periodTo || undefined,
          amountBasis: amountBasis || undefined,
          sources: sources
            .filter((s) => s.roleLabel.trim())
            .map((s) => ({
              roleLabel: s.roleLabel,
              sourceOrigin: s.sourceOrigin,
              originDescription: s.originDescription || undefined,
              provenance: s.provenance || undefined,
              sourceVersionRef: s.sourceVersionRef || undefined,
              basisNote: s.basisNote || undefined,
            })),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Failed to create workspace");
        return;
      }
      setShowWizard(false);
      resetWizard();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create workspace");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="section-card" style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>Reconciliation &amp; Audit — Workspaces</h2>
          <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
            Internal review working-paper workspaces. Upload, matching, OCR and AI assistance are disabled in this
            milestone — this screen captures workspace scope and source provenance metadata only.
          </div>
        </div>
        <button
          onClick={() => setShowWizard((v) => !v)}
          style={{ background: "#1a73e8", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          {showWizard ? "Cancel" : "+ New Workspace"}
        </button>
      </div>

      <div
        style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "10px 14px", marginBottom: 20, fontSize: 12.5, color: "#78350f", lineHeight: 1.5 }}
      >
        ⚠️ <strong>Scope limitation:</strong> This is an internal review working paper shell, not a CA-signed audit
        certificate. No Zoho write, no automatic journals/postings, and no automatic matching happen from this
        screen. Missing fields stay missing — nothing here is auto-filled or estimated.
      </div>

      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
          {[
            { label: "Organization", value: summary.organizationName || "—" },
            { label: "Sales Invoices (cached)", value: summary.salesInvoiceCount },
            { label: "Purchase Bills (cached)", value: summary.purchaseBillCount },
            { label: "Distinct Vendors", value: summary.distinctVendorCount },
          ].map((kpi) => (
            <div key={kpi.label} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px", background: "#f8fafc" }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>{kpi.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>{kpi.value}</div>
            </div>
          ))}
        </div>
      )}

      {showWizard && (
        <div style={{ border: "1px solid #dadce0", borderRadius: 8, padding: 18, marginBottom: 24, background: "#fff" }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>New Workspace — Scope &amp; Source Metadata</h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 12.5 }}>
              Workspace name
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="e.g. Schneider Electric — Sep 2026 statement review" />
            </label>
            <label style={{ fontSize: 12.5 }}>
              Comparison mode
              <select value={comparisonMode} onChange={(e) => setComparisonMode(e.target.value as ComparisonMode)} style={inputStyle}>
                {COMPARISON_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                {COMPARISON_MODES.find((m) => m.value === comparisonMode)?.hint}
              </div>
            </label>
            <label style={{ fontSize: 12.5 }}>
              Purpose / review question
              <input value={purpose} onChange={(e) => setPurpose(e.target.value)} style={inputStyle} placeholder="e.g. Confirm vendor statement agrees with our payable ledger" />
            </label>
            <label style={{ fontSize: 12.5 }}>
              Entity / party name
              <input value={entityName} onChange={(e) => setEntityName(e.target.value)} style={inputStyle} placeholder="e.g. Schneider Electric India Pvt Ltd" />
            </label>
            <label style={{ fontSize: 12.5 }}>
              Period from
              <input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ fontSize: 12.5 }}>
              Period to
              <input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ fontSize: 12.5, gridColumn: "1 / -1" }}>
              Amount / quantity basis (explicit — leave blank if not yet decided)
              <input value={amountBasis} onChange={(e) => setAmountBasis(e.target.value)} style={inputStyle} placeholder="e.g. Taxable value, ex-GST" />
            </label>
          </div>

          <h4 style={{ fontSize: 13, fontWeight: 700, margin: "16px 0 8px" }}>Sources</h4>
          {sources.map((s, idx) => (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <input
                placeholder={`Role label (e.g. SOURCE_${String.fromCharCode(65 + idx)})`}
                value={s.roleLabel}
                onChange={(e) => setSources((prev) => prev.map((x, i) => (i === idx ? { ...x, roleLabel: e.target.value } : x)))}
                style={inputStyle}
              />
              <select
                value={s.sourceOrigin}
                onChange={(e) => setSources((prev) => prev.map((x, i) => (i === idx ? { ...x, sourceOrigin: e.target.value as "INTERNAL" | "EXTERNAL" } : x)))}
                style={inputStyle}
              >
                <option value="INTERNAL">Internal</option>
                <option value="EXTERNAL">External</option>
              </select>
              <input
                placeholder="Provenance (e.g. Zoho export, vendor email)"
                value={s.provenance}
                onChange={(e) => setSources((prev) => prev.map((x, i) => (i === idx ? { ...x, provenance: e.target.value } : x)))}
                style={inputStyle}
              />
              <input
                placeholder="Description"
                value={s.originDescription}
                onChange={(e) => setSources((prev) => prev.map((x, i) => (i === idx ? { ...x, originDescription: e.target.value } : x)))}
                style={inputStyle}
              />
              <button onClick={() => setSources((prev) => prev.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 16 }} title="Remove source">
                ✕
              </button>
            </div>
          ))}
          <button onClick={() => setSources((prev) => [...prev, emptySource()])} style={{ fontSize: 12, color: "#1a73e8", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            + Add another source
          </button>

          {error && <div style={{ color: "#dc2626", fontSize: 12.5, marginTop: 12 }}>{error}</div>}

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button
              onClick={handleCreate}
              disabled={saving}
              style={{ background: "#1a73e8", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}
            >
              {saving ? "Saving…" : "Save Workspace (Draft)"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 30, textAlign: "center", color: "#64748b" }}>Loading workspaces…</div>
      ) : workspaces.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "#64748b", border: "1px dashed #cbd5e1", borderRadius: 8 }}>
          No audit workspaces yet. Use “+ New Workspace” to record scope and source metadata.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e2e8f0", textAlign: "left" }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Mode</th>
                <th style={thStyle}>Entity</th>
                <th style={thStyle}>Period</th>
                <th style={thStyle}>Sources</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => (
                <tr key={w.workspace_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={tdStyle}>{w.name}</td>
                  <td style={tdStyle}>{w.comparison_mode}</td>
                  <td style={tdStyle}>{w.entity_name || "—"}</td>
                  <td style={tdStyle}>
                    {w.period_from || "—"} → {w.period_to || "—"}
                  </td>
                  <td style={tdStyle}>{w.sources.length}</td>
                  <td style={tdStyle}>
                    <span style={{ background: "#f1f5f9", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{w.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "6px 8px",
  border: "1px solid #cbd5e1",
  borderRadius: 4,
  fontSize: 13,
};

const thStyle: React.CSSProperties = { padding: "8px 10px", color: "#475569", fontWeight: 600, fontSize: 11.5, textTransform: "uppercase" };
const tdStyle: React.CSSProperties = { padding: "8px 10px", color: "#0f172a" };

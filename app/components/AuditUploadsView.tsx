"use client";

import React, { useEffect, useState } from "react";

const NORMALIZED_FIELD_KEYS = [
  "document_number_raw",
  "party_name_raw",
  "transaction_date",
  "posting_date",
  "debit_raw",
  "credit_raw",
  "gross_value",
  "taxable_value",
  "settled_amount",
  "currency",
  "quantity",
  "unit",
  "description_raw",
];

interface WorkspaceRecord {
  workspace_id: string;
  name: string;
  sources: SourceRecord[];
}

interface SourceRecord {
  source_id: string;
  role_label: string;
  source_origin: "INTERNAL" | "EXTERNAL";
  provenance: string | null;
}

interface VersionRecord {
  version_id: string;
  version_number: number;
  origin_type: string;
  extraction_status: string;
  raw_row_count: number | null;
  parsed_row_count: number | null;
  exception_count: number | null;
  mapping_status: string;
  mapping_version: number;
  completeness_status: string;
  frozen: number;
}

export function AuditUploadsView() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [versionsBySource, setVersionsBySource] = useState<Record<string, VersionRecord[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [newSourceOrigin, setNewSourceOrigin] = useState<"INTERNAL" | "EXTERNAL">("EXTERNAL");

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({});
  const [openingBalance, setOpeningBalance] = useState("");
  const [closingBalance, setClosingBalance] = useState("");
  const [completenessResult, setCompletenessResult] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);

  const [headerRowNumber, setHeaderRowNumber] = useState("1");
  const [dataStartRowNumber, setDataStartRowNumber] = useState("");
  const [rawRowsPreview, setRawRowsPreview] = useState<any>(null);
  const [showRawRows, setShowRawRows] = useState(false);
  const [headerAmbiguity, setHeaderAmbiguity] = useState<string[] | null>(null);

  const [zohoReportType, setZohoReportType] = useState("sales_invoices");
  const [zohoPeriodFrom, setZohoPeriodFrom] = useState("");
  const [zohoPeriodTo, setZohoPeriodTo] = useState("");
  const [zohoBusy, setZohoBusy] = useState(false);
  const [zohoResult, setZohoResult] = useState<any>(null);

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

  async function handleAddSource() {
    setError(null);
    if (!newRoleLabel.trim()) {
      setError("Role label is required.");
      return;
    }
    const res = await fetch(`/api/audit/workspaces/${selectedWorkspaceId}/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleLabel: newRoleLabel, sourceOrigin: newSourceOrigin }),
    });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Failed to add source");
      return;
    }
    setNewRoleLabel("");
    await loadWorkspaces();
  }

  async function handleUpload(sourceId: string, file: File) {
    setError(null);
    setMessage(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/audit/workspaces/${selectedWorkspaceId}/sources/${sourceId}/upload`, { method: "POST", body: form });
    const json = await res.json();
    if (!json.success) {
      setError(json.error || "Upload failed");
      return;
    }
    setMessage(`Uploaded. Extraction status: ${json.extraction.status}`);
    await loadVersions(sourceId);
  }

  async function handleZohoAcquire(sourceId: string) {
    setError(null);
    setZohoResult(null);
    if (!zohoPeriodFrom || !zohoPeriodTo) {
      setError("Period from/to are required for a Zoho acquisition.");
      return;
    }
    setZohoBusy(true);
    try {
      const res = await fetch(`/api/audit/workspaces/${selectedWorkspaceId}/sources/${sourceId}/zoho-acquire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportType: zohoReportType, periodFrom: zohoPeriodFrom, periodTo: zohoPeriodTo }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Zoho acquisition failed");
        return;
      }
      setZohoResult(json);
      await loadVersions(sourceId);
    } finally {
      setZohoBusy(false);
    }
  }

  async function openVersion(versionId: string) {
    setSelectedVersionId(versionId);
    setPreview(null);
    setFieldMap({});
    setCompletenessResult(null);
    setRows([]);
    setHeaderRowNumber("1");
    setDataStartRowNumber("");
    setRawRowsPreview(null);
    setShowRawRows(false);
    setHeaderAmbiguity(null);
    const res = await fetch(`/api/audit/source-versions/${versionId}/mapping-preview`);
    const json = await res.json();
    if (json.success) setPreview(json.preview);

    const rawRes = await fetch(`/api/audit/source-versions/${versionId}/raw-rows-preview`);
    const rawJson = await rawRes.json();
    if (rawJson.success) setRawRowsPreview(rawJson.preview);
  }

  async function handleApproveMapping(acknowledge: boolean = false) {
    if (!selectedVersionId) return;
    setError(null);
    setHeaderAmbiguity(null);
    const res = await fetch(`/api/audit/source-versions/${selectedVersionId}/approve-mapping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fieldMap,
        headerRowNumber: rawRowsPreview?.supported ? parseInt(headerRowNumber, 10) || 1 : undefined,
        dataStartRowNumber: rawRowsPreview?.supported && dataStartRowNumber ? parseInt(dataStartRowNumber, 10) : undefined,
        acknowledgeAmbiguousHeader: acknowledge,
      }),
    });
    const json = await res.json();
    if (!json.success) {
      if (json.needsReview) {
        setHeaderAmbiguity(json.reasons || [json.error]);
        setMessage(null);
        return;
      }
      setError(json.error || "Failed to approve mapping");
      return;
    }
    setMessage("Mapping approved and normalized rows generated.");
    if (selectedWorkspace) for (const s of selectedWorkspace.sources) await loadVersions(s.source_id);
  }

  async function handleComputeCompleteness() {
    if (!selectedVersionId) return;
    const body: Record<string, number> = {};
    if (openingBalance !== "") body.openingBalance = parseFloat(openingBalance);
    if (closingBalance !== "") body.closingBalance = parseFloat(closingBalance);
    const res = await fetch(`/api/audit/source-versions/${selectedVersionId}/completeness`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) setCompletenessResult(json.check);
    else setError(json.error);
  }

  async function handleFreeze() {
    if (!selectedVersionId) return;
    const res = await fetch(`/api/audit/source-versions/${selectedVersionId}/freeze`, { method: "POST" });
    const json = await res.json();
    if (!json.success) {
      setError(json.error);
      return;
    }
    setMessage("Source version frozen — this is now an immutable snapshot.");
    if (selectedWorkspace) for (const s of selectedWorkspace.sources) await loadVersions(s.source_id);
  }

  async function handleViewRows() {
    if (!selectedVersionId) return;
    const res = await fetch(`/api/audit/source-versions/${selectedVersionId}/rows`);
    const json = await res.json();
    if (json.success) setRows(json.rows);
  }

  return (
    <div className="section-card" style={{ padding: 24, maxWidth: 1200 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>Uploads &amp; Source Mapping</h2>
      <p style={{ fontSize: 13, color: "#64748b", marginTop: 6, marginBottom: 16 }}>
        PDF/XLSX/CSV evidence intake and read-only internal/Zoho source acquisition. This screen only builds
        frozen, versioned source snapshots — use Match Review once two or more sources are frozen. Findings/
        exports remain pending for a later milestone.
      </p>

      {error && <div style={{ color: "#dc2626", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ color: "#166534", fontSize: 12.5, marginBottom: 10 }}>{message}</div>}

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12.5 }}>
          Workspace
          <select value={selectedWorkspaceId} onChange={(e) => setSelectedWorkspaceId(e.target.value)} style={{ display: "block", marginTop: 4, padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 13, minWidth: 300 }}>
            {workspaces.map((w) => (
              <option key={w.workspace_id} value={w.workspace_id}>{w.name}</option>
            ))}
          </select>
        </label>
      </div>

      {!selectedWorkspace && <div style={{ color: "#64748b", fontSize: 13 }}>No workspace yet — create one under Workspaces / Runs first.</div>}

      {selectedWorkspace && (
        <>
          <div style={{ border: "1px solid #dadce0", borderRadius: 8, padding: 16, marginBottom: 20 }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Add Source</h4>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input placeholder="Role label (e.g. SOURCE_A)" value={newRoleLabel} onChange={(e) => setNewRoleLabel(e.target.value)} style={{ padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 13 }} />
              <select value={newSourceOrigin} onChange={(e) => setNewSourceOrigin(e.target.value as "INTERNAL" | "EXTERNAL")} style={{ padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 13 }}>
                <option value="INTERNAL">Internal</option>
                <option value="EXTERNAL">External</option>
              </select>
              <button onClick={handleAddSource} style={{ background: "#1a73e8", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Add</button>
            </div>
          </div>

          {selectedWorkspace.sources.map((source) => (
            <div key={source.source_id} style={{ border: "1px solid #dadce0", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h4 style={{ fontSize: 13, fontWeight: 700 }}>{source.role_label} <span style={{ fontWeight: 400, color: "#64748b" }}>({source.source_origin})</span></h4>
                <label style={{ fontSize: 12, background: "#1a73e8", color: "#fff", padding: "5px 12px", borderRadius: 6, cursor: "pointer" }}>
                  Upload File
                  <input type="file" accept=".pdf,.xlsx,.csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(source.source_id, f); }} />
                </label>
              </div>

              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Zoho READ-ONLY acquisition (explicit action only)</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <select value={zohoReportType} onChange={(e) => setZohoReportType(e.target.value)} style={{ padding: "5px 6px", fontSize: 12, border: "1px solid #cbd5e1", borderRadius: 4 }}>
                    <option value="sales_invoices">Sales Invoices</option>
                    <option value="purchase_bills">Purchase Bills</option>
                  </select>
                  <input type="date" value={zohoPeriodFrom} onChange={(e) => setZohoPeriodFrom(e.target.value)} style={{ padding: "5px 6px", fontSize: 12, border: "1px solid #cbd5e1", borderRadius: 4 }} />
                  <span style={{ fontSize: 12 }}>to</span>
                  <input type="date" value={zohoPeriodTo} onChange={(e) => setZohoPeriodTo(e.target.value)} style={{ padding: "5px 6px", fontSize: 12, border: "1px solid #cbd5e1", borderRadius: 4 }} />
                  <button onClick={() => handleZohoAcquire(source.source_id)} disabled={zohoBusy} style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: 4, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>
                    {zohoBusy ? "Fetching…" : "Sync / Fetch Source"}
                  </button>
                </div>
                {zohoResult && (
                  <div style={{ fontSize: 11, marginTop: 6, color: "#334155" }}>
                    {zohoResult.status} · coverage {zohoResult.coverageStatus} · {zohoResult.recordCount} records · {zohoResult.apiCallCount} API calls · {zohoResult.pageCount} pages
                    {zohoResult.error ? ` · error: ${zohoResult.error}` : ""}
                  </div>
                )}
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                    <th style={{ padding: 6 }}>V</th>
                    <th style={{ padding: 6 }}>Origin</th>
                    <th style={{ padding: 6 }}>Extraction</th>
                    <th style={{ padding: 6 }}>Rows</th>
                    <th style={{ padding: 6 }}>Mapping</th>
                    <th style={{ padding: 6 }}>Completeness</th>
                    <th style={{ padding: 6 }}>Frozen</th>
                    <th style={{ padding: 6 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {(versionsBySource[source.source_id] ?? []).map((v) => (
                    <tr key={v.version_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: 6 }}>{v.version_number}</td>
                      <td style={{ padding: 6 }}>{v.origin_type}</td>
                      <td style={{ padding: 6 }}>{v.extraction_status}</td>
                      <td style={{ padding: 6 }}>{v.parsed_row_count ?? "—"}/{v.raw_row_count ?? "—"} ({v.exception_count ?? 0} exc)</td>
                      <td style={{ padding: 6 }}>{v.mapping_status}</td>
                      <td style={{ padding: 6 }}>{v.completeness_status}</td>
                      <td style={{ padding: 6 }}>{v.frozen ? "✓" : "—"}</td>
                      <td style={{ padding: 6 }}>
                        <button onClick={() => openVersion(v.version_id)} style={{ fontSize: 11, background: "none", border: "1px solid #cbd5e1", borderRadius: 4, padding: "3px 8px", cursor: "pointer" }}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}

      {selectedVersionId && preview && (
        <div style={{ border: "2px solid #1a73e8", borderRadius: 8, padding: 16, marginTop: 16 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Mapping Preview &amp; Approval — version {selectedVersionId.slice(0, 8)}</h4>

          {rawRowsPreview?.supported && (
            <div style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: 10, marginBottom: 12, background: "#fffbeb" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ fontSize: 11.5 }}>
                  Header row #
                  <input type="number" min={1} value={headerRowNumber} onChange={(e) => setHeaderRowNumber(e.target.value)} style={{ display: "block", width: 70, padding: "4px 6px", fontSize: 11, border: "1px solid #cbd5e1", borderRadius: 4 }} />
                </label>
                <label style={{ fontSize: 11.5 }}>
                  First data row # (optional — default header+1)
                  <input type="number" min={1} value={dataStartRowNumber} onChange={(e) => setDataStartRowNumber(e.target.value)} placeholder="auto" style={{ display: "block", width: 70, padding: "4px 6px", fontSize: 11, border: "1px solid #cbd5e1", borderRadius: 4 }} />
                </label>
                <button onClick={() => setShowRawRows((v) => !v)} style={{ fontSize: 11, background: "none", border: "1px solid #cbd5e1", borderRadius: 4, padding: "5px 10px", cursor: "pointer" }}>
                  {showRawRows ? "Hide" : "Show"} raw rows (no header assumed)
                </button>
              </div>
              {showRawRows && (
                <div style={{ marginTop: 8, maxHeight: 180, overflowY: "auto", fontSize: 10.5, fontFamily: "monospace" }}>
                  {rawRowsPreview.rows.map((r: any) => (
                    <div key={r.physicalRow}>row {r.physicalRow}: {JSON.stringify(r.values)}</div>
                  ))}
                  <div style={{ color: "#64748b" }}>{rawRowsPreview.totalRows} total physical rows</div>
                </div>
              )}
            </div>
          )}

          {headerAmbiguity && (
            <div style={{ border: "1px solid #fca5a5", background: "#fef2f2", borderRadius: 6, padding: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", marginBottom: 4 }}>Header row is ambiguous — held for review (NEEDS_REVIEW)</div>
              <ul style={{ fontSize: 11, color: "#991b1b", margin: 0, paddingLeft: 18 }}>
                {headerAmbiguity.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
              <button onClick={() => handleApproveMapping(true)} style={{ marginTop: 8, fontSize: 11, background: "#991b1b", color: "#fff", border: "none", borderRadius: 4, padding: "5px 10px", cursor: "pointer" }}>
                Acknowledge and proceed anyway
              </button>
            </div>
          )}

          {preview.table && (
            <div style={{ overflowX: "auto", marginBottom: 12 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: "100%" }}>
                <thead>
                  <tr>{preview.table.headers.map((h: string) => <th key={h} style={{ border: "1px solid #e2e8f0", padding: 4, background: "#f8fafc" }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.table.sampleRows.map((r: any, i: number) => (
                    <tr key={i}>{preview.table.headers.map((h: string) => <td key={h} style={{ border: "1px solid #f1f5f9", padding: 4 }}>{r.values[h] ?? ""}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{preview.table.totalRows} total rows (showing up to 20)</div>
            </div>
          )}

          {preview.pdfPages && (
            <div style={{ marginBottom: 12, maxHeight: 200, overflowY: "auto", fontSize: 11, background: "#f8fafc", padding: 8, borderRadius: 4 }}>
              {preview.pdfPages.map((p: any) => (
                <div key={p.pageNumber} style={{ marginBottom: 6 }}>
                  <strong>Page {p.pageNumber} ({p.status})</strong>: {p.textPreview || "(no extractable text)"}
                </div>
              ))}
            </div>
          )}

          {preview.table && (
            <>
              <h5 style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Field Mapping — raw column → normalized field</h5>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
                {NORMALIZED_FIELD_KEYS.map((key) => (
                  <label key={key} style={{ fontSize: 11 }}>
                    {key}
                    <select
                      value={fieldMap[key] ?? ""}
                      onChange={(e) => setFieldMap((prev) => ({ ...prev, [key]: e.target.value }))}
                      style={{ display: "block", width: "100%", marginTop: 2, padding: "4px 6px", fontSize: 11, border: "1px solid #cbd5e1", borderRadius: 4 }}
                    >
                      <option value="">— unmapped —</option>
                      {preview.table.headers.map((h: string) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <button onClick={() => handleApproveMapping(false)} style={{ background: "#1a73e8", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 16 }}>
                Approve Mapping
              </button>
            </>
          )}

          <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 12, marginBottom: 12 }}>
            <h5 style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Completeness Control (optional — leave blank if not available)</h5>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <input placeholder="Opening balance" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} style={{ padding: "5px 8px", fontSize: 12, border: "1px solid #cbd5e1", borderRadius: 4, width: 140 }} />
              <input placeholder="Closing balance" value={closingBalance} onChange={(e) => setClosingBalance(e.target.value)} style={{ padding: "5px 8px", fontSize: 12, border: "1px solid #cbd5e1", borderRadius: 4, width: 140 }} />
              <button onClick={handleComputeCompleteness} style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: 4, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Compute</button>
            </div>
            {completenessResult && (
              <div style={{ fontSize: 11.5, background: "#f8fafc", padding: 8, borderRadius: 4 }}>
                Status: <strong>{completenessResult.status}</strong> · debit movement {completenessResult.debit_movement} · credit movement {completenessResult.credit_movement}
                {completenessResult.discrepancy !== null && ` · discrepancy ${completenessResult.discrepancy}`}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleFreeze} style={{ background: "#b91c1c", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Freeze Snapshot</button>
            <button onClick={handleViewRows} style={{ background: "none", border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>View Normalized Rows (Evidence)</button>
          </div>

          {rows.length > 0 && (
            <div style={{ marginTop: 12, maxHeight: 240, overflowY: "auto", fontSize: 11 }}>
              {rows.map((r) => (
                <div key={r.row_id} style={{ borderBottom: "1px solid #f1f5f9", padding: "4px 0" }}>
                  <strong>{r.evidence_locator}</strong> — {JSON.stringify(r.normalized)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// LineMappingPanel — Manual SO↔PO Line Mapping UI (Phase 2)
//
// Embedded in the Approval Pending expanded evidence panel for
// PO lines with ITEM_MAPPING_REQUIRED or AMBIGUOUS_REFERENCE_LINE.
//
// Phase 2 = management UI only. Does NOT change verification
// result classification or automatic mapping precedence.
//
// ZOHO WRITE = 0. All operations are local SQLite via API routes.
// ============================================================

"use client";
import React, { useState, useEffect, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────

interface MappingRecord {
  mapping_id: string;
  organization_id: string;
  salesorder_id: string;
  so_line_item_id: string;
  purchaseorder_id: string;
  po_line_item_id: string;
  mapping_kind: string;
  status: string;
  so_fingerprint: string;
  po_fingerprint: string;
  decision_source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  review_required_at: string | null;
  revoked_at: string | null;
}

interface CandidateLine {
  lineItemId: string;
  displayLineNumber: number;
  itemId: string;
  itemName: string;
  description: string;
  sku: string | null;
  quantity: number;
  rate: number;
  amount: number;
  unit: string | null;
}

interface HistoryRecord {
  history_id: string;
  mapping_id: string;
  event_type: string;
  previous_status: string | null;
  new_status: string;
  occurred_at: string;
  note: string | null;
}

interface LineMappingPanelProps {
  sourceLineId: string;
  purchaseorderId: string;
  itemName: string;
  mismatchType: string;
}

const formatMoney = (val?: number | null) => {
  if (val === null || val === undefined) return "—";
  return "₹" + val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ── Main Panel Component ───────────────────────────────────

export function LineMappingPanel({
  sourceLineId,
  purchaseorderId,
  itemName,
  mismatchType,
}: LineMappingPanelProps) {
  const [mapping, setMapping] = useState<MappingRecord | null>(null);
  const [staleness, setStaleness] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchMapping = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        purchaseorderId,
        poLineItemId: sourceLineId,
      });
      const res = await fetch(`/api/audit/manual-line-mapping?${params}`);
      if (!res.ok) throw new Error("Failed to fetch mapping");
      const data = await res.json();
      setMapping(data.mapping || null);
      setStaleness(data.staleness || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [purchaseorderId, sourceLineId]);

  useEffect(() => {
    fetchMapping();
  }, [fetchMapping]);

  async function fetchHistory() {
    if (!mapping) return;
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({
        orgId: mapping.organization_id,
        purchaseorderId,
        poLineItemId: sourceLineId,
      });
      const res = await fetch(`/api/audit/manual-line-mapping/history?${params}`);
      if (!res.ok) throw new Error("Failed to fetch history");
      const data = await res.json();
      setHistory(data.history || []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleRevoke() {
    if (!mapping || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/audit/manual-line-mapping/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappingId: mapping.mapping_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Revoke failed");
      await fetchMapping();
    } catch (err: any) {
      alert(err.message || "Failed to revoke mapping");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReconfirm() {
    if (!mapping || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/audit/manual-line-mapping/reconfirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappingId: mapping.mapping_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reconfirm failed");
      await fetchMapping();
    } catch (err: any) {
      alert(err.message || "Failed to reconfirm mapping");
    } finally {
      setActionLoading(false);
    }
  }

  function handleMappingCreated() {
    setShowCandidates(false);
    fetchMapping();
  }

  if (loading) {
    return (
      <div style={{ marginTop: "16px", padding: "12px", background: "rgba(37, 99, 235, 0.04)", border: "1px solid rgba(37, 99, 235, 0.15)", borderRadius: "6px" }}>
        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Loading mapping status...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ marginTop: "16px", padding: "12px", background: "rgba(239, 68, 68, 0.04)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "6px" }}>
        <span style={{ fontSize: "12px", color: "var(--google-red)" }}>Mapping error: {error}</span>
      </div>
    );
  }

  return (
    <>
      <div style={{ marginTop: "16px", padding: "14px", background: "rgba(37, 99, 235, 0.04)", border: "1px solid rgba(37, 99, 235, 0.15)", borderRadius: "6px" }}>
        <h6 style={{ fontSize: "12px", color: "#1d4ed8", marginTop: 0, marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Manual Line Mapping
        </h6>

        {!mapping ? (
          /* ── No Current Mapping ─────────────────────── */
          <div>
            <p style={{ margin: "0 0 10px", fontSize: "13px", color: "var(--text-secondary)" }}>
              No manual mapping exists for this PO line.
              {mismatchType === "AMBIGUOUS_REFERENCE_LINE"
                ? " Multiple SO lines share the same item — manual mapping required to resolve ambiguity."
                : " No matching SO line found by item ID — manual mapping allows explicit assignment."}
            </p>
            <button
              onClick={() => setShowCandidates(true)}
              disabled={actionLoading}
              style={{
                padding: "6px 14px",
                fontSize: "12px",
                fontWeight: 600,
                background: "#2563eb",
                color: "#ffffff",
                border: "1px solid #1d4ed8",
                borderRadius: "4px",
                cursor: actionLoading ? "not-allowed" : "pointer",
                opacity: actionLoading ? 0.6 : 1,
              }}
            >
              Map to SO Line
            </button>
          </div>
        ) : (
          /* ── Existing Mapping ───────────────────────── */
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px", fontSize: "13px" }}>
              <div><span style={{ color: "var(--text-secondary)" }}>Mapping ID:</span> <span style={{ fontFamily: "monospace", fontSize: "11px" }}>{mapping.mapping_id.substring(0, 8)}...</span></div>
              <div><span style={{ color: "var(--text-secondary)" }}>Kind:</span> <strong>{mapping.mapping_kind.replace("_", " ")}</strong></div>
              <div><span style={{ color: "var(--text-secondary)" }}>SO Line:</span> <span style={{ fontFamily: "monospace", fontSize: "11px" }}>{mapping.so_line_item_id.substring(0, 12)}...</span></div>
              <div>
                <span style={{ color: "var(--text-secondary)" }}>Status:</span>{" "}
                <span
                  className={`badge-semantic ${mapping.status === "ACTIVE" ? "success" : mapping.status === "REVIEW_REQUIRED" ? "warning" : "neutral"}`}
                  style={{ fontSize: "11px" }}
                >
                  {mapping.status.replace("_", " ")}
                </span>
              </div>
              <div><span style={{ color: "var(--text-secondary)" }}>Created:</span> {new Date(mapping.created_at).toLocaleString("en-IN")}</div>
              <div><span style={{ color: "var(--text-secondary)" }}>Updated:</span> {new Date(mapping.updated_at).toLocaleString("en-IN")}</div>
              {mapping.notes && (
                <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "var(--text-secondary)" }}>Notes:</span> {mapping.notes}</div>
              )}
            </div>

            {/* Staleness indicator */}
            {staleness && (
              <div style={{ marginBottom: "12px", fontSize: "12px" }}>
                <span style={{ color: "var(--text-secondary)" }}>Fingerprint Check: </span>
                <span
                  style={{
                    fontWeight: 600,
                    color: staleness === "VALID" ? "#047857" : staleness === "REVIEW_REQUIRED" ? "#b45309" : "var(--google-red)",
                  }}
                >
                  {staleness === "VALID" ? "VALID — fingerprints match current line data" : staleness === "REVIEW_REQUIRED" ? "REVIEW REQUIRED — line data has changed since mapping was created" : "MISSING LINE — one or both lines no longer exist in local data"}
                </span>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {mapping.status === "REVIEW_REQUIRED" && (
                <button
                  onClick={handleReconfirm}
                  disabled={actionLoading}
                  style={{
                    padding: "5px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    background: "#047857",
                    color: "#ffffff",
                    border: "1px solid #065f46",
                    borderRadius: "4px",
                    cursor: actionLoading ? "not-allowed" : "pointer",
                    opacity: actionLoading ? 0.6 : 1,
                  }}
                >
                  {actionLoading ? "Processing..." : "Reconfirm Mapping"}
                </button>
              )}
              {mapping.status !== "REVOKED" && (
                <button
                  onClick={handleRevoke}
                  disabled={actionLoading}
                  style={{
                    padding: "5px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    background: "var(--bg-primary)",
                    color: "var(--google-red)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    borderRadius: "4px",
                    cursor: actionLoading ? "not-allowed" : "pointer",
                    opacity: actionLoading ? 0.6 : 1,
                  }}
                >
                  {actionLoading ? "Processing..." : "Revoke Mapping"}
                </button>
              )}
              {mapping.status === "REVOKED" && (
                <button
                  onClick={() => setShowCandidates(true)}
                  disabled={actionLoading}
                  style={{
                    padding: "5px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    background: "#2563eb",
                    color: "#ffffff",
                    border: "1px solid #1d4ed8",
                    borderRadius: "4px",
                    cursor: actionLoading ? "not-allowed" : "pointer",
                    opacity: actionLoading ? 0.6 : 1,
                  }}
                >
                  Create New Mapping
                </button>
              )}
              <button
                onClick={() => {
                  setShowHistory(!showHistory);
                  if (!showHistory && history.length === 0) fetchHistory();
                }}
                style={{
                  padding: "5px 12px",
                  fontSize: "12px",
                  background: "var(--bg-primary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                {showHistory ? "Hide History" : "Show History"}
              </button>
            </div>

            {/* History panel */}
            {showHistory && (
              <div style={{ marginTop: "12px" }}>
                {historyLoading ? (
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Loading history...</p>
                ) : history.length === 0 ? (
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>No history records found.</p>
                ) : (
                  <table className="data-table" style={{ width: "100%", fontSize: "12px" }}>
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Previous</th>
                        <th>New</th>
                        <th>Time</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr key={h.history_id}>
                          <td>{h.event_type.replace(/MAPPING_/g, "").replace(/_/g, " ")}</td>
                          <td>{h.previous_status ? h.previous_status.replace(/_/g, " ") : "—"}</td>
                          <td>{h.new_status.replace(/_/g, " ")}</td>
                          <td>{new Date(h.occurred_at).toLocaleString("en-IN")}</td>
                          <td style={{ color: "var(--text-secondary)" }}>{h.note || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Candidate selection modal */}
      {showCandidates && (
        <MappingCandidateModal
          purchaseorderId={purchaseorderId}
          poLineItemId={sourceLineId}
          poItemName={itemName}
          onClose={() => setShowCandidates(false)}
          onMappingCreated={handleMappingCreated}
        />
      )}
    </>
  );
}

// ── Candidate Selection Modal ──────────────────────────────

function MappingCandidateModal({
  purchaseorderId,
  poLineItemId,
  poItemName,
  onClose,
  onMappingCreated,
}: {
  purchaseorderId: string;
  poLineItemId: string;
  poItemName: string;
  onClose: () => void;
  onMappingCreated: () => void;
}) {
  const [candidates, setCandidates] = useState<CandidateLine[]>([]);
  const [salesorderId, setSalesorderId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [salesorderNumber, setSalesorderNumber] = useState<string | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [mappingKind, setMappingKind] = useState<string>("OWNER_FALLBACK");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    async function loadCandidates() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ purchaseorderId });
        const res = await fetch(`/api/audit/manual-line-mapping/candidates?${params}`);
        if (!res.ok) throw new Error("Failed to fetch candidates");
        const data = await res.json();
        setCandidates(data.candidates || []);
        setSalesorderId(data.salesorderId || null);
        setOrganizationId(data.organizationId || null);
        setSalesorderNumber(data.salesorderNumber || null);
        setResolution(data.resolution || null);
      } catch {
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    }
    loadCandidates();
  }, [purchaseorderId]);

  async function handleCreate() {
    if (!selectedLineId || !salesorderId || !organizationId || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/audit/manual-line-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: organizationId,
          salesorderId,
          soLineItemId: selectedLineId,
          purchaseorderId,
          poLineItemId,
          mappingKind,
          notes: notes.trim() || null,
          decisionSource: "OWNER_UI",
        }),
      });
      const data = await res.json();
      if (data.outcome === "CREATED" || data.outcome === "DUPLICATE") {
        onMappingCreated();
      } else if (data.outcome === "CONFLICT") {
        alert("Conflict: This PO line already has an active mapping to a different SO line. Revoke the existing mapping first.");
      } else if (data.outcome === "VALIDATION_FAILED") {
        alert(`Validation failed: ${data.reason}`);
      } else if (data.error) {
        alert(`Error: ${data.error}`);
      }
    } catch (err: any) {
      alert(err.message || "Failed to create mapping");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        backgroundColor: "rgba(15, 23, 42, 0.5)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "60px",
        backdropFilter: "blur(2px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(95%, 900px)",
          maxHeight: "80vh",
          backgroundColor: "#f8fafc",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.2)",
          borderRadius: "12px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "16px 24px", background: "white", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 10, borderRadius: "12px 12px 0 0" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>Map PO Line to SO Line</h3>
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>
              PO Line: <strong>{poItemName}</strong> &mdash; Select the corresponding SO line below
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "24px", cursor: "pointer", color: "#64748b" }}>&times;</button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px" }}>
          {loading ? (
            <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Loading candidate SO lines...</p>
          ) : resolution !== "MATCH" ? (
            <div style={{ padding: "16px", background: "rgba(239, 68, 68, 0.06)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "6px" }}>
              <p style={{ margin: 0, fontSize: "13px" }}>
                Cannot load SO line candidates. SO resolution status: <strong>{resolution || "UNKNOWN"}</strong>
              </p>
              <p style={{ margin: "8px 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>
                The purchase order must have a valid, unique Sales Order reference to enable manual line mapping.
              </p>
            </div>
          ) : candidates.length === 0 ? (
            <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No SO lines found for SO {salesorderNumber}.</p>
          ) : (
            <>
              <p style={{ margin: "0 0 12px", fontSize: "13px" }}>
                Sales Order: <strong>{salesorderNumber}</strong> &mdash; {candidates.length} line{candidates.length !== 1 ? "s" : ""} available
              </p>

              <div style={{ overflowX: "auto", marginBottom: "16px" }}>
                <table className="data-table" style={{ width: "100%", fontSize: "12px" }}>
                  <thead>
                    <tr>
                      <th style={{ width: "40px" }}></th>
                      <th>Line</th>
                      <th>Item Name</th>
                      <th>Description</th>
                      <th className="right">Qty</th>
                      <th className="right">Rate</th>
                      <th className="right">Amount</th>
                      <th>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => {
                      const isSelected = selectedLineId === c.lineItemId;
                      return (
                        <tr
                          key={c.lineItemId}
                          className="clickable"
                          onClick={() => setSelectedLineId(c.lineItemId)}
                          style={{ backgroundColor: isSelected ? "rgba(37, 99, 235, 0.08)" : "inherit" }}
                        >
                          <td style={{ textAlign: "center" }}>
                            <input
                              type="radio"
                              name="soLineSelect"
                              checked={isSelected}
                              onChange={() => setSelectedLineId(c.lineItemId)}
                              style={{ cursor: "pointer" }}
                            />
                          </td>
                          <td>{c.displayLineNumber}</td>
                          <td style={{ whiteSpace: "normal", minWidth: "120px", maxWidth: "180px" }}>{c.itemName}</td>
                          <td style={{ whiteSpace: "normal", minWidth: "100px", maxWidth: "180px", color: "var(--text-secondary)" }}>{c.description || "—"}</td>
                          <td className="right">{c.quantity}</td>
                          <td className="right">{formatMoney(c.rate)}</td>
                          <td className="right">{formatMoney(c.amount)}</td>
                          <td>{c.unit || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mapping options */}
              <div style={{ display: "flex", gap: "16px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "16px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px", textTransform: "uppercase" }}>Mapping Kind</label>
                  <select
                    value={mappingKind}
                    onChange={(e) => setMappingKind(e.target.value)}
                    className="audit-select"
                    style={{ fontSize: "12px", padding: "4px 8px" }}
                  >
                    <option value="OWNER_FALLBACK">Owner Fallback (no auto-match existed)</option>
                    <option value="OWNER_OVERRIDE">Owner Override (overriding auto-match)</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: "200px" }}>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px", textTransform: "uppercase" }}>Notes (optional)</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Reason for manual mapping..."
                    className="audit-input"
                    style={{ width: "100%", fontSize: "12px", padding: "4px 8px" }}
                  />
                </div>
              </div>

              {/* Confirm button */}
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button
                  onClick={onClose}
                  style={{
                    padding: "6px 16px",
                    fontSize: "12px",
                    background: "var(--bg-primary)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!selectedLineId || creating}
                  style={{
                    padding: "6px 16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    background: selectedLineId && !creating ? "#047857" : "var(--bg-secondary)",
                    color: selectedLineId && !creating ? "#ffffff" : "var(--text-secondary)",
                    border: selectedLineId && !creating ? "1px solid #065f46" : "1px solid var(--border)",
                    borderRadius: "4px",
                    cursor: selectedLineId && !creating ? "pointer" : "not-allowed",
                  }}
                >
                  {creating ? "Creating Mapping..." : "Confirm Mapping"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

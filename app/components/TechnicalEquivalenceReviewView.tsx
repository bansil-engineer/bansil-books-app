"use client";

// ============================================================
// Phase 4E-UI: Technical Equivalence Review View
//
// Read-only Owner review UI for Phase 4E technical equivalence.
// Shows BOQ requirements, candidate evidence, attribute comparison,
// and technical status — side-by-side.
//
// Safety:
//   - Display only — no DB mutation, no external writes, no external AI
//   - Technical status shown as system result, never Owner approval
//   - Future costing phases not displayed
//   - No automatic selection of candidates by rate
//   - External write count: 0
// ============================================================

import React, { useState, useMemo, useCallback } from "react";
import "./TechnicalEquivalenceReviewView.css";

import type { BoqItem } from "@/app/lib/ai/estimation/types";
import type { RateEvidenceRecord, BoqLineRateInput } from "@/app/lib/ai/estimation/rate-types";
import type {
  TechnicalEquivalenceStatus,
  TechnicalEquivalenceResult,
  TechnicalDimensionResult,
  TechnicalDimensionName,
  DimensionStatus,
  BoqLineTechnicalEquivalenceResult,
} from "@/app/lib/ai/estimation/technical-equivalence-types";

// ==================== STATUS DISPLAY HELPERS ====================

const STATUS_LABELS: Record<TechnicalEquivalenceStatus, string> = {
  TECHNICALLY_EQUIVALENT: "Technical Match Supported",
  TECHNICALLY_CONFLICT: "Technical Conflict",
  INSUFFICIENT_EVIDENCE: "Insufficient Evidence",
  UOM_INCOMPATIBLE: "UOM Incompatible",
  MAKE_CONFLICT: "Make / Manufacturer Conflict",
  SPEC_CONFLICT: "Specification Conflict",
};

const STATUS_CSS: Record<TechnicalEquivalenceStatus, string> = {
  TECHNICALLY_EQUIVALENT: "match",
  TECHNICALLY_CONFLICT: "conflict",
  INSUFFICIENT_EVIDENCE: "insufficient",
  UOM_INCOMPATIBLE: "conflict",
  MAKE_CONFLICT: "conflict",
  SPEC_CONFLICT: "conflict",
};

const DIMENSION_LABELS: Record<TechnicalDimensionName, string> = {
  SPEC: "Specification",
  UOM: "Unit of Measurement",
  MAKE: "Make / Manufacturer",
  GRADE: "Grade / Class",
  STANDARD: "Standard Reference",
};

const DIMENSION_STATUS_LABELS: Record<DimensionStatus, string> = {
  MATCH: "Match",
  CONFLICT: "Conflict",
  UNKNOWN: "Missing Evidence",
};

function isConflictStatus(status: TechnicalEquivalenceStatus): boolean {
  return status === "TECHNICALLY_CONFLICT"
    || status === "UOM_INCOMPATIBLE"
    || status === "MAKE_CONFLICT"
    || status === "SPEC_CONFLICT";
}

function needsOwnerReview(status: TechnicalEquivalenceStatus): boolean {
  return status !== "TECHNICALLY_EQUIVALENT";
}

function formatRate(rate: number | null, currency = "INR"): string {
  if (rate === null || rate === undefined) return "Not available";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(rate);
  } catch {
    return `${currency} ${rate.toFixed(2)}`;
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Not available";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

// ==================== SUB-COMPONENTS ====================

/** Status badge with dot indicator */
function TechnicalStatusBadge({ status }: { status: TechnicalEquivalenceStatus }) {
  const cssClass = STATUS_CSS[status] ?? "unknown";
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={`te-status-badge ${cssClass}`}>
      <span className="te-status-dot" />
      {label}
    </span>
  );
}

/** Dimension status badge (smaller, inline) */
function DimensionStatusBadge({ status }: { status: DimensionStatus }) {
  const css = status === "MATCH" ? "match" : status === "CONFLICT" ? "conflict" : "insufficient";
  return (
    <span className={`te-status-badge ${css}`} style={{ fontSize: 11, padding: "2px 8px" }}>
      {DIMENSION_STATUS_LABELS[status]}
    </span>
  );
}

/** Review state indicator */
function ReviewStateIndicator({ status }: { status: TechnicalEquivalenceStatus }) {
  if (needsOwnerReview(status)) {
    return (
      <span className="te-review-state needs-review">
        Owner review required
      </span>
    );
  }
  return (
    <span className="te-review-state system-result">
      System technical result
    </span>
  );
}

/** Attribute comparison table for one equivalence result */
function AttributeComparisonTable({ dimensions }: { dimensions: TechnicalDimensionResult[] }) {
  if (!dimensions || dimensions.length === 0) {
    return (
      <div className="te-empty-state">
        <div className="te-empty-title">No comparison available</div>
        <div className="te-empty-desc">Missing specification evidence</div>
      </div>
    );
  }

  return (
    <table className="te-attr-table">
      <thead>
        <tr>
          <th>Attribute</th>
          <th>BOQ Requirement</th>
          <th>Candidate</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {dimensions.map((dim) => (
          <tr key={dim.dimension}>
            <td className="te-dim-name">{DIMENSION_LABELS[dim.dimension] ?? dim.dimension}</td>
            <td>
              {dim.boqValue ? (
                <span>{dim.boqValue}</span>
              ) : (
                <span className="te-val-missing">Not specified</span>
              )}
            </td>
            <td>
              {dim.evidenceValue ? (
                <span className={dim.status === "CONFLICT" ? "te-val-conflict" : ""}>
                  {dim.evidenceValue}
                </span>
              ) : (
                <span className="te-val-missing">Missing evidence</span>
              )}
            </td>
            <td>
              <DimensionStatusBadge status={dim.status} />
              {dim.conflictNote && (
                <div className="te-conflict-note">{dim.conflictNote}</div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Side-by-side BOQ + Candidate detail panels */
function DetailPanels({
  boqLine,
  evidence,
}: {
  boqLine: BoqLineRateInput;
  evidence: RateEvidenceRecord;
}) {
  return (
    <div className="te-detail-grid">
      {/* BOQ Requirement Panel */}
      <div className="te-detail-panel">
        <h4>BOQ Requirement</h4>
        <div className="te-detail-row">
          <span className="te-detail-label">Line ID</span>
          <span className="te-detail-value">{boqLine.boq_line_id}</span>
        </div>
        <div className="te-detail-row">
          <span className="te-detail-label">Description</span>
          <span className="te-detail-value">{boqLine.description || <i className="te-val-missing">Not specified</i>}</span>
        </div>
        <div className="te-detail-row">
          <span className="te-detail-label">UOM</span>
          <span className={`te-detail-value ${!boqLine.uom ? "missing" : ""}`}>
            {boqLine.uom ?? "Not specified"}
          </span>
        </div>
        {boqLine.item_code && (
          <div className="te-detail-row">
            <span className="te-detail-label">Item Code</span>
            <span className="te-detail-value">{boqLine.item_code}</span>
          </div>
        )}
      </div>

      {/* Candidate Evidence Panel */}
      <div className="te-detail-panel">
        <h4>Candidate Evidence</h4>
        <div className="te-detail-row">
          <span className="te-detail-label">Source</span>
          <span className="te-detail-value">
            {evidence.vendor_name ?? evidence.source_type ?? <i className="te-val-missing">Unknown</i>}
          </span>
        </div>
        <div className="te-detail-row">
          <span className="te-detail-label">Description</span>
          <span className="te-detail-value">
            {evidence.description ?? evidence.item_name ?? <i className="te-val-missing">Not specified</i>}
          </span>
        </div>
        <div className="te-detail-row">
          <span className="te-detail-label">UOM</span>
          <span className={`te-detail-value ${!evidence.uom ? "missing" : ""}`}>
            {evidence.uom ?? "Not specified"}
          </span>
        </div>
        <div className="te-detail-row">
          <span className="te-detail-label">Rate</span>
          <span className="te-detail-value">{formatRate(evidence.rate, evidence.currency)}</span>
        </div>
        <div className="te-detail-row">
          <span className="te-detail-label">Date</span>
          <span className={`te-detail-value ${!evidence.source_date ? "missing" : ""}`}>
            {formatDate(evidence.source_date)}
          </span>
        </div>
        <div className="te-detail-row">
          <span className="te-detail-label">Make</span>
          <span className={`te-detail-value ${!evidence.item_name ? "missing" : ""}`}>
            {extractMakeFromDescription(evidence.description) ?? "Not specified"}
          </span>
        </div>
        <div className="te-detail-row">
          <span className="te-detail-label">Verification</span>
          <span className="te-detail-value">
            {evidence.verification_status?.replace(/_/g, " ") ?? "Unknown"}
          </span>
        </div>
        {evidence.source_document && (
          <div className="te-detail-row">
            <span className="te-detail-label">Document</span>
            <span className="te-detail-value">{evidence.source_document}</span>
          </div>
        )}
        {evidence.provenance && (
          <div className="te-detail-row">
            <span className="te-detail-label">Provenance</span>
            <span className="te-detail-value">
              {evidence.provenance.sourceSystem.replace(/_/g, " ")} — {evidence.provenance.table}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Simple make extraction for display (reuses brand keywords concept) */
function extractMakeFromDescription(desc: string | null | undefined): string | null {
  if (!desc) return null;
  const brands = [
    "HAVELLS", "ANCHOR", "POLYCAB", "FINOLEX", "KEI",
    "SIEMENS", "ABB", "SCHNEIDER", "LEGRAND", "L&T",
    "CROMPTON", "BAJAJ", "PHILIPS", "ORIENT", "WIPRO",
    "HPL", "INDO ASIAN", "C&S", "GE", "EATON",
    "LARSEN", "TOUBRO", "RR KABEL", "GLOSTER", "UNIVERSAL",
  ];
  const upper = desc.toUpperCase();
  for (const b of brands) {
    if (upper.includes(b)) return b;
  }
  return null;
}


// ==================== MAIN COMPONENT ====================

interface TechnicalEquivalenceReviewViewProps {
  /** BOQ lines for technical equivalence review. Empty array or omit when no data available. */
  boqLines?: BoqLineRateInput[];
  /** Rate evidence records to compare against BOQ. Empty array or omit when no data available. */
  evidenceRecords?: RateEvidenceRecord[];
}

export function TechnicalEquivalenceReviewView({
  boqLines: externalBoqLines,
  evidenceRecords: externalEvidence,
}: TechnicalEquivalenceReviewViewProps) {
  // Data — truthful: use provided data or empty arrays, never fabricated fallback
  const boqLines = externalBoqLines ?? [];
  const allEvidence = externalEvidence ?? [];

  // State
  const [selectedBoqId, setSelectedBoqId] = useState<string | null>(null);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [boqSearch, setBoqSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [results, setResults] = useState<Map<string, TechnicalEquivalenceResult>>(new Map());
  const [batchResults, setBatchResults] = useState<Map<string, BoqLineTechnicalEquivalenceResult>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engineVersion, setEngineVersion] = useState<string>("");

  // Filtered BOQ lines
  const filteredBoqLines = useMemo(() => {
    const term = boqSearch.toLowerCase().trim();
    return boqLines.filter((b) => {
      if (term && !b.description.toLowerCase().includes(term) && !b.boq_line_id.toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
  }, [boqLines, boqSearch]);

  // Run batch assessment for selected BOQ line
  const runBatchAssessment = useCallback(async (boqLine: BoqLineRateInput) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/estimation/technical-equivalence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "batch",
          boqLine,
          evidenceRecords: allEvidence,
        }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error(errBody.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setEngineVersion(data.engineVersion ?? "");

      // Store batch result
      setBatchResults((prev) => new Map(prev).set(boqLine.boq_line_id, data.result));

      // Also run individual assessments for detail view
      const newResults = new Map(results);
      for (const ev of allEvidence) {
        try {
          const singleResp = await fetch("/api/ai/estimation/technical-equivalence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "single", boqLine, evidence: ev }),
          });
          if (singleResp.ok) {
            const singleData = await singleResp.json();
            newResults.set(`${boqLine.boq_line_id}:${ev.rate_evidence_id}`, singleData.result);
          }
        } catch {
          // Individual failures don't block the batch
        }
      }
      setResults(newResults);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Assessment failed");
    } finally {
      setLoading(false);
    }
  }, [allEvidence, results]);

  // Select a BOQ line
  const selectBoqLine = useCallback((lineId: string) => {
    setSelectedBoqId(lineId);
    setSelectedEvidenceId(null);
    const line = boqLines.find((b) => b.boq_line_id === lineId);
    if (line) {
      runBatchAssessment(line);
    }
  }, [boqLines, runBatchAssessment]);

  // Current selections
  const selectedBoq = boqLines.find((b) => b.boq_line_id === selectedBoqId) ?? null;
  const selectedEvidence = allEvidence.find((e) => e.rate_evidence_id === selectedEvidenceId) ?? null;
  const currentBatch = selectedBoqId ? batchResults.get(selectedBoqId) ?? null : null;
  const currentResult = selectedBoqId && selectedEvidenceId
    ? results.get(`${selectedBoqId}:${selectedEvidenceId}`) ?? null
    : null;

  // Summary stats for current batch
  const summaryStats = useMemo(() => {
    if (!currentBatch) return { equivalent: 0, conflict: 0, insufficient: 0, total: 0 };
    return {
      equivalent: currentBatch.equivalent_evidence_ids.length,
      conflict: currentBatch.conflict_evidence.length,
      insufficient: currentBatch.insufficient_evidence.length,
      total: currentBatch.comparison_count,
    };
  }, [currentBatch]);

  // Evidence for current BOQ, filtered by status
  const filteredEvidence = useMemo(() => {
    if (!currentBatch) return allEvidence;
    return allEvidence.filter((ev) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "match") return currentBatch.equivalent_evidence_ids.includes(ev.rate_evidence_id);
      if (statusFilter === "conflict") return currentBatch.conflict_evidence.some((c) => c.rate_evidence_id === ev.rate_evidence_id);
      if (statusFilter === "insufficient") return currentBatch.insufficient_evidence.some((i) => i.rate_evidence_id === ev.rate_evidence_id);
      return true;
    });
  }, [allEvidence, currentBatch, statusFilter]);

  // Get status for an evidence record
  const getEvidenceStatus = (evId: string): TechnicalEquivalenceStatus | null => {
    if (!currentBatch) return null;
    if (currentBatch.equivalent_evidence_ids.includes(evId)) return "TECHNICALLY_EQUIVALENT";
    const conflict = currentBatch.conflict_evidence.find((c) => c.rate_evidence_id === evId);
    if (conflict) return conflict.status;
    if (currentBatch.insufficient_evidence.some((i) => i.rate_evidence_id === evId)) return "INSUFFICIENT_EVIDENCE";
    return null;
  };

  // ---- RENDER ----
  return (
    <div className="te-review">
      {/* Header */}
      <div className="section-card">
        <div className="section-header">
          <div className="section-title-group">
            <h2 className="section-title">Technical Equivalence Review</h2>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div className="te-engine-info">
              {engineVersion && <span>Engine {engineVersion}</span>}
              <span>Deterministic</span>
            </div>
            <span className="te-safety-label">Technical assessment only</span>
            <span className="te-safety-label">Not Owner approval</span>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="te-error-state">
          <div className="te-error-title">Assessment Error</div>
          <div>{error}</div>
        </div>
      )}

      {/* Truthful empty state when no BOQ data is available */}
      {boqLines.length === 0 && allEvidence.length === 0 && (
        <div className="section-card">
          <div className="te-empty-state">
            <div className="te-empty-icon">📋</div>
            <div className="te-empty-title">No BOQ data available for technical-equivalence review</div>
            <div className="te-empty-desc">
              No estimation BOQ lines or candidate rate evidence have been loaded.
              This view will populate automatically when Phase 4D rate evidence and
              BOQ line data become available in the system.
            </div>
          </div>
        </div>
      )}

      {/* Two-column layout: BOQ selector + Results — shown only when data exists */}
      {(boqLines.length > 0 || allEvidence.length > 0) && (
      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, alignItems: "start" }}>
        {/* Left: BOQ Selector */}
        <div className="section-card">
          <div className="section-header">
            <h3 className="section-title" style={{ fontSize: 14 }}>BOQ Lines</h3>
            <span className="section-badge">{filteredBoqLines.length}</span>
          </div>
          <div className="te-boq-selector" style={{ padding: "0 16px 16px" }}>
            <input
              type="text"
              className="te-boq-search"
              placeholder="Search BOQ lines..."
              value={boqSearch}
              onChange={(e) => setBoqSearch(e.target.value)}
            />
            <div className="te-boq-list">
              {filteredBoqLines.length === 0 ? (
                <div className="te-empty-state" style={{ padding: 20 }}>
                  <div className="te-empty-title">No BOQ lines found</div>
                  <div className="te-empty-desc">
                    {boqSearch ? "Try a different search term" : "No BOQ data available"}
                  </div>
                </div>
              ) : (
                filteredBoqLines.map((line) => (
                  <button
                    key={line.boq_line_id}
                    type="button"
                    className={`te-boq-item ${selectedBoqId === line.boq_line_id ? "active" : ""}`}
                    onClick={() => selectBoqLine(line.boq_line_id)}
                  >
                    <span className="te-boq-item-line">{line.boq_line_id.replace("BOQ-", "#")}</span>
                    <span className="te-boq-item-desc">{line.description}</span>
                    <span className="te-boq-item-meta">{line.uom ?? "—"}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right: Results area */}
        <div>
          {!selectedBoq ? (
            <div className="section-card">
              <div className="te-empty-state">
                <div className="te-empty-icon">📋</div>
                <div className="te-empty-title">No BOQ selected</div>
                <div className="te-empty-desc">Select a BOQ line from the left to view its technical equivalence assessment</div>
              </div>
            </div>
          ) : loading ? (
            <div className="section-card">
              <div className="te-empty-state">
                <div className="te-empty-title">Running assessment...</div>
                <div className="te-empty-desc">Evaluating technical equivalence for {selectedBoq.description}</div>
              </div>
            </div>
          ) : (
            <>
              {/* Summary stats */}
              {currentBatch && (
                <div className="section-card">
                  <div className="section-header">
                    <h3 className="section-title" style={{ fontSize: 14 }}>
                      Assessment Summary — {selectedBoq.description}
                    </h3>
                  </div>
                  <div style={{ padding: "0 16px 16px" }}>
                    <div className="te-summary-row">
                      <div className="te-summary-stat">
                        <span className="te-stat-value">{summaryStats.total}</span>
                        <span className="te-stat-label">Comparisons</span>
                      </div>
                      <div className="te-summary-stat match">
                        <span className="te-stat-value">{summaryStats.equivalent}</span>
                        <span className="te-stat-label">Technical Match</span>
                      </div>
                      <div className="te-summary-stat conflict">
                        <span className="te-stat-value">{summaryStats.conflict}</span>
                        <span className="te-stat-label">Conflicts</span>
                      </div>
                      <div className="te-summary-stat insufficient">
                        <span className="te-stat-value">{summaryStats.insufficient}</span>
                        <span className="te-stat-label">Insufficient</span>
                      </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <span className="te-safety-label">Rate shown for evidence only</span>
                      <span className="te-safety-label" style={{ marginLeft: 8 }}>Commercial selection not performed</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Candidate comparison table */}
              <div className="section-card">
                <div className="section-header">
                  <h3 className="section-title" style={{ fontSize: 14 }}>Candidate Evidence</h3>
                  <div className="te-filters">
                    {["all", "match", "conflict", "insufficient"].map((f) => (
                      <button
                        key={f}
                        type="button"
                        className={`te-filter-chip ${statusFilter === f ? "active" : ""}`}
                        onClick={() => setStatusFilter(f)}
                      >
                        {f === "all" ? "All" : f === "match" ? "Match" : f === "conflict" ? "Conflict" : "Insufficient"}
                        {f !== "all" && currentBatch && (
                          <span style={{ marginLeft: 4 }}>
                            ({f === "match" ? summaryStats.equivalent : f === "conflict" ? summaryStats.conflict : summaryStats.insufficient})
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  {filteredEvidence.length === 0 ? (
                    <div className="te-empty-state">
                      <div className="te-empty-title">No candidate evidence available</div>
                      <div className="te-empty-desc">
                        {statusFilter !== "all" ? "No candidates match this filter" : "No comparable Phase 4D rate source"}
                      </div>
                    </div>
                  ) : (
                    <table className="te-candidates-table">
                      <thead>
                        <tr>
                          <th>Source / Vendor</th>
                          <th>Description</th>
                          <th>Technical Status</th>
                          <th>Rate</th>
                          <th>Date</th>
                          <th>UOM</th>
                          <th>Verification</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEvidence.map((ev) => {
                          const evStatus = getEvidenceStatus(ev.rate_evidence_id);
                          return (
                            <tr
                              key={ev.rate_evidence_id}
                              className={`te-candidate-row ${selectedEvidenceId === ev.rate_evidence_id ? "active" : ""}`}
                              onClick={() => setSelectedEvidenceId(ev.rate_evidence_id)}
                            >
                              <td>{ev.vendor_name ?? ev.source_type?.replace(/_/g, " ") ?? "Unknown"}</td>
                              <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {ev.description ?? ev.item_name ?? "Not specified"}
                              </td>
                              <td>{evStatus ? <TechnicalStatusBadge status={evStatus} /> : <span className="te-val-missing">Pending</span>}</td>
                              <td className="te-rate-cell">{formatRate(ev.rate, ev.currency)}</td>
                              <td>{formatDate(ev.source_date)}</td>
                              <td>{ev.uom ?? "—"}</td>
                              <td>{ev.verification_status?.replace(/_/g, " ") ?? "Unknown"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Detail drill-down for selected candidate */}
              {selectedEvidence && selectedBoq && (
                <>
                  {/* Result header */}
                  <div className="section-card">
                    <div className="section-header">
                      <div className="te-result-header" style={{ width: "100%" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <h3 className="section-title" style={{ fontSize: 14 }}>
                            Technical Result
                          </h3>
                          {currentResult && <TechnicalStatusBadge status={currentResult.status} />}
                        </div>
                        <div className="te-result-labels">
                          {currentResult && <ReviewStateIndicator status={currentResult.status} />}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Side-by-side panels */}
                  <div className="section-card" style={{ padding: 16 }}>
                    <DetailPanels boqLine={selectedBoq} evidence={selectedEvidence} />
                  </div>

                  {/* Attribute comparison */}
                  <div className="section-card">
                    <div className="section-header">
                      <h3 className="section-title" style={{ fontSize: 14 }}>Attribute Comparison</h3>
                    </div>
                    {currentResult ? (
                      <AttributeComparisonTable dimensions={currentResult.dimensions} />
                    ) : (
                      <div className="te-empty-state">
                        <div className="te-empty-title">No technical comparison available</div>
                        <div className="te-empty-desc">Missing specification evidence</div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

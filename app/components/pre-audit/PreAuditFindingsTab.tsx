"use client";

import React, { useState } from "react";
import { AuditFinding, CostOpportunity } from "../../lib/audit/audit-findings-service";

interface PreAuditFindingsTabProps {
  financialYear: string;
  findings: AuditFinding[];
  costOpportunities: CostOpportunity[];
  onReviewUpdate: (findingId: string, status: "REVIEWED" | "ISSUE_CONFIRMED" | "PENDING", note: string) => Promise<void>;
}

export function PreAuditFindingsTab({
  financialYear,
  findings,
  costOpportunities,
  onReviewUpdate,
}: PreAuditFindingsTabProps) {
  const [selectedArea, setSelectedArea] = useState<string>("");
  const [selectedPriority, setSelectedPriority] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      const prio = p.get("priority");
      if (prio) return prio;
    }
    return "";
  });
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      const f = p.get("filter") || p.get("q");
      if (f) return f;
    }
    return "";
  });
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (val) {
        url.searchParams.set("filter", val);
      } else {
        url.searchParams.delete("filter");
      }
      window.history.replaceState({}, "", url.toString());
    }
  };

  const handlePriorityChange = (val: string) => {
    setSelectedPriority(val);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (val) {
        url.searchParams.set("priority", val);
      } else {
        url.searchParams.delete("priority");
      }
      window.history.replaceState({}, "", url.toString());
    }
  };
  const [reviewNote, setReviewNote] = useState<string>("");
  const [reviewStatus, setReviewStatus] = useState<"REVIEWED" | "ISSUE_CONFIRMED" | "PENDING">("REVIEWED");
  const [submitting, setSubmitting] = useState<boolean>(false);

  const formatINR = (val: number | string | undefined | null) => {
    if (val === undefined || val === null) return "₹0.00";
    const num = typeof val === "string" ? parseFloat(val) : val;
    return isNaN(num) ? "₹0.00" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(num);
  };

  const areas = Array.from(new Set(findings.map((f) => f.area))).sort();

  const filteredFindings = findings.filter((f) => {
    if (selectedArea && f.area !== selectedArea) return false;
    if (selectedPriority && f.priority !== selectedPriority) return false;
    if (selectedStatus && f.human_review_status !== selectedStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match =
        f.title.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.account?.toLowerCase().includes(q) ||
        f.area.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const handleOpenReview = (finding: AuditFinding) => {
    setActiveReviewId(finding.finding_id);
    setReviewStatus(finding.human_review_status);
    setReviewNote(finding.resolution_note || "");
  };

  const handleSaveReview = async (findingId: string) => {
    setSubmitting(true);
    try {
      await onReviewUpdate(findingId, reviewStatus, reviewNote);
      setActiveReviewId(null);
    } catch (e) {
      console.error("Failed to update review:", e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1280px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#202124", margin: "0 0 4px 0" }}>
            Pre-Audit Findings Register — FY {financialYear}
          </h2>
          <p style={{ color: "#5f6368", fontSize: "13px", margin: 0 }}>
            Prioritized inventory of accounting anomalies, wrong entry risks, statutory red flags, and local human review tracking.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <span style={{ fontSize: "12px", background: "#fce8e6", color: "#c5221f", padding: "4px 10px", borderRadius: "12px", fontWeight: 700 }}>
            {findings.filter((f) => f.priority === "P0").length} Critical (P0)
          </span>
          <span style={{ fontSize: "12px", background: "#fef7e0", color: "#b06000", padding: "4px 10px", borderRadius: "12px", fontWeight: 700 }}>
            {findings.filter((f) => f.priority === "P1").length} High (P1)
          </span>
          <span style={{ fontSize: "12px", background: "#e8f0fe", color: "#1a73e8", padding: "4px 10px", borderRadius: "12px", fontWeight: 700 }}>
            {findings.filter((f) => f.priority === "P2").length} Medium (P2)
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e0e0e0",
          borderRadius: "8px",
          padding: "14px 18px",
          display: "flex",
          gap: "12px",
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: "20px",
        }}
      >
        <input
          type="text"
          placeholder="Search findings by title, description, or account..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          style={{
            flex: 2,
            minWidth: "240px",
            padding: "8px 12px",
            border: "1px solid #dadce0",
            borderRadius: "4px",
            fontSize: "13px",
          }}
        />

        <select
          value={selectedPriority}
          onChange={(e) => handlePriorityChange(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid #dadce0", borderRadius: "4px", fontSize: "13px" }}
        >
          <option value="">All Priorities</option>
          <option value="P0">P0 — Critical (Blocks Audit)</option>
          <option value="P1">P1 — High (Material Anomaly)</option>
          <option value="P2">P2 — Medium (Review Required)</option>
          <option value="P3">P3 — Informational</option>
        </select>

        <select
          value={selectedArea}
          onChange={(e) => setSelectedArea(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid #dadce0", borderRadius: "4px", fontSize: "13px" }}
        >
          <option value="">All Accounting Areas</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid #dadce0", borderRadius: "4px", fontSize: "13px" }}
        >
          <option value="">All Review Statuses</option>
          <option value="PENDING">Pending Human Review</option>
          <option value="REVIEWED">Reviewed by Owner / CA</option>
          <option value="ISSUE_CONFIRMED">Issue Confirmed</option>
        </select>

        {(selectedArea || selectedPriority || selectedStatus || searchQuery) && (
          <button
            onClick={() => {
              setSelectedArea("");
              setSelectedPriority("");
              setSelectedStatus("");
              setSearchQuery("");
              if (typeof window !== "undefined") {
                const url = new URL(window.location.href);
                url.searchParams.delete("filter");
                url.searchParams.delete("priority");
                window.history.replaceState({}, "", url.toString());
              }
            }}
            style={{
              background: "none",
              border: "none",
              color: "#1a73e8",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Findings List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "32px" }}>
        {filteredFindings.map((finding) => {
          const isReviewOpen = activeReviewId === finding.finding_id;

          const getPriorityBadge = (p: string) => {
            switch (p) {
              case "P0":
                return { bg: "#fce8e6", color: "#c5221f", label: "P0 — CRITICAL" };
              case "P1":
                return { bg: "#fef7e0", color: "#b06000", label: "P1 — HIGH" };
              case "P2":
                return { bg: "#e8f0fe", color: "#174ea6", label: "P2 — MEDIUM" };
              default:
                return { bg: "#f1f3f4", color: "#5f6368", label: "P3 — INFO" };
            }
          };

          const pBadge = getPriorityBadge(finding.priority);

          return (
            <div
              key={finding.finding_id}
              style={{
                background: "#fff",
                border: "1px solid #e0e0e0",
                borderLeft: `5px solid ${pBadge.color}`,
                borderRadius: "8px",
                padding: "20px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
              }}
            >
              {/* Finding Card Top */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span
                      style={{
                        background: pBadge.bg,
                        color: pBadge.color,
                        padding: "2px 8px",
                        borderRadius: "10px",
                        fontSize: "11px",
                        fontWeight: 700,
                      }}
                    >
                      {pBadge.label}
                    </span>
                    <span
                      style={{
                        background: "#f1f3f4",
                        color: "#3c4043",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "11px",
                        fontWeight: 600,
                      }}
                    >
                      {finding.area}
                    </span>
                    <span style={{ fontSize: "11px", color: "#5f6368" }}>ID: {finding.finding_id}</span>
                  </div>
                  <h3 style={{ margin: "0 0 6px 0", fontSize: "16px", fontWeight: 700, color: "#202124" }}>
                    {finding.title}
                  </h3>
                  <p style={{ margin: 0, fontSize: "13px", color: "#3c4043", lineHeight: "1.5" }}>
                    {finding.description}
                  </p>
                </div>
                {finding.amount !== undefined && (
                  <div style={{ textAlign: "right", minWidth: "140px" }}>
                    <div style={{ fontSize: "11px", color: "#5f6368", fontWeight: 600 }}>AMOUNT / EXPOSURE</div>
                    <div style={{ fontSize: "18px", fontWeight: 700, color: "#202124", marginTop: "2px" }}>
                      {formatINR(finding.amount)}
                    </div>
                  </div>
                )}
              </div>

              {/* Accounting & Tax Details Grid */}
              <div
                style={{
                  background: "#f8f9fa",
                  borderRadius: "6px",
                  padding: "14px",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "14px",
                  fontSize: "12px",
                  marginBottom: "14px",
                }}
              >
                <div>
                  <strong style={{ color: "#202124" }}>Accounting Impact:</strong>
                  <div style={{ color: "#3c4043", marginTop: "2px" }}>{finding.accounting_impact}</div>
                </div>
                <div>
                  <strong style={{ color: "#202124" }}>Tax & Statutory Relevance:</strong>
                  <div style={{ color: "#3c4043", marginTop: "2px" }}>{finding.tax_relevance}</div>
                </div>
                <div>
                  <strong style={{ color: "#202124" }}>Root Cause & Verification:</strong>
                  <div style={{ color: "#3c4043", marginTop: "2px" }}>{finding.recommended_investigation}</div>
                </div>
                <div>
                  <strong style={{ color: "#202124" }}>External Evidence Needed:</strong>
                  <div style={{ color: "#3c4043", marginTop: "2px" }}>
                    {finding.external_evidence_required || "Internal ledger verification sufficient"}
                  </div>
                </div>
              </div>

              {/* Proposed Treatment Banner */}
              <div
                style={{
                  background: "#fefcf5",
                  border: "1px solid #feefc3",
                  borderRadius: "6px",
                  padding: "10px 14px",
                  fontSize: "12px",
                  color: "#795548",
                  marginBottom: "14px",
                }}
              >
                <strong>Advisory Correction:</strong> {finding.proposed_treatment}
              </div>

              {/* Human Review Status Bar */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #f1f3f4", paddingTop: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "12px", color: "#5f6368" }}>Review State:</span>
                  <span
                    style={{
                      fontSize: "11px",
                      padding: "2px 8px",
                      borderRadius: "10px",
                      fontWeight: 700,
                      background: finding.human_review_status === "REVIEWED" ? "#e6f4ea" : (finding.human_review_status === "ISSUE_CONFIRMED" ? "#fce8e6" : "#fef7e0"),
                      color: finding.human_review_status === "REVIEWED" ? "#137333" : (finding.human_review_status === "ISSUE_CONFIRMED" ? "#c5221f" : "#b06000"),
                    }}
                  >
                    {finding.human_review_status}
                  </span>
                  {finding.resolution_note && (
                    <span style={{ fontSize: "12px", color: "#5f6368", fontStyle: "italic" }}>
                      "{finding.resolution_note}"
                    </span>
                  )}
                </div>

                <button
                  onClick={() => (isReviewOpen ? setActiveReviewId(null) : handleOpenReview(finding))}
                  style={{
                    background: isReviewOpen ? "#dadce0" : "#fff",
                    border: "1px solid #dadce0",
                    color: "#3c4043",
                    padding: "6px 12px",
                    borderRadius: "4px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {isReviewOpen ? "Cancel Review" : "Mark Review / Add Note ✏️"}
                </button>
              </div>

              {/* Interactive Review Drawer */}
              {isReviewOpen && (
                <div style={{ marginTop: "14px", padding: "14px", background: "#f8fafd", border: "1px solid #c2e7ff", borderRadius: "6px" }}>
                  <h4 style={{ margin: "0 0 10px 0", fontSize: "13px", fontWeight: 700, color: "#174ea6" }}>
                    Record Local Human Review Decision (Local SQLite Only — Zero Zoho Writes)
                  </h4>
                  <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "10px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 600 }}>Decision:</label>
                    <select
                      value={reviewStatus}
                      onChange={(e: any) => setReviewStatus(e.target.value)}
                      style={{ padding: "6px 10px", border: "1px solid #dadce0", borderRadius: "4px", fontSize: "12px" }}
                    >
                      <option value="REVIEWED">MARK REVIEWED (Acknowledged / Acceptable)</option>
                      <option value="ISSUE_CONFIRMED">MARK ISSUE CONFIRMED (Action Required)</option>
                      <option value="PENDING">PENDING HUMAN REVIEW</option>
                    </select>
                  </div>
                  <div style={{ marginBottom: "10px" }}>
                    <textarea
                      placeholder="Add auditor / owner note, explanation, or agreed accounting treatment..."
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      rows={2}
                      style={{ width: "100%", padding: "8px", border: "1px solid #dadce0", borderRadius: "4px", fontSize: "12px" }}
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                    <button
                      onClick={() => setActiveReviewId(null)}
                      style={{ padding: "6px 12px", background: "#fff", border: "1px solid #dadce0", borderRadius: "4px", fontSize: "12px", cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleSaveReview(finding.finding_id)}
                      disabled={submitting}
                      style={{ padding: "6px 14px", background: "#1a73e8", color: "white", border: "none", borderRadius: "4px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                    >
                      {submitting ? "Saving..." : "Save Review Decision"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* DEDICATED SECTION: COST & PROFITABILITY OPPORTUNITIES */}
      <div style={{ background: "#fff", border: "1px solid #ceead6", borderRadius: "8px", padding: "24px", marginTop: "32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
          <div>
            <h3 style={{ margin: "0 0 4px 0", fontSize: "17px", fontWeight: 700, color: "#137333" }}>
              💡 Cost & Profitability Opportunities
            </h3>
            <p style={{ margin: 0, fontSize: "13px", color: "#5f6368" }}>
              Evidence-grounded financial analysis identifying interest leakage, idle cash optimization, and working capital recovery.
            </p>
          </div>
          <span style={{ background: "#e6f4ea", color: "#137333", padding: "4px 10px", borderRadius: "10px", fontWeight: 700, fontSize: "12px" }}>
            EVIDENCE-SUPPORTED
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
          {costOpportunities.map((opp) => (
            <div
              key={opp.opportunity_id}
              style={{
                border: "1px solid #e0e0e0",
                borderRadius: "6px",
                padding: "16px",
                background: "#fcfdfe",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "10px", fontWeight: 700, color: "#137333", textTransform: "uppercase" }}>
                  {opp.area}
                </div>
                <h4 style={{ margin: "6px 0 8px 0", fontSize: "14px", fontWeight: 700, color: "#202124" }}>
                  {opp.title}
                </h4>
                <div style={{ fontSize: "12px", color: "#5f6368", marginBottom: "8px" }}>
                  <strong>Exposure:</strong> {formatINR(opp.amount_exposure)}
                </div>
                <div style={{ fontSize: "12px", color: "#3c4043", marginBottom: "8px" }}>
                  {opp.potential_opportunity}
                </div>
              </div>
              <div style={{ borderTop: "1px solid #eee", paddingTop: "8px", fontSize: "11px", color: "#5f6368" }}>
                <strong>Evidence Basis:</strong> {opp.evidence}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

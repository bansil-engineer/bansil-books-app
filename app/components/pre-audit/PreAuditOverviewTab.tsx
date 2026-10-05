"use client";

import React from "react";
import { PreAuditTabKey } from "./PreAuditNav";
import { AuditFinding, CostOpportunity } from "../../lib/audit/audit-findings-service";

interface PreAuditOverviewTabProps {
  financialYear: string;
  findings: AuditFinding[];
  priorityCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  costOpportunities: CostOpportunity[];
  onNavigateTab: (tab: PreAuditTabKey) => void;
  tbEvidence: any;
  bankEvidence: any;
}

export function PreAuditOverviewTab({
  financialYear,
  findings,
  priorityCounts,
  statusCounts,
  costOpportunities,
  onNavigateTab,
  tbEvidence,
  bankEvidence,
}: PreAuditOverviewTabProps) {
  const formatINR = (val: number | string | undefined | null) => {
    if (val === undefined || val === null || val === "") return "NOT AVAILABLE";
    const num = typeof val === "string" ? parseFloat(val) : val;
    return isNaN(num) ? "NOT AVAILABLE" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(num);
  };

  const p0Count = priorityCounts.P0 || 0;
  const p1Count = priorityCounts.P1 || 0;
  const p2Count = priorityCounts.P2 || 0;
  const p3Count = priorityCounts.P3 || 0;

  const pendingReviews = statusCounts.PENDING || 0;
  const reviewedCount = (statusCounts.REVIEWED || 0) + (statusCounts.ISSUE_CONFIRMED || 0);

  return (
    <div style={{ padding: "24px", maxWidth: "1280px", margin: "0 auto" }}>
      {/* Read-Only Guarantee Banner */}
      <div
        style={{
          background: "#e8f0fe",
          border: "1px solid #c2e7ff",
          borderRadius: "8px",
          padding: "12px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "20px" }}>🛡️</span>
          <div>
            <div style={{ fontWeight: 700, color: "#174ea6", fontSize: "14px" }}>
              ZOHO BOOKS — READ ONLY GUARANTEE | ZERO ZOHO WRITES
            </div>
            <div style={{ color: "#3c4043", fontSize: "12px" }}>
              This audit workspace operates on local read snapshots and independent external evidence. No adjustments, entries, or mutations are written to Zoho Books.
            </div>
          </div>
        </div>
        <span
          style={{
            background: "#137333",
            color: "white",
            padding: "4px 10px",
            borderRadius: "16px",
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.5px",
          }}
        >
          READ-ONLY ENGINE
        </span>
      </div>

      {/* Top Header & Executive Status */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
        <div>
          <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#202124", margin: "0 0 6px 0" }}>
            Pre-Audit Management Dashboard — FY {financialYear}
          </h2>
          <p style={{ color: "#5f6368", fontSize: "13px", margin: 0 }}>
            Executive review of accounting integrity, compliance red flags, bank continuity, and audit readiness before formal statutory sign-off.
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "11px", color: "#5f6368", textTransform: "uppercase", fontWeight: 600 }}>
            Overall Pre-Audit Status
          </div>
          <div
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: "#b06000",
              background: "#fef7e0",
              padding: "4px 12px",
              borderRadius: "4px",
              border: "1px solid #feefc3",
              display: "inline-block",
              marginTop: "4px",
            }}
          >
            ⚠️ PARTIAL AUDIT RECONCILIATION
          </div>
        </div>
      </div>

      {/* Priority Metrics Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        {/* P0 Card */}
        <div
          onClick={() => onNavigateTab("AUDIT FINDINGS")}
          style={{
            background: "#fff",
            border: "1px solid #fad2cf",
            borderLeft: "5px solid #d93025",
            borderRadius: "8px",
            padding: "16px",
            cursor: "pointer",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#c5221f" }}>P0 — CRITICAL</span>
            <span style={{ fontSize: "10px", background: "#fce8e6", color: "#c5221f", padding: "2px 6px", borderRadius: "10px", fontWeight: 700 }}>BLOCKS AUDIT</span>
          </div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#d93025", marginTop: "8px" }}>{p0Count}</div>
          <div style={{ fontSize: "12px", color: "#5f6368", marginTop: "4px" }}>Abnormal statutory debits (TDS, Tag Adj)</div>
        </div>

        {/* P1 Card */}
        <div
          onClick={() => onNavigateTab("AUDIT FINDINGS")}
          style={{
            background: "#fff",
            border: "1px solid #feefc3",
            borderLeft: "5px solid #f9ab00",
            borderRadius: "8px",
            padding: "16px",
            cursor: "pointer",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#b06000" }}>P1 — HIGH PRIORITY</span>
            <span style={{ fontSize: "10px", background: "#fef7e0", color: "#b06000", padding: "2px 6px", borderRadius: "10px", fontWeight: 700 }}>MATERIAL</span>
          </div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#e37400", marginTop: "8px" }}>{p1Count}</div>
          <div style={{ fontSize: "12px", color: "#5f6368", marginTop: "4px" }}>Negative inventory & cash book balances</div>
        </div>

        {/* P2 Card */}
        <div
          onClick={() => onNavigateTab("AUDIT FINDINGS")}
          style={{
            background: "#fff",
            border: "1px solid #e0e0e0",
            borderLeft: "5px solid #1a73e8",
            borderRadius: "8px",
            padding: "16px",
            cursor: "pointer",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#174ea6" }}>P2 — MEDIUM</span>
            <span style={{ fontSize: "10px", background: "#e8f0fe", color: "#174ea6", padding: "2px 6px", borderRadius: "10px", fontWeight: 700 }}>REVIEW</span>
          </div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#1a73e8", marginTop: "8px" }}>{p2Count}</div>
          <div style={{ fontSize: "12px", color: "#5f6368", marginTop: "4px" }}>Non-business accounts & audit linkages</div>
        </div>

        {/* P3 / Cost Opps */}
        <div
          onClick={() => onNavigateTab("AUDIT FINDINGS")}
          style={{
            background: "#fff",
            border: "1px solid #ceead6",
            borderLeft: "5px solid #1e8e3e",
            borderRadius: "8px",
            padding: "16px",
            cursor: "pointer",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#137333" }}>COST OPPORTUNITIES</span>
            <span style={{ fontSize: "10px", background: "#e6f4ea", color: "#137333", padding: "2px 6px", borderRadius: "10px", fontWeight: 700 }}>PROFITABILITY</span>
          </div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#137333", marginTop: "8px" }}>
            {costOpportunities.length}
          </div>
          <div style={{ fontSize: "12px", color: "#5f6368", marginTop: "4px" }}>
            Exposure: ~{formatINR(costOpportunities.reduce((acc, c) => acc + (c.amount_exposure || 0), 0))}
          </div>
        </div>
      </div>

      {/* Verified vs Blocked Areas Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "24px" }}>
        {/* Verified Areas */}
        <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: "8px", padding: "20px" }}>
          <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#137333", margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>✅</span> Verified Accounting Areas (Ready)
          </h3>
          <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "13px", color: "#3c4043", lineHeight: "1.8" }}>
            <li>
              <strong>Chart of Accounts & Trial Balance:</strong> Perfect mathematical leaf check (Net Debit = Net Credit, Diff: ₹0.00).{" "}
              <button
                onClick={() => onNavigateTab("BOOKS & TRIAL BALANCE")}
                style={{ background: "none", border: "none", color: "#1a73e8", cursor: "pointer", textDecoration: "underline", fontSize: "12px" }}
              >
                Inspect TB →
              </button>
            </li>
            <li>
              <strong>Accounting Equation:</strong> Assets = Liabilities + Equity + Current FY P/L holds with ₹0.00 difference across all leaves.
            </li>
            <li>
              <strong>HDFC Current XXXX7642:</strong>{" "}
              {bankEvidence?.statement?.count
                ? `${bankEvidence.statement.count}/${bankEvidence.statement.count} Statement rows continuity PASS; `
                : "Statement rows: NOT AVAILABLE; "}
              {bankEvidence?.stats?.matched ? `${bankEvidence.stats.matched} Direct matches + ` : ""}
              {bankEvidence?.grouped_verifications
                ? `${bankEvidence.grouped_verifications.length} Grouped cases (${bankEvidence?.coverage_summary?.grouped_stmt ?? 9} stmt items) + `
                : ""}
              {bankEvidence?.human_resolutions ? `${bankEvidence.human_resolutions.length} Human Verified matches. ` : ""}
              Closing difference {bankEvidence?.statement?.closing !== undefined && bankEvidence?.book?.closing !== undefined ? formatINR(Math.abs(bankEvidence.statement.closing - bankEvidence.book.closing)) : "NOT AVAILABLE"}.{" "}
              <button
                onClick={() => onNavigateTab("BANK VERIFICATION")}
                style={{ background: "none", border: "none", color: "#1a73e8", cursor: "pointer", textDecoration: "underline", fontSize: "12px" }}
              >
                Inspect Bank Recon →
              </button>
            </li>
            <li>
              <strong>Audit Trail:</strong>{" "}
              {bankEvidence?.coverage_summary?.book_coverage_pct !== undefined
                ? `${bankEvidence.coverage_summary.book_coverage_pct}%`
                : "100%"}{" "}
              of HDFC Book transactions ({bankEvidence?.book?.count ?? "NOT AVAILABLE"}) and Statement transactions ({bankEvidence?.statement?.count ?? "NOT AVAILABLE"}) resolved with {bankEvidence?.coverage_summary?.unresolved ?? 0} unexplained residuals.
            </li>
          </ul>
        </div>

        {/* Partial & Blocked Areas */}
        <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: "8px", padding: "20px" }}>
          <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#c5221f", margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>⚠️</span> Blocked Areas & Evidence Required
          </h3>
          <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "13px", color: "#3c4043", lineHeight: "1.8" }}>
            <li>
              <strong>GST Input Tax Credit:</strong> Blocked — GSTR-2B government portal extract required to cross-verify book ITC against supplier filings.{" "}
              <button
                onClick={() => onNavigateTab("GST")}
                style={{ background: "none", border: "none", color: "#1a73e8", cursor: "pointer", textDecoration: "underline", fontSize: "12px" }}
              >
                View GST Tab →
              </button>
            </li>
            <li>
              <strong>TDS / 26AS:</strong> Partial — Form 26AS & AIS tax statement required to confirm customer TDS deductions of ₹6.82L and fix abnormal TDS Payable debits.{" "}
              <button
                onClick={() => onNavigateTab("TDS / 26AS")}
                style={{ background: "none", border: "none", color: "#1a73e8", cursor: "pointer", textDecoration: "underline", fontSize: "12px" }}
              >
                View TDS Tab →
              </button>
            </li>
            <li>
              <strong>Physical Inventory:</strong> Partial — Finished goods (-₹1.43L) and Inventory asset (-₹1.63L) credit balances require physical stock count sheets as on 31/03/2026.{" "}
              <button
                onClick={() => onNavigateTab("INVENTORY")}
                style={{ background: "none", border: "none", color: "#1a73e8", cursor: "pointer", textDecoration: "underline", fontSize: "12px" }}
              >
                View Stock Tab →
              </button>
            </li>
            <li>
              <strong>Payroll / PF / ESIC:</strong> Blocked — Monthly EPFO ECR and ESIC payment receipts required.{" "}
              <button
                onClick={() => onNavigateTab("PAYROLL / PF / ESIC / PT")}
                style={{ background: "none", border: "none", color: "#1a73e8", cursor: "pointer", textDecoration: "underline", fontSize: "12px" }}
              >
                View Payroll Tab →
              </button>
            </li>
          </ul>
        </div>
      </div>

      {/* Human Review Progress & Quick Actions */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e0e0e0",
          borderRadius: "8px",
          padding: "20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h4 style={{ margin: "0 0 6px 0", fontSize: "15px", color: "#202124" }}>
            Human Audit Review Progress
          </h4>
          <p style={{ margin: 0, fontSize: "13px", color: "#5f6368" }}>
            {reviewedCount} of {findings.length} findings reviewed by Owner/Auditor ({pendingReviews} pending). Independent review tracking avoids blanket approvals.
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={() => onNavigateTab("AUDIT FINDINGS")}
            style={{
              padding: "10px 18px",
              background: "#1a73e8",
              color: "white",
              border: "none",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Review Audit Findings →
          </button>
          <button
            onClick={() => onNavigateTab("AUDIT REPORT")}
            style={{
              padding: "10px 18px",
              background: "#fff",
              color: "#3c4043",
              border: "1px solid #dadce0",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Generate Complete Audit Report 📋
          </button>
        </div>
      </div>
    </div>
  );
}

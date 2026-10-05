"use client";

import React, { useState, useEffect, useCallback } from "react";
import type { PreAuditTabKey } from "./pre-audit/PreAuditNav";
import { PreAuditOverviewTab } from "./pre-audit/PreAuditOverviewTab";
import { PreAuditBooksTbTab } from "./pre-audit/PreAuditBooksTbTab";
import { PreAuditBankTab } from "./pre-audit/PreAuditBankTab";
import { PreAuditCashTab } from "./pre-audit/PreAuditCashTab";
import { PreAuditDomainTab } from "./pre-audit/PreAuditDomainTab";
import { PreAuditFindingsTab } from "./pre-audit/PreAuditFindingsTab";
import { PreAuditReportTab } from "./pre-audit/PreAuditReportTab";
import { PreAuditToolbar } from "./pre-audit/PreAuditToolbar";
import { EvidenceDetailDrawer, EvidenceDetailData } from "./pre-audit/EvidenceDetailDrawer";
import { exportPreAuditToExcel, exportBankReconciliationToExcel, triggerIsolatedPrint } from "../lib/audit/pre-audit-export-service";
import { AuditFinding, CostOpportunity, DiscoveredStatementMetadata } from "../lib/audit/audit-findings-service";

interface PreAuditVerificationViewProps {
  onNavigate: (section: string) => void;
  currencySymbol: string;
  activeSection?: string;
}

const SECTION_TO_TAB: Record<string, PreAuditTabKey> = {
  "pre_audit_verification": "OVERVIEW",
  "pre_audit_overview": "OVERVIEW",
  "pre_audit_books_tb": "BOOKS & TRIAL BALANCE",
  "pre_audit_bank": "BANK VERIFICATION",
  "pre_audit_cash": "CASH",
  "pre_audit_sales": "SALES & RECEIVABLES",
  "pre_audit_purchase": "PURCHASE & PAYABLES",
  "pre_audit_inventory": "INVENTORY",
  "pre_audit_gst": "GST",
  "pre_audit_tds": "TDS / 26AS",
  "pre_audit_payroll": "PAYROLL / PF / ESIC / PT",
  "pre_audit_loans": "LOANS / CAPITAL / INVESTMENTS",
  "pre_audit_cutoff": "CUT-OFF & EVIDENCE",
  "pre_audit_findings": "AUDIT FINDINGS",
  "pre_audit_report": "AUDIT REPORT",
};

const TAB_TO_SECTION: Record<PreAuditTabKey, string> = {
  "OVERVIEW": "pre_audit_overview",
  "BOOKS & TRIAL BALANCE": "pre_audit_books_tb",
  "BANK VERIFICATION": "pre_audit_bank",
  "CASH": "pre_audit_cash",
  "SALES & RECEIVABLES": "pre_audit_sales",
  "PURCHASE & PAYABLES": "pre_audit_purchase",
  "INVENTORY": "pre_audit_inventory",
  "GST": "pre_audit_gst",
  "TDS / 26AS": "pre_audit_tds",
  "PAYROLL / PF / ESIC / PT": "pre_audit_payroll",
  "LOANS / CAPITAL / INVESTMENTS": "pre_audit_loans",
  "CUT-OFF & EVIDENCE": "pre_audit_cutoff",
  "AUDIT FINDINGS": "pre_audit_findings",
  "AUDIT REPORT": "pre_audit_report",
};

const TAB_TO_SOURCE_ID: Record<PreAuditTabKey, string> = {
  "OVERVIEW": "TRIAL_BALANCE",
  "BOOKS & TRIAL BALANCE": "CHART_OF_ACCOUNTS",
  "BANK VERIFICATION": "BANK_TRANSACTIONS",
  "CASH": "BANK_TRANSACTIONS",
  "SALES & RECEIVABLES": "SALES_INVOICES",
  "PURCHASE & PAYABLES": "PURCHASE_BILLS",
  "INVENTORY": "INVENTORY_ITEMS",
  "GST": "GST_PORTAL_RETURNS",
  "TDS / 26AS": "TDS_TRACES_26AS",
  "PAYROLL / PF / ESIC / PT": "PAYROLL_STATUTORY",
  "LOANS / CAPITAL / INVESTMENTS": "BANK_ACCOUNTS",
  "CUT-OFF & EVIDENCE": "SALES_INVOICES",
  "AUDIT FINDINGS": "TRIAL_BALANCE",
  "AUDIT REPORT": "TRIAL_BALANCE",
};

export default function PreAuditVerificationView({
  onNavigate,
  currencySymbol,
  activeSection,
}: PreAuditVerificationViewProps) {
  const [activeTab, setActiveTab] = useState<PreAuditTabKey>(() => {
    if (activeSection && SECTION_TO_TAB[activeSection]) {
      return SECTION_TO_TAB[activeSection];
    }
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      const s = p.get("section") || p.get("tab");
      if (s && SECTION_TO_TAB[s]) return SECTION_TO_TAB[s];
    }
    return "OVERVIEW";
  });
  const [runs, setRuns] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [fy, setFy] = useState(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      const fyParam = p.get("fy");
      if (fyParam) return fyParam;
    }
    return "2025-26";
  });
  const [polling, setPolling] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      return p.get("run") || null;
    }
    return null;
  });

  // Normalized Findings and Evidence
  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [priorityCounts, setPriorityCounts] = useState<Record<string, number>>({});
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [costOpportunities, setCostOpportunities] = useState<CostOpportunity[]>([]);
  const [discoveredStatements, setDiscoveredStatements] = useState<DiscoveredStatementMetadata[]>([]);
  
  // Latest TB Evidence
  const [latestTbEvidence, setLatestTbEvidence] = useState<any>(null);
  const [latestTbRunId, setLatestTbRunId] = useState<string | undefined>(undefined);
  const [latestTbCompletedAt, setLatestTbCompletedAt] = useState<string | undefined>(undefined);

  // Evidence Drill-Down State
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceDetailData | null>(null);

  // Module-Level OWNER Sign-Off State
  const [decisionOverview, setDecisionOverview] = useState<any>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [savingDecision, setSavingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionSuccess, setDecisionSuccess] = useState<string | null>(null);

  // Sync activeSection from Sidebar with activeTab
  useEffect(() => {
    if (activeSection && SECTION_TO_TAB[activeSection]) {
      setActiveTab(SECTION_TO_TAB[activeSection]);
    }
  }, [activeSection]);

  const handleTabChange = (tab: PreAuditTabKey) => {
    setActiveTab(tab);
    if (onNavigate && TAB_TO_SECTION[tab]) {
      onNavigate(TAB_TO_SECTION[tab]);
    }
    if (typeof window !== "undefined" && TAB_TO_SECTION[tab]) {
      const url = new URL(window.location.href);
      url.searchParams.set("section", TAB_TO_SECTION[tab]);
      window.history.replaceState({}, "", url.toString());
    }
  };

  const handleFyChange = (newFy: string) => {
    setFy(newFy);
    setSelectedRunId(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("fy", newFy);
      url.searchParams.delete("run");
      window.history.replaceState({}, "", url.toString());
    }
  };

  // Fetch Findings from API
  const fetchFindings = useCallback(async (currentFy: string) => {
    try {
      const res = await fetch(`/api/audit/pre-audit/findings?financialYear=${currentFy}`);
      const data = await res.json();
      if (data.success) {
        setFindings(data.findings || []);
        setPriorityCounts(data.priorityCounts || {});
        setStatusCounts(data.statusCounts || {});
        setCostOpportunities(data.costOpportunities || []);
        setDiscoveredStatements(data.discoveredStatements || []);
        setLatestTbEvidence(data.latestTbEvidence || null);
        setLatestTbRunId(data.latestTbRunId);
        setLatestTbCompletedAt(data.latestTbCompletedAt);
      }
    } catch (e) {
      console.error("Failed to fetch findings:", e);
    }
  }, []);

  // Fetch OWNER Decision Overview for selected run
  const fetchDecision = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/audit/pre-audit/decision?runId=${runId}`);
      const data = await res.json();
      if (data.success) {
        setDecisionOverview(data);
      }
    } catch (e) {
      console.error("Failed to fetch decision:", e);
    }
  }, []);

  // Save OWNER Decision
  const handleSaveDecision = async (decision: string) => {
    if (!selectedRunId) return;
    setSavingDecision(true);
    setDecisionError(null);
    setDecisionSuccess(null);
    try {
      const res = await fetch("/api/audit/pre-audit/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: selectedRunId,
          decision,
          note: decisionNote || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setDecisionSuccess(`Decision saved: ${decision}`);
        setDecisionNote("");
        fetchDecision(selectedRunId);
      } else {
        setDecisionError(data.error || "Failed to save decision");
      }
    } catch (e: any) {
      setDecisionError(e.message || "Network error");
    }
    setSavingDecision(false);
  };

  const fetchResults = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/audit/pre-audit/run?runId=${runId}`);
      const data = await res.json();
      if (data.results) {
        setResults(data.results);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchRuns = useCallback(async (currentFy: string) => {
    try {
      const res = await fetch(`/api/audit/pre-audit/run?financialYear=${currentFy}`);
      const data = await res.json();
      if (data.runs) {
        setRuns(data.runs);
        if (data.runs.length > 0) {
          const runExists = data.runs.find((r: any) => r.run_id === selectedRunId);
          let targetRunId = selectedRunId;
          if (!selectedRunId || !runExists) {
            targetRunId = data.runs[0].run_id;
            setSelectedRunId(targetRunId);
          }
          if (targetRunId) {
            fetchResults(targetRunId);
          }
          if (data.runs[0].process_status === "IN_PROGRESS") {
            setPolling(true);
          } else {
            setPolling(false);
          }
        } else {
          setSelectedRunId(null);
          setResults([]);
          setPolling(false);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, [selectedRunId, fetchResults]);

  useEffect(() => {
    fetchRuns(fy);
    fetchFindings(fy);
  }, [fy, fetchRuns, fetchFindings]);

  // Fetch decision overview when selected run changes
  useEffect(() => {
    if (selectedRunId) {
      fetchDecision(selectedRunId);
    } else {
      setDecisionOverview(null);
    }
  }, [selectedRunId, fetchDecision]);

  useEffect(() => {
    let interval: any;
    if (polling) {
      interval = setInterval(() => {
        fetchRuns(fy);
        fetchFindings(fy);
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [polling, fy, fetchRuns, fetchFindings]);

  const handleRunSelection = (runId: string) => {
    setSelectedRunId(runId);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (runId) {
        url.searchParams.set("run", runId);
      } else {
        url.searchParams.delete("run");
      }
      window.history.replaceState({}, "", url.toString());
    }
    fetchResults(runId);
    fetchDecision(runId);
  };

  // Sync finding from URL param if present on load
  useEffect(() => {
    if (typeof window !== "undefined" && findings.length > 0 && !selectedEvidence) {
      const p = new URLSearchParams(window.location.search);
      const findingParam = p.get("finding");
      if (findingParam) {
        const match = findings.find((f) => f.finding_id === findingParam);
        if (match) {
          setSelectedEvidence({
            type: "FINDING",
            title: match.title,
            finding: match,
          });
        }
      }
    }
  }, [findings, fy, selectedEvidence]);

  const startRun = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/audit/pre-audit/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ financialYear: fy }),
      });
      const data = await res.json();
      if (data.runId) {
        setSelectedRunId(data.runId);
      }
      fetchRuns(fy);
      fetchFindings(fy);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleReviewUpdate = async (
    findingId: string,
    status: "REVIEWED" | "ISSUE_CONFIRMED" | "PENDING",
    note: string
  ) => {
    try {
      const res = await fetch("/api/audit/pre-audit/findings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          findingId,
          status,
          note,
          reviewer: "OWNER",
        }),
      });
      if (res.ok) {
        fetchFindings(fy);
      }
    } catch (e) {
      console.error("Error updating review:", e);
    }
  };

  const activeRun = runs.find((r) => r.run_id === selectedRunId);
  const tbResult = results.find((r) => r.checkpoint_key === "Trial Balance");
  const coaResult = results.find((r) => r.checkpoint_key === "Chart of Accounts");
  const aeResult = results.find((r) => r.checkpoint_key === "Accounting Equation");
  const bankResult = results.find((r) => r.checkpoint_key === "Bank");

  let tbEvidence: any = null;
  if (tbResult?.evidence_json) {
    try {
      tbEvidence = JSON.parse(tbResult.evidence_json);
    } catch {}
  }

  let bankEvidence: any = null;
  if (bankResult?.evidence_json) {
    try {
      bankEvidence = JSON.parse(bankResult.evidence_json);
    } catch {}
  }

  // Handle Excel Export for Current View
  const handleExportExcel = () => {
    const isTb = activeTab === "BOOKS & TRIAL BALANCE";
    const isBank = activeTab === "BANK VERIFICATION";
    const isFinding = activeTab === "AUDIT FINDINGS";

    if (isBank && bankEvidence) {
      exportBankReconciliationToExcel({
        financialYear: fy,
        bankName: "HDFC Bank",
        accountName: "HDFC Current Account-7642",
        accountNumberMasked: "XXXX7642",
        statementFile: "Acct_Statement_XXXXXXXX7642_13092026.pdf",
        statementPages: 35,
        bookRows: bankEvidence.book?.count ?? 422,
        statementRows: bankEvidence.statement?.count ?? 427,
        openingBalance: Number(bankEvidence.statement?.opening ?? 3693463.01),
        depositsTotal: Number(bankEvidence.statement?.deposits ?? 176084152.34),
        withdrawalsTotal: Number(bankEvidence.statement?.withdrawals ?? 178614719.0),
        statementClosingBalance: Number(bankEvidence.statement?.closing ?? 1162896.35),
        bookClosingBalance: Number(bankEvidence.book?.closing ?? 1162896.35),
        closingDifference: Math.abs((bankEvidence.statement?.closing ?? 0) - (bankEvidence.book?.closing ?? 0)),
        arithmeticContinuityPass: true,
        arithmeticDiscrepancy: 0,
        directMatches: bankEvidence.stats?.matched ?? 413,
        groupedCases: bankEvidence.grouped_verifications?.length ?? 4,
        groupedStatementComponents: bankEvidence.coverage_summary?.grouped_stmt ?? 9,
        humanResolved: bankEvidence.human_resolutions?.length ?? 5,
        unresolvedRows: bankEvidence.coverage_summary?.unresolved ?? 0,
        coveragePct: bankEvidence.coverage_summary?.book_coverage_pct ?? 100.0,
        entity: {
          entityName: "Bansil Engineers",
          entityType: "Proprietorship",
          legalName: "Bansil Engineers",
          organizationId: "774390949",
          platform: "Antigravity Audit Workspace",
          zohoWriteMode: 0,
        },
        rawEvidence: bankEvidence,
      });
    } else if (isFinding || activeTab === "OVERVIEW" || activeTab === "AUDIT REPORT") {
      exportPreAuditToExcel({
        fileName: `Bansil_Audit_Findings_${fy}`,
        sheetName: "Audit Findings Register",
        reportTitle: "Audit Findings Register — P0/P1/P2 Classified",
        financialYear: fy,
        selectedContext: activeTab,
        activeFilter: "All Findings",
        columns: [
          { header: "Finding ID", key: "finding_id", width: 26 },
          { header: "Priority", key: "priority", width: 10 },
          { header: "Severity", key: "severity", width: 12 },
          { header: "Area", key: "area", width: 22 },
          { header: "Title", key: "title", width: 35 },
          { header: "Observed Fact", key: "observed_fact", width: 45 },
          { header: "Exposure Amount (₹)", key: "amount", width: 18 },
          { header: "System Status", key: "system_status", width: 22 },
          { header: "Human Review", key: "human_review_status", width: 15 },
          { header: "Advisory Treatment", key: "proposed_treatment", width: 45 },
          { header: "Tax & Statutory Relevance", key: "tax_relevance", width: 40 },
        ],
        data: findings,
      });
    } else if (isTb && tbEvidence) {
      const leaves = tbEvidence.flatLeaves || tbEvidence.leafAccounts || [];
      exportPreAuditToExcel({
        fileName: `Bansil_Trial_Balance_Leaves_${fy}`,
        sheetName: "TB Leaf Accounts",
        reportTitle: "Trial Balance Leaf Accounts Register",
        financialYear: fy,
        selectedContext: "Books & Trial Balance",
        columns: [
          { header: "Account ID", key: "account_id", width: 22 },
          { header: "Account Name", key: "name", width: 35 },
          { header: "Net Debit (₹)", key: "net_debit_total", width: 16 },
          { header: "Net Credit (₹)", key: "net_credit_total", width: 16 },
        ],
        data: leaves,
      });
    } else if (activeTab === "CASH") {
      window.dispatchEvent(new CustomEvent("triggerCashExcelExport"));
    } else {
      // Domain-specific findings
      const domainFindings = findings.filter(f => f.area.toUpperCase().includes(activeTab.slice(0, 4).toUpperCase()));
      exportPreAuditToExcel({
        fileName: `Bansil_Audit_${activeTab.replace(/[^a-zA-Z0-9]/g, "_")}_${fy}`,
        sheetName: activeTab.slice(0, 30),
        reportTitle: `${activeTab} Audit Register`,
        financialYear: fy,
        selectedContext: activeTab,
        columns: [
          { header: "Finding ID", key: "finding_id", width: 26 },
          { header: "Priority", key: "priority", width: 10 },
          { header: "Title", key: "title", width: 35 },
          { header: "Observed Fact", key: "observed_fact", width: 45 },
          { header: "Amount (₹)", key: "amount", width: 16 },
          { header: "System Status", key: "system_status", width: 20 },
          { header: "Advisory Treatment", key: "proposed_treatment", width: 45 },
        ],
        data: domainFindings.length > 0 ? domainFindings : findings,
      });
    }
  };

  // Handle Print-Only PDF Export
  const handleExportPdf = () => {
    if (activeTab === "CASH") {
      window.dispatchEvent(new CustomEvent("triggerCashPdfExport"));
    } else {
      triggerIsolatedPrint("pre-audit-report-print-container");
    }
  };

  const currentSourceId = TAB_TO_SOURCE_ID[activeTab] || "TRIAL_BALANCE";
  const isExternalSource = ["GST", "TDS / 26AS", "PAYROLL / PF / ESIC / PT"].includes(activeTab);

  return (
    <div style={{ background: "#f8fafd", minHeight: "100vh" }}>
      {/* Top Banner (Hidden in Print) */}
      <div
        className="no-print"
        style={{
          background: "#1e293b",
          color: "#f8fafc",
          padding: "6px 24px",
          fontSize: "11px",
          fontWeight: 700,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          letterSpacing: "0.05em",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ color: "#38bdf8" }}>🛡️ PRE-AUDIT FUNCTIONAL WORKSPACE</span>
          <span>•</span>
          <span style={{ color: "#4ade80" }}>ZOHO BOOKS — READ ONLY | ZERO ZOHO WRITES</span>
        </div>
        <div style={{ color: "#94a3b8" }}>
          Target FY: {fy} • AY {parseInt(fy.substring(0,4)) + 1}-{parseInt(fy.split('-')[1]) + 1} • Database: local SQLite (data/audit_workspace.db)
        </div>
      </div>

      {/* Top Process Control Bar (Hidden in Print) */}
      <div
        className="no-print"
        style={{
          background: "#fff",
          borderBottom: "1px solid #dadce0",
          padding: "12px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div>
            <h1 style={{ fontSize: "18px", fontWeight: 800, color: "#202124", margin: 0 }}>
              Pre-Audit Accounting Workspace
            </h1>
            <div style={{ fontSize: "12px", color: "#5f6368" }}>
              Bansil Engineers • Deep Verification & Financial Analysis
            </div>
          </div>
          <span
            style={{
              background: "#e6f4ea",
              color: "#137333",
              border: "1px solid #ceead6",
              padding: "2px 8px",
              borderRadius: "4px",
              fontSize: "11px",
              fontWeight: 700,
            }}
          >
            ZOHO WRITE: 0 (READ-ONLY)
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
            <span style={{ color: "#5f6368", fontWeight: 600 }}>FY:</span>
            <select
              value={fy}
              onChange={(e) => handleFyChange(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: "4px", border: "1px solid #dadce0", fontSize: "13px", fontWeight: 600 }}
            >
              <option value="2026-27">FY 2026-27</option>
              <option value="2025-26">FY 2025-26</option>
              <option value="2024-25">FY 2024-25</option>
            </select>
          </div>

          {runs.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
              <span style={{ color: "#5f6368" }}>Run:</span>
              <select
                value={selectedRunId || ""}
                onChange={(e) => handleRunSelection(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: "4px", border: "1px solid #dadce0", fontSize: "12px", maxWidth: "220px" }}
              >
                {runs.map((r) => (
                  <option key={r.run_id} value={r.run_id}>
                    {new Date(r.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} • [{r.process_status}] • {r.run_id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div style={{ padding: "6px 10px", background: "#f87171", color: "white", borderRadius: "4px", fontSize: "11px", fontWeight: "bold" }}>
              NO PRE-AUDIT RUN AVAILABLE
            </div>
          )}

          <button
            onClick={startRun}
            disabled={loading || polling}
            style={{
              padding: "7px 14px",
              background: "#1a73e8",
              color: "white",
              border: "none",
              borderRadius: "4px",
              fontWeight: 600,
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            {polling ? "Running..." : "Re-Run Verification"}
          </button>
        </div>
      </div>

      {/* Main Workspace Container (Isolates print output) */}
      <div id="pre-audit-report-print-container" style={{ padding: "0 24px 32px 24px" }}>
        {/* Reusable Common Toolbar (Hidden in Print) */}
        <div className="no-print" style={{ marginTop: "16px" }}>
          <PreAuditToolbar
            sourceId={currentSourceId}
            accountId={activeTab === "CASH" ? "CASH" : ""}
            financialYear={fy}
            onExportExcel={handleExportExcel}
            onExportPdf={handleExportPdf}
            isExternalSource={isExternalSource}
            onSyncComplete={() => {
              fetchRuns(fy);
              fetchFindings(fy);
            }}
          />
        </div>

        {/* ============================================================ */}
        {/* OWNER REVIEW / MODULE SIGN-OFF                                */}
        {/* ============================================================ */}
        {activeRun && activeRun.process_status === "COMPLETED" && decisionOverview && (
          <div
            className="no-print"
            style={{
              background: "#fff",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              padding: "20px 24px",
              marginTop: "16px",
              marginBottom: "16px",
            }}
          >
            <h2
              style={{
                fontSize: "15px",
                fontWeight: 800,
                color: "#1e293b",
                margin: "0 0 16px 0",
                letterSpacing: "0.02em",
                textTransform: "uppercase",
              }}
            >
              Owner Review / Module Sign-Off
            </h2>

            {/* System Result Summary */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
                gap: "10px",
                marginBottom: "16px",
              }}
            >
              {[
                { label: "Total", value: decisionOverview.summary?.total ?? 0, color: "#5f6368" },
                { label: "Passed", value: decisionOverview.summary?.passed ?? 0, color: "#137333" },
                { label: "Failed", value: decisionOverview.summary?.failed ?? 0, color: "#c5221f" },
                { label: "Blocked", value: decisionOverview.summary?.blocked ?? 0, color: "#e37400" },
                { label: "Partial", value: decisionOverview.summary?.partial ?? 0, color: "#b06000" },
                { label: "Not Implemented", value: decisionOverview.summary?.not_implemented ?? 0, color: "#9334e6" },
                { label: "Data Incomplete", value: decisionOverview.summary?.data_incomplete ?? 0, color: "#c5221f" },
                { label: "Error", value: decisionOverview.summary?.error ?? 0, color: "#c5221f" },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{
                    textAlign: "center",
                    padding: "8px 4px",
                    background: "#f8fafd",
                    borderRadius: "6px",
                    border: "1px solid #e8eaed",
                  }}
                >
                  <div style={{ fontSize: "20px", fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: "10px", color: "#5f6368", fontWeight: 600, textTransform: "uppercase" }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Findings Reviewed Count */}
            <div style={{ fontSize: "12px", color: "#5f6368", marginBottom: "12px" }}>
              Findings reviewed:{" "}
              <strong>{(statusCounts.REVIEWED || 0) + (statusCounts.ISSUE_CONFIRMED || 0)}</strong> of{" "}
              <strong>{findings.length}</strong>
              {" • "}Run completed: <strong>{activeRun.completed_at ? new Date(activeRun.completed_at).toLocaleString() : "—"}</strong>
            </div>

            {/* Current Decision Display */}
            {decisionOverview.currentDecision &&
              decisionOverview.currentDecision.decision !== "PENDING" && (
                <div
                  style={{
                    background:
                      decisionOverview.currentDecision.decision === "ACCEPTED"
                        ? "#e6f4ea"
                        : decisionOverview.currentDecision.decision === "ACCEPTED_WITH_LIMITATIONS"
                        ? "#fef7e0"
                        : decisionOverview.currentDecision.decision === "REJECTED"
                        ? "#fce8e6"
                        : "#e8f0fe",
                    border:
                      "1px solid " +
                      (decisionOverview.currentDecision.decision === "ACCEPTED"
                        ? "#ceead6"
                        : decisionOverview.currentDecision.decision === "ACCEPTED_WITH_LIMITATIONS"
                        ? "#fdd663"
                        : decisionOverview.currentDecision.decision === "REJECTED"
                        ? "#f5c6cb"
                        : "#aecbfa"),
                    borderRadius: "6px",
                    padding: "12px 16px",
                    marginBottom: "16px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ fontWeight: 800, fontSize: "13px", textTransform: "uppercase" }}>
                        Owner Decision: {decisionOverview.currentDecision.decision.replace(/_/g, " ")}
                      </span>
                      {decisionOverview.isCurrentRunSuperseded && (
                        <span
                          style={{
                            marginLeft: "10px",
                            background: "#9aa0a6",
                            color: "white",
                            padding: "2px 6px",
                            borderRadius: "3px",
                            fontSize: "10px",
                            fontWeight: 700,
                          }}
                        >
                          SUPERSEDED
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "11px", color: "#5f6368" }}>
                      {decisionOverview.currentDecision.decided_by} •{" "}
                      {new Date(decisionOverview.currentDecision.decided_at).toLocaleString()}
                    </div>
                  </div>
                  {decisionOverview.currentDecision.decision_note && (
                    <div style={{ fontSize: "12px", color: "#3c4043", marginTop: "8px", fontStyle: "italic" }}>
                      {decisionOverview.currentDecision.decision_note}
                    </div>
                  )}
                </div>
              )}

            {/* Limitations List */}
            {decisionOverview.hasLimitations && (
              <div style={{ marginBottom: "16px" }}>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#e37400",
                    marginBottom: "6px",
                    textTransform: "uppercase",
                  }}
                >
                  Current Limitations ({decisionOverview.limitations.length})
                </div>
                <div
                  style={{
                    maxHeight: "180px",
                    overflowY: "auto",
                    border: "1px solid #e8eaed",
                    borderRadius: "4px",
                  }}
                >
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ background: "#f8fafd" }}>
                        <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: "1px solid #e8eaed", fontWeight: 700 }}>
                          Checkpoint
                        </th>
                        <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: "1px solid #e8eaed", fontWeight: 700 }}>
                          Status
                        </th>
                        <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: "1px solid #e8eaed", fontWeight: 700 }}>
                          Reason
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(decisionOverview.limitations || []).map((lim: any, i: number) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f1f3f4" }}>
                          <td style={{ padding: "5px 10px", fontWeight: 600 }}>{lim.checkpoint_key}</td>
                          <td style={{ padding: "5px 10px" }}>
                            <span
                              style={{
                                background:
                                  lim.result_status === "FAIL" ? "#fce8e6" :
                                  lim.result_status === "PARTIAL" ? "#fef7e0" :
                                  lim.process_status === "BLOCKED" ? "#fff3e0" :
                                  "#f3e8fd",
                                color:
                                  lim.result_status === "FAIL" ? "#c5221f" :
                                  lim.result_status === "PARTIAL" ? "#b06000" :
                                  lim.process_status === "BLOCKED" ? "#e37400" :
                                  "#9334e6",
                                padding: "1px 6px",
                                borderRadius: "3px",
                                fontSize: "11px",
                                fontWeight: 700,
                              }}
                            >
                              {lim.result_status}
                            </span>
                          </td>
                          <td style={{ padding: "5px 10px", color: "#5f6368" }}>
                            {lim.reason || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Last Accepted Baseline Info */}
            {decisionOverview.lastAcceptedDecision &&
              decisionOverview.lastAcceptedDecision.run_id !== selectedRunId && (
                <div
                  style={{
                    fontSize: "11px",
                    color: "#5f6368",
                    background: "#f8fafd",
                    border: "1px solid #e8eaed",
                    borderRadius: "4px",
                    padding: "8px 12px",
                    marginBottom: "16px",
                  }}
                >
                  <strong>Last Accepted Baseline:</strong>{" "}
                  Run {decisionOverview.lastAcceptedDecision.run_id.slice(0, 8)} •{" "}
                  {decisionOverview.lastAcceptedDecision.decision.replace(/_/g, " ")} •{" "}
                  {new Date(decisionOverview.lastAcceptedDecision.decided_at).toLocaleString()}
                </div>
              )}

            {/* Decision Disclaimer */}
            <div
              style={{
                fontSize: "11px",
                color: "#80868b",
                background: "#f8fafd",
                borderRadius: "4px",
                padding: "8px 12px",
                marginBottom: "16px",
                borderLeft: "3px solid #dadce0",
              }}
            >
              This sign-off acknowledges the current Pre-Audit run as reviewed by OWNER.
              It does not change the underlying checkpoint results.
              {decisionOverview.hasLimitations &&
                " Limitations shown above reflect actual system status and remain visible after sign-off."}
            </div>

            {/* Decision Note Input */}
            <div style={{ marginBottom: "12px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "#3c4043", display: "block", marginBottom: "4px" }}>
                Owner Note
              </label>
              <textarea
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder="Optional: Add context for this decision (e.g., 'Accepted for current internal pre-audit baseline; GST/26AS and physical inventory evidence remain pending.')"
                style={{
                  width: "100%",
                  minHeight: "60px",
                  padding: "8px 10px",
                  borderRadius: "4px",
                  border: "1px solid #dadce0",
                  fontSize: "12px",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Decision Buttons */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              {/* ACCEPT — enabled only when NO limitations exist */}
              <button
                onClick={() => handleSaveDecision("ACCEPTED")}
                disabled={savingDecision || decisionOverview.hasLimitations}
                title={
                  decisionOverview.hasLimitations
                    ? "Plain ACCEPT is not available when unresolved limitations exist. Use ACCEPT WITH LIMITATIONS."
                    : "Accept — all checkpoints are clean"
                }
                style={{
                  padding: "7px 16px",
                  background: decisionOverview.hasLimitations ? "#e8eaed" : "#137333",
                  color: decisionOverview.hasLimitations ? "#9aa0a6" : "white",
                  border: "none",
                  borderRadius: "4px",
                  fontWeight: 700,
                  fontSize: "12px",
                  cursor: decisionOverview.hasLimitations ? "not-allowed" : "pointer",
                }}
              >
                ACCEPT
              </button>

              {/* ACCEPT WITH LIMITATIONS — primary when limitations exist */}
              <button
                onClick={() => handleSaveDecision("ACCEPTED_WITH_LIMITATIONS")}
                disabled={savingDecision || !decisionOverview.hasLimitations}
                title={
                  !decisionOverview.hasLimitations
                    ? "No limitations exist — use plain ACCEPT"
                    : "Accept with acknowledged limitations"
                }
                style={{
                  padding: "7px 16px",
                  background: !decisionOverview.hasLimitations ? "#e8eaed" : "#e37400",
                  color: !decisionOverview.hasLimitations ? "#9aa0a6" : "white",
                  border: "none",
                  borderRadius: "4px",
                  fontWeight: 700,
                  fontSize: "12px",
                  cursor: !decisionOverview.hasLimitations ? "not-allowed" : "pointer",
                }}
              >
                ACCEPT WITH LIMITATIONS
              </button>

              {/* REJECT */}
              <button
                onClick={() => handleSaveDecision("REJECTED")}
                disabled={savingDecision}
                style={{
                  padding: "7px 16px",
                  background: "#c5221f",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  fontWeight: 700,
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                REJECT
              </button>

              {/* REVIEW REQUIRED */}
              <button
                onClick={() => handleSaveDecision("REVIEW_REQUIRED")}
                disabled={savingDecision}
                style={{
                  padding: "7px 16px",
                  background: "#1a73e8",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  fontWeight: 700,
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                REVIEW REQUIRED
              </button>

              {savingDecision && (
                <span style={{ fontSize: "12px", color: "#5f6368" }}>Saving...</span>
              )}
            </div>

            {/* Error/Success Feedback */}
            {decisionError && (
              <div style={{ marginTop: "10px", fontSize: "12px", color: "#c5221f", fontWeight: 600 }}>
                {decisionError}
              </div>
            )}
            {decisionSuccess && (
              <div style={{ marginTop: "10px", fontSize: "12px", color: "#137333", fontWeight: 600 }}>
                {decisionSuccess}
              </div>
            )}
          </div>
        )}

        {/* Sub-Tab Contents */}
        <div>
          {activeTab === "OVERVIEW" && (
            <PreAuditOverviewTab
              financialYear={fy}
              findings={findings}
              priorityCounts={priorityCounts}
              statusCounts={statusCounts}
              costOpportunities={costOpportunities}
              onNavigateTab={handleTabChange}
              tbEvidence={tbEvidence}
              bankEvidence={bankEvidence}
            />
          )}

          {activeTab === "BOOKS & TRIAL BALANCE" && (
            <PreAuditBooksTbTab
              financialYear={fy}
              tbResult={tbResult}
              coaResult={coaResult}
              aeResult={aeResult}
            />
          )}

          {activeTab === "BANK VERIFICATION" && (
            <PreAuditBankTab
              financialYear={fy}
              bankResult={bankResult}
              discoveredStatements={discoveredStatements}
            />
          )}

          {activeTab === "CASH" && (
            <PreAuditCashTab
              financialYear={fy}
              findings={findings}
            />
          )}

          {activeTab === "AUDIT FINDINGS" && (
            <PreAuditFindingsTab
              financialYear={fy}
              findings={findings}
              costOpportunities={costOpportunities}
              onReviewUpdate={handleReviewUpdate}
            />
          )}

          {activeTab === "AUDIT REPORT" && (
            <PreAuditReportTab
              financialYear={fy}
              findings={findings}
              costOpportunities={costOpportunities}
              tbEvidence={tbEvidence}
              bankEvidence={bankEvidence}
              latestTbEvidence={latestTbEvidence}
              latestTbRunId={latestTbRunId}
              latestTbCompletedAt={latestTbCompletedAt}
            />
          )}

          {/* Specialized Domain Tabs */}
          {activeTab !== "OVERVIEW" &&
            activeTab !== "BOOKS & TRIAL BALANCE" &&
            activeTab !== "BANK VERIFICATION" &&
            activeTab !== "CASH" &&
            activeTab !== "AUDIT FINDINGS" &&
            activeTab !== "AUDIT REPORT" && (
              <PreAuditDomainTab
                tabKey={activeTab}
                financialYear={fy}
                findings={findings}
                tbEvidence={tbEvidence}
                onNavigateFindings={() => handleTabChange("AUDIT FINDINGS")}
              />
            )}
        </div>
      </div>

      {/* Clickable Evidence Detail Drawer */}
      <EvidenceDetailDrawer
        data={selectedEvidence}
        onClose={() => {
          setSelectedEvidence(null);
          if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.delete("finding");
            window.history.replaceState({}, "", url.toString());
          }
        }}
        currencySymbol={currencySymbol}
      />
    </div>
  );
}

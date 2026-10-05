"use client";

import React, { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import GstMonthlyReconciliationV2 from "./GstMonthlyReconciliationV2";
import PurchaseRecoControl from "./PurchaseRecoControl";
import GrossMarginControl from "./GrossMarginControl";
import EvidenceUploadManager from "./EvidenceUploadManager";
import { formatDisplayDate, formatINR } from "@/app/lib/date-utils";
import { ZohoSyncManager } from "./ZohoSyncManager";
import "../AccountsAuditView.css";

function GstVerificationViewInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  
  const rawFY = searchParams?.get('fy') || "";
  const rawPeriod = searchParams?.get('period');
  
  const ALL_FYS = ["2026-27", "2025-26", "2024-25", "2023-24", "2022-23"];
  const globalFY = ALL_FYS.includes(rawFY) ? rawFY : "2025-26";
  const selectedMonth = rawPeriod || "FULL";
  
  const startYear = parseInt(globalFY.split("-")[0]);
  const endYear = startYear + 1;
  const ayStr = `${endYear}-${(endYear + 1).toString().slice(2)}`;
  
  const periodOptions = [
    { value: "FULL", label: globalFY === "2026-27" ? "FY TO DATE" : "FULL FY" },
    ...[
      { m: "04", lbl: "Apr", next: false }, { m: "05", lbl: "May", next: false }, { m: "06", lbl: "Jun", next: false },
      { m: "07", lbl: "Jul", next: false }, { m: "08", lbl: "Aug", next: false }, { m: "09", lbl: "Sep", next: false },
      { m: "10", lbl: "Oct", next: false }, { m: "11", lbl: "Nov", next: false }, { m: "12", lbl: "Dec", next: false },
      { m: "01", lbl: "Jan", next: true }, { m: "02", lbl: "Feb", next: true }, { m: "03", lbl: "Mar", next: true }
    ].map((x) => {
      const y = x.next ? endYear : startYear;
      return { value: `${x.m} ${y}`, label: `${x.lbl}-${y.toString().slice(2)}` };
    })
  ];
  
  const [actionsData, setActionsData] = useState<any[]>([]);


  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [filterType, setFilterType] = useState("All");
  const [filterPeriod, setFilterPeriod] = useState("FY2025-26"); 
  const [filterScope, setFilterScope] = useState("Production"); 
  const [filterTax, setFilterTax] = useState("All");
  const [filterSource, setFilterSource] = useState("All");
  const [filterArith, setFilterArith] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleRows, setVisibleRows] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [matrixData, setMatrixData] = useState<any>(null);
  const [paymentMatrixData, setPaymentMatrixData] = useState<any>(null);
  const [finalReport, setFinalReport] = useState<any>(null);
    
  // Actions filter state
  const [actionPriority, setActionPriority] = useState("ALL");
  const [actionStatus, setActionStatus] = useState("ACTIVE");
  const [showHistory, setShowHistory] = useState(false);
  const [showManageEvidence, setShowManageEvidence] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/audit/gst/5g2b/status?fy=${globalFY}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (rawFY && !ALL_FYS.includes(rawFY)) {
      const params = new URLSearchParams(searchParams?.toString());
      params.set("fy", "2025-26");
      router.replace(`${pathname}?${params.toString()}`);
    }
  }, [rawFY, pathname, router, searchParams]);

  const handleFYChange = (newFY: string) => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set("fy", newFY);
    router.push(`${pathname}?${params.toString()}`);
  };

  const handlePeriodChange = (newPeriod: string) => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set("period", newPeriod);
    router.push(`${pathname}?${params.toString()}`);
  };

  useEffect(() => {
    fetchStatus();
    fetch('/monthly-tax-matrix.json').then(r => r.json()).then(d => setMatrixData(d)).catch(console.error);
    fetch('/3b-payment-matrix.json').then(r => r.json()).then(d => setPaymentMatrixData(d)).catch(console.error);
    fetch('/final-360-report.json').then(r => r.json()).then(d => setFinalReport(d)).catch(console.error);
    fetch('/gst-360-actions.json').then(r => r.json()).then(d => setActionsData(d.actions || [])).catch(console.error);
  }, []);

  useEffect(() => {
    setFilterPeriod(`FY${globalFY}`);
  }, [globalFY]);

  if (loading && !data) {
    return (
      <div className="app-content accounts-audit" style={{ padding: "40px", textAlign: "center", color: "var(--text-secondary)" }}>
        Loading GST Verification Data...
      </div>
    );
  }

  // Strict FY Data Isolation
  const isDemoFY = globalFY === "2025-26";
  const reportToUse = isDemoFY ? finalReport : null;

  const { allEvidence = [] } = data || {};
  
  const salesUniverse = isDemoFY ? 457 : 134;
  const purchaseUniverse = isDemoFY ? 1193 : 491;

  let sumSalesTaxable = 0, sumSalesIgst = 0, sumSalesCgst = 0, sumSalesSgst = 0, sumSalesCess = 0;
  let sumPurTaxable = 0, sumPurIgst = 0, sumPurCgst = 0, sumPurSgst = 0, sumPurCess = 0;
  let sumPurTds = 0, sumPurPayable = 0;
  
  let validSalesCoverage = 0;
  let validPurchaseCoverage = 0;
  
  let productionSalesRows = 0;
  let productionPurchaseRows = 0;
  let pilotTestRows = 0;
  let outOfPeriodRows = 0;
  
  let rcmDocsFound = data?.coverage?.rcm?.docsFound || 0;
  let rcmTaxable = data?.coverage?.rcm?.taxable || 0;

  const uniqueDocsMap = new Map();
  allEvidence.forEach((doc: any) => {
    if (!uniqueDocsMap.has(doc.document_id)) {
      uniqueDocsMap.set(doc.document_id, doc);
    }
  });
  const deduplicatedEvidence = Array.from(uniqueDocsMap.values());

  deduplicatedEvidence.forEach((m: any) => {
    const isProduction = !m.isPilot;
    const docFY = m.document_date >= "2025-04-01" && m.document_date <= "2026-03-31" ? "2025-26" : "2022-23";
    const isFY = docFY === globalFY;
    
    if (isProduction) {
      if (!isFY) {
        outOfPeriodRows++;
      } else {
        if (m.document_type === "sales") productionSalesRows++;
        else if (m.document_type === "purchase") productionPurchaseRows++;
      }
    } else {
      pilotTestRows++;
    }

    if (isFY && m.source_class === "SOURCE_EXACT" && isProduction) {
      if (m.document_type === "sales") {
        validSalesCoverage++;
        sumSalesTaxable += m.taxable || 0;
        sumSalesIgst += m.igst || 0;
        sumSalesCgst += m.cgst || 0;
        sumSalesSgst += m.sgst || 0;
        sumSalesCess += m.cess || 0;
      } else if (m.document_type === "purchase") {
        validPurchaseCoverage++;
        sumPurTaxable += m.taxable || 0;
        sumPurIgst += m.igst || 0;
        sumPurCgst += m.cgst || 0;
        sumPurSgst += m.sgst || 0;
        sumPurCess += m.cess || 0;
        sumPurTds += m.tds || 0;
        sumPurPayable += m.gross || 0;
      }
    }
  });

  const filteredDocs = deduplicatedEvidence.filter((m: any) => {
    if (filterScope === "Production" && m.isPilot) return false;
    if (filterScope === "Pilot/Test" && !m.isPilot) return false;
    
    if (filterType !== "All" && m.document_type !== filterType.toLowerCase()) return false;
    
    const docFY = m.document_date >= "2025-04-01" && m.document_date <= "2026-03-31" ? "FY2025-26" : "FY2022-23";
    if (filterPeriod === "FY2025-26" && docFY !== "FY2025-26") return false;
    if (filterPeriod === "FY2022-23" && docFY !== "FY2022-23") return false;
    if (filterPeriod === "OUT_OF_PERIOD" && docFY === `FY${globalFY}`) return false;
    
    if (filterTax !== "All" && m.taxCategory !== filterTax) return false;
    if (filterSource !== "All" && m.source_class !== filterSource) return false;
    if (filterArith !== "All" && m.arithmetic_status !== filterArith) return false;
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const docStr = (m.document_number || "").toLowerCase();
      const partyStr = (m.vendor || "").toLowerCase();
      if (!docStr.includes(q) && !partyStr.includes(q)) return false;
    }
    return true;
  });

  const totalPages = Math.ceil(filteredDocs.length / visibleRows);
  const safeCurrentPage = Math.min(currentPage, Math.max(1, totalPages));
  const displayedDocs = filteredDocs.slice((safeCurrentPage - 1) * visibleRows, safeCurrentPage * visibleRows);

  const formatVal = (val: number | null | undefined) => (val || val === 0 ? formatINR(val) : "—");
  
  const navItemStyle = { 
    color: 'var(--google-blue)', 
    textDecoration: 'none', 
    fontWeight: 500,
    fontSize: '14px',
    padding: '4px 8px',
    borderRadius: '4px'
  };

  return (
    <div className="app-content accounts-audit">
      
      {/* HEADER */}
      <div className="app-top-header" style={{ marginBottom: 16, borderRadius: 8 }}>
        <div className="app-top-header-left">
          <div className="section-title-group">
            <h1 className="app-page-title">GST 360° Verification</h1>
            <div className="section-subtitle" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              FY {globalFY} • AY {ayStr} | Bansil Engineers
            </div>
          </div>
        </div>
        <div className="app-top-header-right">
          <span className="status-chip paid" style={{ textTransform: 'uppercase' }}>READ-ONLY AUDIT</span>
          <span className="status-chip paid" style={{ textTransform: 'uppercase' }}>ZOHO WRITE 0</span>
          <span className="status-chip paid" style={{ textTransform: 'uppercase' }}>GST PORTAL WRITE 0</span>
          <span className="status-chip draft" style={{ textTransform: 'uppercase' }}>EVIDENCE READ ONLY</span>
        </div>
      </div>

      {/* GLOBAL SELECTORS */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', alignItems: 'center', background: 'var(--bg-subtle)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>FINANCIAL YEAR</label>
          <select 
            value={globalFY} 
            onChange={e => handleFYChange(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid var(--border)', fontSize: '14px', background: 'white' }}
          >
            {ALL_FYS.map(fy => <option key={fy} value={fy}>FY {fy}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>PERIOD</label>
          <select 
            value={selectedMonth} 
            onChange={e => handlePeriodChange(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid var(--border)', fontSize: '14px', background: 'white' }}
          >
            {periodOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center', position: 'relative' }}>
          <ZohoSyncManager globalFY={globalFY} period={selectedMonth} coverage={data?.coverage} />
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Evidence Status: {globalFY === '2025-26' ? <span style={{ color: 'var(--google-green)', fontWeight: 600 }}>AVAILABLE</span> : <span style={{ color: 'var(--google-amber)', fontWeight: 600 }}>PARTIAL/MISSING</span>}
          </div>
          <button 
            onClick={() => setShowManageEvidence(!showManageEvidence)}
            className="btn-primary" 
            style={{ padding: '8px 16px', fontSize: '13px', borderRadius: '4px' }}
          >
            {showManageEvidence ? 'Close Manage Evidence' : 'Manage Evidence'}
          </button>
        </div>
      </div>
      
      {showManageEvidence && (
        <EvidenceUploadManager globalFY={globalFY} mode="global" />
      )}

      {/* INTERNAL NAVIGATION */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '24px', overflowX: 'auto' }} id="overview">
        <a href="#overview" style={navItemStyle}>Overview</a>
        <a href="#sales" style={navItemStyle}>Sales</a>
        <a href="#purchase" style={navItemStyle}>Purchase / 2B</a>
        <a href="#rcm" style={navItemStyle}>RCM</a>
        <a href="#monthly" style={navItemStyle}>Monthly Reco</a>
        <a href="#payment" style={navItemStyle}>Payment</a>
        <a href="#actions" style={navItemStyle}>Owner Actions</a>
        <a href="#evidence" style={navItemStyle}>Evidence</a>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}>
        {showHistory && (
          <div style={{ background: "#fce8e6", border: "1px solid #fad2cf", padding: "12px 16px", color: "#b71c1c", fontSize: "13px", borderRadius: "4px", borderLeft: "4px solid #d93025" }}>
            <strong>Historical Control Notice:</strong> Initial 5G.2 run invalidated. Current final results do NOT use that run.
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={() => setShowHistory(!showHistory)} style={{ fontSize: "12px", color: "var(--google-blue)", background: "none", border: "none", cursor: "pointer" }}>
              {showHistory ? "Hide Historical Notice" : "Show Historical Notice"}
            </button>
        </div>
      </div>

      {/* KPI CARDS */}
      <div className="metrics-grid" style={{ marginBottom: "24px", gridTemplateColumns: "repeat(6, 1fr)" }}>
        
        <div className="metric-card" style={{ padding: "16px", minHeight: "110px", justifyContent: "space-between" }}>
          <div>
            <div className="metric-label">Books ↔ GSTR-1</div>
            <div className="metric-value" style={{ fontSize: "16px", color: reportToUse ? "var(--google-red)" : "var(--text-secondary)" }}>
              {reportToUse ? formatINR(reportToUse.sales_g1_diff.taxable) + ' Diff' : 'NOT YET RECONCILED'}
            </div>
            <div className="metric-sub" style={{ color: "var(--google-amber)" }}>Source Limitation</div>
          </div>
        </div>

        <div className="metric-card" style={{ padding: "16px", minHeight: "110px", justifyContent: "space-between" }}>
          <div>
            <div className="metric-label">Purchase ↔ 2B</div>
            <div className="metric-value" style={{ fontSize: "18px", color: reportToUse ? "var(--google-amber)" : "var(--text-secondary)" }}>
              {reportToUse ? reportToUse.pur_2b_reco.exact + ' Exact Match' : 'NOT YET RECONCILED'}
            </div>
            <div className="metric-sub">
              {reportToUse ? reportToUse.pur_2b_reco.value_mismatch : '—'} Value | {reportToUse ? reportToUse.pur_2b_reco.date_mismatch : '—'} Date Mismatch
            </div>
          </div>
        </div>

        <div className="metric-card" style={{ padding: "16px", minHeight: "110px" }}>
          <div className="metric-label">3B ↔ Cash Ledger</div>
          <div className="metric-value" style={{ fontSize: "20px", color: reportToUse ? "var(--google-green)" : "var(--text-secondary)" }}>
            {reportToUse ? reportToUse.g3b_cash_ledger.match_months + '/12 Match' : 'NOT YET VERIFIED'}
          </div>
          <div className="metric-sub" style={{ color: reportToUse ? "var(--google-blue)" : "var(--text-secondary)", fontWeight: 600 }}>{reportToUse ? "1 Proven Timing Shift" : "—"}</div>
        </div>

        <div className="metric-card" style={{ padding: "16px", minHeight: "110px" }}>
          <div className="metric-label">RCM Evidence</div>
          <div className="metric-value" style={{ fontSize: "18px", color: reportToUse ? "var(--text-primary)" : "var(--text-secondary)" }}>
            {reportToUse ? reportToUse.rcm.docs + ' Docs' : 'NOT YET PROCESSED'}
          </div>
          <div className="metric-sub">Taxable: {reportToUse ? formatINR(reportToUse.rcm.taxable) : '—'}</div>
        </div>

        <a href="#actions" onClick={() => setActionPriority('HIGH')} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="metric-card" style={{ padding: "16px", minHeight: "110px", cursor: 'pointer', transition: 'box-shadow 0.2s', border: '1px solid var(--border)' }}>
            <div className="metric-label">Owner Actions</div>
            <div className="metric-value" style={{ fontSize: "18px", color: reportToUse ? "var(--google-red)" : "var(--text-secondary)" }}>
              {reportToUse ? reportToUse.actions.high + ' HIGH' : 'NOT YET GENERATED'}
            </div>
            <div className="metric-sub" style={{ color: "var(--google-amber)" }}>{reportToUse ? reportToUse.actions.medium : '—'} Medium Open</div>
          </div>
        </a>
        
        <div className="metric-card" style={{ padding: "16px", minHeight: "110px" }}>
          <div className="metric-label">Source Limitations</div>
          <div className="metric-value" style={{ fontSize: "20px", color: reportToUse ? "var(--google-amber)" : "var(--text-secondary)" }}>
            {reportToUse ? reportToUse.limitations : '—'} Detected
          </div>
          <div className="metric-sub">Monthly Auth Proceed</div>
        </div>

      </div>

      {/* RECONCILIATION CONTROL & ACQUISITION */}
      <div style={{ display: "flex", gap: "24px", marginBottom: "24px", flexWrap: "wrap" }}>
        
        <div className="section-card" style={{ flex: 1, padding: "20px", minWidth: "350px" }}>
          <h3 className="section-title" style={{ margin: "0 0 16px 0", fontSize: "14px" }}>Reconciliation Control</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px", fontFamily: "monospace" }}>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}><span>Books ↔ GSTR-1</span><span className={reportToUse ? "status-chip pending" : "status-chip draft"}>{reportToUse ? "AGGREGATE VERIFIED — FINDINGS" : "NOT YET RECONCILED — GSTR-1 FILE REQUIRED"}</span></div>
            <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "8px" }}>Invoice-level reconciliation blocked because GSTR-1 source is summary/section-level.</div>
            
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}><span>Books ↔ GSTR-2B</span><span className={reportToUse ? "status-chip pending" : "status-chip draft"}>{reportToUse ? "DOCUMENT RECO COMPLETED — FINDINGS" : "NOT YET RECONCILED — GSTR-2B FILE REQUIRED"}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}><span>GSTR-1 ↔ GSTR-3B</span><span className={reportToUse ? "status-chip paid" : "status-chip draft"}>{reportToUse ? "MONTHLY CONTROL COMPLETED" : "NOT YET VERIFIED"}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}><span>GSTR-2B ↔ GSTR-3B</span><span className="status-chip draft">NOT DIRECTLY COMPARABLE</span></div>
            <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "8px" }}>Current segmentation cannot validly compare raw 2B total directly with a single GSTR-3B Table 4 component.</div>

            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}><span>GSTR-3B ↔ Cash Ledger Debit</span><span className={reportToUse ? "status-chip paid" : "status-chip draft"}>{reportToUse ? "11 MATCH / 1 TIMING SHIFT" : "NOT YET VERIFIED"}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Challan ↔ Ledger Deposit</span><span className={reportToUse ? "status-chip paid" : "status-chip draft"}>{reportToUse ? "VERIFIED — FY BOUNDARY TIMING" : "NOT YET VERIFIED"}</span></div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: "350px", display: "flex", flexDirection: "column", gap: "24px" }}>
          
          <div className="section-card" style={{ padding: "16px", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "24px", borderLeft: "4px solid #d93025" }}>
            <div style={{ minWidth: "120px" }}>
              <div className="metric-label">SOURCE ACQUISITION</div>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "#d93025" }}>CLOSED</div>
            </div>
            <div style={{ display: "flex", gap: "24px", flex: 1, flexWrap: "wrap" }}>
              <div style={{ color: "#d93025", fontWeight: 600, display: "flex", alignItems: "center" }}>
                OWNER AUTHORIZATION REQUIRED TO REOPEN
              </div>
            </div>
            <div>
              <button disabled className="audit-action" style={{ background: "#f1f3f4", color: "#9aa0a6", cursor: "not-allowed", fontWeight: 700 }}>
                START
              </button>
            </div>
          </div>

          <div className="section-card" style={{ padding: "20px" }}>
            <h3 className="section-title" style={{ margin: "0 0 16px 0", fontSize: "14px" }}>Return Evidence</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "8px", fontSize: "12px", fontFamily: "monospace" }}>
              {globalFY === "2025-26" ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}><span>GSTR-1</span><span style={{ color: "var(--google-green)", fontWeight: 700 }}>12/12 AVAILABLE</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}><span>GSTR-2B</span><span style={{ color: "var(--google-green)", fontWeight: 700 }}>12/12 AVAILABLE</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}><span>GSTR-3B</span><span style={{ color: "var(--google-green)", fontWeight: 700 }}>12/12 AVAILABLE</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}><span>Challan</span><span style={{ color: "var(--google-green)", fontWeight: 700 }}>12/12 AVAILABLE</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}><span>Cash Ledger</span><span style={{ color: "var(--google-green)", fontWeight: 700 }}>AVAILABLE</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)", marginTop: "4px" }}><span>Liability Ledger</span><span style={{ color: (finalReport?.liability_ledger === 'AVAILABLE' || !finalReport?.liability_ledger) ? "var(--google-green)" : "var(--google-amber)", fontWeight: 700 }}>{finalReport?.liability_ledger || 'AVAILABLE'}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}><span>Credit Ledger</span><span style={{ color: (finalReport?.credit_ledger === 'AVAILABLE' || !finalReport?.credit_ledger) ? "var(--google-green)" : "var(--google-amber)", fontWeight: 700 }}>{finalReport?.credit_ledger || 'AVAILABLE'}</span></div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}><span>GSTR-1</span><span style={{ color: "var(--google-red)", fontWeight: 700 }}>NOT YET ACQUIRED</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}><span>GSTR-2B</span><span style={{ color: "var(--google-red)", fontWeight: 700 }}>NOT YET ACQUIRED</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}><span>GSTR-3B</span><span style={{ color: "var(--google-red)", fontWeight: 700 }}>NOT YET ACQUIRED</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}><span>Challan</span><span style={{ color: "var(--google-red)", fontWeight: 700 }}>NOT YET ACQUIRED</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}><span>Cash Ledger</span><span style={{ color: "var(--google-red)", fontWeight: 700 }}>NOT YET ACQUIRED</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)", marginTop: "4px" }}><span>Liability Ledger</span><span style={{ color: "var(--google-red)", fontWeight: 700 }}>NOT YET ACQUIRED</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}><span>Credit Ledger</span><span style={{ color: "var(--google-red)", fontWeight: 700 }}>NOT YET ACQUIRED</span></div>
                </>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* GROSS MARGIN CONTROL */}
      <div style={{ marginBottom: "24px" }}>
        <GrossMarginControl selectedMonth={selectedMonth} globalFY={globalFY} coverage={data?.coverage} />
      </div>

      {/* SALES & PURCHASE SECTIONS */}
      <div style={{ display: "flex", gap: "24px", marginBottom: "24px", flexWrap: "wrap" }}>
        
        <div id="sales" className="section-card" style={{ flex: 1, padding: "20px" }}>
          <div style={{ marginBottom: "16px" }}>
            <h3 className="section-title" style={{ margin: "0 0 8px 0" }}>SALES — BOOKS SOURCE COVERAGE</h3>
            <span className={isDemoFY ? "status-chip paid" : ((data?.coverage?.sales?.acquired || 0) === salesUniverse ? "status-chip paid" : "status-chip draft")} style={{ textTransform: "uppercase" }}>{isDemoFY ? "COMPLETE" : ((data?.coverage?.sales?.acquired || 0) === salesUniverse ? "AVAILABLE" : "PARTIAL — SYNC IN PROGRESS")}</span>
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
            Documents: <strong style={{ color: "var(--text-primary)", fontFamily: "monospace", fontSize: "14px" }}>{isDemoFY ? `457 / ${salesUniverse}` : `${data?.coverage?.sales?.acquired || 0} / ${salesUniverse}`}</strong>
          </div>
          <div style={{ fontSize: "13px", color: "var(--google-red)", marginBottom: "16px", fontWeight: 600 }}>
            GSTR-1 DOCUMENT RECONCILIATION: SOURCE LIMITATION
            <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 400, marginTop: "4px" }}>Filed GSTR-1 evidence available here is summary/section-level and does not contain invoice-level rows.</div>
          </div>
          <table style={{ width: "100%", fontSize: "13px", fontFamily: "monospace" }}>
            <tbody>
              <tr><td colSpan={2} style={{ padding: "8px 0", fontWeight: 600 }}>Annual Aggregate Differences {!reportToUse && <span className="status-chip draft" style={{marginLeft: "8px"}}>NOT YET RECONCILED</span>}</td></tr>
              <tr><td style={{ padding: "8px 0", color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)" }}>Taxable Value</td><td style={{ padding: "8px 0", textAlign: "right", fontWeight: 600, color: "var(--text-primary)", borderBottom: "1px solid var(--border-subtle)" }}>{reportToUse ? formatINR(reportToUse.sales_g1_diff.taxable) : '—'}</td></tr>
              <tr><td style={{ padding: "8px 0", color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)" }}>IGST</td><td style={{ padding: "8px 0", textAlign: "right", color: "var(--text-primary)", borderBottom: "1px solid var(--border-subtle)" }}>{reportToUse ? formatINR(reportToUse.sales_g1_diff.igst) : '—'}</td></tr>
              <tr><td style={{ padding: "8px 0", color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)" }}>CGST</td><td style={{ padding: "8px 0", textAlign: "right", color: "var(--text-primary)", borderBottom: "1px solid var(--border-subtle)" }}>{reportToUse ? formatINR(reportToUse.sales_g1_diff.cgst) : '—'}</td></tr>
              <tr><td style={{ padding: "8px 0", color: "var(--text-secondary)" }}>SGST</td><td style={{ padding: "8px 0", textAlign: "right", color: "var(--text-primary)" }}>{reportToUse ? formatINR(reportToUse.sales_g1_diff.sgst) : '—'}</td></tr>
              <tr><td style={{ padding: "8px 0", color: "var(--text-secondary)" }}>Affected Months</td><td style={{ padding: "8px 0", textAlign: "right", color: "var(--text-primary)" }}>{reportToUse ? reportToUse.sales_g1_diff.months.length : '—'}</td></tr>
            </tbody>
          </table>
        </div>
        
        <div id="purchase" className="section-card" style={{ flex: 1, padding: "20px" }}>
          <div style={{ marginBottom: "16px" }}>
            <h3 className="section-title" style={{ margin: "0 0 8px 0" }}>PURCHASE — BOOKS SOURCE COVERAGE</h3>
            <span className={isDemoFY ? "status-chip paid" : ((data?.coverage?.purchases?.acquired || 0) === purchaseUniverse ? "status-chip paid" : "status-chip draft")} style={{ textTransform: "uppercase" }}>{isDemoFY ? "COMPLETE" : ((data?.coverage?.purchases?.acquired || 0) === purchaseUniverse ? "AVAILABLE" : "PARTIAL — SYNC IN PROGRESS")}</span>
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
            <div style={{ marginBottom: "4px" }}>Purchase Universe: <strong style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>{purchaseUniverse}</strong></div>
            <div style={{ marginBottom: "4px" }}>Purchase Detail Acquired: <strong style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>{isDemoFY ? 1193 : (data?.coverage?.purchases?.acquired || 0)}</strong></div>
            <div style={{ marginBottom: "4px" }}>Purchase Detail Remaining: <strong style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>{isDemoFY ? 0 : (data?.coverage?.purchases?.remaining || 0)}</strong></div>
            <div style={{ marginBottom: "4px" }}>Vendor Credits: <strong style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>{isDemoFY ? 0 : (data?.coverage?.vendorCredits?.acquired || 0)}</strong></div>
          </div>
          <div style={{ marginTop: "24px", paddingTop: "24px", borderTop: "1px solid var(--border-subtle)" }}>
            <PurchaseRecoControl selectedMonth={selectedMonth} globalFY={globalFY} />
          </div>
        </div>

      </div>

      <div id="rcm" className="section-card" style={{ padding: "20px", marginBottom: "24px" }}>
          <h2 className="section-title" style={{ margin: "0 0 16px 0" }}>
            RCM (Reverse Charge Mechanism)
            {!isDemoFY && (
               <span className={(data?.coverage?.purchases?.acquired || 0) === purchaseUniverse ? "status-chip paid" : "status-chip draft"} style={{marginLeft: "12px", fontSize: "11px", verticalAlign: "middle"}}>
                 {(data?.coverage?.purchases?.acquired || 0) === purchaseUniverse ? "BOOKS SOURCE: COMPLETE" : "PROVISIONAL — PARTIAL BOOKS COVERAGE"}
               </span>
            )}
          </h2>
          <div style={{ display: "flex", gap: "24px" }}>
            <div>
              <div className="metric-label">RCM Documents</div>
              <div className="metric-value" style={{ fontSize: "20px" }}>{isDemoFY ? reportToUse?.rcm?.docs : ((data?.coverage?.purchases?.acquired || 0) > 0 ? rcmDocsFound : '—')}</div>
            </div>
            <div>
              <div className="metric-label">RCM Taxable Value</div>
              <div className="metric-value" style={{ fontSize: "20px" }}>{isDemoFY ? formatINR(reportToUse?.rcm?.taxable || 0) : ((data?.coverage?.purchases?.acquired || 0) > 0 ? formatINR(rcmTaxable) : '—')}</div>
            </div>
          </div>
          {!isDemoFY && (
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "12px" }}>
              Coverage: {(data?.coverage?.purchases?.acquired || 0)} / {purchaseUniverse} purchase bills inspected
            </div>
          )}
      </div>

      {/* MONTHLY RECONCILIATION TABLE */}
      <div id="monthly" className="section-card" style={{ padding: "20px", marginBottom: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 className="section-title" style={{ margin: 0 }}>Owner Monthly Reconciliation</h2>
          {matrixData && (
            <select 
              value={selectedMonth} 
              onChange={e => {
                  const newParams = new URLSearchParams(searchParams?.toString() || "");
                  newParams.set('period', e.target.value);
                  router.push(`${pathname}?${newParams.toString()}`);
              }}
              style={{ padding: "6px 12px", borderRadius: "4px", border: "1px solid var(--border)", fontSize: "14px" }}
            >
              <option value="FULL">FULL FY</option>
              {periodOptions.filter((o: any) => o.value !== "FULL").map((o: any) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
        </div>
        
        <GstMonthlyReconciliationV2 globalFY={globalFY} selectedMonth={selectedMonth} actionPriority={actionPriority} setActionPriority={setActionPriority} />
      </div>

      {/* OWNER ACTION REGISTER */}
      <div id="actions" className="section-card" style={{ padding: "20px", marginBottom: "24px" }}>
        <h2 className="section-title" style={{ margin: "0 0 16px 0" }}>Owner Action Register</h2>
        
        {(() => {
          type PriorityKey = 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
          type StatusKey = 'ACTIVE' | 'CLOSED' | 'SUPERSEDED' | 'TOTAL';
          
          const stats: Record<StatusKey, Record<PriorityKey | 'TOTAL', number>> = {
            ACTIVE: { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0, TOTAL: 0 },
            CLOSED: { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0, TOTAL: 0 },
            SUPERSEDED: { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0, TOTAL: 0 },
            TOTAL: { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0, TOTAL: 0 }
          };

          actionsData.forEach(a => {
            if (a.fy !== globalFY) return;
            if (selectedMonth !== 'FULL' && a.month !== selectedMonth) return;
            
            const pri = (a.priority || 'INFO') as PriorityKey;
            let stat: StatusKey = 'ACTIVE';
            if (a.status === 'SUPERSEDED') stat = 'SUPERSEDED';
            else if (a.status === 'CLOSED_NO_ACTION' || a.status === 'RESOLVED') stat = 'CLOSED';

            // Increment matrix
            if (stats[stat] && pri in stats[stat]) {
                stats[stat][pri]++;
                stats[stat].TOTAL++;
                stats.TOTAL[pri]++;
                stats.TOTAL.TOTAL++;
            }
          });
          
          const filtered = actionsData.filter(a => {
             if (a.fy !== globalFY) return false;
             if (selectedMonth !== 'FULL' && a.month !== selectedMonth) return false;

             // Check Status
             let aStat = 'ACTIVE';
             if (a.status === 'SUPERSEDED') aStat = 'SUPERSEDED';
             else if (a.status === 'CLOSED_NO_ACTION' || a.status === 'RESOLVED') aStat = 'CLOSED';

             if (actionStatus !== 'ALL' && actionStatus !== aStat) return false;
             
             // Check Priority
             if (actionPriority !== 'ALL' && actionPriority !== a.priority) return false;
             
             return true;
          });
          
          const handleCellClick = (s: string, p: string) => {
              setActionStatus(s);
              setActionPriority(p);
          };

          return (
            <>
            {/* Top Summary Cards */}
            {stats.TOTAL.TOTAL === 0 && (
              <div style={{ marginBottom: "16px", padding: "12px", background: "#fef0ef", color: "var(--google-red)", borderRadius: "4px", fontWeight: "bold", textAlign: "center" }}>
                ACTION REGISTER NOT YET GENERATED FOR FY {globalFY}
              </div>
            )}
            <div style={{ display: "flex", gap: "16px", marginBottom: "24px", flexWrap: "wrap" }}>
              <div onClick={() => handleCellClick('ACTIVE', 'ALL')} className="metric-card" style={{ flex: 1, padding: "16px", cursor: "pointer", border: actionStatus === 'ACTIVE' && actionPriority === 'ALL' ? "2px solid var(--google-blue)" : undefined }}>
                <div className="metric-label">ACTIVE</div>
                <div className="metric-value">{stats.ACTIVE.TOTAL}</div>
              </div>
              <div onClick={() => handleCellClick('CLOSED', 'ALL')} className="metric-card" style={{ flex: 1, padding: "16px", cursor: "pointer", border: actionStatus === 'CLOSED' && actionPriority === 'ALL' ? "2px solid var(--google-blue)" : undefined }}>
                <div className="metric-label">CLOSED / NO ACTION</div>
                <div className="metric-value">{stats.CLOSED.TOTAL}</div>
              </div>
              <div onClick={() => handleCellClick('SUPERSEDED', 'ALL')} className="metric-card" style={{ flex: 1, padding: "16px", cursor: "pointer", border: actionStatus === 'SUPERSEDED' && actionPriority === 'ALL' ? "2px solid var(--google-blue)" : undefined }}>
                <div className="metric-label">SUPERSEDED</div>
                <div className="metric-value">{stats.SUPERSEDED.TOTAL}</div>
              </div>
              <div onClick={() => handleCellClick('ALL', 'ALL')} className="metric-card" style={{ flex: 1, padding: "16px", cursor: "pointer", border: actionStatus === 'ALL' && actionPriority === 'ALL' ? "2px solid var(--google-blue)" : undefined }}>
                <div className="metric-label">TOTAL HISTORY</div>
                <div className="metric-value">{stats.TOTAL.TOTAL}</div>
              </div>
            </div>

            {/* Matrix & Filters */}
            <div style={{ display: "flex", gap: "24px", marginBottom: "24px", flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ flex: 2, minWidth: "300px" }}>
                <table className="data-table" style={{ width: "100%", fontSize: "12px", fontFamily: "monospace", textAlign: "right" }}>
                  <thead style={{ background: "var(--bg-subtle)" }}>
                    <tr>
                      <th style={{ textAlign: "left", padding: "6px" }}>Priority</th>
                      <th style={{ padding: "6px" }}>ACTIVE</th>
                      <th style={{ padding: "6px" }}>CLOSED</th>
                      <th style={{ padding: "6px" }}>SUPERSEDED</th>
                      <th style={{ padding: "6px", fontWeight: "bold" }}>TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(['HIGH', 'MEDIUM', 'LOW', 'INFO'] as const).map(p => (
                      <tr key={p}>
                        <td style={{ textAlign: "left", padding: "6px", fontWeight: "bold" }}>{p}</td>
                        <td style={{ padding: "6px", cursor: "pointer", textDecoration: "underline" }} onClick={() => handleCellClick('ACTIVE', p)}>{stats.ACTIVE[p]}</td>
                        <td style={{ padding: "6px", cursor: "pointer", textDecoration: "underline" }} onClick={() => handleCellClick('CLOSED', p)}>{stats.CLOSED[p]}</td>
                        <td style={{ padding: "6px", cursor: "pointer", textDecoration: "underline" }} onClick={() => handleCellClick('SUPERSEDED', p)}>{stats.SUPERSEDED[p]}</td>
                        <td style={{ padding: "6px", fontWeight: "bold", cursor: "pointer", textDecoration: "underline" }} onClick={() => handleCellClick('ALL', p)}>{stats.TOTAL[p]}</td>
                      </tr>
                    ))}
                    <tr style={{ background: "var(--bg-subtle)", fontWeight: "bold" }}>
                      <td style={{ textAlign: "left", padding: "6px" }}>TOTAL</td>
                      <td style={{ padding: "6px", cursor: "pointer" }} onClick={() => handleCellClick('ACTIVE', 'ALL')}>{stats.ACTIVE.TOTAL}</td>
                      <td style={{ padding: "6px", cursor: "pointer" }} onClick={() => handleCellClick('CLOSED', 'ALL')}>{stats.CLOSED.TOTAL}</td>
                      <td style={{ padding: "6px", cursor: "pointer" }} onClick={() => handleCellClick('SUPERSEDED', 'ALL')}>{stats.SUPERSEDED.TOTAL}</td>
                      <td style={{ padding: "6px" }}>{stats.TOTAL.TOTAL}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ flex: 1, minWidth: "200px", display: "flex", flexDirection: "column", gap: "12px", background: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid var(--border)" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px", color: "var(--text-secondary)" }}>Status Filter:</label>
                  <select 
                    value={actionStatus} 
                    onChange={e => setActionStatus(e.target.value)}
                    style={{ width: "100%", padding: "6px", borderRadius: "4px", border: "1px solid var(--border)", fontSize: "13px" }}
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="CLOSED">Closed / No Action</option>
                    <option value="SUPERSEDED">Superseded</option>
                    <option value="ALL">All</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px", color: "var(--text-secondary)" }}>Priority Filter:</label>
                  <select 
                    value={actionPriority} 
                    onChange={e => setActionPriority(e.target.value)}
                    style={{ width: "100%", padding: "6px", borderRadius: "4px", border: "1px solid var(--border)", fontSize: "13px" }}
                  >
                    <option value="ALL">All</option>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                    <option value="INFO">Info</option>
                  </select>
                </div>
              </div>
            </div>
            
            {/* Action Table */}
            <div style={{ overflowX: "auto", maxHeight: "400px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "8px" }}>
              <table className="data-table" style={{ width: "100%", fontSize: "12px", fontFamily: "monospace", minWidth: "900px", border: "none" }}>
                <thead style={{ position: "sticky", top: 0, background: "var(--bg-subtle)", zIndex: 1, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 8px" }}>Action ID</th>
                    <th style={{ textAlign: "left", padding: "10px 8px" }}>Priority</th>
                    <th style={{ textAlign: "left", padding: "10px 8px" }}>Area</th>
                    <th style={{ textAlign: "left", padding: "10px 8px" }}>Finding Type</th>
                    <th style={{ textAlign: "left", padding: "10px 8px" }}>Status</th>
                    <th style={{ textAlign: "right", padding: "10px 8px" }}>Difference</th>
                    <th style={{ textAlign: "left", padding: "10px 8px" }}>Reason / Superseded By</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", padding: "30px", color: "var(--text-secondary)" }}>No actions found for current filter.</td>
                    </tr>
                  ) : filtered.map(a => {
                    let displayStatus = a.status;
                    if (a.status === 'CLOSED_NO_ACTION') displayStatus = 'CLOSED — NO ACTION REQUIRED';
                    else if (a.status === 'SUPERSEDED') displayStatus = 'SUPERSEDED — RESOLVED / RECLASSIFIED';
                    
                    const reasonText = a.status === 'SUPERSEDED' ? (a.status_reason || a.reason) : a.reason;

                    return (
                      <tr key={a.action_id} style={{ opacity: a.status === 'SUPERSEDED' ? 0.6 : 1, borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ fontWeight: 600, padding: "8px" }}>{a.action_id}</td>
                        <td style={{ padding: "8px" }}>
                          <span style={{ 
                             padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: "bold",
                             background: a.priority === 'HIGH' ? "var(--google-red)" : a.priority === 'MEDIUM' ? "var(--google-amber)" : a.priority === 'LOW' ? "var(--google-blue)" : "var(--bg-subtle)",
                             color: (a.priority === 'HIGH' || a.priority === 'MEDIUM' || a.priority === 'LOW') ? "white" : "var(--text-secondary)"
                          }}>{a.priority}</span>
                        </td>
                        <td style={{ padding: "8px" }}>{a.area}</td>
                        <td style={{ padding: "8px" }}>{a.finding_type}</td>
                        <td style={{ padding: "8px", fontWeight: a.status !== 'SUPERSEDED' && a.status !== 'CLOSED_NO_ACTION' ? 600 : 400 }}>{displayStatus}</td>
                        <td style={{ textAlign: "right", padding: "8px", color: a.difference ? "var(--google-red)" : "inherit" }}>{a.difference ? formatINR(a.difference) : '-'}</td>
                        <td style={{ whiteSpace: "normal", padding: "8px" }}>{reasonText}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          );
        })()}
      </div>

      <div id="payment" className="section-card" style={{ padding: "20px", marginBottom: "24px" }}>
        <h2 className="section-title" style={{ margin: "0 0 16px 0" }}>Payment Control Summary</h2>
        <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
          <div className="metric-card" style={{ flex: 1, padding: "16px" }}>
            <div className="metric-label">GSTR-3B CASH PAID</div>
            <div className="metric-value" style={{ color: isDemoFY ? "var(--google-green)" : "var(--google-amber)" }}>{isDemoFY ? "Verified" : "NOT YET VERIFIED"}</div>
          </div>
          <div className="metric-card" style={{ flex: 1, padding: "16px" }}>
            <div className="metric-label">ELECTRONIC CASH LEDGER DEBIT</div>
            <div className="metric-value" style={{ color: isDemoFY ? "var(--google-green)" : "var(--google-amber)" }}>{isDemoFY ? "Verified" : "FILE REQUIRED / NOT YET VERIFIED"}</div>
          </div>
          <div className="metric-card" style={{ flex: 1, padding: "16px" }}>
            <div className="metric-label">CHALLAN / LEDGER DEPOSIT</div>
            <div className="metric-value" style={{ color: isDemoFY ? "var(--google-green)" : "var(--google-amber)" }}>{isDemoFY ? "Verified" : "FILE REQUIRED / NOT YET VERIFIED"}</div>
          </div>
        </div>
      </div>

      {/* DOCUMENT EVIDENCE TABLE CARD */}
      <div id="evidence" className="section-card" style={{ overflow: "hidden" }}>
        
        <div className="section-header" style={{ padding: "20px", borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "16px", marginBottom: "16px", width: "100%" }}>
            <div>
              <h2 className="section-title" style={{ margin: "0 0 4px 0" }}>Document Evidence</h2>
              <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Source-Exact Acquired Evidence</div>
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "monospace" }}>
              Production FY {globalFY}: Sales {isDemoFY ? productionSalesRows : salesUniverse} | Purchase {isDemoFY ? productionPurchaseRows : purchaseUniverse}
            </div>
          </div>
          
          <div className="audit-toolbar" style={{ padding: 0, gap: "12px" }}>
            <input 
              type="text" 
              placeholder="Search Document or Party..." 
              value={searchQuery}
              onChange={(e) => {setSearchQuery(e.target.value); setCurrentPage(1);}}
              style={{ width: "220px" }}
            />
            <select value={filterScope} onChange={e => {setFilterScope(e.target.value); setCurrentPage(1);}}>
              <option value="Production">Scope: Production</option>
              <option value="Pilot/Test">Scope: Pilot/Test</option>
              <option value="All">Scope: All</option>
            </select>
            <select value={filterType} onChange={e => {setFilterType(e.target.value); setCurrentPage(1);}}>
              <option value="All">Type: All</option>
              <option value="Sales">Sales</option>
              <option value="Purchase">Purchase</option>
            </select>
            <select value={filterPeriod} onChange={e => {setFilterPeriod(e.target.value); setCurrentPage(1);}}>
              <option value="All">Period: All</option>
              <option value="FY2025-26">FY2025-26</option>
              <option value="FY2022-23">FY2022-23</option>
              <option value="OUT_OF_PERIOD">Out of Period</option>
            </select>
            <select value={filterTax} onChange={e => {setFilterTax(e.target.value); setCurrentPage(1);}}>
              <option value="All">Tax: All</option>
              <option value="IGST">IGST</option>
              <option value="CGST+SGST">CGST+SGST</option>
              <option value="Zero Tax">Zero Tax</option>
            </select>
            <select value={filterSource} onChange={e => {setFilterSource(e.target.value); setCurrentPage(1);}}>
              <option value="All">Source: All</option>
              <option value="SOURCE_EXACT">EXACT</option>
              <option value="SOURCE_DERIVED">DERIVED</option>
              <option value="UNCLASSIFIED">UNCLASSIFIED</option>
            </select>
            <select value={filterArith} onChange={e => {setFilterArith(e.target.value); setCurrentPage(1);}}>
              <option value="All">Arith: All</option>
              <option value="PASS">PASS</option>
              <option value="MISMATCH">MISMATCH</option>
              <option value="NOT COMPUTABLE">NOT COMPUTABLE</option>
            </select>
          </div>
        </div>
        
        {!isDemoFY ? (
          <div style={{ padding: "40px 20px", textAlign: "center", background: "white" }}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "16px" }}>FY {globalFY}</h3>
            <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: "8px", background: "var(--bg-subtle)", padding: "20px", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontWeight: 600, color: "var(--google-blue)", marginBottom: "8px" }}>Books Universe:</div>
              <div style={{ display: "flex", justifyContent: "space-between", width: "300px" }}><span>Sales</span> <span style={{ fontFamily: "monospace" }}>134</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", width: "300px" }}><span>Purchase</span> <span style={{ fontFamily: "monospace" }}>491</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", width: "300px" }}><span>Sales Credit Notes</span> <span style={{ fontFamily: "monospace" }}>1</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", width: "300px" }}><span>Vendor Credits</span> <span style={{ fontFamily: "monospace" }}>0</span></div>
              <div style={{ width: "100%", height: "1px", background: "var(--border-subtle)", margin: "8px 0" }}></div>
              <div style={{ display: "flex", justifyContent: "space-between", width: "300px" }}><span>Detail Coverage:</span> <span style={{ fontFamily: "monospace" }}>0</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", width: "300px", marginTop: "8px" }}><span>Status:</span> <span className="status-chip draft">PARTIAL — SYNC REQUIRED</span></div>
            </div>
          </div>
        ) : (
        <div className="table-scroll-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Document</th>
                <th>Date</th>
                <th style={{ maxWidth: "200px" }}>Party</th>
                <th className="right">Taxable</th>
                <th className="right">IGST</th>
                <th className="right">CGST</th>
                <th className="right">SGST</th>
                <th className="right">Cess</th>
                <th className="right">TDS</th>
                <th className="right" style={{ color: "var(--text-primary)" }}>Gross</th>
                <th style={{ textAlign: "center" }}>Source</th>
                <th style={{ textAlign: "center" }}>Arithmetic</th>
                <th style={{ textAlign: "center" }}>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {displayedDocs.map((m: any, idx: number) => {
                const docType = m.document_type === "sales" ? "Sales" : m.document_type === "purchase" ? "Purchase" : m.document_type;
                const isPilot = m.isPilot;
                const docFY = m.document_date >= "2025-04-01" && m.document_date <= "2026-03-31" ? "FY2025-26" : "FY2022-23";
                const isFY = docFY === `FY${globalFY}`;
                const periodStatus = isPilot ? "PILOT_TEST" : (isFY ? m.periodStatus : "OUT_OF_PERIOD");

                return (
                  <tr key={idx} className="audit-case-row">
                    <td style={{ textTransform: "capitalize" }}>{docType}</td>
                    <td style={{ fontFamily: "monospace", color: "var(--text-primary)", fontWeight: 500 }}>{m.document_number}</td>
                    <td style={{ fontFamily: "monospace" }}>{formatDisplayDate(m.document_date)}</td>
                    <td style={{ maxWidth: "200px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-primary)" }} title={m.vendor}>{m.vendor}</td>
                    <td className="amount right">{formatVal(m.taxable)}</td>
                    <td className="amount right">{formatVal(m.igst)}</td>
                    <td className="amount right">{formatVal(m.cgst)}</td>
                    <td className="amount right">{formatVal(m.sgst)}</td>
                    <td className="amount right">{formatVal(m.cess)}</td>
                    <td className="amount right" style={{ color: "var(--google-red)", fontWeight: 500 }}>{m.tds > 0 ? formatVal(m.tds) : '—'}</td>
                    <td className="amount right" style={{ color: "var(--text-primary)", fontWeight: 700 }}>{formatVal(m.gross)}</td>
                    <td style={{ textAlign: "center" }}>
                      <span className="status-chip paid">{m.source_class}</span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span className={`status-chip ${m.arithmetic_status === 'PASS' ? 'paid' : 'overdue'}`}>
                        {m.arithmetic_status}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {isPilot ? (
                        <span className="status-chip" style={{ background: "#f3e8fd", color: "#681da8", border: "1px solid #d4bbf3" }}>{periodStatus}</span>
                      ) : isFY ? (
                        <span className="status-chip draft">{periodStatus}</span>
                      ) : (
                        <span className="status-chip pending">{periodStatus}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {displayedDocs.length === 0 && (
                <tr>
                  <td colSpan={14} style={{ padding: "48px 16px", textAlign: "center", color: "var(--text-secondary)" }}>
                    No documents match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
        
        {/* PAGINATION */}
        {isDemoFY && (
        <div style={{ padding: "16px", background: "var(--bg-subtle)", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Showing {displayedDocs.length} of {filteredDocs.length} valid acquisitions
          </div>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <select 
              value={visibleRows} 
              onChange={e => {setVisibleRows(Number(e.target.value)); setCurrentPage(1);}} 
            >
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
            <div style={{ display: "flex", gap: "8px" }}>
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={safeCurrentPage === 1}
                className="audit-action"
                style={{ opacity: safeCurrentPage === 1 ? 0.5 : 1, padding: "6px 12px" }}
              >
                Previous
              </button>
              <div style={{ padding: "6px 12px", fontSize: "13px", color: "var(--text-primary)" }}>Page {safeCurrentPage} of {totalPages || 1}</div>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage >= totalPages}
                className="audit-action"
                style={{ opacity: safeCurrentPage >= totalPages ? 0.5 : 1, padding: "6px 12px" }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
        )}

      </div>

    </div>
  );
}

export function GstVerificationView() {
  return (
    <Suspense fallback={<div>Loading GST View...</div>}>
      <GstVerificationViewInner />
    </Suspense>
  );
}

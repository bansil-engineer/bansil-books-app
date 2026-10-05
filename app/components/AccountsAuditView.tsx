"use client";

import React, { useState, useEffect, useRef } from "react";
import "./AccountsAuditView.css";
import { OrderComparison } from "./OrderComparison";
import { PeriodFilter, PeriodFilterState } from "./PeriodFilter";
import CommercialTraceView from "./CommercialTraceView";
import { CashBooksView } from "./audit/cash/CashBooksView";
interface DocumentReference { id: string; number: string | null; kind: string; party: string | null; organization_id: string; source_run_id: string; }

interface StatusData {
  production: { runs: number; cases: number };
  salesStatus?: {
    totalValidCases: number;
    totalFailedHistoricalCases: number;
    ownerReviewOpen: number;
    settlementSummary: { FULLY_SETTLED: number; PARTIALLY_SETTLED: number; UNSETTLED: number; OTHER: number; };
    bankMatchSummary: { CONFIRMED_AMOUNT_DATE_ACCOUNT: number; AMBIGUOUS: number; NO_MATCH: number; SOURCE_COVERAGE_INSUFFICIENT: number; };
  };
  salesCases?: any[];
  failedSalesCases?: any[];
  sourceCounts: { bankAccounts: number; bankTransactions: number; salesOrders: number; customerPayments: number; customerPaymentAllocations: number; purchaseOrders: number; vendorPayments: number; vendorPaymentAllocations: number; journals: number; expenses: number; };
  evidenceTrace: { entity_id: string; relationship_type: string; source_run_id: string; classification: string; related_id: string }[];
  bankTxnStatus: { status: string; count: number }[];
}

export function AccountsAuditView() {
  const [activeTab, setActiveTab] = useState("Overview");
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");
  const [documents, setDocuments] = useState<DocumentReference[]>([]);
  const [documentError, setDocumentError] = useState("");
  const [caseSearch, setCaseSearch] = useState("");
  const [caseFilter, setCaseFilter] = useState("Valid Sales Cases");
  const [detail, setDetail] = useState<{ title: string; records: Record<string, unknown>[]; note?: string } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailFilter, setDetailFilter] = useState("All");
  const [detailQuery, setDetailQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [chains, setChains] = useState<any[]>([]);
  const [chainError, setChainError] = useState("");
  const [chainSearch, setChainSearch] = useState("");
  const caseHeading = useRef<HTMLHeadingElement>(null);
  const focusCases = useRef(false);
  const requestId = useRef(0);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterState>({ period: "CURRENT_FY" });

  useEffect(() => {
    if (drawerOpen) {
      dialogRef.current?.focus();
    }
  }, [drawerOpen]);

  useEffect(() => {
    if (focusCases.current && caseHeading.current) {
      caseHeading.current.focus();
      caseHeading.current.scrollIntoView({ block: "start", behavior: "smooth" });
      focusCases.current = false;
    }
  }, [activeTab, caseFilter]);

  const showDetail = (title: string, records: Record<string, unknown>[], note?: string) => {
    if (!dialogRef.current?.contains(document.activeElement)) returnFocus.current = document.activeElement as HTMLElement;
    requestId.current++;
    setDetailFilter("All");
    setDetailQuery("");
    setDetailLoading(false);
    setDetail({ title, records, note });
    setDrawerOpen(true);
  };
  
  const closeDetail = () => {
    requestId.current++;
    returnFocus.current?.focus();
    setDrawerOpen(false);
    setTimeout(() => {
      setDetail(null);
      setDetailLoading(false);
    }, 200);
  };

  const openRecords = async (title: string, query: string) => {
    if (!dialogRef.current?.contains(document.activeElement)) returnFocus.current = document.activeElement as HTMLElement;
    const id = ++requestId.current;
    setDetailFilter("All");
    setDetailQuery("");
    setDetail({ title, records: [] });
    setDrawerOpen(true);
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/audit/accounts-details?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Local details unavailable. Close and try again.");
      const result = await response.json();
      if (id === requestId.current) setDetail({ title, records: result.records, note: result.note });
    } catch {
      if (id === requestId.current) setDetail({ title, records: [], note: "Local details unavailable. Close and try again." });
    } finally {
      if (id === requestId.current) setDetailLoading(false);
    }
  };

  const showCases = (filter: string) => {
    setCaseSearch("");
    focusCases.current = true;
    setActiveTab("Mismatches / Exceptions");
    setCaseFilter(filter);
  };

  const showEvidence = (query = "") => { setSearchQuery(query); setActiveTab("Evidence / Trace"); };
  const statusNote = "આ સંગ્રહિત checkpointની માહિતી છે; નવો audit અથવા reconciliation શરૂ થતો નથી. Purchase validation PARTIAL અને persistence NO યથાવત્ છે.";
  const explain = (title: string, status: string) => showDetail(title, [{ status }], statusNote);
  const action = (label: string, onClick: () => void, children: React.ReactNode, className = "audit-action") => (
    <button type="button" aria-label={label} className={className} onClick={event => { event.stopPropagation(); onClick(); }}>{children}<span aria-hidden="true" className="audit-arrow">↗</span></button>
  );

  const reference = (id: unknown, sourceRun?: unknown) => {
    const candidates = documents.filter(d => d.id === id);
    const scoped = sourceRun ? candidates.filter(d => d.source_run_id === sourceRun) : [];
    const choices = scoped.length ? scoped : candidates;
    const numbers = [...new Set(choices.map(d => d.number).filter(Boolean))];
    return numbers.length <= 1 ? choices[0] : undefined;
  };
  
  const documentLabel = (id: unknown, sourceRun?: unknown, fallback = "Document") => {
    const doc = reference(id, sourceRun);
    return doc?.number ? `${doc.kind} ${doc.number}` : `${doc?.kind || fallback} number unavailable`;
  };
  
  const runLabel = (id: unknown) => String(id).includes("CTRL-BATCH") ? "Controlled Sales Batch" : String(id).includes("PILOT-V2") ? "Sales Pilot V2" : String(id).includes("PILOT") ? "Failed Sales Pilot V1" : "Source snapshot";
  const money = (value: unknown) => typeof value === "number" ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value) : "Not recorded";
  const documentId = (record: Record<string, unknown>) => record.primary_source_id || record.invoice_id || record.bill_id || record.salesorder_id || record.purchaseorder_id || record.payment_id || record.journal_id || record.expense_id || record.entity_id || record.source_id;
  const pretty = (value: unknown) => String(value ?? "Not recorded").replaceAll("_", " ");
  
  const recordTitle = (record: Record<string, unknown>) => {
    if (record.record_type === "Payment allocation") return record.payment_number ? `Payment ${record.payment_number}` : "Payment number unavailable";
    if (record.source_type === "BANK_TRANSACTION") return "Bank evidence";
    if (String(record.source_type || "").includes("PAYMENT_ALLOCATION")) return "Receipt allocation";
    if (String(record.source_type || "").includes("ADJUSTMENT")) return pretty(record.component_type || "Adjustment");
    if (record.record_type === "Reconciliation run" || (record.reconciliation_run_id && !documentId(record))) return runLabel(record.reconciliation_run_id);
    if (record.transaction_id) return `Bank entry ${record.reference_number || record.date || "reference unavailable"}`;
    const id = documentId(record);
    return id ? documentLabel(id, record.primary_source_run_id || record.source_run_id, pretty(record.source_type || record.record_type || "Document")) : pretty(record.record_type || record.purpose || "Details");
  };

  const renderRecord = (record: Record<string, unknown>, index: number) => {
    const id = documentId(record);
    const doc = reference(id, record.primary_source_run_id || record.source_run_id);
    const mismatch = doc && record.organization_id && doc.organization_id !== record.organization_id;
    const summaryKeys = ["date", "customer_name", "vendor_name", "account_name", "status", "settlement_status", "machine_result", "owner_review_status", "relationship_type", "evidence_strength", "classification", "component_type", "amount_contribution", "component_amount", "amount_applied", "amount", "total", "balance", "reference_number", "notes", "purpose", "error_message", "created_at", "case_count"];
    return <section key={index} className="audit-record" aria-label={`Record ${index + 1}`}>
      <h3>{recordTitle(record)}</h3>
      {doc?.party && <p className="audit-party">{doc.party}</p>}
      {Boolean(mismatch) && <p className="audit-warning">Source organization differs — document number is for reference only; matching is unresolved.</p>}
      {record.record_type === "Purchase bill" && <div className="audit-comparison"><div><span>Bill total</span><strong>{money(record.total)}</strong></div><div><span>Source balance</span><strong>{money(record.balance)}</strong></div></div>}
      {record.record_type === "Case" && <div className="audit-comparison">{[["Expected", record.expected_settlement_amount], ["Observed", record.observed_settlement_amount], ["Remaining", record.remaining_amount], ["Difference", record.difference_amount]].map(([label, value]) => <div key={String(label)}><span>{String(label)}</span><strong>{money(value)}</strong></div>)}</div>}
      <dl>{summaryKeys.filter(key => record[key] != null && record[key] !== "").map(key => <React.Fragment key={key}><dt>{key === "machine_result" ? "Stored machine result" : key.replaceAll("_", " ")}</dt><dd>{typeof record[key] === "number" && /amount|total|balance/.test(key) ? money(record[key]) : pretty(record[key])}</dd></React.Fragment>)}</dl>
      {Boolean(record.related_id) && <p>Linked: {documentLabel(record.related_id, record.source_run_id, "Account / document")}</p>}
      {Boolean(record.bill_id && record.payment_id) && <p>Bill: {documentLabel(record.bill_id, record.source_run_id, "Bill")} · Payment: {documentLabel(record.payment_id, record.source_run_id, "Payment")}</p>}
      {Boolean(record.invoice_id && record.payment_id) && <p>Receipt: {documentLabel(record.payment_id, record.source_run_id, "Receipt")}</p>}
      {Boolean(record.paid_through_account_id || record.account_id) && <p>Account: {documentLabel(record.paid_through_account_id || record.account_id, undefined, "Account")}</p>}
      {record.record_type === "Source invoice" && <p>SO: {record.salesorder_id ? documentLabel(record.salesorder_id, record.source_run_id, "SO") : "Link not recorded"}</p>}
      <details><summary>Technical details</summary><dl>{Object.entries(record).map(([key, value]) => <React.Fragment key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{value == null || value === "" ? "Not recorded" : ["reconciliation_run_id", "primary_source_run_id", "source_run_id"].includes(key) ? action(`Open ${key} ${value}`, () => openRecords(key === "reconciliation_run_id" ? "Reconciliation run provenance" : "Source run mappings", `${key === "reconciliation_run_id" ? "runId" : "sourceRun"}=${encodeURIComponent(String(value))}`), String(value), "audit-link") : typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></React.Fragment>)}</dl></details>
    </section>;
  };

  const detailRecords = detail?.records.filter(r => (detailFilter === "All" || r.record_type === detailFilter) && (!detailQuery || [recordTitle(r), reference(documentId(r), r.source_run_id)?.party, ...Object.values(r)].join(" ").toLowerCase().includes(detailQuery.toLowerCase()))) || [];
  const allCases = [...(statusData?.salesCases || []), ...(statusData?.failedSalesCases || [])];
  const visibleCases = (caseFilter === "Failed Pilot V1" ? statusData?.failedSalesCases : caseFilter === "Total DB Cases" ? allCases : statusData?.salesCases)?.filter(c => {
    const doc = reference(c.primary_source_id, c.primary_source_run_id);
    if (caseSearch && ![documentLabel(c.primary_source_id, c.primary_source_run_id), doc?.party, c.settlement_status].join(" ").toLowerCase().includes(caseSearch.toLowerCase())) return false;
    if (caseFilter === "Owner Review") return c.owner_review_status === "OPEN";
    if (caseFilter === "Controlled Batch") return c.reconciliation_run_id.startsWith("RUN-SALES-CTRL-BATCH-");
    if (["FULLY_SETTLED", "PARTIALLY_SETTLED", "UNSETTLED"].includes(caseFilter)) return c.settlement_status === caseFilter;
    if (caseFilter === "OTHER") return !["FULLY_SETTLED", "PARTIALLY_SETTLED", "UNSETTLED"].includes(c.settlement_status);
    return true;
  }) || [];

  useEffect(() => {
    const params = new URLSearchParams();
    if (periodFilter.customFrom) params.append("from", periodFilter.customFrom);
    if (periodFilter.customTo) params.append("to", periodFilter.customTo);
    params.append("period", periodFilter.period);
    
    const qs = params.toString() ? `?${params.toString()}` : "";
    const chainsQs = params.toString() ? `&${params.toString()}` : "";
    const docsQs = params.toString() ? `&${params.toString()}` : "";

    fetch(`/api/audit/accounts-details?chains=1${chainsQs}`, { cache: "no-store" })
      .then(res => { if (!res.ok) throw new Error(); return res.json(); })
      .then(data => setChains(data.records))
      .catch(() => setChainError("Document chains unavailable. Please reload the page."));
    fetch(`/api/audit/accounts-details?documents=1${docsQs}`, { cache: "no-store" })
      .then(res => { if (!res.ok) throw new Error(); return res.json(); })
      .then(data => setDocuments(data.records))
      .catch(() => setDocumentError("Document numbers unavailable. Source identifiers remain in Technical details."));
    fetch(`/api/audit/accounts-status${qs}`)
      .then(res => { if (!res.ok) throw new Error("Status unavailable"); return res.json(); })
      .then(data => {
        if (data.success) setStatusData(data);
        else setError("Audit status unavailable. Reload the page to retry.");
        setLoading(false);
      })
      .catch(err => {
        setError("Audit status unavailable. Reload the page to retry.");
        setLoading(false);
      });
  }, [periodFilter]);

  const openChain = (row: any) => {
    if (row.chain === "SALES") {
      void openRecords(`Invoice ${row.invoice_number || "number unavailable"} — Comparison`, `caseId=${encodeURIComponent(row.case_id)}`);
    } else {
      showDetail(`Bill ${row.bill_number || "number unavailable"} — Comparison`, [
        { ...row, record_type: "Purchase bill", payments: undefined, status: "SOURCE ONLY — NOT RECONCILED" },
        ...(row.payments || []).map((p: any) => ({ ...p, record_type: "Payment allocation" })),
      ], row.source_note);
    }
  };

  const paymentLabel = (payment: any, kind: string) => payment.payment_number ? `${kind} ${payment.payment_number}` : payment.reference_number ? `Ref ${payment.reference_number}` : `${kind} number unavailable`;
  
  const renderChains = (kind: "SALES" | "PURCHASE") => {
    const rows = chains.filter(row => row.chain === kind && [row.invoice_number, row.bill_number, row.so_number, row.po_number, row.vendor_name, reference(row.primary_source_id, row.primary_source_run_id)?.party, ...(row.payments || []).map((p: any) => paymentLabel(p, "Payment"))].join(" ").toLowerCase().includes(chainSearch.toLowerCase()));
    return <section className="section-card audit-chain">
      <div className="section-header">
        <h3 className="section-title">{kind === "SALES" ? "Receivable Audit (SO → Invoice → Receipt)" : "Payable Audit (SO → PO → Bill → Payment)"}</h3>
        <span>{rows.length} {kind === "SALES" ? "invoices" : "bills"}</span>
      </div>
      <div className="audit-toolbar">
        <input id="audit-chain-search" placeholder="Search Invoice, bill, payment, party…" value={chainSearch} onChange={e => setChainSearch(e.target.value)} />
        {action("Clear document search", () => setChainSearch(""), "Clear")}
      </div>
      <div className="table-scroll-container"><table className="data-table"><thead><tr><th>SO</th>{kind === "PURCHASE" && <th>PO</th>}<th>{kind === "SALES" ? "Invoice" : "Bill"}</th><th>{kind === "SALES" ? "Payment Received" : "Payment"}</th><th className="right">{kind === "SALES" ? "Invoice total" : "Bill total"}</th><th>Review</th></tr></thead><tbody>
      {rows.map((row, index) => <tr key={row.case_id || row.bill_id}>
        <td>{row.so_number ? action(`SO comparison ${kind} ${index + 1}`, () => openChain(row), row.so_number, "audit-link") : <span className="audit-party">Not linked</span>}</td>
        {kind === "PURCHASE" && <td>
          {row.po_number ? action(`PO comparison ${index + 1}`, () => openChain(row), row.po_number, "audit-link") : <span className="audit-warning">PO Missing Reference</span>}
        </td>}
        <td>{action(`${kind === "SALES" ? "Invoice" : "Bill"} comparison ${index + 1}`, () => openChain(row), row.invoice_number || row.bill_number || "Number unavailable", "audit-link")}<div className="audit-party">{row.vendor_name || reference(row.primary_source_id, row.primary_source_run_id)?.party}</div><div className="audit-party">{row.invoice_date || row.date || ""}</div></td>
        <td>{row.payments.length ? row.payments.map((payment: any, pIndex: number) => <div key={pIndex}>{action(`${kind} payment comparison ${index + 1}.${pIndex + 1}`, () => openChain(row), paymentLabel(payment, kind === "SALES" ? "Receipt" : "Payment"), "audit-link")}<div className="audit-party">Applied: {money(payment.amount_applied)}</div></div>) : <span className="audit-party">No linked payment</span>}</td>
        <td className="amount right">{money(kind === "SALES" ? row.invoice_total : row.total)}</td>
        <td>{action(`${kind} review comparison ${index + 1}`, () => openChain(row), kind === "SALES" ? "Review source" : "Source only", "audit-link")}</td>
      </tr>)}
      {!rows.length && <tr><td colSpan={kind === "SALES" ? 6 : 7}>No documents match this view.</td></tr>}
      </tbody></table></div>
      <p className="audit-note">{kind === "SALES" ? "સંગ્રહિત Sales cases: source organization અલગ હોવાથી matching unresolved છે. SO link ઉપલબ્ધ નથી. Payment number ન હોય તો source reference બતાવેલ છે." : "ઉપલબ્ધ Purchase allocationsનો sample. SO/PO link સંગ્રહિત નથી. Purchase validation PARTIAL છે; reconciliation NOT RUN."}</p>
    </section>;
  };

  const renderBadge = (status: string, overrideType?: string) => {
    let type = "draft";
    const s = status.toUpperCase();
    
    if (overrideType) {
      if (overrideType === "success") type = "paid";
      else if (overrideType === "warning") type = "pending";
      else if (overrideType === "danger") type = "overdue";
      else if (overrideType === "info") type = "sent";
      else if (overrideType === "neutral") type = "draft";
    } else {
      if (s.includes("NOT_PROVEN")) { type = "overdue";
      } else if (s.includes("PASS") || s.includes("PROVEN") || s.includes("FULL") || s.includes("AVAILABLE") || s.includes("READY")) {
        type = "paid";
      } else if (s.includes("PARTIAL") || s.includes("PENDING") || s.includes("OPEN")) {
        type = "pending";
      } else if (s.includes("NOT STARTED") || s.includes("NOT RUN")) {
        type = "draft";
      } else if (s.includes("NO") || s.includes("BLOCKED") || s.includes("FAIL") || s.includes("UNSETTLED")) {
        type = "overdue";
      }
    }

    return (
      <span className={`status-chip ${type}`}>
        {status}
      </span>
    );
  };

  const tabs = [
    "Overview",
    "Cash & Cash Books",
    "Receivable Audit",
    "Payable Audit",
    "Commercial Trace (SO)",
    "Mismatches / Exceptions",
    "Evidence / Trace",
    "Technical / Phase Gates"
  ];

  const filteredEvidence = statusData?.evidenceTrace.filter(trace => 
    documentLabel(trace.entity_id, trace.source_run_id).toLowerCase().includes(searchQuery.toLowerCase()) ||
    documentLabel(trace.related_id, trace.source_run_id).toLowerCase().includes(searchQuery.toLowerCase()) ||
    (trace.source_run_id || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
    trace.entity_id.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (trace.related_id && trace.related_id.toLowerCase().includes(searchQuery.toLowerCase())) ||
    trace.relationship_type.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  return (
    <div className="app-content accounts-audit">
      {/* OVERVIEW HEADER */}
      <div className="app-top-header" style={{ marginBottom: 20, borderRadius: 8 }}>
        <div className="app-top-header-left">
          <div className="section-title-group">
            <h1 className="app-page-title">Accounts Audit Workspace</h1>
            <div className="section-subtitle" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Read-only source verification, reconciliation analysis and evidence trace
            </div>
          </div>
        </div>
        <div className="app-top-header-right">
          {renderBadge("ZOHO READ ONLY", "info")}
          {renderBadge("ZOHO WRITE 0", "success")}
          {renderBadge("SALES READY — READ ONLY", "success")}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <PeriodFilter value={periodFilter} onChange={setPeriodFilter} />
      </div>

      <nav className="nav-tabs-container" aria-label="Accounts Audit sections" style={{ marginBottom: 24 }}>
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button" aria-current={activeTab === tab ? "page" : undefined}
            onClick={() => setActiveTab(tab)}
            className={`nav-tab-btn ${activeTab === tab ? "active" : ""}`}
          >
            {tab}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}{documentError && <p role="alert">{documentError}</p>}
      {chainError && <p role="alert">{chainError}</p>}

      <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {loading && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
            Loading audit workspace...
          </div>
        )}

        {!loading && statusData && activeTab === "Overview" && (
          <>
            <div className="metrics-grid">
              <button type="button" aria-label="Cash & Cash Books" onClick={() => setActiveTab("Cash & Cash Books")} className="audit-action metric-card">
                <span className="metric-label">Cash & Cash Books</span>
                <span className="metric-value">READY</span>
                <span className="metric-sub">— READ ONLY</span>
              </button>
              <button type="button" aria-label="Receivable Audit" onClick={() => setActiveTab("Receivable Audit")} className="audit-action metric-card">
                <span className="metric-label">Receivable Audit</span>
                <span className="metric-value">READY</span>
                <span className="metric-sub">— READ ONLY</span>
              </button>
              <button type="button" aria-label="Payable Audit" onClick={() => setActiveTab("Payable Audit")} className="audit-action metric-card">
                <span className="metric-label">Payable Audit</span>
                <span className="metric-value" style={{ color: 'var(--google-amber)' }}>PARTIAL</span>
                <span className="metric-sub">NOT RUN</span>
              </button>
              <button type="button" aria-label="Owner Review" onClick={() => showCases("Owner Review")} className="audit-action metric-card">
                <span className="metric-label">Owner Review</span>
                <span className="metric-value" style={{ color: 'var(--google-amber)' }}>
                  {statusData?.salesStatus?.ownerReviewOpen || 0}
                </span>
                <span className="metric-sub" style={{ color: 'var(--google-amber)', fontWeight: 600 }}>OPEN</span>
              </button>
              <button type="button" aria-label="Historical Sales" onClick={() => explain("Historical Sales", "NOT RUN")} className="audit-action metric-card">
                <span className="metric-label">Historical Audit Status</span>
                <span className="metric-value" style={{ fontSize: 16 }}>NOT RUN</span>
              </button>
              <button type="button" aria-label="Failed Pilot V1" onClick={() => showCases("Failed Pilot V1")} className="audit-action metric-card" style={{ background: 'var(--google-red-bg)', borderColor: 'rgba(217,48,37,0.2)' }}>
                <span className="metric-label" style={{ color: 'var(--google-red)' }}>Open Mismatches</span>
                <span className="metric-value" style={{ color: 'var(--google-red)' }}>
                  {statusData?.salesStatus?.totalFailedHistoricalCases || 0}
                </span>
                <span className="metric-sub" style={{ color: 'var(--google-red)' }}>EXCEPTIONS</span>
              </button>
            </div>
            
            <OrderComparison />
          </>
        )}

        {!loading && activeTab === "Cash & Cash Books" && (
          <div className="section-card" style={{ padding: '24px' }}>
            <CashBooksView financialYear={periodFilter.period} />
          </div>
        )}

        {!loading && statusData && activeTab === "Receivable Audit" && (
          <>
            <OrderComparison />
            {renderChains("SALES")}
          </>
        )}

        {!loading && statusData && activeTab === "Payable Audit" && (
          <>
            {renderChains("PURCHASE")}
          </>
        )}

        {!loading && statusData && activeTab === "Commercial Trace (SO)" && (
          <CommercialTraceView />
        )}

        {!loading && statusData && activeTab === "Mismatches / Exceptions" && (
          <div className="section-card">
            <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="section-title" ref={caseHeading} tabIndex={-1}>Exceptions: {caseFilter} ({visibleCases.length})</h3>
              <input aria-label="Search cases by document number or party" placeholder="Invoice number or party…" value={caseSearch} onChange={e => setCaseSearch(e.target.value)} />
              {action("Clear case filter", () => showCases("Valid Sales Cases"), "Clear filter")}
            </div>
            <div className="table-scroll-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Settlement Status</th>
                    <th>Stored Machine Result</th>
                    <th className="right">Expected</th>
                    <th className="right">Observed</th>
                    <th className="right">Remaining</th>
                    <th className="right">Diff</th>
                    <th>Owner Review</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCases.map((c, idx) => (
                    <tr key={c.case_id || idx} className="audit-case-row" onClick={() => openRecords(documentLabel(c.primary_source_id, c.primary_source_run_id, "Invoice"), `caseId=${encodeURIComponent(c.case_id)}`)}>
                      <td>{action(`Open ${documentLabel(c.primary_source_id, c.primary_source_run_id, "Invoice")} — ${runLabel(c.reconciliation_run_id)}`, () => openRecords(documentLabel(c.primary_source_id, c.primary_source_run_id, "Invoice"), `caseId=${encodeURIComponent(c.case_id)}`), documentLabel(c.primary_source_id, c.primary_source_run_id, "Invoice"), "audit-link")}<div className="audit-party">{reference(c.primary_source_id, c.primary_source_run_id)?.party}</div>{reference(c.primary_source_id, c.primary_source_run_id)?.organization_id !== c.organization_id && <small className="audit-warning">Source organization differs</small>}</td>
                      <td style={{ color: c.settlement_status === 'FULLY_SETTLED' ? 'var(--google-green)' : 'var(--google-amber)', fontWeight: 500 }}>
                        {c.settlement_status}
                      </td>
                      <td>
                        {c.machine_result === 'CONFIRMED_AMOUNT_DATE_ACCOUNT' ? (
                          <span style={{ color: 'var(--google-green)', fontWeight: 500 }}>{c.machine_result}</span>
                        ) : c.machine_result === 'AMBIGUOUS' ? (
                          <span style={{ color: 'var(--google-amber)', fontWeight: 500 }}>{c.machine_result}</span>
                        ) : (
                          <span style={{ color: 'var(--google-red)', fontWeight: 500 }}>{c.machine_result}</span>
                        )}
                      </td>
                      <td className="amount right">{money(c.expected_settlement_amount)}</td>
                      <td className="amount right">{money(c.observed_settlement_amount)}</td>
                      <td className="amount right">{money(c.remaining_amount)}</td>
                      <td className="amount right">{money(c.difference_amount)}</td>
                      <td style={{ fontWeight: 600, color: c.owner_review_status === 'OPEN' ? 'var(--google-amber)' : 'var(--google-green)' }}>
                        {c.owner_review_status}
                      </td>
                    </tr>
                  ))}
                  {(visibleCases.length === 0) && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
                        No cases match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 12, background: 'var(--google-green-bg)', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--google-green)' }}>
              <strong>READ-ONLY CASE SNAPSHOT.</strong> Failed V1 is historical/inactive. Stored machine result is not necessarily a bank match; no results are recalculated here.
            </div>
          </div>
        )}

        {!loading && statusData && activeTab === "Evidence / Trace" && (
          <div className="section-card">
            <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="section-title">Evidence Trace (Local Sample)</h3>
              <input 
                type="text" 
                aria-label="Search evidence trace" placeholder="Search trace..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, width: 250 }}
              />
            </div>
            <div className="table-scroll-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th>Relationship</th>
                    <th>Related Document</th>
                    <th>Classification</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvidence.map((trace, idx) => (
                    <tr key={idx}>
                      <td>
                        <span className="audit-link">{documentLabel(trace.entity_id, trace.source_run_id)}</span>
                        <div className="audit-party">{trace.entity_id}</div>
                      </td>
                      <td>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>{trace.relationship_type.replaceAll('_', ' ')}</span>
                      </td>
                      <td>
                        {trace.related_id ? (
                          <>
                            <span className="audit-link">{documentLabel(trace.related_id, trace.source_run_id)}</span>
                            <div className="audit-party">{trace.related_id}</div>
                          </>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)' }}>—</span>
                        )}
                      </td>
                      <td>
                        <span className="status-chip draft">{trace.classification}</span>
                      </td>
                    </tr>
                  ))}
                  {filteredEvidence.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
                        No evidence records found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && statusData && activeTab === "Technical / Phase Gates" && (
          <div className="section-card">
            <div className="section-header">
              <h3 className="section-title">Project Gate Status</h3>
            </div>
            <div className="table-scroll-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Phase</th>
                    <th>Purpose</th>
                    <th>Status</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { phase: "2E.1", purpose: "Zoho API Alignment", status: "PASS", notes: "" },
                    { phase: "2E.2A", purpose: "Strict Provenance", status: "PASS", notes: "" },
                    { phase: "2E.2B", purpose: "Final Semantics", status: "PASS", notes: "" },
                    { phase: "2E.2C", purpose: "Bounded Dry-Run", status: "PARTIAL", notes: "" },
                    { phase: "2E.2D", purpose: "Live Input Coverage", status: "PARTIAL", notes: "" },
                    { phase: "2E.2F", purpose: "Bank Enrichment", status: "PASS", notes: "Before provenance incident" },
                    { phase: "2E.2F3", purpose: "Auth Recovery", status: "PASS", notes: "Clean consent" },
                    { phase: "2E.2F4", purpose: "Snapshot Scoping", status: "PASS", notes: "Duplicate ambiguity resolved" },
                    { phase: "2E.2G", purpose: "Adj Discovery", status: "PASS", notes: "" },
                    { phase: "2E.3C", purpose: "Sales Adj Ext", status: "PASS", notes: "Zero persisted" },
                    { phase: "2E.3D", purpose: "Sales Settlement & Bank Validation", status: "PASS", notes: "Direction and coverage proven" },
                    { phase: "Sales Engine", purpose: "Sales Flow", status: "PASS", notes: "Validation Complete" },
                  ].map((row, idx) => (
                    <tr key={idx}>
                      <td>{action(`Phase ${row.phase}`, () => showDetail(`Phase ${row.phase}`, [row], statusNote), row.phase, "audit-link")}</td>
                      <td>{row.purpose}</td>
                      <td>{renderBadge(row.status)}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{row.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
      
      {/* DRAWER COMPONENT */}
      {drawerOpen && (
        <div className="audit-drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeDetail(); }}>
          <div className="audit-drawer" ref={dialogRef} tabIndex={-1} role="dialog" aria-labelledby="audit-drawer-title" onKeyDown={e => { if (e.key === "Escape") closeDetail(); }}>
            <div className="audit-drawer-header">
              <h2 id="audit-drawer-title">{detail?.title || "Details"}</h2>
              <button type="button" className="audit-action" onClick={closeDetail}>Close ✕</button>
            </div>
            <div className="audit-drawer-content">
              <p className="audit-note" style={{ marginBottom: 16 }}>READ ONLY · Local snapshot · ZOHO WRITE 0</p>
              {detail?.note && <p role="status" className="audit-note" style={{ marginBottom: 16 }}>{detail.note}</p>}
              {detailLoading ? <p role="status">Loading local details…</p> : <>
                <div className="audit-toolbar" style={{ marginBottom: 16 }}>
                  {action("Show all detail records", () => setDetailFilter("All"), "All records")}
                  {detail?.records.some(r => r.record_type === "Case") && ["Source link", "Evidence", "Amount component"].map(kind => <React.Fragment key={kind}>{action(`Show ${kind} records`, () => setDetailFilter(kind), `${kind === "Source link" ? "Linked documents" : kind === "Evidence" ? "Matching evidence" : "Amount breakdown"} (${detail?.records.filter(r => r.record_type === kind).length})`)}</React.Fragment>)}
                </div>
                <input style={{ width: '100%', marginBottom: 16 }} aria-label="Find document in details" placeholder="Find number, party or reference…" value={detailQuery} onChange={e => setDetailQuery(e.target.value)} />
                <p role="status" style={{ marginBottom: 16 }}>{detailFilter}: {detailRecords.length} records</p>
                {detailRecords.length === 0 && <p>No records match this view.</p>}
                {detailRecords.map(renderRecord)}
              </>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState, useEffect, useCallback } from "react";
import "./AccountsAuditView.css";
import { PeriodFilter, PeriodFilterState } from "./PeriodFilter";
import { SectionSyncControl } from "./SectionSyncControl";
import { LineMappingPanel } from "./LineMappingPanel";
import { InvoiceLineMappingPanel } from "./InvoiceLineMappingPanel";

interface ApprovalPendingItemEvidence {
  sourceLineId: string;
  displayLineNumber?: number;
  itemId: string;
  itemName: string;
  narration: string;
  refLineId: string | null;
  refDisplayLineNumber?: number | null;
  refNarration?: string | null;
  rate: number | null;
  amount: number | null;
  refRate?: number | null;
  refAmount?: number | null;
  expectedQty: number | null;
  actualQty: number;
  previousQty: number | null;
  cumulativeQty: number | null;
  uomMatch: boolean;
  mismatchType: string;
  previousDocuments?: { number: string; date: string; qty: number; status: string; }[];
  rateCheckStatus?: "OK" | "ALERT" | "CANNOT_DETERMINE";
  premiumAmount?: number | null;
  premiumPercentage?: number | null;
  unit?: string | null;
  refUnit?: string | null;
  uomStatus?: "UOM_MATCH" | "UOM_MISMATCH" | "UOM_EVIDENCE_MISSING" | null;
}

const formatMoney = (val?: number | null) => {
  if (val === null || val === undefined) return '—';
  return '₹' + val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

interface ApprovalPendingDocument {
  id: string;
  type: "PO" | "BILL" | "INVOICE";
  number: string;
  date: string;
  zohoStatus: string;
  verificationStatus: "MATCHED" | "MISMATCH" | "PARTIAL_WITHIN_REFERENCE" | "UNRESOLVED" | "LOCAL_DATA_INCOMPLETE" | "AMBIGUOUS_REFERENCE_LINE" | "SO_REFERENCE_NOT_FOUND";
  customerOrVendor: string;
  relatedDocumentRef: string | null;
  nativeReferenceNumber?: string | null;
  referenceDate?: string;
  referenceCustomer?: string;
  referenceSubmittedBy?: string | null;
  submittedBy: string | null;
  items: ApprovalPendingItemEvidence[];
  mismatchCount: number;
}

interface ApprovalPendingReport {
  documents: ApprovalPendingDocument[];
  summary: {
    totalPending: number;
    poPending: number;
    billPending: number;
    invoicePending: number;
    matched: number;
    partial: number;
    mismatch: number;
    unresolved: number;
  };
}

export default function ApprovalPendingView() {
  const [report, setReport] = useState<ApprovalPendingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterType, setFilterType] = useState<"ALL" | "PO" | "BILL" | "INVOICE">("ALL");
  const [filterStatus, setFilterStatus] = useState<"ALL" | "MATCHED" | "MISMATCH" | "PARTIAL_WITHIN_REFERENCE" | "UNRESOLVED">("ALL");
  const [search, setSearch] = useState("");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterState>({ period: "CURRENT_FY" });

  const [selectedDoc, setSelectedDoc] = useState<ApprovalPendingDocument | null>(null);
  const [viewMode, setViewMode] = useState<"LIST" | "DETAIL">("LIST");
  const [syncState, setSyncState] = useState<any>(null);
  const [isGlobalSyncing, setIsGlobalSyncing] = useState(false);
  const [syncingDocId, setSyncingDocId] = useState<string | null>(null);
  const [listTargetedResult, setListTargetedResult] = useState<any>(null);

  useEffect(() => {
    if (selectedDoc) {
      setViewMode("DETAIL");
    } else {
      setViewMode("LIST");
    }
  }, [selectedDoc]);

  const fetchSyncState = useCallback(async () => {
    try {
      const res = await fetch("/api/audit/section-sync?sectionKey=APPROVAL_PENDING");
      if (res.ok) {
        const data = await res.json();
        setSyncState(data.syncState);
      }
    } catch (err) {
      console.error("Failed to fetch section sync state", err);
    }
  }, []);

  useEffect(() => {
    fetchSyncState();
  }, [fetchSyncState]);

  useEffect(() => {
    fetchData();
  }, [periodFilter]);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (periodFilter.customFrom) params.append("from", periodFilter.customFrom);
      if (periodFilter.customTo) params.append("to", periodFilter.customTo);
      params.append("period", periodFilter.period);

      const qs = params.toString() ? `?${params.toString()}` : "";

      const res = await fetch(`/api/audit/approval-pending${qs}`);
      if (!res.ok) throw new Error("Failed to fetch approval pending data");
      const data = await res.json();
      setReport(data);
      setSelectedDoc(current => {
        if (!current) return null;
        return data.documents.find((d: ApprovalPendingDocument) => d.id === current.id) || current;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleGlobalSync() {
    if (isGlobalSyncing || syncingDocId !== null) return;
    setIsGlobalSyncing(true);
    try {
      const res = await fetch("/api/audit/section-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionKey: "APPROVAL_PENDING",
          period: periodFilter
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      if (data.syncState) setSyncState(data.syncState);
      await fetchData();
    } catch (err: any) {
      alert(err.message || "Global Smart Sync failed");
      await fetchSyncState();
    } finally {
      setIsGlobalSyncing(false);
    }
  }

  async function handleTargetedSync(docToSync: ApprovalPendingDocument) {
    if (syncingDocId !== null || isGlobalSyncing) return;
    setSyncingDocId(docToSync.id);
    try {
      const res = await fetch("/api/audit/section-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionKey: "APPROVAL_PENDING",
          targetDoc: { type: docToSync.type, id: docToSync.id, number: docToSync.number }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Targeted sync failed");
      if (data.targetResult) {
        setListTargetedResult(data.targetResult);
      }
      await fetchData();
    } catch (err: any) {
      alert(err.message || "Individual Smart Sync failed");
    } finally {
      setSyncingDocId(null);
    }
  }

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleString("en-IN");
  };

  if (loading) return <div className="audit-loading">Scanning pending documents...</div>;
  if (error) return <div className="audit-error">Error: {error}</div>;
  if (!report) return null;

  if (viewMode === "DETAIL" && selectedDoc) {
    return (
      <ApprovalDetailWorkspace
        doc={selectedDoc}
        onClose={() => setSelectedDoc(null)}
        allDocs={report.documents}
        onSyncComplete={fetchData}
      />
    );
  }

  let filteredDocs = report.documents;
  if (filterType !== "ALL") filteredDocs = filteredDocs.filter(d => d.type === filterType);
  if (filterStatus !== "ALL") filteredDocs = filteredDocs.filter(d => d.verificationStatus === filterStatus);
  if (search) {
    const s = search.toLowerCase();
    filteredDocs = filteredDocs.filter(d =>
      (d.number && d.number.toLowerCase().includes(s)) ||
      (d.customerOrVendor && d.customerOrVendor.toLowerCase().includes(s)) ||
      (d.relatedDocumentRef && d.relatedDocumentRef.toLowerCase().includes(s))
    );
  }

  return (
    <div className="section-card">
      {/* COMPACT TOP TOOLBAR */}
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 16px', marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* ROW 1 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="section-title" style={{ margin: 0 }}>Approval Pending Verification</h2>
          <span className="badge-semantic success inline-block">ZOHO WRITE: 0</span>
        </div>

        {/* ROW 2 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              className="period-filter-apply-btn"
              onClick={fetchData}
              disabled={isGlobalSyncing || syncingDocId !== null}
              style={{ padding: '6px 14px', height: '30px', fontSize: '12px', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)', cursor: 'pointer' }}
            >
              Refresh Local
            </button>
            <button
              onClick={handleGlobalSync}
              disabled={isGlobalSyncing || syncingDocId !== null}
              className="period-filter-apply-btn"
              style={{
                padding: '6px 14px',
                height: '30px',
                fontSize: '12px',
                fontWeight: 600,
                background: isGlobalSyncing ? 'var(--bg-secondary)' : '#2563eb',
                color: isGlobalSyncing ? 'var(--text-secondary)' : '#ffffff',
                border: isGlobalSyncing ? '1px solid var(--border)' : '1px solid #1d4ed8',
                cursor: (isGlobalSyncing || syncingDocId !== null) ? 'not-allowed' : 'pointer'
              }}
            >
              {isGlobalSyncing ? "SYNCING CHANGES..." : "🔄 SMART SYNC ALL CHANGED"}
            </button>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            <span>Last Sync: </span>
            <strong style={{ color: 'var(--text-primary)' }}>{formatDate(syncState?.completed_at)}</strong>
          </div>
        </div>

        {/* ROW 3 — only after sync result */}
        {syncState?.status === "SUCCESS" && syncState.completed_at && (
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#047857', letterSpacing: '0.05em' }}>
              SMART SYNC COMPLETED
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '12px' }}>
              <span className="badge-semantic neutral" style={{ background: 'rgba(37, 99, 235, 0.08)', color: '#1d4ed8', border: '1px solid rgba(37, 99, 235, 0.2)' }}>
                New: <strong>{syncState.records_created}</strong>
              </span>
              <span className="badge-semantic neutral" style={{ background: 'rgba(217, 119, 6, 0.08)', color: '#b45309', border: '1px solid rgba(217, 119, 6, 0.2)' }}>
                Updated: <strong>{syncState.records_updated}</strong>
              </span>
              <span className="badge-semantic neutral" style={{ background: 'rgba(107, 114, 128, 0.08)', color: '#374151', border: '1px solid rgba(107, 114, 128, 0.2)' }}>
                Unchanged: <strong>{syncState.records_unchanged}</strong>
              </span>
              <span className={`badge-semantic ${syncState.records_failed > 0 ? "danger" : "neutral"}`} style={{ border: syncState.records_failed > 0 ? undefined : '1px solid rgba(107, 114, 128, 0.2)' }}>
                Failed: <strong>{syncState.records_failed}</strong>
              </span>
            </div>
          </div>
        )}

        {/* TARGETED SYNC RESULT BANNER */}
        {listTargetedResult && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', paddingTop: '10px', borderTop: '1px solid var(--border)', fontSize: '12px', color: '#047857' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'center' }}>
              <strong style={{ letterSpacing: '0.05em' }}>SMART SYNC COMPLETED:</strong>
              <div>Document: <strong>{listTargetedResult.documentNumber || listTargetedResult.documentId}</strong></div>
              <div>Result: <strong style={{ color: listTargetedResult.result === 'UPDATED' ? '#b45309' : listTargetedResult.result === 'NEW' ? '#1d4ed8' : '#374151' }}>{listTargetedResult.result}</strong></div>
              <div>Reference refreshed: <strong>{listTargetedResult.referenceRefreshed ? "YES" : "NO"}</strong></div>
              <div>Reference document refreshed: <strong>{listTargetedResult.referenceDocumentRefreshed ? "YES" : "NOT APPLICABLE"}</strong></div>
              <div>Last Sync: <strong>{formatDate(listTargetedResult.completedAt)}</strong></div>
            </div>
            <button onClick={() => setListTargetedResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>✕</button>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <PeriodFilter value={periodFilter} onChange={setPeriodFilter} />
      </div>

      <div className="metrics-grid" style={{ marginBottom: 24 }}>
        <div className="metric-card">
          <div className="metric-card-title">TOTAL PENDING</div>
          <div className="metric-card-value">{report.summary.totalPending}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-title">PO / BILL / INV</div>
          <div className="metric-card-value">
            {report.summary.poPending} / {report.summary.billPending} / {report.summary.invoicePending}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-card-title" style={{ color: 'var(--google-green)' }}>MATCHED</div>
          <div className="metric-card-value">{report.summary.matched}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-title" style={{ color: 'var(--google-amber)' }}>PARTIAL</div>
          <div className="metric-card-value">{report.summary.partial || 0}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-title" style={{ color: 'var(--google-red)' }}>MISMATCH</div>
          <div className="metric-card-value">{report.summary.mismatch}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-title" style={{ color: 'var(--google-amber)' }}>UNRESOLVED</div>
          <div className="metric-card-value">{report.summary.unresolved}</div>
        </div>
      </div>

      <div className="audit-filters" style={{ display: 'flex', gap: '15px', marginBottom: '20px', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search number, party..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="audit-input"
          style={{ width: '250px' }}
        />
        <select value={filterType} onChange={e => setFilterType(e.target.value as any)} className="audit-select">
          <option value="ALL">All Types</option>
          <option value="PO">Purchase Orders</option>
          <option value="BILL">Bills</option>
          <option value="INVOICE">Invoices</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="audit-select">
          <option value="ALL">All Statuses</option>
          <option value="MATCHED">Matched</option>
          <option value="MISMATCH">Mismatch</option>
          <option value="PARTIAL_WITHIN_REFERENCE">Partial</option>
          <option value="UNRESOLVED">Unresolved</option>
        </select>
      </div>

      <div className="table-scroll-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Document No</th>
              <th>Date</th>
              <th>Customer/Vendor</th>
              <th>Reference</th>
              <th>Zoho Status</th>
              <th>Verification</th>
              <th style={{ textAlign: "center" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredDocs.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: "20px" }}>No documents match filters</td></tr>
            ) : (
              filteredDocs.map(doc => {
                let badgeClass = 'badge-semantic neutral';
                if (doc.verificationStatus === 'MATCHED') badgeClass = 'badge-semantic success';
                if (doc.verificationStatus === 'MISMATCH') badgeClass = 'badge-semantic danger';
                if (doc.verificationStatus === 'PARTIAL_WITHIN_REFERENCE') badgeClass = 'badge-semantic warning';

                const isSyncingThis = syncingDocId === doc.id;
                const disableBtn = isSyncingThis || syncingDocId !== null || isGlobalSyncing;

                return (
                  <tr key={doc.id} className="clickable" onClick={() => setSelectedDoc(doc)}>
                    <td style={{ fontWeight: 500 }}>{doc.type}</td>
                    <td className="audit-link">{doc.number}</td>
                    <td>{doc.date}</td>
                    <td>{doc.customerOrVendor}</td>
                    <td>{doc.relatedDocumentRef || <span style={{color: 'var(--text-secondary)'}}>Missing</span>}</td>
                    <td><span className="badge-semantic neutral">{doc.zohoStatus}</span></td>
                    <td>
                      <span className={badgeClass}>
                        {doc.verificationStatus.replace(/_/g, " ")}
                        {doc.mismatchCount > 0 && ` (${doc.mismatchCount} errors)`}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <button
                        disabled={disableBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTargetedSync(doc);
                        }}
                        className="period-filter-apply-btn"
                        style={{
                          padding: '2px 8px',
                          fontSize: '11px',
                          height: '24px',
                          cursor: disableBtn ? 'not-allowed' : 'pointer',
                          opacity: disableBtn ? 0.6 : 1,
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border)'
                        }}
                      >
                        {isSyncingThis ? "Syncing..." : "🔄 Sync"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ApprovalDetailWorkspace({
  doc,
  onClose,
  allDocs,
  onSyncComplete
}: {
  doc: ApprovalPendingDocument;
  onClose: () => void;
  allDocs?: ApprovalPendingDocument[];
  onSyncComplete?: () => Promise<void> | void;
}) {
  const [currentDoc, setCurrentDoc] = useState<ApprovalPendingDocument>(doc);
  const [isDetailSyncing, setIsDetailSyncing] = useState(false);
  const [detailTargetResult, setDetailTargetResult] = useState<any>(null);
  const [expandedItemIdx, setExpandedItemIdx] = useState<number | null>(null);
  const [previewDoc, setPreviewDoc] = useState<ApprovalPendingDocument | null>(null);

  useEffect(() => {
    setCurrentDoc(doc);
  }, [doc]);

  async function handleDetailTargetedSync() {
    if (isDetailSyncing) return;
    setIsDetailSyncing(true);
    try {
      const res = await fetch("/api/audit/section-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionKey: "APPROVAL_PENDING",
          targetDoc: { type: currentDoc.type, id: currentDoc.id, number: currentDoc.number }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Targeted sync failed");
      if (data.targetResult) {
        setDetailTargetResult(data.targetResult);
      }

      // CRITICAL: Immediately re-read local data so updated reference appears without hard refresh!
      const refreshRes = await fetch(`/api/audit/approval-pending?docNumber=${encodeURIComponent(currentDoc.number)}`);
      if (refreshRes.ok) {
        const refreshedData = await refreshRes.json();
        if (refreshedData.documents?.[0]) {
          setCurrentDoc(refreshedData.documents[0]);
        }
      }
      if (onSyncComplete) {
        await onSyncComplete();
      }
    } catch (err: any) {
      alert(err.message || "Failed to sync document");
    } finally {
      setIsDetailSyncing(false);
    }
  }

  const currentItems = currentDoc.items.filter(i => i.mismatchType !== 'NOT_INCLUDED_IN_CURRENT_DOCUMENT');
  const remainingItems = currentDoc.items.filter(i => i.mismatchType === 'NOT_INCLUDED_IN_CURRENT_DOCUMENT');
  const refType = currentDoc.type === 'BILL' ? 'PO' : 'SO';

  return (
    <div className="section-card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={onClose} className="period-filter-apply-btn" style={{ padding: '6px 12px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', cursor: 'pointer' }}>
            ← Back
          </button>
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>{currentDoc.type} {currentDoc.number} — Verification Evidence</h2>
            <div className="flex gap-2 mt-1">
              <span className="badge-semantic success inline-block">ZOHO WRITE: 0</span>
            </div>
          </div>
        </div>
        <div>
          <button
            onClick={handleDetailTargetedSync}
            disabled={isDetailSyncing}
            className="period-filter-apply-btn"
            style={{
              padding: '6px 14px',
              height: '32px',
              fontSize: '12px',
              fontWeight: 600,
              background: isDetailSyncing ? 'var(--bg-secondary)' : '#2563eb',
              color: isDetailSyncing ? 'var(--text-secondary)' : '#ffffff',
              border: isDetailSyncing ? '1px solid var(--border)' : '1px solid #1d4ed8',
              cursor: isDetailSyncing ? 'not-allowed' : 'pointer'
            }}
          >
            {isDetailSyncing ? "SYNCING..." : `🔄 SMART SYNC THIS ${currentDoc.type}`}
          </button>
        </div>
      </div>

      {detailTargetResult && (
        <div style={{ marginBottom: '20px', padding: '12px 16px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '6px', fontSize: '12px', color: '#047857' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <strong style={{ letterSpacing: '0.05em' }}>SMART SYNC COMPLETED</strong>
            <button onClick={() => setDetailTargetResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '14px' }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
            <div><span style={{ color: 'var(--text-secondary)' }}>Document: </span><strong>{detailTargetResult.documentNumber || detailTargetResult.documentId}</strong></div>
            <div><span style={{ color: 'var(--text-secondary)' }}>Result: </span><strong style={{ color: detailTargetResult.result === 'UPDATED' ? '#b45309' : detailTargetResult.result === 'NEW' ? '#1d4ed8' : '#374151' }}>{detailTargetResult.result}</strong></div>
            <div><span style={{ color: 'var(--text-secondary)' }}>Reference refreshed: </span><strong>{detailTargetResult.referenceRefreshed ? "YES" : "NO"}</strong></div>
            <div><span style={{ color: 'var(--text-secondary)' }}>Reference document refreshed: </span><strong>{detailTargetResult.referenceDocumentRefreshed ? "YES" : "NOT APPLICABLE"}</strong></div>
            <div><span style={{ color: 'var(--text-secondary)' }}>Last Sync: </span><strong>{new Date(detailTargetResult.completedAt).toLocaleString("en-IN")}</strong></div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px', padding: '16px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
        <div>
          <h4 style={{ margin: '0 0 12px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontSize: '12px' }}>Current Document</h4>
          <p style={{ margin: '0 0 8px', fontSize: '13px' }}><span style={{ color: 'var(--text-secondary)' }}>Document:</span> <strong className="audit-link">{currentDoc.number}</strong></p>
          <p style={{ margin: '0 0 8px', fontSize: '13px' }}><span style={{ color: 'var(--text-secondary)' }}>Date:</span> {currentDoc.date}</p>
          <p style={{ margin: '0 0 8px', fontSize: '13px' }}><span style={{ color: 'var(--text-secondary)' }}>{currentDoc.type === 'INVOICE' ? 'Customer' : 'Vendor'}:</span> {currentDoc.customerOrVendor}</p>
          <p style={{ margin: '0 0 8px', fontSize: '13px' }}><span style={{ color: 'var(--text-secondary)' }}>Submitted by:</span> {currentDoc.submittedBy || '—'}</p>
          <p style={{ margin: 0, fontSize: '13px' }}><span style={{ color: 'var(--text-secondary)' }}>Zoho Status:</span> <span className="badge-semantic neutral">{currentDoc.zohoStatus}</span></p>
        </div>
        <div>
          <h4 style={{ margin: '0 0 12px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontSize: '12px' }}>Reference Document</h4>
          <p style={{ margin: '0 0 8px', fontSize: '13px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Reference:</span>{' '}
            <strong className={currentDoc.relatedDocumentRef ? "audit-link" : ""}>{currentDoc.relatedDocumentRef || "None provided"}</strong>
            {currentDoc.nativeReferenceNumber && currentDoc.nativeReferenceNumber !== currentDoc.relatedDocumentRef && (
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginLeft: '8px' }}>
                (Native Ref#: {currentDoc.nativeReferenceNumber})
              </span>
            )}
          </p>
          {currentDoc.referenceDate && <p style={{ margin: '0 0 8px', fontSize: '13px' }}><span style={{ color: 'var(--text-secondary)' }}>{refType} Date:</span> {currentDoc.referenceDate}</p>}
          {currentDoc.referenceCustomer && <p style={{ margin: '0 0 8px', fontSize: '13px' }}><span style={{ color: 'var(--text-secondary)' }}>{refType} {currentDoc.type === 'BILL' ? 'Vendor' : 'Customer Name'}:</span> {currentDoc.referenceCustomer}</p>}
          {currentDoc.referenceSubmittedBy && <p style={{ margin: '0 0 8px', fontSize: '13px' }}><span style={{ color: 'var(--text-secondary)' }}>{refType} Submitted by:</span> {currentDoc.referenceSubmittedBy}</p>}
          <p style={{ margin: '0 0 8px', fontSize: '13px' }}><span style={{ color: 'var(--text-secondary)' }}>Verification:</span> <span className={`badge-semantic ${currentDoc.verificationStatus === 'MATCHED' ? 'success' : currentDoc.verificationStatus === 'MISMATCH' ? 'danger' : 'warning'}`}>{currentDoc.verificationStatus.replace(/_/g, " ")}</span></p>
          <p style={{ margin: 0, fontSize: '13px' }}><span style={{ color: 'var(--text-secondary)' }}>Genuine Issues:</span> <strong>{currentDoc.mismatchCount}</strong></p>
        </div>
      </div>

      <div className="metrics-grid" style={{ marginBottom: 24, gridTemplateColumns: currentDoc.type === 'PO' ? 'repeat(5, 1fr)' : 'repeat(4, 1fr)' }}>
        <div className="metric-card">
          <div className="metric-card-title">Matched</div>
          <div className="metric-card-value">{currentDoc.items.filter(i => i.mismatchType === 'MATCHED').length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-title">Partial</div>
          <div className="metric-card-value">{currentDoc.items.filter(i => i.mismatchType === 'PARTIAL_WITHIN_REFERENCE').length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-title" style={{ color: 'var(--google-red)' }}>Mismatch</div>
          <div className="metric-card-value">{currentDoc.items.filter(i => i.mismatchType !== 'MATCHED' && i.mismatchType !== 'PARTIAL_WITHIN_REFERENCE' && i.mismatchType !== 'NOT_INCLUDED_IN_CURRENT_DOCUMENT' && i.mismatchType !== 'UOM_EVIDENCE_MISSING' && i.mismatchType !== 'ITEM_MAPPING_REQUIRED' && i.mismatchType !== 'AMBIGUOUS_REFERENCE_LINE').length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-title">Unmapped / Ambiguous</div>
          <div className="metric-card-value">{currentDoc.items.filter(i => i.mismatchType === 'ITEM_MAPPING_REQUIRED' || i.mismatchType === 'AMBIGUOUS_REFERENCE_LINE').length}</div>
        </div>
        {currentDoc.type === 'PO' && (
          <div className="metric-card">
            <div className="metric-card-title" style={{ color: 'var(--google-red)' }}>Rate Alerts</div>
            <div className="metric-card-value">{currentDoc.items.filter(i => i.rateCheckStatus === 'ALERT').length}</div>
          </div>
        )}
      </div>

      <h4 className="font-medium mb-4" style={{ textTransform: "uppercase" }}>
        {currentDoc.number} ITEMS — APPROVAL CHECK
      </h4>
      <div style={{ overflowX: 'auto', marginBottom: "32px" }}>
        <table className="data-table" style={{ width: '100%', whiteSpace: 'nowrap' }}>
          <thead>
            <tr>
              <th>Line</th>
              <th>Item Name</th>
              <th>Narration</th>
              <th>{refType} Reference Line</th>
              <th className="right">{refType} Qty</th>
              <th className="right">{refType} Rate</th>
              <th className="right">{refType} Taxable Amount</th>
              <th className="right">Previous {currentDoc.type} Qty</th>
              <th className="right">Current {currentDoc.type} Qty</th>
              <th className="right">{currentDoc.type} Rate</th>
              <th className="right">{currentDoc.type} Taxable Amount</th>
              <th className="right">Cumulative {currentDoc.type} Qty</th>
              <th className="right">Balance / Excess</th>
              {currentDoc.type === 'PO' && <th>Rate Check</th>}
              {currentDoc.type === 'INVOICE' && <th>UOM</th>}
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {currentItems.map((item, idx) => {
              let isMismatch = item.mismatchType !== 'MATCHED' && item.mismatchType !== 'PARTIAL_WITHIN_REFERENCE' && item.mismatchType !== 'UOM_EVIDENCE_MISSING';
              const isUnmapped = item.expectedQty === null;
              let balanceStr = 'CANNOT DETERMINE';
              if (!isUnmapped) {
                const balanceOrExcess = (item.expectedQty as number) - (item.cumulativeQty as number);
                balanceStr = balanceOrExcess < 0 ? `EXCESS ${Math.abs(balanceOrExcess)}` : balanceOrExcess.toString();
              }

              const globalIdx = currentDoc.items.indexOf(item);
              const isExpanded = expandedItemIdx === globalIdx;

              return (
                <React.Fragment key={idx}>
                  <tr
                    className="clickable"
                    onClick={() => setExpandedItemIdx(isExpanded ? null : globalIdx)}
                    style={{ backgroundColor: isMismatch ? 'var(--bg-danger)' : (isExpanded ? 'var(--bg-secondary)' : 'inherit') }}
                  >
                    <td>{item.displayLineNumber || idx + 1}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: '150px', maxWidth: '200px' }}>{item.itemName}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: '150px', maxWidth: '250px', color: 'var(--text-secondary)', fontSize: '12px' }}>{item.narration === "" ? "—" : item.narration}</td>
                    <td>{item.refDisplayLineNumber || (item.mismatchType === 'AMBIGUOUS_REFERENCE_LINE' ? 'AMBIGUOUS' : 'UNMAPPED')}</td>
                    <td className="right">{isUnmapped ? 'UNKNOWN / —' : item.expectedQty}</td>
                    <td className="right">{isUnmapped ? 'UNKNOWN / —' : formatMoney(item.refRate)}</td>
                    <td className="right">{isUnmapped ? 'UNKNOWN / —' : formatMoney(item.refAmount)}</td>
                    <td className="right">{isUnmapped ? '—' : item.previousQty}</td>
                    <td className="right" style={{ fontWeight: 600 }}>{item.actualQty}</td>
                    <td className="right">{formatMoney(item.rate)}</td>
                    <td className="right">{formatMoney(item.amount)}</td>
                    <td className="right">{isUnmapped ? 'UNKNOWN / —' : item.cumulativeQty}</td>
                    <td className="right">{balanceStr}</td>
                    {currentDoc.type === 'PO' && (
                      <td>
                        {item.rateCheckStatus === 'ALERT' ? (
                          <span style={{ color: 'var(--google-red)', fontWeight: 600 }}>PO RATE HIGHER THAN SO RATE</span>
                        ) : item.rateCheckStatus === 'OK' ? (
                          <span style={{ color: 'var(--google-green, #10b981)', fontWeight: 600 }}>OK</span>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)' }}>CANNOT DETERMINE</span>
                        )}
                      </td>
                    )}
                    {currentDoc.type === 'INVOICE' && (
                      <td>
                        {item.uomStatus === 'UOM_MATCH' ? (
                          <span style={{ color: 'var(--google-green, #10b981)', fontWeight: 600 }}>MATCH</span>
                        ) : item.uomStatus === 'UOM_MISMATCH' ? (
                          <span style={{ color: 'var(--google-red)', fontWeight: 600 }}>MISMATCH</span>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)' }}>{isUnmapped ? '—' : 'UNKNOWN'}</span>
                        )}
                      </td>
                    )}
                    <td>
                      <span style={{ color: isMismatch ? 'var(--google-red)' : 'inherit', fontWeight: isMismatch ? 600 : 400 }}>
                        {item.mismatchType.replace(/_/g, " ")}
                        {item.uomStatus === 'UOM_MISMATCH' ? ' — UOM MISMATCH' : (!item.uomMatch && item.mismatchType !== 'ITEM_NOT_IN_SOURCE' && item.mismatchType !== 'NOT_INCLUDED_IN_CURRENT_DOCUMENT' && item.mismatchType !== 'ITEM_MAPPING_REQUIRED' && item.mismatchType !== 'AMBIGUOUS_REFERENCE_LINE' ? ' — UOM EVIDENCE MISSING' : '')}
                      </span>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={10} style={{ padding: '16px', backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ padding: '16px', background: 'white', border: '1px solid var(--border)', borderRadius: '8px' }}>
                          <h5 style={{ marginTop: 0, marginBottom: '16px', fontSize: '14px' }}>Item Verification Evidence</h5>

                          <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>{currentDoc.type} Line:</strong> {item.displayLineNumber}</p>
                          <p style={{ margin: '0 0 8px', fontSize: '11px', color: 'var(--text-secondary)' }}><strong>Line Source ID:</strong> {item.sourceLineId}</p>
                          <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>Item Name:</strong> {item.itemName}</p>
                          <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>Narration:</strong> {item.narration === "" ? "—" : item.narration}</p>
                          <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>Rate:</strong> {formatMoney(item.rate)}</p>
                          <p style={{ margin: '0 0 16px', fontSize: '13px' }}><strong>Taxable Amount:</strong> {formatMoney(item.amount)}</p>
                          <hr style={{ borderTop: '1px solid var(--border)', margin: '16px 0' }} />
                          {currentDoc.type === 'PO' && item.rateCheckStatus && (
                            <>
                              <h6 style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase' }}>Commercial Rate Check</h6>
                              <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>PO Rate:</strong> {formatMoney(item.rate)}</p>
                              <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>SO Rate:</strong> {formatMoney(item.refRate)}</p>
                              <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>SO Unit:</strong> {item.refUnit && item.refUnit.trim() !== '' ? item.refUnit : '—'}</p>
                              <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>PO Unit:</strong> {item.unit && item.unit.trim() !== '' ? item.unit : '—'}</p>
                              <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>UOM Basis:</strong> {item.uomStatus === 'UOM_MATCH' ? 'UOM MATCH' : item.uomStatus === 'UOM_MISMATCH' ? 'UOM MISMATCH — rate basis not comparable' : item.uomStatus === 'UOM_EVIDENCE_MISSING' ? 'UOM EVIDENCE MISSING — unit not synchronized' : 'NOT APPLICABLE — line not deterministically mapped'}</p>
                              {item.rateCheckStatus === 'ALERT' ? (
                                <>
                                  <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>Difference:</strong> <span style={{ color: 'var(--google-red)', fontWeight: 600 }}>{formatMoney((item.rate || 0) - (item.refRate || 0))}</span></p>
                                  <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>Premium Amount:</strong> <span style={{ color: 'var(--google-red)', fontWeight: 600 }}>{formatMoney(item.premiumAmount)}</span></p>
                                  <p style={{ margin: '0 0 16px', fontSize: '13px' }}><strong>Premium %:</strong> <span style={{ color: 'var(--google-red)', fontWeight: 600 }}>{item.premiumPercentage ? `${item.premiumPercentage.toFixed(2)}%` : '—'}</span></p>
                                </>
                              ) : (
                                <p style={{ margin: '0 0 16px', fontSize: '13px' }}><strong>Status:</strong> {item.rateCheckStatus}</p>
                              )}
                              <hr style={{ borderTop: '1px solid var(--border)', margin: '16px 0' }} />
                            </>
                          )}
                          {currentDoc.type === 'INVOICE' && item.uomStatus && (
                            <>
                              <h6 style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase' }}>UOM Evidence</h6>
                              <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>Invoice Unit:</strong> {item.unit && item.unit.trim() !== '' ? item.unit : '—'}</p>
                              <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>SO Unit:</strong> {item.refUnit && item.refUnit.trim() !== '' ? item.refUnit : '—'}</p>
                              <p style={{ margin: '0 0 16px', fontSize: '13px' }}><strong>UOM Status:</strong> {item.uomStatus === 'UOM_MATCH' ? 'UOM MATCH' : item.uomStatus === 'UOM_MISMATCH' ? 'UOM MISMATCH — unit basis not comparable' : 'UOM EVIDENCE MISSING — unit not synchronized'}</p>
                              <hr style={{ borderTop: '1px solid var(--border)', margin: '16px 0' }} />
                            </>
                          )}
                          <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>Reference {refType} Mapping:</strong> {item.refDisplayLineNumber ? `MATCHED (${item.refDisplayLineNumber})` : (item.refLineId ? `MATCHED (${item.refLineId})` : item.mismatchType.replace(/_/g, " "))}</p>

                          {currentDoc.type === 'PO' && (item.mismatchType === 'ITEM_MAPPING_REQUIRED' || item.mismatchType === 'AMBIGUOUS_REFERENCE_LINE') && (
                            <LineMappingPanel
                              sourceLineId={item.sourceLineId}
                              purchaseorderId={currentDoc.id}
                              itemName={item.itemName}
                              mismatchType={item.mismatchType}
                            />
                          )}

                          {currentDoc.type === 'INVOICE' && (item.mismatchType === 'ITEM_MAPPING_REQUIRED' || item.mismatchType === 'AMBIGUOUS_REFERENCE_LINE') && (
                            <InvoiceLineMappingPanel
                              sourceLineId={item.sourceLineId}
                              invoiceId={currentDoc.id}
                              itemName={item.itemName}
                              mismatchType={item.mismatchType}
                            />
                          )}

                          {!isUnmapped && (
                            <>
                              <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>Reference {refType} Narration:</strong> {item.refNarration === "" ? "—" : (item.refNarration || "—")}</p>
                              <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>Reference {refType} Qty:</strong> {item.expectedQty}</p>
                              <p style={{ margin: '0 0 8px', fontSize: '13px' }}><strong>Reference {refType} Rate:</strong> {formatMoney(item.refRate)}</p>
                              <p style={{ margin: '0 0 16px', fontSize: '13px' }}><strong>Reference {refType} Taxable Amount:</strong> {formatMoney(item.refAmount)}</p>
                              <h6 style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase' }}>Previous {currentDoc.type} Documents Mapped to This Exact Line:</h6>
                              {(!item.previousDocuments || item.previousDocuments.length === 0) ? (
                                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>No previous related {currentDoc.type} quantity found for this exact line.</p>
                              ) : (
                                <table className="data-table" style={{ marginBottom: '16px', width: 'auto' }}>
                                  <thead>
                                    <tr>
                                      <th>{currentDoc.type} Number</th>
                                      <th>Date</th>
                                      <th className="right">Qty</th>
                                      <th>Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {item.previousDocuments.map((pd, pidx) => (
                                      <tr key={pidx}>
                                        <td className="audit-link">{pd.number}</td>
                                        <td>{pd.date}</td>
                                        <td className="right">{pd.qty}</td>
                                        <td><span className="badge-semantic neutral">{pd.status}</span></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}

                              <p style={{ margin: '0 0 4px', fontSize: '13px' }}><strong>Already {currentDoc.type} Qty (Line specific):</strong> {item.previousQty}</p>
                              <p style={{ margin: '0 0 4px', fontSize: '13px' }}><strong>Current {currentDoc.type} Qty for this line:</strong> {item.actualQty}</p>
                              <p style={{ margin: '0 0 16px', fontSize: '13px' }}><strong>Cumulative Qty:</strong> {item.cumulativeQty}</p>

                              <p style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: balanceStr.startsWith('EXCESS') ? 'var(--google-red)' : 'inherit' }}>
                                {balanceStr.startsWith('EXCESS') ? 'EXCESS OVER REFERENCE QTY:' : 'REMAINING AFTER THIS DOCUMENT:'} {balanceStr.replace('EXCESS ', '')}
                              </p>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {currentItems.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center' }}>No items found or unresolved reference.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {remainingItems.length > 0 && (
        <>
          <h4 className="font-medium mb-4" style={{ textTransform: "uppercase" }}>
            {currentDoc.relatedDocumentRef || refType} ITEMS — {currentDoc.type === 'PO' ? 'REMAINING PROCUREMENT' : (currentDoc.type === 'INVOICE' ? 'REMAINING / NOT YET INVOICED' : 'REMAINING / NOT YET BILLED')}
          </h4>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>{refType} Line</th>
                  <th>Item Name</th>
                  <th>Narration</th>
                  <th className="right">{refType} Qty</th>
                  <th className="right">{refType} Rate</th>
                  <th className="right">{refType} Taxable Amount</th>
                  <th className="right">Already {currentDoc.type} Qty</th>
                  <th className="right">Remaining Qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {remainingItems.map((item, idx) => {
                  const globalIdx = currentDoc.items.indexOf(item);
                  const isExpanded = expandedItemIdx === globalIdx;
                  return (
                    <React.Fragment key={idx}>
                      <tr
                        className="clickable"
                        onClick={() => setExpandedItemIdx(isExpanded ? null : globalIdx)}
                        style={{ color: 'var(--text-secondary)', backgroundColor: isExpanded ? 'var(--bg-secondary)' : 'inherit' }}
                      >
                        <td>{item.displayLineNumber || idx + 1}</td>
                        <td style={{ whiteSpace: 'normal', minWidth: '150px', maxWidth: '200px' }}>{item.itemName}</td>
                        <td style={{ whiteSpace: 'normal', minWidth: '150px', maxWidth: '250px', fontSize: '12px' }}>{item.narration === "" ? "—" : item.narration}</td>
                        <td className="right">{item.expectedQty}</td>
                        <td className="right">{formatMoney(item.refRate)}</td>
                        <td className="right">{formatMoney(item.refAmount)}</td>
                        <td className="right">{item.previousQty}</td>
                        <td className="right">{Math.max(0, (item.expectedQty as number) - (item.previousQty as number))}</td>
                        <td>
                          <span className="badge-semantic neutral">
                            NOT INCLUDED IN CURRENT {currentDoc.type}
                          </span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} style={{ padding: '16px', backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ padding: '16px', background: 'white', border: '1px solid var(--border)', borderRadius: '8px' }}>
                              <h5 style={{ marginTop: 0, marginBottom: '16px', fontSize: '14px', color: 'black' }}>Remaining Item Evidence</h5>

                              <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'black' }}><strong>{refType} Line:</strong> {item.displayLineNumber}</p>
                              <p style={{ margin: '0 0 8px', fontSize: '11px', color: 'var(--text-secondary)' }}><strong>Line Source ID:</strong> {item.sourceLineId}</p>
                              <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'black' }}><strong>Item Name:</strong> {item.itemName}</p>
                              <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'black' }}><strong>Narration:</strong> {item.narration === "" ? "—" : item.narration}</p>
                              <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'black' }}><strong>Reference {refType} Qty:</strong> {item.expectedQty}</p>
                              <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'black' }}><strong>Reference {refType} Rate:</strong> {formatMoney(item.refRate)}</p>
                              <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'black' }}><strong>Reference {refType} Taxable Amount:</strong> {formatMoney(item.refAmount)}</p>

                              <h6 style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', marginTop: '16px', textTransform: 'uppercase' }}>Previous {currentDoc.type} Documents:</h6>
                              {(!item.previousDocuments || item.previousDocuments.length === 0) ? (
                                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>No previous related {currentDoc.type} quantity found for this exact line.</p>
                              ) : (
                                <table className="data-table" style={{ marginBottom: '16px', width: 'auto' }}>
                                  <thead>
                                    <tr>
                                      <th>{currentDoc.type} Number</th>
                                      <th>Date</th>
                                      <th className="right">Qty</th>
                                      <th>Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {item.previousDocuments.map((pd, pidx) => (
                                      <tr key={pidx}>
                                        <td
                                          className="audit-link clickable"
                                          onClick={async () => {
                                            const found = allDocs?.find(d => d.number === pd.number);
                                            if (found) {
                                              setPreviewDoc(found);
                                            } else {
                                              try {
                                                const res = await fetch(`/api/audit/approval-pending?docNumber=${encodeURIComponent(pd.number)}`);
                                                if (res.ok) {
                                                  const data = await res.json();
                                                  if (data.documents && data.documents.length > 0) {
                                                    setPreviewDoc(data.documents[0]);
                                                  } else {
                                                    alert(`Document ${pd.number} details are not available.`);
                                                  }
                                                }
                                              } catch (e) {
                                                alert("Failed to load document details");
                                              }
                                            }
                                          }}
                                          style={{ cursor: 'pointer' }}
                                          title="View document details"
                                        >
                                          {pd.number}
                                        </td>
                                        <td>{pd.date}</td>
                                        <td className="right">{pd.qty}</td>
                                        <td><span className="badge-semantic neutral">{pd.status}</span></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}

                              <p style={{ margin: '0 0 4px', fontSize: '13px', color: 'black' }}><strong>Already {currentDoc.type} Qty (Line specific):</strong> {item.previousQty}</p>
                              <p style={{ margin: '0 0 4px', fontSize: '13px', color: 'black' }}><strong>Current {currentDoc.type} Qty for this line:</strong> 0</p>
                              <p style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: 'black' }}>
                                <strong>Remaining:</strong> {Math.max(0, (item.expectedQty as number) - (item.previousQty as number))}
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Nested Drawer for Previous Documents */}
      {previewDoc && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 3000,
            backgroundColor: 'rgba(15, 23, 42, 0.5)', display: 'flex', justifyContent: 'flex-end',
            backdropFilter: 'blur(2px)'
          }}
          onClick={() => setPreviewDoc(null)}
        >
          <div
            style={{
              width: 'min(90%, 1200px)', height: '100%',
              backgroundColor: '#f8fafc', boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.2)',
              overflowY: 'auto', display: 'flex', flexDirection: 'column'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '12px 24px', background: 'white', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10 }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Nested Document View</h3>
              <button onClick={() => setPreviewDoc(null)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#64748b' }}>×</button>
            </div>
            <div style={{ flex: 1, padding: '24px' }}>
              <ApprovalDetailWorkspace doc={previewDoc} onClose={() => setPreviewDoc(null)} allDocs={allDocs} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import "./AccountsAuditView.css";
import { PeriodFilter, PeriodFilterState } from "./PeriodFilter";
import { SectionSyncControl } from "./SectionSyncControl";

export default function BankReconciliationWorkspace() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [statements, setStatements] = useState<any[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [selectedStatementId, setSelectedStatementId] = useState<string>("");
  const [reconciliation, setReconciliation] = useState<any>(null);
  const money = (val: number | string | null | undefined) => {
    if (val == null) return "₹0.00";
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return isNaN(num) ? "₹0.00" : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  };
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterState>({ period: "CURRENT_FY" });

  // Add Source Form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newOrgId, setNewOrgId] = useState("");
  const [newBankId, setNewBankId] = useState("");
  const [newFolderPath, setNewFolderPath] = useState("");

  useEffect(() => {
    fetchSources();
  }, []);

  async function fetchSources() {
    setLoading(true);
    try {
      const [res, accRes] = await Promise.all([
        fetch("/api/audit/bank-reconciliation?action=sources"),
        fetch("/api/audit/bank-reconciliation?action=accounts")
      ]);
      const data = await res.json();
      const accData = await accRes.json();
      if (res.ok) setSources(data.sources || []);
      else setError(data.error);
      
      if (accRes.ok) setAccounts(accData.accounts || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchStatements(sourceId: string) {
    setSelectedSourceId(sourceId);
    setSelectedStatementId("");
    setReconciliation(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/audit/bank-reconciliation?action=statements&sourceId=${sourceId}`);
      const data = await res.json();
      if (res.ok) setStatements(data.statements || []);
      else setError(data.error);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function syncSource(sourceId: string) {
    setLoading(true);
    try {
      const res = await fetch("/api/audit/bank-reconciliation?action=sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Sync Complete: Imported ${data.result.imported}, Skipped ${data.result.skipped}, Errors: ${data.result.errors.length}`);
        fetchStatements(sourceId);
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddSource(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/audit/bank-reconciliation?action=add-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: newOrgId,
          bankAccountId: newBankId,
          folderPath: newFolderPath
        })
      });
      const data = await res.json();
      if (res.ok) {
        setShowAddForm(false);
        setNewOrgId("");
        setNewBankId("");
        setNewFolderPath("");
        fetchSources();
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function viewReconciliation(stmt: any) {
    setSelectedStatementId(stmt.statement_id);
    setLoading(true);
    try {
      const res = await fetch(`/api/audit/bank-reconciliation?action=reconciliation&sourceId=${selectedSourceId}&statementId=${stmt.statement_id}`);
      const data = await res.json();
      if (res.ok) {
        setReconciliation(data);
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="section-card">
      <div className="section-header flex justify-between items-start">
        <div>
          <h2 className="section-title">Bank Reconciliation Workspace</h2>
          <div className="flex gap-2 mt-2 items-center">
            <span className="badge-semantic success inline-block">ZOHO WRITE: 0</span>
            <button className="period-filter-apply-btn" onClick={() => setShowAddForm(!showAddForm)} style={{ padding: '4px 12px', height: '24px', fontSize: '12px' }}>
              {showAddForm ? "Cancel" : "+ Add Local Folder"}
            </button>
          </div>
        </div>
        <SectionSyncControl 
          sectionKey="BANK" 
          period={periodFilter} 
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <PeriodFilter value={periodFilter} onChange={setPeriodFilter} />
      </div>

      {error && <div className="audit-error">{error}</div>}

      {showAddForm && (
        <form onSubmit={handleAddSource} className="bg-slate-50 p-4 border border-slate-200 rounded mb-6">
          <h3 className="font-semibold text-slate-800 mb-4">Add Bank Statement Source</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm mb-1">Bank Account</label>
              <select required value={newBankId} onChange={e => {
                const acc = accounts.find(a => a.account_id === e.target.value);
                setNewBankId(e.target.value);
                if (acc) setNewOrgId(acc.organization_id);
              }} className="w-full px-3 py-2 border rounded">
                <option value="">Select Account...</option>
                {accounts.map(acc => {
                  const numStr = acc.account_number ? String(acc.account_number) : "";
                  const masked = numStr.length > 4 ? numStr.slice(-4).padStart(numStr.length, '*') : numStr;
                  return (
                    <option key={acc.account_id} value={acc.account_id}>
                      {acc.account_name} ({masked}) - {acc.organization_id}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1">Absolute Folder Path (CSV Only)</label>
              <input type="text" required value={newFolderPath} onChange={e => setNewFolderPath(e.target.value)} className="w-full px-3 py-2 border rounded" placeholder="/path/to/bank/statements" />
            </div>
          </div>
          <button type="submit" disabled={loading} className="audit-btn bg-blue-600 text-white">Save Configuration</button>
        </form>
      )}

      {/* Sources Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6" style={{ marginTop: '16px' }}>
        {sources.map(src => (
          <div key={src.source_id} 
               className={`metric-card clickable ${selectedSourceId === src.source_id ? 'border-blue-500 bg-blue-50' : ''}`}
               onClick={() => fetchStatements(src.source_id)}
               style={{ alignItems: 'flex-start', padding: '16px' }}>
            <div className="metric-card-title mb-1">{src.organization_id} • {src.bank_account_id}</div>
            <div className="text-sm font-medium break-all mb-3 text-slate-800" title={src.folder_path}>📁 {src.folder_path.split('/').pop() || src.folder_path}</div>
            <button className="period-filter-apply-btn mt-auto" style={{ padding: '4px 8px', fontSize: '11px', height: 'auto' }}
                    onClick={(e) => { e.stopPropagation(); syncSource(src.source_id); }}>
              Sync Statements
            </button>
          </div>
        ))}
      </div>

      {selectedSourceId && !selectedStatementId && (
        <div style={{ marginTop: '24px' }}>
          <h3 className="section-title mb-4">Imported Statements</h3>
          {statements.length === 0 ? (
            <p className="text-sm text-slate-500">No statements imported yet. Click "Sync Statements" to scan the folder.</p>
          ) : (
            <div className="table-scroll-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>File Name</th>
                    <th>Period</th>
                    <th>Imported At</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {statements.map(stmt => (
                    <tr key={stmt.statement_id}>
                      <td style={{ fontWeight: 500 }}>{stmt.file_name}</td>
                      <td>{stmt.period_from} to {stmt.period_to}</td>
                      <td>{new Date(stmt.imported_at).toLocaleString()}</td>
                      <td>
                        <span className="badge-semantic neutral">
                          {stmt.status}
                        </span>
                      </td>
                      <td>
                        <button className="audit-link" onClick={() => viewReconciliation(stmt)}>
                          View Reconciliation
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {selectedStatementId && reconciliation && (
        <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border)' }}>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="section-title">Reconciliation Report</h3>
              <p className="text-sm text-slate-500 mt-1">Statement: {statements.find(s => s.statement_id === selectedStatementId)?.file_name}</p>
            </div>
            <button className="audit-link" onClick={() => setSelectedStatementId("")}>
              ← Back to Statements
            </button>
          </div>

          <div className="metrics-grid mb-6">
            <div className="metric-card">
              <div className="metric-card-title" style={{ color: 'var(--google-green)' }}>EXACT MATCH</div>
              <div className="metric-card-value">{reconciliation.summary.exact}</div>
            </div>
            <div className="metric-card">
              <div className="metric-card-title" style={{ color: 'var(--google-amber)' }}>DATE MISMATCH (±2 Days)</div>
              <div className="metric-card-value">{reconciliation.summary.dateMismatch}</div>
            </div>
            <div className="metric-card">
              <div className="metric-card-title" style={{ color: 'var(--google-red)' }}>UNMATCHED</div>
              <div className="metric-card-value">{reconciliation.summary.unmatched}</div>
            </div>
            <div className="metric-card">
              <div className="metric-card-title">MATCHED VALUE</div>
              <div className="metric-card-value">{money(reconciliation.summary.matchedAmount)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-card-title">UNMATCHED VALUE</div>
              <div className="metric-card-value">{money(reconciliation.summary.unmatchedAmount)}</div>
            </div>
          </div>

          <div className="table-scroll-container">
            <table className="data-table text-sm">
              <thead>
                <tr>
                  <th className="bg-slate-100" colSpan={4}>BANK STATEMENT (EVIDENCE)</th>
                  <th className="bg-blue-50" colSpan={3}>ZOHO BOOKS (RECORD)</th>
                  <th className="w-32">MATCH STATUS</th>
                </tr>
                <tr>
                  <th className="bg-slate-50">Date</th>
                  <th className="bg-slate-50">Description</th>
                  <th className="bg-slate-50 right">Debit</th>
                  <th className="bg-slate-50 right">Credit</th>
                  <th className="bg-blue-50/50">Date</th>
                  <th className="bg-blue-50/50">Ref / Type</th>
                  <th className="bg-blue-50/50 right">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.matches.map((m: any, i: number) => {
                  let badgeClass = 'badge-semantic neutral';
                  if (m.matchStatus === 'EXACT_MATCH') badgeClass = 'badge-semantic success';
                  if (m.matchStatus === 'DATE_MISMATCH') badgeClass = 'badge-semantic warning';
                  if (m.matchStatus === 'UNMATCHED') badgeClass = 'badge-semantic danger';

                  return (
                    <tr key={i} className={m.matchStatus === 'UNMATCHED' ? 'bg-red-50/20' : ''}>
                      {/* Bank Side */}
                      <td className="whitespace-nowrap">{m.bankTx.date}</td>
                      <td className="truncate max-w-[200px]" title={m.bankTx.description}>{m.bankTx.description}</td>
                      <td className="amount right text-red-600">{m.bankTx.debit > 0 ? money(m.bankTx.debit) : ''}</td>
                      <td className="amount right text-green-600">{m.bankTx.credit > 0 ? money(m.bankTx.credit) : ''}</td>
                      
                      {/* Books Side */}
                      <td className="whitespace-nowrap bg-blue-50/10 text-slate-600">{m.booksTx ? m.booksTx.date : '-'}</td>
                      <td className="truncate max-w-[150px] bg-blue-50/10 text-slate-600" title={m.booksTx?.reference_number}>{m.booksTx ? (m.booksTx.reference_number || m.booksTx.transaction_type) : '-'}</td>
                      <td className="amount right bg-blue-50/10 text-slate-800">
                        {m.booksTx ? money(Math.abs(m.booksTx.amount)) : '-'}
                      </td>
                      
                      <td>
                        <span className={badgeClass}>{m.matchStatus.replace(/_/g, " ")}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { PeriodFilter, PeriodFilterState } from "./PeriodFilter";
import { SectionSyncControl } from "./SectionSyncControl";

export default function CommercialTraceView() {
  const money = (val: number | string | null | undefined) => {
    if (val == null || val === "UNRESOLVED" || val === "LOCAL_DATA_INCOMPLETE" || val === "INCOMPLETE") return String(val || "-");
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return isNaN(num) ? "0.00" : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  };
  const pct = (val: number | null | undefined) => {
    if (val == null) return "-";
    return new Intl.NumberFormat('en-IN', { style: 'percent', minimumFractionDigits: 2 }).format(val / 100);
  };
  
  const getRelBadgeClass = (rel: string) => {
    if (rel === 'DIRECT_ID') return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    if (rel === 'REFERENCE_SUPPORTED') return 'bg-blue-100 text-blue-800 border-blue-300';
    if (rel === 'OWNER_APPROVED_MAPPING') return 'bg-purple-100 text-purple-800 border-purple-300';
    if (rel === 'CANDIDATE') return 'bg-amber-100 text-amber-800 border-amber-300';
    if (rel === 'AMBIGUOUS') return 'bg-orange-100 text-orange-800 border-orange-300';
    if (rel === 'UNLINKED') return 'bg-slate-100 text-slate-800 border-slate-300';
    return 'bg-slate-100 text-slate-800';
  };
  
  const getSeverityClass = (sev: string) => {
    if (sev === 'CRITICAL') return 'bg-red-50 text-red-800 border-red-200';
    if (sev === 'WARNING') return 'bg-amber-50 text-amber-800 border-amber-200';
    return 'bg-blue-50 text-blue-800 border-blue-200';
  };

  const [customers, setCustomers] = useState<{ customer_id: string; customer_name: string }[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  const [selectedSoNumber, setSelectedSoNumber] = useState("");
  const [isAllSoMode, setIsAllSoMode] = useState(false);
  const [soSearch, setSoSearch] = useState("");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterState>({ period: "CURRENT_FY" });

  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch("/api/audit/commercial-trace/customers");
      const data = await res.json();
      if (data.customers && data.customers.length > 0) {
        setCustomers(data.customers);
        setInfoMessage(null);
      } else {
        setInfoMessage("No synchronized Sales Order data available.");
      }
    } catch (err) {
      console.error("Failed to fetch local customers:", err);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  useEffect(() => {
    if (!isAllSoMode) {
      setSelectedSoNumber("");
    }
    setTrace(null);
    setSalesOrders([]);
    setError(null);
    setInfoMessage(null);
    setSoSearch("");

    if (!selectedCustomerId) return;

    async function fetchSOs() {
      try {
        const params = new URLSearchParams();
        params.append("customer_id", selectedCustomerId);
        if (periodFilter.customFrom) params.append("from", periodFilter.customFrom);
        if (periodFilter.customTo) params.append("to", periodFilter.customTo);
        params.append("period", periodFilter.period);

        const res = await fetch(`/api/audit/commercial-trace/sales-orders?${params.toString()}`);
        const data = await res.json();
        if (data.salesOrders && data.salesOrders.length > 0) {
          setSalesOrders(data.salesOrders);
        } else {
          setInfoMessage("No Sales Orders found for this customer in the selected period.");
        }
      } catch (err) {
        console.error("Failed to fetch local sales orders:", err);
      }
    }
    fetchSOs();
  }, [selectedCustomerId, periodFilter, isAllSoMode]);

  const fetchTrace = async () => {
    if (!isAllSoMode && !selectedSoNumber) return;
    setLoading(true);
    setError(null);
    setTrace(null);
    try {
      const params = new URLSearchParams();
      if (periodFilter.customFrom) params.append("from", periodFilter.customFrom);
      if (periodFilter.customTo) params.append("to", periodFilter.customTo);
      params.append("period", periodFilter.period);
      
      const qs = params.toString() ? `&${params.toString()}` : "";
      const url = isAllSoMode
        ? `/api/audit/commercial-trace?so_number=ALL&customer_id=${encodeURIComponent(selectedCustomerId)}${qs}`
        : `/api/audit/commercial-trace?so_number=${encodeURIComponent(selectedSoNumber)}${qs}`;
      
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch trace");
      }
      setTrace(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredCustomers = customers.filter(c => c.customer_name.toLowerCase().includes(customerSearch.toLowerCase()));
  const filteredSOs = salesOrders.filter(so => so.salesorder_number.toLowerCase().includes(soSearch.toLowerCase()));

  return (
    <div className="section-card">
      <div className="section-header flex justify-between items-start">
        <div>
          <h3 className="section-title">Commercial Trace (Phase 1)</h3>
          <span className="badge-semantic success mt-2 inline-block">ZOHO WRITE: 0</span>
        </div>
        <SectionSyncControl sectionKey="COMMERCIAL_TRACE" period={periodFilter} onSyncComplete={fetchCustomers} />
      </div>
      
      <div style={{ padding: '16px' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '24px' }}>
          
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label className="period-filter-label" style={{ display: 'block', marginBottom: '4px' }}>Customer</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input type="text" placeholder="Search..." value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} style={{ width: '40%', padding: '6px 12px', border: '1px solid var(--border)', borderRadius: '4px' }} />
              <select value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)} style={{ flex: 1, padding: '6px 12px', border: '1px solid var(--border)', borderRadius: '4px' }}>
                <option value="">Select Customer ▼</option>
                {filteredCustomers.map(c => <option key={c.customer_id} value={c.customer_id}>{c.customer_name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: '200px' }}>
            <div className="flex justify-between items-center mb-1">
              <label className="period-filter-label" style={{ display: 'block' }}>Sales Order</label>
              <label className="text-xs flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={isAllSoMode} onChange={(e) => { setIsAllSoMode(e.target.checked); if (e.target.checked) setSelectedSoNumber(""); }} disabled={!selectedCustomerId || salesOrders.length === 0} />
                All SO
              </label>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input type="text" placeholder="Search SO..." value={soSearch} onChange={(e) => setSoSearch(e.target.value)} disabled={!selectedCustomerId || isAllSoMode} style={{ width: '40%', padding: '6px 12px', border: '1px solid var(--border)', borderRadius: '4px' }} />
              <select value={isAllSoMode ? "ALL" : selectedSoNumber} onChange={(e) => setSelectedSoNumber(e.target.value)} disabled={!selectedCustomerId || isAllSoMode} style={{ flex: 1, padding: '6px 12px', border: '1px solid var(--border)', borderRadius: '4px' }}>
                {isAllSoMode ? (
                  <option value="ALL">All Sales Orders for Customer</option>
                ) : (
                  <>
                    <option value="">{!selectedCustomerId ? "Select customer first" : "Select SO ▼"}</option>
                    {filteredSOs.map(so => <option key={so.salesorder_id} value={so.salesorder_number}>{so.salesorder_number} ({so.date}) - {so.currency} {so.total}</option>)}
                  </>
                )}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '2px' }}><PeriodFilter value={periodFilter} onChange={setPeriodFilter} /></div>
        </div>

        <button className="btn-primary" onClick={fetchTrace} disabled={!selectedCustomerId || (!isAllSoMode && !selectedSoNumber) || loading} style={{ width: '100%', marginBottom: '24px' }}>
          {loading ? "Tracing..." : "Run Commercial Trace"}
        </button>

        {infoMessage && !trace && !error && <div className="p-4 bg-blue-50 text-blue-700 border border-blue-200 rounded mb-4 italic">{infoMessage}</div>}
        {error && <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded mb-4">{error}</div>}

        {trace && (
          <div className="space-y-8 mt-8 border-t border-slate-200 pt-6">
            
            {/* DOCUMENT TRACE */}
            <section>
              <h3 className="text-lg font-medium text-slate-800 mb-4">DOCUMENT TRACE</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium text-slate-600 mb-2 border-b pb-2">Sales Cycle</h4>
                  {trace.salesOrders.map((so: any) => (
                    <div key={so.zohoId} className="mb-4 p-4 border rounded shadow-sm bg-white">
                      <div className="flex justify-between mb-2">
                        <span className="font-bold text-slate-800">SO: {so.documentNumber}</span>
                        <span className={`text-xs px-2 py-1 rounded border ${getRelBadgeClass(so.relationshipClassification)}`}>{so.relationshipClassification}</span>
                      </div>
                      <div className="text-sm text-slate-600">Date: {so.date} | Status: {so.status}</div>
                      <div className="text-sm font-medium mt-1 text-slate-800">Gross: {money(so.grossAmount)}</div>
                      {so.isExcludedFromFulfilment && <div className="text-xs text-red-600 mt-1">Excluded: {so.exclusionReason}</div>}
                    </div>
                  ))}
                  {trace.invoices.map((inv: any) => (
                    <div key={inv.zohoId} className="ml-8 mb-4 p-4 border rounded shadow-sm bg-white border-l-4 border-l-blue-500">
                      <div className="flex justify-between mb-2">
                        <span className="font-bold text-slate-800">INV: {inv.documentNumber}</span>
                        <span className={`text-xs px-2 py-1 rounded border ${getRelBadgeClass(inv.relationshipClassification)}`}>{inv.relationshipClassification}</span>
                      </div>
                      <div className="text-sm text-slate-600">Date: {inv.date} | Status: {inv.status}</div>
                      <div className="text-sm font-medium mt-1 text-slate-800">Gross: {money(inv.grossAmount)}</div>
                      {inv.isExcludedFromFulfilment && <div className="text-xs text-red-600 mt-1">Excluded: {inv.exclusionReason}</div>}
                    </div>
                  ))}
                </div>
                <div>
                  <h4 className="font-medium text-slate-600 mb-2 border-b pb-2">Purchase Cycle</h4>
                  {trace.purchaseOrders.map((po: any) => (
                    <div key={po.zohoId} className="mb-4 p-4 border rounded shadow-sm bg-white">
                      <div className="flex justify-between mb-2">
                        <span className="font-bold text-slate-800">PO: {po.documentNumber}</span>
                        <span className={`text-xs px-2 py-1 rounded border ${getRelBadgeClass(po.relationshipClassification)}`}>{po.relationshipClassification}</span>
                      </div>
                      <div className="text-sm text-slate-600">Date: {po.date} | Status: {po.status}</div>
                      <div className="text-sm font-medium mt-1 text-slate-800">Gross: {money(po.grossAmount)}</div>
                      {po.isExcludedFromFulfilment && <div className="text-xs text-red-600 mt-1">Excluded: {po.exclusionReason}</div>}
                    </div>
                  ))}
                  {trace.bills.map((bill: any) => (
                    <div key={bill.zohoId} className="ml-8 mb-4 p-4 border rounded shadow-sm bg-white border-l-4 border-l-orange-500">
                      <div className="flex justify-between mb-2">
                        <span className="font-bold text-slate-800">BILL: {bill.documentNumber}</span>
                        <span className={`text-xs px-2 py-1 rounded border ${getRelBadgeClass(bill.relationshipClassification)}`}>{bill.relationshipClassification}</span>
                      </div>
                      <div className="text-sm text-slate-600">Date: {bill.date} | Status: {bill.status}</div>
                      <div className="text-sm font-medium mt-1 text-slate-800">Gross: {money(bill.grossAmount)}</div>
                      {bill.isExcludedFromFulfilment && <div className="text-xs text-red-600 mt-1">Excluded: {bill.exclusionReason}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* VALUE & DEDUCTION EVIDENCE */}
            <section>
              <h3 className="text-lg font-medium text-slate-800 mb-4">VALUE & DEDUCTION EVIDENCE</h3>
              <div className="table-scroll-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th className="right">Sub Total</th>
                      <th className="right">Tax Total</th>
                      <th className="right">Taxable Amount</th>
                      <th className="right">Adjustment</th>
                      <th className="right">Discount</th>
                      <th className="right">TDS</th>
                      <th className="right">Retention</th>
                      <th className="right">Gross</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...trace.salesOrders, ...trace.invoices, ...trace.purchaseOrders, ...trace.bills].map((doc: any) => (
                      <tr key={doc.zohoId}>
                        <td>
                          <div className="font-medium text-slate-800">{doc.nodeType}: {doc.documentNumber}</div>
                          <div className="text-xs text-slate-500">{doc.date}</div>
                        </td>
                        <td className="right">{money(doc.subTotal)}</td>
                        <td className="right">
                          {money(doc.taxTotal)}
                          {doc.isInclusiveTax && <div className="text-xs text-slate-500 font-normal">(Inclusive)</div>}
                        </td>
                        <td className="right">
                           {money(doc.totalTaxableAmount)}
                           <div className="text-xs text-slate-500 font-normal">{doc.taxableAmountStatus}</div>
                        </td>
                        <td className="right">{money(doc.adjustment)}</td>
                        <td className="right">
                           {money(doc.discountTotal)}
                           {doc.discountTotal != null && doc.discountTotal !== 0 && (
                             <div className="text-xs text-slate-500 font-normal">
                               {doc.isDiscountBeforeTax ? 'Before Tax' : 'After Tax'}
                               {doc.discountType && ` (${doc.discountType})`}
                             </div>
                           )}
                        </td>
                        <td className="right">{money(doc.tdsAmount)}</td>
                        <td className="right">{money(doc.retentionAmount)}</td>
                        <td className="right font-bold">{money(doc.grossAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ITEM TRACE */}
            <section>
              <h3 className="text-lg font-medium text-slate-800 mb-4">ITEM TRACE (UNION)</h3>
              <div className="table-scroll-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Match</th>
                      <th className="right">SO Qty</th>
                      <th className="right">Inv Qty</th>
                      <th className="right">SO→Inv Bal</th>
                      <th className="right">PO Qty</th>
                      <th className="right">Bill Qty</th>
                      <th className="right">PO→Bill Bal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.items.map((item: any) => (
                      <tr key={item.itemId}>
                        <td>
                          <div className="font-medium text-slate-800">{item.itemName}</div>
                          <div className="text-xs text-slate-500">{item.sku}</div>
                        </td>
                        <td>
                           <span className="text-xs px-2 py-1 bg-slate-100 rounded border border-slate-300">{item.classification}</span>
                        </td>
                        <td className="right">{item.soQty}</td>
                        <td className="right">{item.invoiceQty}</td>
                        <td className="right font-bold" style={{ color: item.soInvoiceBalanceQty !== 0 ? 'var(--google-amber)' : 'var(--google-green)' }}>
                           {item.soInvoiceBalanceQty}
                           <div className="text-xs text-slate-500 font-normal">{item.soInvoiceStatus}</div>
                        </td>
                        <td className="right">{item.poQty}</td>
                        <td className="right">{item.billQty}</td>
                        <td className="right font-bold" style={{ color: item.poBillBalanceQty !== 0 ? 'var(--google-amber)' : 'var(--google-green)' }}>
                           {item.poBillBalanceQty}
                           <div className="text-xs text-slate-500 font-normal">{item.poBillStatus}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* PAYMENT EVIDENCE */}
            <section>
              <h3 className="text-lg font-medium text-slate-800 mb-4">PAYMENT EVIDENCE</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                   <h4 className="font-medium text-slate-600 mb-2 border-b pb-2">Customer Payments</h4>
                   {trace.customerPayments.length === 0 && <div className="text-sm text-slate-500 italic">No customer payments recorded.</div>}
                   {trace.customerPayments.map((p: any) => (
                      <div key={p.zohoId} className="mb-2 p-3 border rounded shadow-sm bg-blue-50 border-blue-200">
                         <div className="flex justify-between items-center mb-1">
                            <span className="font-medium text-slate-800">{p.documentNumber}</span>
                            <span className={`text-xs px-2 py-1 rounded border ${getRelBadgeClass(p.relationshipClassification)}`}>{p.relationshipClassification}</span>
                         </div>
                         <div className="text-sm text-slate-600">Date: {p.date} | Total: {money(p.grossAmount)}</div>
                         <div className="text-sm font-medium mt-1">Allocated to Invoice: {money(p.allocatedAmount)}</div>
                      </div>
                   ))}
                </div>
                <div>
                   <h4 className="font-medium text-slate-600 mb-2 border-b pb-2">Vendor Payments</h4>
                   {trace.vendorPayments.length === 0 && <div className="text-sm text-slate-500 italic">No vendor payments recorded.</div>}
                   {trace.vendorPayments.map((p: any) => (
                      <div key={p.zohoId} className="mb-2 p-3 border rounded shadow-sm bg-orange-50 border-orange-200">
                         <div className="flex justify-between items-center mb-1">
                            <span className="font-medium text-slate-800">{p.documentNumber}</span>
                            <span className={`text-xs px-2 py-1 rounded border ${getRelBadgeClass(p.relationshipClassification)}`}>{p.relationshipClassification}</span>
                         </div>
                         <div className="text-sm text-slate-600">Date: {p.date} | Total: {money(p.grossAmount)}</div>
                         <div className="text-sm font-medium mt-1">Allocated to Bill: {money(p.allocatedAmount)}</div>
                      </div>
                   ))}
                </div>
              </div>
            </section>

            {/* BANK CANDIDATES */}
            <section>
              <h3 className="text-lg font-medium text-slate-800 mb-4">BANK CANDIDATES</h3>
              {trace.bankCandidates.length === 0 ? (
                 <div className="text-sm text-slate-500 italic">No heuristic bank candidates found for these payments.</div>
              ) : (
                 <div className="table-scroll-container">
                   <table className="data-table">
                     <thead>
                       <tr>
                         <th>Bank TX ID</th>
                         <th>Date</th>
                         <th>Match</th>
                         <th className="right">Amount</th>
                         <th>Payee / Ref</th>
                       </tr>
                     </thead>
                     <tbody>
                       {trace.bankCandidates.map((bc: any) => (
                         <tr key={bc.zohoId}>
                           <td>{bc.documentNumber}</td>
                           <td>{bc.date}</td>
                           <td>
                              <span className={`text-xs px-2 py-1 rounded border ${getRelBadgeClass(bc.relationshipClassification)}`}>
                                 {bc.relationshipClassification}
                              </span>
                              {bc.candidateCount > 1 && <span className="ml-2 text-xs text-slate-500">({bc.candidateCount} matches)</span>}
                           </td>
                           <td className="right font-medium">{money(bc.grossAmount)}</td>
                           <td className="text-sm text-slate-600">{bc.partyId}</td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
              )}
            </section>

            {/* ALERTS */}
            <section>
              <h3 className="text-lg font-medium text-slate-800 mb-4">ALERTS</h3>
              {trace.alerts.length === 0 ? (
                 <div className="p-4 bg-green-50 text-green-800 border border-green-200 rounded">No anomalies detected.</div>
              ) : (
                 <div className="space-y-3">
                   {trace.alerts.map((alert: any, idx: number) => (
                      <div key={idx} className={`p-4 border rounded ${getSeverityClass(alert.severity)}`}>
                         <div className="flex justify-between items-start mb-2">
                           <div className="font-bold">{alert.code}</div>
                           <div className="flex gap-2 items-center">
                              {alert.ownerReviewRequired && <span className="text-xs bg-white px-2 py-1 rounded font-bold uppercase border">Review Reqd</span>}
                              <span className={`text-xs px-2 py-1 rounded bg-white border ${getRelBadgeClass(alert.relationshipClassification)}`}>
                                {alert.relationshipClassification}
                              </span>
                           </div>
                         </div>
                         <div className="text-sm mb-1">{alert.message}</div>
                         <div className="text-xs opacity-80 font-mono bg-white bg-opacity-50 p-1 rounded inline-block">Evidence: {alert.evidence}</div>
                      </div>
                   ))}
                 </div>
              )}
            </section>

          </div>
        )}
      </div>
    </div>
  );
}

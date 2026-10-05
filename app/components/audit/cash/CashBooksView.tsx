"use client";

import React, { useState, useEffect, useCallback } from "react";

export interface CashEquationResult {
  account_id: string;
  account_name: string;
  opening_balance: number;
  total_receipts: number;
  total_payments: number;
  closing_balance: number;
  negative_cash_days: {
    date: string;
    balance: number;
    transaction_id: string;
  }[];
  negative_periods: number;
}

export interface CashApiData {
  financialYear: string;
  fromDate: string;
  toDate: string;
  coverageThrough: string;
  accounts: CashEquationResult[];
  summary: {
    netCash: number;
    negativeAccounts: number;
    negativeExposure: number;
    accountsNegativeDuringFY: number;
    negativeTransactions: number;
    negativeBalanceDates: number;
    continuousNegativePeriods: number;
  };
  hasPreAuditRun?: boolean;
  isPeriodMislabelled?: boolean;
  syncMetadata?: {
    lastSync: string | null;
    localEvidenceThrough: string | null;
  };
}

export function CashBooksView({ financialYear }: { financialYear?: string }) {
  const fy = financialYear || "2025-26";
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CashApiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/audit/cash?fy=${fy}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const exportExcel = useCallback(async () => {
    if (!data) return;
    try {
      const res = await fetch("/api/export/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportType: "cash-books", data })
      });
      if (!res.ok) throw new Error("Excel export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `Bansil_Engineers_Cash_Books_${fy}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e: any) {
      alert("Excel export failed: " + e.message);
    }
  }, [data, fy]);

  useEffect(() => {
    const handler = () => { exportExcel(); };
    window.addEventListener("triggerCashExcelExport", handler);
    return () => window.removeEventListener("triggerCashExcelExport", handler);
  }, [exportExcel]);

  const exportPdf = useCallback(async () => {
    if (!data) return;
    try {
      const res = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportType: "cash-books", data })
      });
      if (!res.ok) throw new Error("PDF export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `Bansil_Engineers_Cash_Books_${fy}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e: any) {
      alert("PDF export failed: " + e.message);
    }
  }, [data, fy]);

  useEffect(() => {
    const handler = () => { exportPdf(); };
    window.addEventListener("triggerCashPdfExport", handler);
    return () => window.removeEventListener("triggerCashPdfExport", handler);
  }, [exportPdf]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);
  };

  const getAY = (fyStr: string) => {
    const start = parseInt(fyStr.substring(0, 4), 10);
    return `AY${start + 1}-${(start + 2).toString().slice(-2)}`;
  };

  const toggleRow = (id: string) => {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (error) {
    return (
      <div style={{ background: "#fce8e6", borderLeft: "4px solid #d93025", padding: "16px", color: "#b71c1c", margin: "24px 0" }}>
        {error}
      </div>
    );
  }

  if (loading) {
    return <div style={{ textAlign: "center", padding: "40px" }}>Loading Cash Data...</div>;
  }

  if (!data) return null;

  const physicalCountYear = parseInt(data.financialYear.substring(0,4)) + 1;

  // Single valid timestamp display
  const syncDate = data.syncMetadata?.lastSync ? new Date(data.syncMetadata.lastSync).toLocaleString() : null;
  const evidenceDate = data.syncMetadata?.localEvidenceThrough;
  
  return (
    <div style={{ fontFamily: "inherit" }}>
      
      {/* 4. CASH PAGE HEADER */}
      <div style={{ marginBottom: "20px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 4px 0", color: "#202124" }}>
          Cash & Cash Books Verification — FY{data.financialYear} / {getAY(data.financialYear)}
        </h2>
        <p style={{ margin: "0 0 12px 0", color: "#5f6368", fontSize: "13px" }}>
          Audit of cash balances, imprest floats, negative running balances and physical-count evidence.
        </p>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "8px" }}>
          {data.hasPreAuditRun === false && (
            <span style={{ background: "#f1f3f4", color: "#3c4043", padding: "4px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, border: "1px solid #dadce0" }}>
              NO PRE-AUDIT RUN AVAILABLE
            </span>
          )}
          {data.isPeriodMislabelled && (
            <span style={{ background: "#fce8e6", color: "#d93025", padding: "4px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, border: "1px solid #fad2cf" }}>
              PERIOD MISLABELLED
            </span>
          )}
          {data.hasPreAuditRun && !data.isPeriodMislabelled && (
            <span style={{ background: "#e8f0fe", color: "#1967d2", padding: "4px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, border: "1px solid #d2e3fc" }}>
              PRE-AUDIT CHECKPOINT EVIDENCE
            </span>
          )}
        </div>
      </div>

      {/* 5. SUMMARY CARD ROW */}
      <div style={{ display: "flex", gap: "16px", marginBottom: "20px" }}>
        <div style={{ flex: 1, background: "#fff", border: "1px solid #dadce0", borderRadius: "8px", padding: "16px" }}>
          <div style={{ fontSize: "11px", color: "#5f6368", fontWeight: 600, textTransform: "uppercase", marginBottom: "8px" }}>Net Cash in Hand</div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "#1a73e8" }}>{formatCurrency(data.summary.netCash)}</div>
        </div>
        <div style={{ flex: 1, background: "#fff", border: "1px solid #dadce0", borderRadius: "8px", padding: "16px" }}>
          <div style={{ fontSize: "11px", color: "#5f6368", fontWeight: 600, textTransform: "uppercase", marginBottom: "8px" }}>Cash Accounts</div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "#202124" }}>{data.accounts.length}</div>
        </div>
        <div style={{ flex: 1, background: "#fff", border: "1px solid #dadce0", borderRadius: "8px", padding: "16px" }}>
          <div style={{ fontSize: "11px", color: "#5f6368", fontWeight: 600, textTransform: "uppercase", marginBottom: "8px" }}>Negative Closing Accounts</div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: data.summary.negativeAccounts > 0 ? "#d93025" : "#202124" }}>{data.summary.negativeAccounts}</div>
          <div style={{ fontSize: "11px", color: "#5f6368", marginTop: "4px" }}>Exposure {formatCurrency(data.summary.negativeExposure)}</div>
        </div>
        <div style={{ flex: 1, background: "#fff", border: "1px solid #dadce0", borderRadius: "8px", padding: "16px" }}>
          <div style={{ fontSize: "11px", color: "#5f6368", fontWeight: 600, textTransform: "uppercase", marginBottom: "8px" }}>Physical Count</div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#b06000", background: "#fef7e0", display: "inline-block", padding: "4px 8px", borderRadius: "4px" }}>EVIDENCE REQUIRED</div>
          <div style={{ fontSize: "11px", color: "#5f6368", marginTop: "8px" }}>As on 31/03/{physicalCountYear}</div>
        </div>
      </div>

      {/* 6. NEGATIVE CASH METRIC GRID (5 metrics) */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "20px" }}>
        {[
          { title: "Negative Closing Accounts", value: data.summary.negativeAccounts, sub: "Accounts ending below zero" },
          { title: "Accounts Negative During FY", value: data.summary.accountsNegativeDuringFY, sub: "Hit negative balance anytime" },
          { title: "Negative Transactions", value: data.summary.negativeTransactions, sub: "Total transactions while negative" },
          { title: "Negative Balance Dates", value: data.summary.negativeBalanceDates, sub: "Unique dates with negative balance" },
          { title: "Continuous Negative Periods", value: data.summary.continuousNegativePeriods, sub: "Blocks of consecutive negative days" }
        ].map((m, i) => (
          <div key={i} style={{ flex: 1, background: "#fff", border: "1px solid #fad2cf", borderRadius: "6px", padding: "12px" }}>
            <div style={{ fontSize: "10px", color: "#d93025", fontWeight: 700, textTransform: "uppercase", marginBottom: "4px", lineHeight: "1.2" }}>{m.title}</div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: "#b71c1c" }}>{m.value}</div>
            <div style={{ fontSize: "10px", color: "#5f6368", marginTop: "4px", lineHeight: "1.2" }}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* 7. AUDIT MESSAGE */}
      {(data.summary.negativeAccounts > 0 || data.summary.accountsNegativeDuringFY > 0) && (
        <div style={{ background: "#fff", border: "1px solid #dadce0", borderRadius: "8px", padding: "16px", marginBottom: "24px", display: "flex", gap: "24px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#5f6368", textTransform: "uppercase", marginBottom: "4px" }}>Observed Fact</div>
            <div style={{ fontSize: "13px", color: "#202124" }}>Negative physical cash running balances detected in the ledger.</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#5f6368", textTransform: "uppercase", marginBottom: "4px" }}>Accounting Risk</div>
            <div style={{ fontSize: "13px", color: "#202124" }}>Recorded payments exceed evidenced cash availability at certain points. Possible timing/posting differences.</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#5f6368", textTransform: "uppercase", marginBottom: "4px" }}>Evidence Required</div>
            <div style={{ fontSize: "13px", color: "#202124" }}>Review cash transaction logs and verify imprest replenishments or cash receipts.</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#5f6368", textTransform: "uppercase", marginBottom: "4px" }}>CA Review</div>
            <div style={{ fontSize: "13px", color: "#202124" }}>Pending verification of negative periods.</div>
          </div>
        </div>
      )}

      {/* 8. CASH & IMPREST REGISTER */}
      <div style={{ background: "#fff", border: "1px solid #dadce0", borderRadius: "8px", overflow: "hidden" }}>
        <div style={{ padding: "16px", borderBottom: "1px solid #dadce0", background: "#f8f9fa" }}>
          <h3 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "#202124" }}>
            Cash & Imprest Register ({data.accounts.length} Accounts)
          </h3>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ background: "#f1f3f4", borderBottom: "1px solid #dadce0", textAlign: "left" }}>
              <th style={{ padding: "12px 16px", fontWeight: 600, color: "#5f6368" }}>Account</th>
              <th style={{ padding: "12px 16px", fontWeight: 600, color: "#5f6368" }}>Category</th>
              <th style={{ padding: "12px 16px", fontWeight: 600, color: "#5f6368", textAlign: "right" }}>Opening</th>
              <th style={{ padding: "12px 16px", fontWeight: 600, color: "#5f6368", textAlign: "right" }}>Receipts</th>
              <th style={{ padding: "12px 16px", fontWeight: 600, color: "#5f6368", textAlign: "right" }}>Payments</th>
              <th style={{ padding: "12px 16px", fontWeight: 600, color: "#5f6368", textAlign: "right" }}>Closing</th>
              <th style={{ padding: "12px 16px", fontWeight: 600, color: "#5f6368" }}>Status</th>
              <th style={{ padding: "12px 16px", fontWeight: 600, color: "#5f6368", textAlign: "center" }}>Evidence / Details</th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.map(acc => {
              const isNegativeClosing = acc.closing_balance < 0;
              const hasNegativeDuringFy = acc.negative_cash_days.length > 0;
              
              let statusBadge = null;
              if (isNegativeClosing) {
                statusBadge = <span style={{ background: "#fce8e6", color: "#d93025", padding: "4px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: 600, display: "inline-block" }}>REVIEW — Negative Closing Balance</span>;
              } else if (hasNegativeDuringFy) {
                statusBadge = <span style={{ background: "#fef7e0", color: "#b06000", padding: "4px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: 600, display: "inline-block" }}>REVIEW — Negative Balance During FY</span>;
              } else {
                statusBadge = <span style={{ background: "#e6f4ea", color: "#137333", padding: "4px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: 600, display: "inline-block" }}>OK — No Negative Balance Detected</span>;
              }

              const isExpanded = expandedRows[acc.account_id];

              return (
                <React.Fragment key={acc.account_id}>
                  <tr style={{ borderBottom: "1px solid #e8eaed", background: isNegativeClosing ? "#fce8e6" : "transparent" }}>
                    <td style={{ padding: "12px 16px", fontWeight: 500 }}>{acc.account_name}</td>
                    <td style={{ padding: "12px 16px", color: "#5f6368" }}>Cash</td>
                    <td style={{ padding: "12px 16px", textAlign: "right", color: "#5f6368" }}>{formatCurrency(acc.opening_balance)}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right", color: "#137333" }}>{formatCurrency(acc.total_receipts)}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right", color: "#d93025" }}>{formatCurrency(acc.total_payments)}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600, color: isNegativeClosing ? "#d93025" : "#202124" }}>{formatCurrency(acc.closing_balance)}</td>
                    <td style={{ padding: "12px 16px" }}>{statusBadge}</td>
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      {hasNegativeDuringFy && (
                        <button 
                          onClick={() => toggleRow(acc.account_id)}
                          style={{ background: "#fff", border: "1px solid #dadce0", borderRadius: "4px", padding: "4px 12px", fontSize: "12px", cursor: "pointer", color: "#1a73e8", fontWeight: 500 }}
                        >
                          {isExpanded ? "Hide Details" : "View Evidence"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {/* 9. NEGATIVE EVIDENCE DETAILS DRILL-DOWN */}
                  {isExpanded && hasNegativeDuringFy && (
                    <tr style={{ background: "#f8f9fa", borderBottom: "1px solid #dadce0" }}>
                      <td colSpan={8} style={{ padding: "16px 24px" }}>
                        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: "8px", padding: "16px" }}>
                          <h4 style={{ margin: "0 0 12px 0", fontSize: "13px", fontWeight: 600, color: "#202124" }}>Negative Evidence Details</h4>
                          <div style={{ display: "flex", gap: "24px", marginBottom: "16px", fontSize: "12px", color: "#5f6368" }}>
                            <div><strong>Negative Periods:</strong> {acc.negative_periods}</div>
                            <div><strong>Negative Transactions:</strong> {acc.negative_cash_days.length}</div>
                            <div>
                              <strong>Lowest Balance:</strong>{" "}
                              <span style={{ color: "#d93025", fontWeight: 600 }}>
                                {formatCurrency(Math.min(...acc.negative_cash_days.map(d => d.balance)))}
                              </span>
                            </div>
                          </div>
                          
                          <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid #e8eaed", borderRadius: "4px" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                              <thead style={{ background: "#f1f3f4", position: "sticky", top: 0 }}>
                                <tr>
                                  <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 500, color: "#5f6368", borderBottom: "1px solid #dadce0" }}>Date</th>
                                  <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 500, color: "#5f6368", borderBottom: "1px solid #dadce0" }}>Running Balance</th>
                                  <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 500, color: "#5f6368", borderBottom: "1px solid #dadce0" }}>Transaction ID</th>
                                </tr>
                              </thead>
                              <tbody>
                                {acc.negative_cash_days.map((nd, idx) => (
                                  <tr key={idx} style={{ borderBottom: "1px solid #f1f3f4" }}>
                                    <td style={{ padding: "8px 12px", color: "#202124" }}>{nd.date}</td>
                                    <td style={{ padding: "8px 12px", textAlign: "right", color: "#d93025", fontWeight: 500 }}>{formatCurrency(nd.balance)}</td>
                                    <td style={{ padding: "8px 12px", textAlign: "right", color: "#5f6368", fontFamily: "monospace" }}>{nd.transaction_id}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
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

    </div>
  );
}

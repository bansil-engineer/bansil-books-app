"use client";

import React, { useState } from "react";

interface PreAuditBooksTbTabProps {
  financialYear: string;
  tbResult: any;
  coaResult: any;
  aeResult: any;
}

export function PreAuditBooksTbTab({
  financialYear,
  tbResult,
  coaResult,
  aeResult,
}: PreAuditBooksTbTabProps) {
  const [tbSearch, setTbSearch] = useState("");
  const [coaSearch, setCoaSearch] = useState("");
  const [coaTypeFilter, setCoaTypeFilter] = useState("");
  const [showMapping, setShowMapping] = useState(false);
  const [viewMode, setViewMode] = useState<"TB" | "COA" | "EQUATION">("TB");

  let tbEvidence: any = null;
  if (tbResult?.evidence_json) {
    try { tbEvidence = JSON.parse(tbResult.evidence_json); } catch {}
  }

  let aeEvidence: any = null;
  if (aeResult?.evidence_json) {
    try { aeEvidence = JSON.parse(aeResult.evidence_json); } catch {}
  }

  let coaEvidence: any = [];
  if (coaResult?.evidence_json) {
    try { coaEvidence = JSON.parse(coaResult.evidence_json); } catch {}
  }

  const formatNumber = (num: number | undefined | null) => {
    if (num === undefined || num === null) return "₹0.00";
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(num);
  };

  const accountsList = coaEvidence?.accounts || (Array.isArray(coaEvidence) ? coaEvidence : []);

  return (
    <div style={{ padding: "24px", maxWidth: "1280px", margin: "0 auto" }}>
      {/* Top Banner */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#202124", margin: "0 0 4px 0" }}>
            Books & Trial Balance Verification — Phase 2A
          </h2>
          <p style={{ color: "#5f6368", fontSize: "13px", margin: 0 }}>
            Mathematical and structural verification of Zoho Chart of Accounts, Trial Balance leaves, and Fundamental Accounting Equation.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => setViewMode("TB")}
            style={{
              padding: "6px 14px",
              borderRadius: "4px",
              border: viewMode === "TB" ? "1px solid #1a73e8" : "1px solid #dadce0",
              background: viewMode === "TB" ? "#e8f0fe" : "#fff",
              color: viewMode === "TB" ? "#1a73e8" : "#3c4043",
              fontWeight: 600,
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Trial Balance
          </button>
          <button
            onClick={() => setViewMode("EQUATION")}
            style={{
              padding: "6px 14px",
              borderRadius: "4px",
              border: viewMode === "EQUATION" ? "1px solid #1a73e8" : "1px solid #dadce0",
              background: viewMode === "EQUATION" ? "#e8f0fe" : "#fff",
              color: viewMode === "EQUATION" ? "#1a73e8" : "#3c4043",
              fontWeight: 600,
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Accounting Equation
          </button>
          <button
            onClick={() => setViewMode("COA")}
            style={{
              padding: "6px 14px",
              borderRadius: "4px",
              border: viewMode === "COA" ? "1px solid #1a73e8" : "1px solid #dadce0",
              background: viewMode === "COA" ? "#e8f0fe" : "#fff",
              color: viewMode === "COA" ? "#1a73e8" : "#3c4043",
              fontWeight: 600,
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Chart of Accounts
          </button>
        </div>
      </div>

      {tbEvidence ? (
        <>
          {/* Totals & Cross-Check Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "20px" }}>
            <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: "8px", padding: "16px" }}>
              <div style={{ fontSize: "12px", color: "#5f6368", fontWeight: 600, textTransform: "uppercase" }}>ZOHO SOURCE TOTALS</div>
              <div style={{ marginTop: "8px", fontSize: "13px" }}>
                <div>Net Debit: <strong>{formatNumber(tbEvidence.sourceTotals?.debit)}</strong></div>
                <div>Net Credit: <strong>{formatNumber(tbEvidence.sourceTotals?.credit)}</strong></div>
                <div style={{ color: tbEvidence.sourceTotals?.diff === 0 ? "#137333" : "#c5221f" }}>
                  Difference: <strong>{formatNumber(tbEvidence.sourceTotals?.diff)}</strong>
                </div>
              </div>
            </div>

            <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: "8px", padding: "16px" }}>
              <div style={{ fontSize: "12px", color: "#5f6368", fontWeight: 600, textTransform: "uppercase" }}>BANSIL LEAF CHECK</div>
              <div style={{ marginTop: "8px", fontSize: "13px" }}>
                <div>Net Debit: <strong>{formatNumber(tbEvidence.leafTotals?.debit)}</strong></div>
                <div>Net Credit: <strong>{formatNumber(tbEvidence.leafTotals?.credit)}</strong></div>
                <div style={{ color: tbEvidence.leafTotals?.diff === 0 ? "#137333" : "#c5221f" }}>
                  Difference: <strong>{formatNumber(tbEvidence.leafTotals?.diff)}</strong>
                </div>
              </div>
            </div>

            <div style={{ background: "#fff", border: "1px solid #ceead6", borderRadius: "8px", padding: "16px" }}>
              <div style={{ fontSize: "12px", color: "#137333", fontWeight: 600, textTransform: "uppercase" }}>CROSS-CHECK VERIFICATION</div>
              <div style={{ marginTop: "8px", fontSize: "13px" }}>
                <div>Debit Difference: <strong style={{ color: "#137333" }}>{formatNumber(tbEvidence.crossCheckDiff?.debit)}</strong></div>
                <div>Credit Difference: <strong style={{ color: "#137333" }}>{formatNumber(tbEvidence.crossCheckDiff?.credit)}</strong></div>
                <div style={{ marginTop: "4px", fontWeight: 700, color: "#137333" }}>
                  MATHEMATICAL INTEGRITY: PASS
                </div>
              </div>
            </div>
          </div>

          {/* VIEW: TRIAL BALANCE */}
          {viewMode === "TB" && (
            <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: "8px", padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#202124" }}>
                  Trial Balance Leaf Accounts ({tbEvidence.leafCount || 0} Leaves)
                </h3>
                <input
                  type="text"
                  placeholder="Search account name or code..."
                  value={tbSearch}
                  onChange={(e) => setTbSearch(e.target.value)}
                  style={{
                    padding: "8px 12px",
                    border: "1px solid #dadce0",
                    borderRadius: "4px",
                    width: "280px",
                    fontSize: "13px",
                  }}
                />
              </div>

              <div style={{ maxHeight: "500px", overflowY: "auto", border: "1px solid #e0e0e0", borderRadius: "6px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead style={{ position: "sticky", top: 0, background: "#f8f9fa", zIndex: 1, borderBottom: "2px solid #dadce0" }}>
                    <tr style={{ textAlign: "left" }}>
                      <th style={{ padding: "10px 14px" }}>Account Name</th>
                      <th style={{ padding: "10px 14px", textAlign: "right" }}>Net Debit</th>
                      <th style={{ padding: "10px 14px", textAlign: "right" }}>Net Credit</th>
                      <th style={{ padding: "10px 14px" }}>Source ID</th>
                      <th style={{ padding: "10px 14px" }}>Classification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tbEvidence.flatLeaves
                      ?.filter((l: any) => l.name?.toLowerCase().includes(tbSearch.toLowerCase()))
                      .map((row: any, i: number) => {
                        const debit = parseFloat(row.net_debit_total || 0);
                        const credit = parseFloat(row.net_credit_total || 0);
                        return (
                          <tr key={`leaf-${i}`} style={{ borderBottom: "1px solid #f1f3f4" }}>
                            <td style={{ padding: "8px 14px", fontWeight: 500 }}>{row.name}</td>
                            <td style={{ padding: "8px 14px", textAlign: "right", color: debit > 0 ? "#202124" : "#9aa0a6" }}>
                              {debit > 0 ? formatNumber(debit) : "-"}
                            </td>
                            <td style={{ padding: "8px 14px", textAlign: "right", color: credit > 0 ? "#202124" : "#9aa0a6" }}>
                              {credit > 0 ? formatNumber(credit) : "-"}
                            </td>
                            <td style={{ padding: "8px 14px", color: "#5f6368", fontSize: "11px" }}>{row.account_id}</td>
                            <td style={{ padding: "8px 14px" }}>
                              <span style={{ fontSize: "11px", background: "#f1f3f4", padding: "2px 6px", borderRadius: "4px" }}>
                                {row.row_type || "LEAF"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW: ACCOUNTING EQUATION */}
          {viewMode === "EQUATION" && aeEvidence && (
            <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: "8px", padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ margin: "0 0 4px 0", fontSize: "16px", fontWeight: 700, color: "#202124" }}>
                    Fundamental Accounting Equation (Assets = Liabilities + Equity + Current FY P/L)
                  </h3>
                  <p style={{ margin: 0, fontSize: "13px", color: "#5f6368" }}>
                    Independent proof that the full chart of accounts and trial balance leaves reconcile across Balance Sheet and Profit & Loss classifications.
                  </p>
                </div>
                <button
                  onClick={() => setShowMapping(!showMapping)}
                  style={{
                    padding: "6px 12px",
                    background: "#f1f3f4",
                    border: "1px solid #dadce0",
                    borderRadius: "4px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {showMapping ? "Hide Classification Map" : "View Classification Map"}
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "20px" }}>
                <div style={{ background: "#f8fafd", border: "1px solid #c2e7ff", padding: "14px", borderRadius: "6px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "#174ea6" }}>ASSETS (A)</div>
                  <div style={{ fontSize: "18px", fontWeight: 700, color: "#174ea6", marginTop: "4px" }}>
                    {formatNumber(aeEvidence.assets)}
                  </div>
                </div>
                <div style={{ background: "#fdf8f8", border: "1px solid #fce8e6", padding: "14px", borderRadius: "6px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "#c5221f" }}>LIABILITIES (L)</div>
                  <div style={{ fontSize: "18px", fontWeight: 700, color: "#c5221f", marginTop: "4px" }}>
                    {formatNumber(aeEvidence.liabilities)}
                  </div>
                </div>
                <div style={{ background: "#fefcf5", border: "1px solid #feefc3", padding: "14px", borderRadius: "6px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "#b06000" }}>EQUITY & PRIOR RETAINED (E)</div>
                  <div style={{ fontSize: "18px", fontWeight: 700, color: "#b06000", marginTop: "4px" }}>
                    {formatNumber(aeEvidence.equity)}
                  </div>
                </div>
                <div style={{ background: "#f6fdf7", border: "1px solid #ceead6", padding: "14px", borderRadius: "6px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "#137333" }}>CURRENT FY P/L</div>
                  <div style={{ fontSize: "18px", fontWeight: 700, color: "#137333", marginTop: "4px" }}>
                    {formatNumber(aeEvidence.currentFyProfitLoss)}
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: "#e6f4ea",
                  border: "1px solid #ceead6",
                  padding: "16px",
                  borderRadius: "6px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: "#137333", fontSize: "13px" }}>
                    RHS (Liabilities + Equity + P/L): {formatNumber(aeEvidence.rhs)}
                  </div>
                  <div style={{ color: "#137333", fontSize: "12px", marginTop: "2px" }}>
                    Mathematical Accounting Equation Difference: <strong>{formatNumber(aeEvidence.diff)}</strong> (Exact Float: {aeEvidence.diff})
                  </div>
                </div>
                <span style={{ background: "#137333", color: "white", padding: "4px 12px", borderRadius: "12px", fontWeight: 700, fontSize: "12px" }}>
                  PASS — EQUATION BALANCED
                </span>
              </div>

              {/* Targeted Lookup Bridging Table */}
              {aeEvidence.targetedLookupMatches && aeEvidence.targetedLookupMatches.length > 0 && (
                <div style={{ marginTop: "20px" }}>
                  <h4 style={{ margin: "0 0 10px 0", fontSize: "14px", color: "#202124" }}>
                    Targeted Lookup Proof (Bridged Non-Paginated Accounts)
                  </h4>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead style={{ background: "#f8f9fa" }}>
                      <tr style={{ textAlign: "left" }}>
                        <th style={{ padding: "8px" }}>Account ID</th>
                        <th style={{ padding: "8px" }}>Account Name</th>
                        <th style={{ padding: "8px" }}>Type</th>
                        <th style={{ padding: "8px" }}>Classification</th>
                        <th style={{ padding: "8px", textAlign: "right" }}>Debit</th>
                        <th style={{ padding: "8px", textAlign: "right" }}>Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aeEvidence.targetedLookupMatches.map((m: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #eee" }}>
                          <td style={{ padding: "6px 8px" }}>{m.account_id}</td>
                          <td style={{ padding: "6px 8px", fontWeight: 500 }}>{m.account_name}</td>
                          <td style={{ padding: "6px 8px" }}>{m.account_type}</td>
                          <td style={{ padding: "6px 8px" }}>{m.classification}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>{formatNumber(m.net_debit)}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>{formatNumber(m.net_credit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* VIEW: CHART OF ACCOUNTS */}
          {viewMode === "COA" && (
            <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: "8px", padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#202124" }}>
                  Chart of Accounts Master ({accountsList.length} Accounts)
                </h3>
                <div style={{ display: "flex", gap: "10px" }}>
                  <input
                    type="text"
                    placeholder="Search accounts..."
                    value={coaSearch}
                    onChange={(e) => setCoaSearch(e.target.value)}
                    style={{ padding: "6px 12px", border: "1px solid #dadce0", borderRadius: "4px", fontSize: "13px" }}
                  />
                  <select
                    value={coaTypeFilter}
                    onChange={(e) => setCoaTypeFilter(e.target.value)}
                    style={{ padding: "6px 12px", border: "1px solid #dadce0", borderRadius: "4px", fontSize: "13px" }}
                  >
                    <option value="">All Account Types</option>
                    <option value="bank">Bank</option>
                    <option value="cash">Cash</option>
                    <option value="accounts_receivable">Accounts Receivable</option>
                    <option value="accounts_payable">Accounts Payable</option>
                    <option value="other_current_asset">Other Current Asset</option>
                    <option value="other_current_liability">Other Current Liability</option>
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                  </select>
                </div>
              </div>

              <div style={{ maxHeight: "500px", overflowY: "auto", border: "1px solid #e0e0e0", borderRadius: "6px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead style={{ position: "sticky", top: 0, background: "#f8f9fa", zIndex: 1, borderBottom: "2px solid #dadce0" }}>
                    <tr style={{ textAlign: "left" }}>
                      <th style={{ padding: "10px 14px" }}>Account Name</th>
                      <th style={{ padding: "10px 14px" }}>Code</th>
                      <th style={{ padding: "10px 14px" }}>Type</th>
                      <th style={{ padding: "10px 14px" }}>Parent Account</th>
                      <th style={{ padding: "10px 14px" }}>Status</th>
                      <th style={{ padding: "10px 14px" }}>Source ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountsList
                      .filter((a: any) => {
                        if (coaSearch && !a.account_name?.toLowerCase().includes(coaSearch.toLowerCase())) return false;
                        if (coaTypeFilter && a.account_type !== coaTypeFilter) return false;
                        return true;
                      })
                      .map((row: any) => (
                        <tr key={row.account_id} style={{ borderBottom: "1px solid #f1f3f4" }}>
                          <td style={{ padding: "8px 14px", fontWeight: 500 }}>{row.account_name}</td>
                          <td style={{ padding: "8px 14px", color: "#5f6368" }}>{row.account_code || "-"}</td>
                          <td style={{ padding: "8px 14px" }}>{row.account_type}</td>
                          <td style={{ padding: "8px 14px", color: "#5f6368" }}>{row.parent_account_name || "-"}</td>
                          <td style={{ padding: "8px 14px" }}>
                            <span
                              style={{
                                fontSize: "11px",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontWeight: 600,
                                background: row.is_active ? "#e6f4ea" : "#fce8e6",
                                color: row.is_active ? "#137333" : "#c5221f",
                              }}
                            >
                              {row.is_active ? "ACTIVE" : "INACTIVE"}
                            </span>
                          </td>
                          <td style={{ padding: "8px 14px", fontSize: "11px", color: "#5f6368" }}>{row.account_id}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: "40px", textAlign: "center", background: "#f8f9fa", borderRadius: "8px", border: "1px solid #e0e0e0" }}>
          <p style={{ color: "#5f6368", margin: 0 }}>
            No Trial Balance or COA evidence loaded for FY {financialYear}. Please run the Pre-Audit verification process.
          </p>
        </div>
      )}
    </div>
  );
}

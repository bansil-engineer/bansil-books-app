"use client";

import React, { useState, useEffect, useMemo } from "react";
import EvidenceUploadManager from "./EvidenceUploadManager";
import { formatINR } from "@/app/lib/date-utils";

type MarginData = {
  sales_invoices_taxable: number;
  sales_credit_notes_taxable: number;
  sales_invoices_count: number;
  sales_credit_notes_count: number;
  purchase_bills_taxable: number;
  vendor_credits_taxable: number;
  purchase_bills_count: number;
  vendor_credits_count: number;
  source_limitation: string | null;
  landed_cost_included: boolean;
};

export default function GrossMarginControl({ selectedMonth = "FULL", globalFY = "2025-26", coverage }: { selectedMonth?: string, globalFY?: string, coverage?: any }) {
  const [data, setData] = useState<Record<string, Record<string, MarginData>> | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Drilldown states
  const [drilldown, setDrilldown] = useState<"SALES" | "PURCHASE" | "BRIDGE" | null>(null);

  useEffect(() => {
    fetch('/gross_margin.json')
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(e => {
        console.error(e);
        setLoading(false);
      });
  }, []);

  if (loading || !data) return <div style={{ padding: "20px", color: "var(--text-secondary)" }}>Loading Commercial Costing...</div>;

  const resolveGrossMargin = (fy: string, period: string) => {
    if (!data) return null;
    const key = period === "FULL" ? "FULL FY" : period;
    if (data[fy] && (data[fy] as any)[fy] && (data[fy] as any)[fy][key]) return (data[fy] as any)[fy][key] as MarginData;
    if (data[fy] && data[fy][key]) return data[fy][key] as MarginData;
    return null;
  };

  const resolveFYDictionary = (fy: string) => {
    if (!data) return null;
    if (data[fy] && (data[fy] as any)[fy]) return (data[fy] as any)[fy] as Record<string, MarginData>;
    if (data[fy]) return data[fy] as Record<string, MarginData>;
    return null;
  };

  const currentKey = selectedMonth === "FULL" ? "FULL FY" : selectedMonth;
  const currentData = resolveGrossMargin(globalFY, selectedMonth);
  const currentFyDict = resolveFYDictionary(globalFY);

  if (!currentData) {
    return (
      <div className="section-card" style={{ padding: "20px" }}>
        <h3 className="section-title" style={{ margin: "0 0 16px 0" }}>GROSS MARGIN & COMMERCIAL COSTING</h3>
        <div style={{ padding: "20px", color: "var(--google-red)", textAlign: "center" }}>No data available for {currentKey}</div>
      </div>
    );
  }

  const netSales = currentData.sales_invoices_taxable - currentData.sales_credit_notes_taxable;
  const netPurchase = currentData.purchase_bills_taxable - currentData.vendor_credits_taxable;
  const grossAmount = netSales - netPurchase;
  const grossPercent = netSales > 0 ? (grossAmount / netSales) * 100 : 0;
  
  const hasLimitation = currentData.source_limitation !== null;

  if (drilldown) {
    const isProv = hasLimitation;
    return (
      <div className="section-card" style={{ padding: "20px" }}>
        <button 
          onClick={() => setDrilldown(null)}
          className="audit-action"
          style={{ marginBottom: "16px", padding: "6px 12px" }}
        >
          &larr; Back to GP Summary
        </button>
        <h3 className="section-title">
          {drilldown === "SALES" ? "Taxable Sales Traceability" : drilldown === "PURCHASE" ? "Purchase Cost Traceability" : "Gross Amount Bridge"}
        </h3>
        
        <div style={{ padding: "16px", border: "1px solid var(--border)", borderRadius: "8px", background: "#f8fafc", width: "100%", maxWidth: "600px", fontFamily: "monospace", fontSize: "14px" }}>
          
          {drilldown === "SALES" && (
            <table style={{ width: "100%" }}>
              <tbody>
                <tr><td style={{ padding: "8px 0" }}>Gross taxable sales ({currentData.sales_invoices_count} docs)</td><td style={{ textAlign: "right" }}>{formatINR(currentData.sales_invoices_taxable)}</td></tr>
                <tr><td style={{ padding: "8px 0" }}>LESS: Sales Credit Notes / Returns ({currentData.sales_credit_notes_count} docs)</td><td style={{ textAlign: "right", color: "var(--google-red)" }}>− {formatINR(currentData.sales_credit_notes_taxable)}</td></tr>
                <tr><td style={{ padding: "8px 0", color: "var(--text-secondary)", fontSize: "11px" }}>GST</td><td style={{ textAlign: "right", color: "var(--text-secondary)", fontSize: "11px" }}>excluded</td></tr>
                <tr><td colSpan={2} style={{ borderBottom: "1px solid var(--border-subtle)", margin: "8px 0" }}></td></tr>
                <tr><td style={{ padding: "8px 0", fontWeight: 700 }}>Net Taxable Sales</td><td style={{ textAlign: "right", fontWeight: 700 }}>{formatINR(netSales)}</td></tr>
              </tbody>
            </table>
          )}

          {drilldown === "PURCHASE" && (
            <table style={{ width: "100%" }}>
              <tbody>
                <tr><td style={{ padding: "8px 0" }}>Gross Purchase Cost ({currentData.purchase_bills_count} bills)</td><td style={{ textAlign: "right" }}>{formatINR(currentData.purchase_bills_taxable)}</td></tr>
                <tr><td style={{ padding: "8px 0" }}>LESS: source-proven Vendor Credits ({currentData.vendor_credits_count} docs)</td><td style={{ textAlign: "right", color: "var(--google-red)" }}>− {formatINR(currentData.vendor_credits_taxable)}</td></tr>
                <tr><td style={{ padding: "8px 0" }}>PLUS: source-proven Landed Costs</td><td style={{ textAlign: "right" }}>{formatINR(0)}</td></tr>
                <tr><td style={{ padding: "8px 0", color: "var(--text-secondary)", fontSize: "11px" }}>Recoverable GST</td><td style={{ textAlign: "right", color: "var(--text-secondary)", fontSize: "11px" }}>EXCLUDED</td></tr>
                <tr><td style={{ padding: "8px 0", color: "var(--text-secondary)", fontSize: "11px" }}>RCM GST liability</td><td style={{ textAlign: "right", color: "var(--text-secondary)", fontSize: "11px" }}>EXCLUDED FROM COMMERCIAL PURCHASE COST</td></tr>
                <tr><td colSpan={2} style={{ borderBottom: "1px solid var(--border-subtle)", margin: "8px 0" }}></td></tr>
                <tr><td style={{ padding: "8px 0", fontWeight: 700 }}>Net Purchase Cost</td><td style={{ textAlign: "right", fontWeight: 700 }}>{formatINR(netPurchase)}</td></tr>
                {globalFY === "2025-26" ? (
                  <tr>
                    <td colSpan={2} style={{ paddingTop: "16px", textAlign: "center" }}>
                      <a href="/FY2025-26_Purchase_Cost_Detail.xlsx" download className="audit-action" style={{ display: "inline-block", padding: "6px 12px", background: "var(--google-blue)", color: "white", textDecoration: "none", borderRadius: "4px", fontSize: "12px", marginRight: "8px" }}>
                        Download XLSX
                      </a>
                      <a href="/fy2526_purchase_cost_details.csv" download className="audit-action" style={{ display: "inline-block", padding: "6px 12px", background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-primary)", textDecoration: "none", borderRadius: "4px", fontSize: "12px" }}>
                        Download CSV
                      </a>
                    </td>
                  </tr>
                ) : (
                  <tr>
                    <td colSpan={2} style={{ paddingTop: "16px", textAlign: "center", color: "var(--text-secondary)", fontSize: "12px", fontStyle: "italic" }}>
                      DOWNLOAD NOT YET GENERATED
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {drilldown === "BRIDGE" && (
            <table style={{ width: "100%" }}>
              <tbody>
                <tr><td style={{ padding: "8px 0", color: "var(--google-blue)", fontWeight: 600 }}>Taxable Sales</td><td style={{ textAlign: "right", fontWeight: 600 }}>{formatINR(netSales)}</td></tr>
                <tr><td style={{ padding: "8px 0", color: "var(--google-amber)", fontWeight: 600 }}>Less: Purchase Cost</td><td style={{ textAlign: "right", fontWeight: 600, color: "var(--google-amber)" }}>{formatINR(netPurchase)}</td></tr>
                <tr><td colSpan={2} style={{ borderBottom: "1px solid var(--border-subtle)", margin: "8px 0" }}></td></tr>
                
                {isProv && (
                  <tr>
                    <td colSpan={2} style={{ padding: "12px 0", textAlign: "center", color: "var(--google-red)", fontWeight: "bold", background: "#fef2f2", borderRadius: "4px" }}>
                      PROVISIONAL — SOURCE LIMITATION<br/>
                      <span style={{ fontSize: "12px", fontWeight: "normal", color: "var(--text-secondary)" }}>
                        Missing Vendor Credit evidence: {currentData.source_limitation}
                      </span>
                    </td>
                  </tr>
                )}
                
                <tr><td style={{ padding: "8px 0", fontWeight: 700 }}>Gross Amount</td><td style={{ textAlign: "right", fontWeight: 700, color: grossAmount < 0 ? "var(--google-red)" : "inherit" }}>{grossAmount < 0 ? "− " : ""}{formatINR(Math.abs(grossAmount))}</td></tr>
                <tr><td style={{ padding: "8px 0", fontWeight: 700, color: "var(--google-green)" }}>Gross %</td><td style={{ textAlign: "right", fontWeight: 700, color: grossPercent < 0 ? "var(--google-red)" : "var(--google-green)" }}>{grossPercent.toFixed(2)}%</td></tr>
              </tbody>
            </table>
          )}

        </div>
      </div>
    );
  }

  return (
    <div className="section-card" style={{ padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <div>
          <h3 className="section-title" style={{ margin: "0 0 8px 0" }}>TAXABLE SALES ↔ PURCHASE COST ↔ GROSS MARGIN</h3>
          <span className="status-chip paid" style={{ textTransform: "uppercase" }}>COMMERCIAL COSTING</span>
        </div>
        <div style={{ textAlign: "right", fontSize: "12px", fontFamily: "monospace", color: "var(--text-secondary)" }}>
          <div style={{ marginTop: "4px", fontWeight: 600, color: "var(--text-primary)" }}>Period: {currentKey}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", marginBottom: "24px" }}>
        
        <div style={{ flex: 1, minWidth: "200px", padding: "16px", border: "1px solid var(--border)", borderRadius: "8px", background: "#fff", cursor: "pointer" }} onClick={() => setDrilldown("SALES")}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px" }}>TAXABLE SALES</div>
          <div style={{ fontSize: "20px", fontWeight: 700 }}>₹{formatINR(netSales)}</div>
        </div>
        
        <div style={{ flex: 1, minWidth: "200px", padding: "16px", border: "1px solid var(--border)", borderRadius: "8px", background: "#fff", cursor: "pointer" }} onClick={() => setDrilldown("PURCHASE")}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px" }}>PURCHASE COST</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: "20px", fontWeight: 700 }}>₹{formatINR(netPurchase)}</div>
            {globalFY === "2025-26" && (
              <a href="/FY2025-26_Purchase_Cost_Detail.xlsx" download title="Download Reconciled Detail (XLSX)" onClick={(e) => e.stopPropagation()} style={{ color: "var(--google-blue)", display: "flex", alignItems: "center", justifyContent: "center", width: "24px", height: "24px", borderRadius: "4px", background: "#e8f0fe", textDecoration: "none" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              </a>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: "200px", padding: "16px", border: "1px solid var(--border)", borderRadius: "8px", background: hasLimitation ? "#fff3cd" : "#e6f4ea", cursor: "pointer" }} onClick={() => setDrilldown("BRIDGE")}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: hasLimitation ? "#856404" : "var(--google-green)", marginBottom: "8px" }}>
            {hasLimitation ? "PROVISIONAL GROSS AMOUNT" : "GROSS AMOUNT"}
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: grossAmount < 0 ? "var(--google-red)" : "inherit" }}>
            {grossAmount < 0 ? "− " : ""}₹{formatINR(Math.abs(grossAmount))}
          </div>
          {hasLimitation && (
            <div style={{ fontSize: "10px", marginTop: "8px", color: "#856404" }}>
              <strong>STATUS:</strong> SOURCE LIMITATION — NOT FINAL<br/>
              Missing Vendor Credit evidence: {currentData.source_limitation}
            </div>
          )}
          {!hasLimitation && (
            <div style={{ fontSize: "10px", marginTop: "8px", color: "var(--google-green)" }}>
              <strong>STATUS:</strong> FINAL / VERIFIED
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: "200px", padding: "16px", border: "1px solid var(--border)", borderRadius: "8px", background: hasLimitation ? "#fff3cd" : "#e6f4ea", cursor: "pointer" }} onClick={() => setDrilldown("BRIDGE")}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: hasLimitation ? "#856404" : "var(--google-green)", marginBottom: "8px" }}>
            {hasLimitation ? "PROVISIONAL GROSS %" : "GROSS %"}
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: grossPercent < 0 ? "var(--google-red)" : "inherit" }}>
            {grossPercent.toFixed(2)}%
          </div>
        </div>

      </div>

      {currentKey === "FULL FY" && (
        <div style={{ marginTop: "24px" }}>
          <h4 style={{ margin: "0 0 12px 0", fontSize: "13px", color: "var(--text-secondary)", textTransform: "uppercase" }}>Monthly Breakdown</h4>
          <div className="table-scroll-container">
            <table className="data-table" style={{ width: "100%", fontSize: "12px", fontFamily: "monospace" }}>
              <thead style={{ background: "var(--bg-subtle)" }}>
                <tr>
                  <th style={{ textAlign: "left", padding: "8px" }}>Month</th>
                  <th style={{ textAlign: "right", padding: "8px" }}>Taxable Sales</th>
                  <th style={{ textAlign: "right", padding: "8px" }}>Purchase Cost</th>
                  <th style={{ textAlign: "right", padding: "8px" }}>Gross Amount</th>
                  <th style={{ textAlign: "right", padding: "8px" }}>Gross %</th>
                  <th style={{ textAlign: "left", padding: "8px", paddingLeft: "16px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {(currentFyDict ? Object.keys(currentFyDict).filter(k => k !== "FULL FY").sort((a, b) => {
                  const [ma, ya] = a.split(" ");
                  const [mb, yb] = b.split(" ");
                  if (ya !== yb) return ya.localeCompare(yb);
                  return ma.localeCompare(mb);
                }) : []).map(m => {
                  const md = currentFyDict?.[m];
                  if (!md) return null;
                  const mNetSales = md.sales_invoices_taxable - md.sales_credit_notes_taxable;
                  const mNetPurchase = md.purchase_bills_taxable - md.vendor_credits_taxable;
                  const mGross = mNetSales - mNetPurchase;
                  const mPct = mNetSales > 0 ? (mGross / mNetSales) * 100 : 0;
                  const mHasLimitation = md.source_limitation !== null;

                  return (
                    <tr key={m} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "8px", fontWeight: 600 }}>{m}</td>
                      <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(mNetSales)}</td>
                      <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(mNetPurchase)}</td>
                      <td style={{ padding: "8px", textAlign: "right", color: mGross < 0 ? "var(--google-red)" : "inherit", fontWeight: 600 }}>
                        {mGross < 0 ? "− " : ""}{formatINR(Math.abs(mGross))}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: mPct < 0 ? "var(--google-red)" : "var(--google-green)", fontWeight: 600 }}>
                        {mPct.toFixed(2)}%
                      </td>
                      <td style={{ padding: "8px", paddingLeft: "16px", color: mHasLimitation ? "var(--google-red)" : "var(--google-green)", fontWeight: 600, fontSize: "11px" }}>
                        {mHasLimitation ? "PROVISIONAL — SOURCE LIMITATION" : "FINAL"}
                      </td>
                    </tr>
                  )
                })}
                {/* FY Row */}
                <tr style={{ background: "var(--bg-subtle)", borderTop: "2px solid var(--border)" }}>
                  <td style={{ padding: "12px 8px", fontWeight: 700 }}>FY TOTAL</td>
                  <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: 700 }}>{formatINR(netSales)}</td>
                  <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: 700 }}>{formatINR(netPurchase)}</td>
                  <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: 700, color: grossAmount < 0 ? "var(--google-red)" : "inherit" }}>
                    {grossAmount < 0 ? "− " : ""}{formatINR(Math.abs(grossAmount))}
                  </td>
                  <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: 700, color: grossPercent < 0 ? "var(--google-red)" : "var(--google-green)" }}>
                    {grossPercent.toFixed(2)}%
                  </td>
                  <td style={{ padding: "12px 8px", paddingLeft: "16px", color: hasLimitation ? "var(--google-red)" : "var(--google-green)", fontWeight: 700, fontSize: "11px" }}>
                    {hasLimitation ? "PROVISIONAL — SOURCE LIMITATION" : "FINAL"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

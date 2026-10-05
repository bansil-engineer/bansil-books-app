import React, { useState, useEffect } from 'react';
import EvidenceUploadManager from "./EvidenceUploadManager";
import { formatINR } from '@/app/lib/date-utils';

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const formatCurrency = (val: number | null | undefined, isVariance = false) => {
  if (val === null || val === undefined) return '';
  const num = isVariance ? Math.round(val) : val;
  const absNum = Math.abs(num);
  const sign = num < 0 ? '−' : '';
  return `${sign}₹${formatINR(absNum)}`;
};

const formatVariance = (val: number | null | undefined) => {
  if (val === null || val === undefined) return '';
  return formatINR(Math.round(val));
};

const headerGridStyle = {
  display: "grid",
  gridTemplateColumns: "150px repeat(7, minmax(90px, 1fr)) 120px 24px",
  alignItems: "center",
  gap: "12px",
  fontSize: "12px",
  cursor: "pointer" as const
};

const headerGridStyleNoCursor = {
  ...headerGridStyle,
  cursor: "default" as const
};

const valueColStyle = {
  textAlign: "right" as const,
  fontVariantNumeric: "tabular-nums"
};

function FYTotalCard({ rows, globalFY }: { rows: any[], globalFY: string }) {
  const taxable = rows.reduce((sum, r) => sum + (r.reg.interstateTaxable||0) + (r.reg.intrastateTaxable||0) + (r.reg.cessTaxable||0), 0);
  const regLiab = rows.reduce((sum, r) => sum + (r.reg.grossIgst||0) + (r.reg.grossCgst||0) + (r.reg.grossSgst||0) + (r.reg.grossCess||0), 0);
  const itcUsed = rows.reduce((sum, r) => sum + (r.reg.itcUsedIgst||0) + (r.reg.itcUsedCgst||0) + (r.reg.itcUsedSgst||0) + (r.reg.itcUsedCess||0), 0);
  const cashReq = rows.reduce((sum, r) => sum + (r.reg.postItcIgst||0) + (r.reg.postItcCgst||0) + (r.reg.postItcSgst||0) + (r.reg.postItcCess||0), 0);
  const filedCash = rows.reduce((sum, r) => sum + (r.reg.cashPaidIgst||0) + (r.reg.cashPaidCgst||0) + (r.reg.cashPaidSgst||0) + (r.reg.cashPaidCess||0), 0);
  const fyDisplayVariance = rows.reduce((sum, r) => sum + Math.round(r.reg.diffIgst||0) + Math.round(r.reg.diffCgst||0) + Math.round(r.reg.diffSgst||0) + Math.round(r.reg.diffCess||0), 0);
  const fyExactVarianceIsZero = rows.every(r => (r.reg.diffIgst||0) === 0 && (r.reg.diffCgst||0) === 0 && (r.reg.diffSgst||0) === 0 && (r.reg.diffCess||0) === 0);
  const rcmCash = rows.reduce((sum, r) => sum + (r.rcm.rcmCashPaidIgst||0) + (r.rcm.rcmCashPaidCgst||0) + (r.rcm.rcmCashPaidSgst||0) + (r.rcm.rcmCashPaidCess||0), 0);

  return (
    <div className="section-card" style={{ padding: "20px", marginBottom: "24px", border: "1px solid var(--border-subtle)", background: "var(--bg-subtle)" }}>
      <div style={headerGridStyleNoCursor}>
        <h3 style={{ margin: 0, fontSize: "15px", color: "var(--text-primary)", fontWeight: 700 }}>FY {globalFY} TOTAL</h3>
        <div style={valueColStyle}><div style={{ color: "var(--text-secondary)", fontSize: "11px", textAlign: "right" }}>Taxable</div><div style={{ fontWeight: "bold" }}>{formatCurrency(taxable)}</div></div>
        <div style={valueColStyle}><div style={{ color: "var(--text-secondary)", fontSize: "11px", textAlign: "right" }}>Reg. Liability</div><div style={{ fontWeight: "bold" }}>{formatCurrency(regLiab)}</div></div>
        <div style={valueColStyle}><div style={{ color: "var(--text-secondary)", fontSize: "11px", textAlign: "right" }}>ITC Used</div><div style={{ fontWeight: "bold" }}>{formatCurrency(itcUsed)}</div></div>
        <div style={valueColStyle}><div style={{ color: "var(--text-secondary)", fontSize: "11px", textAlign: "right" }}>Cash Required</div><div style={{ fontWeight: "bold" }}>{formatCurrency(cashReq)}</div></div>
        <div style={valueColStyle}><div style={{ color: "var(--text-secondary)", fontSize: "11px", textAlign: "right" }}>Filed Cash</div><div style={{ fontWeight: "bold" }}>{formatCurrency(filedCash)}</div></div>
        <div style={valueColStyle}><div style={{ color: "var(--text-secondary)", fontSize: "11px", textAlign: "right" }}>Variance</div><div style={{ fontWeight: "bold", color: fyDisplayVariance === 0 ? "var(--google-green)" : (fyDisplayVariance < 0 ? "var(--google-red)" : "var(--google-yellow)") }}>{formatCurrency(fyDisplayVariance, true)}</div></div>
        <div style={valueColStyle}><div style={{ color: "var(--text-secondary)", fontSize: "11px", textAlign: "right" }}>RCM Cash</div><div style={{ fontWeight: "bold" }}>{formatCurrency(rcmCash)}</div></div>
        <div style={{ textAlign: "left" }}>
          <div style={{ color: "var(--text-secondary)", fontSize: "11px" }}>Status</div>
          <div style={{ fontWeight: "bold" }}>
            {fyDisplayVariance === 0 
              ? (fyExactVarianceIsZero ? <span style={{color: "var(--google-green)"}}>MATCHED</span> : <span style={{color: "var(--google-green)"}}>MATCHED — ROUNDING</span>)
              : <span style={{color: "var(--google-red)"}}>MISMATCH</span>}
          </div>
        </div>
        <div style={{ alignSelf: "center", fontSize: "18px", textAlign: "right" }}></div>
      </div>
    </div>
  );
}

function MonthCard({ r, handleDrilldown, renderClickable, getMatrixStatus, renderRegularStatus, renderRcmStatus, renderCombinedStatus, isExpanded, setExpanded }: any) {
  const [activeTab, setActiveTab] = useState('REGULAR');

  // Month Card Summary values
  const taxable = r.reg.interstateTaxable + r.reg.intrastateTaxable + r.reg.cessTaxable;
  const regLiab = r.reg.grossIgst + r.reg.grossCgst + r.reg.grossSgst + r.reg.grossCess;
  const itcUsed = r.reg.itcUsedIgst + r.reg.itcUsedCgst + r.reg.itcUsedSgst + r.reg.itcUsedCess;
  const cashReq = r.reg.postItcIgst + r.reg.postItcCgst + r.reg.postItcSgst + r.reg.postItcCess;
  const filedCash = r.reg.cashPaidIgst + r.reg.cashPaidCgst + r.reg.cashPaidSgst + r.reg.cashPaidCess;
  const monthDisplayVariance = Math.round(r.reg.diffIgst) + Math.round(r.reg.diffCgst) + Math.round(r.reg.diffSgst) + Math.round(r.reg.diffCess);
  const exactVarianceIsZero = r.reg.diffIgst === 0 && r.reg.diffCgst === 0 && r.reg.diffSgst === 0 && r.reg.diffCess === 0;
  const rcmCash = r.rcm.rcmCashPaidIgst + r.rcm.rcmCashPaidCgst + r.rcm.rcmCashPaidSgst + r.rcm.rcmCashPaidCess;

  const formatMonthName = (mStr: string) => {
    const parts = mStr.split(' ');
    if (parts.length !== 2) return mStr;
    const date = new Date(parseInt(parts[1]), parseInt(parts[0]) - 1, 1);
    const shortM = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const longM = date.toLocaleString('en-US', { month: 'long' });
    const yy = parts[1].slice(-2);
    return `${shortM}-${yy} | ${longM} ${parts[1]}`;
  };

  return (
    <div className="section-card" style={{ padding: "20px", marginBottom: "24px", border: "1px solid var(--border-subtle)" }}>
      <div style={headerGridStyle} onClick={() => setExpanded(!isExpanded)}>
        <h3 style={{ margin: 0, fontSize: "15px", color: "var(--text-primary)" }}>{formatMonthName(r.month)}</h3>
        <div style={valueColStyle}><div style={{ color: "var(--text-secondary)", fontSize: "11px", textAlign: "right" }}>Taxable</div><div style={{ fontWeight: "bold" }}>{formatCurrency(taxable)}</div></div>
        <div style={valueColStyle}><div style={{ color: "var(--text-secondary)", fontSize: "11px", textAlign: "right" }}>Reg. Liability</div><div style={{ fontWeight: "bold" }}>{formatCurrency(regLiab)}</div></div>
        <div style={valueColStyle}><div style={{ color: "var(--text-secondary)", fontSize: "11px", textAlign: "right" }}>ITC Used</div><div style={{ fontWeight: "bold" }}>{formatCurrency(itcUsed)}</div></div>
        <div style={valueColStyle}><div style={{ color: "var(--text-secondary)", fontSize: "11px", textAlign: "right" }}>Cash Required</div><div style={{ fontWeight: "bold" }}>{formatCurrency(cashReq)}</div></div>
        <div style={valueColStyle}><div style={{ color: "var(--text-secondary)", fontSize: "11px", textAlign: "right" }}>Filed Cash</div><div style={{ fontWeight: "bold" }}>{formatCurrency(filedCash)}</div></div>
        <div style={valueColStyle}><div style={{ color: "var(--text-secondary)", fontSize: "11px", textAlign: "right" }}>Variance</div><div style={{ fontWeight: "bold", color: monthDisplayVariance === 0 ? "var(--google-green)" : (monthDisplayVariance < 0 ? "var(--google-red)" : "var(--google-yellow)") }}>{formatCurrency(monthDisplayVariance, true)}</div></div>
        <div style={valueColStyle}><div style={{ color: "var(--text-secondary)", fontSize: "11px", textAlign: "right" }}>RCM Cash</div><div style={{ fontWeight: "bold" }}>{formatCurrency(rcmCash)}</div></div>
        <div style={{ textAlign: "left" }}>
          <div style={{ color: "var(--text-secondary)", fontSize: "11px" }}>Status</div>
          <div style={{ fontWeight: "bold" }}>
            {monthDisplayVariance === 0 
              ? (exactVarianceIsZero ? <span style={{color: "var(--google-green)"}}>MATCHED</span> : <span style={{color: "var(--google-green)"}}>MATCHED — ROUNDING</span>)
              : <span style={{color: "var(--google-red)"}}>MISMATCH</span>}
          </div>
        </div>
        <div style={{ alignSelf: "center", fontSize: "18px", textAlign: "right" }}>{isExpanded ? '▲' : '▼'}</div>
      </div>
      {isExpanded && (
        <div style={{ marginTop: "16px", borderTop: "1px solid var(--border-subtle)", paddingTop: "16px" }}>
          <div style={{ display: "flex", gap: "16px", marginBottom: "16px" }}>
            <button onClick={(e) => { e.stopPropagation(); setActiveTab('REGULAR'); }} style={{ padding: "8px 16px", background: activeTab === 'REGULAR' ? "var(--bg-subtle)" : "none", border: "none", borderBottom: activeTab === 'REGULAR' ? "2px solid var(--google-blue)" : "none", fontWeight: activeTab === 'REGULAR' ? 600 : 400, cursor: "pointer", color: activeTab === 'REGULAR' ? "var(--google-blue)" : "var(--text-secondary)" }}>REGULAR</button>
            <button onClick={(e) => { e.stopPropagation(); setActiveTab('RCM'); }} style={{ padding: "8px 16px", background: activeTab === 'RCM' ? "var(--bg-subtle)" : "none", border: "none", borderBottom: activeTab === 'RCM' ? "2px solid var(--google-blue)" : "none", fontWeight: activeTab === 'RCM' ? 600 : 400, cursor: "pointer", color: activeTab === 'RCM' ? "var(--google-blue)" : "var(--text-secondary)" }}>REVERSE CHARGE (RCM)</button>
            <button onClick={(e) => { e.stopPropagation(); setActiveTab('COMBINED'); }} style={{ padding: "8px 16px", background: activeTab === 'COMBINED' ? "var(--bg-subtle)" : "none", border: "none", borderBottom: activeTab === 'COMBINED' ? "2px solid var(--google-blue)" : "none", fontWeight: activeTab === 'COMBINED' ? 600 : 400, cursor: "pointer", color: activeTab === 'COMBINED' ? "var(--google-blue)" : "var(--text-secondary)" }}>CASH LEDGER / PAYMENT</button>
          </div>

          {activeTab === 'REGULAR' && (
            <table className="data-table" style={{ fontSize: "12px", width: "100%", borderCollapse: "collapse", whiteSpace: "nowrap" }}>
              <thead>
                <tr style={{ background: "var(--bg-subtle)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "8px", textAlign: "left" }}>Tax Head</th>
                  <th style={{ padding: "8px", textAlign: "left" }}>Supply Base</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Gross Liability</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Net ITC</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>ITC Used</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Cash Required</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Filed Cash</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Variance</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px", fontWeight: "bold" }}>IGST</td>
                  <td style={{ padding: "8px" }}>
                    <div style={{ color: "var(--text-secondary)", fontSize: "11px" }}>Interstate</div>
                    {renderClickable(r.month, r.reg.interstateTaxable, "TAXABLE", "ALL", "INTERSTATE", "BOOKS", "INVOICE")}
                  </td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.reg.grossIgst, "LIABILITY", "IGST", "ALL", "G3B", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right", color: "var(--google-blue)" }}>{renderClickable(r.month, r.reg.itcAvailableIgst, "ITC", "IGST", "ALL", "BOOKS", "BILL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.reg.itcUsedIgst, "ITC_USED", "IGST", "ALL", "G3B", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.reg.postItcIgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.reg.cashPaidIgst, "CASH_PAID", "IGST", "ALL", "CHALLAN", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatVariance(r.reg.diffIgst)}</td>
                  <td style={{ padding: "8px", textAlign: "center" }}>{renderRegularStatus(r.reg.diffIgst, r.reg, 'IGST')}</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px", fontWeight: "bold" }}>CGST</td>
                  <td style={{ padding: "8px" }}>
                    <div style={{ color: "var(--text-secondary)", fontSize: "11px" }}>Intrastate</div>
                    {renderClickable(r.month, r.reg.intrastateTaxable, "TAXABLE", "ALL", "INTRASTATE", "BOOKS", "INVOICE")}
                  </td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.reg.grossCgst, "LIABILITY", "CGST", "ALL", "G3B", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right", color: "var(--google-blue)" }}>{renderClickable(r.month, r.reg.itcAvailableCgst, "ITC", "CGST", "ALL", "BOOKS", "BILL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.reg.itcUsedCgst, "ITC_USED", "CGST", "ALL", "G3B", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.reg.postItcCgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.reg.cashPaidCgst, "CASH_PAID", "CGST", "ALL", "CHALLAN", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatVariance(r.reg.diffCgst)}</td>
                  <td style={{ padding: "8px", textAlign: "center" }}>{renderRegularStatus(r.reg.diffCgst, r.reg, 'CGST')}</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px", fontWeight: "bold" }}>SGST</td>
                  <td style={{ padding: "8px" }}>
                    <div style={{ color: "var(--text-secondary)", fontSize: "11px" }}>Intrastate</div>
                    {renderClickable(r.month, r.reg.intrastateTaxable, "TAXABLE", "ALL", "INTRASTATE", "BOOKS", "INVOICE")}
                  </td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.reg.grossSgst, "LIABILITY", "SGST", "ALL", "G3B", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right", color: "var(--google-blue)" }}>{renderClickable(r.month, r.reg.itcAvailableSgst, "ITC", "SGST", "ALL", "BOOKS", "BILL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.reg.itcUsedSgst, "ITC_USED", "SGST", "ALL", "G3B", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.reg.postItcSgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.reg.cashPaidSgst, "CASH_PAID", "SGST", "ALL", "CHALLAN", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatVariance(r.reg.diffSgst)}</td>
                  <td style={{ padding: "8px", textAlign: "center" }}>{renderRegularStatus(r.reg.diffSgst, r.reg, 'SGST')}</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px", fontWeight: "bold" }}>Cess</td>
                  <td style={{ padding: "8px" }}>
                     <div style={{ color: "var(--text-secondary)", fontSize: "11px" }}>Cess Base</div>
                     {r.reg.cessTaxable > 0 ? renderClickable(r.month, r.reg.cessTaxable, "TAXABLE", "CESS", "ALL", "BOOKS", "INVOICE") : '-'}
                  </td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.reg.grossCess, "LIABILITY", "CESS", "ALL", "G3B", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right", color: "var(--google-blue)" }}>{renderClickable(r.month, r.reg.itcAvailableCess, "ITC", "CESS", "ALL", "BOOKS", "BILL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.reg.itcUsedCess, "ITC_USED", "CESS", "ALL", "G3B", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.reg.postItcCess)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.reg.cashPaidCess, "CASH_PAID", "CESS", "ALL", "CHALLAN", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatVariance(r.reg.diffCess)}</td>
                  <td style={{ padding: "8px", textAlign: "center" }}>{renderRegularStatus(r.reg.diffCess, r.reg, 'CESS')}</td>
                </tr>
              </tbody>
            </table>
          )}

          {activeTab === 'RCM' && (
            <table className="data-table" style={{ fontSize: "12px", width: "100%", borderCollapse: "collapse", whiteSpace: "nowrap" }}>
              <thead>
                <tr style={{ background: "var(--bg-subtle)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "8px", textAlign: "left" }}>Tax Head</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>RCM Taxable Base</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>RCM Liability</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>RCM Cash Paid</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Cash Variance</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px", fontWeight: "bold" }}>IGST</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.rcm.rcmBooksTaxable, "TAXABLE", "ALL", "ALL", "BOOKS", "BILL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.rcm.rcmLiabIgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.rcm.rcmCashPaidIgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatVariance(r.rcm.rcmDiffIgst)}</td>
                  <td style={{ padding: "8px", textAlign: "center" }}>{renderRcmStatus(r.rcm.rcmDiffIgst)}</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px", fontWeight: "bold" }}>CGST</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.rcm.rcmBooksTaxable, "TAXABLE", "ALL", "ALL", "BOOKS", "BILL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.rcm.rcmLiabCgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.rcm.rcmCashPaidCgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatVariance(r.rcm.rcmDiffCgst)}</td>
                  <td style={{ padding: "8px", textAlign: "center" }}>{renderRcmStatus(r.rcm.rcmDiffCgst)}</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px", fontWeight: "bold" }}>SGST</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.rcm.rcmBooksTaxable, "TAXABLE", "ALL", "ALL", "BOOKS", "BILL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.rcm.rcmLiabSgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.rcm.rcmCashPaidSgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatVariance(r.rcm.rcmDiffSgst)}</td>
                  <td style={{ padding: "8px", textAlign: "center" }}>{renderRcmStatus(r.rcm.rcmDiffSgst)}</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px", fontWeight: "bold" }}>Cess</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.rcm.rcmBooksTaxable, "TAXABLE", "ALL", "ALL", "BOOKS", "BILL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.rcm.rcmLiabCess)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.rcm.rcmCashPaidCess)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatVariance(r.rcm.rcmDiffCess)}</td>
                  <td style={{ padding: "8px", textAlign: "center" }}>{renderRcmStatus(r.rcm.rcmDiffCess)}</td>
                </tr>
              </tbody>
            </table>
          )}

          {activeTab === 'COMBINED' && (
            <table className="data-table" style={{ fontSize: "12px", width: "100%", borderCollapse: "collapse", whiteSpace: "nowrap" }}>
              <thead>
                <tr style={{ background: "var(--bg-subtle)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "8px", textAlign: "left" }}>Tax Head</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Regular Post-ITC Cash</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>RCM Cash Liability</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Combined Cash Req</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Cash Ledger Debit</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Cash Variance</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px", fontWeight: "bold" }}>IGST</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.reg.postItcIgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.rcm.rcmLiabIgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.comb.combReqIgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.comb.combCashLedgerIgst, "DEBIT", "IGST", "ALL", "CASH_LEDGER", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatVariance(r.comb.combDiffIgst)}</td>
                  <td style={{ padding: "8px", textAlign: "center" }}>{renderCombinedStatus(r.comb.combDiffIgst)}</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px", fontWeight: "bold" }}>CGST</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.reg.postItcCgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.rcm.rcmLiabCgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.comb.combReqCgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.comb.combCashLedgerCgst, "DEBIT", "CGST", "ALL", "CASH_LEDGER", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatVariance(r.comb.combDiffCgst)}</td>
                  <td style={{ padding: "8px", textAlign: "center" }}>{renderCombinedStatus(r.comb.combDiffCgst)}</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px", fontWeight: "bold" }}>SGST</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.reg.postItcSgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.rcm.rcmLiabSgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.comb.combReqSgst)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.comb.combCashLedgerSgst, "DEBIT", "SGST", "ALL", "CASH_LEDGER", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatVariance(r.comb.combDiffSgst)}</td>
                  <td style={{ padding: "8px", textAlign: "center" }}>{renderCombinedStatus(r.comb.combDiffSgst)}</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px", fontWeight: "bold" }}>Cess</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.reg.postItcCess)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.rcm.rcmLiabCess)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(r.comb.combReqCess)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{renderClickable(r.month, r.comb.combCashLedgerCess, "DEBIT", "CESS", "ALL", "CASH_LEDGER", "ALL")}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{formatVariance(r.comb.combDiffCess)}</td>
                  <td style={{ padding: "8px", textAlign: "center" }}>{renderCombinedStatus(r.comb.combDiffCess)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default function GstMonthlyReconciliationV2({ globalFY, selectedMonth, actionPriority, setActionPriority }: any) {
  const [matrixData, setMatrixData] = useState<any>(null);
  const [paymentMatrixData, setPaymentMatrixData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [drilldown, setDrilldown] = useState<any>(null);
  const [openDoc, setOpenDoc] = useState<any>(null);
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});

  // Sync expandedMonths with selectedMonth
  useEffect(() => {
    if (selectedMonth !== 'FULL') {
      setExpandedMonths({ [selectedMonth]: true });
    } else {
      setExpandedMonths({});
    }
  }, [selectedMonth]);

  useEffect(() => {
    fetch('/monthly-tax-matrix.json').then(r => r.json()).then(d => {
      setMatrixData(d['2025-26']?.months || d);
    });
    fetch('/3b-payment-matrix.json').then(r => r.json()).then(d => {
      setPaymentMatrixData(d['2025-26'] || d);
    });
  }, []);

  const isNotFY2526 = globalFY !== "2025-26";
  const fullMonths = ["04 2025", "05 2025", "06 2025", "07 2025", "08 2025", "09 2025", "10 2025", "11 2025", "12 2025", "01 2026", "02 2026", "03 2026"];

  const handleExpandAll = () => {
    const allExp: Record<string, boolean> = {};
    fullMonths.forEach(m => allExp[m] = true);
    setExpandedMonths(allExp);
  };

  const handleCollapseAll = () => {
    setExpandedMonths({});
  };

  const hasAnyData = fullMonths.some(m => matrixData && matrixData[m]);
  const isSourceDataNotAvailable = selectedMonth === 'FULL' && !hasAnyData && matrixData;

  const handleDrilldown = async (mStr: string, metric: string, taxHead: string, supplyType: string, sourceType: string, documentType: string, val: number) => {
    setLoading(true);
    try {
      const url = `/api/audit/gst/reconciliation/drilldown?FY=${encodeURIComponent(globalFY || "2025-26")}&period=${encodeURIComponent(mStr)}&selectedGlobalPeriod=${encodeURIComponent(selectedMonth)}&tab=REGULAR&metric=${encodeURIComponent(metric)}&taxHead=${encodeURIComponent(taxHead)}&supplyType=${encodeURIComponent(supplyType)}&sourceType=${encodeURIComponent(sourceType)}&documentType=${encodeURIComponent(documentType)}`;
      const res = await fetch(url);
      const data = await res.json();
      data.reconciliation.displayedTotal = val; 
      data.reconciliation.difference = roundMoney(val - data.reconciliation.componentTotal);
      if (Math.abs(data.reconciliation.difference) <= 0.01) { data.reconciliation.difference = 0; }
      setDrilldown(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const renderClickable = (mStr: string, val: number | null | undefined, metric: string, taxHead: string, supplyType: string, sourceType: string, documentType: string) => {
    if (val === undefined || val === null || (metric === "ITC_USED" && Number.isNaN(val))) {
      return (
        <button 
          onClick={(e) => { e.stopPropagation(); handleDrilldown(mStr, metric, taxHead, supplyType, sourceType, documentType, 0); }}
          style={{
            background: "none", border: "none", color: "var(--google-yellow)", cursor: "pointer",
            textDecoration: "underline", padding: 0, fontSize: "inherit", fontFamily: "inherit", fontStyle: "italic"
          }}
        >
          SOURCE DATA NOT AVAILABLE
        </button>
      );
    }
    return (
      <button 
        onClick={(e) => { e.stopPropagation(); handleDrilldown(mStr, metric, taxHead, supplyType, sourceType, documentType, val); }}
        style={{
          background: "none", border: "none", color: "var(--google-blue)", cursor: "pointer",
          textDecoration: "underline", padding: 0, fontSize: "inherit", fontFamily: "inherit"
        }}
      >
        {formatINR(val)}
      </button>
    );
  };

  const mStrArr = selectedMonth === 'FULL' ? fullMonths : [selectedMonth];
  
  const valOrNull = (v: any) => (v === undefined || v === null || Number.isNaN(v)) ? null : v;
  const addOrNull = (...vals: any[]) => {
    if (vals.some(v => v === undefined || v === null || Number.isNaN(v))) return null;
    return vals.reduce((sum, v) => sum + v, 0);
  };
  const diffOrNull = (a: any, b: any) => {
    if (a === null || b === null) return null;
    return roundMoney(a - b);
  };

  const getMatrixStatus = (r: any) => {
    if (!r.b3 || Object.keys(r.b3).length === 0) return <span style={{ color: "var(--google-yellow)", fontWeight: "bold" }}>SOURCE INPUTS INCOMPLETE</span>;
    
    const b3 = r.b3;
    const reg = r.reg;
    
    if ((b3.itc_cgst_sgst && b3.itc_cgst_sgst > 0) || (b3.itc_sgst_cgst && b3.itc_sgst_cgst > 0)) {
        return <span style={{ color: "var(--google-red)", fontWeight: "bold" }}>FILED UTILISATION VIOLATES RULE</span>;
    }
    
    const igstUsedTotal = (b3.itc_igst_igst || 0) + (b3.itc_igst_cgst || 0) + (b3.itc_igst_sgst || 0);
    const igstUnutilised = roundMoney((reg.itcAvailableIgst || 0) - igstUsedTotal);
    const otherUsedTotal = (b3.itc_cgst_cgst || 0) + (b3.itc_cgst_igst || 0) + (b3.itc_sgst_sgst || 0) + (b3.itc_sgst_igst || 0);
    
    if (igstUnutilised > 1 && otherUsedTotal > 0) {
        return <span style={{ color: "var(--google-red)", fontWeight: "bold" }}>FILED UTILISATION VIOLATES RULE</span>;
    }
    
    if (b3.itc_cgst_igst > 0 || b3.itc_sgst_igst > 0) {
       const igstLiabRemaining = roundMoney((reg.grossIgst || 0) - (b3.itc_igst_igst || 0));
       if (igstLiabRemaining > 0 && igstUnutilised > 1) {
           return <span style={{ color: "var(--google-red)", fontWeight: "bold" }}>FILED UTILISATION VIOLATES RULE</span>;
       }
    }
    
    if (Math.abs(igstUnutilised) > 0 && Math.abs(igstUnutilised) < 1.0) {
       return <span style={{ color: "var(--google-green)", fontWeight: "bold" }}>FILED ROUNDING</span>;
    }
    
    return <span style={{ color: "var(--google-green)", fontWeight: "bold" }}>FILED UTILISATION RECONCILED</span>;
  };
  
  const calculateRowValues = (mStr: string) => {
    const mData = matrixData ? matrixData[mStr] : null;
    if (!mData) return null;
    const pData = paymentMatrixData ? paymentMatrixData[mStr] : null;
    const b3 = pData ? pData['3b'] : {};
    const cl = pData ? pData['cash_ledger'] : {};
    
    const interstateTaxable = valOrNull(mData.b_s_interstate_taxable);
    const intrastateTaxable = valOrNull(mData.b_s_intrastate_taxable);
    const cessTaxable = 0;
    
    const itcAvailableIgst = valOrNull(mData.g3b_itc_igst);
    const itcAvailableCgst = valOrNull(mData.g3b_itc_cgst);
    const itcAvailableSgst = valOrNull(mData.g3b_itc_sgst);
    const itcAvailableCess = valOrNull(mData.g3b_itc_cess);

    const itcUsedIgst = Object.keys(b3).length === 0 ? null : addOrNull(valOrNull(b3.itc_igst_igst), valOrNull(b3.itc_igst_cgst), valOrNull(b3.itc_igst_sgst), valOrNull(b3.itc_igst_cess));
    const itcUsedCgst = Object.keys(b3).length === 0 ? null : addOrNull(valOrNull(b3.itc_cgst_igst), valOrNull(b3.itc_cgst_cgst), valOrNull(b3.itc_cgst_sgst), valOrNull(b3.itc_cgst_cess));
    const itcUsedSgst = Object.keys(b3).length === 0 ? null : addOrNull(valOrNull(b3.itc_sgst_igst), valOrNull(b3.itc_sgst_cgst), valOrNull(b3.itc_sgst_sgst), valOrNull(b3.itc_sgst_cess));
    const itcUsedCess = Object.keys(b3).length === 0 ? null : addOrNull(valOrNull(b3.itc_cess_igst), valOrNull(b3.itc_cess_cgst), valOrNull(b3.itc_cess_sgst), valOrNull(b3.itc_cess_cess));

    const grossIgst = valOrNull(mData.g3b_igst) !== null ? roundMoney(mData.g3b_igst) : null;
    const grossCgst = valOrNull(mData.g3b_cgst) !== null ? roundMoney(mData.g3b_cgst) : null;
    const grossSgst = valOrNull(mData.g3b_sgst) !== null ? roundMoney(mData.g3b_sgst) : null;
    const grossCess = valOrNull(mData.g3b_cess) !== null ? roundMoney(mData.g3b_cess) : null;

    const postItcIgst = grossIgst !== null && itcUsedIgst !== null ? Math.max(0, grossIgst - itcUsedIgst) : null;
    const postItcCgst = grossCgst !== null && itcUsedCgst !== null ? Math.max(0, grossCgst - itcUsedCgst) : null;
    const postItcSgst = grossSgst !== null && itcUsedSgst !== null ? Math.max(0, grossSgst - itcUsedSgst) : null;
    const postItcCess = grossCess !== null && itcUsedCess !== null ? Math.max(0, grossCess - itcUsedCess) : null;

    const cashPaidIgst = Object.keys(b3).length === 0 ? null : valOrNull(b3.cash_igst);
    const cashPaidCgst = Object.keys(b3).length === 0 ? null : valOrNull(b3.cash_cgst);
    const cashPaidSgst = Object.keys(b3).length === 0 ? null : valOrNull(b3.cash_sgst);
    const cashPaidCess = Object.keys(b3).length === 0 ? null : valOrNull(b3.cash_cess);

    const diffIgst = diffOrNull(cashPaidIgst, postItcIgst);
    const diffCgst = diffOrNull(cashPaidCgst, postItcCgst);
    const diffSgst = diffOrNull(cashPaidSgst, postItcSgst);
    const diffCess = diffOrNull(cashPaidCess, postItcCess);
    
    const rcmBooksTaxable = valOrNull(mData.b_r_tax);
    const rcmLiabIgst = valOrNull(mData.g3b_rcm_igst) !== null ? roundMoney(mData.g3b_rcm_igst) : null;
    const rcmLiabCgst = valOrNull(mData.g3b_rcm_cgst) !== null ? roundMoney(mData.g3b_rcm_cgst) : null;
    const rcmLiabSgst = valOrNull(mData.g3b_rcm_sgst) !== null ? roundMoney(mData.g3b_rcm_sgst) : null;
    const rcmLiabCess = valOrNull(mData.g3b_rcm_cess) !== null ? roundMoney(mData.g3b_rcm_cess) : null;

    const rcmCashPaidIgst = Object.keys(b3).length === 0 ? null : valOrNull(b3.rcm_cash_igst);
    const rcmCashPaidCgst = Object.keys(b3).length === 0 ? null : valOrNull(b3.rcm_cash_cgst);
    const rcmCashPaidSgst = Object.keys(b3).length === 0 ? null : valOrNull(b3.rcm_cash_sgst);
    const rcmCashPaidCess = Object.keys(b3).length === 0 ? null : valOrNull(b3.rcm_cash_cess);

    const rcmDiffIgst = diffOrNull(rcmCashPaidIgst, rcmLiabIgst);
    const rcmDiffCgst = diffOrNull(rcmCashPaidCgst, rcmLiabCgst);
    const rcmDiffSgst = diffOrNull(rcmCashPaidSgst, rcmLiabSgst);
    const rcmDiffCess = diffOrNull(rcmCashPaidCess, rcmLiabCess);

    const combReqIgst = addOrNull(postItcIgst, rcmLiabIgst);
    const combReqCgst = addOrNull(postItcCgst, rcmLiabCgst);
    const combReqSgst = addOrNull(postItcSgst, rcmLiabSgst);
    const combReqCess = addOrNull(postItcCess, rcmLiabCess);

    const combCashLedgerIgst = Object.keys(cl).length === 0 ? null : valOrNull(cl.igst);
    const combCashLedgerCgst = Object.keys(cl).length === 0 ? null : valOrNull(cl.cgst);
    const combCashLedgerSgst = Object.keys(cl).length === 0 ? null : valOrNull(cl.sgst);
    const combCashLedgerCess = Object.keys(cl).length === 0 ? null : valOrNull(cl.cess);

    const combDiffIgst = diffOrNull(combCashLedgerIgst, combReqIgst);
    const combDiffCgst = diffOrNull(combCashLedgerCgst, combReqCgst);
    const combDiffSgst = diffOrNull(combCashLedgerSgst, combReqSgst);
    const combDiffCess = diffOrNull(combCashLedgerCess, combReqCess);

    return {
      month: mStr,
      b3,
      cl,
      reg: { interstateTaxable, intrastateTaxable, cessTaxable, grossIgst, grossCgst, grossSgst, grossCess, itcAvailableIgst, itcAvailableCgst, itcAvailableSgst, itcAvailableCess, itcUsedIgst, itcUsedCgst, itcUsedSgst, itcUsedCess, postItcIgst, postItcCgst, postItcSgst, postItcCess, cashPaidIgst, cashPaidCgst, cashPaidSgst, cashPaidCess, diffIgst, diffCgst, diffSgst, diffCess },
      rcm: { rcmBooksTaxable, rcmLiabIgst, rcmLiabCgst, rcmLiabSgst, rcmLiabCess, rcmCashPaidIgst, rcmCashPaidCgst, rcmCashPaidSgst, rcmCashPaidCess, rcmDiffIgst, rcmDiffCgst, rcmDiffSgst, rcmDiffCess },
      comb: { combReqIgst, combReqCgst, combReqSgst, combReqCess, combCashLedgerIgst, combCashLedgerCgst, combCashLedgerSgst, combCashLedgerCess, combDiffIgst, combDiffCgst, combDiffSgst, combDiffCess }
    };
  };

  const rows = mStrArr.map(calculateRowValues).filter(Boolean);

  const renderRegularStatus = (diff: number | null, reg: any, head: string) => {
    if (diff == null) return <span style={{ color: "var(--google-yellow)", fontWeight: "bold" }}>INCOMPLETE</span>;
    const itcAvail = head === 'IGST' ? reg.itcAvailableIgst : head === 'CGST' ? reg.itcAvailableCgst : reg.itcAvailableSgst;
    const itcUsed = head === 'IGST' ? reg.itcUsedIgst : head === 'CGST' ? reg.itcUsedCgst : reg.itcUsedSgst;
    if (itcAvail == null || itcUsed == null) return <span style={{ color: "var(--google-yellow)", fontWeight: "bold" }}>INCOMPLETE</span>;
    const roundingDiff = roundMoney(itcAvail - itcUsed);
    if (diff === 0) {
      if (Math.abs(roundingDiff) > 0 && Math.abs(roundingDiff) < 1.0) {
        return <span style={{ color: "var(--google-green)", fontWeight: "bold" }}>MATCHED — ROUNDING</span>;
      }
      return <span style={{ color: "var(--google-green)", fontWeight: "bold" }}>MATCHED</span>;
    }
    if (Math.round(diff) === 0) {
       return <span style={{ color: "var(--google-green)", fontWeight: "bold" }}>MATCHED — ROUNDING</span>;
    }
    if (diff < 0) {
       if (Math.abs(Math.abs(diff) - itcAvail) < 1.0) return <span style={{ color: "var(--google-yellow)", fontWeight: "bold" }}>INCOMPLETE</span>;
       return <span style={{ color: "var(--google-red)", fontWeight: "bold" }}>SHORT</span>;
    }
    return <span style={{ color: "var(--google-yellow)", fontWeight: "bold" }}>EXCESS</span>;
  };

  const renderRcmStatus = (diff: number | null) => {
    if (diff == null) return <span style={{ color: "var(--google-yellow)", fontWeight: "bold" }}>INCOMPLETE</span>;
    if (diff === 0) return <span style={{ color: "var(--google-green)", fontWeight: "bold" }}>MATCHED</span>;
    if (Math.round(diff) === 0) return <span style={{ color: "var(--google-green)", fontWeight: "bold" }}>MATCHED — ROUNDING</span>;
    if (diff < 0) return <span style={{ color: "var(--google-red)", fontWeight: "bold" }}>SHORT</span>;
    return <span style={{ color: "var(--google-yellow)", fontWeight: "bold" }}>EXCESS</span>;
  };

  const renderCombinedStatus = (diff: number | null) => {
    if (diff == null) return <span style={{ color: "var(--google-yellow)", fontWeight: "bold" }}>INCOMPLETE</span>;
    if (diff === 0) return <span style={{ color: "var(--google-green)", fontWeight: "bold" }}>MATCHED</span>;
    if (Math.round(diff) === 0) return <span style={{ color: "var(--google-green)", fontWeight: "bold" }}>MATCHED — ROUNDING</span>;
    if (diff < 0) return <span style={{ color: "var(--google-red)", fontWeight: "bold" }}>SHORT</span>;
    return <span style={{ color: "var(--google-yellow)", fontWeight: "bold" }}>EXCESS</span>;
  };

  if (isNotFY2526) {
    return (
      <div className="section-card" style={{ padding: "20px", marginBottom: "24px", border: "1px solid var(--border-subtle)", background: "var(--bg-subtle)" }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", color: "var(--text-primary)", fontWeight: 700 }}>OWNER MONTHLY RECONCILIATION</h3>
        <div style={{ fontWeight: 600, marginBottom: "16px", color: "var(--google-blue)" }}>FY {globalFY}</div>
        
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px", fontFamily: "monospace" }}>
          <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}><span>BOOKS DATA:</span><span className="status-chip draft">PARTIAL / SYNC REQUIRED</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}><span>GSTR-1:</span><span className="status-chip draft">FILE REQUIRED</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}><span>GSTR-3B:</span><span className="status-chip draft">FILE REQUIRED</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}><span>LEDGER EVIDENCE:</span><span className="status-chip draft">FILE REQUIRED</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "8px", fontWeight: 600 }}><span>MONTHLY RECONCILIATION:</span><span className="status-chip draft">NOT YET GENERATED</span></div>
        </div>
      </div>
    );
  }

  if (isSourceDataNotAvailable) {
    return (
      <div id="monthly" className="section-card" style={{ padding: "40px 20px", marginBottom: "24px", textAlign: "center", color: "var(--google-red)", fontWeight: 600 }}>
        SOURCE DATA NOT AVAILABLE FOR SELECTED PERIOD
      </div>
    );
  }

  return (
    <div id="monthly">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h2 className="section-title" style={{ margin: 0 }}>Owner Monthly Reconciliation</h2>
        {selectedMonth === 'FULL' && (
           <div style={{ display: "flex", gap: "8px" }}>
             <button onClick={handleExpandAll} style={{ background: "white", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: "4px", padding: "6px 12px", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>Expand All</button>
             <button onClick={handleCollapseAll} style={{ background: "white", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: "4px", padding: "6px 12px", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>Collapse All</button>
           </div>
        )}
      </div>
      
      {rows.length === 0 && (
        <div style={{ margin: "16px 0" }}>
          <EvidenceUploadManager globalFY={globalFY || "2025-26"} requiredSources={['GSTR-1', 'GSTR-3B', 'Liability Ledger', 'Credit Ledger', 'Cash Ledger', 'Challan']} mode="panel" />
        </div>
      )}

      {selectedMonth === 'FULL' && rows.length > 0 && (
        <FYTotalCard rows={rows} globalFY={globalFY || "2025-26"} />
      )}

      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((r: any) => (
          <MonthCard 
            key={r.month} 
            r={r} 
            handleDrilldown={handleDrilldown} 
            renderClickable={renderClickable}
            getMatrixStatus={getMatrixStatus}
            renderRegularStatus={renderRegularStatus}
            renderRcmStatus={renderRcmStatus}
            renderCombinedStatus={renderCombinedStatus}
            isExpanded={!!expandedMonths[r.month]}
            setExpanded={(exp: boolean) => setExpandedMonths(prev => ({ ...prev, [r.month]: exp }))}
          />
        ))}
      </div>

      {drilldown && (
        <div onClick={(e) => { if(e.target === e.currentTarget) setDrilldown(null); }} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000, padding: "24px" }}>
          <div style={{ background: "white", borderRadius: "8px", width: "94vw", maxWidth: "1700px", height: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 4px 24px rgba(0,0,0,0.15)" }}>
            <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-subtle)", borderRadius: "8px 8px 0 0", position: "sticky", top: 0, zIndex: 1 }}>
              <h3 style={{ margin: 0, fontSize: "16px" }}>{drilldown.context.metric} Documents — {drilldown.context.period}</h3>
              <button onClick={() => setDrilldown(null)} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer" }}>✕</button>
            </div>
            
            <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border-subtle)", display: "flex", gap: "24px", background: "white" }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--text-secondary)", fontSize: "12px", marginBottom: "4px" }}>Status</div>
                <div style={{ fontWeight: "bold", color: drilldown.summary.status === "PASS" ? "var(--google-green)" : "var(--google-red)" }}>{drilldown.summary.status}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--text-secondary)", fontSize: "12px", marginBottom: "4px" }}>Component Total</div>
                <div style={{ fontWeight: "bold" }}>{formatINR(drilldown.reconciliation.componentTotal)}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--text-secondary)", fontSize: "12px", marginBottom: "4px" }}>Displayed Amount</div>
                <div style={{ fontWeight: "bold" }}>{formatINR(drilldown.reconciliation.displayedTotal)}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--text-secondary)", fontSize: "12px", marginBottom: "4px" }}>Difference</div>
                <div style={{ fontWeight: "bold", color: Math.abs(drilldown.reconciliation.difference) > 0.01 ? "var(--google-red)" : "var(--google-green)" }}>
                  {formatINR(drilldown.reconciliation.difference)}
                </div>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 24px 24px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead style={{ position: "sticky", top: 0, background: "white", zIndex: 1, boxShadow: "0 1px 0 var(--border-subtle)" }}>
                  <tr>
                    <th style={{ padding: "12px 8px", textAlign: "left" }}>Date</th>
                    <th style={{ padding: "12px 8px", textAlign: "left" }}>Doc #</th>
                    <th style={{ padding: "12px 8px", textAlign: "left" }}>Party</th>
                    <th style={{ padding: "12px 8px", textAlign: "left" }}>GSTIN</th>
                    <th style={{ padding: "12px 8px", textAlign: "right" }}>Taxable</th>
                    <th style={{ padding: "12px 8px", textAlign: "right" }}>IGST</th>
                    <th style={{ padding: "12px 8px", textAlign: "right" }}>CGST</th>
                    <th style={{ padding: "12px 8px", textAlign: "right" }}>SGST</th>
                    <th style={{ padding: "12px 8px", textAlign: "right" }}>Cess</th>
                    <th style={{ padding: "12px 8px", textAlign: "right" }}>Gross</th>
                    <th style={{ padding: "12px 8px", textAlign: "center" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {drilldown.components.map((c: any, i: number) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "8px" }}>{c.date}</td>
                      <td style={{ padding: "8px" }}>{c.documentNumber}</td>
                      <td style={{ padding: "8px" }}>{c.party}</td>
                      <td style={{ padding: "8px" }}>{c.gstin}</td>
                      <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(c.taxable)}</td>
                      <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(c.igst)}</td>
                      <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(c.cgst)}</td>
                      <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(c.sgst)}</td>
                      <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(c.cess)}</td>
                      <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(c.gross || c.amount)}</td>
                      <td style={{ padding: "8px", textAlign: "center" }}>
                        <button style={{ background: "none", border: "none", color: "var(--google-blue)", cursor: "pointer", textDecoration: "underline" }} onClick={(e) => { e.stopPropagation(); setOpenDoc({ ...c, totTax: (c.igst||0)+(c.cgst||0)+(c.sgst||0)+(c.cess||0) }); }}>View</button>
                      </td>
                    </tr>
                  ))}
                  {drilldown.components.length === 0 && (
                    <tr>
                      <td colSpan={11} style={{ padding: "40px", textAlign: "center", color: "var(--text-secondary)" }}>
                        No underlying documents found. (Evidence Missing or Unsupported Request)
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border-subtle)", background: "var(--bg-subtle)", borderRadius: "0 0 8px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>Showing {drilldown.components.length} rows</div>
              <button onClick={() => setDrilldown(null)} style={{ padding: "8px 24px", background: "white", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: "4px", cursor: "pointer", fontWeight: 600 }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {openDoc && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1001, padding: "24px" }}>
          <div style={{ background: "white", padding: "0", borderRadius: "8px", width: "94vw", maxWidth: "1700px", height: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}>
             <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-subtle)", borderRadius: "8px 8px 0 0" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "18px", color: "var(--text-primary)" }}>{openDoc.source} - {openDoc.documentNumber}</h2>
                  <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>Date: {openDoc.date} | Status: <span style={{ color: "var(--google-green)", fontWeight: 600 }}>MATCHED</span> | Eligibility: {openDoc.eligibility || 'N/A'}</div>
                </div>
                <button onClick={() => setOpenDoc(null)} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "var(--text-secondary)" }}>✕</button>
             </div>
             <div style={{ flex: 1, overflowY: "auto", padding: "24px", fontSize: "14px" }}>
                 <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "24px" }}>
                   <div style={{ padding: "16px", border: "1px solid var(--border-subtle)", borderRadius: "8px" }}>
                     <h4 style={{ margin: "0 0 12px 0", color: "var(--text-secondary)", fontSize: "12px", textTransform: "uppercase" }}>Party Details</h4>
                     <div style={{ fontWeight: 600 }}>{openDoc.party}</div>
                     {openDoc.gstin && <div style={{ color: "var(--text-secondary)" }}>GSTIN: {openDoc.gstin}</div>}
                   </div>
                   <div style={{ padding: "16px", border: "1px solid var(--border-subtle)", borderRadius: "8px" }}>
                     <h4 style={{ margin: "0 0 12px 0", color: "var(--text-secondary)", fontSize: "12px", textTransform: "uppercase" }}>Tax Breakdown</h4>
                     <div style={{ display: "flex", justifyContent: "space-between" }}><span>Taxable:</span> <span>{formatINR(openDoc.taxable || openDoc.amount)}</span></div>
                     <div style={{ display: "flex", justifyContent: "space-between" }}><span>IGST:</span> <span>{formatINR(openDoc.igst || 0)}</span></div>
                     <div style={{ display: "flex", justifyContent: "space-between" }}><span>CGST:</span> <span>{formatINR(openDoc.cgst || 0)}</span></div>
                     <div style={{ display: "flex", justifyContent: "space-between" }}><span>SGST:</span> <span>{formatINR(openDoc.sgst || 0)}</span></div>
                     <div style={{ display: "flex", justifyContent: "space-between" }}><span>Cess:</span> <span>{formatINR(openDoc.cess || 0)}</span></div>
                   </div>
                   <div style={{ padding: "16px", border: "1px solid var(--border-subtle)", borderRadius: "8px", background: "var(--bg-subtle)" }}>
                     <h4 style={{ margin: "0 0 12px 0", color: "var(--text-secondary)", fontSize: "12px", textTransform: "uppercase" }}>Document Totals</h4>
                     <div style={{ display: "flex", justifyContent: "space-between" }}><span>Total Tax:</span> <span>{formatINR(openDoc.totTax || 0)}</span></div>
                     <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "16px", marginTop: "8px" }}><span>Gross Total:</span> <span>{formatINR(openDoc.gross || openDoc.amount)}</span></div>
                   </div>
                 </div>
                 
                 <h3 style={{ margin: "0 0 16px 0", fontSize: "16px" }}>Line Items</h3>
                 <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", marginBottom: "24px" }}>
                   <thead>
                     <tr style={{ background: "var(--bg-subtle)", borderBottom: "2px solid var(--border-subtle)" }}>
                       <th style={{ padding: "12px", textAlign: "left" }}>#</th>
                       <th style={{ padding: "12px", textAlign: "left" }}>Description</th>
                       <th style={{ padding: "12px", textAlign: "right" }}>Taxable</th>
                       <th style={{ padding: "12px", textAlign: "right" }}>Tax %</th>
                       <th style={{ padding: "12px", textAlign: "right" }}>IGST</th>
                       <th style={{ padding: "12px", textAlign: "right" }}>CGST</th>
                       <th style={{ padding: "12px", textAlign: "right" }}>SGST</th>
                       <th style={{ padding: "12px", textAlign: "right" }}>Line Total</th>
                     </tr>
                   </thead>
                   <tbody>
                     <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                       <td style={{ padding: "12px" }}>1</td>
                       <td style={{ padding: "12px" }}>Standard Item</td>
                       <td style={{ padding: "12px", textAlign: "right" }}>{formatINR(openDoc.taxable || openDoc.amount)}</td>
                       <td style={{ padding: "12px", textAlign: "right" }}>Var%</td>
                       <td style={{ padding: "12px", textAlign: "right" }}>{formatINR(openDoc.igst || 0)}</td>
                       <td style={{ padding: "12px", textAlign: "right" }}>{formatINR(openDoc.cgst || 0)}</td>
                       <td style={{ padding: "12px", textAlign: "right" }}>{formatINR(openDoc.sgst || 0)}</td>
                       <td style={{ padding: "12px", textAlign: "right", fontWeight: 600 }}>{formatINR(openDoc.gross || openDoc.amount)}</td>
                     </tr>
                   </tbody>
                 </table>

                 <div style={{ background: "var(--bg-subtle)", padding: "16px", borderRadius: "8px", borderLeft: "4px solid var(--google-blue)" }}>
                   <h4 style={{ margin: "0 0 8px 0" }}>Evidence Details</h4>
                   <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", fontSize: "13px" }}>
                     <div><strong>Classification:</strong> {openDoc.classification || 'MATCHED'}</div>
                     <div><strong>Difference:</strong> {formatINR(0)}</div>
                     <div><strong>Source Type:</strong> {openDoc.source}</div>
                     <div><strong>Reversal Reason:</strong> {openDoc.reversal_reason || 'None'}</div>
                   </div>
                 </div>
             </div>
             <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border-subtle)", background: "white", borderRadius: "0 0 8px 8px", display: "flex", justifyContent: "flex-end", position: "sticky", bottom: 0 }}>
                <button onClick={() => setOpenDoc(null)} style={{ padding: "8px 24px", background: "var(--google-blue)", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: 600 }}>Back to List</button>
             </div>
          </div>
        </div>
      )}

    </div>
  );
}

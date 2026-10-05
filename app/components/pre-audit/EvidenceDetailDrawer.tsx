"use client";

import React from "react";
import { AuditFinding } from "@/app/lib/audit/audit-findings-service";

export type EvidenceItemType = "FINDING" | "TB_ACCOUNT" | "BANK_MATCH" | "CASH_BOOK";

export interface EvidenceDetailData {
  type: EvidenceItemType;
  title: string;
  finding?: AuditFinding;
  tbAccount?: {
    account_id: string;
    account_name: string;
    account_type?: string;
    parent_account_name?: string;
    net_debit?: number;
    net_credit?: number;
    depth?: number;
  };
  bankMatch?: {
    bookTxId?: string;
    bookDate?: string;
    bookAmount?: number;
    bookType?: string;
    bookParty?: string;
    bookRef?: string;
    bookDesc?: string;
    stmtRowId?: string;
    stmtDate?: string;
    stmtAmount?: number;
    stmtNarration?: string;
    stmtRef?: string;
    resolutionBasis?: string;
    isGrouped?: boolean;
    groupedItems?: any[];
  };
  cashAccount?: {
    account_id: string;
    account_name: string;
    balance: number;
    parent_account?: string;
    currency_code?: string;
  };
}

interface EvidenceDetailDrawerProps {
  data: EvidenceDetailData | null;
  onClose: () => void;
  currencySymbol?: string;
}

export function EvidenceDetailDrawer({
  data,
  onClose,
  currencySymbol = "₹",
}: EvidenceDetailDrawerProps) {
  if (!data) return null;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0, 0, 0, 0.4)",
      display: "flex",
      justifyContent: "flex-end",
      zIndex: 99999,
      backdropFilter: "blur(2px)",
      animation: "fadeIn 0.15s ease-out"
    }}>
      <div style={{
        width: "100%",
        maxWidth: "600px",
        height: "100%",
        background: "#ffffff",
        boxShadow: "-4px 0 20px rgba(0, 0, 0, 0.15)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden"
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#f8fafc"
        }}>
          <div>
            <span style={{
              display: "inline-block",
              fontSize: "10px",
              fontWeight: 700,
              textTransform: "uppercase",
              padding: "2px 6px",
              borderRadius: "4px",
              background: "#e0e7ff",
              color: "#3730a3",
              marginBottom: "4px"
            }}>
              {data.type.replace(/_/g, " ")} DRILL-DOWN
            </span>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
              {data.title}
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "20px",
              cursor: "pointer",
              color: "#64748b",
              padding: "4px 8px"
            }}
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: "20px", overflowY: "auto", flex: 1, fontSize: "13px", lineHeight: "1.6" }}>
          {/* 1. FINDING DRILL-DOWN */}
          {data.type === "FINDING" && data.finding && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{
                padding: "12px",
                background: "#f8fafc",
                borderRadius: "6px",
                border: "1px solid #e2e8f0"
              }}>
                <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
                  Observed Evidence
                </div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a", marginTop: "4px" }}>
                  {data.finding.observed_fact || data.finding.evidence}
                </div>
                {data.finding.amount && (
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#b91c1c", marginTop: "6px" }}>
                    Amount Exposure: {currencySymbol}{data.finding.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </div>
                )}
              </div>

              <div>
                <h4 style={{ fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: "6px" }}>
                  Possible Causes (Hypotheses)
                </h4>
                <ul style={{ margin: 0, paddingLeft: "18px", color: "#334155" }}>
                  {(data.finding.possible_causes && data.finding.possible_causes.length > 0) ? (
                    data.finding.possible_causes.map((c, i) => (
                      <li key={i} style={{ marginBottom: "4px" }}>{c}</li>
                    ))
                  ) : (
                    <li>{data.finding.possible_cause || "Pending transaction-level ledger investigation."}</li>
                  )}
                </ul>
              </div>

              <div>
                <h4 style={{ fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: "6px" }}>
                  Required Substantive Verification
                </h4>
                <div style={{ padding: "10px", background: "#f1f5f9", borderRadius: "6px", color: "#1e293b", fontSize: "12px" }}>
                  {data.finding.required_verification || data.finding.recommended_investigation}
                </div>
              </div>

              <div>
                <h4 style={{ fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: "6px" }}>
                  Proposed Treatment (Advisory Only)
                </h4>
                <div style={{
                  padding: "10px",
                  background: "#eff6ff",
                  borderRadius: "6px",
                  borderLeft: "4px solid #3b82f6",
                  color: "#1e40af",
                  fontSize: "12px",
                  fontWeight: 500
                }}>
                  {data.finding.proposed_treatment}
                </div>
              </div>

              <div>
                <h4 style={{ fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: "6px" }}>
                  Tax & Statutory Audit Relevance
                </h4>
                <div style={{ fontSize: "12px", color: "#4b5563" }}>
                  {data.finding.tax_relevance}
                </div>
              </div>
            </div>
          )}

          {/* 2. TB ACCOUNT DRILL-DOWN */}
          {data.type === "TB_ACCOUNT" && data.tbAccount && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ padding: "12px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: "11px", color: "#64748b" }}>Account ID: {data.tbAccount.account_id}</div>
                <div style={{ fontSize: "16px", fontWeight: 700, marginTop: "2px" }}>{data.tbAccount.account_name}</div>
                {data.tbAccount.parent_account_name && (
                  <div style={{ fontSize: "12px", color: "#475569", marginTop: "4px" }}>
                    Parent: <strong>{data.tbAccount.parent_account_name}</strong>
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div style={{ padding: "10px", background: "#f0fdf4", borderRadius: "6px", border: "1px solid #bbf7d0" }}>
                  <div style={{ fontSize: "11px", color: "#166534", fontWeight: 600 }}>Net Debit</div>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#15803d" }}>
                    {currencySymbol}{(data.tbAccount.net_debit || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div style={{ padding: "10px", background: "#fef2f2", borderRadius: "6px", border: "1px solid #fecaca" }}>
                  <div style={{ fontSize: "11px", color: "#991b1b", fontWeight: 600 }}>Net Credit</div>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#b91c1c" }}>
                    {currencySymbol}{(data.tbAccount.net_credit || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "8px" }}>
                * All balances extracted from Zoho Trial Balance Report. Click below for local ledger trace.
              </div>
            </div>
          )}

          {/* 3. BANK MATCH DRILL-DOWN */}
          {data.type === "BANK_MATCH" && data.bankMatch && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{
                padding: "10px",
                background: "#f0fdf4",
                borderRadius: "6px",
                border: "1px solid #bbf7d0",
                fontSize: "12px",
                color: "#166534",
                fontWeight: 600
              }}>
                ✓ Reconciliation Status: {data.bankMatch.isGrouped ? "VERIFIED GROUPED COMPOSITE" : "DETERMINISTIC MATCH"}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px" }}>
                <div style={{ padding: "12px", border: "1px solid #cbd5e1", borderRadius: "6px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#2563eb", textTransform: "uppercase" }}>
                    Zoho Book Entry
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 600, marginTop: "4px" }}>
                    {data.bankMatch.bookParty || "Book Transaction"} ({data.bankMatch.bookType || "Payment"})
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b" }}>Date: {data.bankMatch.bookDate} | ID: {data.bankMatch.bookTxId}</div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", marginTop: "6px" }}>
                    Amount: {currencySymbol}{(data.bankMatch.bookAmount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </div>
                  {data.bankMatch.bookDesc && (
                    <div style={{ fontSize: "11px", color: "#475569", marginTop: "6px", background: "#f8fafc", padding: "6px", borderRadius: "4px" }}>
                      Description: {data.bankMatch.bookDesc}
                    </div>
                  )}
                </div>

                <div style={{ padding: "12px", border: "1px solid #cbd5e1", borderRadius: "6px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#16a34a", textTransform: "uppercase" }}>
                    Bank Statement Entry
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 600, marginTop: "4px" }}>
                    Row: {data.bankMatch.stmtRowId} | Date: {data.bankMatch.stmtDate}
                  </div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", marginTop: "6px" }}>
                    Amount: {currencySymbol}{(data.bankMatch.stmtAmount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </div>
                  {data.bankMatch.stmtNarration && (
                    <div style={{ fontSize: "11px", color: "#475569", marginTop: "6px", background: "#f8fafc", padding: "6px", borderRadius: "4px" }}>
                      Narration: {data.bankMatch.stmtNarration}
                    </div>
                  )}
                  {data.bankMatch.stmtRef && (
                    <div style={{ fontSize: "11px", color: "#0284c7", marginTop: "4px" }}>
                      Reference/Chq: <strong>{data.bankMatch.stmtRef}</strong>
                    </div>
                  )}
                </div>
              </div>

              {data.bankMatch.resolutionBasis && (
                <div style={{ padding: "10px", background: "#fefce8", borderRadius: "6px", border: "1px solid #fef08a", fontSize: "12px", color: "#854d0e" }}>
                  <strong>Human Resolution Basis:</strong> {data.bankMatch.resolutionBasis}
                </div>
              )}
            </div>
          )}

          {/* 4. CASH BOOK DRILL-DOWN */}
          {data.type === "CASH_BOOK" && data.cashAccount && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ padding: "12px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: "11px", color: "#64748b" }}>ID: {data.cashAccount.account_id}</div>
                <div style={{ fontSize: "16px", fontWeight: 700, marginTop: "2px" }}>{data.cashAccount.account_name}</div>
                {data.cashAccount.parent_account && (
                  <div style={{ fontSize: "12px", color: "#475569", marginTop: "4px" }}>
                    Parent Category: <strong>{data.cashAccount.parent_account}</strong>
                  </div>
                )}
                <div style={{
                  fontSize: "16px",
                  fontWeight: 800,
                  color: data.cashAccount.balance < 0 ? "#b91c1c" : "#15803d",
                  marginTop: "8px"
                }}>
                  Balance: {currencySymbol}{data.cashAccount.balance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </div>
              </div>

              {data.cashAccount.balance < 0 && (
                <div style={{ padding: "12px", background: "#fef2f2", borderRadius: "6px", border: "1px solid #fecaca", color: "#991b1b", fontSize: "12px" }}>
                  <strong>Physical Cash Violation:</strong> Cash in hand cannot physically be negative. A negative ledger balance indicates unrecorded cash receipts or delay in recording bank withdrawal replenishment.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 20px",
          borderTop: "1px solid #e2e8f0",
          background: "#f8fafc",
          display: "flex",
          justifyContent: "flex-end"
        }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              background: "#475569",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Close Drill-Down
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { AuditFinding } from "../../lib/audit/audit-findings-service";
import { PreAuditTabKey } from "./PreAuditNav";

interface PreAuditDomainTabProps {
  tabKey: PreAuditTabKey;
  financialYear: string;
  findings: AuditFinding[];
  tbEvidence: any;
  onNavigateFindings: () => void;
}

export function PreAuditDomainTab({
  tabKey,
  financialYear,
  findings,
  tbEvidence,
  onNavigateFindings,
}: PreAuditDomainTabProps) {
  const formatINR = (val: number | string | undefined | null) => {
    if (val === undefined || val === null) return "₹0.00";
    const num = typeof val === "string" ? parseFloat(val) : val;
    return isNaN(num) ? "₹0.00" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(num);
  };

  const domainFindings = findings.filter((f) => f.area === tabKey);

  // Configuration for each functional domain
  const getDomainConfig = () => {
    switch (tabKey) {
      case "INVENTORY":
        return {
          title: "Inventory & Stock Valuation Verification",
          subtitle: "Audit of raw materials, finished goods, negative asset credits, and composite BOM manufacturing linkages.",
          status: "PARTIAL — ANOMALIES FOUND",
          badgeColor: "#b06000",
          badgeBg: "#fef7e0",
          metrics: [
            { label: "FINISHED GOODS (CREDIT)", value: "-₹1,43,010.54", alert: true },
            { label: "INVENTORY ASSET (CREDIT)", value: "-₹1,63,314.67", alert: true },
            { label: "RAW MATERIAL STOCK", value: "Available in ERP", alert: false },
            { label: "PHYSICAL COUNT STATUS", value: "Sheets Required", alert: true },
          ],
          statutoryNotes: "Form 3CD Clause 35 requires quantitative disclosure of opening stock, purchases/consumption, manufacturing output, sales, and closing stock. Credit balances in inventory accounts invalidate trading accounts and gross profit margins.",
          evidenceRequired: [
            "Physical Stock Count sheets certified by management as on 31-03-2026",
            "Bill of Materials (BOM) assembly conversion work orders",
            "Unbilled Goods Received Notes (GRN) summary",
          ],
        };

      case "GST":
        return {
          title: "Goods & Services Tax (GST) Verification",
          subtitle: "Reconciliation of Input Tax Credit (ITC), electronic credit ledger accounts, and turnover against GST portal returns.",
          status: "BLOCKED — EVIDENCE REQUIRED",
          badgeColor: "#c5221f",
          badgeBg: "#fce8e6",
          metrics: [
            { label: "PORTAL DATA INGESTION", value: "NOT INGESTED", alert: true },
            { label: "GSTR-2B COMPARISON", value: "BLOCKED", alert: true },
            { label: "GSTR-3B DISCHARGE", value: "BLOCKED", alert: true },
            { label: "BOOKS ITC ACCOUNTS", value: "CGST/SGST/IGST Present", alert: false },
          ],
          statutoryNotes: "Section 16(2)(aa) of CGST Act mandates that ITC can only be claimed if reflected in Form GSTR-2B. Form 3CD Clause 44 requires total expenditure breakdown with entities registered under GST vs unregistered.",
          evidenceRequired: [
            "Monthly GSTR-2B JSON/Excel downloads for April 2025 – March 2026",
            "Filed GSTR-3B returns and tax payment challans (PMT-06)",
            "GSTR-1 sales turnover outward supply return acknowledgments",
          ],
        };

      case "TDS / 26AS":
        return {
          title: "Tax Deducted at Source (TDS) & Form 26AS / AIS",
          subtitle: "Verification of TDS deductions on vendor expenses (194C, 194J, 194H) and tax credits withheld by customers.",
          status: "PARTIAL — CRITICAL RED FLAGS",
          badgeColor: "#c5221f",
          badgeBg: "#fce8e6",
          metrics: [
            { label: "TDS PAYABLE (DEBIT)", value: "₹6,46,121.23 (Abnormal)", alert: true },
            { label: "INTERMEDIATE TDS (DEBIT)", value: "₹20,003.11 (Abnormal)", alert: true },
            { label: "TDS RECEIVABLE (CUSTOMER)", value: "₹6,82,972.04", alert: false },
            { label: "FORM 26AS / AIS STATUS", value: "Extract Required", alert: true },
          ],
          statutoryNotes: "Form 3CD Clause 34 requires extensive auditing of whether tax was deducted at source, whether deducted at correct rates, and paid within statutory due dates. Abnormal debit balances in liability accounts indicate unbooked expenses or misallocated advance tax.",
          evidenceRequired: [
            `Income Tax Form 26AS & Annual Information Statement (AIS) for AY ${parseInt(financialYear.substring(0,4)) + 1}-${parseInt(financialYear.split('-')[1]) + 1}`,
            "Quarterly TDS Return Acknowledgments (Form 24Q and Form 26Q)",
            "TRACES Justification reports and challan ITNS 281 receipts",
          ],
        };

      case "PAYROLL / PF / ESIC / PT":
        return {
          title: "Payroll & Statutory Employee Dues Verification",
          subtitle: "Audit of salary ledgers, Provident Fund (PF), ESIC, Professional Tax, and timely statutory deposit compliance.",
          status: "BLOCKED — EVIDENCE REQUIRED",
          badgeColor: "#c5221f",
          badgeBg: "#fce8e6",
          metrics: [
            { label: "SALARY ACCOUNTS IN TB", value: "Verified Present", alert: false },
            { label: "EPFO ECR CHALLANS", value: "NOT INGESTED", alert: true },
            { label: "ESIC CHALLANS", value: "NOT INGESTED", alert: true },
            { label: "STATUTORY DUE DATE AUDIT", value: "BLOCKED", alert: true },
          ],
          statutoryNotes: "Section 36(1)(va) disallows employee contributions to PF/ESIC if deposited after the due date specified under the relevant welfare act (even if deposited before filing ITR). Form 3CD Clause 20(b) strictly mandates date-wise audit.",
          evidenceRequired: [
            "EPFO Electronic Challan cum Return (ECR) monthly receipts with TRRN and payment dates",
            "ESIC monthly contribution challans and payment receipts",
            "Professional Tax (PT) monthly return challans",
          ],
        };

      case "SALES & RECEIVABLES":
        return {
          title: "Sales Cycle & Trade Receivables Verification",
          subtitle: "Audit of sales invoices, customer receipts, debtor aging, customer concentration, and unearned advance revenues.",
          status: "PARTIAL RECONCILIATION",
          badgeColor: "#b06000",
          badgeBg: "#fef7e0",
          metrics: [
            { label: "SALES INVOICES IN ERP", value: "Synchronized", alert: false },
            { label: "CUSTOMER CONCENTRATION", value: "Top 5 Customers > 60%", alert: false },
            { label: "UNEARNED REVENUE / ADV", value: "Review Required", alert: true },
            { label: "DEBTOR BALANCE CONFIRM", value: "Third-party Certs Pending", alert: true },
          ],
          statutoryNotes: "Trade receivables exceeding 6 months require separate categorization in Balance Sheet Schedule III. Unearned customer advances must be segregated from current income under Ind AS 115 / AS 9.",
          evidenceRequired: [
            "Balance confirmation letters from major debtors as on 31-03-2026",
            "Subsequent realization bank entries for year-end receivables",
          ],
        };

      case "PURCHASE & PAYABLES":
        return {
          title: "Purchase Cycle & Trade Payables Verification",
          subtitle: "Audit of vendor purchase bills, payments, vendor credits, debit notes, and MSME 45-day payment compliance.",
          status: "PARTIAL RECONCILIATION",
          badgeColor: "#b06000",
          badgeBg: "#fef7e0",
          metrics: [
            { label: "PURCHASE BILLS IN ERP", value: "Synchronized", alert: false },
            { label: "MSME SECTION 43B(h)", value: "Vendor Classification Pending", alert: true },
            { label: "VENDOR DEBIT NOTES", value: "Review Required", alert: true },
            { label: "CREDITOR CONFIRMATION", value: "Third-party Certs Pending", alert: true },
          ],
          statutoryNotes: "Section 43B(h) disallows deduction for sums payable to Micro and Small Enterprises if not paid within 15/45 days. Form 3CD Clause 22 requires explicit reporting of MSME interest disallowance.",
          evidenceRequired: [
            "MSME / Udyam registration certificates for all active trade suppliers",
            "Vendor balance confirmation statements as on 31-03-2026",
          ],
        };

      case "LOANS / CAPITAL / INVESTMENTS":
        return {
          title: "Loans, Capital & Investment Verification",
          subtitle: "Audit of partner/proprietor capital accounts, drawings, bank borrowings, overdrafts, and fixed deposit interest.",
          status: "PARTIAL — REVIEW REQUIRED",
          badgeColor: "#b06000",
          badgeBg: "#fef7e0",
          metrics: [
            { label: "SBI HOME LOAN / OD", value: "-₹2,57,051.75", alert: true },
            { label: "HDFC SAVING ACCOUNT", value: "₹46,04,114.61", alert: false },
            { label: "ICICI SAVING ACCOUNT", value: "₹56,95,473.44", alert: false },
            { label: "FD INTEREST CERTIFICATES", value: "Available on disk", alert: false },
          ],
          statutoryNotes: "Section 36(1)(iii) prohibits deduction of interest paid on borrowed funds utilized for non-business or personal purposes. Mixing personal home loans in business books requires explicit drawings reclassification.",
          evidenceRequired: [
            "Bank loan sanction letters, interest certificates, and balance confirmation letters",
            "Fixed Deposit interest certificates and TDS Form 16A certificates",
          ],
        };

      case "CUT-OFF & EVIDENCE":
      default:
        return {
          title: "Year-End Cut-Off & Documentary Evidence Completeness",
          subtitle: "Audit of revenue/expense cut-off across March 31 / April 1 boundary, attachment completeness, and document chains.",
          status: "PARTIAL RECONCILIATION",
          badgeColor: "#b06000",
          badgeBg: "#fef7e0",
          metrics: [
            { label: "INVOICE DISPATCH CUT-OFF", value: "March 31 Review Required", alert: true },
            { label: "GRN INWARD CUT-OFF", value: "March 31 Review Required", alert: true },
            { label: "SOURCE ATTACHMENT RATE", value: "~68% in Zoho", alert: true },
            { label: "EXTERNAL BANK RECON", value: "HDFC Verified (100%)", alert: false },
          ],
          statutoryNotes: "Transactions pertaining to FY 2025-26 billed in April 2026 (or vice versa) must be adjusted for true and fair view under GAAP. Lack of supporting documentary vouchers risks disallowance under Section 37(1).",
          evidenceRequired: [
            "Last 10 sales invoices of March 2026 and first 10 sales invoices of April 2026 with e-way bills",
            "Last 10 purchase bills of March 2026 and first 10 purchase bills of April 2026 with inward gate passes",
          ],
        };
    }
  };

  const config = getDomainConfig();

  return (
    <div style={{ padding: "24px", maxWidth: "1280px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#202124", margin: "0 0 4px 0" }}>
            {config.title} — FY {financialYear}
          </h2>
          <p style={{ color: "#5f6368", fontSize: "13px", margin: 0 }}>{config.subtitle}</p>
        </div>
        <span
          style={{
            background: config.badgeBg,
            color: config.badgeColor,
            border: `1px solid ${config.badgeColor}33`,
            padding: "4px 12px",
            borderRadius: "4px",
            fontSize: "12px",
            fontWeight: 700,
          }}
        >
          {config.status}
        </span>
      </div>

      {/* Metrics Row */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${config.metrics.length}, 1fr)`, gap: "16px", marginBottom: "20px" }}>
        {config.metrics.map((m, idx) => (
          <div
            key={idx}
            style={{
              background: "#fff",
              border: m.alert ? "1px solid #fad2cf" : "1px solid #e0e0e0",
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div style={{ fontSize: "11px", color: m.alert ? "#c5221f" : "#5f6368", fontWeight: 600 }}>{m.label}</div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: m.alert ? "#d93025" : "#202124", marginTop: "4px" }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* Domain Findings Section */}
      <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>
            Identified Findings in this Area ({domainFindings.length})
          </h3>
          {domainFindings.length > 0 && (
            <button
              onClick={onNavigateFindings}
              style={{ background: "none", border: "none", color: "#1a73e8", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}
            >
              Open in Findings Register →
            </button>
          )}
        </div>

        {domainFindings.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {domainFindings.map((f) => (
              <div
                key={f.finding_id}
                style={{
                  border: "1px solid #e0e0e0",
                  borderLeft: f.priority === "P0" ? "4px solid #d93025" : (f.priority === "P1" ? "4px solid #f9ab00" : "4px solid #1a73e8"),
                  borderRadius: "6px",
                  padding: "14px",
                  background: "#fcfdfe",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: f.priority === "P0" ? "#d93025" : "#b06000" }}>
                        [{f.priority}]
                      </span>
                      <span style={{ fontWeight: 600, color: "#202124", fontSize: "14px" }}>{f.title}</span>
                    </div>
                    <div style={{ color: "#5f6368", fontSize: "12px", marginTop: "4px" }}>{f.description}</div>
                  </div>
                  {f.amount && (
                    <span style={{ fontSize: "14px", fontWeight: 700, color: "#202124" }}>
                      {formatINR(f.amount)}
                    </span>
                  )}
                </div>
                <div style={{ marginTop: "10px", fontSize: "12px", color: "#3c4043", background: "#f8f9fa", padding: "8px 12px", borderRadius: "4px" }}>
                  <strong>Recommended Action:</strong> {f.recommended_action}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "20px", textAlign: "center", color: "#5f6368", fontSize: "13px" }}>
            No open substantive book errors detected in this section. External evidence required to complete full verification.
          </div>
        )}
      </div>

      {/* Statutory Relevance & Blocked Checklist Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "20px" }}>
        {/* Statutory Context */}
        <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: "8px", padding: "20px" }}>
          <h4 style={{ margin: "0 0 8px 0", fontSize: "14px", fontWeight: 700, color: "#202124" }}>
            ⚖️ Statutory & Tax Audit Relevance (Form 3CD Context)
          </h4>
          <p style={{ fontSize: "13px", color: "#3c4043", lineHeight: "1.6", margin: 0 }}>
            {config.statutoryNotes}
          </p>
          <div style={{ marginTop: "12px", fontSize: "11px", color: "#5f6368", fontStyle: "italic" }}>
            *Note: Legal and compliance relevance indicates areas subject to audit reporting under Income Tax Act / Companies Act. Final compliance determination remains for the Chartered Accountant.
          </div>
        </div>

        {/* Required Evidence Checklist */}
        <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: "8px", padding: "20px" }}>
          <h4 style={{ margin: "0 0 10px 0", fontSize: "14px", fontWeight: 700, color: "#c5221f" }}>
            📑 External Evidence Checklist (To Unblock)
          </h4>
          <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "12px", color: "#3c4043", lineHeight: "1.8" }}>
            {config.evidenceRequired.map((ev, i) => (
              <li key={i}>{ev}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

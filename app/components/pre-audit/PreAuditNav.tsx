"use client";

import React from "react";

export type PreAuditTabKey =
  | "OVERVIEW"
  | "BOOKS & TRIAL BALANCE"
  | "BANK VERIFICATION"
  | "CASH"
  | "SALES & RECEIVABLES"
  | "PURCHASE & PAYABLES"
  | "INVENTORY"
  | "GST"
  | "TDS / 26AS"
  | "PAYROLL / PF / ESIC / PT"
  | "LOANS / CAPITAL / INVESTMENTS"
  | "CUT-OFF & EVIDENCE"
  | "AUDIT FINDINGS"
  | "AUDIT REPORT";

interface PreAuditNavProps {
  activeTab: PreAuditTabKey;
  onTabChange: (tab: PreAuditTabKey) => void;
  findingCounts?: {
    P0: number;
    P1: number;
    P2: number;
  };
}

interface TabDef {
  key: PreAuditTabKey;
  label: string;
  badge: "READY" | "PARTIAL" | "BLOCKED" | "NOT STARTED";
  icon: string;
}

const TABS: TabDef[] = [
  { key: "OVERVIEW", label: "Overview", badge: "PARTIAL", icon: "📊" },
  { key: "BOOKS & TRIAL BALANCE", label: "Books & Trial Balance", badge: "READY", icon: "⚖️" },
  { key: "BANK VERIFICATION", label: "Bank Verification", badge: "READY", icon: "🏦" },
  { key: "CASH", label: "Cash & Cash Books", badge: "PARTIAL", icon: "💵" },
  { key: "SALES & RECEIVABLES", label: "Sales & Receivables", badge: "PARTIAL", icon: "📈" },
  { key: "PURCHASE & PAYABLES", label: "Purchase & Payables", badge: "PARTIAL", icon: "🛒" },
  { key: "INVENTORY", label: "Inventory & Stock", badge: "PARTIAL", icon: "📦" },
  { key: "GST", label: "GST Verification", badge: "BLOCKED", icon: "🏛️" },
  { key: "TDS / 26AS", label: "TDS & Form 26AS", badge: "PARTIAL", icon: "📑" },
  { key: "PAYROLL / PF / ESIC / PT", label: "Payroll & Statutory", badge: "BLOCKED", icon: "👥" },
  { key: "LOANS / CAPITAL / INVESTMENTS", label: "Loans & Capital", badge: "PARTIAL", icon: "🤝" },
  { key: "CUT-OFF & EVIDENCE", label: "Cut-Off & Evidence", badge: "PARTIAL", icon: "🔍" },
  { key: "AUDIT FINDINGS", label: "Audit Findings Register", badge: "READY", icon: "🚩" },
  { key: "AUDIT REPORT", label: "Audit Report", badge: "READY", icon: "📋" },
];

export function PreAuditNav({ activeTab, onTabChange, findingCounts }: PreAuditNavProps) {
  const getBadgeStyle = (badge: string) => {
    switch (badge) {
      case "READY":
        return { background: "#e6f4ea", color: "#137333", border: "1px solid #ceead6" };
      case "PARTIAL":
        return { background: "#fef7e0", color: "#b06000", border: "1px solid #feefc3" };
      case "BLOCKED":
        return { background: "#fce8e6", color: "#c5221f", border: "1px solid #fad2cf" };
      default:
        return { background: "#f1f3f4", color: "#5f6368", border: "1px solid #dadce0" };
    }
  };

  return (
    <div style={{ borderBottom: "1px solid #e0e0e0", background: "#ffffff", padding: "8px 16px 0 16px" }}>
      <div
        style={{
          display: "flex",
          gap: "8px",
          overflowX: "auto",
          paddingBottom: "8px",
          scrollbarWidth: "thin",
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const badgeStyle = getBadgeStyle(tab.badge);
          const showP0Badge = tab.key === "AUDIT FINDINGS" && findingCounts && findingCounts.P0 > 0;

          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 14px",
                borderRadius: "6px 6px 0 0",
                border: "none",
                borderBottom: isActive ? "3px solid #1a73e8" : "3px solid transparent",
                background: isActive ? "#f8fafd" : "transparent",
                color: isActive ? "#1a73e8" : "#3c4043",
                fontWeight: isActive ? 600 : 500,
                fontSize: "13px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.15s ease",
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              <span
                style={{
                  ...badgeStyle,
                  fontSize: "10px",
                  padding: "1px 6px",
                  borderRadius: "10px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.4px",
                }}
              >
                {tab.badge}
              </span>
              {showP0Badge && (
                <span
                  style={{
                    background: "#d93025",
                    color: "white",
                    fontSize: "10px",
                    padding: "1px 6px",
                    borderRadius: "10px",
                    fontWeight: 700,
                  }}
                  title={`${findingCounts.P0} Critical P0 Findings`}
                >
                  {findingCounts.P0} P0
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

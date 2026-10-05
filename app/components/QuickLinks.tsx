"use client";

import React, { useState } from "react";

interface QuickLinksProps {
  activeSection: string;
  onNavigate: (section: string) => void;
}

const ZOHO_BASE_URL = "https://books.bansilengineers.com/app/774390949";

interface QuickLinkItem {
  id: string;
  label: string;
  icon?: string;
  isExternal?: boolean;
  externalUrl?: string;
}

const PRIMARY_LINKS: QuickLinkItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "⬛" },
  { id: "recon_master", label: "Master Reconciliation", icon: "⚖" },
  { id: "recon_yet_to_purchase", label: "Yet to Purchase", icon: "⚠️" },
  { id: "recon_yet_to_sale", label: "Yet to Sale", icon: "📦" },
  { id: "tx_purchase_bills", label: "Purchase Bills", icon: "📥" },
  { id: "tx_sales_invoices", label: "Sales Invoices", icon: "📤" },
  { id: "tx_detail", label: "Transaction Detail", icon: "≡" },
  { id: "report_breakdown", label: "Breakdown Report", icon: "📊" },
  { id: "settings_sync", label: "Sync & Local Cache", icon: "↻" },
  { id: "settings_security", label: "Security", icon: "🔒" },
  { id: "zoho_books", label: "Zoho Books ↗", icon: "🌐", isExternal: true, externalUrl: `${ZOHO_BASE_URL}#/home/dashboard` },
];

const MORE_LINKS: QuickLinkItem[] = [
  { id: "recon_reconciled", label: "Reconciled", icon: "✓" },
  { id: "recon_purchase_only", label: "Purchase Only", icon: "＋" },
  { id: "recon_sales_only", label: "Sales Only", icon: "－" },
  { id: "recon_customer_missing", label: "Customer Details Missing", icon: "❓" },
  { id: "recon_excluded", label: "Excluded Items", icon: "🚫" },
  { id: "settings_exclusions", label: "Exclusion Rules", icon: "⚙" },
  { id: "settings_suggestions", label: "Exclusion Suggestions", icon: "💡" },
  { id: "zoho_invoices", label: "Zoho Sales Invoices ↗", icon: "↗", isExternal: true, externalUrl: `${ZOHO_BASE_URL}#/invoices` },
  { id: "zoho_bills", label: "Zoho Purchase Bills ↗", icon: "↗", isExternal: true, externalUrl: `${ZOHO_BASE_URL}#/bills` },
];

export function QuickLinks({ activeSection, onNavigate }: QuickLinksProps) {
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [showMore, setShowMore] = useState<boolean>(false);

  return (
    <div
      className="quick-links-bar"
      style={{
        background: "#ffffff",
        borderBottom: "1px solid #e2e8f0",
        padding: collapsed ? "6px 20px" : "8px 20px",
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
        fontSize: 12,
        transition: "all 0.15s ease",
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        style={{
          background: "none",
          border: "none",
          color: "#2563eb",
          fontWeight: 700,
          fontSize: 11.5,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 6px",
          borderRadius: 4,
          letterSpacing: "0.5px",
          textTransform: "uppercase",
        }}
        title={collapsed ? "Expand Quick Links" : "Collapse Quick Links"}
      >
        <span>QUICK LINKS</span>
        <span>{collapsed ? "▸" : "▾"}</span>
      </button>

      {!collapsed && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, flex: 1 }}>
          {PRIMARY_LINKS.map((link) => {
            const isActive = activeSection === link.id;
            if (link.isExternal) {
              return (
                <a
                  key={link.id}
                  href={link.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 9px",
                    borderRadius: 14,
                    background: "#f0f9ff",
                    color: "#0284c7",
                    border: "1px solid #bae6fd",
                    textDecoration: "none",
                    fontSize: 11.5,
                    fontWeight: 500,
                    transition: "all 0.15s ease",
                  }}
                  title="Opens Zoho Books in a new browser tab"
                >
                  <span>{link.icon}</span>
                  <span>{link.label}</span>
                </a>
              );
            }

            return (
              <button
                key={link.id}
                type="button"
                onClick={() => onNavigate(link.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 9px",
                  borderRadius: 14,
                  background: isActive ? "#eff6ff" : "#f8fafc",
                  color: isActive ? "#2563eb" : "#334155",
                  border: isActive ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
                  cursor: "pointer",
                  fontSize: 11.5,
                  fontWeight: isActive ? 600 : 500,
                  transition: "all 0.15s ease",
                }}
              >
                <span>{link.icon}</span>
                <span>{link.label}</span>
              </button>
            );
          })}

          {/* More dropdown / pills */}
          <button
            type="button"
            onClick={() => setShowMore(!showMore)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 9px",
              borderRadius: 14,
              background: showMore ? "#e2e8f0" : "#f1f5f9",
              color: "#475569",
              border: "1px solid #cbd5e1",
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: 600,
            }}
          >
            <span>More</span>
            <span>{showMore ? "▴" : "▾"}</span>
          </button>

          {showMore && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 6,
                padding: "2px 0",
              }}
            >
              {MORE_LINKS.map((link) => {
                const isActive = activeSection === link.id;
                if (link.isExternal) {
                  return (
                    <a
                      key={link.id}
                      href={link.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "3px 9px",
                        borderRadius: 14,
                        background: "#f0f9ff",
                        color: "#0284c7",
                        border: "1px solid #bae6fd",
                        textDecoration: "none",
                        fontSize: 11.5,
                        fontWeight: 500,
                      }}
                    >
                      <span>{link.icon}</span>
                      <span>{link.label}</span>
                    </a>
                  );
                }

                return (
                  <button
                    key={link.id}
                    type="button"
                    onClick={() => onNavigate(link.id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 9px",
                      borderRadius: 14,
                      background: isActive ? "#eff6ff" : "#f8fafc",
                      color: isActive ? "#2563eb" : "#334155",
                      border: isActive ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
                      cursor: "pointer",
                      fontSize: 11.5,
                      fontWeight: isActive ? 600 : 500,
                    }}
                  >
                    <span>{link.icon}</span>
                    <span>{link.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

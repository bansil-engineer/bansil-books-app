"use client";

import React, { useState, useEffect } from "react";

type SidebarSection =
  | "dashboard"
  | "pre_audit_verification"
  | "reconciliation"
  | "audit_workspace"
  | "inventory"
  | "transactions"
  | "services"
  | "customers"
  | "reports"
  | "settings"
  | "ai_assistant"
  | "technical_equivalence";

interface SidebarProps {
  activeSection: string;
  onNavigate: (section: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  featureSettings?: Record<string, boolean>;
}

interface NavChild {
  id: string;
  label: string;
  featureKey?: string;
}

interface NavGroup {
  id: SidebarSection;
  label: string;
  icon: string;
  featureKey?: string;
  children?: NavChild[];
}

const NAV_GROUPS: NavGroup[] = [
  { id: "dashboard", label: "Dashboard", icon: "⊞", featureKey: "module_dashboard" },
  {
    id: "pre_audit_verification",
    label: "Pre-Audit Verification",
    icon: "🛡️",
    featureKey: "module_pre_audit_verification",
    children: [
      { id: "pre_audit_overview", label: "Overview" },
      { id: "pre_audit_books_tb", label: "Books & Trial Balance" },
      { id: "pre_audit_bank", label: "Bank Verification" },
      { id: "pre_audit_cash", label: "Cash & Cash Books" },
      { id: "pre_audit_sales", label: "Sales & Receivables" },
      { id: "pre_audit_purchase", label: "Purchase & Payables" },
      { id: "pre_audit_inventory", label: "Inventory & Stock" },
      { id: "pre_audit_gst", label: "GST Verification" },
      { id: "pre_audit_tds", label: "TDS & Form 26AS" },
      { id: "pre_audit_payroll", label: "Payroll & Statutory" },
      { id: "pre_audit_loans", label: "Loans & Capital" },
      { id: "pre_audit_cutoff", label: "Cut-Off & Evidence" },
      { id: "pre_audit_findings", label: "Audit Findings Register" },
      { id: "pre_audit_report", label: "Audit Report" },
    ],
  },
  {
    id: "reconciliation",
    label: "Reconciliation",
    icon: "⚖",
    featureKey: "module_reconciliation",
    children: [
      { id: "recon_master", label: "Master Reconciliation", featureKey: "sub_recon_master" },
      { id: "recon_balance", label: "Balance", featureKey: "sub_recon_balance" },
      { id: "recon_yet_to_purchase", label: "Yet to Purchase", featureKey: "sub_recon_yet_to_purchase" },
      { id: "recon_yet_to_sale", label: "Yet to Sale", featureKey: "sub_recon_yet_to_sale" },
      { id: "recon_purchase_only", label: "Purchase Only", featureKey: "sub_recon_purchase_only" },
      { id: "recon_sales_only", label: "Sales Only", featureKey: "sub_recon_sale_only" },
      { id: "recon_reconciled", label: "Reconciled", featureKey: "sub_recon_reconciled" },
      { id: "recon_composite_assembly", label: "Composite Assembly", featureKey: "sub_recon_composite_assembly" },
      { id: "recon_customer_missing", label: "Customer Details Missing", featureKey: "sub_recon_customer_missing" },
      { id: "recon_excluded", label: "Excluded Items", featureKey: "sub_recon_excluded_items" },
    ],
  },
  {
    id: "audit_workspace",
    label: "Reconciliation & Audit",
    icon: "🔍",
    featureKey: "module_audit_workspace",
    children: [
      { id: "accounts_audit", label: "Accounts Audit", featureKey: "accounts_audit" },
      { id: "approval_pending", label: "Approval Pending", featureKey: "accounts_audit" },
      { id: "bank_reconciliation", label: "Bank", featureKey: "accounts_audit" },
      { id: "gst_verification", label: "GST Verification" },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: "🗄",
    featureKey: "module_inventory",
    children: [
      { id: "inventory_stock", label: "Stock", featureKey: "sub_inv_stock" },
    ],
  },
  {
    id: "transactions",
    label: "Transactions",
    icon: "≡",
    featureKey: "module_transactions",
    children: [
      { id: "tx_purchase_bills", label: "Purchase Bills", featureKey: "sub_trans_purchase_bills" },
      { id: "tx_sales_invoices", label: "Sales Invoices", featureKey: "sub_trans_sales_invoices" },
      { id: "tx_detail", label: "Transaction Detail", featureKey: "sub_trans_transaction_detail" },
      { id: "tx_zoho_activity", label: "Zoho Activity", featureKey: "sub_trans_zoho_activity" },
    ],
  },
  {
    id: "services",
    label: "Services",
    icon: "⚡",
    featureKey: "module_services",
    children: [
      { id: "services_summary", label: "Service Summary", featureKey: "sub_svc_summary" },
      { id: "services_purchases", label: "Service Purchases", featureKey: "sub_svc_purchases" },
      { id: "services_sales", label: "Service Sales", featureKey: "sub_svc_sales" },
      { id: "services_transactions", label: "Service Transactions", featureKey: "sub_svc_transactions" },
      { id: "services_reconciliation", label: "Service Reconciliation", featureKey: "sub_svc_reconciliation" },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    icon: "👥",
    featureKey: "module_customers",
    children: [
      { id: "customer_details", label: "Customer Details", featureKey: "sub_cust_customer_details" },
      { id: "customer_action_taken", label: "Action Taken", featureKey: "sub_cust_action_taken" },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: "📊",
    featureKey: "module_reports",
    children: [
      { id: "report_summary", label: "Reconciliation Summary", featureKey: "sub_rep_recon_summary" },
      { id: "report_customer_wise", label: "Customer-wise Item Reconciliation", featureKey: "sub_rep_customer_wise" },
      { id: "report_breakdown", label: "Breakdown Report", featureKey: "sub_rep_breakdown" },
      { id: "report_price_reference", label: "Price Reference", featureKey: "sub_rep_price_reference" },
      { id: "report_data_quality", label: "Data Quality", featureKey: "sub_rep_data_quality" },
      { id: "report_validation", label: "Validation Report", featureKey: "sub_rep_validation" },
      { id: "report_customer_material", label: "Customer Material Control", featureKey: "sub_rep_customer_material" },
    ],
  },
  {
    id: "estimation" as SidebarSection,
    label: "Estimation",
    icon: "📐",
    featureKey: "module_estimation",
    children: [
      { id: "tender_hub", label: "Tender Hub", featureKey: "sub_est_tender_hub" },
      { id: "technical_equivalence", label: "Technical Equivalence", featureKey: "sub_est_technical_equivalence" },
    ],
  },
  {
    id: "ai_assistant",
    label: "AI Assistant",
    icon: "✨",
    children: [
      { id: "ai_chat", label: "New Chat" },
      { id: "ai_history", label: "History" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: "⚙",
    children: [
      { id: "settings_connections", label: "Connections & Permissions" },
      { id: "settings_sync", label: "Sync & Local Cache" },
      { id: "settings_modules", label: "Modules & Features" },
      { id: "settings_skills", label: "Skills", featureKey: "sub_settings_skills" },
      { id: "settings_exclusions", label: "Exclusion Rules", featureKey: "module_exclusion_management" },
      { id: "settings_suggestions", label: "Exclusion Suggestions", featureKey: "module_ai_insights" },
      { id: "settings_security", label: "Security" },
    ],
  },
];

export function Sidebar({
  activeSection,
  onNavigate,
  collapsed = false,
  onToggleCollapse,
  featureSettings = {},
}: SidebarProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    pre_audit_verification: true,
    reconciliation: false,
    audit_workspace: false,
    inventory: false,
    transactions: false,
    services: false,
    customers: false,
    reports: false,
    estimation: false,
    settings: false,
  });

  const isFeatureEnabled = (key?: string) => {
    if (!key) return true;
    if (key === "module_ai_insights") return featureSettings[key] === true;
    return featureSettings[key] !== false;
  };

  const visibleGroups = NAV_GROUPS.filter((g) => isFeatureEnabled(g.featureKey)).map((g) => ({
    ...g,
    children: g.children ? g.children.filter((c) => isFeatureEnabled(c.featureKey)) : undefined,
  }));

  useEffect(() => {
    const parent = NAV_GROUPS.find((g) => g.children?.some((c) => c.id === activeSection));
    if (parent) {
      setExpanded((prev) => ({ ...prev, [parent.id]: true }));
    }
  }, [activeSection]);

  const toggleGroup = (id: string) => {
    if (id === "dashboard") {
      onNavigate("dashboard");
      return;
    }

    if (id === "ai_assistant") {
      window.open("/ai-ceo", "_blank", "noopener,noreferrer");
      return;
    }
    
    const group = NAV_GROUPS.find((g) => g.id === id);
    
    if (collapsed) {
      if (group?.children && group.children.length > 0) {
        const firstChild = group.children.find((child) => isFeatureEnabled(child.featureKey));
        if (firstChild?.id === "settings_connections") {
          window.location.assign("/connections");
        } else if (firstChild?.id === "tender_hub") {
          window.location.assign("/tender-hub");
        } else if (firstChild) {
          onNavigate(firstChild.id);
        }
      } else {
        onNavigate(id);
      }
      return;
    }
    
    // If the group has no children, clicking it should navigate directly.
    if (!group?.children || group.children.length === 0) {
      onNavigate(id);
      return;
    }
    
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const isChildActive = (group: NavGroup) =>
    group.children?.some((c) => c.id === activeSection);

  return (
    <nav
      className={`sidebar ${collapsed ? "collapsed" : ""}`}
      aria-label="Main navigation"
    >
      {/* Brand mark inside sidebar */}
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">B</div>
        <div className="sidebar-brand-text">
          <div className="sidebar-brand-name">Bansil Engineers</div>
          <div className="sidebar-brand-sub">Analytics & Reconciliation</div>
        </div>
        {onToggleCollapse && (
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? "»" : "«"}
          </button>
        )}
      </div>

      <div className="sidebar-nav">
        {visibleGroups.map((group) => {
          const isOpen = expanded[group.id];
          const isActive =
            activeSection === group.id || isChildActive(group);

          return (
            <div key={group.id} className="sidebar-group">
              <button
                type="button"
                className={`sidebar-group-header ${isActive ? "active" : ""}`}
                onClick={() => toggleGroup(group.id)}
                aria-expanded={isOpen}
                title={collapsed ? group.label : undefined}
              >
                <span className="sidebar-icon">{group.icon}</span>
                <span className="sidebar-group-label">{group.label}</span>
                {group.children && group.children.length > 0 && !collapsed && (
                  <span className="sidebar-chevron">
                    {isOpen ? "v" : ">"}
                  </span>
                )}
              </button>

              {group.children && group.children.length > 0 && isOpen && !collapsed && (
                <div className="sidebar-children">
                  {group.children.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      className={`sidebar-child-item ${activeSection === child.id ? "active" : ""}`}
                      onClick={() => {
                        if (child.id === "settings_connections") {
                          window.location.assign("/connections");
                        } else if (child.id === "tender_hub") {
                          window.location.assign("/tender-hub");
                        } else if (group.id === "ai_assistant") {
                          window.open("/ai-ceo", "_blank", "noopener,noreferrer");
                        } else {
                          onNavigate(child.id);
                        }
                      }}
                    >
                      {child.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

      </div>

      <div className="sidebar-footer">
        <span className="sidebar-footer-text">
          ⚡ 100% Local · Zero Zoho writes
        </span>
      </div>
    </nav>
  );
}

"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import type {
  ConnectionStatus,
  TodaysDataResponse,
  ZohoOrganization,
  ZohoInvoice,
  ZohoBill,
} from "@/app/types/zoho";
import {
  ZOHO_CONNECT_ENDPOINT,
  ZOHO_DISCONNECT_ENDPOINT,
} from "@/app/types/zoho";
import {
  getTodayIST,
  formatDisplayDate,
  formatINR,
  shiftDate,
  isValidISODate,
  formatDisplayDateTime,
} from "@/app/lib/date-utils";
import { ReconciliationView } from "@/app/components/reconciliation-view";
import { ExclusionsView } from "@/app/components/exclusions-view";
import { ExclusionSuggestionsView } from "@/app/components/exclusion-suggestions-view";
import { Dashboard } from "@/app/components/Dashboard";
import { TransactionsView } from "@/app/components/TransactionsView";
import { BreakdownReportView } from "@/app/components/BreakdownReportView";
import { PriceReferenceView } from "@/app/components/PriceReferenceView";
import { CustomerDetailsView } from "@/app/components/CustomerDetailsView";
import { CustomerMaterialControlView } from "@/app/components/CustomerMaterialControlView";
import { ActionTakenView } from "@/app/components/ActionTakenView";
import { CompositeAssemblyView } from "@/app/components/CompositeAssemblyView";
import { ServicesView } from "@/app/components/ServicesView";
import { Sidebar, sectionModule } from "@/app/components/Sidebar";
import { useAuth } from "@/app/components/AuthProvider";
import { TopHeader } from "@/app/components/TopHeader";
import { ZohoActivityView } from "@/app/components/ZohoActivityView";
import { SettingsModulesView } from "@/app/components/SettingsModulesView";

import { SettingsSkillsView } from "@/app/components/SettingsSkillsView";
import { UserManagementView } from "@/app/components/UserManagementView";
import ConnectionControls from "@/app/components/ConnectionControls";
import { OwnerAuthGate } from "@/app/components/OwnerAuthGate";
import { InventoryStockView } from "@/app/components/InventoryStockView";
import { AccountsAuditView } from "@/app/components/AccountsAuditView";
import CommercialTraceView from "@/app/components/CommercialTraceView";
import ApprovalPendingView from "@/app/components/ApprovalPendingView";
import PreAuditVerificationView from "@/app/components/PreAuditVerificationView";
import { GstVerificationView } from "@/app/components/audit/GstVerificationView";
import BankReconciliationWorkspace from "@/app/components/BankReconciliationWorkspace";
import { AiAssistantView } from "@/app/components/AiAssistantView";
import { TechnicalEquivalenceReviewView } from "@/app/components/TechnicalEquivalenceReviewView";
import { getCurrentFinancialYear } from "@/app/lib/date-period-utils";
import type {
  MasterInventoryMismatchReportResult,
  ReconciliationReportResult,
} from "@/app/types/reconciliation";

// Known Zoho Books organization base URL
const ZOHO_BASE_URL = "https://books.bansilengineers.com/app/774390949";
const ZOHO_INVOICES_URL = `${ZOHO_BASE_URL}#/invoices`;
const ZOHO_BILLS_URL = `${ZOHO_BASE_URL}#/bills`;

// ============================================================
// Helper: Status chip
// ============================================================
function StatusChip({ status }: { status: string }) {
  const normalized = (status || "").toLowerCase().trim();
  let cls = "status-chip draft";
  if (normalized === "paid") cls = "status-chip paid";
  else if (normalized === "sent" || normalized === "accepted") cls = "status-chip sent";
  else if (normalized === "draft") cls = "status-chip draft";
  else if (normalized === "overdue") cls = "status-chip overdue";
  else if (normalized === "unpaid" || normalized === "partially paid" || normalized === "open" || normalized === "pending")
    cls = "status-chip unpaid";
  else if (normalized === "void" || normalized === "cancelled") cls = "status-chip void";

  return (
    <span className={cls}>
      {status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : "Unknown"}
    </span>
  );
}

// ============================================================
// Helper: Format timestamp for display
// ============================================================
function formatTimeIST(isoString?: string): string {
  if (!isoString) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

// ============================================================
// Component: Skeleton Rows
// ============================================================
function TableSkeletonRows({ count = 3, cols = 8 }: { count?: number; cols?: number }) {
  return (
    <tbody>
      {Array.from({ length: count }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c}>
              <div
                className="skeleton-bar"
                style={{ width: `${40 + ((r * 17 + c * 23) % 45)}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

// ============================================================
// Component: Invoices Table Section
// ============================================================
interface InvoicesSectionProps {
  invoices: ZohoInvoice[];
  loading: boolean;
  error?: string;
  currencySymbol: string;
  onRefresh: () => void;
}

type InvoiceSortKey = "date" | "invoice_number" | "customer_name" | "reference_number" | "status" | "total" | "balance";

function InvoicesSection({
  invoices,
  loading,
  error,
  currencySymbol,
}: InvoicesSectionProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<InvoiceSortKey>("date");
  const [sortAsc, setSortAsc] = useState(false);

  // Filter in-memory
  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return invoices;
    return invoices.filter(
      (inv) =>
        (inv.invoice_number || "").toLowerCase().includes(term) ||
        (inv.customer_name || "").toLowerCase().includes(term) ||
        (inv.reference_number || "").toLowerCase().includes(term)
    );
  }, [invoices, searchTerm]);

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let valA: string | number = a[sortKey] ?? "";
      let valB: string | number = b[sortKey] ?? "";
      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortAsc]);

  const toggleSort = (key: InvoiceSortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const getSortIndicator = (key: InvoiceSortKey) => {
    if (sortKey !== key) return " ↕";
    return sortAsc ? " ↑" : " ↓";
  };

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    // Avoid toggling if clicked directly on an <a> link
    const target = e.target as HTMLElement;
    if (target.closest("a")) return;
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="section-card">
      <div className="section-header">
        <div className="section-title-group">
          <h2 className="section-title">Sales Invoices</h2>
          <span className="section-badge">
            {invoices.length} {invoices.length === 1 ? "invoice" : "invoices"}
          </span>
        </div>

        <div className="search-wrapper">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="search-input"
            placeholder="Search invoice / customer / reference"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ margin: "16px 20px" }}>
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <div className="table-responsive">
        <table className="data-table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort("date")}>
                Date{getSortIndicator("date")}
              </th>
              <th className="sortable" onClick={() => toggleSort("invoice_number")}>
                Invoice No.{getSortIndicator("invoice_number")}
              </th>
              <th className="sortable" onClick={() => toggleSort("customer_name")}>
                Customer{getSortIndicator("customer_name")}
              </th>
              <th className="sortable" onClick={() => toggleSort("reference_number")}>
                Reference{getSortIndicator("reference_number")}
              </th>
              <th className="sortable" onClick={() => toggleSort("status")}>
                Status{getSortIndicator("status")}
              </th>
              <th className="right sortable" onClick={() => toggleSort("total")}>
                Total ({currencySymbol}){getSortIndicator("total")}
              </th>
              <th className="right sortable" onClick={() => toggleSort("balance")}>
                Balance ({currencySymbol}){getSortIndicator("balance")}
              </th>
              <th style={{ width: 60, textAlign: "center" }}>Zoho</th>
            </tr>
          </thead>

          {loading ? (
            <TableSkeletonRows count={3} cols={8} />
          ) : sorted.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={8}>
                  <div className="empty-box">
                    <div className="empty-icon">📄</div>
                    <div className="empty-text">No Sales Invoices found</div>
                    <div className="empty-sub">
                      {searchTerm
                        ? `No results match "${searchTerm}"`
                        : "No sales invoices billed on this transaction date"}
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {sorted.map((inv) => {
                const isExpanded = expandedId === inv.invoice_id;
                const invoiceHref =
                  inv.invoice_url ||
                  `${ZOHO_BASE_URL}#/invoices/${inv.invoice_id}`;

                return (
                  <React.Fragment key={inv.invoice_id}>
                    <tr
                      onClick={(e) => toggleExpand(inv.invoice_id, e)}
                      className={isExpanded ? "expanded-row-parent" : ""}
                      title="Click row to view local details"
                    >
                      <td>{formatDisplayDate(inv.date)}</td>
                      <td>
                        <a
                          href={invoiceHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="zoho-link"
                          onClick={(e) => e.stopPropagation()}
                          title="Open invoice in Zoho Books (new tab)"
                        >
                          {inv.invoice_number || "—"} ↗
                        </a>
                      </td>
                      <td>
                        {/* Customer link: unverified path, kept safe and non-clickable */}
                        <span>{inv.customer_name || "—"}</span>
                      </td>
                      <td>{inv.reference_number || "—"}</td>
                      <td>
                        <StatusChip status={inv.status} />
                      </td>
                      <td className="right amount">{formatINR(inv.total)}</td>
                      <td className="right balance">{formatINR(inv.balance)}</td>
                      <td style={{ textAlign: "center" }}>
                        <a
                          href={invoiceHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="zoho-action-icon"
                          onClick={(e) => e.stopPropagation()}
                          title="Open invoice in Zoho Books (new tab)"
                        >
                          ↗
                        </a>
                      </td>
                    </tr>

                    {/* Local expandable detail panel */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <div className="detail-panel">
                            <div className="detail-grid">
                              <div className="detail-item">
                                <span className="detail-label">Invoice ID</span>
                                <span className="detail-val">{inv.invoice_id}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Date</span>
                                <span className="detail-val">{formatDisplayDate(inv.date)}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Customer</span>
                                <span className="detail-val">{inv.customer_name || "—"}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Reference</span>
                                <span className="detail-val">{inv.reference_number || "—"}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Status</span>
                                <span className="detail-val">
                                  <StatusChip status={inv.status} />
                                </span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Currency</span>
                                <span className="detail-val">{inv.currency_code || "INR"}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Total</span>
                                <span className="detail-val">
                                  {currencySymbol} {formatINR(inv.total)}
                                </span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Balance</span>
                                <span className="detail-val">
                                  {currencySymbol} {formatINR(inv.balance)}
                                </span>
                              </div>
                              {inv.due_date && (
                                <div className="detail-item">
                                  <span className="detail-label">Due Date</span>
                                  <span className="detail-val">{formatDisplayDate(inv.due_date)}</span>
                                </div>
                              )}
                              {inv.created_time && (
                                <div className="detail-item">
                                  <span className="detail-label">Created Time</span>
                                  <span className="detail-val">{inv.created_time}</span>
                                </div>
                              )}
                            </div>
                            <div className="detail-readonly-note">
                              🔒 Local Read-Only View · Phase 0 Validation
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          )}
        </table>
      </div>

      {!loading && sorted.length > 0 && (
        <div className="table-footer">
          <div className="footer-stat">
            <span className="footer-label">Shown:</span>
            <span className="footer-val">{sorted.length}</span>
          </div>
          <div className="footer-stat">
            <span className="footer-label">Total Amount:</span>
            <span className="footer-val">
              {currencySymbol}{" "}
              {formatINR(sorted.reduce((acc, inv) => acc + (inv.total || 0), 0))}
            </span>
          </div>
          <div className="footer-stat">
            <span className="footer-label">Total Balance:</span>
            <span className="footer-val">
              {currencySymbol}{" "}
              {formatINR(sorted.reduce((acc, inv) => acc + (inv.balance || 0), 0))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Component: Purchase Bills Section
// ============================================================
interface BillsSectionProps {
  bills: ZohoBill[];
  loading: boolean;
  error?: string;
  currencySymbol: string;
  onRefresh: () => void;
}

type BillSortKey = "date" | "bill_number" | "vendor_name" | "reference_number" | "status" | "total" | "balance";

function BillsSection({
  bills,
  loading,
  error,
  currencySymbol,
}: BillsSectionProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<BillSortKey>("date");
  const [sortAsc, setSortAsc] = useState(false);

  // Filter in-memory
  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return bills;
    return bills.filter(
      (bill) =>
        (bill.bill_number || "").toLowerCase().includes(term) ||
        (bill.vendor_name || "").toLowerCase().includes(term) ||
        (bill.reference_number || "").toLowerCase().includes(term)
    );
  }, [bills, searchTerm]);

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let valA: string | number = a[sortKey] ?? "";
      let valB: string | number = b[sortKey] ?? "";
      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortAsc]);

  const toggleSort = (key: BillSortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const getSortIndicator = (key: BillSortKey) => {
    if (sortKey !== key) return " ↕";
    return sortAsc ? " ↑" : " ↓";
  };

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("a")) return;
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="section-card">
      <div className="section-header">
        <div className="section-title-group">
          <h2 className="section-title">Purchase Bills</h2>
          <span className="section-badge">
            {bills.length} {bills.length === 1 ? "bill" : "bills"}
          </span>
          <a
            href={ZOHO_BILLS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm"
            title="Open Bills list page in Zoho Books (new tab)"
          >
            Open Bills in Zoho ↗
          </a>
        </div>

        <div className="search-wrapper">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="search-input"
            placeholder="Search bill / vendor / reference"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ margin: "16px 20px" }}>
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <div className="table-responsive">
        <table className="data-table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort("date")}>
                Date{getSortIndicator("date")}
              </th>
              <th className="sortable" onClick={() => toggleSort("bill_number")}>
                Bill No.{getSortIndicator("bill_number")}
              </th>
              <th className="sortable" onClick={() => toggleSort("vendor_name")}>
                Vendor{getSortIndicator("vendor_name")}
              </th>
              <th className="sortable" onClick={() => toggleSort("reference_number")}>
                Reference{getSortIndicator("reference_number")}
              </th>
              <th className="sortable" onClick={() => toggleSort("status")}>
                Status{getSortIndicator("status")}
              </th>
              <th className="right sortable" onClick={() => toggleSort("total")}>
                Total ({currencySymbol}){getSortIndicator("total")}
              </th>
              <th className="right sortable" onClick={() => toggleSort("balance")}>
                Balance ({currencySymbol}){getSortIndicator("balance")}
              </th>
              <th style={{ width: 60, textAlign: "center" }}>Zoho</th>
            </tr>
          </thead>

          {loading ? (
            <TableSkeletonRows count={3} cols={8} />
          ) : sorted.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={8}>
                  <div className="empty-box">
                    <div className="empty-icon">🧾</div>
                    <div className="empty-text">No Purchase Bills found</div>
                    <div className="empty-sub">
                      {searchTerm
                        ? `No results match "${searchTerm}"`
                        : "No purchase bills dated on this transaction date"}
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {sorted.map((bill) => {
                const isExpanded = expandedId === bill.bill_id;
                const hasVerifiedLink = Boolean(bill.is_verified_link && bill.bill_url);

                return (
                  <React.Fragment key={bill.bill_id}>
                    <tr
                      onClick={(e) => toggleExpand(bill.bill_id, e)}
                      className={isExpanded ? "expanded-row-parent" : ""}
                      title="Click row to view local details"
                    >
                      <td>{formatDisplayDate(bill.date)}</td>
                      <td>
                        {hasVerifiedLink ? (
                          <a
                            href={bill.bill_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="zoho-link"
                            onClick={(e) => e.stopPropagation()}
                            title="Open bill in Zoho Books (new tab)"
                          >
                            {bill.bill_number || "—"} ↗
                          </a>
                        ) : (
                          <span>
                            {bill.bill_number || "—"}
                            <span className="unverified-badge" title="Deep link not yet verified by Zoho API">
                              Not yet verified
                            </span>
                          </span>
                        )}
                      </td>
                      <td>
                        {/* Vendor link: unverified path, kept safe and non-clickable */}
                        <span>{bill.vendor_name || "—"}</span>
                      </td>
                      <td>{bill.reference_number || "—"}</td>
                      <td>
                        <StatusChip status={bill.status} />
                      </td>
                      <td className="right amount">{formatINR(bill.total)}</td>
                      <td className="right balance">{formatINR(bill.balance)}</td>
                      <td style={{ textAlign: "center" }}>
                        {hasVerifiedLink ? (
                          <a
                            href={bill.bill_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="zoho-action-icon"
                            onClick={(e) => e.stopPropagation()}
                            title="Open bill in Zoho Books (new tab)"
                          >
                            ↗
                          </a>
                        ) : (
                          <a
                            href={ZOHO_BILLS_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="zoho-action-icon"
                            onClick={(e) => e.stopPropagation()}
                            title="Open Bills list in Zoho Books (new tab)"
                          >
                            ↗
                          </a>
                        )}
                      </td>
                    </tr>

                    {/* Local expandable detail panel */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <div className="detail-panel">
                            <div className="detail-grid">
                              <div className="detail-item">
                                <span className="detail-label">Bill ID</span>
                                <span className="detail-val">{bill.bill_id}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Date</span>
                                <span className="detail-val">{formatDisplayDate(bill.date)}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Vendor</span>
                                <span className="detail-val">{bill.vendor_name || "—"}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Reference</span>
                                <span className="detail-val">{bill.reference_number || "—"}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Status</span>
                                <span className="detail-val">
                                  <StatusChip status={bill.status} />
                                </span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Currency</span>
                                <span className="detail-val">{bill.currency_code || "INR"}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Total</span>
                                <span className="detail-val">
                                  {currencySymbol} {formatINR(bill.total)}
                                </span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Balance</span>
                                <span className="detail-val">
                                  {currencySymbol} {formatINR(bill.balance)}
                                </span>
                              </div>
                              {bill.due_date && (
                                <div className="detail-item">
                                  <span className="detail-label">Due Date</span>
                                  <span className="detail-val">{formatDisplayDate(bill.due_date)}</span>
                                </div>
                              )}
                              {bill.created_time && (
                                <div className="detail-item">
                                  <span className="detail-label">Created Time</span>
                                  <span className="detail-val">{bill.created_time}</span>
                                </div>
                              )}
                            </div>
                            <div className="detail-readonly-note">
                              🔒 Local Read-Only View · Zoho Books Read-Only
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          )}
        </table>
      </div>

      {!loading && sorted.length > 0 && (
        <div className="table-footer">
          <div className="footer-stat">
            <span className="footer-label">Shown:</span>
            <span className="footer-val">{sorted.length}</span>
          </div>
          <div className="footer-stat">
            <span className="footer-label">Total Amount:</span>
            <span className="footer-val">
              {currencySymbol}{" "}
              {formatINR(sorted.reduce((acc, bill) => acc + (bill.total || 0), 0))}
            </span>
          </div>
          <div className="footer-stat">
            <span className="footer-label">Total Balance:</span>
            <span className="footer-val">
              {currencySymbol}{" "}
              {formatINR(sorted.reduce((acc, bill) => acc + (bill.balance || 0), 0))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main Application Component
// ============================================================
export default function HomePage() {
  // Connection state
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // Date filter state (default: today in IST)
  const [selectedDate, setSelectedDate] = useState<string>(getTodayIST());

  // Data state
  const [data, setData] = useState<TodaysDataResponse | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Org picker state (fallback if org not selected)
  const [organizations, setOrganizations] = useState<ZohoOrganization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [orgLoading, setOrgLoading] = useState(false);

  // Actions state
  const [connectLoading, setConnectLoading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [validationPassed, setValidationPassed] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [modalTab, setModalTab] = useState<"security" | "sync">("security");
  const [sidebarSection, setSidebarSection] = useState<string>("dashboard");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const s = params.get("section") || params.get("tab");
      if (s) {
        setSidebarSection(s);
      }
    }
  }, []);

  // OA P0: employees only see sections their grants cover (Owner sees all).
  // UI convenience only — every data route is enforced server-side.
  const { user: authUser, loading: authLoading, hasModule, isOwner } = useAuth();
  useEffect(() => {
    if (authLoading || !authUser || isOwner) return;
    const mod = sectionModule(sidebarSection);
    if (sidebarSection !== "dashboard" && !(typeof mod === "string" && hasModule(mod))) {
      setSidebarSection("dashboard");
    }
  }, [authLoading, authUser, isOwner, hasModule, sidebarSection]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [activeFy, setActiveFy] = useState<string>(() => getCurrentFinancialYear());
  const [dashboardMismatchReport, setDashboardMismatchReport] = useState<MasterInventoryMismatchReportResult | null>(null);
  const [dashboardReport, setDashboardReport] = useState<ReconciliationReportResult | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState<boolean>(false);
  const [rowToOpen, setRowToOpen] = useState<{ customerId: string; itemId: string } | null>(null);
  const [backfillFy, setBackfillFy] = useState<string>("FY 2025-26");
  const [backfillRunning, setBackfillRunning] = useState<boolean>(false);
  const [backfillMessage, setBackfillMessage] = useState<string>("");
  const [backfillResult, setBackfillResult] = useState<Record<string, unknown> | null>(null);
  const [selectedCustomerForDetails, setSelectedCustomerForDetails] = useState<{
    customerId: string;
    customerName: string;
    initialTab?: string;
  } | null>(null);
  const [selectedCustomerForAssembly, setSelectedCustomerForAssembly] = useState<{
    customerId: string;
    customerName: string;
  } | null>(null);
  const [selectedCustomerForMaterialReport, setSelectedCustomerForMaterialReport] = useState<{
    customerId: string;
    customerName?: string;
  } | null>(null);

  // Sync state lifted for TopHeader & entire app
  const [syncStatusText, setSyncStatusText] = useState<string>("Up to Date");
  const [lastSyncTime, setLastSyncTime] = useState<string>("");
  const [syncing, setSyncing] = useState<boolean>(false);

  const fetchSyncState = useCallback(async () => {
    try {
      const res = await fetch("/api/sync");
      if (res.ok) {
        const json = await res.json();
        if (json.lastSyncAt) {
          setLastSyncTime(json.lastSyncAt);
        } else if (json.lastSuccessfulSyncTime) {
          setLastSyncTime(formatDisplayDateTime(json.lastSuccessfulSyncTime));
        }
        if (json.syncStatus) {
          setSyncStatusText(json.syncStatus);
        }
      }
    } catch {
      // offline fallback
    }
  }, []);

  useEffect(() => {
    fetchSyncState();
  }, [fetchSyncState]);

  const loadDashboardData = useCallback(async () => {
    try {
      setDashboardLoading(true);
      const [resMismatch, resRecon] = await Promise.all([
        fetch(`/api/inventory-mismatch?financialYear=${encodeURIComponent(activeFy)}`),
        fetch(`/api/reconciliation?financialYear=${encodeURIComponent(activeFy)}`),
      ]);
      if (resMismatch.ok) {
        const json = await resMismatch.json();
        if (json.report) setDashboardMismatchReport(json.report);
      }
      if (resRecon.ok) {
        const json = await resRecon.json();
        setDashboardReport(json);
      }
    } catch {
      // offline fallback
    } finally {
      setDashboardLoading(false);
    }
  }, [activeFy]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const handleTopHeaderSync = async () => {
    try {
      setSyncing(true);
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "INCREMENTAL" }),
      });
      const data = await res.json();
      if (data.lastSyncAt) {
        setLastSyncTime(data.lastSyncAt);
      } else if (data.lastSuccessfulSyncTime) {
        setLastSyncTime(formatDisplayDateTime(data.lastSuccessfulSyncTime));
      }
      setSyncStatusText(
        data.status === "OFFLINE"
          ? "Offline"
          : data.status === "FAILED"
          ? "Failed"
          : data.status === "PARTIAL"
          ? "Partial"
          : "Up to Date"
      );
      await Promise.all([loadDashboardData(), fetchStatus(), fetchSyncState()]);
    } catch {
      setSyncStatusText("Error");
    } finally {
      setSyncing(false);
    }
  };

  const handleSidebarNav = (section: string) => {
    setSidebarSection(section);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("section", section);
      window.history.replaceState({}, "", url.toString());
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const s = params.get("section") || params.get("tab");
      if (s) {
        setSidebarSection(s);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Feature Settings state
  const [featureSettings, setFeatureSettings] = useState<Record<string, boolean>>({});

  const loadFeatureSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const json = await res.json();
        if (json.settings) setFeatureSettings(json.settings);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadFeatureSettings();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadFeatureSettings]);

  // Safe routing: If active section is disabled in featureSettings, navigate to dashboard
  useEffect(() => {
    if (Object.keys(featureSettings).length === 0) return;

    const isFeatureEnabled = (key?: string) => {
      if (!key) return true;
      if (key === "module_ai_insights") return featureSettings[key] === true;
      return featureSettings[key] !== false;
    };

    let allowed = true;
    if (sidebarSection === "dashboard") allowed = isFeatureEnabled("module_dashboard");
    else if (sidebarSection === "pre_audit_verification" || sidebarSection.startsWith("pre_audit_")) allowed = isFeatureEnabled("module_pre_audit_verification");
    else if (sidebarSection.startsWith("recon_")) allowed = isFeatureEnabled("module_reconciliation");
    else if (sidebarSection.startsWith("tx_")) {
      if (sidebarSection === "tx_zoho_activity") {
        allowed = isFeatureEnabled("module_zoho_activity") && isFeatureEnabled("sub_trans_zoho_activity");
      } else {
        allowed = isFeatureEnabled("module_transactions");
      }
    } else if (sidebarSection.startsWith("services_")) allowed = isFeatureEnabled("module_services");
    else if (sidebarSection.startsWith("report_")) allowed = isFeatureEnabled("module_reports");
    else if (sidebarSection === "settings_exclusions") allowed = isFeatureEnabled("module_exclusion_management");

    else if (sidebarSection === "settings_suggestions") allowed = isFeatureEnabled("module_ai_insights");
    else if (sidebarSection === "audit_workspaces") allowed = isFeatureEnabled("module_audit_workspace") && isFeatureEnabled("sub_audit_workspaces");
    else if (sidebarSection === "audit_uploads") allowed = isFeatureEnabled("module_audit_workspace") && isFeatureEnabled("sub_audit_uploads");
    else if (sidebarSection === "audit_match_review") allowed = isFeatureEnabled("module_audit_workspace") && isFeatureEnabled("sub_audit_match_review");
    else if (sidebarSection === "audit_findings") allowed = isFeatureEnabled("module_audit_workspace") && isFeatureEnabled("sub_audit_findings");
    else if (sidebarSection === "audit_reports") allowed = isFeatureEnabled("module_audit_workspace") && isFeatureEnabled("sub_audit_reports");
    else if (sidebarSection === "audit_learning") allowed = isFeatureEnabled("module_audit_workspace") && isFeatureEnabled("sub_audit_learning");
    else if (sidebarSection === "settings_skills") allowed = isFeatureEnabled("module_audit_workspace") && isFeatureEnabled("sub_settings_skills");

    if (!allowed && sidebarSection !== "dashboard") {
      const timer = setTimeout(() => {
        setSidebarSection("dashboard");
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [featureSettings, sidebarSection]);

  // Fetch connection status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/zoho/status");
      const json = (await res.json()) as ConnectionStatus;
      setStatus(json);
      if (json.lastSyncAt) {
        setLastSyncTime(json.lastSyncAt);
      }
      return json;
    } catch {
      setGeneralError("Failed to check connection status");
      return null;
    } finally {
      setStatusLoading(false);
    }
  }, []);

  // Fetch organizations
  const fetchOrganizations = useCallback(async () => {
    setOrgLoading(true);
    try {
      const res = await fetch("/api/zoho/organizations");
      const json = await res.json();
      if (json.error) {
        setGeneralError(json.error as string);
        return;
      }
      const orgs = (json.organizations as ZohoOrganization[]) || [];
      setOrganizations(orgs);
      const suggested = json.suggestedOrgId as string | undefined;
      if (suggested) {
        setSelectedOrgId(suggested);
      } else if (orgs.length === 1) {
        setSelectedOrgId(orgs[0].organization_id);
      }
    } catch {
      setGeneralError("Failed to load organizations");
    } finally {
      setOrgLoading(false);
    }
  }, []);

  // Confirm org selection
  const confirmOrgSelection = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      const res = await fetch("/api/zoho/select-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: selectedOrgId }),
      });
      const json = await res.json();
      if (json.error) {
        setGeneralError(json.error as string);
        return;
      }
      await fetchStatus();
    } catch {
      setGeneralError("Failed to confirm organization");
    }
  }, [selectedOrgId, fetchStatus]);

  // Fetch data for the specified date
  const fetchDataForDate = useCallback(async (targetDate: string) => {
    setDataLoading(true);
    setGeneralError(null);
    try {
      const res = await fetch(`/api/zoho/data?date=${targetDate}`);
      const json = await res.json();
      if (json.error) {
        setGeneralError(json.error as string);
        return;
      }
      setData(json as TodaysDataResponse);
      setValidationPassed(false);
    } catch {
      setGeneralError("Network error while communicating with Zoho API");
    } finally {
      setDataLoading(false);
    }
  }, []);

  // Disconnect
  const disconnect = useCallback(async () => {
    if (!window.confirm("Disconnect from Zoho Books? You will need to reconnect.")) {
      return;
    }
    setDisconnecting(true);
    try {
      const res = await fetch("/api/zoho/disconnect", { method: "POST" });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        if (body.envManaged) {
          setGeneralError(
            "Production credentials are managed via Vercel environment variables. " +
            "Remove ZOHO_REFRESH_TOKEN in the Vercel dashboard and redeploy to disconnect."
          );
          return;
        }
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setGeneralError(body.error || "Failed to disconnect");
        return;
      }
      setStatus(null);
      setData(null);
      setOrganizations([]);
      setSelectedOrgId("");
      setValidationPassed(false);
      await fetchStatus();
    } catch {
      setGeneralError("Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  }, [fetchStatus]);

  // Initial load
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // If connected but no org
  useEffect(() => {
    if (!status) return;
    if (status.connected && !status.organizationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchOrganizations();
    }
    if (status.connected && status.organizationId) {
      fetchDataForDate(selectedDate);
    }
  }, [status, fetchOrganizations, fetchDataForDate, selectedDate]);

  // Date controls
  const handlePrevDay = () => {
    const prev = shiftDate(selectedDate, -1);
    setSelectedDate(prev);
    fetchDataForDate(prev);
  };

  const handleNextDay = () => {
    const next = shiftDate(selectedDate, 1);
    setSelectedDate(next);
    fetchDataForDate(next);
  };

  const handleToday = () => {
    const today = getTodayIST();
    setSelectedDate(today);
    fetchDataForDate(today);
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val && isValidISODate(val)) {
      setSelectedDate(val);
      fetchDataForDate(val);
    }
  };

  const currencySymbol = status?.currencySymbol || "₹";

  // Page title from sidebar section
  const pageTitleMap: Record<string, string> = {
    recon_master: "Master Inventory Mismatch — Reconciliation",
    recon_balance: "Balance — Non-Zero Quantity Balance",
    recon_yet_to_purchase: "Yet to Purchase",
    recon_yet_to_sale: "Yet to Sale",
    recon_purchase_only: "Purchase Only Records",
    recon_sales_only: "Sales Only Records",
    recon_reconciled: "Reconciled Items",
    recon_customer_missing: "Customer Details Missing",
    recon_excluded: "Excluded Items",
    tx_purchase_bills: "Purchase Bills",
    tx_sales_invoices: "Sales Invoices",
    tx_detail: "Transaction Detail",
    tx_zoho_activity: "Zoho Books Activity",
    services_summary: "Services — Summary & KPIs",
    services_purchases: "Services — Purchase Bills",
    services_sales: "Services — Sales Invoices",
    services_transactions: "Services — All Transactions",
    services_reconciliation: "Services — Reconciliation & Margins",
    report_summary: "Reconciliation Summary",
    report_customer_wise: "Customer-wise Item Reconciliation",
    report_breakdown: "Breakdown Report",
    report_customer_material: "Customer Material Control Report",
    report_data_quality: "Data Quality",
    report_validation: "Validation Report",
    settings_connections: "Connections & Permissions",
    settings_sync: "Sync & Local Cache",
    settings_modules: "Modules & Features",
    settings_exclusions: "Exclusion Rules",
    settings_suggestions: "Exclusion Suggestions",
    settings_users: "User Management",
    settings_security: "Security",
    settings_skills: "Settings — Skills",
    audit_workspaces: "Reconciliation & Audit — Workspaces / Runs",
    audit_uploads: "Reconciliation & Audit — Uploads & Source Mapping",
    audit_match_review: "Reconciliation & Audit — Match Review",
    audit_findings: "Reconciliation & Audit — Findings & Action Taken",
    audit_reports: "Reconciliation & Audit — Review Reports",
    audit_learning: "Reconciliation & Audit — Learning Proposals",
    dashboard: "Dashboard",
    technical_equivalence: "Estimation — Technical Equivalence Review",
  };
  const pageTitle = pageTitleMap[sidebarSection] ?? "Bansil Engineers — Analytics";

  return (
    <>
      <Sidebar
        activeSection={sidebarSection}
        onNavigate={handleSidebarNav}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        featureSettings={featureSettings}
      />
      <div className={`app-main ${sidebarCollapsed ? "collapsed" : ""}`}>
        <TopHeader
          pageTitle={pageTitle}
          syncStatusText={syncStatusText}
          lastSyncTime={lastSyncTime}
          syncing={syncing}
          connected={status?.connected !== false && syncStatusText !== "Offline"}
          onSync={handleTopHeaderSync}
          onNavigateToCustomer={(customerId, customerName, preferredTab) => {
            setSelectedCustomerForDetails({
              customerId,
              customerName: customerName || "",
              initialTab: preferredTab || "OVERVIEW",
            });
            setSidebarSection("customer_details");
          }}
        />


        {/* Main Content */}
        <main className="app-content">
          {/* Global Error Banner */}
          {generalError && (
            <div className="alert alert-error">
              <span>⚠️</span>
              <span>{generalError}</span>
              <button
                onClick={() => setGeneralError(null)}
                style={{ marginLeft: "auto", background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 16 }}
              >
                ×
              </button>
            </div>
          )}

          {/* 1. DASHBOARD */}
          {sidebarSection === "dashboard" && (
            <Dashboard
              mismatchReport={dashboardMismatchReport}
              report={dashboardReport}
              onNavigate={handleSidebarNav}
              onSelectRow={(cId, itId) => {
                setSidebarSection("recon_master");
                setRowToOpen({ customerId: cId, itemId: itId });
              }}
              financialYear={activeFy}
              onFinancialYearChange={(newFy) => {
                setActiveFy(newFy);
              }}
              syncStatusText={syncStatusText}
              lastSyncTime={lastSyncTime}
              coverageStatus={dashboardMismatchReport?.filterOptions?.coverageStatus ?? "NOT_SYNCED"}
              loading={dashboardLoading}
            />
          )}

          {/* 1.5. PRE-AUDIT VERIFICATION */}
          {(sidebarSection === "pre_audit_verification" || sidebarSection.startsWith("pre_audit_")) && (
            <PreAuditVerificationView
              onNavigate={handleSidebarNav}
              currencySymbol={currencySymbol}
              activeSection={sidebarSection}
            />
          )}

          {/* 2. RECONCILIATION SECTIONS */}
          {sidebarSection.startsWith("recon_") && sidebarSection !== "recon_excluded" && sidebarSection !== "recon_composite_assembly" && (
            <ReconciliationView
              activeSidebarSection={sidebarSection}
              onNavigate={handleSidebarNav}
              initialRowToOpen={rowToOpen}
            />
          )}

          {/* 2B. COMPOSITE ASSEMBLY */}
          {sidebarSection === "recon_composite_assembly" && (
            <CompositeAssemblyView
              initialCustomerId={selectedCustomerForAssembly?.customerId}
              initialCustomerName={selectedCustomerForAssembly?.customerName}
              financialYear={activeFy}
              onNavigateToCustomer={(customerId, customerName) => {
                setSelectedCustomerForDetails({
                  customerId,
                  customerName,
                  initialTab: "RECONCILIATION",
                });
                setSidebarSection("customer_details");
              }}
            />
          )}

          {/* 3. EXCLUDED ITEMS */}
          {(sidebarSection === "recon_excluded" || sidebarSection === "settings_exclusions") && (
            <ExclusionsView />
          )}

          {sidebarSection === "accounts_audit" && (
            <AccountsAuditView />
          )}

          {sidebarSection === "approval_pending" && (
            <ApprovalPendingView />
          )}

          {sidebarSection === "bank_reconciliation" && (
            <BankReconciliationWorkspace />
          )}

          {sidebarSection === "gst_verification" && (
            <GstVerificationView />
          )}

          {/* 3B. INVENTORY: STOCK */}
          {sidebarSection === "inventory_stock" && (
            <InventoryStockView
              financialYear={activeFy}
              onNavigateToCustomer={(customerId, customerName, preferredTab) => {
                setSelectedCustomerForDetails({
                  customerId,
                  customerName: customerName || "",
                  initialTab: preferredTab || "RECONCILIATION",
                });
                setSidebarSection("customer_details");
              }}
            />
          )}

          {/* 4. TRANSACTIONS: PURCHASE BILLS */}
          {sidebarSection === "tx_purchase_bills" && (
            <TransactionsView type="bills" financialYear={activeFy} />
          )}

          {/* 5. TRANSACTIONS: SALES INVOICES */}
          {sidebarSection === "tx_sales_invoices" && (
            <TransactionsView type="invoices" financialYear={activeFy} />
          )}

          {/* 6. TRANSACTIONS: TRANSACTION DETAIL (Section 14 & 15) */}
          {sidebarSection === "tx_detail" && (
            <TransactionsView type="detail" financialYear={activeFy} />
          )}

          {/* 6B. TRANSACTIONS: ZOHO ACTIVITY (Section 13-22) */}
          {sidebarSection === "tx_zoho_activity" && (
            <ZohoActivityView financialYear={activeFy} />
          )}

          {/* 6C. SERVICES SECTION */}
          {sidebarSection.startsWith("services_") && (
            <ServicesView
              subView={
                sidebarSection === "services_purchases"
                  ? "purchases"
                  : sidebarSection === "services_sales"
                  ? "sales"
                  : sidebarSection === "services_transactions"
                  ? "transactions"
                  : sidebarSection === "services_reconciliation"
                  ? "reconciliation"
                  : "summary"
              }
              financialYear={activeFy}
            />
          )}

          {/* 7. REPORTS: RECONCILIATION SUMMARY */}
          {sidebarSection === "report_summary" && (
            <ReconciliationView
              activeSidebarSection="report_summary"
              onNavigate={handleSidebarNav}
            />
          )}

          {/* 7B. REPORTS: CUSTOMER-WISE ITEM RECONCILIATION */}
          {sidebarSection === "report_customer_wise" && (
            <ReconciliationView
              activeSidebarSection="report_customer_wise"
              onNavigate={handleSidebarNav}
            />
          )}

          {/* 8. REPORTS: BREAKDOWN REPORT */}
          {sidebarSection === "report_breakdown" && (
            <BreakdownReportView
              report={dashboardReport}
              mismatchReport={dashboardMismatchReport}
              financialYear={activeFy}
              period="CURRENT_FY"
              customerId=""
              itemId=""
              search=""
              includeExcludedItems={false}
            />
          )}

          {/* 8B. REPORTS: PRICE REFERENCE */}
          {sidebarSection === "report_price_reference" && (
            <PriceReferenceView financialYear={activeFy} />
          )}

          {/* 8C. CUSTOMERS: CUSTOMER DETAILS / CUSTOMER 360 */}
          {sidebarSection === "customer_details" && (
            <CustomerDetailsView
              key={selectedCustomerForDetails?.customerId || "default-cust"}
              initialCustomerId={selectedCustomerForDetails?.customerId || ""}
              initialCustomerName={selectedCustomerForDetails?.customerName || ""}
              initialTab={(selectedCustomerForDetails?.initialTab as any) || "OVERVIEW"}
              financialYear={activeFy}
              onNavigateToActionTaken={() => {
                setSidebarSection("customer_action_taken");
              }}
              onNavigateToSiteMaterialReport={(customerId, customerName) => {
                setSelectedCustomerForMaterialReport({ customerId, customerName });
                setSidebarSection("report_customer_material");
              }}
              onCreateCompositeAssembly={(customerId, customerName) => {
                setSelectedCustomerForAssembly({ customerId, customerName });
                setSidebarSection("recon_composite_assembly");
              }}
            />
          )}

          {/* 8D. CUSTOMERS: ACTION TAKEN (Customer-wise Mismatch Action Tracker) */}
          {sidebarSection === "customer_action_taken" && (
            <ActionTakenView
              financialYear={activeFy}
              onNavigateToCustomer={(customerId, customerName) => {
                setSelectedCustomerForDetails({
                  customerId,
                  customerName,
                  initialTab: "RECONCILIATION",
                });
                setSidebarSection("customer_details");
              }}
            />
          )}

          {/* 8E. REPORTS: CUSTOMER MATERIAL CONTROL */}
          {sidebarSection === "report_customer_material" && (
            <CustomerMaterialControlView
              key={selectedCustomerForMaterialReport?.customerId || "default-site-mat"}
              initialCustomerId={selectedCustomerForMaterialReport?.customerId || ""}
              initialCustomerName={selectedCustomerForMaterialReport?.customerName || ""}
              financialYear={activeFy}
              onNavigateToCustomerDetails={(customerId, customerName) => {
                setSelectedCustomerForDetails({
                  customerId,
                  customerName: customerName || "",
                  initialTab: "OVERVIEW",
                });
                setSidebarSection("customer_details");
              }}
              onNavigateToActionTaken={() => {
                setSidebarSection("customer_action_taken");
              }}
            />
          )}

          {/* 9. REPORTS: DATA QUALITY */}
          {sidebarSection === "report_data_quality" && (
            <ReconciliationView
              activeSidebarSection="report_data_quality"
              onNavigate={handleSidebarNav}
            />
          )}

          {/* 10. REPORTS: VALIDATION REPORT */}
          {sidebarSection === "report_validation" && (
            <ReconciliationView
              activeSidebarSection="report_validation"
              onNavigate={handleSidebarNav}
            />
          )}


          {/* SETTINGS: CONNECTIONS & PERMISSIONS */}
          {sidebarSection === "settings_connections" && (
            <div className="section-card" style={{ padding: 24, maxWidth: 900 }}>
              <ConnectionControls />
            </div>
          )}

          {/* 11. SETTINGS: SYNC & LOCAL CACHE */}
          {sidebarSection === "settings_sync" && (
            <div className="section-card" style={{ padding: 24, maxWidth: 880 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>Sync &amp; Local Cache</h2>
                  <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0 0" }}>
                    Manage Zoho Books connection, offline SQLite database, and incremental sync.
                  </p>
                </div>
                <span style={{ fontSize: 11.5, background: "#f1f5f9", padding: "4px 10px", borderRadius: 4, color: "#334155", fontWeight: 600 }}>
                  SQLite: <code style={{ color: "#0f172a" }}>data/bansil_books.db</code>
                </span>
              </div>

              {/* Zoho Books Connection Card */}
              <div
                style={{
                  marginBottom: 24,
                  padding: "20px 22px",
                  background: status?.connected && syncStatusText !== "Offline" ? "#f0fdf4" : "#fef2f2",
                  border: `1px solid ${status?.connected && syncStatusText !== "Offline" ? "#bbf7d0" : "#fecaca"}`,
                  borderRadius: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      ZOHO BOOKS CONNECTION
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                      <span>Status:</span>
                      {status?.connected && syncStatusText !== "Offline" ? (
                        <span style={{ color: "#16a34a" }}>CONNECTED ●</span>
                      ) : (
                        <span style={{ color: "#dc2626" }}>DISCONNECTED ○</span>
                      )}
                    </div>
                    {(!status?.connected || syncStatusText === "Offline") && (
                      <div style={{ fontSize: 12, color: "#991b1b", marginTop: 4, fontWeight: 600 }}>
                        Offline — viewing last synchronized local data.
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 10 }}>
                    {status?.connected && syncStatusText !== "Offline" ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={disconnecting}
                        onClick={async () => {
                          if (!window.confirm("Disconnect local Zoho Books connection?\n\nYour local SQLite database, classifications, exclusions, and cached reports will remain 100% intact.")) return;
                          try {
                            setDisconnecting(true);
                            const res = await fetch(ZOHO_DISCONNECT_ENDPOINT, { method: "POST" });
                            if (res.status === 409) {
                              const body = await res.json().catch(() => ({}));
                              if (body.envManaged) {
                                setGeneralError(
                                  "Production credentials are managed via Vercel environment variables. " +
                                  "Remove ZOHO_REFRESH_TOKEN in the Vercel dashboard and redeploy to disconnect."
                                );
                              }
                            } else if (res.ok) {
                              await fetchStatus();
                              setSyncStatusText("Offline");
                            }
                          } catch {} finally {
                            setDisconnecting(false);
                          }
                        }}
                        style={{ background: "#ffffff", color: "#b91c1c", border: "1px solid #f87171", fontWeight: 700, padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12.5 }}
                      >
                        {disconnecting ? "Disconnecting…" : "Disconnect Local Connection"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => {
                          window.location.href = ZOHO_CONNECT_ENDPOINT;
                        }}
                        style={{ fontWeight: 700, padding: "8px 18px", borderRadius: 6, fontSize: 12.5 }}
                      >
                        Connect Zoho Books
                      </button>
                    )}
                  </div>
                </div>

                {/* Connection Metadata Grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 12,
                    marginTop: 18,
                    paddingTop: 16,
                    borderTop: `1px dashed ${status?.connected && syncStatusText !== "Offline" ? "#86efac" : "#fca5a5"}`,
                    fontSize: 12,
                  }}
                >
                  <div>
                    <span style={{ color: "#64748b", display: "block", fontSize: 11 }}>Organization:</span>
                    <strong style={{ color: "#0f172a" }}>BANSIL ENGINEER</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", display: "block", fontSize: 11 }}>Mode:</span>
                    <strong style={{ color: "#16a34a" }}>🔒 Read Only</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", display: "block", fontSize: 11 }}>Local Cache:</span>
                    <strong style={{ color: "#0f172a" }}>Available</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", display: "block", fontSize: 11 }}>Last Sync:</span>
                    <strong style={{ color: "#0f172a" }}>{lastSyncTime || "N/A"}</strong>
                  </div>
                </div>
              </div>

              {/* Storage Architecture Table */}
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "#0f172a" }}>
                  Storage Engine &amp; Security Guarantees
                </h3>
                <table className="security-table" style={{ width: "100%" }}>
                  <tbody>
                    <tr>
                      <td className="key" style={{ width: "40%", fontWeight: 600 }}>LOCAL STORAGE ENGINE</td>
                      <td className="val"><span className="badge-enabled">SQLite (node:sqlite) · data/bansil_books.db</span></td>
                    </tr>
                    <tr>
                      <td className="key" style={{ fontWeight: 600 }}>DATA PRESERVATION</td>
                      <td className="val"><span className="badge-enabled">Preserved on Disconnect (No data wiped)</span></td>
                    </tr>
                    <tr>
                      <td className="key" style={{ fontWeight: 600 }}>SYNC ARCHITECTURE</td>
                      <td className="val"><span className="badge-enabled">Incremental UPSERT (GET only)</span></td>
                    </tr>
                    <tr>
                      <td className="key" style={{ fontWeight: 600 }}>SYNC DIRECTION</td>
                      <td className="val" style={{ fontSize: 11.5, color: "#475569" }}>Zoho Books → Local Database ONLY</td>
                    </tr>
                    <tr>
                      <td className="key" style={{ fontWeight: 600 }}>OFFLINE REPORTING</td>
                      <td className="val"><span className="badge-enabled">FULL SUPPORT (Active)</span></td>
                    </tr>
                    <tr>
                      <td className="key" style={{ fontWeight: 600 }}>ZOHO SOURCE MUTATIONS</td>
                      <td className="val"><span className="badge-blocked">0 (STRICTLY READ-ONLY GET)</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Historical Backfill */}
              <div style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid #e2e8f0" }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>
                  Historical Backfill &amp; Data Ingestion
                </h3>
                <p style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
                  Read bills and invoices from Zoho Books and cache locally in SQLite. Never writes to Zoho Books.
                </p>

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Select Financial Year:</label>
                  <select
                    className="select-input"
                    style={{ padding: "6px 10px", fontSize: 12, borderRadius: 4 }}
                    value={backfillFy}
                    onChange={(e) => setBackfillFy(e.target.value)}
                    disabled={backfillRunning || (!status?.connected || syncStatusText === "Offline")}
                  >
                    <option value="FY 2025-26">FY 2025-26 (01-04-2025 to 31-03-2026)</option>
                    <option value="FY 2026-27">FY 2026-27 (01-04-2026 to 31-03-2027)</option>
                  </select>

                  <button
                    className="btn btn-sm btn-primary"
                    disabled={backfillRunning || (!status?.connected || syncStatusText === "Offline")}
                    onClick={async () => {
                      if (!window.confirm(`Perform Historical Backfill for ${backfillFy}? This reads from Zoho and updates local SQLite only.`)) return;
                      setBackfillRunning(true);
                      setBackfillMessage(`Starting backfill for ${backfillFy}...`);
                      try {
                        const res = await fetch("/api/sync/backfill", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ financialYear: backfillFy }),
                        });
                        const json = await res.json();
                        if (json.success && json.result) {
                          setBackfillResult(json.result);
                          setBackfillMessage(`✓ Backfill complete: ${json.result.invoicesSynced} invoices, ${json.result.billsSynced} bills synced.`);
                          await Promise.all([loadDashboardData(), fetchStatus(), fetchSyncState()]);
                        } else {
                          setBackfillMessage(`Backfill note: ${json.error || "Completed"}`);
                        }
                      } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : "Network error";
                        setBackfillMessage(`Backfill failed: ${msg}`);
                      } finally {
                        setBackfillRunning(false);
                      }
                    }}
                    style={(!status?.connected || syncStatusText === "Offline") ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
                    title={(!status?.connected || syncStatusText === "Offline") ? "Connect Zoho Books to run backfill" : "Run Historical Backfill"}
                  >
                    {backfillRunning ? "⏳ Backfilling..." : "Run Historical Backfill"}
                  </button>
                </div>

                {(!status?.connected || syncStatusText === "Offline") && (
                  <div style={{ fontSize: 11.5, color: "#64748b", fontStyle: "italic", marginBottom: 10 }}>
                    * Connect Zoho Books to perform live backfill. Offline cached data is fully accessible.
                  </div>
                )}

                {backfillMessage && (
                  <div style={{ marginTop: 10, fontSize: 11, padding: "8px 12px", borderRadius: 4, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                    {backfillMessage}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 11B. SETTINGS: MODULES & FEATURES CONTROL (Section 22-28) */}
          {sidebarSection === "settings_modules" && (
            <OwnerAuthGate>
              <SettingsModulesView onSettingsChanged={loadFeatureSettings} />
            </OwnerAuthGate>
          )}

          {/* 11C. SETTINGS: SKILLS (Milestone A registry) */}
          {sidebarSection === "settings_skills" && (
            <OwnerAuthGate>
              <SettingsSkillsView />
            </OwnerAuthGate>
          )}

          {/* 12. SETTINGS: EXCLUSION SUGGESTIONS */}
          {/* SETTINGS: USER MANAGEMENT */}
          {sidebarSection === "settings_users" && (
            <UserManagementView />
          )}

          {sidebarSection === "settings_suggestions" && (
            <ExclusionSuggestionsView />
          )}

          {/* ESTIMATION: TECHNICAL EQUIVALENCE REVIEW */}
          {sidebarSection === "technical_equivalence" && (
            <TechnicalEquivalenceReviewView />
          )}

          {sidebarSection === "ai_assistant" || sidebarSection === "ai_chat" || sidebarSection === "ai_history" ? (
            <AiAssistantView />
          ) : null}

          {/* 13. SETTINGS: SECURITY */}
          {sidebarSection === "settings_security" && (
            <div className="section-card" style={{ padding: 24, maxWidth: 800 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Security &amp; Read-Only Policy</h2>
              <table className="security-table" style={{ marginBottom: 16 }}>
                <tbody>
                  <tr><td className="key">ZOHO ACCESS MODE</td><td className="val"><span className="badge-enabled">READ ONLY</span></td></tr>
                  <tr><td className="key">ZOHO WRITE ACCESS</td><td className="val"><span className="badge-blocked">DISABLED (HTTP 403)</span></td></tr>
                  <tr><td className="key">PERMITTED METHODS</td><td className="val"><span className="badge-enabled">GET ONLY</span></td></tr>
                  <tr><td className="key">BLOCKED MUTATIONS</td><td className="val"><span className="badge-blocked">POST, PUT, PATCH, DELETE, CREATE, UPDATE, VOID</span></td></tr>
                  <tr><td className="key">AUTH POST EXCEPTION</td><td className="val"><span className="badge-neutral">Zoho Accounts OAuth Token Refresh ONLY</span></td></tr>
                  <tr><td className="key">LOCAL STORAGE MUTATIONS</td><td className="val"><span className="badge-enabled">ENABLED (SQLite Cache)</span></td></tr>
                  <tr><td className="key">AUDIT INTEGRITY</td><td className="val"><span className="badge-enabled">100% AUDIT VERIFIED</span></td></tr>
                </tbody>
              </table>
              <div style={{ padding: 12, borderRadius: 6, background: "var(--bg-subtle)", border: "1px solid var(--border)", fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                🔒 <strong>Strict Read-Only Enforcement:</strong> The security guard inspects every outgoing HTTP request to Zoho Books. Any attempt to modify, create, update, or delete records in Zoho Books is blocked immediately.
              </div>
            </div>
          )}
        </main>

        {/* ============================================================
          24. SETTINGS — SECURITY STATUS PANEL
        ============================================================ */}
      {showSecurityModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowSecurityModal(false)}
        >
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="modal-title">Settings &amp; Policies</div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    className={`btn btn-sm ${modalTab === "security" ? "btn-primary" : ""}`}
                    onClick={() => setModalTab("security")}
                  >
                    🛡️ Security Policy
                  </button>
                  <button
                    className={`btn btn-sm ${modalTab === "sync" ? "btn-primary" : ""}`}
                    onClick={() => setModalTab("sync")}
                  >
                    ⚡ Sync &amp; Local Cache
                  </button>
                </div>
              </div>
              <button
                onClick={() => setShowSecurityModal(false)}
                className="btn btn-sm"
                style={{ border: "none", fontSize: 16 }}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {modalTab === "sync" ? (
                <div>
                  <table className="security-table">
                    <tbody>
                      <tr>
                        <td className="key">LOCAL STORAGE ENGINE</td>
                        <td className="val"><span className="badge-enabled">SQLite (node:sqlite)</span></td>
                      </tr>
                      <tr>
                        <td className="key">SYNC ARCHITECTURE</td>
                        <td className="val"><span className="badge-enabled">Incremental UPSERT</span></td>
                      </tr>
                      <tr>
                        <td className="key">SYNC DIRECTION</td>
                        <td className="val" style={{ fontSize: 11 }}>Zoho Books → Local Database ONLY</td>
                      </tr>
                      <tr>
                        <td className="key">OFFLINE REPORTING</td>
                        <td className="val"><span className="badge-enabled">FULL SUPPORT</span></td>
                      </tr>
                      <tr>
                        <td className="key">ZOHO SOURCE MUTATIONS</td>
                        <td className="val"><span className="badge-blocked">0 (READ-ONLY GET)</span></td>
                      </tr>
                    </tbody>
                  </table>

                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: "var(--accent)" }}>
                      Advanced: Full Historical Backfill
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
                      <label style={{ fontSize: 12, fontWeight: 500 }}>Select Financial Year:</label>
                      <select
                        className="select-input"
                        style={{ padding: "4px 8px", fontSize: 12, borderRadius: 4 }}
                        value={backfillFy}
                        onChange={(e) => setBackfillFy(e.target.value)}
                        disabled={backfillRunning}
                      >
                        <option value="FY 2025-26">FY 2025-26 (01-04-2025 to 31-03-2026)</option>
                        <option value="FY 2026-27">FY 2026-27 (01-04-2026 to 31-03-2027)</option>
                      </select>
                    </div>

                    <div
                      style={{
                        padding: "10px 12px",
                        backgroundColor: "rgba(234, 179, 8, 0.1)",
                        border: "1px solid rgba(234, 179, 8, 0.3)",
                        borderRadius: 6,
                        fontSize: 11,
                        color: "var(--text-primary)",
                        marginBottom: 12,
                        lineHeight: 1.4,
                      }}
                    >
                      ⚠ <strong>Warning:</strong> This reads all Bills and Invoices for the selected FY from Zoho Books and updates the LOCAL cache only. Zoho Books will not be modified.
                    </div>

                    <table className="security-table" style={{ marginBottom: 14 }}>
                      <tbody>
                        <tr>
                          <td className="key">ZOHO ACCESS</td>
                          <td className="val"><span className="badge-enabled">READ ONLY</span></td>
                        </tr>
                        <tr>
                          <td className="key">SOURCE</td>
                          <td className="val">Zoho Books</td>
                        </tr>
                        <tr>
                          <td className="key">DESTINATION</td>
                          <td className="val"><span className="badge-enabled">Local SQLite Cache</span></td>
                        </tr>
                        <tr>
                          <td className="key">ZOHO WRITE</td>
                          <td className="val"><span className="badge-blocked">BLOCKED</span></td>
                        </tr>
                      </tbody>
                    </table>

                    <button
                      className="btn btn-sm btn-primary"
                      disabled={backfillRunning}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `Perform Full Historical Backfill for ${backfillFy}? This reads all Bills and Invoices from Zoho Books and updates the LOCAL cache only. Zoho Books remains strictly READ ONLY.`
                          )
                        ) {
                          return;
                        }
                        setBackfillRunning(true);
                        setBackfillMessage(`Starting full backfill for ${backfillFy}...`);
                        setBackfillResult(null);

                        try {
                          const res = await fetch("/api/sync/backfill", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ financialYear: backfillFy }),
                          });
                          const json = await res.json();
                          if (json.success && json.result) {
                            setBackfillResult(json.result);
                            setBackfillMessage(`✓ Full Historical Backfill completed: ${json.result.invoicesSynced} invoices, ${json.result.billsSynced} bills synced locally.`);
                          } else {
                            setBackfillMessage(`BACKFILL INCOMPLETE: ${json.error || json.result?.error || "Unknown error"}`);
                          }
                        } catch (err: unknown) {
                          const msg = err instanceof Error ? err.message : "Network error";
                          setBackfillMessage(`BACKFILL INCOMPLETE: ${msg}`);
                        } finally {
                          setBackfillRunning(false);
                        }
                      }}
                    >
                      {backfillRunning ? "⏳ Backfilling Local SQLite..." : "FULL HISTORICAL BACKFILL"}
                    </button>

                    {backfillMessage && (
                      <div style={{ marginTop: 10, fontSize: 11, padding: "8px 10px", borderRadius: 4, background: "var(--bg-card)", border: "1px solid var(--border)" }}>
                        {backfillMessage}
                      </div>
                    )}

                    {backfillResult && (
                      <div style={{ marginTop: 10, fontSize: 11, padding: "8px 10px", borderRadius: 4, background: "var(--bg-card)", border: "1px solid var(--border)" }}>
                        <div><strong>Backfill Summary:</strong></div>
                        <div>Invoices Synced: {String(backfillResult.invoicesSynced ?? 0)} (across {String(backfillResult.invoiceListPages ?? 0)} pages)</div>
                        <div>Bills Synced: {String(backfillResult.billsSynced ?? 0)} (across {String(backfillResult.billListPages ?? 0)} pages)</div>
                        <div>Distinct Customers: {String(backfillResult.customerDropdownCount ?? 0)} · Distinct Items: {String(backfillResult.itemDropdownCount ?? 0)}</div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <>
                <table className="security-table">
                <tbody>
                  <tr>
                    <td className="key">ZOHO ACCESS MODE</td>
                    <td className="val">
                      <span className="badge-enabled">READ ONLY</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="key">ZOHO WRITE ACCESS</td>
                    <td className="val">
                      <span className="badge-blocked">DISABLED</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="key">CREATE</td>
                    <td className="val">
                      <span className="badge-blocked">BLOCKED</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="key">UPDATE</td>
                    <td className="val">
                      <span className="badge-blocked">BLOCKED</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="key">DELETE</td>
                    <td className="val">
                      <span className="badge-blocked">BLOCKED</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="key">VOID</td>
                    <td className="val">
                      <span className="badge-blocked">BLOCKED</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="key">PAYMENT WRITE</td>
                    <td className="val">
                      <span className="badge-blocked">BLOCKED</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="key">SOURCE DATA MODIFICATION</td>
                    <td className="val">
                      <span className="badge-blocked">BLOCKED</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="key">AI DATA SHARING</td>
                    <td className="val">
                      <span className="badge-neutral">DISABLED</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="key">LOCAL DATABASE WRITES</td>
                    <td className="val">
                      <span className="badge-enabled">ENABLED</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="key">OAUTH SCOPES</td>
                    <td className="val" style={{ fontSize: 11 }}>
                      *.READ ONLY
                    </td>
                  </tr>
                  <tr>
                    <td className="key">SYNC DIRECTION</td>
                    <td className="val" style={{ fontSize: 11 }}>
                      Zoho Books → Local Database ONLY
                    </td>
                  </tr>
                </tbody>
              </table>

              <div
                style={{
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 12,
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                🔒 <strong>Strict Policy Notice:</strong> This page is informational only.
                It must not contain controls capable of enabling Zoho write access.
                All non-GET requests to Zoho Books API are rejected by the runtime security guard.
              </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      </div>{/* /app-main */}
    </>
  );
}

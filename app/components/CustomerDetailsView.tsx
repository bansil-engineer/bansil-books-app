"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import type { Customer360Data, CustomerListItem } from "@/app/lib/customer-details-engine";
import { formatINR, formatQuantity, formatDisplayDate } from "@/app/lib/date-utils";
import { ExportDialog } from "./ExportDialog";
import { DetailsDrawer } from "./DetailsDrawer";
import { ItemDetailDrawer } from "./ItemDetailDrawer";
import { SelectiveSyncModal } from "./SelectiveSyncModal";
import type { ExportOptions, ItemTransactionBreakdown } from "@/app/types/reconciliation";

interface CustomerDetailsViewProps {
  initialCustomerId?: string;
  initialCustomerName?: string;
  initialTab?: SubTab;
  financialYear?: string;
  onNavigateToDocument?: (type: "bill" | "invoice", docId: string) => void;
  onNavigateToActionTaken?: (customerId?: string) => void;
  onCreateCompositeAssembly?: (customerId: string, customerName: string) => void;
  onNavigateToSiteMaterialReport?: (customerId: string, customerName?: string) => void;
}

interface DocumentDetail {
  bill_id?: string;
  invoice_id?: string;
  bill_number?: string;
  invoice_number?: string;
  date?: string;
  due_date?: string;
  vendor_id?: string;
  vendor_name?: string;
  customer_id?: string;
  customer_name?: string;
  grand_total?: number;
  taxableTotal?: number;
  taxAmount?: number;
  balance?: number;
  status?: string;
  bill_url?: string;
  invoice_url?: string;
  lines?: Array<{
    line_item_id: string;
    item_id: string;
    item_name: string;
    sku?: string;
    quantity: number;
    rate: number;
    line_total: number;
    customer_details?: string;
    purchase_line_customer_name?: string;
    bbt_customer_name?: string;
    description?: string;
  }>;
}

type SubTab =
  | "OVERVIEW"
  | "SALES_INVOICES"
  | "PURCHASE_BILLS"
  | "SALES_ORDERS"
  | "PURCHASE_ORDERS"
  | "ITEM_ANALYSIS"
  | "RECONCILIATION"
  | "PRICE_HISTORY";

export function CustomerDetailsView({
  initialCustomerId = "",
  initialCustomerName = "",
  initialTab = "OVERVIEW",
  financialYear = "2026-27",
  onNavigateToActionTaken,
  onCreateCompositeAssembly,
  onNavigateToSiteMaterialReport,
}: CustomerDetailsViewProps) {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(initialCustomerId);
  const [selectedCustomerName, setSelectedCustomerName] = useState<string>(initialCustomerName);
  const [period, setPeriod] = useState<string>(financialYear || "2026-27");
  const [activePeriod, setActivePeriod] = useState<string>("CURRENT_FY");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [activeTab, setActiveTab] = useState<SubTab>(initialTab || "OVERVIEW");
  const [topItemMode, setTopItemMode] = useState<"VALUE" | "QTY">("VALUE");

  const [customerList, setCustomerList] = useState<CustomerListItem[]>([]);
  const [customerSearch, setCustomerSearch] = useState<string>("");
  const [customer360, setCustomer360] = useState<Customer360Data | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingList, setLoadingList] = useState<boolean>(false);
  const [showExportDialog, setShowExportDialog] = useState<boolean>(false);

  // Customer Sync State
  const [syncingCustomer, setSyncingCustomer] = useState<boolean>(false);
  const [customerSyncResult, setCustomerSyncResult] = useState<any | null>(null);
  const [showSelectiveSyncModal, setShowSelectiveSyncModal] = useState<boolean>(false);

  // Document Detail Drawer State
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
  const [loadingDocDetail, setLoadingDocDetail] = useState<boolean>(false);

  // Drill-down Breakdown Drawer State
  const [drilldownItem, setDrilldownItem] = useState<ItemTransactionBreakdown | null>(null);
  const [loadingBreakdown, setLoadingBreakdown] = useState<boolean>(false);
  const [selectedItemForDetail, setSelectedItemForDetail] = useState<{
    itemId: string;
    itemName?: string;
    customerId?: string;
    customerName?: string;
  } | null>(null);


  // Open item drill-down breakdown drawer
  const handleOpenBreakdown = async (customerId: string, itemIdOrName: string) => {
    try {
      setLoadingBreakdown(true);
      const params = new URLSearchParams();
      if (period) params.set("financialYear", period);
      if (customerId) params.set("breakdownCustomerId", customerId);
      params.set("breakdownItemId", itemIdOrName);
      const res = await fetch(`/api/inventory-mismatch?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.breakdown) {
          // Global exclusion safety: if item is excluded, refresh customer view and do not show drawer
          if (json.breakdown.isExcluded) {
            setDrilldownItem(null);
            fetchCustomer360();
            fetchCustomerList();
            return;
          }
          setDrilldownItem(json.breakdown);
        }
      }
    } catch (e) {
      console.error("Failed to load reconciliation breakdown:", e);
    } finally {
      setLoadingBreakdown(false);
    }
  };

  // Esc key listener for drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedDoc(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Update selection if passed via props
  useEffect(() => {
    if (initialCustomerId) setSelectedCustomerId(initialCustomerId);
    if (initialCustomerName) setSelectedCustomerName(initialCustomerName);
    if (initialTab) setActiveTab(initialTab);
  }, [initialCustomerId, initialCustomerName, initialTab]);

  // Fetch customer list for selector
  const fetchCustomerList = useCallback(async () => {
    try {
      setLoadingList(true);
      const params = new URLSearchParams();
      params.set("action", "list");
      params.set("financialYear", period);
      if (customerSearch) params.set("search", customerSearch);
      const res = await fetch(`/api/customer-details?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setCustomerList(json.customers || []);
      }
    } catch {
      // offline fallback
    } finally {
      setLoadingList(false);
    }
  }, [period, customerSearch]);

  useEffect(() => {
    fetchCustomerList();
  }, [fetchCustomerList]);

  // Fetch full Customer 360 data
  const fetchCustomer360 = useCallback(async () => {
    if (!selectedCustomerId && !selectedCustomerName) {
      setCustomer360(null);
      return;
    }

    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedCustomerId) params.set("customerId", selectedCustomerId);
      if (selectedCustomerName) params.set("customerName", selectedCustomerName);
      params.set("financialYear", period);
      params.set("period", activePeriod);
      if (activePeriod === "CUSTOM" && fromDate && toDate) {
        params.set("fromDate", fromDate);
        params.set("toDate", toDate);
      }

      const res = await fetch(`/api/customer-details?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setCustomer360(json.data || null);
      } else {
        setCustomer360(null);
      }
    } catch {
      setCustomer360(null);
    } finally {
      setLoading(false);
    }
  }, [selectedCustomerId, selectedCustomerName, period, activePeriod, fromDate, toDate]);

  useEffect(() => {
    fetchCustomer360();
  }, [fetchCustomer360]);

  // Open Document Detail Drawer
  const openBillDrawer = async (billId: string) => {
    try {
      setLoadingDocDetail(true);
      const res = await fetch(`/api/transactions?type=bill-detail&docId=${encodeURIComponent(billId)}`);
      if (res.ok) {
        const json = await res.json();
        setSelectedDoc(json.document);
      }
    } catch (err) {
      console.error("Failed to load bill detail:", err);
    } finally {
      setLoadingDocDetail(false);
    }
  };

  const openInvoiceDrawer = async (invoiceId: string) => {
    try {
      setLoadingDocDetail(true);
      const res = await fetch(`/api/transactions?type=invoice-detail&docId=${encodeURIComponent(invoiceId)}`);
      if (res.ok) {
        const json = await res.json();
        setSelectedDoc(json.document);
      }
    } catch (err) {
      console.error("Failed to load invoice detail:", err);
    } finally {
      setLoadingDocDetail(false);
    }
  };

  // Execute customer-specific smart or force sync
  const handleSyncCustomer = async (mode: "SMART" | "FORCE" = "SMART") => {
    if (!customer360) return;
    try {
      setSyncingCustomer(true);
      setCustomerSyncResult(null);

      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          modules: ["sales_invoices", "purchase_bills"],
          customerId: customer360.customer.id,
          customerName: customer360.customer.name,
          financialYear: period === "ALL" ? undefined : period,
          fromDate: activePeriod === "CUSTOM" ? fromDate : undefined,
          toDate: activePeriod === "CUSTOM" ? toDate : undefined,
          forceDetail: mode === "FORCE",
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || "Customer sync failed");
      }

      setCustomerSyncResult(data);
      // Refresh local analytics from SQLite
      fetchCustomer360();
      fetchCustomerList();
    } catch (err) {
      console.error("Failed to sync customer:", err);
      setCustomerSyncResult({
        status: "FAILED",
        message: err instanceof Error ? err.message : "Sync failed",
      });
    } finally {
      setSyncingCustomer(false);
    }
  };

  const handleExport = async (options: ExportOptions) => {
    if (!customer360) return;
    const format = options.format || "excel";
    const endpoint = format === "pdf" ? "/api/export/pdf" : "/api/export/excel";

    const params = new URLSearchParams();
    params.set("reportType", "customer-details");
    params.set("customerId", customer360.customer.id);
    params.set("customerName", customer360.customer.name);
    params.set("financialYear", period);
    params.set("period", activePeriod);
    if (activePeriod === "CUSTOM" && fromDate && toDate) {
      params.set("fromDate", fromDate);
      params.set("toDate", toDate);
    }
    if (options.selectedFields && options.selectedFields.length > 0) {
      params.set("selectedFields", options.selectedFields.join(","));
    }
    if (typeof options.includeTotals === "boolean") {
      params.set("includeTotals", String(options.includeTotals));
    }

    const res = await fetch(`${endpoint}?${params.toString()}`);
    if (res.ok) {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = customer360.customer.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      a.download = `Bansil_Customer_360_${safeName}_${period}.${format === "pdf" ? "pdf" : "xlsx"}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }
    setShowExportDialog(false);
  };

  // Filtered customer list for search dropdown
  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customerList;
    const q = customerSearch.toLowerCase().trim();
    return customerList.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.gstin.toLowerCase().includes(q)
    );
  }, [customerList, customerSearch]);

  const kpis = customer360?.kpis;
  const overview = customer360?.overview;
  const cust = customer360?.customer;

  return (
    <div className="report-view-container" style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      {/* Top Header & Selector */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: 0 }}>
            Customer Details / Customer 360
          </h1>
          <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0 0" }}>
            Zoho Books Account Intelligence · Purchase Line Customer Linkage · Strictly Local SQLite Cache
          </p>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {customer360 && (
            <>
              <button
                onClick={() => setShowSelectiveSyncModal(true)}
                className="btn-secondary"
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "7px 12px" }}
                title="Open selective multi-module sync dialog"
              >
                <span>⚙️</span> Selective Sync...
              </button>
              <button
                onClick={() => setShowExportDialog(true)}
                className="btn-secondary"
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "7px 12px" }}
              >
                <span>📊</span> Export Excel / PDF...
              </button>
            </>
          )}
        </div>
      </div>


      {/* Selector & Filter Bar */}
      <div
        className="filter-bar"
        style={{
          background: "#ffffff",
          padding: 16,
          borderRadius: 8,
          border: "1px solid #e2e8f0",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          display: "flex",
          gap: 16,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        {/* Customer Search & Dropdown */}
        <div style={{ flex: "1 1 320px", position: "relative" }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: 4 }}>
            SELECT CUSTOMER
          </label>
          <select
            value={selectedCustomerId || selectedCustomerName}
            onChange={(e) => {
              const val = e.target.value;
              const found = customerList.find((c) => c.id === val || c.name === val);
              if (found) {
                setSelectedCustomerId(found.id);
                setSelectedCustomerName(found.name);
              } else {
                setSelectedCustomerId(val);
                setSelectedCustomerName("");
              }
            }}
            className="filter-select"
            style={{ width: "100%", padding: "8px 12px", fontSize: 13, fontWeight: 600, borderColor: selectedCustomerId ? "#0f766e" : "#cbd5e1" }}
          >
            <option value="">— Select a Customer —</option>
            {filteredCustomers.map((c) => (
              <option key={c.id || c.name} value={c.id || c.name}>
                {c.name} {c.totalTransactions > 0 ? `(${c.totalTransactions} txns)` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Period Filter */}
        <div style={{ flex: "0 1 180px" }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: 4 }}>
            PERIOD
          </label>
          <select
            value={activePeriod}
            onChange={(e) => setActivePeriod(e.target.value)}
            className="filter-select"
            style={{ width: "100%", padding: "8px 12px", fontSize: 13 }}
          >
            <option value="CURRENT_FY">Current FY ({period})</option>
            <option value="PREVIOUS_FY">Previous FY (2025-26)</option>
            <option value="ALL">All Periods (Full History)</option>
            <option value="CUSTOM">Custom Date Range</option>
          </select>
        </div>

        {/* Custom Date Range */}
        {activePeriod === "CUSTOM" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 2 }}>
                From Date
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="filter-input"
                style={{ padding: "6px 10px", fontSize: 12 }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 2 }}>
                To Date
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="filter-input"
                style={{ padding: "6px 10px", fontSize: 12 }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div style={{ padding: 48, textAlign: "center", color: "#64748b", fontSize: 14 }}>
          Loading complete Customer 360 profile from local SQLite…
        </div>
      )}

      {/* Empty State when no customer selected */}
      {!loading && !customer360 && (
        <div
          style={{
            background: "#ffffff",
            padding: 60,
            borderRadius: 8,
            border: "1px dashed #cbd5e1",
            textAlign: "center",
            marginTop: 20,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 12 }}>👥</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#1e293b", marginBottom: 6 }}>
            Select a customer to view complete account analytics.
          </div>
          <div style={{ fontSize: 13, color: "#64748b", maxWidth: 500, margin: "0 auto" }}>
            Search and select any customer above to instantly view sales invoices, linked purchase bills, item-wise reconciliation, price evidence, and financial metrics.
          </div>
        </div>
      )}

      {/* Customer 360 Content */}
      {!loading && customer360 && cust && kpis && (
        <>
          {/* Customer Profile Header Banner */}
          <div
            style={{
              background: "#ffffff",
              padding: 20,
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              marginBottom: 20,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 16,
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  {cust.name}
                </h2>
                {cust.isNameOnlyMatch && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "#fef3c7",
                      color: "#b45309",
                      border: "1px solid #fde68a",
                    }}
                  >
                    NAME-ONLY CUSTOMER MATCH
                  </span>
                )}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: "#f0fdf4",
                    color: "#15803d",
                    border: "1px solid #bbf7d0",
                  }}
                >
                  ✓ Local SQLite Cache
                </span>

                {/* Section 20: Action Tracker Status Indicator */}
                {customer360.reconciliation.mismatch_count > 0 ? (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: "#fef2f2",
                        color: "#dc2626",
                        border: "1px solid #fecaca",
                      }}
                    >
                      ACTION REQUIRED · Mismatch Items: {customer360.reconciliation.mismatch_count}
                    </span>
                    {onNavigateToActionTaken && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onNavigateToActionTaken(cust.id || cust.name)}
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          background: "#ffffff",
                          color: "#dc2626",
                          border: "1px solid #fca5a5",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                        title="View and track actions for this customer in Action Taken"
                      >
                        View in Action Taken →
                      </button>
                    )}
                  </div>
                ) : (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: "#f0fdf4",
                      color: "#16a34a",
                      border: "1px solid #bbf7d0",
                    }}
                  >
                    ✓ RECONCILED
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#64748b", marginTop: 6, flexWrap: "wrap" }}>
                <span><strong>Customer ID:</strong> {cust.id || "—"}</span>
                <span><strong>GSTIN:</strong> {cust.gstin || "—"}</span>
                <span><strong>Email:</strong> {cust.email || "—"}</span>
                <span><strong>Phone:</strong> {cust.phone || "—"}</span>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
              <div style={{ textAlign: "right", fontSize: 12, color: "#64748b" }}>
                <div><strong>Period:</strong> {customer360.period.financialYear}</div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>
                  {customer360.period.fromDate} to {customer360.period.toDate}
                </div>
              </div>

              {/* Customer Sync Action Buttons */}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {onNavigateToSiteMaterialReport && (
                  <button
                    type="button"
                    onClick={() => onNavigateToSiteMaterialReport(cust.id || cust.name, cust.name)}
                    className="btn btn-sm"
                    style={{ fontSize: 11, padding: "5px 12px", background: "#0f766e", color: "#ffffff", fontWeight: 700 }}
                    title="Open Customer Material Control Report for Site Engineer / Field In-Charge"
                  >
                    🏗️ Site Material Report
                  </button>
                )}
                <button
                  onClick={() => handleSyncCustomer("FORCE")}
                  disabled={syncingCustomer}
                  className="btn-secondary"
                  style={{ fontSize: 11, padding: "5px 10px", color: "#b45309", borderColor: "#fde68a", background: "#fffbeb" }}
                  title="Re-fetch documents for this customer ignoring modified time"
                >
                  {syncingCustomer ? "Syncing..." : "🔄 Force Sync Customer"}
                </button>
                <button
                  onClick={() => handleSyncCustomer("SMART")}
                  disabled={syncingCustomer}
                  className="btn btn-sm"
                  style={{ fontSize: 11, padding: "5px 12px", background: "#0f766e", color: "#ffffff", fontWeight: 600 }}
                  title="Incrementally fetch only changed documents for this customer"
                >
                  {syncingCustomer ? "Syncing..." : "⚡ Smart Sync Customer"}
                </button>
              </div>
            </div>
          </div>

          {/* Customer Sync Result Banner */}
          {customerSyncResult && (
            <div
              style={{
                background: customerSyncResult.status === "SUCCESS" ? "#f0fdf4" : customerSyncResult.status === "PARTIAL" ? "#fefce8" : "#fef2f2",
                border: `1px solid ${customerSyncResult.status === "SUCCESS" ? "#bbf7d0" : customerSyncResult.status === "PARTIAL" ? "#fef08a" : "#fecaca"}`,
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 20,
                fontSize: 12.5,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontWeight: 700, color: customerSyncResult.status === "SUCCESS" ? "#166534" : "#991b1b" }}>
                  {customerSyncResult.status === "SUCCESS" ? "✓ Customer Sync Complete" : `Customer Sync: ${customerSyncResult.status}`}
                </div>
                <div style={{ fontSize: 11.5, color: "#475569" }}>
                  API Calls Used: <strong style={{ color: "#0f172a" }}>{customerSyncResult.apiCallsUsed ?? 0}</strong>
                </div>
              </div>

              {customerSyncResult.modules && customerSyncResult.modules.length > 0 && (
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", color: "#334155", fontSize: 12 }}>
                  {customerSyncResult.modules.map((m: any) => (
                    <span key={m.module} style={{ background: "#ffffff", padding: "4px 8px", borderRadius: 4, border: "1px solid #e2e8f0" }}>
                      <strong>{m.module === "sales_invoices" ? "Invoices" : "Bills"}:</strong> {m.checked} checked, {m.newCount + m.modifiedCount} changed, {m.unchangedCount} unchanged
                    </span>
                  ))}
                </div>
              )}

              {customerSyncResult.customerPurchaseLimitationNote && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#854d0e", fontStyle: "italic" }}>
                  ℹ️ {customerSyncResult.customerPurchaseLimitationNote}
                </div>
              )}
            </div>
          )}


          {/* 8 Top KPI Cards Strip */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
              marginBottom: 24,
            }}
          >
            {/* Sales Taxable */}
            <div
              className="kpi-card"
              style={{
                background: "#ffffff",
                padding: 14,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                cursor: "pointer",
              }}
              onClick={() => setActiveTab("SALES_INVOICES")}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#2563eb", textTransform: "uppercase" }}>
                SALES TAXABLE VALUE
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                ₹{formatINR(kpis.salesTaxableValue)}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                Before GST · {kpis.salesInvoiceCount} Invoices
              </div>
            </div>

            {/* Purchase Taxable */}
            <div
              className="kpi-card"
              style={{
                background: "#ffffff",
                padding: 14,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                cursor: "pointer",
              }}
              onClick={() => setActiveTab("PURCHASE_BILLS")}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", textTransform: "uppercase" }}>
                PURCHASE TAXABLE VALUE
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                ₹{formatINR(kpis.purchaseTaxableValue)}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                Before GST · {kpis.purchaseBillCount} Bills
              </div>
            </div>

            {/* Commercial Spread */}
            <div
              className="kpi-card"
              style={{
                background: "#ffffff",
                padding: 14,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#0f766e", textTransform: "uppercase" }}>
                COMMERCIAL VALUE SPREAD
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: kpis.commercialValueSpread >= 0 ? "#0f766e" : "#dc2626",
                  marginTop: 4,
                }}
              >
                ₹{formatINR(kpis.commercialValueSpread)}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                Sales - Purchase (Reference Only)
              </div>
            </div>

            {/* Sales Invoices Count */}
            <div
              className="kpi-card"
              style={{
                background: "#ffffff",
                padding: 14,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                cursor: "pointer",
              }}
              onClick={() => setActiveTab("SALES_INVOICES")}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                SALES INVOICES
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                {kpis.salesInvoiceCount}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                Total Qty: {formatQuantity(kpis.salesQty)}
              </div>
            </div>

            {/* Purchase Bills Count */}
            <div
              className="kpi-card"
              style={{
                background: "#ffffff",
                padding: 14,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                cursor: "pointer",
              }}
              onClick={() => setActiveTab("PURCHASE_BILLS")}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                PURCHASE BILLS
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                {kpis.purchaseBillCount}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                Total Qty: {formatQuantity(kpis.purchaseQty)}
              </div>
            </div>

            {/* Total Sales Qty */}
            <div
              className="kpi-card"
              style={{
                background: "#ffffff",
                padding: 14,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                SALES QUANTITY
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                {formatQuantity(kpis.salesQty)}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                Dispatched / Billed Units
              </div>
            </div>

            {/* Total Purchase Qty */}
            <div
              className="kpi-card"
              style={{
                background: "#ffffff",
                padding: 14,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                PURCHASE QUANTITY
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                {formatQuantity(kpis.purchaseQty)}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                Procured / Received Units
              </div>
            </div>

            {/* Receivables / Balance */}
            <div
              className="kpi-card"
              style={{
                background: "#ffffff",
                padding: 14,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#d97706", textTransform: "uppercase" }}>
                SALES RECEIVABLE
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#d97706", marginTop: 4 }}>
                ₹{formatINR(kpis.salesBalanceReceivable)}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                Unpaid / Open Invoices
              </div>
            </div>
          </div>

          {/* Sub-Tabs Bar */}
          <div
            style={{
              display: "flex",
              borderBottom: "2px solid #e2e8f0",
              gap: 4,
              marginBottom: 20,
              overflowX: "auto",
            }}
          >
            {[
              { id: "OVERVIEW", label: "Overview", icon: "⊞" },
              { id: "SALES_INVOICES", label: `Sales Invoices (${customer360.salesInvoices.length})`, icon: "📄" },
              { id: "PURCHASE_BILLS", label: `Purchase Bills (${customer360.purchaseBills.length})`, icon: "📥" },
              { id: "SALES_ORDERS", label: "Sales Orders", icon: "📑" },
              { id: "PURCHASE_ORDERS", label: "Purchase Orders", icon: "📦" },
              { id: "ITEM_ANALYSIS", label: `Item Analysis (${customer360.itemAnalysis.length})`, icon: "🔍" },
              { id: "RECONCILIATION", label: "Reconciliation", icon: "⚖" },
              { id: "PRICE_HISTORY", label: "Price History", icon: "📈" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as SubTab)}
                style={{
                  padding: "10px 16px",
                  fontSize: 13,
                  fontWeight: activeTab === tab.id ? 700 : 500,
                  color: activeTab === tab.id ? "#0f766e" : "#64748b",
                  background: "transparent",
                  border: "none",
                  borderBottom: activeTab === tab.id ? "3px solid #0f766e" : "3px solid transparent",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab 1: OVERVIEW */}
          {activeTab === "OVERVIEW" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Top Row: Price Evidence & Quick Latest Docs */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
                {/* Latest Sales Price Card */}
                <div style={{ background: "#ffffff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#2563eb", textTransform: "uppercase", marginBottom: 6 }}>
                    LATEST SALES PRICE EVIDENCE
                  </div>
                  {overview?.latestSalesPriceEvidence ? (
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
                        ₹{formatINR(overview.latestSalesPriceEvidence.effective_rate)}
                      </div>
                      <div style={{ fontSize: 12, color: "#475569", marginTop: 4, fontWeight: 600 }}>
                        {overview.latestSalesPriceEvidence.item_name}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                        Invoice: {overview.latestSalesPriceEvidence.document_number} · Date: {formatDisplayDate(overview.latestSalesPriceEvidence.date)} · Qty: {overview.latestSalesPriceEvidence.quantity}
                      </div>
                      <button
                        onClick={() => openInvoiceDrawer(overview.latestSalesPriceEvidence!.document_number)}
                        style={{ marginTop: 8, fontSize: 11, padding: "4px 8px", background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
                      >
                        View Invoice Evidence
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: "#94a3b8" }}>No sales price evidence in selected period.</div>
                  )}
                </div>

                {/* Latest Purchase Price Card */}
                <div style={{ background: "#ffffff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", marginBottom: 6 }}>
                    LATEST PURCHASE PRICE EVIDENCE
                  </div>
                  {overview?.latestPurchasePriceEvidence ? (
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
                        ₹{formatINR(overview.latestPurchasePriceEvidence.effective_rate)}
                      </div>
                      <div style={{ fontSize: 12, color: "#475569", marginTop: 4, fontWeight: 600 }}>
                        {overview.latestPurchasePriceEvidence.item_name}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                        Bill: {overview.latestPurchasePriceEvidence.document_number} · Date: {formatDisplayDate(overview.latestPurchasePriceEvidence.date)} · Vendor: {overview.latestPurchasePriceEvidence.vendor_name} · Qty: {overview.latestPurchasePriceEvidence.quantity}
                      </div>
                      <button
                        onClick={() => openBillDrawer(overview.latestPurchasePriceEvidence!.document_number)}
                        style={{ marginTop: 8, fontSize: 11, padding: "4px 8px", background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
                      >
                        View Bill Evidence
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: "#94a3b8" }}>No purchase price evidence in selected period.</div>
                  )}
                </div>

                {/* Reconciliation Quick Status */}
                <div style={{ background: "#ffffff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#0f766e", textTransform: "uppercase", marginBottom: 6 }}>
                    RECONCILIATION SUMMARY
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: customer360.reconciliation.mismatch_count === 0 ? "#16a34a" : "#d97706" }}>
                    {customer360.reconciliation.mismatch_count === 0 ? "✓ 100% Fully Balanced" : `${customer360.reconciliation.mismatch_count} Items with Variance`}
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
                    Shortage: {formatQuantity(customer360.reconciliation.yet_to_purchase_qty)} Qty (₹{formatINR(customer360.reconciliation.approx_shortage_value)})
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
                    Surplus: {formatQuantity(customer360.reconciliation.yet_to_sale_qty)} Qty (₹{formatINR(customer360.reconciliation.approx_surplus_value)})
                  </div>
                  <button
                    onClick={() => setActiveTab("RECONCILIATION")}
                    style={{ marginTop: 8, fontSize: 11, padding: "4px 8px", background: "#f8fafc", color: "#475569", border: "1px solid #cbd5e1", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
                  >
                    View Reconciliation Details →
                  </button>
                </div>
              </div>

              {/* Middle Row: Top Purchased & Top Sold Items */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(450px, 1fr))", gap: 16 }}>
                {/* Top Sold Items */}
                <div style={{ background: "#ffffff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#2563eb", textTransform: "uppercase" }}>
                      TOP SOLD ITEMS
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        onClick={() => setTopItemMode("VALUE")}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: topItemMode === "VALUE" ? "#2563eb" : "#f1f5f9",
                          color: topItemMode === "VALUE" ? "#ffffff" : "#475569",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        By Value
                      </button>
                      <button
                        onClick={() => setTopItemMode("QTY")}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: topItemMode === "QTY" ? "#2563eb" : "#f1f5f9",
                          color: topItemMode === "QTY" ? "#ffffff" : "#475569",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        By Qty
                      </button>
                    </div>
                  </div>

                  <div className="table-responsive">
                    <table className="data-table" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Item Name</th>
                          <th style={{ textAlign: "right" }}>Qty</th>
                          <th style={{ textAlign: "right" }}>Taxable Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(topItemMode === "VALUE" ? overview?.topSoldByValue : overview?.topSoldByQty)?.length ? (
                          (topItemMode === "VALUE" ? overview?.topSoldByValue : overview?.topSoldByQty)!.map((it, idx) => (
                            <tr key={idx}>
                              <td style={{ fontWeight: 600 }}>{it.item_name}</td>
                              <td style={{ textAlign: "right" }}>{formatQuantity(it.qty)}</td>
                              <td style={{ textAlign: "right", fontWeight: 600, color: "#2563eb" }}>₹{formatINR(it.taxable)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr><td colSpan={3} style={{ textAlign: "center", color: "#94a3b8" }}>No sales records</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Top Purchased Items */}
                <div style={{ background: "#ffffff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#16a34a", textTransform: "uppercase" }}>
                      TOP PURCHASED ITEMS (LINKED TO CUSTOMER)
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        onClick={() => setTopItemMode("VALUE")}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: topItemMode === "VALUE" ? "#16a34a" : "#f1f5f9",
                          color: topItemMode === "VALUE" ? "#ffffff" : "#475569",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        By Value
                      </button>
                      <button
                        onClick={() => setTopItemMode("QTY")}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: topItemMode === "QTY" ? "#16a34a" : "#f1f5f9",
                          color: topItemMode === "QTY" ? "#ffffff" : "#475569",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        By Qty
                      </button>
                    </div>
                  </div>

                  <div className="table-responsive">
                    <table className="data-table" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Item Name</th>
                          <th style={{ textAlign: "right" }}>Qty</th>
                          <th style={{ textAlign: "right" }}>Taxable Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(topItemMode === "VALUE" ? overview?.topPurchasedByValue : overview?.topPurchasedByQty)?.length ? (
                          (topItemMode === "VALUE" ? overview?.topPurchasedByValue : overview?.topPurchasedByQty)!.map((it, idx) => (
                            <tr key={idx}>
                              <td style={{ fontWeight: 600 }}>{it.item_name}</td>
                              <td style={{ textAlign: "right" }}>{formatQuantity(it.qty)}</td>
                              <td style={{ textAlign: "right", fontWeight: 600, color: "#16a34a" }}>₹{formatINR(it.taxable)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr><td colSpan={3} style={{ textAlign: "center", color: "#94a3b8" }}>No purchase records</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Bottom: Activity Timeline */}
              <div style={{ background: "#ffffff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: 12 }}>
                  RECENT ACCOUNT ACTIVITY (LOCAL TIMELINE)
                </div>
                <div className="table-responsive">
                  <table className="data-table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 100 }}>Date</th>
                        <th style={{ width: 120 }}>Type</th>
                        <th style={{ width: 140 }}>Document No.</th>
                        <th>Party / Details</th>
                        <th style={{ textAlign: "right" }}>Qty</th>
                        <th style={{ textAlign: "right" }}>Taxable Value</th>
                        <th style={{ textAlign: "center", width: 90 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customer360.activityTimeline.slice(0, 10).map((ev, idx) => (
                        <tr key={idx}>
                          <td>{formatDisplayDate(ev.date)}</td>
                          <td>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: ev.type === "SALES_INVOICE" ? "#eff6ff" : "#f0fdf4",
                                color: ev.type === "SALES_INVOICE" ? "#2563eb" : "#16a34a",
                                border: `1px solid ${ev.type === "SALES_INVOICE" ? "#bfdbfe" : "#bbf7d0"}`,
                              }}
                            >
                              {ev.type === "SALES_INVOICE" ? "SALES INVOICE" : "PURCHASE BILL"}
                            </span>
                          </td>
                          <td style={{ fontFamily: "monospace", fontWeight: 700 }}>
                            <button
                              onClick={() => (ev.type === "SALES_INVOICE" ? openInvoiceDrawer(ev.document_number) : openBillDrawer(ev.document_number))}
                              style={{ background: "none", border: "none", color: "#0f766e", cursor: "pointer", textDecoration: "underline", padding: 0, fontWeight: 700 }}
                            >
                              {ev.document_number}
                            </button>
                          </td>
                          <td>{ev.party_name}</td>
                          <td style={{ textAlign: "right" }}>{formatQuantity(ev.quantity)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>₹{formatINR(ev.taxable_value)}</td>
                          <td style={{ textAlign: "center" }}>
                            <span className="badge-enabled">{ev.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: SALES INVOICES */}
          {activeTab === "SALES_INVOICES" && (
            <div style={{ background: "#ffffff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                  Sales Invoices for {cust.name} ({customer360.salesInvoices.length} Invoices)
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  Total Taxable: <strong>₹{formatINR(kpis.salesTaxableValue)}</strong> · Total Balance: <strong>₹{formatINR(kpis.salesBalanceReceivable)}</strong>
                </div>
              </div>

              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 40, textAlign: "center" }}>Sr.</th>
                      <th style={{ width: 95 }}>Date</th>
                      <th style={{ width: 140 }}>Invoice No.</th>
                      <th style={{ width: 95 }}>Due Date</th>
                      <th style={{ width: 85, textAlign: "center" }}>Status</th>
                      <th style={{ textAlign: "right", width: 60 }}>Items</th>
                      <th style={{ textAlign: "right", width: 80 }}>Qty</th>
                      <th style={{ textAlign: "right", width: 120 }}>Taxable Value</th>
                      <th style={{ textAlign: "right", width: 120 }}>Grand Total</th>
                      <th style={{ textAlign: "right", width: 110 }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer360.salesInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ textAlign: "center", padding: 36, color: "#94a3b8" }}>
                          No sales invoices found for this customer in selected period.
                        </td>
                      </tr>
                    ) : (
                      customer360.salesInvoices.map((inv, idx) => (
                        <tr
                          key={inv.invoice_id}
                          onClick={() => openInvoiceDrawer(inv.invoice_number)}
                          style={{ cursor: "pointer" }}
                        >
                          <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                          <td>{formatDisplayDate(inv.date)}</td>
                          <td style={{ fontFamily: "monospace", fontWeight: 700 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ color: "#0f766e", textDecoration: "underline" }}>{inv.invoice_number}</span>
                              {inv.invoice_url && (
                                <a
                                  href={inv.invoice_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ color: "#94a3b8", textDecoration: "none", fontSize: 11 }}
                                  title="Open in Zoho Books ↗"
                                >
                                  ↗
                                </a>
                              )}
                            </div>
                          </td>
                          <td>{inv.due_date ? formatDisplayDate(inv.due_date) : "—"}</td>
                          <td style={{ textAlign: "center" }}>
                            <span className="badge-enabled">{inv.status}</span>
                          </td>
                          <td style={{ textAlign: "right" }}>{inv.item_count}</td>
                          <td style={{ textAlign: "right" }}>{formatQuantity(inv.total_qty)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>₹{formatINR(inv.taxable_value)}</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(inv.grand_total)}</td>
                          <td style={{ textAlign: "right", color: inv.balance > 0 ? "#d97706" : "#64748b", fontWeight: inv.balance > 0 ? 600 : 400 }}>
                            ₹{formatINR(inv.balance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 3: PURCHASE BILLS */}
          {activeTab === "PURCHASE_BILLS" && (
            <div style={{ background: "#ffffff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    Purchase Bills with Line Customer: {cust.name} ({customer360.purchaseBills.length} Bills)
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    Matching line customer details · Customer Taxable reflects only this customer&apos;s lines
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  Customer Taxable: <strong>₹{formatINR(kpis.purchaseTaxableValue)}</strong> · Matching Qty: <strong>{formatQuantity(kpis.purchaseQty)}</strong>
                </div>
              </div>

              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 40, textAlign: "center" }}>Sr.</th>
                      <th style={{ width: 95 }}>Date</th>
                      <th style={{ width: 140 }}>Bill No.</th>
                      <th>Vendor</th>
                      <th style={{ width: 85, textAlign: "center" }}>Status</th>
                      <th style={{ textAlign: "right", width: 80 }}>Match Items</th>
                      <th style={{ textAlign: "right", width: 80 }}>Match Qty</th>
                      <th style={{ textAlign: "right", width: 130 }}>Customer Taxable</th>
                      <th style={{ textAlign: "right", width: 120 }}>Source Total</th>
                      <th style={{ textAlign: "right", width: 110 }}>Source Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer360.purchaseBills.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ textAlign: "center", padding: 36, color: "#94a3b8" }}>
                          No purchase bills found linked to this customer in selected period.
                        </td>
                      </tr>
                    ) : (
                      customer360.purchaseBills.map((b, idx) => (
                        <tr
                          key={b.bill_id}
                          onClick={() => openBillDrawer(b.bill_number)}
                          style={{ cursor: "pointer" }}
                        >
                          <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                          <td>{formatDisplayDate(b.date)}</td>
                          <td style={{ fontFamily: "monospace", fontWeight: 700 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ color: "#0f766e", textDecoration: "underline" }}>{b.bill_number}</span>
                              {b.bill_url && (
                                <a
                                  href={b.bill_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ color: "#94a3b8", textDecoration: "none", fontSize: 11 }}
                                  title="Open in Zoho Books ↗"
                                >
                                  ↗
                                </a>
                              )}
                            </div>
                          </td>
                          <td>{b.vendor_name}</td>
                          <td style={{ textAlign: "center" }}>
                            <span className="badge-enabled">{b.status}</span>
                          </td>
                          <td style={{ textAlign: "right" }}>{b.matching_item_count}</td>
                          <td style={{ textAlign: "right" }}>{formatQuantity(b.matching_qty)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600, color: "#16a34a" }}>₹{formatINR(b.customer_taxable_value)}</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(b.source_grand_total)}</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(b.source_balance)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 4: SALES ORDERS */}
          {activeTab === "SALES_ORDERS" && (
            <div style={{ background: "#ffffff", padding: 48, borderRadius: 8, border: "1px dashed #cbd5e1", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📑</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b", marginBottom: 6 }}>
                Sales Order data is not available in the current local cache.
              </div>
              <div style={{ fontSize: 13, color: "#64748b", maxWidth: 500, margin: "0 auto" }}>
                Current approved OAuth scopes and local SQLite database do not store Sales Orders. No fake order data is fabricated.
              </div>
            </div>
          )}

          {/* Tab 5: PURCHASE ORDERS */}
          {activeTab === "PURCHASE_ORDERS" && (
            <div style={{ background: "#ffffff", padding: 48, borderRadius: 8, border: "1px dashed #cbd5e1", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b", marginBottom: 6 }}>
                Purchase Order data is not available in the current local cache.
              </div>
              <div style={{ fontSize: 13, color: "#64748b", maxWidth: 500, margin: "0 auto" }}>
                Current approved OAuth scopes and local SQLite database do not store Purchase Orders. No fake order data is fabricated.
              </div>
            </div>
          )}

          {/* Tab 6: ITEM ANALYSIS */}
          {activeTab === "ITEM_ANALYSIS" && (
            <div style={{ background: "#ffffff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                  Item-wise Purchase & Sales Analysis ({customer360.itemAnalysis.length} Items)
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  Grain: Customer ID + Item ID · All Rates are Quantity-Weighted Effective Pre-GST Rates
                </div>
              </div>

              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 35, textAlign: "center" }}>#</th>
                      <th>Item Name</th>
                      <th style={{ width: 80 }}>SKU</th>
                      <th style={{ textAlign: "right", width: 65 }}>P.Qty</th>
                      <th style={{ textAlign: "right", width: 90 }}>P.Taxable</th>
                      <th style={{ textAlign: "right", width: 80 }}>P.Avg</th>
                      <th style={{ textAlign: "right", width: 80 }}>Latest P.Rate</th>
                      <th style={{ textAlign: "right", width: 65 }}>S.Qty</th>
                      <th style={{ textAlign: "right", width: 90 }}>S.Taxable</th>
                      <th style={{ textAlign: "right", width: 80 }}>S.Avg</th>
                      <th style={{ textAlign: "right", width: 80 }}>Latest S.Rate</th>
                      <th style={{ textAlign: "right", width: 65 }}>Balance</th>
                      <th style={{ textAlign: "right", width: 75 }}>Yet to Purch</th>
                      <th style={{ textAlign: "right", width: 70 }}>Recon Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer360.itemAnalysis.length === 0 ? (
                      <tr>
                        <td colSpan={14} style={{ textAlign: "center", padding: 36, color: "#94a3b8" }}>
                          No item records found for this customer.
                        </td>
                      </tr>
                    ) : (
                      customer360.itemAnalysis.map((it, idx) => (
                        <tr key={it.item_id || idx}>
                          <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                          <td style={{ fontWeight: 600 }}>{it.item_name}</td>
                          <td style={{ color: "#64748b", fontSize: 11 }}>{it.sku || "—"}</td>
                          <td style={{ textAlign: "right" }}>{formatQuantity(it.purchase_qty)}</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(it.purchase_taxable)}</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(it.purchase_avg_rate)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600, color: "#16a34a" }}>
                            {it.latest_purchase_rate > 0 ? `₹${formatINR(it.latest_purchase_rate)}` : "—"}
                          </td>
                          <td style={{ textAlign: "right" }}>{formatQuantity(it.sales_qty)}</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(it.sales_taxable)}</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(it.sales_avg_rate)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600, color: "#2563eb" }}>
                            {it.latest_sales_rate > 0 ? `₹${formatINR(it.latest_sales_rate)}` : "—"}
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              fontWeight: 700,
                              color: it.balance_qty === 0 ? "#16a34a" : it.balance_qty > 0 ? "#d97706" : "#dc2626",
                            }}
                          >
                            {formatQuantity(it.balance_qty)}
                          </td>
                          <td style={{ textAlign: "right", color: it.yet_to_purchase > 0 ? "#dc2626" : "#64748b" }}>
                            {formatQuantity(it.yet_to_purchase)}
                          </td>
                          <td style={{ textAlign: "right", color: "#16a34a" }}>{formatQuantity(it.reconciled_qty)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 7: RECONCILIATION */}
          {activeTab === "RECONCILIATION" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Recon KPI Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <div style={{ background: "#ffffff", padding: 14, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                    TOTAL PURCHASE QTY
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#16a34a", marginTop: 4 }}>
                    {formatQuantity(customer360.reconciliation.purchase_qty)}
                  </div>
                </div>

                <div style={{ background: "#ffffff", padding: 14, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                    TOTAL SALES QTY
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#2563eb", marginTop: 4 }}>
                    {formatQuantity(customer360.reconciliation.sales_qty)}
                  </div>
                </div>

                <div style={{ background: "#ffffff", padding: 14, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", textTransform: "uppercase" }}>
                    YET TO PURCHASE (SHORTAGE)
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#dc2626", marginTop: 4 }}>
                    {formatQuantity(customer360.reconciliation.yet_to_purchase_qty)}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    Approx Valuation: ₹{formatINR(customer360.reconciliation.approx_shortage_value)}
                  </div>
                </div>

                <div style={{ background: "#ffffff", padding: 14, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#d97706", textTransform: "uppercase" }}>
                    YET TO SALE (SURPLUS)
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#d97706", marginTop: 4 }}>
                    {formatQuantity(customer360.reconciliation.yet_to_sale_qty)}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    Approx Valuation: ₹{formatINR(customer360.reconciliation.approx_surplus_value)}
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div style={{ background: "#ffffff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                      Reconciliation Valuation Breakdown (Approved Latest Actual Purchase Rate Hierarchy)
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                      Click any item row to open transaction breakdown, view rate evidence, or exclude item.
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {loadingBreakdown && (
                      <span style={{ fontSize: 11, color: "#2563eb", fontWeight: 600 }}>
                        Loading Breakdown...
                      </span>
                    )}
                    {onCreateCompositeAssembly && (
                      <button
                        type="button"
                        onClick={() => onCreateCompositeAssembly(customer360.customer.id, customer360.customer.name)}
                        className="btn btn-sm btn-primary"
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, padding: "5px 12px" }}
                      >
                        <span style={{ fontSize: 13 }}>🧩</span>
                        <span>Create Composite Assembly</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th style={{ textAlign: "right" }}>Purchase Qty</th>
                        <th style={{ textAlign: "right" }}>Sales Qty</th>
                        <th style={{ textAlign: "right" }}>Balance</th>
                        <th style={{ textAlign: "right" }}>Shortage</th>
                        <th style={{ textAlign: "right" }}>Surplus</th>
                        <th style={{ textAlign: "right" }}>Latest Rate</th>
                        <th style={{ textAlign: "right" }}>Shortage Value</th>
                        <th style={{ textAlign: "right" }}>Surplus Value</th>
                        <th style={{ textAlign: "center" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customer360.itemAnalysis.map((it, idx) => {
                        const isShortage = it.yet_to_purchase > 0;
                        const isSurplus = it.yet_to_sale > 0;
                        const hasRate = it.latest_purchase_rate > 0;

                        // Status badge colors
                        let badgeBg = "#f1f5f9";
                        let badgeColor = "#475569";
                        const statusText = it.status || "BALANCED";

                        if (statusText === "RECONCILED" || statusText === "BALANCED") {
                          badgeBg = "#dcfce7";
                          badgeColor = "#15803d";
                        } else if (statusText.includes("SHORTAGE") || statusText.includes("YET TO PURCHASE")) {
                          badgeBg = "#fee2e2";
                          badgeColor = "#b91c1c";
                        } else if (statusText.includes("SURPLUS") || statusText.includes("YET TO SALE")) {
                          badgeBg = "#fef3c7";
                          badgeColor = "#b45309";
                        } else if (statusText === "PURCHASE ONLY") {
                          badgeBg = "#e0e7ff";
                          badgeColor = "#3730a3";
                        } else if (statusText === "SALES ONLY") {
                          badgeBg = "#fce7f3";
                          badgeColor = "#9d174d";
                        }

                        return (
                          <tr
                            key={idx}
                            onClick={() => handleOpenBreakdown(customer360.customer.id, it.item_id || it.item_name)}
                            style={{
                              cursor: "pointer",
                              transition: "background-color 0.15s ease",
                            }}
                            className="clickable-row hover:bg-slate-50"
                          >
                            <td style={{ fontWeight: 600 }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedItemForDetail({
                                      itemId: it.item_id || it.item_name,
                                      itemName: it.item_name,
                                      customerId: customer360.customer.id,
                                      customerName: customer360.customer.name,
                                    });
                                  }}
                                  style={{
                                    color: "#2563eb",
                                    cursor: "pointer",
                                    textDecoration: "underline",
                                    textUnderlineOffset: 2,
                                  }}
                                  title="Click to open Item Detail drawer"
                                >
                                  {it.item_name}
                                </span>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  {it.sku && (
                                    <span style={{ fontSize: 10, color: "#64748b", fontFamily: "monospace" }}>
                                      SKU: {it.sku}
                                    </span>
                                  )}
                                  {it.is_composite_assembled && (
                                    <span
                                      style={{
                                        fontSize: 9.5,
                                        padding: "1px 5px",
                                        borderRadius: 4,
                                        background: "#e0f2fe",
                                        color: "#0369a1",
                                        border: "1px solid #bae6fd",
                                        fontWeight: 600,
                                      }}
                                    >
                                      🧩 Local Composite Assembly (+{it.assembly_generated_qty} BUN)
                                    </span>
                                  )}
                                  {it.is_component_consumed && (
                                    <span
                                      style={{
                                        fontSize: 9.5,
                                        padding: "1px 5px",
                                        borderRadius: 4,
                                        background: "#fef3c7",
                                        color: "#92400e",
                                        border: "1px solid #fde68a",
                                        fontWeight: 600,
                                      }}
                                    >
                                      ⚙️ Assembly Consumed (-{it.assembly_consumed_qty})
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                                <span style={{ fontWeight: it.is_composite_assembled || it.is_component_consumed ? 700 : 400 }}>
                                  {formatQuantity(it.purchase_qty)}
                                </span>
                                {(it.is_composite_assembled || it.is_component_consumed) && (
                                  <span style={{ fontSize: 9, color: "#64748b" }}>
                                    Raw: {formatQuantity(it.raw_purchase_qty ?? it.purchase_qty)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ textAlign: "right" }}>{formatQuantity(it.sales_qty)}</td>
                            <td
                              style={{
                                textAlign: "right",
                                fontWeight: 700,
                                color: it.balance_qty === 0 ? "#16a34a" : it.balance_qty > 0 ? "#d97706" : "#dc2626",
                              }}
                            >
                              {formatQuantity(it.balance_qty)}
                            </td>
                            <td style={{ textAlign: "right", color: isShortage ? "#dc2626" : "#64748b", fontWeight: isShortage ? 600 : 400 }}>
                              {formatQuantity(it.yet_to_purchase)}
                            </td>
                            <td style={{ textAlign: "right", color: isSurplus ? "#d97706" : "#64748b", fontWeight: isSurplus ? 600 : 400 }}>
                              {formatQuantity(it.yet_to_sale)}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {hasRate ? (
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                                  <span style={{ fontWeight: 600 }}>₹{formatINR(it.latest_purchase_rate)}</span>
                                  {it.latest_purchase_doc && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openBillDrawer(it.latest_purchase_bill_id || it.latest_purchase_doc!);
                                      }}
                                      style={{
                                        fontSize: 10,
                                        color: "#2563eb",
                                        background: "#eff6ff",
                                        border: "1px solid #bfdbfe",
                                        borderRadius: 4,
                                        padding: "1px 5px",
                                        cursor: "pointer",
                                        whiteSpace: "nowrap",
                                      }}
                                      title={`View Rate Evidence: Bill ${it.latest_purchase_doc} (${it.latest_purchase_basis || "Latest Purchase"})`}
                                    >
                                      📄 Bill {it.latest_purchase_doc}
                                    </button>
                                  )}
                                </div>
                              ) : isShortage ? (
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                                  <span style={{ color: "#dc2626", fontWeight: 600 }} title="No valid actual purchase reference found">N/A</span>
                                  <span style={{ fontSize: 9, color: "#94a3b8" }}>No ref rate</span>
                                </div>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 600, color: isShortage ? "#dc2626" : "#64748b" }}>
                              {isShortage ? (
                                hasRate ? (
                                  `₹${formatINR(it.shortage_value ?? (it.yet_to_purchase * it.latest_purchase_rate))}`
                                ) : (
                                  <span style={{ color: "#dc2626" }} title="No valid actual purchase reference found">N/A</span>
                                )
                              ) : (
                                "—"
                              )}
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 600, color: isSurplus ? "#d97706" : "#64748b" }}>
                              {isSurplus ? (
                                hasRate ? (
                                  `₹${formatINR(it.surplus_value ?? (it.yet_to_sale * it.latest_purchase_rate))}`
                                ) : (
                                  "—"
                                )
                              ) : (
                                "—"
                              )}
                            </td>
                            <td style={{ textAlign: "center" }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: "2px 8px",
                                  borderRadius: 12,
                                  background: badgeBg,
                                  color: badgeColor,
                                  textTransform: "uppercase",
                                  letterSpacing: "0.02em",
                                }}
                              >
                                {statusText}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Tab 8: PRICE HISTORY */}
          {activeTab === "PRICE_HISTORY" && (
            <div style={{ background: "#ffffff", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 12 }}>
                Historical Price Evidence for {cust.name} ({customer360.priceHistory?.history?.length || 0} Transactions)
              </div>
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 35, textAlign: "center" }}>#</th>
                      <th style={{ width: 90 }}>Date</th>
                      <th style={{ width: 70, textAlign: "center" }}>Type</th>
                      <th style={{ width: 130 }}>Doc No.</th>
                      <th>Item Name</th>
                      <th>Description</th>
                      <th style={{ textAlign: "right", width: 65 }}>Qty</th>
                      <th style={{ textAlign: "right", width: 85 }}>Effective Rate</th>
                      <th style={{ textAlign: "right", width: 100 }}>Taxable Value</th>
                      <th style={{ textAlign: "center", width: 90 }}>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!customer360.priceHistory?.history || customer360.priceHistory.history.length === 0) ? (
                      <tr>
                        <td colSpan={10} style={{ textAlign: "center", padding: 36, color: "#94a3b8" }}>
                          No price history records found for this customer.
                        </td>
                      </tr>
                    ) : (
                      customer360.priceHistory.history.map((h: any, idx: number) => (
                        <tr key={idx}>
                          <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                          <td>{formatDisplayDate(h.date)}</td>
                          <td style={{ textAlign: "center" }}>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: h.type === "PURCHASE" ? "#f0fdf4" : "#eff6ff",
                                color: h.type === "PURCHASE" ? "#16a34a" : "#2563eb",
                                border: `1px solid ${h.type === "PURCHASE" ? "#bbf7d0" : "#bfdbfe"}`,
                              }}
                            >
                              {h.type}
                            </span>
                          </td>
                          <td style={{ fontFamily: "monospace", fontWeight: 700 }}>
                            {h.document_number}
                          </td>
                          <td style={{ fontWeight: 600 }}>{h.item_name}</td>
                          <td style={{ color: "#64748b", fontSize: 11 }}>{h.description || "—"}</td>
                          <td style={{ textAlign: "right" }}>{formatQuantity(h.quantity)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>₹{formatINR(h.effective_rate)}</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(h.line_taxable_amount)}</td>
                          <td style={{ textAlign: "center" }}>
                            <button
                              onClick={() => (h.type === "PURCHASE" ? openBillDrawer(h.document_number) : openInvoiceDrawer(h.document_number))}
                              style={{
                                fontSize: 11,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: "#f1f5f9",
                                border: "1px solid #cbd5e1",
                                cursor: "pointer",
                                fontWeight: 600,
                                color: "#0f766e",
                              }}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Embedded Document Detail Drawer */}
      {selectedDoc && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(2px)",
            zIndex: 9999,
            display: "flex",
            justifyContent: "flex-end",
          }}
          onClick={() => setSelectedDoc(null)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 750,
              height: "100%",
              backgroundColor: "#ffffff",
              boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
              display: "flex",
              flexDirection: "column",
              overflowY: "auto",
              position: "relative",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div
              style={{
                padding: "16px 24px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                backgroundColor: "#f8fafc",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                    {selectedDoc.bill_number ? `Purchase Bill: ${selectedDoc.bill_number}` : `Sales Invoice: ${selectedDoc.invoice_number}`}
                  </h3>
                  <span className="badge-enabled">{selectedDoc.status || "SAVED"}</span>
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                  Date: <strong>{formatDisplayDate(selectedDoc.date)}</strong>
                  {selectedDoc.due_date && (
                    <> · Due: <strong>{formatDisplayDate(selectedDoc.due_date)}</strong></>
                  )}
                  {" · Local SQLite Cache"}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {(selectedDoc.bill_url || selectedDoc.invoice_url) && (
                  <a
                    href={selectedDoc.bill_url || selectedDoc.invoice_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 12,
                      color: "#0f766e",
                      textDecoration: "none",
                      padding: "4px 8px",
                      borderRadius: 4,
                      border: "1px solid #ccfbf1",
                      backgroundColor: "#f0fdfa",
                      fontWeight: 600,
                    }}
                  >
                    Zoho Books ↗
                  </a>
                )}
                <button
                  onClick={() => setSelectedDoc(null)}
                  style={{
                    border: "none",
                    background: "none",
                    fontSize: 20,
                    cursor: "pointer",
                    color: "#64748b",
                    padding: "4px 8px",
                  }}
                  title="Close (Esc)"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Drawer KPI Header Strip (4 Cards) */}
            <div
              style={{
                padding: 16,
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 8,
                backgroundColor: "#f1f5f9",
                borderBottom: "1px solid #e2e8f0",
              }}
            >
              <div style={{ background: "#ffffff", padding: 10, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  {selectedDoc.vendor_name ? "VENDOR" : "CUSTOMER"}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selectedDoc.vendor_name || selectedDoc.customer_name || "—"}
                </div>
              </div>

              <div style={{ background: "#ffffff", padding: 10, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  TAXABLE VALUE (PRE-GST)
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f766e", marginTop: 2 }}>
                  ₹{formatINR(selectedDoc.taxableTotal || 0)}
                </div>
              </div>

              <div style={{ background: "#ffffff", padding: 10, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  GRAND TOTAL (WITH GST)
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
                  ₹{formatINR(selectedDoc.grand_total || 0)}
                </div>
              </div>

              <div style={{ background: "#ffffff", padding: 10, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  BALANCE
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: selectedDoc.balance ? "#d97706" : "#16a34a", marginTop: 2 }}>
                  ₹{formatINR(selectedDoc.balance || 0)}
                </div>
              </div>
            </div>

            {/* Line Items Table */}
            <div style={{ padding: 16, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: 8 }}>
                LINE ITEMS ({selectedDoc.lines?.length || 0})
              </div>

              <div className="table-responsive">
                <table className="data-table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 30, textAlign: "center" }}>#</th>
                      <th>Item Name & Description</th>
                      {selectedDoc.bill_number && <th>Customer Details</th>}
                      <th style={{ textAlign: "right", width: 60 }}>Qty</th>
                      <th style={{ textAlign: "right", width: 80 }}>Rate</th>
                      <th style={{ textAlign: "right", width: 90 }}>Taxable Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDoc.lines?.map((line, idx) => (
                      <tr key={line.line_item_id || idx}>
                        <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                        <td>
                          <div style={{ fontWeight: 600, color: "#0f172a" }}>{line.item_name}</div>
                          {line.sku && <div style={{ fontSize: 10, color: "#64748b" }}>SKU: {line.sku}</div>}
                          {line.description && <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{line.description}</div>}
                        </td>
                        {selectedDoc.bill_number && (
                          <td style={{ fontSize: 11, color: "#0f766e", fontWeight: 600 }}>
                            {line.customer_details || line.purchase_line_customer_name || line.bbt_customer_name || "—"}
                          </td>
                        )}
                        <td style={{ textAlign: "right" }}>{formatQuantity(line.quantity)}</td>
                        <td style={{ textAlign: "right" }}>₹{formatINR(line.rate)}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>₹{formatINR(line.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Drawer Footer Totals */}
              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  backgroundColor: "#f8fafc",
                  borderRadius: 6,
                  border: "1px solid #e2e8f0",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  alignItems: "flex-end",
                  fontSize: 12,
                }}
              >
                <div>Pre-GST Taxable Subtotal: <strong>₹{formatINR(selectedDoc.taxableTotal || 0)}</strong></div>
                {selectedDoc.taxAmount !== undefined && (
                  <div>GST Tax Amount: <strong>₹{formatINR(selectedDoc.taxAmount)}</strong></div>
                )}
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", borderTop: "1px solid #cbd5e1", paddingTop: 4, marginTop: 2 }}>
                  Document Grand Total: ₹{formatINR(selectedDoc.grand_total || 0)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Breakdown Details Drawer */}
      <DetailsDrawer
        item={drilldownItem}
        financialYear={period || "ALL"}
        onClose={() => setDrilldownItem(null)}
        onOpenBill={openBillDrawer}
        onOpenInvoice={openInvoiceDrawer}
        onExclusionSuccess={() => {
          setDrilldownItem(null);
          fetchCustomer360();
          fetchCustomerList();
        }}
      />

      {/* Single Item Detail Drawer */}
      {selectedItemForDetail && (
        <ItemDetailDrawer
          itemId={selectedItemForDetail.itemId}
          itemName={selectedItemForDetail.itemName}
          financialYear={period || "ALL"}
          initialCustomerId={selectedItemForDetail.customerId}
          initialCustomerName={selectedItemForDetail.customerName}
          onClose={() => setSelectedItemForDetail(null)}
          onOpenBill={openBillDrawer}
          onOpenInvoice={openInvoiceDrawer}
          onExclusionSuccess={() => {
            setSelectedItemForDetail(null);
            fetchCustomer360();
            fetchCustomerList();
          }}
        />
      )}

      {/* Selective Sync Modal */}
      <SelectiveSyncModal
        isOpen={showSelectiveSyncModal}
        onClose={() => setShowSelectiveSyncModal(false)}
        initialCustomerId={customer360?.customer.id}
        initialCustomerName={customer360?.customer.name}
        onSyncCompleted={(result) => {
          setCustomerSyncResult(result);
          fetchCustomer360();
          fetchCustomerList();
        }}
      />

      {/* Dynamic Export Field Selector Modal */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        reportType="customer-details"
        totalRecords={customer360?.itemAnalysis?.length}
        onExport={handleExport}
      />
    </div>
  );
}


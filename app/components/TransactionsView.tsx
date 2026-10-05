import React, { useState, useEffect, useCallback, useMemo } from "react";
import { formatINR, formatQuantity, formatDisplayDate } from "@/app/lib/date-utils";
import { deduplicateFilterOptions } from "@/app/lib/dropdown-utils";
import { ExportDialog } from "./ExportDialog";
import { SelectiveSyncModal } from "./SelectiveSyncModal";
import type { ExportOptions } from "@/app/types/reconciliation";

interface TransactionsViewProps {
  type: "bills" | "invoices" | "detail";
  financialYear: string;
  searchQuery?: string;
  customerId?: string;
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

export function TransactionsView({
  type,
  financialYear,
  searchQuery = "",
  customerId = "",
}: TransactionsViewProps) {
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [showExportDialog, setShowExportDialog] = useState<boolean>(false);

  // Section-wise Sync States
  const [syncingSection, setSyncingSection] = useState<boolean>(false);
  const [sectionSyncResult, setSectionSyncResult] = useState<any | null>(null);
  const [showSelectiveSyncModal, setShowSelectiveSyncModal] = useState<boolean>(false);

  // Document Detail Drawer State
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
  const [loadingDocDetail, setLoadingDocDetail] = useState<boolean>(false);


  // Esc key listener to close drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedDoc(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Filters
  const [period, setPeriod] = useState<string>(financialYear);
  const [isCustomDate, setIsCustomDate] = useState<boolean>(false);
  const [fromDate, setFromDate] = useState<string>("2026-04-01");
  const [toDate, setToDate] = useState<string>("2026-09-11");
  const [search, setSearch] = useState<string>(searchQuery);
  const [selectedCustomer, setSelectedCustomer] = useState<string>(customerId);
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<string>("");
  const [txType, setTxType] = useState<string>("ALL");

  // Options for dropdowns
  const [vendors, setVendors] = useState<{ id: string; name: string; sku?: string }[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string; sku?: string }[]>([]);
  const [items, setItems] = useState<{ id: string; name: string; sku?: string }[]>([]);

  // De-duplicated options by authoritative stable ID
  const uniqueVendors = useMemo(() => deduplicateFilterOptions(vendors), [vendors]);
  const uniqueCustomers = useMemo(() => deduplicateFilterOptions(customers), [customers]);
  const uniqueItems = useMemo(() => deduplicateFilterOptions(items), [items]);

  useEffect(() => {
    setPeriod(financialYear);
  }, [financialYear]);

  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("type", type);
      params.set("financialYear", period);

      if (isCustomDate && fromDate && toDate) {
        params.set("fromDate", fromDate);
        params.set("toDate", toDate);
      }
      if (search) params.set("search", search);
      if (selectedCustomer) params.set("customerId", selectedCustomer);
      if (selectedVendor) params.set("vendorId", selectedVendor);
      if (selectedItem) params.set("itemId", selectedItem);
      if (type === "detail") params.set("txType", txType);

      const res = await fetch(`/api/transactions?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (type === "bills") {
          setData(json.bills || []);
          setTotals(json.totals || {});
          if (json.filterOptions) {
            const newV = json.filterOptions.vendors || [];
            const newC = json.filterOptions.customers || [];
            const newI = json.filterOptions.items || [];
            setVendors(newV);
            setCustomers(newC);
            setItems(newI);
            if (selectedVendor && !newV.some((v: any) => v.id === selectedVendor || v.name === selectedVendor)) {
              setSelectedVendor("");
            }
            if (selectedCustomer && !newC.some((c: any) => c.id === selectedCustomer || c.name === selectedCustomer)) {
              setSelectedCustomer("");
            }
            if (selectedItem && !newI.some((i: any) => i.id === selectedItem || i.name === selectedItem)) {
              setSelectedItem("");
            }
          }
        } else if (type === "invoices") {
          setData(json.invoices || []);
          setTotals(json.totals || {});
          if (json.filterOptions) {
            const newC = json.filterOptions.customers || [];
            const newI = json.filterOptions.items || [];
            setCustomers(newC);
            setItems(newI);
            if (selectedCustomer && !newC.some((c: any) => c.id === selectedCustomer || c.name === selectedCustomer)) {
              setSelectedCustomer("");
            }
            if (selectedItem && !newI.some((i: any) => i.id === selectedItem || i.name === selectedItem)) {
              setSelectedItem("");
            }
          }
        } else if (type === "detail") {
          setData(json.transactionDetails || []);
          setTotals(json.totals || {});
          if (json.filterOptions) {
            const newC = json.filterOptions.customers || [];
            const newV = json.filterOptions.vendors || [];
            const newI = json.filterOptions.items || [];
            setCustomers(newC);
            setVendors(newV);
            setItems(newI);
            if (selectedCustomer && !newC.some((c: any) => c.id === selectedCustomer || c.name === selectedCustomer)) {
              setSelectedCustomer("");
            }
            if (selectedVendor && !newV.some((v: any) => v.id === selectedVendor || v.name === selectedVendor)) {
              setSelectedVendor("");
            }
            if (selectedItem && !newI.some((i: any) => i.id === selectedItem || i.name === selectedItem)) {
              setSelectedItem("");
            }
          }
        }
      }
    } catch {
      // offline fallback
    } finally {
      setLoading(false);
    }
  }, [type, period, isCustomDate, fromDate, toDate, search, selectedCustomer, selectedVendor, selectedItem, txType]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const handlePeriodChange = (val: string) => {
    setPeriod(val);
    if (val === "CUSTOM") {
      setIsCustomDate(true);
    } else {
      setIsCustomDate(false);
    }
  };

  const handleRowClick = async (row: Record<string, unknown>) => {
    if (type === "bills" && row.bill_id) {
      try {
        setLoadingDocDetail(true);
        const res = await fetch(`/api/transactions?type=bill-detail&docId=${encodeURIComponent(String(row.bill_id))}`);
        if (res.ok) {
          const json = await res.json();
          setSelectedDoc(json.document);
        }
      } catch (err) {
        console.error("Failed to load bill detail:", err);
      } finally {
        setLoadingDocDetail(false);
      }
    } else if (type === "invoices" && row.invoice_id) {
      try {
        setLoadingDocDetail(true);
        const res = await fetch(`/api/transactions?type=invoice-detail&docId=${encodeURIComponent(String(row.invoice_id))}`);
        if (res.ok) {
          const json = await res.json();
          setSelectedDoc(json.document);
        }
      } catch (err) {
        console.error("Failed to load invoice detail:", err);
      } finally {
        setLoadingDocDetail(false);
      }
    }
  };

  const handleExecuteExport = async (options: ExportOptions) => {
    const params = new URLSearchParams({
      type,
      reportType: type,
      period,
      financialYear: isCustomDate ? "CUSTOM" : period,
      fromDate: isCustomDate ? fromDate : "",
      toDate: isCustomDate ? toDate : "",
      customerId: selectedCustomer,
      vendorName: selectedVendor,
      itemId: selectedItem,
      txType,
      search,
      includeTotals: options.includeTotals ? "true" : "false",
    });
    if (options.selectedFields && options.selectedFields.length > 0) {
      params.set("selectedFields", options.selectedFields.join(","));
    }
    const endpoint = options.format === "pdf" ? "/api/export/pdf" : "/api/export/excel";
    const res = await fetch(`${endpoint}?${params.toString()}`);
    if (!res.ok) throw new Error("Transaction export failed");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Bansil_${type}_${period}_${new Date().toISOString().slice(0, 10)}.${options.format === "pdf" ? "pdf" : "xlsx"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleResetFilters = () => {
    setSearch("");
    setSelectedCustomer("");
    setSelectedVendor("");
    setSelectedItem("");
    setTxType("ALL");
    setIsCustomDate(false);
    setPeriod(financialYear);
  };

  const handleSyncCurrentSection = async (mode: "SMART" | "FORCE" = "SMART") => {
    const targetModule = type === "bills" ? "purchase_bills" : type === "invoices" ? "sales_invoices" : "all";
    try {
      setSyncingSection(true);
      setSectionSyncResult(null);

      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          modules: [targetModule],
          financialYear: period === "ALL" || isCustomDate ? undefined : period,
          fromDate: isCustomDate ? fromDate : undefined,
          toDate: isCustomDate ? toDate : undefined,
          customerId: selectedCustomer || undefined,
          forceDetail: mode === "FORCE",
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || json.error || "Section sync failed");
      }

      setSectionSyncResult(json);
      fetchTransactions();
    } catch (err) {
      console.error("Section sync error:", err);
      setSectionSyncResult({
        status: "FAILED",
        message: err instanceof Error ? err.message : "Sync failed",
      });
    } finally {
      setSyncingSection(false);
    }
  };

  const title =
    type === "bills"
      ? "Synchronized Purchase Bills"
      : type === "invoices"
      ? "Synchronized Sales Invoices"
      : "Reconciliation Transaction Detail";

  return (
    <div className="section-card" style={{ padding: 20 }}>
      {/* Header */}
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div className="section-title-group">
          <h2 className="section-title" style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>
            {title}
          </h2>
          <span className="section-badge" style={{ fontSize: 11.5 }}>
            {data.length} records · {isCustomDate ? `${fromDate} to ${toDate}` : `FY ${period}`} · Local SQLite
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {type !== "detail" && (
            <>
              <button
                className="btn btn-sm"
                onClick={() => handleSyncCurrentSection("SMART")}
                disabled={syncingSection}
                style={{ background: "#0f766e", color: "#ffffff", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}
                title={type === "bills" ? "Incrementally sync only changed Purchase Bills" : "Incrementally sync only changed Sales Invoices"}
              >
                <span>⚡</span>
                <span>{syncingSection ? "Syncing..." : type === "bills" ? "Sync Purchase Bills" : "Sync Sales Invoices"}</span>
              </button>
              <button
                className="btn-secondary btn-sm"
                onClick={() => setShowSelectiveSyncModal(true)}
                title="Open Selective Sync Dialog"
              >
                <span>⚙️</span>
                <span>Selective Sync...</span>
              </button>
            </>
          )}
          <button className="btn btn-sm" onClick={() => fetchTransactions()}>
            ↻ Refresh
          </button>
          <button className="btn btn-sm" onClick={handleResetFilters}>
            Reset Filters
          </button>
          <button
            className="btn-export-excel btn-sm"
            onClick={() => setShowExportDialog(true)}
            style={{ fontWeight: 600, padding: "5px 12px", display: "inline-flex", alignItems: "center", gap: 5 }}
            title={`Download ${title} as Excel or PDF`}
          >
            <span>📥</span>
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Section Sync Outcome Banner */}
      {sectionSyncResult && (
        <div
          style={{
            background: sectionSyncResult.status === "SUCCESS" ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${sectionSyncResult.status === "SUCCESS" ? "#bbf7d0" : "#fecaca"}`,
            borderRadius: 6,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ color: sectionSyncResult.status === "SUCCESS" ? "#166534" : "#991b1b" }}>
            <strong>{sectionSyncResult.status === "SUCCESS" ? "✓ Sync Complete" : "Sync Notice"}:</strong>{" "}
            {sectionSyncResult.message || `Checked ${sectionSyncResult.totalChecked ?? 0}, Upserted ${sectionSyncResult.totalUpserts ?? 0}, Skipped ${sectionSyncResult.totalUnchanged ?? 0}`}
          </div>
          <div style={{ fontSize: 11, color: "#475569" }}>
            API Calls Used: <strong>{sectionSyncResult.apiCallsUsed ?? 0}</strong>
          </div>
        </div>
      )}


      {/* Summary KPI Cards — Taxable Value Before GST */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 18 }}>
        {type === "bills" && (
          <>
            <div className="metric-card">
              <span className="metric-label">BILL COUNT</span>
              <span className="metric-value" style={{ color: "#0f172a" }}>
                {totals.billCount ?? data.length}
              </span>
              <span className="metric-sub">Bills in period</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">PURCHASE QTY</span>
              <span className="metric-value" style={{ color: "#16a34a" }}>
                {formatQuantity(totals.purchaseQty ?? 0)}
              </span>
              <span className="metric-sub">Total units</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">PURCHASE TAXABLE VALUE</span>
              <span className="metric-value" style={{ color: "#16a34a" }}>
                ₹{formatINR(totals.purchaseTaxableAmount ?? totals.purchaseAmount ?? 0)}
              </span>
              <span className="metric-sub">Taxable Value Before GST</span>
            </div>
          </>
        )}

        {type === "invoices" && (
          <>
            <div className="metric-card">
              <span className="metric-label">INVOICE COUNT</span>
              <span className="metric-value" style={{ color: "#0f172a" }}>
                {totals.invoiceCount ?? data.length}
              </span>
              <span className="metric-sub">Invoices in period</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">SALES QTY</span>
              <span className="metric-value" style={{ color: "#2563eb" }}>
                {formatQuantity(totals.salesQty ?? 0)}
              </span>
              <span className="metric-sub">Total units</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">SALES TAXABLE VALUE</span>
              <span className="metric-value" style={{ color: "#2563eb" }}>
                ₹{formatINR(totals.salesTaxableAmount ?? totals.salesAmount ?? 0)}
              </span>
              <span className="metric-sub">Taxable Value Before GST</span>
            </div>
          </>
        )}

        {type === "detail" && (
          <>
            <div className="metric-card">
              <span className="metric-label">PURCHASE QTY</span>
              <span className="metric-value" style={{ color: "#16a34a" }}>
                {formatQuantity(totals.purchaseQty ?? 0)}
              </span>
              <span className="metric-sub">Purchased units</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">PURCHASE TAXABLE VALUE</span>
              <span className="metric-value" style={{ color: "#16a34a" }}>
                ₹{formatINR(totals.purchaseTaxableAmount ?? totals.purchaseAmount ?? 0)}
              </span>
              <span className="metric-sub">Taxable Value Before GST</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">SALES QTY</span>
              <span className="metric-value" style={{ color: "#2563eb" }}>
                {formatQuantity(totals.salesQty ?? 0)}
              </span>
              <span className="metric-sub">Invoiced units</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">SALES TAXABLE VALUE</span>
              <span className="metric-value" style={{ color: "#2563eb" }}>
                ₹{formatINR(totals.salesTaxableAmount ?? totals.salesAmount ?? 0)}
              </span>
              <span className="metric-sub">Taxable Value Before GST</span>
            </div>
          </>
        )}
      </div>

      {/* Filter Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          background: "#f8fafc",
          padding: "12px 14px",
          borderRadius: 6,
          border: "1px solid #e2e8f0",
          marginBottom: 16,
        }}
      >
        {/* Period Selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>PERIOD</label>
          <select
            value={period}
            onChange={(e) => handlePeriodChange(e.target.value)}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1" }}
          >
            <option value="2026-27">FY 2026-27 (Current)</option>
            <option value="2025-26">FY 2025-26 (Historical)</option>
            <option value="2024-25">FY 2024-25</option>
            <option value="CUSTOM">Custom Date Range</option>
          </select>
        </div>

        {/* Custom Date Range */}
        {isCustomDate && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>FROM DATE</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                style={{ fontSize: 12, padding: "3px 6px", borderRadius: 4, border: "1px solid #cbd5e1" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>TO DATE</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                style={{ fontSize: 12, padding: "3px 6px", borderRadius: 4, border: "1px solid #cbd5e1" }}
              />
            </div>
          </>
        )}

        {/* Vendor Selector (Bills and Detail) */}
        {(type === "bills" || type === "detail") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>VENDOR</label>
            <select
              value={selectedVendor}
              onChange={(e) => setSelectedVendor(e.target.value)}
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1", maxWidth: 160 }}
            >
              <option value="">All Vendors</option>
              {uniqueVendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name.length > 22 ? `${v.name.slice(0, 22)}…` : v.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Customer Selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>CUSTOMER</label>
          <select
            value={selectedCustomer}
            onChange={(e) => setSelectedCustomer(e.target.value)}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1", maxWidth: 180 }}
          >
            <option value="">All Customers</option>
            {uniqueCustomers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name.length > 24 ? `${c.name.slice(0, 24)}…` : c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Item Selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>ITEM</label>
          <select
            value={selectedItem}
            onChange={(e) => setSelectedItem(e.target.value)}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1", maxWidth: 180 }}
          >
            <option value="">All Items</option>
            {uniqueItems.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name.length > 24 ? `${it.name.slice(0, 24)}…` : it.name}
              </option>
            ))}
          </select>
        </div>

        {/* Transaction Type (Detail only) */}
        {type === "detail" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>TYPE</label>
            <select
              value={txType}
              onChange={(e) => setTxType(e.target.value)}
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1" }}
            >
              <option value="ALL">All (Purchase + Sales)</option>
              <option value="PURCHASE">Purchase Only</option>
              <option value="SALES">Sales Only</option>
            </select>
          </div>
        )}

        {/* Search Input */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>SEARCH</label>
          <input
            type="text"
            className="filter-input"
            placeholder={
              type === "bills"
                ? "Bill No, Vendor, Customer, Item, SKU..."
                : type === "invoices"
                ? "Invoice No, Customer, Item, SKU..."
                : "Doc No, Customer, Vendor, Item, SKU..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", fontSize: 12, padding: "4px 8px" }}
          />
        </div>
      </div>

      {/* Table Area with Horizontal Scroll Container */}
      <div className="table-scroll-container table-responsive" style={{ minHeight: 380, width: "100%", overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            {type === "bills" && (
              <tr>
                <th style={{ width: 40, textAlign: "center", verticalAlign: "top" }}>Sr</th>
                <th style={{ minWidth: 140, textAlign: "left", verticalAlign: "top" }}>Bill Number</th>
                <th style={{ minWidth: 95, textAlign: "left", verticalAlign: "top" }}>Bill Date</th>
                <th style={{ minWidth: 95, textAlign: "left", verticalAlign: "top" }}>Due Date</th>
                <th style={{ minWidth: 180, textAlign: "left", verticalAlign: "top" }}>Vendor</th>
                <th style={{ minWidth: 160, textAlign: "left", verticalAlign: "top" }}>Customer Details</th>
                <th className="right" style={{ minWidth: 95, textAlign: "right", verticalAlign: "top" }}>Quantity</th>
                <th className="right" style={{ minWidth: 120, textAlign: "right", verticalAlign: "top" }}>Taxable Value</th>
                <th className="right" style={{ minWidth: 110, textAlign: "right", verticalAlign: "top" }}>Balance</th>
                <th style={{ width: 100, textAlign: "center", verticalAlign: "top" }}>Status</th>
              </tr>
            )}

            {type === "invoices" && (
              <tr>
                <th style={{ width: 40, textAlign: "center", verticalAlign: "top" }}>Sr</th>
                <th style={{ minWidth: 140, textAlign: "left", verticalAlign: "top" }}>Invoice Number</th>
                <th style={{ minWidth: 95, textAlign: "left", verticalAlign: "top" }}>Invoice Date</th>
                <th style={{ minWidth: 95, textAlign: "left", verticalAlign: "top" }}>Due Date</th>
                <th style={{ minWidth: 180, textAlign: "left", verticalAlign: "top" }}>Customer</th>
                <th className="right" style={{ minWidth: 95, textAlign: "right", verticalAlign: "top" }}>Quantity</th>
                <th className="right" style={{ minWidth: 120, textAlign: "right", verticalAlign: "top" }}>Taxable Value</th>
                <th className="right" style={{ minWidth: 110, textAlign: "right", verticalAlign: "top" }}>Balance</th>
                <th style={{ width: 100, textAlign: "center", verticalAlign: "top" }}>Status</th>
              </tr>
            )}

            {type === "detail" && (
              <tr>
                <th style={{ width: 40, textAlign: "center", verticalAlign: "top" }}>Sr</th>
                <th style={{ minWidth: 90, textAlign: "center", verticalAlign: "top" }}>Type</th>
                <th style={{ minWidth: 95, textAlign: "left", verticalAlign: "top" }}>Date</th>
                <th style={{ minWidth: 140, textAlign: "left", verticalAlign: "top" }}>Document No.</th>
                <th style={{ minWidth: 170, textAlign: "left", verticalAlign: "top" }}>Customer</th>
                <th style={{ minWidth: 160, textAlign: "left", verticalAlign: "top" }}>Vendor</th>
                <th style={{ minWidth: 170, textAlign: "left", verticalAlign: "top" }}>Item</th>
                <th style={{ minWidth: 100, textAlign: "left", verticalAlign: "top" }}>SKU</th>
                <th className="right" style={{ minWidth: 95, textAlign: "right", verticalAlign: "top" }}>Purch Qty</th>
                <th className="right" style={{ minWidth: 120, textAlign: "right", verticalAlign: "top" }}>Purch Taxable</th>
                <th className="right" style={{ minWidth: 95, textAlign: "right", verticalAlign: "top" }}>Sales Qty</th>
                <th className="right" style={{ minWidth: 120, textAlign: "right", verticalAlign: "top" }}>Sales Taxable</th>
              </tr>
            )}
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={12} style={{ textAlign: "center", padding: 48, color: "#64748b" }}>
                  Loading transactions from local SQLite…
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={12} style={{ textAlign: "center", padding: 48, color: "#64748b" }}>
                  No transactions found matching the selected filters.
                </td>
              </tr>
            ) : (
              data.map((row, idx) => {
                if (type === "bills") {
                  return (
                    <tr
                      key={`bill-${row.bill_id || row.bill_number || idx}`}
                      onClick={() => handleRowClick(row)}
                      style={{ cursor: "pointer" }}
                      title="Click to view Bill details and line items"
                    >
                      <td style={{ textAlign: "center", color: "#64748b", verticalAlign: "top" }}>{idx + 1}</td>
                      <td style={{ fontWeight: 600, verticalAlign: "top" }}>
                        <span style={{ color: "#0f172a" }}>{String(row.bill_number)}</span>
                        {row.bill_url ? (
                          <a
                            href={String(row.bill_url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="zoho-link"
                            style={{ marginLeft: 6, fontSize: 11, color: "#3b82f6", textDecoration: "none" }}
                            onClick={(e) => e.stopPropagation()}
                            title="Open in Zoho Books"
                          >
                            ↗
                          </a>
                        ) : null}
                      </td>
                      <td style={{ verticalAlign: "top" }}>{formatDisplayDate(row.date as string)}</td>
                      <td style={{ verticalAlign: "top" }}>{row.due_date ? formatDisplayDate(row.due_date as string) : "—"}</td>
                      <td style={{ fontWeight: 500, verticalAlign: "top" }}>{String(row.vendor_name)}</td>
                      <td style={{ verticalAlign: "top", fontSize: 12, color: "#475569" }}>
                        {String(row.customer_details || "—")}
                      </td>
                      <td className="right" style={{ verticalAlign: "top", textAlign: "right", fontWeight: 600 }}>
                        {formatQuantity(Number(row.total_qty || 0))}
                      </td>
                      <td className="right amount" style={{ verticalAlign: "top", textAlign: "right", fontWeight: 600, color: "#0f172a" }}>
                        ₹{formatINR(Number(row.taxable_amount ?? row.total) || 0)}
                      </td>
                      <td className="right balance" style={{ verticalAlign: "top", textAlign: "right" }}>
                        ₹{formatINR(Number(row.balance) || 0)}
                      </td>
                      <td style={{ textAlign: "center", verticalAlign: "top" }}>
                        <span className="badge-enabled">{String(row.status || "SYNCED")}</span>
                      </td>
                    </tr>
                  );
                }

                if (type === "invoices") {
                  return (
                    <tr
                      key={`inv-${row.invoice_id || row.invoice_number || idx}`}
                      onClick={() => handleRowClick(row)}
                      style={{ cursor: "pointer" }}
                      title="Click to view Invoice details and line items"
                    >
                      <td style={{ textAlign: "center", color: "#64748b", verticalAlign: "top" }}>{idx + 1}</td>
                      <td style={{ fontWeight: 600, verticalAlign: "top" }}>
                        <span style={{ color: "#0f172a" }}>{String(row.invoice_number)}</span>
                        {row.invoice_url ? (
                          <a
                            href={String(row.invoice_url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="zoho-link"
                            style={{ marginLeft: 6, fontSize: 11, color: "#3b82f6", textDecoration: "none" }}
                            onClick={(e) => e.stopPropagation()}
                            title="Open in Zoho Books"
                          >
                            ↗
                          </a>
                        ) : null}
                      </td>
                      <td style={{ verticalAlign: "top" }}>{formatDisplayDate(row.date as string)}</td>
                      <td style={{ verticalAlign: "top" }}>{row.due_date ? formatDisplayDate(row.due_date as string) : "—"}</td>
                      <td style={{ fontWeight: 500, verticalAlign: "top" }}>{String(row.customer_name)}</td>
                      <td className="right" style={{ verticalAlign: "top", textAlign: "right", fontWeight: 600 }}>
                        {formatQuantity(Number(row.total_qty || 0))}
                      </td>
                      <td className="right amount" style={{ verticalAlign: "top", textAlign: "right", fontWeight: 600, color: "#0f172a" }}>
                        ₹{formatINR(Number(row.taxable_amount ?? row.total) || 0)}
                      </td>
                      <td className="right balance" style={{ verticalAlign: "top", textAlign: "right" }}>
                        ₹{formatINR(Number(row.balance) || 0)}
                      </td>
                      <td style={{ textAlign: "center", verticalAlign: "top" }}>
                        <span className="badge-enabled">{String(row.status || "SYNCED")}</span>
                      </td>
                    </tr>
                  );
                }

                // type === "detail"
                return (
                  <tr key={`detail-${row.line_item_id || `${row.transaction_type}-${row.document_number}-${row.item_id || row.item_name}-${idx}`}`}>
                    <td style={{ textAlign: "center", color: "#64748b", verticalAlign: "top" }}>{idx + 1}</td>
                    <td style={{ textAlign: "center", verticalAlign: "top" }}>
                      <span className={row.transaction_type === "PURCHASE" ? "badge-enabled" : "status-badge-surplus"} style={{ fontSize: 10.5 }}>
                        {String(row.transaction_type)}
                      </span>
                    </td>
                    <td style={{ verticalAlign: "top" }}>{formatDisplayDate(row.transaction_date as string)}</td>
                    <td style={{ fontWeight: 600, verticalAlign: "top" }}>
                      {String(row.document_number)}
                      {row.document_url ? (
                        <a
                          href={String(row.document_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="zoho-link"
                          style={{ marginLeft: 6, fontSize: 11, color: "#3b82f6", textDecoration: "none" }}
                          onClick={(e) => e.stopPropagation()}
                          title="Open in Zoho Books"
                        >
                          ↗
                        </a>
                      ) : null}
                    </td>
                    <td style={{ fontWeight: 500, verticalAlign: "top" }}>{String(row.customer_name)}</td>
                    <td style={{ verticalAlign: "top" }}>{String(row.vendor_name)}</td>
                    <td style={{ verticalAlign: "top" }}>{String(row.item_name)}</td>
                    <td style={{ verticalAlign: "top" }}><code>{String(row.sku || "-")}</code></td>
                    <td className="right" style={{ verticalAlign: "top", textAlign: "right" }}>
                      {Number(row.purchase_qty) > 0 ? formatQuantity(Number(row.purchase_qty)) : "—"}
                    </td>
                    <td className="right amount" style={{ verticalAlign: "top", textAlign: "right" }}>
                      {Number(row.purchase_amount) > 0 ? `₹${formatINR(Number(row.purchase_amount))}` : "—"}
                    </td>
                    <td className="right" style={{ verticalAlign: "top", textAlign: "right" }}>
                      {Number(row.sales_qty) > 0 ? formatQuantity(Number(row.sales_qty)) : "—"}
                    </td>
                    <td className="right amount" style={{ verticalAlign: "top", textAlign: "right" }}>
                      {Number(row.sales_amount) > 0 ? `₹${formatINR(Number(row.sales_amount))}` : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Document Detail Drawer / Modal */}
      {selectedDoc && (
        <div
          className="drawer-overlay"
          onClick={() => setSelectedDoc(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.45)",
            zIndex: 9999,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <div
            className="drawer-content"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "clamp(720px, 68vw, 1150px)",
              maxWidth: "100vw",
              height: "100vh",
              background: "#ffffff",
              boxShadow: "-8px 0 24px rgba(0, 0, 0, 0.15)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Drawer Header */}
            <div
              style={{
                padding: "18px 24px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#f8fafc",
              }}
            >
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px 0", color: "#0f172a" }}>
                  {selectedDoc.bill_number ? `Purchase Bill: ${selectedDoc.bill_number}` : `Sales Invoice: ${selectedDoc.invoice_number}`}
                </h3>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  Date: {formatDisplayDate(selectedDoc.date as string)} · Status: <span className="badge-enabled" style={{ display: "inline-block", padding: "1px 6px", fontSize: 11 }}>{selectedDoc.status || "SYNCED"}</span> · Local SQLite Cache
                </div>
              </div>
              <button
                className="btn btn-sm"
                onClick={() => setSelectedDoc(null)}
                style={{ fontSize: 16, padding: "4px 10px", borderRadius: "50%", border: "1px solid #cbd5e1" }}
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            {/* Drawer Body */}
            <div style={{ padding: 24, flex: 1, overflowY: "auto" }}>
              {/* Summary Cards (4 Cards Layout) */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
                {selectedDoc.bill_number ? (
                  <div className="metric-card">
                    <span className="metric-label">VENDOR</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{selectedDoc.vendor_name || "—"}</span>
                  </div>
                ) : (
                  <div className="metric-card">
                    <span className="metric-label">CUSTOMER</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{selectedDoc.customer_name || "—"}</span>
                  </div>
                )}
                <div className="metric-card">
                  <span className="metric-label">TAXABLE VALUE (PRE-GST)</span>
                  <span className="metric-value" style={{ fontSize: 16, color: "#16a34a" }}>
                    ₹{formatINR(selectedDoc.taxableTotal ?? 0)}
                  </span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">GRAND TOTAL (WITH GST)</span>
                  <span className="metric-value" style={{ fontSize: 16, color: "#0f172a" }}>
                    ₹{formatINR(selectedDoc.grand_total ?? 0)}
                  </span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">BALANCE</span>
                  <span className="metric-value" style={{ fontSize: 16, color: "#64748b" }}>
                    ₹{formatINR(selectedDoc.balance ?? 0)}
                  </span>
                </div>
              </div>

              {/* Line Items Table */}
              <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#334155" }}>
                Document Line Items ({selectedDoc.lines?.length || 0} lines)
              </h4>
              <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 6, marginBottom: 20 }}>
                <table className="data-table" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9" }}>
                      <th style={{ width: 35, textAlign: "center" }}>#</th>
                      <th style={{ textAlign: "left", minWidth: 150 }}>ITEM NAME</th>
                      <th style={{ textAlign: "left", minWidth: 90 }}>SKU</th>
                      {selectedDoc.bill_number && <th style={{ textAlign: "left", minWidth: 160 }}>CUSTOMER DETAILS</th>}
                      {selectedDoc.invoice_number && <th style={{ textAlign: "left", minWidth: 140 }}>DESCRIPTION</th>}
                      <th style={{ textAlign: "right", minWidth: 80 }}>QUANTITY</th>
                      <th style={{ textAlign: "right", minWidth: 90 }}>RATE</th>
                      <th style={{ textAlign: "right", minWidth: 110 }}>TAXABLE TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDoc.lines && selectedDoc.lines.length > 0 ? (
                      selectedDoc.lines.map((line, lIdx) => (
                        <tr key={line.line_item_id || lIdx}>
                          <td style={{ textAlign: "center", color: "#64748b" }}>{lIdx + 1}</td>
                          <td style={{ fontWeight: 600 }}>{line.item_name}</td>
                          <td><code>{line.sku || "—"}</code></td>
                          {selectedDoc.bill_number && (
                            <td style={{ color: "#475569" }}>
                              {line.customer_details || line.purchase_line_customer_name || line.bbt_customer_name || "—"}
                            </td>
                          )}
                          {selectedDoc.invoice_number && (
                            <td style={{ color: "#475569", fontSize: 11 }}>{line.description || "—"}</td>
                          )}
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{formatQuantity(line.quantity)}</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(line.rate)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>₹{formatINR(line.line_total)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={selectedDoc.bill_number ? 7 : 7} style={{ textAlign: "center", padding: 20, color: "#64748b" }}>
                          No included analytical line items found for this document.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
                      <td colSpan={selectedDoc.bill_number ? 4 : (selectedDoc.invoice_number ? 4 : 3)} style={{ textAlign: "right" }}>
                        Taxable Subtotal (Before GST):
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {formatQuantity(selectedDoc.lines?.reduce((s, l) => s + Number(l.quantity || 0), 0) || 0)}
                      </td>
                      <td style={{ textAlign: "right" }}>—</td>
                      <td style={{ textAlign: "right", color: "#16a34a" }}>
                        ₹{formatINR(selectedDoc.taxableTotal ?? 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Footer Totals Breakdown */}
              <div
                style={{
                  background: "#f8fafc",
                  padding: "16px 20px",
                  borderRadius: 6,
                  border: "1px solid #e2e8f0",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  maxWidth: 420,
                  marginLeft: "auto",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>Taxable Subtotal (Before GST):</span>
                  <span style={{ fontWeight: 600, color: "#0f172a" }}>₹{formatINR(selectedDoc.taxableTotal ?? 0)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>Tax / GST:</span>
                  <span style={{ fontWeight: 600, color: "#0f172a" }}>₹{formatINR(selectedDoc.taxAmount ?? 0)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, borderTop: "1px solid #e2e8f0", paddingTop: 8 }}>
                  <span style={{ fontWeight: 700, color: "#0f172a" }}>Grand Total:</span>
                  <span style={{ fontWeight: 700, color: "#0f172a" }}>₹{formatINR(selectedDoc.grand_total ?? 0)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>Balance:</span>
                  <span style={{ fontWeight: 600, color: "#64748b" }}>₹{formatINR(selectedDoc.balance ?? 0)}</span>
                </div>
              </div>
            </div>

            {/* Drawer Bottom Bar */}
            <div
              style={{
                padding: "14px 24px",
                borderTop: "1px solid #e2e8f0",
                background: "#f8fafc",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Tax: ₹{formatINR(selectedDoc.taxAmount ?? 0)} · Grand Total: ₹{formatINR(selectedDoc.grand_total ?? 0)} · Balance: ₹{formatINR(selectedDoc.balance ?? 0)}
              </div>
              <button className="btn btn-sm" onClick={() => setSelectedDoc(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        onExport={handleExecuteExport}
        reportType={type}
        filter={{
          financialYear: isCustomDate ? "CUSTOM" : period,
          period,
          fromDate: isCustomDate ? fromDate : undefined,
          toDate: isCustomDate ? toDate : undefined,
          customerId: selectedCustomer || undefined,
          vendorName: selectedVendor || undefined,
          itemId: selectedItem || undefined,
          search: search || undefined,
        }}
        totalRecords={data.length}
      />

      <SelectiveSyncModal
        isOpen={showSelectiveSyncModal}
        onClose={() => setShowSelectiveSyncModal(false)}
        initialModule={type === "bills" ? "purchase_bills" : type === "invoices" ? "sales_invoices" : "all"}
        onSyncCompleted={(result) => {
          setSectionSyncResult(result);
          fetchTransactions();
        }}
      />
    </div>
  );
}


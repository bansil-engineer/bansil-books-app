"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { formatINR, formatQuantity, formatDisplayDate } from "@/app/lib/date-utils";
import { deduplicateFilterOptions } from "@/app/lib/dropdown-utils";
import { ExportDialog } from "./ExportDialog";
import type { ExportOptions } from "@/app/types/reconciliation";
import type {
  PriceEvidence,
  PriceReferenceResult,
  PriceReferenceSummaryStats,
} from "@/app/lib/price-reference-engine";

interface PriceReferenceViewProps {
  financialYear: string;
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

export function PriceReferenceView({ financialYear }: PriceReferenceViewProps) {
  const [data, setData] = useState<PriceEvidence[]>([]);
  const [stats, setStats] = useState<PriceReferenceSummaryStats | null>(null);
  const [chartData, setChartData] = useState<PriceReferenceResult["chartData"]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showExportDialog, setShowExportDialog] = useState<boolean>(false);

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

  // Filter States
  const [period, setPeriod] = useState<string>(financialYear);
  const [isCustomDate, setIsCustomDate] = useState<boolean>(false);
  const [fromDate, setFromDate] = useState<string>("2026-04-01");
  const [toDate, setToDate] = useState<string>("2027-03-31");
  const [priceType, setPriceType] = useState<"PURCHASE" | "SALES" | "ALL">("ALL");
  const [selectedItem, setSelectedItem] = useState<string>("");
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [priceFilter, setPriceFilter] = useState<"ALL" | "LOWEST" | "HIGHEST" | "LATEST">("ALL");
  const [search, setSearch] = useState<string>("");
  const [sort, setSort] = useState<"NEWEST" | "OLDEST" | "PRICE_DESC" | "PRICE_ASC" | "QTY_DESC">("NEWEST");

  // Filter Dropdown Options
  const [items, setItems] = useState<{ id: string; name: string; sku?: string }[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);

  const uniqueItems = useMemo(() => deduplicateFilterOptions(items), [items]);
  const uniqueCustomers = useMemo(() => deduplicateFilterOptions(customers), [customers]);
  const uniqueVendors = useMemo(() => deduplicateFilterOptions(vendors), [vendors]);

  useEffect(() => {
    setPeriod(financialYear);
  }, [financialYear]);

  const fetchPriceReference = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("financialYear", period);
      if (isCustomDate && fromDate && toDate) {
        params.set("financialYear", "CUSTOM");
        params.set("fromDate", fromDate);
        params.set("toDate", toDate);
      }
      params.set("priceType", priceType);
      if (selectedItem) params.set("itemId", selectedItem);
      if (selectedCustomer) params.set("customerId", selectedCustomer);
      if (selectedVendor && priceType !== "SALES") params.set("vendorId", selectedVendor);
      if (priceFilter) params.set("priceFilter", priceFilter);
      if (search) params.set("search", search);
      if (sort) params.set("sort", sort);

      const res = await fetch(`/api/price-reference?${params.toString()}`);
      if (res.ok) {
        const json: PriceReferenceResult & { success: boolean } = await res.json();
        if (json.success) {
          setData(json.history || []);
          setStats(json.stats || null);
          setChartData(json.chartData || []);
          if (json.filterOptions) {
            setItems(json.filterOptions.items || []);
            setCustomers(json.filterOptions.customers || []);
            setVendors(json.filterOptions.vendors || []);
          }
        }
      }
    } catch (err) {
      console.error("Failed to load price reference data:", err);
    } finally {
      setLoading(false);
    }
  }, [period, isCustomDate, fromDate, toDate, priceType, selectedItem, selectedCustomer, selectedVendor, priceFilter, search, sort]);

  useEffect(() => {
    fetchPriceReference();
  }, [fetchPriceReference]);

  const handlePeriodChange = (val: string) => {
    setPeriod(val);
    if (val === "CUSTOM") {
      setIsCustomDate(true);
    } else {
      setIsCustomDate(false);
    }
  };

  const handleResetFilters = () => {
    setPeriod(financialYear);
    setIsCustomDate(false);
    setPriceType("ALL");
    setSelectedItem("");
    setSelectedCustomer("");
    setSelectedVendor("");
    setPriceFilter("ALL");
    setSearch("");
    setSort("NEWEST");
  };

  const openDocumentDrawer = async (docType: "PURCHASE" | "SALES", docId: string) => {
    try {
      setLoadingDocDetail(true);
      const endpoint = docType === "PURCHASE" ? "bill-detail" : "invoice-detail";
      const res = await fetch(`/api/transactions?type=${endpoint}&docId=${encodeURIComponent(docId)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.document) {
          setSelectedDoc(json.document);
        }
      }
    } catch (err) {
      console.error("Failed to load document detail:", err);
    } finally {
      setLoadingDocDetail(false);
    }
  };

  const handleExecuteExport = async (options: ExportOptions) => {
    const params = new URLSearchParams({
      reportType: "price-reference",
      financialYear: isCustomDate ? "CUSTOM" : period,
      fromDate: isCustomDate ? fromDate : "",
      toDate: isCustomDate ? toDate : "",
      priceType,
      itemId: selectedItem,
      customerId: selectedCustomer,
      vendorName: selectedVendor,
      priceFilter,
      search,
      sort,
      includeTotals: options.includeTotals ? "true" : "false",
    });
    if (options.selectedFields && options.selectedFields.length > 0) {
      params.set("selectedFields", options.selectedFields.join(","));
    }
    const endpoint = options.format === "pdf" ? "/api/export/pdf" : "/api/export/excel";
    const res = await fetch(`${endpoint}?${params.toString()}`);
    if (!res.ok) throw new Error("Price reference export failed");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Bansil_Price_Reference_${period}_${new Date().toISOString().slice(0, 10)}.${options.format === "pdf" ? "pdf" : "xlsx"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="section-card" style={{ padding: 20 }}>
      {/* Header */}
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div className="section-title-group">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 className="section-title" style={{ fontSize: 19, fontWeight: 700, color: "#0f172a", margin: 0 }}>
              Item Price Reference
            </h2>
            <span style={{ fontSize: 11, background: "#e2e8f0", padding: "2px 8px", borderRadius: 4, fontWeight: 600, color: "#334155" }}>
              Local SQLite Cache
            </span>
          </div>
          <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0 0" }}>
            Historical Purchase &amp; Sales Price Evidence — Pre-GST Taxable Unit Rates
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Price Type Toggle Buttons */}
          <div style={{ display: "flex", background: "#f1f5f9", padding: 3, borderRadius: 6, border: "1px solid #cbd5e1" }}>
            <button
              onClick={() => setPriceType("PURCHASE")}
              style={{
                border: "none",
                background: priceType === "PURCHASE" ? "#ffffff" : "transparent",
                color: priceType === "PURCHASE" ? "#16a34a" : "#475569",
                fontWeight: priceType === "PURCHASE" ? 700 : 500,
                padding: "4px 10px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 11.5,
                boxShadow: priceType === "PURCHASE" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              Purchase
            </button>
            <button
              onClick={() => setPriceType("SALES")}
              style={{
                border: "none",
                background: priceType === "SALES" ? "#ffffff" : "transparent",
                color: priceType === "SALES" ? "#2563eb" : "#475569",
                fontWeight: priceType === "SALES" ? 700 : 500,
                padding: "4px 10px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 11.5,
                boxShadow: priceType === "SALES" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              Sales
            </button>
            <button
              onClick={() => setPriceType("ALL")}
              style={{
                border: "none",
                background: priceType === "ALL" ? "#ffffff" : "transparent",
                color: priceType === "ALL" ? "#0f172a" : "#475569",
                fontWeight: priceType === "ALL" ? 700 : 500,
                padding: "4px 10px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 11.5,
                boxShadow: priceType === "ALL" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              Purchase + Sales
            </button>
          </div>

          <button className="btn btn-sm" onClick={() => fetchPriceReference()}>
            ↻ Refresh
          </button>
          <button className="btn btn-sm" onClick={handleResetFilters}>
            Reset Filters
          </button>
          <button
            className="btn-export-excel btn-sm"
            onClick={() => setShowExportDialog(true)}
            style={{ fontWeight: 600, padding: "5px 12px", display: "inline-flex", alignItems: "center", gap: 5 }}
            title="Download Price Reference Report as Excel or PDF"
          >
            <span>📥</span>
            <span>Export</span>
          </button>
        </div>
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
            <option value="ALL">All Periods (Historical)</option>
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

        {/* Item Selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>ITEM</label>
          <select
            value={selectedItem}
            onChange={(e) => setSelectedItem(e.target.value)}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1", maxWidth: 220 }}
          >
            <option value="">All Items ({uniqueItems.length})</option>
            {uniqueItems.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name.length > 26 ? `${it.name.slice(0, 26)}…` : it.name}
              </option>
            ))}
          </select>
        </div>

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
                {c.name.length > 22 ? `${c.name.slice(0, 22)}…` : c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Vendor Selector (Hidden if Sales Only) */}
        {priceType !== "SALES" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>VENDOR</label>
            <select
              value={selectedVendor}
              onChange={(e) => setSelectedVendor(e.target.value)}
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1", maxWidth: 180 }}
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

        {/* Price Filter */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>PRICE FILTER</label>
          <select
            value={priceFilter}
            onChange={(e) => setPriceFilter(e.target.value as any)}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1" }}
          >
            <option value="ALL">All Transactions</option>
            <option value="LATEST">Latest Price Evidence</option>
            <option value="LOWEST">Lowest Price Evidence</option>
            <option value="HIGHEST">Highest Price Evidence</option>
          </select>
        </div>

        {/* Sort Order */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>SORT</label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as any)}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1" }}
          >
            <option value="NEWEST">Newest First</option>
            <option value="OLDEST">Oldest First</option>
            <option value="PRICE_DESC">Price: High to Low</option>
            <option value="PRICE_ASC">Price: Low to High</option>
            <option value="QTY_DESC">Quantity: High to Low</option>
          </select>
        </div>

        {/* Search Input */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>SEARCH</label>
          <input
            type="text"
            className="filter-input"
            placeholder="Item, SKU, Description, Party, Bill/Invoice..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", fontSize: 12, padding: "4px 8px" }}
          />
        </div>
      </div>

      {/* Summary Analytics Cards Section */}
      {stats && (
        <div style={{ marginBottom: 20 }}>
          {/* Purchase Price Summary Cards */}
          {(priceType === "PURCHASE" || priceType === "ALL") && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  ● PURCHASE PRICE REFERENCE
                </span>
                <span style={{ fontSize: 11, color: "#64748b" }}>
                  ({stats.purchase_transactions_count} line items · {stats.purchase_distinct_docs_count} bills · Total Qty: {formatQuantity(stats.purchase_total_qty)})
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                {/* Latest Purchase Price */}
                <div className="metric-card" style={{ borderLeft: "4px solid #16a34a" }}>
                  <span className="metric-label">LATEST PURCHASE PRICE</span>
                  <span className="metric-value" style={{ color: "#16a34a" }}>
                    {stats.latest_purchase.effective_rate !== null ? `₹${formatINR(stats.latest_purchase.effective_rate)}` : "N/A"}
                  </span>
                  {stats.latest_purchase.evidence ? (
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 4, lineHeight: 1.3 }}>
                      <div>Bill: <strong>{stats.latest_purchase.evidence.document_number}</strong> ({formatDisplayDate(stats.latest_purchase.evidence.date)})</div>
                      <div>Vendor: {stats.latest_purchase.evidence.vendor_name}</div>
                      <div>Qty: {formatQuantity(stats.latest_purchase.evidence.quantity)} · Rate: ₹{formatINR(stats.latest_purchase.evidence.effective_rate)}</div>
                      <button
                        onClick={() => openDocumentDrawer("PURCHASE", stats.latest_purchase.evidence!.document_id)}
                        className="btn btn-sm"
                        style={{ marginTop: 6, fontSize: 10.5, padding: "2px 8px", background: "#f0fdf4", color: "#16a34a", borderColor: "#bbf7d0" }}
                      >
                        📄 View Evidence
                      </button>
                    </div>
                  ) : (
                    <span className="metric-sub">No purchase data in period</span>
                  )}
                </div>

                {/* Lowest Purchase Price */}
                <div className="metric-card" style={{ borderLeft: "4px solid #0284c7" }}>
                  <span className="metric-label">LOWEST PURCHASE PRICE</span>
                  <span className="metric-value" style={{ color: "#0284c7" }}>
                    {stats.lowest_purchase.effective_rate !== null ? `₹${formatINR(stats.lowest_purchase.effective_rate)}` : "N/A"}
                  </span>
                  {stats.lowest_purchase.evidence ? (
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 4, lineHeight: 1.3 }}>
                      <div>Bill: <strong>{stats.lowest_purchase.evidence.document_number}</strong> ({formatDisplayDate(stats.lowest_purchase.evidence.date)})</div>
                      <div>Vendor: {stats.lowest_purchase.evidence.vendor_name}</div>
                      <div>Qty: {formatQuantity(stats.lowest_purchase.evidence.quantity)} · Rate: ₹{formatINR(stats.lowest_purchase.evidence.effective_rate)}</div>
                      <button
                        onClick={() => openDocumentDrawer("PURCHASE", stats.lowest_purchase.evidence!.document_id)}
                        className="btn btn-sm"
                        style={{ marginTop: 6, fontSize: 10.5, padding: "2px 8px", background: "#f0f9ff", color: "#0284c7", borderColor: "#bae6fd" }}
                      >
                        📄 View Evidence
                      </button>
                    </div>
                  ) : (
                    <span className="metric-sub">No purchase data in period</span>
                  )}
                </div>

                {/* Highest Purchase Price */}
                <div className="metric-card" style={{ borderLeft: "4px solid #e11d48" }}>
                  <span className="metric-label">HIGHEST PURCHASE PRICE</span>
                  <span className="metric-value" style={{ color: "#e11d48" }}>
                    {stats.highest_purchase.effective_rate !== null ? `₹${formatINR(stats.highest_purchase.effective_rate)}` : "N/A"}
                  </span>
                  {stats.highest_purchase.evidence ? (
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 4, lineHeight: 1.3 }}>
                      <div>Bill: <strong>{stats.highest_purchase.evidence.document_number}</strong> ({formatDisplayDate(stats.highest_purchase.evidence.date)})</div>
                      <div>Vendor: {stats.highest_purchase.evidence.vendor_name}</div>
                      <div>Qty: {formatQuantity(stats.highest_purchase.evidence.quantity)} · Rate: ₹{formatINR(stats.highest_purchase.evidence.effective_rate)}</div>
                      <button
                        onClick={() => openDocumentDrawer("PURCHASE", stats.highest_purchase.evidence!.document_id)}
                        className="btn btn-sm"
                        style={{ marginTop: 6, fontSize: 10.5, padding: "2px 8px", background: "#fff1f2", color: "#e11d48", borderColor: "#fecdd3" }}
                      >
                        📄 View Evidence
                      </button>
                    </div>
                  ) : (
                    <span className="metric-sub">No purchase data in period</span>
                  )}
                </div>

                {/* Weighted Average Purchase Price */}
                <div className="metric-card" style={{ borderLeft: "4px solid #8b5cf6" }} title="Taxable Value ÷ Quantity">
                  <span className="metric-label">WEIGHTED AVERAGE PURCHASE PRICE</span>
                  <span className="metric-value" style={{ color: "#8b5cf6" }}>
                    {stats.weighted_avg_purchase !== null ? `₹${formatINR(stats.weighted_avg_purchase)}` : "N/A"}
                  </span>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 4, lineHeight: 1.3 }}>
                    <div>Based on {stats.purchase_transactions_count} lines / {stats.purchase_distinct_docs_count} bills</div>
                    <div>Total Qty: {formatQuantity(stats.purchase_total_qty)}</div>
                    <div>Total Taxable: ₹{formatINR(stats.purchase_total_taxable)}</div>
                    <button
                      onClick={() => {
                        setPriceFilter("ALL");
                        setPriceType("PURCHASE");
                      }}
                      className="btn btn-sm"
                      style={{ marginTop: 6, fontSize: 10.5, padding: "2px 8px", background: "#f5f3ff", color: "#8b5cf6", borderColor: "#ddd6fe" }}
                    >
                      📊 View Contributing Lines
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sales Price Summary Cards */}
          {(priceType === "SALES" || priceType === "ALL") && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#2563eb", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  ● SALES PRICE REFERENCE
                </span>
                <span style={{ fontSize: 11, color: "#64748b" }}>
                  ({stats.sales_transactions_count} line items · {stats.sales_distinct_docs_count} invoices · Total Qty: {formatQuantity(stats.sales_total_qty)})
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                {/* Latest Sales Price */}
                <div className="metric-card" style={{ borderLeft: "4px solid #2563eb" }}>
                  <span className="metric-label">LATEST SALES PRICE</span>
                  <span className="metric-value" style={{ color: "#2563eb" }}>
                    {stats.latest_sales.effective_rate !== null ? `₹${formatINR(stats.latest_sales.effective_rate)}` : "N/A"}
                  </span>
                  {stats.latest_sales.evidence ? (
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 4, lineHeight: 1.3 }}>
                      <div>Inv: <strong>{stats.latest_sales.evidence.document_number}</strong> ({formatDisplayDate(stats.latest_sales.evidence.date)})</div>
                      <div>Customer: {stats.latest_sales.evidence.customer_name}</div>
                      <div>Qty: {formatQuantity(stats.latest_sales.evidence.quantity)} · Rate: ₹{formatINR(stats.latest_sales.evidence.effective_rate)}</div>
                      <button
                        onClick={() => openDocumentDrawer("SALES", stats.latest_sales.evidence!.document_id)}
                        className="btn btn-sm"
                        style={{ marginTop: 6, fontSize: 10.5, padding: "2px 8px", background: "#eff6ff", color: "#2563eb", borderColor: "#bfdbfe" }}
                      >
                        📄 View Evidence
                      </button>
                    </div>
                  ) : (
                    <span className="metric-sub">No sales data in period</span>
                  )}
                </div>

                {/* Lowest Sales Price */}
                <div className="metric-card" style={{ borderLeft: "4px solid #0891b2" }}>
                  <span className="metric-label">LOWEST SALES PRICE</span>
                  <span className="metric-value" style={{ color: "#0891b2" }}>
                    {stats.lowest_sales.effective_rate !== null ? `₹${formatINR(stats.lowest_sales.effective_rate)}` : "N/A"}
                  </span>
                  {stats.lowest_sales.evidence ? (
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 4, lineHeight: 1.3 }}>
                      <div>Inv: <strong>{stats.lowest_sales.evidence.document_number}</strong> ({formatDisplayDate(stats.lowest_sales.evidence.date)})</div>
                      <div>Customer: {stats.lowest_sales.evidence.customer_name}</div>
                      <div>Qty: {formatQuantity(stats.lowest_sales.evidence.quantity)} · Rate: ₹{formatINR(stats.lowest_sales.evidence.effective_rate)}</div>
                      <button
                        onClick={() => openDocumentDrawer("SALES", stats.lowest_sales.evidence!.document_id)}
                        className="btn btn-sm"
                        style={{ marginTop: 6, fontSize: 10.5, padding: "2px 8px", background: "#ecfeff", color: "#0891b2", borderColor: "#a5f3fc" }}
                      >
                        📄 View Evidence
                      </button>
                    </div>
                  ) : (
                    <span className="metric-sub">No sales data in period</span>
                  )}
                </div>

                {/* Highest Sales Price */}
                <div className="metric-card" style={{ borderLeft: "4px solid #d97706" }}>
                  <span className="metric-label">HIGHEST SALES PRICE</span>
                  <span className="metric-value" style={{ color: "#d97706" }}>
                    {stats.highest_sales.effective_rate !== null ? `₹${formatINR(stats.highest_sales.effective_rate)}` : "N/A"}
                  </span>
                  {stats.highest_sales.evidence ? (
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 4, lineHeight: 1.3 }}>
                      <div>Inv: <strong>{stats.highest_sales.evidence.document_number}</strong> ({formatDisplayDate(stats.highest_sales.evidence.date)})</div>
                      <div>Customer: {stats.highest_sales.evidence.customer_name}</div>
                      <div>Qty: {formatQuantity(stats.highest_sales.evidence.quantity)} · Rate: ₹{formatINR(stats.highest_sales.evidence.effective_rate)}</div>
                      <button
                        onClick={() => openDocumentDrawer("SALES", stats.highest_sales.evidence!.document_id)}
                        className="btn btn-sm"
                        style={{ marginTop: 6, fontSize: 10.5, padding: "2px 8px", background: "#fffbeb", color: "#d97706", borderColor: "#fde68a" }}
                      >
                        📄 View Evidence
                      </button>
                    </div>
                  ) : (
                    <span className="metric-sub">No sales data in period</span>
                  )}
                </div>

                {/* Weighted Average Sales Price */}
                <div className="metric-card" style={{ borderLeft: "4px solid #4f46e5" }} title="Taxable Value ÷ Quantity">
                  <span className="metric-label">WEIGHTED AVERAGE SALES PRICE</span>
                  <span className="metric-value" style={{ color: "#4f46e5" }}>
                    {stats.weighted_avg_sales !== null ? `₹${formatINR(stats.weighted_avg_sales)}` : "N/A"}
                  </span>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 4, lineHeight: 1.3 }}>
                    <div>Based on {stats.sales_transactions_count} lines / {stats.sales_distinct_docs_count} invoices</div>
                    <div>Total Qty: {formatQuantity(stats.sales_total_qty)}</div>
                    <div>Total Taxable: ₹{formatINR(stats.sales_total_taxable)}</div>
                    <button
                      onClick={() => {
                        setPriceFilter("ALL");
                        setPriceType("SALES");
                      }}
                      className="btn btn-sm"
                      style={{ marginTop: 6, fontSize: 10.5, padding: "2px 8px", background: "#eef2ff", color: "#4f46e5", borderColor: "#c7d2fe" }}
                    >
                      📊 View Contributing Lines
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Comparison Bar (When Purchase + Sales selected) */}
          {priceType === "ALL" && (
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                padding: "12px 16px",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
              }}
            >
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700, display: "block" }}>LATEST GROSS SPREAD</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: (stats.gross_price_spread ?? 0) >= 0 ? "#16a34a" : "#dc2626" }}>
                    {stats.gross_price_spread !== null ? `₹${formatINR(stats.gross_price_spread)}` : "N/A"}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700, display: "block" }}>LATEST MARKUP %</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: (stats.markup_percentage ?? 0) >= 0 ? "#16a34a" : "#dc2626" }}>
                    {stats.markup_percentage !== null ? `${stats.markup_percentage > 0 ? "+" : ""}${stats.markup_percentage}%` : "N/A"}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700, display: "block" }}>AVG PURCHASE vs SALES</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
                    ₹{stats.weighted_avg_purchase !== null ? formatINR(stats.weighted_avg_purchase) : "—"} (P) vs ₹{stats.weighted_avg_sales !== null ? formatINR(stats.weighted_avg_sales) : "—"} (S)
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#64748b", fontStyle: "italic", background: "#f1f5f9", padding: "4px 10px", borderRadius: 4 }}>
                ⓘ <strong>REFERENCE ONLY:</strong> Informational decision-support. Does not affect reconciliation valuation rules.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lightweight Timeline Chart (SVG) */}
      {chartData.length > 1 && (
        <div style={{ marginBottom: 20, padding: 14, background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
              📈 Price History Timeline ({chartData.length} data points)
            </span>
            <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
              <span style={{ color: "#16a34a", fontWeight: 600 }}>● Purchase Rate</span>
              <span style={{ color: "#2563eb", fontWeight: 600 }}>● Sales Rate</span>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <svg style={{ width: "100%", height: 140, minWidth: 600 }}>
              {/* Grid Lines */}
              <line x1="40" y1="20" x2="100%" y2="20" stroke="#e2e8f0" strokeDasharray="3 3" />
              <line x1="40" y1="65" x2="100%" y2="65" stroke="#e2e8f0" strokeDasharray="3 3" />
              <line x1="40" y1="110" x2="100%" y2="110" stroke="#cbd5e1" />

              {/* Data points */}
              {(() => {
                const maxRate = Math.max(...chartData.map((d) => d.effective_rate), 1);
                const minRate = Math.min(...chartData.map((d) => d.effective_rate), 0);
                const rateRange = maxRate - minRate || 1;

                return chartData.map((pt, idx) => {
                  const cx = 50 + (idx / Math.max(chartData.length - 1, 1)) * 520;
                  const cy = 110 - ((pt.effective_rate - minRate) / rateRange) * 85;
                  const color = pt.type === "PURCHASE" ? "#16a34a" : "#2563eb";

                  return (
                    <g key={idx}>
                      <circle cx={`${(idx / (chartData.length - 1 || 1)) * 90 + 5}%`} cy={cy} r={4} fill={color}>
                        <title>{`${pt.type}: ₹${formatINR(pt.effective_rate)} | ${pt.document_number} | ${formatDisplayDate(pt.date)} | ${pt.party}`}</title>
                      </circle>
                    </g>
                  );
                });
              })()}
            </svg>
          </div>
        </div>
      )}

      {/* Price History Table */}
      <div className="table-scroll-container table-responsive" style={{ minHeight: 380, width: "100%", overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f1f5f9" }}>
              <th style={{ width: 35, textAlign: "center", verticalAlign: "top" }}>Sr</th>
              <th style={{ minWidth: 85, textAlign: "left", verticalAlign: "top" }}>Date</th>
              <th style={{ minWidth: 80, textAlign: "center", verticalAlign: "top" }}>Type</th>
              <th style={{ minWidth: 130, textAlign: "left", verticalAlign: "top" }}>Document No.</th>
              <th style={{ minWidth: 160, textAlign: "left", verticalAlign: "top" }}>Item Name</th>
              <th style={{ minWidth: 150, textAlign: "left", verticalAlign: "top" }}>Description</th>
              <th style={{ minWidth: 80, textAlign: "left", verticalAlign: "top" }}>SKU</th>
              <th style={{ minWidth: 150, textAlign: "left", verticalAlign: "top" }}>Vendor / Customer</th>
              <th className="right" style={{ minWidth: 75, textAlign: "right", verticalAlign: "top" }}>Quantity</th>
              <th className="right" style={{ minWidth: 90, textAlign: "right", verticalAlign: "top" }}>Source Rate</th>
              <th className="right" style={{ minWidth: 100, textAlign: "right", verticalAlign: "top", color: "#0f172a" }}>Effective Net Rate</th>
              <th className="right" style={{ minWidth: 105, textAlign: "right", verticalAlign: "top" }}>Taxable Value</th>
              <th style={{ width: 80, textAlign: "center", verticalAlign: "top" }}>Evidence</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={13} style={{ textAlign: "center", padding: 48, color: "#64748b" }}>
                  Loading historical price reference data from local SQLite…
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={13} style={{ textAlign: "center", padding: 48, color: "#64748b" }}>
                  {priceType === "PURCHASE"
                    ? "No purchase price history found for this item in selected period."
                    : priceType === "SALES"
                    ? "No sales price history found for this item in selected period."
                    : "No price history found matching the selected filters."}
                </td>
              </tr>
            ) : (
              data.map((row, idx) => {
                const isPurchase = row.document_type === "PURCHASE";
                return (
                  <tr
                    key={`${row.document_type}-${row.document_id}-${row.line_item_id}-${idx}`}
                    onClick={() => openDocumentDrawer(row.document_type, row.document_id)}
                    style={{ cursor: "pointer" }}
                    title={`Click to open ${isPurchase ? "Purchase Bill" : "Sales Invoice"} ${row.document_number}`}
                  >
                    <td style={{ textAlign: "center", color: "#64748b", verticalAlign: "top" }}>{idx + 1}</td>
                    <td style={{ verticalAlign: "top" }}>{formatDisplayDate(row.date)}</td>
                    <td style={{ textAlign: "center", verticalAlign: "top" }}>
                      <span className={isPurchase ? "badge-enabled" : "status-badge-surplus"} style={{ fontSize: 10.5, fontWeight: 700 }}>
                        {row.document_type}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600, verticalAlign: "top" }}>
                      <span style={{ color: "#0f172a" }}>{row.document_number}</span>
                      {row.url ? (
                        <a
                          href={row.url}
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
                    <td style={{ fontWeight: 600, verticalAlign: "top" }}>{row.item_name}</td>
                    <td style={{ verticalAlign: "top", fontSize: 11.5, color: "#475569" }}>
                      {row.description || "—"}
                    </td>
                    <td style={{ verticalAlign: "top" }}>
                      <code>{row.sku || "—"}</code>
                    </td>
                    <td style={{ verticalAlign: "top" }}>
                      {isPurchase ? (
                        <div>
                          <span style={{ fontWeight: 600, color: "#0f172a" }}>{row.vendor_name || "—"}</span>
                          {row.customer_name && row.customer_name !== "—" && (
                            <div style={{ fontSize: 11, color: "#64748b" }}>Cust: {row.customer_name}</div>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontWeight: 600, color: "#0f172a" }}>{row.customer_name || "—"}</span>
                      )}
                    </td>
                    <td className="right" style={{ verticalAlign: "top", textAlign: "right", fontWeight: 600 }}>
                      {formatQuantity(row.quantity)}
                    </td>
                    <td className="right" style={{ verticalAlign: "top", textAlign: "right", color: "#64748b" }}>
                      ₹{formatINR(row.source_rate)}
                    </td>
                    <td className="right" style={{ verticalAlign: "top", textAlign: "right", fontWeight: 700, color: isPurchase ? "#16a34a" : "#2563eb" }}>
                      ₹{formatINR(row.effective_rate)}
                    </td>
                    <td className="right amount" style={{ verticalAlign: "top", textAlign: "right", fontWeight: 600, color: "#0f172a" }}>
                      ₹{formatINR(row.taxable_amount)}
                    </td>
                    <td style={{ textAlign: "center", verticalAlign: "top" }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDocumentDrawer(row.document_type, row.document_id);
                        }}
                        className="btn btn-sm"
                        style={{ fontSize: 10.5, padding: "2px 6px" }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Document Detail Drawer (Zero Zoho API Calls, Local SQLite) */}
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
              {/* Summary Cards */}
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
        reportType="price-reference"
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
    </div>
  );
}

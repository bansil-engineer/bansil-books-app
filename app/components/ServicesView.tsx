"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { formatINR, formatQuantity, formatDisplayDate } from "@/app/lib/date-utils";
import { deduplicateFilterOptions } from "@/app/lib/dropdown-utils";
import { ExportDialog } from "./ExportDialog";
import type { ExportOptions } from "@/app/types/reconciliation";

interface ServicesViewProps {
  subView?: "summary" | "purchases" | "sales" | "transactions" | "reconciliation";
  financialYear: string;
}

interface ServiceSummaryData {
  totalPurchaseAmount: number;
  totalPurchaseQty: number;
  totalPurchaseLines: number;
  totalSalesAmount: number;
  totalSalesQty: number;
  totalSalesLines: number;
  serviceMarginAmount: number;
  serviceMarginPercent: number;
}

interface ServiceLine {
  id: string;
  type: "PURCHASE" | "SALE";
  date: string;
  documentNumber: string;
  documentUrl?: string;
  customerName: string;
  vendorName: string;
  itemName: string;
  sku?: string;
  quantity: number;
  rate: number;
  amount: number;
  status: string;
}

export function ServicesView({
  subView = "summary",
  financialYear,
}: ServicesViewProps) {
  const [activeTab, setActiveTab] = useState<
    "summary" | "purchases" | "sales" | "transactions" | "reconciliation"
  >(subView);

  useEffect(() => {
    setActiveTab(subView);
  }, [subView]);

  // Filters
  const [period, setPeriod] = useState<string>(financialYear);
  const [isCustomDate, setIsCustomDate] = useState<boolean>(false);
  const [fromDate, setFromDate] = useState<string>("2026-04-01");
  const [toDate, setToDate] = useState<string>("2026-09-11");
  const [search, setSearch] = useState<string>("");
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<string>("");

  const [loading, setLoading] = useState<boolean>(true);
  const [showExportDialog, setShowExportDialog] = useState<boolean>(false);

  // Data states
  const [summary, setSummary] = useState<ServiceSummaryData>({
    totalPurchaseAmount: 0,
    totalPurchaseQty: 0,
    totalPurchaseLines: 0,
    totalSalesAmount: 0,
    totalSalesQty: 0,
    totalSalesLines: 0,
    serviceMarginAmount: 0,
    serviceMarginPercent: 0,
  });

  const [transactions, setTransactions] = useState<ServiceLine[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    setPeriod(financialYear);
  }, [financialYear]);

  const fetchServiceData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("financialYear", period);
      params.set("classification", "SERVICE");
      if (isCustomDate && fromDate && toDate) {
        params.set("fromDate", fromDate);
        params.set("toDate", toDate);
      }
      if (search) params.set("search", search);
      if (selectedCustomer) params.set("customerId", selectedCustomer);
      if (selectedVendor) params.set("vendorId", selectedVendor);
      if (selectedItem) params.set("itemId", selectedItem);

      // Fetch from breakdown / mismatch endpoint with classification=SERVICE
      const res = await fetch(`/api/inventory-mismatch?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        const report = json.report;
        if (report) {
          const txLines: ServiceLine[] = (report.transactionLines || []).map(
            (t: any) => ({
              // Section 5: Canonical key purchase:{billId}:{lineItemId} or sales:{invoiceId}:{lineItemId}
              id: t.canonicalId || (t.type === "PURCHASE" ? `purchase-${t.billId}-${t.lineItemId}` : `sales-${t.invoiceId}-${t.lineItemId}`),
              type: t.type,
              date: t.date,
              documentNumber: t.docNumber || t.documentNo || "",
              // Section 1, 2, 4: Customer comes strictly from line details, Vendor from Bill supplier
              customerName: t.customerName || (t.type === "PURCHASE" ? "CUSTOMER DETAILS MISSING" : "—"),
              vendorName: t.type === "PURCHASE" ? (t.vendorName || "—") : "—",
              itemName: t.itemName || t.item || "Service Item",
              sku: t.sku || "",
              quantity: Number(t.quantity ?? t.qty) || 0,
              rate: Number(t.rate) || 0,
              amount: Number(t.amount) || 0,
              status: t.status || "SYNCED",
            })
          );

          setTransactions(txLines);

          const purchLines = txLines.filter((t) => t.type === "PURCHASE");
          const salesLines = txLines.filter((t) => t.type === "SALE");

          const totalPurchAmt = purchLines.reduce((acc, t) => acc + t.amount, 0);
          const totalPurchQty = purchLines.reduce((acc, t) => acc + t.quantity, 0);
          const totalSalesAmt = salesLines.reduce((acc, t) => acc + t.amount, 0);
          const totalSalesQty = salesLines.reduce((acc, t) => acc + t.quantity, 0);

          const marginAmt = totalSalesAmt - totalPurchAmt;
          const marginPct =
            totalSalesAmt > 0 ? (marginAmt / totalSalesAmt) * 100 : 0;

          setSummary({
            totalPurchaseAmount: totalPurchAmt,
            totalPurchaseQty: totalPurchQty,
            totalPurchaseLines: purchLines.length,
            totalSalesAmount: totalSalesAmt,
            totalSalesQty: totalSalesQty,
            totalSalesLines: salesLines.length,
            serviceMarginAmount: marginAmt,
            serviceMarginPercent: marginPct,
          });

          if (report.filterOptions) {
            const newCusts = report.filterOptions.customers || [];
            const newVends = report.filterOptions.vendors || [];
            const newItms = report.filterOptions.items || [];
            setCustomers(newCusts);
            setVendors(newVends);
            setItems(newItms);

            // Safe dependent filter validation (Section 26)
            if (selectedCustomer && !newCusts.some((c: any) => c.id === selectedCustomer || c.name === selectedCustomer)) {
              setSelectedCustomer("");
            }
            if (selectedVendor && !newVends.some((v: any) => v.id === selectedVendor || v.name === selectedVendor)) {
              setSelectedVendor("");
            }
            if (selectedItem && !newItms.some((i: any) => i.id === selectedItem || i.name === selectedItem)) {
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
  }, [
    period,
    isCustomDate,
    fromDate,
    toDate,
    search,
    selectedCustomer,
    selectedVendor,
    selectedItem,
  ]);

  useEffect(() => {
    fetchServiceData();
  }, [fetchServiceData]);

  const uniqueCustomers = useMemo(
    () => deduplicateFilterOptions(customers),
    [customers]
  );
  const uniqueVendors = useMemo(
    () => deduplicateFilterOptions(vendors),
    [vendors]
  );
  const uniqueItems = useMemo(
    () => deduplicateFilterOptions(items),
    [items]
  );

  const purchaseTransactions = useMemo(
    () => transactions.filter((t) => t.type === "PURCHASE"),
    [transactions]
  );

  const salesTransactions = useMemo(
    () => transactions.filter((t) => t.type === "SALE"),
    [transactions]
  );

  const handlePeriodChange = (val: string) => {
    setPeriod(val);
    if (val === "CUSTOM") {
      setIsCustomDate(true);
    } else {
      setIsCustomDate(false);
    }
  };

  const handleExecuteExport = async (options: ExportOptions) => {
    const params = new URLSearchParams({
      reportType: "services",
      period,
      financialYear: isCustomDate ? "CUSTOM" : period,
      fromDate: isCustomDate ? fromDate : "",
      toDate: isCustomDate ? toDate : "",
      classification: "SERVICE",
      search,
      includeTotals: options.includeTotals ? "true" : "false",
    });
    if (options.selectedFields && options.selectedFields.length > 0) {
      params.set("selectedFields", options.selectedFields.join(","));
    }
    const endpoint =
      options.format === "pdf" ? "/api/export/pdf" : "/api/export/excel";
    const res = await fetch(`${endpoint}?${params.toString()}`);
    if (!res.ok) throw new Error("Service export failed");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Bansil_Services_${period}_${new Date().toISOString().slice(0, 10)}.${options.format === "pdf" ? "pdf" : "xlsx"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const currentTabRecords = useMemo(() => {
    if (activeTab === "purchases") return purchaseTransactions;
    if (activeTab === "sales") return salesTransactions;
    return transactions;
  }, [activeTab, purchaseTransactions, salesTransactions, transactions]);

  return (
    <div className="section-card" style={{ padding: 24 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          borderBottom: "1px solid var(--border)",
          paddingBottom: 16,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            Services Module · 100% Partitioned
          </h2>
          <p
            style={{
              fontSize: 12.5,
              color: "var(--text-secondary)",
              margin: "4px 0 0 0",
            }}
          >
            Zero inventory distortion · Independent margin analytics · Dedicated
            accounting views
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            className="btn btn-sm"
            onClick={() => fetchServiceData()}
            style={{ height: 34 }}
          >
            ↻ Refresh Data
          </button>
          <button
            className="btn-export-excel btn-sm"
            onClick={() => setShowExportDialog(true)}
            style={{ height: 34, fontWeight: 600 }}
          >
            📥 Export Services
          </button>
        </div>
      </div>

      {/* Sub-view Navigation Tabs */}
      <div
        style={{
          display: "flex",
          gap: 6,
          borderBottom: "1px solid var(--border)",
          marginBottom: 20,
        }}
      >
        {[
          { id: "summary", label: "Overview & Margin" },
          { id: "purchases", label: `Purchase Bills (${purchaseTransactions.length})` },
          { id: "sales", label: `Sales Invoices (${salesTransactions.length})` },
          { id: "transactions", label: `All Transactions (${transactions.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              padding: "8px 16px",
              fontSize: 12.5,
              fontWeight: activeTab === tab.id ? 700 : 500,
              color:
                activeTab === tab.id
                  ? "var(--accent)"
                  : "var(--text-secondary)",
              borderBottom:
                activeTab === tab.id
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
              background: "none",
              borderTop: "none",
              borderLeft: "none",
              borderRight: "none",
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          background: "#f8fafc",
          padding: "12px 16px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          marginBottom: 20,
        }}
      >
        {/* Period */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
            PERIOD
          </label>
          <select
            value={period}
            onChange={(e) => handlePeriodChange(e.target.value)}
            style={{
              fontSize: 12,
              padding: "5px 10px",
              borderRadius: 4,
              border: "1px solid var(--border)",
            }}
          >
            <option value="2026-27">FY 2026-27 (Current)</option>
            <option value="2025-26">FY 2025-26 (Historical)</option>
            <option value="CUSTOM">Custom Date Range</option>
          </select>
        </div>

        {isCustomDate && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                FROM DATE
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                style={{
                  fontSize: 12,
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                TO DATE
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                style={{
                  fontSize: 12,
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                }}
              />
            </div>
          </>
        )}

        {/* Customer Selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
            CUSTOMER
          </label>
          <select
            value={selectedCustomer}
            onChange={(e) => setSelectedCustomer(e.target.value)}
            style={{
              fontSize: 12,
              padding: "5px 10px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              maxWidth: 180,
            }}
          >
            <option value="">All Customers</option>
            {uniqueCustomers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Vendor Selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
            VENDOR
          </label>
          <select
            value={selectedVendor}
            onChange={(e) => setSelectedVendor(e.target.value)}
            style={{
              fontSize: 12,
              padding: "5px 10px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              maxWidth: 180,
            }}
          >
            <option value="">All Vendors</option>
            {uniqueVendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        {/* Item Selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
            SERVICE ITEM
          </label>
          <select
            value={selectedItem}
            onChange={(e) => setSelectedItem(e.target.value)}
            style={{
              fontSize: 12,
              padding: "5px 10px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              maxWidth: 200,
            }}
          >
            <option value="">All Service Items</option>
            {uniqueItems.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 180 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
            SEARCH
          </label>
          <input
            type="text"
            placeholder="Doc No, Item, Party..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              fontSize: 12,
              padding: "5px 10px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              width: "100%",
            }}
          />
        </div>

        <button
          className="btn btn-sm"
          onClick={() => {
            setSearch("");
            setSelectedCustomer("");
            setSelectedVendor("");
            setSelectedItem("");
          }}
          style={{ height: 32 }}
        >
          Reset
        </button>
      </div>

      {/* KPI Cards Strip */}
      <div
        className="kpi-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div className="kpi-card" style={{ background: "#f8fafc", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "#64748b" }}>SERVICE PURCHASES</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b", margin: "4px 0" }}>
            ₹{formatINR(summary.totalPurchaseAmount)}
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            {summary.totalPurchaseLines} Lines · {formatQuantity(summary.totalPurchaseQty)} Units
          </div>
        </div>

        <div className="kpi-card" style={{ background: "#f0fdf4", padding: 16, borderRadius: 8, border: "1px solid #bbf7d0" }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "#166534" }}>SERVICE SALES</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#15803d", margin: "4px 0" }}>
            ₹{formatINR(summary.totalSalesAmount)}
          </div>
          <div style={{ fontSize: 12, color: "#166534" }}>
            {summary.totalSalesLines} Lines · {formatQuantity(summary.totalSalesQty)} Units
          </div>
        </div>

        <div className="kpi-card" style={{ background: summary.serviceMarginAmount >= 0 ? "#eff6ff" : "#fef2f2", padding: 16, borderRadius: 8, border: `1px solid ${summary.serviceMarginAmount >= 0 ? "#bfdbfe" : "#fecaca"}` }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: summary.serviceMarginAmount >= 0 ? "#1e40af" : "#991b1b" }}>SERVICE MARGIN (SALES - PURCH)</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: summary.serviceMarginAmount >= 0 ? "#1d4ed8" : "#b91c1c", margin: "4px 0" }}>
            ₹{formatINR(summary.serviceMarginAmount)}
          </div>
          <div style={{ fontSize: 12, color: summary.serviceMarginAmount >= 0 ? "#1e40af" : "#991b1b" }}>
            {summary.serviceMarginPercent.toFixed(1)}% Margin
          </div>
        </div>
      </div>

      {/* Main Table Content */}
      <div className="table-responsive" style={{ border: "1px solid var(--border)", borderRadius: 8 }}>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: "var(--bg-subtle)", borderBottom: "2px solid var(--border)" }}>
              <th style={{ width: 40, textAlign: "center", padding: "10px 8px" }}>Sr</th>
              <th style={{ width: 90, textAlign: "center", padding: "10px 8px" }}>Type</th>
              <th style={{ width: 100, padding: "10px 8px" }}>Date</th>
              <th style={{ width: 120, padding: "10px 8px" }}>Document No.</th>
              <th style={{ padding: "10px 8px" }}>Customer</th>
              <th style={{ padding: "10px 8px" }}>Vendor</th>
              <th style={{ padding: "10px 8px" }}>Service Item</th>
              <th style={{ width: 80, textAlign: "right", padding: "10px 8px" }}>Qty</th>
              <th style={{ width: 100, textAlign: "right", padding: "10px 8px" }}>Rate</th>
              <th style={{ width: 120, textAlign: "right", padding: "10px 8px" }}>Amount (₹)</th>
              <th style={{ width: 90, textAlign: "center", padding: "10px 8px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} style={{ textAlign: "center", padding: 32, color: "var(--text-secondary)" }}>
                  Loading service records from local SQLite cache…
                </td>
              </tr>
            ) : currentTabRecords.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: "center", padding: 32, color: "var(--text-secondary)" }}>
                  No service records found for the selected period and filters.
                </td>
              </tr>
            ) : (
              currentTabRecords.map((row, idx) => (
                <tr key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                  <td style={{ textAlign: "center" }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 10.5,
                        fontWeight: 700,
                        background: row.type === "PURCHASE" ? "#f1f5f9" : "#dcfce7",
                        color: row.type === "PURCHASE" ? "#334155" : "#166534",
                      }}
                    >
                      {row.type}
                    </span>
                  </td>
                  <td>{formatDisplayDate(row.date)}</td>
                  <td style={{ fontWeight: 600 }}>{row.documentNumber}</td>
                  <td style={{ fontWeight: 500 }}>{row.customerName}</td>
                  <td>{row.vendorName}</td>
                  <td>{row.itemName}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                    {formatQuantity(row.quantity)}
                  </td>
                  <td style={{ textAlign: "right" }}>₹{formatINR(row.rate)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>
                    ₹{formatINR(row.amount)}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span className="badge-enabled">{row.status}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        onExport={handleExecuteExport}
        reportType="services"
        filter={{
          financialYear: isCustomDate ? "CUSTOM" : period,
          period,
          fromDate: isCustomDate ? fromDate : undefined,
          toDate: isCustomDate ? toDate : undefined,
          customerId: selectedCustomer || undefined,
          vendorName: selectedVendor || undefined,
          itemId: selectedItem || undefined,
          search: search || undefined,
          classification: "SERVICE",
        }}
        totalRecords={currentTabRecords.length}
      />
    </div>
  );
}

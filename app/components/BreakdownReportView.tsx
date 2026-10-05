"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import type {
  ReconciliationReportResult,
  MasterInventoryMismatchReportResult,
  ExportOptions,
  ItemClassification,
} from "@/app/types/reconciliation";
import { formatINR, formatDisplayDate } from "@/app/lib/date-utils";
import { ExportDialog } from "./ExportDialog";

function formatQuantity(qty: number): string {
  if (qty == null || isNaN(qty)) return "0";
  return Number.isInteger(qty)
    ? qty.toLocaleString("en-IN")
    : qty.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface BreakdownReportViewProps {
  report: ReconciliationReportResult | null;
  mismatchReport: MasterInventoryMismatchReportResult | null;
  financialYear: string;
  period: string;
  customerId: string;
  itemId: string;
  search: string;
  includeExcludedItems?: boolean;
  onPeriodChange?: (period: string) => void;
  onFinancialYearChange?: (fy: string) => void;
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

export function BreakdownReportView({
  report: _initialReport,
  mismatchReport: _initialMismatchReport,
  financialYear,
  period,
  customerId: initialCustomerId,
  itemId: initialItemId,
  search: initialSearch,
  includeExcludedItems = false,
  onPeriodChange,
  onFinancialYearChange,
}: BreakdownReportViewProps) {
  const [showExportDialog, setShowExportDialog] = useState<boolean>(false);
  const [downloadMessage, setDownloadMessage] = useState<string>("");
  const [classification, setClassification] = useState<ItemClassification>("MATERIAL");
  const [activeFy, setActiveFy] = useState<string>(financialYear || "2026-27");
  const [activePeriod, setActivePeriod] = useState<string>(period || "CURRENT_FY");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [search, setSearch] = useState<string>(initialSearch || "");
  const [customerId, setCustomerId] = useState<string>(initialCustomerId || "");
  const [itemId, setItemId] = useState<string>(initialItemId || "");

  const [loading, setLoading] = useState<boolean>(false);
  const [txLines, setTxLines] = useState<any[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);

  // Document Detail Drawer State
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
  const [loadingDocDetail, setLoadingDocDetail] = useState<boolean>(false);

  // Esc key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedDoc(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  // Sync props if changed externally
  useEffect(() => {
    if (financialYear) setActiveFy(financialYear);
  }, [financialYear]);

  useEffect(() => {
    if (period) setActivePeriod(period);
  }, [period]);

  useEffect(() => {
    if (initialCustomerId) setCustomerId(initialCustomerId);
  }, [initialCustomerId]);

  useEffect(() => {
    if (initialItemId) setItemId(initialItemId);
  }, [initialItemId]);

  // Fetch breakdown data from local SQLite
  const fetchBreakdownData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("financialYear", activeFy);
      params.set("period", activePeriod);
      if (activePeriod === "CUSTOM" && fromDate && toDate) {
        params.set("fromDate", fromDate);
        params.set("toDate", toDate);
      }
      if (classification) params.set("classification", classification);
      if (search) params.set("search", search);
      if (customerId) params.set("customerId", customerId);
      if (itemId) params.set("itemId", itemId);

      const res = await fetch(`/api/inventory-mismatch?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        const rep = json.report;
        if (rep) {
          setTxLines(rep.transactionLines || []);
          if (rep.filterOptions) {
            const newCusts = rep.filterOptions.customers || [];
            const newItms = rep.filterOptions.items || [];
            setCustomers(newCusts);
            setItems(newItms);

            // Safe dependent filter validation (Section 26)
            if (customerId && !newCusts.some((c: any) => c.id === customerId || c.name === customerId)) {
              setCustomerId("");
            }
            if (itemId && !newItms.some((i: any) => i.id === itemId || i.name === itemId)) {
              setItemId("");
            }
          }
        }
      }
    } catch {
      // offline fallback
    } finally {
      setLoading(false);
    }
  }, [activeFy, activePeriod, fromDate, toDate, classification, search, customerId, itemId]);

  useEffect(() => {
    fetchBreakdownData();
  }, [fetchBreakdownData]);

  const handleOpenExportDialog = () => {
    setShowExportDialog(true);
  };

  const handleExecuteExport = async (options: ExportOptions) => {
    setDownloadMessage("Generating Full Breakdown export locally...");
    const params = new URLSearchParams();
    params.set("reportType", "full-breakdown");
    if (activeFy) params.set("financialYear", activeFy);
    if (activePeriod) params.set("period", activePeriod);
    if (activePeriod === "CUSTOM") {
      if (fromDate) params.set("fromDate", fromDate);
      if (toDate) params.set("toDate", toDate);
    }
    if (classification) params.set("classification", classification);
    if (customerId) params.set("customerId", customerId);
    if (itemId) params.set("itemId", itemId);
    if (search) params.set("search", search);
    if (options.includeTotals !== undefined) params.set("includeTotals", options.includeTotals ? "true" : "false");
    if (options.selectedFields && options.selectedFields.length > 0) {
      params.set("selectedFields", options.selectedFields.join(","));
    }

    const endpoint = options.format === "pdf" ? "/api/export/pdf" : "/api/export/excel";
    const res = await fetch(`${endpoint}?${params.toString()}`);
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || "Failed to generate Full Breakdown export");
    }

    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition");
    let filename = `Bansil_Full_Breakdown_Report_${activeFy || "export"}.${options.format === "pdf" ? "pdf" : "xlsx"}`;
    if (disposition && disposition.includes("filename=")) {
      filename = disposition.split("filename=")[1].replace(/["']/g, "");
    }

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);

    setDownloadMessage(`✓ Downloaded ${filename}`);
    setTimeout(() => setDownloadMessage(""), 4000);
  };

  // Filter transaction lines based on classification and search
  const filteredTxLines = useMemo(() => {
    return txLines.filter((tx) => {
      // Classification filter
      if (classification === "MATERIAL" && tx.classification === "SERVICE") return false;
      if (classification === "SERVICE" && tx.classification !== "SERVICE") return false;

      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const haystack = `${tx.customerName || ""} ${tx.customerVendor || ""} ${tx.vendorName || ""} ${tx.itemName || ""} ${tx.docNumber || ""} ${tx.sku || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      // Customer filter
      if (customerId) {
        const cNorm = customerId.toLowerCase().trim();
        const cName = (tx.customerName || tx.customerVendor || "").toLowerCase();
        if (!cName.includes(cNorm) && tx.customerId !== customerId) return false;
      }

      // Item filter
      if (itemId) {
        const iNorm = itemId.toLowerCase().trim();
        const iName = (tx.itemName || "").toLowerCase();
        if (!iName.includes(iNorm) && tx.itemId !== itemId) return false;
      }

      return true;
    });
  }, [txLines, classification, search, customerId, itemId]);

  // Compute independent totals
  const purchaseLines = useMemo(() => filteredTxLines.filter((tx) => tx.type === "PURCHASE"), [filteredTxLines]);
  const salesLines = useMemo(() => filteredTxLines.filter((tx) => tx.type === "SALE"), [filteredTxLines]);

  const totPurchQty = useMemo(() => purchaseLines.reduce((sum, tx) => sum + (Number(tx.quantity) || 0), 0), [purchaseLines]);
  const totPurchAmt = useMemo(() => purchaseLines.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0), [purchaseLines]);
  const totSalesQty = useMemo(() => salesLines.reduce((sum, tx) => sum + (Number(tx.quantity) || 0), 0), [salesLines]);
  const totSalesAmt = useMemo(() => salesLines.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0), [salesLines]);
  const balanceQty = totPurchQty - totSalesQty;

  const handlePeriodSelect = (p: string) => {
    setActivePeriod(p);
    if (p === "PREVIOUS_FY") {
      setActiveFy("2025-26");
      if (onFinancialYearChange) onFinancialYearChange("2025-26");
    } else if (p === "CURRENT_FY") {
      setActiveFy("2026-27");
      if (onFinancialYearChange) onFinancialYearChange("2026-27");
    }
    if (onPeriodChange) onPeriodChange(p);
  };

  return (
    <div className="section-card" style={{ padding: 20 }}>
      {/* Header */}
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div className="section-title-group">
          <h2 className="section-title">Global Breakdown Report</h2>
          <span className="section-badge">
            {filteredTxLines.length} Independent Source Transactions · Full Breakdown · Local SQLite
          </span>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            className="btn-export-excel"
            onClick={handleOpenExportDialog}
            style={{ fontWeight: 600 }}
            id="btn-open-full-breakdown-export"
          >
            <span>📥</span>
            <span>Download Full Breakdown</span>
          </button>
        </div>
      </div>

      {downloadMessage && (
        <div
          style={{
            marginBottom: 14,
            fontSize: 12,
            fontWeight: 500,
            color: downloadMessage.includes("⚠️") ? "var(--google-red)" : "var(--google-green)",
          }}
        >
          {downloadMessage}
        </div>
      )}

      {/* Filter Controls Bar */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          padding: "12px 16px",
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        {/* Period Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Period:</label>
          <select
            value={activePeriod}
            onChange={(e) => handlePeriodSelect(e.target.value)}
            className="filter-select"
            style={{ padding: "5px 10px", fontSize: 12 }}
            id="breakdown-period-select"
          >
            <option value="CURRENT_FY">FY 2026-27 (Current)</option>
            <option value="PREVIOUS_FY">FY 2025-26 (Previous)</option>
            <option value="ALL_FY">All Financial Years</option>
            <option value="TODAY">Today</option>
            <option value="THIS_MONTH">This Month</option>
            <option value="THIS_QUARTER">This Quarter</option>
            <option value="CUSTOM">Custom Date Range</option>
          </select>
        </div>

        {/* Custom Date Inputs */}
        {activePeriod === "CUSTOM" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 12, color: "#475569" }}>From:</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="filter-input"
              style={{ padding: "4px 8px", fontSize: 12 }}
            />
            <label style={{ fontSize: 12, color: "#475569" }}>To:</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="filter-input"
              style={{ padding: "4px 8px", fontSize: 12 }}
            />
          </div>
        )}

        {/* Report Type Selector (Section 7) */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Report Type:</label>
          <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input
                type="radio"
                name="classification"
                value="MATERIAL"
                checked={classification === "MATERIAL"}
                onChange={() => setClassification("MATERIAL")}
              />
              Material
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input
                type="radio"
                name="classification"
                value="SERVICE"
                checked={classification === "SERVICE"}
                onChange={() => setClassification("SERVICE")}
              />
              Services
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input
                type="radio"
                name="classification"
                value="ALL"
                checked={classification === "ALL"}
                onChange={() => setClassification("ALL")}
              />
              All
            </label>
          </div>
        </div>

        {/* Search */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <input
            type="text"
            placeholder="Search transactions, bills, invoices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="filter-input"
            style={{ padding: "5px 10px", fontSize: 12, width: 240 }}
          />
        </div>
      </div>

      {/* KPI Cards Strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div className="kpi-card" style={{ padding: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>
            Purchase Source Lines
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
            {purchaseLines.length} Bills ({totPurchQty.toLocaleString("en-IN", { maximumFractionDigits: 3 })} Qty)
          </div>
          <div style={{ fontSize: 12, color: "#16a34a", fontWeight: 600, marginTop: 2 }}>
            ₹{formatINR(totPurchAmt)}
          </div>
        </div>

        <div className="kpi-card" style={{ padding: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>
            Sales Source Lines
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
            {salesLines.length} Invoices ({totSalesQty.toLocaleString("en-IN", { maximumFractionDigits: 3 })} Qty)
          </div>
          <div style={{ fontSize: 12, color: "#2563eb", fontWeight: 600, marginTop: 2 }}>
            ₹{formatINR(totSalesAmt)}
          </div>
        </div>

        <div className="kpi-card" style={{ padding: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>
            Balance Quantity
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: balanceQty === 0 ? "#16a34a" : balanceQty > 0 ? "#d97706" : "#dc2626",
              marginTop: 2,
            }}
          >
            {balanceQty.toLocaleString("en-IN", { maximumFractionDigits: 3 })}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {balanceQty === 0 ? "Fully Balanced" : balanceQty > 0 ? "Surplus / In Stock" : "Shortfall"}
          </div>
        </div>

        <div className="kpi-card" style={{ padding: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>
            Classification Scope
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
            {classification === "MATERIAL" ? "Material Only" : classification === "SERVICE" ? "Services Only" : "All Items & Services"}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            Zero Cartesian join
          </div>
        </div>

        <div className="kpi-card" style={{ padding: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>
            Total Transaction Lines
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
            {filteredTxLines.length}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            Local SQLite Source
          </div>
        </div>
      </div>

      {/* Ledger-style Preview Table */}
      <div className="table-responsive" style={{ minHeight: 400 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 35, textAlign: "center" }}>Sr</th>
              <th style={{ width: 75, textAlign: "center" }}>Type</th>
              <th style={{ width: 85 }}>Date</th>
              <th>Customer</th>
              <th>Item / Service</th>
              <th>Document No</th>
              <th>Vendor</th>
              <th className="right" style={{ width: 65 }}>Qty</th>
              <th className="right" style={{ width: 80 }}>Rate</th>
              <th className="right" style={{ width: 95 }}>Amount</th>
              {/* Section 9: Hide Classification column for Material or Services, show only for All */}
              {classification === "ALL" && (
                <th style={{ width: 80, textAlign: "center" }}>Class</th>
              )}
              <th style={{ width: 85, textAlign: "center" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={classification === "ALL" ? 12 : 11} style={{ textAlign: "center", padding: 36, color: "var(--text-secondary)" }}>
                  Loading transactions from local SQLite…
                </td>
              </tr>
            ) : filteredTxLines.length === 0 ? (
              <tr>
                <td colSpan={classification === "ALL" ? 12 : 11} style={{ textAlign: "center", padding: 36, color: "var(--text-secondary)" }}>
                  No transaction breakdown records found for the active filter.
                </td>
              </tr>
            ) : (
              filteredTxLines.map((tx, idx) => {
                const isPurchase = tx.type === "PURCHASE";
                // Section 5: Canonical key purchase:{billId}:{lineItemId} or sales:{invoiceId}:{lineItemId}
                const rowKey = tx.canonicalId || (isPurchase ? `purchase-${tx.billId}-${tx.lineItemId}` : `sales-${tx.invoiceId}-${tx.lineItemId}`);
                return (
                  <tr key={rowKey}>
                    <td style={{ textAlign: "center", color: "var(--text-secondary)" }}>{idx + 1}</td>
                    <td style={{ textAlign: "center" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                          background: isPurchase ? "#f0fdf4" : "#eff6ff",
                          color: isPurchase ? "#16a34a" : "#2563eb",
                          border: `1px solid ${isPurchase ? "#bbf7d0" : "#bfdbfe"}`,
                        }}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td>{formatDisplayDate(tx.date)}</td>
                    {/* Section 1 & 2: Purchase Customer from Line Details; Section 3: Sales Customer from Invoice */}
                    <td style={{ fontWeight: 500 }}>
                      {tx.customerName || (isPurchase ? "CUSTOMER DETAILS MISSING" : "—")}
                    </td>
                    <td>{tx.itemName || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600 }}>
                      <button
                        type="button"
                        onClick={() =>
                          isPurchase
                            ? openBillDrawer(tx.billId || tx.docNumber || tx.documentNo)
                            : openInvoiceDrawer(tx.invoiceId || tx.docNumber || tx.documentNo)
                        }
                        style={{
                          background: "none",
                          border: "none",
                          color: "#0f766e",
                          cursor: "pointer",
                          textDecoration: "underline",
                          padding: 0,
                          fontWeight: 700,
                          fontFamily: "monospace",
                          fontSize: 12,
                        }}
                      >
                        {tx.docNumber || tx.documentNo || "—"}
                      </button>
                    </td>
                    {/* Section 1 & 2: Purchase Vendor from Bill supplier; Section 3: Sales Vendor is blank / "—" */}
                    <td>{isPurchase ? (tx.vendorName || "—") : "—"}</td>
                    <td className="right" style={{ fontWeight: 600 }}>
                      {tx.quantity?.toLocaleString("en-IN", { maximumFractionDigits: 3 }) ?? "0"}
                    </td>
                    <td className="right amount">₹{formatINR(Number(tx.rate) || 0)}</td>
                    <td className="right amount" style={{ fontWeight: 600 }}>
                      ₹{formatINR(Number(tx.amount) || 0)}
                    </td>
                    {/* Section 9: Classification column conditional visibility */}
                    {classification === "ALL" && (
                      <td style={{ textAlign: "center" }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "1px 5px",
                            borderRadius: 3,
                            background: tx.classification === "SERVICE" ? "#fdf4ff" : "#f1f5f9",
                            color: tx.classification === "SERVICE" ? "#9333ea" : "#475569",
                            border: `1px solid ${tx.classification === "SERVICE" ? "#f0abfc" : "#cbd5e1"}`,
                          }}
                        >
                          {tx.classification || "MATERIAL"}
                        </span>
                      </td>
                    )}
                    <td style={{ textAlign: "center" }}>
                      <span className="badge-enabled">{tx.status || "VERIFIED"}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

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

      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        onExport={handleExecuteExport}
        reportType="full-breakdown"
        filter={{
          financialYear: activeFy,
          period: activePeriod,
          fromDate: activePeriod === "CUSTOM" ? fromDate : undefined,
          toDate: activePeriod === "CUSTOM" ? toDate : undefined,
          customerId,
          itemId,
          search,
          classification,
          includeExcludedItems,
        }}
        totalRecords={filteredTxLines.length}
      />
    </div>
  );
}

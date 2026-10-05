"use client";

// ============================================================
// Bansil Books Analytics — Item Detail Drawer
// Universal Item Drilldown & Movement Screen
// STRICTLY READ-ONLY · ZERO ZOHO API CALLS · LOCAL SQLITE ONLY
// ============================================================

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { formatINR, formatQuantity, formatDisplayDate } from "@/app/lib/date-utils";
import { isStockItemExcludable } from "@/app/lib/stock-utils";
import type { ItemStockDetail, CustomerMovement } from "@/app/lib/stock-engine";
import { ExclusionDialog } from "./ExclusionDialog";
import { LocalBillDrawer, LocalInvoiceDrawer } from "./LocalDocumentDrawer";
import { VendorDetailDrawer } from "./VendorDetailDrawer";
import { DateDetailDrawer } from "./DateDetailDrawer";
import { ExportFieldSelector } from "./ExportFieldSelector";
import type { ExportOptions } from "@/app/types/reconciliation";

export interface ItemDetailDrawerProps {
  itemId: string;
  itemName?: string;
  financialYear: string;
  initialCustomerId?: string;
  initialCustomerName?: string;
  onClose: () => void;
  onOpenBill?: (billId: string) => void;
  onOpenInvoice?: (invoiceId: string) => void;
  onNavigateToCustomer?: (customerId: string, customerName?: string, preferredTab?: "OVERVIEW" | "RECONCILIATION") => void;
  onExclusionSuccess?: () => void;
}

type TabType = "overview" | "purchase" | "sales" | "customers" | "price" | "reconciliation" | "assembly";

export function ItemDetailDrawer({
  itemId,
  itemName: initialItemName,
  financialYear,
  initialCustomerId,
  initialCustomerName,
  onClose,
  onOpenBill: _onOpenBill,
  onOpenInvoice: _onOpenInvoice,
  onNavigateToCustomer,
  onExclusionSuccess,
}: ItemDetailDrawerProps) {
  const [detail, setDetail] = useState<ItemStockDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(initialCustomerId || null);
  const [selectedCustomerName, setSelectedCustomerName] = useState<string | null>(initialCustomerName || null);
  const [viewAllCustomers, setViewAllCustomers] = useState<boolean>(!initialCustomerId);
  const [showExclusionDialog, setShowExclusionDialog] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Nested Navigation Drawers State (Local, zero refresh, state preserved)
  const [nestedBillId, setNestedBillId] = useState<string | null>(null);
  const [nestedInvoiceId, setNestedInvoiceId] = useState<string | null>(null);
  const [nestedVendor, setNestedVendor] = useState<{ vendorName: string; vendorId?: string } | null>(null);
  const [nestedDate, setNestedDate] = useState<string | null>(null);
  const [nestedItem, setNestedItem] = useState<{ itemId: string; itemName?: string } | null>(null);

  // Esc key listener (only close self if no nested drawer is open)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (nestedBillId) setNestedBillId(null);
        else if (nestedInvoiceId) setNestedInvoiceId(null);
        else if (nestedVendor) setNestedVendor(null);
        else if (nestedDate) setNestedDate(null);
        else if (nestedItem) setNestedItem(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, nestedBillId, nestedInvoiceId, nestedVendor, nestedDate, nestedItem]);

  // Fetch item detail from local SQLite stock API
  const fetchItemDetail = useCallback(async () => {
    if (!itemId) return;
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        action: "detail",
        itemId,
        financialYear,
      });
      const res = await fetch(`/api/stock?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 404 && data.excluded) {
          setError("Item is excluded from reconciliation.");
        } else {
          setError(data.error || "Failed to load item detail.");
        }
        setDetail(null);
        return;
      }
      const data = await res.json();
      if (data.detail) {
        setDetail(data.detail);
        if (selectedCustomerId && !selectedCustomerName) {
          const match = data.detail.customerMovements?.find(
            (c: CustomerMovement) => c.customerId === selectedCustomerId
          );
          if (match) setSelectedCustomerName(match.customerName);
        }
      } else {
        setError("Item not found");
      }
    } catch (err) {
      console.error("[ItemDetailDrawer] Fetch error:", err);
      setError("Failed to load item details from local database.");
    } finally {
      setLoading(false);
    }
  }, [itemId, financialYear, selectedCustomerId, selectedCustomerName]);

  useEffect(() => {
    fetchItemDetail();
  }, [fetchItemDetail]);

  // Click Handlers for Nested Evidence Navigation
  const handleOpenBill = (billId: string) => {
    setNestedBillId(billId);
  };

  const handleOpenInvoice = (invoiceId: string) => {
    setNestedInvoiceId(invoiceId);
  };

  const handleOpenVendor = (vendorName: string, vendorId?: string) => {
    setNestedVendor({ vendorName, vendorId });
  };

  const handleOpenDate = (date: string) => {
    setNestedDate(date);
  };

  const handleOpenItem = (newItemId: string, newItemName?: string) => {
    setNestedItem({ itemId: newItemId, itemName: newItemName });
  };

  const handleCustomerClick = (customerId?: string | null, customerName?: string, preferredTab: "OVERVIEW" | "RECONCILIATION" = "OVERVIEW") => {
    if (customerName && customerName !== "UNMAPPED") {
      onNavigateToCustomer?.(customerId || "", customerName, preferredTab);
    }
  };

  // Filter purchase & sales lines based on customer context
  const isCustomerScoped = !!selectedCustomerId && !viewAllCustomers;

  const displayPurchaseLines = useMemo(() => {
    if (!detail?.purchaseLines) return [];
    if (!isCustomerScoped) return detail.purchaseLines;
    return detail.purchaseLines.filter((p) => {
      if (selectedCustomerId && p.customerId === selectedCustomerId) return true;
      if (selectedCustomerName && p.customerName?.toLowerCase() === selectedCustomerName.toLowerCase()) return true;
      return false;
    });
  }, [detail, isCustomerScoped, selectedCustomerId, selectedCustomerName]);

  const displaySalesLines = useMemo(() => {
    if (!detail?.salesLines) return [];
    if (!isCustomerScoped) return detail.salesLines;
    return detail.salesLines.filter((s) => {
      if (selectedCustomerId && s.customerId === selectedCustomerId) return true;
      if (selectedCustomerName && s.customerName?.toLowerCase() === selectedCustomerName.toLowerCase()) return true;
      return false;
    });
  }, [detail, isCustomerScoped, selectedCustomerId, selectedCustomerName]);

  // Dynamic Metrics depending on Customer Scope
  const metrics = useMemo(() => {
    if (!detail) {
      return {
        purchaseQty: 0,
        salesQty: 0,
        balanceQty: 0,
        stockQty: 0,
        yetToPurchase: 0,
        yetToSale: 0,
        reconciledQty: 0,
        latestPurchaseRate: 0,
        latestSalesRate: 0,
        approxStockValue: 0,
        stockStatus: "OUT_OF_STOCK",
      };
    }

    if (!isCustomerScoped) {
      const pQty = detail.effectivePurchaseQty ?? detail.rawPurchaseQty ?? 0;
      const sQty = detail.salesQty ?? 0;
      const bal = detail.stockQty ?? (pQty - sQty);
      const rec = Math.min(pQty, sQty);
      const ytp = Math.max(0, sQty - pQty);
      const yts = Math.max(0, pQty - sQty);

      return {
        purchaseQty: pQty,
        salesQty: sQty,
        balanceQty: bal,
        stockQty: bal,
        yetToPurchase: ytp,
        yetToSale: yts,
        reconciledQty: rec,
        latestPurchaseRate: detail.latestPurchaseRate,
        latestSalesRate: detail.latestSalesRate,
        approxStockValue: detail.approxStockValue ?? 0,
        stockStatus: detail.status,
      };
    }

    // Customer scoped calculation
    const pQty = displayPurchaseLines.reduce((sum, p) => sum + p.quantity, 0);
    const sQty = displaySalesLines.reduce((sum, s) => sum + s.quantity, 0);
    const bal = pQty - sQty;
    const rec = Math.min(pQty, sQty);
    const ytp = Math.max(0, sQty - pQty);
    const yts = Math.max(0, pQty - sQty);
    const rate = detail.latestPurchaseRate || 0;
    const approxVal = bal * rate;
    const status = bal > 0 ? "SURPLUS" : bal < 0 ? "SHORTAGE" : "RECONCILED";

    return {
      purchaseQty: Math.round(pQty * 100) / 100,
      salesQty: Math.round(sQty * 100) / 100,
      balanceQty: Math.round(bal * 100) / 100,
      stockQty: Math.round(bal * 100) / 100,
      yetToPurchase: Math.round(ytp * 100) / 100,
      yetToSale: Math.round(yts * 100) / 100,
      reconciledQty: Math.round(rec * 100) / 100,
      latestPurchaseRate: detail.latestPurchaseRate,
      latestSalesRate: detail.latestSalesRate,
      approxStockValue: Math.round(approxVal * 100) / 100,
      stockStatus: status,
    };
  }, [detail, isCustomerScoped, displayPurchaseLines, displaySalesLines]);

  // Export Single Item
  const [showExportModal, setShowExportModal] = useState(false);

  const handleExecuteExport = async (options: ExportOptions) => {
    if (!detail) return;
    try {
      setExporting(true);
      const endpoint = options.format === "pdf" ? "/api/export/pdf" : "/api/export/excel";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType: "item-detail",
          itemId: detail.itemId,
          financialYear,
          period: financialYear,
          customerId: isCustomerScoped ? selectedCustomerId : undefined,
          customerName: isCustomerScoped ? selectedCustomerName : undefined,
          selectedFields: options.selectedFields,
          includeTotals: options.includeTotals,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to generate item export");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeItem = (detail.itemName || "Item").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 25);
      a.download = `Bansil_Item_${safeItem}_${financialYear}_${new Date().toISOString().slice(0, 10)}.${options.format === "pdf" ? "pdf" : "xlsx"}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("[ItemDetailDrawer] Export error:", err);
      alert("Failed to export report.");
    } finally {
      setExporting(false);
      setShowExportModal(false);
    }
  };

  const hasAssembly = (detail?.assemblyConsumedDetails?.length || 0) > 0 || (detail?.assemblyGeneratedDetails?.length || 0) > 0;

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2100,
          display: "flex",
          justifyContent: "flex-end",
          background: "rgba(15, 23, 42, 0.45)",
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-drawer-title"
      >
        <div style={{ flex: 1 }} onClick={onClose} />
        <div
          style={{
            width: "min(1150px, 96vw)",
            background: "#ffffff",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            boxShadow: "-8px 0 32px rgba(0, 0, 0, 0.15)",
            position: "relative",
            zIndex: 2101,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top Header */}
          <div
            style={{
              padding: "16px 24px",
              borderBottom: "1px solid #e2e8f0",
              background: "#f8fafc",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1, paddingRight: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <h2
                    id="item-drawer-title"
                    style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0 }}
                  >
                    {detail?.itemName || initialItemName || "Item Detail"}
                  </h2>

                  {detail?.sku && (
                    <span
                      style={{
                        fontSize: 12,
                        color: "#475569",
                        background: "#e2e8f0",
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontFamily: "monospace",
                      }}
                    >
                      SKU: {detail.sku}
                    </span>
                  )}

                  {detail?.classification && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: detail.classification === "SERVICE" ? "#fef3c7" : detail.isComposite ? "#f3e8ff" : "#e0f2fe",
                        color: detail.classification === "SERVICE" ? "#92400e" : detail.isComposite ? "#6b21a8" : "#0369a1",
                      }}
                    >
                      {detail.classification.toUpperCase()}
                    </span>
                  )}

                  {/* Stock Status Badge */}
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: metrics.balanceQty > 0 ? "#dcfce7" : metrics.balanceQty < 0 ? "#fee2e2" : "#f1f5f9",
                      color: metrics.balanceQty > 0 ? "#15803d" : metrics.balanceQty < 0 ? "#b91c1c" : "#475569",
                    }}
                  >
                    {metrics.balanceQty > 0 ? "SURPLUS / IN STOCK" : metrics.balanceQty < 0 ? "SHORTAGE / NEGATIVE" : "BALANCED / ZERO"}
                  </span>
                </div>

                {/* Subheader info: Item ID, Customer Context, Period */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6, fontSize: 12, color: "#64748b", flexWrap: "wrap" }}>
                  <span>Item ID: <code style={{ color: "#0f172a" }}>{detail?.itemId || itemId}</code></span>
                  <span>·</span>
                  <span>Period: <strong>{financialYear}</strong></span>
                  <span>·</span>
                  {selectedCustomerId ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span>Customer:</span>
                      <strong
                        onClick={() => handleCustomerClick(selectedCustomerId, selectedCustomerName || undefined, "OVERVIEW")}
                        style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                        title="Open Customer Details 360"
                      >
                        {selectedCustomerName || selectedCustomerId}
                      </strong>
                      <button
                        onClick={() => setViewAllCustomers(!viewAllCustomers)}
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 4,
                          border: "1px solid #cbd5e1",
                          background: viewAllCustomers ? "#0284c7" : "#ffffff",
                          color: viewAllCustomers ? "#ffffff" : "#0f172a",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        {viewAllCustomers ? "Focused on All Customers" : "View All Customers"}
                      </button>
                    </span>
                  ) : (
                    <span>Customer Context: <em>All Customers</em></span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={() => setShowExportModal(true)}
                  disabled={exporting || loading}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#0f172a",
                    cursor: exporting ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                  title="Download Item Stock ledger (Excel / PDF)"
                >
                  <span>📥</span>
                  <span>{exporting ? "Exporting..." : "Download Excel / PDF..."}</span>
                </button>

                {!isStockItemExcludable({ stockQty: metrics.stockQty, status: detail?.status }) ? (
                  <span
                    style={{
                      padding: "5px 10px",
                      borderRadius: 6,
                      background: "#f1f5f9",
                      fontSize: 11,
                      fontWeight: 500,
                      color: "#64748b",
                      border: "1px solid #e2e8f0",
                      display: "inline-flex",
                      alignItems: "center",
                      whiteSpace: "nowrap",
                    }}
                    title="Zero Stock items do not require exclusion"
                  >
                    Zero Stock — no exclusion required
                  </span>
                ) : (
                  <button
                    onClick={() => setShowExclusionDialog(true)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid #fca5a5",
                      background: "#fef2f2",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#b91c1c",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      whiteSpace: "nowrap",
                    }}
                    title="Exclude this item from normal reconciliation and stock"
                  >
                    <span>🚫</span>
                    <span>Exclude Item</span>
                  </button>
                )}

                <button
                  onClick={onClose}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: 24,
                    color: "#64748b",
                    cursor: "pointer",
                    padding: "0 4px",
                    lineHeight: 1,
                  }}
                  aria-label="Close drawer"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Top 9 KPI Summary Cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(9, 1fr)",
                gap: 8,
                marginTop: 14,
              }}
            >
              {[
                { label: "Purchase Qty", value: formatQuantity(metrics.purchaseQty), color: "#0f172a" },
                { label: "Sales Qty", value: formatQuantity(metrics.salesQty), color: "#0f172a" },
                {
                  label: "Balance Qty",
                  value: formatQuantity(metrics.balanceQty),
                  color: metrics.balanceQty > 0 ? "#16a34a" : metrics.balanceQty < 0 ? "#dc2626" : "#0f172a",
                },
                { label: "Yet to Purch", value: formatQuantity(metrics.yetToPurchase), color: metrics.yetToPurchase > 0 ? "#dc2626" : "#64748b" },
                { label: "Yet to Sale", value: formatQuantity(metrics.yetToSale), color: metrics.yetToSale > 0 ? "#d97706" : "#64748b" },
                { label: "Reconciled", value: formatQuantity(metrics.reconciledQty), color: "#059669" },
                { label: "Latest Purch Rate", value: metrics.latestPurchaseRate ? `₹${formatINR(metrics.latestPurchaseRate)}` : "—", color: "#0f172a" },
                { label: "Latest Sales Rate", value: metrics.latestSalesRate ? `₹${formatINR(metrics.latestSalesRate)}` : "—", color: "#0f172a" },
                { label: "Stock Value", value: `₹${formatINR(metrics.approxStockValue)}`, color: metrics.approxStockValue < 0 ? "#dc2626" : "#0f172a" },
              ].map((kpi, idx) => (
                <div key={idx} style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.2px" }}>
                    {kpi.label}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: kpi.color, marginTop: 2 }}>
                    {kpi.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Navigation Tabs */}
            <div style={{ display: "flex", gap: 4, marginTop: 14, borderBottom: "2px solid #e2e8f0" }}>
              {[
                { id: "overview" as const, label: "Overview" },
                { id: "purchase" as const, label: `Purchase History (${displayPurchaseLines.length})` },
                { id: "sales" as const, label: `Sales History (${displaySalesLines.length})` },
                { id: "customers" as const, label: `Customer Movement (${detail?.customerMovements?.length || 0})` },
                { id: "price" as const, label: "Price History" },
                { id: "reconciliation" as const, label: "Reconciliation" },
                ...(hasAssembly ? [{ id: "assembly" as const, label: "Assembly / Composite" }] : []),
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  style={{
                    padding: "8px 14px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12.5,
                    fontWeight: activeTab === t.id ? 700 : 500,
                    color: activeTab === t.id ? "#0284c7" : "#64748b",
                    borderBottom: activeTab === t.id ? "2px solid #0284c7" : "2px solid transparent",
                    marginBottom: -2,
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Drawer Body */}
          <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto" }}>
            {loading && (
              <div style={{ padding: "40px 0", textAlign: "center", color: "#64748b" }}>
                Loading local item details...
              </div>
            )}

            {error && (
              <div style={{ padding: "24px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>
                <strong>Note:</strong> {error}
              </div>
            )}

            {!loading && !error && detail && (
              <>
                {/* ── 1. OVERVIEW TAB ── */}
                {activeTab === "overview" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                    {/* Rate Evidence Spotlight */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 14 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#166534", marginBottom: 6 }}>
                          📦 LATEST PURCHASE RATE EVIDENCE
                        </div>
                        {detail.priceStats?.latestPurchaseEvidence ? (
                          <div style={{ fontSize: 12, color: "#1e293b", lineHeight: 1.6 }}>
                            <div>Rate: <strong style={{ fontSize: 14, color: "#15803d" }}>₹{formatINR(detail.priceStats.latestPurchaseEvidence.rate)}</strong> (Qty: {formatQuantity(detail.priceStats.latestPurchaseEvidence.qty)})</div>
                            <div>
                              Bill No:{" "}
                              <span
                                onClick={(e) => { e.stopPropagation(); handleOpenBill(detail.priceStats.latestPurchaseEvidence!.billNumber); }}
                                style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 700 }}
                                title="Open Purchase Bill drawer"
                              >
                                {detail.priceStats.latestPurchaseEvidence.billNumber}
                              </span>
                              {" · Date: "}
                              <span
                                onClick={(e) => { e.stopPropagation(); handleOpenDate(detail.priceStats.latestPurchaseEvidence!.date); }}
                                style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                title="View transactions on this date"
                              >
                                {formatDisplayDate(detail.priceStats.latestPurchaseEvidence.date)}
                              </span>
                            </div>
                            <div>
                              Vendor:{" "}
                              <span
                                onClick={(e) => { e.stopPropagation(); handleOpenVendor(detail.priceStats.latestPurchaseEvidence!.vendorName); }}
                                style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                                title="Open Vendor Detail drawer"
                              >
                                {detail.priceStats.latestPurchaseEvidence.vendorName}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: "#64748b" }}>No purchase bills found in period.</div>
                        )}
                      </div>

                      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: 14 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#1e40af", marginBottom: 6 }}>
                          📤 LATEST SALES RATE EVIDENCE
                        </div>
                        {detail.priceStats?.latestSalesEvidence ? (
                          <div style={{ fontSize: 12, color: "#1e293b", lineHeight: 1.6 }}>
                            <div>Rate: <strong style={{ fontSize: 14, color: "#1d4ed8" }}>₹{formatINR(detail.priceStats.latestSalesEvidence.rate)}</strong> (Qty: {formatQuantity(detail.priceStats.latestSalesEvidence.qty)})</div>
                            <div>
                              Invoice No:{" "}
                              <span
                                onClick={(e) => { e.stopPropagation(); handleOpenInvoice(detail.priceStats.latestSalesEvidence!.invoiceNumber); }}
                                style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 700 }}
                                title="Open Sales Invoice drawer"
                              >
                                {detail.priceStats.latestSalesEvidence.invoiceNumber}
                              </span>
                              {" · Date: "}
                              <span
                                onClick={(e) => { e.stopPropagation(); handleOpenDate(detail.priceStats.latestSalesEvidence!.date); }}
                                style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                title="View transactions on this date"
                              >
                                {formatDisplayDate(detail.priceStats.latestSalesEvidence.date)}
                              </span>
                            </div>
                            <div>
                              Customer:{" "}
                              <span
                                onClick={(e) => { e.stopPropagation(); handleCustomerClick(null, detail.priceStats.latestSalesEvidence!.customerName, "OVERVIEW"); }}
                                style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                                title="Open Customer Details 360"
                              >
                                {detail.priceStats.latestSalesEvidence.customerName}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: "#64748b" }}>No sales invoices found in period.</div>
                        )}
                      </div>
                    </div>

                    {/* Recent Purchase Lines */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                          Recent Purchase Transactions {isCustomerScoped ? `(for ${selectedCustomerName || "Customer"})` : "(All Customers)"}
                        </div>
                        <button
                          onClick={() => setActiveTab("purchase")}
                          style={{ background: "none", border: "none", color: "#0284c7", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                        >
                          View all ({displayPurchaseLines.length}) →
                        </button>
                      </div>
                      <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#f8fafc" }}>
                            <th style={{ padding: "6px 10px" }}>Date</th>
                            <th style={{ padding: "6px 10px" }}>Bill No.</th>
                            <th style={{ padding: "6px 10px" }}>Vendor</th>
                            <th style={{ padding: "6px 10px" }}>Customer Details</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>Qty</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>Rate</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>Taxable Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayPurchaseLines.slice(0, 5).map((p, idx) => (
                            <tr key={idx}>
                              <td style={{ padding: "6px 10px" }}>
                                <span
                                  onClick={(e) => { e.stopPropagation(); handleOpenDate(p.billDate); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                  title="View transactions on this date"
                                >
                                  {formatDisplayDate(p.billDate)}
                                </span>
                              </td>
                              <td style={{ padding: "6px 10px" }}>
                                <span
                                  onClick={(e) => { e.stopPropagation(); handleOpenBill(p.billId || p.billNumber); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                                  title="Open Purchase Bill drawer"
                                >
                                  {p.billNumber}
                                </span>
                              </td>
                              <td style={{ padding: "6px 10px" }}>
                                <span
                                  onClick={(e) => { e.stopPropagation(); handleOpenVendor(p.vendorName); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 500 }}
                                  title="Open Vendor Detail drawer"
                                >
                                  {p.vendorName}
                                </span>
                              </td>
                              <td style={{ padding: "6px 10px" }}>
                                {p.customerName ? (
                                  <span
                                    onClick={(e) => { e.stopPropagation(); handleCustomerClick(p.customerId, p.customerName, "OVERVIEW"); }}
                                    style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                    title="Open Customer Details 360"
                                  >
                                    {p.customerName}
                                  </span>
                                ) : (
                                  <span style={{ color: "#64748b" }}>—</span>
                                )}
                              </td>
                              <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>{formatQuantity(p.quantity)}</td>
                              <td style={{ padding: "6px 10px", textAlign: "right" }}>₹{formatINR(p.rate)}</td>
                              <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>₹{formatINR(p.taxableValue)}</td>
                            </tr>
                          ))}
                          {displayPurchaseLines.length === 0 && (
                            <tr><td colSpan={7} style={{ padding: 16, textAlign: "center", color: "#94a3b8" }}>No purchase records found.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Recent Sales Lines */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                          Recent Sales Transactions {isCustomerScoped ? `(for ${selectedCustomerName || "Customer"})` : "(All Customers)"}
                        </div>
                        <button
                          onClick={() => setActiveTab("sales")}
                          style={{ background: "none", border: "none", color: "#0284c7", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                        >
                          View all ({displaySalesLines.length}) →
                        </button>
                      </div>
                      <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#f8fafc" }}>
                            <th style={{ padding: "6px 10px" }}>Date</th>
                            <th style={{ padding: "6px 10px" }}>Invoice No.</th>
                            <th style={{ padding: "6px 10px" }}>Customer</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>Qty</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>Rate</th>
                            <th style={{ padding: "6px 10px", textAlign: "right" }}>Taxable Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displaySalesLines.slice(0, 5).map((s, idx) => (
                            <tr key={idx}>
                              <td style={{ padding: "6px 10px" }}>
                                <span
                                  onClick={(e) => { e.stopPropagation(); handleOpenDate(s.invoiceDate); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                  title="View transactions on this date"
                                >
                                  {formatDisplayDate(s.invoiceDate)}
                                </span>
                              </td>
                              <td style={{ padding: "6px 10px" }}>
                                <span
                                  onClick={(e) => { e.stopPropagation(); handleOpenInvoice(s.invoiceId || s.invoiceNumber); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                                  title="Open Sales Invoice drawer"
                                >
                                  {s.invoiceNumber}
                                </span>
                              </td>
                              <td style={{ padding: "6px 10px" }}>
                                <span
                                  onClick={(e) => { e.stopPropagation(); handleCustomerClick(s.customerId, s.customerName, "OVERVIEW"); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 500 }}
                                  title="Open Customer Details 360"
                                >
                                  {s.customerName}
                                </span>
                              </td>
                              <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>{formatQuantity(s.quantity)}</td>
                              <td style={{ padding: "6px 10px", textAlign: "right" }}>₹{formatINR(s.rate)}</td>
                              <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>₹{formatINR(s.taxableValue)}</td>
                            </tr>
                          ))}
                          {displaySalesLines.length === 0 && (
                            <tr><td colSpan={6} style={{ padding: 16, textAlign: "center", color: "#94a3b8" }}>No sales records found.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ── 2. PURCHASE HISTORY TAB ── */}
                {activeTab === "purchase" && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                        Purchase Lines ({displayPurchaseLines.length})
                        {isCustomerScoped && <span style={{ fontSize: 12, fontWeight: 500, color: "#64748b", marginLeft: 8 }}>Filtered for {selectedCustomerName}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>
                        Total: <strong>{formatQuantity(displayPurchaseLines.reduce((acc, p) => acc + p.quantity, 0))} units</strong> · <strong>₹{formatINR(displayPurchaseLines.reduce((acc, p) => acc + p.taxableValue, 0))}</strong>
                      </div>
                    </div>
                    <div className="table-responsive" style={{ border: "1px solid #e2e8f0", borderRadius: 6 }}>
                      <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#f8fafc" }}>
                            <th style={{ width: 35, textAlign: "center" }}>Sr</th>
                            <th>Date</th>
                            <th>Bill No.</th>
                            <th>Vendor</th>
                            <th>Customer Details</th>
                            <th style={{ textAlign: "right" }}>Qty</th>
                            <th style={{ textAlign: "right" }}>Rate</th>
                            <th style={{ textAlign: "right" }}>Taxable Value</th>
                            <th style={{ textAlign: "center" }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayPurchaseLines.map((p, idx) => (
                            <tr key={idx}>
                              <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                              <td>
                                <span
                                  onClick={(e) => { e.stopPropagation(); handleOpenDate(p.billDate); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                  title="View transactions on this date"
                                >
                                  {formatDisplayDate(p.billDate)}
                                </span>
                              </td>
                              <td style={{ fontWeight: 600 }}>
                                <span
                                  onClick={(e) => { e.stopPropagation(); handleOpenBill(p.billId || p.billNumber); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                  title="Click to view Purchase Bill drawer"
                                >
                                  {p.billNumber}
                                </span>
                              </td>
                              <td>
                                <span
                                  onClick={(e) => { e.stopPropagation(); handleOpenVendor(p.vendorName); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 500 }}
                                  title="Open Vendor Detail drawer"
                                >
                                  {p.vendorName}
                                </span>
                              </td>
                              <td>
                                {p.customerName ? (
                                  <span
                                    onClick={(e) => { e.stopPropagation(); handleCustomerClick(p.customerId, p.customerName, "OVERVIEW"); }}
                                    style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                    title="Open Customer Details 360"
                                  >
                                    {p.customerName}
                                  </span>
                                ) : (
                                  <span style={{ color: "#64748b" }}>—</span>
                                )}
                              </td>
                              <td style={{ textAlign: "right", fontWeight: 600 }}>{formatQuantity(p.quantity)}</td>
                              <td style={{ textAlign: "right" }}>₹{formatINR(p.rate)}</td>
                              <td style={{ textAlign: "right", fontWeight: 600 }}>₹{formatINR(p.taxableValue)}</td>
                              <td style={{ textAlign: "center" }}>
                                <span style={{ color: "#15803d", fontWeight: 600, fontSize: 11 }}>Active</span>
                              </td>
                            </tr>
                          ))}
                          {displayPurchaseLines.length === 0 && (
                            <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No purchase lines found.</td></tr>
                          )}
                        </tbody>
                        {displayPurchaseLines.length > 0 && (
                          <tfoot>
                            <tr style={{ background: "#f8fafc", fontWeight: 700, borderTop: "2px solid #cbd5e1" }}>
                              <td colSpan={5}>TOTAL</td>
                              <td style={{ textAlign: "right" }}>{formatQuantity(displayPurchaseLines.reduce((acc, p) => acc + p.quantity, 0))}</td>
                              <td style={{ textAlign: "right" }}>—</td>
                              <td style={{ textAlign: "right" }}>₹{formatINR(displayPurchaseLines.reduce((acc, p) => acc + p.taxableValue, 0))}</td>
                              <td></td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>
                )}

                {/* ── 3. SALES HISTORY TAB ── */}
                {activeTab === "sales" && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                        Sales Lines ({displaySalesLines.length})
                        {isCustomerScoped && <span style={{ fontSize: 12, fontWeight: 500, color: "#64748b", marginLeft: 8 }}>Filtered for {selectedCustomerName}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>
                        Total: <strong>{formatQuantity(displaySalesLines.reduce((acc, s) => acc + s.quantity, 0))} units</strong> · <strong>₹{formatINR(displaySalesLines.reduce((acc, s) => acc + s.taxableValue, 0))}</strong>
                      </div>
                    </div>
                    <div className="table-responsive" style={{ border: "1px solid #e2e8f0", borderRadius: 6 }}>
                      <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#f8fafc" }}>
                            <th style={{ width: 35, textAlign: "center" }}>Sr</th>
                            <th>Date</th>
                            <th>Invoice No.</th>
                            <th>Customer</th>
                            <th style={{ textAlign: "right" }}>Qty</th>
                            <th style={{ textAlign: "right" }}>Rate</th>
                            <th style={{ textAlign: "right" }}>Taxable Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displaySalesLines.map((s, idx) => (
                            <tr key={idx}>
                              <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                              <td>
                                <span
                                  onClick={(e) => { e.stopPropagation(); handleOpenDate(s.invoiceDate); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                  title="View transactions on this date"
                                >
                                  {formatDisplayDate(s.invoiceDate)}
                                </span>
                              </td>
                              <td style={{ fontWeight: 600 }}>
                                <span
                                  onClick={(e) => { e.stopPropagation(); handleOpenInvoice(s.invoiceId || s.invoiceNumber); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                  title="Click to view Sales Invoice drawer"
                                >
                                  {s.invoiceNumber}
                                </span>
                              </td>
                              <td style={{ fontWeight: 500 }}>
                                <span
                                  onClick={(e) => { e.stopPropagation(); handleCustomerClick(s.customerId, s.customerName, "OVERVIEW"); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                  title="Open Customer Details 360"
                                >
                                  {s.customerName}
                                </span>
                              </td>
                              <td style={{ textAlign: "right", fontWeight: 600 }}>{formatQuantity(s.quantity)}</td>
                              <td style={{ textAlign: "right" }}>₹{formatINR(s.rate)}</td>
                              <td style={{ textAlign: "right", fontWeight: 600 }}>₹{formatINR(s.taxableValue)}</td>
                            </tr>
                          ))}
                          {displaySalesLines.length === 0 && (
                            <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No sales lines found.</td></tr>
                          )}
                        </tbody>
                        {displaySalesLines.length > 0 && (
                          <tfoot>
                            <tr style={{ background: "#f8fafc", fontWeight: 700, borderTop: "2px solid #cbd5e1" }}>
                              <td colSpan={4}>TOTAL</td>
                              <td style={{ textAlign: "right" }}>{formatQuantity(displaySalesLines.reduce((acc, s) => acc + s.quantity, 0))}</td>
                              <td style={{ textAlign: "right" }}>—</td>
                              <td style={{ textAlign: "right" }}>₹{formatINR(displaySalesLines.reduce((acc, s) => acc + s.taxableValue, 0))}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>
                )}

                {/* ── 4. CUSTOMER-WISE MOVEMENT TAB ── */}
                {activeTab === "customers" && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                        Customer Movement Breakdown ({detail.customerMovements?.length || 0} Customers)
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>
                        Click customer name to open Customer 360 or click Focus to filter this drawer.
                      </div>
                    </div>
                    <div className="table-responsive" style={{ border: "1px solid #e2e8f0", borderRadius: 6 }}>
                      <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#f8fafc" }}>
                            <th style={{ width: 35, textAlign: "center" }}>Sr</th>
                            <th>Customer Name</th>
                            <th style={{ textAlign: "right" }}>Purchase Qty</th>
                            <th style={{ textAlign: "right" }}>Sales Qty</th>
                            <th style={{ textAlign: "right" }}>Balance Qty</th>
                            <th style={{ textAlign: "right" }}>Purchase Value</th>
                            <th style={{ textAlign: "right" }}>Sales Value</th>
                            <th style={{ textAlign: "center" }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.customerMovements.map((cm, idx) => {
                            const isCurrent = (selectedCustomerId && cm.customerId === selectedCustomerId) ||
                                              (selectedCustomerName && cm.customerName.toLowerCase() === selectedCustomerName.toLowerCase());
                            return (
                              <tr key={idx} style={{ background: isCurrent && !viewAllCustomers ? "#f0fdf4" : undefined }}>
                                <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                                <td style={{ fontWeight: 600 }}>
                                  <span
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCustomerClick(cm.customerId, cm.customerName, "OVERVIEW");
                                    }}
                                    style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                    title="Open Customer Details 360"
                                  >
                                    {cm.customerName}
                                  </span>
                                  {isCurrent && !viewAllCustomers && (
                                    <span style={{ marginLeft: 6, fontSize: 10, background: "#16a34a", color: "#fff", padding: "1px 6px", borderRadius: 4 }}>
                                      Active Focus
                                    </span>
                                  )}
                                </td>
                                <td style={{ textAlign: "right" }}>{formatQuantity(cm.purchaseQty)}</td>
                                <td style={{ textAlign: "right" }}>{formatQuantity(cm.salesQty)}</td>
                                <td style={{ textAlign: "right", fontWeight: 700, color: cm.balanceQty > 0 ? "#16a34a" : cm.balanceQty < 0 ? "#dc2626" : "#475569" }}>
                                  {formatQuantity(cm.balanceQty)}
                                </td>
                                <td style={{ textAlign: "right" }}>₹{formatINR(cm.purchaseValue)}</td>
                                <td style={{ textAlign: "right" }}>₹{formatINR(cm.salesValue)}</td>
                                <td style={{ textAlign: "center" }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedCustomerId(cm.customerId);
                                      setSelectedCustomerName(cm.customerName);
                                      setViewAllCustomers(false);
                                    }}
                                    style={{
                                      padding: "3px 8px",
                                      background: isCurrent && !viewAllCustomers ? "#15803d" : "#e2e8f0",
                                      color: isCurrent && !viewAllCustomers ? "#fff" : "#1e293b",
                                      border: "none",
                                      borderRadius: 4,
                                      fontSize: 11,
                                      fontWeight: 600,
                                      cursor: "pointer",
                                    }}
                                  >
                                    {isCurrent && !viewAllCustomers ? "Focused" : "Focus"}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                          {detail.customerMovements.length === 0 && (
                            <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No customer-mapped transactions.</td></tr>
                          )}
                        </tbody>
                        {detail.customerMovements.length > 0 && (
                          <tfoot>
                            <tr style={{ background: "#f8fafc", fontWeight: 700, borderTop: "2px solid #cbd5e1" }}>
                              <td colSpan={2}>TOTAL MAPPED</td>
                              <td style={{ textAlign: "right" }}>{formatQuantity(detail.customerMovements.reduce((acc, c) => acc + c.purchaseQty, 0))}</td>
                              <td style={{ textAlign: "right" }}>{formatQuantity(detail.customerMovements.reduce((acc, c) => acc + c.salesQty, 0))}</td>
                              <td style={{ textAlign: "right" }}>{formatQuantity(detail.customerMovements.reduce((acc, c) => acc + c.balanceQty, 0))}</td>
                              <td style={{ textAlign: "right" }}>₹{formatINR(detail.customerMovements.reduce((acc, c) => acc + c.purchaseValue, 0))}</td>
                              <td style={{ textAlign: "right" }}>₹{formatINR(detail.customerMovements.reduce((acc, c) => acc + c.salesValue, 0))}</td>
                              <td></td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>
                )}

                {/* ── 5. PRICE HISTORY TAB ── */}
                {activeTab === "price" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                      Price Reference &amp; Rate Distribution Engine
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      {/* Purchase Rates Card */}
                      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, background: "#fafafa" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#166534", marginBottom: 12 }}>
                          PURCHASE RATES (ACTUAL BILLS)
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "#64748b" }}>Latest Purchase Rate:</span>
                            <strong>{detail.latestPurchaseRate ? `₹${formatINR(detail.latestPurchaseRate)}` : "—"}</strong>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "#64748b" }}>Lowest Purchase Rate:</span>
                            <strong>{detail.priceStats?.lowestPurchaseRate ? `₹${formatINR(detail.priceStats.lowestPurchaseRate)}` : "—"}</strong>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "#64748b" }}>Highest Purchase Rate:</span>
                            <strong>{detail.priceStats?.highestPurchaseRate ? `₹${formatINR(detail.priceStats.highestPurchaseRate)}` : "—"}</strong>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "#64748b" }}>Weighted Avg Purchase Rate:</span>
                            <strong>{detail.priceStats?.weightedAvgPurchaseRate ? `₹${formatINR(detail.priceStats.weightedAvgPurchaseRate)}` : "—"}</strong>
                          </div>
                        </div>
                      </div>

                      {/* Sales Rates Card */}
                      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, background: "#fafafa" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e40af", marginBottom: 12 }}>
                          SALES RATES (ACTUAL INVOICES)
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "#64748b" }}>Latest Sales Rate:</span>
                            <strong>{detail.latestSalesRate ? `₹${formatINR(detail.latestSalesRate)}` : "—"}</strong>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "#64748b" }}>Lowest Sales Rate:</span>
                            <strong>{detail.priceStats?.lowestSalesRate ? `₹${formatINR(detail.priceStats.lowestSalesRate)}` : "—"}</strong>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "#64748b" }}>Highest Sales Rate:</span>
                            <strong>{detail.priceStats?.highestSalesRate ? `₹${formatINR(detail.priceStats.highestSalesRate)}` : "—"}</strong>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "#64748b" }}>Weighted Avg Sales Rate:</span>
                            <strong>{detail.priceStats?.weightedAvgSalesRate ? `₹${formatINR(detail.priceStats.weightedAvgSalesRate)}` : "—"}</strong>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Price Evidence Breakdown Table */}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
                        Recent Purchase Rate Breakdown
                      </div>
                      <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#f8fafc" }}>
                            <th>Date</th>
                            <th>Bill No.</th>
                            <th>Vendor</th>
                            <th style={{ textAlign: "right" }}>Qty</th>
                            <th style={{ textAlign: "right" }}>Rate</th>
                            <th style={{ textAlign: "right" }}>Taxable Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayPurchaseLines.slice(0, 10).map((p, idx) => (
                            <tr key={idx}>
                              <td>
                                <span
                                  onClick={(e) => { e.stopPropagation(); handleOpenDate(p.billDate); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                  title="View transactions on this date"
                                >
                                  {formatDisplayDate(p.billDate)}
                                </span>
                              </td>
                              <td style={{ fontWeight: 600 }}>
                                <span
                                  onClick={(e) => { e.stopPropagation(); handleOpenBill(p.billId || p.billNumber); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                  title="Open Purchase Bill drawer"
                                >
                                  {p.billNumber}
                                </span>
                              </td>
                              <td>
                                <span
                                  onClick={(e) => { e.stopPropagation(); handleOpenVendor(p.vendorName); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                  title="Open Vendor Detail drawer"
                                >
                                  {p.vendorName}
                                </span>
                              </td>
                              <td style={{ textAlign: "right", fontWeight: 600 }}>{formatQuantity(p.quantity)}</td>
                              <td style={{ textAlign: "right", fontWeight: 700, color: "#15803d" }}>₹{formatINR(p.rate)}</td>
                              <td style={{ textAlign: "right" }}>₹{formatINR(p.taxableValue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ── 6. RECONCILIATION TAB ── */}
                {activeTab === "reconciliation" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                      Reconciliation Breakdown &amp; Shortage / Surplus Valuation
                    </div>

                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 16 }}>
                        <div>
                          <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Purchase Qty</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: "#1d4ed8" }}>{formatQuantity(metrics.purchaseQty)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Sales Qty</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: "#c2410c" }}>{formatQuantity(metrics.salesQty)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Balance Qty</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: metrics.balanceQty >= 0 ? "#16a34a" : "#dc2626" }}>
                            {formatQuantity(metrics.balanceQty)}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
                        <div>
                          <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Shortage (Yet to Purchase)</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: metrics.yetToPurchase > 0 ? "#dc2626" : "#64748b" }}>
                            {formatQuantity(metrics.yetToPurchase)} units
                          </div>
                          {metrics.yetToPurchase > 0 && (
                            <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 2 }}>
                              Valuation: ₹{formatINR(metrics.yetToPurchase * (metrics.latestPurchaseRate || 0))}
                            </div>
                          )}
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Surplus (Yet to Sale)</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: metrics.yetToSale > 0 ? "#b45309" : "#64748b" }}>
                            {formatQuantity(metrics.yetToSale)} units
                          </div>
                          {metrics.yetToSale > 0 && (
                            <div style={{ fontSize: 12, color: "#b45309", marginTop: 2 }}>
                              Valuation: ₹{formatINR(metrics.yetToSale * (metrics.latestPurchaseRate || 0))}
                            </div>
                          )}
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Reconciled Qty</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: "#059669" }}>
                            {formatQuantity(metrics.reconciledQty)} units
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Customer-wise Reconciliation Evidence */}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
                        Customer Reconciliation Evidence &amp; Valuation
                      </div>
                      <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#f8fafc" }}>
                            <th>Customer Name</th>
                            <th style={{ textAlign: "right" }}>Purchased</th>
                            <th style={{ textAlign: "right" }}>Sold</th>
                            <th style={{ textAlign: "right" }}>Reconciled</th>
                            <th style={{ textAlign: "right" }}>Surplus</th>
                            <th style={{ textAlign: "right" }}>Shortage</th>
                            <th style={{ textAlign: "center" }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.customerMovements.map((cm, idx) => {
                            const rec = Math.min(cm.purchaseQty, cm.salesQty);
                            const sur = Math.max(0, cm.purchaseQty - cm.salesQty);
                            const sho = Math.max(0, cm.salesQty - cm.purchaseQty);
                            return (
                              <tr key={idx}>
                                <td style={{ fontWeight: 600 }}>
                                  <span
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCustomerClick(cm.customerId, cm.customerName, "RECONCILIATION");
                                    }}
                                    style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                    title="Open Customer Reconciliation Tab"
                                  >
                                    {cm.customerName}
                                  </span>
                                </td>
                                <td style={{ textAlign: "right" }}>{formatQuantity(cm.purchaseQty)}</td>
                                <td style={{ textAlign: "right" }}>{formatQuantity(cm.salesQty)}</td>
                                <td style={{ textAlign: "right", color: "#059669", fontWeight: 600 }}>{formatQuantity(rec)}</td>
                                <td style={{ textAlign: "right", color: sur > 0 ? "#b45309" : "#64748b" }}>{formatQuantity(sur)}</td>
                                <td style={{ textAlign: "right", color: sho > 0 ? "#dc2626" : "#64748b" }}>{formatQuantity(sho)}</td>
                                <td style={{ textAlign: "center" }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCustomerClick(cm.customerId, cm.customerName, "RECONCILIATION");
                                    }}
                                    style={{
                                      padding: "3px 8px",
                                      background: "#f0fdf4",
                                      border: "1px solid #bbf7d0",
                                      borderRadius: 4,
                                      fontSize: 11,
                                      fontWeight: 600,
                                      color: "#166534",
                                      cursor: "pointer",
                                    }}
                                  >
                                    Reconcile 360 →
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ── 7. ASSEMBLY / COMPOSITE TAB ── */}
                {activeTab === "assembly" && hasAssembly && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                      Composite Assembly History &amp; Component Consumption
                    </div>

                    {detail.assemblyConsumedDetails && detail.assemblyConsumedDetails.length > 0 && (
                      <div>
                        <h4 style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed", marginBottom: 8 }}>
                          Consumed as Component ({detail.assemblyConsumedDetails.length} assemblies)
                        </h4>
                        <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ background: "#f8fafc" }}>
                              <th>Assembly #</th>
                              <th>Date</th>
                              <th>Customer</th>
                              <th>Composite Item</th>
                              <th style={{ textAlign: "right" }}>Consumed Qty</th>
                              <th style={{ textAlign: "center" }}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.assemblyConsumedDetails.map((a, idx) => (
                              <tr key={idx}>
                                <td style={{ fontWeight: 600 }}>{a.assemblyNumber}</td>
                                <td>
                                  <span
                                    onClick={(e) => { e.stopPropagation(); if (a.assemblyDate) handleOpenDate(a.assemblyDate); }}
                                    style={{ color: a.assemblyDate ? "#0284c7" : "inherit", cursor: a.assemblyDate ? "pointer" : "default", textDecoration: a.assemblyDate ? "underline" : "none" }}
                                  >
                                    {formatDisplayDate(a.assemblyDate)}
                                  </span>
                                </td>
                                <td>
                                  <span
                                    onClick={(e) => { e.stopPropagation(); handleCustomerClick(null, a.customerName, "OVERVIEW"); }}
                                    style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                    title="Open Customer Details 360"
                                  >
                                    {a.customerName}
                                  </span>
                                </td>
                                <td>
                                  <span
                                    onClick={(e) => { e.stopPropagation(); handleOpenItem(a.compositeItemId, a.compositeItemName); }}
                                    style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                                    title="Open Composite Item Detail drawer"
                                  >
                                    {a.compositeItemName}
                                  </span>
                                </td>
                                <td style={{ textAlign: "right", fontWeight: 600 }}>{formatQuantity(a.consumedQty || 0)}</td>
                                <td style={{ textAlign: "center" }}><span style={{ color: "#16a34a", fontWeight: 600 }}>{a.status}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {detail.assemblyGeneratedDetails && detail.assemblyGeneratedDetails.length > 0 && (
                      <div>
                        <h4 style={{ fontSize: 13, fontWeight: 700, color: "#0284c7", marginBottom: 8 }}>
                          Generated Composite Assemblies ({detail.assemblyGeneratedDetails.length} assemblies)
                        </h4>
                        <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ background: "#f8fafc" }}>
                              <th>Assembly #</th>
                              <th>Date</th>
                              <th>Customer</th>
                              <th style={{ textAlign: "right" }}>Generated Qty</th>
                              <th style={{ textAlign: "right" }}>Cost Per Unit</th>
                              <th style={{ textAlign: "right" }}>Total Material Cost</th>
                              <th style={{ textAlign: "center" }}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.assemblyGeneratedDetails.map((a, idx) => (
                              <tr key={idx}>
                                <td style={{ fontWeight: 600 }}>{a.assemblyNumber}</td>
                                <td>
                                  <span
                                    onClick={(e) => { e.stopPropagation(); if (a.assemblyDate) handleOpenDate(a.assemblyDate); }}
                                    style={{ color: a.assemblyDate ? "#0284c7" : "inherit", cursor: a.assemblyDate ? "pointer" : "default", textDecoration: a.assemblyDate ? "underline" : "none" }}
                                  >
                                    {formatDisplayDate(a.assemblyDate)}
                                  </span>
                                </td>
                                <td>
                                  <span
                                    onClick={(e) => { e.stopPropagation(); handleCustomerClick(null, a.customerName, "OVERVIEW"); }}
                                    style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                    title="Open Customer Details 360"
                                  >
                                    {a.customerName}
                                  </span>
                                </td>
                                <td style={{ textAlign: "right", fontWeight: 600 }}>{formatQuantity(a.generatedQty)}</td>
                                <td style={{ textAlign: "right" }}>₹{formatINR(a.costPerUnit)}</td>
                                <td style={{ textAlign: "right", fontWeight: 600 }}>₹{formatINR(a.totalMaterialCost)}</td>
                                <td style={{ textAlign: "center" }}><span style={{ color: "#16a34a", fontWeight: 600 }}>{a.status}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Centralized Exclusion Dialog */}
      {showExclusionDialog && detail && (
        <ExclusionDialog
          item={{
            itemId: detail.itemId,
            itemName: detail.itemName,
            sku: detail.sku || undefined,
            status: detail.status,
            stockStatus: detail.status,
            effectivePurchaseQty: metrics.purchaseQty,
            purchaseQty: metrics.purchaseQty,
            salesQty: metrics.salesQty,
            stockQty: metrics.stockQty,
            balanceQty: metrics.stockQty,
            approxStockValue: metrics.approxStockValue,
          }}
          financialYear={financialYear}
          onClose={() => setShowExclusionDialog(false)}
          onSuccess={() => {
            setShowExclusionDialog(false);
            onExclusionSuccess?.();
            onClose();
          }}
        />
      )}

      {/* Nested Drawers (Stacked cleanly over ItemDetailDrawer) */}
      {nestedBillId && (
        <LocalBillDrawer
          billId={nestedBillId}
          onClose={() => setNestedBillId(null)}
          onOpenVendor={handleOpenVendor}
          onOpenDate={handleOpenDate}
          onOpenItem={handleOpenItem}
          onNavigateToCustomer={handleCustomerClick}
        />
      )}

      {nestedInvoiceId && (
        <LocalInvoiceDrawer
          invoiceId={nestedInvoiceId}
          onClose={() => setNestedInvoiceId(null)}
          onOpenDate={handleOpenDate}
          onOpenItem={handleOpenItem}
          onNavigateToCustomer={handleCustomerClick}
        />
      )}

      {nestedVendor && (
        <VendorDetailDrawer
          vendorName={nestedVendor.vendorName}
          vendorId={nestedVendor.vendorId}
          financialYear={financialYear}
          onClose={() => setNestedVendor(null)}
          onOpenBill={handleOpenBill}
          onOpenItem={handleOpenItem}
          onOpenDate={handleOpenDate}
          onNavigateToCustomer={handleCustomerClick}
        />
      )}

      {nestedDate && (
        <DateDetailDrawer
          date={nestedDate}
          itemId={detail?.itemId || itemId}
          itemName={detail?.itemName || initialItemName}
          onClose={() => setNestedDate(null)}
          onOpenBill={handleOpenBill}
          onOpenInvoice={handleOpenInvoice}
          onOpenVendor={handleOpenVendor}
          onOpenItem={handleOpenItem}
          onNavigateToCustomer={handleCustomerClick}
        />
      )}

      {nestedItem && (
        <ItemDetailDrawer
          itemId={nestedItem.itemId}
          itemName={nestedItem.itemName}
          financialYear={financialYear}
          onClose={() => setNestedItem(null)}
          onNavigateToCustomer={onNavigateToCustomer}
        />
      )}

      {/* Dynamic Export Field Selector Modal */}
      <ExportFieldSelector
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        reportType="item-detail"
        onExport={handleExecuteExport}
      />
    </>
  );
}

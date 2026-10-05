"use client";

import React, { useState } from "react";
import { formatINR, formatQuantity, formatDisplayDate } from "@/app/lib/date-utils";
import type { ItemTransactionBreakdown } from "@/app/types/reconciliation";
import { ExclusionDialog } from "./ExclusionDialog";
import { ExportDialog } from "./ExportDialog";
import { ItemDetailDrawer } from "./ItemDetailDrawer";
import type { ExportOptions } from "@/app/types/reconciliation";

interface DetailsDrawerProps {
  item: ItemTransactionBreakdown | null;
  financialYear: string;
  onClose: () => void;
  onOpenBill?: (billId: string) => void;
  onOpenInvoice?: (invoiceId: string) => void;
  onExclusionSuccess?: () => void;
}

export function DetailsDrawer({
  item,
  financialYear,
  onClose,
  onOpenBill,
  onOpenInvoice,
  onExclusionSuccess,
}: DetailsDrawerProps) {
  const [showExclusionDialog, setShowExclusionDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [selectedItemForDetail, setSelectedItemForDetail] = useState<{
    itemId: string;
    itemName?: string;
    customerId?: string;
    customerName?: string;
  } | null>(null);

  if (!item) return null;

  const handleOpenExportDialog = () => {
    setShowExportDialog(true);
  };
  const handleDownloadBreakdown = handleOpenExportDialog;

  const handleExecuteExport = async (options: ExportOptions) => {
    const params = new URLSearchParams({
      reportType: "transaction-breakdown",
      customerId: item.customerId,
      itemId: item.itemId,
      period: financialYear,
      financialYear,
      includeTotals: options.includeTotals ? "true" : "false",
    });
    if (options.selectedFields && options.selectedFields.length > 0) {
      params.set("selectedFields", options.selectedFields.join(","));
    }
    const endpoint = options.format === "pdf" ? "/api/export/pdf" : "/api/export/excel";
    const res = await fetch(`${endpoint}?${params.toString()}`);
    if (!res.ok) throw new Error("Breakdown export failed");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeCust = (item.customerName || "Customer").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 15);
    const safeItem = (item.itemName || "Item").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 15);
    a.href = url;
    a.download = `Breakdown_${safeCust}_${safeItem}_${financialYear}.${options.format === "pdf" ? "pdf" : "xlsx"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const statusStr = (item.status || "RECONCILED").toUpperCase();
  const isShortage = statusStr.includes("SHORTAGE") || statusStr.includes("SALE ONLY") || statusStr.includes("SALES ONLY");
  const isSurplus = statusStr.includes("SURPLUS") || statusStr.includes("PURCHASE ONLY");

  return (
    <>
      <div 
        className="drawer-overlay" 
        onClick={onClose}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(15, 23, 42, 0.4)",
          backdropFilter: "blur(2px)",
          zIndex: 999,
          display: "flex",
          justifyContent: "flex-end"
        }}
      >
        <div 
          className="drawer-content" 
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "min(1100px, 92vw)",
            maxWidth: "96vw",
            height: "100%",
            backgroundColor: "#fff",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
            display: "flex",
            flexDirection: "column",
            animation: "slideInRight 0.3s ease-out",
            overflow: "hidden"
          }}
        >
          {/* Header */}
          <div style={{ padding: "18px 24px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1e293b" }}>
                  Transaction Breakdown
                </h3>
                <span
                  className={`status-badge-${
                    isShortage ? "shortfall" : isSurplus ? "surplus" : "reconciled"
                  }`}
                  style={{ fontSize: 12, padding: "3px 10px", fontWeight: 600, borderRadius: 4 }}
                >
                  {item.status || "RECONCILED"}
                </span>
                <span style={{ fontSize: 12, background: item.isExcluded ? "#fef2f2" : "#f0fdf4", color: item.isExcluded ? "#b91c1c" : "#15803d", padding: "3px 10px", borderRadius: 4, fontWeight: 600, border: `1px solid ${item.isExcluded ? "#fecaca" : "#bbf7d0"}` }}>
                  {item.isExcluded ? "EXCLUDED" : "ACTIVE"}
                </span>
              </div>
              <div style={{ fontSize: 13.5, color: "#475569", marginTop: 6, lineHeight: 1.4 }}>
                Customer: <strong style={{ color: "#0f172a" }}>{item.customerName}</strong> · Item:{" "}
                <span
                  onClick={() =>
                    setSelectedItemForDetail({
                      itemId: item.itemId,
                      itemName: item.itemName,
                      customerId: item.customerId,
                      customerName: item.customerName,
                    })
                  }
                  style={{
                    color: "#0284c7",
                    cursor: "pointer",
                    textDecoration: "underline",
                    fontWeight: 700,
                  }}
                  title="Click to open Item Detail drawer"
                >
                  {item.itemName}
                </span>{" "}
                · SKU: <code>{item.sku || "-"}</code> · Period: <strong>{item.period || financialYear}</strong>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                className="btn btn-sm"
                onClick={handleOpenExportDialog}
                style={{ background: "#2563eb", color: "#fff", border: "none", display: "flex", alignItems: "center", gap: 6, fontWeight: 600, padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
                title="Download single customer+item breakdown as Excel or PDF"
              >
                <span>↓</span>
                <span>Download Breakdown</span>
              </button>
              <button
                onClick={onClose}
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: 22,
                  cursor: "pointer",
                  color: "#64748b",
                  padding: "4px 8px"
                }}
                title="Close drawer"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
            
            {/* Top Summary Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
              <div style={{ padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>TOTAL PURCHASE</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#16a34a", lineHeight: 1.2 }}>{formatQuantity(item.totalPurchaseQty)}</div>
                <div style={{ fontSize: 11.5, color: "#475569", fontWeight: 500 }}>₹{formatINR(item.totalPurchaseAmount)}</div>
              </div>

              <div style={{ padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>TOTAL SALES</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#2563eb", lineHeight: 1.2 }}>{formatQuantity(item.totalSalesQty)}</div>
                <div style={{ fontSize: 11.5, color: "#475569", fontWeight: 500 }}>₹{formatINR(item.totalSalesAmount)}</div>
              </div>

              <div style={{ padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>BALANCE QTY</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: item.balanceQty === 0 ? "#16a34a" : item.balanceQty < 0 ? "#dc2626" : "#2563eb", lineHeight: 1.2 }}>
                  {item.balanceQty > 0 ? `+${formatQuantity(item.balanceQty)}` : formatQuantity(item.balanceQty)}
                </div>
                <div style={{ fontSize: 11.5, color: "#64748b" }}>Purchase - Sales</div>
              </div>

              <div style={{ padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>YET TO PURCHASE</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: item.yetToPurchaseQty > 0 ? "#dc2626" : "#475569", lineHeight: 1.2 }}>
                  {formatQuantity(item.yetToPurchaseQty)}
                </div>
                <div style={{ fontSize: 11.5, color: item.yetToPurchaseQty > 0 ? "#dc2626" : "#64748b" }}>
                  {item.yetToPurchaseQty > 0 ? "Shortage" : "Balanced"}
                </div>
              </div>

              <div style={{ padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>YET TO SALE</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: item.yetToSaleQty > 0 ? "#2563eb" : "#475569", lineHeight: 1.2 }}>
                  {formatQuantity(item.yetToSaleQty)}
                </div>
                <div style={{ fontSize: 11.5, color: item.yetToSaleQty > 0 ? "#2563eb" : "#64748b" }}>
                  {item.yetToSaleQty > 0 ? "Surplus" : "Balanced"}
                </div>
              </div>

              <div style={{ padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>RECONCILED</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#16a34a", lineHeight: 1.2 }}>
                  {formatQuantity(item.reconciledQty)}
                </div>
                <div style={{ fontSize: 11.5, color: "#16a34a" }}>Matched</div>
              </div>
            </div>

            {/* Approximate Shortage/Surplus Valuation Section */}
            {(item.yetToPurchaseQty > 0 || item.yetToSaleQty > 0) && (
              <div
                style={{
                  marginBottom: 20,
                  padding: "14px 18px",
                  background: item.yetToPurchaseQty > 0 ? "#fef2f2" : "#f0f9ff",
                  border: `1px solid ${item.yetToPurchaseQty > 0 ? "#fecaca" : "#bae6fd"}`,
                  borderRadius: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: item.yetToPurchaseQty > 0 ? "#991b1b" : "#0369a1" }}>
                      {item.yetToPurchaseQty > 0 ? "⚠️ Approx. Shortage Value" : "📦 Approx. Surplus Value"}:
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: item.yetToPurchaseQty > 0 ? "#b91c1c" : "#0284c7" }}>
                      {item.yetToPurchaseQty > 0
                        ? (typeof item.approxShortageValue === "number" && item.approxShortageValue > 0 ? `₹${formatINR(item.approxShortageValue)}` : "N/A")
                        : (typeof item.approxSurplusValue === "number" && item.approxSurplusValue > 0 ? `₹${formatINR(item.approxSurplusValue)}` : "N/A")}
                    </span>
                    <span style={{ fontSize: 11, background: item.yetToPurchaseQty > 0 ? "#fee2e2" : "#e0f2fe", color: item.yetToPurchaseQty > 0 ? "#dc2626" : "#0284c7", padding: "2px 6px", borderRadius: 3, fontWeight: 700 }}>
                      ≈ Approx.
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "#475569" }}>
                    Reference Purchase Rate:{" "}
                    <strong>
                      {typeof item.approxRefPurchaseRate === "number" && item.approxRefPurchaseRate > 0 ? `₹${formatINR(item.approxRefPurchaseRate)}` : "N/A"}
                    </strong>
                    {item.approxRateBasis && (
                      <span style={{ marginLeft: 6, color: "#64748b", fontWeight: 600 }}>
                        ({item.approxRateBasis})
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, fontSize: 11, color: "#64748b", borderTop: `1px dashed ${item.yetToPurchaseQty > 0 ? "#fca5a5" : "#7dd3fc"}`, paddingTop: 6 }}>
                  <span>
                    {item.approxRateBillNumber ? (
                      <>
                        Ref Bill:{" "}
                        <span
                          onClick={() => onOpenBill?.(item.approxRateBillNumber!)}
                          style={{
                            color: "#0f766e",
                            fontWeight: 700,
                            textDecoration: onOpenBill ? "underline" : "none",
                            cursor: onOpenBill ? "pointer" : "default",
                          }}
                          title={onOpenBill ? "Click to open Bill Drawer" : undefined}
                        >
                          {item.approxRateBillNumber}
                        </span>
                        {item.approxRateDate ? ` · Date: ${formatDisplayDate(item.approxRateDate)}` : ""}
                        {item.approxRateVendor ? ` · Vendor: ${item.approxRateVendor}` : ""}
                        {onOpenBill && (
                          <button
                            type="button"
                            onClick={() => onOpenBill(item.approxRateBillNumber!)}
                            style={{
                              marginLeft: 8,
                              fontSize: 10.5,
                              padding: "2px 6px",
                              background: "#ffffff",
                              color: "#0f766e",
                              border: "1px solid #0f766e",
                              borderRadius: 3,
                              cursor: "pointer",
                              fontWeight: 600,
                            }}
                          >
                            View Rate Evidence
                          </button>
                        )}
                      </>
                    ) : (
                      "No valid actual purchase reference found in local cache"
                    )}
                  </span>
                  <span style={{ fontStyle: "italic" }}>
                    Disclaimer: Decision-support estimate only. Not an accounting/booked value.
                  </span>
                </div>
              </div>
            )}

            {/* Action Bar: Exclusion Status */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, padding: "12px 16px", background: "#f1f5f9", borderRadius: 6, border: "1px solid #cbd5e1" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#334155" }}>Exclusion Rule:</span>
                <span style={{ fontSize: 12.5, color: item.isExcluded ? "#b91c1c" : "#15803d", fontWeight: 600 }}>
                  {item.isExcluded ? "Excluded from local reconciliation" : "Included in active reconciliation"}
                </span>
              </div>
              {!item.isExcluded && (
                <button 
                  className="btn btn-sm" 
                  style={{ color: "#b91c1c", border: "1px solid #b91c1c", background: "#fff", fontSize: 12, padding: "5px 12px", fontWeight: 600, borderRadius: 4, cursor: "pointer" }}
                  onClick={() => setShowExclusionDialog(true)}
                >
                  Exclude from Reconciliation
                </button>
              )}
            </div>

            {/* Purchase Breakdown */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h4 style={{ fontSize: 15, fontWeight: 700, color: "#166534", margin: 0 }}>
                  Purchase Breakdown ({item.purchaseTransactions.length} lines)
                </h4>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  Total: <strong>{formatQuantity(item.totalPurchaseQty)} units</strong> (₹{formatINR(item.totalPurchaseAmount)})
                </span>
              </div>
              <div className="table-responsive" style={{ border: "1px solid #e2e8f0", borderRadius: 6 }}>
                <table className="data-table" style={{ fontSize: 12.5, margin: 0, width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ width: 35, textAlign: "center", fontSize: 11.5 }}>Sr</th>
                      <th style={{ fontSize: 11.5 }}>Bill No.</th>
                      <th style={{ fontSize: 11.5 }}>Bill Date</th>
                      <th style={{ fontSize: 11.5 }}>Vendor</th>
                      <th style={{ fontSize: 11.5 }}>Item</th>
                      <th style={{ fontSize: 11.5 }}>SKU</th>
                      <th className="right" style={{ fontSize: 11.5 }}>Qty</th>
                      <th className="right" style={{ fontSize: 11.5 }}>Rate</th>
                      <th className="right" style={{ fontSize: 11.5 }}>Taxable Amount</th>
                      <th style={{ fontSize: 11.5 }}>Customer Details</th>
                      <th style={{ textAlign: "center", fontSize: 11.5 }}>Exclusion Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.purchaseTransactions.map((tx, idx) => (
                      <tr key={`purchase-${tx.billId}-${tx.lineItemId || tx.billNumber || idx}`}>
                        <td style={{ textAlign: "center", color: "#64748b", verticalAlign: "top" }}>{idx + 1}</td>
                        <td style={{ fontWeight: 600, verticalAlign: "top" }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenBill?.(tx.billId || tx.billNumber);
                              }}
                              style={{
                                cursor: onOpenBill ? "pointer" : "default",
                                color: onOpenBill ? "#0f766e" : "inherit",
                                textDecoration: onOpenBill ? "underline" : "none",
                              }}
                              title={onOpenBill ? "Click to open Purchase Bill details drawer" : undefined}
                            >
                              {tx.billNumber}
                            </span>
                            {tx.billUrl && (
                              <a
                                href={tx.billUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="zoho-link"
                                onClick={(e) => e.stopPropagation()}
                                title="Open in Zoho Books ↗"
                              >
                                ↗
                              </a>
                            )}
                          </div>
                        </td>
                        <td style={{ verticalAlign: "top" }}>{formatDisplayDate(tx.date)}</td>
                        <td style={{ fontWeight: 500, verticalAlign: "top" }}>{tx.vendorName}</td>
                        <td style={{ verticalAlign: "top" }}>
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedItemForDetail({
                                itemId: item.itemId,
                                itemName: tx.itemName || item.itemName,
                                customerId: item.customerId,
                                customerName: item.customerName,
                              });
                            }}
                            style={{
                              color: "#0284c7",
                              cursor: "pointer",
                              textDecoration: "underline",
                              fontWeight: 500,
                            }}
                            title="Click to view Item Detail drawer"
                          >
                            {tx.itemName || item.itemName}
                          </span>
                        </td>
                        <td style={{ verticalAlign: "top" }}><code>{tx.sku || item.sku || "-"}</code></td>
                        <td className="right" style={{ fontWeight: 600, verticalAlign: "top" }}>{formatQuantity(tx.quantity)}</td>
                        <td className="right amount" style={{ verticalAlign: "top" }}>₹{formatINR(tx.rate)}</td>
                        <td className="right amount" style={{ fontWeight: 600, verticalAlign: "top" }}>₹{formatINR(tx.amount)}</td>
                        <td style={{ fontSize: 11.5, color: "#475569", verticalAlign: "top" }} title={tx.purchaseCustomerDetails}>
                          {tx.purchaseCustomerDetails || "—"}
                        </td>
                        <td style={{ textAlign: "center", fontSize: 11.5, verticalAlign: "top" }}>
                          <span style={{ color: tx.exclusionStatus === "EXCLUDED" ? "#b91c1c" : "#15803d", fontWeight: 600 }}>
                            {tx.exclusionStatus || "ACTIVE"}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {item.purchaseTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={11} style={{ textAlign: "center", color: "#94a3b8", padding: "16px" }}>
                          No purchase bill lines found for this item and period.
                        </td>
                      </tr>
                    ) : (
                      <tr className="total-row" style={{ background: "#f8fafc", fontWeight: 700, borderTop: "2px solid #cbd5e1" }}>
                        <td colSpan={6} style={{ textAlign: "left" }}>TOTAL PURCHASE</td>
                        <td className="right" style={{ textAlign: "right" }}>
                          {formatQuantity(item.purchaseTransactions.reduce((acc, t) => acc + t.quantity, 0))}
                        </td>
                        <td className="right" style={{ textAlign: "right" }}>—</td>
                        <td className="right amount" style={{ textAlign: "right" }}>
                          ₹{formatINR(item.purchaseTransactions.reduce((acc, t) => acc + t.amount, 0))}
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sales Breakdown */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h4 style={{ fontSize: 15, fontWeight: 700, color: "#1e40af", margin: 0 }}>
                  Sales Breakdown ({item.salesTransactions.length} lines)
                </h4>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  Total: <strong>{formatQuantity(item.totalSalesQty)} units</strong> (₹{formatINR(item.totalSalesAmount)})
                </span>
              </div>
              <div className="table-responsive" style={{ border: "1px solid #e2e8f0", borderRadius: 6 }}>
                <table className="data-table" style={{ fontSize: 12.5, margin: 0, width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ width: 35, textAlign: "center", fontSize: 11.5 }}>Sr</th>
                      <th style={{ fontSize: 11.5 }}>Invoice No.</th>
                      <th style={{ fontSize: 11.5 }}>Invoice Date</th>
                      <th style={{ fontSize: 11.5 }}>Customer</th>
                      <th style={{ fontSize: 11.5 }}>Item</th>
                      <th style={{ fontSize: 11.5 }}>SKU</th>
                      <th className="right" style={{ fontSize: 11.5 }}>Qty</th>
                      <th className="right" style={{ fontSize: 11.5 }}>Rate</th>
                      <th className="right" style={{ fontSize: 11.5 }}>Taxable Amount</th>
                      <th style={{ textAlign: "center", fontSize: 11.5 }}>Exclusion Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.salesTransactions.map((tx, idx) => (
                      <tr key={`sales-${tx.invoiceId}-${tx.lineItemId || tx.invoiceNumber || idx}`}>
                        <td style={{ textAlign: "center", color: "#64748b", verticalAlign: "top" }}>{idx + 1}</td>
                        <td style={{ fontWeight: 600, verticalAlign: "top" }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenInvoice?.(tx.invoiceId || tx.invoiceNumber);
                              }}
                              style={{
                                cursor: onOpenInvoice ? "pointer" : "default",
                                color: onOpenInvoice ? "#0f766e" : "inherit",
                                textDecoration: onOpenInvoice ? "underline" : "none",
                              }}
                              title={onOpenInvoice ? "Click to open Sales Invoice details drawer" : undefined}
                            >
                              {tx.invoiceNumber}
                            </span>
                            {tx.invoiceUrl && (
                              <a
                                href={tx.invoiceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="zoho-link"
                                onClick={(e) => e.stopPropagation()}
                                title="Open in Zoho Books ↗"
                              >
                                ↗
                              </a>
                            )}
                          </div>
                        </td>
                        <td style={{ verticalAlign: "top" }}>{formatDisplayDate(tx.date)}</td>
                        <td style={{ fontWeight: 500, verticalAlign: "top" }}>{tx.customerName}</td>
                        <td style={{ verticalAlign: "top" }}>
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedItemForDetail({
                                itemId: item.itemId,
                                itemName: tx.itemName || item.itemName,
                                customerId: item.customerId,
                                customerName: item.customerName,
                              });
                            }}
                            style={{
                              color: "#0284c7",
                              cursor: "pointer",
                              textDecoration: "underline",
                              fontWeight: 500,
                            }}
                            title="Click to view Item Detail drawer"
                          >
                            {tx.itemName || item.itemName}
                          </span>
                        </td>
                        <td style={{ verticalAlign: "top" }}><code>{tx.sku || item.sku || "-"}</code></td>
                        <td className="right" style={{ fontWeight: 600, verticalAlign: "top" }}>{formatQuantity(tx.quantity)}</td>
                        <td className="right amount" style={{ verticalAlign: "top" }}>₹{formatINR(tx.rate)}</td>
                        <td className="right amount" style={{ fontWeight: 600, verticalAlign: "top" }}>₹{formatINR(tx.amount)}</td>
                        <td style={{ textAlign: "center", fontSize: 11.5, verticalAlign: "top" }}>
                          <span style={{ color: tx.exclusionStatus === "EXCLUDED" ? "#b91c1c" : "#15803d", fontWeight: 600 }}>
                            {tx.exclusionStatus || "ACTIVE"}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {item.salesTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ textAlign: "center", color: "#94a3b8", padding: "16px" }}>
                          No sales invoice lines found for this item and period.
                        </td>
                      </tr>
                    ) : (
                      <tr className="total-row" style={{ background: "#f8fafc", fontWeight: 700, borderTop: "2px solid #cbd5e1" }}>
                        <td colSpan={6} style={{ textAlign: "left" }}>TOTAL SALES</td>
                        <td className="right" style={{ textAlign: "right" }}>
                          {formatQuantity(item.salesTransactions.reduce((acc, t) => acc + t.quantity, 0))}
                        </td>
                        <td className="right" style={{ textAlign: "right" }}>—</td>
                        <td className="right amount" style={{ textAlign: "right" }}>
                          ₹{formatINR(item.salesTransactions.reduce((acc, t) => acc + t.amount, 0))}
                        </td>
                        <td></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

          {/* Footer */}
          <div style={{ padding: "14px 24px", borderTop: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>
              ⚡ 100% Local SQLite Analytics · Zero Zoho API Calls
            </span>
            <button
              className="btn btn-secondary"
              onClick={onClose}
              style={{ padding: "6px 20px" }}
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {showExclusionDialog && item && (
        <ExclusionDialog
          item={item}
          financialYear={financialYear}
          onClose={() => setShowExclusionDialog(false)}
          onSuccess={() => {
            setShowExclusionDialog(false);
            if (onExclusionSuccess) onExclusionSuccess();
          }}
        />
      )}

      {/* Item Detail Drawer */}
      {selectedItemForDetail && (
        <ItemDetailDrawer
          itemId={selectedItemForDetail.itemId}
          itemName={selectedItemForDetail.itemName}
          financialYear={financialYear}
          initialCustomerId={selectedItemForDetail.customerId}
          initialCustomerName={selectedItemForDetail.customerName}
          onClose={() => setSelectedItemForDetail(null)}
          onOpenBill={onOpenBill}
          onOpenInvoice={onOpenInvoice}
          onExclusionSuccess={() => {
            setSelectedItemForDetail(null);
            onExclusionSuccess?.();
          }}
        />
      )}

      {showExportDialog && item && (
        <ExportDialog
          isOpen={showExportDialog}
          onClose={() => setShowExportDialog(false)}
          onExport={handleExecuteExport}
          reportType="transaction-breakdown"
          filter={{
            financialYear,
            customerId: item.customerId,
            customerName: item.customerName,
            itemId: item.itemId,
            itemName: item.itemName,
          }}
          totalRecords={(item.purchaseTransactions?.length || 0) + (item.salesTransactions?.length || 0)}
        />
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}} />
    </>
  );
}

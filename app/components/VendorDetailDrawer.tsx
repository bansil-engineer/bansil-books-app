"use client";

// ============================================================
// Bansil Books Analytics — Vendor Detail Drawer
// Local SQLite First · Zero Zoho Mutation · Zero Zoho API Calls
// ============================================================

import React, { useState, useEffect, useCallback } from "react";
import { formatINR, formatQuantity, formatDisplayDate } from "@/app/lib/date-utils";
import type { VendorDetailResult, VendorBillRow, VendorItemRow, VendorPriceHistoryRow, VendorCustomerSuppliedRow } from "@/app/lib/vendor-engine";

export interface VendorDetailDrawerProps {
  vendorName?: string;
  vendorId?: string;
  financialYear?: string;
  onClose: () => void;
  onOpenBill?: (billId: string) => void;
  onOpenItem?: (itemId: string, itemName?: string) => void;
  onOpenDate?: (date: string) => void;
  onNavigateToCustomer?: (customerId: string, customerName?: string) => void;
}

type VendorTab = "overview" | "bills" | "items" | "price" | "customers";

export function VendorDetailDrawer({
  vendorName: initialVendorName,
  vendorId: initialVendorId,
  financialYear,
  onClose,
  onOpenBill,
  onOpenItem,
  onOpenDate,
  onNavigateToCustomer,
}: VendorDetailDrawerProps) {
  const [data, setData] = useState<VendorDetailResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<VendorTab>("overview");

  // Esc key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const fetchVendorDetail = useCallback(async () => {
    if (!initialVendorName && !initialVendorId) return;
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        type: "vendor-detail",
      });
      if (initialVendorName) params.set("vendorName", initialVendorName);
      if (initialVendorId) params.set("vendorId", initialVendorId);
      if (financialYear) params.set("financialYear", financialYear);

      const res = await fetch(`/api/transactions?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || "Failed to load vendor details.");
        setData(null);
        return;
      }
      const json = await res.json();
      if (json.vendor) {
        setData(json.vendor);
      } else {
        setError("Vendor records not found in local cache.");
      }
    } catch (err) {
      console.error("[VendorDetailDrawer] Fetch error:", err);
      setError("Failed to load vendor details from local SQLite.");
    } finally {
      setLoading(false);
    }
  }, [initialVendorName, initialVendorId, financialYear]);

  useEffect(() => {
    fetchVendorDetail();
  }, [fetchVendorDetail]);

  const kpis = data?.kpis;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2150,
        display: "flex",
        justifyContent: "flex-end",
        background: "rgba(15, 23, 42, 0.5)",
      }}
      role="dialog"
      aria-modal="true"
    >
      <div style={{ flex: 1 }} onClick={onClose} />
      <div
        style={{
          width: "min(960px, 94vw)",
          background: "#ffffff",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-8px 0 32px rgba(0, 0, 0, 0.2)",
          position: "relative",
          zIndex: 2151,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid #e2e8f0",
            background: "#f8fafc",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>🏢</span>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0 }}>
                {data?.vendorName || initialVendorName || "Vendor Detail"}
              </h2>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "#e0e7ff",
                  color: "#3730a3",
                }}
              >
                VENDOR
              </span>
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
              {data?.vendorId && <span>Vendor ID: <code style={{ color: "#0f172a" }}>{data.vendorId}</code> · </span>}
              <span>Local SQLite Cache · Read-Only (0 Zoho Calls)</span>
            </div>
          </div>
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
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Summary KPI Strip */}
        {kpis && (
          <div
            style={{
              padding: "14px 24px",
              background: "#ffffff",
              borderBottom: "1px solid #e2e8f0",
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              gap: 10,
            }}
          >
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>PURCHASE BILLS</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{kpis.purchaseBillCount}</div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>PURCHASE QTY</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#16a34a", marginTop: 2 }}>{formatQuantity(kpis.purchaseQty)}</div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>TAXABLE VALUE</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>₹{formatINR(kpis.purchaseTaxableValue)}</div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>OUTSTANDING BAL</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: kpis.outstandingBalance > 0 ? "#d97706" : "#16a34a", marginTop: 2 }}>
                ₹{formatINR(kpis.outstandingBalance)}
              </div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>LATEST PURCHASE</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0284c7", marginTop: 3 }}>
                {kpis.latestPurchaseDate ? (
                  <span
                    onClick={(e) => { e.stopPropagation(); onOpenDate?.(kpis.latestPurchaseDate!); }}
                    style={{ cursor: "pointer", textDecoration: "underline" }}
                    title="View transactions on this date"
                  >
                    {formatDisplayDate(kpis.latestPurchaseDate)}
                  </span>
                ) : "—"}
              </div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>DISTINCT ITEMS</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{kpis.itemCount}</div>
            </div>
          </div>
        )}

        {/* Tabs Bar */}
        <div style={{ display: "flex", gap: 6, padding: "0 24px", background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
          {[
            { id: "overview" as const, label: "Overview" },
            { id: "bills" as const, label: `Purchase Bills (${data?.bills.length || 0})` },
            { id: "items" as const, label: `Items Purchased (${data?.items.length || 0})` },
            { id: "price" as const, label: `Price History (${data?.priceHistory.length || 0})` },
            { id: "customers" as const, label: `Customers Supplied (${data?.customersSupplied.length || 0})` },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: "10px 14px",
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

        {/* Body Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {loading && (
            <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
              Loading local vendor details...
            </div>
          )}

          {error && (
            <div style={{ padding: 16, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>
              {error}
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* ── 1. OVERVIEW TAB ── */}
              {activeTab === "overview" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, background: "#ffffff" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>
                        🏢 Vendor Profile (Local SQLite)
                      </div>
                      <table style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                        <tbody>
                          <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "6px 0", color: "#64748b", width: 140 }}>Vendor Name:</td>
                            <td style={{ padding: "6px 0", fontWeight: 700 }}>{data.vendorName}</td>
                          </tr>
                          <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "6px 0", color: "#64748b" }}>Vendor ID:</td>
                            <td style={{ padding: "6px 0", fontFamily: "monospace" }}>{data.vendorId || "—"}</td>
                          </tr>
                          <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "6px 0", color: "#64748b" }}>Financial Year:</td>
                            <td style={{ padding: "6px 0", fontWeight: 600 }}>{data.financialYear || "ALL"}</td>
                          </tr>
                          <tr>
                            <td style={{ padding: "6px 0", color: "#64748b" }}>Data Source:</td>
                            <td style={{ padding: "6px 0", color: "#0f766e", fontWeight: 600 }}>Local SQLite (purchase_bills)</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, background: "#ffffff" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>
                        📊 Quick Purchasing Summary
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                        <div>Total Invoiced Units: <strong>{formatQuantity(kpis?.purchaseQty || 0)} units</strong></div>
                        <div>Total Taxable Amount: <strong>₹{formatINR(kpis?.purchaseTaxableValue || 0)}</strong></div>
                        <div>Latest Transaction: <strong>{kpis?.latestPurchaseDate ? formatDisplayDate(kpis.latestPurchaseDate) : "—"}</strong></div>
                        <div>Outstanding Balance: <strong>₹{formatINR(kpis?.outstandingBalance || 0)}</strong></div>
                      </div>
                    </div>
                  </div>

                  {/* Top Items Preview */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Top Items Purchased</div>
                      <button
                        onClick={() => setActiveTab("items")}
                        style={{ background: "none", border: "none", color: "#0284c7", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                      >
                        View all ({data.items.length}) →
                      </button>
                    </div>
                    <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          <th style={{ padding: "6px 10px" }}>Item Name</th>
                          <th style={{ padding: "6px 10px" }}>SKU</th>
                          <th style={{ padding: "6px 10px", textAlign: "right" }}>Qty</th>
                          <th style={{ padding: "6px 10px", textAlign: "right" }}>Latest Rate</th>
                          <th style={{ padding: "6px 10px", textAlign: "right" }}>Weighted Avg</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.slice(0, 5).map((it) => (
                          <tr key={it.itemId || it.itemName}>
                            <td style={{ padding: "6px 10px" }}>
                              <span
                                onClick={(e) => { e.stopPropagation(); onOpenItem?.(it.itemId, it.itemName); }}
                                style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                                title="Open Item Detail & Movement drawer"
                              >
                                {it.itemName}
                              </span>
                            </td>
                            <td style={{ padding: "6px 10px", color: "#64748b" }}>{it.sku || "—"}</td>
                            <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>{formatQuantity(it.purchaseQty)}</td>
                            <td style={{ padding: "6px 10px", textAlign: "right" }}>₹{formatINR(it.latestRate)}</td>
                            <td style={{ padding: "6px 10px", textAlign: "right" }}>₹{formatINR(it.weightedAverageRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── 2. PURCHASE BILLS TAB ── */}
              {activeTab === "bills" && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>
                    Purchase Bills ({data.bills.length})
                  </div>
                  <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={{ width: 35, textAlign: "center" }}>#</th>
                        <th>Date</th>
                        <th>Bill No.</th>
                        <th style={{ textAlign: "right" }}>Item Count</th>
                        <th style={{ textAlign: "right" }}>Qty</th>
                        <th style={{ textAlign: "right" }}>Taxable Value</th>
                        <th style={{ textAlign: "right" }}>Grand Total</th>
                        <th style={{ textAlign: "right" }}>Balance</th>
                        <th style={{ textAlign: "center" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bills.map((b, idx) => (
                        <tr key={b.billId}>
                          <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                          <td>
                            <span
                              onClick={(e) => { e.stopPropagation(); onOpenDate?.(b.date); }}
                              style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                              title="View all transactions on this date"
                            >
                              {formatDisplayDate(b.date)}
                            </span>
                          </td>
                          <td>
                            <span
                              onClick={(e) => { e.stopPropagation(); onOpenBill?.(b.billId || b.billNumber); }}
                              style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 700 }}
                              title="Open Purchase Bill drawer"
                            >
                              {b.billNumber}
                            </span>
                          </td>
                          <td style={{ textAlign: "right" }}>{b.itemCount}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{formatQuantity(b.quantity)}</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(b.taxableValue)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>₹{formatINR(b.grandTotal)}</td>
                          <td style={{ textAlign: "right", color: b.balance > 0 ? "#d97706" : "#16a34a" }}>
                            ₹{formatINR(b.balance)}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#f1f5f9", fontWeight: 600 }}>
                              {b.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "#f8fafc", fontWeight: 700, borderTop: "2px solid #cbd5e1" }}>
                        <td colSpan={4}>TOTAL</td>
                        <td style={{ textAlign: "right" }}>{formatQuantity(data.bills.reduce((sum, b) => sum + b.quantity, 0))}</td>
                        <td style={{ textAlign: "right" }}>₹{formatINR(data.bills.reduce((sum, b) => sum + b.taxableValue, 0))}</td>
                        <td style={{ textAlign: "right" }}>₹{formatINR(data.bills.reduce((sum, b) => sum + b.grandTotal, 0))}</td>
                        <td style={{ textAlign: "right" }}>₹{formatINR(data.bills.reduce((sum, b) => sum + b.balance, 0))}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* ── 3. ITEMS PURCHASED TAB ── */}
              {activeTab === "items" && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>
                    Items Purchased from this Vendor ({data.items.length})
                  </div>
                  <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={{ width: 35, textAlign: "center" }}>#</th>
                        <th>Item Name</th>
                        <th>SKU</th>
                        <th style={{ textAlign: "right" }}>Purchase Qty</th>
                        <th style={{ textAlign: "right" }}>Latest Rate</th>
                        <th style={{ textAlign: "right" }}>Lowest Rate</th>
                        <th style={{ textAlign: "right" }}>Highest Rate</th>
                        <th style={{ textAlign: "right" }}>Weighted Avg</th>
                        <th>Last Purchase Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((it, idx) => (
                        <tr key={it.itemId || it.itemName}>
                          <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                          <td>
                            <span
                              onClick={(e) => { e.stopPropagation(); onOpenItem?.(it.itemId, it.itemName); }}
                              style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                              title="Open Item Detail & Movement drawer"
                            >
                              {it.itemName}
                            </span>
                          </td>
                          <td style={{ color: "#64748b" }}>{it.sku || "—"}</td>
                          <td style={{ textAlign: "right", fontWeight: 700 }}>{formatQuantity(it.purchaseQty)}</td>
                          <td style={{ textAlign: "right", color: "#15803d", fontWeight: 700 }}>₹{formatINR(it.latestRate)}</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(it.lowestRate)}</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(it.highestRate)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>₹{formatINR(it.weightedAverageRate)}</td>
                          <td>
                            {it.lastPurchaseDate ? (
                              <span
                                onClick={(e) => { e.stopPropagation(); onOpenDate?.(it.lastPurchaseDate!); }}
                                style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                title="View transactions on this date"
                              >
                                {formatDisplayDate(it.lastPurchaseDate)}
                              </span>
                            ) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── 4. PRICE HISTORY TAB ── */}
              {activeTab === "price" && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>
                    Price History ({data.priceHistory.length} Transactions)
                  </div>
                  <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={{ width: 35, textAlign: "center" }}>#</th>
                        <th>Date</th>
                        <th>Bill No.</th>
                        <th>Item</th>
                        <th>SKU</th>
                        <th style={{ textAlign: "right" }}>Qty</th>
                        <th style={{ textAlign: "right" }}>Rate</th>
                        <th style={{ textAlign: "right" }}>Taxable Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.priceHistory.map((p, idx) => (
                        <tr key={idx}>
                          <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                          <td>
                            <span
                              onClick={(e) => { e.stopPropagation(); onOpenDate?.(p.date); }}
                              style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                              title="View transactions on this date"
                            >
                              {formatDisplayDate(p.date)}
                            </span>
                          </td>
                          <td>
                            <span
                              onClick={(e) => { e.stopPropagation(); onOpenBill?.(p.billId || p.billNumber); }}
                              style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                              title="Open Purchase Bill drawer"
                            >
                              {p.billNumber}
                            </span>
                          </td>
                          <td>
                            <span
                              onClick={(e) => { e.stopPropagation(); onOpenItem?.(p.itemId, p.itemName); }}
                              style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                              title="Open Item Detail & Movement drawer"
                            >
                              {p.itemName}
                            </span>
                          </td>
                          <td style={{ color: "#64748b" }}>{p.sku || "—"}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{formatQuantity(p.quantity)}</td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: "#15803d" }}>₹{formatINR(p.rate)}</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(p.taxableValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── 5. CUSTOMERS SUPPLIED TAB ── */}
              {activeTab === "customers" && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>
                    Customers Supplied via this Vendor ({data.customersSupplied.length})
                  </div>
                  <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={{ width: 35, textAlign: "center" }}>#</th>
                        <th>Customer Name</th>
                        <th style={{ textAlign: "right" }}>Item Count</th>
                        <th style={{ textAlign: "right" }}>Total Qty</th>
                        <th style={{ textAlign: "right" }}>Total Taxable Value</th>
                        <th>Latest Supplied Date</th>
                        <th style={{ textAlign: "center" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.customersSupplied.map((c, idx) => (
                        <tr key={idx}>
                          <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                          <td style={{ fontWeight: 600 }}>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                if (c.customerName !== "UNMAPPED") {
                                  onNavigateToCustomer?.(c.customerId || "", c.customerName);
                                }
                              }}
                              style={{
                                color: c.customerName !== "UNMAPPED" ? "#0284c7" : "#94a3b8",
                                cursor: c.customerName !== "UNMAPPED" ? "pointer" : "default",
                                textDecoration: c.customerName !== "UNMAPPED" ? "underline" : "none",
                              }}
                              title={c.customerName !== "UNMAPPED" ? "Open Customer Details 360" : undefined}
                            >
                              {c.customerName}
                            </span>
                          </td>
                          <td style={{ textAlign: "right" }}>{c.itemCount}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{formatQuantity(c.totalQty)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>₹{formatINR(c.totalTaxableValue)}</td>
                          <td>
                            {c.latestDate ? (
                              <span
                                onClick={(e) => { e.stopPropagation(); onOpenDate?.(c.latestDate!); }}
                                style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                title="View transactions on this date"
                              >
                                {formatDisplayDate(c.latestDate)}
                              </span>
                            ) : "—"}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            {c.customerName !== "UNMAPPED" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onNavigateToCustomer?.(c.customerId || "", c.customerName);
                                }}
                                style={{
                                  padding: "3px 8px",
                                  background: "#f1f5f9",
                                  border: "1px solid #cbd5e1",
                                  borderRadius: 4,
                                  fontSize: 11,
                                  cursor: "pointer",
                                }}
                              >
                                Customer 360 →
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

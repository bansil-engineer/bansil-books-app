"use client";

// ============================================================
// Bansil Books Analytics — Date-Wise Transaction Details Drawer
// Strictly Read-Only · Zero Zoho Mutation · Local SQLite Only
// ============================================================

import React, { useState, useEffect, useCallback } from "react";
import { formatINR, formatQuantity, formatDisplayDate } from "@/app/lib/date-utils";
import type { DateTransactionsResult, DateCombinedRecord, DatePurchaseRecord, DateSalesRecord } from "@/app/lib/date-transaction-engine";

export interface DateDetailDrawerProps {
  date: string; // YYYY-MM-DD
  itemId?: string;
  itemName?: string;
  onClose: () => void;
  onOpenBill?: (billId: string) => void;
  onOpenInvoice?: (invoiceId: string) => void;
  onOpenVendor?: (vendorName: string, vendorId?: string) => void;
  onOpenItem?: (itemId: string, itemName?: string) => void;
  onNavigateToCustomer?: (customerId: string, customerName?: string) => void;
}

type DateTab = "all" | "purchases" | "sales";

export function DateDetailDrawer({
  date,
  itemId,
  itemName,
  onClose,
  onOpenBill,
  onOpenInvoice,
  onOpenVendor,
  onOpenItem,
  onNavigateToCustomer,
}: DateDetailDrawerProps) {
  const [data, setData] = useState<DateTransactionsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DateTab>("all");
  const [viewAllRecords, setViewAllRecords] = useState<boolean>(!itemId && !itemName);

  // Esc key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const fetchDateDetail = useCallback(async () => {
    if (!date) return;
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        type: "date-detail",
        date,
      });
      if (itemId) params.set("itemId", itemId);
      if (itemName) params.set("itemName", itemName);
      if (viewAllRecords) params.set("ignoreItemFilter", "true");

      const res = await fetch(`/api/transactions?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || "Failed to load date transactions.");
        setData(null);
        return;
      }
      const json = await res.json();
      if (json.dateData) {
        setData(json.dateData);
      } else {
        setError("No records found for this date in local cache.");
      }
    } catch (err) {
      console.error("[DateDetailDrawer] Fetch error:", err);
      setError("Failed to load date transactions from local SQLite.");
    } finally {
      setLoading(false);
    }
  }, [date, itemId, itemName, viewAllRecords]);

  useEffect(() => {
    fetchDateDetail();
  }, [fetchDateDetail]);

  const kpis = data?.kpis;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2200,
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
          width: "min(1020px, 95vw)",
          background: "#ffffff",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-8px 0 32px rgba(0, 0, 0, 0.2)",
          position: "relative",
          zIndex: 2201,
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
              <span style={{ fontSize: 20 }}>📅</span>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0 }}>
                Transactions on {formatDisplayDate(date)}
              </h2>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "#e0f2fe",
                  color: "#0369a1",
                }}
              >
                DATE TRANSACTIONS
              </span>
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
              <span>Local SQLite Records (0 Zoho Calls)</span>
              {(itemId || itemName) && (
                <span style={{ color: "#0284c7", fontWeight: 600 }}>
                  · {viewAllRecords ? "Showing all items on this date" : `Filtered for: ${itemName || itemId}`}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {(itemId || itemName) && (
              <button
                onClick={() => setViewAllRecords(!viewAllRecords)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid #0284c7",
                  background: viewAllRecords ? "#f0f9ff" : "#0284c7",
                  color: viewAllRecords ? "#0284c7" : "#ffffff",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {viewAllRecords ? `Filter to ${itemName || "Selected Item"}` : "View All Records on This Date"}
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
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Summary KPI Strip */}
        {kpis && (
          <div
            style={{
              padding: "12px 24px",
              background: "#ffffff",
              borderBottom: "1px solid #e2e8f0",
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              gap: 10,
            }}
          >
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>PURCHASE BILLS</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{kpis.billCount}</div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>SALES INVOICES</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{kpis.invoiceCount}</div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>TOTAL LINE ITEMS</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0284c7", marginTop: 2 }}>{kpis.totalLineItems}</div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>PURCHASE QTY</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#16a34a", marginTop: 2 }}>{formatQuantity(kpis.purchaseQty)}</div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>PURCHASE VALUE</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>₹{formatINR(kpis.purchaseValue)}</div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>SALES VALUE</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>₹{formatINR(kpis.salesValue)}</div>
            </div>
          </div>
        )}

        {/* Tabs Bar */}
        <div style={{ display: "flex", gap: 6, padding: "0 24px", background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
          {[
            { id: "all" as const, label: `All (${data?.all.length || 0})` },
            { id: "purchases" as const, label: `Purchases (${data?.purchases.length || 0})` },
            { id: "sales" as const, label: `Sales (${data?.sales.length || 0})` },
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
              Loading transactions for {formatDisplayDate(date)}...
            </div>
          )}

          {error && (
            <div style={{ padding: 16, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>
              {error}
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* ── 1. ALL TRANSACTIONS TAB ── */}
              {activeTab === "all" && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>
                    Combined Line-Level Records ({data.all.length})
                  </div>
                  <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={{ width: 35, textAlign: "center" }}>#</th>
                        <th>Type</th>
                        <th>Document No.</th>
                        <th>Vendor / Customer</th>
                        <th>Item Name</th>
                        <th>SKU</th>
                        <th style={{ textAlign: "right" }}>Qty</th>
                        <th style={{ textAlign: "right" }}>Rate</th>
                        <th style={{ textAlign: "right" }}>Taxable Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.all.map((row, idx) => {
                        const isPurchase = row.type === "PURCHASE";
                        return (
                          <tr key={row.lineItemId || idx}>
                            <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                            <td>
                              <span
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: isPurchase ? "#dcfce7" : "#eff6ff",
                                  color: isPurchase ? "#166534" : "#1e40af",
                                }}
                              >
                                {row.type}
                              </span>
                            </td>
                            <td style={{ fontWeight: 600 }}>
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isPurchase) {
                                    onOpenBill?.(row.documentId || row.documentNumber);
                                  } else {
                                    onOpenInvoice?.(row.documentId || row.documentNumber);
                                  }
                                }}
                                style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                title={isPurchase ? "Open Purchase Bill drawer" : "Open Sales Invoice drawer"}
                              >
                                {row.documentNumber}
                              </span>
                            </td>
                            <td>
                              {isPurchase ? (
                                <span
                                  onClick={(e) => { e.stopPropagation(); onOpenVendor?.(row.entityName, row.entityId || undefined); }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 500 }}
                                  title="Open Vendor Detail drawer"
                                >
                                  {row.entityName}
                                </span>
                              ) : (
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onNavigateToCustomer?.(row.entityId || "", row.entityName);
                                  }}
                                  style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 500 }}
                                  title="Open Customer Details 360"
                                >
                                  {row.entityName}
                                </span>
                              )}
                              {row.secondaryEntityName && (
                                <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 2 }}>
                                  Cust: <span
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onNavigateToCustomer?.(row.secondaryEntityId || "", row.secondaryEntityName!);
                                    }}
                                    style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                  >{row.secondaryEntityName}</span>
                                </div>
                              )}
                            </td>
                            <td>
                              <span
                                onClick={(e) => { e.stopPropagation(); onOpenItem?.(row.itemId, row.itemName); }}
                                style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                                title="Open Item Detail drawer"
                              >
                                {row.itemName}
                              </span>
                            </td>
                            <td style={{ color: "#64748b" }}>{row.sku || "—"}</td>
                            <td style={{ textAlign: "right", fontWeight: 600 }}>{formatQuantity(row.quantity)}</td>
                            <td style={{ textAlign: "right" }}>₹{formatINR(row.rate)}</td>
                            <td style={{ textAlign: "right", fontWeight: 600 }}>₹{formatINR(row.taxableValue)}</td>
                          </tr>
                        );
                      })}
                      {data.all.length === 0 && (
                        <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No records found for this date.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── 2. PURCHASES TAB ── */}
              {activeTab === "purchases" && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>
                    Purchases on {formatDisplayDate(date)} ({data.purchases.length} Lines)
                  </div>
                  <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={{ width: 35, textAlign: "center" }}>#</th>
                        <th>Bill No.</th>
                        <th>Vendor</th>
                        <th>Customer Details</th>
                        <th>Item Name</th>
                        <th>SKU</th>
                        <th style={{ textAlign: "right" }}>Qty</th>
                        <th style={{ textAlign: "right" }}>Rate</th>
                        <th style={{ textAlign: "right" }}>Taxable Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.purchases.map((p, idx) => (
                        <tr key={p.lineItemId || idx}>
                          <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                          <td style={{ fontWeight: 600 }}>
                            <span
                              onClick={(e) => { e.stopPropagation(); onOpenBill?.(p.billId || p.billNumber); }}
                              style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                              title="Open Purchase Bill drawer"
                            >
                              {p.billNumber}
                            </span>
                          </td>
                          <td>
                            <span
                              onClick={(e) => { e.stopPropagation(); onOpenVendor?.(p.vendorName, p.vendorId); }}
                              style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 500 }}
                              title="Open Vendor Detail drawer"
                            >
                              {p.vendorName}
                            </span>
                          </td>
                          <td style={{ color: "#475569" }}>
                            {p.customerName !== "UNMAPPED" ? (
                              <span
                                onClick={(e) => { e.stopPropagation(); onNavigateToCustomer?.(p.customerId || "", p.customerName); }}
                                style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                                title="Open Customer Details 360"
                              >
                                {p.customerName}
                              </span>
                            ) : "—"}
                          </td>
                          <td>
                            <span
                              onClick={(e) => { e.stopPropagation(); onOpenItem?.(p.itemId, p.itemName); }}
                              style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                              title="Open Item Detail drawer"
                            >
                              {p.itemName}
                            </span>
                          </td>
                          <td style={{ color: "#64748b" }}>{p.sku || "—"}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{formatQuantity(p.quantity)}</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(p.rate)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>₹{formatINR(p.taxableValue)}</td>
                        </tr>
                      ))}
                      {data.purchases.length === 0 && (
                        <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No purchase records found for this date.</td></tr>
                      )}
                    </tbody>
                    {data.purchases.length > 0 && (
                      <tfoot>
                        <tr style={{ background: "#f8fafc", fontWeight: 700, borderTop: "2px solid #cbd5e1" }}>
                          <td colSpan={6}>TOTAL</td>
                          <td style={{ textAlign: "right" }}>{formatQuantity(data.purchases.reduce((s, p) => s + p.quantity, 0))}</td>
                          <td style={{ textAlign: "right" }}>—</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(data.purchases.reduce((s, p) => s + p.taxableValue, 0))}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}

              {/* ── 3. SALES TAB ── */}
              {activeTab === "sales" && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>
                    Sales on {formatDisplayDate(date)} ({data.sales.length} Lines)
                  </div>
                  <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={{ width: 35, textAlign: "center" }}>#</th>
                        <th>Invoice No.</th>
                        <th>Customer</th>
                        <th>Item Name</th>
                        <th>SKU</th>
                        <th style={{ textAlign: "right" }}>Qty</th>
                        <th style={{ textAlign: "right" }}>Rate</th>
                        <th style={{ textAlign: "right" }}>Taxable Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sales.map((s, idx) => (
                        <tr key={s.lineItemId || idx}>
                          <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                          <td style={{ fontWeight: 600 }}>
                            <span
                              onClick={(e) => { e.stopPropagation(); onOpenInvoice?.(s.invoiceId || s.invoiceNumber); }}
                              style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                              title="Open Sales Invoice drawer"
                            >
                              {s.invoiceNumber}
                            </span>
                          </td>
                          <td>
                            <span
                              onClick={(e) => { e.stopPropagation(); onNavigateToCustomer?.(s.customerId, s.customerName); }}
                              style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 500 }}
                              title="Open Customer Details 360"
                            >
                              {s.customerName}
                            </span>
                          </td>
                          <td>
                            <span
                              onClick={(e) => { e.stopPropagation(); onOpenItem?.(s.itemId, s.itemName); }}
                              style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                              title="Open Item Detail drawer"
                            >
                              {s.itemName}
                            </span>
                          </td>
                          <td style={{ color: "#64748b" }}>{s.sku || "—"}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{formatQuantity(s.quantity)}</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(s.rate)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>₹{formatINR(s.taxableValue)}</td>
                        </tr>
                      ))}
                      {data.sales.length === 0 && (
                        <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No sales records found for this date.</td></tr>
                      )}
                    </tbody>
                    {data.sales.length > 0 && (
                      <tfoot>
                        <tr style={{ background: "#f8fafc", fontWeight: 700, borderTop: "2px solid #cbd5e1" }}>
                          <td colSpan={5}>TOTAL</td>
                          <td style={{ textAlign: "right" }}>{formatQuantity(data.sales.reduce((acc, s) => acc + s.quantity, 0))}</td>
                          <td style={{ textAlign: "right" }}>—</td>
                          <td style={{ textAlign: "right" }}>₹{formatINR(data.sales.reduce((acc, s) => acc + s.taxableValue, 0))}</td>
                        </tr>
                      </tfoot>
                    )}
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

"use client";

// ============================================================
// Bansil Books Analytics — Inventory Stock View
// Single item-wise stock / movement / evidence screen
// ZERO ZOHO API CALLS on view/filter/click
// ============================================================

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { formatINR, formatQuantity, formatDisplayDate } from "@/app/lib/date-utils";
import { getCurrentFinancialYear, getPreviousFinancialYear } from "@/app/lib/date-period-utils";
import type {
  StockSummaryRow,
  StockSummaryResult,
  ItemStockDetail,
  StockKPIs,
  PurchaseLine,
  SalesLine,
  CustomerMovement,
  TimelineEntry,
  StockFilter,
} from "@/app/lib/stock-engine";
import { isStockItemExcludable } from "@/app/lib/stock-utils";
import { VendorDetailDrawer } from "./VendorDetailDrawer";
import { DateDetailDrawer } from "./DateDetailDrawer";
import { ExclusionDialog } from "./ExclusionDialog";
import { ExportFieldSelector } from "./ExportFieldSelector";
import type { ExportOptions } from "@/app/types/reconciliation";
import { SectionSyncControl } from "./SectionSyncControl";

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────
interface InventoryStockViewProps {
  financialYear?: string;
  onNavigateToCustomer?: (customerId: string, customerName?: string, preferredTab?: "OVERVIEW" | "RECONCILIATION") => void;
}

// ─────────────────────────────────────────────────────────────
// Status chip
// ─────────────────────────────────────────────────────────────
function StockStatusChip({ status }: { status: string }) {
  const styles: Record<string, React.CSSProperties> = {
    IN_STOCK: { background: "#dcfce7", color: "#15803d", border: "1px solid #bbf7d0" },
    ZERO_STOCK: { background: "#f3f4f6", color: "#6b7280", border: "1px solid #d1d5db" },
    NEGATIVE: { background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5" },
    PURCHASE_ONLY: { background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" },
    SALES_ONLY: { background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa" },
    COMPOSITE: { background: "#f5f3ff", color: "#7c3aed", border: "1px solid #ddd6fe" },
    NO_MOVEMENT: { background: "#f9fafb", color: "#9ca3af", border: "1px solid #e5e7eb" },
  };
  const labels: Record<string, string> = {
    IN_STOCK: "In Stock", ZERO_STOCK: "Zero Stock", NEGATIVE: "Negative",
    PURCHASE_ONLY: "Purchase Only", SALES_ONLY: "Sales Only",
    COMPOSITE: "Composite", NO_MOVEMENT: "No Movement",
  };
  const style = styles[status] ?? { background: "#f3f4f6", color: "#374151", border: "1px solid #d1d5db" };
  return (
    <span style={{ ...style, padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
      {labels[status] ?? status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// KPI Card
// ─────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  sub,
  color,
  icon,
  isMonetary,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon?: string;
  isMonetary?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className="stock-kpi-card"
      onClick={onClick}
      style={{
        cursor: onClick ? "pointer" : "default",
      }}
      onMouseEnter={(e) => {
        if (onClick) (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "";
      }}
    >
      <div>
        <div className="stock-kpi-label" title={label}>
          {icon && <span style={{ marginRight: 6 }}>{icon}</span>}
          {label}
        </div>
        <div
          className={`stock-kpi-value${isMonetary ? " is-monetary" : ""}`}
          style={{ color: color ?? "var(--text-primary, #0f172a)" }}
          title={String(value)}
        >
          {value}
        </div>
      </div>
      <div className="stock-kpi-sub">
        {sub || "\u00A0"}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Purchase Bill Drawer (local only)
// ─────────────────────────────────────────────────────────────
interface BillDoc {
  bill_id?: string; bill_number?: string; date?: string; vendor_name?: string;
  status?: string; total?: number; bill_url?: string;
  lines?: Array<{ line_item_id: string; item_name: string; sku?: string; quantity: number; rate: number; line_total: number; purchase_line_customer_name?: string; bbt_customer_name?: string; description?: string }>;
}

function BillDrawer({ billDoc, onClose }: { billDoc: BillDoc | null; onClose: () => void }) {
  if (!billDoc) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex" }}
      role="dialog" aria-modal="true"
    >
      <div style={{ flex: 1, background: "rgba(0,0,0,0.3)", cursor: "pointer" }} onClick={onClose} />
      <div style={{ width: "min(700px, 90vw)", background: "#fff", overflowY: "auto", boxShadow: "-4px 0 24px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Purchase Bill — {billDoc.bill_number}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{billDoc.vendor_name} · {formatDisplayDate(billDoc.date || "")} · {billDoc.status}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {billDoc.bill_url && (
              <a href={billDoc.bill_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                style={{ fontSize: 11, color: "#2563eb", border: "1px solid #bfdbfe", padding: "4px 10px", borderRadius: 6, textDecoration: "none" }}>
                ↗ Zoho
              </a>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" }} aria-label="Close">×</button>
          </div>
        </div>
        <div style={{ padding: "16px 24px", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: "#f8fafc" }}>
              {["Item", "SKU", "Customer", "Qty", "Rate", "Value"].map((h) => (
                <th key={h} style={{ padding: "8px 10px", textAlign: h === "Qty" || h === "Rate" || h === "Value" ? "right" : "left", color: "#374151", fontWeight: 600, borderBottom: "2px solid #e2e8f0" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {(billDoc.lines || []).map((l, i) => (
                <tr key={l.line_item_id || i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 10px" }}>{l.item_name}{l.description ? <div style={{ fontSize: 10, color: "#94a3b8" }}>{l.description}</div> : null}</td>
                  <td style={{ padding: "8px 10px", color: "#64748b" }}>{l.sku || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{l.purchase_line_customer_name || l.bbt_customer_name || "—"}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatQuantity(l.quantity)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatINR(l.rate)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatINR(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 24px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "flex-end", gap: 16, fontSize: 12, color: "#374151" }}>
          <span><strong>Total:</strong> {formatINR(billDoc.total || 0)}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Invoice Drawer (local only)
// ─────────────────────────────────────────────────────────────
interface InvDoc {
  invoice_id?: string; invoice_number?: string; date?: string; customer_name?: string;
  status?: string; total?: number; invoice_url?: string;
  lines?: Array<{ line_item_id: string; item_name: string; sku?: string; quantity: number; rate: number; line_total: number; description?: string }>;
}

function InvoiceDrawer({ invDoc, onClose }: { invDoc: InvDoc | null; onClose: () => void }) {
  if (!invDoc) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex" }} role="dialog" aria-modal="true">
      <div style={{ flex: 1, background: "rgba(0,0,0,0.3)", cursor: "pointer" }} onClick={onClose} />
      <div style={{ width: "min(700px, 90vw)", background: "#fff", overflowY: "auto", boxShadow: "-4px 0 24px rgba(0,0,0,0.15)" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Sales Invoice — {invDoc.invoice_number}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{invDoc.customer_name} · {formatDisplayDate(invDoc.date || "")} · {invDoc.status}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {invDoc.invoice_url && (
              <a href={invDoc.invoice_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                style={{ fontSize: 11, color: "#2563eb", border: "1px solid #bfdbfe", padding: "4px 10px", borderRadius: 6, textDecoration: "none" }}>
                ↗ Zoho
              </a>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" }} aria-label="Close">×</button>
          </div>
        </div>
        <div style={{ padding: "16px 24px", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: "#f8fafc" }}>
              {["Item", "SKU", "Qty", "Rate", "Value"].map((h) => (
                <th key={h} style={{ padding: "8px 10px", textAlign: h === "Qty" || h === "Rate" || h === "Value" ? "right" : "left", color: "#374151", fontWeight: 600, borderBottom: "2px solid #e2e8f0" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {(invDoc.lines || []).map((l, i) => (
                <tr key={l.line_item_id || i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 10px" }}>{l.item_name}{l.description ? <div style={{ fontSize: 10, color: "#94a3b8" }}>{l.description}</div> : null}</td>
                  <td style={{ padding: "8px 10px", color: "#64748b" }}>{l.sku || "—"}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatQuantity(l.quantity)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatINR(l.rate)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatINR(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 24px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "flex-end", gap: 16, fontSize: 12, color: "#374151" }}>
          <span><strong>Total:</strong> {formatINR(invDoc.total || 0)}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Stock Breakdown Drawer
// ─────────────────────────────────────────────────────────────
interface StockBreakdownDrawerProps {
  item: ItemStockDetail;
  periodLabel: string;
  financialYear: string;
  fromDate: string;
  toDate: string;
  onClose: () => void;
  onOpenBill: (billId: string) => void;
  onOpenInvoice: (invoiceId: string) => void;
  onNavigateToCustomer?: (customerId: string, customerName: string) => void;
  onOpenVendor?: (vendorName: string) => void;
  onOpenDate?: (date: string) => void;
  onExcludeItem?: (item: ItemStockDetail) => void;
}

function StockBreakdownDrawer({
  item, periodLabel, financialYear, fromDate, toDate,
  onClose, onOpenBill, onOpenInvoice, onNavigateToCustomer, onOpenVendor, onOpenDate, onExcludeItem,
}: StockBreakdownDrawerProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "customers" | "price" | "timeline">("overview");
  const [timelineOrder, setTimelineOrder] = useState<"newest" | "oldest">("newest");

  const displayTimeline = useMemo(() => {
    if (timelineOrder === "oldest") return [...item.timeline].reverse();
    return item.timeline;
  }, [item.timeline, timelineOrder]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "customers" as const, label: "Customer Movement" },
    { id: "price" as const, label: "Price History" },
    { id: "timeline" as const, label: "All Transactions" },
  ];

  const typeIcon: Record<string, string> = {
    PURCHASE: "📦", SALE: "📤", ASSEMBLY_CONSUMED: "🔩", ASSEMBLY_GENERATED: "🏭",
  };
  const typeLabel: Record<string, string> = {
    PURCHASE: "Purchase", SALE: "Sale", ASSEMBLY_CONSUMED: "Assembly Consumed", ASSEMBLY_GENERATED: "Assembly Generated",
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1500, display: "flex" }} role="dialog" aria-modal="true">
      <div style={{ flex: 1, background: "rgba(0,0,0,0.35)", cursor: "pointer" }} onClick={onClose} />
      <div style={{ width: "min(1100px, 92vw)", background: "#fff", overflowY: "auto", boxShadow: "-6px 0 32px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ padding: "24px 28px 16px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
                STOCK BREAKDOWN
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginBottom: 6, wordBreak: "break-word" }}>
                {item.itemName}
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#64748b", flexWrap: "wrap" }}>
                {item.sku && <span><strong>SKU:</strong> {item.sku}</span>}
                <span><strong>Period:</strong> {periodLabel}</span>
                <span><strong>Classification:</strong> {item.classification}</span>
                <StockStatusChip status={item.status} />
                {item.isComposite && <span style={{ background: "#f5f3ff", color: "#7c3aed", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, border: "1px solid #ddd6fe" }}>COMPOSITE</span>}
                {item.unmappedPurchaseQty > 0 && (
                  <span style={{ background: "#fffbeb", color: "#d97706", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, border: "1px solid #fde68a" }}>
                    {formatQuantity(item.unmappedPurchaseQty)} Unmapped Purchase Qty
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginLeft: 16, alignItems: "center" }}>
              {!isStockItemExcludable(item) ? (
                <span
                  style={{
                    padding: "6px 10px",
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
                  onClick={() => onExcludeItem?.(item)}
                  style={{
                    padding: "8px 14px",
                    background: "#fef2f2",
                    color: "#b91c1c",
                    border: "1px solid #fca5a5",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    whiteSpace: "nowrap",
                  }}
                  title="Exclude this item from normal reconciliation and stock"
                >
                  <span>🚫</span>
                  <span>Exclude Item</span>
                </button>
              )}
              <button
                onClick={async () => {
                  const params = new URLSearchParams({
                    reportType: "stock-breakdown", itemId: item.itemId, financialYear,
                    fromDate, toDate,
                  });
                  const res = await fetch(`/api/export/excel?${params.toString()}`);
                  if (res.ok) {
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = `Stock_${item.itemName}_${periodLabel}.xlsx`;
                    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                  }
                }}
                style={{ padding: "8px 14px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
              >
                ↓ Download
              </button>
              <button onClick={onClose} style={{ background: "none", border: "1px solid #e2e8f0", width: 36, height: 36, borderRadius: 6, cursor: "pointer", fontSize: 18, color: "#64748b" }} aria-label="Close">×</button>
            </div>
          </div>

          {/* Summary KPI cards */}
          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            {[
              { label: "Raw Purchase Qty", value: formatQuantity(item.rawPurchaseQty), color: "#1d4ed8" },
              { label: "Assembly Consumed", value: formatQuantity(item.assemblyConsumedQty), color: "#9333ea" },
              { label: "Assembly Generated", value: formatQuantity(item.assemblyGeneratedQty), color: "#7c3aed" },
              { label: "Effective Purchase Qty", value: formatQuantity(item.effectivePurchaseQty), color: "#0369a1" },
              { label: "Sales Qty", value: formatQuantity(item.salesQty), color: "#c2410c" },
              { label: "Stock / Balance Qty", value: formatQuantity(item.stockQty), color: item.stockQty < 0 ? "#dc2626" : item.stockQty === 0 ? "#6b7280" : "#16a34a" },
              { label: "Purchase Value", value: formatINR(item.purchaseTaxableValue), color: "#374151" },
              { label: "Sales Value", value: formatINR(item.salesTaxableValue), color: "#374151" },
              { label: "Approx Stock Value", value: item.approxStockValue !== null ? formatINR(item.approxStockValue) : "N/A", color: item.approxStockValue !== null ? "#059669" : "#6b7280" },
            ].map((kpi) => (
              <div key={kpi.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px", minWidth: 110 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.3px" }}>{kpi.label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: kpi.color, marginTop: 2 }}>{kpi.value}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, marginTop: 16, borderBottom: "2px solid #e2e8f0" }}>
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{ padding: "8px 18px", background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: activeTab === t.id ? 700 : 500, color: activeTab === t.id ? "#1d4ed8" : "#64748b", borderBottom: activeTab === t.id ? "2px solid #1d4ed8" : "2px solid transparent", marginBottom: -2 }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div style={{ flex: 1, padding: "20px 28px", overflowY: "auto" }}>

          {/* ── OVERVIEW TAB ── */}
          {activeTab === "overview" && (
            <div>
              {/* Purchase Breakdown */}
              <div style={{ marginBottom: 32 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  📦 Purchase Breakdown
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#64748b" }}>({item.purchaseLines.length} lines · {item.purchaseBillCount} bills)</span>
                </div>
                {item.purchaseLines.length === 0 ? (
                  <div style={{ color: "#9ca3af", fontSize: 13 }}>No purchase lines for this period.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead><tr style={{ background: "#f8fafc" }}>
                        {["Date", "Bill No.", "Vendor", "Customer", "SKU", "Qty", "Rate", "Value", "Consumed", "Available"].map((h) => (
                          <th key={h} style={{ padding: "8px 10px", textAlign: ["Qty", "Rate", "Value", "Consumed", "Available"].includes(h) ? "right" : "left", fontWeight: 600, color: "#374151", borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {item.purchaseLines.map((p) => (
                          <tr key={`${p.billId}-${p.lineItemId}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                              <button onClick={(e) => { e.stopPropagation(); onOpenDate?.(p.billDate); }} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }} title="View all transactions on this date">
                                {formatDisplayDate(p.billDate)}
                              </button>
                            </td>
                            <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                              <button onClick={(e) => { e.stopPropagation(); onOpenBill(p.billId); }} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, padding: 0, fontWeight: 600, textDecoration: "underline" }}>
                                {p.billNumber}
                              </button>
                            </td>
                            <td style={{ padding: "8px 10px" }}>
                              {p.vendorName ? (
                                <button onClick={(e) => { e.stopPropagation(); onOpenVendor?.(p.vendorName); }} style={{ background: "none", border: "none", color: "#374151", cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }}>
                                  {p.vendorName}
                                </button>
                              ) : "—"}
                            </td>
                            <td style={{ padding: "8px 10px" }}>
                              {p.customerName ? (
                                <button onClick={(e) => { e.stopPropagation(); onNavigateToCustomer?.(p.customerId, p.customerName); }} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }}>
                                  {p.customerName}
                                </button>
                              ) : <span style={{ color: "#ef4444", fontSize: 11 }}>⚠ Unmapped</span>}
                            </td>
                            <td style={{ padding: "8px 10px", color: "#64748b" }}>{p.sku || "—"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatQuantity(p.quantity)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatINR(p.rate)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatINR(p.taxableValue)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: p.assemblyConsumedQty > 0 ? "#9333ea" : "#9ca3af" }}>
                              {p.assemblyConsumedQty > 0 ? formatQuantity(p.assemblyConsumedQty) : "—"}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: p.availableQty > 0 ? "#16a34a" : "#6b7280" }}>{formatQuantity(p.availableQty)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: "#f0f4f8", fontWeight: 700 }}>
                          <td colSpan={5} style={{ padding: "8px 10px" }}>TOTAL</td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatQuantity(item.rawPurchaseQty)}</td>
                          <td style={{ padding: "8px 10px" }} />
                          <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatINR(item.purchaseTaxableValue)}</td>
                          <td style={{ padding: "8px 10px", textAlign: "right", color: "#9333ea" }}>{formatQuantity(item.assemblyConsumedQty)}</td>
                          <td style={{ padding: "8px 10px", textAlign: "right", color: "#16a34a" }}>{formatQuantity(item.effectivePurchaseQty)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* Sales Breakdown */}
              <div style={{ marginBottom: 32 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  📤 Sales Breakdown
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#64748b" }}>({item.salesLines.length} lines · {item.salesInvoiceCount} invoices)</span>
                </div>
                {item.salesLines.length === 0 ? (
                  <div style={{ color: "#9ca3af", fontSize: 13 }}>No sales lines for this period.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead><tr style={{ background: "#f8fafc" }}>
                        {["Date", "Invoice No.", "Customer", "SKU", "Qty", "Rate", "Value"].map((h) => (
                          <th key={h} style={{ padding: "8px 10px", textAlign: ["Qty", "Rate", "Value"].includes(h) ? "right" : "left", fontWeight: 600, color: "#374151", borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {item.salesLines.map((s) => (
                          <tr key={`${s.invoiceId}-${s.lineItemId}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                              <button onClick={(e) => { e.stopPropagation(); onOpenDate?.(s.invoiceDate); }} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }} title="View all transactions on this date">
                                {formatDisplayDate(s.invoiceDate)}
                              </button>
                            </td>
                            <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                              <button onClick={(e) => { e.stopPropagation(); onOpenInvoice(s.invoiceId); }} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, padding: 0, fontWeight: 600, textDecoration: "underline" }}>
                                {s.invoiceNumber}
                              </button>
                            </td>
                            <td style={{ padding: "8px 10px" }}>
                              <button onClick={(e) => { e.stopPropagation(); onNavigateToCustomer?.(s.customerId, s.customerName); }} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }}>
                                {s.customerName || "—"}
                              </button>
                            </td>
                            <td style={{ padding: "8px 10px", color: "#64748b" }}>{s.sku || "—"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatQuantity(s.quantity)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatINR(s.rate)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatINR(s.taxableValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: "#f0f4f8", fontWeight: 700 }}>
                          <td colSpan={4} style={{ padding: "8px 10px" }}>TOTAL</td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatQuantity(item.salesQty)}</td>
                          <td style={{ padding: "8px 10px" }} />
                          <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatINR(item.salesTaxableValue)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* Assembly impact details */}
              {(item.assemblyConsumedDetails.length > 0 || item.assemblyGeneratedDetails.length > 0) && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>🔩 Assembly Impact</div>
                  {item.assemblyConsumedDetails.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#9333ea", marginBottom: 6 }}>Component Consumed in Assemblies</div>
                      {item.assemblyConsumedDetails.map((a) => (
                        <div key={a.assemblyId} style={{ padding: "8px 12px", background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 6, marginBottom: 6, fontSize: 12 }}>
                          <strong>{a.assemblyNumber}</strong> · {a.assemblyDate} · {a.customerName} · For: {a.compositeItemName} · Consumed: <strong>{formatQuantity(a.generatedQty)}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                  {item.assemblyGeneratedDetails.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#7c3aed", marginBottom: 6 }}>Generated as Composite Item</div>
                      {item.assemblyGeneratedDetails.map((a) => (
                        <div key={a.assemblyId} style={{ padding: "8px 12px", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 6, marginBottom: 6, fontSize: 12 }}>
                          <strong>{a.assemblyNumber}</strong> · {a.assemblyDate} · {a.customerName} · Generated: <strong>{formatQuantity(a.generatedQty)}</strong> · Cost/Unit: {formatINR(a.costPerUnit)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── CUSTOMER MOVEMENT TAB ── */}
          {activeTab === "customers" && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 12 }}>
                👥 Customer-wise Movement
                <span style={{ fontSize: 12, fontWeight: 500, color: "#64748b", marginLeft: 8 }}>({item.customerMovements.length} customers · purchase-line customer only)</span>
              </div>
              {item.unmappedPurchaseQty > 0 && (
                <div style={{ padding: "10px 14px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, marginBottom: 12, fontSize: 12, color: "#92400e" }}>
                  ⚠ <strong>Unmapped Purchase Qty: {formatQuantity(item.unmappedPurchaseQty)}</strong> — These purchase lines have no Customer Details assigned and are excluded from customer-wise buckets.
                </div>
              )}
              {item.customerMovements.length === 0 ? (
                <div style={{ color: "#9ca3af", fontSize: 13 }}>No mapped customer movements for this period.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "#f8fafc" }}>
                      {["Customer", "Purchase Qty", "Sales Qty", "Balance Qty", "Purchase Value", "Sales Value"].map((h) => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: h === "Customer" ? "left" : "right", fontWeight: 600, color: "#374151", borderBottom: "2px solid #e2e8f0" }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {item.customerMovements.map((cm) => (
                        <tr key={cm.customerId || cm.customerName} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "8px 10px" }}>
                            <button onClick={(e) => { e.stopPropagation(); onNavigateToCustomer?.(cm.customerId, cm.customerName); }} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline", textAlign: "left" }}>
                              {cm.customerName || cm.customerId || "—"}
                            </button>
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatQuantity(cm.purchaseQty)}</td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatQuantity(cm.salesQty)}</td>
                          <td style={{ padding: "8px 10px", textAlign: "right", color: cm.balanceQty < 0 ? "#dc2626" : cm.balanceQty === 0 ? "#6b7280" : "#16a34a", fontWeight: 600 }}>
                            {formatQuantity(cm.balanceQty)}
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatINR(cm.purchaseValue)}</td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatINR(cm.salesValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── PRICE HISTORY TAB ── */}
          {activeTab === "price" && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 16 }}>💰 Price History</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
                {[
                  { label: "Latest Purchase Rate", value: item.latestPurchaseRate !== null ? formatINR(item.latestPurchaseRate) : "N/A", sub: item.priceStats.latestPurchaseEvidence ? `${item.priceStats.latestPurchaseEvidence.billNumber} · ${formatDisplayDate(item.priceStats.latestPurchaseEvidence.date)}` : undefined, color: "#1d4ed8" },
                  { label: "Lowest Purchase Rate", value: item.priceStats.lowestPurchaseRate !== null ? formatINR(item.priceStats.lowestPurchaseRate) : "N/A", color: "#16a34a" },
                  { label: "Highest Purchase Rate", value: item.priceStats.highestPurchaseRate !== null ? formatINR(item.priceStats.highestPurchaseRate) : "N/A", color: "#dc2626" },
                  { label: "Wtd Avg Purchase Rate", value: item.priceStats.weightedAvgPurchaseRate !== null ? formatINR(item.priceStats.weightedAvgPurchaseRate) : "N/A", color: "#374151" },
                  { label: "Latest Sales Rate", value: item.latestSalesRate !== null ? formatINR(item.latestSalesRate) : "N/A", sub: item.priceStats.latestSalesEvidence ? `${item.priceStats.latestSalesEvidence.invoiceNumber} · ${formatDisplayDate(item.priceStats.latestSalesEvidence.date)}` : undefined, color: "#c2410c" },
                  { label: "Lowest Sales Rate", value: item.priceStats.lowestSalesRate !== null ? formatINR(item.priceStats.lowestSalesRate) : "N/A", color: "#16a34a" },
                  { label: "Highest Sales Rate", value: item.priceStats.highestSalesRate !== null ? formatINR(item.priceStats.highestSalesRate) : "N/A", color: "#dc2626" },
                  { label: "Wtd Avg Sales Rate", value: item.priceStats.weightedAvgSalesRate !== null ? formatINR(item.priceStats.weightedAvgSalesRate) : "N/A", color: "#374151" },
                ].map((stat) => (
                  <div key={stat.label} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 16px", minWidth: 140 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>{stat.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: stat.color }}>{stat.value}</div>
                    {stat.sub && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{stat.sub}</div>}
                  </div>
                ))}
              </div>

              {/* Latest rate evidence */}
              {item.priceStats.latestPurchaseEvidence && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Latest Purchase Rate Evidence</div>
                  <div style={{ padding: "10px 14px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: 12 }}>
                    <button onClick={() => onOpenBill(item.priceStats.latestPurchaseEvidence!.billNumber)} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontWeight: 600, padding: 0, textDecoration: "underline", fontSize: 12 }}>
                      {item.priceStats.latestPurchaseEvidence.billNumber}
                    </button>{" "}
                    · {formatDisplayDate(item.priceStats.latestPurchaseEvidence.date)}
                    · Vendor: {item.priceStats.latestPurchaseEvidence.vendorName}
                    · Qty: {formatQuantity(item.priceStats.latestPurchaseEvidence.qty)}
                    · Rate: {formatINR(item.priceStats.latestPurchaseEvidence.rate)}
                  </div>
                </div>
              )}
              {item.priceStats.latestSalesEvidence && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Latest Sales Rate Evidence</div>
                  <div style={{ padding: "10px 14px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, fontSize: 12 }}>
                    <button onClick={() => onOpenInvoice(item.priceStats.latestSalesEvidence!.invoiceNumber)} style={{ background: "none", border: "none", color: "#c2410c", cursor: "pointer", fontWeight: 600, padding: 0, textDecoration: "underline", fontSize: 12 }}>
                      {item.priceStats.latestSalesEvidence.invoiceNumber}
                    </button>{" "}
                    · {formatDisplayDate(item.priceStats.latestSalesEvidence.date)}
                    · Customer: <button onClick={() => onNavigateToCustomer?.(item.priceStats.latestSalesEvidence!.customerName, item.priceStats.latestSalesEvidence!.customerName)} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: 12 }}>{item.priceStats.latestSalesEvidence.customerName}</button>
                    · Qty: {formatQuantity(item.priceStats.latestSalesEvidence.qty)}
                    · Rate: {formatINR(item.priceStats.latestSalesEvidence.rate)}
                  </div>
                </div>
              )}
              <div style={{ marginTop: 16, fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>
                ⚠ Approx Stock Value = Stock Qty × Latest Purchase Rate. Decision-support estimate only. Not accounting inventory valuation.
              </div>
            </div>
          )}

          {/* ── TIMELINE TAB ── */}
          {activeTab === "timeline" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                  📋 All Transactions — Chronological
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#64748b", marginLeft: 8 }}>({item.timeline.length} events)</span>
                </div>
                <select value={timelineOrder} onChange={(e) => setTimelineOrder(e.target.value as "newest" | "oldest")}
                  style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #d1d5db", cursor: "pointer" }}>
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                </select>
              </div>
              {displayTimeline.length === 0 ? (
                <div style={{ color: "#9ca3af", fontSize: 13 }}>No transactions for this period.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "#f8fafc" }}>
                      {["Date", "Type", "Document No.", "Party", "Qty In", "Qty Out", "Running Qty", "Rate", "Value"].map((h) => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: ["Qty In", "Qty Out", "Running Qty", "Rate", "Value"].includes(h) ? "right" : "left", fontWeight: 600, color: "#374151", borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {displayTimeline.map((ev, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f1f5f9", background: ev.type === "PURCHASE" || ev.type === "ASSEMBLY_GENERATED" ? "#f0fdf4" : ev.type === "SALE" ? "#fff7ed" : "#faf5ff" }}>
                          <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "#374151" }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); onOpenDate?.(ev.date); }}
                              style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: 12 }}
                              title="View all transactions on this date"
                            >
                              {formatDisplayDate(ev.date)}
                            </button>
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <span style={{ fontSize: 11 }}>{typeIcon[ev.type]} {typeLabel[ev.type]}</span>
                          </td>
                          <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                            {ev.type === "PURCHASE" || ev.type === "ASSEMBLY_CONSUMED"
                              ? <button onClick={(e) => { e.stopPropagation(); onOpenBill(ev.documentId); }} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }}>{ev.documentNumber}</button>
                              : <button onClick={(e) => { e.stopPropagation(); onOpenInvoice(ev.documentId); }} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }}>{ev.documentNumber}</button>
                            }
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            {ev.party ? (
                              ev.type === "PURCHASE" ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); onOpenVendor?.(ev.party); }}
                                  style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: 12 }}
                                  title="Open Vendor Detail drawer"
                                >
                                  {ev.party}
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); onNavigateToCustomer?.(ev.party, ev.party); }}
                                  style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: 12 }}
                                  title="Open Customer Details 360"
                                >
                                  {ev.party}
                                </button>
                              )
                            ) : "—"}
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right", color: ev.qtyIn > 0 ? "#16a34a" : "#9ca3af" }}>{ev.qtyIn > 0 ? `+${formatQuantity(ev.qtyIn)}` : "—"}</td>
                          <td style={{ padding: "8px 10px", textAlign: "right", color: ev.qtyOut > 0 ? "#dc2626" : "#9ca3af" }}>{ev.qtyOut > 0 ? `-${formatQuantity(ev.qtyOut)}` : "—"}</td>
                          <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: ev.runningQty < 0 ? "#dc2626" : ev.runningQty === 0 ? "#6b7280" : "#16a34a" }}>{formatQuantity(ev.runningQty)}</td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatINR(ev.rate)}</td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}>{ev.taxableValue > 0 ? formatINR(ev.taxableValue) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main: InventoryStockView
// ─────────────────────────────────────────────────────────────
export function InventoryStockView({
  financialYear: initialFy,
  onNavigateToCustomer,
}: InventoryStockViewProps) {
  const currentFy = getCurrentFinancialYear();
  const prevFy = getPreviousFinancialYear();

  // ── Filter state ──
  const [activePeriod, setActivePeriod] = useState<string>("CURRENT_FY");
  const [period, setPeriod] = useState<string>(initialFy || currentFy);
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [itemSearch, setItemSearch] = useState<string>("");
  const [classification, setClassification] = useState<string>("ALL");
  const [stockStatus, setStockStatus] = useState<string>("All");
  const [customerFilter, setCustomerFilter] = useState<string>("");
  const [vendorFilter, setVendorFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // ── Effective FY (same pattern as ActionTakenView) ──
  const effectiveFinancialYear: string = (() => {
    if (activePeriod === "PREVIOUS_FY") return prevFy;
    if (activePeriod === "ALL") return "ALL";
    if (activePeriod === "CUSTOM" && fromDate && toDate) return "CUSTOM";
    return period || currentFy;
  })();

  // ── Data state ──
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<StockSummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Drawer state ──
  const [drilldownItem, setDrilldownItem] = useState<ItemStockDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedBillDoc, setSelectedBillDoc] = useState<BillDoc | null>(null);
  const [selectedInvDoc, setSelectedInvDoc] = useState<InvDoc | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [selectedVendorName, setSelectedVendorName] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // ── Export state ──
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  // ── Exclusion state ──
  const [itemToExclude, setItemToExclude] = useState<ItemStockDetail | null>(null);

  // ── Fetch summary data ──
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (activePeriod === "CUSTOM" && fromDate && toDate) {
        params.set("fromDate", fromDate);
        params.set("toDate", toDate);
      } else {
        params.set("financialYear", effectiveFinancialYear);
      }
      if (itemSearch) params.set("itemSearch", itemSearch);
      if (classification !== "ALL") params.set("classification", classification);
      if (stockStatus !== "All") params.set("stockStatus", stockStatus);
      if (customerFilter) params.set("customerName", customerFilter);
      if (vendorFilter) params.set("vendorName", vendorFilter);
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);

      const res = await fetch(`/api/stock?${params.toString()}`);
      if (res.ok) {
        const json = await res.json() as StockSummaryResult;
        setData(json);
      } else {
        const err = await res.json();
        setError(err.error || "Failed to fetch stock data");
      }
    } catch (e) {
      setError("Network error fetching stock data");
    } finally {
      setLoading(false);
    }
  }, [activePeriod, effectiveFinancialYear, fromDate, toDate, itemSearch, classification, stockStatus, customerFilter, vendorFilter, sortBy, sortOrder]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Open bill drawer ──
  const handleOpenBill = useCallback(async (billId: string) => {
    if (!billId) return;
    try {
      setLoadingDoc(true);
      const res = await fetch(`/api/transactions?type=bill-detail&docId=${encodeURIComponent(billId)}`);
      if (res.ok) {
        const json = await res.json();
        setSelectedBillDoc(json.document || null);
      }
    } catch (e) { console.error("Failed to load bill:", e); }
    finally { setLoadingDoc(false); }
  }, []);

  // ── Open invoice drawer ──
  const handleOpenInvoice = useCallback(async (invoiceId: string) => {
    if (!invoiceId) return;
    try {
      setLoadingDoc(true);
      const res = await fetch(`/api/transactions?type=invoice-detail&docId=${encodeURIComponent(invoiceId)}`);
      if (res.ok) {
        const json = await res.json();
        setSelectedInvDoc(json.document || null);
      }
    } catch (e) { console.error("Failed to load invoice:", e); }
    finally { setLoadingDoc(false); }
  }, []);

  // ── Open item breakdown drawer ──
  const handleOpenItem = useCallback(async (item: StockSummaryRow) => {
    try {
      setLoadingDetail(true);
      const params = new URLSearchParams({ action: "detail", itemId: item.itemId });
      if (activePeriod === "CUSTOM" && fromDate && toDate) {
        params.set("fromDate", fromDate);
        params.set("toDate", toDate);
      } else {
        params.set("financialYear", effectiveFinancialYear);
      }
      const res = await fetch(`/api/stock?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setDrilldownItem(json.detail || null);
      }
    } catch (e) { console.error("Failed to load item detail:", e); }
    finally { setLoadingDetail(false); }
  }, [activePeriod, effectiveFinancialYear, fromDate, toDate]);

  // ── Handle vendor click — open local VendorDetailDrawer (no navigation away) ──
  const handleOpenVendor = useCallback((vendorName: string) => {
    setSelectedVendorName(vendorName);
  }, []);

  // ── Handle date click — open local DateDetailDrawer (no navigation away) ──
  const handleOpenDate = useCallback((date: string) => {
    setSelectedDate(date);
  }, []);

  // ── Export ──
  const [showExportModal, setShowExportModal] = useState(false);
  const handleExecuteExport = async (options: ExportOptions) => {
    try {
      setExporting(options.format || "excel");
      const params = new URLSearchParams();
      params.set("reportType", "stock");
      if (activePeriod === "CUSTOM" && fromDate && toDate) {
        params.set("fromDate", fromDate);
        params.set("toDate", toDate);
      } else {
        params.set("financialYear", effectiveFinancialYear);
      }
      if (itemSearch) params.set("itemSearch", itemSearch);
      if (classification !== "ALL") params.set("classification", classification);
      if (stockStatus !== "All") params.set("stockStatus", stockStatus);
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);
      if (options.selectedFields && options.selectedFields.length > 0) {
        params.set("selectedFields", options.selectedFields.join(","));
      }
      if (typeof options.includeTotals === "boolean") {
        params.set("includeTotals", String(options.includeTotals));
      }

      const endpoint = options.format === "excel" ? "/api/export/excel" : "/api/export/pdf";
      const res = await fetch(`${endpoint}?${params.toString()}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const disposition = res.headers.get("content-disposition");
        let filename = `Bansil_Stock_${effectiveFinancialYear}_${new Date().toISOString().slice(0, 10)}.${options.format === "excel" ? "xlsx" : "pdf"}`;
        if (disposition && disposition.includes("filename=")) {
          filename = disposition.split("filename=")[1].replace(/["']/g, "");
        }
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const errJson = await res.json().catch(() => ({}));
        alert(`Export failed: ${errJson.error || res.statusText}`);
      }
    } catch (e) {
      console.error("Export failed:", e);
      alert(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
      setShowExportModal(false);
    }
  };

  const periodLabel = data?.periodLabel ?? `FY ${effectiveFinancialYear}`;
  const kpis = data?.kpis;
  const items = data?.items ?? [];
  const totals = data?.totals;

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "24px 28px", maxWidth: 1600 }}>

      {/* ── Page Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Inventory — Stock</h1>
          <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0 0" }}>
            Item-wise stock / movement · {periodLabel} · Local SQLite · Zero Zoho API calls
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <SectionSyncControl 
            sectionKey="INVENTORY_STOCK" 
            period={{
              period: (activePeriod === "ALL" ? "ALL_FY" : activePeriod) as any,
              customFrom: activePeriod === "CUSTOM" ? fromDate : undefined,
              customTo: activePeriod === "CUSTOM" ? toDate : undefined
            }}
            onSyncComplete={fetchData} 
          />
          <button
            onClick={() => setShowExportModal(true)}
            disabled={!!exporting || loading}
            style={{
              padding: "8px 16px",
              background: "#1e3a5f",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>📊</span> Export Stock...
          </button>
        </div>
      </div>

      {/* ── KPI Cards (4x2 Responsive Grid) ── */}
      {kpis && (
        <div className="stock-kpi-grid">
          {/* Row 1 */}
          <KpiCard label="TOTAL ACTIVE ITEMS" value={kpis.totalActiveItems} icon="📦" />
          <KpiCard label="TOTAL PURCHASE QTY" value={formatQuantity(kpis.totalPurchaseQty)} icon="📥" color="#1d4ed8" />
          <KpiCard label="TOTAL SALES QTY" value={formatQuantity(kpis.totalSalesQty)} icon="📤" color="#c2410c" />
          <KpiCard label="POSITIVE STOCK ITEMS" value={kpis.positiveStockItems} icon="✅" color="#16a34a" />

          {/* Row 2 */}
          <KpiCard label="NEGATIVE STOCK ITEMS" value={kpis.negativeStockItems} icon="⚠" color={kpis.negativeStockItems > 0 ? "#dc2626" : "#6b7280"} />
          <KpiCard label="APPROX STOCK VALUE" value={`₹${formatINR(kpis.approxTotalStockValue)}`} icon="💰" color="#059669" sub="Latest purchase rate basis" isMonetary />
          <KpiCard label="UNMAPPED PURCHASE QTY" value={formatQuantity(kpis.unmappedPurchaseQty)} icon="⚠" color={kpis.unmappedPurchaseQty > 0 ? "#d97706" : "#6b7280"} />
          <KpiCard label="COMPOSITE ITEMS" value={kpis.compositeItems} icon="🔩" color="#7c3aed" />
        </div>
      )}

      {/* ── Filters ── */}
      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          {/* Period */}
          <div style={{ minWidth: 160 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>PERIOD</div>
            <select value={activePeriod} onChange={(e) => {
              const v = e.target.value;
              setActivePeriod(v);
              if (v === "CURRENT_FY") setPeriod(currentFy);
              else if (v === "PREVIOUS_FY") setPeriod(prevFy);
            }} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}>
              <option value="CURRENT_FY">Current FY ({currentFy})</option>
              <option value="PREVIOUS_FY">Previous FY ({prevFy})</option>
              <option value="ALL">All Periods</option>
              <option value="CUSTOM">Custom Date Range</option>
            </select>
          </div>
          {activePeriod === "CUSTOM" && (
            <>
              <div style={{ minWidth: 130 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>FROM</div>
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }} />
              </div>
              <div style={{ minWidth: 130 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>TO</div>
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }} />
              </div>
            </>
          )}

          {/* Item Search */}
          <div style={{ minWidth: 200, flex: "1 1 200px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>ITEM SEARCH</div>
            <input type="text" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Name · SKU · Code" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }} />
          </div>

          {/* Classification */}
          <div style={{ minWidth: 130 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>CLASSIFICATION</div>
            <select value={classification} onChange={(e) => setClassification(e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}>
              <option value="ALL">All</option>
              <option value="Material">Material</option>
              <option value="Service">Service</option>
            </select>
          </div>

          {/* Stock Status */}
          <div style={{ minWidth: 145 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>STOCK STATUS</div>
            <select value={stockStatus} onChange={(e) => setStockStatus(e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}>
              <option value="All">All</option>
              <option value="IN_STOCK">In Stock</option>
              <option value="ZERO_STOCK">Zero Stock</option>
              <option value="NEGATIVE">Negative Stock</option>
              <option value="PURCHASE_ONLY">Purchase Only</option>
              <option value="SALES_ONLY">Sales Only</option>
              <option value="COMPOSITE">Composite</option>
            </select>
          </div>

          {/* Customer */}
          <div style={{ minWidth: 160, flex: "1 1 160px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>CUSTOMER</div>
            <input type="text" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} placeholder="Filter by customer" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }} />
          </div>

          {/* Vendor */}
          <div style={{ minWidth: 150, flex: "1 1 150px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>VENDOR</div>
            <input type="text" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} placeholder="Filter by vendor" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }} />
          </div>

          {/* Sort */}
          <div style={{ minWidth: 140 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>SORT</div>
            <div style={{ display: "flex", gap: 4 }}>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ flex: 1, padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}>
                <option value="name">Item A–Z</option>
                <option value="stockQty">Stock Qty</option>
                <option value="purchaseQty">Purchase Qty</option>
                <option value="salesQty">Sales Qty</option>
                <option value="stockValue">Stock Value</option>
                <option value="lastPurchase">Last Purchase</option>
                <option value="lastSales">Last Sales</option>
              </select>
              <button onClick={() => setSortOrder((o) => o === "asc" ? "desc" : "asc")}
                style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 12 }}
                title={sortOrder === "asc" ? "Ascending" : "Descending"}>
                {sortOrder === "asc" ? "↑" : "↓"}
              </button>
            </div>
          </div>

          {/* Reset */}
          <button onClick={() => { setItemSearch(""); setClassification("ALL"); setStockStatus("All"); setCustomerFilter(""); setVendorFilter(""); setSortBy("name"); setSortOrder("asc"); }}
            style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 12, color: "#374151", alignSelf: "flex-end" }}>
            Reset
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Stock Table ── */}
      <div className="stock-table-viewport">
        <table className="stock-table">
          <thead>
            <tr>
              {([
                { label: "Sr.", align: "left" as const, width: 45, minWidth: 40 },
                { label: "Item Name", align: "left" as const, width: 260, minWidth: 240, maxWidth: 280 },
                { label: "SKU / Code", align: "left" as const, width: 90, minWidth: 80 },
                { label: "Purchase Qty", align: "right" as const, width: 95, minWidth: 85 },
                { label: "Sales Qty", align: "right" as const, width: 90, minWidth: 80 },
                { label: "Stock Qty", align: "right" as const, width: 95, minWidth: 85 },
                { label: "Latest Purchase Rate", align: "right" as const, width: 135, minWidth: 120 },
                { label: "Latest Sales Rate", align: "right" as const, width: 130, minWidth: 115 },
                { label: "Approx Stock Value", align: "right" as const, width: 135, minWidth: 120 },
                { label: "Customers", align: "right" as const, width: 68, minWidth: 60 },
                { label: "Bills", align: "right" as const, width: 55, minWidth: 50 },
                { label: "Invoices", align: "right" as const, width: 62, minWidth: 55 },
                { label: "Last Purchase", align: "left" as const, width: 95, minWidth: 85 },
                { label: "Last Sale", align: "left" as const, width: 95, minWidth: 85 },
                { label: "Status", align: "left" as const, width: 105, minWidth: 95 },
              ] as const).map((h) => (
                <th
                  key={h.label}
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 10,
                    backgroundColor: "#1e3a5f",
                    boxShadow: "0 2px 4px rgba(0, 0, 0, 0.12)",
                    height: 42,
                    padding: "0 8px",
                    verticalAlign: "middle",
                    textAlign: h.align,
                    color: "#e2e8f0",
                    fontWeight: 600,
                    fontSize: 11,
                    whiteSpace: "nowrap",
                    letterSpacing: "0.2px",
                    width: h.width,
                    minWidth: h.minWidth,
                    maxWidth: "maxWidth" in h ? (h as { maxWidth?: number }).maxWidth : undefined,
                  }}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    {Array.from({ length: 15 }).map((__, j) => (
                      <td key={j} style={{ padding: "10px 8px" }}>
                        <div style={{ height: 12, background: "#e5e7eb", borderRadius: 4, width: `${50 + ((i * 17 + j * 23) % 40)}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={15} style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>
                    No items found for the selected filters.
                  </td>
                </tr>
              ) : (
                items.map((item, idx) => (
                  <tr
                    key={item.itemId}
                    onClick={() => handleOpenItem(item)}
                    style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer", transition: "background 0.1s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f7ff")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleOpenItem(item); }}
                    aria-label={`Open stock breakdown for ${item.itemName}`}
                  >
                    <td style={{ padding: "10px 8px", color: "#6b7280", width: 45, whiteSpace: "nowrap" }}>{idx + 1}</td>
                    <td style={{ padding: "8px 10px", width: 260, minWidth: 240, maxWidth: 280, textAlign: "left", verticalAlign: "middle" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%" }}>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenItem(item);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              handleOpenItem(item);
                            }
                          }}
                          title={item.itemName}
                          className="stock-item-link"
                          aria-label={`Open stock details for ${item.itemName}`}
                          style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            wordBreak: "normal",
                            overflowWrap: "anywhere",
                            color: "#0284c7",
                            fontWeight: 600,
                            lineHeight: 1.35,
                            cursor: "pointer",
                            textDecoration: "none",
                            textAlign: "left",
                            flex: 1,
                          }}
                        >
                          {item.itemName}
                        </span>
                        {item.isComposite && (
                          <span style={{ flexShrink: 0, fontSize: 11, color: "#7c3aed" }} title="Composite Assembly">🔩</span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "10px 8px", color: "#64748b", fontSize: 11, width: 90, minWidth: 80, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 100 }} title={item.sku || undefined}>
                      {item.sku || "—"}
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap", width: 95, minWidth: 85 }}>
                      {formatQuantity(item.effectivePurchaseQty)}
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap", width: 90, minWidth: 80 }}>
                      {formatQuantity(item.salesQty)}
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", width: 95, minWidth: 85, color: item.stockQty < 0 ? "#dc2626" : item.stockQty === 0 ? "#6b7280" : "#16a34a" }}>
                      {item.stockQty < 0 && "⚠ "}{formatQuantity(item.stockQty)}
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap", fontWeight: 500, color: "#1e293b", width: 135, minWidth: 120 }}>
                      {item.latestPurchaseRate !== null ? `₹${formatINR(item.latestPurchaseRate)}` : "—"}
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap", fontWeight: 500, color: "#1e293b", width: 130, minWidth: 115 }}>
                      {item.latestSalesRate !== null ? `₹${formatINR(item.latestSalesRate)}` : "—"}
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap", width: 135, minWidth: 120 }}>
                      {item.approxStockValue !== null ? `₹${formatINR(item.approxStockValue)}` : <span style={{ color: "#9ca3af", fontSize: 11 }}>N/A</span>}
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right", color: "#64748b", whiteSpace: "nowrap", width: 68, minWidth: 60 }}>
                      {item.customerCount}
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right", color: "#64748b", whiteSpace: "nowrap", width: 55, minWidth: 50 }}>
                      {item.purchaseBillCount}
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right", color: "#64748b", whiteSpace: "nowrap", width: 62, minWidth: 55 }}>
                      {item.salesInvoiceCount}
                    </td>
                    <td style={{ padding: "10px 8px", whiteSpace: "nowrap", color: "#374151", width: 95, minWidth: 85 }}>
                      {item.lastPurchaseDate ? formatDisplayDate(item.lastPurchaseDate) : "—"}
                    </td>
                    <td style={{ padding: "10px 8px", whiteSpace: "nowrap", color: "#374151", width: 95, minWidth: 85 }}>
                      {item.lastSalesDate ? formatDisplayDate(item.lastSalesDate) : "—"}
                    </td>
                    <td style={{ padding: "10px 8px", whiteSpace: "nowrap", width: 105, minWidth: 95 }} onClick={(e) => e.stopPropagation()}>
                      <StockStatusChip status={item.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>

            {/* Grand Total Footer */}
            {!loading && totals && items.length > 0 && (
              <tfoot>
                <tr style={{ background: "#0f172a", color: "#e2e8f0", fontWeight: 700 }}>
                  <td colSpan={3} style={{ padding: "11px 10px", fontSize: 12, color: "#94a3b8" }}>
                    GRAND TOTAL ({items.length} items)
                  </td>
                  <td style={{ padding: "11px 8px", textAlign: "right", whiteSpace: "nowrap" }}>{formatQuantity(totals.totalPurchaseQty)}</td>
                  <td style={{ padding: "11px 8px", textAlign: "right", whiteSpace: "nowrap" }}>{formatQuantity(totals.totalSalesQty)}</td>
                  <td style={{ padding: "11px 8px", textAlign: "right", whiteSpace: "nowrap", color: totals.totalStockQty < 0 ? "#fca5a5" : "#86efac" }}>
                    {formatQuantity(totals.totalStockQty)}
                  </td>
                  <td colSpan={2} style={{ padding: "11px 8px", textAlign: "right", color: "#94a3b8", fontSize: 11 }}>
                    Approx Stock Value:
                  </td>
                  <td style={{ padding: "11px 8px", textAlign: "right", whiteSpace: "nowrap", color: "#38bdf8" }}>
                    ₹{formatINR(totals.totalApproxStockValue)}
                  </td>
                  <td colSpan={6} />
                </tr>
              </tfoot>
            )}
        </table>
      </div>

      {/* Approx value disclaimer */}
      {!loading && items.length > 0 && (
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 10, fontStyle: "italic" }}>
          * Approx Stock Value = Stock Qty × Latest Purchase Rate. Decision-support estimate only. Not accounting inventory valuation. | Data Source: Local SQLite only.
        </div>
      )}

      {/* Loading overlay */}
      {loadingDetail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.15)", zIndex: 1499, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "24px 32px", fontSize: 14, fontWeight: 600, color: "#374151" }}>
            ⏳ Loading item breakdown...
          </div>
        </div>
      )}

      {/* Stock Breakdown Drawer */}
      {drilldownItem && !loadingDetail && (
        <StockBreakdownDrawer
          item={drilldownItem}
          periodLabel={periodLabel}
          financialYear={effectiveFinancialYear}
          fromDate={fromDate}
          toDate={toDate}
          onClose={() => setDrilldownItem(null)}
          onOpenBill={handleOpenBill}
          onOpenInvoice={handleOpenInvoice}
          onNavigateToCustomer={onNavigateToCustomer}
          onOpenVendor={handleOpenVendor}
          onOpenDate={handleOpenDate}
          onExcludeItem={(it) => setItemToExclude(it)}
        />
      )}

      {/* Bill Document Drawer */}
      {selectedBillDoc && (
        <BillDrawer billDoc={selectedBillDoc} onClose={() => setSelectedBillDoc(null)} />
      )}

      {/* Invoice Document Drawer */}
      {selectedInvDoc && (
        <InvoiceDrawer invDoc={selectedInvDoc} onClose={() => setSelectedInvDoc(null)} />
      )}

      {/* Vendor Detail Drawer */}
      {selectedVendorName && (
        <VendorDetailDrawer
          vendorName={selectedVendorName}
          financialYear={effectiveFinancialYear}
          onClose={() => setSelectedVendorName(null)}
          onOpenBill={handleOpenBill}
          onOpenItem={(id, name) => {
            const row = (data?.items || []).find((it) => it.itemId === id || it.itemName === name);
            if (row) handleOpenItem(row);
          }}
          onOpenDate={handleOpenDate}
          onNavigateToCustomer={onNavigateToCustomer}
        />
      )}

      {/* Date Detail Drawer */}
      {selectedDate && (
        <DateDetailDrawer
          date={selectedDate}
          itemId={drilldownItem?.itemId}
          itemName={drilldownItem?.itemName}
          onClose={() => setSelectedDate(null)}
          onOpenBill={handleOpenBill}
          onOpenInvoice={handleOpenInvoice}
          onOpenVendor={handleOpenVendor}
          onOpenItem={(id, name) => {
            const row = (data?.items || []).find((it) => it.itemId === id || it.itemName === name);
            if (row) handleOpenItem(row);
          }}
          onNavigateToCustomer={onNavigateToCustomer}
        />
      )}

      {/* Exclusion Dialog */}
      {itemToExclude && (
        <ExclusionDialog
          item={{
            itemId: itemToExclude.itemId,
            itemName: itemToExclude.itemName,
            sku: itemToExclude.sku || undefined,
            status: itemToExclude.status,
            stockStatus: itemToExclude.status,
            purchaseQty: itemToExclude.effectivePurchaseQty,
            salesQty: itemToExclude.salesQty,
            stockQty: itemToExclude.stockQty,
            balanceQty: itemToExclude.stockQty,
            approxStockValue: itemToExclude.approxStockValue,
          }}
          financialYear={effectiveFinancialYear}
          onClose={() => setItemToExclude(null)}
          onSuccess={() => {
            setItemToExclude(null);
            setDrilldownItem(null);
            fetchData();
          }}
        />
      )}

      {/* Dynamic Export Field Selector Modal */}
      <ExportFieldSelector
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        reportType="stock"
        totalRecords={items.length}
        onExport={handleExecuteExport}
      />
    </div>
  );
}

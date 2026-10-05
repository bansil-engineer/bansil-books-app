"use client";

// ============================================================
// Bansil Books Analytics — Local Document Drawers (Bill & Invoice)
// Strictly Read-Only · Zero Zoho Mutation · Local SQLite First
// ============================================================

import React, { useState, useEffect } from "react";
import { formatINR, formatQuantity, formatDisplayDate } from "@/app/lib/date-utils";

export interface LocalBillDrawerProps {
  billId: string;
  onClose: () => void;
  onOpenVendor?: (vendorName: string, vendorId?: string) => void;
  onOpenDate?: (date: string) => void;
  onOpenItem?: (itemId: string, itemName?: string) => void;
  onNavigateToCustomer?: (customerId: string, customerName?: string) => void;
}

export interface LocalInvoiceDrawerProps {
  invoiceId: string;
  onClose: () => void;
  onOpenDate?: (date: string) => void;
  onOpenItem?: (itemId: string, itemName?: string) => void;
  onNavigateToCustomer?: (customerId: string, customerName?: string) => void;
}

interface BillData {
  bill_id: string;
  bill_number: string;
  date: string;
  due_date?: string;
  vendor_id: string;
  vendor_name: string;
  grand_total: number;
  balance: number;
  status: string;
  bill_url?: string;
  taxableTotal: number;
  taxAmount: number;
  lines: Array<{
    line_item_id: string;
    item_id: string;
    item_name: string;
    sku?: string;
    quantity: number;
    rate: number;
    line_total: number;
    customer_details?: string;
    bbt_customer_id?: string;
    bbt_customer_name?: string;
    purchase_line_customer_name?: string;
    description?: string;
    is_excluded?: boolean;
  }>;
}

interface InvoiceData {
  invoice_id: string;
  invoice_number: string;
  date: string;
  due_date?: string;
  customer_id: string;
  customer_name: string;
  grand_total: number;
  balance: number;
  status: string;
  invoice_url?: string;
  taxableTotal: number;
  taxAmount: number;
  lines: Array<{
    line_item_id: string;
    item_id: string;
    item_name: string;
    sku?: string;
    quantity: number;
    rate: number;
    line_total: number;
    description?: string;
  }>;
}

export function LocalBillDrawer({
  billId,
  onClose,
  onOpenVendor,
  onOpenDate,
  onOpenItem,
  onNavigateToCustomer,
}: LocalBillDrawerProps) {
  const [data, setData] = useState<BillData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!billId) return;
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/transactions?type=bill-detail&docId=${encodeURIComponent(billId)}`);
        if (!res.ok) {
          throw new Error("Bill not found");
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json.document);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Failed to load bill details from local SQLite.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [billId]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2250,
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
          width: "min(880px, 92vw)",
          background: "#ffffff",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-8px 0 32px rgba(0, 0, 0, 0.2)",
          position: "relative",
          zIndex: 2251,
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
              <span style={{ fontSize: 20 }}>🧾</span>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0 }}>
                Purchase Bill — {data?.bill_number || billId}
              </h2>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "#fef3c7",
                  color: "#92400e",
                }}
              >
                BILL
              </span>
            </div>
            {data && (
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                <span>
                  Vendor:{" "}
                  <span
                    onClick={(e) => { e.stopPropagation(); onOpenVendor?.(data.vendor_name, data.vendor_id); }}
                    style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                    title="Open Vendor Detail drawer"
                  >
                    {data.vendor_name}
                  </span>
                </span>
                <span>·</span>
                <span>
                  Date:{" "}
                  <span
                    onClick={(e) => { e.stopPropagation(); onOpenDate?.(data.date); }}
                    style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                    title="View transactions on this date"
                  >
                    {formatDisplayDate(data.date)}
                  </span>
                </span>
                <span>·</span>
                <span>Status: <strong>{data.status}</strong></span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {data?.bill_url && (
              <a
                href={data.bill_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  fontSize: 11,
                  color: "#2563eb",
                  border: "1px solid #bfdbfe",
                  padding: "4px 10px",
                  borderRadius: 6,
                  textDecoration: "none",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
                title="Open official record in Zoho Books"
              >
                <span>Zoho</span>
                <span>↗</span>
              </a>
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

        {/* Summary Metric Strip */}
        {data && (
          <div
            style={{
              padding: "12px 24px",
              background: "#ffffff",
              borderBottom: "1px solid #e2e8f0",
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
            }}
          >
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>LINE ITEMS</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{data.lines?.length || 0}</div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>TAXABLE VALUE</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>₹{formatINR(data.taxableTotal || 0)}</div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>GRAND TOTAL</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>₹{formatINR(data.grand_total || 0)}</div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>BALANCE</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: data.balance > 0 ? "#d97706" : "#16a34a", marginTop: 2 }}>
                ₹{formatINR(data.balance || 0)}
              </div>
            </div>
          </div>
        )}

        {/* Lines Table */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {loading && (
            <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
              Loading bill details...
            </div>
          )}
          {error && (
            <div style={{ padding: 16, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>
              {error}
            </div>
          )}
          {!loading && !error && data && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>
                Eligible Line Items ({data.lines?.length || 0})
              </div>
              <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ width: 35, textAlign: "center" }}>#</th>
                    <th>Item Name & SKU</th>
                    <th>Customer Details</th>
                    <th style={{ textAlign: "right" }}>Qty</th>
                    <th style={{ textAlign: "right" }}>Rate</th>
                    <th style={{ textAlign: "right" }}>Taxable Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.lines || []).map((line, idx) => (
                    <tr key={line.line_item_id || idx}>
                      <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                      <td>
                        <span
                          onClick={(e) => { e.stopPropagation(); onOpenItem?.(line.item_id, line.item_name); }}
                          style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                          title="Open Item Detail drawer"
                        >
                          {line.item_name}
                        </span>
                        {line.sku && <div style={{ fontSize: 10.5, color: "#64748b" }}>SKU: {line.sku}</div>}
                        {line.description && <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 2 }}>{line.description}</div>}
                      </td>
                      <td>
                        {line.customer_details ? (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              onNavigateToCustomer?.(line.bbt_customer_id || "", line.customer_details);
                            }}
                            style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 500 }}
                            title="Open Customer Details 360"
                          >
                            {line.customer_details}
                          </span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{formatQuantity(line.quantity)}</td>
                      <td style={{ textAlign: "right" }}>₹{formatINR(line.rate)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>₹{formatINR(line.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals Footer */}
              <div
                style={{
                  marginTop: 20,
                  padding: 14,
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
                <div>Pre-GST Taxable Subtotal: <strong>₹{formatINR(data.taxableTotal || 0)}</strong></div>
                {data.taxAmount > 0 && (
                  <div>GST Tax Amount: <strong>₹{formatINR(data.taxAmount)}</strong></div>
                )}
                <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", borderTop: "1px solid #cbd5e1", paddingTop: 6, marginTop: 4 }}>
                  Grand Total: ₹{formatINR(data.grand_total || 0)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function LocalInvoiceDrawer({
  invoiceId,
  onClose,
  onOpenDate,
  onOpenItem,
  onNavigateToCustomer,
}: LocalInvoiceDrawerProps) {
  const [data, setData] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!invoiceId) return;
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/transactions?type=invoice-detail&docId=${encodeURIComponent(invoiceId)}`);
        if (!res.ok) {
          throw new Error("Invoice not found");
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json.document);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Failed to load invoice details from local SQLite.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2250,
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
          width: "min(880px, 92vw)",
          background: "#ffffff",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-8px 0 32px rgba(0, 0, 0, 0.2)",
          position: "relative",
          zIndex: 2251,
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
              <span style={{ fontSize: 20 }}>📑</span>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0 }}>
                Sales Invoice — {data?.invoice_number || invoiceId}
              </h2>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "#dbeafe",
                  color: "#1e40af",
                }}
              >
                INVOICE
              </span>
            </div>
            {data && (
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                <span>
                  Customer:{" "}
                  <span
                    onClick={(e) => { e.stopPropagation(); onNavigateToCustomer?.(data.customer_id, data.customer_name); }}
                    style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                    title="Open Customer Details 360"
                  >
                    {data.customer_name}
                  </span>
                </span>
                <span>·</span>
                <span>
                  Date:{" "}
                  <span
                    onClick={(e) => { e.stopPropagation(); onOpenDate?.(data.date); }}
                    style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline" }}
                    title="View transactions on this date"
                  >
                    {formatDisplayDate(data.date)}
                  </span>
                </span>
                <span>·</span>
                <span>Status: <strong>{data.status}</strong></span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {data?.invoice_url && (
              <a
                href={data.invoice_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  fontSize: 11,
                  color: "#2563eb",
                  border: "1px solid #bfdbfe",
                  padding: "4px 10px",
                  borderRadius: 6,
                  textDecoration: "none",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
                title="Open official record in Zoho Books"
              >
                <span>Zoho</span>
                <span>↗</span>
              </a>
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

        {/* Summary Metric Strip */}
        {data && (
          <div
            style={{
              padding: "12px 24px",
              background: "#ffffff",
              borderBottom: "1px solid #e2e8f0",
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
            }}
          >
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>LINE ITEMS</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{data.lines?.length || 0}</div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>TAXABLE VALUE</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>₹{formatINR(data.taxableTotal || 0)}</div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>GRAND TOTAL</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>₹{formatINR(data.grand_total || 0)}</div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>BALANCE</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: data.balance > 0 ? "#d97706" : "#16a34a", marginTop: 2 }}>
                ₹{formatINR(data.balance || 0)}
              </div>
            </div>
          </div>
        )}

        {/* Lines Table */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {loading && (
            <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
              Loading invoice details...
            </div>
          )}
          {error && (
            <div style={{ padding: 16, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>
              {error}
            </div>
          )}
          {!loading && !error && data && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>
                Invoice Line Items ({data.lines?.length || 0})
              </div>
              <table className="data-table" style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ width: 35, textAlign: "center" }}>#</th>
                    <th>Item Name & SKU</th>
                    <th style={{ textAlign: "right" }}>Qty</th>
                    <th style={{ textAlign: "right" }}>Rate</th>
                    <th style={{ textAlign: "right" }}>Taxable Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.lines || []).map((line, idx) => (
                    <tr key={line.line_item_id || idx}>
                      <td style={{ textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                      <td>
                        <span
                          onClick={(e) => { e.stopPropagation(); onOpenItem?.(line.item_id, line.item_name); }}
                          style={{ color: "#0284c7", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                          title="Open Item Detail drawer"
                        >
                          {line.item_name}
                        </span>
                        {line.sku && <div style={{ fontSize: 10.5, color: "#64748b" }}>SKU: {line.sku}</div>}
                        {line.description && <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 2 }}>{line.description}</div>}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{formatQuantity(line.quantity)}</td>
                      <td style={{ textAlign: "right" }}>₹{formatINR(line.rate)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>₹{formatINR(line.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals Footer */}
              <div
                style={{
                  marginTop: 20,
                  padding: 14,
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
                <div>Pre-GST Taxable Subtotal: <strong>₹{formatINR(data.taxableTotal || 0)}</strong></div>
                {data.taxAmount > 0 && (
                  <div>GST Tax Amount: <strong>₹{formatINR(data.taxAmount)}</strong></div>
                )}
                <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", borderTop: "1px solid #cbd5e1", paddingTop: 6, marginTop: 4 }}>
                  Grand Total: ₹{formatINR(data.grand_total || 0)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function LocalDocumentDrawer({
  type,
  docId,
  onClose,
}: {
  type: "bill" | "invoice";
  docId: string;
  onClose: () => void;
}) {
  if (type === "bill") {
    return <LocalBillDrawer billId={docId} onClose={onClose} />;
  }
  return <LocalInvoiceDrawer invoiceId={docId} onClose={onClose} />;
}


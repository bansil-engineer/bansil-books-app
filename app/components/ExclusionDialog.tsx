"use client";

import React, { useState } from "react";
import type { ItemTransactionBreakdown } from "@/app/types/reconciliation";
import { formatINR, formatQuantity } from "@/app/lib/date-utils";

interface ExclusionDialogProps {
  item: ItemTransactionBreakdown | any;
  financialYear: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ExclusionDialog({ item, financialYear, onClose, onSuccess }: ExclusionDialogProps) {
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [approvedBy, setApprovedBy] = useState("Owner");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason || !reason.trim()) {
      setError("Please select a reason for exclusion.");
      return;
    }
    if (reason === "Other" && !notes.trim()) {
      setError("Remarks are required when reason is 'Other'");
      return;
    }
    if (!approvedBy.trim()) {
      setError("Approver name is required");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/exclusions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerId: null, // Global item-level rule
          customerName: null,
          itemId: item.itemId || item.item_id || null,
          itemName: item.itemName || item.item_name || "",
          sku: item.sku || null,
          financialYear: null, // Global across all periods
          reason,
          notes: notes.trim() || null,
          approvedBy: approvedBy.trim() || "Owner",
          stockStatus: item.stockStatus || item.status || null,
          stockQty: item.stockQty !== undefined ? item.stockQty : null,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Failed to create exclusion rule");
      }

      onSuccess();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      setSubmitting(false);
    }
  };

  const billNo = item.billNumber || item.bill_number;
  const vendorName = item.vendorName || item.vendor_name;
  const custName = item.customerName || item.customer_name || item.customer_details;
  const taxableVal = item.taxableValue ?? item.taxable_value ?? item.line_total ?? null;
  const qty = item.totalPurchaseQty ?? item.quantity ?? 0;

  return (
    <div
      className="mismatch-modal-overlay"
      onClick={onClose}
      style={{
        zIndex: 10000,
        background: "rgba(15, 23, 42, 0.6)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "fixed",
        inset: 0,
      }}
    >
      <div
        className="mismatch-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "95%",
          background: "#fff",
          borderRadius: 8,
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#f8fafc",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
              Exclude from Reconciliation
            </h3>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              Exclude this item from all normal reconciliation and analytics?
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "none",
              fontSize: 18,
              cursor: "pointer",
              color: "#64748b",
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "18px 20px", flex: 1, overflowY: "auto" }}>
            {/* Item Details Summary Card */}
            <div
              style={{
                marginBottom: 16,
                padding: "12px 14px",
                background: "#f8fafc",
                borderRadius: 6,
                border: "1px solid #e2e8f0",
                fontSize: 12.5,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {billNo && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#64748b" }}>Bill No:</span>
                  <strong style={{ color: "#0f172a" }}>{billNo}</strong>
                </div>
              )}
              {vendorName && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#64748b" }}>Vendor:</span>
                  <strong style={{ color: "#0f172a" }}>{vendorName}</strong>
                </div>
              )}
              {custName && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#64748b" }}>Customer:</span>
                  <strong style={{ color: "#0f172a" }}>{custName}</strong>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#64748b" }}>Item Name:</span>
                <strong style={{ color: "#0f172a" }}>{item.itemName || item.item_name}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#64748b" }}>Item ID:</span>
                <code>{item.itemId || item.item_id || "—"}</code>
              </div>
              {(item.sku || item.item_sku) && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#64748b" }}>SKU:</span>
                  <code>{item.sku || item.item_sku}</code>
                </div>
              )}
              {(item.stockStatus || item.status) && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#64748b" }}>Current Stock Status:</span>
                  <span style={{
                    fontWeight: 600,
                    color: (item.stockStatus || item.status) === "NEGATIVE" ? "#dc2626" : (item.stockStatus || item.status) === "IN_STOCK" ? "#16a34a" : "#1e40af",
                    background: "#f1f5f9",
                    padding: "1px 6px",
                    borderRadius: 4,
                    fontSize: 11
                  }}>
                    {item.stockStatus || item.status}
                  </span>
                </div>
              )}
              {item.stockQty !== undefined ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, borderTop: "1px dashed #cbd5e1", paddingTop: 6, marginTop: 2 }}>
                  <div>
                    <div style={{ fontSize: 10.5, color: "#64748b", textTransform: "uppercase" }}>Purchase Qty</div>
                    <div style={{ fontWeight: 700, color: "#16a34a" }}>{formatQuantity(item.purchaseQty ?? item.effectivePurchaseQty ?? 0)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, color: "#64748b", textTransform: "uppercase" }}>Sales Qty</div>
                    <div style={{ fontWeight: 700, color: "#2563eb" }}>{formatQuantity(item.salesQty ?? 0)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, color: "#64748b", textTransform: "uppercase" }}>Stock Qty</div>
                    <div style={{ fontWeight: 700, color: item.stockQty < 0 ? "#dc2626" : item.stockQty === 0 ? "#64748b" : "#15803d" }}>
                      {formatQuantity(item.stockQty)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, color: "#64748b", textTransform: "uppercase" }}>Approx Value</div>
                    <div style={{ fontWeight: 700, color: "#0f172a" }}>
                      {item.approxStockValue !== undefined && item.approxStockValue !== null ? `₹${formatINR(item.approxStockValue)}` : "—"}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, borderTop: "1px dashed #cbd5e1", paddingTop: 6, marginTop: 2 }}>
                  <div>
                    <div style={{ fontSize: 10.5, color: "#64748b", textTransform: "uppercase" }}>Quantity</div>
                    <div style={{ fontWeight: 700, color: "#16a34a" }}>{formatQuantity(qty)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, color: "#64748b", textTransform: "uppercase" }}>
                      {taxableVal !== null ? "Taxable Value" : "Sales Qty"}
                    </div>
                    <div style={{ fontWeight: 700, color: "#2563eb" }}>
                      {taxableVal !== null ? `₹${formatINR(taxableVal)}` : formatQuantity(item.totalSalesQty ?? 0)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, color: "#64748b", textTransform: "uppercase" }}>
                      {item.balanceQty !== undefined ? "Balance" : "Rate"}
                    </div>
                    <div style={{ fontWeight: 700, color: item.balanceQty !== undefined ? (item.balanceQty === 0 ? "#16a34a" : item.balanceQty > 0 ? "#0284c7" : "#dc2626") : "#475569" }}>
                      {item.balanceQty !== undefined
                        ? formatQuantity(item.balanceQty)
                        : (item.rate ? `₹${formatINR(Number(item.rate))}` : "—")}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div
                style={{
                  color: "#b91c1c",
                  marginBottom: 14,
                  fontSize: 12.5,
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  padding: "8px 12px",
                  borderRadius: 4,
                  fontWeight: 500,
                }}
              >
                {error}
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600, color: "#334155" }}>
                Reason for Exclusion <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <select
                className="select-input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 4,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  fontWeight: reason ? 600 : 400,
                }}
              >
                <option value="">— Select a reason (Required) —</option>
                <option value="Consumable">Consumable</option>
                <option value="Service / Non-material">Service / Non-material</option>
                <option value="Transportation">Transportation</option>
                <option value="Tool / Equipment">Tool / Equipment</option>
                <option value="Office / Admin">Office / Admin</option>
                <option value="Non-reconciliation item">Non-reconciliation item</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600, color: "#334155" }}>
                Approved By <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input
                type="text"
                className="select-input"
                value={approvedBy}
                onChange={(e) => setApprovedBy(e.target.value)}
                placeholder="e.g. Owner / Finance Manager"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 4,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                }}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600, color: "#334155" }}>
                Remarks {reason === "Other" ? <span style={{ color: "#dc2626" }}>*</span> : <span style={{ color: "#64748b", fontWeight: 400 }}>(Optional)</span>}
              </label>
              <textarea
                className="select-input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Provide justification or context for this exclusion..."
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 4,
                  border: "1px solid #cbd5e1",
                  fontSize: 12.5,
                  resize: "vertical",
                }}
              />
            </div>

            <div
              style={{
                padding: "8px 12px",
                background: "#fef3c7",
                border: "1px solid #fde68a",
                borderRadius: 4,
                color: "#92400e",
                fontSize: 11.5,
                lineHeight: 1.4,
              }}
            >
              ℹ️ <strong>Global Item Scope:</strong> This exclusion will immediately remove this item across normal reconciliation reports, exports, and customer analyses. It can be reactivated anytime from <em>Reconciliation &gt; Excluded Items</em>.
            </div>
          </div>

          <div
            style={{
              padding: "12px 20px",
              borderTop: "1px solid #e2e8f0",
              background: "#f8fafc",
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
              style={{ padding: "6px 14px", fontSize: 12.5 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              style={{
                padding: "6px 16px",
                fontSize: 12.5,
                fontWeight: 600,
                background: "#b91c1c",
                borderColor: "#b91c1c",
                color: "#fff",
              }}
            >
              {submitting ? "Excluding..." : "Confirm Exclusion"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

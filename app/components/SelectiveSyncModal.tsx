"use client";

import React, { useState } from "react";

export interface SelectiveSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncCompleted?: (result: any) => void;
  initialCustomerId?: string;
  initialCustomerName?: string;
  initialModule?: "sales_invoices" | "purchase_bills" | "all";
}

export function SelectiveSyncModal({
  isOpen,
  onClose,
  onSyncCompleted,
  initialCustomerId,
  initialCustomerName,
  initialModule = "all",
}: SelectiveSyncModalProps) {
  const [syncInvoices, setSyncInvoices] = useState(
    initialModule === "all" || initialModule === "sales_invoices"
  );
  const [syncBills, setSyncBills] = useState(
    initialModule === "all" || initialModule === "purchase_bills"
  );
  const [syncCustomers, setSyncCustomers] = useState(false);
  const [syncSalesOrders, setSyncSalesOrders] = useState(false);
  const [syncPurchaseOrders, setSyncPurchaseOrders] = useState(false);

  const [financialYear, setFinancialYear] = useState<string>("2025-26");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [customerFilter, setCustomerFilter] = useState<string>(initialCustomerName || "");

  const [isLoading, setIsLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExecuteSync = async (mode: "SMART" | "FORCE") => {
    setIsLoading(true);
    setErrorMessage(null);
    setSyncResult(null);

    const modules: string[] = [];
    if (syncInvoices) modules.push("sales_invoices");
    if (syncBills) modules.push("purchase_bills");
    if (syncCustomers) modules.push("customers");

    if (modules.length === 0) {
      setErrorMessage("Please select at least one sync module.");
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          modules,
          customerId: initialCustomerId,
          customerName: customerFilter || initialCustomerName,
          financialYear: financialYear === "CUSTOM" ? undefined : financialYear,
          fromDate: financialYear === "CUSTOM" ? fromDate : undefined,
          toDate: financialYear === "CUSTOM" ? toDate : undefined,
          forceDetail: mode === "FORCE",
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || "Sync execution failed");
      }

      setSyncResult(data);
      if (onSyncCompleted) {
        onSyncCompleted(data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sync failed to run.";
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(4px)",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          width: "100%",
          maxWidth: 640,
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "90vh",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#f8fafc",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>⚡</span>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
                Selective / Incremental Sync
                <span style={{ fontSize: 10, textTransform: "uppercase", fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "#ecfdf5", color: "#059669", border: "1px solid #a7f3d0" }}>
                  Read Only
                </span>
              </h3>
              <p style={{ margin: "2px 0 0 0", fontSize: 12, color: "#64748b" }}>
                Synchronize specific modules and date ranges directly into local SQLite cache.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 18,
              cursor: "pointer",
              color: "#64748b",
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18, fontSize: 13 }}>
          {/* Target Modules */}
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#475569", marginBottom: 8 }}>
              1. Sync Scope (Modules)
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", background: "#f8fafc" }}>
                <input
                  type="checkbox"
                  checked={syncInvoices}
                  onChange={(e) => setSyncInvoices(e.target.checked)}
                  disabled={isLoading}
                />
                <span style={{ fontWeight: 600, color: "#1e293b" }}>Sales Invoices</span>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", background: "#f8fafc" }}>
                <input
                  type="checkbox"
                  checked={syncBills}
                  onChange={(e) => setSyncBills(e.target.checked)}
                  disabled={isLoading}
                />
                <span style={{ fontWeight: 600, color: "#1e293b" }}>Purchase Bills</span>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", background: "#f8fafc" }}>
                <input
                  type="checkbox"
                  checked={syncCustomers}
                  onChange={(e) => setSyncCustomers(e.target.checked)}
                  disabled={isLoading}
                />
                <span style={{ fontWeight: 600, color: "#1e293b" }}>Customers & Contacts</span>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, opacity: 0.5, cursor: "not-allowed", background: "#f1f5f9" }}>
                <input
                  type="checkbox"
                  checked={syncSalesOrders}
                  onChange={(e) => setSyncSalesOrders(e.target.checked)}
                  disabled={true}
                />
                <span style={{ fontSize: 12, color: "#64748b" }}>Sales Orders (Future Scope)</span>
              </label>
            </div>
          </div>

          {/* Scope Filters */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#475569" }}>
              2. Scope Filters (Optional)
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 4 }}>Financial Year</label>
                <select
                  value={financialYear}
                  onChange={(e) => setFinancialYear(e.target.value)}
                  disabled={isLoading}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                >
                  <option value="2026-27">Current FY 2026-27 (01/04/2026 – 31/03/2027)</option>
                  <option value="2025-26">Previous FY 2025-26 (01/04/2025 – 31/03/2026)</option>
                  <option value="2024-25">FY 2024-25 (01/04/2024 – 31/03/2025)</option>
                  <option value="ALL">All Available Years</option>
                  <option value="CUSTOM">Custom Date Range</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 4 }}>Customer</label>
                <input
                  type="text"
                  placeholder="Optional customer name..."
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value)}
                  disabled={isLoading || Boolean(initialCustomerName)}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                />
              </div>
            </div>

            {financialYear === "CUSTOM" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, paddingTop: 4 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 4 }}>From Date</label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 4 }}>To Date</label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Line-level Purchase Limitation Info */}
          {customerFilter && syncBills && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", fontSize: 12, color: "#92400e" }}>
              <strong>ℹ️ Zoho API Line-Level Note:</strong> Purchase Bill customer details exist at the line item level. Changed bills in this date range will be fetched and filtered locally into your customer reconciliation cache.
            </div>
          )}

          {/* Error display */}
          {errorMessage && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 12, color: "#991b1b" }}>
              ⚠️ {errorMessage}
            </div>
          )}

          {/* Sync Results Summary */}
          {syncResult && (
            <div style={{ padding: 14, borderRadius: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                <strong style={{ color: "#166534" }}>✓ Sync Succeeded ({syncResult.mode} Mode)</strong>
                <span style={{ color: "#475569" }}>
                  API Calls: <strong>{syncResult.apiCallsUsed ?? 0}</strong>
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, textAlign: "center", fontSize: 12 }}>
                <div style={{ padding: 6, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 6 }}>
                  <div style={{ fontSize: 10, color: "#64748b" }}>Checked</div>
                  <div style={{ fontWeight: 700, color: "#0f172a" }}>{syncResult.totalChecked}</div>
                </div>
                <div style={{ padding: 6, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 6 }}>
                  <div style={{ fontSize: 10, color: "#16a34a" }}>New</div>
                  <div style={{ fontWeight: 700, color: "#16a34a" }}>{syncResult.totalNew}</div>
                </div>
                <div style={{ padding: 6, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 6 }}>
                  <div style={{ fontSize: 10, color: "#2563eb" }}>Modified</div>
                  <div style={{ fontWeight: 700, color: "#2563eb" }}>{syncResult.totalModified}</div>
                </div>
                <div style={{ padding: 6, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 6 }}>
                  <div style={{ fontSize: 10, color: "#64748b" }}>Unchanged</div>
                  <div style={{ fontWeight: 700, color: "#64748b" }}>{syncResult.totalUnchanged}</div>
                </div>
              </div>

              {syncResult.customerPurchaseLimitationNote && (
                <p style={{ margin: 0, fontSize: 11, color: "#64748b", fontStyle: "italic" }}>
                  {syncResult.customerPurchaseLimitationNote}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#f8fafc",
          }}
        >
          <div style={{ fontSize: 11, color: "#64748b" }}>
            🔒 Zoho Access: <strong>Strictly READ ONLY</strong>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={onClose}
              disabled={isLoading}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: 12, padding: "6px 12px" }}
            >
              Close
            </button>
            <button
              onClick={() => handleExecuteSync("FORCE")}
              disabled={isLoading}
              className="btn btn-sm"
              style={{ fontSize: 12, padding: "6px 12px", background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a" }}
            >
              {isLoading ? "Syncing..." : "🔄 Force Selected Sync"}
            </button>
            <button
              onClick={() => handleExecuteSync("SMART")}
              disabled={isLoading}
              className="btn btn-sm"
              style={{ fontSize: 12, padding: "6px 14px", background: "#0f766e", color: "#ffffff", fontWeight: 700 }}
            >
              {isLoading ? "Syncing..." : "⚡ Smart Sync"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

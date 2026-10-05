"use client";

import React, { useState, useEffect, useMemo } from "react";
import type {
  MasterInventoryMismatchReportResult,
  ReconciliationReportResult,
} from "@/app/types/reconciliation";
import { formatINR, formatQuantity, formatDisplayDate } from "@/app/lib/date-utils";
import { SelectiveSyncModal } from "./SelectiveSyncModal";

interface DashboardProps {
  mismatchReport: MasterInventoryMismatchReportResult | null;
  report: ReconciliationReportResult | null;
  onNavigate: (section: string) => void;
  onSelectRow?: (customerId: string, itemId: string) => void;
  financialYear: string;
  onFinancialYearChange?: (fy: string, customFrom?: string, customTo?: string) => void;
  syncStatusText: string;
  lastSyncTime: string;
  coverageStatus: string;
  loading?: boolean;
}

export function Dashboard({
  mismatchReport,
  report,
  onNavigate,
  onSelectRow,
  financialYear,
  onFinancialYearChange,
  syncStatusText,
  lastSyncTime,
  coverageStatus,
  loading = false,
}: DashboardProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<string>(financialYear);
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [customFrom, setCustomFrom] = useState<string>("2026-04-01");
  const [customTo, setCustomTo] = useState<string>("2026-09-11");
  const [showMarginModal, setShowMarginModal] = useState<boolean>(false);

  // Smart Sync & Stale States
  const [isSyncingAll, setIsSyncingAll] = useState<boolean>(false);
  const [syncAllResult, setSyncAllResult] = useState<any | null>(null);
  const [showSelectiveSyncModal, setShowSelectiveSyncModal] = useState<boolean>(false);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);

  // Sorting for Top Shortage & Top Surplus tables (Section 9 & 10)
  const [shortageSortBy, setShortageSortBy] = useState<"value" | "qty">("value");
  const [surplusSortBy, setSurplusSortBy] = useState<"value" | "qty">("value");


  // Sync state & API calls count
  const [apiCallsToday, setApiCallsToday] = useState<number>(0);
  const [lastSyncApiCalls, setLastSyncApiCalls] = useState<number>(0);
  const [syncedThroughDate, setSyncedThroughDate] = useState<string>("11/09/2026");
  const [isConnected, setIsConnected] = useState<boolean>(true);

  // Recent records
  const [recentBills, setRecentBills] = useState<Record<string, unknown>[]>([]);
  const [recentInvoices, setRecentInvoices] = useState<Record<string, unknown>[]>([]);
  const [loadingRecent, setLoadingRecent] = useState<boolean>(true);

  // Keep local selectedPeriod in sync with prop if prop changes externally
  useEffect(() => {
    setSelectedPeriod(financialYear);
    setIsCustom(financialYear === "CUSTOM");
  }, [financialYear]);

  // Load sync metadata and connection status for factual Zoho API info
  useEffect(() => {
    let isMounted = true;
    async function loadSyncStats() {
      try {
        const [resSync, resStatus] = await Promise.all([
          fetch("/api/sync"),
          fetch("/api/zoho/status"),
        ]);
        if (resSync.ok) {
          const json = await resSync.json();
          if (isMounted) {
            if (typeof json.apiCallsToday === "number") setApiCallsToday(json.apiCallsToday);
            if (typeof json.lastSyncApiCalls === "number") setLastSyncApiCalls(json.lastSyncApiCalls);
            if (json.syncedThroughDisplay) {
              setSyncedThroughDate(json.syncedThroughDisplay);
            } else if (json.syncedThrough) {
              setSyncedThroughDate(formatDisplayDate(json.syncedThrough));
            }
            if (json.staleness) {
              setIsStale(Boolean(json.staleness.isStale));
              setStaleMessage(json.staleness.message || null);
            }
          }
        }
        if (resStatus.ok) {
          const statusJson = await resStatus.json();
          if (isMounted) setIsConnected(Boolean(statusJson.connected));
        }
      } catch {
        // silent fallback
      }
    }
    loadSyncStats();
    return () => { isMounted = false; };
  }, [lastSyncTime]);

  const handleSmartSyncAll = async (mode: "SMART" | "FORCE" = "SMART") => {
    try {
      setIsSyncingAll(true);
      setSyncAllResult(null);

      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          modules: ["sales_invoices", "purchase_bills"],
          financialYear: selectedPeriod === "ALL" || isCustom ? undefined : selectedPeriod,
          fromDate: isCustom ? customFrom : undefined,
          toDate: isCustom ? customTo : undefined,
          forceDetail: mode === "FORCE",
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || json.error || "Smart Sync failed");
      }

      setSyncAllResult(json);
      setIsStale(false);
      // Reload stats
      const syncRes = await fetch("/api/sync");
      if (syncRes.ok) {
        const sJson = await syncRes.json();
        if (typeof sJson.apiCallsToday === "number") setApiCallsToday(sJson.apiCallsToday);
      }
    } catch (err) {
      console.error("Smart Sync error:", err);
      setSyncAllResult({
        status: "FAILED",
        message: err instanceof Error ? err.message : "Sync failed",
      });
    } finally {
      setIsSyncingAll(false);
    }
  };

  // Load recent bills & invoices
  useEffect(() => {
    let isMounted = true;
    async function loadRecent() {
      try {
        setLoadingRecent(true);
        const res = await fetch(`/api/transactions?type=recent&financialYear=${encodeURIComponent(financialYear)}`);
        if (res.ok) {
          const json = await res.json();
          if (isMounted && json.success) {
            setRecentBills(json.recentBills || []);
            setRecentInvoices(json.recentInvoices || []);
          }
        }
      } catch {
        // silent fallback
      } finally {
        if (isMounted) setLoadingRecent(false);
      }
    }
    loadRecent();
    return () => { isMounted = false; };
  }, [financialYear]);

  const handlePeriodChange = (newPeriod: string) => {
    setSelectedPeriod(newPeriod);
    if (newPeriod === "CUSTOM") {
      setIsCustom(true);
      if (onFinancialYearChange) onFinancialYearChange("CUSTOM", customFrom, customTo);
    } else {
      setIsCustom(false);
      if (onFinancialYearChange) onFinancialYearChange(newPeriod);
    }
  };

  const handleApplyCustomDates = () => {
    if (onFinancialYearChange) {
      onFinancialYearChange("CUSTOM", customFrom, customTo);
    }
  };

  const totals = mismatchReport?.totals;
  const tabCounts = mismatchReport?.tabCounts;
  const items = mismatchReport?.items || [];
  const missingCustomerCount = mismatchReport?.customerDetailsMissing?.length ?? tabCounts?.missingCustomer ?? 0;

  // Margin calculation (Section 25 & 33)
  const totalPurchaseAmt = totals?.totalPurchaseAmount ?? report?.totals.purchaseAmount ?? 0;
  const totalSalesAmt = totals?.totalSalesAmount ?? report?.totals.salesAmount ?? 0;
  const reconMargin = totalSalesAmt - totalPurchaseAmt;
  const reconMarginPercent = totalSalesAmt > 0 ? ((reconMargin / totalSalesAmt) * 100).toFixed(1) : "0.0";

  // Customer-Item margin breakdown list for modal
  const itemMarginBreakdown = useMemo(() => {
    return items
      .filter((it) => it.salesAmount > 0 || it.purchaseAmount > 0)
      .map((it) => {
        const margin = it.salesAmount - it.purchaseAmount;
        const marginPct = it.salesAmount > 0 ? ((margin / it.salesAmount) * 100).toFixed(1) : "0.0";
        return {
          customerName: it.customerName,
          itemName: it.itemName,
          salesAmount: it.salesAmount,
          purchaseAmount: it.purchaseAmount,
          margin,
          marginPct,
        };
      })
      .sort((a, b) => b.margin - a.margin);
  }, [items]);

  // Section 9: Top Yet to Purchase Items (Shortage) with sort toggle
  const biggestYetToPurchase = useMemo(() => {
    return [...items]
      .filter((i) => i.yetToPurchaseQty > 0)
      .sort((a, b) => {
        if (shortageSortBy === "value") {
          return (b.approxShortageValue ?? 0) - (a.approxShortageValue ?? 0);
        }
        return b.yetToPurchaseQty - a.yetToPurchaseQty;
      })
      .slice(0, 5);
  }, [items, shortageSortBy]);

  // Section 10: Top Yet to Sale Items (Surplus) with sort toggle
  const biggestYetToSale = useMemo(() => {
    return [...items]
      .filter((i) => i.yetToSaleQty > 0)
      .sort((a, b) => {
        if (surplusSortBy === "value") {
          return (b.approxSurplusValue ?? 0) - (a.approxSurplusValue ?? 0);
        }
        return b.yetToSaleQty - a.yetToSaleQty;
      })
      .slice(0, 5);
  }, [items, surplusSortBy]);


  // Items requiring attention
  const itemsRequiringAttention = useMemo(() => {
    return [...items]
      .filter((i) => i.balanceQty !== 0)
      .sort((a, b) => Math.abs(b.balanceQty) - Math.abs(a.balanceQty))
      .slice(0, 5);
  }, [items]);

  const isHistoricalCompletedFY = selectedPeriod === "2025-26" || selectedPeriod === "2024-25";

  return (
    <div className="dashboard-container" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Stale Warning Banner if data is older than threshold */}
      {isStale && (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 8,
            padding: "10px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            fontSize: 12.5,
            color: "#92400e",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>⚠️</span>
            <span><strong>Data may be outdated:</strong> {staleMessage || "Local cache has not been synced recently."}</span>
          </div>
          <button
            className="btn btn-sm"
            onClick={() => handleSmartSyncAll("SMART")}
            disabled={isSyncingAll}
            style={{ background: "#d97706", color: "#ffffff", fontWeight: 700, padding: "4px 12px", fontSize: 11.5 }}
          >
            {isSyncingAll ? "Syncing..." : "⚡ Smart Sync Now"}
          </button>
        </div>
      )}

      {/* Section 45: Zoho Sync Status Banner */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          padding: "10px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          fontSize: 12,
          color: "#475569",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span>
            Zoho:{" "}
            {isConnected ? (
              <strong style={{ color: "#16a34a" }}>Connected ●</strong>
            ) : (
              <strong style={{ color: "#dc2626" }}>Offline ○</strong>
            )}
          </span>
          <span>·</span>
          <span>
            Last Sync: <strong>{lastSyncTime || "Never"}</strong>
          </span>
          <span>·</span>
          <span>
            API Calls Today: <strong style={{ color: "#0f172a" }}>{apiCallsToday}</strong>
          </span>
          <span>·</span>
          <span>
            Cache: <strong style={{ color: coverageStatus === "COMPLETE" ? "#16a34a" : "#d97706" }}>{coverageStatus === "COMPLETE" ? "Current" : "Partial"}</strong>
          </span>
          <span>·</span>
          <span style={{ color: "#0f766e", fontWeight: 700, background: "#f0fdf4", padding: "2px 6px", borderRadius: 4, border: "1px solid #bbf7d0" }}>
            LOCAL CACHE
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className="btn btn-sm"
            onClick={() => handleSmartSyncAll("SMART")}
            disabled={isSyncingAll}
            style={{ background: "#0f766e", color: "#ffffff", fontWeight: 600, fontSize: 11.5, padding: "4px 10px" }}
            title="Incrementally sync all changed Sales Invoices and Purchase Bills"
          >
            {isSyncingAll ? "Syncing..." : "⚡ Smart Sync All Changed"}
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => setShowSelectiveSyncModal(true)}
            style={{ fontSize: 11.5, padding: "4px 10px" }}
            title="Open Selective Sync Dialog"
          >
            ⚙️ Selective Sync...
          </button>
        </div>
      </div>

      {/* Sync All Result Notice */}
      {syncAllResult && (
        <div
          style={{
            background: syncAllResult.status === "SUCCESS" ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${syncAllResult.status === "SUCCESS" ? "#bbf7d0" : "#fecaca"}`,
            borderRadius: 6,
            padding: "10px 14px",
            fontSize: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ color: syncAllResult.status === "SUCCESS" ? "#166534" : "#991b1b" }}>
            <strong>{syncAllResult.status === "SUCCESS" ? "✓ Sync Completed" : "Sync Failed"}:</strong> {syncAllResult.message}
          </div>
          <div style={{ fontSize: 11, color: "#475569" }}>
            API Calls Used: <strong>{syncAllResult.apiCallsUsed ?? 0}</strong>
          </div>
        </div>
      )}

      {/* ============================================================
          SECTION 20: DASHBOARD HEADER & MANAGEMENT TITLE
      ============================================================ */}
      <div
        className="dashboard-header-card"
        style={{
          background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          padding: "16px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 14,
          boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0, letterSpacing: "-0.3px" }}>
              Bansil Books Analytics — Management Dashboard
            </h2>
            <span style={{ fontSize: 11, background: "#eff6ff", color: "#2563eb", padding: "3px 8px", borderRadius: 4, fontWeight: 700, border: "1px solid #bfdbfe" }}>
              LOCAL SQLITE ENGINE
            </span>
          </div>
          <p style={{ fontSize: 12.5, color: "#64748b", marginTop: 4, margin: "4px 0 0 0" }}>
            Purchase • Sales • Reconciliation • Exceptions
          </p>
        </div>

        {/* Section 18 & 31: Period Dropdown & Coverage Bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1" }}>
            <label htmlFor="dashboard-period-select" style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
              Period:
            </label>
            <select
              id="dashboard-period-select"
              value={selectedPeriod}
              onChange={(e) => handlePeriodChange(e.target.value)}
              style={{
                border: "none",
                fontSize: 12.5,
                fontWeight: 600,
                color: "#2563eb",
                background: "transparent",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="2026-27">FY 2026-27 (Current)</option>
              <option value="2025-26">FY 2025-26 (Historical)</option>
              <option value="2024-25">FY 2024-25</option>
              <option value="CUSTOM">Custom Date Range</option>
            </select>
          </div>

          {/* Section 19 & 31: Coverage Display */}
          {isHistoricalCompletedFY ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11.5, background: "#ecfdf5", color: "#059669", padding: "4px 10px", borderRadius: 4, fontWeight: 700, border: "1px solid #a7f3d0" }}>
                Coverage: COMPLETE
              </span>
              <span style={{ fontSize: 12, color: "#64748b" }}>
                Last Synced: <strong>{lastSyncTime}</strong>
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, background: "#eff6ff", color: "#2563eb", padding: "4px 10px", borderRadius: 4, fontWeight: 700, border: "1px solid #bfdbfe" }}>
                Coverage: CURRENT THROUGH LAST SYNC
              </span>
              <span style={{ fontSize: 11.5, background: "#f0f9ff", color: "#0369a1", padding: "4px 10px", borderRadius: 4, fontWeight: 600 }}>
                Synced Through: {syncedThroughDate}
              </span>
              <span style={{ fontSize: 12, color: "#64748b" }}>
                Last Sync: <strong>{lastSyncTime}</strong>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Custom Date Range Picker */}
      {isCustom && (
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            background: "#f1f5f9",
            padding: "10px 16px",
            borderRadius: 6,
            border: "1px solid #e2e8f0",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <label style={{ fontWeight: 600, color: "#334155" }}>From:</label>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              style={{ border: "1px solid #cbd5e1", borderRadius: 4, padding: "3px 8px", fontSize: 12 }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <label style={{ fontWeight: 600, color: "#334155" }}>To:</label>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              style={{ border: "1px solid #cbd5e1", borderRadius: 4, padding: "3px 8px", fontSize: 12 }}
            />
          </div>
          <button
            type="button"
            onClick={handleApplyCustomDates}
            style={{ background: "#2563eb", color: "#fff", border: "none", fontSize: 12, padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
          >
            Apply Range
          </button>
        </div>
      )}

      {/* ============================================================
          SECTION 21 & 22 & 11: DASHBOARD MAIN KPI CARDS (ALL CLICKABLE)
      ============================================================ */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#1e293b", margin: 0 }}>
            Reconciliation &amp; Transaction Metrics (Click to Drilldown)
          </h3>
          <span style={{ fontSize: 11.5, color: "#64748b" }}>
            Zero Zoho API Calls · Local SQLite Data Only
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: 12,
          }}
        >
          {/* Card 1: TOTAL PURCHASE (Qty, Amount) -> tx_purchase_bills */}
          <div
            className="kpi-interactive-card"
            onClick={() => onNavigate("tx_purchase_bills")}
            title="Click to view Purchase Bills"
            style={{ cursor: "pointer" }}
          >
            <div className="kpi-label">TOTAL PURCHASE</div>
            <div className="kpi-val" style={{ color: "#16a34a" }}>
              {loading ? "…" : formatQuantity(totals?.totalPurchaseQty ?? report?.totals.purchaseQty ?? 0)}
            </div>
            <div className="kpi-sub">
              ₹{formatINR(totals?.totalPurchaseAmount ?? report?.totals.purchaseAmount ?? 0)} →
            </div>
          </div>

          {/* Card 2: TOTAL SALES (Qty, Amount) -> tx_sales_invoices */}
          <div
            className="kpi-interactive-card"
            onClick={() => onNavigate("tx_sales_invoices")}
            title="Click to view Sales Invoices"
            style={{ cursor: "pointer" }}
          >
            <div className="kpi-label">TOTAL SALES</div>
            <div className="kpi-val" style={{ color: "#2563eb" }}>
              {loading ? "…" : formatQuantity(totals?.totalSalesQty ?? report?.totals.salesQty ?? 0)}
            </div>
            <div className="kpi-sub">
              ₹{formatINR(totals?.totalSalesAmount ?? report?.totals.salesAmount ?? 0)} →
            </div>
          </div>

          {/* Card 3: RECONCILED (Customer-Items / Qty) -> recon_reconciled */}
          <div
            className="kpi-interactive-card"
            onClick={() => onNavigate("recon_reconciled")}
            title="Click to view Reconciled records"
            style={{ cursor: "pointer" }}
          >
            <div className="kpi-label">RECONCILED</div>
            <div className="kpi-val" style={{ color: "#059669" }}>
              {loading ? "…" : formatQuantity(totals?.reconciledCount ?? tabCounts?.reconciled ?? 0)}
            </div>
            <div className="kpi-sub">
              {formatQuantity(totals?.totalReconciledQty ?? report?.totals.reconciledQty ?? 0)} units matched →
            </div>
          </div>

          {/* Card 4: YET TO PURCHASE (Qty) -> recon_yet_to_purchase */}
          <div
            className="kpi-interactive-card"
            onClick={() => onNavigate("recon_yet_to_purchase")}
            title="Click to view Yet to Purchase (Shortage)"
            style={{ cursor: "pointer" }}
          >
            <div className="kpi-label">YET TO PURCHASE</div>
            <div className="kpi-val" style={{ color: "#dc2626" }}>
              {loading ? "…" : formatQuantity(totals?.totalYetToPurchaseQty ?? 0)}
            </div>
            <div className="kpi-sub">
              {totals?.shortageCount ?? tabCounts?.yetToPurchase ?? 0} shortage items →
            </div>
          </div>

          {/* Card 4B: APPROX SHORTAGE VALUE (Section 11) */}
          <div
            className="kpi-interactive-card"
            onClick={() => onNavigate("recon_yet_to_purchase")}
            title="Decision-support estimate only. Not an accounting/booked value."
            style={{ cursor: "pointer", border: "1px solid #fecaca", background: "#fef2f2" }}
          >
            <div className="kpi-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>APPROX SHORTAGE VALUE</span>
              <span style={{ fontSize: 10, color: "#dc2626", fontWeight: 700 }}>≈ Approx.</span>
            </div>
            <div className="kpi-val" style={{ color: "#b91c1c" }}>
              ₹{loading ? "…" : formatINR(totals?.totalApproxShortageValue ?? 0)}
            </div>
            <div className="kpi-sub" style={{ color: "#991b1b" }}>
              Estimated purchase exposure →
            </div>
          </div>

          {/* Card 5: YET TO SALE (Qty) -> recon_yet_to_sale */}
          <div
            className="kpi-interactive-card"
            onClick={() => onNavigate("recon_yet_to_sale")}
            title="Click to view Yet to Sale (Surplus)"
            style={{ cursor: "pointer" }}
          >
            <div className="kpi-label">YET TO SALE</div>
            <div className="kpi-val" style={{ color: "#0284c7" }}>
              {loading ? "…" : formatQuantity(totals?.totalYetToSaleQty ?? 0)}
            </div>
            <div className="kpi-sub">
              {totals?.surplusCount ?? tabCounts?.yetToSale ?? 0} surplus items →
            </div>
          </div>

          {/* Card 5B: APPROX SURPLUS VALUE (Section 11) */}
          <div
            className="kpi-interactive-card"
            onClick={() => onNavigate("recon_yet_to_sale")}
            title="Decision-support estimate only. Not an accounting/booked value."
            style={{ cursor: "pointer", border: "1px solid #bae6fd", background: "#f0f9ff" }}
          >
            <div className="kpi-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>APPROX SURPLUS VALUE</span>
              <span style={{ fontSize: 10, color: "#0284c7", fontWeight: 700 }}>≈ Approx.</span>
            </div>
            <div className="kpi-val" style={{ color: "#0369a1" }}>
              ₹{loading ? "…" : formatINR(totals?.totalApproxSurplusValue ?? 0)}
            </div>
            <div className="kpi-sub" style={{ color: "#075985" }}>
              Estimated unsold stock value →
            </div>
          </div>

          {/* Card 6: CUSTOMER DETAILS MISSING -> recon_customer_missing */}
          <div
            className="kpi-interactive-card"
            onClick={() => onNavigate("recon_customer_missing")}
            title="Click to view Missing Customer records"
            style={{ cursor: "pointer" }}
          >
            <div className="kpi-label">CUSTOMER DETAILS MISSING</div>
            <div className="kpi-val" style={{ color: missingCustomerCount > 0 ? "#d97706" : "#475569" }}>
              {loading ? "…" : missingCustomerCount}
            </div>
            <div className="kpi-sub">
              Unallocated purchase lines →
            </div>
          </div>

          {/* Card 7: EXCLUDED ITEMS -> recon_excluded */}
          <div
            className="kpi-interactive-card"
            onClick={() => onNavigate("recon_excluded")}
            title="Click to view Excluded Items"
            style={{ cursor: "pointer" }}
          >
            <div className="kpi-label">EXCLUDED ITEMS</div>
            <div className="kpi-val" style={{ color: "#64748b" }}>
              {loading ? "…" : (mismatchReport?.tabCounts?.excludedCount ?? 0)}
            </div>
            <div className="kpi-sub">
              Human-approved rules →
            </div>
          </div>
        </div>
      </div>
      {/* ============================================================
          SECTION 23, 24, 25: AI USAGE, ZOHO API USAGE & MARGIN
      ============================================================ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        
        {/* Section 23: Dashboard AI / Intelligence Usage Card */}
        <div
          className="section-card"
          style={{
            padding: 16,
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
              <span>🧠</span>
              <span>INTELLIGENCE</span>
            </h4>
            <span style={{ fontSize: 11, background: "#eff6ff", color: "#2563eb", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
              LOCAL ENGINE
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#475569" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Mode:</span>
              <strong style={{ color: "#0f172a" }}>Local Rule Engine</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>External AI:</span>
              <strong style={{ color: "#64748b" }}>OFF</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Accounting Data Sent to External AI:</span>
              <strong style={{ color: "#16a34a" }}>NO</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Pending Exclusion Suggestions:</span>
              <strong style={{ color: "#2563eb" }}>0</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Last Suggestion Analysis:</span>
              <span style={{ color: "#64748b" }}>{lastSyncTime || "Never"}</span>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onNavigate("settings_suggestions")}
            style={{
              width: "100%",
              marginTop: 12,
              background: "#f8fafc",
              border: "1px solid #cbd5e1",
              color: "#2563eb",
              fontWeight: 600,
              fontSize: 11.5,
              padding: "6px",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Review Suggestions →
          </button>
        </div>

        {/* Section 24: Zoho API Usage Card */}
        <div
          className="section-card"
          style={{
            padding: 16,
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
              <span>🔌</span>
              <span>ZOHO API</span>
            </h4>
            <span style={{ fontSize: 11, background: isConnected ? "#f0fdf4" : "#fef2f2", color: isConnected ? "#16a34a" : "#dc2626", padding: "2px 8px", borderRadius: 4, fontWeight: 600, border: `1px solid ${isConnected ? "#bbf7d0" : "#fecaca"}` }}>
              {isConnected ? "● Connected" : "○ Offline"}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#475569" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Access:</span>
              <strong style={{ color: "#16a34a" }}>READ ONLY (GET only)</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>API Calls Today:</span>
              <strong style={{ color: "#0f172a" }}>{apiCallsToday}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Last Sync API Calls:</span>
              <strong style={{ color: "#0f172a" }}>{lastSyncApiCalls}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Report / Filter API Calls:</span>
              <strong style={{ color: "#16a34a" }}>0 (Local SQLite)</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Quota Remaining:</span>
              <span style={{ color: "#64748b" }}>Not provided</span>
            </div>
          </div>

          <div style={{ marginTop: 12, fontSize: 11, color: "#64748b", borderTop: "1px solid #f1f5f9", paddingTop: 8 }}>
            🔒 Zoho Books source data is NEVER modified by reports or filters.
          </div>
        </div>

        {/* Section 25 & 33: Reconciliation Margin & Accounting Profit Cards */}
        <div
          className="section-card"
          style={{
            padding: 16,
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", margin: 0 }}>
                RECONCILIATION GROSS MARGIN
              </h4>
              <button
                type="button"
                onClick={() => setShowMarginModal(true)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#2563eb",
                  fontWeight: 600,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                View Breakdown ↗
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "6px 0" }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: reconMargin >= 0 ? "#16a34a" : "#dc2626" }}>
                ₹{formatINR(reconMargin)}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: reconMargin >= 0 ? "#16a34a" : "#dc2626" }}>
                ({reconMarginPercent}%)
              </span>
            </div>

            <div style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.4 }}>
              Sales Amount (₹{formatINR(totalSalesAmt)}) minus Purchase Amount (₹{formatINR(totalPurchaseAmt)}) for included items.
            </div>
          </div>

          {/* Accounting Profit cards (Section 25-B: Factual scope limitation) */}
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ padding: "8px 10px", background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#334155" }}>
                Accounting Gross Profit
              </div>
              <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 2 }}>
                Not available with current approved read scopes
              </div>
              <div style={{ fontSize: 9.5, color: "#94a3b8", marginTop: 2 }}>
                Requires additional READ-only accounting/report scope approval.
              </div>
            </div>

            <div style={{ padding: "8px 10px", background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#334155" }}>
                Accounting Net Profit
              </div>
              <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 2 }}>
                Not available with current approved read scopes
              </div>
              <div style={{ fontSize: 9.5, color: "#94a3b8", marginTop: 2 }}>
                Requires additional READ-only accounting/report scope approval.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================
          SECTION 32: RECENT & ATTENTION SECTIONS (ALL ROWS CLICKABLE)
      ============================================================ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16 }}>
        
        {/* Section 32-A: Top Yet to Purchase (Shortage) */}
        <div className="section-card" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                ⚠️ Top Yet to Purchase (Shortage)
              </h4>
              <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 4, padding: 2 }}>
                <button
                  type="button"
                  onClick={() => setShortageSortBy("value")}
                  style={{
                    border: "none",
                    background: shortageSortBy === "value" ? "#2563eb" : "transparent",
                    color: shortageSortBy === "value" ? "#fff" : "#475569",
                    padding: "2px 6px",
                    borderRadius: 3,
                    fontSize: 10.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  By Value
                </button>
                <button
                  type="button"
                  onClick={() => setShortageSortBy("qty")}
                  style={{
                    border: "none",
                    background: shortageSortBy === "qty" ? "#2563eb" : "transparent",
                    color: shortageSortBy === "qty" ? "#fff" : "#475569",
                    padding: "2px 6px",
                    borderRadius: 3,
                    fontSize: 10.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  By Qty
                </button>
              </div>
            </div>
            <button
              className="btn-link"
              onClick={() => onNavigate("recon_yet_to_purchase")}
              style={{ fontSize: 11, fontWeight: 600, color: "#2563eb", background: "none", border: "none", cursor: "pointer" }}
            >
              View All ({tabCounts?.yetToPurchase ?? 0}) →
            </button>
          </div>

          <div className="table-responsive">
            <table className="data-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Item</th>
                  <th className="right">Shortage Qty</th>
                  <th className="right">
                    Approx Value <span style={{ fontSize: 10, color: "#dc2626" }}>≈ Approx.</span>
                  </th>
                  <th style={{ textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {biggestYetToPurchase.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 16, color: "#16a34a" }}>
                      ✓ No shortage items for this period!
                    </td>
                  </tr>
                ) : (
                  biggestYetToPurchase.map((it) => (
                    <tr
                      key={`top-shortage-${it.customerId || 'cust'}-${it.itemId || 'item'}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => onSelectRow ? onSelectRow(it.customerId, it.itemId) : onNavigate("recon_yet_to_purchase")}
                      title="Click to view Transaction Breakdown"
                    >
                      <td style={{ fontWeight: 600 }} title={it.customerName}>
                        {it.customerName.length > 20 ? `${it.customerName.slice(0, 20)}…` : it.customerName}
                      </td>
                      <td title={it.itemName}>
                        {it.itemName.length > 22 ? `${it.itemName.slice(0, 22)}…` : it.itemName}
                      </td>
                      <td className="right" style={{ fontWeight: 700, color: "#dc2626" }}>
                        {formatQuantity(it.yetToPurchaseQty)}
                      </td>
                      <td className="right amount" style={{ fontWeight: 700, color: "#b91c1c" }}>
                        {typeof it.approxShortageValue === "number" ? `₹${formatINR(it.approxShortageValue)}` : "—"}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span className="status-badge-shortfall" style={{ fontSize: 10 }}>SHORTAGE</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 32-B: Top Yet to Sale (Surplus) */}
        <div className="section-card" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                📦 Top Yet to Sale (Surplus)
              </h4>
              <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 4, padding: 2 }}>
                <button
                  type="button"
                  onClick={() => setSurplusSortBy("value")}
                  style={{
                    border: "none",
                    background: surplusSortBy === "value" ? "#2563eb" : "transparent",
                    color: surplusSortBy === "value" ? "#fff" : "#475569",
                    padding: "2px 6px",
                    borderRadius: 3,
                    fontSize: 10.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  By Value
                </button>
                <button
                  type="button"
                  onClick={() => setSurplusSortBy("qty")}
                  style={{
                    border: "none",
                    background: surplusSortBy === "qty" ? "#2563eb" : "transparent",
                    color: surplusSortBy === "qty" ? "#fff" : "#475569",
                    padding: "2px 6px",
                    borderRadius: 3,
                    fontSize: 10.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  By Qty
                </button>
              </div>
            </div>
            <button
              className="btn-link"
              onClick={() => onNavigate("recon_yet_to_sale")}
              style={{ fontSize: 11, fontWeight: 600, color: "#2563eb", background: "none", border: "none", cursor: "pointer" }}
            >
              View All ({tabCounts?.yetToSale ?? 0}) →
            </button>
          </div>

          <div className="table-responsive">
            <table className="data-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Item</th>
                  <th className="right">Surplus Qty</th>
                  <th className="right">
                    Approx Value <span style={{ fontSize: 10, color: "#0284c7" }}>≈ Approx.</span>
                  </th>
                  <th style={{ textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {biggestYetToSale.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 16, color: "#16a34a" }}>
                      ✓ No surplus items for this period!
                    </td>
                  </tr>
                ) : (
                  biggestYetToSale.map((it) => (
                    <tr
                      key={`top-surplus-${it.customerId || 'cust'}-${it.itemId || 'item'}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => onSelectRow ? onSelectRow(it.customerId, it.itemId) : onNavigate("recon_yet_to_sale")}
                      title="Click to view Transaction Breakdown"
                    >
                      <td style={{ fontWeight: 600 }} title={it.customerName}>
                        {it.customerName.length > 20 ? `${it.customerName.slice(0, 20)}…` : it.customerName}
                      </td>
                      <td title={it.itemName}>
                        {it.itemName.length > 22 ? `${it.itemName.slice(0, 22)}…` : it.itemName}
                      </td>
                      <td className="right" style={{ fontWeight: 700, color: "#0284c7" }}>
                        {formatQuantity(it.yetToSaleQty)}
                      </td>
                      <td className="right amount" style={{ fontWeight: 700, color: "#0369a1" }}>
                        {typeof it.approxSurplusValue === "number" ? `₹${formatINR(it.approxSurplusValue)}` : "—"}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span className="status-badge-surplus" style={{ fontSize: 10 }}>SURPLUS</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 32-C: Recent Purchase Bills */}
        <div className="section-card" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", margin: 0 }}>
              📥 Recent Synchronized Purchase Bills
            </h4>
            <button
              className="btn-link"
              onClick={() => onNavigate("tx_purchase_bills")}
              style={{ fontSize: 11, fontWeight: 600, color: "#2563eb", background: "none", border: "none", cursor: "pointer" }}
            >
              View Bills →
            </button>
          </div>

          <div className="table-responsive">
            <table className="data-table" style={{ fontSize: 11.5 }}>
              <thead>
                <tr>
                  <th>Bill No.</th>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th className="right">Amount</th>
                  <th style={{ textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {loadingRecent ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 16 }}>
                      Loading recent bills…
                    </td>
                  </tr>
                ) : recentBills.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 16, color: "#64748b" }}>
                      No recent bills in local database.
                    </td>
                  </tr>
                ) : (
                  recentBills.slice(0, 5).map((b) => (
                    <tr
                      key={`recent-bill-${b.bill_id || b.bill_number}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => onNavigate("tx_purchase_bills")}
                    >
                      <td style={{ fontWeight: 600 }}>{String(b.bill_number)}</td>
                      <td>{formatDisplayDate(String(b.date))}</td>
                      <td title={String(b.vendor_name)}>
                        {String(b.vendor_name).length > 20 ? `${String(b.vendor_name).slice(0, 20)}…` : String(b.vendor_name)}
                      </td>
                      <td className="right amount">₹{formatINR(Number(b.total) || 0)}</td>
                      <td style={{ textAlign: "center" }}>
                        <span className="badge-enabled" style={{ fontSize: 10 }}>{String(b.status || "SYNCED")}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 32-D: Recent Sales Invoices */}
        <div className="section-card" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", margin: 0 }}>
              📤 Recent Synchronized Sales Invoices
            </h4>
            <button
              className="btn-link"
              onClick={() => onNavigate("tx_sales_invoices")}
              style={{ fontSize: 11, fontWeight: 600, color: "#2563eb", background: "none", border: "none", cursor: "pointer" }}
            >
              View Invoices →
            </button>
          </div>

          <div className="table-responsive">
            <table className="data-table" style={{ fontSize: 11.5 }}>
              <thead>
                <tr>
                  <th>Invoice No.</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th className="right">Amount</th>
                  <th style={{ textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {loadingRecent ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 16 }}>
                      Loading recent invoices…
                    </td>
                  </tr>
                ) : recentInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 16, color: "#64748b" }}>
                      No recent invoices in local database.
                    </td>
                  </tr>
                ) : (
                  recentInvoices.slice(0, 5).map((inv) => (
                    <tr
                      key={`recent-inv-${inv.invoice_id || inv.invoice_number}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => onNavigate("tx_sales_invoices")}
                    >
                      <td style={{ fontWeight: 600 }}>{String(inv.invoice_number)}</td>
                      <td>{formatDisplayDate(String(inv.date))}</td>
                      <td title={String(inv.customer_name)}>
                        {String(inv.customer_name).length > 20 ? `${String(inv.customer_name).slice(0, 20)}…` : String(inv.customer_name)}
                      </td>
                      <td className="right amount">₹{formatINR(Number(inv.total) || 0)}</td>
                      <td style={{ textAlign: "center" }}>
                        <span className="badge-enabled" style={{ fontSize: 10 }}>{String(inv.status || "SYNCED")}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ============================================================
          SECTION 33: RECONCILIATION GROSS MARGIN DRILLDOWN MODAL
      ============================================================ */}
      {showMarginModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.4)",
            backdropFilter: "blur(2px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setShowMarginModal(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 8,
              width: "850px",
              maxWidth: "96vw",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                  Reconciliation Gross Margin Breakdown
                </h3>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  Aggregated Customer + Item Data · Full Local Precision · Zero External Calls
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowMarginModal(false)}
                style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "#64748b" }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
              <table className="data-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Item</th>
                    <th className="right">Sales Amount</th>
                    <th className="right">Purchase Amount</th>
                    <th className="right">Margin</th>
                    <th className="right">Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {itemMarginBreakdown.map((row) => (
                    <tr key={`margin-${row.customerName}-${row.itemName}`}>
                      <td style={{ fontWeight: 600 }}>{row.customerName}</td>
                      <td>{row.itemName}</td>
                      <td className="right amount">₹{formatINR(row.salesAmount)}</td>
                      <td className="right amount">₹{formatINR(row.purchaseAmount)}</td>
                      <td className="right amount" style={{ fontWeight: 700, color: row.margin >= 0 ? "#16a34a" : "#dc2626" }}>
                        ₹{formatINR(row.margin)}
                      </td>
                      <td className="right" style={{ color: row.margin >= 0 ? "#16a34a" : "#dc2626" }}>
                        {row.marginPct}%
                      </td>
                    </tr>
                  ))}
                  {itemMarginBreakdown.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: 20, color: "#64748b" }}>
                        No transactions available for margin calculation in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowMarginModal(false)}
                style={{ padding: "5px 16px" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Selective Sync Modal */}
      <SelectiveSyncModal
        isOpen={showSelectiveSyncModal}
        onClose={() => setShowSelectiveSyncModal(false)}
        onSyncCompleted={(result) => {
          setSyncAllResult(result);
          setIsStale(false);
          // Reload dashboard stats
          fetch("/api/sync")
            .then((r) => r.json())
            .then((j) => {
              if (typeof j.apiCallsToday === "number") setApiCallsToday(j.apiCallsToday);
            })
            .catch(() => {});
        }}
      />
    </div>
  );
}


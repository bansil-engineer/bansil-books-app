"use client";

// ============================================================
// Bansil Books Analytics — Customer Material Control View
// FOR SITE ENGINEER / SITE IN-CHARGE
// Pure Local SQLite · Zero Zoho API Calls on view/filter/click
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from "react";
import type {
  CustomerMaterialControlReport,
  CustomerMaterialControlItem,
  SiteActionStatus,
  BalancePurchaseEvidenceLine,
  ShortfallSalesEvidenceLine,
  AllPendingCustomersSummary,
  PendingCustomerMeta,
} from "@/app/lib/customer-material-control-engine";
import { formatINR, formatQuantity, formatDisplayDate } from "@/app/lib/date-utils";
import { LocalDocumentDrawer } from "./LocalDocumentDrawer";
import { VendorDetailDrawer } from "./VendorDetailDrawer";
import { ItemDetailDrawer } from "./ItemDetailDrawer";
import { DateDetailDrawer } from "./DateDetailDrawer";
import { ExportFieldSelector } from "./ExportFieldSelector";
import type { ExportOptions } from "@/app/types/reconciliation";

interface CustomerMaterialControlViewProps {
  initialCustomerId?: string;
  initialCustomerName?: string;
  financialYear?: string;
  onNavigateToCustomerDetails?: (customerId: string, customerName?: string) => void;
  onNavigateToActionTaken?: () => void;
}

export function CustomerMaterialControlView({
  initialCustomerId = "",
  initialCustomerName = "",
  financialYear = "2026-27",
  onNavigateToCustomerDetails,
  onNavigateToActionTaken,
}: CustomerMaterialControlViewProps) {
  const [customerId, setCustomerId] = useState<string>(initialCustomerId);
  const [customerName, setCustomerName] = useState<string>(initialCustomerName);
  const [customerList, setCustomerList] = useState<Array<{ id: string; name: string }>>([]);

  const [period, setPeriod] = useState<string>("CURRENT_FY");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const [actionFilter, setActionFilter] = useState<string>("ACTION_REQUIRED"); // "ACTION_REQUIRED", "ALL", "BALANCE_TO_INVOICE", "SHORTFALL_TO_PURCHASE", "RECONCILED"
  const [showReconciled, setShowReconciled] = useState<boolean>(false);
  const [itemSearch, setItemSearch] = useState<string>("");
  const [vendorFilter, setVendorFilter] = useState<string>("");
  const [actionStatusFilter, setActionStatusFilter] = useState<string>("ALL");

  const [reportData, setReportData] = useState<CustomerMaterialControlReport | null>(null);
  const [pendingSummaryData, setPendingSummaryData] = useState<AllPendingCustomersSummary | null>(null);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
  const [pendingSearch, setPendingSearch] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Drawers State
  const [selectedBalanceItem, setSelectedBalanceItem] = useState<CustomerMaterialControlItem | null>(null);
  const [selectedShortfallItem, setSelectedShortfallItem] = useState<CustomerMaterialControlItem | null>(null);
  const [selectedItemForLedger, setSelectedItemForLedger] = useState<string | null>(null);

  // Linked Document Drawers
  const [selectedDoc, setSelectedDoc] = useState<{ type: "bill" | "invoice"; docId: string } | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Site Action Edit Modal State
  const [editingActionItem, setEditingActionItem] = useState<CustomerMaterialControlItem | null>(null);
  const [siteRemark, setSiteRemark] = useState<string>("");
  const [actionRequired, setActionRequired] = useState<string>("");
  const [responsiblePerson, setResponsiblePerson] = useState<string>("");
  const [targetDate, setTargetDate] = useState<string>("");
  const [actionStatus, setActionStatus] = useState<SiteActionStatus>("OPEN");
  const [savingAction, setSavingAction] = useState<boolean>(false);

  // Export State
  const [downloadingExcel, setDownloadingExcel] = useState<boolean>(false);
  const [downloadingPdf, setDownloadingPdf] = useState<boolean>(false);

  // Bulk Mismatch Scan State
  const [scanningMismatches, setScanningMismatches] = useState<boolean>(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [activeScanTab, setActiveScanTab] = useState<string>("item-wise");
  const [scanItemFilter, setScanItemFilter] = useState<"ALL" | "TECHNICAL" | "QUANTITY_ONLY" | "FULLY_COVERED">("ALL");

  // V2 Drill-down Modals
  const [selectedValuation, setSelectedValuation] = useState<{ type: "SHORTFALL" | "BALANCE", customerId: string, customerName: string, qty: number, rate: number, total: number, itemName: string, itemId: string, rateSource: string, period: string } | null>(null);
  const [selectedExplanation, setSelectedExplanation] = useState<{ type: "EVIDENCE" | "MATCH", title: string, content: string } | null>(null);
  const [selectedGroupEvidence, setSelectedGroupEvidence] = useState<any | null>(null);
  const [selectedAlertEvidence, setSelectedAlertEvidence] = useState<{ title: string, content: string, itemDetailId?: string, evidence?: any[] } | null>(null);

  // 1. Fetch Customer List
  useEffect(() => {
    async function loadCustomers() {
      try {
        const res = await fetch("/api/customer-details?listOnly=true");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.customers)) {
            setCustomerList(data.customers);
            if (!customerId && data.customers.length > 0) {
              setCustomerId(data.customers[0].id);
              setCustomerName(data.customers[0].name);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load customer list:", err);
      }
    }
    loadCustomers();
  }, [customerId]);

  // 2. Fetch Customer Material Control Report
  const loadReport = useCallback(async () => {
    if (!customerId && !customerName) return;
    setLoading(true);
    setError(null);

    if (customerId === "ALL_PENDING") {
      try {
        const params = new URLSearchParams({
          pendingSummary: "true",
          financialYear,
          period,
        });
        if (fromDate) params.set("fromDate", fromDate);
        if (toDate) params.set("toDate", toDate);

        const res = await fetch(`/api/reports/customer-material-control?${params.toString()}`);
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `Failed to fetch pending customers (HTTP ${res.status})`);
        }
        const data: AllPendingCustomersSummary = await res.json();
        setPendingSummaryData(data);
        setReportData(null);
        setSelectedCustomerIds(new Set(data.customers.map((c) => c.customer_id)));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error loading pending customers";
        setError(msg);
        setPendingSummaryData(null);
      } finally {
        setLoading(false);
      }
      return;
    }

    setPendingSummaryData(null);
    try {
      const params = new URLSearchParams({
        customerId: customerId || "",
        customerName: customerName || "",
        financialYear,
        period,
        statusFilter: actionFilter,
        showReconciled: String(showReconciled),
      });
      if (fromDate) params.set("fromDate", fromDate);
      if (toDate) params.set("toDate", toDate);
      if (itemSearch) params.set("itemSearch", itemSearch);
      if (vendorFilter) params.set("vendorFilter", vendorFilter);
      if (actionStatusFilter !== "ALL") params.set("actionStatus", actionStatusFilter);

      const res = await fetch(`/api/reports/customer-material-control?${params.toString()}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Failed to fetch report (HTTP ${res.status})`);
      }
      const data = await res.json();
      setReportData(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error loading report";
      setError(msg);
      setReportData(null);
    } finally {
      setLoading(false);
    }
  }, [customerId, customerName, financialYear, period, actionFilter, showReconciled, fromDate, toDate, itemSearch, vendorFilter, actionStatusFilter]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  // 3. Save Site Action
  const handleSaveAction = async () => {
    if (!editingActionItem || !customerId) return;
    setSavingAction(true);
    try {
      const res = await fetch("/api/reports/customer-material-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          itemId: editingActionItem.item_id,
          siteRemark,
          actionRequired,
          responsiblePerson,
          targetDate,
          actionStatus,
        }),
      });
      if (res.ok) {
        setEditingActionItem(null);
        await loadReport();
      } else {
        alert("Failed to save site action");
      }
    } catch (err) {
      console.error("Failed to save site action:", err);
      alert("Error saving site action");
    } finally {
      setSavingAction(false);
    }
  };

  // 4. Unified Export with Field Selection
  const [showExportModal, setShowExportModal] = useState(false);

  const handleExecuteExport = async (options: ExportOptions) => {
    if (!customerId) return;
    const format = options.format || "excel";
    const isExcel = format === "excel";
    if (isExcel) setDownloadingExcel(true);
    else setDownloadingPdf(true);

    try {
      if (customerId === "ALL_PENDING") {
        const ids = Array.from(selectedCustomerIds);
        if (ids.length === 0) {
          alert("Please select at least one pending customer to export.");
          return;
        }
        const params = new URLSearchParams({
          reportType: "all-pending-customer-material",
          financialYear,
          period,
          customerIds: ids.join(","),
        });
        if (fromDate) params.set("fromDate", fromDate);
        if (toDate) params.set("toDate", toDate);
        if (options.selectedFields && options.selectedFields.length > 0) {
          params.set("selectedFields", options.selectedFields.join(","));
        }
        if (typeof options.includeTotals === "boolean") {
          params.set("includeTotals", String(options.includeTotals));
        }

        const endpoint = isExcel ? "/api/export/excel" : "/api/export/pdf";
        const res = await fetch(`${endpoint}?${params.toString()}`);
        if (!res.ok) throw new Error(`${format.toUpperCase()} export failed`);
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Customer_Material_Control_ALL_PENDING_${financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.${isExcel ? "xlsx" : "pdf"}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        return;
      }

      const params = new URLSearchParams({
        reportType: "customer-material-control",
        customerId,
        customerName,
        financialYear,
        period,
        statusFilter: actionFilter,
        showReconciled: String(showReconciled),
      });
      if (fromDate) params.set("fromDate", fromDate);
      if (toDate) params.set("toDate", toDate);
      if (itemSearch) params.set("search", itemSearch);
      if (vendorFilter) params.set("vendorFilter", vendorFilter);
      if (actionStatusFilter !== "ALL") params.set("actionStatus", actionStatusFilter);
      if (options.selectedFields && options.selectedFields.length > 0) {
        params.set("selectedFields", options.selectedFields.join(","));
      }
      if (typeof options.includeTotals === "boolean") {
        params.set("includeTotals", String(options.includeTotals));
      }

      const endpoint = isExcel ? "/api/export/excel" : "/api/export/pdf";
      const res = await fetch(`${endpoint}?${params.toString()}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `${format.toUpperCase()} export failed`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Customer_Material_Control_${customerName.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().slice(0, 10)}.${isExcel ? "xlsx" : "pdf"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("Error generating export: " + err.message);
    } finally {
      setDownloadingExcel(false);
      setDownloadingPdf(false);
      setShowExportModal(false);
    }
  };

  const handleScanMismatches = async () => {
    setScanningMismatches(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/audit/mismatch-resolution/v2/bulk-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerId === "ALL_PENDING" ? undefined : customerId,
          period,
          financialYear,
          fromDate,
          toDate
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setScanResult({ success: false, error: data.error || "Failed to scan mismatches" });
      } else {
        setScanResult(data);
      }
    } catch (err: any) {
      setScanResult({ success: false, error: err.message || "Unknown error occurred" });
    } finally {
      setScanningMismatches(false);
    }
  };

  const handleDecision = async (groupId: string, action: string, evidenceFingerprint: string, sourceItemId: string, targetType: string) => {
    if (!customerId) return;
    try {
      const res = await fetch("/api/audit/mismatch-resolution/v2/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: "v2",
          groupId,
          action,
          evidenceFingerprint,
          targetType,
          customerId,
          periodLabel: period,
          sourceItemId
        }),
      });
      if (res.ok) {
        // Just refresh the scan
        await handleScanMismatches();
        setSelectedGroupEvidence(null);
      } else {
        const err = await res.json();
        alert("Decision failed: " + (err.error || "Unknown error"));
      }
    } catch (err: any) {
      alert("Decision error: " + err.message);
    }
  };

  // ============================================================
  const summary = reportData?.summary;
  const items = reportData?.items || [];

  return (
    <div style={{ padding: 24, maxWidth: 1600, margin: "0 auto" }}>
      {/* Header Banner */}
      <div
        style={{
          background: "#ffffff",
          padding: "20px 24px",
          borderRadius: 8,
          border: "1px solid #e2e8f0",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          marginBottom: 20,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 24 }}>🏗️</span>
            <div>
              <h1 style={{ fontSize: 19, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                CUSTOMER MATERIAL CONTROL REPORT
              </h1>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                Site Material Statement for Site Engineer / Site In-charge · Pure Local SQLite
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {onNavigateToCustomerDetails && customerId && (
            <button
              onClick={() => onNavigateToCustomerDetails(customerId, customerName)}
              className="btn btn-sm"
              style={{ background: "#f8fafc", color: "#0f766e", border: "1px solid #cbd5e1", fontSize: 12 }}
            >
              ← Customer 360
            </button>
          )}

          <button
            onClick={() => setShowExportModal(true)}
            disabled={
              downloadingExcel ||
              downloadingPdf ||
              (customerId === "ALL_PENDING"
                ? !pendingSummaryData || selectedCustomerIds.size === 0
                : !reportData)
            }
            className="btn btn-sm"
            style={{
              background: "#0f766e",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {downloadingExcel || downloadingPdf
              ? "Generating Export..."
              : customerId === "ALL_PENDING"
              ? `📥 Export Pending Material (${selectedCustomerIds.size})...`
              : "📥 Export Site Material (Excel / PDF)..."}
          </button>

          <button
            onClick={handleScanMismatches}
            disabled={scanningMismatches || (customerId !== "ALL_PENDING" && !reportData)}
            className="btn btn-sm"
            style={{
              background: "#1e3a8a",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {scanningMismatches ? "Scanning..." : "🔍 Scan All Mismatches"}
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div
        style={{
          background: "#ffffff",
          padding: 16,
          borderRadius: 8,
          border: "1px solid #e2e8f0",
          marginBottom: 20,
          display: "flex",
          gap: 16,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        {/* Customer Selector */}
        <div style={{ flex: "1 1 280px" }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: 4 }}>
            Customer (Required)
          </label>
          <select
            value={customerId}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "ALL_PENDING") {
                setCustomerId("ALL_PENDING");
                setCustomerName("ALL PENDING CUSTOMERS");
                return;
              }
              const found = customerList.find((c) => c.id === val || c.name === val);
              setCustomerId(val);
              setCustomerName(found ? found.name : val);
            }}
            className="filter-select"
            style={{ width: "100%", padding: "8px 12px", fontSize: 13, fontWeight: 600, borderColor: customerId === "ALL_PENDING" ? "#b91c1c" : "#0f766e" }}
          >
            <option value="">— Select Customer —</option>
            <option value="ALL_PENDING" style={{ fontWeight: 700, color: "#b91c1c" }}>
              ⚡ ALL PENDING CUSTOMERS
            </option>
            {customerList.map((c) => (
              <option key={c.id || c.name} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Period Selector */}
        <div style={{ flex: "0 1 180px" }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: 4 }}>
            Period
          </label>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="filter-select"
            style={{ width: "100%", padding: "8px 12px", fontSize: 13 }}
          >
            <option value="CURRENT_FY">Current FY (2026-27)</option>
            <option value="PREVIOUS_FY">Previous FY (2025-26)</option>
            <option value="ALL">All Periods (Full History)</option>
            <option value="CUSTOM">Custom Date Range</option>
          </select>
        </div>

        {/* Custom Range */}
        {period === "CUSTOM" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 2 }}>From</label>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="filter-input" style={{ padding: "6px 8px", fontSize: 12 }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 2 }}>To</label>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="filter-input" style={{ padding: "6px 8px", fontSize: 12 }} />
            </div>
          </div>
        )}

        {/* Search / Filters */}
        {customerId === "ALL_PENDING" ? (
          <div style={{ flex: "1 1 300px" }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: 4 }}>
              Search Pending Customers
            </label>
            <input
              type="text"
              value={pendingSearch}
              onChange={(e) => setPendingSearch(e.target.value)}
              placeholder="Filter pending customers by name..."
              className="filter-input"
              style={{ width: "100%", padding: "8px 12px", fontSize: 13 }}
            />
          </div>
        ) : (
          <>
            {/* Item Search */}
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: 4 }}>
                Item Search
              </label>
              <input
                type="text"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Filter by item or SKU..."
                className="filter-input"
                style={{ width: "100%", padding: "8px 12px", fontSize: 13 }}
              />
            </div>

            {/* Action Status Filter */}
            <div style={{ flex: "0 1 180px" }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: 4 }}>
                Site Action Status
              </label>
              <select
                value={actionStatusFilter}
                onChange={(e) => setActionStatusFilter(e.target.value)}
                className="filter-select"
                style={{ width: "100%", padding: "8px 12px", fontSize: 13 }}
              >
                <option value="ALL">All Action Statuses</option>
                <option value="OPEN">OPEN</option>
                <option value="MATERIAL TO PURCHASE">MATERIAL TO PURCHASE</option>
                <option value="MATERIAL TO INVOICE">MATERIAL TO INVOICE</option>
                <option value="WAITING FOR SITE CONFIRMATION">WAITING FOR SITE CONFIRMATION</option>
                <option value="WAITING FOR VENDOR">WAITING FOR VENDOR</option>
                <option value="CLOSED">CLOSED</option>
              </select>
            </div>
          </>
        )}
      </div>

      {/* Action Filter Pills Bar (Only for Single Customer) */}
      {customerId !== "ALL_PENDING" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <button
            onClick={() => setActionFilter("ACTION_REQUIRED")}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 700,
              border: "1px solid",
              borderColor: actionFilter === "ACTION_REQUIRED" ? "#0f766e" : "#cbd5e1",
              background: actionFilter === "ACTION_REQUIRED" ? "#0f766e" : "#ffffff",
              color: actionFilter === "ACTION_REQUIRED" ? "#ffffff" : "#475569",
              cursor: "pointer",
            }}
          >
            ⚡ ACTION REQUIRED (Default)
          </button>

          <button
            onClick={() => setActionFilter("ALL")}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 600,
              border: "1px solid",
              borderColor: actionFilter === "ALL" ? "#0f766e" : "#cbd5e1",
              background: actionFilter === "ALL" ? "#0f766e" : "#ffffff",
              color: actionFilter === "ALL" ? "#ffffff" : "#475569",
              cursor: "pointer",
            }}
          >
            All Items
          </button>

          <button
            onClick={() => setActionFilter("BALANCE_TO_INVOICE")}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 600,
              border: "1px solid",
              borderColor: actionFilter === "BALANCE_TO_INVOICE" ? "#c2410c" : "#cbd5e1",
              background: actionFilter === "BALANCE_TO_INVOICE" ? "#fff7ed" : "#ffffff",
              color: actionFilter === "BALANCE_TO_INVOICE" ? "#c2410c" : "#475569",
              cursor: "pointer",
            }}
          >
            📦 Balance to Invoice
          </button>

          <button
            onClick={() => setActionFilter("SHORTFALL_TO_PURCHASE")}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 600,
              border: "1px solid",
              borderColor: actionFilter === "SHORTFALL_TO_PURCHASE" ? "#dc2626" : "#cbd5e1",
              background: actionFilter === "SHORTFALL_TO_PURCHASE" ? "#fef2f2" : "#ffffff",
              color: actionFilter === "SHORTFALL_TO_PURCHASE" ? "#dc2626" : "#475569",
              cursor: "pointer",
            }}
          >
            ⚠️ Shortfall to Purchase
          </button>

          <button
            onClick={() => setActionFilter("RECONCILED")}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 600,
              border: "1px solid",
              borderColor: actionFilter === "RECONCILED" ? "#16a34a" : "#cbd5e1",
              background: actionFilter === "RECONCILED" ? "#f0fdf4" : "#ffffff",
              color: actionFilter === "RECONCILED" ? "#16a34a" : "#475569",
              cursor: "pointer",
            }}
          >
            ✓ Reconciled
          </button>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 12, color: "#475569", fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={showReconciled}
                onChange={(e) => setShowReconciled(e.target.checked)}
              />
              Show Reconciled Items
            </label>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          INLINE MISMATCH SCAN RESULT
      ───────────────────────────────────────────────────────────── */}
      {scanResult && (
        <div style={{
          backgroundColor: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "8px",
          marginBottom: "24px",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
          overflow: "hidden"
        }}>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#f8fafc" }}>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#0f172a" }}>INVENTORY MISMATCH RECOMMENDATION REPORT</h2>
            <button onClick={() => setScanResult(null)} style={{ background: "none", border: "none", fontSize: "24px", cursor: "pointer", color: "#64748b", lineHeight: 1 }}>×</button>
          </div>
          
          {scanResult.success && (
            <div style={{ padding: "16px 24px", backgroundColor: "#ffffff" }}>
              <div style={{ marginBottom: 16, fontSize: 13, color: "#475569" }}>
                <strong>Scope:</strong> {customerId === "ALL_PENDING" ? "All Pending Customers" : customerName} | <strong>Period:</strong> {period === "CUSTOM" ? `${fromDate} to ${toDate}` : period}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 20 }}>
                <div 
                  onClick={() => { setActiveScanTab("item-wise"); setScanItemFilter("ALL"); }}
                  style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 6, backgroundColor: "#f8fafc", cursor: "pointer" }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#e2e8f0"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#f8fafc"}
                >
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Mismatch Items</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>{scanResult.suggestions?.length || 0}</div>
                </div>
                <div 
                  onClick={() => { setActiveScanTab("item-wise"); setScanItemFilter("TECHNICAL"); }}
                  style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 6, backgroundColor: "#f8fafc", cursor: "pointer" }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#e2e8f0"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#f8fafc"}
                >
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Technical Relationships</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
                    {scanResult.suggestions?.reduce((acc: number, s: any) => acc + (s.groups?.filter((g: any) => !g.reasons?.includes("QUANTITY_ONLY_POSSIBILITY")).length || 0), 0) || 0}
                  </div>
                </div>
                <div 
                  onClick={() => { setActiveScanTab("item-wise"); setScanItemFilter("QUANTITY_ONLY"); }}
                  style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 6, backgroundColor: "#f8fafc", cursor: "pointer" }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#e2e8f0"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#f8fafc"}
                >
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Quantity-Only Possibilities</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
                    {scanResult.suggestions?.reduce((acc: number, s: any) => acc + (s.groups?.filter((g: any) => g.reasons?.includes("QUANTITY_ONLY_POSSIBILITY")).length || 0), 0) || 0}
                  </div>
                </div>
                <div 
                  onClick={() => { setActiveScanTab("item-wise"); setScanItemFilter("FULLY_COVERED"); }}
                  style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 6, backgroundColor: "#f8fafc", cursor: "pointer" }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#e2e8f0"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#f8fafc"}
                >
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Fully Quantity-Covered</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>{scanResult.suggestions?.filter((s: any) => s.groups?.some((g: any) => g.residualQty === 0)).length || 0}</div>
                </div>
                <div 
                  onClick={() => { setActiveScanTab("unresolved"); }}
                  style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 6, backgroundColor: "#f8fafc", cursor: "pointer" }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#e2e8f0"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#f8fafc"}
                >
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Quantity-Unresolved Items</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>{scanResult.suggestions?.filter((s: any) => !s.groups || s.groups.length === 0).length || 0}</div>
                </div>
                <div 
                  onClick={() => { setActiveScanTab("item-wise"); setScanItemFilter("ALL"); }}
                  style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 6, backgroundColor: "#f8fafc", cursor: "pointer" }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#e2e8f0"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#f8fafc"}
                >
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Total Rendered Possibilities</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>{scanResult.suggestions?.reduce((acc: number, s: any) => acc + (s.groups?.length || 0), 0) || 0}</div>
                </div>
              </div>
            </div>
          )}

          {scanResult.success && (
            <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", padding: "0 24px", backgroundColor: "#f8fafc", overflowX: "auto" }}>
              {["Item-wise", "Customer-wise", "Amount-wise", "Cross Billing", "Item Selection", "Unresolved"].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveScanTab(tab.toLowerCase())}
                  style={{
                    padding: "12px 16px",
                    background: "none",
                    border: "none",
                    borderBottom: activeScanTab === tab.toLowerCase() ? "2px solid #0f766e" : "2px solid transparent",
                    color: activeScanTab === tab.toLowerCase() ? "#0f766e" : "#64748b",
                    fontWeight: activeScanTab === tab.toLowerCase() ? 600 : 400,
                    cursor: "pointer",
                    whiteSpace: "nowrap"
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}
          <div style={{ padding: "24px", backgroundColor: "#ffffff" }}>
            {scanResult.success ? (
              <div>
                {activeScanTab === "item-wise" && (() => {
                  const filteredSuggestions = (scanResult.suggestions || []).map((sug: any) => {
                    let filteredGroups = sug.groups || [];
                    if (scanItemFilter === "TECHNICAL") {
                      filteredGroups = filteredGroups.filter((g: any) => !g.reasons?.includes("QUANTITY_ONLY_POSSIBILITY"));
                    } else if (scanItemFilter === "QUANTITY_ONLY") {
                      filteredGroups = filteredGroups.filter((g: any) => g.reasons?.includes("QUANTITY_ONLY_POSSIBILITY"));
                    } else if (scanItemFilter === "FULLY_COVERED") {
                      filteredGroups = filteredGroups.filter((g: any) => g.residualQty === 0);
                    }
                    return { ...sug, groups: filteredGroups };
                  }).filter((sug: any) => {
                    if (scanItemFilter === "TECHNICAL") return sug.groups.length > 0;
                    if (scanItemFilter === "QUANTITY_ONLY") return sug.groups.length > 0;
                    if (scanItemFilter === "FULLY_COVERED") return sug.groups.length > 0;
                    return true;
                  });

                  return filteredSuggestions.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      {filteredSuggestions.map((sug: any, idx: number) => {
                        const sourceItem = sug.sourceItem;
                        const groups = sug.groups || [];
                        const residualQty = sug.unresolvedQty;
                        
                        return (
                          <div key={idx} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, backgroundColor: "#f8fafc" }}>
                            <div style={{ fontWeight: 600, marginBottom: 8, color: "#0f172a", fontSize: 15 }}>
                              Customer: {sourceItem.customerName}
                            </div>
                            <div 
                              style={{ fontWeight: 600, marginBottom: 8, color: "#0369a1", fontSize: 15, cursor: "pointer", textDecoration: "underline" }}
                              onClick={() => setSelectedItemForLedger(sourceItem.itemId)}
                            >
                              Source Item: {sourceItem.itemName || "Unknown Item"}
                            </div>
                            <div 
                              style={{ fontSize: 13, color: "#0369a1", marginBottom: 4, cursor: "pointer", textDecoration: "underline" }}
                              onClick={() => setSelectedItemForLedger(sourceItem.itemId)}
                            >
                              Item ID: {sourceItem.itemId} {sourceItem.sku ? `| SKU: ${sourceItem.sku}` : ""}
                            </div>
                            <div style={{ fontSize: 14, color: "#475569", marginBottom: 12 }}>
                              Mismatch Qty: <span style={{ fontWeight: 600, color: "#b91c1c" }}>{sourceItem.mismatchQty}</span>
                            </div>
                            
                            <div style={{ fontWeight: 600, fontSize: 14, color: "#334155", marginBottom: 8, borderTop: "1px solid #cbd5e1", paddingTop: 12 }}>
                              Possible Relationships / Candidates:
                            </div>
                            {groups.length > 0 ? (
                              <ul style={{ margin: 0, paddingLeft: 24, fontSize: 14 }}>
                                {groups.map((g: any, cidx: number) => {
                                  const isQtyOnly = g.reasons?.includes("QUANTITY_ONLY_POSSIBILITY");
                                  return (
                                  <li key={cidx} style={{ color: isQtyOnly ? "#475569" : "#0f766e", marginBottom: 12 }}>
                                    <span 
                                      style={{ fontWeight: 500, cursor: "pointer", textDecoration: "underline" }}
                                      onClick={() => setSelectedGroupEvidence({ ...g, sourceItemId: sug.sourceItem.itemId, targetType: g.targetType || (g.reasons?.includes("QUANTITY_ONLY_POSSIBILITY") ? "QUANTITY_ONLY_POSSIBILITY" : "TECHNICAL_RELATIONSHIP") })}
                                    >
                                      {isQtyOnly ? `Possibility QP-${cidx + 1}` : `Group ${g.groupId}`}
                                    </span> (Coverage Qty: {g.coverageQty})
                                    <ul style={{ paddingLeft: 16, marginTop: 4, listStyleType: "circle" }}>
                                      {g.candidates.map((c: any, i: number) => (
                                        <li 
                                          key={i} 
                                          style={{ color: "#0369a1", fontSize: 13, cursor: "pointer", textDecoration: "underline" }}
                                          onClick={() => setSelectedItemForLedger(c.itemId)}
                                        >
                                          {c.itemName} (ID: {c.itemId}) - Avail Qty: {c.availableQty}
                                        </li>
                                      ))}
                                    </ul>
                                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                                      <span>Confidence: <strong>{g.confidence}</strong></span>
                                      {g.reviewerDecision && (
                                        <span style={{ 
                                          padding: "2px 6px", 
                                          borderRadius: 4, 
                                          fontSize: 10, 
                                          fontWeight: 700, 
                                          background: g.reviewerDecision.isStale ? "#fef08a" : (g.reviewerDecision.status === "APPROVE" ? "#bbf7d0" : "#e2e8f0"),
                                          color: g.reviewerDecision.isStale ? "#854d0e" : (g.reviewerDecision.status === "APPROVE" ? "#166534" : "#475569")
                                        }}>
                                          {g.reviewerDecision.isStale ? "STALE: " : ""}{g.reviewerDecision.status}
                                        </span>
                                      )}
                                    </div>
                                    {g.reasons && g.reasons.length > 0 && (
                                      <div style={{ fontSize: 12, color: "#059669", marginTop: 2 }}>
                                        Evidence: {g.reasons.join(", ")}
                                      </div>
                                    )}
                                    {g.warnings && g.warnings.length > 0 && (
                                      <div style={{ fontSize: 12, color: "#d97706", marginTop: 2 }}>
                                        Warnings: {g.warnings.join(", ")}
                                      </div>
                                    )}
                                  </li>
                                )})}
                              </ul>
                            ) : (
                              <div style={{ fontSize: 13, color: "#64748b", fontStyle: "italic", marginBottom: 8 }}>No specific candidates identified.</div>
                            )}
                            
                            <div style={{ marginTop: 12, fontSize: 13, color: residualQty > 0 ? "#b45309" : "#15803d", fontWeight: 500 }}>
                              Unresolved Residual: {residualQty > 0 ? residualQty : 0}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ padding: 32, textAlign: "center", color: "#64748b", backgroundColor: "#f8fafc", borderRadius: 6, border: "1px dashed #cbd5e1" }}>
                      No actionable mismatch suggestions found for the current scope and filter.
                    </div>
                  );
                })()}

                {activeScanTab === "customer-wise" && (
                  <div style={{ padding: 16, backgroundColor: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0", overflowX: "auto" }}>
                    <h3 style={{ marginTop: 0 }}>Customer-wise Summary</h3>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ backgroundColor: "#e2e8f0", textAlign: "left" }}>
                          <th style={{ padding: "8px" }}>Customer</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Mismatch Items</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Technical Relationships</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Quantity-Only Possibilities</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Candidate Groups</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Fully Quantity-Covered</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Quantity-Unresolved Items</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Shortfall Valuation</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Balance-to-Invoice Valuation</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Amount Evidence</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Amount Without Verified Match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const custMap = new Map<string, any>();
                          scanResult.suggestions?.forEach((s: any) => {
                            const cid = s.sourceItem.customerId;
                            if (!custMap.has(cid)) {
                              custMap.set(cid, {
                                customerId: cid,
                                customerName: s.sourceItem.customerName,
                                mismatchItems: 0,
                                techRelationships: 0,
                                quantityOnly: 0,
                                candidateGroups: 0,
                                fullyCovered: 0,
                                unresolvedItems: 0,
                                shortfallValuation: 0,
                                balanceValuation: 0,
                                amountEvidenceStatus: "UNKNOWN",
                                amountWithoutVerifiedMatch: "UNKNOWN"
                              });
                            }
                            const row = custMap.get(cid);
                            row.mismatchItems += 1;
                            
                            const val = s.sourceItem.taxableValue || 0;
                            if (s.sourceItem.mismatchQty < 0) {
                              row.shortfallValuation += val;
                            } else {
                              row.balanceValuation += val;
                            }

                            if (!s.groups || s.groups.length === 0) {
                              row.unresolvedItems += 1;
                            } else {
                              let techIndiv = 0;
                              let techGroup = 0;
                              let qtyOnly = 0;
                              let fullyCoveredFound = false;

                              s.groups.forEach((g: any) => {
                                if (g.reasons?.includes("QUANTITY_ONLY_POSSIBILITY")) {
                                  qtyOnly++;
                                } else {
                                  if (g.candidates.length === 1) techIndiv++;
                                  else techGroup++;
                                }
                                if (g.residualQty === 0) fullyCoveredFound = true;
                              });

                              row.techRelationships += techIndiv + techGroup;
                              row.quantityOnly += qtyOnly;
                              row.candidateGroups += techGroup;
                              if (fullyCoveredFound) row.fullyCovered += 1;
                            }
                          });
                          return Array.from(custMap.values()).map((row, idx) => (
                            <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                              <td style={{ padding: "8px" }}>{row.customerName}</td>
                              <td style={{ padding: "8px", textAlign: "right" }}>
                                <button 
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#0369a1", textDecoration: "underline", fontSize: "inherit", fontFamily: "inherit" }}
                                  onClick={() => { setActiveScanTab("item-wise"); setScanItemFilter("ALL"); }}
                                >{row.mismatchItems}</button>
                              </td>
                              <td style={{ padding: "8px", textAlign: "right" }}>
                                <button 
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#0369a1", textDecoration: "underline", fontSize: "inherit", fontFamily: "inherit" }}
                                  onClick={() => { setActiveScanTab("item-wise"); setScanItemFilter("TECHNICAL"); }}
                                >{row.techRelationships}</button>
                              </td>
                              <td style={{ padding: "8px", textAlign: "right" }}>
                                <button 
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#0369a1", textDecoration: "underline", fontSize: "inherit", fontFamily: "inherit" }}
                                  onClick={() => { setActiveScanTab("item-wise"); setScanItemFilter("QUANTITY_ONLY"); }}
                                >{row.quantityOnly}</button>
                              </td>
                              <td style={{ padding: "8px", textAlign: "right" }}>
                                <button 
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#0369a1", textDecoration: "underline", fontSize: "inherit", fontFamily: "inherit" }}
                                  onClick={() => { setActiveScanTab("item-wise"); setScanItemFilter("TECHNICAL"); }}
                                >{row.candidateGroups}</button>
                              </td>
                              <td style={{ padding: "8px", textAlign: "right" }}>
                                <button 
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#0369a1", textDecoration: "underline", fontSize: "inherit", fontFamily: "inherit" }}
                                  onClick={() => { setActiveScanTab("item-wise"); setScanItemFilter("FULLY_COVERED"); }}
                                >{row.fullyCovered}</button>
                              </td>
                              <td style={{ padding: "8px", textAlign: "right" }}>
                                <button 
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#0369a1", textDecoration: "underline", fontSize: "inherit", fontFamily: "inherit" }}
                                  onClick={() => { setActiveScanTab("unresolved"); }}
                                >{row.unresolvedItems}</button>
                              </td>
                              <td style={{ padding: "8px", textAlign: "right" }}>
                                <button 
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#0369a1", textDecoration: "underline", fontSize: "inherit", fontFamily: "inherit" }}
                                  onClick={() => setSelectedValuation({ type: "SHORTFALL", customerId: row.customerId, customerName: row.customerName, qty: 0, rate: 0, total: 0, itemName: "", itemId: "", rateSource: "", period: period })}
                                >{formatINR(row.shortfallValuation)}</button>
                              </td>
                              <td style={{ padding: "8px", textAlign: "right" }}>
                                <button 
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#0369a1", textDecoration: "underline", fontSize: "inherit", fontFamily: "inherit" }}
                                  onClick={() => setSelectedValuation({ type: "BALANCE", customerId: row.customerId, customerName: row.customerName, qty: 0, rate: 0, total: 0, itemName: "", itemId: "", rateSource: "", period: period })}
                                >{formatINR(row.balanceValuation)}</button>
                              </td>
                              <td style={{ padding: "8px", textAlign: "right" }}>
                                <button 
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#0369a1", textDecoration: "underline", fontSize: "inherit", fontFamily: "inherit" }}
                                  onClick={() => setSelectedExplanation({ type: "EVIDENCE", title: "Amount Evidence Status", content: "Amount cannot currently be verified because the reference purchase/sales base amount is missing or cross-customer matches are unverified. ±10% tolerance was not evaluated." })}
                                >{row.amountEvidenceStatus}</button>
                              </td>
                              <td style={{ padding: "8px", textAlign: "right" }}>
                                <button 
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#0369a1", textDecoration: "underline", fontSize: "inherit", fontFamily: "inherit" }}
                                  onClick={() => setSelectedExplanation({ type: "MATCH", title: "Amount Without Verified Match", content: "Valuation cannot be safely calculated from verified evidence without an explicit accounting link." })}
                                >{row.amountWithoutVerifiedMatch}</button>
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}

                {activeScanTab === "amount-wise" && (
                  <div style={{ padding: 16, backgroundColor: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0", overflowX: "auto" }}>
                    <h3 style={{ marginTop: 0 }}>Amount-wise Summary</h3>
                    <div style={{ display: "flex", gap: "24px", marginBottom: "16px", fontSize: 13 }}>
                      <div>Purchase GST-Inclusive Amount: <strong style={{color:"#b91c1c"}}>UNKNOWN / NOT_AVAILABLE_FROM_VERIFIED_SOURCE</strong></div>
                      <div>Sales GST-Inclusive Amount: <strong style={{color:"#b91c1c"}}>UNKNOWN / NOT_AVAILABLE_FROM_VERIFIED_SOURCE</strong></div>
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ backgroundColor: "#e2e8f0", textAlign: "left" }}>
                          <th style={{ padding: "8px" }}>Customer</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Shortfall Qty</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Shortfall Valuation</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Balance Qty</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Balance-to-Invoice Valuation</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Comparable Amount Evidence</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Within ±10%</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Amount Evidence Status</th>
                          <th style={{ padding: "8px", textAlign: "right" }}>Amount Without Verified Match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const custMap = new Map<string, any>();
                          scanResult.suggestions?.forEach((s: any) => {
                            const cid = s.sourceItem.customerId;
                            if (!custMap.has(cid)) {
                              custMap.set(cid, {
                                customerId: cid,
                                customerName: s.sourceItem.customerName,
                                shortfallQty: 0,
                                shortfallValuation: 0,
                                balanceQty: 0,
                                balanceValuation: 0,
                              });
                            }
                            const row = custMap.get(cid);
                            const val = s.sourceItem.taxableValue || 0;
                            
                            if (s.sourceItem.mismatchQty < 0) {
                              row.shortfallQty += Math.abs(s.sourceItem.mismatchQty);
                              row.shortfallValuation += val;
                            } else {
                              row.balanceQty += s.sourceItem.mismatchQty;
                              row.balanceValuation += val;
                            }
                          });
                          return Array.from(custMap.values()).map((row, idx) => (
                            <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                              <td style={{ padding: "8px" }}>{row.customerName}</td>
                              <td style={{ padding: "8px", textAlign: "right" }}>{row.shortfallQty}</td>
                              <td style={{ padding: "8px", textAlign: "right" }}>
                                <button 
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#0369a1", textDecoration: "underline", fontSize: "inherit", fontFamily: "inherit" }}
                                  onClick={() => setSelectedValuation({ type: "SHORTFALL", customerId: row.customerId, customerName: row.customerName, qty: 0, rate: 0, total: 0, itemName: "", itemId: "", rateSource: "", period: period })}
                                >{formatINR(row.shortfallValuation)}</button>
                              </td>
                              <td style={{ padding: "8px", textAlign: "right" }}>{row.balanceQty}</td>
                              <td style={{ padding: "8px", textAlign: "right" }}>
                                <button 
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#0369a1", textDecoration: "underline", fontSize: "inherit", fontFamily: "inherit" }}
                                  onClick={() => setSelectedValuation({ type: "BALANCE", customerId: row.customerId, customerName: row.customerName, qty: 0, rate: 0, total: 0, itemName: "", itemId: "", rateSource: "", period: period })}
                                >{formatINR(row.balanceValuation)}</button>
                              </td>
                              <td style={{ padding: "8px", textAlign: "right" }}>UNKNOWN</td>
                              <td style={{ padding: "8px", textAlign: "right" }}>UNKNOWN</td>
                              <td style={{ padding: "8px", textAlign: "right" }}>
                                <button 
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#0369a1", textDecoration: "underline", fontSize: "inherit", fontFamily: "inherit" }}
                                  onClick={() => setSelectedExplanation({ type: "EVIDENCE", title: "Amount Evidence Status", content: "Amount cannot currently be verified because the reference purchase/sales base amount is missing or cross-customer matches are unverified. ±10% tolerance was not evaluated." })}
                                >UNKNOWN</button>
                              </td>
                              <td style={{ padding: "8px", textAlign: "right" }}>
                                <button 
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#0369a1", textDecoration: "underline", fontSize: "inherit", fontFamily: "inherit" }}
                                  onClick={() => setSelectedExplanation({ type: "MATCH", title: "Amount Without Verified Match", content: "Valuation cannot be safely calculated from verified evidence without an explicit accounting link." })}
                                >UNKNOWN</button>
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}

                {activeScanTab === "cross billing" && (
                  <div style={{ padding: 16, backgroundColor: "#fef2f2", borderRadius: 6, border: "1px solid #fecaca", color: "#991b1b" }}>
                    <h3 style={{ marginTop: 0, color: "#991b1b" }}>Cross Billing Alert</h3>
                    <p><strong>WARNING: CROSS-CUSTOMER QUANTITIES NOT RECONCILED</strong></p>
                    <p>Customer A positive inventory is NEVER used to reconcile or offset Customer B negative inventory.</p>
                    {scanResult.suggestions?.filter((s: any) => s.groups?.some((g: any) => g.warnings?.some((w: string) => w.includes("CROSS_CUSTOMER") || w.includes("cross")))).length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 24, fontSize: 14 }}>
                        {scanResult.suggestions?.filter((s: any) => s.groups?.some((g: any) => g.warnings?.some((w: string) => w.includes("CROSS_CUSTOMER") || w.includes("cross")))).map((s: any, idx: number) => (
                          <li key={idx} style={{ marginBottom: 12 }}>
                            <strong 
                              style={{ cursor: "pointer", textDecoration: "underline" }}
                              onClick={() => setSelectedAlertEvidence({ title: "Cross Billing Alert Evidence", content: `Customer firewall prevented matching for Item: ${s.sourceItem.itemName} (ID: ${s.sourceItem.itemId}). Candidate exists for another customer but was excluded to prevent cross-customer reconciliation.` })}
                            >{s.sourceItem.itemName}</strong> - Cross Billing detected
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No cross billing alerts detected for the current scope.</p>
                    )}
                  </div>
                )}

                {activeScanTab === "item selection" && (
                  <div style={{ padding: 16, backgroundColor: "#fffbeb", borderRadius: 6, border: "1px solid #fde68a", color: "#92400e" }}>
                    <h3 style={{ marginTop: 0, color: "#92400e" }}>Possible Item-Selection Mismatch</h3>
                    <p>Detected potential data-entry errors or alias issues. Review the suggestions with HIGH/MEDIUM confidence.</p>
                    {scanResult.suggestions?.filter((s: any) => s.groups?.some((g: any) => !g.reasons?.includes("QUANTITY_ONLY_POSSIBILITY") && (g.confidence === "HIGH" || g.confidence === "MEDIUM"))).length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 24, fontSize: 14 }}>
                        {scanResult.suggestions?.filter((s: any) => s.groups?.some((g: any) => !g.reasons?.includes("QUANTITY_ONLY_POSSIBILITY") && (g.confidence === "HIGH" || g.confidence === "MEDIUM"))).map((s: any, idx: number) => (
                          <li key={idx} style={{ marginBottom: 12 }}>
                            <strong 
                              style={{ cursor: "pointer", textDecoration: "underline" }}
                              onClick={() => setSelectedAlertEvidence({ title: "Item Selection Evidence", content: `Source Item: ${s.sourceItem.itemName} (ID: ${s.sourceItem.itemId}) has strong technical candidate groups suggesting a data-entry alias mismatch.` })}
                            >{s.sourceItem.itemName}</strong> - Review Technical Candidates
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No item selection anomalies detected for the current scope.</p>
                    )}
                  </div>
                )}

                {activeScanTab === "unresolved" && (
                  <div style={{ padding: 16, backgroundColor: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                    <h3 style={{ marginTop: 0 }}>Unresolved Report</h3>
                    <p>All items with no matching candidates remain <strong>quantity unresolved</strong>. (Note: This does not imply financial amount evidence is resolved)</p>
                    
                    {scanResult.suggestions?.filter((s:any) => !s.groups || s.groups.length === 0).length === 0 ? (
                      <p><strong>No quantity-unresolved items for this scope.</strong></p>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 24, fontSize: 14 }}>
                        {scanResult.suggestions?.filter((s:any) => !s.groups || s.groups.length === 0).map((s:any, idx:number) => (
                          <li key={idx}><strong>{s.sourceItem.itemName}</strong> (Qty: {s.unresolvedQty}) - Reason Still Unresolved: No eligible candidates.</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                
              </div>
            ) : (
              <div style={{ padding: 16, backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#991b1b" }}>
                <strong style={{ display: "block", marginBottom: 4 }}>Scan could not complete</strong>
                <p style={{ margin: 0 }}>{scanResult.error || "Unknown error occurred during mismatch scan."}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MAIN BODY: ALL PENDING CUSTOMERS vs SINGLE CUSTOMER
      ───────────────────────────────────────────────────────────── */}
      {customerId === "ALL_PENDING" ? (
        <div>
          {/* Customer Details Missing Warning Card */}
          {pendingSummaryData && pendingSummaryData.unmapped_purchase_lines_count > 0 && (
            <div
              style={{
                background: "#fffbeb",
                border: "1px solid #fde68a",
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <div>
                  <strong style={{ color: "#92400e", fontSize: 13 }}>
                    CUSTOMER DETAILS MISSING WARNING:
                  </strong>{" "}
                  <span style={{ fontSize: 13, color: "#b45309" }}>
                    <strong>{pendingSummaryData.unmapped_purchase_lines_count}</strong> unmapped purchase lines (Qty:{" "}
                    <strong>{pendingSummaryData.unmapped_purchase_qty}</strong>) exist without customer attribution and are excluded from customer statements.
                  </span>
                </div>
              </div>
              {onNavigateToActionTaken && (
                <button
                  onClick={onNavigateToActionTaken}
                  className="btn btn-sm"
                  style={{ background: "#ffffff", color: "#b45309", border: "1px solid #f59e0b", fontSize: 11, fontWeight: 700 }}
                >
                  View Customer Details Missing →
                </button>
              )}
            </div>
          )}

          {/* Pending Summary KPI Cards */}
          {pendingSummaryData && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                gap: 12,
                marginBottom: 20,
              }}
            >
              <div style={{ background: "#ffffff", padding: "12px 16px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>TOTAL PENDING CUSTOMERS</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
                  {pendingSummaryData.total_pending_customers}
                </div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                  Customers requiring site action
                </div>
              </div>

              <div style={{ background: "#f0fdf4", padding: "12px 16px", borderRadius: 8, border: "1px solid #bbf7d0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#166534" }}>SELECTED FOR EXPORT</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#166534", marginTop: 4 }}>
                  {selectedCustomerIds.size} / {pendingSummaryData.customers.length}
                </div>
                <div style={{ fontSize: 10, color: "#15803d", marginTop: 2 }}>
                  Selected for PDF / Excel generation
                </div>
              </div>

              <div style={{ background: "#fff7ed", padding: "12px 16px", borderRadius: 8, border: "1px solid #fed7aa" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#c2410c" }}>TOTAL BALANCE TO INVOICE</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#c2410c", marginTop: 4 }}>
                  {formatQuantity(pendingSummaryData.total_balance_material_to_invoice)}
                </div>
                <div style={{ fontSize: 10, color: "#9a3412", marginTop: 2 }}>
                  Across all pending customers
                </div>
              </div>

              <div style={{ background: "#fef2f2", padding: "12px 16px", borderRadius: 8, border: "1px solid #fecaca" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#dc2626" }}>TOTAL SHORTFALL TO PURCHASE</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#dc2626", marginTop: 4 }}>
                  {formatQuantity(pendingSummaryData.total_shortfall_material_to_purchase)}
                </div>
                <div style={{ fontSize: 10, color: "#991b1b", marginTop: 2 }}>
                  Across all pending customers
                </div>
              </div>

              <div style={{ background: "#fef2f2", padding: "12px 16px", borderRadius: 8, border: "1px solid #fecaca" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c" }}>APPROX. SHORTFALL REQUIREMENT</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#b91c1c", marginTop: 4 }}>
                  {formatINR(pendingSummaryData.total_approx_purchase_requirement_value)}
                </div>
                <div style={{ fontSize: 10, color: "#7f1d1d", marginTop: 2 }}>
                  Evaluated at latest actual purchase rates
                </div>
              </div>
            </div>
          )}

          {/* Table Action / Selection Bar */}
          <div
            style={{
              background: "#ffffff",
              padding: "12px 16px",
              borderRadius: "8px 8px 0 0",
              border: "1px solid #e2e8f0",
              borderBottom: "none",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  if (pendingSummaryData) {
                    setSelectedCustomerIds(new Set(pendingSummaryData.customers.map((c) => c.customer_id)));
                  }
                }}
                className="btn btn-sm"
                style={{ background: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1", fontSize: 11, fontWeight: 600 }}
              >
                Select All ({pendingSummaryData?.customers.length || 0})
              </button>
              <button
                onClick={() => setSelectedCustomerIds(new Set())}
                className="btn btn-sm"
                style={{ background: "#f1f5f9", color: "#64748b", border: "1px solid #cbd5e1", fontSize: 11 }}
              >
                Clear Selection
              </button>
              <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                {selectedCustomerIds.size} of {pendingSummaryData?.customers.length || 0} customers selected for export
              </span>
            </div>

            <div style={{ fontSize: 11, color: "#64748b" }}>
              Sorted by: Shortfall Requirement Value (DESC) → Balance Qty (DESC) → Customer Name
            </div>
          </div>

          {/* Pending Customers Table */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "0 0 8px 8px",
              border: "1px solid #e2e8f0",
              overflow: "hidden",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 380px)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#1e3a5f", color: "#ffffff", textAlign: "left", position: "sticky", top: 0, zIndex: 10 }}>
                    <th style={{ padding: "10px 10px", width: 40, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={
                          Boolean(
                            pendingSummaryData &&
                            pendingSummaryData.customers.length > 0 &&
                            selectedCustomerIds.size === pendingSummaryData.customers.length
                          )
                        }
                        onChange={(e) => {
                          if (e.target.checked && pendingSummaryData) {
                            setSelectedCustomerIds(new Set(pendingSummaryData.customers.map((c) => c.customer_id)));
                          } else {
                            setSelectedCustomerIds(new Set());
                          }
                        }}
                      />
                    </th>
                    <th style={{ padding: "10px 8px", width: 45 }}>Sr.</th>
                    <th style={{ padding: "10px 12px", minWidth: 260 }}>Customer Name</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", minWidth: 85 }}>Total Items</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", minWidth: 100 }}>Items w/ Balance</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", minWidth: 120, background: "#9a3412", color: "#ffffff" }}>
                      Balance to Invoice Qty
                    </th>
                    <th style={{ padding: "10px 8px", textAlign: "right", minWidth: 100 }}>Items w/ Shortfall</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", minWidth: 120, background: "#991b1b", color: "#ffffff" }}>
                      Shortfall to Purchase Qty
                    </th>
                    <th style={{ padding: "10px 8px", textAlign: "right", minWidth: 130 }}>
                      Approx Shortfall Value
                    </th>
                    <th style={{ padding: "10px 12px", textAlign: "center", minWidth: 140 }}>Statement Drilldown</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={10} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
                        Scanning local SQLite for pending customer statements...
                      </td>
                    </tr>
                  ) : !pendingSummaryData || pendingSummaryData.customers.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ padding: 40, textAlign: "center", color: "#16a34a", fontWeight: 600 }}>
                        🎉 All customer accounts are fully reconciled! No pending balance or shortfall found.
                      </td>
                    </tr>
                  ) : (
                    pendingSummaryData.customers
                      .filter((c) => !pendingSearch || c.customer_name.toLowerCase().includes(pendingSearch.toLowerCase()))
                      .map((c, idx) => {
                        const isSelected = selectedCustomerIds.has(c.customer_id);
                        return (
                          <tr
                            key={c.customer_id}
                            style={{
                              borderBottom: "1px solid #f1f5f9",
                              background: isSelected ? "#f8fafc" : "#ffffff",
                            }}
                          >
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  const next = new Set(selectedCustomerIds);
                                  if (e.target.checked) {
                                    next.add(c.customer_id);
                                  } else {
                                    next.delete(c.customer_id);
                                  }
                                  setSelectedCustomerIds(next);
                                }}
                              />
                            </td>
                            <td style={{ padding: "8px 8px", color: "#64748b" }}>{idx + 1}</td>
                            <td style={{ padding: "8px 12px", fontWeight: 700, color: "#0f172a" }}>
                              <button
                                onClick={() => {
                                  setCustomerId(c.customer_id);
                                  setCustomerName(c.customer_name);
                                }}
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  color: "#0f766e",
                                  fontWeight: 700,
                                  textAlign: "left",
                                  cursor: "pointer",
                                  textDecoration: "underline",
                                  fontSize: 12.5,
                                }}
                              >
                                {c.customer_name}
                              </button>
                            </td>
                            <td style={{ padding: "8px 8px", textAlign: "right", color: "#475569" }}>
                              {c.total_items}
                            </td>
                            <td style={{ padding: "8px 8px", textAlign: "right", color: c.balance_items_count > 0 ? "#c2410c" : "#94a3b8", fontWeight: c.balance_items_count > 0 ? 600 : 400 }}>
                              {c.balance_items_count}
                            </td>
                            <td style={{ padding: "8px 8px", textAlign: "right", color: "#c2410c", background: "#fff7ed", fontWeight: c.balance_material_to_invoice > 0.001 ? 700 : 400 }}>
                              {formatQuantity(c.balance_material_to_invoice)}
                            </td>
                            <td style={{ padding: "8px 8px", textAlign: "right", color: c.shortfall_items_count > 0 ? "#dc2626" : "#94a3b8", fontWeight: c.shortfall_items_count > 0 ? 600 : 400 }}>
                              {c.shortfall_items_count}
                            </td>
                            <td style={{ padding: "8px 8px", textAlign: "right", color: "#dc2626", background: "#fef2f2", fontWeight: c.shortfall_material_to_purchase > 0.001 ? 700 : 400 }}>
                              {formatQuantity(c.shortfall_material_to_purchase)}
                            </td>
                            <td style={{ padding: "8px 8px", textAlign: "right", color: c.approx_purchase_requirement_value > 0 ? "#b91c1c" : "#94a3b8", fontWeight: c.approx_purchase_requirement_value > 0 ? 700 : 400 }}>
                              {formatINR(c.approx_purchase_requirement_value)}
                            </td>
                            <td style={{ padding: "8px 12px", textAlign: "center" }}>
                              <button
                                onClick={() => {
                                  setCustomerId(c.customer_id);
                                  setCustomerName(c.customer_name);
                                }}
                                className="btn btn-sm"
                                style={{
                                  background: "#f0fdf4",
                                  color: "#166534",
                                  border: "1px solid #bbf7d0",
                                  fontSize: 11,
                                  fontWeight: 600,
                                  padding: "4px 8px",
                                }}
                              >
                                View Statement →
                              </button>
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
                {pendingSummaryData && pendingSummaryData.customers.length > 0 && (
                  <tfoot>
                    <tr style={{ background: "#f8fafc", fontWeight: 700, borderTop: "2px solid #cbd5e1" }}>
                      <td colSpan={3} style={{ padding: "10px 12px" }}>
                        TOTAL PENDING ({pendingSummaryData.customers.length} customers)
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right" }}>
                        {pendingSummaryData.customers.reduce((s, c) => s + c.total_items, 0)}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", color: "#c2410c" }}>
                        {pendingSummaryData.customers.reduce((s, c) => s + c.balance_items_count, 0)}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", color: "#c2410c", background: "#fff7ed" }}>
                        {formatQuantity(pendingSummaryData.total_balance_material_to_invoice)}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", color: "#dc2626" }}>
                        {pendingSummaryData.customers.reduce((s, c) => s + c.shortfall_items_count, 0)}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", color: "#dc2626", background: "#fef2f2" }}>
                        {formatQuantity(pendingSummaryData.total_shortfall_material_to_purchase)}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", color: "#b91c1c" }}>
                        {formatINR(pendingSummaryData.total_approx_purchase_requirement_value)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Customer Details Missing Warning Card */}
          {summary && summary.unmapped_purchase_lines_count > 0 && (
            <div
              style={{
                background: "#fffbeb",
                border: "1px solid #fde68a",
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <div>
                  <strong style={{ color: "#92400e", fontSize: 13 }}>
                    CUSTOMER DETAILS MISSING WARNING:
                  </strong>{" "}
                  <span style={{ fontSize: 13, color: "#b45309" }}>
                    <strong>{summary.unmapped_purchase_lines_count}</strong> unmapped purchase lines (Qty:{" "}
                    <strong>{summary.unmapped_purchase_qty}</strong>) exist without customer attribution and are excluded from this report.
                  </span>
                </div>
              </div>
              {onNavigateToActionTaken && (
                <button
                  onClick={onNavigateToActionTaken}
                  className="btn btn-sm"
                  style={{ background: "#ffffff", color: "#b45309", border: "1px solid #f59e0b", fontSize: 11, fontWeight: 700 }}
                >
                  View Customer Details Missing →
                </button>
              )}
            </div>
          )}

          {/* Summary KPI Cards */}
          {summary && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
                marginBottom: 20,
              }}
            >
              <div style={{ background: "#ffffff", padding: "12px 16px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>TOTAL ITEMS</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
                  {summary.total_items}
                </div>
              </div>

              <div style={{ background: "#ffffff", padding: "12px 16px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>PURCHASE QTY</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#1d4ed8", marginTop: 4 }}>
                  {formatQuantity(summary.total_purchase_qty)}
                </div>
              </div>

              <div style={{ background: "#ffffff", padding: "12px 16px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>INVOICED / SALES QTY</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#0f766e", marginTop: 4 }}>
                  {formatQuantity(summary.total_sales_qty)}
                </div>
              </div>

              <div style={{ background: "#fff7ed", padding: "12px 16px", borderRadius: 8, border: "1px solid #fed7aa" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#c2410c" }}>BALANCE MATERIAL TO INVOICE</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#c2410c", marginTop: 4 }}>
                  {formatQuantity(summary.total_balance_material_to_invoice)}
                </div>
                <div style={{ fontSize: 10, color: "#9a3412", marginTop: 2 }}>
                  Purchase Qty not yet matched with Sales Invoice Qty
                </div>
              </div>

              <div style={{ background: "#fef2f2", padding: "12px 16px", borderRadius: 8, border: "1px solid #fecaca" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#dc2626" }}>SHORTFALL MATERIAL TO PURCHASE</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#dc2626", marginTop: 4 }}>
                  {formatQuantity(summary.total_shortfall_material_to_purchase)}
                </div>
                <div style={{ fontSize: 10, color: "#991b1b", marginTop: 2 }}>
                  Sales Invoice Qty not yet supported by Customer Purchase Qty
                </div>
              </div>

              <div style={{ background: "#f0fdf4", padding: "12px 16px", borderRadius: 8, border: "1px solid #bbf7d0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a" }}>RECONCILED QTY</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#16a34a", marginTop: 4 }}>
                  {formatQuantity(summary.total_reconciled_qty)}
                </div>
                <div style={{ fontSize: 10, color: "#15803d", marginTop: 2 }}>
                  Fully matched material
                </div>
              </div>

              <div style={{ background: "#fef2f2", padding: "12px 16px", borderRadius: 8, border: "1px solid #fecaca" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c" }}>APPROX. PURCHASE REQUIREMENT</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#b91c1c", marginTop: 4 }}>
                  {formatINR(summary.total_approx_purchase_requirement_value)}
                </div>
                <div style={{ fontSize: 10, color: "#7f1d1d", marginTop: 2 }}>
                  Evaluated with approved actual latest purchase rates
                </div>
              </div>
            </div>
          )}

          {/* Main Table */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              overflow: "hidden",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 380px)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#1e3a5f", color: "#ffffff", textAlign: "left", position: "sticky", top: 0, zIndex: 10 }}>
                    <th style={{ padding: "10px 8px", width: 45 }}>Sr.</th>
                    <th style={{ padding: "10px 10px", minWidth: 200 }}>Item Name</th>
                    <th style={{ padding: "10px 8px", minWidth: 90 }}>SKU / Code</th>
                    <th style={{ padding: "10px 8px", minWidth: 140 }}>Description</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", minWidth: 80 }}>Purchase Qty</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", minWidth: 80 }}>Invoiced Qty</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", minWidth: 80 }}>Balance Qty</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", minWidth: 100, background: "#9a3412", color: "#ffffff" }}>
                      Balance Material to Invoice
                    </th>
                    <th style={{ padding: "10px 8px", textAlign: "right", minWidth: 100, background: "#991b1b", color: "#ffffff" }}>
                      Shortfall Material to Purchase
                    </th>
                    <th style={{ padding: "10px 8px", textAlign: "right", minWidth: 80, background: "#166534", color: "#ffffff" }}>
                      Reconciled Qty
                    </th>
                    <th style={{ padding: "10px 8px", textAlign: "right", minWidth: 95 }}>Latest Purchase Rate</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", minWidth: 110 }}>Approx Shortfall Value</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", minWidth: 110 }}>Status</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", minWidth: 130 }}>Site Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={14} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
                        Loading Customer Material Control data from local SQLite...
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={14} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
                        {!customerId
                          ? "Please select a Customer or choose ALL PENDING CUSTOMERS above."
                          : "No items matching selected filters."}
                      </td>
                    </tr>
                  ) : (
                    items.map((it) => {
                      const isBalance = it.balance_material_to_invoice > 0.001;
                      const isShortfall = it.shortfall_material_to_purchase > 0.001;
                      const isReconciled = it.reconciled_qty > 0.001 && !isBalance && !isShortfall;

                      return (
                        <tr
                          key={it.item_id}
                          style={{
                            borderBottom: "1px solid #f1f5f9",
                            background: isShortfall ? "#fff5f5" : isBalance ? "#fffaf0" : "#ffffff",
                          }}
                        >
                          <td style={{ padding: "8px 8px", color: "#64748b" }}>{it.sr}</td>
                          <td style={{ padding: "8px 10px", fontWeight: 600 }}>
                            <button
                              onClick={() => setSelectedItemForLedger(it.item_id)}
                              style={{
                                background: "none",
                                border: "none",
                                padding: 0,
                                color: "#0f766e",
                                fontWeight: 600,
                                textAlign: "left",
                                cursor: "pointer",
                                textDecoration: "underline",
                              }}
                            >
                              {it.item_name}
                            </button>
                          </td>
                          <td style={{ padding: "8px 8px", color: "#64748b", fontFamily: "monospace" }}>
                            {it.sku || "—"}
                          </td>
                          <td style={{ padding: "8px 8px", color: "#475569" }}>
                            {it.description || "—"}
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "right", color: "#1d4ed8" }}>
                            {formatQuantity(it.purchase_qty)}
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "right", color: "#0f766e" }}>
                            {formatQuantity(it.sales_qty)}
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "right", fontWeight: 600 }}>
                            {formatQuantity(it.balance_qty)}
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "right", color: "#c2410c", background: "#fff7ed", fontWeight: isBalance ? 700 : 400 }}>
                            {isBalance ? (
                              <button
                                onClick={() => setSelectedBalanceItem(it)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  color: "#c2410c",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  textDecoration: "underline",
                                }}
                              >
                                {formatQuantity(it.balance_material_to_invoice)} 🔍
                              </button>
                            ) : (
                              formatQuantity(it.balance_material_to_invoice)
                            )}
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "right", color: "#dc2626", background: "#fef2f2", fontWeight: isShortfall ? 700 : 400 }}>
                            {isShortfall ? (
                              <button
                                onClick={() => setSelectedShortfallItem(it)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  color: "#dc2626",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  textDecoration: "underline",
                                }}
                              >
                                {formatQuantity(it.shortfall_material_to_purchase)} 🔍
                              </button>
                            ) : (
                              formatQuantity(it.shortfall_material_to_purchase)
                            )}
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "right", color: "#16a34a", background: "#f0fdf4" }}>
                            {formatQuantity(it.reconciled_qty)}
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "right" }}>
                            {it.latest_purchase_rate !== null ? (
                              <div>
                                <span style={{ fontWeight: 600 }}>{formatINR(it.latest_purchase_rate)}</span>
                                {it.latest_purchase_basis && (
                                  <div style={{ fontSize: 9.5, color: "#64748b" }}>
                                    {it.latest_purchase_basis.slice(0, 24)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: "#94a3b8" }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "right", color: isShortfall ? "#b91c1c" : "#64748b", fontWeight: isShortfall ? 700 : 400 }}>
                            {it.approx_shortfall_value !== null ? formatINR(it.approx_shortfall_value) : "—"}
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "center" }}>
                            {isShortfall ? (
                              <span style={{ background: "#fef2f2", color: "#dc2626", padding: "2px 8px", borderRadius: 4, fontSize: 10.5, fontWeight: 700 }}>
                                SHORTFALL
                              </span>
                            ) : isBalance ? (
                              <span style={{ background: "#fff7ed", color: "#c2410c", padding: "2px 8px", borderRadius: 4, fontSize: 10.5, fontWeight: 700 }}>
                                BALANCE
                              </span>
                            ) : isReconciled ? (
                              <span style={{ background: "#f0fdf4", color: "#16a34a", padding: "2px 8px", borderRadius: 4, fontSize: 10.5, fontWeight: 700 }}>
                                RECONCILED
                              </span>
                            ) : (
                              <span style={{ color: "#94a3b8", fontSize: 10.5 }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "center" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background:
                                    it.action_status === "CLOSED"
                                      ? "#f1f5f9"
                                      : it.action_status === "OPEN"
                                      ? "#fee2e2"
                                      : "#e0e7ff",
                                  color:
                                    it.action_status === "CLOSED"
                                      ? "#64748b"
                                      : it.action_status === "OPEN"
                                      ? "#b91c1c"
                                      : "#3730a3",
                                }}
                              >
                                {it.action_status}
                              </span>
                              <button
                                onClick={() => {
                                  setEditingActionItem(it);
                                  setSiteRemark(it.site_remark || "");
                                  setActionRequired(it.action_required || "");
                                  setResponsiblePerson(it.responsible_person || "");
                                  setTargetDate(it.target_date || "");
                                  setActionStatus(it.action_status);
                                }}
                                className="btn btn-sm"
                                style={{
                                  background: "#f8fafc",
                                  color: "#0f766e",
                                  border: "1px solid #cbd5e1",
                                  fontSize: 10.5,
                                  padding: "2px 6px",
                                }}
                              >
                                {it.site_remark ? "Edit Remark" : "+ Add Note"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>

                {/* Grand Total Footer */}
                {summary && (
                  <tfoot>
                    <tr style={{ background: "#f8fafc", fontWeight: 700, borderTop: "2px solid #cbd5e1" }}>
                      <td colSpan={4} style={{ padding: "10px 10px" }}>
                        GRAND TOTAL ({items.length} items shown)
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", color: "#1d4ed8" }}>
                        {formatQuantity(summary.total_purchase_qty)}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", color: "#0f766e" }}>
                        {formatQuantity(summary.total_sales_qty)}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right" }}>
                        {formatQuantity(summary.total_purchase_qty - summary.total_sales_qty)}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", color: "#c2410c", background: "#fff7ed" }}>
                        {formatQuantity(summary.total_balance_material_to_invoice)}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", color: "#dc2626", background: "#fef2f2" }}>
                        {formatQuantity(summary.total_shortfall_material_to_purchase)}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", color: "#16a34a" }}>
                        {formatQuantity(summary.total_reconciled_qty)}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right" }}>—</td>
                      <td style={{ padding: "10px 8px", textAlign: "right", color: "#b91c1c" }}>
                        {formatINR(summary.total_approx_purchase_requirement_value)}
                      </td>
                      <td colSpan={2} style={{ padding: "10px 8px" }}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}

      {/* ─────────────────────────────────────────────────────────────
          DRAWER 1: BALANCE MATERIAL TO INVOICE BREAKDOWN
      ───────────────────────────────────────────────────────────── */}
      {selectedBalanceItem && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.4)",
            display: "flex",
            justifyContent: "flex-end",
            zIndex: 1000,
          }}
          onClick={() => setSelectedBalanceItem(null)}
        >
          <div
            style={{
              width: "min(900px, 95vw)",
              background: "#ffffff",
              height: "100%",
              boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div style={{ padding: "18px 24px", background: "#9a3412", color: "#ffffff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  BALANCE MATERIAL TO INVOICE BREAKDOWN
                </h3>
                <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
                  {selectedBalanceItem.item_name} · Remaining Available Qty: <strong>{formatQuantity(selectedBalanceItem.balance_material_to_invoice)}</strong>
                </div>
              </div>
              <button
                onClick={() => setSelectedBalanceItem(null)}
                style={{ background: "none", border: "none", color: "#ffffff", fontSize: 20, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
              <div style={{ background: "#fff7ed", padding: 14, borderRadius: 6, border: "1px solid #fed7aa", marginBottom: 16, fontSize: 12.5, color: "#9a3412" }}>
                <strong>Purchase Evidence Supporting Remaining Quantity:</strong> Below are the purchase bills assigned to customer{" "}
                <strong>{customerName}</strong> for this item. Aggregate matching shows{" "}
                <strong>{formatQuantity(selectedBalanceItem.reconciled_qty)}</strong> matched against invoices, leaving{" "}
                <strong>{formatQuantity(selectedBalanceItem.balance_material_to_invoice)}</strong> ready to be billed.
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", textAlign: "left", borderBottom: "2px solid #cbd5e1" }}>
                    <th style={{ padding: "8px 6px" }}>Bill Date</th>
                    <th style={{ padding: "8px 8px" }}>Bill No.</th>
                    <th style={{ padding: "8px 8px" }}>Vendor</th>
                    <th style={{ padding: "8px 8px" }}>Customer Details</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>Purchased</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>Rate</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>Taxable</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>Matched</th>
                    <th style={{ padding: "8px 6px", textAlign: "right", color: "#c2410c", fontWeight: 700 }}>Available</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedBalanceItem.balance_evidence.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                        No direct purchase bills found for this customer during period.
                      </td>
                    </tr>
                  ) : (
                    selectedBalanceItem.balance_evidence.map((be, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "8px 6px" }}>
                          <span
                            onClick={() => setSelectedDate(be.bill_date)}
                            style={{ color: "#1d4ed8", cursor: "pointer", textDecoration: "underline" }}
                          >
                            {formatDisplayDate(be.bill_date)}
                          </span>
                        </td>
                        <td style={{ padding: "8px 8px", fontWeight: 600 }}>
                          <span
                            onClick={() => setSelectedDoc({ type: "bill", docId: be.bill_id })}
                            style={{ color: "#1d4ed8", cursor: "pointer", textDecoration: "underline" }}
                          >
                            {be.bill_no}
                          </span>
                        </td>
                        <td style={{ padding: "8px 8px" }}>
                          <span
                            onClick={() => setSelectedVendor(be.vendor)}
                            style={{ color: "#1d4ed8", cursor: "pointer", textDecoration: "underline" }}
                          >
                            {be.vendor}
                          </span>
                        </td>
                        <td style={{ padding: "8px 8px", color: "#64748b" }}>{be.customer_details || "—"}</td>
                        <td style={{ padding: "8px 6px", textAlign: "right" }}>{formatQuantity(be.purchase_qty)}</td>
                        <td style={{ padding: "8px 6px", textAlign: "right" }}>{formatINR(be.rate)}</td>
                        <td style={{ padding: "8px 6px", textAlign: "right" }}>{formatINR(be.taxable_value)}</td>
                        <td style={{ padding: "8px 6px", textAlign: "right", color: "#16a34a" }}>{formatQuantity(be.matched_reconciled_qty)}</td>
                        <td style={{ padding: "8px 6px", textAlign: "right", color: "#c2410c", fontWeight: 700 }}>
                          {formatQuantity(be.balance_qty_available)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ padding: 16, background: "#f8fafc", borderTop: "1px solid #e2e8f0", textAlign: "right" }}>
              <button
                onClick={() => setSelectedBalanceItem(null)}
                className="btn btn-sm"
                style={{ background: "#475569", color: "#ffffff" }}
              >
                Close Breakdown
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          DRAWER 2: SHORTFALL MATERIAL PURCHASE REQUIREMENT
      ───────────────────────────────────────────────────────────── */}
      {selectedShortfallItem && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.4)",
            display: "flex",
            justifyContent: "flex-end",
            zIndex: 1000,
          }}
          onClick={() => setSelectedShortfallItem(null)}
        >
          <div
            style={{
              width: "min(920px, 95vw)",
              background: "#ffffff",
              height: "100%",
              boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ padding: "18px 24px", background: "#991b1b", color: "#ffffff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  SHORTFALL MATERIAL PURCHASE REQUIREMENT
                </h3>
                <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
                  {selectedShortfallItem.item_name} · Shortfall Required: <strong>{formatQuantity(selectedShortfallItem.shortfall_material_to_purchase)}</strong>
                </div>
              </div>
              <button
                onClick={() => setSelectedShortfallItem(null)}
                style={{ background: "none", border: "none", color: "#ffffff", fontSize: 20, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
              {/* Purchase Requirement Valuation Card */}
              <div
                style={{
                  background: "#fef2f2",
                  padding: 16,
                  borderRadius: 8,
                  border: "1px solid #fecaca",
                  marginBottom: 20,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#991b1b" }}>REQUIRED SHORTFALL QTY</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#991b1b", marginTop: 2 }}>
                    {formatQuantity(selectedShortfallItem.shortfall_material_to_purchase)}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#991b1b" }}>LATEST PURCHASE RATE</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
                    {selectedShortfallItem.latest_purchase_rate !== null ? formatINR(selectedShortfallItem.latest_purchase_rate) : "N/A"}
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>
                    {selectedShortfallItem.latest_purchase_basis || "No purchase reference"}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#991b1b" }}>APPROX. REQUIREMENT VALUE</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#b91c1c", marginTop: 2 }}>
                    {selectedShortfallItem.approx_shortfall_value !== null ? formatINR(selectedShortfallItem.approx_shortfall_value) : "N/A"}
                  </div>
                  <div style={{ fontSize: 10, color: "#7f1d1d" }}>
                    Decision-support valuation only
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#991b1b" }}>LATEST VENDOR / BILL</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                    {selectedShortfallItem.latest_purchase_vendor || "—"}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    {selectedShortfallItem.latest_purchase_doc || ""} ({selectedShortfallItem.latest_purchase_date ? formatDisplayDate(selectedShortfallItem.latest_purchase_date) : "—"})
                  </div>
                </div>
              </div>

              {/* Invoices Causing Requirement */}
              <h4 style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
                Sales Invoices Causing Requirement:
              </h4>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", textAlign: "left", borderBottom: "2px solid #cbd5e1" }}>
                    <th style={{ padding: "8px 6px" }}>Invoice Date</th>
                    <th style={{ padding: "8px 8px" }}>Invoice No.</th>
                    <th style={{ padding: "8px 8px" }}>Customer</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>Invoiced Qty</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>Rate</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>Taxable</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>Matched</th>
                    <th style={{ padding: "8px 6px", textAlign: "right", color: "#dc2626", fontWeight: 700 }}>Unsupported</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedShortfallItem.shortfall_evidence.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                        No sales invoices found.
                      </td>
                    </tr>
                  ) : (
                    selectedShortfallItem.shortfall_evidence.map((se, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "8px 6px" }}>
                          <span
                            onClick={() => setSelectedDate(se.invoice_date)}
                            style={{ color: "#1d4ed8", cursor: "pointer", textDecoration: "underline" }}
                          >
                            {formatDisplayDate(se.invoice_date)}
                          </span>
                        </td>
                        <td style={{ padding: "8px 8px", fontWeight: 600 }}>
                          <span
                            onClick={() => setSelectedDoc({ type: "invoice", docId: se.invoice_id })}
                            style={{ color: "#1d4ed8", cursor: "pointer", textDecoration: "underline" }}
                          >
                            {se.invoice_no}
                          </span>
                        </td>
                        <td style={{ padding: "8px 8px" }}>{se.customer}</td>
                        <td style={{ padding: "8px 6px", textAlign: "right" }}>{formatQuantity(se.qty)}</td>
                        <td style={{ padding: "8px 6px", textAlign: "right" }}>{formatINR(se.rate)}</td>
                        <td style={{ padding: "8px 6px", textAlign: "right" }}>{formatINR(se.taxable_value)}</td>
                        <td style={{ padding: "8px 6px", textAlign: "right", color: "#16a34a" }}>{formatQuantity(se.matched_purchase_qty)}</td>
                        <td style={{ padding: "8px 6px", textAlign: "right", color: "#dc2626", fontWeight: 700 }}>
                          {formatQuantity(se.unsupported_shortfall_qty)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ padding: 16, background: "#f8fafc", borderTop: "1px solid #e2e8f0", textAlign: "right" }}>
              <button
                onClick={() => setSelectedShortfallItem(null)}
                className="btn btn-sm"
                style={{ background: "#475569", color: "#ffffff" }}
              >
                Close Requirement Breakdown
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL: SITE ACTION / REMARK EDITOR
      ───────────────────────────────────────────────────────────── */}
      {editingActionItem && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1050,
          }}
          onClick={() => setEditingActionItem(null)}
        >
          <div
            style={{
              width: "min(540px, 90vw)",
              background: "#ffffff",
              borderRadius: 8,
              padding: 24,
              boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
              Site Action & Remarks · Field Control
            </h3>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
              Item: <strong>{editingActionItem.item_name}</strong> | Customer: <strong>{customerName}</strong>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
                  Action Status
                </label>
                <select
                  value={actionStatus}
                  onChange={(e) => setActionStatus(e.target.value as SiteActionStatus)}
                  className="filter-select"
                  style={{ width: "100%", padding: "8px 10px", fontSize: 13 }}
                >
                  <option value="OPEN">OPEN</option>
                  <option value="MATERIAL TO PURCHASE">MATERIAL TO PURCHASE</option>
                  <option value="MATERIAL TO INVOICE">MATERIAL TO INVOICE</option>
                  <option value="WAITING FOR SITE CONFIRMATION">WAITING FOR SITE CONFIRMATION</option>
                  <option value="WAITING FOR VENDOR">WAITING FOR VENDOR</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
                <span style={{ fontSize: 10.5, color: "#94a3b8" }}>
                  Note: Marking CLOSED records the operational note locally and does not alter underlying reconciliation math.
                </span>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
                  Site Remark / Observation
                </label>
                <textarea
                  value={siteRemark}
                  onChange={(e) => setSiteRemark(e.target.value)}
                  placeholder="e.g. Material received on site, awaiting delivery challan confirmation..."
                  rows={3}
                  className="filter-input"
                  style={{ width: "100%", padding: "8px 10px", fontSize: 12.5 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
                  Action Required
                </label>
                <input
                  type="text"
                  value={actionRequired}
                  onChange={(e) => setActionRequired(e.target.value)}
                  placeholder="e.g. Issue PO to vendor for remaining 4 units"
                  className="filter-input"
                  style={{ width: "100%", padding: "8px 10px", fontSize: 12.5 }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
                    Responsible Person
                  </label>
                  <input
                    type="text"
                    value={responsiblePerson}
                    onChange={(e) => setResponsiblePerson(e.target.value)}
                    placeholder="e.g. Site In-Charge / Purchase"
                    className="filter-input"
                    style={{ width: "100%", padding: "8px 10px", fontSize: 12.5 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
                    Target Date
                  </label>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="filter-input"
                    style={{ width: "100%", padding: "8px 10px", fontSize: 12.5 }}
                  />
                </div>
              </div>
            </div>

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setEditingActionItem(null)}
                className="btn-secondary"
                style={{ fontSize: 12, padding: "6px 14px" }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAction}
                disabled={savingAction}
                className="btn btn-sm"
                style={{ background: "#0f766e", color: "#ffffff", fontSize: 12, padding: "6px 16px" }}
              >
                {savingAction ? "Saving..." : "Save Note"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          GLOBAL SHARED DRAWERS
      ───────────────────────────────────────────────────────────── */}
      {selectedDoc && (
        <LocalDocumentDrawer
          type={selectedDoc.type}
          docId={selectedDoc.docId}
          onClose={() => setSelectedDoc(null)}
        />
      )}

      {selectedVendor && (
        <VendorDetailDrawer
          vendorName={selectedVendor}
          financialYear={financialYear}
          onClose={() => setSelectedVendor(null)}
        />
      )}

      {selectedDate && (
        <DateDetailDrawer
          date={selectedDate}
          onClose={() => setSelectedDate(null)}
        />
      )}

      {selectedItemForLedger && (
        <ItemDetailDrawer
          itemId={selectedItemForLedger}
          financialYear={financialYear}
          initialCustomerId={customerId === "ALL_PENDING" ? undefined : customerId}
          initialCustomerName={customerId === "ALL_PENDING" ? undefined : customerName}
          onClose={() => setSelectedItemForLedger(null)}
        />
      )}

      {/* ─────────────────────────────────────────────────────────────
          V2 REPORTING DRILL-DOWN MODALS
      ───────────────────────────────────────────────────────────── */}
      
      {selectedValuation && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 8, padding: 24, width: "90%", maxWidth: 600, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>{selectedValuation.type === "SHORTFALL" ? "Shortfall Valuation" : "Balance-to-Invoice Valuation"}</h3>
              <button onClick={() => setSelectedValuation(null)} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#64748b" }}>×</button>
            </div>
            <div style={{ fontSize: 14, color: "#334155" }}>
              <div style={{ padding: 12, backgroundColor: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0", marginBottom: 16, color: "#475569" }}>
                <strong>Note:</strong> This is a derived valuation based on {selectedValuation.type === "SHORTFALL" ? "shortfall quantity and reference/latest purchase rate." : "balance quantity and reference/latest sales rate."} It is <strong>NOT</strong> an actual transaction amount.
              </div>
              <div style={{ marginBottom: 16 }}>
                <strong>Customer:</strong> {selectedValuation.customerName} <br />
                <strong>Period:</strong> {selectedValuation.period}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 16 }}>
                <thead>
                  <tr style={{ backgroundColor: "#f8fafc", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>
                    <th style={{ padding: "8px" }}>Item Name</th>
                    <th style={{ padding: "8px" }}>Item ID</th>
                    <th style={{ padding: "8px", textAlign: "right" }}>Qty</th>
                    <th style={{ padding: "8px", textAlign: "right" }}>Ref Rate</th>
                    <th style={{ padding: "8px", textAlign: "right" }}>Valuation</th>
                  </tr>
                </thead>
                <tbody>
                  {scanResult?.suggestions
                    ?.filter((s: any) => s.sourceItem.customerId === selectedValuation.customerId && (selectedValuation.type === "SHORTFALL" ? s.sourceItem.mismatchQty < 0 : s.sourceItem.mismatchQty > 0))
                    .map((s: any, idx: number) => {
                      const qty = Math.abs(s.sourceItem.mismatchQty);
                      const rate = s.sourceItem.taxableValue ? s.sourceItem.taxableValue / qty : 0;
                      return (
                        <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                          <td 
                            style={{ padding: "8px", color: "#0369a1", cursor: "pointer", textDecoration: "underline" }}
                            onClick={() => setSelectedItemForLedger(s.sourceItem.itemId)}
                          >{s.sourceItem.itemName}</td>
                          <td style={{ padding: "8px" }}>{s.sourceItem.itemId}</td>
                          <td style={{ padding: "8px", textAlign: "right" }}>{qty}</td>
                          <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(rate)}</td>
                          <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(s.sourceItem.taxableValue || 0)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setSelectedValuation(null)} className="btn-secondary" style={{ padding: "8px 16px" }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {selectedExplanation && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 8, padding: 24, width: "90%", maxWidth: 500, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>{selectedExplanation.title}</h3>
              <button onClick={() => setSelectedExplanation(null)} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#64748b" }}>×</button>
            </div>
            <div style={{ fontSize: 14, color: "#334155", lineHeight: 1.5 }}>
              <p>{selectedExplanation.content}</p>
              {selectedExplanation.type === "EVIDENCE" && (
                <ul style={{ marginTop: 12, paddingLeft: 20 }}>
                  <li>Reference Purchase Rate: <span style={{ color: "#b91c1c", fontWeight: 500 }}>Missing/Unverified</span></li>
                  <li>Reference Sales Rate: <span style={{ color: "#b91c1c", fontWeight: 500 }}>Missing/Unverified</span></li>
                  <li>Cross-customer amount matching: <span style={{ color: "#b91c1c", fontWeight: 500 }}>Unverified</span></li>
                </ul>
              )}
            </div>
            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setSelectedExplanation(null)} className="btn-secondary" style={{ padding: "8px 16px" }}>Understood</button>
            </div>
          </div>
        </div>
      )}

      {selectedGroupEvidence && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 8, padding: 24, width: "90%", maxWidth: 600, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>
                {selectedGroupEvidence.reasons?.includes("QUANTITY_ONLY_POSSIBILITY") ? "Quantity-Only Possibility Evidence" : "Technical Group Evidence"}
              </h3>
              <button onClick={() => setSelectedGroupEvidence(null)} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#64748b" }}>×</button>
            </div>
            
            <div style={{ fontSize: 14, color: "#334155", display: "flex", flexDirection: "column", gap: 12 }}>
              {selectedGroupEvidence.reasons?.includes("QUANTITY_ONLY_POSSIBILITY") && (
                <div style={{ padding: 12, backgroundColor: "#fffbeb", border: "1px solid #fef3c7", borderRadius: 6, color: "#92400e" }}>
                  <strong>Note:</strong> This relationship is based on quantity coverage only and <u>does not establish technical equivalence.</u>
                </div>
              )}
              
              <div>
                <strong>Coverage Quantity:</strong> {selectedGroupEvidence.coverageQty} <br/>
                <strong>Residual Unresolved:</strong> {selectedGroupEvidence.residualQty} <br/>
                <strong>Confidence:</strong> {selectedGroupEvidence.confidence}
              </div>

              <div>
                <strong style={{ display: "block", marginBottom: 4 }}>Candidate Items:</strong>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {selectedGroupEvidence.candidates?.map((c: any, idx: number) => (
                    <li key={idx} style={{ marginBottom: 4 }}>
                      <span 
                        style={{ color: "#0369a1", cursor: "pointer", textDecoration: "underline" }}
                        onClick={() => setSelectedItemForLedger(c.itemId)}
                      >
                        {c.itemName}
                      </span> (ID: {c.itemId}) - Available Qty: {c.availableQty}
                    </li>
                  ))}
                </ul>
              </div>

              {selectedGroupEvidence.reasons && selectedGroupEvidence.reasons.length > 0 && (
                <div>
                  <strong style={{ display: "block", marginBottom: 4 }}>Qualifying Technical Evidence:</strong>
                  <ul style={{ margin: 0, paddingLeft: 20, color: "#059669" }}>
                    {selectedGroupEvidence.reasons.filter((r: string) => r !== "QUANTITY_ONLY_POSSIBILITY").map((r: string, idx: number) => (
                      <li key={idx}>
                        <strong style={{ cursor: "pointer", textDecoration: "underline" }} title="Technical Qualifier">{r}</strong>
                      </li>
                    ))}
                    {selectedGroupEvidence.reasons.filter((r: string) => r !== "QUANTITY_ONLY_POSSIBILITY").length === 0 && (
                      <li style={{ color: "#64748b", fontStyle: "italic" }}>None</li>
                    )}
                  </ul>
                </div>
              )}

              {selectedGroupEvidence.supportingEvidence && selectedGroupEvidence.supportingEvidence.length > 0 && (
                <div>
                  <strong style={{ display: "block", marginBottom: 4 }}>Supporting Evidence:</strong>
                  <ul style={{ margin: 0, paddingLeft: 20, color: "#475569" }}>
                    {selectedGroupEvidence.supportingEvidence.map((r: string, idx: number) => (
                      <li key={idx}>{r} {r === "ACTIVE_BOM_COMPONENT" && <span style={{ color: "#d97706", fontSize: 12 }}>(BOM_GOVERNANCE_NOT_VERIFIED)</span>}</li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedGroupEvidence.warnings && selectedGroupEvidence.warnings.length > 0 && (
                <div>
                  <strong style={{ display: "block", marginBottom: 4, color: "#b91c1c" }}>Warnings:</strong>
                  <ul style={{ margin: 0, paddingLeft: 20, color: "#b91c1c" }}>
                    {selectedGroupEvidence.warnings.map((w: string, idx: number) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
              {selectedGroupEvidence.reviewerDecision && (
                <div style={{ 
                  marginBottom: 16, 
                  padding: "8px 12px", 
                  backgroundColor: selectedGroupEvidence.reviewerDecision.isStale ? "#fefce8" : "#f8fafc", 
                  border: `1px solid ${selectedGroupEvidence.reviewerDecision.isStale ? "#fef08a" : "#e2e8f0"}`,
                  borderRadius: 6,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <div>
                    <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>CURRENT DECISION</span>
                    <div style={{ fontSize: 14, fontWeight: 700, color: selectedGroupEvidence.reviewerDecision.status === "APPROVE" ? "#16a34a" : "#0f172a" }}>
                      {selectedGroupEvidence.reviewerDecision.isStale ? "⚠️ STALE (EVIDENCE CHANGED) - WAS: " : ""}{selectedGroupEvidence.reviewerDecision.status}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    {new Date(selectedGroupEvidence.reviewerDecision.timestamp).toLocaleString()}
                  </div>
                </div>
              )}
              
              <div style={{ marginBottom: 16, fontSize: 13, color: "#475569", fontStyle: "italic", textAlign: "center" }}>
                Review decision only — no accounting, inventory, or Zoho entry is changed.
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <button 
                    onClick={() => handleDecision(selectedGroupEvidence.groupId, "APPROVE", selectedGroupEvidence.evidenceFingerprint, selectedGroupEvidence.sourceItemId, selectedGroupEvidence.targetType)}
                    disabled={selectedGroupEvidence.targetType === "QUANTITY_ONLY_POSSIBILITY"}
                    className="btn-primary" 
                    style={{ 
                      padding: "8px 16px", 
                      background: selectedGroupEvidence.targetType === "QUANTITY_ONLY_POSSIBILITY" ? "#94a3b8" : "#16a34a",
                      cursor: selectedGroupEvidence.targetType === "QUANTITY_ONLY_POSSIBILITY" ? "not-allowed" : "pointer"
                    }}
                    title={selectedGroupEvidence.targetType === "QUANTITY_ONLY_POSSIBILITY" ? "APPROVE is forbidden for quantity-only possibilities" : "Approve Recommendation"}
                  >
                    APPROVE
                  </button>
                  <button 
                    onClick={() => handleDecision(selectedGroupEvidence.groupId, "REJECT", selectedGroupEvidence.evidenceFingerprint, selectedGroupEvidence.sourceItemId, selectedGroupEvidence.targetType)}
                    className="btn-primary" 
                    style={{ padding: "8px 16px", background: "#dc2626" }}
                  >
                    REJECT
                  </button>
                  <button 
                    onClick={() => handleDecision(selectedGroupEvidence.groupId, "HOLD", selectedGroupEvidence.evidenceFingerprint, selectedGroupEvidence.sourceItemId, selectedGroupEvidence.targetType)}
                    className="btn-secondary" 
                    style={{ padding: "8px 16px" }}
                  >
                    HOLD
                  </button>
                  <button 
                    onClick={() => handleDecision(selectedGroupEvidence.groupId, "NEED_EVIDENCE", selectedGroupEvidence.evidenceFingerprint, selectedGroupEvidence.sourceItemId, selectedGroupEvidence.targetType)}
                    className="btn-secondary" 
                    style={{ padding: "8px 16px" }}
                  >
                    NEED EVIDENCE
                  </button>
                </div>
                <button onClick={() => setSelectedGroupEvidence(null)} className="btn-secondary" style={{ padding: "8px 16px" }}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedAlertEvidence && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 8, padding: 24, width: "90%", maxWidth: 500, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: "#991b1b" }}>{selectedAlertEvidence.title}</h3>
              <button onClick={() => setSelectedAlertEvidence(null)} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#64748b" }}>×</button>
            </div>
            <div style={{ fontSize: 14, color: "#334155", lineHeight: 1.5 }}>
              <p>{selectedAlertEvidence.content}</p>
            </div>
            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setSelectedAlertEvidence(null)} className="btn-secondary" style={{ padding: "8px 16px" }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Export Field Selector Modal */}
      <ExportFieldSelector
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        reportType={customerId === "ALL_PENDING" ? "all-pending-customer-material" : "customer-material-control"}
        totalRecords={customerId === "ALL_PENDING" ? selectedCustomerIds.size : items.length}
        onExport={handleExecuteExport}
      />
    </div>
  );
}

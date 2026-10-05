"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import type {
  ActionTakenResult,
  CustomerActionRecord,
  ActionTrackerItem,
  CustomerDetailsMissingResult,
  CustomerDetailsMissingItem,
  CustomerDetailsMissingKPIs,
} from "@/app/lib/action-taken-engine";
import { formatINR, formatQuantity, formatDisplayDate } from "@/app/lib/date-utils";
import { DetailsDrawer } from "./DetailsDrawer";
import { ItemDetailDrawer } from "./ItemDetailDrawer";
import { ExclusionDialog } from "./ExclusionDialog";
import { SelectiveSyncModal } from "./SelectiveSyncModal";
import { ExportFieldSelector } from "./ExportFieldSelector";
import type { ItemTransactionBreakdown, ExportOptions } from "@/app/types/reconciliation";

interface ActionTakenViewProps {
  financialYear?: string;
  onNavigateToCustomer?: (customerId: string, customerName: string) => void;
}

interface ActionHistoryEntry {
  history_id: string;
  customer_id: string;
  item_id?: string;
  action_status: string;
  action_taken?: string;
  action_owner?: string;
  priority?: string;
  next_follow_up_date?: string;
  remarks?: string;
  created_at: string;
  updated_at: string;
}

export function ActionTakenView({
  financialYear = "2026-27",
  onNavigateToCustomer,
}: ActionTakenViewProps) {
  // Period filter state
  const [activePeriod, setActivePeriod] = useState<string>("CURRENT_FY");
  const [period, setPeriod] = useState<string>(financialYear || "2026-27");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  // AUTHORITATIVE financial year derived from activePeriod — used by ALL breakdown requests.
  // Never override with system default if caller has explicitly selected a period.
  const effectiveFinancialYear: string = (() => {
    if (activePeriod === "PREVIOUS_FY") return "2025-26";
    if (activePeriod === "ALL") return "ALL";
    if (activePeriod === "CUSTOM" && fromDate && toDate) return "CUSTOM";
    return period || financialYear || "2026-27";
  })();

  // Status Filter: Default is MISMATCH_ONLY
  const [statusFilter, setStatusFilter] = useState<"MISMATCH_ONLY" | "ALL" | "RECONCILED_ONLY">("MISMATCH_ONLY");

  // Secondary Filters
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [globalItemSearch, setGlobalItemSearch] = useState<string>("");
  const [mismatchTypeFilter, setMismatchTypeFilter] = useState<"ALL" | "SHORTAGE" | "SURPLUS" | "PURCHASE_ONLY" | "SALES_ONLY">("ALL");
  const [actionStatusFilter, setActionStatusFilter] = useState<string>("");
  const [actionOwnerFilter, setActionOwnerFilter] = useState<string>("");
  const [priorityFilter, setPriorityFilter] = useState<string>("");

  // Table Data & Loading
  const [data, setData] = useState<ActionTakenResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  // Row Expansion & Customer-scoped Item Search / Status Filter State
  const [expandedCustomerIds, setExpandedCustomerIds] = useState<Set<string>>(new Set());
  const [customerItemSearchMap, setCustomerItemSearchMap] = useState<Record<string, string>>({});
  const [customerItemStatusFilterMap, setCustomerItemStatusFilterMap] = useState<Record<string, string>>({});

  // Helper functions for customer-scoped item search & filter
  const setCustomerItemSearch = (customerId: string, query: string) => {
    setCustomerItemSearchMap((prev) => ({ ...prev, [customerId]: query }));
  };

  const setCustomerItemStatusFilter = (customerId: string, status: string) => {
    setCustomerItemStatusFilterMap((prev) => ({ ...prev, [customerId]: status }));
  };

  const clearCustomerItemFilters = (customerId: string) => {
    setCustomerItemSearchMap((prev) => {
      const copy = { ...prev };
      delete copy[customerId];
      return copy;
    });
    setCustomerItemStatusFilterMap((prev) => {
      const copy = { ...prev };
      delete copy[customerId];
      return copy;
    });
  };

  // Action Update Modal State
  const [editingCustomer, setEditingCustomer] = useState<CustomerActionRecord | null>(null);
  const [editStatus, setEditStatus] = useState<string>("Open");
  const [editPriority, setEditPriority] = useState<"HIGH" | "MEDIUM" | "LOW">("MEDIUM");
  const [editOwner, setEditOwner] = useState<string>("");
  const [editFollowUpDate, setEditFollowUpDate] = useState<string>("");
  const [editActionTaken, setEditActionTaken] = useState<string>("");
  const [editRemarks, setEditRemarks] = useState<string>("");
  const [savingAction, setSavingAction] = useState<boolean>(false);

  // Action History Modal State
  const [historyCustomer, setHistoryCustomer] = useState<CustomerActionRecord | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ActionHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  // Drill-down Breakdown Drawer State
  const [drilldownItem, setDrilldownItem] = useState<ItemTransactionBreakdown | null>(null);
  const [loadingBreakdown, setLoadingBreakdown] = useState<boolean>(false);
  const [selectedItemForDetail, setSelectedItemForDetail] = useState<{
    itemId: string;
    itemName?: string;
    customerId?: string;
    customerName?: string;
  } | null>(null);

  // Active Action Taken Tab
  const [activeTab, setActiveTab] = useState<"mismatch-customers" | "missing-details">("mismatch-customers");

  // Customer Details Missing Tab State
  const [missingData, setMissingData] = useState<CustomerDetailsMissingResult | null>(null);
  const [missingLoading, setMissingLoading] = useState<boolean>(false);
  const [missingVendor, setMissingVendor] = useState<string>("");
  const [missingItem, setMissingItem] = useState<string>("");
  const [missingSearch, setMissingSearch] = useState<string>("");
  const [missingReconStatus, setMissingReconStatus] = useState<"UNMAPPED_ONLY" | "ALL" | "PURCHASE_ONLY" | "SHORTAGE_RELATED">("UNMAPPED_ONLY");
  const [missingActionStatus, setMissingActionStatus] = useState<string>("");

  // Missing Details Action Note Modal State
  const [editingMissingLine, setEditingMissingLine] = useState<CustomerDetailsMissingItem | null>(null);
  const [editMissingStatus, setEditMissingStatus] = useState<string>("Open");
  const [editMissingOwner, setEditMissingOwner] = useState<string>("");
  const [editMissingFollowUp, setEditMissingFollowUp] = useState<string>("");
  const [editMissingRemarks, setEditMissingRemarks] = useState<string>("");
  const [savingMissingAction, setSavingMissingAction] = useState<boolean>(false);

  // Local Purchase Bill Drawer Modal State
  const [selectedBillDoc, setSelectedBillDoc] = useState<any | null>(null);
  const [highlightLineItemId, setHighlightLineItemId] = useState<string | null>(null);
  const [loadingBillDoc, setLoadingBillDoc] = useState<boolean>(false);
  const [excludeBillLine, setExcludeBillLine] = useState<any | null>(null);

  // Smart Sync Modal State
  const [showSyncModal, setShowSyncModal] = useState<boolean>(false);

  // Fetch Action Taken data from authoritative SQLite engine
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("financialYear", period);
      if (activePeriod === "CUSTOM" && fromDate && toDate) {
        params.set("fromDate", fromDate);
        params.set("toDate", toDate);
      } else if (activePeriod === "PREVIOUS_FY") {
        params.set("financialYear", "2025-26");
      } else if (activePeriod === "ALL") {
        params.set("period", "ALL");
      }

      params.set("statusFilter", statusFilter);
      if (searchTerm) params.set("search", searchTerm);
      if (globalItemSearch) params.set("itemSearch", globalItemSearch);
      if (mismatchTypeFilter !== "ALL") params.set("mismatchType", mismatchTypeFilter);
      if (actionStatusFilter) params.set("actionStatus", actionStatusFilter);
      if (actionOwnerFilter) params.set("actionOwner", actionOwnerFilter);
      if (priorityFilter) params.set("priority", priorityFilter);

      const res = await fetch(`/api/action-taken?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error("Failed to fetch Action Taken data:", err);
    } finally {
      setLoading(false);
    }
  }, [period, activePeriod, fromDate, toDate, statusFilter, searchTerm, globalItemSearch, mismatchTypeFilter, actionStatusFilter, actionOwnerFilter, priorityFilter]);

  // Fetch Missing Customer Details data from local SQLite
  const fetchMissingData = useCallback(async () => {
    try {
      setMissingLoading(true);
      const params = new URLSearchParams();
      params.set("tab", "missing-details");
      params.set("financialYear", period);
      if (activePeriod === "CUSTOM" && fromDate && toDate) {
        params.set("fromDate", fromDate);
        params.set("toDate", toDate);
      } else if (activePeriod === "PREVIOUS_FY") {
        params.set("financialYear", "2025-26");
      } else if (activePeriod === "ALL") {
        params.set("period", "ALL");
      }

      if (missingVendor) params.set("vendor", missingVendor);
      if (missingItem) params.set("item", missingItem);
      if (missingSearch) params.set("search", missingSearch);
      if (missingReconStatus) params.set("reconStatusFilter", missingReconStatus);
      if (missingActionStatus) params.set("actionStatusFilter", missingActionStatus);

      const res = await fetch(`/api/action-taken?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setMissingData(json);
      }
    } catch (err) {
      console.error("Failed to fetch Customer Details Missing data:", err);
    } finally {
      setMissingLoading(false);
    }
  }, [period, activePeriod, fromDate, toDate, missingVendor, missingItem, missingSearch, missingReconStatus, missingActionStatus]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (activeTab === "missing-details") {
      fetchMissingData();
    }
  }, [activeTab, fetchMissingData]);

  // Open local Purchase Bill drawer highlighting affected line
  const handleBillClick = async (billId: string, lineItemId?: string) => {
    if (!billId) return;
    try {
      setLoadingBillDoc(true);
      setHighlightLineItemId(lineItemId || null);
      const res = await fetch(`/api/transactions?type=bill-detail&docId=${encodeURIComponent(billId)}`);
      if (res.ok) {
        const json = await res.json();
        setSelectedBillDoc(json.document);
      }
    } catch (err) {
      console.error("Failed to load bill detail:", err);
    } finally {
      setLoadingBillDoc(false);
    }
  };

  // Open item drill-down breakdown drawer
  // Uses effectiveFinancialYear — the single authoritative FY derived from activePeriod.
  // DO NOT fall back to system date or default FY when the caller has explicitly selected a period.
  const handleOpenBreakdown = async (customerId: string, itemIdOrName: string) => {
    if (!customerId || !itemIdOrName) {
      console.warn("[Breakdown] Incomplete identity — customerId or itemId missing. Not opening drawer.");
      return;
    }
    try {
      setLoadingBreakdown(true);
      const params = new URLSearchParams();
      // Pass the effective FY directly — never replace with current FY default
      if (activePeriod === "CUSTOM" && fromDate && toDate) {
        params.set("fromDate", fromDate);
        params.set("toDate", toDate);
      } else {
        // effectiveFinancialYear is already the authoritative FY (e.g. "2025-26" for PREVIOUS_FY)
        params.set("financialYear", effectiveFinancialYear);
      }
      params.set("breakdownCustomerId", customerId);
      params.set("breakdownItemId", itemIdOrName);
      const res = await fetch(`/api/inventory-mismatch?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.breakdown) {
          if (json.breakdown.isExcluded) {
            setDrilldownItem(null);
            fetchData();
            return;
          }
          setDrilldownItem(json.breakdown);
        }
      }
    } catch (e) {
      console.error("Failed to load breakdown:", e);
    } finally {
      setLoadingBreakdown(false);
    }
  };

  // Toggle customer row expansion
  const toggleExpandCustomer = (customerId: string) => {
    setExpandedCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  };

  // Open Edit Action modal for Customer
  const handleOpenEditAction = (customer: CustomerActionRecord) => {
    setEditingCustomer(customer);
    setEditStatus(customer.action_status || "Open");
    setEditPriority(customer.priority || "MEDIUM");
    setEditOwner(customer.action_owner || "");
    setEditFollowUpDate(customer.next_follow_up_date || "");
    setEditActionTaken(customer.action_taken || "");
    setEditRemarks(customer.remarks || "");
  };

  // Save updated action for Customer
  const handleSaveAction = async () => {
    if (!editingCustomer) return;
    try {
      setSavingAction(true);
      const res = await fetch("/api/action-taken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: editingCustomer.customer_id,
          customerName: editingCustomer.customer_name,
          actionStatus: editStatus,
          priority: editPriority,
          actionOwner: editOwner,
          nextFollowUpDate: editFollowUpDate,
          actionTaken: editActionTaken,
          remarks: editRemarks,
        }),
      });

      if (res.ok) {
        setEditingCustomer(null);
        await fetchData();
      }
    } catch (err) {
      console.error("Failed to save action note:", err);
    } finally {
      setSavingAction(false);
    }
  };

  // Open Edit Action modal for Missing Line Item
  const handleOpenEditMissingLine = (item: CustomerDetailsMissingItem) => {
    setEditingMissingLine(item);
    setEditMissingStatus(item.action_status || "Open");
    setEditMissingOwner(item.action_owner || "");
    setEditMissingFollowUp(item.next_follow_up_date || "");
    setEditMissingRemarks(item.remarks || "");
  };

  // Save updated action for Missing Line Item
  const handleSaveMissingAction = async () => {
    if (!editingMissingLine) return;
    try {
      setSavingMissingAction(true);
      const res = await fetch("/api/action-taken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "purchase_line_action",
          lineItemId: editingMissingLine.line_item_id,
          billId: editingMissingLine.bill_id,
          actionStatus: editMissingStatus,
          actionOwner: editMissingOwner,
          nextFollowUpDate: editMissingFollowUp,
          remarks: editMissingRemarks,
        }),
      });

      if (res.ok) {
        setEditingMissingLine(null);
        await fetchMissingData();
      }
    } catch (err) {
      console.error("Failed to save line action note:", err);
    } finally {
      setSavingMissingAction(false);
    }
  };

  // Open History modal
  const handleOpenHistory = async (customer: CustomerActionRecord) => {
    setHistoryCustomer(customer);
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/action-taken?historyCustomerId=${encodeURIComponent(customer.customer_id)}`);
      if (res.ok) {
        const json = await res.json();
        setHistoryEntries(json.history || []);
      }
    } catch (err) {
      console.error("Failed to fetch history:", err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Trigger export
  const [showExportModal, setShowExportModal] = useState(false);

  const handleExecuteExport = async (options: ExportOptions) => {
    try {
      setExporting(options.format || "excel");
      const params = new URLSearchParams();

      if (activeTab === "missing-details") {
        params.set("reportType", "customer-details-missing");
        params.set("financialYear", period);
        if (activePeriod === "CUSTOM" && fromDate && toDate) {
          params.set("fromDate", fromDate);
          params.set("toDate", toDate);
        }
        if (missingSearch) params.set("search", missingSearch);
        if (missingVendor) params.set("vendor", missingVendor);
        if (missingItem) params.set("item", missingItem);
        if (missingReconStatus) params.set("reconStatusFilter", missingReconStatus);
        if (missingActionStatus) params.set("actionStatusFilter", missingActionStatus);
      } else {
        params.set("reportType", "action-taken");
        params.set("financialYear", period);
        params.set("statusFilter", statusFilter);
        if (activePeriod === "CUSTOM" && fromDate && toDate) {
          params.set("fromDate", fromDate);
          params.set("toDate", toDate);
        }
        if (searchTerm) params.set("search", searchTerm);
        if (globalItemSearch) params.set("itemSearch", globalItemSearch);
        if (mismatchTypeFilter !== "ALL") params.set("mismatchType", mismatchTypeFilter);
        if (actionStatusFilter) params.set("actionStatus", actionStatusFilter);
        if (actionOwnerFilter) params.set("actionOwner", actionOwnerFilter);
        if (priorityFilter) params.set("priority", priorityFilter);
      }
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
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const extension = options.format === "excel" ? "xlsx" : "pdf";
        const filenamePrefix = activeTab === "missing-details" ? "Customer_Details_Missing" : `Action_Taken_${statusFilter}`;
        a.download = `Bansil_${filenamePrefix}_${period}_${new Date().toISOString().slice(0, 10)}.${extension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(null);
      setShowExportModal(false);
    }
  };

  const kpis = data?.kpis;
  const customers = data?.customers || [];

  // Calculate Filter-Aware Grand Totals for current filtered customer dataset
  const grandTotals = useMemo(() => {
    return customers.reduce(
      (acc, c) => {
        acc.customerCount += 1;
        acc.total_items += Number(c.total_items || 0);
        acc.reconciled_items += Number(c.reconciled_items || 0);
        acc.mismatch_items += Number(c.mismatch_items || 0);
        acc.shortage_items += Number(c.shortage_items || 0);
        acc.surplus_items += Number(c.surplus_items || 0);
        acc.purchase_only_items += Number(c.purchase_only_items || 0);
        acc.sales_only_items += Number(c.sales_only_items || 0);
        acc.total_yet_to_purchase_qty += Number(c.total_yet_to_purchase_qty || 0);
        acc.total_yet_to_sale_qty += Number(c.total_yet_to_sale_qty || 0);
        acc.approx_shortage_value += Number(c.approx_shortage_value || 0);
        acc.approx_surplus_value += Number(c.approx_surplus_value || 0);
        return acc;
      },
      {
        customerCount: 0,
        total_items: 0,
        reconciled_items: 0,
        mismatch_items: 0,
        shortage_items: 0,
        surplus_items: 0,
        purchase_only_items: 0,
        sales_only_items: 0,
        total_yet_to_purchase_qty: 0,
        total_yet_to_sale_qty: 0,
        approx_shortage_value: 0,
        approx_surplus_value: 0,
      }
    );
  }, [customers]);

  const badgeCount = missingData?.kpis?.missing_lines ?? data?.missingDetailsBadgeCount ?? 0;

  const missingItems = missingData?.items || [];
  const missingGrandTotals = useMemo(() => {
    return missingItems.reduce(
      (acc, it) => {
        acc.totalLines += 1;
        acc.billIds.add(it.bill_id);
        acc.itemIds.add(it.item_id);
        acc.totalQty += Number(it.quantity || 0);
        acc.totalTaxable += Number(it.line_total || 0);
        return acc;
      },
      {
        totalLines: 0,
        billIds: new Set<string>(),
        itemIds: new Set<string>(),
        totalQty: 0,
        totalTaxable: 0,
      }
    );
  }, [missingItems]);

  return (
    <div className="action-taken-container" style={{ padding: "0 0 32px 0" }}>
      {/* Top Header Banner */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: 0 }}>
              {activeTab === "missing-details"
                ? "Customer Details Missing (Purchase Mapping Exceptions)"
                : "Customer-wise Mismatch Action Tracker"}
            </h1>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "3px 8px",
                borderRadius: 4,
                background: "#f0fdf4",
                color: "#15803d",
                border: "1px solid #bbf7d0",
              }}
            >
              🔒 100% Local SQLite Tracker
            </span>
          </div>
          <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0 0" }}>
            {activeTab === "missing-details"
              ? "Identify Purchase Bill lines excluded from customer reconciliation due to missing Line Item Customer Details."
              : "Track follow-ups and action status for customers with shortage, surplus, or single-sided transactions."}
          </p>
        </div>

        {/* Export Buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-sm"
            disabled={exporting !== null}
            onClick={() => setShowExportModal(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, background: "#1e3a5f", color: "#ffffff" }}
          >
            <span>📊</span>
            {exporting ? "Exporting…" : "Export Report (Excel / PDF)..."}
          </button>
        </div>
      </div>

      {/* Action Taken Navigation Tabs */}
      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid #e2e8f0", marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => setActiveTab("mismatch-customers")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            fontSize: 14,
            fontWeight: activeTab === "mismatch-customers" ? 700 : 500,
            cursor: "pointer",
            background: "none",
            border: "none",
            borderBottom: activeTab === "mismatch-customers" ? "2px solid #2563eb" : "2px solid transparent",
            color: activeTab === "mismatch-customers" ? "#2563eb" : "#64748b",
            marginBottom: -1,
          }}
        >
          <span>📋</span>
          <span>Mismatch Customers</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("missing-details")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            fontSize: 14,
            fontWeight: activeTab === "missing-details" ? 700 : 500,
            cursor: "pointer",
            background: "none",
            border: "none",
            borderBottom: activeTab === "missing-details" ? "2px solid #ea580c" : "2px solid transparent",
            color: activeTab === "missing-details" ? "#ea580c" : "#64748b",
            marginBottom: -1,
          }}
        >
          <span>⚠️</span>
          <span>Customer Details Missing</span>
          {badgeCount > 0 ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 12,
                background: "#fef3c7",
                color: "#b45309",
                border: "1px solid #fde68a",
              }}
            >
              {badgeCount}
            </span>
          ) : (
            <span
              title="No Customer Details exceptions."
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 12,
                background: "#f0fdf4",
                color: "#15803d",
                border: "1px solid #bbf7d0",
              }}
            >
              0 ✓
            </span>
          )}
        </button>
      </div>

      {activeTab === "mismatch-customers" && (
        <div>
          {/* 6 Top KPI Cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
        {/* Customers Requiring Action */}
        <div
          className="kpi-card"
          style={{
            background: "#ffffff",
            padding: 16,
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            borderLeft: "4px solid #dc2626",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", textTransform: "uppercase" }}>
            CUSTOMERS REQUIRING ACTION
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
            {kpis?.customers_requiring_action ?? "—"}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            Active variance accounts
          </div>
        </div>

        {/* Total Mismatch Items */}
        <div
          className="kpi-card"
          style={{
            background: "#ffffff",
            padding: 16,
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            borderLeft: "4px solid #d97706",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#d97706", textTransform: "uppercase" }}>
            TOTAL MISMATCH ITEMS
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
            {kpis?.total_mismatch_items ?? "—"}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            Unreconciled line items
          </div>
        </div>

        {/* Total Shortage Qty */}
        <div
          className="kpi-card"
          style={{
            background: "#ffffff",
            padding: 16,
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            borderLeft: "4px solid #b91c1c",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c", textTransform: "uppercase" }}>
            TOTAL SHORTAGE QTY
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#b91c1c", marginTop: 4 }}>
            {kpis ? formatQuantity(kpis.total_shortage_qty) : "—"}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            Yet to purchase units
          </div>
        </div>

        {/* Total Surplus Qty */}
        <div
          className="kpi-card"
          style={{
            background: "#ffffff",
            padding: 16,
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            borderLeft: "4px solid #16a34a",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", textTransform: "uppercase" }}>
            TOTAL SURPLUS QTY
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#16a34a", marginTop: 4 }}>
            {kpis ? formatQuantity(kpis.total_surplus_qty) : "—"}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            Yet to sale / excess units
          </div>
        </div>

        {/* Approx Shortage Value */}
        <div
          className="kpi-card"
          style={{
            background: "#ffffff",
            padding: 16,
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            borderLeft: "4px solid #dc2626",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", textTransform: "uppercase" }}>
            APPROX SHORTAGE VALUE
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#dc2626", marginTop: 4 }}>
            ₹{kpis ? formatINR(kpis.approx_shortage_value) : "—"}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            Based on latest purchase rate
          </div>
        </div>

        {/* Approx Surplus Value */}
        <div
          className="kpi-card"
          style={{
            background: "#ffffff",
            padding: 16,
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            borderLeft: "4px solid #0f766e",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#0f766e", textTransform: "uppercase" }}>
            APPROX SURPLUS VALUE
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#0f766e", marginTop: 4 }}>
            ₹{kpis ? formatINR(kpis.approx_surplus_value) : "—"}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            Valued inventory surplus
          </div>
        </div>
      </div>

      {/* Main Filter Control Bar */}
      <div
        className="filter-bar"
        style={{
          background: "#ffffff",
          padding: 16,
          borderRadius: 8,
          border: "1px solid #e2e8f0",
          marginBottom: 16,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {/* Row 1: Primary Status Toggle & Period Selector */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          {/* Status Filter Toggle (Section 3 Requirement) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
              STATUS FILTER:
            </span>
            <div style={{ display: "flex", background: "#f1f5f9", padding: 3, borderRadius: 6 }}>
              <button
                type="button"
                onClick={() => setStatusFilter("MISMATCH_ONLY")}
                style={{
                  padding: "6px 14px",
                  fontSize: 12.5,
                  fontWeight: statusFilter === "MISMATCH_ONLY" ? 700 : 500,
                  borderRadius: 4,
                  background: statusFilter === "MISMATCH_ONLY" ? "#dc2626" : "transparent",
                  color: statusFilter === "MISMATCH_ONLY" ? "#ffffff" : "#475569",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                Mismatch Only
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("ALL")}
                style={{
                  padding: "6px 14px",
                  fontSize: 12.5,
                  fontWeight: statusFilter === "ALL" ? 700 : 500,
                  borderRadius: 4,
                  background: statusFilter === "ALL" ? "#0f766e" : "transparent",
                  color: statusFilter === "ALL" ? "#ffffff" : "#475569",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                All Customers
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("RECONCILED_ONLY")}
                style={{
                  padding: "6px 14px",
                  fontSize: 12.5,
                  fontWeight: statusFilter === "RECONCILED_ONLY" ? 700 : 500,
                  borderRadius: 4,
                  background: statusFilter === "RECONCILED_ONLY" ? "#16a34a" : "transparent",
                  color: statusFilter === "RECONCILED_ONLY" ? "#ffffff" : "#475569",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                Reconciled Only
              </button>
            </div>
          </div>

          {/* Period Filter */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
              PERIOD:
            </label>
            <select
              value={activePeriod}
              onChange={(e) => setActivePeriod(e.target.value)}
              className="filter-select"
              style={{ padding: "6px 12px", fontSize: 12.5, borderRadius: 4 }}
            >
              <option value="CURRENT_FY">Current FY ({period})</option>
              <option value="PREVIOUS_FY">Previous FY (2025-26)</option>
              <option value="ALL">All Periods (Full History)</option>
              <option value="CUSTOM">Custom Date Range</option>
            </select>

            {activePeriod === "CUSTOM" && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="filter-input"
                  style={{ padding: "4px 8px", fontSize: 12 }}
                />
                <span style={{ fontSize: 12, color: "#64748b" }}>to</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="filter-input"
                  style={{ padding: "4px 8px", fontSize: 12 }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Search and Fine-Grained Dropdowns */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {/* Search Customer */}
          <div style={{ flex: "1 1 200px", position: "relative" }}>
            <input
              type="text"
              placeholder="Search customer name / ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="filter-input"
              style={{ width: "100%", padding: "7px 10px 7px 28px", fontSize: 12.5 }}
            />
            <span style={{ position: "absolute", left: 8, top: 7, fontSize: 13, color: "#94a3b8" }}>🔍</span>
          </div>

          {/* Global Item Search across all customers (Section 14 Requirement) */}
          <div style={{ flex: "1 1 200px", position: "relative" }}>
            <input
              type="text"
              placeholder="Filter by item / SKU..."
              value={globalItemSearch}
              onChange={(e) => setGlobalItemSearch(e.target.value)}
              className="filter-input"
              style={{ width: "100%", padding: "7px 26px 7px 28px", fontSize: 12.5 }}
            />
            <span style={{ position: "absolute", left: 8, top: 7, fontSize: 13, color: "#0f766e" }}>🧩</span>
            {globalItemSearch && (
              <button
                type="button"
                onClick={() => setGlobalItemSearch("")}
                style={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "#94a3b8",
                  fontSize: 12,
                }}
                title="Clear global item search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Mismatch Type Filter */}
          <select
            value={mismatchTypeFilter}
            onChange={(e) => setMismatchTypeFilter(e.target.value as any)}
            className="filter-select"
            style={{ padding: "7px 10px", fontSize: 12.5, borderRadius: 4 }}
          >
            <option value="ALL">All Mismatch Types</option>
            <option value="SHORTAGE">Shortage Only</option>
            <option value="SURPLUS">Surplus Only</option>
            <option value="PURCHASE_ONLY">Purchase Only</option>
            <option value="SALES_ONLY">Sales Only</option>
          </select>

          {/* Action Status Filter */}
          <select
            value={actionStatusFilter}
            onChange={(e) => setActionStatusFilter(e.target.value)}
            className="filter-select"
            style={{ padding: "7px 10px", fontSize: 12.5, borderRadius: 4 }}
          >
            <option value="">All Action Statuses</option>
            <option value="Open">Open</option>
            <option value="Follow-up Required">Follow-up Required</option>
            <option value="Waiting for Purchase">Waiting for Purchase</option>
            <option value="Waiting for Customer">Waiting for Customer</option>
            <option value="Waiting for Vendor">Waiting for Vendor</option>
            <option value="Under Review">Under Review</option>
            <option value="Closed">Closed</option>
          </select>

          {/* Priority Filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="filter-select"
            style={{ padding: "7px 10px", fontSize: 12.5, borderRadius: 4 }}
          >
            <option value="">All Priorities</option>
            <option value="HIGH">High Priority</option>
            <option value="MEDIUM">Medium Priority</option>
            <option value="LOW">Low Priority</option>
          </select>

          {/* Action Owner Filter */}
          <input
            type="text"
            placeholder="Filter Owner..."
            value={actionOwnerFilter}
            onChange={(e) => setActionOwnerFilter(e.target.value)}
            className="filter-input"
            style={{ width: 130, padding: "7px 10px", fontSize: 12.5 }}
          />

          {/* Reset Filters */}
          {(searchTerm || globalItemSearch || mismatchTypeFilter !== "ALL" || actionStatusFilter || actionOwnerFilter || priorityFilter) && (
            <button
              className="btn btn-sm"
              onClick={() => {
                setSearchTerm("");
                setGlobalItemSearch("");
                setMismatchTypeFilter("ALL");
                setActionStatusFilter("");
                setActionOwnerFilter("");
                setPriorityFilter("");
              }}
              style={{ padding: "6px 12px", fontSize: 12 }}
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Main Customers Action Table */}
      <div className="section-card" style={{ padding: 0, overflow: "hidden", background: "#ffffff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "#64748b", fontSize: 14 }}>
            Evaluating customer reconciliation status from local SQLite…
          </div>
        ) : (
          <div className="table-responsive" style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0", color: "#475569", fontWeight: 700 }}>
                  <th style={{ width: 36, textAlign: "center" }}></th>
                  <th style={{ minWidth: 180 }}>Customer Name</th>
                  <th style={{ minWidth: 100 }}>Status</th>
                  <th style={{ minWidth: 80 }}>Priority</th>
                  <th style={{ textAlign: "right", minWidth: 65 }}>Total</th>
                  <th style={{ textAlign: "right", minWidth: 65 }}>Reconciled</th>
                  <th style={{ textAlign: "right", minWidth: 65 }}>Mismatch</th>
                  <th style={{ textAlign: "right", minWidth: 65 }}>Shortage</th>
                  <th style={{ textAlign: "right", minWidth: 65 }}>Surplus</th>
                  <th style={{ textAlign: "right", minWidth: 65 }}>Purch Only</th>
                  <th style={{ textAlign: "right", minWidth: 65 }}>Sale Only</th>
                  <th style={{ textAlign: "right", minWidth: 90 }}>Shortage Qty</th>
                  <th style={{ textAlign: "right", minWidth: 90 }}>Surplus Qty</th>
                  <th style={{ textAlign: "right", minWidth: 110 }}>Approx Shortage</th>
                  <th style={{ textAlign: "right", minWidth: 110 }}>Approx Surplus</th>
                  <th style={{ minWidth: 120 }}>Action Status</th>
                  <th style={{ minWidth: 100 }}>Owner</th>
                  <th style={{ minWidth: 100 }}>Next Follow-up</th>
                  <th style={{ minWidth: 140 }}>Remarks</th>
                  <th style={{ minWidth: 120, textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr>
                    <td colSpan={20} style={{ padding: 48, textAlign: "center", background: "#ffffff" }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>
                        {statusFilter === "MISMATCH_ONLY" ? "✓" : "📋"}
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", marginBottom: 4 }}>
                        {statusFilter === "MISMATCH_ONLY"
                          ? "No Customers Requiring Action"
                          : "No Customers Found Matching Filters"}
                      </div>
                      <div style={{ fontSize: 12.5, color: "#64748b", maxWidth: 480, margin: "0 auto" }}>
                        {statusFilter === "MISMATCH_ONLY"
                          ? "All customers are currently 100% reconciled for the selected period, or matches are filtered out."
                          : "Try adjusting your search criteria, period, or status filters."}
                      </div>
                    </td>
                  </tr>
                ) : (
                  customers.map((cust) => {
                    const isExpanded = expandedCustomerIds.has(cust.customer_id);
                    const rawItems = cust.items || [];
                    const searchQuery = (customerItemSearchMap[cust.customer_id] || "").trim().toLowerCase();
                    const localStatusFilter = customerItemStatusFilterMap[cust.customer_id] || "ALL_MISMATCHES";

                    const effectiveStatusFilter = localStatusFilter !== "ALL_MISMATCHES"
                      ? localStatusFilter
                      : (mismatchTypeFilter !== "ALL" ? mismatchTypeFilter : "ALL_MISMATCHES");

                    // 1. Status Filter
                    const statusFilteredItems = rawItems.filter((it) => {
                      if (effectiveStatusFilter === "ALL_MISMATCHES") return it.is_mismatch;
                      if (effectiveStatusFilter === "SHORTAGE") return it.status.includes("SHORTAGE") || it.yet_to_purchase > 0;
                      if (effectiveStatusFilter === "SURPLUS") return it.status.includes("SURPLUS") || it.yet_to_sale > 0;
                      if (effectiveStatusFilter === "PURCHASE_ONLY") return it.status === "PURCHASE ONLY";
                      if (effectiveStatusFilter === "SALES_ONLY") return it.status === "SALES ONLY";
                      if (effectiveStatusFilter === "RECONCILED") return it.is_reconciled;
                      if (effectiveStatusFilter === "ALL") return true;
                      return it.is_mismatch;
                    });

                    // 2. Customer Item Search Query
                    const visibleItems = statusFilteredItems.filter((it) => {
                      if (!searchQuery) return true;
                      const name = (it.item_name || "").toLowerCase();
                      const sku = (it.sku || "").toLowerCase();
                      const code = (it.item_id || "").toLowerCase();
                      const status = (it.status || "").toLowerCase();
                      const rate = it.latest_purchase_rate ? String(it.latest_purchase_rate) : "";
                      return (
                        name.includes(searchQuery) ||
                        sku.includes(searchQuery) ||
                        code.includes(searchQuery) ||
                        status.includes(searchQuery) ||
                        rate.includes(searchQuery)
                      );
                    });

                    const isFiltered = Boolean(searchQuery) || localStatusFilter !== "ALL_MISMATCHES" || mismatchTypeFilter !== "ALL";

                    return (
                      <React.Fragment key={cust.customer_id}>
                        <tr
                          style={{
                            borderBottom: "1px solid #e2e8f0",
                            background: isExpanded ? "#f8fafc" : "#ffffff",
                          }}
                        >
                          {/* Expand Button */}
                          <td style={{ textAlign: "center" }}>
                            <button
                              type="button"
                              onClick={() => toggleExpandCustomer(cust.customer_id)}
                              style={{
                                background: "none",
                                border: "none",
                                fontSize: 14,
                                fontWeight: 700,
                                cursor: "pointer",
                                color: "#0f766e",
                              }}
                              title={isExpanded ? "Collapse item breakdown" : "Expand item breakdown"}
                            >
                              {isExpanded ? "▾" : "▸"}
                            </button>
                          </td>

                          {/* Customer Name */}
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span
                                style={{
                                  fontWeight: 600,
                                  color: "#0f766e",
                                  cursor: onNavigateToCustomer ? "pointer" : "default",
                                  textDecoration: onNavigateToCustomer ? "underline" : "none",
                                }}
                                onClick={() => onNavigateToCustomer && onNavigateToCustomer(cust.customer_id, cust.customer_name)}
                                title={onNavigateToCustomer ? "Open Customer 360 View" : undefined}
                              >
                                {cust.customer_name}
                              </span>
                            </div>
                            <div style={{ fontSize: 10.5, color: "#94a3b8" }}>ID: {cust.customer_id}</div>
                          </td>

                          {/* Status Badge */}
                          <td>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: 4,
                                background: cust.customer_status === "ACTION REQUIRED" ? "#fee2e2" : "#f0fdf4",
                                color: cust.customer_status === "ACTION REQUIRED" ? "#b91c1c" : "#16a34a",
                              }}
                            >
                              {cust.customer_status}
                            </span>
                          </td>

                          {/* Priority */}
                          <td>
                            <span
                              style={{
                                fontSize: 10.5,
                                fontWeight: 700,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background:
                                  cust.priority === "HIGH"
                                    ? "#fef2f2"
                                    : cust.priority === "MEDIUM"
                                    ? "#fffbeb"
                                    : "#f0fdf4",
                                color:
                                  cust.priority === "HIGH"
                                    ? "#dc2626"
                                    : cust.priority === "MEDIUM"
                                    ? "#d97706"
                                    : "#16a34a",
                                border: `1px solid ${
                                  cust.priority === "HIGH"
                                    ? "#fecaca"
                                    : cust.priority === "MEDIUM"
                                    ? "#fde68a"
                                    : "#bbf7d0"
                                }`,
                              }}
                            >
                              {cust.priority}
                            </span>
                          </td>

                          {/* Item Counts */}
                          <td style={{ textAlign: "right" }}>{cust.total_items}</td>
                          <td style={{ textAlign: "right", color: "#16a34a", fontWeight: 600 }}>{cust.reconciled_items}</td>
                          <td style={{ textAlign: "right", color: cust.mismatch_items > 0 ? "#dc2626" : "#64748b", fontWeight: 700 }}>
                            {cust.mismatch_items}
                          </td>
                          <td style={{ textAlign: "right", color: cust.shortage_items > 0 ? "#dc2626" : "#64748b" }}>
                            {cust.shortage_items}
                          </td>
                          <td style={{ textAlign: "right", color: cust.surplus_items > 0 ? "#d97706" : "#64748b" }}>
                            {cust.surplus_items}
                          </td>
                          <td style={{ textAlign: "right", color: cust.purchase_only_items > 0 ? "#2563eb" : "#64748b" }}>
                            {cust.purchase_only_items}
                          </td>
                          <td style={{ textAlign: "right", color: cust.sales_only_items > 0 ? "#7c3aed" : "#64748b" }}>
                            {cust.sales_only_items}
                          </td>

                          {/* Quantities */}
                          <td style={{ textAlign: "right", color: cust.total_yet_to_purchase_qty > 0 ? "#dc2626" : "#64748b", fontWeight: 600 }}>
                            {formatQuantity(cust.total_yet_to_purchase_qty)}
                          </td>
                          <td style={{ textAlign: "right", color: cust.total_yet_to_sale_qty > 0 ? "#d97706" : "#64748b", fontWeight: 600 }}>
                            {formatQuantity(cust.total_yet_to_sale_qty)}
                          </td>

                          {/* Values */}
                          <td style={{ textAlign: "right", color: cust.approx_shortage_value > 0 ? "#dc2626" : "#64748b", fontWeight: 600 }}>
                            {cust.approx_shortage_value > 0 ? `₹${formatINR(cust.approx_shortage_value)}` : "—"}
                          </td>
                          <td style={{ textAlign: "right", color: cust.approx_surplus_value > 0 ? "#0f766e" : "#64748b", fontWeight: 600 }}>
                            {cust.approx_surplus_value > 0 ? `₹${formatINR(cust.approx_surplus_value)}` : "—"}
                          </td>

                          {/* Action Details */}
                          <td>
                            <span
                              style={{
                                fontSize: 11,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: cust.action_status === "Closed" ? "#f0fdf4" : "#f8fafc",
                                color: cust.action_status === "Closed" ? "#16a34a" : "#334155",
                                border: "1px solid #e2e8f0",
                                fontWeight: 600,
                              }}
                            >
                              {cust.action_status || "Open"}
                            </span>
                          </td>
                          <td>{cust.action_owner || "—"}</td>
                          <td>{cust.next_follow_up_date ? formatDisplayDate(cust.next_follow_up_date) : "—"}</td>
                          <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {cust.remarks || cust.action_taken || "—"}
                          </td>

                          {/* Action Buttons */}
                          <td style={{ textAlign: "center" }}>
                            <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                              <button
                                type="button"
                                onClick={() => handleOpenEditAction(cust)}
                                className="btn btn-sm btn-primary"
                                style={{ fontSize: 11, padding: "3px 8px" }}
                                title="Update Action Taken"
                              >
                                Update
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenHistory(cust)}
                                className="btn btn-sm"
                                style={{ fontSize: 11, padding: "3px 6px" }}
                                title="View Action History Audit Log"
                              >
                                📜
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Expandable Mismatch Breakdown Sub-Table with Item Search & Status Filter */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={20} style={{ padding: 0, background: "#f8fafc" }}>
                              <div style={{ padding: "16px 20px", borderBottom: "2px solid #e2e8f0" }}>
                                {/* Sub-table Header & Left-Aligned Search / Filter Controls */}
                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "flex-start",
                                    gap: 10,
                                    marginBottom: 14,
                                  }}
                                >
                                  {/* Header & Dynamic Result Count */}
                                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                                      Item Breakdown for {cust.customer_name}
                                    </span>
                                    <span
                                      style={{
                                        fontSize: 11.5,
                                        fontWeight: 600,
                                        color: isFiltered ? "#0f766e" : "#64748b",
                                        background: isFiltered ? "#f0fdfa" : "#f1f5f9",
                                        padding: "2px 8px",
                                        borderRadius: 12,
                                        border: isFiltered ? "1px solid #99f6e4" : "1px solid #e2e8f0",
                                      }}
                                    >
                                      {isFiltered
                                        ? `(${visibleItems.length} of ${rawItems.length} items shown)`
                                        : `(${visibleItems.length} items shown)`}
                                    </span>
                                  </div>

                                  {/* Controls: Item Search, Status Filter Dropdown, Clear Button (LEFT ALIGNED) */}
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "flex-start",
                                      gap: 10,
                                      flexWrap: "wrap",
                                      width: "100%",
                                    }}
                                  >
                                    {/* Item Search Input */}
                                    <div style={{ position: "relative", width: 230 }}>
                                      <input
                                        type="text"
                                        placeholder="Search item, SKU, code..."
                                        value={customerItemSearchMap[cust.customer_id] || ""}
                                        onChange={(e) => setCustomerItemSearch(cust.customer_id, e.target.value)}
                                        style={{
                                          width: "100%",
                                          padding: "5px 26px 5px 26px",
                                          fontSize: 12,
                                          border: "1px solid #cbd5e1",
                                          borderRadius: 4,
                                          outline: "none",
                                          background: "#ffffff",
                                        }}
                                      />
                                      <span
                                        style={{
                                          position: "absolute",
                                          left: 8,
                                          top: "50%",
                                          transform: "translateY(-50%)",
                                          fontSize: 11,
                                          color: "#94a3b8",
                                        }}
                                      >
                                        🔍
                                      </span>
                                      {Boolean(customerItemSearchMap[cust.customer_id]) && (
                                        <button
                                          type="button"
                                          onClick={() => setCustomerItemSearch(cust.customer_id, "")}
                                          style={{
                                            position: "absolute",
                                            right: 6,
                                            top: "50%",
                                            transform: "translateY(-50%)",
                                            border: "none",
                                            background: "transparent",
                                            cursor: "pointer",
                                            color: "#94a3b8",
                                            fontSize: 11,
                                            fontWeight: 700,
                                            padding: "2px 4px",
                                          }}
                                          title="Clear search"
                                        >
                                          ✕
                                        </button>
                                      )}
                                    </div>

                                    {/* Local Status Filter Dropdown */}
                                    <select
                                      value={localStatusFilter}
                                      onChange={(e) => setCustomerItemStatusFilter(cust.customer_id, e.target.value)}
                                      style={{
                                        padding: "5px 8px",
                                        fontSize: 12,
                                        border: "1px solid #cbd5e1",
                                        borderRadius: 4,
                                        background: "#ffffff",
                                        color: "#334155",
                                        fontWeight: 500,
                                      }}
                                    >
                                      <option value="ALL_MISMATCHES">All Mismatches</option>
                                      <option value="SHORTAGE">Shortage</option>
                                      <option value="SURPLUS">Surplus</option>
                                      <option value="PURCHASE_ONLY">Purchase Only</option>
                                      <option value="SALES_ONLY">Sales Only</option>
                                      <option value="RECONCILED">Reconciled</option>
                                      <option value="ALL">All Items</option>
                                    </select>

                                    {/* Clear Button */}
                                    {isFiltered && (
                                      <button
                                        type="button"
                                        onClick={() => clearCustomerItemFilters(cust.customer_id)}
                                        className="btn btn-sm"
                                        style={{
                                          fontSize: 11.5,
                                          padding: "4px 8px",
                                          background: "#ffffff",
                                          border: "1px solid #cbd5e1",
                                          color: "#475569",
                                          borderRadius: 4,
                                          cursor: "pointer",
                                        }}
                                        title="Clear item search & filters for this customer"
                                      >
                                        Clear
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Results Table or Empty State (Section 7 Requirement) */}
                                {visibleItems.length === 0 ? (
                                  <div
                                    style={{
                                      padding: "28px 20px",
                                      textAlign: "center",
                                      background: "#ffffff",
                                      borderRadius: 6,
                                      border: "1px solid #e2e8f0",
                                    }}
                                  >
                                    <div style={{ fontSize: 24, marginBottom: 6 }}>🔍</div>
                                    <div style={{ color: "#334155", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                                      No matching items found for this customer.
                                    </div>
                                    <div style={{ color: "#64748b", fontSize: 12, marginBottom: 12 }}>
                                      {searchQuery
                                        ? `No items matched "${searchQuery}" with the current filter settings.`
                                        : "No items match the selected status filter."}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => clearCustomerItemFilters(cust.customer_id)}
                                      className="btn btn-sm"
                                      style={{
                                        fontSize: 11.5,
                                        padding: "5px 12px",
                                        background: "#0f766e",
                                        color: "#ffffff",
                                        border: "none",
                                        borderRadius: 4,
                                        cursor: "pointer",
                                      }}
                                    >
                                      Clear Search
                                    </button>
                                  </div>
                                ) : (
                                  <div className="table-responsive" style={{ background: "#ffffff", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                                    <table className="data-table" style={{ width: "100%", fontSize: 11.5 }}>
                                      <thead>
                                        <tr style={{ background: "#f1f5f9" }}>
                                          <th>Item Name</th>
                                          <th>SKU</th>
                                          <th style={{ textAlign: "right" }}>Purchase Qty</th>
                                          <th style={{ textAlign: "right" }}>Sales Qty</th>
                                          <th style={{ textAlign: "right" }}>Balance Qty</th>
                                          <th style={{ textAlign: "right" }}>Shortage Qty</th>
                                          <th style={{ textAlign: "right" }}>Surplus Qty</th>
                                          <th style={{ textAlign: "right" }}>Latest Rate</th>
                                          <th style={{ textAlign: "right" }}>Approx Shortage</th>
                                          <th style={{ textAlign: "right" }}>Approx Surplus</th>
                                          <th style={{ textAlign: "center" }}>Status</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {visibleItems.map((it) => (
                                          <tr
                                            key={it.item_id || it.item_name}
                                            onClick={() => handleOpenBreakdown(cust.customer_id, it.item_id || it.item_name)}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter" || e.key === " ") {
                                                e.preventDefault();
                                                handleOpenBreakdown(cust.customer_id, it.item_id || it.item_name);
                                              }
                                            }}
                                            tabIndex={0}
                                            role="button"
                                            className="clickable-item-row"
                                            style={{
                                              cursor: "pointer",
                                              transition: "background-color 0.15s ease",
                                            }}
                                            title="Click row to view item reconciliation breakdown"
                                          >
                                            <td>
                                              <span
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setSelectedItemForDetail({
                                                    itemId: it.item_id || it.item_name,
                                                    itemName: it.item_name,
                                                    customerId: cust.customer_id,
                                                    customerName: cust.customer_name,
                                                  });
                                                }}
                                                style={{
                                                  fontWeight: 600,
                                                  color: "#2563eb",
                                                  textDecoration: "underline",
                                                  textUnderlineOffset: "2px",
                                                  cursor: "pointer",
                                                }}
                                                title="Click to view Item Detail & Movement drawer"
                                              >
                                                {it.item_name}
                                              </span>
                                            </td>
                                            <td style={{ color: "#64748b" }}>{it.sku || "—"}</td>
                                            <td style={{ textAlign: "right" }}>{formatQuantity(it.purchase_qty)}</td>
                                            <td style={{ textAlign: "right" }}>{formatQuantity(it.sales_qty)}</td>
                                            <td
                                              style={{
                                                textAlign: "right",
                                                fontWeight: 600,
                                                color: it.balance_qty < 0 ? "#dc2626" : it.balance_qty > 0 ? "#16a34a" : "#475569",
                                              }}
                                            >
                                              {formatQuantity(it.balance_qty)}
                                            </td>
                                            <td style={{ textAlign: "right", color: it.yet_to_purchase > 0 ? "#b91c1c" : "#475569", fontWeight: 600 }}>
                                              {formatQuantity(it.yet_to_purchase)}
                                            </td>
                                            <td style={{ textAlign: "right", color: it.yet_to_sale > 0 ? "#16a34a" : "#475569", fontWeight: 600 }}>
                                              {formatQuantity(it.yet_to_sale)}
                                            </td>
                                            <td style={{ textAlign: "right" }}>₹{formatINR(it.latest_purchase_rate)}</td>
                                            <td style={{ textAlign: "right", color: it.shortage_value ? "#dc2626" : "#64748b" }}>
                                              {it.shortage_value !== null ? `₹${formatINR(it.shortage_value)}` : "—"}
                                            </td>
                                            <td style={{ textAlign: "right", color: it.surplus_value ? "#0f766e" : "#64748b" }}>
                                              {it.surplus_value !== null ? `₹${formatINR(it.surplus_value)}` : "—"}
                                            </td>
                                            <td style={{ textAlign: "center" }}>
                                              <span
                                                style={{
                                                  fontSize: 10,
                                                  fontWeight: 700,
                                                  padding: "2px 6px",
                                                  borderRadius: 4,
                                                  background: it.is_reconciled
                                                    ? "#f0fdf4"
                                                    : it.status.includes("SHORTAGE")
                                                    ? "#fee2e2"
                                                    : "#fef3c7",
                                                  color: it.is_reconciled
                                                    ? "#16a34a"
                                                    : it.status.includes("SHORTAGE")
                                                    ? "#b91c1c"
                                                    : "#b45309",
                                                }}
                                              >
                                                {it.status}
                                              </span>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
              <tfoot style={{ position: "sticky", bottom: 0, zIndex: 5 }}>
                <tr
                  style={{
                    background: "#f8fafc",
                    borderTop: "2px solid #cbd5e1",
                    borderBottom: "2px solid #cbd5e1",
                    fontWeight: 800,
                    color: "#0f172a",
                  }}
                >
                  <td style={{ width: 36, textAlign: "center", color: "#94a3b8" }}>—</td>
                  <td style={{ minWidth: 180 }}>
                    <div style={{ fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      GRAND TOTAL
                    </div>
                    <div style={{ fontSize: 10.5, color: "#64748b", fontWeight: 600 }}>
                      {grandTotals.customerCount} {grandTotals.customerCount === 1 ? "Customer" : "Customers"}
                    </div>
                  </td>
                  <td style={{ minWidth: 100, color: "#94a3b8" }}>—</td>
                  <td style={{ minWidth: 80, color: "#94a3b8" }}>—</td>
                  <td style={{ textAlign: "right", minWidth: 65, color: "#0f172a" }}>
                    {grandTotals.total_items}
                  </td>
                  <td style={{ textAlign: "right", minWidth: 65, color: "#16a34a" }}>
                    {grandTotals.reconciled_items}
                  </td>
                  <td style={{ textAlign: "right", minWidth: 65, color: grandTotals.mismatch_items > 0 ? "#dc2626" : "#64748b" }}>
                    {grandTotals.mismatch_items}
                  </td>
                  <td style={{ textAlign: "right", minWidth: 65, color: grandTotals.shortage_items > 0 ? "#dc2626" : "#64748b" }}>
                    {grandTotals.shortage_items}
                  </td>
                  <td style={{ textAlign: "right", minWidth: 65, color: grandTotals.surplus_items > 0 ? "#d97706" : "#64748b" }}>
                    {grandTotals.surplus_items}
                  </td>
                  <td style={{ textAlign: "right", minWidth: 65, color: grandTotals.purchase_only_items > 0 ? "#2563eb" : "#64748b" }}>
                    {grandTotals.purchase_only_items}
                  </td>
                  <td style={{ textAlign: "right", minWidth: 65, color: grandTotals.sales_only_items > 0 ? "#7c3aed" : "#64748b" }}>
                    {grandTotals.sales_only_items}
                  </td>
                  <td style={{ textAlign: "right", minWidth: 90, color: grandTotals.total_yet_to_purchase_qty > 0 ? "#dc2626" : "#64748b" }}>
                    {formatQuantity(grandTotals.total_yet_to_purchase_qty)}
                  </td>
                  <td style={{ textAlign: "right", minWidth: 90, color: grandTotals.total_yet_to_sale_qty > 0 ? "#d97706" : "#64748b" }}>
                    {formatQuantity(grandTotals.total_yet_to_sale_qty)}
                  </td>
                  <td style={{ textAlign: "right", minWidth: 110, color: grandTotals.approx_shortage_value > 0 ? "#dc2626" : "#64748b" }}>
                    ₹{formatINR(grandTotals.approx_shortage_value)}
                  </td>
                  <td style={{ textAlign: "right", minWidth: 110, color: grandTotals.approx_surplus_value > 0 ? "#0f766e" : "#64748b" }}>
                    ₹{formatINR(grandTotals.approx_surplus_value)}
                  </td>
                  <td style={{ minWidth: 120, color: "#94a3b8" }}>—</td>
                  <td style={{ minWidth: 100, color: "#94a3b8" }}>—</td>
                  <td style={{ minWidth: 100, color: "#94a3b8" }}>—</td>
                  <td style={{ minWidth: 140, color: "#94a3b8" }}>—</td>
                  <td style={{ minWidth: 120, textAlign: "center", color: "#94a3b8" }}>—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )}

      {/* ============================================================ */}
      {/* 2. CUSTOMER DETAILS MISSING VIEW                             */}
      {/* ============================================================ */}
      {activeTab === "missing-details" && (
        <div>
          {/* Top 5 KPI Cards for Customer Details Missing */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            {/* MISSING LINES */}
            <div
              className="kpi-card"
              style={{
                background: "#ffffff",
                padding: 16,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                borderLeft: "4px solid #ea580c",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#ea580c", textTransform: "uppercase" }}>
                MISSING LINES
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
                {missingData?.kpis ? missingData.kpis.missing_lines : missingLoading ? "…" : "—"}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                Purchase lines without customer
              </div>
            </div>

            {/* AFFECTED BILLS */}
            <div
              className="kpi-card"
              style={{
                background: "#ffffff",
                padding: 16,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                borderLeft: "4px solid #dc2626",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", textTransform: "uppercase" }}>
                AFFECTED BILLS
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
                {missingData?.kpis ? missingData.kpis.affected_bills : missingLoading ? "…" : "—"}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                Distinct purchase bills
              </div>
            </div>

            {/* AFFECTED ITEMS */}
            <div
              className="kpi-card"
              style={{
                background: "#ffffff",
                padding: 16,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                borderLeft: "4px solid #d97706",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#d97706", textTransform: "uppercase" }}>
                AFFECTED ITEMS
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
                {missingData?.kpis ? missingData.kpis.affected_items : missingLoading ? "…" : "—"}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                Distinct items unmapped
              </div>
            </div>

            {/* PURCHASE QTY UNMAPPED */}
            <div
              className="kpi-card"
              style={{
                background: "#ffffff",
                padding: 16,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                borderLeft: "4px solid #b91c1c",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c", textTransform: "uppercase" }}>
                PURCHASE QTY UNMAPPED
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#b91c1c", marginTop: 4 }}>
                {missingData?.kpis ? formatQuantity(missingData.kpis.purchase_qty_unmapped) : missingLoading ? "…" : "—"}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                Excluded from customer recon
              </div>
            </div>

            {/* TAXABLE VALUE UNMAPPED */}
            <div
              className="kpi-card"
              style={{
                background: "#ffffff",
                padding: 16,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                borderLeft: "4px solid #0f766e",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#0f766e", textTransform: "uppercase" }}>
                TAXABLE VALUE UNMAPPED
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#0f766e", marginTop: 4 }}>
                ₹{missingData?.kpis ? formatINR(missingData.kpis.taxable_value_unmapped) : missingLoading ? "…" : "—"}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                Pre-GST unmapped purchase
              </div>
            </div>
          </div>

          {/* Missing Details Filter Bar */}
          <div
            className="filter-bar"
            style={{
              background: "#ffffff",
              padding: 16,
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              marginBottom: 16,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Row 1: Period, Sync Button */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                  PERIOD:
                </label>
                <select
                  value={activePeriod}
                  onChange={(e) => setActivePeriod(e.target.value)}
                  className="filter-select"
                  style={{ padding: "6px 12px", fontSize: 13 }}
                >
                  <option value="CURRENT_FY">Current FY (2026-27)</option>
                  <option value="PREVIOUS_FY">Previous FY (2025-26)</option>
                  <option value="ALL">All Time</option>
                  <option value="CUSTOM">Custom Date Range</option>
                </select>

                {activePeriod === "CUSTOM" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="filter-input"
                      style={{ padding: "4px 8px", fontSize: 12 }}
                    />
                    <span style={{ fontSize: 12, color: "#64748b" }}>to</span>
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="filter-input"
                      style={{ padding: "4px 8px", fontSize: 12 }}
                    />
                  </div>
                )}
              </div>

              {/* Sync Changed Purchase Bills Button */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setShowSyncModal(true)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontWeight: 600,
                    background: "#fffbeb",
                    color: "#b45309",
                    border: "1px solid #fde68a",
                  }}
                  title="Smart sync updated purchase bills from Zoho Books"
                >
                  <span>🔄</span>
                  Sync Changed Purchase Bills
                </button>
              </div>
            </div>

            {/* Row 2: Secondary Dropdowns & Search */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              {/* Vendor Filter */}
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 3 }}>
                  VENDOR
                </label>
                <select
                  value={missingVendor}
                  onChange={(e) => setMissingVendor(e.target.value)}
                  className="filter-select"
                  style={{ width: "100%", padding: "6px 10px", fontSize: 12.5 }}
                >
                  <option value="">All Vendors ({missingData?.filterOptions?.vendors?.length || 0})</option>
                  {missingData?.filterOptions?.vendors?.map((v) => (
                    <option key={v.id} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Item Filter */}
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 3 }}>
                  ITEM
                </label>
                <select
                  value={missingItem}
                  onChange={(e) => setMissingItem(e.target.value)}
                  className="filter-select"
                  style={{ width: "100%", padding: "6px 10px", fontSize: 12.5 }}
                >
                  <option value="">All Items ({missingData?.filterOptions?.items?.length || 0})</option>
                  {missingData?.filterOptions?.items?.map((it) => (
                    <option key={it.id} value={it.name}>
                      {it.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Affected Reconciliation Status */}
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 3 }}>
                  RECONCILIATION STATUS
                </label>
                <select
                  value={missingReconStatus}
                  onChange={(e) => setMissingReconStatus(e.target.value as any)}
                  className="filter-select"
                  style={{ width: "100%", padding: "6px 10px", fontSize: 12.5 }}
                >
                  <option value="UNMAPPED_ONLY">Unmapped Only (Default)</option>
                  <option value="ALL">All Missing Lines</option>
                  <option value="PURCHASE_ONLY">Purchase Only (0 Sales in Period)</option>
                  <option value="SHORTAGE_RELATED">Shortage-related (Has Sales in Period)</option>
                </select>
              </div>

              {/* Action Status Filter */}
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 3 }}>
                  ACTION STATUS
                </label>
                <select
                  value={missingActionStatus}
                  onChange={(e) => setMissingActionStatus(e.target.value)}
                  className="filter-select"
                  style={{ width: "100%", padding: "6px 10px", fontSize: 12.5 }}
                >
                  <option value="">All Action Statuses</option>
                  <option value="Open">Open</option>
                  <option value="Follow-up Required">Follow-up Required</option>
                  <option value="Waiting for Accounts">Waiting for Accounts</option>
                  <option value="Waiting for Vendor/Data Correction">Waiting for Vendor/Data Correction</option>
                  <option value="Resolved">Resolved</option>
                </select>
              </div>

              {/* Search Box */}
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 3 }}>
                  SEARCH (BILL, VENDOR, ITEM, SKU, DESC)
                </label>
                <input
                  type="text"
                  placeholder="Search bill no, vendor, item, sku..."
                  value={missingSearch}
                  onChange={(e) => setMissingSearch(e.target.value)}
                  className="filter-input"
                  style={{ width: "100%", padding: "6px 10px", fontSize: 12.5 }}
                />
              </div>
            </div>
          </div>

          {/* Missing Details Table */}
          <div className="table-responsive" style={{ background: "#ffffff", borderRadius: 8, border: "1px solid #e2e8f0", overflowX: "auto" }}>
            <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                  <th style={{ width: 40, textAlign: "center", padding: "10px 8px" }}>Sr.</th>
                  <th style={{ textAlign: "left", minWidth: 95, padding: "10px 10px" }}>Bill Date</th>
                  <th style={{ textAlign: "left", minWidth: 120, padding: "10px 10px" }}>Bill No.</th>
                  <th style={{ textAlign: "left", minWidth: 160, padding: "10px 10px" }}>Vendor</th>
                  <th style={{ textAlign: "left", minWidth: 180, padding: "10px 10px" }}>Item</th>
                  <th style={{ textAlign: "left", minWidth: 100, padding: "10px 10px" }}>SKU / Code</th>
                  <th style={{ textAlign: "left", minWidth: 140, padding: "10px 10px" }}>Description</th>
                  <th style={{ textAlign: "right", minWidth: 85, padding: "10px 10px" }}>Purchase Qty</th>
                  <th style={{ textAlign: "right", minWidth: 90, padding: "10px 10px" }}>Rate</th>
                  <th style={{ textAlign: "right", minWidth: 110, padding: "10px 10px" }}>Taxable Value</th>
                  <th style={{ textAlign: "center", minWidth: 130, padding: "10px 10px" }}>Customer Details</th>
                  <th style={{ textAlign: "center", minWidth: 120, padding: "10px 10px" }}>Status</th>
                  <th style={{ textAlign: "center", minWidth: 90, padding: "10px 10px" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {missingLoading ? (
                  <tr>
                    <td colSpan={13} style={{ textAlign: "center", padding: "32px 0", color: "#64748b" }}>
                      Loading Customer Details Missing lines…
                    </td>
                  </tr>
                ) : missingItems.length === 0 ? (
                  <tr>
                    <td colSpan={13} style={{ textAlign: "center", padding: "40px 0", color: "#16a34a" }}>
                      <div style={{ fontSize: 24, marginBottom: 8 }}>✓</div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>No Customer Details exceptions found.</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                        All purchase bill lines in the selected scope have valid Customer Details.
                      </div>
                    </td>
                  </tr>
                ) : (
                  missingItems.map((item, idx) => (
                    <tr
                      key={item.line_item_id || idx}
                      style={{
                        background: idx % 2 === 1 ? "#fafafa" : "#ffffff",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                    >
                      <td style={{ textAlign: "center", color: "#64748b", padding: "10px 8px" }}>{idx + 1}</td>
                      <td style={{ padding: "10px 10px" }}>{formatDisplayDate(item.bill_date)}</td>
                      <td style={{ padding: "10px 10px", fontWeight: 600 }}>
                        <button
                          type="button"
                          onClick={() => handleBillClick(item.bill_id, item.line_item_id)}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "#2563eb",
                            fontWeight: 600,
                            cursor: "pointer",
                            textDecoration: "underline",
                            fontSize: 12,
                          }}
                          title="Click to view Bill drawer and highlight line"
                        >
                          {item.bill_number}
                        </button>
                        {item.bill_url && (
                          <a
                            href={item.bill_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ marginLeft: 6, fontSize: 11, color: "#3b82f6", textDecoration: "none" }}
                            onClick={(e) => e.stopPropagation()}
                            title="Open in Zoho Books"
                          >
                            ↗
                          </a>
                        )}
                      </td>
                      <td style={{ padding: "10px 10px", color: "#334155" }}>{item.vendor_name}</td>
                      <td style={{ padding: "10px 10px", fontWeight: 600 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedItemForDetail({
                              itemId: item.item_id || item.item_name,
                              itemName: item.item_name,
                              customerId: "",
                              customerName: "",
                            });
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "#2563eb",
                            textDecoration: "underline",
                            fontWeight: 600,
                            cursor: "pointer",
                            textAlign: "left",
                            fontSize: 12,
                          }}
                          title="Click to view local item detail & evidence drawer"
                        >
                          {item.item_name}
                        </button>
                      </td>
                      <td style={{ padding: "10px 10px", color: "#64748b" }}>
                        <code>{item.sku || "—"}</code>
                      </td>
                      <td style={{ padding: "10px 10px", color: "#64748b", fontSize: 11 }}>
                        {item.description ? (item.description.length > 35 ? `${item.description.substring(0, 35)}…` : item.description) : "—"}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600, padding: "10px 10px" }}>
                        {formatQuantity(item.quantity)}
                      </td>
                      <td style={{ textAlign: "right", padding: "10px 10px" }}>
                        ₹{formatINR(item.rate)}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: "#0f172a", padding: "10px 10px" }}>
                        ₹{formatINR(item.line_total)}
                      </td>
                      <td style={{ textAlign: "center", padding: "10px 10px" }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: 4,
                            background: "#fef2f2",
                            color: "#dc2626",
                            border: "1px solid #fecaca",
                          }}
                        >
                          MISSING
                        </span>
                      </td>
                      <td style={{ textAlign: "center", padding: "10px 10px" }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: 4,
                            background: "#fff1f2",
                            color: "#be123c",
                            border: "1px solid #fecdd3",
                          }}
                        >
                          ACTION REQUIRED
                        </span>
                      </td>
                      <td style={{ textAlign: "center", padding: "10px 10px" }}>
                        <button
                          type="button"
                          onClick={() => handleOpenEditMissingLine(item)}
                          className="btn btn-sm"
                          style={{
                            padding: "3px 8px",
                            fontSize: 11,
                            background: item.action_status && item.action_status !== "Open" ? "#eff6ff" : "#f8fafc",
                            borderColor: item.action_status && item.action_status !== "Open" ? "#93c5fd" : "#cbd5e1",
                            color: item.action_status && item.action_status !== "Open" ? "#1d4ed8" : "#475569",
                            fontWeight: 600,
                          }}
                          title={item.remarks ? `Action: ${item.action_status} | ${item.remarks}` : "Update action note"}
                        >
                          {item.action_status && item.action_status !== "Open" ? item.action_status : "Action"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {/* Grand Total Sticky Footer */}
              {!missingLoading && missingItems.length > 0 && (
                <tfoot>
                  <tr
                    style={{
                      position: "sticky",
                      bottom: 0,
                      background: "#f8fafc",
                      borderTop: "2px solid #cbd5e1",
                      fontWeight: 700,
                      color: "#0f172a",
                      zIndex: 2,
                      boxShadow: "0 -2px 6px rgba(0,0,0,0.05)",
                    }}
                  >
                    <td style={{ textAlign: "left", padding: "10px 8px", fontWeight: 800, color: "#1e293b" }}>
                      GRAND TOTAL
                    </td>
                    <td style={{ textAlign: "center", padding: "10px 10px", color: "#64748b" }}>—</td>
                    <td style={{ textAlign: "left", padding: "10px 10px", fontWeight: 700 }}>
                      {missingData?.kpis?.affected_bills ?? missingGrandTotals.billIds.size} Bills
                    </td>
                    <td style={{ textAlign: "center", padding: "10px 10px", color: "#64748b" }}>—</td>
                    <td style={{ textAlign: "left", padding: "10px 10px", fontWeight: 700 }}>
                      {missingData?.kpis?.affected_items ?? missingGrandTotals.itemIds.size} Items
                    </td>
                    <td style={{ textAlign: "center", padding: "10px 10px", color: "#64748b" }}>—</td>
                    <td style={{ textAlign: "center", padding: "10px 10px", color: "#64748b" }}>—</td>
                    <td style={{ textAlign: "right", padding: "10px 10px", fontWeight: 800, color: "#b91c1c" }}>
                      {formatQuantity(missingData?.kpis?.purchase_qty_unmapped ?? missingGrandTotals.totalQty)}
                    </td>
                    <td style={{ textAlign: "center", padding: "10px 10px", color: "#64748b" }}>—</td>
                    <td style={{ textAlign: "right", padding: "10px 10px", fontWeight: 800, color: "#0f766e" }}>
                      ₹{formatINR(missingData?.kpis?.taxable_value_unmapped ?? missingGrandTotals.totalTaxable)}
                    </td>
                    <td style={{ textAlign: "center", padding: "10px 10px", color: "#64748b" }}>—</td>
                    <td style={{ textAlign: "center", padding: "10px 10px", color: "#64748b" }}>—</td>
                    <td style={{ textAlign: "center", padding: "10px 10px", color: "#64748b" }}>—</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* UPDATE ACTION MODAL */}
      {editingCustomer && (
        <div className="modal-backdrop" onClick={() => setEditingCustomer(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <div className="modal-title">Update Customer Action Note</div>
              <button onClick={() => setEditingCustomer(null)} className="btn btn-sm" style={{ border: "none", fontSize: 16 }}>
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: "#f8fafc", padding: 12, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                  {editingCustomer.customer_name}
                </div>
                <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>
                  Mismatches: {editingCustomer.mismatch_items} items · Shortage: ₹{formatINR(editingCustomer.approx_shortage_value)}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                    ACTION STATUS
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="filter-select"
                    style={{ width: "100%", padding: "7px 10px", fontSize: 12.5 }}
                  >
                    <option value="Open">Open</option>
                    <option value="Follow-up Required">Follow-up Required</option>
                    <option value="Waiting for Customer">Waiting for Customer</option>
                    <option value="Waiting for Vendor">Waiting for Vendor</option>
                    <option value="Under Review">Under Review</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                    PRIORITY
                  </label>
                  <select
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value as any)}
                    className="filter-select"
                    style={{ width: "100%", padding: "7px 10px", fontSize: 12.5 }}
                  >
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                    ACTION OWNER
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Rahul Sharma"
                    value={editOwner}
                    onChange={(e) => setEditOwner(e.target.value)}
                    className="filter-input"
                    style={{ width: "100%", padding: "7px 10px", fontSize: 12.5 }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                    NEXT FOLLOW-UP DATE
                  </label>
                  <input
                    type="date"
                    value={editFollowUpDate}
                    onChange={(e) => setEditFollowUpDate(e.target.value)}
                    className="filter-input"
                    style={{ width: "100%", padding: "6px 10px", fontSize: 12.5 }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  ACTION TAKEN
                </label>
                <input
                  type="text"
                  placeholder="e.g. Sent email to vendor for pending PO dispatch"
                  value={editActionTaken}
                  onChange={(e) => setEditActionTaken(e.target.value)}
                  className="filter-input"
                  style={{ width: "100%", padding: "7px 10px", fontSize: 12.5 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  REMARKS / FOLLOW-UP NOTES
                </label>
                <textarea
                  placeholder="Enter detailed notes or conversation history..."
                  rows={3}
                  value={editRemarks}
                  onChange={(e) => setEditRemarks(e.target.value)}
                  className="filter-input"
                  style={{ width: "100%", padding: "8px 10px", fontSize: 12.5 }}
                />
              </div>

              <div style={{ fontSize: 11, color: "#64748b", background: "#f8fafc", padding: "8px 10px", borderRadius: 4 }}>
                🔒 <strong>Local Persistence Guarantee:</strong> Changes are saved exclusively to local SQLite. Zoho Books is never modified.
              </div>
            </div>

            <div className="modal-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setEditingCustomer(null)}
                disabled={savingAction}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={handleSaveAction}
                disabled={savingAction}
              >
                {savingAction ? "Saving..." : "Save Action Note"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MISSING LINE ACTION NOTE MODAL */}
      {editingMissingLine && (
        <div className="modal-backdrop" onClick={() => setEditingMissingLine(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
            <div className="modal-header">
              <div className="modal-title">
                Action Tracker — {editingMissingLine.item_name} (Bill: {editingMissingLine.bill_number})
              </div>
              <button onClick={() => setEditingMissingLine(null)} className="btn btn-sm" style={{ border: "none", fontSize: 16 }}>
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: "#fef3c7", padding: "10px 14px", borderRadius: 6, border: "1px solid #fde68a" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>
                  ⚠️ Purchase Bill Line Item Customer Details Missing
                </div>
                <div style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>
                  Vendor: <strong>{editingMissingLine.vendor_name}</strong> · Qty: <strong>{formatQuantity(editingMissingLine.quantity)}</strong> · Taxable: <strong>₹{formatINR(editingMissingLine.line_total)}</strong>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                    ACTION STATUS
                  </label>
                  <select
                    value={editMissingStatus}
                    onChange={(e) => setEditMissingStatus(e.target.value)}
                    className="filter-select"
                    style={{ width: "100%", padding: "7px 10px", fontSize: 12.5 }}
                  >
                    <option value="Open">Open</option>
                    <option value="Follow-up Required">Follow-up Required</option>
                    <option value="Waiting for Accounts">Waiting for Accounts</option>
                    <option value="Waiting for Vendor/Data Correction">Waiting for Vendor/Data Correction</option>
                    <option value="Resolved">Resolved</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                    ACTION OWNER / ASSIGNEE
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Accounts / Purchase Team"
                    value={editMissingOwner}
                    onChange={(e) => setEditMissingOwner(e.target.value)}
                    className="filter-input"
                    style={{ width: "100%", padding: "6px 10px", fontSize: 12.5 }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  NEXT FOLLOW-UP DATE
                </label>
                <input
                  type="date"
                  value={editMissingFollowUp}
                  onChange={(e) => setEditMissingFollowUp(e.target.value)}
                  className="filter-input"
                  style={{ width: "100%", padding: "6px 10px", fontSize: 12.5 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  REMARKS / INVESTIGATION NOTES
                </label>
                <textarea
                  placeholder="Enter reason why customer is missing or follow-up status..."
                  rows={3}
                  value={editMissingRemarks}
                  onChange={(e) => setEditMissingRemarks(e.target.value)}
                  className="filter-input"
                  style={{ width: "100%", padding: "8px 10px", fontSize: 12.5 }}
                />
              </div>

              <div style={{ fontSize: 11, color: "#b45309", background: "#fffbeb", padding: "8px 10px", borderRadius: 4, border: "1px solid #fef3c7" }}>
                ⚠️ <strong>Reconciliation Rule:</strong> Setting Action Status to <em>Resolved</em> does NOT make reconciliation valid. The line becomes reconciliation-eligible only when actual source Customer Details exists in Zoho Books after next sync.
              </div>
            </div>

            <div className="modal-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setEditingMissingLine(null)}
                disabled={savingMissingAction}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={handleSaveMissingAction}
                disabled={savingMissingAction}
              >
                {savingMissingAction ? "Saving..." : "Save Line Action Note"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DOCUMENT DETAIL DRAWER (PURCHASE BILL DRAWER) */}
      {selectedBillDoc && (
        <div
          className="drawer-overlay"
          onClick={() => setSelectedBillDoc(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.45)",
            zIndex: 9999,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <div
            className="drawer-content"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "clamp(720px, 68vw, 1150px)",
              maxWidth: "100vw",
              height: "100vh",
              background: "#ffffff",
              boxShadow: "-8px 0 24px rgba(0, 0, 0, 0.15)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Drawer Header */}
            <div
              style={{
                padding: "18px 24px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#f8fafc",
              }}
            >
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px 0", color: "#0f172a" }}>
                  Purchase Bill: {selectedBillDoc.bill_number}
                </h3>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  Date: {formatDisplayDate(selectedBillDoc.date as string)} · Status: <span className="badge-enabled" style={{ display: "inline-block", padding: "1px 6px", fontSize: 11 }}>{selectedBillDoc.status || "SYNCED"}</span> · Local SQLite Cache
                </div>
              </div>
              <button
                className="btn btn-sm"
                onClick={() => setSelectedBillDoc(null)}
                style={{ fontSize: 16, padding: "4px 10px", borderRadius: "50%", border: "1px solid #cbd5e1" }}
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            {/* Drawer Body */}
            <div style={{ padding: 24, flex: 1, overflowY: "auto" }}>
              {/* Summary Cards (4 Cards Layout) */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
                <div className="metric-card" style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>VENDOR</span>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", marginTop: 4 }}>{selectedBillDoc.vendor_name || "—"}</div>
                </div>
                <div className="metric-card" style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>TAXABLE VALUE (PRE-GST)</span>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#16a34a", marginTop: 4 }}>
                    ₹{formatINR(selectedBillDoc.taxableTotal ?? 0)}
                  </div>
                </div>
                <div className="metric-card" style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>GRAND TOTAL (WITH GST)</span>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                    ₹{formatINR(selectedBillDoc.grand_total ?? 0)}
                  </div>
                </div>
                <div className="metric-card" style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>BALANCE</span>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#64748b", marginTop: 4 }}>
                    ₹{formatINR(selectedBillDoc.balance ?? 0)}
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#334155" }}>
                Document Line Items ({selectedBillDoc.lines?.length || 0} lines)
              </h4>
              <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 6, marginBottom: 20 }}>
                <table className="data-table" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9" }}>
                      <th style={{ width: 35, textAlign: "center", padding: "8px 6px" }}>#</th>
                      <th style={{ textAlign: "left", minWidth: 150, padding: "8px 10px" }}>ITEM NAME</th>
                      <th style={{ textAlign: "left", minWidth: 90, padding: "8px 10px" }}>SKU</th>
                      <th style={{ textAlign: "left", minWidth: 160, padding: "8px 10px" }}>CUSTOMER DETAILS</th>
                      <th style={{ textAlign: "right", minWidth: 80, padding: "8px 10px" }}>QUANTITY</th>
                      <th style={{ textAlign: "right", minWidth: 90, padding: "8px 10px" }}>RATE</th>
                      <th style={{ textAlign: "right", minWidth: 110, padding: "8px 10px" }}>TAXABLE TOTAL</th>
                      <th style={{ textAlign: "center", minWidth: 120, padding: "8px 10px" }}>EXCLUSION ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedBillDoc.lines?.map((line: any, lIdx: number) => {
                      const isHighlighted = highlightLineItemId && (line.line_item_id === highlightLineItemId || String(line.rowid) === highlightLineItemId);
                      return (
                        <tr
                          key={line.line_item_id || lIdx}
                          style={{
                            background: isHighlighted ? "#fef3c7" : lIdx % 2 === 1 ? "#fafafa" : "#ffffff",
                            borderLeft: isHighlighted ? "4px solid #f59e0b" : "none",
                          }}
                        >
                          <td style={{ textAlign: "center", color: "#64748b", padding: "8px 6px" }}>{lIdx + 1}</td>
                          <td style={{ fontWeight: isHighlighted ? 700 : 500, color: "#0f172a", padding: "8px 10px" }}>
                            {line.item_name}
                            {isHighlighted && (
                              <span style={{ marginLeft: 8, fontSize: 10, background: "#ea580c", color: "#ffffff", padding: "2px 6px", borderRadius: 3, fontWeight: 700 }}>
                                ⚠️ AFFECTED LINE
                              </span>
                            )}
                          </td>
                          <td style={{ color: "#64748b", padding: "8px 10px" }}><code>{line.sku || "—"}</code></td>
                          <td style={{ padding: "8px 10px" }}>
                            {line.customer_details ? (
                              <span style={{ color: "#0f172a", fontWeight: 500 }}>{line.customer_details}</span>
                            ) : (
                              <span style={{ color: "#dc2626", fontWeight: 700, fontSize: 11, background: "#fef2f2", padding: "2px 6px", borderRadius: 4, border: "1px solid #fecaca" }}>
                                ⚠️ MISSING
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 600, padding: "8px 10px" }}>{formatQuantity(Number(line.quantity || 0))}</td>
                          <td style={{ textAlign: "right", padding: "8px 10px" }}>₹{formatINR(Number(line.rate || 0))}</td>
                          <td style={{ textAlign: "right", fontWeight: 600, color: "#0f172a", padding: "8px 10px" }}>₹{formatINR(Number(line.line_total || 0))}</td>
                          <td style={{ textAlign: "center", padding: "8px 10px" }}>
                            {line.is_excluded ? (
                              <span
                                style={{
                                  fontSize: 10,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: "#fef2f2",
                                  color: "#b91c1c",
                                  fontWeight: 700,
                                  border: "1px solid #fecaca",
                                }}
                              >
                                EXCLUDED
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => {
                                  setExcludeBillLine({
                                    itemId: line.item_id || "",
                                    itemName: line.item_name || "",
                                    sku: line.sku || "",
                                    customerName: line.customer_details || "",
                                    vendorName: selectedBillDoc.vendor_name || "",
                                    billNumber: selectedBillDoc.bill_number || "",
                                    quantity: Number(line.quantity || 0),
                                    totalPurchaseQty: Number(line.quantity || 0),
                                    taxableValue: Number(line.line_total || 0),
                                    rate: Number(line.rate || 0),
                                  });
                                }}
                                style={{
                                  fontSize: 11,
                                  padding: "3px 10px",
                                  background: isHighlighted ? "#fee2e2" : "#f8fafc",
                                  color: isHighlighted ? "#b91c1c" : "#334155",
                                  border: isHighlighted ? "1px solid #fca5a5" : "1px solid #cbd5e1",
                                  fontWeight: 600,
                                  borderRadius: 4,
                                  cursor: "pointer",
                                  transition: "all 0.15s ease",
                                }}
                                title="Exclude this item from all reconciliation & analytics"
                              >
                                Exclude Item
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SELECTIVE SYNC MODAL */}
      {showSyncModal && (
        <SelectiveSyncModal
          isOpen={showSyncModal}
          initialModule="purchase_bills"
          onClose={() => setShowSyncModal(false)}
          onSyncCompleted={() => {
            setShowSyncModal(false);
            fetchData();
            fetchMissingData();
          }}
        />
      )}

      {/* VIEW ACTION HISTORY MODAL */}
      {historyCustomer && (
        <div className="modal-backdrop" onClick={() => setHistoryCustomer(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <div className="modal-header">
              <div className="modal-title">Action History — {historyCustomer.customer_name}</div>
              <button onClick={() => setHistoryCustomer(null)} className="btn btn-sm" style={{ border: "none", fontSize: 16 }}>
                ✕
              </button>
            </div>

            <div className="modal-body">
              {loadingHistory ? (
                <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
                  Loading action history audit trail…
                </div>
              ) : historyEntries.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
                  No historical action logs recorded yet for this customer.
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="data-table" style={{ width: "100%", fontSize: 11.5 }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9" }}>
                        <th>Timestamp</th>
                        <th>Status</th>
                        <th>Priority</th>
                        <th>Owner</th>
                        <th>Follow-up</th>
                        <th>Action Taken / Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyEntries.map((h) => (
                        <tr key={h.history_id}>
                          <td>{h.created_at || "—"}</td>
                          <td>
                            <span style={{ fontWeight: 600 }}>{h.action_status}</span>
                          </td>
                          <td>{h.priority || "MEDIUM"}</td>
                          <td>{h.action_owner || "—"}</td>
                          <td>{h.next_follow_up_date ? formatDisplayDate(h.next_follow_up_date) : "—"}</td>
                          <td>
                            <div>{h.action_taken}</div>
                            {h.remarks && <div style={{ fontSize: 10.5, color: "#64748b" }}>{h.remarks}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className="btn btn-sm" onClick={() => setHistoryCustomer(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Details Drawer for Item drill-down */}
      {drilldownItem && (
        <DetailsDrawer
          item={drilldownItem}
          financialYear={effectiveFinancialYear}
          onClose={() => setDrilldownItem(null)}
          onExclusionSuccess={() => {
            setDrilldownItem(null);
            fetchData();
          }}
        />
      )}

      {/* Single Item Detail Drawer */}
      {selectedItemForDetail && (
        <ItemDetailDrawer
          itemId={selectedItemForDetail.itemId}
          itemName={selectedItemForDetail.itemName}
          financialYear={effectiveFinancialYear}
          initialCustomerId={selectedItemForDetail.customerId}
          initialCustomerName={selectedItemForDetail.customerName}
          onClose={() => setSelectedItemForDetail(null)}
          onNavigateToCustomer={onNavigateToCustomer ? (id, name) => onNavigateToCustomer(id, name || "") : undefined}
          onExclusionSuccess={() => {
            setSelectedItemForDetail(null);
            fetchData();
          }}
        />
      )}

      {/* Exclusion Dialog for Purchase Bill Line */}
      {excludeBillLine && (
        <ExclusionDialog
          item={excludeBillLine}
          financialYear={period}
          onClose={() => setExcludeBillLine(null)}
          onSuccess={() => {
            setExcludeBillLine(null);
            setSelectedBillDoc(null);
            fetchData();
            fetchMissingData();
          }}
        />
      )}

      {/* Dynamic Export Field Selector Modal */}
      <ExportFieldSelector
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        reportType={activeTab === "missing-details" ? "customer-details-missing" : "action-taken"}
        totalRecords={activeTab === "missing-details" ? (missingData?.items?.length ?? 0) : (data?.customers?.length ?? 0)}
        onExport={handleExecuteExport}
      />
    </div>
  );
}

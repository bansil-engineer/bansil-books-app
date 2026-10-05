"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { formatINR, formatQuantity, formatDisplayDate } from "@/app/lib/date-utils";
import type {
  CompositeAssemblyRecord,
  AssemblyComponentRecord,
  EligiblePurchaseLine,
  AssemblyAuditRecord,
} from "@/app/lib/composite-assembly-engine";
import { ExportFieldSelector } from "./ExportFieldSelector";
import type { ExportOptions } from "@/app/types/reconciliation";

interface CompositeAssemblyViewProps {
  initialCustomerId?: string;
  initialCustomerName?: string;
  financialYear?: string;
  onNavigateToCustomer?: (customerId: string, customerName: string) => void;
}

export function CompositeAssemblyView({
  initialCustomerId,
  initialCustomerName,
  financialYear = "2026-27",
  onNavigateToCustomer,
}: CompositeAssemblyViewProps) {
  // Period filter
  const [period, setPeriod] = useState<string>(financialYear || "2026-27");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [customerFilter, setCustomerFilter] = useState<string>(initialCustomerId || "");

  // Assembly List State
  const [assemblies, setAssemblies] = useState<CompositeAssemblyRecord[]>([]);
  const [summary, setSummary] = useState<{
    totalAssemblies: number;
    confirmedAssemblies: number;
    draftAssemblies: number;
    cancelledAssemblies: number;
    totalGeneratedUnits: number;
    totalMaterialCost: number;
  }>({
    totalAssemblies: 0,
    confirmedAssemblies: 0,
    draftAssemblies: 0,
    cancelledAssemblies: 0,
    totalGeneratedUnits: 0,
    totalMaterialCost: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  // Distinct Customers for dropdown
  const [availableCustomers, setAvailableCustomers] = useState<Array<{ id: string; name: string }>>([]);

  // Create / Edit Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalMode, setModalMode] = useState<"CREATE" | "EDIT">("CREATE");
  const [editingAssemblyId, setEditingAssemblyId] = useState<string | null>(null);

  // Form Fields
  const [formCustomerId, setFormCustomerId] = useState<string>(initialCustomerId || "");
  const [formCustomerName, setFormCustomerName] = useState<string>(initialCustomerName || "");
  const [formCompositeItemId, setFormCompositeItemId] = useState<string>("");
  const [formCompositeItemName, setFormCompositeItemName] = useState<string>("");
  const [formCompositeSku, setFormCompositeSku] = useState<string>("");
  const [formGeneratedQty, setFormGeneratedQty] = useState<number>(1);
  const [formUnit, setFormUnit] = useState<string>("BUN");
  const [formAssemblyDate, setFormAssemblyDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [formReferenceNo, setFormReferenceNo] = useState<string>("");
  const [formRemarks, setFormRemarks] = useState<string>("");

  // Eligible component lines and consumed inputs
  const [eligibleLines, setEligibleLines] = useState<EligiblePurchaseLine[]>([]);
  const [loadingEligible, setLoadingEligible] = useState<boolean>(false);
  const [consumedMap, setConsumedMap] = useState<Record<string, number>>({}); // line_item_id -> qty
  const [savingAssembly, setSavingAssembly] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Detail & Audit Modal State
  const [detailAssembly, setDetailAssembly] = useState<CompositeAssemblyRecord | null>(null);
  const [detailAuditLogs, setDetailAuditLogs] = useState<AssemblyAuditRecord[]>([]);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState<boolean>(false);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);

  // Reversal Prompt Modal
  const [reversingAssembly, setReversingAssembly] = useState<CompositeAssemblyRecord | null>(null);
  const [reversalReason, setReversalReason] = useState<string>("");
  const [reversing, setReversing] = useState<boolean>(false);

  // 1. Fetch Assembly List
  const fetchAssemblies = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("financialYear", period);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (customerFilter) params.set("customerId", customerFilter);
      if (searchTerm) params.set("search", searchTerm);

      const res = await fetch(`/api/composite-assembly?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setAssemblies(json.assemblies || []);
        if (json.summary) setSummary(json.summary);
      }
    } catch (err) {
      console.error("Failed to fetch assemblies:", err);
    } finally {
      setLoading(false);
    }
  }, [period, statusFilter, customerFilter, searchTerm]);

  // 2. Fetch Customers for dropdown
  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch(`/api/customer-details?action=list&financialYear=${period}`);
      if (res.ok) {
        const json = await res.json();
        if (json.customers) {
          setAvailableCustomers(json.customers);
        }
      }
    } catch (err) {
      console.error("Failed to fetch customers:", err);
    }
  }, [period]);

  useEffect(() => {
    fetchAssemblies();
    fetchCustomers();
  }, [fetchAssemblies, fetchCustomers]);

  // 3. Fetch Eligible Lines when Customer changes in Create/Edit Modal
  const fetchEligibleLines = useCallback(async (customerId: string, excludeAsmId?: string) => {
    if (!customerId) {
      setEligibleLines([]);
      return;
    }
    try {
      setLoadingEligible(true);
      const params = new URLSearchParams();
      params.set("action", "eligible-lines");
      params.set("customerId", customerId);
      params.set("financialYear", period);
      if (excludeAsmId) params.set("excludeAssemblyId", excludeAsmId);

      const res = await fetch(`/api/composite-assembly?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setEligibleLines(json.lines || []);
      }
    } catch (err) {
      console.error("Failed to fetch eligible purchase lines:", err);
    } finally {
      setLoadingEligible(false);
    }
  }, [period]);

  // Open Create Modal
  const handleOpenCreateModal = (presetCustId?: string, presetCustName?: string) => {
    setModalMode("CREATE");
    setEditingAssemblyId(null);
    const cid = presetCustId || initialCustomerId || "";
    const cname = presetCustName || initialCustomerName || "";
    setFormCustomerId(cid);
    setFormCustomerName(cname);
    setFormCompositeItemId("");
    setFormCompositeItemName("DB with Switchgear - BUN");
    setFormCompositeSku("");
    setFormGeneratedQty(1);
    setFormUnit("BUN");
    setFormAssemblyDate(new Date().toISOString().slice(0, 10));
    setFormReferenceNo("");
    setFormRemarks("");
    setConsumedMap({});
    setFormError(null);
    setIsModalOpen(true);

    if (cid) {
      fetchEligibleLines(cid);
    } else {
      setEligibleLines([]);
    }
  };

  // Open Edit Draft Modal
  const handleOpenEditModal = async (asm: CompositeAssemblyRecord) => {
    setModalMode("EDIT");
    setEditingAssemblyId(asm.assembly_id);
    setFormCustomerId(asm.customer_id);
    setFormCustomerName(asm.customer_name);
    setFormCompositeItemId(asm.composite_item_id);
    setFormCompositeItemName(asm.composite_item_name);
    setFormCompositeSku(asm.composite_sku || "");
    setFormGeneratedQty(asm.generated_qty);
    setFormUnit(asm.unit || "BUN");
    setFormAssemblyDate(asm.assembly_date);
    setFormReferenceNo(asm.reference_no || "");
    setFormRemarks(asm.remarks || "");
    setFormError(null);

    const initialConsumed: Record<string, number> = {};
    (asm.components || []).forEach((c) => {
      initialConsumed[c.source_bill_line_item_id] = c.consumed_qty;
    });
    setConsumedMap(initialConsumed);
    setIsModalOpen(true);

    await fetchEligibleLines(asm.customer_id, asm.assembly_id);
  };

  // Open Detail / Audit Modal
  const handleOpenDetailModal = async (assemblyId: string) => {
    try {
      setLoadingDetail(true);
      setIsDetailModalOpen(true);
      const res = await fetch(`/api/composite-assembly?action=detail&assemblyId=${assemblyId}`);
      if (res.ok) {
        const json = await res.json();
        setDetailAssembly(json.assembly);
        setDetailAuditLogs(json.auditLogs || []);
      }
    } catch (err) {
      console.error("Failed to load assembly detail:", err);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Handle Consumed Quantity Change
  const handleConsumedChange = (lineItemId: string, valStr: string, maxAvailable: number) => {
    const val = parseFloat(valStr);
    if (isNaN(val) || val <= 0) {
      const next = { ...consumedMap };
      delete next[lineItemId];
      setConsumedMap(next);
      return;
    }

    if (val > maxAvailable + 0.0001) {
      setFormError(`Cannot consume ${val} units. Maximum available is ${maxAvailable}.`);
    } else {
      setFormError(null);
    }

    setConsumedMap((prev) => ({
      ...prev,
      [lineItemId]: val,
    }));
  };

  // Live Material Reference Cost Calculations
  const calculatedCost = useMemo(() => {
    let totalCost = 0;
    let componentCount = 0;

    for (const line of eligibleLines) {
      const consumed = consumedMap[line.line_item_id] || 0;
      if (consumed > 0) {
        totalCost += consumed * line.purchase_rate;
        componentCount++;
      }
    }

    const costPerUnit = formGeneratedQty > 0 ? totalCost / formGeneratedQty : 0;
    return {
      totalCost,
      costPerUnit,
      componentCount,
    };
  }, [eligibleLines, consumedMap, formGeneratedQty]);

  // Save Assembly (Draft or Confirm)
  const handleSaveAssembly = async (confirmImmediately: boolean = false) => {
    try {
      setFormError(null);
      if (!formCustomerId) {
        setFormError("Please select a Customer.");
        return;
      }
      if (!formCompositeItemName.trim()) {
        setFormError("Please enter Finished Composite Item Name.");
        return;
      }
      if (formGeneratedQty <= 0) {
        setFormError("Generated Quantity must be greater than 0.");
        return;
      }

      // Build components payload
      const selectedComponents = eligibleLines
        .filter((line) => (consumedMap[line.line_item_id] || 0) > 0)
        .map((line) => ({
          source_bill_id: line.bill_id,
          source_bill_number: line.bill_number,
          source_bill_date: line.bill_date,
          source_bill_line_item_id: line.line_item_id,
          component_item_id: line.item_id,
          component_item_name: line.item_name,
          component_sku: line.sku,
          vendor_name: line.vendor_name,
          raw_purchase_qty: line.raw_purchase_qty,
          consumed_qty: consumedMap[line.line_item_id],
          purchase_rate: line.purchase_rate,
        }));

      if (selectedComponents.length === 0) {
        setFormError("Please allocate at least one component purchase line.");
        return;
      }

      // Check over-consumption
      for (const comp of selectedComponents) {
        const line = eligibleLines.find((l) => l.line_item_id === comp.source_bill_line_item_id);
        if (line && comp.consumed_qty > line.available_qty + 0.0001) {
          setFormError(`Over-consumption rejected for ${comp.component_item_name}. Max available: ${line.available_qty}`);
          return;
        }
      }

      setSavingAssembly(true);

      const payload = {
        customerId: formCustomerId,
        customerName: formCustomerName,
        compositeItemId: formCompositeItemId || `item_comp_${formCompositeItemName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
        compositeItemName: formCompositeItemName.trim(),
        compositeSku: formCompositeSku.trim(),
        generatedQty: formGeneratedQty,
        unit: formUnit.trim() || "BUN",
        assemblyDate: formAssemblyDate,
        referenceNo: formReferenceNo.trim(),
        remarks: formRemarks.trim(),
        components: selectedComponents,
      };

      let savedAsmId = editingAssemblyId;

      if (modalMode === "CREATE") {
        const res = await fetch("/api/composite-assembly", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create-draft", ...payload }),
        });
        const resJson = await res.json();
        if (!res.ok) throw new Error(resJson.error || "Failed to create assembly");
        savedAsmId = resJson.assembly.assembly_id;
      } else {
        const res = await fetch("/api/composite-assembly", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update-draft", assemblyId: editingAssemblyId, ...payload }),
        });
        const resJson = await res.json();
        if (!res.ok) throw new Error(resJson.error || "Failed to update assembly");
        savedAsmId = resJson.assembly.assembly_id;
      }

      // If confirm immediately
      if (confirmImmediately && savedAsmId) {
        const confirmRes = await fetch("/api/composite-assembly", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "confirm", assemblyId: savedAsmId }),
        });
        const confirmJson = await confirmRes.json();
        if (!confirmRes.ok) throw new Error(confirmJson.error || "Failed to confirm assembly");
      }

      setIsModalOpen(false);
      await fetchAssemblies();
    } catch (err: any) {
      console.error("Save assembly error:", err);
      setFormError(err.message || "An error occurred while saving assembly.");
    } finally {
      setSavingAssembly(false);
    }
  };

  // Direct Confirm Assembly Action
  const handleConfirmDirect = async (assemblyId: string) => {
    if (!confirm("Are you sure you want to CONFIRM this assembly? It will immediately consume component quantities and reflect the composite finished item in active reconciliation.")) {
      return;
    }
    try {
      const res = await fetch("/api/composite-assembly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", assemblyId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to confirm assembly");
      await fetchAssemblies();
      if (isDetailModalOpen) {
        await handleOpenDetailModal(assemblyId);
      }
    } catch (err: any) {
      alert(`Confirmation failed: ${err.message}`);
    }
  };

  // Execute Reversal
  const handleExecuteReversal = async () => {
    if (!reversingAssembly) return;
    try {
      setReversing(true);
      const res = await fetch("/api/composite-assembly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reverse",
          assemblyId: reversingAssembly.assembly_id,
          reason: reversalReason.trim() || "User cancelled assembly",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to cancel assembly");

      setReversingAssembly(null);
      setReversalReason("");
      await fetchAssemblies();
      if (isDetailModalOpen && detailAssembly?.assembly_id === reversingAssembly.assembly_id) {
        await handleOpenDetailModal(reversingAssembly.assembly_id);
      }
    } catch (err: any) {
      alert(`Reversal failed: ${err.message}`);
    } finally {
      setReversing(false);
    }
  };

  // Export handlers
  const [showExportModal, setShowExportModal] = useState(false);

  const handleExecuteExport = async (options: ExportOptions) => {
    try {
      setExporting(options.format || "excel");
      const params = new URLSearchParams();
      params.set("reportType", "composite-assembly");
      params.set("financialYear", period);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (customerFilter) params.set("customerId", customerFilter);
      if (searchTerm) params.set("search", searchTerm);
      if (options.selectedFields && options.selectedFields.length > 0) {
        params.set("selectedFields", options.selectedFields.join(","));
      }
      if (typeof options.includeTotals === "boolean") {
        params.set("includeTotals", String(options.includeTotals));
      }

      const endpoint = options.format === "excel" ? `/api/export/excel?${params.toString()}` : `/api/export/pdf?${params.toString()}`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Bansil_Composite_Assemblies_${period}_${new Date().toISOString().slice(0, 10)}.${options.format === "excel" ? "xlsx" : "pdf"}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Export error:", err);
      alert("Export failed. Please try again.");
    } finally {
      setExporting(null);
      setShowExportModal(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* 1. Header & Title Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-slate-900 via-sky-950 to-slate-900 border border-sky-800/40 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-48 h-48 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="space-y-1.5 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center shadow-inner">
              <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                Local Manual Composite Assembly
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-medium">
                  100% Local SQLite
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Customer-wise Component Purchase → Finished Bundle (BUN) Conversion · Non-Destructive Reconciliation
              </p>
            </div>
          </div>
        </div>

        {/* Top Actions */}
        <div className="flex items-center gap-3 z-10 flex-wrap">
          <button
            onClick={() => setShowExportModal(true)}
            disabled={exporting !== null}
            className="px-3 py-2 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 text-xs rounded-xl font-medium flex items-center gap-1.5 transition shadow-sm hover:text-white"
          >
            <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM6 20V4h7v5h5v11H6z" />
            </svg>
            {exporting ? "Exporting..." : "Export Report..."}
          </button>
          <button
            onClick={() => handleOpenCreateModal()}
            className="px-4 py-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-sky-500/25 transition transform active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Composite Assembly
          </button>
        </div>
      </div>

      {/* 2. KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-sm">
          <div className="text-xs text-slate-400 font-medium mb-1">Total Assemblies</div>
          <div className="text-2xl font-bold text-white">{summary.totalAssemblies}</div>
          <div className="text-xs text-slate-500 mt-1">
            <span className="text-emerald-400 font-medium">{summary.confirmedAssemblies} confirmed</span>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-sm">
          <div className="text-xs text-slate-400 font-medium mb-1">Confirmed Material Cost</div>
          <div className="text-2xl font-bold text-emerald-400">{formatINR(summary.totalMaterialCost)}</div>
          <div className="text-xs text-slate-500 mt-1">Material reference cost</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-sm">
          <div className="text-xs text-slate-400 font-medium mb-1">Generated Units</div>
          <div className="text-2xl font-bold text-sky-400">{formatQuantity(summary.totalGeneratedUnits)} <span className="text-sm font-normal text-slate-400">BUN</span></div>
          <div className="text-xs text-slate-500 mt-1">Active in reconciliation</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-sm">
          <div className="text-xs text-slate-400 font-medium mb-1">Draft Assemblies</div>
          <div className="text-2xl font-bold text-amber-400">{summary.draftAssemblies}</div>
          <div className="text-xs text-slate-500 mt-1">No reconciliation impact yet</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-sm">
          <div className="text-xs text-slate-400 font-medium mb-1">Cancelled / Reversed</div>
          <div className="text-2xl font-bold text-slate-400">{summary.cancelledAssemblies}</div>
          <div className="text-xs text-slate-500 mt-1">Components restored</div>
        </div>
      </div>

      {/* 3. Filter Bar */}
      <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 backdrop-blur-sm space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-950/80 rounded-xl border border-slate-800/80">
            {["ALL", "CONFIRMED", "DRAFT", "CANCELLED"].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  statusFilter === st
                    ? "bg-sky-500/20 text-sky-300 border border-sky-400/30 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {st === "ALL" ? "All Assemblies" : st}
              </button>
            ))}
          </div>

          {/* Search and Period */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search Assembly #, Item, Ref..."
                className="w-56 px-3 py-1.5 pl-8 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition"
              />
              <svg className="w-4 h-4 text-slate-500 absolute left-2.5 top-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            {/* Customer Dropdown */}
            <select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-sky-500 transition max-w-[200px]"
            >
              <option value="">All Customers</option>
              {availableCustomers.map((c) => (
                <option key={c.id || c.name} value={c.id || c.name}>
                  {c.name}
                </option>
              ))}
            </select>

            {/* Period Dropdown */}
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-sky-500 transition"
            >
              <option value="2026-27">FY 2026-27</option>
              <option value="2025-26">FY 2025-26</option>
              <option value="ALL">All Financial Years</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4. Master Assemblies Table */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl overflow-hidden shadow-lg backdrop-blur-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800/80 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Assembly #</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Finished Item</th>
                <th className="py-3 px-4 text-right">Generated Qty</th>
                <th className="py-3 px-4 text-right">Material Cost</th>
                <th className="py-3 px-4 text-right">Cost / Unit</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4">Ref / Remarks</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <div className="inline-flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                      Loading composite assemblies...
                    </div>
                  </td>
                </tr>
              ) : assemblies.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-500">
                    <div className="space-y-2">
                      <p>No composite assemblies found matching current filters.</p>
                      <button
                        onClick={() => handleOpenCreateModal()}
                        className="px-3 py-1.5 bg-sky-500/20 text-sky-300 border border-sky-400/30 rounded-lg text-xs font-medium hover:bg-sky-500/30 transition"
                      >
                        + Create First Assembly
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                assemblies.map((asm) => {
                  const isConfirmed = asm.status === "CONFIRMED";
                  const isDraft = asm.status === "DRAFT";
                  const isCancelled = asm.status === "CANCELLED";

                  return (
                    <tr
                      key={asm.assembly_id}
                      className="hover:bg-slate-800/40 transition group cursor-pointer"
                      onClick={() => handleOpenDetailModal(asm.assembly_id)}
                    >
                      <td className="py-3 px-4 font-mono font-medium text-sky-400 flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-sky-400/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        {asm.assembly_number}
                      </td>
                      <td className="py-3 px-4 text-slate-400">{formatDisplayDate(asm.assembly_date)}</td>
                      <td className="py-3 px-4 font-medium text-slate-200">
                        {onNavigateToCustomer ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onNavigateToCustomer(asm.customer_id, asm.customer_name);
                            }}
                            className="hover:text-sky-400 hover:underline text-left"
                          >
                            {asm.customer_name}
                          </button>
                        ) : (
                          asm.customer_name
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-white">{asm.composite_item_name}</div>
                        {asm.composite_sku && <div className="text-[10px] text-slate-500 font-mono">SKU: {asm.composite_sku}</div>}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-medium text-white">
                        {formatQuantity(asm.generated_qty)} <span className="text-[10px] text-slate-400 font-normal">{asm.unit || "BUN"}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-emerald-400 font-medium">
                        {formatINR(asm.total_material_cost)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-300">
                        {formatINR(asm.cost_per_unit)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ${
                            isConfirmed
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40"
                              : isDraft
                              ? "bg-amber-500/20 text-amber-300 border border-amber-400/40"
                              : "bg-slate-700/40 text-slate-400 border border-slate-600/40 line-through"
                          }`}
                        >
                          {asm.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400 max-w-[160px] truncate">
                        {asm.reference_no || asm.remarks || "—"}
                      </td>
                      <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleOpenDetailModal(asm.assembly_id)}
                            className="p-1 hover:bg-slate-700/60 rounded text-slate-400 hover:text-sky-300 transition"
                            title="View Detail & Breakdown"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>

                          {isDraft && (
                            <>
                              <button
                                onClick={() => handleOpenEditModal(asm)}
                                className="p-1 hover:bg-slate-700/60 rounded text-slate-400 hover:text-amber-300 transition"
                                title="Edit Draft"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleConfirmDirect(asm.assembly_id)}
                                className="px-2 py-0.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-400/30 rounded text-[11px] font-medium transition"
                                title="Confirm Assembly"
                              >
                                Confirm
                              </button>
                            </>
                          )}

                          {isConfirmed && (
                            <button
                              onClick={() => {
                                setReversingAssembly(asm);
                                setReversalReason("");
                              }}
                              className="px-2 py-0.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded text-[11px] font-medium transition"
                              title="Reverse Assembly"
                            >
                              Reverse
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Create / Edit Assembly Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-400/30 flex items-center justify-center">
                  <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {modalMode === "CREATE" ? "Create Composite Assembly" : "Edit Draft Assembly"}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Allocate purchased components to create a composite item for customer
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white transition p-1 rounded-lg hover:bg-slate-800"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {formError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 flex items-center gap-2">
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <span>{formError}</span>
                </div>
              )}

              {/* Step 1: Customer & Assembly Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-slate-950/50 rounded-xl border border-slate-800/80">
                <div className="sm:col-span-2">
                  <label className="block text-slate-400 font-medium mb-1">Target Customer *</label>
                  <select
                    value={formCustomerId}
                    disabled={modalMode === "EDIT"}
                    onChange={(e) => {
                      const cid = e.target.value;
                      const cust = availableCustomers.find((c) => (c.id || c.name) === cid);
                      setFormCustomerId(cid);
                      setFormCustomerName(cust?.name || cid);
                      setConsumedMap({});
                      fetchEligibleLines(cid);
                    }}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 focus:border-sky-500 focus:outline-none transition disabled:opacity-60"
                  >
                    <option value="">-- Select Customer --</option>
                    {availableCustomers.map((c) => (
                      <option key={c.id || c.name} value={c.id || c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Assembly Date *</label>
                  <input
                    type="date"
                    value={formAssemblyDate}
                    onChange={(e) => setFormAssemblyDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 focus:border-sky-500 focus:outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Reference No (PO/Challan)</label>
                  <input
                    type="text"
                    value={formReferenceNo}
                    placeholder="e.g. PO-2026-99"
                    onChange={(e) => setFormReferenceNo(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 focus:border-sky-500 focus:outline-none transition"
                  />
                </div>
              </div>

              {/* Step 2: Finished Composite Item Specification */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-sky-950/20 rounded-xl border border-sky-900/30">
                <div className="sm:col-span-2">
                  <label className="block text-sky-300 font-medium mb-1">Finished / Composite Item Name *</label>
                  <input
                    type="text"
                    value={formCompositeItemName}
                    placeholder="e.g. DB with Switchgear - BUN"
                    onChange={(e) => setFormCompositeItemName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-sky-800/60 rounded-xl text-white font-medium focus:border-sky-400 focus:outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-sky-300 font-medium mb-1">Generated Qty *</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={formGeneratedQty}
                    onChange={(e) => setFormGeneratedQty(Math.max(1, parseFloat(e.target.value) || 1))}
                    className="w-full px-3 py-2 bg-slate-900 border border-sky-800/60 rounded-xl text-white font-mono font-medium focus:border-sky-400 focus:outline-none transition text-right"
                  />
                </div>

                <div>
                  <label className="block text-sky-300 font-medium mb-1">Unit</label>
                  <input
                    type="text"
                    value={formUnit}
                    placeholder="BUN"
                    onChange={(e) => setFormUnit(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-sky-800/60 rounded-xl text-slate-200 focus:border-sky-400 focus:outline-none transition"
                  />
                </div>
              </div>

              {/* Step 3: Eligible Component Purchase Lines */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-slate-200 flex items-center gap-2">
                    <span>Component Purchase Allocations</span>
                    <span className="text-slate-400 font-normal">
                      ({calculatedCost.componentCount} components allocated)
                    </span>
                  </h4>
                  <span className="text-[11px] text-slate-400">
                    Enter quantity to consume from each Purchase Bill line
                  </span>
                </div>

                {loadingEligible ? (
                  <div className="py-8 text-center text-slate-400">Loading customer purchase lines...</div>
                ) : eligibleLines.length === 0 ? (
                  <div className="py-8 text-center bg-slate-950/40 rounded-xl border border-slate-800 text-slate-500">
                    {formCustomerId
                      ? "No available Purchase Bill lines found for this customer in selected period."
                      : "Please select a Customer above to view available component purchase lines."}
                  </div>
                ) : (
                  <div className="border border-slate-800 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="sticky top-0 bg-slate-950 z-10 border-b border-slate-800 text-slate-400 text-[11px] uppercase">
                        <tr>
                          <th className="py-2.5 px-3">Bill # & Date</th>
                          <th className="py-2.5 px-3">Vendor</th>
                          <th className="py-2.5 px-3">Component Item</th>
                          <th className="py-2.5 px-3 text-right">Available Qty</th>
                          <th className="py-2.5 px-3 text-right">Purchase Rate</th>
                          <th className="py-2.5 px-3 text-center w-36">Consume Qty</th>
                          <th className="py-2.5 px-3 text-right">Material Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50 text-slate-300">
                        {eligibleLines.map((line) => {
                          const consumed = consumedMap[line.line_item_id] || 0;
                          const isAllocated = consumed > 0;
                          const lineCost = consumed * line.purchase_rate;

                          return (
                            <tr
                              key={line.line_item_id}
                              className={`transition ${isAllocated ? "bg-sky-950/20" : "hover:bg-slate-800/30"}`}
                            >
                              <td className="py-2 px-3 font-mono">
                                <div>{line.bill_number}</div>
                                <div className="text-[10px] text-slate-500">{formatDisplayDate(line.bill_date)}</div>
                              </td>
                              <td className="py-2 px-3 text-slate-400 truncate max-w-[140px]">{line.vendor_name}</td>
                              <td className="py-2 px-3 font-medium text-white">
                                <div>{line.item_name}</div>
                                {line.sku && <div className="text-[10px] text-slate-500 font-mono">SKU: {line.sku}</div>}
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-300">
                                {formatQuantity(line.available_qty)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-300">
                                {formatINR(line.purchase_rate)}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <input
                                    type="number"
                                    min="0"
                                    max={line.available_qty}
                                    step="any"
                                    value={consumed || ""}
                                    placeholder="0"
                                    onChange={(e) =>
                                      handleConsumedChange(line.line_item_id, e.target.value, line.available_qty)
                                    }
                                    className={`w-24 px-2 py-1 bg-slate-900 border rounded text-right font-mono font-medium focus:outline-none transition ${
                                      consumed > line.available_qty
                                        ? "border-rose-500 text-rose-300 bg-rose-950/30"
                                        : isAllocated
                                        ? "border-sky-500 text-sky-200 bg-sky-950/40"
                                        : "border-slate-700 text-slate-200"
                                    }`}
                                  />
                                  {line.available_qty > 0 && !isAllocated && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleConsumedChange(line.line_item_id, String(line.available_qty), line.available_qty)
                                      }
                                      className="text-[10px] px-1.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded"
                                      title="Consume All Available"
                                    >
                                      All
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-emerald-400 font-medium">
                                {isAllocated ? formatINR(lineCost) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Step 4: Live Material Reference Cost Summary Card */}
              <div className="p-4 bg-gradient-to-r from-slate-950 to-slate-900 border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-inner">
                <div>
                  <div className="text-[11px] text-slate-400 uppercase font-semibold tracking-wider">
                    Material Reference Cost Valuation
                  </div>
                  <div className="text-xs text-slate-500">
                    Sum of all consumed component purchase rates
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400">Total Material Cost</div>
                    <div className="text-base font-bold text-emerald-400 font-mono">
                      {formatINR(calculatedCost.totalCost)}
                    </div>
                  </div>
                  <div className="text-right border-l border-slate-800 pl-6">
                    <div className="text-[10px] text-sky-300 font-semibold">Cost Per {formUnit || "BUN"}</div>
                    <div className="text-base font-bold text-sky-400 font-mono">
                      {formatINR(calculatedCost.costPerUnit)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-slate-400 font-medium mb-1">Assembly Remarks / Notes</label>
                <textarea
                  rows={2}
                  value={formRemarks}
                  placeholder="e.g. Assembled for Project X as requested by client..."
                  onChange={(e) => setFormRemarks(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:border-sky-500 focus:outline-none transition resize-none"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-medium transition"
              >
                Cancel
              </button>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={savingAssembly || calculatedCost.componentCount === 0}
                  onClick={() => handleSaveAssembly(false)}
                  className="px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 rounded-xl font-medium transition disabled:opacity-50"
                >
                  {savingAssembly ? "Saving..." : "Save as Draft"}
                </button>
                <button
                  type="button"
                  disabled={savingAssembly || calculatedCost.componentCount === 0}
                  onClick={() => handleSaveAssembly(true)}
                  className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold rounded-xl shadow-lg shadow-emerald-500/25 transition transform active:scale-95 disabled:opacity-50"
                >
                  {savingAssembly ? "Processing..." : "Save & Confirm"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Assembly Detail & Component Breakdown Modal */}
      {isDetailModalOpen && detailAssembly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-400/30 flex items-center justify-center font-mono font-bold text-sky-400 text-xs">
                  ASM
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    Assembly {detailAssembly.assembly_number}
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                        detailAssembly.status === "CONFIRMED"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40"
                          : detailAssembly.status === "DRAFT"
                          ? "bg-amber-500/20 text-amber-300 border border-amber-400/40"
                          : "bg-slate-700/40 text-slate-400 border border-slate-600/40 line-through"
                      }`}
                    >
                      {detailAssembly.status}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Customer: <span className="text-slate-200 font-medium">{detailAssembly.customer_name}</span> · Date: {formatDisplayDate(detailAssembly.assembly_date)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsDetailModalOpen(false)}
                className="text-slate-400 hover:text-white transition p-1 rounded-lg hover:bg-slate-800"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {/* Finished Composite Item Card */}
              <div className="p-4 bg-sky-950/20 border border-sky-900/40 rounded-xl grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="sm:col-span-2">
                  <div className="text-[10px] text-sky-300 uppercase font-semibold">Finished / Composite Item</div>
                  <div className="text-base font-bold text-white mt-0.5">{detailAssembly.composite_item_name}</div>
                  {detailAssembly.composite_sku && <div className="text-[11px] text-slate-400 font-mono">SKU: {detailAssembly.composite_sku}</div>}
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">Generated Output</div>
                  <div className="text-base font-bold text-sky-400 font-mono mt-0.5">
                    {formatQuantity(detailAssembly.generated_qty)} {detailAssembly.unit || "BUN"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">Material Reference Cost</div>
                  <div className="text-base font-bold text-emerald-400 font-mono mt-0.5">
                    {formatINR(detailAssembly.cost_per_unit)} <span className="text-xs font-normal text-slate-400">/ unit</span>
                  </div>
                </div>
              </div>

              {/* Consumed Components Table */}
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-200">Allocated Component Lines</h4>
                <div className="border border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 text-[11px] uppercase">
                      <tr>
                        <th className="py-2.5 px-3">Source Bill #</th>
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Vendor</th>
                        <th className="py-2.5 px-3">Component Item</th>
                        <th className="py-2.5 px-3 text-right">Raw Qty</th>
                        <th className="py-2.5 px-3 text-right">Consumed Qty</th>
                        <th className="py-2.5 px-3 text-right">Rate</th>
                        <th className="py-2.5 px-3 text-right">Material Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50 text-slate-300">
                      {(detailAssembly.components || []).map((comp) => (
                        <tr key={comp.assembly_component_id} className="hover:bg-slate-800/30">
                          <td className="py-2 px-3 font-mono text-sky-400">{comp.source_bill_number || "—"}</td>
                          <td className="py-2 px-3 text-slate-400">{formatDisplayDate(comp.source_bill_date)}</td>
                          <td className="py-2 px-3 text-slate-400 truncate max-w-[120px]">{comp.vendor_name || "—"}</td>
                          <td className="py-2 px-3 font-medium text-white">{comp.component_item_name}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-400">{formatQuantity(comp.raw_purchase_qty)}</td>
                          <td className="py-2 px-3 text-right font-mono text-sky-300 font-bold">{formatQuantity(comp.consumed_qty)}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-300">{formatINR(comp.purchase_rate ?? 0)}</td>
                          <td className="py-2 px-3 text-right font-mono text-emerald-400 font-medium">{formatINR(comp.purchase_amount ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-950 border-t border-slate-800 font-medium">
                      <tr>
                        <td colSpan={7} className="py-2.5 px-3 text-right text-slate-300">Total Material Cost:</td>
                        <td className="py-2.5 px-3 text-right font-mono text-emerald-400 font-bold text-sm">
                          {formatINR(detailAssembly.total_material_cost ?? 0)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Audit Trail */}
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-200">Assembly Audit Trail</h4>
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 space-y-2 max-h-36 overflow-y-auto">
                  {detailAuditLogs.map((log) => (
                    <div key={log.audit_id} className="flex items-center justify-between text-slate-400 text-[11px] border-b border-slate-800/40 pb-1.5 last:border-0 last:pb-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-300">{log.action}</span>
                        <span>by {log.actor}</span>
                        {log.details && <span className="text-slate-500 italic">— {log.details}</span>}
                      </div>
                      <span className="font-mono text-slate-500">{new Date(log.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between">
              <button
                onClick={() => setIsDetailModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-medium transition"
              >
                Close
              </button>

              <div className="flex items-center gap-3">
                {detailAssembly.status === "DRAFT" && (
                  <button
                    onClick={() => handleConfirmDirect(detailAssembly.assembly_id)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold transition"
                  >
                    Confirm Assembly
                  </button>
                )}
                {detailAssembly.status === "CONFIRMED" && (
                  <button
                    onClick={() => {
                      setReversingAssembly(detailAssembly);
                      setReversalReason("");
                    }}
                    className="px-4 py-2 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 rounded-xl font-medium transition"
                  >
                    Reverse Assembly
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. Reversal Confirmation Modal */}
      {reversingAssembly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-rose-900/40 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-400/30 flex items-center justify-center text-rose-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Reverse Assembly?</h3>
                <p className="text-xs text-slate-400">
                  {reversingAssembly.assembly_number} ({reversingAssembly.composite_item_name})
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Reversing this assembly will immediately restore the consumed component quantities to the customer&apos;s available pool and remove the generated {reversingAssembly.generated_qty} {reversingAssembly.unit} from active reconciliation.
            </p>

            <div>
              <label className="block text-slate-400 text-xs font-medium mb-1">Reason for Reversal *</label>
              <input
                type="text"
                value={reversalReason}
                placeholder="e.g. Purchase mismatch resolved or erroneous assembly"
                onChange={(e) => setReversalReason(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:border-rose-500 focus:outline-none transition"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setReversingAssembly(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl font-medium transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reversing}
                onClick={handleExecuteReversal}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl transition shadow-lg shadow-rose-600/30"
              >
                {reversing ? "Reversing..." : "Confirm Reversal"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Export Field Selector Modal */}
      <ExportFieldSelector
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        reportType="composite-assembly"
        totalRecords={assemblies.length}
        onExport={handleExecuteExport}
      />
    </div>
  );
}

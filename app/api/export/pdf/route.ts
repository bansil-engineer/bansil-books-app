// ============================================================
// Bansil Books Analytics — Local-Only PDF Export API Route
// Read-Only · Zero Zoho Mutation · Single Source of Truth
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";
import { generateReconciliationReport } from "@/app/lib/reconciliation-engine";
import { generateMasterInventoryMismatchReport } from "@/app/lib/inventory-mismatch-engine";
import {
  buildPdfDocument,
  buildMasterInventoryMismatchPdf,
  buildGlobalBreakdownPdf,
  buildPriceReferencePdf,
  buildCustomerDetailsPdf,
  buildActionTakenPdf,
  buildCompositeAssemblyPdf,
  buildCustomerDetailsMissingPdf,
  buildCashBooksPdf,
} from "@/app/lib/export/pdf-builder";
import { getPriceReferenceData } from "@/app/lib/price-reference-engine";
import { getCustomerDetailsData } from "@/app/lib/customer-details-engine";
import { getActionTakenData, getCustomerDetailsMissingData } from "@/app/lib/action-taken-engine";
import { getAssemblyList } from "@/app/lib/composite-assembly-engine";
import { buildCustomerMaterialPdf, buildAllPendingCustomersPdf } from "@/app/lib/export/customer-material-pdf-builder";
import { buildStockPdf } from "@/app/lib/export/stock-pdf-builder";
import { getStockSummary } from "@/app/lib/stock-engine";
import {
  getCustomerMaterialControlReport,
  getPendingCustomersSummary,
  getCustomerMissingPurchaseLines,
  CustomerMaterialControlReport,
} from "@/app/lib/customer-material-control-engine";
import { getDatabase, getActivityLogs } from "@/app/lib/db/database";
import { generateExportFilename } from "@/app/lib/export/export-utils";
import { getActivityDateRange } from "@/app/lib/date-period-utils";
import { buildZohoActivityPdf } from "@/app/lib/export/zoho-activity-export-builder";
import type { ReconciliationFilter, ExportOptions, ExportFieldKey, ItemClassification, ExportReportType } from "@/app/types/reconciliation";

export const dynamic = "force-dynamic";

function parseFilter(searchParams: URLSearchParams): ReconciliationFilter {
  return {
    financialYear: searchParams.get("financialYear") || "2025-26",
    fromDate: searchParams.get("fromDate") || undefined,
    toDate: searchParams.get("toDate") || undefined,
    period: searchParams.get("period") || undefined,
    operationalTab: (searchParams.get("operationalTab") as ReconciliationFilter["operationalTab"]) || undefined,
    customerId: searchParams.get("customerId") || undefined,
    customerName: searchParams.get("customerName") || undefined,
    itemId: searchParams.get("itemId") || undefined,
    itemName: searchParams.get("itemName") || undefined,
    sku: searchParams.get("sku") || undefined,
    vendorName: searchParams.get("vendorName") || undefined,
    search: searchParams.get("search") || searchParams.get("itemSearch") || undefined,
    status: searchParams.get("status") || undefined,
    classification: (searchParams.get("classification") as ItemClassification) || undefined,
  };
}

export async function GET(request: NextRequest) {
  const disabled = requireFeaturesEnabled("module_export");
  if (disabled) return disabled;
  try {
    const searchParams = request.nextUrl.searchParams;
    const reportType = searchParams.get("reportType");
    const filter = parseFilter(searchParams);

    const selectedFieldsParam = searchParams.get("selectedFields");
    const selectedFields = selectedFieldsParam
      ? (selectedFieldsParam.split(",").map((s) => s.trim()) as ExportFieldKey[])
      : undefined;
    const includeTotalsParam = searchParams.get("includeTotals");
    const includeTotals = includeTotalsParam !== null ? includeTotalsParam === "true" || includeTotalsParam === "1" : true;

    const exportOptions: ExportOptions = {
      selectedFields,
      includeTotals,
      format: "pdf",
    };

    let buffer: Buffer;
    let filename: string;

    if (reportType === "zoho-activity" || reportType === "activity") {
      const db = getDatabase();
      const preset = searchParams.get("preset") || searchParams.get("period") || "CURRENT_FY";
      const customFrom = searchParams.get("fromDate");
      const customTo = searchParams.get("toDate");
      const range = getActivityDateRange(preset, customFrom || undefined, customTo || undefined);
      const user = searchParams.get("user") || undefined;
      const moduleFilter = searchParams.get("module") || undefined;
      const action = searchParams.get("action") || undefined;
      const search = searchParams.get("search") || undefined;

      const { activities } = getActivityLogs(db, {
        fromDate: range.fromDate,
        toDate: range.toDate,
        user,
        module: moduleFilter,
        action,
        search,
      });

      buffer = buildZohoActivityPdf(activities, {
        selectedFields: selectedFields as string[] | undefined,
        financialYear: filter.financialYear,
        period: range.label,
      });
      filename = `Zoho_Activity_Logs_${filter.financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "action-taken") {
      const db = getDatabase();
      const statusFilter = (searchParams.get("statusFilter") || "MISMATCH_ONLY") as "MISMATCH_ONLY" | "ALL" | "RECONCILED_ONLY";
      const actionData = getActionTakenData(db, {
        financialYear: filter.financialYear,
        fromDate: filter.fromDate,
        toDate: filter.toDate,
        statusFilter,
        search: filter.search,
        actionStatusFilter: searchParams.get("actionStatus") || undefined,
        actionOwnerFilter: searchParams.get("actionOwner") || undefined,
        mismatchTypeFilter: (searchParams.get("mismatchType") as any) || undefined,
        priorityFilter: searchParams.get("priority") || undefined,
      });
      buffer = buildActionTakenPdf({
        kpis: actionData.kpis,
        customers: actionData.customers,
        financialYear: filter.financialYear,
        period: filter.period,
        statusFilter,
      }, exportOptions);
      filename = `Bansil_Action_Taken_${statusFilter}_${filter.financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "customer-details-missing") {
      const db = getDatabase();
      const reconStatusFilter = (searchParams.get("reconStatusFilter") || "UNMAPPED_ONLY") as any;
      const missingData = getCustomerDetailsMissingData(db, {
        financialYear: filter.financialYear,
        fromDate: filter.fromDate,
        toDate: filter.toDate,
        vendor: filter.vendorName || searchParams.get("vendor") || undefined,
        item: filter.itemId || filter.itemName || searchParams.get("item") || undefined,
        search: filter.search,
        reconStatusFilter,
        actionStatusFilter: searchParams.get("actionStatusFilter") || undefined,
      });
      buffer = buildCustomerDetailsMissingPdf({
        kpis: missingData.kpis,
        items: missingData.items,
        financialYear: filter.financialYear,
        period: filter.period,
        reconStatusFilter,
        search: filter.search,
      }, exportOptions);
      filename = `Bansil_Customer_Details_Missing_${filter.financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "composite-assembly") {
      const db = getDatabase();
      const asmData = getAssemblyList(db, {
        customerId: filter.customerId,
        compositeItemId: filter.itemId,
        status: filter.status,
        search: filter.search,
        financialYear: filter.financialYear,
        fromDate: filter.fromDate,
        toDate: filter.toDate,
      });
      buffer = buildCompositeAssemblyPdf(
        asmData.assemblies,
        asmData.summary,
        filter.period || filter.financialYear || "FY 2026-27"
      );
      filename = `Bansil_Composite_Assemblies_${filter.financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "full-breakdown") {
      const report = generateMasterInventoryMismatchReport(filter);
      buffer = buildGlobalBreakdownPdf(report, exportOptions);
      filename = `Bansil_Full_Breakdown_${filter.period || filter.financialYear || "FY2025-26"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "master-inventory-mismatch") {
      const report = generateMasterInventoryMismatchReport(filter);
      if (report.items.length > 500) {
        return NextResponse.json(
          {
            error: "Large report — Excel export recommended for performance.",
            rowCount: report.items.length,
          },
          { status: 400 }
        );
      }
      buffer = buildMasterInventoryMismatchPdf(report, exportOptions);
      filename = `Bansil_Master_Inventory_Mismatch_${filter.financialYear || "2025-26"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "price-reference") {
      const priceType = (searchParams.get("priceType") || "ALL").toUpperCase() as "PURCHASE" | "SALES" | "ALL";
      const priceFilter = (searchParams.get("priceFilter") || "ALL").toUpperCase() as "ALL" | "LOWEST" | "HIGHEST" | "LATEST";
      const sort = (searchParams.get("sort") || "NEWEST").toUpperCase() as "NEWEST" | "OLDEST" | "PRICE_DESC" | "PRICE_ASC" | "QTY_DESC";
      const result = getPriceReferenceData({
        financialYear: filter.financialYear,
        fromDate: filter.fromDate,
        toDate: filter.toDate,
        priceType,
        itemId: filter.itemId,
        sku: filter.sku,
        customerId: filter.customerId,
        vendorId: filter.vendorName,
        priceFilter,
        search: filter.search,
        sort,
      });
      buffer = buildPriceReferencePdf(result, exportOptions);
      filename = `Bansil_Price_Reference_${filter.period || filter.financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "customer-details") {
      const db = getDatabase();
      const data = getCustomerDetailsData(db, {
        customerId: filter.customerId,
        customerName: filter.customerName,
        financialYear: filter.financialYear,
        period: filter.period,
        fromDate: filter.fromDate,
        toDate: filter.toDate,
      });
      buffer = buildCustomerDetailsPdf(data || {}, exportOptions);
      const safeCustName = (data?.customer?.name || filter.customerId || "Customer").replace(/[^a-zA-Z0-9_-]/g, "_");
      filename = `Bansil_Customer_360_${safeCustName}_${filter.financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "customer-material-control") {
      const db = getDatabase();
      const custId = filter.customerId || searchParams.get("customerId") || undefined;
      const custName = filter.customerName || searchParams.get("customerName") || undefined;
      const statusFilter = searchParams.get("statusFilter") || undefined;
      const vendorFilter = searchParams.get("vendorFilter") || filter.vendorName || undefined;
      const actionStatusFilter = searchParams.get("actionStatus") || undefined;
      const showReconciled = searchParams.get("showReconciled") === "true";

      const report = getCustomerMaterialControlReport(db, {
        customerId: custId,
        customerName: custName,
        financialYear: filter.financialYear,
        period: filter.period,
        fromDate: filter.fromDate,
        toDate: filter.toDate,
        itemSearch: filter.search,
        statusFilter,
        vendorFilter,
        actionStatusFilter,
        showReconciled,
      });

      if (!report || !report.customer || !report.items || report.items.length === 0) {
        return NextResponse.json({ error: "PDF export failed: report data is empty." }, { status: 400 });
      }

      try {
        buffer = buildCustomerMaterialPdf(report, {
          selectedFields: exportOptions.selectedFields,
          includeTotals: exportOptions.includeTotals,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "PDF export failed: report data is empty.";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      const safeCust = (report.summary.customer_name || "Customer").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 20);
      filename = `Bansil_Customer_Material_Control_${safeCust}_${filter.financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "all-pending-customer-material") {
      const db = getDatabase();
      const customerIdsParam = searchParams.get("customerIds");
      let targetCustomerIds: string[] = [];

      if (customerIdsParam) {
        targetCustomerIds = customerIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
      } else {
        const pendingSummary = getPendingCustomersSummary(db, {
          financialYear: filter.financialYear,
          period: filter.period,
          fromDate: filter.fromDate,
          toDate: filter.toDate,
        });
        targetCustomerIds = pendingSummary.customers.map((c) => c.customer_id);
      }

      const reports: CustomerMaterialControlReport[] = [];
      for (const cid of targetCustomerIds) {
        const rep = getCustomerMaterialControlReport(db, {
          customerId: cid,
          financialYear: filter.financialYear,
          period: filter.period,
          fromDate: filter.fromDate,
          toDate: filter.toDate,
        });
        if (rep) reports.push(rep);
      }

      if (reports.length === 0) {
        return NextResponse.json({ error: "PDF export failed: no pending customers found." }, { status: 400 });
      }

      const unmapped = getCustomerMissingPurchaseLines(db, filter.financialYear);
      try {
        buffer = buildAllPendingCustomersPdf(reports, {
          periodLabel: filter.period || filter.financialYear || "FY2026-27",
          fromDate: filter.fromDate,
          toDate: filter.toDate,
          unmappedLinesCount: unmapped.count,
          unmappedQty: unmapped.total_qty,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "PDF export failed: report data is empty.";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      filename = `Bansil_Customer_Material_Control_ALL_PENDING_${filter.financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "stock" || reportType === "inventory-stock") {
      const stockSummary = getStockSummary({
        financialYear: filter.financialYear,
        fromDate: filter.fromDate,
        toDate: filter.toDate,
        itemSearch: filter.search || filter.itemName || searchParams.get("itemSearch") || undefined,
        classification: (filter.classification as any) || undefined,
        stockStatus: searchParams.get("stockStatus") || undefined,
        customerId: filter.customerId,
        vendorName: filter.vendorName,
      });

      if (!stockSummary || !stockSummary.items || stockSummary.items.length === 0) {
        return NextResponse.json(
          { error: `No stock records found for period ${filter.financialYear || "FY 2026-27"}` },
          { status: 400 }
        );
      }

      const periodLabel = filter.period || filter.financialYear || "FY2025-26";
      buffer = buildStockPdf(stockSummary, periodLabel, {
        selectedFields: exportOptions.selectedFields,
        includeTotals: exportOptions.includeTotals,
      });
      filename = `Bansil_Stock_${periodLabel}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else {
      const report = generateReconciliationReport(filter);
      if (report.summaryItems.length > 500) {
        return NextResponse.json(
          {
            error: "Large report — Excel export recommended for performance.",
            rowCount: report.summaryItems.length,
          },
          { status: 400 }
        );
      }
      buffer = buildPdfDocument(report, exportOptions);
      filename = generateExportFilename(filter, "pdf");
    }

    const uint8Array = new Uint8Array(buffer);

    return new Response(uint8Array, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const disabled = requireFeaturesEnabled("module_export");
  if (disabled) return disabled;
  try {
    const body = await request.json().catch(() => ({}));
    const filter: ReconciliationFilter = {
      financialYear: body.financialYear || "2025-26",
      fromDate: body.fromDate,
      toDate: body.toDate,
      period: body.period,
      customerId: body.customerId,
      customerName: body.customerName,
      itemId: body.itemId,
      vendorName: body.vendorName,
      status: body.status,
      search: body.search,
      sku: body.sku,
      classification: body.classification as ItemClassification | undefined,
    };

    const reportType = (body.reportType || "summary") as string;

    const exportOptions: ExportOptions = {
      selectedFields: (body.selectedFields as ExportFieldKey[]) || undefined,
      includeTotals: body.includeTotals !== false,
      includeMetadata: body.includeMetadata !== false,
      sortBy: body.sortBy,
      sortOrder: body.sortOrder,
      format: "pdf",
    };

    let buffer: Buffer;
    let filename: string;

    if (reportType === "action-taken") {
      const db = getDatabase();
      const statusFilter = (body.statusFilter || "MISMATCH_ONLY") as "MISMATCH_ONLY" | "ALL" | "RECONCILED_ONLY";
      const actionData = getActionTakenData(db, {
        financialYear: filter.financialYear,
        fromDate: filter.fromDate,
        toDate: filter.toDate,
        statusFilter,
        search: filter.search,
        actionStatusFilter: body.actionStatus,
        actionOwnerFilter: body.actionOwner,
        mismatchTypeFilter: body.mismatchType,
        priorityFilter: body.priority,
      });
      buffer = buildActionTakenPdf({
        kpis: actionData.kpis,
        customers: actionData.customers,
        financialYear: filter.financialYear,
        period: filter.period,
        statusFilter,
      }, exportOptions);
      filename = `Bansil_Action_Taken_${statusFilter}_${filter.financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "customer-details-missing") {
      const db = getDatabase();
      const reconStatusFilter = (body.reconStatusFilter || "UNMAPPED_ONLY") as any;
      const missingData = getCustomerDetailsMissingData(db, {
        financialYear: filter.financialYear,
        fromDate: filter.fromDate,
        toDate: filter.toDate,
        vendor: filter.vendorName || body.vendor || undefined,
        item: filter.itemId || filter.itemName || body.item || undefined,
        search: filter.search,
        reconStatusFilter,
        actionStatusFilter: body.actionStatus || undefined,
      });
      buffer = buildCustomerDetailsMissingPdf({
        kpis: missingData.kpis,
        items: missingData.items,
        financialYear: filter.financialYear,
        period: filter.period,
        reconStatusFilter,
        search: filter.search,
      }, exportOptions);
      filename = `Bansil_Customer_Details_Missing_${filter.financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "composite-assembly") {
      const db = getDatabase();
      const asmData = getAssemblyList(db, {
        customerId: filter.customerId,
        compositeItemId: filter.itemId,
        status: filter.status,
        search: filter.search,
        financialYear: filter.financialYear,
        fromDate: filter.fromDate,
        toDate: filter.toDate,
      });
      buffer = buildCompositeAssemblyPdf(
        asmData.assemblies,
        asmData.summary,
        filter.period || filter.financialYear || "FY 2026-27"
      );
      filename = `Bansil_Composite_Assemblies_${filter.financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "full-breakdown") {
      const report = generateMasterInventoryMismatchReport(filter);
      buffer = buildGlobalBreakdownPdf(report, exportOptions);
      filename = `Bansil_Full_Breakdown_${filter.period || filter.financialYear || "FY2025-26"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "master-inventory-mismatch") {
      const report = generateMasterInventoryMismatchReport(filter);
      if (report.items.length > 500) {
        return NextResponse.json(
          {
            error: "Large report — Excel export recommended for performance.",
            rowCount: report.items.length,
          },
          { status: 400 }
        );
      }
      buffer = buildMasterInventoryMismatchPdf(report, exportOptions);
      filename = `Bansil_Master_Inventory_Mismatch_${filter.financialYear || "2025-26"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "price-reference") {
      const priceType = (body.priceType || "ALL").toUpperCase() as "PURCHASE" | "SALES" | "ALL";
      const priceFilter = (body.priceFilter || "ALL").toUpperCase() as "ALL" | "LOWEST" | "HIGHEST" | "LATEST";
      const sort = (body.sort || "NEWEST").toUpperCase() as "NEWEST" | "OLDEST" | "PRICE_DESC" | "PRICE_ASC" | "QTY_DESC";
      const result = getPriceReferenceData({
        financialYear: filter.financialYear,
        fromDate: filter.fromDate,
        toDate: filter.toDate,
        priceType,
        itemId: filter.itemId,
        sku: filter.sku,
        customerId: filter.customerId,
        vendorId: filter.vendorName,
        priceFilter,
        search: filter.search,
        sort,
      });
      buffer = buildPriceReferencePdf(result, exportOptions);
      filename = `Bansil_Price_Reference_${filter.period || filter.financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "customer-details") {
      const db = getDatabase();
      const data = getCustomerDetailsData(db, {
        customerId: filter.customerId,
        customerName: filter.customerName,
        financialYear: filter.financialYear,
        period: filter.period,
        fromDate: filter.fromDate,
        toDate: filter.toDate,
      });
      buffer = buildCustomerDetailsPdf(data || {}, exportOptions);
      const safeCustName = (data?.customer?.name || filter.customerId || "Customer").replace(/[^a-zA-Z0-9_-]/g, "_");
      filename = `Bansil_Customer_360_${safeCustName}_${filter.financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "customer-material-control") {
      const db = getDatabase();
      const custId = filter.customerId || body.customerId || undefined;
      const custName = filter.customerName || body.customerName || undefined;
      const statusFilter = body.statusFilter || undefined;
      const vendorFilter = body.vendorFilter || filter.vendorName || undefined;
      const actionStatusFilter = body.actionStatus || undefined;
      const showReconciled = body.showReconciled === true;

      const report = getCustomerMaterialControlReport(db, {
        customerId: custId,
        customerName: custName,
        financialYear: filter.financialYear,
        period: filter.period,
        fromDate: filter.fromDate,
        toDate: filter.toDate,
        itemSearch: filter.search,
        statusFilter,
        vendorFilter,
        actionStatusFilter,
        showReconciled,
      });

      if (!report || !report.customer || !report.items || report.items.length === 0) {
        return NextResponse.json({ error: "PDF export failed: report data is empty." }, { status: 400 });
      }

      try {
        buffer = buildCustomerMaterialPdf(report, {
          selectedFields: exportOptions.selectedFields,
          includeTotals: exportOptions.includeTotals,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "PDF export failed: report data is empty.";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      const safeCust = (report.summary.customer_name || "Customer").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 20);
      filename = `Bansil_Customer_Material_Control_${safeCust}_${filter.financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "all-pending-customer-material") {
      const db = getDatabase();
      let targetCustomerIds: string[] = [];

      if (Array.isArray(body.customerIds)) {
        targetCustomerIds = (body.customerIds as unknown[]).map(String).map((s: string) => s.trim()).filter(Boolean);
      } else if (Array.isArray(body.selectedCustomerIds)) {
        targetCustomerIds = (body.selectedCustomerIds as unknown[]).map(String).map((s: string) => s.trim()).filter(Boolean);
      } else if (typeof body.customerIds === "string" && body.customerIds) {
        targetCustomerIds = body.customerIds.split(",").map((s: string) => s.trim()).filter(Boolean);
      } else {
        const pendingSummary = getPendingCustomersSummary(db, {
          financialYear: filter.financialYear,
          period: filter.period,
          fromDate: filter.fromDate,
          toDate: filter.toDate,
        });
        targetCustomerIds = pendingSummary.customers.map((c) => c.customer_id);
      }

      const reports: CustomerMaterialControlReport[] = [];
      for (const cid of targetCustomerIds) {
        const rep = getCustomerMaterialControlReport(db, {
          customerId: cid,
          financialYear: filter.financialYear,
          period: filter.period,
          fromDate: filter.fromDate,
          toDate: filter.toDate,
        });
        if (rep) reports.push(rep);
      }

      if (reports.length === 0) {
        return NextResponse.json({ error: "PDF export failed: no pending customers found." }, { status: 400 });
      }

      const unmapped = getCustomerMissingPurchaseLines(db, filter.financialYear);
      try {
        buffer = buildAllPendingCustomersPdf(reports, {
          periodLabel: filter.period || filter.financialYear || "FY2026-27",
          fromDate: filter.fromDate,
          toDate: filter.toDate,
          unmappedLinesCount: unmapped.count,
          unmappedQty: unmapped.total_qty,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "PDF export failed: report data is empty.";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      filename = `Bansil_Customer_Material_Control_ALL_PENDING_${filter.financialYear || "FY2026-27"}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "stock" || reportType === "inventory-stock") {
      const stockSummary = getStockSummary({
        financialYear: filter.financialYear,
        fromDate: filter.fromDate,
        toDate: filter.toDate,
        itemSearch: filter.search || filter.itemName || body.itemSearch || undefined,
        classification: (filter.classification as any) || undefined,
        stockStatus: body.stockStatus || undefined,
        customerId: filter.customerId,
        vendorName: filter.vendorName,
      });

      if (!stockSummary || !stockSummary.items || stockSummary.items.length === 0) {
        return NextResponse.json(
          { error: `No stock records found for period ${filter.financialYear || "FY 2026-27"}` },
          { status: 400 }
        );
      }

      const periodLabel = filter.period || filter.financialYear || "FY2025-26";
      buffer = buildStockPdf(stockSummary, periodLabel, {
        selectedFields: exportOptions.selectedFields,
        includeTotals: exportOptions.includeTotals,
      });
      filename = `Bansil_Stock_${periodLabel}_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "cash-books") {
      buffer = buildCashBooksPdf(body.data);
      filename = `Bansil_Engineers_Cash_Books_${body.data?.financialYear || "FY2025-26"}.pdf`;
    } else {
      const report = generateReconciliationReport(filter);
      if (report.summaryItems.length > 500) {
        return NextResponse.json(
          {
            error: "Large report — Excel export recommended for performance.",
            rowCount: report.summaryItems.length,
          },
          { status: 400 }
        );
      }
      buffer = buildPdfDocument(report, exportOptions);
      filename = generateExportFilename(filter, "pdf");
    }

    const uint8Array = new Uint8Array(buffer);

    return new Response(uint8Array, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}



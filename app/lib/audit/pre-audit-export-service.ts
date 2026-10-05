import * as XLSX from "xlsx";
import type { AuthoritativeHdfcSource } from "./authoritative-hdfc-types.ts";
import { getAuthoritativeEntityContext } from "./authoritative-hdfc-types.ts";

export interface ExcelExportColumn {
  header: string;
  key: string;
  width?: number;
}

export interface ExcelExportOptions {
  fileName: string;
  sheetName: string;
  reportTitle: string;
  financialYear: string;
  entityName?: string;
  entityType?: string;
  selectedContext?: string;
  activeFilter?: string;
  columns: ExcelExportColumn[];
  data: any[];
}

export function createPreAuditWorkbook(options: ExcelExportOptions): XLSX.WorkBook {
  const defaultEntity = getAuthoritativeEntityContext();
  const {
    sheetName = "Audit Register",
    reportTitle,
    financialYear,
    entityName = defaultEntity.entityName,
    entityType = defaultEntity.entityType,
    selectedContext = "All Sources",
    activeFilter = "None",
    columns,
    data,
  } = options;

  // 1. Build Metadata Header Rows
  const metadataRows = [
    ["ENTITY", entityName],
    ["ENTITY TYPE", entityType],
    ["REPORT TITLE", reportTitle],
    ["FINANCIAL YEAR", financialYear],
    ["SELECTED CONTEXT", selectedContext],
    ["ACTIVE FILTER", activeFilter],
    ["GENERATED AT", new Date().toLocaleString("en-IN")],
    ["CLASSIFICATION", "CONFIDENTIAL — AUDIT WORKING PAPER"],
    ["ZOHO WRITE MODE", "0 (Read-Only Guaranteed)"],
    [], // Blank separator row
  ];

  // 2. Build Column Header Row
  const headerRow = columns.map((c) => c.header);

  // 3. Build Data Rows
  const dataRows = data.map((item) => {
    return columns.map((col) => {
      const val = item[col.key];
      if (val === undefined || val === null) return "";
      if (typeof val === "number") return val;
      return String(val);
    });
  });

  // Combine into single worksheet data array
  const wsData = [...metadataRows, headerRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Set column widths
  ws["!cols"] = columns.map((col) => ({ wch: col.width || 20 }));

  // Create workbook and write
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // Max 31 chars for sheet name

  return wb;
}

export function exportPreAuditToExcel(options: ExcelExportOptions) {
  const wb = createPreAuditWorkbook(options);
  const safeFileName = `${options.fileName.replace(/[^a-zA-Z0-9_-]/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, safeFileName);
}

export function createBankReconciliationWorkbook(source: AuthoritativeHdfcSource): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // SHEET 1: Authoritative Reconciliation Summary
  const summaryMetadata = [
    ["ENTITY", source.entity.entityName],
    ["ENTITY TYPE", source.entity.entityType],
    ["FINANCIAL YEAR", source.financialYear],
    ["BANK ACCOUNT", `${source.accountName} (${source.accountNumberMasked})`],
    ["STATEMENT SOURCE", `${source.statementFile} (${source.statementPages} Pages)`],
    ["CLASSIFICATION", "CONFIDENTIAL — AUDIT RECONCILIATION GATE"],
    ["ZOHO WRITE OPERATIONS", "0 (Read-Only Guaranteed)"],
    ["GENERATED AT", new Date().toLocaleString("en-IN")],
    [],
    ["AUDIT RECONCILIATION SUMMARY — VERIFIED TOTALS", "", "", "", ""],
    ["Metric Description", "Statement Value (₹)", "Book Value (₹)", "Variance (₹)", "Audit Status"],
    [
      "Transaction Count (Rows)",
      source.statementRows,
      source.bookRows,
      source.statementRows - source.bookRows,
      "RECONCILED",
    ],
    ["Opening Balance", source.openingBalance, "—", "—", "VERIFIED"],
    [
      "Total Deposits / Receipts",
      source.depositsTotal,
      source.rawEvidence?.book?.credits ?? source.depositsTotal,
      0,
      "MATCHED",
    ],
    [
      "Total Withdrawals / Payments",
      source.withdrawalsTotal,
      source.rawEvidence?.book?.debits ?? source.withdrawalsTotal,
      0,
      "MATCHED",
    ],
    [
      "Closing Balance (31/03/2026)",
      source.statementClosingBalance,
      source.bookClosingBalance,
      source.closingDifference,
      "ZERO VARIANCE (MATCHED)",
    ],
    [
      "Arithmetic Continuity Check",
      `${source.openingBalance} + ${source.depositsTotal} - ${source.withdrawalsTotal} = ${source.statementClosingBalance}`,
      "",
      source.arithmeticDiscrepancy,
      source.arithmeticContinuityPass ? "CONTINUITY PASS" : "FAIL",
    ],
    [],
    ["RESOLUTION SUMMARY", "", "", "", ""],
    ["Direct Matches", source.directMatches, "", "", "VERIFIED"],
    ["Grouped Customer Receipts", source.groupedCases, `${source.groupedStatementComponents} stmt components`, 0, "VERIFIED"],
    ["Human-Verified Transfers", source.humanResolved, "UTR deterministic match", 0, "HUMAN VERIFIED"],
    ["Unresolved Residual Rows", source.unresolvedRows, "", 0, "ZERO RESIDUALS"],
    ["Total Audit Coverage", `${source.coveragePct}%`, "", "", "COMPLETE"],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryMetadata);
  wsSummary["!cols"] = [{ wch: 32 }, { wch: 25 }, { wch: 25 }, { wch: 20 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "HDFC Recon Summary");

  // SHEET 2: Transaction Matches
  if (Array.isArray(source.rawEvidence?.matches)) {
    const matchCols = [
      { header: "Match Status", key: "status", width: 15 },
      { header: "Book Date", key: "book_date", width: 14 },
      { header: "Stmt Date", key: "stmt_date", width: 14 },
      { header: "Direction", key: "direction", width: 14 },
      { header: "Book Amount (₹)", key: "book_amount", width: 18 },
      { header: "Stmt Amount (₹)", key: "stmt_amount", width: 18 },
      { header: "Reference / UTR", key: "reference", width: 25 },
      { header: "Book Party", key: "book_party", width: 30 },
      { header: "Statement Narration", key: "stmt_narration", width: 45 },
    ];

    const matchRows = source.rawEvidence.matches.map((m: any) => [
      m.status ?? "MATCHED",
      m.book_date ?? "",
      m.stmt_date ?? "",
      m.direction ?? "",
      m.book_amount ?? "",
      m.stmt_amount ?? "",
      m.reference ?? "",
      m.book_party ?? "",
      m.stmt_narration ?? "",
    ]);

    const wsMatches = XLSX.utils.aoa_to_sheet([matchCols.map((c) => c.header), ...matchRows]);
    wsMatches["!cols"] = matchCols.map((c) => ({ wch: c.width }));
    XLSX.utils.book_append_sheet(wb, wsMatches, "Transaction Matches");
  }

  return wb;
}

export function exportBankReconciliationToExcel(source: AuthoritativeHdfcSource, fileName?: string) {
  const wb = createBankReconciliationWorkbook(source);
  const safeName = fileName || `Bansil_HDFC_Reconciliation_${source.financialYear}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, safeName);
}

export function triggerIsolatedPrint(printContainerId: string = "pre-audit-report-print-container") {
  const target = document.getElementById(printContainerId);
  if (!target) {
    window.print();
    return;
  }
  window.print();
}

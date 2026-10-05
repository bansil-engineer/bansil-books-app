import React from "react";
import type { ExportOptions, ReconciliationFilter } from "../types/reconciliation";
import { ExportFieldSelector } from "./ExportFieldSelector";
import { getReportExportConfig } from "../lib/export/export-field-config";

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  reportType?: string;
  filter?: ReconciliationFilter | Record<string, unknown>;
  totalRecords?: number;
  onExport?: (options: ExportOptions) => Promise<void>;
  excelEnabled?: boolean;
  pdfEnabled?: boolean;
}

/**
 * ExportDialog - Backward-compatible wrapper around the global ExportFieldSelector.
 */
export function ExportDialog(props: ExportDialogProps) {
  return <ExportFieldSelector {...props} />;
}

export { ExportFieldSelector };

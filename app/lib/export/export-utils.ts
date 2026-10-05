// ============================================================
// Bansil Books Analytics — Export Filename & Safety Utilities
// ============================================================

import type { ReconciliationFilter } from "../../types/reconciliation.ts";

/**
 * Generates a clean, sanitized filename adhering to Section 15:
 * Examples:
 * Bansil_Reconciliation_FY2025-26_2026-09-10.xlsx
 * Bansil_Reconciliation_Lantec_FY2025-26.xlsx
 */
export function generateExportFilename(
  filter: ReconciliationFilter,
  extension: "xlsx" | "pdf",
  reportType: string = "Reconciliation"
): string {
  const parts: string[] = ["Bansil", reportType];

  if (filter.customerName) {
    // Extract first 1-2 words or alphanumeric
    const cleanCust = filter.customerName
      .replace(/[^a-zA-Z0-9]/g, "_")
      .split("_")
      .filter(Boolean)
      .slice(0, 2)
      .join("_");
    if (cleanCust) parts.push(cleanCust);
  } else if (filter.customerId) {
    parts.push(filter.customerId.replace(/[^a-zA-Z0-9]/g, ""));
  }

  if (filter.itemName) {
    const cleanItem = filter.itemName
      .replace(/[^a-zA-Z0-9]/g, "_")
      .split("_")
      .filter(Boolean)
      .slice(0, 2)
      .join("_");
    if (cleanItem) parts.push(cleanItem);
  }

  const fy = (filter.financialYear || "2025-26").replace(/[^a-zA-Z0-9-]/g, "");
  parts.push(`FY${fy}`);

  const today = new Date().toISOString().slice(0, 10);
  parts.push(today);

  const base = parts.join("_").replace(/_+/g, "_");
  return `${base}.${extension}`;
}

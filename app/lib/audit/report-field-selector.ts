// ============================================================
// Bansil Books Analytics — Internal Review Report Selectors (Milestone D)
// Mirrors the existing dynamic report field-selector pattern
// (app/lib/export/export-field-config.ts): an EXPLICIT empty selection
// blocks the export and must show a message; the ABSENCE of any saved
// selection (undefined/null) falls back to the approved defaults. These
// two states are never confused.
//
// Two independent layers, both following the same contract:
//  - SECTION SELECTOR: which report sections appear at all (Summary,
//    Scope & Coverage, Sources, Matching Summary, Findings, Action Taken,
//    Unmatched/Residual, Reviewer Decisions).
//  - FIELD/COLUMN SELECTOR: for each TABULAR section, which columns of
//    that table are rendered. Selecting zero columns for a section that
//    is itself selected blocks the export (that section cannot render
//    with no columns) — never silently falls back to defaults.
// ============================================================

export interface ReportSectionConfig {
  key: string;
  label: string;
  defaultSelected: boolean;
}

export const REPORT_SECTIONS: ReportSectionConfig[] = [
  { key: "summary", label: "Summary", defaultSelected: true },
  { key: "scope_coverage", label: "Scope & Coverage", defaultSelected: true },
  { key: "sources", label: "Sources", defaultSelected: true },
  { key: "matching_summary", label: "Matching Summary", defaultSelected: true },
  { key: "findings", label: "Findings", defaultSelected: true },
  { key: "action_taken", label: "Action Taken", defaultSelected: true },
  { key: "unmatched_residual", label: "Unmatched / Residual", defaultSelected: true },
  { key: "reviewer_decisions", label: "Reviewer Decisions", defaultSelected: true },
];

export const REPORT_SECTION_KEYS = REPORT_SECTIONS.map((s) => s.key);

export class ReportFieldSelectionError extends Error {}

/**
 * Resolves the effective list of SECTIONS to render for an export.
 * - `undefined`/`null` (no saved selection was ever made) -> approved defaults.
 * - `[]` (owner explicitly cleared every section) -> blocks the export.
 * - Any non-empty array -> only the recognized keys within it, in
 *   REPORT_SECTIONS order (never re-ordered by client-submitted order).
 */
export function resolveSelectedSections(selectedFields: string[] | undefined | null): string[] {
  if (selectedFields === undefined || selectedFields === null) {
    return REPORT_SECTIONS.filter((s) => s.defaultSelected).map((s) => s.key);
  }
  if (selectedFields.length === 0) {
    throw new ReportFieldSelectionError(
      "No report sections are selected. Select at least one section before exporting, or remove your saved selection to use the approved defaults."
    );
  }
  const validKeys = new Set(REPORT_SECTION_KEYS);
  const requested = new Set(selectedFields.filter((k) => validKeys.has(k)));
  if (requested.size === 0) {
    throw new ReportFieldSelectionError("None of the selected report sections are recognized.");
  }
  return REPORT_SECTIONS.filter((s) => requested.has(s.key)).map((s) => s.key);
}

// ============================================================
// FIELD / COLUMN SELECTOR — per tabular section
// ============================================================

export interface TableFieldConfig {
  key: string;
  label: string;
  type: "text" | "number" | "currency" | "status";
  defaultSelected: boolean;
  /** Only additive numeric/currency fields may ever receive a totals row — never IDs/text/status. */
  totalSupported?: boolean;
}

export const FINDINGS_FIELDS: TableFieldConfig[] = [
  { key: "finding_id", label: "Finding ID", type: "text", defaultSelected: false },
  { key: "domain", label: "Domain", type: "text", defaultSelected: true },
  { key: "severity", label: "Severity", type: "status", defaultSelected: true },
  { key: "finding_type", label: "Finding Type", type: "text", defaultSelected: true },
  { key: "title", label: "Title", type: "text", defaultSelected: true },
  { key: "confirmed_vs_suspected", label: "Confirmed/Suspected", type: "status", defaultSelected: true },
  { key: "financial_impact", label: "Financial Impact", type: "currency", defaultSelected: true, totalSupported: true },
  { key: "residual", label: "Residual", type: "currency", defaultSelected: false, totalSupported: true },
  { key: "status", label: "Status", type: "status", defaultSelected: true },
  { key: "evidence_ref", label: "Evidence Ref", type: "text", defaultSelected: true },
];

export const ACTIONS_FIELDS: TableFieldConfig[] = [
  { key: "action_id", label: "Action ID", type: "text", defaultSelected: false },
  { key: "finding_id", label: "Finding ID", type: "text", defaultSelected: true },
  { key: "action_owner", label: "Owner", type: "text", defaultSelected: true },
  { key: "priority", label: "Priority", type: "status", defaultSelected: true },
  { key: "due_date", label: "Due Date", type: "text", defaultSelected: true },
  { key: "action_status", label: "Status", type: "status", defaultSelected: true },
  { key: "action_comment", label: "Comment", type: "text", defaultSelected: false },
  { key: "closed_by", label: "Closed By", type: "text", defaultSelected: false },
  { key: "completed_at", label: "Closure Date", type: "text", defaultSelected: false },
];

export const COVERAGE_FIELDS: TableFieldConfig[] = [
  { key: "domain", label: "Domain", type: "text", defaultSelected: true },
  { key: "status", label: "Status", type: "status", defaultSelected: true },
  { key: "source_coverage_note", label: "Source Coverage", type: "text", defaultSelected: true },
  { key: "tests_performed", label: "Tests Performed", type: "text", defaultSelected: true },
  { key: "matched_amount", label: "Matched", type: "currency", defaultSelected: true, totalSupported: true },
  { key: "unresolved_amount", label: "Unresolved", type: "currency", defaultSelected: true, totalSupported: true },
  { key: "limitations", label: "Limitations", type: "text", defaultSelected: true },
];

export const MATCHING_SUMMARY_FIELDS: TableFieldConfig[] = [
  { key: "match_type", label: "Match Type", type: "text", defaultSelected: true },
  { key: "count", label: "Count", type: "number", defaultSelected: true, totalSupported: true },
  { key: "allocated_amount", label: "Allocated Amount", type: "currency", defaultSelected: true, totalSupported: true },
  { key: "residual", label: "Residual", type: "currency", defaultSelected: true, totalSupported: true },
  { key: "absolute_residual", label: "Absolute Residual", type: "currency", defaultSelected: false, totalSupported: true },
];

export const TABLE_FIELD_REGISTRY: Record<string, TableFieldConfig[]> = {
  findings: FINDINGS_FIELDS,
  action_taken: ACTIONS_FIELDS,
  scope_coverage: COVERAGE_FIELDS,
  matching_summary: MATCHING_SUMMARY_FIELDS,
};

export const TABULAR_SECTION_KEYS = Object.keys(TABLE_FIELD_REGISTRY);

/**
 * Resolves the effective list of COLUMNS for one tabular section.
 * Same contract as resolveSelectedSections: undefined/null -> defaults;
 * [] -> throws (blocks export for that table, which blocks the whole
 * export since the section was itself selected to appear).
 */
export function resolveSelectedTableFields(tableKey: string, selected: string[] | undefined | null): string[] {
  const config = TABLE_FIELD_REGISTRY[tableKey];
  if (!config) return [];

  if (selected === undefined || selected === null) {
    return config.filter((f) => f.defaultSelected).map((f) => f.key);
  }
  if (selected.length === 0) {
    throw new ReportFieldSelectionError(
      `No columns are selected for the "${tableKey}" section. Select at least one column, or remove your saved selection to use the approved defaults.`
    );
  }
  const validKeys = new Set(config.map((f) => f.key));
  const requested = new Set(selected.filter((k) => validKeys.has(k)));
  if (requested.size === 0) {
    throw new ReportFieldSelectionError(`None of the selected columns for "${tableKey}" are recognized.`);
  }
  return config.filter((f) => requested.has(f.key)).map((f) => f.key);
}

export function isAdditiveNumeric(tableKey: string, columnKey: string): boolean {
  const config = TABLE_FIELD_REGISTRY[tableKey];
  const field = config?.find((f) => f.key === columnKey);
  return Boolean(field?.totalSupported);
}

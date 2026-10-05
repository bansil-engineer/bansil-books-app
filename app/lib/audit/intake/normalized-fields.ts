// ============================================================
// Bansil Books Analytics — Normalized Record Contract (Milestone B)
// Every key is OPTIONAL. Missing must remain missing — never
// defaulted to zero, a date, a party, an item, or sync time.
// ============================================================

export const NORMALIZED_FIELD_KEYS = [
  "record_uid",
  "entity_id",
  "source_id",
  "source_version",
  "source_record_id",
  "evidence_locator",
  "source_origin",
  "record_role",
  "document_type",
  "document_id",
  "document_number_raw",
  "document_number_normalized",
  "party_id",
  "party_name_raw",
  "verified_party_key",
  "item_id",
  "sku_raw",
  "description_raw",
  "transaction_date",
  "posting_date",
  "value_date",
  "source_event_at",
  "synced_at",
  "timezone",
  "debit_raw",
  "credit_raw",
  "signed_amount",
  "taxable_value",
  "tax_components",
  "gross_value",
  "settled_amount",
  "currency",
  "quantity",
  "unit",
  "record_status",
  "parse_status",
  "mapping_version",
] as const;

export type NormalizedFieldKey = (typeof NORMALIZED_FIELD_KEYS)[number];

export type FieldMap = Partial<Record<NormalizedFieldKey, string>>;

export interface RawTableRow {
  /** 1-indexed physical row (CSV/XLSX row number as it appears in the source file). */
  physicalRow: number;
  values: Record<string, string | null>;
}

export interface RawTable {
  headers: string[];
  rows: RawTableRow[];
}

export interface HeaderAmbiguityResult {
  ambiguous: boolean;
  reasons: string[];
}

/**
 * Deterministic ambiguity check for an owner-picked header row — never a
 * guess about WHICH row is the header (the owner always picks that), only
 * a check that the picked row is actually usable as one. Flags:
 *  - every cell blank (picked a title/separator row by mistake)
 *  - duplicate non-empty header names (case-insensitive, trimmed) — mapping
 *    a normalized field to an ambiguous column name would be unreliable.
 * A HOLD/NEEDS_REVIEW status is what an ambiguous result should produce —
 * never a silent best-guess pick of one of the duplicates.
 */
export function detectHeaderAmbiguity(headerValues: Array<string | null>): HeaderAmbiguityResult {
  const reasons: string[] = [];
  const nonBlank = headerValues.filter((h): h is string => h !== null && h.trim() !== "");

  if (nonBlank.length === 0) {
    reasons.push("The selected header row is entirely blank");
  } else if (nonBlank.length < headerValues.length) {
    // Partial blanks are common with merged XLSX header cells (the name only
    // lives in the left-most cell of the merge) — flag rather than guess
    // which neighboring header a blank column belongs to.
    const blankPositions = headerValues.map((h, i) => (h === null || h.trim() === "" ? i + 1 : null)).filter((p): p is number => p !== null);
    reasons.push(`Blank header cell(s) at column position(s): ${blankPositions.join(", ")} (possibly a merged header — pick the row that actually names every column, or confirm this is expected)`);
  }

  const seen = new Map<string, number>();
  for (const h of nonBlank) {
    const key = h.trim().toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  if (duplicates.length > 0) {
    reasons.push(`Duplicate header name(s): ${duplicates.join(", ")}`);
  }

  return { ambiguous: reasons.length > 0, reasons };
}

/**
 * Applies an owner-approved field map to one raw row. A header the map
 * points to that is missing/blank in this specific row simply omits that
 * normalized key — it is never filled with 0, "", or a guessed value.
 */
export function applyFieldMap(row: RawTableRow, fieldMap: FieldMap): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [normalizedKey, rawColumn] of Object.entries(fieldMap)) {
    if (!rawColumn) continue;
    const value = row.values[rawColumn];
    if (value !== null && value !== undefined && value !== "") {
      normalized[normalizedKey] = value;
    }
  }
  return normalized;
}

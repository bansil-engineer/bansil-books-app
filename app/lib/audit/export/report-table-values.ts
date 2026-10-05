// ============================================================
// Bansil Books Analytics — Report Table Cell Values (Milestone D fix pass)
// Single shared source of "how to read column X off row Y" for the
// Findings / Action Taken / Scope & Coverage / Matching Summary tables —
// used identically by the Excel and PDF builders so neither ever
// disagrees with the other about what a column means.
// ============================================================

export interface CellValue {
  display: string;
  numeric: number | null; // non-null only for additive numeric/currency columns
}

function safeJsonArray(json: unknown): string[] {
  if (typeof json !== "string") return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

function toNumericOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function getFindingCell(columnKey: string, f: Record<string, unknown>): CellValue {
  switch (columnKey) {
    case "finding_id":
      return { display: String(f.finding_id ?? ""), numeric: null };
    case "domain":
      return { display: String(f.domain ?? ""), numeric: null };
    case "severity":
      return { display: String(f.severity ?? ""), numeric: null };
    case "finding_type":
      return { display: String(f.finding_type ?? ""), numeric: null };
    case "title":
      return { display: String(f.title ?? ""), numeric: null };
    case "confirmed_vs_suspected":
      return { display: String(f.confirmed_vs_suspected ?? ""), numeric: null };
    case "financial_impact":
      return { display: String(f.financial_impact ?? "-"), numeric: toNumericOrNull(f.financial_impact) };
    case "residual":
      // Findings do not carry a separate residual value — only the match
      // group they may reference does (see the Matching Summary table).
      return { display: "-", numeric: null };
    case "status":
      return { display: String(f.status ?? ""), numeric: null };
    case "evidence_ref": {
      const refs = safeJsonArray(f.evidence_refs_json);
      return { display: refs.length ? refs.join("; ") : "(none)", numeric: null };
    }
    default:
      return { display: "", numeric: null };
  }
}

export function getActionCell(columnKey: string, a: Record<string, unknown>): CellValue {
  switch (columnKey) {
    case "action_id":
      return { display: String(a.action_id ?? ""), numeric: null };
    case "finding_id":
      return { display: String(a.finding_id ?? ""), numeric: null };
    case "action_owner":
      return { display: String(a.action_owner ?? "-"), numeric: null };
    case "priority":
      return { display: String(a.priority ?? ""), numeric: null };
    case "due_date":
      return { display: String(a.due_date ?? "-"), numeric: null };
    case "action_status":
      return { display: String(a.action_status ?? ""), numeric: null };
    case "action_comment":
      return { display: String(a.action_comment ?? "-"), numeric: null };
    case "closed_by":
      return { display: String(a.closed_by ?? "-"), numeric: null };
    case "completed_at":
      return { display: String(a.completed_at ?? "-"), numeric: null };
    default:
      return { display: "", numeric: null };
  }
}

export function getCoverageCell(columnKey: string, c: Record<string, unknown>): CellValue {
  switch (columnKey) {
    case "domain":
      return { display: String(c.domain ?? ""), numeric: null };
    case "status":
      return { display: String(c.status ?? ""), numeric: null };
    case "source_coverage_note":
      return { display: String(c.source_coverage_note ?? "-"), numeric: null };
    case "tests_performed": {
      const tests = safeJsonArray(c.tests_performed_json);
      return { display: tests.length ? tests.join("; ") : "-", numeric: null };
    }
    case "matched_amount":
      return { display: String(c.matched_amount ?? "-"), numeric: toNumericOrNull(c.matched_amount) };
    case "unresolved_amount":
      return { display: String(c.unresolved_amount ?? "-"), numeric: toNumericOrNull(c.unresolved_amount) };
    case "limitations":
      return { display: String(c.limitations ?? "-"), numeric: null };
    default:
      return { display: "", numeric: null };
  }
}

export function getMatchingSummaryCell(columnKey: string, r: Record<string, unknown>): CellValue {
  switch (columnKey) {
    case "match_type":
      return { display: String(r.match_type ?? ""), numeric: null };
    case "count":
      return { display: String(r.count ?? 0), numeric: toNumericOrNull(r.count) };
    case "allocated_amount":
      return { display: String(r.allocated_amount ?? "0"), numeric: toNumericOrNull(r.allocated_amount) };
    case "residual":
      return { display: String(r.residual ?? "0"), numeric: toNumericOrNull(r.residual) };
    case "absolute_residual":
      return { display: String(r.absolute_residual ?? "0"), numeric: toNumericOrNull(r.absolute_residual) };
    default:
      return { display: "", numeric: null };
  }
}

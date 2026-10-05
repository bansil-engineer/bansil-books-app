// ============================================================
// Bansil Books Analytics — Phase F Owner Data Boundary
// OWNER DATA BOUNDARY (2026-09-15): no Phase F Zoho READ acquisition or
// local traceability processing may include records dated before this
// floor. Applied at the Zoho query level wherever the endpoint supports
// a date/modified-time filter, AND enforced defensively in local code
// (never trust the remote filter alone) so pre-boundary records are
// excluded even if a given endpoint's date filter turns out not to
// behave as expected. Existing local pre-2025 data is NEVER deleted —
// it is simply excluded from Phase F's own processing.
// ============================================================

export const PHASE_F_DATA_START_DATE = "2025-04-01";

/** True if a document/line date string is strictly before the Phase F boundary. Null/unparseable dates are never treated as before the boundary (a missing date must never silently exclude a record — that would hide data, not protect it) — such rows should be handled by whatever caller-specific rule applies to unknown dates. */
export function isBeforePhaseFBoundary(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < new Date(PHASE_F_DATA_START_DATE).getTime();
}

/** The floor to use for an incremental "since" cursor — never earlier than the Phase F boundary, even on a brand-new source with no checkpoint yet. */
export function floorCheckpointAtBoundary(checkpoint?: string | null): string {
  if (!checkpoint) return PHASE_F_DATA_START_DATE;
  const checkpointTime = new Date(checkpoint).getTime();
  const boundaryTime = new Date(PHASE_F_DATA_START_DATE).getTime();
  if (Number.isNaN(checkpointTime)) return PHASE_F_DATA_START_DATE;
  return checkpointTime > boundaryTime ? checkpoint : PHASE_F_DATA_START_DATE;
}

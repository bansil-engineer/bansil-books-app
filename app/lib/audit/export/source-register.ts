// ============================================================
// Bansil Books Analytics — Immutable Source Register (Milestone D fix pass)
// Builds the full source-register dataset from already-persisted rows
// only (audit_source_versions, audit_workspace_sources, audit_source_files,
// audit_zoho_acquisitions, audit_completeness_checks, audit_source_mappings).
// NEVER queries live Zoho, NEVER reads a frozen source snapshot's row
// content — only its metadata/provenance. Called once at report
// generation time and frozen into audit_reports.source_register_json;
// Excel and PDF both read that same saved array, never re-deriving it.
// ============================================================

import type { DatabaseSync } from "node:sqlite";

export interface SourceRegisterEntry {
  source_id: string;
  source_version_id: string;
  version_number: number;
  source_type: string; // origin_type (FILE|ZOHO|INTERNAL_CACHE) [+ file_type when FILE]
  origin: string; // INTERNAL | EXTERNAL
  role_label: string; // e.g. SOURCE_A / SOURCE_B / SUPPORTING
  entity_scope: string | null; // best-available party/account/basis note
  period_from: string | null;
  period_to: string | null;
  original_reference: string | null; // original filename, or Zoho report_type
  file_hash: string | null;
  provenance: string | null;
  mapping_version: number;
  extraction_method: string | null;
  frozen: boolean;
  frozen_at: string | null;
  raw_record_count: number | null;
  normalized_record_count: number | null;
  exception_count: number | null;
  completeness_status: string;
  coverage_note: string | null;
  acquisition_provenance: Record<string, unknown> | null;
}

interface SourceVersionRow {
  version_id: string;
  source_id: string;
  version_number: number;
  origin_type: string;
  file_id: string | null;
  zoho_acquisition_id: string | null;
  extraction_method: string | null;
  raw_row_count: number | null;
  parsed_row_count: number | null;
  exception_count: number | null;
  mapping_version: number;
  completeness_status: string;
  frozen: number;
  frozen_at: string | null;
}

/**
 * Resolves the distinct set of source_version_ids "used by" a report:
 * every left/right source version referenced by the run's comparison
 * edges (if a run is bound), plus every source_snapshot_id recorded on
 * this workspace's domain reviews that resolves to a real version_id.
 * Never invents a version that isn't actually persisted.
 */
function resolveUsedSourceVersionIds(db: DatabaseSync, workspaceId: string, runId: string | undefined): string[] {
  const ids = new Set<string>();

  if (runId) {
    const edgeRows = db.prepare(`SELECT left_source_version_id, right_source_version_id FROM audit_run_edges WHERE run_id = ?`).all(runId) as Array<{ left_source_version_id: string; right_source_version_id: string }>;
    for (const e of edgeRows) {
      ids.add(e.left_source_version_id);
      ids.add(e.right_source_version_id);
    }
  }

  const domainReviews = db.prepare(`SELECT source_snapshot_ids_json FROM audit_domain_reviews WHERE workspace_id = ?`).all(workspaceId) as Array<{ source_snapshot_ids_json: string }>;
  for (const row of domainReviews) {
    let candidateIds: string[] = [];
    try {
      const parsed = JSON.parse(row.source_snapshot_ids_json);
      if (Array.isArray(parsed)) candidateIds = parsed.filter((v): v is string => typeof v === "string");
    } catch {
      candidateIds = [];
    }
    for (const candidate of candidateIds) {
      const exists = db.prepare(`SELECT 1 FROM audit_source_versions WHERE version_id = ?`).get(candidate);
      if (exists) ids.add(candidate);
    }
  }

  return Array.from(ids);
}

export function buildSourceRegister(db: DatabaseSync, workspaceId: string, runId: string | undefined): SourceRegisterEntry[] {
  const versionIds = resolveUsedSourceVersionIds(db, workspaceId, runId);
  const entries: SourceRegisterEntry[] = [];

  for (const versionId of versionIds) {
    const version = db.prepare(`SELECT * FROM audit_source_versions WHERE version_id = ?`).get(versionId) as SourceVersionRow | undefined;
    if (!version) continue;

    const workspaceSource = db.prepare(`SELECT * FROM audit_workspace_sources WHERE source_id = ?`).get(version.source_id) as Record<string, unknown> | undefined;
    const sourceFile = version.file_id ? (db.prepare(`SELECT * FROM audit_source_files WHERE file_id = ?`).get(version.file_id) as Record<string, unknown> | undefined) : undefined;
    const acquisition = version.zoho_acquisition_id
      ? (db.prepare(`SELECT * FROM audit_zoho_acquisitions WHERE acquisition_id = ?`).get(version.zoho_acquisition_id) as Record<string, unknown> | undefined)
      : undefined;
    const latestCompleteness = db
      .prepare(`SELECT * FROM audit_completeness_checks WHERE source_version_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(versionId) as Record<string, unknown> | undefined;

    const sourceType = version.origin_type === "FILE" && sourceFile ? `FILE (${sourceFile.file_type})` : version.origin_type;
    const originalReference = sourceFile ? (sourceFile.original_filename as string) : acquisition ? `Zoho: ${acquisition.report_type as string}` : null;

    entries.push({
      source_id: version.source_id,
      source_version_id: version.version_id,
      version_number: version.version_number,
      source_type: sourceType,
      origin: (workspaceSource?.source_origin as string) ?? "UNKNOWN",
      role_label: (workspaceSource?.role_label as string) ?? "UNKNOWN",
      entity_scope: (workspaceSource?.basis_note as string) ?? (workspaceSource?.origin_description as string) ?? null,
      period_from: null, // not tracked per-version; workspace-level period applies (see report Summary)
      period_to: null,
      original_reference: originalReference,
      file_hash: sourceFile ? (sourceFile.sha256 as string) : null,
      provenance: (workspaceSource?.provenance as string) ?? null,
      mapping_version: version.mapping_version,
      extraction_method: version.extraction_method,
      frozen: version.frozen === 1,
      frozen_at: version.frozen_at,
      raw_record_count: version.raw_row_count,
      normalized_record_count: version.parsed_row_count,
      exception_count: version.exception_count,
      completeness_status: (latestCompleteness?.status as string) ?? version.completeness_status,
      coverage_note: (latestCompleteness?.notes as string) ?? null,
      acquisition_provenance: acquisition
        ? {
            organization_id: acquisition.organization_id,
            report_type: acquisition.report_type,
            api_call_count: acquisition.api_call_count,
            page_count: acquisition.page_count,
            record_count: acquisition.record_count,
            coverage_status: acquisition.coverage_status,
            first_record_date: acquisition.first_record_date,
            last_record_date: acquisition.last_record_date,
          }
        : null,
    });
  }

  return entries;
}

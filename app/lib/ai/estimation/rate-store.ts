// ============================================================
// Bansil Books Analytics — Phase 4D: estimation.sqlite rate store
//
// Writes ONLY to the isolated estimation DB (getEstimationDatabase()).
// Never touches bansil_books.db / audit_workspace.db / Zoho.
// Tables (additive, CREATE IF NOT EXISTS in estimation-database.ts):
//   estimation_rate_lookup_runs, estimation_rate_evidence,
//   estimation_item_match_candidates, estimation_rate_selections
// ============================================================

import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getEstimationDatabase } from "../../db/estimation-database";
import type {
  ApprovedItemAlias,
  BoqLineRateResult,
  RateEvidenceRecord,
  RateLookupRunSummary,
} from "./rate-types";

export interface CachedEvidenceRow {
  cache_id: string;
  rate_evidence_id: string;
  source_fingerprint: string;
  evidence: RateEvidenceRecord;
}

export interface ItemMatchCandidateInput {
  projectId?: string | null;
  boqLineId?: string | null;
  queryKey: string;
  candidateItemId: string;
  method: "CANDIDATE_MATCH" | "AI_SUGGESTION" | "OWNER_ALIAS";
  score?: number | null;
  suggestedBy: string;
  notes?: string | null;
}

export class RateEvidenceStore {
  constructor(private readonly db: DatabaseSync = getEstimationDatabase()) {}

  // ---------- runs ----------

  startRun(projectId: string, asOfDate: string, fp: { books: string | null; audit: string | null }, policyRef: string | null): string {
    const runId = `RLR-${crypto.randomUUID()}`;
    this.db.prepare(
      `INSERT INTO estimation_rate_lookup_runs
         (run_id, project_id, as_of_date, started_at, status, method, model_calls,
          source_fingerprint_books, source_fingerprint_audit, freshness_policy_ref)
       VALUES (?, ?, ?, ?, 'RUNNING', 'DETERMINISTIC', 0, ?, ?, ?)`,
    ).run(runId, projectId, asOfDate, new Date().toISOString(), fp.books, fp.audit, policyRef);
    return runId;
  }

  completeRun(s: RateLookupRunSummary): void {
    this.db.prepare(
      `UPDATE estimation_rate_lookup_runs
          SET completed_at = ?, status = 'COMPLETED', boq_line_count = ?, evidence_available_count = ?,
              missing_rate_count = ?, unresolved_count = ?, cache_hits = ?, cache_misses = ?, cache_invalidated = ?
        WHERE run_id = ?`,
    ).run(new Date().toISOString(), s.boq_line_count, s.evidence_available_count, s.missing_rate_count,
      s.unresolved_count, s.cache_hits, s.cache_misses, s.cache_invalidated, s.run_id);
  }

  getRun(runId: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT * FROM estimation_rate_lookup_runs WHERE run_id = ?").get(runId) as Record<string, unknown> | undefined;
  }

  saveSelection(runId: string, r: BoqLineRateResult): void {
    this.db.prepare(
      `INSERT INTO estimation_rate_selections
         (selection_id, run_id, project_id, boq_line_id, item_match_status, matched_item_id, match_method,
          rate_status, comparable_evidence_count, best_available_evidence_id, selection_basis,
          use_as_tender_rate, vendor_auto_selected, warnings_json, clarifications_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    ).run(
      `RSL-${crypto.randomUUID()}`, runId, r.project_id, r.boq_line_id, r.item_match_status,
      r.item_match.item?.item_id ?? null, r.item_match.method, r.rate_status, r.comparable_evidence_count,
      r.best_available_evidence?.rate_evidence_id ?? null, r.best_available_evidence?.selection_basis ?? null,
      JSON.stringify(r.warnings), JSON.stringify(r.clarifications), new Date().toISOString(),
    );
  }

  listSelections(runId: string): Record<string, unknown>[] {
    return this.db.prepare("SELECT * FROM estimation_rate_selections WHERE run_id = ? ORDER BY boq_line_id").all(runId) as Record<string, unknown>[];
  }

  // ---------- evidence cache ----------

  getValidCache(itemKey: string): CachedEvidenceRow[] {
    const rows = this.db.prepare(
      `SELECT cache_id, rate_evidence_id, source_fingerprint, evidence_json FROM estimation_rate_evidence
        WHERE item_key = ? AND record_kind = 'SOURCE_CACHE' AND cache_status = 'VALID'`,
    ).all(itemKey) as Record<string, unknown>[];
    return rows.map((r) => ({
      cache_id: String(r.cache_id),
      rate_evidence_id: String(r.rate_evidence_id),
      source_fingerprint: String(r.source_fingerprint),
      evidence: JSON.parse(String(r.evidence_json)) as RateEvidenceRecord,
    }));
  }

  putCache(itemKey: string, e: RateEvidenceRecord, fingerprint: string): void {
    const cacheId = crypto.createHash("sha256").update(`${e.rate_evidence_id}|${fingerprint}`).digest("hex");
    this.db.prepare(
      `INSERT OR IGNORE INTO estimation_rate_evidence
         (cache_id, rate_evidence_id, record_kind, project_id, item_key, source_type, source_record_id,
          source_fingerprint, verification_status, evidence_json, cache_status, created_at)
       VALUES (?, ?, 'SOURCE_CACHE', NULL, ?, ?, ?, ?, ?, ?, 'VALID', ?)`,
    ).run(cacheId, e.rate_evidence_id, itemKey, e.source_type, e.source_record_id, fingerprint,
      e.verification_status, JSON.stringify(e), new Date().toISOString());
  }

  invalidateCache(cacheId: string, reason: "SOURCE_FINGERPRINT_CHANGED" | "SOURCE_RECORD_MISSING"): void {
    this.db.prepare(
      `UPDATE estimation_rate_evidence SET cache_status = 'INVALIDATED', invalidated_reason = ?, invalidated_at = ?
        WHERE cache_id = ? AND record_kind = 'SOURCE_CACHE'`,
    ).run(reason, new Date().toISOString(), cacheId);
  }

  countCache(itemKey: string, status: "VALID" | "INVALIDATED"): number {
    const r = this.db.prepare(
      "SELECT COUNT(*) AS c FROM estimation_rate_evidence WHERE item_key = ? AND record_kind = 'SOURCE_CACHE' AND cache_status = ?",
    ).get(itemKey, status) as { c: number };
    return Number(r.c);
  }

  // ---------- manual (assumption) rates ----------

  putManualRate(projectId: string, itemKey: string, e: RateEvidenceRecord): void {
    if (e.verification_status !== "ASSUMPTION" && e.verification_status !== "OWNER_APPROVED_MANUAL_RATE") {
      throw new Error("MANUAL_RATE_STATUS_INVALID: manual rates are ASSUMPTION or OWNER_APPROVED_MANUAL_RATE only");
    }
    this.db.prepare(
      `INSERT INTO estimation_rate_evidence
         (cache_id, rate_evidence_id, record_kind, project_id, item_key, source_type, source_record_id,
          source_fingerprint, verification_status, evidence_json, cache_status, created_at)
       VALUES (?, ?, 'MANUAL_ENTRY', ?, ?, ?, ?, ?, ?, ?, 'VALID', ?)`,
    ).run(`MAN-${crypto.randomUUID()}`, e.rate_evidence_id, projectId, itemKey, e.source_type, e.source_record_id,
      e.provenance?.sourceFingerprint ?? "", e.verification_status, JSON.stringify(e), new Date().toISOString());
  }

  listManualRates(projectId: string, itemKeys: string[]): RateEvidenceRecord[] {
    if (itemKeys.length === 0) return [];
    const ph = itemKeys.map(() => "?").join(",");
    const rows = this.db.prepare(
      `SELECT evidence_json FROM estimation_rate_evidence
        WHERE record_kind = 'MANUAL_ENTRY' AND cache_status = 'VALID' AND project_id = ? AND item_key IN (${ph})
        ORDER BY created_at, cache_id`,
    ).all(projectId, ...itemKeys) as Record<string, unknown>[];
    return rows.map((r) => JSON.parse(String(r.evidence_json)) as RateEvidenceRecord);
  }

  // ---------- item match candidates / approved aliases ----------

  addCandidate(c: ItemMatchCandidateInput): string {
    const id = `IMC-${crypto.randomUUID()}`;
    this.db.prepare(
      `INSERT INTO estimation_item_match_candidates
         (candidate_id, project_id, boq_line_id, query_key, candidate_item_id, method, score, status,
          suggested_by, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'CANDIDATE', ?, ?, ?)`,
    ).run(id, c.projectId ?? null, c.boqLineId ?? null, c.queryKey, c.candidateItemId, c.method,
      c.score ?? null, c.suggestedBy, c.notes ?? null, new Date().toISOString());
    return id;
  }

  /** Owner approval turns a candidate into an approved alias. Stamp is mandatory. */
  approveCandidate(candidateId: string, approvedBy: string, approvedAt: string): void {
    if (!approvedBy?.trim() || !approvedAt || Number.isNaN(Date.parse(approvedAt))) {
      throw new Error("ALIAS_APPROVAL_STAMP_REQUIRED");
    }
    this.db.prepare(
      `UPDATE estimation_item_match_candidates SET status = 'OWNER_APPROVED', approved_by = ?, approved_at = ?
        WHERE candidate_id = ? AND status = 'CANDIDATE'`,
    ).run(approvedBy, approvedAt, candidateId);
  }

  getCandidate(candidateId: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT * FROM estimation_item_match_candidates WHERE candidate_id = ?").get(candidateId) as Record<string, unknown> | undefined;
  }

  listApprovedAliases(): ApprovedItemAlias[] {
    const rows = this.db.prepare(
      `SELECT query_key, candidate_item_id, approved_by, approved_at FROM estimation_item_match_candidates
        WHERE status = 'OWNER_APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL
        ORDER BY approved_at, candidate_id`,
    ).all() as Record<string, unknown>[];
    return rows.map((r) => ({
      query_key: String(r.query_key), item_id: String(r.candidate_item_id),
      approved_by: String(r.approved_by), approved_at: String(r.approved_at),
    }));
  }
}

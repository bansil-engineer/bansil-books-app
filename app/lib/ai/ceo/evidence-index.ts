// ============================================================
// Bansil Books Analytics — Governed Evidence Reuse Index
// Lightweight index for caching, deduplication, and provenance
// ============================================================

import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getAiDatabase } from "../../db/ai-database.ts";
import type { AiEvidenceRecord, DataFreshness } from "./ceo-types.ts";

/**
 * Generate a deterministic query fingerprint from source, entity, filters, and period.
 */
export function generateFingerprint(
  sourceId: string,
  entity: string,
  filters: Record<string, any> = {},
  period?: string
): string {
  // Normalize filters by sorting keys
  const sortedKeys = Object.keys(filters).sort();
  const normalizedFilters: Record<string, any> = {};
  for (const k of sortedKeys) {
    normalizedFilters[k] = filters[k];
  }

  const raw = JSON.stringify({
    source: sourceId.trim().toLowerCase(),
    entity: entity.trim().toLowerCase(),
    filters: normalizedFilters,
    period: (period || "").trim().toLowerCase(),
  });

  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Check if an evidence record is still fresh given an optional maxAgeMs (default 15 minutes).
 */
export function isEvidenceFresh(record: AiEvidenceRecord, maxAgeMs: number = 15 * 60 * 1000): boolean {
  if (record.freshness === "STATIC") return true;
  if (record.expiresAt) {
    return new Date(record.expiresAt).getTime() > Date.now();
  }
  const fetchedTime = new Date(record.fetchedAt).getTime();
  if (isNaN(fetchedTime)) return false;
  return Date.now() - fetchedTime < maxAgeMs;
}

/**
 * Lookup existing evidence by query fingerprint.
 */
export function lookupEvidence(params: {
  sourceId?: string;
  entity?: string;
  queryFingerprint: string;
  maxAgeMs?: number;
  db?: DatabaseSync;
}): AiEvidenceRecord | null {
  const db = params.db || getAiDatabase();
  const row = db.prepare(`
    SELECT id, source_id, entity, query_fingerprint, filters, period,
           freshness, fetched_at, expires_at, stale_rule, result_reference,
           checksum, summary, created_at, updated_at
    FROM ai_evidence_index
    WHERE query_fingerprint = ?
    ORDER BY fetched_at DESC LIMIT 1
  `).get(params.queryFingerprint) as any;

  if (!row) return null;

  let filtersParsed: Record<string, any> = {};
  try {
    filtersParsed = JSON.parse(row.filters);
  } catch {}

  const record: AiEvidenceRecord = {
    id: row.id,
    sourceId: row.source_id,
    entity: row.entity,
    queryFingerprint: row.query_fingerprint,
    filters: filtersParsed,
    period: row.period || undefined,
    freshness: row.freshness as DataFreshness,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at || undefined,
    staleRule: row.stale_rule || undefined,
    resultReference: row.result_reference,
    checksum: row.checksum || undefined,
    summary: row.summary || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  // Verify freshness if maxAgeMs is supplied
  if (params.maxAgeMs !== undefined && !isEvidenceFresh(record, params.maxAgeMs)) {
    return null;
  }

  return record;
}

/**
 * Index a new evidence item into the persistent index.
 */
export function indexEvidence(params: {
  sourceId: string;
  entity: string;
  queryFingerprint: string;
  filters: Record<string, any>;
  period?: string;
  freshness: DataFreshness;
  resultReference: string;
  checksum?: string;
  summary: string;
  ttlMs?: number;
  staleRule?: string;
  db?: DatabaseSync;
}): AiEvidenceRecord {
  const db = params.db || getAiDatabase();
  const id = `ev_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();
  const expiresAt = params.ttlMs
    ? new Date(Date.now() + params.ttlMs).toISOString()
    : undefined;

  // Sanitize filters to ensure no secrets are stored
  const sanitizedFiltersStr = JSON.stringify(params.filters || {});
  const cleanSummary = (params.summary || "").slice(0, 1000);

  db.prepare(`
    INSERT OR REPLACE INTO ai_evidence_index (
      id, source_id, entity, query_fingerprint, filters, period,
      freshness, fetched_at, expires_at, stale_rule, result_reference,
      checksum, summary, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.sourceId,
    params.entity,
    params.queryFingerprint,
    sanitizedFiltersStr,
    params.period || null,
    params.freshness,
    now,
    expiresAt || null,
    params.staleRule || "DEFAULT_TTL_15M",
    params.resultReference,
    params.checksum || null,
    cleanSummary,
    now,
    now
  );

  return {
    id,
    sourceId: params.sourceId,
    entity: params.entity,
    queryFingerprint: params.queryFingerprint,
    filters: params.filters,
    period: params.period,
    freshness: params.freshness,
    fetchedAt: now,
    expiresAt,
    staleRule: params.staleRule,
    resultReference: params.resultReference,
    checksum: params.checksum,
    summary: cleanSummary,
    createdAt: now,
    updatedAt: now,
  };
}

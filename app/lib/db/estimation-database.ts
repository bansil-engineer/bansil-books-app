import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { getEstimationDbPath } from "./db-resolver";

let dbInstance: DatabaseSync | null = null;

export function getEstimationDatabase(): DatabaseSync {
  if (dbInstance) return dbInstance;

  // Use AI_WORKSPACE_DB_PATH directory logic if isolated for testing
  let dbPath = getEstimationDbPath();

  if (process.env.AI_WORKSPACE_DB_PATH && !process.env.ESTIMATION_DB_PATH) {
     const tmpDir = path.dirname(process.env.AI_WORKSPACE_DB_PATH);
     dbPath = path.join(tmpDir, `estimation_${path.basename(process.env.AI_WORKSPACE_DB_PATH)}`);
  }

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  dbInstance = new DatabaseSync(dbPath);
  dbInstance.exec("PRAGMA journal_mode = WAL");
  dbInstance.exec("PRAGMA foreign_keys = ON");

  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS estimation_documents (
      document_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      family_key TEXT NOT NULL,
      revision INTEGER NOT NULL,
      revision_label TEXT,
      format TEXT NOT NULL,
      source_id TEXT NOT NULL,
      received_at TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      superseded_by_document_id TEXT,
      status TEXT NOT NULL,
      storage_path TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_est_docs_proj_fam_rev ON estimation_documents(project_id, family_key, revision);

    CREATE TABLE IF NOT EXISTS estimation_extraction_runs (
      extraction_run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      method TEXT NOT NULL,
      warning_count INTEGER DEFAULT 0,
      conflict_count INTEGER DEFAULT 0,
      FOREIGN KEY(document_id) REFERENCES estimation_documents(document_id)
    );

    CREATE TABLE IF NOT EXISTS estimation_scope_items (
      scope_item_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      scope_status TEXT NOT NULL,
      responsibility TEXT,
      source_document_id TEXT,
      source_revision INTEGER,
      source_location TEXT,
      evidence_text TEXT,
      clarification_id TEXT
    );

    CREATE TABLE IF NOT EXISTS estimation_boq_lines (
      boq_line_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      source_line_number TEXT,
      source_location TEXT,
      item_code TEXT,
      description TEXT NOT NULL,
      quantity REAL,
      quantity_status TEXT,
      uom TEXT,
      uom_status TEXT,
      make_brand TEXT,
      technical_specification TEXT,
      remarks TEXT,
      section TEXT,
      subsection TEXT,
      parent_line_id TEXT,
      line_status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS estimation_bom_headers (
      bom_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_boq_line_id TEXT NOT NULL,
      source TEXT,
      revision INTEGER,
      verification_status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS estimation_bom_components (
      bom_component_id TEXT PRIMARY KEY,
      bom_id TEXT NOT NULL,
      component_item_code TEXT,
      component_description TEXT NOT NULL,
      qty_per_parent REAL NOT NULL,
      uom TEXT NOT NULL,
      wastage REAL DEFAULT 0,
      provenance TEXT,
      FOREIGN KEY(bom_id) REFERENCES estimation_bom_headers(bom_id)
    );

    CREATE TABLE IF NOT EXISTS estimation_clarifications (
      clarification_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      question TEXT NOT NULL,
      source_references TEXT,
      status TEXT NOT NULL,
      recommended_owner_action TEXT
    );

    -- ===== Phase 4D: rate evidence engine (additive only) =====
    CREATE TABLE IF NOT EXISTS estimation_rate_lookup_runs (
      run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      as_of_date TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'DETERMINISTIC',
      model_calls INTEGER NOT NULL DEFAULT 0 CHECK (model_calls = 0),
      boq_line_count INTEGER NOT NULL DEFAULT 0,
      evidence_available_count INTEGER NOT NULL DEFAULT 0,
      missing_rate_count INTEGER NOT NULL DEFAULT 0,
      unresolved_count INTEGER NOT NULL DEFAULT 0,
      cache_hits INTEGER NOT NULL DEFAULT 0,
      cache_misses INTEGER NOT NULL DEFAULT 0,
      cache_invalidated INTEGER NOT NULL DEFAULT 0,
      source_fingerprint_books TEXT,
      source_fingerprint_audit TEXT,
      freshness_policy_ref TEXT
    );

    CREATE TABLE IF NOT EXISTS estimation_rate_evidence (
      cache_id TEXT PRIMARY KEY,
      rate_evidence_id TEXT NOT NULL,
      record_kind TEXT NOT NULL CHECK (record_kind IN ('SOURCE_CACHE', 'MANUAL_ENTRY')),
      project_id TEXT,
      item_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_record_id TEXT,
      source_fingerprint TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      cache_status TEXT NOT NULL CHECK (cache_status IN ('VALID', 'INVALIDATED')),
      invalidated_reason TEXT,
      created_at TEXT NOT NULL,
      invalidated_at TEXT,
      CHECK (record_kind = 'SOURCE_CACHE' OR verification_status IN ('ASSUMPTION', 'OWNER_APPROVED_MANUAL_RATE'))
    );
    CREATE INDEX IF NOT EXISTS idx_est_rate_ev_item ON estimation_rate_evidence(item_key, record_kind, cache_status);

    CREATE TABLE IF NOT EXISTS estimation_item_match_candidates (
      candidate_id TEXT PRIMARY KEY,
      project_id TEXT,
      boq_line_id TEXT,
      query_key TEXT NOT NULL,
      candidate_item_id TEXT NOT NULL,
      method TEXT NOT NULL CHECK (method IN ('CANDIDATE_MATCH', 'AI_SUGGESTION', 'OWNER_ALIAS')),
      score REAL,
      status TEXT NOT NULL CHECK (status IN ('CANDIDATE', 'OWNER_APPROVED', 'REJECTED')),
      suggested_by TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      CHECK (status <> 'OWNER_APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_est_item_match_key ON estimation_item_match_candidates(query_key, status);

    CREATE TABLE IF NOT EXISTS estimation_rate_selections (
      selection_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      boq_line_id TEXT NOT NULL,
      item_match_status TEXT NOT NULL,
      matched_item_id TEXT,
      match_method TEXT NOT NULL,
      rate_status TEXT NOT NULL,
      comparable_evidence_count INTEGER NOT NULL,
      best_available_evidence_id TEXT,
      selection_basis TEXT,
      use_as_tender_rate INTEGER NOT NULL DEFAULT 0 CHECK (use_as_tender_rate = 0),
      vendor_auto_selected INTEGER NOT NULL DEFAULT 0 CHECK (vendor_auto_selected = 0),
      warnings_json TEXT NOT NULL,
      clarifications_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES estimation_rate_lookup_runs(run_id)
    );
  `);


  return dbInstance;
}

export function closeEstimationDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

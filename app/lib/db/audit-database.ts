// ============================================================
// Bansil Books Analytics — Audit Workspace Database (Milestone A)
// Isolated, additive persistence for Reconciliation & Audit +
// Settings > Skills. Never shares a connection with bansil_books.db.
// Node 22+ Built-in node:sqlite.
// ============================================================

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { getAuditWorkspaceDbPath } from "./db-resolver";

let auditDbInstance: DatabaseSync | null = null;

const AUDIT_DB_FILE = getAuditWorkspaceDbPath();

export const AUDIT_SCHEMA_VERSION = 13;

function applyDestructiveOpsGuard(db: DatabaseSync) {
  const originalExec = db.exec.bind(db);
  const originalPrepare = db.prepare.bind(db);
  
  const checkSql = (sql: string) => {
    const upper = sql.toUpperCase();
    if (upper.includes("DROP TABLE") || upper.includes("DROP COLUMN") || (upper.includes("DELETE FROM") && !upper.includes("WHERE"))) {
      if (process.env.ALLOW_DESTRUCTIVE_DB_OPS !== "true") {
        throw new Error("OWNER GUARD: Destructive local audit DB operations (DROP/DELETE) require explicit OWNER approval. Set ALLOW_DESTRUCTIVE_DB_OPS=true to bypass.");
      }
    }
  };

  db.exec = (sql: string) => {
    checkSql(sql);
    return originalExec(sql);
  };
  
  db.prepare = (sql: string) => {
    checkSql(sql);
    return originalPrepare(sql);
  };
}

/**
 * Returns the singleton audit workspace SQLite database instance,
 * initializing schema/migrations if necessary. Fully separate file
 * from data/bansil_books.db — the audit adapter never opens this
 * connection against the Books database.
 */
export function getAuditDatabase(): DatabaseSync {
  if (auditDbInstance) return auditDbInstance;

  const dbDir = path.dirname(AUDIT_DB_FILE);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new DatabaseSync(AUDIT_DB_FILE);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  applyDestructiveOpsGuard(db);

  initAuditDatabase(db);
  auditDbInstance = db;
  return auditDbInstance;
}

/**
 * Opens (or creates) the audit database at an explicit path. Used by
 * tests to run migrations against isolated temporary files instead of
 * the shared singleton / production file.
 */
export function openAuditDatabaseAt(filePath: string): DatabaseSync {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  initAuditDatabase(db);
  return db;
}

/**
 * Creates the audit schema (idempotent — safe to call on every process
 * start and safe to call twice in a row / in tests). Column-adding
 * migrations for a table always run and complete before any CREATE INDEX
 * that references the altered columns, mirroring the fix already applied
 * to zoho_activity_logs in app/lib/db/database.ts (an index created
 * against a column that an older DB file does not have yet aborts the
 * whole exec() with "no such column").
 */
export function initAuditDatabase(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Section 15.A: Reconciliation & Audit workspace shell
    CREATE TABLE IF NOT EXISTS audit_workspaces (
      workspace_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      comparison_mode TEXT NOT NULL, -- INTERNAL_EXTERNAL | EXTERNAL_EXTERNAL | INTERNAL_INTERNAL
      purpose TEXT,
      entity_id TEXT,
      entity_name TEXT,
      period_from TEXT,
      period_to TEXT,
      amount_basis TEXT, -- explicit basis note; missing stays missing (no default)
      status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | ACTIVE | CLOSED
      pinned_skill_version_id TEXT,
      created_by TEXT NOT NULL DEFAULT 'OWNER',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_workspaces_mode ON audit_workspaces(comparison_mode);
    CREATE INDEX IF NOT EXISTS idx_audit_workspaces_status ON audit_workspaces(status);

    -- Section 7/9/10: per-workspace source provenance metadata (no ingestion yet)
    CREATE TABLE IF NOT EXISTS audit_workspace_sources (
      source_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES audit_workspaces(workspace_id) ON DELETE CASCADE,
      role_label TEXT NOT NULL, -- e.g. 'SOURCE_A', 'SOURCE_B'
      source_origin TEXT NOT NULL, -- INTERNAL | EXTERNAL
      origin_description TEXT,
      provenance TEXT,
      source_version_ref TEXT,
      basis_note TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ws_sources_workspace ON audit_workspace_sources(workspace_id);

    -- Section 11: Settings > Skills registry — one shared registry
    CREATE TABLE IF NOT EXISTS audit_skills (
      skill_id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      module_scope TEXT NOT NULL, -- which module/workspace type this skill applies to
      description TEXT,
      created_by TEXT NOT NULL DEFAULT 'OWNER',
      created_at TEXT NOT NULL
    );

    -- Immutable per-version package record. Only status/approval/activation
    -- timestamp columns may ever be updated after insert — enforced in the
    -- API layer (updateSkillVersionLifecycle), never the package/guard fields.
    CREATE TABLE IF NOT EXISTS audit_skill_versions (
      version_id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES audit_skills(skill_id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT|VALIDATING|TESTED|PENDING_APPROVAL|ACTIVE|DISABLED|ARCHIVED
      package_filename TEXT NOT NULL,
      package_sha256 TEXT NOT NULL,
      package_size_bytes INTEGER NOT NULL,
      manifest_json TEXT NOT NULL, -- file listing + SKILL.md preview text (never executed)
      guard_verdict TEXT NOT NULL, -- PASS | BLOCKED
      guard_reasons_json TEXT NOT NULL DEFAULT '[]',
      replaces_version_id TEXT,
      approved_by TEXT,
      approved_at TEXT,
      activated_at TEXT,
      deactivated_at TEXT,
      archived_at TEXT,
      created_by TEXT NOT NULL DEFAULT 'OWNER',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(skill_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_audit_skill_versions_skill ON audit_skill_versions(skill_id);
    CREATE INDEX IF NOT EXISTS idx_audit_skill_versions_status ON audit_skill_versions(status);

    -- One active binding per module scope; rebinding just moves this pointer,
    -- it never rewrites audit_skill_versions rows (rollback keeps history).
    CREATE TABLE IF NOT EXISTS audit_module_skill_bindings (
      binding_id TEXT PRIMARY KEY,
      module_scope TEXT NOT NULL UNIQUE,
      skill_id TEXT NOT NULL REFERENCES audit_skills(skill_id),
      active_version_id TEXT REFERENCES audit_skill_versions(version_id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Section 5/11: local audit trail for skill/config changes only.
    -- Distinct from zoho_activity_log/zoho_activity_logs in the Books DB —
    -- this never touches Zoho and never records source/business data.
    CREATE TABLE IF NOT EXISTS audit_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details_json TEXT,
      actor TEXT NOT NULL DEFAULT 'OWNER',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);

    -- Schema v2: OWNER-ONLY local authorization foundation for Settings > Skills
    -- and other privileged audit-module mutations. Single fixed row ('owner') —
    -- there is exactly one authorizable identity in this local application.
    -- The passphrase itself is never stored, only a salted scrypt hash.
    CREATE TABLE IF NOT EXISTS audit_owner_credential (
      id TEXT PRIMARY KEY DEFAULT 'owner',
      passphrase_salt TEXT NOT NULL,
      passphrase_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Server-side session store backing an HttpOnly, SameSite=Strict cookie.
    -- The cookie carries only the opaque token below — never the passphrase,
    -- never a client-suppliable identity/actor string.
    CREATE TABLE IF NOT EXISTS audit_sessions (
      session_token TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_sessions_expires ON audit_sessions(expires_at);

    -- ========================================================
    -- Schema v3 (Milestone B): Evidence intake, source mapping,
    -- and read-only source acquisition (file + internal/Zoho).
    -- ========================================================

    -- Immutable uploaded originals. Stored outside public/static under
    -- data/audit_uploads/<file_id>.bin with an opaque filename — original
    -- name/type/hash recorded here for display and dedupe only.
    CREATE TABLE IF NOT EXISTS audit_source_files (
      file_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES audit_workspace_sources(source_id) ON DELETE CASCADE,
      original_filename TEXT NOT NULL,
      file_type TEXT NOT NULL, -- PDF | XLSX | CSV
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      storage_path TEXT NOT NULL, -- relative to data/audit_uploads/
      uploaded_by TEXT NOT NULL DEFAULT 'OWNER',
      uploaded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_source_files_source ON audit_source_files(source_id);
    CREATE INDEX IF NOT EXISTS idx_audit_source_files_sha256 ON audit_source_files(sha256);

    -- One row per acquisition of a source (a new upload, a revised file, or
    -- a fresh Zoho pull) — the unit that eventually gets frozen into an
    -- immutable snapshot for Milestone C to reconcile against.
    CREATE TABLE IF NOT EXISTS audit_source_versions (
      version_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES audit_workspace_sources(source_id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      origin_type TEXT NOT NULL, -- FILE | ZOHO | INTERNAL_CACHE
      file_id TEXT REFERENCES audit_source_files(file_id),
      zoho_acquisition_id TEXT,
      extraction_status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING|EXTRACTED|OCR_REQUIRED|OCR_NOT_AVAILABLE|FAILED
      extraction_method TEXT,
      raw_row_count INTEGER,
      parsed_row_count INTEGER,
      exception_count INTEGER,
      mapping_status TEXT NOT NULL DEFAULT 'UNMAPPED', -- UNMAPPED|NEEDS_REVIEW|APPROVED
      mapping_version INTEGER NOT NULL DEFAULT 0,
      completeness_status TEXT NOT NULL DEFAULT 'NOT_CHECKED', -- NOT_CHECKED|COMPLETE|PARTIAL|INCOMPLETE|BLOCKED|NOT_AVAILABLE
      frozen INTEGER NOT NULL DEFAULT 0,
      frozen_at TEXT,
      created_by TEXT NOT NULL DEFAULT 'OWNER',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source_id, version_number)
    );
    CREATE INDEX IF NOT EXISTS idx_audit_source_versions_source ON audit_source_versions(source_id);
    CREATE INDEX IF NOT EXISTS idx_audit_source_versions_frozen ON audit_source_versions(frozen);

    -- Owner-approved field mapping for one source version. A change after
    -- approval creates a NEW row (new mapping_version) — never edits an
    -- approved mapping in place.
    CREATE TABLE IF NOT EXISTS audit_source_mappings (
      mapping_id TEXT PRIMARY KEY,
      source_version_id TEXT NOT NULL REFERENCES audit_source_versions(version_id) ON DELETE CASCADE,
      mapping_version INTEGER NOT NULL,
      field_map_json TEXT NOT NULL, -- { normalizedField: rawColumnOrPath }
      amount_basis TEXT,
      debit_credit_perspective TEXT,
      date_format_note TEXT,
      warnings_json TEXT NOT NULL DEFAULT '[]',
      approved_by TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(source_version_id, mapping_version)
    );
    CREATE INDEX IF NOT EXISTS idx_audit_source_mappings_version ON audit_source_mappings(source_version_id);

    -- Normalized rows per the approved record contract. Stored as JSON
    -- (the contract has 30+ optional fields; missing keys simply stay
    -- absent — never defaulted) alongside the untouched raw row and an
    -- explicit evidence locator for drill-back.
    CREATE TABLE IF NOT EXISTS audit_normalized_rows (
      row_id TEXT PRIMARY KEY,
      source_version_id TEXT NOT NULL REFERENCES audit_source_versions(version_id) ON DELETE CASCADE,
      record_uid TEXT NOT NULL,
      evidence_locator TEXT NOT NULL, -- e.g. "sheet:Sheet1!row:14", "csv:row:9", "pdf:page:3", "zoho:invoice:123"
      raw_json TEXT NOT NULL,
      normalized_json TEXT NOT NULL,
      parse_status TEXT NOT NULL DEFAULT 'OK', -- OK | EXCEPTION
      parse_exception TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_normalized_rows_version ON audit_normalized_rows(source_version_id);
    CREATE INDEX IF NOT EXISTS idx_audit_normalized_rows_status ON audit_normalized_rows(parse_status);

    -- Source/report-level completeness controls (never forced to zero).
    CREATE TABLE IF NOT EXISTS audit_completeness_checks (
      check_id TEXT PRIMARY KEY,
      source_version_id TEXT NOT NULL REFERENCES audit_source_versions(version_id) ON DELETE CASCADE,
      raw_record_count INTEGER,
      parsed_row_count INTEGER,
      ignored_row_count INTEGER,
      exception_count INTEGER,
      opening_balance REAL,
      debit_movement REAL,
      credit_movement REAL,
      closing_balance REAL,
      computed_closing REAL,
      discrepancy REAL,
      status TEXT NOT NULL, -- COMPLETE|PARTIAL|INCOMPLETE|BLOCKED|NOT_AVAILABLE
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_completeness_version ON audit_completeness_checks(source_version_id);

    -- One row per explicit, owner-triggered READ-ONLY Zoho acquisition.
    -- Reuses only endpoints already implemented/verified elsewhere in this
    -- app (invoices, bills) — see the Zoho Source Capability Matrix in
    -- MILESTONE_B_HANDOFF.md for what is and is not available.
    CREATE TABLE IF NOT EXISTS audit_zoho_acquisitions (
      acquisition_id TEXT PRIMARY KEY,
      workspace_id TEXT REFERENCES audit_workspaces(workspace_id),
      source_id TEXT REFERENCES audit_workspace_sources(source_id),
      organization_id TEXT NOT NULL,
      report_type TEXT NOT NULL, -- 'sales_invoices' | 'purchase_bills' (only verified types)
      requested_period_from TEXT,
      requested_period_to TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      endpoint_identity TEXT NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 0,
      api_call_count INTEGER NOT NULL DEFAULT 0,
      record_count INTEGER NOT NULL DEFAULT 0,
      first_record_date TEXT,
      last_record_date TEXT,
      coverage_status TEXT NOT NULL DEFAULT 'NOT_AVAILABLE', -- COMPLETE|PARTIAL|INCOMPLETE|BLOCKED|NOT_AVAILABLE
      status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING|RUNNING|SUCCESS|FAILED
      error TEXT,
      created_by TEXT NOT NULL DEFAULT 'OWNER',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_acq_workspace ON audit_zoho_acquisitions(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_acq_status ON audit_zoho_acquisitions(status);

    -- ========================================================
    -- Schema v5 (Milestone C): Deterministic matching & human review.
    -- A run is an immutable reference to a fixed set of FROZEN source
    -- versions (never mutable file/mapping state) plus the rule/config
    -- version that produced its candidates. Re-running never edits a
    -- past run's groups — it creates a new run.
    -- ========================================================

    CREATE TABLE IF NOT EXISTS audit_runs (
      run_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES audit_workspaces(workspace_id) ON DELETE CASCADE,
      rule_version TEXT NOT NULL, -- deterministic engine version string, e.g. 'matching-engine-v1'
      pinned_skill_version_id TEXT REFERENCES audit_skill_versions(version_id), -- informational only in Milestone C; AI stays disabled
      status TEXT NOT NULL DEFAULT 'CANDIDATES_GENERATED', -- CANDIDATES_GENERATED | REVIEWED | CLOSED
      created_by TEXT NOT NULL DEFAULT 'OWNER',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_runs_workspace ON audit_runs(workspace_id);

    -- One row per comparison edge inside a run's graph (e.g. Bill -> Vendor
    -- Statement, or Vendor Statement -> Payment). Both source_version_ids
    -- must be frozen at the time the edge is created — enforced in the
    -- service layer, not just here — so a run can never mix an in-progress
    -- (unfrozen) source with a completed comparison.
    CREATE TABLE IF NOT EXISTS audit_run_edges (
      edge_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES audit_runs(run_id) ON DELETE CASCADE,
      left_role_label TEXT NOT NULL,
      right_role_label TEXT NOT NULL,
      left_source_version_id TEXT NOT NULL REFERENCES audit_source_versions(version_id),
      right_source_version_id TEXT NOT NULL REFERENCES audit_source_versions(version_id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_run_edges_run ON audit_run_edges(run_id);

    -- A candidate produced by the deterministic engine. status is the ONLY
    -- mutable column here (besides updated_at) and only ever changes via a
    -- recorded audit_match_decisions row — never a silent update.
    CREATE TABLE IF NOT EXISTS audit_match_groups (
      group_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES audit_runs(run_id) ON DELETE CASCADE,
      edge_id TEXT NOT NULL REFERENCES audit_run_edges(edge_id) ON DELETE CASCADE,
      group_type TEXT NOT NULL, -- EXACT|GROUPED|PARTIAL|AMBIGUOUS|DISCREPANCY|UNMATCHED_LEFT|UNMATCHED_RIGHT
      discrepancy_subtype TEXT,
      status TEXT NOT NULL DEFAULT 'CANDIDATE', -- CANDIDATE|ACCEPTED|REJECTED|HELD|REVERSED
      residual_amount TEXT, -- decimal string; PARTIAL groups only
      residual_quantity TEXT, -- decimal string; PARTIAL groups only, tracked separately from money
      notes_json TEXT NOT NULL DEFAULT '[]',
      rule_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_match_groups_run ON audit_match_groups(run_id);
    CREATE INDEX IF NOT EXISTS idx_audit_match_groups_edge ON audit_match_groups(edge_id);
    CREATE INDEX IF NOT EXISTS idx_audit_match_groups_status ON audit_match_groups(status);
    CREATE INDEX IF NOT EXISTS idx_audit_match_groups_type ON audit_match_groups(group_type);

    -- Membership + allocation ledger. allocated_amount is the portion of
    -- THIS row's own amount consumed by THIS group — never the group total.
    -- A row may appear as a member of several groups (e.g. UNMATCHED then
    -- later re-run), but the service layer sums only ACCEPTED groups when
    -- checking for over-allocation/double-consumption.
    CREATE TABLE IF NOT EXISTS audit_match_members (
      member_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES audit_match_groups(group_id) ON DELETE CASCADE,
      row_id TEXT NOT NULL REFERENCES audit_normalized_rows(row_id),
      side TEXT NOT NULL, -- LEFT | RIGHT
      allocated_amount TEXT, -- decimal string; null when not amount-bearing (e.g. AMBIGUOUS/UNMATCHED)
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_match_members_group ON audit_match_members(group_id);
    CREATE INDEX IF NOT EXISTS idx_audit_match_members_row ON audit_match_members(row_id);

    -- Append-only reviewer decision history. audit_match_groups.status is
    -- the current-state projection of this log — never edited directly.
    CREATE TABLE IF NOT EXISTS audit_match_decisions (
      decision_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES audit_match_groups(group_id) ON DELETE CASCADE,
      decision TEXT NOT NULL, -- ACCEPTED|REJECTED|HELD|REVERSED
      reviewer TEXT NOT NULL,
      reason TEXT,
      source_snapshot_json TEXT NOT NULL, -- frozen source_version_ids + versions in effect at decision time
      rule_version TEXT NOT NULL,
      decided_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_match_decisions_group ON audit_match_decisions(group_id);

    -- ========================================================
    -- Schema v6 (Milestone D): Domain review, findings, action taken,
    -- reviewer sign-off, and immutable internal-review reports/exports.
    -- No accounting write path exists anywhere in this section — every
    -- table here only ever RECORDS a reviewer's own decision/finding;
    -- nothing here can mutate Zoho, Books, or a frozen source snapshot.
    -- ========================================================

    -- Coverage proof per review domain. A domain is only REVIEWED when
    -- explicitly recorded so — never inferred from "no mismatch found".
    CREATE TABLE IF NOT EXISTS audit_domain_reviews (
      review_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES audit_workspaces(workspace_id) ON DELETE CASCADE,
      run_id TEXT REFERENCES audit_runs(run_id),
      domain TEXT NOT NULL, -- BANK_CASH|RECEIVABLES|PAYABLES|PURCHASE_CHAIN|SALES_CHAIN|MATERIAL_STOCK|TRIAL_BALANCE|OVERALL_SUMMARY|TAX|PAYROLL|FIXED_ASSETS|LOANS|STATUTORY_LEGAL
      entity_name TEXT,
      period_from TEXT,
      period_to TEXT,
      source_snapshot_ids_json TEXT NOT NULL DEFAULT '[]', -- frozen source_version_ids actually used as evidence
      source_coverage_note TEXT,
      tests_performed_json TEXT NOT NULL DEFAULT '[]',
      matched_amount TEXT, -- decimal string
      matched_count INTEGER,
      unresolved_amount TEXT, -- decimal string
      unresolved_count INTEGER,
      exception_count INTEGER,
      limitations TEXT,
      status TEXT NOT NULL DEFAULT 'NOT_TESTED', -- REVIEWED|PARTIAL|BLOCKED|EXCLUDED|NOT_TESTED|NOT_AVAILABLE
      reviewer TEXT,
      created_by TEXT NOT NULL DEFAULT 'OWNER',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_domain_reviews_workspace ON audit_domain_reviews(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_audit_domain_reviews_domain ON audit_domain_reviews(domain);
    CREATE INDEX IF NOT EXISTS idx_audit_domain_reviews_status ON audit_domain_reviews(status);

    -- Findings register. confirmed_vs_suspected starts SUSPECTED by
    -- default and is only ever set to CONFIRMED by an explicit reviewer
    -- action — never inferred automatically from severity or amount.
    CREATE TABLE IF NOT EXISTS audit_findings (
      finding_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES audit_workspaces(workspace_id) ON DELETE CASCADE,
      run_id TEXT REFERENCES audit_runs(run_id),
      domain_review_id TEXT REFERENCES audit_domain_reviews(review_id),
      domain TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'INFO', -- INFO|LOW|MEDIUM|HIGH|CRITICAL — always reviewer-set, never amount-derived
      finding_type TEXT NOT NULL, -- see FINDING_TYPES in findings-service.ts
      title TEXT NOT NULL,
      description TEXT,
      confirmed_vs_suspected TEXT NOT NULL DEFAULT 'SUSPECTED', -- CONFIRMED|SUSPECTED|UNKNOWN
      financial_impact TEXT, -- decimal string; signed
      quantity_impact TEXT, -- decimal string
      currency TEXT,
      unit TEXT,
      affected_refs_json TEXT NOT NULL DEFAULT '[]', -- match_group_id(s) / normalized row_id(s)
      evidence_refs_json TEXT NOT NULL DEFAULT '[]', -- evidence_locator strings, drill-back to original source
      source_snapshot_json TEXT NOT NULL DEFAULT '{}',
      rule_version TEXT,
      reviewer TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN|UNDER_REVIEW|RESOLVED|DISMISSED
      created_by TEXT NOT NULL DEFAULT 'OWNER',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_findings_workspace ON audit_findings(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_audit_findings_domain ON audit_findings(domain);
    CREATE INDEX IF NOT EXISTS idx_audit_findings_severity ON audit_findings(severity);
    CREATE INDEX IF NOT EXISTS idx_audit_findings_status ON audit_findings(status);

    -- Action Taken workflow — deliberately independent of finding.status
    -- and of any match-group/allocation state. Closing an action here
    -- NEVER touches audit_findings, audit_match_groups, or any source
    -- table; see action-service.ts's closeAction() for the enforced gate.
    CREATE TABLE IF NOT EXISTS audit_actions (
      action_id TEXT PRIMARY KEY,
      finding_id TEXT NOT NULL REFERENCES audit_findings(finding_id) ON DELETE CASCADE,
      action_required TEXT NOT NULL,
      action_owner TEXT,
      assigned_by TEXT,
      assigned_at TEXT,
      due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'MEDIUM', -- LOW|MEDIUM|HIGH|URGENT
      action_status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN|ASSIGNED|IN_PROGRESS|WAITING_EVIDENCE|RESOLVED|CLOSED|CANCELLED
      action_comment TEXT,
      evidence_added_json TEXT NOT NULL DEFAULT '[]',
      completed_at TEXT,
      closed_by TEXT,
      closure_comment TEXT,
      created_by TEXT NOT NULL DEFAULT 'OWNER',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_actions_finding ON audit_actions(finding_id);
    CREATE INDEX IF NOT EXISTS idx_audit_actions_status ON audit_actions(action_status);

    -- Append-only action history/events (assign, status change, reopen, etc).
    CREATE TABLE IF NOT EXISTS audit_action_events (
      event_id TEXT PRIMARY KEY,
      action_id TEXT NOT NULL REFERENCES audit_actions(action_id) ON DELETE CASCADE,
      event_type TEXT NOT NULL, -- CREATED|ASSIGNED|ACTION_STATUS_CHANGED|EVIDENCE_ADDED|CLOSED|REOPENED
      previous_status TEXT,
      new_status TEXT,
      actor TEXT NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_action_events_action ON audit_action_events(action_id);

    -- Generic reviewer decision/sign-off log, reusable at finding,
    -- domain-review, or report level via entity_type/entity_id.
    CREATE TABLE IF NOT EXISTS audit_reviewer_decisions (
      decision_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL, -- finding|domain_review|report
      entity_id TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      role_context TEXT,
      decision TEXT NOT NULL,
      comment TEXT,
      source_run_version_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_reviewer_decisions_entity ON audit_reviewer_decisions(entity_type, entity_id);

    -- Immutable internal-review report "document" — one row per
    -- generated version. Every field below is a SNAPSHOT taken at
    -- generation time; nothing here is ever re-read from live state
    -- afterward. Regenerating with different settings creates a NEW row
    -- (report_version increments) — a past report is never edited.
    CREATE TABLE IF NOT EXISTS audit_reports (
      report_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES audit_workspaces(workspace_id) ON DELETE CASCADE,
      run_id TEXT REFERENCES audit_runs(run_id),
      report_version INTEGER NOT NULL,
      entity_name TEXT,
      period_from TEXT,
      period_to TEXT,
      purpose TEXT,
      comparison_modes_json TEXT NOT NULL DEFAULT '[]',
      scope_json TEXT NOT NULL DEFAULT '{}',
      source_register_json TEXT NOT NULL DEFAULT '[]',
      domain_coverage_json TEXT NOT NULL DEFAULT '[]', -- snapshot of audit_domain_reviews at generation time
      matching_summary_json TEXT NOT NULL DEFAULT '{}', -- exact/grouped/partial/ambiguous/unmatched + net vs absolute residual
      findings_snapshot_json TEXT NOT NULL DEFAULT '[]',
      actions_snapshot_json TEXT NOT NULL DEFAULT '[]',
      reviewer_decisions_json TEXT NOT NULL DEFAULT '[]',
      assumptions TEXT,
      limitations TEXT,
      exclusions TEXT,
      not_tested_domains_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT|UNDER_REVIEW|REVIEWED|ISSUED_INTERNAL|SUPERSEDED
      generated_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'OWNER',
      UNIQUE(workspace_id, report_version)
    );
    CREATE INDEX IF NOT EXISTS idx_audit_reports_workspace ON audit_reports(workspace_id);

    -- One row per exported artifact (Excel/PDF) derived from an
    -- immutable audit_reports row — export never reruns matching/AI/
    -- Zoho/parsing, it only formats the already-frozen report snapshot.
    CREATE TABLE IF NOT EXISTS audit_report_exports (
      export_id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES audit_reports(report_id) ON DELETE CASCADE,
      format TEXT NOT NULL, -- EXCEL|PDF
      selected_fields_json TEXT NOT NULL DEFAULT '[]',
      filter_params_json TEXT NOT NULL DEFAULT '{}',
      file_hash TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT,
      generated_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'OWNER'
    );
    CREATE INDEX IF NOT EXISTS idx_audit_report_exports_report ON audit_report_exports(report_id);

    -- ========================================================
    -- Schema v7 (Milestone E): Controlled Learning — governed rule
    -- proposals, one-time overrides, unsupported-case workflow, and
    -- conflict detection. Default behavior is SUGGEST_ONLY: nothing here
    -- writes to Zoho, mutates a frozen source/run/report, or activates
    -- itself. A proposal only reaches ACTIVE through an explicit OWNER
    -- approval action recorded below — never automatically.
    -- ========================================================

    -- One row per rule VERSION (immutable identity fields). A later
    -- correction to an ACTIVE rule creates a NEW row with
    -- predecessor_version_id set — it never edits this row in place.
    -- rule_key groups every version of "the same logical rule" so
    -- history/rollback can find its lineage.
    CREATE TABLE IF NOT EXISTS learning_proposals (
      proposal_id TEXT PRIMARY KEY,
      rule_key TEXT NOT NULL, -- stable logical identity shared by every version of this rule
      version_number INTEGER NOT NULL,
      predecessor_version_id TEXT REFERENCES learning_proposals(proposal_id),
      proposal_type TEXT NOT NULL, -- see LEARNING_PROPOSAL_TYPES in learning-types.ts
      module TEXT NOT NULL,
      workspace_id TEXT REFERENCES audit_workspaces(workspace_id),
      scope_type TEXT NOT NULL, -- GLOBAL|ENTITY|MODULE|CUSTOMER|VENDOR|PARTY|SOURCE_TYPE|SOURCE_FORMAT|WORKSPACE|DATE_RANGE
      scope_value_json TEXT NOT NULL DEFAULT '{}', -- e.g. { customerId: '...' } or { dateFrom, dateTo }
      source_format_scope TEXT,
      effective_from TEXT,
      effective_to TEXT,
      rule_config_json TEXT NOT NULL DEFAULT '{}', -- declarative match spec (matchField/matchPattern) — never executable code
      title TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      rationale TEXT,
      expected_impact TEXT,
      affected_records_estimate INTEGER,
      test_results_json TEXT NOT NULL DEFAULT '{}', -- last runProposalTests() result, frozen at test time
      conflict_analysis_json TEXT NOT NULL DEFAULT '[]',
      rollback_of_version_id TEXT REFERENCES learning_proposals(proposal_id), -- set only when this version was created BY a rollback action
      expiry_date TEXT,
      review_by_date TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT|TESTING|PENDING_APPROVAL|ACTIVE|DISABLED|EXPIRED|REJECTED|ARCHIVED
      created_by TEXT NOT NULL DEFAULT 'OWNER',
      approved_by TEXT,
      approved_at TEXT,
      activated_at TEXT,
      disabled_at TEXT,
      disabled_by TEXT,
      disabled_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_learning_proposals_rule_key ON learning_proposals(rule_key);
    CREATE INDEX IF NOT EXISTS idx_learning_proposals_status ON learning_proposals(status);
    CREATE INDEX IF NOT EXISTS idx_learning_proposals_scope_type ON learning_proposals(scope_type);

    -- Positive / negative / hard-negative examples attached to a proposal
    -- version. A proposal may not be tested (and so may never activate)
    -- without at least one positive and one negative example — enforced
    -- in learning-service.ts, not just here.
    CREATE TABLE IF NOT EXISTS learning_proposal_examples (
      example_id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL REFERENCES learning_proposals(proposal_id) ON DELETE CASCADE,
      example_type TEXT NOT NULL, -- POSITIVE|NEGATIVE|HARD_NEGATIVE
      input_json TEXT NOT NULL,
      expected_apply INTEGER NOT NULL, -- 1 for POSITIVE, 0 for NEGATIVE/HARD_NEGATIVE
      description TEXT,
      created_by TEXT NOT NULL DEFAULT 'OWNER',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_learning_examples_proposal ON learning_proposal_examples(proposal_id);

    -- Append-only lifecycle/event log per proposal (submit, test-run,
    -- approve, activate, disable, rollback, archive, renew, conflict...).
    -- status on learning_proposals is the current-state projection of
    -- this log — never edited directly outside the recorded transition.
    CREATE TABLE IF NOT EXISTS learning_proposal_events (
      event_id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL REFERENCES learning_proposals(proposal_id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      previous_status TEXT,
      new_status TEXT,
      actor TEXT NOT NULL,
      comment TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_learning_events_proposal ON learning_proposal_events(proposal_id);

    -- Detected conflicts between two proposals (active or pending). Conflict
    -- detection STOPS the affected activation and requires an explicit
    -- OWNER resolution — it never silently picks a winner.
    CREATE TABLE IF NOT EXISTS learning_conflicts (
      conflict_id TEXT PRIMARY KEY,
      proposal_a_id TEXT NOT NULL REFERENCES learning_proposals(proposal_id) ON DELETE CASCADE,
      proposal_b_id TEXT NOT NULL REFERENCES learning_proposals(proposal_id) ON DELETE CASCADE,
      conflict_type TEXT NOT NULL, -- SAME_SCOPE_SAME_RULE_KEY_DIFFERENT_CONFIG|OVERLAPPING_SCOPE|OVERLAPPING_DATE_RANGE|GLOBAL_VS_SCOPED|SIGN_PERSPECTIVE_DISAGREEMENT
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN|RESOLVED
      resolution TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_learning_conflicts_status ON learning_conflicts(status);
    CREATE INDEX IF NOT EXISTS idx_learning_conflicts_proposal_a ON learning_conflicts(proposal_a_id);
    CREATE INDEX IF NOT EXISTS idx_learning_conflicts_proposal_b ON learning_conflicts(proposal_b_id);

    -- A one-time approved override on a specific case. Structurally
    -- separate from learning_proposals — applying an override NEVER
    -- edits any rule/proposal row and NEVER trains anything automatically.
    CREATE TABLE IF NOT EXISTS learning_overrides (
      override_id TEXT PRIMARY KEY,
      workspace_id TEXT REFERENCES audit_workspaces(workspace_id),
      finding_id TEXT REFERENCES audit_findings(finding_id),
      unsupported_case_id TEXT,
      target_description TEXT NOT NULL,
      override_action TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL DEFAULT 'OWNER',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_learning_overrides_workspace ON learning_overrides(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_learning_overrides_finding ON learning_overrides(finding_id);

    -- The "Unsupported / Uncertain Case" workflow (Milestone E §5). Every
    -- unresolved case must record why no safe automatic decision was
    -- possible, and the owner's explicit chosen resolution path — never
    -- silently defaulted.
    CREATE TABLE IF NOT EXISTS learning_unsupported_cases (
      case_id TEXT PRIMARY KEY,
      workspace_id TEXT REFERENCES audit_workspaces(workspace_id),
      finding_id TEXT REFERENCES audit_findings(finding_id),
      description TEXT NOT NULL,
      affected_records_estimate INTEGER,
      affected_amount TEXT,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      current_rules_json TEXT NOT NULL DEFAULT '[]',
      reason_no_safe_decision TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN|HOLD|EVIDENCE_REQUESTED|OVERRIDE_APPLIED|RULE_PROPOSED|RESOLVED
      resolution_type TEXT, -- HOLD|REQUEST_EVIDENCE|ONE_TIME_OVERRIDE|PROPOSE_RULE
      resolution_ref_id TEXT, -- override_id or proposal_id, depending on resolution_type
      resolved_by TEXT,
      resolved_at TEXT,
      created_by TEXT NOT NULL DEFAULT 'OWNER',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_learning_unsupported_workspace ON learning_unsupported_cases(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_learning_unsupported_status ON learning_unsupported_cases(status);
    -- ========================================================
    -- Schema v8 (Class E Recovery): BOM, P0, Traceability
    -- ========================================================

    CREATE TABLE IF NOT EXISTS audit_bom_master (
      bom_id TEXT PRIMARY KEY,
      composite_item_id TEXT NOT NULL,
      composite_item_sku TEXT,
      composite_item_name TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      effective_from TEXT,
      effective_to TEXT,
      description TEXT,
      predecessor_version_id TEXT REFERENCES audit_bom_master(bom_id),
      rollback_of_bom_id TEXT REFERENCES audit_bom_master(bom_id),
      created_by TEXT NOT NULL DEFAULT 'OWNER',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      submitted_at TEXT,
      approved_by TEXT,
      approved_at TEXT,
      disabled_by TEXT,
      disabled_at TEXT,
      disabled_reason TEXT,
      superseded_by_bom_id TEXT REFERENCES audit_bom_master(bom_id),
      UNIQUE(composite_item_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_audit_bom_master_item ON audit_bom_master(composite_item_id);
    CREATE INDEX IF NOT EXISTS idx_audit_bom_master_status ON audit_bom_master(status);

    CREATE TABLE IF NOT EXISTS audit_bom_components (
      bom_component_id TEXT PRIMARY KEY,
      bom_version_id TEXT NOT NULL REFERENCES audit_bom_master(bom_id) ON DELETE CASCADE,
      component_item_id TEXT NOT NULL,
      component_sku TEXT,
      component_description TEXT,
      qty_per_composite_unit TEXT NOT NULL,
      uom TEXT NOT NULL,
      tolerance_qty TEXT,
      tolerance_percent TEXT,
      required_flag INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_bom_components_version ON audit_bom_components(bom_version_id);
    CREATE INDEX IF NOT EXISTS idx_audit_bom_components_item ON audit_bom_components(component_item_id);

    CREATE TABLE IF NOT EXISTS audit_p0_alerts (
      alert_id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      severity TEXT NOT NULL,
      detection_state TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      affected_amount TEXT,
      evidence_json TEXT NOT NULL DEFAULT '{}',
      recommended_action TEXT NOT NULL,
      requires_professional_review INTEGER NOT NULL DEFAULT 0,
      zoho_modified_at TEXT,
      fetched_at TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      alert_created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      dedup_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_p0_alerts_dedup ON audit_p0_alerts(dedup_key);
    CREATE INDEX IF NOT EXISTS idx_audit_p0_alerts_source ON audit_p0_alerts(source_key);
    CREATE INDEX IF NOT EXISTS idx_audit_p0_alerts_severity ON audit_p0_alerts(severity);
    CREATE INDEX IF NOT EXISTS idx_audit_p0_alerts_status ON audit_p0_alerts(status);

    CREATE TABLE IF NOT EXISTS audit_traceability_alerts (
      alert_id TEXT PRIMARY KEY,
      alert_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      severity TEXT NOT NULL,
      detection_state TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      affected_qty TEXT,
      affected_amount TEXT,
      evidence_json TEXT NOT NULL DEFAULT '{}',
      recommended_action TEXT NOT NULL,
      zoho_modified_at TEXT,
      fetched_at TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      alert_created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      dedup_key TEXT NOT NULL,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      baseline_status TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_trace_alerts_dedup ON audit_traceability_alerts(dedup_key);
    CREATE INDEX IF NOT EXISTS idx_audit_trace_alerts_type ON audit_traceability_alerts(alert_type);
    CREATE INDEX IF NOT EXISTS idx_audit_trace_alerts_severity ON audit_traceability_alerts(severity);
    CREATE INDEX IF NOT EXISTS idx_audit_trace_alerts_status ON audit_traceability_alerts(status);

    -- Phase 2C: Local Audit Source Persistence Foundation

    CREATE TABLE IF NOT EXISTS audit_zoho_source_runs (
      source_run_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'RUNNING',
      api_domain TEXT,
      records_seen INTEGER NOT NULL DEFAULT 0,
      records_written INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_coa (
      organization_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      account_name TEXT NOT NULL,
      account_code TEXT,
      account_type TEXT NOT NULL,
      account_sub_type TEXT,
      parent_account_id TEXT,
      parent_account_name TEXT,
      is_active INTEGER,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, account_id, source_run_id)
    );

    CREATE INDEX IF NOT EXISTS idx_audit_zoho_coa_run ON audit_zoho_coa(source_run_id);
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_coa_id ON audit_zoho_coa(organization_id, account_id);

    CREATE TABLE IF NOT EXISTS audit_zoho_bank_accounts (
      organization_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      account_name TEXT NOT NULL,
      account_type TEXT NOT NULL,
      currency_id TEXT,
      currency_code TEXT,
      is_active INTEGER,
      masked_account_number TEXT,
      balance REAL,
      uncategorized_transaction_count INTEGER,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, account_id, source_run_id)
    );

    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_acc_run ON audit_zoho_bank_accounts(source_run_id);
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_acc_id ON audit_zoho_bank_accounts(organization_id, account_id);
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_acc_type ON audit_zoho_bank_accounts(account_type);

    CREATE TABLE IF NOT EXISTS audit_zoho_bank_transactions (
      organization_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      account_id TEXT NOT NULL,
      account_name TEXT,
      date TEXT,
      amount REAL NOT NULL,
      transaction_type TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT,
      debit_or_credit TEXT,
      reference_number TEXT,
      payee TEXT,
      description TEXT,
      currency_id TEXT,
      currency_code TEXT,
      imported_transaction_id TEXT,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      running_balance REAL,
      api_sequence INTEGER,
      PRIMARY KEY (organization_id, transaction_id, account_id)
    );

    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_run ON audit_zoho_bank_transactions(source_run_id);
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_id ON audit_zoho_bank_transactions(organization_id, transaction_id);
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_acc_date ON audit_zoho_bank_transactions(account_id, date);
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_status ON audit_zoho_bank_transactions(status);
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_type ON audit_zoho_bank_transactions(transaction_type);

    CREATE TABLE IF NOT EXISTS audit_bank_coa_mappings (
      mapping_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      bank_account_id TEXT NOT NULL,
      bank_source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      coa_account_id TEXT,
      coa_source_run_id TEXT REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      mapping_method TEXT NOT NULL,
      mapping_status TEXT NOT NULL,
      evidence_reason TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by TEXT,
      superseded_by_mapping_id TEXT REFERENCES audit_bank_coa_mappings(mapping_id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS audit_bank_statement_sources (
      source_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      bank_account_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      folder_path TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_bank_statements (
      statement_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES audit_bank_statement_sources(source_id) ON DELETE RESTRICT,
      bank_account_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_hash TEXT,
      period_from TEXT,
      period_to TEXT,
      imported_at TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_bank_statement_transactions (
      statement_id TEXT NOT NULL REFERENCES audit_bank_statements(statement_id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      date TEXT NOT NULL,
      value_date TEXT,
      description TEXT,
      reference TEXT,
      debit REAL,
      credit REAL,
      amount REAL NOT NULL,
      running_balance REAL,
      match_status TEXT,
      matched_books_txn_id TEXT,
      PRIMARY KEY (statement_id, row_index)
    );

    CREATE INDEX IF NOT EXISTS idx_mapping_org_bank ON audit_bank_coa_mappings(organization_id, bank_account_id);
    CREATE INDEX IF NOT EXISTS idx_mapping_status ON audit_bank_coa_mappings(mapping_status);
    CREATE INDEX IF NOT EXISTS idx_mapping_bank_run ON audit_bank_coa_mappings(bank_source_run_id);

    -- Phase 2D: Transaction Chain Persistence
    CREATE TABLE IF NOT EXISTS audit_zoho_sales_orders (
      organization_id TEXT NOT NULL,
      salesorder_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      salesorder_number TEXT,
      customer_id TEXT,
      customer_name TEXT,
      delivery_customer_name TEXT,
      date TEXT,
      shipment_date TEXT,
      status TEXT,
      currency TEXT,
      total REAL,
      sub_total REAL,
      tax_total REAL,
      adjustment REAL,
      is_inclusive_tax INTEGER,
      discount_total REAL,
      discount_type TEXT,
      is_discount_before_tax INTEGER,
      custom_fields_json TEXT,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, salesorder_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_invoices (
      organization_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      invoice_number TEXT,
      customer_id TEXT,
      delivery_customer_name TEXT,
      salesorder_id TEXT,
      date TEXT,
      due_date TEXT,
      status TEXT,
      total REAL,
      balance REAL,
      currency_code TEXT,
      sub_total REAL,
      tax_total REAL,
      total_taxable_amount REAL,
      adjustment REAL,
      is_inclusive_tax INTEGER,
      discount_total REAL,
      discount_type TEXT,
      is_discount_before_tax INTEGER,
      tds_amount REAL,
      retention_amount REAL,
      custom_fields_json TEXT,
      submitted_by_name TEXT,
      submitter_id TEXT,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, invoice_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_invoice_lines (
      organization_id TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      item_id TEXT,
      item_name TEXT,
      description TEXT,
      sku TEXT,
      quantity REAL,
      rate REAL,
      amount REAL,
      unit TEXT,
      PRIMARY KEY (organization_id, line_item_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_sales_adjustments (
      organization_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      adjustment_id TEXT,
      adjustment_type TEXT NOT NULL,
      source_field_name TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT,
      linked_entity_id TEXT,
      reference_date TEXT,
      PRIMARY KEY (organization_id, invoice_id, source_run_id, adjustment_type, source_field_name, linked_entity_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_sales_order_lines (
      organization_id TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      salesorder_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      item_id TEXT,
      item_name TEXT,
      description TEXT,
      sku TEXT,
      quantity REAL,
      rate REAL,
      amount REAL,
      unit TEXT,
      PRIMARY KEY (organization_id, line_item_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_customer_payments (
      organization_id TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      payment_number TEXT,
      customer_id TEXT,
      customer_name TEXT,
      date TEXT,
      amount REAL,
      unused_amount REAL,
      payment_mode TEXT,
      reference_number TEXT,
      invoice_numbers TEXT,
      currency TEXT,
      account_id TEXT,
      status TEXT,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, payment_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_customer_payment_allocations (
      organization_id TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      invoice_number TEXT,
      amount_applied REAL,
      invoice_amount REAL,
      balance_amount REAL,
      PRIMARY KEY (organization_id, payment_id, invoice_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_credit_notes (
      organization_id TEXT NOT NULL,
      creditnote_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      creditnote_number TEXT,
      customer_id TEXT,
      customer_name TEXT,
      date TEXT,
      status TEXT,
      currency TEXT,
      total REAL,
      balance REAL,
      reference_number TEXT,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, creditnote_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_credit_note_applications (
      organization_id TEXT NOT NULL,
      creditnote_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      invoice_number TEXT,
      amount_applied REAL,
      PRIMARY KEY (organization_id, creditnote_id, invoice_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_purchase_orders (
      organization_id TEXT NOT NULL,
      purchaseorder_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      purchaseorder_number TEXT,
      vendor_id TEXT,
      vendor_name TEXT,
      delivery_customer_name TEXT,
      date TEXT,
      delivery_date TEXT,
      status TEXT,
      currency TEXT,
      total REAL,
      sub_total REAL,
      tax_total REAL,
      adjustment REAL,
      is_inclusive_tax INTEGER,
      discount_total REAL,
      discount_type TEXT,
      is_discount_before_tax INTEGER,
      custom_fields_json TEXT,
      submitted_by_name TEXT,
      submitter_id TEXT,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, purchaseorder_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_purchase_order_lines (
      organization_id TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      purchaseorder_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      item_id TEXT,
      item_name TEXT,
      description TEXT,
      sku TEXT,
      quantity REAL,
      rate REAL,
      amount REAL,
      unit TEXT,
      PRIMARY KEY (organization_id, line_item_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_bills (
      organization_id TEXT NOT NULL,
      bill_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      bill_number TEXT,
      vendor_id TEXT,
      vendor_name TEXT,
      purchaseorder_id TEXT,
      date TEXT,
      due_date TEXT,
      status TEXT,
      currency TEXT,
      total REAL,
      balance REAL,
      sub_total REAL,
      tax_total REAL,
      total_taxable_amount REAL,
      adjustment REAL,
      is_inclusive_tax INTEGER,
      discount_total REAL,
      discount_type TEXT,
      is_discount_before_tax INTEGER,
      tds_amount REAL,
      retention_amount REAL,
      custom_fields_json TEXT,
      submitted_by_name TEXT,
      submitter_id TEXT,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, bill_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_bill_lines (
      organization_id TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      bill_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      item_id TEXT,
      item_name TEXT,
      description TEXT,
      sku TEXT,
      quantity REAL,
      rate REAL,
      amount REAL,
      PRIMARY KEY (organization_id, line_item_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_vendor_payments (
      organization_id TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      payment_number TEXT,
      vendor_id TEXT,
      vendor_name TEXT,
      date TEXT,
      amount REAL,
      payment_mode TEXT,
      reference_number TEXT,
      bill_numbers TEXT,
      currency TEXT,
      paid_through_account_id TEXT,
      status TEXT,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, payment_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_vendor_payment_allocations (
      organization_id TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      bill_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      bill_number TEXT,
      amount_applied REAL,
      PRIMARY KEY (organization_id, payment_id, bill_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_vendor_credits (
      organization_id TEXT NOT NULL,
      vendor_credit_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      vendor_credit_number TEXT,
      vendor_id TEXT,
      vendor_name TEXT,
      date TEXT,
      status TEXT,
      currency TEXT,
      total REAL,
      balance REAL,
      reference_number TEXT,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, vendor_credit_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_vendor_credit_applications (
      organization_id TEXT NOT NULL,
      vendor_credit_id TEXT NOT NULL,
      bill_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      bill_number TEXT,
      amount_applied REAL,
      PRIMARY KEY (organization_id, vendor_credit_id, bill_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_journals (
      organization_id TEXT NOT NULL,
      journal_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      journal_number TEXT,
      date TEXT,
      reference_number TEXT,
      status TEXT,
      notes TEXT,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, journal_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_journal_lines (
      organization_id TEXT NOT NULL,
      line_id TEXT NOT NULL,
      journal_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      account_id TEXT,
      account_name TEXT,
      debit REAL,
      credit REAL,
      contact_id TEXT,
      project_id TEXT,
      tax_id TEXT,
      description TEXT,
      PRIMARY KEY (organization_id, line_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_expenses (
      organization_id TEXT NOT NULL,
      expense_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      date TEXT,
      account_id TEXT,
      account_name TEXT,
      paid_through_account_id TEXT,
      vendor_id TEXT,
      amount REAL,
      currency TEXT,
      reference_number TEXT,
      status TEXT,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, expense_id, source_run_id)
    );

    CREATE TABLE IF NOT EXISTS audit_reconciliation_runs (
      reconciliation_run_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      period_from TEXT,
      period_to TEXT,
      ruleset_version TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      error_count INTEGER DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_reconciliation_run_sources (
      id TEXT PRIMARY KEY,
      reconciliation_run_id TEXT NOT NULL REFERENCES audit_reconciliation_runs(reconciliation_run_id) ON DELETE RESTRICT,
      source_type TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_reconciliation_cases (
      case_id TEXT PRIMARY KEY,
      reconciliation_run_id TEXT NOT NULL REFERENCES audit_reconciliation_runs(reconciliation_run_id) ON DELETE RESTRICT,
      organization_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      primary_source_type TEXT NOT NULL,
      primary_source_id TEXT NOT NULL,
      primary_source_run_id TEXT NOT NULL,
      machine_result TEXT NOT NULL,
      settlement_status TEXT,
      remaining_amount REAL,
      owner_review_status TEXT NOT NULL DEFAULT 'OPEN',
      severity TEXT NOT NULL DEFAULT 'INFO',
      base_amount REAL,
      expected_settlement_amount REAL,
      observed_settlement_amount REAL,
      difference_amount REAL,
      currency_code TEXT,
      difference_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_reconciliation_links (
      link_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES audit_reconciliation_cases(case_id) ON DELETE RESTRICT,
      organization_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      relationship_type TEXT NOT NULL,
      evidence_strength TEXT NOT NULL,
      amount_contribution REAL,
      currency_code TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_reconciliation_evidence (
      evidence_id TEXT PRIMARY KEY,
      link_id TEXT NOT NULL REFERENCES audit_reconciliation_links(link_id) ON DELETE RESTRICT,
      reason_code TEXT NOT NULL,
      reason_text TEXT,
      field_name TEXT,
      source_value_redacted TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_reconciliation_amount_bridge (
      bridge_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES audit_reconciliation_cases(case_id) ON DELETE RESTRICT,
      sequence_no INTEGER NOT NULL,
      component_type TEXT NOT NULL,
      component_sign INTEGER NOT NULL,
      component_amount REAL NOT NULL,
      currency_code TEXT NOT NULL,
      source_type TEXT,
      source_id TEXT,
      source_run_id TEXT REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
      reason_code TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_reconciliation_review_history (
      history_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES audit_reconciliation_cases(case_id) ON DELETE RESTRICT,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      reviewed_by TEXT,
      comment TEXT,
      evidence_reference TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_section_syncs (
      section_key TEXT PRIMARY KEY,
      period_from TEXT,
      period_to TEXT,
      all_periods INTEGER,
      started_at TEXT,
      completed_at TEXT,
      status TEXT,
      records_checked INTEGER,
      records_created INTEGER,
      records_updated INTEGER,
      records_unchanged INTEGER,
      records_failed INTEGER,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_recon_runs_org_domain ON audit_reconciliation_runs(organization_id, domain);

    CREATE INDEX IF NOT EXISTS idx_audit_recon_run_src_run_id ON audit_reconciliation_run_sources(reconciliation_run_id);
    CREATE INDEX IF NOT EXISTS idx_audit_recon_run_src_src_id ON audit_reconciliation_run_sources(source_run_id);

    CREATE INDEX IF NOT EXISTS idx_audit_recon_cases_run_res ON audit_reconciliation_cases(reconciliation_run_id, machine_result);
    CREATE INDEX IF NOT EXISTS idx_audit_recon_cases_src ON audit_reconciliation_cases(primary_source_type, primary_source_id);

    CREATE INDEX IF NOT EXISTS idx_audit_recon_links_case_id ON audit_reconciliation_links(case_id);
    CREATE INDEX IF NOT EXISTS idx_audit_recon_links_src ON audit_reconciliation_links(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_audit_recon_links_src_run ON audit_reconciliation_links(source_run_id);

    CREATE INDEX IF NOT EXISTS idx_audit_recon_evid_link_id ON audit_reconciliation_evidence(link_id);

    CREATE INDEX IF NOT EXISTS idx_audit_recon_bridge_case_seq ON audit_reconciliation_amount_bridge(case_id, sequence_no);

    CREATE INDEX IF NOT EXISTS idx_audit_recon_rev_hist_case_time ON audit_reconciliation_review_history(case_id, reviewed_at);

  `);

  // Additive column migrations for future schema growth must land here,
  // as try/catch ALTER TABLE statements, BEFORE any index that references
  // the new column — never as a second CREATE TABLE IF NOT EXISTS pass.
  // (This mirrors the zoho_activity_logs fix in app/lib/db/database.ts:
  // an index on a column an older DB file does not have yet aborts the
  // whole exec() with "no such column", so column adds must complete first.)
  try {
    db.exec("ALTER TABLE audit_skill_versions ADD COLUMN validation_report_json TEXT;");
  } catch {
    // column already present on a DB created after this migration landed
  }
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_audit_skill_versions_validation ON audit_skill_versions(validation_report_json);"
    );
  } catch {
    // only reachable if the ALTER above failed for a reason other than "column exists"
  }

  // Schema v4: explicit header/data-start row selection for CSV/XLSX mapping
  // (owner never has row 1 silently assumed as the header).
  try {
    db.exec("ALTER TABLE audit_source_mappings ADD COLUMN header_row_number INTEGER;");
  } catch {
    // column already present
  }
  try {
    db.exec("ALTER TABLE audit_source_mappings ADD COLUMN data_start_row_number INTEGER;");
  } catch {
    // column already present
  }

  // Schema v5: quantity residual on a PARTIAL match group, tracked
  // separately from residual_amount. Added via ALTER (not only in the
  // CREATE TABLE above) because a dev/running instance may already have
  // created audit_match_groups via an earlier version of this migration —
  // CREATE TABLE IF NOT EXISTS is a no-op against an existing table, so a
  // new column always needs its own ALTER, exactly like the v4 pattern above.
  try {
    db.exec("ALTER TABLE audit_match_groups ADD COLUMN residual_quantity TEXT;");
  } catch {
    // column already present
  }

  // Schema v6: Section Sync added delivery_customer_name and custom_fields_json
  // to purchase orders, and invoice_numbers to customer payments.
  try {
    db.exec("ALTER TABLE audit_zoho_purchase_orders ADD COLUMN delivery_customer_name TEXT;");
  } catch {}

  try {
    db.exec("ALTER TABLE audit_zoho_purchase_orders ADD COLUMN custom_fields_json TEXT;");
  } catch {}

  try {
    db.exec("ALTER TABLE audit_zoho_customer_payments ADD COLUMN invoice_numbers TEXT;");
  } catch {}

  try {
    db.exec("ALTER TABLE audit_zoho_sales_orders ADD COLUMN delivery_customer_name TEXT;");
  } catch {}

  try {
    db.exec("ALTER TABLE audit_zoho_sales_orders ADD COLUMN custom_fields_json TEXT;");
  } catch {}

  try {
    db.exec("ALTER TABLE audit_zoho_vendor_payments ADD COLUMN bill_numbers TEXT;");
  } catch {}

  try {
    db.exec("ALTER TABLE audit_zoho_invoices ADD COLUMN delivery_customer_name TEXT;");
  } catch {}

  try {
    db.exec("ALTER TABLE audit_zoho_invoices ADD COLUMN custom_fields_json TEXT;");
  } catch {}

  try {
    db.exec("ALTER TABLE audit_zoho_bills ADD COLUMN custom_fields_json TEXT;");
  } catch {}

  try { db.exec("ALTER TABLE audit_zoho_sales_order_lines ADD COLUMN description TEXT;"); } catch {}
  try { db.exec("ALTER TABLE audit_zoho_purchase_order_lines ADD COLUMN description TEXT;"); } catch {}
  try { db.exec("ALTER TABLE audit_zoho_invoice_lines ADD COLUMN description TEXT;"); } catch {}
  try { db.exec("ALTER TABLE audit_zoho_bill_lines ADD COLUMN description TEXT;"); } catch {}

  // AP-UOM-BRIDGE-I1 - Optional SO/PO line UOM evidence (nullable, no default)
  ensureSoPoLineUnitColumns(db);

  // R1A-UOM: Idempotently add nullable unit column to invoice lines
  ensureInvoiceLineUnitColumn(db);

  // 3B.4E - Submitter evidence
  try { db.exec("ALTER TABLE audit_zoho_purchase_orders ADD COLUMN submitted_by_name TEXT;"); } catch {}
  try { db.exec("ALTER TABLE audit_zoho_purchase_orders ADD COLUMN submitter_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE audit_zoho_invoices ADD COLUMN submitted_by_name TEXT;"); } catch {}
  try { db.exec("ALTER TABLE audit_zoho_invoices ADD COLUMN submitter_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE audit_zoho_bills ADD COLUMN submitted_by_name TEXT;"); } catch {}
  try { db.exec("ALTER TABLE audit_zoho_bills ADD COLUMN submitter_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE pre_audit_checkpoint_results ADD COLUMN human_review_status TEXT DEFAULT 'PENDING HUMAN REVIEW';"); } catch {}
  try { db.exec("ALTER TABLE pre_audit_checkpoint_results ADD COLUMN human_review_note TEXT;"); } catch {}
  try { db.exec("ALTER TABLE pre_audit_checkpoint_results ADD COLUMN human_review_timestamp TEXT;"); } catch {}
  try { db.exec("ALTER TABLE audit_zoho_bank_transactions ADD COLUMN running_balance REAL;"); } catch {}
  try { db.exec("ALTER TABLE audit_zoho_bank_transactions ADD COLUMN api_sequence INTEGER;"); } catch {}

  // Schema v13: Add organization_id to pre_audit_runs for authoritative run ownership.
  // ALTER TABLE migration runs before CREATE TABLE so existing DBs get the column
  // before any index that references it.
  try { db.exec("ALTER TABLE pre_audit_runs ADD COLUMN organization_id TEXT;"); } catch {}

  // Schema v9 (Pre-Audit Verification): Process tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS pre_audit_runs (
      run_id TEXT PRIMARY KEY,
      organization_id TEXT,
      financial_year TEXT NOT NULL,
      process_status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      engine_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pre_audit_runs_fy ON pre_audit_runs(financial_year);
    CREATE INDEX IF NOT EXISTS idx_pre_audit_runs_org ON pre_audit_runs(organization_id);

    CREATE TABLE IF NOT EXISTS pre_audit_checkpoint_results (
      result_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES pre_audit_runs(run_id) ON DELETE CASCADE,
      checkpoint_key TEXT NOT NULL,
      financial_year TEXT NOT NULL,
      process_status TEXT NOT NULL,
      result_status TEXT NOT NULL,
      source TEXT,
      records_checked INTEGER NOT NULL DEFAULT 0,
      expected_value TEXT,
      expected_json TEXT,
      actual_value TEXT,
      actual_json TEXT,
      exact_difference TEXT,
      evidence_locator TEXT,
      evidence_json TEXT,
      blocked_reason TEXT,
      limitation TEXT,
      exception_linkage_json TEXT,
      started_at TEXT,
      completed_at TEXT,
      engine_version TEXT,
      UNIQUE(run_id, checkpoint_key)
    );
    CREATE INDEX IF NOT EXISTS idx_pre_audit_checkpoint_results_run ON pre_audit_checkpoint_results(run_id);
  `);

  // Schema v10: Manual SO↔PO Line Mapping (Phase 1)
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_so_po_line_mappings (
      mapping_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      salesorder_id TEXT NOT NULL,
      so_line_item_id TEXT NOT NULL,
      purchaseorder_id TEXT NOT NULL,
      po_line_item_id TEXT NOT NULL,
      mapping_kind TEXT NOT NULL CHECK(mapping_kind IN ('OWNER_FALLBACK', 'OWNER_OVERRIDE')),
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'REVIEW_REQUIRED', 'REVOKED')),
      so_fingerprint TEXT NOT NULL,
      po_fingerprint TEXT NOT NULL,
      decision_source TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      review_required_at TEXT,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_so_po_line_map_org
      ON audit_so_po_line_mappings(organization_id);

    CREATE INDEX IF NOT EXISTS idx_so_po_line_map_po_line
      ON audit_so_po_line_mappings(organization_id, purchaseorder_id, po_line_item_id);

    CREATE INDEX IF NOT EXISTS idx_so_po_line_map_so_line
      ON audit_so_po_line_mappings(organization_id, salesorder_id, so_line_item_id);

    CREATE INDEX IF NOT EXISTS idx_so_po_line_map_status
      ON audit_so_po_line_mappings(status);
  `);

  // Partial unique index: at most one non-revoked mapping per PO line
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_so_po_line_map_po_current
      ON audit_so_po_line_mappings(organization_id, purchaseorder_id, po_line_item_id)
      WHERE status IN ('ACTIVE', 'REVIEW_REQUIRED');
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_so_po_line_mapping_history (
      history_id TEXT PRIMARY KEY,
      mapping_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN (
        'MAPPING_CREATED', 'MAPPING_MARKED_REVIEW_REQUIRED',
        'MAPPING_RECONFIRMED', 'MAPPING_REVOKED', 'MAPPING_REPLACED'
      )),
      previous_status TEXT,
      new_status TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      note TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_so_po_line_map_hist_mapping
      ON audit_so_po_line_mapping_history(mapping_id);

    CREATE INDEX IF NOT EXISTS idx_so_po_line_map_hist_time
      ON audit_so_po_line_mapping_history(mapping_id, occurred_at);
  `);

  // Schema v11: Manual Invoice↔SO Line Mapping (R1A)
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_invoice_so_line_mappings (
      mapping_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      invoice_line_item_id TEXT NOT NULL,
      salesorder_id TEXT NOT NULL,
      so_line_item_id TEXT NOT NULL,
      mapping_kind TEXT NOT NULL CHECK(mapping_kind IN ('OWNER_FALLBACK', 'OWNER_OVERRIDE')),
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'REVIEW_REQUIRED', 'REVOKED')),
      invoice_fingerprint TEXT NOT NULL,
      so_fingerprint TEXT NOT NULL,
      decision_source TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      review_required_at TEXT,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_inv_so_line_map_org
      ON audit_invoice_so_line_mappings(organization_id);

    CREATE INDEX IF NOT EXISTS idx_inv_so_line_map_inv_line
      ON audit_invoice_so_line_mappings(organization_id, invoice_id, invoice_line_item_id);

    CREATE INDEX IF NOT EXISTS idx_inv_so_line_map_so_line
      ON audit_invoice_so_line_mappings(organization_id, salesorder_id, so_line_item_id);

    CREATE INDEX IF NOT EXISTS idx_inv_so_line_map_status
      ON audit_invoice_so_line_mappings(status);
  `);

  // Partial unique index: at most one non-revoked mapping per Invoice line
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_so_line_map_inv_current
      ON audit_invoice_so_line_mappings(organization_id, invoice_id, invoice_line_item_id)
      WHERE status IN ('ACTIVE', 'REVIEW_REQUIRED');
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_invoice_so_line_mapping_history (
      history_id TEXT PRIMARY KEY,
      mapping_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN (
        'MAPPING_CREATED', 'MAPPING_MARKED_REVIEW_REQUIRED',
        'MAPPING_RECONFIRMED', 'MAPPING_REVOKED'
      )),
      previous_status TEXT,
      new_status TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      note TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_inv_so_line_map_hist_mapping
      ON audit_invoice_so_line_mapping_history(mapping_id);

    CREATE INDEX IF NOT EXISTS idx_inv_so_line_map_hist_time
      ON audit_invoice_so_line_mapping_history(mapping_id, occurred_at);
  `);

  // Schema v12: Pre-Audit Module-Level OWNER Sign-Off / Decision
  // This table records module-level OWNER decisions on completed Pre-Audit
  // runs. Each decision is bound to ONE immutable run_id. A new run does NOT
  // inherit a prior run's decision — it starts unsigned. System checkpoint
  // results (PASS/FAIL/BLOCKED/PARTIAL/NOT_IMPLEMENTED) are NEVER mutated
  // by an OWNER decision recorded here.
  db.exec(`
    CREATE TABLE IF NOT EXISTS pre_audit_run_decisions (
      decision_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES pre_audit_runs(run_id) ON DELETE CASCADE,
      organization_id TEXT,
      decision TEXT NOT NULL CHECK(decision IN ('PENDING','ACCEPTED','ACCEPTED_WITH_LIMITATIONS','REJECTED','REVIEW_REQUIRED')),
      decision_note TEXT,
      limitations_json TEXT NOT NULL DEFAULT '[]',
      checkpoint_summary_json TEXT NOT NULL DEFAULT '{}',
      decided_by TEXT NOT NULL DEFAULT 'OWNER',
      decided_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pre_audit_run_decisions_run ON pre_audit_run_decisions(run_id);
    CREATE INDEX IF NOT EXISTS idx_pre_audit_run_decisions_decision ON pre_audit_run_decisions(decision);
  `);

  const current = db.prepare("SELECT value FROM audit_schema_meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  if (!current) {
    db.prepare("INSERT INTO audit_schema_meta (key, value) VALUES ('schema_version', ?)").run(
      String(AUDIT_SCHEMA_VERSION)
    );
  } else if (parseInt(current.value, 10) < AUDIT_SCHEMA_VERSION) {
    db.prepare("UPDATE audit_schema_meta SET value = ? WHERE key = 'schema_version'").run(
      String(AUDIT_SCHEMA_VERSION)
    );
  }
}

/**
 * AP-UOM-BRIDGE-I1: idempotently adds the nullable `unit` column to the
 * active Approval Pending SO/PO line tables. Non-destructive: no default
 * value, no data rewrite. Missing tables are skipped. Safe to call on
 * every open / before every sync write.
 */
export function ensureSoPoLineUnitColumns(db: any): void {
  for (const table of ["audit_zoho_sales_order_lines", "audit_zoho_purchase_order_lines"]) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (cols.length === 0) continue; // table not present in this database
    if (cols.some((c) => c.name === "unit")) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN unit TEXT;`);
  }
}

/**
 * R1A-UOM: idempotently adds the nullable `unit` column to the
 * audit_zoho_invoice_lines table. Non-destructive: no default
 * value, no data rewrite, no historical row backfill.
 * Missing table is skipped. Safe to call on every open.
 */
export function ensureInvoiceLineUnitColumn(db: any): void {
  const cols = db.prepare(`PRAGMA table_info(audit_zoho_invoice_lines)`).all() as Array<{ name: string }>;
  if (cols.length === 0) return; // table not present
  if (cols.some((c: { name: string }) => c.name === "unit")) return;
  db.exec(`ALTER TABLE audit_zoho_invoice_lines ADD COLUMN unit TEXT;`);
}

export function getAuditSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM audit_schema_meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  return row ? parseInt(row.value, 10) : 0;
}

/**
 * Gets the current active (non-superseded) mapping decision for a bank account
 * from the most recent SUCCESS bank snapshot run.
 * Safe against historical snapshot mapping collisions.
 */
export function getCurrentMapping(db: DatabaseSync, organization_id: string, bank_account_id: string): any {
  const bankRun = db.prepare(
    `SELECT source_run_id FROM audit_zoho_source_runs
     WHERE source_type = 'bank_accounts'
       AND organization_id = ?
       AND status = 'SUCCESS'
     ORDER BY started_at DESC LIMIT 1`
  ).get(organization_id) as any;

  if (!bankRun) return null;

  return db.prepare(
    `SELECT * FROM audit_bank_coa_mappings
     WHERE organization_id = ?
       AND bank_account_id = ?
       AND bank_source_run_id = ?
       AND superseded_by_mapping_id IS NULL
     ORDER BY created_at DESC LIMIT 1`
  ).get(organization_id, bank_account_id, bankRun.source_run_id) as any;
}
export function updateCheckpointHumanReviewStatus(
  runId: string,
  checkpointKey: string,
  status: string,
  note: string
) {
  const db = getAuditDatabase();
  db.prepare(`
    UPDATE pre_audit_checkpoint_results
    SET human_review_status = ?, human_review_note = ?, human_review_timestamp = ?
    WHERE run_id = ? AND checkpoint_key = ?
  `).run(status, note, new Date().toISOString(), runId, checkpointKey);
}

// ============================================================
// Test Isolation Helper
// ============================================================

/**
 * Creates an isolated in-memory audit database with the full audit schema.
 *
 * SAFETY: This database is NEVER the operational audit_workspace.db — it is
 * ephemeral, lives only in process memory, and is discarded when the
 * process exits or the reference is released. Test scripts must use this
 * function instead of getAuditDatabase().
 *
 * Path ':memory:' is passed as a plain string; openAuditDatabaseAt handles
 * the dirname check (dirname(':memory:') === '.', which always exists).
 */
export function createTestAuditDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  initAuditDatabase(db);
  // Also create the traceability tables that live in audit_workspace.db at runtime
  // but are not part of the AI-workspace schema created by initAuditDatabase().
  // These are needed by universal-search-service.ts (audit_item_master, audit_sales_orders).
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_item_master (
      item_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT,
      sku TEXT,
      unit TEXT,
      status TEXT,
      rate TEXT,
      item_type TEXT,
      product_type TEXT,
      last_modified_time TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_sales_orders (
      salesorder_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      salesorder_number TEXT,
      customer_id TEXT,
      customer_name TEXT,
      date TEXT,
      status TEXT,
      reference_number TEXT,
      total TEXT,
      last_modified_time TEXT,
      synced_at TEXT NOT NULL
    );
  `);
  return db;
}

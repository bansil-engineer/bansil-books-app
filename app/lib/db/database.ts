// ============================================================
// Bansil Books Analytics — Local SQLite Database Architecture
// Node 22+ Built-in node:sqlite · Operational Analytics Cache
// ============================================================

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { getBansilBooksDbPath } from "./db-resolver";

let dbInstance: DatabaseSync | null = null;

const DB_FILE = getBansilBooksDbPath();

/**
 * Returns the singleton SQLite database instance, initializing tables & indexes if necessary.
 */
export function getDatabase(): DatabaseSync {
  if (dbInstance) return dbInstance;

  const dbDir = path.dirname(DB_FILE);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new DatabaseSync(DB_FILE);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  initDatabase(db);
  dbInstance = db;
  return dbInstance;
}

/**
 * Creates schema and indexes required by Section 2 and Section 14.
 */
export function initDatabase(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      organization_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      currency_symbol TEXT DEFAULT '₹',
      created_time TEXT
    );

    CREATE TABLE IF NOT EXISTS sales_invoices (
      invoice_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      date TEXT NOT NULL,
      due_date TEXT,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      reference_number TEXT,
      status TEXT NOT NULL,
      total REAL NOT NULL,
      balance REAL NOT NULL,
      invoice_url TEXT,
      is_verified_link INTEGER DEFAULT 0,
      created_time TEXT,
      last_modified_time TEXT,
      source TEXT DEFAULT 'ZOHO_BOOKS',
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales_invoice_line_items (
      line_item_id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      sku TEXT,
      quantity REAL NOT NULL,
      rate REAL NOT NULL,
      line_total REAL NOT NULL,
      bbt_customer_id TEXT,
      bbt_customer_name TEXT,
      description TEXT,
      source TEXT DEFAULT 'ZOHO_BOOKS',
      synced_at TEXT NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES sales_invoices(invoice_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS purchase_bills (
      bill_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      bill_number TEXT NOT NULL,
      date TEXT NOT NULL,
      due_date TEXT,
      vendor_id TEXT NOT NULL,
      vendor_name TEXT NOT NULL,
      reference_number TEXT,
      status TEXT NOT NULL,
      total REAL NOT NULL,
      balance REAL NOT NULL,
      bill_url TEXT,
      is_verified_link INTEGER DEFAULT 0,
      created_time TEXT,
      last_modified_time TEXT,
      source TEXT DEFAULT 'ZOHO_BOOKS',
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_bill_line_items (
      line_item_id TEXT PRIMARY KEY,
      bill_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      sku TEXT,
      quantity REAL NOT NULL,
      rate REAL NOT NULL,
      line_total REAL NOT NULL,
      bbt_customer_id TEXT,
      bbt_customer_name TEXT,
      description TEXT,
      customer_data_status TEXT NOT NULL DEFAULT 'VERIFIED',
      source TEXT DEFAULT 'ZOHO_BOOKS',
      synced_at TEXT NOT NULL,
      FOREIGN KEY (bill_id) REFERENCES purchase_bills(bill_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      sync_id TEXT PRIMARY KEY,
      start_time TEXT NOT NULL,
      end_time TEXT,
      sync_type TEXT NOT NULL,
      invoices_checked INTEGER DEFAULT 0,
      invoices_added INTEGER DEFAULT 0,
      invoices_updated INTEGER DEFAULT 0,
      invoice_lines_synced INTEGER DEFAULT 0,
      bills_checked INTEGER DEFAULT 0,
      bills_added INTEGER DEFAULT 0,
      bills_updated INTEGER DEFAULT 0,
      bill_lines_synced INTEGER DEFAULT 0,
      unchanged_records INTEGER DEFAULT 0,
      exceptions_count INTEGER DEFAULT 0,
      api_calls INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      errors TEXT
    );

    CREATE TABLE IF NOT EXISTS api_call_counter (
      date TEXT PRIMARY KEY,
      call_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_coverage (
      financial_year TEXT PRIMARY KEY,
      from_date TEXT NOT NULL,
      to_date TEXT NOT NULL,
      full_backfill_completed INTEGER NOT NULL DEFAULT 0,
      invoice_list_pages INTEGER DEFAULT 0,
      invoices_found INTEGER DEFAULT 0,
      invoices_synced INTEGER DEFAULT 0,
      bill_list_pages INTEGER DEFAULT 0,
      bills_found INTEGER DEFAULT 0,
      bills_synced INTEGER DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      error TEXT
    );

    -- Section 16 & 18: Zoho Activity Log Local Cache
    CREATE TABLE IF NOT EXISTS zoho_activity_log (
      activity_id TEXT PRIMARY KEY,
      activity_datetime TEXT NOT NULL,
      activity_date TEXT NOT NULL,
      module TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      document_number TEXT,
      user_id TEXT,
      user_name TEXT,
      description TEXT,
      source_ip TEXT,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_date ON zoho_activity_log(activity_date);
    CREATE INDEX IF NOT EXISTS idx_activity_module ON zoho_activity_log(module);
    CREATE INDEX IF NOT EXISTS idx_activity_user ON zoho_activity_log(user_id);

    -- Section 4: Zoho Activity Logs Local Cache (Official API fields only)
    CREATE TABLE IF NOT EXISTS zoho_activity_logs (
      activity_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      time TEXT,
      user_name TEXT,
      user_id TEXT,
      module TEXT NOT NULL,
      module_source TEXT DEFAULT 'STRUCTURED',
      action TEXT NOT NULL,
      description TEXT,
      entity_id TEXT,
      entity_number TEXT,
      reference_type TEXT,
      reference_id TEXT,
      reference_number TEXT,
      linked_bill_id TEXT,
      linked_invoice_id TEXT,
      ip_address TEXT,
      source TEXT,
      created_time TEXT,
      activity_type TEXT,
      raw_payload_json TEXT,
      detail_party_name TEXT,
      detail_party_id TEXT,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_logs_date ON zoho_activity_logs(date);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_module ON zoho_activity_logs(module);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON zoho_activity_logs(user_name);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON zoho_activity_logs(entity_id);
    -- NOTE: indexes on reference_number/linked_bill_id/linked_invoice_id are created further
    -- below, AFTER the ALTER TABLE migrations that add those columns to pre-existing databases.
    -- Do not add them here: on a DB created before this schema extension, zoho_activity_logs
    -- won't yet have these columns, and creating an index on a missing column throws
    -- "no such column: reference_number", aborting this entire exec() before the migrations
    -- below ever run.


    -- Section 14 Performance Indexes
    CREATE INDEX IF NOT EXISTS idx_invoices_date ON sales_invoices (date);
    CREATE INDEX IF NOT EXISTS idx_invoices_customer ON sales_invoices (customer_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_status ON sales_invoices (status);
    CREATE INDEX IF NOT EXISTS idx_invoices_modified ON sales_invoices (last_modified_time);

    CREATE INDEX IF NOT EXISTS idx_inv_lines_item ON sales_invoice_line_items (item_id);
    CREATE INDEX IF NOT EXISTS idx_inv_lines_cust_item ON sales_invoice_line_items (bbt_customer_name, item_name);

    CREATE INDEX IF NOT EXISTS idx_bills_date ON purchase_bills (date);
    CREATE INDEX IF NOT EXISTS idx_bills_vendor ON purchase_bills (vendor_id);
    CREATE INDEX IF NOT EXISTS idx_bills_status ON purchase_bills (status);
    CREATE INDEX IF NOT EXISTS idx_bills_modified ON purchase_bills (last_modified_time);

    CREATE INDEX IF NOT EXISTS idx_bill_lines_item ON purchase_bill_line_items (item_id);
    CREATE INDEX IF NOT EXISTS idx_bill_lines_cust_item ON purchase_bill_line_items (bbt_customer_name, item_name);

    -- Reconciliation Exclusion Rules (Section: Exclusion System)
    CREATE TABLE IF NOT EXISTS reconciliation_exclusions (
      exclusion_id TEXT PRIMARY KEY,
      customer_id TEXT,
      customer_name TEXT,
      item_id TEXT,
      item_name TEXT,
      sku TEXT,
      financial_year TEXT,
      reason TEXT NOT NULL DEFAULT 'OTHER',
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL,
      deactivated_at TEXT,
      approved_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_excl_customer ON reconciliation_exclusions (customer_id);
    CREATE INDEX IF NOT EXISTS idx_excl_item ON reconciliation_exclusions (item_id);
    -- Section: Analytics Classification (Material vs Service)
    CREATE TABLE IF NOT EXISTS analytics_classifications (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL, -- 'ITEM' | 'ACCOUNT'
      item_id TEXT,
      item_name TEXT,
      account_id TEXT,
      account_name TEXT,
      classification TEXT NOT NULL DEFAULT 'MATERIAL', -- 'MATERIAL' | 'SERVICE'
      is_active INTEGER NOT NULL DEFAULT 1,
      approved_by TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_class_item_id ON analytics_classifications(item_id);
    CREATE INDEX IF NOT EXISTS idx_class_item_name ON analytics_classifications(item_name);
    CREATE INDEX IF NOT EXISTS idx_class_account_id ON analytics_classifications(account_id);
    CREATE INDEX IF NOT EXISTS idx_class_active ON analytics_classifications(is_active);

    -- Seed known default service classifications if empty
    INSERT OR IGNORE INTO analytics_classifications (
      id, source_type, item_id, item_name, classification, is_active, approved_by, approved_at, created_at, updated_at
    ) VALUES (
      'class-svc-elec-install',
      'ITEM',
      '3166667000000107051',
      'ELECTRICAL, INSTALLATION, ERECTION & TESTING',
      'SERVICE',
      1,
      'System Admin',
      '2026-09-11T00:00:00.000Z',
      '2026-09-11T00:00:00.000Z',
      '2026-09-11T00:00:00.000Z'
    );
    -- Section 26: Module & Function Feature Settings
    CREATE TABLE IF NOT EXISTS app_feature_settings (
      feature_key TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT 'OWNER'
    );
    CREATE INDEX IF NOT EXISTS idx_feature_settings_key ON app_feature_settings(feature_key);

    -- Section: Customer Action Tracker & History
    CREATE TABLE IF NOT EXISTS customer_action_tracker (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL UNIQUE,
      customer_name TEXT,
      action_status TEXT NOT NULL DEFAULT 'Open',
      action_taken TEXT,
      action_owner TEXT,
      priority TEXT NOT NULL DEFAULT 'MEDIUM',
      next_follow_up_date TEXT,
      remarks TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_action_tracker_cust ON customer_action_tracker(customer_id);
    CREATE INDEX IF NOT EXISTS idx_action_tracker_status ON customer_action_tracker(action_status);

    CREATE TABLE IF NOT EXISTS customer_action_history (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      customer_name TEXT,
      item_id TEXT,
      item_name TEXT,
      action_status TEXT NOT NULL,
      action_taken TEXT,
      action_owner TEXT,
      priority TEXT NOT NULL DEFAULT 'MEDIUM',
      next_follow_up_date TEXT,
      remarks TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_action_hist_cust ON customer_action_history(customer_id);

    -- Section: Purchase Line Action Tracker (Customer Details Missing)
    CREATE TABLE IF NOT EXISTS purchase_line_action_tracker (
      id TEXT PRIMARY KEY,
      line_item_id TEXT NOT NULL UNIQUE,
      bill_id TEXT NOT NULL,
      action_status TEXT NOT NULL DEFAULT 'Open',
      action_owner TEXT,
      next_follow_up_date TEXT,
      remarks TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pline_action_line ON purchase_line_action_tracker(line_item_id);
    CREATE INDEX IF NOT EXISTS idx_pline_action_bill ON purchase_line_action_tracker(bill_id);
    CREATE INDEX IF NOT EXISTS idx_pline_action_status ON purchase_line_action_tracker(action_status);

    -- Section: Customer Material Control Site Actions
    CREATE TABLE IF NOT EXISTS customer_material_site_actions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      site_remark TEXT,
      action_required TEXT,
      responsible_person TEXT,
      target_date TEXT,
      action_status TEXT NOT NULL DEFAULT 'OPEN',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_site_actions_cust_item ON customer_material_site_actions(customer_id, item_id);

    -- Section: Local Manual Composite Assembly Ledger
    CREATE TABLE IF NOT EXISTS composite_assemblies (
      assembly_id TEXT PRIMARY KEY,
      assembly_number TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      composite_item_id TEXT NOT NULL,
      composite_item_name TEXT NOT NULL,
      composite_sku TEXT,
      generated_qty REAL NOT NULL,
      unit TEXT DEFAULT 'BUN',
      total_material_cost REAL DEFAULT 0,
      cost_per_unit REAL DEFAULT 0,
      assembly_date TEXT NOT NULL,
      reference_no TEXT,
      remarks TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'CONFIRMED', 'CANCELLED'
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT DEFAULT 'Local User'
    );
    CREATE INDEX IF NOT EXISTS idx_asm_customer ON composite_assemblies(customer_id);
    CREATE INDEX IF NOT EXISTS idx_asm_status ON composite_assemblies(status);
    CREATE INDEX IF NOT EXISTS idx_asm_date ON composite_assemblies(assembly_date);
    CREATE INDEX IF NOT EXISTS idx_asm_comp_item ON composite_assemblies(composite_item_id);

    CREATE TABLE IF NOT EXISTS composite_assembly_components (
      assembly_component_id TEXT PRIMARY KEY,
      assembly_id TEXT NOT NULL REFERENCES composite_assemblies(assembly_id),
      source_bill_id TEXT NOT NULL,
      source_bill_number TEXT,
      source_bill_date TEXT,
      source_bill_line_item_id TEXT NOT NULL,
      component_item_id TEXT NOT NULL,
      component_item_name TEXT NOT NULL,
      component_sku TEXT,
      vendor_name TEXT,
      raw_purchase_qty REAL NOT NULL,
      consumed_qty REAL NOT NULL,
      purchase_rate REAL NOT NULL,
      purchase_amount REAL NOT NULL,
      customer_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_asm_comp_asm_id ON composite_assembly_components(assembly_id);
    CREATE INDEX IF NOT EXISTS idx_asm_comp_line_id ON composite_assembly_components(source_bill_line_item_id);
    CREATE INDEX IF NOT EXISTS idx_asm_comp_item_id ON composite_assembly_components(component_item_id);
    CREATE INDEX IF NOT EXISTS idx_asm_comp_cust ON composite_assembly_components(customer_id);

    CREATE TABLE IF NOT EXISTS composite_assembly_audit (
      audit_id TEXT PRIMARY KEY,
      assembly_id TEXT NOT NULL,
      action TEXT NOT NULL, -- 'CREATE_DRAFT', 'CONFIRM', 'EDIT_DRAFT', 'CANCEL', 'REVERSE'
      actor TEXT DEFAULT 'Local User',
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_asm_audit_asm_id ON composite_assembly_audit(assembly_id);

    -- Smart Selective / Incremental Sync State & Locks
    CREATE TABLE IF NOT EXISTS sync_state (
      module TEXT NOT NULL,                  -- 'sales_invoices', 'purchase_bills', 'customers', 'all'
      scope_key TEXT NOT NULL,               -- 'all', 'FY_2025-26', 'FY_2026-27', 'customer:<ID>', etc.
      last_successful_sync_at TEXT,
      last_remote_modified_time TEXT,
      last_document_date TEXT,
      last_page INTEGER DEFAULT 1,
      status TEXT DEFAULT 'IDLE',           -- 'IDLE', 'RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL'
      records_checked INTEGER DEFAULT 0,
      records_changed INTEGER DEFAULT 0,
      records_skipped INTEGER DEFAULT 0,
      api_calls_used INTEGER DEFAULT 0,
      last_attempt_at TEXT,
      last_error TEXT,
      PRIMARY KEY (module, scope_key)
    );
    CREATE INDEX IF NOT EXISTS idx_sync_state_mod ON sync_state(module);

    CREATE TABLE IF NOT EXISTS sync_locks (
      lock_key TEXT PRIMARY KEY,
      locked_at TEXT NOT NULL,
      locked_by TEXT,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_sync_fingerprints (
      document_type TEXT NOT NULL,           -- 'INVOICE' | 'BILL'
      document_id TEXT NOT NULL,
      last_modified_time TEXT,
      content_fingerprint TEXT NOT NULL,
      last_synced_at TEXT NOT NULL,
      PRIMARY KEY (document_type, document_id)
    );
    CREATE INDEX IF NOT EXISTS idx_doc_fingerprint_mod ON document_sync_fingerprints(last_modified_time);

    -- Activity-Driven Sync Checkpoints & API Usage Tracking
    CREATE TABLE IF NOT EXISTS activity_sync_checkpoints (
      checkpoint_key TEXT PRIMARY KEY,
      last_activity_sync_at TEXT,
      last_activity_event_id TEXT,
      last_activity_event_time TEXT,
      last_successful_sync_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS zoho_api_usage_cache (
      id TEXT PRIMARY KEY,
      daily_limit INTEGER NOT NULL,
      used_today INTEGER NOT NULL,
      remaining INTEGER NOT NULL,
      usage_percentage REAL NOT NULL,
      reset_time TEXT,
      updated_at TEXT NOT NULL
    );

    -- Zoho Activity durable month-wise backfill: resumable job + per-window progress.
    -- Dedicated tables (not the shared sync_state/sync_locks used by bills/invoices)
    -- so this backfill cannot interfere with other modules' sync bookkeeping.
    CREATE TABLE IF NOT EXISTS activity_backfill_jobs (
      job_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      financial_year TEXT NOT NULL,
      requested_from_date TEXT NOT NULL,
      requested_to_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_activity_backfill_jobs_org ON activity_backfill_jobs(organization_id);
    CREATE INDEX IF NOT EXISTS idx_activity_backfill_jobs_status ON activity_backfill_jobs(status);

    CREATE TABLE IF NOT EXISTS activity_backfill_windows (
      job_id TEXT NOT NULL,
      window_from TEXT NOT NULL,
      window_to TEXT NOT NULL,
      window_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      next_page INTEGER NOT NULL DEFAULT 1,
      page_size INTEGER NOT NULL DEFAULT 200,
      last_page_fingerprint TEXT,
      records_seen INTEGER NOT NULL DEFAULT 0,
      records_new INTEGER NOT NULL DEFAULT 0,
      records_updated INTEGER NOT NULL DEFAULT 0,
      out_of_window_count INTEGER NOT NULL DEFAULT 0,
      api_calls_used INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      completed_at TEXT,
      last_error TEXT,
      PRIMARY KEY (job_id, window_from, window_to)
    );
    CREATE INDEX IF NOT EXISTS idx_activity_backfill_windows_job ON activity_backfill_windows(job_id);

    -- Seed default feature settings if empty
    INSERT OR IGNORE INTO app_feature_settings (feature_key, enabled, updated_at, updated_by) VALUES
      ('module_dashboard', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('module_reconciliation', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('module_transactions', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('module_services', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('module_customers', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('module_reports', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('module_zoho_activity', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('module_data_quality', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('module_validation_report', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('module_exclusion_management', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('module_export', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('module_ai_insights', 0, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_recon_master', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_recon_balance', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_recon_yet_to_purchase', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_recon_yet_to_sale', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_recon_purchase_only', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_recon_sale_only', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_recon_reconciled', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_recon_customer_missing', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_recon_excluded_items', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_recon_composite_assembly', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_trans_purchase_bills', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_trans_sales_invoices', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_trans_transaction_detail', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_trans_zoho_activity', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_svc_summary', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_svc_purchases', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_svc_sales', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_svc_transactions', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_svc_reconciliation', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_cust_customer_details', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_cust_action_taken', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_rep_recon_summary', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_rep_customer_wise', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_rep_breakdown', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_rep_price_reference', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_rep_data_quality', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_rep_validation', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sub_rep_customer_material', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sync_smart_enabled', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sync_stale_warning_hours', 24, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sync_auto_on_page_open', 0, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      ('sync_historical_rescan', 0, '2026-09-11T00:00:00.000Z', 'SYSTEM'),
      -- Milestone A: Reconciliation & Audit workspace shell + Settings > Skills.
      -- New additive keys only — no existing key above is touched.
      ('module_audit_workspace', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('sub_audit_workspaces', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('sub_audit_uploads', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('sub_audit_match_review', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('sub_audit_findings', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('sub_audit_reports', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('sub_settings_skills', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      -- Milestone C feature-control gap fix: Settings > Feature Controls >
      -- Reconciliation & Audit Modules. New additive keys only — no
      -- existing key above is touched or renamed. See
      -- app/lib/audit/feature-registry.ts for the full registry
      -- (parent/child relationships, labels, implementation status).
      ('audit_feat_pdf_intake', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_xlsx_intake', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_csv_intake', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_zoho_sources', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_source_mapping', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_completeness_controls', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_evidence_drillback', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_frozen_snapshots', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_exact_matching', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_date_reference_checks', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_amount_currency_checks', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_quantity_unit_checks', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_grouped_one_to_many', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_grouped_many_to_one', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_partial_matching', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_ambiguous_review', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_unmatched_left_right', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_multi_source_verification', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_reviewer_decisions', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      -- Project-wide Feature Controls pass: closes gaps found while
      -- inventorying existing navigation (module_inventory/sub_inv_stock
      -- were referenced by Sidebar.tsx's featureKey but never had a seed
      -- row at all; sub_cust_action_taken and sub_rep_customer_material
      -- were live nav items with no corresponding Settings toggle) plus
      -- two new explicit action-level controls the owner requested
      -- (Zoho manual sync, Zoho activity backfill). All additive, all
      -- default ON (preserves existing behavior).
      ('module_inventory', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('sub_inv_stock', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('sub_cust_action_taken', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('sub_rep_customer_material', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('action_zoho_manual_sync', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('action_zoho_activity_backfill', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('settings_sync_page', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('settings_modules_page', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('settings_security_page', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      -- Milestone D: Domain Review + Findings + Action Taken + Reviewer
      -- Sign-off + Review Reports + Excel/PDF Export. sub_audit_findings
      -- and sub_audit_reports already had seed rows above (added ahead of
      -- this milestone as NOT_IMPLEMENTED placeholders); only their
      -- implementation_status flips in feature-registry.ts, no new seed
      -- row needed for those two. New additive child keys only.
      ('audit_feat_domain_review', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_coverage_matrix', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_findings_register', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_action_taken', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_reviewer_signoff', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_findings_evidence_drillback', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_report_field_selector', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_excel_export', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_pdf_export', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      -- Milestone E: Controlled Learning — governed, versioned rule
      -- proposals, SUGGEST_ONLY by default, never auto-activated.
      ('sub_audit_learning', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_learning_proposals', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_learning_unsupported_case_review', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_learning_one_time_overrides', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_learning_rule_testing', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_learning_rule_approval', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_learning_rule_disable', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_learning_rule_rollback', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_learning_rule_conflict_review', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_learning_rule_expiry_review', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),
      ('audit_feat_release_readiness', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM');
  `);

  // Migration: Add columns if existing DB was created with older schema
  try { db.exec("ALTER TABLE sales_invoices ADD COLUMN source TEXT DEFAULT 'ZOHO_BOOKS';"); } catch {}
  try { db.exec("ALTER TABLE sales_invoices ADD COLUMN content_fingerprint TEXT;"); } catch {}
  try { db.exec("ALTER TABLE sales_invoice_line_items ADD COLUMN source TEXT DEFAULT 'ZOHO_BOOKS';"); } catch {}
  try { db.exec("ALTER TABLE sales_invoice_line_items ADD COLUMN description TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_bills ADD COLUMN source TEXT DEFAULT 'ZOHO_BOOKS';"); } catch {}
  try { db.exec("ALTER TABLE purchase_bills ADD COLUMN content_fingerprint TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_bill_line_items ADD COLUMN source TEXT DEFAULT 'ZOHO_BOOKS';"); } catch {}
  try { db.exec("ALTER TABLE purchase_bill_line_items ADD COLUMN purchase_line_customer_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_bill_line_items ADD COLUMN purchase_line_customer_name TEXT;"); } catch {}

  // Zoho Activity Logs Schema Extension Migrations
  try { db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN module_source TEXT DEFAULT 'STRUCTURED';"); } catch {}
  try { db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN reference_type TEXT;"); } catch {}
  try { db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN reference_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN reference_number TEXT;"); } catch {}
  try { db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN linked_bill_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN linked_invoice_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN raw_payload_json TEXT;"); } catch {}
  try { db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN detail_party_name TEXT;"); } catch {}
  try { db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN detail_party_id TEXT;"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_activity_logs_ref_num ON zoho_activity_logs(reference_number);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_activity_logs_linked_bill ON zoho_activity_logs(linked_bill_id);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_activity_logs_linked_inv ON zoho_activity_logs(linked_invoice_id);"); } catch {}

  seedInitialDataIfEmpty(db);
}

/**
 * Seeds initial verified baseline data into SQLite if the database is empty.
 * This guarantees offline operability and validation case consistency on first launch.
 */
export function seedInitialDataIfEmpty(db: DatabaseSync): void {
  const row = db.prepare("SELECT COUNT(*) as cnt FROM sales_invoices").get() as { cnt: number } | undefined;
  if (row && row.cnt > 0) return;

  const now = new Date().toISOString();
  const ZOHO_BASE_URL = "https://books.bansilengineers.com/app/774390949";
  const orgId = "774390949";

  // Organization
  db.prepare(`
    INSERT OR REPLACE INTO organizations (organization_id, name, currency_symbol, created_time)
    VALUES (?, ?, ?, ?)
  `).run(orgId, "BANSIL ENGINEERS", "₹", now);

  // Real Verified Invoice INV-2526163
  db.prepare(`
    INSERT OR REPLACE INTO sales_invoices 
    (invoice_id, organization_id, invoice_number, date, due_date, customer_id, customer_name, reference_number, status, total, balance, invoice_url, is_verified_link, created_time, last_modified_time, source, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
  `).run(
    "3166667000010979580",
    orgId,
    "INV-2526163",
    "2025-09-08",
    "2025-10-08",
    "3166667000009883071",
    "LANTEC INDUSTRIES PRIVATE LIMITED",
    "PO-LANTEC-2526",
    "PAID",
    2077460.8,
    0,
    `${ZOHO_BASE_URL}#/invoices/3166667000010979580`,
    1,
    "2025-09-08T10:00:00Z",
    "2025-09-08T10:00:00Z",
    now
  );

  // Real Invoice Lines (4 BBT lines)
  const invLines = [
    { id: "3166667000010979590", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 2, rate: 28500, total: 57000 },
    { id: "3166667000010979593", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 38, rate: 30870, total: 1173060 },
    { id: "3166667000010979596", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 14, rate: 33400, total: 467600 },
    { id: "3166667000010979599", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 1, rate: 62900, total: 62900 },
  ];

  for (const line of invLines) {
    db.prepare(`
      INSERT OR REPLACE INTO sales_invoice_line_items
      (line_item_id, invoice_id, item_id, item_name, sku, quantity, rate, line_total, bbt_customer_id, bbt_customer_name, source, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
    `).run(
      line.id,
      "3166667000010979580",
      line.itemId,
      line.name,
      "",
      line.qty,
      line.rate,
      line.total,
      "3166667000009883071",
      "LANTEC INDUSTRIES PRIVATE LIMITED",
      now
    );
  }

  // Real Verified Bill AA2450002266
  db.prepare(`
    INSERT OR REPLACE INTO purchase_bills
    (bill_id, organization_id, bill_number, date, due_date, vendor_id, vendor_name, reference_number, status, total, balance, bill_url, is_verified_link, created_time, last_modified_time, source, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
  `).run(
    "3166667000011037234",
    orgId,
    "AA2450002266",
    "2025-09-08",
    "2025-10-08",
    "vend_schneider_gj",
    "SCHNEIDER ELECTRIC INDIA PVT.LTD. - GJ",
    "PO-BBT-2266",
    "PAID",
    1643123.22,
    0,
    `${ZOHO_BASE_URL}#/bills/3166667000011037234`,
    1,
    "2025-09-08T09:00:00Z",
    "2025-09-08T09:00:00Z",
    now
  );

  // Real Bill Lines (4 BBT Tap Off Box lines + 1 End Cover line)
  const billLines = [
    { id: "3166667000011037240", itemId: "3166667000000170375", name: "BBT End cover for bus bar", qty: 2, rate: 2903, total: 5806, desc: "End Closure 2000A, AL, IP54, Class F" },
    { id: "3166667000011037242", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 14, rate: 31062, total: 434868, desc: "125-250A PIU (w/o 3-Pole breaker) with 250A MCCB- 3P" },
    { id: "3166667000011037244", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 38, rate: 28709, total: 1090942, desc: "125-250A PIU (w/o 3-Pole breaker) with 160A MCCB- 3P" },
    { id: "3166667000011037246", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 1, rate: 58497.22, total: 58497.22, desc: "400-500A PIU (w/o 3-Pole breaker) with 400A MCCB- 3P" },
    { id: "3166667000011037248", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 2, rate: 26505, total: 53010, desc: "16-100A PIU (w/o 3-Pole breaker) with 100A MCCB- 3P" },
  ];

  for (const line of billLines) {
    db.prepare(`
      INSERT OR REPLACE INTO purchase_bill_line_items
      (line_item_id, bill_id, item_id, item_name, sku, quantity, rate, line_total, bbt_customer_id, bbt_customer_name, description, customer_data_status, source, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', 'ZOHO_BOOKS', ?)
    `).run(
      line.id,
      "3166667000011037234",
      line.itemId,
      line.name,
      "",
      line.qty,
      line.rate,
      line.total,
      "3166667000009883071",
      "LANTEC INDUSTRIES PRIVATE LIMITED",
      line.desc,
      now
    );
  }

  // Set initial sync metadata
  setSyncMetadata(db, "last_successful_sync_time", "2026-09-10T18:30:00Z");
  setSyncMetadata(db, "last_attempted_sync_time", "2026-09-10T18:30:00Z");
  setSyncMetadata(db, "last_sync_status", "SUCCESS");
  setSyncMetadata(db, "api_calls_today", "0");
  setSyncMetadata(db, "last_sync_api_calls", "0");
}

export function getSyncMetadata(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM sync_metadata WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSyncMetadata(db: DatabaseSync, key: string, value: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
    VALUES (?, ?, ?)
  `).run(key, value, now);
}

/**
 * Returns the latest transaction/document date present in synchronized data (YYYY-MM-DD).
 */
export function getLatestSyncedDocumentDate(db: DatabaseSync): string {
  try {
    const row = db.prepare(`
      SELECT MAX(latest_date) as max_date FROM (
        SELECT MAX(date) as latest_date FROM sales_invoices WHERE status != 'VOID'
        UNION ALL
        SELECT MAX(date) as latest_date FROM purchase_bills WHERE status != 'VOID'
      )
    `).get() as { max_date: string | null } | undefined;
    return row?.max_date || new Date().toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function recordApiCall(db: DatabaseSync): void {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO api_call_counter (date, call_count)
    VALUES (?, 1)
    ON CONFLICT(date) DO UPDATE SET call_count = call_count + 1
  `).run(today);

  // Also update total in metadata
  const row = db.prepare("SELECT call_count FROM api_call_counter WHERE date = ?").get(today) as { call_count: number } | undefined;
  if (row) {
    setSyncMetadata(db, "api_calls_today", String(row.call_count));
  }
}

export function getApiCallStats(db: DatabaseSync): { today: number; lastSync: number } {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare("SELECT call_count FROM api_call_counter WHERE date = ?").get(today) as { call_count: number } | undefined;
  const lastSyncStr = getSyncMetadata(db, "last_sync_api_calls") || "0";
  return {
    today: row ? row.call_count : 0,
    lastSync: parseInt(lastSyncStr, 10) || 0,
  };
}

export function recordSyncLog(
  db: DatabaseSync,
  log: {
    syncId: string;
    startTime: string;
    endTime: string;
    syncType: string;
    invoicesChecked: number;
    invoicesAdded: number;
    invoicesUpdated: number;
    invoiceLinesSynced: number;
    billsChecked: number;
    billsAdded: number;
    billsUpdated: number;
    billLinesSynced: number;
    unchangedRecords: number;
    exceptionsCount: number;
    apiCalls: number;
    status: string;
    errors?: string;
  }
): void {
  db.prepare(`
    INSERT OR REPLACE INTO sync_logs
    (sync_id, start_time, end_time, sync_type, invoices_checked, invoices_added, invoices_updated, invoice_lines_synced, bills_checked, bills_added, bills_updated, bill_lines_synced, unchanged_records, exceptions_count, api_calls, status, errors)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    log.syncId,
    log.startTime,
    log.endTime,
    log.syncType,
    log.invoicesChecked,
    log.invoicesAdded,
    log.invoicesUpdated,
    log.invoiceLinesSynced,
    log.billsChecked,
    log.billsAdded,
    log.billsUpdated,
    log.billLinesSynced,
    log.unchangedRecords,
    log.exceptionsCount,
    log.apiCalls,
    log.status,
    log.errors || null
  );

  setSyncMetadata(db, "last_sync_api_calls", String(log.apiCalls));
}

export function getRecentSyncLogs(db: DatabaseSync, limit: number = 10): Record<string, unknown>[] {
  return db.prepare("SELECT * FROM sync_logs ORDER BY start_time DESC LIMIT ?").all(limit);
}

export interface SyncCoverageRecord {
  financialYear: string;
  fromDate: string;
  toDate: string;
  fullBackfillCompleted: boolean;
  invoiceListPages: number;
  invoicesFound: number;
  invoicesSynced: number;
  billListPages: number;
  billsFound: number;
  billsSynced: number;
  startedAt: string;
  completedAt?: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  error?: string;
}

export function getSyncCoverage(db: DatabaseSync, financialYear: string): SyncCoverageRecord | null {
  const row = db.prepare(`
    SELECT financial_year, from_date, to_date, full_backfill_completed,
           invoice_list_pages, invoices_found, invoices_synced,
           bill_list_pages, bills_found, bills_synced,
           started_at, completed_at, status, error
    FROM sync_coverage
    WHERE financial_year = ?
  `).get(financialYear) as {
    financial_year: string;
    from_date: string;
    to_date: string;
    full_backfill_completed: number;
    invoice_list_pages: number;
    invoices_found: number;
    invoices_synced: number;
    bill_list_pages: number;
    bills_found: number;
    bills_synced: number;
    started_at: string;
    completed_at?: string;
    status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
    error?: string;
  } | undefined;

  if (!row) return null;

  return {
    financialYear: row.financial_year,
    fromDate: row.from_date,
    toDate: row.to_date,
    fullBackfillCompleted: row.full_backfill_completed === 1,
    invoiceListPages: row.invoice_list_pages,
    invoicesFound: row.invoices_found,
    invoicesSynced: row.invoices_synced,
    billListPages: row.bill_list_pages,
    billsFound: row.bills_found,
    billsSynced: row.bills_synced,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    error: row.error,
  };
}

export function recordSyncCoverage(db: DatabaseSync, record: SyncCoverageRecord): void {
  db.prepare(`
    INSERT INTO sync_coverage
    (financial_year, from_date, to_date, full_backfill_completed,
     invoice_list_pages, invoices_found, invoices_synced,
     bill_list_pages, bills_found, bills_synced,
     started_at, completed_at, status, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(financial_year) DO UPDATE SET
      from_date = excluded.from_date,
      to_date = excluded.to_date,
      full_backfill_completed = excluded.full_backfill_completed,
      invoice_list_pages = excluded.invoice_list_pages,
      invoices_found = excluded.invoices_found,
      invoices_synced = excluded.invoices_synced,
      bill_list_pages = excluded.bill_list_pages,
      bills_found = excluded.bills_found,
      bills_synced = excluded.bills_synced,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      status = excluded.status,
      error = excluded.error
  `).run(
    record.financialYear,
    record.fromDate,
    record.toDate,
    record.fullBackfillCompleted ? 1 : 0,
    record.invoiceListPages,
    record.invoicesFound,
    record.invoicesSynced,
    record.billListPages,
    record.billsFound,
    record.billsSynced,
    record.startedAt,
    record.completedAt || null,
    record.status,
    record.error || null
  );

  if (record.fullBackfillCompleted) {
    setSyncMetadata(db, `coverage_${record.financialYear}_completed`, "true");
  }
}

export function isFullBackfillCompleted(db: DatabaseSync, financialYear: string): boolean {
  const normalizedFy = financialYear.startsWith("FY ") ? financialYear : `FY ${financialYear}`;
  const rawFy = financialYear.replace(/^FY\s*/, "");
  const meta1 = getSyncMetadata(db, `coverage_${normalizedFy}_completed`);
  const meta2 = getSyncMetadata(db, `coverage_${rawFy}_completed`);
  if (meta1 === "true" || meta2 === "true") return true;
  const cov1 = getSyncCoverage(db, normalizedFy);
  const cov2 = getSyncCoverage(db, rawFy);
  return Boolean(cov1?.fullBackfillCompleted || cov2?.fullBackfillCompleted);
}

export function getAllDistinctVendors(db: DatabaseSync): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT vendor_name
    FROM purchase_bills
    WHERE vendor_name IS NOT NULL AND TRIM(vendor_name) != ''
    ORDER BY vendor_name ASC
  `).all() as { vendor_name: string }[];
  return rows.map(r => r.vendor_name);
}

export interface AnalyticsClassificationRecord {
  id: string;
  source_type: "ITEM" | "ACCOUNT";
  item_id?: string | null;
  item_name?: string | null;
  account_id?: string | null;
  account_name?: string | null;
  classification: "MATERIAL" | "SERVICE";
  is_active: number;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export function getAllClassifications(db?: DatabaseSync): AnalyticsClassificationRecord[] {
  const conn = db || getDatabase();
  return conn.prepare(`
    SELECT * FROM analytics_classifications
    WHERE is_active = 1
    ORDER BY created_at DESC
  `).all() as unknown as AnalyticsClassificationRecord[];
}

export function getClassifiedServiceItemIds(db?: DatabaseSync): Set<string> {
  const conn = db || getDatabase();
  const rows = conn.prepare(`
    SELECT item_id, item_name FROM analytics_classifications
    WHERE classification = 'SERVICE' AND is_active = 1
  `).all() as { item_id: string | null; item_name: string | null }[];

  const set = new Set<string>();
  for (const r of rows) {
    if (r.item_id) set.add(r.item_id);
    if (r.item_name) set.add(r.item_name.toUpperCase().trim());
  }
  return set;
}

export function getItemClassification(
  dbOrItemId?: DatabaseSync | string | null,
  itemIdOrName?: string | null,
  itemName?: string | null
): "MATERIAL" | "SERVICE" {
  let conn: DatabaseSync;
  let itId: string | null | undefined;
  let itName: string | null | undefined;

  if (typeof dbOrItemId === "string" || dbOrItemId === null) {
    conn = getDatabase();
    itId = dbOrItemId;
    itName = itemIdOrName;
  } else if (dbOrItemId && typeof (dbOrItemId as any).prepare === "function") {
    conn = dbOrItemId as DatabaseSync;
    itId = itemIdOrName;
    itName = itemName;
  } else {
    conn = getDatabase();
    itId = itemIdOrName;
    itName = itemName;
  }

  if (itId) {
    const row = conn.prepare(`
      SELECT classification FROM analytics_classifications
      WHERE item_id = ? AND is_active = 1
    `).get(itId) as { classification: "MATERIAL" | "SERVICE" } | undefined;
    if (row) return row.classification;
  }
  if (itName) {
    const row = conn.prepare(`
      SELECT classification FROM analytics_classifications
      WHERE UPPER(TRIM(item_name)) = ? AND is_active = 1
    `).get(itName.toUpperCase().trim()) as { classification: "MATERIAL" | "SERVICE" } | undefined;
    if (row) return row.classification;
  }
  return "MATERIAL";
}

export function saveClassification(
  db: DatabaseSync | undefined,
  record: Omit<AnalyticsClassificationRecord, "created_at" | "updated_at">
): void {
  const conn = db || getDatabase();
  const now = new Date().toISOString();
  conn.prepare(`
    INSERT INTO analytics_classifications (
      id, source_type, item_id, item_name, account_id, account_name,
      classification, is_active, approved_by, approved_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_type = excluded.source_type,
      item_id = excluded.item_id,
      item_name = excluded.item_name,
      account_id = excluded.account_id,
      account_name = excluded.account_name,
      classification = excluded.classification,
      is_active = excluded.is_active,
      approved_by = excluded.approved_by,
      approved_at = excluded.approved_at,
      updated_at = excluded.updated_at
  `).run(
    record.id,
    record.source_type,
    record.item_id || null,
    record.item_name || null,
    record.account_id || null,
    record.account_name || null,
    record.classification,
    record.is_active ?? 1,
    record.approved_by || null,
    record.approved_at || null,
    now,
    now
  );
}

export function getFeatureSettings(db?: DatabaseSync): Record<string, boolean> {
  const conn = db || getDatabase();
  try {
    const rows = conn.prepare(`
      SELECT feature_key, enabled FROM app_feature_settings
    `).all() as { feature_key: string; enabled: number }[];

    const result: Record<string, boolean> = {};
    for (const r of rows) {
      result[r.feature_key] = Boolean(r.enabled);
    }
    return result;
  } catch {
    return {};
  }
}

export function updateFeatureSetting(
  db: DatabaseSync | undefined,
  key: string,
  enabled: boolean,
  updatedBy: string = "OWNER"
): void {
  const conn = db || getDatabase();
  const now = new Date().toISOString();
  conn.prepare(`
    INSERT INTO app_feature_settings (feature_key, enabled, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(feature_key) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(key, enabled ? 1 : 0, now, updatedBy);
}

export function updateFeatureSettings(
  db: DatabaseSync | undefined,
  settings: Record<string, boolean>,
  updatedBy: string = "OWNER"
): void {
  const conn = db || getDatabase();
  const now = new Date().toISOString();
  const stmt = conn.prepare(`
    INSERT INTO app_feature_settings (feature_key, enabled, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(feature_key) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `);

  for (const [key, enabled] of Object.entries(settings)) {
    stmt.run(key, enabled ? 1 : 0, now, updatedBy);
  }
}

export interface ActiveExclusion {
  exclusion_id: string;
  customer_id: string | null;
  customer_name: string | null;
  item_id: string | null;
  item_name: string | null;
  sku: string | null;
  financial_year: string | null;
  status: string;
}

export function getActiveExclusions(db?: DatabaseSync): ActiveExclusion[] {
  const conn = db || getDatabase();
  try {
    return conn.prepare(`
      SELECT exclusion_id, customer_id, customer_name, item_id, item_name, sku, financial_year, status
      FROM reconciliation_exclusions
      WHERE status = 'ACTIVE'
    `).all() as unknown as ActiveExclusion[];
  } catch {
    return [];
  }
}

export function getActiveExcludedItemIds(db?: DatabaseSync): Set<string> {
  const conn = db || getDatabase();
  try {
    const rows = conn.prepare(`
      SELECT item_id, item_name
      FROM reconciliation_exclusions
      WHERE status = 'ACTIVE' AND item_id IS NOT NULL AND TRIM(item_id) != ''
    `).all() as unknown as { item_id: string; item_name?: string }[];
    const set = new Set<string>();
    for (const r of rows) {
      if (r.item_id && r.item_id.trim()) set.add(r.item_id.trim());
    }
    return set;
  } catch {
    return new Set<string>();
  }
}

export function isItemExcluded(
  param1?: DatabaseSync | string | null,
  param2?: string | null,
  param3?: string | null,
  param4?: string | null
): boolean {
  let db: DatabaseSync | undefined;
  let itemId: string | null | undefined;
  let customerId: string | null | undefined;
  let financialYear: string | null | undefined;

  if (param1 && typeof (param1 as any).prepare === "function") {
    db = param1 as DatabaseSync;
    itemId = param2;
    customerId = param3;
    financialYear = param4;
  } else {
    itemId = param1 as string | null | undefined;
    customerId = param2;
    financialYear = param3;
  }

  if (!itemId && !customerId) return false;
  const exclusions = getActiveExclusions(db);
  return exclusions.some(ex => {
    const hasExclItem = Boolean(ex.item_id && ex.item_id.trim() !== '');
    const matchItem = hasExclItem ? Boolean(itemId && ex.item_id && ex.item_id.trim() === itemId.trim()) : false;
    const matchCust = !ex.customer_id || (customerId && ex.customer_id === customerId);
    const matchFy = !ex.financial_year || ex.financial_year === 'ALL' || (financialYear && ex.financial_year === financialYear);
    return Boolean(matchItem && matchCust && matchFy);
  });
}

// ============================================================
// Smart / Selective Sync State & Lock Helpers
// ============================================================

export interface SyncStateRecord {
  module: string;
  scope_key: string;
  last_successful_sync_at: string | null;
  last_remote_modified_time: string | null;
  last_document_date: string | null;
  last_page: number;
  status: "IDLE" | "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL";
  records_checked: number;
  records_changed: number;
  records_skipped: number;
  api_calls_used: number;
  last_attempt_at: string | null;
  last_error: string | null;
}

export function getSyncState(db: DatabaseSync, module: string, scopeKey: string = "all"): SyncStateRecord | null {
  try {
    const row = db.prepare(`
      SELECT module, scope_key, last_successful_sync_at, last_remote_modified_time,
             last_document_date, last_page, status, records_checked, records_changed,
             records_skipped, api_calls_used, last_attempt_at, last_error
      FROM sync_state
      WHERE module = ? AND scope_key = ?
    `).get(module, scopeKey) as unknown as SyncStateRecord | undefined;
    return row || null;
  } catch {
    return null;
  }
}

export function getAllSyncStates(db: DatabaseSync): SyncStateRecord[] {
  try {
    return db.prepare(`
      SELECT module, scope_key, last_successful_sync_at, last_remote_modified_time,
             last_document_date, last_page, status, records_checked, records_changed,
             records_skipped, api_calls_used, last_attempt_at, last_error
      FROM sync_state
      ORDER BY module ASC, scope_key ASC
    `).all() as unknown as SyncStateRecord[];
  } catch {
    return [];
  }
}

export function setSyncState(db: DatabaseSync, record: Partial<SyncStateRecord> & { module: string; scope_key: string }): void {
  const existing = getSyncState(db, record.module, record.scope_key);
  const updated: SyncStateRecord = {
    module: record.module,
    scope_key: record.scope_key,
    last_successful_sync_at: record.last_successful_sync_at !== undefined ? record.last_successful_sync_at : (existing?.last_successful_sync_at ?? null),
    last_remote_modified_time: record.last_remote_modified_time !== undefined ? record.last_remote_modified_time : (existing?.last_remote_modified_time ?? null),
    last_document_date: record.last_document_date !== undefined ? record.last_document_date : (existing?.last_document_date ?? null),
    last_page: record.last_page !== undefined ? record.last_page : (existing?.last_page ?? 1),
    status: record.status || existing?.status || "IDLE",
    records_checked: record.records_checked !== undefined ? record.records_checked : (existing?.records_checked ?? 0),
    records_changed: record.records_changed !== undefined ? record.records_changed : (existing?.records_changed ?? 0),
    records_skipped: record.records_skipped !== undefined ? record.records_skipped : (existing?.records_skipped ?? 0),
    api_calls_used: record.api_calls_used !== undefined ? record.api_calls_used : (existing?.api_calls_used ?? 0),
    last_attempt_at: record.last_attempt_at !== undefined ? record.last_attempt_at : (existing?.last_attempt_at ?? null),
    last_error: record.last_error !== undefined ? record.last_error : (existing?.last_error ?? null),
  };

  db.prepare(`
    INSERT INTO sync_state (
      module, scope_key, last_successful_sync_at, last_remote_modified_time,
      last_document_date, last_page, status, records_checked, records_changed,
      records_skipped, api_calls_used, last_attempt_at, last_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(module, scope_key) DO UPDATE SET
      last_successful_sync_at = excluded.last_successful_sync_at,
      last_remote_modified_time = excluded.last_remote_modified_time,
      last_document_date = excluded.last_document_date,
      last_page = excluded.last_page,
      status = excluded.status,
      records_checked = excluded.records_checked,
      records_changed = excluded.records_changed,
      records_skipped = excluded.records_skipped,
      api_calls_used = excluded.api_calls_used,
      last_attempt_at = excluded.last_attempt_at,
      last_error = excluded.last_error
  `).run(
    updated.module,
    updated.scope_key,
    updated.last_successful_sync_at,
    updated.last_remote_modified_time,
    updated.last_document_date,
    updated.last_page,
    updated.status,
    updated.records_checked,
    updated.records_changed,
    updated.records_skipped,
    updated.api_calls_used,
    updated.last_attempt_at,
    updated.last_error
  );
}

export function acquireSyncLock(db: DatabaseSync, lockKey: string, timeoutMs: number = 60000, lockedBy: string = "user"): boolean {
  try {
    const nowIso = new Date().toISOString();
    // Clean up expired locks first
    db.prepare("DELETE FROM sync_locks WHERE expires_at <= ?").run(nowIso);

    const expiresAt = new Date(Date.now() + timeoutMs).toISOString();
    const res = db.prepare(`
      INSERT INTO sync_locks (lock_key, locked_at, locked_by, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(lock_key) DO NOTHING
    `).run(lockKey, nowIso, lockedBy, expiresAt);

    return res.changes > 0;
  } catch {
    return false;
  }
}

export function releaseSyncLock(db: DatabaseSync, lockKey: string): void {
  try {
    db.prepare("DELETE FROM sync_locks WHERE lock_key = ?").run(lockKey);
  } catch {
    // ignore
  }
}

// ============================================================
// Zoho Activity Durable Month-Wise Backfill: Job & Window Persistence
// ============================================================

export interface ActivityBackfillJobRecord {
  job_id: string;
  organization_id: string;
  financial_year: string;
  requested_from_date: string;
  requested_to_date: string;
  status: "PENDING" | "RUNNING" | "PAUSED" | "PARTIAL" | "COMPLETE" | "FAILED";
  created_at: string;
  updated_at: string;
  last_error: string | null;
}

export interface ActivityBackfillWindowRecord {
  job_id: string;
  window_from: string;
  window_to: string;
  window_order: number;
  status: "PENDING" | "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED";
  next_page: number;
  page_size: number;
  last_page_fingerprint: string | null;
  records_seen: number;
  records_new: number;
  records_updated: number;
  out_of_window_count: number;
  api_calls_used: number;
  last_attempt_at: string | null;
  completed_at: string | null;
  last_error: string | null;
}

/**
 * Finds an existing job for this org+date-range that isn't finished, so a resume
 * continues real progress instead of restarting. Returns null if none exists (a new
 * job should be created) or if the only matching job already COMPLETEd.
 */
export function findResumableActivityBackfillJob(
  db: DatabaseSync,
  organizationId: string,
  fromDate: string,
  toDate: string
): ActivityBackfillJobRecord | null {
  // Deliberately NOT filtered by status: the job_id for a given org+range is
  // deterministic (one job per range), so the existing row — whatever its status —
  // is always the one to reuse. A COMPLETE job whose window was later reset (e.g. an
  // explicit re-verification) must still be found here rather than colliding with a
  // fresh INSERT attempt for the same job_id.
  const row = db.prepare(`
    SELECT * FROM activity_backfill_jobs
    WHERE organization_id = ? AND requested_from_date = ? AND requested_to_date = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(organizationId, fromDate, toDate) as ActivityBackfillJobRecord | undefined;
  return row || null;
}

export function createActivityBackfillJob(
  db: DatabaseSync,
  job: {
    jobId: string;
    organizationId: string;
    financialYear: string;
    fromDate: string;
    toDate: string;
    windows: { from: string; to: string }[];
  }
): void {
  const now = new Date().toISOString();
  // ON CONFLICT DO NOTHING: defensive idempotency. The caller (runActivityBackfill)
  // always checks findResumableActivityBackfillJob first, so this should never fire
  // in practice — but guarding it directly means a duplicate-create attempt reuses
  // the existing job instead of throwing.
  db.prepare(`
    INSERT INTO activity_backfill_jobs
    (job_id, organization_id, financial_year, requested_from_date, requested_to_date, status, created_at, updated_at, last_error)
    VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, NULL)
    ON CONFLICT(job_id) DO NOTHING
  `).run(job.jobId, job.organizationId, job.financialYear, job.fromDate, job.toDate, now, now);

  const insertWindow = db.prepare(`
    INSERT INTO activity_backfill_windows
    (job_id, window_from, window_to, window_order, status, next_page, page_size)
    VALUES (?, ?, ?, ?, 'PENDING', 1, 200)
    ON CONFLICT(job_id, window_from, window_to) DO NOTHING
  `);
  job.windows.forEach((w, idx) => insertWindow.run(job.jobId, w.from, w.to, idx));
}

export function getActivityBackfillJob(db: DatabaseSync, jobId: string): ActivityBackfillJobRecord | null {
  const row = db.prepare("SELECT * FROM activity_backfill_jobs WHERE job_id = ?").get(jobId) as ActivityBackfillJobRecord | undefined;
  return row || null;
}

export function getActivityBackfillWindows(db: DatabaseSync, jobId: string): ActivityBackfillWindowRecord[] {
  return db.prepare(`
    SELECT * FROM activity_backfill_windows WHERE job_id = ? ORDER BY window_order ASC
  `).all(jobId) as unknown as ActivityBackfillWindowRecord[];
}

export function setActivityBackfillJobStatus(db: DatabaseSync, jobId: string, status: ActivityBackfillJobRecord["status"], lastError?: string | null): void {
  db.prepare(`
    UPDATE activity_backfill_jobs SET status = ?, updated_at = ?, last_error = ? WHERE job_id = ?
  `).run(status, new Date().toISOString(), lastError ?? null, jobId);
}

/**
 * Persists one window's progress after a single page fetch. Callers must invoke this
 * only AFTER the network response is already in hand — never while a request is
 * in-flight — so no DB transaction is ever held open across a network call.
 */
export function recordActivityBackfillWindowProgress(
  db: DatabaseSync,
  jobId: string,
  windowFrom: string,
  windowTo: string,
  patch: {
    status?: ActivityBackfillWindowRecord["status"];
    nextPage?: number;
    lastPageFingerprint?: string | null;
    recordsSeenDelta?: number;
    recordsNewDelta?: number;
    recordsUpdatedDelta?: number;
    outOfWindowDelta?: number;
    apiCallsDelta?: number;
    lastError?: string | null;
    markCompleted?: boolean;
  }
): void {
  const now = new Date().toISOString();
  const sets: string[] = ["last_attempt_at = ?"];
  const params: (string | number | null)[] = [now];

  if (patch.status) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.nextPage !== undefined) {
    sets.push("next_page = ?");
    params.push(patch.nextPage);
  }
  if (patch.lastPageFingerprint !== undefined) {
    sets.push("last_page_fingerprint = ?");
    params.push(patch.lastPageFingerprint);
  }
  if (patch.recordsSeenDelta) {
    sets.push("records_seen = records_seen + ?");
    params.push(patch.recordsSeenDelta);
  }
  if (patch.recordsNewDelta) {
    sets.push("records_new = records_new + ?");
    params.push(patch.recordsNewDelta);
  }
  if (patch.recordsUpdatedDelta) {
    sets.push("records_updated = records_updated + ?");
    params.push(patch.recordsUpdatedDelta);
  }
  if (patch.outOfWindowDelta) {
    sets.push("out_of_window_count = out_of_window_count + ?");
    params.push(patch.outOfWindowDelta);
  }
  if (patch.apiCallsDelta) {
    sets.push("api_calls_used = api_calls_used + ?");
    params.push(patch.apiCallsDelta);
  }
  if (patch.lastError !== undefined) {
    sets.push("last_error = ?");
    params.push(patch.lastError);
  }
  if (patch.markCompleted) {
    sets.push("completed_at = ?");
    params.push(now);
  }

  params.push(jobId, windowFrom, windowTo);
  db.prepare(`
    UPDATE activity_backfill_windows SET ${sets.join(", ")}
    WHERE job_id = ? AND window_from = ? AND window_to = ?
  `).run(...params);
}

export function getDocumentSyncFingerprint(db: DatabaseSync, docType: "INVOICE" | "BILL", docId: string): { last_modified_time: string | null; content_fingerprint: string } | null {
  try {
    const row = db.prepare(`
      SELECT last_modified_time, content_fingerprint
      FROM document_sync_fingerprints
      WHERE document_type = ? AND document_id = ?
    `).get(docType, docId) as { last_modified_time: string | null; content_fingerprint: string } | undefined;
    return row || null;
  } catch {
    return null;
  }
}

export function setDocumentSyncFingerprint(
  db: DatabaseSync,
  docType: "INVOICE" | "BILL",
  docId: string,
  lastModifiedTime: string | null,
  contentFingerprint: string
): void {
  try {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO document_sync_fingerprints (document_type, document_id, last_modified_time, content_fingerprint, last_synced_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(document_type, document_id) DO UPDATE SET
        last_modified_time = excluded.last_modified_time,
        content_fingerprint = excluded.content_fingerprint,
        last_synced_at = excluded.last_synced_at
    `).run(docType, docId, lastModifiedTime || null, contentFingerprint, now);
  } catch {
    // ignore
  }
}

export function getAllSyncCoverage(db: DatabaseSync): SyncCoverageRecord[] {
  try {
    const rows = db.prepare(`
      SELECT financial_year, from_date, to_date, full_backfill_completed,
             invoice_list_pages, invoices_found, invoices_synced,
             bill_list_pages, bills_found, bills_synced,
             started_at, completed_at, status, error
      FROM sync_coverage
      ORDER BY from_date DESC
    `).all() as any[];

    return rows.map(r => ({
      financialYear: r.financial_year,
      fromDate: r.from_date,
      toDate: r.to_date,
      fullBackfillCompleted: Boolean(r.full_backfill_completed),
      invoiceListPages: r.invoice_list_pages,
      invoicesFound: r.invoices_found,
      invoicesSynced: r.invoices_synced,
      billListPages: r.bill_list_pages,
      billsFound: r.bills_found,
      billsSynced: r.bills_synced,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      status: r.status,
      error: r.error,
    }));
  } catch {
    return [];
  }
}

export interface ActivitySyncCheckpoint {
  checkpointKey: string;
  lastActivitySyncAt: string | null;
  lastActivityEventId: string | null;
  lastActivityEventTime: string | null;
  lastSuccessfulSyncAt: string | null;
  updatedAt: string;
}

export interface ApiUsageCacheRecord {
  id: string;
  dailyLimit: number;
  usedToday: number;
  remaining: number;
  usagePercentage: number;
  resetTime: string | null;
  updatedAt: string;
}

export function getActivitySyncCheckpoint(
  db: DatabaseSync,
  key: string = "primary_activity_checkpoint"
): ActivitySyncCheckpoint | null {
  try {
    const row = db.prepare(`
      SELECT checkpoint_key, last_activity_sync_at, last_activity_event_id,
             last_activity_event_time, last_successful_sync_at, updated_at
      FROM activity_sync_checkpoints
      WHERE checkpoint_key = ?
    `).get(key) as any;

    if (!row) return null;

    return {
      checkpointKey: row.checkpoint_key,
      lastActivitySyncAt: row.last_activity_sync_at,
      lastActivityEventId: row.last_activity_event_id,
      lastActivityEventTime: row.last_activity_event_time,
      lastSuccessfulSyncAt: row.last_successful_sync_at,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export function setActivitySyncCheckpoint(
  db: DatabaseSync,
  data: {
    key?: string;
    lastActivitySyncAt?: string | null;
    lastActivityEventId?: string | null;
    lastActivityEventTime?: string | null;
    lastSuccessfulSyncAt?: string | null;
  }
): void {
  try {
    const key = data.key || "primary_activity_checkpoint";
    const now = new Date().toISOString();
    const existing = getActivitySyncCheckpoint(db, key);

    const lastActivitySyncAt = data.lastActivitySyncAt !== undefined ? data.lastActivitySyncAt : existing?.lastActivitySyncAt || null;
    const lastActivityEventId = data.lastActivityEventId !== undefined ? data.lastActivityEventId : existing?.lastActivityEventId || null;
    const lastActivityEventTime = data.lastActivityEventTime !== undefined ? data.lastActivityEventTime : existing?.lastActivityEventTime || null;
    const lastSuccessfulSyncAt = data.lastSuccessfulSyncAt !== undefined ? data.lastSuccessfulSyncAt : existing?.lastSuccessfulSyncAt || null;

    db.prepare(`
      INSERT INTO activity_sync_checkpoints
      (checkpoint_key, last_activity_sync_at, last_activity_event_id, last_activity_event_time, last_successful_sync_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(checkpoint_key) DO UPDATE SET
        last_activity_sync_at = excluded.last_activity_sync_at,
        last_activity_event_id = excluded.last_activity_event_id,
        last_activity_event_time = excluded.last_activity_event_time,
        last_successful_sync_at = excluded.last_successful_sync_at,
        updated_at = excluded.updated_at
    `).run(key, lastActivitySyncAt, lastActivityEventId, lastActivityEventTime, lastSuccessfulSyncAt, now);
  } catch (err) {
    console.error("[Database] Failed to set activity checkpoint:", err);
  }
}

export function getApiUsageCache(
  db: DatabaseSync,
  id: string = "current_usage"
): ApiUsageCacheRecord | null {
  try {
    const row = db.prepare(`
      SELECT id, daily_limit, used_today, remaining, usage_percentage, reset_time, updated_at
      FROM zoho_api_usage_cache
      WHERE id = ?
    `).get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      dailyLimit: row.daily_limit,
      usedToday: row.used_today,
      remaining: row.remaining,
      usagePercentage: row.usage_percentage,
      resetTime: row.reset_time,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export function setApiUsageCache(
  db: DatabaseSync,
  data: {
    id?: string;
    dailyLimit: number;
    usedToday: number;
    remaining: number;
    usagePercentage?: number;
    resetTime?: string | null;
  }
): void {
  try {
    const id = data.id || "current_usage";
    const now = new Date().toISOString();
    const limit = Math.max(1, data.dailyLimit || 10000);
    const used = Math.max(0, data.usedToday || 0);
    const remaining = typeof data.remaining === "number" ? data.remaining : Math.max(0, limit - used);
    const percentage = typeof data.usagePercentage === "number"
      ? data.usagePercentage
      : Math.round((used / limit) * 10000) / 100;

    db.prepare(`
      INSERT INTO zoho_api_usage_cache
      (id, daily_limit, used_today, remaining, usage_percentage, reset_time, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        daily_limit = excluded.daily_limit,
        used_today = excluded.used_today,
        remaining = excluded.remaining,
        usage_percentage = excluded.usage_percentage,
        reset_time = excluded.reset_time,
        updated_at = excluded.updated_at
    `).run(id, limit, used, remaining, percentage, data.resetTime || null, now);
  } catch (err) {
    console.error("[Database] Failed to set API usage cache:", err);
  }
}

// ============================================================
// Section 4 & 12: Zoho Activity Logs Cache & Metrics Engine
// ============================================================

export interface ZohoActivityLogRecord {
  activity_id: string;
  date: string;
  time?: string | null;
  user_name?: string | null;
  user_id?: string | null;
  module: string;
  action: string;
  description?: string | null;
  entity_id?: string | null;
  entity_number?: string | null;
  ip_address?: string | null;
  source?: string | null;
  created_time?: string | null;
  activity_type?: string | null;
  module_source?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  reference_number?: string | null;
  linked_bill_id?: string | null;
  linked_invoice_id?: string | null;
  raw_payload_json?: string | null;
  detail_party_name?: string | null;
  detail_party_id?: string | null;
  synced_at: string;
}

export interface ActivityFilterOptions {
  fromDate?: string;
  toDate?: string;
  user?: string;
  module?: string;
  action?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ActivityKpisResult {
  totalActivities: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
  users: number;
  modules: number;
  lastSync: string | null;
}

export interface ActivitySyncStats {
  lastSync: string | null;
  activitiesRetrieved: number;
  newActivities: number;
  updatedActivities: number;
  apiCallsUsed: number;
}

/**
 * Saves a batch of activity records into SQLite zoho_activity_logs (and mirrors to zoho_activity_log).
 * Tracks count of newly inserted and updated activities.
 */
export function saveActivityLogsBatch(
  db: DatabaseSync,
  activities: ZohoActivityLogRecord[]
): { newActivities: number; updatedActivities: number } {
  let newCount = 0;
  let updatedCount = 0;

  const checkStmt = db.prepare("SELECT activity_id FROM zoho_activity_logs WHERE activity_id = ?");

  const insertLogsStmt = db.prepare(`
    INSERT INTO zoho_activity_logs
    (activity_id, date, time, user_name, user_id, module, action, description, entity_id, entity_number, ip_address, source, created_time, activity_type, module_source, reference_type, reference_id, reference_number, linked_bill_id, linked_invoice_id, raw_payload_json, detail_party_name, detail_party_id, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(activity_id) DO UPDATE SET
      date = excluded.date,
      time = excluded.time,
      user_name = excluded.user_name,
      user_id = excluded.user_id,
      module = excluded.module,
      action = excluded.action,
      description = excluded.description,
      entity_id = excluded.entity_id,
      entity_number = excluded.entity_number,
      ip_address = excluded.ip_address,
      source = excluded.source,
      created_time = excluded.created_time,
      activity_type = excluded.activity_type,
      module_source = excluded.module_source,
      reference_type = excluded.reference_type,
      reference_id = excluded.reference_id,
      reference_number = excluded.reference_number,
      linked_bill_id = excluded.linked_bill_id,
      linked_invoice_id = excluded.linked_invoice_id,
      raw_payload_json = excluded.raw_payload_json,
      detail_party_name = excluded.detail_party_name,
      detail_party_id = excluded.detail_party_id,
      synced_at = excluded.synced_at
  `);

  const insertLogLegacyStmt = db.prepare(`
    INSERT INTO zoho_activity_log
    (activity_id, activity_datetime, activity_date, module, action, entity_type, entity_id, document_number, user_id, user_name, description, source_ip, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(activity_id) DO UPDATE SET
      activity_datetime = excluded.activity_datetime,
      activity_date = excluded.activity_date,
      module = excluded.module,
      action = excluded.action,
      entity_type = excluded.entity_type,
      entity_id = excluded.entity_id,
      document_number = excluded.document_number,
      user_id = excluded.user_id,
      user_name = excluded.user_name,
      description = excluded.description,
      source_ip = excluded.source_ip,
      synced_at = excluded.synced_at
  `);

  for (const act of activities) {
    const existing = checkStmt.get(act.activity_id);
    if (existing) {
      updatedCount++;
    } else {
      newCount++;
    }

    insertLogsStmt.run(
      act.activity_id,
      act.date,
      act.time || null,
      act.user_name || null,
      act.user_id || null,
      act.module,
      act.action,
      act.description || null,
      act.entity_id || null,
      act.entity_number || null,
      act.ip_address || null,
      act.source || null,
      act.created_time || null,
      act.activity_type || null,
      act.module_source || null,
      act.reference_type || null,
      act.reference_id || null,
      act.reference_number || null,
      act.linked_bill_id || null,
      act.linked_invoice_id || null,
      act.raw_payload_json || null,
      act.detail_party_name || null,
      act.detail_party_id || null,
      act.synced_at
    );

    // Legacy sync mirror
    const dt = act.created_time || `${act.date}T${act.time || "00:00:00"}`;
    insertLogLegacyStmt.run(
      act.activity_id,
      dt,
      act.date,
      act.module,
      act.action,
      act.activity_type || act.module,
      act.entity_id || null,
      act.entity_number || null,
      act.user_id || null,
      act.user_name || null,
      act.description || "",
      act.ip_address || null,
      act.synced_at
    );
  }

  return { newActivities: newCount, updatedActivities: updatedCount };
}

/**
 * Retrieves activity logs from SQLite zoho_activity_logs with flexible filtering and search.
 */
export function getActivityLogs(
  db: DatabaseSync,
  filters: ActivityFilterOptions = {}
): { activities: ZohoActivityLogRecord[]; totalCount: number } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.fromDate && filters.toDate) {
    conditions.push("date >= ? AND date <= ?");
    params.push(filters.fromDate, filters.toDate);
  } else if (filters.fromDate) {
    conditions.push("date >= ?");
    params.push(filters.fromDate);
  } else if (filters.toDate) {
    conditions.push("date <= ?");
    params.push(filters.toDate);
  }

  if (filters.user) {
    conditions.push("user_name = ?");
    params.push(filters.user);
  }

  if (filters.module) {
    conditions.push("module = ?");
    params.push(filters.module);
  }

  if (filters.action) {
    conditions.push("action = ?");
    params.push(filters.action);
  }

  if (filters.search && filters.search.trim()) {
    const s = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      "(LOWER(user_name) LIKE ? OR LOWER(module) LIKE ? OR LOWER(action) LIKE ? OR LOWER(description) LIKE ? OR LOWER(entity_number) LIKE ? OR LOWER(reference_number) LIKE ?)"
    );
    params.push(s, s, s, s, s, s);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = db.prepare(`SELECT COUNT(*) as c FROM zoho_activity_logs ${whereClause}`).get(...params) as { c: number } | undefined;
  const totalCount = countRow ? countRow.c : 0;

  let query = `
    SELECT
      activity_id, date, time, user_name, user_id, module, action,
      description, entity_id, entity_number, ip_address, source,
      created_time, activity_type, module_source, reference_type,
      reference_id, reference_number, linked_bill_id, linked_invoice_id,
      raw_payload_json, detail_party_name, detail_party_id, synced_at
    FROM zoho_activity_logs
    ${whereClause}
    ORDER BY date DESC, time DESC, created_time DESC
  `;

  const queryParams = [...params];
  if (typeof filters.limit === "number") {
    query += " LIMIT ?";
    queryParams.push(filters.limit);
    if (typeof filters.offset === "number") {
      query += " OFFSET ?";
      queryParams.push(filters.offset);
    }
  }

  const activities = db.prepare(query).all(...queryParams) as unknown as ZohoActivityLogRecord[];

  return { activities, totalCount };
}

/**
 * Computes the 7 required KPIs for Zoho Activity:
 * Total Activities, Today, This Week, This Month, Users, Modules, Last Sync.
 */
export function getActivityKpis(
  db: DatabaseSync,
  fyStart: string = "2026-04-01",
  toDate?: string,
  refDate: Date = new Date()
): ActivityKpisResult {
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${refDate.getFullYear()}-${pad(refDate.getMonth() + 1)}-${pad(refDate.getDate())}`;
  const effectiveToDate = toDate || todayStr;

  // Total in current FY
  const totalRow = db.prepare(`
    SELECT COUNT(*) as c FROM zoho_activity_logs
    WHERE date >= ? AND date <= ?
  `).get(fyStart, effectiveToDate) as { c: number } | undefined;
  const totalActivities = totalRow ? totalRow.c : 0;

  // Today
  const todayRow = db.prepare(`
    SELECT COUNT(*) as c FROM zoho_activity_logs
    WHERE date = ?
  `).get(todayStr) as { c: number } | undefined;
  const today = todayRow ? todayRow.c : 0;

  // This Week (Monday to Sunday)
  const d = new Date(refDate);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  const weekStartStr = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;

  const weekRow = db.prepare(`
    SELECT COUNT(*) as c FROM zoho_activity_logs
    WHERE date >= ? AND date <= ?
  `).get(weekStartStr, todayStr) as { c: number } | undefined;
  const thisWeek = weekRow ? weekRow.c : 0;

  // This Month
  const monthStartStr = `${refDate.getFullYear()}-${pad(refDate.getMonth() + 1)}-01`;
  const monthRow = db.prepare(`
    SELECT COUNT(*) as c FROM zoho_activity_logs
    WHERE date >= ? AND date <= ?
  `).get(monthStartStr, todayStr) as { c: number } | undefined;
  const thisMonth = monthRow ? monthRow.c : 0;

  // Distinct Users
  const usersRow = db.prepare(`
    SELECT COUNT(DISTINCT user_name) as c FROM zoho_activity_logs
    WHERE user_name IS NOT NULL AND TRIM(user_name) != '' AND date >= ? AND date <= ?
  `).get(fyStart, effectiveToDate) as { c: number } | undefined;
  const users = usersRow ? usersRow.c : 0;

  // Distinct Modules
  const modulesRow = db.prepare(`
    SELECT COUNT(DISTINCT module) as c FROM zoho_activity_logs
    WHERE module IS NOT NULL AND TRIM(module) != '' AND date >= ? AND date <= ?
  `).get(fyStart, effectiveToDate) as { c: number } | undefined;
  const modules = modulesRow ? modulesRow.c : 0;

  // Last Sync
  const lastSyncMeta = getSyncMetadata(db, "last_successful_activity_sync");
  let lastSync = lastSyncMeta;
  if (!lastSync) {
    const maxSyncRow = db.prepare("SELECT MAX(synced_at) as s FROM zoho_activity_logs").get() as { s: string | null } | undefined;
    lastSync = maxSyncRow?.s || null;
  }

  return {
    totalActivities,
    today,
    thisWeek,
    thisMonth,
    users,
    modules,
    lastSync,
  };
}

/**
 * Returns API usage metrics for Zoho Activity.
 */
export function getActivitySyncStats(db: DatabaseSync): ActivitySyncStats {
  const lastSync = getSyncMetadata(db, "last_successful_activity_sync") || null;
  const activitiesRetrieved = parseInt(getSyncMetadata(db, "last_activity_sync_retrieved") || "0", 10);
  const newActivities = parseInt(getSyncMetadata(db, "last_activity_sync_new") || "0", 10);
  const updatedActivities = parseInt(getSyncMetadata(db, "last_activity_sync_updated") || "0", 10);
  const apiCallsUsed = parseInt(getSyncMetadata(db, "last_activity_sync_api_calls") || "0", 10);

  return {
    lastSync,
    activitiesRetrieved,
    newActivities,
    updatedActivities,
    apiCallsUsed,
  };
}

export function setActivitySyncStats(
  db: DatabaseSync,
  stats: ActivitySyncStats
): void {
  if (stats.lastSync) {
    setSyncMetadata(db, "last_successful_activity_sync", stats.lastSync);
  }
  setSyncMetadata(db, "last_activity_sync_retrieved", String(stats.activitiesRetrieved));
  setSyncMetadata(db, "last_activity_sync_new", String(stats.newActivities));
  setSyncMetadata(db, "last_activity_sync_updated", String(stats.updatedActivities));
  setSyncMetadata(db, "last_activity_sync_api_calls", String(stats.apiCallsUsed));
}

// ============================================================
// Test Isolation Helper
// ============================================================

/**
 * Creates an isolated in-memory SQLite database with the full operational schema.
 *
 * SAFETY: This database is NEVER the operational bansil_books.db — it is
 * ephemeral, lives only in process memory, and is discarded when the
 * process exits or the reference is released. No data written here reaches
 * disk or the production database. Test scripts must use this function
 * instead of getDatabase().
 *
 * The `:memory:` URI is passed directly to DatabaseSync; Node.js built-in
 * sqlite supports this as a standard SQLite in-memory database.
 */
export function createTestDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  initDatabase(db);
  return db;
}

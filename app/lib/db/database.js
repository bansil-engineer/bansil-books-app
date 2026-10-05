"use strict";
// ============================================================
// Bansil Books Analytics — Local SQLite Database Architecture
// Node 22+ Built-in node:sqlite · Operational Analytics Cache
// ============================================================
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDatabase = getDatabase;
exports.initDatabase = initDatabase;
exports.seedInitialDataIfEmpty = seedInitialDataIfEmpty;
exports.getSyncMetadata = getSyncMetadata;
exports.setSyncMetadata = setSyncMetadata;
exports.getLatestSyncedDocumentDate = getLatestSyncedDocumentDate;
exports.recordApiCall = recordApiCall;
exports.getApiCallStats = getApiCallStats;
exports.recordSyncLog = recordSyncLog;
exports.getRecentSyncLogs = getRecentSyncLogs;
exports.getSyncCoverage = getSyncCoverage;
exports.recordSyncCoverage = recordSyncCoverage;
exports.isFullBackfillCompleted = isFullBackfillCompleted;
exports.getAllDistinctVendors = getAllDistinctVendors;
exports.getAllClassifications = getAllClassifications;
exports.getClassifiedServiceItemIds = getClassifiedServiceItemIds;
exports.getItemClassification = getItemClassification;
exports.saveClassification = saveClassification;
exports.getFeatureSettings = getFeatureSettings;
exports.updateFeatureSetting = updateFeatureSetting;
exports.updateFeatureSettings = updateFeatureSettings;
exports.getActiveExclusions = getActiveExclusions;
exports.getActiveExcludedItemIds = getActiveExcludedItemIds;
exports.isItemExcluded = isItemExcluded;
exports.getSyncState = getSyncState;
exports.getAllSyncStates = getAllSyncStates;
exports.setSyncState = setSyncState;
exports.acquireSyncLock = acquireSyncLock;
exports.releaseSyncLock = releaseSyncLock;
exports.findResumableActivityBackfillJob = findResumableActivityBackfillJob;
exports.createActivityBackfillJob = createActivityBackfillJob;
exports.getActivityBackfillJob = getActivityBackfillJob;
exports.getActivityBackfillWindows = getActivityBackfillWindows;
exports.setActivityBackfillJobStatus = setActivityBackfillJobStatus;
exports.recordActivityBackfillWindowProgress = recordActivityBackfillWindowProgress;
exports.getDocumentSyncFingerprint = getDocumentSyncFingerprint;
exports.setDocumentSyncFingerprint = setDocumentSyncFingerprint;
exports.getAllSyncCoverage = getAllSyncCoverage;
exports.getActivitySyncCheckpoint = getActivitySyncCheckpoint;
exports.setActivitySyncCheckpoint = setActivitySyncCheckpoint;
exports.getApiUsageCache = getApiUsageCache;
exports.setApiUsageCache = setApiUsageCache;
exports.saveActivityLogsBatch = saveActivityLogsBatch;
exports.getActivityLogs = getActivityLogs;
exports.getActivityKpis = getActivityKpis;
exports.getActivitySyncStats = getActivitySyncStats;
exports.setActivitySyncStats = setActivitySyncStats;
var node_sqlite_1 = require("node:sqlite");
var node_fs_1 = __importDefault(require("node:fs"));
var node_path_1 = __importDefault(require("node:path"));
var dbInstance = null;
var DB_DIR = node_path_1.default.join(process.cwd(), "data");
var DB_FILE = node_path_1.default.join(DB_DIR, "bansil_books.db");
/**
 * Returns the singleton SQLite database instance, initializing tables & indexes if necessary.
 */
function getDatabase() {
    if (dbInstance)
        return dbInstance;
    if (!node_fs_1.default.existsSync(DB_DIR)) {
        node_fs_1.default.mkdirSync(DB_DIR, { recursive: true });
    }
    var db = new node_sqlite_1.DatabaseSync(DB_FILE);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    initDatabase(db);
    dbInstance = db;
    return dbInstance;
}
/**
 * Creates schema and indexes required by Section 2 and Section 14.
 */
function initDatabase(db) {
    db.exec("\n    CREATE TABLE IF NOT EXISTS organizations (\n      organization_id TEXT PRIMARY KEY,\n      name TEXT NOT NULL,\n      currency_symbol TEXT DEFAULT '\u20B9',\n      created_time TEXT\n    );\n\n    CREATE TABLE IF NOT EXISTS sales_invoices (\n      invoice_id TEXT PRIMARY KEY,\n      organization_id TEXT NOT NULL,\n      invoice_number TEXT NOT NULL,\n      date TEXT NOT NULL,\n      due_date TEXT,\n      customer_id TEXT NOT NULL,\n      customer_name TEXT NOT NULL,\n      reference_number TEXT,\n      status TEXT NOT NULL,\n      total REAL NOT NULL,\n      balance REAL NOT NULL,\n      invoice_url TEXT,\n      is_verified_link INTEGER DEFAULT 0,\n      created_time TEXT,\n      last_modified_time TEXT,\n      source TEXT DEFAULT 'ZOHO_BOOKS',\n      synced_at TEXT NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS sales_invoice_line_items (\n      line_item_id TEXT PRIMARY KEY,\n      invoice_id TEXT NOT NULL,\n      item_id TEXT NOT NULL,\n      item_name TEXT NOT NULL,\n      sku TEXT,\n      quantity REAL NOT NULL,\n      rate REAL NOT NULL,\n      line_total REAL NOT NULL,\n      bbt_customer_id TEXT,\n      bbt_customer_name TEXT,\n      description TEXT,\n      source TEXT DEFAULT 'ZOHO_BOOKS',\n      synced_at TEXT NOT NULL,\n      FOREIGN KEY (invoice_id) REFERENCES sales_invoices(invoice_id) ON DELETE CASCADE\n    );\n\n    CREATE TABLE IF NOT EXISTS purchase_bills (\n      bill_id TEXT PRIMARY KEY,\n      organization_id TEXT NOT NULL,\n      bill_number TEXT NOT NULL,\n      date TEXT NOT NULL,\n      due_date TEXT,\n      vendor_id TEXT NOT NULL,\n      vendor_name TEXT NOT NULL,\n      reference_number TEXT,\n      status TEXT NOT NULL,\n      total REAL NOT NULL,\n      balance REAL NOT NULL,\n      bill_url TEXT,\n      is_verified_link INTEGER DEFAULT 0,\n      created_time TEXT,\n      last_modified_time TEXT,\n      source TEXT DEFAULT 'ZOHO_BOOKS',\n      synced_at TEXT NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS purchase_bill_line_items (\n      line_item_id TEXT PRIMARY KEY,\n      bill_id TEXT NOT NULL,\n      item_id TEXT NOT NULL,\n      item_name TEXT NOT NULL,\n      sku TEXT,\n      quantity REAL NOT NULL,\n      rate REAL NOT NULL,\n      line_total REAL NOT NULL,\n      bbt_customer_id TEXT,\n      bbt_customer_name TEXT,\n      description TEXT,\n      customer_data_status TEXT NOT NULL DEFAULT 'VERIFIED',\n      source TEXT DEFAULT 'ZOHO_BOOKS',\n      synced_at TEXT NOT NULL,\n      FOREIGN KEY (bill_id) REFERENCES purchase_bills(bill_id) ON DELETE CASCADE\n    );\n\n    CREATE TABLE IF NOT EXISTS sync_metadata (\n      key TEXT PRIMARY KEY,\n      value TEXT NOT NULL,\n      updated_at TEXT NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS sync_logs (\n      sync_id TEXT PRIMARY KEY,\n      start_time TEXT NOT NULL,\n      end_time TEXT,\n      sync_type TEXT NOT NULL,\n      invoices_checked INTEGER DEFAULT 0,\n      invoices_added INTEGER DEFAULT 0,\n      invoices_updated INTEGER DEFAULT 0,\n      invoice_lines_synced INTEGER DEFAULT 0,\n      bills_checked INTEGER DEFAULT 0,\n      bills_added INTEGER DEFAULT 0,\n      bills_updated INTEGER DEFAULT 0,\n      bill_lines_synced INTEGER DEFAULT 0,\n      unchanged_records INTEGER DEFAULT 0,\n      exceptions_count INTEGER DEFAULT 0,\n      api_calls INTEGER DEFAULT 0,\n      status TEXT NOT NULL,\n      errors TEXT\n    );\n\n    CREATE TABLE IF NOT EXISTS api_call_counter (\n      date TEXT PRIMARY KEY,\n      call_count INTEGER DEFAULT 0\n    );\n\n    CREATE TABLE IF NOT EXISTS sync_coverage (\n      financial_year TEXT PRIMARY KEY,\n      from_date TEXT NOT NULL,\n      to_date TEXT NOT NULL,\n      full_backfill_completed INTEGER NOT NULL DEFAULT 0,\n      invoice_list_pages INTEGER DEFAULT 0,\n      invoices_found INTEGER DEFAULT 0,\n      invoices_synced INTEGER DEFAULT 0,\n      bill_list_pages INTEGER DEFAULT 0,\n      bills_found INTEGER DEFAULT 0,\n      bills_synced INTEGER DEFAULT 0,\n      started_at TEXT,\n      completed_at TEXT,\n      status TEXT NOT NULL DEFAULT 'PENDING',\n      error TEXT\n    );\n\n    -- Section 16 & 18: Zoho Activity Log Local Cache\n    CREATE TABLE IF NOT EXISTS zoho_activity_log (\n      activity_id TEXT PRIMARY KEY,\n      activity_datetime TEXT NOT NULL,\n      activity_date TEXT NOT NULL,\n      module TEXT NOT NULL,\n      action TEXT NOT NULL,\n      entity_type TEXT,\n      entity_id TEXT,\n      document_number TEXT,\n      user_id TEXT,\n      user_name TEXT,\n      description TEXT,\n      source_ip TEXT,\n      synced_at TEXT NOT NULL\n    );\n    CREATE INDEX IF NOT EXISTS idx_activity_date ON zoho_activity_log(activity_date);\n    CREATE INDEX IF NOT EXISTS idx_activity_module ON zoho_activity_log(module);\n    CREATE INDEX IF NOT EXISTS idx_activity_user ON zoho_activity_log(user_id);\n\n    -- Section 4: Zoho Activity Logs Local Cache (Official API fields only)\n    CREATE TABLE IF NOT EXISTS zoho_activity_logs (\n      activity_id TEXT PRIMARY KEY,\n      date TEXT NOT NULL,\n      time TEXT,\n      user_name TEXT,\n      user_id TEXT,\n      module TEXT NOT NULL,\n      module_source TEXT DEFAULT 'STRUCTURED',\n      action TEXT NOT NULL,\n      description TEXT,\n      entity_id TEXT,\n      entity_number TEXT,\n      reference_type TEXT,\n      reference_id TEXT,\n      reference_number TEXT,\n      linked_bill_id TEXT,\n      linked_invoice_id TEXT,\n      ip_address TEXT,\n      source TEXT,\n      created_time TEXT,\n      activity_type TEXT,\n      raw_payload_json TEXT,\n      detail_party_name TEXT,\n      detail_party_id TEXT,\n      synced_at TEXT NOT NULL\n    );\n    CREATE INDEX IF NOT EXISTS idx_activity_logs_date ON zoho_activity_logs(date);\n    CREATE INDEX IF NOT EXISTS idx_activity_logs_module ON zoho_activity_logs(module);\n    CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON zoho_activity_logs(user_name);\n    CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON zoho_activity_logs(entity_id);\n    -- NOTE: indexes on reference_number/linked_bill_id/linked_invoice_id are created further\n    -- below, AFTER the ALTER TABLE migrations that add those columns to pre-existing databases.\n    -- Do not add them here: on a DB created before this schema extension, zoho_activity_logs\n    -- won't yet have these columns, and creating an index on a missing column throws\n    -- \"no such column: reference_number\", aborting this entire exec() before the migrations\n    -- below ever run.\n\n\n    -- Section 14 Performance Indexes\n    CREATE INDEX IF NOT EXISTS idx_invoices_date ON sales_invoices (date);\n    CREATE INDEX IF NOT EXISTS idx_invoices_customer ON sales_invoices (customer_id);\n    CREATE INDEX IF NOT EXISTS idx_invoices_status ON sales_invoices (status);\n    CREATE INDEX IF NOT EXISTS idx_invoices_modified ON sales_invoices (last_modified_time);\n\n    CREATE INDEX IF NOT EXISTS idx_inv_lines_item ON sales_invoice_line_items (item_id);\n    CREATE INDEX IF NOT EXISTS idx_inv_lines_cust_item ON sales_invoice_line_items (bbt_customer_name, item_name);\n\n    CREATE INDEX IF NOT EXISTS idx_bills_date ON purchase_bills (date);\n    CREATE INDEX IF NOT EXISTS idx_bills_vendor ON purchase_bills (vendor_id);\n    CREATE INDEX IF NOT EXISTS idx_bills_status ON purchase_bills (status);\n    CREATE INDEX IF NOT EXISTS idx_bills_modified ON purchase_bills (last_modified_time);\n\n    CREATE INDEX IF NOT EXISTS idx_bill_lines_item ON purchase_bill_line_items (item_id);\n    CREATE INDEX IF NOT EXISTS idx_bill_lines_cust_item ON purchase_bill_line_items (bbt_customer_name, item_name);\n\n    -- Reconciliation Exclusion Rules (Section: Exclusion System)\n    CREATE TABLE IF NOT EXISTS reconciliation_exclusions (\n      exclusion_id TEXT PRIMARY KEY,\n      customer_id TEXT,\n      customer_name TEXT,\n      item_id TEXT,\n      item_name TEXT,\n      sku TEXT,\n      financial_year TEXT,\n      reason TEXT NOT NULL DEFAULT 'OTHER',\n      notes TEXT,\n      status TEXT NOT NULL DEFAULT 'ACTIVE',\n      created_by TEXT NOT NULL DEFAULT 'system',\n      created_at TEXT NOT NULL,\n      deactivated_at TEXT,\n      approved_by TEXT\n    );\n\n    CREATE INDEX IF NOT EXISTS idx_excl_customer ON reconciliation_exclusions (customer_id);\n    CREATE INDEX IF NOT EXISTS idx_excl_item ON reconciliation_exclusions (item_id);\n    -- Section: Analytics Classification (Material vs Service)\n    CREATE TABLE IF NOT EXISTS analytics_classifications (\n      id TEXT PRIMARY KEY,\n      source_type TEXT NOT NULL, -- 'ITEM' | 'ACCOUNT'\n      item_id TEXT,\n      item_name TEXT,\n      account_id TEXT,\n      account_name TEXT,\n      classification TEXT NOT NULL DEFAULT 'MATERIAL', -- 'MATERIAL' | 'SERVICE'\n      is_active INTEGER NOT NULL DEFAULT 1,\n      approved_by TEXT,\n      approved_at TEXT,\n      created_at TEXT NOT NULL,\n      updated_at TEXT NOT NULL\n    );\n\n    CREATE INDEX IF NOT EXISTS idx_class_item_id ON analytics_classifications(item_id);\n    CREATE INDEX IF NOT EXISTS idx_class_item_name ON analytics_classifications(item_name);\n    CREATE INDEX IF NOT EXISTS idx_class_account_id ON analytics_classifications(account_id);\n    CREATE INDEX IF NOT EXISTS idx_class_active ON analytics_classifications(is_active);\n\n    -- Seed known default service classifications if empty\n    INSERT OR IGNORE INTO analytics_classifications (\n      id, source_type, item_id, item_name, classification, is_active, approved_by, approved_at, created_at, updated_at\n    ) VALUES (\n      'class-svc-elec-install',\n      'ITEM',\n      '3166667000000107051',\n      'ELECTRICAL, INSTALLATION, ERECTION & TESTING',\n      'SERVICE',\n      1,\n      'System Admin',\n      '2026-09-11T00:00:00.000Z',\n      '2026-09-11T00:00:00.000Z',\n      '2026-09-11T00:00:00.000Z'\n    );\n    -- Section 26: Module & Function Feature Settings\n    CREATE TABLE IF NOT EXISTS app_feature_settings (\n      feature_key TEXT PRIMARY KEY,\n      enabled INTEGER NOT NULL DEFAULT 1,\n      updated_at TEXT NOT NULL,\n      updated_by TEXT NOT NULL DEFAULT 'OWNER'\n    );\n    CREATE INDEX IF NOT EXISTS idx_feature_settings_key ON app_feature_settings(feature_key);\n\n    -- Section: Customer Action Tracker & History\n    CREATE TABLE IF NOT EXISTS customer_action_tracker (\n      id TEXT PRIMARY KEY,\n      customer_id TEXT NOT NULL UNIQUE,\n      customer_name TEXT,\n      action_status TEXT NOT NULL DEFAULT 'Open',\n      action_taken TEXT,\n      action_owner TEXT,\n      priority TEXT NOT NULL DEFAULT 'MEDIUM',\n      next_follow_up_date TEXT,\n      remarks TEXT,\n      created_at TEXT NOT NULL,\n      updated_at TEXT NOT NULL\n    );\n    CREATE INDEX IF NOT EXISTS idx_action_tracker_cust ON customer_action_tracker(customer_id);\n    CREATE INDEX IF NOT EXISTS idx_action_tracker_status ON customer_action_tracker(action_status);\n\n    CREATE TABLE IF NOT EXISTS customer_action_history (\n      id TEXT PRIMARY KEY,\n      customer_id TEXT NOT NULL,\n      customer_name TEXT,\n      item_id TEXT,\n      item_name TEXT,\n      action_status TEXT NOT NULL,\n      action_taken TEXT,\n      action_owner TEXT,\n      priority TEXT NOT NULL DEFAULT 'MEDIUM',\n      next_follow_up_date TEXT,\n      remarks TEXT,\n      created_at TEXT NOT NULL\n    );\n    CREATE INDEX IF NOT EXISTS idx_action_hist_cust ON customer_action_history(customer_id);\n\n    -- Section: Purchase Line Action Tracker (Customer Details Missing)\n    CREATE TABLE IF NOT EXISTS purchase_line_action_tracker (\n      id TEXT PRIMARY KEY,\n      line_item_id TEXT NOT NULL UNIQUE,\n      bill_id TEXT NOT NULL,\n      action_status TEXT NOT NULL DEFAULT 'Open',\n      action_owner TEXT,\n      next_follow_up_date TEXT,\n      remarks TEXT,\n      created_at TEXT NOT NULL,\n      updated_at TEXT NOT NULL\n    );\n    CREATE INDEX IF NOT EXISTS idx_pline_action_line ON purchase_line_action_tracker(line_item_id);\n    CREATE INDEX IF NOT EXISTS idx_pline_action_bill ON purchase_line_action_tracker(bill_id);\n    CREATE INDEX IF NOT EXISTS idx_pline_action_status ON purchase_line_action_tracker(action_status);\n\n    -- Section: Customer Material Control Site Actions\n    CREATE TABLE IF NOT EXISTS customer_material_site_actions (\n      id TEXT PRIMARY KEY,\n      customer_id TEXT NOT NULL,\n      item_id TEXT NOT NULL,\n      site_remark TEXT,\n      action_required TEXT,\n      responsible_person TEXT,\n      target_date TEXT,\n      action_status TEXT NOT NULL DEFAULT 'OPEN',\n      updated_at TEXT NOT NULL\n    );\n    CREATE INDEX IF NOT EXISTS idx_site_actions_cust_item ON customer_material_site_actions(customer_id, item_id);\n\n    -- Section: Local Manual Composite Assembly Ledger\n    CREATE TABLE IF NOT EXISTS composite_assemblies (\n      assembly_id TEXT PRIMARY KEY,\n      assembly_number TEXT NOT NULL UNIQUE,\n      customer_id TEXT NOT NULL,\n      customer_name TEXT NOT NULL,\n      composite_item_id TEXT NOT NULL,\n      composite_item_name TEXT NOT NULL,\n      composite_sku TEXT,\n      generated_qty REAL NOT NULL,\n      unit TEXT DEFAULT 'BUN',\n      total_material_cost REAL DEFAULT 0,\n      cost_per_unit REAL DEFAULT 0,\n      assembly_date TEXT NOT NULL,\n      reference_no TEXT,\n      remarks TEXT,\n      status TEXT NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'CONFIRMED', 'CANCELLED'\n      created_at TEXT NOT NULL,\n      updated_at TEXT NOT NULL,\n      created_by TEXT DEFAULT 'Local User'\n    );\n    CREATE INDEX IF NOT EXISTS idx_asm_customer ON composite_assemblies(customer_id);\n    CREATE INDEX IF NOT EXISTS idx_asm_status ON composite_assemblies(status);\n    CREATE INDEX IF NOT EXISTS idx_asm_date ON composite_assemblies(assembly_date);\n    CREATE INDEX IF NOT EXISTS idx_asm_comp_item ON composite_assemblies(composite_item_id);\n\n    CREATE TABLE IF NOT EXISTS composite_assembly_components (\n      assembly_component_id TEXT PRIMARY KEY,\n      assembly_id TEXT NOT NULL REFERENCES composite_assemblies(assembly_id),\n      source_bill_id TEXT NOT NULL,\n      source_bill_number TEXT,\n      source_bill_date TEXT,\n      source_bill_line_item_id TEXT NOT NULL,\n      component_item_id TEXT NOT NULL,\n      component_item_name TEXT NOT NULL,\n      component_sku TEXT,\n      vendor_name TEXT,\n      raw_purchase_qty REAL NOT NULL,\n      consumed_qty REAL NOT NULL,\n      purchase_rate REAL NOT NULL,\n      purchase_amount REAL NOT NULL,\n      customer_id TEXT NOT NULL,\n      created_at TEXT NOT NULL\n    );\n    CREATE INDEX IF NOT EXISTS idx_asm_comp_asm_id ON composite_assembly_components(assembly_id);\n    CREATE INDEX IF NOT EXISTS idx_asm_comp_line_id ON composite_assembly_components(source_bill_line_item_id);\n    CREATE INDEX IF NOT EXISTS idx_asm_comp_item_id ON composite_assembly_components(component_item_id);\n    CREATE INDEX IF NOT EXISTS idx_asm_comp_cust ON composite_assembly_components(customer_id);\n\n    CREATE TABLE IF NOT EXISTS composite_assembly_audit (\n      audit_id TEXT PRIMARY KEY,\n      assembly_id TEXT NOT NULL,\n      action TEXT NOT NULL, -- 'CREATE_DRAFT', 'CONFIRM', 'EDIT_DRAFT', 'CANCEL', 'REVERSE'\n      actor TEXT DEFAULT 'Local User',\n      details TEXT,\n      created_at TEXT NOT NULL\n    );\n    CREATE INDEX IF NOT EXISTS idx_asm_audit_asm_id ON composite_assembly_audit(assembly_id);\n\n    -- Smart Selective / Incremental Sync State & Locks\n    CREATE TABLE IF NOT EXISTS sync_state (\n      module TEXT NOT NULL,                  -- 'sales_invoices', 'purchase_bills', 'customers', 'all'\n      scope_key TEXT NOT NULL,               -- 'all', 'FY_2025-26', 'FY_2026-27', 'customer:<ID>', etc.\n      last_successful_sync_at TEXT,\n      last_remote_modified_time TEXT,\n      last_document_date TEXT,\n      last_page INTEGER DEFAULT 1,\n      status TEXT DEFAULT 'IDLE',           -- 'IDLE', 'RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL'\n      records_checked INTEGER DEFAULT 0,\n      records_changed INTEGER DEFAULT 0,\n      records_skipped INTEGER DEFAULT 0,\n      api_calls_used INTEGER DEFAULT 0,\n      last_attempt_at TEXT,\n      last_error TEXT,\n      PRIMARY KEY (module, scope_key)\n    );\n    CREATE INDEX IF NOT EXISTS idx_sync_state_mod ON sync_state(module);\n\n    CREATE TABLE IF NOT EXISTS sync_locks (\n      lock_key TEXT PRIMARY KEY,\n      locked_at TEXT NOT NULL,\n      locked_by TEXT,\n      expires_at TEXT NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS document_sync_fingerprints (\n      document_type TEXT NOT NULL,           -- 'INVOICE' | 'BILL'\n      document_id TEXT NOT NULL,\n      last_modified_time TEXT,\n      content_fingerprint TEXT NOT NULL,\n      last_synced_at TEXT NOT NULL,\n      PRIMARY KEY (document_type, document_id)\n    );\n    CREATE INDEX IF NOT EXISTS idx_doc_fingerprint_mod ON document_sync_fingerprints(last_modified_time);\n\n    -- Activity-Driven Sync Checkpoints & API Usage Tracking\n    CREATE TABLE IF NOT EXISTS activity_sync_checkpoints (\n      checkpoint_key TEXT PRIMARY KEY,\n      last_activity_sync_at TEXT,\n      last_activity_event_id TEXT,\n      last_activity_event_time TEXT,\n      last_successful_sync_at TEXT,\n      updated_at TEXT NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS zoho_api_usage_cache (\n      id TEXT PRIMARY KEY,\n      daily_limit INTEGER NOT NULL,\n      used_today INTEGER NOT NULL,\n      remaining INTEGER NOT NULL,\n      usage_percentage REAL NOT NULL,\n      reset_time TEXT,\n      updated_at TEXT NOT NULL\n    );\n\n    -- Zoho Activity durable month-wise backfill: resumable job + per-window progress.\n    -- Dedicated tables (not the shared sync_state/sync_locks used by bills/invoices)\n    -- so this backfill cannot interfere with other modules' sync bookkeeping.\n    CREATE TABLE IF NOT EXISTS activity_backfill_jobs (\n      job_id TEXT PRIMARY KEY,\n      organization_id TEXT NOT NULL,\n      financial_year TEXT NOT NULL,\n      requested_from_date TEXT NOT NULL,\n      requested_to_date TEXT NOT NULL,\n      status TEXT NOT NULL DEFAULT 'PENDING',\n      created_at TEXT NOT NULL,\n      updated_at TEXT NOT NULL,\n      last_error TEXT\n    );\n    CREATE INDEX IF NOT EXISTS idx_activity_backfill_jobs_org ON activity_backfill_jobs(organization_id);\n    CREATE INDEX IF NOT EXISTS idx_activity_backfill_jobs_status ON activity_backfill_jobs(status);\n\n    CREATE TABLE IF NOT EXISTS activity_backfill_windows (\n      job_id TEXT NOT NULL,\n      window_from TEXT NOT NULL,\n      window_to TEXT NOT NULL,\n      window_order INTEGER NOT NULL DEFAULT 0,\n      status TEXT NOT NULL DEFAULT 'PENDING',\n      next_page INTEGER NOT NULL DEFAULT 1,\n      page_size INTEGER NOT NULL DEFAULT 200,\n      last_page_fingerprint TEXT,\n      records_seen INTEGER NOT NULL DEFAULT 0,\n      records_new INTEGER NOT NULL DEFAULT 0,\n      records_updated INTEGER NOT NULL DEFAULT 0,\n      out_of_window_count INTEGER NOT NULL DEFAULT 0,\n      api_calls_used INTEGER NOT NULL DEFAULT 0,\n      last_attempt_at TEXT,\n      completed_at TEXT,\n      last_error TEXT,\n      PRIMARY KEY (job_id, window_from, window_to)\n    );\n    CREATE INDEX IF NOT EXISTS idx_activity_backfill_windows_job ON activity_backfill_windows(job_id);\n\n    -- Seed default feature settings if empty\n    INSERT OR IGNORE INTO app_feature_settings (feature_key, enabled, updated_at, updated_by) VALUES\n      ('module_dashboard', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('module_reconciliation', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('module_transactions', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('module_services', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('module_customers', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('module_reports', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('module_zoho_activity', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('module_data_quality', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('module_validation_report', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('module_exclusion_management', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('module_export', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('module_ai_insights', 0, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_recon_master', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_recon_balance', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_recon_yet_to_purchase', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_recon_yet_to_sale', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_recon_purchase_only', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_recon_sale_only', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_recon_reconciled', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_recon_customer_missing', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_recon_excluded_items', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_recon_composite_assembly', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_trans_purchase_bills', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_trans_sales_invoices', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_trans_transaction_detail', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_trans_zoho_activity', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_svc_summary', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_svc_purchases', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_svc_sales', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_svc_transactions', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_svc_reconciliation', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_cust_customer_details', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_cust_action_taken', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_rep_recon_summary', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_rep_customer_wise', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_rep_breakdown', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_rep_price_reference', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_rep_data_quality', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_rep_validation', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sub_rep_customer_material', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sync_smart_enabled', 1, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sync_stale_warning_hours', 24, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sync_auto_on_page_open', 0, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      ('sync_historical_rescan', 0, '2026-09-11T00:00:00.000Z', 'SYSTEM'),\n      -- Milestone A: Reconciliation & Audit workspace shell + Settings > Skills.\n      -- New additive keys only \u2014 no existing key above is touched.\n      ('module_audit_workspace', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('sub_audit_workspaces', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('sub_audit_uploads', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('sub_audit_match_review', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('sub_audit_findings', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('sub_audit_reports', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('sub_settings_skills', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      -- Milestone C feature-control gap fix: Settings > Feature Controls >\n      -- Reconciliation & Audit Modules. New additive keys only \u2014 no\n      -- existing key above is touched or renamed. See\n      -- app/lib/audit/feature-registry.ts for the full registry\n      -- (parent/child relationships, labels, implementation status).\n      ('audit_feat_pdf_intake', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_xlsx_intake', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_csv_intake', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_zoho_sources', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_source_mapping', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_completeness_controls', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_evidence_drillback', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_frozen_snapshots', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_exact_matching', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_date_reference_checks', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_amount_currency_checks', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_quantity_unit_checks', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_grouped_one_to_many', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_grouped_many_to_one', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_partial_matching', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_ambiguous_review', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_unmatched_left_right', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_multi_source_verification', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_reviewer_decisions', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      -- Project-wide Feature Controls pass: closes gaps found while\n      -- inventorying existing navigation (module_inventory/sub_inv_stock\n      -- were referenced by Sidebar.tsx's featureKey but never had a seed\n      -- row at all; sub_cust_action_taken and sub_rep_customer_material\n      -- were live nav items with no corresponding Settings toggle) plus\n      -- two new explicit action-level controls the owner requested\n      -- (Zoho manual sync, Zoho activity backfill). All additive, all\n      -- default ON (preserves existing behavior).\n      ('module_inventory', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('sub_inv_stock', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('sub_cust_action_taken', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('sub_rep_customer_material', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('action_zoho_manual_sync', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('action_zoho_activity_backfill', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('settings_sync_page', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('settings_modules_page', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('settings_security_page', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      -- Milestone D: Domain Review + Findings + Action Taken + Reviewer\n      -- Sign-off + Review Reports + Excel/PDF Export. sub_audit_findings\n      -- and sub_audit_reports already had seed rows above (added ahead of\n      -- this milestone as NOT_IMPLEMENTED placeholders); only their\n      -- implementation_status flips in feature-registry.ts, no new seed\n      -- row needed for those two. New additive child keys only.\n      ('audit_feat_domain_review', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_coverage_matrix', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_findings_register', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_action_taken', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_reviewer_signoff', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_findings_evidence_drillback', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_report_field_selector', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_excel_export', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_pdf_export', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      -- Milestone E: Controlled Learning \u2014 governed, versioned rule\n      -- proposals, SUGGEST_ONLY by default, never auto-activated.\n      ('sub_audit_learning', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_learning_proposals', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_learning_unsupported_case_review', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_learning_one_time_overrides', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_learning_rule_testing', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_learning_rule_approval', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_learning_rule_disable', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_learning_rule_rollback', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_learning_rule_conflict_review', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_learning_rule_expiry_review', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM'),\n      ('audit_feat_release_readiness', 1, '2026-09-14T00:00:00.000Z', 'SYSTEM');\n  ");
    // Migration: Add columns if existing DB was created with older schema
    try {
        db.exec("ALTER TABLE sales_invoices ADD COLUMN source TEXT DEFAULT 'ZOHO_BOOKS';");
    }
    catch (_a) { }
    try {
        db.exec("ALTER TABLE sales_invoices ADD COLUMN content_fingerprint TEXT;");
    }
    catch (_b) { }
    try {
        db.exec("ALTER TABLE sales_invoice_line_items ADD COLUMN source TEXT DEFAULT 'ZOHO_BOOKS';");
    }
    catch (_c) { }
    try {
        db.exec("ALTER TABLE sales_invoice_line_items ADD COLUMN description TEXT;");
    }
    catch (_d) { }
    try {
        db.exec("ALTER TABLE purchase_bills ADD COLUMN source TEXT DEFAULT 'ZOHO_BOOKS';");
    }
    catch (_e) { }
    try {
        db.exec("ALTER TABLE purchase_bills ADD COLUMN content_fingerprint TEXT;");
    }
    catch (_f) { }
    try {
        db.exec("ALTER TABLE purchase_bill_line_items ADD COLUMN source TEXT DEFAULT 'ZOHO_BOOKS';");
    }
    catch (_g) { }
    try {
        db.exec("ALTER TABLE purchase_bill_line_items ADD COLUMN purchase_line_customer_id TEXT;");
    }
    catch (_h) { }
    try {
        db.exec("ALTER TABLE purchase_bill_line_items ADD COLUMN purchase_line_customer_name TEXT;");
    }
    catch (_j) { }
    // Zoho Activity Logs Schema Extension Migrations
    try {
        db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN module_source TEXT DEFAULT 'STRUCTURED';");
    }
    catch (_k) { }
    try {
        db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN reference_type TEXT;");
    }
    catch (_l) { }
    try {
        db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN reference_id TEXT;");
    }
    catch (_m) { }
    try {
        db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN reference_number TEXT;");
    }
    catch (_o) { }
    try {
        db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN linked_bill_id TEXT;");
    }
    catch (_p) { }
    try {
        db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN linked_invoice_id TEXT;");
    }
    catch (_q) { }
    try {
        db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN raw_payload_json TEXT;");
    }
    catch (_r) { }
    try {
        db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN detail_party_name TEXT;");
    }
    catch (_s) { }
    try {
        db.exec("ALTER TABLE zoho_activity_logs ADD COLUMN detail_party_id TEXT;");
    }
    catch (_t) { }
    try {
        db.exec("CREATE INDEX IF NOT EXISTS idx_activity_logs_ref_num ON zoho_activity_logs(reference_number);");
    }
    catch (_u) { }
    try {
        db.exec("CREATE INDEX IF NOT EXISTS idx_activity_logs_linked_bill ON zoho_activity_logs(linked_bill_id);");
    }
    catch (_v) { }
    try {
        db.exec("CREATE INDEX IF NOT EXISTS idx_activity_logs_linked_inv ON zoho_activity_logs(linked_invoice_id);");
    }
    catch (_w) { }
    seedInitialDataIfEmpty(db);
}
/**
 * Seeds initial verified baseline data into SQLite if the database is empty.
 * This guarantees offline operability and validation case consistency on first launch.
 */
function seedInitialDataIfEmpty(db) {
    var row = db.prepare("SELECT COUNT(*) as cnt FROM sales_invoices").get();
    if (row && row.cnt > 0)
        return;
    var now = new Date().toISOString();
    var ZOHO_BASE_URL = "https://books.bansilengineers.com/app/774390949";
    var orgId = "774390949";
    // Organization
    db.prepare("\n    INSERT OR REPLACE INTO organizations (organization_id, name, currency_symbol, created_time)\n    VALUES (?, ?, ?, ?)\n  ").run(orgId, "BANSIL ENGINEERS", "₹", now);
    // Real Verified Invoice INV-2526163
    db.prepare("\n    INSERT OR REPLACE INTO sales_invoices \n    (invoice_id, organization_id, invoice_number, date, due_date, customer_id, customer_name, reference_number, status, total, balance, invoice_url, is_verified_link, created_time, last_modified_time, source, synced_at)\n    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)\n  ").run("3166667000010979580", orgId, "INV-2526163", "2025-09-08", "2025-10-08", "3166667000009883071", "LANTEC INDUSTRIES PRIVATE LIMITED", "PO-LANTEC-2526", "PAID", 2077460.8, 0, "".concat(ZOHO_BASE_URL, "#/invoices/3166667000010979580"), 1, "2025-09-08T10:00:00Z", "2025-09-08T10:00:00Z", now);
    // Real Invoice Lines (4 BBT lines)
    var invLines = [
        { id: "3166667000010979590", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 2, rate: 28500, total: 57000 },
        { id: "3166667000010979593", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 38, rate: 30870, total: 1173060 },
        { id: "3166667000010979596", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 14, rate: 33400, total: 467600 },
        { id: "3166667000010979599", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 1, rate: 62900, total: 62900 },
    ];
    for (var _i = 0, invLines_1 = invLines; _i < invLines_1.length; _i++) {
        var line = invLines_1[_i];
        db.prepare("\n      INSERT OR REPLACE INTO sales_invoice_line_items\n      (line_item_id, invoice_id, item_id, item_name, sku, quantity, rate, line_total, bbt_customer_id, bbt_customer_name, source, synced_at)\n      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)\n    ").run(line.id, "3166667000010979580", line.itemId, line.name, "", line.qty, line.rate, line.total, "3166667000009883071", "LANTEC INDUSTRIES PRIVATE LIMITED", now);
    }
    // Real Verified Bill AA2450002266
    db.prepare("\n    INSERT OR REPLACE INTO purchase_bills\n    (bill_id, organization_id, bill_number, date, due_date, vendor_id, vendor_name, reference_number, status, total, balance, bill_url, is_verified_link, created_time, last_modified_time, source, synced_at)\n    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)\n  ").run("3166667000011037234", orgId, "AA2450002266", "2025-09-08", "2025-10-08", "vend_schneider_gj", "SCHNEIDER ELECTRIC INDIA PVT.LTD. - GJ", "PO-BBT-2266", "PAID", 1643123.22, 0, "".concat(ZOHO_BASE_URL, "#/bills/3166667000011037234"), 1, "2025-09-08T09:00:00Z", "2025-09-08T09:00:00Z", now);
    // Real Bill Lines (4 BBT Tap Off Box lines + 1 End Cover line)
    var billLines = [
        { id: "3166667000011037240", itemId: "3166667000000170375", name: "BBT End cover for bus bar", qty: 2, rate: 2903, total: 5806, desc: "End Closure 2000A, AL, IP54, Class F" },
        { id: "3166667000011037242", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 14, rate: 31062, total: 434868, desc: "125-250A PIU (w/o 3-Pole breaker) with 250A MCCB- 3P" },
        { id: "3166667000011037244", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 38, rate: 28709, total: 1090942, desc: "125-250A PIU (w/o 3-Pole breaker) with 160A MCCB- 3P" },
        { id: "3166667000011037246", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 1, rate: 58497.22, total: 58497.22, desc: "400-500A PIU (w/o 3-Pole breaker) with 400A MCCB- 3P" },
        { id: "3166667000011037248", itemId: "3166667000000170366", name: "BBT Tap Off Box (Bus Plug)", qty: 2, rate: 26505, total: 53010, desc: "16-100A PIU (w/o 3-Pole breaker) with 100A MCCB- 3P" },
    ];
    for (var _a = 0, billLines_1 = billLines; _a < billLines_1.length; _a++) {
        var line = billLines_1[_a];
        db.prepare("\n      INSERT OR REPLACE INTO purchase_bill_line_items\n      (line_item_id, bill_id, item_id, item_name, sku, quantity, rate, line_total, bbt_customer_id, bbt_customer_name, description, customer_data_status, source, synced_at)\n      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', 'ZOHO_BOOKS', ?)\n    ").run(line.id, "3166667000011037234", line.itemId, line.name, "", line.qty, line.rate, line.total, "3166667000009883071", "LANTEC INDUSTRIES PRIVATE LIMITED", line.desc, now);
    }
    // Set initial sync metadata
    setSyncMetadata(db, "last_successful_sync_time", "2026-09-10T18:30:00Z");
    setSyncMetadata(db, "last_attempted_sync_time", "2026-09-10T18:30:00Z");
    setSyncMetadata(db, "last_sync_status", "SUCCESS");
    setSyncMetadata(db, "api_calls_today", "0");
    setSyncMetadata(db, "last_sync_api_calls", "0");
}
function getSyncMetadata(db, key) {
    var row = db.prepare("SELECT value FROM sync_metadata WHERE key = ?").get(key);
    return row ? row.value : null;
}
function setSyncMetadata(db, key, value) {
    var now = new Date().toISOString();
    db.prepare("\n    INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)\n    VALUES (?, ?, ?)\n  ").run(key, value, now);
}
/**
 * Returns the latest transaction/document date present in synchronized data (YYYY-MM-DD).
 */
function getLatestSyncedDocumentDate(db) {
    try {
        var row = db.prepare("\n      SELECT MAX(latest_date) as max_date FROM (\n        SELECT MAX(date) as latest_date FROM sales_invoices WHERE status != 'VOID'\n        UNION ALL\n        SELECT MAX(date) as latest_date FROM purchase_bills WHERE status != 'VOID'\n      )\n    ").get();
        return (row === null || row === void 0 ? void 0 : row.max_date) || new Date().toISOString().slice(0, 10);
    }
    catch (_a) {
        return new Date().toISOString().slice(0, 10);
    }
}
function recordApiCall(db) {
    var today = new Date().toISOString().slice(0, 10);
    db.prepare("\n    INSERT INTO api_call_counter (date, call_count)\n    VALUES (?, 1)\n    ON CONFLICT(date) DO UPDATE SET call_count = call_count + 1\n  ").run(today);
    // Also update total in metadata
    var row = db.prepare("SELECT call_count FROM api_call_counter WHERE date = ?").get(today);
    if (row) {
        setSyncMetadata(db, "api_calls_today", String(row.call_count));
    }
}
function getApiCallStats(db) {
    var today = new Date().toISOString().slice(0, 10);
    var row = db.prepare("SELECT call_count FROM api_call_counter WHERE date = ?").get(today);
    var lastSyncStr = getSyncMetadata(db, "last_sync_api_calls") || "0";
    return {
        today: row ? row.call_count : 0,
        lastSync: parseInt(lastSyncStr, 10) || 0,
    };
}
function recordSyncLog(db, log) {
    db.prepare("\n    INSERT OR REPLACE INTO sync_logs\n    (sync_id, start_time, end_time, sync_type, invoices_checked, invoices_added, invoices_updated, invoice_lines_synced, bills_checked, bills_added, bills_updated, bill_lines_synced, unchanged_records, exceptions_count, api_calls, status, errors)\n    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n  ").run(log.syncId, log.startTime, log.endTime, log.syncType, log.invoicesChecked, log.invoicesAdded, log.invoicesUpdated, log.invoiceLinesSynced, log.billsChecked, log.billsAdded, log.billsUpdated, log.billLinesSynced, log.unchangedRecords, log.exceptionsCount, log.apiCalls, log.status, log.errors || null);
    setSyncMetadata(db, "last_sync_api_calls", String(log.apiCalls));
}
function getRecentSyncLogs(db, limit) {
    if (limit === void 0) { limit = 10; }
    return db.prepare("SELECT * FROM sync_logs ORDER BY start_time DESC LIMIT ?").all(limit);
}
function getSyncCoverage(db, financialYear) {
    var row = db.prepare("\n    SELECT financial_year, from_date, to_date, full_backfill_completed,\n           invoice_list_pages, invoices_found, invoices_synced,\n           bill_list_pages, bills_found, bills_synced,\n           started_at, completed_at, status, error\n    FROM sync_coverage\n    WHERE financial_year = ?\n  ").get(financialYear);
    if (!row)
        return null;
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
function recordSyncCoverage(db, record) {
    db.prepare("\n    INSERT INTO sync_coverage\n    (financial_year, from_date, to_date, full_backfill_completed,\n     invoice_list_pages, invoices_found, invoices_synced,\n     bill_list_pages, bills_found, bills_synced,\n     started_at, completed_at, status, error)\n    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n    ON CONFLICT(financial_year) DO UPDATE SET\n      from_date = excluded.from_date,\n      to_date = excluded.to_date,\n      full_backfill_completed = excluded.full_backfill_completed,\n      invoice_list_pages = excluded.invoice_list_pages,\n      invoices_found = excluded.invoices_found,\n      invoices_synced = excluded.invoices_synced,\n      bill_list_pages = excluded.bill_list_pages,\n      bills_found = excluded.bills_found,\n      bills_synced = excluded.bills_synced,\n      started_at = excluded.started_at,\n      completed_at = excluded.completed_at,\n      status = excluded.status,\n      error = excluded.error\n  ").run(record.financialYear, record.fromDate, record.toDate, record.fullBackfillCompleted ? 1 : 0, record.invoiceListPages, record.invoicesFound, record.invoicesSynced, record.billListPages, record.billsFound, record.billsSynced, record.startedAt, record.completedAt || null, record.status, record.error || null);
    if (record.fullBackfillCompleted) {
        setSyncMetadata(db, "coverage_".concat(record.financialYear, "_completed"), "true");
    }
}
function isFullBackfillCompleted(db, financialYear) {
    var normalizedFy = financialYear.startsWith("FY ") ? financialYear : "FY ".concat(financialYear);
    var rawFy = financialYear.replace(/^FY\s*/, "");
    var meta1 = getSyncMetadata(db, "coverage_".concat(normalizedFy, "_completed"));
    var meta2 = getSyncMetadata(db, "coverage_".concat(rawFy, "_completed"));
    if (meta1 === "true" || meta2 === "true")
        return true;
    var cov1 = getSyncCoverage(db, normalizedFy);
    var cov2 = getSyncCoverage(db, rawFy);
    return Boolean((cov1 === null || cov1 === void 0 ? void 0 : cov1.fullBackfillCompleted) || (cov2 === null || cov2 === void 0 ? void 0 : cov2.fullBackfillCompleted));
}
function getAllDistinctVendors(db) {
    var rows = db.prepare("\n    SELECT DISTINCT vendor_name\n    FROM purchase_bills\n    WHERE vendor_name IS NOT NULL AND TRIM(vendor_name) != ''\n    ORDER BY vendor_name ASC\n  ").all();
    return rows.map(function (r) { return r.vendor_name; });
}
function getAllClassifications(db) {
    var conn = db || getDatabase();
    return conn.prepare("\n    SELECT * FROM analytics_classifications\n    WHERE is_active = 1\n    ORDER BY created_at DESC\n  ").all();
}
function getClassifiedServiceItemIds(db) {
    var conn = db || getDatabase();
    var rows = conn.prepare("\n    SELECT item_id, item_name FROM analytics_classifications\n    WHERE classification = 'SERVICE' AND is_active = 1\n  ").all();
    var set = new Set();
    for (var _i = 0, rows_1 = rows; _i < rows_1.length; _i++) {
        var r = rows_1[_i];
        if (r.item_id)
            set.add(r.item_id);
        if (r.item_name)
            set.add(r.item_name.toUpperCase().trim());
    }
    return set;
}
function getItemClassification(dbOrItemId, itemIdOrName, itemName) {
    var conn;
    var itId;
    var itName;
    if (typeof dbOrItemId === "string" || dbOrItemId === null) {
        conn = getDatabase();
        itId = dbOrItemId;
        itName = itemIdOrName;
    }
    else if (dbOrItemId && typeof dbOrItemId.prepare === "function") {
        conn = dbOrItemId;
        itId = itemIdOrName;
        itName = itemName;
    }
    else {
        conn = getDatabase();
        itId = itemIdOrName;
        itName = itemName;
    }
    if (itId) {
        var row = conn.prepare("\n      SELECT classification FROM analytics_classifications\n      WHERE item_id = ? AND is_active = 1\n    ").get(itId);
        if (row)
            return row.classification;
    }
    if (itName) {
        var row = conn.prepare("\n      SELECT classification FROM analytics_classifications\n      WHERE UPPER(TRIM(item_name)) = ? AND is_active = 1\n    ").get(itName.toUpperCase().trim());
        if (row)
            return row.classification;
    }
    return "MATERIAL";
}
function saveClassification(db, record) {
    var _a;
    var conn = db || getDatabase();
    var now = new Date().toISOString();
    conn.prepare("\n    INSERT INTO analytics_classifications (\n      id, source_type, item_id, item_name, account_id, account_name,\n      classification, is_active, approved_by, approved_at, created_at, updated_at\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n    ON CONFLICT(id) DO UPDATE SET\n      source_type = excluded.source_type,\n      item_id = excluded.item_id,\n      item_name = excluded.item_name,\n      account_id = excluded.account_id,\n      account_name = excluded.account_name,\n      classification = excluded.classification,\n      is_active = excluded.is_active,\n      approved_by = excluded.approved_by,\n      approved_at = excluded.approved_at,\n      updated_at = excluded.updated_at\n  ").run(record.id, record.source_type, record.item_id || null, record.item_name || null, record.account_id || null, record.account_name || null, record.classification, (_a = record.is_active) !== null && _a !== void 0 ? _a : 1, record.approved_by || null, record.approved_at || null, now, now);
}
function getFeatureSettings(db) {
    var conn = db || getDatabase();
    try {
        var rows = conn.prepare("\n      SELECT feature_key, enabled FROM app_feature_settings\n    ").all();
        var result = {};
        for (var _i = 0, rows_2 = rows; _i < rows_2.length; _i++) {
            var r = rows_2[_i];
            result[r.feature_key] = Boolean(r.enabled);
        }
        return result;
    }
    catch (_a) {
        return {};
    }
}
function updateFeatureSetting(db, key, enabled, updatedBy) {
    if (updatedBy === void 0) { updatedBy = "OWNER"; }
    var conn = db || getDatabase();
    var now = new Date().toISOString();
    conn.prepare("\n    INSERT INTO app_feature_settings (feature_key, enabled, updated_at, updated_by)\n    VALUES (?, ?, ?, ?)\n    ON CONFLICT(feature_key) DO UPDATE SET\n      enabled = excluded.enabled,\n      updated_at = excluded.updated_at,\n      updated_by = excluded.updated_by\n  ").run(key, enabled ? 1 : 0, now, updatedBy);
}
function updateFeatureSettings(db, settings, updatedBy) {
    if (updatedBy === void 0) { updatedBy = "OWNER"; }
    var conn = db || getDatabase();
    var now = new Date().toISOString();
    var stmt = conn.prepare("\n    INSERT INTO app_feature_settings (feature_key, enabled, updated_at, updated_by)\n    VALUES (?, ?, ?, ?)\n    ON CONFLICT(feature_key) DO UPDATE SET\n      enabled = excluded.enabled,\n      updated_at = excluded.updated_at,\n      updated_by = excluded.updated_by\n  ");
    for (var _i = 0, _a = Object.entries(settings); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], enabled = _b[1];
        stmt.run(key, enabled ? 1 : 0, now, updatedBy);
    }
}
function getActiveExclusions(db) {
    var conn = db || getDatabase();
    try {
        return conn.prepare("\n      SELECT exclusion_id, customer_id, customer_name, item_id, item_name, sku, financial_year, status\n      FROM reconciliation_exclusions\n      WHERE status = 'ACTIVE'\n    ").all();
    }
    catch (_a) {
        return [];
    }
}
function getActiveExcludedItemIds(db) {
    var conn = db || getDatabase();
    try {
        var rows = conn.prepare("\n      SELECT item_id, item_name\n      FROM reconciliation_exclusions\n      WHERE status = 'ACTIVE' AND item_id IS NOT NULL AND TRIM(item_id) != ''\n    ").all();
        var set = new Set();
        for (var _i = 0, rows_3 = rows; _i < rows_3.length; _i++) {
            var r = rows_3[_i];
            if (r.item_id && r.item_id.trim())
                set.add(r.item_id.trim());
        }
        return set;
    }
    catch (_a) {
        return new Set();
    }
}
function isItemExcluded(param1, param2, param3, param4) {
    var db;
    var itemId;
    var customerId;
    var financialYear;
    if (param1 && typeof param1.prepare === "function") {
        db = param1;
        itemId = param2;
        customerId = param3;
        financialYear = param4;
    }
    else {
        itemId = param1;
        customerId = param2;
        financialYear = param3;
    }
    if (!itemId && !customerId)
        return false;
    var exclusions = getActiveExclusions(db);
    return exclusions.some(function (ex) {
        var hasExclItem = Boolean(ex.item_id && ex.item_id.trim() !== '');
        var matchItem = hasExclItem ? Boolean(itemId && ex.item_id && ex.item_id.trim() === itemId.trim()) : false;
        var matchCust = !ex.customer_id || (customerId && ex.customer_id === customerId);
        var matchFy = !ex.financial_year || ex.financial_year === 'ALL' || (financialYear && ex.financial_year === financialYear);
        return Boolean(matchItem && matchCust && matchFy);
    });
}
function getSyncState(db, module, scopeKey) {
    if (scopeKey === void 0) { scopeKey = "all"; }
    try {
        var row = db.prepare("\n      SELECT module, scope_key, last_successful_sync_at, last_remote_modified_time,\n             last_document_date, last_page, status, records_checked, records_changed,\n             records_skipped, api_calls_used, last_attempt_at, last_error\n      FROM sync_state\n      WHERE module = ? AND scope_key = ?\n    ").get(module, scopeKey);
        return row || null;
    }
    catch (_a) {
        return null;
    }
}
function getAllSyncStates(db) {
    try {
        return db.prepare("\n      SELECT module, scope_key, last_successful_sync_at, last_remote_modified_time,\n             last_document_date, last_page, status, records_checked, records_changed,\n             records_skipped, api_calls_used, last_attempt_at, last_error\n      FROM sync_state\n      ORDER BY module ASC, scope_key ASC\n    ").all();
    }
    catch (_a) {
        return [];
    }
}
function setSyncState(db, record) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    var existing = getSyncState(db, record.module, record.scope_key);
    var updated = {
        module: record.module,
        scope_key: record.scope_key,
        last_successful_sync_at: record.last_successful_sync_at !== undefined ? record.last_successful_sync_at : ((_a = existing === null || existing === void 0 ? void 0 : existing.last_successful_sync_at) !== null && _a !== void 0 ? _a : null),
        last_remote_modified_time: record.last_remote_modified_time !== undefined ? record.last_remote_modified_time : ((_b = existing === null || existing === void 0 ? void 0 : existing.last_remote_modified_time) !== null && _b !== void 0 ? _b : null),
        last_document_date: record.last_document_date !== undefined ? record.last_document_date : ((_c = existing === null || existing === void 0 ? void 0 : existing.last_document_date) !== null && _c !== void 0 ? _c : null),
        last_page: record.last_page !== undefined ? record.last_page : ((_d = existing === null || existing === void 0 ? void 0 : existing.last_page) !== null && _d !== void 0 ? _d : 1),
        status: record.status || (existing === null || existing === void 0 ? void 0 : existing.status) || "IDLE",
        records_checked: record.records_checked !== undefined ? record.records_checked : ((_e = existing === null || existing === void 0 ? void 0 : existing.records_checked) !== null && _e !== void 0 ? _e : 0),
        records_changed: record.records_changed !== undefined ? record.records_changed : ((_f = existing === null || existing === void 0 ? void 0 : existing.records_changed) !== null && _f !== void 0 ? _f : 0),
        records_skipped: record.records_skipped !== undefined ? record.records_skipped : ((_g = existing === null || existing === void 0 ? void 0 : existing.records_skipped) !== null && _g !== void 0 ? _g : 0),
        api_calls_used: record.api_calls_used !== undefined ? record.api_calls_used : ((_h = existing === null || existing === void 0 ? void 0 : existing.api_calls_used) !== null && _h !== void 0 ? _h : 0),
        last_attempt_at: record.last_attempt_at !== undefined ? record.last_attempt_at : ((_j = existing === null || existing === void 0 ? void 0 : existing.last_attempt_at) !== null && _j !== void 0 ? _j : null),
        last_error: record.last_error !== undefined ? record.last_error : ((_k = existing === null || existing === void 0 ? void 0 : existing.last_error) !== null && _k !== void 0 ? _k : null),
    };
    db.prepare("\n    INSERT INTO sync_state (\n      module, scope_key, last_successful_sync_at, last_remote_modified_time,\n      last_document_date, last_page, status, records_checked, records_changed,\n      records_skipped, api_calls_used, last_attempt_at, last_error\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n    ON CONFLICT(module, scope_key) DO UPDATE SET\n      last_successful_sync_at = excluded.last_successful_sync_at,\n      last_remote_modified_time = excluded.last_remote_modified_time,\n      last_document_date = excluded.last_document_date,\n      last_page = excluded.last_page,\n      status = excluded.status,\n      records_checked = excluded.records_checked,\n      records_changed = excluded.records_changed,\n      records_skipped = excluded.records_skipped,\n      api_calls_used = excluded.api_calls_used,\n      last_attempt_at = excluded.last_attempt_at,\n      last_error = excluded.last_error\n  ").run(updated.module, updated.scope_key, updated.last_successful_sync_at, updated.last_remote_modified_time, updated.last_document_date, updated.last_page, updated.status, updated.records_checked, updated.records_changed, updated.records_skipped, updated.api_calls_used, updated.last_attempt_at, updated.last_error);
}
function acquireSyncLock(db, lockKey, timeoutMs, lockedBy) {
    if (timeoutMs === void 0) { timeoutMs = 60000; }
    if (lockedBy === void 0) { lockedBy = "user"; }
    try {
        var nowIso = new Date().toISOString();
        // Clean up expired locks first
        db.prepare("DELETE FROM sync_locks WHERE expires_at <= ?").run(nowIso);
        var expiresAt = new Date(Date.now() + timeoutMs).toISOString();
        var res = db.prepare("\n      INSERT INTO sync_locks (lock_key, locked_at, locked_by, expires_at)\n      VALUES (?, ?, ?, ?)\n      ON CONFLICT(lock_key) DO NOTHING\n    ").run(lockKey, nowIso, lockedBy, expiresAt);
        return res.changes > 0;
    }
    catch (_a) {
        return false;
    }
}
function releaseSyncLock(db, lockKey) {
    try {
        db.prepare("DELETE FROM sync_locks WHERE lock_key = ?").run(lockKey);
    }
    catch (_a) {
        // ignore
    }
}
/**
 * Finds an existing job for this org+date-range that isn't finished, so a resume
 * continues real progress instead of restarting. Returns null if none exists (a new
 * job should be created) or if the only matching job already COMPLETEd.
 */
function findResumableActivityBackfillJob(db, organizationId, fromDate, toDate) {
    // Deliberately NOT filtered by status: the job_id for a given org+range is
    // deterministic (one job per range), so the existing row — whatever its status —
    // is always the one to reuse. A COMPLETE job whose window was later reset (e.g. an
    // explicit re-verification) must still be found here rather than colliding with a
    // fresh INSERT attempt for the same job_id.
    var row = db.prepare("\n    SELECT * FROM activity_backfill_jobs\n    WHERE organization_id = ? AND requested_from_date = ? AND requested_to_date = ?\n    ORDER BY created_at DESC LIMIT 1\n  ").get(organizationId, fromDate, toDate);
    return row || null;
}
function createActivityBackfillJob(db, job) {
    var now = new Date().toISOString();
    // ON CONFLICT DO NOTHING: defensive idempotency. The caller (runActivityBackfill)
    // always checks findResumableActivityBackfillJob first, so this should never fire
    // in practice — but guarding it directly means a duplicate-create attempt reuses
    // the existing job instead of throwing.
    db.prepare("\n    INSERT INTO activity_backfill_jobs\n    (job_id, organization_id, financial_year, requested_from_date, requested_to_date, status, created_at, updated_at, last_error)\n    VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, NULL)\n    ON CONFLICT(job_id) DO NOTHING\n  ").run(job.jobId, job.organizationId, job.financialYear, job.fromDate, job.toDate, now, now);
    var insertWindow = db.prepare("\n    INSERT INTO activity_backfill_windows\n    (job_id, window_from, window_to, window_order, status, next_page, page_size)\n    VALUES (?, ?, ?, ?, 'PENDING', 1, 200)\n    ON CONFLICT(job_id, window_from, window_to) DO NOTHING\n  ");
    job.windows.forEach(function (w, idx) { return insertWindow.run(job.jobId, w.from, w.to, idx); });
}
function getActivityBackfillJob(db, jobId) {
    var row = db.prepare("SELECT * FROM activity_backfill_jobs WHERE job_id = ?").get(jobId);
    return row || null;
}
function getActivityBackfillWindows(db, jobId) {
    return db.prepare("\n    SELECT * FROM activity_backfill_windows WHERE job_id = ? ORDER BY window_order ASC\n  ").all(jobId);
}
function setActivityBackfillJobStatus(db, jobId, status, lastError) {
    db.prepare("\n    UPDATE activity_backfill_jobs SET status = ?, updated_at = ?, last_error = ? WHERE job_id = ?\n  ").run(status, new Date().toISOString(), lastError !== null && lastError !== void 0 ? lastError : null, jobId);
}
/**
 * Persists one window's progress after a single page fetch. Callers must invoke this
 * only AFTER the network response is already in hand — never while a request is
 * in-flight — so no DB transaction is ever held open across a network call.
 */
function recordActivityBackfillWindowProgress(db, jobId, windowFrom, windowTo, patch) {
    var _a;
    var now = new Date().toISOString();
    var sets = ["last_attempt_at = ?"];
    var params = [now];
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
    (_a = db.prepare("\n    UPDATE activity_backfill_windows SET ".concat(sets.join(", "), "\n    WHERE job_id = ? AND window_from = ? AND window_to = ?\n  "))).run.apply(_a, params);
}
function getDocumentSyncFingerprint(db, docType, docId) {
    try {
        var row = db.prepare("\n      SELECT last_modified_time, content_fingerprint\n      FROM document_sync_fingerprints\n      WHERE document_type = ? AND document_id = ?\n    ").get(docType, docId);
        return row || null;
    }
    catch (_a) {
        return null;
    }
}
function setDocumentSyncFingerprint(db, docType, docId, lastModifiedTime, contentFingerprint) {
    try {
        var now = new Date().toISOString();
        db.prepare("\n      INSERT INTO document_sync_fingerprints (document_type, document_id, last_modified_time, content_fingerprint, last_synced_at)\n      VALUES (?, ?, ?, ?, ?)\n      ON CONFLICT(document_type, document_id) DO UPDATE SET\n        last_modified_time = excluded.last_modified_time,\n        content_fingerprint = excluded.content_fingerprint,\n        last_synced_at = excluded.last_synced_at\n    ").run(docType, docId, lastModifiedTime || null, contentFingerprint, now);
    }
    catch (_a) {
        // ignore
    }
}
function getAllSyncCoverage(db) {
    try {
        var rows = db.prepare("\n      SELECT financial_year, from_date, to_date, full_backfill_completed,\n             invoice_list_pages, invoices_found, invoices_synced,\n             bill_list_pages, bills_found, bills_synced,\n             started_at, completed_at, status, error\n      FROM sync_coverage\n      ORDER BY from_date DESC\n    ").all();
        return rows.map(function (r) { return ({
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
        }); });
    }
    catch (_a) {
        return [];
    }
}
function getActivitySyncCheckpoint(db, key) {
    if (key === void 0) { key = "primary_activity_checkpoint"; }
    try {
        var row = db.prepare("\n      SELECT checkpoint_key, last_activity_sync_at, last_activity_event_id,\n             last_activity_event_time, last_successful_sync_at, updated_at\n      FROM activity_sync_checkpoints\n      WHERE checkpoint_key = ?\n    ").get(key);
        if (!row)
            return null;
        return {
            checkpointKey: row.checkpoint_key,
            lastActivitySyncAt: row.last_activity_sync_at,
            lastActivityEventId: row.last_activity_event_id,
            lastActivityEventTime: row.last_activity_event_time,
            lastSuccessfulSyncAt: row.last_successful_sync_at,
            updatedAt: row.updated_at,
        };
    }
    catch (_a) {
        return null;
    }
}
function setActivitySyncCheckpoint(db, data) {
    try {
        var key = data.key || "primary_activity_checkpoint";
        var now = new Date().toISOString();
        var existing = getActivitySyncCheckpoint(db, key);
        var lastActivitySyncAt = data.lastActivitySyncAt !== undefined ? data.lastActivitySyncAt : (existing === null || existing === void 0 ? void 0 : existing.lastActivitySyncAt) || null;
        var lastActivityEventId = data.lastActivityEventId !== undefined ? data.lastActivityEventId : (existing === null || existing === void 0 ? void 0 : existing.lastActivityEventId) || null;
        var lastActivityEventTime = data.lastActivityEventTime !== undefined ? data.lastActivityEventTime : (existing === null || existing === void 0 ? void 0 : existing.lastActivityEventTime) || null;
        var lastSuccessfulSyncAt = data.lastSuccessfulSyncAt !== undefined ? data.lastSuccessfulSyncAt : (existing === null || existing === void 0 ? void 0 : existing.lastSuccessfulSyncAt) || null;
        db.prepare("\n      INSERT INTO activity_sync_checkpoints\n      (checkpoint_key, last_activity_sync_at, last_activity_event_id, last_activity_event_time, last_successful_sync_at, updated_at)\n      VALUES (?, ?, ?, ?, ?, ?)\n      ON CONFLICT(checkpoint_key) DO UPDATE SET\n        last_activity_sync_at = excluded.last_activity_sync_at,\n        last_activity_event_id = excluded.last_activity_event_id,\n        last_activity_event_time = excluded.last_activity_event_time,\n        last_successful_sync_at = excluded.last_successful_sync_at,\n        updated_at = excluded.updated_at\n    ").run(key, lastActivitySyncAt, lastActivityEventId, lastActivityEventTime, lastSuccessfulSyncAt, now);
    }
    catch (err) {
        console.error("[Database] Failed to set activity checkpoint:", err);
    }
}
function getApiUsageCache(db, id) {
    if (id === void 0) { id = "current_usage"; }
    try {
        var row = db.prepare("\n      SELECT id, daily_limit, used_today, remaining, usage_percentage, reset_time, updated_at\n      FROM zoho_api_usage_cache\n      WHERE id = ?\n    ").get(id);
        if (!row)
            return null;
        return {
            id: row.id,
            dailyLimit: row.daily_limit,
            usedToday: row.used_today,
            remaining: row.remaining,
            usagePercentage: row.usage_percentage,
            resetTime: row.reset_time,
            updatedAt: row.updated_at,
        };
    }
    catch (_a) {
        return null;
    }
}
function setApiUsageCache(db, data) {
    try {
        var id = data.id || "current_usage";
        var now = new Date().toISOString();
        var limit = Math.max(1, data.dailyLimit || 10000);
        var used = Math.max(0, data.usedToday || 0);
        var remaining = typeof data.remaining === "number" ? data.remaining : Math.max(0, limit - used);
        var percentage = typeof data.usagePercentage === "number"
            ? data.usagePercentage
            : Math.round((used / limit) * 10000) / 100;
        db.prepare("\n      INSERT INTO zoho_api_usage_cache\n      (id, daily_limit, used_today, remaining, usage_percentage, reset_time, updated_at)\n      VALUES (?, ?, ?, ?, ?, ?, ?)\n      ON CONFLICT(id) DO UPDATE SET\n        daily_limit = excluded.daily_limit,\n        used_today = excluded.used_today,\n        remaining = excluded.remaining,\n        usage_percentage = excluded.usage_percentage,\n        reset_time = excluded.reset_time,\n        updated_at = excluded.updated_at\n    ").run(id, limit, used, remaining, percentage, data.resetTime || null, now);
    }
    catch (err) {
        console.error("[Database] Failed to set API usage cache:", err);
    }
}
/**
 * Saves a batch of activity records into SQLite zoho_activity_logs (and mirrors to zoho_activity_log).
 * Tracks count of newly inserted and updated activities.
 */
function saveActivityLogsBatch(db, activities) {
    var newCount = 0;
    var updatedCount = 0;
    var checkStmt = db.prepare("SELECT activity_id FROM zoho_activity_logs WHERE activity_id = ?");
    var insertLogsStmt = db.prepare("\n    INSERT INTO zoho_activity_logs\n    (activity_id, date, time, user_name, user_id, module, action, description, entity_id, entity_number, ip_address, source, created_time, activity_type, module_source, reference_type, reference_id, reference_number, linked_bill_id, linked_invoice_id, raw_payload_json, detail_party_name, detail_party_id, synced_at)\n    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n    ON CONFLICT(activity_id) DO UPDATE SET\n      date = excluded.date,\n      time = excluded.time,\n      user_name = excluded.user_name,\n      user_id = excluded.user_id,\n      module = excluded.module,\n      action = excluded.action,\n      description = excluded.description,\n      entity_id = excluded.entity_id,\n      entity_number = excluded.entity_number,\n      ip_address = excluded.ip_address,\n      source = excluded.source,\n      created_time = excluded.created_time,\n      activity_type = excluded.activity_type,\n      module_source = excluded.module_source,\n      reference_type = excluded.reference_type,\n      reference_id = excluded.reference_id,\n      reference_number = excluded.reference_number,\n      linked_bill_id = excluded.linked_bill_id,\n      linked_invoice_id = excluded.linked_invoice_id,\n      raw_payload_json = excluded.raw_payload_json,\n      detail_party_name = excluded.detail_party_name,\n      detail_party_id = excluded.detail_party_id,\n      synced_at = excluded.synced_at\n  ");
    var insertLogLegacyStmt = db.prepare("\n    INSERT INTO zoho_activity_log\n    (activity_id, activity_datetime, activity_date, module, action, entity_type, entity_id, document_number, user_id, user_name, description, source_ip, synced_at)\n    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n    ON CONFLICT(activity_id) DO UPDATE SET\n      activity_datetime = excluded.activity_datetime,\n      activity_date = excluded.activity_date,\n      module = excluded.module,\n      action = excluded.action,\n      entity_type = excluded.entity_type,\n      entity_id = excluded.entity_id,\n      document_number = excluded.document_number,\n      user_id = excluded.user_id,\n      user_name = excluded.user_name,\n      description = excluded.description,\n      source_ip = excluded.source_ip,\n      synced_at = excluded.synced_at\n  ");
    for (var _i = 0, activities_1 = activities; _i < activities_1.length; _i++) {
        var act = activities_1[_i];
        var existing = checkStmt.get(act.activity_id);
        if (existing) {
            updatedCount++;
        }
        else {
            newCount++;
        }
        insertLogsStmt.run(act.activity_id, act.date, act.time || null, act.user_name || null, act.user_id || null, act.module, act.action, act.description || null, act.entity_id || null, act.entity_number || null, act.ip_address || null, act.source || null, act.created_time || null, act.activity_type || null, act.module_source || null, act.reference_type || null, act.reference_id || null, act.reference_number || null, act.linked_bill_id || null, act.linked_invoice_id || null, act.raw_payload_json || null, act.detail_party_name || null, act.detail_party_id || null, act.synced_at);
        // Legacy sync mirror
        var dt = act.created_time || "".concat(act.date, "T").concat(act.time || "00:00:00");
        insertLogLegacyStmt.run(act.activity_id, dt, act.date, act.module, act.action, act.activity_type || act.module, act.entity_id || null, act.entity_number || null, act.user_id || null, act.user_name || null, act.description || "", act.ip_address || null, act.synced_at);
    }
    return { newActivities: newCount, updatedActivities: updatedCount };
}
/**
 * Retrieves activity logs from SQLite zoho_activity_logs with flexible filtering and search.
 */
function getActivityLogs(db, filters) {
    var _a, _b;
    if (filters === void 0) { filters = {}; }
    var conditions = [];
    var params = [];
    if (filters.fromDate && filters.toDate) {
        conditions.push("date >= ? AND date <= ?");
        params.push(filters.fromDate, filters.toDate);
    }
    else if (filters.fromDate) {
        conditions.push("date >= ?");
        params.push(filters.fromDate);
    }
    else if (filters.toDate) {
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
        var s = "%".concat(filters.search.trim().toLowerCase(), "%");
        conditions.push("(LOWER(user_name) LIKE ? OR LOWER(module) LIKE ? OR LOWER(action) LIKE ? OR LOWER(description) LIKE ? OR LOWER(entity_number) LIKE ? OR LOWER(reference_number) LIKE ?)");
        params.push(s, s, s, s, s, s);
    }
    var whereClause = conditions.length > 0 ? "WHERE ".concat(conditions.join(" AND ")) : "";
    var countRow = (_a = db.prepare("SELECT COUNT(*) as c FROM zoho_activity_logs ".concat(whereClause))).get.apply(_a, params);
    var totalCount = countRow ? countRow.c : 0;
    var query = "\n    SELECT\n      activity_id, date, time, user_name, user_id, module, action,\n      description, entity_id, entity_number, ip_address, source,\n      created_time, activity_type, module_source, reference_type,\n      reference_id, reference_number, linked_bill_id, linked_invoice_id,\n      raw_payload_json, detail_party_name, detail_party_id, synced_at\n    FROM zoho_activity_logs\n    ".concat(whereClause, "\n    ORDER BY date DESC, time DESC, created_time DESC\n  ");
    var queryParams = __spreadArray([], params, true);
    if (typeof filters.limit === "number") {
        query += " LIMIT ?";
        queryParams.push(filters.limit);
        if (typeof filters.offset === "number") {
            query += " OFFSET ?";
            queryParams.push(filters.offset);
        }
    }
    var activities = (_b = db.prepare(query)).all.apply(_b, queryParams);
    return { activities: activities, totalCount: totalCount };
}
/**
 * Computes the 7 required KPIs for Zoho Activity:
 * Total Activities, Today, This Week, This Month, Users, Modules, Last Sync.
 */
function getActivityKpis(db, fyStart, toDate, refDate) {
    if (fyStart === void 0) { fyStart = "2026-04-01"; }
    if (refDate === void 0) { refDate = new Date(); }
    var pad = function (n) { return String(n).padStart(2, "0"); };
    var todayStr = "".concat(refDate.getFullYear(), "-").concat(pad(refDate.getMonth() + 1), "-").concat(pad(refDate.getDate()));
    var effectiveToDate = toDate || todayStr;
    // Total in current FY
    var totalRow = db.prepare("\n    SELECT COUNT(*) as c FROM zoho_activity_logs\n    WHERE date >= ? AND date <= ?\n  ").get(fyStart, effectiveToDate);
    var totalActivities = totalRow ? totalRow.c : 0;
    // Today
    var todayRow = db.prepare("\n    SELECT COUNT(*) as c FROM zoho_activity_logs\n    WHERE date = ?\n  ").get(todayStr);
    var today = todayRow ? todayRow.c : 0;
    // This Week (Monday to Sunday)
    var d = new Date(refDate);
    var day = d.getDay();
    var diffToMonday = day === 0 ? -6 : 1 - day;
    var monday = new Date(d);
    monday.setDate(d.getDate() + diffToMonday);
    var weekStartStr = "".concat(monday.getFullYear(), "-").concat(pad(monday.getMonth() + 1), "-").concat(pad(monday.getDate()));
    var weekRow = db.prepare("\n    SELECT COUNT(*) as c FROM zoho_activity_logs\n    WHERE date >= ? AND date <= ?\n  ").get(weekStartStr, todayStr);
    var thisWeek = weekRow ? weekRow.c : 0;
    // This Month
    var monthStartStr = "".concat(refDate.getFullYear(), "-").concat(pad(refDate.getMonth() + 1), "-01");
    var monthRow = db.prepare("\n    SELECT COUNT(*) as c FROM zoho_activity_logs\n    WHERE date >= ? AND date <= ?\n  ").get(monthStartStr, todayStr);
    var thisMonth = monthRow ? monthRow.c : 0;
    // Distinct Users
    var usersRow = db.prepare("\n    SELECT COUNT(DISTINCT user_name) as c FROM zoho_activity_logs\n    WHERE user_name IS NOT NULL AND TRIM(user_name) != '' AND date >= ? AND date <= ?\n  ").get(fyStart, effectiveToDate);
    var users = usersRow ? usersRow.c : 0;
    // Distinct Modules
    var modulesRow = db.prepare("\n    SELECT COUNT(DISTINCT module) as c FROM zoho_activity_logs\n    WHERE module IS NOT NULL AND TRIM(module) != '' AND date >= ? AND date <= ?\n  ").get(fyStart, effectiveToDate);
    var modules = modulesRow ? modulesRow.c : 0;
    // Last Sync
    var lastSyncMeta = getSyncMetadata(db, "last_successful_activity_sync");
    var lastSync = lastSyncMeta;
    if (!lastSync) {
        var maxSyncRow = db.prepare("SELECT MAX(synced_at) as s FROM zoho_activity_logs").get();
        lastSync = (maxSyncRow === null || maxSyncRow === void 0 ? void 0 : maxSyncRow.s) || null;
    }
    return {
        totalActivities: totalActivities,
        today: today,
        thisWeek: thisWeek,
        thisMonth: thisMonth,
        users: users,
        modules: modules,
        lastSync: lastSync,
    };
}
/**
 * Returns API usage metrics for Zoho Activity.
 */
function getActivitySyncStats(db) {
    var lastSync = getSyncMetadata(db, "last_successful_activity_sync") || null;
    var activitiesRetrieved = parseInt(getSyncMetadata(db, "last_activity_sync_retrieved") || "0", 10);
    var newActivities = parseInt(getSyncMetadata(db, "last_activity_sync_new") || "0", 10);
    var updatedActivities = parseInt(getSyncMetadata(db, "last_activity_sync_updated") || "0", 10);
    var apiCallsUsed = parseInt(getSyncMetadata(db, "last_activity_sync_api_calls") || "0", 10);
    return {
        lastSync: lastSync,
        activitiesRetrieved: activitiesRetrieved,
        newActivities: newActivities,
        updatedActivities: updatedActivities,
        apiCallsUsed: apiCallsUsed,
    };
}
function setActivitySyncStats(db, stats) {
    if (stats.lastSync) {
        setSyncMetadata(db, "last_successful_activity_sync", stats.lastSync);
    }
    setSyncMetadata(db, "last_activity_sync_retrieved", String(stats.activitiesRetrieved));
    setSyncMetadata(db, "last_activity_sync_new", String(stats.newActivities));
    setSyncMetadata(db, "last_activity_sync_updated", String(stats.updatedActivities));
    setSyncMetadata(db, "last_activity_sync_api_calls", String(stats.apiCallsUsed));
}

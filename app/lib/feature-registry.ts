// ============================================================
// Bansil Books Analytics — PROJECT-WIDE Feature Registry
// ONE central registry for every user-facing module/feature/action in
// the entire application (not just Reconciliation & Audit). Reuses the
// existing app_feature_settings table (production bansil_books.db) —
// no new storage, no second toggle mechanism.
//
// Future rule (see also MILESTONE_C_HANDOFF.md §13): any new user-facing
// feature anywhere in this app MUST, before it is considered complete:
//   1. add one entry here (feature_key, parent_feature_key, defaults);
//   2. define its module_key and default_enabled state;
//   3. set implementation_status (NOT_IMPLEMENTED until real);
//   4. add a server-side guard at its route/action entry point when
//      server_guard_required is true;
//   5. add an OFF/ON test.
// Never build a second, separate hardcoded toggle system for a new
// module — extend this file.
// ============================================================

export type ImplementationStatus = "IMPLEMENTED" | "NOT_IMPLEMENTED";
export type VisibilityType = "MODULE" | "SUBFEATURE" | "ACTION";

export interface FeatureDefinition {
  feature_key: string;
  module_key: string;
  parent_feature_key: string | null;
  label: string;
  description: string;
  implementation_status: ImplementationStatus;
  default_enabled: boolean;
  sort_order: number;
  visibility_type: VisibilityType;
  /** True when an API route or service function must reject the action server-side when this key (or an ancestor) is OFF — not merely hidden in the UI. */
  server_guard_required: boolean;
  /** Purely a display sub-grouping label for the Settings UI (e.g. "Source Intake") — never part of the enforcement chain. */
  ui_group: string | null;
}

export type FeatureId = 'search' | 'traceability' | 'bom_master' | 'p0_audit' | 'accounts_audit';

export const EXPERIMENTAL_FEATURES: { id: FeatureId; label: string; enabled: boolean }[] = [
  { id: 'search', label: 'Universal Search', enabled: true },
  { id: 'traceability', label: 'Item Traceability', enabled: true },
  { id: 'bom_master', label: 'BOM Master', enabled: true },
  { id: 'p0_audit', label: 'P0 Audit Dashboard', enabled: true },
  { id: 'accounts_audit', label: 'Accounts Audit', enabled: true },
];

export const FEATURE_REGISTRY: FeatureDefinition[] = [
  { feature_key: "sub_est_tender_hub", module_key: "estimation", parent_feature_key: "module_estimation", label: "Tender Hub", description: "Local EstimaPro copy: PID and document revisions, queries, observed calculations and report exports. Server AI and integrations unavailable.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 97, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: null },

  // ================= Dashboard =================
  { feature_key: "module_dashboard", module_key: "dashboard", parent_feature_key: null, label: "Dashboard", description: "Main KPI metrics, exposure summary, recent transactions, and quick links.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 0, visibility_type: "MODULE", server_guard_required: false, ui_group: null },

  // ================= Pre-Audit Verification =================
  { feature_key: "module_pre_audit_verification", module_key: "pre_audit", parent_feature_key: null, label: "Pre-Audit Verification", description: "Read-only dashboard for verifying accounting data readiness before formal IT/GST audits.", implementation_status: "NOT_IMPLEMENTED", default_enabled: true, sort_order: 5, visibility_type: "MODULE", server_guard_required: false, ui_group: null },

  // ================= Reconciliation (legacy "recon_*" nav ids; rendered as several Report screens + the master grid) =================
  { feature_key: "module_reconciliation", module_key: "reconciliation", parent_feature_key: null, label: "Reconciliation", description: "Core purchase vs sales material reconciliation engine.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 10, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_recon_master", module_key: "reconciliation", parent_feature_key: "module_reconciliation", label: "Master Reconciliation", description: "Customer + Item master grain reconciliation overview.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 11, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_recon_balance", module_key: "reconciliation", parent_feature_key: "module_reconciliation", label: "Balance Qty", description: "View records with non-zero inventory balance.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 12, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_recon_yet_to_purchase", module_key: "reconciliation", parent_feature_key: "module_reconciliation", label: "Yet to Purchase (Shortage)", description: "Items sold to customer where purchase is pending.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 13, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_recon_yet_to_sale", module_key: "reconciliation", parent_feature_key: "module_reconciliation", label: "Yet to Sale (Surplus)", description: "Purchased items pending customer invoice billing.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 14, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_recon_purchase_only", module_key: "reconciliation", parent_feature_key: "module_reconciliation", label: "Purchase Only", description: "Purchased items with zero sales invoices.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 15, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_recon_sale_only", module_key: "reconciliation", parent_feature_key: "module_reconciliation", label: "Sales Only", description: "Invoiced items with zero booked purchase bills.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 16, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_recon_reconciled", module_key: "reconciliation", parent_feature_key: "module_reconciliation", label: "Reconciled", description: "Fully balanced purchase and sales lines.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 17, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_recon_customer_missing", module_key: "reconciliation", parent_feature_key: "module_reconciliation", label: "Customer Details Missing", description: "Purchase lines without identified customer allocation.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 18, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_recon_excluded_items", module_key: "reconciliation", parent_feature_key: "module_reconciliation", label: "Excluded Items", description: "Items excluded from active reconciliation by policy.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 19, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_recon_composite_assembly", module_key: "reconciliation", parent_feature_key: "module_reconciliation", label: "Composite Assembly", description: "Assembly overlay for composite/kit items.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 20, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: null },

  // ================= Transactions =================
  { feature_key: "module_transactions", module_key: "transactions", parent_feature_key: null, label: "Transactions", description: "Source document inspection and Zoho activity audit trail.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 30, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_trans_purchase_bills", module_key: "transactions", parent_feature_key: "module_transactions", label: "Purchase Bills", description: "Raw purchase bill vouchers with line item details.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 31, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_trans_sales_invoices", module_key: "transactions", parent_feature_key: "module_transactions", label: "Sales Invoices", description: "Raw sales invoice vouchers with line item details.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 32, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_trans_transaction_detail", module_key: "transactions", parent_feature_key: "module_transactions", label: "Transaction Detail", description: "Line-by-line single source transaction explorer.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 33, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_trans_zoho_activity", module_key: "transactions", parent_feature_key: "module_transactions", label: "Zoho Activity", description: "Local SQLite audit trail and user event log.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 34, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },

  // ================= Services =================
  { feature_key: "module_services", module_key: "services", parent_feature_key: null, label: "Services", description: "Dedicated analysis for non-inventory service items and labor contracts.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 40, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_svc_summary", module_key: "services", parent_feature_key: "module_services", label: "Service Summary", description: "Service performance and contract margins.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 41, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_svc_purchases", module_key: "services", parent_feature_key: "module_services", label: "Service Purchases", description: "Vendor service bills and sub-contractor lines.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 42, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_svc_sales", module_key: "services", parent_feature_key: "module_services", label: "Service Sales", description: "Customer service and installation invoices.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 43, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_svc_transactions", module_key: "services", parent_feature_key: "module_services", label: "Service Transactions", description: "Comprehensive service transaction breakdown.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 44, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_svc_reconciliation", module_key: "services", parent_feature_key: "module_services", label: "Service Reconciliation", description: "Customer-wise service margin and balance comparison.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 45, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },

  // ================= Inventory (LOCKED — MODULE_LOCK.md) =================
  { feature_key: "module_inventory", module_key: "inventory", parent_feature_key: null, label: "Inventory", description: "Stock table, KPIs, drawers, and movement logic. LOCKED protected module.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 50, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_inv_stock", module_key: "inventory", parent_feature_key: "module_inventory", label: "Stock", description: "Stock table view, KPIs, and movement drawers. LOCKED protected feature.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 51, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: null },

  // ================= Customers (LOCKED — MODULE_LOCK.md) =================
  { feature_key: "module_customers", module_key: "customers", parent_feature_key: null, label: "Customers", description: "Customer 360 intelligence, linked purchase bills, item analysis, and financial tracking. LOCKED protected module.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 60, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_cust_customer_details", module_key: "customers", parent_feature_key: "module_customers", label: "Customer Details", description: "Comprehensive Customer 360 overview, invoices, purchase bills, and price analytics. LOCKED protected feature.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 61, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: null },
  { feature_key: "sub_cust_action_taken", module_key: "customers", parent_feature_key: "module_customers", label: "Action Taken", description: "Customer-level action tracking and follow-up register. LOCKED protected feature.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 62, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: null },

  // ================= Reports (LOCKED — MODULE_LOCK.md) =================
  { feature_key: "module_reports", module_key: "reports", parent_feature_key: null, label: "Reports", description: "Management reports, customer-item reconciliations, and data quality audits. LOCKED protected module.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 70, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_rep_recon_summary", module_key: "reports", parent_feature_key: "module_reports", label: "Reconciliation Summary", description: "Executive summary table of reconciliation items.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 71, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_rep_customer_wise", module_key: "reports", parent_feature_key: "module_reports", label: "Customer-wise Item Reconciliation", description: "Primary decision-support report grouped by customer and item.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 72, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_rep_breakdown", module_key: "reports", parent_feature_key: "module_reports", label: "Breakdown Report", description: "Unified transaction-level detail report.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 73, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_rep_price_reference", module_key: "reports", parent_feature_key: "module_reports", label: "Price Reference", description: "Historical purchase and sales price reference evidence. LOCKED protected feature.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 74, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: null },
  { feature_key: "sub_rep_data_quality", module_key: "reports", parent_feature_key: "module_reports", label: "Data Quality", description: "Data integrity metrics and mapping audits.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 75, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_rep_validation", module_key: "reports", parent_feature_key: "module_reports", label: "Validation Report", description: "Automated regression and rule verification results.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 76, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_rep_customer_material", module_key: "reports", parent_feature_key: "module_reports", label: "Customer Material Control Report", description: "Site-wise customer material control and consumption report. LOCKED protected feature.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 77, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: null },

  // ================= Additional Features (existing cross-cutting toggles) =================
  { feature_key: "module_zoho_activity", module_key: "other", parent_feature_key: null, label: "Zoho Activity Log", description: "Audit trail log viewing.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 80, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
  { feature_key: "module_data_quality", module_key: "other", parent_feature_key: null, label: "Data Quality Auditing", description: "Automated data consistency checks.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 81, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
  { feature_key: "module_validation_report", module_key: "other", parent_feature_key: null, label: "Validation Engine", description: "System verification test results.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 82, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
  { feature_key: "module_exclusion_management", module_key: "other", parent_feature_key: null, label: "Exclusion Rule Management", description: "Create and deactivate reconciliation exclusions.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 83, visibility_type: "MODULE", server_guard_required: true, ui_group: null },
  { feature_key: "module_export", module_key: "other", parent_feature_key: null, label: "Excel / PDF Exports", description: "Export generation capabilities (Excel and PDF).", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 84, visibility_type: "ACTION", server_guard_required: true, ui_group: null },
  { feature_key: "module_ai_insights", module_key: "other", parent_feature_key: null, label: "AI Insights / Suggestions (Default: OFF)", description: "Local intelligence suggestion engine (requires explicit user action).", implementation_status: "IMPLEMENTED", default_enabled: false, sort_order: 85, visibility_type: "MODULE", server_guard_required: false, ui_group: null },

  // ================= Zoho / Sync =================
  { feature_key: "sync_smart_enabled", module_key: "sync", parent_feature_key: null, label: "Smart Incremental Sync (Default: ON)", description: "Skip unchanged document detail calls by comparing modified timestamps and hashes.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 90, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
  { feature_key: "sync_auto_on_page_open", module_key: "sync", parent_feature_key: null, label: "Auto-Sync On Page Open (Default: OFF)", description: "Strict Local-First rule: normal page opens never consume Zoho API calls without user action.", implementation_status: "IMPLEMENTED", default_enabled: false, sort_order: 91, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
  { feature_key: "sync_historical_rescan", module_key: "sync", parent_feature_key: null, label: "Historical FY Rescan (Default: OFF)", description: "Completed historical FYs are protected from repeated full scans unless Forced.", implementation_status: "IMPLEMENTED", default_enabled: false, sort_order: 92, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
  { feature_key: "action_zoho_manual_sync", module_key: "sync", parent_feature_key: null, label: "Zoho Sync (Manual / Selective / Backfill)", description: "Explicit owner-triggered Zoho Books sync — Smart Sync, Selective Sync, and historical backfill. Read-only status checks are never gated by this.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 93, visibility_type: "ACTION", server_guard_required: true, ui_group: null },
  { feature_key: "action_zoho_activity_backfill", module_key: "sync", parent_feature_key: null, label: "Zoho Activity Backfill", description: "Explicit owner-triggered resumable backfill of the Zoho Activity audit trail.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 94, visibility_type: "ACTION", server_guard_required: true, ui_group: null },

  // ================= Reconciliation & Audit (Milestones A/B/C — unchanged from the prior pass, migrated into this central registry) =================
  { feature_key: "module_audit_workspace", module_key: "audit", parent_feature_key: null, label: "Reconciliation & Audit", description: "Parent module for the entire Reconciliation & Audit workspace, its navigation, and all audit API routes.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 100, visibility_type: "MODULE", server_guard_required: true, ui_group: null },

  { feature_key: "sub_settings_skills", module_key: "audit", parent_feature_key: "module_audit_workspace", label: "Settings > Skills", description: "Skill package registry: upload, lifecycle, pinning.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 106, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: null },

  { feature_key: "audit_feat_pdf_intake", module_key: "audit", parent_feature_key: "sub_audit_uploads", label: "PDF Intake", description: "Upload and extract digital-text PDF evidence.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 110, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Source Intake" },
  { feature_key: "audit_feat_xlsx_intake", module_key: "audit", parent_feature_key: "sub_audit_uploads", label: "XLSX Intake", description: "Upload and extract Excel workbook evidence.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 111, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Source Intake" },
  { feature_key: "audit_feat_csv_intake", module_key: "audit", parent_feature_key: "sub_audit_uploads", label: "CSV Intake", description: "Upload and extract CSV evidence.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 112, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Source Intake" },
  { feature_key: "audit_feat_zoho_sources", module_key: "audit", parent_feature_key: "sub_audit_uploads", label: "Zoho Read-Only Sources", description: "Explicit, read-only Zoho Sales Invoices / Purchase Bills acquisition into an audit source.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 113, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Source Intake" },

  { feature_key: "audit_feat_source_mapping", module_key: "audit", parent_feature_key: "sub_audit_uploads", label: "Source Mapping", description: "Owner-approved raw-column-to-normalized-field mapping, including header/data-start row selection.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 120, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Mapping & Evidence" },
  { feature_key: "audit_feat_completeness_controls", module_key: "audit", parent_feature_key: "sub_audit_uploads", label: "Completeness Controls", description: "Opening/movement/closing completeness check on a source version.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 121, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Mapping & Evidence" },
  { feature_key: "audit_feat_evidence_drillback", module_key: "audit", parent_feature_key: "module_audit_workspace", label: "Evidence Drill-back", description: "View normalized rows / match-group evidence back to their original physical source location.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 122, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Mapping & Evidence" },
  { feature_key: "audit_feat_frozen_snapshots", module_key: "audit", parent_feature_key: "sub_audit_uploads", label: "Frozen Source Snapshots", description: "Freeze an approved source-version mapping into an immutable snapshot for matching.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 123, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Mapping & Evidence" },

  { feature_key: "audit_feat_exact_matching", module_key: "audit", parent_feature_key: "sub_audit_match_review", label: "Exact Matching", description: "Unique 1:1 candidates where reference, amount, and date all agree.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 130, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Matching" },
  { feature_key: "audit_feat_date_reference_checks", module_key: "audit", parent_feature_key: "sub_audit_match_review", label: "Date / Reference / Code Checks", description: "Surface date-mismatch and reference-mismatch discrepancy candidates.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 131, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Matching" },
  { feature_key: "audit_feat_amount_currency_checks", module_key: "audit", parent_feature_key: "sub_audit_match_review", label: "Amount / Currency Checks", description: "Surface currency-mismatch and amount-exceeds discrepancy candidates.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 132, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Matching" },
  { feature_key: "audit_feat_quantity_unit_checks", module_key: "audit", parent_feature_key: "sub_audit_match_review", label: "Quantity / Unit Checks", description: "Surface unit-mismatch discrepancy candidates for quantity-bearing rows.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 133, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Matching" },
  { feature_key: "audit_feat_grouped_one_to_many", module_key: "audit", parent_feature_key: "sub_audit_match_review", label: "Grouped One-to-Many Matching", description: "One row on one side matched to several summing rows on the other.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 134, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Matching" },
  { feature_key: "audit_feat_grouped_many_to_one", module_key: "audit", parent_feature_key: "sub_audit_match_review", label: "Grouped Many-to-One Matching", description: "Several summing rows on one side matched to one row on the other.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 135, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Matching" },
  { feature_key: "audit_feat_partial_matching", module_key: "audit", parent_feature_key: "sub_audit_match_review", label: "Partial Matching", description: "Partial settlement candidates with a retained residual amount/quantity.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 136, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Matching" },
  { feature_key: "audit_feat_ambiguous_review", module_key: "audit", parent_feature_key: "sub_audit_match_review", label: "Ambiguous Match Review", description: "N:M candidate buckets held for manual review rather than guessed.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 137, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Matching" },
  { feature_key: "audit_feat_unmatched_left_right", module_key: "audit", parent_feature_key: "sub_audit_match_review", label: "Unmatched Left / Right", description: "Visibility of rows with no compatible counterpart in a run.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 138, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Matching" },
  { feature_key: "audit_feat_multi_source_verification", module_key: "audit", parent_feature_key: "sub_audit_match_review", label: "Multi-Source Cross Verification", description: "Runs with more than one comparison edge (a multi-source graph).", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 139, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Matching" },
  { feature_key: "audit_feat_reviewer_decisions", module_key: "audit", parent_feature_key: "sub_audit_match_review", label: "Reviewer Decisions", description: "Accept / Reject / Hold / Reverse actions on a match-group candidate.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 140, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Matching" },

  { feature_key: "audit_feat_domain_review", module_key: "audit", parent_feature_key: "sub_audit_findings", label: "Domain Review", description: "Record per-domain review coverage — proven by source snapshots or tests performed, never inferred from an absence of mismatches.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 141, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Findings & Action Taken" },
  { feature_key: "audit_feat_coverage_matrix", module_key: "audit", parent_feature_key: "sub_audit_findings", label: "Review Coverage Matrix", description: "Domain-by-domain scope completeness view (REVIEWED/PARTIAL/BLOCKED/EXCLUDED/NOT_TESTED/NOT_AVAILABLE).", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 142, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Findings & Action Taken" },
  { feature_key: "audit_feat_findings_register", module_key: "audit", parent_feature_key: "sub_audit_findings", label: "Findings Register", description: "Persistent findings with severity, classification, and confirmed-vs-suspected causation.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 143, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Findings & Action Taken" },
  { feature_key: "audit_feat_action_taken", module_key: "audit", parent_feature_key: "sub_audit_findings", label: "Action Taken", description: "Assign, track, and close remediation actions — independent of the underlying finding's own status.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 144, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Findings & Action Taken" },
  { feature_key: "audit_feat_reviewer_signoff", module_key: "audit", parent_feature_key: "sub_audit_findings", label: "Reviewer Sign-off", description: "Reviewer decisions at finding, domain-review, and report level — an internal review record, never a statutory audit opinion.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 145, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Findings & Action Taken" },
  { feature_key: "audit_feat_findings_evidence_drillback", module_key: "audit", parent_feature_key: "sub_audit_findings", label: "Findings Evidence Drill-back", description: "Drill back from a finding to its match group / source record / frozen snapshot / original evidence locator.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 146, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Findings & Action Taken" },

  { feature_key: "audit_feat_report_field_selector", module_key: "audit", parent_feature_key: "sub_audit_reports", label: "Report Field Selector", description: "Choose report sections for export — an explicit empty selection blocks the download; an absent selection uses approved defaults.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 147, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Review Reports" },
  { feature_key: "audit_feat_excel_export", module_key: "audit", parent_feature_key: "sub_audit_reports", label: "Excel Export", description: "Generate an XLSX workbook from an already-generated immutable report snapshot — never reruns matching/AI/Zoho/parsing.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 148, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Review Reports" },
  { feature_key: "audit_feat_pdf_export", module_key: "audit", parent_feature_key: "sub_audit_reports", label: "PDF Export", description: "Generate a PDF from the same immutable report snapshot used by the Excel export — no independent business logic.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 149, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Review Reports" },

  { feature_key: "sub_audit_v2_coverage_review", module_key: "audit", parent_feature_key: "sub_audit_v2_pilot", label: "Master Audit V2 coverage review", description: "Bill settlement notes, bounded vendor Bill search and shared captured-cost allocation. No automatic GP approval.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 172, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Master Audit V2" },
  // Development-only V2 pilot. This flag never enables production or Zoho writes.
  { feature_key: "sub_audit_v2_pilot", module_key: "audit", parent_feature_key: "module_audit_workspace", label: "Master Audit V2 (local pilot)", description: "Saved-document sync, linked-document discovery, purchase coverage, Bill settlement review, vendor Bill search, shared cost allocation and owner GP review for the local pilot. Production remains disabled.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 171, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Master Audit V2" },

  // ================= Milestone E: Controlled Learning (governed rule proposals, SUGGEST_ONLY by default) =================

  { feature_key: "audit_feat_learning_proposals", module_key: "audit", parent_feature_key: "sub_audit_learning", label: "Learning Proposal Register", description: "Create/view versioned rule proposals and their examples — DRAFT only, never auto-activated.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 161, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Controlled Learning" },
  { feature_key: "audit_feat_learning_unsupported_case_review", module_key: "audit", parent_feature_key: "sub_audit_learning", label: "Unsupported Case Review", description: "The Unsupported/Uncertain Case workflow — HOLD, request evidence, one-time override, or propose a scoped rule.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 162, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Controlled Learning" },
  { feature_key: "audit_feat_learning_one_time_overrides", module_key: "audit", parent_feature_key: "sub_audit_learning", label: "One-Time Overrides", description: "Case-specific approved overrides that never edit the rule set and never train anything automatically.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 163, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Controlled Learning" },
  { feature_key: "audit_feat_learning_rule_testing", module_key: "audit", parent_feature_key: "sub_audit_learning", label: "Rule Testing", description: "Runs a proposal's declared positive/negative/hard-negative examples against its own configuration before it may be submitted.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 164, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Controlled Learning" },
  { feature_key: "audit_feat_learning_rule_approval", module_key: "audit", parent_feature_key: "sub_audit_learning", label: "Rule Approval & Activation", description: "Approve and activate a tested, conflict-free proposal. GLOBAL scope requires an explicit second confirmation.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 165, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Controlled Learning" },
  { feature_key: "audit_feat_learning_rule_disable", module_key: "audit", parent_feature_key: "sub_audit_learning", label: "Rule Disable / Archive", description: "Disable an active rule or archive a disabled/rejected/expired one — history is preserved, never deleted.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 166, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Controlled Learning" },
  { feature_key: "audit_feat_learning_rule_rollback", module_key: "audit", parent_feature_key: "sub_audit_learning", label: "Rule Rollback", description: "Roll back to a known historical approved version as a NEW version — the superseded version is preserved in history, never rewritten.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 167, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Controlled Learning" },
  { feature_key: "audit_feat_learning_rule_conflict_review", module_key: "audit", parent_feature_key: "sub_audit_learning", label: "Rule Conflict Review", description: "Detects and requires explicit resolution of conflicting active rules — never silently picks a winner.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 168, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Controlled Learning" },
  { feature_key: "audit_feat_learning_rule_expiry_review", module_key: "audit", parent_feature_key: "sub_audit_learning", label: "Rule Expiry Review", description: "Expired rules are flagged NEEDS_REVIEW, never silently continued — owner may renew, replace, or disable.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 169, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Controlled Learning" },
  { feature_key: "audit_feat_release_readiness", module_key: "audit", parent_feature_key: "sub_audit_learning", label: "Release Readiness", description: "Final release-readiness matrix and known-limitations register view for owner acceptance.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 170, visibility_type: "SUBFEATURE", server_guard_required: true, ui_group: "Controlled Learning" },

  // ================= Estimation (Phase 4E) =================
  { feature_key: "module_estimation", module_key: "estimation", parent_feature_key: null, label: "Estimation", description: "BOQ estimation tools: technical equivalence review, rate evidence comparison. Read-only Owner review UI.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 95, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
  { feature_key: "sub_est_technical_equivalence", module_key: "estimation", parent_feature_key: "module_estimation", label: "Technical Equivalence Review", description: "Phase 4E deterministic technical equivalence assessment UI. Read-only, no Zoho write, no external AI.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 96, visibility_type: "SUBFEATURE", server_guard_required: false, ui_group: null },

    // ================= Settings / Administration (deliberately NOT server-gated — see MILESTONE_C_HANDOFF.md limitations: gating Settings itself risks a self-lockout) =================
  { feature_key: "settings_sync_page", module_key: "settings", parent_feature_key: null, label: "Sync & Local Cache (page)", description: "Zoho connection status and local cache management page.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 150, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
  { feature_key: "settings_modules_page", module_key: "settings", parent_feature_key: null, label: "Modules & Features (page)", description: "This Settings page itself.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 151, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
  { feature_key: "settings_security_page", module_key: "settings", parent_feature_key: null, label: "Security (page)", description: "Owner authorization status for the Reconciliation & Audit module.", implementation_status: "IMPLEMENTED", default_enabled: true, sort_order: 152, visibility_type: "MODULE", server_guard_required: false, ui_group: null },
];

const REGISTRY_BY_KEY = new Map(FEATURE_REGISTRY.map((f) => [f.feature_key, f]));

/** Own stored value if present, else the registry default. */
function rawEnabled(key: string, settings: Record<string, boolean>): boolean {
  if (settings[key] !== undefined) return settings[key];
  return REGISTRY_BY_KEY.get(key)?.default_enabled ?? true;
}

/**
 * A feature is only effectively enabled when it AND every registry-declared
 * ancestor up to its module root are enabled. Turning a parent OFF never
 * mutates a child's own stored value — re-enabling the parent restores
 * prior child behavior automatically, because the child's stored bit was
 * never touched.
 */
export function isFeatureEffectivelyEnabled(key: string, settings: Record<string, boolean>): boolean {
  let current: string | null = key;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) break; // defensive cycle guard
    seen.add(current);
    if (!rawEnabled(current, settings)) return false;
    current = REGISTRY_BY_KEY.get(current)?.parent_feature_key ?? null;
  }
  return true;
}

export function getFeatureDefinition(key: string): FeatureDefinition | undefined {
  return REGISTRY_BY_KEY.get(key);
}

export function featuresByModule(moduleKey: string): FeatureDefinition[] {
  return FEATURE_REGISTRY.filter((f) => f.module_key === moduleKey).sort((a, b) => a.sort_order - b.sort_order);
}

export function allModuleKeys(): string[] {
  return [...new Set(FEATURE_REGISTRY.map((f) => f.module_key))];
}

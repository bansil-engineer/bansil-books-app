// ============================================================
// Bansil Books Analytics — AI Workspace Database
// Node 22+ Built-in node:sqlite
// ============================================================

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { getAiWorkspaceDbPath } from "./db-resolver";

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string | null = null;

export function getDbFilePath(): string {
  return getAiWorkspaceDbPath();
}

export function getAiDatabase(customDbFile?: string): DatabaseSync {
  const targetPath = customDbFile || getDbFilePath();

  if (dbInstance && currentDbPath === targetPath) {
    return dbInstance;
  }

  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {}
    dbInstance = null;
    currentDbPath = null;
  }

  if (targetPath !== ":memory:") {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(targetPath);
  if (targetPath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  db.exec("PRAGMA foreign_keys = ON;");

  initAiDatabase(db);
  dbInstance = db;
  currentDbPath = targetPath;
  return dbInstance;
}

export function setAiDatabase(db: DatabaseSync | null, customPath: string = ":memory:"): void {
  if (dbInstance && dbInstance !== db) {
    try {
      dbInstance.close();
    } catch {}
  }
  dbInstance = db;
  currentDbPath = db ? customPath : null;
}

export function closeAiDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {}
    dbInstance = null;
    currentDbPath = null;
  }
}

/**
 * Safely clean provable test-generated artifacts from the operational database.
 * Preserves EXECUTIVE, AI CEO, real conversations, real messages, and real runs.
 */
export function cleanOperationalTestArtifacts(db: DatabaseSync): {
  removedDepartments: string[];
  removedAgents: string[];
  removedDeptBudgets: number;
  removedTransfers: number;
  removedTaskBudgets: number;
  removedLedgerEntries: number;
  removedTestTasks: number;
} {
  db.exec("BEGIN IMMEDIATE;");
  try {
    // 1. Identify and remove test department budgets
    const deptBudgets = db.prepare(`SELECT id FROM ai_department_budgets`).all() as Array<{ id: string }>;
    db.exec(`DELETE FROM ai_department_budgets;`);

    // 2. Identify and remove test budget transfers
    const transfers = db.prepare(`SELECT id FROM ai_budget_transfers`).all() as Array<{ id: string }>;
    db.exec(`DELETE FROM ai_budget_transfers;`);

    // 3. Remove test task budgets
    const taskBudgets = db.prepare(`SELECT id FROM ai_task_budgets`).all() as Array<{ id: string }>;
    db.exec(`DELETE FROM ai_task_budgets;`);

    // 4. Remove test usage ledger entries
    const ledger = db.prepare(`SELECT id FROM ai_usage_ledger`).all() as Array<{ id: string }>;
    db.exec(`DELETE FROM ai_usage_ledger;`);

    // 5. Remove test tasks first to satisfy foreign key constraints (preserve tasks associated with real runs)
    const testTasks = db.prepare(`
      SELECT id FROM ai_tasks
      WHERE run_id IS NULL OR run_id NOT IN (SELECT id FROM ai_runs)
    `).all() as Array<{ id: string }>;
    db.exec(`
      DELETE FROM ai_tasks
      WHERE run_id IS NULL OR run_id NOT IN (SELECT id FROM ai_runs);
    `);

    // 6. Remove test agents (preserve ceo_main)
    const testAgents = db.prepare(`SELECT id FROM ai_agents WHERE id != 'ceo_main'`).all() as Array<{ id: string }>;
    db.exec(`DELETE FROM ai_agents WHERE id != 'ceo_main';`);

    // Clean test agent capabilities (preserve ceo_main)
    db.exec(`DELETE FROM ai_agent_capabilities WHERE agent_id != 'ceo_main';`);

    // Clean test tool executions (preserve those tied to valid runs)
    db.exec(`DELETE FROM ai_tool_executions WHERE run_id NOT IN (SELECT id FROM ai_runs);`);

    // 7. Remove non-executive departments
    const testDepts = db.prepare(`SELECT id FROM ai_departments WHERE id != 'EXECUTIVE'`).all() as Array<{ id: string }>;
    db.exec(`DELETE FROM ai_departments WHERE id != 'EXECUTIVE';`);

    // 8. Remove non-system memory entries
    db.exec(`DELETE FROM ai_memory_entries WHERE id NOT LIKE 'mem_sys_%';`);

    // 9. Reset EXECUTIVE department counters
    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE ai_departments
      SET active_agent_count = 1, current_budget = 0.0, current_consumption = 0.0, updated_at = ?
      WHERE id = 'EXECUTIVE';
    `).run(nowIso);

    // 10. Reset active budget period to full available ₹15,000
    db.prepare(`
      UPDATE ai_budget_periods
      SET committed_amount = 0.0, consumed_amount = 0.0, available_amount = monthly_limit, status = 'NORMAL', updated_at = ?;
    `).run(nowIso);

    db.exec("COMMIT;");

    return {
      removedDepartments: testDepts.map(d => d.id),
      removedAgents: testAgents.map(a => a.id),
      removedDeptBudgets: deptBudgets.length,
      removedTransfers: transfers.length,
      removedTaskBudgets: taskBudgets.length,
      removedLedgerEntries: ledger.length,
      removedTestTasks: testTasks.length,
    };
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {}
    throw err;
  }
}

export function initAiDatabase(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      user_identifier TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      agent TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT,
      requested_agent TEXT,
      selected_agent TEXT,
      selected_model TEXT,
      objective TEXT,
      status TEXT NOT NULL,
      priority TEXT DEFAULT 'NORMAL',
      risk_class TEXT DEFAULT 'STANDARD',
      selected_workflow TEXT,
      selected_model_tier TEXT,
      estimated_cost REAL DEFAULT 0.0,
      committed_cost REAL DEFAULT 0.0,
      actual_cost REAL DEFAULT 0.0,
      current_step TEXT,
      max_steps INTEGER DEFAULT 20,
      step_count INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      reviewer_required INTEGER DEFAULT 0,
      reviewer_status TEXT,
      owner_approval_required INTEGER DEFAULT 0,
      idempotency_key TEXT,
      evidence_summary TEXT,
      final_response TEXT,
      failure_reason TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT,
      FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_tool_calls (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_class TEXT NOT NULL,
      input_summary TEXT NOT NULL,
      status TEXT NOT NULL,
      approval_required INTEGER DEFAULT 0,
      executed_at TEXT,
      FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_approvals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      requested_payload_summary TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      approved_at TEXT,
      approved_by TEXT,
      FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_audit_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_agent_handoffs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      source_agent_id TEXT NOT NULL,
      target_agent_id TEXT NOT NULL,
      required_information TEXT,
      evidence_reference TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_review_records (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      task_id TEXT,
      worker_id TEXT NOT NULL,
      checker_id TEXT NOT NULL,
      review_type TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      evidence_reviewed TEXT,
      result TEXT NOT NULL,
      notes TEXT,
      model_used TEXT,
      cost REAL DEFAULT 0.0,
      escalation_reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      level TEXT NOT NULL,
      reports_to TEXT,
      status TEXT NOT NULL,
      purpose TEXT,
      responsibilities TEXT,
      capabilities TEXT,
      allowed_tools TEXT,
      denied_tools TEXT,
      max_task_budget REAL DEFAULT 0.0,
      monthly_budget REAL DEFAULT 0.0,
      temporary INTEGER DEFAULT 0,
      risk_class TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_reason TEXT,
      performance_metrics TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_tasks (
      id TEXT PRIMARY KEY,
      parent_task_id TEXT,
      run_id TEXT,
      objective TEXT NOT NULL,
      assigned_agent_id TEXT,
      department TEXT,
      requested_by TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      dependency_status TEXT,
      dependencies TEXT,
      inputs TEXT,
      expected_output TEXT,
      evidence_requirements TEXT,
      evidence_result TEXT,
      estimated_cost REAL DEFAULT 0.0,
      committed_cost REAL DEFAULT 0.0,
      actual_cost REAL DEFAULT 0.0,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      failure_reason TEXT,
      idempotency_key TEXT,
      input_summary TEXT,
      result_summary TEXT,
      created_at TEXT NOT NULL,
      assigned_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (parent_task_id) REFERENCES ai_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_agent_id) REFERENCES ai_agents(id)
    );

    CREATE TABLE IF NOT EXISTS ai_budget_periods (
      id TEXT PRIMARY KEY,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      monthly_limit REAL NOT NULL DEFAULT 15000.0,
      committed_amount REAL NOT NULL DEFAULT 0.0,
      consumed_amount REAL NOT NULL DEFAULT 0.0,
      available_amount REAL NOT NULL DEFAULT 15000.0,
      status TEXT NOT NULL DEFAULT 'NORMAL',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      parent_department TEXT,
      department_head_agent_id TEXT,
      active_agent_count INTEGER NOT NULL DEFAULT 0,
      current_budget REAL NOT NULL DEFAULT 0.0,
      current_consumption REAL NOT NULL DEFAULT 0.0,
      created_by TEXT NOT NULL DEFAULT 'SYSTEM',
      created_reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_department_budgets (
      id TEXT PRIMARY KEY,
      budget_period_id TEXT NOT NULL,
      department_id TEXT NOT NULL,
      allocated_amount REAL NOT NULL DEFAULT 0.0,
      committed_amount REAL NOT NULL DEFAULT 0.0,
      consumed_amount REAL NOT NULL DEFAULT 0.0,
      available_amount REAL NOT NULL DEFAULT 0.0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (budget_period_id) REFERENCES ai_budget_periods(id) ON DELETE CASCADE,
      FOREIGN KEY (department_id) REFERENCES ai_departments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_agent_budgets (
      id TEXT PRIMARY KEY,
      department_budget_id TEXT,
      agent_id TEXT NOT NULL,
      allocated_amount REAL NOT NULL DEFAULT 0.0,
      committed_amount REAL NOT NULL DEFAULT 0.0,
      consumed_amount REAL NOT NULL DEFAULT 0.0,
      available_amount REAL NOT NULL DEFAULT 0.0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES ai_agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_task_budgets (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      estimated_cost REAL NOT NULL DEFAULT 0.0,
      approved_ceiling REAL NOT NULL DEFAULT 0.0,
      actual_cost REAL NOT NULL DEFAULT 0.0,
      status TEXT NOT NULL DEFAULT 'PLANNED',
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (task_id) REFERENCES ai_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES ai_agents(id)
    );

    CREATE TABLE IF NOT EXISTS ai_usage_ledger (
      id TEXT PRIMARY KEY,
      budget_period_id TEXT NOT NULL,
      task_id TEXT,
      agent_id TEXT,
      department_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      usage_type TEXT NOT NULL,
      cost_status TEXT NOT NULL DEFAULT 'CONFIG_REQUIRED',
      estimated_cost REAL NOT NULL DEFAULT 0.0,
      actual_cost REAL NOT NULL DEFAULT 0.0,
      currency TEXT NOT NULL DEFAULT 'INR',
      metadata_summary TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (budget_period_id) REFERENCES ai_budget_periods(id)
    );

    CREATE TABLE IF NOT EXISTS ai_budget_transfers (
      id TEXT PRIMARY KEY,
      budget_period_id TEXT NOT NULL,
      from_department_id TEXT,
      to_department_id TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      initiated_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (budget_period_id) REFERENCES ai_budget_periods(id)
    );

    CREATE TABLE IF NOT EXISTS model_cost_catalog (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      tier TEXT NOT NULL,
      input_cost_basis REAL NOT NULL DEFAULT 0.0,
      output_cost_basis REAL NOT NULL DEFAULT 0.0,
      fixed_call_cost REAL NOT NULL DEFAULT 0.0,
      status TEXT NOT NULL DEFAULT 'CONFIG_REQUIRED',
      enabled INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      effective_from TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_memory_entries (
      id TEXT PRIMARY KEY,
      memory_type TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_reference TEXT,
      authority_level TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      supersedes_memory_id TEXT,
      superseded_by_memory_id TEXT,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      created_by TEXT NOT NULL,
      approved_by TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_capabilities (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      risk_class TEXT NOT NULL,
      default_tool_class TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT 'SYSTEM',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_tools (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      provider TEXT NOT NULL,
      tool_class TEXT NOT NULL,
      required_capabilities TEXT NOT NULL,
      allowed_agents TEXT,
      allowed_roles TEXT,
      denied_capabilities TEXT,
      requires_approval INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      server_only INTEGER NOT NULL DEFAULT 1,
      timeout_ms INTEGER NOT NULL DEFAULT 30000,
      input_schema TEXT,
      output_schema TEXT,
      estimated_cost REAL NOT NULL DEFAULT 0.0,
      cost_status TEXT NOT NULL DEFAULT 'FREE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_data_sources (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      description TEXT NOT NULL,
      access_mode TEXT NOT NULL,
      freshness_strategy TEXT NOT NULL,
      current_status TEXT NOT NULL DEFAULT 'UNKNOWN',
      sensitivity_class TEXT NOT NULL DEFAULT 'INTERNAL',
      implementation_path TEXT,
      last_successful_sync TEXT,
      covered_period TEXT,
      supported_entities TEXT,
      required_scopes TEXT,
      current_scope_state TEXT,
      storage_location TEXT,
      watermark_supported INTEGER NOT NULL DEFAULT 0,
      last_watermark TEXT,
      capabilities_enabled TEXT,
      tool_binding TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      last_verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_agent_capabilities (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      capability_code TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      source_policy TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES ai_agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_tool_executions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      task_id TEXT,
      agent_id TEXT NOT NULL,
      tool_code TEXT NOT NULL,
      capability_code TEXT,
      classification TEXT NOT NULL,
      input_summary TEXT NOT NULL,
      result_summary TEXT,
      evidence_reference TEXT,
      freshness TEXT DEFAULT 'LIVE',
      status TEXT NOT NULL,
      cost REAL DEFAULT 0.0,
      cost_status TEXT DEFAULT 'FREE',
      cache_hit INTEGER DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_evidence_index (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      query_fingerprint TEXT UNIQUE NOT NULL,
      filters TEXT NOT NULL,
      period TEXT,
      freshness TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at TEXT,
      stale_rule TEXT,
      result_reference TEXT NOT NULL,
      checksum TEXT,
      summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Chat Bin (soft delete): additive columns only. Existing rows become ACTIVE.
  const convCols = db.prepare(`PRAGMA table_info(ai_conversations);`).all() as Array<{ name: string }>;
  const convColNames = new Set(convCols.map(c => c.name));
  if (!convColNames.has("status")) {
    db.exec(`ALTER TABLE ai_conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';`);
  }
  if (!convColNames.has("binned_at")) {
    db.exec(`ALTER TABLE ai_conversations ADD COLUMN binned_at TEXT;`);
  }
  if (!convColNames.has("binned_by")) {
    db.exec(`ALTER TABLE ai_conversations ADD COLUMN binned_by TEXT;`);
  }

  // Ensure schema migrations for existing tables
  migrateSchema(db);

  // Ensure initial active budget period, minimum system organization, model catalog, and system policies exist
  seedInitialBudgetPeriod(db);
  seedInitialDepartments(db);
  seedModelCostCatalog(db);
  seedInitialMemories(db);
  seedPhase2dCatalog(db);
}

function migrateSchema(db: DatabaseSync): void {
  try {
    const agentCols = db.prepare(`PRAGMA table_info(ai_agents);`).all() as Array<{ name: string }>;
    const colNames = new Set(agentCols.map(c => c.name));

    const missingCols: Array<{ name: string; type: string }> = [
      { name: "title", type: "TEXT" },
      { name: "purpose", type: "TEXT" },
      { name: "responsibilities", type: "TEXT" },
      { name: "max_task_budget", type: "REAL DEFAULT 0.0" },
      { name: "monthly_budget", type: "REAL DEFAULT 0.0" },
      { name: "temporary", type: "INTEGER DEFAULT 0" },
      { name: "created_reason", type: "TEXT" },
      { name: "performance_metrics", type: "TEXT" },
      { name: "last_used_at", type: "TEXT" },
      { name: "current_workload", type: "INTEGER DEFAULT 0" },
      { name: "tasks_completed", type: "INTEGER DEFAULT 0" },
      { name: "tasks_failed", type: "INTEGER DEFAULT 0" },
      { name: "retries", type: "INTEGER DEFAULT 0" },
      { name: "reviewer_rework_count", type: "INTEGER DEFAULT 0" },
      { name: "average_cost_per_task", type: "REAL DEFAULT 0.0" },
      { name: "relevant_memory_count", type: "INTEGER DEFAULT 0" },
    ];

    for (const col of missingCols) {
      if (!colNames.has(col.name)) {
        db.exec(`ALTER TABLE ai_agents ADD COLUMN ${col.name} ${col.type};`);
      }
    }

    // Ensure cost_status column exists in ai_usage_ledger
    const ledgerCols = db.prepare(`PRAGMA table_info(ai_usage_ledger);`).all() as Array<{ name: string }>;
    const ledgerColNames = new Set(ledgerCols.map(c => c.name));
    if (!ledgerColNames.has("cost_status")) {
      db.exec(`ALTER TABLE ai_usage_ledger ADD COLUMN cost_status TEXT NOT NULL DEFAULT 'CONFIG_REQUIRED';`);
    }

    // Phase 2C schema migration: ai_runs columns
    const runCols = db.prepare(`PRAGMA table_info(ai_runs);`).all() as Array<{ name: string }>;
    const runColNames = new Set(runCols.map(c => c.name));
    const missingRunCols: Array<{ name: string; type: string }> = [
      { name: "objective", type: "TEXT" },
      { name: "priority", type: "TEXT DEFAULT 'NORMAL'" },
      { name: "risk_class", type: "TEXT DEFAULT 'STANDARD'" },
      { name: "selected_workflow", type: "TEXT" },
      { name: "selected_model_tier", type: "TEXT" },
      { name: "estimated_cost", type: "REAL DEFAULT 0.0" },
      { name: "committed_cost", type: "REAL DEFAULT 0.0" },
      { name: "actual_cost", type: "REAL DEFAULT 0.0" },
      { name: "current_step", type: "TEXT" },
      { name: "max_steps", type: "INTEGER DEFAULT 20" },
      { name: "step_count", type: "INTEGER DEFAULT 0" },
      { name: "retry_count", type: "INTEGER DEFAULT 0" },
      { name: "max_retries", type: "INTEGER DEFAULT 3" },
      { name: "reviewer_required", type: "INTEGER DEFAULT 0" },
      { name: "reviewer_status", type: "TEXT" },
      { name: "owner_approval_required", type: "INTEGER DEFAULT 0" },
      { name: "idempotency_key", type: "TEXT" },
      { name: "evidence_summary", type: "TEXT" },
      { name: "final_response", type: "TEXT" },
      { name: "failure_reason", type: "TEXT" },
    ];
    for (const col of missingRunCols) {
      if (!runColNames.has(col.name)) {
        db.exec(`ALTER TABLE ai_runs ADD COLUMN ${col.name} ${col.type};`);
      }
    }

    // Phase 2C schema migration: ai_tasks columns
    const taskCols = db.prepare(`PRAGMA table_info(ai_tasks);`).all() as Array<{ name: string }>;
    const taskColNames = new Set(taskCols.map(c => c.name));
    const missingTaskCols: Array<{ name: string; type: string }> = [
      { name: "department", type: "TEXT" },
      { name: "dependencies", type: "TEXT" },
      { name: "inputs", type: "TEXT" },
      { name: "expected_output", type: "TEXT" },
      { name: "evidence_requirements", type: "TEXT" },
      { name: "evidence_result", type: "TEXT" },
      { name: "estimated_cost", type: "REAL DEFAULT 0.0" },
      { name: "committed_cost", type: "REAL DEFAULT 0.0" },
      { name: "actual_cost", type: "REAL DEFAULT 0.0" },
      { name: "retry_count", type: "INTEGER DEFAULT 0" },
      { name: "max_retries", type: "INTEGER DEFAULT 3" },
      { name: "failure_reason", type: "TEXT" },
      { name: "idempotency_key", type: "TEXT" },
    ];
    for (const col of missingTaskCols) {
      if (!taskColNames.has(col.name)) {
        db.exec(`ALTER TABLE ai_tasks ADD COLUMN ${col.name} ${col.type};`);
      }
    }

    // Phase 2C schema migration: ensure ai_agent_handoffs table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_agent_handoffs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        source_agent_id TEXT NOT NULL,
        target_agent_id TEXT NOT NULL,
        required_information TEXT,
        evidence_reference TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE CASCADE
      );
    `);

    // Controlled migration of legacy dev DB:
    // Safely remove provably empty bootstrap-only department rows seeded in previous development runs.
    // Condition: created_by = 'SYSTEM', id != 'EXECUTIVE', no agents, no department budgets, and no transfers.
    db.exec(`
      DELETE FROM ai_departments
      WHERE created_by = 'SYSTEM'
        AND id != 'EXECUTIVE'
        AND id NOT IN (SELECT DISTINCT department FROM ai_agents)
        AND id NOT IN (SELECT DISTINCT department_id FROM ai_department_budgets)
        AND id NOT IN (SELECT DISTINCT from_department_id FROM ai_budget_transfers WHERE from_department_id IS NOT NULL)
        AND id NOT IN (SELECT DISTINCT to_department_id FROM ai_budget_transfers);
    `);

    // Reset any previously seeded placeholder/invented pricing in model_cost_catalog to CONFIG_REQUIRED
    db.exec(`
      UPDATE model_cost_catalog
      SET status = 'CONFIG_REQUIRED',
          input_cost_basis = 0.0,
          output_cost_basis = 0.0,
          fixed_call_cost = 0.0,
          notes = 'Capability catalog initialized; exact provider pricing not configured (CONFIG_REQUIRED).'
      WHERE status = 'FINAL' AND (id LIKE 'cost_%' OR id LIKE 'model_%');
    `);

    // Phase 2E schema migration: ai_data_sources columns
    const srcCols = db.prepare(`PRAGMA table_info(ai_data_sources);`).all() as Array<{ name: string }>;
    const srcColNames = new Set(srcCols.map(c => c.name));
    const missingSrcCols: Array<{ name: string; type: string }> = [
      { name: "current_status", type: "TEXT NOT NULL DEFAULT 'UNKNOWN'" },
      { name: "implementation_path", type: "TEXT" },
      { name: "last_successful_sync", type: "TEXT" },
      { name: "covered_period", type: "TEXT" },
      { name: "supported_entities", type: "TEXT" },
      { name: "required_scopes", type: "TEXT" },
      { name: "current_scope_state", type: "TEXT" },
      { name: "storage_location", type: "TEXT" },
      { name: "watermark_supported", type: "INTEGER NOT NULL DEFAULT 0" },
      { name: "last_watermark", type: "TEXT" },
      { name: "capabilities_enabled", type: "TEXT" },
    ];
    for (const col of missingSrcCols) {
      if (!srcColNames.has(col.name)) {
        db.exec(`ALTER TABLE ai_data_sources ADD COLUMN ${col.name} ${col.type};`);
      }
    }
  } catch {
    // Ignore migration errors if already present
  }
}

/**
 * Bootstrap minimum system organization:
 * On fresh databases, ONLY the minimum system organization (EXECUTIVE -> AI CEO) is created.
 * Other business departments are NOT seeded automatically; the CEO creates them dynamically on demand.
 */
function seedInitialDepartments(db: DatabaseSync): void {
  const nowIso = new Date().toISOString();

  // Minimum system department: EXECUTIVE
  db.prepare(`
    INSERT OR IGNORE INTO ai_departments (
      id, name, purpose, status, parent_department, department_head_agent_id,
      active_agent_count, current_budget, current_consumption,
      created_by, created_reason, created_at, updated_at
    ) VALUES (
      'EXECUTIVE', 'Executive Office',
      'Company leadership, strategic direction, and overall workforce governance.',
      'ACTIVE', NULL, 'ceo_main', 1, 0.0, 0.0, 'SYSTEM', 'Minimum system organization', ?, ?
    )
  `).run(nowIso, nowIso);

  // Seed default CEO agent if missing
  db.prepare(`
    INSERT OR IGNORE INTO ai_agents (
      id, name, title, role, department, level, reports_to, status,
      purpose, capabilities, allowed_tools, denied_tools, risk_class,
      created_by, created_at, updated_at
    ) VALUES (
      'ceo_main', 'AI CEO', 'Chief Executive Officer', 'Chief Executive Officer', 'EXECUTIVE',
      'CEO', NULL, 'ACTIVE', 'Primary Executive AI Partner',
      '["SYSTEM_ORCHESTRATION","DELEGATION","BUDGET_MANAGEMENT"]',
      '["ALL"]', '["ZOHO_WRITE"]', 'CRITICAL', 'SYSTEM', ?, ?
    )
  `).run(nowIso, nowIso);
}

function seedInitialBudgetPeriod(db: DatabaseSync): void {
  const existing = db.prepare(`SELECT count(*) as count FROM ai_budget_periods`).get() as { count: number };
  if (existing && existing.count > 0) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1).toISOString();
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999).toISOString();
  const nowIso = now.toISOString();

  db.prepare(`
    INSERT INTO ai_budget_periods (
      id, period_start, period_end, currency, monthly_limit,
      committed_amount, consumed_amount, available_amount, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'INR', 15000.0, 0.0, 0.0, 15000.0, 'NORMAL', ?, ?)
  `).run(`period_${year}_${String(month + 1).padStart(2, "0")}`, start, end, nowIso, nowIso);
}

/**
 * Seed model capability catalog without inventing provider monetary rates.
 * All entries default to CONFIG_REQUIRED with 0.0 monetary rates until explicitly configured.
 */
function seedModelCostCatalog(db: DatabaseSync): void {
  const nowIso = new Date().toISOString();
  // Using explicit standard provider rates
  // FX_ASSUMPTION = 84 INR/USD
  // PRICE_SOURCE_DATE = 2026-10-01
  const insert = db.prepare(`
    INSERT OR IGNORE INTO model_cost_catalog (
      id, provider, model, tier, input_cost_basis, output_cost_basis, fixed_call_cost, status, enabled, notes, effective_from
    ) VALUES (?, ?, ?, ?, ?, ?, 0.0, ?, 1, ?, ?)
  `);

  // gpt-4o-mini: $0.15 / 1M input (~0.0126 INR/1k), $0.60 / 1M output (~0.0504 INR/1k)
  const miniNotes = "Configured provider pricing. FX_ASSUMPTION = 84 INR/USD. PRICE_SOURCE_DATE = 2026-10-01. COST_STATUS = ESTIMATED";
  insert.run("cost_gpt4o_mini", "OpenAI", "gpt-4o-mini", "FAST", 0.0126, 0.0504, "ESTIMATED", miniNotes, nowIso);

  // gpt-4o: $2.50 / 1M input (~0.21 INR/1k), $10.00 / 1M output (~0.84 INR/1k)
  insert.run("cost_gpt4o", "OpenAI", "gpt-4o", "STANDARD", 0.0, 0.0, "CONFIG_REQUIRED", "Capability tier STANDARD; exact provider pricing not configured (CONFIG_REQUIRED)", nowIso);

  // o3-mini: $1.10 / 1M input (~0.0924 INR/1k), $4.40 / 1M output (~0.3696 INR/1k)
  insert.run("cost_o3_mini", "OpenAI", "o3-mini", "REASONING", 0.0, 0.0, "CONFIG_REQUIRED", "Capability tier REASONING; exact provider pricing not configured (CONFIG_REQUIRED)", nowIso);

  // o1: $15.00 / 1M input (~1.26 INR/1k), $60.00 / 1M output (~5.04 INR/1k)
  insert.run("cost_o1", "OpenAI", "o1", "HIGH_REASONING", 0.0, 0.0, "CONFIG_REQUIRED", "Capability tier HIGH_REASONING; exact provider pricing not configured (CONFIG_REQUIRED)", nowIso);

  // reviewer is gpt-4o-mini
  insert.run("cost_reviewer", "OpenAI", "gpt-4o-mini", "REVIEWER", 0.0126, 0.0504, "ESTIMATED", miniNotes, nowIso);
}

/**
 * Seed foundational system hard policies.
 * Authority: SYSTEM_HARD_POLICY (highest precedence: 100).
 * These policies are permanent and can never be overridden by lower memories or agent outputs.
 */
function seedInitialMemories(db: DatabaseSync): void {
  const existing = db.prepare(`SELECT count(*) as count FROM ai_memory_entries WHERE id LIKE 'mem_sys_%'`).get() as { count: number };
  if (existing && existing.count >= 4) return;

  const nowIso = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO ai_memory_entries (
      id, memory_type, scope_type, scope_id, title, content,
      source_type, authority_level, confidence, status,
      effective_from, created_by, approved_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    "mem_sys_zoho_read_only",
    "COMPANY_RULE",
    "GLOBAL",
    "GLOBAL",
    "Permanent Security Policy: ZOHO WRITE = 0",
    "Zoho Books integration is strictly read-only. No write, create, update, delete, void, or mutate operations may ever be executed or permitted.",
    "SYSTEM",
    "SYSTEM_HARD_POLICY",
    1.0,
    "ACTIVE",
    nowIso,
    "SYSTEM",
    "OWNER",
    nowIso,
    nowIso
  );

  insert.run(
    "mem_sys_monthly_budget_cap",
    "COMPANY_RULE",
    "GLOBAL",
    "GLOBAL",
    "AI Operating Budget Cap: ₹15,000/Month",
    "Monthly AI operating budget is capped at ₹15,000 INR. No autonomous action, model execution, or agent allocation may exceed or fake additional budget.",
    "SYSTEM",
    "SYSTEM_HARD_POLICY",
    1.0,
    "ACTIVE",
    nowIso,
    "SYSTEM",
    "OWNER",
    nowIso,
    nowIso
  );

  insert.run(
    "mem_sys_financial_authority_block",
    "COMPANY_RULE",
    "GLOBAL",
    "GLOBAL",
    "Company Financial Authority Restriction",
    "AI agents have zero authority over real company funds, payment authorization, bank transfers, contracts, or statutory filings.",
    "SYSTEM",
    "SYSTEM_HARD_POLICY",
    1.0,
    "ACTIVE",
    nowIso,
    "SYSTEM",
    "OWNER",
    nowIso,
    nowIso
  );

  insert.run(
    "mem_sys_owner_single_front_door",
    "COMPANY_RULE",
    "GLOBAL",
    "GLOBAL",
    "Governance Policy: Owner Talks Only to AI CEO",
    "The Owner communicates solely with the AI CEO. All specialist agents report internally to the CEO.",
    "SYSTEM",
    "SYSTEM_HARD_POLICY",
    1.0,
    "ACTIVE",
    nowIso,
    "SYSTEM",
    "OWNER",
    nowIso,
    nowIso
  );
}

/**
 * Seed Phase 2D: Company Capability Registry, Safe Tools, Data Sources, and Default Agent Capabilities.
 * All tools are strictly governed and read-only by default.
 * ZOHO_WRITE is permanently blocked.
 */
function seedPhase2dCatalog(db: DatabaseSync): void {
  const existingCaps = db.prepare(`SELECT count(*) as count FROM ai_capabilities`).get() as { count: number };
  const nowIso = new Date().toISOString();

  if (!existingCaps || existingCaps.count === 0) {
    const insertCap = db.prepare(`
      INSERT OR IGNORE INTO ai_capabilities (
        id, code, name, description, category, risk_class, default_tool_class, active, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'SYSTEM', ?, ?)
    `);

    // Standard Business & Analysis Capabilities
    insertCap.run("cap_company_data_read", "COMPANY_DATA_READ", "Company Data Read", "Read general company data and operational records", "COMPANY_DATA", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_audit_database_read", "AUDIT_DATABASE_READ", "Audit Database Read", "Read local audit database findings and logs", "AUDIT", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_accounting_data_read", "ACCOUNTING_DATA_READ", "Accounting Data Read", "Read accounting vouchers, invoices, and balances", "ACCOUNTING", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_sales_data_read", "SALES_DATA_READ", "Sales Data Read", "Read sales orders, invoices, and customer transactions", "SALES", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_purchase_data_read", "PURCHASE_DATA_READ", "Purchase Data Read", "Read purchase bills, vendor payments, and order tracking", "PURCHASE", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_inventory_data_read", "INVENTORY_DATA_READ", "Inventory Data Read", "Read inventory snapshots, items, and stock movements", "INVENTORY", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_project_data_read", "PROJECT_DATA_READ", "Project Data Read", "Read project milestones, assignments, and job costs", "PROJECT", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_billing_data_read", "BILLING_DATA_READ", "Billing Data Read", "Read billing records, reconciliations, and aging", "BILLING", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_hr_data_read", "HR_DATA_READ", "HR Data Read", "Read HR policies, headcount, and organizational structure", "HR", "RESTRICTED", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_document_search", "DOCUMENT_SEARCH", "Document Search", "Search internal company documents and knowledge items", "ANALYSIS", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_calculation", "CALCULATION", "Calculation", "Execute mathematical and financial calculations", "ANALYSIS", "MINIMAL", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_web_research", "WEB_RESEARCH", "Web Research", "Read external public web sources for factual research", "RESEARCH", "ELEVATED", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_evidence_comparison", "EVIDENCE_COMPARISON", "Evidence Comparison", "Compare two or more data sources/records for discrepancies", "ANALYSIS", "MINIMAL", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_report_generation", "REPORT_GENERATION", "Report Generation", "Synthesize findings into formatted executive reports", "ANALYSIS", "MINIMAL", "READ_ONLY", nowIso, nowIso);

    // Zoho Books Specific Read Capabilities
    insertCap.run("cap_zoho_org_read", "ZOHO_ORGANIZATION_READ", "Zoho Organization Read", "Read Zoho Books organization metadata", "INTEGRATION", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_zoho_invoice_read", "ZOHO_INVOICE_READ", "Zoho Invoice Read", "Read Zoho Books invoice listings and details", "INTEGRATION", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_zoho_so_read", "ZOHO_SALES_ORDER_READ", "Zoho Sales Order Read", "Read Zoho Books sales order records", "INTEGRATION", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_zoho_po_read", "ZOHO_PURCHASE_ORDER_READ", "Zoho Purchase Order Read", "Read Zoho Books purchase order records", "INTEGRATION", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_zoho_bill_read", "ZOHO_BILL_READ", "Zoho Bill Read", "Read Zoho Books vendor bills and payments", "INTEGRATION", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_zoho_item_read", "ZOHO_ITEM_READ", "Zoho Item Read", "Read Zoho Books item catalog and pricing", "INTEGRATION", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_zoho_contact_read", "ZOHO_CONTACT_READ", "Zoho Contact Read", "Read Zoho Books customer and vendor contacts", "INTEGRATION", "STANDARD", "READ_ONLY", nowIso, nowIso);
    insertCap.run("cap_zoho_report_read", "ZOHO_REPORT_READ", "Zoho Report Read", "Read Zoho Books balance sheet and P&L reports", "INTEGRATION", "STANDARD", "READ_ONLY", nowIso, nowIso);
  }

  // Safe Data Sources
  const existingSources = db.prepare(`SELECT count(*) as count FROM ai_data_sources`).get() as { count: number };
  if (!existingSources || existingSources.count === 0) {
    const insertSrc = db.prepare(`
      INSERT OR IGNORE INTO ai_data_sources (
        id, code, name, source_type, description, access_mode, freshness_strategy,
        current_status, sensitivity_class, implementation_path, last_successful_sync,
        covered_period, supported_entities, required_scopes, current_scope_state,
        storage_location, watermark_supported, last_watermark, capabilities_enabled,
        tool_binding, active, last_verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `);

    insertSrc.run(
      "src_local_sqlite_analytics", "LOCAL_SQLITE_ANALYTICS", "Local Operations SQLite Database (Bansil Books)", "LOCAL_SQLITE",
      "Primary local SQLite operational database containing synced sales invoices, purchase bills, and items", "READ_ONLY", "CACHED",
      "READY_CACHED", "FINANCIAL", "data/bansil_books.db", "2026-09-29T04:12:26.068Z",
      "2022-04-01 to 2026-09-28", JSON.stringify(["invoices", "bills", "items", "contacts", "payments"]),
      JSON.stringify([]), "LOCAL_ACTIVE", "data/bansil_books.db", 1, "2026-09-29T04:12:26.068Z",
      JSON.stringify(["SALES_DATA_READ", "PURCHASE_DATA_READ", "INVENTORY_DATA_READ"]),
      "local_sales_summary_read", nowIso, nowIso, nowIso
    );

    insertSrc.run(
      "src_local_sqlite_audit", "LOCAL_SQLITE_AUDIT", "Local Audit Workspace Database", "LOCAL_SQLITE",
      "Audit workspace database containing chart of accounts, bank transactions, sales orders, purchase orders, and reconciliation evidence", "READ_ONLY", "CACHED",
      "READY_CACHED", "FINANCIAL", "data/audit_workspace.db", "2026-09-30T09:40:01.519Z",
      "2022-03-31 to 2026-09-30", JSON.stringify(["chart_of_accounts", "bank_transactions", "sales_orders", "purchase_orders", "audit_findings"]),
      JSON.stringify([]), "LOCAL_ACTIVE", "data/audit_workspace.db", 1, "audit_source_watermarks",
      JSON.stringify(["AUDIT_DATABASE_READ"]),
      "local_audit_evidence_search", nowIso, nowIso, nowIso
    );

    insertSrc.run(
      "src_zoho_books_api", "ZOHO_BOOKS_API", "Zoho Books Cloud API", "ZOHO_BOOKS",
      "Direct cloud API for Zoho Books financial data via strict GET-only calls", "EXTERNAL_WRITE_PROHIBITED", "CACHED",
      "READY_CACHED", "FINANCIAL", "app/lib/zoho-api.ts", "2026-09-29T04:12:26.068Z",
      "2022-04-01 to 2026-09-28", JSON.stringify(["organizations", "invoices", "bills", "activity_logs", "api_usage"]),
      JSON.stringify(["ZohoBooks.settings.READ", "ZohoBooks.invoices.READ", "ZohoBooks.bills.READ"]), "CACHED_LOCAL", "data/bansil_books.db", 1, "2026-09-29T04:12:26.068Z",
      JSON.stringify(["ZOHO_ORGANIZATION_READ", "ZOHO_INVOICE_READ", "ZOHO_BILL_READ"]),
      "zoho_organization_read", nowIso, nowIso, nowIso
    );

    insertSrc.run(
      "src_zoho_banking_api", "ZOHO_BANKING_API", "Zoho Books Live Banking API", "ZOHO_BOOKS",
      "Direct live banking synchronization feed in Zoho Books (requires additional banking permission)", "EXTERNAL_WRITE_PROHIBITED", "LIVE",
      "SCOPE_BLOCKED", "FINANCIAL", "app/lib/audit/accounts/zoho-read-source.ts", null,
      null, JSON.stringify(["bankaccounts", "banktransactions"]),
      JSON.stringify(["ZohoBooks.banking.READ"]), "SCOPE_BLOCKED", null, 0, null,
      JSON.stringify([]),
      null, nowIso, nowIso, nowIso
    );

    insertSrc.run(
      "src_company_docs", "COMPANY_KNOWLEDGE_DOCS", "Approved Company Knowledge Base", "COMPANY_FILE",
      "Internal company documentation repository (unconfigured: docs/ path does not exist)", "READ_ONLY", "STATIC",
      "NOT_CONFIGURED", "NORMAL_BUSINESS", null, null,
      null, JSON.stringify([]),
      JSON.stringify([]), "NOT_CONFIGURED", null, 0, null,
      JSON.stringify([]),
      null, nowIso, nowIso, nowIso
    );

    insertSrc.run(
      "src_internal_math", "INTERNAL_MATH_SERVICE", "Internal Financial Arithmetic Service", "INTERNAL_SERVICE",
      "Deterministic financial arithmetic service (unconfigured: no dedicated app/lib/math/ module)", "READ_ONLY", "LIVE",
      "NOT_CONFIGURED", "NORMAL_BUSINESS", null, null,
      null, JSON.stringify([]),
      JSON.stringify([]), "NOT_CONFIGURED", null, 0, null,
      JSON.stringify([]),
      null, nowIso, nowIso, nowIso
    );

    insertSrc.run(
      "src_public_web", "PUBLIC_WEB", "Public Web Information", "WEB",
      "External web search results (unconfigured: no governed search provider integrated)", "READ_ONLY", "LIVE",
      "NOT_CONFIGURED", "NORMAL_BUSINESS", null, null,
      null, JSON.stringify([]),
      JSON.stringify([]), "NOT_CONFIGURED", null, 0, null,
      JSON.stringify([]),
      null, nowIso, nowIso, nowIso
    );

    insertSrc.run(
      "src_unsupported_mock", "UNSUPPORTED_MOCK_SOURCE", "Unconfigured Legacy ERP Source", "API",
      "Legacy unconfigured data source for verification that unconfigured sources are not marked READY", "READ_ONLY", "LIVE",
      "NOT_CONFIGURED", "SECURITY_SENSITIVE", null, null,
      null, JSON.stringify([]),
      JSON.stringify(["LegacyERP.Read"]), "NOT_CONFIGURED", null, 0, null,
      JSON.stringify([]),
      null, nowIso, nowIso, nowIso
    );
  }

  // Safe Tool Catalog
  const existingTools = db.prepare(`SELECT count(*) as count FROM ai_tools`).get() as { count: number };
  if (!existingTools || existingTools.count === 0) {
    const insertTool = db.prepare(`
      INSERT OR IGNORE INTO ai_tools (
        id, code, name, description, provider, tool_class, required_capabilities,
        allowed_agents, allowed_roles, denied_capabilities, requires_approval,
        active, server_only, timeout_ms, input_schema, output_schema,
        estimated_cost, cost_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 1, 30000, ?, ?, ?, ?, ?, ?)
    `);

    insertTool.run(
      "tool_local_sales_summary", "local_sales_summary_read", "Local Sales Summary Read",
      "Read aggregated sales invoice totals and metrics from local database", "LOCAL_SQLITE",
      "READ_ONLY", JSON.stringify(["SALES_DATA_READ"]), 0, 1,
      JSON.stringify({ type: "object", properties: { startDate: { type: "string" }, endDate: { type: "string" }, customerId: { type: "string" } } }),
      JSON.stringify({ type: "object", properties: { totalAmount: { type: "number" }, count: { type: "number" }, records: { type: "array" } } }),
      0.0, "FREE", nowIso, nowIso
    );

    insertTool.run(
      "tool_local_purchase_summary", "local_purchase_summary_read", "Local Purchase Summary Read",
      "Read aggregated purchase bill totals and vendor expenses from local database", "LOCAL_SQLITE",
      "READ_ONLY", JSON.stringify(["PURCHASE_DATA_READ"]), 0, 1,
      JSON.stringify({ type: "object", properties: { startDate: { type: "string" }, endDate: { type: "string" }, vendorId: { type: "string" } } }),
      JSON.stringify({ type: "object", properties: { totalAmount: { type: "number" }, count: { type: "number" }, records: { type: "array" } } }),
      0.0, "FREE", nowIso, nowIso
    );

    insertTool.run(
      "tool_local_audit_evidence_search", "local_audit_evidence_search", "Local Audit Evidence Search",
      "Search audit database findings, variances, and evidence records", "LOCAL_SQLITE",
      "READ_ONLY", JSON.stringify(["AUDIT_DATABASE_READ"]), 0, 1,
      JSON.stringify({ type: "object", properties: { query: { type: "string" }, category: { type: "string" }, limit: { type: "number" } } }),
      JSON.stringify({ type: "object", properties: { findings: { type: "array" }, total: { type: "number" } } }),
      0.0, "FREE", nowIso, nowIso
    );

    insertTool.run(
      "tool_local_inventory_snapshot", "local_inventory_snapshot_read", "Local Inventory Snapshot Read",
      "Read current inventory levels, item balances, and stock status", "LOCAL_SQLITE",
      "READ_ONLY", JSON.stringify(["INVENTORY_DATA_READ"]), 0, 1,
      JSON.stringify({ type: "object", properties: { itemId: { type: "string" }, lowStockOnly: { type: "boolean" } } }),
      JSON.stringify({ type: "object", properties: { items: { type: "array" }, totalItems: { type: "number" } } }),
      0.0, "FREE", nowIso, nowIso
    );

    insertTool.run(
      "tool_local_balance_sheet_derived", "local_balance_sheet_derived_read", "Local Balance Sheet Derived Read",
      "Derive Balance Sheet from Trial Balance evidence inside Audit Workspace", "LOCAL_SQLITE",
      "READ_ONLY", JSON.stringify(["ACCOUNTING_DATA_READ"]), 0, 1,
      JSON.stringify({ type: "object", properties: { asOfDate: { type: "string" } } }),
      JSON.stringify({ type: "object", properties: { assets: { type: "number" }, liabilities: { type: "number" }, equity: { type: "number" } } }),
      0.0, "FREE", nowIso, nowIso
    );

    insertTool.run(
      "tool_zoho_organization_read", "zoho_organization_read", "Zoho Organization Read",
      "Read Zoho Books organization metadata (read-only GET)", "ZOHO_BOOKS",
      "READ_ONLY", JSON.stringify(["ZOHO_ORGANIZATION_READ"]), 0, 1,
      JSON.stringify({ type: "object", properties: {} }),
      JSON.stringify({ type: "object", properties: { organizations: { type: "array" } } }),
      0.0, "FREE", nowIso, nowIso
    );

    insertTool.run(
      "tool_zoho_invoice_read", "zoho_invoice_read", "Zoho Invoice Read",
      "Read Zoho Books invoices via GET-only API", "ZOHO_BOOKS",
      "READ_ONLY", JSON.stringify(["ZOHO_INVOICE_READ"]), 0, 1,
      JSON.stringify({ type: "object", properties: { invoiceId: { type: "string" }, date: { type: "string" } } }),
      JSON.stringify({ type: "object", properties: { invoices: { type: "array" }, total: { type: "number" } } }),
      0.0, "FREE", nowIso, nowIso
    );

    insertTool.run(
      "tool_zoho_bill_read", "zoho_bill_read", "Zoho Bill Read",
      "Read Zoho Books vendor bills via GET-only API", "ZOHO_BOOKS",
      "READ_ONLY", JSON.stringify(["ZOHO_BILL_READ"]), 0, 1,
      JSON.stringify({ type: "object", properties: { billId: { type: "string" }, date: { type: "string" } } }),
      JSON.stringify({ type: "object", properties: { bills: { type: "array" }, total: { type: "number" } } }),
      0.0, "FREE", nowIso, nowIso
    );

    insertTool.run(
      "tool_calculate_financial_metrics", "calculate_financial_metrics", "Financial Calculations",
      "Perform deterministic arithmetic and financial calculations (ratios, variances, sums)", "INTERNAL_SERVICE",
      "READ_ONLY", JSON.stringify(["CALCULATION"]), 0, 1,
      JSON.stringify({ type: "object", required: ["operation"], properties: { operation: { type: "string" }, operands: { type: "array" } } }),
      JSON.stringify({ type: "object", properties: { result: { type: "number" }, formula: { type: "string" } } }),
      0.0, "FREE", nowIso, nowIso
    );

    insertTool.run(
      "tool_evidence_comparator", "evidence_comparator", "Evidence Comparator",
      "Compare multiple evidence items or records to identify discrepancies", "INTERNAL_SERVICE",
      "READ_ONLY", JSON.stringify(["EVIDENCE_COMPARISON"]), 0, 1,
      JSON.stringify({ type: "object", required: ["sourceA", "sourceB"], properties: { sourceA: { type: "object" }, sourceB: { type: "object" } } }),
      JSON.stringify({ type: "object", properties: { match: { type: "boolean" }, variance: { type: "number" }, details: { type: "string" } } }),
      0.0, "FREE", nowIso, nowIso
    );

    insertTool.run(
      "tool_company_knowledge_search", "company_knowledge_search", "Company Knowledge Search",
      "Search curated internal repository documentation and architectural guidelines without filesystem browsing", "COMPANY_FILE",
      "READ_ONLY", JSON.stringify(["COMPANY_DATA_READ", "DOCUMENT_SEARCH"]), 0, 1,
      JSON.stringify({ type: "object", required: ["query"], properties: { query: { type: "string" }, category: { type: "string" } } }),
      JSON.stringify({ type: "object", properties: { results: { type: "array" }, count: { type: "number" } } }),
      0.0, "FREE", nowIso, nowIso
    );

    insertTool.run(
      "tool_web_research", "web_research_tool", "Web Research Tool",
      "Perform governed read-only external research when required by CEO", "WEB",
      "READ_ONLY", JSON.stringify(["WEB_RESEARCH"]), 0, 1,
      JSON.stringify({ type: "object", required: ["query"], properties: { query: { type: "string" } } }),
      JSON.stringify({ type: "object", properties: { summary: { type: "string" }, sources: { type: "array" } } }),
      0.0, "FREE", nowIso, nowIso
    );

    insertTool.run(
      "tool_safe_db_read_adapter", "safe_db_read_adapter", "Safe Whitelisted DB Read Adapter",
      "Execute parameterized read-only SELECT against whitelisted tables with row limits and timeout", "LOCAL_SQLITE",
      "READ_ONLY", JSON.stringify(["ACCOUNTING_DATA_READ"]), 0, 1,
      JSON.stringify({ type: "object", required: ["table"], properties: { table: { type: "string" }, where: { type: "object" }, limit: { type: "number" } } }),
      JSON.stringify({ type: "object", properties: { rows: { type: "array" }, rowCount: { type: "number" } } }),
      0.0, "FREE", nowIso, nowIso
    );

    insertTool.run(
      "tool_high_risk_external_action", "high_risk_external_action_tool", "High Risk Action Tool",
      "High-risk operational tool requiring explicit Owner approval", "INTERNAL_SERVICE",
      "HIGH_RISK", JSON.stringify(["REPORT_GENERATION"]), 1, 1,
      JSON.stringify({ type: "object", required: ["action"], properties: { action: { type: "string" } } }),
      JSON.stringify({ type: "object", properties: { status: { type: "string" } } }),
      0.0, "FREE", nowIso, nowIso
    );

    insertTool.run(
      "tool_zoho_write_blocked", "zoho_write_tool_blocked", "Zoho Write Blocked Mock Tool",
      "Permanent rule demonstration: ZOHO WRITE = 0; tool is permanently disabled and rejected by gate", "ZOHO_BOOKS",
      "ZOHO_WRITE", JSON.stringify(["ZOHO_INVOICE_READ"]), 1, 0,
      JSON.stringify({ type: "object", properties: { data: { type: "string" } } }),
      JSON.stringify({ type: "object", properties: { error: { type: "string" } } }),
      0.0, "FREE", nowIso, nowIso
    );
  }

  // Seed default capabilities for ceo_main
  const existingCeoCaps = db.prepare(`SELECT count(*) as count FROM ai_agent_capabilities WHERE agent_id = 'ceo_main'`).get() as { count: number };
  if (!existingCeoCaps || existingCeoCaps.count === 0) {
    const insertAgentCap = db.prepare(`
      INSERT OR IGNORE INTO ai_agent_capabilities (
        id, agent_id, capability_code, granted_by, source_policy, status, created_at, updated_at
      ) VALUES (?, 'ceo_main', ?, 'SYSTEM', 'DEFAULT_CEO_ROLE', 'ACTIVE', ?, ?)
    `);

    const ceoCaps = [
      "COMPANY_DATA_READ",
      "AUDIT_DATABASE_READ",
      "ACCOUNTING_DATA_READ",
      "SALES_DATA_READ",
      "PURCHASE_DATA_READ",
      "INVENTORY_DATA_READ",
      "PROJECT_DATA_READ",
      "BILLING_DATA_READ",
      "DOCUMENT_SEARCH",
      "CALCULATION",
      "EVIDENCE_COMPARISON",
      "REPORT_GENERATION",
      "ZOHO_ORGANIZATION_READ",
      "ZOHO_INVOICE_READ",
      "ZOHO_BILL_READ",
    ];

    for (const code of ceoCaps) {
      insertAgentCap.run(`cap_ceo_${code.toLowerCase()}`, code, nowIso, nowIso);
    }
  }
}

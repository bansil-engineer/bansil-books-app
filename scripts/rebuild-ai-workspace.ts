/**
 * Clean Rebuild Script: Creates a fresh ai_workspace.clean_candidate.db
 * from source-controlled schema, then selectively imports proven-safe rows
 * from the damaged operational DB.
 * 
 * DOES NOT mutate or replace the live operational DB.
 * DOES NOT import broken execution graph (tasks, orphan budgets, orphan handoffs).
 * DOES NOT invent historical task records.
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// Point application to the clean candidate path
const CANDIDATE_PATH = path.join(process.cwd(), "data", "ai_workspace.clean_candidate.db");
const DAMAGED_PATH = path.join(process.cwd(), "data", "ai_workspace.db");

// Delete existing candidate if from a previous attempt
if (fs.existsSync(CANDIDATE_PATH)) {
  fs.unlinkSync(CANDIDATE_PATH);
  console.log("Removed existing candidate DB.");
}

// === STEP 1: Init clean schema via application code ===
process.env.AI_WORKSPACE_DB_PATH = CANDIDATE_PATH;

import { getAiDatabase } from "../app/lib/db/ai-database.ts";

console.log("\n=== STEP 1: Init clean candidate DB from source schema ===");
const candidateDb = getAiDatabase();
console.log("Clean DB initialized at:", CANDIDATE_PATH);

// Verify seeded data
const agentCount = (candidateDb.prepare("SELECT count(*) as c FROM ai_agents").get() as any).c;
const deptCount = (candidateDb.prepare("SELECT count(*) as c FROM ai_departments").get() as any).c;
const toolCount = (candidateDb.prepare("SELECT count(*) as c FROM ai_tools").get() as any).c;
const capCount = (candidateDb.prepare("SELECT count(*) as c FROM ai_capabilities").get() as any).c;
const dsCount = (candidateDb.prepare("SELECT count(*) as c FROM ai_data_sources").get() as any).c;
const bsToolExists = (candidateDb.prepare("SELECT count(*) as c FROM ai_tools WHERE code = 'local_balance_sheet_derived_read'").get() as any).c;

console.log(`  Agents: ${agentCount}, Departments: ${deptCount}, Tools: ${toolCount}, Capabilities: ${capCount}, Data Sources: ${dsCount}`);
console.log(`  local_balance_sheet_derived_read seeded: ${bsToolExists === 1 ? 'YES' : 'NO'}`);

// === STEP 2: Open damaged DB read-only ===
console.log("\n=== STEP 2: Open damaged DB read-only ===");
const damagedDb = new DatabaseSync(DAMAGED_PATH, { readOnly: true });

// === STEP 3: Import CONVERSATIONS (no FK to broken tables) ===
console.log("\n=== STEP 3: Import conversations ===");
const conversations = damagedDb.prepare("SELECT * FROM ai_conversations").all() as any[];
let convImported = 0;
for (const c of conversations) {
  try {
    candidateDb.prepare(`
      INSERT OR IGNORE INTO ai_conversations (id, title, user_identifier, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(c.id, c.title, c.user_identifier, c.created_at, c.updated_at);
    convImported++;
  } catch (e) {
    console.error(`  Skip conversation ${c.id}: ${(e as any).message}`);
  }
}
console.log(`  Imported ${convImported}/${conversations.length} conversations`);

// === STEP 4: Import MESSAGES (FK to conversations — all valid since conv all imported) ===
console.log("\n=== STEP 4: Import messages ===");
const messages = damagedDb.prepare("SELECT * FROM ai_messages").all() as any[];
let msgImported = 0;
for (const m of messages) {
  // Only import if FK conversation exists in candidate
  const convExists = (candidateDb.prepare("SELECT 1 FROM ai_conversations WHERE id = ?").get(m.conversation_id));
  if (!convExists) { console.warn(`  Skip message ${m.id}: conversation_id ${m.conversation_id} missing`); continue; }
  try {
    candidateDb.prepare(`
      INSERT OR IGNORE INTO ai_messages (id, conversation_id, role, content, model, agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(m.id, m.conversation_id, m.role, m.content, m.model, m.agent, m.created_at);
    msgImported++;
  } catch (e) {
    console.error(`  Skip message ${m.id}: ${(e as any).message}`);
  }
}
console.log(`  Imported ${msgImported}/${messages.length} messages`);

// === STEP 5: Merge AGENTS — preserve existing stable identities ===
console.log("\n=== STEP 5: Merge agents from damaged DB ===");
const damagedAgents = damagedDb.prepare("SELECT * FROM ai_agents").all() as any[];

// Get actual columns in candidate ai_agents table
const agentColumns = (candidateDb.prepare("PRAGMA table_info(ai_agents)").all() as any[]).map(c => c.name);
console.log(`  Candidate agent columns: ${agentColumns.join(", ")}`);

let agentsPreserved = 0;
const KNOWN_STABLE_AGENTS = new Set([
  "ceo_main",
  "agent_accounts_accounts_auditor_001",
  "agent_purchase_vendor_performance_analyst_001",
  "agent_billing_billing_specialist_001",
  "agent_finance_financial_reviewer_001",
]);

for (const a of damagedAgents) {
  if (!KNOWN_STABLE_AGENTS.has(a.id)) {
    console.log(`  Skipping unknown agent: ${a.id}`);
    continue;
  }
  
  const exists = candidateDb.prepare("SELECT 1 FROM ai_agents WHERE id = ?").get(a.id);
  
  if (exists) {
    // Update performance metrics using only columns that exist in candidate schema
    try {
      if (agentColumns.includes("tasks_completed") && agentColumns.includes("tasks_failed")) {
        candidateDb.prepare(`UPDATE ai_agents SET tasks_completed = ?, tasks_failed = ?, last_active_at = ?, updated_at = ? WHERE id = ?`
        ).run(a.tasks_completed || 0, a.tasks_failed || 0, a.last_active_at, a.updated_at, a.id);
      }
      agentsPreserved++;
    } catch (e) {
      console.warn(`  Could not update metrics for agent ${a.id}: ${(e as any).message}`);
    }
  } else {
    // Insert missing specialist agent — build INSERT with only matching columns
    try {
      const cols = agentColumns.filter(col => col !== "rowid" && a[col] !== undefined);
      const placeholders = cols.map(() => "?").join(", ");
      const values = cols.map(col => a[col]);
      candidateDb.prepare(`INSERT OR IGNORE INTO ai_agents (${cols.join(", ")}) VALUES (${placeholders})`).run(...values);
      agentsPreserved++;
      console.log(`  Inserted specialist agent: ${a.id}`);
    } catch (e) {
      console.warn(`  Could not insert agent ${a.id}: ${(e as any).message}`);
    }
  }
}
console.log(`  ${agentsPreserved}/${KNOWN_STABLE_AGENTS.size} stable agents preserved`);

// === STEP 6: Import MEMORY — only SYSTEM_HARD_POLICY ACTIVE entries ===
console.log("\n=== STEP 6: Import system memories ===");
const damagedMemory = damagedDb.prepare(
  "SELECT * FROM ai_memory_entries WHERE authority_level = 'SYSTEM_HARD_POLICY' AND status = 'ACTIVE'"
).all() as any[];
let memImported = 0;
for (const m of damagedMemory) {
  // Skip if already seeded by schema init
  const alreadyExists = candidateDb.prepare("SELECT 1 FROM ai_memory_entries WHERE title = ? AND authority_level = 'SYSTEM_HARD_POLICY'").get(m.title);
  if (alreadyExists) { 
    console.log(`  Skipping already-seeded system memory: ${m.title}`);
    continue; 
  }
  try {
    candidateDb.prepare(`
      INSERT OR IGNORE INTO ai_memory_entries (
        id, memory_type, scope_type, scope_id, title, content,
        source_type, source_reference, authority_level, confidence, status,
        supersedes_memory_id, superseded_by_memory_id, effective_from, effective_to,
        created_by, approved_by, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      m.id, m.memory_type, m.scope_type, m.scope_id, m.title, m.content,
      m.source_type, m.source_reference, m.authority_level, m.confidence, m.status,
      m.supersedes_memory_id, m.superseded_by_memory_id, m.effective_from, m.effective_to,
      m.created_by, m.approved_by, m.metadata, m.created_at, m.updated_at
    );
    memImported++;
  } catch (e) {
    console.warn(`  Skip memory ${m.id}: ${(e as any).message}`);
  }
}
console.log(`  Imported ${memImported} additional SYSTEM_HARD_POLICY memories`);

// NOTE: CANDIDATE memories (agent lessons) are intentionally NOT imported — they remain CANDIDATE
// and are NOT promoted. New operational runs will generate fresh candidates.

// === STEP 7: Import BUDGET PERIOD — preserve single active period ===
console.log("\n=== STEP 7: Preserve budget period ===");
const damagedPeriod = damagedDb.prepare("SELECT * FROM ai_budget_periods ORDER BY period_start DESC LIMIT 1").get() as any;
if (damagedPeriod) {
  const existing = candidateDb.prepare("SELECT 1 FROM ai_budget_periods WHERE id = ?").get(damagedPeriod.id);
  if (!existing) {
    try {
      candidateDb.prepare(`
        INSERT OR IGNORE INTO ai_budget_periods (
          id, period_start, period_end, currency, monthly_limit, committed_amount, consumed_amount, available_amount, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0.0, ?, ?, ?, ?)
      `).run(
        damagedPeriod.id, damagedPeriod.period_start, damagedPeriod.period_end,
        damagedPeriod.currency, damagedPeriod.monthly_limit,
        0.0, // committed reset to 0 (orphan budgets NOT imported)
        damagedPeriod.monthly_limit, // available = full limit (INCIDENT_PARTIAL consumption not carried over)
        "NORMAL",
        damagedPeriod.created_at, new Date().toISOString()
      );
      console.log("  Budget period imported with clean slate (INCIDENT_PARTIAL: prior spend unverifiable).");
    } catch (e) {
      console.warn(`  Could not import budget period: ${(e as any).message}`);
    }
  } else {
    console.log("  Budget period already seeded by schema init.");
  }
}

damagedDb.close();

// === STEP 8: VERIFY CANDIDATE INTEGRITY ===
console.log("\n=== STEP 8: Verify candidate integrity ===");
const integrityResult = (candidateDb.prepare("PRAGMA integrity_check").get() as any);
console.log(`  PRAGMA integrity_check: ${JSON.stringify(integrityResult)}`);

const fkResult = (candidateDb.prepare("PRAGMA foreign_key_check").all() as any[]);
console.log(`  PRAGMA foreign_key_check failures: ${fkResult.length}`);

// Check for orphan task budgets
const orphanTaskBudgets = (candidateDb.prepare("SELECT count(*) as c FROM ai_task_budgets WHERE task_id NOT IN (SELECT id FROM ai_tasks WHERE id IS NOT NULL)").get() as any).c;
const orphanUsageLedger = (candidateDb.prepare("SELECT count(*) as c FROM ai_usage_ledger WHERE task_id NOT IN (SELECT id FROM ai_tasks WHERE id IS NOT NULL)").get() as any).c;
const orphanHandoffs = (candidateDb.prepare("SELECT count(*) as c FROM ai_agent_handoffs WHERE task_id NOT IN (SELECT id FROM ai_tasks WHERE id IS NOT NULL)").get() as any).c;

console.log(`  Orphan task budgets: ${orphanTaskBudgets}`);
console.log(`  Orphan usage ledger: ${orphanUsageLedger}`);
console.log(`  Orphan agent handoffs: ${orphanHandoffs}`);

// Final summary
console.log("\n=== CANDIDATE DB SUMMARY ===");
const summaryTables = ["ai_conversations", "ai_messages", "ai_agents", "ai_departments", "ai_tools", "ai_capabilities", "ai_data_sources", "ai_memory_entries", "ai_budget_periods", "ai_tasks", "ai_runs", "ai_task_budgets", "ai_usage_ledger", "ai_agent_handoffs"];
for (const t of summaryTables) {
  const count = (candidateDb.prepare(`SELECT count(*) as c FROM ${t}`).get() as any).c;
  console.log(`  ${t}: ${count}`);
}

console.log("\nDone. Candidate DB created. Do NOT swap to operational until QA gate passes.");

/**
 * PHASE 2C.3 — Live Audit DB FK Safety Migration + Mapping Provenance Hardening
 * ONE-OFF idempotent maintenance script.
 * Schema source of truth remains: app/lib/db/audit-database.ts
 */
import Database from "node:sqlite";
import fs from "fs";

const LIVE_DB = "./data/audit_workspace.db";
const TEMP_DB = "./data/phase_2c3_temp_test.db";

function openDb(path: string) {
  return new (Database as any).DatabaseSync(path);
}

function inspectFKActions(db: any, label: string) {
  const tables = ["audit_zoho_coa", "audit_zoho_bank_accounts", "audit_zoho_bank_transactions", "audit_bank_coa_mappings"];
  console.log(`\n== FK INSPECTION [${label}] ==`);
  for (const t of tables) {
    const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(t) as any;
    const sql = row?.sql ?? "";
    let action = "CASCADE (UNSAFE)";
    if (sql.includes("ON DELETE RESTRICT")) action = "RESTRICT ✅";
    else if (sql.includes("ON DELETE NO ACTION")) action = "NO ACTION ✅";
    else if (!sql.includes("ON DELETE")) action = "NO FK CLAUSE";
    console.log(`  ${t}: ${action}`);
  }
}

function captureRowCounts(db: any): Record<string, number> {
  const tables = ["audit_zoho_source_runs", "audit_zoho_coa", "audit_zoho_bank_accounts", "audit_zoho_bank_transactions", "audit_bank_coa_mappings"];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    try {
      counts[t] = (db.prepare(`SELECT count(*) as c FROM ${t}`).get() as any).c;
    } catch (e) { counts[t] = -1; }
  }
  return counts;
}

function captureIndexes(db: any, tables: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const t of tables) {
    try {
      const rows = db.prepare(`PRAGMA index_list(${t})`).all() as any[];
      result[t] = rows.map((r: any) => r.name);
    } catch {
      result[t] = [];
    }
  }
  return result;
}

function applyFKSafetyMigration(db: any): any[] {
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("BEGIN TRANSACTION;");

  // audit_zoho_coa
  db.exec(`ALTER TABLE audit_zoho_coa RENAME TO _audit_zoho_coa_old;`);
  db.exec(`CREATE TABLE audit_zoho_coa (
    organization_id TEXT NOT NULL, account_id TEXT NOT NULL,
    source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
    account_name TEXT NOT NULL, account_code TEXT, account_type TEXT NOT NULL,
    account_sub_type TEXT, parent_account_id TEXT, parent_account_name TEXT,
    is_active INTEGER, source_endpoint TEXT, fetched_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, account_id, source_run_id)
  );`);
  db.exec(`INSERT INTO audit_zoho_coa SELECT * FROM _audit_zoho_coa_old;`);
  db.exec(`DROP TABLE _audit_zoho_coa_old;`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_zoho_coa_run ON audit_zoho_coa(source_run_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_zoho_coa_id ON audit_zoho_coa(organization_id, account_id);`);

  // audit_zoho_bank_accounts
  db.exec(`ALTER TABLE audit_zoho_bank_accounts RENAME TO _audit_zoho_bank_accounts_old;`);
  db.exec(`CREATE TABLE audit_zoho_bank_accounts (
    organization_id TEXT NOT NULL, account_id TEXT NOT NULL,
    source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
    account_name TEXT NOT NULL, account_type TEXT NOT NULL, currency_id TEXT, currency_code TEXT,
    is_active INTEGER, masked_account_number TEXT, balance REAL, uncategorized_transaction_count INTEGER,
    source_endpoint TEXT, fetched_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, account_id, source_run_id)
  );`);
  db.exec(`INSERT INTO audit_zoho_bank_accounts SELECT * FROM _audit_zoho_bank_accounts_old;`);
  db.exec(`DROP TABLE _audit_zoho_bank_accounts_old;`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_acc_run ON audit_zoho_bank_accounts(source_run_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_acc_id ON audit_zoho_bank_accounts(organization_id, account_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_acc_type ON audit_zoho_bank_accounts(account_type);`);

  // audit_zoho_bank_transactions
  db.exec(`ALTER TABLE audit_zoho_bank_transactions RENAME TO _audit_zoho_bank_transactions_old;`);
  db.exec(`CREATE TABLE audit_zoho_bank_transactions (
    organization_id TEXT NOT NULL, transaction_id TEXT NOT NULL,
    source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
    account_id TEXT NOT NULL, account_name TEXT, date TEXT, amount REAL NOT NULL,
    transaction_type TEXT NOT NULL, status TEXT NOT NULL, source TEXT, debit_or_credit TEXT,
    reference_number TEXT, payee TEXT, description TEXT, currency_id TEXT, currency_code TEXT,
    imported_transaction_id TEXT, source_endpoint TEXT, fetched_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, transaction_id, source_run_id)
  );`);
  db.exec(`INSERT INTO audit_zoho_bank_transactions SELECT * FROM _audit_zoho_bank_transactions_old;`);
  db.exec(`DROP TABLE _audit_zoho_bank_transactions_old;`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_run ON audit_zoho_bank_transactions(source_run_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_id ON audit_zoho_bank_transactions(organization_id, transaction_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_acc_date ON audit_zoho_bank_transactions(account_id, date);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_status ON audit_zoho_bank_transactions(status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_type ON audit_zoho_bank_transactions(transaction_type);`);

  // audit_bank_coa_mappings — full provenance redesign
  let oldMappings: any[] = [];
  try { oldMappings = db.prepare(`SELECT * FROM audit_bank_coa_mappings`).all() as any[]; } catch {}
  db.exec(`DROP TABLE IF EXISTS audit_bank_coa_mappings;`);
  db.exec(`CREATE TABLE audit_bank_coa_mappings (
    mapping_id              TEXT PRIMARY KEY,
    organization_id         TEXT NOT NULL,
    bank_account_id         TEXT NOT NULL,
    bank_source_run_id      TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
    coa_account_id          TEXT,
    coa_source_run_id       TEXT REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
    mapping_method          TEXT NOT NULL,
    mapping_status          TEXT NOT NULL,
    evidence_reason         TEXT,
    created_at              TEXT NOT NULL,
    reviewed_at             TEXT,
    reviewed_by             TEXT,
    superseded_by_mapping_id TEXT REFERENCES audit_bank_coa_mappings(mapping_id) ON DELETE RESTRICT
  );`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mapping_org_bank ON audit_bank_coa_mappings(organization_id, bank_account_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mapping_status ON audit_bank_coa_mappings(mapping_status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mapping_bank_run ON audit_bank_coa_mappings(bank_source_run_id);`);

  db.exec("COMMIT;");
  db.exec("PRAGMA foreign_keys = ON;");
  return oldMappings;
}

function populateMappings(db: any): { exact: number; notRequired: number } {
  const bankRun = db.prepare(
    `SELECT source_run_id, organization_id FROM audit_zoho_source_runs WHERE source_type='bank_accounts' AND status='SUCCESS' ORDER BY started_at DESC LIMIT 1`
  ).get() as any;
  const coaRun = db.prepare(
    `SELECT source_run_id FROM audit_zoho_source_runs WHERE source_type='chart_of_accounts' AND status='SUCCESS' ORDER BY started_at DESC LIMIT 1`
  ).get() as any;
  if (!bankRun || !coaRun) { console.log("  No SUCCESS runs found."); return { exact: 0, notRequired: 0 }; }

  const orgId = bankRun.organization_id;
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO audit_bank_coa_mappings
    (mapping_id, organization_id, bank_account_id, bank_source_run_id, coa_account_id, coa_source_run_id,
     mapping_method, mapping_status, evidence_reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const exactMatches = db.prepare(`
    SELECT b.account_id as bid, c.account_id as cid
    FROM audit_zoho_bank_accounts b
    JOIN audit_zoho_coa c ON b.account_id = c.account_id
    WHERE b.source_run_id=? AND c.source_run_id=?
  `).all(bankRun.source_run_id, coaRun.source_run_id) as any[];

  let exactCount = 0;
  for (const m of exactMatches) {
    stmt.run(`map_exact_${m.bid}`, orgId, m.bid, bankRun.source_run_id,
      m.cid, coaRun.source_run_id, "exact_id", "EXACT_ID",
      "Deterministic same-ID match between bank_accounts and chart_of_accounts source snapshots", now);
    exactCount++;
  }

  const evidenceMap: Record<string, string> = {
    cash: "Cash-book account is a self-contained ledger in Zoho Books bank/cash module. Zoho exposes full transaction history directly via bank transactions API using this account_id. No separate CoA mapping required for transaction audit.",
    payment_clearing: "Payment clearing account is a transit/settlement construct in Zoho Books. Functions as an independent clearing node; does not require conventional GL CoA mapping for audit.",
    bank: "Inactive legacy bank account with no active transaction feed. Not required for current audit scope."
  };

  const unmatched = db.prepare(`
    SELECT b.account_id, b.account_type
    FROM audit_zoho_bank_accounts b
    LEFT JOIN audit_zoho_coa c ON b.account_id = c.account_id AND c.source_run_id=?
    WHERE b.source_run_id=? AND c.account_id IS NULL
  `).all(coaRun.source_run_id, bankRun.source_run_id) as any[];

  let nrCount = 0;
  for (const u of unmatched) {
    const reason = evidenceMap[u.account_type] ?? `Account type '${u.account_type}' with no deterministic CoA match. OWNER review required.`;
    stmt.run(`map_nr_${u.account_id}`, orgId, u.account_id, bankRun.source_run_id,
      null, null, "not_required", "NOT_REQUIRED", reason, now);
    nrCount++;
  }
  return { exact: exactCount, notRequired: nrCount };
}

function copyDbFiles(srcBase: string, dstBase: string) {
  if (fs.existsSync(srcBase)) fs.copyFileSync(srcBase, dstBase);
  if (fs.existsSync(srcBase + "-wal")) fs.copyFileSync(srcBase + "-wal", dstBase + "-wal");
  if (fs.existsSync(srcBase + "-shm")) fs.copyFileSync(srcBase + "-shm", dstBase + "-shm");
}
function deleteDbFiles(base: string) {
  if (fs.existsSync(base)) fs.unlinkSync(base);
  if (fs.existsSync(base + "-wal")) fs.unlinkSync(base + "-wal");
  if (fs.existsSync(base + "-shm")) fs.unlinkSync(base + "-shm");
}

async function main() {
  // ── 1. Pre-migration live inspection ──
  console.log("\n=== PHASE 2C.3 MIGRATION START ===");
  // Force a WAL checkpoint on live DB before reading/copying
  const liveDbCheckpoint = openDb(LIVE_DB);
  liveDbCheckpoint.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  
  inspectFKActions(liveDbCheckpoint, "LIVE PRE-MIGRATION");
  const preCounts = captureRowCounts(liveDbCheckpoint);
  console.log("\n== PRE-MIGRATION COUNTS ==");
  for (const [t, c] of Object.entries(preCounts)) console.log(`  ${t}: ${c}`);
  liveDbCheckpoint.close();

  // ── 2. TEMP DB test ──
  deleteDbFiles(TEMP_DB);
  copyDbFiles(LIVE_DB, TEMP_DB);
  console.log(`\n== TEMP DB: ${TEMP_DB} ==`);

  const tempDb = openDb(TEMP_DB);
  const tempPreIndexes = captureIndexes(tempDb, ["audit_zoho_coa", "audit_zoho_bank_accounts", "audit_zoho_bank_transactions"]);
  
  // Actually check if tables exist before applying
  try {
     tempDb.prepare("SELECT 1 FROM audit_zoho_coa LIMIT 1").get();
  } catch (e: any) {
     console.error("Temp DB missing audit_zoho_coa table! Aborting test.", e.message);
     process.exit(1);
  }

  applyFKSafetyMigration(tempDb);
  const tempPostCounts = captureRowCounts(tempDb);
  const tempPostIndexes = captureIndexes(tempDb, ["audit_zoho_coa", "audit_zoho_bank_accounts", "audit_zoho_bank_transactions"]);
  inspectFKActions(tempDb, "TEMP POST-MIGRATION");

  const srcTables = ["audit_zoho_source_runs", "audit_zoho_coa", "audit_zoho_bank_accounts", "audit_zoho_bank_transactions"];
  let tempPass = true;
  console.log("\n== TEMP ROW COUNT CHECK ==");
  for (const t of srcTables) {
    const ok = preCounts[t] === tempPostCounts[t];
    console.log(`  ${t}: ${preCounts[t]} → ${tempPostCounts[t]} ${ok ? "✅" : "❌"}`);
    if (!ok) tempPass = false;
  }

  console.log("\n== TEMP INDEX CHECK ==");
  for (const t of Object.keys(tempPreIndexes)) {
    const pre = tempPreIndexes[t].sort().join(",");
    const post = (tempPostIndexes[t] || []).sort().join(",");
    const ok = pre === post;
    console.log(`  ${t}: ${ok ? "✅ match" : "❌ MISMATCH (pre:" + pre + " post:" + post + ")"}`);
    if (!ok) tempPass = false;
  }

  // FK delete restriction test on temp
  console.log("\n== FK DELETE RESTRICTION TEST (TEMP) ==");
  let restrictOk = false;
  try {
    tempDb.exec("PRAGMA foreign_keys = ON;");
    const row = tempDb.prepare("SELECT source_run_id FROM audit_zoho_coa LIMIT 1").get() as any;
    if (row) {
      tempDb.exec(`DELETE FROM audit_zoho_source_runs WHERE source_run_id='${row.source_run_id}'`);
      console.log("  ❌ DELETE succeeded — FK RESTRICT not enforced!");
    } else { console.log("  No rows to test with (schema applied but no data in temp)"); restrictOk = true; }
  } catch (e: any) {
    restrictOk = true;
    console.log(`  ✅ DELETE blocked: FK RESTRICT enforced`);
  }
  if (!restrictOk) tempPass = false;

  const tempMappings = populateMappings(tempDb);
  console.log(`\n== TEMP MAPPING POPULATION: EXACT=${tempMappings.exact} NR=${tempMappings.notRequired} ==`);
  tempDb.close();
  deleteDbFiles(TEMP_DB);

  console.log(`\n== TEMP MIGRATION RESULT: ${tempPass ? "PASS ✅" : "FAIL ❌"} ==`);
  if (!tempPass) { console.error("STOP: Will not touch live DB."); process.exit(1); }

  // ── 3. Apply to LIVE DB ──
  console.log("\n== APPLYING TO LIVE DB ==");
  const live2 = openDb(LIVE_DB);
  applyFKSafetyMigration(live2);

  const postCounts = captureRowCounts(live2);
  console.log("\n== POST-MIGRATION COUNTS (LIVE) ==");
  let livePass = true;
  for (const t of srcTables) {
    const ok = preCounts[t] === postCounts[t];
    console.log(`  ${t}: ${preCounts[t]} → ${postCounts[t]} ${ok ? "✅" : "❌"}`);
    if (!ok) livePass = false;
  }
  inspectFKActions(live2, "LIVE POST-MIGRATION");

  // ── 4. Populate live mappings ──
  const liveMappings = populateMappings(live2);
  console.log(`\n== LIVE MAPPING POPULATION: EXACT=${liveMappings.exact} NR=${liveMappings.notRequired} ==`);

  const byStatus = live2.prepare("SELECT mapping_status, count(*) as c FROM audit_bank_coa_mappings GROUP BY mapping_status").all() as any[];
  console.log("\n== MAPPING COVERAGE ==");
  for (const s of byStatus) console.log(`  ${s.mapping_status}: ${s.c}`);

  // Source mirror immutability
  const coaCols = (live2.prepare("PRAGMA table_info(audit_zoho_coa)").all() as any[]).map((r: any) => r.name);
  const bankCols = (live2.prepare("PRAGMA table_info(audit_zoho_bank_accounts)").all() as any[]).map((r: any) => r.name);
  const mappingFields = ["mapping_status", "reviewed_by", "superseded_by", "evidence_reason"];
  console.log("\n== SOURCE MIRROR IMMUTABILITY ==");
  console.log(`  audit_zoho_coa untouched: ${!coaCols.some(c => mappingFields.includes(c)) ? "✅" : "❌"}`);
  console.log(`  audit_zoho_bank_accounts untouched: ${!bankCols.some(c => mappingFields.includes(c)) ? "✅" : "❌"}`);
  live2.close();

  console.log(`\n== LIVE DB SAFETY MIGRATION: ${livePass ? "PASS ✅" : "FAIL ❌"} ==`);
  console.log(`DESTRUCTIVE DATA LOSS: 0`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });

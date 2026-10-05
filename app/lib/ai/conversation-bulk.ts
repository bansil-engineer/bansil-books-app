/**
 * Bulk chat management for the AI CEO (deterministic, zero AI).
 *
 *  - moveAllToBin   : ACTIVE -> BINNED for every active conversation (one transaction, soft only)
 *  - restoreAll     : BINNED -> ACTIVE for every binned conversation (one transaction)
 *  - bulkDeleteBinnedPermanently : IRREVERSIBLE. Bin-only. Requires:
 *        explicit confirmation + typed phrase + the fingerprint of the previewed impact,
 *        then a server-created SQLite-consistent backup (VACUUM INTO) that is verified
 *        read-only (integrity_check, foreign_key_check, same fingerprint), hashed (SHA256),
 *        described by a manifest, and re-verified immediately before the delete.
 *        The delete runs in ONE transaction, scoped to the exact validated list of BINNED
 *        conversation ids. Any failure aborts everything: nothing is deleted.
 *
 * The SAME verified core (backup, SHA256, manifest, read-only verification, fingerprint,
 * race recheck, one scoped transaction) also serves the single-conversation permanent delete
 * (target set = exactly one BINNED conversation): see runVerifiedDelete.
 *
 * Never deleted here: agents, budgets, model catalog, usage ledger (financial audit trail),
 * memory, evidence index, business data, Zoho data, and every ACTIVE conversation.
 * See conversation-bin.ts for the conversation dependency graph.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const BULK_DELETE_PHRASE = "DELETE ALL";
export const BULK_DELETE_OPERATION = "DELETE_ALL_BINNED_CONVERSATIONS";
export const SINGLE_DELETE_OPERATION = "DELETE_SINGLE_BINNED_CONVERSATION";

export interface BulkCounts {
  conversations: number;
  messages: number;
  runs: number;
  tasks: number;
  toolCalls: number;
  toolExecutions: number;
  approvals: number;
  auditEvents: number;
  handoffs: number;
  taskBudgets: number;
}

export interface BulkPlan {
  scope: "ACTIVE" | "BINNED";
  ids: string[];
  counts: BulkCounts;
  /** tool calls + tool executions + approvals + audit events + handoffs + task budgets */
  otherScopedRows: number;
  fingerprint: string;
}

const sha256Text = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
export const sha256File = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

const IDS = `SELECT value FROM json_each(?)`;
const RUNS_OF = `SELECT id FROM ai_runs WHERE conversation_id IN (${IDS})`;
const TASKS_OF = `
  WITH RECURSIVE conv_tasks(id) AS (
    SELECT id FROM ai_tasks WHERE run_id IN (${RUNS_OF})
    UNION
    SELECT t.id FROM ai_tasks t JOIN conv_tasks c ON t.parent_task_id = c.id
  )
  SELECT id FROM conv_tasks`;

function scalar(db: DatabaseSync, sql: string, json: string): number {
  return ((db.prepare(sql).get(json) as any)?.c as number) ?? 0;
}

/** Counts + fingerprint for the set of conversations currently in `scope`. Read-only. */
export function computePlan(db: DatabaseSync, scope: "ACTIVE" | "BINNED", onlyIds?: string[]): BulkPlan {
  const allConvs = db
    .prepare(`SELECT id, title, status, created_at, updated_at, binned_at FROM ai_conversations WHERE status = ? ORDER BY id`)
    .all(scope) as unknown as Array<{ id: string; title: string | null; status: string; created_at: string; updated_at: string; binned_at: string | null }>;
  const convs = onlyIds ? allConvs.filter(c => onlyIds.includes(c.id)) : allConvs;
  const ids = convs.map(c => c.id);
  const j = JSON.stringify(ids);
  const counts: BulkCounts = {
    conversations: ids.length,
    messages: scalar(db, `SELECT COUNT(*) c FROM ai_messages WHERE conversation_id IN (${IDS})`, j),
    runs: scalar(db, `SELECT COUNT(*) c FROM ai_runs WHERE conversation_id IN (${IDS})`, j),
    tasks: scalar(db, `SELECT COUNT(*) c FROM (${TASKS_OF})`, j),
    toolCalls: scalar(db, `SELECT COUNT(*) c FROM ai_tool_calls WHERE run_id IN (${RUNS_OF})`, j),
    toolExecutions: scalar(db, `SELECT COUNT(*) c FROM ai_tool_executions WHERE run_id IN (${RUNS_OF})`, j),
    approvals: scalar(db, `SELECT COUNT(*) c FROM ai_approvals WHERE run_id IN (${RUNS_OF})`, j),
    auditEvents: scalar(db, `SELECT COUNT(*) c FROM ai_audit_events WHERE run_id IN (${RUNS_OF})`, j),
    handoffs: scalar(db, `SELECT COUNT(*) c FROM ai_agent_handoffs WHERE run_id IN (${RUNS_OF})`, j),
    taskBudgets: scalar(db, `SELECT COUNT(*) c FROM ai_task_budgets WHERE task_id IN (${TASKS_OF})`, j),
  };
  const otherScopedRows =
    counts.toolCalls + counts.toolExecutions + counts.approvals + counts.auditEvents + counts.handoffs + counts.taskBudgets;

  // Fingerprint covers identity, state, per-conversation message volume and the run/task id sets.
  const perConv = ids.map(id => {
    const m = db.prepare(`SELECT COUNT(*) c, COALESCE(MAX(created_at),'') last FROM ai_messages WHERE conversation_id = ?`).get(id) as any;
    const mids = (db.prepare(`SELECT id FROM ai_messages WHERE conversation_id = ? ORDER BY id`).all(id) as any[]).map(r => r.id);
    return [id, m.c, m.last, mids];
  });
  const runIds = (db.prepare(`SELECT id FROM ai_runs WHERE conversation_id IN (${IDS}) ORDER BY id`).all(j) as any[]).map(r => r.id);
  const taskIds = (db.prepare(`${TASKS_OF} ORDER BY id`).all(j) as any[]).map(r => r.id);
  const fingerprint = sha256Text(
    JSON.stringify({ scope, convs: convs.map(c => [c.id, c.title, c.status, c.updated_at, c.binned_at]), perConv, runIds, taskIds, counts })
  );
  return { scope, ids, counts, otherScopedRows, fingerprint };
}

// ------------------------------------------------------------
// Bulk soft state changes (one transaction each)
// ------------------------------------------------------------

export type BulkMoveResult =
  | { ok: true; changed: number; ids: string[] }
  | { ok: false; code: "FAILED"; message: string };

function bulkStateChange(db: DatabaseSync, from: "ACTIVE" | "BINNED"): BulkMoveResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    const ids = (db.prepare(`SELECT id FROM ai_conversations WHERE status = ? ORDER BY id`).all(from) as any[]).map(r => r.id as string);
    if (ids.length > 0) {
      const j = JSON.stringify(ids);
      const res =
        from === "ACTIVE"
          ? db.prepare(
              `UPDATE ai_conversations SET status = 'BINNED', binned_at = ?, binned_by = 'OWNER'
               WHERE id IN (${IDS}) AND status = 'ACTIVE'`
            ).run(new Date().toISOString(), j)
          : db.prepare(
              `UPDATE ai_conversations SET status = 'ACTIVE', binned_at = NULL, binned_by = NULL
               WHERE id IN (${IDS}) AND status = 'BINNED'`
            ).run(j);
      if (Number(res.changes) !== ids.length) throw new Error("Unexpected number of rows changed.");
    }
    db.exec("COMMIT");
    return { ok: true, changed: ids.length, ids };
  } catch (err: any) {
    try { db.exec("ROLLBACK"); } catch {}
    return { ok: false, code: "FAILED", message: `Rolled back: ${err?.message || err}` };
  }
}

export const moveAllToBin = (db: DatabaseSync) => bulkStateChange(db, "ACTIVE");
export const restoreAll = (db: DatabaseSync) => bulkStateChange(db, "BINNED");

// ------------------------------------------------------------
// Backup (server-side, mandatory before bulk permanent delete)
// ------------------------------------------------------------

export interface BackupProof {
  backupFile: string;
  backupPath: string;
  sha256: string;
  manifestFile: string;
  manifestPath: string;
  fingerprint: string;
}

export interface BackupOptions {
  backupDir?: string;
  now?: Date;
  /** Which destructive operation this backup protects (manifest + file name). Default: bulk. */
  operation?: string;
  /** Test seam only (never reachable from HTTP): runs on the fresh backup before it is re-opened for verification. */
  beforeVerify?: (p: { backupPath: string; manifestPath: string }) => void;
}

function mainDbFile(db: DatabaseSync): string {
  const row = (db.prepare(`PRAGMA database_list`).all() as any[]).find(r => r.name === "main");
  if (!row || !row.file) throw new Error("In-memory databases cannot be backed up; refusing bulk delete.");
  return row.file as string;
}

const fkViolationCount = (db: DatabaseSync) => (db.prepare(`PRAGMA foreign_key_check`).all() as unknown[]).length;

export function createBulkDeleteBackup(db: DatabaseSync, plan: BulkPlan, opts: BackupOptions = {}): BackupProof {
  const sourceDb = mainDbFile(db);
  const dir = opts.backupDir ?? path.join(path.dirname(sourceDb), "backups");
  fs.mkdirSync(dir, { recursive: true });

  const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const operation = opts.operation ?? BULK_DELETE_OPERATION;
  const single = operation === SINGLE_DELETE_OPERATION;
  const backupFile = `ai_workspace.${single ? "pre-single-delete" : "pre-bulk-delete"}.${stamp}.db`;
  const backupPath = path.join(dir, backupFile);
  if (fs.existsSync(backupPath)) throw new Error("Backup file already exists; refusing to overwrite.");

  const sourceFk = fkViolationCount(db);
  // VACUUM INTO produces a transactionally consistent snapshot (WAL content included).
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  const manifestFile = `${backupFile}.manifest.json`;
  const manifestPath = path.join(dir, manifestFile);
  opts.beforeVerify?.({ backupPath, manifestPath });

  // Read-only verification of the backup itself.
  const bk = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const integrity = (bk.prepare(`PRAGMA integrity_check`).get() as any)?.integrity_check;
    if (integrity !== "ok") throw new Error(`Backup integrity_check failed: ${integrity}`);
    if (fkViolationCount(bk) !== sourceFk) throw new Error("Backup foreign_key_check differs from source.");
    const backupPlan = computePlan(bk, "BINNED", single ? plan.ids : undefined);
    if (backupPlan.ids.length !== plan.ids.length || !plan.ids.every(id => backupPlan.ids.includes(id))) {
      throw new Error("Target conversation(s) missing from backup.");
    }
    if (JSON.stringify(backupPlan.counts) !== JSON.stringify(plan.counts)) {
      throw new Error("Backup impact counts (messages/runs/tasks/dependents) do not match the plan.");
    }
    if (backupPlan.fingerprint !== plan.fingerprint) throw new Error("Backup does not contain the previewed contents (fingerprint mismatch).");
  } finally {
    bk.close();
  }

  const sha256 = sha256File(backupPath);
  const targetRow = single
    ? (db.prepare(`SELECT id, title, status FROM ai_conversations WHERE id = ?`).get(plan.ids[0]) as any)
    : null;
  const manifest = {
    operation,
    created_at: new Date().toISOString(),
    source_db: sourceDb,
    source_db_path: sourceDb,
    backup_path: backupPath,
    backup_sha256: sha256,
    source_size_bytes: fs.statSync(sourceDb).size,
    backup_size_bytes: fs.statSync(backupPath).size,
    ...(single && targetRow
      ? { conversation_id: targetRow.id, conversation_title: targetRow.title, conversation_status: targetRow.status }
      : {}),
    conversation_count: plan.counts.conversations,
    conversation_ids: plan.ids,
    message_count: plan.counts.messages,
    run_count: plan.counts.runs,
    task_count: plan.counts.tasks,
    other_impacted_rows: {
      tool_calls: plan.counts.toolCalls,
      tool_executions: plan.counts.toolExecutions,
      approvals: plan.counts.approvals,
      audit_events: plan.counts.auditEvents,
      handoffs: plan.counts.handoffs,
      task_budgets: plan.counts.taskBudgets,
      total: plan.otherScopedRows,
    },
    pre_delete_fingerprint: plan.fingerprint,
    verification: { integrity_check: "ok", foreign_key_violations: sourceFk, fingerprint_matches_source: true },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: "wx" });
  fs.chmodSync(backupPath, 0o444);
  fs.chmodSync(manifestPath, 0o444);

  const reread = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (reread.backup_sha256 !== sha256 || reread.pre_delete_fingerprint !== plan.fingerprint) {
    throw new Error("Manifest verification failed.");
  }
  return { backupFile, backupPath, sha256, manifestFile, manifestPath, fingerprint: plan.fingerprint };
}

// ------------------------------------------------------------
// Bulk permanent delete
// ------------------------------------------------------------

export type BulkDeleteCode =
  | "CONFIRMATION_REQUIRED"
  | "WRONG_PHRASE"
  | "EMPTY_BIN"
  | "STALE_PREVIEW"
  | "BACKUP_FAILED"
  | "BACKUP_PROOF_MISSING"
  | "BACKUP_VERIFICATION_FAILED"
  | "FINGERPRINT_CHANGED"
  | "FAILED";

export type BulkDeleteResult =
  | {
      ok: true;
      deleted: BulkCounts;
      conversationIds: string[];
      backup: { file: string; sha256: string; manifest: string };
    }
  | { ok: false; code: BulkDeleteCode; message: string };

const fail = (code: BulkDeleteCode, message: string): BulkDeleteResult => ({ ok: false, code, message });

export interface BulkDeleteRequest {
  confirm?: unknown;
  typedConfirmation?: unknown;
  expectedFingerprint?: unknown;
}

export interface BulkDeleteHooks {
  /** Test seams only; never reachable from HTTP. */
  createBackup?: (db: DatabaseSync, plan: BulkPlan, opts: BackupOptions) => BackupProof;
  afterBackup?: (proof: BackupProof) => void;
}

/** Everything after the backup exists. Aborts (deleting nothing) unless the proof is complete and valid. */
export function executeBulkDeleteWithProof(
  db: DatabaseSync,
  plan: BulkPlan,
  proof: BackupProof | null | undefined,
  operation: string = BULK_DELETE_OPERATION
): BulkDeleteResult {
  const subset = operation === SINGLE_DELETE_OPERATION ? plan.ids : undefined;
  if (!proof || !proof.backupPath || !proof.sha256 || !proof.manifestPath || !proof.fingerprint) {
    return fail("BACKUP_PROOF_MISSING", "A verified backup is required before permanent delete.");
  }
  try {
    if (!fs.existsSync(proof.backupPath) || !fs.existsSync(proof.manifestPath)) throw new Error("Backup files are missing.");
    if (sha256File(proof.backupPath) !== proof.sha256) throw new Error("Backup SHA256 does not match.");
    const manifest = JSON.parse(fs.readFileSync(proof.manifestPath, "utf8"));
    if (manifest.operation !== operation) throw new Error("Manifest operation mismatch.");
    if (manifest.backup_sha256 !== proof.sha256) throw new Error("Manifest SHA256 mismatch.");
    if (manifest.pre_delete_fingerprint !== plan.fingerprint || proof.fingerprint !== plan.fingerprint) {
      throw new Error("Backup fingerprint does not match the validated plan.");
    }
  } catch (err: any) {
    return fail("BACKUP_VERIFICATION_FAILED", `Backup verification failed: ${err?.message || err}`);
  }
  if (plan.ids.length === 0) return fail("EMPTY_BIN", "Bin is empty; nothing to delete.");

  db.exec("BEGIN IMMEDIATE");
  try {
    // Race safety: recompute the Bin set, impact and fingerprint under the write lock.
    const current = computePlan(db, "BINNED", subset);
    if (current.fingerprint !== plan.fingerprint) {
      db.exec("ROLLBACK");
      return fail("FINGERPRINT_CHANGED", "The Bin changed after the preview/backup. Start again with a fresh preview.");
    }
    const activeBefore = computePlan(db, "ACTIVE");
    const binnedBefore = (db.prepare(`SELECT id FROM ai_conversations WHERE status = 'BINNED' ORDER BY id`).all() as any[]).map(r => r.id as string);
    const fkBefore = fkViolationCount(db);

    db.exec(`DROP TABLE IF EXISTS _bulk_delete_convs; DROP TABLE IF EXISTS _bulk_delete_tasks;`);
    db.exec(`CREATE TEMP TABLE _bulk_delete_convs (id TEXT PRIMARY KEY)`);
    db.exec(`CREATE TEMP TABLE _bulk_delete_tasks (id TEXT PRIMARY KEY)`);
    const ins = db.prepare(`INSERT INTO _bulk_delete_convs (id) VALUES (?)`);
    for (const id of plan.ids) ins.run(id);
    const j = JSON.stringify(plan.ids);
    db.prepare(`INSERT OR IGNORE INTO _bulk_delete_tasks (id) ${TASKS_OF}`).run(j);

    const CONVS = `SELECT id FROM _bulk_delete_convs`;
    const RUNS = `SELECT id FROM ai_runs WHERE conversation_id IN (${CONVS})`;
    const TASKS = `SELECT id FROM _bulk_delete_tasks`;
    db.exec(`DELETE FROM ai_task_budgets WHERE task_id IN (${TASKS})`);
    db.exec(`DELETE FROM ai_agent_handoffs WHERE run_id IN (${RUNS}) OR task_id IN (${TASKS})`);
    db.exec(`DELETE FROM ai_tool_executions WHERE run_id IN (${RUNS})`);
    db.exec(`DELETE FROM ai_tool_calls WHERE run_id IN (${RUNS})`);
    db.exec(`DELETE FROM ai_approvals WHERE run_id IN (${RUNS})`);
    db.exec(`DELETE FROM ai_audit_events WHERE run_id IN (${RUNS})`);
    db.exec(`DELETE FROM ai_tasks WHERE id IN (${TASKS})`);
    db.exec(`DELETE FROM ai_runs WHERE conversation_id IN (${CONVS})`);
    db.exec(`DELETE FROM ai_messages WHERE conversation_id IN (${CONVS})`);
    const res = db.prepare(`DELETE FROM ai_conversations WHERE id IN (SELECT id FROM _bulk_delete_convs) AND status = 'BINNED'`).run();
    if (Number(res.changes) !== plan.ids.length) throw new Error("Deleted conversation count differs from the validated set.");

    // Post-conditions, still inside the transaction.
    const binnedLeft = (db.prepare(`SELECT id FROM ai_conversations WHERE status = 'BINNED' ORDER BY id`).all() as any[]).map(r => r.id as string);
    const expectedLeft = binnedBefore.filter(id => !plan.ids.includes(id));
    if (JSON.stringify(binnedLeft) !== JSON.stringify(expectedLeft)) {
      throw new Error("Bin contents after delete differ from expectation (only the validated target ids may disappear).");
    }
    const activeAfter = computePlan(db, "ACTIVE");
    if (activeAfter.fingerprint !== activeBefore.fingerprint) throw new Error("Active conversations were affected.");
    if (fkViolationCount(db) > fkBefore) throw new Error("Foreign-key check failed after deletion.");

    db.exec(`DROP TABLE IF EXISTS _bulk_delete_convs; DROP TABLE IF EXISTS _bulk_delete_tasks;`);
    db.exec("COMMIT");
  } catch (err: any) {
    try { db.exec("ROLLBACK"); } catch {}
    try { db.exec(`DROP TABLE IF EXISTS _bulk_delete_convs; DROP TABLE IF EXISTS _bulk_delete_tasks;`); } catch {}
    return fail("FAILED", `Bulk delete rolled back: ${err?.message || err}`);
  }
  return {
    ok: true,
    deleted: plan.counts,
    conversationIds: plan.ids,
    backup: { file: proof.backupFile, sha256: proof.sha256, manifest: proof.manifestFile },
  };
}

let destructiveOperationActive = false;

/**
 * Shared verified-destructive core for single AND bulk permanent delete.
 * Caller has already validated the request and computed `plan` for the exact target set.
 * Order: coordination lock -> re-read source state (fingerprint) -> VACUUM INTO backup +
 * read-only verification + SHA256 + manifest -> proof re-verification -> fingerprint recheck
 * under the write lock -> ONE scoped transaction -> post-checks. Any failure before the
 * transaction deletes nothing.
 */
export function runVerifiedDelete(
  db: DatabaseSync,
  operation: string,
  plan: BulkPlan,
  opts: BackupOptions = {},
  hooks: BulkDeleteHooks = {}
): BulkDeleteResult {
  if (destructiveOperationActive) {
    return fail("FAILED", "Another destructive operation is in progress; nothing was deleted.");
  }
  destructiveOperationActive = true;
  try {
    const subset = operation === SINGLE_DELETE_OPERATION ? plan.ids : undefined;
    const fresh = computePlan(db, "BINNED", subset);
    if (fresh.fingerprint !== plan.fingerprint) {
      return fail("FINGERPRINT_CHANGED", "The state changed after the preview. Start again with a fresh preview.");
    }
    let proof: BackupProof;
    try {
      proof = (hooks.createBackup ?? createBulkDeleteBackup)(db, plan, { ...opts, operation });
    } catch (err: any) {
      return fail("BACKUP_FAILED", `Backup failed; nothing was deleted: ${err?.message || err}`);
    }
    hooks.afterBackup?.(proof);
    return executeBulkDeleteWithProof(db, plan, proof, operation);
  } finally {
    destructiveOperationActive = false;
  }
}

export function bulkDeleteBinnedPermanently(
  db: DatabaseSync,
  request: BulkDeleteRequest | null | undefined,
  opts: BackupOptions = {},
  hooks: BulkDeleteHooks = {}
): BulkDeleteResult {
  if (!request || request.confirm !== true) {
    return fail("CONFIRMATION_REQUIRED", "Explicit confirmation is required.");
  }
  if (request.typedConfirmation !== BULK_DELETE_PHRASE) {
    return fail("WRONG_PHRASE", `Type ${BULK_DELETE_PHRASE} exactly to confirm.`);
  }

  const plan = computePlan(db, "BINNED");
  // CRITICAL: an empty Bin is a safe no-op, never "delete everything".
  if (plan.ids.length === 0) return fail("EMPTY_BIN", "Bin is empty; nothing to delete.");
  if (typeof request.expectedFingerprint !== "string" || request.expectedFingerprint !== plan.fingerprint) {
    return fail("STALE_PREVIEW", "The Bin changed since the impact preview. Review a fresh preview and try again.");
  }
  return runVerifiedDelete(db, BULK_DELETE_OPERATION, plan, opts, hooks);
}

/**
 * Chat Bin: reversible soft delete for AI CEO conversations.
 *
 * Deterministic, zero AI. Typed actions:
 *   MOVE_TO_BIN        : ACTIVE -> BINNED  (state change on the SAME row; nothing copied or deleted)
 *   RESTORE            : BINNED -> ACTIVE  (clears binned_at / binned_by)
 *   DELETE_PERMANENTLY : only for status = BINNED, only with an explicit confirmation
 *                        (see deleteBinnedConversationPermanently). Irreversible.
 *
 * Conversation dependency graph (from the ai-database schema):
 *   ai_conversations.id
 *     <- ai_messages.conversation_id                 (FK, ON DELETE CASCADE)
 *     <- ai_runs.conversation_id                     (FK, ON DELETE CASCADE)
 *          <- ai_tool_calls.run_id                   (FK, CASCADE)
 *          <- ai_approvals.run_id                    (FK, CASCADE)
 *          <- ai_audit_events.run_id                 (FK, CASCADE)
 *          <- ai_tool_executions.run_id              (FK, CASCADE)
 *          <- ai_agent_handoffs.run_id               (FK, CASCADE; also has plain task_id)
 *          <- ai_tasks.run_id                        (plain column, NO FK)
 *               <- ai_tasks.parent_task_id           (FK self, CASCADE)
 *               <- ai_task_budgets.task_id           (FK, CASCADE)
 * NOT conversation-scoped and never deleted here: ai_agents, ai_agent_capabilities,
 * ai_departments, ai_budget_periods, ai_department_budgets, ai_agent_budgets,
 * ai_budget_transfers, model_cost_catalog, ai_capabilities, ai_tools, ai_data_sources,
 * ai_evidence_index (shared cache), ai_memory_entries (global learning), and
 * ai_usage_ledger (financial audit trail; its task_id has no FK and is kept).
 *
 * Permanent deletion is NOT implemented here: it runs through the same verified core as
 * "Delete All Permanently" (conversation-bulk.ts / runVerifiedDelete), with a target set of exactly
 * one BINNED conversation: preview fingerprint -> server-created VACUUM INTO backup + SHA256 +
 * manifest + read-only verification (integrity_check, foreign_key_check, target/count/fingerprint
 * match) -> fingerprint recheck under the write lock -> ONE scoped transaction -> post-checks.
 * There is no code path that deletes a conversation without a verified backup.
 */

import type { DatabaseSync } from "node:sqlite";
import {
  computePlan,
  runVerifiedDelete,
  SINGLE_DELETE_OPERATION,
  type BackupOptions,
  type BulkDeleteHooks,
  type BulkDeleteCode,
} from "./conversation-bulk";

export type ConversationState = "ACTIVE" | "BINNED";
export type BinAction = "MOVE_TO_BIN" | "RESTORE";

export interface ConversationRow {
  id: string;
  title: string | null;
  status: ConversationState;
  created_at: string;
  updated_at: string;
  binned_at: string | null;
}

export type BinResult =
  | { ok: true; conversation: ConversationRow }
  | { ok: false; code: "NOT_FOUND" | "INVALID_ACTION" | "INVALID_TRANSITION"; message: string };

const COLUMNS = `id, title, status, created_at, updated_at, binned_at`;

export function isBinAction(v: unknown): v is BinAction {
  return v === "MOVE_TO_BIN" || v === "RESTORE";
}

export function getConversation(db: DatabaseSync, id: string): ConversationRow | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM ai_conversations WHERE id = ?`).get(id);
  return (row as unknown as ConversationRow) || null;
}

/** Server-side filtering. ACTIVE by updated_at, BINNED by binned_at (newest first). */
export function listConversations(db: DatabaseSync, state: ConversationState): ConversationRow[] {
  const order = state === "BINNED" ? "binned_at DESC, updated_at DESC" : "updated_at DESC";
  return db
    .prepare(`SELECT ${COLUMNS} FROM ai_conversations WHERE status = ? ORDER BY ${order}`)
    .all(state) as unknown as ConversationRow[];
}

export function countConversations(db: DatabaseSync): { active: number; binned: number } {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS c FROM ai_conversations GROUP BY status`)
    .all() as unknown as Array<{ status: string; c: number }>;
  return {
    active: rows.find(r => r.status === "ACTIVE")?.c ?? 0,
    binned: rows.find(r => r.status === "BINNED")?.c ?? 0,
  };
}

/** Typed state change. updated_at and title are deliberately left untouched. */
export function applyBinAction(db: DatabaseSync, id: string, action: unknown): BinResult {
  if (!isBinAction(action)) {
    return { ok: false, code: "INVALID_ACTION", message: "Unsupported action." };
  }
  const current = getConversation(db, id);
  if (!current) return { ok: false, code: "NOT_FOUND", message: "Conversation not found." };

  if (action === "MOVE_TO_BIN") {
    if (current.status !== "ACTIVE") {
      return { ok: false, code: "INVALID_TRANSITION", message: "Only an active conversation can be moved to Bin." };
    }
    db.prepare(
      `UPDATE ai_conversations SET status = 'BINNED', binned_at = ?, binned_by = 'OWNER' WHERE id = ? AND status = 'ACTIVE'`
    ).run(new Date().toISOString(), id);
  } else {
    if (current.status !== "BINNED") {
      return { ok: false, code: "INVALID_TRANSITION", message: "Only a binned conversation can be restored." };
    }
    db.prepare(
      `UPDATE ai_conversations SET status = 'ACTIVE', binned_at = NULL, binned_by = NULL WHERE id = ? AND status = 'BINNED'`
    ).run(id);
  }
  return { ok: true, conversation: getConversation(db, id)! };
}

// ------------------------------------------------------------
// Permanent deletion (Bin only)
// ------------------------------------------------------------

export interface DeleteImpact {
  id: string;
  title: string | null;
  status: ConversationState;
  messageCount: number;
  runCount: number;
  taskCount: number;
  /** tool calls + tool executions + approvals + audit events + handoffs + task budgets */
  otherLinkedRecordCount: number;
  /** Deterministic fingerprint of the exact rows a permanent delete would remove. */
  fingerprint: string;
}

export type DeleteResult =
  | { ok: true; deleted: DeleteImpact; backup: { file: string; sha256: string; manifest: string } }
  | {
      ok: false;
      code: "NOT_FOUND" | "NOT_IN_BIN" | "CONFIRMATION_REQUIRED" | "PREVIEW_REQUIRED" | BulkDeleteCode;
      message: string;
    };

const RUN_IDS = `SELECT id FROM ai_runs WHERE conversation_id = ?`;
// Tasks of this conversation's runs plus their descendants (parent_task_id chain).
const TASK_IDS = `
  WITH RECURSIVE conv_tasks(id) AS (
    SELECT id FROM ai_tasks WHERE run_id IN (${RUN_IDS})
    UNION
    SELECT t.id FROM ai_tasks t JOIN conv_tasks c ON t.parent_task_id = c.id
  )
  SELECT id FROM conv_tasks`;

function one(db: DatabaseSync, sql: string, ...args: string[]): number {
  return ((db.prepare(sql).get(...args) as any)?.c as number) ?? 0;
}

export function getDeleteImpact(db: DatabaseSync, id: string): DeleteImpact | null {
  const conv = getConversation(db, id);
  if (!conv) return null;
  const taskCount = one(db, `SELECT COUNT(*) c FROM (${TASK_IDS})`, id);
  const other =
    one(db, `SELECT COUNT(*) c FROM ai_tool_calls WHERE run_id IN (${RUN_IDS})`, id) +
    one(db, `SELECT COUNT(*) c FROM ai_tool_executions WHERE run_id IN (${RUN_IDS})`, id) +
    one(db, `SELECT COUNT(*) c FROM ai_approvals WHERE run_id IN (${RUN_IDS})`, id) +
    one(db, `SELECT COUNT(*) c FROM ai_audit_events WHERE run_id IN (${RUN_IDS})`, id) +
    one(db, `SELECT COUNT(*) c FROM ai_agent_handoffs WHERE run_id IN (${RUN_IDS})`, id) +
    one(db, `SELECT COUNT(*) c FROM ai_task_budgets WHERE task_id IN (${TASK_IDS})`, id);
  return {
    id: conv.id,
    title: conv.title,
    status: conv.status,
    messageCount: one(db, `SELECT COUNT(*) c FROM ai_messages WHERE conversation_id = ?`, id),
    runCount: one(db, `SELECT COUNT(*) c FROM ai_runs WHERE conversation_id = ?`, id),
    taskCount,
    otherLinkedRecordCount: other,
    fingerprint: computePlan(db, conv.status, [id]).fingerprint,
  };
}

/**
 * Verified single permanent delete. Requires, in this order:
 *   existing conversation -> status BINNED -> { confirm: true, conversationId: <id> }
 *   -> previewFingerprint equal to the freshly recomputed fingerprint.
 * Then the shared verified core runs (backup etc.). The server trusts nothing from the client.
 */
export function deleteBinnedConversationPermanently(
  db: DatabaseSync,
  id: string,
  confirmation: { confirm?: unknown; conversationId?: unknown; previewFingerprint?: unknown } | null | undefined,
  opts: BackupOptions = {},
  hooks: BulkDeleteHooks = {}
): DeleteResult {
  if (typeof id !== "string" || id.length === 0) return { ok: false, code: "NOT_FOUND", message: "Conversation not found." };
  const conv = getConversation(db, id);
  if (!conv) return { ok: false, code: "NOT_FOUND", message: "Conversation not found." };
  if (conv.status !== "BINNED") {
    return { ok: false, code: "NOT_IN_BIN", message: "Only a conversation in Bin can be permanently deleted." };
  }
  if (!confirmation || confirmation.confirm !== true || confirmation.conversationId !== id) {
    return { ok: false, code: "CONFIRMATION_REQUIRED", message: "Explicit confirmation naming this conversation is required." };
  }
  if (typeof confirmation.previewFingerprint !== "string" || confirmation.previewFingerprint.length === 0) {
    return { ok: false, code: "PREVIEW_REQUIRED", message: "An impact preview fingerprint is required." };
  }
  const impact = getDeleteImpact(db, id)!;
  if (confirmation.previewFingerprint !== impact.fingerprint) {
    return { ok: false, code: "STALE_PREVIEW", message: "Conversation changed. Please review the impact again." };
  }
  const plan = computePlan(db, "BINNED", [id]);
  const r = runVerifiedDelete(db, SINGLE_DELETE_OPERATION, plan, opts, hooks);
  if (!r.ok) return { ok: false, code: r.code, message: r.message };
  return { ok: true, deleted: impact, backup: r.backup };
}

// ============================================================
// Bansil Books Analytics — Action Taken Workflow (Milestone D)
// CRITICAL: finding status/financial resolution and action workflow
// are independent. Closing an action here NEVER forces a reconciliation
// variance to zero, NEVER converts a suspected cause into confirmed,
// NEVER deletes the underlying finding, NEVER alters a match allocation,
// and NEVER mutates source evidence. This file has no import of
// match-service.ts's decision functions and no write path to any
// audit_match_* or audit_normalized_rows table — structurally, not just
// by convention.
// ============================================================

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAuditDatabase } from "../db/audit-database.ts";
import { recordAuditEvent } from "./audit-service.ts";
import { getFinding } from "./findings-service.ts";

function resolveDb(conn?: DatabaseSync): DatabaseSync {
  return conn ?? getAuditDatabase();
}

export class ActionError extends Error {}

export const ACTION_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_EVIDENCE", "RESOLVED", "CLOSED", "CANCELLED"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  OPEN: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "WAITING_EVIDENCE", "CANCELLED"],
  IN_PROGRESS: ["WAITING_EVIDENCE", "RESOLVED", "CANCELLED"],
  WAITING_EVIDENCE: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"], // reopen from RESOLVED back to IN_PROGRESS is allowed
  CLOSED: ["IN_PROGRESS"], // explicit reopen only
  CANCELLED: [],
};

export interface ActionRecord {
  action_id: string;
  finding_id: string;
  action_required: string;
  action_owner: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  due_date: string | null;
  priority: string;
  action_status: ActionStatus;
  action_comment: string | null;
  evidence_added_json: string;
  completed_at: string | null;
  closed_by: string | null;
  closure_comment: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateActionInput {
  findingId: string;
  actionRequired: string;
  actionOwner?: string;
  dueDate?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
}

export function createAction(input: CreateActionInput, actor: string, conn?: DatabaseSync): ActionRecord {
  const db = resolveDb(conn);
  const finding = getFinding(input.findingId, db);
  if (!finding) throw new ActionError(`Finding ${input.findingId} not found`);

  const now = new Date().toISOString();
  const actionId = randomUUID();
  const status: ActionStatus = input.actionOwner ? "ASSIGNED" : "OPEN";
  db.prepare(
    `INSERT INTO audit_actions
      (action_id, finding_id, action_required, action_owner, assigned_by, assigned_at, due_date, priority, action_status,
       action_comment, evidence_added_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '[]', ?, ?, ?)`
  ).run(
    actionId,
    input.findingId,
    input.actionRequired,
    input.actionOwner ?? null,
    input.actionOwner ? actor : null,
    input.actionOwner ? now : null,
    input.dueDate ?? null,
    input.priority ?? "MEDIUM",
    status,
    actor,
    now,
    now
  );

  logActionEvent(db, actionId, "CREATED", null, status, actor, undefined, now);
  recordAuditEvent(db, "ACTION_CREATED", "action", actionId, { findingId: input.findingId, status }, actor);

  return getAction(actionId, db)!;
}

export function getAction(actionId: string, conn?: DatabaseSync): ActionRecord | null {
  const row = resolveDb(conn).prepare(`SELECT * FROM audit_actions WHERE action_id = ?`).get(actionId);
  return (row as unknown as ActionRecord) ?? null;
}

export function listActions(findingId: string, conn?: DatabaseSync): ActionRecord[] {
  return resolveDb(conn).prepare(`SELECT * FROM audit_actions WHERE finding_id = ? ORDER BY created_at DESC`).all(findingId) as unknown as ActionRecord[];
}

export function listActionsByWorkspace(workspaceId: string, conn?: DatabaseSync): Array<ActionRecord & { domain: string; finding_title: string }> {
  return resolveDb(conn)
    .prepare(
      `SELECT a.*, f.domain as domain, f.title as finding_title
       FROM audit_actions a JOIN audit_findings f ON f.finding_id = a.finding_id
       WHERE f.workspace_id = ? ORDER BY a.created_at DESC`
    )
    .all(workspaceId) as unknown as Array<ActionRecord & { domain: string; finding_title: string }>;
}

function logActionEvent(db: DatabaseSync, actionId: string, eventType: string, previousStatus: string | null, newStatus: string | null, actor: string, comment: string | undefined, now: string): void {
  db.prepare(
    `INSERT INTO audit_action_events (event_id, action_id, event_type, previous_status, new_status, actor, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), actionId, eventType, previousStatus, newStatus, actor, comment ?? null, now);
}

export interface UpdateActionInput {
  actionOwner?: string;
  dueDate?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  comment?: string;
  evidenceAdded?: string[]; // evidence_locator strings pointing back to existing frozen evidence — never a new upload path here
}

export function assignAction(actionId: string, input: UpdateActionInput, actor: string, conn?: DatabaseSync): ActionRecord {
  const db = resolveDb(conn);
  const action = getAction(actionId, db);
  if (!action) throw new ActionError(`Action ${actionId} not found`);

  const now = new Date().toISOString();
  const nextStatus: ActionStatus = "ASSIGNED";
  if (!ALLOWED_TRANSITIONS[action.action_status].includes(nextStatus) && action.action_status !== "ASSIGNED") {
    throw new ActionError(`Cannot assign an action in status ${action.action_status}`);
  }
  db.prepare(
    `UPDATE audit_actions SET action_owner = ?, assigned_by = ?, assigned_at = ?, due_date = COALESCE(?, due_date), priority = COALESCE(?, priority), action_status = ?, updated_at = ? WHERE action_id = ?`
  ).run(input.actionOwner ?? action.action_owner, actor, now, input.dueDate ?? null, input.priority ?? null, nextStatus, now, actionId);
  logActionEvent(db, actionId, "ASSIGNED", action.action_status, nextStatus, actor, input.comment, now);
  recordAuditEvent(db, "ACTION_ASSIGNED", "action", actionId, { owner: input.actionOwner }, actor);
  return getAction(actionId, db)!;
}

function transitionStatus(actionId: string, nextStatus: ActionStatus, actor: string, comment: string | undefined, conn: DatabaseSync | undefined, eventType: string): ActionRecord {
  const db = resolveDb(conn);
  const action = getAction(actionId, db);
  if (!action) throw new ActionError(`Action ${actionId} not found`);
  if (!ALLOWED_TRANSITIONS[action.action_status].includes(nextStatus)) {
    throw new ActionError(`Cannot move action from ${action.action_status} to ${nextStatus}. Allowed: ${ALLOWED_TRANSITIONS[action.action_status].join(", ") || "(none)"}`);
  }
  const now = new Date().toISOString();
  db.prepare(`UPDATE audit_actions SET action_status = ?, action_comment = COALESCE(?, action_comment), updated_at = ? WHERE action_id = ?`).run(nextStatus, comment ?? null, now, actionId);
  logActionEvent(db, actionId, eventType, action.action_status, nextStatus, actor, comment, now);
  recordAuditEvent(db, eventType, "action", actionId, { previous: action.action_status, next: nextStatus }, actor);
  return getAction(actionId, db)!;
}

export function markInProgress(actionId: string, actor: string, comment?: string, conn?: DatabaseSync): ActionRecord {
  return transitionStatus(actionId, "IN_PROGRESS", actor, comment, conn, "ACTION_STATUS_CHANGED");
}
export function markWaitingEvidence(actionId: string, actor: string, comment?: string, conn?: DatabaseSync): ActionRecord {
  return transitionStatus(actionId, "WAITING_EVIDENCE", actor, comment, conn, "ACTION_STATUS_CHANGED");
}
export function cancelAction(actionId: string, actor: string, comment?: string, conn?: DatabaseSync): ActionRecord {
  return transitionStatus(actionId, "CANCELLED", actor, comment, conn, "ACTION_STATUS_CHANGED");
}

export function addActionEvidence(actionId: string, evidenceLocators: string[], actor: string, conn?: DatabaseSync): ActionRecord {
  const db = resolveDb(conn);
  const action = getAction(actionId, db);
  if (!action) throw new ActionError(`Action ${actionId} not found`);
  const existing = JSON.parse(action.evidence_added_json) as string[];
  const merged = [...existing, ...evidenceLocators];
  const now = new Date().toISOString();
  db.prepare(`UPDATE audit_actions SET evidence_added_json = ?, updated_at = ? WHERE action_id = ?`).run(JSON.stringify(merged), now, actionId);
  logActionEvent(db, actionId, "EVIDENCE_ADDED", action.action_status, action.action_status, actor, evidenceLocators.join(", "), now);
  recordAuditEvent(db, "ACTION_EVIDENCE_ADDED", "action", actionId, { evidenceLocators }, actor);
  return getAction(actionId, db)!;
}

export function resolveAction(actionId: string, actor: string, comment: string | undefined, conn?: DatabaseSync): ActionRecord {
  transitionStatus(actionId, "RESOLVED", actor, comment, conn, "ACTION_STATUS_CHANGED");
  const db = resolveDb(conn);
  const now = new Date().toISOString();
  db.prepare(`UPDATE audit_actions SET completed_at = ? WHERE action_id = ?`).run(now, actionId);
  return getAction(actionId, db)!;
}

/**
 * The one function that may set status CLOSED. Structurally cannot
 * touch audit_findings, audit_match_groups, audit_match_decisions, or
 * any audit_normalized_rows/audit_source_* table — no import of those
 * service modules exists in this file, and this function only ever
 * writes to audit_actions/audit_action_events/audit_events.
 */
export function closeAction(actionId: string, closedBy: string, closureComment: string, conn?: DatabaseSync): ActionRecord {
  const db = resolveDb(conn);
  const action = getAction(actionId, db);
  if (!action) throw new ActionError(`Action ${actionId} not found`);
  if (!ALLOWED_TRANSITIONS[action.action_status].includes("CLOSED")) {
    throw new ActionError(`Cannot close an action in status ${action.action_status}. It must be RESOLVED first.`);
  }
  const now = new Date().toISOString();
  db.prepare(`UPDATE audit_actions SET action_status = 'CLOSED', closed_by = ?, closure_comment = ?, updated_at = ? WHERE action_id = ?`).run(closedBy, closureComment, now, actionId);
  logActionEvent(db, actionId, "CLOSED", action.action_status, "CLOSED", closedBy, closureComment, now);
  recordAuditEvent(db, "ACTION_CLOSED", "action", actionId, { closureComment }, closedBy);
  return getAction(actionId, db)!;
}

/** Reopen a CLOSED (or RESOLVED) action back to IN_PROGRESS — never deletes prior history, only appends a new event. */
export function reopenAction(actionId: string, actor: string, reason: string, conn?: DatabaseSync): ActionRecord {
  const db = resolveDb(conn);
  const action = getAction(actionId, db);
  if (!action) throw new ActionError(`Action ${actionId} not found`);
  if (action.action_status !== "CLOSED" && action.action_status !== "RESOLVED") {
    throw new ActionError(`Only a CLOSED or RESOLVED action may be reopened (current status: ${action.action_status})`);
  }
  const now = new Date().toISOString();
  db.prepare(`UPDATE audit_actions SET action_status = 'IN_PROGRESS', updated_at = ? WHERE action_id = ?`).run(now, actionId);
  logActionEvent(db, actionId, "REOPENED", action.action_status, "IN_PROGRESS", actor, reason, now);
  recordAuditEvent(db, "ACTION_REOPENED", "action", actionId, { reason }, actor);
  return getAction(actionId, db)!;
}

export function listActionEvents(actionId: string, conn?: DatabaseSync): Record<string, unknown>[] {
  return resolveDb(conn).prepare(`SELECT * FROM audit_action_events WHERE action_id = ? ORDER BY created_at ASC`).all(actionId) as unknown as Record<string, unknown>[];
}

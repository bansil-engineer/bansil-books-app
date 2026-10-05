// ============================================================
// Bansil Books Analytics — One-Time Overrides (Milestone E)
// A one-time override applies ONLY to the approved case: it never edits
// the underlying rule set, never becomes training automatically, and
// always records reviewer + reason + evidence. Structurally separate
// from learning_proposals — this file has no import of learning-service.ts's
// write functions and never touches audit_findings/audit_match_groups.
// ============================================================

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAuditDatabase } from "../../db/audit-database.ts";
import { recordAuditEvent } from "../audit-service.ts";

function resolveDb(conn?: DatabaseSync): DatabaseSync {
  return conn ?? getAuditDatabase();
}

export class OverrideError extends Error {}

export interface OverrideRecord {
  override_id: string;
  workspace_id: string | null;
  finding_id: string | null;
  unsupported_case_id: string | null;
  target_description: string;
  override_action: string;
  reviewer: string;
  reason: string;
  evidence_json: string;
  created_by: string;
  created_at: string;
}

export interface CreateOverrideInput {
  workspaceId?: string;
  findingId?: string;
  unsupportedCaseId?: string;
  targetDescription: string;
  overrideAction: string;
  reviewer: string;
  reason: string;
  evidence?: string[];
}

/** Records a one-time approved override. This function performs no write against any finding, match group, or source table — it is purely a governance log entry. */
export function createOverride(input: CreateOverrideInput, actor: string, conn?: DatabaseSync): OverrideRecord {
  const db = resolveDb(conn);
  if (!input.targetDescription?.trim()) throw new OverrideError("targetDescription is required");
  if (!input.overrideAction?.trim()) throw new OverrideError("overrideAction is required");
  if (!input.reviewer?.trim()) throw new OverrideError("A named reviewer is required");
  if (!input.reason?.trim()) throw new OverrideError("A reason is required");

  const overrideId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO learning_overrides (override_id, workspace_id, finding_id, unsupported_case_id, target_description, override_action, reviewer, reason, evidence_json, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(overrideId, input.workspaceId ?? null, input.findingId ?? null, input.unsupportedCaseId ?? null, input.targetDescription, input.overrideAction, input.reviewer, input.reason, JSON.stringify(input.evidence ?? []), actor, now);

  recordAuditEvent(db, "LEARNING_OVERRIDE_CREATED", "learning_override", overrideId, { targetDescription: input.targetDescription, reviewer: input.reviewer }, actor);
  return getOverride(overrideId, db)!;
}

export function getOverride(overrideId: string, conn?: DatabaseSync): OverrideRecord | null {
  const row = resolveDb(conn).prepare(`SELECT * FROM learning_overrides WHERE override_id = ?`).get(overrideId);
  return (row as unknown as OverrideRecord) ?? null;
}

export function listOverrides(filter: { workspaceId?: string; findingId?: string } = {}, conn?: DatabaseSync): OverrideRecord[] {
  const db = resolveDb(conn);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.workspaceId) {
    clauses.push("workspace_id = ?");
    params.push(filter.workspaceId);
  }
  if (filter.findingId) {
    clauses.push("finding_id = ?");
    params.push(filter.findingId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM learning_overrides ${where} ORDER BY created_at DESC`).all(...params) as unknown as OverrideRecord[];
}

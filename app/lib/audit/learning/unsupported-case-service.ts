// ============================================================
// Bansil Books Analytics — Unsupported / Uncertain Case Workflow (Milestone E)
// Every case records what is unsupported/uncertain, affected records/
// amount, evidence reviewed, current rule(s), and why no safe decision
// was possible. The owner must explicitly choose one of four resolution
// paths — nothing here silently picks a default.
// ============================================================

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAuditDatabase } from "../../db/audit-database.ts";
import { recordAuditEvent } from "../audit-service.ts";
import { UNSUPPORTED_CASE_RESOLUTIONS, type UnsupportedCaseResolution } from "./learning-types.ts";

function resolveDb(conn?: DatabaseSync): DatabaseSync {
  return conn ?? getAuditDatabase();
}

export class UnsupportedCaseError extends Error {}

export interface UnsupportedCaseRecord {
  case_id: string;
  workspace_id: string | null;
  finding_id: string | null;
  description: string;
  affected_records_estimate: number | null;
  affected_amount: string | null;
  evidence_json: string;
  current_rules_json: string;
  reason_no_safe_decision: string;
  status: string;
  resolution_type: string | null;
  resolution_ref_id: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateUnsupportedCaseInput {
  workspaceId?: string;
  findingId?: string;
  description: string;
  affectedRecordsEstimate?: number;
  affectedAmount?: string;
  evidence?: string[];
  currentRules?: string[];
  reasonNoSafeDecision: string;
}

export function createUnsupportedCase(input: CreateUnsupportedCaseInput, actor: string, conn?: DatabaseSync): UnsupportedCaseRecord {
  const db = resolveDb(conn);
  if (!input.description?.trim()) throw new UnsupportedCaseError("description is required");
  if (!input.reasonNoSafeDecision?.trim()) throw new UnsupportedCaseError("reasonNoSafeDecision is required");

  const caseId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO learning_unsupported_cases
      (case_id, workspace_id, finding_id, description, affected_records_estimate, affected_amount, evidence_json, current_rules_json,
       reason_no_safe_decision, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`
  ).run(
    caseId,
    input.workspaceId ?? null,
    input.findingId ?? null,
    input.description,
    input.affectedRecordsEstimate ?? null,
    input.affectedAmount ?? null,
    JSON.stringify(input.evidence ?? []),
    JSON.stringify(input.currentRules ?? []),
    input.reasonNoSafeDecision,
    actor,
    now,
    now
  );

  recordAuditEvent(db, "LEARNING_UNSUPPORTED_CASE_CREATED", "learning_unsupported_case", caseId, { description: input.description }, actor);
  return getUnsupportedCase(caseId, db)!;
}

export function getUnsupportedCase(caseId: string, conn?: DatabaseSync): UnsupportedCaseRecord | null {
  const row = resolveDb(conn).prepare(`SELECT * FROM learning_unsupported_cases WHERE case_id = ?`).get(caseId);
  return (row as unknown as UnsupportedCaseRecord) ?? null;
}

export function listUnsupportedCases(filter: { workspaceId?: string; status?: string } = {}, conn?: DatabaseSync): UnsupportedCaseRecord[] {
  const db = resolveDb(conn);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.workspaceId) {
    clauses.push("workspace_id = ?");
    params.push(filter.workspaceId);
  }
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM learning_unsupported_cases ${where} ORDER BY created_at DESC`).all(...params) as unknown as UnsupportedCaseRecord[];
}

/**
 * Resolves a case via exactly one of the four owner-chosen paths:
 * HOLD, REQUEST_EVIDENCE, ONE_TIME_OVERRIDE (resolutionRefId = override_id,
 * created separately via override-service.ts BEFORE calling this), or
 * PROPOSE_RULE (resolutionRefId = proposal_id, created separately via
 * learning-service.ts BEFORE calling this). Never silently chooses one.
 */
export function resolveUnsupportedCase(
  caseId: string,
  resolutionType: UnsupportedCaseResolution,
  resolutionRefId: string | undefined,
  actor: string,
  conn?: DatabaseSync
): UnsupportedCaseRecord {
  const db = resolveDb(conn);
  const kase = getUnsupportedCase(caseId, db);
  if (!kase) throw new UnsupportedCaseError(`Unsupported case ${caseId} not found`);
  if (!UNSUPPORTED_CASE_RESOLUTIONS.includes(resolutionType)) throw new UnsupportedCaseError(`Invalid resolution type: ${resolutionType}`);
  if ((resolutionType === "ONE_TIME_OVERRIDE" || resolutionType === "PROPOSE_RULE") && !resolutionRefId) {
    throw new UnsupportedCaseError(`resolutionRefId is required for resolution type ${resolutionType}`);
  }

  const statusMap: Record<UnsupportedCaseResolution, string> = {
    HOLD: "HOLD",
    REQUEST_EVIDENCE: "EVIDENCE_REQUESTED",
    ONE_TIME_OVERRIDE: "OVERRIDE_APPLIED",
    PROPOSE_RULE: "RULE_PROPOSED",
  };
  const now = new Date().toISOString();
  const nextStatus = statusMap[resolutionType];
  db.prepare(
    `UPDATE learning_unsupported_cases SET status = ?, resolution_type = ?, resolution_ref_id = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE case_id = ?`
  ).run(nextStatus, resolutionType, resolutionRefId ?? null, actor, now, now, caseId);

  recordAuditEvent(db, "LEARNING_UNSUPPORTED_CASE_RESOLVED", "learning_unsupported_case", caseId, { resolutionType, resolutionRefId }, actor);
  return getUnsupportedCase(caseId, db)!;
}

/** Marks a case fully RESOLVED (terminal) once its chosen resolution path has itself been completed (e.g. the proposed rule was activated, or the override was applied and confirmed). */
export function markUnsupportedCaseResolved(caseId: string, actor: string, conn?: DatabaseSync): UnsupportedCaseRecord {
  const db = resolveDb(conn);
  const kase = getUnsupportedCase(caseId, db);
  if (!kase) throw new UnsupportedCaseError(`Unsupported case ${caseId} not found`);
  if (!kase.resolution_type) throw new UnsupportedCaseError("A case must have a resolution path chosen before it can be marked RESOLVED.");
  const now = new Date().toISOString();
  db.prepare(`UPDATE learning_unsupported_cases SET status = 'RESOLVED', updated_at = ? WHERE case_id = ?`).run(now, caseId);
  recordAuditEvent(db, "LEARNING_UNSUPPORTED_CASE_CLOSED", "learning_unsupported_case", caseId, {}, actor);
  return getUnsupportedCase(caseId, db)!;
}

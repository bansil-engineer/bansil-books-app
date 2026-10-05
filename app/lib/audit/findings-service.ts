// ============================================================
// Bansil Books Analytics — Findings Register (Milestone D)
// Findings carry immutable evidence references. Severity is always
// reviewer-set (never amount-derived); confirmed_vs_suspected defaults
// to SUSPECTED and only an explicit reviewer action promotes it.
// ============================================================

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAuditDatabase } from "../db/audit-database.ts";
import { recordAuditEvent } from "./audit-service.ts";

function resolveDb(conn?: DatabaseSync): DatabaseSync {
  return conn ?? getAuditDatabase();
}

export class FindingError extends Error {}

export const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const FINDING_TYPES = [
  "UNMATCHED_TRANSACTION",
  "AMOUNT_VARIANCE",
  "TIMING_DATE_VARIANCE",
  "REFERENCE_DOCUMENT_MISMATCH",
  "CURRENCY_MISMATCH",
  "QUANTITY_MISMATCH",
  "UNIT_MISMATCH",
  "DUPLICATE_AMBIGUOUS_EVIDENCE",
  "UNSUPPORTED_DEDUCTION",
  "MISSING_DOCUMENT_EVIDENCE",
  "OPENING_CLOSING_BALANCE_INCONSISTENCY",
  "SOURCE_COMPLETENESS_LIMITATION",
  "MAPPING_PARSING_LIMITATION",
  "POTENTIAL_DUPLICATE",
  "POSSIBLE_WRONG_PARTY_ACCOUNT",
  "REVIEW_LIMITATION",
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

export const CONFIRMATION_STATES = ["CONFIRMED", "SUSPECTED", "UNKNOWN"] as const;
export type ConfirmationState = (typeof CONFIRMATION_STATES)[number];

export const FINDING_STATUSES = ["OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export interface FindingRecord {
  finding_id: string;
  workspace_id: string;
  run_id: string | null;
  domain_review_id: string | null;
  domain: string;
  severity: Severity;
  finding_type: FindingType;
  title: string;
  description: string | null;
  confirmed_vs_suspected: ConfirmationState;
  financial_impact: string | null;
  quantity_impact: string | null;
  currency: string | null;
  unit: string | null;
  affected_refs_json: string;
  evidence_refs_json: string;
  source_snapshot_json: string;
  rule_version: string | null;
  reviewer: string | null;
  status: FindingStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateFindingInput {
  workspaceId: string;
  runId?: string;
  domainReviewId?: string;
  domain: string;
  severity: Severity;
  findingType: FindingType;
  title: string;
  description?: string;
  confirmedVsSuspected?: ConfirmationState;
  financialImpact?: string;
  quantityImpact?: string;
  currency?: string;
  unit?: string;
  affectedRefs?: string[];
  evidenceRefs?: string[];
  sourceSnapshot?: Record<string, unknown>;
  ruleVersion?: string;
}

export function createFinding(input: CreateFindingInput, actor: string, conn?: DatabaseSync): FindingRecord {
  const db = resolveDb(conn);
  if (!SEVERITIES.includes(input.severity)) throw new FindingError(`Invalid severity: ${input.severity}`);
  if (!FINDING_TYPES.includes(input.findingType)) throw new FindingError(`Invalid finding_type: ${input.findingType}`);
  const workspace = db.prepare(`SELECT workspace_id FROM audit_workspaces WHERE workspace_id = ?`).get(input.workspaceId);
  if (!workspace) throw new FindingError(`Workspace ${input.workspaceId} not found`);

  const now = new Date().toISOString();
  const findingId = randomUUID();
  db.prepare(
    `INSERT INTO audit_findings
      (finding_id, workspace_id, run_id, domain_review_id, domain, severity, finding_type, title, description,
       confirmed_vs_suspected, financial_impact, quantity_impact, currency, unit, affected_refs_json, evidence_refs_json,
       source_snapshot_json, rule_version, reviewer, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`
  ).run(
    findingId,
    input.workspaceId,
    input.runId ?? null,
    input.domainReviewId ?? null,
    input.domain,
    input.severity,
    input.findingType,
    input.title,
    input.description ?? null,
    input.confirmedVsSuspected ?? "SUSPECTED",
    input.financialImpact ?? null,
    input.quantityImpact ?? null,
    input.currency ?? null,
    input.unit ?? null,
    JSON.stringify(input.affectedRefs ?? []),
    JSON.stringify(input.evidenceRefs ?? []),
    JSON.stringify(input.sourceSnapshot ?? {}),
    input.ruleVersion ?? null,
    actor,
    actor,
    now,
    now
  );

  recordAuditEvent(db, "FINDING_CREATED", "finding", findingId, { domain: input.domain, severity: input.severity, findingType: input.findingType }, actor);

  return db.prepare(`SELECT * FROM audit_findings WHERE finding_id = ?`).get(findingId) as unknown as FindingRecord;
}

export function listFindings(workspaceId: string, filter: { domain?: string; severity?: string; status?: string } = {}, conn?: DatabaseSync): FindingRecord[] {
  const db = resolveDb(conn);
  const clauses = ["workspace_id = ?"];
  const params: unknown[] = [workspaceId];
  if (filter.domain) {
    clauses.push("domain = ?");
    params.push(filter.domain);
  }
  if (filter.severity) {
    clauses.push("severity = ?");
    params.push(filter.severity);
  }
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
      // @ts-ignore
  return db.prepare(`SELECT * FROM audit_findings WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`).all(...params) as unknown as FindingRecord[];
}

export function getFinding(findingId: string, conn?: DatabaseSync): FindingRecord | null {
  const row = resolveDb(conn).prepare(`SELECT * FROM audit_findings WHERE finding_id = ?`).get(findingId);
  return (row as unknown as FindingRecord) ?? null;
}

/**
 * Explicitly promotes/demotes confirmed_vs_suspected — this is the ONLY
 * function that may change this field, and it always requires a named
 * reviewer and reason; nothing does this automatically.
 */
export function setFindingConfirmation(findingId: string, confirmedVsSuspected: ConfirmationState, reviewer: string, reason: string, conn?: DatabaseSync): FindingRecord {
  const db = resolveDb(conn);
  const finding = getFinding(findingId, db);
  if (!finding) throw new FindingError(`Finding ${findingId} not found`);
  if (!CONFIRMATION_STATES.includes(confirmedVsSuspected)) throw new FindingError(`Invalid confirmation state: ${confirmedVsSuspected}`);

  const now = new Date().toISOString();
  db.prepare(`UPDATE audit_findings SET confirmed_vs_suspected = ?, updated_at = ? WHERE finding_id = ?`).run(confirmedVsSuspected, now, findingId);
  db.prepare(
    `INSERT INTO audit_reviewer_decisions (decision_id, entity_type, entity_id, reviewer, role_context, decision, comment, source_run_version_json, created_at)
     VALUES (?, 'finding', ?, ?, 'confirmation', ?, ?, '{}', ?)`
  ).run(randomUUID(), findingId, reviewer, confirmedVsSuspected, reason, now);
  recordAuditEvent(db, "FINDING_CONFIRMATION_SET", "finding", findingId, { previous: finding.confirmed_vs_suspected, next: confirmedVsSuspected, reason }, reviewer);

  return getFinding(findingId, db)!;
}

export function setFindingStatus(findingId: string, status: FindingStatus, reviewer: string, comment: string | undefined, conn?: DatabaseSync): FindingRecord {
  const db = resolveDb(conn);
  const finding = getFinding(findingId, db);
  if (!finding) throw new FindingError(`Finding ${findingId} not found`);
  if (!FINDING_STATUSES.includes(status)) throw new FindingError(`Invalid finding status: ${status}`);

  const now = new Date().toISOString();
  db.prepare(`UPDATE audit_findings SET status = ?, reviewer = ?, updated_at = ? WHERE finding_id = ?`).run(status, reviewer, now, findingId);
  db.prepare(
    `INSERT INTO audit_reviewer_decisions (decision_id, entity_type, entity_id, reviewer, role_context, decision, comment, source_run_version_json, created_at)
     VALUES (?, 'finding', ?, ?, 'status', ?, ?, '{}', ?)`
  ).run(randomUUID(), findingId, reviewer, status, comment ?? null, now);
  recordAuditEvent(db, "FINDING_STATUS_CHANGED", "finding", findingId, { previous: finding.status, next: status }, reviewer);

  return getFinding(findingId, db)!;
}

export function listReviewerDecisions(entityType: string, entityId: string, conn?: DatabaseSync): Record<string, unknown>[] {
  return resolveDb(conn)
    .prepare(`SELECT * FROM audit_reviewer_decisions WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC`)
    .all(entityType, entityId) as unknown as Record<string, unknown>[];
}

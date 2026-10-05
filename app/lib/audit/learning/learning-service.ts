// ============================================================
// Bansil Books Analytics — Controlled Learning Service (Milestone E)
// SUGGEST_ONLY by default. Every lifecycle transition is an explicit,
// recorded action — nothing here auto-promotes, auto-activates, or
// writes to Zoho/Books/any frozen source, run, or report. Rules are
// immutable by version: a replacement is always a NEW row.
// ============================================================

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAuditDatabase } from "../../db/audit-database.ts";
import { recordAuditEvent } from "../audit-service.ts";
import { evaluateRule, runExamplesAgainstRule, type RuleTestSummary } from "./rule-evaluator.ts";
import {
  LEARNING_PROPOSAL_TYPES,
  SCOPE_TYPES,
  PROPOSAL_STATUSES,
  EXAMPLE_TYPES,
  CONFLICT_TYPES,
  type LearningProposalType,
  type ScopeType,
  type ProposalStatus,
  type ExampleType,
  type RuleConfig,
} from "./learning-types.ts";

function resolveDb(conn?: DatabaseSync): DatabaseSync {
  return conn ?? getAuditDatabase();
}

export class LearningError extends Error {}

export interface LearningProposalRecord {
  proposal_id: string;
  rule_key: string;
  version_number: number;
  predecessor_version_id: string | null;
  proposal_type: LearningProposalType;
  module: string;
  workspace_id: string | null;
  scope_type: ScopeType;
  scope_value_json: string;
  source_format_scope: string | null;
  effective_from: string | null;
  effective_to: string | null;
  rule_config_json: string;
  title: string;
  evidence_json: string;
  rationale: string | null;
  expected_impact: string | null;
  affected_records_estimate: number | null;
  test_results_json: string;
  conflict_analysis_json: string;
  rollback_of_version_id: string | null;
  expiry_date: string | null;
  review_by_date: string | null;
  status: ProposalStatus;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  activated_at: string | null;
  disabled_at: string | null;
  disabled_by: string | null;
  disabled_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProposalInput {
  ruleKey?: string; // omit to start a brand-new rule; provide an existing rule_key to propose a replacement version
  proposalType: LearningProposalType;
  module: string;
  workspaceId?: string;
  scopeType: ScopeType;
  scopeValue?: Record<string, unknown>;
  sourceFormatScope?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  ruleConfig: RuleConfig;
  title: string;
  evidence?: string[];
  rationale?: string;
  expectedImpact?: string;
  affectedRecordsEstimate?: number;
  expiryDate?: string;
  reviewByDate?: string;
}

function nextVersionNumber(db: DatabaseSync, ruleKey: string): number {
  const row = db.prepare(`SELECT MAX(version_number) as maxv FROM learning_proposals WHERE rule_key = ?`).get(ruleKey) as { maxv: number | null } | undefined;
  return (row?.maxv ?? 0) + 1;
}

function logEvent(db: DatabaseSync, proposalId: string, eventType: string, previousStatus: string | null, newStatus: string | null, actor: string, comment?: string, details?: Record<string, unknown>): void {
  db.prepare(
    `INSERT INTO learning_proposal_events (event_id, proposal_id, event_type, previous_status, new_status, actor, comment, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), proposalId, eventType, previousStatus, newStatus, actor, comment ?? null, JSON.stringify(details ?? {}), new Date().toISOString());
}

/** Creates a new proposal in DRAFT. A brand-new rule gets a fresh rule_key (version 1); an existing rule_key gets the next version number, with predecessor_version_id set to that rule_key's current latest version. Never auto-activates. */
export function createProposal(input: CreateProposalInput, actor: string, conn?: DatabaseSync): LearningProposalRecord {
  const db = resolveDb(conn);
  if (!LEARNING_PROPOSAL_TYPES.includes(input.proposalType)) throw new LearningError(`Invalid proposal_type: ${input.proposalType}`);
  if (!SCOPE_TYPES.includes(input.scopeType)) throw new LearningError(`Invalid scope_type: ${input.scopeType}`);
  if (!input.ruleConfig?.matchField || typeof input.ruleConfig.matchPattern !== "string") {
    throw new LearningError("ruleConfig.matchField and ruleConfig.matchPattern are required");
  }
  if (!input.title?.trim()) throw new LearningError("title is required");

  const ruleKey = input.ruleKey ?? randomUUID();
  let predecessorVersionId: string | null = null;
  if (input.ruleKey) {
    const latest = db.prepare(`SELECT proposal_id FROM learning_proposals WHERE rule_key = ? ORDER BY version_number DESC LIMIT 1`).get(input.ruleKey) as { proposal_id: string } | undefined;
    if (!latest) throw new LearningError(`No existing rule found for rule_key ${input.ruleKey}`);
    predecessorVersionId = latest.proposal_id;
  }

  const versionNumber = nextVersionNumber(db, ruleKey);
  const proposalId = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO learning_proposals
      (proposal_id, rule_key, version_number, predecessor_version_id, proposal_type, module, workspace_id, scope_type, scope_value_json,
       source_format_scope, effective_from, effective_to, rule_config_json, title, evidence_json, rationale, expected_impact,
       affected_records_estimate, test_results_json, conflict_analysis_json, rollback_of_version_id, expiry_date, review_by_date,
       status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', '[]', NULL, ?, ?, 'DRAFT', ?, ?, ?)`
  ).run(
    proposalId,
    ruleKey,
    versionNumber,
    predecessorVersionId,
    input.proposalType,
    input.module,
    input.workspaceId ?? null,
    input.scopeType,
    JSON.stringify(input.scopeValue ?? {}),
    input.sourceFormatScope ?? null,
    input.effectiveFrom ?? null,
    input.effectiveTo ?? null,
    JSON.stringify(input.ruleConfig),
    input.title,
    JSON.stringify(input.evidence ?? []),
    input.rationale ?? null,
    input.expectedImpact ?? null,
    input.affectedRecordsEstimate ?? null,
    input.expiryDate ?? null,
    input.reviewByDate ?? null,
    actor,
    now,
    now
  );

  logEvent(db, proposalId, "PROPOSAL_CREATED", null, "DRAFT", actor, undefined, { ruleKey, versionNumber });
  recordAuditEvent(db, "LEARNING_PROPOSAL_CREATED", "learning_proposal", proposalId, { ruleKey, proposalType: input.proposalType, scopeType: input.scopeType }, actor);

  return getProposal(proposalId, db)!;
}

export function getProposal(proposalId: string, conn?: DatabaseSync): LearningProposalRecord | null {
  const row = resolveDb(conn).prepare(`SELECT * FROM learning_proposals WHERE proposal_id = ?`).get(proposalId);
  return (row as unknown as LearningProposalRecord) ?? null;
}

export function listProposals(filter: { workspaceId?: string; status?: string; ruleKey?: string } = {}, conn?: DatabaseSync): LearningProposalRecord[] {
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
  if (filter.ruleKey) {
    clauses.push("rule_key = ?");
    params.push(filter.ruleKey);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM learning_proposals ${where} ORDER BY created_at DESC`).all(...params) as unknown as LearningProposalRecord[];
}

/** Every version ever recorded under one rule_key, oldest first — the lineage rollback/history views need. */
export function listRuleHistory(ruleKey: string, conn?: DatabaseSync): LearningProposalRecord[] {
  return resolveDb(conn).prepare(`SELECT * FROM learning_proposals WHERE rule_key = ? ORDER BY version_number ASC`).all(ruleKey) as unknown as LearningProposalRecord[];
}

export function addExample(
  proposalId: string,
  input: { exampleType: ExampleType; input: Record<string, unknown>; description?: string },
  actor: string,
  conn?: DatabaseSync
): LearningProposalRecord {
  const db = resolveDb(conn);
  const proposal = getProposal(proposalId, db);
  if (!proposal) throw new LearningError(`Proposal ${proposalId} not found`);
  if (!["DRAFT", "TESTING"].includes(proposal.status)) {
    throw new LearningError(`Examples can only be added while a proposal is DRAFT or TESTING (current: ${proposal.status})`);
  }
  if (!EXAMPLE_TYPES.includes(input.exampleType)) throw new LearningError(`Invalid example_type: ${input.exampleType}`);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO learning_proposal_examples (example_id, proposal_id, example_type, input_json, expected_apply, description, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), proposalId, input.exampleType, JSON.stringify(input.input), input.exampleType === "POSITIVE" ? 1 : 0, input.description ?? null, actor, now);

  logEvent(db, proposalId, "EXAMPLE_ADDED", proposal.status, proposal.status, actor, undefined, { exampleType: input.exampleType });
  return getProposal(proposalId, db)!;
}

export function listExamples(proposalId: string, conn?: DatabaseSync): Array<Record<string, unknown>> {
  return resolveDb(conn).prepare(`SELECT * FROM learning_proposal_examples WHERE proposal_id = ? ORDER BY created_at ASC`).all(proposalId) as unknown as Array<Record<string, unknown>>;
}

/**
 * Runs every declared example against the proposal's rule config and
 * freezes the result into test_results_json. Requires at least one
 * POSITIVE and one NEGATIVE/HARD_NEGATIVE example — "do not approve a
 * rule tested only on the example that created it". Never alters an
 * assertion to force a PASS: if examples fail, test_results_json.allPassed
 * is false and submitForApproval refuses to proceed.
 */
export function runProposalTests(proposalId: string, actor: string, conn?: DatabaseSync): { proposal: LearningProposalRecord; testResults: RuleTestSummary } {
  const db = resolveDb(conn);
  const proposal = getProposal(proposalId, db);
  if (!proposal) throw new LearningError(`Proposal ${proposalId} not found`);
  if (!["DRAFT", "TESTING"].includes(proposal.status)) {
    throw new LearningError(`Tests can only be run while a proposal is DRAFT or TESTING (current: ${proposal.status})`);
  }

  const examples = listExamples(proposalId, db) as Array<{ example_id: string; example_type: string; expected_apply: number; input_json: string }>;
  const positives = examples.filter((e) => e.example_type === "POSITIVE");
  const negatives = examples.filter((e) => e.example_type === "NEGATIVE" || e.example_type === "HARD_NEGATIVE");
  if (positives.length === 0 || negatives.length === 0) {
    throw new LearningError("At least one POSITIVE and one NEGATIVE (or HARD_NEGATIVE) example are required before running tests.");
  }

  const config = JSON.parse(proposal.rule_config_json) as RuleConfig;
  const testResults = runExamplesAgainstRule(
    config,
    examples.map((e) => ({ exampleId: e.example_id, exampleType: e.example_type, expectedApply: e.expected_apply === 1, input: JSON.parse(e.input_json) }))
  );

  const now = new Date().toISOString();
  db.prepare(`UPDATE learning_proposals SET status = 'TESTING', test_results_json = ?, updated_at = ? WHERE proposal_id = ?`).run(JSON.stringify(testResults), now, proposalId);
  logEvent(db, proposalId, "TESTS_RUN", proposal.status, "TESTING", actor, undefined, { allPassed: testResults.allPassed, passed: testResults.passed, failed: testResults.failed });
  recordAuditEvent(db, "LEARNING_PROPOSAL_TESTED", "learning_proposal", proposalId, { allPassed: testResults.allPassed }, actor);

  return { proposal: getProposal(proposalId, db)!, testResults };
}

/**
 * Detects conflicts against currently ACTIVE proposals. Returns OPEN
 * conflicts (never auto-resolves); persists any newly found conflicts.
 * Called before submission and again before activation — activation is
 * refused while any OPEN conflict touches this proposal.
 */
export function detectConflicts(proposalId: string, conn?: DatabaseSync): Array<Record<string, unknown>> {
  const db = resolveDb(conn);
  const proposal = getProposal(proposalId, db);
  if (!proposal) throw new LearningError(`Proposal ${proposalId} not found`);

  const activeSameRuleKey = db.prepare(`SELECT * FROM learning_proposals WHERE rule_key = ? AND status = 'ACTIVE' AND proposal_id != ?`).all(proposal.rule_key, proposalId) as unknown as LearningProposalRecord[];
  const activeSameType = db.prepare(`SELECT * FROM learning_proposals WHERE proposal_type = ? AND status = 'ACTIVE' AND proposal_id != ? AND rule_key != ?`).all(proposal.proposal_type, proposalId, proposal.rule_key) as unknown as LearningProposalRecord[];

  const found: Array<{ otherId: string; conflictType: string; description: string }> = [];

  for (const other of activeSameRuleKey) {
    // Superseding one's own direct predecessor is normal versioning, not a
    // conflict — approveAndActivate() disables the predecessor as part of
    // the same activation. Only a DIFFERENT active version (e.g. a stray
    // branch created from an older ancestor) is a real conflict here.
    if (other.proposal_id === proposal.predecessor_version_id) continue;
    if (other.rule_config_json !== proposal.rule_config_json) {
      found.push({ otherId: other.proposal_id, conflictType: "SAME_SCOPE_SAME_RULE_KEY_DIFFERENT_CONFIG", description: `Rule ${proposal.rule_key} has an active version (${other.proposal_id}) with a different configuration than this proposal.` });
    }
  }

  for (const other of activeSameType) {
    const sameScopeValue = other.scope_value_json === proposal.scope_value_json && other.scope_type === proposal.scope_type;
    if (sameScopeValue && other.rule_config_json !== proposal.rule_config_json) {
      found.push({ otherId: other.proposal_id, conflictType: "OVERLAPPING_SCOPE", description: `Another active ${proposal.proposal_type} rule (${other.proposal_id}) shares this exact scope but configures it differently.` });
    }
    if (proposal.scope_type === "GLOBAL" && other.scope_type !== "GLOBAL") {
      found.push({ otherId: other.proposal_id, conflictType: "GLOBAL_VS_SCOPED", description: `A GLOBAL ${proposal.proposal_type} rule may conflict with the more specific active rule ${other.proposal_id} (scope: ${other.scope_type}) — precedence must be resolved explicitly, never silently.` });
    }
    if (other.scope_type === "GLOBAL" && proposal.scope_type !== "GLOBAL") {
      found.push({ otherId: other.proposal_id, conflictType: "GLOBAL_VS_SCOPED", description: `This scoped proposal may conflict with active GLOBAL rule ${other.proposal_id} — precedence must be resolved explicitly, never silently.` });
    }
    if (proposal.proposal_type === "SIGN_PERSPECTIVE_RULE" && other.rule_config_json !== proposal.rule_config_json) {
      found.push({ otherId: other.proposal_id, conflictType: "SIGN_PERSPECTIVE_DISAGREEMENT", description: `Two active sign-perspective rules (${proposal.proposal_id} pending, ${other.proposal_id} active) disagree.` });
    }
    if (proposal.effective_from && proposal.effective_to && other.effective_from && other.effective_to) {
      const overlap = proposal.effective_from <= other.effective_to && other.effective_from <= proposal.effective_to;
      if (overlap && other.rule_config_json !== proposal.rule_config_json) {
        found.push({ otherId: other.proposal_id, conflictType: "OVERLAPPING_DATE_RANGE", description: `Effective date range overlaps with active rule ${other.proposal_id} with a different configuration.` });
      }
    }
  }

  const now = new Date().toISOString();
  const persisted: Array<Record<string, unknown>> = [];
  for (const f of found) {
    if (!CONFLICT_TYPES.includes(f.conflictType as (typeof CONFLICT_TYPES)[number])) continue;
    const existing = db
      .prepare(`SELECT * FROM learning_conflicts WHERE ((proposal_a_id = ? AND proposal_b_id = ?) OR (proposal_a_id = ? AND proposal_b_id = ?)) AND status = 'OPEN'`)
      .get(proposalId, f.otherId, f.otherId, proposalId);
    if (existing) {
      persisted.push(existing as Record<string, unknown>);
      continue;
    }
    const conflictId = randomUUID();
    db.prepare(
      `INSERT INTO learning_conflicts (conflict_id, proposal_a_id, proposal_b_id, conflict_type, description, status, created_at) VALUES (?, ?, ?, ?, ?, 'OPEN', ?)`
    ).run(conflictId, proposalId, f.otherId, f.conflictType, f.description, now);
    persisted.push({ conflict_id: conflictId, proposal_a_id: proposalId, proposal_b_id: f.otherId, conflict_type: f.conflictType, description: f.description, status: "OPEN" });
  }

  db.prepare(`UPDATE learning_proposals SET conflict_analysis_json = ?, updated_at = ? WHERE proposal_id = ?`).run(JSON.stringify(persisted), now, proposalId);
  return persisted;
}

export function listOpenConflicts(conn?: DatabaseSync): Array<Record<string, unknown>> {
  return resolveDb(conn).prepare(`SELECT * FROM learning_conflicts WHERE status = 'OPEN' ORDER BY created_at DESC`).all() as unknown as Array<Record<string, unknown>>;
}

export function resolveConflict(conflictId: string, resolution: string, actor: string, conn?: DatabaseSync): Record<string, unknown> {
  const db = resolveDb(conn);
  const conflict = db.prepare(`SELECT * FROM learning_conflicts WHERE conflict_id = ?`).get(conflictId) as Record<string, unknown> | undefined;
  if (!conflict) throw new LearningError(`Conflict ${conflictId} not found`);
  if (!resolution?.trim()) throw new LearningError("A resolution note is required.");
  const now = new Date().toISOString();
  db.prepare(`UPDATE learning_conflicts SET status = 'RESOLVED', resolution = ?, resolved_by = ?, resolved_at = ? WHERE conflict_id = ?`).run(resolution, actor, now, conflictId);
  recordAuditEvent(db, "LEARNING_CONFLICT_RESOLVED", "learning_conflict", conflictId, { resolution }, actor);
  return db.prepare(`SELECT * FROM learning_conflicts WHERE conflict_id = ?`).get(conflictId) as Record<string, unknown>;
}

/** TESTING -> PENDING_APPROVAL. Refuses if the last test run did not pass every example — never submits an untested or failing proposal. */
export function submitForApproval(proposalId: string, actor: string, conn?: DatabaseSync): LearningProposalRecord {
  const db = resolveDb(conn);
  const proposal = getProposal(proposalId, db);
  if (!proposal) throw new LearningError(`Proposal ${proposalId} not found`);
  if (proposal.status !== "TESTING") throw new LearningError(`Only a TESTING proposal may be submitted for approval (current: ${proposal.status})`);

  const testResults = JSON.parse(proposal.test_results_json) as RuleTestSummary | Record<string, never>;
  if (!("allPassed" in testResults) || !testResults.allPassed) {
    throw new LearningError("This proposal has not passed its own tests. Regressions must be fixed and tests re-run before it may be submitted for approval.");
  }

  detectConflicts(proposalId, db);

  const now = new Date().toISOString();
  db.prepare(`UPDATE learning_proposals SET status = 'PENDING_APPROVAL', updated_at = ? WHERE proposal_id = ?`).run(now, proposalId);
  logEvent(db, proposalId, "SUBMITTED_FOR_APPROVAL", "TESTING", "PENDING_APPROVAL", actor);
  recordAuditEvent(db, "LEARNING_PROPOSAL_SUBMITTED", "learning_proposal", proposalId, {}, actor);
  return getProposal(proposalId, db)!;
}

export interface ApproveInput {
  approver: string;
  reason: string;
  confirmGlobal?: boolean; // required (true) when scope_type === 'GLOBAL' — the extra confirmation gate
}

/** PENDING_APPROVAL -> ACTIVE. Requires a named approver + reason, zero OPEN conflicts, and an explicit second confirmation for GLOBAL scope — "GLOBAL must be the hardest level to approve, never promoted silently." */
export function approveAndActivate(proposalId: string, input: ApproveInput, conn?: DatabaseSync): LearningProposalRecord {
  const db = resolveDb(conn);
  const proposal = getProposal(proposalId, db);
  if (!proposal) throw new LearningError(`Proposal ${proposalId} not found`);
  if (proposal.status !== "PENDING_APPROVAL") throw new LearningError(`Only a PENDING_APPROVAL proposal may be activated (current: ${proposal.status})`);
  if (!input.approver?.trim() || !input.reason?.trim()) throw new LearningError("An approver identity and reason are required to activate a rule.");
  if (proposal.scope_type === "GLOBAL" && input.confirmGlobal !== true) {
    throw new LearningError("GLOBAL scope requires an explicit second confirmation (confirmGlobal: true) — a party/entity-specific correction is never silently promoted to GLOBAL.");
  }

  const conflicts = detectConflicts(proposalId, db);
  const openConflicts = conflicts.filter((c) => c.status === "OPEN");
  if (openConflicts.length > 0) {
    throw new LearningError(`Activation blocked: ${openConflicts.length} unresolved conflict(s) with other active rules must be resolved first.`);
  }

  const now = new Date().toISOString();
  // Superseding an older ACTIVE version of the same rule_key: disable it (never mutate/delete it — history is preserved).
  if (proposal.predecessor_version_id) {
    const predecessor = getProposal(proposal.predecessor_version_id, db);
    if (predecessor && predecessor.status === "ACTIVE") {
      db.prepare(`UPDATE learning_proposals SET status = 'DISABLED', disabled_at = ?, disabled_by = ?, disabled_reason = ? WHERE proposal_id = ?`).run(
        now,
        input.approver,
        `Superseded by version ${proposal.version_number} (${proposalId})`,
        predecessor.proposal_id
      );
      logEvent(db, predecessor.proposal_id, "SUPERSEDED", "ACTIVE", "DISABLED", input.approver, `Superseded by ${proposalId}`);
    }
  }

  db.prepare(`UPDATE learning_proposals SET status = 'ACTIVE', approved_by = ?, approved_at = ?, activated_at = ?, updated_at = ? WHERE proposal_id = ?`).run(input.approver, now, now, now, proposalId);
  logEvent(db, proposalId, "ACTIVATED", "PENDING_APPROVAL", "ACTIVE", input.approver, input.reason, { confirmGlobal: input.confirmGlobal ?? false });
  recordAuditEvent(db, "LEARNING_PROPOSAL_ACTIVATED", "learning_proposal", proposalId, { scopeType: proposal.scope_type, reason: input.reason }, input.approver);
  return getProposal(proposalId, db)!;
}

export function rejectProposal(proposalId: string, actor: string, reason: string, conn?: DatabaseSync): LearningProposalRecord {
  const db = resolveDb(conn);
  const proposal = getProposal(proposalId, db);
  if (!proposal) throw new LearningError(`Proposal ${proposalId} not found`);
  if (!["TESTING", "PENDING_APPROVAL"].includes(proposal.status)) throw new LearningError(`Only a TESTING or PENDING_APPROVAL proposal may be rejected (current: ${proposal.status})`);
  if (!reason?.trim()) throw new LearningError("A rejection reason is required.");
  const now = new Date().toISOString();
  db.prepare(`UPDATE learning_proposals SET status = 'REJECTED', updated_at = ? WHERE proposal_id = ?`).run(now, proposalId);
  logEvent(db, proposalId, "REJECTED", proposal.status, "REJECTED", actor, reason);
  recordAuditEvent(db, "LEARNING_PROPOSAL_REJECTED", "learning_proposal", proposalId, { reason }, actor);
  return getProposal(proposalId, db)!;
}

export function disableProposal(proposalId: string, actor: string, reason: string, conn?: DatabaseSync): LearningProposalRecord {
  const db = resolveDb(conn);
  const proposal = getProposal(proposalId, db);
  if (!proposal) throw new LearningError(`Proposal ${proposalId} not found`);
  if (proposal.status !== "ACTIVE") throw new LearningError(`Only an ACTIVE rule may be disabled (current: ${proposal.status})`);
  if (!reason?.trim()) throw new LearningError("A reason is required to disable an active rule.");
  const now = new Date().toISOString();
  db.prepare(`UPDATE learning_proposals SET status = 'DISABLED', disabled_at = ?, disabled_by = ?, disabled_reason = ?, updated_at = ? WHERE proposal_id = ?`).run(now, actor, reason, now, proposalId);
  logEvent(db, proposalId, "DISABLED", "ACTIVE", "DISABLED", actor, reason);
  recordAuditEvent(db, "LEARNING_PROPOSAL_DISABLED", "learning_proposal", proposalId, { reason }, actor);
  return getProposal(proposalId, db)!;
}

export function archiveProposal(proposalId: string, actor: string, conn?: DatabaseSync): LearningProposalRecord {
  const db = resolveDb(conn);
  const proposal = getProposal(proposalId, db);
  if (!proposal) throw new LearningError(`Proposal ${proposalId} not found`);
  if (!["DISABLED", "REJECTED", "EXPIRED"].includes(proposal.status)) throw new LearningError(`Only a DISABLED, REJECTED, or EXPIRED proposal may be archived (current: ${proposal.status})`);
  const now = new Date().toISOString();
  db.prepare(`UPDATE learning_proposals SET status = 'ARCHIVED', updated_at = ? WHERE proposal_id = ?`).run(now, proposalId);
  logEvent(db, proposalId, "ARCHIVED", proposal.status, "ARCHIVED", actor);
  recordAuditEvent(db, "LEARNING_PROPOSAL_ARCHIVED", "learning_proposal", proposalId, {}, actor);
  return getProposal(proposalId, db)!;
}

/**
 * Rolls back to a known historical version: creates a NEW version row
 * (config copied from the target historical version, rollback_of_version_id
 * set) and immediately activates it, disabling whatever is currently ACTIVE
 * for this rule_key. The failed/superseded version is preserved in history
 * — never deleted or rewritten. Past runs/reports that pinned the old
 * version's ID are unaffected (they still reference that immutable row).
 */
export function rollbackToVersion(targetProposalId: string, actor: string, reason: string, conn?: DatabaseSync): LearningProposalRecord {
  const db = resolveDb(conn);
  const target = getProposal(targetProposalId, db);
  if (!target) throw new LearningError(`Proposal ${targetProposalId} not found`);
  if (!reason?.trim()) throw new LearningError("A rollback reason is required.");
  if (!["ACTIVE", "DISABLED"].includes(target.status)) {
    throw new LearningError(`Only a version that was ACTIVE or DISABLED (i.e. previously approved) may be rolled back to (current: ${target.status})`);
  }

  const currentActive = db.prepare(`SELECT * FROM learning_proposals WHERE rule_key = ? AND status = 'ACTIVE'`).get(target.rule_key) as LearningProposalRecord | undefined;

  const now = new Date().toISOString();
  const newVersionNumber = nextVersionNumber(db, target.rule_key);
  const newId = randomUUID();
  db.prepare(
    `INSERT INTO learning_proposals
      (proposal_id, rule_key, version_number, predecessor_version_id, proposal_type, module, workspace_id, scope_type, scope_value_json,
       source_format_scope, effective_from, effective_to, rule_config_json, title, evidence_json, rationale, expected_impact,
       affected_records_estimate, test_results_json, conflict_analysis_json, rollback_of_version_id, expiry_date, review_by_date,
       status, created_by, approved_by, approved_at, activated_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`
  ).run(
    newId,
    target.rule_key,
    newVersionNumber,
    currentActive?.proposal_id ?? target.proposal_id,
    target.proposal_type,
    target.module,
    target.workspace_id,
    target.scope_type,
    target.scope_value_json,
    target.source_format_scope,
    target.effective_from,
    target.effective_to,
    target.rule_config_json,
    `${target.title} (rolled back)`,
    target.evidence_json,
    target.rationale,
    target.expected_impact,
    target.affected_records_estimate,
    target.test_results_json,
    targetProposalId,
    target.expiry_date,
    target.review_by_date,
    actor,
    actor,
    now,
    now,
    now,
    now
  );

  if (currentActive && currentActive.proposal_id !== targetProposalId) {
    db.prepare(`UPDATE learning_proposals SET status = 'DISABLED', disabled_at = ?, disabled_by = ?, disabled_reason = ? WHERE proposal_id = ?`).run(
      now,
      actor,
      `Rolled back to version ${target.version_number} (${targetProposalId}): ${reason}`,
      currentActive.proposal_id
    );
    logEvent(db, currentActive.proposal_id, "SUPERSEDED_BY_ROLLBACK", "ACTIVE", "DISABLED", actor, reason);
  }

  logEvent(db, newId, "ROLLBACK_ACTIVATED", null, "ACTIVE", actor, reason, { rolledBackTo: targetProposalId });
  recordAuditEvent(db, "LEARNING_PROPOSAL_ROLLED_BACK", "learning_proposal", newId, { rolledBackTo: targetProposalId, reason }, actor);

  return getProposal(newId, db)!;
}

/** Lifecycle-only field update (does not touch identity/config — no new version needed). Owner may renew, or let it expire. */
export function renewExpiry(proposalId: string, newExpiryDate: string | null, newReviewByDate: string | null, actor: string, conn?: DatabaseSync): LearningProposalRecord {
  const db = resolveDb(conn);
  const proposal = getProposal(proposalId, db);
  if (!proposal) throw new LearningError(`Proposal ${proposalId} not found`);
  if (!["ACTIVE", "EXPIRED"].includes(proposal.status)) throw new LearningError(`Only an ACTIVE or EXPIRED rule's expiry may be renewed (current: ${proposal.status})`);
  const now = new Date().toISOString();
  const nextStatus: ProposalStatus = proposal.status === "EXPIRED" ? "ACTIVE" : "ACTIVE";
  db.prepare(`UPDATE learning_proposals SET expiry_date = ?, review_by_date = ?, status = ?, updated_at = ? WHERE proposal_id = ?`).run(newExpiryDate, newReviewByDate, nextStatus, now, proposalId);
  logEvent(db, proposalId, "EXPIRY_RENEWED", proposal.status, nextStatus, actor, undefined, { newExpiryDate, newReviewByDate });
  recordAuditEvent(db, "LEARNING_PROPOSAL_EXPIRY_RENEWED", "learning_proposal", proposalId, { newExpiryDate }, actor);
  return getProposal(proposalId, db)!;
}

/** Marks any ACTIVE proposal whose expiry_date has passed as EXPIRED — a system-run check, never a silent continuation. Returns the list of proposals just expired. */
export function checkAndExpireProposals(actor: string = "SYSTEM", conn?: DatabaseSync): LearningProposalRecord[] {
  const db = resolveDb(conn);
  const now = new Date().toISOString();
  const candidates = db.prepare(`SELECT * FROM learning_proposals WHERE status = 'ACTIVE' AND expiry_date IS NOT NULL AND expiry_date < ?`).all(now) as unknown as LearningProposalRecord[];
  for (const p of candidates) {
    db.prepare(`UPDATE learning_proposals SET status = 'EXPIRED', updated_at = ? WHERE proposal_id = ?`).run(now, p.proposal_id);
    logEvent(db, p.proposal_id, "EXPIRED", "ACTIVE", "EXPIRED", actor, "Expiry date passed");
    recordAuditEvent(db, "LEARNING_PROPOSAL_EXPIRED", "learning_proposal", p.proposal_id, { expiryDate: p.expiry_date }, actor);
  }
  return candidates.map((p) => getProposal(p.proposal_id, db)!);
}

export function listProposalEvents(proposalId: string, conn?: DatabaseSync): Array<Record<string, unknown>> {
  return resolveDb(conn).prepare(`SELECT * FROM learning_proposal_events WHERE proposal_id = ? ORDER BY created_at ASC`).all(proposalId) as unknown as Array<Record<string, unknown>>;
}

/** Read-only preview: what would this rule (in its current config) apply to among a caller-supplied sample? Never mutates anything, never touches live matching. */
export function previewImpact(ruleConfigJson: string, sampleInputs: Array<Record<string, unknown>>): { totalSampled: number; wouldApply: number } {
  const config = JSON.parse(ruleConfigJson) as RuleConfig;
  const wouldApply = sampleInputs.filter((input) => evaluateRule(config, input)).length;
  return { totalSampled: sampleInputs.length, wouldApply };
}

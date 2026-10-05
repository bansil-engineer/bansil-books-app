// ============================================================
// Bansil Books Analytics — Deterministic Matching & Human Review
// (Milestone C). DB-facing layer: creates immutable runs over frozen
// source snapshots, invokes the pure matching engine, persists
// candidates, and enforces reviewer decisions with an allocation
// ledger that forbids over-allocation and duplicate consumption.
// No AI call anywhere in this file. Zoho is never touched here.
// ============================================================

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAuditDatabase } from "../db/audit-database.ts";
import { recordAuditEvent } from "./audit-service.ts";
import { runMatchingEngine, type EngineRow, type GroupType } from "./matching/matching-engine.ts";
import { absScaled, formatScaled, parseScaled, tryParseScaled } from "./matching/decimal.ts";
import { isAuditFeatureEffectivelyEnabled } from "./feature-registry.ts";

export const RULE_VERSION = "matching-engine-v1";

function resolveDb(conn?: DatabaseSync): DatabaseSync {
  return conn ?? getAuditDatabase();
}

export class MatchError extends Error {}

// ---------------- Run creation ----------------

export interface RunEdgeInput {
  leftRoleLabel: string;
  rightRoleLabel: string;
  leftSourceVersionId: string;
  rightSourceVersionId: string;
}

export interface CreateRunInput {
  workspaceId: string;
  edges: RunEdgeInput[];
}

/**
 * Feature-control state for the granular matching-subtype toggles
 * (Settings > Feature Controls > Reconciliation & Audit Modules >
 * Matching). Deliberately a plain injected object, NOT read from
 * app_feature_settings inside this file — that table lives in the
 * separate production bansil_books.db, and match-service.ts must stay
 * testable against isolated temp audit databases without ever opening
 * the production DB. API routes read the real settings via
 * app/lib/audit/feature-guard.ts's allAuditSettings() and pass them in;
 * omitting this parameter (as every existing test does) means every
 * matching feature is treated as enabled, preserving prior behavior.
 */
export type AuditFeatureSettings = Record<string, boolean>;

/** Walks the real registry parent chain (module_audit_workspace -> sub_audit_match_review -> audit_feat_*) using the injected settings snapshot. Omitted settings => everything enabled. */
function featureOn(settings: AuditFeatureSettings | undefined, key: string): boolean {
  if (!settings) return true;
  return isAuditFeatureEffectivelyEnabled(key, settings);
}

/** Maps a candidate group (as produced by the pure engine) to the specific matching feature-control key that must be ON for it to be offered as-is. */
function requiredFeatureKeyFor(groupType: GroupType, discrepancySubtype: string | undefined, leftCount: number, rightCount: number): string {
  switch (groupType) {
    case "EXACT":
      return "audit_feat_exact_matching";
    case "PARTIAL":
      return "audit_feat_partial_matching";
    case "GROUPED":
      return rightCount > 1 ? "audit_feat_grouped_one_to_many" : "audit_feat_grouped_many_to_one";
    case "AMBIGUOUS":
      return "audit_feat_ambiguous_review";
    case "UNMATCHED_LEFT":
    case "UNMATCHED_RIGHT":
      return "audit_feat_unmatched_left_right";
    case "DISCREPANCY":
      if (discrepancySubtype === "DATE_MISMATCH" || discrepancySubtype === "REFERENCE_MISMATCH") return "audit_feat_date_reference_checks";
      if (discrepancySubtype === "CURRENCY_MISMATCH" || discrepancySubtype === "AMOUNT_EXCEEDS_ON_ONE_SIDE") return "audit_feat_amount_currency_checks";
      if (discrepancySubtype === "UNIT_MISMATCH") return "audit_feat_quantity_unit_checks";
      return "audit_feat_amount_currency_checks";
  }
}

function assertFrozen(db: DatabaseSync, versionId: string): void {
  const row = db.prepare(`SELECT frozen FROM audit_source_versions WHERE version_id = ?`).get(versionId) as
    | { frozen: number }
    | undefined;
  if (!row) throw new MatchError(`Source version ${versionId} not found`);
  if (!row.frozen) throw new MatchError(`Source version ${versionId} is not frozen — matching requires a frozen, immutable snapshot`);
}

/**
 * Creates a run and immediately generates deterministic CANDIDATE groups
 * for every edge. Every edge's source versions must already be frozen —
 * an in-progress (unfrozen) source can never enter a run. Nothing here
 * calls AI or Zoho; this is the deterministic engine only.
 */
export function createRun(
  input: CreateRunInput,
  actor: string,
  conn?: DatabaseSync,
  featureSettings?: AuditFeatureSettings
): { runId: string } {
  const db = resolveDb(conn);
  const workspace = db.prepare(`SELECT workspace_id FROM audit_workspaces WHERE workspace_id = ?`).get(input.workspaceId);
  if (!workspace) throw new MatchError(`Workspace ${input.workspaceId} not found`);
  if (input.edges.length === 0) throw new MatchError("A run requires at least one comparison edge");
  if (input.edges.length > 1 && !featureOn(featureSettings, "audit_feat_multi_source_verification")) {
    throw new MatchError(
      "Multi-Source Cross Verification is turned OFF in Settings > Feature Controls > Reconciliation & Audit Modules — a run may only have a single comparison edge while this is disabled."
    );
  }

  for (const edge of input.edges) {
    assertFrozen(db, edge.leftSourceVersionId);
    assertFrozen(db, edge.rightSourceVersionId);
  }

  const now = new Date().toISOString();
  const runId = randomUUID();

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO audit_runs (run_id, workspace_id, rule_version, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'CANDIDATES_GENERATED', ?, ?, ?)`
    ).run(runId, input.workspaceId, RULE_VERSION, actor, now, now);

    for (const edge of input.edges) {
      const edgeId = randomUUID();
      db.prepare(
        `INSERT INTO audit_run_edges (edge_id, run_id, left_role_label, right_role_label, left_source_version_id, right_source_version_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(edgeId, runId, edge.leftRoleLabel, edge.rightRoleLabel, edge.leftSourceVersionId, edge.rightSourceVersionId, now);

      generateCandidatesForEdge(db, runId, edgeId, edge.leftSourceVersionId, edge.rightSourceVersionId, now, featureSettings);
    }

    recordAuditEvent(db, "RUN_CREATED", "run", runId, { workspaceId: input.workspaceId, edgeCount: input.edges.length, ruleVersion: RULE_VERSION }, actor);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { runId };
}

function loadEngineRows(db: DatabaseSync, sourceVersionId: string): EngineRow[] {
  const rows = db
    .prepare(`SELECT row_id, normalized_json FROM audit_normalized_rows WHERE source_version_id = ? AND parse_status = 'OK'`)
    .all(sourceVersionId) as Array<{ row_id: string; normalized_json: string }>;
  return rows.map((r) => ({ rowId: r.row_id, normalized: JSON.parse(r.normalized_json) as Record<string, unknown> }));
}

/**
 * Persists the engine's candidates, honoring the per-matching-subtype
 * feature controls. A candidate whose required feature is OFF is never
 * dropped (no data loss) and never silently offered as a different type —
 * it is downgraded to individual UNMATCHED_LEFT/UNMATCHED_RIGHT rows for
 * every member, i.e. "no automatic candidate of this kind is offered",
 * which is the same state those rows would be in if the engine had never
 * found a candidate for them at all.
 */
function generateCandidatesForEdge(
  db: DatabaseSync,
  runId: string,
  edgeId: string,
  leftVersionId: string,
  rightVersionId: string,
  now: string,
  featureSettings?: AuditFeatureSettings
): void {
  const leftRows = loadEngineRows(db, leftVersionId);
  const rightRows = loadEngineRows(db, rightVersionId);
  const candidates = runMatchingEngine(leftRows, rightRows);

  const insertGroup = db.prepare(
    `INSERT INTO audit_match_groups (group_id, run_id, edge_id, group_type, discrepancy_subtype, status, residual_amount, residual_quantity, notes_json, rule_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'CANDIDATE', ?, ?, ?, ?, ?, ?)`
  );
  const insertMember = db.prepare(
    `INSERT INTO audit_match_members (member_id, group_id, row_id, side, allocated_amount, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const insertSingleton = (rowId: string, side: "LEFT" | "RIGHT", note: string) => {
    const groupId = randomUUID();
    const groupType = side === "LEFT" ? "UNMATCHED_LEFT" : "UNMATCHED_RIGHT";
    insertGroup.run(groupId, runId, edgeId, groupType, null, null, null, JSON.stringify([note]), RULE_VERSION, now, now);
    insertMember.run(randomUUID(), groupId, rowId, side, null, now);
  };

  for (const candidate of candidates) {
    const leftCount = candidate.members.filter((m) => m.side === "LEFT").length;
    const rightCount = candidate.members.filter((m) => m.side === "RIGHT").length;
    const requiredKey = requiredFeatureKeyFor(candidate.groupType, candidate.discrepancySubtype, leftCount, rightCount);

    // UNMATCHED_LEFT/RIGHT candidates are always persisted as-is — their
    // own feature control (audit_feat_unmatched_left_right) is enforced by
    // hiding them at READ time in listMatchGroups (never at insertion),
    // since "downgrading" an already-unmatched row to itself is meaningless
    // and would produce a misleading note.
    const alreadyUnmatched = candidate.groupType === "UNMATCHED_LEFT" || candidate.groupType === "UNMATCHED_RIGHT";

    if (!alreadyUnmatched && !featureOn(featureSettings, requiredKey)) {
      for (const member of candidate.members) {
        insertSingleton(
          member.rowId,
          member.side,
          `Downgraded from a ${candidate.groupType}${candidate.discrepancySubtype ? ` (${candidate.discrepancySubtype})` : ""} candidate because "${requiredKey}" is OFF in Settings > Feature Controls.`
        );
      }
      continue;
    }

    const groupId = randomUUID();
    insertGroup.run(
      groupId,
      runId,
      edgeId,
      candidate.groupType,
      candidate.discrepancySubtype ?? null,
      candidate.residualAmount ?? null,
      candidate.residualQuantity ?? null,
      JSON.stringify(candidate.notes),
      RULE_VERSION,
      now,
      now
    );
    for (const member of candidate.members) {
      insertMember.run(randomUUID(), groupId, member.rowId, member.side, member.allocatedAmount, now);
    }
  }
}

// ---------------- Listing / drill-back ----------------

export interface MatchGroupRecord {
  group_id: string;
  run_id: string;
  edge_id: string;
  group_type: string;
  discrepancy_subtype: string | null;
  status: string;
  residual_amount: string | null;
  residual_quantity: string | null;
  notes_json: string;
  rule_version: string;
  created_at: string;
  updated_at: string;
}

export function listRunEdges(runId: string, conn?: DatabaseSync): Record<string, unknown>[] {
  return resolveDb(conn).prepare(`SELECT * FROM audit_run_edges WHERE run_id = ? ORDER BY created_at ASC`).all(runId) as unknown as Record<string, unknown>[];
}

export function listMatchGroups(
  runId: string,
  filter: { groupType?: string; status?: string } = {},
  conn?: DatabaseSync,
  featureSettings?: AuditFeatureSettings
): MatchGroupRecord[] {
  const db = resolveDb(conn);
  const clauses = ["run_id = ?"];
  const params: unknown[] = [runId];
  if (filter.groupType) {
    clauses.push("group_type = ?");
    params.push(filter.groupType);
  }
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  const rows = db
    .prepare(`SELECT * FROM audit_match_groups WHERE ${clauses.join(" AND ")} ORDER BY created_at ASC`)
    .all(...params) as unknown as MatchGroupRecord[];

  // Rows are never deleted when a feature is OFF — only hidden from this
  // listing. Turning the feature back ON makes them visible again with no
  // data change at all.
  if (!featureOn(featureSettings, "audit_feat_unmatched_left_right")) {
    return rows.filter((r) => r.group_type !== "UNMATCHED_LEFT" && r.group_type !== "UNMATCHED_RIGHT");
  }
  return rows;
}

export interface GroupEvidence {
  group: MatchGroupRecord;
  members: Array<{
    member_id: string;
    row_id: string;
    side: string;
    allocated_amount: string | null;
    evidence_locator: string;
    normalized_json: string;
    raw_json: string;
    source_version_id: string;
  }>;
  decisions: Array<Record<string, unknown>>;
}

/** Full evidence drill-back for one candidate — every source row it references, with its own evidence locator and raw/normalized data, plus the decision history. */
export function getGroupEvidence(groupId: string, conn?: DatabaseSync): GroupEvidence {
  const db = resolveDb(conn);
  const group = db.prepare(`SELECT * FROM audit_match_groups WHERE group_id = ?`).get(groupId) as MatchGroupRecord | undefined;
  if (!group) throw new MatchError(`Match group ${groupId} not found`);

  const members = db
    .prepare(
      `SELECT m.member_id, m.row_id, m.side, m.allocated_amount,
              n.evidence_locator, n.normalized_json, n.raw_json, n.source_version_id
       FROM audit_match_members m
       JOIN audit_normalized_rows n ON n.row_id = m.row_id
       WHERE m.group_id = ?
       ORDER BY m.side ASC, m.created_at ASC`
    )
    .all(groupId) as GroupEvidence["members"];

  const decisions = db
    .prepare(`SELECT * FROM audit_match_decisions WHERE group_id = ? ORDER BY decided_at ASC`)
    .all(groupId) as Array<Record<string, unknown>>;

  return { group, members, decisions };
}

// ---------------- Reviewer decisions ----------------

export type Decision = "ACCEPTED" | "REJECTED" | "HELD" | "REVERSED";

const ALLOWED_DECISION_FROM: Record<Decision, string[]> = {
  ACCEPTED: ["CANDIDATE", "HELD"],
  REJECTED: ["CANDIDATE", "HELD"],
  HELD: ["CANDIDATE"],
  REVERSED: ["ACCEPTED"],
};

export class OverAllocationError extends MatchError {}
export class AmbiguousDecisionError extends MatchError {}

/**
 * Sum of allocated_amount across every OTHER currently-ACCEPTED group that
 * references this row WITHIN THE SAME LOGICAL COMPARISON RELATIONSHIP
 * (the same left/right source-version pair — not the same ephemeral
 * edge_id, so re-running matching over the same pair in a new run still
 * correctly detects prior consumption). A row bridging two DIFFERENT
 * relationships (e.g. a vendor statement that is the RIGHT side of a
 * Bill->Statement recognition edge and the LEFT side of a
 * Statement->Payment settlement edge) is being corroborated from two
 * independent angles, not spent twice — that is exactly the "a source
 * document can support several edges without multiplying its economic
 * value" rule. Reporting also never combines these into one grand total
 * (see getRunSummary's per-edge breakdown).
 */
function acceptedConsumptionForRow(db: DatabaseSync, rowId: string, excludeGroupId: string, leftVersionId: string, rightVersionId: string): bigint {
  const rows = db
    .prepare(
      `SELECT m.allocated_amount as amt
       FROM audit_match_members m
       JOIN audit_match_groups g ON g.group_id = m.group_id
       JOIN audit_run_edges e ON e.edge_id = g.edge_id
       WHERE m.row_id = ? AND g.status = 'ACCEPTED' AND g.group_id != ?
         AND e.left_source_version_id = ? AND e.right_source_version_id = ?`
    )
    .all(rowId, excludeGroupId, leftVersionId, rightVersionId) as Array<{ amt: string | null }>;
  let total = BigInt(0);
  for (const r of rows) {
    const v = tryParseScaled(r.amt);
    if (v !== null) total += absScaled(v);
  }
  return total;
}

function rowOwnAmount(db: DatabaseSync, rowId: string): bigint | null {
  const row = db.prepare(`SELECT normalized_json FROM audit_normalized_rows WHERE row_id = ?`).get(rowId) as
    | { normalized_json: string }
    | undefined;
  if (!row) return null;
  const normalized = JSON.parse(row.normalized_json) as Record<string, unknown>;
  const candidates = [normalized.signed_amount, normalized.gross_value, normalized.settled_amount, normalized.debit_raw, normalized.credit_raw];
  for (const c of candidates) {
    if (c === null || c === undefined) continue;
    const parsed = tryParseScaled(String(c));
    if (parsed !== null) return absScaled(parsed);
  }
  return null;
}

/**
 * Records a reviewer decision. ACCEPTED is the only decision that checks
 * and updates the allocation ledger — this is the atomic, over-allocation-
 * and double-consumption-proof step. Runs the check-then-write inside one
 * transaction so a concurrent acceptance of a conflicting group can never
 * both succeed (node:sqlite's single connection already serializes writes;
 * the explicit transaction makes the guarantee structural, not incidental).
 */
export function decideMatchGroup(
  groupId: string,
  decision: Decision,
  reviewer: string,
  reason: string | undefined,
  conn?: DatabaseSync
): MatchGroupRecord {
  const db = resolveDb(conn);
  const group = db.prepare(`SELECT * FROM audit_match_groups WHERE group_id = ?`).get(groupId) as MatchGroupRecord | undefined;
  if (!group) throw new MatchError(`Match group ${groupId} not found`);

  if (!ALLOWED_DECISION_FROM[decision].includes(group.status)) {
    throw new MatchError(`Cannot record ${decision} on a group in status ${group.status}. Allowed from: ${ALLOWED_DECISION_FROM[decision].join(", ")}`);
  }

  if (decision === "ACCEPTED" && (group.group_type === "AMBIGUOUS" || group.group_type === "UNMATCHED_LEFT" || group.group_type === "UNMATCHED_RIGHT")) {
    throw new AmbiguousDecisionError(
      `A ${group.group_type} candidate cannot be ACCEPTED directly — an ambiguous group must first be resolved into a concrete pairing, and an unmatched row has nothing to accept against.`
    );
  }

  const now = new Date().toISOString();
  const edge = db.prepare(`SELECT * FROM audit_run_edges WHERE edge_id = ?`).get(group.edge_id) as {
    left_source_version_id: string;
    right_source_version_id: string;
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    if (decision === "ACCEPTED") {
      const members = db.prepare(`SELECT row_id, allocated_amount FROM audit_match_members WHERE group_id = ?`).all(groupId) as Array<{
        row_id: string;
        allocated_amount: string | null;
      }>;

      for (const member of members) {
        const proposed = tryParseScaled(member.allocated_amount);
        if (proposed === null) continue; // non-amount-bearing member (shouldn't occur for an acceptable group type)
        const already = acceptedConsumptionForRow(db, member.row_id, groupId, edge.left_source_version_id, edge.right_source_version_id);
        const ownAmount = rowOwnAmount(db, member.row_id);
        const newTotal = already + absScaled(proposed);
        if (ownAmount !== null && newTotal > ownAmount) {
          throw new OverAllocationError(
            `Row ${member.row_id} would be over-allocated: already-accepted ${formatScaled(already)} + this group's ${formatScaled(absScaled(proposed))} exceeds the row's own amount ${formatScaled(ownAmount)}.`
          );
        }
      }
    }

    db.prepare(`UPDATE audit_match_groups SET status = ?, updated_at = ? WHERE group_id = ?`).run(decision, now, groupId);

    db.prepare(
      `INSERT INTO audit_match_decisions (decision_id, group_id, decision, reviewer, reason, source_snapshot_json, rule_version, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      groupId,
      decision,
      reviewer,
      reason ?? null,
      JSON.stringify({
        leftSourceVersionId: edge.left_source_version_id,
        rightSourceVersionId: edge.right_source_version_id,
      }),
      group.rule_version,
      now
    );

    recordAuditEvent(db, `MATCH_GROUP_${decision}`, "match_group", groupId, { previousStatus: group.status, reason: reason ?? null }, reviewer);

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return db.prepare(`SELECT * FROM audit_match_groups WHERE group_id = ?`).get(groupId) as unknown as MatchGroupRecord;
}

// ---------------- Run summary ----------------

export interface RunSummary {
  runId: string;
  edgeCount: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  /** Per-edge totals — reported separately, never combined into one grand sum, so a row supporting multiple edges never has its value multiplied. */
  perEdgeAcceptedTotal: Array<{ edgeId: string; leftRole: string; rightRole: string; acceptedGroupCount: number; acceptedAllocatedTotal: string }>;
  /** Distinct rows referenced by any ACCEPTED group across the whole run, counted once each regardless of how many edges they appear in. */
  distinctAcceptedRowCount: number;
}

export function getRunSummary(runId: string, conn?: DatabaseSync): RunSummary {
  const db = resolveDb(conn);
  const run = db.prepare(`SELECT * FROM audit_runs WHERE run_id = ?`).get(runId);
  if (!run) throw new MatchError(`Run ${runId} not found`);

  const edges = listRunEdges(runId, db) as Array<{ edge_id: string; left_role_label: string; right_role_label: string }>;
  const groups = listMatchGroups(runId, {}, db);

  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const g of groups) {
    byType[g.group_type] = (byType[g.group_type] ?? 0) + 1;
    byStatus[g.status] = (byStatus[g.status] ?? 0) + 1;
  }

  const perEdgeAcceptedTotal = edges.map((edge) => {
    const edgeGroups = groups.filter((g) => g.edge_id === edge.edge_id && g.status === "ACCEPTED");
    let total = BigInt(0);
    for (const g of edgeGroups) {
      const members = db.prepare(`SELECT allocated_amount FROM audit_match_members WHERE group_id = ? AND side = 'LEFT'`).all(g.group_id) as Array<{
        allocated_amount: string | null;
      }>;
      for (const m of members) {
        const v = tryParseScaled(m.allocated_amount);
        if (v !== null) total += absScaled(v);
      }
    }
    return {
      edgeId: edge.edge_id,
      leftRole: edge.left_role_label,
      rightRole: edge.right_role_label,
      acceptedGroupCount: edgeGroups.length,
      acceptedAllocatedTotal: formatScaled(total),
    };
  });

  const acceptedGroupIds = groups.filter((g) => g.status === "ACCEPTED").map((g) => g.group_id);
  const distinctRows = new Set<string>();
  if (acceptedGroupIds.length > 0) {
    const placeholders = acceptedGroupIds.map(() => "?").join(",");
    const rows = db.prepare(`SELECT DISTINCT row_id FROM audit_match_members WHERE group_id IN (${placeholders})`).all(...acceptedGroupIds) as Array<{
      row_id: string;
    }>;
    for (const r of rows) distinctRows.add(r.row_id);
  }

  return {
    runId,
    edgeCount: edges.length,
    byType,
    byStatus,
    perEdgeAcceptedTotal,
    distinctAcceptedRowCount: distinctRows.size,
  };
}

export function listRuns(workspaceId: string, conn?: DatabaseSync): Record<string, unknown>[] {
  return resolveDb(conn)
    .prepare(`SELECT * FROM audit_runs WHERE workspace_id = ? ORDER BY created_at DESC`)
    .all(workspaceId) as unknown as Record<string, unknown>[];
}

export { parseScaled };

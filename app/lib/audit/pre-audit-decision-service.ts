// ============================================================
// Bansil Books Analytics — Pre-Audit Module-Level OWNER Decision Service
//
// Implements module-level OWNER sign-off for completed Pre-Audit runs.
// System checkpoint results (PASS/FAIL/BLOCKED/PARTIAL/NOT_IMPLEMENTED)
// are NEVER mutated by an OWNER decision recorded here.
//
// Decision semantics:
//   PENDING                    — no decision yet (default / new run)
//   ACCEPTED                   — only when ALL checkpoints are clean
//   ACCEPTED_WITH_LIMITATIONS  — when BLOCKED/PARTIAL/DATA_INCOMPLETE/
//                                 NOT_IMPLEMENTED evidence exists
//   REJECTED                   — owner rejects the run
//   REVIEW_REQUIRED            — owner flags for further review
//
// Organization isolation:
//   Authorization is against pre_audit_runs.organization_id (authoritative
//   run ownership), NOT against a prior decision row. Decision rows record
//   organization_id as provenance but are never the source of ownership.
//
// Zoho writes: 0. Local SQLite only.
// ============================================================

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAuditDatabase } from "../db/audit-database.ts";
import { getDatabase } from "../db/database.ts";
import { OWNER_ACTOR } from "./owner-auth.ts";

// ── Types ────────────────────────────────────────────────────

export type OwnerDecision =
  | "PENDING"
  | "ACCEPTED"
  | "ACCEPTED_WITH_LIMITATIONS"
  | "REJECTED"
  | "REVIEW_REQUIRED";

const VALID_DECISIONS: OwnerDecision[] = [
  "PENDING",
  "ACCEPTED",
  "ACCEPTED_WITH_LIMITATIONS",
  "REJECTED",
  "REVIEW_REQUIRED",
];

/** Checkpoint result_status values that represent unresolved limitations */
const LIMITATION_STATUSES = new Set([
  "FAIL",
  "BLOCKED",
  "NOT_VERIFIED",
  "PARTIAL",
  "DATA_INCOMPLETE",
  "NOT_IMPLEMENTED",
  "NOT_APPLICABLE",    // used for unimplemented adapters (P&L, Balance Sheet)
  "ERROR",
]);

/** Checkpoint process_status values that represent non-clean state */
const LIMITATION_PROCESS_STATUSES = new Set([
  "BLOCKED",
  "NOT_STARTED",
  "ERROR",
]);

export interface CheckpointLimitation {
  checkpoint_key: string;
  result_status: string;
  process_status: string;
  reason: string | null;
}

export interface CheckpointSummary {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  partial: number;
  not_implemented: number;
  data_incomplete: number;
  error: number;
  other: number;
}

export interface PreAuditRunDecision {
  decision_id: string;
  run_id: string;
  organization_id: string | null;
  decision: OwnerDecision;
  decision_note: string | null;
  limitations_json: string;
  checkpoint_summary_json: string;
  decided_by: string;
  decided_at: string;
  created_at: string;
  updated_at: string;
}

export interface DecisionResult {
  success: boolean;
  decision?: PreAuditRunDecision;
  error?: string;
}

/** Result of strict organization resolution: exactly 1 org → orgId, otherwise error */
export type OrgResolution =
  | { orgId: string }
  | { error: "NO_ORGANIZATION_CONTEXT" | "AMBIGUOUS_ORGANIZATION_CONTEXT" };

// ── Helpers ──────────────────────────────────────────────────

function resolveDb(conn?: DatabaseSync): DatabaseSync {
  return conn ?? getAuditDatabase();
}

/**
 * Strict COUNT-based organization resolver.
 *
 * Returns the single organization_id when exactly one exists in the
 * Books database. Returns a typed error when 0 or >1 organizations
 * exist — no arbitrary LIMIT 1 selection.
 *
 * Single-org invariant:
 *   0 orgs  → { error: "NO_ORGANIZATION_CONTEXT" }
 *   1 org   → { orgId: string }
 *   >1 orgs → { error: "AMBIGUOUS_ORGANIZATION_CONTEXT" }
 *
 * When `mainDb` is supplied, uses that instead of the Books singleton
 * (useful for testing without the Books DB).
 */
export function resolveSingleOrganizationId(mainDb?: DatabaseSync): OrgResolution {
  const db = mainDb ?? getDatabase();
  try {
    const countRow = db.prepare(`SELECT COUNT(*) as c FROM organizations`).get() as { c: number };
    if (countRow.c === 0) {
      return { error: "NO_ORGANIZATION_CONTEXT" };
    }
    if (countRow.c > 1) {
      return { error: "AMBIGUOUS_ORGANIZATION_CONTEXT" };
    }
    // Exactly 1 — safe to SELECT
    const row = db.prepare(`SELECT organization_id FROM organizations LIMIT 1`).get() as
      { organization_id: string };
    return { orgId: row.organization_id };
  } catch {
    return { error: "NO_ORGANIZATION_CONTEXT" };
  }
}

/**
 * Derives current organization_id from the main Books database.
 * Returns null when 0 or >1 organizations exist (delegates to
 * strict COUNT-based resolver, never uses arbitrary LIMIT 1).
 *
 * When `mainDb` is supplied, uses that instead of the Books singleton
 * (useful for testing without the Books DB).
 */
export function getCurrentOrganizationId(mainDb?: DatabaseSync): string | null {
  const resolution = resolveSingleOrganizationId(mainDb);
  if ("error" in resolution) return null;
  return resolution.orgId;
}

/**
 * Verifies the run's organization ownership against the trusted current org.
 *
 * Authorization rules (against run.organization_id, NOT decision row):
 * - If run.organization_id is NULL → legacy unscoped run, reject sign-off
 * - If run.organization_id !== currentOrgId → foreign org, reject
 * - If match → authorized
 *
 * Returns an error string if the check fails, or null if authorized.
 */
function verifyRunOrganization(
  run: { organization_id: string | null },
  currentOrgId: string | null
): string | null {
  if (!currentOrgId) {
    // No org context available — cannot authorize
    return null;
  }
  if (!run.organization_id) {
    return "Run organization is unresolved. Legacy run cannot be signed off until ownership is established.";
  }
  if (run.organization_id !== currentOrgId) {
    return "Run does not belong to the current organization.";
  }
  return null;
}

/**
 * Backfills legacy pre_audit_runs that have NULL organization_id.
 *
 * Strict single-org rule: when trustedOrgId is NOT provided, uses the
 * COUNT-based resolver — backfill proceeds ONLY when exactly one
 * organization exists. With 0 or >1 organizations, backfill is skipped
 * with a specific reason (no arbitrary LIMIT 1 selection).
 *
 * When trustedOrgId IS provided (test injection / explicit context),
 * that value is used directly — the Books DB is not consulted.
 *
 * Idempotent — safe to call multiple times.
 * Only updates runs with organization_id IS NULL — never overwrites
 * existing non-NULL organization ownership.
 */
export function backfillLegacyRunOrganization(
  conn?: DatabaseSync,
  trustedOrgId?: string
): { backfilled: number; skippedReason?: string } {
  const db = resolveDb(conn);

  // Resolve org: explicit trustedOrgId or strict COUNT-based resolver
  let orgId: string | null;
  if (trustedOrgId !== undefined) {
    // Explicit context (test injection or known single-org)
    orgId = trustedOrgId || null; // empty string → null → skip
  } else {
    // Strict resolution: only backfill when exactly 1 org exists
    const resolution = resolveSingleOrganizationId();
    if ("error" in resolution) {
      const reason = resolution.error === "AMBIGUOUS_ORGANIZATION_CONTEXT"
        ? "Multiple organizations exist. Cannot safely assign legacy runs without explicit context."
        : "No organization context available.";
      return { backfilled: 0, skippedReason: reason };
    }
    orgId = resolution.orgId;
  }

  if (!orgId) {
    return { backfilled: 0, skippedReason: "No organization context available." };
  }

  // Count NULL-org runs
  const nullCount = (
    db.prepare(`SELECT COUNT(*) as c FROM pre_audit_runs WHERE organization_id IS NULL`).get() as { c: number }
  ).c;

  if (nullCount === 0) {
    return { backfilled: 0 };
  }

  // Single-org verified (or explicit trustedOrgId): safe to backfill
  db.prepare(`UPDATE pre_audit_runs SET organization_id = ? WHERE organization_id IS NULL`).run(orgId);
  return { backfilled: nullCount };
}

/**
 * Server-side derivation of limitations from actual checkpoint results.
 * Never trusts client-supplied limitations.
 */
export function deriveCheckpointLimitations(
  runId: string,
  conn?: DatabaseSync
): CheckpointLimitation[] {
  const db = resolveDb(conn);
  const rows = db
    .prepare(
      `SELECT checkpoint_key, result_status, process_status, blocked_reason, limitation
       FROM pre_audit_checkpoint_results
       WHERE run_id = ?
       ORDER BY started_at ASC`
    )
    .all(runId) as Array<{
    checkpoint_key: string;
    result_status: string;
    process_status: string;
    blocked_reason: string | null;
    limitation: string | null;
  }>;

  const limitations: CheckpointLimitation[] = [];
  for (const r of rows) {
    const hasLimitationStatus = LIMITATION_STATUSES.has(r.result_status);
    const hasLimitationProcess = LIMITATION_PROCESS_STATUSES.has(r.process_status);
    if (hasLimitationStatus || hasLimitationProcess) {
      limitations.push({
        checkpoint_key: r.checkpoint_key,
        result_status: r.result_status,
        process_status: r.process_status,
        reason: r.blocked_reason || r.limitation || null,
      });
    }
  }
  return limitations;
}

/**
 * Server-side derivation of checkpoint summary counts.
 */
export function deriveCheckpointSummary(
  runId: string,
  conn?: DatabaseSync
): CheckpointSummary {
  const db = resolveDb(conn);
  const rows = db
    .prepare(
      `SELECT result_status, process_status FROM pre_audit_checkpoint_results WHERE run_id = ?`
    )
    .all(runId) as Array<{ result_status: string; process_status: string }>;

  const summary: CheckpointSummary = {
    total: rows.length,
    passed: 0,
    failed: 0,
    blocked: 0,
    partial: 0,
    not_implemented: 0,
    data_incomplete: 0,
    error: 0,
    other: 0,
  };

  for (const r of rows) {
    const rs = r.result_status;
    const ps = r.process_status;

    if (rs === "PASS") {
      summary.passed++;
    } else if (rs === "FAIL") {
      summary.failed++;
    } else if (rs === "PARTIAL") {
      summary.partial++;
    } else if (ps === "BLOCKED" || rs === "NOT_VERIFIED" || rs === "BLOCKED") {
      summary.blocked++;
    } else if (ps === "NOT_STARTED" || rs === "NOT_APPLICABLE" || rs === "NOT_IMPLEMENTED") {
      summary.not_implemented++;
    } else if (rs === "DATA_INCOMPLETE") {
      summary.data_incomplete++;
    } else if (ps === "ERROR" || rs === "ERROR") {
      summary.error++;
    } else {
      summary.other++;
    }
  }

  return summary;
}

/**
 * Returns true when unresolved limitations exist that should
 * block a plain ACCEPTED decision.
 */
export function hasUnresolvedLimitations(
  runId: string,
  conn?: DatabaseSync
): boolean {
  return deriveCheckpointLimitations(runId, conn).length > 0;
}

// ── Core API ─────────────────────────────────────────────────

/**
 * Retrieves the OWNER decision for a specific Pre-Audit run.
 * Returns null when no decision has been recorded yet, or when
 * the run does not belong to the current organization.
 *
 * Authorization: checks run.organization_id (authoritative).
 */
export function getRunDecision(
  runId: string,
  conn?: DatabaseSync,
  trustedOrgId?: string
): PreAuditRunDecision | null {
  const db = resolveDb(conn);

  // Load run to check authoritative organization ownership
  let run = db
    .prepare(`SELECT organization_id FROM pre_audit_runs WHERE run_id = ?`)
    .get(runId) as { organization_id: string | null } | undefined;
  if (!run) return null;

  // Lazy backfill: if run has NULL org, attempt safe single-org backfill
  if (run.organization_id === null) {
    backfillLegacyRunOrganization(db, trustedOrgId);
    run = db
      .prepare(`SELECT organization_id FROM pre_audit_runs WHERE run_id = ?`)
      .get(runId) as { organization_id: string | null } | undefined;
    if (!run) return null;
  }

  // Organization isolation against run.organization_id
  const currentOrgId = trustedOrgId ?? getCurrentOrganizationId();
  if (currentOrgId) {
    if (!run.organization_id) return null; // Legacy unscoped
    if (run.organization_id !== currentOrgId) return null; // Foreign org
  }

  const row = db
    .prepare(`SELECT * FROM pre_audit_run_decisions WHERE run_id = ?`)
    .get(runId) as PreAuditRunDecision | undefined;
  return row ?? null;
}

/**
 * Retrieves the most recent ACCEPTED or ACCEPTED_WITH_LIMITATIONS
 * decision across all runs for the current organization.
 *
 * Scoped through authoritative run.organization_id (JOIN), not
 * decision.organization_id alone.
 */
export function getLastAcceptedDecision(
  conn?: DatabaseSync,
  trustedOrgId?: string
): PreAuditRunDecision | null {
  const db = resolveDb(conn);
  const currentOrgId = trustedOrgId ?? getCurrentOrganizationId();

  if (currentOrgId) {
    // Scoped through run.organization_id (authoritative)
    const row = db
      .prepare(
        `SELECT d.* FROM pre_audit_run_decisions d
         JOIN pre_audit_runs r ON d.run_id = r.run_id
         WHERE d.decision IN ('ACCEPTED', 'ACCEPTED_WITH_LIMITATIONS')
           AND r.organization_id = ?
         ORDER BY d.decided_at DESC
         LIMIT 1`
      )
      .get(currentOrgId) as PreAuditRunDecision | undefined;
    return row ?? null;
  }

  // Fallback: no org context available
  const row = db
    .prepare(
      `SELECT d.* FROM pre_audit_run_decisions d
       JOIN pre_audit_runs r ON d.run_id = r.run_id
       WHERE d.decision IN ('ACCEPTED', 'ACCEPTED_WITH_LIMITATIONS')
       ORDER BY d.decided_at DESC
       LIMIT 1`
    )
    .get() as PreAuditRunDecision | undefined;
  return row ?? null;
}

/**
 * Records or updates the OWNER module-level decision for a completed
 * Pre-Audit run.
 *
 * Validation (all server-side):
 * 1. run_id must exist
 * 2. run must belong to the current organization (via run.organization_id)
 * 3. legacy unscoped runs cannot be signed off
 * 4. decision must be a valid enum
 * 5. plain ACCEPTED is rejected when unresolved limitations exist
 * 6. ACCEPTED_WITH_LIMITATIONS requires at least one limitation to exist
 * 7. limitations are derived server-side (client supply ignored)
 * 8. decision does NOT mutate checkpoint statuses
 * 9. decision.organization_id must equal run.organization_id
 */
export function saveRunDecision(
  runId: string,
  decision: string,
  note: string | null,
  conn?: DatabaseSync,
  trustedOrgId?: string
): DecisionResult {
  const db = resolveDb(conn);

  // 1. Validate run exists
  let run = db
    .prepare(`SELECT * FROM pre_audit_runs WHERE run_id = ?`)
    .get(runId) as { run_id: string; organization_id: string | null; process_status: string } | undefined;
  if (!run) {
    return { success: false, error: "Run not found: " + runId };
  }

  // 1b. Lazy backfill: if run has NULL org, attempt safe single-org backfill
  if (run.organization_id === null) {
    backfillLegacyRunOrganization(db, trustedOrgId);
    run = db
      .prepare(`SELECT * FROM pre_audit_runs WHERE run_id = ?`)
      .get(runId) as { run_id: string; organization_id: string | null; process_status: string } | undefined;
    if (!run) {
      return { success: false, error: "Run not found: " + runId };
    }
  }

  // 2. Organization authorization against run.organization_id (authoritative)
  const currentOrgId = trustedOrgId ?? getCurrentOrganizationId();
  const orgError = verifyRunOrganization(run, currentOrgId);
  if (orgError) {
    return { success: false, error: orgError };
  }

  // 2b. If decision already exists, verify consistency:
  // decision.organization_id must match run.organization_id
  const existingDecision = db
    .prepare(`SELECT organization_id FROM pre_audit_run_decisions WHERE run_id = ?`)
    .get(runId) as { organization_id: string | null } | undefined;
  if (
    existingDecision &&
    existingDecision.organization_id &&
    run.organization_id &&
    existingDecision.organization_id !== run.organization_id
  ) {
    return {
      success: false,
      error: "Decision organization does not match run organization. Data integrity issue.",
    };
  }

  // 3. Validate decision enum
  if (!VALID_DECISIONS.includes(decision as OwnerDecision)) {
    return { success: false, error: "Invalid decision: " + decision };
  }

  // Server-side derive limitations and summary
  const limitations = deriveCheckpointLimitations(runId, db);
  const summary = deriveCheckpointSummary(runId, db);
  const hasLimitations = limitations.length > 0;

  // 4. Plain ACCEPTED blocked when limitations exist
  if (decision === "ACCEPTED" && hasLimitations) {
    return {
      success: false,
      error:
        "Plain ACCEPTED is not allowed when unresolved limitations exist. " +
        "Use ACCEPTED_WITH_LIMITATIONS instead. " +
        `${limitations.length} limitation(s) found.`,
    };
  }

  // 5. ACCEPTED_WITH_LIMITATIONS requires limitations to exist
  if (decision === "ACCEPTED_WITH_LIMITATIONS" && !hasLimitations) {
    return {
      success: false,
      error:
        "ACCEPTED_WITH_LIMITATIONS requires at least one limitation to exist. " +
        "All checkpoints are clean — use plain ACCEPTED.",
    };
  }

  const now = new Date().toISOString();
  const decisionId = randomUUID();
  const decidedBy = OWNER_ACTOR;

  // decision.organization_id = run.organization_id (authoritative source)
  const decisionOrgId = run.organization_id;

  // Check if a decision already exists for this run — update if so, insert if not
  if (existingDecision) {
    db.prepare(
      `UPDATE pre_audit_run_decisions SET
        decision = ?,
        decision_note = ?,
        limitations_json = ?,
        checkpoint_summary_json = ?,
        decided_by = ?,
        decided_at = ?,
        updated_at = ?
      WHERE run_id = ?`
    ).run(
      decision,
      note || null,
      JSON.stringify(limitations),
      JSON.stringify(summary),
      decidedBy,
      now,
      now,
      runId
    );
  } else {
    db.prepare(
      `INSERT INTO pre_audit_run_decisions (
        decision_id, run_id, organization_id, decision, decision_note,
        limitations_json, checkpoint_summary_json, decided_by, decided_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      decisionId,
      runId,
      decisionOrgId,
      decision,
      note || null,
      JSON.stringify(limitations),
      JSON.stringify(summary),
      decidedBy,
      now,
      now,
      now
    );
  }

  // Re-read the saved decision to return
  const saved = getRunDecision(runId, db, trustedOrgId);
  return { success: true, decision: saved! };
}

/**
 * Returns a combined view of the current run's decision state plus
 * the last accepted baseline (if any), suitable for the UI.
 *
 * Authorization: checks run.organization_id (authoritative).
 * Returns error field when the run is not authorized.
 */
export function getDecisionOverview(
  runId: string,
  conn?: DatabaseSync,
  trustedOrgId?: string
): {
  currentDecision: PreAuditRunDecision | null;
  lastAcceptedDecision: PreAuditRunDecision | null;
  limitations: CheckpointLimitation[];
  summary: CheckpointSummary;
  hasLimitations: boolean;
  isCurrentRunSuperseded: boolean;
  error?: string;
} {
  const db = resolveDb(conn);

  // Load run for authoritative organization check
  let run = db
    .prepare(`SELECT organization_id FROM pre_audit_runs WHERE run_id = ?`)
    .get(runId) as { organization_id: string | null } | undefined;

  const emptySummary: CheckpointSummary = {
    total: 0, passed: 0, failed: 0, blocked: 0, partial: 0,
    not_implemented: 0, data_incomplete: 0, error: 0, other: 0,
  };

  if (!run) {
    return {
      currentDecision: null,
      lastAcceptedDecision: null,
      limitations: [],
      summary: emptySummary,
      hasLimitations: false,
      isCurrentRunSuperseded: false,
      error: "Run not found.",
    };
  }

  // Lazy backfill: if run has NULL org, attempt safe single-org backfill
  if (run.organization_id === null) {
    backfillLegacyRunOrganization(db, trustedOrgId);
    run = db
      .prepare(`SELECT organization_id FROM pre_audit_runs WHERE run_id = ?`)
      .get(runId) as { organization_id: string | null } | undefined;
    if (!run) {
      return {
        currentDecision: null,
        lastAcceptedDecision: null,
        limitations: [],
        summary: emptySummary,
        hasLimitations: false,
        isCurrentRunSuperseded: false,
        error: "Run not found.",
      };
    }
  }

  // Organization isolation against run.organization_id
  const currentOrgId = trustedOrgId ?? getCurrentOrganizationId();
  const orgError = verifyRunOrganization(run, currentOrgId);
  if (orgError) {
    return {
      currentDecision: null,
      lastAcceptedDecision: null,
      limitations: [],
      summary: emptySummary,
      hasLimitations: false,
      isCurrentRunSuperseded: false,
      error: orgError,
    };
  }

  const currentDecision = getRunDecision(runId, db, trustedOrgId);
  const lastAccepted = getLastAcceptedDecision(db, trustedOrgId);
  const limitations = deriveCheckpointLimitations(runId, db);
  const summary = deriveCheckpointSummary(runId, db);

  // Determine if the current run's accepted decision has been superseded
  // by a newer run existing
  let isCurrentRunSuperseded = false;
  if (
    currentDecision &&
    (currentDecision.decision === "ACCEPTED" ||
      currentDecision.decision === "ACCEPTED_WITH_LIMITATIONS")
  ) {
    const newerRun = db
      .prepare(
        `SELECT run_id FROM pre_audit_runs
         WHERE started_at > (SELECT started_at FROM pre_audit_runs WHERE run_id = ?)
         ORDER BY started_at ASC LIMIT 1`
      )
      .get(runId) as { run_id: string } | undefined;
    isCurrentRunSuperseded = Boolean(newerRun);
  }

  return {
    currentDecision,
    lastAcceptedDecision: lastAccepted,
    limitations,
    summary,
    hasLimitations: limitations.length > 0,
    isCurrentRunSuperseded,
  };
}

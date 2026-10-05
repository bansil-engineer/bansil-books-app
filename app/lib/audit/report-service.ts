// ============================================================
// Bansil Books Analytics — Internal Review Report Snapshots (Milestone D)
// A report is a full immutable JSON snapshot taken at generation time —
// never re-read from live state afterward. Regenerating creates a NEW
// row (report_version increments); a past report is never edited.
// This app produces an INTERNAL REVIEW WORKING PAPER, never a statutory
// audit opinion — status values are DRAFT/UNDER_REVIEW/REVIEWED/
// ISSUED_INTERNAL/SUPERSEDED, never CERTIFIED/AUDITED/CA SIGNED.
// ============================================================

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAuditDatabase } from "../db/audit-database.ts";
import { recordAuditEvent } from "./audit-service.ts";
import { tryParseScaled, absScaled, formatScaled } from "./matching/decimal.ts";
import { getCoverageMatrix } from "./domain-review-service.ts";
import { listFindings } from "./findings-service.ts";
import { listActionsByWorkspace } from "./action-service.ts";
import { listReviewerDecisions } from "./findings-service.ts";
import { buildSourceRegister } from "./export/source-register.ts";

function resolveDb(conn?: DatabaseSync): DatabaseSync {
  return conn ?? getAuditDatabase();
}

export class ReportError extends Error {}

export const REPORT_STATUSES = ["DRAFT", "UNDER_REVIEW", "REVIEWED", "ISSUED_INTERNAL", "SUPERSEDED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface ReportRecord {
  report_id: string;
  workspace_id: string;
  run_id: string | null;
  report_version: number;
  entity_name: string | null;
  period_from: string | null;
  period_to: string | null;
  purpose: string | null;
  comparison_modes_json: string;
  scope_json: string;
  source_register_json: string;
  domain_coverage_json: string;
  matching_summary_json: string;
  findings_snapshot_json: string;
  actions_snapshot_json: string;
  reviewer_decisions_json: string;
  assumptions: string | null;
  limitations: string | null;
  exclusions: string | null;
  not_tested_domains_json: string;
  status: ReportStatus;
  generated_at: string;
  created_by: string;
}

export interface GenerateReportInput {
  workspaceId: string;
  runId?: string;
  entityName?: string;
  periodFrom?: string;
  periodTo?: string;
  purpose?: string;
  comparisonModes?: string[];
  assumptions?: string;
  limitations?: string;
  exclusions?: string;
}

interface MatchGroupRow {
  group_id: string;
  group_type: string;
  status: string;
  residual_amount: string | null;
}

/**
 * Builds the matching summary from a run's accepted/held match groups,
 * including a per-type row (count/allocated/residual/absolute residual)
 * consumed by the Matching Summary table's field/column selector. Never
 * forces totals to reconcile — exposes net difference AND absolute
 * residual separately so offsetting errors are never hidden.
 */
function buildMatchingSummary(db: DatabaseSync, runId: string | undefined): Record<string, unknown> {
  if (!runId) {
    return { note: "No run bound to this report — matching summary not applicable.", byType: {}, rows: [], netDifference: "0", absoluteResidual: "0" };
  }
  const groups = db.prepare(`SELECT group_id, group_type, status, residual_amount FROM audit_match_groups WHERE run_id = ?`).all(runId) as unknown as MatchGroupRow[];

  const byType: Record<string, { count: number; allocatedScaled: bigint; residualScaled: bigint; absoluteResidualScaled: bigint }> = {};
  let netDifferenceScaled = BigInt(0);
  let absoluteResidualScaled = BigInt(0);
  let unresolvedItemCount = 0;
  let ambiguousItemCount = 0;
  let blockedExceptionCount = 0;

  // LEFT-side allocation only (matches the convention already established in
  // match-service.ts's getRunSummary/perEdgeAcceptedTotal) — a group's RIGHT
  // side allocation mirrors the same settled amount, so summing both sides
  // would double-count the same match.
  const allocatedRows = db
    .prepare(`SELECT m.group_id as group_id, m.allocated_amount as allocated_amount FROM audit_match_groups g JOIN audit_match_members m ON m.group_id = g.group_id WHERE g.run_id = ? AND m.side = 'LEFT'`)
    .all(runId) as Array<{ group_id: string; allocated_amount: string | null }>;
  const allocatedMap = new Map<string, bigint>();
  for (const row of allocatedRows) {
    const v = tryParseScaled(row.allocated_amount);
    if (v === null) continue;
    allocatedMap.set(row.group_id, (allocatedMap.get(row.group_id) ?? BigInt(0)) + absScaled(v));
  }

  for (const g of groups) {
    const bucket = byType[g.group_type] ?? { count: 0, allocatedScaled: BigInt(0), residualScaled: BigInt(0), absoluteResidualScaled: BigInt(0) };
    bucket.count += 1;

    const allocated = allocatedMap.get(g.group_id);
    if (allocated !== undefined) bucket.allocatedScaled += allocated;

    if (g.group_type === "AMBIGUOUS") ambiguousItemCount += 1;
    if (g.group_type === "UNMATCHED_LEFT" || g.group_type === "UNMATCHED_RIGHT" || g.group_type === "DISCREPANCY") unresolvedItemCount += 1;

    const residual = tryParseScaled(g.residual_amount);
    if (residual !== null) {
      bucket.residualScaled += residual;
      bucket.absoluteResidualScaled += absScaled(residual);
      netDifferenceScaled += residual;
      absoluteResidualScaled += absScaled(residual);
    }
    byType[g.group_type] = bucket;
  }
  const netDifference = formatScaled(netDifferenceScaled);
  const absoluteResidual = formatScaled(absoluteResidualScaled);

  const rows = Object.entries(byType).map(([matchType, b]) => ({
    match_type: matchType,
    count: b.count,
    allocated_amount: formatScaled(b.allocatedScaled),
    residual: formatScaled(b.residualScaled),
    absolute_residual: formatScaled(b.absoluteResidualScaled),
  }));

  const parseExceptions = db.prepare(
    `SELECT COALESCE(SUM(cc.exception_count), 0) as c FROM audit_completeness_checks cc
     JOIN audit_run_edges e ON e.left_source_version_id = cc.source_version_id OR e.right_source_version_id = cc.source_version_id
     WHERE e.run_id = ?`
  ).get(runId) as { c: number } | undefined;
  blockedExceptionCount = parseExceptions?.c ?? 0;

  return {
    byType: Object.fromEntries(Object.entries(byType).map(([k, b]) => [k, { count: b.count }])),
    rows,
    unresolvedItemCount,
    ambiguousItemCount,
    blockedExceptionCount,
    netDifference,
    absoluteResidual,
    note: "netDifference is the signed sum of residuals; absoluteResidual sums magnitudes so offsetting errors are never hidden. Neither is forced toward zero.",
  };
}

/**
 * Generates a new immutable report version from the CURRENT state of
 * domain reviews, findings, actions, and reviewer decisions. Does not
 * rerun matching/AI/Zoho/file parsing — reads only already-persisted
 * rows and freezes them into one JSON snapshot per section.
 */
export function generateReport(input: GenerateReportInput, actor: string, conn?: DatabaseSync): ReportRecord {
  const db = resolveDb(conn);
  const workspace = db.prepare(`SELECT workspace_id FROM audit_workspaces WHERE workspace_id = ?`).get(input.workspaceId);
  if (!workspace) throw new ReportError(`Workspace ${input.workspaceId} not found`);

  const coverage = getCoverageMatrix(input.workspaceId, db);
  const findings = listFindings(input.workspaceId, {}, db);
  const actions = listActionsByWorkspace(input.workspaceId, db);
  const findingDecisions = findings.flatMap((f) => listReviewerDecisions("finding", f.finding_id, db));

  const notTestedDomains = coverage.filter((c) => c.status === "NOT_TESTED" || c.status === "NOT_AVAILABLE" || c.status === "BLOCKED").map((c) => c.domain);

  const matchingSummary = buildMatchingSummary(db, input.runId);
  const sourceRegister = buildSourceRegister(db, input.workspaceId, input.runId);

  const maxVersionRow = db.prepare(`SELECT MAX(report_version) as maxv FROM audit_reports WHERE workspace_id = ?`).get(input.workspaceId) as { maxv: number | null } | undefined;
  const nextVersion = (maxVersionRow?.maxv ?? 0) + 1;

  const now = new Date().toISOString();
  const reportId = randomUUID();

  db.prepare(
    `INSERT INTO audit_reports
      (report_id, workspace_id, run_id, report_version, entity_name, period_from, period_to, purpose,
       comparison_modes_json, scope_json, source_register_json, domain_coverage_json, matching_summary_json,
       findings_snapshot_json, actions_snapshot_json, reviewer_decisions_json, assumptions, limitations, exclusions,
       not_tested_domains_json, status, generated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`
  ).run(
    reportId,
    input.workspaceId,
    input.runId ?? null,
    nextVersion,
    input.entityName ?? null,
    input.periodFrom ?? null,
    input.periodTo ?? null,
    input.purpose ?? "Internal review working paper — not a statutory audit opinion.",
    JSON.stringify(input.comparisonModes ?? []),
    JSON.stringify({ workspaceId: input.workspaceId, runId: input.runId ?? null }),
    JSON.stringify(sourceRegister),
    JSON.stringify(coverage),
    JSON.stringify(matchingSummary),
    JSON.stringify(findings),
    JSON.stringify(actions),
    JSON.stringify(findingDecisions),
    input.assumptions ?? null,
    input.limitations ?? "Coverage is limited to sources explicitly frozen and reviewed in this workspace. Domains without approved source coverage are marked NOT_AVAILABLE.",
    input.exclusions ?? null,
    JSON.stringify(notTestedDomains),
    now,
    actor
  );

  recordAuditEvent(db, "REPORT_GENERATED", "report", reportId, { workspaceId: input.workspaceId, reportVersion: nextVersion }, actor);

  return getReport(reportId, db)!;
}

export function getReport(reportId: string, conn?: DatabaseSync): ReportRecord | null {
  const row = resolveDb(conn).prepare(`SELECT * FROM audit_reports WHERE report_id = ?`).get(reportId);
  return (row as unknown as ReportRecord) ?? null;
}

export function listReports(workspaceId: string, conn?: DatabaseSync): ReportRecord[] {
  return resolveDb(conn).prepare(`SELECT * FROM audit_reports WHERE workspace_id = ? ORDER BY report_version DESC`).all(workspaceId) as unknown as ReportRecord[];
}

export function getLatestReport(workspaceId: string, conn?: DatabaseSync): ReportRecord | null {
  const rows = listReports(workspaceId, conn);
  return rows[0] ?? null;
}

/**
 * Lifecycle transitions only — never touches any snapshot column.
 * Valid targets: UNDER_REVIEW, REVIEWED, ISSUED_INTERNAL, SUPERSEDED.
 * Never CERTIFIED/AUDITED/CA SIGNED — this app cannot perform that role.
 */
export function setReportStatus(reportId: string, status: ReportStatus, reviewer: string, comment: string | undefined, conn?: DatabaseSync): ReportRecord {
  const db = resolveDb(conn);
  const report = getReport(reportId, db);
  if (!report) throw new ReportError(`Report ${reportId} not found`);
  if (!REPORT_STATUSES.includes(status)) throw new ReportError(`Invalid report status: ${status}`);

  db.prepare(`UPDATE audit_reports SET status = ? WHERE report_id = ?`).run(status, reportId);
  db.prepare(
    `INSERT INTO audit_reviewer_decisions (decision_id, entity_type, entity_id, reviewer, role_context, decision, comment, source_run_version_json, created_at)
     VALUES (?, 'report', ?, ?, 'status', ?, ?, '{}', ?)`
  ).run(randomUUID(), reportId, reviewer, status, comment ?? null, new Date().toISOString());
  recordAuditEvent(db, "REPORT_STATUS_CHANGED", "report", reportId, { previous: report.status, next: status }, reviewer);

  return getReport(reportId, db)!;
}

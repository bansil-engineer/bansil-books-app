// ============================================================
// Bansil Books Analytics — Domain Review & Coverage (Milestone D)
// A domain is only REVIEWED when explicitly recorded so by a reviewer
// with proven coverage (source snapshots, tests performed, matched vs
// unresolved amounts) — never inferred from "no mismatch was found".
// ============================================================

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAuditDatabase } from "../db/audit-database.ts";
import { recordAuditEvent } from "./audit-service.ts";

function resolveDb(conn?: DatabaseSync): DatabaseSync {
  return conn ?? getAuditDatabase();
}

export class DomainReviewError extends Error {}

export const REVIEW_DOMAINS = [
  "BANK_CASH",
  "RECEIVABLES",
  "PAYABLES",
  "PURCHASE_CHAIN",
  "SALES_CHAIN",
  "MATERIAL_STOCK",
  "TRIAL_BALANCE",
  "OVERALL_SUMMARY",
  // Explicitly out-of-scope unless approved source coverage/policy exists —
  // registered here only so the UI can render them as NOT_AVAILABLE/BLOCKED,
  // never silently omitted or claimed as reviewed.
  "TAX",
  "PAYROLL",
  "FIXED_ASSETS",
  "LOANS",
  "STATUTORY_LEGAL",
] as const;
export type ReviewDomain = (typeof REVIEW_DOMAINS)[number];

export const DOMAIN_STATUSES = ["REVIEWED", "PARTIAL", "BLOCKED", "EXCLUDED", "NOT_TESTED", "NOT_AVAILABLE"] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

/** Domains with no currently-approved source coverage in this milestone — always NOT_AVAILABLE regardless of reviewer input, never silently promoted. */
const STRUCTURALLY_NOT_AVAILABLE: ReviewDomain[] = ["TAX", "PAYROLL", "FIXED_ASSETS", "LOANS", "STATUTORY_LEGAL"];

export interface DomainReviewRecord {
  review_id: string;
  workspace_id: string;
  run_id: string | null;
  domain: ReviewDomain;
  entity_name: string | null;
  period_from: string | null;
  period_to: string | null;
  source_snapshot_ids_json: string;
  source_coverage_note: string | null;
  tests_performed_json: string;
  matched_amount: string | null;
  matched_count: number | null;
  unresolved_amount: string | null;
  unresolved_count: number | null;
  exception_count: number | null;
  limitations: string | null;
  status: DomainStatus;
  reviewer: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface RecordDomainReviewInput {
  workspaceId: string;
  runId?: string;
  domain: ReviewDomain;
  entityName?: string;
  periodFrom?: string;
  periodTo?: string;
  sourceSnapshotIds?: string[];
  sourceCoverageNote?: string;
  testsPerformed?: string[];
  matchedAmount?: string;
  matchedCount?: number;
  unresolvedAmount?: string;
  unresolvedCount?: number;
  exceptionCount?: number;
  limitations?: string;
  status: DomainStatus;
}

/**
 * Records (or updates) a domain's coverage proof. A REVIEWED status
 * without any source_snapshot_ids or tests_performed is refused — this
 * is the "coverage must be proven, not assumed" rule.
 */
export function recordDomainReview(input: RecordDomainReviewInput, actor: string, conn?: DatabaseSync): DomainReviewRecord {
  const db = resolveDb(conn);
  if (!REVIEW_DOMAINS.includes(input.domain)) {
    throw new DomainReviewError(`Unknown review domain: ${input.domain}`);
  }

  const status = input.status;
  if (STRUCTURALLY_NOT_AVAILABLE.includes(input.domain) && status !== "NOT_AVAILABLE" && status !== "NOT_TESTED" && status !== "BLOCKED") {
    throw new DomainReviewError(
      `Domain "${input.domain}" has no approved source coverage in this milestone — it may only be recorded as NOT_AVAILABLE, NOT_TESTED, or BLOCKED, never REVIEWED/PARTIAL/EXCLUDED.`
    );
  }

  if (status === "REVIEWED") {
    const hasCoverage = (input.sourceSnapshotIds?.length ?? 0) > 0 || (input.testsPerformed?.length ?? 0) > 0;
    if (!hasCoverage) {
      throw new DomainReviewError(
        "A domain cannot be marked REVIEWED without at least one source snapshot reference or one recorded test performed — coverage must be proven, not assumed from an absence of mismatches."
      );
    }
  }

  const workspace = db.prepare(`SELECT workspace_id FROM audit_workspaces WHERE workspace_id = ?`).get(input.workspaceId);
  if (!workspace) throw new DomainReviewError(`Workspace ${input.workspaceId} not found`);

  const now = new Date().toISOString();
  const reviewId = randomUUID();
  db.prepare(
    `INSERT INTO audit_domain_reviews
      (review_id, workspace_id, run_id, domain, entity_name, period_from, period_to, source_snapshot_ids_json,
       source_coverage_note, tests_performed_json, matched_amount, matched_count, unresolved_amount, unresolved_count,
       exception_count, limitations, status, reviewer, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    reviewId,
    input.workspaceId,
    input.runId ?? null,
    input.domain,
    input.entityName ?? null,
    input.periodFrom ?? null,
    input.periodTo ?? null,
    JSON.stringify(input.sourceSnapshotIds ?? []),
    input.sourceCoverageNote ?? null,
    JSON.stringify(input.testsPerformed ?? []),
    input.matchedAmount ?? null,
    input.matchedCount ?? null,
    input.unresolvedAmount ?? null,
    input.unresolvedCount ?? null,
    input.exceptionCount ?? null,
    input.limitations ?? null,
    status,
    actor,
    actor,
    now,
    now
  );

  recordAuditEvent(db, "DOMAIN_REVIEW_RECORDED", "domain_review", reviewId, { domain: input.domain, status }, actor);

  return db.prepare(`SELECT * FROM audit_domain_reviews WHERE review_id = ?`).get(reviewId) as unknown as DomainReviewRecord;
}

export function listDomainReviews(workspaceId: string, conn?: DatabaseSync): DomainReviewRecord[] {
  return resolveDb(conn)
    .prepare(`SELECT * FROM audit_domain_reviews WHERE workspace_id = ? ORDER BY created_at DESC`)
    .all(workspaceId) as unknown as DomainReviewRecord[];
}

/** Latest recorded review per domain (a domain may be re-reviewed over time; the report snapshot uses only the latest). */
export function getCoverageMatrix(workspaceId: string, conn?: DatabaseSync): DomainReviewRecord[] {
  const all = listDomainReviews(workspaceId, conn);
  const latestByDomain = new Map<string, DomainReviewRecord>();
  for (const r of all) {
    if (!latestByDomain.has(r.domain)) latestByDomain.set(r.domain, r); // already DESC by created_at
  }
  // Ensure every domain appears, even if never recorded — surfaced as NOT_TESTED.
  const result: DomainReviewRecord[] = [];
  for (const domain of REVIEW_DOMAINS) {
    const existing = latestByDomain.get(domain);
    if (existing) {
      result.push(existing);
    } else {
      result.push({
        review_id: "",
        workspace_id: workspaceId,
        run_id: null,
        domain,
        entity_name: null,
        period_from: null,
        period_to: null,
        source_snapshot_ids_json: "[]",
        source_coverage_note: null,
        tests_performed_json: "[]",
        matched_amount: null,
        matched_count: null,
        unresolved_amount: null,
        unresolved_count: null,
        exception_count: null,
        limitations: null,
        status: STRUCTURALLY_NOT_AVAILABLE.includes(domain) ? "NOT_AVAILABLE" : "NOT_TESTED",
        reviewer: null,
        created_by: "SYSTEM",
        created_at: "",
        updated_at: "",
      });
    }
  }
  return result;
}

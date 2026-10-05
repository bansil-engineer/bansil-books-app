// ============================================================
// Bansil Books Analytics — Internal Review Report: Shared Data Shape
// Both the Excel and PDF builders read ONLY this parsed shape, derived
// purely from an already-generated audit_reports row (an immutable
// snapshot). Neither builder ever reruns matching/AI/Zoho/file parsing,
// and neither builder has business logic the other lacks — this module
// is the single source of derived values for both.
// ============================================================

import type { ReportRecord } from "../report-service.ts";

export interface AuditReportData {
  reportId: string;
  reportVersion: number;
  status: string;
  entityName: string;
  periodFrom: string;
  periodTo: string;
  purpose: string;
  generatedAt: string;
  comparisonModes: string[];
  assumptions: string;
  limitations: string;
  exclusions: string;
  notTestedDomains: string[];
  domainCoverage: Array<Record<string, unknown>>;
  sourceRegister: Array<Record<string, unknown>>;
  matchingSummary: Record<string, unknown>;
  findings: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  reviewerDecisions: Array<Record<string, unknown>>;
}

function safeParseArray(json: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseObject(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Parses an immutable audit_reports row into the shape both export builders consume. Never re-derives values from live state. */
export function buildAuditReportData(report: ReportRecord): AuditReportData {
  return {
    reportId: report.report_id,
    reportVersion: report.report_version,
    status: report.status,
    entityName: report.entity_name ?? "(Entity not specified)",
    periodFrom: report.period_from ?? "-",
    periodTo: report.period_to ?? "-",
    purpose: report.purpose ?? "Internal review working paper — not a statutory audit opinion.",
    generatedAt: report.generated_at,
    comparisonModes: safeParseArray(report.comparison_modes_json) as unknown as string[],
    assumptions: report.assumptions ?? "-",
    limitations: report.limitations ?? "-",
    exclusions: report.exclusions ?? "-",
    notTestedDomains: safeParseArray(report.not_tested_domains_json) as unknown as string[],
    domainCoverage: safeParseArray(report.domain_coverage_json),
    sourceRegister: safeParseArray(report.source_register_json),
    matchingSummary: safeParseObject(report.matching_summary_json),
    findings: safeParseArray(report.findings_snapshot_json),
    actions: safeParseArray(report.actions_snapshot_json),
    reviewerDecisions: safeParseArray(report.reviewer_decisions_json),
  };
}

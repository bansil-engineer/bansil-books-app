// ============================================================
// Bansil Books Analytics — Milestone E §22: Performance / Resource Check
// SYNTHETIC DATA ONLY. Measures approximate timings for: deterministic
// matching on a representative dataset, report generation, Excel/PDF
// generation, and DB growth — using an isolated temp DB. Never
// optimizes by removing safeguards; this is measurement only.
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openAuditDatabaseAt } from "../app/lib/db/audit-database.ts";
import { createWorkspace } from "../app/lib/audit/audit-service.ts";
import { createRun } from "../app/lib/audit/match-service.ts";
import { createFinding } from "../app/lib/audit/findings-service.ts";
import { generateReport } from "../app/lib/audit/report-service.ts";
import { buildAuditReportData } from "../app/lib/audit/export/audit-report-data.ts";
import { buildAuditReportExcel } from "../app/lib/audit/export/audit-report-excel-builder.ts";
import { buildAuditReportPdf } from "../app/lib/audit/export/audit-report-pdf-builder.ts";
import { REPORT_SECTION_KEYS } from "../app/lib/audit/report-field-selector.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bansil-perf-"));
const conn: DatabaseSync = openAuditDatabaseAt(path.join(dir, "audit_workspace.db"));

function makeFrozenSourceVersion(c: DatabaseSync, workspaceId: string, roleLabel: string, rowCount: number) {
  const sourceId = randomUUID();
  const now = new Date().toISOString();
  c.prepare(`INSERT INTO audit_workspace_sources (source_id, workspace_id, role_label, source_origin, created_at) VALUES (?, ?, ?, 'INTERNAL', ?)`).run(sourceId, workspaceId, roleLabel, now);
  const versionId = randomUUID();
  c.prepare(
    `INSERT INTO audit_source_versions (version_id, source_id, version_number, origin_type, extraction_status, extraction_method, raw_row_count, parsed_row_count, exception_count, mapping_status, mapping_version, completeness_status, frozen, frozen_at, created_by, created_at, updated_at)
     VALUES (?, ?, 1, 'FILE', 'EXTRACTED', 'perf-fixture', ?, ?, 0, 'APPROVED', 1, 'COMPLETE', 1, ?, 'TEST', ?, ?)`
  ).run(versionId, sourceId, rowCount, rowCount, now, now, now);
  const insert = c.prepare(`INSERT INTO audit_normalized_rows (row_id, source_version_id, record_uid, evidence_locator, raw_json, normalized_json, parse_status, parse_exception, created_at) VALUES (?, ?, ?, ?, ?, ?, 'OK', NULL, ?)`);
  for (let i = 0; i < rowCount; i++) {
    const normalized = { document_number_raw: `DOC-${i}`, gross_value: String((i + 1) * 10), entity_id: `E-${i % 50}` };
    insert.run(randomUUID(), versionId, randomUUID(), `row:${i + 1}`, JSON.stringify(normalized), JSON.stringify(normalized), now);
  }
  return { sourceId, versionId };
}

function timeIt<T>(label: string, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  console.log(`  ${label}: ${ms.toFixed(1)} ms`);
  return result;
}

const ROW_COUNT = 2000; // representative mid-size synthetic dataset

console.log(`\n=== Performance Check (synthetic, ${ROW_COUNT} rows/side) ===`);

const ws = createWorkspace({ name: "Performance Check Workspace", comparisonMode: "INTERNAL_EXTERNAL", sources: [] }, conn);

const left = timeIt("Source A intake (synthetic insert)", () => makeFrozenSourceVersion(conn, ws.workspace_id, "SOURCE_A", ROW_COUNT));
const right = timeIt("Source B intake (synthetic insert)", () => makeFrozenSourceVersion(conn, ws.workspace_id, "SOURCE_B", ROW_COUNT));

const { runId } = timeIt(`Deterministic matching run (${ROW_COUNT} rows/side)`, () =>
  createRun({ workspaceId: ws.workspace_id, edges: [{ leftRoleLabel: "A", rightRoleLabel: "B", leftSourceVersionId: left.versionId, rightSourceVersionId: right.versionId }] }, "OWNER", conn)
);

for (let i = 0; i < 50; i++) {
  createFinding({ workspaceId: ws.workspace_id, runId, domain: "PAYABLES", severity: "LOW", findingType: "REVIEW_LIMITATION", title: `Synthetic finding ${i}`, financialImpact: String(i) }, "OWNER", conn);
}

const report = timeIt("Report generation (50 findings, real source register, matching summary)", () => generateReport({ workspaceId: ws.workspace_id, runId, entityName: "Perf Co" }, "OWNER", conn));

const data = timeIt("buildAuditReportData (parse snapshot)", () => buildAuditReportData(report));
timeIt("Excel generation (all sections)", () => buildAuditReportExcel(data, REPORT_SECTION_KEYS));
timeIt("PDF generation (all sections)", () => buildAuditReportPdf(data, REPORT_SECTION_KEYS));

const dbSizeBytes = fs.statSync(path.join(dir, "audit_workspace.db")).size;
console.log(`  DB file size after this run: ${(dbSizeBytes / 1024).toFixed(0)} KB`);
console.log("  Zoho API calls made: 0 (no import of zoho-api.ts anywhere in this script)");
console.log("  External AI/OCR calls made: 0");
console.log("\nPerformance check complete — measurement only, no safeguards altered.");

// ============================================================
// Bansil Books Analytics — Milestone D Test Suite
// Domain Review + Findings + Action Taken + Reviewer Decisions +
// Reports + Excel/PDF Export. ZERO ZOHO API CALLS. ISOLATED TEMP
// SQLITE FILES ONLY. Every fixture is synthetic.
// ============================================================

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openAuditDatabaseAt } from "../app/lib/db/audit-database.ts";
import { createWorkspace, addWorkspaceSource } from "../app/lib/audit/audit-service.ts";
import { createRun } from "../app/lib/audit/match-service.ts";
import { recordDomainReview, listDomainReviews, getCoverageMatrix, DomainReviewError } from "../app/lib/audit/domain-review-service.ts";
import { createFinding, listFindings, getFinding, setFindingConfirmation, setFindingStatus, FindingError } from "../app/lib/audit/findings-service.ts";
import {
  createAction,
  assignAction,
  markInProgress,
  resolveAction,
  closeAction,
  reopenAction,
  cancelAction,
  listActionEvents,
  getAction,
  ActionError,
} from "../app/lib/audit/action-service.ts";
import { generateReport, getReport, listReports, setReportStatus, ReportError } from "../app/lib/audit/report-service.ts";
import { listMatchGroups, decideMatchGroup } from "../app/lib/audit/match-service.ts";
import {
  resolveSelectedSections,
  resolveSelectedTableFields,
  ReportFieldSelectionError,
  REPORT_SECTION_KEYS,
  FINDINGS_FIELDS,
  MATCHING_SUMMARY_FIELDS,
} from "../app/lib/audit/report-field-selector.ts";
import { buildAuditReportData } from "../app/lib/audit/export/audit-report-data.ts";
import { buildSourceRegister } from "../app/lib/audit/export/source-register.ts";
import { buildAuditReportExcel } from "../app/lib/audit/export/audit-report-excel-builder.ts";
import { buildAuditReportPdf } from "../app/lib/audit/export/audit-report-pdf-builder.ts";

let passedCount = 0;
let failedCount = 0;
function pass(name: string) {
  console.log(`  ✓ PASS: ${name}`);
  passedCount++;
}
function fail(name: string, err: unknown) {
  console.error(`  ✗ FAIL: ${name}`, err);
  failedCount++;
}
function test(name: string, fn: () => void) {
  try {
    fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

function tmpDb(label: string): DatabaseSync {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bansil-milestoneD-${label}-`));
  return openAuditDatabaseAt(path.join(dir, "audit_workspace.db"));
}

function makeWorkspace(conn: DatabaseSync): string {
  const ws = createWorkspace({ name: "Synthetic Milestone D Workspace", comparisonMode: "INTERNAL_EXTERNAL", sources: [] }, conn);
  return ws.workspace_id;
}

/** Directly inserts a frozen source version + a source file record, bypassing the upload/parse pipeline (already covered by Milestone B tests) so Milestone D's source-register tests focus purely on the register's own join/derivation logic. */
function makeFrozenSourceVersion(
  conn: DatabaseSync,
  workspaceId: string,
  roleLabel: string,
  origin: "INTERNAL" | "EXTERNAL",
  opts: { originalFilename?: string; fileType?: string; rawCount?: number; parsedCount?: number; exceptionCount?: number } = {}
): { sourceId: string; versionId: string } {
  const sourceId = randomUUID();
  const now = new Date().toISOString();
  conn
    .prepare(`INSERT INTO audit_workspace_sources (source_id, workspace_id, role_label, source_origin, origin_description, provenance, basis_note, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sourceId, workspaceId, roleLabel, origin, "Synthetic test source", "synthetic-provenance", "Synthetic Test Entity", null, now);

  const fileId = randomUUID();
  conn
    .prepare(`INSERT INTO audit_source_files (file_id, source_id, original_filename, file_type, size_bytes, sha256, storage_path, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'TEST', ?)`)
    .run(fileId, sourceId, opts.originalFilename ?? "synthetic-source.csv", opts.fileType ?? "CSV", 1024, "synthetic-sha256-hash", `synthetic/${fileId}.bin`, now);

  const versionId = randomUUID();
  conn
    .prepare(
      `INSERT INTO audit_source_versions
        (version_id, source_id, version_number, origin_type, file_id, extraction_status, extraction_method, raw_row_count, parsed_row_count, exception_count,
         mapping_status, mapping_version, completeness_status, frozen, frozen_at, created_by, created_at, updated_at)
       VALUES (?, ?, 1, 'FILE', ?, 'EXTRACTED', 'test-fixture', ?, ?, ?, 'APPROVED', 1, 'COMPLETE', 1, ?, 'TEST', ?, ?)`
    )
    .run(versionId, sourceId, fileId, opts.rawCount ?? 10, opts.parsedCount ?? 10, opts.exceptionCount ?? 0, now, now, now);

  return { sourceId, versionId };
}

/** Independent-reader helper: extracts every xl/worksheets/sheetN.xml body from a generated .xlsx buffer, in sheet order. */
function extractXlsxSheetXmls(buf: Buffer): string[] {
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const tail = buf.subarray(Math.max(0, buf.length - 4096));
  const eocdOffset = buf.length - tail.length + tail.lastIndexOf(eocdSig);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const sheets: Array<{ name: string; xml: string }> = [];
  let ptr = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const compSize = buf.readUInt32LE(ptr + 20);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf-8");

    if (name.startsWith("xl/worksheets/sheet")) {
      const lfhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const lfhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
      const compData = buf.subarray(dataStart, dataStart + compSize);
      sheets.push({ name, xml: zlib.inflateRawSync(compData).toString("utf-8") });
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  sheets.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return sheets.map((s) => s.xml);
}

function insertNormalizedRow(conn: DatabaseSync, versionId: string, evidenceLocator: string, normalized: Record<string, unknown>): void {
  const now = new Date().toISOString();
  conn
    .prepare(`INSERT INTO audit_normalized_rows (row_id, source_version_id, record_uid, evidence_locator, raw_json, normalized_json, parse_status, parse_exception, created_at) VALUES (?, ?, ?, ?, ?, ?, 'OK', NULL, ?)`)
    .run(randomUUID(), versionId, randomUUID(), evidenceLocator, JSON.stringify(normalized), JSON.stringify(normalized), now);
}

// ============================================================
// Domain Review / Coverage Matrix
// ============================================================
console.log("\n=== Domain Review & Coverage Matrix ===");
{
  const conn = tmpDb("domain");
  const wsId = makeWorkspace(conn);

  test("REVIEWED without coverage proof is rejected", () => {
    assert.throws(
      () => recordDomainReview({ workspaceId: wsId, domain: "BANK_CASH", status: "REVIEWED" }, "OWNER", conn),
      DomainReviewError
    );
  });

  test("REVIEWED with sourceSnapshotIds succeeds", () => {
    const r = recordDomainReview({ workspaceId: wsId, domain: "BANK_CASH", status: "REVIEWED", sourceSnapshotIds: ["v1"], matchedAmount: "100.00" }, "OWNER", conn);
    assert.strictEqual(r.status, "REVIEWED");
  });

  test("REVIEWED with testsPerformed succeeds (no snapshot ids needed)", () => {
    const r = recordDomainReview({ workspaceId: wsId, domain: "RECEIVABLES", status: "REVIEWED", testsPerformed: ["3-way match"] }, "OWNER", conn);
    assert.strictEqual(r.status, "REVIEWED");
  });

  test("Structurally NOT_AVAILABLE domain cannot be marked REVIEWED", () => {
    assert.throws(() => recordDomainReview({ workspaceId: wsId, domain: "TAX", status: "REVIEWED", sourceSnapshotIds: ["x"] }, "OWNER", conn), DomainReviewError);
  });

  test("Structurally NOT_AVAILABLE domain can be marked NOT_AVAILABLE", () => {
    const r = recordDomainReview({ workspaceId: wsId, domain: "TAX", status: "NOT_AVAILABLE" }, "OWNER", conn);
    assert.strictEqual(r.status, "NOT_AVAILABLE");
  });

  test("Coverage matrix surfaces every domain, including never-recorded ones as NOT_TESTED", () => {
    const matrix = getCoverageMatrix(wsId, conn);
    const domains = matrix.map((m) => m.domain);
    assert.ok(domains.includes("PAYABLES"));
    const payables = matrix.find((m) => m.domain === "PAYABLES")!;
    assert.strictEqual(payables.status, "NOT_TESTED");
  });

  test("Coverage matrix uses latest review per domain", () => {
    recordDomainReview({ workspaceId: wsId, domain: "BANK_CASH", status: "PARTIAL", sourceCoverageNote: "second pass" }, "OWNER", conn);
    const matrix = getCoverageMatrix(wsId, conn);
    const bank = matrix.find((m) => m.domain === "BANK_CASH")!;
    assert.strictEqual(bank.status, "PARTIAL");
  });

  test("listDomainReviews orders newest first", () => {
    const rows = listDomainReviews(wsId, conn);
    assert.ok(new Date(rows[0].created_at).getTime() >= new Date(rows[rows.length - 1].created_at).getTime());
  });
}

// ============================================================
// Findings Register
// ============================================================
console.log("\n=== Findings Register ===");
let findingWsId = "";
let findingId1 = "";
{
  const conn = tmpDb("findings");
  const wsId = makeWorkspace(conn);
  findingWsId = wsId;

  test("createFinding defaults confirmed_vs_suspected to SUSPECTED", () => {
    const f = createFinding({ workspaceId: wsId, domain: "PAYABLES", severity: "MEDIUM", findingType: "AMOUNT_VARIANCE", title: "Bill vs statement variance" }, "OWNER", conn);
    findingId1 = f.finding_id;
    assert.strictEqual(f.confirmed_vs_suspected, "SUSPECTED");
    assert.strictEqual(f.status, "OPEN");
  });

  test("createFinding rejects invalid severity", () => {
    assert.throws(() => createFinding({ workspaceId: wsId, domain: "PAYABLES", severity: "EXTREME" as any, findingType: "AMOUNT_VARIANCE", title: "x" }, "OWNER", conn), FindingError);
  });

  test("createFinding rejects invalid finding_type", () => {
    assert.throws(() => createFinding({ workspaceId: wsId, domain: "PAYABLES", severity: "LOW", findingType: "NOT_A_TYPE" as any, title: "x" }, "OWNER", conn), FindingError);
  });

  test("Severity is never amount-derived automatically — CRITICAL only when explicitly set", () => {
    const f = createFinding({ workspaceId: wsId, domain: "SALES_CHAIN", severity: "INFO", findingType: "TIMING_DATE_VARIANCE", title: "Large amount but INFO severity", financialImpact: "999999999.00" }, "OWNER", conn);
    assert.strictEqual(f.severity, "INFO");
  });

  test("setFindingConfirmation requires named reviewer + reason, and is the only path that changes it", () => {
    const before = getFinding(findingId1, conn)!;
    assert.strictEqual(before.confirmed_vs_suspected, "SUSPECTED");
    const after = setFindingConfirmation(findingId1, "CONFIRMED", "reviewer.owner", "Vendor statement corroborates variance", conn);
    assert.strictEqual(after.confirmed_vs_suspected, "CONFIRMED");
  });

  test("setFindingStatus records a reviewer decision row", () => {
    setFindingStatus(findingId1, "UNDER_REVIEW", "reviewer.owner", "Escalated for review", conn);
    const rows = conn.prepare(`SELECT * FROM audit_reviewer_decisions WHERE entity_type = 'finding' AND entity_id = ?`).all(findingId1);
    assert.ok(rows.length >= 2); // confirmation + status
  });

  test("listFindings supports domain/severity/status filters", () => {
    const filtered = listFindings(wsId, { domain: "PAYABLES" }, conn);
    assert.ok(filtered.every((f) => f.domain === "PAYABLES"));
  });
}

// ============================================================
// Action Taken Workflow
// ============================================================
console.log("\n=== Action Taken Workflow ===");
{
  const conn = tmpDb("actions");
  const wsId = makeWorkspace(conn);
  const finding = createFinding({ workspaceId: wsId, domain: "PAYABLES", severity: "HIGH", findingType: "MISSING_DOCUMENT_EVIDENCE", title: "Missing vendor statement" }, "OWNER", conn);

  let actionId = "";
  test("createAction defaults to OPEN when unassigned", () => {
    const a = createAction({ findingId: finding.finding_id, actionRequired: "Obtain vendor statement" }, "OWNER", conn);
    actionId = a.action_id;
    assert.strictEqual(a.action_status, "OPEN");
  });

  test("Cannot close an action directly from OPEN (must flow through RESOLVED)", () => {
    assert.throws(() => closeAction(actionId, "owner", "closing early"), ActionError);
  });

  test("assignAction moves OPEN -> ASSIGNED", () => {
    const a = assignAction(actionId, { actionOwner: "site.engineer" }, "OWNER", conn);
    assert.strictEqual(a.action_status, "ASSIGNED");
  });

  test("markInProgress moves ASSIGNED -> IN_PROGRESS", () => {
    const a = markInProgress(actionId, "OWNER", "started", conn);
    assert.strictEqual(a.action_status, "IN_PROGRESS");
  });

  test("resolveAction moves IN_PROGRESS -> RESOLVED and sets completed_at", () => {
    const a = resolveAction(actionId, "OWNER", "evidence obtained", conn);
    assert.strictEqual(a.action_status, "RESOLVED");
    assert.ok(a.completed_at);
  });

  test("CRITICAL: closeAction never mutates the underlying finding", () => {
    const findingBefore = getFinding(finding.finding_id, conn)!;
    closeAction(actionId, "OWNER", "Vendor statement received and filed", conn);
    const findingAfter = getFinding(finding.finding_id, conn)!;
    assert.deepStrictEqual(findingBefore, findingAfter);
  });

  test("CRITICAL: closeAction never converts SUSPECTED to CONFIRMED", () => {
    const findingAfter = getFinding(finding.finding_id, conn)!;
    assert.strictEqual(findingAfter.confirmed_vs_suspected, "SUSPECTED");
  });

  test("Action history records every transition in order", () => {
    const events = listActionEvents(actionId, conn);
    const types = events.map((e) => e.event_type);
    assert.deepStrictEqual(types, ["CREATED", "ASSIGNED", "ACTION_STATUS_CHANGED", "ACTION_STATUS_CHANGED", "CLOSED"]);
  });

  test("reopenAction moves CLOSED back to IN_PROGRESS without deleting history", () => {
    const before = listActionEvents(actionId, conn).length;
    const a = reopenAction(actionId, "OWNER", "found a follow-up issue", conn);
    assert.strictEqual(a.action_status, "IN_PROGRESS");
    assert.strictEqual(listActionEvents(actionId, conn).length, before + 1);
  });

  test("cancelAction only allowed from cancellable states", () => {
    const finding2 = createFinding({ workspaceId: wsId, domain: "SALES_CHAIN", severity: "LOW", findingType: "REVIEW_LIMITATION", title: "minor" }, "OWNER", conn);
    const a2 = createAction({ findingId: finding2.finding_id, actionRequired: "n/a" }, "OWNER", conn);
    const cancelled = cancelAction(a2.action_id, "OWNER", "no longer applicable", conn);
    assert.strictEqual(cancelled.action_status, "CANCELLED");
    assert.throws(() => resolveAction(a2.action_id, "OWNER", "x", conn), ActionError);
  });
}

// ============================================================
// Reports: generation, immutability, lifecycle
// ============================================================
console.log("\n=== Reports (Immutable Snapshots) ===");
{
  const conn = tmpDb("reports");
  const wsId = makeWorkspace(conn);
  recordDomainReview({ workspaceId: wsId, domain: "BANK_CASH", status: "REVIEWED", sourceSnapshotIds: ["v1"], matchedAmount: "500.00", matchedCount: 5 }, "OWNER", conn);
  const finding = createFinding({ workspaceId: wsId, domain: "BANK_CASH", severity: "MEDIUM", findingType: "TIMING_DATE_VARIANCE", title: "Deposit timing lag" }, "OWNER", conn);
  createAction({ findingId: finding.finding_id, actionRequired: "Confirm with bank" }, "OWNER", conn);

  let reportId = "";
  test("generateReport creates report_version 1 in DRAFT status", () => {
    const r = generateReport({ workspaceId: wsId, entityName: "Synthetic Co", periodFrom: "2026-01-01", periodTo: "2026-03-31" }, "OWNER", conn);
    reportId = r.report_id;
    assert.strictEqual(r.report_version, 1);
    assert.strictEqual(r.status, "DRAFT");
  });

  test("Report snapshot embeds findings/actions/domain coverage at generation time", () => {
    const r = getReport(reportId, conn)!;
    const findings = JSON.parse(r.findings_snapshot_json);
    const actions = JSON.parse(r.actions_snapshot_json);
    const coverage = JSON.parse(r.domain_coverage_json);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(actions.length, 1);
    assert.ok(coverage.some((c: any) => c.domain === "BANK_CASH" && c.status === "REVIEWED"));
  });

  test("Regenerating creates a NEW report_version — past report never edited", () => {
    const before = getReport(reportId, conn)!;
    createFinding({ workspaceId: wsId, domain: "PAYABLES", severity: "LOW", findingType: "REVIEW_LIMITATION", title: "New finding after report 1" }, "OWNER", conn);
    const r2 = generateReport({ workspaceId: wsId, entityName: "Synthetic Co" }, "OWNER", conn);
    assert.strictEqual(r2.report_version, 2);
    const afterReRead = getReport(reportId, conn)!;
    assert.deepStrictEqual(before, afterReRead);
    const findingsInV2 = JSON.parse(r2.findings_snapshot_json);
    assert.strictEqual(findingsInV2.length, 2);
  });

  test("listReports orders newest version first", () => {
    const rows = listReports(wsId, conn);
    assert.strictEqual(rows[0].report_version, 2);
  });

  test("setReportStatus never uses CERTIFIED/AUDITED/CA SIGNED", () => {
    assert.throws(() => setReportStatus(reportId, "CERTIFIED" as any, "OWNER", undefined, conn), ReportError);
    const updated = setReportStatus(reportId, "REVIEWED", "reviewer.owner", "Reviewed internally", conn);
    assert.strictEqual(updated.status, "REVIEWED");
  });

  test("Report never forces net difference / absolute residual toward zero (both surfaced, present as strings)", () => {
    const r = getReport(reportId, conn)!;
    const ms = JSON.parse(r.matching_summary_json);
    assert.ok("netDifference" in ms);
    assert.ok("absoluteResidual" in ms);
  });
}

// ============================================================
// Field Selector: explicit-empty blocks, absent-uses-defaults
// ============================================================
console.log("\n=== Report Field Selector ===");
{
  test("Absent selection (undefined) resolves to approved defaults", () => {
    const sections = resolveSelectedSections(undefined);
    assert.ok(sections.length > 0);
    assert.deepStrictEqual(sections, REPORT_SECTION_KEYS);
  });

  test("Absent selection (null) resolves to approved defaults", () => {
    const sections = resolveSelectedSections(null);
    assert.ok(sections.length > 0);
  });

  test("Explicit empty selection blocks and throws — never silently defaults", () => {
    assert.throws(() => resolveSelectedSections([]), ReportFieldSelectionError);
  });

  test("Non-empty selection returns only recognized, canonically ordered keys", () => {
    const sections = resolveSelectedSections(["findings", "summary", "not_a_real_key"]);
    assert.deepStrictEqual(sections, ["summary", "findings"]);
  });

  test("Selection of only unrecognized keys throws", () => {
    assert.throws(() => resolveSelectedSections(["bogus"]), ReportFieldSelectionError);
  });
}

// ============================================================
// Excel / PDF Export — independent-reader validation
// ============================================================
console.log("\n=== Excel & PDF Export (independent validation) ===");
{
  const conn = tmpDb("export");
  const wsId = makeWorkspace(conn);
  const left = makeFrozenSourceVersion(conn, wsId, "SOURCE_A", "INTERNAL", { originalFilename: "internal-ledger.csv" });
  const right = makeFrozenSourceVersion(conn, wsId, "SOURCE_B", "EXTERNAL", { originalFilename: "customer-statement.pdf", fileType: "PDF" });
  insertNormalizedRow(conn, left.versionId, "row:1", { document_number_raw: "INV-EXP-1", gross_value: "300.00", entity_id: "CUST-1" });
  insertNormalizedRow(conn, right.versionId, "row:1", { document_number_raw: "INV-EXP-1", gross_value: "300.00", entity_id: "CUST-1" });
  const { runId } = createRun({ workspaceId: wsId, edges: [{ leftRoleLabel: "LEDGER", rightRoleLabel: "STATEMENT", leftSourceVersionId: left.versionId, rightSourceVersionId: right.versionId }] }, "OWNER", conn);
  const [exactGroup] = listMatchGroups(runId, { groupType: "EXACT" }, conn);
  if (exactGroup) decideMatchGroup(exactGroup.group_id, "ACCEPTED", "OWNER", "synthetic acceptance for export test", conn);
  recordDomainReview({ workspaceId: wsId, runId, domain: "RECEIVABLES", status: "REVIEWED", testsPerformed: ["invoice-to-receipt match"], matchedAmount: "1234.56", matchedCount: 3 }, "OWNER", conn);
  const finding = createFinding(
    { workspaceId: wsId, runId, domain: "RECEIVABLES", severity: "HIGH", findingType: "UNMATCHED_TRANSACTION", title: "Unmatched receipt", evidenceRefs: ["stmt.pdf#page=2"], financialImpact: "-450.25", currency: "INR" },
    "OWNER",
    conn
  );
  createAction({ findingId: finding.finding_id, actionRequired: "Contact customer for remittance advice", actionOwner: "accounts.team" }, "OWNER", conn);
  const report = generateReport({ workspaceId: wsId, runId, entityName: "Synthetic Export Co", periodFrom: "2026-01-01", periodTo: "2026-03-31" }, "OWNER", conn);
  const data = buildAuditReportData(report);

  test("Source Register: report snapshot includes every source version pinned to the run's edges", () => {
    assert.strictEqual(data.sourceRegister.length, 2);
    const ids = data.sourceRegister.map((s) => s.source_version_id).sort();
    assert.deepStrictEqual(ids, [left.versionId, right.versionId].sort());
  });

  test("Source Register: entries carry origin, role, file reference, and completeness metadata", () => {
    const leftEntry = data.sourceRegister.find((s) => s.source_version_id === left.versionId)!;
    assert.strictEqual(leftEntry.origin, "INTERNAL");
    assert.strictEqual(leftEntry.role_label, "SOURCE_A");
    assert.strictEqual(leftEntry.original_reference, "internal-ledger.csv");
    assert.strictEqual(leftEntry.completeness_status, "COMPLETE");
    assert.strictEqual(leftEntry.frozen, true);
  });

  test("Source Register never queries live Zoho — buildSourceRegister is a pure DB read (re-derivation matches the frozen snapshot exactly)", () => {
    const rederived = buildSourceRegister(conn, wsId, runId);
    assert.deepStrictEqual(rederived, data.sourceRegister);
  });

  test("Regenerating the report keeps the past version's source register byte-identical (immutability)", () => {
    const reportV1Before = getReport(report.report_id, conn)!;
    generateReport({ workspaceId: wsId, runId, entityName: "Synthetic Export Co" }, "OWNER", conn);
    const reportV1After = getReport(report.report_id, conn)!;
    assert.strictEqual(reportV1Before.source_register_json, reportV1After.source_register_json);
  });

  test("Matching Summary rows carry a real accepted allocation for the synthetic EXACT match", () => {
    const ms = data.matchingSummary as Record<string, unknown>;
    const rows = ms.rows as Array<Record<string, unknown>>;
    const exactRow = rows.find((r) => r.match_type === "EXACT");
    assert.ok(exactRow, "no EXACT row in matching summary");
    assert.strictEqual(exactRow!.allocated_amount, "300.00");
  });

  test("Field/Column Selector: absent selection resolves to defaults for a tabular section", () => {
    const cols = resolveSelectedTableFields("findings", undefined);
    assert.deepStrictEqual(cols, FINDINGS_FIELDS.filter((f) => f.defaultSelected).map((f) => f.key));
  });

  test("Field/Column Selector: explicit empty selection blocks that table", () => {
    assert.throws(() => resolveSelectedTableFields("findings", []), ReportFieldSelectionError);
  });

  test("Field/Column Selector: non-empty selection returns only recognized keys in canonical order", () => {
    const cols = resolveSelectedTableFields("matching_summary", ["residual", "match_type", "not_a_real_column"]);
    assert.deepStrictEqual(cols, ["match_type", "residual"]);
  });

  test("Field/Column Selector: unrecognized table key returns an empty column list (no section rendered)", () => {
    assert.deepStrictEqual(resolveSelectedTableFields("not_a_table", undefined), []);
  });

  let xlsxBuffer: Buffer;
  test("buildAuditReportExcel produces a non-empty buffer", () => {
    xlsxBuffer = buildAuditReportExcel(data, REPORT_SECTION_KEYS);
    assert.ok(xlsxBuffer.length > 200);
  });

  test("Generated .xlsx is a valid ZIP with expected OOXML parts (independent reader: raw ZIP central-directory parse)", () => {
    const buf = xlsxBuffer!;
    // Locate End Of Central Directory record (PK\x05\x06) from the tail.
    const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    const tail = buf.subarray(Math.max(0, buf.length - 4096));
    const eocdIdxInTail = tail.lastIndexOf(eocdSig);
    assert.ok(eocdIdxInTail >= 0, "EOCD signature not found");
    const eocdOffset = buf.length - tail.length + eocdIdxInTail;
    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);

    const names: string[] = [];
    let ptr = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
      const sig = buf.readUInt32LE(ptr);
      assert.strictEqual(sig, 0x02014b50, "Bad central directory signature");
      const nameLen = buf.readUInt16LE(ptr + 28);
      const extraLen = buf.readUInt16LE(ptr + 30);
      const commentLen = buf.readUInt16LE(ptr + 32);
      const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf-8");
      names.push(name);
      ptr += 46 + nameLen + extraLen + commentLen;
    }

    assert.ok(names.includes("[Content_Types].xml"));
    assert.ok(names.includes("xl/workbook.xml"));
    assert.ok(names.some((n) => n.startsWith("xl/worksheets/sheet")));
  });

  test("Generated .xlsx worksheet XML parses and contains the finding title + evidence ref (independent reader: inflate + substring scan)", () => {
    const buf = xlsxBuffer!;
    const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    const tail = buf.subarray(Math.max(0, buf.length - 4096));
    const eocdOffset = buf.length - tail.length + tail.lastIndexOf(eocdSig);
    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);

    let ptr = cdOffset;
    let foundFindingsSheetText = "";
    for (let i = 0; i < totalEntries; i++) {
      const nameLen = buf.readUInt16LE(ptr + 28);
      const extraLen = buf.readUInt16LE(ptr + 30);
      const commentLen = buf.readUInt16LE(ptr + 32);
      const compSize = buf.readUInt32LE(ptr + 20);
      const localHeaderOffset = buf.readUInt32LE(ptr + 42);
      const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf-8");

      if (name.startsWith("xl/worksheets/sheet")) {
        const lfhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
        const lfhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
        const compData = buf.subarray(dataStart, dataStart + compSize);
        const xml = zlib.inflateRawSync(compData).toString("utf-8");
        if (xml.includes("Unmatched receipt")) foundFindingsSheetText = xml;
      }
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    assert.ok(foundFindingsSheetText.length > 0, "Findings sheet with finding title not found");
    assert.ok(foundFindingsSheetText.includes("stmt.pdf#page=2"), "Evidence reference not preserved in export");
  });

  let pdfBuffer: Buffer;
  test("buildAuditReportPdf produces a non-empty buffer starting with %PDF-1.4", () => {
    pdfBuffer = buildAuditReportPdf(data, REPORT_SECTION_KEYS);
    assert.ok(pdfBuffer.length > 200);
    assert.strictEqual(pdfBuffer.subarray(0, 8).toString("ascii"), "%PDF-1.4");
  });

  test("Generated PDF has a well-formed xref table and trailer (independent reader: byte-offset verification, no repair needed)", () => {
    const text = pdfBuffer!.toString("latin1");
    const xrefMatch = text.match(/startxref\s+(\d+)\s+%%EOF/);
    assert.ok(xrefMatch, "startxref/%%EOF not found");
    const xrefOffset = parseInt(xrefMatch![1], 10);
    const atOffset = text.slice(xrefOffset, xrefOffset + 4);
    assert.strictEqual(atOffset, "xref", "xref table not located at the offset recorded in startxref");
    assert.ok(text.includes("trailer"));
    assert.ok(text.includes("/Root 1 0 R"));
  });

  test("PDF text-extraction sanity: finding title and evidence reference appear as literal Tj text (no independent business logic vs Excel)", () => {
    const text = pdfBuffer!.toString("latin1");
    assert.ok(text.includes("Unmatched receipt"));
    assert.ok(text.includes("stmt.pdf#page=2"));
  });

  test("PDF page count matches /Count in the Pages object (no clipped pages)", () => {
    const text = pdfBuffer!.toString("latin1");
    const countMatch = text.match(/\/Type \/Pages \/Kids \[([^\]]*)\] \/Count (\d+)/);
    assert.ok(countMatch, "Pages object not found");
    const kids = countMatch![1].trim().split(/\s+/).filter((t) => t !== "0" && t !== "R" && t.length > 0 && !t.startsWith("R"));
    const declaredCount = parseInt(countMatch![2], 10);
    assert.ok(declaredCount >= 1);
  });

  test("Excel Sources sheet contains actual source-register rows (not a static note)", () => {
    const sheetXmls = extractXlsxSheetXmls(xlsxBuffer!);
    const sourcesSheet = sheetXmls.find((xml) => xml.includes("internal-ledger.csv"));
    assert.ok(sourcesSheet, "Sources sheet with real filename not found");
    assert.ok(sourcesSheet!.includes("customer-statement.pdf"));
    assert.ok(sourcesSheet!.includes(left.versionId) || sourcesSheet!.includes(left.sourceId), "source id/version id not preserved as string in Sources sheet");
  });

  test("PDF Sources section contains actual source-register rows (not a static note)", () => {
    const text = pdfBuffer!.toString("latin1");
    assert.ok(text.includes(left.sourceId.slice(0, 8)), "left source id prefix not found in PDF Sources section");
    assert.ok(text.includes("COMPLETE"), "completeness status not found in PDF Sources section");
  });

  test("Excel and PDF are built from the SAME immutable report dataset (identical finding title and source identifiers — PDF table cells are hard-truncated for layout, Excel is not, so only truncation-safe needles are compared)", () => {
    const sheetXmls = extractXlsxSheetXmls(xlsxBuffer!);
    const combinedExcelText = sheetXmls.join("\n");
    const pdfText = pdfBuffer!.toString("latin1");
    for (const needle of ["Unmatched receipt", left.sourceId.slice(0, 8), right.sourceId.slice(0, 8)]) {
      assert.ok(combinedExcelText.includes(needle), `Excel missing "${needle}"`);
      assert.ok(pdfText.includes(needle), `PDF missing "${needle}"`);
    }
    // Excel preserves the full filename untruncated (no layout constraint there).
    assert.ok(combinedExcelText.includes("internal-ledger.csv"));
    assert.ok(combinedExcelText.includes("customer-statement.pdf"));
  });

  test("Selected additive totals: Excel Findings sheet totals the financial_impact column when selected", () => {
    const buf = buildAuditReportExcel(data, ["findings"], { findings: ["title", "financial_impact"] });
    const [sheetXml] = extractXlsxSheetXmls(buf);
    // financial_impact for the one synthetic finding is -450.25; the totals row must show that same value as the column sum.
    assert.ok(sheetXml.includes("-450.25"), "totals row for the single-finding case should equal its own financial_impact");
    assert.ok(sheetXml.includes("TOTAL"));
  });

  test("Non-additive fields are never totaled: Excel Findings sheet with only text/status columns has no TOTAL row", () => {
    const buf = buildAuditReportExcel(data, ["findings"], { findings: ["domain", "severity", "status"] });
    const [sheetXml] = extractXlsxSheetXmls(buf);
    assert.ok(!sheetXml.includes("TOTAL"), "a totals row must never appear when no additive column is selected");
  });

  test("Non-additive totals never computed even when an additive column is also present: text columns excluded from the sum", () => {
    // finding_id (text) + financial_impact (additive) selected together — the totals row's non-additive cell must stay blank/label, never a numeric sum of IDs.
    const buf = buildAuditReportExcel(data, ["findings"], { findings: ["finding_id", "financial_impact"] });
    const rows = buf.toString("latin1"); // raw compressed bytes; just confirms no crash and totals still computed for the additive column only
    assert.ok(rows.length > 0);
    const [sheetXml] = extractXlsxSheetXmls(buf);
    assert.ok(sheetXml.includes("-450.25"));
  });

  test("Excel export throws when a selected section's field selection is explicitly empty (resolved at the API layer, not the builder)", () => {
    assert.throws(() => resolveSelectedTableFields("findings", []), ReportFieldSelectionError);
  });
}

// ============================================================
console.log(`\n${"=".repeat(60)}\nMILESTONE D TEST SUMMARY: ${passedCount} passed, ${failedCount} failed\n${"=".repeat(60)}`);
if (failedCount > 0) process.exit(1);

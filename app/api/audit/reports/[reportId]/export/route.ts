import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
import { getAuditDatabase } from "@/app/lib/db/audit-database";
import { getReport } from "@/app/lib/audit/report-service";
import { buildAuditReportData } from "@/app/lib/audit/export/audit-report-data";
import { buildAuditReportExcel, type TableColumnSelections } from "@/app/lib/audit/export/audit-report-excel-builder";
import { buildAuditReportPdf } from "@/app/lib/audit/export/audit-report-pdf-builder";
import { resolveSelectedSections, resolveSelectedTableFields, TABULAR_SECTION_KEYS, ReportFieldSelectionError } from "@/app/lib/audit/report-field-selector";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

/**
 * Generates Excel or PDF strictly from the already-frozen report
 * snapshot (report_id) — never reruns matching/AI/Zoho/file parsing.
 * `selectedFields` follows the field-selector contract: an explicit
 * empty array blocks the export; an absent/undefined field uses the
 * approved section defaults.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const format = String(body.format ?? "").toUpperCase();
  if (format !== "EXCEL" && format !== "PDF") {
    return NextResponse.json({ success: false, error: "format must be EXCEL or PDF" }, { status: 400 });
  }

  const formatFeatureKey = format === "EXCEL" ? "audit_feat_excel_export" : "audit_feat_pdf_export";
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_reports", formatFeatureKey, "audit_feat_report_field_selector");
  if (disabled) return disabled;

  try {
    const { reportId } = await params;
    const report = getReport(reportId);
    if (!report) return NextResponse.json({ success: false, error: "Report not found" }, { status: 404 });

    let sections: string[];
    const tableColumns: TableColumnSelections = {};
    try {
      sections = resolveSelectedSections(Array.isArray(body.selectedFields) ? body.selectedFields : body.selectedFields === undefined ? undefined : null);

      const rawTableFields = (body.selectedTableFields ?? {}) as Record<string, unknown>;
      for (const tableKey of TABULAR_SECTION_KEYS) {
        if (!sections.includes(tableKey)) continue; // only resolve columns for a table whose section is actually included
        const raw = rawTableFields[tableKey];
        const normalized = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : raw === undefined ? undefined : null;
        (tableColumns as Record<string, string[]>)[tableKey] = resolveSelectedTableFields(tableKey, normalized);
      }
    } catch (error) {
      if (error instanceof ReportFieldSelectionError) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
      }
      throw error;
    }

    const data = buildAuditReportData(report);
    const buffer = format === "EXCEL" ? buildAuditReportExcel(data, sections, tableColumns) : buildAuditReportPdf(data, sections, tableColumns);
    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

    const db = getAuditDatabase();
    const exportId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO audit_report_exports (export_id, report_id, format, selected_fields_json, filter_params_json, file_hash, size_bytes, storage_path, generated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(exportId, reportId, format, JSON.stringify({ sections, tableColumns }), JSON.stringify({}), fileHash, buffer.length, now, OWNER_ACTOR);

    const contentType = format === "EXCEL" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf";
    const extension = format === "EXCEL" ? "xlsx" : "pdf";
    const filename = `internal-review-report-v${report.report_version}.${extension}`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Export-Id": exportId,
        "X-File-Hash": fileHash,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to generate export" }, { status: 500 });
  }
}

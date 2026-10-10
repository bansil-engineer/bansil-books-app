import { NextRequest, NextResponse } from "next/server";
import { getAuditDatabase } from "../../../lib/db/audit-database";
import { syncCommercialTrace } from "../../../lib/audit/commercial-trace-sync-service";
import { syncBankReconciliation } from "../../../lib/audit/bank-reconciliation-sync";
import { syncApprovalPending, syncApprovalPendingDocument, TargetedDocParam } from "../../../lib/audit/approval-pending-sync";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

const activeTargetedSyncs = new Set<string>();
let isGlobalSyncActive = false;

export async function GET(req: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("audit/section-sync", "GET"), "audit/section-sync GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const { searchParams } = new URL(req.url);
    const sectionKey = searchParams.get("sectionKey");

    if (!sectionKey) {
      return NextResponse.json({ error: "sectionKey is required" }, { status: 400 });
    }

    const db = getAuditDatabase();
    const syncState = db.prepare(`SELECT * FROM audit_section_syncs WHERE section_key = ?`).get(sectionKey);

    return NextResponse.json({ syncState: syncState || null });
  } catch (error: any) {
    console.error("Failed to get section sync state", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("audit/section-sync", "POST"), "audit/section-sync POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  let db;
  let sectionKey;

  try {
    const body = await req.json();
    sectionKey = body.sectionKey;
    const period = body.period;
    const targetDoc = body.targetDoc as TargetedDocParam | undefined;

    if (!sectionKey) {
      return NextResponse.json({ error: "sectionKey is required" }, { status: 400 });
    }

    db = getAuditDatabase();

    // ============================================================
    // TARGETED DOCUMENT SMART SYNC
    // ============================================================
    if (targetDoc) {
      // 1. Security Validation
      if (sectionKey !== "APPROVAL_PENDING") {
        return NextResponse.json({ error: "Targeted document sync is currently supported only for APPROVAL_PENDING" }, { status: 400 });
      }

      if (!targetDoc.id || !["PO", "BILL", "INVOICE"].includes(targetDoc.type)) {
        return NextResponse.json({ error: "Invalid target document parameters: type must be PO, BILL, or INVOICE" }, { status: 400 });
      }

      if (!/^[a-zA-Z0-9_\-\.]+$/.test(targetDoc.id)) {
        return NextResponse.json({ error: "Invalid document identifier format" }, { status: 400 });
      }

      // 2. Concurrency checks
      if (isGlobalSyncActive) {
        return NextResponse.json({ error: "Global sync is currently in progress. Please wait before syncing individual documents." }, { status: 409 });
      }

      const existingSection = db.prepare(`SELECT status, started_at FROM audit_section_syncs WHERE section_key = ?`).get(sectionKey) as any;
      if (existingSection && existingSection.status === 'RUNNING') {
        const startedAtTime = new Date(existingSection.started_at).getTime();
        if (Date.now() - startedAtTime < 5 * 60 * 1000) {
          return NextResponse.json({ error: "Global sync is currently running for this section" }, { status: 409 });
        }
      }

      const lockKey = `${targetDoc.type}:${targetDoc.id}`;
      if (activeTargetedSyncs.has(lockKey)) {
        return NextResponse.json({ error: `Sync is already in progress for this document` }, { status: 409 });
      }

      activeTargetedSyncs.add(lockKey);
      try {
        const targetResult = await syncApprovalPendingDocument(targetDoc);
        if (targetResult.status === "FAILED") {
          throw new Error(targetResult.error || "Document sync failed");
        }
        return NextResponse.json({ targetResult });
      } finally {
        activeTargetedSyncs.delete(lockKey);
      }
    }

    // ============================================================
    // GLOBAL SMART SYNC
    // ============================================================
    if (activeTargetedSyncs.size > 0) {
      return NextResponse.json({ error: "An individual document sync is currently in progress. Please wait before running global sync." }, { status: 409 });
    }

    if (isGlobalSyncActive) {
      return NextResponse.json({ error: "A sync is already running for this section" }, { status: 409 });
    }

    // Prevent duplicate syncs, ignoring stale locks older than 5 minutes
    const existing = db.prepare(`SELECT status, started_at FROM audit_section_syncs WHERE section_key = ?`).get(sectionKey) as any;
    if (existing && existing.status === 'RUNNING') {
      const startedAtTime = new Date(existing.started_at).getTime();
      const now = Date.now();
      if (now - startedAtTime < 5 * 60 * 1000) {
        return NextResponse.json({ error: "A sync is already running for this section" }, { status: 409 });
      }
    }

    isGlobalSyncActive = true;
    const startedAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO audit_section_syncs (
        section_key, period_from, period_to, all_periods, started_at, completed_at,
        status, records_checked, records_created, records_updated, records_unchanged, records_failed, last_error
      ) VALUES (?, ?, ?, ?, ?, NULL, 'RUNNING', 0, 0, 0, 0, 0, NULL)
      ON CONFLICT(section_key) DO UPDATE SET
        period_from=excluded.period_from,
        period_to=excluded.period_to,
        all_periods=excluded.all_periods,
        started_at=excluded.started_at,
        status='RUNNING',
        last_error=NULL
    `).run(
      sectionKey,
      period?.customFrom || null,
      period?.customTo || null,
      period?.period === 'ALL_PERIODS' ? 1 : 0,
      startedAt
    );

    // Call actual sync service
    let result = { created: 0, updated: 0, unchanged: 0, failed: 0, checked: 0 };

    if (sectionKey === "COMMERCIAL_TRACE") {
      result = await syncCommercialTrace(period);
    } else if (sectionKey === "BANK") {
      result = await syncBankReconciliation(period);
    } else if (sectionKey === "APPROVAL_PENDING") {
      result = await syncApprovalPending(period);
    } else if (sectionKey === "INVENTORY_STOCK") {
      const { performSmartSync } = await import("../../../lib/smart-sync-engine");
      let financialYearToSync: string | undefined = undefined;
      if (period?.period === 'CURRENT_FY') {
        const { getCurrentFinancialYear } = await import("../../../lib/date-period-utils");
        financialYearToSync = getCurrentFinancialYear();
      } else if (period?.period === 'PREVIOUS_FY') {
        const { getPreviousFinancialYear } = await import("../../../lib/date-period-utils");
        financialYearToSync = getPreviousFinancialYear();
      } else if (period?.period !== 'ALL_PERIODS' && period?.period !== 'ALL_FY' && period?.period !== 'CUSTOM') {
        financialYearToSync = period?.period;
      }

      const smartResult = await performSmartSync({
        mode: "SMART",
        modules: ["stock"],
        financialYear: financialYearToSync,
        fromDate: period?.customFrom,
        toDate: period?.customTo
      });
      if (smartResult.status === "FAILED") {
        throw new Error(smartResult.message);
      }
      result = {
        created: smartResult.totalNew,
        updated: smartResult.totalModified,
        unchanged: smartResult.totalUnchanged,
        failed: 0, // smartResult doesn't bubble row-level failures the same way, but any hard failure throws above
        checked: smartResult.totalChecked,
      };
    } else {
      throw new Error(`Unsupported sectionKey: ${sectionKey}`);
    }

    const completedAt = new Date().toISOString();
    db.prepare(`
      UPDATE audit_section_syncs SET
        completed_at = ?, status = 'SUCCESS', records_checked = ?, records_created = ?,
        records_updated = ?, records_unchanged = ?, records_failed = ?
      WHERE section_key = ?
    `).run(completedAt, result.checked, result.created, result.updated, result.unchanged, result.failed, sectionKey);

    const updatedState = db.prepare(`SELECT * FROM audit_section_syncs WHERE section_key = ?`).get(sectionKey);
    return NextResponse.json({ syncState: updatedState });

  } catch (error: any) {
    console.error(`Sync failed for ${sectionKey}`, error);
    if (db && sectionKey) {
      db.prepare(`
        UPDATE audit_section_syncs SET
          status = 'FAILED', last_error = ?
        WHERE section_key = ?
      `).run(error.message || "Unknown error", sectionKey);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    isGlobalSyncActive = false;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getDatabase as getMainDatabase } from "../../../../../lib/db/database";
import { getAuditDatabase } from "../../../../../lib/db/audit-database";
import { requireFeaturesEnabled } from "../../../../../lib/feature-guard";
import { buildBulkMismatchResolutionContext } from "../../../../../lib/audit/mismatch-resolution/candidate-query";
import { suggestV2Resolutions } from "../../../../../lib/audit/mismatch-resolution/mismatch-suggestion-engine";
import { getCustomerList } from "../../../../../lib/customer-details-engine";
import { getPendingCustomersSummary } from "../../../../../lib/customer-material-control-engine";
export async function POST(request: NextRequest) {
  const disabled = requireFeaturesEnabled("module_audit_workspace", "sub_mismatch_resolution", "mismatch_feat_intelligent_suggestions");
  if (disabled) return disabled;

  try {
    const body = await request.json();
    const { customerId, period, financialYear, fromDate, toDate } = body;

    const mainDb = getMainDatabase();
    const auditDb = getAuditDatabase();

    let targetCustomerIds: string[] = [];

    if (customerId) {
      targetCustomerIds = [customerId];
    } else {
      const pendingSummary = getPendingCustomersSummary(mainDb, { 
        financialYear, 
        period, 
        fromDate, 
        toDate 
      });
      targetCustomerIds = pendingSummary.customers.map((c: any) => c.customer_id);

      if (targetCustomerIds.length === 0) {
        return NextResponse.json({
          customersScanned: 0,
          results: [],
          unresolved: [],
          error: null
        });
      }
    }

    const v2Results: any[] = [];
    const reportSummaries: any[] = [];

    for (const targetId of targetCustomerIds) {
      const bulkContextResult = buildBulkMismatchResolutionContext(mainDb, auditDb, {
        customerId: targetId,
        period,
        financialYear,
        fromDate,
        toDate,
      });

      if (!bulkContextResult.ok) {
        continue;
      }

      if (bulkContextResult.contexts.length > 0) {
        reportSummaries.push(bulkContextResult.contexts[0].reportSummary);
      }

      for (const ctx of bulkContextResult.contexts) {
        let fullCandidates = [...ctx.candidates];
        if (ctx.bomComponents && ctx.bomComponents.length > 0) {
          const bomItemIds = new Set(ctx.bomComponents.map(c => c.itemId));
          fullCandidates = fullCandidates.filter(c => !bomItemIds.has(c.itemId));
          fullCandidates.push(...ctx.bomComponents);
        }

        const suggestion = suggestV2Resolutions(ctx.mismatchItem, fullCandidates, {
          period,
          financialYear,
          fromDate,
          toDate
        });
        v2Results.push(suggestion);
      }
    }

    // Attach decisions
    const allFingerprints = v2Results.flatMap(r => r.groups.map((g: any) => g.evidenceFingerprint));
    if (allFingerprints.length > 0) {
      // Chunk the fingerprints to avoid SQLite limits if there are too many
      const chunkSize = 100;
      const decisionMap = new Map();
      
      for (let i = 0; i < allFingerprints.length; i += chunkSize) {
        const chunk = allFingerprints.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => '?').join(',');
        const rows = auditDb.prepare(`
          SELECT entity_id, decision, created_at
          FROM audit_reviewer_decisions
          WHERE entity_type = 'mismatch_suggestion' 
            AND entity_id IN (${placeholders})
          ORDER BY created_at DESC
        `).all(...chunk) as any[];

        for (const row of rows) {
          if (!decisionMap.has(row.entity_id)) {
            decisionMap.set(row.entity_id, {
              status: row.decision,
              timestamp: row.created_at,
              isStale: false
            });
          }
        }
      }

      for (const r of v2Results) {
        for (const g of r.groups) {
          if (decisionMap.has(g.evidenceFingerprint)) {
            g.reviewerDecision = decisionMap.get(g.evidenceFingerprint);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      reportSummaries,
      suggestions: v2Results,
      truncated: false, 
    });
  } catch (error) {
    console.error("V2 Bulk mismatch resolution error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getAuditDatabase } from "../../../../lib/db/audit-database";

import { randomUUID } from "node:crypto";
import { requireOwnerSession, OWNER_ACTOR } from "@/app/lib/audit/api-guard";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";

export async function POST(req: NextRequest) {
  // 1. OWNER Authorization
  const authResponse = requireOwnerSession(req);
  if (authResponse) return authResponse;

  // 2. Feature Guard
  const disabled = requireFeaturesEnabled("module_audit_workspace", "sub_mismatch_resolution", "mismatch_feat_intelligent_suggestions");
  if (disabled) return disabled;

  try {
    const body = await req.json();
    const {
      suggestionId,
      action,
      reason,
      suggestionData,
      customerData,
    } = body;

    if (body.version === "v2") {
      const { groupId, action, evidenceFingerprint, customerId, periodLabel, sourceItemId, targetType } = body;
      const reviewer = OWNER_ACTOR;

      if (!groupId || !action || !evidenceFingerprint || !targetType) {
        return NextResponse.json({ error: "Missing required fields for V2 decision" }, { status: 400 });
      }

      if (!["TECHNICAL_RELATIONSHIP", "QUANTITY_ONLY_POSSIBILITY"].includes(targetType)) {
        return NextResponse.json({ error: "Invalid V2 targetType" }, { status: 400 });
      }

      if (!["APPROVE", "REJECT", "HOLD", "NEED_EVIDENCE"].includes(action)) {
        return NextResponse.json({ error: "Invalid V2 decision status" }, { status: 400 });
      }
      
      if (action === "APPROVE" && targetType === "QUANTITY_ONLY_POSSIBILITY") {
        return NextResponse.json({ error: "APPROVE is forbidden for quantity-only possibilities" }, { status: 400 });
      }

      const db = getAuditDatabase();
      const decisionId = randomUUID();
      const timestamp = new Date().toISOString();

      const contextJson = JSON.stringify({
        decisionVersion: 2,
        targetType,
        evidenceFingerprint,
        customerId,
        periodLabel,
        sourceItemId,
        action
      });

      db.prepare(
        `INSERT INTO audit_reviewer_decisions 
          (decision_id, entity_type, entity_id, reviewer, role_context, decision, comment, source_run_version_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        decisionId,
        "mismatch_suggestion",
        evidenceFingerprint, // Stable identity, NOT display groupId
        reviewer,
        "OWNER",
        action,
        reason || "",
        contextJson,
        timestamp
      );
      
      return NextResponse.json({ success: true, decisionId });
    }

    // 3. Derive reviewer identity strictly from the session
    const reviewer = OWNER_ACTOR;

    if (!suggestionId || !action || !suggestionData) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = getAuditDatabase();
    
    // We persist the decision in audit_reviewer_decisions
    const decisionId = randomUUID();
    const timestamp = new Date().toISOString();
    
    // Format the context for the JSON column (the remaining 17 fields as requested)
    const contextJson = JSON.stringify({
      selectedResolution: suggestionData.resolutionType,
      customer: customerData,
      period: customerData?.periodLabel,
      sourceItem: suggestionData.mismatchItem,
      targetItems: suggestionData.candidates,
      qtyFormula: suggestionData.quantityFormula,
      matchedQty: suggestionData.matchedQty,
      residualQty: suggestionData.residualQty,
      uomStatus: suggestionData.uom,
      technicalEquivalenceStatus: suggestionData.technicalEquivalence,
      evidenceRefs: suggestionData.evidence,
      timestamp: timestamp,
      decisionVersion: 1,
      action: action, // Store specific action inside the JSON to differentiate one-time vs others
    });

    db.prepare(
      `INSERT INTO audit_reviewer_decisions 
        (decision_id, entity_type, entity_id, reviewer, role_context, decision, comment, source_run_version_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      decisionId,
      "mismatch_suggestion",
      suggestionId,
      reviewer,
      "OWNER",
      action, // The actual string e.g. 'APPROVE', 'REJECT', 'ONE-TIME MAPPING', 'PROPOSE_REUSABLE_RULE'
      reason || "",
      contextJson,
      timestamp
    );

    // If the action involves proposing a rule, we formerly dispatched to learning-service.
    // Learning Proposals feature has been removed.

    return NextResponse.json({ success: true, decisionId });
  } catch (error) {
    console.error("Mismatch Decision Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

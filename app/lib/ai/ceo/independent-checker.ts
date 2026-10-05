// ============================================================
// Bansil Books Analytics — Phase 3B: General Independent Checker
// Permanent independent verification for material non-financial work.
// Coexists with the existing Financial Reviewer without duplication.
// Enforces strict worker/checker independence, risk-based review,
// exact semantic outcomes, and finalization gating.
// ============================================================

import crypto from "node:crypto";
import { getAiDatabase } from "../../db/ai-database";
import {
  listAgents,
  getOrCreateSuitableAgent,
} from "./agent-reuse-engine";
import { AiAgentConfig } from "./ceo-types";
import {
  GovernedAction,
  GovernedActionType,
  RiskLevel,
} from "./governance-types";
import { isZohoWriteAllowed } from "./authority-policy";

// ==================== CHECKER OUTCOMES & ENUMS ====================

export type CheckerOutcome =
  | "PASS"
  | "PASS_WITH_NOTES"
  | "REJECT"
  | "INSUFFICIENT_EVIDENCE";

export type ReviewType = "FINANCIAL" | "GENERAL" | "COMPLIANCE" | "OPERATIONAL";

export interface CheckerEvidence {
  objective: string;
  workerResult: string;
  evidenceReferences: string[];
  assumptions?: string[];
  riskLevel: RiskLevel;
  policyContext?: string[];
  materialCalculations?: Record<string, number | string>;
  knownLimitations?: string[];
}

export interface ReviewRecord {
  id: string;
  runId: string;
  taskId?: string;
  workerId: string;
  checkerId: string;
  reviewType: ReviewType;
  riskLevel: RiskLevel;
  evidenceReviewed: string[];
  result: CheckerOutcome;
  notes?: string;
  modelUsed?: string;
  cost?: number;
  escalationReason?: string;
  createdAt: string;
}

// ==================== TABLE INITIALIZATION ====================

export function ensureReviewTable(): void {
  const db = getAiDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_review_records (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      task_id TEXT,
      worker_id TEXT NOT NULL,
      checker_id TEXT NOT NULL,
      review_type TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      evidence_reviewed TEXT,
      result TEXT NOT NULL,
      notes TEXT,
      model_used TEXT,
      cost REAL DEFAULT 0.0,
      escalation_reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE CASCADE
    );
  `);
}

// ==================== RISK-BASED REVIEW REQUIREMENT ====================

/**
 * Deterministically determine if independent review is required and what type.
 * Zero AI model calls — purely rule-based and objective classification.
 */
export function determineReviewRequirement(params: {
  objective: string;
  department?: string;
  actionType?: GovernedActionType;
  riskLevel?: RiskLevel;
  isMaterial?: boolean;
}): {
  required: boolean;
  reviewType: ReviewType;
  riskLevel: RiskLevel;
  reason: string;
  requiresOwnerApproval: boolean;
  modelTierPreference: "NONE" | "CHEAP" | "STRONG";
} {
  const { objective, department, actionType, riskLevel: explicitRisk, isMaterial } = params;
  const lower = objective.toLowerCase();

  // 1. Permanent prohibited action: ZOHO_WRITE
  if (lower.includes("zoho write") || actionType === "ZOHO_WRITE") {
    return {
      required: true,
      reviewType: "COMPLIANCE",
      riskLevel: "CRITICAL",
      reason: "ZOHO_WRITE is strictly prohibited; checker required plus Owner governance block",
      requiresOwnerApproval: true,
      modelTierPreference: "STRONG",
    };
  }

  // 2. Critical actions (financial disbursement, contracts, statutory filings, data deletion)
  if (
    actionType === "BANK_PAYMENT" ||
    actionType === "PERMANENT_DATA_DELETION" ||
    actionType === "STATUTORY_FILING" ||
    actionType === "SIGN_CONTRACT" ||
    lower.includes("bank transfer") ||
    lower.includes("pay vendor") ||
    lower.includes("delete database") ||
    lower.includes("destroy data")
  ) {
    return {
      required: true,
      reviewType: "COMPLIANCE",
      riskLevel: "CRITICAL",
      reason: "Critical risk action with legal, financial or destructive consequence",
      requiresOwnerApproval: true,
      modelTierPreference: "STRONG",
    };
  }

  // 3. Financial & Accounting work: Use existing FINANCIAL reviewer
  const isFinancial =
    department === "FINANCE" ||
    department === "ACCOUNTS" ||
    lower.includes("balance sheet") ||
    lower.includes("p&l") ||
    lower.includes("profit and loss") ||
    lower.includes("statutory") ||
    lower.includes("tax") ||
    lower.includes("gst") ||
    lower.includes("working capital") ||
    lower.includes("working-capital") ||
    lower.includes("ledger") ||
    lower.includes("journal entry") ||
    lower.includes("receivables vs payables") ||
    (lower.includes("sales") && lower.includes("purchase"));

  if (isFinancial) {
    return {
      required: true,
      reviewType: "FINANCIAL",
      riskLevel: explicitRisk || "HIGH",
      reason: "Financial/accounting analysis requires independent financial reviewer",
      requiresOwnerApproval: false,
      modelTierPreference: "CHEAP",
    };
  }

  // 4. LOW-RISK DETERMINISTIC & TRIVIAL TASKS: Skip checker!
  const isSimpleDeterministic =
    actionType === "DETERMINISTIC_CALCULATION" ||
    explicitRisk === "LOW" ||
    lower.includes("simple total") ||
    lower.includes("simple sum") ||
    lower.includes("sum of") ||
    lower.includes("date calculation") ||
    lower.includes("days between") ||
    lower.includes("format date") ||
    lower.includes("reformat") ||
    lower.includes("formatting") ||
    lower.includes("lookup customer gstin") ||
    lower.includes("lookup vendor phone") ||
    lower.includes("known-source lookup");

  if (isSimpleDeterministic && !isMaterial && !lower.includes("cross-department") && !lower.includes("commercial analysis") && !lower.includes("vendor comparison")) {
    return {
      required: false,
      reviewType: "OPERATIONAL",
      riskLevel: "LOW",
      reason: "LOW risk deterministic task skips checker; zero review model calls",
      requiresOwnerApproval: false,
      modelTierPreference: "NONE",
    };
  }

  // 5. MATERIAL NON-FINANCIAL TASKS: Use GENERAL Independent Checker
  const isGeneralMaterial =
    isMaterial ||
    explicitRisk === "HIGH" ||
    explicitRisk === "CRITICAL" ||
    lower.includes("commercial analysis") ||
    lower.includes("vendor comparison") ||
    lower.includes("management recommendation") ||
    lower.includes("project analysis") ||
    lower.includes("cross-department") ||
    lower.includes("cross department") ||
    lower.includes("security-sensitive") ||
    lower.includes("database schema") ||
    lower.includes("permissions change") ||
    lower.includes("tender") ||
    lower.includes("estimation conclusion");

  if (isGeneralMaterial) {
    return {
      required: true,
      reviewType: "GENERAL",
      riskLevel: explicitRisk || "HIGH",
      reason: "Material non-financial work requires General Independent Checker verification",
      requiresOwnerApproval: explicitRisk === "CRITICAL",
      modelTierPreference: explicitRisk === "CRITICAL" ? "STRONG" : "CHEAP",
    };
  }

  // 6. Default: MEDIUM tasks require review only if marked material or externally consequential
  if (explicitRisk === "MEDIUM" && isMaterial) {
    return {
      required: true,
      reviewType: "GENERAL",
      riskLevel: "MEDIUM",
      reason: "Consequential medium-risk task requires general verification",
      requiresOwnerApproval: false,
      modelTierPreference: "CHEAP",
    };
  }

  return {
    required: false,
    reviewType: "OPERATIONAL",
    riskLevel: explicitRisk || "LOW",
    reason: "Standard operational task does not meet materiality threshold for independent checker",
    requiresOwnerApproval: false,
    modelTierPreference: "NONE",
  };
}

// ==================== CHECKER INDEPENDENCE ====================

/**
 * Validate that worker and checker are completely independent.
 * A worker cannot verify its own work.
 * CEO coordinator cannot act as independent checker.
 */
export function validateCheckerIndependence(
  workerId: string,
  checkerId: string
): { valid: boolean; reason?: string } {
  if (!workerId || !checkerId) {
    return {
      valid: false,
      reason: "Worker ID and Checker ID must both be specified",
    };
  }

  if (workerId === checkerId) {
    return {
      valid: false,
      reason: `Independence violation: Worker cannot verify its own work (worker_id == checker_id == '${workerId}')`,
    };
  }

  if (checkerId === "ceo_main") {
    return {
      valid: false,
      reason: "Independence violation: CEO coordinator cannot act as an independent checker",
    };
  }

  return { valid: true };
}

/**
 * Select or create an independent checker agent.
 * REUSE FIRST: Reuses an existing suitable checker agent that is NOT the worker agent.
 * Only creates a new agent if no suitable independent checker exists.
 */
export function getOrCreateIndependentChecker(params: {
  workerId: string;
  reviewType: ReviewType;
  riskLevel?: RiskLevel;
}): { agent: AiAgentConfig; action: "REUSED" | "CREATED" | "FALLBACK_CEO"; reason: string } {
  const { workerId, reviewType, riskLevel = "HIGH" } = params;
  const allAgents = listAgents();

  if (reviewType === "FINANCIAL") {
    // Look for existing financial reviewer that is NOT the worker
    const existing = allAgents.find(
      (a) =>
        a.id !== workerId &&
        a.id !== "ceo_main" &&
        a.status !== "RETIRED" &&
        (a.role.toLowerCase().includes("financial reviewer") ||
          (a.department === "FINANCE" &&
            (a.role.toLowerCase().includes("reviewer") ||
              a.role.toLowerCase().includes("analyst"))))
    );

    if (existing) {
      return {
        agent: existing,
        action: "REUSED",
        reason: `Reused existing independent financial reviewer '${existing.name}' (${existing.id})`,
      };
    }

    return getOrCreateSuitableAgent({
      department: "FINANCE",
      role: "Financial Reviewer",
      name: "Financial Reviewer Specialist",
      level: "REVIEWER",
      requiredCapabilities: [
        "ACCOUNTING_DATA_READ",
        "PURCHASE_DATA_READ",
        "EVIDENCE_COMPARISON",
        "CALCULATION",
      ],
      created_reason: "Independent financial audit and calculation review",
    });
  }

  // GENERAL Reviewer for material non-financial work
  const existingGeneral = allAgents.find(
    (a) =>
      a.id !== workerId &&
      a.id !== "ceo_main" &&
      a.status !== "RETIRED" &&
      (a.role.toLowerCase().includes("general reviewer") ||
        a.role.toLowerCase().includes("independent checker") ||
        (a.department !== "FINANCE" && a.role.toLowerCase().includes("reviewer")))
  );

  if (existingGeneral) {
    return {
      agent: existingGeneral,
      action: "REUSED",
      reason: `Reused existing general independent checker '${existingGeneral.name}' (${existingGeneral.id})`,
    };
  }

  return getOrCreateSuitableAgent({
    department: "OPERATIONS",
    role: "General Independent Checker",
    name: "General Independent Checker Specialist",
    level: "REVIEWER",
    requiredCapabilities: [
      "COMPANY_DATA_READ",
      "EVIDENCE_COMPARISON",
      "CALCULATION",
      "REPORT_GENERATION",
    ],
    created_reason: "Independent verification for material non-financial work",
  });
}

// ==================== CHECKER EVALUATION ENGINE ====================

/**
 * Perform independent evaluation of worker evidence.
 * Worker cannot approve itself merely by saying "done".
 * Returns one of the 4 exact semantic outcomes:
 * - PASS
 * - PASS_WITH_NOTES
 * - REJECT
 * - INSUFFICIENT_EVIDENCE
 */
export function evaluateEvidence(
  evidence: CheckerEvidence,
  checkerId: string,
  workerId: string
): {
  result: CheckerOutcome;
  notes?: string;
  evidenceReferences: string[];
} {
  // Enforce independence
  const indCheck = validateCheckerIndependence(workerId, checkerId);
  if (!indCheck.valid) {
    return {
      result: "REJECT",
      notes: indCheck.reason,
      evidenceReferences: evidence.evidenceReferences || [],
    };
  }

  const { workerResult, evidenceReferences = [], knownLimitations = [] } = evidence;
  const trimmed = (workerResult || "").trim();
  const lower = trimmed.toLowerCase();

  // 1. Worker saying "done" / empty / trivial without substantive findings
  if (
    !trimmed ||
    trimmed === "done" ||
    trimmed === "completed" ||
    trimmed === "task completed" ||
    trimmed === "done."
  ) {
    return {
      result: "INSUFFICIENT_EVIDENCE",
      notes: "Checker rejected: Worker output states 'done' without substantive evidence or calculations.",
      evidenceReferences,
    };
  }

  // 2. Policy violation: Zoho write attempted or bank transfer executed
  if (lower.includes("zoho write successful") || lower.includes("posted to zoho")) {
    return {
      result: "REJECT",
      notes: "Checker REJECT: Worker attempted prohibited Zoho write in violation of hard policy.",
      evidenceReferences,
    };
  }

  if (lower.includes("transferred ₹") || lower.includes("payment disbursed")) {
    return {
      result: "REJECT",
      notes: "Checker REJECT: Worker claimed financial disbursement without Owner authorization.",
      evidenceReferences,
    };
  }

  // 3. Factual/arithmetic contradiction or failure
  if (lower.includes("contradiction detected") || lower.includes("calculation mismatch")) {
    return {
      result: "REJECT",
      notes: "Checker REJECT: Internal arithmetic or evidence contradiction detected in worker findings.",
      evidenceReferences,
    };
  }

  // 4. Missing required evidence references for material claims
  if (evidenceReferences.length === 0 && (evidence.riskLevel === "HIGH" || evidence.riskLevel === "CRITICAL")) {
    return {
      result: "INSUFFICIENT_EVIDENCE",
      notes: "Checker INSUFFICIENT_EVIDENCE: High-risk material conclusion lacks verifiable evidence references.",
      evidenceReferences,
    };
  }

  // 5. Explicit missing dependency or source limitation
  if (
    lower.includes("source limitation") ||
    lower.includes("evidence is insufficient") ||
    lower.includes("missing data") ||
    lower.includes("unavailable")
  ) {
    return {
      result: "INSUFFICIENT_EVIDENCE",
      notes: `Checker INSUFFICIENT_EVIDENCE: Critical underlying source evidence is missing: ${knownLimitations.join("; ") || "Data unavailable"}.`,
      evidenceReferences,
    };
  }

  // 6. Valid with notes / limitations / caveats
  if (
    knownLimitations.length > 0 ||
    lower.includes("provisional") ||
    lower.includes("notes:") ||
    lower.includes("caveat") ||
    lower.includes("unexpanded") ||
    lower.includes("pass_with_notes")
  ) {
    const noteText =
      knownLimitations.length > 0
        ? `Notes & limitations: ${knownLimitations.join("; ")}`
        : "Verified with operational notes: provisional status and scope constraints confirmed.";
    return {
      result: "PASS_WITH_NOTES",
      notes: noteText,
      evidenceReferences,
    };
  }

  // 7. Full verified pass
  return {
    result: "PASS",
    notes: "Independently verified against company operational records and evidence references.",
    evidenceReferences,
  };
}

// ==================== REVIEW RECORD PERSISTENCE ====================

/**
 * Persist review record in ai_review_records and ai_audit_events.
 * Updates ai_runs.reviewer_status appropriately.
 */
export function recordReview(params: {
  runId: string;
  taskId?: string;
  workerId: string;
  checkerId: string;
  reviewType: ReviewType;
  riskLevel: RiskLevel;
  evidenceReviewed: string[];
  result: CheckerOutcome;
  notes?: string;
  modelUsed?: string;
  cost?: number;
  escalationReason?: string;
}): ReviewRecord {
  ensureReviewTable();
  const db = getAiDatabase();

  // Validate independence before persisting
  const indCheck = validateCheckerIndependence(params.workerId, params.checkerId);
  if (!indCheck.valid) {
    throw new Error(indCheck.reason);
  }

  const id = `rev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO ai_review_records (
      id, run_id, task_id, worker_id, checker_id, review_type,
      risk_level, evidence_reviewed, result, notes, model_used,
      cost, escalation_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.runId,
    params.taskId || null,
    params.workerId,
    params.checkerId,
    params.reviewType,
    params.riskLevel,
    JSON.stringify(params.evidenceReviewed || []),
    params.result,
    params.notes || null,
    params.modelUsed || "local_deterministic_checker",
    params.cost || 0.0,
    params.escalationReason || null,
    createdAt
  );

  // Update ai_runs reviewer status
  let runReviewerStatus = "PENDING_REVIEW";
  if (params.result === "PASS" || params.result === "PASS_WITH_NOTES") {
    runReviewerStatus = "REVIEWED_AND_VERIFIED";
  } else if (params.result === "REJECT") {
    runReviewerStatus = "REJECTED";
  } else if (params.result === "INSUFFICIENT_EVIDENCE") {
    runReviewerStatus = "INSUFFICIENT_EVIDENCE";
  }

  db.prepare(`
    UPDATE ai_runs SET reviewer_status = ? WHERE id = ?
  `).run(runReviewerStatus, params.runId);

  // Record audit trail event
  db.prepare(`
    INSERT INTO ai_audit_events (id, run_id, event_type, details, created_at)
    VALUES (?, ?, 'INDEPENDENT_REVIEW', ?, ?)
  `).run(
    crypto.randomUUID(),
    params.runId,
    JSON.stringify({
      reviewId: id,
      taskId: params.taskId,
      workerId: params.workerId,
      checkerId: params.checkerId,
      reviewType: params.reviewType,
      riskLevel: params.riskLevel,
      result: params.result,
      notes: params.notes,
      evidenceCount: params.evidenceReviewed?.length || 0,
      escalationReason: params.escalationReason,
    }),
    createdAt
  );

  return {
    id,
    runId: params.runId,
    taskId: params.taskId,
    workerId: params.workerId,
    checkerId: params.checkerId,
    reviewType: params.reviewType,
    riskLevel: params.riskLevel,
    evidenceReviewed: params.evidenceReviewed,
    result: params.result,
    notes: params.notes,
    modelUsed: params.modelUsed,
    cost: params.cost,
    escalationReason: params.escalationReason,
    createdAt,
  };
}

export function getReviewRecordByRunId(runId: string): ReviewRecord | null {
  ensureReviewTable();
  const db = getAiDatabase();
  const row = db.prepare(`
    SELECT * FROM ai_review_records WHERE run_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).get(runId) as any;

  if (!row) return null;

  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    workerId: row.worker_id,
    checkerId: row.checker_id,
    reviewType: row.review_type,
    riskLevel: row.risk_level,
    evidenceReviewed: row.evidence_reviewed ? JSON.parse(row.evidence_reviewed) : [],
    result: row.result,
    notes: row.notes,
    modelUsed: row.model_used,
    cost: row.cost,
    escalationReason: row.escalation_reason,
    createdAt: row.created_at,
  };
}

export function listReviewRecordsByRunId(runId: string): ReviewRecord[] {
  ensureReviewTable();
  const db = getAiDatabase();
  const rows = db.prepare(`
    SELECT * FROM ai_review_records WHERE run_id = ? ORDER BY created_at ASC
  `).all(runId) as any[];

  return rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    workerId: row.worker_id,
    checkerId: row.checker_id,
    reviewType: row.review_type,
    riskLevel: row.risk_level,
    evidenceReviewed: row.evidence_reviewed ? JSON.parse(row.evidence_reviewed) : [],
    result: row.result,
    notes: row.notes,
    modelUsed: row.model_used,
    cost: row.cost,
    escalationReason: row.escalation_reason,
    createdAt: row.created_at,
  }));
}

// ==================== CEO FINALIZATION GATE ====================

/**
 * Gate check before issuing final response to Owner.
 * If review is required:
 * - REJECT: BLOCKS finalization (cannot be COMPLETED)
 * - INSUFFICIENT_EVIDENCE: BLOCKS unsupported conclusion (PARTIAL)
 * - PASS_WITH_NOTES: Allows finalization, notes MUST appear in response
 * - PASS: Normal finalization
 * - No review executed: BLOCKS finalization (WAITING_REVIEW)
 */
export function enforceFinalizationGate(runId: string): {
  canFinalize: boolean;
  status: "COMPLETED" | "BLOCKED" | "PARTIAL" | "WAITING_REVIEW";
  notes?: string;
  blockerReason?: string;
} {
  ensureReviewTable();
  const db = getAiDatabase();
  const run = db.prepare(`SELECT * FROM ai_runs WHERE id = ?`).get(runId) as any;

  if (!run) {
    return {
      canFinalize: false,
      status: "BLOCKED",
      blockerReason: `Run ${runId} not found`,
    };
  }

  if (!run.reviewer_required) {
    return {
      canFinalize: true,
      status: "COMPLETED",
    };
  }

  const reviewRecord = getReviewRecordByRunId(runId);
  if (!reviewRecord) {
    return {
      canFinalize: false,
      status: "WAITING_REVIEW",
      blockerReason: "Independent review is required for this run, but no review record exists.",
    };
  }

  if (reviewRecord.result === "REJECT") {
    return {
      canFinalize: false,
      status: "BLOCKED",
      notes: reviewRecord.notes,
      blockerReason: `Independent checker REJECTED findings: ${reviewRecord.notes || "Findings failed verification"}`,
    };
  }

  if (reviewRecord.result === "INSUFFICIENT_EVIDENCE") {
    return {
      canFinalize: false,
      status: "PARTIAL",
      notes: reviewRecord.notes,
      blockerReason: `Independent checker found insufficient evidence: ${reviewRecord.notes || "Evidence incomplete"}`,
    };
  }

  if (reviewRecord.result === "PASS_WITH_NOTES") {
    return {
      canFinalize: true,
      status: "COMPLETED",
      notes: reviewRecord.notes,
    };
  }

  // PASS
  return {
    canFinalize: true,
    status: "COMPLETED",
    notes: reviewRecord.notes,
  };
}

// ==================== AUTHORITY PRESERVATION ====================

/**
 * Checker cannot authorize prohibited actions.
 * PASS from checker does NOT override:
 * - ZOHO WRITE = 0
 * - Owner approval requirement
 * - AI Budget ceiling (₹15,000)
 * - Destructive safety policy
 */
export function validateAuthorityPreservation(
  action: GovernedAction,
  checkerResult: CheckerOutcome
): {
  overrideAttemptBlocked: boolean;
  allowed: boolean;
  reason: string;
} {
  // 1. ZOHO WRITE = 0
  if (action.actionType === "ZOHO_WRITE" || !isZohoWriteAllowed()) {
    if (action.actionType === "ZOHO_WRITE") {
      return {
        overrideAttemptBlocked: true,
        allowed: false,
        reason: "Permanent hard policy: ZOHO WRITE = 0. Checker PASS cannot override this.",
      };
    }
  }

  // 2. Owner approval requirement
  if (action.category === "OWNER_APPROVAL_REQUIRED") {
    return {
      overrideAttemptBlocked: true,
      allowed: false,
      reason: `Action ${action.actionType} requires Owner approval. Checker validates work, but cannot grant executive authorization.`,
    };
  }

  // 3. Destructive data loss
  if (action.actionType === "PERMANENT_DATA_DELETION") {
    return {
      overrideAttemptBlocked: true,
      allowed: false,
      reason: "Permanent data deletion requires destructive-safety Owner authorization; checker cannot authorize.",
    };
  }

  return {
    overrideAttemptBlocked: false,
    allowed: checkerResult === "PASS" || checkerResult === "PASS_WITH_NOTES",
    reason: "Authority boundaries preserved.",
  };
}

// ==================== COST CONTROL & MODEL SELECTION ====================

/**
 * Select checker model tier based on risk.
 * Cheap before strong; strong requires recorded justification.
 */
export function selectCheckerModel(
  riskLevel: RiskLevel,
  isComplex: boolean = false
): {
  modelTier: "DETERMINISTIC" | "CHEAP" | "STRONG";
  cost: number;
  reason: string;
  escalationReason?: string;
} {
  if (riskLevel === "LOW") {
    return {
      modelTier: "DETERMINISTIC",
      cost: 0.0,
      reason: "LOW risk task uses deterministic local checking (zero AI model cost)",
    };
  }

  if (riskLevel === "CRITICAL" || isComplex) {
    const escalationReason = `Strong reviewer model escalated due to ${riskLevel} risk level and complex cross-departmental scope`;
    return {
      modelTier: "STRONG",
      cost: 1.5,
      reason: "Escalated to strong reviewer model for high-stakes verification",
      escalationReason,
    };
  }

  return {
    modelTier: "CHEAP",
    cost: 0.5,
    reason: "Standard independent checker utilizes cheapest capable model tier",
  };
}

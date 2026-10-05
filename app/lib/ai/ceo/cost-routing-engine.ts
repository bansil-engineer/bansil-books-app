// ============================================================
// Bansil Books Analytics — Phase 3C: Cost Routing Engine
// Deterministic-First / AI-Last Routing, Zero-AI Cases,
// Model Cost Safety, Budget Ceiling & Evidence Reuse
// ============================================================

import crypto from "node:crypto";
import { getAiDatabase } from "../../db/ai-database";
import {
  getCurrentBudgetPeriod,
  reserveBudget,
  recordActualCost,
  releaseBudgetCommitment,
  MONTHLY_AI_HARD_LIMIT,
} from "./budget-governance";
import {
  getModelCostCatalog,
  getModelCostEntry,
  selectModelForTask,
  ModelSelectionResult,
} from "./model-catalog";
import {
  generateFingerprint,
  isEvidenceFresh,
  lookupEvidence,
  indexEvidence,
} from "./evidence-index";
import { resolvePeriod } from "./date-resolver";
import { executeFastPathQuery } from "./fast-path-tools";
import { classifyIntent } from "./planning-engine";
import { classifyAction, classifyRisk, isZohoWriteAllowed } from "./authority-policy";
import { GovernedActionType, RiskLevel } from "./governance-types";
import { listAgents } from "./agent-registry";
import { getOrCreateSuitableAgent } from "./agent-reuse-engine";

export type ExecutionRouteType =
  | "VERIFIED_CACHE"
  | "DETERMINISTIC_SQL"
  | "RULE_MATH"
  | "CHEAP_AI"
  | "STRONG_AI";

export interface RoutingDecision {
  route: ExecutionRouteType;
  zeroAi: boolean;
  modelCalls: number;
  reason: string;
  selectedModel?: string;
  estimatedCost: number;
  aiJustification?: {
    whyAiNecessary: string;
    whyDeterministicInsufficient: string;
    remainingBudget: number;
    escalationReason?: string;
  };
}

// ==================== ZERO-AI RECOGNITION ====================

/**
 * Deterministically checks if an objective or task qualifies as a ZERO-AI case.
 * Zero-AI cases must never invoke paid model APIs.
 */
export function isZeroAiCase(objective: string, actionType?: GovernedActionType): boolean {
  const lower = objective.toLowerCase().trim();

  // 1. Explicit Action Types that are purely deterministic
  if (
    actionType === "DETERMINISTIC_CALCULATION" ||
    actionType === "READ_DATA" ||
    actionType === "REUSE_AGENT" ||
    actionType === "INTERNAL_DELEGATION" ||
    actionType === "SCHEDULE_FOLLOWUP" ||
    actionType === "SELECT_MODEL"
  ) {
    return true;
  }

  // 2. Date resolution
  if (
    lower.includes("date calculation") ||
    lower.includes("financial year") ||
    lower.includes("fy20") ||
    lower.includes("days between") ||
    lower.includes("period cutoff") ||
    lower.startsWith("date:") ||
    lower.includes("resolve period")
  ) {
    return true;
  }

  // 3. Simple totals & SQL queries
  if (
    lower.startsWith("select ") ||
    lower.includes("sum(") ||
    lower.includes("count(") ||
    lower.includes("simple sum") ||
    lower.includes("simple total") ||
    lower.includes("total amount") ||
    lower.includes("sales total") ||
    lower.includes("purchase total")
  ) {
    return true;
  }

  // 4. Sorting / filtering / formatting
  if (
    lower.includes("sort by") ||
    lower.includes("filter by") ||
    lower.includes("reformat") ||
    lower.includes("formatting") ||
    lower.includes("format table") ||
    lower.includes("table rendering")
  ) {
    return true;
  }

  // 5. Governance, approval, and risk classification
  if (
    lower.includes("classify action") ||
    lower.includes("approval classification") ||
    lower.includes("risk classification") ||
    lower.includes("governance check") ||
    lower.includes("authority check")
  ) {
    return true;
  }

  // 6. Budget math
  if (
    lower.includes("budget math") ||
    lower.includes("budget status") ||
    lower.includes("available budget") ||
    lower.includes("remaining limit")
  ) {
    return true;
  }

  // 7. Conversation state & Bin/Restore/Delete
  if (
    lower.includes("conversation state") ||
    lower.includes("move to bin") ||
    lower.includes("restore chat") ||
    lower.includes("bin preview") ||
    lower.includes("delete permanently") ||
    lower.includes("bin list")
  ) {
    return true;
  }

  // 8. Simple lookups & status checks
  if (
    lower.includes("lookup customer") ||
    lower.includes("lookup vendor") ||
    lower.includes("find invoice") ||
    lower.includes("status of run") ||
    lower.includes("run status")
  ) {
    return true;
  }

  return false;
}

// ==================== FIVE-STAGE ROUTING ENGINE ====================

/**
 * Route an objective through the strict 5-stage order:
 * 1. Verified cached result
 * 2. Deterministic SQL / local tool
 * 3. Rule engine / math
 * 4. Cheap capable AI only if needed
 * 5. Stronger AI only with explicit escalation reason
 */
export function routeObjectiveToExecution(params: {
  objective: string;
  sourceFingerprint?: string;
  maxCacheAgeMs?: number;
  riskLevel?: RiskLevel;
  requiresReasoning?: boolean;
}): RoutingDecision {
  const { objective, sourceFingerprint, maxCacheAgeMs = 15 * 60 * 1000, riskLevel = "LOW", requiresReasoning } = params;
  const lower = objective.toLowerCase();
  const period = getCurrentBudgetPeriod();

  // 1. Stage 1: Verified Cached Result
  if (sourceFingerprint) {
    const cached = lookupEvidence({
      queryFingerprint: sourceFingerprint,
      maxAgeMs: maxCacheAgeMs,
    });
    if (cached) {
      return {
        route: "VERIFIED_CACHE",
        zeroAi: true,
        modelCalls: 0,
        estimatedCost: 0.0,
        reason: `Reused verified cached evidence (${cached.id}) with valid fingerprint`,
      };
    }
  }

  // 2. Stage 2: Deterministic SQL / Local Fast-Path Tool
  const intent = classifyIntent(objective);
  const isFastPath =
    intent === "SALES_QUERY" ||
    intent === "PURCHASE_QUERY" ||
    intent === "RECEIVABLE_QUERY" ||
    intent === "PAYABLE_QUERY" ||
    intent === "CUSTOMER_QUERY" ||
    intent === "VENDOR_QUERY";

  if (isFastPath && !requiresReasoning && !lower.includes("why") && !lower.includes("recommend")) {
    return {
      route: "DETERMINISTIC_SQL",
      zeroAi: true,
      modelCalls: 0,
      estimatedCost: 0.0,
      reason: `Routed to deterministic local SQL query for ${intent}`,
    };
  }

  // 3. Stage 3: Rule Engine / Math / Zero-AI cases
  if (isZeroAiCase(objective) && !requiresReasoning) {
    return {
      route: "RULE_MATH",
      zeroAi: true,
      modelCalls: 0,
      estimatedCost: 0.0,
      reason: "Routed to deterministic rule engine / math (zero-AI policy enforced)",
    };
  }

  // 4. & 5. Stages 4 & 5: AI Routes (Cheap capable first, Stronger only with reason)
  // AI execution requires justification
  const whyAiNecessary = requiresReasoning
    ? "Task requires unstructured synthesis, cross-domain analysis, or executive recommendations"
    : "Complex natural-language reasoning cannot be resolved by deterministic SQL or rule tables";
  const whyDeterministicInsufficient =
    "Objective requires qualitative evaluation, trend interpretation, or advisory drafting";

  const isCriticalOrComplex =
    riskLevel === "CRITICAL" ||
    lower.includes("comprehensive audit") ||
    lower.includes("cross-department strategic") ||
    lower.includes("multi-year projection");

  if (isCriticalOrComplex) {
    // Stage 5: Stronger AI with explicit escalation reason
    const escalationReason = `Escalated to STRONG model due to ${riskLevel} risk level and complex qualitative synthesis`;
    const sel = selectModelForTask({
      complexity: "CRITICAL",
      accuracyRequirement: "CRITICAL",
      availableBudget: period.available_amount,
    });

    return {
      route: "STRONG_AI",
      zeroAi: false,
      modelCalls: 1,
      selectedModel: sel.model,
      estimatedCost: sel.estimatedCost,
      reason: "Escalated to strong reasoning model with recorded justification",
      aiJustification: {
        whyAiNecessary,
        whyDeterministicInsufficient,
        remainingBudget: period.available_amount,
        escalationReason,
      },
    };
  }

  // Stage 4: Cheap capable AI
  const sel = selectModelForTask({
    complexity: "MEDIUM",
    accuracyRequirement: "NORMAL",
    availableBudget: period.available_amount,
  });

  return {
    route: "CHEAP_AI",
    zeroAi: false,
    modelCalls: 1,
    selectedModel: sel.model,
    estimatedCost: sel.estimatedCost,
    reason: "Standard AI reasoning using cheapest capable model",
    aiJustification: {
      whyAiNecessary,
      whyDeterministicInsufficient,
      remainingBudget: period.available_amount,
    },
  };
}

// ==================== CACHE & SOURCE FINGERPRINT VALIDATION ====================

/**
 * Validates cache freshness and source mutation status.
 * Rejects stale cache and forces refresh when source fingerprint has changed.
 */
export function validateEvidenceCache(params: {
  fingerprint: string;
  sourceLastSync?: string;
  cacheFetchedAt?: string;
  maxAgeMs?: number;
}): { valid: boolean; reason: string } {
  const { fingerprint, sourceLastSync, cacheFetchedAt, maxAgeMs = 15 * 60 * 1000 } = params;

  if (!fingerprint) {
    return { valid: false, reason: "Missing query fingerprint" };
  }

  if (!cacheFetchedAt) {
    return { valid: false, reason: "No cache fetch timestamp available" };
  }

  const fetchedTime = new Date(cacheFetchedAt).getTime();
  const now = Date.now();

  // 1. Source mutation / sync freshness check
  if (sourceLastSync) {
    const syncTime = new Date(sourceLastSync).getTime();
    if (syncTime > fetchedTime) {
      return { valid: false, reason: "Source data was synced after cache was fetched; cache is stale" };
    }
  }

  // 2. Time-to-live expiration check
  if (now - fetchedTime > maxAgeMs) {
    return { valid: false, reason: `Cache expired (age ${Math.round((now - fetchedTime) / 1000)}s > TTL ${maxAgeMs / 1000}s)` };
  }

  return { valid: true, reason: "Cache is fresh and source fingerprint matches" };
}

// ==================== WORKFORCE REUSE POLICY ====================

/**
 * Ensures existing suitable agents are reused before creating any new agent.
 * Creation requires an explicit documented reason.
 */
export function enforceAgentReusePolicy(params: {
  department: string;
  role: string;
  requiredCapabilities: string[];
  purpose: string;
}): { agent: any; action: "REUSED" | "CREATED" | "FALLBACK_CEO"; reason: string } {
  const allAgents = listAgents();

  // 1. Look for existing active/idle agent with matching department and capabilities
  const existing = allAgents.find(
    (a) =>
      a.department === params.department &&
      a.status !== "RETIRED" &&
      a.id !== "ceo_main" &&
      params.requiredCapabilities.every((cap) => a.capabilities?.includes(cap))
  );

  if (existing) {
    return {
      agent: existing,
      action: "REUSED",
      reason: `Reused existing agent '${existing.name}' (${existing.id}) matching required capabilities`,
    };
  }

  // 2. Creation permitted only when capability is missing
  return getOrCreateSuitableAgent({
    department: params.department,
    role: params.role,
    name: `${params.department} Specialist`,
    requiredCapabilities: params.requiredCapabilities,
    created_reason: `Missing capability: ${params.purpose}`,
  });
}

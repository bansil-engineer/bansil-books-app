import { ToolClass } from "./types";
import { getAiDatabase } from "../db/ai-database";

export type ApprovalDecision = "APPROVED" | "REJECTED" | "PENDING";

export interface SafetyCheckResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

/**
 * ZOHO_WRITE must always resolve to BLOCKED unless there is a separately implemented explicit owner-approved exception.
 * For now, 100% blocked.
 */
export function evaluateSafetyGate(toolClass: ToolClass): SafetyCheckResult {
  switch (toolClass) {
    case "READ_ONLY":
      return { allowed: true, requiresApproval: false, reason: "Read-only operations are safe." };
    case "LOCAL_WRITE":
      return { allowed: true, requiresApproval: false, reason: "Local writes are policy-based and logged." };
    case "EXTERNAL_WRITE":
      return { allowed: false, requiresApproval: true, reason: "External writes require human approval." };
    case "HIGH_RISK":
      return { allowed: false, requiresApproval: true, reason: "High risk actions require human approval." };
    case "ZOHO_WRITE":
      return { allowed: false, requiresApproval: false, reason: "ZOHO IS STRICTLY READ ONLY." };
    default:
      return { allowed: false, requiresApproval: true, reason: "Unknown tool class." };
  }
}

export function createPendingApproval(runId: string, actionType: string, summary: string): string {
  const db = getAiDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO ai_approvals (id, run_id, action_type, requested_payload_summary, status, requested_at)
    VALUES (?, ?, ?, ?, 'PENDING', ?)
  `).run(id, runId, actionType, summary, now);

  return id;
}

// ============================================================
// Bansil Books Analytics — Capability Registry
// Central Governed System for Company Capabilities & Safe Role Blueprints
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { getAiDatabase } from "../../db/ai-database.ts";
import type {
  AiCapability,
  AiAgentCapability,
  RoleCapabilityTemplate,
} from "./ceo-types.ts";

/**
 * Hard Deny List: Permanent security invariants that can NEVER be granted to any agent or CEO.
 * Violations trigger immediate hard rejection.
 */
export const HARD_DENIED_CAPABILITIES = Object.freeze([
  "ZOHO_WRITE",
  "PAYMENT_AUTHORITY",
  "BANKING_WRITE",
  "CONTRACT_SIGNING",
  "STATUTORY_FILING",
  "UNRESTRICTED_SQL",
  "UNRESTRICTED_SHELL",
  "ARBITRARY_HTTP_MUTATION",
  "COMPANY_MONEY_DISBURSEMENT",
]);

/**
 * Role Capability Blueprints (Templates only; agents are created dynamically when work requires them).
 */
export const ROLE_CAPABILITY_TEMPLATES: readonly RoleCapabilityTemplate[] = Object.freeze([
  {
    role: "ACCOUNTS_ANALYST",
    department: "ACCOUNTS",
    description: "Financial reconciliations, accounting analysis, and audit support",
    standardCapabilities: [
      "ACCOUNTING_DATA_READ",
      "DOCUMENT_SEARCH",
      "CALCULATION",
      "EVIDENCE_COMPARISON",
    ],
    optionalCapabilities: [
      "SALES_DATA_READ",
      "PURCHASE_DATA_READ",
      "ZOHO_INVOICE_READ",
      "ZOHO_BILL_READ",
      "REPORT_GENERATION",
    ],
    defaultRiskClass: "STANDARD",
  },
  {
    role: "PURCHASE_ANALYST",
    department: "PURCHASE",
    description: "Vendor bills, purchase order verification, and spend analysis",
    standardCapabilities: [
      "PURCHASE_DATA_READ",
      "DOCUMENT_SEARCH",
      "CALCULATION",
      "EVIDENCE_COMPARISON",
    ],
    optionalCapabilities: [
      "INVENTORY_DATA_READ",
      "ZOHO_BILL_READ",
      "ZOHO_PURCHASE_ORDER_READ",
      "REPORT_GENERATION",
    ],
    defaultRiskClass: "STANDARD",
  },
  {
    role: "SALES_ANALYST",
    department: "SALES",
    description: "Customer sales orders, invoices, and revenue breakdown",
    standardCapabilities: [
      "SALES_DATA_READ",
      "DOCUMENT_SEARCH",
      "CALCULATION",
      "EVIDENCE_COMPARISON",
    ],
    optionalCapabilities: [
      "BILLING_DATA_READ",
      "ZOHO_INVOICE_READ",
      "ZOHO_SALES_ORDER_READ",
      "REPORT_GENERATION",
    ],
    defaultRiskClass: "STANDARD",
  },
  {
    role: "AUDIT_REVIEWER",
    department: "QUALITY",
    description: "Discrepancy review, variance verification, and evidence auditing",
    standardCapabilities: [
      "AUDIT_DATABASE_READ",
      "DOCUMENT_SEARCH",
      "EVIDENCE_COMPARISON",
      "REPORT_GENERATION",
    ],
    optionalCapabilities: [
      "ACCOUNTING_DATA_READ",
      "SALES_DATA_READ",
      "PURCHASE_DATA_READ",
    ],
    defaultRiskClass: "STANDARD",
  },
  {
    role: "RESEARCH_SPECIALIST",
    department: "RESEARCH",
    description: "Fact-based secondary research and external industry benchmarks",
    standardCapabilities: [
      "WEB_RESEARCH",
      "DOCUMENT_SEARCH",
      "REPORT_GENERATION",
    ],
    optionalCapabilities: [
      "COMPANY_DATA_READ",
    ],
    defaultRiskClass: "ELEVATED",
  },
  {
    role: "PROJECT_COORDINATOR",
    department: "PROJECTS",
    description: "Project budget tracking, milestone monitoring, and job costing",
    standardCapabilities: [
      "PROJECT_DATA_READ",
      "BILLING_DATA_READ",
      "CALCULATION",
    ],
    optionalCapabilities: [
      "DOCUMENT_SEARCH",
      "REPORT_GENERATION",
    ],
    defaultRiskClass: "STANDARD",
  },
]);

/**
 * Retrieve all registered capabilities from database.
 */
export function listCapabilities(db?: DatabaseSync): AiCapability[] {
  const conn = db || getAiDatabase();
  const rows = conn.prepare(`
    SELECT id, code, name, description, category, risk_class, default_tool_class, active, created_by, created_at, updated_at
    FROM ai_capabilities
    ORDER BY category, code ASC
  `).all() as any[];

  return rows.map(r => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    category: r.category,
    riskClass: r.risk_class,
    defaultToolClass: r.default_tool_class,
    active: r.active === 1,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Get capability by code.
 */
export function getCapabilityByCode(code: string, db?: DatabaseSync): AiCapability | null {
  const conn = db || getAiDatabase();
  const row = conn.prepare(`
    SELECT id, code, name, description, category, risk_class, default_tool_class, active, created_by, created_at, updated_at
    FROM ai_capabilities
    WHERE code = ?
  `).get(code) as any;

  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category,
    riskClass: row.risk_class,
    defaultToolClass: row.default_tool_class,
    active: row.active === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Check if a capability can legally be granted within system security policy.
 */
export function isCapabilityGrantable(code: string, db?: DatabaseSync): { grantable: boolean; reason?: string } {
  const upper = code.toUpperCase().trim();

  // 1. Check hard deny list
  if (HARD_DENIED_CAPABILITIES.includes(upper)) {
    return {
      grantable: false,
      reason: `SECURITY POLICY VIOLATION: Capability '${upper}' is permanently prohibited by server hard policy.`,
    };
  }

  // 2. Additional substring safety check for Zoho write or financial mutation
  if (upper.includes("ZOHO") && (upper.includes("WRITE") || upper.includes("CREATE") || upper.includes("UPDATE") || upper.includes("DELETE") || upper.includes("VOID"))) {
    return {
      grantable: false,
      reason: `SECURITY POLICY VIOLATION: Zoho write operations are strictly blocked under ZOHO WRITE = 0.`,
    };
  }

  if (upper.includes("PAYMENT") || upper.includes("DISBURSE") || upper.includes("BANK_TRANSFER")) {
    return {
      grantable: false,
      reason: `SECURITY POLICY VIOLATION: Company money authority is NOT granted.`,
    };
  }

  // 3. Must exist in registry and be active
  const cap = getCapabilityByCode(upper, db);
  if (!cap) {
    return {
      grantable: false,
      reason: `Unknown capability '${upper}'. Only registered capabilities may be granted.`,
    };
  }

  if (!cap.active) {
    return {
      grantable: false,
      reason: `Capability '${upper}' is currently inactive.`,
    };
  }

  return { grantable: true };
}

/**
 * Get all active capabilities for a specific agent.
 */
export function getAgentCapabilities(agentId: string, db?: DatabaseSync): AiAgentCapability[] {
  const conn = db || getAiDatabase();
  const rows = conn.prepare(`
    SELECT id, agent_id, capability_code, granted_by, source_policy, status, created_at, updated_at
    FROM ai_agent_capabilities
    WHERE agent_id = ? AND status = 'ACTIVE'
    ORDER BY capability_code ASC
  `).all(agentId) as any[];

  return rows.map(r => ({
    id: r.id,
    agentId: r.agent_id,
    capabilityCode: r.capability_code,
    grantedBy: r.granted_by,
    sourcePolicy: r.source_policy,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Check if an agent possesses a specific active capability.
 */
export function hasCapability(agentId: string, capabilityCode: string, db?: DatabaseSync): boolean {
  const conn = db || getAiDatabase();
  const row = conn.prepare(`
    SELECT id FROM ai_agent_capabilities
    WHERE agent_id = ? AND capability_code = ? AND status = 'ACTIVE'
  `).get(agentId, capabilityCode.toUpperCase().trim()) as any;

  return !!row;
}

/**
 * Grant a capability to an agent with full policy validation.
 * Client payloads cannot self-grant or elevate authority.
 */
export function grantCapabilityToAgent(params: {
  agentId: string;
  capabilityCode: string;
  grantedBy: string;
  sourcePolicy?: string;
  db?: DatabaseSync;
}): { success: boolean; error?: string; agentCapability?: AiAgentCapability } {
  const conn = params.db || getAiDatabase();
  const code = params.capabilityCode.toUpperCase().trim();

  // 1. Authoritative security check
  const check = isCapabilityGrantable(code, conn);
  if (!check.grantable) {
    return { success: false, error: check.reason };
  }

  // 2. Validate agent exists
  const agent = conn.prepare(`SELECT id, role, department FROM ai_agents WHERE id = ?`).get(params.agentId) as any;
  if (!agent) {
    return { success: false, error: `Agent '${params.agentId}' does not exist.` };
  }

  // 3. Grant authority check: Only CEO or SYSTEM may grant capabilities
  const grantor = params.grantedBy.trim();
  if (grantor !== "AI_CEO" && grantor !== "ceo_main" && grantor !== "SYSTEM") {
    return {
      success: false,
      error: `Unauthorized grantor '${grantor}'. Only the AI CEO or SYSTEM may grant capabilities.`,
    };
  }

  const nowIso = new Date().toISOString();
  const id = `ac_${params.agentId}_${code.toLowerCase()}_${Date.now()}`;

  // 4. Insert or update existing capability
  const existing = conn.prepare(`
    SELECT id, status FROM ai_agent_capabilities
    WHERE agent_id = ? AND capability_code = ?
  `).get(params.agentId, code) as any;

  if (existing) {
    conn.prepare(`
      UPDATE ai_agent_capabilities
      SET status = 'ACTIVE', granted_by = ?, source_policy = ?, updated_at = ?
      WHERE id = ?
    `).run(grantor, params.sourcePolicy || "CEO_GRANT", nowIso, existing.id);

    return {
      success: true,
      agentCapability: {
        id: existing.id,
        agentId: params.agentId,
        capabilityCode: code,
        grantedBy: grantor,
        sourcePolicy: params.sourcePolicy || "CEO_GRANT",
        status: "ACTIVE",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    };
  }

  conn.prepare(`
    INSERT INTO ai_agent_capabilities (
      id, agent_id, capability_code, granted_by, source_policy, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
  `).run(id, params.agentId, code, grantor, params.sourcePolicy || "CEO_GRANT", nowIso, nowIso);

  return {
    success: true,
    agentCapability: {
      id,
      agentId: params.agentId,
      capabilityCode: code,
      grantedBy: grantor,
      sourcePolicy: params.sourcePolicy || "CEO_GRANT",
      status: "ACTIVE",
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  };
}

/**
 * Revoke a capability from an agent.
 */
export function revokeCapabilityFromAgent(params: {
  agentId: string;
  capabilityCode: string;
  revokedBy: string;
  db?: DatabaseSync;
}): { success: boolean; error?: string } {
  const conn = params.db || getAiDatabase();
  const code = params.capabilityCode.toUpperCase().trim();
  const nowIso = new Date().toISOString();

  const info = conn.prepare(`
    UPDATE ai_agent_capabilities
    SET status = 'REVOKED', updated_at = ?
    WHERE agent_id = ? AND capability_code = ? AND status = 'ACTIVE'
  `).run(nowIso, params.agentId, code);

  if (info.changes === 0) {
    return { success: false, error: `Capability '${code}' was not active for agent '${params.agentId}'.` };
  }

  return { success: true };
}

/**
 * Search existing agents matching a set of required capabilities.
 * Supports the "REUSE EXISTING SUITABLE AGENT FIRST" rule.
 */
export function searchAgentsByCapabilities(
  requiredCapabilities: string[],
  db?: DatabaseSync
): Array<{
  agentId: string;
  agentName: string;
  role: string;
  department: string;
  status: string;
  matchingCapabilities: string[];
  missingCapabilities: string[];
  matchScore: number;
}> {
  const conn = db || getAiDatabase();
  if (requiredCapabilities.length === 0) return [];

  const agents = conn.prepare(`
    SELECT id, name, role, department, status
    FROM ai_agents
    WHERE status = 'ACTIVE'
  `).all() as any[];

  const results: Array<{
    agentId: string;
    agentName: string;
    role: string;
    department: string;
    status: string;
    matchingCapabilities: string[];
    missingCapabilities: string[];
    matchScore: number;
  }> = [];

  for (const agent of agents) {
    const caps = getAgentCapabilities(agent.id, conn).map(c => c.capabilityCode);
    const matching: string[] = [];
    const missing: string[] = [];

    for (const req of requiredCapabilities) {
      if (caps.includes(req.toUpperCase().trim())) {
        matching.push(req);
      } else {
        missing.push(req);
      }
    }

    const matchScore = matching.length / requiredCapabilities.length;
    results.push({
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      department: agent.department,
      status: agent.status,
      matchingCapabilities: matching,
      missingCapabilities: missing,
      matchScore,
    });
  }

  // Sort by highest match score, then ceo_main preferred for executive or existing specialists
  results.sort((a, b) => b.matchScore - a.matchScore);
  return results;
}

/**
 * Get role capability templates.
 */
export function getRoleCapabilityTemplates(): readonly RoleCapabilityTemplate[] {
  return ROLE_CAPABILITY_TEMPLATES;
}

/**
 * Find blueprint template by role name.
 */
export function getRoleCapabilityTemplate(role: string): RoleCapabilityTemplate | null {
  const upper = role.toUpperCase().trim();
  return ROLE_CAPABILITY_TEMPLATES.find(t => t.role.toUpperCase() === upper) || null;
}

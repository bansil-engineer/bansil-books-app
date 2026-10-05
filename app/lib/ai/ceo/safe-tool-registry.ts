// ============================================================
// Bansil Books Analytics — Safe Tool Catalog & Registry
// Typed Tool Metadata, Schemas, Capability Requirements, and Security Classes
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { getAiDatabase } from "../../db/ai-database.ts";
import type { AiToolDefinition, ToolClass } from "./ceo-types.ts";

/**
 * List all registered safe tools from database.
 */
export function listTools(db?: DatabaseSync): AiToolDefinition[] {
  const conn = db || getAiDatabase();
  const rows = conn.prepare(`
    SELECT id, code, name, description, provider, tool_class, required_capabilities,
           allowed_agents, allowed_roles, denied_capabilities, requires_approval,
           active, server_only, timeout_ms, input_schema, output_schema,
           estimated_cost, cost_status, created_at, updated_at
    FROM ai_tools
    ORDER BY tool_class, code ASC
  `).all() as any[];

  return rows.map(r => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    provider: r.provider,
    toolClass: r.tool_class as ToolClass,
    requiredCapabilities: JSON.parse(r.required_capabilities || "[]"),
    allowedAgents: r.allowed_agents ? JSON.parse(r.allowed_agents) : undefined,
    allowedRoles: r.allowed_roles ? JSON.parse(r.allowed_roles) : undefined,
    deniedCapabilities: r.denied_capabilities ? JSON.parse(r.denied_capabilities) : undefined,
    requiresApproval: r.requires_approval === 1,
    active: r.active === 1,
    serverOnly: r.server_only === 1,
    timeoutMs: r.timeout_ms || 30000,
    inputSchema: r.input_schema ? JSON.parse(r.input_schema) : undefined,
    outputSchema: r.output_schema ? JSON.parse(r.output_schema) : undefined,
    estimatedCost: r.estimated_cost || 0.0,
    costStatus: r.cost_status || "FREE",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Get tool by code.
 */
export function getToolByCode(code: string, db?: DatabaseSync): AiToolDefinition | null {
  const conn = db || getAiDatabase();
  const row = conn.prepare(`
    SELECT id, code, name, description, provider, tool_class, required_capabilities,
           allowed_agents, allowed_roles, denied_capabilities, requires_approval,
           active, server_only, timeout_ms, input_schema, output_schema,
           estimated_cost, cost_status, created_at, updated_at
    FROM ai_tools
    WHERE code = ?
  `).get(code) as any;

  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    provider: row.provider,
    toolClass: row.tool_class as ToolClass,
    requiredCapabilities: JSON.parse(row.required_capabilities || "[]"),
    allowedAgents: row.allowed_agents ? JSON.parse(row.allowed_agents) : undefined,
    allowedRoles: row.allowed_roles ? JSON.parse(row.allowed_roles) : undefined,
    deniedCapabilities: row.denied_capabilities ? JSON.parse(row.denied_capabilities) : undefined,
    requiresApproval: row.requires_approval === 1,
    active: row.active === 1,
    serverOnly: row.server_only === 1,
    timeoutMs: row.timeout_ms || 30000,
    inputSchema: row.input_schema ? JSON.parse(row.input_schema) : undefined,
    outputSchema: row.output_schema ? JSON.parse(row.output_schema) : undefined,
    estimatedCost: row.estimated_cost || 0.0,
    costStatus: row.cost_status || "FREE",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Register a new safe tool into the catalog.
 */
export function registerTool(tool: Omit<AiToolDefinition, "id" | "createdAt" | "updatedAt">, db?: DatabaseSync): AiToolDefinition {
  const conn = db || getAiDatabase();
  const nowIso = new Date().toISOString();
  const id = `tool_${tool.code.toLowerCase()}_${Date.now()}`;

  // Hard rule check on tool registration
  if (tool.toolClass === "ZOHO_WRITE") {
    // Registered but must be permanently disabled
    tool.active = false;
  }

  conn.prepare(`
    INSERT INTO ai_tools (
      id, code, name, description, provider, tool_class, required_capabilities,
      allowed_agents, allowed_roles, denied_capabilities, requires_approval,
      active, server_only, timeout_ms, input_schema, output_schema,
      estimated_cost, cost_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    tool.code,
    tool.name,
    tool.description,
    tool.provider,
    tool.toolClass,
    JSON.stringify(tool.requiredCapabilities),
    tool.allowedAgents ? JSON.stringify(tool.allowedAgents) : null,
    tool.allowedRoles ? JSON.stringify(tool.allowedRoles) : null,
    tool.deniedCapabilities ? JSON.stringify(tool.deniedCapabilities) : null,
    tool.requiresApproval ? 1 : 0,
    tool.active ? 1 : 0,
    tool.serverOnly ? 1 : 0,
    tool.timeoutMs || 30000,
    tool.inputSchema ? JSON.stringify(tool.inputSchema) : null,
    tool.outputSchema ? JSON.stringify(tool.outputSchema) : null,
    tool.estimatedCost || 0.0,
    tool.costStatus || "FREE",
    nowIso,
    nowIso
  );

  return {
    ...tool,
    id,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

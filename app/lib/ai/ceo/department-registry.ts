import { getAiDatabase } from "@/app/lib/db/ai-database";
import { AiDepartment } from "./ceo-types";

export interface DepartmentTemplate {
  id: string;
  name: string;
  purpose: string;
  capabilities: string[];
}

export const ALLOWED_DEPARTMENT_TEMPLATES: Record<string, DepartmentTemplate> = {
  EXECUTIVE: {
    id: "EXECUTIVE",
    name: "Executive Office",
    purpose: "Company leadership, strategic direction, and overall workforce governance.",
    capabilities: ["SYSTEM_ORCHESTRATION", "DELEGATION", "BUDGET_MANAGEMENT"],
  },
  ACCOUNTS: {
    id: "ACCOUNTS",
    name: "Accounts & Audit",
    purpose: "Reconciliation, bookkeeping, ledger auditing, tax calculation.",
    capabilities: ["LEDGER_AUDIT", "RECONCILIATION", "TAX_COMPLIANCE", "FINANCIAL_REPORTING"],
  },
  PURCHASE: {
    id: "PURCHASE",
    name: "Procurement & Purchase",
    purpose: "Vendor analysis, bill comparison, rate evaluation, materials.",
    capabilities: ["VENDOR_ANALYSIS", "BILL_VERIFICATION", "RATE_COMPARISON", "PURCHASE_AUDIT"],
  },
  FINANCE: {
    id: "FINANCE",
    name: "Finance",
    purpose: "Financial oversight, modeling, capital planning, and high-level budgeting.",
    capabilities: ["CAPITAL_PLANNING", "CASHFLOW_ANALYSIS", "FINANCIAL_MODELING"],
  },
  SALES: {
    id: "SALES",
    name: "Sales & Commercial",
    purpose: "Customer relations, quotation review, commercial trace, orders.",
    capabilities: ["COMMERCIAL_TRACE", "ORDER_ANALYSIS", "CUSTOMER_RECORDS"],
  },
  ESTIMATION: {
    id: "ESTIMATION",
    name: "Estimation & Costing",
    purpose: "Project cost estimation, BoM breakdown, margin analysis.",
    capabilities: ["BOM_ANALYSIS", "COST_ESTIMATION", "MARGIN_MODELING"],
  },
  PROJECTS: {
    id: "PROJECTS",
    name: "Project Management",
    purpose: "Execution monitoring, delivery scheduling, milestones.",
    capabilities: ["PROJECT_TRACKING", "MILESTONE_VERIFICATION"],
  },
  SITE_EXECUTION: {
    id: "SITE_EXECUTION",
    name: "Site Execution",
    purpose: "On-site operations, dispatch verification, site material control.",
    capabilities: ["SITE_MONITORING", "MATERIAL_DISPATCH_VERIFICATION"],
  },
  BILLING: {
    id: "BILLING",
    name: "Billing & Invoicing",
    purpose: "Client billing, measurement sheet verification, milestone claims.",
    capabilities: ["BILLING_RECONCILIATION", "INVOICE_AUDIT"],
  },
  HR: {
    id: "HR",
    name: "Human Resources",
    purpose: "Talent planning, internal resource allocation, policy compliance.",
    capabilities: ["WORKFORCE_PLANNING", "POLICY_COMPLIANCE"],
  },
  QUALITY: {
    id: "QUALITY",
    name: "Quality & Inspection",
    purpose: "Material standards, testing reports, defect analysis.",
    capabilities: ["QUALITY_ASSURANCE", "SPECIFICATION_COMPLIANCE"],
  },
  INVENTORY: {
    id: "INVENTORY",
    name: "Inventory Management",
    purpose: "Stock tracking, mismatch detection, warehouse coordination.",
    capabilities: ["STOCK_VERIFICATION", "INVENTORY_RECONCILIATION"],
  },
  LEGAL_COMPLIANCE: {
    id: "LEGAL_COMPLIANCE",
    name: "Legal & Compliance",
    purpose: "Statutory rules, regulatory tracking, contractual terms.",
    capabilities: ["STATUTORY_COMPLIANCE", "CONTRACT_VERIFICATION"],
  },
  IT: {
    id: "IT",
    name: "IT & Systems",
    purpose: "Technical infrastructure, software tools, model integrations.",
    capabilities: ["SYSTEMS_MONITORING", "TOOL_INTEGRATION"],
  },
  RESEARCH: {
    id: "RESEARCH",
    name: "Market & Industry Research",
    purpose: "Competitive analysis, vendor intelligence, economic trends.",
    capabilities: ["MARKET_ANALYSIS", "INDUSTRY_BENCHMARKING"],
  },
};

export function getDepartment(id: string): AiDepartment | null {
  const db = getAiDatabase();
  const row = db.prepare(`SELECT * FROM ai_departments WHERE id = ?`).get(id) as Record<string, any> | undefined;
  if (!row) return null;
  return deserializeDepartment(row);
}

export function listDepartments(): AiDepartment[] {
  const db = getAiDatabase();
  const rows = db.prepare(`SELECT * FROM ai_departments ORDER BY name ASC`).all() as Record<string, any>[];
  return rows.map(deserializeDepartment);
}

/**
 * Dynamically retrieve or create a department on demand.
 * If department already exists, reuses it to prevent duplicates.
 * If creating, derives template definition when available.
 * Creation stays within global permissions and cannot grant ZOHO_WRITE.
 */
export function getOrCreateDepartment(
  id: string,
  reason: string = "Dynamic department creation justified by workload requirement",
  createdBy: "CEO" | "SYSTEM" = "CEO"
): { department: AiDepartment; created: boolean } {
  const normalizedId = id.toUpperCase().trim();
  const existing = getDepartment(normalizedId);
  if (existing) {
    return { department: existing, created: false };
  }

  const template = ALLOWED_DEPARTMENT_TEMPLATES[normalizedId];
  const name = template ? template.name : normalizedId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const purpose = template ? template.purpose : `Autonomous department for ${name}`;

  const dept = createDepartment({
    id: normalizedId,
    name,
    purpose,
    status: "ACTIVE",
    created_by: createdBy,
    created_reason: reason,
  });

  return { department: dept, created: true };
}

export function createDepartment(params: {
  id: string;
  name: string;
  purpose: string;
  status?: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  parent_department?: string | null;
  department_head_agent_id?: string | null;
  created_by?: string;
  created_reason: string;
}): AiDepartment {
  const db = getAiDatabase();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO ai_departments (
      id, name, purpose, status, parent_department, department_head_agent_id,
      active_agent_count, current_budget, current_consumption,
      created_by, created_reason, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 0.0, 0.0, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      purpose=excluded.purpose,
      status=excluded.status,
      parent_department=excluded.parent_department,
      department_head_agent_id=excluded.department_head_agent_id,
      updated_at=excluded.updated_at
  `).run(
    params.id,
    params.name,
    params.purpose,
    params.status || "ACTIVE",
    params.parent_department || null,
    params.department_head_agent_id || null,
    params.created_by || "CEO",
    params.created_reason,
    now,
    now
  );

  return getDepartment(params.id)!;
}

export function updateDepartmentBudget(id: string, budgetDelta: number, consumptionDelta: number = 0): boolean {
  const db = getAiDatabase();
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE ai_departments
    SET current_budget = max(0.0, current_budget + ?),
        current_consumption = max(0.0, current_consumption + ?),
        updated_at = ?
    WHERE id = ?
  `).run(budgetDelta, consumptionDelta, now, id);
  return result.changes > 0;
}

function deserializeDepartment(row: Record<string, any>): AiDepartment {
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    status: row.status,
    parent_department: row.parent_department,
    department_head_agent_id: row.department_head_agent_id,
    active_agent_count: Number(row.active_agent_count || 0),
    current_budget: Number(row.current_budget || 0),
    current_consumption: Number(row.current_consumption || 0),
    created_by: row.created_by,
    created_reason: row.created_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

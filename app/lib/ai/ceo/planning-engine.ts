import { AiTask } from "./ceo-types";
import { createTask } from "./task-coordinator";
import { retrieveWorkflowPattern } from "./memory-store";

export type BusinessIntent =
  | "DIRECT_CHAT"
  | "COMPANY_DATA_QUERY"
  | "SALES_QUERY"
  | "PURCHASE_QUERY"
  | "RECEIVABLE_QUERY"
  | "PAYABLE_QUERY"
  | "CUSTOMER_QUERY"
  | "VENDOR_QUERY"
  | "BALANCE_SHEET_ANALYSIS"
  | "PROFIT_AND_LOSS_ANALYSIS"
  | "TRIAL_BALANCE_ANALYSIS"
  | "WORKING_CAPITAL_ANALYSIS"
  | "SALES_PURCHASE_ANALYSIS"
  | "FINANCIAL_ANALYSIS"
  | "BUSINESS_ANALYSIS"
  | "EXECUTION_REQUEST"
  | "MEMORY_GUIDANCE";

export function classifyIntent(message: string): BusinessIntent {
  const lower = message.toLowerCase().trim();

  // Directly requested chats
  const directGreetings = ["hello", "hi", "who are you", "what can you do", "show your ai budget", "what is your status", "how are you"];
  if (directGreetings.some(g => lower === g || lower === g + "?" || lower === g + ".")) {
    return "DIRECT_CHAT";
  }

  // Memory Guidance
  if (lower.startsWith("from now on") || lower.includes("remember that") || lower.includes("always do") || lower.includes("never do") || lower.includes("new rule")) {
    return "MEMORY_GUIDANCE";
  }

  // Common execution verbs take precedence
  const executionVerbs = ["analise", "analyse", "analyze", "analysis", "check", "review", "verify", "study", "compare", "audit"];
  if (executionVerbs.some(kw => lower.includes(kw))) {
    if (lower.includes("balance sheet")) return "BALANCE_SHEET_ANALYSIS";
    if (lower.includes("p&l") || lower.includes("profit and loss") || lower.includes("profit")) return "PROFIT_AND_LOSS_ANALYSIS";
    if (lower.includes("trial balance")) return "TRIAL_BALANCE_ANALYSIS";
    if (lower.includes("working capital")) return "WORKING_CAPITAL_ANALYSIS";
    if (lower.includes("sales vs purchase") || (lower.includes("sales") && lower.includes("purchase"))) return "SALES_PURCHASE_ANALYSIS";
    return "EXECUTION_REQUEST";
  }

  // Specific Financial Sub-Intents (fallback if no explicit execution verb but mentions the concept)
  if (lower.includes("balance sheet")) return "BALANCE_SHEET_ANALYSIS";
  if (lower.includes("p&l") || lower.includes("profit and loss") || lower.includes("profit")) return "PROFIT_AND_LOSS_ANALYSIS";
  if (lower.includes("trial balance")) return "TRIAL_BALANCE_ANALYSIS";
  if (lower.includes("working capital")) return "WORKING_CAPITAL_ANALYSIS";
  if (lower.includes("sales vs purchase") || (lower.includes("sales") && lower.includes("purchase"))) return "SALES_PURCHASE_ANALYSIS";

  // Entity-ranking / Customer-Vendor queries take precedence over generic sales/purchase
  if (lower.includes("customer")) {
    return "CUSTOMER_QUERY";
  }
  if (lower.includes("vendor") || lower.includes("supplier")) {
    return "VENDOR_QUERY";
  }

  // Simple fast-path queries
  if (lower.includes("sale") || lower.includes("sales")) {
    return "SALES_QUERY";
  }
  if (lower.includes("purchse") || lower.includes("purchase") || lower.includes("purchases")) {
    return "PURCHASE_QUERY";
  }
  if (lower.includes("receivable") || lower.includes("recievable")) {
    return "RECEIVABLE_QUERY";
  }
  if (lower.includes("payable")) {
    return "PAYABLE_QUERY";
  }

  // Generic Financial Fallback
  const financialKeywords = [
    "gp", "margin", "gst", "tax", "financial performance"
  ];
  if (financialKeywords.some(kw => lower.includes(kw))) {
    return "FINANCIAL_ANALYSIS";
  }

  // Company Data / Source Status
  const analysisKeywords = ["inventory", "project profitability", "estimation", "tender", "boq", "bom", "commercial terms"];
  if (analysisKeywords.some(kw => lower.includes(kw))) {
    return "BUSINESS_ANALYSIS";
  }

  // Default fallback for unknown queries that might just be conversational
  return "DIRECT_CHAT";
}

// Planning engine with workflow memory pattern reuse.
export function decomposeObjective(objective: string, requestedBy: string, runId: string): AiTask[] {
  // Check CEO Workflow Memory first
  const pattern = retrieveWorkflowPattern(objective);
  if (pattern && pattern.required_roles && pattern.required_roles.length > 0) {
    const parent = createTask({
      objective: `Parent Objective: ${objective}`,
      requested_by: requestedBy,
      priority: "HIGH",
      run_id: runId,
    });

    const roles: string[] = pattern.required_roles || pattern.requiredRoles || [];
    const subtasks = roles.map((role: string) => {
      return createTask({
        parent_task_id: parent.id,
        objective: `Execute ${role} analysis for ${objective}`,
        requested_by: "CEO",
        priority: "HIGH",
        run_id: runId,
      });
    });

    return [parent, ...subtasks];
  }

  const intent = classifyIntent(objective);

  if (intent === "FINANCIAL_ANALYSIS" || intent.endsWith("_ANALYSIS") && intent !== "BUSINESS_ANALYSIS") {
    const parent = createTask({
      objective: `Parent Objective: ${objective}`,
      requested_by: requestedBy,
      priority: "HIGH",
      run_id: runId
    });

    const sub1 = createTask({
      parent_task_id: parent.id,
      objective: `Gather evidence and analyze: ${objective}`,
      department: "ACCOUNTS",
      requested_by: "CEO",
      priority: "HIGH",
      run_id: runId,
      dependencies: [],
    });

    const sub2 = createTask({
      parent_task_id: parent.id,
      objective: "Financial Reviewer verification of accounting equation, assets, liabilities, freshness and limitations",
      department: "FINANCE", // Financial Reviewer
      requested_by: "CEO",
      priority: "HIGH",
      run_id: runId,
      dependencies: [sub1.id],
    });

    parent.dependencies = [sub2.id];
    return [parent, sub1, sub2];
  }

  // Fallback planning logic
  if (objective.toLowerCase().includes("complex") || objective.toLowerCase().includes("profitability") || intent === "BUSINESS_ANALYSIS" || intent === "EXECUTION_REQUEST") {
    const parent = createTask({
      objective: `Parent Objective: ${objective}`,
      requested_by: requestedBy,
      priority: "HIGH",
      run_id: runId
    });

    const sub1 = createTask({
      parent_task_id: parent.id,
      objective: "Gather accounts data",
      department: "ACCOUNTS",
      requested_by: "CEO",
      priority: "HIGH",
      run_id: runId,
      dependencies: [],
    });

    const sub2 = createTask({
      parent_task_id: parent.id,
      objective: "Gather purchase data",
      department: "PURCHASE",
      requested_by: "CEO",
      priority: "HIGH",
      run_id: runId,
      dependencies: [],
    });

    parent.dependencies = [sub1.id, sub2.id];
    return [parent, sub1, sub2];
  }

  // Simple direct execution (fallback for other intents that might end up here)
  return [createTask({
    objective,
    requested_by: requestedBy,
    priority: "MEDIUM",
    run_id: runId,
    dependencies: [],
  })];
}

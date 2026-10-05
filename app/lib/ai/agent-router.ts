import { AgentType } from "./types";

export interface AgentRouteConfig {
  agent: AgentType;
  systemPrompt: string;
  allowedTools: string[];
}

export function routeQueryToAgent(query: string): AgentType {
  const lowerQuery = query.toLowerCase();

  if (lowerQuery.includes("sales") || lowerQuery.includes("invoice") || lowerQuery.includes("customer")) {
    return "SALES_ANALYST";
  }

  if (lowerQuery.includes("purchase") || lowerQuery.includes("bill") || lowerQuery.includes("vendor")) {
    return "PURCHASE_ANALYST";
  }

  if (lowerQuery.includes("p&l") || lowerQuery.includes("profit") || lowerQuery.includes("loss") || lowerQuery.includes("accounts") || lowerQuery.includes("bank") || lowerQuery.includes("reconcile")) {
    return "ACCOUNTS_ANALYST";
  }

  if (lowerQuery.includes("sop") || lowerQuery.includes("company policy") || lowerQuery.includes("internal")) {
    return "COMPANY_KNOWLEDGE";
  }

  if (lowerQuery.includes("search web") || lowerQuery.includes("tender rules") || lowerQuery.includes("latest news") || lowerQuery.includes("google")) {
    return "WEB_RESEARCH";
  }

  if (lowerQuery.includes("project") || lowerQuery.includes("site execution")) {
    return "PROJECT_ANALYST";
  }

  return "GENERAL_ASSISTANT";
}

export const AGENT_CONFIGS: Record<AgentType, AgentRouteConfig> = {
  GENERAL_ASSISTANT: {
    agent: "GENERAL_ASSISTANT",
    systemPrompt: "You are the Bansil Books General AI Assistant. You help run the company.",
    allowedTools: ["calculator", "current_app_data_query"]
  },
  COMPANY_KNOWLEDGE: {
    agent: "COMPANY_KNOWLEDGE",
    systemPrompt: "You are the Company Knowledge AI Assistant. You answer questions about SOPs and company policies.",
    allowedTools: ["company_knowledge_search", "calculator"]
  },
  WEB_RESEARCH: {
    agent: "WEB_RESEARCH",
    systemPrompt: "You are the Web Research AI Assistant. You find information online.",
    allowedTools: ["web_search", "calculator"]
  },
  ACCOUNTS_ANALYST: {
    agent: "ACCOUNTS_ANALYST",
    systemPrompt: "You are the Accounts Analyst AI. You analyze accounting data, P&L, and reconciliations. ZOHO IS STRICTLY READ ONLY.",
    allowedTools: ["audit_database_read", "calculator"]
  },
  SALES_ANALYST: {
    agent: "SALES_ANALYST",
    systemPrompt: "You are the Sales Analyst AI. You analyze sales, invoices, and customers.",
    allowedTools: ["company_database_search", "calculator"]
  },
  PURCHASE_ANALYST: {
    agent: "PURCHASE_ANALYST",
    systemPrompt: "You are the Purchase Analyst AI. You analyze purchases, bills, and vendors.",
    allowedTools: ["company_database_search", "calculator"]
  },
  PROJECT_ANALYST: {
    agent: "PROJECT_ANALYST",
    systemPrompt: "You are the Project Analyst AI. You analyze project status and execution.",
    allowedTools: ["company_database_search", "calculator"]
  }
};

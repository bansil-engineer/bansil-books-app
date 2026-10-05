import { ToolClass } from "./types";

export interface ToolDefinition {
  name: string;
  description: string;
  toolClass: ToolClass;
  execute: (args: any) => Promise<any>;
}

export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  calculator: {
    name: "calculator",
    description: "Evaluates simple math expressions",
    toolClass: "READ_ONLY",
    execute: async (args: { expression: string }) => {
      // Stub implementation
      return { result: "evaluated" };
    }
  },
  company_database_search: {
    name: "company_database_search",
    description: "Search the local Bansil Books database",
    toolClass: "READ_ONLY",
    execute: async (args: { query: string }) => {
      return { result: "data" };
    }
  },
  audit_database_read: {
    name: "audit_database_read",
    description: "Read from the audit workspace DB",
    toolClass: "READ_ONLY",
    execute: async (args: { query: string }) => {
      return { result: "audit data" };
    }
  },
  company_knowledge_search: {
    name: "company_knowledge_search",
    description: "Search SOPs and policies",
    toolClass: "READ_ONLY",
    execute: async (args: { query: string }) => {
      return { result: "knowledge" };
    }
  },
  web_search: {
    name: "web_search",
    description: "Search the web for information",
    toolClass: "READ_ONLY",
    execute: async (args: { query: string }) => {
      return { result: "web results" };
    }
  },
  current_app_data_query: {
    name: "current_app_data_query",
    description: "Query current app data",
    toolClass: "READ_ONLY",
    execute: async (args: { query: string }) => {
      return { result: "app data" };
    }
  }
};

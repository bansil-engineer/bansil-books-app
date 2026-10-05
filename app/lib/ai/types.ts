export type AgentType =
  | "GENERAL_ASSISTANT"
  | "COMPANY_KNOWLEDGE"
  | "WEB_RESEARCH"
  | "ACCOUNTS_ANALYST"
  | "SALES_ANALYST"
  | "PURCHASE_ANALYST"
  | "PROJECT_ANALYST";

export type Role = "user" | "assistant" | "system";

export type ToolClass = "READ_ONLY" | "LOCAL_WRITE" | "EXTERNAL_WRITE" | "HIGH_RISK" | "ZOHO_WRITE";

export interface Message {
  id: string;
  role: Role;
  content: string;
}

export interface AiRunContext {
  conversationId: string;
  messageId: string;
  runId: string;
  agent: AgentType;
  model: string;
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
  agent?: AgentType;
}

export interface ChatResponse {
  response: string;
  conversationId: string;
  runId: string;
  status: "COMPLETED" | "APPROVAL_REQUIRED" | "ERROR";
}

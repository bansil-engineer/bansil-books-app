import { Message } from "../types";

export interface ProviderResponse {
  content: string;
  modelUsed: string;
}

export interface ModelProvider {
  id: string;
  generateResponse(messages: Message[], systemPrompt: string, tools?: any[]): Promise<ProviderResponse>;
}

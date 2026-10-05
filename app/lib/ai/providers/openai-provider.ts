import { ProviderResponse, ModelProvider } from "./provider-interface";
import { Message } from "../types";

export class DummyProvider implements ModelProvider {
  id = "dummy-provider";

  async generateResponse(messages: Message[], systemPrompt: string, tools?: any[]): Promise<ProviderResponse> {
    const lastMessage = messages[messages.length - 1]?.content || "";
    return {
      content: `This is a dummy response for: "\${lastMessage}"`,
      modelUsed: "dummy-model-v1"
    };
  }
}

export class OpenAIProvider implements ModelProvider {
  id = "openai-provider";

  constructor(private apiKey: string | undefined, private model: string) {}

  async generateResponse(messages: Message[], systemPrompt: string, tools?: any[]): Promise<ProviderResponse> {
    if (!this.apiKey) {
      throw new Error("OpenAI API Key is missing. Please configure OPENAI_API_KEY.");
    }

    // Stub implementation to satisfy the interface for Phase 1
    // without requiring immediate real network calls if not needed.
    return {
      content: `Simulated OpenAI response from \${this.model}. System prompt length: \${systemPrompt.length}`,
      modelUsed: this.model
    };
  }
}

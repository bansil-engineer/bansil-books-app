import { ModelProvider } from "./providers/provider-interface";
import { DummyProvider, OpenAIProvider } from "./providers/openai-provider";

export function getModelProvider(): ModelProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  const defaultModel = process.env.AI_DEFAULT_MODEL || "gpt-4o-mini";

  // Phase 1 implementation. Fallback to a dummy provider if no API key is set,
  // or return the OpenAI provider (which will fail gracefully per requirement if we actually try to use it and it errors)
  if (!apiKey) {
      // Actually, requirement says: "If no API key exists, the app must fail gracefully with a useful setup message instead of crashing."
      // The OpenAIProvider constructor accepts undefined, and throws inside generateResponse.
  }

  return new OpenAIProvider(apiKey, defaultModel);
}

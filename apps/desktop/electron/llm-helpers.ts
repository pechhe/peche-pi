/**
 * Shared LLM primitives used by commit-message generation and PR-body
 * generation. Keeps provider config, model-string parsing, and OpenAI-
 * compatible chat completion in one place so higher-level services stay
 * focused on prompt construction and result shaping.
 */

export interface ProviderConfig {
  apiBase: string;
  apiKeyEnv: string;
  modelPrefix?: string;
}

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  "openai-codex": {
    apiBase: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  openai: {
    apiBase: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  anthropic: {
    apiBase: "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  deepseek: {
    apiBase: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  groq: {
    apiBase: "https://api.groq.com/v1",
    apiKeyEnv: "GROQ_API_KEY",
  },
  "google-genai": {
    apiBase: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyEnv: "GOOGLE_API_KEY",
  },
};

export function resolveProviderConfig(
  providerId: string,
): ProviderConfig | undefined {
  return PROVIDER_CONFIGS[providerId];
}

/**
 * Parse a `provider:model` string. Falls back to `openai-codex` when no
 * colon separator is present.
 */
export function parseProviderAndModel(modelString: string): {
  providerId: string;
  modelId: string;
} {
  const colonIndex = modelString.indexOf(":");
  if (colonIndex === -1) {
    return { providerId: "openai-codex", modelId: modelString };
  }
  return {
    providerId: modelString.slice(0, colonIndex),
    modelId: modelString.slice(colonIndex + 1),
  };
}

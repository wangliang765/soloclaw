import type { ModelProviderName } from "./model-client.js";

export type ModelProviderProfile = {
  name: ModelProviderName;
  protocol: "openai_chat" | "anthropic_messages" | "mock";
  defaultBaseUrl?: string;
  defaultModel: string;
  apiKeyEnvNames: string[];
};

export const MODEL_PROVIDER_PROFILES: Record<ModelProviderName, ModelProviderProfile> = {
  mock: {
    name: "mock",
    protocol: "mock",
    defaultModel: "mock",
    apiKeyEnvNames: [],
  },
  openai: {
    name: "openai",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    apiKeyEnvNames: ["OPENAI_API_KEY"],
  },
  anthropic: {
    name: "anthropic",
    protocol: "anthropic_messages",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-haiku-latest",
    apiKeyEnvNames: ["ANTHROPIC_API_KEY"],
  },
  grok: {
    name: "grok",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.3",
    apiKeyEnvNames: ["XAI_API_KEY", "GROK_API_KEY"],
  },
  minimax: {
    name: "minimax",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.minimaxi.com/v1",
    defaultModel: "MiniMax-M2.7",
    apiKeyEnvNames: ["MINIMAX_API_KEY"],
  },
  deepseek: {
    name: "deepseek",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    apiKeyEnvNames: ["DEEPSEEK_API_KEY"],
  },
  glm: {
    name: "glm",
    protocol: "openai_chat",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-5.1",
    apiKeyEnvNames: ["GLM_API_KEY", "ZHIPU_API_KEY", "BIGMODEL_API_KEY"],
  },
  mimo: {
    name: "mimo",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.xiaomimimo.com/v1",
    defaultModel: "mimo-v2.5-pro",
    apiKeyEnvNames: ["MIMO_API_KEY", "XIAOMI_MIMO_API_KEY"],
  },
  openai_compatible: {
    name: "openai_compatible",
    protocol: "openai_chat",
    defaultBaseUrl: "http://localhost:8000/v1",
    defaultModel: "default",
    apiKeyEnvNames: ["OPENAI_COMPATIBLE_API_KEY"],
  },
  anthropic_compatible: {
    name: "anthropic_compatible",
    protocol: "anthropic_messages",
    defaultBaseUrl: "http://localhost:8000/v1",
    defaultModel: "default",
    apiKeyEnvNames: ["ANTHROPIC_COMPATIBLE_API_KEY"],
  },
};

export function modelProviderProfile(name: ModelProviderName): ModelProviderProfile {
  return MODEL_PROVIDER_PROFILES[name];
}

export function defaultModelForProvider(name: ModelProviderName): string {
  return modelProviderProfile(name).defaultModel;
}

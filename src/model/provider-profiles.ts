import type { ModelProviderName } from "./model-client.js";

export type ModelProviderProfile = {
  name: ModelProviderName;
  displayName?: string;
  protocol: "openai_chat" | "openai_responses" | "anthropic_messages" | "mock";
  defaultBaseUrl?: string;
  defaultModel: string;
  apiKeyEnvNames: string[];
  apiKeySecretRef?: string;
  modelIds?: string[];
  docsUrl?: string;
  apiKeysUrl?: string;
  pricingUrl?: string;
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
    displayName: "OpenAI",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    apiKeyEnvNames: ["OPENAI_API_KEY"],
    modelIds: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1", "o4-mini"],
    docsUrl: "https://platform.openai.com/docs/api-reference",
    apiKeysUrl: "https://platform.openai.com/api-keys",
    pricingUrl: "https://platform.openai.com/docs/pricing",
  },
  anthropic: {
    name: "anthropic",
    displayName: "Anthropic Claude",
    protocol: "anthropic_messages",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-haiku-latest",
    apiKeyEnvNames: ["ANTHROPIC_API_KEY"],
    modelIds: ["claude-3-5-haiku-latest", "claude-sonnet-4-5", "claude-opus-4-1"],
    docsUrl: "https://docs.anthropic.com/en/api/messages",
    apiKeysUrl: "https://console.anthropic.com/settings/keys",
    pricingUrl: "https://docs.anthropic.com/en/docs/about-claude/pricing",
  },
  gemini: {
    name: "gemini",
    displayName: "Google Gemini",
    protocol: "openai_chat",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    apiKeyEnvNames: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    modelIds: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    docsUrl: "https://ai.google.dev/gemini-api/docs/openai",
    apiKeysUrl: "https://aistudio.google.com/app/apikey",
    pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  },
  kimi: {
    name: "kimi",
    displayName: "Kimi / Moonshot AI",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.6",
    apiKeyEnvNames: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
    modelIds: ["kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6", "kimi-k2.5", "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    docsUrl: "https://platform.kimi.com/docs",
    apiKeysUrl: "https://platform.kimi.com/console/api-keys",
    pricingUrl: "https://platform.kimi.com/docs/pricing",
  },
  grok: {
    name: "grok",
    displayName: "xAI Grok",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.3",
    apiKeyEnvNames: ["XAI_API_KEY", "GROK_API_KEY"],
    modelIds: ["grok-4.3", "grok-4", "grok-3"],
    docsUrl: "https://docs.x.ai/docs/api-reference",
    apiKeysUrl: "https://console.x.ai",
    pricingUrl: "https://docs.x.ai/docs/models",
  },
  minimax: {
    name: "minimax",
    displayName: "MiniMax",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.minimax.io/v1",
    defaultModel: "MiniMax-M2.7",
    apiKeyEnvNames: ["MINIMAX_API_KEY"],
    modelIds: ["MiniMax-M2.7", "MiniMax-M1", "abab6.5s-chat"],
    docsUrl: "https://platform.minimaxi.com/document",
    apiKeysUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    pricingUrl: "https://platform.minimaxi.com/document/Price",
  },
  deepseek: {
    name: "deepseek",
    displayName: "DeepSeek",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    apiKeyEnvNames: ["DEEPSEEK_API_KEY"],
    modelIds: ["deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"],
    docsUrl: "https://api-docs.deepseek.com/",
    apiKeysUrl: "https://platform.deepseek.com/api_keys",
    pricingUrl: "https://api-docs.deepseek.com/quick_start/pricing",
  },
  glm: {
    name: "glm",
    displayName: "Z.AI GLM",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.z.ai/api/paas/v4",
    defaultModel: "glm-5.2",
    apiKeyEnvNames: ["ZAI_API_KEY", "GLM_API_KEY", "ZHIPU_API_KEY", "BIGMODEL_API_KEY"],
    modelIds: ["glm-5.2", "glm-4.5", "glm-4.5-air", "glm-4.5-flash"],
    docsUrl: "https://docs.z.ai/api-reference/introduction",
    apiKeysUrl: "https://z.ai/manage-apikey/apikey-list",
    pricingUrl: "https://docs.z.ai/guides/llm/glm-4.5",
  },
  qwen: {
    name: "qwen",
    displayName: "Qwen / DashScope",
    protocol: "openai_chat",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    apiKeyEnvNames: ["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
    modelIds: ["qwen-plus", "qwen-max", "qwen-turbo", "qwen3-coder-plus"],
    docsUrl: "https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope",
    apiKeysUrl: "https://bailian.console.aliyun.com/",
    pricingUrl: "https://www.alibabacloud.com/help/en/model-studio/models",
  },
  mimo: {
    name: "mimo",
    displayName: "Xiaomi MiMo",
    protocol: "openai_chat",
    defaultBaseUrl: "https://api.xiaomimimo.com/v1",
    defaultModel: "mimo-v2.5-pro",
    apiKeyEnvNames: ["MIMO_API_KEY", "XIAOMI_MIMO_API_KEY"],
    modelIds: ["mimo-v2.5-pro"],
  },
  openai_compatible: {
    name: "openai_compatible",
    displayName: "Custom OpenAI-compatible",
    protocol: "openai_chat",
    defaultBaseUrl: "http://localhost:8000/v1",
    defaultModel: "default",
    apiKeyEnvNames: ["OPENAI_COMPATIBLE_API_KEY"],
    modelIds: ["default", "qwen-local", "llama-local"],
  },
  anthropic_compatible: {
    name: "anthropic_compatible",
    displayName: "Custom Anthropic-compatible",
    protocol: "anthropic_messages",
    defaultBaseUrl: "http://localhost:8000/v1",
    defaultModel: "default",
    apiKeyEnvNames: ["ANTHROPIC_COMPATIBLE_API_KEY"],
    modelIds: ["default", "claude-local"],
  },
};

export function modelProviderProfile(name: ModelProviderName): ModelProviderProfile {
  return MODEL_PROVIDER_PROFILES[name];
}

export function defaultModelForProvider(name: ModelProviderName): string {
  return modelProviderProfile(name).defaultModel;
}

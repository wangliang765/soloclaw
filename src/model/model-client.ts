import type { AgentMessage, ModelResponse, ToolDefinition } from "../protocol/types.js";

export type ModelProviderName =
  | "openai"
  | "grok"
  | "anthropic"
  | "minimax"
  | "deepseek"
  | "glm"
  | "mimo"
  | "openai_compatible"
  | "anthropic_compatible"
  | "mock";

export type ModelProviderConfig = {
  name: ModelProviderName;
  model: string;
  baseUrl?: string;
  apiKeySecretRef?: string;
  headers?: Record<string, string>;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
};

export type ModelRequest = {
  messages: AgentMessage[];
  tools: ToolDefinition[];
  provider?: ModelProviderConfig;
};

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

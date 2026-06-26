import type { AgentMessage, ModelResponse, ToolDefinition } from "../protocol/types.js";

export type ModelProviderName =
  | "openai"
  | "grok"
  | "anthropic"
  | "gemini"
  | "kimi"
  | "minimax"
  | "deepseek"
  | "glm"
  | "qwen"
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

export type ModelStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call_delta"; callId: string; name?: string; inputDelta?: string }
  | ModelResponse;

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
  streamComplete?(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}

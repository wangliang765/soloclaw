import type { AgentMessage, JsonObject, ModelResponse, ModelResponseMetadata, ModelUsage, ToolCall, ToolDefinition } from "../protocol/types.js";
import type { ModelClient, ModelRequest } from "./model-client.js";

export type ApiKeyResolver = string | (() => Promise<string>);

export type HttpModelClientOptions = {
  baseUrl: string;
  apiKey: ApiKeyResolver;
  defaultModel: string;
  headers?: Record<string, string>;
  maxTokens?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export class TransientModelProviderError extends Error {
  constructor(
    message: string,
    readonly providerKind: "openai_compatible" | "anthropic_compatible",
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "TransientModelProviderError";
  }
}

export class NonRetryableModelProviderError extends Error {
  constructor(
    message: string,
    readonly providerKind: "openai_compatible" | "anthropic_compatible",
    readonly status?: number,
  ) {
    super(message);
    this.name = "NonRetryableModelProviderError";
  }
}

export class OpenAICompatibleChatClient implements ModelClient {
  constructor(private readonly options: HttpModelClientOptions) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const apiKey = await resolveApiKey(this.options.apiKey);
    const response = await fetchWithRetry("openai_compatible", this.options, request.provider, `${trimTrailingSlash(request.provider?.baseUrl ?? this.options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...this.options.headers,
        ...request.provider?.headers,
      },
      body: JSON.stringify({
        model: request.provider?.model ?? this.options.defaultModel,
        messages: toOpenAIMessages(request.messages),
        tools: request.tools.map(toOpenAITool),
        tool_choice: request.tools.length > 0 ? "auto" : "none",
      }),
    });

    const data = (await response.json()) as OpenAIChatCompletionResponse;
    const metadata = openAIResponseMetadata(response, data);
    const message = data.choices?.[0]?.message;
    const toolCalls = message?.tool_calls?.map((call): ToolCall => {
      return {
        id: call.id,
        name: call.function.name,
        input: parseJsonObject(call.function.arguments),
      };
    });

    if (toolCalls && toolCalls.length > 0) {
      return {
        type: "tool_calls",
        content: typeof message?.content === "string" ? message.content : undefined,
        toolCalls,
        metadata,
      };
    }

    return {
      type: "message",
      content: typeof message?.content === "string" ? message.content : "",
      metadata,
    };
  }
}

export class AnthropicCompatibleMessagesClient implements ModelClient {
  constructor(private readonly options: HttpModelClientOptions) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const apiKey = await resolveApiKey(this.options.apiKey);
    const converted = toAnthropicMessages(request.messages);
    const response = await fetchWithRetry("anthropic_compatible", this.options, request.provider, `${trimTrailingSlash(request.provider?.baseUrl ?? this.options.baseUrl)}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        ...this.options.headers,
        ...request.provider?.headers,
      },
      body: JSON.stringify({
        model: request.provider?.model ?? this.options.defaultModel,
        max_tokens: this.options.maxTokens ?? 4096,
        system: converted.system,
        messages: converted.messages,
        tools: request.tools.map(toAnthropicTool),
      }),
    });

    const data = (await response.json()) as AnthropicMessagesResponse;
    const metadata = anthropicResponseMetadata(response, data);
    const toolCalls = data.content
      .filter((block): block is AnthropicToolUseBlock => block.type === "tool_use")
      .map((block): ToolCall => ({ id: block.id, name: block.name, input: block.input }));

    if (toolCalls.length > 0) {
      return {
        type: "tool_calls",
        content: data.content
          .filter((block): block is AnthropicTextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
        toolCalls,
        metadata,
      };
    }

    return {
      type: "message",
      content: data.content
        .filter((block): block is AnthropicTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
      metadata,
    };
  }
}

async function resolveApiKey(apiKey: ApiKeyResolver): Promise<string> {
  return typeof apiKey === "string" ? apiKey : apiKey();
}

async function fetchWithRetry(
  providerKind: "openai_compatible" | "anthropic_compatible",
  options: HttpModelClientOptions,
  provider: ModelRequest["provider"] | undefined,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const maxRetries = provider?.maxRetries ?? options.maxRetries ?? 2;
  const baseDelay = provider?.retryBaseDelayMs ?? options.retryBaseDelayMs ?? 250;
  const maxDelay = provider?.retryMaxDelayMs ?? options.retryMaxDelayMs ?? 2_000;
  const sleep = options.sleep ?? defaultSleep;
  let lastTransient: TransientModelProviderError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) {
        return response;
      }
      const body = await response.text();
      if (!isTransientStatus(response.status)) {
        throw new NonRetryableModelProviderError(`${providerLabel(providerKind)} request failed: ${response.status} ${body}`, providerKind, response.status);
      }
      const retryAfterMs = retryAfterToMs(response.headers.get("retry-after"));
      lastTransient = new TransientModelProviderError(`${providerLabel(providerKind)} transient failure: ${response.status} ${body}`, providerKind, response.status, retryAfterMs);
      if (attempt === maxRetries) {
        throw lastTransient;
      }
      await sleep(delayForAttempt(attempt, baseDelay, maxDelay, retryAfterMs));
    } catch (error) {
      if (error instanceof NonRetryableModelProviderError) {
        throw error;
      }
      if (error instanceof TransientModelProviderError) {
        throw error;
      }
      const transient = new TransientModelProviderError(`${providerLabel(providerKind)} network failure: ${error instanceof Error ? error.message : String(error)}`, providerKind);
      lastTransient = transient;
      if (attempt === maxRetries) {
        throw transient;
      }
      await sleep(delayForAttempt(attempt, baseDelay, maxDelay));
    }
  }

  throw lastTransient ?? new TransientModelProviderError(`${providerLabel(providerKind)} request failed without response`, providerKind);
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function retryAfterToMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined;
}

function delayForAttempt(attempt: number, baseDelay: number, maxDelay: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, maxDelay);
  }
  return Math.min(baseDelay * 2 ** attempt, maxDelay);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerLabel(providerKind: "openai_compatible" | "anthropic_compatible"): string {
  return providerKind === "openai_compatible" ? "OpenAI-compatible" : "Anthropic-compatible";
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function openAIResponseMetadata(response: Response, data: OpenAIChatCompletionResponse): ModelResponseMetadata {
  return compactMetadata({
    providerRequestId: firstHeader(response.headers, ["x-request-id", "request-id", "openai-request-id"]),
    providerResponseId: typeof data.id === "string" ? data.id : undefined,
    providerModel: typeof data.model === "string" ? data.model : undefined,
    usage: openAIUsage(data.usage),
  });
}

function anthropicResponseMetadata(response: Response, data: AnthropicMessagesResponse): ModelResponseMetadata {
  return compactMetadata({
    providerRequestId: firstHeader(response.headers, ["request-id", "x-request-id", "anthropic-request-id"]),
    providerResponseId: typeof data.id === "string" ? data.id : undefined,
    providerModel: typeof data.model === "string" ? data.model : undefined,
    usage: anthropicUsage(data.usage),
  });
}

function firstHeader(headers: Headers, names: string[]): string | undefined {
  for (const name of names) {
    const value = headers.get(name);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function openAIUsage(usage: OpenAIChatCompletionResponse["usage"]): ModelUsage | undefined {
  if (!usage) {
    return undefined;
  }
  return compactUsage({
    promptTokens: finiteNumber(usage.prompt_tokens),
    completionTokens: finiteNumber(usage.completion_tokens),
    totalTokens: finiteNumber(usage.total_tokens),
  });
}

function anthropicUsage(usage: AnthropicMessagesResponse["usage"]): ModelUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const promptTokens = finiteNumber(usage.input_tokens);
  const completionTokens = finiteNumber(usage.output_tokens);
  return compactUsage({
    promptTokens,
    completionTokens,
    totalTokens: promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined,
  });
}

function compactMetadata(metadata: ModelResponseMetadata): ModelResponseMetadata {
  const usage = metadata.usage && Object.keys(metadata.usage).length > 0 ? metadata.usage : undefined;
  return {
    providerRequestId: metadata.providerRequestId,
    providerResponseId: metadata.providerResponseId,
    providerModel: metadata.providerModel,
    usage,
  };
}

function compactUsage(usage: ModelUsage): ModelUsage | undefined {
  const compacted = {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
  };
  return Object.values(compacted).some((value) => value !== undefined) ? compacted : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toOpenAIMessages(messages: AgentMessage[]) {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls?.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.input),
          },
        })),
      };
    }
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolResult.callId,
        content: message.content,
      };
    }
    return {
      role: message.role,
      content: message.content,
    };
  });
}

function toOpenAITool(tool: ToolDefinition) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function toAnthropicMessages(messages: AgentMessage[]) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const nonSystem = messages.filter((message) => message.role !== "system");

  return {
    system,
    messages: nonSystem.map((message) => {
      if (message.role === "tool") {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.toolResult.callId,
              content: message.content,
              is_error: !message.toolResult.ok,
            },
          ],
        };
      }
      if (message.role === "assistant") {
        const content: Array<AnthropicTextBlock | AnthropicToolUseBlock> = [];
        if (message.content) {
          content.push({ type: "text", text: message.content });
        }
        for (const toolCall of message.toolCalls ?? []) {
          content.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input,
          });
        }
        return {
          role: "assistant",
          content,
        };
      }
      return {
        role: "user",
        content: message.content,
      };
    }),
  };
}

function toAnthropicTool(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

function parseJsonObject(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
  } catch {
    return {};
  }
}

type OpenAIChatCompletionResponse = {
  id?: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
};

type AnthropicTextBlock = {
  type: "text";
  text: string;
};

type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: JsonObject;
};

type AnthropicMessagesResponse = {
  id?: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  content: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
};

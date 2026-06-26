import type { AgentMessage, JsonObject, ModelResponse, ModelResponseMetadata, ModelUsage, ToolCall, ToolDefinition } from "../protocol/types.js";
import type { ModelClient, ModelRequest, ModelStreamEvent } from "./model-client.js";

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
    return openAIChatCompletionToModelResponse(response, data);
  }

  async *streamComplete(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
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
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!isEventStreamResponse(response)) {
      yield openAIChatCompletionToModelResponse(response, (await response.json()) as OpenAIChatCompletionResponse);
      return;
    }

    let content = "";
    let providerResponseId: string | undefined;
    let providerModel: string | undefined;
    let usage: ModelUsage | undefined;
    const streamedToolCalls = new Map<number, { id?: string; name?: string; arguments: string }>();
    for await (const data of readSseData(response)) {
      if (data.trim() === "[DONE]") {
        break;
      }
      const chunk = parseOpenAIStreamChunk(data);
      providerResponseId = typeof chunk.id === "string" ? chunk.id : providerResponseId;
      providerModel = typeof chunk.model === "string" ? chunk.model : providerModel;
      usage = openAIUsage(chunk.usage) ?? usage;
      const delta = chunk.choices?.[0]?.delta;
      if (typeof delta?.content === "string" && delta.content) {
        content += delta.content;
        yield { type: "text_delta", text: delta.content };
      }
      for (const toolCall of delta?.tool_calls ?? []) {
        const index = typeof toolCall.index === "number" ? toolCall.index : streamedToolCalls.size;
        const current = streamedToolCalls.get(index) ?? { arguments: "" };
        streamedToolCalls.set(index, {
          id: toolCall.id ?? current.id,
          name: toolCall.function?.name ?? current.name,
          arguments: `${current.arguments}${toolCall.function?.arguments ?? ""}`,
        });
      }
    }

    const metadata = compactMetadata({
      providerRequestId: firstHeader(response.headers, ["x-request-id", "request-id", "openai-request-id"]),
      providerResponseId,
      providerModel,
      usage,
    });
    const toolCalls = [...streamedToolCalls.values()]
      .filter((call) => call.name)
      .map((call, index): ToolCall => ({
        id: call.id ?? `call_${index}`,
        name: call.name ?? "",
        input: parseJsonObject(call.arguments),
      }));
    if (toolCalls.length > 0) {
      yield {
        type: "tool_calls",
        content,
        toolCalls,
        metadata,
      };
      return;
    }
    yield {
      type: "message",
      content,
      metadata,
    };
  }
}

export class OpenAIResponsesClient implements ModelClient {
  constructor(private readonly options: HttpModelClientOptions) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const apiKey = await resolveApiKey(this.options.apiKey);
    const response = await fetchWithRetry("openai_compatible", this.options, request.provider, `${trimTrailingSlash(request.provider?.baseUrl ?? this.options.baseUrl)}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...this.options.headers,
        ...request.provider?.headers,
      },
      body: JSON.stringify({
        model: request.provider?.model ?? this.options.defaultModel,
        input: toOpenAIResponsesInput(request.messages),
        tools: request.tools.map(toOpenAIResponsesTool),
        tool_choice: request.tools.length > 0 ? "auto" : undefined,
      }),
    });

    const data = (await response.json()) as OpenAIResponsesResponse;
    return openAIResponsesToModelResponse(response, data);
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
    return anthropicMessagesToModelResponse(response, data);
  }

  async *streamComplete(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
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
        stream: true,
      }),
    });

    if (!isEventStreamResponse(response)) {
      yield anthropicMessagesToModelResponse(response, (await response.json()) as AnthropicMessagesResponse);
      return;
    }

    let content = "";
    let providerResponseId: string | undefined;
    let providerModel: string | undefined;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    const streamedToolCalls = new Map<number, { id?: string; name?: string; input?: JsonObject; inputJson: string }>();
    for await (const data of readSseData(response)) {
      const chunk = parseAnthropicStreamChunk(data);
      if (chunk.type === "message_start") {
        providerResponseId = typeof chunk.message?.id === "string" ? chunk.message.id : providerResponseId;
        providerModel = typeof chunk.message?.model === "string" ? chunk.message.model : providerModel;
        promptTokens = finiteNumber(chunk.message?.usage?.input_tokens) ?? promptTokens;
        completionTokens = finiteNumber(chunk.message?.usage?.output_tokens) ?? completionTokens;
        continue;
      }
      if (chunk.type === "content_block_start" && chunk.content_block?.type === "tool_use") {
        streamedToolCalls.set(chunk.index, {
          id: chunk.content_block.id,
          name: chunk.content_block.name,
          input: chunk.content_block.input,
          inputJson: "",
        });
        continue;
      }
      if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta" && typeof chunk.delta.text === "string") {
        content += chunk.delta.text;
        yield { type: "text_delta", text: chunk.delta.text };
        continue;
      }
      if (chunk.type === "content_block_delta" && chunk.delta?.type === "input_json_delta" && typeof chunk.delta.partial_json === "string") {
        const index = typeof chunk.index === "number" ? chunk.index : streamedToolCalls.size;
        const current = streamedToolCalls.get(index) ?? { inputJson: "" };
        streamedToolCalls.set(index, {
          ...current,
          inputJson: `${current.inputJson}${chunk.delta.partial_json}`,
        });
        if (current.id) {
          yield { type: "tool_call_delta", callId: current.id, name: current.name, inputDelta: chunk.delta.partial_json };
        }
        continue;
      }
      if (chunk.type === "message_delta") {
        completionTokens = finiteNumber(chunk.usage?.output_tokens) ?? completionTokens;
        continue;
      }
      if (chunk.type === "message_stop") {
        break;
      }
    }

    const metadata = compactMetadata({
      providerRequestId: firstHeader(response.headers, ["request-id", "x-request-id", "anthropic-request-id"]),
      providerResponseId,
      providerModel,
      usage: compactUsage({
        promptTokens,
        completionTokens,
        totalTokens: promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined,
      }),
    });
    const toolCalls = [...streamedToolCalls.values()]
      .filter((call) => call.name)
      .map((call, index): ToolCall => ({
        id: call.id ?? `call_${index}`,
        name: call.name ?? "",
        input: call.inputJson ? parseJsonObject(call.inputJson) : call.input ?? {},
      }));
    if (toolCalls.length > 0) {
      yield {
        type: "tool_calls",
        content,
        toolCalls,
        metadata,
      };
      return;
    }

    yield {
      type: "message",
      content,
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

function openAIResponsesMetadata(response: Response, data: OpenAIResponsesResponse): ModelResponseMetadata {
  return compactMetadata({
    providerRequestId: firstHeader(response.headers, ["x-request-id", "request-id", "openai-request-id"]),
    providerResponseId: typeof data.id === "string" ? data.id : undefined,
    providerModel: typeof data.model === "string" ? data.model : undefined,
    usage: openAIResponsesUsage(data.usage),
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

function openAIChatCompletionToModelResponse(response: Response, data: OpenAIChatCompletionResponse): ModelResponse {
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

function openAIResponsesToModelResponse(response: Response, data: OpenAIResponsesResponse): ModelResponse {
  const metadata = openAIResponsesMetadata(response, data);
  const output = Array.isArray(data.output) ? data.output : [];
  const toolCalls = output
    .filter((item): item is OpenAIResponsesFunctionCall => item.type === "function_call")
    .map((item, index): ToolCall => ({
      id: item.call_id ?? item.id ?? `call_${index}`,
      name: item.name ?? "",
      input: parseJsonObject(item.arguments ?? "{}"),
    }))
    .filter((call) => call.name.length > 0);
  const content = extractOpenAIResponsesText(data);

  if (toolCalls.length > 0) {
    return {
      type: "tool_calls",
      content,
      toolCalls,
      metadata,
    };
  }

  return {
    type: "message",
    content,
    metadata,
  };
}

function anthropicMessagesToModelResponse(response: Response, data: AnthropicMessagesResponse): ModelResponse {
  const metadata = anthropicResponseMetadata(response, data);
  const toolCalls = data.content
    .filter((block): block is AnthropicToolUseBlock => block.type === "tool_use")
    .map((block): ToolCall => ({ id: block.id, name: block.name, input: block.input }));
  const content = data.content
    .filter((block): block is AnthropicTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  if (toolCalls.length > 0) {
    return {
      type: "tool_calls",
      content,
      toolCalls,
      metadata,
    };
  }

  return {
    type: "message",
    content,
    metadata,
  };
}

function isEventStreamResponse(response: Response): boolean {
  return response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") === true;
}

async function* readSseData(response: Response): AsyncIterable<string> {
  if (!response.body) {
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    yield* drainSseBuffer(buffer, (next) => {
      buffer = next;
    });
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const data of sseBlockData(buffer)) {
      yield data;
    }
  }
}

function* drainSseBuffer(buffer: string, updateBuffer: (value: string) => void): Iterable<string> {
  let current = buffer;
  while (true) {
    const separator = current.search(/\r?\n\r?\n/);
    if (separator < 0) {
      updateBuffer(current);
      return;
    }
    const block = current.slice(0, separator);
    const separatorLength = current.slice(separator).startsWith("\r\n\r\n") ? 4 : 2;
    current = current.slice(separator + separatorLength);
    for (const data of sseBlockData(block)) {
      yield data;
    }
  }
}

function sseBlockData(block: string): string[] {
  const dataLines = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());
  return dataLines.length > 0 ? [dataLines.join("\n")] : [];
}

function parseOpenAIStreamChunk(value: string): OpenAIChatCompletionChunk {
  return JSON.parse(value) as OpenAIChatCompletionChunk;
}

function parseAnthropicStreamChunk(value: string): AnthropicMessagesStreamChunk {
  return JSON.parse(value) as AnthropicMessagesStreamChunk;
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

function openAIResponsesUsage(usage: OpenAIResponsesResponse["usage"]): ModelUsage | undefined {
  if (!usage) {
    return undefined;
  }
  return compactUsage({
    promptTokens: finiteNumber(usage.input_tokens),
    completionTokens: finiteNumber(usage.output_tokens),
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

function toOpenAIResponsesInput(messages: AgentMessage[]): unknown[] {
  const input: unknown[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.toolResult.callId,
        output: message.content,
      });
      continue;
    }
    if (message.role === "assistant") {
      if (message.content) {
        input.push({
          role: "assistant",
          content: message.content,
        });
      }
      for (const toolCall of message.toolCalls ?? []) {
        input.push({
          type: "function_call",
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.input),
        });
      }
      continue;
    }
    input.push({
      role: message.role,
      content: message.content,
    });
  }
  return input;
}

function toOpenAIResponsesTool(tool: ToolDefinition) {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
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

function extractOpenAIResponsesText(data: OpenAIResponsesResponse): string {
  if (typeof data.output_text === "string") {
    return data.output_text;
  }
  const parts: string[] = [];
  for (const item of data.output ?? []) {
    if (isOpenAIResponsesMessageOutput(item)) {
      for (const block of item.content ?? []) {
        const text = textFromResponsesContent(block);
        if (text) {
          parts.push(text);
        }
      }
      continue;
    }
    if (isOpenAIResponsesTextOutput(item) && typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  return parts.join("\n");
}

function isOpenAIResponsesMessageOutput(item: OpenAIResponsesOutputItem): item is OpenAIResponsesMessageOutput {
  return item.type === "message";
}

function isOpenAIResponsesTextOutput(item: OpenAIResponsesOutputItem): item is OpenAIResponsesTextOutput {
  return item.type === "output_text";
}

function textFromResponsesContent(block: OpenAIResponsesMessageContent): string | undefined {
  if (typeof block.text === "string") {
    return block.text;
  }
  if (typeof block.output_text === "string") {
    return block.output_text;
  }
  return undefined;
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

type OpenAIChatCompletionChunk = {
  id?: string;
  model?: string;
  usage?: OpenAIChatCompletionResponse["usage"];
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
};

type OpenAIResponsesMessageContent = {
  type?: string;
  text?: string;
  output_text?: string;
};

type OpenAIResponsesFunctionCall = {
  type: "function_call";
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
};

type OpenAIResponsesMessageOutput = {
  type: "message";
  content?: OpenAIResponsesMessageContent[];
};

type OpenAIResponsesTextOutput = {
  type: "output_text";
  text?: string;
};

type OpenAIResponsesOutputItem = OpenAIResponsesFunctionCall | OpenAIResponsesMessageOutput | OpenAIResponsesTextOutput | { type?: string };

type OpenAIResponsesResponse = {
  id?: string;
  model?: string;
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  output?: OpenAIResponsesOutputItem[];
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

type AnthropicMessagesStreamChunk =
  | {
      type: "message_start";
      message?: {
        id?: string;
        model?: string;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
        };
      };
    }
  | {
      type: "content_block_start";
      index: number;
      content_block?: {
        type?: "tool_use" | "text";
        id?: string;
        name?: string;
        input?: JsonObject;
      };
    }
  | {
      type: "content_block_delta";
      index?: number;
      delta?: {
        type?: "text_delta" | "input_json_delta";
        text?: string;
        partial_json?: string;
      };
    }
  | { type: "content_block_stop"; index?: number }
  | {
      type: "message_delta";
      usage?: {
        output_tokens?: number;
      };
    }
  | { type: "message_stop" };

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Redactor } from "../secrets/redactor.js";
import { BasicRedactor } from "../secrets/basic-redactor.js";
import type {
  McpCapabilitySnapshot,
  McpReadResourceInput,
  McpReadResourceResult,
  McpRuntime,
  McpRuntimeConnectInput,
  McpRuntimeConnection,
  McpToolCallInput,
  McpToolCallResult,
  McpToolDescriptor,
  McpResourceDescriptor,
} from "./mcp-runtime.js";

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: {
    code?: number | string;
    message?: string;
    data?: unknown;
  };
};

type StdioConnectionState = {
  kind: "stdio";
  process: ChildProcessWithoutNullStreams;
  buffer: string;
  pending: Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>;
};

type HttpConnectionState = {
  kind: "http";
  url: string;
};

type ConnectionState = {
  connection: McpRuntimeConnection;
  state: StdioConnectionState | HttpConnectionState;
};

export type LocalMcpRuntimeOptions = {
  redactor?: Redactor;
  maxOutputChars?: number;
  defaultTimeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;

export class LocalMcpRuntime implements McpRuntime {
  private readonly connections = new Map<string, ConnectionState>();
  private nextConnectionId = 1;
  private nextRequestId = 1;
  private readonly redactor: Redactor;
  private readonly maxOutputChars: number;
  private readonly defaultTimeoutMs: number;

  constructor(options: LocalMcpRuntimeOptions = {}) {
    this.redactor = options.redactor ?? new BasicRedactor();
    this.maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async connect(input: McpRuntimeConnectInput): Promise<McpRuntimeConnection> {
    await this.registerEnvSecrets(input.env ?? {});
    const connection: McpRuntimeConnection = {
      connectionId: `mcp_conn_${this.nextConnectionId++}`,
      server: input.server,
      connectedAt: new Date().toISOString(),
      capabilities: input.server.capabilities,
      metadata: {
        transport: input.server.transport,
        projectId: input.projectId,
        roomId: input.roomId,
        sessionId: input.sessionId,
        envVarNames: input.server.envVarNames,
      },
    };
    const state = input.server.transport === "stdio"
      ? await this.connectStdio(input, connection)
      : await this.connectHttp(input, connection);
    this.connections.set(connection.connectionId, { connection, state });
    try {
      await this.request(connection.connectionId, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "agent-blueprint-local-mcp-runtime",
          version: "0.1.0",
        },
      }, input.timeoutMs);
    } catch (error) {
      await this.disconnect(connection.connectionId);
      throw error;
    }
    return connection;
  }

  async listCapabilities(connectionId: string): Promise<McpCapabilitySnapshot> {
    const connection = this.requireConnection(connectionId).connection;
    const [toolResult, resourceResult] = await Promise.all([
      connection.capabilities.includes("tools") ? this.request(connectionId, "tools/list", {}) : Promise.resolve({}),
      connection.capabilities.includes("resources") ? this.request(connectionId, "resources/list", {}) : Promise.resolve({}),
    ]);
    return {
      tools: parseTools(toolResult),
      resources: parseResources(resourceResult),
      prompts: [],
      sampling: connection.capabilities.includes("sampling"),
    };
  }

  async callTool(input: McpToolCallInput): Promise<McpToolCallResult> {
    this.requireConnection(input.connectionId);
    const result = await this.request(input.connectionId, "tools/call", {
      name: input.name,
      arguments: input.input,
    }, input.timeoutMs);
    const parsed = parseToolCallResult(result);
    const output = parsed.output ? await this.safeOutput(parsed.output) : undefined;
    return {
      ok: parsed.ok,
      output: output?.text,
      data: parsed.data,
      error: parsed.error,
      metadata: {
        redactions: output?.redactions ?? [],
        truncated: output?.truncated ?? false,
      },
    };
  }

  async readResource(input: McpReadResourceInput): Promise<McpReadResourceResult> {
    this.requireConnection(input.connectionId);
    const result = await this.request(input.connectionId, "resources/read", { uri: input.uri }, input.timeoutMs);
    const parsed = parseReadResourceResult(input.uri, result);
    const safeText = parsed.text ? await this.safeOutput(parsed.text) : undefined;
    return {
      uri: parsed.uri,
      mimeType: parsed.mimeType,
      text: safeText?.text,
      blob: parsed.blob,
      metadata: {
        ...parsed.metadata,
        redactions: safeText?.redactions ?? [],
        truncated: safeText?.truncated ?? false,
      },
    };
  }

  async disconnect(connectionId: string): Promise<void> {
    const record = this.connections.get(connectionId);
    if (!record) {
      return;
    }
    this.connections.delete(connectionId);
    if (record.state.kind === "stdio") {
      for (const pending of record.state.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`MCP connection closed: ${connectionId}`));
      }
      record.state.pending.clear();
      record.state.process.kill();
    }
  }

  private async connectStdio(input: McpRuntimeConnectInput, connection: McpRuntimeConnection): Promise<StdioConnectionState> {
    if (!input.server.command) {
      throw new Error(`MCP stdio server ${input.server.id} requires command.`);
    }
    const child = spawn(input.server.command, input.server.args ?? [], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(input.env ?? {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const state: StdioConnectionState = {
      kind: "stdio",
      process: child,
      buffer: "",
      pending: new Map(),
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.consumeStdioOutput(connection.connectionId, state, chunk);
    });
    child.stderr.on("data", () => {
      // Stderr is intentionally not surfaced as metadata to avoid leaking server secrets.
    });
    child.on("error", (error) => {
      this.rejectAll(state, error);
    });
    child.on("exit", (code, signal) => {
      this.rejectAll(state, new Error(`MCP stdio server exited: code=${code ?? "-"} signal=${signal ?? "-"}`));
      this.connections.delete(connection.connectionId);
    });
    return state;
  }

  private async connectHttp(input: McpRuntimeConnectInput, _connection: McpRuntimeConnection): Promise<HttpConnectionState> {
    if (!input.server.url) {
      throw new Error(`MCP HTTP server ${input.server.id} requires url.`);
    }
    return {
      kind: "http",
      url: input.server.url,
    };
  }

  private async request(connectionId: string, method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const record = this.requireConnection(connectionId);
    const id = this.nextRequestId++;
    if (record.state.kind === "stdio") {
      return this.stdioRequest(record.state, id, method, params, timeoutMs);
    }
    return this.httpRequest(record.state, id, method, params, timeoutMs);
  }

  private async stdioRequest(state: StdioConnectionState, id: number, method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const timeout = timeoutMs ?? this.defaultTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, timeout);
      state.pending.set(id, { resolve, reject, timer });
      state.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, "utf8", (error) => {
        if (error) {
          clearTimeout(timer);
          state.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private async httpRequest(state: HttpConnectionState, id: number, method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const timeout = timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(state.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`MCP HTTP request failed: ${response.status}`);
      }
      const json = JSON.parse(text) as JsonRpcResponse;
      return parseJsonRpcResponse(json, method);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`MCP request timed out: ${method}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private consumeStdioOutput(_connectionId: string, state: StdioConnectionState, chunk: string): void {
    state.buffer += chunk;
    while (true) {
      const newline = state.buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = state.buffer.slice(0, newline).trim();
      state.buffer = state.buffer.slice(newline + 1);
      if (!line) {
        continue;
      }
      let message: JsonRpcResponse;
      try {
        message = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue;
      }
      const id = typeof message.id === "number" ? message.id : undefined;
      if (id === undefined) {
        continue;
      }
      const pending = state.pending.get(id);
      if (!pending) {
        continue;
      }
      clearTimeout(pending.timer);
      state.pending.delete(id);
      try {
        pending.resolve(parseJsonRpcResponse(message, `request:${id}`));
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private rejectAll(state: StdioConnectionState, error: Error): void {
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    state.pending.clear();
  }

  private requireConnection(connectionId: string): ConnectionState {
    const record = this.connections.get(connectionId);
    if (!record) {
      throw new Error(`MCP connection not found: ${connectionId}`);
    }
    return record;
  }

  private async registerEnvSecrets(env: Record<string, string>): Promise<void> {
    for (const [name, value] of Object.entries(env)) {
      await this.redactor.registerKnownSecret(name, value);
    }
  }

  private async safeOutput(value: string): Promise<{ text: string; redactions: unknown[]; truncated: boolean }> {
    const truncated = value.length > this.maxOutputChars;
    const bounded = truncated ? `${value.slice(0, this.maxOutputChars)}\n[truncated]` : value;
    const redacted = await this.redactor.redact(bounded);
    return { text: redacted.text, redactions: redacted.redactions, truncated };
  }
}

function parseJsonRpcResponse(response: JsonRpcResponse, method: string): unknown {
  if (response.error) {
    throw new Error(`MCP ${method} failed: ${response.error.message ?? response.error.code ?? "unknown error"}`);
  }
  return response.result ?? {};
}

function parseTools(value: unknown): McpToolDescriptor[] {
  const tools = isRecord(value) && Array.isArray(value.tools) ? value.tools : [];
  return tools.filter(isRecord).map((tool) => ({
    name: typeof tool.name === "string" ? tool.name : "",
    description: typeof tool.description === "string" ? tool.description : undefined,
    inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : undefined,
    risk: typeof tool.risk === "string" ? tool.risk : undefined,
  })).filter((tool) => tool.name.length > 0);
}

function parseResources(value: unknown): McpResourceDescriptor[] {
  const resources = isRecord(value) && Array.isArray(value.resources) ? value.resources : [];
  return resources.filter(isRecord).map((resource) => ({
    uri: typeof resource.uri === "string" ? resource.uri : "",
    name: typeof resource.name === "string" ? resource.name : undefined,
    mimeType: typeof resource.mimeType === "string" ? resource.mimeType : undefined,
    description: typeof resource.description === "string" ? resource.description : undefined,
  })).filter((resource) => resource.uri.length > 0);
}

function parseToolCallResult(value: unknown): { ok: boolean; output?: string; data?: unknown; error?: { code: string; message: string } } {
  if (!isRecord(value)) {
    return { ok: true, data: value, output: stringifyOutput(value) };
  }
  const output = toolContentToText(value.content) ?? stringifyOutput(value.structuredContent ?? value.content);
  if (value.isError === true) {
    return {
      ok: false,
      output,
      error: {
        code: "mcp_tool_error",
        message: output ?? "MCP tool returned an error.",
      },
    };
  }
  return {
    ok: true,
    output,
    data: value.structuredContent ?? value.content,
  };
}

function parseReadResourceResult(fallbackUri: string, value: unknown): { uri: string; mimeType?: string; text?: string; blob?: Uint8Array; metadata?: Record<string, unknown> } {
  const contents = isRecord(value) && Array.isArray(value.contents) ? value.contents.filter(isRecord) : [];
  const first = contents[0];
  if (!first) {
    return { uri: fallbackUri, metadata: { empty: true } };
  }
  const blob = typeof first.blob === "string" ? Uint8Array.from(Buffer.from(first.blob, "base64")) : undefined;
  return {
    uri: typeof first.uri === "string" ? first.uri : fallbackUri,
    mimeType: typeof first.mimeType === "string" ? first.mimeType : undefined,
    text: typeof first.text === "string" ? first.text : undefined,
    blob,
    metadata: { contentCount: contents.length },
  };
}

function toolContentToText(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts = value.filter(isRecord).map((item) => {
    if (item.type === "text" && typeof item.text === "string") {
      return item.text;
    }
    if (item.type === "resource" && isRecord(item.resource) && typeof item.resource.text === "string") {
      return item.resource.text;
    }
    return undefined;
  }).filter((item): item is string => item !== undefined);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function stringifyOutput(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

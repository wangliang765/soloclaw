import type { ActorRef, McpCapability, McpServerRegistration } from "../domain/index.js";
import type { JsonObject } from "../protocol/types.js";

export type McpRuntimeConnection = {
  connectionId: string;
  server: McpServerRegistration;
  connectedAt: string;
  capabilities: McpCapability[];
  metadata?: Record<string, unknown>;
};

export type McpRuntimeConnectInput = {
  server: McpServerRegistration;
  actor: ActorRef;
  projectId?: string;
  roomId?: string;
  sessionId?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
};

export type McpToolDescriptor = {
  name: string;
  description?: string;
  inputSchema?: JsonObject;
  risk?: string;
};

export type McpResourceDescriptor = {
  uri: string;
  name?: string;
  mimeType?: string;
  description?: string;
};

export type McpCapabilitySnapshot = {
  tools: McpToolDescriptor[];
  resources: McpResourceDescriptor[];
  prompts?: Array<Record<string, unknown>>;
  sampling?: boolean;
};

export type McpToolCallInput = {
  connectionId: string;
  actor: ActorRef;
  name: string;
  input: JsonObject;
  timeoutMs?: number;
};

export type McpToolCallResult = {
  ok: boolean;
  output?: string;
  data?: unknown;
  error?: { code: string; message: string };
  metadata?: Record<string, unknown>;
};

export type McpReadResourceInput = {
  connectionId: string;
  actor: ActorRef;
  uri: string;
  timeoutMs?: number;
};

export type McpReadResourceResult = {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: Uint8Array;
  metadata?: Record<string, unknown>;
};

export interface McpRuntime {
  connect(input: McpRuntimeConnectInput): Promise<McpRuntimeConnection>;
  listCapabilities(connectionId: string): Promise<McpCapabilitySnapshot>;
  callTool(input: McpToolCallInput): Promise<McpToolCallResult>;
  readResource(input: McpReadResourceInput): Promise<McpReadResourceResult>;
  disconnect(connectionId: string): Promise<void>;
}

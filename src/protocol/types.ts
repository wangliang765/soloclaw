export type JsonObject = Record<string, unknown>;

export type ToolCall = {
  id: string;
  name: string;
  input: JsonObject;
};

export type ToolResult = {
  callId: string;
  ok: boolean;
  output?: string;
  data?: unknown;
  display?: ToolDisplay;
  error?: {
    code: string;
    message: string;
  };
  truncated?: boolean;
};

export type ToolDisplay = {
  title: string;
  detailsHidden?: boolean;
  paths?: string[];
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs?: number;
  stdoutBytes?: number;
  stderrBytes?: number;
};

export type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; content: string; toolResult: ToolResult };

export type ModelUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ModelResponseMetadata = {
  providerRequestId?: string;
  providerResponseId?: string;
  providerModel?: string;
  usage?: ModelUsage;
};

export type ModelResponse =
  | { type: "message"; content: string; metadata?: ModelResponseMetadata }
  | { type: "tool_calls"; content?: string; toolCalls: ToolCall[]; metadata?: ModelResponseMetadata };

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonObject;
};

export type ToolHandler = (input: JsonObject) => Promise<ToolResult>;

export type RegisteredTool = ToolDefinition & {
  policy?: {
    action?: import("../domain/index.js").PolicyAction;
    risk?: import("../domain/index.js").TaskRisk;
  };
  handler: ToolHandler;
};

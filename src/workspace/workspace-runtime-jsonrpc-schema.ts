export const WORKSPACE_RUNTIME_JSONRPC_PROTOCOL_VERSION = "workspace-runtime-jsonrpc.v1";

export const WORKSPACE_RUNTIME_JSONRPC_FRAMING = {
  transport: "stdio",
  encoding: "utf8",
  framing: "newline-delimited-json",
  protocol: "jsonrpc-2.0",
  stdout: "JSON-RPC responses only",
  stderr: "diagnostic logs only",
} as const;

export const WORKSPACE_RUNTIME_JSONRPC_METHODS = [
  "workspace/listFiles",
  "workspace/readFile",
  "workspace/searchText",
  "workspace/runCommand",
  "workspace/applyPatch",
  "workspace/createFile",
  "workspace/replaceRange",
] as const;

export type WorkspaceRuntimeJsonRpcMethod = typeof WORKSPACE_RUNTIME_JSONRPC_METHODS[number];

const stringSchema = { type: "string" } as const;
const numberSchema = { type: "number" } as const;
const booleanSchema = { type: "boolean" } as const;

const commandExecutionProfileSchema = {
  type: "object",
  properties: {
    name: { type: "string", enum: ["local-safe", "local-workspace-write", "local-network", "local-full-access"] },
    filesystem: { type: "string", enum: ["workspace_cwd", "host_shell"] },
    workspaceWrite: { type: "string", enum: ["not_requested", "allowed"] },
    network: { type: "string", enum: ["not_requested", "allowed"] },
    enforcement: { type: "string", enum: ["policy_and_audit"] },
    summary: stringSchema,
  },
  required: ["name", "filesystem", "workspaceWrite", "network", "enforcement", "summary"],
  additionalProperties: false,
} as const;

const writeResultSchema = {
  type: "object",
  properties: {
    path: stringSchema,
    beforeHash: stringSchema,
    afterHash: stringSchema,
    summary: stringSchema,
  },
  required: ["path", "afterHash", "summary"],
  additionalProperties: false,
} as const;

const patchFileResultSchema = {
  type: "object",
  properties: {
    path: stringSchema,
    operation: { type: "string", enum: ["create", "modify", "delete"] },
    beforeHash: stringSchema,
    afterHash: stringSchema,
    summary: stringSchema,
  },
  required: ["path", "operation", "summary"],
  additionalProperties: false,
} as const;

export const WORKSPACE_RUNTIME_JSONRPC_SCHEMA = {
  protocolVersion: WORKSPACE_RUNTIME_JSONRPC_PROTOCOL_VERSION,
  framing: WORKSPACE_RUNTIME_JSONRPC_FRAMING,
  methods: {
    "workspace/listFiles": {
      params: {
        type: "object",
        properties: {
          path: stringSchema,
        },
        required: ["path"],
        additionalProperties: false,
      },
      result: {
        type: "array",
        items: stringSchema,
      },
    },
    "workspace/readFile": {
      params: {
        type: "object",
        properties: {
          path: stringSchema,
          startLine: numberSchema,
          endLine: numberSchema,
        },
        required: ["path"],
        additionalProperties: false,
      },
      result: stringSchema,
    },
    "workspace/searchText": {
      params: {
        type: "object",
        properties: {
          query: stringSchema,
          glob: stringSchema,
        },
        required: ["query"],
        additionalProperties: false,
      },
      result: stringSchema,
    },
    "workspace/runCommand": {
      params: {
        type: "object",
        properties: {
          command: stringSchema,
          timeoutMs: numberSchema,
          executionProfile: { type: "string", enum: ["local-safe", "local-workspace-write", "local-network", "local-full-access"] },
        },
        required: ["command"],
        additionalProperties: false,
      },
      result: {
        type: "object",
        properties: {
          stdout: stringSchema,
          stderr: stringSchema,
          exitCode: { type: ["number", "null"] },
          timedOut: booleanSchema,
          durationMs: numberSchema,
          executionProfile: commandExecutionProfileSchema,
        },
        required: ["stdout", "stderr", "exitCode", "timedOut", "durationMs", "executionProfile"],
        additionalProperties: false,
      },
    },
    "workspace/applyPatch": {
      params: {
        type: "object",
        properties: {
          patch: stringSchema,
        },
        required: ["patch"],
        additionalProperties: false,
      },
      result: {
        type: "object",
        properties: {
          summary: stringSchema,
          hunks: numberSchema,
          files: {
            type: "array",
            items: patchFileResultSchema,
          },
        },
        required: ["summary", "hunks", "files"],
        additionalProperties: false,
      },
    },
    "workspace/createFile": {
      params: {
        type: "object",
        properties: {
          path: stringSchema,
          content: stringSchema,
          overwrite: booleanSchema,
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      result: writeResultSchema,
    },
    "workspace/replaceRange": {
      params: {
        type: "object",
        properties: {
          path: stringSchema,
          startLine: numberSchema,
          endLine: numberSchema,
          content: stringSchema,
        },
        required: ["path", "startLine", "endLine", "content"],
        additionalProperties: false,
      },
      result: writeResultSchema,
    },
  },
} as const;

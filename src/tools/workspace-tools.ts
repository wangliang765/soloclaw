import type { ActorRef } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { JsonObject, RegisteredTool, ToolResult } from "../protocol/types.js";
import type { AgentStore } from "../store/agent-store.js";
import type { WorkspaceLockManager } from "../workspace/workspace-lock-manager.js";
import { COMMAND_EXECUTION_PROFILE_NAMES, commandExecutionProfile, type CommandExecutionProfileName, type WorkspaceRuntime } from "../workspace/workspace-runtime.js";
import { policyActionForWorkspaceCommand } from "./policy-tools.js";

export type WorkspaceToolOptions = {
  store?: AgentStore;
  locks?: WorkspaceLockManager;
  actor?: ActorRef;
  sessionId?: string | (() => string | undefined);
};

export function createWorkspaceTools(workspace: WorkspaceRuntime, options: WorkspaceToolOptions = {}): RegisteredTool[] {
  return [
    {
      name: "list_files",
      description: "List files and directories inside the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
      handler: async (input) => wrap("list_files", async () => (await workspace.listFiles(stringInput(input, "path"))).join("\n")),
    },
    {
      name: "read_file",
      description: "Read a file, optionally with 1-based start and end lines.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          startLine: { type: "number" },
          endLine: { type: "number" },
        },
        required: ["path"],
      },
      handler: async (input) =>
        wrap("read_file", async () =>
          workspace.readFile({
            path: stringInput(input, "path"),
            startLine: numberInput(input, "startLine"),
            endLine: numberInput(input, "endLine"),
          }),
        ),
    },
    {
      name: "search_text",
      description: "Search text in the workspace using ripgrep.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          glob: { type: "string" },
        },
        required: ["query"],
      },
      handler: async (input) => wrap("search_text", async () => workspace.searchText(stringInput(input, "query"), optionalString(input, "glob"))),
    },
    {
      name: "run_command",
      description: "Run a shell command in the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string" },
          timeoutMs: { type: "number" },
          executionProfile: { type: "string", enum: [...COMMAND_EXECUTION_PROFILE_NAMES] },
        },
        required: ["command"],
      },
      handler: async (input) =>
        wrap("run_command", async () => {
          const command = stringInput(input, "command");
          const executionProfile = commandExecutionProfile(resolveCommandExecutionProfile(input, command));
          await recordCommandAudit(options, "command.started", "Workspace command started", {
            command,
            timeoutMs: numberInput(input, "timeoutMs"),
            executionProfile: executionProfile.name,
            executionProfileDetails: executionProfile,
          });
          const result = await workspace.runCommand({
            command,
            timeoutMs: numberInput(input, "timeoutMs"),
            executionProfile: executionProfile.name,
          });
          await recordCommandAudit(options, "command.finished", "Workspace command finished", {
            command,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            durationMs: result.durationMs,
            executionProfile: result.executionProfile.name,
            executionProfileDetails: result.executionProfile,
            stdoutBytes: result.stdout.length,
            stderrBytes: result.stderr.length,
          });
          return [
            `exit=${result.exitCode}`,
            `timedOut=${result.timedOut}`,
            `durationMs=${result.durationMs}`,
            `executionProfile=${result.executionProfile.name}`,
            `executionEnforcement=${result.executionProfile.enforcement}`,
            `workspaceWrite=${result.executionProfile.workspaceWrite}`,
            `network=${result.executionProfile.network}`,
            "stdout:",
            result.stdout,
            "stderr:",
            result.stderr,
          ].join("\n");
        }),
    },
    {
      name: "apply_patch",
      description: "Apply a unified diff patch inside the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          patch: { type: "string" },
        },
        required: ["patch"],
      },
      handler: async (input) =>
        wrap("apply_patch", async () => {
          const patch = stringInput(input, "patch");
          return withFileLocks(options, extractPatchTargetPaths(patch), async () => {
            const result = await workspace.applyPatch(patch);
            for (const file of result.files) {
              await recordFileChange(options, "patch", file.path, file.summary, file.beforeHash, file.afterHash);
            }
            return JSON.stringify(result);
          });
        }),
    },
    {
      name: "create_file",
      description: "Create a file in the workspace. Set overwrite true to replace an existing file.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          overwrite: { type: "boolean" },
        },
        required: ["path", "content"],
      },
      handler: async (input) =>
        wrap("create_file", async () => {
          const filePath = stringInput(input, "path");
          return withFileLock(options, filePath, async () => {
            const result = await workspace.createFile({
              path: filePath,
              content: stringInput(input, "content"),
              overwrite: booleanInput(input, "overwrite"),
            });
            await recordFileChange(options, "create", result.path, result.summary, result.beforeHash, result.afterHash);
            return JSON.stringify(result);
          });
        }),
    },
    {
      name: "replace_range",
      description: "Replace an inclusive 1-based line range in a workspace file.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          startLine: { type: "number" },
          endLine: { type: "number" },
          content: { type: "string" },
        },
        required: ["path", "startLine", "endLine", "content"],
      },
      handler: async (input) =>
        wrap("replace_range", async () => {
          const filePath = stringInput(input, "path");
          return withFileLock(options, filePath, async () => {
            const result = await workspace.replaceRange({
              path: filePath,
              startLine: requiredNumberInput(input, "startLine"),
              endLine: requiredNumberInput(input, "endLine"),
              content: stringInput(input, "content"),
            });
            await recordFileChange(options, "replace_range", result.path, result.summary, result.beforeHash, result.afterHash);
            return JSON.stringify(result);
          });
        }),
    },
  ];
}

async function wrap(callId: string, action: () => Promise<string>): Promise<ToolResult> {
  try {
    return {
      callId,
      ok: true,
      output: await action(),
    };
  } catch (error) {
    return {
      callId,
      ok: false,
      error: {
        code: "tool_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function stringInput(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new Error(`Expected string input: ${key}`);
  }
  return value;
}

function optionalString(input: JsonObject, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function numberInput(input: JsonObject, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" ? value : undefined;
}

function requiredNumberInput(input: JsonObject, key: string): number {
  const value = numberInput(input, key);
  if (value === undefined) {
    throw new Error(`Expected number input: ${key}`);
  }
  return value;
}

function booleanInput(input: JsonObject, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === "boolean" ? value : undefined;
}

function resolveCommandExecutionProfile(input: JsonObject, command: string): CommandExecutionProfileName {
  const requested = optionalString(input, "executionProfile");
  if (requested !== undefined) {
    return parseCommandExecutionProfileName(requested);
  }
  switch (policyActionForWorkspaceCommand(command)) {
    case "dependency.install":
      return "local-network";
    case "git.mutation":
      return "local-workspace-write";
    case "shell.run.high_risk":
      return "local-full-access";
    default:
      return "local-safe";
  }
}

function parseCommandExecutionProfileName(value: string): CommandExecutionProfileName {
  if (COMMAND_EXECUTION_PROFILE_NAMES.includes(value as CommandExecutionProfileName)) {
    return value as CommandExecutionProfileName;
  }
  throw new Error(`Invalid command execution profile: ${value}`);
}

async function withFileLock(options: WorkspaceToolOptions, filePath: string, action: () => Promise<string>): Promise<string> {
  return withFileLocks(options, [filePath], action);
}

async function withFileLocks(options: WorkspaceToolOptions, filePaths: string[], action: () => Promise<string>): Promise<string> {
  if (!options.locks) {
    return action();
  }
  const ownerId = options.actor?.id ?? "unknown";
  const locks = [];
  try {
    for (const filePath of [...new Set(filePaths)].sort()) {
      locks.push(await options.locks.acquire({
        scope: "file",
        resourceId: filePath,
        ownerId,
        ttlMs: 60_000,
      }));
    }
    return await action();
  } finally {
    for (const lock of locks.reverse()) {
      await options.locks.release(lock.lockId, ownerId);
    }
  }
}

async function recordFileChange(
  options: WorkspaceToolOptions,
  kind: "create" | "replace_range" | "patch",
  filePath: string,
  summary: string,
  beforeHash?: string,
  afterHash?: string,
): Promise<void> {
  if (!options.store || !options.actor || (!beforeHash && !afterHash)) {
    return;
  }
  await options.store.recordFileChange({
    id: makeId<"ArtifactId">("change"),
    sessionId: resolveSessionId(options),
    actor: options.actor,
    kind,
    path: filePath,
    beforeHash,
    afterHash,
    summary,
    createdAt: new Date().toISOString(),
  });
}

async function recordCommandAudit(options: WorkspaceToolOptions, type: "command.started" | "command.finished", summary: string, metadata: Record<string, unknown>): Promise<void> {
  if (!options.store || !options.actor) {
    return;
  }
  await options.store.recordAuditEvent({
    id: makeId<"ArtifactId">("audit"),
    type,
    actor: options.actor,
    sessionId: resolveSessionId(options),
    summary,
    metadata: {
      ...metadata,
      command: typeof metadata.command === "string" ? truncateAuditText(metadata.command) : metadata.command,
    },
    artifactRefs: [],
    createdAt: new Date().toISOString(),
  });
}

function resolveSessionId(options: WorkspaceToolOptions): string | undefined {
  return typeof options.sessionId === "function" ? options.sessionId() : options.sessionId;
}

function extractPatchTargetPaths(patch: string): string[] {
  const paths: string[] = [];
  let oldPath: string | undefined;
  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("--- ")) {
      oldPath = parsePatchHeaderPath(line, "--- ");
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newPath = parsePatchHeaderPath(line, "+++ ");
      const targetPath = newPath ?? oldPath;
      if (targetPath) {
        paths.push(targetPath);
      }
      oldPath = undefined;
    }
  }
  return paths;
}

function parsePatchHeaderPath(line: string, prefix: "--- " | "+++ "): string | undefined {
  const raw = line.slice(prefix.length).trim();
  if (raw === "/dev/null") {
    return undefined;
  }
  const withoutTimestamp = raw.split("\t")[0].trim();
  const unquoted = withoutTimestamp.startsWith("\"") && withoutTimestamp.endsWith("\"")
    ? withoutTimestamp.slice(1, -1)
    : withoutTimestamp;
  return unquoted.replace(/^(a|b)\//, "");
}

function truncateAuditText(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}\n[truncated]` : value;
}

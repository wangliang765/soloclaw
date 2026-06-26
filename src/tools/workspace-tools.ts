import type { ActorRef, SessionTodo, SessionTodoPriority, SessionTodoStatus } from "../domain/index.js";
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
      handler: async (input) => {
        const filePath = stringInput(input, "path");
        return wrap("list_files", async () => (await workspace.listFiles(filePath)).join("\n"), {
          title: `List ${filePath}`,
          paths: [filePath],
          detailsHidden: true,
        });
      },
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
      handler: async (input) => {
        const filePath = stringInput(input, "path");
        return wrap("read_file", async () =>
          workspace.readFile({
            path: filePath,
            startLine: numberInput(input, "startLine"),
            endLine: numberInput(input, "endLine"),
          }),
        {
          title: `Read ${filePath}`,
          paths: [filePath],
          detailsHidden: true,
        });
      },
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
      handler: async (input) => {
        const query = stringInput(input, "query");
        return wrap("search_text", async () => workspace.searchText(query, optionalString(input, "glob")), {
          title: `Search ${query}`,
          detailsHidden: true,
        });
      },
    },
    {
      name: "todowrite",
      description: "Create and maintain the structured task list for the current coding session. Use it during multi-step work and keep statuses current.",
      inputSchema: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                content: { type: "string" },
                status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
                priority: { type: "string", enum: ["high", "medium", "low"] },
              },
              required: ["content", "status", "priority"],
            },
          },
        },
        required: ["todos"],
      },
      handler: async (input) =>
        wrap("todowrite", async () => {
          const sessionId = resolveSessionId(options);
          if (!options.store || !sessionId) {
            throw new Error("todowrite requires a session store and session id.");
          }
          const todos = todosInput(input);
          await options.store.replaceSessionTodos(sessionId, todos);
          return {
            output: JSON.stringify(todos, null, 2),
            display: {
              title: "Update task list",
              detailsHidden: true,
            },
          };
        }),
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
          return {
            output: [
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
            ].join("\n"),
            display: {
              title: "Run command",
              detailsHidden: true,
              exitCode: result.exitCode,
              timedOut: result.timedOut,
              durationMs: result.durationMs,
              stdoutBytes: result.stdout.length,
              stderrBytes: result.stderr.length,
            },
          };
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
      handler: async (input) => {
        const patch = stringInput(input, "patch");
        const paths = extractPatchTargetPaths(patch);
        return wrap("apply_patch", async () => {
          return withFileLocks(options, extractPatchTargetPaths(patch), async () => {
            const result = await workspace.applyPatch(patch);
            for (const file of result.files) {
              await recordFileChange(options, "patch", file.path, file.summary, file.beforeHash, file.afterHash);
            }
            return JSON.stringify(result);
          });
        }, {
          title: `Apply patch (${paths.length} file${paths.length === 1 ? "" : "s"})`,
          paths,
          detailsHidden: true,
        });
      },
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
      handler: async (input) => {
        const filePath = stringInput(input, "path");
        return wrap("create_file", async () => {
          return withFileLock(options, filePath, async () => {
            const result = await workspace.createFile({
              path: filePath,
              content: stringInput(input, "content"),
              overwrite: booleanInput(input, "overwrite"),
            });
            await recordFileChange(options, "create", result.path, result.summary, result.beforeHash, result.afterHash);
            return JSON.stringify(result);
          });
        }, {
          title: `Create ${filePath}`,
          paths: [filePath],
          detailsHidden: true,
        });
      },
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
      handler: async (input) => {
        const filePath = stringInput(input, "path");
        return wrap("replace_range", async () => {
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
        }, {
          title: `Edit ${filePath}`,
          paths: [filePath],
          detailsHidden: true,
        });
      },
    },
  ];
}

async function wrap(callId: string, action: () => Promise<string | { output: string; display?: ToolResult["display"] }>, display?: ToolResult["display"]): Promise<ToolResult> {
  try {
    const result = await action();
    const output = typeof result === "string" ? result : result.output;
    const resultDisplay = typeof result === "string" ? display : result.display ?? display;
    return {
      callId,
      ok: true,
      output,
      display: resultDisplay,
    };
  } catch (error) {
    return {
      callId,
      ok: false,
      display,
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

function todosInput(input: JsonObject): SessionTodo[] {
  const value = input.todos;
  if (!Array.isArray(value)) {
    throw new Error("Expected array input: todos");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Expected todo object at index ${index}`);
    }
    const candidate = item as Record<string, unknown>;
    const content = candidate.content;
    const status = candidate.status;
    const priority = candidate.priority;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error(`Expected non-empty todo content at index ${index}`);
    }
    if (!isSessionTodoStatus(status)) {
      throw new Error(`Invalid todo status at index ${index}`);
    }
    if (!isSessionTodoPriority(priority)) {
      throw new Error(`Invalid todo priority at index ${index}`);
    }
    return {
      content,
      status,
      priority,
    };
  });
}

function isSessionTodoStatus(value: unknown): value is SessionTodoStatus {
  return value === "pending" || value === "in_progress" || value === "completed" || value === "cancelled";
}

function isSessionTodoPriority(value: unknown): value is SessionTodoPriority {
  return value === "high" || value === "medium" || value === "low";
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

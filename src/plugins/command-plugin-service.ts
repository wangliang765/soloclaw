import { spawn } from "node:child_process";
import path from "node:path";
import type { ActorRef, AuditEvent, TaskRisk } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { JsonObject, RegisteredTool, ToolResult } from "../protocol/types.js";
import { BasicRedactor } from "../secrets/basic-redactor.js";
import type { AgentStore } from "../store/agent-store.js";
import { LocalPluginLoader, pluginToolName } from "./local-plugin-loader.js";
import type { LoadedPlugin, PluginCommandManifest } from "./plugin-types.js";

export type CommandPluginServiceOptions = {
  store?: AgentStore;
  actor: ActorRef;
  roomId?: string;
  sessionId?: string | (() => string | undefined);
  outputLimitBytes?: number;
};

export class CommandPluginService {
  constructor(
    private readonly loader: LocalPluginLoader,
    private readonly redactor = new BasicRedactor(),
  ) {}

  async listPlugins(): Promise<LoadedPlugin[]> {
    return this.loader.listPlugins();
  }

  async createTools(options: CommandPluginServiceOptions): Promise<RegisteredTool[]> {
    const plugins = await this.loader.listPlugins();
    const tools: RegisteredTool[] = [];
    for (const plugin of plugins) {
      for (const command of plugin.manifest.commands ?? []) {
        tools.push(this.commandTool(plugin, command, options));
      }
    }
    return tools;
  }

  private commandTool(plugin: LoadedPlugin, command: PluginCommandManifest, options: CommandPluginServiceOptions): RegisteredTool {
    const name = pluginToolName(plugin.manifest.name, command.name);
    return {
      name,
      description: command.description ?? plugin.manifest.description ?? `Run ${command.name} from ${plugin.manifest.name}.`,
      inputSchema: {
        type: "object",
        properties: {},
      },
      policy: {
        action: "plugin.execute",
        risk: riskFor(plugin, command),
      },
      handler: async (input) => this.runCommandPlugin(plugin, command, name, input, options),
    };
  }

  private async runCommandPlugin(
    plugin: LoadedPlugin,
    command: PluginCommandManifest,
    toolName: string,
    input: JsonObject,
    options: CommandPluginServiceOptions,
  ): Promise<ToolResult> {
    if (!plugin.manifest.permissions?.includes("shell.run")) {
      return failure(toolName, "plugin_permission_missing", "Command plugins must declare the shell.run permission.");
    }

    try {
      const result = await runProcess({
        plugin,
        command,
        input,
        outputLimitBytes: options.outputLimitBytes ?? 128_000,
      });
      const redactedStdout = await this.redactor.redact(result.stdout);
      const redactedStderr = await this.redactor.redact(result.stderr);
      const output =
        `exit=${result.exitCode}${result.timedOut ? " timed_out=true" : ""}${result.truncated ? " truncated=true" : ""}\n` +
        `stdout:\n${redactedStdout.text}\nstderr:\n${redactedStderr.text}`;
      await this.audit(options, result.exitCode === 0 && !result.timedOut ? "plugin.executed" : "tool.denied", `${toolName} executed`, {
        plugin: plugin.manifest.name,
        command: command.name,
        tool: toolName,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        truncated: result.truncated,
        redactions: [...redactedStdout.redactions, ...redactedStderr.redactions],
      });
      await this.appendRoomEvent(options, toolName, result.exitCode === 0 && !result.timedOut, result.timedOut ? "Plugin command timed out." : undefined);
      return {
        callId: toolName,
        ok: result.exitCode === 0 && !result.timedOut,
        output,
        data: {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          truncated: result.truncated,
        },
        error:
          result.exitCode === 0 && !result.timedOut
            ? undefined
            : {
                code: result.timedOut ? "plugin_timeout" : "plugin_exit_nonzero",
                message: result.timedOut ? "Plugin command timed out." : `Plugin command exited with code ${result.exitCode}.`,
              },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.audit(options, "tool.denied", `${toolName} failed`, {
        plugin: plugin.manifest.name,
        command: command.name,
        tool: toolName,
        error: message,
      });
      await this.appendRoomEvent(options, toolName, false, message);
      return failure(toolName, "plugin_error", message);
    }
  }

  private async audit(
    options: CommandPluginServiceOptions,
    type: AuditEvent["type"],
    summary: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await options.store?.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type,
      actor: options.actor,
      roomId: options.roomId,
      sessionId: typeof options.sessionId === "function" ? options.sessionId() : options.sessionId,
      summary,
      metadata,
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    });
  }

  private async appendRoomEvent(options: CommandPluginServiceOptions, toolName: string, ok: boolean, error?: string): Promise<void> {
    if (!options.store || !options.roomId) {
      return;
    }
    await options.store.appendRoomMessage({
      id: makeId<"MessageId">("msg"),
      roomId: options.roomId as Parameters<AgentStore["appendRoomMessage"]>[0]["roomId"],
      sender: options.actor,
      kind: "artifact",
      body: `Plugin execution ${ok ? "completed" : "failed"}: ${toolName}${error ? `\nError: ${error}` : ""}`,
      createdAt: new Date().toISOString(),
      artifactRefs: [],
    });
  }
}

type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
};

async function runProcess(input: {
  plugin: LoadedPlugin;
  command: PluginCommandManifest;
  input: JsonObject;
  outputLimitBytes: number;
}): Promise<ProcessResult> {
  const cwd = resolvePluginCwd(input.plugin, input.command.cwd);
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(input.command.command, input.command.args ?? [], {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        AGENT_PLUGIN_NAME: input.plugin.manifest.name,
        AGENT_PLUGIN_VERSION: input.plugin.manifest.version,
        AGENT_PLUGIN_PERMISSIONS: JSON.stringify(input.plugin.manifest.permissions ?? []),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.command.timeoutMs ?? 30_000);

    child.stdout.on("data", (chunk: Buffer) => {
      const next = chunk.toString("utf8");
      if (Buffer.byteLength(stdout + next, "utf8") <= input.outputLimitBytes) {
        stdout += next;
      } else {
        truncated = true;
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const next = chunk.toString("utf8");
      if (Buffer.byteLength(stderr + next, "utf8") <= input.outputLimitBytes) {
        stderr += next;
      } else {
        truncated = true;
      }
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr, timedOut, truncated });
    });
    child.stdin.end(`${JSON.stringify(input.input)}\n`);
  });
}

function resolvePluginCwd(plugin: LoadedPlugin, configuredCwd: string | undefined): string {
  const cwd = path.resolve(plugin.rootDir, configuredCwd ?? ".");
  const relative = path.relative(plugin.rootDir, cwd);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Plugin cwd must stay inside the plugin directory.");
  }
  return cwd;
}

function riskFor(plugin: LoadedPlugin, command: PluginCommandManifest): TaskRisk {
  if (command.risk) {
    return command.risk;
  }
  const permissions = new Set(plugin.manifest.permissions ?? []);
  if (permissions.has("secret.read") || permissions.has("workspace.write") || permissions.has("network.fetch") || permissions.has("shell.run")) {
    return "high";
  }
  return "medium";
}

function failure(callId: string, code: string, message: string): ToolResult {
  return {
    callId,
    ok: false,
    error: { code, message },
  };
}

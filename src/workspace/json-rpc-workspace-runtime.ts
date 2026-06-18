import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  CommandExecutionProfile,
  CreateFileInput,
  PatchApplyResult,
  PatchFileResult,
  ReadFileInput,
  ReplaceRangeInput,
  RunCommandInput,
  RunCommandResult,
  WorkspaceRuntime,
  WriteResult,
} from "./workspace-runtime.js";
import type { WorkspaceRuntimeJsonRpcMethod } from "./workspace-runtime-jsonrpc-schema.js";

export type WorkspaceRuntimeJsonRpcTransport = {
  request(method: WorkspaceRuntimeJsonRpcMethod, params: unknown): Promise<unknown>;
  close?(): Promise<void> | void;
};

export type StdioJsonRpcWorkspaceRuntimeTransportOptions = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export class JsonRpcWorkspaceRuntime implements WorkspaceRuntime {
  constructor(private readonly transport: WorkspaceRuntimeJsonRpcTransport) {}

  async listFiles(path: string): Promise<string[]> {
    return assertStringArray(await this.transport.request("workspace/listFiles", { path }), "workspace/listFiles");
  }

  async readFile(input: ReadFileInput): Promise<string> {
    return assertString(await this.transport.request("workspace/readFile", input), "workspace/readFile");
  }

  async searchText(query: string, glob?: string): Promise<string> {
    return assertString(await this.transport.request("workspace/searchText", { query, glob }), "workspace/searchText");
  }

  async runCommand(input: RunCommandInput): Promise<RunCommandResult> {
    return assertRunCommandResult(await this.transport.request("workspace/runCommand", input), "workspace/runCommand");
  }

  async applyPatch(patch: string): Promise<PatchApplyResult> {
    return assertPatchApplyResult(await this.transport.request("workspace/applyPatch", { patch }), "workspace/applyPatch");
  }

  async createFile(input: CreateFileInput): Promise<WriteResult> {
    return assertWriteResult(await this.transport.request("workspace/createFile", input), "workspace/createFile");
  }

  async replaceRange(input: ReplaceRangeInput): Promise<WriteResult> {
    return assertWriteResult(await this.transport.request("workspace/replaceRange", input), "workspace/replaceRange");
  }

  async close(): Promise<void> {
    await this.transport.close?.();
  }
}

export class StdioJsonRpcWorkspaceRuntimeTransport implements WorkspaceRuntimeJsonRpcTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private closed = false;
  private stderrTail = "";

  constructor(options: StdioJsonRpcWorkspaceRuntimeTransportOptions) {
    this.child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
    });

    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));

    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = tail(`${this.stderrTail}${chunk.toString("utf8")}`, 4_000);
    });
    this.child.on("error", (error) => this.rejectAll(error));
    this.child.on("close", (code, signal) => {
      this.closed = true;
      const detail = this.stderrTail ? ` stderr=${JSON.stringify(this.stderrTail)}` : "";
      this.rejectAll(new Error(`Workspace JSON-RPC worker exited code=${code ?? "null"} signal=${signal ?? "null"}.${detail}`));
    });
  }

  async request(method: WorkspaceRuntimeJsonRpcMethod, params: unknown): Promise<unknown> {
    if (this.closed || this.child.exitCode !== null) {
      throw new Error("Workspace JSON-RPC worker is not running.");
    }

    const id = this.nextId++;
    const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    if (!this.child.stdin.write(payload, "utf8")) {
      await new Promise<void>((resolve) => this.child.stdin.once("drain", resolve));
    }
    return result;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.child.once("close", () => resolve());
      this.child.kill();
    });
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.rejectAll(new Error(`Workspace JSON-RPC worker emitted non-JSON stdout: ${line}`));
      return;
    }

    if (!isRecord(parsed) || parsed.jsonrpc !== "2.0" || typeof parsed.id !== "number") {
      this.rejectAll(new Error(`Workspace JSON-RPC worker emitted an invalid response: ${line}`));
      return;
    }

    const pending = this.pending.get(parsed.id);
    if (!pending) {
      return;
    }
    this.pending.delete(parsed.id);

    if (isRecord(parsed.error)) {
      pending.reject(new Error(`${assertString(parsed.error.message, "jsonrpc.error.message")} (${parsed.error.code ?? "unknown"})`));
      return;
    }
    pending.resolve(parsed.result);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${label} result: expected string.`);
  }
  return value;
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Invalid ${label} result: expected string array.`);
  }
  return value;
}

function assertRunCommandResult(value: unknown, label: string): RunCommandResult {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label} result: expected object.`);
  }
  const result = value;
  const exitCode = result.exitCode;
  if (
    typeof result.stdout !== "string" ||
    typeof result.stderr !== "string" ||
    !(typeof exitCode === "number" || exitCode === null) ||
    typeof result.timedOut !== "boolean" ||
    typeof result.durationMs !== "number"
  ) {
    throw new Error(`Invalid ${label} result: malformed command result.`);
  }
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    executionProfile: assertCommandExecutionProfile(result.executionProfile, label),
  };
}

function assertCommandExecutionProfile(value: unknown, label: string): CommandExecutionProfile {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label} result: expected execution profile.`);
  }
  if (
    !isCommandExecutionProfileName(value.name) ||
    (value.filesystem !== "workspace_cwd" && value.filesystem !== "host_shell") ||
    (value.workspaceWrite !== "not_requested" && value.workspaceWrite !== "allowed") ||
    (value.network !== "not_requested" && value.network !== "allowed") ||
    value.enforcement !== "policy_and_audit" ||
    typeof value.summary !== "string"
  ) {
    throw new Error(`Invalid ${label} result: malformed execution profile.`);
  }
  return {
    name: value.name,
    filesystem: value.filesystem,
    workspaceWrite: value.workspaceWrite,
    network: value.network,
    enforcement: value.enforcement,
    summary: value.summary,
  };
}

function assertPatchApplyResult(value: unknown, label: string): PatchApplyResult {
  if (!isRecord(value) || typeof value.summary !== "string" || typeof value.hunks !== "number" || !Array.isArray(value.files)) {
    throw new Error(`Invalid ${label} result: malformed patch result.`);
  }
  return {
    summary: value.summary,
    hunks: value.hunks,
    files: value.files.map((file) => assertPatchFileResult(file, label)),
  };
}

function assertPatchFileResult(value: unknown, label: string): PatchFileResult {
  if (!isRecord(value) || typeof value.path !== "string" || !isPatchOperation(value.operation) || typeof value.summary !== "string") {
    throw new Error(`Invalid ${label} result: malformed patch file result.`);
  }
  return {
    path: value.path,
    operation: value.operation,
    beforeHash: optionalString(value.beforeHash, label),
    afterHash: optionalString(value.afterHash, label),
    summary: value.summary,
  };
}

function assertWriteResult(value: unknown, label: string): WriteResult {
  if (!isRecord(value) || typeof value.path !== "string" || typeof value.afterHash !== "string" || typeof value.summary !== "string") {
    throw new Error(`Invalid ${label} result: malformed write result.`);
  }
  return {
    path: value.path,
    beforeHash: optionalString(value.beforeHash, label),
    afterHash: value.afterHash,
    summary: value.summary,
  };
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid ${label} result: expected optional string.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommandExecutionProfileName(value: unknown): value is CommandExecutionProfile["name"] {
  return value === "local-safe" || value === "local-workspace-write" || value === "local-network" || value === "local-full-access";
}

function isPatchOperation(value: unknown): value is PatchFileResult["operation"] {
  return value === "create" || value === "modify" || value === "delete";
}

function tail(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(value.length - maxLength) : value;
}

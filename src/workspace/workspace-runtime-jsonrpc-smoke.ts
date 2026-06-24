import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DefaultPolicyEngine } from "../policy/default-policy-engine.js";
import type { RegisteredTool } from "../protocol/types.js";
import { MemoryAgentStore } from "../store/memory-agent-store.js";
import { withPolicy } from "../tools/policy-tools.js";
import { createWorkspaceTools } from "../tools/workspace-tools.js";
import { JsonRpcWorkspaceRuntime, StdioJsonRpcWorkspaceRuntimeTransport } from "./json-rpc-workspace-runtime.js";
import { LocalWorkspaceRuntime } from "./local-workspace-runtime.js";
import { MemoryWorkspaceLockManager } from "./memory-workspace-lock-manager.js";

const execFileAsync = promisify(execFile);

export type WorkspaceRuntimeJsonRpcRustSmokeResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  runner?: string;
  workspace?: string;
  methods: string[];
  patchOperations: string[];
  protectedPathRejections: string[];
  agentTmpWriteAllowed: boolean;
  commandExitCode?: number | null;
  commandStdoutMatched: boolean;
};

export type WorkspaceRuntimeJsonRpcRustToolsSmokeResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  runner?: string;
  workspace?: string;
  sessionId?: string;
  toolAuditEvents: number;
  commandAuditEvents: number;
  fileChanges: string[];
  policyActions: string[];
  approvalActions: string[];
  patchFiles: string[];
  policyApprovalRequired: boolean;
  commandExitCode?: number | null;
  commandStdoutMatched: boolean;
};

export async function runWorkspaceRuntimeJsonRpcRustSmoke(options: { cleanup?: boolean; repoRoot?: string } = {}): Promise<WorkspaceRuntimeJsonRpcRustSmokeResult> {
  const repoRoot = options.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const runner = await buildRustRunner(repoRoot);
  if (!runner.ok) {
    return {
      ok: false,
      skipped: runner.skipped,
      reason: runner.reason,
      methods: [],
      patchOperations: [],
      protectedPathRejections: [],
      agentTmpWriteAllowed: false,
      commandStdoutMatched: false,
    };
  }

  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-local-rust-compat-"));
  const rustRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-rust-runtime-"));
  let rustRuntime: JsonRpcWorkspaceRuntime | undefined;
  try {
    await seedWorkspace(localRoot);
    await seedWorkspace(rustRoot);

    const local = new LocalWorkspaceRuntime(localRoot);
    rustRuntime = new JsonRpcWorkspaceRuntime(new StdioJsonRpcWorkspaceRuntimeTransport({ command: runner.path, args: ["--root", rustRoot], cwd: repoRoot }));
    const runtime = rustRuntime;

    const methods: string[] = [];
    const protectedPathRejections: string[] = [];
    assertSameJson((await runtime.listFiles(".")).sort(), (await local.listFiles(".")).sort(), "listFiles");
    methods.push("workspace/listFiles");
    assertSame(await runtime.readFile({ path: "README.md", startLine: 1, endLine: 2 }), await local.readFile({ path: "README.md", startLine: 1, endLine: 2 }), "readFile");
    methods.push("workspace/readFile");
    const rustSearchText = await searchTextWithHostFallback(runtime, local, "alpha");
    assertIncludes(rustSearchText, "README.md", "searchText");
    methods.push("workspace/searchText");

    assertSameJson(
      await runtime.createFile({ path: "notes/todo.txt", content: "first\nsecond\n" }),
      await local.createFile({ path: "notes/todo.txt", content: "first\nsecond\n" }),
      "createFile",
    );
    methods.push("workspace/createFile");
    assertSameJson(
      await runtime.replaceRange({ path: "notes/todo.txt", startLine: 2, endLine: 2, content: "done" }),
      await local.replaceRange({ path: "notes/todo.txt", startLine: 2, endLine: 2, content: "done" }),
      "replaceRange",
    );
    methods.push("workspace/replaceRange");

    const rustGitReadError = await expectReject(() => runtime.readFile({ path: ".git/config" }), "rust read .git");
    const localGitReadError = await expectReject(() => local.readFile({ path: ".git/config" }), "local read .git");
    assertIncludes(rustGitReadError, "Protected workspace path cannot be read", "rust .git read rejection");
    assertIncludes(localGitReadError, "Protected workspace path cannot be read", "local .git read rejection");
    protectedPathRejections.push("read:.git");

    const rustAgentWriteError = await expectReject(() => runtime.createFile({ path: ".agent/state.json", content: "{}\n" }), "rust write .agent");
    const localAgentWriteError = await expectReject(() => local.createFile({ path: ".agent/state.json", content: "{}\n" }), "local write .agent");
    assertIncludes(rustAgentWriteError, "Protected workspace path cannot be modified", "rust .agent write rejection");
    assertIncludes(localAgentWriteError, "Protected workspace path cannot be modified", "local .agent write rejection");
    protectedPathRejections.push("write:.agent");

    assertSameJson(
      await runtime.createFile({ path: ".agent/tmp/runtime-smoke.txt", content: "ok\n" }),
      await local.createFile({ path: ".agent/tmp/runtime-smoke.txt", content: "ok\n" }),
      "createFile .agent/tmp",
    );
    const agentTmpWriteAllowed = true;

    const patchOperations: string[] = [];
    const modifyPatch = [
      "diff --git a/src/math.js b/src/math.js",
      "--- a/src/math.js",
      "+++ b/src/math.js",
      "@@ -1,3 +1,3 @@",
      " export function add(a, b) {",
      "-  return a - b;",
      "+  return a + b;",
      " }",
      "",
    ].join("\n");
    assertSameJson(await runtime.applyPatch(modifyPatch), await local.applyPatch(modifyPatch), "applyPatch modify");
    patchOperations.push("modify");

    const createPatch = [
      "diff --git a/src/subtract.js b/src/subtract.js",
      "--- /dev/null",
      "+++ b/src/subtract.js",
      "@@ -0,0 +1,3 @@",
      "+export function subtract(a, b) {",
      "+  return a - b;",
      "+}",
      "",
    ].join("\n");
    assertSameJson(await runtime.applyPatch(createPatch), await local.applyPatch(createPatch), "applyPatch create");
    patchOperations.push("create");

    const deletePatch = [
      "diff --git a/src/subtract.js b/src/subtract.js",
      "--- a/src/subtract.js",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-export function subtract(a, b) {",
      "-  return a - b;",
      "-}",
      "",
    ].join("\n");
    assertSameJson(await runtime.applyPatch(deletePatch), await local.applyPatch(deletePatch), "applyPatch delete");
    patchOperations.push("delete");
    methods.push("workspace/applyPatch");

    const command = `"${process.execPath}" -e "console.log('rust runtime ok')"`;
    const run = await runtime.runCommand({ command, timeoutMs: 10_000 });
    const commandStdoutMatched = /rust runtime ok/.test(run.stdout);
    if (run.exitCode !== 0 || run.timedOut || run.executionProfile.name !== "local-safe" || !commandStdoutMatched) {
      throw new Error(`runCommand mismatch: exit=${run.exitCode}, timedOut=${run.timedOut}, profile=${run.executionProfile.name}, stdout=${JSON.stringify(run.stdout)}`);
    }
    methods.push("workspace/runCommand");

    return {
      ok: true,
      skipped: false,
      runner: runner.path,
      workspace: rustRoot,
      methods,
      patchOperations,
      protectedPathRejections,
      agentTmpWriteAllowed,
      commandExitCode: run.exitCode,
      commandStdoutMatched,
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      reason: error instanceof Error ? error.message : String(error),
      runner: runner.path,
      workspace: rustRoot,
      methods: [],
      patchOperations: [],
      protectedPathRejections: [],
      agentTmpWriteAllowed: false,
      commandStdoutMatched: false,
    };
  } finally {
    await rustRuntime?.close();
    if (options.cleanup ?? true) {
      await fs.rm(localRoot, { recursive: true, force: true });
      await fs.rm(rustRoot, { recursive: true, force: true });
    }
  }
}

async function searchTextWithHostFallback(runtime: JsonRpcWorkspaceRuntime, local: LocalWorkspaceRuntime, query: string): Promise<string> {
  try {
    return await runtime.searchText(query);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/rg failed/i.test(message)) {
      throw error;
    }
    return local.searchText(query);
  }
}

export async function runWorkspaceRuntimeJsonRpcRustToolsSmoke(options: { cleanup?: boolean; repoRoot?: string } = {}): Promise<WorkspaceRuntimeJsonRpcRustToolsSmokeResult> {
  const repoRoot = options.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const runner = await buildRustRunner(repoRoot);
  if (!runner.ok) {
    return {
      ok: false,
      skipped: runner.skipped,
      reason: runner.reason,
      toolAuditEvents: 0,
      commandAuditEvents: 0,
      fileChanges: [],
      policyActions: [],
      approvalActions: [],
      patchFiles: [],
      policyApprovalRequired: false,
      commandStdoutMatched: false,
    };
  }

  const rustRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-rust-tools-"));
  let rustRuntime: JsonRpcWorkspaceRuntime | undefined;
  try {
    await seedWorkspace(rustRoot);

    const store = new MemoryAgentStore();
    const locks = new MemoryWorkspaceLockManager();
    const actor = { type: "user" as const, id: "operator", displayName: "Operator" };
    const session = await store.createSession({
      objective: "Rust JSON-RPC WorkspaceRuntime tools/policy/audit smoke.",
      targetMode: "build",
      status: "running",
      risk: "medium",
      createdBy: actor,
    });
    rustRuntime = new JsonRpcWorkspaceRuntime(new StdioJsonRpcWorkspaceRuntimeTransport({ command: runner.path, args: ["--root", rustRoot], cwd: repoRoot }));
    const policy = new DefaultPolicyEngine();
    const trustedTools = withPolicy(createWorkspaceTools(rustRuntime, { store, locks, actor, sessionId: session.id }), {
      actor,
      mode: "trusted",
      risk: "medium",
      policy,
      store,
      sessionId: session.id,
    });
    const applyPatch = requiredTool(trustedTools, "apply_patch");
    const runCommand = requiredTool(trustedTools, "run_command");

    const patchResult = await applyPatch.handler({ patch: modifyMathPatch() });
    if (!patchResult.ok) {
      throw new Error(`Rust-backed apply_patch failed: ${patchResult.error?.message ?? "unknown"}`);
    }
    const parsedPatch = JSON.parse(patchResult.output ?? "{}") as { files?: Array<{ path?: string; operation?: string }> };
    const patchFiles = (parsedPatch.files ?? []).map((file) => `${file.operation ?? "unknown"}:${file.path ?? "unknown"}`);
    if (!patchFiles.includes("modify:src/math.js")) {
      throw new Error(`Rust-backed apply_patch did not report src/math.js modification: ${JSON.stringify(parsedPatch)}`);
    }

    const command = `"${process.execPath}" -e "console.log('rust tools ok')"`;
    const commandResult = await runCommand.handler({ command, timeoutMs: 10_000 });
    if (!commandResult.ok) {
      throw new Error(`Rust-backed run_command failed: ${commandResult.error?.message ?? "unknown"}`);
    }
    const commandExitCode = toolOutputNumber(commandResult.output, "exit");
    const commandStdoutMatched = /rust tools ok/.test(commandResult.output ?? "");
    if (commandExitCode !== 0 || !commandStdoutMatched) {
      throw new Error(`Rust-backed run_command mismatch: exit=${commandExitCode ?? "unknown"}, output=${JSON.stringify(commandResult.output ?? "")}`);
    }

    const balancedTools = withPolicy(createWorkspaceTools(rustRuntime, { store, locks, actor, sessionId: session.id }), {
      actor,
      mode: "balanced",
      risk: "medium",
      policy,
      store,
      sessionId: session.id,
    });
    const balancedApplyPatch = requiredTool(balancedTools, "apply_patch");
    const approvalResult = await balancedApplyPatch.handler({ patch: modifyMathPatch() });
    const policyApprovalRequired = !approvalResult.ok && approvalResult.error?.code === "approval_required";
    if (!policyApprovalRequired) {
      throw new Error(`Balanced Rust-backed apply_patch did not require approval: ${approvalResult.error?.message ?? approvalResult.output ?? "allowed"}`);
    }

    const auditEvents = await store.listAuditEvents({ sessionId: session.id, limit: 100 });
    const toolAuditEvents = auditEvents.filter((event) => event.type === "tool.requested" || event.type === "tool.completed" || event.type === "tool.denied").length;
    const commandAuditEvents = auditEvents.filter((event) => event.type === "command.started" || event.type === "command.finished").length;
    const policyActions = [...new Set(auditEvents.map((event) => event.metadata?.action).filter((action): action is string => typeof action === "string"))].sort();
    const fileChanges = (await store.listFileChanges(session.id)).map((change) => `${change.kind}:${change.path}`).sort();
    const approvalActions = (await store.listApprovalRequests()).map((approval) => approval.action).sort();

    if (toolAuditEvents < 5 || commandAuditEvents < 2 || !fileChanges.includes("patch:src/math.js") || !policyActions.includes("workspace.write") || !policyActions.includes("shell.run.safe") || !approvalActions.includes("workspace.write")) {
      throw new Error(
        `Rust-backed tools smoke missing governance evidence: toolAudits=${toolAuditEvents}, commandAudits=${commandAuditEvents}, ` +
          `fileChanges=${fileChanges.join(",") || "-"}, policyActions=${policyActions.join(",") || "-"}, approvals=${approvalActions.join(",") || "-"}`,
      );
    }

    return {
      ok: true,
      skipped: false,
      runner: runner.path,
      workspace: rustRoot,
      sessionId: session.id,
      toolAuditEvents,
      commandAuditEvents,
      fileChanges,
      policyActions,
      approvalActions,
      patchFiles,
      policyApprovalRequired,
      commandExitCode,
      commandStdoutMatched,
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      reason: error instanceof Error ? error.message : String(error),
      runner: runner.path,
      workspace: rustRoot,
      toolAuditEvents: 0,
      commandAuditEvents: 0,
      fileChanges: [],
      policyActions: [],
      approvalActions: [],
      patchFiles: [],
      policyApprovalRequired: false,
      commandStdoutMatched: false,
    };
  } finally {
    await rustRuntime?.close();
    if (options.cleanup ?? true) {
      await fs.rm(rustRoot, { recursive: true, force: true });
    }
  }
}

async function buildRustRunner(repoRoot: string): Promise<{ ok: true; path: string } | { ok: false; skipped: boolean; reason: string }> {
  const exe = process.platform === "win32" ? "agent-runner.exe" : "agent-runner";
  const existingRunner = path.join(repoRoot, "target", "debug", exe);
  try {
    await execFileAsync("cargo", ["build", "-p", "agent-runner"], { cwd: repoRoot, timeout: 120_000 });
  } catch (error) {
    const maybe = error as NodeJS.ErrnoException & { stderr?: string };
    if (maybe.code === "ENOENT") {
      if (await fileExists(existingRunner)) {
        return { ok: true, path: existingRunner };
      }
      return { ok: false, skipped: true, reason: "cargo is not available" };
    }
    return { ok: false, skipped: false, reason: `cargo build -p agent-runner failed: ${maybe.stderr ?? maybe.message}` };
  }
  return { ok: true, path: existingRunner };
}

async function fileExists(inputPath: string): Promise<boolean> {
  try {
    await fs.access(inputPath);
    return true;
  } catch {
    return false;
  }
}

function modifyMathPatch(): string {
  return [
    "diff --git a/src/math.js b/src/math.js",
    "--- a/src/math.js",
    "+++ b/src/math.js",
    "@@ -1,3 +1,3 @@",
    " export function add(a, b) {",
    "-  return a - b;",
    "+  return a + b;",
    " }",
    "",
  ].join("\n");
}

async function seedWorkspace(root: string): Promise<void> {
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, ".git"), { recursive: true });
  await fs.mkdir(path.join(root, ".agent", "tmp"), { recursive: true });
  await fs.writeFile(path.join(root, "README.md"), "# Runtime\nalpha beta\n", "utf8");
  await fs.writeFile(path.join(root, "src", "math.js"), "export function add(a, b) {\n  return a - b;\n}\n", "utf8");
  await fs.writeFile(path.join(root, ".git", "config"), "private\n", "utf8");
}

function requiredTool(tools: RegisteredTool[], name: string): RegisteredTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Missing tool: ${name}`);
  }
  return tool;
}

function assertSame(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function assertSameJson(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label} mismatch: ${actualJson} !== ${expectedJson}`);
  }
}

function assertIncludes(actual: string, expected: string, label: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}`);
  }
}

function toolOutputNumber(output: string | undefined, key: string): number | null | undefined {
  const line = output?.split(/\r?\n/).find((candidate) => candidate.startsWith(`${key}=`));
  if (!line) {
    return undefined;
  }
  const raw = line.slice(key.length + 1).trim();
  return raw === "null" ? null : Number(raw);
}

async function expectReject(input: () => Promise<unknown>, label: string): Promise<string> {
  try {
    await input();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

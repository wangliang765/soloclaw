import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { JsonRpcWorkspaceRuntime, StdioJsonRpcWorkspaceRuntimeTransport, type WorkspaceRuntimeJsonRpcTransport } from "../workspace/json-rpc-workspace-runtime.js";
import { LocalWorkspaceRuntime } from "../workspace/local-workspace-runtime.js";
import { runWorkspaceRuntimeJsonRpcRustSmoke, runWorkspaceRuntimeJsonRpcRustToolsSmoke } from "../workspace/workspace-runtime-jsonrpc-smoke.js";
import type { WorkspaceRuntime } from "../workspace/workspace-runtime.js";
import { WORKSPACE_RUNTIME_JSONRPC_METHODS, WORKSPACE_RUNTIME_JSONRPC_SCHEMA } from "../workspace/workspace-runtime-jsonrpc-schema.js";

test("workspace runtime JSON-RPC schema covers the WorkspaceRuntime method set", () => {
  assert.deepEqual(Object.keys(WORKSPACE_RUNTIME_JSONRPC_SCHEMA.methods).sort(), [...WORKSPACE_RUNTIME_JSONRPC_METHODS].sort());
  assert.equal(WORKSPACE_RUNTIME_JSONRPC_SCHEMA.protocolVersion, "workspace-runtime-jsonrpc.v1");
  assert.equal(WORKSPACE_RUNTIME_JSONRPC_SCHEMA.framing.protocol, "jsonrpc-2.0");
});

test("JsonRpcWorkspaceRuntime is interchangeable with LocalWorkspaceRuntime through the protocol method set", async (t) => {
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-local-runtime-"));
  const jsonRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-jsonrpc-runtime-"));
  t.after(async () => {
    await fs.rm(localRoot, { recursive: true, force: true });
    await fs.rm(jsonRoot, { recursive: true, force: true });
  });

  await seedWorkspace(localRoot);
  await seedWorkspace(jsonRoot);

  const local = new LocalWorkspaceRuntime(localRoot);
  const jsonRuntime = new JsonRpcWorkspaceRuntime(new DelegatingWorkspaceRuntimeTransport(new LocalWorkspaceRuntime(jsonRoot)));

  assert.deepEqual((await jsonRuntime.listFiles(".")).sort(), (await local.listFiles(".")).sort());
  assert.equal(await jsonRuntime.readFile({ path: "README.md", startLine: 1, endLine: 2 }), await local.readFile({ path: "README.md", startLine: 1, endLine: 2 }));
  assert.match(await jsonRuntime.searchText("alpha"), /README\.md/);

  const localCreate = await local.createFile({ path: "notes/todo.txt", content: "first\nsecond\n" });
  const jsonCreate = await jsonRuntime.createFile({ path: "notes/todo.txt", content: "first\nsecond\n" });
  assert.deepEqual(jsonCreate, localCreate);

  const localReplace = await local.replaceRange({ path: "notes/todo.txt", startLine: 2, endLine: 2, content: "done" });
  const jsonReplace = await jsonRuntime.replaceRange({ path: "notes/todo.txt", startLine: 2, endLine: 2, content: "done" });
  assert.deepEqual(jsonReplace, localReplace);

  const patch = [
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
  const localPatch = await local.applyPatch(patch);
  const jsonPatch = await jsonRuntime.applyPatch(patch);
  assert.deepEqual(jsonPatch, localPatch);

  const command = `"${process.execPath}" -e "console.log('runtime ok')"`;
  const localRun = await local.runCommand({ command, timeoutMs: 10_000 });
  const jsonRun = await jsonRuntime.runCommand({ command, timeoutMs: 10_000 });
  assert.equal(jsonRun.exitCode, localRun.exitCode);
  assert.equal(jsonRun.timedOut, false);
  assert.equal(jsonRun.executionProfile.name, localRun.executionProfile.name);
  assert.match(jsonRun.stdout, /runtime ok/);
});

test("StdioJsonRpcWorkspaceRuntimeTransport exchanges newline-delimited JSON-RPC frames", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-jsonrpc-stdio-"));
  const fixture = path.join(dir, "worker.mjs");
  await fs.writeFile(
    fixture,
    [
      "import readline from 'node:readline';",
      "const rl = readline.createInterface({ input: process.stdin });",
      "rl.on('line', (line) => {",
      "  const request = JSON.parse(line);",
      "  const result = request.method === 'workspace/listFiles' ? ['file mocked.txt'] : '1: mocked';",
      "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const transport = new StdioJsonRpcWorkspaceRuntimeTransport({ command: process.execPath, args: [fixture] });
  const runtime = new JsonRpcWorkspaceRuntime(transport);
  t.after(async () => {
    await runtime.close();
  });

  assert.deepEqual(await runtime.listFiles("."), ["file mocked.txt"]);
  assert.equal(await runtime.readFile({ path: "mocked.txt" }), "1: mocked");
});

test("Rust agent-runner satisfies the WorkspaceRuntime JSON-RPC compatibility smoke", async (t) => {
  const smoke = await runWorkspaceRuntimeJsonRpcRustSmoke();
  if (smoke.skipped) {
    t.skip(smoke.reason);
    return;
  }
  assert.equal(smoke.ok, true, smoke.reason);
  assert.equal(smoke.methods.length, 7);
  assert.deepEqual(smoke.patchOperations, ["modify", "create", "delete"]);
  assert.deepEqual(smoke.protectedPathRejections, ["read:.git", "write:.agent"]);
  assert.equal(smoke.agentTmpWriteAllowed, true);
  assert.equal(smoke.commandExitCode, 0);
  assert.equal(smoke.commandStdoutMatched, true);
});

test("Rust agent-runner stays behind workspace tools policy and audit", async (t) => {
  const smoke = await runWorkspaceRuntimeJsonRpcRustToolsSmoke();
  if (smoke.skipped) {
    t.skip(smoke.reason);
    return;
  }
  assert.equal(smoke.ok, true, smoke.reason);
  assert.match(smoke.sessionId ?? "", /^sess_/);
  assert.equal(smoke.patchFiles.includes("modify:src/math.js"), true);
  assert.equal(smoke.fileChanges.includes("patch:src/math.js"), true);
  assert.equal(smoke.toolAuditEvents >= 5, true);
  assert.equal(smoke.commandAuditEvents >= 2, true);
  assert.equal(smoke.policyActions.includes("workspace.write"), true);
  assert.equal(smoke.policyActions.includes("shell.run.safe"), true);
  assert.equal(smoke.approvalActions.includes("workspace.write"), true);
  assert.equal(smoke.policyApprovalRequired, true);
  assert.equal(smoke.commandExitCode, 0);
  assert.equal(smoke.commandStdoutMatched, true);
});

class DelegatingWorkspaceRuntimeTransport implements WorkspaceRuntimeJsonRpcTransport {
  constructor(private readonly runtime: WorkspaceRuntime) {}

  async request(method: string, params: unknown): Promise<unknown> {
    const input = params as Record<string, unknown>;
    switch (method) {
      case "workspace/listFiles":
        return this.runtime.listFiles(requiredString(input, "path"));
      case "workspace/readFile":
        return this.runtime.readFile({
          path: requiredString(input, "path"),
          startLine: optionalNumber(input, "startLine"),
          endLine: optionalNumber(input, "endLine"),
        });
      case "workspace/searchText":
        return this.runtime.searchText(requiredString(input, "query"), optionalString(input, "glob"));
      case "workspace/runCommand":
        return this.runtime.runCommand({
          command: requiredString(input, "command"),
          timeoutMs: optionalNumber(input, "timeoutMs"),
        });
      case "workspace/applyPatch":
        return this.runtime.applyPatch(requiredString(input, "patch"));
      case "workspace/createFile":
        return this.runtime.createFile({
          path: requiredString(input, "path"),
          content: requiredString(input, "content"),
          overwrite: optionalBoolean(input, "overwrite"),
        });
      case "workspace/replaceRange":
        return this.runtime.replaceRange({
          path: requiredString(input, "path"),
          startLine: requiredNumber(input, "startLine"),
          endLine: requiredNumber(input, "endLine"),
          content: requiredString(input, "content"),
        });
      default:
        throw new Error(`Unexpected method: ${method}`);
    }
  }
}

async function seedWorkspace(root: string): Promise<void> {
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "README.md"), "# Runtime\nalpha beta\n", "utf8");
  await fs.writeFile(path.join(root, "src", "math.js"), "export function add(a, b) {\n  return a - b;\n}\n", "utf8");
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new Error(`Expected string ${key}`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function requiredNumber(input: Record<string, unknown>, key: string): number {
  const value = optionalNumber(input, key);
  if (value === undefined) {
    throw new Error(`Expected number ${key}`);
  }
  return value;
}

function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" ? value : undefined;
}

function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === "boolean" ? value : undefined;
}

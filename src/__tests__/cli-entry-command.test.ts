import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("unknown top-level commands can report a JSON error shape", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "agent-cli-entry-"));
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const result = await run(process.execPath, [cli, "does-not-exist", "--json"], cwd);

  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false,
    error: {
      code: "unknown_command",
      command: "does-not-exist",
      message: "Unknown command: does-not-exist",
    },
  });
});

test("status ignores a stale System32 active workspace when launched from a normal directory", { skip: process.platform !== "win32" }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-cli-system32-workspace-"));
  const cwd = path.join(root, "project");
  const home = path.join(root, "home");
  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(
    path.join(home, "workspaces.json"),
    JSON.stringify(
      {
        version: 1,
        activeWorkspace: "C:\\Windows\\System32",
        entries: [{ path: "C:\\Windows\\System32", lastUsedAt: "2026-06-27T00:00:00.000Z" }],
      },
      null,
      2,
    ),
    "utf8",
  );
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const result = await run(process.execPath, [cli, "status", "--json"], cwd, { SOLOCLAW_HOME: home });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).workspace, cwd);
});

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, NODE_OPTIONS: "--no-warnings", SOLOCLAW_HOME: cwd, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

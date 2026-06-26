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

function run(command: string, args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, NODE_OPTIONS: "--no-warnings", SOLOCLAW_HOME: cwd } });
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

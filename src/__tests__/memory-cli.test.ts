import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("memory CLI extracts, reviews, searches, and reports usage as JSON", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-cli-"));

  await runCli(["memory", "summary", "sess_memory_cli", "Remember: this project uses SQLite locally."], workspace);
  const extracted = await runCliJson(["memory", "extract", "sess_memory_cli", "--scope-type", "project", "--scope-id", "local", "--json"], workspace);
  assert.equal(extracted.sessionId, "sess_memory_cli");
  assert.equal(extracted.createdCandidates.length, 1);

  const listed = await runCliJson(["memory", "candidates", "--status", "pending", "--json"], workspace);
  assert.equal(listed.candidates.length, 1);
  const candidateId = listed.candidates[0].id;

  const approved = await runCliJson(["memory", "approve", candidateId, "--json"], workspace);
  assert.equal(approved.candidate.status, "approved");
  const memoryId = approved.memory.id;

  const search = await runCliJson(["memory", "search", "SQLite locally", "--scope-type", "project", "--scope-id", "local", "--json"], workspace);
  assert.equal(search.results[0].memoryId, memoryId);
  assert.equal(search.results[0].citationId, `M:${memoryId}`);

  const usage = await runCliJson(["memory", "usage", memoryId, "--json"], workspace);
  assert.equal(usage.memoryId, memoryId);
  assert.equal(usage.events[0].reason, "retrieved");
});

test("memory CLI exports snapshots and runs eval gates as JSON", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-cli-"));
  const add = await runCli(["memory", "add", "project", "local", "workflow", "Run npm.cmd run build on Windows."], workspace);
  const memoryId = add.stdout.trim().split(/\s+/)[0];
  const snapshotPath = path.join(workspace, ".agent", "MEMORY.md");

  const exported = await runCliJson(["memory", "snapshot", "export", "--scope-type", "project", "--scope-id", "local", "--file", snapshotPath, "--json"], workspace);
  assert.equal(exported.filePath, snapshotPath);
  assert.equal(exported.memoryCount, 1);

  const status = await runCliJson(["memory", "snapshot", "status", "--scope-type", "project", "--scope-id", "local", "--file", snapshotPath, "--json"], workspace);
  assert.equal(status.status, "clean");

  const caseFile = path.join(workspace, "memory-eval.json");
  await fs.writeFile(
    caseFile,
    JSON.stringify({
      cases: [
        {
          id: "windows_build",
          query: "Windows build",
          scopeType: "project",
          scopeId: "local",
          expectedMemoryIds: [memoryId],
        },
      ],
      thresholds: {
        minRecallAtK: 1,
        maxEmptyResultRate: 0,
        maxPermissionLeakRate: 0,
      },
    }),
    "utf8",
  );

  const evaluation = await runCliJson(["memory", "eval", "--case-file", caseFile, "--json"], workspace);
  assert.equal(evaluation.gate.passed, true);
  assert.equal(evaluation.metrics.recallAtK, 1);
});

test("help exposes reviewed persistent memory commands", async () => {
  const result = await runCli(["help"], process.cwd());

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /agent memory extract <session-id>/);
  assert.match(result.stdout, /agent memory candidates/);
  assert.match(result.stdout, /agent memory snapshot export\|import\|status/);
  assert.match(result.stdout, /agent memory eval --case-file/);
});

async function runCliJson(args: string[], cwd: string): Promise<Record<string, any>> {
  const result = await runCli(args, cwd);
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout) as Record<string, any>;
}

function runCli(args: string[], cwd: string): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), "dist", "cli", "index.js"), ...args], {
      cwd,
      windowsHide: true,
    });
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
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

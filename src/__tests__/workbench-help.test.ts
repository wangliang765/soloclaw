import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";

test("workbench help exposes profiles, commands, and verify gate", async () => {
  const result = await runCli(["help"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /--agent-profile/);
  assert.match(result.stdout, /agent commands list/);
  assert.match(result.stdout, /agent workbench verify/);
  assert.match(result.stdout, /--protocol openai_chat\|openai_responses\|anthropic_messages\|mock/);
});

test("global help aliases render the same workbench help surface", async () => {
  for (const alias of ["--help", "-h"]) {
    const result = await runCli([alias]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /agent commands list/);
    assert.match(result.stdout, /agent workbench verify/);
  }
});

test("quickstart command still renders first-run setup text", async () => {
  const result = await runCli(["quickstart"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Soloclaw quickstart/);
  assert.match(result.stdout, /soloclaw model check/);
});

test("status command still writes product status json", async () => {
  const result = await runCli(["status", "--json"]);

  assert.equal(result.exitCode, 0);
  const view = JSON.parse(result.stdout) as { workspace?: string; readiness?: { commands?: { quickstart?: string } } };
  assert.equal(typeof view.workspace, "string");
  assert.equal(view.readiness?.commands?.quickstart, "soloclaw quickstart");
});

test("platform doctor command still writes diagnostics json", async () => {
  const result = await runCli(["platform", "doctor", "--json"]);

  assert.equal(result.exitCode, 0);
  const view = JSON.parse(result.stdout) as { capabilities?: { platform?: { id?: string } } };
  assert.equal(typeof view.capabilities?.platform?.id, "string");
});

test("doctor command still writes readiness json", async () => {
  const result = await runCli(["doctor", "--json"]);

  assert.equal(result.exitCode, 0);
  const view = JSON.parse(result.stdout) as { root?: string; status?: string };
  assert.equal(typeof view.root, "string");
  assert.match(view.status ?? "", /^(pass|warn|fail)$/);
});

test("inspect command still writes workspace snapshot json", async () => {
  const result = await runCli(["inspect", "--workspace", process.cwd(), "--json"]);

  assert.equal(result.exitCode, 0);
  const view = JSON.parse(result.stdout) as { root?: string; snapshot?: unknown; text?: string };
  assert.equal(view.root, process.cwd());
  assert.equal(typeof view.snapshot, "object");
  assert.equal(typeof view.text, "string");
});

test("legacy models command still writes profile and usage json", async () => {
  const profiles = await runCli(["models", "profiles", "list", "--json"]);
  assert.equal(profiles.exitCode, 0);
  const profileView = JSON.parse(profiles.stdout) as { profiles?: unknown[]; configPath?: string };
  assert.ok(Array.isArray(profileView.profiles));
  assert.match(profileView.configPath ?? "", /model-providers\.json$/);

  const usage = await runCli(["models", "usage", "--json"]);
  assert.equal(usage.exitCode, 0);
  const usageView = JSON.parse(usage.stdout) as { entries?: unknown[]; totals?: unknown };
  assert.ok(Array.isArray(usageView.entries));
  assert.equal(typeof usageView.totals, "object");
});

test("secrets list still exits successfully through the config command module", async () => {
  const result = await runCli(["secrets", "list"]);

  assert.equal(result.exitCode, 0);
});

function runCli(args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), "dist", "cli", "index.js"), ...args], {
      cwd: process.cwd(),
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

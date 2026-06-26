import assert from "node:assert/strict";
import test from "node:test";
import { createHygieneCommand } from "../cli/commands/hygiene.js";

test("createHygieneCommand writes clean text output", async () => {
  const events: string[] = [];
  const command = createHygieneCommand({
    cwd: () => "C:/repo",
    scan: async (cwd) => {
      events.push(`scan:${cwd}`);
      return [];
    },
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "hygiene", args: ["check"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["scan:C:/repo", "text:Workspace hygiene check passed.", "exit:0"]);
});

test("createHygieneCommand writes json findings and fails on errors", async () => {
  const events: string[] = [];
  const command = createHygieneCommand({
    cwd: () => "C:/repo",
    scan: async () => [{ severity: "error", rule: "tmp-test", path: "tmp.js", message: "temporary test" }],
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "hygiene", args: ["check", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    'json:{"findings":[{"severity":"error","rule":"tmp-test","path":"tmp.js","message":"temporary test"}],"count":1}',
    "exit:1",
  ]);
});

test("createHygieneCommand reports unknown subcommands", async () => {
  const events: string[] = [];
  const command = createHygieneCommand({
    cwd: () => "C:/repo",
    scan: async () => [],
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "hygiene", args: ["wat"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Unknown hygiene command: wat", "exit:1"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createQuickstartCommand } from "../cli/commands/quickstart.js";

test("createQuickstartCommand renders text view with resolved workspace", async () => {
  const events: string[] = [];
  const command = createQuickstartCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    stripWorkspaceOption: (args) => args.filter((arg) => arg !== "--workspace" && arg !== "project"),
    buildQuickstart: async (cwd, workspace) => ({ cwd, workspace, kind: "view" }),
    renderQuickstart: (view) => events.push(`render:${JSON.stringify(view)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "quickstart", args: ["--workspace", "project"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:--workspace,project",
    'render:{"cwd":"C:/repo","workspace":"C:/repo/project","kind":"view"}',
  ]);
});

test("createQuickstartCommand writes json when --json survives workspace stripping", async () => {
  const events: string[] = [];
  const command = createQuickstartCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo",
    stripWorkspaceOption: (args) => args,
    buildQuickstart: async () => ({ ready: true }),
    renderQuickstart: () => events.push("render"),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "quickstart", args: ["--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ['json:{"ready":true}']);
});

test("createQuickstartCommand reports errors and sets exit code", async () => {
  const events: string[] = [];
  const command = createQuickstartCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => {
      throw new Error("workspace missing");
    },
    stripWorkspaceOption: (args) => args,
    buildQuickstart: async () => ({ ready: true }),
    renderQuickstart: () => events.push("render"),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "quickstart", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:workspace missing", "exit:1"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceCommand } from "../cli/commands/workspace.js";

type WorkspaceHistory = {
  activeWorkspace?: string;
  entries: Array<{ path: string; lastUsedAt: string }>;
};

test("createWorkspaceCommand writes workspace history as JSON", async () => {
  const events: string[] = [];
  const command = createWorkspaceCommand<WorkspaceHistory>({
    cwd: () => "C:/repo",
    readHistory: async (root) => {
      events.push(`read:${root}`);
      return { activeWorkspace: "C:/repo", entries: [{ path: "C:/repo", lastUsedAt: "2026-06-26T00:00:00.000Z" }] };
    },
    historyPath: (root) => `${root}/.agent/workspaces.json`,
    resolvePath: (root, value) => `${root}/${value}`,
    recordHistoryEntry: async (root, workspace) => {
      events.push(`record:${root}:${workspace}`);
      return workspace;
    },
    resolveWorkspaceSelector: async (root, selector, relativeRoot) => {
      events.push(`select:${root}:${selector}:${relativeRoot}`);
      return `${root}/${selector}`;
    },
    renderHistory: (history) => events.push(`render:${JSON.stringify(history)}`),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "workspace", args: ["list", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "read:C:/repo",
    'json:{"configPath":"C:/repo/.agent/workspaces.json","activeWorkspace":"C:/repo","entries":[{"path":"C:/repo","lastUsedAt":"2026-06-26T00:00:00.000Z"}]}',
  ]);
});

test("createWorkspaceCommand records added workspaces", async () => {
  const events: string[] = [];
  const command = createWorkspaceCommand<WorkspaceHistory>({
    cwd: () => "C:/repo",
    readHistory: async () => ({ entries: [] }),
    historyPath: (root) => `${root}/.agent/workspaces.json`,
    resolvePath: (root, value) => `${root}/${value}`,
    recordHistoryEntry: async (root, workspace) => {
      events.push(`record:${root}:${workspace}`);
      return workspace;
    },
    resolveWorkspaceSelector: async () => "unused",
    renderHistory: () => events.push("render"),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "workspace", args: ["add", "project"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "record:C:/repo:C:/repo/project",
    "text:workspace=C:/repo/project",
    "text:config=C:/repo/.agent/workspaces.json",
  ]);
});

test("createWorkspaceCommand selects workspaces and prints next command", async () => {
  const events: string[] = [];
  const command = createWorkspaceCommand<WorkspaceHistory>({
    cwd: () => "C:/repo",
    readHistory: async () => ({ entries: [] }),
    historyPath: (root) => `${root}/.agent/workspaces.json`,
    resolvePath: (root, value) => `${root}/${value}`,
    recordHistoryEntry: async (root, workspace) => {
      events.push(`record:${root}:${workspace}`);
      return workspace;
    },
    resolveWorkspaceSelector: async (root, selector, relativeRoot) => {
      events.push(`select:${root}:${selector}:${relativeRoot}`);
      return "C:/selected";
    },
    renderHistory: () => events.push("render"),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "workspace", args: ["use", "1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "select:C:/repo:1:C:/repo",
    "record:C:/repo:C:/selected",
    "text:workspace=C:/selected",
    "text:active=C:/selected",
    "text:config=C:/repo/.agent/workspaces.json",
    'text:next=soloclaw tui --workspace "C:/selected"',
  ]);
});

test("createWorkspaceCommand reports missing add path", async () => {
  const events: string[] = [];
  const command = createWorkspaceCommand<WorkspaceHistory>({
    cwd: () => "C:/repo",
    readHistory: async () => ({ entries: [] }),
    historyPath: () => "unused",
    resolvePath: (root, value) => `${root}/${value}`,
    recordHistoryEntry: async () => "unused",
    resolveWorkspaceSelector: async () => "unused",
    renderHistory: () => events.push("render"),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "workspace", args: ["add"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Usage: soloclaw workspace add <path>", "exit:1"]);
});

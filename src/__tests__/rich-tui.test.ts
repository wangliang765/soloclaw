import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { clip, padRight, visibleLength } from "../cli/tui/ansi.js";
import { renderEventRow, renderProjectedAssistantPartRow } from "../cli/tui/event-renderer.js";
import { renderConversationScreen, renderWelcomeScreen } from "../cli/tui/layout.js";
import { TUI_COMMANDS } from "../cli/tui/commands.js";
import { nextMode } from "../cli/tui/state.js";
import type { RichTuiState } from "../cli/tui/state.js";
import { MODEL_PROVIDER_PROFILES } from "../model/provider-profiles.js";

test("rich tui width helpers count CJK characters as double-width", () => {
  assert.equal(visibleLength("\u4f60\u597d"), 4);
  assert.equal(clip("\u4f60\u597d\u4e16\u754c", 5), "\u4f60...");
  assert.equal(padRight("\u4f60\u597d", 6), "\u4f60\u597d  ");
});

test("rich tui welcome screen shows Soloclaw workbench ledger entry points", () => {
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "",
    messages: [],
    events: [],
  };
  const screen = renderWelcomeScreen(state, { columns: 100, rows: 30 });
  assert.match(screen, /SOLOCLAW Workbench/);
  assert.match(screen, /MISSION/);
  assert.match(screen, /MODEL/);
  assert.match(screen, /NEXT/);
  assert.match(screen, /INPUT DOCK/);
  assert.match(screen, /Build/);
  assert.match(screen, /deepseek-v4-flash/);
  assert.match(screen, /E:\\code\\agent/);
  assert.doesNotMatch(screen, /Ask anything/);
  assert.doesNotMatch(screen, /___.*\/ /);
});

test("rich tui layout falls back gracefully on narrow terminals", () => {
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "mock",
    model: "mock",
    readiness: "fail",
    mode: "Build",
    input: "hello",
    messages: [],
    events: [],
  };
  const screen = renderWelcomeScreen(state, { columns: 40, rows: 12 });
  assert.equal(screen.includes("\n"), true);
  assert.match(screen, /soloclaw/i);
});

test("rich tui conversation screen shows work ledger without right status rail", () => {
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Plan",
    input: "Add a lightning tower",
    messages: [
      { role: "user", text: "hello" },
      { role: "assistant", text: "Hello. What can I help with?" },
    ],
    events: [],
    context: { tokens: 9584, percentUsed: 5, spentUsd: 0 },
    lsp: { enabled: false, label: "LSPs are disabled" },
    objective: "Add lightning tower",
    runHealth: "Working",
    version: "0.2.0",
  };
  const screen = renderConversationScreen(state, { columns: 140, rows: 34 });
  assert.match(screen, /SOLOCLAW Workbench/);
  assert.match(screen, /MISSION/);
  assert.match(screen, /LEDGER/);
  assert.match(screen, /CHECKS/);
  assert.match(screen, /Plan/);
  assert.match(screen, /Run: Working/);
  assert.match(screen, /Working/);
  assert.match(screen, /Context:/);
  assert.match(screen, /9\.6K/);
  assert.match(screen, /5%/);
  assert.match(screen, /LSPs are disabled/);
  assert.match(screen, /deepseek-v4-flash/);
});

test("rich tui work ledger renders projected assistant parts inside bounded main lane", () => {
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "新增闪电塔，攻速快，每5次攻击范围伤害",
    messages: [{ role: "user", text: "新增一个符塔：闪电塔，特点是攻速快，每5次攻击会造成范围伤害" }],
    events: [],
    projectedAssistantMessages: [{
      role: "assistant",
      runId: "run_cockpit",
      sessionId: "sess_cockpit",
      parts: [
        { type: "status", title: "Thinking step 1", step: 1, status: "started" },
        { type: "text", step: 1, text: "我会先检查游戏数据结构。" },
        {
          type: "tool",
          step: 1,
          callId: "call_read",
          toolName: "read_file",
          title: "Read src/content.js",
          status: "ok",
          detailsHidden: true,
          paths: ["src/content.js"],
          safeDetails: { paths: ["src/content.js"], durationMs: 12 },
        },
      ],
    }],
    context: { tokens: 1200, percentUsed: 3 },
    runHealth: "Working",
    currentActivity: "Reading",
    stepCount: 1,
  };

  const screen = renderConversationScreen(state, { columns: 140, rows: 28 });
  const lines = screen.split("\n");

  assert.match(screen, /LEDGER/);
  assert.match(screen, /Thinking step 1/);
  assert.match(screen, /我会先检查游戏数据结构。/);
  assert.match(screen, /Read src\/content\.js/);
  assert.match(screen, /details hidden/);
  assert.equal(screen.includes("raw stdout"), false);
  assert.equal(lines.every((line) => visibleLength(line) <= 140), true);
});

test("rich TUI workbench checks show workspace dirty summary", async () => {
  const { createStatusMessage } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "",
    messages: [],
    events: [],
    workspaceStatus: {
      insideWorkTree: true,
      branch: "phase-two",
      dirtyCount: 18,
      dirtyFiles: ["src/cli/tui/layout.ts", "src/cli/tui/state.ts"],
    },
  };

  const screen = renderConversationScreen(state, { columns: 140, rows: 28 });
  const status = createStatusMessage(state);

  assert.match(screen, /phase-two/);
  assert.match(screen, /18 changed/);
  assert.match(status, /Workspace: E:\\code\\agent/);
  assert.match(status, /Git: phase-two, 18 changed/);
});

test("bottom status shows context unavailable when usage is missing", () => {
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "mock",
    model: "mock",
    readiness: "pass",
    mode: "Build",
    input: "",
    messages: [],
    events: [],
    lsp: { enabled: false, label: "LSPs are disabled" },
  };
  const screen = renderConversationScreen(state, { columns: 120, rows: 24 });
  assert.match(screen, /context n\/a/);
});

test("event renderer hides command details by default", () => {
  const row = renderEventRow({
    type: "tool_finished",
    runId: "run_test",
    step: 2,
    callId: "call_test",
    toolName: "run_command",
    title: "Run command",
    status: "ok",
    detailsHidden: true,
    exitCode: 0,
    durationMs: 34,
  });
  assert.match(row, /Run command/);
  assert.match(row, /hidden/);
  assert.equal(row.includes("npm test"), false);
});

test("event renderer renders projected assistant parts without raw details", () => {
  const row = renderProjectedAssistantPartRow({
    type: "tool",
    step: 1,
    callId: "call_test",
    toolName: "run_command",
    title: "Run command",
    status: "ok",
    detailsHidden: true,
    durationMs: 14,
    exitCode: 0,
  });

  assert.match(row, /Run command/);
  assert.match(row, /details hidden/);
  assert.equal(row.includes("npm test"), false);
});

test("event renderer expands only safe projected tool details", () => {
  const part = {
    type: "tool" as const,
    step: 1,
    callId: "call_test",
    toolName: "run_command",
    title: "Run command",
    status: "ok" as const,
    detailsHidden: true,
    safeDetails: {
      paths: ["README.md"],
      exitCode: 0,
      timedOut: false,
      durationMs: 14,
      stdoutBytes: 120,
      stderrBytes: 0,
    },
  };

  const collapsed = renderProjectedAssistantPartRow(part, 120);
  const expanded = renderProjectedAssistantPartRow(part, 120, { expanded: true });

  assert.equal(collapsed.includes("stdout=120B"), false);
  assert.match(expanded, /README\.md/);
  assert.match(expanded, /exit=0/);
  assert.match(expanded, /stdout=120B/);
  assert.match(expanded, /stderr=0B/);
  assert.equal(expanded.includes("npm test"), false);
  assert.equal(expanded.includes("raw stdout"), false);
});

test("event renderer shows public reasoning lifecycle without raw reasoning", () => {
  const rawReasoning = "private chain-of-thought sk-testsecretvalue1234567890";
  const row = renderEventRow({
    type: "reasoning_delta",
    runId: "run_reason",
    step: 1,
    publicSummary: "Thinking",
    deltaCount: 2,
    text: rawReasoning,
  } as never);

  assert.match(row, /Thinking/);
  assert.equal(row.includes(rawReasoning), false);
  assert.equal(row.includes("sk-testsecretvalue1234567890"), false);
});

test("rich TUI is selected only for interactive terminals", async () => {
  const { shouldUseRichTui } = await import("../cli/tui/rich-shell.js");
  assert.equal(shouldUseRichTui({ stdinIsTTY: true, stdoutIsTTY: true, forcePlain: false }), true);
  assert.equal(shouldUseRichTui({ stdinIsTTY: false, stdoutIsTTY: true, forcePlain: false }), false);
  assert.equal(shouldUseRichTui({ stdinIsTTY: true, stdoutIsTTY: true, forcePlain: true }), false);
});

test("rich TUI mode cycles plan build and goal", () => {
  assert.equal(nextMode("Plan"), "Build");
  assert.equal(nextMode("Build"), "Goal");
  assert.equal(nextMode("Goal"), "Plan");
});

test("rich TUI mode command can cycle or select a mode", async () => {
  const { resolveModeCommand } = await import("../cli/tui/rich-shell.js");
  assert.equal(resolveModeCommand("Plan", "/mode"), "Build");
  assert.equal(resolveModeCommand("Build", "/mode goal"), "Goal");
  assert.equal(resolveModeCommand("Goal", "/mode plan"), "Plan");
  assert.equal(resolveModeCommand("Goal", "/mode unknown"), undefined);
});

test("rich TUI model setup result updates visible model status", async () => {
  const { applyModelSetupResult } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "mock",
    model: "mock",
    readiness: "fail",
    mode: "Build",
    input: "",
    messages: [],
    events: [],
  };

  applyModelSetupResult(state, {
    provider: "deepseek",
    model: "deepseek-chat",
    readiness: "pass",
  });

  assert.equal(state.provider, "deepseek");
  assert.equal(state.model, "deepseek-chat");
  assert.equal(state.readiness, "pass");
  assert.equal(state.messages.at(-1)?.text, "Model: deepseek deepseek-chat");
});

test("rich TUI status message summarizes model context and run health", async () => {
  const { createStatusMessage } = await import("../cli/tui/rich-shell.js");
  const message = createStatusMessage({
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Goal",
    input: "",
    messages: [],
    events: [],
    context: { tokens: 9584, percentUsed: 5 },
    lsp: { enabled: false, label: "LSPs are disabled" },
    runHealth: "Working",
  });

  assert.match(message, /Run: Working/);
  assert.match(message, /Mode: Goal/);
  assert.match(message, /Provider: deepseek/);
  assert.match(message, /Model: deepseek-v4-flash/);
  assert.match(message, /Context: 9\.6K tokens \(5%\)/);
  assert.match(message, /Workspace: E:\\code\\agent/);
});

test("rich TUI explains mode semantics in status surfaces", async () => {
  const { createStatusMessage } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Plan",
    input: "",
    messages: [{ role: "user", text: "Design the change first" }],
    events: [],
    runHealth: "Ready",
  };

  assert.match(createStatusMessage(state), /Mode: Plan - read-only planning/);
  assert.match(renderConversationScreen(state, { columns: 120, rows: 28 }), /Plan - read-only planning/);
});

test("rich TUI command palette renders a movable selected command", async () => {
  const { commandPaletteLine, moveCommandPaletteCursor, openCommandPalette } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "",
    messages: [],
    events: [],
  };

  openCommandPalette(state);
  moveCommandPaletteCursor(state, commandCursorDelta("/status"));

  assert.equal(state.commandPalette?.open, true);
  assert.equal(commandPaletteLine(state), "/status");
  const screen = renderConversationScreen(state, { columns: 120, rows: 24 });
  assert.match(screen, /Commands/);
  assert.match(screen, /> \[ \] \/status/);
});

test("rich TUI sessions message summarizes recent sessions", async () => {
  const { createSessionsMessage } = await import("../cli/tui/rich-shell.js");
  const message = createSessionsMessage({
    returned: 1,
    scanned: 3,
    limit: 5,
    byStatus: { completed: 1 },
    byOutcome: { succeeded: 1 },
    pendingApprovals: 0,
    changedSessions: 1,
    sessions: [
      {
        id: "sess_test",
        targetMode: "build",
        status: "completed",
        outcome: "succeeded",
        pendingApprovals: 0,
        commandsFinished: 2,
        failedCommands: 0,
        changedPaths: ["src/game.js"],
        updatedAt: "2026-06-18T10:00:00.000Z",
        objective: "Add a lightning tower",
        handoffState: "ready",
        handoffNextCommand: "agent session verify sess_test",
      },
    ],
  });

  assert.match(message, /Sessions: 1\/3/);
  assert.match(message, /status=completed:1/);
  assert.match(message, /outcome=succeeded:1/);
  assert.match(message, /sess_test build completed/);
  assert.match(message, /objective: Add a lightning tower/);
  assert.match(message, /changes: src\/game\.js/);
  assert.match(message, /next: agent session verify sess_test/);
});

test("rich TUI key handler covers command palette mode and exit shortcuts", async () => {
  const { handleRichTuiKey } = await import("../cli/tui/rich-shell.js");
  const { renderConversationScreen, renderWelcomeScreen } = await import("../cli/tui/layout.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "",
    messages: [],
    events: [],
  };

  assert.equal(handleRichTuiKey(state, { key: { ctrl: true, name: "p" } }), "redraw");
  assert.equal(state.commandPalette?.open, true);
  for (let index = 0; index < commandCursorDelta("/model check"); index += 1) {
    assert.equal(handleRichTuiKey(state, { key: { name: "down" } }), "redraw");
  }
  assert.equal(handleRichTuiKey(state, { value: " ", key: { name: "space" } }), "redraw");
  assert.equal(state.commandPalette?.open, false);
  assert.equal(state.input, "/model check");

  assert.equal(handleRichTuiKey(state, { key: { ctrl: true, name: "m" } }), "redraw");
  assert.equal(state.mode, "Goal");
  assert.equal(handleRichTuiKey(state, { key: { name: "f2" } }), "redraw");
  assert.equal(state.mode, "Plan");
  assert.match(renderWelcomeScreen(state, { columns: 120, rows: 28 }), /f2.*mode/);
  assert.match(renderConversationScreen({ ...state, messages: [{ role: "user", text: "hello" }] }, { columns: 120, rows: 28 }), /f2 mode/);

  assert.equal(handleRichTuiKey(state, { key: { ctrl: true, name: "p" } }), "redraw");
  assert.equal(handleRichTuiKey(state, { key: { ctrl: true, name: "c" } }), "exit");
});

test("rich TUI key handler submits selected command on enter", async () => {
  const { handleRichTuiKey, moveCommandPaletteCursor, openCommandPalette } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "",
    messages: [],
    events: [],
  };

  openCommandPalette(state);
  moveCommandPaletteCursor(state, commandCursorDelta("/status"));

  assert.equal(handleRichTuiKey(state, { key: { name: "return" } }), "submit");
  assert.equal(state.commandPalette?.open, false);
  assert.equal(state.input, "/status");
});

test("rich TUI input history recalls previous prompts without losing draft", async () => {
  const { handleRichTuiKey, submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "mock",
    model: "mock",
    readiness: "pass",
    mode: "Build",
    input: "first task",
    messages: [],
    events: [],
  };

  await submitRichTuiInput(state, { runTask: async () => ({ answer: "done" }) });
  state.input = "second task";
  await submitRichTuiInput(state, { runTask: async () => ({ answer: "done" }) });
  state.input = "draft task";

  assert.equal(handleRichTuiKey(state, { key: { name: "up" } }), "redraw");
  assert.equal(state.input, "second task");
  assert.equal(handleRichTuiKey(state, { key: { name: "up" } }), "redraw");
  assert.equal(state.input, "first task");
  assert.equal(handleRichTuiKey(state, { key: { name: "down" } }), "redraw");
  assert.equal(state.input, "second task");
  assert.equal(handleRichTuiKey(state, { key: { name: "down" } }), "redraw");
  assert.equal(state.input, "draft task");
});

test("rich TUI supports multiline input with shift enter", async () => {
  const { handleRichTuiKey } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "first line",
    messages: [],
    events: [],
  };

  assert.equal(handleRichTuiKey(state, { key: { name: "return", shift: true } }), "redraw");
  for (const char of "second line") {
    assert.equal(handleRichTuiKey(state, { value: char, key: { name: char } }), "redraw");
  }

  const screen = renderConversationScreen(state, { columns: 100, rows: 22 });
  const lines = screen.split("\n");
  assert.equal(state.input, "first line\nsecond line");
  assert.match(screen, /first line/);
  assert.match(screen, /second line/);
  assert.equal(lines.some((line) => line.includes("first line\nsecond line")), false);
  assert.equal(lines.every((line) => visibleLength(line) <= 100), true);
});

test("rich TUI transcript focus scrolls without changing input history", async () => {
  const { handleRichTuiKey } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "mock",
    model: "mock",
    readiness: "pass",
    mode: "Build",
    focus: "transcript",
    input: "draft task",
    inputHistory: ["older task"],
    messages: Array.from({ length: 12 }, (_, index) => ({ role: "assistant" as const, text: `message ${index + 1}` })),
    events: [],
  };

  assert.equal(handleRichTuiKey(state, { key: { name: "up" } }), "redraw");
  assert.equal(state.input, "draft task");
  assert.equal(state.transcriptScrollOffset, 1);
  assert.equal(handleRichTuiKey(state, { key: { name: "down" } }), "redraw");
  assert.equal(state.input, "draft task");
  assert.equal(state.transcriptScrollOffset, 0);
});

test("rich TUI transcript scroll offset changes the visible transcript window", () => {
  const baseState: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "mock",
    model: "mock",
    readiness: "pass",
    mode: "Build",
    focus: "transcript",
    input: "draft task",
    messages: Array.from({ length: 12 }, (_, index) => ({ role: "assistant" as const, text: `message ${index + 1}` })),
    events: [],
  };

  const latestScreen = renderConversationScreen({ ...baseState, transcriptScrollOffset: 0 }, { columns: 100, rows: 18 });
  const scrolledScreen = renderConversationScreen({ ...baseState, transcriptScrollOffset: 4 }, { columns: 100, rows: 18 });

  assert.match(latestScreen, /message 12/);
  assert.doesNotMatch(scrolledScreen, /message 12/);
  assert.match(scrolledScreen, /message 8/);
});

test("rich TUI projects assistant text deltas into one transcript message", async () => {
  const { applyAgentRunEventToRichState } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "",
    messages: [],
    events: [],
  };

  applyAgentRunEventToRichState(state, { type: "assistant_text", runId: "run_test", step: 1, text: "hel" });
  applyAgentRunEventToRichState(state, { type: "assistant_text", runId: "run_test", step: 1, text: "lo" });
  applyAgentRunEventToRichState(state, { type: "assistant_text", runId: "run_test", step: 1, text: "hello", final: true });
  applyAgentRunEventToRichState(state, {
    type: "tool_finished",
    runId: "run_test",
    step: 1,
    callId: "call_read",
    toolName: "read_file",
    title: "Read README.md",
    status: "ok",
    detailsHidden: true,
  });

  assert.deepEqual(state.messages, [{ role: "assistant", text: "hello" }]);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0]?.type, "tool_finished");
});

test("rich TUI keeps replayable assistant projection from agent events", async () => {
  const { applyAgentRunEventToRichState } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "",
    messages: [],
    events: [],
  };

  applyAgentRunEventToRichState(state, { type: "step_started", runId: "run_test", sessionId: "sess_test", step: 1 });
  applyAgentRunEventToRichState(state, { type: "assistant_text", runId: "run_test", sessionId: "sess_test", step: 1, text: "hel" });
  applyAgentRunEventToRichState(state, { type: "assistant_text", runId: "run_test", sessionId: "sess_test", step: 1, text: "lo" });
  applyAgentRunEventToRichState(state, {
    type: "tool_finished",
    runId: "run_test",
    sessionId: "sess_test",
    step: 1,
    callId: "call_read",
    toolName: "read_file",
    title: "Read README.md",
    status: "ok",
    detailsHidden: true,
    paths: ["README.md"],
  });

  assert.equal(state.projectedAssistantMessages?.length, 1);
  const parts = state.projectedAssistantMessages?.[0]?.parts;
  assert.deepEqual(parts?.map((part) => part.type), ["status", "text", "tool"]);
  assert.equal(parts?.[1]?.type === "text" ? parts[1].text : "", "hello");
  const toolPart = parts?.find((part) => part.type === "tool");
  assert.equal(toolPart?.type === "tool" ? toolPart.status : "", "ok");
  assert.deepEqual(toolPart?.type === "tool" ? toolPart.paths : undefined, ["README.md"]);
});

test("rich TUI projects agent events into safe activity and step status", async () => {
  const { applyAgentRunEventToRichState } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "",
    messages: [],
    events: [],
  };

  applyAgentRunEventToRichState(state, { type: "step_started", runId: "run_test", step: 2, provider: "deepseek", model: "deepseek-v4-flash" });

  assert.equal(state.currentActivity, "Thinking");
  assert.equal(state.stepCount, 2);

  applyAgentRunEventToRichState(state, {
    type: "tool_started",
    runId: "run_test",
    step: 2,
    callId: "call_search",
    toolName: "search_text",
    title: "Search workspace",
    detailsHidden: true,
  });

  assert.equal(state.currentActivity, "Searching");
  assert.equal(state.lastEventTitle, "Search workspace");

  applyAgentRunEventToRichState(state, {
    type: "tool_started",
    runId: "run_test",
    step: 3,
    callId: "call_patch",
    toolName: "apply_patch",
    title: "Edit files",
    detailsHidden: true,
  });

  assert.equal(state.currentActivity, "Editing");
  assert.equal(state.stepCount, 3);

  applyAgentRunEventToRichState(state, { type: "step_limit_reached", runId: "run_test", maxSteps: 30 });

  assert.equal(state.currentActivity, "Stopped");
});

test("rich TUI renders current activity and step in conversation chrome", () => {
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "",
    messages: [{ role: "user", text: "Add a lightning tower" }],
    events: [],
    runHealth: "Working",
    currentActivity: "Editing",
    stepCount: 3,
    lastEventTitle: "Edit files",
  };

  const screen = renderConversationScreen(state, { columns: 140, rows: 28 });

  assert.match(screen, /Activity/);
  assert.match(screen, /Editing/);
  assert.match(screen, /Step 3/);
  assert.match(screen, /Edit files/);
});

test("rich TUI stopped runs show resume guidance", async () => {
  const { createStatusMessage } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Goal",
    input: "",
    messages: [{ role: "user", text: "Finish this long task" }],
    events: [],
    runHealth: "Stopped",
    currentActivity: "Stopped",
    activeSessionId: "sess_long",
  };

  assert.match(createStatusMessage(state), /Next: \/continue or \/resume/);
  assert.match(renderConversationScreen(state, { columns: 120, rows: 28 }), /Next/);
  assert.match(renderConversationScreen(state, { columns: 120, rows: 28 }), /\/resume/);
  assert.match(renderConversationScreen(state, { columns: 120, rows: 28 }), /\/continue/);
});

test("rich TUI does not duplicate final answer after streamed final text", async () => {
  const { applyAgentRunEventToRichState, commitAssistantAnswer } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "",
    messages: [],
    events: [],
  };

  applyAgentRunEventToRichState(state, { type: "assistant_text", runId: "run_test", step: 1, text: "done", final: true });
  commitAssistantAnswer(state, "done");

  assert.deepEqual(state.messages, [{ role: "assistant", text: "done" }]);
});

test("rich TUI submit appends status and clears input", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/status",
    messages: [],
    events: [],
    runHealth: "Ready",
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  assert.equal(state.input, "");
  assert.equal(state.messages.length, 1);
  assert.match(state.messages[0]?.text ?? "", /Provider: deepseek/);
});

test("rich TUI submit shows phase2 closure status", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  assert.equal(TUI_COMMANDS.some((entry) => entry.command === "/phase2 status"), true);
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 status",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  assert.equal(state.input, "");
  assert.equal(state.messages.length, 1);
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /Phase 2 closure status/);
  assert.match(message, /status=pending_manual_evidence/);
  assert.match(message, /C1 external terminal rich TUI: pending/);
  assert.match(message, /C2 real-provider setup and task: pending/);
  assert.match(message, /C3 final automated gate: waiting_for_C1_C2/);
  assert.doesNotMatch(message, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(message, /Authorization:\s*Bearer/i);
});

test("rich TUI submit shows phase2 real-provider readiness", async (t) => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  assert.equal(TUI_COMMANDS.some((entry) => entry.command === "/phase2 readiness"), true);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-rich-phase2-readiness-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const state: RichTuiState = {
    workspace: dir,
    provider: "mock",
    model: "mock",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 readiness",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /Phase 2 real-provider readiness/);
  assert.match(message, /status=missing_real_provider/);
  assert.match(message, /realProviderConfigured: fail/);
  assert.match(message, /Record and review evidence: soloclaw phase2 closeout-wizard --section C1\|C2\|C3/);
  assert.match(message, /This readiness check does not satisfy C2/);
  assert.doesNotMatch(message, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(message, /Authorization:\s*Bearer/i);
});

test("rich TUI submit shows phase2 gate summary", async (t) => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  assert.equal(TUI_COMMANDS.some((entry) => entry.command === "/phase2 gate"), true);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-rich-phase2-gate-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const planPath = path.join(dir, "docs", "superpowers", "plans", "2026-06-18-soloclaw-rich-tui-event-stream.md");
  await fs.mkdir(path.dirname(planPath), { recursive: true });
  await fs.writeFile(
    planPath,
    [
      "- [ ] **C1: Record a real external terminal rich-TUI smoke**",
      "### C1 external terminal rich-TUI evidence",
      "- Date: 2026-06-19",
      "- Terminal: Windows Terminal",
      "- [ ] **C2: Record one real-provider setup and natural-language run**",
      "### C2 real-provider setup and task evidence",
      "- Date: 2026-06-19",
      "- Provider: deepseek",
      "- [ ] **C3: Re-run the full automated completion gate after C1 and C2**",
      "### C3 final automated gate evidence",
      "- Date: 2026-06-19",
      "- npm.cmd run check: pass",
    ].join("\n"),
  );
  const state: RichTuiState = {
    workspace: dir,
    provider: "mock",
    model: "mock",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 gate",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /Phase 2 gate summary/);
  assert.match(message, /status=blocked_manual_evidence/);
  assert.match(message, /strictEvidence=incomplete_closure_tasks/);
  assert.match(message, /C1 closure task is still unchecked/);
  assert.match(message, /\/model setup/);
  assert.match(message, /C1: review saved evidence, then run `soloclaw phase2 closure-task --section C1 --confirm-reviewed`/);
  assert.match(message, /C3: review saved evidence, then run `soloclaw phase2 closure-task --section C3 --confirm-reviewed`/);
  assert.match(message, /soloclaw phase2 gate/);
  assert.doesNotMatch(message, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(message, /Authorization:\s*Bearer/i);
});

test("rich TUI submit shows the next phase2 closeout action", async (t) => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  assert.equal(TUI_COMMANDS.some((entry) => entry.command === "/phase2 next"), true);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-rich-phase2-next-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const planPath = path.join(dir, "docs", "superpowers", "plans", "2026-06-18-soloclaw-rich-tui-event-stream.md");
  await fs.mkdir(path.dirname(planPath), { recursive: true });
  await fs.writeFile(
    planPath,
    [
      "- [ ] **C1: Record a real external terminal rich-TUI smoke**",
      "### C1 external terminal rich-TUI evidence",
      "- Date: 2026-06-19",
      "- Terminal: Windows Terminal",
      "- [ ] **C2: Record one real-provider setup and natural-language run**",
      "### C2 real-provider setup and task evidence",
      "- Date: 2026-06-19",
      "- Provider: deepseek",
      "- [ ] **C3: Re-run the full automated completion gate after C1 and C2**",
      "### C3 final automated gate evidence",
      "- Date: 2026-06-19",
      "- npm.cmd run check: pass",
    ].join("\n"),
  );
  const state: RichTuiState = {
    workspace: dir,
    provider: "mock",
    model: "mock",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 next",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /Phase 2 next action/);
  assert.match(message, /blocker=C1/);
  assert.match(message, /C1: review saved evidence, then run `soloclaw phase2 closure-task --section C1 --confirm-reviewed`/);
  assert.doesNotMatch(message, /\/model setup/);
  assert.doesNotMatch(message, /record dated C3 evidence/);
  assert.doesNotMatch(message, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(message, /Authorization:\s*Bearer/i);
});

test("rich TUI phase2 next prefers closeout-wizard when dated evidence is missing", async (t) => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-rich-phase2-next-wizard-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const planPath = path.join(dir, "docs", "superpowers", "plans", "2026-06-18-soloclaw-rich-tui-event-stream.md");
  await fs.mkdir(path.dirname(planPath), { recursive: true });
  await fs.writeFile(
    planPath,
    [
      "- [ ] **C1: Record a real external terminal rich-TUI smoke**",
      "### C1 external terminal rich-TUI evidence",
      "- [ ] **C2: Record one real-provider setup and natural-language run**",
      "### C2 real-provider setup and task evidence",
      "- [ ] **C3: Re-run the full automated completion gate after C1 and C2**",
      "### C3 final automated gate evidence",
    ].join("\n"),
  );
  const state: RichTuiState = {
    workspace: dir,
    provider: "mock",
    model: "mock",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 next",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /strictEvidence=missing_dated_evidence/);
  assert.match(message, /soloclaw phase2 closeout-wizard --all/);
  assert.match(message, /soloclaw phase2 closeout-wizard --section C1/);
  assert.doesNotMatch(message, /record dated evidence with `soloclaw phase2 evidence-record --section C1`/);
  assert.doesNotMatch(message, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(message, /Authorization:\s*Bearer/i);
});

test("rich TUI submit shows the phase2 review board", async (t) => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  assert.equal(TUI_COMMANDS.some((entry) => entry.command === "/phase2 review"), true);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-rich-phase2-review-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const planPath = path.join(dir, "docs", "superpowers", "plans", "2026-06-18-soloclaw-rich-tui-event-stream.md");
  await fs.mkdir(path.dirname(planPath), { recursive: true });
  await fs.writeFile(
    planPath,
    [
      "- [x] **C1: Record a real external terminal rich-TUI smoke**",
      "### C1 external terminal rich-TUI evidence",
      "- Date: 2026-06-19",
      "- Terminal: Windows Terminal",
      "- [ ] **C2: Record one real-provider setup and natural-language run**",
      "### C2 real-provider setup and task evidence",
      "- Date: 2026-06-19",
      "- Provider: deepseek",
      "- [ ] **C3: Re-run the full automated completion gate after C1 and C2**",
      "### C3 final automated gate evidence",
      "- Date: 2026-06-19",
      "- npm.cmd run check: pass",
    ].join("\n"),
  );
  const state: RichTuiState = {
    workspace: dir,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 review",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /Phase 2 review board/);
  assert.match(message, /C1 evidence=recorded review=checked/);
  assert.match(message, /C2 evidence=recorded review=needs_review/);
  assert.match(message, /C3 evidence=recorded review=needs_review/);
  assert.match(message, /soloclaw phase2 closure-task --section C2 --confirm-reviewed/);
  assert.match(message, /Next review action:/);
  assert.match(message, /C2: review saved evidence, then run `soloclaw phase2 closure-task --section C2 --confirm-reviewed`/);
  assert.doesNotMatch(message, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(message, /Authorization:\s*Bearer/i);
});

test("rich TUI submit shows one safe phase2 evidence section", async (t) => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-rich-phase2-evidence-show-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const planPath = path.join(dir, "docs", "superpowers", "plans", "2026-06-18-soloclaw-rich-tui-event-stream.md");
  await fs.mkdir(path.dirname(planPath), { recursive: true });
  await fs.writeFile(
    planPath,
    [
      "- [ ] **C1: Record a real external terminal rich-TUI smoke**",
      "### C1 external terminal rich-TUI evidence",
      "- Date: 2026-06-19",
      "- Terminal: Windows Terminal",
      "- Result: Rich TUI rendered cleanly.",
      "- Secret check: sk-richPhase2EvidenceShowLeak123456789",
      "### C2 real-provider setup and task evidence",
      "- Date: 2026-06-19",
      "- Provider: deepseek",
      "### C3 final automated gate evidence",
      "- Date: 2026-06-19",
      "- npm.cmd run check: pass",
    ].join("\n"),
  );
  const state: RichTuiState = {
    workspace: dir,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 evidence C1",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /Phase 2 evidence review/);
  assert.match(message, /section=C1/);
  assert.match(message, /Terminal: Windows Terminal/);
  assert.match(message, /\[REDACTED_SECRET\]/);
  assert.match(message, /next=soloclaw phase2 closure-task --section C1 --confirm-reviewed/);
  assert.doesNotMatch(message, /sk-richPhase2EvidenceShowLeak123456789/);
  assert.doesNotMatch(message, /Authorization:\s*Bearer/i);
});

test("rich TUI submit shows the phase2 external terminal launch command", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  assert.equal(TUI_COMMANDS.some((entry) => entry.command === "/phase2 launch-terminal"), true);
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 launch-terminal",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /Phase 2 external terminal launcher/);
  assert.match(message, /launched=false/);
  assert.match(message, /powershell\.exe/);
  assert.match(message, /Set-Location -LiteralPath/);
  assert.match(message, /node dist\\cli\\index\.js/);
  assert.match(message, /\/model setup/);
  assert.match(message, /otherwise skip setup/);
  assert.match(message, /\/model check/);
  assert.match(message, /soloclaw phase2 evidence-template/);
  assert.match(message, /copy the command above into Windows Terminal or PowerShell/);
  assert.doesNotMatch(message, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(message, /Authorization:\s*Bearer/i);
  assert.doesNotMatch(message, /AGENT_SECRETS_PASSPHRASE=.+/);
});

test("rich TUI submit shows the phase2 final-gate command plan", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  assert.equal(TUI_COMMANDS.some((entry) => entry.command === "/phase2 final-gate"), true);
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 final-gate",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /Phase 2 final automated gate/);
  assert.match(message, /npm\.cmd run check|npm run check/);
  assert.match(message, /npm\.cmd test|npm test/);
  assert.match(message, /node dist\\cli\\index\.js smoke --rich-tui/);
  assert.match(message, /node dist\\cli\\index\.js smoke --rich-tui-real-provider/);
  assert.match(message, /git diff --check/);
  assert.match(message, /temp-file scan/);
  assert.match(message, /soloclaw phase2 closeout-wizard --section C3/);
  assert.match(message, /Fallback manual command:/);
  assert.match(message, /soloclaw phase2 evidence-record --section C3/);
  assert.match(message, /Only use the fallback if the wizard is not usable/);
  assert.match(message, /only prints the C3 gate plan/);
  assert.doesNotMatch(message, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(message, /Authorization:\s*Bearer/i);
  assert.doesNotMatch(message, /AGENT_SECRETS_PASSPHRASE=.+/);
});

test("rich TUI submit shows phase2 checklist and evidence template", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  assert.equal(TUI_COMMANDS.some((entry) => entry.command === "/phase2 checklist"), true);
  assert.equal(TUI_COMMANDS.some((entry) => entry.command === "/phase2 evidence-template"), true);
  const checklistState: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 checklist",
    messages: [],
    events: [],
  };
  const evidenceState: RichTuiState = {
    ...checklistState,
    input: "/phase2 evidence-template",
    messages: [],
    events: [],
  };

  const checklistAction = await submitRichTuiInput(checklistState);
  const evidenceAction = await submitRichTuiInput(evidenceState);

  assert.equal(checklistAction.type, "redraw");
  assert.equal(evidenceAction.type, "redraw");
  const checklist = checklistState.messages[0]?.text ?? "";
  const evidence = evidenceState.messages[0]?.text ?? "";
  assert.match(checklist, /Phase 2 manual closure checklist/);
  assert.match(checklist, /C1 external terminal rich TUI/);
  assert.match(checklist, /C2 real-provider setup/);
  assert.match(checklist, /If readiness reports a problem, run \/model setup; otherwise skip setup/);
  assert.match(checklist, /C3 automated completion gate/);
  assert.match(evidence, /Phase 2 evidence notes template/);
  assert.match(evidence, /C1 external terminal rich-TUI evidence/);
  assert.match(evidence, /C2 real-provider setup and task evidence/);
  assert.match(evidence, /Never record API keys/);
  assert.doesNotMatch(`${checklist}\n${evidence}`, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(`${checklist}\n${evidence}`, /Authorization:\s*Bearer/i);
}
);

test("rich TUI submit shows phase2 closeout guide", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  assert.equal(TUI_COMMANDS.some((entry) => entry.command === "/phase2 closeout-guide"), true);
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 closeout-guide",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /Phase 2 closeout guide/);
  assert.match(message, /Step 1/);
  assert.match(message, /soloclaw phase2 launch-terminal/);
  assert.match(message, /Step 2/);
  assert.match(message, /\/phase2 readiness/);
  assert.match(message, /If readiness reports a problem: \/model setup/);
  assert.match(message, /\/model check/);
  assert.match(message, /Skip \/model setup when readiness is already ready_for_manual_run/);
  assert.match(message, /Step 3/);
  assert.match(message, /soloclaw phase2 closeout-wizard --section C1/);
  assert.match(message, /phase2 evidence-record --section C1/);
  assert.match(message, /phase2 evidence-record --section C2/);
  assert.match(message, /phase2 closure-task --section C1 --confirm-reviewed/);
  assert.match(message, /phase2 closure-task --section C2 --confirm-reviewed/);
  assert.match(message, /Step 4/);
  assert.match(message, /npm\.cmd run check/);
  assert.match(message, /soloclaw phase2 closeout-wizard --section C3/);
  assert.match(message, /phase2 evidence-record --section C3/);
  assert.match(message, /phase2 closure-task --section C3 --confirm-reviewed/);
  assert.match(message, /Step 5/);
  assert.match(message, /phase2 evidence-check --strict/);
  assert.match(message, /Do not record API keys/);
  assert.doesNotMatch(message, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(message, /Authorization:\s*Bearer/i);
  assert.doesNotMatch(message, /AGENT_SECRETS_PASSPHRASE=.+/);
});

test("rich TUI submit shows phase2 closeout wizard guide", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  assert.equal(TUI_COMMANDS.some((entry) => entry.command === "/phase2 closeout-wizard"), true);
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 closeout-wizard",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /Phase 2 closeout wizard/);
  assert.match(message, /soloclaw phase2 closeout-wizard --all/);
  assert.match(message, /soloclaw phase2 closeout-wizard --section C1/);
  assert.match(message, /soloclaw phase2 closeout-wizard --section C2/);
  assert.match(message, /soloclaw phase2 closeout-wizard --section C3/);
  assert.match(message, /Use --all for one guided pass through C1, C2, and C3 in order/);
  assert.match(message, /Never record API keys/);
  assert.doesNotMatch(message, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(message, /Authorization:\s*Bearer/i);
  assert.doesNotMatch(message, /AGENT_SECRETS_PASSPHRASE=.+/);
});

test("rich TUI submit shows phase2 operator runbook", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  assert.equal(TUI_COMMANDS.some((entry) => entry.command === "/phase2 operator-runbook"), true);
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 operator-runbook",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /Phase 2 operator runbook/);
  assert.match(message, /Current model path/);
  assert.match(message, /soloclaw phase2 launch-terminal/);
  assert.match(message, /\/phase2 readiness/);
  assert.match(message, /\/model check/);
  assert.match(message, /Inspect package\.json and report only the npm scripts whose names include test or check/);
  assert.match(message, /soloclaw phase2 evidence-show --section C1/);
  assert.match(message, /soloclaw phase2 final-gate/);
  assert.match(message, /Never record API keys/);
  assert.doesNotMatch(message, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(message, /Authorization:\s*Bearer/i);
  assert.doesNotMatch(message, /AGENT_SECRETS_PASSPHRASE=.+/);
});

test("rich TUI submit checks a reviewed phase2 closure task", async (t) => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  assert.equal(TUI_COMMANDS.some((entry) => entry.command === "/phase2 closure-task"), true);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-rich-phase2-closure-task-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const planPath = path.join(dir, "docs", "superpowers", "plans", "2026-06-18-soloclaw-rich-tui-event-stream.md");
  await fs.mkdir(path.dirname(planPath), { recursive: true });
  await fs.writeFile(
    planPath,
    [
      "- [ ] **C1: Record a real external terminal rich-TUI smoke**",
      "### C1 external terminal rich-TUI evidence",
      "- Date: 2026-06-19",
      "- Terminal: Windows Terminal",
      "- [ ] **C2: Record one real-provider setup and natural-language run**",
      "### C2 real-provider setup and task evidence",
      "- Date: 2026-06-19",
      "- Provider: deepseek",
      "- [ ] **C3: Re-run the full automated completion gate after C1 and C2**",
      "### C3 final automated gate evidence",
      "- Date: 2026-06-19",
      "- npm.cmd run check: pass",
    ].join("\n"),
  );
  const state: RichTuiState = {
    workspace: dir,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 closure-task --section C1 --confirm-reviewed",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /Phase 2 closure task updated/);
  assert.match(message, /section=C1/);
  assert.match(message, /status=checked/);
  assert.match(message, /secretMatches=0/);
  const updated = await fs.readFile(planPath, "utf8");
  assert.match(updated, /- \[x\] \*\*C1: Record a real external terminal rich-TUI smoke\*\*/);
  assert.match(updated, /- \[ \] \*\*C2: Record one real-provider setup and natural-language run\*\*/);
  assert.doesNotMatch(message + updated, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(message + updated, /Authorization:\s*Bearer/i);
});

test("rich TUI submit shows phase2 evidence check", async (t) => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  assert.equal(TUI_COMMANDS.some((entry) => entry.command === "/phase2 evidence-check"), true);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-rich-phase2-evidence-check-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const evidencePath = path.join(
    dir,
    "docs",
    "superpowers",
    "plans",
    "2026-06-18-soloclaw-rich-tui-event-stream.md",
  );
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(
    evidencePath,
    [
      "### C1 external terminal rich-TUI evidence",
      "- Date:",
      "### C2 real-provider setup and task evidence",
      "- Date:",
      "### C3 final automated gate evidence",
      "- Date:",
    ].join("\n"),
  );
  const state: RichTuiState = {
    workspace: dir,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 evidence-check",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /Phase 2 evidence check/);
  assert.match(message, /status=paste_safe_pending_manual_review/);
  assert.match(message, /file=.*2026-06-18-soloclaw-rich-tui-event-stream\.md/);
  assert.match(message, /secretMatches=0/);
  assert.doesNotMatch(message, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(message, /Authorization:\s*Bearer/i);
});

test("rich TUI submit records paste-safe phase2 evidence", async (t) => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  assert.equal(TUI_COMMANDS.some((entry) => entry.command === "/phase2 evidence-record"), true);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-rich-phase2-evidence-record-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const evidencePath = path.join(
    dir,
    "docs",
    "superpowers",
    "plans",
    "2026-06-18-soloclaw-rich-tui-event-stream.md",
  );
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(
    evidencePath,
    [
      "### C1 external terminal rich-TUI evidence",
      "",
      "### C2 real-provider setup and task evidence",
      "",
      "### C3 final automated gate evidence",
      "",
    ].join("\n"),
  );
  const state: RichTuiState = {
    workspace: dir,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: '/phase2 evidence-record --section C1 --terminal "Windows Terminal" --shell "PowerShell 7" --node v24.13.1 --result "Rich TUI worked"',
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /Phase 2 evidence recorded/);
  assert.match(message, /section=C1/);
  assert.match(message, /secretMatches=0/);
  const text = await fs.readFile(evidencePath, "utf8");
  assert.match(text, /Terminal: Windows Terminal/);
  assert.match(text, /Shell: PowerShell 7/);
  assert.match(text, /Result: Rich TUI worked/);
  assert.doesNotMatch(`${message}\n${text}`, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(`${message}\n${text}`, /Authorization:\s*Bearer/i);
});

test("rich TUI submit supports strict phase2 evidence check", async (t) => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  assert.equal(TUI_COMMANDS.some((entry) => entry.name === "/phase2 evidence-check [--strict]"), true);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-rich-phase2-evidence-check-strict-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const evidencePath = path.join(
    dir,
    "docs",
    "superpowers",
    "plans",
    "2026-06-18-soloclaw-rich-tui-event-stream.md",
  );
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(
    evidencePath,
    [
      "### C1 external terminal rich-TUI evidence",
      "- Terminal: Windows Terminal",
      "### C2 real-provider setup and task evidence",
      "- Provider: deepseek",
      "### C3 final automated gate evidence",
      "- npm.cmd run check: pass",
    ].join("\n"),
  );
  const state: RichTuiState = {
    workspace: dir,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/phase2 evidence-check --strict",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  const message = state.messages[0]?.text ?? "";
  assert.match(message, /Phase 2 evidence check/);
  assert.match(message, /status=missing_dated_evidence/);
  assert.match(message, /strict=true/);
  assert.match(message, /c1DatedEvidence: fail/);
  assert.match(message, /c2DatedEvidence: fail/);
  assert.match(message, /c3DatedEvidence: fail/);
  assert.equal(message.includes("Task runner is not connected"), false);
  assert.doesNotMatch(message, /sk-[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(message, /Authorization:\s*Bearer/i);
});

test("rich TUI submit switches modes from slash command", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/mode goal",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  assert.equal(state.mode, "Goal");
  assert.equal(state.messages.at(-1)?.text, "Mode: Goal");
});

test("rich TUI submit clears transcript without resetting shell status", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Goal",
    input: "/clear",
    messages: [
      { role: "user", text: "Add a lightning tower" },
      { role: "assistant", text: "done" },
    ],
    events: [{
      type: "tool_started",
      runId: "run_test",
      step: 1,
      callId: "call_read",
      toolName: "read_file",
      title: "Read file",
      detailsHidden: true,
    }],
    objective: "Add a lightning tower",
    runHealth: "Done",
    currentActivity: "Done",
    stepCount: 1,
    lastEventTitle: "Read file",
    activeSessionId: "sess_test",
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  assert.equal(state.input, "");
  assert.deepEqual(state.messages, []);
  assert.deepEqual(state.events, []);
  assert.equal(state.objective, undefined);
  assert.equal(state.runHealth, "Ready");
  assert.equal(state.currentActivity, undefined);
  assert.equal(state.stepCount, undefined);
  assert.equal(state.lastEventTitle, undefined);
  assert.equal(state.activeSessionId, undefined);
  assert.equal(state.mode, "Goal");
  assert.equal(state.provider, "deepseek");
  assert.equal(state.model, "deepseek-v4-flash");
});

test("rich TUI submit lists recent sessions", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/sessions",
    messages: [],
    events: [],
  };
  let called = false;

  const action = await submitRichTuiInput(state, {
    listSessions: async () => {
      called = true;
      return {
        returned: 0,
        scanned: 0,
        limit: 5,
        byStatus: {},
        byOutcome: {},
        pendingApprovals: 0,
        changedSessions: 0,
        sessions: [],
      };
    },
  });

  assert.equal(action.type, "redraw");
  assert.equal(called, true);
  assert.equal(state.runHealth, "Ready");
  assert.match(state.messages.at(-1)?.text ?? "", /No sessions found/);
});

test("rich TUI submit runs natural language task with streamed events", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "Add a lightning tower",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state, {
    nowMs: () => 1000,
    runTask: async ({ onEvent }) => {
      await onEvent({ type: "assistant_text", runId: "run_test", step: 1, text: "done", final: true });
      return {
        answer: "done",
        sessionId: "sess_test",
        context: { tokens: 9584, percentUsed: 5 },
        durationMs: 42,
      };
    },
  });

  assert.equal(action.type, "redraw");
  assert.equal(state.input, "");
  assert.equal(state.objective, "Add a lightning tower");
  assert.deepEqual(state.messages, [
    { role: "user", text: "Add a lightning tower" },
    { role: "assistant", text: "done" },
  ]);
  assert.equal(state.activeSessionId, "sess_test");
  assert.equal(state.lastRunDurationMs, 42);
  assert.equal(state.runHealth, "Done");
  assert.equal(state.context?.tokens, 9584);
});

test("rich TUI submit passes selected mode to task runner", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Goal",
    input: "Finish the task",
    messages: [],
    events: [],
  };
  const seenModes: string[] = [];

  await submitRichTuiInput(state, {
    runTask: async ({ mode }) => {
      seenModes.push(mode);
      return { answer: "done" };
    },
  });

  assert.deepEqual(seenModes, ["Goal"]);
});

test("rich TUI plan mode requires approval before build execution", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Plan",
    input: "Add a lightning tower",
    messages: [],
    events: [],
  };
  const seen: Array<{ task: string; mode: string }> = [];

  const planAction = await submitRichTuiInput(state, {
    runTask: async ({ task, mode }) => {
      seen.push({ task, mode });
      return { answer: "Plan:\n1. Inspect files\n2. Add lightning tower", sessionId: "sess_plan", durationMs: 10 };
    },
  });

  assert.equal(planAction.type, "redraw");
  assert.deepEqual(seen, [{ task: "Add a lightning tower", mode: "Plan" }]);
  assert.equal(state.mode, "Plan");
  assert.equal(state.runHealth, "Needs approval");
  assert.equal(state.pendingPlanApproval?.task, "Add a lightning tower");
  assert.match(renderConversationScreen(state, { columns: 140, rows: 30 }), /Plan needs approval/);

  state.input = "/approve plan";
  const approveAction = await submitRichTuiInput(state, {
    runTask: async ({ task, mode }) => {
      seen.push({ task, mode });
      return { answer: "Built lightning tower", sessionId: "sess_build", durationMs: 25 };
    },
  });

  assert.equal(approveAction.type, "redraw");
  assert.deepEqual(seen, [
    { task: "Add a lightning tower", mode: "Plan" },
    { task: "Add a lightning tower", mode: "Build" },
  ]);
  assert.equal(state.mode, "Build");
  assert.equal(state.pendingPlanApproval, undefined);
  assert.equal(state.runHealth, "Done");
  assert.equal(state.activeSessionId, "sess_build");
  assert.equal(state.messages.at(-1)?.text, "Built lightning tower");
});

test("rich TUI submit resumes the active session", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Goal",
    input: "/resume",
    messages: [],
    events: [],
    activeSessionId: "sess_existing",
  };
  const resumed: string[] = [];

  const action = await submitRichTuiInput(state, {
    nowMs: () => 2000,
    resumeSession: async ({ sessionId, onEvent }) => {
      resumed.push(sessionId);
      await onEvent({ type: "assistant_text", runId: "run_resume", step: 1, text: "resumed", final: true });
      return {
        answer: "resumed",
        sessionId,
        durationMs: 55,
      };
    },
  });

  assert.equal(action.type, "redraw");
  assert.deepEqual(resumed, ["sess_existing"]);
  assert.equal(state.runHealth, "Done");
  assert.equal(state.currentActivity, "Done");
  assert.equal(state.lastRunDurationMs, 55);
  assert.equal(state.activeSessionId, "sess_existing");
  assert.deepEqual(state.messages, [
    { role: "system", text: "Resuming session sess_existing" },
    { role: "assistant", text: "resumed" },
  ]);
});

test("rich TUI continue resumes a stopped Goal session", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Goal",
    input: "/continue",
    messages: [{ role: "user", text: "Finish this long task" }],
    events: [],
    runHealth: "Stopped",
    currentActivity: "Stopped",
    activeSessionId: "sess_long",
  };
  const resumed: string[] = [];

  const action = await submitRichTuiInput(state, {
    resumeSession: async ({ sessionId, onEvent }) => {
      resumed.push(sessionId);
      await onEvent({ type: "assistant_text", runId: "run_continue", step: 1, text: "continued", final: true });
      return {
        answer: "continued",
        sessionId,
        durationMs: 77,
      };
    },
  });

  assert.equal(action.type, "redraw");
  assert.deepEqual(resumed, ["sess_long"]);
  assert.equal(state.mode, "Goal");
  assert.equal(state.runHealth, "Done");
  assert.equal(state.currentActivity, "Done");
  assert.equal(state.lastRunDurationMs, 77);
  assert.equal(state.activeSessionId, "sess_long");
  assert.equal(state.messages.at(-1)?.text, "continued");
});

test("rich TUI submit asks for a session id before resume", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/resume",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "redraw");
  assert.match(state.messages.at(-1)?.text ?? "", /Use \/resume <session-id>/);
  assert.equal(state.runHealth, undefined);
});

test("rich TUI submit returns special action for model setup", async () => {
  const { submitRichTuiInput } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "/model setup",
    messages: [],
    events: [],
  };

  const action = await submitRichTuiInput(state);

  assert.equal(action.type, "model_setup");
  assert.equal(state.input, "");
});

test("rich model setup wizard renders provider base URLs and moves with arrow keys", async () => {
  const { createRichModelSetupState, handleRichModelSetupKey, renderRichModelSetupScreen } = await import("../cli/tui/model-setup.js");
  const wizard = createRichModelSetupState(Object.values(MODEL_PROVIDER_PROFILES), "openai");

  let screen = renderRichModelSetupScreen(wizard, { columns: 120, rows: 28 });
  assert.match(screen, /Model setup/);
  assert.match(screen, /> \[ \] OpenAI \(https:\/\/api\.openai\.com\/v1\)/);
  assert.match(screen, /DeepSeek \(https:\/\/api\.deepseek\.com\)/);

  const action = handleRichModelSetupKey(wizard, { key: { name: "down" } });
  screen = renderRichModelSetupScreen(wizard, { columns: 120, rows: 28 });

  assert.equal(action.type, "redraw");
  assert.match(screen, /> \[ \] Anthropic Claude \(https:\/\/api\.anthropic\.com\/v1\)/);
});

test("rich model setup wizard shows provider key docs and pricing links after provider selection", async () => {
  const { createRichModelSetupState, handleRichModelSetupKey, renderRichModelSetupScreen } = await import("../cli/tui/model-setup.js");
  const wizard = createRichModelSetupState(Object.values(MODEL_PROVIDER_PROFILES), "deepseek");

  assert.equal(handleRichModelSetupKey(wizard, { key: { name: "return" } }).type, "redraw");
  const screen = renderRichModelSetupScreen(wizard, { columns: 140, rows: 28 });

  assert.match(screen, /API keys: https:\/\/platform\.deepseek\.com\/api_keys/);
  assert.match(screen, /Docs: https:\/\/api-docs\.deepseek\.com\//);
  assert.match(screen, /Pricing: https:\/\/api-docs\.deepseek\.com\/quick_start\/pricing/);
});

test("rich model setup wizard lets custom OpenAI-compatible providers enter base URL", async () => {
  const { createRichModelSetupState, handleRichModelSetupKey, renderRichModelSetupScreen } = await import("../cli/tui/model-setup.js");
  const wizard = createRichModelSetupState(Object.values(MODEL_PROVIDER_PROFILES), "openai_compatible");

  assert.equal(handleRichModelSetupKey(wizard, { key: { name: "return" } }).type, "redraw");
  assert.equal(wizard.phase, "base_url");
  assert.match(renderRichModelSetupScreen(wizard, { columns: 140, rows: 28 }), /Base URL \[http:\/\/localhost:8000\/v1\]:/);

  for (const char of "https://api.deepseek.com/v1") {
    assert.equal(handleRichModelSetupKey(wizard, { value: char }).type, "redraw");
  }
  assert.equal(handleRichModelSetupKey(wizard, { key: { name: "return" } }).type, "redraw");
  assert.equal(wizard.phase, "model");

  assert.equal(handleRichModelSetupKey(wizard, { key: { name: "return" } }).type, "redraw");
  for (const char of "sk-test-secret-123456") {
    assert.equal(handleRichModelSetupKey(wizard, { value: char }).type, "redraw");
  }
  const complete = handleRichModelSetupKey(wizard, { key: { name: "return" } });

  assert.equal(complete.type, "complete");
  assert.equal(complete.request?.provider, "openai_compatible");
  assert.equal(complete.request?.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(complete.request?.model, "default");
  assert.equal(complete.request?.apiKey, "sk-test-secret-123456");
});

test("rich model setup wizard lets custom Anthropic-compatible providers enter base URL", async () => {
  const { createRichModelSetupState, handleRichModelSetupKey, renderRichModelSetupScreen } = await import("../cli/tui/model-setup.js");
  const wizard = createRichModelSetupState(Object.values(MODEL_PROVIDER_PROFILES), "anthropic_compatible");

  assert.equal(handleRichModelSetupKey(wizard, { key: { name: "return" } }).type, "redraw");
  assert.equal(wizard.phase, "base_url");
  assert.match(renderRichModelSetupScreen(wizard, { columns: 140, rows: 28 }), /Base URL \[http:\/\/localhost:8000\/v1\]:/);

  for (const char of "https://anthropic-compatible.example/v1") {
    assert.equal(handleRichModelSetupKey(wizard, { value: char }).type, "redraw");
  }
  assert.equal(handleRichModelSetupKey(wizard, { key: { name: "return" } }).type, "redraw");
  assert.equal(wizard.phase, "model");

  assert.equal(handleRichModelSetupKey(wizard, { key: { name: "down" } }).type, "redraw");
  assert.equal(handleRichModelSetupKey(wizard, { key: { name: "return" } }).type, "redraw");
  assert.equal(wizard.phase, "api_key");
  for (const char of "anthropic-secret-123456") {
    assert.equal(handleRichModelSetupKey(wizard, { value: char }).type, "redraw");
  }
  const complete = handleRichModelSetupKey(wizard, { key: { name: "return" } });

  assert.equal(complete.type, "complete");
  assert.equal(complete.request?.provider, "anthropic_compatible");
  assert.equal(complete.request?.protocol, "anthropic_messages");
  assert.equal(complete.request?.baseUrl, "https://anthropic-compatible.example/v1");
  assert.equal(complete.request?.model, "claude-local");
  assert.equal(complete.request?.apiKey, "anthropic-secret-123456");
});

test("rich model setup wizard covers known provider presets with bounded rows", async () => {
  const { createRichModelSetupState, renderRichModelSetupScreen } = await import("../cli/tui/model-setup.js");
  const wizard = createRichModelSetupState(Object.values(MODEL_PROVIDER_PROFILES), "openai");
  const screen = renderRichModelSetupScreen(wizard, { columns: 100, rows: 32 });
  const lines = screen.split("\n");

  for (const label of ["OpenAI", "Anthropic Claude", "Google Gemini", "Kimi / Moonshot AI", "DeepSeek", "Z.AI GLM", "Qwen / DashScope", "MiniMax", "Custom OpenAI-compatible", "Custom Anthropic-compatible"]) {
    assert.match(screen, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(lines.every((line) => visibleLength(line) <= 100), true);
});

test("rich model setup wizard selects provider model and masked api key", async () => {
  const { createRichModelSetupState, handleRichModelSetupKey, renderRichModelSetupScreen } = await import("../cli/tui/model-setup.js");
  const wizard = createRichModelSetupState(Object.values(MODEL_PROVIDER_PROFILES), "deepseek");

  assert.equal(handleRichModelSetupKey(wizard, { value: " ", key: { name: "space" } }).type, "redraw");
  assert.equal(wizard.phase, "model");
  assert.match(renderRichModelSetupScreen(wizard, { columns: 120, rows: 28 }), /> \[ \] deepseek-v4-flash/);

  assert.equal(handleRichModelSetupKey(wizard, { key: { name: "return" } }).type, "redraw");
  assert.equal(wizard.phase, "api_key");
  for (const char of "sk-test-secret-123456") {
    assert.equal(handleRichModelSetupKey(wizard, { value: char }).type, "redraw");
  }
  const screen = renderRichModelSetupScreen(wizard, { columns: 120, rows: 28 });
  assert.match(screen, /API key: \*+/);
  assert.equal(screen.includes("sk-test-secret-123456"), false);

  const complete = handleRichModelSetupKey(wizard, { key: { name: "return" } });
  assert.equal(complete.type, "complete");
  assert.equal(complete.request?.provider, "deepseek");
  assert.equal(complete.request?.baseUrl, "https://api.deepseek.com");
  assert.equal(complete.request?.model, "deepseek-v4-flash");
  assert.equal(complete.request?.apiKey, "sk-test-secret-123456");
});

test("rich TUI key handler completes native model setup without leaking api key", async () => {
  const { createRichModelSetupState } = await import("../cli/tui/model-setup.js");
  const { handleRichTuiKey } = await import("../cli/tui/rich-shell.js");
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "",
    messages: [],
    events: [],
    modelSetup: createRichModelSetupState(Object.values(MODEL_PROVIDER_PROFILES), "deepseek"),
  };

  assert.equal(handleRichTuiKey(state, { key: { name: "return" } }), "redraw");
  assert.equal(handleRichTuiKey(state, { key: { name: "return" } }), "redraw");
  for (const char of "sk-test-secret-123456") {
    assert.equal(handleRichTuiKey(state, { value: char }), "redraw");
  }

  assert.equal(handleRichTuiKey(state, { key: { name: "return" } }), "model_setup_submit");
  assert.equal(state.pendingModelSetupRequest?.apiKey, "sk-test-secret-123456");
  const screen = renderConversationScreen(state, { columns: 120, rows: 28 });
  assert.equal(screen.includes("sk-test-secret-123456"), false);
});

test("rich shell supports an injected TTY smoke flow with progress and clean exit", async () => {
  const { startRichTuiShellWithTerminal } = await import("../cli/tui/rich-shell.js");
  const input = new FakeTtyInput();
  const output = new FakeTtyOutput(120, 28);
  const run = startRichTuiShellWithTerminal({
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    version: "0.1.0",
    runTask: async ({ onEvent }) => {
      await onEvent({
        type: "tool_started",
        runId: "run_test",
        step: 1,
        callId: "call_patch",
        toolName: "apply_patch",
        title: "Edit files",
        detailsHidden: true,
      });
      await onEvent({ type: "assistant_text", runId: "run_test", step: 1, text: "done", final: true });
      return {
        answer: "done",
        sessionId: "sess_test",
        context: { tokens: 1200, percentUsed: 3 },
        durationMs: 25,
      };
    },
  }, {
    input,
    output,
    emitKeypressEvents: () => undefined,
  });

  await flushPromises();

  assert.equal(input.rawModes.at(-1), true);
  assert.match(output.text, /soloclaw/i);

  for (const char of "Add lightning tower") {
    input.emit("keypress", char, { name: char });
  }
  input.emit("keypress", "\r", { name: "return" });

  await waitFor(() => output.text.includes("done") && output.text.includes("Editing") && output.text.includes("Step 1"));

  input.emit("keypress", "", { name: "escape" });
  await run;

  assert.equal(input.rawModes.at(-1), false);
  assert.equal(output.text.includes("\x1b[?25l"), true);
  assert.equal(output.text.includes("\x1b[?25h"), true);
});

test("rich shell preserves typed draft while progress redraws", async () => {
  const { startRichTuiShellWithTerminal } = await import("../cli/tui/rich-shell.js");
  const input = new FakeTtyInput();
  const output = new FakeTtyOutput(140, 30);
  let releaseProgress: (() => void) | undefined;
  const run = startRichTuiShellWithTerminal({
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    version: "0.1.0",
    runTask: async ({ onEvent }) => {
      await new Promise<void>((resolve) => {
        releaseProgress = resolve;
      });
      await onEvent({
        type: "tool_started",
        runId: "run_test",
        step: 1,
        callId: "call_read",
        toolName: "read_file",
        title: "Read files",
        detailsHidden: true,
      });
      return {
        answer: "done",
        sessionId: "sess_test",
        context: { tokens: 1200, percentUsed: 3 },
        durationMs: 25,
      };
    },
  }, {
    input,
    output,
    emitKeypressEvents: () => undefined,
  });

  await flushPromises();
  for (const char of "Long task") {
    input.emit("keypress", char, { name: char });
  }
  input.emit("keypress", "\r", { name: "return" });

  await waitFor(() => releaseProgress !== undefined);
  for (const char of "next draft") {
    input.emit("keypress", char, { name: char });
  }
  releaseProgress?.();

  await waitFor(() => output.latestFrame().includes("Read files") && output.latestFrame().includes("done"));
  const frame = output.latestFrame();
  assert.match(frame, /next draft/);

  input.emit("keypress", "", { name: "escape" });
  await run;

  assert.equal(input.rawModes.at(-1), false);
});

test("rich shell keeps approval errors visible without exiting or stale thinking status", async () => {
  const { startRichTuiShellWithTerminal } = await import("../cli/tui/rich-shell.js");
  const input = new FakeTtyInput();
  const output = new FakeTtyOutput(140, 30);
  const run = startRichTuiShellWithTerminal({
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    version: "0.1.0",
    runTask: async () => {
      throw new Error("Secret access requires approval: High-risk action requires approval.");
    },
  }, {
    input,
    output,
    emitKeypressEvents: () => undefined,
  });

  await flushPromises();
  for (const char of "Trigger approval") {
    input.emit("keypress", char, { name: char });
  }
  input.emit("keypress", "\r", { name: "return" });

  await waitFor(() => output.latestFrame().includes("Needs approval") && output.latestFrame().includes("Secret access requires approval"));

  for (const char of "/status") {
    input.emit("keypress", char, { name: char });
  }
  input.emit("keypress", "\r", { name: "return" });

  await waitFor(() => output.latestFrame().includes("Activity: Needs approval"));
  const frame = output.latestFrame();
  assert.match(frame, /Run: Needs approval/);
  assert.match(frame, /Activity: Needs approval/);
  assert.equal(frame.includes("Activity: Thinking"), false);
  assert.equal(frame.includes("sk-test-secret"), false);

  input.emit("keypress", "", { name: "escape" });
  await run;

  assert.equal(input.rawModes.at(-1), false);
});

test("rich shell reports context unavailable before provider usage arrives", async () => {
  const { startRichTuiShellWithTerminal } = await import("../cli/tui/rich-shell.js");
  const input = new FakeTtyInput();
  const output = new FakeTtyOutput(140, 30);
  const run = startRichTuiShellWithTerminal({
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    version: "0.1.0",
  }, {
    input,
    output,
    emitKeypressEvents: () => undefined,
  });

  await flushPromises();
  for (const char of "/status") {
    input.emit("keypress", char, { name: char });
  }
  input.emit("keypress", "\r", { name: "return" });

  await waitFor(() => output.latestFrame().includes("Context:"));
  const frame = output.latestFrame();
  assert.match(frame, /Context: context n\/a/);
  assert.equal(frame.includes("0 tokens (0%)"), false);
  assert.equal(frame.includes("$0.00 spent"), false);

  input.emit("keypress", "", { name: "escape" });
  await run;

  assert.equal(input.rawModes.at(-1), false);
});

test("rich shell drives native model setup wizard from command palette without leaking api key", async () => {
  const { startRichTuiShellWithTerminal } = await import("../cli/tui/rich-shell.js");
  const input = new FakeTtyInput();
  const output = new FakeTtyOutput(140, 32);
  const submittedRequests: Array<{
    provider: string;
    baseUrl?: string;
    model: string;
    apiKey?: string;
  }> = [];
  const run = startRichTuiShellWithTerminal({
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "missing",
    version: "0.1.0",
    modelProfiles: Object.values(MODEL_PROVIDER_PROFILES),
    setupModelFromWizard: async (request) => {
      submittedRequests.push(request);
      return {
        provider: request.provider,
        model: request.model,
        readiness: "pass",
      };
    },
  }, {
    input,
    output,
    emitKeypressEvents: () => undefined,
  });

  await flushPromises();
  input.emit("keypress", "", { ctrl: true, name: "p" });
  await flushPromises();
  input.emit("keypress", "\r", { name: "return" });

  await waitFor(() => output.text.includes("Model setup") && output.text.includes("DeepSeek"));

  input.emit("keypress", "\r", { name: "return" });
  await waitFor(() => output.text.includes("deepseek-v4-flash") && output.text.includes("API keys:"));

  input.emit("keypress", "", { name: "down" });
  input.emit("keypress", "\r", { name: "return" });
  await waitFor(() => output.text.includes("API key:"));

  for (const char of "sk-test-secret-123456") {
    input.emit("keypress", char, { name: char });
  }
  input.emit("keypress", "\r", { name: "return" });

  await waitFor(() => output.text.includes("Model: deepseek deepseek-chat"));

  assert.equal(submittedRequests.length, 1);
  assert.equal(submittedRequests[0]?.provider, "deepseek");
  assert.equal(submittedRequests[0]?.baseUrl, "https://api.deepseek.com");
  assert.equal(submittedRequests[0]?.model, "deepseek-chat");
  assert.equal(submittedRequests[0]?.apiKey, "sk-test-secret-123456");
  assert.equal(output.text.includes("sk-test-secret-123456"), false);
  assert.match(output.text, /readiness: pass/);

  input.emit("keypress", "", { name: "escape" });
  await run;

  assert.equal(input.rawModes.at(-1), false);
});

class FakeTtyInput extends EventEmitter {
  isRaw = false;
  readonly rawModes: boolean[] = [];

  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    this.rawModes.push(mode);
    return this;
  }

  resume(): this {
    return this;
  }
}

class FakeTtyOutput extends EventEmitter {
  text = "";

  constructor(readonly columns: number, readonly rows: number) {
    super();
  }

  write(value: string): boolean {
    this.text += value;
    return true;
  }

  latestFrame(): string {
    return this.text.split("\x1b[2J\x1b[H").at(-1) ?? this.text;
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await flushPromises();
  }
  assert.equal(predicate(), true);
}

function commandCursorDelta(command: string): number {
  const index = TUI_COMMANDS.findIndex((entry) => entry.command === command);
  assert.notEqual(index, -1, `command not found: ${command}`);
  return index;
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

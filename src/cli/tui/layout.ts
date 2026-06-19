import { ansi, clip, padRight, type TerminalSize } from "./ansi.js";
import { TUI_COMMANDS } from "./commands.js";
import { renderEventRow, renderProjectedAssistantPartRow } from "./event-renderer.js";
import { renderRichModelSetupScreen } from "./model-setup.js";
import { describeMode, resumeGuidance, type RichTuiState } from "./state.js";

export function renderWelcomeScreen(state: RichTuiState, size: TerminalSize): string {
  if (state.modelSetup?.open) {
    return renderRichModelSetupScreen(state.modelSetup, size);
  }
  const width = Math.max(size.columns, 32);
  const height = Math.max(size.rows, 10);
  const dock = renderInputDock(state, width);
  const bodyLimit = Math.max(0, height - dock.length);
  const body = [
    ...renderTopStrip(state, width),
    "",
    ...renderSection("MISSION", [
      state.objective ?? "Ready for a local task.",
      "Ask Soloclaw to inspect, change, test, or explain from the input dock.",
    ], width),
    "",
    ...renderSection("MODEL", [
      `${state.provider}/${state.model}`,
      `readiness: ${state.readiness}`,
      `workspace: ${state.workspace}`,
    ], width),
    "",
    ...renderSection("NEXT", [
      "/model setup - configure provider, model, and API key",
      "/phase2 readiness - check the DeepSeek manual-run path",
      "/status - show run, model, context, and workspace state",
    ], width),
  ].slice(0, bodyLimit);
  while (body.length < bodyLimit) {
    body.push("");
  }
  return [...body, ...dock].slice(0, height).map((line) => clip(line, width)).join("\n");
}

export function renderConversationScreen(state: RichTuiState, size: TerminalSize): string {
  if (state.modelSetup?.open) {
    return renderRichModelSetupScreen(state.modelSetup, size);
  }
  const width = Math.max(size.columns, 48);
  const height = Math.max(size.rows, 14);
  return renderWorkLedgerScreen(state, width, height).map((line) => clip(line, width)).join("\n");
}

function renderWorkLedgerScreen(state: RichTuiState, width: number, height: number): string[] {
  const dock = renderInputDock(state, width);
  const bodyLimit = Math.max(0, height - dock.length);
  const top = renderTopStrip(state, width);
  const mission = renderSection("MISSION", renderMissionRows(state), width);
  const checks = renderSection("CHECKS", renderChecksRows(state), width);
  const commandBlock = state.commandPalette?.open ? ["", ...renderCommandPalette(state, width)] : [];
  const fixedRows = top.length + 1 + mission.length + 1 + commandBlock.length + 1 + checks.length;
  const ledgerBudget = Math.max(2, bodyLimit - fixedRows);
  const ledger = renderSection("LEDGER", renderLedgerRows(state, width, ledgerBudget - 1), width).slice(0, ledgerBudget);
  const body = [
    ...top,
    "",
    ...mission,
    "",
    ...commandBlock,
    ...ledger,
    "",
    ...checks,
  ].slice(0, bodyLimit);
  while (body.length < bodyLimit) {
    body.push("");
  }
  return [...body, ...dock].slice(0, height);
}

function renderTopStrip(state: RichTuiState, width: number): string[] {
  const workspace = state.workspaceStatus
    ? `${state.workspace} (${formatWorkspaceStatus(state.workspaceStatus)})`
    : state.workspace;
  return [
    clip(`${ansi.bold}SOLOCLAW Workbench${ansi.reset}  ${ansi.gray}soloclaw local agent${ansi.reset}`, width),
    clip(`${ansi.orange}${state.mode}${ansi.reset} - ${describeMode(state.mode)} | ${state.provider}/${state.model} | ${state.readiness} | ${formatContextSummary(state)} | ${workspace}`, width),
  ];
}

function renderSection(title: string, rows: string[], width: number): string[] {
  const labelWidth = Math.min(10, Math.max(7, title.length));
  const safeRows = rows.length > 0 ? rows : ["-"];
  return [
    clip(`${ansi.bold}${title}${ansi.reset}`, width),
    ...safeRows.map((row) => clip(`${ansi.gray}${padRight("", labelWidth)}${ansi.reset}${row}`, width)),
  ];
}

function renderMissionRows(state: RichTuiState): string[] {
  const latestUser = [...state.messages].reverse().find((message) => message.role === "user")?.text;
  const objective = state.objective ?? latestUser ?? "Current session";
  const rows = [
    objective,
    `Run: ${state.runHealth ?? "Ready"}`,
    `Mode: ${state.mode} - ${describeMode(state.mode)}`,
  ];
  if (state.pendingPlanApproval) {
    rows.push("Plan needs approval: /approve plan");
  }
  return rows;
}

function renderLedgerRows(state: RichTuiState, width: number, maxRows: number): string[] {
  const activityBlocks: string[][] = [];
  const messageBlocks: string[][] = [];
  const maxVisibleMessages = Math.max(1, Math.min(8, maxRows));
  for (const message of selectVisibleMessages(state, maxVisibleMessages)) {
    const label = message.role === "user" ? "USER" : message.role === "assistant" ? "ANSWER" : "SYSTEM";
    const color = message.role === "user" ? ansi.orange : message.role === "assistant" ? ansi.purple : ansi.gray;
    messageBlocks.push(message.text.split(/\r?\n/).map((text) => clip(`${color}${padRight(label, 7)}${ansi.reset}${text || " "}`, width)));
  }
  const projectedRows = renderProjectedAssistantRows(state, width);
  if (projectedRows.length > 0) {
    activityBlocks.push([
      `${ansi.gray}${padRight("PROGRESS", 7)}${ansi.reset}folded assistant activity`,
      ...projectedRows,
    ]);
  }
  for (const event of state.events.slice(-6)) {
    activityBlocks.push([clip(renderEventRow(event, width), width)]);
  }
  const blocks = [...activityBlocks, ...messageBlocks];
  if (blocks.length === 0) {
    return ["No ledger entries yet."];
  }
  return fitLatestBlocks(blocks, Math.max(1, maxRows));
}

function fitLatestBlocks(blocks: string[][], maxRows: number): string[] {
  const visibleBlocks: string[][] = [];
  let usedRows = 0;
  for (const block of blocks) {
    if (block.length >= maxRows) {
      visibleBlocks.length = 0;
      visibleBlocks.push(block.slice(0, maxRows));
      usedRows = maxRows;
      continue;
    }
    while (visibleBlocks.length > 0 && usedRows + block.length > maxRows) {
      const removed = visibleBlocks.shift();
      usedRows -= removed?.length ?? 0;
    }
    if (usedRows + block.length <= maxRows) {
      visibleBlocks.push(block);
      usedRows += block.length;
    }
  }
  return visibleBlocks.flat();
}

function selectVisibleMessages(state: RichTuiState, maxVisibleMessages: number): RichTuiState["messages"] {
  const messages = state.messages;
  const maxOffset = Math.max(0, messages.length - maxVisibleMessages);
  const offset = Math.max(0, Math.min(state.transcriptScrollOffset ?? 0, maxOffset));
  const end = Math.max(0, messages.length - offset);
  const start = Math.max(0, end - maxVisibleMessages);
  return messages.slice(start, end);
}

function renderProjectedAssistantRows(state: RichTuiState, width: number): string[] {
  const messages = state.projectedAssistantMessages ?? [];
  const parts = messages.flatMap((message) => message.parts).slice(-8);
  return parts.map((part) => clip(renderProjectedAssistantPartRow(part, width), width));
}

function renderChecksRows(state: RichTuiState): string[] {
  const rows = [
    `Run: ${state.runHealth ?? "Ready"}`,
    `Activity: ${formatActivityStatus(state)}`,
    `Mode: ${state.mode} - ${describeMode(state.mode)}`,
    `Context: ${formatContextDetails(state)}`,
    `Model: ${state.provider}/${state.model} (readiness: ${state.readiness})`,
    `LSP: ${state.lsp?.label ?? "LSPs are disabled"}`,
    `Workspace: ${state.workspace}`,
  ];
  if (state.stepCount !== undefined) {
    rows.push(`Step ${state.stepCount}`);
  }
  if (state.lastEventTitle) {
    rows.push(`Event: ${state.lastEventTitle}`);
  }
  if (state.workspaceStatus) {
    rows.push(`Git: ${formatWorkspaceStatus(state.workspaceStatus)}`);
  }
  if (state.activeSessionId) {
    rows.push(`Session: ${state.activeSessionId}`);
  }
  const next = resumeGuidance(state);
  if (next) {
    rows.push(`Next: ${next}`);
  }
  if (state.pendingPlanApproval) {
    rows.push("Plan needs approval: /approve plan");
  }
  if (state.version) {
    rows.push(`Soloclaw ${state.version}`);
  }
  return rows;
}

function renderCommandPalette(state: RichTuiState, width: number): string[] {
  const cursorIndex = state.commandPalette?.cursorIndex ?? 0;
  return [
    `${ansi.bold}Commands${ansi.reset}`,
    ...TUI_COMMANDS.map((command, index) => {
      const cursor = index === cursorIndex ? ">" : " ";
      const checked = index === cursorIndex ? "[ ]" : "   ";
      return clip(`${cursor} ${checked} ${command.name} - ${command.description}`, width);
    }),
  ];
}

function renderInputDock(state: RichTuiState, width: number): string[] {
  const promptLines = state.input.length > 0
    ? state.input.split(/\r?\n/).slice(-3)
    : ["Ask Soloclaw to inspect, change, test, or explain"];
  return [
    `${ansi.bold}INPUT DOCK${ansi.reset}`,
    ...promptLines.map((prompt) => clip(`${ansi.purple}>${ansi.reset} ${ansi.gray}${prompt || " "}${ansi.reset}`, width)),
    renderBottomStatus(state, width),
  ];
}

function renderBottomStatus(state: RichTuiState, width: number): string {
  const duration = state.lastRunDurationMs === undefined ? "" : ` | ${(state.lastRunDurationMs / 1000).toFixed(1)}s`;
  const activity = state.currentActivity ? ` | ${state.currentActivity}${state.stepCount !== undefined ? ` Step ${state.stepCount}` : ""}` : "";
  return clip(`${ansi.orange}${state.mode}${ansi.reset} | ${state.provider}/${state.model}${duration}${activity} | ${formatContextSummary(state)} | ctrl+p commands | f2 mode | esc exit`, width);
}

function formatActivityStatus(state: RichTuiState): string {
  if (state.currentActivity) {
    return state.stepCount !== undefined ? `${state.currentActivity} Step ${state.stepCount}` : state.currentActivity;
  }
  return state.runHealth ?? "Ready";
}

function formatContextSummary(state: RichTuiState): string {
  const context = state.context;
  return context ? `${formatTokens(context.tokens)} (${context.percentUsed}%)` : "context n/a";
}

function formatContextDetails(state: RichTuiState): string {
  const context = state.context;
  if (!context) {
    return "context n/a";
  }
  const base = `${formatTokens(context.tokens)} tokens (${context.percentUsed}%)`;
  const window = context.windowTokens ? `, ${formatTokens(context.windowTokens)} window` : "";
  const spend = context.spentUsd !== undefined ? `, $${context.spentUsd.toFixed(2)} spent` : "";
  return `${base}${window}${spend}`;
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : String(tokens);
}

function formatWorkspaceStatus(status: NonNullable<RichTuiState["workspaceStatus"]>): string {
  if (!status.insideWorkTree) {
    return status.error ? `not a git worktree (${status.error})` : "not a git worktree";
  }
  const branch = status.branch ?? "detached";
  const dirty = status.dirtyCount === 0 ? "clean" : `${status.dirtyCount} changed`;
  return `${branch} - ${dirty}`;
}

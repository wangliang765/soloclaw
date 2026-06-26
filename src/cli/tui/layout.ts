import { ansi, clip, padRight, visibleLength, type TerminalSize } from "./ansi.js";
import { commandSuggestionsForInput, TUI_COMMANDS } from "./commands.js";
import { renderEventRow, renderProjectedAssistantPartRow } from "./event-renderer.js";
import { renderRichModelSetupScreen } from "./model-setup.js";
import { describeMode, resumeGuidance, type RichTuiState } from "./state.js";

export function renderWelcomeScreen(state: RichTuiState, size: TerminalSize): string {
  if (state.modelSetup?.open) {
    return renderRichModelSetupScreen(state.modelSetup, size);
  }
  const width = Math.max(size.columns, 48);
  const height = Math.max(size.rows, 14);
  return renderChatScreenWithOverlays(state, width, height).map((line) => clip(line, width)).join("\n");
}

export function renderConversationScreen(state: RichTuiState, size: TerminalSize): string {
  if (state.modelSetup?.open) {
    return renderRichModelSetupScreen(state.modelSetup, size);
  }
  const width = Math.max(size.columns, 48);
  const height = Math.max(size.rows, 14);
  return renderChatScreenWithOverlays(state, width, height).map((line) => clip(line, width)).join("\n");
}

function renderChatScreenWithOverlays(state: RichTuiState, width: number, height: number): string[] {
  const rows = renderChatScreen(state, width, height);
  if (state.sessionPicker?.open) {
    return renderOverlay(rows, renderSessionPickerPanel(state, width, height), width, height);
  }
  if (state.commandPalette?.open) {
    return renderOverlay(rows, renderCommandPalettePanel(state, width, height), width, height);
  }
  if (state.commandSuggestions?.open) {
    return renderOverlay(rows, renderCommandSuggestionsPanel(state, width, height), width, height);
  }
  return rows;
}

function renderChatScreen(state: RichTuiState, width: number, height: number): string[] {
  const inputRows = renderChatInput(state, Math.max(1, width - 4));
  const dock = renderFramedPanel("Input", inputRows, width, Math.min(height, inputRows.length + 2));
  const bodyLimit = Math.max(0, height - dock.length);
  const wide = width >= 96;
  const railWidth = wide ? Math.min(44, Math.max(42, Math.floor(width * 0.3))) : 0;
  const gap = wide ? 2 : 0;
  const leftWidth = wide ? width - railWidth - gap : width;
  const leftRows = renderFramedPanel(
    "Conversation",
    renderChatLane(state, Math.max(1, leftWidth - 4), Math.max(0, bodyLimit - 2)),
    leftWidth,
    bodyLimit,
  );
  const railRows = wide
    ? renderFramedPanel("Status", renderStatusRail(state, Math.max(1, railWidth - 4), Math.max(0, bodyLimit - 2)), railWidth, bodyLimit)
    : [];
  const body = wide
    ? joinColumns(leftRows, railRows, leftWidth, railWidth, gap, bodyLimit)
    : leftRows.slice(0, bodyLimit);
  while (body.length < bodyLimit) {
    body.push("");
  }
  return [...body, ...dock].slice(0, height);
}

function joinColumns(left: string[], right: string[], leftWidth: number, rightWidth: number, gap: number, maxRows: number): string[] {
  const rows: string[] = [];
  for (let index = 0; index < maxRows; index += 1) {
    const leftLine = padRight(clip(left[index] ?? "", leftWidth), leftWidth);
    const rightLine = clip(right[index] ?? "", rightWidth);
    rows.push(`${leftLine}${" ".repeat(gap)}${rightLine}`);
  }
  return rows;
}

function renderChatLane(state: RichTuiState, width: number, maxRows: number): string[] {
  const fixedRows = 2;
  const contentBudget = Math.max(1, maxRows - fixedRows);
  const rows = [
    renderChatHeader(state, width),
    "",
    ...renderChatContentRows(state, width, contentBudget),
  ].slice(0, maxRows);
  while (rows.length < maxRows) {
    rows.push("");
  }
  return rows;
}

function renderChatHeader(state: RichTuiState, width: number): string {
  return clip(`${ansi.bold}Soloclaw${ansi.reset}  ${state.mode} - ${describeMode(state.mode)}  ${state.provider}/${state.model}  ${formatContextSummary(state)}`, width);
}

function renderChatContentRows(state: RichTuiState, width: number, maxRows: number): string[] {
  const blocks: string[][] = [];
  const activityRows = renderChatActivityRows(state, width);
  if (activityRows.length > 0) {
    blocks.push(activityRows);
  }
  const visibleMessages = selectVisibleMessages(state, Math.max(1, Math.min(6, Math.floor(maxRows / 3) + 1)));
  for (const message of visibleMessages) {
    blocks.push(renderChatMessageBlock(message, width));
  }
  if (shouldRenderWorkingAssistantPlaceholder(state)) {
    blocks.push(renderWorkingAssistantBlock(state, width));
  }
  if (blocks.length === 0) {
    return [clip(`${ansi.gray}Ask Soloclaw to inspect, change, test, or explain.${ansi.reset}`, width)];
  }
  return fitLatestBlocks(blocks, Math.max(1, maxRows));
}

function renderChatMessageBlock(message: RichTuiState["messages"][number], width: number): string[] {
  const label = message.role === "user" ? "You" : message.role === "assistant" ? "Soloclaw" : "System";
  const color = message.role === "user" ? ansi.orange : message.role === "assistant" ? ansi.purple : ansi.gray;
  const lines = message.text.split(/\r?\n/);
  return [
    clip(`${color}${label}${ansi.reset}`, width),
    ...lines.map((line) => clip(`  ${line || " "}`, width)),
  ];
}

function shouldRenderWorkingAssistantPlaceholder(state: RichTuiState): boolean {
  return state.runHealth === "Working" && state.messages.at(-1)?.role === "user";
}

function renderWorkingAssistantBlock(state: RichTuiState, width: number): string[] {
  const activity = state.currentActivity ?? "Working";
  const step = state.stepCount !== undefined && !activity.includes(`Step ${state.stepCount}`)
    ? ` Step ${state.stepCount}`
    : "";
  return [
    clip(`${ansi.purple}Soloclaw${ansi.reset}`, width),
    clip(`  Working on it... ${activity}${step}`, width),
  ];
}

function renderChatActivityRows(state: RichTuiState, width: number): string[] {
  const projectedRows = renderProjectedAssistantRows(state, width);
  const rawEventRows = projectedRows.length > 0
    ? []
    : state.events.slice(-4).map((event) => clip(renderEventRow(event, width), width));
  const rows = [
    ...renderTodoLedgerRows(state, width),
    ...projectedRows,
    ...rawEventRows,
  ];
  if (rows.length === 0) {
    return [];
  }
  return [
    clip(`${ansi.gray}Activity${ansi.reset}`, width),
    ...rows.map((row) => clip(`  ${row}`, width)),
  ];
}

function renderStatusRail(state: RichTuiState, width: number, maxRows: number): string[] {
  const rows = [
    ...renderRailSection("Plan", renderPlanRailRows(state), width),
    "",
    ...renderRailSection("Model", renderModelRailRows(state), width),
    "",
    ...renderRailSection("Run", renderRunRailRows(state), width),
    "",
    ...renderRailSection("Workspace", renderWorkspaceRailRows(state), width),
  ].slice(0, maxRows);
  while (rows.length < maxRows) {
    rows.push("");
  }
  return rows;
}

function renderRailSection(title: string, rows: string[], width: number): string[] {
  const safeRows = rows.length > 0 ? rows : ["-"];
  return [
    clip(`${ansi.bold}${title}${ansi.reset}`, width),
    ...safeRows.map((row) => clip(row, width)),
  ];
}

function renderPlanRailRows(state: RichTuiState): string[] {
  const todos = state.todos ?? [];
  if (todos.length > 0) {
    const completed = todos.filter((todo) => todo.status === "completed").length;
    const active = todos.find((todo) => todo.status === "in_progress");
    const pending = todos.filter((todo) => todo.status === "pending");
    return [
      `${completed} / ${todos.length} done`,
      active ? "Now" : undefined,
      active?.content,
      pending.length > 0 ? "Remaining" : undefined,
      ...pending.slice(0, 3).map((todo) => `- ${todo.content}`),
      state.pendingPlanApproval?.planPath ? `File: ${formatWorkspaceRelativePath(state.workspace, state.pendingPlanApproval.planPath)}` : undefined,
      formatTodoSummary(state),
    ].filter((row): row is string => Boolean(row));
  }
  if (state.pendingPlanApproval) {
    return [
      "Plan needs approval",
      state.pendingPlanApproval.planPath ? `File: ${formatWorkspaceRelativePath(state.workspace, state.pendingPlanApproval.planPath)}` : undefined,
      "/approve plan",
    ].filter((row): row is string => Boolean(row));
  }
  if (state.goal) {
    return [
      `Goal: ${state.goal.status}`,
      `Progress: ${state.goal.checkpoints} checkpoints`,
      state.goal.summary,
    ];
  }
  return ["No active plan"];
}

function renderModelRailRows(state: RichTuiState): string[] {
  return [
    state.provider,
    state.model,
    formatContextWindow(state),
    state.context ? `${state.context.percentUsed}%` : "context n/a",
    `readiness: ${state.readiness}`,
    `Context: ${formatContextDetails(state)}`,
  ];
}

function renderRunRailRows(state: RichTuiState): string[] {
  const rows = [
    `Mode: ${state.mode} - ${describeMode(state.mode)}`,
    `Run: ${state.runHealth ?? "Ready"}`,
    `Activity: ${formatActivityStatus(state)}`,
    state.goal ? `Goal: ${state.goal.status}` : undefined,
    state.goal ? `Progress: ${state.goal.checkpoints} checkpoints` : undefined,
    state.stepCount !== undefined ? `Step ${state.stepCount}` : undefined,
    state.lastEventTitle ? `Event: ${state.lastEventTitle}` : undefined,
    state.runBudget ? `Budget: ${state.runBudget.modelCalls} model calls` : undefined,
    state.runBudget ? `${state.runBudget.steps} steps${formatBudgetLimitTail(state.runBudget)}` : undefined,
    state.activeSessionId ? `Session: ${state.activeSessionId}` : undefined,
    resumeGuidance(state) ? `Next: ${resumeGuidance(state)}` : undefined,
    state.mode === "Goal" && state.activeSessionId && state.goal?.status !== "complete" && state.goal?.status !== "cancelled"
      ? "Next: /pause /cancel /background"
      : undefined,
    state.runHealth === "Working" ? "Esc: stop generation" : undefined,
    "Ctrl+C: exit TUI",
    state.pendingPlanApproval ? "Plan needs approval: /approve plan" : undefined,
    state.version ? `Soloclaw ${state.version}` : undefined,
  ].filter((row): row is string => Boolean(row));
  return rows;
}

function renderWorkspaceRailRows(state: RichTuiState): string[] {
  const rows = [
    formatWorkspaceName(state.workspace),
    state.workspaceStatus ? formatWorkspaceStatus(state.workspaceStatus) : undefined,
  ].filter((row): row is string => Boolean(row));
  return rows;
}

function renderChatInput(state: RichTuiState, width: number): string[] {
  const promptLines = state.input.length > 0
    ? state.input.split(/\r?\n/).slice(-3)
    : ["Ask Soloclaw to inspect, change, test, or explain"];
  return [
    ...promptLines.map((prompt) => clip(`${ansi.purple}>${ansi.reset} ${ansi.gray}${prompt || " "}${ansi.reset}`, width)),
    renderChatFooter(state, width),
  ];
}

function renderChatFooter(state: RichTuiState, width: number): string {
  const duration = state.lastRunDurationMs === undefined ? "" : ` | ${(state.lastRunDurationMs / 1000).toFixed(1)}s`;
  const plan = formatPlanSummary(state);
  const parts = [
    state.mode,
    state.runHealth ?? "Ready",
    plan,
    formatContextSummary(state),
    "ctrl+p commands",
    "f2 mode",
    state.runHealth === "Working" ? "esc stop" : undefined,
    width >= 74 ? "ctrl+c exit" : undefined,
  ].filter(Boolean);
  return clip(`${ansi.orange}${parts.join(" | ")}${ansi.reset}${duration}`, width);
}

function formatPlanSummary(state: RichTuiState): string | undefined {
  const todos = state.todos ?? [];
  if (todos.length > 0) {
    const completed = todos.filter((todo) => todo.status === "completed").length;
    return `Plan ${completed}/${todos.length}`;
  }
  if (state.pendingPlanApproval) {
    return "Plan approval";
  }
  if (state.goal) {
    return `Goal ${state.goal.checkpoints}`;
  }
  return undefined;
}

function formatContextWindow(state: RichTuiState): string {
  const context = state.context;
  if (!context) {
    return "context n/a";
  }
  if (context.windowTokens) {
    return `${formatTokens(context.tokens)} / ${formatTokens(context.windowTokens)}`;
  }
  return `${formatTokens(context.tokens)} (${context.percentUsed}%)`;
}

function formatWorkspaceName(workspace: string): string {
  return workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace;
}

function formatWorkspaceRelativePath(workspace: string, filePath: string): string {
  const normalizedWorkspace = workspace.replace(/\\/g, "/").replace(/\/+$/g, "");
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedPath.slice(normalizedWorkspace.length + 1);
  }
  return filePath;
}

function renderWorkLedgerScreen(state: RichTuiState, width: number, height: number): string[] {
  const dock = renderInputDock(state, width);
  const bodyLimit = Math.max(0, height - dock.length);
  const top = renderTopStrip(state, width);
  const mission = renderSection("MISSION", renderMissionRows(state), width);
  const checks = renderSection("CHECKS", renderChecksRows(state), width);
  const commandBlock: string[] = [];
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
  const todoRows = renderTodoLedgerRows(state, width);
  if (todoRows.length > 0) {
    activityBlocks.push(todoRows);
  }
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
  if (state.goal) {
    rows.push(`Goal: ${state.goal.status}`);
    rows.push(`Progress: ${state.goal.checkpoints} checkpoints, ${state.goal.modelCalls} model calls`);
  }
  if (state.runBudget) {
    rows.push(`Budget: ${state.runBudget.modelCalls} model calls, ${state.runBudget.steps} steps${formatBudgetLimitTail(state.runBudget)}`);
  }
  const todoSummary = formatTodoSummary(state);
  if (todoSummary) {
    rows.push(todoSummary);
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
  if (state.mode === "Goal" && state.activeSessionId && state.goal?.status !== "complete" && state.goal?.status !== "cancelled") {
    rows.push("Next: /pause /cancel /background");
  }
  if (state.pendingPlanApproval) {
    rows.push("Plan needs approval: /approve plan");
  }
  if (state.version) {
    rows.push(`Soloclaw ${state.version}`);
  }
  return rows;
}

function renderTodoLedgerRows(state: RichTuiState, width: number): string[] {
  const todos = state.todos ?? [];
  const active = todos.filter((todo) => todo.status === "in_progress");
  const pending = todos.filter((todo) => todo.status === "pending");
  const visible = [
    ...active.map((todo) => `active ${todo.content}`),
    ...pending.slice(0, Math.max(0, 3 - active.length)).map((todo) => `next ${todo.content}`),
  ];
  return visible.map((row) => clip(`TODO   ${row}`, width));
}

function formatTodoSummary(state: RichTuiState): string | undefined {
  const todos = state.todos ?? [];
  if (todos.length === 0) {
    return undefined;
  }
  const active = todos.filter((todo) => todo.status === "in_progress").length;
  const pending = todos.filter((todo) => todo.status === "pending").length;
  const done = todos.filter((todo) => todo.status === "completed").length;
  const cancelled = todos.filter((todo) => todo.status === "cancelled").length;
  const parts = [
    `${active} active`,
    `${pending} pending`,
    `${done} done`,
    cancelled > 0 ? `${cancelled} cancelled` : undefined,
  ].filter(Boolean);
  return `Todos: ${parts.join(", ")}`;
}

function formatBudgetLimitTail(budget: NonNullable<RichTuiState["runBudget"]>): string {
  const limits = [
    budget.maxModelCalls !== undefined ? `max calls ${budget.maxModelCalls}` : undefined,
    budget.maxSteps !== undefined ? `max steps ${budget.maxSteps}` : undefined,
    budget.maxDurationMs !== undefined ? `max ${(budget.maxDurationMs / 1000).toFixed(0)}s` : undefined,
  ].filter(Boolean);
  return limits.length > 0 ? ` (${limits.join(", ")})` : "";
}

function renderCommandPalettePanel(state: RichTuiState, width: number, height: number): string[] {
  const panelWidth = Math.max(24, Math.min(Math.max(58, Math.floor(width * 0.72)), width - 4));
  const contentWidth = Math.max(1, panelWidth - 4);
  const cursorIndex = state.commandPalette?.cursorIndex ?? 0;
  const visibleLimit = Math.max(1, Math.min(9, TUI_COMMANDS.length, Math.max(1, height - 8)));
  const startIndex = Math.max(0, Math.min(cursorIndex - visibleLimit + 1, Math.max(0, TUI_COMMANDS.length - visibleLimit)));
  const visibleCommands = TUI_COMMANDS.slice(startIndex, startIndex + visibleLimit);
  const range = TUI_COMMANDS.length > 0 ? `${startIndex + 1}-${startIndex + visibleCommands.length} of ${TUI_COMMANDS.length}` : "0 of 0";
  const rows = [
    `${ansi.bold}Commands${ansi.reset}  ${range}`,
    `${ansi.gray}up/down select - enter run - space insert - esc close${ansi.reset}`,
    "-".repeat(contentWidth),
    ...visibleCommands.map((command, visibleIndex) => {
      const index = startIndex + visibleIndex;
      const cursor = index === cursorIndex ? ">" : " ";
      const checked = index === cursorIndex ? "[ ]" : "   ";
      return `${cursor} ${checked} ${command.name}  ${ansi.gray}${command.description}${ansi.reset}`;
    }),
    startIndex > 0 ? `${ansi.gray}more above${ansi.reset}` : "",
    startIndex + visibleCommands.length < TUI_COMMANDS.length ? `${ansi.gray}more below${ansi.reset}` : "",
  ].filter((row) => row.length > 0);

  return renderBorderedPanel(rows, contentWidth);
}

function renderCommandSuggestionsPanel(state: RichTuiState, width: number, height: number): string[] {
  const panelWidth = Math.max(24, Math.min(Math.max(58, Math.floor(width * 0.72)), width - 4));
  const contentWidth = Math.max(1, panelWidth - 4);
  const matches = commandSuggestionsForInput(state.input);
  const cursorIndex = state.commandSuggestions?.cursorIndex ?? 0;
  if (matches.length === 0) {
    return [];
  }
  const visibleLimit = Math.max(1, Math.min(8, matches.length, Math.max(1, height - 8)));
  const startIndex = Math.max(0, Math.min(cursorIndex - visibleLimit + 1, Math.max(0, matches.length - visibleLimit)));
  const visibleCommands = matches.slice(startIndex, startIndex + visibleLimit);
  const range = `${startIndex + 1}-${startIndex + visibleCommands.length} of ${matches.length}`;
  const rows = [
    `${ansi.bold}Commands${ansi.reset}  ${range}`,
    `${ansi.gray}up/down select - enter run - tab complete - esc close${ansi.reset}`,
    "-".repeat(contentWidth),
    ...visibleCommands.map((command, visibleIndex) => {
      const index = startIndex + visibleIndex;
      const cursor = index === cursorIndex ? ">" : " ";
      return `${cursor} ${command.name}  ${ansi.gray}${command.description}${ansi.reset}`;
    }),
    startIndex > 0 ? `${ansi.gray}more above${ansi.reset}` : "",
    startIndex + visibleCommands.length < matches.length ? `${ansi.gray}more below${ansi.reset}` : "",
  ].filter((row) => row.length > 0);

  return renderBorderedPanel(rows, contentWidth);
}

function renderSessionPickerPanel(state: RichTuiState, width: number, height: number): string[] {
  const panelWidth = Math.max(24, Math.min(Math.max(52, Math.floor(width * 0.68)), width - 4));
  const contentWidth = Math.max(1, panelWidth - 4);
  const choices = state.sessionChoices ?? [];
  const cursorIndex = state.sessionPicker?.cursorIndex ?? 0;
  const visibleLimit = Math.max(1, Math.min(5, choices.length || 1, Math.max(1, height - 8)));
  const startIndex = Math.max(0, Math.min(cursorIndex - visibleLimit + 1, Math.max(0, choices.length - visibleLimit)));
  const visibleChoices = choices.slice(startIndex, startIndex + visibleLimit);
  const range = choices.length > 0 ? `${startIndex + 1}-${startIndex + visibleChoices.length} of ${choices.length}` : "0 of 0";
  const rows = [
    `${ansi.bold}Sessions${ansi.reset}  ${range}`,
    `${ansi.gray}up/down select - enter resume - esc close${ansi.reset}`,
    "-".repeat(contentWidth),
    ...visibleChoices.map((choice, visibleIndex) => {
      const index = startIndex + visibleIndex;
      const cursor = index === cursorIndex ? ">" : " ";
      return `${cursor} ${choice.title}  ${ansi.gray}${formatSessionChoiceMeta(choice)}${ansi.reset}`;
    }),
    startIndex > 0 ? `${ansi.gray}more above${ansi.reset}` : "",
    startIndex + visibleChoices.length < choices.length ? `${ansi.gray}more below${ansi.reset}` : "",
  ].filter((row) => row.length > 0);

  return renderBorderedPanel(rows, contentWidth);
}

function formatSessionChoiceMeta(choice: NonNullable<RichTuiState["sessionChoices"]>[number]): string {
  const parts = [
    choice.workspace ? `workspace=${formatWorkspaceName(choice.workspace)}` : undefined,
    choice.id,
  ].filter((part): part is string => Boolean(part));
  return parts.join("  ");
}

function renderBorderedPanel(rows: string[], contentWidth: number): string[] {
  const panelWidth = contentWidth + 4;
  const border = `+${"-".repeat(Math.max(0, panelWidth - 2))}+`;
  return [
    border,
    ...rows.map((row) => `| ${padRight(clip(row, contentWidth), contentWidth)} |`),
    border,
  ];
}

function renderFramedPanel(title: string, rows: string[], width: number, height: number): string[] {
  if (height <= 0) {
    return [];
  }
  const panelWidth = Math.max(4, width);
  if (height === 1) {
    return [clip(renderFrameTop(title, panelWidth), panelWidth)];
  }
  const contentWidth = Math.max(0, panelWidth - 4);
  const contentHeight = Math.max(0, height - 2);
  const visibleRows = rows.slice(0, contentHeight);
  while (visibleRows.length < contentHeight) {
    visibleRows.push("");
  }
  return [
    renderFrameTop(title, panelWidth),
    ...visibleRows.map((row) => `| ${padRight(clip(row, contentWidth), contentWidth)} |`),
    `+${"-".repeat(Math.max(0, panelWidth - 2))}+`,
  ].slice(0, height);
}

function renderFrameTop(title: string, width: number): string {
  const label = ` ${title} `;
  const fill = Math.max(0, width - 2 - visibleLength(label));
  return `+${label}${"-".repeat(fill)}+`;
}

function renderOverlay(baseRows: string[], panelRows: string[], width: number, height: number): string[] {
  const rows = baseRows.slice(0, height);
  while (rows.length < height) {
    rows.push("");
  }
  const panelWidth = Math.min(width, Math.max(...panelRows.map((row) => visibleLength(row))));
  const left = Math.max(0, Math.floor((width - panelWidth) / 2));
  const top = Math.max(1, Math.floor((height - panelRows.length) / 3));
  for (let index = 0; index < panelRows.length && top + index < height; index += 1) {
    rows[top + index] = padRight(clip(`${" ".repeat(left)}${panelRows[index]}`, width), width);
  }
  return rows;
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
  const stop = state.runHealth === "Working" ? " | esc stop" : "";
  return clip(`${ansi.orange}${state.mode}${ansi.reset} | ${state.provider}/${state.model}${duration}${activity} | ${formatContextSummary(state)} | ctrl+p commands | f2 mode${stop} | ctrl+c exit`, width);
}

function formatActivityStatus(state: RichTuiState): string {
  if (state.currentActivity) {
    if (state.stepCount !== undefined) {
      const step = `Step ${state.stepCount}`;
      return state.currentActivity.includes(step) ? state.currentActivity : `${state.currentActivity} ${step}`;
    }
    return state.currentActivity;
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

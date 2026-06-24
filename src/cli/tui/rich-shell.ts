import { stdin, stdout } from "node:process";
import { emitKeypressEvents } from "node:readline";
import type { AgentRunEvent, AgentRunEventSink } from "../../core/agent-events.js";
import { projectAgentRunEventsToAssistantMessages } from "../../core/agent-message-projector.js";
import type { AgentMessage } from "../../protocol/types.js";
import {
  buildPhaseTwoClosureStatus,
  buildPhaseTwoEvidenceCheck,
  buildPhaseTwoEvidenceReview,
  buildPhaseTwoExternalTerminalLaunch,
  buildPhaseTwoGateSummary,
  buildPhaseTwoNextAction,
  buildPhaseTwoRealProviderReadiness,
  buildPhaseTwoReviewBoard,
  checkPhaseTwoClosureTask,
  recordPhaseTwoEvidence,
  renderPhaseTwoClosureStatus,
  renderPhaseTwoClosureTask,
  renderPhaseTwoCloseoutGuide,
  renderPhaseTwoCloseoutWizardGuide,
  renderPhaseTwoEvidenceCheck,
  renderPhaseTwoEvidenceRecord,
  renderPhaseTwoEvidenceReview,
  renderPhaseTwoEvidenceTemplate,
  renderPhaseTwoExternalTerminalLaunch,
  renderPhaseTwoFinalGatePlan,
  renderPhaseTwoGateSummary,
  renderPhaseTwoManualChecklist,
  renderPhaseTwoNextAction,
  renderPhaseTwoOperatorRunbook,
  renderPhaseTwoRealProviderReadiness,
  renderPhaseTwoReviewBoard,
  type PhaseTwoEvidenceRecordSection,
} from "../phase2-closure-status.js";
import { ansi, center, clip, type TerminalSize } from "./ansi.js";
import { commandSuggestionsForInput, commonCommandPrefix, TUI_COMMANDS } from "./commands.js";
import { renderConversationScreen, renderWelcomeScreen } from "./layout.js";
import { createRichModelSetupState, handleRichModelSetupKey, type RichModelSetupProfile, type RichModelSetupRequest } from "./model-setup.js";
import { describeMode, nextMode, resumeGuidance, type RichTuiContextMetrics, type RichTuiFocus, type RichTuiMode, type RichTuiRunHealth, type RichTuiSessionChoice, type RichTuiState, type RichTuiWorkspaceStatus } from "./state.js";

export type RichTuiSelectionInput = {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  forcePlain: boolean;
};

export type RichTuiTaskRunInput = {
  task: string;
  mode: RichTuiMode;
  onEvent: AgentRunEventSink;
};

export type RichTuiSessionResumeInput = {
  sessionId: string;
  onEvent: AgentRunEventSink;
};

export type RichTuiTaskRunResult = {
  answer: string;
  sessionId?: string;
  planPath?: string;
  context?: RichTuiContextMetrics;
  durationMs?: number;
  todos?: RichTuiState["todos"];
  transcript?: RichTuiState["messages"];
  restoredOnly?: boolean;
  sessionStatus?: string;
};

export type RichTuiModelSetupResult = {
  provider: string;
  model: string;
  readiness: string;
};

export type RichTuiSessionEntry = {
  id: string;
  targetMode: string;
  status: string;
  outcome: string;
  workspace?: string;
  pendingApprovals: number;
  commandsFinished: number;
  failedCommands: number;
  changedPaths: string[];
  updatedAt: string;
  objective: string;
  handoffState?: string;
  handoffNextCommand?: string;
};

export type RichTuiSessionsResult = {
  returned: number;
  scanned: number;
  limit: number;
  byStatus: Record<string, number>;
  byOutcome: Record<string, number>;
  pendingApprovals: number;
  changedSessions: number;
  sessions: RichTuiSessionEntry[];
};

const SESSION_TITLE_WIDTH = 72;
const STOP_GENERATION_REASON = "Stopped from Soloclaw TUI.";

export type RichShellContext = {
  workspace: string;
  provider: string;
  model: string;
  readiness: string;
  version: string;
  workspaceStatus?: RichTuiWorkspaceStatus;
  modelProfiles?: RichModelSetupProfile[];
  runTask?: (input: RichTuiTaskRunInput) => Promise<RichTuiTaskRunResult>;
  resumeSession?: (input: RichTuiSessionResumeInput) => Promise<RichTuiTaskRunResult>;
  setupModel?: () => Promise<RichTuiModelSetupResult>;
  setupModelFromWizard?: (input: RichModelSetupRequest) => Promise<RichTuiModelSetupResult>;
  listSessions?: () => Promise<RichTuiSessionsResult>;
  pauseSession?: (input: RichTuiSessionControlInput) => Promise<void>;
  cancelSession?: (input: RichTuiSessionControlInput) => Promise<void>;
  backgroundSession?: (input: RichTuiBackgroundSessionInput) => Promise<void>;
  startupSplash?: boolean | RichTuiStartupSplashOptions;
};

export type RichTuiStartupSplashOptions = {
  frames?: number;
  frameMs?: number;
};

export type RichTuiInputStream = {
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  resume: () => unknown;
  on: (event: "keypress", listener: (value: string, key?: RichTuiKey) => void) => unknown;
  off: (event: "keypress", listener: (value: string, key?: RichTuiKey) => void) => unknown;
};

export type RichTuiOutputStream = {
  columns?: number;
  rows?: number;
  write: (value: string) => unknown;
  on: (event: "resize", listener: () => void) => unknown;
  off: (event: "resize", listener: () => void) => unknown;
};

export type RichTuiTerminal = {
  input: RichTuiInputStream;
  output: RichTuiOutputStream;
  emitKeypressEvents?: (input: RichTuiInputStream) => void;
};

export type RichTuiKey = {
  ctrl?: boolean;
  name?: string;
  shift?: boolean;
};

export type RichTuiKeyInput = {
  value?: string;
  key?: RichTuiKey;
  busy?: boolean;
};

export type RichTuiKeyAction = "none" | "redraw" | "submit" | "exit" | "cancel" | "model_setup_submit";

export type RichTuiSubmitAction = { type: "redraw" } | { type: "exit" } | { type: "model_setup" };

export type RichTuiSubmitContext = {
  runTask?: (input: RichTuiTaskRunInput) => Promise<RichTuiTaskRunResult>;
  resumeSession?: (input: RichTuiSessionResumeInput) => Promise<RichTuiTaskRunResult>;
  listSessions?: () => Promise<RichTuiSessionsResult>;
  pauseSession?: (input: RichTuiSessionControlInput) => Promise<void>;
  cancelSession?: (input: RichTuiSessionControlInput) => Promise<void>;
  backgroundSession?: (input: RichTuiBackgroundSessionInput) => Promise<void>;
  nowMs?: () => number;
  onStateChange?: () => void;
  isStopRequested?: () => boolean;
};

export type RichTuiSessionControlInput = {
  sessionId: string;
  reason: string;
};

export type RichTuiBackgroundSessionInput = {
  sessionId: string;
};

export function shouldUseRichTui(input: RichTuiSelectionInput): boolean {
  return input.stdinIsTTY && input.stdoutIsTTY && !input.forcePlain;
}

export function resolveModeCommand(current: RichTuiMode, line: string): RichTuiMode | undefined {
  const [, rawMode] = line.trim().split(/\s+/, 2);
  if (!rawMode) {
    return nextMode(current);
  }
  switch (rawMode.toLowerCase()) {
    case "plan":
      return "Plan";
    case "build":
      return "Build";
    case "goal":
      return "Goal";
    default:
      return undefined;
  }
}

export function applyModelSetupResult(state: RichTuiState, result: RichTuiModelSetupResult): void {
  state.provider = result.provider;
  state.model = result.model;
  state.readiness = result.readiness;
  state.messages.push({ role: "system", text: `Model: ${result.provider} ${result.model}` });
}

export function createStatusMessage(state: RichTuiState): string {
  return [
    `Run: ${state.runHealth ?? "Ready"}`,
    `Activity: ${formatActivityStatus(state)}`,
    `Mode: ${state.mode} - ${describeMode(state.mode)}`,
    state.pendingPlanApproval ? `Plan needs approval: /approve plan` : undefined,
    `Provider: ${state.provider}`,
    `Model: ${state.model}`,
    `Readiness: ${state.readiness}`,
    `Context: ${formatContextMessage(state.context)}`,
    state.goal ? formatGoalStatusMessage(state) : undefined,
    state.runBudget ? formatRunBudgetMessage(state) : undefined,
    `LSP: ${state.lsp?.label ?? "LSPs are disabled"}`,
    `Workspace: ${state.workspace}`,
    state.workspaceStatus ? `Git: ${formatWorkspaceStatus(state.workspaceStatus)}` : undefined,
    state.activeSessionId ? `Session: ${state.activeSessionId}` : undefined,
    resumeGuidance(state) ? `Next: ${resumeGuidance(state)}` : undefined,
  ].filter(Boolean).join("\n");
}

export function createSessionsMessage(result: RichTuiSessionsResult): string {
  const lines = [
    `Sessions: ${result.returned}/${result.scanned} limit=${result.limit}`,
    `status=${formatCounts(result.byStatus)} outcome=${formatCounts(result.byOutcome)}`,
    `pendingApprovals=${result.pendingApprovals} changedSessions=${result.changedSessions}`,
  ];
  if (result.sessions.length === 0) {
    lines.push("No sessions found.");
    return lines.join("\n");
  }
  lines.push("");
  lines.push("Recent sessions (type /resume <number> to continue):");
  for (const [index, session] of result.sessions.entries()) {
    const menuNumber = index + 1;
    lines.push("");
    lines.push(`${menuNumber}. ${deriveSessionTitle(session.objective)}`);
    lines.push(`${session.id} | ${session.targetMode} | ${session.status} | ${session.outcome} | workspace=${session.workspace ?? "-"} | updated=${session.updatedAt}`);
    lines.push(`resume: /resume ${menuNumber}`);
    lines.push(`work: pending=${session.pendingApprovals} commands=${session.commandsFinished}/${session.failedCommands}`);
    lines.push(`changes: ${session.changedPaths.length > 0 ? session.changedPaths.join(",") : "-"}`);
    lines.push(`next: ${session.handoffNextCommand ?? "-"}`);
  }
  return lines.join("\n");
}

function deriveSessionTitle(objective: string | undefined): string {
  const normalized = (objective ?? "").replace(/\s+/g, " ").trim();
  return clip(normalized || "Untitled session", SESSION_TITLE_WIDTH);
}

function toSessionChoice(session: RichTuiSessionEntry): RichTuiSessionChoice {
  return {
    id: session.id,
    title: deriveSessionTitle(session.objective),
    workspace: session.workspace,
  };
}

export function agentMessagesToRichTuiTranscript(messages: AgentMessage[]): RichTuiState["messages"] {
  const transcript: RichTuiState["messages"] = [];
  for (const message of messages) {
    if (message.role === "user") {
      transcript.push({ role: "user", text: message.content });
      continue;
    }
    if (message.role === "assistant" && message.content.trim().length > 0) {
      transcript.push({ role: "assistant", text: message.content });
    }
  }
  return transcript;
}

export function openCommandPalette(state: RichTuiState): void {
  closeCommandSuggestions(state);
  state.commandPalette = {
    open: true,
    cursorIndex: boundedCommandIndex(state.commandPalette?.cursorIndex ?? 0),
  };
  state.focus = "commands";
}

export function closeCommandPalette(state: RichTuiState): void {
  if (state.commandPalette) {
    state.commandPalette.open = false;
  }
  state.focus = "input";
}

function closeCommandSuggestions(state: RichTuiState): void {
  if (state.commandSuggestions) {
    state.commandSuggestions.open = false;
  }
}

export function openSessionPicker(state: RichTuiState): void {
  if (!state.sessionChoices?.length) {
    delete state.sessionPicker;
    return;
  }
  if (state.commandPalette) {
    state.commandPalette.open = false;
  }
  closeCommandSuggestions(state);
  state.sessionPicker = {
    open: true,
    cursorIndex: boundedSessionPickerIndex(state, state.sessionPicker?.cursorIndex ?? 0),
  };
  state.focus = "input";
}

export function closeSessionPicker(state: RichTuiState): void {
  delete state.sessionPicker;
  state.focus = "input";
}

export function moveSessionPickerCursor(state: RichTuiState, delta: number): void {
  if (!state.sessionPicker?.open || !state.sessionChoices?.length) {
    return;
  }
  state.sessionPicker.cursorIndex = boundedSessionPickerIndex(state, state.sessionPicker.cursorIndex + delta);
}

export function selectedSessionPickerChoice(state: RichTuiState): RichTuiSessionChoice | undefined {
  if (!state.sessionPicker?.open || !state.sessionChoices?.length) {
    return undefined;
  }
  return state.sessionChoices[boundedSessionPickerIndex(state, state.sessionPicker.cursorIndex)];
}

export function moveCommandPaletteCursor(state: RichTuiState, delta: number): void {
  openCommandPalette(state);
  const current = state.commandPalette?.cursorIndex ?? 0;
  state.commandPalette = {
    open: true,
    cursorIndex: boundedCommandIndex(current + delta),
  };
}

export function commandPaletteLine(state: RichTuiState): string | undefined {
  if (!state.commandPalette?.open) {
    return undefined;
  }
  return TUI_COMMANDS[boundedCommandIndex(state.commandPalette.cursorIndex)]?.command;
}

function refreshCommandSuggestions(state: RichTuiState): void {
  if (state.commandPalette?.open || state.sessionPicker?.open || state.modelSetup?.open) {
    closeCommandSuggestions(state);
    return;
  }
  const matches = commandSuggestionsForInput(state.input);
  if (matches.length === 0) {
    closeCommandSuggestions(state);
    return;
  }
  state.commandSuggestions = {
    open: true,
    cursorIndex: boundedCommandSuggestionIndex(state, state.commandSuggestions?.cursorIndex ?? 0),
  };
}

function moveCommandSuggestionCursor(state: RichTuiState, delta: number): void {
  refreshCommandSuggestions(state);
  if (!state.commandSuggestions?.open) {
    return;
  }
  state.commandSuggestions = {
    open: true,
    cursorIndex: boundedCommandSuggestionIndex(state, state.commandSuggestions.cursorIndex + delta),
  };
}

function applySelectedCommandSuggestion(state: RichTuiState): boolean {
  const matches = commandSuggestionsForInput(state.input);
  if (matches.length === 0) {
    closeCommandSuggestions(state);
    return false;
  }
  const selected = matches[boundedCommandSuggestionIndex(state, state.commandSuggestions?.cursorIndex ?? 0)];
  if (!selected) {
    closeCommandSuggestions(state);
    return false;
  }
  state.input = selected.command;
  closeCommandSuggestions(state);
  return true;
}

function completeOrOpenCommandSuggestion(state: RichTuiState): boolean {
  const matches = commandSuggestionsForInput(state.input);
  if (matches.length === 0) {
    closeCommandSuggestions(state);
    return false;
  }
  if (state.commandSuggestions?.open) {
    return applySelectedCommandSuggestion(state);
  }
  if (matches.length === 1) {
    state.input = matches[0]?.command ?? state.input;
    closeCommandSuggestions(state);
    return true;
  }
  const commonPrefix = commonCommandPrefix(matches);
  const leading = state.input.match(/^\s*/)?.[0] ?? "";
  const currentPrefix = state.input.trimStart();
  if (commonPrefix.length > currentPrefix.length) {
    state.input = `${leading}${commonPrefix}`;
    refreshCommandSuggestions(state);
    return true;
  }
  state.commandSuggestions = { open: true, cursorIndex: 0 };
  return true;
}

export function handleRichTuiKey(state: RichTuiState, input: RichTuiKeyInput): RichTuiKeyAction {
  const key = input.key ?? {};
  const value = input.value;
  if (state.modelSetup?.open) {
    const action = handleRichModelSetupKey(state.modelSetup, input);
    if (action.type === "cancel") {
      delete state.modelSetup;
      delete state.pendingModelSetupRequest;
      return "redraw";
    }
    if (action.type === "complete") {
      state.pendingModelSetupRequest = action.request;
      return "model_setup_submit";
    }
    return "redraw";
  }
  if (state.sessionPicker?.open) {
    if (key.ctrl && key.name === "c") {
      return "exit";
    }
    if (key.name === "escape") {
      closeSessionPicker(state);
      return "redraw";
    }
    if (key.name === "up") {
      moveSessionPickerCursor(state, -1);
      return "redraw";
    }
    if (key.name === "down") {
      moveSessionPickerCursor(state, 1);
      return "redraw";
    }
    if (key.name === "return" || key.name === "enter") {
      const choice = selectedSessionPickerChoice(state);
      if (!choice) {
        closeSessionPicker(state);
        return "redraw";
      }
      state.input = `/resume ${choice.id}`;
      closeSessionPicker(state);
      return "submit";
    }
    return "none";
  }
  if (state.commandPalette?.open) {
    if (key.ctrl && key.name === "c") {
      return "exit";
    }
    if (key.name === "escape") {
      closeCommandPalette(state);
      return "redraw";
    }
    if (key.name === "up") {
      moveCommandPaletteCursor(state, -1);
      return "redraw";
    }
    if (key.name === "down") {
      moveCommandPaletteCursor(state, 1);
      return "redraw";
    }
    if (value === " " || key.name === "space") {
      state.input = commandPaletteLine(state) ?? state.input;
      closeCommandPalette(state);
      return "redraw";
    }
    if (key.name === "return" || key.name === "enter") {
      state.input = commandPaletteLine(state) ?? state.input;
      closeCommandPalette(state);
      return "submit";
    }
    return "none";
  }
  if (state.commandSuggestions?.open) {
    if (key.ctrl && key.name === "c") {
      return "exit";
    }
    if (key.name === "escape") {
      closeCommandSuggestions(state);
      return "redraw";
    }
    if (key.name === "up") {
      moveCommandSuggestionCursor(state, -1);
      return "redraw";
    }
    if (key.name === "down") {
      moveCommandSuggestionCursor(state, 1);
      return "redraw";
    }
    if (key.name === "tab") {
      applySelectedCommandSuggestion(state);
      return "redraw";
    }
    if (key.name === "return" || key.name === "enter") {
      applySelectedCommandSuggestion(state);
      return "submit";
    }
  }

  if (key.ctrl && key.name === "c") {
    return "exit";
  }
  if (key.name === "escape") {
    return input.busy || state.runHealth === "Working" ? "cancel" : "none";
  }
  if (key.ctrl && key.name === "p") {
    openCommandPalette(state);
    return "redraw";
  }
  if ((key.ctrl && key.name === "m") || key.name === "f2") {
    state.mode = nextMode(state.mode);
    return "redraw";
  }
  if (key.name === "tab") {
    if (completeOrOpenCommandSuggestion(state)) {
      return "redraw";
    }
    state.focus = nextFocus(state.focus ?? "input");
    return "redraw";
  }
  if (state.focus === "transcript") {
    if (key.name === "up") {
      state.transcriptScrollOffset = Math.min((state.transcriptScrollOffset ?? 0) + 1, Math.max(0, state.messages.length - 1));
      return "redraw";
    }
    if (key.name === "down") {
      state.transcriptScrollOffset = Math.max(0, (state.transcriptScrollOffset ?? 0) - 1);
      return "redraw";
    }
  }
  if (key.name === "up") {
    return recallInputHistory(state, -1) ? "redraw" : "none";
  }
  if (key.name === "down") {
    return recallInputHistory(state, 1) ? "redraw" : "none";
  }
  if (key.name === "backspace") {
    clearInputHistoryCursor(state);
    state.input = state.input.slice(0, -1);
    refreshCommandSuggestions(state);
    return "redraw";
  }
  if ((key.shift && key.name === "return") || (key.shift && key.name === "enter")) {
    clearInputHistoryCursor(state);
    state.input += state.input.length > 0 ? "\n" : "";
    return "redraw";
  }
  if (input.busy && (key.name === "return" || key.name === "enter")) {
    return "redraw";
  }
  if (key.name === "return" || key.name === "enter") {
    closeCommandSuggestions(state);
    return "submit";
  }
  if (value && value >= " " && value !== "\x7f") {
    clearInputHistoryCursor(state);
    state.input += value;
    refreshCommandSuggestions(state);
    return "redraw";
  }
  return "none";
}

function recallInputHistory(state: RichTuiState, direction: -1 | 1): boolean {
  const history = state.inputHistory ?? [];
  if (history.length === 0) {
    return false;
  }
  if (state.inputHistoryIndex === undefined) {
    if (direction > 0) {
      return false;
    }
    state.inputHistoryDraft = state.input;
    state.inputHistoryIndex = history.length - 1;
    state.input = history[state.inputHistoryIndex] ?? state.input;
    return true;
  }
  const next = state.inputHistoryIndex + direction;
  if (next < 0) {
    return true;
  }
  if (next >= history.length) {
    state.input = state.inputHistoryDraft ?? "";
    clearInputHistoryCursor(state);
    return true;
  }
  state.inputHistoryIndex = next;
  state.input = history[next] ?? state.input;
  return true;
}

function clearInputHistoryCursor(state: RichTuiState): void {
  delete state.inputHistoryIndex;
  delete state.inputHistoryDraft;
}

export function applyAgentRunEventToRichState(state: RichTuiState, event: AgentRunEvent): void {
  if (event.type === "session_started") {
    state.activeSessionId = event.sessionId;
  }
  updateContextFromEvent(state, event);
  updateRunBudgetFromEvent(state, event);
  updateGoalFromEvent(state, event);
  updateRunHealthFromEvent(state, event);
  updateActivityFromEvent(state, event);
  appendProjectedAgentRunEvent(state, event);
  if (event.type === "assistant_text") {
    if (event.final) {
      commitAssistantAnswer(state, event.text);
      return;
    }
    appendAssistantTextDelta(state, event.text);
    return;
  }
  state.events.push(event);
}

function appendProjectedAgentRunEvent(state: RichTuiState, event: AgentRunEvent): void {
  state.agentRunEvents = [...(state.agentRunEvents ?? []), event];
  state.projectedAssistantMessages = projectAgentRunEventsToAssistantMessages(state.agentRunEvents);
}

export function commitAssistantAnswer(state: RichTuiState, answer: string): void {
  const streamingIndex = state.streamingAssistantMessageIndex;
  if (streamingIndex !== undefined && state.messages[streamingIndex]?.role === "assistant") {
    state.messages[streamingIndex] = { role: "assistant", text: answer };
    state.streamingAssistantMessageIndex = undefined;
    state.lastAssistantMessageText = answer;
    return;
  }
  const last = state.messages.at(-1);
  if (last?.role === "assistant" && last.text === answer) {
    state.lastAssistantMessageText = answer;
    return;
  }
  state.messages.push({ role: "assistant", text: answer });
  state.lastAssistantMessageText = answer;
}

export async function submitRichTuiInput(state: RichTuiState, context: RichTuiSubmitContext = {}): Promise<RichTuiSubmitAction> {
  const line = state.input.trim();
  state.input = "";
  clearInputHistoryCursor(state);
  closeCommandSuggestions(state);
  if (!line) {
    return { type: "redraw" };
  }
  rememberInputHistory(state, line);
  if (line === "/exit" || line === "exit" || line === "quit") {
    return { type: "exit" };
  }
  if (line === "/help" || line === "/commands") {
    showCommands(state);
    return { type: "redraw" };
  }
  if (line === "/clear") {
    clearTranscriptState(state);
    return { type: "redraw" };
  }
  if (line === "/status" || line === "/model check") {
    state.messages.push({ role: "system", text: createStatusMessage(state) });
    return { type: "redraw" };
  }
  if (line === "/phase2 status") {
    state.messages.push({ role: "system", text: renderPhaseTwoClosureStatus(buildPhaseTwoClosureStatus()) });
    return { type: "redraw" };
  }
  if (line === "/phase2 gate") {
    state.messages.push({ role: "system", text: renderPhaseTwoGateSummary(await buildPhaseTwoGateSummary(state.workspace)) });
    return { type: "redraw" };
  }
  if (line === "/phase2 next" || line === "/phase2 next-action") {
    state.messages.push({ role: "system", text: renderPhaseTwoNextAction(await buildPhaseTwoNextAction(state.workspace)) });
    return { type: "redraw" };
  }
  if (line === "/phase2 review" || line === "/phase2 review-board") {
    state.messages.push({ role: "system", text: renderPhaseTwoReviewBoard(await buildPhaseTwoReviewBoard(state.workspace)) });
    return { type: "redraw" };
  }
  if (line === "/phase2 evidence-show" || line.startsWith("/phase2 evidence-show ") || line.startsWith("/phase2 evidence ")) {
    try {
      const rawArgs = line.startsWith("/phase2 evidence-show ")
        ? line.slice("/phase2 evidence-show".length).trim()
        : line.startsWith("/phase2 evidence ")
          ? line.slice("/phase2 evidence".length).trim()
          : "";
      const parsed = parseRichPhaseTwoEvidenceShowArgs(splitRichCommandWords(rawArgs));
      state.messages.push({ role: "system", text: renderPhaseTwoEvidenceReview(await buildPhaseTwoEvidenceReview(state.workspace, parsed)) });
    } catch (error) {
      state.messages.push({ role: "system", text: `Error: ${redactInlineSecretText(error instanceof Error ? error.message : String(error))}` });
    }
    return { type: "redraw" };
  }
  if (line === "/phase2 launch-terminal" || line === "/phase2 terminal") {
    state.messages.push({
      role: "system",
      text: renderPhaseTwoExternalTerminalLaunch(buildPhaseTwoExternalTerminalLaunch(state.workspace), false),
    });
    return { type: "redraw" };
  }
  if (line === "/phase2 final-gate" || line === "/phase2 c3-gate") {
    state.messages.push({ role: "system", text: renderPhaseTwoFinalGatePlan(state.workspace) });
    return { type: "redraw" };
  }
  if (line === "/phase2 readiness") {
    state.messages.push({ role: "system", text: renderPhaseTwoRealProviderReadiness(await buildPhaseTwoRealProviderReadiness(state.workspace)) });
    return { type: "redraw" };
  }
  if (line === "/phase2 checklist") {
    state.messages.push({ role: "system", text: renderPhaseTwoManualChecklist() });
    return { type: "redraw" };
  }
  if (line === "/phase2 closeout-guide" || line === "/phase2 guide") {
    state.messages.push({ role: "system", text: renderPhaseTwoCloseoutGuide() });
    return { type: "redraw" };
  }
  if (line === "/phase2 closeout-wizard" || line === "/phase2 evidence-wizard") {
    state.messages.push({ role: "system", text: renderPhaseTwoCloseoutWizardGuide() });
    return { type: "redraw" };
  }
  if (line === "/phase2 operator-runbook" || line === "/phase2 runbook") {
    state.messages.push({
      role: "system",
      text: renderPhaseTwoOperatorRunbook(await buildPhaseTwoGateSummary(state.workspace), buildPhaseTwoExternalTerminalLaunch(state.workspace)),
    });
    return { type: "redraw" };
  }
  if (line === "/phase2 evidence-template") {
    state.messages.push({ role: "system", text: renderPhaseTwoEvidenceTemplate() });
    return { type: "redraw" };
  }
  if (line === "/phase2 evidence-record" || line.startsWith("/phase2 evidence-record ")) {
    try {
      const parsed = parseRichPhaseTwoEvidenceRecordArgs(splitRichCommandWords(line.slice("/phase2 evidence-record".length).trim()));
      const result = await recordPhaseTwoEvidence(state.workspace, parsed);
      state.messages.push({ role: "system", text: renderPhaseTwoEvidenceRecord(result) });
    } catch (error) {
      state.messages.push({ role: "system", text: `Error: ${redactInlineSecretText(error instanceof Error ? error.message : String(error))}` });
    }
    return { type: "redraw" };
  }
  if (line === "/phase2 closure-task" || line.startsWith("/phase2 closure-task ")) {
    try {
      const parsed = parseRichPhaseTwoClosureTaskArgs(splitRichCommandWords(line.slice("/phase2 closure-task".length).trim()));
      const result = await checkPhaseTwoClosureTask(state.workspace, parsed);
      state.messages.push({ role: "system", text: renderPhaseTwoClosureTask(result) });
    } catch (error) {
      state.messages.push({ role: "system", text: `Error: ${redactInlineSecretText(error instanceof Error ? error.message : String(error))}` });
    }
    return { type: "redraw" };
  }
  if (line === "/phase2 evidence-check" || line.startsWith("/phase2 evidence-check ")) {
    state.messages.push({
      role: "system",
      text: renderPhaseTwoEvidenceCheck(await buildPhaseTwoEvidenceCheck(state.workspace, { strict: line.split(/\s+/).includes("--strict") })),
    });
    return { type: "redraw" };
  }
  if (line === "/sessions") {
    await submitSessionsCommand(state, context);
    return { type: "redraw" };
  }
  if (line === "/continue") {
    await submitResumeCommand(state, "/resume", context);
    return { type: "redraw" };
  }
  if (line === "/resume" || line.startsWith("/resume ")) {
    await submitResumeCommand(state, line, context);
    return { type: "redraw" };
  }
  if (line === "/pause" || line.startsWith("/pause ")) {
    await submitPauseCommand(state, line, context);
    return { type: "redraw" };
  }
  if (line === "/cancel" || line.startsWith("/cancel ")) {
    await submitCancelCommand(state, line, context);
    return { type: "redraw" };
  }
  if (line === "/background") {
    await submitBackgroundCommand(state, context);
    return { type: "redraw" };
  }
  if (line === "/goal status" || line === "/goal") {
    state.messages.push({ role: "system", text: formatGoalStatusMessage(state) });
    return { type: "redraw" };
  }
  if (line === "/approve plan") {
    await submitApprovePlanCommand(state, context);
    return { type: "redraw" };
  }
  if (line === "/mode" || line.startsWith("/mode ")) {
    submitModeCommand(state, line);
    return { type: "redraw" };
  }
  if (line === "/model setup" || line === "/models") {
    return { type: "model_setup" };
  }
  await submitNaturalLanguageTask(state, line, context);
  return { type: "redraw" };
}

function rememberInputHistory(state: RichTuiState, line: string): void {
  const history = state.inputHistory ?? [];
  if (history.at(-1) !== line) {
    history.push(line);
  }
  state.inputHistory = history.slice(-50);
}

export async function startRichTuiShell(context: RichShellContext): Promise<void> {
  const shellContext = context.startupSplash === undefined ? { ...context, startupSplash: true } : context;
  await startRichTuiShellWithTerminal(shellContext, {
    input: stdin as RichTuiInputStream,
    output: stdout as RichTuiOutputStream,
    emitKeypressEvents: (input) => emitKeypressEvents(input as typeof stdin),
  });
}

export async function startRichTuiShellWithTerminal(context: RichShellContext, terminal: RichTuiTerminal): Promise<void> {
  const state: RichTuiState = {
    workspace: context.workspace,
    provider: context.provider,
    model: context.model,
    readiness: context.readiness,
    mode: "Build",
    input: "",
    messages: [],
    events: [],
    lsp: { enabled: false, label: "LSPs are disabled" },
    workspaceStatus: context.workspaceStatus,
    runHealth: "Ready",
    version: context.version,
    focus: "input",
  };
  let running = true;
  let busy = false;
  let suspended = false;
  let stopRequested = false;
  let cancelRequestedSessionId: string | undefined;
  const terminalInput = terminal.input;
  const terminalOutput = terminal.output;
  const wasRaw = terminalInput.isRaw === true;
  let redrawTimer: ReturnType<typeof setTimeout> | undefined;
  const redrawNow = () => {
    if (redrawTimer) {
      clearTimeout(redrawTimer);
      redrawTimer = undefined;
    }
    terminalOutput.write(`${ansi.clear}${render(state, terminalSize(terminalOutput))}`);
  };
  const redraw = () => {
    if (redrawTimer) {
      return;
    }
    redrawTimer = setTimeout(() => {
      redrawTimer = undefined;
      redrawNow();
    }, 16);
  };
  const cancelPendingRedraw = () => {
    if (redrawTimer) {
      clearTimeout(redrawTimer);
      redrawTimer = undefined;
    }
  };
  const cancelActiveSession = async (sessionId: string | undefined) => {
    if (!sessionId || !context.cancelSession || cancelRequestedSessionId === sessionId) {
      return;
    }
    cancelRequestedSessionId = sessionId;
    try {
      await context.cancelSession({ sessionId, reason: STOP_GENERATION_REASON });
    } catch (error) {
      state.messages.push({
        role: "system",
        text: `Stop requested, but cancel failed: ${redactInlineSecretText(error instanceof Error ? error.message : String(error))}`,
      });
    }
  };
  const pushStopMessage = () => {
    const sessionLine = state.activeSessionId ? `Session: ${state.activeSessionId}` : "Session: pending";
    const text = `Run: Stopped\n${sessionLine}\nReason: ${STOP_GENERATION_REASON}`;
    if (state.messages.at(-1)?.role === "system" && state.messages.at(-1)?.text === text) {
      return;
    }
    state.messages.push({ role: "system", text });
  };
  const stopGeneration = async () => {
    stopRequested = true;
    finishStoppedGeneration(state);
    pushStopMessage();
    redraw();
    await cancelActiveSession(state.activeSessionId);
    redraw();
  };
  const handleRunEventBeforeState = async (event: AgentRunEvent, forward: AgentRunEventSink) => {
    if (event.type === "session_started") {
      state.activeSessionId = event.sessionId;
      if (stopRequested) {
        finishStoppedGeneration(state);
        pushStopMessage();
        await cancelActiveSession(event.sessionId);
        redraw();
        return;
      }
    }
    if (stopRequested) {
      finishStoppedGeneration(state);
      redraw();
      return;
    }
    await forward(event);
  };
  const runTask = context.runTask
    ? async (input: RichTuiTaskRunInput) => context.runTask?.({
      ...input,
      onEvent: async (event) => handleRunEventBeforeState(event, input.onEvent),
    }) ?? { answer: "" }
    : undefined;
  const resumeSession = context.resumeSession
    ? async (input: RichTuiSessionResumeInput) => context.resumeSession?.({
      ...input,
      onEvent: async (event) => handleRunEventBeforeState(event, input.onEvent),
    }) ?? { answer: "" }
    : undefined;
  const resetStopStateForSubmit = () => {
    stopRequested = false;
    cancelRequestedSessionId = undefined;
  };
  const submit = async () => {
    if (busy) {
      redraw();
      return;
    }
    resetStopStateForSubmit();
    busy = true;
    const action = await submitRichTuiInput(state, {
      runTask,
      resumeSession,
      listSessions: context.listSessions,
      pauseSession: context.pauseSession,
      cancelSession: context.cancelSession,
      backgroundSession: context.backgroundSession,
      onStateChange: redraw,
      isStopRequested: () => stopRequested,
    });
    busy = false;
    if (action.type === "exit") {
      running = false;
      return;
    }
    if (action.type === "model_setup") {
      if (context.setupModelFromWizard && context.modelProfiles?.length) {
        state.modelSetup = createRichModelSetupState(context.modelProfiles, state.provider);
        redraw();
        return;
      }
      if (!context.setupModel) {
        state.messages.push({ role: "system", text: "Model setup is not connected." });
        redraw();
        return;
      }
      busy = true;
      state.runHealth = "Working";
      redrawNow();
      try {
        suspended = true;
        terminalOutput.write(ansi.showCursor);
        terminalInput.setRawMode?.(false);
        terminalOutput.write("\n");
        const result = await context.setupModel();
        applyModelSetupResult(state, result);
        state.runHealth = "Ready";
      } catch (error) {
        applyErrorRunState(state, error);
        state.messages.push({ role: "system", text: `Error: ${redactInlineSecretText(error instanceof Error ? error.message : String(error))}` });
      } finally {
        suspended = false;
        busy = false;
        terminalInput.setRawMode?.(true);
        terminalOutput.write(ansi.hideCursor);
        redraw();
      }
      return;
    }
    redraw();
  };
  const submitNativeModelSetup = async () => {
    const request = state.pendingModelSetupRequest;
    if (!request || !context.setupModelFromWizard) {
      state.messages.push({ role: "system", text: "Model setup is not connected." });
      delete state.modelSetup;
      delete state.pendingModelSetupRequest;
      redraw();
      return;
    }
    if (state.modelSetup) {
      state.modelSetup.apiKeyInput = "";
    }
    delete state.modelSetup;
    delete state.pendingModelSetupRequest;
    busy = true;
    state.runHealth = "Working";
    redrawNow();
    try {
      const result = await context.setupModelFromWizard(request);
      applyModelSetupResult(state, result);
      state.runHealth = "Ready";
    } catch (error) {
      applyErrorRunState(state, error);
      state.messages.push({ role: "system", text: `Error: ${redactInlineSecretText(error instanceof Error ? error.message : String(error))}` });
    } finally {
      busy = false;
      redraw();
    }
  };

  const shellDone = new Promise<void>((resolve) => {
    const onResize = () => redraw();
    const onKeypress = (value: string, key: RichTuiKey = {}) => {
      void (async () => {
        if (suspended) {
          return;
        }
        const action = handleRichTuiKey(state, { value, key, busy });
        if (action === "exit") {
          running = false;
        } else if (action === "cancel") {
          await stopGeneration();
        } else if (action === "submit") {
          await submit();
        } else if (action === "model_setup_submit") {
          await submitNativeModelSetup();
        } else if (action === "redraw") {
          redraw();
        }
        if (!running) {
          terminalInput.off("keypress", onKeypress);
          terminalOutput.off("resize", onResize);
          resolve();
        }
      })();
    };
    terminalInput.on("keypress", onKeypress);
    terminalOutput.on("resize", onResize);
  });

  terminal.emitKeypressEvents?.(terminalInput);
  terminalOutput.write(ansi.hideCursor);
  terminalInput.setRawMode?.(true);
  terminalInput.resume();
  await renderStartupSplashIfEnabled(context, terminalOutput);
  if (running) {
    redrawNow();
  }

  await shellDone;

  terminalInput.setRawMode?.(wasRaw);
  cancelPendingRedraw();
  terminalOutput.write(ansi.showCursor);
  terminalOutput.write("\n");
}

async function renderStartupSplashIfEnabled(context: RichShellContext, output: RichTuiOutputStream): Promise<void> {
  if (!context.startupSplash) {
    return;
  }
  const options = typeof context.startupSplash === "object" ? context.startupSplash : {};
  const frames = Math.max(1, options.frames ?? 5);
  const frameMs = Math.max(0, options.frameMs ?? 70);
  output.write(ansi.clear);
  for (let frame = 0; frame < frames; frame += 1) {
    output.write(`${ansi.home}${renderSoloclawSplashFrame(terminalSize(output), frame, frames)}${ansi.clearToEnd}`);
    if (frameMs > 0) {
      await sleep(frameMs);
    } else {
      await Promise.resolve();
    }
  }
}

function renderSoloclawSplashFrame(size: TerminalSize, frame: number, frames: number): string {
  const width = Math.max(size.columns, 48);
  const height = Math.max(size.rows, 14);
  const midpoint = Math.floor((frames - 1) / 2);
  const logoStyle = frame === midpoint ? ansi.bold : frame < midpoint ? ansi.faint : ansi.gray;
  const subtitleStyle = frame === midpoint ? ansi.gray : ansi.faint;
  const logoRows = [
    `${logoStyle}SOLOCLAW${ansi.reset}`,
    `${subtitleStyle}local agent workspace${ansi.reset}`,
  ];
  const top = Math.max(0, Math.floor((height - logoRows.length) / 2));
  const rows = Array.from({ length: height }, () => "");
  for (const [index, row] of logoRows.entries()) {
    rows[top + index] = clip(center(row, width), width);
  }
  return rows.join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function render(state: RichTuiState, size: TerminalSize): string {
  return state.messages.length > 0 || state.events.length > 0 || state.objective
    ? renderConversationScreen(state, size)
    : renderWelcomeScreen(state, size);
}

function terminalSize(output: RichTuiOutputStream): TerminalSize {
  return {
    columns: output.columns ?? 100,
    rows: output.rows ?? 30,
  };
}

function showCommands(state: RichTuiState): void {
  state.messages.push({
    role: "system",
    text: TUI_COMMANDS.map((command) => `${command.name} - ${command.description}`).join("\n"),
  });
}

function clearTranscriptState(state: RichTuiState): void {
  state.messages = [];
  state.events = [];
  state.agentRunEvents = [];
  state.projectedAssistantMessages = [];
  state.objective = undefined;
  state.runHealth = "Ready";
  state.currentActivity = undefined;
  state.stepCount = undefined;
  state.lastEventTitle = undefined;
  state.goal = undefined;
  state.runBudget = undefined;
  state.todos = undefined;
  state.activeSessionId = undefined;
  state.sessionChoices = undefined;
  state.sessionPicker = undefined;
  state.streamingAssistantMessageIndex = undefined;
  state.lastAssistantMessageText = undefined;
  state.pendingPlanApproval = undefined;
}

async function submitSessionsCommand(state: RichTuiState, context: RichTuiSubmitContext): Promise<void> {
  if (!context.listSessions) {
    state.messages.push({ role: "system", text: "Sessions view is not connected in the rich TUI yet." });
    return;
  }
  state.runHealth = "Working";
  context.onStateChange?.();
  try {
    const result = sortSessionsResultByUpdatedAt(await context.listSessions());
    state.sessionChoices = result.sessions.map(toSessionChoice);
    if (state.sessionChoices.length > 0) {
      openSessionPicker(state);
    } else {
      closeSessionPicker(state);
    }
    state.messages.push({ role: "system", text: createSessionsMessage(result) });
    state.runHealth = "Ready";
  } catch (error) {
    state.sessionChoices = undefined;
    state.sessionPicker = undefined;
    applyErrorRunState(state, error);
    state.messages.push({ role: "system", text: `Error: ${redactInlineSecretText(error instanceof Error ? error.message : String(error))}` });
  }
}

function sortSessionsResultByUpdatedAt(result: RichTuiSessionsResult): RichTuiSessionsResult {
  return {
    ...result,
    sessions: [...result.sessions].sort((left, right) => sessionUpdatedMs(right) - sessionUpdatedMs(left)),
  };
}

function sessionUpdatedMs(session: RichTuiSessionEntry): number {
  const value = Date.parse(session.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

async function submitResumeCommand(state: RichTuiState, line: string, context: RichTuiSubmitContext): Promise<void> {
  const resolved = resolveResumeSessionId(state, line);
  if (resolved.error) {
    state.messages.push({ role: "system", text: resolved.error });
    return;
  }
  const sessionId = resolved.sessionId;
  if (!sessionId) {
    state.messages.push({ role: "system", text: "No active session. Use /resume <session-id>." });
    return;
  }
  if (!context.resumeSession) {
    state.runHealth = "Failed";
    state.currentActivity = "Failed";
    state.messages.push({ role: "system", text: "Resume is not connected." });
    return;
  }
  state.messages.push({ role: "system", text: `Resuming session ${sessionId}` });
  state.objective = `Resume session ${sessionId}`;
  state.events = [];
  state.agentRunEvents = [];
  state.projectedAssistantMessages = [];
  state.todos = undefined;
  state.currentActivity = "Resuming";
  state.stepCount = undefined;
  state.lastEventTitle = undefined;
  state.runHealth = "Working";
  state.activeSessionId = sessionId;
  const nowMs = context.nowMs ?? Date.now;
  const startedAt = nowMs();
  context.onStateChange?.();
  try {
    const result = await context.resumeSession({
      sessionId,
      onEvent: async (event) => {
        if (context.isStopRequested?.()) {
          if (event.type === "session_started") {
            state.activeSessionId = event.sessionId;
          }
          finishStoppedGeneration(state);
          context.onStateChange?.();
          return;
        }
        applyAgentRunEventToRichState(state, event);
        context.onStateChange?.();
      },
    });
    if (context.isStopRequested?.()) {
      finishStoppedGeneration(state);
      state.lastRunDurationMs = nowMs() - startedAt;
      return;
    }
    if (result.transcript?.length) {
      state.messages = [...result.transcript];
      state.streamingAssistantMessageIndex = undefined;
      state.lastAssistantMessageText = state.messages.at(-1)?.role === "assistant" ? state.messages.at(-1)?.text : undefined;
      state.transcriptScrollOffset = 0;
    }
    if (result.answer.trim().length > 0) {
      commitAssistantAnswer(state, result.answer);
    }
    state.activeSessionId = result.sessionId ?? sessionId;
    state.context = result.context ?? state.context;
    state.todos = result.todos;
    state.lastRunDurationMs = result.durationMs ?? nowMs() - startedAt;
    if (result.restoredOnly) {
      finishRestoredSessionHealth(state, result.sessionStatus);
    } else {
      finishRunHealth(state);
    }
  } catch (error) {
    if (context.isStopRequested?.()) {
      finishStoppedGeneration(state);
      state.lastRunDurationMs = nowMs() - startedAt;
      return;
    }
    applyErrorRunState(state, error);
    state.messages.push({ role: "system", text: `Error: ${redactInlineSecretText(error instanceof Error ? error.message : String(error))}` });
  }
}

function resolveResumeSessionId(state: RichTuiState, line: string): { sessionId?: string; error?: string } {
  const token = parseResumeSessionToken(line);
  if (!token) {
    return { sessionId: state.activeSessionId };
  }
  if (!isSessionChoiceToken(token)) {
    return { sessionId: token };
  }
  if (!state.sessionChoices?.length) {
    return { error: "Use /sessions first, then resume by number, for example /resume 1." };
  }
  const choice = state.sessionChoices[Number.parseInt(token, 10) - 1];
  if (!choice) {
    return { error: `No session ${token}. Use /sessions to see available session numbers.` };
  }
  return { sessionId: choice.id };
}

function parseResumeSessionToken(line: string): string | undefined {
  const rest = line.slice("/resume".length).trim();
  return rest.length > 0 ? rest.split(/\s+/, 1)[0] : undefined;
}

function isSessionChoiceToken(token: string): boolean {
  return /^[1-9]\d*$/.test(token);
}

async function submitPauseCommand(state: RichTuiState, line: string, context: RichTuiSubmitContext): Promise<void> {
  const sessionId = state.activeSessionId;
  if (!sessionId) {
    state.messages.push({ role: "system", text: "No active session to pause." });
    return;
  }
  if (!context.pauseSession) {
    state.messages.push({ role: "system", text: "Pause is not connected." });
    return;
  }
  const reason = line.slice("/pause".length).trim() || "Paused from Soloclaw TUI.";
  await context.pauseSession({ sessionId, reason });
  state.runHealth = "Paused";
  state.currentActivity = "Paused";
  state.lastEventTitle = reason;
  state.messages.push({ role: "system", text: `Run: Paused\nSession: ${sessionId}\nReason: ${reason}` });
}

async function submitCancelCommand(state: RichTuiState, line: string, context: RichTuiSubmitContext): Promise<void> {
  const sessionId = state.activeSessionId;
  if (!sessionId) {
    state.messages.push({ role: "system", text: "No active session to cancel." });
    return;
  }
  if (!context.cancelSession) {
    state.messages.push({ role: "system", text: "Cancel is not connected." });
    return;
  }
  const reason = line.slice("/cancel".length).trim() || "Cancelled from Soloclaw TUI.";
  await context.cancelSession({ sessionId, reason });
  state.runHealth = "Cancelled";
  state.currentActivity = "Cancelled";
  state.lastEventTitle = reason;
  state.messages.push({ role: "system", text: `Run: Cancelled\nSession: ${sessionId}\nReason: ${reason}` });
}

async function submitBackgroundCommand(state: RichTuiState, context: RichTuiSubmitContext): Promise<void> {
  const sessionId = state.activeSessionId;
  if (!sessionId) {
    state.messages.push({ role: "system", text: "No active session to queue for background continuation." });
    return;
  }
  if (!context.backgroundSession) {
    state.messages.push({ role: "system", text: "Background continuation is not connected." });
    return;
  }
  await context.backgroundSession({ sessionId });
  state.messages.push({ role: "system", text: `Session ${sessionId} queued for worker continuation.` });
}

function submitModeCommand(state: RichTuiState, line: string): void {
  const next = resolveModeCommand(state.mode, line);
  if (next) {
    state.mode = next;
    state.messages.push({ role: "system", text: `Mode: ${state.mode}` });
    return;
  }
  state.messages.push({ role: "system", text: "Usage: /mode [plan|build|goal]" });
}

async function submitApprovePlanCommand(state: RichTuiState, context: RichTuiSubmitContext): Promise<void> {
  const pending = state.pendingPlanApproval;
  if (!pending) {
    state.messages.push({ role: "system", text: "No plan is waiting for approval." });
    return;
  }
  state.messages.push({ role: "system", text: `Approved plan. Executing in Build mode: ${pending.task}` });
  state.pendingPlanApproval = undefined;
  state.mode = "Build";
  await runTaskInMode(state, pending.task, "Build", context, { appendUserMessage: false });
}

async function submitNaturalLanguageTask(state: RichTuiState, line: string, context: RichTuiSubmitContext): Promise<void> {
  await runTaskInMode(state, line, state.mode, context, { appendUserMessage: true });
}

async function runTaskInMode(
  state: RichTuiState,
  line: string,
  mode: RichTuiMode,
  context: RichTuiSubmitContext,
  options: { appendUserMessage: boolean },
): Promise<void> {
  const previousPendingPlanApproval = state.pendingPlanApproval;
  if (options.appendUserMessage) {
    state.messages.push({ role: "user", text: line });
  }
  state.objective = line;
  state.events = [];
  state.agentRunEvents = [];
  state.projectedAssistantMessages = [];
  state.todos = createInitialRunTodos(mode);
  state.currentActivity = "Thinking";
  state.stepCount = undefined;
  state.lastEventTitle = undefined;
  state.runHealth = "Working";
  if (mode !== "Plan") {
    state.pendingPlanApproval = undefined;
  }
  const nowMs = context.nowMs ?? Date.now;
  const startedAt = nowMs();
  context.onStateChange?.();
  try {
    const result = await context.runTask?.({
      task: line,
      mode,
      onEvent: async (event) => {
        if (context.isStopRequested?.()) {
          if (event.type === "session_started") {
            state.activeSessionId = event.sessionId;
          }
          finishStoppedGeneration(state);
          context.onStateChange?.();
          return;
        }
        applyAgentRunEventToRichState(state, event);
        context.onStateChange?.();
      },
    });
    if (context.isStopRequested?.()) {
      finishStoppedGeneration(state);
      state.lastRunDurationMs = nowMs() - startedAt;
      return;
    }
    if (result) {
      commitAssistantAnswer(state, result.answer);
      state.activeSessionId = result.sessionId;
      state.context = result.context ?? state.context;
      state.todos = result.todos ?? completeActiveTodos(state.todos);
      state.lastRunDurationMs = result.durationMs ?? nowMs() - startedAt;
      if (mode === "Plan") {
        state.pendingPlanApproval = {
          task: line,
          plan: result.answer,
          sessionId: result.sessionId,
          planPath: result.planPath,
        };
        state.todos = result.todos ?? createPendingPlanApprovalTodos();
        state.runHealth = "Needs approval";
        state.currentActivity = "Plan needs approval";
        state.lastEventTitle = "/approve plan";
        return;
      }
      finishRunHealth(state);
      return;
    }
    state.runHealth = "Failed";
    state.currentActivity = "Failed";
    state.messages.push({ role: "system", text: "Task runner is not connected." });
    state.pendingPlanApproval = previousPendingPlanApproval;
  } catch (error) {
    if (context.isStopRequested?.()) {
      finishStoppedGeneration(state);
      state.lastRunDurationMs = nowMs() - startedAt;
      return;
    }
    applyErrorRunState(state, error);
    state.messages.push({ role: "system", text: `Error: ${redactInlineSecretText(error instanceof Error ? error.message : String(error))}` });
    if (mode !== "Plan") {
      state.pendingPlanApproval = previousPendingPlanApproval;
    }
  }
}

function createInitialRunTodos(mode: RichTuiMode): RichTuiState["todos"] {
  if (mode === "Plan") {
    return [
      { content: "Draft plan", status: "in_progress", priority: "high" },
      { content: "Await approval", status: "pending", priority: "high" },
    ];
  }
  return [
    { content: "Apply changes", status: "in_progress", priority: "high" },
    { content: "Verify result", status: "pending", priority: "medium" },
  ];
}

function createPendingPlanApprovalTodos(): RichTuiState["todos"] {
  return [
    { content: "Draft plan", status: "completed", priority: "high" },
    { content: "Awaiting approval", status: "in_progress", priority: "high" },
    { content: "Approve plan", status: "pending", priority: "high" },
    { content: "Execute build", status: "pending", priority: "medium" },
  ];
}

function completeActiveTodos(todos: RichTuiState["todos"]): RichTuiState["todos"] {
  return todos?.map((todo) => todo.status === "in_progress" ? { ...todo, status: "completed" } : todo);
}

function appendAssistantTextDelta(state: RichTuiState, text: string): void {
  const streamingIndex = state.streamingAssistantMessageIndex;
  if (streamingIndex !== undefined && state.messages[streamingIndex]?.role === "assistant") {
    const current = state.messages[streamingIndex];
    state.messages[streamingIndex] = { role: "assistant", text: current.text + text };
    return;
  }
  state.messages.push({ role: "assistant", text });
  state.streamingAssistantMessageIndex = state.messages.length - 1;
}

function boundedCommandIndex(index: number): number {
  const count = TUI_COMMANDS.length;
  return ((index % count) + count) % count;
}

function boundedCommandSuggestionIndex(state: RichTuiState, index: number): number {
  const count = commandSuggestionsForInput(state.input).length;
  if (count === 0) {
    return 0;
  }
  return ((index % count) + count) % count;
}

function boundedSessionPickerIndex(state: Pick<RichTuiState, "sessionChoices">, index: number): number {
  const count = state.sessionChoices?.length ?? 0;
  if (count === 0) {
    return 0;
  }
  return ((index % count) + count) % count;
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  return entries.length > 0 ? entries.map(([key, count]) => `${key}:${count}`).join(",") : "-";
}

function formatContextMessage(context: RichTuiContextMetrics | undefined): string {
  if (!context) {
    return "context n/a";
  }
  const base = `${formatTokens(context.tokens)} tokens (${context.percentUsed}%)`;
  return context.windowTokens ? `${base} of ${formatTokens(context.windowTokens)}` : base;
}

function formatGoalStatusMessage(state: Pick<RichTuiState, "goal">): string {
  const goal = state.goal;
  if (!goal) {
    return "Goal: no active durable goal";
  }
  return [
    `Goal ${goal.status}: ${goal.objective}`,
    `Progress: ${goal.checkpoints} checkpoints, ${goal.modelCalls} model calls`,
    `Summary: ${goal.summary}`,
    `Usage: ${formatTokens(goal.tokenUsed)} tokens`,
    goal.repeatedBlockers > 0 ? `Blockers: ${goal.repeatedBlockers}` : undefined,
  ].filter(Boolean).join("\n");
}

function formatRunBudgetMessage(state: Pick<RichTuiState, "runBudget">): string {
  const budget = state.runBudget;
  if (!budget) {
    return "Budget: n/a";
  }
  const limits = [
    budget.maxModelCalls !== undefined ? `max calls ${budget.maxModelCalls}` : undefined,
    budget.maxSteps !== undefined ? `max steps ${budget.maxSteps}` : undefined,
    budget.maxDurationMs !== undefined ? `max ${(budget.maxDurationMs / 1000).toFixed(0)}s` : undefined,
  ].filter(Boolean);
  return `Budget: ${budget.modelCalls} model calls, ${budget.steps} steps${limits.length > 0 ? ` (${limits.join(", ")})` : ""}`;
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : String(tokens);
}

function formatWorkspaceStatus(status: RichTuiWorkspaceStatus): string {
  if (!status.insideWorkTree) {
    return status.error ? `not a git worktree (${status.error})` : "not a git worktree";
  }
  const branch = status.branch ?? "detached";
  const dirty = status.dirtyCount === 0 ? "clean" : `${status.dirtyCount} changed`;
  return `${branch}, ${dirty}`;
}

function formatActivityStatus(state: RichTuiState): string {
  const current = state.currentActivity ?? "Idle";
  const step = state.stepCount !== undefined ? `Step ${state.stepCount}` : undefined;
  const parts = [
    current,
    step && !current.includes(step) ? step : undefined,
    state.lastEventTitle,
  ];
  return parts.filter(Boolean).join(" - ");
}

function nextFocus(focus: RichTuiFocus): RichTuiFocus {
  if (focus === "input") {
    return "transcript";
  }
  if (focus === "transcript") {
    return "sidebar";
  }
  if (focus === "sidebar") {
    return "commands";
  }
  return "input";
}

function updateContextFromEvent(state: RichTuiState, event: AgentRunEvent): void {
  if (event.type !== "model_finished" || !event.usage?.totalTokens) {
    return;
  }
  const windowTokens = state.context?.windowTokens;
  state.context = {
    tokens: event.usage.totalTokens,
    percentUsed: windowTokens ? Math.min(100, Math.round((event.usage.totalTokens / windowTokens) * 100)) : state.context?.percentUsed ?? 0,
    windowTokens,
    spentUsd: state.context?.spentUsd,
  };
}

function updateRunBudgetFromEvent(state: RichTuiState, event: AgentRunEvent): void {
  if (event.type !== "run_budget_checkpoint") {
    return;
  }
  state.runBudget = {
    steps: event.steps,
    modelCalls: event.modelCalls,
    elapsedMs: event.elapsedMs,
    maxSteps: event.maxSteps,
    maxModelCalls: event.maxModelCalls,
    maxDurationMs: event.maxDurationMs,
  };
}

function updateGoalFromEvent(state: RichTuiState, event: AgentRunEvent): void {
  if (event.type !== "goal_updated") {
    return;
  }
  const previous = state.goal?.id === event.goalId ? state.goal : undefined;
  state.goal = {
    id: event.goalId,
    status: event.status,
    objective: event.objective,
    summary: event.summary,
    checkpoints: (previous?.checkpoints ?? 0) + 1,
    repeatedBlockers: event.repeatedBlockers ?? 0,
    modelCalls: event.modelCalls ?? 0,
    tokenUsed: event.tokenUsed ?? 0,
  };
}

function updateRunHealthFromEvent(state: RichTuiState, event: AgentRunEvent): void {
  switch (event.type) {
    case "session_started":
    case "step_started":
    case "tool_started":
    case "run_budget_checkpoint":
      state.runHealth = "Working";
      break;
    case "goal_updated":
      state.runHealth = event.status === "complete" ? "Done" : event.status === "active" ? "Working" : "Stopped";
      break;
    case "step_limit_reached":
    case "guardrail_tripped":
    case "runtime_stopped":
      state.runHealth = "Stopped";
      break;
    case "model_failed":
    case "run_failed":
      state.runHealth = "Failed";
      break;
    case "reasoning_started":
    case "reasoning_delta":
      state.runHealth = "Working";
      break;
    default:
      break;
  }
}

function updateActivityFromEvent(state: RichTuiState, event: AgentRunEvent): void {
  if ("step" in event) {
    state.stepCount = event.step;
  }
  switch (event.type) {
    case "session_started":
      state.currentActivity = "Starting";
      state.lastEventTitle = event.objective;
      break;
    case "step_started":
      state.currentActivity = "Thinking";
      state.lastEventTitle = undefined;
      break;
    case "assistant_text":
      state.currentActivity = "Writing";
      break;
    case "model_finished":
      state.currentActivity = event.responseType === "tool_calls" ? "Planning tools" : "Writing";
      break;
    case "reasoning_started":
    case "reasoning_delta":
      state.currentActivity = "Thinking";
      state.lastEventTitle = event.publicSummary;
      break;
    case "reasoning_finished":
      state.currentActivity = "Thinking";
      state.lastEventTitle = `${event.publicSummary} ${event.durationMs}ms`;
      break;
    case "model_failed":
    case "run_failed":
      state.currentActivity = "Failed";
      break;
    case "tool_started":
      state.currentActivity = activityForToolName(event.toolName);
      state.lastEventTitle = event.title;
      break;
    case "tool_finished":
      state.currentActivity = event.status === "ok" ? activityForToolName(event.toolName) : "Failed";
      state.lastEventTitle = event.title;
      break;
    case "file_changed":
      state.currentActivity = event.change === "create" ? "Writing" : "Editing";
      state.lastEventTitle = `${event.change} ${event.path}`;
      break;
    case "run_budget_checkpoint":
      state.currentActivity = "Working";
      state.lastEventTitle = `Budget: ${event.steps} steps, ${event.modelCalls} model calls`;
      break;
    case "goal_updated":
      state.currentActivity = event.status === "complete" ? "Done" : event.status === "active" ? "Working" : "Stopped";
      state.lastEventTitle = `Goal ${event.status}: ${event.summary}`;
      break;
    case "guardrail_tripped":
      state.currentActivity = "Stopped";
      state.lastEventTitle = event.reason;
      break;
    case "step_limit_reached":
      state.currentActivity = "Stopped";
      state.lastEventTitle = `Step budget reached: ${event.maxSteps}`;
      break;
    case "runtime_stopped":
      state.currentActivity = "Stopped";
      state.lastEventTitle = event.stopKind === "step_budget" ? `Step budget reached: ${event.maxSteps ?? "-"}` : event.reason;
      break;
    case "assistant_note":
      state.lastEventTitle = event.text;
      break;
  }
}

function activityForToolName(toolName: string): string {
  if (/read|list|stat|get/i.test(toolName)) {
    return "Reading";
  }
  if (/search|grep|find/i.test(toolName)) {
    return "Searching";
  }
  if (/command|shell|exec|test/i.test(toolName)) {
    return "Running";
  }
  if (/patch|replace|edit|write|create|delete|move/i.test(toolName)) {
    return /create|write/i.test(toolName) ? "Writing" : "Editing";
  }
  return "Working";
}

function finishRunHealth(state: RichTuiState): void {
  state.runHealth = state.runHealth === "Stopped" ? "Stopped" : "Done";
  state.currentActivity = state.runHealth === "Stopped" ? "Stopped" : "Done";
}

function finishStoppedGeneration(state: RichTuiState, reason = STOP_GENERATION_REASON): void {
  state.runHealth = "Stopped";
  state.currentActivity = "Stopped";
  state.lastEventTitle = reason;
  state.streamingAssistantMessageIndex = undefined;
}

function finishRestoredSessionHealth(state: RichTuiState, sessionStatus: string | undefined): void {
  if (sessionStatus === "cancelled") {
    state.runHealth = "Cancelled";
    state.currentActivity = "Cancelled";
    return;
  }
  if (sessionStatus === "paused") {
    state.runHealth = "Paused";
    state.currentActivity = "Paused";
    return;
  }
  state.runHealth = "Done";
  state.currentActivity = "Done";
}

function applyErrorRunState(state: RichTuiState, error: unknown): void {
  const health = runHealthFromError(error);
  state.runHealth = health;
  state.currentActivity = health;
}

function runHealthFromError(error: unknown): RichTuiRunHealth {
  const message = error instanceof Error ? error.message : String(error);
  return /approval|required|denied/i.test(message) ? "Needs approval" : "Failed";
}

function splitRichCommandWords(input: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;
  for (const char of input) {
    if ((char === "\"" || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = undefined;
      continue;
    }
    if (/\s/u.test(char) && !quote) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    words.push(current);
  }
  return words;
}

function parseRichPhaseTwoEvidenceRecordArgs(args: string[]): {
  section: PhaseTwoEvidenceRecordSection;
  filePath?: string;
  date?: string;
  fields: Record<string, string>;
} {
  let section: PhaseTwoEvidenceRecordSection | undefined;
  let filePath: string | undefined;
  let date: string | undefined;
  const fields: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const rawArg = args[index];
    const equalsIndex = rawArg.indexOf("=");
    const arg = equalsIndex > 0 ? rawArg.slice(0, equalsIndex) : rawArg;
    const inlineValue = equalsIndex > 0 ? rawArg.slice(equalsIndex + 1) : undefined;
    const takeValue = (): string => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${arg}.`);
      }
      index += 1;
      return next;
    };
    if (arg === "--section") {
      section = parseRichPhaseTwoEvidenceRecordSection(takeValue());
      continue;
    }
    if (arg === "--file" || arg === "--evidence-file") {
      filePath = takeValue();
      continue;
    }
    if (arg === "--date") {
      date = takeValue();
      continue;
    }
    const fieldName = richPhaseTwoEvidenceRecordFieldName(arg);
    if (fieldName) {
      fields[fieldName] = takeValue();
      continue;
    }
    throw new Error(`Unknown phase2 evidence-record option: ${arg}.`);
  }
  if (!section) {
    throw new Error("Usage: /phase2 evidence-record --section C1|C2|C3 [--result text] [--terminal text] [--provider text] [--model text]");
  }
  return { section, filePath, date, fields };
}

function parseRichPhaseTwoEvidenceShowArgs(args: string[]): {
  section: PhaseTwoEvidenceRecordSection;
  filePath?: string;
} {
  let section: PhaseTwoEvidenceRecordSection | undefined;
  let filePath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const rawArg = args[index];
    const equalsIndex = rawArg.indexOf("=");
    const arg = equalsIndex > 0 ? rawArg.slice(0, equalsIndex) : rawArg;
    const inlineValue = equalsIndex > 0 ? rawArg.slice(equalsIndex + 1) : undefined;
    const takeValue = (): string => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${arg}.`);
      }
      index += 1;
      return next;
    };
    if (arg === "--section") {
      section = parseRichPhaseTwoEvidenceRecordSection(takeValue());
      continue;
    }
    if (arg === "--file" || arg === "--evidence-file") {
      filePath = takeValue();
      continue;
    }
    if (!rawArg.startsWith("--") && !section) {
      section = parseRichPhaseTwoEvidenceRecordSection(rawArg);
      continue;
    }
    throw new Error(`Unknown phase2 evidence-show option: ${arg}.`);
  }
  if (!section) {
    throw new Error("Usage: /phase2 evidence C1|C2|C3");
  }
  return { section, filePath };
}

function parseRichPhaseTwoClosureTaskArgs(args: string[]): {
  section: PhaseTwoEvidenceRecordSection;
  filePath?: string;
  confirmReviewed: boolean;
} {
  let section: PhaseTwoEvidenceRecordSection | undefined;
  let filePath: string | undefined;
  let confirmReviewed = false;
  for (let index = 0; index < args.length; index += 1) {
    const rawArg = args[index];
    const equalsIndex = rawArg.indexOf("=");
    const arg = equalsIndex > 0 ? rawArg.slice(0, equalsIndex) : rawArg;
    const inlineValue = equalsIndex > 0 ? rawArg.slice(equalsIndex + 1) : undefined;
    const takeValue = (): string => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${arg}.`);
      }
      index += 1;
      return next;
    };
    if (arg === "--section") {
      section = parseRichPhaseTwoEvidenceRecordSection(takeValue());
      continue;
    }
    if (arg === "--file" || arg === "--evidence-file") {
      filePath = takeValue();
      continue;
    }
    if (arg === "--confirm-reviewed") {
      confirmReviewed = true;
      continue;
    }
    throw new Error(`Unknown phase2 closure-task option: ${arg}.`);
  }
  if (!section) {
    throw new Error("Usage: /phase2 closure-task --section C1|C2|C3 --confirm-reviewed");
  }
  return { section, filePath, confirmReviewed };
}

function parseRichPhaseTwoEvidenceRecordSection(value: string): PhaseTwoEvidenceRecordSection {
  const normalized = value.toUpperCase();
  if (normalized === "C1" || normalized === "C2" || normalized === "C3") {
    return normalized;
  }
  throw new Error("Phase 2 evidence section must be C1, C2, or C3.");
}

function richPhaseTwoEvidenceRecordFieldName(arg: string): string | undefined {
  const fields: Record<string, string> = {
    "--terminal": "terminal",
    "--shell": "shell",
    "--node": "nodeVersion",
    "--node-version": "nodeVersion",
    "--result": "result",
    "--rendering-issues": "renderingIssues",
    "--provider": "provider",
    "--model": "model",
    "--base-url": "baseUrl",
    "--model-setup": "modelSetup",
    "--model-check": "modelCheck",
    "--task-result": "taskResult",
    "--live-progress": "liveProgress",
    "--leak-check": "leakCheck",
    "--check": "check",
    "--test": "test",
    "--rich-smoke": "richSmoke",
    "--real-provider-smoke": "realProviderSmoke",
    "--evidence-check": "evidenceCheck",
    "--git-diff": "gitDiff",
    "--temp-scan": "tempScan",
    "--note": "note",
  };
  return fields[arg];
}

function redactInlineSecretText(value: string): string {
  return value.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED:api_key]");
}

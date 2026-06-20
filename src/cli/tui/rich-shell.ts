import { stdin, stdout } from "node:process";
import { emitKeypressEvents } from "node:readline";
import type { AgentRunEvent, AgentRunEventSink } from "../../core/agent-events.js";
import { projectAgentRunEventsToAssistantMessages } from "../../core/agent-message-projector.js";
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
import type { ModelProviderName } from "../../model/model-client.js";
import { ansi, type TerminalSize } from "./ansi.js";
import { TUI_COMMANDS } from "./commands.js";
import { renderConversationScreen, renderWelcomeScreen } from "./layout.js";
import { createRichModelSetupState, handleRichModelSetupKey, type RichModelSetupProfile, type RichModelSetupRequest } from "./model-setup.js";
import { describeMode, nextMode, resumeGuidance, type RichTuiContextMetrics, type RichTuiFocus, type RichTuiMode, type RichTuiRunHealth, type RichTuiState, type RichTuiWorkspaceStatus } from "./state.js";

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
  context?: RichTuiContextMetrics;
  durationMs?: number;
};

export type RichTuiModelSetupResult = {
  provider: ModelProviderName;
  model: string;
  readiness: string;
};

export type RichTuiSessionEntry = {
  id: string;
  targetMode: string;
  status: string;
  outcome: string;
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

export type RichShellContext = {
  workspace: string;
  provider: ModelProviderName;
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

export type RichTuiKeyAction = "none" | "redraw" | "submit" | "exit" | "model_setup_submit";

export type RichTuiSubmitAction = { type: "redraw" } | { type: "exit" } | { type: "model_setup" };

export type RichTuiSubmitContext = {
  runTask?: (input: RichTuiTaskRunInput) => Promise<RichTuiTaskRunResult>;
  resumeSession?: (input: RichTuiSessionResumeInput) => Promise<RichTuiTaskRunResult>;
  listSessions?: () => Promise<RichTuiSessionsResult>;
  nowMs?: () => number;
  onStateChange?: () => void;
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
  for (const session of result.sessions) {
    lines.push("");
    lines.push(`${session.id} ${session.targetMode} ${session.status} outcome=${session.outcome}`);
    lines.push(`pending=${session.pendingApprovals} commands=${session.commandsFinished}/${session.failedCommands} updated=${session.updatedAt}`);
    lines.push(`objective: ${session.objective}`);
    lines.push(`changes: ${session.changedPaths.length > 0 ? session.changedPaths.join(",") : "-"}`);
    lines.push(`handoff: ${session.handoffState ?? "-"}`);
    lines.push(`next: ${session.handoffNextCommand ?? "-"}`);
  }
  return lines.join("\n");
}

export function openCommandPalette(state: RichTuiState): void {
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

  if ((key.ctrl && key.name === "c") || key.name === "escape") {
    return "exit";
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
    return "submit";
  }
  if (value && value >= " " && value !== "\x7f") {
    clearInputHistoryCursor(state);
    state.input += value;
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
  updateContextFromEvent(state, event);
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
  if (line === "/approve plan") {
    await submitApprovePlanCommand(state, context);
    return { type: "redraw" };
  }
  if (line === "/mode" || line.startsWith("/mode ")) {
    submitModeCommand(state, line);
    return { type: "redraw" };
  }
  if (line === "/model setup") {
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
  await startRichTuiShellWithTerminal(context, {
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
  const terminalInput = terminal.input;
  const terminalOutput = terminal.output;
  const wasRaw = terminalInput.isRaw === true;
  const redraw = () => {
    terminalOutput.write(ansi.clear);
    terminalOutput.write(render(state, terminalSize(terminalOutput)));
  };
  const submit = async () => {
    if (busy) {
      redraw();
      return;
    }
    busy = true;
    const action = await submitRichTuiInput(state, {
      runTask: context.runTask,
      resumeSession: context.resumeSession,
      listSessions: context.listSessions,
      onStateChange: redraw,
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
      redraw();
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
    redraw();
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

  terminal.emitKeypressEvents?.(terminalInput);
  terminalOutput.write(ansi.hideCursor);
  terminalInput.setRawMode?.(true);
  terminalInput.resume();
  redraw();

  await new Promise<void>((resolve) => {
    const onResize = () => redraw();
    const onKeypress = (value: string, key: RichTuiKey = {}) => {
      void (async () => {
        if (suspended) {
          return;
        }
        const action = handleRichTuiKey(state, { value, key, busy });
        if (action === "exit") {
          running = false;
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

  terminalInput.setRawMode?.(wasRaw);
  terminalOutput.write(ansi.showCursor);
  terminalOutput.write("\n");
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
  state.activeSessionId = undefined;
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
    state.messages.push({ role: "system", text: createSessionsMessage(await context.listSessions()) });
    state.runHealth = "Ready";
  } catch (error) {
    applyErrorRunState(state, error);
    state.messages.push({ role: "system", text: `Error: ${redactInlineSecretText(error instanceof Error ? error.message : String(error))}` });
  }
}

async function submitResumeCommand(state: RichTuiState, line: string, context: RichTuiSubmitContext): Promise<void> {
  const sessionId = parseResumeSessionId(line) ?? state.activeSessionId;
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
        applyAgentRunEventToRichState(state, event);
        context.onStateChange?.();
      },
    });
    commitAssistantAnswer(state, result.answer);
    state.activeSessionId = result.sessionId ?? sessionId;
    state.context = result.context ?? state.context;
    state.lastRunDurationMs = result.durationMs ?? nowMs() - startedAt;
    finishRunHealth(state);
  } catch (error) {
    applyErrorRunState(state, error);
    state.messages.push({ role: "system", text: `Error: ${redactInlineSecretText(error instanceof Error ? error.message : String(error))}` });
  }
}

function parseResumeSessionId(line: string): string | undefined {
  const rest = line.slice("/resume".length).trim();
  return rest.length > 0 ? rest.split(/\s+/, 1)[0] : undefined;
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
        applyAgentRunEventToRichState(state, event);
        context.onStateChange?.();
      },
    });
    if (result) {
      commitAssistantAnswer(state, result.answer);
      state.activeSessionId = result.sessionId;
      state.context = result.context ?? state.context;
      state.lastRunDurationMs = result.durationMs ?? nowMs() - startedAt;
      if (mode === "Plan") {
        state.pendingPlanApproval = {
          task: line,
          plan: result.answer,
          sessionId: result.sessionId,
        };
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
    applyErrorRunState(state, error);
    state.messages.push({ role: "system", text: `Error: ${redactInlineSecretText(error instanceof Error ? error.message : String(error))}` });
    if (mode !== "Plan") {
      state.pendingPlanApproval = previousPendingPlanApproval;
    }
  }
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
  const parts = [
    state.currentActivity ?? "Idle",
    state.stepCount !== undefined ? `Step ${state.stepCount}` : undefined,
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

function updateRunHealthFromEvent(state: RichTuiState, event: AgentRunEvent): void {
  switch (event.type) {
    case "session_started":
    case "step_started":
    case "tool_started":
      state.runHealth = "Working";
      break;
    case "step_limit_reached":
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

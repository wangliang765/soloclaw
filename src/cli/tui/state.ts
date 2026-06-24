import type { AgentRunEvent } from "../../core/agent-events.js";
import type { ProjectedAssistantMessage } from "../../core/agent-message-projector.js";
import type { RichModelSetupRequest, RichModelSetupState } from "./model-setup.js";

export type RichTuiMode = "Build" | "Plan" | "Goal";

export type RichTuiMessage = {
  role: "user" | "assistant" | "system";
  text: string;
};

export type RichTuiContextMetrics = {
  tokens: number;
  percentUsed: number;
  windowTokens?: number;
  spentUsd?: number;
};

export type RichTuiWorkspaceStatus = {
  insideWorkTree: boolean;
  branch?: string;
  dirtyCount: number;
  dirtyFiles: string[];
  error?: string;
};

export type RichTuiLspStatus = {
  enabled: boolean;
  label: string;
};

export type RichTuiFocus = "input" | "transcript" | "sidebar" | "commands";
export type RichTuiRunHealth = "Ready" | "Working" | "Needs approval" | "Stopped" | "Paused" | "Cancelled" | "Failed" | "Done";

export type RichTuiCommandPaletteState = {
  open: boolean;
  cursorIndex: number;
};

export type RichTuiCommandSuggestionsState = {
  open: boolean;
  cursorIndex: number;
};

export type RichTuiPendingPlanApproval = {
  task: string;
  plan: string;
  sessionId?: string;
  planPath?: string;
};

export type RichTuiSessionChoice = {
  id: string;
  title: string;
  workspace?: string;
};

export type RichTuiSessionPickerState = {
  open: boolean;
  cursorIndex: number;
};

export type RichTuiSessionTodo = {
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
};

export type RichTuiState = {
  workspace: string;
  provider: string;
  model: string;
  readiness: string;
  mode: RichTuiMode;
  input: string;
  inputHistory?: string[];
  inputHistoryIndex?: number;
  inputHistoryDraft?: string;
  transcriptScrollOffset?: number;
  messages: RichTuiMessage[];
  events: AgentRunEvent[];
  agentRunEvents?: AgentRunEvent[];
  projectedAssistantMessages?: ProjectedAssistantMessage[];
  context?: RichTuiContextMetrics;
  lsp?: RichTuiLspStatus;
  workspaceStatus?: RichTuiWorkspaceStatus;
  objective?: string;
  goal?: {
    id: string;
    status: "active" | "complete" | "blocked" | "cancelled";
    objective: string;
    summary: string;
    checkpoints: number;
    repeatedBlockers: number;
    modelCalls: number;
    tokenUsed: number;
  };
  todos?: RichTuiSessionTodo[];
  runBudget?: {
    steps: number;
    modelCalls: number;
    elapsedMs: number;
    maxSteps?: number;
    maxModelCalls?: number;
    maxDurationMs?: number;
  };
  runHealth?: RichTuiRunHealth;
  version?: string;
  focus?: RichTuiFocus;
  commandPalette?: RichTuiCommandPaletteState;
  commandSuggestions?: RichTuiCommandSuggestionsState;
  streamingAssistantMessageIndex?: number;
  lastAssistantMessageText?: string;
  lastRunDurationMs?: number;
  currentActivity?: string;
  stepCount?: number;
  lastEventTitle?: string;
  activeSessionId?: string;
  sessionChoices?: RichTuiSessionChoice[];
  sessionPicker?: RichTuiSessionPickerState;
  statusLine?: string;
  pendingPlanApproval?: RichTuiPendingPlanApproval;
  modelSetup?: RichModelSetupState;
  pendingModelSetupRequest?: RichModelSetupRequest;
};

export function nextMode(mode: RichTuiMode): RichTuiMode {
  if (mode === "Plan") {
    return "Build";
  }
  if (mode === "Build") {
    return "Goal";
  }
  return "Plan";
}

export function describeMode(mode: RichTuiMode): string {
  if (mode === "Plan") {
    return "read-only planning";
  }
  if (mode === "Goal") {
    return "durable objective";
  }
  return "workspace execution";
}

export function resumeGuidance(state: Pick<RichTuiState, "runHealth" | "activeSessionId">): string | undefined {
  if (state.runHealth !== "Stopped" || !state.activeSessionId) {
    return undefined;
  }
  return "/continue or /resume";
}

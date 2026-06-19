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
export type RichTuiRunHealth = "Ready" | "Working" | "Needs approval" | "Stopped" | "Failed" | "Done";

export type RichTuiCommandPaletteState = {
  open: boolean;
  cursorIndex: number;
};

export type RichTuiPendingPlanApproval = {
  task: string;
  plan: string;
  sessionId?: string;
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
  runHealth?: RichTuiRunHealth;
  version?: string;
  focus?: RichTuiFocus;
  commandPalette?: RichTuiCommandPaletteState;
  streamingAssistantMessageIndex?: number;
  lastAssistantMessageText?: string;
  lastRunDurationMs?: number;
  currentActivity?: string;
  stepCount?: number;
  lastEventTitle?: string;
  activeSessionId?: string;
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

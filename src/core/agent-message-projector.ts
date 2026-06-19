import type { AgentRunEvent } from "./agent-events.js";
import { redactAgentEventText } from "./agent-event-redaction.js";

export type ProjectedAssistantTextPart = {
  type: "text";
  step?: number;
  text: string;
  final?: boolean;
  createdAt?: string;
};

export type ProjectedAssistantToolPart = {
  type: "tool";
  step: number;
  callId: string;
  toolName: string;
  title: string;
  status: "running" | "ok" | "failed";
  detailsHidden: boolean;
  paths?: string[];
  durationMs?: number;
  errorCode?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  safeDetails?: ProjectedToolSafeDetails;
  createdAt?: string;
  finishedAt?: string;
};

export type ProjectedToolSafeDetails = {
  paths?: string[];
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs?: number;
  stdoutBytes?: number;
  stderrBytes?: number;
};

export type ProjectedAssistantStatusPart = {
  type: "status";
  title: string;
  step?: number;
  status?: "started" | "finished" | "stopped";
  provider?: string;
  model?: string;
  responseType?: string;
  toolCallCount?: number;
  durationMs?: number;
  createdAt?: string;
};

export type ProjectedAssistantErrorPart = {
  type: "error";
  title: string;
  step?: number;
  durationMs?: number;
  createdAt?: string;
};

export type ProjectedAssistantPart =
  | ProjectedAssistantTextPart
  | ProjectedAssistantToolPart
  | ProjectedAssistantStatusPart
  | ProjectedAssistantErrorPart;

export type ProjectedAssistantMessage = {
  role: "assistant";
  runId: string;
  sessionId?: string;
  createdAt?: string;
  updatedAt?: string;
  parts: ProjectedAssistantPart[];
};

export function projectAgentRunEventsToAssistantMessages(events: readonly AgentRunEvent[]): ProjectedAssistantMessage[] {
  const messages: ProjectedAssistantMessage[] = [];
  const byRun = new Map<string, ProjectedAssistantMessage>();

  for (const event of events) {
    const message = getMessageForEvent(messages, byRun, event);
    message.updatedAt = event.createdAt ?? message.updatedAt;
    switch (event.type) {
      case "session_started":
        message.parts.push({
          type: "status",
          title: `Session ${redactAgentEventText(event.sessionId)} started`,
          status: "started",
          createdAt: event.createdAt,
        });
        break;
      case "step_started":
        message.parts.push({
          type: "status",
          title: `Thinking step ${event.step}`,
          step: event.step,
          status: "started",
          provider: safeOptional(event.provider),
          model: safeOptional(event.model),
          createdAt: event.createdAt,
        });
        break;
      case "assistant_text":
        applyAssistantTextPart(message, event);
        break;
      case "assistant_note":
        applyAssistantNotePart(message, event);
        break;
      case "tool_started":
        upsertToolPart(message, {
          type: "tool",
          step: event.step,
          callId: redactAgentEventText(event.callId),
          toolName: redactAgentEventText(event.toolName),
          title: redactAgentEventText(event.title),
          status: "running",
          detailsHidden: event.detailsHidden,
          paths: safePaths(event.paths),
          safeDetails: safeToolDetails(event),
          createdAt: event.createdAt,
        });
        break;
      case "tool_finished":
        upsertToolPart(message, {
          type: "tool",
          step: event.step,
          callId: redactAgentEventText(event.callId),
          toolName: redactAgentEventText(event.toolName),
          title: redactAgentEventText(event.title),
          status: event.status,
          detailsHidden: event.detailsHidden,
          paths: safePaths(event.paths),
          durationMs: event.durationMs,
          errorCode: safeOptional(event.errorCode),
          exitCode: event.exitCode,
          timedOut: event.timedOut,
          safeDetails: safeToolDetails(event),
          finishedAt: event.createdAt,
        });
        break;
      case "file_changed":
        message.parts.push({
          type: "status",
          title: `${event.change} ${redactAgentEventText(event.path)}`,
          step: event.step,
          status: "finished",
          createdAt: event.createdAt,
        });
        break;
      case "model_finished":
        message.parts.push({
          type: "status",
          title: `Model ${event.responseType} in ${event.durationMs}ms`,
          step: event.step,
          status: "finished",
          responseType: event.responseType,
          toolCallCount: event.toolCallCount,
          durationMs: event.durationMs,
          createdAt: event.createdAt,
        });
        break;
      case "model_failed":
        message.parts.push({
          type: "error",
          title: `Model failed in ${event.durationMs}ms`,
          step: event.step,
          durationMs: event.durationMs,
          createdAt: event.createdAt,
        });
        break;
      case "reasoning_started":
        message.parts.push({
          type: "status",
          title: redactAgentEventText(event.publicSummary),
          step: event.step,
          status: "started",
          createdAt: event.createdAt,
        });
        break;
      case "reasoning_delta":
        updateReasoningStatusPart(message, event.step, redactAgentEventText(event.publicSummary), event.elapsedMs, event.createdAt);
        break;
      case "reasoning_finished":
        updateReasoningStatusPart(message, event.step, redactAgentEventText(event.publicSummary), event.durationMs, event.createdAt, "finished");
        break;
      case "step_limit_reached":
        message.parts.push({
          type: "status",
          title: `Step budget reached: ${event.maxSteps}`,
          status: "stopped",
          createdAt: event.createdAt,
        });
        break;
      case "run_failed":
        message.parts.push({
          type: "error",
          title: redactAgentEventText(event.message),
          createdAt: event.createdAt,
        });
        break;
    }
  }

  return messages.filter((message) => message.parts.length > 0);
}

function getMessageForEvent(
  messages: ProjectedAssistantMessage[],
  byRun: Map<string, ProjectedAssistantMessage>,
  event: AgentRunEvent,
): ProjectedAssistantMessage {
  const key = `${event.sessionId ?? ""}\0${event.runId}`;
  const existing = byRun.get(key);
  if (existing) {
    return existing;
  }
  const message: ProjectedAssistantMessage = {
    role: "assistant",
    runId: event.runId,
    sessionId: event.sessionId,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    parts: [],
  };
  byRun.set(key, message);
  messages.push(message);
  return message;
}

function updateReasoningStatusPart(
  message: ProjectedAssistantMessage,
  step: number,
  title: string,
  durationMs: number | undefined,
  createdAt: string | undefined,
  status: "started" | "finished" = "started",
): void {
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (part?.type === "status" && part.step === step && part.title === title) {
      message.parts[index] = { ...part, status, durationMs: durationMs ?? part.durationMs, createdAt: part.createdAt ?? createdAt };
      return;
    }
  }
  message.parts.push({ type: "status", step, title, status, durationMs, createdAt });
}

function applyAssistantTextPart(message: ProjectedAssistantMessage, event: Extract<AgentRunEvent, { type: "assistant_text" }>): void {
  const text = redactAgentEventText(event.text);
  if (!text) {
    return;
  }
  if (event.final) {
    const existing = findLatestTextPartForStep(message, event.step);
    if (existing && !existing.final) {
      existing.text = text;
      existing.final = true;
      return;
    }
    message.parts.push({ type: "text", step: event.step, text, final: true, createdAt: event.createdAt });
    return;
  }
  const last = message.parts.at(-1);
  if (last?.type === "text" && last.step === event.step && !last.final) {
    last.text += text;
    return;
  }
  message.parts.push({ type: "text", step: event.step, text, createdAt: event.createdAt });
}

function applyAssistantNotePart(message: ProjectedAssistantMessage, event: Extract<AgentRunEvent, { type: "assistant_note" }>): void {
  const text = redactAgentEventText(event.text);
  if (!text) {
    return;
  }
  message.parts.push({ type: "status", step: event.step, title: text, createdAt: event.createdAt });
}

function upsertToolPart(message: ProjectedAssistantMessage, next: ProjectedAssistantToolPart): void {
  const index = message.parts.findIndex((part) => part.type === "tool" && part.callId === next.callId);
  if (index === -1) {
    message.parts.push(next);
    return;
  }
  const current = message.parts[index];
  if (current.type !== "tool") {
    return;
  }
  message.parts[index] = {
    ...current,
    ...next,
    createdAt: current.createdAt ?? next.createdAt,
    paths: next.paths ?? current.paths,
  };
}

function findLatestTextPartForStep(message: ProjectedAssistantMessage, step: number): ProjectedAssistantTextPart | undefined {
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (part?.type === "text" && part.step === step) {
      return part;
    }
  }
  return undefined;
}

function safeOptional(value: string | undefined): string | undefined {
  return value ? redactAgentEventText(value) : undefined;
}

function safePaths(paths: string[] | undefined): string[] | undefined {
  return paths?.map(redactAgentEventText);
}

function safeToolDetails(event: Extract<AgentRunEvent, { type: "tool_started" | "tool_finished" }>): ProjectedToolSafeDetails {
  const details: ProjectedToolSafeDetails = {
    paths: safePaths(event.paths),
  };
  if (event.type === "tool_finished") {
    details.exitCode = event.exitCode;
    details.timedOut = event.timedOut;
    details.durationMs = event.durationMs;
    details.stdoutBytes = event.stdoutBytes;
    details.stderrBytes = event.stderrBytes;
  }
  return stripUndefinedDetails(details);
}

function stripUndefinedDetails(details: ProjectedToolSafeDetails): ProjectedToolSafeDetails {
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)) as ProjectedToolSafeDetails;
}

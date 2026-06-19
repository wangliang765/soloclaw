import type { ModelResponse, ModelUsage } from "../protocol/types.js";
import type { ExecutionTargetMode } from "../domain/index.js";

export type AgentRunEventBase = {
  runId: string;
  sessionId?: string;
  createdAt?: string;
};

export type AgentRunEvent =
  | (AgentRunEventBase & { type: "session_started"; sessionId: string; objective: string; targetMode?: ExecutionTargetMode })
  | (AgentRunEventBase & { type: "step_started"; step: number; model?: string; provider?: string })
  | (AgentRunEventBase & {
      type: "model_finished";
      step: number;
      responseType: ModelResponse["type"];
      toolCallCount: number;
      durationMs: number;
      usage?: ModelUsage;
    })
  | (AgentRunEventBase & { type: "model_failed"; step: number; durationMs: number })
  | (AgentRunEventBase & { type: "reasoning_started"; step: number; publicSummary: string })
  | (AgentRunEventBase & { type: "reasoning_delta"; step: number; publicSummary: string; deltaCount: number; elapsedMs?: number })
  | (AgentRunEventBase & { type: "reasoning_finished"; step: number; publicSummary: string; deltaCount: number; durationMs: number })
  | (AgentRunEventBase & { type: "assistant_text"; step: number; text: string; final?: boolean })
  | (AgentRunEventBase & { type: "assistant_note"; step: number; text: string })
  | (AgentRunEventBase & {
      type: "tool_started";
      step: number;
      callId: string;
      toolName: string;
      title: string;
      detailsHidden: boolean;
      paths?: string[];
    })
  | (AgentRunEventBase & {
      type: "tool_finished";
      step: number;
      callId: string;
      toolName: string;
      title: string;
      status: "ok" | "failed";
      durationMs?: number;
      detailsHidden: boolean;
      errorCode?: string;
      paths?: string[];
      exitCode?: number | null;
      timedOut?: boolean;
      stdoutBytes?: number;
      stderrBytes?: number;
    })
  | (AgentRunEventBase & { type: "file_changed"; step: number; path: string; change: "create" | "modify" | "delete" | "patch" })
  | (AgentRunEventBase & { type: "step_limit_reached"; maxSteps: number })
  | (AgentRunEventBase & { type: "run_failed"; message: string });

export type AgentRunEventSink = (event: AgentRunEvent) => void | Promise<void>;

export function withEventDefaults(event: AgentRunEvent): AgentRunEvent {
  return {
    createdAt: new Date().toISOString(),
    ...event,
  };
}

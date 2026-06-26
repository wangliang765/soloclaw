import type { ModelResponse, ModelUsage } from "../protocol/types.js";
import type { ExecutionTargetMode } from "../domain/index.js";
import type { AgentRuntimeStopKind } from "./agent-runtime-stop.js";

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
      type: "goal_updated";
      goalId: string;
      status: "active" | "complete" | "blocked" | "cancelled";
      objective: string;
      summary: string;
      repeatedBlockers?: number;
      tokenUsed?: number;
      modelCalls?: number;
    })
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
  | (AgentRunEventBase & {
      type: "run_budget_checkpoint";
      targetMode?: ExecutionTargetMode;
      steps: number;
      modelCalls: number;
      elapsedMs: number;
      maxSteps?: number;
      maxModelCalls?: number;
      maxDurationMs?: number;
    })
  | (AgentRunEventBase & {
      type: "guardrail_tripped";
      guardrail: "doom_loop" | "idle_budget";
      reason: string;
      toolName?: string;
      count?: number;
      resumeCommand?: string;
    })
  | (AgentRunEventBase & { type: "step_limit_reached"; maxSteps: number })
  | (AgentRunEventBase & {
      type: "runtime_stopped";
      stopKind: AgentRuntimeStopKind;
      targetMode?: ExecutionTargetMode;
      maxSteps?: number;
      reason: string;
      resumeCommand?: string;
    })
  | (AgentRunEventBase & { type: "run_failed"; message: string });

export type AgentRunEventSink = (event: AgentRunEvent) => void | Promise<void>;

export function withEventDefaults(event: AgentRunEvent): AgentRunEvent {
  return {
    createdAt: new Date().toISOString(),
    ...event,
  };
}

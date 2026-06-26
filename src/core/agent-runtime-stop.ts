import type { ExecutionTargetMode } from "../domain/index.js";

export type AgentRuntimeStopKind =
  | "step_budget"
  | "model_call_budget"
  | "model_failure_budget"
  | "duration_budget"
  | "idle_budget"
  | "doom_loop"
  | "approval_required"
  | "model_error"
  | "tool_error";

export type AgentRuntimeStop = {
  kind: AgentRuntimeStopKind;
  sessionId?: string;
  targetMode: ExecutionTargetMode;
  step?: number;
  maxSteps?: number;
  reason: string;
  resumeCommand?: string;
};

export function formatRuntimeStopAnswer(stop: AgentRuntimeStop): string {
  const lines = [
    stop.kind === "step_budget"
      ? `Stopped after ${stop.maxSteps ?? "the configured"} steps without a final answer.`
      : `Stopped: ${stop.reason}`,
    stop.reason,
  ];
  if (stop.sessionId) {
    lines.push(`session: ${stop.sessionId}`);
  }
  if (stop.resumeCommand) {
    lines.push(`resume: ${stop.resumeCommand}`);
  }
  return lines.join("\n");
}

export function stepBudgetRuntimeStop(input: {
  sessionId?: string;
  targetMode: ExecutionTargetMode;
  maxSteps: number;
}): AgentRuntimeStop {
  return {
    kind: "step_budget",
    sessionId: input.sessionId,
    targetMode: input.targetMode,
    maxSteps: input.maxSteps,
    reason: "The agent reached its step budget before the model returned a final response.",
    resumeCommand: input.sessionId ? `agent resume ${input.sessionId}` : undefined,
  };
}

export function modelBudgetRuntimeStop(input: {
  sessionId?: string;
  targetMode: ExecutionTargetMode;
  kind: "model_call_budget" | "model_failure_budget";
  reason?: string;
}): AgentRuntimeStop {
  return {
    kind: input.kind,
    sessionId: input.sessionId,
    targetMode: input.targetMode,
    reason:
      input.reason ??
      (input.kind === "model_call_budget"
        ? "The agent reached its model call budget before completing the task."
        : "The agent reached its model failure budget before completing the task."),
    resumeCommand: input.sessionId ? `agent resume ${input.sessionId}` : undefined,
  };
}

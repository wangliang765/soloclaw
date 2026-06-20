import type { ExecutionTargetMode } from "../domain/index.js";

export type AgentRuntimeStopKind = "step_budget" | "approval_required" | "model_error" | "tool_error";

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

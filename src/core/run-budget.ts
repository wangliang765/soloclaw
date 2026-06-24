import type { ExecutionTargetMode } from "../domain/index.js";
import type { AgentRuntimeStop, AgentRuntimeStopKind } from "./agent-runtime-stop.js";

export type AgentRunBudget = {
  maxSteps?: number;
  maxModelCalls?: number;
  maxDurationMs?: number;
  maxRepeatedToolCalls?: number;
  maxIdleSteps?: number;
};

export type RunBudgetUsage = {
  steps: number;
  modelCalls: number;
  startedAtMs: number;
  idleSteps: number;
};

export type RunBudgetCheckpoint = RunBudgetUsage & {
  elapsedMs: number;
};

export class RunBudgetController {
  readonly usage: RunBudgetUsage;

  constructor(
    readonly budget: AgentRunBudget,
    private readonly targetMode: ExecutionTargetMode,
    private readonly sessionId?: string,
    nowMs = Date.now(),
  ) {
    this.usage = { steps: 0, modelCalls: 0, startedAtMs: nowMs, idleSteps: 0 };
  }

  beforeStep(nowMs = Date.now()): AgentRuntimeStop | undefined {
    if (this.budget.maxSteps !== undefined && this.usage.steps >= this.budget.maxSteps) {
      return this.stop("step_budget", `The run reached the configured step budget of ${this.budget.maxSteps}.`);
    }
    if (this.budget.maxModelCalls !== undefined && this.usage.modelCalls >= this.budget.maxModelCalls) {
      return this.stop("model_call_budget", `The run reached the configured model call budget of ${this.budget.maxModelCalls}.`);
    }
    if (this.budget.maxDurationMs !== undefined && nowMs - this.usage.startedAtMs >= this.budget.maxDurationMs) {
      return this.stop("duration_budget", `The run reached the configured duration budget of ${this.budget.maxDurationMs}ms.`);
    }
    if (this.budget.maxIdleSteps !== undefined && this.usage.idleSteps >= this.budget.maxIdleSteps) {
      return this.stop("idle_budget", `The run did not make visible progress for ${this.budget.maxIdleSteps} step(s).`);
    }
    return undefined;
  }

  recordStepStarted(): void {
    this.usage.steps += 1;
  }

  recordModelCall(): void {
    this.usage.modelCalls += 1;
  }

  recordProgress(progress: boolean): void {
    this.usage.idleSteps = progress ? 0 : this.usage.idleSteps + 1;
  }

  checkpoint(nowMs = Date.now()): RunBudgetCheckpoint {
    return {
      ...this.usage,
      elapsedMs: nowMs - this.usage.startedAtMs,
    };
  }

  stop(kind: AgentRuntimeStopKind, reason: string): AgentRuntimeStop {
    return {
      kind,
      sessionId: this.sessionId,
      targetMode: this.targetMode,
      step: this.usage.steps,
      maxSteps: this.budget.maxSteps,
      reason,
      resumeCommand: this.sessionId ? `agent resume ${this.sessionId}` : undefined,
    };
  }
}

export function createRunBudget(input: AgentRunBudget): AgentRunBudget {
  return {
    ...input,
    maxRepeatedToolCalls: input.maxRepeatedToolCalls ?? 3,
    maxIdleSteps: input.maxIdleSteps ?? 8,
  };
}

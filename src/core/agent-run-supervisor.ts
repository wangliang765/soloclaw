import type { AgentLoop } from "./agent-loop.js";
import type { AgentStore } from "../store/agent-store.js";
import { buildSessionReportView } from "../sessions/session-inspection-view.js";

export type AgentRunSupervisorInput = {
  objective: string;
  sessionId?: string;
  autoContinue: boolean;
  maxContinuations?: number;
  maxDurationMs?: number;
  signal?: AbortSignal;
};

export type AgentRunSupervisorResult = {
  status: "complete" | "stopped" | "blocked" | "cancelled" | "failed";
  sessionId?: string;
  goalId?: string;
  finalAnswer: string;
  continuations: number;
};

export class AgentRunSupervisor {
  constructor(
    private readonly input: {
      store: AgentStore;
      createAgent: () => AgentLoop | Promise<AgentLoop>;
    },
  ) {}

  async run(input: AgentRunSupervisorInput): Promise<AgentRunSupervisorResult> {
    const startedAt = Date.now();
    const maxContinuations = input.maxContinuations ?? Number.POSITIVE_INFINITY;
    let sessionId = input.sessionId;
    let goalId: string | undefined;
    let finalAnswer = "";
    let continuations = 0;
    let observedRuntimeStops = 0;

    while (true) {
      if (input.signal?.aborted) {
        return { status: "cancelled", sessionId, goalId, finalAnswer, continuations };
      }
      if (input.maxDurationMs !== undefined && Date.now() - startedAt >= input.maxDurationMs) {
        return { status: "stopped", sessionId, goalId, finalAnswer, continuations };
      }

      const agent = await this.input.createAgent();
      if (sessionId) {
        finalAnswer = await agent.resume(sessionId);
      } else {
        const result = await agent.runWithSession(input.objective);
        sessionId = result.session?.id;
        finalAnswer = result.finalAnswer;
      }

      const goal = sessionId ? await this.input.store.getGoalRunBySession(sessionId) : undefined;
      goalId = goal?.id ?? goalId;
      if (goal?.status === "complete") {
        return { status: "complete", sessionId, goalId, finalAnswer, continuations };
      }
      if (goal?.status === "blocked") {
        return { status: "blocked", sessionId, goalId, finalAnswer, continuations };
      }
      if (goal?.status === "cancelled") {
        return { status: "cancelled", sessionId, goalId, finalAnswer, continuations };
      }

      const report = sessionId ? await buildSessionReportView(this.input.store, sessionId) : undefined;
      const runtimeStops = report?.summary.runtimeStops ?? 0;
      const hasNewResumableStop = runtimeStops > observedRuntimeStops && Boolean(report?.summary.resumeCommand);
      observedRuntimeStops = Math.max(observedRuntimeStops, runtimeStops);
      if (!input.autoContinue || !hasNewResumableStop) {
        return { status: "stopped", sessionId, goalId, finalAnswer, continuations };
      }
      if (continuations >= maxContinuations) {
        return { status: "stopped", sessionId, goalId, finalAnswer, continuations };
      }
      continuations += 1;
    }
  }
}

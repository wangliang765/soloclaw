import type { GoalCheckpoint, GoalCheckpointKind, GoalRun, Session } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore } from "../store/agent-store.js";

export type CreateGoalCheckpointInput = {
  kind: GoalCheckpointKind;
  sessionId: Session["id"];
  summary: string;
  blockerKey?: string;
  metadata?: Record<string, unknown>;
};

export class GoalService {
  constructor(private readonly store: AgentStore) {}

  async startForSession(session: Session, input: { tokenBudget?: number } = {}): Promise<GoalRun> {
    const existing = await this.store.getGoalRunBySession(session.id);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const goal: GoalRun = {
      id: makeId<"GoalRunId">("goal"),
      sessionId: session.id,
      objective: session.objective,
      status: "active",
      tokenBudget: input.tokenBudget,
      tokenUsed: 0,
      modelCalls: 0,
      repeatedBlockers: 0,
      createdBy: session.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.createGoalRun(goal);
    await this.addCheckpoint(goal, {
      kind: "resume",
      sessionId: session.id,
      summary: "Goal started.",
    });
    return goal;
  }

  async recordCheckpoint(goalId: string, input: CreateGoalCheckpointInput): Promise<GoalRun> {
    const goal = await this.requireGoal(goalId);
    await this.addCheckpoint(goal, input);
    const updated = {
      ...goal,
      updatedAt: new Date().toISOString(),
    };
    await this.store.updateGoalRun(updated);
    return updated;
  }

  async updateUsage(goalId: string, input: { tokenUsed?: number; modelCalls?: number }): Promise<GoalRun> {
    const goal = await this.requireGoal(goalId);
    const updated: GoalRun = {
      ...goal,
      tokenUsed: input.tokenUsed ?? goal.tokenUsed,
      modelCalls: input.modelCalls ?? goal.modelCalls,
      updatedAt: new Date().toISOString(),
    };
    await this.store.updateGoalRun(updated);
    return updated;
  }

  async recordBlocker(goalId: string, blockerKey: string, summary: string): Promise<GoalRun> {
    const goal = await this.requireGoal(goalId);
    const repeated = goal.repeatedBlockerKey === blockerKey ? goal.repeatedBlockers + 1 : 1;
    const now = new Date().toISOString();
    const updated: GoalRun = {
      ...goal,
      status: repeated >= 3 ? "blocked" : "active",
      repeatedBlockerKey: blockerKey,
      repeatedBlockers: repeated,
      updatedAt: now,
    };
    await this.addCheckpoint(updated, {
      kind: "blocker",
      sessionId: updated.sessionId,
      summary,
      blockerKey,
      metadata: { repeatedBlockers: repeated },
    });
    await this.store.updateGoalRun(updated);
    return updated;
  }

  async tryMarkComplete(goalId: string, input: { verified: boolean; summary: string }): Promise<GoalRun> {
    const goal = await this.requireGoal(goalId);
    await this.addCheckpoint(goal, {
      kind: "verification",
      sessionId: goal.sessionId,
      summary: input.summary,
      metadata: { verified: input.verified },
    });
    if (!input.verified) {
      const active = { ...goal, status: "active" as const, updatedAt: new Date().toISOString() };
      await this.store.updateGoalRun(active);
      return active;
    }
    const now = new Date().toISOString();
    const complete: GoalRun = {
      ...goal,
      status: "complete",
      repeatedBlockerKey: undefined,
      repeatedBlockers: 0,
      updatedAt: now,
      completedAt: now,
    };
    await this.store.updateGoalRun(complete);
    return complete;
  }

  async cancel(goalId: string, summary: string): Promise<GoalRun> {
    const goal = await this.requireGoal(goalId);
    const now = new Date().toISOString();
    const cancelled: GoalRun = {
      ...goal,
      status: "cancelled",
      updatedAt: now,
      completedAt: now,
    };
    await this.addCheckpoint(cancelled, {
      kind: "blocker",
      sessionId: cancelled.sessionId,
      summary,
    });
    await this.store.updateGoalRun(cancelled);
    return cancelled;
  }

  private async requireGoal(goalId: string): Promise<GoalRun> {
    const goal = await this.store.getGoalRun(goalId);
    if (!goal) {
      throw new Error(`Goal run not found: ${goalId}`);
    }
    return goal;
  }

  private async addCheckpoint(goal: GoalRun, input: CreateGoalCheckpointInput): Promise<void> {
    const checkpoint: GoalCheckpoint = {
      id: makeId<"GoalCheckpointId">("goalchk"),
      goalId: goal.id,
      sessionId: input.sessionId,
      kind: input.kind,
      summary: input.summary,
      blockerKey: input.blockerKey,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    };
    await this.store.addGoalCheckpoint(checkpoint);
  }
}

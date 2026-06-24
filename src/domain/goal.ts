import type { ActorRef, SessionId, Timestamp } from "./common.js";

export type GoalStatus = "active" | "complete" | "blocked" | "cancelled";
export type GoalCheckpointKind = "progress" | "verification" | "blocker" | "budget" | "resume";

export type GoalRun = {
  id: string;
  sessionId: SessionId;
  objective: string;
  status: GoalStatus;
  tokenBudget?: number;
  tokenUsed: number;
  modelCalls: number;
  repeatedBlockerKey?: string;
  repeatedBlockers: number;
  createdBy: ActorRef;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
};

export type GoalCheckpoint = {
  id: string;
  goalId: string;
  sessionId: SessionId;
  kind: GoalCheckpointKind;
  summary: string;
  blockerKey?: string;
  metadata: Record<string, unknown>;
  createdAt: Timestamp;
};

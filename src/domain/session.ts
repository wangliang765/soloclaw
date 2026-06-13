import type { ActorRef, SessionId, Timestamp } from "./common.js";
import type { TaskRisk } from "./policy.js";

export type SessionStatus = "created" | "running" | "paused" | "cancelled" | "failed" | "completed";
export type ExecutionTargetMode = "plan" | "build" | "goal";

export type Session = {
  id: SessionId;
  orgId?: string;
  projectId?: string;
  roomId?: string;
  objective: string;
  targetMode: ExecutionTargetMode;
  status: SessionStatus;
  risk: TaskRisk;
  createdBy: ActorRef;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type PlanStepStatus = "pending" | "in_progress" | "completed" | "blocked";

export type PlanStep = {
  id: string;
  title: string;
  status: PlanStepStatus;
  updatedAt: Timestamp;
};

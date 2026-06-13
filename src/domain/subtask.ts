import type { ActorRef, SessionId, SpecificationId, SpecificationTaskId, Timestamp } from "./common.js";
import type { ExecutionMode, TaskRisk } from "./policy.js";

export type SubtaskStatus = "created" | "assigned" | "running" | "cancelled" | "failed" | "completed";

export type SessionLinkType = "parent_child" | "room_session" | "handoff" | "review_of";

export type Subtask = {
  id: string;
  parentSessionId?: SessionId;
  childSessionId?: SessionId;
  specId?: SpecificationId;
  specTaskId?: SpecificationTaskId;
  roomId?: string;
  assignedAgentId?: string;
  objective: string;
  status: SubtaskStatus;
  risk: TaskRisk;
  executionMode: ExecutionMode;
  createdBy: ActorRef;
  resultSummary?: string;
  artifactRefs?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
};

export type SessionLink = {
  id: string;
  type: SessionLinkType;
  fromSessionId: SessionId;
  toSessionId: SessionId;
  roomId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
};

import type { ActorRef, ProjectId, RoomId, SessionId, SubtaskId, TaskAssignmentId, Timestamp, WorkerId } from "./common.js";

export type TaskAssignmentKind = "session" | "subtask";
export type TaskAssignmentStatus = "leased" | "running" | "paused" | "completed" | "failed" | "cancelled" | "expired";

export type TaskAssignment = {
  id: TaskAssignmentId;
  kind: TaskAssignmentKind;
  sessionId?: SessionId;
  subtaskId?: SubtaskId;
  workerId: WorkerId;
  projectId?: ProjectId;
  roomId?: RoomId;
  status: TaskAssignmentStatus;
  priority: number;
  attempts: number;
  leaseOwnerId: string;
  leaseExpiresAt: Timestamp;
  assignedBy: ActorRef;
  resultSummary?: string;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
};

export type TaskLeaseEnvelope = {
  version: 1;
  assignmentId: TaskAssignmentId;
  workerId: WorkerId;
  leaseOwnerId: string;
  leaseExpiresAt: Timestamp;
  claimedAt: Timestamp;
  claimedBy: ActorRef;
  broker: "local_assignment" | "redis" | "nats" | "postgres";
  nonce: string;
  signature?: string;
};

export type TaskLeaseNonce = {
  claimedById: string;
  nonce: string;
  assignmentId: TaskAssignmentId;
  workerId: WorkerId;
  envelopeHash: string;
  firstSeenAt: Timestamp;
  expiresAt?: Timestamp;
};

export function taskLeaseEnvelopeSigningPayload(envelope: Omit<TaskLeaseEnvelope, "signature">): string {
  return JSON.stringify({
    version: envelope.version,
    assignmentId: envelope.assignmentId,
    workerId: envelope.workerId,
    leaseOwnerId: envelope.leaseOwnerId,
    leaseExpiresAt: envelope.leaseExpiresAt,
    claimedAt: envelope.claimedAt,
    claimedByType: envelope.claimedBy.type,
    claimedById: envelope.claimedBy.id,
    broker: envelope.broker,
    nonce: envelope.nonce,
  });
}

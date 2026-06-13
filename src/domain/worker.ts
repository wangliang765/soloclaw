import type { ActorRef, AgentId, MachineId, OrgId, ProjectId, Timestamp, WorkerId } from "./common.js";

export type WorkerStatus = "online" | "offline" | "draining" | "suspended";

export type WorkerRegistration = {
  id: WorkerId;
  agentId: AgentId;
  machineId: MachineId;
  orgId?: OrgId;
  displayName: string;
  endpoint?: string;
  capabilities: string[];
  allowedProjects: ProjectId[];
  status: WorkerStatus;
  currentLoad: number;
  maxConcurrentTasks: number;
  metadata?: Record<string, unknown>;
  registeredAt: Timestamp;
  lastHeartbeatAt: Timestamp;
  expiresAt?: Timestamp;
};

export type WorkerHeartbeatEnvelope = {
  version: 1;
  workerId: WorkerId;
  agentId: AgentId;
  machineId: MachineId;
  status: WorkerStatus;
  currentLoad: number;
  maxConcurrentTasks: number;
  heartbeatAt: Timestamp;
  expiresAt?: Timestamp;
  heartbeatBy: ActorRef;
  nonce: string;
  signature?: string;
};

export type WorkerHeartbeatNonce = {
  agentId: AgentId;
  nonce: string;
  workerId: WorkerId;
  envelopeHash: string;
  firstSeenAt: Timestamp;
  expiresAt?: Timestamp;
};

export function workerHeartbeatEnvelopeSigningPayload(envelope: Omit<WorkerHeartbeatEnvelope, "signature">): string {
  return JSON.stringify({
    version: envelope.version,
    workerId: envelope.workerId,
    agentId: envelope.agentId,
    machineId: envelope.machineId,
    status: envelope.status,
    currentLoad: envelope.currentLoad,
    maxConcurrentTasks: envelope.maxConcurrentTasks,
    heartbeatAt: envelope.heartbeatAt,
    expiresAt: envelope.expiresAt ?? null,
    heartbeatByType: envelope.heartbeatBy.type,
    heartbeatById: envelope.heartbeatBy.id,
    nonce: envelope.nonce,
  });
}

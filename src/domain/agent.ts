import type { ActorRef, AgentId, MachineId, OrgId, ProjectId, RoomId, Timestamp } from "./common.js";

export type AgentTrustStatus = "pending" | "trusted" | "suspended" | "revoked" | "expired";
export type AgentHeartbeatStatus = "online" | "idle" | "running" | "error" | "offline";

export type AgentIdentity = {
  id: AgentId;
  machineId: MachineId;
  orgId?: OrgId;
  displayName: string;
  publicKeyPem: string;
  fingerprint: string;
  capabilities: string[];
  allowedProjects: ProjectId[];
  trustStatus: AgentTrustStatus;
  createdAt: Timestamp;
  lastSeenAt?: Timestamp;
  heartbeatStatus?: AgentHeartbeatStatus;
  lastHeartbeatAt?: Timestamp;
  heartbeatExpiresAt?: Timestamp;
  lastRoomId?: RoomId;
  lastError?: string;
  heartbeatMetadata?: Record<string, unknown>;
};

export type AgentHeartbeatEnvelope = {
  version: 1;
  agentId: AgentId;
  machineId: MachineId;
  status: AgentHeartbeatStatus;
  roomId?: RoomId;
  heartbeatAt: Timestamp;
  expiresAt?: Timestamp;
  lastPollStopReason?: string;
  messagesProcessed?: number;
  errorCount?: number;
  lastError?: string;
  metadata?: Record<string, unknown>;
  heartbeatBy: ActorRef;
  nonce: string;
  signature?: string;
};

export type AgentHeartbeatNonce = {
  agentId: AgentId;
  nonce: string;
  envelopeHash: string;
  firstSeenAt: Timestamp;
  expiresAt?: Timestamp;
};

export function agentHeartbeatEnvelopeSigningPayload(envelope: Omit<AgentHeartbeatEnvelope, "signature">): string {
  return JSON.stringify({
    version: envelope.version,
    agentId: envelope.agentId,
    machineId: envelope.machineId,
    status: envelope.status,
    roomId: envelope.roomId ?? null,
    heartbeatAt: envelope.heartbeatAt,
    expiresAt: envelope.expiresAt ?? null,
    lastPollStopReason: envelope.lastPollStopReason ?? null,
    messagesProcessed: envelope.messagesProcessed ?? null,
    errorCount: envelope.errorCount ?? null,
    lastError: envelope.lastError ?? null,
    metadata: envelope.metadata ?? {},
    heartbeatByType: envelope.heartbeatBy.type,
    heartbeatById: envelope.heartbeatBy.id,
    nonce: envelope.nonce,
  });
}

export type Machine = {
  id: MachineId;
  displayName: string;
  platform: NodeJS.Platform | "container";
  hostname?: string;
  createdAt: Timestamp;
  lastSeenAt?: Timestamp;
};

export type AgentTrust = {
  agentId: AgentId;
  trustedByAgentId?: AgentId;
  trustedByUserId?: string;
  status: AgentTrustStatus;
  reason?: string;
  createdAt: Timestamp;
  expiresAt?: Timestamp;
};

export type CapabilityGrant = {
  subjectType: "user" | "agent" | "service_account";
  subjectId: string;
  scopeType: "organization" | "project" | "room" | "session" | "operator";
  scopeId: string;
  capability: string;
  grantedBy: string;
  createdAt: Timestamp;
  expiresAt?: Timestamp;
};

import type { ActorRef, AgentId, ArtifactId, RoomId, Timestamp } from "./common.js";

export type RoomJoinPolicy = "manual" | "invite_token" | "fingerprint_allowlist" | "quorum" | "same_org";
export type RoomMemberStatus = "invited" | "pending" | "active" | "suspended" | "left" | "removed" | "expired";
export type RoomRole = "owner" | "moderator" | "participant" | "observer" | "executor" | "reviewer" | "approver";
export type RoomMessageKind = "chat" | "task" | "decision" | "tool_request" | "approval" | "artifact" | "system";
export type RoomInviteStatus = "active" | "expired" | "revoked" | "used";
export type RoomAgentResponseMode = "broadcast" | "mentions_only";
export type RoomMessageRoutingMode = "broadcast" | "mentions_only" | "silent";
export type RoomWideMentionPolicy = "disabled" | "moderators" | "members";

export const DEFAULT_ROOM_AGENT_RESPONSE_MODE: RoomAgentResponseMode = "mentions_only";
export const DEFAULT_ROOM_WIDE_MENTION_POLICY: RoomWideMentionPolicy = "moderators";

export type RoomMentionTarget =
  | { type: "all"; raw: string }
  | { type: "role"; role: RoomRole; raw: string }
  | { type: "actor"; actor: ActorRef; raw: string }
  | { type: "unresolved"; raw: string };

export type RoomRoutingDiagnosticCode =
  | "unresolved_mention"
  | "ambiguous_mention"
  | "invalid_role"
  | "unknown_actor"
  | "inactive_target"
  | "empty_role"
  | "empty_all";

export type RoomRoutingDiagnostic = {
  code: RoomRoutingDiagnosticCode;
  severity: "info" | "warning";
  raw: string;
  message: string;
  target?: RoomMentionTarget;
  matchedActors?: ActorRef[];
  activeAgentTargets?: number;
};

export type RoomMessageRouting = {
  mode: RoomMessageRoutingMode;
  targets: RoomMentionTarget[];
  source: "parsed" | "explicit" | "default";
};

export type RoomPolicy = {
  joinPolicy: RoomJoinPolicy;
  requiredApprovals?: number;
  allowedFingerprints?: string[];
  defaultCapabilities: string[];
  agentResponseMode?: RoomAgentResponseMode;
  wideMentionPolicy?: RoomWideMentionPolicy;
  maxRoutedAgentTargets?: number;
  requireSignedInvites?: boolean;
  maxMembers?: number;
  expiresAt?: Timestamp;
  transcriptRetentionDays?: number;
};

export type Room = {
  id: RoomId;
  projectId?: string;
  name: string;
  policy: RoomPolicy;
  createdBy: ActorRef;
  createdAt: Timestamp;
  closedAt?: Timestamp;
};

export type RoomMember = {
  roomId: RoomId;
  actor: ActorRef;
  aliases?: string[];
  role: RoomRole;
  status: RoomMemberStatus;
  joinedAt?: Timestamp;
  expiresAt?: Timestamp;
};

export type RoomMessage = {
  id: string;
  roomId: RoomId;
  sender: ActorRef;
  kind: RoomMessageKind;
  body: string;
  signature?: string;
  createdAt: Timestamp;
  parentMessageId?: string;
  artifactRefs?: ArtifactId[];
  routing?: RoomMessageRouting;
  metadata?: Record<string, unknown>;
};

export type RoomDeliveryCursor = {
  roomId: RoomId;
  agentId: string;
  lastDeliveredMessageId?: string;
  lastAckEnvelope?: RoomDeliveryAckEnvelope;
  updatedAt: Timestamp;
  updatedBy: ActorRef;
};

export type RoomDeliveryAckEnvelope = {
  version: 1;
  roomId: RoomId;
  agentId: string;
  messageId: string;
  acknowledgedAt: Timestamp;
  acknowledgedBy: ActorRef;
  nonce: string;
  signature?: string;
};

export type RoomDeliveryAckNonce = {
  agentId: string;
  nonce: string;
  roomId: RoomId;
  messageId: string;
  envelopeHash: string;
  firstSeenAt: Timestamp;
  expiresAt?: Timestamp;
};

export type RoomMessageIntentEnvelope = {
  version: 1;
  roomId: RoomId;
  agentId: AgentId;
  kind: RoomMessageKind;
  body: string;
  sentAt: Timestamp;
  sentBy: ActorRef;
  nonce: string;
  parentMessageId?: string;
  artifactRefs?: ArtifactId[];
  routing?: RoomMessageRouting;
  signature?: string;
};

export type RoomMessageIntentNonce = {
  agentId: AgentId;
  nonce: string;
  roomId: RoomId;
  envelopeHash: string;
  firstSeenAt: Timestamp;
  expiresAt?: Timestamp;
};

export type RoomInviteEnvelope = {
  version: 1;
  inviteId: string;
  roomId: RoomId;
  tokenHash: string;
  role: RoomRole;
  maxUses: number;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  createdBy: ActorRef;
  signature?: string;
};

export function roomDeliveryAckEnvelopeSigningPayload(envelope: Omit<RoomDeliveryAckEnvelope, "signature">): string {
  return JSON.stringify({
    version: envelope.version,
    roomId: envelope.roomId,
    agentId: envelope.agentId,
    messageId: envelope.messageId,
    acknowledgedAt: envelope.acknowledgedAt,
    acknowledgedByType: envelope.acknowledgedBy.type,
    acknowledgedById: envelope.acknowledgedBy.id,
    nonce: envelope.nonce,
  });
}

export function roomMessageIntentEnvelopeSigningPayload(envelope: Omit<RoomMessageIntentEnvelope, "signature">): string {
  return JSON.stringify({
    version: envelope.version,
    roomId: envelope.roomId,
    agentId: envelope.agentId,
    kind: envelope.kind,
    body: envelope.body,
    sentAt: envelope.sentAt,
    sentByType: envelope.sentBy.type,
    sentById: envelope.sentBy.id,
    nonce: envelope.nonce,
    parentMessageId: envelope.parentMessageId ?? null,
    artifactRefs: envelope.artifactRefs ?? [],
    routing: envelope.routing ?? null,
  });
}

export function roomInviteEnvelopeSigningPayload(envelope: Omit<RoomInviteEnvelope, "signature">): string {
  return JSON.stringify({
    version: envelope.version,
    inviteId: envelope.inviteId,
    roomId: envelope.roomId,
    tokenHash: envelope.tokenHash,
    role: envelope.role,
    maxUses: envelope.maxUses,
    createdAt: envelope.createdAt,
    expiresAt: envelope.expiresAt,
    createdByType: envelope.createdBy.type,
    createdById: envelope.createdBy.id,
  });
}

export type RoomInvite = {
  id: string;
  roomId: RoomId;
  tokenHash: string;
  createdBy: ActorRef;
  role: RoomRole;
  status: RoomInviteStatus;
  maxUses: number;
  uses: number;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  lastUsedAt?: Timestamp;
  envelope?: RoomInviteEnvelope;
};

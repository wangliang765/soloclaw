import type { ActorRef, Timestamp } from "./common.js";
import type { PolicyAction } from "./policy.js";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";

export type ApprovalRequest = {
  id: string;
  status: ApprovalStatus;
  requestedBy: ActorRef;
  action: PolicyAction;
  reason: string;
  approverHint?: "human" | "agent_super_approval" | "quorum";
  orgId?: string;
  projectId?: string;
  roomId?: string;
  sessionId?: string;
  toolName?: string;
  inputSummary?: string;
  decisionBy?: ActorRef;
  decisionReason?: string;
  createdAt: Timestamp;
  decidedAt?: Timestamp;
  expiresAt?: Timestamp;
};

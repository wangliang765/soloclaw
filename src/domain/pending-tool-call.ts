import type { ActorRef, Timestamp } from "./common.js";
import type { JsonObject } from "../protocol/types.js";

export type PendingToolCallStatus = "pending_approval" | "approved" | "denied" | "executed" | "failed";

export type PendingToolCall = {
  id: string;
  approvalId: string;
  toolCallId?: string;
  sessionId?: string;
  toolName: string;
  input: JsonObject;
  requestedBy: ActorRef;
  status: PendingToolCallStatus;
  resultJson?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

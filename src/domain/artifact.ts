import type { ActorRef, Timestamp } from "./common.js";

export type ArtifactKind = "log" | "patch" | "screenshot" | "report" | "plugin_output" | "tool_output" | "pr_link" | "other";
export type ArtifactStatus = "active" | "deleted";

export type ArtifactRecord = {
  id: string;
  kind: ArtifactKind;
  name: string;
  path?: string;
  uri?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  orgId?: string;
  projectId?: string;
  roomId?: string;
  sessionId?: string;
  createdBy: ActorRef;
  status: ArtifactStatus;
  createdAt: Timestamp;
  deletedAt?: Timestamp;
  deletedBy?: ActorRef;
  metadata?: Record<string, unknown>;
};

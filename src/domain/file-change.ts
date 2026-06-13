import type { ActorRef, Timestamp } from "./common.js";

export type FileChangeKind = "create" | "replace_range" | "delete" | "rename" | "patch";

export type FileChange = {
  id: string;
  sessionId?: string;
  actor: ActorRef;
  kind: FileChangeKind;
  path: string;
  beforeHash?: string;
  afterHash?: string;
  summary: string;
  createdAt: Timestamp;
};

import type { Timestamp } from "./common.js";

export type MemoryScope = "user" | "project" | "repository" | "organization" | "room" | "agent";
export type MemoryKind = "preference" | "project_fact" | "architecture_note" | "decision" | "bug_pattern" | "workflow" | "credential_reference" | "do_not_do";

export type MemoryRecord = {
  id: string;
  scopeType: MemoryScope;
  scopeId: string;
  kind: MemoryKind;
  content: string;
  summary: string;
  sourceSessionId?: string;
  confidence: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt?: Timestamp;
  lastUsedAt?: Timestamp;
};

export type SessionSummary = {
  id: string;
  sessionId: string;
  summary: string;
  createdAt: Timestamp;
};

import type { ActorRef, Timestamp } from "./common.js";

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

export type MemoryReviewStatus = "pending" | "approved" | "rejected" | "superseded";
export type MemorySafetySeverity = "low" | "medium" | "high";

export type MemorySafetyFinding = {
  rule: string;
  severity: MemorySafetySeverity;
  reason: string;
};

export type MemoryCandidate = {
  id: string;
  scopeType: MemoryScope;
  scopeId: string;
  kind: MemoryKind;
  proposedContent: string;
  proposedSummary: string;
  sourceSessionId?: string;
  sourceSummaryId?: string;
  confidence: number;
  status: MemoryReviewStatus;
  safetyFindings: MemorySafetyFinding[];
  approvedMemoryId?: string;
  reviewReason?: string;
  createdBy: ActorRef;
  reviewedBy?: ActorRef;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  reviewedAt?: Timestamp;
};

export type MemorySource = {
  id: string;
  memoryId: string;
  sourceType: "manual" | "candidate" | "session_summary" | "compaction" | "snapshot" | "knowledge";
  sourceId?: string;
  citation?: string;
  createdAt: Timestamp;
};

export type MemoryUsageEvent = {
  id: string;
  memoryId: string;
  actor: ActorRef;
  sessionId?: string;
  reason: "retrieved" | "injected" | "cited" | "updated" | "deleted";
  query?: string;
  score?: number;
  createdAt: Timestamp;
};

export type MemoryRetrievalResult = {
  memory: MemoryRecord;
  score: number;
  citationId: string;
  safetyFindings: MemorySafetyFinding[];
  reason: string;
};

export type MemorySnapshotRecord = {
  id: string;
  scopeType: MemoryScope;
  scopeId: string;
  filePath: string;
  contentHash: string;
  importedAt?: Timestamp;
  exportedAt?: Timestamp;
  updatedAt: Timestamp;
};

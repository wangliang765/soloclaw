import type { ActorRef, Timestamp } from "./common.js";
import type { MemoryScope } from "./memory.js";

export type KnowledgeSourceKind = "manual" | "file" | "url" | "repository" | "mcp" | "memory";
export type KnowledgeTrustLevel = "trusted" | "reviewed" | "untrusted";
export type KnowledgeEvalThresholdConfig = {
  minRecallAtK?: number;
  minMrr?: number;
  maxEmptyResultRate?: number;
  minCitationPrecision?: number;
  maxPermissionLeakRate?: number;
};

export type KnowledgeEvalCaseDefinition = {
  id?: string;
  query: string;
  scopeType?: MemoryScope;
  scopeId?: string;
  sourceId?: string;
  expectedSourceIds?: string[];
  expectedChunkIds?: string[];
  forbiddenSourceIds?: string[];
  forbiddenChunkIds?: string[];
  metadata?: Record<string, unknown>;
};

export type KnowledgeEvalMetricSnapshot = {
  recallAtK: number;
  mrr: number;
  emptyResultRate: number;
  citationPrecision: number;
  permissionLeakRate: number;
  permissionLeakCount: number;
};

export type KnowledgeEvalGateSnapshot = {
  passed: boolean;
  thresholds: KnowledgeEvalThresholdConfig;
  failures: string[];
};

export type KnowledgeSource = {
  id: string;
  scopeType: MemoryScope;
  scopeId: string;
  kind: KnowledgeSourceKind;
  name: string;
  uri?: string;
  description?: string;
  trustLevel: KnowledgeTrustLevel;
  createdBy: ActorRef;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type KnowledgeEvalSet = {
  id: string;
  name: string;
  description?: string;
  scopeType?: MemoryScope;
  scopeId?: string;
  sourceId?: string;
  cases: KnowledgeEvalCaseDefinition[];
  thresholds?: KnowledgeEvalThresholdConfig;
  createdBy: ActorRef;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type KnowledgeEvalRun = {
  id: string;
  evalSetId?: string;
  scopeType?: MemoryScope;
  scopeId?: string;
  sourceId?: string;
  caseCount: number;
  limit: number;
  metrics: KnowledgeEvalMetricSnapshot;
  gate: KnowledgeEvalGateSnapshot;
  cases: Array<Record<string, unknown>>;
  enforceAccess: boolean;
  safetyMode: string;
  artifactId?: string;
  createdBy?: ActorRef;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
};

export type KnowledgeChunk = {
  id: string;
  sourceId: string;
  scopeType: MemoryScope;
  scopeId: string;
  content: string;
  summary: string;
  ordinal: number;
  tokenCount: number;
  contentHash: string;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

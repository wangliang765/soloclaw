import type { ActorRef, KnowledgeChunk, KnowledgeSource, MemoryScope } from "../domain/index.js";
import type { KnowledgeSafetyFinding, KnowledgeSafetyMode } from "./knowledge-service.js";

export type SearchAdapterMode = "keyword" | "full_text" | "vector" | "hybrid";

export type SearchDocument = {
  chunk: KnowledgeChunk;
  source?: KnowledgeSource;
};

export type SearchAdapterQuery = {
  query: string;
  mode?: SearchAdapterMode;
  scopeType?: MemoryScope;
  scopeId?: string;
  sourceId?: string;
  limit?: number;
  actor?: ActorRef;
  enforceAccess?: boolean;
  safetyMode?: KnowledgeSafetyMode;
};

export type SearchAdapterResult = {
  chunk: KnowledgeChunk;
  source?: KnowledgeSource;
  score: number;
  snippet: string;
  safetyFindings: KnowledgeSafetyFinding[];
  metadata?: Record<string, unknown>;
};

export type SearchAdapterDiagnostics = {
  candidateCount: number;
  scoredCount: number;
  unsafeCandidateCount: number;
  filteredBySafety: number;
};

export type SearchAdapterOutput = {
  results: SearchAdapterResult[];
  diagnostics: SearchAdapterDiagnostics;
};

export type IndexSearchDocumentsInput = {
  documents: SearchDocument[];
};

export interface SearchAdapter {
  index(input: IndexSearchDocumentsInput): Promise<void>;
  search(input: SearchAdapterQuery): Promise<SearchAdapterOutput>;
  removeSource?(sourceId: string): Promise<void>;
}

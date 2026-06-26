import type { MemoryCandidate, MemoryKind, MemoryRecord, MemoryScope, SessionSummary } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore } from "../store/agent-store.js";
import { MemoryExtractionService, type MemoryExtractionInput, type MemoryExtractionResult } from "./memory-extraction-service.js";
import { MemoryReviewService, type ApproveMemoryCandidateInput, type ApproveMemoryCandidateResult, type RejectMemoryCandidateInput } from "./memory-review-service.js";

export type AddMemoryInput = {
  scopeType: MemoryScope;
  scopeId: string;
  kind: MemoryKind;
  content: string;
  summary?: string;
  sourceSessionId?: string;
  confidence?: number;
};

export class MemoryService {
  constructor(private readonly store: AgentStore) {}

  async add(input: AddMemoryInput): Promise<MemoryRecord> {
    const now = new Date().toISOString();
    const memory: MemoryRecord = {
      id: makeId<"ArtifactId">("mem"),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      kind: input.kind,
      content: input.content,
      summary: input.summary ?? summarize(input.content),
      sourceSessionId: input.sourceSessionId,
      confidence: input.confidence ?? 0.8,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.addMemory(memory);
    return memory;
  }

  async list(scopeType?: MemoryScope, scopeId?: string): Promise<MemoryRecord[]> {
    return this.store.listMemories(scopeType, scopeId);
  }

  async delete(memoryId: string): Promise<boolean> {
    return this.store.deleteMemory(memoryId);
  }

  async extractCandidates(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
    return new MemoryExtractionService(this.store).extractFromText(input);
  }

  async listCandidates(input?: Parameters<AgentStore["listMemoryCandidates"]>[0]): Promise<MemoryCandidate[]> {
    return this.store.listMemoryCandidates(input);
  }

  async approveCandidate(input: ApproveMemoryCandidateInput): Promise<ApproveMemoryCandidateResult> {
    return new MemoryReviewService(this.store).approve(input);
  }

  async rejectCandidate(input: RejectMemoryCandidateInput): Promise<MemoryCandidate> {
    return new MemoryReviewService(this.store).reject(input);
  }

  async addSessionSummary(sessionId: string, summary: string): Promise<SessionSummary> {
    const record: SessionSummary = {
      id: makeId<"ArtifactId">("sum"),
      sessionId,
      summary,
      createdAt: new Date().toISOString(),
    };
    await this.store.addSessionSummary(record);
    return record;
  }
}

function summarize(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
}

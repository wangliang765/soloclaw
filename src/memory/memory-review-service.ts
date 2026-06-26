import type { ActorRef, MemoryCandidate, MemoryRecord } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore } from "../store/agent-store.js";
import { hasBlockingMemorySafetyFinding, scanMemorySafety } from "./memory-safety.js";

export type ApproveMemoryCandidateInput = {
  candidateId: string;
  reviewer: ActorRef;
  content?: string;
  summary?: string;
};

export type ApproveMemoryCandidateResult = {
  candidate: MemoryCandidate;
  memory: MemoryRecord;
};

export type RejectMemoryCandidateInput = {
  candidateId: string;
  reviewer: ActorRef;
  reason: string;
};

export class MemoryReviewService {
  constructor(private readonly store: AgentStore) {}

  async approve(input: ApproveMemoryCandidateInput): Promise<ApproveMemoryCandidateResult> {
    const candidate = await this.requirePendingCandidate(input.candidateId);
    if (hasBlockingMemorySafetyFinding(candidate.safetyFindings)) {
      throw new Error(`Memory candidate has blocking safety findings: ${candidate.id}`);
    }
    const now = new Date().toISOString();
    const content = input.content ?? candidate.proposedContent;
    const summary = input.summary ?? candidate.proposedSummary;
    const finalSafetyFindings = scanMemorySafety(`${summary}\n${content}`);
    if (hasBlockingMemorySafetyFinding(finalSafetyFindings)) {
      throw new Error(`Memory candidate has blocking safety findings: ${candidate.id}`);
    }
    const memory: MemoryRecord = {
      id: makeId<"ArtifactId">("mem"),
      scopeType: candidate.scopeType,
      scopeId: candidate.scopeId,
      kind: candidate.kind,
      content,
      summary,
      sourceSessionId: candidate.sourceSessionId,
      confidence: candidate.confidence,
      createdAt: now,
      updatedAt: now,
    };
    const approved: MemoryCandidate = {
      ...candidate,
      status: "approved",
      approvedMemoryId: memory.id,
      reviewedBy: input.reviewer,
      reviewedAt: now,
      updatedAt: now,
    };
    await this.store.addMemory(memory);
    await this.store.createMemorySource({
      id: makeId<"ArtifactId">("msrc"),
      memoryId: memory.id,
      sourceType: "candidate",
      sourceId: candidate.id,
      citation: candidate.sourceSummaryId,
      createdAt: now,
    });
    await this.store.updateMemoryCandidate(approved);
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "memory.candidate_approved",
      actor: input.reviewer,
      sessionId: candidate.sourceSessionId,
      summary: `Memory candidate approved: ${candidate.kind}`,
      metadata: {
        candidateId: candidate.id,
        memoryId: memory.id,
        scopeType: memory.scopeType,
        scopeId: memory.scopeId,
        kind: memory.kind,
      },
      artifactRefs: [],
      createdAt: now,
    });
    return { candidate: approved, memory };
  }

  async reject(input: RejectMemoryCandidateInput): Promise<MemoryCandidate> {
    const candidate = await this.requirePendingCandidate(input.candidateId);
    const now = new Date().toISOString();
    const rejected: MemoryCandidate = {
      ...candidate,
      status: "rejected",
      reviewReason: input.reason,
      reviewedBy: input.reviewer,
      reviewedAt: now,
      updatedAt: now,
    };
    await this.store.updateMemoryCandidate(rejected);
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "memory.candidate_rejected",
      actor: input.reviewer,
      sessionId: candidate.sourceSessionId,
      summary: `Memory candidate rejected: ${candidate.kind}`,
      metadata: {
        candidateId: candidate.id,
        scopeType: candidate.scopeType,
        scopeId: candidate.scopeId,
        kind: candidate.kind,
        reason: input.reason,
      },
      artifactRefs: [],
      createdAt: now,
    });
    return rejected;
  }

  async editAndApprove(input: ApproveMemoryCandidateInput): Promise<ApproveMemoryCandidateResult> {
    return this.approve(input);
  }

  private async requirePendingCandidate(candidateId: string): Promise<MemoryCandidate> {
    const candidate = await this.store.getMemoryCandidate(candidateId);
    if (!candidate) {
      throw new Error(`Memory candidate not found: ${candidateId}`);
    }
    if (candidate.status !== "pending") {
      throw new Error(`Memory candidate is not pending: ${candidateId}`);
    }
    return candidate;
  }
}

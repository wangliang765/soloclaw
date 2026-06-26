import type { ActorRef, MemoryCandidate, MemoryKind, MemoryScope } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore } from "../store/agent-store.js";
import { hasBlockingMemorySafetyFinding, scanMemorySafety } from "./memory-safety.js";

export type MemoryExtractionInput = {
  text: string;
  scopeType: MemoryScope;
  scopeId: string;
  sourceSessionId?: string;
  sourceSummaryId?: string;
  actor: ActorRef;
};

export type MemoryExtractionResult = {
  createdCandidates: MemoryCandidate[];
  deniedCandidates: MemoryCandidate[];
};

type ExtractedCandidateText = {
  content: string;
  marker?: string;
  kind?: MemoryKind;
};

export class MemoryExtractionService {
  constructor(private readonly store: AgentStore) {}

  async extractFromText(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
    if (input.sourceSummaryId) {
      const existing = await this.store.listMemoryCandidates({ sourceSummaryId: input.sourceSummaryId, limit: 1 });
      if (existing.length > 0) {
        return { createdCandidates: [], deniedCandidates: [] };
      }
    }

    const candidates = extractCandidateSentences(input.text).map((entry) =>
      buildCandidate(input, classifyMemoryKind(entry), entry.content),
    );
    const createdCandidates: MemoryCandidate[] = [];
    const deniedCandidates: MemoryCandidate[] = [];
    for (const candidate of dedupeCandidates(candidates)) {
      if (hasBlockingMemorySafetyFinding(candidate.safetyFindings)) {
        const denied: MemoryCandidate = {
          ...candidate,
          status: "rejected",
          reviewReason: "blocked_by_safety_filter",
          reviewedAt: candidate.updatedAt,
        };
        await this.recordDeniedCandidate(input, denied);
        deniedCandidates.push(denied);
        continue;
      }
      await this.store.createMemoryCandidate(candidate);
      await this.store.recordAuditEvent({
        id: makeId<"ArtifactId">("audit"),
        type: "memory.candidate_created",
        actor: input.actor,
        sessionId: input.sourceSessionId,
        summary: `Memory candidate created: ${candidate.kind}`,
        metadata: {
          candidateId: candidate.id,
          scopeType: candidate.scopeType,
          scopeId: candidate.scopeId,
          kind: candidate.kind,
          confidence: candidate.confidence,
          safetyFindingCount: candidate.safetyFindings.length,
        },
        artifactRefs: [],
        createdAt: candidate.createdAt,
      });
      createdCandidates.push(candidate);
    }
    return { createdCandidates, deniedCandidates };
  }

  async extractFromSessionSummary(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
    return this.extractFromText(input);
  }

  private async recordDeniedCandidate(input: MemoryExtractionInput, candidate: MemoryCandidate): Promise<void> {
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "memory.candidate_denied",
      actor: input.actor,
      sessionId: input.sourceSessionId,
      summary: `Memory candidate denied: ${candidate.kind}`,
      metadata: {
        scopeType: candidate.scopeType,
        scopeId: candidate.scopeId,
        kind: candidate.kind,
        reason: candidate.reviewReason,
        safetyFindings: candidate.safetyFindings.map((finding) => ({
          rule: finding.rule,
          severity: finding.severity,
        })),
      },
      artifactRefs: [],
      createdAt: candidate.createdAt,
    });
  }
}

function extractCandidateSentences(text: string): ExtractedCandidateText[] {
  return text
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((part) => part.trim().replace(/^[-*]\s+/, ""))
    .map((part): ExtractedCandidateText | undefined => {
      const snapshot = /^\[([a-z_]+)\]\s+(.+?)(?:\s+\(id:\s+[^)]*\))?$/i.exec(part);
      if (snapshot) {
        const kind = parseMemoryKind(snapshot[1]);
        const content = snapshot[2]?.trim() ?? "";
        return kind && content.length >= 16 ? { content, kind } : undefined;
      }
      const match = /^(remember|note|decision|preference|do not|never|always|this project|we use)\b[:\s-]*/i.exec(part);
      if (!match) {
        return undefined;
      }
      const marker = match[1].toLowerCase();
      const content = part.replace(/^(remember|note|decision|preference)[:\s-]+/i, "").trim();
      return content.length >= 16 ? { content, marker } : undefined;
    })
    .filter((entry): entry is ExtractedCandidateText => entry !== undefined);
}

function classifyMemoryKind(entry: ExtractedCandidateText): MemoryKind {
  if (entry.kind) {
    return entry.kind;
  }
  const sentence = entry.content;
  if (/^(do not|never)\b/i.test(sentence) || entry.marker === "do not" || entry.marker === "never") {
    return "do_not_do";
  }
  if (entry.marker === "decision" || /\b(decided|decision)\b/i.test(sentence)) {
    return "decision";
  }
  if (entry.marker === "preference" || /\b(prefer|preference|likes?)\b/i.test(sentence)) {
    return "preference";
  }
  if (/\b(workflow|command|gate)\b/i.test(sentence)) {
    return "workflow";
  }
  return "project_fact";
}

function parseMemoryKind(value: string | undefined): MemoryKind | undefined {
  const kinds: MemoryKind[] = ["preference", "project_fact", "architecture_note", "decision", "bug_pattern", "workflow", "credential_reference", "do_not_do"];
  return kinds.includes(value as MemoryKind) ? value as MemoryKind : undefined;
}

function buildCandidate(input: MemoryExtractionInput, kind: MemoryKind, content: string): MemoryCandidate {
  const now = new Date().toISOString();
  return {
    id: makeId<"ArtifactId">("mcand"),
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    kind,
    proposedContent: content,
    proposedSummary: summarize(content),
    sourceSessionId: input.sourceSessionId,
    sourceSummaryId: input.sourceSummaryId,
    confidence: 0.7,
    status: "pending",
    safetyFindings: scanMemorySafety(content),
    createdBy: input.actor,
    createdAt: now,
    updatedAt: now,
  };
}

function dedupeCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.scopeType}:${candidate.scopeId}:${candidate.kind}:${candidate.proposedSummary.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function summarize(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
}

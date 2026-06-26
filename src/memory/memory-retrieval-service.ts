import type { ActorRef, MemoryRecord, MemoryRetrievalResult, MemoryScope, MemorySafetyFinding } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore } from "../store/agent-store.js";
import { hasBlockingMemorySafetyFinding, scanMemorySafety } from "./memory-safety.js";

export type MemorySafetyMode = "off" | "annotate" | "exclude";

export type MemorySearchInput = {
  query: string;
  scopeType?: MemoryScope;
  scopeId?: string;
  actor?: ActorRef;
  sessionId?: string;
  limit?: number;
  enforceAccess?: boolean;
  safetyMode?: MemorySafetyMode;
  now?: string;
};

export type MemoryEvalCase = {
  id: string;
  query: string;
  scopeType?: MemoryScope;
  scopeId?: string;
  expectedMemoryIds?: string[];
  forbiddenMemoryIds?: string[];
};

export type MemoryEvalInput = {
  cases: MemoryEvalCase[];
  actor?: ActorRef;
  enforceAccess?: boolean;
  safetyMode?: MemorySafetyMode;
  limit?: number;
  thresholds?: {
    minRecallAtK?: number;
    maxEmptyResultRate?: number;
    maxPermissionLeakRate?: number;
  };
};

export type MemoryEvalResult = {
  caseCount: number;
  metrics: {
    recallAtK: number;
    emptyResultRate: number;
    permissionLeakCount: number;
    permissionLeakRate: number;
  };
  gate: { passed: boolean; failures: string[] };
  cases: Array<{
    id: string;
    resultMemoryIds: string[];
    hit: boolean;
    emptyResult: boolean;
    permissionLeakCount: number;
  }>;
};

export class MemoryRetrievalService {
  constructor(private readonly store: AgentStore) {}

  async search(input: MemorySearchInput): Promise<MemoryRetrievalResult[]> {
    if (!input.query.trim()) {
      return [];
    }
    const now = input.now ?? new Date().toISOString();
    const terms = tokenize(input.query);
    const memories = await this.store.listMemories(input.scopeType, input.scopeId);
    const scored: MemoryRetrievalResult[] = [];
    for (const memory of memories) {
      if (isExpired(memory, now)) {
        continue;
      }
      if (input.enforceAccess && !(await this.canReadMemory(input.actor, memory))) {
        continue;
      }
      const safetyFindings = input.safetyMode === "off" ? [] : scanMemorySafety(`${memory.summary}\n${memory.content}`);
      if (input.safetyMode === "exclude" && hasBlockingMemorySafetyFinding(safetyFindings)) {
        continue;
      }
      const score = scoreMemory(memory, terms, now);
      if (score <= 0) {
        continue;
      }
      scored.push({
        memory,
        score,
        citationId: `M:${memory.id}`,
        safetyFindings,
        reason: "keyword_recency_confidence",
      });
    }
    const results = scored
      .sort((left, right) => right.score - left.score || right.memory.updatedAt.localeCompare(left.memory.updatedAt))
      .slice(0, input.limit ?? 8);
    for (const result of results) {
      await this.store.touchMemory(result.memory.id, now);
      await this.store.recordMemoryUsage({
        id: makeId<"ArtifactId">("muse"),
        memoryId: result.memory.id,
        actor: input.actor ?? { type: "system", id: "memory-retrieval" },
        sessionId: input.sessionId,
        reason: "retrieved",
        query: input.query,
        score: result.score,
        createdAt: now,
      });
    }
    if (input.actor) {
      await this.store.recordAuditEvent({
        id: makeId<"ArtifactId">("audit"),
        type: "memory.retrieved",
        actor: input.actor,
        sessionId: input.sessionId,
        summary: `Memory retrieval: ${results.length} result(s)`,
        metadata: {
          query: input.query,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          resultCount: results.length,
          memoryIds: results.map((result) => result.memory.id),
          enforceAccess: Boolean(input.enforceAccess),
          safetyMode: input.safetyMode ?? "annotate",
        },
        artifactRefs: [],
        createdAt: now,
      });
    }
    return results;
  }

  async evaluate(input: MemoryEvalInput): Promise<MemoryEvalResult> {
    if (input.cases.length === 0) {
      throw new Error("Memory eval requires at least one case.");
    }
    const cases: MemoryEvalResult["cases"] = [];
    for (const evalCase of input.cases) {
      const results = await this.search({
        query: evalCase.query,
        scopeType: evalCase.scopeType,
        scopeId: evalCase.scopeId,
        actor: input.actor,
        enforceAccess: input.enforceAccess,
        safetyMode: input.safetyMode,
        limit: input.limit ?? 10,
      });
      const resultMemoryIds = results.map((result) => result.memory.id);
      const expectedMemoryIds = evalCase.expectedMemoryIds ?? [];
      const forbiddenMemoryIds = evalCase.forbiddenMemoryIds ?? [];
      const hit = expectedMemoryIds.length === 0 || expectedMemoryIds.some((memoryId) => resultMemoryIds.includes(memoryId));
      const permissionLeakCount = forbiddenMemoryIds.filter((memoryId) => resultMemoryIds.includes(memoryId)).length;
      cases.push({
        id: evalCase.id,
        resultMemoryIds,
        hit,
        emptyResult: resultMemoryIds.length === 0,
        permissionLeakCount,
      });
    }
    const permissionLeakCount = cases.reduce((sum, item) => sum + item.permissionLeakCount, 0);
    const metrics = {
      recallAtK: average(cases.map((item) => (item.hit ? 1 : 0))),
      emptyResultRate: average(cases.map((item) => (item.emptyResult ? 1 : 0))),
      permissionLeakCount,
      permissionLeakRate: average(cases.map((item) => (item.permissionLeakCount > 0 ? 1 : 0))),
    };
    const failures = evaluateMemoryGate(metrics, input.thresholds ?? {});
    return {
      caseCount: cases.length,
      metrics,
      gate: { passed: failures.length === 0, failures },
      cases,
    };
  }

  private async canReadMemory(actor: ActorRef | undefined, memory: MemoryRecord): Promise<boolean> {
    if (!actor) {
      return false;
    }
    if (memory.scopeType === "user") {
      return actor.type === "user" && actor.id === memory.scopeId;
    }
    if (memory.scopeType === "agent") {
      return actor.type === "agent" && actor.id === memory.scopeId;
    }
    if (memory.scopeType === "room") {
      return (await this.isActiveRoomMember(memory.scopeId, actor)) || (await this.hasKnowledgeRead(actor, "room", memory.scopeId));
    }
    if (memory.scopeType === "project") {
      return memory.scopeId === "local" || (await this.hasKnowledgeRead(actor, "project", memory.scopeId));
    }
    if (memory.scopeType === "organization") {
      return this.hasKnowledgeRead(actor, "organization", memory.scopeId);
    }
    if (memory.scopeType === "repository") {
      return memory.scopeId === "local" || (await this.hasKnowledgeRead(actor, "project", memory.scopeId));
    }
    return false;
  }

  private async isActiveRoomMember(roomId: string, actor: ActorRef): Promise<boolean> {
    const members = await this.store.listRoomMembers(roomId);
    return members.some((member) => member.status === "active" && member.actor.type === actor.type && member.actor.id === actor.id);
  }

  private async hasKnowledgeRead(actor: ActorRef, scopeType: "organization" | "project" | "room", scopeId: string): Promise<boolean> {
    if (actor.type !== "user" && actor.type !== "agent" && actor.type !== "service_account") {
      return false;
    }
    const grants = await this.store.listCapabilityGrants({
      subjectType: actor.type,
      subjectId: actor.id,
      scopeType,
      scopeId,
    });
    return grants.some((grant) => grant.capability === "knowledge.read");
  }
}

function scoreMemory(memory: MemoryRecord, terms: string[], now: string): number {
  const text = `${memory.summary}\n${memory.content}`.toLowerCase();
  let keywordScore = 0;
  for (const term of terms) {
    keywordScore += countOccurrences(text, term);
  }
  if (keywordScore === 0) {
    return 0;
  }
  const confidence = Math.max(0.1, memory.confidence);
  const ageDays = Math.max(0, (Date.parse(now) - Date.parse(memory.updatedAt)) / 86_400_000);
  const recency = 1 / (1 + ageDays / 30);
  const kindBoost = memory.kind === "do_not_do" ? 1.25 : memory.kind === "decision" ? 1.1 : 1;
  return keywordScore * confidence * recency * kindBoost;
}

function isExpired(memory: MemoryRecord, now: string): boolean {
  return Boolean(memory.expiresAt && memory.expiresAt <= now);
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])].filter((term) => term.length > 1);
}

function countOccurrences(value: string, term: string): number {
  let count = 0;
  let index = value.indexOf(term);
  while (index >= 0) {
    count += 1;
    index = value.indexOf(term, index + term.length);
  }
  return count;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function evaluateMemoryGate(
  metrics: MemoryEvalResult["metrics"],
  thresholds: NonNullable<MemoryEvalInput["thresholds"]>,
): string[] {
  const failures: string[] = [];
  if (thresholds.minRecallAtK !== undefined && metrics.recallAtK < thresholds.minRecallAtK) {
    failures.push(`recallAtK ${metrics.recallAtK.toFixed(3)} < ${thresholds.minRecallAtK.toFixed(3)}`);
  }
  if (thresholds.maxEmptyResultRate !== undefined && metrics.emptyResultRate > thresholds.maxEmptyResultRate) {
    failures.push(`emptyResultRate ${metrics.emptyResultRate.toFixed(3)} > ${thresholds.maxEmptyResultRate.toFixed(3)}`);
  }
  if (thresholds.maxPermissionLeakRate !== undefined && metrics.permissionLeakRate > thresholds.maxPermissionLeakRate) {
    failures.push(`permissionLeakRate ${metrics.permissionLeakRate.toFixed(3)} > ${thresholds.maxPermissionLeakRate.toFixed(3)}`);
  }
  if (metrics.permissionLeakCount > 0) {
    failures.push(`permissionLeakCount ${metrics.permissionLeakCount} > 0`);
  }
  return failures;
}

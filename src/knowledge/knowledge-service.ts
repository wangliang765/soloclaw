import { createHash } from "node:crypto";
import type {
  ActorRef,
  ArtifactRecord,
  KnowledgeChunk,
  KnowledgeEvalCaseDefinition,
  KnowledgeEvalRun,
  KnowledgeEvalSet,
  KnowledgeSource,
  KnowledgeSourceKind,
  KnowledgeTrustLevel,
  MemoryScope,
} from "../domain/index.js";
import { makeId } from "../domain/common.js";
import { OrganizationService } from "../organizations/organization-service.js";
import type { AgentStore } from "../store/agent-store.js";
import { LocalKeywordSearchAdapter } from "./local-keyword-search-adapter.js";
import type { SearchAdapter, SearchAdapterMode, SearchDocument } from "./search-adapter.js";

export type AddKnowledgeSourceInput = {
  scopeType: MemoryScope;
  scopeId: string;
  kind: KnowledgeSourceKind;
  name: string;
  uri?: string;
  description?: string;
  trustLevel?: KnowledgeTrustLevel;
  actor: ActorRef;
  metadata?: Record<string, unknown>;
};

export type IngestTextInput = AddKnowledgeSourceInput & {
  content: string;
  chunkSize?: number;
  overlap?: number;
};

export type KnowledgeSearchInput = {
  query: string;
  scopeType?: MemoryScope;
  scopeId?: string;
  sourceId?: string;
  limit?: number;
  mode?: SearchAdapterMode;
  actor?: ActorRef;
  enforceAccess?: boolean;
  safetyMode?: KnowledgeSafetyMode;
};

export type KnowledgeSafetyMode = "off" | "annotate" | "exclude";
export type KnowledgeSafetyFinding = {
  rule: string;
  severity: "medium" | "high";
  reason: string;
};

export type KnowledgeSearchResult = {
  chunk: KnowledgeChunk;
  source?: KnowledgeSource;
  citationId: string;
  score: number;
  snippet: string;
  safetyFindings: KnowledgeSafetyFinding[];
};

export type KnowledgeEvalCase = KnowledgeEvalCaseDefinition;

export type KnowledgeEvalInput = {
  cases?: KnowledgeEvalCase[];
  evalSetId?: string;
  scopeType?: MemoryScope;
  scopeId?: string;
  sourceId?: string;
  limit?: number;
  actor?: ActorRef;
  enforceAccess?: boolean;
  safetyMode?: KnowledgeSafetyMode;
  thresholds?: KnowledgeEvalThresholds;
  saveArtifact?: boolean;
  artifactName?: string;
  saveRun?: boolean;
  runMetadata?: Record<string, unknown>;
};

export type KnowledgeEvalThresholds = {
  minRecallAtK?: number;
  minMrr?: number;
  maxEmptyResultRate?: number;
  minCitationPrecision?: number;
  maxPermissionLeakRate?: number;
};

export type KnowledgeEvalCaseResult = {
  id: string;
  query: string;
  expectedSourceIds: string[];
  expectedChunkIds: string[];
  forbiddenSourceIds: string[];
  forbiddenChunkIds: string[];
  resultSourceIds: string[];
  resultChunkIds: string[];
  hitRank?: number;
  reciprocalRank: number;
  citationPrecision: number;
  permissionLeakCount: number;
  permissionLeak: boolean;
  emptyResult: boolean;
};

export type KnowledgeEvalResult = {
  generatedAt: string;
  caseCount: number;
  limit: number;
  metrics: {
    recallAtK: number;
    mrr: number;
    emptyResultRate: number;
    citationPrecision: number;
    permissionLeakRate: number;
    permissionLeakCount: number;
  };
  gate: {
    passed: boolean;
    thresholds: KnowledgeEvalThresholds;
    failures: string[];
  };
  cases: KnowledgeEvalCaseResult[];
  artifact?: ArtifactRecord;
  run?: KnowledgeEvalRun;
};

export type CreateKnowledgeEvalSetInput = {
  name: string;
  description?: string;
  scopeType?: MemoryScope;
  scopeId?: string;
  sourceId?: string;
  cases: KnowledgeEvalCase[];
  thresholds?: KnowledgeEvalThresholds;
  actor: ActorRef;
  metadata?: Record<string, unknown>;
};

export type KnowledgeEvalTrendInput = {
  evalSetId?: string;
  scopeType?: MemoryScope;
  scopeId?: string;
  sourceId?: string;
  limit?: number;
  regressionTolerance?: number;
  actor?: ActorRef;
  saveArtifact?: boolean;
  artifactName?: string;
};

export type KnowledgeEvalTrendResult = {
  runCount: number;
  passCount: number;
  failCount: number;
  passRate: number;
  latest?: KnowledgeEvalRun;
  previous?: KnowledgeEvalRun;
  deltas?: {
    recallAtK: number;
    mrr: number;
    emptyResultRate: number;
    citationPrecision: number;
    permissionLeakRate: number;
    permissionLeakCount: number;
  };
  regression: {
    detected: boolean;
    reasons: string[];
  };
  artifact?: ArtifactRecord;
};

export class KnowledgeService {
  private readonly organizations: OrganizationService;
  private readonly searchAdapter: SearchAdapter;

  constructor(private readonly store: AgentStore, searchAdapter?: SearchAdapter) {
    this.organizations = new OrganizationService(store);
    this.searchAdapter = searchAdapter ?? new LocalKeywordSearchAdapter();
  }

  async addSource(input: AddKnowledgeSourceInput): Promise<KnowledgeSource> {
    const now = new Date().toISOString();
    const source: KnowledgeSource = {
      id: makeId<"KnowledgeSourceId">("ksrc"),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      kind: input.kind,
      name: input.name,
      uri: input.uri,
      description: input.description,
      trustLevel: input.trustLevel ?? "untrusted",
      createdBy: input.actor,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.createKnowledgeSource(source);
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "knowledge.source_added",
      actor: input.actor,
      summary: `Knowledge source added: ${source.name}`,
      metadata: { sourceId: source.id, scopeType: source.scopeType, scopeId: source.scopeId, kind: source.kind },
      createdAt: now,
    });
    return source;
  }

  async ingestText(input: IngestTextInput): Promise<{ source: KnowledgeSource; chunks: KnowledgeChunk[] }> {
    const source = await this.addSource(input);
    const pieces = chunkText(input.content, input.chunkSize ?? 1600, input.overlap ?? 160);
    const now = new Date().toISOString();
    const chunks: KnowledgeChunk[] = pieces.map((piece, index) => ({
      id: makeId<"ArtifactId">("kchk"),
      sourceId: source.id,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      content: piece,
      summary: summarize(piece),
      ordinal: index,
      tokenCount: estimateTokens(piece),
      contentHash: sha256(piece),
      metadata: { sourceKind: source.kind },
      createdAt: now,
      updatedAt: now,
    }));

    for (const chunk of chunks) {
      await this.store.upsertKnowledgeChunk(chunk);
    }
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "knowledge.chunk_indexed",
      actor: input.actor,
      summary: `Indexed ${chunks.length} knowledge chunks from ${source.name}`,
      metadata: { sourceId: source.id, chunkCount: chunks.length },
      createdAt: now,
    });
    return { source, chunks };
  }

  async listSources(input: { scopeType?: MemoryScope; scopeId?: string; kind?: KnowledgeSourceKind; limit?: number } = {}): Promise<KnowledgeSource[]> {
    return this.store.listKnowledgeSources(input);
  }

  async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]> {
    if (!input.query.trim()) {
      return [];
    }
    const chunks = await this.store.listKnowledgeChunks({
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      sourceId: input.sourceId,
      limit: 5000,
    });
    const sources = new Map<string, KnowledgeSource>();
    const documents: SearchDocument[] = [];
    let filteredByAcl = 0;
    const safetyMode = input.safetyMode ?? "annotate";
    for (const chunk of chunks) {
      let source = sources.get(chunk.sourceId);
      if (!source) {
        source = await this.store.getKnowledgeSource(chunk.sourceId);
        if (source) {
          sources.set(chunk.sourceId, source);
        }
      }
      if (input.enforceAccess && !(await this.canReadSource(input.actor, source, chunk))) {
        filteredByAcl += 1;
        continue;
      }
      documents.push({ chunk, source });
    }

    await this.searchAdapter.index({ documents });
    const searchOutput = await this.searchAdapter.search({
      ...input,
      mode: input.mode ?? "keyword",
      safetyMode,
    });
    const results = searchOutput.results.map((result) => ({ ...result, citationId: knowledgeCitationId(result.chunk) }));
    if (input.actor) {
      await this.store.recordAuditEvent({
        id: makeId<"ArtifactId">("audit"),
        type: "knowledge.searched",
        actor: input.actor,
        summary: `Knowledge searched: ${input.query}`,
        metadata: {
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          resultCount: results.length,
          enforceAccess: Boolean(input.enforceAccess),
          filteredByAcl,
          safetyMode,
          unsafeCandidateCount: searchOutput.diagnostics.unsafeCandidateCount,
          filteredBySafety: searchOutput.diagnostics.filteredBySafety,
          searchMode: input.mode ?? "keyword",
        },
        createdAt: new Date().toISOString(),
      });
    }
    return results;
  }

  async createEvalSet(input: CreateKnowledgeEvalSetInput): Promise<KnowledgeEvalSet> {
    if (!input.name.trim()) {
      throw new Error("Knowledge eval set name is required.");
    }
    validateEvalCases(input.cases);
    const now = new Date().toISOString();
    const evalSet: KnowledgeEvalSet = {
      id: makeId<"ArtifactId">("kevalset"),
      name: input.name.trim(),
      description: input.description,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      sourceId: input.sourceId,
      cases: input.cases,
      thresholds: input.thresholds,
      createdBy: input.actor,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.createKnowledgeEvalSet(evalSet);
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "knowledge.eval_set_created",
      actor: input.actor,
      summary: `Knowledge eval set created: ${evalSet.name}`,
      metadata: {
        evalSetId: evalSet.id,
        scopeType: evalSet.scopeType,
        scopeId: evalSet.scopeId,
        sourceId: evalSet.sourceId,
        caseCount: evalSet.cases.length,
      },
      createdAt: now,
    });
    return evalSet;
  }

  async listEvalSets(input: Parameters<AgentStore["listKnowledgeEvalSets"]>[0] = {}): Promise<KnowledgeEvalSet[]> {
    return this.store.listKnowledgeEvalSets(input);
  }

  async listEvalRuns(input: Parameters<AgentStore["listKnowledgeEvalRuns"]>[0] = {}): Promise<KnowledgeEvalRun[]> {
    return this.store.listKnowledgeEvalRuns(input);
  }

  async summarizeEvalTrend(input: KnowledgeEvalTrendInput = {}): Promise<KnowledgeEvalTrendResult> {
    const evalSet = input.evalSetId ? await this.store.getKnowledgeEvalSet(input.evalSetId) : undefined;
    if (input.evalSetId && !evalSet) {
      throw new Error(`Knowledge eval set not found: ${input.evalSetId}`);
    }
    const effectiveScopeType = input.scopeType ?? evalSet?.scopeType;
    const effectiveScopeId = input.scopeId ?? evalSet?.scopeId;
    const effectiveSourceId = input.sourceId ?? evalSet?.sourceId;
    const runs = await this.store.listKnowledgeEvalRuns({
      evalSetId: input.evalSetId,
      scopeType: effectiveScopeType,
      scopeId: effectiveScopeId,
      sourceId: effectiveSourceId,
      limit: input.limit ?? 20,
    });
    const latest = runs[0];
    const previous = runs[1];
    const passCount = runs.filter((run) => run.gate.passed).length;
    const deltas = latest && previous
      ? {
        recallAtK: latest.metrics.recallAtK - previous.metrics.recallAtK,
        mrr: latest.metrics.mrr - previous.metrics.mrr,
        emptyResultRate: latest.metrics.emptyResultRate - previous.metrics.emptyResultRate,
        citationPrecision: latest.metrics.citationPrecision - previous.metrics.citationPrecision,
        permissionLeakRate: latest.metrics.permissionLeakRate - previous.metrics.permissionLeakRate,
        permissionLeakCount: latest.metrics.permissionLeakCount - previous.metrics.permissionLeakCount,
      }
      : undefined;
    const regression = detectEvalRegression(latest, previous, deltas, input.regressionTolerance ?? 0.001);
    let trend: KnowledgeEvalTrendResult = {
      runCount: runs.length,
      passCount,
      failCount: runs.length - passCount,
      passRate: runs.length === 0 ? 0 : passCount / runs.length,
      latest,
      previous,
      deltas,
      regression,
    };
    if (input.saveArtifact) {
      if (!input.actor) {
        throw new Error("Knowledge eval trend artifact requires an actor.");
      }
      const generatedAt = new Date().toISOString();
      const payload = JSON.stringify({
        generatedAt,
        evalSetId: evalSet?.id,
        scopeType: effectiveScopeType,
        scopeId: effectiveScopeId,
        sourceId: effectiveSourceId,
        limit: input.limit ?? 20,
        regressionTolerance: input.regressionTolerance ?? 0.001,
        trend,
      }, null, 2);
      const artifact: ArtifactRecord = {
        id: makeId<"ArtifactId">("art"),
        kind: "report",
        name: input.artifactName?.trim() || `Knowledge eval trend ${generatedAt}`,
        mimeType: "application/vnd.agent.knowledge-eval-trend+json",
        sizeBytes: Buffer.byteLength(payload, "utf8"),
        sha256: sha256(payload),
        ...artifactScope(effectiveScopeType, effectiveScopeId),
        createdBy: input.actor,
        status: "active",
        createdAt: generatedAt,
        metadata: {
          type: "knowledge.eval_trend",
          evalSetId: evalSet?.id,
          scopeType: effectiveScopeType,
          scopeId: effectiveScopeId,
          sourceId: effectiveSourceId,
          limit: input.limit ?? 20,
          regressionTolerance: input.regressionTolerance ?? 0.001,
          trend,
        },
      };
      await this.store.createArtifact(artifact);
      await this.store.recordAuditEvent({
        id: makeId<"ArtifactId">("audit"),
        type: "knowledge.eval_trend_report_created",
        actor: input.actor,
        summary: `Knowledge eval trend report: ${trend.runCount} runs`,
        metadata: {
          evalSetId: evalSet?.id,
          scopeType: effectiveScopeType,
          scopeId: effectiveScopeId,
          sourceId: effectiveSourceId,
          artifactId: artifact.id,
          runCount: trend.runCount,
          passRate: trend.passRate,
          regression: trend.regression,
        },
        artifactRefs: [artifact.id],
        createdAt: generatedAt,
      });
      trend = { ...trend, artifact };
    }
    return trend;
  }

  async evaluate(input: KnowledgeEvalInput): Promise<KnowledgeEvalResult> {
    const limit = input.limit ?? 10;
    const evalSet = input.evalSetId ? await this.store.getKnowledgeEvalSet(input.evalSetId) : undefined;
    if (input.evalSetId && !evalSet) {
      throw new Error(`Knowledge eval set not found: ${input.evalSetId}`);
    }
    const evalCases = input.cases ?? evalSet?.cases ?? [];
    if (evalCases.length === 0) {
      throw new Error("Knowledge eval requires at least one case.");
    }
    validateEvalCases(evalCases);
    const thresholds = { ...(evalSet?.thresholds ?? {}), ...(input.thresholds ?? {}) };
    const effectiveScopeType = input.scopeType ?? evalSet?.scopeType;
    const effectiveScopeId = input.scopeId ?? evalSet?.scopeId;
    const effectiveSourceId = input.sourceId ?? evalSet?.sourceId;
    const caseResults: KnowledgeEvalCaseResult[] = [];
    for (const [index, evalCase] of evalCases.entries()) {
      if (!evalCase.query.trim()) {
        throw new Error(`Knowledge eval case ${evalCase.id ?? index + 1} has an empty query.`);
      }
      const expectedSourceIds = [...new Set(evalCase.expectedSourceIds ?? [])].filter(Boolean);
      const expectedChunkIds = [...new Set(evalCase.expectedChunkIds ?? [])].filter(Boolean);
      const forbiddenSourceIds = [...new Set(evalCase.forbiddenSourceIds ?? [])].filter(Boolean);
      const forbiddenChunkIds = [...new Set(evalCase.forbiddenChunkIds ?? [])].filter(Boolean);
      if (expectedSourceIds.length === 0 && expectedChunkIds.length === 0 && forbiddenSourceIds.length === 0 && forbiddenChunkIds.length === 0) {
        throw new Error(`Knowledge eval case ${evalCase.id ?? index + 1} must include expectedSourceIds, expectedChunkIds, forbiddenSourceIds, or forbiddenChunkIds.`);
      }
      const results = await this.search({
        query: evalCase.query,
        scopeType: evalCase.scopeType ?? effectiveScopeType,
        scopeId: evalCase.scopeId ?? effectiveScopeId,
        sourceId: evalCase.sourceId ?? effectiveSourceId,
        limit,
        actor: input.enforceAccess ? input.actor : undefined,
        enforceAccess: input.enforceAccess,
        safetyMode: input.safetyMode,
      });
      const hitIndex = results.findIndex((result) => {
        return expectedChunkIds.includes(result.chunk.id) || expectedSourceIds.includes(result.chunk.sourceId);
      });
      const relevantResultCount = results.filter((result) => {
        return expectedChunkIds.includes(result.chunk.id) || expectedSourceIds.includes(result.chunk.sourceId);
      }).length;
      const permissionLeakCount = results.filter((result) => {
        return forbiddenChunkIds.includes(result.chunk.id) || forbiddenSourceIds.includes(result.chunk.sourceId);
      }).length;
      caseResults.push({
        id: evalCase.id ?? `case_${index + 1}`,
        query: evalCase.query,
        expectedSourceIds,
        expectedChunkIds,
        forbiddenSourceIds,
        forbiddenChunkIds,
        resultSourceIds: results.map((result) => result.chunk.sourceId),
        resultChunkIds: results.map((result) => result.chunk.id),
        hitRank: hitIndex >= 0 ? hitIndex + 1 : undefined,
        reciprocalRank: hitIndex >= 0 ? 1 / (hitIndex + 1) : 0,
        citationPrecision: results.length === 0 ? 1 : relevantResultCount / results.length,
        permissionLeakCount,
        permissionLeak: permissionLeakCount > 0,
        emptyResult: results.length === 0,
      });
    }
    const permissionLeakCount = caseResults.reduce((sum, caseResult) => sum + caseResult.permissionLeakCount, 0);
    const metrics = {
      recallAtK: average(caseResults.map((caseResult) => (caseResult.hitRank ? 1 : 0))),
      mrr: average(caseResults.map((caseResult) => caseResult.reciprocalRank)),
      emptyResultRate: average(caseResults.map((caseResult) => (caseResult.emptyResult ? 1 : 0))),
      citationPrecision: average(caseResults.map((caseResult) => caseResult.citationPrecision)),
      permissionLeakRate: average(caseResults.map((caseResult) => (caseResult.permissionLeak ? 1 : 0))),
      permissionLeakCount,
    };
    const gate = evaluateGate(metrics, thresholds);
    let result: KnowledgeEvalResult = {
      generatedAt: new Date().toISOString(),
      caseCount: caseResults.length,
      limit,
      metrics,
      gate,
      cases: caseResults,
    };
    if (input.saveArtifact) {
      if (!input.actor) {
        throw new Error("Knowledge eval artifact requires an actor.");
      }
      const payload = JSON.stringify(result, null, 2);
      const artifact: ArtifactRecord = {
        id: makeId<"ArtifactId">("art"),
        kind: "report",
        name: input.artifactName?.trim() || `Knowledge eval ${result.generatedAt}`,
        mimeType: "application/vnd.agent.knowledge-eval+json",
        sizeBytes: Buffer.byteLength(payload, "utf8"),
        sha256: sha256(payload),
        ...artifactScope(effectiveScopeType, effectiveScopeId),
        createdBy: input.actor,
        status: "active",
        createdAt: result.generatedAt,
        metadata: {
          type: "knowledge.eval_run",
          evalSetId: evalSet?.id,
          scopeType: effectiveScopeType,
          scopeId: effectiveScopeId,
          sourceId: effectiveSourceId,
          enforceAccess: Boolean(input.enforceAccess),
          safetyMode: input.safetyMode ?? "annotate",
          caseCount: result.caseCount,
          limit: result.limit,
          metrics: result.metrics,
          gate: result.gate,
          result,
        },
      };
      await this.store.createArtifact(artifact);
      result = { ...result, artifact };
    }
    if (input.saveRun) {
      if (!input.actor) {
        throw new Error("Knowledge eval run persistence requires an actor.");
      }
      const run: KnowledgeEvalRun = {
        id: makeId<"ArtifactId">("kevalrun"),
        evalSetId: evalSet?.id,
        scopeType: effectiveScopeType,
        scopeId: effectiveScopeId,
        sourceId: effectiveSourceId,
        caseCount: result.caseCount,
        limit: result.limit,
        metrics: result.metrics,
        gate: result.gate,
        cases: result.cases.map((item) => ({ ...item })),
        enforceAccess: Boolean(input.enforceAccess),
        safetyMode: input.safetyMode ?? "annotate",
        artifactId: result.artifact?.id,
        createdBy: input.actor,
        metadata: input.runMetadata,
        createdAt: result.generatedAt,
      };
      await this.store.createKnowledgeEvalRun(run);
      result = { ...result, run };
    }
    if (input.actor) {
      await this.store.recordAuditEvent({
        id: makeId<"ArtifactId">("audit"),
        type: "knowledge.eval_run",
        actor: input.actor,
        summary: `Knowledge eval run: ${result.caseCount} cases`,
        metadata: {
          caseCount: result.caseCount,
          limit: result.limit,
          metrics: result.metrics,
          gate: result.gate,
          evalSetId: evalSet?.id,
          runId: result.run?.id,
          scopeType: effectiveScopeType,
          scopeId: effectiveScopeId,
          sourceId: effectiveSourceId,
          enforceAccess: Boolean(input.enforceAccess),
          safetyMode: input.safetyMode ?? "annotate",
          artifactId: result.artifact?.id,
        },
        artifactRefs: result.artifact ? [result.artifact.id] : [],
        createdAt: result.generatedAt,
      });
    }
    return result;
  }

  private async canReadSource(actor: ActorRef | undefined, source: KnowledgeSource | undefined, chunk: KnowledgeChunk): Promise<boolean> {
    if (!actor || !source) {
      return false;
    }

    const scopeType = source.scopeType ?? chunk.scopeType;
    const scopeId = source.scopeId ?? chunk.scopeId;
    if (scopeType === "user") {
      return actor.type === "user" && actor.id === scopeId;
    }
    if (scopeType === "agent") {
      return actor.type === "agent" && actor.id === scopeId;
    }
    if (scopeType === "room") {
      return (await this.isActiveRoomMember(scopeId, actor)) || (await this.hasKnowledgeCapability(actor, "room", scopeId));
    }
    if (scopeType === "project") {
      return this.hasKnowledgeCapability(actor, "project", scopeId);
    }
    if (scopeType === "organization") {
      return this.hasKnowledgeCapability(actor, "organization", scopeId);
    }
    if (scopeType === "repository") {
      const projectId = stringMetadata(source.metadata, "projectId");
      return projectId ? this.hasKnowledgeCapability(actor, "project", projectId) : false;
    }
    return false;
  }

  private async isActiveRoomMember(roomId: string, actor: ActorRef): Promise<boolean> {
    const members = await this.store.listRoomMembers(roomId);
    return members.some((member) => member.status === "active" && member.actor.type === actor.type && member.actor.id === actor.id);
  }

  private async hasKnowledgeCapability(actor: ActorRef, scopeType: "organization" | "project" | "room", scopeId: string): Promise<boolean> {
    const subject = subjectForActor(actor);
    if (!subject) {
      return false;
    }
    return this.organizations.hasCapability({
      ...subject,
      scopeType,
      scopeId,
      capability: "knowledge.read",
    });
  }
}

function subjectForActor(actor: ActorRef): { subjectType: "user" | "agent" | "service_account"; subjectId: string } | undefined {
  if (actor.type === "user" || actor.type === "agent" || actor.type === "service_account") {
    return { subjectType: actor.type, subjectId: actor.id };
  }
  return undefined;
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function validateEvalCases(cases: KnowledgeEvalCase[]): void {
  for (const [index, evalCase] of cases.entries()) {
    if (!evalCase.query.trim()) {
      throw new Error(`Knowledge eval case ${evalCase.id ?? index + 1} has an empty query.`);
    }
    const expectedSourceIds = [...new Set(evalCase.expectedSourceIds ?? [])].filter(Boolean);
    const expectedChunkIds = [...new Set(evalCase.expectedChunkIds ?? [])].filter(Boolean);
    const forbiddenSourceIds = [...new Set(evalCase.forbiddenSourceIds ?? [])].filter(Boolean);
    const forbiddenChunkIds = [...new Set(evalCase.forbiddenChunkIds ?? [])].filter(Boolean);
    if (expectedSourceIds.length === 0 && expectedChunkIds.length === 0 && forbiddenSourceIds.length === 0 && forbiddenChunkIds.length === 0) {
      throw new Error(`Knowledge eval case ${evalCase.id ?? index + 1} must include expectedSourceIds, expectedChunkIds, forbiddenSourceIds, or forbiddenChunkIds.`);
    }
  }
}

function detectEvalRegression(
  latest: KnowledgeEvalRun | undefined,
  previous: KnowledgeEvalRun | undefined,
  deltas: KnowledgeEvalTrendResult["deltas"],
  tolerance: number,
): KnowledgeEvalTrendResult["regression"] {
  const reasons: string[] = [];
  if (!latest) {
    return { detected: false, reasons };
  }
  if (!latest.gate.passed) {
    reasons.push("latest gate failed");
  }
  if (previous && previous.gate.passed && !latest.gate.passed) {
    reasons.push("gate changed from passed to failed");
  }
  if (deltas) {
    if (deltas.recallAtK < -tolerance) {
      reasons.push(`recallAtK decreased by ${Math.abs(deltas.recallAtK).toFixed(3)}`);
    }
    if (deltas.mrr < -tolerance) {
      reasons.push(`mrr decreased by ${Math.abs(deltas.mrr).toFixed(3)}`);
    }
    if (deltas.emptyResultRate > tolerance) {
      reasons.push(`emptyResultRate increased by ${deltas.emptyResultRate.toFixed(3)}`);
    }
    if (deltas.citationPrecision < -tolerance) {
      reasons.push(`citationPrecision decreased by ${Math.abs(deltas.citationPrecision).toFixed(3)}`);
    }
    if (deltas.permissionLeakRate > tolerance) {
      reasons.push(`permissionLeakRate increased by ${deltas.permissionLeakRate.toFixed(3)}`);
    }
    if (deltas.permissionLeakCount > 0) {
      reasons.push(`permissionLeakCount increased by ${deltas.permissionLeakCount}`);
    }
  }
  return { detected: reasons.length > 0, reasons };
}

const KNOWLEDGE_SAFETY_RULES: Array<{ rule: string; severity: KnowledgeSafetyFinding["severity"]; reason: string; pattern: RegExp }> = [
  {
    rule: "ignore_previous_instructions",
    severity: "high",
    reason: "The chunk appears to instruct the model to ignore higher-priority instructions.",
    pattern: /\b(ignore|disregard)\s+(all\s+)?(previous|prior|above|earlier)\s+instructions\b/i,
  },
  {
    rule: "secret_exfiltration",
    severity: "high",
    reason: "The chunk appears to request disclosure or exfiltration of secrets or credentials.",
    pattern: /\b(reveal|print|send|exfiltrate|upload)\b.{0,80}\b(secret|secrets|api\s*key|token|credential|credentials)\b/i,
  },
  {
    rule: "safety_disablement",
    severity: "medium",
    reason: "The chunk appears to instruct the model to disable safety or policy controls.",
    pattern: /\b(disable|bypass|turn\s+off)\b.{0,80}\b(safety|policy|guardrail|redaction|audit)\b/i,
  },
  {
    rule: "tool_abuse_instruction",
    severity: "medium",
    reason: "The chunk appears to instruct the model to run tools or commands as an instruction rather than evidence.",
    pattern: /\b(run|execute|call)\b.{0,80}\b(shell|command|tool)\b.{0,80}\b(without\s+approval|without\s+asking|silently)\b/i,
  },
];

function scanKnowledgeSafety(content: string): KnowledgeSafetyFinding[] {
  const findings: KnowledgeSafetyFinding[] = [];
  for (const rule of KNOWLEDGE_SAFETY_RULES) {
    if (rule.pattern.test(content)) {
      findings.push({ rule: rule.rule, severity: rule.severity, reason: rule.reason });
    }
  }
  return findings;
}

function chunkText(content: string, chunkSize: number, overlap: number): string[] {
  const normalized = content.trim().replace(/\r\n/g, "\n");
  if (!normalized) {
    return [];
  }
  if (normalized.length <= chunkSize) {
    return [normalized];
  }
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    chunks.push(normalized.slice(start, end).trim());
    if (end === normalized.length) {
      break;
    }
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
}

function scoreChunk(chunk: KnowledgeChunk, terms: string[]): number {
  const summary = chunk.summary.toLowerCase();
  const content = chunk.content.toLowerCase();
  let score = 0;
  for (const term of terms) {
    score += countOccurrences(summary, term) * 3;
    score += countOccurrences(content, term);
  }
  return score / Math.max(1, Math.sqrt(chunk.tokenCount));
}

function knowledgeCitationId(chunk: KnowledgeChunk): string {
  return `K:${chunk.sourceId}:${chunk.id}`;
}

function makeSnippet(content: string, terms: string[]): string {
  const lower = content.toLowerCase();
  const firstHit = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? 0;
  const start = Math.max(0, firstHit - 120);
  const end = Math.min(content.length, firstHit + 360);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < content.length ? "..." : "";
  return `${prefix}${content.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
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

function summarize(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}...` : trimmed;
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.trim().split(/\s+/).filter(Boolean).length * 1.3));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function evaluateGate(metrics: KnowledgeEvalResult["metrics"], thresholds: KnowledgeEvalThresholds): KnowledgeEvalResult["gate"] {
  const normalized = normalizeThresholds(thresholds);
  const failures: string[] = [];
  if (normalized.minRecallAtK !== undefined && metrics.recallAtK < normalized.minRecallAtK) {
    failures.push(`recallAtK ${metrics.recallAtK.toFixed(3)} < ${normalized.minRecallAtK.toFixed(3)}`);
  }
  if (normalized.minMrr !== undefined && metrics.mrr < normalized.minMrr) {
    failures.push(`mrr ${metrics.mrr.toFixed(3)} < ${normalized.minMrr.toFixed(3)}`);
  }
  if (normalized.maxEmptyResultRate !== undefined && metrics.emptyResultRate > normalized.maxEmptyResultRate) {
    failures.push(`emptyResultRate ${metrics.emptyResultRate.toFixed(3)} > ${normalized.maxEmptyResultRate.toFixed(3)}`);
  }
  if (normalized.minCitationPrecision !== undefined && metrics.citationPrecision < normalized.minCitationPrecision) {
    failures.push(`citationPrecision ${metrics.citationPrecision.toFixed(3)} < ${normalized.minCitationPrecision.toFixed(3)}`);
  }
  if (normalized.maxPermissionLeakRate !== undefined && metrics.permissionLeakRate > normalized.maxPermissionLeakRate) {
    failures.push(`permissionLeakRate ${metrics.permissionLeakRate.toFixed(3)} > ${normalized.maxPermissionLeakRate.toFixed(3)}`);
  }
  if (metrics.permissionLeakCount > 0) {
    failures.push(`permissionLeakCount ${metrics.permissionLeakCount} > 0`);
  }
  return {
    passed: failures.length === 0,
    thresholds: normalized,
    failures,
  };
}

function normalizeThresholds(thresholds: KnowledgeEvalThresholds): KnowledgeEvalThresholds {
  for (const [name, value] of Object.entries(thresholds)) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error(`Knowledge eval threshold ${name} must be between 0 and 1.`);
    }
  }
  return { ...thresholds };
}

function artifactScope(scopeType?: MemoryScope, scopeId?: string): Pick<ArtifactRecord, "orgId" | "projectId" | "roomId"> {
  if (!scopeType || !scopeId) {
    return {};
  }
  if (scopeType === "organization") {
    return { orgId: scopeId };
  }
  if (scopeType === "project") {
    return { projectId: scopeId };
  }
  if (scopeType === "room") {
    return { roomId: scopeId };
  }
  return {};
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

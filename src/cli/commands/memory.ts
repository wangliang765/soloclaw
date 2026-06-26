import type { ActorRef, MemoryReviewStatus, MemoryScope } from "../../domain/index.js";
import type { MemoryEvalInput, MemoryEvalResult, MemorySafetyMode } from "../../memory/memory-retrieval-service.js";
import type { MemorySnapshotStatus } from "../../memory/memory-snapshot-service.js";
import type { CommandModule } from "../command-router.js";

type ClosableStore = {
  close?(): void;
};

type MemoryRecordLike = {
  id: string;
  scopeType: string;
  scopeId: string;
  kind: string;
  summary: string;
  updatedAt?: string;
  lastUsedAt?: string;
};

type MemoryCandidateLike = {
  id: string;
  status: string;
  scopeType: string;
  scopeId: string;
  kind: string;
  proposedSummary: string;
  reviewReason?: string;
};

type SessionSummaryLike = {
  id: string;
  summary: string;
  sessionId?: string;
};

type MemoryCommandMemory = {
  add(input: { scopeType: MemoryScope; scopeId: string; kind: string; content: string }): Promise<MemoryRecordLike>;
  delete(memoryId: string): Promise<boolean>;
  addSessionSummary(sessionId: string, summary: string): Promise<SessionSummaryLike>;
  extractCandidates(input: {
    text: string;
    scopeType: MemoryScope;
    scopeId: string;
    sourceSessionId: string;
    sourceSummaryId: string;
    actor: ActorRef;
  }): Promise<{ createdCandidates: unknown[]; deniedCandidates: unknown[] }>;
  listCandidates(input: {
    scopeType?: MemoryScope;
    scopeId?: string;
    status?: MemoryReviewStatus;
    limit?: number;
  }): Promise<MemoryCandidateLike[]>;
  approveCandidate(input: {
    candidateId: string;
    reviewer: ActorRef;
    summary?: string;
    content?: string;
  }): Promise<{ candidate: { id: string; status: string }; memory: MemoryRecordLike }>;
  rejectCandidate(input: {
    candidateId: string;
    reviewer: ActorRef;
    reason: string;
  }): Promise<MemoryCandidateLike>;
  list(scopeType?: MemoryScope, scopeId?: string): Promise<MemoryRecordLike[]>;
};

type MemoryCommandStore = ClosableStore & {
  getSessionSummaries(sessionId: string): Promise<SessionSummaryLike[]>;
  listMemoryUsageEvents(memoryId: string): Promise<unknown[]>;
  listMemories(scopeType?: MemoryScope, scopeId?: string): Promise<unknown[]>;
};

export type MemoryCommandPlatform = {
  memory: MemoryCommandMemory;
  store: MemoryCommandStore;
};

type MemoryRetrievalServiceLike = {
  search(input: {
    query: string;
    scopeType?: MemoryScope;
    scopeId?: string;
    actor: ActorRef;
    limit?: number;
    enforceAccess: true;
    safetyMode?: MemorySafetyMode;
  }): Promise<Array<{
    citationId: string;
    memory: MemoryRecordLike;
    score: number;
    safetyFindings: unknown[];
  }>>;
  evaluate(input: MemoryEvalInput): Promise<MemoryEvalResult>;
};

type MemorySnapshotServiceLike = {
  exportSnapshot(input: { filePath: string; scopeType: MemoryScope; scopeId: string; actor: ActorRef }): Promise<void>;
  importSnapshot(input: { filePath: string; scopeType: MemoryScope; scopeId: string; actor: ActorRef }): Promise<{ candidateCount: number }>;
  status(input: { filePath: string; scopeType: MemoryScope; scopeId: string }): Promise<MemorySnapshotStatus>;
};

export type MemoryCommandDeps<TPlatform extends MemoryCommandPlatform> = {
  cwd(): string;
  createPlatform(cwd: string): Promise<TPlatform>;
  createRetrievalService(store: TPlatform["store"]): MemoryRetrievalServiceLike;
  createSnapshotService(store: TPlatform["store"]): MemorySnapshotServiceLike;
  actor(): ActorRef;
  readUtf8(filePath: string): Promise<string>;
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

type MemoryCliOptions = {
  json?: boolean;
  scopeType?: MemoryScope;
  scopeId?: string;
  status?: MemoryReviewStatus;
  limit?: number;
  reason?: string;
  summary?: string;
  content?: string;
  file?: string;
  caseFile?: string;
  safetyMode?: MemorySafetyMode;
};

export function createMemoryCommand<TPlatform extends MemoryCommandPlatform>(
  deps: MemoryCommandDeps<TPlatform>,
): CommandModule<void> {
  return {
    name: "memory",
    summary: "Manage persistent memory",
    execute: async ({ args: rawArgs }) => {
      const subcommand = rawArgs[0] ?? "list";
      let platform: TPlatform | undefined;
      try {
        platform = await deps.createPlatform(deps.cwd());
        const memory = platform.memory;
        const store = platform.store;

        if (subcommand === "add") {
          const parsed = parseMemoryArgs(rawArgs.slice(1));
          const [scopeType, scopeId, kind, ...contentParts] = parsed.positionals;
          const content = contentParts.join(" ").trim();
          if (!scopeType || !scopeId || !kind || !content) {
            throw new Error("Usage: agent memory add <scope-type> <scope-id> <kind> <content>");
          }
          const record = await memory.add({
            scopeType: parseMemoryScope(scopeType),
            scopeId,
            kind,
            content,
          });
          if (parsed.options.json) {
            deps.writeJson(record);
          } else {
            deps.writeText(`${record.id}\t${record.scopeType}:${record.scopeId}\t${record.kind}\t${record.summary}`);
          }
          return { matched: true };
        }

        if (subcommand === "delete") {
          const parsed = parseMemoryArgs(rawArgs.slice(1));
          const memoryId = parsed.positionals[0];
          if (!memoryId) {
            throw new Error("Missing memory id.");
          }
          const deleted = await memory.delete(memoryId);
          if (parsed.options.json) {
            deps.writeJson({ memoryId, deleted });
          } else {
            deps.writeText(deleted ? "deleted" : "not found");
          }
          return { matched: true };
        }

        if (subcommand === "summary") {
          const parsed = parseMemoryArgs(rawArgs.slice(1));
          const sessionId = parsed.positionals[0];
          const summary = parsed.positionals.slice(1).join(" ").trim();
          if (!sessionId || !summary) {
            throw new Error("Usage: agent memory summary <session-id> <summary>");
          }
          const record = await memory.addSessionSummary(sessionId, summary);
          if (parsed.options.json) {
            deps.writeJson(record);
          } else {
            deps.writeText(`${record.id}\t${record.sessionId}\t${record.summary}`);
          }
          return { matched: true };
        }

        if (subcommand === "extract") {
          const parsed = parseMemoryArgs(rawArgs.slice(1));
          const sessionId = parsed.positionals[0];
          if (!sessionId) {
            throw new Error("Usage: agent memory extract <session-id> [--scope-type project] [--scope-id local] [--json]");
          }
          const summaries = await store.getSessionSummaries(sessionId);
          if (summaries.length === 0) {
            throw new Error(`No session summaries found for session: ${sessionId}`);
          }
          const createdCandidates = [];
          const deniedCandidates = [];
          for (const summary of summaries) {
            const result = await memory.extractCandidates({
              text: summary.summary,
              scopeType: parsed.options.scopeType ?? "project",
              scopeId: parsed.options.scopeId ?? "local",
              sourceSessionId: sessionId,
              sourceSummaryId: summary.id,
              actor: deps.actor(),
            });
            createdCandidates.push(...result.createdCandidates);
            deniedCandidates.push(...result.deniedCandidates);
          }
          const view = { sessionId, createdCandidates, deniedCandidates };
          if (parsed.options.json) {
            deps.writeJson(view);
          } else {
            deps.writeText(`session=${sessionId}\tcreated=${createdCandidates.length}\tdenied=${deniedCandidates.length}`);
          }
          return { matched: true };
        }

        if (subcommand === "candidates") {
          const parsed = parseMemoryArgs(rawArgs.slice(1));
          const candidates = await memory.listCandidates({
            scopeType: parsed.options.scopeType,
            scopeId: parsed.options.scopeId,
            status: parsed.options.status,
            limit: parsed.options.limit,
          });
          if (parsed.options.json) {
            deps.writeJson({ candidates });
          } else {
            for (const candidate of candidates) {
              deps.writeText(`${candidate.id}\t${candidate.status}\t${candidate.scopeType}:${candidate.scopeId}\t${candidate.kind}\t${candidate.proposedSummary}`);
            }
          }
          return { matched: true };
        }

        if (subcommand === "approve") {
          const parsed = parseMemoryArgs(rawArgs.slice(1));
          const candidateId = parsed.positionals[0];
          if (!candidateId) {
            throw new Error("Usage: agent memory approve <candidate-id> [--summary text] [--content text] [--json]");
          }
          const result = await memory.approveCandidate({
            candidateId,
            reviewer: deps.actor(),
            summary: parsed.options.summary,
            content: parsed.options.content,
          });
          if (parsed.options.json) {
            deps.writeJson(result);
          } else {
            deps.writeText(`${result.memory.id}\tapproved\tcandidate=${result.candidate.id}\t${result.memory.summary}`);
          }
          return { matched: true };
        }

        if (subcommand === "reject") {
          const parsed = parseMemoryArgs(rawArgs.slice(1));
          const candidateId = parsed.positionals[0];
          if (!candidateId || !parsed.options.reason) {
            throw new Error("Usage: agent memory reject <candidate-id> --reason text [--json]");
          }
          const candidate = await memory.rejectCandidate({
            candidateId,
            reviewer: deps.actor(),
            reason: parsed.options.reason,
          });
          if (parsed.options.json) {
            deps.writeJson({ candidate });
          } else {
            deps.writeText(`${candidate.id}\trejected\t${candidate.reviewReason ?? ""}`);
          }
          return { matched: true };
        }

        if (subcommand === "search") {
          const parsed = parseMemoryArgs(rawArgs.slice(1));
          const query = parsed.positionals.join(" ").trim();
          if (!query) {
            throw new Error("Usage: agent memory search <query> [--scope-type project] [--scope-id local] [--limit n] [--json]");
          }
          const results = await deps.createRetrievalService(store).search({
            query,
            scopeType: parsed.options.scopeType ?? "project",
            scopeId: parsed.options.scopeId ?? "local",
            actor: deps.actor(),
            limit: parsed.options.limit,
            enforceAccess: true,
            safetyMode: parsed.options.safetyMode,
          });
          const view = {
            query,
            results: results.map((result) => ({
              citationId: result.citationId,
              memoryId: result.memory.id,
              scopeType: result.memory.scopeType,
              scopeId: result.memory.scopeId,
              kind: result.memory.kind,
              summary: result.memory.summary,
              score: result.score,
              lastUsedAt: result.memory.lastUsedAt,
              safetyFindings: result.safetyFindings,
            })),
          };
          if (parsed.options.json) {
            deps.writeJson(view);
          } else {
            for (const result of view.results) {
              deps.writeText(`${result.citationId}\t${result.score.toFixed(3)}\t${result.scopeType}:${result.scopeId}\t${result.kind}\t${result.summary}`);
            }
          }
          return { matched: true };
        }

        if (subcommand === "usage") {
          const parsed = parseMemoryArgs(rawArgs.slice(1));
          const memoryId = parsed.positionals[0];
          if (!memoryId) {
            throw new Error("Usage: agent memory usage <memory-id> [--json]");
          }
          const events = await store.listMemoryUsageEvents(memoryId);
          if (parsed.options.json) {
            deps.writeJson({ memoryId, events });
          } else {
            for (const event of events) {
              const view = event as { id?: string; reason?: string; createdAt?: string; query?: string };
              deps.writeText(`${view.id}\t${view.reason}\t${view.createdAt}\t${view.query ?? ""}`);
            }
          }
          return { matched: true };
        }

        if (subcommand === "snapshot") {
          const action = rawArgs[1];
          const parsed = parseMemoryArgs(rawArgs.slice(2));
          if (!action || !parsed.options.file) {
            throw new Error("Usage: agent memory snapshot export|import|status --file path [--scope-type project] [--scope-id local] [--json]");
          }
          const service = deps.createSnapshotService(store);
          const scopeType = parsed.options.scopeType ?? "project";
          const scopeId = parsed.options.scopeId ?? "local";
          if (action === "export") {
            const memoryCount = (await store.listMemories(scopeType, scopeId)).length;
            await service.exportSnapshot({ filePath: parsed.options.file, scopeType, scopeId, actor: deps.actor() });
            const view = { status: "exported", filePath: parsed.options.file, scopeType, scopeId, memoryCount };
            if (parsed.options.json) {
              deps.writeJson(view);
            } else {
              deps.writeText(`exported\t${parsed.options.file}\tmemories=${memoryCount}`);
            }
            return { matched: true };
          }
          if (action === "import") {
            const result = await service.importSnapshot({ filePath: parsed.options.file, scopeType, scopeId, actor: deps.actor() });
            const view = { status: "imported", filePath: parsed.options.file, scopeType, scopeId, ...result };
            if (parsed.options.json) {
              deps.writeJson(view);
            } else {
              deps.writeText(`imported\t${parsed.options.file}\tcandidates=${result.candidateCount}`);
            }
            return { matched: true };
          }
          if (action === "status") {
            const status = await service.status({ filePath: parsed.options.file, scopeType, scopeId });
            if (parsed.options.json) {
              deps.writeJson(status);
            } else {
              deps.writeText(`${status.status}\t${status.filePath}`);
            }
            return { matched: true };
          }
          throw new Error("Usage: agent memory snapshot export|import|status --file path [--scope-type project] [--scope-id local] [--json]");
        }

        if (subcommand === "eval") {
          const parsed = parseMemoryArgs(rawArgs.slice(1));
          if (!parsed.options.caseFile) {
            throw new Error("Usage: agent memory eval --case-file path.json [--limit n] [--json]");
          }
          const spec = JSON.parse(await deps.readUtf8(parsed.options.caseFile)) as Pick<MemoryEvalInput, "cases" | "thresholds">;
          const result = await deps.createRetrievalService(store).evaluate({
            cases: spec.cases ?? [],
            thresholds: spec.thresholds,
            actor: deps.actor(),
            enforceAccess: true,
            safetyMode: parsed.options.safetyMode,
            limit: parsed.options.limit,
          });
          if (parsed.options.json) {
            deps.writeJson(result);
          } else {
            deps.writeText(`passed=${result.gate.passed}\trecallAtK=${result.metrics.recallAtK.toFixed(3)}\tpermissionLeaks=${result.metrics.permissionLeakCount}`);
          }
          if (!result.gate.passed) {
            deps.setExitCode(1);
          }
          return { matched: true };
        }

        if (subcommand === "list" || subcommand === "ls") {
          const parsed = parseMemoryArgs(rawArgs.slice(1));
          const positionalScopeType = parsed.positionals[0] ? parseMemoryScope(parsed.positionals[0]) : undefined;
          const records = await memory.list(parsed.options.scopeType ?? positionalScopeType, parsed.options.scopeId ?? parsed.positionals[1]);
          if (parsed.options.json) {
            deps.writeJson({ memories: records });
          } else {
            for (const record of records) {
              deps.writeText(`${record.id}\t${record.scopeType}:${record.scopeId}\t${record.kind}\t${record.updatedAt}\t${record.summary}`);
            }
          }
          return { matched: true };
        }

        throw new Error(`Unknown memory command: ${subcommand}`);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
        return { matched: true };
      } finally {
        platform?.store.close?.();
      }
    },
  };
}

function parseMemoryArgs(args: string[]): { options: MemoryCliOptions; positionals: string[] } {
  const options: MemoryCliOptions = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--scope-type" && next) {
      options.scopeType = parseMemoryScope(next);
      index += 1;
      continue;
    }
    if (arg === "--scope-id" && next) {
      options.scopeId = next;
      index += 1;
      continue;
    }
    if (arg === "--status" && next) {
      options.status = parseMemoryReviewStatus(next);
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      const limit = Number(next);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error("--limit must be an integer between 1 and 1000.");
      }
      options.limit = limit;
      index += 1;
      continue;
    }
    if (arg === "--reason" && next) {
      options.reason = next;
      index += 1;
      continue;
    }
    if (arg === "--summary" && next) {
      options.summary = next;
      index += 1;
      continue;
    }
    if (arg === "--content" && next) {
      options.content = next;
      index += 1;
      continue;
    }
    if (arg === "--file" && next) {
      options.file = next;
      index += 1;
      continue;
    }
    if (arg === "--case-file" && next) {
      options.caseFile = next;
      index += 1;
      continue;
    }
    if ((arg === "--safety" || arg === "--safety-mode") && next) {
      options.safetyMode = parseMemorySafetyMode(next);
      index += 1;
      continue;
    }
    positionals.push(arg);
  }
  return { options, positionals };
}

function parseMemoryScope(value: string): MemoryScope {
  const allowed: MemoryScope[] = ["user", "project", "repository", "organization", "room", "agent"];
  if (allowed.includes(value as MemoryScope)) {
    return value as MemoryScope;
  }
  throw new Error(`Invalid memory scope type: ${value}.`);
}

function parseMemoryReviewStatus(value: string): MemoryReviewStatus {
  const allowed: MemoryReviewStatus[] = ["pending", "approved", "rejected", "superseded"];
  if (allowed.includes(value as MemoryReviewStatus)) {
    return value as MemoryReviewStatus;
  }
  throw new Error(`Invalid memory candidate status: ${value}.`);
}

function parseMemorySafetyMode(value: string): MemorySafetyMode {
  if (value === "off" || value === "annotate" || value === "exclude") {
    return value;
  }
  throw new Error(`Invalid memory safety mode: ${value}.`);
}

import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryCommand } from "../cli/commands/memory.js";

type FakePlatform = {
  memory: {
    list(scopeType?: string, scopeId?: string): Promise<Array<{ id: string; scopeType: string; scopeId: string; kind: string; updatedAt: string; summary: string }>>;
    add(input: { scopeType: string; scopeId: string; kind: string; content: string }): Promise<{ id: string; scopeType: string; scopeId: string; kind: string; summary: string }>;
    delete(memoryId: string): Promise<boolean>;
    addSessionSummary(sessionId: string, summary: string): Promise<{ id: string; sessionId: string; summary: string }>;
    extractCandidates(input: Record<string, unknown>): Promise<{ createdCandidates: unknown[]; deniedCandidates: unknown[] }>;
    listCandidates(input: Record<string, unknown>): Promise<Array<{ id: string; status: string; scopeType: string; scopeId: string; kind: string; proposedSummary: string }>>;
    approveCandidate(input: Record<string, unknown>): Promise<{ candidate: { id: string; status: string }; memory: { id: string; scopeType: string; scopeId: string; kind: string; summary: string } }>;
    rejectCandidate(input: Record<string, unknown>): Promise<{ id: string; status: string; scopeType: string; scopeId: string; kind: string; proposedSummary: string; reviewReason?: string }>;
  };
  store: {
    close(): void;
    getSessionSummaries(sessionId: string): Promise<Array<{ id: string; summary: string }>>;
    listMemoryUsageEvents(memoryId: string): Promise<unknown[]>;
    listMemories(scopeType?: string, scopeId?: string): Promise<unknown[]>;
  };
};

test("createMemoryCommand lists memories with positional scope filters", async () => {
  const events: string[] = [];
  const command = createMemoryCommand<FakePlatform>({
    cwd: () => "C:/repo",
    createPlatform: async (cwd) => {
      events.push(`platform:${cwd}`);
      return fakePlatform(events);
    },
    createRetrievalService: () => fakeRetrieval(events),
    createSnapshotService: () => fakeSnapshot(events),
    actor: () => ({ type: "user", id: "local-user", displayName: "Local User" }),
    readUtf8: async () => "{}",
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "memory", args: ["list", "project", "local"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "platform:C:/repo",
    "list:project:local",
    "text:mem_1\tproject:local\tworkflow\t2026-06-26T00:00:00.000Z\tRun build",
    "close",
  ]);
});

test("createMemoryCommand searches memories and writes JSON", async () => {
  const events: string[] = [];
  const command = createMemoryCommand<FakePlatform>({
    cwd: () => "C:/repo",
    createPlatform: async () => fakePlatform(events),
    createRetrievalService: () => fakeRetrieval(events),
    createSnapshotService: () => fakeSnapshot(events),
    actor: () => ({ type: "user", id: "local-user", displayName: "Local User" }),
    readUtf8: async () => "{}",
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "memory", args: ["search", "build", "--scope-type", "project", "--scope-id", "local", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "search:build:project:local:true",
    'json:{"query":"build","results":[{"citationId":"M:mem_1","memoryId":"mem_1","scopeType":"project","scopeId":"local","kind":"workflow","summary":"Run build","score":1.25,"lastUsedAt":"2026-06-26T00:00:00.000Z","safetyFindings":[]}]}',
    "close",
  ]);
});

test("createMemoryCommand reports usage errors and closes the store", async () => {
  const events: string[] = [];
  const command = createMemoryCommand<FakePlatform>({
    cwd: () => "C:/repo",
    createPlatform: async () => fakePlatform(events),
    createRetrievalService: () => fakeRetrieval(events),
    createSnapshotService: () => fakeSnapshot(events),
    actor: () => ({ type: "user", id: "local-user", displayName: "Local User" }),
    readUtf8: async () => "{}",
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "memory", args: ["add", "project"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "error:Usage: agent memory add <scope-type> <scope-id> <kind> <content>",
    "exit:1",
    "close",
  ]);
});

function fakePlatform(events: string[]): FakePlatform {
  return {
    memory: {
      list: async (scopeType, scopeId) => {
        events.push(`list:${scopeType ?? "-"}:${scopeId ?? "-"}`);
        return [
          {
            id: "mem_1",
            scopeType: "project",
            scopeId: "local",
            kind: "workflow",
            updatedAt: "2026-06-26T00:00:00.000Z",
            summary: "Run build",
          },
        ];
      },
      add: async (input) => ({ id: "mem_1", ...input, summary: input.content }),
      delete: async () => true,
      addSessionSummary: async (sessionId, summary) => ({ id: "sum_1", sessionId, summary }),
      extractCandidates: async () => ({ createdCandidates: [], deniedCandidates: [] }),
      listCandidates: async () => [],
      approveCandidate: async () => ({
        candidate: { id: "cand_1", status: "approved" },
        memory: { id: "mem_1", scopeType: "project", scopeId: "local", kind: "workflow", summary: "Run build" },
      }),
      rejectCandidate: async () => ({
        id: "cand_1",
        status: "rejected",
        scopeType: "project",
        scopeId: "local",
        kind: "workflow",
        proposedSummary: "Run build",
        reviewReason: "stale",
      }),
    },
    store: {
      close: () => events.push("close"),
      getSessionSummaries: async () => [],
      listMemoryUsageEvents: async () => [],
      listMemories: async () => [],
    },
  };
}

function fakeRetrieval(events: string[]) {
  return {
    search: async (input: Record<string, unknown>) => {
      events.push(`search:${input.query}:${input.scopeType}:${input.scopeId}:${input.enforceAccess}`);
      return [
        {
          citationId: "M:mem_1",
          memory: {
            id: "mem_1",
            scopeType: "project",
            scopeId: "local",
            kind: "workflow",
            summary: "Run build",
            lastUsedAt: "2026-06-26T00:00:00.000Z",
          },
          score: 1.25,
          safetyFindings: [],
        },
      ];
    },
    evaluate: async () => ({
      caseCount: 1,
      gate: { passed: true, failures: [] },
      metrics: { recallAtK: 1, emptyResultRate: 0, permissionLeakCount: 0, permissionLeakRate: 0 },
      cases: [],
    }),
  };
}

function fakeSnapshot(events: string[]) {
  return {
    exportSnapshot: async () => {
      events.push("snapshot:export");
    },
    importSnapshot: async () => ({ candidateCount: 0 }),
    status: async () => ({ status: "clean" as const, filePath: "memory.md" }),
  };
}

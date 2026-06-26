import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRetrievalService } from "../memory/memory-retrieval-service.js";
import { MemoryAgentStore } from "../store/memory-agent-store.js";

test("memory retrieval ranks matching memories and records usage", async () => {
  const store = new MemoryAgentStore();
  const now = new Date().toISOString();
  await store.addMemory({
    id: "mem_windows_build",
    scopeType: "project",
    scopeId: "local",
    kind: "workflow",
    content: "Run npm.cmd run build on Windows before release gates.",
    summary: "Use npm.cmd run build on Windows.",
    confidence: 0.9,
    createdAt: now,
    updatedAt: now,
  });
  await store.addMemory({
    id: "mem_unrelated",
    scopeType: "project",
    scopeId: "local",
    kind: "project_fact",
    content: "The docs live under docs/.",
    summary: "Docs live under docs/.",
    confidence: 0.8,
    createdAt: now,
    updatedAt: now,
  });

  const retrieval = new MemoryRetrievalService(store);
  const results = await retrieval.search({
    query: "Windows build command",
    scopeType: "project",
    scopeId: "local",
    actor: { type: "user", id: "local" },
    sessionId: "sess_1",
    limit: 5,
  });

  assert.equal(results[0]?.memory.id, "mem_windows_build");
  assert.equal(results[0]?.citationId, "M:mem_windows_build");
  assert.ok(results[0]?.score ?? 0 > 0);
  const usage = await store.listMemoryUsageEvents("mem_windows_build");
  assert.equal(usage[0]?.reason, "retrieved");
  assert.equal((await store.listMemories("project", "local")).find((memory) => memory.id === "mem_windows_build")?.lastUsedAt !== undefined, true);
});

test("memory retrieval excludes expired memories", async () => {
  const store = new MemoryAgentStore();
  await store.addMemory({
    id: "mem_expired",
    scopeType: "project",
    scopeId: "local",
    kind: "project_fact",
    content: "Use an obsolete release command.",
    summary: "Obsolete release command.",
    confidence: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-02T00:00:00.000Z",
  });

  const results = await new MemoryRetrievalService(store).search({
    query: "obsolete release command",
    scopeType: "project",
    scopeId: "local",
    actor: { type: "user", id: "local" },
    now: "2026-06-25T00:00:00.000Z",
  });

  assert.equal(results.length, 0);
});

test("memory retrieval records no permission leaks for forbidden room memory", async () => {
  const store = new MemoryAgentStore();
  await store.addMemory({
    id: "mem_forbidden_room",
    scopeType: "room",
    scopeId: "room_secret",
    kind: "decision",
    content: "Secret room decision.",
    summary: "Secret room decision.",
    confidence: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const retrieval = new MemoryRetrievalService(store);
  const result = await retrieval.evaluate({
    cases: [{
      id: "room_leak",
      query: "secret room decision",
      scopeType: "room",
      scopeId: "room_secret",
      forbiddenMemoryIds: ["mem_forbidden_room"],
    }],
    actor: { type: "agent", id: "agent_outside" },
    enforceAccess: true,
  });

  assert.equal(result.metrics.permissionLeakCount, 0);
  assert.equal(result.gate.passed, true);
});

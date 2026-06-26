import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LifecycleService } from "../lifecycle/lifecycle-service.js";
import { MemoryExtractionService } from "../memory/memory-extraction-service.js";
import { MemoryAgentStore } from "../store/memory-agent-store.js";

test("pre-compaction memory extraction creates candidates once per summary", async () => {
  const store = new MemoryAgentStore();
  const extractor = new MemoryExtractionService(store);
  await extractor.extractFromSessionSummary({
    text: "Decision: use target-dir Phase 5 evidence merge for collector fragments.",
    scopeType: "project",
    scopeId: "local",
    sourceSessionId: "sess_1",
    sourceSummaryId: "sum_1",
    actor: { type: "agent", id: "agent_local" },
  });
  await extractor.extractFromSessionSummary({
    text: "Decision: use target-dir Phase 5 evidence merge for collector fragments.",
    scopeType: "project",
    scopeId: "local",
    sourceSessionId: "sess_1",
    sourceSummaryId: "sum_1",
    actor: { type: "agent", id: "agent_local" },
  });

  const pending = await store.listMemoryCandidates({ sourceSummaryId: "sum_1" });
  assert.equal(pending.length, 1);
});

test("lifecycle compaction extracts memory candidates and scopes audit to the session", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-lifecycle-"));
  const store = new MemoryAgentStore();
  const actor = { type: "user" as const, id: "local-user" };
  const session = await store.createSession({
    objective: "Compact a session with durable memory facts.",
    status: "completed",
    risk: "low",
    projectId: "local",
    createdBy: actor,
  });
  const lifecycle = new LifecycleService(store, root);

  await lifecycle.compactSession({
    sessionId: session.id,
    actor,
    summary: "Decision: use reviewed memory candidates for durable recall.",
  });

  const pending = await store.listMemoryCandidates({ sourceSessionId: session.id });
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.sourceSummaryId !== undefined, true);
  const audits = await store.listAuditEvents({ type: "memory.pre_compaction_extract", sessionId: session.id });
  assert.equal(audits.length, 1);
  const audit = audits[0];
  assert.ok(audit);
  assert.ok(audit.metadata);
  assert.equal(audit.metadata.candidateCount, 1);
});

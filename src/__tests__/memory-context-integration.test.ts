import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalPlatform } from "../platform/local-platform.js";

test("local platform injects bounded cited remembered evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-context-"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { build: "tsc -p tsconfig.json" } }), "utf8");
  const setup = await createLocalPlatform(root, { provider: "mock", workspaceSnapshot: false });
  const now = new Date().toISOString();
  await setup.store.addMemory({
    id: "mem_context_windows",
    scopeType: "project",
    scopeId: "local",
    kind: "workflow",
    content: "Run npm.cmd run build on Windows before release gates.",
    summary: "Use npm.cmd run build on Windows.",
    confidence: 0.9,
    createdAt: now,
    updatedAt: now,
  });
  setup.store.close?.();

  const platform = await createLocalPlatform(root, {
    provider: "mock",
    workspaceSnapshot: false,
    knowledgeQuery: "Windows build command",
  });
  const result = await platform.agent.runWithSession("inspect memory context");
  assert.ok(result.session);
  const messages = await platform.store.getMessages(result.session.id);
  const userMessage = messages.find((message) => message.role === "user")?.content ?? "";

  assert.match(userMessage, /Remembered evidence/);
  assert.match(userMessage, /Citation: M:mem_context_windows/);
  assert.match(userMessage, /Use npm\.cmd run build on Windows/);
  platform.store.close?.();
});

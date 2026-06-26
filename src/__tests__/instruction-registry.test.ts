import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { InstructionRegistry } from "../instructions/instruction-registry.js";

test("InstructionRegistry loads project AGENTS.md before compatibility fallbacks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-instructions-"));
  await fs.writeFile(path.join(root, "AGENTS.md"), "# Project Rules\n\nUse npm.cmd on Windows.\n", "utf8");
  await fs.writeFile(path.join(root, "CLAUDE.md"), "# Claude Rules\n\nIgnored when AGENTS exists.\n", "utf8");

  const registry = new InstructionRegistry({ workspaceRoot: root, cwd: root });
  const resolved = await registry.resolveSystemInstructions();

  assert.deepEqual(resolved.sources.map((source) => source.kind), ["project"]);
  assert.equal(resolved.sources[0]?.path, path.join(root, "AGENTS.md"));
  assert.match(resolved.attachments[0]?.content ?? "", /Use npm\.cmd on Windows/);
  assert.doesNotMatch(resolved.attachments.map((item) => item.content).join("\n"), /Ignored when AGENTS exists/);
});

test("InstructionRegistry falls back to CLAUDE.md and deprecated CONTEXT.md in order", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-instructions-"));
  await fs.writeFile(path.join(root, "CLAUDE.md"), "# Claude Rules\n\nFallback rule.\n", "utf8");
  await fs.writeFile(path.join(root, "CONTEXT.md"), "# Context Rules\n\nDeprecated fallback.\n", "utf8");

  const registry = new InstructionRegistry({ workspaceRoot: root, cwd: root });
  const resolved = await registry.resolveSystemInstructions();

  assert.equal(resolved.sources[0]?.path, path.join(root, "CLAUDE.md"));
  assert.match(resolved.attachments[0]?.content ?? "", /Fallback rule/);
  assert.doesNotMatch(resolved.attachments.map((item) => item.content).join("\n"), /Deprecated fallback/);
});

test("InstructionRegistry includes configured instruction globs after project rules", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-instructions-"));
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.writeFile(path.join(root, "AGENTS.md"), "# Project Rules\n\nRoot rule.\n", "utf8");
  await fs.writeFile(path.join(root, "docs", "coding.md"), "# Coding Rules\n\nPrefer rg.\n", "utf8");

  const registry = new InstructionRegistry({
    workspaceRoot: root,
    cwd: root,
    configInstructions: ["docs/*.md"],
  });
  const resolved = await registry.resolveSystemInstructions();

  assert.deepEqual(resolved.sources.map((source) => source.kind), ["project", "config"]);
  assert.match(resolved.attachments.map((item) => item.content).join("\n"), /Root rule/);
  assert.match(resolved.attachments.map((item) => item.content).join("\n"), /Prefer rg/);
});

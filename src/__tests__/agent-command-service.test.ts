import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentCommandLoader } from "../commands/agent-command-loader.js";
import { AgentCommandService } from "../commands/agent-command-service.js";

test("AgentCommandLoader loads markdown commands with frontmatter", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-command-"));
  const commandDir = path.join(root, ".agent", "commands");
  await fs.mkdir(commandDir, { recursive: true });
  await fs.writeFile(path.join(commandDir, "review.md"), [
    "---",
    "description: Review current changes",
    "agentProfile: review",
    "---",
    "",
    "Review $ARGUMENTS.",
  ].join("\n"), "utf8");

  const commands = await new AgentCommandLoader().loadDirectory(commandDir);

  assert.equal(commands[0]?.name, "review");
  assert.equal(commands[0]?.description, "Review current changes");
  assert.equal(commands[0]?.agentProfile, "review");
});

test("AgentCommandService expands arguments and safe file references", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-command-"));
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.writeFile(path.join(root, "docs", "note.md"), "Important note\n", "utf8");
  const service = new AgentCommandService({ workspaceRoot: root });

  const expanded = await service.expand({
    template: "Analyze $1 with $ARGUMENTS and @docs/note.md",
    argumentsText: "phase5 evidence",
  });

  assert.match(expanded, /Analyze phase5 with phase5 evidence/);
  assert.match(expanded, /File: docs\/note\.md/);
  assert.match(expanded, /Important note/);
});

test("AgentCommandService rejects shell interpolation in first version", async () => {
  const service = new AgentCommandService({ workspaceRoot: process.cwd() });

  await assert.rejects(
    () => service.expand({ template: "Run !`npm test`", argumentsText: "" }),
    /Shell interpolation is not enabled/,
  );
});

test("AgentCommandService rejects protected file references", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-command-"));
  await fs.mkdir(path.join(root, ".agent", "tmp"), { recursive: true });
  await fs.mkdir(path.join(root, ".git"), { recursive: true });
  await fs.writeFile(path.join(root, ".agent", "secrets.vault.json"), "secret\n", "utf8");
  await fs.writeFile(path.join(root, ".agent", "tmp", "note.txt"), "temporary ok\n", "utf8");
  await fs.writeFile(path.join(root, ".git", "config"), "private git config\n", "utf8");
  const service = new AgentCommandService({ workspaceRoot: root });

  await assert.rejects(
    () => service.expand({ template: "Read @.agent/secrets.vault.json", argumentsText: "" }),
    /Protected workspace path/,
  );
  await assert.rejects(
    () => service.expand({ template: "Read @.git/config", argumentsText: "" }),
    /Protected workspace path/,
  );

  const expanded = await service.expand({ template: "Read @.agent/tmp/note.txt", argumentsText: "" });
  assert.match(expanded, /temporary ok/);
});

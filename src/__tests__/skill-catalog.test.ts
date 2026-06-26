import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalSkillLoader } from "../skills/local-skill-loader.js";
import { SkillCatalog } from "../skills/skill-catalog.js";
import { MemoryAgentStore } from "../store/memory-agent-store.js";

test("LocalSkillLoader accepts SKILL.md frontmatter without manifest.json", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-skill-"));
  const skillDir = path.join(root, "debugging");
  await fs.mkdir(skillDir);
  await fs.writeFile(path.join(skillDir, "SKILL.md"), [
    "---",
    "name: debugging",
    "description: Diagnose reproducible failures before fixing",
    "version: 0.1.0",
    "---",
    "",
    "# Debugging",
    "",
    "Reproduce the issue first.",
  ].join("\n"), "utf8");

  const store = new MemoryAgentStore();
  const [skill] = await new LocalSkillLoader(store).loadDirectory(root);

  assert.equal(skill?.manifest.name, "debugging");
  assert.equal(skill?.manifest.version, "0.1.0");
  assert.match(skill?.body ?? "", /Reproduce the issue first/);
});

test("SkillCatalog exposes builtin skill names and descriptions without full bodies", async () => {
  const store = new MemoryAgentStore();
  const catalog = new SkillCatalog(store);
  await catalog.ensureBuiltinSkillsLoaded();

  const available = await catalog.listAvailableSkills();

  assert.ok(available.some((skill) => skill.name === "tdd-regression"));
  assert.ok(available.some((skill) => skill.name === "verification-before-completion"));
  assert.equal(available.some((skill) => /NO COMPLETION CLAIMS/.test(skill.description)), false);
});

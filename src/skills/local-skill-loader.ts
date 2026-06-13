import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Skill, SkillManifest, SkillScope } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore } from "../store/agent-store.js";

export class LocalSkillLoader {
  constructor(private readonly store: AgentStore) {}

  async loadDirectory(root: string, scope: SkillScope = "project"): Promise<Skill[]> {
    const exists = await pathExists(root);
    if (!exists) {
      return [];
    }

    const entries = await fs.readdir(root, { withFileTypes: true });
    const loaded: Skill[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skill = await this.loadSkill(path.join(root, entry.name), scope);
      if (skill) {
        await this.store.upsertSkill(skill);
        loaded.push(skill);
      }
    }
    return loaded;
  }

  async loadSkill(skillPath: string, scope: SkillScope): Promise<Skill | undefined> {
    const manifestPath = path.join(skillPath, "manifest.json");
    const bodyPath = path.join(skillPath, "SKILL.md");
    if (!(await pathExists(manifestPath)) || !(await pathExists(bodyPath))) {
      return undefined;
    }

    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as SkillManifest;
    validateManifest(manifest);
    const body = await fs.readFile(bodyPath, "utf8");
    const now = new Date().toISOString();
    return {
      id: makeId<"PluginId">("skill"),
      scope,
      sourcePath: skillPath,
      manifest,
      summary: firstParagraph(body) || manifest.description,
      body,
      checksum: createHash("sha256").update(JSON.stringify(manifest)).update(body).digest("hex"),
      createdAt: now,
      updatedAt: now,
    };
  }
}

function validateManifest(manifest: SkillManifest) {
  if (!manifest.name || !manifest.version || !manifest.description) {
    throw new Error("Skill manifest requires name, version, and description.");
  }
  if (!Array.isArray(manifest.permissions) || !Array.isArray(manifest.tools)) {
    throw new Error("Skill manifest requires permissions and tools arrays.");
  }
}

function firstParagraph(body: string): string {
  return body
    .split(/\r?\n\r?\n/)
    .map((part) => part.trim())
    .find(Boolean) ?? "";
}

async function pathExists(inputPath: string): Promise<boolean> {
  try {
    await fs.access(inputPath);
    return true;
  } catch {
    return false;
  }
}

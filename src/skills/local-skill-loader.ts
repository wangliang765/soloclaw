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
    if (!(await pathExists(bodyPath))) {
      return undefined;
    }

    const body = await fs.readFile(bodyPath, "utf8");
    const manifest = (await pathExists(manifestPath))
      ? JSON.parse(await fs.readFile(manifestPath, "utf8")) as SkillManifest
      : manifestFromSkillMarkdown(body);
    validateManifest(manifest);
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

function manifestFromSkillMarkdown(body: string): SkillManifest {
  const { data } = parseFrontmatter(body);
  return {
    name: requiredFrontmatter(data, "name"),
    version: data.version ?? "0.1.0",
    description: requiredFrontmatter(data, "description"),
    permissions: parseStringList(data.permissions),
    tools: parseStringList(data.tools),
    metadata: parseMetadata(data.metadata),
  };
}

function parseFrontmatter(body: string): { data: Record<string, string>; content: string } {
  const normalized = body.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { data: {}, content: body };
  }
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    return { data: {}, content: body };
  }
  const header = normalized.slice(4, end).trim();
  const content = normalized.slice(end + 4).replace(/^\n/, "");
  const data: Record<string, string> = {};
  for (const line of header.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    data[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { data, content };
}

function requiredFrontmatter(data: Record<string, string>, key: string): string {
  const value = data[key];
  if (!value) {
    throw new Error(`Skill frontmatter requires ${key}.`);
  }
  return value;
}

function parseStringList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMetadata(value: string | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }
  const entries = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf("=");
      return separator >= 0
        ? [item.slice(0, separator).trim(), item.slice(separator + 1).trim()]
        : [item, "true"];
    });
  return Object.fromEntries(entries);
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

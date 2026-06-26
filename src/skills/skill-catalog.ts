import { createHash } from "node:crypto";
import type { ActorRef, Skill } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore } from "../store/agent-store.js";
import { BUILTIN_SKILLS } from "./builtin-skill-catalog.js";

export type AvailableSkill = {
  name: string;
  description: string;
  scope: Skill["scope"];
  tools: string[];
  permissions: string[];
};

export class SkillCatalog {
  constructor(private readonly store: AgentStore) {}

  async ensureBuiltinSkillsLoaded(): Promise<void> {
    const now = new Date().toISOString();
    for (const builtin of BUILTIN_SKILLS) {
      await this.store.upsertSkill({
        id: makeId<"PluginId">("skill"),
        scope: "builtin",
        manifest: {
          name: builtin.name,
          version: builtin.version,
          description: builtin.description,
          permissions: builtin.permissions,
          tools: builtin.tools,
        },
        summary: builtin.description,
        body: builtin.body,
        checksum: createHash("sha256").update(builtin.body).digest("hex"),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async listAvailableSkills(): Promise<AvailableSkill[]> {
    const skills = await this.store.listSkills();
    return skills.map((skill) => ({
      name: skill.manifest.name,
      description: skill.manifest.description,
      scope: skill.scope,
      tools: skill.manifest.tools,
      permissions: skill.manifest.permissions,
    }));
  }

  async recordSelection(input: { skill: Skill; sessionId?: string; actor?: ActorRef }): Promise<void> {
    await this.store.recordSkillUsage({
      id: `skilluse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      skillId: input.skill.id,
      sessionId: input.sessionId,
      actorId: input.actor?.id,
      createdAt: new Date().toISOString(),
    });
  }
}

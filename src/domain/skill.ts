import type { Timestamp } from "./common.js";

export type SkillScope = "builtin" | "user" | "project" | "organization" | "plugin";

export type SkillManifest = {
  name: string;
  version: string;
  description: string;
  permissions: string[];
  tools: string[];
  metadata?: Record<string, string>;
};

export type Skill = {
  id: string;
  scope: SkillScope;
  sourcePath?: string;
  manifest: SkillManifest;
  summary: string;
  body: string;
  checksum?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type SkillUsageEvent = {
  id: string;
  skillId: string;
  sessionId?: string;
  actorId?: string;
  createdAt: Timestamp;
};

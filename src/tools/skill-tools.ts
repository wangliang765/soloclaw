import type { ActorRef, ExecutionMode, PolicyRequest } from "../domain/index.js";
import type { PolicyEngine } from "../policy/policy-engine.js";
import type { JsonObject, RegisteredTool, ToolResult } from "../protocol/types.js";
import type { AgentStore } from "../store/agent-store.js";

export type SkillToolOptions = {
  store: AgentStore;
  policy: PolicyEngine;
  actor: ActorRef;
  mode: ExecutionMode;
  scope: PolicyRequest["scope"];
  sessionId?: string | (() => string | undefined);
};

export function createSkillTools(options: SkillToolOptions): RegisteredTool[] {
  return [
    {
      name: "load_skill",
      description: "Load the full instructions for one available skill by name. Use only when the task matches that skill.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      },
      handler: async (input) => loadSkillTool(options, input),
    },
  ];
}

async function loadSkillTool(options: SkillToolOptions, input: JsonObject): Promise<ToolResult> {
  const name = stringInput(input, "name");
  const skill = await options.store.getSkill(name);
  if (!skill) {
    return {
      callId: "load_skill",
      ok: false,
      error: { code: "skill_not_found", message: `Skill not found: ${name}` },
    };
  }

  const decision = await options.policy.evaluate({
    actor: options.actor,
    action: "skill.load",
    mode: options.mode,
    risk: "low",
    scope: options.scope,
    metadata: { skill: name },
    requestedAt: new Date().toISOString(),
  });
  if (decision.type === "deny") {
    return {
      callId: "load_skill",
      ok: false,
      error: { code: "policy_denied", message: decision.reason },
    };
  }
  if (decision.type === "ask") {
    return {
      callId: "load_skill",
      ok: false,
      error: { code: "approval_required", message: decision.reason },
      data: { action: "skill.load", skill: name },
    };
  }

  await options.store.recordSkillUsage({
    id: `skilluse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    skillId: skill.id,
    sessionId: resolveSessionId(options),
    actorId: options.actor.id,
    createdAt: new Date().toISOString(),
  });
  await options.store.recordAuditEvent({
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "skill.loaded",
    actor: options.actor,
    sessionId: resolveSessionId(options),
    summary: `Loaded skill ${name}`,
    metadata: {
      skill: name,
      scope: skill.scope,
      tools: skill.manifest.tools,
      permissions: skill.manifest.permissions,
      checksum: skill.checksum,
    },
    artifactRefs: [],
    createdAt: new Date().toISOString(),
  });

  return {
    callId: "load_skill",
    ok: true,
    output: [
      `<skill_content name="${skill.manifest.name}">`,
      skill.body.trim(),
      "",
      `Base directory for this skill: ${skill.sourcePath ?? "builtin"}`,
      "Relative paths in this skill are relative to that base when a source path exists.",
      "</skill_content>",
    ].join("\n"),
    display: {
      title: `Loaded skill: ${name}`,
      detailsHidden: true,
    },
  };
}

function stringInput(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value;
}

function resolveSessionId(options: SkillToolOptions): string | undefined {
  return typeof options.sessionId === "function" ? options.sessionId() : options.sessionId;
}

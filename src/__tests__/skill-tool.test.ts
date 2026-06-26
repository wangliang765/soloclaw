import assert from "node:assert/strict";
import test from "node:test";
import type { PolicyDecision, PolicyRequest } from "../domain/index.js";
import type { PolicyEngine } from "../policy/policy-engine.js";
import { SkillCatalog } from "../skills/skill-catalog.js";
import { MemoryAgentStore } from "../store/memory-agent-store.js";
import { createSkillTools } from "../tools/skill-tools.js";

class AllowPolicy implements PolicyEngine {
  async evaluate(_request: PolicyRequest): Promise<PolicyDecision> {
    return { type: "allow", reason: "test allow" };
  }
}

class DenyPolicy implements PolicyEngine {
  async evaluate(_request: PolicyRequest): Promise<PolicyDecision> {
    return { type: "deny", reason: "test deny" };
  }
}

test("load_skill returns full body only after explicit tool call", async () => {
  const store = new MemoryAgentStore();
  const catalog = new SkillCatalog(store);
  await catalog.ensureBuiltinSkillsLoaded();

  const [tool] = createSkillTools({
    store,
    policy: new AllowPolicy(),
    actor: { type: "user", id: "local-user" },
    mode: "trusted",
    scope: {},
    sessionId: () => "session_test",
  });

  const result = await tool.handler({ name: "verification-before-completion" });

  assert.equal(result.ok, true);
  assert.match(result.output ?? "", /# Verification Before Completion/);
  assert.match(result.output ?? "", /Base directory for this skill:/);
  assert.equal(store.skillUsage.length, 1);
});

test("load_skill denies access through policy", async () => {
  const store = new MemoryAgentStore();
  const catalog = new SkillCatalog(store);
  await catalog.ensureBuiltinSkillsLoaded();

  const [tool] = createSkillTools({
    store,
    policy: new DenyPolicy(),
    actor: { type: "user", id: "local-user" },
    mode: "trusted",
    scope: {},
    sessionId: () => "session_test",
  });

  const result = await tool.handler({ name: "room-evidence-collector" });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "policy_denied");
});

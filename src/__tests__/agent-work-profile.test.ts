import assert from "node:assert/strict";
import test from "node:test";
import { agentWorkProfile, filterToolsForWorkProfile } from "../core/agent-work-profile.js";
import type { RegisteredTool } from "../protocol/types.js";

const tools = ["list_files", "read_file", "search_text", "run_command", "apply_patch", "create_file", "replace_range", "load_skill"].map((name): RegisteredTool => ({
  name,
  description: name,
  inputSchema: { type: "object", properties: {} },
  handler: async () => ({ callId: name, ok: true, output: "" }),
}));

test("explore profile is read-only plus skill loading", () => {
  const filtered = filterToolsForWorkProfile(tools, agentWorkProfile("explore"));
  assert.deepEqual(filtered.map((tool) => tool.name).sort(), ["list_files", "load_skill", "read_file", "search_text"]);
});

test("review profile allows read tools and safe commands but denies edit tools", () => {
  const filtered = filterToolsForWorkProfile(tools, agentWorkProfile("review"));
  assert.ok(filtered.some((tool) => tool.name === "run_command"));
  assert.equal(filtered.some((tool) => tool.name === "apply_patch"), false);
  assert.equal(filtered.some((tool) => tool.name === "create_file"), false);
});

test("build profile keeps workspace edit tools", () => {
  const filtered = filterToolsForWorkProfile(tools, agentWorkProfile("build"));
  assert.ok(filtered.some((tool) => tool.name === "apply_patch"));
  assert.ok(filtered.some((tool) => tool.name === "replace_range"));
});

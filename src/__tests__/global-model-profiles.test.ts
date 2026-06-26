import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { GlobalModelProfileStore } from "../model/global-model-profile-store.js";

test("global model profiles can hold multiple OpenAI-compatible entries and switch by profile id", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "soloclaw-model-home-"));
  t.after(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  const store = new GlobalModelProfileStore(home);
  await store.set({
    id: "vsllm-gpt55",
    provider: "openai_compatible",
    protocol: "openai_responses",
    defaultBaseUrl: "https://vsllm.com/v1",
    defaultModel: "gpt-5.5",
    apiKeyEnvNames: ["VSLLM_API_KEY"],
  });
  await store.set({
    id: "vsllm-qwen",
    provider: "openai_compatible",
    protocol: "openai_chat",
    defaultBaseUrl: "https://vsllm.com/v1",
    defaultModel: "qwen-coder",
    apiKeyEnvNames: ["VSLLM_API_KEY"],
  });
  await store.setDefaultProfile("vsllm-gpt55");

  const listed = await store.list();
  const custom = listed.filter((profile) => profile.source === "global" && profile.provider === "openai_compatible");
  assert.equal(custom.length, 2);
  assert.deepEqual(custom.map((profile) => profile.id).sort(), ["vsllm-gpt55", "vsllm-qwen"]);
  assert.equal(await store.getDefaultProfile(), "vsllm-gpt55");

  const resolved = await store.resolveProfile("vsllm-gpt55");
  assert.equal(resolved.id, "vsllm-gpt55");
  assert.equal(resolved.provider, "openai_compatible");
  assert.equal(resolved.protocol, "openai_responses");
  assert.equal(resolved.defaultModel, "gpt-5.5");
  assert.equal(store.filePath, path.join(home, "model-providers.json"));
});

test("global model profiles do not write workspace model provider files", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "soloclaw-model-home-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "soloclaw-workspace-"));
  t.after(async () => {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  });

  const store = new GlobalModelProfileStore(home);
  await store.set({
    id: "global-local",
    provider: "openai_compatible",
    protocol: "openai_chat",
    defaultBaseUrl: "http://localhost:11434/v1",
    defaultModel: "qwen-local",
    apiKeyEnvNames: [],
  });
  await store.setDefaultProfile("global-local");

  await assert.rejects(fs.access(path.join(workspace, ".agent", "model-providers.json")));
  assert.equal(await store.getDefaultProfile(), "global-local");
  assert.equal(await fs.readFile(store.filePath, "utf8").then((text) => text.includes("qwen-local")), true);
});

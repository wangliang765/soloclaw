import assert from "node:assert/strict";
import test from "node:test";
import { createRemoteCommand } from "../cli/commands/remote.js";

test("createRemoteCommand renders service plans without opening platform state", async () => {
  const events: string[] = [];
  const command = createRemoteCommand({
    cwd: () => "C:/repo",
    env: {},
    createPlatform: async () => {
      events.push("platform");
      throw new Error("service should not create a platform");
    },
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({
    command: "remote",
    args: ["service", "--control-url", "http://127.0.0.1:4317", "--room", "room_1", "--json"],
    context: undefined,
  });

  assert.deepEqual(result, { matched: true });
  assert.equal(events.length, 1);
  assert.match(events[0], /^json:/);
  const plan = JSON.parse(events[0].slice("json:".length));
  assert.equal(plan.kind, "soloclaw.remote_room_service_plan");
  assert.equal(plan.roomId, "room_1");
  assert.equal(plan.entrypoint.tokenSource, "AGENT_CONTROL_TOKEN");
});

test("createRemoteCommand reports missing service control url", async () => {
  const events: string[] = [];
  const command = createRemoteCommand({
    cwd: () => "C:/repo",
    env: {},
    createPlatform: async () => {
      events.push("platform");
      throw new Error("usage should not create a platform");
    },
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "remote", args: ["service", "--room", "room_1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "error:Usage: agent remote service --control-url url --room room-id [--control-token token] [--cycles n] [--limit n] [--idle-limit n] [--interval-ms n] [--loop-interval-ms n] [--stop-when-idle] [--idle-cycles n] [--heartbeat-ttl seconds] [--status-file path] [--stop-file path] [--json]",
    "exit:1",
  ]);
});

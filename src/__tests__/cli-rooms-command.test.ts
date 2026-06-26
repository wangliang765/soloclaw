import assert from "node:assert/strict";
import test from "node:test";
import { createRoomsCommand, normalizeRoomConvenienceCommand } from "../cli/commands/rooms.js";

function createRoomsDeps(events: string[]) {
  const platform = {
    localAgent: { id: "agent_1", displayName: "Local Agent", fingerprint: "fp_1" },
    rooms: {
      createRoom: async (input: any) => {
        events.push(`create:${input.name}:${input.createdBy.type}:${input.policy.joinPolicy}:${input.policy.allowedFingerprints?.join(",") ?? ""}`);
        return {
          id: "room_1",
          name: input.name,
          policy: { joinPolicy: input.policy.joinPolicy },
          createdAt: "2026-06-26T00:00:00.000Z",
        };
      },
      listRooms: async () => [],
      getRoom: async () => undefined,
      listMembers: async () => [],
      listMessages: async () => [],
      verifyMessage: async () => "valid",
      createInvite: async () => ({ invite: {}, token: "rinv_token" }),
      verifyInvite: async () => "valid",
      listInvites: async () => [],
      revokeInvite: async () => ({}),
      joinWithInvite: async () => ({}),
      requestJoin: async () => ({}),
      approveJoin: async () => ({}),
      updateMemberAliases: async () => ({}),
      updateMemberRole: async () => ({}),
      updateMemberStatus: async () => ({}),
      sendMessage: async () => ({}),
    },
    store: {
      getAgent: async () => undefined,
      close: () => events.push("store.close"),
    },
    locks: {
      close: () => events.push("locks.close"),
    },
  };
  return {
    cwd: () => "C:/repo",
    env: {},
    createPlatform: async () => platform,
    createControlPlane: () => ({
      getRoomRoster: async () => undefined,
      getRoomAgentInbox: async () => undefined,
      ackRoomAgentInbox: async () => undefined,
      inviteRoomAgent: async () => ({}),
    }),
    writeText: (text: string) => events.push(`text:${text}`),
    writeJson: (value: unknown) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message: string) => events.push(`error:${message}`),
    setExitCode: (code: number) => events.push(`exit:${code}`),
  };
}

test("createRoomsCommand creates local-agent rooms with policy options", async () => {
  const events: string[] = [];
  const command = createRoomsCommand(createRoomsDeps(events));

  const result = await command.execute({
    command: "rooms",
    args: ["create", "--local-agent", "--join-policy", "invite_token", "--allow-local-agent", "release", "room"],
    context: undefined,
  });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "create:release room:agent:invite_token:fp_1",
    "text:room_1\trelease room\tinvite_token\t2026-06-26T00:00:00.000Z",
    "locks.close",
    "store.close",
  ]);
});

test("createRoomsCommand reports create usage and closes platform", async () => {
  const events: string[] = [];
  const command = createRoomsCommand(createRoomsDeps(events));

  const result = await command.execute({ command: "rooms", args: ["create"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "error:Usage: agent rooms create [--local-agent] [--alias alias] [--agent-response broadcast|mentions_only] [--wide-mention-policy disabled|moderators|members] [--max-routed-agent-targets n] [--require-signed-invites] <name>",
    "exit:1",
    "locks.close",
    "store.close",
  ]);
});

test("room convenience commands normalize to focused command modules", () => {
  assert.deepEqual(normalizeRoomConvenienceCommand("room", ["join", "--invite-bundle", "bundle.json"]), {
    command: "remote",
    rest: ["join-bundle", "--invite-bundle", "bundle.json"],
  });
  assert.deepEqual(normalizeRoomConvenienceCommand("room", ["pull-agent", "room_1", "agent_1"]), {
    command: "rooms",
    rest: ["pull-agent", "room_1", "agent_1"],
  });
});

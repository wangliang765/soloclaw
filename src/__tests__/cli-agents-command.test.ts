import assert from "node:assert/strict";
import test from "node:test";
import { createAgentsCommand, createIdentityCommand, type AgentsCommandDeps, type IdentityCommandDeps } from "../cli/commands/agents.js";

function createIdentityDeps(events: string[], identity: any): IdentityCommandDeps {
  return {
    createPlatform: async () => ({
      identity,
      close: () => events.push("close"),
    }),
    readOption: (args, name) => {
      const index = args.indexOf(name);
      return index >= 0 ? args[index + 1] : undefined;
    },
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  };
}

function createAgentsDeps(events: string[], platform: Record<string, unknown>): AgentsCommandDeps {
  return {
    createPlatform: async () => ({
      store: {
        listAgents: async (limit: number) => {
          events.push(`listAgents:${limit}`);
          return [{ id: "agent_1", trustStatus: "trusted", fingerprint: "fp", displayName: "Runner" }];
        },
      },
      agentHealth: {
        getSummary: async (input: Record<string, unknown>) => {
          events.push(`health:${input.now}:${input.limit}`);
          return { agents: { total: 1, responsive: 1, stale: 0, failing: 0 }, perAgent: [] };
        },
      },
      localAgent: { id: "local_agent", displayName: "Local Agent" },
      close: () => events.push("close"),
      ...platform,
    }),
    createControlPlane: (opened) => ({
      recoverStaleAgents: async (input: Record<string, unknown>) => {
        events.push(`recover:${JSON.stringify(input.actor)}:${input.now}:${input.limit}`);
        return { summary: { recovered: 1, stale: 1, skipped: 0 }, recovered: [], skipped: [] };
      },
      updateAgentTrustStatus: async (input: Record<string, unknown>) => {
        events.push(`trust:${input.agentId}:${input.trustStatus}:${input.reason}:${JSON.stringify(input.actor)}`);
        return {
          previousTrustStatus: "trusted",
          agent: { id: input.agentId, trustStatus: input.trustStatus, fingerprint: "fp2", displayName: "Remote" },
        };
      },
      rotateAgentIdentityKey: async (input: Record<string, unknown>) => {
        events.push(`rotate:${input.agentId}:${input.publicKeyPem}:${input.fingerprint}:${input.reason}:${JSON.stringify(input.actor)}`);
        return {
          previousFingerprint: "old",
          agent: { id: input.agentId, trustStatus: "trusted", fingerprint: "new", displayName: "Remote" },
        };
      },
    }),
    readOption: (args, name) => {
      const index = args.indexOf(name);
      return index >= 0 ? args[index + 1] : undefined;
    },
    readUtf8: async (file) => {
      events.push(`read:${file}`);
      return "PUBLIC KEY";
    },
    parseActorRef: (value) => ({ parsedActor: value ?? "default" }),
    agentActor: (agent) => ({ agent: agent.id }),
    parseAgentTrustStatus: (value) => `trust:${value}`,
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  };
}

test("createIdentityCommand shows existing local identity as json", async () => {
  const events: string[] = [];
  const command = createIdentityCommand(createIdentityDeps(events, {
    show: async () => ({
      identity: {
        id: "agent_1",
        machineId: "machine_1",
        displayName: "Agent",
        fingerprint: "fp",
        trustStatus: "trusted",
        capabilities: ["room"],
      },
      privateKeyPath: ".agent/identity/key.pem",
    }),
  }));

  const result = await command.execute({ command: "identity", args: ["show"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    'json:{"id":"agent_1","machineId":"machine_1","displayName":"Agent","fingerprint":"fp","trustStatus":"trusted","capabilities":["room"],"privateKeyPath":".agent/identity/key.pem"}',
    "close",
  ]);
});

test("createIdentityCommand initializes display name when requested", async () => {
  const events: string[] = [];
  const command = createIdentityCommand(createIdentityDeps(events, {
    show: async () => ({
      identity: { id: "old", machineId: "machine_1", displayName: "Old", fingerprint: "old-fp", trustStatus: "trusted", capabilities: [] },
      privateKeyPath: ".agent/identity/key.pem",
    }),
    getOrCreate: async (displayName: string) => {
      events.push(`getOrCreate:${displayName}`);
      return { id: "agent_2", machineId: "machine_1", displayName, fingerprint: "fp2", trustStatus: "trusted", capabilities: ["room"] };
    },
  }));

  const result = await command.execute({ command: "identity", args: ["init", "--display-name", "Workstation"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "getOrCreate:Workstation",
    'json:{"id":"agent_2","machineId":"machine_1","displayName":"Workstation","fingerprint":"fp2","trustStatus":"trusted","capabilities":["room"],"privateKeyPath":".agent/identity/key.pem"}',
    "close",
  ]);
});

test("createAgentsCommand lists registered agents by default", async () => {
  const events: string[] = [];
  const command = createAgentsCommand(createAgentsDeps(events, {}));

  const result = await command.execute({ command: "agents", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "listAgents:20",
    "text:agent_1\ttrusted\tfp\tRunner",
    "close",
  ]);
});

test("createAgentsCommand renders health summary as json", async () => {
  const events: string[] = [];
  const command = createAgentsCommand(createAgentsDeps(events, {}));

  const result = await command.execute({ command: "agents", args: ["health", "--now", "2026-06-26T00:00:00.000Z", "--limit", "5", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "health:2026-06-26T00:00:00.000Z:5",
    'json:{"agents":{"total":1,"responsive":1,"stale":0,"failing":0},"perAgent":[]}',
    "close",
  ]);
});

test("createAgentsCommand recovers stale agents with local agent actor", async () => {
  const events: string[] = [];
  const command = createAgentsCommand(createAgentsDeps(events, {}));

  const result = await command.execute({ command: "agents", args: ["recover-stale", "--now", "2026-06-26T00:00:00.000Z", "--limit", "7", "--local-agent", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    'recover:{"agent":"local_agent"}:2026-06-26T00:00:00.000Z:7',
    'json:{"summary":{"recovered":1,"stale":1,"skipped":0},"recovered":[],"skipped":[]}',
    "close",
  ]);
});

test("createAgentsCommand updates trust status through the control plane", async () => {
  const events: string[] = [];
  const command = createAgentsCommand(createAgentsDeps(events, {}));

  const result = await command.execute({ command: "agents", args: ["trust", "agent_2", "revoked", "--reason", "rotated", "--actor", "user:operator"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    'trust:agent_2:trust:revoked:rotated:{"parsedActor":"user:operator"}',
    "text:agent_2\ttrusted->trust:revoked\tfp2\tRemote",
    "close",
  ]);
});

test("createAgentsCommand rotates identity keys after reading the public key file", async () => {
  const events: string[] = [];
  const command = createAgentsCommand(createAgentsDeps(events, {}));

  const result = await command.execute({ command: "agents", args: ["rotate-key", "agent_2", "--public-key-file", "key.pub", "--fingerprint", "fp-new", "--reason", "rotation", "--local-agent"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "read:key.pub",
    'rotate:agent_2:PUBLIC KEY:fp-new:rotation:{"agent":"local_agent"}',
    "text:agent_2\told->new\ttrust=trusted\tRemote",
    "close",
  ]);
});

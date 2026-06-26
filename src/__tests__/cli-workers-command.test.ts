import assert from "node:assert/strict";
import test from "node:test";
import { createAssignmentsCommand, createOperatorCommand, createSchedulerCommand, createWorkersCommand } from "../cli/commands/workers.js";

test("createWorkersCommand registers local workers", async () => {
  const events: string[] = [];
  const command = createWorkersCommand({
    createPlatform: async () => ({
      localAgent: { id: "agent_1", machineId: "machine_1", orgId: "org_1", displayName: "Local Agent" },
      identity: { verifyWorkerHeartbeatEnvelope: async () => "valid" },
      workers: {
        register: async (input: Record<string, unknown>) => {
          events.push(`register:${input.agentId}:${input.displayName}`);
          return { id: "worker_1", status: "online" };
        },
      },
      workerRunner: {},
      workerHealth: {},
      close: () => events.push("close"),
    }),
    parseArgs: () => ({ options: { localAgent: true, ttlSeconds: 60 }, positionals: [] }),
    parseActorRef: (value) => ({ type: "user", id: value ?? "local-user" }),
    agentActor: (agent) => ({ type: "agent", id: agent.id }),
    isWorkerHeartbeatEnvelope: () => false,
    renderWorker: (worker) => events.push(`worker:${JSON.stringify(worker)}`),
    renderRunOnce: (result) => events.push(`run:${JSON.stringify(result)}`),
    renderPoll: (result) => events.push(`poll:${JSON.stringify(result)}`),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "workers", args: ["register"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["register:agent_1:Local Agent", 'worker:{"id":"worker_1","status":"online"}', "close"]);
});

test("createWorkersCommand verifies signed worker heartbeats", async () => {
  const events: string[] = [];
  const command = createWorkersCommand({
    createPlatform: async () => ({
      localAgent: { id: "agent_1", displayName: "Local Agent" },
      identity: {
        verifyWorkerHeartbeatEnvelope: async (envelope) => {
          events.push(`verify:${JSON.stringify(envelope)}`);
          return "invalid";
        },
      },
      workers: {
        get: async () => ({ metadata: { heartbeatEnvelope: { signature: "sig" } } }),
      },
      workerRunner: {},
      workerHealth: {},
      close: () => events.push("close"),
    }),
    parseArgs: () => ({ options: {}, positionals: [] }),
    parseActorRef: (value) => ({ type: "user", id: value ?? "local-user" }),
    agentActor: (agent) => ({ type: "agent", id: agent.id }),
    isWorkerHeartbeatEnvelope: () => true,
    renderWorker: (worker) => events.push(`worker:${JSON.stringify(worker)}`),
    renderRunOnce: (result) => events.push(`run:${JSON.stringify(result)}`),
    renderPoll: (result) => events.push(`poll:${JSON.stringify(result)}`),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "workers", args: ["verify-heartbeat", "worker_1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ['verify:{"signature":"sig"}', "text:invalid", "exit:2", "close"]);
});

test("createWorkersCommand reports missing poll worker id", async () => {
  const events: string[] = [];
  const command = createWorkersCommand({
    createPlatform: async () => ({
      localAgent: { id: "agent_1", displayName: "Local Agent" },
      identity: { verifyWorkerHeartbeatEnvelope: async () => "valid" },
      workers: {},
      workerRunner: {},
      workerHealth: {},
      close: () => events.push("close"),
    }),
    parseArgs: () => ({ options: {}, positionals: [] }),
    parseActorRef: (value) => ({ type: "user", id: value ?? "local-user" }),
    agentActor: (agent) => ({ type: "agent", id: agent.id }),
    isWorkerHeartbeatEnvelope: () => false,
    renderWorker: (worker) => events.push(`worker:${JSON.stringify(worker)}`),
    renderRunOnce: (result) => events.push(`run:${JSON.stringify(result)}`),
    renderPoll: (result) => events.push(`poll:${JSON.stringify(result)}`),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "workers", args: ["poll"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Usage: agent workers poll <worker-id> [--limit n] [--idle-limit n] [--interval-ms n] [--ttl seconds] [--require-signed-lease] [--local-agent|--actor user:id|agent:id]", "exit:1", "close"]);
});

test("createSchedulerCommand runs loop with signal hooks", async () => {
  const events: string[] = [];
  const command = createSchedulerCommand({
    createPlatform: async () => ({
      localAgent: { id: "agent_1", displayName: "Local Agent" },
      scheduler: {
        run: async (input: Record<string, unknown>) => {
          events.push(`run:${input.workerId}:${Boolean(input.signal)}`);
          return { ticks: 2 };
        },
      },
      close: () => events.push("close"),
    }),
    parseArgs: () => ({ options: { workerId: "worker_1", maxTicks: 2 }, positionals: [] }),
    parseActorRef: (value) => ({ type: "user", id: value ?? "local-user" }),
    agentActor: (agent) => ({ type: "agent", id: agent.id }),
    onSignal: (signal) => events.push(`on:${signal}`),
    offSignal: (signal) => events.push(`off:${signal}`),
    renderTick: (result) => events.push(`tick:${JSON.stringify(result)}`),
    renderRun: (result) => events.push(`render:${JSON.stringify(result)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "scheduler", args: ["run"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["on:SIGINT", "on:SIGTERM", "run:worker_1:true", 'render:{"ticks":2}', "off:SIGINT", "off:SIGTERM", "close"]);
});

test("createAssignmentsCommand assigns sessions", async () => {
  const events: string[] = [];
  const command = createAssignmentsCommand({
    createPlatform: async () => ({
      assignments: {
        assign: async (input: Record<string, unknown>) => {
          events.push(`assign:${input.sessionId}:${input.workerId}`);
          return { id: "assign_1", status: "queued" };
        },
      },
      close: () => events.push("close"),
    }),
    parseArgs: () => ({ options: { workerId: "worker_1", actor: "user:me" }, positionals: ["session_1"] }),
    parseActorRef: (value) => ({ type: "user", id: value ?? "local-user" }),
    renderAssignment: (assignment) => events.push(`assignment:${JSON.stringify(assignment)}`),
    renderRecovery: (result) => events.push(`recovery:${JSON.stringify(result)}`),
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "assignments", args: ["assign-session", "session_1", "--worker", "worker_1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["assign:session_1:worker_1", 'assignment:{"id":"assign_1","status":"queued"}', "close"]);
});

test("createAssignmentsCommand cleans lease nonces", async () => {
  const events: string[] = [];
  const command = createAssignmentsCommand({
    createPlatform: async () => ({
      assignments: {
        cleanupLeaseNonces: async () => ({ deleted: 3, before: "2026-06-26T00:00:00.000Z" }),
      },
      close: () => events.push("close"),
    }),
    parseArgs: () => ({ options: { actor: "user:me" }, positionals: [] }),
    parseActorRef: (value) => ({ type: "user", id: value ?? "local-user" }),
    renderAssignment: (assignment) => events.push(`assignment:${JSON.stringify(assignment)}`),
    renderRecovery: (result) => events.push(`recovery:${JSON.stringify(result)}`),
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "assignments", args: ["cleanup-nonces"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["text:deleted=3\tbefore=2026-06-26T00:00:00.000Z", "close"]);
});

test("createOperatorCommand writes json status view", async () => {
  const events: string[] = [];
  const command = createOperatorCommand({
    createControl: async () => ({
      control: {
        getState: async (request: Record<string, unknown>) => {
          events.push(`state:${request.operatorProjection}`);
          return { operator: { generatedAt: "now", items: [1] } };
        },
        getOperatorDetail: async () => ({ item: { id: "item_1" } }),
      },
      close: () => events.push("close"),
    }),
    parseArgs: () => ({ json: true, publicView: true, positionals: [] }),
    selectItem: () => undefined,
    jsonView: (operatorView) => ({ view: operatorView }),
    renderView: (operatorView) => events.push(`view:${JSON.stringify(operatorView)}`),
    renderDetail: (detail) => events.push(`detail:${JSON.stringify(detail)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "operator", args: ["status", "--json", "--public"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["state:public", 'json:{"view":{"generatedAt":"now","items":[1]}}', "close"]);
});

test("createOperatorCommand reports missing show item id", async () => {
  const events: string[] = [];
  const command = createOperatorCommand({
    createControl: async () => ({
      control: {
        getState: async () => ({ operator: { generatedAt: "now", items: [] } }),
        getOperatorDetail: async () => ({ item: undefined }),
      },
      close: () => events.push("close"),
    }),
    parseArgs: () => ({ positionals: [] }),
    selectItem: () => undefined,
    jsonView: (operatorView) => operatorView,
    renderView: (operatorView) => events.push(`view:${JSON.stringify(operatorView)}`),
    renderDetail: (detail) => events.push(`detail:${JSON.stringify(detail)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "operator", args: ["show"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Usage: agent operator show <item-id-or-ref-id> [--select n] [--json]", "exit:1", "close"]);
});

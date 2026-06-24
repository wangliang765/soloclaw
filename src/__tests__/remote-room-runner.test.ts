import { strict as assert } from "node:assert";
import { generateKeyPairSync, sign } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ControlPlaneService } from "../control-plane/control-plane-service.js";
import { DaemonLifecycleController } from "../daemon/daemon-lifecycle.js";
import type { ActorRef, AgentHeartbeatEnvelope, AgentIdentity, RoomDeliveryAckEnvelope, RoomMessageIntentEnvelope } from "../domain/index.js";
import { agentHeartbeatEnvelopeSigningPayload, roomDeliveryAckEnvelopeSigningPayload, roomMessageIntentEnvelopeSigningPayload } from "../domain/index.js";
import { createLocalPlatform } from "../platform/local-platform.js";
import { RemoteRoomRunner } from "../remote/remote-room-runner.js";
import { startLocalRoomWebServer } from "../web/local-room-web-server.js";

test("remote room runner can post a signed room message intent as the enrolled agent", async (t) => {
  const bodies: Array<{ actor?: string; kind?: string; body?: string; messageEnvelope?: RoomMessageIntentEnvelope }> = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    assert.equal(request.headers["x-agent-control-token"], "runner-token");
    if (request.method === "POST" && url.pathname === "/api/rooms/room_chat/messages") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { actor?: string; kind?: string; body?: string; messageEnvelope?: RoomMessageIntentEnvelope };
      bodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        message: {
          id: "msg_remote_chat",
          roomId: "room_chat",
          sender: { type: "agent", id: "agent_remote_chat", displayName: "Remote Chat" },
          kind: body.kind,
          body: body.body,
          createdAt: "2026-06-21T00:00:00.000Z",
        },
      }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const runner = new RemoteRoomRunner({
    controlUrl: `http://127.0.0.1:${address.port}`,
    token: "runner-token",
    roomId: "room_chat",
    localAgent: { id: "agent_remote_chat", machineId: "machine_chat", displayName: "Remote Chat" },
    identity: {
      signRoomDeliveryAckEnvelope: async (envelope) => `ed25519:${envelope.messageId}:ack`,
      signAgentHeartbeatEnvelope: async (envelope) => `ed25519:${envelope.status}:heartbeat`,
      signRoomMessageIntentEnvelope: async (envelope) => `ed25519:${envelope.agentId}:${envelope.nonce}:message`,
    },
  });

  const result = await runner.say({ kind: "chat", body: "@agent:agent_owner hello from the remote machine" });

  assert.equal(result.message.id, "msg_remote_chat");
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]?.actor, "agent:agent_remote_chat");
  assert.equal(bodies[0]?.kind, "chat");
  assert.equal(bodies[0]?.body, "@agent:agent_owner hello from the remote machine");
  assert.equal(bodies[0]?.messageEnvelope?.version, 1);
  assert.equal(bodies[0]?.messageEnvelope?.roomId, "room_chat");
  assert.equal(bodies[0]?.messageEnvelope?.agentId, "agent_remote_chat");
  assert.equal(bodies[0]?.messageEnvelope?.kind, "chat");
  assert.equal(bodies[0]?.messageEnvelope?.body, "@agent:agent_owner hello from the remote machine");
  assert.equal(bodies[0]?.messageEnvelope?.sentBy.id, "agent_remote_chat");
  assert.match(bodies[0]?.messageEnvelope?.nonce ?? "", /^[0-9a-f-]{36}$/i);
  assert.match(bodies[0]?.messageEnvelope?.signature ?? "", /^ed25519:agent_remote_chat:.*:message$/);
});

test("control plane requires signed remote room message intents and rejects replay", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-remote-message-intent-"));
  let platform: Awaited<ReturnType<typeof createLocalPlatform>> | undefined;
  t.after(async () => {
    platform?.locks.close();
    platform?.store.close();
    await fs.rm(workspace, { recursive: true, force: true });
  });
  platform = await createLocalPlatform(workspace);
  const control = new ControlPlaneService(platform);
  const owner = { type: "user" as const, id: "owner", displayName: "Owner" };
  const room = await platform.rooms.createRoom({
    name: "Signed remote room",
    createdBy: owner,
    policy: { joinPolicy: "manual", defaultCapabilities: [] },
  });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const remoteAgent: AgentIdentity = {
    id: "agent_remote_signed" as AgentIdentity["id"],
    machineId: "machine_remote_signed" as AgentIdentity["machineId"],
    displayName: "Remote Signed",
    publicKeyPem,
    fingerprint: "SHA256:test",
    capabilities: [],
    allowedProjects: [],
    trustStatus: "trusted",
    createdAt: "2026-06-21T00:00:00.000Z",
  };
  await platform.store.registerAgent(remoteAgent);
  await platform.store.addRoomMember({
    roomId: room.id,
    actor: { type: "agent", id: remoteAgent.id, displayName: remoteAgent.displayName },
    role: "participant",
    status: "active",
    joinedAt: "2026-06-21T00:00:00.000Z",
  });

  await assert.rejects(
    () => control.sendRoomMessage({
      roomId: room.id,
      sender: { type: "agent", id: remoteAgent.id, displayName: remoteAgent.displayName },
      kind: "chat",
      body: "unsigned remote speech",
    }),
    /Signed room message intent envelope is required/,
  );

  const envelope = signRemoteMessageIntent({
    roomId: room.id,
    agentId: remoteAgent.id,
    kind: "chat",
    body: "@owner signed hello",
    sentBy: { type: "agent", id: remoteAgent.id, displayName: remoteAgent.displayName },
    privateKey,
  });
  const message = await control.sendRoomMessage({
    roomId: room.id,
    sender: { type: "agent", id: remoteAgent.id, displayName: remoteAgent.displayName },
    kind: "chat",
    body: "@owner signed hello",
    messageEnvelope: envelope,
  });

  assert.equal(message.sender.id, remoteAgent.id);
  assert.equal(message.body, "@owner signed hello");
  assert.equal(message.metadata?.remoteIntentSignatureStatus, "valid");
  assert.equal(message.metadata?.remoteIntentNonce, envelope.nonce);
  await assert.rejects(
    () => control.sendRoomMessage({
      roomId: room.id,
      sender: { type: "agent", id: remoteAgent.id, displayName: remoteAgent.displayName },
      kind: "chat",
      body: "@owner signed hello",
      messageEnvelope: envelope,
    }),
    /Room message intent nonce replay detected/,
  );
});

test("control plane rejects signed remote room operations from revoked agents", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-remote-revoked-trust-"));
  let platform: Awaited<ReturnType<typeof createLocalPlatform>> | undefined;
  t.after(async () => {
    platform?.locks.close();
    platform?.store.close();
    await fs.rm(workspace, { recursive: true, force: true });
  });
  platform = await createLocalPlatform(workspace);
  const control = new ControlPlaneService(platform);
  const owner = { type: "user" as const, id: "owner", displayName: "Owner" };
  const room = await platform.rooms.createRoom({
    name: "Revoked remote room",
    createdBy: owner,
    policy: { joinPolicy: "manual", defaultCapabilities: [] },
  });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const remoteActor = { type: "agent" as const, id: "agent_remote_revoked", displayName: "Remote Revoked" };
  const remoteAgent: AgentIdentity = {
    id: remoteActor.id as AgentIdentity["id"],
    machineId: "machine_remote_revoked" as AgentIdentity["machineId"],
    displayName: remoteActor.displayName,
    publicKeyPem,
    fingerprint: "SHA256:revoked",
    capabilities: [],
    allowedProjects: [],
    trustStatus: "revoked",
    createdAt: "2026-06-22T00:00:00.000Z",
  };
  await platform.store.registerAgent(remoteAgent);
  await platform.store.addRoomMember({
    roomId: room.id,
    actor: remoteActor,
    role: "participant",
    status: "active",
    joinedAt: "2026-06-22T00:00:00.000Z",
  });

  const messageEnvelope = signRemoteMessageIntent({
    roomId: room.id,
    agentId: remoteAgent.id,
    kind: "chat",
    body: "@owner revoked speech",
    sentBy: remoteActor,
    privateKey,
  });
  await assert.rejects(
    () => control.sendRoomMessage({
      roomId: room.id,
      sender: remoteActor,
      kind: "chat",
      body: "@owner revoked speech",
      messageEnvelope,
    }),
    /revoked/,
  );

  const routedMessage = await platform.rooms.sendMessage({
    roomId: room.id,
    sender: owner,
    kind: "task",
    body: `@agent:${remoteAgent.id} please acknowledge`,
  });
  const ackEnvelope = signRemoteDeliveryAck({
    roomId: room.id,
    agentId: remoteAgent.id,
    messageId: routedMessage.id,
    acknowledgedBy: remoteActor,
    privateKey,
  });
  await assert.rejects(
    () => control.ackRoomAgentInbox({
      roomId: room.id,
      agentId: remoteAgent.id,
      messageId: routedMessage.id,
      actor: remoteActor,
      ackEnvelope,
    }),
    /revoked/,
  );

  const heartbeatEnvelope = signRemoteHeartbeat({
    roomId: room.id,
    agentId: remoteAgent.id,
    machineId: remoteAgent.machineId,
    status: "online",
    heartbeatBy: remoteActor,
    privateKey,
  });
  await assert.rejects(
    () => control.heartbeatAgent({
      actor: remoteActor,
      agentId: remoteAgent.id,
      status: "online",
      roomId: room.id,
      heartbeatEnvelope,
    }),
    /revoked/,
  );
});

test("remote say CLI posts a room message through the control plane", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-remote-say-cli-"));
  const bodies: Array<{ actor?: string; kind?: string; body?: string; messageEnvelope?: RoomMessageIntentEnvelope }> = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    assert.equal(request.headers["x-agent-control-token"], "runner-token");
    if (request.method === "POST" && url.pathname === "/api/rooms/room_cli/messages") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { actor?: string; kind?: string; body?: string; messageEnvelope?: RoomMessageIntentEnvelope };
      bodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        message: {
          id: "msg_cli_chat",
          roomId: "room_cli",
          sender: { type: "agent", id: body.actor?.replace("agent:", "") ?? "agent_unknown" },
          kind: body.kind,
          body: body.body,
          createdAt: "2026-06-21T00:00:00.000Z",
        },
      }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(workspace, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "remote",
    "say",
    "--control-url",
    `http://127.0.0.1:${address.port}`,
    "--control-token",
    "runner-token",
    "--room",
    "room_cli",
    "--kind",
    "task",
    "--json",
    "@owner",
    "hello from cli",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as { message?: { id?: string } };
  assert.equal(parsed.message?.id, "msg_cli_chat");
  assert.equal(bodies.length, 1);
  assert.match(bodies[0]?.actor ?? "", /^agent:agent_/);
  assert.equal(bodies[0]?.kind, "task");
  assert.equal(bodies[0]?.body, "@owner hello from cli");
  assert.equal(bodies[0]?.messageEnvelope?.kind, "task");
  assert.equal(bodies[0]?.messageEnvelope?.body, "@owner hello from cli");
  assert.match(bodies[0]?.messageEnvelope?.signature ?? "", /^ed25519:/);
});

test("remote room runner run exposes routed messages so adapters can post signed replies", async (t) => {
  let inboxCalls = 0;
  const replyBodies: Array<{ actor?: string; kind?: string; body?: string; messageEnvelope?: RoomMessageIntentEnvelope }> = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    assert.equal(request.headers["x-agent-control-token"], "runner-token");
    if (request.method === "GET" && url.pathname === "/api/rooms/room_adapter/agent-inbox") {
      inboxCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        messages: inboxCalls === 1
          ? [{ id: "msg_adapter_one", kind: "task", body: "@agent:agent_adapter inspect this", createdAt: "2026-06-21T00:00:00.000Z" }]
          : [],
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/rooms/room_adapter/agent-inbox/ack") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { agentId?: string; messageId?: string; ackEnvelope?: RoomDeliveryAckEnvelope };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        cursor: {
          roomId: "room_adapter",
          agentId: body.agentId,
          lastDeliveredMessageId: body.messageId,
          lastAckEnvelope: body.ackEnvelope,
        },
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/agents/agent_adapter/heartbeat") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { status?: string; heartbeatEnvelope?: AgentHeartbeatEnvelope };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        agent: {
          id: "agent_adapter",
          machineId: "machine_adapter",
          heartbeatStatus: body.status,
          lastHeartbeatAt: body.heartbeatEnvelope?.heartbeatAt,
        },
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/rooms/room_adapter/messages") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { actor?: string; kind?: string; body?: string; messageEnvelope?: RoomMessageIntentEnvelope };
      replyBodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        message: {
          id: "msg_adapter_reply",
          roomId: "room_adapter",
          sender: { type: "agent", id: "agent_adapter", displayName: "Adapter Agent" },
          kind: body.kind,
          body: body.body,
          createdAt: "2026-06-21T00:00:01.000Z",
        },
      }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const runner = new RemoteRoomRunner({
    controlUrl: `http://127.0.0.1:${address.port}`,
    token: "runner-token",
    roomId: "room_adapter",
    localAgent: { id: "agent_adapter", machineId: "machine_adapter", displayName: "Adapter Agent" },
    identity: {
      signRoomDeliveryAckEnvelope: async (envelope) => `ed25519:${envelope.messageId}:adapter-ack`,
      signAgentHeartbeatEnvelope: async (envelope) => `ed25519:${envelope.status}:adapter-heartbeat`,
      signRoomMessageIntentEnvelope: async (envelope) => `ed25519:${envelope.agentId}:${envelope.nonce}:adapter-message`,
    },
  });
  const handled: string[] = [];
  const result = await runner.run({
    maxCycles: 2,
    maxMessagesPerPoll: 1,
    maxIdlePolls: 1,
    idleIntervalMs: 0,
    intervalMs: 0,
    stopWhenIdle: true,
    maxIdleCycles: 1,
    baseBackoffMs: 0,
    maxBackoffMs: 0,
    maxErrors: 1,
    heartbeatTtlSeconds: 30,
    onMessage: async (message) => {
      handled.push(message.id);
      await runner.say({ kind: "chat", body: `@owner handled ${message.id}` });
    },
  });

  assert.equal(result.stopReason, "idle");
  assert.deepEqual(handled, ["msg_adapter_one"]);
  assert.equal(replyBodies.length, 1);
  assert.equal(replyBodies[0]?.actor, "agent:agent_adapter");
  assert.equal(replyBodies[0]?.body, "@owner handled msg_adapter_one");
  assert.equal(replyBodies[0]?.messageEnvelope?.kind, "chat");
  assert.match(replyBodies[0]?.messageEnvelope?.signature ?? "", /^ed25519:agent_adapter:.*:adapter-message$/);
});

test("remote room runner run emits daemon lifecycle metrics for idle stop", async (t) => {
  let inboxCalls = 0;
  const heartbeatStatuses: string[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    assert.equal(request.headers["x-agent-control-token"], "runner-token");
    if (request.method === "GET" && url.pathname === "/api/rooms/room_lifecycle/agent-inbox") {
      inboxCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ messages: [] }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/agents/agent_lifecycle/heartbeat") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { status?: string; heartbeatEnvelope?: AgentHeartbeatEnvelope };
      heartbeatStatuses.push(body.status ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        agent: {
          id: "agent_lifecycle",
          machineId: "machine_lifecycle",
          heartbeatStatus: body.status,
          lastHeartbeatAt: body.heartbeatEnvelope?.heartbeatAt,
        },
      }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const lifecycle = new DaemonLifecycleController("remote-room-runner");
  const events: string[] = [];
  lifecycle.onEvent((event) => {
    events.push(event.type);
  });
  const runner = new RemoteRoomRunner({
    controlUrl: `http://127.0.0.1:${address.port}`,
    token: "runner-token",
    roomId: "room_lifecycle",
    localAgent: { id: "agent_lifecycle", machineId: "machine_lifecycle", displayName: "Lifecycle Agent" },
    identity: {
      signRoomDeliveryAckEnvelope: async (envelope) => `ed25519:${envelope.messageId}:lifecycle-ack`,
      signAgentHeartbeatEnvelope: async (envelope) => `ed25519:${envelope.status}:lifecycle-heartbeat`,
      signRoomMessageIntentEnvelope: async (envelope) => `ed25519:${envelope.agentId}:${envelope.nonce}:lifecycle-message`,
    },
  });

  const result = await runner.run({
    maxCycles: 3,
    maxMessagesPerPoll: 1,
    maxIdlePolls: 1,
    idleIntervalMs: 0,
    intervalMs: 0,
    stopWhenIdle: true,
    maxIdleCycles: 1,
    baseBackoffMs: 0,
    maxBackoffMs: 0,
    maxErrors: 1,
    heartbeatTtlSeconds: 30,
    lifecycle,
  });

  assert.equal(result.stopReason, "idle");
  assert.equal(inboxCalls, 1);
  assert.deepEqual(events, ["started", "tick", "idle", "stopped"]);
  assert.equal(result.lifecycle.service, "remote-room-runner");
  assert.equal(result.lifecycle.phase, "stopped");
  assert.equal(result.lifecycle.stopReason, "idle");
  assert.equal(result.lifecycle.metrics.tickCount, 1);
  assert.equal(result.lifecycle.metrics.idleCount, 1);
  assert.equal(result.lifecycle.metrics.messagesProcessed, 0);
  assert.deepEqual(heartbeatStatuses, ["online", "idle", "idle"]);
});

test("remote room runner run honors daemon shutdown requests before polling inbox", async (t) => {
  let inboxCalls = 0;
  const heartbeatStatuses: string[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    assert.equal(request.headers["x-agent-control-token"], "runner-token");
    if (request.method === "GET" && url.pathname === "/api/rooms/room_shutdown/agent-inbox") {
      inboxCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ messages: [] }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/agents/agent_shutdown/heartbeat") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { status?: string; heartbeatEnvelope?: AgentHeartbeatEnvelope };
      heartbeatStatuses.push(body.status ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        agent: {
          id: "agent_shutdown",
          machineId: "machine_shutdown",
          heartbeatStatus: body.status,
          lastHeartbeatAt: body.heartbeatEnvelope?.heartbeatAt,
        },
      }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const lifecycle = new DaemonLifecycleController("remote-room-runner");
  await lifecycle.requestShutdown("operator stop");
  const runner = new RemoteRoomRunner({
    controlUrl: `http://127.0.0.1:${address.port}`,
    token: "runner-token",
    roomId: "room_shutdown",
    localAgent: { id: "agent_shutdown", machineId: "machine_shutdown", displayName: "Shutdown Agent" },
    identity: {
      signRoomDeliveryAckEnvelope: async (envelope) => `ed25519:${envelope.messageId}:shutdown-ack`,
      signAgentHeartbeatEnvelope: async (envelope) => `ed25519:${envelope.status}:shutdown-heartbeat`,
      signRoomMessageIntentEnvelope: async (envelope) => `ed25519:${envelope.agentId}:${envelope.nonce}:shutdown-message`,
    },
  });

  const result = await runner.run({
    maxCycles: 3,
    maxMessagesPerPoll: 1,
    maxIdlePolls: 1,
    idleIntervalMs: 0,
    intervalMs: 0,
    stopWhenIdle: true,
    maxIdleCycles: 1,
    baseBackoffMs: 0,
    maxBackoffMs: 0,
    maxErrors: 1,
    heartbeatTtlSeconds: 30,
    lifecycle,
  });

  assert.equal(result.stopReason, "shutdown_requested");
  assert.equal(result.cycles, 0);
  assert.equal(inboxCalls, 0);
  assert.equal(result.lifecycle.phase, "stopped");
  assert.equal(result.lifecycle.stopReason, "shutdown_requested");
  assert.equal(result.lifecycle.shutdownRequestedAt !== undefined, true);
  assert.deepEqual(heartbeatStatuses, ["offline"]);
});

test("remote run CLI can post signed template replies for routed messages", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-remote-run-reply-cli-"));
  let inboxCalls = 0;
  const replyBodies: Array<{ actor?: string; kind?: string; body?: string; messageEnvelope?: RoomMessageIntentEnvelope }> = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    assert.equal(request.headers["x-agent-control-token"], "runner-token");
    if (request.method === "GET" && url.pathname === "/api/rooms/room_cli_run/agent-inbox") {
      inboxCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        messages: inboxCalls === 1
          ? [{ id: "msg_cli_run_one", kind: "task", body: "@agent:any please answer", createdAt: "2026-06-21T00:00:00.000Z" }]
          : [],
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/rooms/room_cli_run/agent-inbox/ack") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { agentId?: string; messageId?: string; ackEnvelope?: RoomDeliveryAckEnvelope };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        cursor: {
          roomId: "room_cli_run",
          agentId: body.agentId,
          lastDeliveredMessageId: body.messageId,
          lastAckEnvelope: body.ackEnvelope,
        },
      }));
      return;
    }
    const heartbeatMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/heartbeat$/);
    if (request.method === "POST" && heartbeatMatch) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { status?: string; heartbeatEnvelope?: AgentHeartbeatEnvelope };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        agent: {
          id: decodeURIComponent(heartbeatMatch[1]),
          machineId: body.heartbeatEnvelope?.machineId ?? "machine_cli_run",
          heartbeatStatus: body.status,
          lastHeartbeatAt: body.heartbeatEnvelope?.heartbeatAt,
          heartbeatExpiresAt: body.heartbeatEnvelope?.expiresAt,
          lastRoomId: body.heartbeatEnvelope?.roomId,
        },
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/rooms/room_cli_run/messages") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { actor?: string; kind?: string; body?: string; messageEnvelope?: RoomMessageIntentEnvelope };
      replyBodies.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        message: {
          id: "msg_cli_run_reply",
          roomId: "room_cli_run",
          sender: { type: "agent", id: body.actor?.replace("agent:", "") ?? "agent_unknown" },
          kind: body.kind,
          body: body.body,
          createdAt: "2026-06-21T00:00:01.000Z",
        },
      }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(workspace, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const statusFile = path.join(".agent", "tmp", "remote-room-status.json");

  const result = await run(process.execPath, [
    cli,
    "remote",
    "run",
    "--control-url",
    `http://127.0.0.1:${address.port}`,
    "--control-token",
    "runner-token",
    "--room",
    "room_cli_run",
    "--cycles",
    "2",
    "--limit",
    "1",
    "--idle-limit",
    "1",
    "--interval-ms",
    "0",
    "--loop-interval-ms",
    "0",
    "--stop-when-idle",
    "--idle-cycles",
    "1",
    "--heartbeat-ttl",
    "30",
    "--reply-template",
    "@owner handled {messageId}",
    "--status-file",
    statusFile,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as { messagesProcessed?: number };
  assert.equal(parsed.messagesProcessed, 1);
  const status = JSON.parse(await fs.readFile(path.join(workspace, statusFile), "utf8")) as {
    kind?: string;
    roomId?: string;
    agentId?: string;
    status?: string;
    stopReason?: string;
    messagesProcessed?: number;
    lastAckMessageId?: string;
    errorCount?: number;
    lastHeartbeat?: {
      status?: string;
      lastHeartbeatAt?: string;
      heartbeatExpiresAt?: string;
      lastRoomId?: string;
    };
    lifecycle?: {
      phase?: string;
      stopReason?: string;
      metrics?: { tickCount?: number; idleCount?: number; messagesProcessed?: number };
    };
  };
  assert.equal(status.kind, "soloclaw.remote_room_runner_status");
  assert.equal(status.roomId, "room_cli_run");
  assert.match(status.agentId ?? "", /^agent_/);
  assert.equal(status.status, "stopped");
  assert.equal(status.stopReason, "idle");
  assert.equal(status.messagesProcessed, 1);
  assert.equal(status.lastAckMessageId, "msg_cli_run_one");
  assert.equal(status.errorCount, 0);
  assert.equal(status.lastHeartbeat?.status, "idle");
  assert.match(status.lastHeartbeat?.lastHeartbeatAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.match(status.lastHeartbeat?.heartbeatExpiresAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(status.lastHeartbeat?.lastRoomId, "room_cli_run");
  assert.equal(status.lifecycle?.phase, "stopped");
  assert.equal(status.lifecycle?.stopReason, "idle");
  assert.equal(status.lifecycle?.metrics?.tickCount, 2);
  assert.equal(status.lifecycle?.metrics?.idleCount, 1);
  assert.equal(status.lifecycle?.metrics?.messagesProcessed, 1);
  assert.doesNotMatch(JSON.stringify(status), /runner-token/);
  assert.equal(replyBodies.length, 1);
  assert.match(replyBodies[0]?.actor ?? "", /^agent:agent_/);
  assert.equal(replyBodies[0]?.body, "@owner handled msg_cli_run_one");
  assert.match(replyBodies[0]?.messageEnvelope?.signature ?? "", /^ed25519:/);
});

test("remote run CLI stop-file requests shutdown before polling inbox", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-remote-run-stop-file-cli-"));
  let inboxCalls = 0;
  const heartbeatStatuses: string[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    assert.equal(request.headers["x-agent-control-token"], "runner-token");
    if (request.method === "GET" && url.pathname === "/api/rooms/room_cli_stop/agent-inbox") {
      inboxCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ messages: [] }));
      return;
    }
    const heartbeatMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/heartbeat$/);
    if (request.method === "POST" && heartbeatMatch) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { status?: string; heartbeatEnvelope?: AgentHeartbeatEnvelope };
      heartbeatStatuses.push(body.status ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        agent: {
          id: decodeURIComponent(heartbeatMatch[1]),
          machineId: body.heartbeatEnvelope?.machineId ?? "machine_cli_stop",
          heartbeatStatus: body.status,
          lastHeartbeatAt: body.heartbeatEnvelope?.heartbeatAt,
        },
      }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(workspace, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const stopFile = path.join(".agent", "tmp", "remote-room.stop");
  const statusFile = path.join(".agent", "tmp", "remote-room-status.json");
  await fs.mkdir(path.join(workspace, ".agent", "tmp"), { recursive: true });
  await fs.writeFile(path.join(workspace, stopFile), "operator stop\n", "utf8");

  const result = await run(process.execPath, [
    cli,
    "remote",
    "run",
    "--control-url",
    `http://127.0.0.1:${address.port}`,
    "--control-token",
    "runner-token",
    "--room",
    "room_cli_stop",
    "--cycles",
    "3",
    "--limit",
    "1",
    "--idle-limit",
    "1",
    "--interval-ms",
    "0",
    "--loop-interval-ms",
    "0",
    "--stop-when-idle",
    "--idle-cycles",
    "1",
    "--heartbeat-ttl",
    "30",
    "--stop-file",
    stopFile,
    "--status-file",
    statusFile,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as { stopReason?: string; cycles?: number; lifecycle?: { stopReason?: string } };
  assert.equal(parsed.stopReason, "shutdown_requested");
  assert.equal(parsed.cycles, 0);
  assert.equal(parsed.lifecycle?.stopReason, "shutdown_requested");
  assert.equal(inboxCalls, 0);
  assert.deepEqual(heartbeatStatuses, ["offline"]);
  const status = JSON.parse(await fs.readFile(path.join(workspace, statusFile), "utf8")) as {
    kind?: string;
    status?: string;
    stopReason?: string;
    cycles?: number;
    messagesProcessed?: number;
  };
  assert.equal(status.kind, "soloclaw.remote_room_runner_status");
  assert.equal(status.status, "stopped");
  assert.equal(status.stopReason, "shutdown_requested");
  assert.equal(status.cycles, 0);
  assert.equal(status.messagesProcessed, 0);
  assert.doesNotMatch(JSON.stringify(status), /runner-token|operator stop/);
});

test("remote run CLI stop-file must stay inside the workspace", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-remote-run-stop-file-outside-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "remote",
    "run",
    "--control-url",
    "http://127.0.0.1:9",
    "--control-token",
    "runner-token",
    "--room",
    "room_cli_stop_outside",
    "--stop-file",
    path.join("..", "remote-room.stop"),
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /--stop-file must stay inside the current workspace/);
  assert.equal(result.stdout, "");
});

test("remote service CLI prints a token-safe service plan for supervising a room runner", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-remote-service-plan-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "remote",
    "service",
    "--control-url",
    "http://127.0.0.1:4317",
    "--control-token",
    "runner-token",
    "--room",
    "room_service_plan",
    "--cycles",
    "50",
    "--limit",
    "3",
    "--idle-limit",
    "1",
    "--interval-ms",
    "500",
    "--loop-interval-ms",
    "750",
    "--stop-when-idle",
    "--idle-cycles",
    "4",
    "--heartbeat-ttl",
    "45",
    "--status-file",
    ".agent/tmp/remote-room-status.json",
    "--stop-file",
    ".agent/tmp/remote-room.stop",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    kind?: string;
    workspace?: string;
    roomId?: string;
    serviceName?: string;
    supervision?: { installState?: string };
    entrypoint?: { foregroundCommand?: string; tokenSource?: string };
    health?: { statusFile?: string; stopFile?: string; statusCommand?: string; healthCommand?: string };
    steps?: Array<{ id?: string; status?: string; command?: string }>;
  };
  assert.equal(parsed.kind, "soloclaw.remote_room_service_plan");
  assert.equal(parsed.workspace, workspace);
  assert.equal(parsed.roomId, "room_service_plan");
  assert.equal(parsed.serviceName, "soloclaw-remote-room-agent");
  assert.equal(parsed.supervision?.installState, "plan_only");
  assert.equal(parsed.entrypoint?.tokenSource, "AGENT_CONTROL_TOKEN");
  assert.match(parsed.entrypoint?.foregroundCommand ?? "", /agent remote run/);
  assert.match(parsed.entrypoint?.foregroundCommand ?? "", /--control-token <control-token>/);
  assert.match(parsed.entrypoint?.foregroundCommand ?? "", /--status-file \.agent\/tmp\/remote-room-status\.json/);
  assert.match(parsed.entrypoint?.foregroundCommand ?? "", /--stop-file \.agent\/tmp\/remote-room\.stop/);
  assert.match(parsed.entrypoint?.foregroundCommand ?? "", /--cycles 50/);
  assert.equal(parsed.health?.statusFile, ".agent/tmp/remote-room-status.json");
  assert.equal(parsed.health?.stopFile, ".agent/tmp/remote-room.stop");
  assert.equal(parsed.health?.statusCommand, "agent remote service --control-url http://127.0.0.1:4317 --room room_service_plan --status-file .agent/tmp/remote-room-status.json --stop-file .agent/tmp/remote-room.stop --json");
  assert.equal(parsed.health?.healthCommand, "agent remote heartbeat --control-url http://127.0.0.1:4317 --control-token <control-token> --room room_service_plan --status online --ttl 45 --json");
  assert.equal(parsed.steps?.some((step) => step.id === "run-foreground-loop" && step.status === "recommended"), true);
  assert.equal(parsed.steps?.some((step) => step.id === "wrap-os-supervisor" && step.status === "blocked"), true);
  assert.doesNotMatch(result.stdout, /runner-token|BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY/);
});

test("remote service CLI validates service control files stay inside the workspace and redacts text output", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-remote-service-plan-text-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const text = await run(process.execPath, [
    cli,
    "remote",
    "service",
    "--control-url",
    "http://127.0.0.1:4317",
    "--control-token",
    "text-runner-token",
    "--room",
    "room_service_text",
    "--status-file",
    ".agent/tmp/remote-room-status.json",
    "--stop-file",
    ".agent/tmp/remote-room.stop",
  ], workspace);

  assert.equal(text.exitCode, 0, text.stderr);
  assert.match(text.stdout, /Remote room service plan:/);
  assert.match(text.stdout, /service=soloclaw-remote-room-agent/);
  assert.match(text.stdout, /entrypoint=agent remote run/);
  assert.match(text.stdout, /--control-token <control-token>/);
  assert.match(text.stdout, /statusFile=\.agent\/tmp\/remote-room-status\.json/);
  assert.match(text.stdout, /stopFile=\.agent\/tmp\/remote-room\.stop/);
  assert.doesNotMatch(text.stdout, /text-runner-token|BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY/);

  const invalid = await run(process.execPath, [
    cli,
    "remote",
    "service",
    "--control-url",
    "http://127.0.0.1:4317",
    "--room",
    "room_service_text",
    "--stop-file",
    path.join("..", "remote-room.stop"),
    "--json",
  ], workspace);

  assert.equal(invalid.exitCode, 1);
  assert.match(invalid.stderr, /--stop-file must stay inside the current workspace/);
  assert.equal(invalid.stdout, "");
});

test("agents recover-stale CLI suspends stale room agents and marks them offline", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-stale-recovery-cli-"));
  const staleAgentId = "agent_stale_recover_cli" as AgentIdentity["id"];
  const now = "2026-06-21T12:00:00.000Z";
  let roomId = "";
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  const setupPlatform = await createLocalPlatform(workspace, { provider: "mock", workspaceSnapshot: false });
  try {
    const owner = { type: "user" as const, id: "local-user", displayName: "Local User" };
    const room = await setupPlatform.rooms.createRoom({
      name: "Stale Recovery",
      createdBy: owner,
      policy: {
        joinPolicy: "manual",
        defaultCapabilities: ["room.message.send"],
        agentResponseMode: "mentions_only",
      },
    });
    roomId = room.id;
    await setupPlatform.store.registerAgent({
      id: staleAgentId,
      machineId: "machine-stale-recover" as AgentIdentity["machineId"],
      displayName: "Stale Recover Agent",
      publicKeyPem: "test-public-key",
      fingerprint: "stale-recover-fingerprint",
      capabilities: [],
      allowedProjects: [],
      trustStatus: "trusted",
      createdAt: "2026-06-21T11:00:00.000Z",
      lastSeenAt: "2026-06-21T11:58:00.000Z",
      heartbeatStatus: "running",
      lastHeartbeatAt: "2026-06-21T11:58:00.000Z",
      heartbeatExpiresAt: "2026-06-21T11:59:00.000Z",
      lastRoomId: room.id,
    });
    await setupPlatform.store.addRoomMember({
      roomId: room.id,
      actor: { type: "agent", id: staleAgentId, displayName: "Stale Recover Agent" },
      aliases: ["stale-recover"],
      role: "executor",
      status: "active",
      joinedAt: "2026-06-21T11:00:00.000Z",
    });
  } finally {
    setupPlatform.locks.close();
    setupPlatform.store.close();
  }

  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const result = await run(process.execPath, [
    cli,
    "agents",
    "recover-stale",
    "--now",
    now,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    kind?: string;
    summary?: { recovered?: number; stale?: number };
    recovered?: Array<{ agentId?: string; roomId?: string; memberStatusAfter?: string; heartbeatStatusAfter?: string }>;
  };
  assert.equal(parsed.kind, "soloclaw.agent_stale_recovery");
  assert.equal(parsed.summary?.stale, 1);
  assert.equal(parsed.summary?.recovered, 1);
  assert.equal(parsed.recovered?.[0]?.agentId, staleAgentId);
  assert.equal(parsed.recovered?.[0]?.roomId, roomId);
  assert.equal(parsed.recovered?.[0]?.memberStatusAfter, "suspended");
  assert.equal(parsed.recovered?.[0]?.heartbeatStatusAfter, "offline");
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);

  const verifyPlatform = await createLocalPlatform(workspace, { provider: "mock", workspaceSnapshot: false });
  try {
    const agent = await verifyPlatform.store.getAgent(staleAgentId);
    assert.equal(agent?.heartbeatStatus, "offline");
    const members = await verifyPlatform.rooms.listMembers(roomId);
    assert.equal(members.find((member) => member.actor.id === staleAgentId)?.status, "suspended");

    await verifyPlatform.rooms.sendMessage({
      roomId: roomId as Parameters<typeof verifyPlatform.rooms.sendMessage>[0]["roomId"],
      sender: { type: "user", id: "local-user", displayName: "Local User" },
      kind: "task",
      body: `@agent:${staleAgentId} should not wake after stale recovery`,
    });
    const inbox = await new ControlPlaneService(verifyPlatform).getRoomAgentInbox({
      roomId,
      agentId: staleAgentId,
      limit: 10,
      includeDelivered: true,
    });
    assert.deepEqual(inbox?.messages.map((message) => message.id), []);
    const audits = await verifyPlatform.store.listAuditEvents({ type: "control_plane.action", roomId });
    assert.equal(audits.some((event) => event.summary === "Recovered stale agents from control plane"), true);
  } finally {
    verifyPlatform.locks.close();
    verifyPlatform.store.close();
  }
});

test("agents trust CLI revokes a remote agent identity and records audit evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-trust-cli-"));
  const agentId = "agent_trust_cli" as AgentIdentity["id"];
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const setupPlatform = await createLocalPlatform(workspace, { provider: "mock", workspaceSnapshot: false });
  try {
    await setupPlatform.store.registerAgent({
      id: agentId,
      machineId: "machine-trust-cli" as AgentIdentity["machineId"],
      displayName: "Trust CLI Agent",
      publicKeyPem: "test-public-key",
      fingerprint: "trust-cli-fingerprint",
      capabilities: [],
      allowedProjects: [],
      trustStatus: "trusted",
      createdAt: "2026-06-22T00:00:00.000Z",
      lastSeenAt: "2026-06-22T00:00:00.000Z",
    });
  } finally {
    setupPlatform.locks.close();
    setupPlatform.store.close();
  }

  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const result = await run(process.execPath, [
    cli,
    "agents",
    "trust",
    agentId,
    "revoked",
    "--reason",
    "operator key rotation",
    "--actor",
    "user:operator",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    agent?: AgentIdentity;
    previousTrustStatus?: string;
    reason?: string;
  };
  assert.equal(parsed.agent?.id, agentId);
  assert.equal(parsed.agent?.trustStatus, "revoked");
  assert.equal(parsed.previousTrustStatus, "trusted");
  assert.equal(parsed.reason, "operator key rotation");
  assert.doesNotMatch(result.stdout, /BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY/);

  const verifyPlatform = await createLocalPlatform(workspace, { provider: "mock", workspaceSnapshot: false });
  try {
    const agent = await verifyPlatform.store.getAgent(agentId);
    assert.equal(agent?.trustStatus, "revoked");
    const audits = await verifyPlatform.store.listAuditEvents({ actorId: "operator", type: "control_plane.action" });
    const trustAudit = audits.find((event) => event.summary === "Updated agent trust status from control plane");
    assert.equal(trustAudit?.metadata?.agentId, agentId);
    assert.equal(trustAudit?.metadata?.previousTrustStatus, "trusted");
    assert.equal(trustAudit?.metadata?.trustStatus, "revoked");
    assert.equal(trustAudit?.metadata?.reason, "operator key rotation");
  } finally {
    verifyPlatform.locks.close();
    verifyPlatform.store.close();
  }
});

test("agents rotate-key CLI updates a remote agent public key and records audit evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-rotate-key-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const setupPlatform = await createLocalPlatform(workspace, { provider: "mock", workspaceSnapshot: false });
  const oldKey = generateKeyPairSync("ed25519");
  const newKey = generateKeyPairSync("ed25519");
  const oldPublicKeyPem = oldKey.publicKey.export({ type: "spki", format: "pem" }).toString();
  const newPublicKeyPem = newKey.publicKey.export({ type: "spki", format: "pem" }).toString();
  const agentId = "agent_rotate_key_cli" as AgentIdentity["id"];
  try {
    await setupPlatform.store.registerAgent({
      id: agentId,
      machineId: "machine-rotate-key-cli" as AgentIdentity["machineId"],
      displayName: "Rotate Key CLI",
      publicKeyPem: oldPublicKeyPem,
      fingerprint: "old-cli-fingerprint",
      capabilities: [],
      allowedProjects: [],
      trustStatus: "trusted",
      createdAt: "2026-06-22T00:00:00.000Z",
    });
  } finally {
    setupPlatform.locks.close();
    setupPlatform.store.close();
  }
  const newPublicKeyPath = path.join(workspace, "new-agent-public.pem");
  await fs.writeFile(newPublicKeyPath, newPublicKeyPem, "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "agents",
    "rotate-key",
    agentId,
    "--public-key-file",
    newPublicKeyPath,
    "--reason",
    "phase5 cli key rotation",
    "--actor",
    "user:operator",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    agent?: AgentIdentity;
    previousFingerprint?: string;
    reason?: string;
  };
  assert.equal(parsed.agent?.id, agentId);
  assert.equal(parsed.agent?.trustStatus, "trusted");
  assert.equal(parsed.previousFingerprint, "old-cli-fingerprint");
  assert.notEqual(parsed.agent?.fingerprint, parsed.previousFingerprint);
  assert.match(parsed.agent?.fingerprint ?? "", /^SHA256:/);
  assert.equal(parsed.reason, "phase5 cli key rotation");
  assert.doesNotMatch(result.stdout, /BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY/);

  const verifyPlatform = await createLocalPlatform(workspace, { provider: "mock", workspaceSnapshot: false });
  try {
    const agent = await verifyPlatform.store.getAgent(agentId);
    assert.equal(agent?.publicKeyPem, newPublicKeyPem);
    assert.equal(agent?.fingerprint, parsed.agent?.fingerprint);
    const audits = await verifyPlatform.store.listAuditEvents({ actorId: "operator", type: "control_plane.action" });
    const rotationAudit = audits.find((event) => event.summary === "Rotated agent identity key from control plane");
    assert.equal(rotationAudit?.metadata?.agentId, agentId);
    assert.equal(rotationAudit?.metadata?.previousFingerprint, "old-cli-fingerprint");
    assert.equal(rotationAudit?.metadata?.fingerprint, parsed.agent?.fingerprint);
    assert.equal(rotationAudit?.metadata?.reason, "phase5 cli key rotation");
  } finally {
    verifyPlatform.locks.close();
    verifyPlatform.store.close();
  }
});

test("agent trust Web API revokes identity and returns forbidden for old signed room operations", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-trust-web-"));
  let server: Awaited<ReturnType<typeof startLocalRoomWebServer>> | undefined;
  t.after(async () => {
    await server?.close();
    await fs.rm(workspace, { recursive: true, force: true });
  });

  const setupPlatform = await createLocalPlatform(workspace, { provider: "mock", workspaceSnapshot: false });
  const owner = { type: "user" as const, id: "operator", displayName: "Operator" };
  const room = await setupPlatform.rooms.createRoom({
    name: "Trust Web API",
    createdBy: owner,
    policy: { joinPolicy: "manual", defaultCapabilities: ["room.message.send"] },
  });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const remoteActor = { type: "agent" as const, id: "agent_trust_web", displayName: "Trust Web Agent" };
  try {
    await setupPlatform.store.registerAgent({
      id: remoteActor.id as AgentIdentity["id"],
      machineId: "machine-trust-web" as AgentIdentity["machineId"],
      displayName: remoteActor.displayName,
      publicKeyPem,
      fingerprint: "trust-web-fingerprint",
      capabilities: [],
      allowedProjects: [],
      trustStatus: "trusted",
      createdAt: "2026-06-22T00:00:00.000Z",
    });
    await setupPlatform.store.addRoomMember({
      roomId: room.id,
      actor: remoteActor,
      role: "participant",
      status: "active",
      joinedAt: "2026-06-22T00:00:00.000Z",
    });
  } finally {
    setupPlatform.locks.close();
    setupPlatform.store.close();
  }

  server = await startLocalRoomWebServer(workspace, { host: "127.0.0.1", port: 0, token: "trust-web-token" });
  const trustResponse = await fetch(new URL(`/api/agents/${encodeURIComponent(remoteActor.id)}/trust`, server.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-control-token": server.token,
    },
    body: JSON.stringify({
      actor: "user:operator",
      trustStatus: "revoked",
      reason: "compromised test key",
    }),
  });

  assert.equal(trustResponse.status, 200);
  const trustPayload = await trustResponse.json() as {
    agent?: AgentIdentity;
    previousTrustStatus?: string;
    reason?: string;
  };
  assert.equal(trustPayload.agent?.id, remoteActor.id);
  assert.equal(trustPayload.agent?.trustStatus, "revoked");
  assert.equal(trustPayload.previousTrustStatus, "trusted");
  assert.equal(trustPayload.reason, "compromised test key");

  const envelope = signRemoteMessageIntent({
    roomId: room.id,
    agentId: remoteActor.id,
    kind: "chat",
    body: "@operator old signed key should be blocked",
    sentBy: remoteActor,
    privateKey,
  });
  const rejectedSay = await fetch(new URL(`/api/rooms/${encodeURIComponent(room.id)}/messages`, server.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-control-token": server.token,
    },
    body: JSON.stringify({
      actor: `agent:${remoteActor.id}`,
      kind: "chat",
      body: "@operator old signed key should be blocked",
      messageEnvelope: envelope,
    }),
  });
  const rejectedPayload = await rejectedSay.json() as { error?: string };

  assert.equal(rejectedSay.status, 403);
  assert.match(rejectedPayload.error ?? "", /revoked/);

  const auditResponse = await fetch(new URL("/api/audit?type=control_plane.action", server.baseUrl), {
    headers: { "x-agent-control-token": server.token },
  });
  assert.equal(auditResponse.status, 200);
  const auditPayload = await auditResponse.json() as {
    events?: Array<{ summary?: string; metadata?: Record<string, unknown> }>;
  };
  const trustAudit = auditPayload.events?.find((event) => event.summary === "Updated agent trust status from control plane");
  assert.equal(trustAudit?.metadata?.agentId, remoteActor.id);
  assert.equal(trustAudit?.metadata?.previousTrustStatus, "trusted");
  assert.equal(trustAudit?.metadata?.trustStatus, "revoked");
  assert.equal(trustAudit?.metadata?.reason, "compromised test key");

  const invalidTrustResponse = await fetch(new URL(`/api/agents/${encodeURIComponent(remoteActor.id)}/trust`, server.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-control-token": server.token,
    },
    body: JSON.stringify({
      actor: "user:operator",
      trustStatus: "unknown",
    }),
  });
  const invalidTrustPayload = await invalidTrustResponse.json() as { error?: string };
  assert.equal(invalidTrustResponse.status, 400);
  assert.match(invalidTrustPayload.error ?? "", /Invalid agent trust status/);
});

test("agent rotate-key Web API updates identity key and records audit evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-rotate-key-web-"));
  let server: Awaited<ReturnType<typeof startLocalRoomWebServer>> | undefined;
  t.after(async () => {
    await server?.close();
    await fs.rm(workspace, { recursive: true, force: true });
  });

  const setupPlatform = await createLocalPlatform(workspace, { provider: "mock", workspaceSnapshot: false });
  const oldKey = generateKeyPairSync("ed25519");
  const newKey = generateKeyPairSync("ed25519");
  const oldPublicKeyPem = oldKey.publicKey.export({ type: "spki", format: "pem" }).toString();
  const newPublicKeyPem = newKey.publicKey.export({ type: "spki", format: "pem" }).toString();
  const remoteActor = { type: "agent" as const, id: "agent_rotate_key_web", displayName: "Rotate Key Web" };
  try {
    await setupPlatform.store.registerAgent({
      id: remoteActor.id as AgentIdentity["id"],
      machineId: "machine-rotate-key-web" as AgentIdentity["machineId"],
      displayName: remoteActor.displayName,
      publicKeyPem: oldPublicKeyPem,
      fingerprint: "old-web-fingerprint",
      capabilities: [],
      allowedProjects: [],
      trustStatus: "trusted",
      createdAt: "2026-06-22T00:00:00.000Z",
    });
  } finally {
    setupPlatform.locks.close();
    setupPlatform.store.close();
  }

  server = await startLocalRoomWebServer(workspace, { host: "127.0.0.1", port: 0, token: "rotate-key-web-token" });
  const rotateResponse = await fetch(new URL(`/api/agents/${encodeURIComponent(remoteActor.id)}/rotate-key`, server.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-control-token": server.token,
    },
    body: JSON.stringify({
      actor: "user:operator",
      publicKeyPem: newPublicKeyPem,
      reason: "phase5 web key rotation",
    }),
  });

  assert.equal(rotateResponse.status, 200);
  const rotatePayload = await rotateResponse.json() as {
    agent?: AgentIdentity;
    previousFingerprint?: string;
    reason?: string;
  };
  assert.equal(rotatePayload.agent?.id, remoteActor.id);
  assert.equal(rotatePayload.agent?.trustStatus, "trusted");
  assert.equal(rotatePayload.previousFingerprint, "old-web-fingerprint");
  assert.notEqual(rotatePayload.agent?.fingerprint, rotatePayload.previousFingerprint);
  assert.equal(rotatePayload.reason, "phase5 web key rotation");
  assert.doesNotMatch(JSON.stringify(rotatePayload), /BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY/);

  const auditResponse = await fetch(new URL("/api/audit?type=control_plane.action", server.baseUrl), {
    headers: { "x-agent-control-token": server.token },
  });
  assert.equal(auditResponse.status, 200);
  const auditPayload = await auditResponse.json() as {
    events?: Array<{ summary?: string; metadata?: Record<string, unknown> }>;
  };
  const rotationAudit = auditPayload.events?.find((event) => event.summary === "Rotated agent identity key from control plane");
  assert.equal(rotationAudit?.metadata?.agentId, remoteActor.id);
  assert.equal(rotationAudit?.metadata?.previousFingerprint, "old-web-fingerprint");
  assert.equal(rotationAudit?.metadata?.fingerprint, rotatePayload.agent?.fingerprint);
  assert.equal(rotationAudit?.metadata?.reason, "phase5 web key rotation");
});

test("control plane rotates remote agent identity key and rejects old signed room operations", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-key-rotation-"));
  let platform: Awaited<ReturnType<typeof createLocalPlatform>> | undefined;
  t.after(async () => {
    platform?.locks.close();
    platform?.store.close();
    await fs.rm(workspace, { recursive: true, force: true });
  });
  platform = await createLocalPlatform(workspace);
  const control = new ControlPlaneService(platform);
  const owner = { type: "user" as const, id: "operator", displayName: "Operator" };
  const room = await platform.rooms.createRoom({
    name: "Key rotation room",
    createdBy: owner,
    policy: { joinPolicy: "manual", defaultCapabilities: ["room.message.send"] },
  });
  const oldKey = generateKeyPairSync("ed25519");
  const newKey = generateKeyPairSync("ed25519");
  const oldPublicKeyPem = oldKey.publicKey.export({ type: "spki", format: "pem" }).toString();
  const newPublicKeyPem = newKey.publicKey.export({ type: "spki", format: "pem" }).toString();
  const remoteActor = { type: "agent" as const, id: "agent_key_rotation", displayName: "Rotating Agent" };
  await platform.store.registerAgent({
    id: remoteActor.id as AgentIdentity["id"],
    machineId: "machine-key-rotation" as AgentIdentity["machineId"],
    displayName: remoteActor.displayName,
    publicKeyPem: oldPublicKeyPem,
    fingerprint: "old-key-fingerprint",
    capabilities: [],
    allowedProjects: [],
    trustStatus: "trusted",
    createdAt: "2026-06-22T00:00:00.000Z",
  });
  await platform.store.addRoomMember({
    roomId: room.id,
    actor: remoteActor,
    role: "participant",
    status: "active",
    joinedAt: "2026-06-22T00:00:00.000Z",
  });

  const rotated = await control.rotateAgentIdentityKey({
    actor: owner,
    agentId: remoteActor.id,
    publicKeyPem: newPublicKeyPem,
    reason: "phase5 key rotation smoke",
  });

  assert.equal(rotated.agent.id, remoteActor.id);
  assert.equal(rotated.agent.trustStatus, "trusted");
  assert.notEqual(rotated.previousFingerprint, rotated.agent.fingerprint);
  assert.match(rotated.agent.fingerprint, /^SHA256:/);
  const stored = await platform.store.getAgent(remoteActor.id);
  assert.equal(stored?.publicKeyPem, newPublicKeyPem);
  assert.equal(stored?.fingerprint, rotated.agent.fingerprint);

  const oldEnvelope = signRemoteMessageIntent({
    roomId: room.id,
    agentId: remoteActor.id,
    kind: "chat",
    body: "@operator old key should fail",
    sentBy: remoteActor,
    privateKey: oldKey.privateKey,
  });
  await assert.rejects(
    () => control.sendRoomMessage({
      roomId: room.id,
      sender: remoteActor,
      kind: "chat",
      body: "@operator old key should fail",
      messageEnvelope: oldEnvelope,
    }),
    /Invalid room message intent envelope signature: invalid/,
  );

  const newEnvelope = signRemoteMessageIntent({
    roomId: room.id,
    agentId: remoteActor.id,
    kind: "chat",
    body: "@operator new key should pass",
    sentBy: remoteActor,
    privateKey: newKey.privateKey,
  });
  const message = await control.sendRoomMessage({
    roomId: room.id,
    sender: remoteActor,
    kind: "chat",
    body: "@operator new key should pass",
    messageEnvelope: newEnvelope,
  });
  assert.equal(message.sender.id, remoteActor.id);
  assert.equal(message.metadata?.remoteIntentSignatureStatus, "valid");

  const audits = await platform.store.listAuditEvents({ actorId: "operator", type: "control_plane.action" });
  const rotationAudit = audits.find((event) => event.summary === "Rotated agent identity key from control plane");
  assert.equal(rotationAudit?.metadata?.agentId, remoteActor.id);
  assert.equal(rotationAudit?.metadata?.previousFingerprint, rotated.previousFingerprint);
  assert.equal(rotationAudit?.metadata?.fingerprint, rotated.agent.fingerprint);
  assert.equal(rotationAudit?.metadata?.trustStatus, "trusted");
  assert.equal(rotationAudit?.metadata?.reason, "phase5 key rotation smoke");
});

test("rooms invite-bundle CLI emits a signed remote join bundle", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-room-invite-bundle-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const created = await run(process.execPath, [
    cli,
    "rooms",
    "create",
    "--local-agent",
    "--join-policy",
    "invite_token",
    "--require-signed-invites",
    "Bundle room",
  ], workspace);
  assert.equal(created.exitCode, 0, created.stderr);
  const roomId = created.stdout.trim().split(/\s+/)[0];
  assert.match(roomId, /^room_/);

  const result = await run(process.execPath, [
    cli,
    "rooms",
    "invite-bundle",
    roomId,
    "--control-url",
    "http://127.0.0.1:4317",
    "--control-token",
    "bundle-control-token",
    "--alias",
    "bundle-builder",
    "--display-name",
    "Bundle Builder",
    "--ttl-hours",
    "1",
    "--max-uses",
    "1",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    kind?: string;
    version?: number;
    controlUrl?: string;
    controlToken?: string;
    roomId?: string;
    inviteToken?: string;
    inviteSignatureStatus?: string;
    aliases?: string[];
    displayName?: string;
    commands?: { enroll?: string; run?: string };
  };
  assert.equal(parsed.kind, "soloclaw.room_invite");
  assert.equal(parsed.version, 1);
  assert.equal(parsed.controlUrl, "http://127.0.0.1:4317");
  assert.equal(parsed.controlToken, "bundle-control-token");
  assert.equal(parsed.roomId, roomId);
  assert.match(parsed.inviteToken ?? "", /^rinv_/);
  assert.equal(parsed.inviteSignatureStatus, "valid");
  assert.deepEqual(parsed.aliases, ["bundle-builder"]);
  assert.equal(parsed.displayName, "Bundle Builder");
  assert.ok(parsed.commands?.enroll?.includes("room join"));
  assert.ok(parsed.commands?.run?.includes("--run"));
  assert.ok(parsed.commands?.run?.includes("--status-file .agent/tmp/remote-room-status.json"));
  assert.ok(parsed.commands?.run?.includes("--stop-file .agent/tmp/remote-room.stop"));
  assert.ok(parsed.commands?.run?.includes("--reply-template"));
  assert.ok(parsed.commands?.run?.includes("{messageId}"));
  assert.doesNotMatch(result.stdout, /BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY/);

  const textResult = await run(process.execPath, [
    cli,
    "rooms",
    "invite-bundle",
    roomId,
    "--control-url",
    "http://127.0.0.1:4317",
    "--control-token",
    "text-control-token",
    "--alias",
    "text-builder",
    "--display-name",
    "Text Builder",
    "--ttl-hours",
    "1",
    "--max-uses",
    "1",
  ], workspace);

  assert.equal(textResult.exitCode, 0, textResult.stderr);
  assert.match(textResult.stdout, /agent room join --invite-bundle room-invite\.json --run/);
  assert.match(textResult.stdout, /--status-file \.agent\/tmp\/remote-room-status\.json/);
  assert.match(textResult.stdout, /--stop-file \.agent\/tmp\/remote-room\.stop/);
  assert.match(textResult.stdout, /Read \.agent\/tmp\/remote-room-status\.json/);
  assert.match(textResult.stdout, /create \.agent\/tmp\/remote-room\.stop/);
  assert.doesNotMatch(textResult.stdout, /text-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY/);
});

test("remote join-bundle CLI enrolls from a bundle and sends a signed heartbeat", async (t) => {
  const controlWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-remote-join-bundle-control-"));
  const remoteWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-remote-join-bundle-remote-"));
  let setupPlatform: Awaited<ReturnType<typeof createLocalPlatform>> | undefined;
  let server: Awaited<ReturnType<typeof startLocalRoomWebServer>> | undefined;
  t.after(async () => {
    await server?.close();
    setupPlatform?.locks.close();
    setupPlatform?.store.close();
    await fs.rm(controlWorkspace, { recursive: true, force: true });
    await fs.rm(remoteWorkspace, { recursive: true, force: true });
  });
  setupPlatform = await createLocalPlatform(controlWorkspace);
  const owner = { type: "agent" as const, id: setupPlatform.localAgent.id, displayName: setupPlatform.localAgent.displayName };
  const room = await setupPlatform.rooms.createRoom({
    name: "Join bundle room",
    createdBy: owner,
    policy: {
      joinPolicy: "invite_token",
      defaultCapabilities: [],
      agentResponseMode: "mentions_only",
      requireSignedInvites: true,
    },
  });
  const invite = await setupPlatform.rooms.createInvite({
    roomId: room.id,
    createdBy: owner,
    role: "participant",
    ttlHours: 1,
    maxUses: 1,
  });
  const inviteSignatureStatus = await setupPlatform.rooms.verifyInvite(invite.invite);
  setupPlatform.locks.close();
  setupPlatform.store.close();
  setupPlatform = undefined;
  server = await startLocalRoomWebServer(controlWorkspace, { host: "127.0.0.1", port: 0, token: "join-bundle-token" });
  const bundlePath = path.join(remoteWorkspace, "room-invite.json");
  await fs.writeFile(
    bundlePath,
    JSON.stringify({
      kind: "soloclaw.room_invite",
      version: 1,
      controlUrl: server.baseUrl,
      controlToken: server.token,
      roomId: room.id,
      inviteToken: invite.token,
      inviteSignatureStatus,
      aliases: ["joined-builder"],
      displayName: "Joined Builder",
      defaultRun: {
        cycles: 1,
        limit: 1,
        idleLimit: 1,
        intervalMs: 0,
        loopIntervalMs: 0,
        stopWhenIdle: true,
        idleCycles: 1,
        heartbeatTtlSeconds: 30,
      },
    }, null, 2),
    "utf8",
  );
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const statusFile = path.join(".agent", "tmp", "room-join-status.json");

  const result = await run(process.execPath, [
    cli,
    "remote",
    "join-bundle",
    "--invite-bundle",
    bundlePath,
    "--run",
    "--cycles",
    "1",
    "--limit",
    "1",
    "--idle-limit",
    "1",
    "--interval-ms",
    "0",
    "--loop-interval-ms",
    "0",
    "--stop-when-idle",
    "--idle-cycles",
    "1",
    "--status-file",
    statusFile,
    "--json",
  ], remoteWorkspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    agent?: { id?: string; heartbeatStatus?: string; lastHeartbeatAt?: string };
    member?: { status?: string; aliases?: string[] };
    heartbeat?: { agent?: { heartbeatStatus?: string; lastHeartbeatAt?: string } };
    bootstrapEvidence?: {
      inviteBundleKind?: string;
      inviteSignatureStatus?: string;
      joinedFromInviteBundle?: boolean;
      ranFromInviteBundle?: boolean;
    };
  };
  assert.match(parsed.agent?.id ?? "", /^agent_/);
  assert.equal(parsed.member?.status, "active");
  assert.deepEqual(parsed.member?.aliases, ["joined-builder"]);
  assert.equal(parsed.heartbeat?.agent?.heartbeatStatus, "online");
  assert.ok(parsed.heartbeat?.agent?.lastHeartbeatAt);
  assert.equal(parsed.bootstrapEvidence?.inviteBundleKind, "soloclaw.room_invite");
  assert.equal(parsed.bootstrapEvidence?.inviteSignatureStatus, "valid");
  assert.equal(parsed.bootstrapEvidence?.joinedFromInviteBundle, true);
  assert.equal(parsed.bootstrapEvidence?.ranFromInviteBundle, true);
  assert.doesNotMatch(result.stdout, /BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY/);
  assert.doesNotMatch(result.stdout, /join-bundle-token|rinv_[A-Za-z0-9_-]+/);
});

test("remote join-bundle CLI validates stop-file before control-plane side effects", async (t) => {
  const remoteWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-remote-join-stop-file-outside-"));
  let registerCalls = 0;
  let joinCalls = 0;
  let heartbeatCalls = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    assert.equal(request.headers["x-agent-control-token"], "join-bundle-token");
    if (request.method === "POST" && url.pathname === "/api/agents/register") {
      registerCalls += 1;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { agentId?: string; machineId?: string; displayName?: string };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        agent: {
          id: body.agentId,
          machineId: body.machineId,
          displayName: body.displayName,
          trustStatus: "pending",
          fingerprint: "fp_join_stop_file",
        },
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/rooms/room_join_stop_file/join-invite") {
      joinCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        member: {
          actor: { type: "agent", id: "agent_join_stop_file" },
          role: "participant",
          status: "active",
          aliases: ["joined-builder"],
        },
      }));
      return;
    }
    const heartbeatMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/heartbeat$/);
    if (request.method === "POST" && heartbeatMatch) {
      heartbeatCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        agent: {
          id: decodeURIComponent(heartbeatMatch[1]),
          machineId: "machine_join_stop_file",
          heartbeatStatus: "online",
        },
      }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(remoteWorkspace, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const bundlePath = path.join(remoteWorkspace, "room-invite.json");
  await fs.writeFile(
    bundlePath,
    JSON.stringify({
      kind: "soloclaw.room_invite",
      version: 1,
      controlUrl: `http://127.0.0.1:${address.port}`,
      controlToken: "join-bundle-token",
      roomId: "room_join_stop_file",
      inviteToken: "rinv_join_stop_file",
      aliases: ["joined-builder"],
      displayName: "Joined Builder",
    }, null, 2),
    "utf8",
  );
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "remote",
    "join-bundle",
    "--invite-bundle",
    bundlePath,
    "--run",
    "--stop-file",
    path.join("..", "remote-room.stop"),
    "--json",
  ], remoteWorkspace);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /--stop-file must stay inside the current workspace/);
  assert.equal(result.stdout, "");
  assert.equal(registerCalls, 0);
  assert.equal(joinCalls, 0);
  assert.equal(heartbeatCalls, 0);
});

test("room invite-agent CLI shortcut emits a signed remote join bundle", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-room-shortcut-invite-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const created = await run(process.execPath, [
    cli,
    "rooms",
    "create",
    "--local-agent",
    "--join-policy",
    "invite_token",
    "--require-signed-invites",
    "Shortcut bundle room",
  ], workspace);
  assert.equal(created.exitCode, 0, created.stderr);
  const roomId = created.stdout.trim().split(/\s+/)[0];
  assert.match(roomId, /^room_/);

  const result = await run(process.execPath, [
    cli,
    "room",
    "invite-agent",
    roomId,
    "--control-url",
    "http://127.0.0.1:4317",
    "--control-token",
    "shortcut-control-token",
    "--alias",
    "shortcut-builder",
    "--display-name",
    "Shortcut Builder",
    "--ttl-hours",
    "1",
    "--max-uses",
    "1",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    kind?: string;
    version?: number;
    controlUrl?: string;
    controlToken?: string;
    roomId?: string;
    inviteToken?: string;
    inviteSignatureStatus?: string;
    aliases?: string[];
    displayName?: string;
  };
  assert.equal(parsed.kind, "soloclaw.room_invite");
  assert.equal(parsed.version, 1);
  assert.equal(parsed.controlUrl, "http://127.0.0.1:4317");
  assert.equal(parsed.controlToken, "shortcut-control-token");
  assert.equal(parsed.roomId, roomId);
  assert.match(parsed.inviteToken ?? "", /^rinv_/);
  assert.equal(parsed.inviteSignatureStatus, "valid");
  assert.deepEqual(parsed.aliases, ["shortcut-builder"]);
  assert.equal(parsed.displayName, "Shortcut Builder");
  assert.doesNotMatch(result.stdout, /BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY/);
});

test("room join CLI shortcut enrolls from a bundle and sends a signed heartbeat", async (t) => {
  const controlWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-room-shortcut-control-"));
  const remoteWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-room-shortcut-remote-"));
  let setupPlatform: Awaited<ReturnType<typeof createLocalPlatform>> | undefined;
  let server: Awaited<ReturnType<typeof startLocalRoomWebServer>> | undefined;
  t.after(async () => {
    await server?.close();
    setupPlatform?.locks.close();
    setupPlatform?.store.close();
    await fs.rm(controlWorkspace, { recursive: true, force: true });
    await fs.rm(remoteWorkspace, { recursive: true, force: true });
  });
  setupPlatform = await createLocalPlatform(controlWorkspace);
  const owner = { type: "agent" as const, id: setupPlatform.localAgent.id, displayName: setupPlatform.localAgent.displayName };
  const room = await setupPlatform.rooms.createRoom({
    name: "Shortcut join room",
    createdBy: owner,
    policy: {
      joinPolicy: "invite_token",
      defaultCapabilities: [],
      agentResponseMode: "mentions_only",
      requireSignedInvites: true,
    },
  });
  const invite = await setupPlatform.rooms.createInvite({
    roomId: room.id,
    createdBy: owner,
    role: "participant",
    ttlHours: 1,
    maxUses: 1,
  });
  const inviteSignatureStatus = await setupPlatform.rooms.verifyInvite(invite.invite);
  setupPlatform.locks.close();
  setupPlatform.store.close();
  setupPlatform = undefined;
  server = await startLocalRoomWebServer(controlWorkspace, { host: "127.0.0.1", port: 0, token: "room-shortcut-token" });
  const bundlePath = path.join(remoteWorkspace, "room-invite.json");
  await fs.writeFile(
    bundlePath,
    JSON.stringify({
      kind: "soloclaw.room_invite",
      version: 1,
      controlUrl: server.baseUrl,
      controlToken: server.token,
      roomId: room.id,
      inviteToken: invite.token,
      inviteSignatureStatus,
      aliases: ["shortcut-joined"],
      displayName: "Shortcut Joined",
    }, null, 2),
    "utf8",
  );
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const statusFile = path.join(".agent", "tmp", "room-shortcut-status.json");

  const result = await run(process.execPath, [
    cli,
    "room",
    "join",
    "--invite-bundle",
    bundlePath,
    "--run",
    "--cycles",
    "1",
    "--limit",
    "1",
    "--idle-limit",
    "1",
    "--interval-ms",
    "0",
    "--loop-interval-ms",
    "0",
    "--stop-when-idle",
    "--idle-cycles",
    "1",
    "--status-file",
    statusFile,
    "--json",
  ], remoteWorkspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    agent?: { id?: string };
    member?: { status?: string; aliases?: string[] };
    heartbeat?: { agent?: { heartbeatStatus?: string; lastHeartbeatAt?: string } };
    run?: { stopReason?: string; messagesProcessed?: number };
    bootstrapEvidence?: {
      inviteBundleKind?: string;
      inviteSignatureStatus?: string;
      joinedFromInviteBundle?: boolean;
      ranFromInviteBundle?: boolean;
    };
  };
  assert.match(parsed.agent?.id ?? "", /^agent_/);
  assert.equal(parsed.member?.status, "active");
  assert.deepEqual(parsed.member?.aliases, ["shortcut-joined"]);
  assert.equal(parsed.heartbeat?.agent?.heartbeatStatus, "online");
  assert.ok(parsed.heartbeat?.agent?.lastHeartbeatAt);
  assert.equal(parsed.run?.stopReason, "idle");
  assert.equal(parsed.run?.messagesProcessed, 0);
  assert.equal(parsed.bootstrapEvidence?.inviteBundleKind, "soloclaw.room_invite");
  assert.equal(parsed.bootstrapEvidence?.inviteSignatureStatus, "valid");
  assert.equal(parsed.bootstrapEvidence?.joinedFromInviteBundle, true);
  assert.equal(parsed.bootstrapEvidence?.ranFromInviteBundle, true);
  assert.doesNotMatch(result.stdout, /room-shortcut-token|rinv_[A-Za-z0-9_-]+/);
  const status = JSON.parse(await fs.readFile(path.join(remoteWorkspace, statusFile), "utf8")) as {
    kind?: string;
    roomId?: string;
    agentId?: string;
    status?: string;
    stopReason?: string;
    messagesProcessed?: number;
  };
  assert.equal(status.kind, "soloclaw.remote_room_runner_status");
  assert.equal(status.roomId, room.id);
  assert.match(status.agentId ?? "", /^agent_/);
  assert.equal(status.status, "stopped");
  assert.equal(status.stopReason, "idle");
  assert.equal(status.messagesProcessed, 0);
  assert.doesNotMatch(JSON.stringify(status), /room-shortcut-token|rinv_[A-Za-z0-9_-]+/);
  assert.doesNotMatch(result.stdout, /BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY/);
});

test("registered remote agent can be pulled into a room and accept the invitation", async (t) => {
  const controlWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-room-pull-control-"));
  const remoteWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-room-pull-remote-"));
  let setupPlatform: Awaited<ReturnType<typeof createLocalPlatform>> | undefined;
  let server: Awaited<ReturnType<typeof startLocalRoomWebServer>> | undefined;
  t.after(async () => {
    await server?.close();
    setupPlatform?.locks.close();
    setupPlatform?.store.close();
    await fs.rm(controlWorkspace, { recursive: true, force: true });
    await fs.rm(remoteWorkspace, { recursive: true, force: true });
  });

  setupPlatform = await createLocalPlatform(controlWorkspace);
  const owner = { type: "agent" as const, id: setupPlatform.localAgent.id, displayName: setupPlatform.localAgent.displayName };
  const room = await setupPlatform.rooms.createRoom({
    name: "Pull remote room",
    createdBy: owner,
    policy: {
      joinPolicy: "manual",
      defaultCapabilities: [],
      agentResponseMode: "mentions_only",
    },
  });
  setupPlatform.locks.close();
  setupPlatform.store.close();
  setupPlatform = undefined;

  server = await startLocalRoomWebServer(controlWorkspace, { host: "127.0.0.1", port: 0, token: "room-pull-token" });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const registered = await run(process.execPath, [
    cli,
    "remote",
    "register",
    "--control-url",
    server.baseUrl,
    "--control-token",
    server.token,
    "--display-name",
    "Pulled Remote",
    "--json",
  ], remoteWorkspace);
  assert.equal(registered.exitCode, 0, registered.stderr);
  const registeredJson = JSON.parse(registered.stdout) as { agent?: { id?: string; displayName?: string; trustStatus?: string } };
  const remoteAgentId = registeredJson.agent?.id;
  assert.match(remoteAgentId ?? "", /^agent_/);
  assert.equal(registeredJson.agent?.displayName, "Pulled Remote");
  assert.doesNotMatch(registered.stdout, /room-pull-token|BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY/);

  const pulled = await run(process.execPath, [
    cli,
    "rooms",
    "pull-agent",
    room.id,
    remoteAgentId!,
    "--alias",
    "pulled",
    "--role",
    "executor",
    "--local-agent",
    "--json",
  ], controlWorkspace);
  assert.equal(pulled.exitCode, 0, pulled.stderr);
  const pulledJson = JSON.parse(pulled.stdout) as { member?: { actor?: { id?: string }; role?: string; status?: string; aliases?: string[] } };
  assert.equal(pulledJson.member?.actor?.id, remoteAgentId);
  assert.equal(pulledJson.member?.role, "executor");
  assert.equal(pulledJson.member?.status, "invited");
  assert.deepEqual(pulledJson.member?.aliases, ["pulled"]);

  const invitations = await run(process.execPath, [
    cli,
    "remote",
    "invitations",
    "--control-url",
    server.baseUrl,
    "--control-token",
    server.token,
    "--json",
  ], remoteWorkspace);
  assert.equal(invitations.exitCode, 0, invitations.stderr);
  const invitationsJson = JSON.parse(invitations.stdout) as {
    invitations?: Array<{ room?: { id?: string; name?: string }; member?: { status?: string; role?: string; aliases?: string[] } }>;
  };
  assert.equal(invitationsJson.invitations?.length, 1);
  assert.equal(invitationsJson.invitations?.[0]?.room?.id, room.id);
  assert.equal(invitationsJson.invitations?.[0]?.member?.status, "invited");
  assert.equal(invitationsJson.invitations?.[0]?.member?.role, "executor");
  assert.deepEqual(invitationsJson.invitations?.[0]?.member?.aliases, ["pulled"]);

  const statusFile = path.join(".agent", "tmp", "room-pull-status.json");
  const accepted = await run(process.execPath, [
    cli,
    "remote",
    "accept-room",
    "--control-url",
    server.baseUrl,
    "--control-token",
    server.token,
    "--room",
    room.id,
    "--run",
    "--cycles",
    "1",
    "--limit",
    "1",
    "--idle-limit",
    "1",
    "--interval-ms",
    "0",
    "--loop-interval-ms",
    "0",
    "--stop-when-idle",
    "--idle-cycles",
    "1",
    "--status-file",
    statusFile,
    "--json",
  ], remoteWorkspace);
  assert.equal(accepted.exitCode, 0, accepted.stderr);
  const acceptedJson = JSON.parse(accepted.stdout) as {
    member?: { status?: string; role?: string; aliases?: string[] };
    heartbeat?: { agent?: { heartbeatStatus?: string; lastRoomId?: string } };
    run?: { stopReason?: string; messagesProcessed?: number };
    pullEvidence?: {
      acceptedFromRoomInvitation?: boolean;
      ranFromRoomInvitation?: boolean;
    };
  };
  assert.equal(acceptedJson.member?.status, "active");
  assert.equal(acceptedJson.member?.role, "executor");
  assert.deepEqual(acceptedJson.member?.aliases, ["pulled"]);
  assert.equal(acceptedJson.heartbeat?.agent?.heartbeatStatus, "online");
  assert.equal(acceptedJson.heartbeat?.agent?.lastRoomId, room.id);
  assert.equal(acceptedJson.run?.stopReason, "idle");
  assert.equal(acceptedJson.run?.messagesProcessed, 0);
  assert.equal(acceptedJson.pullEvidence?.acceptedFromRoomInvitation, true);
  assert.equal(acceptedJson.pullEvidence?.ranFromRoomInvitation, true);
  assert.doesNotMatch(accepted.stdout, /room-pull-token|BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY/);

  const status = JSON.parse(await fs.readFile(path.join(remoteWorkspace, statusFile), "utf8")) as {
    kind?: string;
    roomId?: string;
    agentId?: string;
    status?: string;
    stopReason?: string;
  };
  assert.equal(status.kind, "soloclaw.remote_room_runner_status");
  assert.equal(status.roomId, room.id);
  assert.equal(status.agentId, remoteAgentId);
  assert.equal(status.status, "stopped");
  assert.equal(status.stopReason, "idle");
  assert.doesNotMatch(JSON.stringify(status), /room-pull-token|BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY/);
});

test("phase5 verify CLI proves a local remote-room exchange without leaking secrets", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-verify-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "verify",
    "--workspace",
    workspace,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    phase?: string;
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: Record<string, unknown> }>;
    room?: {
      id?: string;
      remoteAgentId?: string;
      remoteAgentIds?: string[];
      controlPlaneRoomMessageEventObserved?: boolean;
      controlPlaneEventStreamRoomMessageIds?: string[];
      controlPlaneDeliveryAckEventObserved?: boolean;
      controlPlaneEventStreamAckMessageIds?: string[];
      controlPlaneDeliveryStatusObserved?: boolean;
      controlPlaneDeliveryStatusAgentIds?: string[];
      controlPlaneDeliveryStatusPendingCounts?: Record<string, number>;
      bootstrapAgentId?: string;
      bootstrapRunnerStatusFileObserved?: boolean;
      bootstrapRunnerStopReason?: string;
      bootstrapRunnerLastHeartbeatStatus?: string;
      pulledAgentId?: string;
      pulledAgentInvitationListed?: boolean;
      pulledAgentAccepted?: boolean;
      pulledAgentTaskMessageId?: string;
      pulledAgentReplyMessageId?: string;
      pulledAgentAckSigned?: boolean;
      pulledAgentHeartbeatStatus?: string;
      pulledAgentRunStopReason?: string;
      revokedAgentId?: string;
      revokedAgentSignedSayBlocked?: boolean;
      revokedAgentSignedAckBlocked?: boolean;
      revokedAgentSignedHeartbeatBlocked?: boolean;
      keyRotationAgentId?: string;
      keyRotationPreviousFingerprint?: string;
      keyRotationRotatedFingerprint?: string;
      keyRotationOldSignedSayBlocked?: boolean;
      keyRotationNewSignedSayAccepted?: boolean;
      keyRotationAuditEventVisible?: boolean;
      keyRotationMessageId?: string;
      roomAssignmentTargetAgentId?: string;
      roomAssignmentSubtaskId?: string;
      roomAssignmentChildSessionId?: string;
      roomAssignmentMessageId?: string;
      roomAssignmentResultMessageId?: string;
      agentExchangeMessageId?: string;
      agentExchangeReplyMessageId?: string;
      agentExchangeSenderId?: string;
      agentExchangeReceiverId?: string;
      roomHandoffId?: string;
      roomHandoffSourceAgentId?: string;
      roomHandoffTargetAgentId?: string;
      roomHandoffMessageId?: string;
      roomHandoffAcceptanceMessageId?: string;
      roomHandoffResultMessageId?: string;
      roomConflictResultKey?: string;
      roomConflictPrimaryAgentId?: string;
      roomConflictSecondaryAgentId?: string;
      roomConflictPrimaryMessageId?: string;
      roomConflictSecondaryMessageId?: string;
      roomConflictResolutionMessageId?: string;
      roomConflictWinningAgentId?: string;
      roomResultSyncAgentId?: string;
      roomResultSyncArtifactId?: string;
      roomResultSyncArtifactMessageId?: string;
      roomResultSyncArtifactSha256?: string;
      roomResultSyncArtifactSizeBytes?: number;
      broadcastFallbackMessageId?: string;
      broadcastFallbackHandledCount?: number;
      broadcastFallbackInboxCounts?: Record<string, number>;
      broadcastFallbackPendingCounts?: Record<string, number>;
      stopFileShutdownAgentId?: string;
      stopFileShutdownReason?: string;
      stopFileShutdownStatusFileObserved?: boolean;
    };
  };
  assert.equal(parsed.phase, "phase5");
  assert.equal(parsed.status, "pass");
  assert.ok(parsed.room?.id);
  assert.ok(parsed.room?.remoteAgentId);
  assert.equal(parsed.room?.remoteAgentIds?.length, 2);
  assert.deepEqual(parsed.checks?.map((check) => check.id), [
    "control-plane-health",
    "signed-invite-enrollment",
    "one-file-room-bootstrap",
    "registered-agent-pull-communication",
    "web-invite-bundle",
    "revoked-invite-join-blocked",
    "revoked-agent-signed-ops-blocked",
    "room-key-rotation",
    "suspended-agent-blocked",
    "routed-message-delivery",
    "multi-agent-route-isolation",
    "no-broadcast-fallback-execution",
    "signed-ack-heartbeat",
    "room-delivery-status",
    "control-plane-event-stream",
    "stale-agent-health-detected",
    "stale-agent-recovery",
    "signed-template-reply",
    "room-assignment-result",
    "agent-to-agent-exchange",
    "room-handoff",
    "room-conflict-resolution",
    "room-result-sync",
    "operator-room-visibility",
    "runner-stop-file-shutdown",
    "secret-shape-scan",
  ]);
  assert.equal(parsed.checks?.every((check) => check.status === "pass"), true);
  const eventStreamCheck = parsed.checks?.find((check) => check.id === "control-plane-event-stream");
  assert.equal(parsed.room?.controlPlaneRoomMessageEventObserved, true);
  assert.ok(parsed.room?.controlPlaneEventStreamRoomMessageIds?.length);
  assert.equal(parsed.room?.controlPlaneDeliveryAckEventObserved, true);
  assert.ok(parsed.room?.controlPlaneEventStreamAckMessageIds?.length);
  assert.deepEqual(eventStreamCheck?.metadata?.roomMessageEventTypes, ["room.message.sent"]);
  assert.deepEqual(eventStreamCheck?.metadata?.deliveryAckEventTypes, ["room.delivery.acknowledged"]);
  const deliveryStatusCheck = parsed.checks?.find((check) => check.id === "room-delivery-status");
  assert.equal(parsed.room?.controlPlaneDeliveryStatusObserved, true);
  assert.deepEqual(parsed.room?.controlPlaneDeliveryStatusAgentIds?.sort(), parsed.room?.remoteAgentIds?.slice().sort());
  for (const agentId of parsed.room?.remoteAgentIds ?? []) {
    assert.equal(parsed.room?.controlPlaneDeliveryStatusPendingCounts?.[agentId], 0);
  }
  assert.equal(deliveryStatusCheck?.metadata?.agentCount, 2);
  const noBroadcastFallbackCheck = parsed.checks?.find((check) => check.id === "no-broadcast-fallback-execution");
  assert.equal(noBroadcastFallbackCheck?.status, "pass");
  assert.match(String(noBroadcastFallbackCheck?.metadata?.messageId ?? ""), /^msg_/);
  assert.equal(noBroadcastFallbackCheck?.metadata?.transcriptVisible, true);
  assert.equal(noBroadcastFallbackCheck?.metadata?.handledCount, 0);
  assert.equal(parsed.room?.broadcastFallbackMessageId, noBroadcastFallbackCheck?.metadata?.messageId);
  assert.equal(parsed.room?.broadcastFallbackHandledCount, 0);
  for (const agentId of parsed.room?.remoteAgentIds ?? []) {
    assert.equal(parsed.room?.broadcastFallbackInboxCounts?.[agentId], 0);
    assert.equal(parsed.room?.broadcastFallbackPendingCounts?.[agentId], 0);
  }
  const webInviteBundleCheck = parsed.checks?.find((check) => check.id === "web-invite-bundle");
  assert.equal(webInviteBundleCheck?.status, "pass");
  assert.equal(webInviteBundleCheck?.metadata?.bundleKind, "soloclaw.room_invite");
  assert.equal(webInviteBundleCheck?.metadata?.inviteSignatureStatus, "valid");
  assert.equal(webInviteBundleCheck?.metadata?.enrollCommandPresent, true);
  assert.equal(webInviteBundleCheck?.metadata?.runCommandPresent, true);
  assert.equal(webInviteBundleCheck?.metadata?.stateLeakedInviteToken, false);
  assert.equal(webInviteBundleCheck?.metadata?.auditLeakedInviteToken, false);
  assert.ok(parsed.room?.bootstrapAgentId);
  assert.equal(parsed.room?.bootstrapRunnerStatusFileObserved, true);
  assert.equal(parsed.room?.bootstrapRunnerStopReason, "idle");
  assert.equal(parsed.room?.bootstrapRunnerLastHeartbeatStatus, "idle");
  const pullCommunicationCheck = parsed.checks?.find((check) => check.id === "registered-agent-pull-communication");
  assert.equal(pullCommunicationCheck?.status, "pass");
  assert.match(String(pullCommunicationCheck?.metadata?.agentId ?? ""), /^agent_/);
  assert.equal(pullCommunicationCheck?.metadata?.registered, true);
  assert.equal(pullCommunicationCheck?.metadata?.invitationListed, true);
  assert.equal(pullCommunicationCheck?.metadata?.accepted, true);
  assert.match(String(pullCommunicationCheck?.metadata?.taskMessageId ?? ""), /^msg_/);
  assert.match(String(pullCommunicationCheck?.metadata?.replyMessageId ?? ""), /^msg_/);
  assert.deepEqual(pullCommunicationCheck?.metadata?.handledMessages, [pullCommunicationCheck?.metadata?.taskMessageId]);
  assert.equal(pullCommunicationCheck?.metadata?.ackSigned, true);
  assert.equal(pullCommunicationCheck?.metadata?.replySignatureStatus, "valid");
  assert.equal(pullCommunicationCheck?.metadata?.heartbeatStatus, "idle");
  assert.equal(pullCommunicationCheck?.metadata?.runStopReason, "idle");
  assert.match(parsed.room?.pulledAgentId ?? "", /^agent_/);
  assert.equal(parsed.room?.pulledAgentInvitationListed, true);
  assert.equal(parsed.room?.pulledAgentAccepted, true);
  assert.match(parsed.room?.pulledAgentTaskMessageId ?? "", /^msg_/);
  assert.match(parsed.room?.pulledAgentReplyMessageId ?? "", /^msg_/);
  assert.equal(parsed.room?.pulledAgentAckSigned, true);
  assert.equal(parsed.room?.pulledAgentHeartbeatStatus, "idle");
  assert.equal(parsed.room?.pulledAgentRunStopReason, "idle");
  assert.ok(parsed.room?.revokedAgentId);
  assert.equal(parsed.room?.revokedAgentSignedSayBlocked, true);
  assert.equal(parsed.room?.revokedAgentSignedAckBlocked, true);
  assert.equal(parsed.room?.revokedAgentSignedHeartbeatBlocked, true);
  assert.ok(parsed.room?.keyRotationAgentId);
  assert.match(parsed.room?.keyRotationPreviousFingerprint ?? "", /^SHA256:/);
  assert.match(parsed.room?.keyRotationRotatedFingerprint ?? "", /^SHA256:/);
  assert.notEqual(parsed.room?.keyRotationPreviousFingerprint, parsed.room?.keyRotationRotatedFingerprint);
  assert.equal(parsed.room?.keyRotationOldSignedSayBlocked, true);
  assert.equal(parsed.room?.keyRotationNewSignedSayAccepted, true);
  assert.equal(parsed.room?.keyRotationAuditEventVisible, true);
  assert.ok(parsed.room?.keyRotationMessageId);
  const assignmentCheck = parsed.checks?.find((check) => check.id === "room-assignment-result");
  assert.equal(assignmentCheck?.status, "pass");
  assert.equal(assignmentCheck?.metadata?.targetAgentId, parsed.room?.remoteAgentIds?.[0]);
  assert.match(String(assignmentCheck?.metadata?.subtaskId ?? ""), /^subtask_/);
  assert.match(String(assignmentCheck?.metadata?.childSessionId ?? ""), /^sess_/);
  assert.match(String(assignmentCheck?.metadata?.assignmentMessageId ?? ""), /^msg_/);
  assert.match(String(assignmentCheck?.metadata?.resultMessageId ?? ""), /^msg_/);
  assert.equal(assignmentCheck?.metadata?.assignmentMessageVisible, true);
  assert.equal(assignmentCheck?.metadata?.resultMessageVisible, true);
  assert.equal(assignmentCheck?.metadata?.resultStatus, "completed");
  assert.equal(parsed.room?.roomAssignmentTargetAgentId, parsed.room?.remoteAgentIds?.[0]);
  assert.match(parsed.room?.roomAssignmentSubtaskId ?? "", /^subtask_/);
  assert.match(parsed.room?.roomAssignmentChildSessionId ?? "", /^sess_/);
  assert.match(parsed.room?.roomAssignmentMessageId ?? "", /^msg_/);
  assert.match(parsed.room?.roomAssignmentResultMessageId ?? "", /^msg_/);
  assert.ok(parsed.room?.agentExchangeMessageId);
  assert.ok(parsed.room?.agentExchangeReplyMessageId);
  assert.equal(parsed.room?.agentExchangeSenderId, parsed.room?.remoteAgentIds?.[0]);
  assert.equal(parsed.room?.agentExchangeReceiverId, parsed.room?.remoteAgentIds?.[1]);
  const handoffCheck = parsed.checks?.find((check) => check.id === "room-handoff");
  assert.equal(handoffCheck?.status, "pass");
  assert.match(String(handoffCheck?.metadata?.handoffId ?? ""), /^handoff_/);
  assert.equal(handoffCheck?.metadata?.sourceAgentId, parsed.room?.remoteAgentIds?.[0]);
  assert.equal(handoffCheck?.metadata?.targetAgentId, parsed.room?.remoteAgentIds?.[1]);
  assert.match(String(handoffCheck?.metadata?.handoffMessageId ?? ""), /^msg_/);
  assert.match(String(handoffCheck?.metadata?.acceptanceMessageId ?? ""), /^msg_/);
  assert.match(String(handoffCheck?.metadata?.resultMessageId ?? ""), /^msg_/);
  assert.equal(handoffCheck?.metadata?.handoffMessageVisible, true);
  assert.equal(handoffCheck?.metadata?.acceptanceMessageVisible, true);
  assert.equal(handoffCheck?.metadata?.resultMessageVisible, true);
  assert.equal(handoffCheck?.metadata?.handoffAccepted, true);
  assert.equal(handoffCheck?.metadata?.handoffCompleted, true);
  assert.equal(handoffCheck?.metadata?.resultStatus, "completed");
  assert.match(parsed.room?.roomHandoffId ?? "", /^handoff_/);
  assert.equal(parsed.room?.roomHandoffSourceAgentId, parsed.room?.remoteAgentIds?.[0]);
  assert.equal(parsed.room?.roomHandoffTargetAgentId, parsed.room?.remoteAgentIds?.[1]);
  assert.match(parsed.room?.roomHandoffMessageId ?? "", /^msg_/);
  assert.match(parsed.room?.roomHandoffAcceptanceMessageId ?? "", /^msg_/);
  assert.match(parsed.room?.roomHandoffResultMessageId ?? "", /^msg_/);
  const conflictCheck = parsed.checks?.find((check) => check.id === "room-conflict-resolution");
  assert.equal(conflictCheck?.status, "pass");
  assert.match(String(conflictCheck?.metadata?.resultKey ?? ""), /^phase5-conflict-/);
  assert.equal(conflictCheck?.metadata?.primaryAgentId, parsed.room?.remoteAgentIds?.[0]);
  assert.equal(conflictCheck?.metadata?.conflictingAgentId, parsed.room?.remoteAgentIds?.[1]);
  assert.equal(conflictCheck?.metadata?.winningAgentId, parsed.room?.remoteAgentIds?.[0]);
  assert.match(String(conflictCheck?.metadata?.primaryMessageId ?? ""), /^msg_/);
  assert.match(String(conflictCheck?.metadata?.conflictingMessageId ?? ""), /^msg_/);
  assert.match(String(conflictCheck?.metadata?.resolutionMessageId ?? ""), /^msg_/);
  assert.equal(conflictCheck?.metadata?.conflictDetected, true);
  assert.equal(conflictCheck?.metadata?.resolutionRecorded, true);
  assert.equal(conflictCheck?.metadata?.resolutionStatus, "resolved");
  assert.match(parsed.room?.roomConflictResultKey ?? "", /^phase5-conflict-/);
  assert.equal(parsed.room?.roomConflictPrimaryAgentId, parsed.room?.remoteAgentIds?.[0]);
  assert.equal(parsed.room?.roomConflictSecondaryAgentId, parsed.room?.remoteAgentIds?.[1]);
  assert.equal(parsed.room?.roomConflictWinningAgentId, parsed.room?.remoteAgentIds?.[0]);
  assert.match(parsed.room?.roomConflictPrimaryMessageId ?? "", /^msg_/);
  assert.match(parsed.room?.roomConflictSecondaryMessageId ?? "", /^msg_/);
  assert.match(parsed.room?.roomConflictResolutionMessageId ?? "", /^msg_/);
  const resultSyncCheck = parsed.checks?.find((check) => check.id === "room-result-sync");
  assert.equal(resultSyncCheck?.status, "pass");
  assert.equal(resultSyncCheck?.metadata?.agentId, parsed.room?.remoteAgentIds?.[1]);
  assert.match(String(resultSyncCheck?.metadata?.artifactId ?? ""), /^art_/);
  assert.equal(resultSyncCheck?.metadata?.artifactKind, "report");
  assert.equal(resultSyncCheck?.metadata?.artifactName, "phase5-result-sync.json");
  assert.equal(resultSyncCheck?.metadata?.artifactRoomId, parsed.room?.id);
  assert.equal(resultSyncCheck?.metadata?.artifactStatus, "active");
  assert.match(String(resultSyncCheck?.metadata?.artifactSha256 ?? ""), /^[a-f0-9]{64}$/i);
  assert.equal(Number(resultSyncCheck?.metadata?.artifactSizeBytes ?? 0) > 0, true);
  assert.match(String(resultSyncCheck?.metadata?.artifactMessageId ?? ""), /^msg_/);
  assert.equal(resultSyncCheck?.metadata?.artifactRegistered, true);
  assert.equal(resultSyncCheck?.metadata?.artifactMessageVisible, true);
  assert.equal(parsed.room?.roomResultSyncAgentId, parsed.room?.remoteAgentIds?.[1]);
  assert.match(parsed.room?.roomResultSyncArtifactId ?? "", /^art_/);
  assert.match(parsed.room?.roomResultSyncArtifactMessageId ?? "", /^msg_/);
  assert.match(parsed.room?.roomResultSyncArtifactSha256 ?? "", /^[a-f0-9]{64}$/i);
  assert.equal((parsed.room?.roomResultSyncArtifactSizeBytes ?? 0) > 0, true);
  const stopFileCheck = parsed.checks?.find((check) => check.id === "runner-stop-file-shutdown");
  assert.equal(stopFileCheck?.status, "pass");
  assert.equal(stopFileCheck?.metadata?.agentId, parsed.room?.remoteAgentIds?.[0]);
  assert.equal(stopFileCheck?.metadata?.runnerStopReason, "shutdown_requested");
  assert.equal(stopFileCheck?.metadata?.runnerStatusKind, "soloclaw.remote_room_runner_status");
  assert.equal(stopFileCheck?.metadata?.runnerStatus, "stopped");
  assert.equal(stopFileCheck?.metadata?.runnerStatusFileObserved, true);
  assert.equal(parsed.room?.stopFileShutdownAgentId, parsed.room?.remoteAgentIds?.[0]);
  assert.equal(parsed.room?.stopFileShutdownReason, "shutdown_requested");
  assert.equal(parsed.room?.stopFileShutdownStatusFileObserved, true);
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 checklist CLI describes the current per-target evidence collection workflow", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-checklist-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "checklist",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /phase5 matrix-template --target <target-id>/);
  assert.match(result.stdout, /phase5 evidence-plan --registered-pull-target <remote-target-id>/);
  assert.match(result.stdout, /phase5 collection-runbook --json/);
  assert.match(result.stdout, /phase5 collection-prepare --json/);
  assert.match(result.stdout, /phase5 collector-guide --target <target-id>/);
  assert.match(result.stdout, /--include-smoke-commands/);
  assert.match(result.stdout, /--registered-pull-target <remote-target-id>/);
  assert.match(result.stdout, /phase5 collector-pack --json/);
  assert.match(result.stdout, /phase5 collector-pack --target <target-id> --json/);
  assert.match(result.stdout, /phase5 evidence-check --file <fragment\.json> --target <target-id>/);
  assert.match(result.stdout, /phase5 evidence-merge --file <base\.json> --target-file <fragment\.json>/);
  assert.match(result.stdout, /registered-agent pull path.*signed ack.*signed reply/i);
  assert.match(result.stdout, /key rotation/i);
  assert.doesNotMatch(result.stdout, /key rotation.*future work/i);
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("soloclaw help exposes Phase 5 evidence template and target preflight commands", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-help-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "--help",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /soloclaw phase5 evidence-template \[--target id\] \[--registered-pull-target id\]/);
  assert.match(result.stdout, /soloclaw phase5 evidence-plan \[--registered-pull-target id\]/);
  assert.match(result.stdout, /soloclaw phase5 collection-runbook \[--registered-pull-target id\] \[--output path\] \[--force\]/);
  assert.match(result.stdout, /soloclaw phase5 collection-prepare/);
  assert.match(result.stdout, /soloclaw phase5 registered-pull-operator-next --registered-pull-target id \[--output path\] \[--force\]/);
  assert.match(result.stdout, /soloclaw phase5 registered-pull-evidence-patch --registered-pull-target id \[--status-file path\] \[--pull-agent-file path\] \[--invitations-file path\] \[--accept-room-file path\] \[--room-show-file path\] \[--delivery-status-file path\] \[--output path\] \[--control-fragment-file path --patched-control-fragment-output path\] \[--force\]/);
  assert.match(result.stdout, /soloclaw phase5 collector-guide --target id \[--registered-pull-target id\] \[--include-smoke-commands\]/);
  assert.match(result.stdout, /soloclaw phase5 collector-pack \[--target id\] \[--registered-pull-target id\] \[--include-smoke-commands\] \[--force\]/);
  assert.match(result.stdout, /soloclaw phase5 evidence-init \[--registered-pull-target id\] \[--force\]/);
  assert.match(result.stdout, /soloclaw phase5 evidence-status --file path --target-dir path \[--target id\] \[--registered-pull-target id\] \[--include-missing-evidence\]/);
  assert.match(result.stdout, /soloclaw phase5 evidence-check --file path --target id/);
  assert.match(result.stdout, /soloclaw phase5 evidence-merge --file path --target-file path/);
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 matrix-template CLI prints a cross-machine smoke matrix", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-matrix-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "matrix-template",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    phase?: string;
    targets?: Array<{ id?: string; role?: string; commands?: string[] }>;
    placeholders?: string[];
  };
  assert.equal(parsed.phase, "phase5");
  assert.deepEqual(parsed.targets?.map((target) => target.id), [
    "control-plane-host",
    "windows-powershell-agent",
    "windows-cmd-agent",
    "linux-shell-agent",
    "macos-shell-agent",
    "android-termux-agent",
  ]);
  assert.equal(parsed.targets?.filter((target) => target.role === "remote-agent").length, 5);
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("remote say"))));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("room invite-agent")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("rooms revoke-invite")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("agents trust") && command.includes("revoked")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("<revoked-agent-id>")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("rooms status") && command.includes("suspended")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("<suspended-agent-id>")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("agents health") && command.includes("--now")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("room pull-agent") && command.includes("<registered-pull-agent-id>")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("<registered-pull-message-id>")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("/api/events?room=<room-id>")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) =>
    command.includes("type=room.delivery.acknowledged") &&
    command.includes("eventStreamAckMessageIds") &&
    command.includes("deliveryStatusAckMessageIds")
  ));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("/api/rooms/<room-id>/delivery-status")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("<stale-agent-id>")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("<revoked-invite-bundle-file>")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("delegate --room") && command.includes("--assigned-agent <assignment-target-agent-id>")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("conflict resolution") && command.includes("<conflict-result-key>")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("artifacts add") && command.includes("<result-sync-artifact-file>")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("result sync artifact") && command.includes("<result-sync-artifact-id>")));
  assert.ok(parsed.targets?.find((target) => target.id === "control-plane-host")?.commands?.some((command) => command.includes("rooms show") && command.includes("handoff message ids")));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("artifact conflict probe") && command.includes("<conflict-result-key>"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("result-file probe") && command.includes("<result-sync-target-agent-id>"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("handoff request") && command.includes("<handoff-source-agent-id>"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("handoff acceptance") && command.includes("<handoff-acceptance-message-id>"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("handoff completion") && command.includes("<handoff-result-message-id>"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("remote register") && command.includes("<registered-pull-agent-id>"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("remote invitations"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("remote accept-room") && command.includes("<registered-pull-target-id>"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("room join"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("remote heartbeat") && command.includes("--ttl 1"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("remote service") && command.includes("--control-token <control-token>"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("room join") && command.includes("--run"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) =>
    command.includes("bootstrapEvidence") &&
    command.includes("inviteBundleKind") &&
    command.includes("joinedFromInviteBundle") &&
    command.includes("ranFromInviteBundle")
  )));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("--status-file"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("phase5-remote-room-status.json"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("--stop-file"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("phase5-remote-room.stop"))));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => /Remove-Item|del \/f|rm -f/.test(command))));
  const stopCreatePatterns = new Map<string, RegExp>([
    ["windows-powershell-agent", /New-Item .*phase5-remote-room\.stop/],
    ["windows-cmd-agent", /(?:copy \/y NUL|type nul >) .*phase5-remote-room\.stop/i],
    ["linux-shell-agent", /touch .*phase5-remote-room\.stop/],
    ["macos-shell-agent", /touch .*phase5-remote-room\.stop/],
    ["android-termux-agent", /touch .*phase5-remote-room\.stop/],
  ]);
  for (const [targetId, pattern] of stopCreatePatterns) {
    const target = parsed.targets?.find((entry) => entry.id === targetId);
    assert.ok(target?.commands?.some((command) => pattern.test(command)), `${targetId} should print a stop-marker creation command`);
  }
  assert.ok(parsed.placeholders?.includes("<control-url>"));
  assert.ok(parsed.placeholders?.includes("<invite-bundle-file>"));
  assert.ok(parsed.placeholders?.includes("<peer-agent-id>"));
  assert.ok(parsed.placeholders?.includes("<registered-pull-agent-id>"));
  assert.ok(parsed.placeholders?.includes("<registered-pull-target-id>"));
  assert.ok(parsed.placeholders?.includes("<registered-pull-message-id>"));
  assert.ok(parsed.placeholders?.includes("<registered-pull-reply-message-id>"));
  assert.ok(parsed.placeholders?.includes("<stale-agent-id>"));
  assert.ok(parsed.placeholders?.includes("<revoked-agent-id>"));
  assert.ok(parsed.placeholders?.includes("<assignment-target-agent-id>"));
  assert.ok(parsed.placeholders?.includes("<conflict-result-key>"));
  assert.ok(parsed.placeholders?.includes("<conflict-primary-agent-id>"));
  assert.ok(parsed.placeholders?.includes("<conflict-secondary-agent-id>"));
  assert.ok(parsed.placeholders?.includes("<conflict-resolution-message-id>"));
  assert.ok(parsed.placeholders?.includes("<result-sync-target-agent-id>"));
  assert.ok(parsed.placeholders?.includes("<result-sync-artifact-file>"));
  assert.ok(parsed.placeholders?.includes("<result-sync-artifact-id>"));
  assert.ok(parsed.placeholders?.includes("<result-sync-artifact-message-id>"));
  assert.ok(parsed.placeholders?.includes("<result-sync-artifact-sha256>"));
  assert.ok(parsed.placeholders?.includes("<result-sync-artifact-size-bytes>"));
  assert.ok(parsed.placeholders?.includes("<handoff-id>"));
  assert.ok(parsed.placeholders?.includes("<handoff-source-agent-id>"));
  assert.ok(parsed.placeholders?.includes("<handoff-target-agent-id>"));
  assert.ok(parsed.placeholders?.includes("<handoff-message-id>"));
  assert.ok(parsed.placeholders?.includes("<handoff-acceptance-message-id>"));
  assert.ok(parsed.placeholders?.includes("<handoff-result-message-id>"));
  assert.ok(parsed.placeholders?.includes("<no-broadcast-fallback-message-id>"));
  assert.ok(parsed.placeholders?.includes("<stale-health-check-now-iso>"));
  const controlHost = parsed.targets?.find((entry) => entry.id === "control-plane-host");
  assert.ok(controlHost?.commands?.some((command) => command.includes("no-broadcast fallback probe")));
  assert.ok(controlHost?.commands?.some((command) =>
    command.includes("no-broadcast fallback probe") &&
    command.includes("<no-broadcast-fallback-message-id>") &&
    command.includes("eventStreamRoomMessageIds")
  ));
  assert.ok(parsed.targets?.filter((target) => target.role === "remote-agent").every((target) => target.commands?.some((command) => command.includes("noBroadcastFallback"))));
  assert.doesNotMatch(result.stdout, /sk-[A-Za-z0-9_-]{12,}|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 matrix-template CLI can print commands for one target", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-matrix-target-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "matrix-template",
    "--target",
    "linux-shell-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    phase?: string;
    targets?: Array<{ id?: string; role?: string; commands?: string[] }>;
    placeholders?: string[];
  };
  assert.equal(parsed.phase, "phase5");
  assert.deepEqual(parsed.targets?.map((target) => target.id), ["linux-shell-agent"]);
  assert.equal(parsed.targets?.[0]?.role, "remote-agent");
  assert.ok(parsed.targets?.[0]?.commands?.some((command) => command.includes("room join") && command.includes("--run")));
  assert.ok(parsed.targets?.[0]?.commands?.some((command) => command.includes("remote say")));
  assert.ok(parsed.placeholders?.includes("<control-url>"));
  assert.ok(parsed.placeholders?.includes("<room-id>"));
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 matrix-template CLI rejects unknown target filters", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-matrix-unknown-target-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "matrix-template",
    "--target",
    "unknown-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Unknown Phase 5 matrix target: unknown-agent/);
  assert.doesNotMatch(result.stderr, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-plan CLI prints a per-target collection manifest", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-plan-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-plan",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    phase?: string;
    action?: string;
    fragmentsDir?: string;
    baseEvidenceFile?: string;
    mergedEvidenceFile?: string;
    requiredTargetIds?: string[];
    targets?: Array<{
      id?: string;
      role?: string;
      fragmentFileName?: string;
      fragmentPath?: string;
      matrixCommand?: string;
      templateCommand?: string;
      preflightCommand?: string;
      statusCommand?: string;
      collectorGuideCommand?: string;
    }>;
    controlHostCommands?: string[];
  };
  assert.equal(parsed.phase, "phase5");
  assert.equal(parsed.action, "evidence-plan");
  assert.equal(parsed.fragmentsDir, "phase5-fragments");
  assert.equal(parsed.baseEvidenceFile, "phase5-evidence.json");
  assert.equal(parsed.mergedEvidenceFile, "phase5-evidence.merged.json");
  assert.deepEqual(parsed.requiredTargetIds, [
    "control-plane-host",
    "windows-powershell-agent",
    "windows-cmd-agent",
    "linux-shell-agent",
    "macos-shell-agent",
    "android-termux-agent",
  ]);
  assert.equal(parsed.targets?.length, 6);
  const linux = parsed.targets?.find((target) => target.id === "linux-shell-agent");
  const control = parsed.targets?.find((target) => target.id === "control-plane-host");
  assert.equal(linux?.role, "remote-agent");
  assert.equal(linux?.fragmentFileName, "linux-shell-agent.json");
  assert.equal(linux?.fragmentPath, "phase5-fragments/linux-shell-agent.json");
  assert.equal(linux?.matrixCommand, "soloclaw phase5 matrix-template --target linux-shell-agent --json");
  assert.equal(linux?.templateCommand, "soloclaw phase5 evidence-template --target linux-shell-agent --json");
  assert.equal(linux?.preflightCommand, "soloclaw phase5 evidence-check --file phase5-fragments/linux-shell-agent.json --target linux-shell-agent --json");
  assert.equal(linux?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --json");
  assert.equal(linux?.collectorGuideCommand, "soloclaw phase5 collector-guide --target linux-shell-agent --json");
  assert.equal(control?.role, "control-plane");
  assert.ok(parsed.controlHostCommands?.includes("soloclaw phase5 evidence-template --json"));
  assert.ok(parsed.controlHostCommands?.includes("soloclaw phase5 collection-runbook --json"));
  assert.ok(parsed.controlHostCommands?.includes("soloclaw phase5 collection-prepare --json"));
  assert.ok(parsed.controlHostCommands?.includes("soloclaw phase5 collector-pack --json"));
  assert.ok(parsed.controlHostCommands?.includes("soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json"));
  assert.ok(parsed.controlHostCommands?.includes("soloclaw phase5 evidence-check --file phase5-evidence.merged.json --json"));
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-plan can pin the registered-agent pull target across manifest commands", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-plan-registered-pull-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-plan",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    registeredPullTargetId?: string;
    targets?: Array<{ id?: string; templateCommand?: string; statusCommand?: string; collectorGuideCommand?: string }>;
    controlHostCommands?: string[];
  };
  assert.equal(parsed.registeredPullTargetId, "linux-shell-agent");
  assert.equal(parsed.targets?.find((target) => target.id === "linux-shell-agent")?.templateCommand, "soloclaw phase5 evidence-template --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.targets?.find((target) => target.id === "windows-cmd-agent")?.templateCommand, "soloclaw phase5 evidence-template --target windows-cmd-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.targets?.find((target) => target.id === "linux-shell-agent")?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.targets?.find((target) => target.id === "windows-cmd-agent")?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target windows-cmd-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.targets?.find((target) => target.id === "linux-shell-agent")?.collectorGuideCommand, "soloclaw phase5 collector-guide --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.targets?.find((target) => target.id === "windows-cmd-agent")?.collectorGuideCommand, "soloclaw phase5 collector-guide --target windows-cmd-agent --registered-pull-target linux-shell-agent --json");
  assert.ok(parsed.controlHostCommands?.includes("soloclaw phase5 evidence-template --registered-pull-target linux-shell-agent --json"));
  assert.ok(parsed.controlHostCommands?.includes("soloclaw phase5 collection-runbook --registered-pull-target linux-shell-agent --json"));
  assert.ok(parsed.controlHostCommands?.includes("soloclaw phase5 collection-prepare --registered-pull-target linux-shell-agent --json"));
  assert.ok(parsed.controlHostCommands?.includes("soloclaw phase5 collector-pack --registered-pull-target linux-shell-agent --json"));
  assert.equal(parsed.controlHostCommands?.includes("soloclaw phase5 collection-runbook --json"), false);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 collection-runbook CLI prints the token-safe control-host sequence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collection-runbook-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "collection-runbook",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    phase?: string;
    action?: string;
    baseEvidenceFile?: string;
    fragmentsDir?: string;
    guidesDir?: string;
    mergedEvidenceFile?: string;
    requiredTargetIds?: string[];
    commands?: {
      initializeEvidence?: string;
      writeCollectorGuides?: string;
      collectionStatus?: string;
      mergeFragments?: string;
      finalEvidenceCheck?: string;
    };
    targetGuides?: Array<{ targetId?: string; guidePath?: string; fragmentPath?: string; preflightCommand?: string; statusCommand?: string; collectorGuideCommand?: string }>;
    steps?: Array<{ id?: string; command?: string }>;
    notes?: string[];
  };
  assert.equal(parsed.phase, "phase5");
  assert.equal(parsed.action, "collection-runbook");
  assert.equal(parsed.baseEvidenceFile, "phase5-evidence.json");
  assert.equal(parsed.fragmentsDir, "phase5-fragments");
  assert.equal(parsed.guidesDir, "phase5-collector-guides");
  assert.equal(parsed.mergedEvidenceFile, "phase5-evidence.merged.json");
  assert.deepEqual(parsed.requiredTargetIds, [
    "control-plane-host",
    "windows-powershell-agent",
    "windows-cmd-agent",
    "linux-shell-agent",
    "macos-shell-agent",
    "android-termux-agent",
  ]);
  assert.equal(parsed.commands?.initializeEvidence, "soloclaw phase5 evidence-init --json");
  assert.equal(parsed.commands?.writeCollectorGuides, "soloclaw phase5 collector-pack --json");
  assert.equal(parsed.commands?.collectionStatus, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --json");
  assert.equal(parsed.commands?.mergeFragments, "soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json");
  assert.equal(parsed.commands?.finalEvidenceCheck, "soloclaw phase5 evidence-check --file phase5-evidence.merged.json --json");
  assert.equal(parsed.targetGuides?.length, 6);
  const linux = parsed.targetGuides?.find((guide) => guide.targetId === "linux-shell-agent");
  assert.equal(linux?.guidePath, "phase5-collector-guides/linux-shell-agent.md");
  assert.equal(linux?.fragmentPath, "phase5-fragments/linux-shell-agent.json");
  assert.equal(linux?.preflightCommand, "soloclaw phase5 evidence-check --file phase5-fragments/linux-shell-agent.json --target linux-shell-agent --json");
  assert.equal(linux?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --json");
  assert.equal(linux?.collectorGuideCommand, "soloclaw phase5 collector-guide --target linux-shell-agent --json");
  assert.deepEqual(parsed.steps?.map((step) => step.id), [
    "initialize-evidence",
    "write-collector-guides",
    "distribute-target-materials",
    "collect-fragments",
    "watch-status",
    "merge-fragments",
    "final-evidence-check",
  ]);
  assert.ok(parsed.notes?.some((note) => note.includes("final Phase 5 acceptance")));
  assert.ok(parsed.notes?.some((note) => note.includes("registered-agent pull") && note.includes("remote register") && note.includes("remote accept-room") && note.includes("remote run")));
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);
});

test("phase5 collection-runbook can pin the registered-agent pull target", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collection-runbook-registered-pull-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "collection-runbook",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    phase?: string;
    action?: string;
    registeredPullTargetId?: string;
    commands?: { initializeEvidence?: string; writeCollectorGuides?: string; collectionStatus?: string };
    targetGuides?: Array<{
      targetId?: string;
      isRegisteredPullTarget?: boolean;
      templateCommand?: string;
      statusCommand?: string;
      collectorGuideCommand?: string;
      operatorNextCommands?: string[];
      evidenceFileHandoff?: {
        selectedTargetProduces?: Array<{ path?: string; controlHostCopyTo?: string; consumedBy?: string }>;
        controlHostProduces?: Array<{ path?: string; consumedBy?: string }>;
        patchInputs?: string[];
        patchOutputFile?: string;
        pastePath?: string;
      };
    }>;
    registeredPullEvidenceFileHandoff?: {
      selectedTargetProduces?: Array<{ path?: string; controlHostCopyTo?: string; consumedBy?: string }>;
      controlHostProduces?: Array<{ path?: string; consumedBy?: string }>;
      patchInputs?: string[];
      patchOutputFile?: string;
      pastePath?: string;
    };
    registeredPullControlHostRunbook?: {
      targetId?: string;
      targetGuidePath?: string;
      targetFragmentPath?: string;
      controlFragmentPath?: string;
      stages?: Array<{ id?: string; commandName?: string; commandHint?: string; evidenceFields?: string[]; waitsFor?: string }>;
      notes?: string[];
    };
    notes?: string[];
  };
  assert.equal(parsed.phase, "phase5");
  assert.equal(parsed.action, "collection-runbook");
  assert.equal(parsed.registeredPullTargetId, "linux-shell-agent");
  assert.equal(parsed.commands?.initializeEvidence, "soloclaw phase5 evidence-init --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.commands?.writeCollectorGuides, "soloclaw phase5 collector-pack --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.commands?.collectionStatus, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.targetGuides?.find((guide) => guide.targetId === "linux-shell-agent")?.isRegisteredPullTarget, true);
  assert.equal(parsed.targetGuides?.find((guide) => guide.targetId === "windows-cmd-agent")?.isRegisteredPullTarget, false);
  assert.equal(parsed.targetGuides?.find((guide) => guide.targetId === "linux-shell-agent")?.templateCommand, "soloclaw phase5 evidence-template --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.targetGuides?.find((guide) => guide.targetId === "windows-cmd-agent")?.templateCommand, "soloclaw phase5 evidence-template --target windows-cmd-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.targetGuides?.find((guide) => guide.targetId === "linux-shell-agent")?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.targetGuides?.find((guide) => guide.targetId === "windows-cmd-agent")?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target windows-cmd-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.targetGuides?.find((guide) => guide.targetId === "linux-shell-agent")?.collectorGuideCommand, "soloclaw phase5 collector-guide --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.targetGuides?.find((guide) => guide.targetId === "windows-cmd-agent")?.collectorGuideCommand, "soloclaw phase5 collector-guide --target windows-cmd-agent --registered-pull-target linux-shell-agent --json");
  assert.ok(parsed.targetGuides?.find((guide) => guide.targetId === "linux-shell-agent")?.operatorNextCommands?.some((command) => command.includes("agent remote run --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN")));
  assert.ok(parsed.targetGuides?.find((guide) => guide.targetId === "control-plane-host")?.operatorNextCommands?.some((command) => command.includes("agent rooms pull-agent <room-id> <registered-pull-agent-id>") && command.includes("> pull-agent.json")));
  assert.ok(parsed.targetGuides?.find((guide) => guide.targetId === "control-plane-host")?.operatorNextCommands?.some((command) => command.includes("soloclaw phase5 registered-pull-evidence-patch --registered-pull-target linux-shell-agent") && command.includes("--delivery-status-file delivery-status.json")));
  assert.equal(parsed.targetGuides?.find((guide) => guide.targetId === "windows-cmd-agent")?.operatorNextCommands, undefined);
  assert.deepEqual(parsed.registeredPullEvidenceFileHandoff?.selectedTargetProduces?.map((file) => `${file.path}->${file.controlHostCopyTo}`), [
    ".agent/tmp/phase5-registered-pull-status.json->.agent/tmp/phase5-registered-pull-status.json",
    "invitations.json->invitations.json",
    "accept-room.json->accept-room.json",
  ]);
  assert.deepEqual(parsed.registeredPullEvidenceFileHandoff?.controlHostProduces?.map((file) => `${file.path}->${file.consumedBy}`), [
    "pull-agent.json->registered-pull-evidence-patch",
    "room-show.json->registered-pull-evidence-patch",
    "delivery-status.json->registered-pull-evidence-patch",
    "phase5-registered-pull-evidence-patch.json->control-plane-fragment-paste",
  ]);
  assert.deepEqual(parsed.registeredPullEvidenceFileHandoff?.patchInputs, [
    ".agent/tmp/phase5-registered-pull-status.json",
    "pull-agent.json",
    "invitations.json",
    "accept-room.json",
    "room-show.json",
    "delivery-status.json",
  ]);
  assert.equal(parsed.registeredPullEvidenceFileHandoff?.patchOutputFile, "phase5-registered-pull-evidence-patch.json");
  assert.equal(parsed.registeredPullEvidenceFileHandoff?.pastePath, "room.registeredAgentPull");
  assert.equal(parsed.targetGuides?.find((guide) => guide.targetId === "linux-shell-agent")?.evidenceFileHandoff?.pastePath, "room.registeredAgentPull");
  assert.equal(parsed.targetGuides?.find((guide) => guide.targetId === "control-plane-host")?.evidenceFileHandoff?.patchOutputFile, "phase5-registered-pull-evidence-patch.json");
  assert.equal(parsed.targetGuides?.find((guide) => guide.targetId === "windows-cmd-agent")?.evidenceFileHandoff, undefined);
  assert.equal(parsed.registeredPullControlHostRunbook?.targetId, "linux-shell-agent");
  assert.equal(parsed.registeredPullControlHostRunbook?.targetGuidePath, "phase5-collector-guides/linux-shell-agent.md");
  assert.equal(parsed.registeredPullControlHostRunbook?.targetFragmentPath, "phase5-fragments/linux-shell-agent.json");
  assert.equal(parsed.registeredPullControlHostRunbook?.controlFragmentPath, "phase5-fragments/control-plane-host.json");
  assert.deepEqual(parsed.registeredPullControlHostRunbook?.stages?.map((stage) => stage.id), [
    "wait-for-registration",
    "pull-registered-agent",
    "wait-for-remote-acceptance",
    "send-routed-task",
    "check-delivery-status",
    "inspect-transcript-and-runner",
    "record-control-fragment",
  ]);
  assert.ok(parsed.registeredPullControlHostRunbook?.stages?.some((stage) => stage.commandName === "agent rooms pull-agent" && stage.evidenceFields?.includes("role") && stage.evidenceFields.includes("aliases")));
  assert.ok(parsed.registeredPullControlHostRunbook?.stages?.some((stage) => stage.commandName === "agent rooms say" && stage.evidenceFields?.includes("taskMessageId")));
  assert.ok(parsed.registeredPullControlHostRunbook?.stages?.some((stage) => stage.commandName === "control-plane delivery-status" && stage.evidenceFields?.includes("deliveryStatusPendingCount")));
  assert.ok(parsed.registeredPullControlHostRunbook?.stages?.every((stage) => typeof stage.commandHint === "string" && stage.commandHint.length > 0));
  assert.equal(parsed.registeredPullControlHostRunbook?.stages?.find((stage) => stage.id === "pull-registered-agent")?.commandHint, "agent rooms pull-agent <room-id> <registered-pull-agent-id> --alias registered-pull --role executor --local-agent --json > pull-agent.json");
  assert.match(parsed.registeredPullControlHostRunbook?.stages?.find((stage) => stage.id === "check-delivery-status")?.commandHint ?? "", /delivery-status\.json/);
  assert.match(parsed.registeredPullControlHostRunbook?.stages?.find((stage) => stage.id === "inspect-transcript-and-runner")?.commandHint ?? "", /room-show\.json/);
  assert.equal(parsed.registeredPullControlHostRunbook?.stages?.find((stage) => stage.id === "record-control-fragment")?.commandHint, "soloclaw phase5 registered-pull-evidence-patch --registered-pull-target linux-shell-agent --status-file .agent/tmp/phase5-registered-pull-status.json --pull-agent-file pull-agent.json --invitations-file invitations.json --accept-room-file accept-room.json --room-show-file room-show.json --delivery-status-file delivery-status.json --output phase5-registered-pull-evidence-patch.json --control-fragment-file phase5-fragments/control-plane-host.json --patched-control-fragment-output phase5-fragments/control-plane-host.json --force --json");
  assert.ok(parsed.registeredPullControlHostRunbook?.notes?.some((note) => note.includes("control-plane fragment") && note.includes("room.registeredAgentPull")));
  assert.ok(parsed.notes?.some((note) => note.includes("Registered-agent pull target is linux-shell-agent")));
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);

  const text = await run(process.execPath, [
    cli,
    "phase5",
    "collection-runbook",
    "--registered-pull-target",
    "linux-shell-agent",
  ], workspace);
  assert.equal(text.exitCode, 0, text.stderr);
  assert.match(text.stdout, /Operator next commands for linux-shell-agent:[\s\S]*agent remote run --control-url <control-url> --control-token \$AGENT_CONTROL_TOKEN/);
  assert.match(text.stdout, /Operator next commands for control-plane-host:[\s\S]*agent rooms pull-agent <room-id> <registered-pull-agent-id>/);
  assert.match(text.stdout, /Evidence file handoff:[\s\S]*Selected target produces:[\s\S]*invitations\.json -> invitations\.json/);
  assert.match(text.stdout, /Evidence file handoff:[\s\S]*Control host produces:[\s\S]*phase5-registered-pull-evidence-patch\.json -> control-plane-fragment-paste/);
  assert.doesNotMatch(text.stdout, /Operator next commands for windows-cmd-agent/);
  assert.doesNotMatch(text.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);
});

test("phase5 collection-runbook rejects control-plane as registered-agent pull target", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collection-runbook-bad-registered-pull-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "collection-runbook",
    "--registered-pull-target",
    "control-plane-host",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /registered-agent pull target.*remote-agent/i);
});

test("phase5 collection-runbook can write only the runbook markdown file", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collection-runbook-output-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const runbookPath = path.join(workspace, "phase5-collection-runbook.md");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "collection-runbook",
    "--registered-pull-target",
    "macos-shell-agent",
    "--output",
    "phase5-collection-runbook.md",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    action?: string;
    registeredPullTargetId?: string;
    outputFile?: { path?: string; overwritten?: boolean; bytes?: number };
    registeredPullEvidenceFileHandoff?: { patchOutputFile?: string; pastePath?: string };
  };
  assert.equal(parsed.action, "collection-runbook");
  assert.equal(parsed.registeredPullTargetId, "macos-shell-agent");
  assert.equal(path.basename(parsed.outputFile?.path ?? ""), "phase5-collection-runbook.md");
  assert.equal(parsed.outputFile?.overwritten, false);
  assert.equal(parsed.registeredPullEvidenceFileHandoff?.patchOutputFile, "phase5-registered-pull-evidence-patch.json");
  assert.equal(parsed.registeredPullEvidenceFileHandoff?.pastePath, "room.registeredAgentPull");

  const runbook = await fs.readFile(runbookPath, "utf8");
  assert.match(runbook, /# Phase 5 Collection Runbook/);
  assert.match(runbook, /Registered-agent pull target: macos-shell-agent/);
  assert.match(runbook, /## Evidence File Handoff[\s\S]*Selected target produces:[\s\S]*accept-room\.json -> accept-room\.json/);
  assert.match(runbook, /## Evidence File Handoff[\s\S]*Control host produces:[\s\S]*phase5-registered-pull-evidence-patch\.json -> control-plane-fragment-paste/);
  assert.match(runbook, /## Registered-Agent Pull Control-Host Runbook/);
  assert.doesNotMatch(`${result.stdout}\n${runbook}`, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);

  const refused = await run(process.execPath, [
    cli,
    "phase5",
    "collection-runbook",
    "--registered-pull-target",
    "macos-shell-agent",
    "--output",
    "phase5-collection-runbook.md",
    "--json",
  ], workspace);
  assert.equal(refused.exitCode, 1);
  assert.match(refused.stderr, /already exists/i);

  const forced = await run(process.execPath, [
    cli,
    "phase5",
    "collection-runbook",
    "--registered-pull-target",
    "macos-shell-agent",
    "--output",
    "phase5-collection-runbook.md",
    "--force",
    "--json",
  ], workspace);
  assert.equal(forced.exitCode, 0, forced.stderr);
  const forcedParsed = JSON.parse(forced.stdout) as { outputFile?: { overwritten?: boolean } };
  assert.equal(forcedParsed.outputFile?.overwritten, true);
});

test("phase5 collection-prepare CLI writes the token-safe control-host collection workspace", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collection-prepare-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "collection-prepare",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    phase?: string;
    action?: string;
    status?: string;
    force?: boolean;
    baseEvidenceFile?: { path?: string; overwritten?: boolean };
    fragmentsDir?: { path?: string };
    fragments?: Array<{ targetId?: string; path?: string; overwritten?: boolean }>;
    guidesDir?: { path?: string };
    guides?: Array<{
      targetId?: string;
      path?: string;
      overwritten?: boolean;
      fragmentPath?: string;
      preflightCommand?: string;
      statusCommand?: string;
      collectorGuideCommand?: string;
    }>;
    runbookFile?: { path?: string; overwritten?: boolean };
    nextCommands?: string[];
  };
  assert.equal(parsed.phase, "phase5");
  assert.equal(parsed.action, "collection-prepare");
  assert.equal(parsed.status, "pass");
  assert.equal(parsed.force, false);
  assert.equal(path.basename(parsed.baseEvidenceFile?.path ?? ""), "phase5-evidence.json");
  assert.equal(path.basename(parsed.fragmentsDir?.path ?? ""), "phase5-fragments");
  assert.equal(parsed.fragments?.length, 6);
  assert.equal(path.basename(parsed.guidesDir?.path ?? ""), "phase5-collector-guides");
  assert.equal(parsed.guides?.length, 6);
  assert.equal(path.basename(parsed.runbookFile?.path ?? ""), "phase5-collection-runbook.md");
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --json"));
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json"));
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-check --file phase5-evidence.merged.json --json"));

  const linuxFragment = parsed.fragments?.find((fragment) => fragment.targetId === "linux-shell-agent");
  const linuxGuide = parsed.guides?.find((guide) => guide.targetId === "linux-shell-agent");
  assert.ok(linuxFragment?.path);
  assert.ok(linuxGuide?.path);
  await fs.stat(parsed.baseEvidenceFile?.path ?? "");
  await fs.stat(linuxFragment.path);
  await fs.stat(linuxGuide.path);
  assert.ok(parsed.runbookFile?.path);
  const runbookText = await fs.readFile(parsed.runbookFile.path, "utf8");
  assert.match(runbookText, /Phase 5 Collection Runbook/);
  assert.match(runbookText, /final Phase 5 acceptance/);
  assert.doesNotMatch(result.stdout + runbookText, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);

  const second = await run(process.execPath, [
    cli,
    "phase5",
    "collection-prepare",
    "--json",
  ], workspace);
  assert.equal(second.exitCode, 1);
  assert.equal(second.stdout, "");
  assert.match(second.stderr, /already exists/);

  const forced = await run(process.execPath, [
    cli,
    "phase5",
    "collection-prepare",
    "--force",
    "--json",
  ], workspace);
  assert.equal(forced.exitCode, 0, forced.stderr);
  const forcedParsed = JSON.parse(forced.stdout) as typeof parsed;
  assert.equal(forcedParsed.force, true);
  assert.equal(forcedParsed.baseEvidenceFile?.overwritten, true);
  assert.equal(forcedParsed.runbookFile?.overwritten, true);
  assert.doesNotMatch(forced.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);
});

test("phase5 collection-prepare carries the registered-agent pull target into evidence templates", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collection-prepare-registered-pull-template-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-evidence.json");
  const controlFragmentPath = path.join(workspace, "phase5-fragments", "control-plane-host.json");
  const runbookPath = path.join(workspace, "phase5-collection-runbook.md");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "collection-prepare",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    registeredPullTargetId?: string;
    guides?: Array<{ targetId?: string; operatorNextCommands?: string[] }>;
    registeredPullOperatorNextFile?: { path?: string; overwritten?: boolean };
    registeredPullOperatorNext?: {
      kind?: string;
      status?: string;
      targetId?: string;
      selectedTarget?: { targetId?: string; operatorNextCommands?: string[] };
      controlHost?: { targetId?: string; operatorNextCommands?: string[] };
      evidenceFileHandoff?: {
        selectedTargetProduces?: Array<{ path?: string; controlHostCopyTo?: string; consumedBy?: string }>;
        controlHostProduces?: Array<{ path?: string; consumedBy?: string }>;
        patchInputs?: string[];
        patchOutputFile?: string;
        pastePath?: string;
      };
      evidenceFieldHints?: Array<{ field?: string; source?: string; evidencePath?: string }>;
      mergeCommand?: string;
      finalCheckCommand?: string;
    };
    nextCommands?: string[];
  };
  assert.equal(parsed.registeredPullTargetId, "linux-shell-agent");
  assert.equal(path.basename(parsed.registeredPullOperatorNextFile?.path ?? ""), "phase5-registered-pull-operator-next.json");
  assert.equal(parsed.registeredPullOperatorNextFile?.overwritten, false);
  assert.equal(parsed.registeredPullOperatorNext?.kind, "registered-agent-pull");
  assert.equal(parsed.registeredPullOperatorNext?.status, "incomplete");
  assert.equal(parsed.registeredPullOperatorNext?.targetId, "linux-shell-agent");
  assert.equal(parsed.registeredPullOperatorNext?.selectedTarget?.targetId, "linux-shell-agent");
  assert.ok(parsed.registeredPullOperatorNext?.selectedTarget?.operatorNextCommands?.some((command) => command.includes("agent remote run --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN")));
  assert.equal(parsed.registeredPullOperatorNext?.controlHost?.targetId, "control-plane-host");
  assert.ok(parsed.registeredPullOperatorNext?.controlHost?.operatorNextCommands?.some((command) => command.includes("agent rooms pull-agent <room-id> <registered-pull-agent-id>") && command.includes("> pull-agent.json")));
  assert.deepEqual(parsed.registeredPullOperatorNext?.evidenceFileHandoff?.selectedTargetProduces?.map((file) => file.path), [
    ".agent/tmp/phase5-registered-pull-status.json",
    "invitations.json",
    "accept-room.json",
  ]);
  assert.deepEqual(parsed.registeredPullOperatorNext?.evidenceFileHandoff?.selectedTargetProduces?.map((file) => file.controlHostCopyTo), [
    ".agent/tmp/phase5-registered-pull-status.json",
    "invitations.json",
    "accept-room.json",
  ]);
  assert.deepEqual(parsed.registeredPullOperatorNext?.evidenceFileHandoff?.controlHostProduces?.map((file) => file.path), [
    "pull-agent.json",
    "room-show.json",
    "delivery-status.json",
    "phase5-registered-pull-evidence-patch.json",
  ]);
  assert.deepEqual(parsed.registeredPullOperatorNext?.evidenceFileHandoff?.patchInputs, [
    ".agent/tmp/phase5-registered-pull-status.json",
    "pull-agent.json",
    "invitations.json",
    "accept-room.json",
    "room-show.json",
    "delivery-status.json",
  ]);
  assert.equal(parsed.registeredPullOperatorNext?.evidenceFileHandoff?.patchOutputFile, "phase5-registered-pull-evidence-patch.json");
  assert.equal(parsed.registeredPullOperatorNext?.evidenceFileHandoff?.pastePath, "room.registeredAgentPull");
  assert.ok(parsed.registeredPullOperatorNext?.evidenceFieldHints?.some((hint) =>
    hint.field === "accepted" &&
    hint.source === "selected-target" &&
    hint.evidencePath === "room.registeredAgentPull.accepted"
  ));
  assert.equal(parsed.registeredPullOperatorNext?.mergeCommand, "soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json");
  assert.equal(parsed.registeredPullOperatorNext?.finalCheckCommand, "soloclaw phase5 evidence-check --file phase5-evidence.merged.json --json");
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --registered-pull-target linux-shell-agent --json"));
  assert.equal(parsed.nextCommands?.includes("soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --json"), false);
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json"));
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-check --file phase5-evidence.merged.json --json"));
  const base = JSON.parse(await fs.readFile(basePath, "utf8")) as {
    room?: { registeredAgentPull?: { targetId?: string } };
  };
  const controlFragment = JSON.parse(await fs.readFile(controlFragmentPath, "utf8")) as {
    room?: { registeredAgentPull?: { targetId?: string } };
  };
  assert.equal(base.room?.registeredAgentPull?.targetId, "linux-shell-agent");
  assert.equal(controlFragment.room?.registeredAgentPull?.targetId, "linux-shell-agent");
  assert.ok(parsed.registeredPullOperatorNextFile?.path);
  const handoff = JSON.parse(await fs.readFile(parsed.registeredPullOperatorNextFile.path, "utf8")) as typeof parsed.registeredPullOperatorNext;
  assert.deepEqual(handoff, parsed.registeredPullOperatorNext);
  const linuxGuide = parsed.guides?.find((guide) => guide.targetId === "linux-shell-agent");
  const controlGuide = parsed.guides?.find((guide) => guide.targetId === "control-plane-host");
  const windowsGuide = parsed.guides?.find((guide) => guide.targetId === "windows-cmd-agent");
  assert.ok(linuxGuide?.operatorNextCommands?.some((command) => command.includes("agent remote run --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN")));
  assert.ok(controlGuide?.operatorNextCommands?.some((command) => command.includes("agent rooms pull-agent <room-id> <registered-pull-agent-id>") && command.includes("> pull-agent.json")));
  assert.ok(controlGuide?.operatorNextCommands?.some((command) => command.includes("soloclaw phase5 registered-pull-evidence-patch --registered-pull-target linux-shell-agent") && command.includes("--delivery-status-file delivery-status.json")));
  assert.equal(windowsGuide?.operatorNextCommands, undefined);
  const runbookText = await fs.readFile(runbookPath, "utf8");
  assert.match(runbookText, /## Target Operator Next Commands/);
  assert.match(runbookText, /### linux-shell-agent[\s\S]*agent remote run --control-url <control-url> --control-token \$AGENT_CONTROL_TOKEN/);
  assert.match(runbookText, /### control-plane-host[\s\S]*agent rooms pull-agent <room-id> <registered-pull-agent-id>[\s\S]*> pull-agent\.json/);
  assert.match(runbookText, /### control-plane-host[\s\S]*registered-pull-evidence-patch --registered-pull-target linux-shell-agent[\s\S]*--delivery-status-file delivery-status\.json/);
  assert.doesNotMatch(`${result.stdout}\n${JSON.stringify(base)}\n${JSON.stringify(controlFragment)}\n${JSON.stringify(handoff)}\n${runbookText}`, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);
});

test("phase5 collection-prepare text output includes per-fragment handoff commands", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collection-prepare-text-fragments-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "collection-prepare",
    "--registered-pull-target",
    "linux-shell-agent",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Fragments:/);
  assert.match(result.stdout, /linux-shell-agent \(remote-agent\).*phase5-fragments[\\/]linux-shell-agent\.json/);
  assert.match(result.stdout, /template=soloclaw phase5 evidence-template --target linux-shell-agent --registered-pull-target linux-shell-agent --json/);
  assert.match(result.stdout, /preflight=soloclaw phase5 evidence-check --file phase5-fragments\/linux-shell-agent\.json --target linux-shell-agent --json/);
  assert.match(result.stdout, /status=soloclaw phase5 evidence-status --file phase5-evidence\.json --target-dir phase5-fragments --target linux-shell-agent --registered-pull-target linux-shell-agent --json/);
  assert.match(result.stdout, /guide=soloclaw phase5 collector-guide --target windows-cmd-agent --registered-pull-target linux-shell-agent --json/);
  assert.match(result.stdout, /registeredPullOperatorNext=phase5-registered-pull-operator-next\.json/);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);
});

test("phase5 registered-pull-operator-next writes a standalone token-safe handoff", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-registered-pull-operator-next-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "registered-pull-operator-next",
    "--registered-pull-target",
    "macos-shell-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    action?: string;
    registeredPullTargetId?: string;
    outputFile?: { path?: string; overwritten?: boolean };
    registeredPullOperatorNext?: {
      kind?: string;
      targetId?: string;
      selectedTarget?: { targetId?: string; operatorNextCommands?: string[] };
      controlHost?: { targetId?: string; operatorNextCommands?: string[] };
      evidenceFileHandoff?: {
        selectedTargetProduces?: Array<{ path?: string; controlHostCopyTo?: string; consumedBy?: string }>;
        controlHostProduces?: Array<{ path?: string; consumedBy?: string }>;
        patchInputs?: string[];
        patchOutputFile?: string;
        pastePath?: string;
      };
      evidenceFieldHints?: Array<{ field?: string; evidencePath?: string; source?: string }>;
    };
  };
  assert.equal(parsed.action, "registered-pull-operator-next");
  assert.equal(parsed.registeredPullTargetId, "macos-shell-agent");
  assert.equal(path.basename(parsed.outputFile?.path ?? ""), "phase5-registered-pull-operator-next.json");
  assert.equal(parsed.outputFile?.overwritten, false);
  assert.equal(parsed.registeredPullOperatorNext?.kind, "registered-agent-pull");
  assert.equal(parsed.registeredPullOperatorNext?.targetId, "macos-shell-agent");
  assert.equal(parsed.registeredPullOperatorNext?.selectedTarget?.targetId, "macos-shell-agent");
  assert.ok(parsed.registeredPullOperatorNext?.selectedTarget?.operatorNextCommands?.some((command) => command.includes("agent remote run --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN")));
  assert.equal(parsed.registeredPullOperatorNext?.controlHost?.targetId, "control-plane-host");
  assert.ok(parsed.registeredPullOperatorNext?.controlHost?.operatorNextCommands?.some((command) => command.includes("agent rooms pull-agent <room-id> <registered-pull-agent-id>") && command.includes("> pull-agent.json")));
  assert.ok(parsed.registeredPullOperatorNext?.controlHost?.operatorNextCommands?.some((command) => command.includes("soloclaw phase5 registered-pull-evidence-patch --registered-pull-target macos-shell-agent") && command.includes("--room-show-file room-show.json")));
  assert.deepEqual(parsed.registeredPullOperatorNext?.evidenceFileHandoff?.selectedTargetProduces?.map((file) => `${file.path}->${file.controlHostCopyTo}`), [
    ".agent/tmp/phase5-registered-pull-status.json->.agent/tmp/phase5-registered-pull-status.json",
    "invitations.json->invitations.json",
    "accept-room.json->accept-room.json",
  ]);
  assert.deepEqual(parsed.registeredPullOperatorNext?.evidenceFileHandoff?.controlHostProduces?.map((file) => file.path), [
    "pull-agent.json",
    "room-show.json",
    "delivery-status.json",
    "phase5-registered-pull-evidence-patch.json",
  ]);
  assert.equal(parsed.registeredPullOperatorNext?.evidenceFileHandoff?.patchOutputFile, "phase5-registered-pull-evidence-patch.json");
  assert.equal(parsed.registeredPullOperatorNext?.evidenceFileHandoff?.pastePath, "room.registeredAgentPull");
  assert.ok(parsed.registeredPullOperatorNext?.evidenceFieldHints?.some((hint) =>
    hint.field === "accepted" &&
    hint.evidencePath === "room.registeredAgentPull.accepted" &&
    hint.source === "selected-target"
  ));
  assert.ok(parsed.outputFile?.path);
  const handoff = JSON.parse(await fs.readFile(parsed.outputFile.path, "utf8"));
  assert.deepEqual(handoff, parsed.registeredPullOperatorNext);
  assert.doesNotMatch(`${result.stdout}\n${JSON.stringify(handoff)}`, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);

  const text = await run(process.execPath, [
    cli,
    "phase5",
    "registered-pull-operator-next",
    "--registered-pull-target",
    "linux-shell-agent",
    "--output",
    "phase5-registered-pull-operator-next-linux.txt.json",
  ], workspace);
  assert.equal(text.exitCode, 0, text.stderr);
  assert.match(text.stdout, /Evidence file handoff:/);
  assert.match(text.stdout, /Selected target produces:[\s\S]*- \.agent\/tmp\/phase5-registered-pull-status\.json -> \.agent\/tmp\/phase5-registered-pull-status\.json/);
  assert.match(text.stdout, /Selected target produces:[\s\S]*- invitations\.json -> invitations\.json/);
  assert.match(text.stdout, /Selected target produces:[\s\S]*- accept-room\.json -> accept-room\.json/);
  assert.match(text.stdout, /Control host produces:[\s\S]*- pull-agent\.json -> registered-pull-evidence-patch/);
  assert.match(text.stdout, /Control host produces:[\s\S]*- phase5-registered-pull-evidence-patch\.json -> control-plane-fragment-paste/);
  assert.match(text.stdout, /Patch inputs:[\s\S]*\.agent\/tmp\/phase5-registered-pull-status\.json, pull-agent\.json, invitations\.json, accept-room\.json, room-show\.json, delivery-status\.json/);
  assert.match(text.stdout, /Patch output=phase5-registered-pull-evidence-patch\.json pastePath=room\.registeredAgentPull/);
  assert.doesNotMatch(text.stdout + text.stderr, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);

  const second = await run(process.execPath, [
    cli,
    "phase5",
    "registered-pull-operator-next",
    "--registered-pull-target",
    "macos-shell-agent",
    "--json",
  ], workspace);
  assert.equal(second.exitCode, 1);
  assert.match(second.stderr, /already exists/);

  const forced = await run(process.execPath, [
    cli,
    "phase5",
    "operator-next",
    "--registered-pull-target",
    "macos-shell-agent",
    "--force",
    "--json",
  ], workspace);
  assert.equal(forced.exitCode, 0, forced.stderr);
  const forcedParsed = JSON.parse(forced.stdout) as typeof parsed;
  assert.equal(forcedParsed.outputFile?.overwritten, true);
});

test("phase5 registered-pull-evidence-patch builds a token-safe control-plane room patch from runner status", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-registered-pull-evidence-patch-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const statusPath = path.join(workspace, ".agent", "tmp", "phase5-registered-pull-status.json");
  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.writeFile(statusPath, JSON.stringify({
    kind: "soloclaw.remote_room_runner_status",
    version: 1,
    updatedAt: "2026-06-24T00:00:00.000Z",
    roomId: "room_cross_machine",
    agentId: "agent_macos_shell_agent",
    machineId: "machine_macos_shell_agent",
    status: "stopped",
    stopReason: "idle",
    cycles: 2,
    idleCycles: 1,
    messagesProcessed: 1,
    lastPollStopReason: "idle",
    lastAckMessageId: "msg_registered_pull_task",
    lastAckSigned: true,
    lastHeartbeat: {
      agentId: "agent_macos_shell_agent",
      machineId: "machine_macos_shell_agent",
      status: "idle",
      lastHeartbeatAt: "2026-06-24T00:00:02.000Z",
      heartbeatExpiresAt: "2026-06-24T00:01:02.000Z",
      lastRoomId: "room_cross_machine",
    },
    errorCount: 0,
    controlToken: "phase5-control-token",
    inviteToken: "rinv_secret_invite_token",
    privateKeyPem: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
    rawSse: "event: room.message.sent\ndata: {\"controlToken\":\"phase5-control-token\"}",
  }, null, 2), "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "registered-pull-evidence-patch",
    "--registered-pull-target",
    "macos-shell-agent",
    "--status-file",
    path.join(".agent", "tmp", "phase5-registered-pull-status.json"),
    "--registered",
    "--invitation-listed",
    "--accepted",
    "--role",
    "executor",
    "--alias",
    "registered-pull",
    "--task-message-id",
    "msg_registered_pull_task",
    "--reply-message-id",
    "msg_registered_pull_reply",
    "--reply-signature-status",
    "valid",
    "--delivery-status-pending-count",
    "0",
    "--transcript-event-kind",
    "task",
    "--transcript-event-kind",
    "chat",
    "--output",
    "phase5-registered-pull-evidence-patch.json",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    action?: string;
    status?: string;
    registeredPullTargetId?: string;
    statusFile?: { path?: string; kind?: string };
    pastePath?: string;
    patch?: {
      room?: {
        registeredAgentPull?: Record<string, unknown>;
      };
    };
    missingFields?: string[];
    outputFile?: { path?: string; overwritten?: boolean };
    nextCommands?: string[];
  };
  assert.equal(parsed.action, "registered-pull-evidence-patch");
  assert.equal(parsed.status, "pass");
  assert.equal(parsed.registeredPullTargetId, "macos-shell-agent");
  assert.equal(parsed.statusFile?.path, statusPath);
  assert.equal(parsed.statusFile?.kind, "soloclaw.remote_room_runner_status");
  assert.equal(parsed.pastePath, "room.registeredAgentPull");
  assert.deepEqual(parsed.patch?.room?.registeredAgentPull, {
    targetId: "macos-shell-agent",
    agentId: "agent_macos_shell_agent",
    registered: true,
    invitationListed: true,
    accepted: true,
    role: "executor",
    aliases: ["registered-pull"],
    taskMessageId: "msg_registered_pull_task",
    replyMessageId: "msg_registered_pull_reply",
    handledMessages: ["msg_registered_pull_task"],
    messagesProcessed: 1,
    ackSigned: true,
    replySignatureStatus: "valid",
    heartbeatStatus: "idle",
    runStopReason: "idle",
    deliveryStatusPendingCount: 0,
    transcriptEventKinds: ["task", "chat"],
  });
  assert.deepEqual(parsed.missingFields, []);
  assert.equal(path.basename(parsed.outputFile?.path ?? ""), "phase5-registered-pull-evidence-patch.json");
  assert.equal(parsed.outputFile?.overwritten, false);
  assert.ok(parsed.outputFile?.path);
  const written = JSON.parse(await fs.readFile(parsed.outputFile.path, "utf8"));
  assert.deepEqual(written, parsed.patch);
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-check --file phase5-fragments/control-plane-host.json --target control-plane-host --json"));
  assert.doesNotMatch(result.stdout + JSON.stringify(written), /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY|rawSse|<control-token>|<invite-bundle-file>/);
});

test("phase5 registered-pull-evidence-patch can write a patched control-plane fragment copy", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-registered-pull-control-fragment-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const statusPath = path.join(workspace, ".agent", "tmp", "phase5-registered-pull-status.json");
  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.mkdir(path.join(workspace, "phase5-fragments"), { recursive: true });
  await fs.writeFile(statusPath, JSON.stringify({
    kind: "soloclaw.remote_room_runner_status",
    version: 1,
    updatedAt: "2026-06-24T00:00:00.000Z",
    roomId: "room_cross_machine",
    agentId: "agent_macos_shell_agent",
    status: "stopped",
    stopReason: "idle",
    messagesProcessed: 1,
    lastAckMessageId: "msg_registered_pull_task",
    lastAckSigned: true,
    lastHeartbeat: {
      status: "idle",
    },
  }, null, 2), "utf8");
  const controlFragmentPath = path.join(workspace, "phase5-fragments", "control-plane-host.json");
  await fs.writeFile(controlFragmentPath, JSON.stringify({
    phase: "phase5",
    targets: [
      {
        id: "control-plane-host",
        checks: {
          install: "pass",
        },
      },
    ],
    room: {
      registeredAgentPull: {
        targetId: "old-target",
      },
      noBroadcastFallback: {
        messageVisible: true,
      },
    },
  }, null, 2), "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "registered-pull-evidence-patch",
    "--registered-pull-target",
    "macos-shell-agent",
    "--status-file",
    path.join(".agent", "tmp", "phase5-registered-pull-status.json"),
    "--registered",
    "--invitation-listed",
    "--accepted",
    "--role",
    "executor",
    "--alias",
    "registered-pull",
    "--reply-message-id",
    "msg_registered_pull_reply",
    "--reply-signature-status",
    "valid",
    "--delivery-status-pending-count",
    "0",
    "--transcript-event-kind",
    "task",
    "--transcript-event-kind",
    "chat",
    "--control-fragment-file",
    path.join("phase5-fragments", "control-plane-host.json"),
    "--patched-control-fragment-output",
    path.join("phase5-fragments", "control-plane-host.patched.json"),
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    patchedControlFragmentFile?: {
      path?: string;
      sourcePath?: string;
      pastePath?: string;
      overwritten?: boolean;
    };
    nextCommands?: string[];
  };
  assert.equal(path.basename(parsed.patchedControlFragmentFile?.path ?? ""), "control-plane-host.patched.json");
  assert.equal(parsed.patchedControlFragmentFile?.sourcePath, controlFragmentPath);
  assert.equal(parsed.patchedControlFragmentFile?.pastePath, "room.registeredAgentPull");
  assert.equal(parsed.patchedControlFragmentFile?.overwritten, false);
  const original = JSON.parse(await fs.readFile(controlFragmentPath, "utf8")) as {
    room?: { registeredAgentPull?: { targetId?: string } };
  };
  const patched = JSON.parse(await fs.readFile(parsed.patchedControlFragmentFile?.path ?? "", "utf8")) as {
    room?: {
      registeredAgentPull?: Record<string, unknown>;
      noBroadcastFallback?: { messageVisible?: boolean };
    };
  };
  assert.equal(original.room?.registeredAgentPull?.targetId, "old-target");
  assert.deepEqual(patched.room?.registeredAgentPull, {
    targetId: "macos-shell-agent",
    agentId: "agent_macos_shell_agent",
    registered: true,
    invitationListed: true,
    accepted: true,
    role: "executor",
    aliases: ["registered-pull"],
    taskMessageId: "msg_registered_pull_task",
    replyMessageId: "msg_registered_pull_reply",
    handledMessages: ["msg_registered_pull_task"],
    messagesProcessed: 1,
    ackSigned: true,
    replySignatureStatus: "valid",
    heartbeatStatus: "idle",
    runStopReason: "idle",
    deliveryStatusPendingCount: 0,
    transcriptEventKinds: ["task", "chat"],
  });
  assert.equal(patched.room?.noBroadcastFallback?.messageVisible, true);
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-check --file phase5-fragments/control-plane-host.patched.json --target control-plane-host --json"));
  assert.doesNotMatch(result.stdout + JSON.stringify(patched), /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY|rawSse|<control-token>|<invite-bundle-file>/);
});

test("phase5 registered-pull-evidence-patch derives pull summary from command json files without leaking secrets", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-registered-pull-evidence-patch-files-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const statusPath = path.join(workspace, ".agent", "tmp", "phase5-registered-pull-status.json");
  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.writeFile(statusPath, JSON.stringify({
    kind: "soloclaw.remote_room_runner_status",
    version: 1,
    updatedAt: "2026-06-24T00:00:00.000Z",
    roomId: "room_cross_machine",
    agentId: "agent_macos_shell_agent",
    machineId: "machine_macos_shell_agent",
    status: "stopped",
    stopReason: "idle",
    cycles: 2,
    idleCycles: 1,
    messagesProcessed: 1,
    lastPollStopReason: "idle",
    lastAckMessageId: "msg_registered_pull_task",
    lastAckSigned: true,
    lastHeartbeat: {
      agentId: "agent_macos_shell_agent",
      machineId: "machine_macos_shell_agent",
      status: "idle",
      lastHeartbeatAt: "2026-06-24T00:00:02.000Z",
      heartbeatExpiresAt: "2026-06-24T00:01:02.000Z",
      lastRoomId: "room_cross_machine",
    },
  }, null, 2), "utf8");

  const pullAgentPath = path.join(workspace, "pull-agent.json");
  await fs.writeFile(pullAgentPath, JSON.stringify({
    member: {
      roomId: "room_cross_machine",
      actor: { type: "agent", id: "agent_macos_shell_agent" },
      role: "executor",
      status: "invited",
      aliases: ["registered-pull"],
    },
    controlToken: "phase5-control-token",
    inviteToken: "rinv_secret_invite_token",
    privateKeyPem: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
  }, null, 2), "utf8");

  const invitationsPath = path.join(workspace, "invitations.json");
  await fs.writeFile(invitationsPath, JSON.stringify({
    agent: { id: "agent_macos_shell_agent" },
    invitations: [
      {
        room: { id: "room_cross_machine", name: "cross-machine room" },
        member: { role: "executor", status: "invited", aliases: ["registered-pull"] },
      },
    ],
    rawSse: "event: room.member.invited\ndata: {\"controlToken\":\"phase5-control-token\"}",
  }, null, 2), "utf8");

  const acceptRoomPath = path.join(workspace, "accept-room.json");
  await fs.writeFile(acceptRoomPath, JSON.stringify({
    agent: { id: "agent_macos_shell_agent" },
    member: {
      actor: { type: "agent", id: "agent_macos_shell_agent" },
      role: "executor",
      status: "active",
      aliases: ["registered-pull"],
    },
    heartbeat: {
      agent: {
        id: "agent_macos_shell_agent",
        heartbeatStatus: "online",
      },
    },
    pullEvidence: {
      acceptedFromRoomInvitation: true,
      ranFromRoomInvitation: false,
    },
    controlToken: "phase5-control-token",
    rawSse: "event: room.member.accepted\ndata: {\"inviteToken\":\"rinv_secret_invite_token\"}",
  }, null, 2), "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "registered-pull-evidence-patch",
    "--registered-pull-target",
    "macos-shell-agent",
    "--status-file",
    path.join(".agent", "tmp", "phase5-registered-pull-status.json"),
    "--pull-agent-file",
    "pull-agent.json",
    "--invitations-file",
    "invitations.json",
    "--accept-room-file",
    "accept-room.json",
    "--reply-message-id",
    "msg_registered_pull_reply",
    "--reply-signature-status",
    "valid",
    "--delivery-status-pending-count",
    "0",
    "--transcript-event-kind",
    "task",
    "--transcript-event-kind",
    "chat",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    patch?: {
      room?: {
        registeredAgentPull?: Record<string, unknown>;
      };
    };
    missingFields?: string[];
  };
  assert.equal(parsed.status, "pass");
  assert.deepEqual(parsed.patch?.room?.registeredAgentPull, {
    targetId: "macos-shell-agent",
    agentId: "agent_macos_shell_agent",
    registered: true,
    invitationListed: true,
    accepted: true,
    role: "executor",
    aliases: ["registered-pull"],
    taskMessageId: "msg_registered_pull_task",
    replyMessageId: "msg_registered_pull_reply",
    handledMessages: ["msg_registered_pull_task"],
    messagesProcessed: 1,
    ackSigned: true,
    replySignatureStatus: "valid",
    heartbeatStatus: "idle",
    runStopReason: "idle",
    deliveryStatusPendingCount: 0,
    transcriptEventKinds: ["task", "chat"],
  });
  assert.deepEqual(parsed.missingFields, []);
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY|rawSse|controlToken|inviteToken|privateKeyPem/);
});

test("phase5 registered-pull-evidence-patch derives transcript and delivery summaries from control-host json files", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-registered-pull-evidence-patch-control-files-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const statusPath = path.join(workspace, ".agent", "tmp", "phase5-registered-pull-status.json");
  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.writeFile(statusPath, JSON.stringify({
    kind: "soloclaw.remote_room_runner_status",
    version: 1,
    updatedAt: "2026-06-24T00:00:00.000Z",
    roomId: "room_cross_machine",
    agentId: "agent_macos_shell_agent",
    machineId: "machine_macos_shell_agent",
    status: "stopped",
    stopReason: "idle",
    cycles: 2,
    idleCycles: 1,
    messagesProcessed: 1,
    lastPollStopReason: "idle",
    lastAckMessageId: "msg_registered_pull_task",
    lastAckSigned: true,
    lastHeartbeat: {
      agentId: "agent_macos_shell_agent",
      machineId: "machine_macos_shell_agent",
      status: "idle",
      lastHeartbeatAt: "2026-06-24T00:00:02.000Z",
      heartbeatExpiresAt: "2026-06-24T00:01:02.000Z",
      lastRoomId: "room_cross_machine",
    },
  }, null, 2), "utf8");

  await fs.writeFile(path.join(workspace, "pull-agent.json"), JSON.stringify({
    member: {
      roomId: "room_cross_machine",
      actor: { type: "agent", id: "agent_macos_shell_agent" },
      role: "executor",
      status: "invited",
      aliases: ["registered-pull"],
    },
  }, null, 2), "utf8");
  await fs.writeFile(path.join(workspace, "invitations.json"), JSON.stringify({
    agent: { id: "agent_macos_shell_agent" },
    invitations: [
      {
        room: { id: "room_cross_machine", name: "cross-machine room" },
        member: { role: "executor", status: "invited", aliases: ["registered-pull"] },
      },
    ],
  }, null, 2), "utf8");
  await fs.writeFile(path.join(workspace, "accept-room.json"), JSON.stringify({
    agent: { id: "agent_macos_shell_agent" },
    member: {
      actor: { type: "agent", id: "agent_macos_shell_agent" },
      role: "executor",
      status: "active",
      aliases: ["registered-pull"],
    },
    pullEvidence: {
      acceptedFromRoomInvitation: true,
    },
  }, null, 2), "utf8");

  await fs.writeFile(path.join(workspace, "room-show.json"), JSON.stringify({
    room: { id: "room_cross_machine", name: "cross-machine room" },
    messages: [
      {
        id: "msg_registered_pull_task",
        kind: "task",
        body: "@agent:agent_macos_shell_agent phase5 registered-agent pull smoke",
        signatureStatus: "unsigned",
      },
      {
        id: "msg_registered_pull_reply",
        kind: "chat",
        body: "@agent:owner registered-pull handled msg_registered_pull_task",
        metadata: {
          remoteIntentSignatureStatus: "valid",
          controlToken: "phase5-control-token",
        },
        signature: "signed-envelope-body-that-must-not-leak",
      },
    ],
    rawSse: "event: room.message.sent\ndata: {\"controlToken\":\"phase5-control-token\"}",
    privateKeyPem: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
  }, null, 2), "utf8");

  await fs.writeFile(path.join(workspace, "delivery-status.json"), JSON.stringify({
    agents: [
      {
        agentId: "agent_macos_shell_agent",
        pendingRoutedCount: 0,
        lastAckMessageId: "msg_registered_pull_task",
        signedAck: true,
      },
    ],
    controlToken: "phase5-control-token",
    inviteToken: "rinv_secret_invite_token",
  }, null, 2), "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "registered-pull-evidence-patch",
    "--registered-pull-target",
    "macos-shell-agent",
    "--status-file",
    path.join(".agent", "tmp", "phase5-registered-pull-status.json"),
    "--pull-agent-file",
    "pull-agent.json",
    "--invitations-file",
    "invitations.json",
    "--accept-room-file",
    "accept-room.json",
    "--room-show-file",
    "room-show.json",
    "--delivery-status-file",
    "delivery-status.json",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    patch?: {
      room?: {
        registeredAgentPull?: Record<string, unknown>;
      };
    };
    missingFields?: string[];
  };
  assert.equal(parsed.status, "pass");
  assert.deepEqual(parsed.patch?.room?.registeredAgentPull, {
    targetId: "macos-shell-agent",
    agentId: "agent_macos_shell_agent",
    registered: true,
    invitationListed: true,
    accepted: true,
    role: "executor",
    aliases: ["registered-pull"],
    taskMessageId: "msg_registered_pull_task",
    replyMessageId: "msg_registered_pull_reply",
    handledMessages: ["msg_registered_pull_task"],
    messagesProcessed: 1,
    ackSigned: true,
    replySignatureStatus: "valid",
    heartbeatStatus: "idle",
    runStopReason: "idle",
    deliveryStatusPendingCount: 0,
    transcriptEventKinds: ["task", "chat"],
  });
  assert.deepEqual(parsed.missingFields, []);
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY|rawSse|controlToken|inviteToken|privateKeyPem|signed-envelope-body-that-must-not-leak/);
});

test("phase5 collector-guide CLI prints one target collection guide", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collector-guide-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "linux-shell-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    phase?: string;
    action?: string;
    targetId?: string;
    label?: string;
    role?: string;
    fragmentPath?: string;
    matrixCommand?: string;
    templateCommand?: string;
    preflightCommand?: string;
    returnToControlHost?: {
      copyFragmentTo?: string;
      statusCommand?: string;
      mergeCommand?: string;
      finalCheckCommand?: string;
    };
    steps?: string[];
    notes?: string[];
  };
  assert.equal(parsed.phase, "phase5");
  assert.equal(parsed.action, "collector-guide");
  assert.equal(parsed.targetId, "linux-shell-agent");
  assert.equal(parsed.label, "Linux shell remote agent");
  assert.equal(parsed.role, "remote-agent");
  assert.equal(parsed.fragmentPath, "phase5-fragments/linux-shell-agent.json");
  assert.equal(parsed.matrixCommand, "soloclaw phase5 matrix-template --target linux-shell-agent --json");
  assert.equal(parsed.templateCommand, "soloclaw phase5 evidence-template --target linux-shell-agent --json");
  assert.equal(parsed.preflightCommand, "soloclaw phase5 evidence-check --file phase5-fragments/linux-shell-agent.json --target linux-shell-agent --json");
  assert.equal(parsed.returnToControlHost?.copyFragmentTo, "phase5-fragments/linux-shell-agent.json");
  assert.equal(parsed.returnToControlHost?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --json");
  assert.equal(parsed.returnToControlHost?.mergeCommand, "soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json");
  assert.equal(parsed.returnToControlHost?.finalCheckCommand, "soloclaw phase5 evidence-check --file phase5-evidence.merged.json --json");
  assert.ok(parsed.steps?.some((step) => step.includes("Fill phase5-fragments/linux-shell-agent.json")));
  assert.ok(parsed.notes?.some((note) => note.includes("Do not record control tokens")));
  assert.ok(parsed.notes?.some((note) =>
    note.includes("WSL") &&
    note.includes("Linux-native") &&
    note.includes("/mnt") &&
    note.includes("SQLite") &&
    note.includes("cwd/.agent")
  ));
  assert.ok(parsed.notes?.some((note) => note.includes("registered-agent pull") && note.includes("remote register") && note.includes("remote accept-room") && note.includes("remote run")));
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);
});

test("phase5 collector-guide marks the selected registered-agent pull target", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collector-guide-registered-pull-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const selected = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "linux-shell-agent",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);
  assert.equal(selected.exitCode, 0, selected.stderr);
  const selectedParsed = JSON.parse(selected.stdout) as {
    targetId?: string;
    registeredPullTargetId?: string;
    isRegisteredPullTarget?: boolean;
    templateCommand?: string;
    evidenceFileHandoff?: {
      selectedTargetProduces?: Array<{ path?: string; controlHostCopyTo?: string; consumedBy?: string }>;
      controlHostProduces?: Array<{ path?: string; consumedBy?: string }>;
      patchInputs?: string[];
      patchOutputFile?: string;
      pastePath?: string;
    };
    registeredPullRunbook?: {
      targetId?: string;
      statusFile?: string;
      stopFile?: string;
      stages?: Array<{ id?: string; commandName?: string; commandHint?: string; evidenceFields?: string[] }>;
    };
    returnToControlHost?: { statusCommand?: string };
    notes?: string[];
  };
  assert.equal(selectedParsed.targetId, "linux-shell-agent");
  assert.equal(selectedParsed.registeredPullTargetId, "linux-shell-agent");
  assert.equal(selectedParsed.isRegisteredPullTarget, true);
  assert.equal(selectedParsed.templateCommand, "soloclaw phase5 evidence-template --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(selectedParsed.registeredPullRunbook?.targetId, "linux-shell-agent");
  assert.equal(selectedParsed.registeredPullRunbook?.statusFile, ".agent/tmp/phase5-registered-pull-status.json");
  assert.equal(selectedParsed.registeredPullRunbook?.stopFile, ".agent/tmp/phase5-registered-pull.stop");
  assert.deepEqual(selectedParsed.registeredPullRunbook?.stages?.map((stage) => stage.id), [
    "register",
    "wait-for-control-host-pull",
    "list-invitations",
    "accept-room",
    "run-pulled-agent",
    "inspect-status-file",
  ]);
  assert.ok(selectedParsed.registeredPullRunbook?.stages?.some((stage) => stage.commandName === "agent remote run" && stage.evidenceFields?.includes("ackSigned") && stage.evidenceFields.includes("replyMessageId")));
  assert.ok(selectedParsed.registeredPullRunbook?.stages?.every((stage) => typeof stage.commandHint === "string" && stage.commandHint.length > 0));
  assert.equal(selectedParsed.registeredPullRunbook?.stages?.find((stage) => stage.id === "register")?.commandHint, "agent remote register --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN --display-name <registered-pull-label> --json");
  assert.match(selectedParsed.registeredPullRunbook?.stages?.find((stage) => stage.id === "run-pulled-agent")?.commandHint ?? "", /phase5-registered-pull-status\.json/);
  assert.match(selectedParsed.registeredPullRunbook?.stages?.find((stage) => stage.id === "run-pulled-agent")?.commandHint ?? "", /AGENT_CONTROL_TOKEN/);
  assert.deepEqual(selectedParsed.evidenceFileHandoff?.selectedTargetProduces?.map((file) => `${file.path}->${file.controlHostCopyTo}`), [
    ".agent/tmp/phase5-registered-pull-status.json->.agent/tmp/phase5-registered-pull-status.json",
    "invitations.json->invitations.json",
    "accept-room.json->accept-room.json",
  ]);
  assert.equal(selectedParsed.evidenceFileHandoff?.patchOutputFile, "phase5-registered-pull-evidence-patch.json");
  assert.equal(selectedParsed.evidenceFileHandoff?.pastePath, "room.registeredAgentPull");
  assert.equal(selectedParsed.returnToControlHost?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.ok(selectedParsed.notes?.some((note) => note.includes("This target is the registered-agent pull target")));

  const other = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "windows-cmd-agent",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);
  assert.equal(other.exitCode, 0, other.stderr);
  const otherParsed = JSON.parse(other.stdout) as {
    targetId?: string;
    registeredPullTargetId?: string;
    isRegisteredPullTarget?: boolean;
    templateCommand?: string;
    evidenceFileHandoff?: unknown;
    registeredPullRunbook?: unknown;
    returnToControlHost?: { statusCommand?: string };
    notes?: string[];
  };
  assert.equal(otherParsed.targetId, "windows-cmd-agent");
  assert.equal(otherParsed.registeredPullTargetId, "linux-shell-agent");
  assert.equal(otherParsed.isRegisteredPullTarget, false);
  assert.equal(otherParsed.registeredPullRunbook, undefined);
  assert.equal(otherParsed.evidenceFileHandoff, undefined);
  assert.equal(otherParsed.templateCommand, "soloclaw phase5 evidence-template --target windows-cmd-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(otherParsed.returnToControlHost?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target windows-cmd-agent --registered-pull-target linux-shell-agent --json");
  assert.ok(otherParsed.notes?.some((note) => note.includes("Do not run registered-agent pull-only commands on this target")));
  assert.doesNotMatch(selected.stdout + other.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);
});

test("phase5 collector-guide gives the control-plane host registered-agent pull controls", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collector-guide-control-registered-pull-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "control-plane-host",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    targetId?: string;
    registeredPullTargetId?: string;
    isRegisteredPullTarget?: boolean;
    evidenceFileHandoff?: {
      selectedTargetProduces?: Array<{ path?: string; controlHostCopyTo?: string; consumedBy?: string }>;
      controlHostProduces?: Array<{ path?: string; consumedBy?: string }>;
      patchInputs?: string[];
      patchOutputFile?: string;
      pastePath?: string;
    };
    registeredPullRunbook?: unknown;
    registeredPullControlHostRunbook?: {
      targetId?: string;
      targetGuidePath?: string;
      targetFragmentPath?: string;
      controlFragmentPath?: string;
      stages?: Array<{ id?: string; commandName?: string; commandHint?: string; evidenceFields?: string[] }>;
    };
    notes?: string[];
  };
  assert.equal(parsed.targetId, "control-plane-host");
  assert.equal(parsed.registeredPullTargetId, "linux-shell-agent");
  assert.equal(parsed.isRegisteredPullTarget, false);
  assert.equal(parsed.registeredPullRunbook, undefined);
  assert.deepEqual(parsed.evidenceFileHandoff?.controlHostProduces?.map((file) => `${file.path}->${file.consumedBy}`), [
    "pull-agent.json->registered-pull-evidence-patch",
    "room-show.json->registered-pull-evidence-patch",
    "delivery-status.json->registered-pull-evidence-patch",
    "phase5-registered-pull-evidence-patch.json->control-plane-fragment-paste",
  ]);
  assert.deepEqual(parsed.evidenceFileHandoff?.patchInputs, [
    ".agent/tmp/phase5-registered-pull-status.json",
    "pull-agent.json",
    "invitations.json",
    "accept-room.json",
    "room-show.json",
    "delivery-status.json",
  ]);
  assert.equal(parsed.evidenceFileHandoff?.pastePath, "room.registeredAgentPull");
  assert.equal(parsed.registeredPullControlHostRunbook?.targetId, "linux-shell-agent");
  assert.equal(parsed.registeredPullControlHostRunbook?.targetGuidePath, "phase5-collector-guides/linux-shell-agent.md");
  assert.equal(parsed.registeredPullControlHostRunbook?.targetFragmentPath, "phase5-fragments/linux-shell-agent.json");
  assert.equal(parsed.registeredPullControlHostRunbook?.controlFragmentPath, "phase5-fragments/control-plane-host.json");
  assert.deepEqual(parsed.registeredPullControlHostRunbook?.stages?.map((stage) => stage.id), [
    "wait-for-registration",
    "pull-registered-agent",
    "wait-for-remote-acceptance",
    "send-routed-task",
    "check-delivery-status",
    "inspect-transcript-and-runner",
    "record-control-fragment",
  ]);
  assert.ok(parsed.registeredPullControlHostRunbook?.stages?.some((stage) => stage.commandName === "agent rooms pull-agent" && stage.evidenceFields?.includes("aliases")));
  assert.ok(parsed.registeredPullControlHostRunbook?.stages?.some((stage) => stage.commandName === "agent rooms say" && stage.evidenceFields?.includes("taskMessageId")));
  assert.ok(parsed.registeredPullControlHostRunbook?.stages?.every((stage) => typeof stage.commandHint === "string" && stage.commandHint.length > 0));
  assert.equal(parsed.registeredPullControlHostRunbook?.stages?.find((stage) => stage.id === "send-routed-task")?.commandHint, "agent rooms say <room-id> \"@agent:<registered-pull-agent-id> phase5 registered-agent pull smoke: reply when accepted\" --local-agent --json");
  assert.match(parsed.registeredPullControlHostRunbook?.stages?.find((stage) => stage.id === "wait-for-remote-acceptance")?.commandHint ?? "", /agent remote accept-room/);
  assert.ok(parsed.notes?.some((note) => note.includes("Control-plane host") && note.includes("room pull-agent") && note.includes("room.registeredAgentPull")));
  assert.equal(parsed.notes?.some((note) => note.includes("Do not run registered-agent pull-only commands on this target")), false);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);
});

test("phase5 collector-guide uses target shell token syntax for registered-agent pull commands", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collector-guide-registered-pull-token-syntax-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const powershell = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "windows-powershell-agent",
    "--registered-pull-target",
    "windows-powershell-agent",
    "--json",
  ], workspace);
  assert.equal(powershell.exitCode, 0, powershell.stderr);

  const cmd = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "windows-cmd-agent",
    "--registered-pull-target",
    "windows-cmd-agent",
    "--json",
  ], workspace);
  assert.equal(cmd.exitCode, 0, cmd.stderr);

  const powershellParsed = JSON.parse(powershell.stdout) as {
    registeredPullRunbook?: { stages?: Array<{ id?: string; commandHint?: string }> };
  };
  const cmdParsed = JSON.parse(cmd.stdout) as {
    registeredPullRunbook?: { stages?: Array<{ id?: string; commandHint?: string }> };
  };
  const powershellHints = powershellParsed.registeredPullRunbook?.stages?.map((stage) => stage.commandHint ?? "") ?? [];
  const cmdHints = cmdParsed.registeredPullRunbook?.stages?.map((stage) => stage.commandHint ?? "") ?? [];

  assert.ok(powershellHints.some((hint) => hint.includes("--control-token $env:AGENT_CONTROL_TOKEN")));
  assert.equal(powershellHints.some((hint) => hint.includes("--control-token $AGENT_CONTROL_TOKEN")), false);
  assert.ok(cmdHints.some((hint) => hint.includes("--control-token %AGENT_CONTROL_TOKEN%")));
  assert.equal(cmdHints.some((hint) => hint.includes("--control-token $AGENT_CONTROL_TOKEN")), false);
  assert.doesNotMatch(powershell.stdout + cmd.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);
});

test("phase5 collector-guide exposes registered-agent pull operator next commands", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collector-guide-registered-pull-next-commands-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const remote = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "windows-cmd-agent",
    "--registered-pull-target",
    "windows-cmd-agent",
    "--json",
  ], workspace);
  assert.equal(remote.exitCode, 0, remote.stderr);

  const control = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "control-plane-host",
    "--registered-pull-target",
    "windows-cmd-agent",
    "--json",
  ], workspace);
  assert.equal(control.exitCode, 0, control.stderr);

  const remoteParsed = JSON.parse(remote.stdout) as {
    operatorNextCommands?: string[];
  };
  const controlParsed = JSON.parse(control.stdout) as {
    operatorNextCommands?: string[];
  };

  assert.deepEqual(remoteParsed.operatorNextCommands?.slice(0, 8), [
    "soloclaw phase5 evidence-template --target windows-cmd-agent --registered-pull-target windows-cmd-agent --json",
    "agent remote register --control-url <control-url> --control-token %AGENT_CONTROL_TOKEN% --display-name <registered-pull-label> --json",
    "control host captures pull-agent.json with agent rooms pull-agent <room-id> <registered-pull-agent-id> --alias registered-pull --role executor --local-agent --json > pull-agent.json",
    "agent remote invitations --control-url <control-url> --control-token %AGENT_CONTROL_TOKEN% --json > invitations.json",
    "agent remote accept-room --control-url <control-url> --control-token %AGENT_CONTROL_TOKEN% --room <room-id> --json > accept-room.json",
    "agent remote run --control-url <control-url> --control-token %AGENT_CONTROL_TOKEN% --room <room-id> --cycles 20 --limit 5 --idle-limit 1 --interval-ms 1000 --loop-interval-ms 1000 --stop-when-idle --idle-cycles 2 --heartbeat-ttl 60 --status-file .agent/tmp/phase5-registered-pull-status.json --stop-file .agent/tmp/phase5-registered-pull.stop --reply-template \"@agent:<owner-agent-id> registered-pull handled {messageId}\" --json",
    "inspect .agent/tmp/phase5-registered-pull-status.json and copy only token-safe summary fields",
    "soloclaw phase5 evidence-check --file phase5-fragments/windows-cmd-agent.json --target windows-cmd-agent --json",
  ]);
  assert.deepEqual(controlParsed.operatorNextCommands?.slice(0, 9), [
    "soloclaw phase5 evidence-template --target control-plane-host --registered-pull-target windows-cmd-agent --json",
    "agent remote register --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN --display-name <registered-pull-label> --json",
    "agent rooms pull-agent <room-id> <registered-pull-agent-id> --alias registered-pull --role executor --local-agent --json > pull-agent.json",
    "agent remote invitations --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN --json > invitations.json; agent remote accept-room --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN --room <room-id> --json > accept-room.json",
    "agent rooms say <room-id> \"@agent:<registered-pull-agent-id> phase5 registered-agent pull smoke: reply when accepted\" --local-agent --json",
    "curl -H \"x-agent-control-token: $AGENT_CONTROL_TOKEN\" \"<control-url>/api/rooms/<room-id>/delivery-status\" > delivery-status.json",
    "agent rooms show <room-id> --local-agent --json > room-show.json; inspect .agent/tmp/phase5-registered-pull-status.json from the selected target fragment",
    "soloclaw phase5 registered-pull-evidence-patch --registered-pull-target windows-cmd-agent --status-file .agent/tmp/phase5-registered-pull-status.json --pull-agent-file pull-agent.json --invitations-file invitations.json --accept-room-file accept-room.json --room-show-file room-show.json --delivery-status-file delivery-status.json --output phase5-registered-pull-evidence-patch.json --control-fragment-file phase5-fragments/control-plane-host.json --patched-control-fragment-output phase5-fragments/control-plane-host.json --force --json",
    "soloclaw phase5 evidence-check --file phase5-fragments/control-plane-host.json --target control-plane-host --json",
  ]);

  const text = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "windows-cmd-agent",
    "--registered-pull-target",
    "windows-cmd-agent",
  ], workspace);
  assert.equal(text.exitCode, 0, text.stderr);
  assert.match(text.stdout, /Operator next commands:[\s\S]*agent remote run --control-url <control-url> --control-token %AGENT_CONTROL_TOKEN%/);
  assert.doesNotMatch(remote.stdout + control.stdout + text.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);
});

test("phase5 collector-guide maps registered-agent pull evidence fields to collection sources", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collector-guide-registered-pull-field-hints-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const remote = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "linux-shell-agent",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);
  assert.equal(remote.exitCode, 0, remote.stderr);

  const control = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "control-plane-host",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);
  assert.equal(control.exitCode, 0, control.stderr);

  const remoteParsed = JSON.parse(remote.stdout) as {
    registeredPullRunbook?: {
      evidenceFieldHints?: Array<{
        field?: string;
        evidencePath?: string;
        source?: string;
        stageId?: string;
        commandName?: string;
      }>;
    };
  };
  const controlParsed = JSON.parse(control.stdout) as {
    registeredPullControlHostRunbook?: {
      evidenceFieldHints?: Array<{
        field?: string;
        evidencePath?: string;
        source?: string;
        stageId?: string;
        commandName?: string;
      }>;
    };
  };

  assert.deepEqual(remoteParsed.registeredPullRunbook?.evidenceFieldHints?.slice(0, 4), [
    {
      field: "registered",
      evidencePath: "room.registeredAgentPull.registered",
      source: "selected-target",
      stageId: "register",
      commandName: "agent remote register",
    },
    {
      field: "agentId",
      evidencePath: "room.registeredAgentPull.agentId",
      source: "selected-target",
      stageId: "register",
      commandName: "agent remote register",
    },
    {
      field: "targetId",
      evidencePath: "room.registeredAgentPull.targetId",
      source: "selected-target",
      stageId: "register",
      commandName: "agent remote register",
    },
    {
      field: "role",
      evidencePath: "room.registeredAgentPull.role",
      source: "control-plane-host",
      stageId: "wait-for-control-host-pull",
      commandName: "agent rooms pull-agent",
    },
  ]);
  assert.ok(remoteParsed.registeredPullRunbook?.evidenceFieldHints?.some((hint) =>
    hint.field === "messagesProcessed" &&
    hint.source === "selected-target" &&
    hint.stageId === "run-pulled-agent" &&
    hint.commandName === "agent remote run"
  ));
  assert.ok(remoteParsed.registeredPullRunbook?.evidenceFieldHints?.some((hint) =>
    hint.field === "transcriptEventKinds" &&
    hint.source === "selected-target-status-file" &&
    hint.stageId === "inspect-status-file"
  ));
  assert.ok(controlParsed.registeredPullControlHostRunbook?.evidenceFieldHints?.some((hint) =>
    hint.field === "deliveryStatusAckMessageIds" &&
    hint.source === "control-plane-host" &&
    hint.stageId === "check-delivery-status" &&
    hint.commandName === "control-plane delivery-status"
  ));
  assert.ok(controlParsed.registeredPullControlHostRunbook?.evidenceFieldHints?.some((hint) =>
    hint.field === "replySignatureStatus" &&
    hint.source === "selected-target-status-file" &&
    hint.stageId === "inspect-transcript-and-runner"
  ));

  const text = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "control-plane-host",
    "--registered-pull-target",
    "linux-shell-agent",
  ], workspace);
  assert.equal(text.exitCode, 0, text.stderr);
  assert.match(text.stdout, /Registered-agent pull evidence field hints:[\s\S]*field=deliveryStatusAckMessageIds path=room\.registeredAgentPull\.deliveryStatusAckMessageIds source=control-plane-host stage=check-delivery-status command=control-plane delivery-status/);
  assert.doesNotMatch(remote.stdout + control.stdout + text.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);
});

test("phase5 collector-guide can opt into target smoke commands for an execution handoff", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collector-guide-smoke-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "linux-shell-agent",
    "--include-smoke-commands",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    phase?: string;
    action?: string;
    targetId?: string;
    includeSmokeCommands?: boolean;
    smokeCommands?: string[];
  };
  assert.equal(parsed.phase, "phase5");
  assert.equal(parsed.action, "collector-guide");
  assert.equal(parsed.targetId, "linux-shell-agent");
  assert.equal(parsed.includeSmokeCommands, true);
  assert.ok(parsed.smokeCommands?.some((command) => command.includes("remote register") && command.includes("<registered-pull-agent-id>")));
  assert.ok(parsed.smokeCommands?.some((command) => command.includes("remote invitations")));
  assert.ok(parsed.smokeCommands?.some((command) => command.includes("remote accept-room")));
  assert.ok(parsed.smokeCommands?.some((command) => command.includes("remote run") && command.includes("phase5-registered-pull-status.json")));
  assert.ok(parsed.smokeCommands?.some((command) => command.includes("room join --invite-bundle")));
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 collector-guide filters registered-agent pull smoke commands from non-target execution handoffs", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collector-guide-filter-pull-smoke-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const selected = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "linux-shell-agent",
    "--registered-pull-target",
    "linux-shell-agent",
    "--include-smoke-commands",
    "--json",
  ], workspace);
  assert.equal(selected.exitCode, 0, selected.stderr);
  const selectedParsed = JSON.parse(selected.stdout) as {
    targetId?: string;
    isRegisteredPullTarget?: boolean;
    smokeCommands?: string[];
    smokeCommandOmissions?: Array<{ group?: string; targetId?: string; reason?: string }>;
  };
  assert.equal(selectedParsed.targetId, "linux-shell-agent");
  assert.equal(selectedParsed.isRegisteredPullTarget, true);
  assert.ok(selectedParsed.smokeCommands?.some((command) => command.includes("<registered-pull-agent-id>")));
  assert.ok(selectedParsed.smokeCommands?.some((command) => command.includes("phase5-registered-pull-status.json")));
  assert.equal(selectedParsed.smokeCommandOmissions?.length ?? 0, 0);

  const other = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "windows-cmd-agent",
    "--registered-pull-target",
    "linux-shell-agent",
    "--include-smoke-commands",
    "--json",
  ], workspace);
  assert.equal(other.exitCode, 0, other.stderr);
  const otherParsed = JSON.parse(other.stdout) as {
    targetId?: string;
    isRegisteredPullTarget?: boolean;
    smokeCommands?: string[];
    smokeCommandOmissions?: Array<{ group?: string; targetId?: string; reason?: string }>;
  };
  assert.equal(otherParsed.targetId, "windows-cmd-agent");
  assert.equal(otherParsed.isRegisteredPullTarget, false);
  assert.ok(otherParsed.smokeCommands?.some((command) => command.includes("room join --invite-bundle")));
  assert.equal(otherParsed.smokeCommands?.some((command) => command.includes("<registered-pull-agent-id>")), false);
  assert.equal(otherParsed.smokeCommands?.some((command) => command.includes("phase5-registered-pull-status.json")), false);
  assert.deepEqual(otherParsed.smokeCommandOmissions?.map((omission) => omission.group), ["registered-agent-pull"]);
  assert.equal(otherParsed.smokeCommandOmissions?.[0]?.targetId, "linux-shell-agent");
  assert.match(otherParsed.smokeCommandOmissions?.[0]?.reason ?? "", /not the registered-agent pull target/i);

  const control = await run(process.execPath, [
    cli,
    "phase5",
    "collector-guide",
    "--target",
    "control-plane-host",
    "--registered-pull-target",
    "linux-shell-agent",
    "--include-smoke-commands",
    "--json",
  ], workspace);
  assert.equal(control.exitCode, 0, control.stderr);
  const controlParsed = JSON.parse(control.stdout) as {
    targetId?: string;
    isRegisteredPullTarget?: boolean;
    smokeCommands?: string[];
    smokeCommandOmissions?: Array<{ group?: string }>;
  };
  assert.equal(controlParsed.targetId, "control-plane-host");
  assert.equal(controlParsed.isRegisteredPullTarget, false);
  assert.ok(controlParsed.smokeCommands?.some((command) => command.includes("room pull-agent") && command.includes("<registered-pull-agent-id>")));
  assert.ok(controlParsed.smokeCommands?.some((command) => command.includes("<registered-pull-message-id>")));
  assert.equal(controlParsed.smokeCommandOmissions?.length ?? 0, 0);
  assert.doesNotMatch(`${selected.stdout}\n${other.stdout}\n${control.stdout}`, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 collector-pack CLI writes token-safe per-target guide files", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collector-pack-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const guidesDir = path.join(workspace, "phase5-collector-guides");
  const linuxGuidePath = path.join(guidesDir, "linux-shell-agent.md");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "collector-pack",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    phase?: string;
    action?: string;
    status?: string;
    targetIds?: string[];
    guidesDir?: { path?: string };
    guides?: Array<{
      targetId?: string;
      path?: string;
      overwritten?: boolean;
      fragmentPath?: string;
      preflightCommand?: string;
      statusCommand?: string;
      collectorGuideCommand?: string;
    }>;
    nextCommands?: string[];
  };
  assert.equal(parsed.phase, "phase5");
  assert.equal(parsed.action, "collector-pack");
  assert.equal(parsed.status, "pass");
  assert.deepEqual(parsed.targetIds, [
    "control-plane-host",
    "windows-powershell-agent",
    "windows-cmd-agent",
    "linux-shell-agent",
    "macos-shell-agent",
    "android-termux-agent",
  ]);
  assert.equal(parsed.guidesDir?.path, guidesDir);
  assert.equal(parsed.guides?.length, 6);
  const linuxGuideResult = parsed.guides?.find((guide) => guide.targetId === "linux-shell-agent");
  assert.equal(linuxGuideResult?.path, linuxGuidePath);
  assert.equal(linuxGuideResult?.overwritten, false);
  assert.equal(linuxGuideResult?.fragmentPath, "phase5-fragments/linux-shell-agent.json");
  assert.equal(linuxGuideResult?.preflightCommand, "soloclaw phase5 evidence-check --file phase5-fragments/linux-shell-agent.json --target linux-shell-agent --json");
  assert.equal(linuxGuideResult?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --json");
  assert.equal(linuxGuideResult?.collectorGuideCommand, "soloclaw phase5 collector-guide --target linux-shell-agent --json");
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-init --json"));
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --json"));

  const linuxGuide = await fs.readFile(linuxGuidePath, "utf8");
  assert.match(linuxGuide, /# Phase 5 Collector Guide: linux-shell-agent/);
  assert.match(linuxGuide, /soloclaw phase5 matrix-template --target linux-shell-agent --json/);
  assert.match(linuxGuide, /soloclaw phase5 evidence-template --target linux-shell-agent --json/);
  assert.match(linuxGuide, /soloclaw phase5 evidence-check --file phase5-fragments\/linux-shell-agent\.json --target linux-shell-agent --json/);
  assert.match(linuxGuide, /soloclaw phase5 evidence-status --file phase5-evidence\.json --target-dir phase5-fragments --target linux-shell-agent --json/);
  assert.match(linuxGuide, /soloclaw phase5 evidence-merge --file phase5-evidence\.json --target-dir phase5-fragments --output phase5-evidence\.merged\.json --json/);
  assert.match(linuxGuide, /registered-agent pull.*remote register.*remote accept-room.*remote run/s);
  assert.doesNotMatch(`${result.stdout}\n${linuxGuide}`, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);
});

test("phase5 collector-pack can opt into target smoke commands in written guides", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collector-pack-smoke-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const guidesDir = path.join(workspace, "guides");
  const linuxGuidePath = path.join(guidesDir, "linux-shell-agent.md");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "collector-pack",
    "--target",
    "linux-shell-agent",
    "--output-dir",
    "guides",
    "--include-smoke-commands",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    phase?: string;
    action?: string;
    includeSmokeCommands?: boolean;
    targetIds?: string[];
  };
  assert.equal(parsed.phase, "phase5");
  assert.equal(parsed.action, "collector-pack");
  assert.equal(parsed.includeSmokeCommands, true);
  assert.deepEqual(parsed.targetIds, ["linux-shell-agent"]);

  const linuxGuide = await fs.readFile(linuxGuidePath, "utf8");
  assert.match(linuxGuide, /## Target Smoke Commands/);
  assert.match(linuxGuide, /<registered-pull-agent-id>.*remote register/s);
  assert.match(linuxGuide, /remote invitations/);
  assert.match(linuxGuide, /remote accept-room/);
  assert.match(linuxGuide, /remote run.*phase5-registered-pull-status\.json/s);
  assert.match(linuxGuide, /room join --invite-bundle <invite-bundle-file>/);
  assert.doesNotMatch(`${result.stdout}\n${linuxGuide}`, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 collector-pack writes registered-agent pull target guidance into guides", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collector-pack-registered-pull-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const guidesDir = path.join(workspace, "guides");
  const linuxGuidePath = path.join(guidesDir, "linux-shell-agent.md");
  const windowsGuidePath = path.join(guidesDir, "windows-cmd-agent.md");
  const controlGuidePath = path.join(guidesDir, "control-plane-host.md");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "collector-pack",
    "--output-dir",
    "guides",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    registeredPullTargetId?: string;
    guides?: Array<{
      targetId?: string;
      statusCommand?: string;
      collectorGuideCommand?: string;
      operatorNextCommands?: string[];
      evidenceFileHandoff?: {
        selectedTargetProduces?: Array<{ path?: string; controlHostCopyTo?: string; consumedBy?: string }>;
        controlHostProduces?: Array<{ path?: string; consumedBy?: string }>;
        patchInputs?: string[];
        patchOutputFile?: string;
        pastePath?: string;
      };
    }>;
    nextCommands?: string[];
  };
  assert.equal(parsed.registeredPullTargetId, "linux-shell-agent");
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-init --registered-pull-target linux-shell-agent --json"));
  assert.equal(parsed.nextCommands?.includes("soloclaw phase5 evidence-init --json"), false);
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --registered-pull-target linux-shell-agent --json"));
  assert.equal(parsed.nextCommands?.includes("soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --json"), false);
  assert.equal(parsed.guides?.find((guide) => guide.targetId === "linux-shell-agent")?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.guides?.find((guide) => guide.targetId === "linux-shell-agent")?.collectorGuideCommand, "soloclaw phase5 collector-guide --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.guides?.find((guide) => guide.targetId === "windows-cmd-agent")?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target windows-cmd-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.guides?.find((guide) => guide.targetId === "windows-cmd-agent")?.collectorGuideCommand, "soloclaw phase5 collector-guide --target windows-cmd-agent --registered-pull-target linux-shell-agent --json");
  assert.ok(parsed.guides?.find((guide) => guide.targetId === "linux-shell-agent")?.operatorNextCommands?.some((command) => command.includes("agent remote run --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN")));
  assert.ok(parsed.guides?.find((guide) => guide.targetId === "control-plane-host")?.operatorNextCommands?.some((command) => command.includes("agent rooms pull-agent <room-id> <registered-pull-agent-id>") && command.includes("> pull-agent.json")));
  assert.ok(parsed.guides?.find((guide) => guide.targetId === "control-plane-host")?.operatorNextCommands?.some((command) => command.includes("soloclaw phase5 registered-pull-evidence-patch --registered-pull-target linux-shell-agent") && command.includes("--delivery-status-file delivery-status.json")));
  assert.equal(parsed.guides?.find((guide) => guide.targetId === "linux-shell-agent")?.evidenceFileHandoff?.patchOutputFile, "phase5-registered-pull-evidence-patch.json");
  assert.deepEqual(parsed.guides?.find((guide) => guide.targetId === "control-plane-host")?.evidenceFileHandoff?.patchInputs, [
    ".agent/tmp/phase5-registered-pull-status.json",
    "pull-agent.json",
    "invitations.json",
    "accept-room.json",
    "room-show.json",
    "delivery-status.json",
  ]);
  assert.equal(parsed.guides?.find((guide) => guide.targetId === "control-plane-host")?.evidenceFileHandoff?.pastePath, "room.registeredAgentPull");
  assert.equal(parsed.guides?.find((guide) => guide.targetId === "windows-cmd-agent")?.operatorNextCommands, undefined);
  assert.equal(parsed.guides?.find((guide) => guide.targetId === "windows-cmd-agent")?.evidenceFileHandoff, undefined);

  const linuxGuide = await fs.readFile(linuxGuidePath, "utf8");
  const windowsGuide = await fs.readFile(windowsGuidePath, "utf8");
  const controlGuide = await fs.readFile(controlGuidePath, "utf8");
  assert.match(linuxGuide, /This target is the registered-agent pull target/);
  assert.match(linuxGuide, /register: agent remote register; .*commandHint=agent remote register --control-url <control-url> --control-token \$AGENT_CONTROL_TOKEN/s);
  assert.match(linuxGuide, /run-pulled-agent: agent remote run; .*commandHint=agent remote run --control-url <control-url> --control-token \$AGENT_CONTROL_TOKEN/s);
  assert.match(linuxGuide, /soloclaw phase5 evidence-status --file phase5-evidence\.json --target-dir phase5-fragments --target linux-shell-agent --registered-pull-target linux-shell-agent --json/);
  assert.match(windowsGuide, /Do not run registered-agent pull-only commands on this target/);
  assert.match(windowsGuide, /soloclaw phase5 evidence-status --file phase5-evidence\.json --target-dir phase5-fragments --target windows-cmd-agent --registered-pull-target linux-shell-agent --json/);
  assert.match(controlGuide, /Registered-Agent Pull Control-Host Runbook/);
  assert.match(controlGuide, /soloclaw phase5 evidence-status --file phase5-evidence\.json --target-dir phase5-fragments --target control-plane-host --registered-pull-target linux-shell-agent --json/);
  assert.match(controlGuide, /pull-registered-agent: agent rooms pull-agent/);
  assert.match(controlGuide, /record-control-fragment: fill room\.registeredAgentPull/);
  assert.match(linuxGuide, /## Operator Next Commands[\s\S]*agent remote run --control-url <control-url> --control-token \$AGENT_CONTROL_TOKEN/);
  assert.match(linuxGuide, /## Evidence File Handoff[\s\S]*Selected target produces:[\s\S]*\.agent\/tmp\/phase5-registered-pull-status\.json -> \.agent\/tmp\/phase5-registered-pull-status\.json/);
  assert.match(controlGuide, /## Operator Next Commands[\s\S]*agent rooms pull-agent <room-id> <registered-pull-agent-id>[\s\S]*> pull-agent\.json/);
  assert.match(controlGuide, /## Operator Next Commands[\s\S]*soloclaw phase5 registered-pull-evidence-patch --registered-pull-target linux-shell-agent[\s\S]*--delivery-status-file delivery-status\.json/);
  assert.match(controlGuide, /## Evidence File Handoff[\s\S]*Control host produces:[\s\S]*phase5-registered-pull-evidence-patch\.json -> control-plane-fragment-paste/);
  assert.doesNotMatch(controlGuide, /Do not run registered-agent pull-only commands on this target/);
  assert.doesNotMatch(`${result.stdout}\n${linuxGuide}\n${windowsGuide}\n${controlGuide}`, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 collector-pack records registered-agent pull smoke command omissions in non-target execution guides", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collector-pack-registered-pull-smoke-filter-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const guidesDir = path.join(workspace, "guides");
  const linuxGuidePath = path.join(guidesDir, "linux-shell-agent.md");
  const windowsGuidePath = path.join(guidesDir, "windows-cmd-agent.md");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "collector-pack",
    "--output-dir",
    "guides",
    "--registered-pull-target",
    "linux-shell-agent",
    "--include-smoke-commands",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const linuxGuide = await fs.readFile(linuxGuidePath, "utf8");
  const windowsGuide = await fs.readFile(windowsGuidePath, "utf8");
  assert.match(linuxGuide, /<registered-pull-agent-id>.*remote register/s);
  assert.doesNotMatch(linuxGuide, /## Omitted Smoke Commands/);
  assert.match(windowsGuide, /## Omitted Smoke Commands/);
  assert.match(windowsGuide, /registered-agent-pull.*linux-shell-agent.*not the registered-agent pull target/s);
  assert.doesNotMatch(windowsGuide, /<registered-pull-agent-id>|phase5-registered-pull-status\.json/);
  assert.doesNotMatch(`${result.stdout}\n${linuxGuide}\n${windowsGuide}`, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 collector-pack CLI can write one target guide and only force overwrites it", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-collector-pack-target-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const guidesDir = path.join(workspace, "guides");
  const linuxGuidePath = path.join(guidesDir, "linux-shell-agent.md");
  const windowsGuidePath = path.join(guidesDir, "windows-powershell-agent.md");

  const first = await run(process.execPath, [
    cli,
    "phase5",
    "collector-pack",
    "--target",
    "linux-shell-agent",
    "--output-dir",
    "guides",
    "--json",
  ], workspace);

  assert.equal(first.exitCode, 0, first.stderr);
  const parsedFirst = JSON.parse(first.stdout) as {
    phase?: string;
    action?: string;
    status?: string;
    force?: boolean;
    targetIds?: string[];
    guidesDir?: { path?: string };
    guides?: Array<{ targetId?: string; path?: string; overwritten?: boolean }>;
  };
  assert.equal(parsedFirst.phase, "phase5");
  assert.equal(parsedFirst.action, "collector-pack");
  assert.equal(parsedFirst.status, "pass");
  assert.equal(parsedFirst.force, false);
  assert.deepEqual(parsedFirst.targetIds, ["linux-shell-agent"]);
  assert.equal(parsedFirst.guidesDir?.path, guidesDir);
  assert.deepEqual(parsedFirst.guides?.map((guide) => guide.targetId), ["linux-shell-agent"]);
  assert.equal(parsedFirst.guides?.[0]?.path, linuxGuidePath);
  assert.equal(parsedFirst.guides?.[0]?.overwritten, false);
  await fs.stat(linuxGuidePath);
  await assert.rejects(fs.stat(windowsGuidePath), /ENOENT|no such file/i);

  const blocked = await run(process.execPath, [
    cli,
    "phase5",
    "collector-pack",
    "--target",
    "linux-shell-agent",
    "--output-dir",
    "guides",
    "--json",
  ], workspace);

  assert.equal(blocked.exitCode, 1);
  assert.match(blocked.stderr, /already exists/);
  assert.match(blocked.stderr, /Use --force to overwrite/);
  assert.doesNotMatch(blocked.stderr, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);

  await fs.writeFile(linuxGuidePath, "sentinel guide content\n", "utf8");
  const forced = await run(process.execPath, [
    cli,
    "phase5",
    "collector-pack",
    "--target",
    "linux-shell-agent",
    "--output-dir",
    "guides",
    "--force",
    "--json",
  ], workspace);

  assert.equal(forced.exitCode, 0, forced.stderr);
  const parsedForced = JSON.parse(forced.stdout) as {
    force?: boolean;
    targetIds?: string[];
    guides?: Array<{ targetId?: string; overwritten?: boolean }>;
  };
  assert.equal(parsedForced.force, true);
  assert.deepEqual(parsedForced.targetIds, ["linux-shell-agent"]);
  assert.deepEqual(parsedForced.guides?.map((guide) => guide.targetId), ["linux-shell-agent"]);
  assert.equal(parsedForced.guides?.[0]?.overwritten, true);
  const linuxGuide = await fs.readFile(linuxGuidePath, "utf8");
  assert.match(linuxGuide, /# Phase 5 Collector Guide: linux-shell-agent/);
  assert.doesNotMatch(linuxGuide, /sentinel guide content/);
  assert.doesNotMatch(`${first.stdout}\n${forced.stdout}\n${linuxGuide}`, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY|<control-token>|<invite-bundle-file>/);
});

test("phase5 evidence-init CLI writes base and per-target fragment templates", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-init-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-evidence.json");
  const fragmentsDir = path.join(workspace, "phase5-fragments");
  const linuxPath = path.join(fragmentsDir, "linux-shell-agent.json");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-init",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    phase?: string;
    action?: string;
    status?: string;
    baseEvidenceFile?: { path?: string; overwritten?: boolean };
    fragmentsDir?: { path?: string };
    fragments?: Array<{
      targetId?: string;
      path?: string;
      overwritten?: boolean;
      templateCommand?: string;
      preflightCommand?: string;
      statusCommand?: string;
      collectorGuideCommand?: string;
    }>;
    nextCommands?: string[];
  };
  assert.equal(parsed.phase, "phase5");
  assert.equal(parsed.action, "evidence-init");
  assert.equal(parsed.status, "pass");
  assert.equal(parsed.baseEvidenceFile?.path, basePath);
  assert.equal(parsed.baseEvidenceFile?.overwritten, false);
  assert.equal(parsed.fragmentsDir?.path, fragmentsDir);
  assert.equal(parsed.fragments?.length, 6);
  assert.equal(parsed.fragments?.some((fragment) => fragment.targetId === "linux-shell-agent" && fragment.path === linuxPath && fragment.overwritten === false), true);
  const linuxFragment = parsed.fragments?.find((fragment) => fragment.targetId === "linux-shell-agent");
  assert.equal(linuxFragment?.templateCommand, "soloclaw phase5 evidence-template --target linux-shell-agent --json");
  assert.equal(linuxFragment?.preflightCommand, "soloclaw phase5 evidence-check --file phase5-fragments/linux-shell-agent.json --target linux-shell-agent --json");
  assert.equal(linuxFragment?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --json");
  assert.equal(linuxFragment?.collectorGuideCommand, "soloclaw phase5 collector-guide --target linux-shell-agent --json");
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --json"));
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json"));

  const base = JSON.parse(await fs.readFile(basePath, "utf8")) as { phase?: string; targets?: Array<{ id?: string }> };
  assert.equal(base.phase, "phase5");
  assert.equal(base.targets?.length, 6);
  const linux = JSON.parse(await fs.readFile(linuxPath, "utf8")) as { source?: string; targets?: Array<{ id?: string }> };
  assert.equal(linux.source, "soloclaw phase5 evidence-template --target linux-shell-agent");
  assert.deepEqual(linux.targets?.map((target) => target.id), ["linux-shell-agent"]);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-init carries the registered-agent pull target into suggested scaffold commands", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-init-registered-pull-next-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-init",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    registeredPullTargetId?: string;
    fragments?: Array<{
      targetId?: string;
      templateCommand?: string;
      statusCommand?: string;
      collectorGuideCommand?: string;
    }>;
    nextCommands?: string[];
  };
  assert.equal(parsed.registeredPullTargetId, "linux-shell-agent");
  assert.equal(parsed.fragments?.find((fragment) => fragment.targetId === "linux-shell-agent")?.templateCommand, "soloclaw phase5 evidence-template --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.fragments?.find((fragment) => fragment.targetId === "windows-cmd-agent")?.collectorGuideCommand, "soloclaw phase5 collector-guide --target windows-cmd-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.fragments?.find((fragment) => fragment.targetId === "windows-cmd-agent")?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target windows-cmd-agent --registered-pull-target linux-shell-agent --json");
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --registered-pull-target linux-shell-agent --json"));
  assert.equal(parsed.nextCommands?.includes("soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --json"), false);
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json"));
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-check --file phase5-evidence.merged.json --json"));
  assert.equal(parsed.nextCommands?.includes("soloclaw phase5 collector-pack --json"), false);
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 collector-pack --registered-pull-target linux-shell-agent --json"));
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-init CLI refuses to overwrite existing evidence without force", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-init-no-overwrite-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  await fs.writeFile(path.join(workspace, "phase5-evidence.json"), "{\"existing\":true}\n", "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-init",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /already exists/);
  assert.match(result.stderr, /--force/);
  assert.equal(await fs.readFile(path.join(workspace, "phase5-evidence.json"), "utf8"), "{\"existing\":true}\n");
  assert.doesNotMatch(result.stderr, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-status CLI summarizes collected fragments without writing a merged file", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-status-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-evidence.json");
  const fragmentsDir = path.join(workspace, "phase5-fragments");
  const linuxPath = path.join(fragmentsDir, "linux-shell-agent.json");
  const mergedPath = path.join(workspace, "phase5-evidence.merged.json");
  await fs.mkdir(fragmentsDir, { recursive: true });

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  await fs.writeFile(basePath, baseResult.stdout, "utf8");

  const targetResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--target",
    "linux-shell-agent",
    "--json",
  ], workspace);
  assert.equal(targetResult.exitCode, 0, targetResult.stderr);
  const targetFragment = JSON.parse(targetResult.stdout) as {
    targets?: Array<{ id?: string; status?: string; agentId?: string }>;
  };
  assert.ok(targetFragment.targets?.[0]);
  targetFragment.targets[0].status = "pass";
  targetFragment.targets[0].agentId = "agent_linux_actual";
  await fs.writeFile(linuxPath, JSON.stringify(targetFragment, null, 2), "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-status",
    "--file",
    basePath,
    "--target-dir",
    fragmentsDir,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  await assert.rejects(fs.stat(mergedPath), /ENOENT|no such file/i);
  const parsed = JSON.parse(result.stdout) as {
    action?: string;
    status?: string;
    targetFilePaths?: string[];
    mergedTargetIds?: string[];
    remainingTargetIds?: string[];
    collectionStatus?: {
      complete?: boolean;
      mergedCount?: number;
      remainingCount?: number;
      passedCount?: number;
      pendingCount?: number;
      targets?: Array<{
        id?: string;
        evidenceStatus?: string;
        mergedThisRun?: boolean;
        sourceFilePath?: string;
      }>;
    };
    roomStatus?: { needsControlPlaneFragment?: boolean };
    finalEvidenceCheck?: {
      gate?: string;
      status?: string;
      missingEvidenceCount?: number;
      missingEvidenceByScope?: {
        matrix?: number;
        target?: number;
        room?: number;
        controlPlane?: number;
      };
    };
    nextEvidenceScopes?: Array<{
      scope?: string;
      missingEvidenceCount?: number;
      guidance?: string;
      targetIds?: string[];
      checkIds?: string[];
    }>;
    nextTargetEvidence?: Array<{
      targetId?: string;
      role?: string;
      evidenceStatus?: string;
      mergedThisRun?: boolean;
      fragmentPath?: string;
      sourceFilePath?: string;
      missingEvidenceCount?: number;
      checkIds?: string[];
      missingFields?: string[];
      templateCommand?: string;
      statusCommand?: string;
      preflightCommand?: string;
      returnToControlHost?: {
        copyFragmentTo?: string;
        statusCommand?: string;
        mergeCommand?: string;
        finalCheckCommand?: string;
      };
    }>;
    missingEvidence?: Array<{
      scope?: string;
      targetId?: string;
      checkId?: string;
      missing?: string[];
    }>;
    nextCommands?: string[];
  };
  assert.equal(parsed.action, "evidence-status");
  assert.equal(parsed.status, "incomplete");
  assert.deepEqual(parsed.mergedTargetIds, ["linux-shell-agent"]);
  assert.equal(parsed.targetFilePaths?.length, 1);
  assert.equal(parsed.remainingTargetIds?.includes("linux-shell-agent"), false);
  assert.equal(parsed.remainingTargetIds?.includes("android-termux-agent"), true);
  assert.equal(parsed.collectionStatus?.complete, false);
  assert.equal(parsed.collectionStatus?.mergedCount, 1);
  assert.equal(parsed.collectionStatus?.remainingCount, 5);
  assert.equal(parsed.collectionStatus?.passedCount, 1);
  assert.equal(parsed.collectionStatus?.pendingCount, 5);
  const linux = parsed.collectionStatus?.targets?.find((target) => target.id === "linux-shell-agent");
  const android = parsed.collectionStatus?.targets?.find((target) => target.id === "android-termux-agent");
  assert.equal(linux?.evidenceStatus, "pass");
  assert.equal(linux?.mergedThisRun, true);
  assert.equal(linux?.sourceFilePath, linuxPath);
  assert.equal(android?.evidenceStatus, "pending");
  assert.equal(android?.mergedThisRun, false);
  assert.equal(parsed.roomStatus?.needsControlPlaneFragment, true);
  assert.equal(parsed.finalEvidenceCheck?.gate, "matrix-evidence");
  assert.equal(parsed.finalEvidenceCheck?.status, "fail");
  assert.equal(parsed.finalEvidenceCheck?.missingEvidenceCount, 42);
  assert.equal(parsed.finalEvidenceCheck?.missingEvidenceByScope?.matrix, 0);
  assert.equal(parsed.finalEvidenceCheck?.missingEvidenceByScope?.target, 36);
  assert.equal(parsed.finalEvidenceCheck?.missingEvidenceByScope?.room, 4);
  assert.equal(parsed.finalEvidenceCheck?.missingEvidenceByScope?.controlPlane, 2);
  assert.deepEqual(parsed.nextEvidenceScopes?.map((scope) => scope.scope), ["target", "room", "control-plane"]);
  const targetScope = parsed.nextEvidenceScopes?.find((scope) => scope.scope === "target");
  assert.equal(targetScope?.missingEvidenceCount, 36);
  assert.ok(targetScope?.targetIds?.includes("linux-shell-agent"));
  assert.ok(targetScope?.targetIds?.includes("android-termux-agent"));
  assert.ok(targetScope?.checkIds?.includes("one-file-room-bootstrap-evidence"));
  assert.match(targetScope?.guidance ?? "", /Collect and preflight/);
  const roomScope = parsed.nextEvidenceScopes?.find((scope) => scope.scope === "room");
  assert.equal(roomScope?.missingEvidenceCount, 4);
  assert.ok(roomScope?.checkIds?.includes("no-broadcast-fallback-execution-evidence"));
  assert.match(roomScope?.guidance ?? "", /shared room evidence/);
  const controlPlaneScope = parsed.nextEvidenceScopes?.find((scope) => scope.scope === "control-plane");
  assert.equal(controlPlaneScope?.missingEvidenceCount, 2);
  assert.ok(controlPlaneScope?.checkIds?.includes("control-plane-event-stream"));
  assert.match(controlPlaneScope?.guidance ?? "", /control-plane-host fragment/);
  const nextLinuxTarget = parsed.nextTargetEvidence?.find((target) => target.targetId === "linux-shell-agent");
  const nextAndroidTarget = parsed.nextTargetEvidence?.find((target) => target.targetId === "android-termux-agent");
  assert.equal(nextLinuxTarget?.role, "remote-agent");
  assert.equal(nextLinuxTarget?.evidenceStatus, "pass");
  assert.equal(nextLinuxTarget?.mergedThisRun, true);
  assert.equal(nextLinuxTarget?.fragmentPath, "phase5-fragments/linux-shell-agent.json");
  assert.equal(nextLinuxTarget?.sourceFilePath, linuxPath);
  assert.equal(nextLinuxTarget?.templateCommand, "soloclaw phase5 evidence-template --target linux-shell-agent --registered-pull-target macos-shell-agent --json");
  assert.equal(nextLinuxTarget?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --registered-pull-target macos-shell-agent --json");
  assert.equal(nextLinuxTarget?.preflightCommand, "soloclaw phase5 evidence-check --file phase5-fragments/linux-shell-agent.json --target linux-shell-agent --json");
  assert.deepEqual(nextLinuxTarget?.returnToControlHost, {
    copyFragmentTo: "phase5-fragments/linux-shell-agent.json",
    statusCommand: "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --registered-pull-target macos-shell-agent --json",
    mergeCommand: "soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json",
    finalCheckCommand: "soloclaw phase5 evidence-check --file phase5-evidence.merged.json --json",
  });
  assert.ok(nextLinuxTarget?.checkIds?.includes("one-file-room-bootstrap-evidence"));
  assert.ok(nextLinuxTarget?.checkIds?.includes("runner-status-file-evidence"));
  assert.ok(nextLinuxTarget?.missingFields?.includes("bootstrap"));
  assert.ok(nextLinuxTarget?.missingFields?.includes("runnerStatus"));
  assert.equal(nextAndroidTarget?.evidenceStatus, "pending");
  assert.equal(nextAndroidTarget?.mergedThisRun, false);
  assert.equal(nextAndroidTarget?.fragmentPath, "phase5-fragments/android-termux-agent.json");
  assert.equal(nextAndroidTarget?.templateCommand, "soloclaw phase5 evidence-template --target android-termux-agent --registered-pull-target macos-shell-agent --json");
  assert.equal(nextAndroidTarget?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target android-termux-agent --registered-pull-target macos-shell-agent --json");
  assert.equal(nextAndroidTarget?.preflightCommand, "soloclaw phase5 evidence-check --file phase5-fragments/android-termux-agent.json --target android-termux-agent --json");
  assert.deepEqual(nextAndroidTarget?.returnToControlHost, {
    copyFragmentTo: "phase5-fragments/android-termux-agent.json",
    statusCommand: "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target android-termux-agent --registered-pull-target macos-shell-agent --json",
    mergeCommand: "soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json",
    finalCheckCommand: "soloclaw phase5 evidence-check --file phase5-evidence.merged.json --json",
  });
  assert.ok((nextAndroidTarget?.missingEvidenceCount ?? 0) > 0);
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-check --file phase5-fragments/android-termux-agent.json --target android-termux-agent --json"));
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json"));
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-check --file phase5-evidence.merged.json --json"));
  assert.equal(parsed.missingEvidence, undefined);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);

  const detailedResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-status",
    "--file",
    basePath,
    "--target-dir",
    fragmentsDir,
    "--include-missing-evidence",
    "--json",
  ], workspace);

  assert.equal(detailedResult.exitCode, 0, detailedResult.stderr);
  await assert.rejects(fs.stat(mergedPath), /ENOENT|no such file/i);
  const detailedParsed = JSON.parse(detailedResult.stdout) as {
    finalEvidenceCheck?: { missingEvidenceCount?: number };
    missingEvidence?: Array<{
      scope?: string;
      targetId?: string;
      checkId?: string;
      missing?: string[];
    }>;
  };
  assert.equal(detailedParsed.missingEvidence?.length, detailedParsed.finalEvidenceCheck?.missingEvidenceCount);
  assert.ok(detailedParsed.missingEvidence?.some((item) =>
    item.scope === "target" &&
    item.targetId === "android-termux-agent" &&
    item.checkId === "one-file-room-bootstrap-evidence" &&
    item.missing?.includes("bootstrap"),
  ));
  assert.ok(detailedParsed.missingEvidence?.some((item) =>
    item.scope === "control-plane" &&
    item.checkId === "control-plane-event-stream" &&
    item.missing?.includes("eventStreamConnected"),
  ));
  assert.doesNotMatch(detailedResult.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);

  const targetStatusResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-status",
    "--file",
    basePath,
    "--target-dir",
    fragmentsDir,
    "--target",
    "android-termux-agent",
    "--include-missing-evidence",
    "--json",
  ], workspace);

  assert.equal(targetStatusResult.exitCode, 0, targetStatusResult.stderr);
  await assert.rejects(fs.stat(mergedPath), /ENOENT|no such file/i);
  const targetParsed = JSON.parse(targetStatusResult.stdout) as {
    targetFilterId?: string;
    finalEvidenceCheck?: { missingEvidenceCount?: number };
    nextEvidenceScopes?: Array<{ scope?: string; missingEvidenceCount?: number; targetIds?: string[] }>;
    nextTargetEvidence?: Array<{
      targetId?: string;
      evidenceStatus?: string;
      missingEvidenceCount?: number;
      fragmentPath?: string;
      templateCommand?: string;
      statusCommand?: string;
      preflightCommand?: string;
      collectorGuideCommand?: string;
      returnToControlHost?: {
        copyFragmentTo?: string;
        statusCommand?: string;
        mergeCommand?: string;
        finalCheckCommand?: string;
      };
    }>;
    missingEvidence?: Array<{ scope?: string; targetId?: string; checkId?: string }>;
    nextCommands?: string[];
  };
  assert.equal(targetParsed.targetFilterId, "android-termux-agent");
  assert.equal(targetParsed.finalEvidenceCheck?.missingEvidenceCount, 42);
  assert.deepEqual(targetParsed.nextTargetEvidence?.map((target) => target.targetId), ["android-termux-agent"]);
  assert.equal(targetParsed.nextTargetEvidence?.[0]?.evidenceStatus, "pending");
  assert.equal(targetParsed.nextTargetEvidence?.[0]?.fragmentPath, "phase5-fragments/android-termux-agent.json");
  assert.equal(targetParsed.nextTargetEvidence?.[0]?.templateCommand, "soloclaw phase5 evidence-template --target android-termux-agent --registered-pull-target macos-shell-agent --json");
  assert.equal(targetParsed.nextTargetEvidence?.[0]?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target android-termux-agent --registered-pull-target macos-shell-agent --json");
  assert.equal(targetParsed.nextTargetEvidence?.[0]?.preflightCommand, "soloclaw phase5 evidence-check --file phase5-fragments/android-termux-agent.json --target android-termux-agent --json");
  assert.equal(targetParsed.nextTargetEvidence?.[0]?.collectorGuideCommand, "soloclaw phase5 collector-guide --target android-termux-agent --registered-pull-target macos-shell-agent --json");
  assert.deepEqual(targetParsed.nextTargetEvidence?.[0]?.returnToControlHost, {
    copyFragmentTo: "phase5-fragments/android-termux-agent.json",
    statusCommand: "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target android-termux-agent --registered-pull-target macos-shell-agent --json",
    mergeCommand: "soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json",
    finalCheckCommand: "soloclaw phase5 evidence-check --file phase5-evidence.merged.json --json",
  });
  assert.equal(targetParsed.nextEvidenceScopes?.length, 1);
  assert.equal(targetParsed.nextEvidenceScopes?.[0]?.scope, "target");
  assert.deepEqual(targetParsed.nextEvidenceScopes?.[0]?.targetIds, ["android-termux-agent"]);
  assert.equal(targetParsed.missingEvidence?.every((item) => item.scope === "target" && item.targetId === "android-termux-agent"), true);
  assert.ok(targetParsed.missingEvidence?.some((item) => item.checkId === "one-file-room-bootstrap-evidence"));
  assert.ok(targetParsed.nextCommands?.includes("soloclaw phase5 evidence-template --target android-termux-agent --registered-pull-target macos-shell-agent --json"));
  assert.ok(targetParsed.nextCommands?.includes("soloclaw phase5 collector-guide --target android-termux-agent --registered-pull-target macos-shell-agent --json"));
  assert.ok(targetParsed.nextCommands?.includes("soloclaw phase5 evidence-check --file phase5-fragments/android-termux-agent.json --target android-termux-agent --json"));
  assert.equal(targetParsed.nextCommands?.includes("soloclaw phase5 evidence-check --file phase5-fragments/linux-shell-agent.json --target linux-shell-agent --json"), false);
  assert.ok(targetParsed.nextCommands?.includes("soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json"));
  assert.doesNotMatch(targetStatusResult.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-status CLI treats a missing fragment directory as zero collected fragments", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-status-missing-dir-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-evidence.json");
  const missingFragmentsDir = path.join(workspace, "phase5-fragments");

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  await fs.writeFile(basePath, baseResult.stdout, "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-status",
    "--file",
    basePath,
    "--target-dir",
    missingFragmentsDir,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    targetFilePaths?: string[];
    mergedTargetIds?: string[];
    remainingTargetIds?: string[];
    collectionStatus?: {
      complete?: boolean;
      mergedCount?: number;
      remainingCount?: number;
    };
  };
  assert.equal(parsed.status, "incomplete");
  assert.deepEqual(parsed.targetFilePaths, []);
  assert.deepEqual(parsed.mergedTargetIds, []);
  assert.deepEqual(parsed.remainingTargetIds, [
    "control-plane-host",
    "windows-powershell-agent",
    "windows-cmd-agent",
    "linux-shell-agent",
    "macos-shell-agent",
    "android-termux-agent",
  ]);
  assert.equal(parsed.collectionStatus?.complete, false);
  assert.equal(parsed.collectionStatus?.mergedCount, 0);
  assert.equal(parsed.collectionStatus?.remainingCount, 6);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-status carries registered-agent pull target into suggested scaffold commands", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-status-registered-target-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-evidence.json");
  const missingFragmentsDir = path.join(workspace, "phase5-fragments");

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  await fs.writeFile(basePath, baseResult.stdout, "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-status",
    "--file",
    basePath,
    "--target-dir",
    missingFragmentsDir,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    roomStatus?: { registeredAgentPull?: { targetId?: string } };
    nextTargetEvidence?: Array<{
      targetId?: string;
      templateCommand?: string;
      statusCommand?: string;
      collectorGuideCommand?: string;
      returnToControlHost?: { statusCommand?: string };
    }>;
    nextCommands?: string[];
  };
  assert.equal(parsed.roomStatus?.registeredAgentPull?.targetId, "linux-shell-agent");
  assert.equal(parsed.nextTargetEvidence?.find((target) => target.targetId === "linux-shell-agent")?.templateCommand, "soloclaw phase5 evidence-template --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.nextTargetEvidence?.find((target) => target.targetId === "linux-shell-agent")?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.nextTargetEvidence?.find((target) => target.targetId === "linux-shell-agent")?.returnToControlHost?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.nextTargetEvidence?.find((target) => target.targetId === "macos-shell-agent")?.templateCommand, "soloclaw phase5 evidence-template --target macos-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.nextTargetEvidence?.find((target) => target.targetId === "macos-shell-agent")?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target macos-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.nextTargetEvidence?.find((target) => target.targetId === "macos-shell-agent")?.returnToControlHost?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target macos-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 collection-runbook --registered-pull-target linux-shell-agent --json"));
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 collection-prepare --registered-pull-target linux-shell-agent --json"));
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 collector-pack --registered-pull-target linux-shell-agent --json"));
  assert.equal(parsed.nextCommands?.includes("soloclaw phase5 collection-runbook --json"), false);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-status exposes selected remote registered-agent pull runbook", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-status-registered-target-runbook-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-evidence.json");
  const missingFragmentsDir = path.join(workspace, "phase5-fragments");

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  await fs.writeFile(basePath, baseResult.stdout, "utf8");

  const jsonResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-status",
    "--file",
    basePath,
    "--target-dir",
    missingFragmentsDir,
    "--target",
    "linux-shell-agent",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);

  assert.equal(jsonResult.exitCode, 0, jsonResult.stderr);
  const parsed = JSON.parse(jsonResult.stdout) as {
    nextTargetEvidence?: Array<{
      targetId?: string;
      registeredPullRunbook?: {
        targetId?: string;
        statusFile?: string;
        stopFile?: string;
        stages?: Array<{ id?: string; commandName?: string; commandHint?: string; evidenceFields?: string[] }>;
      };
    }>;
    nextCommands?: string[];
  };
  const target = parsed.nextTargetEvidence?.[0];
  assert.equal(target?.targetId, "linux-shell-agent");
  assert.equal(target?.registeredPullRunbook?.targetId, "linux-shell-agent");
  assert.equal(target?.registeredPullRunbook?.statusFile, ".agent/tmp/phase5-registered-pull-status.json");
  assert.deepEqual(target?.registeredPullRunbook?.stages?.map((stage) => stage.id), [
    "register",
    "wait-for-control-host-pull",
    "list-invitations",
    "accept-room",
    "run-pulled-agent",
    "inspect-status-file",
  ]);
  assert.equal(target?.registeredPullRunbook?.stages?.find((stage) => stage.id === "register")?.commandHint, "agent remote register --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN --display-name <registered-pull-label> --json");
  assert.match(target?.registeredPullRunbook?.stages?.find((stage) => stage.id === "run-pulled-agent")?.commandHint ?? "", /--status-file \.agent\/tmp\/phase5-registered-pull-status\.json/);
  assert.match(target?.registeredPullRunbook?.stages?.find((stage) => stage.id === "run-pulled-agent")?.commandHint ?? "", /--control-token \$AGENT_CONTROL_TOKEN/);
  assert.deepEqual(parsed.nextCommands?.slice(0, 8), [
    "soloclaw phase5 collector-guide --target linux-shell-agent --registered-pull-target linux-shell-agent --json",
    "soloclaw phase5 evidence-template --target linux-shell-agent --registered-pull-target linux-shell-agent --json",
    "agent remote register --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN --display-name <registered-pull-label> --json",
    "control host captures pull-agent.json with agent rooms pull-agent <room-id> <registered-pull-agent-id> --alias registered-pull --role executor --local-agent --json > pull-agent.json",
    "agent remote invitations --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN --json > invitations.json",
    "agent remote accept-room --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN --room <room-id> --json > accept-room.json",
    "agent remote run --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN --room <room-id> --cycles 20 --limit 5 --idle-limit 1 --interval-ms 1000 --loop-interval-ms 1000 --stop-when-idle --idle-cycles 2 --heartbeat-ttl 60 --status-file .agent/tmp/phase5-registered-pull-status.json --stop-file .agent/tmp/phase5-registered-pull.stop --reply-template \"@agent:<owner-agent-id> registered-pull handled {messageId}\" --json",
    "inspect .agent/tmp/phase5-registered-pull-status.json and copy only token-safe summary fields",
  ]);
  assert.equal(parsed.nextCommands?.[8], "soloclaw phase5 evidence-check --file phase5-fragments/linux-shell-agent.json --target linux-shell-agent --json");

  const textResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-status",
    "--file",
    basePath,
    "--target-dir",
    missingFragmentsDir,
    "--target",
    "linux-shell-agent",
    "--registered-pull-target",
    "linux-shell-agent",
  ], workspace);

  assert.equal(textResult.exitCode, 0, textResult.stderr);
  assert.match(textResult.stdout, /Next target evidence:\n- linux-shell-agent \(remote-agent\) status=pending/);
  assert.match(textResult.stdout, /remote registered-agent-pull stages:\n  - register: agent remote register; .*commandHint=agent remote register --control-url <control-url> --control-token \$AGENT_CONTROL_TOKEN/s);
  assert.match(textResult.stdout, /  - run-pulled-agent: agent remote run; .*commandHint=agent remote run --control-url <control-url> --control-token \$AGENT_CONTROL_TOKEN/s);
  assert.doesNotMatch(jsonResult.stdout + textResult.stdout + jsonResult.stderr + textResult.stderr, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-status exposes control-host registered-agent pull runbook commands", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-status-registered-control-runbook-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-evidence.json");
  const missingFragmentsDir = path.join(workspace, "phase5-fragments");

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  await fs.writeFile(basePath, baseResult.stdout, "utf8");

  const jsonResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-status",
    "--file",
    basePath,
    "--target-dir",
    missingFragmentsDir,
    "--target",
    "control-plane-host",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);

  assert.equal(jsonResult.exitCode, 0, jsonResult.stderr);
  const parsed = JSON.parse(jsonResult.stdout) as {
    nextCommands?: string[];
  };
  assert.deepEqual(parsed.nextCommands?.slice(0, 9), [
    "soloclaw phase5 collector-guide --target control-plane-host --registered-pull-target linux-shell-agent --json",
    "soloclaw phase5 evidence-template --target control-plane-host --registered-pull-target linux-shell-agent --json",
    "agent remote register --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN --display-name <registered-pull-label> --json",
    "agent rooms pull-agent <room-id> <registered-pull-agent-id> --alias registered-pull --role executor --local-agent --json > pull-agent.json",
    "agent remote invitations --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN --json > invitations.json; agent remote accept-room --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN --room <room-id> --json > accept-room.json",
    "agent rooms say <room-id> \"@agent:<registered-pull-agent-id> phase5 registered-agent pull smoke: reply when accepted\" --local-agent --json",
    "curl -H \"x-agent-control-token: $AGENT_CONTROL_TOKEN\" \"<control-url>/api/rooms/<room-id>/delivery-status\" > delivery-status.json",
    "agent rooms show <room-id> --local-agent --json > room-show.json; inspect .agent/tmp/phase5-registered-pull-status.json from the selected target fragment",
    "soloclaw phase5 registered-pull-evidence-patch --registered-pull-target linux-shell-agent --status-file .agent/tmp/phase5-registered-pull-status.json --pull-agent-file pull-agent.json --invitations-file invitations.json --accept-room-file accept-room.json --room-show-file room-show.json --delivery-status-file delivery-status.json --output phase5-registered-pull-evidence-patch.json --control-fragment-file phase5-fragments/control-plane-host.json --patched-control-fragment-output phase5-fragments/control-plane-host.json --force --json",
  ]);
  assert.equal(parsed.nextCommands?.[9], "soloclaw phase5 evidence-check --file phase5-fragments/control-plane-host.json --target control-plane-host --json");

  const textResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-status",
    "--file",
    basePath,
    "--target-dir",
    missingFragmentsDir,
    "--target",
    "control-plane-host",
    "--registered-pull-target",
    "linux-shell-agent",
  ], workspace);

  assert.equal(textResult.exitCode, 0, textResult.stderr);
  assert.match(textResult.stdout, /Next commands:[\s\S]*agent rooms pull-agent <room-id> <registered-pull-agent-id> --alias registered-pull --role executor --local-agent --json > pull-agent\.json/);
  assert.match(textResult.stdout, /Next commands:[\s\S]*soloclaw phase5 registered-pull-evidence-patch --registered-pull-target linux-shell-agent[\s\S]*--delivery-status-file delivery-status\.json/);
  assert.doesNotMatch(jsonResult.stdout + textResult.stdout + jsonResult.stderr + textResult.stderr, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-status can override registered-agent pull target for suggested commands", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-status-registered-target-override-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-evidence.json");
  const missingFragmentsDir = path.join(workspace, "phase5-fragments");

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  await fs.writeFile(basePath, baseResult.stdout, "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-status",
    "--file",
    basePath,
    "--target-dir",
    missingFragmentsDir,
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    registeredPullTargetId?: string;
    registeredPullTargetOverride?: {
      requestedTargetId?: string;
      evidenceTargetId?: string;
      affects?: string[];
      evidenceUnchanged?: boolean;
      guidance?: string;
      reconcileCommands?: {
        refreshScaffoldBeforeCollection?: string;
        updateControlPlaneFragment?: string;
      };
    };
    roomStatus?: { registeredAgentPull?: { targetId?: string } };
    nextTargetEvidence?: Array<{
      targetId?: string;
      templateCommand?: string;
      statusCommand?: string;
      collectorGuideCommand?: string;
      returnToControlHost?: { statusCommand?: string };
    }>;
    nextCommands?: string[];
  };
  assert.equal(parsed.registeredPullTargetId, "linux-shell-agent");
  assert.equal(parsed.roomStatus?.registeredAgentPull?.targetId, "macos-shell-agent");
  assert.equal(parsed.nextTargetEvidence?.find((target) => target.targetId === "linux-shell-agent")?.templateCommand, "soloclaw phase5 evidence-template --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.nextTargetEvidence?.find((target) => target.targetId === "linux-shell-agent")?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.nextTargetEvidence?.find((target) => target.targetId === "linux-shell-agent")?.returnToControlHost?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.nextTargetEvidence?.find((target) => target.targetId === "macos-shell-agent")?.templateCommand, "soloclaw phase5 evidence-template --target macos-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.nextTargetEvidence?.find((target) => target.targetId === "macos-shell-agent")?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target macos-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.nextTargetEvidence?.find((target) => target.targetId === "macos-shell-agent")?.returnToControlHost?.statusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target macos-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.nextTargetEvidence?.find((target) => target.targetId === "linux-shell-agent")?.collectorGuideCommand, "soloclaw phase5 collector-guide --target linux-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.equal(parsed.nextTargetEvidence?.find((target) => target.targetId === "macos-shell-agent")?.collectorGuideCommand, "soloclaw phase5 collector-guide --target macos-shell-agent --registered-pull-target linux-shell-agent --json");
  assert.deepEqual(parsed.registeredPullTargetOverride, {
    requestedTargetId: "linux-shell-agent",
    evidenceTargetId: "macos-shell-agent",
    affects: ["nextCommands", "nextTargetEvidence"],
    evidenceUnchanged: true,
    guidance: "Requested registered-agent pull target only changes suggested commands; evidence still records macos-shell-agent. Refresh scaffolding before collection, or update the control-plane fragment's room.registeredAgentPull target fields after collecting real evidence.",
    reconcileCommands: {
      refreshScaffoldBeforeCollection: "soloclaw phase5 collection-prepare --registered-pull-target linux-shell-agent --force --json",
      updateControlPlaneFragment: "soloclaw phase5 evidence-template --target control-plane-host --registered-pull-target linux-shell-agent --json",
    },
  });
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 collection-runbook --registered-pull-target linux-shell-agent --json"));
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 collection-prepare --registered-pull-target linux-shell-agent --json"));
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 collector-pack --registered-pull-target linux-shell-agent --json"));
  assert.equal(parsed.nextCommands?.includes("soloclaw phase5 collection-runbook --registered-pull-target macos-shell-agent --json"), false);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-status CLI reports invalid fragments while preserving valid progress", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-status-invalid-fragment-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-evidence.json");
  const fragmentsDir = path.join(workspace, "phase5-fragments");
  const linuxPath = path.join(fragmentsDir, "linux-shell-agent.json");
  const invalidPath = path.join(fragmentsDir, "macos-shell-agent.json");
  const mergedPath = path.join(workspace, "phase5-evidence.merged.json");
  await fs.mkdir(fragmentsDir, { recursive: true });

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  await fs.writeFile(basePath, baseResult.stdout, "utf8");

  const targetResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--target",
    "linux-shell-agent",
    "--json",
  ], workspace);
  assert.equal(targetResult.exitCode, 0, targetResult.stderr);
  const targetFragment = JSON.parse(targetResult.stdout) as {
    targets?: Array<{ id?: string; status?: string; agentId?: string }>;
  };
  assert.ok(targetFragment.targets?.[0]);
  targetFragment.targets[0].status = "pass";
  targetFragment.targets[0].agentId = "agent_linux_actual";
  await fs.writeFile(linuxPath, JSON.stringify(targetFragment, null, 2), "utf8");
  await fs.writeFile(invalidPath, "{ not valid json }\n", "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-status",
    "--file",
    basePath,
    "--target-dir",
    fragmentsDir,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  await assert.rejects(fs.stat(mergedPath), /ENOENT|no such file/i);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    targetFilePaths?: string[];
    mergedTargetIds?: string[];
    remainingTargetIds?: string[];
    fragmentErrors?: Array<{ path?: string; message?: string }>;
    collectionStatus?: {
      mergedCount?: number;
      remainingCount?: number;
    };
  };
  assert.equal(parsed.status, "incomplete");
  assert.deepEqual(parsed.mergedTargetIds, ["linux-shell-agent"]);
  assert.equal(parsed.targetFilePaths?.includes(linuxPath), true);
  assert.equal(parsed.targetFilePaths?.includes(invalidPath), false);
  assert.equal(parsed.remainingTargetIds?.includes("linux-shell-agent"), false);
  assert.equal(parsed.remainingTargetIds?.includes("macos-shell-agent"), true);
  assert.equal(parsed.collectionStatus?.mergedCount, 1);
  assert.equal(parsed.collectionStatus?.remainingCount, 5);
  assert.equal(parsed.fragmentErrors?.length, 1);
  assert.equal(parsed.fragmentErrors?.[0]?.path, invalidPath);
  assert.ok(parsed.fragmentErrors?.[0]?.message);
  assert.doesNotMatch(result.stdout + result.stderr, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-status reports incomplete registered-agent pull room evidence before final-ready", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-status-registered-pull-incomplete-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-base.json");
  const fragmentsDir = path.join(workspace, "phase5-fragments");
  await fs.mkdir(fragmentsDir, { recursive: true });

  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  await fs.writeFile(basePath, JSON.stringify(evidence, null, 2), "utf8");
  const incompleteRoom = JSON.parse(JSON.stringify(evidence.room)) as {
    registeredAgentPull?: { accepted?: boolean; ackSigned?: boolean; replySignatureStatus?: string };
  };
  assert.ok(incompleteRoom.registeredAgentPull);
  incompleteRoom.registeredAgentPull.accepted = false;
  incompleteRoom.registeredAgentPull.ackSigned = false;
  incompleteRoom.registeredAgentPull.replySignatureStatus = "unknown";

  for (const target of evidence.targets) {
    const fragment = {
      phase: "phase5",
      source: `test fragment ${target.id}`,
      room: target.id === "control-plane-host" ? incompleteRoom : undefined,
      targets: [target],
    };
    await fs.writeFile(path.join(fragmentsDir, `${target.id}.json`), JSON.stringify(fragment, null, 2), "utf8");
  }

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-status",
    "--file",
    basePath,
    "--target-dir",
    fragmentsDir,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    remainingTargetIds?: string[];
    readyForFinalEvidenceCheck?: boolean;
    roomStatus?: {
      source?: string;
      evidenceComplete?: boolean;
      registeredAgentPull?: {
        status?: string;
        targetId?: string;
        issues?: string[];
      };
    };
    nextRoomEvidence?: Array<{
      kind?: string;
      status?: string;
      targetId?: string;
      agentId?: string;
      missingFields?: string[];
      targetFragmentPath?: string;
      controlFragmentPath?: string;
      targetGuideCommand?: string;
      controlGuideCommand?: string;
      controlTemplateCommand?: string;
      controlPreflightCommand?: string;
      controlStatusCommand?: string;
      mergeCommand?: string;
      finalCheckCommand?: string;
      evidenceFieldHints?: Array<{
        field?: string;
        evidencePath?: string;
        source?: string;
        stageId?: string;
        commandName?: string;
      }>;
      registeredPullControlHostRunbook?: {
        targetId?: string;
        targetGuidePath?: string;
        targetFragmentPath?: string;
        controlFragmentPath?: string;
        stages?: Array<{ id?: string; commandName?: string; commandHint?: string; evidenceFields?: string[] }>;
      };
    }>;
    registeredPullOperatorNext?: {
      kind?: string;
      status?: string;
      targetId?: string;
      missingFields?: string[];
      selectedTarget?: {
        targetId?: string;
        fragmentPath?: string;
        guideCommand?: string;
        operatorNextCommands?: string[];
      };
      controlHost?: {
        targetId?: string;
        fragmentPath?: string;
        guideCommand?: string;
        operatorNextCommands?: string[];
      };
      evidenceFieldHints?: Array<{
        field?: string;
        source?: string;
        stageId?: string;
        commandName?: string;
      }>;
      mergeCommand?: string;
      finalCheckCommand?: string;
    };
    nextCommands?: string[];
  };
  assert.equal(parsed.status, "incomplete");
  assert.deepEqual(parsed.remainingTargetIds, []);
  assert.equal(parsed.readyForFinalEvidenceCheck, false);
  assert.equal(parsed.roomStatus?.source, "control-plane-fragment");
  assert.equal(parsed.roomStatus?.evidenceComplete, false);
  assert.equal(parsed.roomStatus?.registeredAgentPull?.status, "incomplete");
  assert.equal(parsed.roomStatus?.registeredAgentPull?.targetId, "macos-shell-agent");
  assert.ok(parsed.roomStatus?.registeredAgentPull?.issues?.includes("accepted"));
  assert.ok(parsed.roomStatus?.registeredAgentPull?.issues?.includes("ackSigned"));
  assert.ok(parsed.roomStatus?.registeredAgentPull?.issues?.includes("replySignatureStatus"));
  const nextRegisteredPull = parsed.nextRoomEvidence?.find((item) => item.kind === "registered-agent-pull");
  assert.equal(nextRegisteredPull?.status, "incomplete");
  assert.equal(nextRegisteredPull?.targetId, "macos-shell-agent");
  assert.equal(nextRegisteredPull?.missingFields?.includes("accepted"), true);
  assert.equal(nextRegisteredPull?.missingFields?.includes("ackSigned"), true);
  assert.equal(nextRegisteredPull?.missingFields?.includes("replySignatureStatus"), true);
  assert.equal(nextRegisteredPull?.targetFragmentPath, "phase5-fragments/macos-shell-agent.json");
  assert.equal(nextRegisteredPull?.controlFragmentPath, "phase5-fragments/control-plane-host.json");
  assert.equal(nextRegisteredPull?.targetGuideCommand, "soloclaw phase5 collector-guide --target macos-shell-agent --registered-pull-target macos-shell-agent --json");
  assert.equal(nextRegisteredPull?.controlGuideCommand, "soloclaw phase5 collector-guide --target control-plane-host --registered-pull-target macos-shell-agent --json");
  assert.equal(nextRegisteredPull?.controlTemplateCommand, "soloclaw phase5 evidence-template --target control-plane-host --registered-pull-target macos-shell-agent --json");
  assert.equal(nextRegisteredPull?.controlPreflightCommand, "soloclaw phase5 evidence-check --file phase5-fragments/control-plane-host.json --target control-plane-host --json");
  assert.equal(nextRegisteredPull?.controlStatusCommand, "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target control-plane-host --registered-pull-target macos-shell-agent --json");
  assert.equal(nextRegisteredPull?.mergeCommand, "soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json");
  assert.equal(nextRegisteredPull?.finalCheckCommand, "soloclaw phase5 evidence-check --file phase5-evidence.merged.json --json");
  assert.ok(nextRegisteredPull?.evidenceFieldHints?.some((hint) =>
    hint.field === "accepted" &&
    hint.evidencePath === "room.registeredAgentPull.accepted" &&
    hint.source === "selected-target" &&
    hint.stageId === "wait-for-remote-acceptance" &&
    hint.commandName === "agent remote accept-room"
  ));
  assert.ok(nextRegisteredPull?.evidenceFieldHints?.some((hint) =>
    hint.field === "ackSigned" &&
    hint.evidencePath === "room.registeredAgentPull.ackSigned" &&
    hint.source === "selected-target-status-file" &&
    hint.stageId === "inspect-transcript-and-runner"
  ));
  assert.ok(nextRegisteredPull?.evidenceFieldHints?.some((hint) =>
    hint.field === "deliveryStatusPendingCount" &&
    hint.source === "control-plane-host" &&
    hint.stageId === "check-delivery-status"
  ));
  assert.equal(nextRegisteredPull?.registeredPullControlHostRunbook?.targetId, "macos-shell-agent");
  assert.equal(nextRegisteredPull?.registeredPullControlHostRunbook?.targetGuidePath, "phase5-collector-guides/macos-shell-agent.md");
  assert.equal(nextRegisteredPull?.registeredPullControlHostRunbook?.targetFragmentPath, "phase5-fragments/macos-shell-agent.json");
  assert.equal(nextRegisteredPull?.registeredPullControlHostRunbook?.controlFragmentPath, "phase5-fragments/control-plane-host.json");
  assert.ok(nextRegisteredPull?.registeredPullControlHostRunbook?.stages?.some((stage) => stage.commandName === "agent rooms pull-agent" && stage.evidenceFields?.includes("aliases")));
  assert.ok(nextRegisteredPull?.registeredPullControlHostRunbook?.stages?.some((stage) => stage.commandName === "agent rooms say" && stage.evidenceFields?.includes("taskMessageId")));
  assert.ok(nextRegisteredPull?.registeredPullControlHostRunbook?.stages?.every((stage) => typeof stage.commandHint === "string" && stage.commandHint.length > 0));
  assert.equal(nextRegisteredPull?.registeredPullControlHostRunbook?.stages?.find((stage) => stage.id === "record-control-fragment")?.commandHint, "soloclaw phase5 registered-pull-evidence-patch --registered-pull-target macos-shell-agent --status-file .agent/tmp/phase5-registered-pull-status.json --pull-agent-file pull-agent.json --invitations-file invitations.json --accept-room-file accept-room.json --room-show-file room-show.json --delivery-status-file delivery-status.json --output phase5-registered-pull-evidence-patch.json --control-fragment-file phase5-fragments/control-plane-host.json --patched-control-fragment-output phase5-fragments/control-plane-host.json --force --json");
  assert.equal(parsed.registeredPullOperatorNext?.kind, "registered-agent-pull");
  assert.equal(parsed.registeredPullOperatorNext?.status, "incomplete");
  assert.equal(parsed.registeredPullOperatorNext?.targetId, "macos-shell-agent");
  assert.deepEqual(parsed.registeredPullOperatorNext?.missingFields?.slice(0, 3), ["accepted", "ackSigned", "replySignatureStatus"]);
  assert.equal(parsed.registeredPullOperatorNext?.selectedTarget?.targetId, "macos-shell-agent");
  assert.equal(parsed.registeredPullOperatorNext?.selectedTarget?.fragmentPath, "phase5-fragments/macos-shell-agent.json");
  assert.equal(parsed.registeredPullOperatorNext?.selectedTarget?.guideCommand, "soloclaw phase5 collector-guide --target macos-shell-agent --registered-pull-target macos-shell-agent --json");
  assert.ok(parsed.registeredPullOperatorNext?.selectedTarget?.operatorNextCommands?.some((command) => command.includes("agent remote run --control-url <control-url> --control-token $AGENT_CONTROL_TOKEN")));
  assert.equal(parsed.registeredPullOperatorNext?.controlHost?.targetId, "control-plane-host");
  assert.equal(parsed.registeredPullOperatorNext?.controlHost?.fragmentPath, "phase5-fragments/control-plane-host.json");
  assert.equal(parsed.registeredPullOperatorNext?.controlHost?.guideCommand, "soloclaw phase5 collector-guide --target control-plane-host --registered-pull-target macos-shell-agent --json");
  assert.ok(parsed.registeredPullOperatorNext?.controlHost?.operatorNextCommands?.some((command) => command.includes("agent rooms pull-agent <room-id> <registered-pull-agent-id>") && command.includes("> pull-agent.json")));
  assert.ok(parsed.registeredPullOperatorNext?.controlHost?.operatorNextCommands?.some((command) => command.includes("soloclaw phase5 registered-pull-evidence-patch --registered-pull-target macos-shell-agent") && command.includes("--room-show-file room-show.json")));
  assert.ok(parsed.registeredPullOperatorNext?.evidenceFieldHints?.some((hint) =>
    hint.field === "accepted" &&
    hint.source === "selected-target" &&
    hint.stageId === "wait-for-remote-acceptance" &&
    hint.commandName === "agent remote accept-room"
  ));
  assert.equal(parsed.registeredPullOperatorNext?.mergeCommand, "soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json");
  assert.equal(parsed.registeredPullOperatorNext?.finalCheckCommand, "soloclaw phase5 evidence-check --file phase5-evidence.merged.json --json");
  assert.deepEqual(parsed.nextCommands?.slice(0, 5), [
    "soloclaw phase5 collector-guide --target control-plane-host --registered-pull-target macos-shell-agent --json",
    "soloclaw phase5 evidence-template --target control-plane-host --registered-pull-target macos-shell-agent --json",
    "soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target control-plane-host --registered-pull-target macos-shell-agent --json",
    "soloclaw phase5 evidence-check --file phase5-fragments/control-plane-host.json --target control-plane-host --json",
    "soloclaw phase5 collector-guide --target macos-shell-agent --registered-pull-target macos-shell-agent --json",
  ]);
  assert.ok(parsed.nextCommands?.includes("soloclaw phase5 evidence-check --file phase5-fragments/control-plane-host.json --target control-plane-host --json"));
  assert.doesNotMatch(result.stdout + result.stderr, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-status text output expands registered-agent pull runbook stages", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-status-registered-pull-text-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-base.json");
  const fragmentsDir = path.join(workspace, "phase5-fragments");
  await fs.mkdir(fragmentsDir, { recursive: true });

  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  await fs.writeFile(basePath, JSON.stringify(evidence, null, 2), "utf8");
  const incompleteRoom = JSON.parse(JSON.stringify(evidence.room)) as {
    registeredAgentPull?: { accepted?: boolean; ackSigned?: boolean; replySignatureStatus?: string };
  };
  assert.ok(incompleteRoom.registeredAgentPull);
  incompleteRoom.registeredAgentPull.accepted = false;
  incompleteRoom.registeredAgentPull.ackSigned = false;
  incompleteRoom.registeredAgentPull.replySignatureStatus = "unknown";

  for (const target of evidence.targets) {
    const fragment = {
      phase: "phase5",
      source: `test fragment ${target.id}`,
      room: target.id === "control-plane-host" ? incompleteRoom : undefined,
      targets: [target],
    };
    await fs.writeFile(path.join(fragmentsDir, `${target.id}.json`), JSON.stringify(fragment, null, 2), "utf8");
  }

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-status",
    "--file",
    basePath,
    "--target-dir",
    fragmentsDir,
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Next room evidence:\n- registered-agent-pull target=macos-shell-agent status=incomplete/);
  assert.match(result.stdout, /registered-agent-pull stages:\n  - wait-for-registration: agent remote register; .*commandHint=agent remote register --control-url <control-url> --control-token \$AGENT_CONTROL_TOKEN/s);
  assert.match(result.stdout, /  - pull-registered-agent: agent rooms pull-agent; .*commandHint=agent rooms pull-agent <room-id> <registered-pull-agent-id> --alias registered-pull --role executor --local-agent --json > pull-agent\.json/s);
  assert.match(result.stdout, /  - record-control-fragment: fill room\.registeredAgentPull; .*commandHint=soloclaw phase5 registered-pull-evidence-patch --registered-pull-target macos-shell-agent[\s\S]*--delivery-status-file delivery-status\.json/s);
  assert.match(result.stdout, /registered-agent-pull field hints:\n  - field=accepted path=room\.registeredAgentPull\.accepted source=selected-target stage=wait-for-remote-acceptance command=agent remote accept-room/s);
  assert.match(result.stdout, /  - field=ackSigned path=room\.registeredAgentPull\.ackSigned source=selected-target-status-file stage=inspect-transcript-and-runner command=agent rooms show and runner status file/s);
  assert.match(result.stdout, /Registered-agent pull operator next:\n- target=macos-shell-agent status=incomplete missing=accepted,ackSigned,replySignatureStatus/);
  assert.match(result.stdout, /Control-host commands:\n- soloclaw phase5 evidence-template --target control-plane-host --registered-pull-target macos-shell-agent --json[\s\S]*- agent rooms pull-agent <room-id> <registered-pull-agent-id>[\s\S]*> pull-agent\.json/);
  assert.match(result.stdout, /Control-host commands:[\s\S]*registered-pull-evidence-patch --registered-pull-target macos-shell-agent[\s\S]*--room-show-file room-show\.json/);
  assert.match(result.stdout, /Selected-target commands:\n- soloclaw phase5 evidence-template --target macos-shell-agent --registered-pull-target macos-shell-agent --json[\s\S]*- agent remote run --control-url <control-url> --control-token \$AGENT_CONTROL_TOKEN/);
  assert.doesNotMatch(result.stdout + result.stderr, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-template includes no-broadcast fallback event stream placeholder", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-template-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    targets?: Array<{ id?: string; evidence?: { eventStreamAckMessageIds?: string[]; eventStreamRoomMessageIds?: string[] } }>;
  };
  const controlHost = parsed.targets?.find((target) => target.id === "control-plane-host");
  assert.ok(controlHost?.evidence?.eventStreamRoomMessageIds?.includes("<no-broadcast-fallback-message-id>"));
  assert.ok(controlHost?.evidence?.eventStreamAckMessageIds?.includes("<per-remote-ack-message-id>"));
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-template can pin the registered-agent pull target in shared room evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-template-registered-pull-target-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--target",
    "control-plane-host",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    source?: string;
    room?: { registeredAgentPull?: { targetId?: string } };
    targets?: Array<{ id?: string }>;
  };
  assert.match(parsed.source ?? "", /--target control-plane-host/);
  assert.deepEqual(parsed.targets?.map((target) => target.id), ["control-plane-host"]);
  assert.equal(parsed.room?.registeredAgentPull?.targetId, "linux-shell-agent");
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-template CLI can print one target evidence fragment", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-template-target-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--target=linux-shell-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    source?: string;
    targets?: Array<{ id?: string; role?: string; checks?: { servicePlan?: string }; evidence?: { servicePlanKind?: string } }>;
  };
  assert.match(parsed.source ?? "", /--target linux-shell-agent/);
  assert.deepEqual(parsed.targets?.map((target) => target.id), ["linux-shell-agent"]);
  assert.equal(parsed.targets?.[0]?.role, "remote-agent");
  assert.equal(parsed.targets?.[0]?.checks?.servicePlan, "pending");
  assert.equal(parsed.targets?.[0]?.evidence?.servicePlanKind, "soloclaw.remote_room_service_plan");
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-template CLI rejects unknown target filters", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-template-unknown-target-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--target",
    "unknown-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Unknown Phase 5 evidence target: unknown-agent/);
  assert.doesNotMatch(result.stderr, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-merge CLI replaces one target fragment in a full evidence template", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-merge-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-base.json");
  const targetPath = path.join(workspace, "phase5-linux-fragment.json");

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  const base = JSON.parse(baseResult.stdout) as { room?: Record<string, unknown> };
  assert.ok(base.room);
  base.room.revokedAgent = { agentId: "agent_base_revoked" };
  await fs.writeFile(basePath, JSON.stringify(base, null, 2), "utf8");

  const targetResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--target=linux-shell-agent",
    "--json",
  ], workspace);
  assert.equal(targetResult.exitCode, 0, targetResult.stderr);
  const targetFragment = JSON.parse(targetResult.stdout) as {
    targets?: Array<{ id?: string; status?: string; agentId?: string; checks?: Record<string, unknown>; evidence?: Record<string, unknown> }>;
  };
  assert.ok(targetFragment.targets?.[0]);
  targetFragment.targets[0].status = "pass";
  targetFragment.targets[0].agentId = "agent_linux_actual";
  if (targetFragment.targets[0].checks) {
    targetFragment.targets[0].checks.install = "pass";
    targetFragment.targets[0].checks.servicePlan = "pass";
  }
  if (targetFragment.targets[0].evidence) {
    targetFragment.targets[0].evidence.messagesProcessed = 3;
    targetFragment.targets[0].evidence.servicePlanInstallState = "plan_only";
  }
  (targetFragment as { room?: Record<string, unknown> }).room = {
    revokedAgent: { agentId: "agent_remote_fragment_should_not_replace_room" },
  };
  await fs.writeFile(targetPath, JSON.stringify(targetFragment, null, 2), "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-merge",
    "--file",
    basePath,
    "--target-file",
    targetPath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    source?: string;
    room?: { revokedAgent?: { agentId?: string } };
    targets?: Array<{ id?: string; status?: string; agentId?: string; checks?: Record<string, unknown>; evidence?: Record<string, unknown> }>;
  };
  const linux = parsed.targets?.find((target) => target.id === "linux-shell-agent");
  const control = parsed.targets?.find((target) => target.id === "control-plane-host");
  assert.equal(parsed.source, "soloclaw phase5 evidence-merge");
  assert.equal(parsed.targets?.length, 6);
  assert.equal(linux?.status, "pass");
  assert.equal(linux?.agentId, "agent_linux_actual");
  assert.equal(linux?.checks?.servicePlan, "pass");
  assert.equal(linux?.evidence?.messagesProcessed, 3);
  assert.equal(control?.status, "pending");
  assert.equal(parsed.room?.revokedAgent?.agentId, "agent_base_revoked");
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-merge CLI replaces shared room evidence from the control-plane fragment", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-merge-control-room-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-base.json");
  const targetPath = path.join(workspace, "phase5-control-fragment.json");

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  const base = JSON.parse(baseResult.stdout) as { room?: Record<string, unknown> };
  assert.ok(base.room);
  base.room.revokedAgent = { agentId: "agent_base_revoked" };
  await fs.writeFile(basePath, JSON.stringify(base, null, 2), "utf8");

  const targetResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--target=control-plane-host",
    "--json",
  ], workspace);
  assert.equal(targetResult.exitCode, 0, targetResult.stderr);
  const targetFragment = JSON.parse(targetResult.stdout) as {
    room?: Record<string, unknown>;
    targets?: Array<{ id?: string; status?: string; checks?: Record<string, unknown>; evidence?: Record<string, unknown> }>;
  };
  assert.ok(targetFragment.room);
  assert.ok(targetFragment.targets?.[0]);
  targetFragment.room.revokedAgent = {
    targetId: "windows-cmd-agent",
    agentId: "agent_control_revoked",
    trustStatus: "revoked",
    trustUpdated: true,
    signedSayBlocked: true,
    signedAckBlocked: true,
    signedHeartbeatBlocked: true,
    rejection: "Agent trust status revoked does not allow signed room message intent.",
  };
  targetFragment.targets[0].status = "pass";
  if (targetFragment.targets[0].checks) {
    targetFragment.targets[0].checks.eventStream = "pass";
  }
  if (targetFragment.targets[0].evidence) {
    targetFragment.targets[0].evidence.eventStreamConnected = true;
  }
  await fs.writeFile(targetPath, JSON.stringify(targetFragment, null, 2), "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-merge",
    "--file",
    basePath,
    "--target-file",
    targetPath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    room?: { revokedAgent?: { agentId?: string; signedSayBlocked?: boolean } };
    targets?: Array<{ id?: string; status?: string; evidence?: Record<string, unknown> }>;
  };
  const control = parsed.targets?.find((target) => target.id === "control-plane-host");
  assert.equal(control?.status, "pass");
  assert.equal(control?.evidence?.eventStreamConnected, true);
  assert.equal(parsed.room?.revokedAgent?.agentId, "agent_control_revoked");
  assert.equal(parsed.room?.revokedAgent?.signedSayBlocked, true);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-merge --output reports shared room evidence source", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-merge-room-status-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-base.json");
  const targetPath = path.join(workspace, "phase5-control-fragment.json");
  const outputPath = path.join(workspace, "phase5-merged.json");

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  const base = JSON.parse(baseResult.stdout) as { room?: Record<string, unknown> };
  assert.ok(base.room);
  base.room.revokedAgent = { agentId: "agent_base_revoked" };
  await fs.writeFile(basePath, JSON.stringify(base, null, 2), "utf8");

  const targetResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--target=control-plane-host",
    "--json",
  ], workspace);
  assert.equal(targetResult.exitCode, 0, targetResult.stderr);
  const targetFragment = JSON.parse(targetResult.stdout) as {
    room?: Record<string, unknown>;
    targets?: Array<{ id?: string; status?: string; evidence?: Record<string, unknown> }>;
  };
  assert.ok(targetFragment.room);
  assert.ok(targetFragment.targets?.[0]);
  targetFragment.room.revokedAgent = {
    targetId: "windows-cmd-agent",
    agentId: "agent_control_revoked",
    trustStatus: "revoked",
    trustUpdated: true,
    signedSayBlocked: true,
    signedAckBlocked: true,
    signedHeartbeatBlocked: true,
    rejection: "Agent trust status revoked does not allow signed room message intent.",
  };
  targetFragment.targets[0].status = "pass";
  if (targetFragment.targets[0].evidence) {
    targetFragment.targets[0].evidence.eventStreamConnected = true;
  }
  await fs.writeFile(targetPath, JSON.stringify(targetFragment, null, 2), "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-merge",
    "--file",
    basePath,
    "--target-file",
    targetPath,
    "--output",
    outputPath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    roomStatus?: {
      required?: boolean;
      source?: string;
      mergedFromControlPlaneFragment?: boolean;
      needsControlPlaneFragment?: boolean;
    };
    output?: { path?: string };
  };
  assert.equal(parsed.roomStatus?.required, true);
  assert.equal(parsed.roomStatus?.source, "control-plane-fragment");
  assert.equal(parsed.roomStatus?.mergedFromControlPlaneFragment, true);
  assert.equal(parsed.roomStatus?.needsControlPlaneFragment, false);
  assert.equal(parsed.output?.path, outputPath);
  const merged = JSON.parse(await fs.readFile(outputPath, "utf8")) as { room?: { revokedAgent?: { agentId?: string } } };
  assert.equal(merged.room?.revokedAgent?.agentId, "agent_control_revoked");
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-merge --output reports remaining target collection status", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-merge-status-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-base.json");
  const targetPath = path.join(workspace, "phase5-linux-fragment.json");
  const outputPath = path.join(workspace, "phase5-merged.json");

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  await fs.writeFile(basePath, baseResult.stdout, "utf8");

  const targetResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--target",
    "linux-shell-agent",
    "--json",
  ], workspace);
  assert.equal(targetResult.exitCode, 0, targetResult.stderr);
  const targetFragment = JSON.parse(targetResult.stdout) as {
    targets?: Array<{ id?: string; status?: string; agentId?: string; checks?: Record<string, unknown>; evidence?: Record<string, unknown> }>;
  };
  assert.ok(targetFragment.targets?.[0]);
  targetFragment.targets[0].status = "pass";
  targetFragment.targets[0].agentId = "agent_linux_actual";
  await fs.writeFile(targetPath, JSON.stringify(targetFragment, null, 2), "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-merge",
    "--file",
    basePath,
    "--target-file",
    targetPath,
    "--output",
    outputPath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    mergedTargetIds?: string[];
    requiredTargetIds?: string[];
    remainingTargetIds?: string[];
    readyForFinalEvidenceCheck?: boolean;
    roomStatus?: {
      required?: boolean;
      source?: string;
      mergedFromControlPlaneFragment?: boolean;
      needsControlPlaneFragment?: boolean;
    };
    targetStatus?: { required?: number; passed?: number; remaining?: number };
    output?: { path?: string };
  };
  assert.equal(parsed.status, "pass");
  assert.deepEqual(parsed.mergedTargetIds, ["linux-shell-agent"]);
  assert.equal(parsed.requiredTargetIds?.includes("android-termux-agent"), true);
  assert.equal(parsed.remainingTargetIds?.includes("linux-shell-agent"), false);
  assert.equal(parsed.remainingTargetIds?.includes("android-termux-agent"), true);
  assert.equal(parsed.readyForFinalEvidenceCheck, false);
  assert.equal(parsed.targetStatus?.required, 6);
  assert.equal(parsed.targetStatus?.passed, 1);
  assert.equal(parsed.targetStatus?.remaining, 5);
  assert.equal(parsed.roomStatus?.required, true);
  assert.equal(parsed.roomStatus?.source, "base");
  assert.equal(parsed.roomStatus?.mergedFromControlPlaneFragment, false);
  assert.equal(parsed.roomStatus?.needsControlPlaneFragment, true);
  assert.equal(parsed.output?.path, outputPath);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-merge --output reports per-target collection status", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-merge-collection-status-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-base.json");
  const targetPath = path.join(workspace, "phase5-linux-fragment.json");
  const outputPath = path.join(workspace, "phase5-merged.json");

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  await fs.writeFile(basePath, baseResult.stdout, "utf8");

  const targetResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--target",
    "linux-shell-agent",
    "--json",
  ], workspace);
  assert.equal(targetResult.exitCode, 0, targetResult.stderr);
  const targetFragment = JSON.parse(targetResult.stdout) as {
    targets?: Array<{ id?: string; status?: string; agentId?: string }>;
  };
  assert.ok(targetFragment.targets?.[0]);
  targetFragment.targets[0].status = "pass";
  targetFragment.targets[0].agentId = "agent_linux_actual";
  await fs.writeFile(targetPath, JSON.stringify(targetFragment, null, 2), "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-merge",
    "--file",
    basePath,
    "--target-file",
    targetPath,
    "--output",
    outputPath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    collectionStatus?: {
      complete?: boolean;
      mergedCount?: number;
      remainingCount?: number;
      targets?: Array<{
        id?: string;
        role?: string;
        evidenceStatus?: string;
        mergedThisRun?: boolean;
        sourceFilePath?: string;
      }>;
    };
  };
  assert.equal(parsed.collectionStatus?.complete, false);
  assert.equal(parsed.collectionStatus?.mergedCount, 1);
  assert.equal(parsed.collectionStatus?.remainingCount, 5);
  const linux = parsed.collectionStatus?.targets?.find((target) => target.id === "linux-shell-agent");
  const control = parsed.collectionStatus?.targets?.find((target) => target.id === "control-plane-host");
  assert.equal(linux?.role, "remote-agent");
  assert.equal(linux?.evidenceStatus, "pass");
  assert.equal(linux?.mergedThisRun, true);
  assert.equal(linux?.sourceFilePath, targetPath);
  assert.equal(control?.role, "control-plane");
  assert.equal(control?.evidenceStatus, "pending");
  assert.equal(control?.mergedThisRun, false);
  assert.equal(control?.sourceFilePath, undefined);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-merge --output reports final evidence-check summary", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-merge-final-check-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-base.json");
  const targetPath = path.join(workspace, "phase5-linux-fragment.json");
  const outputPath = path.join(workspace, "phase5-merged.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  await fs.writeFile(basePath, JSON.stringify(evidence, null, 2), "utf8");

  const linuxFragment = JSON.parse(JSON.stringify(evidence)) as {
    room?: Record<string, unknown>;
    targets?: Array<{ id?: string; checks?: Record<string, unknown>; evidence?: Record<string, unknown> }>;
  };
  delete linuxFragment.room;
  linuxFragment.targets = linuxFragment.targets?.filter((target) => target.id === "linux-shell-agent");
  assert.ok(linuxFragment.targets?.[0]?.checks);
  assert.ok(linuxFragment.targets?.[0]?.evidence);
  delete linuxFragment.targets[0].checks.servicePlan;
  delete linuxFragment.targets[0].evidence.servicePlanKind;
  delete linuxFragment.targets[0].evidence.servicePlanInstallState;
  await fs.writeFile(targetPath, JSON.stringify(linuxFragment, null, 2), "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-merge",
    "--file",
    basePath,
    "--target-file",
    targetPath,
    "--output",
    outputPath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    finalEvidenceCheck?: {
      status?: string;
      missingEvidenceCount?: number;
      missingEvidenceByScope?: {
        matrix?: number;
        target?: number;
        room?: number;
        controlPlane?: number;
      };
    };
  };
  assert.equal(parsed.finalEvidenceCheck?.status, "fail");
  assert.equal(parsed.finalEvidenceCheck?.missingEvidenceCount, 1);
  assert.equal(parsed.finalEvidenceCheck?.missingEvidenceByScope?.target, 1);
  assert.equal(parsed.finalEvidenceCheck?.missingEvidenceByScope?.room, 0);
  assert.equal(parsed.finalEvidenceCheck?.missingEvidenceByScope?.matrix, 0);
  assert.equal(parsed.finalEvidenceCheck?.missingEvidenceByScope?.controlPlane, 0);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-merge --target-dir merges a directory of target fragments", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-merge-target-dir-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-base.json");
  const fragmentsDir = path.join(workspace, "fragments");
  const outputPath = path.join(workspace, "phase5-merged.json");
  await fs.mkdir(fragmentsDir, { recursive: true });

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  await fs.writeFile(basePath, baseResult.stdout, "utf8");

  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  for (const target of evidence.targets) {
    const fragment = {
      phase: "phase5",
      source: `test fragment ${target.id}`,
      room: target.id === "control-plane-host" ? evidence.room : undefined,
      targets: [target],
    };
    await fs.writeFile(path.join(fragmentsDir, `${target.id}.json`), JSON.stringify(fragment, null, 2), "utf8");
  }
  await fs.writeFile(path.join(fragmentsDir, "README.txt"), "not evidence json", "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-merge",
    "--file",
    basePath,
    "--target-dir",
    fragmentsDir,
    "--output",
    outputPath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    targetFilePaths?: string[];
    mergedTargetIds?: string[];
    remainingTargetIds?: string[];
    readyForFinalEvidenceCheck?: boolean;
    finalEvidenceCheck?: { status?: string; missingEvidenceCount?: number };
    output?: { path?: string };
  };
  const expectedTargetIds = evidence.targets.map((target) => target.id).sort();
  assert.deepEqual([...(parsed.mergedTargetIds ?? [])].sort(), expectedTargetIds);
  assert.equal(parsed.targetFilePaths?.length, expectedTargetIds.length);
  assert.equal(parsed.targetFilePaths?.some((filePath) => filePath.endsWith("README.txt")), false);
  assert.deepEqual(parsed.remainingTargetIds, []);
  assert.equal(parsed.readyForFinalEvidenceCheck, true);
  assert.equal(parsed.finalEvidenceCheck?.status, "pass");
  assert.equal(parsed.finalEvidenceCheck?.missingEvidenceCount, 0);
  assert.equal(parsed.output?.path, outputPath);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-merge --target-dir rejects duplicate target fragments", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-merge-target-dir-duplicate-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-base.json");
  const fragmentsDir = path.join(workspace, "fragments");
  await fs.mkdir(fragmentsDir, { recursive: true });

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  await fs.writeFile(basePath, baseResult.stdout, "utf8");

  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const linux = evidence.targets.find((target) => target.id === "linux-shell-agent");
  assert.ok(linux);
  const firstFragment = {
    phase: "phase5",
    source: "test fragment linux first",
    targets: [linux],
  };
  const secondFragment = {
    phase: "phase5",
    source: "test fragment linux duplicate",
    targets: [{ ...linux, agentId: "agent_linux_duplicate" }],
  };
  const firstPath = path.join(fragmentsDir, "001-linux.json");
  const secondPath = path.join(fragmentsDir, "002-linux-copy.json");
  await fs.writeFile(firstPath, JSON.stringify(firstFragment, null, 2), "utf8");
  await fs.writeFile(secondPath, JSON.stringify(secondFragment, null, 2), "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-merge",
    "--file",
    basePath,
    "--target-dir",
    fragmentsDir,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Duplicate Phase 5 evidence merge target: linux-shell-agent/);
  assert.match(result.stderr, /001-linux\.json/);
  assert.match(result.stderr, /002-linux-copy\.json/);
  assert.doesNotMatch(result.stderr, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-merge --output waits for control-plane room evidence before final-ready", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-merge-room-not-ready-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-base.json");
  const targetPath = path.join(workspace, "phase5-linux-fragment.json");
  const outputPath = path.join(workspace, "phase5-merged.json");

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  const base = JSON.parse(baseResult.stdout) as {
    targets?: Array<{ id?: string; status?: string }>;
  };
  for (const target of base.targets ?? []) {
    target.status = "pass";
  }
  await fs.writeFile(basePath, JSON.stringify(base, null, 2), "utf8");

  const targetResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--target",
    "linux-shell-agent",
    "--json",
  ], workspace);
  assert.equal(targetResult.exitCode, 0, targetResult.stderr);
  const targetFragment = JSON.parse(targetResult.stdout) as {
    targets?: Array<{ id?: string; status?: string; agentId?: string }>;
  };
  assert.ok(targetFragment.targets?.[0]);
  targetFragment.targets[0].status = "pass";
  targetFragment.targets[0].agentId = "agent_linux_actual";
  await fs.writeFile(targetPath, JSON.stringify(targetFragment, null, 2), "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-merge",
    "--file",
    basePath,
    "--target-file",
    targetPath,
    "--output",
    outputPath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    remainingTargetIds?: string[];
    readyForFinalEvidenceCheck?: boolean;
    roomStatus?: {
      source?: string;
      needsControlPlaneFragment?: boolean;
    };
    targetStatus?: { passed?: number; remaining?: number };
  };
  assert.deepEqual(parsed.remainingTargetIds, []);
  assert.equal(parsed.targetStatus?.passed, 6);
  assert.equal(parsed.targetStatus?.remaining, 0);
  assert.equal(parsed.roomStatus?.source, "base");
  assert.equal(parsed.roomStatus?.needsControlPlaneFragment, true);
  assert.equal(parsed.readyForFinalEvidenceCheck, false);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-merge CLI rejects unknown target fragments", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-merge-unknown-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-base.json");
  const targetPath = path.join(workspace, "phase5-unknown-fragment.json");

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  await fs.writeFile(basePath, baseResult.stdout, "utf8");
  await fs.writeFile(targetPath, JSON.stringify({
    phase: "phase5",
    targets: [
      {
        id: "unknown-agent",
        status: "pass",
      },
    ],
  }, null, 2), "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-merge",
    "--file",
    basePath,
    "--target-file",
    targetPath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Unknown Phase 5 evidence merge target: unknown-agent/);
  assert.doesNotMatch(result.stderr, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-merge CLI accepts BOM-encoded evidence files", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-merge-bom-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const basePath = path.join(workspace, "phase5-base-bom.json");
  const targetPath = path.join(workspace, "phase5-linux-fragment-bom.json");

  const baseResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);
  assert.equal(baseResult.exitCode, 0, baseResult.stderr);
  await fs.writeFile(basePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(baseResult.stdout, "utf8")]));

  const targetResult = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--target",
    "linux-shell-agent",
    "--json",
  ], workspace);
  assert.equal(targetResult.exitCode, 0, targetResult.stderr);
  const targetFragment = JSON.parse(targetResult.stdout) as {
    targets?: Array<{ id?: string; status?: string; agentId?: string; evidence?: Record<string, unknown> }>;
  };
  assert.ok(targetFragment.targets?.[0]);
  targetFragment.targets[0].status = "pass";
  targetFragment.targets[0].agentId = "agent_linux_bom";
  if (targetFragment.targets[0].evidence) {
    targetFragment.targets[0].evidence.messagesProcessed = 4;
  }
  const targetJson = JSON.stringify(targetFragment, null, 2);
  await fs.writeFile(targetPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(targetJson, "utf16le")]));

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-merge",
    "--file",
    basePath,
    "--target-file",
    targetPath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    targets?: Array<{ id?: string; status?: string; agentId?: string; evidence?: Record<string, unknown> }>;
  };
  const linux = parsed.targets?.find((target) => target.id === "linux-shell-agent");
  assert.equal(linux?.status, "pass");
  assert.equal(linux?.agentId, "agent_linux_bom");
  assert.equal(linux?.evidence?.messagesProcessed, 4);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check CLI validates complete cross-machine matrix evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-evidence-cli-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-evidence.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    phase?: string;
    gate?: string;
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { roomMessageEventTypes?: string[]; roomMessageIds?: string[]; deliveryAckEventTypes?: string[]; ackMessageIds?: string[] } }>;
    missingEvidence?: unknown[];
    summary?: { remoteTargetsPassed?: number };
  };
  assert.equal(parsed.phase, "phase5");
  assert.equal(parsed.gate, "matrix-evidence");
  assert.equal(parsed.status, "pass");
  assert.deepEqual(parsed.checks?.map((check) => check.id), [
    "evidence-shape",
    "required-targets",
    "target-smoke-results",
    "revoked-invite-join-blocked",
    "revoked-agent-signed-ops-blocked",
    "room-key-rotation-evidence",
    "suspended-agent-blocked",
    "control-plane-event-stream",
    "signed-room-exchange",
    "registered-agent-pull-communication-evidence",
    "no-broadcast-fallback-execution-evidence",
    "stale-agent-health-detected",
    "stale-agent-recovery",
    "one-file-room-bootstrap-evidence",
    "remote-service-plan-evidence",
    "runner-status-file-evidence",
    "runner-stop-file-shutdown",
    "agent-to-agent-exchange",
    "room-assignment-result-evidence",
    "room-conflict-resolution-evidence",
    "room-result-sync-evidence",
    "room-handoff-evidence",
    "operator-room-visibility",
    "secret-shape-scan",
  ]);
  assert.equal(parsed.checks?.every((check) => check.status === "pass"), true);
  const eventStreamCheck = parsed.checks?.find((check) => check.id === "control-plane-event-stream");
  assert.deepEqual(eventStreamCheck?.metadata?.roomMessageEventTypes, ["room.message.sent"]);
  assert.ok(eventStreamCheck?.metadata?.roomMessageIds?.length);
  assert.deepEqual(eventStreamCheck?.metadata?.deliveryAckEventTypes, ["room.delivery.acknowledged"]);
  assert.ok(eventStreamCheck?.metadata?.ackMessageIds?.length);
  assert.equal(parsed.summary?.remoteTargetsPassed, 5);
  assert.deepEqual(parsed.missingEvidence, []);
  assert.doesNotMatch(result.stdout, /rinv_[A-Za-z0-9_-]+|phase5-control-token|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check summarizes missing target and room evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-missing-summary-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-missing-summary.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const linux = evidence.targets.find((entry) => entry.id === "linux-shell-agent");
  assert.ok(linux?.checks);
  assert.ok(linux?.evidence);
  delete (linux.checks as Record<string, unknown>).servicePlan;
  delete (linux.evidence as Record<string, unknown>).servicePlanKind;
  delete (linux.evidence as Record<string, unknown>).servicePlanInstallState;
  delete (evidence.room as Record<string, unknown>).revokedInvite;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    summary?: {
      missingEvidenceByScope?: {
        matrix?: number;
        target?: number;
        room?: number;
        controlPlane?: number;
      };
    };
    missingEvidence?: Array<{ scope?: string; targetId?: string; checkId?: string; missing?: string[] }>;
  };
  assert.equal(parsed.status, "fail");
  assert.equal(parsed.summary?.missingEvidenceByScope?.target, 1);
  assert.equal(parsed.summary?.missingEvidenceByScope?.room, 1);
  assert.equal(parsed.summary?.missingEvidenceByScope?.matrix, 0);
  assert.equal(parsed.summary?.missingEvidenceByScope?.controlPlane, 0);
  assert.ok(parsed.missingEvidence?.some((item) =>
    item.scope === "target" &&
    item.targetId === "linux-shell-agent" &&
    item.checkId === "remote-service-plan-evidence" &&
    item.missing?.includes("remote-service-plan-evidence")
  ));
  assert.ok(parsed.missingEvidence?.some((item) =>
    item.scope === "room" &&
    item.checkId === "revoked-invite-join-blocked" &&
    item.missing?.includes("missing")
  ));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check --target validates one remote target fragment", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-target-check-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "linux-fragment.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const linux = evidence.targets.find((entry) => entry.id === "linux-shell-agent");
  assert.ok(linux);
  await fs.writeFile(evidencePath, JSON.stringify({
    phase: "phase5",
    targets: [linux],
  }, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--target",
    "linux-shell-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    gate?: string;
    status?: string;
    summary?: { requiredTargets?: number; targetsPresent?: number; remoteTargetsPassed?: number };
    missingEvidence?: unknown[];
    checks?: Array<{ id?: string; status?: string }>;
  };
  assert.equal(parsed.gate, "target-evidence");
  assert.equal(parsed.status, "pass");
  assert.equal(parsed.summary?.requiredTargets, 1);
  assert.equal(parsed.summary?.targetsPresent, 1);
  assert.equal(parsed.summary?.remoteTargetsPassed, 1);
  assert.deepEqual(parsed.missingEvidence, []);
  assert.deepEqual(parsed.checks?.map((check) => check.id), [
    "evidence-shape",
    "required-targets",
    "target-smoke-results",
    "signed-room-exchange",
    "one-file-room-bootstrap-evidence",
    "remote-service-plan-evidence",
    "runner-status-file-evidence",
    "secret-shape-scan",
  ]);
  assert.equal(parsed.checks?.every((check) => check.status === "pass"), true);
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check --target reports missing one-target fragment fields", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-target-check-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "linux-fragment-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const linux = evidence.targets.find((entry) => entry.id === "linux-shell-agent");
  assert.ok(linux?.checks);
  assert.ok(linux?.evidence);
  delete (linux.checks as Record<string, unknown>).servicePlan;
  delete (linux.evidence as Record<string, unknown>).servicePlanKind;
  delete (linux.evidence as Record<string, unknown>).servicePlanInstallState;
  await fs.writeFile(evidencePath, JSON.stringify({
    phase: "phase5",
    targets: [linux],
  }, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--target=linux-shell-agent",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    gate?: string;
    status?: string;
    missingEvidence?: Array<{ scope?: string; targetId?: string; checkId?: string; missing?: string[] }>;
  };
  assert.equal(parsed.gate, "target-evidence");
  assert.equal(parsed.status, "fail");
  assert.ok(parsed.missingEvidence?.some((item) =>
    item.scope === "target" &&
    item.targetId === "linux-shell-agent" &&
    item.checkId === "remote-service-plan-evidence" &&
    item.missing?.includes("remote-service-plan-evidence")
  ));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check --target validates one control-plane target fragment", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-control-target-check-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "control-fragment.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const control = evidence.targets.find((entry) => entry.id === "control-plane-host");
  assert.ok(control);
  await fs.writeFile(evidencePath, JSON.stringify({
    phase: "phase5",
    room: evidence.room,
    targets: [control],
  }, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--target",
    "control-plane-host",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    gate?: string;
    status?: string;
    summary?: { requiredTargets?: number; targetsPresent?: number };
    missingEvidence?: unknown[];
    checks?: Array<{ id?: string; status?: string }>;
  };
  assert.equal(parsed.gate, "target-evidence");
  assert.equal(parsed.status, "pass");
  assert.equal(parsed.summary?.requiredTargets, 1);
  assert.equal(parsed.summary?.targetsPresent, 1);
  assert.deepEqual(parsed.missingEvidence, []);
  assert.deepEqual(parsed.checks?.map((check) => check.id), [
    "evidence-shape",
    "required-targets",
    "target-smoke-results",
    "revoked-invite-join-blocked",
    "revoked-agent-signed-ops-blocked",
    "room-key-rotation-evidence",
    "suspended-agent-blocked",
    "control-plane-event-stream",
    "no-broadcast-fallback-execution-evidence",
    "stale-agent-health-detected",
    "stale-agent-recovery",
    "runner-stop-file-shutdown",
    "agent-to-agent-exchange",
    "registered-agent-pull-communication-evidence",
    "room-assignment-result-evidence",
    "room-conflict-resolution-evidence",
    "room-result-sync-evidence",
    "room-handoff-evidence",
    "operator-room-visibility",
    "secret-shape-scan",
  ]);
  assert.equal(parsed.checks?.every((check) => check.status === "pass"), true);
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check --target reports missing control-plane fragment fields", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-control-target-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "control-fragment-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const control = evidence.targets.find((entry) => entry.id === "control-plane-host");
  assert.ok(control?.checks);
  assert.ok(control?.evidence);
  delete (control.checks as Record<string, unknown>).eventStream;
  delete (control.evidence as Record<string, unknown>).eventStreamConnected;
  await fs.writeFile(evidencePath, JSON.stringify({
    phase: "phase5",
    room: evidence.room,
    targets: [control],
  }, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--target=control-plane-host",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    gate?: string;
    status?: string;
    missingEvidence?: Array<{ scope?: string; targetId?: string; checkId?: string; missing?: string[] }>;
  };
  assert.equal(parsed.gate, "target-evidence");
  assert.equal(parsed.status, "fail");
  assert.ok(parsed.missingEvidence?.some((item) =>
    item.scope === "target" &&
    item.targetId === "control-plane-host" &&
    item.checkId === "control-plane-event-stream" &&
    item.missing?.includes("eventStream") &&
    item.missing?.includes("eventStreamConnected")
  ));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check --target reports missing control-plane room fragment evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-control-room-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "control-room-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const control = evidence.targets.find((entry) => entry.id === "control-plane-host");
  assert.ok(control);
  delete (evidence.room as Record<string, unknown>).revokedAgent;
  await fs.writeFile(evidencePath, JSON.stringify({
    phase: "phase5",
    room: evidence.room,
    targets: [control],
  }, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--target=control-plane-host",
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    gate?: string;
    status?: string;
    missingEvidence?: Array<{ scope?: string; targetId?: string; checkId?: string; missing?: string[] }>;
  };
  assert.equal(parsed.gate, "target-evidence");
  assert.equal(parsed.status, "fail");
  assert.ok(parsed.missingEvidence?.some((item) =>
    item.scope === "room" &&
    item.targetId === undefined &&
    item.checkId === "revoked-agent-signed-ops-blocked" &&
    item.missing?.includes("missing")
  ));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without revoked agent signed-operation rejection evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-revoked-agent-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-revoked-agent-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  delete (evidence.room as Record<string, unknown>).revokedAgent;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const revokedAgentCheck = parsed.checks?.find((check) => check.id === "revoked-agent-signed-ops-blocked");
  assert.equal(parsed.status, "fail");
  assert.equal(revokedAgentCheck?.status, "fail");
  assert.ok(revokedAgentCheck?.metadata?.issues?.includes("missing"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without remote service plan evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-service-plan-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-service-plan-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const remote = (evidence.targets as Array<Record<string, unknown>>).find((target) => target.id === "linux-shell-agent");
  if (remote && typeof remote.checks === "object" && remote.checks) {
    delete (remote.checks as Record<string, unknown>).servicePlan;
  }
  if (remote && typeof remote.evidence === "object" && remote.evidence) {
    delete (remote.evidence as Record<string, unknown>).servicePlanKind;
    delete (remote.evidence as Record<string, unknown>).servicePlanInstallState;
  }
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { incompleteTargets?: string[] } }>;
  };
  const servicePlanCheck = parsed.checks?.find((check) => check.id === "remote-service-plan-evidence");
  assert.equal(parsed.status, "fail");
  assert.equal(servicePlanCheck?.status, "fail");
  assert.deepEqual(servicePlanCheck?.metadata?.incompleteTargets, ["linux-shell-agent"]);
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without one-file room bootstrap evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-bootstrap-evidence-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-bootstrap-evidence-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const target = evidence.targets.find((entry) => entry.id === "windows-powershell-agent");
  assert.ok(target && "checks" in target && target.checks);
  assert.ok(target && "evidence" in target && target.evidence);
  delete (target.checks as Record<string, unknown>).bootstrap;
  delete (target.evidence as Record<string, unknown>).inviteBundleKind;
  delete (target.evidence as Record<string, unknown>).inviteSignatureStatus;
  delete (target.evidence as Record<string, unknown>).joinedFromInviteBundle;
  delete (target.evidence as Record<string, unknown>).ranFromInviteBundle;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { incompleteTargets?: string[]; issuesByTarget?: Record<string, string[]> } }>;
  };
  const bootstrapCheck = parsed.checks?.find((check) => check.id === "one-file-room-bootstrap-evidence");
  assert.equal(parsed.status, "fail");
  assert.equal(bootstrapCheck?.status, "fail");
  assert.deepEqual(bootstrapCheck?.metadata?.incompleteTargets, ["windows-powershell-agent"]);
  assert.ok(bootstrapCheck?.metadata?.issuesByTarget?.["windows-powershell-agent"]?.includes("bootstrap"));
  assert.ok(bootstrapCheck?.metadata?.issuesByTarget?.["windows-powershell-agent"]?.includes("inviteBundleKind"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without control-plane event stream evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-event-stream-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-event-stream-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const control = (evidence.targets as Array<Record<string, unknown>>).find((target) => target.id === "control-plane-host");
  if (control && typeof control.checks === "object" && control.checks) {
    delete (control.checks as Record<string, unknown>).eventStream;
  }
  if (control && typeof control.evidence === "object" && control.evidence) {
    delete (control.evidence as Record<string, unknown>).eventStreamConnected;
    delete (control.evidence as Record<string, unknown>).eventStreamControlActionTypes;
    delete (control.evidence as Record<string, unknown>).eventStreamAgentIds;
  }
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const eventStreamCheck = parsed.checks?.find((check) => check.id === "control-plane-event-stream");
  assert.equal(parsed.status, "fail");
  assert.equal(eventStreamCheck?.status, "fail");
  assert.ok(eventStreamCheck?.metadata?.issues?.includes("eventStream"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without room message event stream evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-room-message-event-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-room-message-event-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const control = (evidence.targets as Array<Record<string, unknown>>).find((target) => target.id === "control-plane-host");
  if (control && typeof control.evidence === "object" && control.evidence) {
    delete (control.evidence as Record<string, unknown>).eventStreamRoomMessageEventTypes;
    delete (control.evidence as Record<string, unknown>).eventStreamRoomMessageIds;
  }
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const eventStreamCheck = parsed.checks?.find((check) => check.id === "control-plane-event-stream");
  assert.equal(parsed.status, "fail");
  assert.equal(eventStreamCheck?.status, "fail");
  assert.ok(eventStreamCheck?.metadata?.issues?.includes("roomMessageEventTypes"));
  assert.ok(eventStreamCheck?.metadata?.issues?.includes("roomMessageIds"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without delivery ack event stream evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-delivery-ack-event-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-delivery-ack-event-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const control = (evidence.targets as Array<Record<string, unknown>>).find((target) => target.id === "control-plane-host");
  if (control && typeof control.evidence === "object" && control.evidence) {
    delete (control.evidence as Record<string, unknown>).eventStreamDeliveryAckEventTypes;
    delete (control.evidence as Record<string, unknown>).eventStreamAckMessageIds;
  }
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const eventStreamCheck = parsed.checks?.find((check) => check.id === "control-plane-event-stream");
  assert.equal(parsed.status, "fail");
  assert.equal(eventStreamCheck?.status, "fail");
  assert.ok(eventStreamCheck?.metadata?.issues?.includes("deliveryAckEventTypes"));
  assert.ok(eventStreamCheck?.metadata?.issues?.includes("ackMessageIds"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects delivery ack event stream evidence missing delivery-status ack ids", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-delivery-ack-event-partial-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-delivery-ack-event-partial.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const control = (evidence.targets as Array<Record<string, unknown>>).find((target) => target.id === "control-plane-host");
  if (control && typeof control.evidence === "object" && control.evidence) {
    (control.evidence as Record<string, unknown>).eventStreamAckMessageIds = ["msg_windows_powershell_agent_task"];
  }
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const eventStreamCheck = parsed.checks?.find((check) => check.id === "control-plane-event-stream");
  assert.equal(parsed.status, "fail");
  assert.equal(eventStreamCheck?.status, "fail");
  assert.ok(eventStreamCheck?.metadata?.issues?.some((issue) => issue.startsWith("missingEventStreamAckMessageIds:")));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without room delivery status evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-delivery-status-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-delivery-status-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const control = (evidence.targets as Array<{ id?: string; evidence?: Record<string, unknown> }>).find((target) => target.id === "control-plane-host");
  assert.ok(control?.evidence);
  delete control.evidence.deliveryStatusAgentIds;
  delete control.evidence.deliveryStatusPendingCounts;
  delete control.evidence.deliveryStatusAckMessageIds;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const visibilityCheck = parsed.checks?.find((check) => check.id === "operator-room-visibility");
  assert.equal(parsed.status, "fail");
  assert.equal(visibilityCheck?.status, "fail");
  assert.ok(visibilityCheck?.metadata?.issues?.includes("deliveryStatusAgentIds"));
  assert.ok(visibilityCheck?.metadata?.issues?.includes("deliveryStatusAckMessageIds"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without stale agent recovery evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-stale-recovery-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-stale-recovery-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  delete (evidence.room as Record<string, unknown>).staleRecovery;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const recoveryCheck = parsed.checks?.find((check) => check.id === "stale-agent-recovery");
  assert.equal(parsed.status, "fail");
  assert.equal(recoveryCheck?.status, "fail");
  assert.ok(recoveryCheck?.metadata?.issues?.includes("missing"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without stale agent health evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-stale-agent-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-stale-agent-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  delete (evidence.room as Record<string, unknown>).staleAgent;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const staleAgentCheck = parsed.checks?.find((check) => check.id === "stale-agent-health-detected");
  assert.equal(parsed.status, "fail");
  assert.equal(staleAgentCheck?.status, "fail");
  assert.ok(staleAgentCheck?.metadata?.issues?.includes("missing"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without suspended agent block evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-suspended-agent-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-suspended-agent-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  delete (evidence.room as Record<string, unknown>).suspendedAgent;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const suspendedAgentCheck = parsed.checks?.find((check) => check.id === "suspended-agent-blocked");
  assert.equal(parsed.status, "fail");
  assert.equal(suspendedAgentCheck?.status, "fail");
  assert.ok(suspendedAgentCheck?.metadata?.issues?.includes("missing"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without revoked invite rejection evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-revoked-invite-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-revoked-invite-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  delete (evidence.room as Record<string, unknown>).revokedInvite;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const revokedInviteCheck = parsed.checks?.find((check) => check.id === "revoked-invite-join-blocked");
  assert.equal(parsed.status, "fail");
  assert.equal(revokedInviteCheck?.status, "fail");
  assert.ok(revokedInviteCheck?.metadata?.issues?.includes("missing"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without stop-file shutdown evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-stop-file-shutdown-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-stop-file-shutdown-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  delete (evidence.room as Record<string, unknown>).stopFileShutdown;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const stopFileCheck = parsed.checks?.find((check) => check.id === "runner-stop-file-shutdown");
  assert.equal(parsed.status, "fail");
  assert.equal(stopFileCheck?.status, "fail");
  assert.ok(stopFileCheck?.metadata?.issues?.includes("missing"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without runner status-file evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-runner-status-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-runner-status-missing.json");
  const remoteTargetIds = [
    "windows-powershell-agent",
    "windows-cmd-agent",
    "linux-shell-agent",
    "macos-shell-agent",
    "android-termux-agent",
  ];
  const evidence = {
    phase: "phase5",
    room: {
      id: "room_cross_machine",
      ownerAgentId: "agent_owner",
      controlPlaneHost: "control-plane-host",
      peerExchange: {
        senderTargetId: "windows-powershell-agent",
        receiverTargetId: "linux-shell-agent",
        senderAgentId: "agent_windows_powershell_agent",
        receiverAgentId: "agent_linux_shell_agent",
        messageId: "msg_peer_exchange",
        replyMessageId: "msg_peer_reply",
        receiverHandled: true,
        senderHandledReply: true,
        messageSignatureStatus: "valid",
        replySignatureStatus: "valid",
      },
    },
    targets: [
      {
        id: "control-plane-host",
        role: "control-plane",
        status: "pass",
        checks: {
          health: "pass",
          roomCreated: "pass",
          inviteCreated: "pass",
          transcriptVisible: "pass",
          stateRoomVisible: "pass",
          agentHealthVisible: "pass",
          eventStream: "pass",
        },
        evidence: {
          transcriptMessageCount: 8,
          stateRoomVisible: true,
          stateRoomMessageCount: 8,
          agentHealthVisible: true,
          eventStreamConnected: true,
          eventStreamControlActionTypes: ["control_plane.action"],
          eventStreamRoomMessageEventTypes: ["room.message.sent"],
          eventStreamRoomMessageIds: ["msg_phase5_task"],
          eventStreamAgentIds: [
            "agent_windows_powershell_agent",
            "agent_windows_cmd_agent",
            "agent_linux_shell_agent",
            "agent_macos_shell_agent",
            "agent_android_termux_agent",
          ],
          eventStreamDeliveryAckEventTypes: ["room.delivery.acknowledged"],
          eventStreamAckMessageIds: ["msg_phase5_task"],
          healthAgentIds: [
            "agent_windows_powershell_agent",
            "agent_windows_cmd_agent",
            "agent_linux_shell_agent",
            "agent_macos_shell_agent",
            "agent_android_termux_agent",
          ],
          roomHealthAgentIds: [
            "agent_windows_powershell_agent",
            "agent_windows_cmd_agent",
            "agent_linux_shell_agent",
            "agent_macos_shell_agent",
            "agent_android_termux_agent",
          ],
          responsiveAgentIds: [
            "agent_windows_powershell_agent",
            "agent_windows_cmd_agent",
            "agent_linux_shell_agent",
            "agent_macos_shell_agent",
            "agent_android_termux_agent",
          ],
        },
      },
      ...remoteTargetIds.map((id) => ({
        id,
        role: "remote-agent",
        status: "pass",
        agentId: `agent_${id.replace(/-/g, "_")}`,
        checks: {
          install: "pass",
          bootstrap: "pass",
          enroll: "pass",
          inbox: "pass",
          heartbeat: "pass",
          remoteRun: "pass",
          servicePlan: "pass",
          reply: "pass",
        },
        evidence: {
          messagesProcessed: 1,
          ackSigned: true,
          heartbeatStatus: "idle",
          inviteBundleKind: "soloclaw.room_invite",
          inviteSignatureStatus: "valid",
          joinedFromInviteBundle: true,
          ranFromInviteBundle: true,
          remoteIntentSignatureStatus: "valid",
          replyMessageId: `msg_${id.replace(/-/g, "_")}`,
          runnerStatusFile: id === "windows-powershell-agent" ? "" : ".agent/tmp/phase5-remote-room-status.json",
          runnerStatusKind: id === "windows-powershell-agent" ? "unknown" : "soloclaw.remote_room_runner_status",
          runnerStatus: id === "windows-powershell-agent" ? "unknown" : "stopped",
          runnerStopReason: id === "windows-powershell-agent" ? "unknown" : "idle",
          runnerLastHeartbeatStatus: id === "windows-powershell-agent" ? "unknown" : "idle",
          runnerLastHeartbeatAt: id === "windows-powershell-agent" ? "" : "2026-06-21T00:00:30.000Z",
          runnerHeartbeatExpiresAt: id === "windows-powershell-agent" ? "" : "2026-06-21T00:01:30.000Z",
          runnerLifecyclePhase: id === "windows-powershell-agent" ? "unknown" : "stopped",
          runnerMetricTickCount: id === "windows-powershell-agent" ? 0 : 2,
          runnerMetricMessagesProcessed: id === "windows-powershell-agent" ? 0 : 1,
        },
      })),
    ],
  };
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { incompleteTargets?: string[] } }>;
  };
  const runnerStatusCheck = parsed.checks?.find((check) => check.id === "runner-status-file-evidence");
  assert.equal(parsed.status, "fail");
  assert.equal(runnerStatusCheck?.status, "fail");
  assert.deepEqual(runnerStatusCheck?.metadata?.incompleteTargets, ["windows-powershell-agent"]);
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without runner heartbeat and lifecycle status evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-runner-observability-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-runner-observability-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const target = evidence.targets.find((entry) => entry.id === "windows-powershell-agent");
  assert.ok(target && "evidence" in target && target.evidence);
  delete (target.evidence as Record<string, unknown>).runnerLastHeartbeatStatus;
  delete (target.evidence as Record<string, unknown>).runnerLastHeartbeatAt;
  delete (target.evidence as Record<string, unknown>).runnerHeartbeatExpiresAt;
  delete (target.evidence as Record<string, unknown>).runnerLifecyclePhase;
  delete (target.evidence as Record<string, unknown>).runnerMetricTickCount;
  delete (target.evidence as Record<string, unknown>).runnerMetricMessagesProcessed;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { incompleteTargets?: string[] } }>;
  };
  const runnerStatusCheck = parsed.checks?.find((check) => check.id === "runner-status-file-evidence");
  assert.equal(parsed.status, "fail");
  assert.equal(runnerStatusCheck?.status, "fail");
  assert.deepEqual(runnerStatusCheck?.metadata?.incompleteTargets, ["windows-powershell-agent"]);
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence when the control plane cannot see remote agent health", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-operator-missing-health-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-operator-missing-health.json");
  const remoteTargetIds = [
    "windows-powershell-agent",
    "windows-cmd-agent",
    "linux-shell-agent",
    "macos-shell-agent",
    "android-termux-agent",
  ];
  const evidence = {
    phase: "phase5",
    room: {
      id: "room_cross_machine",
      ownerAgentId: "agent_owner",
      controlPlaneHost: "control-plane-host",
      peerExchange: {
        senderTargetId: "windows-powershell-agent",
        receiverTargetId: "linux-shell-agent",
        senderAgentId: "agent_windows_powershell_agent",
        receiverAgentId: "agent_linux_shell_agent",
        messageId: "msg_peer_exchange",
        replyMessageId: "msg_peer_reply",
        receiverHandled: true,
        senderHandledReply: true,
        messageSignatureStatus: "valid",
        replySignatureStatus: "valid",
      },
    },
    targets: [
      {
        id: "control-plane-host",
        role: "control-plane",
        status: "pass",
        checks: {
          health: "pass",
          roomCreated: "pass",
          inviteCreated: "pass",
          transcriptVisible: "pass",
          stateRoomVisible: "pass",
          agentHealthVisible: "pass",
          eventStream: "pass",
        },
        evidence: {
          transcriptMessageCount: 8,
          stateRoomVisible: true,
          stateRoomMessageCount: 8,
          agentHealthVisible: true,
          eventStreamConnected: true,
          eventStreamControlActionTypes: ["control_plane.action"],
          eventStreamRoomMessageEventTypes: ["room.message.sent"],
          eventStreamRoomMessageIds: ["msg_phase5_task"],
          eventStreamAgentIds: [
            "agent_windows_powershell_agent",
            "agent_windows_cmd_agent",
            "agent_linux_shell_agent",
            "agent_macos_shell_agent",
            "agent_android_termux_agent",
          ],
          eventStreamDeliveryAckEventTypes: ["room.delivery.acknowledged"],
          eventStreamAckMessageIds: ["msg_phase5_task"],
          healthAgentIds: [
            "agent_windows_powershell_agent",
            "agent_windows_cmd_agent",
            "agent_linux_shell_agent",
            "agent_macos_shell_agent",
          ],
          roomHealthAgentIds: [
            "agent_windows_powershell_agent",
            "agent_windows_cmd_agent",
            "agent_linux_shell_agent",
            "agent_macos_shell_agent",
          ],
          responsiveAgentIds: [
            "agent_windows_powershell_agent",
            "agent_windows_cmd_agent",
            "agent_linux_shell_agent",
            "agent_macos_shell_agent",
          ],
        },
      },
      ...remoteTargetIds.map((id) => ({
        id,
        role: "remote-agent",
        status: "pass",
        agentId: `agent_${id.replace(/-/g, "_")}`,
        checks: {
          install: "pass",
          bootstrap: "pass",
          enroll: "pass",
          inbox: "pass",
          heartbeat: "pass",
          remoteRun: "pass",
          servicePlan: "pass",
          reply: "pass",
        },
        evidence: {
          messagesProcessed: 1,
          ackSigned: true,
          heartbeatStatus: "idle",
          inviteBundleKind: "soloclaw.room_invite",
          inviteSignatureStatus: "valid",
          joinedFromInviteBundle: true,
          ranFromInviteBundle: true,
          remoteIntentSignatureStatus: "valid",
          replyMessageId: `msg_${id.replace(/-/g, "_")}`,
          runnerStatusFile: ".agent/tmp/phase5-remote-room-status.json",
          runnerStatusKind: "soloclaw.remote_room_runner_status",
          runnerStatus: "stopped",
          runnerStopReason: "idle",
          runnerLastHeartbeatStatus: "idle",
          runnerLastHeartbeatAt: "2026-06-21T00:00:30.000Z",
          runnerHeartbeatExpiresAt: "2026-06-21T00:01:30.000Z",
          runnerLifecyclePhase: "stopped",
          runnerMetricTickCount: 2,
          runnerMetricMessagesProcessed: 1,
          servicePlanKind: "soloclaw.remote_room_service_plan",
          servicePlanInstallState: "plan_only",
        },
      })),
    ],
  };
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const visibilityCheck = parsed.checks?.find((check) => check.id === "operator-room-visibility");
  assert.equal(parsed.status, "fail");
  assert.equal(visibilityCheck?.status, "fail");
  assert.ok(visibilityCheck?.metadata?.issues?.includes("missingHealthAgentIds:agent_android_termux_agent"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects peer exchange agent ids that do not match matrix targets", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-peer-mismatch-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-peer-mismatch.json");
  const remoteTargetIds = [
    "windows-powershell-agent",
    "windows-cmd-agent",
    "linux-shell-agent",
    "macos-shell-agent",
    "android-termux-agent",
  ];
  const evidence = {
    phase: "phase5",
    room: {
      id: "room_cross_machine",
      ownerAgentId: "agent_owner",
      controlPlaneHost: "control-plane-host",
      peerExchange: {
        senderTargetId: "windows-powershell-agent",
        receiverTargetId: "linux-shell-agent",
        senderAgentId: "agent_wrong_sender",
        receiverAgentId: "agent_linux_shell_agent",
        messageId: "msg_peer_exchange",
        replyMessageId: "msg_peer_reply",
        receiverHandled: true,
        senderHandledReply: true,
        messageSignatureStatus: "valid",
        replySignatureStatus: "valid",
      },
    },
    targets: [
      {
        id: "control-plane-host",
        role: "control-plane",
        status: "pass",
        checks: {
          health: "pass",
          roomCreated: "pass",
          inviteCreated: "pass",
          transcriptVisible: "pass",
        },
      },
      ...remoteTargetIds.map((id) => ({
        id,
        role: "remote-agent",
        status: "pass",
        agentId: `agent_${id.replace(/-/g, "_")}`,
        checks: {
          install: "pass",
          bootstrap: "pass",
          enroll: "pass",
          inbox: "pass",
          heartbeat: "pass",
          remoteRun: "pass",
          reply: "pass",
        },
        evidence: {
          messagesProcessed: 1,
          ackSigned: true,
          heartbeatStatus: "idle",
          inviteBundleKind: "soloclaw.room_invite",
          inviteSignatureStatus: "valid",
          joinedFromInviteBundle: true,
          ranFromInviteBundle: true,
          remoteIntentSignatureStatus: "valid",
          replyMessageId: `msg_${id.replace(/-/g, "_")}`,
          runnerStatusFile: ".agent/tmp/phase5-remote-room-status.json",
          runnerStatusKind: "soloclaw.remote_room_runner_status",
          runnerStatus: "stopped",
          runnerStopReason: "idle",
          runnerLastHeartbeatStatus: "idle",
          runnerLastHeartbeatAt: "2026-06-21T00:00:30.000Z",
          runnerHeartbeatExpiresAt: "2026-06-21T00:01:30.000Z",
          runnerLifecyclePhase: "stopped",
          runnerMetricTickCount: 2,
          runnerMetricMessagesProcessed: 1,
          servicePlanKind: "soloclaw.remote_room_service_plan",
          servicePlanInstallState: "plan_only",
        },
      })),
    ],
  };
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const peerCheck = parsed.checks?.find((check) => check.id === "agent-to-agent-exchange");
  assert.equal(parsed.status, "fail");
  assert.equal(peerCheck?.status, "fail");
  assert.ok(peerCheck?.metadata?.issues?.includes("senderAgentTargetMismatch"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without no-broadcast fallback evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-no-broadcast-fallback-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-no-broadcast-fallback-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  delete (evidence.room as Record<string, unknown>).noBroadcastFallback;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const noBroadcastCheck = parsed.checks?.find((check) => check.id === "no-broadcast-fallback-execution-evidence");
  assert.equal(parsed.status, "fail");
  assert.equal(noBroadcastCheck?.status, "fail");
  assert.ok(noBroadcastCheck?.metadata?.issues?.includes("missing"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects no-broadcast fallback evidence missing the room message event summary", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-no-broadcast-event-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-no-broadcast-event-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const controlHost = (evidence.targets as Array<Record<string, unknown>>).find((target) => target.id === "control-plane-host");
  if (controlHost && typeof controlHost.evidence === "object" && controlHost.evidence) {
    (controlHost.evidence as Record<string, unknown>).eventStreamRoomMessageIds = ["msg_phase5_task"];
  }
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const noBroadcastCheck = parsed.checks?.find((check) => check.id === "no-broadcast-fallback-execution-evidence");
  assert.equal(parsed.status, "fail");
  assert.equal(noBroadcastCheck?.status, "fail");
  assert.ok(noBroadcastCheck?.metadata?.issues?.includes("eventStreamRoomMessageId"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without room assignment result evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-assignment-result-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-assignment-result-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  delete (evidence.room as Record<string, unknown>).assignmentResult;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const assignmentCheck = parsed.checks?.find((check) => check.id === "room-assignment-result-evidence");
  assert.equal(parsed.status, "fail");
  assert.equal(assignmentCheck?.status, "fail");
  assert.ok(assignmentCheck?.metadata?.issues?.includes("missing"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without room conflict resolution evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-conflict-resolution-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-conflict-resolution-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  delete (evidence.room as Record<string, unknown>).conflictResolution;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const conflictCheck = parsed.checks?.find((check) => check.id === "room-conflict-resolution-evidence");
  assert.equal(parsed.status, "fail");
  assert.equal(conflictCheck?.status, "fail");
  assert.ok(conflictCheck?.metadata?.issues?.includes("missing"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without room result sync evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-result-sync-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-result-sync-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  delete (evidence.room as Record<string, unknown>).resultSync;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const resultSyncCheck = parsed.checks?.find((check) => check.id === "room-result-sync-evidence");
  assert.equal(parsed.status, "fail");
  assert.equal(resultSyncCheck?.status, "fail");
  assert.ok(resultSyncCheck?.metadata?.issues?.includes("missing"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without room handoff evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-handoff-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-handoff-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  delete (evidence.room as Record<string, unknown>).handoff;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const handoffCheck = parsed.checks?.find((check) => check.id === "room-handoff-evidence");
  assert.equal(parsed.status, "fail");
  assert.equal(handoffCheck?.status, "fail");
  assert.ok(handoffCheck?.metadata?.issues?.includes("missing"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without registered-agent pull communication evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-registered-pull-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-registered-pull-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  delete (evidence.room as Record<string, unknown>).registeredAgentPull;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const registeredPullCheck = parsed.checks?.find((check) => check.id === "registered-agent-pull-communication-evidence");
  assert.equal(parsed.status, "fail");
  assert.equal(registeredPullCheck?.status, "fail");
  assert.ok(registeredPullCheck?.metadata?.issues?.includes("missing"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check does not report registered-pull agent mismatch for untouched placeholders", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-registered-pull-placeholder-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const evidencePath = path.join(workspace, "phase5-registered-pull-placeholder.json");
  const template = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--registered-pull-target",
    "linux-shell-agent",
    "--json",
  ], workspace);
  assert.equal(template.exitCode, 0, template.stderr);
  await fs.writeFile(evidencePath, template.stdout, "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[]; targetId?: string; agentId?: string; targetAgentId?: string } }>;
    missingEvidence?: Array<{ checkId?: string; missing?: string[] }>;
  };
  const registeredPullCheck = parsed.checks?.find((check) => check.id === "registered-agent-pull-communication-evidence");
  assert.equal(parsed.status, "fail");
  assert.equal(registeredPullCheck?.status, "fail");
  assert.equal(registeredPullCheck?.metadata?.targetId, "linux-shell-agent");
  assert.equal(registeredPullCheck?.metadata?.agentId, "<registered-pull-agent-id>");
  assert.equal(registeredPullCheck?.metadata?.targetAgentId, "<agent-id>");
  assert.equal(registeredPullCheck?.metadata?.issues?.includes("agentTargetMismatch"), false);
  assert.equal(parsed.missingEvidence?.some((item) =>
    item.checkId === "registered-agent-pull-communication-evidence" &&
    item.missing?.includes("agentTargetMismatch")
  ), false);
  assert.doesNotMatch(result.stdout + template.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check does not report room agent mismatches for untouched placeholders", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-room-placeholder-mismatch-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const evidencePath = path.join(workspace, "phase5-room-placeholder-mismatch.json");
  const template = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-template",
    "--json",
  ], workspace);
  assert.equal(template.exitCode, 0, template.stderr);
  await fs.writeFile(evidencePath, template.stdout, "utf8");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
    missingEvidence?: Array<{ checkId?: string; missing?: string[] }>;
  };
  const issuesFor = (checkId: string) => parsed.checks?.find((check) => check.id === checkId)?.metadata?.issues ?? [];
  const missingFor = (checkId: string) => parsed.missingEvidence?.find((item) => item.checkId === checkId)?.missing ?? [];
  const expectations: Array<{ checkId: string; absentIssues: string[] }> = [
    { checkId: "revoked-agent-signed-ops-blocked", absentIssues: ["agentTargetMismatch"] },
    { checkId: "room-key-rotation-evidence", absentIssues: ["agentTargetMismatch"] },
    { checkId: "suspended-agent-blocked", absentIssues: ["agentTargetMismatch"] },
    { checkId: "stale-agent-health-detected", absentIssues: ["agentTargetMismatch"] },
    { checkId: "stale-agent-recovery", absentIssues: ["agentTargetMismatch"] },
    { checkId: "agent-to-agent-exchange", absentIssues: ["senderAgentTargetMismatch", "receiverAgentTargetMismatch"] },
    { checkId: "room-assignment-result-evidence", absentIssues: ["agentTargetMismatch"] },
    { checkId: "room-conflict-resolution-evidence", absentIssues: ["primaryAgentTargetMismatch", "conflictingAgentTargetMismatch"] },
    { checkId: "room-result-sync-evidence", absentIssues: ["agentTargetMismatch"] },
    { checkId: "room-handoff-evidence", absentIssues: ["sourceAgentTargetMismatch", "targetAgentTargetMismatch"] },
  ];
  assert.equal(parsed.status, "fail");
  for (const expectation of expectations) {
    const checkIssues = issuesFor(expectation.checkId);
    const missingIssues = missingFor(expectation.checkId);
    for (const issue of expectation.absentIssues) {
      assert.equal(checkIssues.includes(issue), false, `${expectation.checkId} reported ${issue}`);
      assert.equal(missingIssues.includes(issue), false, `${expectation.checkId} missingEvidence reported ${issue}`);
    }
  }
  assert.doesNotMatch(result.stdout + template.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects registered-agent pull evidence whose agent id belongs to another target", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-registered-pull-agent-mismatch-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-registered-pull-agent-mismatch.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  const room = evidence.room as { registeredAgentPull?: { agentId?: string } };
  assert.ok(room.registeredAgentPull);
  room.registeredAgentPull.agentId = "agent_linux_shell_agent";
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[]; targetId?: string; agentId?: string; targetAgentId?: string } }>;
    missingEvidence?: Array<{ scope?: string; targetId?: string; checkId?: string; missing?: string[] }>;
  };
  const registeredPullCheck = parsed.checks?.find((check) => check.id === "registered-agent-pull-communication-evidence");
  assert.equal(parsed.status, "fail");
  assert.equal(registeredPullCheck?.status, "fail");
  assert.equal(registeredPullCheck?.metadata?.targetId, "macos-shell-agent");
  assert.equal(registeredPullCheck?.metadata?.agentId, "agent_linux_shell_agent");
  assert.equal(registeredPullCheck?.metadata?.targetAgentId, "agent_macos_shell_agent");
  assert.ok(registeredPullCheck?.metadata?.issues?.includes("agentTargetMismatch"));
  assert.ok(parsed.missingEvidence?.some((item) =>
    item.scope === "target" &&
    item.targetId === "macos-shell-agent" &&
    item.checkId === "registered-agent-pull-communication-evidence" &&
    item.missing?.includes("agentTargetMismatch")
  ));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

test("phase5 evidence-check rejects matrix evidence without room key rotation evidence", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase5-key-rotation-missing-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const evidencePath = path.join(workspace, "phase5-key-rotation-missing.json");
  const evidence = buildCompletePhaseFiveMatrixEvidenceForTest();
  delete (evidence.room as Record<string, unknown>).keyRotation;
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");

  const result = await run(process.execPath, [
    cli,
    "phase5",
    "evidence-check",
    "--file",
    evidencePath,
    "--json",
  ], workspace);

  assert.equal(result.exitCode, 1);
  const parsed = JSON.parse(result.stdout) as {
    status?: string;
    checks?: Array<{ id?: string; status?: string; metadata?: { issues?: string[] } }>;
  };
  const keyRotationCheck = parsed.checks?.find((check) => check.id === "room-key-rotation-evidence");
  assert.equal(parsed.status, "fail");
  assert.equal(keyRotationCheck?.status, "fail");
  assert.ok(keyRotationCheck?.metadata?.issues?.includes("missing"));
  assert.doesNotMatch(result.stdout, /phase5-control-token|rinv_[A-Za-z0-9_-]+|BEGIN (?:OPENSSH|PRIVATE) KEY/);
});

function run(command: string, args: string[], cwd: string): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: { ...process.env, SOLOCLAW_HOME: path.join(cwd, ".agent") } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function buildCompletePhaseFiveMatrixEvidenceForTest() {
  const remoteTargetIds = [
    "windows-powershell-agent",
    "windows-cmd-agent",
    "linux-shell-agent",
    "macos-shell-agent",
    "android-termux-agent",
  ];
  const remoteAgentIds = remoteTargetIds.map((id) => `agent_${id.replace(/-/g, "_")}`);
  const deliveryStatusAckMessageIds = remoteTargetIds.map((id) => `msg_${id.replace(/-/g, "_")}_task`);
  return {
    phase: "phase5",
    room: {
      id: "room_cross_machine",
      ownerAgentId: "agent_owner",
      controlPlaneHost: "control-plane-host",
      peerExchange: {
        senderTargetId: "windows-powershell-agent",
        receiverTargetId: "linux-shell-agent",
        senderAgentId: "agent_windows_powershell_agent",
        receiverAgentId: "agent_linux_shell_agent",
        messageId: "msg_peer_exchange",
        replyMessageId: "msg_peer_reply",
        receiverHandled: true,
        senderHandledReply: true,
        messageSignatureStatus: "valid",
        replySignatureStatus: "valid",
      },
      assignmentResult: {
        targetId: "windows-powershell-agent",
        agentId: "agent_windows_powershell_agent",
        subtaskId: "subtask_room_assignment",
        childSessionId: "sess_room_assignment_child",
        assignmentMessageId: "msg_room_assignment",
        resultMessageId: "msg_room_assignment_result",
        assignmentMessageVisible: true,
        resultMessageVisible: true,
        resultStatus: "completed",
        transcriptEventKinds: ["task", "decision"],
      },
      conflictResolution: {
        resultKey: "phase5-shared-result",
        primaryTargetId: "windows-powershell-agent",
        primaryAgentId: "agent_windows_powershell_agent",
        primaryMessageId: "msg_conflict_primary",
        conflictingTargetId: "linux-shell-agent",
        conflictingAgentId: "agent_linux_shell_agent",
        conflictingMessageId: "msg_conflict_secondary",
        resolutionMessageId: "msg_conflict_resolution",
        resolvedByAgentId: "agent_owner",
        winningAgentId: "agent_linux_shell_agent",
        conflictDetected: true,
        resolutionRecorded: true,
        resolutionStatus: "resolved",
        transcriptEventKinds: ["artifact", "decision"],
      },
      resultSync: {
        targetId: "linux-shell-agent",
        agentId: "agent_linux_shell_agent",
        artifactId: "art_phase5_result_sync",
        artifactKind: "report",
        artifactName: "phase5-result-sync.json",
        artifactRoomId: "room_cross_machine",
        artifactStatus: "active",
        artifactSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        artifactSizeBytes: 96,
        artifactRegistered: true,
        artifactMessageId: "msg_result_sync_artifact",
        artifactMessageVisible: true,
        transcriptEventKinds: ["artifact"],
      },
      handoff: {
        handoffId: "handoff_phase5_cross_machine",
        sourceTargetId: "windows-powershell-agent",
        sourceAgentId: "agent_windows_powershell_agent",
        targetTargetId: "linux-shell-agent",
        targetAgentId: "agent_linux_shell_agent",
        handoffMessageId: "msg_handoff_request",
        acceptanceMessageId: "msg_handoff_acceptance",
        resultMessageId: "msg_handoff_result",
        handoffMessageVisible: true,
        acceptanceMessageVisible: true,
        resultMessageVisible: true,
        handoffAccepted: true,
        handoffCompleted: true,
        resultStatus: "completed",
        transcriptEventKinds: ["task", "decision"],
      },
      registeredAgentPull: {
        targetId: "macos-shell-agent",
        agentId: "agent_macos_shell_agent",
        registered: true,
        invitationListed: true,
        accepted: true,
        role: "executor",
        aliases: ["phase5-macos-pulled"],
        taskMessageId: "msg_registered_pull_task",
        replyMessageId: "msg_registered_pull_reply",
        handledMessages: ["msg_registered_pull_task"],
        messagesProcessed: 1,
        ackSigned: true,
        replySignatureStatus: "valid",
        heartbeatStatus: "idle",
        runStopReason: "idle",
        deliveryStatusPendingCount: 0,
        transcriptEventKinds: ["task", "chat"],
      },
      revokedInvite: {
        targetId: "windows-cmd-agent",
        agentId: "agent_windows_cmd_agent",
        joinBlocked: true,
        rejection: "Room invite is revoked",
      },
      revokedAgent: {
        targetId: "windows-cmd-agent",
        agentId: "agent_windows_cmd_agent",
        trustStatus: "revoked",
        trustUpdated: true,
        signedSayBlocked: true,
        signedAckBlocked: true,
        signedHeartbeatBlocked: true,
        rejection: "Agent trust status revoked does not allow signed room message intent.",
      },
      keyRotation: {
        targetId: "windows-powershell-agent",
        agentId: "agent_windows_powershell_agent",
        previousFingerprint: "SHA256:OLD-KEY",
        rotatedFingerprint: "SHA256:NEW-KEY",
        trustStatusAfter: "trusted",
        rotationRecorded: true,
        oldSignedSayBlocked: true,
        newSignedSayAccepted: true,
        auditEventVisible: true,
        transcriptMessageId: "msg_key_rotation_new_say",
        transcriptMessageVisible: true,
        rejection: "Invalid room message intent envelope signature: invalid",
        transcriptEventKinds: ["chat"],
      },
      suspendedAgent: {
        targetId: "macos-shell-agent",
        agentId: "agent_macos_shell_agent",
        status: "suspended",
        routedMessageId: "msg_suspended_probe",
        inboxMessageCount: 0,
        remoteSayBlocked: true,
        rejection: "room.message.send",
      },
      staleAgent: {
        targetId: "linux-shell-agent",
        agentId: "agent_linux_shell_agent",
        heartbeatStatus: "online",
        healthState: "stale",
        heartbeatExpired: true,
        responsive: false,
        lastRoomId: "room_cross_machine",
      },
      staleRecovery: {
        targetId: "linux-shell-agent",
        agentId: "agent_linux_shell_agent",
        recoveryKind: "soloclaw.agent_stale_recovery",
        recovered: true,
        memberStatusAfter: "suspended",
        heartbeatStatusAfter: "offline",
        healthStateAfter: "offline",
      },
      noBroadcastFallback: {
        messageId: "msg_no_broadcast_fallback",
        messageVisible: true,
        agentIds: remoteAgentIds,
        inboxCounts: Object.fromEntries(remoteAgentIds.map((agentId) => [agentId, 0])),
        runMessagesProcessed: Object.fromEntries(remoteAgentIds.map((agentId) => [agentId, 0])),
        deliveryStatusPendingCounts: Object.fromEntries(remoteAgentIds.map((agentId) => [agentId, 0])),
        transcriptEventKinds: ["chat"],
      },
      stopFileShutdown: {
        targetId: "windows-powershell-agent",
        agentId: "agent_windows_powershell_agent",
        stopFile: ".agent/tmp/phase5-remote-room.stop",
        runnerStatusFile: ".agent/tmp/phase5-remote-room-stop-status.json",
        runnerStatusKind: "soloclaw.remote_room_runner_status",
        runnerStatus: "stopped",
        runnerStopReason: "shutdown_requested",
      },
    },
    targets: [
      {
        id: "control-plane-host",
        role: "control-plane",
        status: "pass",
        checks: {
          health: "pass",
          roomCreated: "pass",
          inviteCreated: "pass",
          transcriptVisible: "pass",
          stateRoomVisible: "pass",
          agentHealthVisible: "pass",
          deliveryStatusVisible: "pass",
          eventStream: "pass",
        },
        evidence: {
          transcriptMessageCount: 8,
          stateRoomVisible: true,
          stateRoomMessageCount: 8,
          agentHealthVisible: true,
          deliveryStatusVisible: true,
          deliveryStatusAgentIds: remoteAgentIds,
          deliveryStatusPendingCounts: Object.fromEntries(remoteAgentIds.map((agentId) => [agentId, 0])),
          deliveryStatusAckMessageIds,
          eventStreamConnected: true,
          eventStreamControlActionTypes: ["control_plane.action"],
          eventStreamRoomMessageEventTypes: ["room.message.sent"],
          eventStreamRoomMessageIds: ["msg_phase5_task", "msg_no_broadcast_fallback"],
          eventStreamAgentIds: remoteAgentIds,
          eventStreamDeliveryAckEventTypes: ["room.delivery.acknowledged"],
          eventStreamAckMessageIds: deliveryStatusAckMessageIds,
          healthAgentIds: remoteAgentIds,
          roomHealthAgentIds: remoteAgentIds,
          responsiveAgentIds: remoteAgentIds,
        },
      },
      ...remoteTargetIds.map((id) => ({
        id,
        role: "remote-agent",
        status: "pass",
        agentId: `agent_${id.replace(/-/g, "_")}`,
        checks: {
          install: "pass",
          bootstrap: "pass",
          enroll: "pass",
          inbox: "pass",
          heartbeat: "pass",
          remoteRun: "pass",
          servicePlan: "pass",
          reply: "pass",
        },
        evidence: {
          messagesProcessed: 1,
          ackSigned: true,
          heartbeatStatus: "idle",
          inviteBundleKind: "soloclaw.room_invite",
          inviteSignatureStatus: "valid",
          joinedFromInviteBundle: true,
          ranFromInviteBundle: true,
          remoteIntentSignatureStatus: "valid",
          replyMessageId: `msg_${id.replace(/-/g, "_")}`,
          runnerStatusFile: ".agent/tmp/phase5-remote-room-status.json",
          runnerStatusKind: "soloclaw.remote_room_runner_status",
          runnerStatus: "stopped",
          runnerStopReason: "idle",
          runnerLastHeartbeatStatus: "idle",
          runnerLastHeartbeatAt: "2026-06-21T00:00:30.000Z",
          runnerHeartbeatExpiresAt: "2026-06-21T00:01:30.000Z",
          runnerLifecyclePhase: "stopped",
          runnerMetricTickCount: 2,
          runnerMetricMessagesProcessed: 1,
          servicePlanKind: "soloclaw.remote_room_service_plan",
          servicePlanInstallState: "plan_only",
        },
      })),
    ],
  };
}

function signRemoteMessageIntent(input: {
  roomId: string;
  agentId: string;
  kind: RoomMessageIntentEnvelope["kind"];
  body: string;
  sentBy: RoomMessageIntentEnvelope["sentBy"];
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
}): RoomMessageIntentEnvelope {
  const unsigned: Omit<RoomMessageIntentEnvelope, "signature"> = {
    version: 1,
    roomId: input.roomId as RoomMessageIntentEnvelope["roomId"],
    agentId: input.agentId as RoomMessageIntentEnvelope["agentId"],
    kind: input.kind,
    body: input.body,
    sentAt: "2026-06-21T00:00:00.000Z",
    sentBy: input.sentBy,
    nonce: "nonce_remote_message_intent",
  };
  const signature = sign(null, Buffer.from(roomMessageIntentEnvelopeSigningPayload(unsigned), "utf8"), input.privateKey);
  return { ...unsigned, signature: `ed25519:${signature.toString("base64")}` };
}

function signRemoteDeliveryAck(input: {
  roomId: string;
  agentId: string;
  messageId: string;
  acknowledgedBy: ActorRef;
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
}): RoomDeliveryAckEnvelope {
  const unsigned: Omit<RoomDeliveryAckEnvelope, "signature"> = {
    version: 1,
    roomId: input.roomId as RoomDeliveryAckEnvelope["roomId"],
    agentId: input.agentId,
    messageId: input.messageId,
    acknowledgedAt: "2026-06-22T00:00:01.000Z",
    acknowledgedBy: input.acknowledgedBy,
    nonce: `nonce_${input.messageId}`,
  };
  const signature = sign(null, Buffer.from(roomDeliveryAckEnvelopeSigningPayload(unsigned), "utf8"), input.privateKey);
  return { ...unsigned, signature: `ed25519:${signature.toString("base64")}` };
}

function signRemoteHeartbeat(input: {
  roomId: string;
  agentId: string;
  machineId: string;
  status: AgentHeartbeatEnvelope["status"];
  heartbeatBy: ActorRef;
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
}): AgentHeartbeatEnvelope {
  const unsigned: Omit<AgentHeartbeatEnvelope, "signature"> = {
    version: 1,
    agentId: input.agentId as AgentHeartbeatEnvelope["agentId"],
    machineId: input.machineId as AgentHeartbeatEnvelope["machineId"],
    status: input.status,
    roomId: input.roomId as AgentHeartbeatEnvelope["roomId"],
    heartbeatAt: "2026-06-22T00:00:02.000Z",
    expiresAt: "2026-06-22T00:01:02.000Z",
    heartbeatBy: input.heartbeatBy,
    nonce: "nonce_remote_revoked_heartbeat",
  };
  const signature = sign(null, Buffer.from(agentHeartbeatEnvelopeSigningPayload(unsigned), "utf8"), input.privateKey);
  return { ...unsigned, signature: `ed25519:${signature.toString("base64")}` };
}

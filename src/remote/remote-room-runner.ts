import { randomUUID } from "node:crypto";
import { DaemonLifecycleController } from "../daemon/daemon-lifecycle.js";
import type { DaemonLifecycleSnapshot, DaemonLoopMetrics } from "../daemon/daemon-lifecycle.js";
import type { AgentHeartbeatEnvelope, AgentHeartbeatStatus, RoomDeliveryAckEnvelope, RoomMessage, RoomMessageIntentEnvelope, RoomMessageKind } from "../domain/index.js";
import type { RoomActivationContext } from "../rooms/message-routing.js";

export type RemoteRoomInboxMessage = {
  id: string;
  kind: string;
  body: string;
  createdAt: string;
  signatureStatus?: string;
  activationContext?: RoomActivationContext;
};

export type RemoteRoomInbox = {
  messages: RemoteRoomInboxMessage[];
  cursor?: { lastDeliveredMessageId?: string };
};

export type RemoteRoomAckResult = {
  cursor: {
    roomId: string;
    agentId: string;
    lastDeliveredMessageId?: string;
    lastAckEnvelope?: RoomDeliveryAckEnvelope;
  };
};

export type RemoteAgentHeartbeatResult = {
  agent: {
    id: string;
    machineId: string;
    heartbeatStatus?: AgentHeartbeatStatus;
    lastHeartbeatAt?: string;
    heartbeatExpiresAt?: string;
    lastRoomId?: string;
    lastError?: string;
  };
};

export type RemoteAgentHeartbeatInput = {
  status: AgentHeartbeatStatus;
  ttlSeconds?: number;
  lastPollStopReason?: string;
  messagesProcessed?: number;
  errorCount?: number;
  lastError?: string;
  metadata?: Record<string, unknown>;
};

export type RemoteRoomHeartbeatSummary = {
  agentId: string;
  machineId: string;
  status?: AgentHeartbeatStatus;
  lastHeartbeatAt?: string;
  heartbeatExpiresAt?: string;
  lastRoomId?: string;
  lastError?: string;
};

export type RemoteRoomSayResult = {
  message: RoomMessage;
};

export type RemoteRoomPollResult = {
  roomId: string;
  agentId: string;
  stopReason: "limit_reached" | "idle" | "aborted";
  messagesProcessed: number;
  idlePolls: number;
  acknowledgements: Array<{
    messageId: string;
    signatureStatus?: string;
    ackSignature?: string;
  }>;
};

export type RemoteRoomRunResult = {
  roomId: string;
  agentId: string;
  stopReason: "max_cycles" | "idle" | "max_errors" | "aborted" | "shutdown_requested";
  cycles: number;
  idleCycles: number;
  errors: Array<{
    cycle: number;
    message: string;
    occurredAt: string;
  }>;
  messagesProcessed: number;
  acknowledgements: RemoteRoomPollResult["acknowledgements"];
  polls: RemoteRoomPollResult[];
  lastHeartbeat?: RemoteRoomHeartbeatSummary;
  lifecycle: DaemonLifecycleSnapshot;
  metrics: DaemonLoopMetrics;
};

export type RemoteRoomRunnerIdentity = {
  signRoomDeliveryAckEnvelope(envelope: Omit<RoomDeliveryAckEnvelope, "signature">): Promise<string | undefined>;
  signAgentHeartbeatEnvelope(envelope: Omit<AgentHeartbeatEnvelope, "signature">): Promise<string | undefined>;
  signRoomMessageIntentEnvelope(envelope: Omit<RoomMessageIntentEnvelope, "signature">): Promise<string | undefined>;
};

export type RemoteRoomRunnerAgent = {
  id: string;
  machineId: string;
  displayName: string;
};

export type RemoteRoomRunnerOptions = {
  controlUrl: string;
  token: string;
  roomId: string;
  identity: RemoteRoomRunnerIdentity;
  localAgent: RemoteRoomRunnerAgent;
};

export class RemoteRoomRunner {
  constructor(private readonly options: RemoteRoomRunnerOptions) {}

  async inbox(input: { limit: number; includeDelivered?: boolean }): Promise<RemoteRoomInbox> {
    const query = new URLSearchParams({
      agentId: this.options.localAgent.id,
      limit: String(input.limit),
    });
    if (input.includeDelivered) {
      query.set("includeDelivered", "true");
    }
    return controlPlaneGetJson<RemoteRoomInbox>(
      this.options.controlUrl,
      `/api/rooms/${encodeURIComponent(this.options.roomId)}/agent-inbox?${query.toString()}`,
      this.options.token,
    );
  }

  async latestInboxMessageId(): Promise<string | undefined> {
    const inbox = await this.inbox({ limit: 1 });
    return inbox.messages.at(-1)?.id;
  }

  async ack(messageId: string): Promise<RemoteRoomAckResult> {
    const actor = agentActor(this.options.localAgent);
    const acknowledgedAt = new Date().toISOString();
    const unsigned: Omit<RoomDeliveryAckEnvelope, "signature"> = {
      version: 1,
      roomId: this.options.roomId as RoomDeliveryAckEnvelope["roomId"],
      agentId: this.options.localAgent.id,
      messageId,
      acknowledgedAt,
      acknowledgedBy: actor,
      nonce: randomUUID(),
    };
    const signature = await this.options.identity.signRoomDeliveryAckEnvelope(unsigned);
    if (!signature) {
      throw new Error("Failed to sign remote room delivery ack envelope.");
    }
    const ackEnvelope: RoomDeliveryAckEnvelope = { ...unsigned, signature };
    return controlPlanePostJson<RemoteRoomAckResult>(
      this.options.controlUrl,
      `/api/rooms/${encodeURIComponent(this.options.roomId)}/agent-inbox/ack`,
      this.options.token,
      {
        actor: `agent:${this.options.localAgent.id}`,
        agentId: this.options.localAgent.id,
        messageId,
        ackEnvelope,
      },
    );
  }

  async heartbeat(input: RemoteAgentHeartbeatInput): Promise<RemoteAgentHeartbeatResult> {
    const actor = agentActor(this.options.localAgent);
    const now = new Date();
    const heartbeatAt = now.toISOString();
    const expiresAt = input.ttlSeconds ? new Date(now.getTime() + input.ttlSeconds * 1000).toISOString() : undefined;
    const unsigned: Omit<AgentHeartbeatEnvelope, "signature"> = {
      version: 1,
      agentId: this.options.localAgent.id as AgentHeartbeatEnvelope["agentId"],
      machineId: this.options.localAgent.machineId as AgentHeartbeatEnvelope["machineId"],
      status: input.status,
      roomId: this.options.roomId as AgentHeartbeatEnvelope["roomId"],
      heartbeatAt,
      expiresAt,
      lastPollStopReason: input.lastPollStopReason,
      messagesProcessed: input.messagesProcessed,
      errorCount: input.errorCount,
      lastError: input.lastError,
      metadata: input.metadata,
      heartbeatBy: actor,
      nonce: randomUUID(),
    };
    const signature = await this.options.identity.signAgentHeartbeatEnvelope(unsigned);
    if (!signature) {
      throw new Error("Failed to sign remote agent heartbeat envelope.");
    }
    const heartbeatEnvelope: AgentHeartbeatEnvelope = { ...unsigned, signature };
    return controlPlanePostJson<RemoteAgentHeartbeatResult>(
      this.options.controlUrl,
      `/api/agents/${encodeURIComponent(this.options.localAgent.id)}/heartbeat`,
      this.options.token,
      {
        actor: `agent:${this.options.localAgent.id}`,
        status: input.status,
        roomId: this.options.roomId,
        ttlSeconds: input.ttlSeconds,
        lastPollStopReason: input.lastPollStopReason,
        messagesProcessed: input.messagesProcessed,
        errorCount: input.errorCount,
        lastError: input.lastError,
        metadata: input.metadata,
        heartbeatEnvelope,
      },
    );
  }

  async say(input: { kind?: RoomMessageKind; body: string }): Promise<RemoteRoomSayResult> {
    const actor = agentActor(this.options.localAgent);
    const kind = input.kind ?? "chat";
    const unsigned: Omit<RoomMessageIntentEnvelope, "signature"> = {
      version: 1,
      roomId: this.options.roomId as RoomMessageIntentEnvelope["roomId"],
      agentId: this.options.localAgent.id as RoomMessageIntentEnvelope["agentId"],
      kind,
      body: input.body,
      sentAt: new Date().toISOString(),
      sentBy: actor,
      nonce: randomUUID(),
    };
    const signature = await this.options.identity.signRoomMessageIntentEnvelope(unsigned);
    if (!signature) {
      throw new Error("Failed to sign remote room message intent envelope.");
    }
    const messageEnvelope: RoomMessageIntentEnvelope = { ...unsigned, signature };
    return controlPlanePostJson<RemoteRoomSayResult>(
      this.options.controlUrl,
      `/api/rooms/${encodeURIComponent(this.options.roomId)}/messages`,
      this.options.token,
      {
        actor: `agent:${this.options.localAgent.id}`,
        kind,
        body: input.body,
        messageEnvelope,
      },
    );
  }

  async poll(input: {
    maxMessages: number;
    maxIdlePolls: number;
    idleIntervalMs: number;
    onMessage?: (message: RemoteRoomInboxMessage, ack: RemoteRoomAckResult) => void | Promise<void>;
    signal?: AbortSignal;
  }): Promise<RemoteRoomPollResult> {
    const acknowledgements: RemoteRoomPollResult["acknowledgements"] = [];
    let idlePolls = 0;

    while (acknowledgements.length < input.maxMessages) {
      if (input.signal?.aborted) {
        return this.pollResult("aborted", acknowledgements, idlePolls);
      }

      const remaining = input.maxMessages - acknowledgements.length;
      const inbox = await this.inbox({ limit: Math.max(1, remaining) });
      if (inbox.messages.length === 0) {
        idlePolls += 1;
        if (idlePolls >= input.maxIdlePolls) {
          return this.pollResult("idle", acknowledgements, idlePolls);
        }
        await sleepMilliseconds(input.idleIntervalMs, input.signal);
        continue;
      }

      idlePolls = 0;
      for (const message of inbox.messages) {
        if (acknowledgements.length >= input.maxMessages) {
          break;
        }
        if (input.signal?.aborted) {
          return this.pollResult("aborted", acknowledgements, idlePolls);
        }
        const ack = await this.ack(message.id);
        acknowledgements.push({
          messageId: message.id,
          signatureStatus: message.signatureStatus,
          ackSignature: ack.cursor.lastAckEnvelope?.signature,
        });
        await input.onMessage?.(message, ack);
      }
    }

    return this.pollResult("limit_reached", acknowledgements, idlePolls);
  }

  async run(input: {
    maxCycles: number;
    maxMessagesPerPoll: number;
    maxIdlePolls: number;
    idleIntervalMs: number;
    intervalMs: number;
    stopWhenIdle?: boolean;
    maxIdleCycles: number;
    baseBackoffMs: number;
    maxBackoffMs: number;
    maxErrors: number;
    heartbeatTtlSeconds?: number;
    onMessage?: (message: RemoteRoomInboxMessage, ack: RemoteRoomAckResult) => void | Promise<void>;
    onPoll?: (poll: RemoteRoomPollResult) => void | Promise<void>;
    onError?: (error: Error, cycle: number) => void | Promise<void>;
    signal?: AbortSignal;
    lifecycle?: DaemonLifecycleController;
  }): Promise<RemoteRoomRunResult> {
    const lifecycle = input.lifecycle ?? new DaemonLifecycleController("remote-room-runner");
    const polls: RemoteRoomPollResult[] = [];
    const acknowledgements: RemoteRoomPollResult["acknowledgements"] = [];
    const errors: RemoteRoomRunResult["errors"] = [];
    let cycles = 0;
    let idleCycles = 0;
    let consecutiveErrors = 0;
    let lastHeartbeat: RemoteRoomHeartbeatSummary | undefined;
    const recordHeartbeat = async (heartbeatInput: RemoteAgentHeartbeatInput) => {
      const heartbeat = await this.heartbeat(heartbeatInput);
      lastHeartbeat = summarizeHeartbeat(heartbeat.agent);
      return heartbeat;
    };

    await lifecycle.start();
    if (lifecycle.isShutdownRequested) {
      await recordHeartbeat({ status: "offline", ttlSeconds: input.heartbeatTtlSeconds, errorCount: errors.length, metadata: { phase: "remote-run-shutdown-requested" } });
      await lifecycle.stop("shutdown_requested");
      return this.runResult("shutdown_requested", { cycles, idleCycles, errors, polls, acknowledgements, lastHeartbeat, lifecycle });
    }
    await recordHeartbeat({ status: "online", ttlSeconds: input.heartbeatTtlSeconds, metadata: { phase: "remote-run-start" } });

    while (cycles < input.maxCycles) {
      if (lifecycle.isShutdownRequested) {
        await recordHeartbeat({ status: "offline", ttlSeconds: input.heartbeatTtlSeconds, errorCount: errors.length, metadata: { phase: "remote-run-shutdown-requested" } });
        await lifecycle.stop("shutdown_requested");
        return this.runResult("shutdown_requested", { cycles, idleCycles, errors, polls, acknowledgements, lastHeartbeat, lifecycle });
      }
      if (input.signal?.aborted) {
        await recordHeartbeat({ status: "offline", ttlSeconds: input.heartbeatTtlSeconds, errorCount: errors.length, metadata: { phase: "remote-run-aborted" } });
        await lifecycle.stop("aborted");
        return this.runResult("aborted", { cycles, idleCycles, errors, polls, acknowledgements, lastHeartbeat, lifecycle });
      }

      cycles += 1;
      const cycleStartedAtMs = Date.now();
      try {
        const poll = await this.poll({
          maxMessages: input.maxMessagesPerPoll,
          maxIdlePolls: input.maxIdlePolls,
          idleIntervalMs: input.idleIntervalMs,
          onMessage: input.onMessage,
          signal: input.signal,
        });
        polls.push(poll);
        acknowledgements.push(...poll.acknowledgements);
        await input.onPoll?.(poll);
        await lifecycle.recordTick({
          messagesProcessed: poll.messagesProcessed,
          failures: 0,
          loopLatencyMs: Date.now() - cycleStartedAtMs,
        });
        consecutiveErrors = 0;
        await recordHeartbeat({
          status: poll.messagesProcessed > 0 ? "running" : "idle",
          ttlSeconds: input.heartbeatTtlSeconds,
          lastPollStopReason: poll.stopReason,
          messagesProcessed: acknowledgements.length,
          errorCount: errors.length,
        });

        if (poll.stopReason === "aborted") {
          await recordHeartbeat({ status: "offline", ttlSeconds: input.heartbeatTtlSeconds, errorCount: errors.length, metadata: { phase: "remote-run-aborted" } });
          await lifecycle.stop("aborted");
          return this.runResult("aborted", { cycles, idleCycles, errors, polls, acknowledgements, lastHeartbeat, lifecycle });
        }

        if (lifecycle.isShutdownRequested) {
          await recordHeartbeat({ status: "offline", ttlSeconds: input.heartbeatTtlSeconds, messagesProcessed: acknowledgements.length, errorCount: errors.length, metadata: { phase: "remote-run-shutdown-requested" } });
          await lifecycle.stop("shutdown_requested");
          return this.runResult("shutdown_requested", { cycles, idleCycles, errors, polls, acknowledgements, lastHeartbeat, lifecycle });
        }

        if (poll.messagesProcessed === 0 && poll.stopReason === "idle") {
          idleCycles += 1;
          await lifecycle.recordIdle();
          if (input.stopWhenIdle && idleCycles >= input.maxIdleCycles) {
            await recordHeartbeat({ status: "idle", ttlSeconds: input.heartbeatTtlSeconds, lastPollStopReason: poll.stopReason, messagesProcessed: acknowledgements.length, errorCount: errors.length, metadata: { phase: "remote-run-idle-stop" } });
            await lifecycle.stop("idle");
            return this.runResult("idle", { cycles, idleCycles, errors, polls, acknowledgements, lastHeartbeat, lifecycle });
          }
        } else {
          idleCycles = 0;
        }

        if (cycles < input.maxCycles) {
          await sleepMilliseconds(input.intervalMs, input.signal);
        }
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        errors.push({
          cycle: cycles,
          message: normalized.message,
          occurredAt: new Date().toISOString(),
        });
        await input.onError?.(normalized, cycles);
        await lifecycle.recordTick({
          messagesProcessed: 0,
          failures: 1,
          loopLatencyMs: Date.now() - cycleStartedAtMs,
        });
        consecutiveErrors += 1;
        await recordHeartbeat({
          status: "error",
          ttlSeconds: input.heartbeatTtlSeconds,
          messagesProcessed: acknowledgements.length,
          errorCount: errors.length,
          lastError: normalized.message,
        });
        if (consecutiveErrors >= input.maxErrors) {
          await recordHeartbeat({ status: "error", ttlSeconds: input.heartbeatTtlSeconds, messagesProcessed: acknowledgements.length, errorCount: errors.length, lastError: normalized.message, metadata: { phase: "remote-run-max-errors" } });
          await lifecycle.stop("max_errors");
          return this.runResult("max_errors", { cycles, idleCycles, errors, polls, acknowledgements, lastHeartbeat, lifecycle });
        }
        if (lifecycle.isShutdownRequested) {
          await recordHeartbeat({ status: "offline", ttlSeconds: input.heartbeatTtlSeconds, messagesProcessed: acknowledgements.length, errorCount: errors.length, metadata: { phase: "remote-run-shutdown-requested" } });
          await lifecycle.stop("shutdown_requested");
          return this.runResult("shutdown_requested", { cycles, idleCycles, errors, polls, acknowledgements, lastHeartbeat, lifecycle });
        }
        const backoff = Math.min(input.maxBackoffMs, input.baseBackoffMs * 2 ** Math.max(0, consecutiveErrors - 1));
        await sleepMilliseconds(backoff, input.signal);
      }
    }

    await recordHeartbeat({ status: "idle", ttlSeconds: input.heartbeatTtlSeconds, messagesProcessed: acknowledgements.length, errorCount: errors.length, metadata: { phase: "remote-run-max-cycles" } });
    await lifecycle.stop("max_cycles");
    return this.runResult("max_cycles", { cycles, idleCycles, errors, polls, acknowledgements, lastHeartbeat, lifecycle });
  }

  private pollResult(
    stopReason: RemoteRoomPollResult["stopReason"],
    acknowledgements: RemoteRoomPollResult["acknowledgements"],
    idlePolls: number,
  ): RemoteRoomPollResult {
    return {
      roomId: this.options.roomId,
      agentId: this.options.localAgent.id,
      stopReason,
      messagesProcessed: acknowledgements.length,
      idlePolls,
      acknowledgements,
    };
  }

  private runResult(
    stopReason: RemoteRoomRunResult["stopReason"],
    input: {
      cycles: number;
      idleCycles: number;
      errors: RemoteRoomRunResult["errors"];
      polls: RemoteRoomPollResult[];
      acknowledgements: RemoteRoomPollResult["acknowledgements"];
      lastHeartbeat?: RemoteRoomHeartbeatSummary;
      lifecycle: DaemonLifecycleController;
    },
  ): RemoteRoomRunResult {
    const lifecycle = input.lifecycle.snapshot();
    return {
      roomId: this.options.roomId,
      agentId: this.options.localAgent.id,
      stopReason,
      cycles: input.cycles,
      idleCycles: input.idleCycles,
      errors: input.errors,
      messagesProcessed: input.acknowledgements.length,
      acknowledgements: input.acknowledgements,
      polls: input.polls,
      lastHeartbeat: input.lastHeartbeat,
      lifecycle,
      metrics: lifecycle.metrics,
    };
  }
}

async function controlPlaneGetJson<T>(controlUrl: string, path: string, token: string): Promise<T> {
  const url = new URL(path, controlUrl.endsWith("/") ? controlUrl : `${controlUrl}/`);
  const response = await fetch(url, {
    headers: {
      "x-agent-control-token": token,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(`Control plane ${response.status}: ${payload.error ?? response.statusText}`);
  }
  return payload as T;
}

async function controlPlanePostJson<T>(controlUrl: string, path: string, token: string, body: Record<string, unknown>): Promise<T> {
  const url = new URL(path, controlUrl.endsWith("/") ? controlUrl : `${controlUrl}/`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-control-token": token,
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(`Control plane ${response.status}: ${payload.error ?? response.statusText}`);
  }
  return payload as T;
}

function agentActor(agent: RemoteRoomRunnerAgent) {
  return { type: "agent" as const, id: agent.id, displayName: agent.displayName };
}

function summarizeHeartbeat(agent: RemoteAgentHeartbeatResult["agent"]): RemoteRoomHeartbeatSummary {
  return {
    agentId: agent.id,
    machineId: agent.machineId,
    status: agent.heartbeatStatus,
    lastHeartbeatAt: agent.lastHeartbeatAt,
    heartbeatExpiresAt: agent.heartbeatExpiresAt,
    lastRoomId: agent.lastRoomId,
    lastError: agent.lastError,
  };
}

async function sleepMilliseconds(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

import { randomUUID } from "node:crypto";
import type { AgentHeartbeatEnvelope, AgentHeartbeatStatus, RoomDeliveryAckEnvelope } from "../domain/index.js";
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
  stopReason: "max_cycles" | "idle" | "max_errors" | "aborted";
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
};

export type RemoteRoomRunnerIdentity = {
  signRoomDeliveryAckEnvelope(envelope: Omit<RoomDeliveryAckEnvelope, "signature">): Promise<string | undefined>;
  signAgentHeartbeatEnvelope(envelope: Omit<AgentHeartbeatEnvelope, "signature">): Promise<string | undefined>;
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

  async heartbeat(input: {
    status: AgentHeartbeatStatus;
    ttlSeconds?: number;
    lastPollStopReason?: string;
    messagesProcessed?: number;
    errorCount?: number;
    lastError?: string;
    metadata?: Record<string, unknown>;
  }): Promise<RemoteAgentHeartbeatResult> {
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

  async poll(input: {
    maxMessages: number;
    maxIdlePolls: number;
    idleIntervalMs: number;
    onMessage?: (message: RemoteRoomInboxMessage, ack: RemoteRoomAckResult) => void;
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
        input.onMessage?.(message, ack);
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
    onPoll?: (poll: RemoteRoomPollResult) => void;
    onError?: (error: Error, cycle: number) => void;
    signal?: AbortSignal;
  }): Promise<RemoteRoomRunResult> {
    const polls: RemoteRoomPollResult[] = [];
    const acknowledgements: RemoteRoomPollResult["acknowledgements"] = [];
    const errors: RemoteRoomRunResult["errors"] = [];
    let cycles = 0;
    let idleCycles = 0;
    let consecutiveErrors = 0;

    await this.heartbeat({ status: "online", ttlSeconds: input.heartbeatTtlSeconds, metadata: { phase: "remote-run-start" } });

    while (cycles < input.maxCycles) {
      if (input.signal?.aborted) {
        await this.heartbeat({ status: "offline", ttlSeconds: input.heartbeatTtlSeconds, errorCount: errors.length, metadata: { phase: "remote-run-aborted" } });
        return this.runResult("aborted", { cycles, idleCycles, errors, polls, acknowledgements });
      }

      cycles += 1;
      try {
        const poll = await this.poll({
          maxMessages: input.maxMessagesPerPoll,
          maxIdlePolls: input.maxIdlePolls,
          idleIntervalMs: input.idleIntervalMs,
          signal: input.signal,
        });
        polls.push(poll);
        acknowledgements.push(...poll.acknowledgements);
        input.onPoll?.(poll);
        consecutiveErrors = 0;
        await this.heartbeat({
          status: poll.messagesProcessed > 0 ? "running" : "idle",
          ttlSeconds: input.heartbeatTtlSeconds,
          lastPollStopReason: poll.stopReason,
          messagesProcessed: acknowledgements.length,
          errorCount: errors.length,
        });

        if (poll.stopReason === "aborted") {
          await this.heartbeat({ status: "offline", ttlSeconds: input.heartbeatTtlSeconds, errorCount: errors.length, metadata: { phase: "remote-run-aborted" } });
          return this.runResult("aborted", { cycles, idleCycles, errors, polls, acknowledgements });
        }

        if (poll.messagesProcessed === 0 && poll.stopReason === "idle") {
          idleCycles += 1;
          if (input.stopWhenIdle && idleCycles >= input.maxIdleCycles) {
            await this.heartbeat({ status: "idle", ttlSeconds: input.heartbeatTtlSeconds, lastPollStopReason: poll.stopReason, messagesProcessed: acknowledgements.length, errorCount: errors.length, metadata: { phase: "remote-run-idle-stop" } });
            return this.runResult("idle", { cycles, idleCycles, errors, polls, acknowledgements });
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
        input.onError?.(normalized, cycles);
        consecutiveErrors += 1;
        await this.heartbeat({
          status: "error",
          ttlSeconds: input.heartbeatTtlSeconds,
          messagesProcessed: acknowledgements.length,
          errorCount: errors.length,
          lastError: normalized.message,
        });
        if (consecutiveErrors >= input.maxErrors) {
          await this.heartbeat({ status: "error", ttlSeconds: input.heartbeatTtlSeconds, messagesProcessed: acknowledgements.length, errorCount: errors.length, lastError: normalized.message, metadata: { phase: "remote-run-max-errors" } });
          return this.runResult("max_errors", { cycles, idleCycles, errors, polls, acknowledgements });
        }
        const backoff = Math.min(input.maxBackoffMs, input.baseBackoffMs * 2 ** Math.max(0, consecutiveErrors - 1));
        await sleepMilliseconds(backoff, input.signal);
      }
    }

    await this.heartbeat({ status: "idle", ttlSeconds: input.heartbeatTtlSeconds, messagesProcessed: acknowledgements.length, errorCount: errors.length, metadata: { phase: "remote-run-max-cycles" } });
    return this.runResult("max_cycles", { cycles, idleCycles, errors, polls, acknowledgements });
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
    },
  ): RemoteRoomRunResult {
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

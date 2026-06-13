import type { AgentHeartbeatStatus, AgentIdentity, AgentTrustStatus } from "../domain/index.js";
import type { AgentStore } from "../store/agent-store.js";

export type AgentHealthState = "online" | "idle" | "running" | "error" | "stale" | "offline" | "unknown";

export type AgentHealthSummary = {
  generatedAt: string;
  agents: {
    total: number;
    byTrustStatus: Record<AgentTrustStatus, number>;
    byHeartbeatStatus: Record<AgentHeartbeatStatus | "unknown", number>;
    byHealthState: Record<AgentHealthState, number>;
    heartbeatKnown: number;
    stale: number;
    responsive: number;
    failing: number;
  };
  machines: Record<string, number>;
  rooms: Record<string, number>;
  perAgent: AgentHealthAgent[];
};

export type AgentHealthAgent = {
  agentId: string;
  machineId: string;
  displayName: string;
  trustStatus: AgentTrustStatus;
  heartbeatStatus?: AgentHeartbeatStatus;
  healthState: AgentHealthState;
  responsive: boolean;
  heartbeatExpired: boolean;
  lastSeenAt?: string;
  lastHeartbeatAt?: string;
  heartbeatExpiresAt?: string;
  lastRoomId?: string;
  lastError?: string;
  secondsSinceHeartbeat?: number;
  heartbeatMetadata?: Record<string, unknown>;
};

export class AgentHealthService {
  constructor(private readonly store: AgentStore) {}

  async getSummary(input: { now?: string; limit?: number } = {}): Promise<AgentHealthSummary> {
    const now = input.now ?? new Date().toISOString();
    const agents = await this.store.listAgents(input.limit ?? 1000);
    const perAgent = agents.map((agent) => summarizeAgent(agent, now));
    return {
      generatedAt: now,
      agents: {
        total: agents.length,
        byTrustStatus: countTrustStatuses(agents),
        byHeartbeatStatus: countHeartbeatStatuses(agents),
        byHealthState: countHealthStates(perAgent),
        heartbeatKnown: agents.filter((agent) => Boolean(agent.lastHeartbeatAt || agent.heartbeatStatus)).length,
        stale: perAgent.filter((agent) => agent.healthState === "stale").length,
        responsive: perAgent.filter((agent) => agent.responsive).length,
        failing: perAgent.filter((agent) => agent.healthState === "error" || agent.healthState === "stale").length,
      },
      machines: countBy(perAgent, (agent) => agent.machineId),
      rooms: countBy(perAgent.filter((agent) => agent.lastRoomId), (agent) => agent.lastRoomId ?? "unknown"),
      perAgent,
    };
  }
}

function summarizeAgent(agent: AgentIdentity, now: string): AgentHealthAgent {
  const heartbeatExpired = isHeartbeatExpired(agent, now);
  const healthState = deriveHealthState(agent, now);
  return {
    agentId: agent.id,
    machineId: agent.machineId,
    displayName: agent.displayName,
    trustStatus: agent.trustStatus,
    heartbeatStatus: agent.heartbeatStatus,
    healthState,
    responsive: isResponsive(agent, healthState),
    heartbeatExpired,
    lastSeenAt: agent.lastSeenAt,
    lastHeartbeatAt: agent.lastHeartbeatAt,
    heartbeatExpiresAt: agent.heartbeatExpiresAt,
    lastRoomId: agent.lastRoomId,
    lastError: agent.lastError,
    secondsSinceHeartbeat: secondsSince(agent.lastHeartbeatAt, now),
    heartbeatMetadata: agent.heartbeatMetadata,
  };
}

function deriveHealthState(agent: AgentIdentity, now: string): AgentHealthState {
  if (!agent.heartbeatStatus && !agent.lastHeartbeatAt) {
    return "unknown";
  }
  if (agent.heartbeatStatus === "offline") {
    return "offline";
  }
  if (isHeartbeatExpired(agent, now)) {
    return "stale";
  }
  if (agent.heartbeatStatus === "error") {
    return "error";
  }
  if (agent.heartbeatStatus === "online" || agent.heartbeatStatus === "idle" || agent.heartbeatStatus === "running") {
    return agent.heartbeatStatus;
  }
  return "unknown";
}

function isHeartbeatExpired(agent: AgentIdentity, now: string): boolean {
  return Boolean(agent.heartbeatExpiresAt && agent.heartbeatExpiresAt <= now && agent.heartbeatStatus !== "offline");
}

function isResponsive(agent: AgentIdentity, healthState: AgentHealthState): boolean {
  return (
    (healthState === "online" || healthState === "idle" || healthState === "running") &&
    agent.trustStatus !== "suspended" &&
    agent.trustStatus !== "revoked" &&
    agent.trustStatus !== "expired"
  );
}

function secondsSince(value: string | undefined, now: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const thenMs = Date.parse(value);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(thenMs) || !Number.isFinite(nowMs)) {
    return undefined;
  }
  return Math.max(0, Math.floor((nowMs - thenMs) / 1000));
}

function countTrustStatuses(agents: AgentIdentity[]): Record<AgentTrustStatus, number> {
  return {
    pending: agents.filter((agent) => agent.trustStatus === "pending").length,
    trusted: agents.filter((agent) => agent.trustStatus === "trusted").length,
    suspended: agents.filter((agent) => agent.trustStatus === "suspended").length,
    revoked: agents.filter((agent) => agent.trustStatus === "revoked").length,
    expired: agents.filter((agent) => agent.trustStatus === "expired").length,
  };
}

function countHeartbeatStatuses(agents: AgentIdentity[]): Record<AgentHeartbeatStatus | "unknown", number> {
  return {
    online: agents.filter((agent) => agent.heartbeatStatus === "online").length,
    idle: agents.filter((agent) => agent.heartbeatStatus === "idle").length,
    running: agents.filter((agent) => agent.heartbeatStatus === "running").length,
    error: agents.filter((agent) => agent.heartbeatStatus === "error").length,
    offline: agents.filter((agent) => agent.heartbeatStatus === "offline").length,
    unknown: agents.filter((agent) => !agent.heartbeatStatus).length,
  };
}

function countHealthStates(agents: AgentHealthAgent[]): Record<AgentHealthState, number> {
  return {
    online: agents.filter((agent) => agent.healthState === "online").length,
    idle: agents.filter((agent) => agent.healthState === "idle").length,
    running: agents.filter((agent) => agent.healthState === "running").length,
    error: agents.filter((agent) => agent.healthState === "error").length,
    stale: agents.filter((agent) => agent.healthState === "stale").length,
    offline: agents.filter((agent) => agent.healthState === "offline").length,
    unknown: agents.filter((agent) => agent.healthState === "unknown").length,
  };
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

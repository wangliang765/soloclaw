import type { CommandModule } from "../command-router.js";

type LocalAgentRef = {
  id: string;
  displayName: string;
};

type IdentityRecord = {
  id: string;
  machineId?: string;
  displayName: string;
  fingerprint: string;
  trustStatus: string;
  capabilities?: unknown;
};

type IdentityCommandPlatform = {
  identity: {
    show(): Promise<{ identity: IdentityRecord; privateKeyPath: string }>;
    getOrCreate(displayName: string): Promise<IdentityRecord>;
  };
  close(): void;
};

export type IdentityCommandDeps = {
  createPlatform(): Promise<IdentityCommandPlatform>;
  readOption(args: string[], name: string): string | undefined;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createIdentityCommand(deps: IdentityCommandDeps): CommandModule<void> {
  return {
    name: "identity",
    summary: "Show or initialize the local agent identity",
    execute: async ({ args: rest }) => {
      const subcommand = rest[0] ?? "show";
      const platform = await deps.createPlatform();
      try {
        if (subcommand === "show" || subcommand === "init") {
          const displayName = deps.readOption(rest.slice(1), "--display-name");
          const result = await platform.identity.show();
          const agent = displayName ? await platform.identity.getOrCreate(displayName) : result.identity;
          deps.writeJson({
            id: agent.id,
            machineId: agent.machineId,
            displayName: agent.displayName,
            fingerprint: agent.fingerprint,
            trustStatus: agent.trustStatus,
            capabilities: agent.capabilities,
            privateKeyPath: result.privateKeyPath,
          });
          return { matched: true };
        }
        deps.writeError(`Unknown identity command: ${subcommand}`);
        deps.setExitCode(1);
      } finally {
        platform.close();
      }
      return { matched: true };
    },
  };
}

type AgentListRecord = {
  id: string;
  trustStatus: string;
  fingerprint: string;
  displayName: string;
};

type AgentHealthSummary = {
  agents: {
    total: number;
    responsive: number;
    stale: number;
    failing: number;
  };
  perAgent: Array<{
    agentId: string;
    healthState: string;
    trustStatus: string;
    machineId: string;
    lastRoomId?: string;
    lastHeartbeatAt?: string;
    displayName: string;
  }>;
};

type AgentCommandPlatform = {
  store: {
    listAgents(limit: number): Promise<AgentListRecord[]>;
  };
  agentHealth: {
    getSummary(input: { now?: string; limit: number }): Promise<AgentHealthSummary>;
  };
  localAgent: LocalAgentRef;
  close(): void;
};

type AgentsControlPlane = {
  recoverStaleAgents(input: { actor: any; now?: string; limit: number }): Promise<any>;
  updateAgentTrustStatus(input: {
    actor: any;
    agentId: string;
    trustStatus: unknown;
    reason?: string;
  }): Promise<any>;
  rotateAgentIdentityKey(input: {
    actor: any;
    agentId: string;
    publicKeyPem: string;
    fingerprint?: string;
    reason?: string;
  }): Promise<any>;
};

export type AgentsCommandDeps = {
  createPlatform(): Promise<AgentCommandPlatform>;
  createControlPlane(platform: AgentCommandPlatform): AgentsControlPlane;
  readOption(args: string[], name: string): string | undefined;
  readUtf8(filePath: string): Promise<string>;
  parseActorRef(value?: string): any;
  agentActor(agent: LocalAgentRef): any;
  parseAgentTrustStatus(value: string): unknown;
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

function numericOption(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? String(fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function actorForArgs(deps: AgentsCommandDeps, platform: AgentCommandPlatform, args: string[]): unknown {
  return args.includes("--local-agent")
    ? deps.agentActor(platform.localAgent)
    : deps.parseActorRef(deps.readOption(args, "--actor"));
}

export function createAgentsCommand(deps: AgentsCommandDeps): CommandModule<void> {
  return {
    name: "agents",
    summary: "List agent identities and manage agent health",
    execute: async ({ args: rest }) => {
      const platform = await deps.createPlatform();
      try {
        if (rest[0] === "health") {
          const args = rest.slice(1);
          const summary = await platform.agentHealth.getSummary({
            now: deps.readOption(args, "--now"),
            limit: numericOption(deps.readOption(args, "--limit"), 1000),
          });
          if (args.includes("--json")) {
            deps.writeJson(summary);
          } else {
            deps.writeText(`agents total=${summary.agents.total} responsive=${summary.agents.responsive} stale=${summary.agents.stale} failing=${summary.agents.failing}`);
            for (const agent of summary.perAgent) {
              deps.writeText(`${agent.agentId}\t${agent.healthState}\t${agent.trustStatus}\t${agent.machineId}\troom=${agent.lastRoomId ?? "-"}\theartbeat=${agent.lastHeartbeatAt ?? "-"}\t${agent.displayName}`);
            }
          }
          return { matched: true };
        }
        if (rest[0] === "recover-stale") {
          const args = rest.slice(1);
          const result = await deps.createControlPlane(platform).recoverStaleAgents({
            actor: actorForArgs(deps, platform, args),
            now: deps.readOption(args, "--now"),
            limit: numericOption(deps.readOption(args, "--limit"), 1000),
          });
          if (args.includes("--json")) {
            deps.writeJson(result);
          } else {
            deps.writeText(`stale recovery recovered=${result.summary.recovered} stale=${result.summary.stale} skipped=${result.summary.skipped}`);
            for (const recovered of result.recovered) {
              deps.writeText(`${recovered.agentId}\troom=${recovered.roomId}\tmember=${recovered.memberStatusAfter}\theartbeat=${recovered.heartbeatStatusAfter}`);
            }
            for (const skipped of result.skipped) {
              deps.writeText(`${skipped.agentId}\tskipped=${skipped.reason}\troom=${skipped.roomId ?? "-"}`);
            }
          }
          return { matched: true };
        }
        if (rest[0] === "trust" || rest[0] === "set-trust") {
          const args = rest.slice(1);
          const agentId = args[0];
          const trustStatus = args[1] ? deps.parseAgentTrustStatus(args[1]) : undefined;
          if (!agentId || !trustStatus) {
            deps.writeError("Usage: agent agents trust <agent-id> pending|trusted|suspended|revoked|expired [--reason text] [--local-agent|--actor user:id|agent:id] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const result = await deps.createControlPlane(platform).updateAgentTrustStatus({
            actor: actorForArgs(deps, platform, args),
            agentId,
            trustStatus,
            reason: deps.readOption(args, "--reason"),
          });
          if (args.includes("--json")) {
            deps.writeJson(result);
          } else {
            deps.writeText(`${result.agent.id}\t${result.previousTrustStatus}->${result.agent.trustStatus}\t${result.agent.fingerprint}\t${result.agent.displayName}`);
          }
          return { matched: true };
        }
        if (rest[0] === "rotate-key") {
          const args = rest.slice(1);
          const agentId = args[0];
          const publicKeyFile = deps.readOption(args, "--public-key-file");
          if (!agentId || !publicKeyFile) {
            deps.writeError("Usage: agent agents rotate-key <agent-id> --public-key-file path [--fingerprint fingerprint] [--reason text] [--local-agent|--actor user:id|agent:id] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const result = await deps.createControlPlane(platform).rotateAgentIdentityKey({
            actor: actorForArgs(deps, platform, args),
            agentId,
            publicKeyPem: await deps.readUtf8(publicKeyFile),
            fingerprint: deps.readOption(args, "--fingerprint"),
            reason: deps.readOption(args, "--reason"),
          });
          if (args.includes("--json")) {
            deps.writeJson(result);
          } else {
            deps.writeText(`${result.agent.id}\t${result.previousFingerprint}->${result.agent.fingerprint}\ttrust=${result.agent.trustStatus}\t${result.agent.displayName}`);
          }
          return { matched: true };
        }
        const limit = numericOption(deps.readOption(rest, "--limit"), 20);
        const agents = await platform.store.listAgents(limit);
        for (const agent of agents) {
          deps.writeText(`${agent.id}\t${agent.trustStatus}\t${agent.fingerprint}\t${agent.displayName}`);
        }
      } finally {
        platform.close();
      }
      return { matched: true };
    },
  };
}

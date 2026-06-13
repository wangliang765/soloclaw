import type { ActorRef, ExecutionMode, PolicyRequest } from "../domain/index.js";
import type { AgentStore } from "../store/agent-store.js";
import type { PolicyEngine } from "../policy/policy-engine.js";
import type { PolicySecretBroker } from "../secrets/policy-secret-broker.js";
import type { SecretLease } from "../secrets/secret-store.js";
import type { LocalMcpRegistry } from "./local-mcp-registry.js";
import { McpConnectionPlanner, type McpConnectionPlan } from "./mcp-connection-planner.js";
import type { McpRuntime } from "./mcp-runtime.js";

export type McpHealthStatus = "healthy" | "disabled" | "blocked" | "timeout" | "failed";

export type McpHealthCheckInput = {
  serverId: string;
  actor: ActorRef;
  mode: ExecutionMode;
  scope?: PolicyRequest["scope"];
  timeoutMs?: number;
  secretEnvMap?: Record<string, string>;
};

export type McpHealthCheckResult = {
  serverId: string;
  generatedAt: string;
  status: McpHealthStatus;
  transport?: string;
  reason?: string;
  diagnostics: string[];
  plan?: Pick<McpConnectionPlan, "status" | "reason" | "scope">;
  capabilities?: {
    declared: string[];
    tools: number;
    resources: number;
    prompts: number;
    sampling: boolean;
  };
};

export type McpHealthServiceOptions = {
  executionEnabled?: boolean;
  planAudit?: boolean;
};

export class McpHealthService {
  constructor(
    private readonly registry: LocalMcpRegistry,
    private readonly runtime: McpRuntime,
    private readonly policy: PolicyEngine,
    private readonly store: AgentStore,
    private readonly secretBroker: PolicySecretBroker,
    private readonly options: McpHealthServiceOptions = {},
  ) {}

  async check(input: McpHealthCheckInput): Promise<McpHealthCheckResult> {
    const generatedAt = new Date().toISOString();
    const planner = new McpConnectionPlanner(this.registry, this.policy, this.store, { audit: this.options.planAudit });
    const plan = await planner.plan({
      serverId: input.serverId,
      actor: input.actor,
      mode: input.mode,
      scope: input.scope,
    });
    const base = {
      serverId: input.serverId,
      generatedAt,
      transport: plan.server.transport,
      diagnostics: [...plan.diagnostics],
      plan: {
        status: plan.status,
        reason: plan.reason,
        scope: plan.scope,
      },
    };
    if (!this.isExecutionEnabled()) {
      return {
        ...base,
        status: "disabled",
        reason: "MCP execution is globally disabled.",
      };
    }
    if (!plan.server.policy.enabled) {
      return {
        ...base,
        status: "disabled",
        reason: plan.reason,
      };
    }
    if (plan.status !== "allow") {
      return {
        ...base,
        status: "blocked",
        reason: plan.reason,
      };
    }
    const server = await this.registry.get(input.serverId);
    if (!server) {
      return {
        ...base,
        status: "failed",
        reason: `MCP server not found: ${input.serverId}`,
      };
    }
    const leases = await this.resolveEnvLeases(input, plan);
    const env = Object.fromEntries(leases.map((lease) => [lease.envName, lease.lease.value]));
    let connectionId: string | undefined;
    try {
      const connection = await this.runtime.connect({
        server,
        actor: input.actor,
        projectId: plan.scope.projectId,
        roomId: plan.scope.roomId,
        sessionId: plan.scope.sessionId,
        env,
        timeoutMs: input.timeoutMs,
      });
      connectionId = connection.connectionId;
      const capabilities = await this.runtime.listCapabilities(connection.connectionId);
      return {
        ...base,
        status: "healthy",
        capabilities: {
          declared: plan.server.capabilities,
          tools: capabilities.tools.length,
          resources: capabilities.resources.length,
          prompts: capabilities.prompts?.length ?? 0,
          sampling: capabilities.sampling === true,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...base,
        status: /timed out|abort/i.test(message) ? "timeout" : "failed",
        reason: message,
      };
    } finally {
      if (connectionId) {
        await this.runtime.disconnect(connectionId);
      }
      await Promise.all(leases.map((lease) => this.secretBroker.revokeLease(lease.lease.leaseId)));
    }
  }

  private async resolveEnvLeases(input: McpHealthCheckInput, plan: McpConnectionPlan): Promise<Array<{ envName: string; lease: SecretLease }>> {
    const leases: Array<{ envName: string; lease: SecretLease }> = [];
    for (const envName of plan.connection.envVarNames) {
      const secretId = input.secretEnvMap?.[envName] ?? process.env[`MCP_SECRET_${envName}`];
      if (!secretId) {
        throw new Error(`MCP env var ${envName} requires a secret ref via MCP_SECRET_${envName}.`);
      }
      const lease = await this.secretBroker.getSecret({
        id: secretId,
        purpose: `mcp_health:${plan.server.id}:${envName}`,
        actor: input.actor,
        mode: input.mode,
        risk: plan.server.policy.risk,
        scope: plan.scope,
        metadata: {
          serverId: plan.server.id,
          envName,
          healthCheck: true,
        },
      });
      leases.push({ envName, lease });
    }
    return leases;
  }

  private isExecutionEnabled(): boolean {
    if (this.options.executionEnabled !== undefined) {
      return this.options.executionEnabled;
    }
    return process.env.AGENT_MCP_EXECUTION !== "disabled";
  }
}

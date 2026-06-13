import type { ActorRef, ExecutionMode, McpServerRegistration, PolicyDecision, PolicyRequest } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { PolicyEngine } from "../policy/policy-engine.js";
import type { AgentStore } from "../store/agent-store.js";
import type { LocalMcpRegistry } from "./local-mcp-registry.js";

export type McpConnectionPlanStatus = "allow" | "ask" | "deny";

export type McpConnectionPlan = {
  server: Pick<McpServerRegistration, "id" | "name" | "transport" | "capabilities" | "envVarNames" | "policy">;
  status: McpConnectionPlanStatus;
  reason: string;
  policyDecision?: PolicyDecision;
  scope: PolicyRequest["scope"];
  connection: {
    transport: McpServerRegistration["transport"];
    command?: string;
    args?: string[];
    url?: string;
    envVarNames: string[];
  };
  diagnostics: string[];
};

export type PlanMcpConnectionInput = {
  serverId: string;
  actor: ActorRef;
  mode: ExecutionMode;
  scope?: PolicyRequest["scope"];
};

export type McpConnectionPlannerOptions = {
  audit?: boolean;
};

export class McpConnectionPlanner {
  constructor(
    private readonly registry: LocalMcpRegistry,
    private readonly policy: PolicyEngine,
    private readonly store?: AgentStore,
    private readonly options: McpConnectionPlannerOptions = {},
  ) {}

  async plan(input: PlanMcpConnectionInput): Promise<McpConnectionPlan> {
    const server = await this.registry.get(input.serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${input.serverId}`);
    }
    const scope = await this.expandScope(input.scope ?? {});
    const diagnostics = validateScope(server, scope);
    let status: McpConnectionPlanStatus = "allow";
    let reason = "MCP connection allowed by local policy plan.";
    let policyDecision: PolicyDecision | undefined;

    if (!server.policy.enabled) {
      status = "deny";
      reason = "MCP server is disabled.";
    } else if (diagnostics.length > 0) {
      status = "deny";
      reason = diagnostics[0];
    } else {
      policyDecision = await this.policy.evaluate({
        actor: input.actor,
        action: "mcp.connect",
        mode: input.mode,
        risk: server.policy.risk,
        scope,
        metadata: safeMcpConnectionMetadata(server),
        requestedAt: new Date().toISOString(),
      });
      if (policyDecision.type === "deny") {
        status = "deny";
        reason = policyDecision.reason;
      } else if (policyDecision.type === "ask") {
        status = "ask";
        reason = policyDecision.reason;
      } else if (server.policy.requireApproval && input.mode !== "full_access") {
        status = "ask";
        reason = "MCP server policy requires approval before connection.";
      } else {
        reason = policyDecision.reason;
      }
    }

    const plan: McpConnectionPlan = {
      server: {
        id: server.id,
        name: server.name,
        transport: server.transport,
        capabilities: server.capabilities,
        envVarNames: server.envVarNames,
        policy: server.policy,
      },
      status,
      reason,
      policyDecision,
      scope,
      connection: {
        transport: server.transport,
        command: server.command,
        args: server.args,
        url: server.url,
        envVarNames: server.envVarNames,
      },
      diagnostics,
    };
    if (this.options.audit !== false) {
      await this.audit(input.actor, plan);
    }
    return plan;
  }

  private async expandScope(scope: PolicyRequest["scope"]): Promise<PolicyRequest["scope"]> {
    const expanded: PolicyRequest["scope"] = { ...scope };
    if (!this.store) {
      return expanded;
    }
    if (expanded.roomId) {
      const room = await this.store.getRoom(expanded.roomId);
      expanded.projectId ??= room?.projectId;
    }
    if (expanded.projectId) {
      const project = await this.store.getProject(expanded.projectId);
      expanded.orgId ??= project?.orgId;
    }
    return expanded;
  }

  private async audit(actor: ActorRef, plan: McpConnectionPlan): Promise<void> {
    await this.store?.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "mcp.connection_planned",
      actor,
      orgId: plan.scope.orgId,
      projectId: plan.scope.projectId,
      roomId: plan.scope.roomId,
      summary: `MCP connection plan ${plan.status}: ${plan.server.id}`,
      metadata: {
        serverId: plan.server.id,
        transport: plan.server.transport,
        capabilities: plan.server.capabilities,
        envVarNames: plan.server.envVarNames,
        status: plan.status,
        reason: plan.reason,
        diagnostics: plan.diagnostics,
        policyDecision: plan.policyDecision,
        risk: plan.server.policy.risk,
        requireApproval: plan.server.policy.requireApproval,
      },
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    });
  }
}

function validateScope(server: McpServerRegistration, scope: PolicyRequest["scope"]): string[] {
  const diagnostics: string[] = [];
  if (server.policy.allowedProjects && (!scope.projectId || !server.policy.allowedProjects.includes(scope.projectId))) {
    diagnostics.push(`MCP server ${server.id} is not allowed for project ${scope.projectId ?? "<none>"}.`);
  }
  if (server.policy.allowedRooms && (!scope.roomId || !server.policy.allowedRooms.includes(scope.roomId))) {
    diagnostics.push(`MCP server ${server.id} is not allowed for room ${scope.roomId ?? "<none>"}.`);
  }
  return diagnostics;
}

function safeMcpConnectionMetadata(server: McpServerRegistration): Record<string, unknown> {
  return {
    serverId: server.id,
    transport: server.transport,
    capabilities: server.capabilities,
    envVarNames: server.envVarNames,
    hasCommand: Boolean(server.command),
    hasUrl: Boolean(server.url),
    policy: server.policy,
  };
}

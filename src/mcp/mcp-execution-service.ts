import type { ActorRef, ApprovalRequest, ExecutionMode, PolicyAction, PolicyDecision, PolicyRequest } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore } from "../store/agent-store.js";
import type { PolicyEngine } from "../policy/policy-engine.js";
import type { PolicySecretBroker } from "../secrets/policy-secret-broker.js";
import type { SecretLease } from "../secrets/secret-store.js";
import type { LocalMcpRegistry } from "./local-mcp-registry.js";
import { McpConnectionPlanner, type McpConnectionPlan } from "./mcp-connection-planner.js";
import type { McpCapabilitySnapshot, McpReadResourceResult, McpRuntime, McpToolCallResult } from "./mcp-runtime.js";

export type McpExecutionOperation =
  | { type: "list_capabilities" }
  | { type: "call_tool"; name: string; input: Record<string, unknown> }
  | { type: "read_resource"; uri: string };

export type McpExecutionInput = {
  serverId: string;
  actor: ActorRef;
  mode: ExecutionMode;
  scope?: PolicyRequest["scope"];
  operation: McpExecutionOperation;
  timeoutMs?: number;
  secretEnvMap?: Record<string, string>;
  approvedApprovalId?: string;
};

export type McpExecutionResult = {
  plan: McpConnectionPlan;
  operation: McpExecutionOperation["type"];
  capabilities?: McpCapabilitySnapshot;
  tool?: McpToolCallResult;
  resource?: McpReadResourceResult;
};

export type McpExecutionServiceOptions = {
  executionEnabled?: boolean;
};

export type ReplayApprovedMcpExecutionInput = {
  approvalId: string;
  actor: ActorRef;
  timeoutMs?: number;
  secretEnvMap?: Record<string, string>;
};

type McpExecutionApprovalPayload = {
  kind: "mcp_execution";
  version: 1;
  serverId: string;
  mode: ExecutionMode;
  scope?: PolicyRequest["scope"];
  operation: McpExecutionOperation;
  timeoutMs?: number;
  secretEnvMap?: Record<string, string>;
};

export class McpExecutionService {
  constructor(
    private readonly registry: LocalMcpRegistry,
    private readonly runtime: McpRuntime,
    private readonly policy: PolicyEngine,
    private readonly store: AgentStore,
    private readonly secretBroker: PolicySecretBroker,
    private readonly options: McpExecutionServiceOptions = {},
  ) {}

  async execute(input: McpExecutionInput): Promise<McpExecutionResult> {
    const planner = new McpConnectionPlanner(this.registry, this.policy, this.store);
    const plan = await planner.plan({
      serverId: input.serverId,
      actor: input.actor,
      mode: input.mode,
      scope: input.scope,
    });
    if (!this.isExecutionEnabled()) {
      await this.audit(input, plan, "blocked", {
        reason: "MCP execution is globally disabled.",
        disabled: true,
      });
      throw new Error("MCP execution is globally disabled.");
    }
    if (plan.status !== "allow") {
      if (plan.status === "ask" && await this.isApprovedContinuation(input, "mcp.connect")) {
        // Continue with the approved request.
      } else {
        const approvalId = plan.status === "ask" ? await this.createApproval(input, plan, "mcp.connect", plan.reason, plan.policyDecision) : undefined;
      await this.audit(input, plan, "blocked", {
        reason: plan.reason,
        planStatus: plan.status,
          approvalId,
      });
        throw new Error(`MCP execution ${plan.status === "ask" ? "requires approval" : "denied"}: ${plan.reason}${approvalId ? ` Approval request: ${approvalId}.` : ""}`);
      }
    }
    await this.requireOperationPolicy(input, plan);

    const server = await this.registry.get(input.serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${input.serverId}`);
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
      const result = await this.runOperation(input, connection.connectionId, plan);
      await this.audit(input, plan, "completed", resultMetadata(result));
      return { plan, ...result };
    } catch (error) {
      await this.audit(input, plan, "failed", {
        error: error instanceof Error ? error.message : String(error),
        errorKind: classifyMcpExecutionError(error),
      });
      throw error;
    } finally {
      if (connectionId) {
        await this.runtime.disconnect(connectionId);
      }
      await Promise.all(leases.map((lease) => this.secretBroker.revokeLease(lease.lease.leaseId)));
    }
  }

  async executeApproved(input: ReplayApprovedMcpExecutionInput): Promise<McpExecutionResult> {
    const approval = await this.getApprovedMcpApproval(input.approvalId);
    const payload = parseMcpApprovalPayload(approval.inputSummary);
    return this.execute({
      serverId: payload.serverId,
      actor: input.actor,
      mode: payload.mode,
      scope: payload.scope,
      operation: payload.operation,
      timeoutMs: input.timeoutMs ?? payload.timeoutMs,
      secretEnvMap: input.secretEnvMap ?? payload.secretEnvMap,
      approvedApprovalId: approval.id,
    });
  }

  private async runOperation(
    input: McpExecutionInput,
    connectionId: string,
    plan: McpConnectionPlan,
  ): Promise<Omit<McpExecutionResult, "plan">> {
    if (input.operation.type === "list_capabilities") {
      return {
        operation: "list_capabilities",
        capabilities: await this.runtime.listCapabilities(connectionId),
      };
    }
    if (input.operation.type === "call_tool") {
      if (!plan.server.capabilities.includes("tools")) {
        throw new Error(`MCP server ${plan.server.id} does not declare tools capability.`);
      }
      return {
        operation: "call_tool",
        tool: await this.runtime.callTool({
          connectionId,
          actor: input.actor,
          name: input.operation.name,
          input: input.operation.input,
          timeoutMs: input.timeoutMs,
        }),
      };
    }
    if (!plan.server.capabilities.includes("resources")) {
      throw new Error(`MCP server ${plan.server.id} does not declare resources capability.`);
    }
    return {
      operation: "read_resource",
      resource: await this.runtime.readResource({
        connectionId,
        actor: input.actor,
        uri: input.operation.uri,
        timeoutMs: input.timeoutMs,
      }),
    };
  }

  private async requireOperationPolicy(input: McpExecutionInput, plan: McpConnectionPlan): Promise<void> {
    const action = input.operation.type === "call_tool"
      ? "mcp.tool.call"
      : input.operation.type === "read_resource"
        ? "mcp.resource.read"
        : undefined;
    if (!action) {
      return;
    }
    const decision = await this.policy.evaluate({
      actor: input.actor,
      action,
      mode: input.mode,
      risk: plan.server.policy.risk,
      scope: plan.scope,
      metadata: {
        serverId: plan.server.id,
        operation: input.operation.type,
        target: operationTarget(input.operation),
        transport: plan.server.transport,
      },
      requestedAt: new Date().toISOString(),
    });
    if (decision.type !== "allow") {
      if (decision.type === "ask" && await this.isApprovedContinuation(input, action)) {
        return;
      }
      const approvalId = decision.type === "ask" ? await this.createApproval(input, plan, action, decision.reason, decision) : undefined;
      await this.audit(input, plan, "blocked", {
        reason: decision.reason,
        policyDecision: decision,
        approvalId,
      });
      throw new Error(`MCP ${input.operation.type} ${decision.type === "ask" ? "requires approval" : "denied"}: ${decision.reason}${approvalId ? ` Approval request: ${approvalId}.` : ""}`);
    }
  }

  private async createApproval(
    input: McpExecutionInput,
    plan: McpConnectionPlan,
    action: PolicyAction,
    reason: string,
    decision?: PolicyDecision,
  ): Promise<string> {
    const approvalId = makeId<"ArtifactId">("appr");
    await this.store.createApprovalRequest({
      id: approvalId,
      status: "pending",
      requestedBy: input.actor,
      action,
      reason,
      approverHint: decision?.type === "ask" ? decision.approverHint : undefined,
      orgId: plan.scope.orgId,
      projectId: plan.scope.projectId,
      roomId: plan.scope.roomId,
      sessionId: plan.scope.sessionId,
      toolName: operationTarget(input.operation) ?? "mcp.capabilities",
      inputSummary: JSON.stringify(approvalPayload(input, plan)),
      createdAt: new Date().toISOString(),
    });
    return approvalId;
  }

  private async isApprovedContinuation(input: McpExecutionInput, action: PolicyAction): Promise<boolean> {
    if (!input.approvedApprovalId) {
      return false;
    }
    const approval = await this.getApprovedMcpApproval(input.approvedApprovalId);
    if (approval.action !== action) {
      return false;
    }
    const payload = parseMcpApprovalPayload(approval.inputSummary);
    return payload.serverId === input.serverId && payload.operation.type === input.operation.type && operationTarget(payload.operation) === operationTarget(input.operation);
  }

  private async getApprovedMcpApproval(approvalId: string): Promise<ApprovalRequest> {
    const approval = (await this.store.listApprovalRequests()).find((candidate) => candidate.id === approvalId);
    if (!approval) {
      throw new Error(`MCP approval not found: ${approvalId}`);
    }
    if (approval.status !== "approved") {
      throw new Error(`MCP approval is not approved: ${approvalId}`);
    }
    parseMcpApprovalPayload(approval.inputSummary);
    return approval;
  }

  private async resolveEnvLeases(input: McpExecutionInput, plan: McpConnectionPlan): Promise<Array<{ envName: string; lease: SecretLease }>> {
    const leases: Array<{ envName: string; lease: SecretLease }> = [];
    for (const envName of plan.connection.envVarNames) {
      const secretId = input.secretEnvMap?.[envName] ?? process.env[`MCP_SECRET_${envName}`];
      if (!secretId) {
        throw new Error(`MCP env var ${envName} requires a secret ref via MCP_SECRET_${envName}.`);
      }
      const lease = await this.secretBroker.getSecret({
        id: secretId,
        purpose: `mcp:${plan.server.id}:${envName}`,
        actor: input.actor,
        mode: input.mode,
        risk: plan.server.policy.risk,
        scope: plan.scope,
        metadata: {
          serverId: plan.server.id,
          envName,
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

  private async audit(
    input: McpExecutionInput,
    plan: McpConnectionPlan,
    status: "blocked" | "completed" | "failed",
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "mcp.executed",
      actor: input.actor,
      orgId: plan.scope.orgId,
      projectId: plan.scope.projectId,
      roomId: plan.scope.roomId,
      sessionId: plan.scope.sessionId,
      summary: `MCP ${input.operation.type} ${status}: ${plan.server.id}`,
      metadata: {
        serverId: plan.server.id,
        transport: plan.server.transport,
        operation: input.operation.type,
        target: operationTarget(input.operation),
        capabilities: plan.server.capabilities,
        envVarNames: plan.server.envVarNames,
        status,
        ...metadata,
      },
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    });
  }
}

function classifyMcpExecutionError(error: unknown): "timeout" | "transport" | "runtime" {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|abort/i.test(message)) {
    return "timeout";
  }
  if (/HTTP request failed|server exited|connection closed|fetch/i.test(message)) {
    return "transport";
  }
  return "runtime";
}

function resultMetadata(result: Omit<McpExecutionResult, "plan">): Record<string, unknown> {
  if (result.capabilities) {
    return {
      toolCount: result.capabilities.tools.length,
      resourceCount: result.capabilities.resources.length,
    };
  }
  if (result.tool) {
    return {
      ok: result.tool.ok,
      outputLength: result.tool.output?.length ?? 0,
      error: result.tool.error,
      runtimeMetadata: result.tool.metadata,
    };
  }
  if (result.resource) {
    return {
      uri: result.resource.uri,
      mimeType: result.resource.mimeType,
      textLength: result.resource.text?.length ?? 0,
      hasBlob: Boolean(result.resource.blob),
      runtimeMetadata: result.resource.metadata,
    };
  }
  return {};
}

function operationTarget(operation: McpExecutionOperation): string | undefined {
  if (operation.type === "call_tool") {
    return operation.name;
  }
  if (operation.type === "read_resource") {
    return operation.uri;
  }
  return undefined;
}

function approvalPayload(input: McpExecutionInput, plan: McpConnectionPlan): McpExecutionApprovalPayload {
  return {
    kind: "mcp_execution",
    version: 1,
    serverId: input.serverId,
    mode: input.mode,
    scope: plan.scope,
    operation: input.operation,
    timeoutMs: input.timeoutMs,
    secretEnvMap: input.secretEnvMap,
  };
}

function parseMcpApprovalPayload(value: string | undefined): McpExecutionApprovalPayload {
  if (!value) {
    throw new Error("Approval does not contain an MCP execution payload.");
  }
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed) || parsed.kind !== "mcp_execution" || parsed.version !== 1 || typeof parsed.serverId !== "string") {
    throw new Error("Approval does not contain a valid MCP execution payload.");
  }
  return {
    kind: "mcp_execution",
    version: 1,
    serverId: parsed.serverId,
    mode: parseExecutionMode(parsed.mode),
    scope: isRecord(parsed.scope) ? parseScope(parsed.scope) : undefined,
    operation: parseOperation(parsed.operation),
    timeoutMs: typeof parsed.timeoutMs === "number" ? parsed.timeoutMs : undefined,
    secretEnvMap: isRecord(parsed.secretEnvMap) ? parseStringRecord(parsed.secretEnvMap) : undefined,
  };
}

function parseOperation(value: unknown): McpExecutionOperation {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Invalid MCP approval operation.");
  }
  if (value.type === "list_capabilities") {
    return { type: "list_capabilities" };
  }
  if (value.type === "call_tool" && typeof value.name === "string" && isRecord(value.input)) {
    return { type: "call_tool", name: value.name, input: value.input };
  }
  if (value.type === "read_resource" && typeof value.uri === "string") {
    return { type: "read_resource", uri: value.uri };
  }
  throw new Error("Invalid MCP approval operation.");
}

function parseExecutionMode(value: unknown): ExecutionMode {
  if (value === "strict" || value === "balanced" || value === "trusted" || value === "full_access") {
    return value;
  }
  throw new Error("Invalid MCP approval execution mode.");
}

function parseScope(value: Record<string, unknown>): PolicyRequest["scope"] {
  return {
    orgId: typeof value.orgId === "string" ? value.orgId : undefined,
    projectId: typeof value.projectId === "string" ? value.projectId : undefined,
    roomId: typeof value.roomId === "string" ? value.roomId : undefined,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : undefined,
  };
}

function parseStringRecord(value: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new Error("Invalid MCP approval secret env map.");
    }
    output[key] = entry;
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

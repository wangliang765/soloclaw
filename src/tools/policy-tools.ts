import type { ActorRef, AuditEvent, ExecutionMode, PolicyAction, PolicyRequest, TaskRisk } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { PolicyEngine } from "../policy/policy-engine.js";
import type { JsonObject, RegisteredTool, ToolResult } from "../protocol/types.js";
import type { AgentStore } from "../store/agent-store.js";
import { commandTouchesProtectedPath } from "../hygiene/execution-hygiene.js";

export type ToolPolicyContext = {
  actor: ActorRef;
  mode: ExecutionMode;
  risk: TaskRisk;
  policy: PolicyEngine;
  store?: AgentStore;
  scope?: PolicyRequest["scope"] | (() => PolicyRequest["scope"] | Promise<PolicyRequest["scope"]>);
  roomId?: string;
  sessionId?: string | (() => string | undefined);
};

export function withPolicy(tools: RegisteredTool[], context: ToolPolicyContext): RegisteredTool[] {
  return tools.map((tool) => {
    return {
      ...tool,
      handler: async (input) => runWithPolicy(tool, input, context),
    };
  });
}

async function runWithPolicy(tool: RegisteredTool, input: JsonObject, context: ToolPolicyContext): Promise<ToolResult> {
  const toolCallId = typeof input.__toolCallId === "string" ? input.__toolCallId : undefined;
  const cleanInput = stripInternalInput(input);
  const action = tool.policy?.action ?? policyActionForTool(tool.name, cleanInput);
  const risk = tool.policy?.risk ?? context.risk;

  if (!action) {
    return tool.handler(cleanInput);
  }

  await audit(context, "tool.requested", `${tool.name} requested`, { tool: tool.name, action, input: safeInput(cleanInput) });

  const scope = await resolvePolicyScope(context);
  const decision = await context.policy.evaluate({
    actor: context.actor,
    action,
    mode: context.mode,
    risk,
    scope,
    metadata: {
      tool: tool.name,
      input: safeInput(cleanInput),
    },
    requestedAt: new Date().toISOString(),
  });

  if (decision.type === "deny") {
    await audit(context, "tool.denied", `${tool.name} denied: ${decision.reason}`, { tool: tool.name, action, decision });
    return {
      callId: tool.name,
      ok: false,
      error: {
        code: "policy_denied",
        message: decision.reason,
      },
    };
  }

  if (decision.type === "ask") {
    const approvalId = makeId<"ArtifactId">("appr");
    const sessionId = resolveSessionId(context);
    await context.store?.createApprovalRequest({
      id: approvalId,
      status: "pending",
      requestedBy: context.actor,
      action,
      reason: decision.reason,
      approverHint: decision.approverHint,
      orgId: scope.orgId,
      projectId: scope.projectId,
      roomId: scope.roomId,
      sessionId,
      toolName: tool.name,
      inputSummary: JSON.stringify(safeInput(cleanInput)),
      createdAt: new Date().toISOString(),
    });
    const now = new Date().toISOString();
    await context.store?.createPendingToolCall({
      id: makeId<"ToolCallId">("pending_tool"),
      approvalId,
      toolCallId,
      sessionId,
      toolName: tool.name,
      input: cleanInput,
      requestedBy: context.actor,
      status: "pending_approval",
      createdAt: now,
      updatedAt: now,
    });
    await appendRoomApprovalEvent(context, {
      kind: "tool_request",
      body: `Approval requested: ${approvalId}\nTool: ${tool.name}\nAction: ${action}\nReason: ${decision.reason}\nApprover: ${decision.approverHint ?? "human"}`,
    });
    await audit(context, "tool.denied", `${tool.name} requires approval: ${decision.reason}`, { tool: tool.name, action, decision, approvalId });
    return {
      callId: tool.name,
      ok: false,
      error: {
        code: "approval_required",
        message: `${decision.reason} Approval request: ${approvalId}. Approver: ${decision.approverHint ?? "human"}.`,
      },
      data: {
        approvalId,
      },
    };
  }

  const result = await tool.handler(cleanInput);
  await audit(context, result.ok ? "tool.completed" : "tool.denied", `${tool.name} completed`, {
    tool: tool.name,
    action,
    input: safeInput(cleanInput),
    ok: result.ok,
    error: result.error,
  });
  return result;
}

function resolveSessionId(context: ToolPolicyContext): string | undefined {
  return typeof context.sessionId === "function" ? context.sessionId() : context.sessionId;
}

async function resolvePolicyScope(context: ToolPolicyContext): Promise<PolicyRequest["scope"]> {
  const base = typeof context.scope === "function" ? await context.scope() : context.scope;
  const scope: PolicyRequest["scope"] = { ...(base ?? {}) };
  const sessionId = resolveSessionId(context);
  if (sessionId) {
    scope.sessionId ??= sessionId;
    const session = await context.store?.getSession(sessionId);
    scope.orgId ??= session?.orgId;
    scope.projectId ??= session?.projectId;
    scope.roomId ??= session?.roomId;
  }
  if (context.roomId) {
    scope.roomId ??= context.roomId;
  }
  if (scope.roomId) {
    const room = await context.store?.getRoom(scope.roomId);
    scope.projectId ??= room?.projectId;
  }
  if (scope.projectId) {
    const project = await context.store?.getProject(scope.projectId);
    scope.orgId ??= project?.orgId;
  }
  return scope;
}

function policyActionForTool(toolName: string, input: JsonObject): PolicyAction | undefined {
  if (toolName.startsWith("plugin.")) {
    return "plugin.execute";
  }
  switch (toolName) {
    case "list_files":
    case "read_file":
    case "search_text":
      return "workspace.read";
    case "run_command":
      return policyActionForWorkspaceCommand(String(input.command ?? ""), typeof input.executionProfile === "string" ? input.executionProfile : undefined);
    case "apply_patch":
    case "create_file":
    case "replace_range":
      return "workspace.write";
    default:
      return undefined;
  }
}

export function policyActionForWorkspaceCommand(command: string, executionProfile?: string): PolicyAction {
  const normalized = normalizeCommand(command);
  const profileAction = policyActionForCommandExecutionProfile(executionProfile);
  if (profileAction) {
    const commandAction = policyActionForWorkspaceCommand(command);
    if (commandAction === "shell.run.safe") {
      return profileAction;
    }
    if (profileAction === "shell.run.high_risk" || commandAction === "shell.run.high_risk") {
      return "shell.run.high_risk";
    }
    if (profileAction === "dependency.install" || commandAction === "dependency.install") {
      return "dependency.install";
    }
    if (profileAction === "git.mutation" || commandAction === "git.mutation") {
      return "git.mutation";
    }
  }
  if (commandTouchesProtectedPath(command)) {
    return "shell.run.high_risk";
  }
  if (isDependencyInstallCommand(normalized)) {
    return "dependency.install";
  }
  if (isGitMutationCommand(normalized)) {
    return "git.mutation";
  }
  if (isHighRiskShellCommand(normalized)) {
    return "shell.run.high_risk";
  }
  return "shell.run.safe";
}

function policyActionForCommandExecutionProfile(executionProfile?: string): PolicyAction | undefined {
  switch (executionProfile) {
    case "local-workspace-write":
      return "workspace.write";
    case "local-network":
      return "dependency.install";
    case "local-full-access":
      return "shell.run.high_risk";
    default:
      return undefined;
  }
}

function normalizeCommand(command: string): string {
  return command
    .toLowerCase()
    .replace(/[`'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isDependencyInstallCommand(command: string): boolean {
  return [
    /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|ci|add)\b/,
    /\b(?:pip|pip3)\s+install\b/,
    /\bpython(?:3)?\s+-m\s+pip\s+install\b/,
    /\buv\s+(?:pip\s+install|sync|add)\b/,
    /\bpoetry\s+(?:install|add)\b/,
    /\bpipenv\s+install\b/,
    /\bcargo\s+(?:add|install)\b/,
    /\bgo\s+get\b/,
    /\bcomposer\s+(?:install|require)\b/,
    /\bgem\s+install\b/,
  ].some((pattern) => pattern.test(command));
}

function isGitMutationCommand(command: string): boolean {
  return [
    /\bgit\s+(?:reset|clean|commit|push|pull|merge|rebase|cherry-pick|revert|stash|restore|rm|mv)\b/,
    /\bgit\s+(?:checkout|switch)\s+(?:-[^\s]*\s+)*(?:-b|-B|-c|-C)\b/,
    /\bgit\s+branch\s+(?:-[^\s]*[dDmM][^\s]*|-m|-M)\b/,
    /\bgit\s+tag\s+(?:-[^\s]*d[^\s]*|-\w*d\w*)\b/,
  ].some((pattern) => pattern.test(command));
}

function isHighRiskShellCommand(command: string): boolean {
  return [
    /\b(?:rm|del|rmdir|remove-item)\b/,
    /\b(?:chmod|chown|icacls|takeown)\b/,
    /\b(?:curl|wget|invoke-webrequest|iwr)\b/,
    /\bpowershell(?:\.exe)?\s+-encodedcommand\b/,
  ].some((pattern) => pattern.test(command));
}

function safeInput(input: JsonObject): JsonObject {
  const clone: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    clone[key] = key.toLowerCase().includes("secret") || key.toLowerCase().includes("token") ? "[REDACTED]" : value;
  }
  return clone;
}

function stripInternalInput(input: JsonObject): JsonObject {
  const { __toolCallId: _toolCallId, ...clean } = input;
  return clean;
}

async function audit(context: ToolPolicyContext, type: AuditEvent["type"], summary: string, metadata: Record<string, unknown>): Promise<void> {
  const scope = await resolvePolicyScope(context);
  await context.store?.recordAuditEvent({
    id: makeId<"ArtifactId">("audit"),
    type,
    actor: context.actor,
    orgId: scope.orgId,
    projectId: scope.projectId,
    roomId: scope.roomId,
    sessionId: scope.sessionId,
    summary,
    metadata,
    createdAt: new Date().toISOString(),
  });
}

async function appendRoomApprovalEvent(context: ToolPolicyContext, input: { kind: "tool_request" | "approval"; body: string }): Promise<void> {
  if (!context.store || !context.roomId) {
    return;
  }
  await context.store.appendRoomMessage({
    id: makeId<"MessageId">("msg"),
    roomId: context.roomId as Parameters<AgentStore["appendRoomMessage"]>[0]["roomId"],
    sender: context.actor,
    kind: input.kind,
    body: input.body,
    createdAt: new Date().toISOString(),
    artifactRefs: [],
  });
}

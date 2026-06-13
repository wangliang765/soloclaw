import type { ActorRef, Timestamp } from "./common.js";

export type ExecutionMode = "strict" | "balanced" | "trusted" | "full_access";
export type TaskRisk = "low" | "medium" | "high" | "critical";

export type AutomationSettings = {
  autoRead: boolean;
  autoWrite: boolean;
  autoRunTests: boolean;
  autoInstallDependencies: boolean;
  autoCreateBranch: boolean;
  autoCommit: boolean;
  autoPush: boolean;
  autoOpenPr: boolean;
  autoUpdatePr: boolean;
  autoIterateOnCiFailure: boolean;
  autoAgentApproval: boolean;
};

export type PolicyAction =
  | "workspace.read"
  | "workspace.write"
  | "shell.run.safe"
  | "shell.run.high_risk"
  | "dependency.install"
  | "git.mutation"
  | "git.branch.create"
  | "git.commit.create"
  | "git.push"
  | "git.pr.create"
  | "secret.read"
  | "plugin.execute"
  | "mcp.connect"
  | "mcp.tool.call"
  | "mcp.resource.read"
  | "knowledge.read"
  | "room.message.send"
  | "room.member.approve"
  | "room.member.alias"
  | "room.member.role"
  | "room.member.status"
  | "room.delivery.ack"
  | "tool.approve"
  | "spec.plan.approve";

export type PolicyRequest = {
  actor: ActorRef;
  action: PolicyAction;
  mode: ExecutionMode;
  risk: TaskRisk;
  scope: {
    orgId?: string;
    projectId?: string;
    roomId?: string;
    sessionId?: string;
  };
  metadata?: Record<string, unknown>;
  requestedAt: Timestamp;
};

export type PolicyDecision =
  | { type: "allow"; reason: string }
  | { type: "deny"; reason: string }
  | { type: "ask"; reason: string; approverHint?: "human" | "agent_super_approval" | "quorum" };

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  autoRead: true,
  autoWrite: false,
  autoRunTests: true,
  autoInstallDependencies: false,
  autoCreateBranch: true,
  autoCommit: false,
  autoPush: false,
  autoOpenPr: false,
  autoUpdatePr: false,
  autoIterateOnCiFailure: false,
  autoAgentApproval: false,
};

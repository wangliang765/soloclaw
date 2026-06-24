import type { ExecutionTargetMode } from "../domain/index.js";

export type AgentModePolicy = {
  mode: ExecutionTargetMode;
  label: "Plan" | "Build" | "Goal";
  description: string;
  allowTools: boolean;
  allowWorkspaceWrites: boolean;
  durableObjective: boolean;
  defaultBudget: {
    maxSteps?: number;
    maxModelCalls?: number;
    maxDurationMs?: number;
    maxRepeatedToolCalls: number;
    maxIdleSteps: number;
  };
};

export function agentModePolicy(mode: ExecutionTargetMode): AgentModePolicy {
  if (mode === "plan") {
    return {
      mode,
      label: "Plan",
      description: "Plan-file-only planning",
      allowTools: false,
      allowWorkspaceWrites: false,
      durableObjective: false,
      defaultBudget: { maxSteps: 8, maxRepeatedToolCalls: 3, maxIdleSteps: 4 },
    };
  }

  if (mode === "goal") {
    return {
      mode,
      label: "Goal",
      description: "Durable objective",
      allowTools: true,
      allowWorkspaceWrites: true,
      durableObjective: true,
      defaultBudget: { maxRepeatedToolCalls: 3, maxIdleSteps: 10 },
    };
  }

  return {
    mode: "build",
    label: "Build",
    description: "Workspace execution",
    allowTools: true,
    allowWorkspaceWrites: true,
    durableObjective: false,
    defaultBudget: { maxRepeatedToolCalls: 3, maxIdleSteps: 8 },
  };
}

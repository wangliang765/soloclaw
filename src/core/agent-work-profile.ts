import type { RegisteredTool } from "../protocol/types.js";

export type AgentWorkProfileName = "build" | "plan" | "explore" | "debug" | "review" | "docs" | "evidence" | "release";

export type AgentWorkProfile = {
  name: AgentWorkProfileName;
  description: string;
  visibleTools: string[];
  commandPolicyHint: "none" | "safe" | "ask-writes" | "ask-all";
};

const PROFILES: Record<AgentWorkProfileName, AgentWorkProfile> = {
  build: {
    name: "build",
    description: "Default implementation profile with workspace tools and policy-gated shell access.",
    visibleTools: ["list_files", "read_file", "search_text", "todowrite", "run_command", "apply_patch", "create_file", "replace_range", "load_skill"],
    commandPolicyHint: "ask-writes",
  },
  plan: {
    name: "plan",
    description: "Planning profile. The existing target mode still disables tools when targetMode=plan.",
    visibleTools: ["list_files", "read_file", "search_text", "load_skill"],
    commandPolicyHint: "none",
  },
  explore: {
    name: "explore",
    description: "Read-only codebase exploration.",
    visibleTools: ["list_files", "read_file", "search_text", "load_skill"],
    commandPolicyHint: "none",
  },
  debug: {
    name: "debug",
    description: "Failure investigation with read tools and safe commands before edits.",
    visibleTools: ["list_files", "read_file", "search_text", "todowrite", "run_command", "load_skill"],
    commandPolicyHint: "safe",
  },
  review: {
    name: "review",
    description: "Code review without edits.",
    visibleTools: ["list_files", "read_file", "search_text", "run_command", "load_skill"],
    commandPolicyHint: "safe",
  },
  docs: {
    name: "docs",
    description: "Documentation writing with workspace file edits and no default command need.",
    visibleTools: ["list_files", "read_file", "search_text", "todowrite", "apply_patch", "create_file", "replace_range", "load_skill"],
    commandPolicyHint: "ask-all",
  },
  evidence: {
    name: "evidence",
    description: "Phase gate, smoke, and evidence collection profile.",
    visibleTools: ["list_files", "read_file", "search_text", "todowrite", "run_command", "apply_patch", "replace_range", "load_skill"],
    commandPolicyHint: "safe",
  },
  release: {
    name: "release",
    description: "Release-sensitive profile that should route Git, network, and secret actions through approval.",
    visibleTools: ["list_files", "read_file", "search_text", "todowrite", "run_command", "load_skill"],
    commandPolicyHint: "ask-all",
  },
};

export function agentWorkProfile(name: AgentWorkProfileName | undefined): AgentWorkProfile {
  return PROFILES[name ?? "build"];
}

export function parseAgentWorkProfile(value: string): AgentWorkProfileName {
  if (value in PROFILES) {
    return value as AgentWorkProfileName;
  }
  throw new Error(`Unknown agent profile: ${value}`);
}

export function filterToolsForWorkProfile(tools: RegisteredTool[], profile: AgentWorkProfile): RegisteredTool[] {
  const allowed = new Set(profile.visibleTools);
  return tools.filter((tool) => allowed.has(tool.name) || tool.name.startsWith("plugin_") || tool.name.startsWith("plugin."));
}

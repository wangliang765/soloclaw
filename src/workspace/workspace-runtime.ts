export type ReadFileInput = {
  path: string;
  startLine?: number;
  endLine?: number;
};

export type RunCommandInput = {
  command: string;
  timeoutMs?: number;
  executionProfile?: CommandExecutionProfileName;
};

export const COMMAND_EXECUTION_PROFILE_NAMES = [
  "local-safe",
  "local-workspace-write",
  "local-network",
  "local-full-access",
] as const;

export type CommandExecutionProfileName = typeof COMMAND_EXECUTION_PROFILE_NAMES[number];

export type CommandExecutionProfile = {
  name: CommandExecutionProfileName;
  filesystem: "workspace_cwd" | "host_shell";
  workspaceWrite: "not_requested" | "allowed";
  network: "not_requested" | "allowed";
  enforcement: "policy_and_audit";
  summary: string;
};

export type RunCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  executionProfile: CommandExecutionProfile;
};

export function commandExecutionProfile(name: CommandExecutionProfileName = "local-safe"): CommandExecutionProfile {
  switch (name) {
    case "local-safe":
      return {
        name,
        filesystem: "workspace_cwd",
        workspaceWrite: "not_requested",
        network: "not_requested",
        enforcement: "policy_and_audit",
        summary: "Local shell in workspace cwd; writes/network are not requested and are controlled by policy/audit.",
      };
    case "local-workspace-write":
      return {
        name,
        filesystem: "workspace_cwd",
        workspaceWrite: "allowed",
        network: "not_requested",
        enforcement: "policy_and_audit",
        summary: "Local shell in workspace cwd; workspace writes are expected and policy-gated.",
      };
    case "local-network":
      return {
        name,
        filesystem: "workspace_cwd",
        workspaceWrite: "allowed",
        network: "allowed",
        enforcement: "policy_and_audit",
        summary: "Local shell in workspace cwd; network/dependency operations are expected and policy-gated.",
      };
    case "local-full-access":
      return {
        name,
        filesystem: "host_shell",
        workspaceWrite: "allowed",
        network: "allowed",
        enforcement: "policy_and_audit",
        summary: "Local host shell for high-risk operations; allowed only after policy approval.",
      };
  }
}

export type CreateFileInput = {
  path: string;
  content: string;
  overwrite?: boolean;
};

export type ReplaceRangeInput = {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
};

export type WriteResult = {
  path: string;
  beforeHash?: string;
  afterHash: string;
  summary: string;
};

export type PatchFileResult = {
  path: string;
  operation: "create" | "modify" | "delete";
  beforeHash?: string;
  afterHash?: string;
  summary: string;
};

export type PatchApplyResult = {
  summary: string;
  hunks: number;
  files: PatchFileResult[];
};

export interface WorkspaceRuntime {
  listFiles(path: string): Promise<string[]>;
  readFile(input: ReadFileInput): Promise<string>;
  searchText(query: string, glob?: string): Promise<string>;
  runCommand(input: RunCommandInput): Promise<RunCommandResult>;
  applyPatch(patch: string): Promise<PatchApplyResult>;
  createFile(input: CreateFileInput): Promise<WriteResult>;
  replaceRange(input: ReplaceRangeInput): Promise<WriteResult>;
}

import type { WorkspaceRuntime } from "./workspace-runtime.js";
import { LocalWorkspaceRuntime } from "./local-workspace-runtime.js";
import { JsonRpcWorkspaceRuntime, StdioJsonRpcWorkspaceRuntimeTransport } from "./json-rpc-workspace-runtime.js";
import { findSoloclawAgentRunner } from "../platform/soloclaw-platform.js";

export type WorkspaceRuntimeMode = "typescript" | "rust" | "auto";

export type WorkspaceRuntimeSelection = {
  requestedMode: WorkspaceRuntimeMode;
  selectedMode: "typescript" | "rust";
  runnerPath?: string;
  fallbackReason?: string;
};

export type WorkspaceRuntimeResolverOptions = {
  mode?: WorkspaceRuntimeMode;
  runnerPath?: string;
  env?: Record<string, string | undefined>;
  repoRoot?: string;
};

export async function resolveWorkspaceRuntime(
  workspaceRoot: string,
  options: WorkspaceRuntimeResolverOptions = {},
): Promise<{ runtime: WorkspaceRuntime; selection: WorkspaceRuntimeSelection }> {
  const requestedMode = options.mode ?? parseWorkspaceRuntimeMode(options.env?.SOLOCLAW_WORKSPACE_RUNTIME ?? process.env.SOLOCLAW_WORKSPACE_RUNTIME, "typescript");
  if (requestedMode === "typescript") {
    return {
      runtime: new LocalWorkspaceRuntime(workspaceRoot),
      selection: { requestedMode, selectedMode: "typescript" },
    };
  }

  const runner = await resolveRunner(options);
  if (runner.path) {
    return {
      runtime: new JsonRpcWorkspaceRuntime(new StdioJsonRpcWorkspaceRuntimeTransport({
        command: runner.path,
        args: ["--root", workspaceRoot],
        cwd: options.repoRoot,
      })),
      selection: {
        requestedMode,
        selectedMode: "rust",
        runnerPath: runner.path,
      },
    };
  }

  if (requestedMode === "rust") {
    throw new Error(`Rust workspace runtime requested but no agent-runner was found: ${runner.reason}`);
  }

  return {
    runtime: new LocalWorkspaceRuntime(workspaceRoot),
    selection: {
      requestedMode,
      selectedMode: "typescript",
      fallbackReason: runner.reason,
    },
  };
}

export function parseWorkspaceRuntimeMode(value: string | undefined, fallback: WorkspaceRuntimeMode = "typescript"): WorkspaceRuntimeMode {
  if (!value) {
    return fallback;
  }
  if (value === "typescript" || value === "rust" || value === "auto") {
    return value;
  }
  throw new Error(`Invalid workspace runtime mode: ${value}. Expected typescript, rust, or auto.`);
}

async function resolveRunner(options: WorkspaceRuntimeResolverOptions): Promise<{ path?: string; reason: string }> {
  const envRunner = options.runnerPath ?? options.env?.SOLOCLAW_AGENT_RUNNER ?? process.env.SOLOCLAW_AGENT_RUNNER;
  if (envRunner) {
    const runner = await findSoloclawAgentRunner({
      env: { ...(options.env ?? process.env), SOLOCLAW_AGENT_RUNNER: envRunner },
      repoRoot: options.repoRoot,
    });
    return runner.available && runner.path
      ? { path: runner.path, reason: "SOLOCLAW_AGENT_RUNNER is available" }
      : { reason: `SOLOCLAW_AGENT_RUNNER is not executable or does not exist: ${envRunner}` };
  }

  const runner = await findSoloclawAgentRunner({
    env: options.env,
    repoRoot: options.repoRoot,
  });
  return runner.available && runner.path
    ? { path: runner.path, reason: "repo target agent-runner is available" }
    : { reason: "agent-runner was not found in SOLOCLAW_AGENT_RUNNER or target/debug" };
}

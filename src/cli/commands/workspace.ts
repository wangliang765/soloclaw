import type { CommandModule } from "../command-router.js";

export type WorkspaceHistoryLike = {
  activeWorkspace?: string;
  entries: unknown[];
};

export type WorkspaceCommandDeps<THistory extends WorkspaceHistoryLike> = {
  cwd(): string;
  readHistory(historyRoot: string): Promise<THistory>;
  historyPath(historyRoot: string): string;
  resolvePath(historyRoot: string, workspacePath: string): string;
  recordHistoryEntry(historyRoot: string, workspace: string): Promise<string>;
  resolveWorkspaceSelector(historyRoot: string, selector: string, relativeRoot: string): Promise<string>;
  renderHistory(history: THistory): void;
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createWorkspaceCommand<THistory extends WorkspaceHistoryLike>(
  deps: WorkspaceCommandDeps<THistory>,
): CommandModule<void> {
  return {
    name: "workspace",
    summary: "Manage recent workspaces",
    execute: async ({ args: rawArgs }) => {
      const subcommand = rawArgs[0] ?? "list";
      const historyRoot = deps.cwd();
      try {
        if (subcommand === "list" || subcommand === "ls" || subcommand === "recent") {
          const json = rawArgs.slice(1).includes("--json");
          const history = await deps.readHistory(historyRoot);
          if (json) {
            deps.writeJson({
              configPath: deps.historyPath(historyRoot),
              activeWorkspace: history.activeWorkspace,
              entries: history.entries,
            });
          } else {
            deps.renderHistory(history);
          }
          return { matched: true };
        }

        if (subcommand === "add") {
          const workspacePath = rawArgs[1];
          if (!workspacePath) {
            deps.writeError("Usage: soloclaw workspace add <path>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const workspace = await deps.recordHistoryEntry(historyRoot, deps.resolvePath(historyRoot, workspacePath));
          deps.writeText(`workspace=${workspace}`);
          deps.writeText(`config=${deps.historyPath(historyRoot)}`);
          return { matched: true };
        }

        if (subcommand === "use" || subcommand === "select") {
          const selector = rawArgs[1];
          if (!selector) {
            deps.writeError("Usage: soloclaw workspace use <number|path>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const workspace = await deps.resolveWorkspaceSelector(historyRoot, selector, historyRoot);
          await deps.recordHistoryEntry(historyRoot, workspace);
          deps.writeText(`workspace=${workspace}`);
          deps.writeText(`active=${workspace}`);
          deps.writeText(`config=${deps.historyPath(historyRoot)}`);
          deps.writeText(`next=soloclaw tui --workspace "${workspace}"`);
          return { matched: true };
        }

        deps.writeError(`Unknown workspace command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

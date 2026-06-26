import type { CommandModule } from "../command-router.js";

export type QuickstartCommandDeps<TView> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  stripWorkspaceOption(args: string[]): string[];
  buildQuickstart(cwd: string, workspace: string): Promise<TView>;
  renderQuickstart(view: TView): void;
  writeJson(value: TView): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createQuickstartCommand<TView>(deps: QuickstartCommandDeps<TView>): CommandModule<void> {
  return {
    name: "quickstart",
    summary: "Print first-run setup steps",
    execute: async ({ args }) => {
      try {
        const cwd = deps.cwd();
        const workspace = await deps.resolveWorkspace(cwd, args);
        const strippedArgs = deps.stripWorkspaceOption(args);
        const view = await deps.buildQuickstart(cwd, workspace);
        if (strippedArgs.includes("--json")) {
          deps.writeJson(view);
        } else {
          deps.renderQuickstart(view);
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

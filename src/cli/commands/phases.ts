import type { CommandModule } from "../command-router.js";

export type PhaseCommandDeps<TPhaseOneReadiness> = {
  cwd(): string;
  verifyPhaseOneReadiness(cwd: string): Promise<TPhaseOneReadiness>;
  renderPhaseOneReadiness(result: TPhaseOneReadiness): void;
  handlePhaseTwoCommand(args: string[], cwd: string): Promise<void>;
  handlePhaseThreeCommand(args: string[], cwd: string): Promise<void>;
  handlePhaseFourCommand(args: string[], cwd: string): Promise<void>;
  handlePhaseFiveCommand(args: string[], cwd: string): Promise<void>;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createPhaseCommands<TPhaseOneReadiness>(
  deps: PhaseCommandDeps<TPhaseOneReadiness>,
): CommandModule<void>[] {
  return [
    createPhaseOneCommand(deps),
    createPhaseHandlerCommand("phase2", "Run Phase 2 engineering execution gates", deps.handlePhaseTwoCommand, deps),
    createPhaseHandlerCommand("phase3", "Run Phase 3 runtime reliability gates", deps.handlePhaseThreeCommand, deps),
    createPhaseHandlerCommand("phase4", "Run Phase 4 platform support gates", deps.handlePhaseFourCommand, deps),
    createPhaseHandlerCommand("phase5", "Run Phase 5 room collaboration gates", deps.handlePhaseFiveCommand, deps),
  ];
}

function createPhaseOneCommand<TPhaseOneReadiness>(
  deps: PhaseCommandDeps<TPhaseOneReadiness>,
): CommandModule<void> {
  return {
    name: "phase1",
    summary: "Verify Phase 1 local readiness",
    execute: async ({ args }) => {
      const subcommand = args[0] ?? "verify";
      if (subcommand !== "verify" && subcommand !== "check") {
        deps.writeError("Usage: agent phase1 verify [--json]");
        deps.setExitCode(1);
        return { matched: true };
      }
      try {
        const result = await deps.verifyPhaseOneReadiness(deps.cwd());
        if (args.slice(1).includes("--json")) {
          deps.writeJson(result);
        } else {
          deps.renderPhaseOneReadiness(result);
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

function createPhaseHandlerCommand<TPhaseOneReadiness>(
  name: "phase2" | "phase3" | "phase4" | "phase5",
  summary: string,
  handler: (args: string[], cwd: string) => Promise<void>,
  deps: PhaseCommandDeps<TPhaseOneReadiness>,
): CommandModule<void> {
  return {
    name,
    summary,
    execute: async ({ args }) => {
      await handler(args, deps.cwd());
      return { matched: true };
    },
  };
}

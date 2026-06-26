import type { CommandModule } from "../command-router.js";

export type HygieneFinding = {
  severity: "info" | "warning" | "error";
  rule: string;
  path: string;
  message: string;
};

export type HygieneCommandDeps<TFinding extends HygieneFinding> = {
  cwd(): string;
  scan(cwd: string): Promise<TFinding[]>;
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createHygieneCommand<TFinding extends HygieneFinding>(
  deps: HygieneCommandDeps<TFinding>,
): CommandModule<void> {
  return {
    name: "hygiene",
    summary: "Scan workspace execution hygiene",
    execute: async ({ args }) => {
      const subcommand = args[0] ?? "check";
      if (subcommand !== "check") {
        deps.writeError(`Unknown hygiene command: ${subcommand}`);
        deps.setExitCode(1);
        return { matched: true };
      }
      const json = args.includes("--json");
      const findings = await deps.scan(deps.cwd());
      if (json) {
        deps.writeJson({ findings, count: findings.length });
      } else if (findings.length === 0) {
        deps.writeText("Workspace hygiene check passed.");
      } else {
        for (const finding of findings) {
          deps.writeText(`${finding.severity}\t${finding.rule}\t${finding.path}\t${finding.message}`);
        }
      }
      deps.setExitCode(findings.some((finding) => finding.severity === "error") ? 1 : 0);
      return { matched: true };
    },
  };
}

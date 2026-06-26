import type { CommandModule } from "../command-router.js";

export type InitCommandDeps<TView> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  stripWorkspaceOption(args: string[]): string[];
  initializeWorkspace(cwd: string, workspace: string, args: string[]): Promise<{ json: boolean; view: TView }>;
  renderInit(view: TView): void;
  writeJson(value: TView): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createInitCommand<TView>(deps: InitCommandDeps<TView>): CommandModule<void> {
  return {
    name: "init",
    aliases: ["setup"],
    summary: "Initialize or configure a Soloclaw workspace",
    execute: async ({ args }) => {
      try {
        const cwd = deps.cwd();
        const workspace = await deps.resolveWorkspace(cwd, args);
        const result = await deps.initializeWorkspace(cwd, workspace, deps.stripWorkspaceOption(args));
        if (result.json) {
          deps.writeJson(result.view);
        } else {
          deps.renderInit(result.view);
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

export type TuiCommandDeps = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  startTui(workspace: string, historyRoot: string): Promise<void>;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createTuiCommand(deps: TuiCommandDeps): CommandModule<void> {
  return {
    name: "tui",
    summary: "Start the interactive TUI",
    execute: async ({ args }) => {
      try {
        const cwd = deps.cwd();
        await deps.startTui(await deps.resolveWorkspace(cwd, args), cwd);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

export type LocalAgentPlatform<TStore> = {
  store: TStore;
  close(): void;
};

export type LocalAgentCommandDeps<TOptions extends { json?: boolean }, TStore, TStatus extends { servicePlan: unknown }, TLogs> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  stripWorkspaceOption(args: string[]): string[];
  parseArgs(args: string[]): { options: TOptions };
  openPlatform(workspace: string): Promise<LocalAgentPlatform<TStore>>;
  buildStatus(store: TStore, workspace: string, options: TOptions): Promise<TStatus>;
  buildLogs(store: TStore, workspace: string, options: TOptions): Promise<TLogs>;
  renderStatus(status: TStatus): void;
  renderServicePlan(plan: TStatus["servicePlan"]): void;
  renderLogs(logs: TLogs): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createLocalAgentCommand<TOptions extends { json?: boolean }, TStore, TStatus extends { servicePlan: unknown }, TLogs>(
  deps: LocalAgentCommandDeps<TOptions, TStore, TStatus, TLogs>,
): CommandModule<void> {
  return {
    name: "local",
    aliases: ["agent"],
    summary: "Inspect local agent status and daemon plans",
    execute: async ({ args }) => {
      const cwd = deps.cwd();
      let platform: LocalAgentPlatform<TStore> | undefined;
      try {
        const workspace = await deps.resolveWorkspace(cwd, args);
        const cleanArgs = deps.stripWorkspaceOption(args);
        const subcommand = cleanArgs[0] ?? "status";
        const parsed = deps.parseArgs(cleanArgs.slice(1));
        platform = await deps.openPlatform(workspace);
        if (subcommand === "status") {
          const status = await deps.buildStatus(platform.store, workspace, parsed.options);
          if (parsed.options.json) {
            deps.writeJson(status);
          } else {
            deps.renderStatus(status);
          }
          return { matched: true };
        }
        if (subcommand === "service" || subcommand === "daemon") {
          const status = await deps.buildStatus(platform.store, workspace, parsed.options);
          if (parsed.options.json) {
            deps.writeJson(status.servicePlan);
          } else {
            deps.renderServicePlan(status.servicePlan);
          }
          return { matched: true };
        }
        if (subcommand === "logs" || subcommand === "timeline") {
          const logs = await deps.buildLogs(platform.store, workspace, parsed.options);
          if (parsed.options.json) {
            deps.writeJson(logs);
          } else {
            deps.renderLogs(logs);
          }
          return { matched: true };
        }
        deps.writeError(`Unknown local agent command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform?.close();
      }
      return { matched: true };
    },
  };
}

export type StatusCommandDeps<TView> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  buildStatus(cwd: string, workspace: string): Promise<TView>;
  renderStatus(view: TView): void;
  writeJson(value: TView): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createStatusCommand<TView>(deps: StatusCommandDeps<TView>): CommandModule<void> {
  return {
    name: "status",
    summary: "Show local Soloclaw status",
    execute: async ({ args }) => {
      try {
        const cwd = deps.cwd();
        const workspace = await deps.resolveWorkspace(cwd, args);
        const status = await deps.buildStatus(cwd, workspace);
        if (args.includes("--json")) {
          deps.writeJson(status);
        } else {
          deps.renderStatus(status);
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

export type DoctorCommandDeps<TView> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  stripWorkspaceOption(args: string[]): string[];
  verifyReadiness(workspace: string): Promise<TView>;
  renderReadiness(view: TView): void;
  writeJson(value: TView): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createDoctorCommand<TView>(deps: DoctorCommandDeps<TView>): CommandModule<void> {
  return {
    name: "doctor",
    aliases: ["check"],
    summary: "Run local readiness checks",
    execute: async ({ args }) => {
      try {
        const cwd = deps.cwd();
        const workspace = await deps.resolveWorkspace(cwd, args);
        const strippedArgs = deps.stripWorkspaceOption(args);
        const result = await deps.verifyReadiness(workspace);
        if (strippedArgs.includes("--json")) {
          deps.writeJson(result);
        } else {
          deps.renderReadiness(result);
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

export type PlatformCommandDeps<TCapabilities, TView> = {
  detectCapabilities(): Promise<TCapabilities>;
  usesLegacyConfig(): Promise<boolean>;
  buildDoctorView(capabilities: TCapabilities, legacyConfig: boolean): TView;
  renderDoctor(capabilities: TCapabilities): void;
  writeJson(value: TView): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createPlatformCommand<TCapabilities, TView>(
  deps: PlatformCommandDeps<TCapabilities, TView>,
): CommandModule<void> {
  return {
    name: "platform",
    summary: "Show platform diagnostics",
    execute: async ({ args }) => {
      const subcommand = args[0] ?? "doctor";
      if (subcommand !== "doctor" && subcommand !== "check") {
        deps.writeError("Usage: soloclaw platform doctor [--json]");
        deps.setExitCode(1);
        return { matched: true };
      }

      try {
        const capabilities = await deps.detectCapabilities();
        if (args.slice(1).includes("--json")) {
          deps.writeJson(deps.buildDoctorView(capabilities, await deps.usesLegacyConfig()));
        } else {
          deps.renderDoctor(capabilities);
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

export type InspectCommandOptions = {
  json: boolean;
  includeKeyFiles: boolean;
  maxKeyFiles?: number;
  maxPreviewLines?: number;
  maxPreviewChars?: number;
};

export type InspectPreviewLimits = {
  maxFiles?: number;
  maxLines?: number;
  maxChars?: number;
};

export type InspectCommandDeps<TSnapshot, TKeyFilePreviews> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  stripWorkspaceOption(args: string[]): string[];
  parseInspectArgs(args: string[]): InspectCommandOptions;
  collectSnapshot(workspace: string): Promise<TSnapshot>;
  collectKeyFilePreviews(
    workspace: string,
    snapshot: TSnapshot,
    limits: InspectPreviewLimits,
  ): Promise<TKeyFilePreviews>;
  renderSnapshot(snapshot: TSnapshot): string;
  renderFilePreviews(previews: TKeyFilePreviews): string;
  now(): Date;
  writeText(text: string): void;
  writeJson(value: {
    generatedAt: string;
    root: string;
    snapshot: TSnapshot;
    keyFilePreviews?: TKeyFilePreviews;
    text: string;
  }): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createInspectCommand<TSnapshot, TKeyFilePreviews>(
  deps: InspectCommandDeps<TSnapshot, TKeyFilePreviews>,
): CommandModule<void> {
  return {
    name: "inspect",
    summary: "Inspect workspace files and project signals",
    execute: async ({ args }) => {
      try {
        const cwd = deps.cwd();
        const workspace = await deps.resolveWorkspace(cwd, args);
        const inspectArgs = deps.stripWorkspaceOption(args);
        const options = deps.parseInspectArgs(inspectArgs);
        const snapshot = await deps.collectSnapshot(workspace);
        const keyFilePreviews = options.includeKeyFiles
          ? await deps.collectKeyFilePreviews(workspace, snapshot, {
              maxFiles: options.maxKeyFiles,
              maxLines: options.maxPreviewLines,
              maxChars: options.maxPreviewChars,
            })
          : undefined;
        const previewText = keyFilePreviews ? deps.renderFilePreviews(keyFilePreviews) : "";
        const text = [deps.renderSnapshot(snapshot), previewText].filter(Boolean).join("\n\n");
        if (options.json) {
          deps.writeJson({
            generatedAt: deps.now().toISOString(),
            root: workspace,
            snapshot,
            keyFilePreviews,
            text,
          });
        } else {
          deps.writeText(text);
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

export type SmokeCommandDeps<TRichTuiSmoke, TRealProviderSmoke extends { ok: boolean }> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  runDefaultSmoke(workspace: string): Promise<string>;
  runRichTuiSmoke(workspace: string): Promise<TRichTuiSmoke>;
  runRichTuiRealProviderSmoke(workspace: string, options?: { longTask?: boolean }): Promise<TRealProviderSmoke>;
  formatRichTuiSmoke(result: TRichTuiSmoke): string;
  formatRichTuiRealProviderSmoke(result: TRealProviderSmoke): string;
  writeText(text: string): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createSmokeCommand<TRichTuiSmoke, TRealProviderSmoke extends { ok: boolean }>(
  deps: SmokeCommandDeps<TRichTuiSmoke, TRealProviderSmoke>,
): CommandModule<void> {
  return {
    name: "smoke",
    summary: "Run local smoke checks",
    execute: async ({ args }) => {
      try {
        const workspace = await deps.resolveWorkspace(deps.cwd(), args);
        if (args.includes("--rich-tui-real-provider-long-task") || args.includes("rich-tui-real-provider-long-task")) {
          const result = await deps.runRichTuiRealProviderSmoke(workspace, { longTask: true });
          deps.writeText(deps.formatRichTuiRealProviderSmoke(result));
          if (!result.ok) {
            deps.setExitCode(1);
          }
          return { matched: true };
        }
        if (args.includes("--rich-tui-real-provider") || args.includes("rich-tui-real-provider")) {
          const result = await deps.runRichTuiRealProviderSmoke(workspace);
          deps.writeText(deps.formatRichTuiRealProviderSmoke(result));
          if (!result.ok) {
            deps.setExitCode(1);
          }
          return { matched: true };
        }
        if (args.includes("--rich-tui") || args.includes("rich-tui")) {
          deps.writeText(deps.formatRichTuiSmoke(await deps.runRichTuiSmoke(workspace)));
          return { matched: true };
        }
        deps.writeText(await deps.runDefaultSmoke(workspace));
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

export type WorkbenchSessionReport = {
  session: {
    targetMode: string;
  };
  summary: {
    changedPaths: string[];
    pendingApprovals: number;
    failedToolResults: number;
  };
  commandEvents: Array<{
    command?: string;
    exitCode?: number | null;
  }>;
};

export type WorkbenchCompletionGate = {
  status: string;
  missingEvidence: unknown;
  summary: string;
};

export type WorkbenchVerifyView = {
  kind: "workbench_completion_gate";
  generatedAt: string;
  sessionId: string;
  status: string;
  missingEvidence: unknown;
  summary: string;
  signals: {
    targetMode: string;
    changedFiles: number;
    commandEvents: number;
    pendingApprovals: number;
    failedToolResults: number;
  };
  reviewCommands: {
    report: string;
    verify: string;
  };
};

export type WorkbenchVerifyCommandDeps<TStore, TReport extends WorkbenchSessionReport> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  stripWorkspaceOption(args: string[]): string[];
  openStore(workspace: string): Promise<{ store: TStore; close(): void }>;
  buildReport(store: TStore, sessionId: string): Promise<TReport>;
  evaluateGate(input: {
    targetMode: TReport["session"]["targetMode"];
    changedFiles: TReport["summary"]["changedPaths"];
    commandEvents: Array<{ command?: string; exitCode?: number }>;
    pendingApprovalCount: TReport["summary"]["pendingApprovals"];
    failedToolCount: TReport["summary"]["failedToolResults"];
  }): WorkbenchCompletionGate;
  now(): Date;
  writeText(text: string): void;
  writeJson(value: WorkbenchVerifyView): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createWorkbenchVerifyCommand<TStore, TReport extends WorkbenchSessionReport>(
  deps: WorkbenchVerifyCommandDeps<TStore, TReport>,
): CommandModule<void> {
  const usage = "Usage: agent workbench verify <session-id> [--json]";

  return {
    name: "workbench",
    summary: "Run workbench completion checks",
    execute: async ({ args }) => {
      const subcommand = args[0];
      const sessionId = args[1];
      const commandArgs = args.slice(2);
      if (subcommand !== "verify" || !sessionId) {
        deps.writeError(usage);
        deps.setExitCode(1);
        return { matched: true };
      }

      let opened: { store: TStore; close(): void } | undefined;
      try {
        const workspace = await deps.resolveWorkspace(deps.cwd(), commandArgs);
        const cleanArgs = deps.stripWorkspaceOption(commandArgs);
        opened = await deps.openStore(workspace);
        const report = await deps.buildReport(opened.store, sessionId);
        const gate = deps.evaluateGate({
          targetMode: report.session.targetMode,
          changedFiles: report.summary.changedPaths,
          commandEvents: report.commandEvents.map((event) => ({
            command: event.command,
            exitCode: event.exitCode ?? undefined,
          })),
          pendingApprovalCount: report.summary.pendingApprovals,
          failedToolCount: report.summary.failedToolResults,
        });
        const view: WorkbenchVerifyView = {
          kind: "workbench_completion_gate",
          generatedAt: deps.now().toISOString(),
          sessionId,
          status: gate.status,
          missingEvidence: gate.missingEvidence,
          summary: gate.summary,
          signals: {
            targetMode: report.session.targetMode,
            changedFiles: report.summary.changedPaths.length,
            commandEvents: report.commandEvents.length,
            pendingApprovals: report.summary.pendingApprovals,
            failedToolResults: report.summary.failedToolResults,
          },
          reviewCommands: {
            report: `agent session report ${sessionId} --json`,
            verify: `agent workbench verify ${sessionId} --json`,
          },
        };
        if (cleanArgs.includes("--json")) {
          deps.writeJson(view);
        } else {
          deps.writeText(`${view.status}\t${view.summary}`);
          deps.writeText(`changedFiles=${view.signals.changedFiles}\tcommands=${view.signals.commandEvents}\tpendingApprovals=${view.signals.pendingApprovals}\tfailedToolResults=${view.signals.failedToolResults}`);
        }
        if (gate.status === "block") {
          deps.setExitCode(1);
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        opened?.close();
      }
      return { matched: true };
    },
  };
}

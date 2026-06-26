import type { CommandModule } from "../command-router.js";
import type { ListAuditEventsInput } from "../../store/agent-store.js";
import type { PolicyAction } from "../../domain/policy.js";
import type { CommandExecutionProfileName } from "../../workspace/workspace-runtime.js";

export type ClosableSessionStore = {
  close?(): void;
};

export type SessionLookupStore = ClosableSessionStore & {
  getSession(sessionId: string): Promise<unknown | undefined>;
  getMessages(sessionId: string): Promise<unknown[]>;
  getToolResults(sessionId: string): Promise<unknown[]>;
};

export type SessionLifecycleOptions = {
  json?: boolean;
  output?: string;
  limit?: number;
  summary?: string;
  force?: boolean;
  allowNoCommand?: boolean;
  preset?: unknown;
  requireChange?: boolean;
  requirePatch?: boolean;
  requireRecovery?: boolean;
  requireTimeout?: boolean;
  requireDiffStat?: boolean;
  requireReviewProfile?: boolean;
  requireModelCall?: boolean;
  requireNoPendingApprovals?: boolean;
  requiredExecutionProfiles?: unknown;
  requiredApprovalActions?: unknown;
};

export type SessionLifecycle<TActor> = {
  compactSession(input: { sessionId: string; actor: TActor; summary?: string; force?: boolean }): Promise<{
    sessionId: string;
    messagesDeleted: number;
    toolCallsDeleted: number;
  }>;
  deleteSession(input: { sessionId: string; actor: TActor; force?: boolean }): Promise<void>;
};

export type SessionControlTasks<TActor> = {
  pause(input: { sessionId: string; actor: TActor; reason?: string }): Promise<SessionControlResult>;
  cancel(input: { sessionId: string; actor: TActor; reason?: string }): Promise<SessionControlResult>;
};

export type SessionControlResult = {
  id: string;
  status: string;
  updatedAt: string;
  objective: string;
};

export type SessionControlCommandDeps<TStore extends ClosableSessionStore, TActor> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  stripWorkspaceOption(args: string[]): string[];
  createPlatform(workspace: string): Promise<{ store: TStore; tasks: SessionControlTasks<TActor> }>;
  localUserActor(): TActor;
  writeText(text: string): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export type SessionCommandDeps<TStore extends ClosableSessionStore, TOptions extends SessionLifecycleOptions, TActor> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  stripWorkspaceOption(args: string[]): string[];
  parseLifecycleArgs(args: string[]): { options: TOptions; positionals: string[] };
  createPlatform(workspace: string): Promise<{ store: TStore; lifecycle: SessionLifecycle<TActor> }>;
  localUserActor(): TActor;
  buildDiff(store: TStore, sessionId: string): Promise<unknown>;
  buildReport(store: TStore, sessionId: string): Promise<unknown>;
  buildStatus(store: TStore, sessionId: string, options: { limit?: number }): Promise<unknown>;
  buildInspect(store: TStore, sessionId: string): Promise<unknown>;
  buildTimeline(store: TStore, sessionId: string, options: { limit?: number }): Promise<unknown>;
  buildReview(store: TStore, sessionId: string, options: { limit?: number }): Promise<unknown>;
  buildBundle(store: TStore, sessionId: string, options: SessionVerificationOptions<TOptions> & { workspace: string; limit?: number }): Promise<unknown>;
  buildResult(store: TStore, sessionId: string): Promise<unknown>;
  buildNext(store: TStore, sessionId: string): Promise<unknown>;
  buildVerification(store: TStore, sessionId: string, options: SessionVerificationOptions<TOptions>): Promise<{ status?: string } & Record<string, unknown>>;
  writeBundleOutput(workspace: string, outputPath: string, bundle: unknown): Promise<{ path: string; bytes: number }>;
  renderDiff(view: unknown): void;
  renderReport(view: unknown): void;
  renderStatus(view: unknown): void;
  renderInspect(view: unknown): void;
  renderTimeline(view: unknown): void;
  renderReview(view: unknown): void;
  renderBundle(view: unknown): void;
  renderResult(view: unknown): void;
  renderNext(view: unknown): void;
  renderVerification(view: unknown): void;
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export type SessionVerificationOptions<TOptions extends SessionLifecycleOptions> = Pick<
  TOptions,
  | "preset"
  | "requireChange"
  | "requirePatch"
  | "requireRecovery"
  | "requireTimeout"
  | "requireDiffStat"
  | "requireReviewProfile"
  | "requireModelCall"
  | "requireNoPendingApprovals"
  | "requiredExecutionProfiles"
  | "requiredApprovalActions"
> & {
  requireCommand: boolean;
};

export type SessionsCommandDeps<TStore extends ClosableSessionStore, TOptions, TList> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  stripWorkspaceOption(args: string[]): string[];
  parseListArgs(args: string[]): { options: TOptions; positionals: string[] };
  createPlatform(workspace: string): Promise<{ store: TStore }>;
  buildList(store: TStore, options: TOptions): Promise<TList>;
  renderList(list: TList): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export type ChangesStore = ClosableSessionStore & {
  listFileChanges(sessionId?: string): Promise<SessionFileChange[]>;
};

export type SessionFileChange = {
  id: string;
  kind: string;
  createdAt: string;
  path: string;
  summary: string;
};

export type ChangesCommandDeps<TStore extends ChangesStore> = {
  cwd(): string;
  createPlatform(cwd: string): Promise<{ store: TStore }>;
  writeText(text: string): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export type ArtifactCommandOptions<TKind extends string = string, TStatus extends string = string> = {
  kind?: TKind;
  name?: string;
  uri?: string;
  mimeType?: string;
  orgId?: string;
  projectId?: string;
  sessionId?: string;
  roomId?: string;
  status?: TStatus;
  limit?: number;
  deleteFile?: boolean;
  force?: boolean;
};

export type ArtifactRecordLike = {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  name: string;
  projectId?: string;
  sessionId?: string;
  sizeBytes?: number;
  deletedAt?: string;
};

export type ArtifactStore<TKind extends string, TStatus extends string> = ClosableSessionStore & {
  listArtifacts(input: {
    status?: TStatus;
    projectId?: string;
    sessionId?: string;
    roomId?: string;
    kind?: TKind;
    limit?: number;
  }): Promise<ArtifactRecordLike[]>;
};

export type ArtifactLifecycle<TKind extends string, TStatus extends string, TActor> = {
  registerArtifact(input: {
    kind: TKind;
    name?: string;
    path?: string;
    uri?: string;
    mimeType?: string;
    orgId?: string;
    projectId?: string;
    sessionId?: string;
    roomId?: string;
    actor: TActor;
  }): Promise<ArtifactRecordLike>;
  deleteArtifact(input: {
    artifactId: string;
    actor: TActor;
    deleteFile?: boolean;
    force?: boolean;
  }): Promise<ArtifactRecordLike>;
};

export type ArtifactsCommandDeps<
  TStore extends ArtifactStore<TKind, TStatus>,
  TKind extends string,
  TStatus extends string,
  TActor,
> = {
  cwd(): string;
  parseArtifactArgs(args: string[]): { options: ArtifactCommandOptions<TKind, TStatus>; positionals: string[] };
  createPlatform(cwd: string): Promise<{ store: TStore; lifecycle: ArtifactLifecycle<TKind, TStatus, TActor> }>;
  localUserActor(): TActor;
  writeText(text: string): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export type ApprovalRequestLike = {
  id: string;
  status: string;
  action: string;
  createdAt: string;
  toolName?: string;
  reason: string;
};

export type ApprovalsStore = ClosableSessionStore & {
  listApprovalRequests(status?: string): Promise<ApprovalRequestLike[]>;
};

export type ApprovalsCommandDeps<TStore extends ApprovalsStore> = {
  cwd(): string;
  createPlatform(cwd: string): Promise<{ store: TStore }>;
  writeText(text: string): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export type AuditEventLine = {
  createdAt: string;
  type: string;
  actor: { type: string; id: string };
  sessionId?: string;
  roomId?: string;
  summary: string;
};

export type AuditCommandStore<TEvent extends AuditEventLine> = ClosableSessionStore & {
  listAuditEvents(input?: ListAuditEventsInput): Promise<TEvent[]>;
  getProject(projectId: string): Promise<{ retentionPolicyId?: string } | undefined>;
  getRetentionPolicy(policyId: string): Promise<{ name: string; allowAuditExport?: boolean } | undefined>;
};

export type AuditExportFormat = "jsonl" | "json" | "bundle";

export type AuditCommandOptions = {
  format: AuditExportFormat;
  output?: string;
};

export type AuditExportServiceLike<TBundle> = {
  export(input: { filters: ListAuditEventsInput; format: AuditExportFormat }): Promise<{
    count: number;
    output: string;
    bundle?: { signature?: string };
  }>;
  verifyBundle(bundle: TBundle): Promise<string>;
};

export type AuditCommandDeps<TStore extends AuditCommandStore<TEvent>, TIdentity, TBundle, TEvent extends AuditEventLine> = {
  cwd(): string;
  createPlatform(cwd: string): Promise<{ store: TStore; identity: TIdentity }>;
  createExportService(input: { store: TStore; identity: TIdentity }): AuditExportServiceLike<TBundle>;
  readUtf8(filePath: string): Promise<string>;
  writeFileOutput(outputPath: string, output: string): Promise<void>;
  writeRaw(text: string): void;
  writeText(text: string): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export type ReplayPlatform<TStore extends ClosableSessionStore, TWorkspace, TLocks, TPlugins> = {
  workspace: TWorkspace;
  store: TStore;
  locks: TLocks;
  plugins: TPlugins;
};

export type ReplayCommandDeps<TStore extends ClosableSessionStore, TWorkspace, TLocks, TPlugins, TActor, TTool> = {
  cwd(): string;
  createPlatform(cwd: string): Promise<ReplayPlatform<TStore, TWorkspace, TLocks, TPlugins>>;
  localUserActor(): TActor;
  createWorkspaceTools(input: { workspace: TWorkspace; store: TStore; locks: TLocks; actor: TActor }): TTool[];
  createPluginTools(input: { plugins: TPlugins; store: TStore; actor: TActor }): Promise<TTool[]>;
  replayApprovedTool(input: { approvalId: string; store: TStore; actor: TActor; tools: TTool[] }): Promise<unknown>;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export type ApprovalDecisionCliOptions = {
  actor?: string;
  localAgent?: boolean;
  autoReplay?: boolean;
  autoResume?: boolean;
  queueResumeWorkerId?: string;
};

export type ApprovalDecisionParsed<TOptions extends ApprovalDecisionCliOptions> = {
  options: TOptions;
  positionals: string[];
};

export type ApprovalDecisionRequestLike<TAction extends string> = {
  id: string;
  status: string;
  action: TAction;
  decisionReason?: string;
};

export type ApprovalDecisionPendingToolCallLike = {
  id: string;
  sessionId?: string;
  toolName: string;
};

export type ApprovalDecisionStore<TAction extends string> = ClosableSessionStore & {
  listApprovalRequests(): Promise<Array<{ id: string; action: TAction }>>;
  getPendingToolCallByApproval(approvalId: string): Promise<ApprovalDecisionPendingToolCallLike | undefined>;
};

export type ApprovalDecisionPlatform<
  TStore extends ApprovalDecisionStore<TAction>,
  TAction extends string,
  TAgent,
  TWorkspace,
  TRooms,
  TLocks,
  TLocalAgent,
  TPlugins,
  TOrganizations,
  TPolicy,
  TSecretBroker,
  TRedactor,
  TTaskBroker,
> = {
  agent: TAgent;
  workspace: TWorkspace;
  store: TStore;
  rooms: TRooms;
  locks: TLocks;
  localAgent: TLocalAgent;
  plugins: TPlugins;
  organizations: TOrganizations;
  policy: TPolicy;
  secretBroker: TSecretBroker;
  redactor: TRedactor;
  taskBroker: TTaskBroker;
};

export type ApprovalDecisionCommandDeps<
  TStore extends ApprovalDecisionStore<TAction>,
  TAction extends string,
  TOptions extends ApprovalDecisionCliOptions,
  TApproval extends ApprovalDecisionRequestLike<TAction>,
  TActor,
  TAgent extends { resume(sessionId: string): Promise<string> },
  TWorkspace,
  TRooms,
  TLocks,
  TLocalAgent,
  TPlugins,
  TOrganizations,
  TPolicy,
  TSecretBroker,
  TRedactor,
  TTaskBroker extends {
    enqueue(input: {
      actor: TActor;
      workerId: string;
      sessionId: string;
      metadata: {
        continuation: "approval_resume";
        approvalId: string;
        pendingToolCallId: string;
        toolName: string;
      };
    }): Promise<{ id: string; workerId: string }>;
  },
  TTool,
> = {
  cwd(): string;
  parseApprovalArgs(args: string[]): ApprovalDecisionParsed<TOptions>;
  createPlatform(cwd: string): Promise<ApprovalDecisionPlatform<
    TStore,
    TAction,
    TAgent,
    TWorkspace,
    TRooms,
    TLocks,
    TLocalAgent,
    TPlugins,
    TOrganizations,
    TPolicy,
    TSecretBroker,
    TRedactor,
    TTaskBroker
  >>;
  decideApproval(input: {
    store: TStore;
    rooms: TRooms;
    organizations: TOrganizations;
    localAgent: TLocalAgent;
    approvalId: string;
    status: "approved" | "denied";
    options: Pick<TOptions, "actor" | "localAgent">;
    reason?: string;
  }): Promise<{ approval?: TApproval; decidedBy: TActor }>;
  isMcpApprovalAction(action: TAction): boolean;
  executeApprovedMcp(input: {
    platform: ApprovalDecisionPlatform<
      TStore,
      TAction,
      TAgent,
      TWorkspace,
      TRooms,
      TLocks,
      TLocalAgent,
      TPlugins,
      TOrganizations,
      TPolicy,
      TSecretBroker,
      TRedactor,
      TTaskBroker
    >;
    approvalId: string;
    actor: TActor;
  }): Promise<unknown>;
  createWorkspaceTools(input: { workspace: TWorkspace; store: TStore; locks: TLocks; actor: TActor; sessionId?: string }): TTool[];
  createPluginTools(input: { plugins: TPlugins; store: TStore; actor: TActor; sessionId?: string }): Promise<TTool[]>;
  replayApprovedTool(input: { approvalId: string; store: TStore; actor: TActor; tools: TTool[] }): Promise<{ ok?: boolean } & Record<string, unknown>>;
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export type ResumeCliOptions = SessionLifecycleOptions & {
  sessionResult?: boolean;
  verifySession?: boolean;
  requireModelReady?: boolean;
  requiredExecutionProfiles?: CommandExecutionProfileName[];
  requiredApprovalActions?: PolicyAction[];
};

export type ResumeAgent = {
  resume(sessionId: string): Promise<string>;
};

export type ResumeStore = ClosableSessionStore & {
  getSession(sessionId: string): Promise<unknown | undefined>;
};

export type ResumeVerificationOptions = {
  requireChange?: boolean;
  requirePatch?: boolean;
  requireRecovery?: boolean;
  requireTimeout?: boolean;
  requireDiffStat?: boolean;
  requireReviewProfile?: boolean;
  requireModelCall?: boolean;
  requireNoPendingApprovals?: boolean;
  requiredExecutionProfiles?: CommandExecutionProfileName[];
  requiredApprovalActions?: PolicyAction[];
  requireCommand: boolean;
};

export type ResumeCommandDeps<
  TStore extends ResumeStore,
  TOptions,
  TCli extends ResumeCliOptions,
> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  stripWorkspaceOption(args: string[]): string[];
  parseResumeArgs(args: string[]): { options: TOptions; cli: TCli };
  buildModelReadiness(workspace: string, options: TOptions): Promise<{ ready?: boolean } & Record<string, unknown>>;
  createPlatform(workspace: string, options: TOptions): Promise<{ agent: ResumeAgent; store: TStore }>;
  buildResult(store: TStore, sessionId: string): Promise<unknown>;
  buildVerification(store: TStore, sessionId: string, options: ResumeVerificationOptions): Promise<{ status?: string } & Record<string, unknown>>;
  renderModelReadiness(view: unknown): void;
  renderResult(view: unknown): void;
  renderVerification(view: unknown): void;
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
  now(): Date;
};

export function createArtifactsCommand<
  TStore extends ArtifactStore<TKind, TStatus>,
  TKind extends string,
  TStatus extends string,
  TActor,
>(
  deps: ArtifactsCommandDeps<TStore, TKind, TStatus, TActor>,
): CommandModule<void> {
  return {
    name: "artifacts",
    summary: "Register, list, and delete local artifacts",
    execute: async ({ args: commandArgs }) => {
      const subcommand = commandArgs[0] ?? "list";
      const args = commandArgs.slice(1);
      let platform: { store: TStore; lifecycle: ArtifactLifecycle<TKind, TStatus, TActor> } | undefined;
      try {
        platform = await deps.createPlatform(deps.cwd());
        const actor = deps.localUserActor();
        if (subcommand === "add") {
          const parsed = deps.parseArtifactArgs(args);
          const artifactPath = parsed.positionals[0];
          if (!artifactPath && !parsed.options.uri) {
            deps.writeError("Usage: agent artifacts add <path> [--kind kind] [--name name] [--project id] [--session id] [--room id] [--uri uri]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const artifact = await platform.lifecycle.registerArtifact({
            kind: (parsed.options.kind ?? "other") as TKind,
            name: parsed.options.name,
            path: artifactPath,
            uri: parsed.options.uri,
            mimeType: parsed.options.mimeType,
            orgId: parsed.options.orgId,
            projectId: parsed.options.projectId,
            sessionId: parsed.options.sessionId,
            roomId: parsed.options.roomId,
            actor,
          });
          deps.writeText(`${artifact.id}\t${artifact.kind}\t${artifact.status}\t${artifact.sizeBytes ?? "-"}\t${artifact.name}`);
          return { matched: true };
        }
        if (subcommand === "list") {
          const parsed = deps.parseArtifactArgs(args);
          const artifacts = await platform.store.listArtifacts({
            status: parsed.options.status,
            projectId: parsed.options.projectId,
            sessionId: parsed.options.sessionId,
            roomId: parsed.options.roomId,
            kind: parsed.options.kind,
            limit: parsed.options.limit,
          });
          for (const artifact of artifacts) {
            deps.writeText(
              `${artifact.id}\t${artifact.status}\t${artifact.kind}\t${artifact.createdAt}\t${artifact.projectId ?? "-"}\t${artifact.sessionId ?? "-"}\t${artifact.name}`,
            );
          }
          return { matched: true };
        }
        if (subcommand === "delete") {
          const artifactId = args[0];
          const parsed = deps.parseArtifactArgs(args.slice(1));
          if (!artifactId) {
            deps.writeError("Usage: agent artifacts delete <artifact-id> [--delete-file] [--force]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const artifact = await platform.lifecycle.deleteArtifact({
            artifactId,
            actor,
            deleteFile: parsed.options.deleteFile,
            force: parsed.options.force,
          });
          deps.writeText(`${artifact.id}\t${artifact.status}\tdeleted_at=${artifact.deletedAt ?? "-"}`);
          return { matched: true };
        }
        deps.writeError(`Unknown artifacts command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform?.store.close?.();
      }
      return { matched: true };
    },
  };
}

export function createApprovalsCommand<TStore extends ApprovalsStore>(
  deps: ApprovalsCommandDeps<TStore>,
): CommandModule<void> {
  return {
    name: "approvals",
    summary: "List approval requests",
    execute: async ({ args }) => {
      const status = args[0];
      let platform: { store: TStore } | undefined;
      try {
        platform = await deps.createPlatform(deps.cwd());
        const approvals = await platform.store.listApprovalRequests(status);
        for (const approval of approvals) {
          deps.writeText(formatApprovalRequestLine(approval));
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform?.store.close?.();
      }
      return { matched: true };
    },
  };
}

export function createAuditCommand<
  TStore extends AuditCommandStore<TEvent>,
  TIdentity,
  TBundle extends { exportId?: string; eventCount?: number; eventsSha256?: string },
  TEvent extends AuditEventLine = AuditEventLine,
>(
  deps: AuditCommandDeps<TStore, TIdentity, TBundle, TEvent>,
): CommandModule<void> {
  return {
    name: "audit",
    summary: "List, export, and verify audit events",
    execute: async ({ args: rawArgs }) => {
      const subcommand = rawArgs[0] ?? "list";
      const args = rawArgs.slice(1);
      let platform: { store: TStore; identity: TIdentity } | undefined;
      try {
        const parsed = parseAuditCommandArgs(args);
        platform = await deps.createPlatform(deps.cwd());
        const service = () => deps.createExportService({
          store: platform!.store,
          identity: platform!.identity,
        });

        if (subcommand === "list") {
          const events = await platform.store.listAuditEvents(parsed.filters);
          for (const event of events) {
            deps.writeText(formatAuditEventLine(event));
          }
          return { matched: true };
        }

        if (subcommand === "export") {
          await ensureAuditExportAllowed(platform.store, parsed.filters);
          const exported = await service().export({
            filters: parsed.filters,
            format: parsed.options.format,
          });
          if (parsed.options.output) {
            await deps.writeFileOutput(parsed.options.output, exported.output);
            const signatureStatus = exported.bundle?.signature ? "signed" : "unsigned";
            deps.writeText(`${exported.count}\t${parsed.options.format}\t${signatureStatus}\t${parsed.options.output}`);
          } else {
            deps.writeRaw(exported.output);
          }
          return { matched: true };
        }

        if (subcommand === "verify") {
          const filePath = args[0];
          if (!filePath) {
            deps.writeError("Usage: agent audit verify <bundle-path>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const bundle = JSON.parse(await deps.readUtf8(filePath)) as TBundle;
          const status = await service().verifyBundle(bundle);
          deps.writeText(`${status}\t${bundle.exportId ?? "-"}\tcount=${bundle.eventCount ?? "-"}\tsha256=${bundle.eventsSha256 ?? "-"}`);
          if (status !== "valid") {
            deps.setExitCode(2);
          }
          return { matched: true };
        }

        deps.writeError(`Unknown audit command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform?.store.close?.();
      }
      return { matched: true };
    },
  };
}

export function createReplayCommand<TStore extends ClosableSessionStore, TWorkspace, TLocks, TPlugins, TActor, TTool>(
  deps: ReplayCommandDeps<TStore, TWorkspace, TLocks, TPlugins, TActor, TTool>,
): CommandModule<void> {
  return {
    name: "replay",
    summary: "Replay an approved pending tool call",
    execute: async ({ args }) => {
      const approvalId = args[0];
      if (!approvalId) {
        deps.writeError("Missing approval id.");
        deps.setExitCode(1);
        return { matched: true };
      }

      let platform: ReplayPlatform<TStore, TWorkspace, TLocks, TPlugins> | undefined;
      try {
        platform = await deps.createPlatform(deps.cwd());
        const actor = deps.localUserActor();
        const pluginTools = await deps.createPluginTools({
          plugins: platform.plugins,
          store: platform.store,
          actor,
        });
        const workspaceTools = deps.createWorkspaceTools({
          workspace: platform.workspace,
          store: platform.store,
          locks: platform.locks,
          actor,
        });
        const result = await deps.replayApprovedTool({
          approvalId,
          store: platform.store,
          actor,
          tools: workspaceTools.concat(pluginTools),
        });
        deps.writeJson(result);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform?.store.close?.();
      }
      return { matched: true };
    },
  };
}

export function createApprovalDecisionCommand<
  TStore extends ApprovalDecisionStore<TAction>,
  TAction extends string,
  TOptions extends ApprovalDecisionCliOptions,
  TApproval extends ApprovalDecisionRequestLike<TAction>,
  TActor,
  TAgent extends { resume(sessionId: string): Promise<string> },
  TWorkspace,
  TRooms,
  TLocks,
  TLocalAgent,
  TPlugins,
  TOrganizations,
  TPolicy,
  TSecretBroker,
  TRedactor,
  TTaskBroker extends {
    enqueue(input: {
      actor: TActor;
      workerId: string;
      sessionId: string;
      metadata: {
        continuation: "approval_resume";
        approvalId: string;
        pendingToolCallId: string;
        toolName: string;
      };
    }): Promise<{ id: string; workerId: string }>;
  },
  TTool,
>(
  deps: ApprovalDecisionCommandDeps<
    TStore,
    TAction,
    TOptions,
    TApproval,
    TActor,
    TAgent,
    TWorkspace,
    TRooms,
    TLocks,
    TLocalAgent,
    TPlugins,
    TOrganizations,
    TPolicy,
    TSecretBroker,
    TRedactor,
    TTaskBroker,
    TTool
  >,
): CommandModule<void> {
  return {
    name: "approve",
    aliases: ["deny"],
    summary: "Approve or deny a pending approval request",
    execute: async ({ command, args }) => {
      const parsed = deps.parseApprovalArgs(args);
      const approvalId = parsed.positionals[0];
      const reason = parsed.positionals.slice(1).join(" ").trim() || undefined;
      if (!approvalId) {
        deps.writeError("Missing approval id.");
        deps.setExitCode(1);
        return { matched: true };
      }

      let platform: ApprovalDecisionPlatform<
        TStore,
        TAction,
        TAgent,
        TWorkspace,
        TRooms,
        TLocks,
        TLocalAgent,
        TPlugins,
        TOrganizations,
        TPolicy,
        TSecretBroker,
        TRedactor,
        TTaskBroker
      > | undefined;
      try {
        platform = await deps.createPlatform(deps.cwd());
        if (parsed.options.autoResume && parsed.options.queueResumeWorkerId) {
          throw new Error("--auto-resume and --queue-resume are mutually exclusive.");
        }

        const existingApproval = (await platform.store.listApprovalRequests()).find((candidate) => candidate.id === approvalId);
        if (existingApproval && parsed.options.queueResumeWorkerId && deps.isMcpApprovalAction(existingApproval.action)) {
          throw new Error("--queue-resume is only supported for session-scoped workspace/plugin tool approvals.");
        }

        const { approval, decidedBy } = await deps.decideApproval({
          store: platform.store,
          rooms: platform.rooms,
          organizations: platform.organizations,
          localAgent: platform.localAgent,
          approvalId,
          status: command === "deny" ? "denied" : "approved",
          options: {
            actor: parsed.options.actor,
            localAgent: parsed.options.localAgent,
          } as Pick<TOptions, "actor" | "localAgent">,
          reason,
        });
        if (!approval) {
          deps.writeError(`Approval not found: ${approvalId}`);
          deps.setExitCode(1);
          return { matched: true };
        }

        deps.writeText(formatApprovalDecisionLine(approval));
        if (command === "approve" && (parsed.options.autoReplay || parsed.options.autoResume || parsed.options.queueResumeWorkerId)) {
          if (deps.isMcpApprovalAction(approval.action)) {
            if (parsed.options.queueResumeWorkerId) {
              throw new Error("--queue-resume is only supported for session-scoped workspace/plugin tool approvals.");
            }
            const mcpResult = await deps.executeApprovedMcp({
              platform,
              approvalId,
              actor: decidedBy,
            });
            deps.writeJson({ mcp: mcpResult });
          } else {
            const pending = await platform.store.getPendingToolCallByApproval(approvalId);
            const pluginTools = await deps.createPluginTools({
              plugins: platform.plugins,
              store: platform.store,
              actor: decidedBy,
              sessionId: pending?.sessionId,
            });
            const replayResult = await deps.replayApprovedTool({
              approvalId,
              store: platform.store,
              actor: decidedBy,
              tools: deps.createWorkspaceTools({
                workspace: platform.workspace,
                store: platform.store,
                locks: platform.locks,
                actor: decidedBy,
                sessionId: pending?.sessionId,
              }).concat(pluginTools),
            });
            deps.writeJson({ replay: replayResult });
            if (parsed.options.queueResumeWorkerId) {
              if (!pending?.sessionId) {
                throw new Error(`Approval ${approvalId} has no session to queue for resume.`);
              }
              if (!replayResult.ok) {
                throw new Error("Approved tool replay failed; session was not queued for resume.");
              }
              const assignment = await platform.taskBroker.enqueue({
                actor: decidedBy,
                workerId: parsed.options.queueResumeWorkerId,
                sessionId: pending.sessionId,
                metadata: {
                  continuation: "approval_resume",
                  approvalId,
                  pendingToolCallId: pending.id,
                  toolName: pending.toolName,
                },
              });
              deps.writeText(`queued_resume\t${assignment.id}\t${assignment.workerId}\t${pending.sessionId}`);
            }
            if (parsed.options.autoResume && pending?.sessionId && replayResult.ok) {
              deps.writeText(await platform.agent.resume(pending.sessionId));
            }
          }
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform?.store.close?.();
      }
      return { matched: true };
    },
  };
}

export function createResumeCommand<
  TStore extends ResumeStore,
  TOptions,
  TCli extends ResumeCliOptions,
>(
  deps: ResumeCommandDeps<TStore, TOptions, TCli>,
): CommandModule<void> {
  return {
    name: "resume",
    summary: "Resume a paused or stopped session",
    execute: async ({ args }) => {
      const sessionId = args[0];
      if (!sessionId) {
        deps.writeError("Missing session id.");
        deps.setExitCode(1);
        return { matched: true };
      }

      let platform: { agent: ResumeAgent; store: TStore } | undefined;
      try {
        const resumeArgs = args.slice(1);
        const workspace = await deps.resolveWorkspace(deps.cwd(), resumeArgs);
        const parsed = deps.parseResumeArgs(deps.stripWorkspaceOption(resumeArgs));

        if (parsed.cli.requireModelReady) {
          const modelReadiness = await deps.buildModelReadiness(workspace, parsed.options);
          if (!modelReadiness.ready) {
            if (parsed.cli.json) {
              deps.writeJson({
                generatedAt: deps.now().toISOString(),
                status: "blocked",
                workspace,
                sessionId,
                modelReadiness,
              });
            } else {
              deps.writeText("Model readiness gate failed.");
              deps.renderModelReadiness(modelReadiness);
            }
            deps.setExitCode(1);
            return { matched: true };
          }
        }

        platform = await deps.createPlatform(workspace, parsed.options);
        const finalAnswer = await platform.agent.resume(sessionId);
        const session = sessionWithId(await platform.store.getSession(sessionId));
        let sessionResult: unknown | undefined;
        let verification: ({ status?: string } & Record<string, unknown>) | undefined;
        if (session && (parsed.cli.json || parsed.cli.sessionResult || parsed.cli.verifySession)) {
          sessionResult = await deps.buildResult(platform.store, session.id);
        }
        if (session && parsed.cli.verifySession) {
          verification = await deps.buildVerification(platform.store, session.id, resumeVerificationOptions(parsed.cli));
        }

        if (parsed.cli.json) {
          deps.writeJson({
            generatedAt: deps.now().toISOString(),
            workspace,
            session,
            finalAnswer,
            result: sessionResult,
            verification,
            reviewCommands: session
              ? {
                  review: `agent session review ${session.id}`,
                  result: `agent session result ${session.id}`,
                  verify: `agent session verify ${session.id}`,
                  diff: `agent session diff ${session.id}`,
                  report: `agent session report ${session.id} --json`,
                }
              : undefined,
          });
        } else {
          deps.writeText(finalAnswer);
          if (session) {
            deps.writeText("");
            deps.writeText(`session: ${session.id}`);
            deps.writeText(`review: agent session review ${session.id}`);
          }
          if (sessionResult && parsed.cli.sessionResult) {
            deps.writeText("");
            deps.renderResult(sessionResult);
          }
          if (verification) {
            deps.writeText("");
            deps.renderVerification(verification);
          }
        }
        if (verification?.status === "fail") {
          deps.setExitCode(1);
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform?.store.close?.();
      }
      return { matched: true };
    },
  };
}

export function createChangesCommand<TStore extends ChangesStore>(
  deps: ChangesCommandDeps<TStore>,
): CommandModule<void> {
  return {
    name: "changes",
    summary: "List recorded file changes",
    execute: async ({ args }) => {
      const sessionId = args[0];
      let platform: { store: TStore } | undefined;
      try {
        platform = await deps.createPlatform(deps.cwd());
        const changes = await platform.store.listFileChanges(sessionId);
        for (const change of changes) {
          deps.writeText(`${change.id}\t${change.kind}\t${change.createdAt}\t${change.path}\t${change.summary}`);
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform?.store.close?.();
      }
      return { matched: true };
    },
  };
}

export function createSessionControlCommand<TStore extends ClosableSessionStore, TActor>(
  deps: SessionControlCommandDeps<TStore, TActor>,
): CommandModule<void> {
  return {
    name: "pause",
    aliases: ["cancel"],
    summary: "Pause or cancel a session",
    execute: async ({ command, args }) => {
      const sessionId = args[0];
      const sessionArgs = args.slice(1);
      let platform: { store: TStore; tasks: SessionControlTasks<TActor> } | undefined;
      try {
        const workspace = await deps.resolveWorkspace(deps.cwd(), sessionArgs);
        const reason = deps.stripWorkspaceOption(sessionArgs).join(" ").trim() || undefined;
        if (!sessionId) {
          deps.writeError("Missing session id.");
          deps.setExitCode(1);
          return { matched: true };
        }

        platform = await deps.createPlatform(workspace);
        const input = { sessionId, actor: deps.localUserActor(), reason };
        const session = command === "cancel"
          ? await platform.tasks.cancel(input)
          : await platform.tasks.pause(input);
        deps.writeText(`${session.id}\t${session.status}\t${session.updatedAt}\t${session.objective}`);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform?.store.close?.();
      }
      return { matched: true };
    },
  };
}

export function createSessionCommand<TStore extends ClosableSessionStore, TOptions extends SessionLifecycleOptions, TActor>(
  deps: SessionCommandDeps<TStore, TOptions, TActor>,
): CommandModule<void> {
  return {
    name: "session",
    summary: "Inspect and manage session lifecycle state",
    execute: async ({ args }) => {
      const subcommand = args[0];
      const sessionId = args[1];
      const commandArgs = args.slice(2);
      let platform: { store: TStore; lifecycle: SessionLifecycle<TActor> } | undefined;
      try {
        const workspace = await deps.resolveWorkspace(deps.cwd(), commandArgs);
        const parsed = deps.parseLifecycleArgs(deps.stripWorkspaceOption(commandArgs));
        const missingUsage = sessionUsageFor(subcommand);
        if (!sessionId) {
          deps.writeError(missingUsage);
          deps.setExitCode(1);
          return { matched: true };
        }

        platform = await deps.createPlatform(workspace);
        const store = platform.store;
        if (subcommand === "diff") {
          await renderSessionView(deps.buildDiff(store, sessionId), parsed.options.json, deps.writeJson, deps.renderDiff);
          return { matched: true };
        }
        if (subcommand === "report") {
          await renderSessionView(deps.buildReport(store, sessionId), parsed.options.json, deps.writeJson, deps.renderReport);
          return { matched: true };
        }
        if (subcommand === "status") {
          await renderSessionView(deps.buildStatus(store, sessionId, { limit: parsed.options.limit }), parsed.options.json, deps.writeJson, deps.renderStatus);
          return { matched: true };
        }
        if (subcommand === "inspect") {
          await renderSessionView(deps.buildInspect(store, sessionId), parsed.options.json, deps.writeJson, deps.renderInspect);
          return { matched: true };
        }
        if (subcommand === "timeline" || subcommand === "logs") {
          await renderSessionView(deps.buildTimeline(store, sessionId, { limit: parsed.options.limit }), parsed.options.json, deps.writeJson, deps.renderTimeline);
          return { matched: true };
        }
        if (subcommand === "review") {
          await renderSessionView(deps.buildReview(store, sessionId, { limit: parsed.options.limit }), parsed.options.json, deps.writeJson, deps.renderReview);
          return { matched: true };
        }
        if (subcommand === "bundle") {
          const bundle = await deps.buildBundle(store, sessionId, {
            workspace,
            limit: parsed.options.limit,
            ...sessionVerificationOptions(parsed.options),
          });
          const output = parsed.options.output ? await deps.writeBundleOutput(workspace, parsed.options.output, bundle) : undefined;
          const printable = output ? withOutput(bundle, output) : bundle;
          if (parsed.options.json) {
            deps.writeJson(printable);
          } else {
            deps.renderBundle(printable);
          }
          return { matched: true };
        }
        if (subcommand === "result") {
          await renderSessionView(deps.buildResult(store, sessionId), parsed.options.json, deps.writeJson, deps.renderResult);
          return { matched: true };
        }
        if (subcommand === "next") {
          await renderSessionView(deps.buildNext(store, sessionId), parsed.options.json, deps.writeJson, deps.renderNext);
          return { matched: true };
        }
        if (subcommand === "verify") {
          const verification = await deps.buildVerification(store, sessionId, sessionVerificationOptions(parsed.options));
          if (parsed.options.json) {
            deps.writeJson(verification);
          } else {
            deps.renderVerification(verification);
          }
          if (verification.status !== "pass") {
            deps.setExitCode(1);
          }
          return { matched: true };
        }
        if (subcommand === "compact") {
          const result = await platform.lifecycle.compactSession({
            sessionId,
            actor: deps.localUserActor(),
            summary: parsed.options.summary,
            force: parsed.options.force,
          });
          deps.writeText(`${result.sessionId}\tmessages_deleted=${result.messagesDeleted}\ttool_calls_deleted=${result.toolCallsDeleted}`);
          return { matched: true };
        }
        if (subcommand === "delete") {
          await platform.lifecycle.deleteSession({
            sessionId,
            actor: deps.localUserActor(),
            force: parsed.options.force,
          });
          deps.writeText(`${sessionId}\tdeleted`);
          return { matched: true };
        }
        deps.writeError("Usage: agent session diff|report|status|inspect|timeline|logs|review|result|verify|compact|delete <session-id>");
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform?.store.close?.();
      }
      return { matched: true };
    },
  };
}

export function createSessionsCommand<TStore extends ClosableSessionStore, TOptions extends { json?: boolean }, TList>(
  deps: SessionsCommandDeps<TStore, TOptions, TList>,
): CommandModule<void> {
  return {
    name: "sessions",
    summary: "List recent sessions",
    execute: async ({ args }) => {
      let platform: { store: TStore } | undefined;
      try {
        const workspace = await deps.resolveWorkspace(deps.cwd(), args);
        const parsed = deps.parseListArgs(deps.stripWorkspaceOption(args));
        platform = await deps.createPlatform(workspace);
        const list = await deps.buildList(platform.store, parsed.options);
        if (parsed.options.json) {
          deps.writeJson(list);
        } else {
          deps.renderList(list);
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform?.store.close?.();
      }
      return { matched: true };
    },
  };
}

async function renderSessionView(
  viewPromise: Promise<unknown>,
  json: boolean | undefined,
  writeJson: (value: unknown) => void,
  renderText: (value: unknown) => void,
): Promise<void> {
  const view = await viewPromise;
  if (json) {
    writeJson(view);
  } else {
    renderText(view);
  }
}

function sessionVerificationOptions<TOptions extends SessionLifecycleOptions>(options: TOptions): SessionVerificationOptions<TOptions> {
  return {
    preset: options.preset,
    requireChange: options.requireChange,
    requirePatch: options.requirePatch,
    requireRecovery: options.requireRecovery,
    requireTimeout: options.requireTimeout,
    requireDiffStat: options.requireDiffStat,
    requireReviewProfile: options.requireReviewProfile,
    requireModelCall: options.requireModelCall,
    requireNoPendingApprovals: options.requireNoPendingApprovals,
    requiredExecutionProfiles: options.requiredExecutionProfiles,
    requiredApprovalActions: options.requiredApprovalActions,
    requireCommand: options.allowNoCommand !== true,
  };
}

function resumeVerificationOptions(options: ResumeCliOptions): ResumeVerificationOptions {
  return {
    requireChange: options.requireChange,
    requirePatch: options.requirePatch,
    requireRecovery: options.requireRecovery,
    requireTimeout: options.requireTimeout,
    requireDiffStat: options.requireDiffStat,
    requireReviewProfile: options.requireReviewProfile,
    requireModelCall: options.requireModelCall,
    requireNoPendingApprovals: options.requireNoPendingApprovals,
    requiredExecutionProfiles: options.requiredExecutionProfiles,
    requiredApprovalActions: options.requiredApprovalActions,
    requireCommand: options.allowNoCommand !== true,
  };
}

function sessionWithId(session: unknown): ({ id: string } & Record<string, unknown>) | undefined {
  if (session && typeof session === "object" && "id" in session && typeof session.id === "string") {
    return session as { id: string } & Record<string, unknown>;
  }
  return undefined;
}

function sessionUsageFor(subcommand: string | undefined): string {
  if (subcommand === "diff") {
    return "Usage: agent session diff <session-id> [--json]";
  }
  if (subcommand === "report") {
    return "Usage: agent session report <session-id> [--json]";
  }
  if (subcommand === "status") {
    return "Usage: agent session status <session-id> [--json]";
  }
  if (subcommand === "inspect") {
    return "Usage: agent session inspect <session-id> [--json]";
  }
  if (subcommand === "timeline" || subcommand === "logs") {
    return "Usage: agent session timeline <session-id> [--json] [--limit n]";
  }
  if (subcommand === "review") {
    return "Usage: agent session review <session-id> [--json] [--limit n]";
  }
  if (subcommand === "bundle") {
    return "Usage: agent session bundle <session-id> [--json] [--output path] [--limit n] [verification options]";
  }
  if (subcommand === "result") {
    return "Usage: agent session result <session-id> [--json]";
  }
  if (subcommand === "next") {
    return "Usage: agent session next <session-id> [--json]";
  }
  if (subcommand === "verify") {
    return "Usage: agent session verify <session-id> [--json] [--preset handoff] [--require-change] [--require-patch] [--require-recovery] [--require-timeout] [--require-diff-stat] [--require-review-profile] [--require-model-call] [--require-no-pending-approvals] [--require-execution-profile profile] [--require-approval-action action] [--allow-no-command]";
  }
  if (subcommand === "compact") {
    return "Usage: agent session compact <session-id> [--summary text] [--force]";
  }
  if (subcommand === "delete") {
    return "Usage: agent session delete <session-id> [--force]";
  }
  return "Usage: agent session diff|report|status|inspect|timeline|logs|review|result|verify|compact|delete <session-id>";
}

function withOutput(bundle: unknown, output: { path: string; bytes: number }): unknown {
  return bundle && typeof bundle === "object"
    ? { ...bundle, output }
    : { value: bundle, output };
}

function formatApprovalRequestLine(approval: ApprovalRequestLike): string {
  return `${approval.id}\t${approval.status}\t${approval.action}\t${approval.createdAt}\t${approval.toolName ?? "-"}\t${approval.reason}`;
}

function formatAuditEventLine(event: AuditEventLine): string {
  return `${event.createdAt}\t${event.type}\t${event.actor.type}:${event.actor.id}\t${event.sessionId ?? "-"}\t${event.roomId ?? "-"}\t${event.summary}`;
}

function parseAuditCommandArgs(args: string[]): { filters: ListAuditEventsInput; options: AuditCommandOptions } {
  const filters: ListAuditEventsInput = { limit: 100 };
  const options: AuditCommandOptions = { format: "jsonl" };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--limit" && next) {
      filters.limit = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--type" && next) {
      filters.type = next as ListAuditEventsInput["type"];
      index += 1;
      continue;
    }
    if (arg === "--actor" && next) {
      filters.actorId = next;
      index += 1;
      continue;
    }
    if (arg === "--session" && next) {
      filters.sessionId = next;
      index += 1;
      continue;
    }
    if (arg === "--room" && next) {
      filters.roomId = next;
      index += 1;
      continue;
    }
    if (arg === "--project" && next) {
      filters.projectId = next;
      index += 1;
      continue;
    }
    if (arg === "--from" && next) {
      filters.from = next;
      index += 1;
      continue;
    }
    if (arg === "--to" && next) {
      filters.to = next;
      index += 1;
      continue;
    }
    if (arg === "--format" && next) {
      if (next !== "jsonl" && next !== "json" && next !== "bundle") {
        throw new Error(`Unsupported audit export format: ${next}`);
      }
      options.format = next;
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      options.output = next;
      index += 1;
      continue;
    }
  }

  if (filters.limit !== undefined && (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 10000)) {
    throw new Error("--limit must be an integer between 1 and 10000.");
  }

  return { filters, options };
}

async function ensureAuditExportAllowed<TEvent extends AuditEventLine>(
  store: AuditCommandStore<TEvent>,
  filters: ListAuditEventsInput,
): Promise<void> {
  if (!filters.projectId) {
    return;
  }
  const project = await store.getProject(filters.projectId);
  if (!project?.retentionPolicyId) {
    return;
  }
  const policy = await store.getRetentionPolicy(project.retentionPolicyId);
  if (policy && !policy.allowAuditExport) {
    throw new Error(`Retention policy ${policy.name} does not allow audit export for project ${filters.projectId}.`);
  }
}

function formatApprovalDecisionLine<TAction extends string>(approval: ApprovalDecisionRequestLike<TAction>): string {
  return `${approval.id}\t${approval.status}\t${approval.action}\t${approval.decisionReason ?? ""}`;
}

export type ShowSessionCommandDeps<TStore extends SessionLookupStore> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  createPlatform(workspace: string): Promise<{ store: TStore }>;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createShowSessionCommand<TStore extends SessionLookupStore>(
  deps: ShowSessionCommandDeps<TStore>,
): CommandModule<void> {
  return {
    name: "show-session",
    summary: "Show a legacy session payload",
    execute: async ({ args }) => {
      const sessionId = args[0];
      if (!sessionId) {
        deps.writeError("Missing session id.");
        deps.setExitCode(1);
        return { matched: true };
      }

      let platform: { store: TStore } | undefined;
      try {
        const workspace = await deps.resolveWorkspace(deps.cwd(), args.slice(1));
        platform = await deps.createPlatform(workspace);
        const session = await platform.store.getSession(sessionId);
        if (!session) {
          deps.writeError(`Session not found: ${sessionId}`);
          deps.setExitCode(1);
          return { matched: true };
        }
        const messages = await platform.store.getMessages(sessionId);
        const toolResults = await platform.store.getToolResults(sessionId);
        deps.writeJson({ session, messages, toolResults });
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform?.store.close?.();
      }
      return { matched: true };
    },
  };
}

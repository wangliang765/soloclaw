import type { CommandModule } from "../command-router.js";

type ClosablePlatform = {
  close(): void;
};

export type OrgCommandOptions<TDefaultRole = string, TScopeType = string> = {
  defaultRole?: TDefaultRole;
  retentionPolicyId?: string;
  expiresAt?: string;
  subject?: string;
  scopeType?: TScopeType;
  scopeId?: string;
};

type OrgRecord = {
  id: string;
  status: string;
  createdAt?: string;
  name: string;
};

type ProjectRecord = {
  id: string;
  orgId: string;
  status: string;
  createdAt?: string;
  name: string;
  retentionPolicyId?: string;
};

type CapabilityGrantRecord = {
  scopeType: string;
  scopeId: string;
  subjectType: string;
  subjectId: string;
  capability: string;
  grantedBy?: string;
  expiresAt?: string;
};

export type OrgsCommandDeps<
  TActor,
  TOrganizations,
  TOptions extends OrgCommandOptions,
  TSubjectRef extends { subjectType: string; subjectId: string },
  TScopeType extends string,
> = {
  createPlatform(): Promise<ClosablePlatform & { organizations: TOrganizations }>;
  actor(): TActor;
  parseArgs(args: string[]): { options: TOptions; positionals: string[] };
  parseCapabilitySubject(subject: string): TSubjectRef;
  parseCapabilityScope(scopeType: string): TScopeType;
  writeText(text: string): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createOrgsCommand<
  TActor,
  TOptions extends OrgCommandOptions,
  TSubjectRef extends { subjectType: string; subjectId: string },
  TScopeType extends string,
  TOrganizations extends {
    createOrganization(input: { name: string; createdBy: TActor }): Promise<OrgRecord>;
    listOrganizations(): Promise<OrgRecord[]>;
    createProject(input: {
      orgId: string;
      name: string;
      defaultRole?: TOptions["defaultRole"];
      retentionPolicyId?: string;
      createdBy: TActor;
    }): Promise<ProjectRecord>;
    listProjects(orgId?: string): Promise<ProjectRecord[]>;
    grantCapability(input: {
      subjectType: TSubjectRef["subjectType"];
      subjectId: string;
      scopeType: TScopeType;
      scopeId: string;
      capability: string;
      expiresAt?: string;
      grantedBy: TActor;
    }): Promise<CapabilityGrantRecord>;
    listCapabilityGrants(input: {
      subjectType?: TSubjectRef["subjectType"];
      subjectId?: string;
      scopeType?: TOptions["scopeType"];
      scopeId?: string;
    }): Promise<CapabilityGrantRecord[]>;
    hasCapability(input: {
      subjectType: TSubjectRef["subjectType"];
      subjectId: string;
      scopeType: TScopeType;
      scopeId: string;
      capability: string;
    }): Promise<boolean>;
  },
>(deps: OrgsCommandDeps<TActor, TOrganizations, TOptions, TSubjectRef, TScopeType>): CommandModule<void> {
  return {
    name: "orgs",
    summary: "Manage organizations, projects, and capability grants",
    execute: async ({ args: rest }) => {
      const subcommand = rest[0] ?? "list";
      const args = rest.slice(1);
      const platform = await deps.createPlatform();
      const actor = deps.actor();
      try {
        if (subcommand === "create") {
          const name = args.join(" ").trim();
          if (!name) {
            deps.writeError("Usage: agent orgs create <name>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const org = await platform.organizations.createOrganization({ name, createdBy: actor });
          deps.writeText(`${org.id}\t${org.status}\t${org.name}`);
          return { matched: true };
        }
        if (subcommand === "list") {
          for (const org of await platform.organizations.listOrganizations()) {
            deps.writeText(`${org.id}\t${org.status}\t${org.createdAt}\t${org.name}`);
          }
          return { matched: true };
        }
        if (subcommand === "project-create") {
          const orgId = args[0];
          const parsed = deps.parseArgs(args.slice(1));
          const name = parsed.positionals.join(" ").trim();
          if (!orgId || !name) {
            deps.writeError("Usage: agent orgs project-create <org-id> [--default-role viewer|member|admin] <name>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const project = await platform.organizations.createProject({
            orgId,
            name,
            defaultRole: parsed.options.defaultRole,
            retentionPolicyId: parsed.options.retentionPolicyId,
            createdBy: actor,
          });
          deps.writeText(`${project.id}\t${project.orgId}\t${project.status}\t${project.name}`);
          return { matched: true };
        }
        if (subcommand === "projects") {
          const orgId = args[0];
          for (const project of await platform.organizations.listProjects(orgId)) {
            deps.writeText(`${project.id}\t${project.orgId}\t${project.status}\t${project.createdAt}\t${project.name}`);
          }
          return { matched: true };
        }
        if (subcommand === "grant") {
          const [scopeType, scopeId, subject, capability] = args;
          const parsed = deps.parseArgs(args.slice(4));
          if (!scopeType || !scopeId || !subject || !capability) {
            deps.writeError("Usage: agent orgs grant <organization|project|room|session|operator> <scope-id> <user:id|agent:id|service_account:id> <capability> [--expires-at iso]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const subjectRef = deps.parseCapabilitySubject(subject);
          const scope = deps.parseCapabilityScope(scopeType);
          const grant = await platform.organizations.grantCapability({
            subjectType: subjectRef.subjectType,
            subjectId: subjectRef.subjectId,
            scopeType: scope,
            scopeId,
            capability,
            expiresAt: parsed.options.expiresAt,
            grantedBy: actor,
          });
          deps.writeText(`${grant.scopeType}:${grant.scopeId}\t${grant.subjectType}:${grant.subjectId}\t${grant.capability}\texpires=${grant.expiresAt ?? "-"}`);
          return { matched: true };
        }
        if (subcommand === "grants") {
          const parsed = deps.parseArgs(args);
          const subjectRef = parsed.options.subject ? deps.parseCapabilitySubject(parsed.options.subject) : undefined;
          const grants = await platform.organizations.listCapabilityGrants({
            subjectType: subjectRef?.subjectType,
            subjectId: subjectRef?.subjectId,
            scopeType: parsed.options.scopeType,
            scopeId: parsed.options.scopeId,
          });
          for (const grant of grants) {
            deps.writeText(`${grant.scopeType}:${grant.scopeId}\t${grant.subjectType}:${grant.subjectId}\t${grant.capability}\tby=${grant.grantedBy}\texpires=${grant.expiresAt ?? "-"}`);
          }
          return { matched: true };
        }
        if (subcommand === "can") {
          const [scopeType, scopeId, subject, capability] = args;
          if (!scopeType || !scopeId || !subject || !capability) {
            deps.writeError("Usage: agent orgs can <organization|project|room|session|operator> <scope-id> <user:id|agent:id|service_account:id> <capability>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const subjectRef = deps.parseCapabilitySubject(subject);
          const scope = deps.parseCapabilityScope(scopeType);
          const ok = await platform.organizations.hasCapability({
            subjectType: subjectRef.subjectType,
            subjectId: subjectRef.subjectId,
            scopeType: scope,
            scopeId,
            capability,
          });
          deps.writeText(ok ? "allow" : "deny");
          return { matched: true };
        }
        deps.writeError(`Unknown orgs command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform.close();
      }
      return { matched: true };
    },
  };
}

export type RetentionCommandOptions = {
  hotTranscriptDays?: number;
  artifactRetentionDays?: number;
  auditRetentionDays?: number;
  enableAutoSummaries?: boolean;
  allowUserDeletion?: boolean;
  allowAuditExport?: boolean;
};

type RetentionPolicyRecord = {
  id: string;
  name: string;
  hotTranscriptDays: number;
  artifactRetentionDays: number;
  auditRetentionDays: number;
  enableAutoSummaries: boolean;
  allowUserDeletion: boolean;
};

export type RetentionCommandDeps<TActor, TLifecycle, TStore> = {
  createPlatform(): Promise<ClosablePlatform & { lifecycle: TLifecycle; store: TStore }>;
  actor(): TActor;
  parseArgs(args: string[]): { options: RetentionCommandOptions; positionals: string[] };
  writeText(text: string): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createRetentionCommand<
  TActor,
  TLifecycle extends {
    createRetentionPolicy(input: {
      name: string;
      hotTranscriptDays: number;
      artifactRetentionDays: number;
      auditRetentionDays: number;
      enableAutoSummaries: boolean;
      allowUserDeletion: boolean;
      allowAuditExport: boolean;
    }, actor: TActor): Promise<RetentionPolicyRecord>;
    assignProjectPolicy(projectId: string, policyId: string, actor: TActor): Promise<ProjectRecord>;
    applyProjectRetention(projectId: string, actor: TActor): Promise<{
      projectId: string;
      policy: RetentionPolicyRecord;
      sessionsCompacted: number;
      artifactsDeleted: number;
      auditEventsDeleted: number;
    }>;
  },
  TStore extends {
    listRetentionPolicies(): Promise<RetentionPolicyRecord[]>;
  },
>(deps: RetentionCommandDeps<TActor, TLifecycle, TStore>): CommandModule<void> {
  return {
    name: "retention",
    summary: "Manage retention policies",
    execute: async ({ args: rest }) => {
      const subcommand = rest[0] ?? "list";
      const args = rest.slice(1);
      const platform = await deps.createPlatform();
      const actor = deps.actor();
      try {
        if (subcommand === "create") {
          const parsed = deps.parseArgs(args);
          const name = parsed.positionals.join(" ").trim();
          if (!name) {
            deps.writeError("Usage: agent retention create <name> [--hot-days n] [--artifact-days n] [--audit-days n] [--no-auto-summaries] [--no-user-delete] [--no-audit-export]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const policy = await platform.lifecycle.createRetentionPolicy({
            name,
            hotTranscriptDays: parsed.options.hotTranscriptDays ?? 30,
            artifactRetentionDays: parsed.options.artifactRetentionDays ?? 90,
            auditRetentionDays: parsed.options.auditRetentionDays ?? 365,
            enableAutoSummaries: parsed.options.enableAutoSummaries ?? true,
            allowUserDeletion: parsed.options.allowUserDeletion ?? true,
            allowAuditExport: parsed.options.allowAuditExport ?? true,
          }, actor);
          deps.writeText(`${policy.id}\t${policy.name}\thot=${policy.hotTranscriptDays}\tartifacts=${policy.artifactRetentionDays}\taudit=${policy.auditRetentionDays}`);
          return { matched: true };
        }
        if (subcommand === "list") {
          for (const policy of await platform.store.listRetentionPolicies()) {
            deps.writeText(`${policy.id}\t${policy.name}\thot=${policy.hotTranscriptDays}\tartifacts=${policy.artifactRetentionDays}\taudit=${policy.auditRetentionDays}\tauto=${policy.enableAutoSummaries}\tdelete=${policy.allowUserDeletion}`);
          }
          return { matched: true };
        }
        if (subcommand === "assign") {
          const [projectId, policyId] = args;
          if (!projectId || !policyId) {
            deps.writeError("Usage: agent retention assign <project-id> <policy-id>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const project = await platform.lifecycle.assignProjectPolicy(projectId, policyId, actor);
          deps.writeText(`${project.id}\tretention=${project.retentionPolicyId ?? "-"}`);
          return { matched: true };
        }
        if (subcommand === "apply") {
          const projectId = args[0];
          if (!projectId) {
            deps.writeError("Usage: agent retention apply <project-id>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const result = await platform.lifecycle.applyProjectRetention(projectId, actor);
          deps.writeText(`${result.projectId}\tpolicy=${result.policy.id}\tsessions_compacted=${result.sessionsCompacted}\tartifacts_deleted=${result.artifactsDeleted}\taudit_deleted=${result.auditEventsDeleted}`);
          return { matched: true };
        }
        deps.writeError(`Unknown retention command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform.close();
      }
      return { matched: true };
    },
  };
}

export type GitCommandDeps<TGit> = {
  createPlatform(): Promise<ClosablePlatform & { git: TGit }>;
  readOption(args: string[], name: string): string | undefined;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createGitCommand<TGit extends { status(remote: string): Promise<unknown> }>(
  deps: GitCommandDeps<TGit>,
): CommandModule<void> {
  return {
    name: "git",
    summary: "Inspect git integration status",
    execute: async ({ args: rest }) => {
      const subcommand = rest[0] ?? "status";
      const platform = await deps.createPlatform();
      try {
        if (subcommand === "status") {
          deps.writeJson(await platform.git.status(deps.readOption(rest.slice(1), "--remote") ?? "origin"));
          return { matched: true };
        }
        deps.writeError(`Unknown git command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform.close();
      }
      return { matched: true };
    },
  };
}

type PullRequestInput = {
  title: string;
  branch?: string;
  commit?: boolean;
  push?: boolean;
  dryRun?: boolean;
};

type GitPolicyAction = "git.branch.create" | "git.commit.create" | "git.push";

export type PrCommandDeps<TActor, TExecutionMode, TGit, TPolicy, TStore> = {
  createPlatform(): Promise<ClosablePlatform & { git: TGit; policy: TPolicy; store: TStore }>;
  actor(): TActor;
  parseArgs(args: string[]): Promise<{ input: PullRequestInput; executionMode: TExecutionMode }>;
  ensureGitPolicyAllowed(input: {
    action: GitPolicyAction;
    mode: TExecutionMode;
    actor: TActor;
    policy: TPolicy;
    store: TStore;
    summary: string;
  }): Promise<void>;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createPrCommand<
  TActor,
  TExecutionMode,
  TGit extends { preparePullRequest(input: PullRequestInput): Promise<unknown> },
  TPolicy,
  TStore,
>(deps: PrCommandDeps<TActor, TExecutionMode, TGit, TPolicy, TStore>): CommandModule<void> {
  return {
    name: "pr",
    summary: "Prepare pull request branches and metadata",
    execute: async ({ args: rest }) => {
      const subcommand = rest[0] ?? "prepare";
      if (subcommand !== "prepare") {
        deps.writeError(`Unknown pr command: ${subcommand}`);
        deps.setExitCode(1);
        return { matched: true };
      }

      let platform: (ClosablePlatform & { git: TGit; policy: TPolicy; store: TStore }) | undefined;
      try {
        const parsed = await deps.parseArgs(rest.slice(1));
        platform = await deps.createPlatform();
        const actor = deps.actor();
        if (!parsed.input.dryRun) {
          await deps.ensureGitPolicyAllowed({
            action: "git.branch.create",
            mode: parsed.executionMode,
            actor,
            policy: platform.policy,
            store: platform.store,
            summary: `Create or switch PR branch ${parsed.input.branch ?? "(auto)"}`,
          });
          if (parsed.input.commit) {
            await deps.ensureGitPolicyAllowed({
              action: "git.commit.create",
              mode: parsed.executionMode,
              actor,
              policy: platform.policy,
              store: platform.store,
              summary: `Create PR commit for ${parsed.input.title}`,
            });
          }
          if (parsed.input.push) {
            await deps.ensureGitPolicyAllowed({
              action: "git.push",
              mode: parsed.executionMode,
              actor,
              policy: platform.policy,
              store: platform.store,
              summary: `Push PR branch ${parsed.input.branch ?? "(auto)"}`,
            });
          }
        }
        deps.writeJson(await platform.git.preparePullRequest(parsed.input));
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

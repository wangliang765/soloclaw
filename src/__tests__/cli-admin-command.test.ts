import assert from "node:assert/strict";
import test from "node:test";
import { createGitCommand, createOrgsCommand, createPrCommand, createRetentionCommand } from "../cli/commands/admin.js";

test("createOrgsCommand creates organizations", async () => {
  const events: string[] = [];
  const command = createOrgsCommand({
    createPlatform: async () => ({
      organizations: {
        createOrganization: async (input) => {
          events.push(`create:${input.name}:${input.createdBy.id}`);
          return { id: "org_1", status: "active", name: input.name };
        },
        listOrganizations: async () => [],
        createProject: async () => ({ id: "proj_1", orgId: "org_1", status: "active", name: "Project" }),
        listProjects: async () => [],
        grantCapability: async () => ({ scopeType: "organization", scopeId: "org_1", subjectType: "user", subjectId: "u_1", capability: "read" }),
        listCapabilityGrants: async () => [],
        hasCapability: async () => false,
      },
      close: () => events.push("close"),
    }),
    actor: () => ({ id: "actor_1" }),
    parseArgs: (args) => ({ options: {}, positionals: args }),
    parseCapabilitySubject: (subject) => ({ subjectType: subject.split(":")[0], subjectId: subject.split(":")[1] }),
    parseCapabilityScope: (scopeType) => scopeType,
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "orgs", args: ["create", "Acme", "Team"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["create:Acme Team:actor_1", "text:org_1\tactive\tAcme Team", "close"]);
});

test("createOrgsCommand lists grants with optional filters", async () => {
  const events: string[] = [];
  const command = createOrgsCommand({
    createPlatform: async () => ({
      organizations: {
        createOrganization: async () => ({ id: "org_1", status: "active", name: "Org" }),
        listOrganizations: async () => [],
        createProject: async () => ({ id: "proj_1", orgId: "org_1", status: "active", name: "Project" }),
        listProjects: async () => [],
        grantCapability: async () => ({ scopeType: "organization", scopeId: "org_1", subjectType: "user", subjectId: "u_1", capability: "read" }),
        listCapabilityGrants: async (input) => {
          events.push(`grants:${JSON.stringify(input)}`);
          return [{ scopeType: "project", scopeId: "proj_1", subjectType: "agent", subjectId: "a_1", capability: "task.delegate", grantedBy: "owner", expiresAt: undefined }];
        },
        hasCapability: async () => false,
      },
      close: () => events.push("close"),
    }),
    actor: () => ({ id: "actor_1" }),
    parseArgs: () => ({ options: { subject: "agent:a_1", scopeType: "project", scopeId: "proj_1" }, positionals: [] }),
    parseCapabilitySubject: (subject) => ({ subjectType: subject.split(":")[0], subjectId: subject.split(":")[1] }),
    parseCapabilityScope: (scopeType) => scopeType,
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "orgs", args: ["grants"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    'grants:{"subjectType":"agent","subjectId":"a_1","scopeType":"project","scopeId":"proj_1"}',
    "text:project:proj_1\tagent:a_1\ttask.delegate\tby=owner\texpires=-",
    "close",
  ]);
});

test("createOrgsCommand reports missing project-create arguments", async () => {
  const events: string[] = [];
  const command = createOrgsCommand({
    createPlatform: async () => ({
      organizations: {
        createOrganization: async () => ({ id: "org_1", status: "active", name: "Org" }),
        listOrganizations: async () => [],
        createProject: async () => ({ id: "proj_1", orgId: "org_1", status: "active", name: "Project" }),
        listProjects: async () => [],
        grantCapability: async () => ({ scopeType: "organization", scopeId: "org_1", subjectType: "user", subjectId: "u_1", capability: "read" }),
        listCapabilityGrants: async () => [],
        hasCapability: async () => false,
      },
      close: () => events.push("close"),
    }),
    actor: () => ({ id: "actor_1" }),
    parseArgs: () => ({ options: {}, positionals: [] }),
    parseCapabilitySubject: (subject) => ({ subjectType: subject.split(":")[0], subjectId: subject.split(":")[1] }),
    parseCapabilityScope: (scopeType) => scopeType,
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "orgs", args: ["project-create", "org_1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Usage: agent orgs project-create <org-id> [--default-role viewer|member|admin] <name>", "exit:1", "close"]);
});

test("createRetentionCommand creates retention policies with defaults", async () => {
  const events: string[] = [];
  const command = createRetentionCommand({
    createPlatform: async () => ({
      lifecycle: {
        createRetentionPolicy: async (input, actor) => {
          events.push(`create:${input.name}:${input.hotTranscriptDays}:${actor.id}`);
          return { id: "ret_1", name: input.name, hotTranscriptDays: input.hotTranscriptDays, artifactRetentionDays: input.artifactRetentionDays, auditRetentionDays: input.auditRetentionDays, enableAutoSummaries: input.enableAutoSummaries, allowUserDeletion: input.allowUserDeletion };
        },
        assignProjectPolicy: async () => ({ id: "proj_1", orgId: "org_1", status: "active", name: "Project", retentionPolicyId: "ret_1" }),
        applyProjectRetention: async () => ({ projectId: "proj_1", policy: { id: "ret_1", name: "Policy", hotTranscriptDays: 30, artifactRetentionDays: 90, auditRetentionDays: 365, enableAutoSummaries: true, allowUserDeletion: true }, sessionsCompacted: 1, artifactsDeleted: 2, auditEventsDeleted: 3 }),
      },
      store: {
        listRetentionPolicies: async () => [],
      },
      close: () => events.push("close"),
    }),
    actor: () => ({ id: "actor_1" }),
    parseArgs: (args) => ({ options: {}, positionals: args }),
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "retention", args: ["create", "Default"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["create:Default:30:actor_1", "text:ret_1\tDefault\thot=30\tartifacts=90\taudit=365", "close"]);
});

test("createRetentionCommand applies project retention", async () => {
  const events: string[] = [];
  const command = createRetentionCommand({
    createPlatform: async () => ({
      lifecycle: {
        createRetentionPolicy: async () => ({ id: "ret_1", name: "Policy", hotTranscriptDays: 30, artifactRetentionDays: 90, auditRetentionDays: 365, enableAutoSummaries: true, allowUserDeletion: true }),
        assignProjectPolicy: async () => ({ id: "proj_1", orgId: "org_1", status: "active", name: "Project", retentionPolicyId: "ret_1" }),
        applyProjectRetention: async (projectId, actor) => {
          events.push(`apply:${projectId}:${actor.id}`);
          return { projectId, policy: { id: "ret_1", name: "Policy", hotTranscriptDays: 30, artifactRetentionDays: 90, auditRetentionDays: 365, enableAutoSummaries: true, allowUserDeletion: true }, sessionsCompacted: 1, artifactsDeleted: 2, auditEventsDeleted: 3 };
        },
      },
      store: {
        listRetentionPolicies: async () => [],
      },
      close: () => events.push("close"),
    }),
    actor: () => ({ id: "actor_1" }),
    parseArgs: (args) => ({ options: {}, positionals: args }),
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "retention", args: ["apply", "proj_1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["apply:proj_1:actor_1", "text:proj_1\tpolicy=ret_1\tsessions_compacted=1\tartifacts_deleted=2\taudit_deleted=3", "close"]);
});

test("createGitCommand writes status json for selected remote", async () => {
  const events: string[] = [];
  const command = createGitCommand({
    createPlatform: async () => ({
      git: {
        status: async (remote) => ({ remote, clean: true }),
      },
      close: () => events.push("close"),
    }),
    readOption: () => "upstream",
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "git", args: ["status", "--remote", "upstream"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ['json:{"remote":"upstream","clean":true}', "close"]);
});

test("createPrCommand prepares dry-run PR without policy checks", async () => {
  const events: string[] = [];
  const command = createPrCommand({
    createPlatform: async () => ({
      git: {
        preparePullRequest: async (input) => {
          events.push(`prepare:${input.title}:${input.dryRun}`);
          return { branch: "codex/test" };
        },
      },
      policy: {},
      store: {},
      close: () => events.push("close"),
    }),
    actor: () => ({ id: "actor_1" }),
    parseArgs: async () => ({ input: { title: "My PR", dryRun: true }, executionMode: "trusted" }),
    ensureGitPolicyAllowed: async (input) => {
      events.push(`policy:${input.action}`);
    },
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "pr", args: ["prepare", "--title", "My PR"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["prepare:My PR:true", 'json:{"branch":"codex/test"}', "close"]);
});

test("createPrCommand checks branch, commit, and push policy before applying", async () => {
  const events: string[] = [];
  const command = createPrCommand({
    createPlatform: async () => ({
      git: {
        preparePullRequest: async (input) => {
          events.push(`prepare:${input.branch}`);
          return { branch: input.branch };
        },
      },
      policy: { id: "policy" },
      store: { id: "store" },
      close: () => events.push("close"),
    }),
    actor: () => ({ id: "actor_1" }),
    parseArgs: async () => ({ input: { title: "Ship it", branch: "codex/ship", commit: true, push: true, dryRun: false }, executionMode: "trusted" }),
    ensureGitPolicyAllowed: async (input) => {
      events.push(`policy:${input.action}:${input.summary}`);
    },
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "pr", args: ["prepare", "--apply"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "policy:git.branch.create:Create or switch PR branch codex/ship",
    "policy:git.commit.create:Create PR commit for Ship it",
    "policy:git.push:Push PR branch codex/ship",
    "prepare:codex/ship",
    'json:{"branch":"codex/ship"}',
    "close",
  ]);
});

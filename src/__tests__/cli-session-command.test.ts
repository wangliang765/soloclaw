import assert from "node:assert/strict";
import test from "node:test";
import { createApprovalDecisionCommand, createApprovalsCommand, createArtifactsCommand, createAuditCommand, createChangesCommand, createReplayCommand, createResumeCommand, createSessionCommand, createSessionControlCommand, createSessionsCommand, createShowSessionCommand } from "../cli/commands/session.js";

type FakeStore = {
  closed: boolean;
  getSession(id: string): Promise<unknown | undefined>;
  getMessages(id: string): Promise<unknown[]>;
  getToolResults(id: string): Promise<unknown[]>;
  listFileChanges(sessionId?: string): Promise<Array<{ id: string; kind: string; createdAt: string; path: string; summary: string }>>;
  close(): void;
};

type FakeTasks = {
  pause(input: { sessionId: string; actor: { id: string }; reason?: string }): Promise<{ id: string; status: string; updatedAt: string; objective: string }>;
  cancel(input: { sessionId: string; actor: { id: string }; reason?: string }): Promise<{ id: string; status: string; updatedAt: string; objective: string }>;
};

type FakeArtifactOptions = {
  kind?: string;
  name?: string;
  uri?: string;
  mimeType?: string;
  orgId?: string;
  projectId?: string;
  sessionId?: string;
  roomId?: string;
  status?: string;
  limit?: number;
  deleteFile?: boolean;
  force?: boolean;
};

type FakeArtifact = {
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

type FakeApproval = {
  id: string;
  status: string;
  action: string;
  createdAt: string;
  toolName?: string;
  reason: string;
};

type FakeAuditEvent = {
  createdAt: string;
  type: string;
  actor: { type: string; id: string };
  sessionId?: string;
  roomId?: string;
  summary: string;
};

function createStore(events: string[], session: unknown | undefined = { id: "s1", status: "completed" }): FakeStore {
  return {
    closed: false,
    async getSession(id: string) {
      events.push(`get-session:${id}`);
      return session;
    },
    async getMessages(id: string) {
      events.push(`get-messages:${id}`);
      return [{ role: "user" }];
    },
    async getToolResults(id: string) {
      events.push(`get-tools:${id}`);
      return [{ ok: true }];
    },
    async listFileChanges(id?: string) {
      events.push(`list-changes:${id ?? "-"}`);
      return [
        {
          id: "chg_1",
          kind: "patch",
          createdAt: "2026-06-26T00:00:00.000Z",
          path: "src/math.ts",
          summary: "Updated math helper",
        },
      ];
    },
    close() {
      this.closed = true;
      events.push("close");
    },
  };
}

test("createSessionsCommand lists sessions with parsed options and closes the store", async () => {
  const events: string[] = [];
  const store = createStore(events);
  const command = createSessionsCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    stripWorkspaceOption: (args) => args.filter((arg) => arg !== "--workspace" && arg !== "project"),
    parseListArgs: (args) => {
      events.push(`parse:${args.join(",")}`);
      return { options: { json: args.includes("--json"), limit: 5 }, positionals: [] };
    },
    createPlatform: async (workspace) => {
      events.push(`platform:${workspace}`);
      return { store };
    },
    buildList: async (_store, options) => ({ options, sessions: [] }),
    renderList: (list) => events.push(`render:${JSON.stringify(list)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "sessions", args: ["--workspace", "project", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:--workspace,project,--json",
    "parse:--json",
    "platform:C:/repo/project",
    'json:{"options":{"json":true,"limit":5},"sessions":[]}',
    "close",
  ]);
  assert.equal(store.closed, true);
});

test("createShowSessionCommand reports missing session ids before opening the store", async () => {
  const events: string[] = [];
  const command = createShowSessionCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => {
      events.push("resolve");
      return "C:/repo/project";
    },
    createPlatform: async () => {
      events.push("platform");
      return { store: createStore(events) };
    },
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "show-session", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Missing session id.", "exit:1"]);
});

test("createShowSessionCommand writes the legacy session payload shape", async () => {
  const events: string[] = [];
  const store = createStore(events, { id: "s1", status: "completed" });
  const command = createShowSessionCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    createPlatform: async (workspace) => {
      events.push(`platform:${workspace}`);
      return { store };
    },
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "show-session", args: ["s1", "--workspace", "project"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:--workspace,project",
    "platform:C:/repo/project",
    "get-session:s1",
    "get-messages:s1",
    "get-tools:s1",
    'json:{"session":{"id":"s1","status":"completed"},"messages":[{"role":"user"}],"toolResults":[{"ok":true}]}',
    "close",
  ]);
});

test("createSessionCommand renders JSON session status with parsed lifecycle options", async () => {
  const events: string[] = [];
  const store = createStore(events);
  const command = createSessionCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    stripWorkspaceOption: (args) => args.filter((arg) => arg !== "--workspace" && arg !== "project"),
    parseLifecycleArgs: (args) => {
      events.push(`parse:${args.join(",")}`);
      return { options: { json: args.includes("--json"), limit: 3 }, positionals: [] };
    },
    createPlatform: async (workspace) => {
      events.push(`platform:${workspace}`);
      return {
        store,
        lifecycle: {
          compactSession: async () => {
            throw new Error("not expected");
          },
          deleteSession: async () => {
            throw new Error("not expected");
          },
        },
      };
    },
    localUserActor: () => ({ type: "user" as const, id: "local-user", displayName: "Local User" }),
    buildDiff: async () => ({ kind: "diff" }),
    buildReport: async () => ({ kind: "report" }),
    buildStatus: async (_store, id, options) => ({ kind: "status", id, options }),
    buildInspect: async () => ({ kind: "inspect" }),
    buildTimeline: async () => ({ kind: "timeline" }),
    buildReview: async () => ({ kind: "review" }),
    buildBundle: async () => ({ kind: "bundle" }),
    buildResult: async () => ({ kind: "result" }),
    buildNext: async () => ({ kind: "next" }),
    buildVerification: async () => ({ kind: "verification", status: "pass" }),
    writeBundleOutput: async () => ({ path: "bundle.json", bytes: 12 }),
    renderDiff: (view) => events.push(`render-diff:${JSON.stringify(view)}`),
    renderReport: (view) => events.push(`render-report:${JSON.stringify(view)}`),
    renderStatus: (view) => events.push(`render-status:${JSON.stringify(view)}`),
    renderInspect: (view) => events.push(`render-inspect:${JSON.stringify(view)}`),
    renderTimeline: (view) => events.push(`render-timeline:${JSON.stringify(view)}`),
    renderReview: (view) => events.push(`render-review:${JSON.stringify(view)}`),
    renderBundle: (view) => events.push(`render-bundle:${JSON.stringify(view)}`),
    renderResult: (view) => events.push(`render-result:${JSON.stringify(view)}`),
    renderNext: (view) => events.push(`render-next:${JSON.stringify(view)}`),
    renderVerification: (view) => events.push(`render-verification:${JSON.stringify(view)}`),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "session", args: ["status", "s1", "--workspace", "project", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:--workspace,project,--json",
    "parse:--json",
    "platform:C:/repo/project",
    'json:{"kind":"status","id":"s1","options":{"limit":3}}',
    "close",
  ]);
});

test("createSessionCommand sets exit code when session verification fails", async () => {
  const events: string[] = [];
  const store = createStore(events);
  const command = createSessionCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo/project",
    stripWorkspaceOption: (args) => args,
    parseLifecycleArgs: () => ({ options: { json: true, requireChange: true }, positionals: [] }),
    createPlatform: async () => ({
      store,
      lifecycle: {
        compactSession: async () => {
          throw new Error("not expected");
        },
        deleteSession: async () => {
          throw new Error("not expected");
        },
      },
    }),
    localUserActor: () => ({ type: "user" as const, id: "local-user", displayName: "Local User" }),
    buildDiff: async () => ({ kind: "diff" }),
    buildReport: async () => ({ kind: "report" }),
    buildStatus: async () => ({ kind: "status" }),
    buildInspect: async () => ({ kind: "inspect" }),
    buildTimeline: async () => ({ kind: "timeline" }),
    buildReview: async () => ({ kind: "review" }),
    buildBundle: async () => ({ kind: "bundle" }),
    buildResult: async () => ({ kind: "result" }),
    buildNext: async () => ({ kind: "next" }),
    buildVerification: async (_store, id, options) => ({ kind: "verification", id, options, status: "fail" }),
    writeBundleOutput: async () => ({ path: "bundle.json", bytes: 12 }),
    renderDiff: () => undefined,
    renderReport: () => undefined,
    renderStatus: () => undefined,
    renderInspect: () => undefined,
    renderTimeline: () => undefined,
    renderReview: () => undefined,
    renderBundle: () => undefined,
    renderResult: () => undefined,
    renderNext: () => undefined,
    renderVerification: () => undefined,
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "session", args: ["verify", "s1", "--json", "--require-change"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    'json:{"kind":"verification","id":"s1","options":{"requireChange":true,"requireCommand":true},"status":"fail"}',
    "exit:1",
    "close",
  ]);
});

test("createSessionCommand keeps compact and delete lifecycle operations in the session module", async () => {
  const events: string[] = [];
  const store = createStore(events);
  const command = createSessionCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo/project",
    stripWorkspaceOption: (args) => args,
    parseLifecycleArgs: (args) => ({
      options: {
        summary: args.includes("--summary") ? args[args.indexOf("--summary") + 1] : undefined,
        force: args.includes("--force"),
      },
      positionals: [],
    }),
    createPlatform: async () => ({
      store,
      lifecycle: {
        compactSession: async (input) => {
          events.push(`compact:${input.sessionId}:${input.summary}:${input.force}:${input.actor.id}`);
          return { sessionId: input.sessionId, messagesDeleted: 2, toolCallsDeleted: 1 };
        },
        deleteSession: async (input) => {
          events.push(`delete:${input.sessionId}:${input.force}:${input.actor.id}`);
        },
      },
    }),
    localUserActor: () => ({ type: "user" as const, id: "local-user", displayName: "Local User" }),
    buildDiff: async () => ({ kind: "diff" }),
    buildReport: async () => ({ kind: "report" }),
    buildStatus: async () => ({ kind: "status" }),
    buildInspect: async () => ({ kind: "inspect" }),
    buildTimeline: async () => ({ kind: "timeline" }),
    buildReview: async () => ({ kind: "review" }),
    buildBundle: async () => ({ kind: "bundle" }),
    buildResult: async () => ({ kind: "result" }),
    buildNext: async () => ({ kind: "next" }),
    buildVerification: async () => ({ kind: "verification", status: "pass" }),
    writeBundleOutput: async () => ({ path: "bundle.json", bytes: 12 }),
    renderDiff: () => undefined,
    renderReport: () => undefined,
    renderStatus: () => undefined,
    renderInspect: () => undefined,
    renderTimeline: () => undefined,
    renderReview: () => undefined,
    renderBundle: () => undefined,
    renderResult: () => undefined,
    renderNext: () => undefined,
    renderVerification: () => undefined,
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  await command.execute({ command: "session", args: ["compact", "s1", "--summary", "trim", "--force"], context: undefined });
  await command.execute({ command: "session", args: ["delete", "s1", "--force"], context: undefined });

  assert.deepEqual(events, [
    "compact:s1:trim:true:local-user",
    "text:s1\tmessages_deleted=2\ttool_calls_deleted=1",
    "close",
    "delete:s1:true:local-user",
    "text:s1\tdeleted",
    "close",
  ]);
});

test("createSessionControlCommand pauses sessions with parsed reason and closes the store", async () => {
  const events: string[] = [];
  const store = createStore(events);
  const tasks: FakeTasks = {
    async pause(input) {
      events.push(`pause:${input.sessionId}:${input.reason}:${input.actor.id}`);
      return { id: input.sessionId, status: "paused", updatedAt: "2026-06-26T00:00:00.000Z", objective: "Build feature" };
    },
    async cancel() {
      throw new Error("not expected");
    },
  };
  const command = createSessionControlCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    stripWorkspaceOption: (args) => args.filter((arg) => arg !== "--workspace" && arg !== "project"),
    createPlatform: async (workspace) => {
      events.push(`platform:${workspace}`);
      return { store, tasks };
    },
    localUserActor: () => ({ type: "user" as const, id: "local-user", displayName: "Local User" }),
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({
    command: "pause",
    args: ["s1", "--workspace", "project", "operator", "review"],
    context: undefined,
  });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:--workspace,project,operator,review",
    "platform:C:/repo/project",
    "pause:s1:operator review:local-user",
    "text:s1\tpaused\t2026-06-26T00:00:00.000Z\tBuild feature",
    "close",
  ]);
});

test("createSessionControlCommand treats cancel as an alias and preserves cancel output", async () => {
  const events: string[] = [];
  const store = createStore(events);
  const tasks: FakeTasks = {
    async pause() {
      throw new Error("not expected");
    },
    async cancel(input) {
      events.push(`cancel:${input.sessionId}:${input.reason}:${input.actor.id}`);
      return { id: input.sessionId, status: "cancelled", updatedAt: "2026-06-26T00:00:00.000Z", objective: "Stop task" };
    },
  };
  const command = createSessionControlCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo/project",
    stripWorkspaceOption: (args) => args,
    createPlatform: async () => ({ store, tasks }),
    localUserActor: () => ({ type: "user" as const, id: "local-user", displayName: "Local User" }),
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "cancel", args: ["s1", "bad", "direction"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "cancel:s1:bad direction:local-user",
    "text:s1\tcancelled\t2026-06-26T00:00:00.000Z\tStop task",
    "close",
  ]);
});

test("createSessionControlCommand reports missing session ids before opening platform state", async () => {
  const events: string[] = [];
  const command = createSessionControlCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    stripWorkspaceOption: (args) => args,
    createPlatform: async () => {
      events.push("platform");
      return {
        store: createStore(events),
        tasks: {
          pause: async () => {
            throw new Error("not expected");
          },
          cancel: async () => {
            throw new Error("not expected");
          },
        },
      };
    },
    localUserActor: () => ({ type: "user" as const, id: "local-user", displayName: "Local User" }),
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "pause", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:",
    "error:Missing session id.",
    "exit:1",
  ]);
});

test("createChangesCommand lists file changes with optional session filtering", async () => {
  const events: string[] = [];
  const store = createStore(events);
  const command = createChangesCommand({
    cwd: () => "C:/repo",
    createPlatform: async (cwd) => {
      events.push(`platform:${cwd}`);
      return { store };
    },
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "changes", args: ["s1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "platform:C:/repo",
    "list-changes:s1",
    "text:chg_1\tpatch\t2026-06-26T00:00:00.000Z\tsrc/math.ts\tUpdated math helper",
    "close",
  ]);
});

test("createChangesCommand can list all file changes and closes the store on errors", async () => {
  const events: string[] = [];
  const store = {
    ...createStore(events),
    async listFileChanges() {
      events.push("list-changes:all");
      throw new Error("store unavailable");
    },
  };
  const command = createChangesCommand({
    cwd: () => "C:/repo",
    createPlatform: async (cwd) => {
      events.push(`platform:${cwd}`);
      return { store };
    },
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "changes", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "platform:C:/repo",
    "list-changes:all",
    "error:store unavailable",
    "exit:1",
    "close",
  ]);
});

test("createResumeCommand reports missing session ids before resolving workspace", async () => {
  const events: string[] = [];
  const command = createResumeCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => {
      events.push("resolve");
      return "C:/repo/project";
    },
    stripWorkspaceOption: (args) => args,
    parseResumeArgs: () => ({ options: {}, cli: {} }),
    buildModelReadiness: async () => ({ ready: true }),
    createPlatform: async () => {
      events.push("platform");
      return {
        agent: { resume: async () => "done" },
        store: createStore(events),
      };
    },
    buildResult: async () => ({ kind: "result" }),
    buildVerification: async () => ({ kind: "verification", status: "pass" }),
    renderModelReadiness: () => events.push("render-model"),
    renderResult: (view) => events.push(`render-result:${JSON.stringify(view)}`),
    renderVerification: (view) => events.push(`render-verification:${JSON.stringify(view)}`),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
    now: () => new Date("2026-06-26T00:00:00.000Z"),
  });

  const result = await command.execute({ command: "resume", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Missing session id.", "exit:1"]);
});

test("createResumeCommand blocks on model readiness without opening platform state", async () => {
  const events: string[] = [];
  const command = createResumeCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    stripWorkspaceOption: (args) => args.filter((arg) => arg !== "--workspace" && arg !== "project"),
    parseResumeArgs: (args) => {
      events.push(`parse:${args.join(",")}`);
      return { options: { provider: "openai_compatible" }, cli: { json: true, requireModelReady: true } };
    },
    buildModelReadiness: async (workspace, options) => {
      events.push(`readiness:${workspace}:${options.provider}`);
      return { ready: false, status: "missing_api_key" };
    },
    createPlatform: async () => {
      events.push("platform");
      return {
        agent: { resume: async () => "done" },
        store: createStore(events),
      };
    },
    buildResult: async () => ({ kind: "result" }),
    buildVerification: async () => ({ kind: "verification", status: "pass" }),
    renderModelReadiness: () => events.push("render-model"),
    renderResult: (view) => events.push(`render-result:${JSON.stringify(view)}`),
    renderVerification: (view) => events.push(`render-verification:${JSON.stringify(view)}`),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
    now: () => new Date("2026-06-26T00:00:00.000Z"),
  });

  const result = await command.execute({
    command: "resume",
    args: ["s1", "--workspace", "project", "--json", "--require-model-ready"],
    context: undefined,
  });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:--workspace,project,--json,--require-model-ready",
    "parse:--json,--require-model-ready",
    "readiness:C:/repo/project:openai_compatible",
    'json:{"generatedAt":"2026-06-26T00:00:00.000Z","status":"blocked","workspace":"C:/repo/project","sessionId":"s1","modelReadiness":{"ready":false,"status":"missing_api_key"}}',
    "exit:1",
  ]);
});

test("createResumeCommand writes JSON resume output with result, verification, review commands, and closes the store", async () => {
  const events: string[] = [];
  const store = createStore(events, { id: "s1", status: "completed" });
  const command = createResumeCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    stripWorkspaceOption: (args) => args.filter((arg) => arg !== "--workspace" && arg !== "project"),
    parseResumeArgs: (args) => {
      events.push(`parse:${args.join(",")}`);
      return {
        options: { model: "dev-model" },
        cli: {
          json: args.includes("--json"),
          verifySession: args.includes("--verify-session"),
          requireChange: true,
          allowNoCommand: true,
        },
      };
    },
    buildModelReadiness: async () => ({ ready: true }),
    createPlatform: async (workspace, options) => {
      events.push(`platform:${workspace}:${options.model}`);
      return {
        agent: {
          resume: async (sessionId) => {
            events.push(`resume:${sessionId}`);
            return "Final answer";
          },
        },
        store,
      };
    },
    buildResult: async (_store, sessionId) => {
      events.push(`result:${sessionId}`);
      return { kind: "result", sessionId };
    },
    buildVerification: async (_store, sessionId, options) => {
      events.push(`verify:${sessionId}:${options.requireChange}:${options.requireCommand}`);
      return { kind: "verification", sessionId, status: "pass" };
    },
    renderModelReadiness: () => events.push("render-model"),
    renderResult: (view) => events.push(`render-result:${JSON.stringify(view)}`),
    renderVerification: (view) => events.push(`render-verification:${JSON.stringify(view)}`),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
    now: () => new Date("2026-06-26T00:00:00.000Z"),
  });

  const result = await command.execute({
    command: "resume",
    args: ["s1", "--workspace", "project", "--json", "--verify-session"],
    context: undefined,
  });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:--workspace,project,--json,--verify-session",
    "parse:--json,--verify-session",
    "platform:C:/repo/project:dev-model",
    "resume:s1",
    "get-session:s1",
    "result:s1",
    "verify:s1:true:false",
    'json:{"generatedAt":"2026-06-26T00:00:00.000Z","workspace":"C:/repo/project","session":{"id":"s1","status":"completed"},"finalAnswer":"Final answer","result":{"kind":"result","sessionId":"s1"},"verification":{"kind":"verification","sessionId":"s1","status":"pass"},"reviewCommands":{"review":"agent session review s1","result":"agent session result s1","verify":"agent session verify s1","diff":"agent session diff s1","report":"agent session report s1 --json"}}',
    "close",
  ]);
});

test("createArtifactsCommand lists artifacts by default with parsed filters and closes the store", async () => {
  const events: string[] = [];
  const store = {
    closed: false,
    async listArtifacts(input: FakeArtifactOptions): Promise<FakeArtifact[]> {
      events.push(`list:${JSON.stringify(input)}`);
      return [
        {
          id: "art_1",
          status: "active",
          kind: "report",
          createdAt: "2026-06-26T00:00:00.000Z",
          projectId: "proj_1",
          sessionId: "s1",
          name: "report.json",
        },
      ];
    },
    close() {
      this.closed = true;
      events.push("close");
    },
  };
  const command = createArtifactsCommand({
    cwd: () => "C:/repo",
    parseArtifactArgs: (args: string[]) => {
      events.push(`parse:${args.join(",")}`);
      return { options: { projectId: "proj_1", status: "active", limit: 10 }, positionals: [] };
    },
    createPlatform: async (cwd: string) => {
      events.push(`platform:${cwd}`);
      return {
        store,
        lifecycle: {
          registerArtifact: async () => {
            throw new Error("not expected");
          },
          deleteArtifact: async () => {
            throw new Error("not expected");
          },
        },
      };
    },
    localUserActor: () => ({ type: "user" as const, id: "local-user", displayName: "Local User" }),
    writeText: (text: string) => events.push(`text:${text}`),
    writeError: (message: string) => events.push(`error:${message}`),
    setExitCode: (code: number) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "artifacts", args: ["list", "--project", "proj_1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "platform:C:/repo",
    "parse:--project,proj_1",
    'list:{"status":"active","projectId":"proj_1","limit":10}',
    "text:art_1\tactive\treport\t2026-06-26T00:00:00.000Z\tproj_1\ts1\treport.json",
    "close",
  ]);
  assert.equal(store.closed, true);
});

test("createArtifactsCommand registers artifacts with actor attribution and formatted output", async () => {
  const events: string[] = [];
  const store = {
    async listArtifacts(): Promise<FakeArtifact[]> {
      throw new Error("not expected");
    },
    close() {
      events.push("close");
    },
  };
  const command = createArtifactsCommand({
    cwd: () => "C:/repo",
    parseArtifactArgs: (args: string[]) => {
      events.push(`parse:${args.join(",")}`);
      return {
        options: { kind: "report", name: "report.json", projectId: "proj_1", uri: "artifact://report" },
        positionals: [],
      };
    },
    createPlatform: async () => ({
      store,
      lifecycle: {
        registerArtifact: async (input: { kind: string; name?: string; path?: string; uri?: string; projectId?: string; actor: { id: string } }) => {
          events.push(`register:${input.kind}:${input.name}:${input.path ?? "-"}:${input.uri}:${input.projectId}:${input.actor.id}`);
          return { id: "art_1", kind: input.kind, status: "active", sizeBytes: 42, name: input.name ?? "unnamed", createdAt: "now" };
        },
        deleteArtifact: async () => {
          throw new Error("not expected");
        },
      },
    }),
    localUserActor: () => ({ type: "user" as const, id: "local-user", displayName: "Local User" }),
    writeText: (text: string) => events.push(`text:${text}`),
    writeError: (message: string) => events.push(`error:${message}`),
    setExitCode: (code: number) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "artifacts", args: ["add", "--uri", "artifact://report"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "parse:--uri,artifact://report",
    "register:report:report.json:-:artifact://report:proj_1:local-user",
    "text:art_1\treport\tactive\t42\treport.json",
    "close",
  ]);
});

test("createArtifactsCommand deletes artifacts with parsed options and closes on usage errors", async () => {
  const events: string[] = [];
  const store = {
    async listArtifacts(): Promise<FakeArtifact[]> {
      throw new Error("not expected");
    },
    close() {
      events.push("close");
    },
  };
  const command = createArtifactsCommand({
    cwd: () => "C:/repo",
    parseArtifactArgs: (args: string[]) => {
      events.push(`parse:${args.join(",")}`);
      return { options: { deleteFile: args.includes("--delete-file"), force: args.includes("--force") }, positionals: [] };
    },
    createPlatform: async () => ({
      store,
      lifecycle: {
        registerArtifact: async () => {
          throw new Error("not expected");
        },
        deleteArtifact: async (input: { artifactId: string; deleteFile?: boolean; force?: boolean; actor: { id: string } }) => {
          events.push(`delete:${input.artifactId}:${input.deleteFile}:${input.force}:${input.actor.id}`);
          return {
            id: input.artifactId,
            kind: "report",
            status: "deleted",
            deletedAt: "2026-06-26T00:00:00.000Z",
            createdAt: "now",
            name: "report.json",
          };
        },
      },
    }),
    localUserActor: () => ({ type: "user" as const, id: "local-user", displayName: "Local User" }),
    writeText: (text: string) => events.push(`text:${text}`),
    writeError: (message: string) => events.push(`error:${message}`),
    setExitCode: (code: number) => events.push(`exit:${code}`),
  });

  await command.execute({ command: "artifacts", args: ["delete", "art_1", "--delete-file", "--force"], context: undefined });
  await command.execute({ command: "artifacts", args: ["delete"], context: undefined });

  assert.deepEqual(events, [
    "parse:--delete-file,--force",
    "delete:art_1:true:true:local-user",
    "text:art_1\tdeleted\tdeleted_at=2026-06-26T00:00:00.000Z",
    "close",
    "parse:",
    "error:Usage: agent artifacts delete <artifact-id> [--delete-file] [--force]",
    "exit:1",
    "close",
  ]);
});

test("createApprovalsCommand lists approvals with optional status and closes the store", async () => {
  const events: string[] = [];
  const store = {
    closed: false,
    async listApprovalRequests(status?: string): Promise<FakeApproval[]> {
      events.push(`list:${status ?? "-"}`);
      return [
        {
          id: "appr_1",
          status: status ?? "pending",
          action: "workspace.write",
          createdAt: "2026-06-26T00:00:00.000Z",
          toolName: "apply_patch",
          reason: "Need workspace write",
        },
      ];
    },
    close() {
      this.closed = true;
      events.push("close");
    },
  };
  const command = createApprovalsCommand({
    cwd: () => "C:/repo",
    createPlatform: async (cwd: string) => {
      events.push(`platform:${cwd}`);
      return { store };
    },
    writeText: (text: string) => events.push(`text:${text}`),
    writeError: (message: string) => events.push(`error:${message}`),
    setExitCode: (code: number) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "approvals", args: ["pending"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "platform:C:/repo",
    "list:pending",
    "text:appr_1\tpending\tworkspace.write\t2026-06-26T00:00:00.000Z\tapply_patch\tNeed workspace write",
    "close",
  ]);
  assert.equal(store.closed, true);
});

test("createApprovalsCommand lists all approvals by default and closes on errors", async () => {
  const events: string[] = [];
  const store = {
    async listApprovalRequests(status?: string): Promise<FakeApproval[]> {
      events.push(`list:${status ?? "-"}`);
      throw new Error("approval store unavailable");
    },
    close() {
      events.push("close");
    },
  };
  const command = createApprovalsCommand({
    cwd: () => "C:/repo",
    createPlatform: async () => ({ store }),
    writeText: (text: string) => events.push(`text:${text}`),
    writeError: (message: string) => events.push(`error:${message}`),
    setExitCode: (code: number) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "approvals", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "list:-",
    "error:approval store unavailable",
    "exit:1",
    "close",
  ]);
});

test("createAuditCommand lists audit events with filters and closes the store", async () => {
  const events: string[] = [];
  const store = {
    closed: false,
    async listAuditEvents(filters: Record<string, unknown>): Promise<FakeAuditEvent[]> {
      events.push(`list:${JSON.stringify(filters)}`);
      return [
        {
          createdAt: "2026-06-26T00:00:00.000Z",
          type: "session.created",
          actor: { type: "user", id: "u1" },
          sessionId: "s1",
          roomId: "r1",
          summary: "Session started",
        },
      ];
    },
    async getProject() {
      throw new Error("not expected");
    },
    async getRetentionPolicy() {
      throw new Error("not expected");
    },
    close() {
      this.closed = true;
      events.push("close");
    },
  };
  const command = createAuditCommand({
    cwd: () => "C:/repo",
    createPlatform: async (cwd: string) => {
      events.push(`platform:${cwd}`);
      return { store, identity: "identity" };
    },
    createExportService: () => {
      throw new Error("not expected");
    },
    readUtf8: async () => {
      throw new Error("not expected");
    },
    writeFileOutput: async () => {
      throw new Error("not expected");
    },
    writeRaw: (text: string) => events.push(`raw:${text}`),
    writeText: (text: string) => events.push(`text:${text}`),
    writeError: (message: string) => events.push(`error:${message}`),
    setExitCode: (code: number) => events.push(`exit:${code}`),
  });

  const result = await command.execute({
    command: "audit",
    args: ["list", "--limit", "7", "--type", "session.created", "--actor", "u1", "--session", "s1", "--room", "r1", "--project", "p1", "--from", "2026-06-01", "--to", "2026-06-26"],
    context: undefined,
  });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "platform:C:/repo",
    'list:{"limit":7,"type":"session.created","actorId":"u1","sessionId":"s1","roomId":"r1","projectId":"p1","from":"2026-06-01","to":"2026-06-26"}',
    "text:2026-06-26T00:00:00.000Z\tsession.created\tuser:u1\ts1\tr1\tSession started",
    "close",
  ]);
  assert.equal(store.closed, true);
});

test("createAuditCommand exports through the injected export service and writes output files", async () => {
  const events: string[] = [];
  const store = {
    async listAuditEvents(): Promise<FakeAuditEvent[]> {
      throw new Error("not expected");
    },
    async getProject(projectId: string) {
      events.push(`project:${projectId}`);
      return { retentionPolicyId: "ret_1" };
    },
    async getRetentionPolicy(policyId: string) {
      events.push(`policy:${policyId}`);
      return { name: "standard", allowAuditExport: true };
    },
    close() {
      events.push("close");
    },
  };
  const command = createAuditCommand({
    cwd: () => "C:/repo",
    createPlatform: async () => ({ store, identity: "identity" }),
    createExportService: ({ store: inputStore, identity }) => {
      events.push(`service:${inputStore === store}:${identity}`);
      return {
        export: async ({ filters, format }: { filters: Record<string, unknown>; format: string }) => {
          events.push(`export:${JSON.stringify(filters)}:${format}`);
          return { count: 2, output: "bundle-output", bundle: { signature: "ed25519:sig" } };
        },
        verifyBundle: async () => {
          throw new Error("not expected");
        },
      };
    },
    readUtf8: async () => {
      throw new Error("not expected");
    },
    writeFileOutput: async (outputPath: string, output: string) => {
      events.push(`write-file:${outputPath}:${output}`);
    },
    writeRaw: (text: string) => events.push(`raw:${text}`),
    writeText: (text: string) => events.push(`text:${text}`),
    writeError: (message: string) => events.push(`error:${message}`),
    setExitCode: (code: number) => events.push(`exit:${code}`),
  });

  const result = await command.execute({
    command: "audit",
    args: ["export", "--project", "p1", "--format", "bundle", "--output", "out/audit.json"],
    context: undefined,
  });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "project:p1",
    "policy:ret_1",
    "service:true:identity",
    'export:{"limit":100,"projectId":"p1"}:bundle',
    "write-file:out/audit.json:bundle-output",
    "text:2\tbundle\tsigned\tout/audit.json",
    "close",
  ]);
});

test("createAuditCommand verifies bundles and returns exit code 2 for invalid bundles", async () => {
  const events: string[] = [];
  const bundle = { exportId: "exp_1", eventCount: 1, eventsSha256: "abc", events: [] };
  const store = {
    async listAuditEvents(): Promise<FakeAuditEvent[]> {
      throw new Error("not expected");
    },
    async getProject() {
      throw new Error("not expected");
    },
    async getRetentionPolicy() {
      throw new Error("not expected");
    },
    close() {
      events.push("close");
    },
  };
  const command = createAuditCommand({
    cwd: () => "C:/repo",
    createPlatform: async () => ({ store, identity: "identity" }),
    createExportService: () => ({
      export: async () => {
        throw new Error("not expected");
      },
      verifyBundle: async (input: unknown) => {
        events.push(`verify:${JSON.stringify(input)}`);
        return "invalid";
      },
    }),
    readUtf8: async (filePath: string) => {
      events.push(`read:${filePath}`);
      return JSON.stringify(bundle);
    },
    writeFileOutput: async () => {
      throw new Error("not expected");
    },
    writeRaw: (text: string) => events.push(`raw:${text}`),
    writeText: (text: string) => events.push(`text:${text}`),
    writeError: (message: string) => events.push(`error:${message}`),
    setExitCode: (code: number) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "audit", args: ["verify", "audit-bundle.json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "read:audit-bundle.json",
    'verify:{"exportId":"exp_1","eventCount":1,"eventsSha256":"abc","events":[]}',
    "text:invalid\texp_1\tcount=1\tsha256=abc",
    "exit:2",
    "close",
  ]);
});

test("createReplayCommand reports missing approval ids before opening platform state", async () => {
  const events: string[] = [];
  const command = createReplayCommand({
    cwd: () => "C:/repo",
    createPlatform: async () => {
      events.push("platform");
      return { workspace: "workspace", store: createStore(events), locks: "locks", plugins: "plugins" };
    },
    localUserActor: () => ({ type: "user" as const, id: "local-user", displayName: "Local User" }),
    createWorkspaceTools: () => [],
    createPluginTools: async () => [],
    replayApprovedTool: async () => ({ ok: true }),
    writeJson: (value: unknown) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message: string) => events.push(`error:${message}`),
    setExitCode: (code: number) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "replay", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Missing approval id.", "exit:1"]);
});

test("createReplayCommand replays approved tools with workspace and plugin tools and closes the store", async () => {
  const events: string[] = [];
  const store = createStore(events);
  const command = createReplayCommand({
    cwd: () => "C:/repo",
    createPlatform: async (cwd: string) => {
      events.push(`platform:${cwd}`);
      return { workspace: "workspace", store, locks: "locks", plugins: "plugins" };
    },
    localUserActor: () => ({ type: "user" as const, id: "local-user", displayName: "Local User" }),
    createWorkspaceTools: ({ workspace, store: inputStore, locks, actor }) => {
      events.push(`workspace-tools:${workspace}:${inputStore === store}:${locks}:${actor.id}`);
      return ["workspace-tool"];
    },
    createPluginTools: async ({ plugins, store: inputStore, actor }) => {
      events.push(`plugin-tools:${plugins}:${inputStore === store}:${actor.id}`);
      return ["plugin-tool"];
    },
    replayApprovedTool: async ({ approvalId, store: inputStore, actor, tools }) => {
      events.push(`replay:${approvalId}:${inputStore === store}:${actor.id}:${tools.join(",")}`);
      return { ok: true, approvalId, toolCount: tools.length };
    },
    writeJson: (value: unknown) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message: string) => events.push(`error:${message}`),
    setExitCode: (code: number) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "replay", args: ["appr_1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "platform:C:/repo",
    "plugin-tools:plugins:true:local-user",
    "workspace-tools:workspace:true:locks:local-user",
    "replay:appr_1:true:local-user:workspace-tool,plugin-tool",
    'json:{"ok":true,"approvalId":"appr_1","toolCount":2}',
    "close",
  ]);
  assert.equal(store.closed, true);
});

type FakeApprovalDecisionOptions = {
  actor?: string;
  localAgent?: boolean;
  autoReplay?: boolean;
  autoResume?: boolean;
  queueResumeWorkerId?: string;
};

type FakeApprovalDecisionStore = {
  closed: boolean;
  listApprovalRequests(): Promise<Array<{ id: string; action: string }>>;
  getPendingToolCallByApproval(id: string): Promise<{ id: string; sessionId?: string; toolName: string } | undefined>;
  close(): void;
};

function createApprovalDecisionStore(
  events: string[],
  approvals: Array<{ id: string; action: string }> = [{ id: "appr_1", action: "workspace.write" }],
  pending: { id: string; sessionId?: string; toolName: string } | undefined = { id: "pending_1", sessionId: "s1", toolName: "apply_patch" },
): FakeApprovalDecisionStore {
  return {
    closed: false,
    async listApprovalRequests() {
      events.push("list");
      return approvals;
    },
    async getPendingToolCallByApproval(id: string) {
      events.push(`pending:${id}`);
      return pending;
    },
    close() {
      this.closed = true;
      events.push("close");
    },
  };
}

function createApprovalDecisionCommandForTest(
  events: string[],
  input: {
    store?: FakeApprovalDecisionStore;
    parsed?: { options: FakeApprovalDecisionOptions; positionals: string[] };
    decidedApproval?: { id: string; status: string; action: string; decisionReason?: string } | undefined;
    replayOk?: boolean;
    mcpAction?: boolean;
    resumeAnswer?: string;
  } = {},
) {
  const store = input.store ?? createApprovalDecisionStore(events);
  const replayOk = input.replayOk ?? true;
  return {
    store,
    command: createApprovalDecisionCommand({
      cwd: () => "C:/repo",
      parseApprovalArgs: (args: string[]) => {
        events.push(`parse:${args.join(",")}`);
        return input.parsed ?? { options: {}, positionals: args };
      },
      createPlatform: async (cwd: string) => {
        events.push(`platform:${cwd}`);
        return {
          agent: {
            resume: async (sessionId: string) => {
              events.push(`resume:${sessionId}`);
              return input.resumeAnswer ?? "Final answer";
            },
          },
          workspace: "workspace",
          store,
          rooms: "rooms",
          locks: "locks",
          localAgent: "local-agent",
          plugins: "plugins",
          organizations: "organizations",
          policy: "policy",
          secretBroker: "secret-broker",
          redactor: "redactor",
          taskBroker: {
            enqueue: async (enqueueInput: { workerId: string; sessionId: string; metadata?: { approvalId?: string; pendingToolCallId?: string; toolName?: string } }) => {
              events.push(`enqueue:${enqueueInput.workerId}:${enqueueInput.sessionId}:${enqueueInput.metadata?.approvalId}:${enqueueInput.metadata?.pendingToolCallId}:${enqueueInput.metadata?.toolName}`);
              return { id: "assign_1", workerId: enqueueInput.workerId };
            },
          },
        };
      },
      decideApproval: async ({ approvalId, status, reason, options }) => {
        events.push(`decide:${approvalId}:${status}:${reason ?? "-"}:${options.actor ?? "-"}:${options.localAgent ?? false}`);
        return {
          approval: input.decidedApproval ?? {
            id: approvalId,
            status,
            action: "workspace.write",
            decisionReason: reason,
          },
          decidedBy: { type: "user" as const, id: "decider", displayName: "Decider" },
        };
      },
      isMcpApprovalAction: (action: string) => input.mcpAction ?? action.startsWith("mcp."),
      executeApprovedMcp: async ({ approvalId, actor }) => {
        events.push(`mcp:${approvalId}:${actor.id}`);
        return { ok: true, approvalId };
      },
      createWorkspaceTools: ({ workspace, store: inputStore, locks, actor, sessionId }) => {
        events.push(`workspace-tools:${workspace}:${inputStore === store}:${locks}:${actor.id}:${sessionId ?? "-"}`);
        return ["workspace-tool"];
      },
      createPluginTools: async ({ plugins, store: inputStore, actor, sessionId }) => {
        events.push(`plugin-tools:${plugins}:${inputStore === store}:${actor.id}:${sessionId ?? "-"}`);
        return ["plugin-tool"];
      },
      replayApprovedTool: async ({ approvalId, store: inputStore, actor, tools }) => {
        events.push(`replay:${approvalId}:${inputStore === store}:${actor.id}:${tools.join(",")}`);
        return { ok: replayOk, approvalId, toolCount: tools.length };
      },
      writeText: (text: string) => events.push(`text:${text}`),
      writeJson: (value: unknown) => events.push(`json:${JSON.stringify(value)}`),
      writeError: (message: string) => events.push(`error:${message}`),
      setExitCode: (code: number) => events.push(`exit:${code}`),
    }),
  };
}

test("createApprovalDecisionCommand reports missing approval ids before opening platform state", async () => {
  const events: string[] = [];
  const { command } = createApprovalDecisionCommandForTest(events);

  const result = await command.execute({ command: "approve", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "parse:",
    "error:Missing approval id.",
    "exit:1",
  ]);
});

test("createApprovalDecisionCommand approves requests with reason text and closes the store", async () => {
  const events: string[] = [];
  const { command, store } = createApprovalDecisionCommandForTest(events);

  const result = await command.execute({ command: "approve", args: ["appr_1", "looks", "safe"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "parse:appr_1,looks,safe",
    "platform:C:/repo",
    "list",
    "decide:appr_1:approved:looks safe:-:false",
    "text:appr_1\tapproved\tworkspace.write\tlooks safe",
    "close",
  ]);
  assert.equal(store.closed, true);
});

test("createApprovalDecisionCommand denies requests through the deny alias", async () => {
  const events: string[] = [];
  const { command } = createApprovalDecisionCommandForTest(events, {
    parsed: { options: { localAgent: true }, positionals: ["appr_1", "not", "safe"] },
  });

  const result = await command.execute({ command: "deny", args: ["--local-agent", "appr_1", "not", "safe"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "parse:--local-agent,appr_1,not,safe",
    "platform:C:/repo",
    "list",
    "decide:appr_1:denied:not safe:-:true",
    "text:appr_1\tdenied\tworkspace.write\tnot safe",
    "close",
  ]);
});

test("createApprovalDecisionCommand rejects mutually exclusive resume options and closes the store", async () => {
  const events: string[] = [];
  const { command } = createApprovalDecisionCommandForTest(events, {
    parsed: { options: { autoResume: true, queueResumeWorkerId: "worker_1" }, positionals: ["appr_1"] },
  });

  const result = await command.execute({ command: "approve", args: ["appr_1", "--auto-resume", "--queue-resume", "worker_1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "parse:appr_1,--auto-resume,--queue-resume,worker_1",
    "platform:C:/repo",
    "error:--auto-resume and --queue-resume are mutually exclusive.",
    "exit:1",
    "close",
  ]);
});

test("createApprovalDecisionCommand auto-replays approved workspace and plugin tools", async () => {
  const events: string[] = [];
  const { command } = createApprovalDecisionCommandForTest(events, {
    parsed: { options: { autoReplay: true }, positionals: ["appr_1"] },
  });

  const result = await command.execute({ command: "approve", args: ["appr_1", "--auto-replay"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "parse:appr_1,--auto-replay",
    "platform:C:/repo",
    "list",
    "decide:appr_1:approved:-:-:false",
    "text:appr_1\tapproved\tworkspace.write\t",
    "pending:appr_1",
    "plugin-tools:plugins:true:decider:s1",
    "workspace-tools:workspace:true:locks:decider:s1",
    "replay:appr_1:true:decider:workspace-tool,plugin-tool",
    'json:{"replay":{"ok":true,"approvalId":"appr_1","toolCount":2}}',
    "close",
  ]);
});

test("createApprovalDecisionCommand queues approved sessions after successful replay", async () => {
  const events: string[] = [];
  const { command } = createApprovalDecisionCommandForTest(events, {
    parsed: { options: { queueResumeWorkerId: "worker_1", autoReplay: true }, positionals: ["appr_1"] },
  });

  const result = await command.execute({ command: "approve", args: ["appr_1", "--queue-resume", "worker_1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "parse:appr_1,--queue-resume,worker_1",
    "platform:C:/repo",
    "list",
    "decide:appr_1:approved:-:-:false",
    "text:appr_1\tapproved\tworkspace.write\t",
    "pending:appr_1",
    "plugin-tools:plugins:true:decider:s1",
    "workspace-tools:workspace:true:locks:decider:s1",
    "replay:appr_1:true:decider:workspace-tool,plugin-tool",
    'json:{"replay":{"ok":true,"approvalId":"appr_1","toolCount":2}}',
    "enqueue:worker_1:s1:appr_1:pending_1:apply_patch",
    "text:queued_resume\tassign_1\tworker_1\ts1",
    "close",
  ]);
});

test("createApprovalDecisionCommand runs MCP approved continuation without workspace replay", async () => {
  const events: string[] = [];
  const store = createApprovalDecisionStore(events, [{ id: "appr_mcp", action: "mcp.tool.call" }]);
  const { command } = createApprovalDecisionCommandForTest(events, {
    store,
    parsed: { options: { autoReplay: true }, positionals: ["appr_mcp"] },
    decidedApproval: { id: "appr_mcp", status: "approved", action: "mcp.tool.call" },
  });

  const result = await command.execute({ command: "approve", args: ["appr_mcp", "--auto-replay"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "parse:appr_mcp,--auto-replay",
    "platform:C:/repo",
    "list",
    "decide:appr_mcp:approved:-:-:false",
    "text:appr_mcp\tapproved\tmcp.tool.call\t",
    "mcp:appr_mcp:decider",
    'json:{"mcp":{"ok":true,"approvalId":"appr_mcp"}}',
    "close",
  ]);
});

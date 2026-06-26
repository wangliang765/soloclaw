import assert from "node:assert/strict";
import test from "node:test";
import { createAgentCommandsCommand, createKnowledgeCommand, createMcpCommand, createPluginsCommand, createSkillsCommand, createToolCommand } from "../cli/commands/tools.js";

type Options = { inputFile?: string; executionMode?: string };
type Store = { closed: boolean; close(): void };
type Platform = { store: Store; workspace: string };

function createDeps(events: string[], tools: Array<{ name: string; handler(input: unknown): Promise<unknown> }> = []) {
  const store: Store = {
    closed: false,
    close() {
      this.closed = true;
      events.push("close");
    },
  };
  return {
    store,
    deps: {
      cwd: () => "C:/repo",
      parseRunArgs: (args: string[]) => {
        events.push(`parse:${args.join(",")}`);
        return { task: args.join(" "), options: args.includes("--input-file") ? { inputFile: "input.json" } : {} };
      },
      createPlatform: async (cwd: string, options: Options): Promise<Platform> => {
        events.push(`platform:${cwd}:${JSON.stringify(options)}`);
        return { store, workspace: cwd };
      },
      createTools: async (_platform: Platform, parsed: { task: string; options: Options }) => {
        events.push(`tools:${parsed.task}`);
        return tools;
      },
      parseToolInput: async (toolName: string, text: string, inputFile?: string) => {
        events.push(`input:${toolName}:${text}:${inputFile ?? "-"}`);
        return { text, inputFile };
      },
      inputFile: (options: Options) => options.inputFile,
      writeJson: (value: unknown) => events.push(`json:${JSON.stringify(value)}`),
      writeError: (message: string) => events.push(`error:${message}`),
      setExitCode: (code: number) => events.push(`exit:${code}`),
    },
  };
}

test("createToolCommand reports a missing tool name before opening platform state", async () => {
  const events: string[] = [];
  const { deps } = createDeps(events);
  const command = createToolCommand(deps);

  const result = await command.execute({ command: "tool", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Missing tool name.", "exit:1"]);
});

test("createToolCommand reports unknown tools and closes the store", async () => {
  const events: string[] = [];
  const { deps, store } = createDeps(events);
  const command = createToolCommand(deps);

  const result = await command.execute({ command: "tool", args: ["missing", "payload"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "parse:payload",
    "platform:C:/repo:{}",
    "tools:payload",
    "error:Unknown tool: missing",
    "exit:1",
    "close",
  ]);
  assert.equal(store.closed, true);
});

test("createToolCommand invokes the matching tool and writes JSON result", async () => {
  const events: string[] = [];
  const { deps } = createDeps(events, [
    {
      name: "read_file",
      handler: async (input) => {
        events.push(`handler:${JSON.stringify(input)}`);
        return { ok: true, output: "hello" };
      },
    },
  ]);
  const command = createToolCommand(deps);

  const result = await command.execute({ command: "tool", args: ["read_file", "README.md", "--input-file"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "parse:README.md,--input-file",
    'platform:C:/repo:{"inputFile":"input.json"}',
    "tools:README.md --input-file",
    "input:read_file:README.md --input-file:input.json",
    'handler:{"text":"README.md --input-file","inputFile":"input.json"}',
    'json:{"ok":true,"output":"hello"}',
    "close",
  ]);
});

type AgentCommandItem = {
  name: string;
  template: string;
  description?: string;
  agentProfile?: string;
  model?: string;
  sourcePath?: string;
};

function createAgentCommandsDeps(
  events: string[],
  commands: AgentCommandItem[] = [
    {
      name: "fix",
      template: "Fix {{args}}",
      description: "Fix a bug",
      agentProfile: "builder",
      model: "dev-model",
      sourcePath: ".agent/commands/fix.md",
    },
  ],
  expandResult: string | Error = "Expanded command",
) {
  const store = {
    closed: false,
    async recordAuditEvent(event: { type: string; sessionId?: string; metadata?: { command?: string; argumentCount?: number } }) {
      events.push(`audit:${event.type}:${event.sessionId ?? "-"}:${event.metadata?.command ?? "-"}:${event.metadata?.argumentCount ?? "-"}`);
    },
    close() {
      this.closed = true;
      events.push("close");
    },
  };
  return {
    store,
    deps: {
      cwd: () => "C:/repo",
      resolveWorkspace: async (cwd: string, args: string[]) => {
        events.push(`resolve:${cwd}:${args.join(",")}`);
        return "C:/repo/project";
      },
      stripWorkspaceOption: (args: string[]) => {
        events.push(`strip:${args.join(",")}`);
        return args.filter((arg) => arg !== "--workspace" && arg !== "project");
      },
      commandDirectory: (workspace: string) => {
        events.push(`dir:${workspace}`);
        return `${workspace}/.agent/commands`;
      },
      loadCommands: async (directory: string) => {
        events.push(`load:${directory}`);
        return commands;
      },
      createCommandService: (workspace: string) => ({
        expand: async (input: { template: string; argumentsText: string }) => {
          events.push(`expand:${workspace}:${input.template}:${input.argumentsText}`);
          if (expandResult instanceof Error) {
            throw expandResult;
          }
          return expandResult;
        },
      }),
      defaultModelProfileForWorkspace: async (workspace: string) => {
        events.push(`model-profile:${workspace}`);
        return "default-profile";
      },
      createPlatform: async (workspace: string, options: { agentProfile?: string; model?: string; modelProfile?: string }) => {
        events.push(`platform:${workspace}:${options.agentProfile ?? "-"}:${options.model ?? "-"}:${options.modelProfile ?? "-"}`);
        return {
          store,
          agent: {
            runWithSession: async (prompt: string) => {
              events.push(`run:${prompt}`);
              return { finalAnswer: "Final answer", session: { id: "s1" } };
            },
          },
        };
      },
      makeAuditId: () => "audit_1",
      now: () => new Date("2026-06-26T00:00:00.000Z"),
      splitCliWords: (value: string) => value ? value.split(/\s+/) : [],
      writeText: (text: string) => events.push(`text:${text}`),
      writeJson: (value: unknown) => events.push(`json:${JSON.stringify(value)}`),
      writeError: (message: string) => events.push(`error:${message}`),
      setExitCode: (code: number) => events.push(`exit:${code}`),
    },
  };
}

test("createAgentCommandsCommand lists command templates", async () => {
  const events: string[] = [];
  const { deps } = createAgentCommandsDeps(events);
  const command = createAgentCommandsCommand(deps);

  const result = await command.execute({ command: "commands", args: ["list", "--workspace", "project"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:--workspace,project",
    "strip:--workspace,project",
    "dir:C:/repo/project",
    "load:C:/repo/project/.agent/commands",
    "text:fix\tbuilder\tFix a bug",
  ]);
});

test("createAgentCommandsCommand shows a command template as JSON", async () => {
  const events: string[] = [];
  const { deps } = createAgentCommandsDeps(events);
  const command = createAgentCommandsCommand(deps);

  const result = await command.execute({ command: "commands", args: ["show", "fix"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:fix",
    "strip:fix",
    "dir:C:/repo/project",
    "load:C:/repo/project/.agent/commands",
    'json:{"name":"fix","template":"Fix {{args}}","description":"Fix a bug","agentProfile":"builder","model":"dev-model","sourcePath":".agent/commands/fix.md"}',
  ]);
});

test("createAgentCommandsCommand reports missing command names", async () => {
  const events: string[] = [];
  const { deps } = createAgentCommandsDeps(events);
  const command = createAgentCommandsCommand(deps);

  const result = await command.execute({ command: "commands", args: ["show"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:",
    "strip:",
    "dir:C:/repo/project",
    "load:C:/repo/project/.agent/commands",
    "error:Missing command name.",
    "exit:1",
  ]);
});

test("createAgentCommandsCommand runs a command template with audit and closes the store", async () => {
  const events: string[] = [];
  const { deps, store } = createAgentCommandsDeps(events);
  const command = createAgentCommandsCommand(deps);

  const result = await command.execute({ command: "commands", args: ["run", "fix", "bug", "42"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:fix,bug,42",
    "strip:fix,bug,42",
    "dir:C:/repo/project",
    "load:C:/repo/project/.agent/commands",
    "expand:C:/repo/project:Fix {{args}}:bug 42",
    "model-profile:C:/repo/project",
    "platform:C:/repo/project:builder:dev-model:default-profile",
    "run:Expanded command",
    "audit:agent.command_template_executed:s1:fix:2",
    "text:Final answer",
    "text:",
    "text:session: s1",
    "close",
  ]);
  assert.equal(store.closed, true);
});

test("createAgentCommandsCommand reports expansion failures before opening platform state", async () => {
  const events: string[] = [];
  const { deps } = createAgentCommandsDeps(events, undefined, new Error("bad template"));
  const command = createAgentCommandsCommand(deps);

  const result = await command.execute({ command: "commands", args: ["run", "fix", "bug"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:fix,bug",
    "strip:fix,bug",
    "dir:C:/repo/project",
    "load:C:/repo/project/.agent/commands",
    "expand:C:/repo/project:Fix {{args}}:bug",
    "error:bad template",
    "exit:1",
  ]);
});

type SkillRecord = {
  manifest: {
    name: string;
    version: string;
    description: string;
  };
  scope: string;
};

function createSkillsDeps(
  events: string[],
  skills: SkillRecord[] = [
    {
      manifest: { name: "review", version: "1.0.0", description: "Review code" },
      scope: "project",
    },
  ],
  shownSkill: unknown = undefined,
) {
  const store = {
    closed: false,
    async listSkills() {
      events.push("list");
      return skills;
    },
    async getSkill(name: string) {
      events.push(`get:${name}`);
      return shownSkill;
    },
    close() {
      this.closed = true;
      events.push("close");
    },
  };
  return {
    store,
    deps: {
      cwd: () => "C:/repo",
      skillsDirectory: (cwd: string) => {
        events.push(`dir:${cwd}`);
        return `${cwd}/.agent/skills`;
      },
      createPlatform: async (cwd: string) => {
        events.push(`platform:${cwd}`);
        return {
          store,
          skills: {
            loadDirectory: async (directory: string) => {
              events.push(`load:${directory}`);
              return skills;
            },
          },
        };
      },
      writeText: (text: string) => events.push(`text:${text}`),
      writeJson: (value: unknown) => events.push(`json:${JSON.stringify(value)}`),
      writeError: (message: string) => events.push(`error:${message}`),
      setExitCode: (code: number) => events.push(`exit:${code}`),
    },
  };
}

test("createSkillsCommand lists stored skills and closes the store", async () => {
  const events: string[] = [];
  const { deps, store } = createSkillsDeps(events);
  const command = createSkillsCommand(deps);

  const result = await command.execute({ command: "skills", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "platform:C:/repo",
    "list",
    "text:review@1.0.0\tproject\tReview code",
    "close",
  ]);
  assert.equal(store.closed, true);
});

test("createSkillsCommand loads workspace skills from the injected directory", async () => {
  const events: string[] = [];
  const { deps } = createSkillsDeps(events);
  const command = createSkillsCommand(deps);

  const result = await command.execute({ command: "skills", args: ["load"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "platform:C:/repo",
    "dir:C:/repo",
    "load:C:/repo/.agent/skills",
    "text:review@1.0.0\tproject\tReview code",
    "close",
  ]);
});

test("createSkillsCommand shows a skill as JSON", async () => {
  const events: string[] = [];
  const shown = { manifest: { name: "review", version: "1.0.0", description: "Review code" }, scope: "project", path: "skill.md" };
  const { deps } = createSkillsDeps(events, undefined, shown);
  const command = createSkillsCommand(deps);

  const result = await command.execute({ command: "skills", args: ["show", "review"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "platform:C:/repo",
    "get:review",
    'json:{"manifest":{"name":"review","version":"1.0.0","description":"Review code"},"scope":"project","path":"skill.md"}',
    "close",
  ]);
});

test("createSkillsCommand reports missing and unknown skill names with cleanup", async () => {
  const events: string[] = [];
  const { deps } = createSkillsDeps(events);
  const command = createSkillsCommand(deps);

  await command.execute({ command: "skills", args: ["show"], context: undefined });
  await command.execute({ command: "skills", args: ["show", "missing"], context: undefined });

  assert.deepEqual(events, [
    "platform:C:/repo",
    "error:Missing skill name.",
    "exit:1",
    "close",
    "platform:C:/repo",
    "get:missing",
    "error:Skill not found: missing",
    "exit:1",
    "close",
  ]);
});

function createKnowledgeDeps(events: string[]) {
  const store = {
    closed: false,
    close() {
      this.closed = true;
      events.push("close");
    },
  };
  const knowledge = {
    async ingestText() {
      return {
        source: { id: "ksrc_1", scopeType: "project", scopeId: "local", name: "Manual" },
        chunks: [],
      };
    },
    async listSources() {
      return [];
    },
    async search(input: { query: string; scopeType?: string; scopeId?: string; limit?: number; enforceAccess?: boolean; safetyMode?: string }) {
      events.push(`search:${input.query}:${input.scopeType}:${input.scopeId}:${input.limit ?? "-"}:${input.enforceAccess ?? false}:${input.safetyMode ?? "-"}`);
      return [
        {
          citationId: "kcite_1",
          source: { id: "ksrc_1", name: "Deploy Guide" },
          chunk: { sourceId: "ksrc_1", ordinal: 0 },
          score: 0.87,
          snippet: "Use the release gate.",
          safetyFindings: [],
        },
      ];
    },
    async createEvalSet() {
      return { id: "kevalset_1", cases: [], scopeType: "project", scopeId: "local", name: "Eval" };
    },
    async listEvalSets() {
      return [];
    },
    async listEvalRuns() {
      return [];
    },
    async summarizeEvalTrend() {
      return { runCount: 0, passRate: 0, passCount: 0, failCount: 0, regression: { detected: false, reasons: [] } };
    },
    async evaluate() {
      return {
        caseCount: 0,
        limit: 10,
        metrics: { recallAtK: 0, mrr: 0, emptyResultRate: 0, citationPrecision: 0, permissionLeakRate: 0, permissionLeakCount: 0 },
        gate: { passed: true, failures: [] },
        cases: [],
      };
    },
  };
  return {
    deps: {
      cwd: () => "C:/repo",
      createPlatform: async (cwd: string) => {
        events.push(`platform:${cwd}`);
        return { knowledge, store };
      },
      actor: () => ({ type: "user" as const, id: "local-user", displayName: "Local User" }),
      readUtf8: async (filePath: string) => {
        events.push(`read:${filePath}`);
        return "";
      },
      writeText: (text: string) => events.push(`text:${text}`),
      writeJson: (value: unknown) => events.push(`json:${JSON.stringify(value)}`),
      writeError: (message: string) => events.push(`error:${message}`),
      setExitCode: (code: number) => events.push(`exit:${code}`),
    },
    store,
  };
}

test("createKnowledgeCommand searches with default product scope and closes the store", async () => {
  const events: string[] = [];
  const { deps, store } = createKnowledgeDeps(events);
  const command = createKnowledgeCommand(deps);

  const result = await command.execute({ command: "knowledge", args: ["search", "--limit", "3", "--enforce-acl", "--safety", "exclude", "release", "gate"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "platform:C:/repo",
    "search:release gate:project:local:3:true:exclude",
    "text:kcite_1\tsource=ksrc_1\tchunk=0\tscore=0.87\tDeploy Guide",
    "text:Use the release gate.",
    "close",
  ]);
  assert.equal(store.closed, true);
});

function createPluginsDeps(events: string[]) {
  const store = {
    closed: false,
    close() {
      this.closed = true;
      events.push("close");
    },
  };
  return {
    deps: {
      cwd: () => "C:/repo",
      parseRunArgs: (args: string[]) => ({ task: args.join(" "), options: {} }),
      createPlatform: async (cwd: string) => {
        events.push(`platform:${cwd}`);
        return {
          store,
          policy: {},
          plugins: {
            async listPlugins() {
              events.push("list");
              return [
                {
                  id: "demo",
                  rootDir: "C:/repo/.agent/plugins/demo",
                  manifestPath: "C:/repo/.agent/plugins/demo/plugin.json",
                  manifest: {
                    name: "demo",
                    version: "1.2.3",
                    permissions: ["shell.run"],
                    commands: [{ name: "echo", risk: "low" }],
                  },
                },
              ];
            },
            async createTools() {
              events.push("tools");
              return [] as any[];
            },
          },
        };
      },
      withPolicy: (tools: any[]) => {
        events.push("policy");
        return tools;
      },
      actor: () => ({ type: "user" as const, id: "local-user", displayName: "Local User" }),
      writeJson: (value: unknown) => events.push(`json:${JSON.stringify(value)}`),
      writeText: (text: string) => events.push(`text:${text}`),
      writeError: (message: string) => events.push(`error:${message}`),
      setExitCode: (code: number) => events.push(`exit:${code}`),
    },
    store,
  };
}

test("createPluginsCommand lists plugin tools and closes the store", async () => {
  const events: string[] = [];
  const { deps, store } = createPluginsDeps(events);
  const command = createPluginsCommand(deps);

  const result = await command.execute({ command: "plugins", args: ["list"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "platform:C:/repo",
    "list",
    "text:plugin.demo.echo\t1.2.3\tlow\tshell.run",
    "close",
  ]);
  assert.equal(store.closed, true);
});

function createMcpDeps(events: string[]) {
  const server = {
    id: "demo",
    name: "Demo",
    transport: "stdio" as const,
    command: "node",
    args: ["server.js"],
    url: undefined,
    envVarNames: [],
    capabilities: ["tools" as const],
    policy: { enabled: true, risk: "medium" as const, requireApproval: true },
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z",
  };
  const store = {
    closed: false,
    async recordAuditEvent(event: { type: string; metadata?: { id?: string } }) {
      events.push(`audit:${event.type}:${event.metadata?.id ?? "-"}`);
    },
    close() {
      this.closed = true;
      events.push("store-close");
    },
  };
  const locks = {
    closed: false,
    close() {
      this.closed = true;
      events.push("locks-close");
    },
  };
  return {
    deps: {
      cwd: () => "C:/repo",
      createPlatform: async (cwd: string) => {
        events.push(`platform:${cwd}`);
        return { store, locks, policy: {}, redactor: {}, secretBroker: {} };
      },
      createRegistry: (cwd: string) => {
        events.push(`registry:${cwd}`);
        return {
          filePath: "C:/repo/.agent/mcp-servers.json",
          async list() {
            events.push("list");
            return [server];
          },
          async get() {
            return server;
          },
          async register() {
            return server;
          },
          async remove() {
            return true;
          },
        };
      },
      createConnectionPlanner: () => ({ plan: async () => ({ status: "allow" as const, reason: "ok", server, connection: server, scope: {} }) }),
      createExecutionService: () => ({ execute: async () => ({ plan: { server }, operation: "list_capabilities" }) }),
      createHealthService: () => ({ check: async () => ({ serverId: "demo", status: "healthy" }) }),
      actor: () => ({ type: "user" as const, id: "local-user", displayName: "Local User" }),
      makeAuditId: () => "audit_1",
      now: () => new Date("2026-06-26T00:00:00.000Z"),
      readUtf8: async () => "{}",
      writeText: (text: string) => events.push(`text:${text}`),
      writeJson: (value: unknown) => events.push(`json:${JSON.stringify(value)}`),
      writeError: (message: string) => events.push(`error:${message}`),
      setExitCode: (code: number) => events.push(`exit:${code}`),
    },
    store,
    locks,
  };
}

test("createMcpCommand lists MCP servers as JSON and closes platform resources", async () => {
  const events: string[] = [];
  const { deps, store, locks } = createMcpDeps(events);
  const command = createMcpCommand(deps);

  const result = await command.execute({ command: "mcp", args: ["list", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "platform:C:/repo",
    "registry:C:/repo",
    "list",
    'json:{"servers":[{"id":"demo","name":"Demo","transport":"stdio","command":"node","args":["server.js"],"envVarNames":[],"capabilities":["tools"],"policy":{"enabled":true,"risk":"medium","requireApproval":true},"createdAt":"2026-06-26T00:00:00.000Z","updatedAt":"2026-06-26T00:00:00.000Z"}],"configPath":"C:/repo/.agent/mcp-servers.json"}',
    "locks-close",
    "store-close",
  ]);
  assert.equal(store.closed, true);
  assert.equal(locks.closed, true);
});

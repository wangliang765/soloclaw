import assert from "node:assert/strict";
import test from "node:test";
import { createDoctorCommand, createInitCommand, createInspectCommand, createLocalAgentCommand, createPlatformCommand, createSmokeCommand, createStatusCommand, createTuiCommand, createWorkbenchVerifyCommand } from "../cli/commands/workbench.js";

test("createInitCommand renders text view with resolved workspace", async () => {
  const events: string[] = [];
  const command = createInitCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    stripWorkspaceOption: (args) => args.filter((arg) => arg !== "--workspace" && arg !== "project"),
    initializeWorkspace: async (cwd, workspace, args) => {
      events.push(`init:${cwd}:${workspace}:${args.join(",")}`);
      return { json: false, view: { workspace, args } };
    },
    renderInit: (view) => events.push(`render:${JSON.stringify(view)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "setup", args: ["--workspace", "project", "--wizard"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:--workspace,project,--wizard",
    "init:C:/repo:C:/repo/project:--wizard",
    'render:{"workspace":"C:/repo/project","args":["--wizard"]}',
  ]);
});

test("createInitCommand writes json view", async () => {
  const events: string[] = [];
  const command = createInitCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo/project",
    stripWorkspaceOption: (args) => args,
    initializeWorkspace: async () => ({ json: true, view: { initialized: true } }),
    renderInit: (view) => events.push(`render:${JSON.stringify(view)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "init", args: ["--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ['json:{"initialized":true}']);
});

test("createInitCommand reports errors and sets exit code", async () => {
  const events: string[] = [];
  const command = createInitCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => {
      throw new Error("init failed");
    },
    stripWorkspaceOption: (args) => args,
    initializeWorkspace: async () => ({ json: true, view: {} }),
    renderInit: (view) => events.push(`render:${JSON.stringify(view)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "init", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:init failed", "exit:1"]);
});

test("createTuiCommand starts tui with resolved workspace and cwd history root", async () => {
  const events: string[] = [];
  const command = createTuiCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    startTui: async (workspace, historyRoot) => {
      events.push(`tui:${workspace}:${historyRoot}`);
    },
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "tui", args: ["--workspace", "project"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["resolve:C:/repo:--workspace,project", "tui:C:/repo/project:C:/repo"]);
});

test("createTuiCommand reports startup errors and sets exit code", async () => {
  const events: string[] = [];
  const command = createTuiCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo/project",
    startTui: async () => {
      throw new Error("tui failed");
    },
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "tui", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:tui failed", "exit:1"]);
});

test("createLocalAgentCommand renders status by default", async () => {
  const events: string[] = [];
  const command = createLocalAgentCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    stripWorkspaceOption: (args) => args.filter((arg) => arg !== "--workspace" && arg !== "project"),
    parseArgs: (args) => {
      events.push(`parse:${args.join(",")}`);
      return { options: { json: false, limit: 5 } };
    },
    openPlatform: async (workspace) => {
      events.push(`open:${workspace}`);
      return {
        store: { id: "store" },
        close: () => events.push("close"),
      };
    },
    buildStatus: async (store, workspace, options) => ({ store: store.id, workspace, options, servicePlan: { mode: "foreground" } }),
    buildLogs: async () => [{ id: "log" }],
    renderStatus: (status) => events.push(`status:${JSON.stringify(status)}`),
    renderServicePlan: (plan) => events.push(`service:${JSON.stringify(plan)}`),
    renderLogs: (logs) => events.push(`logs:${JSON.stringify(logs)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "agent", args: ["--workspace", "project"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:--workspace,project",
    "parse:",
    "open:C:/repo/project",
    'status:{"store":"store","workspace":"C:/repo/project","options":{"json":false,"limit":5},"servicePlan":{"mode":"foreground"}}',
    "close",
  ]);
});

test("createLocalAgentCommand writes service plan json", async () => {
  const events: string[] = [];
  const command = createLocalAgentCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo/project",
    stripWorkspaceOption: (args) => args,
    parseArgs: (args) => {
      events.push(`parse:${args.join(",")}`);
      return { options: { json: true } };
    },
    openPlatform: async () => ({
      store: {},
      close: () => events.push("close"),
    }),
    buildStatus: async () => ({ servicePlan: { manager: "systemd_user" } }),
    buildLogs: async () => [],
    renderStatus: (status) => events.push(`status:${JSON.stringify(status)}`),
    renderServicePlan: (plan) => events.push(`service:${JSON.stringify(plan)}`),
    renderLogs: (logs) => events.push(`logs:${JSON.stringify(logs)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "local", args: ["service", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["parse:--json", 'json:{"manager":"systemd_user"}', "close"]);
});

test("createLocalAgentCommand renders timeline logs", async () => {
  const events: string[] = [];
  const command = createLocalAgentCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo/project",
    stripWorkspaceOption: (args) => args,
    parseArgs: (args) => {
      events.push(`parse:${args.join(",")}`);
      return { options: {} };
    },
    openPlatform: async () => ({
      store: {},
      close: () => events.push("close"),
    }),
    buildStatus: async () => ({ servicePlan: {} }),
    buildLogs: async () => [{ kind: "session" }],
    renderStatus: (status) => events.push(`status:${JSON.stringify(status)}`),
    renderServicePlan: (plan) => events.push(`service:${JSON.stringify(plan)}`),
    renderLogs: (logs) => events.push(`logs:${JSON.stringify(logs)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "agent", args: ["timeline"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["parse:", 'logs:[{"kind":"session"}]', "close"]);
});

test("createLocalAgentCommand reports unknown subcommands and closes platform", async () => {
  const events: string[] = [];
  const command = createLocalAgentCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo/project",
    stripWorkspaceOption: (args) => args,
    parseArgs: () => ({ options: {} }),
    openPlatform: async () => ({
      store: {},
      close: () => events.push("close"),
    }),
    buildStatus: async () => ({ servicePlan: {} }),
    buildLogs: async () => [],
    renderStatus: (status) => events.push(`status:${JSON.stringify(status)}`),
    renderServicePlan: (plan) => events.push(`service:${JSON.stringify(plan)}`),
    renderLogs: (logs) => events.push(`logs:${JSON.stringify(logs)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "agent", args: ["missing"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Unknown local agent command: missing", "exit:1", "close"]);
});

test("createStatusCommand renders text status with resolved workspace", async () => {
  const events: string[] = [];
  const command = createStatusCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    buildStatus: async (cwd, workspace) => ({ cwd, workspace, status: "ok" }),
    renderStatus: (view) => events.push(`render:${JSON.stringify(view)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "status", args: ["--workspace", "project"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:--workspace,project",
    'render:{"cwd":"C:/repo","workspace":"C:/repo/project","status":"ok"}',
  ]);
});

test("createStatusCommand writes json when requested", async () => {
  const events: string[] = [];
  const command = createStatusCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo/project",
    buildStatus: async () => ({ ready: true }),
    renderStatus: () => events.push("render"),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "status", args: ["--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ['json:{"ready":true}']);
});

test("createStatusCommand reports errors and sets exit code", async () => {
  const events: string[] = [];
  const command = createStatusCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => {
      throw new Error("status failed");
    },
    buildStatus: async () => ({ ready: true }),
    renderStatus: () => events.push("render"),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "status", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:status failed", "exit:1"]);
});

test("createPlatformCommand renders platform doctor text by default", async () => {
  const events: string[] = [];
  const command = createPlatformCommand({
    detectCapabilities: async () => ({ platform: { id: "windows" } }),
    usesLegacyConfig: async () => false,
    buildDoctorView: (capabilities, legacyConfig) => ({ capabilities, legacyConfig }),
    renderDoctor: (capabilities) => events.push(`render:${JSON.stringify(capabilities)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "platform", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ['render:{"platform":{"id":"windows"}}']);
});

test("createPlatformCommand writes json for platform doctor json", async () => {
  const events: string[] = [];
  const command = createPlatformCommand({
    detectCapabilities: async () => ({ platform: { id: "linux" } }),
    usesLegacyConfig: async () => true,
    buildDoctorView: (capabilities, legacyConfig) => ({ capabilities, legacyConfig }),
    renderDoctor: (capabilities) => events.push(`render:${JSON.stringify(capabilities)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "platform", args: ["doctor", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ['json:{"capabilities":{"platform":{"id":"linux"}},"legacyConfig":true}']);
});

test("createPlatformCommand rejects unknown platform subcommands", async () => {
  const events: string[] = [];
  const command = createPlatformCommand({
    detectCapabilities: async () => ({ platform: { id: "windows" } }),
    usesLegacyConfig: async () => false,
    buildDoctorView: (capabilities, legacyConfig) => ({ capabilities, legacyConfig }),
    renderDoctor: (capabilities) => events.push(`render:${JSON.stringify(capabilities)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "platform", args: ["missing"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Usage: soloclaw platform doctor [--json]", "exit:1"]);
});

test("createDoctorCommand renders readiness text with resolved workspace", async () => {
  const events: string[] = [];
  const command = createDoctorCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    stripWorkspaceOption: (args) => args.filter((arg) => arg !== "--workspace" && arg !== "project"),
    verifyReadiness: async (workspace) => ({ workspace, status: "pass" }),
    renderReadiness: (view) => events.push(`render:${JSON.stringify(view)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "doctor", args: ["--workspace", "project"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:--workspace,project",
    'render:{"workspace":"C:/repo/project","status":"pass"}',
  ]);
});

test("createDoctorCommand supports check alias and json output", async () => {
  const events: string[] = [];
  const command = createDoctorCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo/project",
    stripWorkspaceOption: (args) => args,
    verifyReadiness: async (workspace) => ({ workspace, status: "fail" }),
    renderReadiness: (view) => events.push(`render:${JSON.stringify(view)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "check", args: ["--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ['json:{"workspace":"C:/repo/project","status":"fail"}']);
});

test("createDoctorCommand reports errors and sets exit code", async () => {
  const events: string[] = [];
  const command = createDoctorCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => {
      throw new Error("readiness failed");
    },
    stripWorkspaceOption: (args) => args,
    verifyReadiness: async () => ({ status: "pass" }),
    renderReadiness: (view) => events.push(`render:${JSON.stringify(view)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "doctor", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:readiness failed", "exit:1"]);
});

test("createInspectCommand renders text snapshot without key previews by default", async () => {
  const events: string[] = [];
  const command = createInspectCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    stripWorkspaceOption: (args) => args.filter((arg) => arg !== "--workspace" && arg !== "project"),
    parseInspectArgs: () => ({ json: false, includeKeyFiles: false }),
    collectSnapshot: async (workspace) => ({ workspace, files: ["package.json"] }),
    collectKeyFilePreviews: async () => {
      events.push("previews");
      return ["preview"];
    },
    renderSnapshot: (snapshot) => `snapshot:${JSON.stringify(snapshot)}`,
    renderFilePreviews: (previews) => `previews:${JSON.stringify(previews)}`,
    now: () => new Date("2026-06-26T00:00:00.000Z"),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "inspect", args: ["--workspace", "project"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:--workspace,project",
    'text:snapshot:{"workspace":"C:/repo/project","files":["package.json"]}',
  ]);
});

test("createInspectCommand writes json and key previews when requested", async () => {
  const events: string[] = [];
  const command = createInspectCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo/project",
    stripWorkspaceOption: (args) => args.filter((arg) => arg !== "--workspace" && arg !== "project"),
    parseInspectArgs: () => ({
      json: true,
      includeKeyFiles: true,
      maxKeyFiles: 2,
      maxPreviewLines: 10,
      maxPreviewChars: 100,
    }),
    collectSnapshot: async () => ({ files: ["package.json"] }),
    collectKeyFilePreviews: async (workspace, snapshot, limits) => {
      events.push(`previews:${workspace}:${JSON.stringify(snapshot)}:${JSON.stringify(limits)}`);
      return [{ path: "package.json" }];
    },
    renderSnapshot: (snapshot) => `snapshot:${JSON.stringify(snapshot)}`,
    renderFilePreviews: (previews) => `previews:${JSON.stringify(previews)}`,
    now: () => new Date("2026-06-26T00:00:00.000Z"),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "inspect", args: ["--json", "--include-key-files"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    'previews:C:/repo/project:{"files":["package.json"]}:{"maxFiles":2,"maxLines":10,"maxChars":100}',
    'json:{"generatedAt":"2026-06-26T00:00:00.000Z","root":"C:/repo/project","snapshot":{"files":["package.json"]},"keyFilePreviews":[{"path":"package.json"}],"text":"snapshot:{\\"files\\":[\\"package.json\\"]}\\n\\npreviews:[{\\"path\\":\\"package.json\\"}]"}',
  ]);
});

test("createInspectCommand reports errors and sets exit code", async () => {
  const events: string[] = [];
  const command = createInspectCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => {
      throw new Error("inspect failed");
    },
    stripWorkspaceOption: (args) => args,
    parseInspectArgs: () => ({ json: false, includeKeyFiles: false }),
    collectSnapshot: async () => ({}),
    collectKeyFilePreviews: async () => [],
    renderSnapshot: () => "snapshot",
    renderFilePreviews: () => "previews",
    now: () => new Date("2026-06-26T00:00:00.000Z"),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "inspect", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:inspect failed", "exit:1"]);
});

test("createSmokeCommand runs default smoke with resolved workspace", async () => {
  const events: string[] = [];
  const command = createSmokeCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    runDefaultSmoke: async (workspace) => `default:${workspace}`,
    runRichTuiSmoke: async () => ({ kind: "rich" }),
    runRichTuiRealProviderSmoke: async () => ({ ok: true, kind: "real" }),
    formatRichTuiSmoke: (result) => `rich:${JSON.stringify(result)}`,
    formatRichTuiRealProviderSmoke: (result) => `real:${JSON.stringify(result)}`,
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "smoke", args: ["--workspace", "project"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["resolve:C:/repo:--workspace,project", "text:default:C:/repo/project"]);
});

test("createSmokeCommand runs rich tui smoke aliases", async () => {
  const events: string[] = [];
  const command = createSmokeCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo/project",
    runDefaultSmoke: async () => "default",
    runRichTuiSmoke: async (workspace) => ({ workspace, rich: true }),
    runRichTuiRealProviderSmoke: async () => ({ ok: true }),
    formatRichTuiSmoke: (result) => `rich:${JSON.stringify(result)}`,
    formatRichTuiRealProviderSmoke: (result) => `real:${JSON.stringify(result)}`,
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "smoke", args: ["rich-tui"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ['text:rich:{"workspace":"C:/repo/project","rich":true}']);
});

test("createSmokeCommand sets exit code for failing real provider smoke", async () => {
  const events: string[] = [];
  const command = createSmokeCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo/project",
    runDefaultSmoke: async () => "default",
    runRichTuiSmoke: async () => ({ rich: true }),
    runRichTuiRealProviderSmoke: async (workspace, options) => ({ ok: false, workspace, longTask: Boolean(options?.longTask) }),
    formatRichTuiSmoke: (result) => `rich:${JSON.stringify(result)}`,
    formatRichTuiRealProviderSmoke: (result) => `real:${JSON.stringify(result)}`,
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "smoke", args: ["--rich-tui-real-provider-long-task"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ['text:real:{"ok":false,"workspace":"C:/repo/project","longTask":true}', "exit:1"]);
});

test("createSmokeCommand reports errors and sets exit code", async () => {
  const events: string[] = [];
  const command = createSmokeCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => {
      throw new Error("smoke failed");
    },
    runDefaultSmoke: async () => "default",
    runRichTuiSmoke: async () => ({ rich: true }),
    runRichTuiRealProviderSmoke: async () => ({ ok: true }),
    formatRichTuiSmoke: (result) => `rich:${JSON.stringify(result)}`,
    formatRichTuiRealProviderSmoke: (result) => `real:${JSON.stringify(result)}`,
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "smoke", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:smoke failed", "exit:1"]);
});

test("createWorkbenchVerifyCommand writes json completion gate view", async () => {
  const events: string[] = [];
  const command = createWorkbenchVerifyCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    stripWorkspaceOption: (args) => args.filter((arg) => arg !== "--workspace" && arg !== "project"),
    openStore: async (workspace) => {
      events.push(`open:${workspace}`);
      return {
        store: { id: "store" },
        close: () => events.push("close"),
      };
    },
    buildReport: async (store, sessionId) => {
      events.push(`report:${store.id}:${sessionId}`);
      return {
        session: { targetMode: "build" },
        summary: { changedPaths: ["src/a.ts", "src/b.ts"], pendingApprovals: 0, failedToolResults: 0 },
        commandEvents: [{ command: "npm test", exitCode: 0 }, { command: "npm run check", exitCode: null }],
      };
    },
    evaluateGate: (input) => {
      events.push(`gate:${input.targetMode}:${input.changedFiles.length}:${input.commandEvents.length}`);
      return { status: "pass", missingEvidence: [], summary: "ready" };
    },
    now: () => new Date("2026-06-26T00:00:00.000Z"),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "workbench", args: ["verify", "session-1", "--workspace", "project", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:--workspace,project,--json",
    "open:C:/repo/project",
    "report:store:session-1",
    "gate:build:2:2",
    'json:{"kind":"workbench_completion_gate","generatedAt":"2026-06-26T00:00:00.000Z","sessionId":"session-1","status":"pass","missingEvidence":[],"summary":"ready","signals":{"targetMode":"build","changedFiles":2,"commandEvents":2,"pendingApprovals":0,"failedToolResults":0},"reviewCommands":{"report":"agent session report session-1 --json","verify":"agent workbench verify session-1 --json"}}',
    "close",
  ]);
});

test("createWorkbenchVerifyCommand renders text and blocks on failed gate", async () => {
  const events: string[] = [];
  const command = createWorkbenchVerifyCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo/project",
    stripWorkspaceOption: (args) => args,
    openStore: async () => ({
      store: {},
      close: () => events.push("close"),
    }),
    buildReport: async () => ({
      session: { targetMode: "goal" },
      summary: { changedPaths: [], pendingApprovals: 1, failedToolResults: 2 },
      commandEvents: [],
    }),
    evaluateGate: () => ({ status: "block", missingEvidence: ["test"], summary: "needs tests" }),
    now: () => new Date("2026-06-26T00:00:00.000Z"),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "workbench", args: ["verify", "session-1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "text:block\tneeds tests",
    "text:changedFiles=0\tcommands=0\tpendingApprovals=1\tfailedToolResults=2",
    "exit:1",
    "close",
  ]);
});

test("createWorkbenchVerifyCommand reports usage for missing session id", async () => {
  const events: string[] = [];
  const command = createWorkbenchVerifyCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo/project",
    stripWorkspaceOption: (args) => args,
    openStore: async () => ({
      store: {},
      close: () => events.push("close"),
    }),
    buildReport: async () => ({
      session: { targetMode: "build" },
      summary: { changedPaths: [], pendingApprovals: 0, failedToolResults: 0 },
      commandEvents: [],
    }),
    evaluateGate: () => ({ status: "pass", missingEvidence: [], summary: "ready" }),
    now: () => new Date("2026-06-26T00:00:00.000Z"),
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "workbench", args: ["verify"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Usage: agent workbench verify <session-id> [--json]", "exit:1"]);
});

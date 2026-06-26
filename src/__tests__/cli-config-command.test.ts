import assert from "node:assert/strict";
import test from "node:test";
import { createConfigCommand, createSecretsCommand } from "../cli/commands/config.js";

type Profile = { id: string };

type Store = {
  filePath: string;
  list(): Promise<Profile[]>;
  getDefaultProfile(): Promise<string | undefined>;
  usesLegacyConfig(): Promise<boolean>;
};

function createDeps(events: string[]) {
  const store: Store = {
    filePath: "C:/home/.soloclaw/model-profiles.json",
    async list() {
      return [{ id: "mock" }];
    },
    async getDefaultProfile() {
      return "mock";
    },
    async usesLegacyConfig() {
      return false;
    },
  };
  return {
    stripWorkspaceOption: (args: string[]) => args.filter((arg) => arg !== "--workspace" && arg !== "project"),
    createProfiles: () => store,
    detectCapabilities: async () => ({
      platform: { id: "windows" },
      paths: { configDir: "C:/home/.soloclaw" },
      shellHints: { primary: "powershell" },
    }),
    now: () => new Date("2026-06-26T00:00:00.000Z"),
    renderProfiles: (profiles: Profile[], defaultProfile: string | undefined) => events.push(`profiles:${profiles.length}:${defaultProfile}`),
    writeText: (text: string) => events.push(`text:${text}`),
    writeJson: (value: unknown) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message: string) => events.push(`error:${message}`),
    setExitCode: (code: number) => events.push(`exit:${code}`),
  };
}

test("createConfigCommand writes config path diagnostics as json", async () => {
  const events: string[] = [];
  const command = createConfigCommand(createDeps(events));

  const result = await command.execute({ command: "config", args: ["path", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(JSON.parse(events[0].slice("json:".length)), {
    generatedAt: "2026-06-26T00:00:00.000Z",
    configPath: "C:/home/.soloclaw/model-profiles.json",
    legacyConfig: false,
    platform: { id: "windows" },
    paths: { configDir: "C:/home/.soloclaw" },
    capabilities: {
      platform: { id: "windows" },
      paths: { configDir: "C:/home/.soloclaw" },
      shellHints: { primary: "powershell" },
    },
  });
});

test("createConfigCommand renders show text by default", async () => {
  const events: string[] = [];
  const command = createConfigCommand(createDeps(events));

  const result = await command.execute({ command: "config", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["text:config=C:/home/.soloclaw/model-profiles.json", "text:default=mock", "profiles:1:mock"]);
});

test("createConfigCommand reports unknown subcommands", async () => {
  const events: string[] = [];
  const command = createConfigCommand(createDeps(events));

  const result = await command.execute({ command: "config", args: ["edit"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Unknown config command: edit", "exit:1"]);
});

type SecretRef = {
  id: string;
  class: string;
  scopeType: string;
  scopeId: string;
  name: string;
};

function createSecretsDeps(events: string[]) {
  const refs: SecretRef[] = [
    { id: "sec_alpha", class: "environment_secret", scopeType: "workspace", scopeId: "local", name: "alpha" },
  ];
  return {
    cwd: () => "C:/repo",
    parseSecretArgs: (args: string[]) => ({
      options: {
        class: args.includes("--class") ? args[args.indexOf("--class") + 1] : undefined,
        scopeType: args.includes("--scope-type") ? args[args.indexOf("--scope-type") + 1] : undefined,
        scopeId: args.includes("--scope-id") ? args[args.indexOf("--scope-id") + 1] : undefined,
        valueEnv: args.includes("--value-env") ? args[args.indexOf("--value-env") + 1] : undefined,
        purpose: args.includes("--purpose") ? args[args.indexOf("--purpose") + 1] : undefined,
        executionMode: args.includes("--execution-mode") ? args[args.indexOf("--execution-mode") + 1] : undefined,
        reveal: args.includes("--reveal"),
      },
      positionals: args.filter((arg) => !arg.startsWith("--") && !["model_api_key", "workspace", "local", "VALUE_ENV", "testing", "strict"].includes(arg)),
    }),
    secretValueFromOptions: async (options: { valueEnv?: string }) => {
      events.push(`value:${options.valueEnv ?? "-"}`);
      return "plain-value";
    },
    createPlatform: async () => ({
      secrets: {
        putSecret: async (input: { name: string; class: string; scopeType: string; scopeId: string; value: string }) => {
          events.push(`put:${input.name}:${input.class}:${input.scopeType}:${input.scopeId}:${input.value}`);
          return { id: "sec_new", class: input.class, scopeType: input.scopeType, scopeId: input.scopeId, name: input.name };
        },
        listSecrets: async () => refs,
        deleteSecret: async (id: string) => {
          events.push(`delete:${id}`);
          return id === "sec_alpha";
        },
      },
      secretBroker: {
        getSecret: async (input: { id: string; purpose: string; mode: string; metadata: { reveal: boolean } }) => {
          events.push(`get:${input.id}:${input.purpose}:${input.mode}:${input.metadata.reveal}`);
          return {
            value: "plain-value",
            leaseId: "lease_1",
            expiresAt: "2026-06-26T00:01:00.000Z",
            ref: refs[0],
          };
        },
        revokeLease: async (leaseId: string) => {
          events.push(`revoke:${leaseId}`);
        },
      },
      redactor: {
        registerKnownSecret: async (name: string, value: string) => {
          events.push(`redact:${name}:${value}`);
        },
      },
      store: {
        close: () => events.push("store-close"),
      },
    }),
    writeText: (text: string) => events.push(`text:${text}`),
    writeError: (message: string) => events.push(`error:${message}`),
    setExitCode: (code: number) => events.push(`exit:${code}`),
  };
}

test("createSecretsCommand lists secret refs and closes the store", async () => {
  const events: string[] = [];
  const command = createSecretsCommand(createSecretsDeps(events));

  const result = await command.execute({ command: "secrets", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "text:sec_alpha\tenvironment_secret\tworkspace:local\talpha",
    "store-close",
  ]);
});

test("createSecretsCommand stores a secret value and registers it for redaction", async () => {
  const events: string[] = [];
  const command = createSecretsCommand(createSecretsDeps(events));

  const result = await command.execute({
    command: "secrets",
    args: ["put", "model-key", "--class", "model_api_key", "--scope-type", "workspace", "--scope-id", "local", "--value-env", "VALUE_ENV"],
    context: undefined,
  });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "value:VALUE_ENV",
    "put:model-key:model_api_key:workspace:local:plain-value",
    "redact:model-key:plain-value",
    "text:sec_new\tmodel_api_key\tworkspace:local\tmodel-key",
    "store-close",
  ]);
});

test("createSecretsCommand prints leases without reveal and revokes them", async () => {
  const events: string[] = [];
  const command = createSecretsCommand(createSecretsDeps(events));

  const result = await command.execute({
    command: "secrets",
    args: ["get", "sec_alpha", "--purpose", "testing", "--execution-mode", "strict"],
    context: undefined,
  });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "get:sec_alpha:testing:strict:false",
    "text:sec_alpha\tenvironment_secret\tworkspace:local\talpha\tlease=lease_1\texpires=2026-06-26T00:01:00.000Z",
    "revoke:lease_1",
    "store-close",
  ]);
});

test("createSecretsCommand reveals only when requested and still revokes the lease", async () => {
  const events: string[] = [];
  const command = createSecretsCommand(createSecretsDeps(events));

  const result = await command.execute({ command: "secrets", args: ["get", "sec_alpha", "--reveal"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "get:sec_alpha:manual_cli_access:full_access:true",
    "text:plain-value",
    "revoke:lease_1",
    "store-close",
  ]);
});

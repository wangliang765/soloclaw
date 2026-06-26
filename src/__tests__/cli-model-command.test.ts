import assert from "node:assert/strict";
import test from "node:test";
import { createLegacyModelsCommand, createModelCommand, createProvidersCommand } from "../cli/commands/model.js";

type Profile = {
  id: string;
  provider: string;
  defaultBaseUrl?: string;
  apiKeyEnvNames: string[];
};

type Store = {
  filePath: string;
  profiles: Profile[];
  defaultProfile?: string;
  list(): Promise<Profile[]>;
  getDefaultProfile(): Promise<string | undefined>;
};

type ParsedArgs = {
  options: {
    json?: boolean;
    provider?: string;
    providerInput?: string;
    profileId?: string;
  };
  positionals: string[];
};

function createStore(): Store {
  return {
    filePath: "C:/home/.soloclaw/model-profiles.json",
    profiles: [{ id: "openai", provider: "openai", defaultBaseUrl: "https://api.openai.com/v1", apiKeyEnvNames: ["OPENAI_API_KEY"] }],
    defaultProfile: "openai",
    async list() {
      return this.profiles;
    },
    async getDefaultProfile() {
      return this.defaultProfile;
    },
  };
}

function createDeps(events: string[]) {
  const store = createStore();
  return {
    store,
    deps: {
      cwd: () => "C:/repo",
      resolveWorkspace: async (cwd: string, args: string[]) => {
        events.push(`resolve:${cwd}:${args.join(",")}`);
        return "C:/repo/project";
      },
      stripWorkspaceOption: (args: string[]) => args.filter((arg) => arg !== "--workspace" && arg !== "project"),
      createProfiles: () => store,
      parseProfileArgs: (args: string[]): ParsedArgs => ({
        options: {
          json: args.includes("--json"),
          provider: args.includes("openai") ? "openai" : undefined,
          providerInput: args.includes("openai") ? "openai" : undefined,
          profileId: args.includes("--profile") ? args[args.indexOf("--profile") + 1] : undefined,
        },
        positionals: args.filter((arg) => !arg.startsWith("--")),
      }),
      needsInteractiveSetupProvider: (parsed: ParsedArgs) => !parsed.options.provider && !parsed.options.providerInput && !parsed.positionals[0],
      hasSetupProviderDetails: (parsed: ParsedArgs) => Boolean(parsed.options.provider || parsed.options.providerInput || parsed.positionals[0] || parsed.options.profileId),
      inputIsTty: () => false,
      promptLine: async () => "",
      assignPromptedProvider: (parsed: ParsedArgs, providerInput: string) => {
        parsed.options.providerInput = providerInput;
        parsed.options.provider = providerInput;
      },
      setupProfile: async (_profiles: Store, parsed: ParsedArgs): Promise<Profile> => ({
        id: parsed.options.profileId ?? parsed.options.providerInput ?? "openai",
        provider: parsed.options.provider ?? "openai",
        defaultBaseUrl: "https://example.test/v1",
        apiKeyEnvNames: ["MODEL_API_KEY"],
      }),
      selectDefaultProfile: async (_profiles: Store, profileId: string) => ({
        defaultProfile: profileId,
        profile: { id: profileId, provider: "openai", defaultBaseUrl: "https://api.openai.com/v1", apiKeyEnvNames: ["OPENAI_API_KEY"] },
      }),
      buildEnv: async (workspace: string, args: string[]) => ({ json: args.includes("--json"), view: { workspace } }),
      renderEnv: (view: unknown) => events.push(`env:${JSON.stringify(view)}`),
      buildCheck: async (workspace: string, args: string[]) => ({ json: args.includes("--json"), view: { workspace, ready: false } }),
      renderCheck: (view: unknown) => events.push(`check:${JSON.stringify(view)}`),
      renderProfiles: (profiles: Profile[], defaultProfile: string | undefined) => events.push(`profiles:${profiles.length}:${defaultProfile}`),
      writeProfilesJson: (profiles: Profile[], defaultProfile: string | undefined, configPath: string) => events.push(`profiles-json:${profiles.length}:${defaultProfile}:${configPath}`),
      renderSelectedProfile: (selected: { defaultProfile: string; profile: Profile }, configPath: string) => {
        events.push(`selected:${selected.defaultProfile}:${selected.profile.provider}:${configPath}`);
      },
      renderSetupProfile: (profile: Profile, defaultProfile: string | undefined, configPath: string) => {
        events.push(`setup:${profile.id}:${defaultProfile}:${configPath}`);
      },
      renderHelp: (args: string[]) => events.push(`help:${args.join(",")}`),
      writeJson: (value: unknown) => events.push(`json:${JSON.stringify(value)}`),
      writeError: (message: string) => events.push(`error:${message}`),
      setExitCode: (code: number) => events.push(`exit:${code}`),
    },
  };
}

test("createModelCommand writes the stable model list json shape", async () => {
  const events: string[] = [];
  const { deps } = createDeps(events);
  const command = createModelCommand(deps);

  const result = await command.execute({ command: "model", args: ["list", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.equal(events[0], "resolve:C:/repo:list,--json");
  const jsonEvent = events.find((event) => event.startsWith("json:"));
  assert.ok(jsonEvent);
  assert.deepEqual(JSON.parse(jsonEvent.slice("json:".length)), {
    profiles: [{ id: "openai", provider: "openai", defaultBaseUrl: "https://api.openai.com/v1", apiKeyEnvNames: ["OPENAI_API_KEY"] }],
    providers: [{ id: "openai", provider: "openai", defaultBaseUrl: "https://api.openai.com/v1", apiKeyEnvNames: ["OPENAI_API_KEY"] }],
    defaultProfile: "openai",
    defaultProvider: "openai",
    configPath: "C:/home/.soloclaw/model-profiles.json",
  });
});

test("createModelCommand sets exit code when doctor json is not ready", async () => {
  const events: string[] = [];
  const { deps } = createDeps(events);
  const command = createModelCommand(deps);

  const result = await command.execute({ command: "model", args: ["doctor", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events.slice(-2), ['json:{"workspace":"C:/repo/project","ready":false}', "exit:1"]);
});

test("createModelCommand reports setup usage without provider details", async () => {
  const events: string[] = [];
  const { deps } = createDeps(events);
  const command = createModelCommand(deps);

  const result = await command.execute({ command: "model", args: ["setup"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events.slice(-2), [
    "error:Usage: soloclaw model setup <provider> [--profile id] [--protocol openai_chat|openai_responses|anthropic_messages|mock] [--base-url url] [--model name] [--api-key-env ENV|--api-key-secret secret-id] [--default]",
    "exit:1",
  ]);
});

test("createModelCommand renders help before resolving workspace", async () => {
  const events: string[] = [];
  const { deps } = createDeps(events);
  const command = createModelCommand(deps);

  const result = await command.execute({ command: "model", args: ["--help"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["help:model"]);
});

test("createProvidersCommand strips workspace args and renders provider profiles", async () => {
  const events: string[] = [];
  const { deps } = createDeps(events);
  const command = createProvidersCommand(deps);

  const result = await command.execute({ command: "providers", args: ["--workspace", "project", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["profiles-json:1:openai:C:/home/.soloclaw/model-profiles.json"]);
});

type LegacyProfile = {
  name: "openai" | "mock";
  source: "builtin" | "local";
  protocol: "openai_chat" | "mock";
  defaultBaseUrl?: string;
  defaultModel: string;
  apiKeyEnvNames: string[];
  apiKeySecretRef?: string;
};

type LegacyProfileInput = Omit<LegacyProfile, "source">;

type LegacyStore = {
  filePath: string;
  profiles: LegacyProfile[];
  defaultProvider?: "openai" | "mock";
  list(): Promise<LegacyProfile[]>;
  getDefaultProvider(): Promise<"openai" | "mock" | undefined>;
  setDefaultProvider(name: "openai" | "mock"): Promise<void>;
  set(profile: LegacyProfileInput): Promise<LegacyProfile>;
  remove(name: "openai" | "mock"): Promise<boolean>;
};

type UsageSummary = {
  entries: Array<{ provider: string; model: string; calls: number }>;
  totals: { calls: number };
};

type LegacyParsedArgs = {
  options: {
    json?: boolean;
    provider?: "openai" | "mock";
    providerInput?: string;
    protocol?: "openai_chat" | "mock";
    baseUrl?: string;
    model?: string;
    apiKeyEnvNames?: string[];
    clearApiKeyEnvNames?: boolean;
    apiKeySecretRef?: string;
    setDefault?: boolean;
  };
  positionals: string[];
};

function createLegacyStore(): LegacyStore {
  return {
    filePath: "C:/repo/.agent/model-providers.json",
    profiles: [
      {
        name: "openai",
        source: "builtin",
        protocol: "openai_chat",
        defaultBaseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-test",
        apiKeyEnvNames: ["OPENAI_API_KEY"],
      },
      {
        name: "mock",
        source: "builtin",
        protocol: "mock",
        defaultModel: "mock",
        apiKeyEnvNames: [],
      },
    ],
    defaultProvider: "openai",
    async list() {
      return this.profiles;
    },
    async getDefaultProvider() {
      return this.defaultProvider;
    },
    async setDefaultProvider(name) {
      this.defaultProvider = name;
    },
    async set(profile) {
      const view = { ...profile, source: "local" as const };
      this.profiles = this.profiles.map((candidate) => candidate.name === profile.name ? view : candidate);
      return view;
    },
    async remove(name) {
      const existing = this.profiles.find((candidate) => candidate.name === name && candidate.source === "local");
      if (!existing) {
        return false;
      }
      this.profiles = this.profiles.map((candidate) =>
        candidate.name === name
          ? {
              ...candidate,
              source: "builtin" as const,
            }
          : candidate,
      );
      return true;
    },
  };
}

function createLegacyDeps(events: string[]) {
  const store = createLegacyStore();
  const usagePlatform = {
    store: { label: "usage-store", close: () => events.push("usage-store-close") },
    locks: { close: () => events.push("usage-locks-close") },
  };
  return {
    store,
    deps: {
      cwd: () => "C:/repo",
      createProfiles: () => store,
      parseProfileArgs: (args: string[]): LegacyParsedArgs => ({
        options: {
          json: args.includes("--json"),
          provider: args.includes("openai") ? "openai" : args.includes("mock") ? "mock" : undefined,
          providerInput: args.includes("openai") ? "openai" : args.includes("mock") ? "mock" : undefined,
          protocol: args.includes("--protocol") ? args[args.indexOf("--protocol") + 1] as "openai_chat" | "mock" : undefined,
          baseUrl: args.includes("--base-url") ? args[args.indexOf("--base-url") + 1] : undefined,
          model: args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined,
          apiKeyEnvNames: args.includes("--api-key-env") ? [args[args.indexOf("--api-key-env") + 1]] : undefined,
          clearApiKeyEnvNames: args.includes("--clear-api-key-env"),
          setDefault: args.includes("--default") ? true : undefined,
        },
        positionals: args.filter((arg) => !arg.startsWith("--") && !["gpt-next", "https://example.test/v1", "MODEL_KEY"].includes(arg)),
      }),
      parseProviderName: (value: string) => {
        if (value === "openai" || value === "mock") {
          return value;
        }
        throw new Error(`Unknown model provider: ${value}.`);
      },
      inputIsTty: () => false,
      promptLine: async () => "",
      localAliasBaseUrl: () => undefined,
      resolveApiKeyEnvNames: (
        options: { apiKeyEnvNames?: string[]; clearApiKeyEnvNames?: boolean },
        _providerInput: string | undefined,
        currentEnvNames: string[],
      ) => options.clearApiKeyEnvNames ? [] : options.apiKeyEnvNames ?? currentEnvNames,
      parseUsageArgs: (args: string[]) => ({ options: { json: args.includes("--json") }, filters: { limit: 1000 } }),
      createUsagePlatform: async () => usagePlatform,
      summarizeUsage: async () => ({ entries: [{ provider: "openai", model: "gpt-test", calls: 2 }], totals: { calls: 2 } }),
      formatUsageEntry: (entry: { provider: string; model: string; calls: number }) => `${entry.provider}\t${entry.model}\tcalls=${entry.calls}`,
      formatUsageStats: (entry: { calls: number }) => `calls=${entry.calls}`,
      writeText: (text: string) => events.push(`text:${text}`),
      writeJson: (value: unknown) => events.push(`json:${JSON.stringify(value)}`),
      writeError: (message: string) => events.push(`error:${message}`),
      setExitCode: (code: number) => events.push(`exit:${code}`),
    },
  };
}

test("createLegacyModelsCommand writes legacy profile list json shape", async () => {
  const events: string[] = [];
  const { deps } = createLegacyDeps(events);
  const command = createLegacyModelsCommand(deps);

  const result = await command.execute({ command: "models", args: ["profiles", "list", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  const jsonEvent = events.find((event) => event.startsWith("json:"));
  assert.ok(jsonEvent);
  assert.deepEqual(JSON.parse(jsonEvent.slice("json:".length)), {
    profiles: createLegacyStore().profiles,
    defaultProvider: "openai",
    configPath: "C:/repo/.agent/model-providers.json",
  });
});

test("createLegacyModelsCommand setup updates a provider and makes it default unless disabled", async () => {
  const events: string[] = [];
  const { deps, store } = createLegacyDeps(events);
  const command = createLegacyModelsCommand(deps);

  const result = await command.execute({
    command: "models",
    args: ["setup", "openai", "--model", "gpt-next", "--base-url", "https://example.test/v1", "--api-key-env", "MODEL_KEY"],
    context: undefined,
  });

  assert.deepEqual(result, { matched: true });
  assert.equal(store.defaultProvider, "openai");
  assert.equal(store.profiles[0].source, "local");
  assert.equal(store.profiles[0].defaultModel, "gpt-next");
  assert.deepEqual(events, [
    "text:openai\tlocal\topenai_chat\tmodel=gpt-next\tbaseUrl=https://example.test/v1\tenv=MODEL_KEY\tsecret=-\tdefault=openai",
    "text:config=C:/repo/.agent/model-providers.json",
  ]);
});

test("createLegacyModelsCommand writes usage text and closes platform resources", async () => {
  const events: string[] = [];
  const { deps } = createLegacyDeps(events);
  const command = createLegacyModelsCommand(deps);

  const result = await command.execute({ command: "models", args: ["usage"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "text:openai\tgpt-test\tcalls=2",
    "text:total\t*\tcalls=2",
    "usage-locks-close",
    "usage-store-close",
  ]);
});

test("createLegacyModelsCommand reports unknown legacy model areas", async () => {
  const events: string[] = [];
  const { deps } = createLegacyDeps(events);
  const command = createLegacyModelsCommand(deps);

  const result = await command.execute({ command: "models", args: ["unknown"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Unknown models command: unknown", "exit:1"]);
});

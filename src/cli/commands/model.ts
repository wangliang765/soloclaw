import type { CommandModule } from "../command-router.js";

export type ModelProfileStore<TProfile> = {
  filePath: string;
  list(): Promise<TProfile[]>;
  getDefaultProfile(): Promise<string | undefined>;
};

export type ParsedModelProfileArgs = {
  options: {
    json?: boolean;
    provider?: unknown;
    providerInput?: string;
    profileId?: string;
  };
  positionals: string[];
};

export type SelectedModelProfile<TProfile> = {
  defaultProfile: string;
  profile: TProfile;
};

export type ModelCommandDeps<
  TProfile,
  TEnvView,
  TCheckView,
  TParsed extends ParsedModelProfileArgs,
  TStore extends ModelProfileStore<TProfile>,
> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  stripWorkspaceOption(args: string[]): string[];
  createProfiles(): TStore;
  parseProfileArgs(args: string[]): TParsed;
  needsInteractiveSetupProvider(parsed: TParsed): boolean;
  hasSetupProviderDetails(parsed: TParsed): boolean;
  inputIsTty(): boolean;
  promptLine(prompt: string): Promise<string>;
  assignPromptedProvider(parsed: TParsed, providerInput: string): void;
  setupProfile(profiles: TStore, parsed: TParsed): Promise<TProfile>;
  selectDefaultProfile(profiles: TStore, profileId: string): Promise<SelectedModelProfile<TProfile>>;
  buildEnv(workspace: string, args: string[]): Promise<{ json: boolean; view: TEnvView }>;
  renderEnv(view: TEnvView): void;
  buildCheck(workspace: string, args: string[]): Promise<{ json: boolean; view: TCheckView & { ready?: boolean } }>;
  renderCheck(view: TCheckView & { ready?: boolean }): void;
  renderProfiles(profiles: TProfile[], defaultProfile: string | undefined): void;
  writeProfilesJson(profiles: TProfile[], defaultProfile: string | undefined, configPath: string): void;
  renderSelectedProfile(selected: SelectedModelProfile<TProfile>, configPath: string): void;
  renderSetupProfile(profile: TProfile, defaultProfile: string | undefined, configPath: string): void;
  renderHelp(args: string[]): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createModelCommand<
  TProfile,
  TEnvView,
  TCheckView,
  TParsed extends ParsedModelProfileArgs,
  TStore extends ModelProfileStore<TProfile>,
>(deps: ModelCommandDeps<TProfile, TEnvView, TCheckView, TParsed, TStore>): CommandModule<void> {
  return {
    name: "model",
    summary: "Configure and inspect model profiles",
    execute: async ({ args }) => {
      try {
        if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
          deps.renderHelp(["model"]);
          return { matched: true };
        }

        const workspace = await deps.resolveWorkspace(deps.cwd(), args);
        const commandArgs = deps.stripWorkspaceOption(args);
        const subcommand = commandArgs[0] ?? "list";
        const profiles = deps.createProfiles();

        if (subcommand === "list" || subcommand === "ls") {
          const parsed = deps.parseProfileArgs(commandArgs.slice(1));
          const listed = await profiles.list();
          const defaultProfile = await profiles.getDefaultProfile();
          if (parsed.options.json) {
            deps.writeJson({
              profiles: listed,
              providers: listed,
              defaultProfile,
              defaultProvider: defaultProfile,
              configPath: profiles.filePath,
            });
          } else {
            deps.renderProfiles(listed, defaultProfile);
          }
          return { matched: true };
        }

        if (subcommand === "providers" || subcommand === "presets") {
          const parsed = deps.parseProfileArgs(commandArgs.slice(1));
          const listed = await profiles.list();
          const defaultProfile = await profiles.getDefaultProfile();
          if (parsed.options.json) {
            deps.writeProfilesJson(listed, defaultProfile, profiles.filePath);
          } else {
            deps.renderProfiles(listed, defaultProfile);
          }
          return { matched: true };
        }

        if (subcommand === "env") {
          const result = await deps.buildEnv(workspace, commandArgs.slice(1));
          if (result.json) {
            deps.writeJson(result.view);
          } else {
            deps.renderEnv(result.view);
          }
          return { matched: true };
        }

        if (subcommand === "check" || subcommand === "doctor") {
          const result = await deps.buildCheck(workspace, commandArgs.slice(1));
          if (result.json) {
            deps.writeJson(result.view);
          } else {
            deps.renderCheck(result.view);
          }
          if (!result.view.ready) {
            deps.setExitCode(1);
          }
          return { matched: true };
        }

        if (subcommand === "use" || subcommand === "default") {
          const profileId = commandArgs[1];
          if (!profileId) {
            deps.writeError("Usage: soloclaw model use <profile-id>");
            deps.setExitCode(1);
            return { matched: true };
          }
          deps.renderSelectedProfile(await deps.selectDefaultProfile(profiles, profileId), profiles.filePath);
          return { matched: true };
        }

        if (subcommand === "setup") {
          const parsed = deps.parseProfileArgs(commandArgs.slice(1));
          if (deps.needsInteractiveSetupProvider(parsed) && deps.inputIsTty()) {
            const promptedProvider = (await deps.promptLine("Provider [openai_compatible]: ")) || "openai_compatible";
            deps.assignPromptedProvider(parsed, promptedProvider);
          }
          if (!deps.hasSetupProviderDetails(parsed)) {
            deps.writeError(
              "Usage: soloclaw model setup <provider> [--profile id] [--protocol openai_chat|openai_responses|anthropic_messages|mock] [--base-url url] [--model name] [--api-key-env ENV|--api-key-secret secret-id] [--default]",
            );
            deps.setExitCode(1);
            return { matched: true };
          }
          const profile = await deps.setupProfile(profiles, parsed);
          deps.renderSetupProfile(profile, await profiles.getDefaultProfile(), profiles.filePath);
          return { matched: true };
        }

        if (commandArgs.length > 1) {
          deps.writeError("Usage: soloclaw model <profile-id>");
          deps.setExitCode(1);
          return { matched: true };
        }

        deps.renderSelectedProfile(await deps.selectDefaultProfile(profiles, subcommand), profiles.filePath);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

export type ProvidersCommandDeps<
  TProfile,
  TParsed extends ParsedModelProfileArgs,
  TStore extends ModelProfileStore<TProfile>,
> = {
  stripWorkspaceOption(args: string[]): string[];
  createProfiles(): TStore;
  parseProfileArgs(args: string[]): TParsed;
  renderProfiles(profiles: TProfile[], defaultProfile: string | undefined): void;
  writeProfilesJson(profiles: TProfile[], defaultProfile: string | undefined, configPath: string): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createProvidersCommand<
  TProfile,
  TParsed extends ParsedModelProfileArgs,
  TStore extends ModelProfileStore<TProfile>,
>(deps: ProvidersCommandDeps<TProfile, TParsed, TStore>): CommandModule<void> {
  return {
    name: "providers",
    summary: "List global model provider profiles",
    execute: async ({ args }) => {
      try {
        const commandArgs = deps.stripWorkspaceOption(args);
        const profiles = deps.createProfiles();
        const parsed = deps.parseProfileArgs(commandArgs);
        const listed = await profiles.list();
        const defaultProfile = await profiles.getDefaultProfile();
        if (parsed.options.json) {
          deps.writeProfilesJson(listed, defaultProfile, profiles.filePath);
        } else {
          deps.renderProfiles(listed, defaultProfile);
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

export type LegacyModelProfileView<TProviderName extends string, TProtocol extends string> = {
  name: TProviderName;
  source: string;
  protocol: TProtocol;
  defaultBaseUrl?: string;
  defaultModel: string;
  apiKeyEnvNames: string[];
  apiKeySecretRef?: string;
};

export type LegacyEditableModelProfile<TProviderName extends string, TProtocol extends string> = {
  name: TProviderName;
  protocol: TProtocol;
  defaultBaseUrl?: string;
  defaultModel: string;
  apiKeyEnvNames: string[];
  apiKeySecretRef?: string;
};

export type LegacyModelProfileArgs<TProviderName extends string, TProtocol extends string> = {
  options: {
    json?: boolean;
    provider?: TProviderName;
    providerInput?: string;
    protocol?: TProtocol;
    baseUrl?: string;
    model?: string;
    apiKeyEnvNames?: string[];
    clearApiKeyEnvNames?: boolean;
    apiKeySecretRef?: string;
    setDefault?: boolean;
  };
  positionals: string[];
};

export type LegacyModelProfileStore<
  TProviderName extends string,
  TProtocol extends string,
  TProfile extends LegacyModelProfileView<TProviderName, TProtocol>,
> = {
  filePath: string;
  list(): Promise<TProfile[]>;
  getDefaultProvider(): Promise<TProviderName | undefined>;
  setDefaultProvider(name: TProviderName): Promise<void>;
  set(profile: LegacyEditableModelProfile<TProviderName, TProtocol>): Promise<TProfile>;
  remove(name: TProviderName): Promise<boolean>;
};

export type LegacyModelsClosable = {
  close(): void;
};

export type LegacyModelsCommandDeps<
  TProviderName extends string,
  TProtocol extends string,
  TProfile extends LegacyModelProfileView<TProviderName, TProtocol>,
  TParsed extends LegacyModelProfileArgs<TProviderName, TProtocol>,
  TStore extends LegacyModelProfileStore<TProviderName, TProtocol, TProfile>,
  TUsageParsed,
  TUsageStore extends LegacyModelsClosable,
  TUsageEntry,
  TUsageTotals,
  TUsageSummary extends { entries: TUsageEntry[]; totals: TUsageTotals },
> = {
  cwd(): string;
  createProfiles(cwd: string): TStore;
  parseProfileArgs(args: string[]): TParsed;
  parseProviderName(value: string): TProviderName;
  inputIsTty(): boolean;
  promptLine(prompt: string): Promise<string>;
  localAliasBaseUrl(providerInput: string | undefined): string | undefined;
  resolveApiKeyEnvNames(options: TParsed["options"], providerInput: string | undefined, currentEnvNames: string[]): string[];
  parseUsageArgs(args: string[]): TUsageParsed;
  createUsagePlatform(cwd: string): Promise<{ store: TUsageStore; locks: LegacyModelsClosable }>;
  summarizeUsage(store: TUsageStore, parsed: TUsageParsed): Promise<TUsageSummary>;
  formatUsageEntry(entry: TUsageEntry): string;
  formatUsageStats(entry: TUsageTotals): string;
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createLegacyModelsCommand<
  TProviderName extends string,
  TProtocol extends string,
  TProfile extends LegacyModelProfileView<TProviderName, TProtocol>,
  TParsed extends LegacyModelProfileArgs<TProviderName, TProtocol>,
  TStore extends LegacyModelProfileStore<TProviderName, TProtocol, TProfile>,
  TUsageParsed,
  TUsageStore extends LegacyModelsClosable,
  TUsageEntry,
  TUsageTotals,
  TUsageSummary extends { entries: TUsageEntry[]; totals: TUsageTotals },
>(
  deps: LegacyModelsCommandDeps<
    TProviderName,
    TProtocol,
    TProfile,
    TParsed,
    TStore,
    TUsageParsed,
    TUsageStore,
    TUsageEntry,
    TUsageTotals,
    TUsageSummary
  >,
): CommandModule<void> {
  return {
    name: "models",
    summary: "Manage legacy workspace model provider profiles",
    execute: async ({ args }) => {
      const area = args[0] ?? "profiles";
      try {
        if (area === "usage") {
          await runLegacyModelUsage(deps, args.slice(1));
          return { matched: true };
        }

        if (area === "setup") {
          await runLegacyModelSetup(deps, args.slice(1));
          return { matched: true };
        }

        if (area !== "profiles") {
          deps.writeError(`Unknown models command: ${area}`);
          deps.setExitCode(1);
          return { matched: true };
        }

        await runLegacyModelProfiles(deps, args.slice(1));
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

async function runLegacyModelUsage<
  TProviderName extends string,
  TProtocol extends string,
  TProfile extends LegacyModelProfileView<TProviderName, TProtocol>,
  TParsed extends LegacyModelProfileArgs<TProviderName, TProtocol>,
  TStore extends LegacyModelProfileStore<TProviderName, TProtocol, TProfile>,
  TUsageParsed,
  TUsageStore extends LegacyModelsClosable,
  TUsageEntry,
  TUsageTotals,
  TUsageSummary extends { entries: TUsageEntry[]; totals: TUsageTotals },
>(
  deps: LegacyModelsCommandDeps<TProviderName, TProtocol, TProfile, TParsed, TStore, TUsageParsed, TUsageStore, TUsageEntry, TUsageTotals, TUsageSummary>,
  args: string[],
): Promise<void> {
  const parsed = deps.parseUsageArgs(args);
  const { store, locks } = await deps.createUsagePlatform(deps.cwd());
  try {
    const summary = await deps.summarizeUsage(store, parsed);
    if (isJsonUsage(parsed)) {
      deps.writeJson(summary);
      return;
    }
    for (const entry of summary.entries) {
      deps.writeText(deps.formatUsageEntry(entry));
    }
    deps.writeText(`total\t*\t${deps.formatUsageStats(summary.totals)}`);
  } finally {
    locks.close();
    store.close();
  }
}

async function runLegacyModelSetup<
  TProviderName extends string,
  TProtocol extends string,
  TProfile extends LegacyModelProfileView<TProviderName, TProtocol>,
  TParsed extends LegacyModelProfileArgs<TProviderName, TProtocol>,
  TStore extends LegacyModelProfileStore<TProviderName, TProtocol, TProfile>,
  TUsageParsed,
  TUsageStore extends LegacyModelsClosable,
  TUsageEntry,
  TUsageTotals,
  TUsageSummary extends { entries: TUsageEntry[]; totals: TUsageTotals },
>(
  deps: LegacyModelsCommandDeps<TProviderName, TProtocol, TProfile, TParsed, TStore, TUsageParsed, TUsageStore, TUsageEntry, TUsageTotals, TUsageSummary>,
  args: string[],
): Promise<void> {
  const parsed = deps.parseProfileArgs(args);
  const providerInput = parsed.options.providerInput ?? parsed.positionals[0];
  let providerName = parsed.options.provider ?? (providerInput ? deps.parseProviderName(providerInput) : undefined);
  if (!providerName && deps.inputIsTty()) {
    const promptedProvider = (await deps.promptLine("Provider [openai]: ")) || "openai";
    parsed.options.providerInput = promptedProvider;
    providerName = deps.parseProviderName(promptedProvider);
  }
  if (!providerName) {
    deps.writeError("Usage: soloclaw models setup --provider <provider> [--base-url url] [--model model] [--api-key-env ENV|--api-key-secret secret-id] [--default]");
    deps.setExitCode(1);
    return;
  }

  const profiles = deps.createProfiles(deps.cwd());
  const current = (await profiles.list()).find((profile) => profile.name === providerName);
  if (!current) {
    throw new Error(`Unknown model provider: ${providerName}`);
  }
  const profile = await profiles.set({
    name: providerName,
    protocol: parsed.options.protocol ?? current.protocol,
    defaultBaseUrl: parsed.options.baseUrl ?? deps.localAliasBaseUrl(parsed.options.providerInput ?? providerInput) ?? current.defaultBaseUrl,
    defaultModel: parsed.options.model ?? current.defaultModel,
    apiKeyEnvNames: deps.resolveApiKeyEnvNames(parsed.options, parsed.options.providerInput ?? providerInput, current.apiKeyEnvNames),
    apiKeySecretRef: parsed.options.apiKeySecretRef ?? current.apiKeySecretRef,
  });
  if (parsed.options.setDefault || parsed.options.setDefault === undefined) {
    await profiles.setDefaultProvider(providerName);
  }
  const defaultProvider = await profiles.getDefaultProvider();
  deps.writeText(formatLegacyModelProfileLine(profile, defaultProvider, "value"));
  deps.writeText(`config=${profiles.filePath}`);
}

async function runLegacyModelProfiles<
  TProviderName extends string,
  TProtocol extends string,
  TProfile extends LegacyModelProfileView<TProviderName, TProtocol>,
  TParsed extends LegacyModelProfileArgs<TProviderName, TProtocol>,
  TStore extends LegacyModelProfileStore<TProviderName, TProtocol, TProfile>,
  TUsageParsed,
  TUsageStore extends LegacyModelsClosable,
  TUsageEntry,
  TUsageTotals,
  TUsageSummary extends { entries: TUsageEntry[]; totals: TUsageTotals },
>(
  deps: LegacyModelsCommandDeps<TProviderName, TProtocol, TProfile, TParsed, TStore, TUsageParsed, TUsageStore, TUsageEntry, TUsageTotals, TUsageSummary>,
  args: string[],
): Promise<void> {
  const subcommand = args[0] ?? "list";
  const parsed = deps.parseProfileArgs(args.slice(1));
  const profiles = deps.createProfiles(deps.cwd());

  if (subcommand === "list") {
    const listed = await profiles.list();
    const defaultProvider = await profiles.getDefaultProvider();
    if (parsed.options.json) {
      deps.writeJson({ profiles: listed, defaultProvider, configPath: profiles.filePath });
    } else {
      for (const profile of listed) {
        deps.writeText(formatLegacyModelProfileLine(profile, defaultProvider));
      }
    }
    return;
  }

  if (subcommand === "set") {
    const providerInput = parsed.positionals[0];
    if (!providerInput) {
      deps.writeError("Usage: agent models profiles set <provider> [--protocol openai_chat|openai_responses|anthropic_messages|mock] [--base-url url] [--model model] [--api-key-env ENV|--api-key-secret secret-id]");
      deps.setExitCode(1);
      return;
    }
    const name = deps.parseProviderName(providerInput);
    const current = (await profiles.list()).find((profile) => profile.name === name);
    if (!current) {
      throw new Error(`Unknown model provider: ${name}`);
    }
    const profile = await profiles.set({
      name,
      protocol: parsed.options.protocol ?? current.protocol,
      defaultBaseUrl: parsed.options.baseUrl ?? current.defaultBaseUrl,
      defaultModel: parsed.options.model ?? current.defaultModel,
      apiKeyEnvNames: parsed.options.clearApiKeyEnvNames ? [] : parsed.options.apiKeyEnvNames ?? current.apiKeyEnvNames,
      apiKeySecretRef: parsed.options.apiKeySecretRef ?? current.apiKeySecretRef,
    });
    if (parsed.options.setDefault) {
      await profiles.setDefaultProvider(name);
    }
    deps.writeText(formatLegacyModelProfileLine(profile));
    return;
  }

  if (subcommand === "remove" || subcommand === "delete") {
    const providerInput = parsed.positionals[0];
    if (!providerInput) {
      deps.writeError("Usage: agent models profiles remove <provider>");
      deps.setExitCode(1);
      return;
    }
    const removed = await profiles.remove(deps.parseProviderName(providerInput));
    deps.writeText(removed ? `removed\t${providerInput}` : `not-found\t${providerInput}`);
    return;
  }

  deps.writeError(`Unknown models profiles command: ${subcommand}`);
  deps.setExitCode(1);
}

function formatLegacyModelProfileLine<TProviderName extends string, TProtocol extends string>(
  profile: LegacyModelProfileView<TProviderName, TProtocol>,
  defaultProvider?: TProviderName,
  defaultMode: "marker" | "value" = "marker",
): string {
  const defaultText = defaultMode === "value"
    ? `\tdefault=${defaultProvider ?? "-"}`
    : profile.name === defaultProvider
      ? "\tdefault"
      : "";
  return `${profile.name}\t${profile.source}\t${profile.protocol}\tmodel=${profile.defaultModel}\tbaseUrl=${profile.defaultBaseUrl ?? "-"}\tenv=${profile.apiKeyEnvNames.join(",") || "-"}\tsecret=${profile.apiKeySecretRef ? "configured" : "-"}${defaultText}`;
}

function isJsonUsage(parsed: unknown): boolean {
  return typeof parsed === "object" && parsed !== null && "options" in parsed && Boolean((parsed as { options?: { json?: boolean } }).options?.json);
}

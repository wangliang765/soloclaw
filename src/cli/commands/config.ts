import type { CommandModule } from "../command-router.js";

export type ConfigProfileStore<TProfile> = {
  filePath: string;
  list(): Promise<TProfile[]>;
  getDefaultProfile(): Promise<string | undefined>;
  usesLegacyConfig(): Promise<boolean>;
};

export type ConfigCommandDeps<TProfile, TCapabilities extends { platform?: unknown; paths?: unknown }, TStore extends ConfigProfileStore<TProfile>> = {
  stripWorkspaceOption(args: string[]): string[];
  createProfiles(): TStore;
  detectCapabilities(): Promise<TCapabilities>;
  now(): Date;
  renderProfiles(profiles: TProfile[], defaultProfile: string | undefined): void;
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createConfigCommand<
  TProfile,
  TCapabilities extends { platform?: unknown; paths?: unknown },
  TStore extends ConfigProfileStore<TProfile>,
>(deps: ConfigCommandDeps<TProfile, TCapabilities, TStore>): CommandModule<void> {
  return {
    name: "config",
    summary: "Show Soloclaw configuration",
    execute: async ({ args }) => {
      try {
        const commandArgs = deps.stripWorkspaceOption(args);
        const subcommand = commandArgs[0] ?? "show";
        const profiles = deps.createProfiles();

        if (subcommand === "path") {
          if (commandArgs.slice(1).includes("--json")) {
            const capabilities = await deps.detectCapabilities();
            deps.writeJson({
              generatedAt: deps.now().toISOString(),
              configPath: profiles.filePath,
              legacyConfig: await profiles.usesLegacyConfig(),
              platform: capabilities.platform,
              paths: capabilities.paths,
              capabilities,
            });
          } else {
            deps.writeText(profiles.filePath);
          }
          return { matched: true };
        }

        if (subcommand === "show") {
          const json = commandArgs.slice(1).includes("--json");
          const listed = await profiles.list();
          const defaultProfile = await profiles.getDefaultProfile();
          const capabilities = json ? await deps.detectCapabilities() : undefined;
          const view = {
            defaultProfile,
            defaultProvider: defaultProfile,
            configPath: profiles.filePath,
            legacyConfig: await profiles.usesLegacyConfig(),
            profiles: listed,
            providers: listed,
            platform: capabilities?.platform,
            paths: capabilities?.paths,
            capabilities,
          };
          if (json) {
            deps.writeJson(view);
          } else {
            deps.writeText(`config=${profiles.filePath}`);
            deps.writeText(`default=${defaultProfile ?? "-"}`);
            deps.renderProfiles(listed, defaultProfile);
          }
          return { matched: true };
        }

        deps.writeError(`Unknown config command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

export type SecretsParsedArgs<TSecretClass extends string, TScopeType extends string, TExecutionMode extends string> = {
  options: {
    class?: TSecretClass;
    scopeType?: TScopeType;
    scopeId?: string;
    valueEnv?: string;
    valueFile?: string;
    purpose?: string;
    executionMode?: TExecutionMode;
    reveal?: boolean;
  };
  positionals: string[];
};

export type SecretCommandRef = {
  id: string;
  class: string;
  scopeType: string;
  scopeId: string;
  name: string;
};

export type SecretCommandLease<TRef extends SecretCommandRef> = {
  ref: TRef;
  value: string;
  leaseId: string;
  expiresAt: string;
};

export type SecretsCommandPlatform<
  TSecretClass extends string,
  TScopeType extends string,
  TExecutionMode extends string,
  TRef extends SecretCommandRef,
> = {
  secrets: {
    putSecret(input: { name: string; class: TSecretClass; scopeType: TScopeType; scopeId: string; value: string }): Promise<TRef>;
    listSecrets?(): Promise<TRef[]>;
    deleteSecret?(id: string): Promise<boolean>;
  };
  secretBroker: {
    getSecret(input: {
      id: string;
      purpose: string;
      actor: { type: "user"; id: string; displayName: string };
      mode: TExecutionMode;
      scope: Record<string, never>;
      metadata: { consumer: "cli.secrets.get"; reveal: boolean };
    }): Promise<SecretCommandLease<TRef>>;
    revokeLease(leaseId: string): Promise<void>;
  };
  redactor: {
    registerKnownSecret(name: string, value: string): Promise<void>;
  };
  store: {
    close(): void;
  };
};

export type SecretsCommandDeps<
  TSecretClass extends string,
  TScopeType extends string,
  TExecutionMode extends string,
  TParsed extends SecretsParsedArgs<TSecretClass, TScopeType, TExecutionMode>,
  TRef extends SecretCommandRef,
  TPlatform extends SecretsCommandPlatform<TSecretClass, TScopeType, TExecutionMode, TRef>,
> = {
  cwd(): string;
  parseSecretArgs(args: string[]): TParsed;
  secretValueFromOptions(options: TParsed["options"]): Promise<string>;
  createPlatform(cwd: string): Promise<TPlatform>;
  writeText(text: string): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createSecretsCommand<
  TSecretClass extends string,
  TScopeType extends string,
  TExecutionMode extends string,
  TParsed extends SecretsParsedArgs<TSecretClass, TScopeType, TExecutionMode>,
  TRef extends SecretCommandRef,
  TPlatform extends SecretsCommandPlatform<TSecretClass, TScopeType, TExecutionMode, TRef>,
>(deps: SecretsCommandDeps<TSecretClass, TScopeType, TExecutionMode, TParsed, TRef, TPlatform>): CommandModule<void> {
  return {
    name: "secrets",
    summary: "Manage local secret refs",
    execute: async ({ args }) => {
      const subcommand = args[0] ?? "list";
      const commandArgs = args.slice(1);
      const platform = await deps.createPlatform(deps.cwd());
      try {
        if (subcommand === "put") {
          await putSecret(deps, platform, commandArgs);
          return { matched: true };
        }
        if (subcommand === "get") {
          await getSecret(deps, platform, commandArgs);
          return { matched: true };
        }
        if (subcommand === "delete") {
          const id = commandArgs[0];
          if (!id) {
            deps.writeError("Usage: agent secrets delete <secret-id>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const deleted = platform.secrets.deleteSecret ? await platform.secrets.deleteSecret(id) : false;
          deps.writeText(deleted ? "deleted" : "not found");
          return { matched: true };
        }
        if (subcommand === "list") {
          const refs = platform.secrets.listSecrets ? await platform.secrets.listSecrets() : [];
          for (const ref of refs) {
            deps.writeText(formatSecretRef(ref));
          }
          return { matched: true };
        }
        deps.writeError(`Unknown secrets command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform.store.close();
      }
      return { matched: true };
    },
  };
}

async function putSecret<
  TSecretClass extends string,
  TScopeType extends string,
  TExecutionMode extends string,
  TParsed extends SecretsParsedArgs<TSecretClass, TScopeType, TExecutionMode>,
  TRef extends SecretCommandRef,
  TPlatform extends SecretsCommandPlatform<TSecretClass, TScopeType, TExecutionMode, TRef>,
>(
  deps: SecretsCommandDeps<TSecretClass, TScopeType, TExecutionMode, TParsed, TRef, TPlatform>,
  platform: TPlatform,
  args: string[],
): Promise<void> {
  const parsed = deps.parseSecretArgs(args);
  const name = parsed.positionals[0];
  if (!name) {
    deps.writeError("Usage: agent secrets put <name> --class model_api_key --scope-type workspace --scope-id local --value-env ENV_NAME");
    deps.setExitCode(1);
    return;
  }
  const value = await deps.secretValueFromOptions(parsed.options);
  const ref = await platform.secrets.putSecret({
    name,
    class: parsed.options.class ?? ("environment_secret" as TSecretClass),
    scopeType: parsed.options.scopeType ?? ("workspace" as TScopeType),
    scopeId: parsed.options.scopeId ?? "local",
    value,
  });
  await platform.redactor.registerKnownSecret(ref.name, value);
  deps.writeText(formatSecretRef(ref));
}

async function getSecret<
  TSecretClass extends string,
  TScopeType extends string,
  TExecutionMode extends string,
  TParsed extends SecretsParsedArgs<TSecretClass, TScopeType, TExecutionMode>,
  TRef extends SecretCommandRef,
  TPlatform extends SecretsCommandPlatform<TSecretClass, TScopeType, TExecutionMode, TRef>,
>(
  deps: SecretsCommandDeps<TSecretClass, TScopeType, TExecutionMode, TParsed, TRef, TPlatform>,
  platform: TPlatform,
  args: string[],
): Promise<void> {
  const parsed = deps.parseSecretArgs(args);
  const id = parsed.positionals[0];
  if (!id) {
    deps.writeError("Usage: agent secrets get <secret-id> [--purpose text] [--reveal] [--execution-mode strict|balanced|trusted|full_access]");
    deps.setExitCode(1);
    return;
  }
  const lease = await platform.secretBroker.getSecret({
    id,
    purpose: parsed.options.purpose ?? "manual_cli_access",
    actor: { type: "user", id: "local-user", displayName: "Local User" },
    mode: parsed.options.executionMode ?? ("full_access" as TExecutionMode),
    scope: {},
    metadata: {
      consumer: "cli.secrets.get",
      reveal: Boolean(parsed.options.reveal),
    },
  });
  try {
    if (parsed.options.reveal) {
      deps.writeText(lease.value);
    } else {
      deps.writeText(`${formatSecretRef(lease.ref)}\tlease=${lease.leaseId}\texpires=${lease.expiresAt}`);
    }
  } finally {
    await platform.secretBroker.revokeLease(lease.leaseId);
  }
}

function formatSecretRef(ref: SecretCommandRef): string {
  return `${ref.id}\t${ref.class}\t${ref.scopeType}:${ref.scopeId}\t${ref.name}`;
}

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModelProviderName } from "./model-client.js";
import { MODEL_PROVIDER_PROFILES } from "./provider-profiles.js";
import type { ModelProviderProfile } from "./provider-profiles.js";

export type EditableModelProviderProfile = Omit<ModelProviderProfile, "name"> & {
  name: ModelProviderName;
};

export type StoredModelProviderProfiles = {
  version: 1;
  defaultProvider?: ModelProviderName;
  profiles: Partial<Record<ModelProviderName, EditableModelProviderProfile>>;
};

export type ModelProviderProfileView = ModelProviderProfile & {
  source: "builtin" | "local";
};

const PROFILE_FILE_NAME = "model-providers.json";

export class LocalProviderProfileStore {
  constructor(private readonly agentDir: string) {}

  get filePath(): string {
    return path.join(this.agentDir, PROFILE_FILE_NAME);
  }

  async list(): Promise<ModelProviderProfileView[]> {
    const stored = await this.read();
    return Object.values(MODEL_PROVIDER_PROFILES).map((builtin) => {
      const override = stored.profiles[builtin.name];
      return {
        ...builtin,
        ...override,
        name: builtin.name,
        source: override ? "local" : "builtin",
      };
    });
  }

  async resolve(): Promise<Record<ModelProviderName, ModelProviderProfile>> {
    const profiles = await this.list();
    return Object.fromEntries(profiles.map((profile) => [profile.name, stripSource(profile)])) as Record<ModelProviderName, ModelProviderProfile>;
  }

  async getDefaultProvider(): Promise<ModelProviderName | undefined> {
    const stored = await this.read();
    return stored.defaultProvider;
  }

  async setDefaultProvider(name: ModelProviderName): Promise<void> {
    parseModelProviderName(name);
    const stored = await this.read();
    stored.defaultProvider = name;
    await this.write(stored);
  }

  async set(profile: EditableModelProviderProfile): Promise<ModelProviderProfileView> {
    validateEditableProfile(profile);
    const stored = await this.read();
    stored.profiles[profile.name] = profile;
    await this.write(stored);
    return { ...profile, source: "local" };
  }

  async remove(name: ModelProviderName): Promise<boolean> {
    const stored = await this.read();
    if (!stored.profiles[name]) {
      return false;
    }
    delete stored.profiles[name];
    await this.write(stored);
    return true;
  }

  async read(): Promise<StoredModelProviderProfiles> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return parseStoredProfiles(parsed);
    } catch (error) {
      if (isNotFound(error)) {
        return { version: 1, profiles: {} };
      }
      throw error;
    }
  }

  private async write(stored: StoredModelProviderProfiles): Promise<void> {
    await fs.mkdir(this.agentDir, { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(stored, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

export async function resolveLocalProviderProfiles(cwd: string): Promise<Record<ModelProviderName, ModelProviderProfile>> {
  return new LocalProviderProfileStore(path.join(cwd, ".agent")).resolve();
}

export async function resolveLocalDefaultProvider(cwd: string): Promise<ModelProviderName | undefined> {
  return new LocalProviderProfileStore(path.join(cwd, ".agent")).getDefaultProvider();
}

function parseStoredProfiles(input: unknown): StoredModelProviderProfiles {
  if (!isRecord(input) || input.version !== 1 || !isRecord(input.profiles)) {
    throw new Error("Invalid model provider profile file.");
  }
  const defaultProvider = typeof input.defaultProvider === "string" ? parseModelProviderName(input.defaultProvider) : undefined;
  const profiles: Partial<Record<ModelProviderName, EditableModelProviderProfile>> = {};
  for (const [name, value] of Object.entries(input.profiles)) {
    const providerName = parseModelProviderName(name);
    if (!isRecord(value)) {
      throw new Error(`Invalid model provider profile for ${name}.`);
    }
    const profile = {
      name: providerName,
      protocol: parseProtocol(value.protocol),
      defaultBaseUrl: typeof value.defaultBaseUrl === "string" ? value.defaultBaseUrl : undefined,
      defaultModel: parseNonEmptyString(value.defaultModel, `defaultModel for ${name}`),
      apiKeyEnvNames: parseEnvNames(value.apiKeyEnvNames, name),
      apiKeySecretRef: parseOptionalSecretRef(value.apiKeySecretRef, name),
    };
    validateEditableProfile(profile);
    profiles[providerName] = profile;
  }
  return { version: 1, defaultProvider, profiles };
}

function validateEditableProfile(profile: EditableModelProviderProfile): void {
  parseModelProviderName(profile.name);
  parseProtocol(profile.protocol);
  parseNonEmptyString(profile.defaultModel, `defaultModel for ${profile.name}`);
  parseEnvNames(profile.apiKeyEnvNames, profile.name);
  parseOptionalSecretRef(profile.apiKeySecretRef, profile.name);
  if (profile.protocol !== "mock" && !profile.defaultBaseUrl) {
    throw new Error(`Model provider ${profile.name} requires defaultBaseUrl.`);
  }
  if (profile.defaultBaseUrl && !isValidHttpUrl(profile.defaultBaseUrl)) {
    throw new Error(`Model provider ${profile.name} defaultBaseUrl must be an http(s) URL.`);
  }
  if (profile.protocol === "mock" && profile.name !== "mock") {
    throw new Error("Only the mock provider can use mock protocol.");
  }
}

function stripSource(profile: ModelProviderProfileView): ModelProviderProfile {
  const { source: _source, ...rest } = profile;
  return rest;
}

function parseModelProviderName(value: string): ModelProviderName {
  if (value in MODEL_PROVIDER_PROFILES) {
    return value as ModelProviderName;
  }
  throw new Error(`Unknown model provider: ${value}.`);
}

function parseProtocol(value: unknown): ModelProviderProfile["protocol"] {
  if (value === "openai_chat" || value === "anthropic_messages" || value === "mock") {
    return value;
  }
  throw new Error(`Invalid model provider protocol: ${String(value)}.`);
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  throw new Error(`Invalid ${label}.`);
}

function parseEnvNames(value: unknown, providerName: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && /^[A-Z_][A-Z0-9_]*$/.test(entry))) {
    throw new Error(`Invalid apiKeyEnvNames for ${providerName}.`);
  }
  return value;
}

function parseOptionalSecretRef(value: unknown, providerName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && /^sec_[A-Za-z0-9_-]+$/.test(value)) {
    return value;
  }
  throw new Error(`Invalid apiKeySecretRef for ${providerName}.`);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

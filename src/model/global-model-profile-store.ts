import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, promises as fs, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ModelProviderName } from "./model-client.js";
import { MODEL_PROVIDER_PROFILES } from "./provider-profiles.js";
import type { ModelProviderProfile } from "./provider-profiles.js";
import { resolveSoloclawPaths } from "../platform/soloclaw-platform.js";

export type GlobalModelProfileSource = "builtin" | "global";

export type EditableGlobalModelProfile = {
  id: string;
  provider: ModelProviderName;
  displayName?: string;
  protocol: ModelProviderProfile["protocol"];
  defaultBaseUrl?: string;
  defaultModel: string;
  apiKeyEnvNames: string[];
  apiKeySecretRef?: string;
  modelIds?: string[];
  docsUrl?: string;
  apiKeysUrl?: string;
  pricingUrl?: string;
};

export type GlobalModelProfileView = EditableGlobalModelProfile & {
  name: ModelProviderName;
  source: GlobalModelProfileSource;
};

export type StoredGlobalModelProfiles = {
  version: 1;
  defaultProfile?: string;
  defaultProvider?: string;
  profiles: Record<string, EditableGlobalModelProfile>;
};

const PROFILE_FILE_NAME = "model-providers.json";

export function soloclawHome(): string {
  return resolveSoloclawPaths().configDir;
}

export function globalSecretVaultPath(home = soloclawHome()): string {
  return path.join(home, "secrets.vault.json");
}

export function globalSecretVaultPassphraseFile(home = soloclawHome()): string {
  return path.join(home, "secrets.key");
}

export function ensureGlobalSecretVaultPassphraseFile(home = soloclawHome()): string {
  const passphraseFile = globalSecretVaultPassphraseFile(home);
  if (!existsSync(passphraseFile)) {
    mkdirSync(path.dirname(passphraseFile), { recursive: true, mode: 0o700 });
    writeFileSync(passphraseFile, `${randomBytes(32).toString("base64url")}\n`, { mode: 0o600 });
  }
  const passphrase = readFileSync(passphraseFile, "utf8").trim();
  if (passphrase.length < 12) {
    throw new Error(`Invalid global secret vault key file: ${passphraseFile}`);
  }
  return passphraseFile;
}

export class GlobalModelProfileStore {
  private readonly homeDir: string;
  private readonly legacyHomeDir?: string;

  constructor(homeDir?: string, legacyHomeDir?: string) {
    const paths = resolveSoloclawPaths();
    this.homeDir = homeDir ?? paths.configDir;
    this.legacyHomeDir = legacyHomeDir ?? (homeDir ? undefined : paths.legacyHomeDir);
  }

  get filePath(): string {
    return path.join(this.homeDir, PROFILE_FILE_NAME);
  }

  get home(): string {
    return this.homeDir;
  }

  get legacyFilePath(): string | undefined {
    return this.legacyHomeDir ? path.join(this.legacyHomeDir, PROFILE_FILE_NAME) : undefined;
  }

  async usesLegacyConfig(): Promise<boolean> {
    return Boolean(this.legacyFilePath && !(await pathExists(this.filePath)) && await pathExists(this.legacyFilePath));
  }

  async list(): Promise<GlobalModelProfileView[]> {
    const stored = await this.read();
    const globalProfiles = Object.values(stored.profiles).map((profile) => toView(profile, "global"));
    const globalIds = new Set(globalProfiles.map((profile) => profile.id));
    const builtins = Object.values(MODEL_PROVIDER_PROFILES)
      .filter((profile) => !globalIds.has(profile.name))
      .map((profile) => toView({
        id: profile.name,
        provider: profile.name,
        displayName: profile.displayName,
        protocol: profile.protocol,
        defaultBaseUrl: profile.defaultBaseUrl,
        defaultModel: profile.defaultModel,
        apiKeyEnvNames: profile.apiKeyEnvNames,
        apiKeySecretRef: profile.apiKeySecretRef,
        modelIds: profile.modelIds,
        docsUrl: profile.docsUrl,
        apiKeysUrl: profile.apiKeysUrl,
        pricingUrl: profile.pricingUrl,
      }, "builtin"));
    return [...builtins, ...globalProfiles.sort((left, right) => left.id.localeCompare(right.id))];
  }

  async resolveProfile(id?: string): Promise<GlobalModelProfileView> {
    const target = id ?? await this.getDefaultProfile() ?? "mock";
    const profile = (await this.list()).find((entry) => entry.id === target);
    if (!profile) {
      throw new Error(`Unknown model profile: ${target}.`);
    }
    return profile;
  }

  async getDefaultProfile(): Promise<string | undefined> {
    const stored = await this.read();
    return stored.defaultProfile;
  }

  async setDefaultProfile(id: string): Promise<void> {
    validateProfileId(id);
    const stored = await this.read();
    const known = Object.hasOwn(stored.profiles, id) || Object.hasOwn(MODEL_PROVIDER_PROFILES, id);
    if (!known) {
      throw new Error(`Unknown model profile: ${id}.`);
    }
    stored.defaultProfile = id;
    await this.write(stored);
  }

  async set(profile: EditableGlobalModelProfile): Promise<GlobalModelProfileView> {
    validateEditableProfile(profile);
    const stored = await this.read();
    stored.profiles[profile.id] = profile;
    await this.write(stored);
    return toView(profile, "global");
  }

  async remove(id: string): Promise<boolean> {
    const stored = await this.read();
    if (!stored.profiles[id]) {
      return false;
    }
    delete stored.profiles[id];
    if (stored.defaultProfile === id) {
      delete stored.defaultProfile;
    }
    await this.write(stored);
    return true;
  }

  async read(): Promise<StoredGlobalModelProfiles> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return parseStoredProfiles(JSON.parse(raw) as unknown);
    } catch (error) {
      if (isNotFound(error)) {
        const legacy = this.legacyFilePath;
        if (legacy && await pathExists(legacy)) {
          const raw = await fs.readFile(legacy, "utf8");
          return parseStoredProfiles(JSON.parse(raw) as unknown);
        }
        return { version: 1, profiles: {} };
      }
      throw error;
    }
  }

  private async write(stored: StoredGlobalModelProfiles): Promise<void> {
    await fs.mkdir(this.homeDir, { recursive: true });
    const persisted = {
      ...stored,
      defaultProvider: stored.defaultProfile,
    };
    await fs.writeFile(this.filePath, `${JSON.stringify(persisted, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

export function globalProfileToProviderProfile(profile: GlobalModelProfileView): ModelProviderProfile {
  return {
    name: profile.provider,
    displayName: profile.displayName,
    protocol: profile.protocol,
    defaultBaseUrl: profile.defaultBaseUrl,
    defaultModel: profile.defaultModel,
    apiKeyEnvNames: profile.apiKeyEnvNames,
    apiKeySecretRef: profile.apiKeySecretRef,
    modelIds: profile.modelIds,
    docsUrl: profile.docsUrl,
    apiKeysUrl: profile.apiKeysUrl,
    pricingUrl: profile.pricingUrl,
  };
}

function parseStoredProfiles(input: unknown): StoredGlobalModelProfiles {
  if (!isRecord(input) || input.version !== 1 || !isRecord(input.profiles)) {
    throw new Error("Invalid global model profile file.");
  }
  const profiles: Record<string, EditableGlobalModelProfile> = {};
  for (const [id, value] of Object.entries(input.profiles)) {
    if (!isRecord(value)) {
      throw new Error(`Invalid global model profile for ${id}.`);
    }
    const profile: EditableGlobalModelProfile = {
      id: parseProfileId(typeof value.id === "string" ? value.id : id),
      provider: parseModelProviderName(value.provider ?? id),
      displayName: parseOptionalString(value.displayName),
      protocol: parseProtocol(value.protocol),
      defaultBaseUrl: parseOptionalString(value.defaultBaseUrl),
      defaultModel: parseNonEmptyString(value.defaultModel, `defaultModel for ${id}`),
      apiKeyEnvNames: parseEnvNames(value.apiKeyEnvNames, id),
      apiKeySecretRef: parseOptionalSecretRef(value.apiKeySecretRef, id),
      modelIds: parseOptionalStringArray(value.modelIds, `modelIds for ${id}`),
      docsUrl: parseOptionalString(value.docsUrl),
      apiKeysUrl: parseOptionalString(value.apiKeysUrl),
      pricingUrl: parseOptionalString(value.pricingUrl),
    };
    if (profile.id !== id) {
      throw new Error(`Global model profile key ${id} does not match profile id ${profile.id}.`);
    }
    validateEditableProfile(profile);
    profiles[id] = profile;
  }
  const defaultProfileValue = typeof input.defaultProfile === "string"
    ? input.defaultProfile
    : typeof input.defaultProvider === "string"
      ? input.defaultProvider
      : undefined;
  const defaultProfile = defaultProfileValue ? parseProfileId(defaultProfileValue) : undefined;
  return { version: 1, defaultProfile, defaultProvider: defaultProfile, profiles };
}

function validateEditableProfile(profile: EditableGlobalModelProfile): void {
  validateProfileId(profile.id);
  parseModelProviderName(profile.provider);
  parseProtocol(profile.protocol);
  parseNonEmptyString(profile.defaultModel, `defaultModel for ${profile.id}`);
  parseEnvNames(profile.apiKeyEnvNames, profile.id);
  parseOptionalSecretRef(profile.apiKeySecretRef, profile.id);
  if (profile.protocol !== "mock" && !profile.defaultBaseUrl) {
    throw new Error(`Model profile ${profile.id} requires defaultBaseUrl.`);
  }
  if (profile.defaultBaseUrl && !isValidHttpUrl(profile.defaultBaseUrl)) {
    throw new Error(`Model profile ${profile.id} defaultBaseUrl must be an http(s) URL.`);
  }
  if (profile.protocol === "mock" && profile.provider !== "mock") {
    throw new Error("Only the mock provider can use mock protocol.");
  }
}

function toView(profile: EditableGlobalModelProfile, source: GlobalModelProfileSource): GlobalModelProfileView {
  return {
    ...profile,
    name: profile.provider,
    source,
  };
}

function validateProfileId(value: string): void {
  parseProfileId(value);
}

function parseProfileId(value: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value)) {
    return value;
  }
  throw new Error(`Invalid model profile id: ${value}.`);
}

function parseModelProviderName(value: unknown): ModelProviderName {
  if (typeof value === "string" && value in MODEL_PROVIDER_PROFILES) {
    return value as ModelProviderName;
  }
  throw new Error(`Unknown model provider: ${String(value)}.`);
}

function parseProtocol(value: unknown): ModelProviderProfile["protocol"] {
  if (value === "openai_chat" || value === "openai_responses" || value === "anthropic_messages" || value === "mock") {
    return value;
  }
  throw new Error(`Invalid model profile protocol: ${String(value)}.`);
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  throw new Error(`Invalid ${label}.`);
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`Invalid string value: ${String(value)}.`);
}

function parseEnvNames(value: unknown, profileId: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && /^[A-Z_][A-Z0-9_]*$/.test(entry))) {
    throw new Error(`Invalid apiKeyEnvNames for ${profileId}.`);
  }
  return value;
}

function parseOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim().length > 0)) {
    return value;
  }
  throw new Error(`Invalid ${label}.`);
}

function parseOptionalSecretRef(value: unknown, profileId: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && /^sec_[A-Za-z0-9_-]+$/.test(value)) {
    return value;
  }
  throw new Error(`Invalid apiKeySecretRef for ${profileId}.`);
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

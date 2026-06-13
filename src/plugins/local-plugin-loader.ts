import { promises as fs } from "node:fs";
import path from "node:path";
import type { LoadedPlugin, PluginCommandManifest, PluginManifest } from "./plugin-types.js";

export class LocalPluginLoader {
  constructor(private readonly rootDir: string) {}

  async listPlugins(): Promise<LoadedPlugin[]> {
    if (!(await exists(this.rootDir))) {
      return [];
    }
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
    const plugins: LoadedPlugin[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const manifestPath = path.join(this.rootDir, entry.name, "plugin.json");
      if (await exists(manifestPath)) {
        plugins.push(await this.loadPlugin(path.dirname(manifestPath)));
      }
    }
    return plugins.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
  }

  async loadPlugin(pluginDir: string): Promise<LoadedPlugin> {
    const rootDir = path.resolve(pluginDir);
    const manifestPath = path.join(rootDir, "plugin.json");
    const raw = JSON.parse(await fs.readFile(manifestPath, "utf8")) as unknown;
    const manifest = validateManifest(raw, manifestPath);
    return {
      id: manifest.name,
      rootDir,
      manifestPath,
      manifest,
    };
  }

  async findTool(toolName: string): Promise<{ plugin: LoadedPlugin; command: PluginCommandManifest } | undefined> {
    for (const plugin of await this.listPlugins()) {
      for (const command of plugin.manifest.commands ?? []) {
        if (pluginToolName(plugin.manifest.name, command.name) === toolName) {
          return { plugin, command };
        }
      }
    }
    return undefined;
  }
}

export function pluginToolName(pluginName: string, commandName: string): string {
  return `plugin.${pluginName}.${commandName}`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function validateManifest(raw: unknown, manifestPath: string): PluginManifest {
  if (!isObject(raw)) {
    throw new Error(`Invalid plugin manifest at ${manifestPath}: expected object.`);
  }
  const name = stringField(raw, "name", manifestPath);
  const version = stringField(raw, "version", manifestPath);
  const permissions = stringArrayField(raw, "permissions", manifestPath) ?? [];
  const tools = stringArrayField(raw, "tools", manifestPath) ?? [];
  const commands = commandArrayField(raw, manifestPath) ?? [];
  return {
    name,
    version,
    description: optionalStringField(raw, "description", manifestPath),
    permissions,
    tools,
    commands,
  };
}

function commandArrayField(raw: Record<string, unknown>, manifestPath: string): PluginCommandManifest[] | undefined {
  const value = raw.commands;
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid plugin manifest at ${manifestPath}: commands must be an array.`);
  }
  return value.map((item, index) => {
    if (!isObject(item)) {
      throw new Error(`Invalid plugin manifest at ${manifestPath}: commands[${index}] must be an object.`);
    }
    return {
      name: stringField(item, "name", manifestPath),
      description: optionalStringField(item, "description", manifestPath),
      command: stringField(item, "command", manifestPath),
      args: stringArrayField(item, "args", manifestPath) ?? [],
      cwd: optionalStringField(item, "cwd", manifestPath),
      timeoutMs: optionalNumberField(item, "timeoutMs", manifestPath),
      risk: optionalRiskField(item, manifestPath),
    };
  });
}

function stringField(raw: Record<string, unknown>, key: string, manifestPath: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid plugin manifest at ${manifestPath}: ${key} must be a non-empty string.`);
  }
  return value;
}

function optionalStringField(raw: Record<string, unknown>, key: string, manifestPath: string): string | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid plugin manifest at ${manifestPath}: ${key} must be a string.`);
  }
  return value;
}

function optionalNumberField(raw: Record<string, unknown>, key: string, manifestPath: string): number | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid plugin manifest at ${manifestPath}: ${key} must be a finite number.`);
  }
  return value;
}

function optionalRiskField(raw: Record<string, unknown>, manifestPath: string): PluginCommandManifest["risk"] | undefined {
  const value = optionalStringField(raw, "risk", manifestPath);
  if (value === undefined) {
    return undefined;
  }
  if (value !== "low" && value !== "medium" && value !== "high" && value !== "critical") {
    throw new Error(`Invalid plugin manifest at ${manifestPath}: risk must be low, medium, high, or critical.`);
  }
  return value;
}

function stringArrayField(raw: Record<string, unknown>, key: string, manifestPath: string): string[] | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid plugin manifest at ${manifestPath}: ${key} must be an array of strings.`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

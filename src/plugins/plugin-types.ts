import type { TaskRisk } from "../domain/index.js";

export type PluginCommandManifest = {
  name: string;
  description?: string;
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  risk?: TaskRisk;
};

export type PluginManifest = {
  name: string;
  version: string;
  description?: string;
  permissions?: string[];
  tools?: string[];
  commands?: PluginCommandManifest[];
};

export type LoadedPlugin = {
  id: string;
  rootDir: string;
  manifestPath: string;
  manifest: PluginManifest;
};

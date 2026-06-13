import { promises as fs } from "node:fs";
import path from "node:path";
import type { McpCapability, McpServerRegistration, McpTransport, TaskRisk } from "../domain/index.js";

export type RegisterMcpServerInput = {
  id: string;
  name?: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  envVarNames?: string[];
  capabilities?: McpCapability[];
  enabled?: boolean;
  risk?: TaskRisk;
  requireApproval?: boolean;
  allowedProjects?: string[];
  allowedRooms?: string[];
};

export type StoredMcpRegistry = {
  version: 1;
  servers: Record<string, McpServerRegistration>;
};

const REGISTRY_FILE_NAME = "mcp-servers.json";

export class LocalMcpRegistry {
  constructor(private readonly agentDir: string) {}

  get filePath(): string {
    return path.join(this.agentDir, REGISTRY_FILE_NAME);
  }

  async list(): Promise<McpServerRegistration[]> {
    const stored = await this.read();
    return Object.values(stored.servers).sort((left, right) => left.id.localeCompare(right.id));
  }

  async get(id: string): Promise<McpServerRegistration | undefined> {
    const stored = await this.read();
    return stored.servers[id];
  }

  async register(input: RegisterMcpServerInput): Promise<McpServerRegistration> {
    const stored = await this.read();
    const now = new Date().toISOString();
    const existing = stored.servers[input.id];
    const registration = parseRegistration({
      id: input.id,
      name: input.name ?? existing?.name ?? input.id,
      transport: input.transport,
      command: input.command,
      args: input.args ?? [],
      url: input.url,
      envVarNames: input.envVarNames ?? [],
      capabilities: input.capabilities ?? [],
      policy: {
        enabled: input.enabled ?? existing?.policy.enabled ?? true,
        risk: input.risk ?? existing?.policy.risk ?? "medium",
        requireApproval: input.requireApproval ?? existing?.policy.requireApproval ?? true,
        allowedProjects: input.allowedProjects,
        allowedRooms: input.allowedRooms,
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    stored.servers[registration.id] = registration;
    await this.write(stored);
    return registration;
  }

  async remove(id: string): Promise<boolean> {
    const stored = await this.read();
    if (!stored.servers[id]) {
      return false;
    }
    delete stored.servers[id];
    await this.write(stored);
    return true;
  }

  async read(): Promise<StoredMcpRegistry> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return parseStoredRegistry(JSON.parse(raw) as unknown);
    } catch (error) {
      if (isNotFound(error)) {
        return { version: 1, servers: {} };
      }
      throw error;
    }
  }

  private async write(stored: StoredMcpRegistry): Promise<void> {
    await fs.mkdir(this.agentDir, { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(stored, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

export function parseMcpCapabilities(values: string[] = []): McpCapability[] {
  const capabilities = values.map((value) => parseMcpCapability(value));
  return [...new Set(capabilities)];
}

function parseStoredRegistry(input: unknown): StoredMcpRegistry {
  if (!isRecord(input) || input.version !== 1 || !isRecord(input.servers)) {
    throw new Error("Invalid MCP registry file.");
  }
  const servers: Record<string, McpServerRegistration> = {};
  for (const [id, value] of Object.entries(input.servers)) {
    if (!isRecord(value)) {
      throw new Error(`Invalid MCP server registration: ${id}.`);
    }
    servers[id] = parseRegistration(value);
  }
  return { version: 1, servers };
}

function parseRegistration(input: Record<string, unknown>): McpServerRegistration {
  const id = parseId(input.id);
  const transport = parseTransport(input.transport);
  const registration: McpServerRegistration = {
    id,
    name: parseNonEmptyString(input.name, `name for ${id}`),
    transport,
    command: optionalString(input.command),
    args: parseStringArray(input.args, `args for ${id}`),
    url: optionalString(input.url),
    envVarNames: parseEnvVarNames(input.envVarNames, id),
    capabilities: parseCapabilities(input.capabilities, id),
    policy: parsePolicy(input.policy, id),
    createdAt: parseNonEmptyString(input.createdAt, `createdAt for ${id}`),
    updatedAt: parseNonEmptyString(input.updatedAt, `updatedAt for ${id}`),
  };
  validateRegistration(registration);
  return registration;
}

function parsePolicy(value: unknown, id: string): McpServerRegistration["policy"] {
  if (!isRecord(value)) {
    throw new Error(`Invalid MCP policy for ${id}.`);
  }
  return {
    enabled: value.enabled === true,
    risk: parseRisk(value.risk, id),
    requireApproval: value.requireApproval !== false,
    allowedProjects: parseOptionalStringArray(value.allowedProjects, `allowedProjects for ${id}`),
    allowedRooms: parseOptionalStringArray(value.allowedRooms, `allowedRooms for ${id}`),
  };
}

function validateRegistration(registration: McpServerRegistration): void {
  if (registration.transport === "stdio") {
    if (!registration.command) {
      throw new Error(`MCP server ${registration.id} requires command for stdio transport.`);
    }
    if (registration.url) {
      throw new Error(`MCP server ${registration.id} cannot set url for stdio transport.`);
    }
  }
  if (registration.transport === "http") {
    if (!registration.url || !isValidHttpUrl(registration.url)) {
      throw new Error(`MCP server ${registration.id} requires an http(s) url for http transport.`);
    }
    if (registration.command) {
      throw new Error(`MCP server ${registration.id} cannot set command for http transport.`);
    }
  }
}

function parseCapabilities(value: unknown, id: string): McpCapability[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid capabilities for MCP server ${id}.`);
  }
  return parseMcpCapabilities(value.map((entry) => {
    if (typeof entry !== "string") {
      throw new Error(`Invalid capability for MCP server ${id}.`);
    }
    return entry;
  }));
}

function parseMcpCapability(value: string): McpCapability {
  if (value === "tools" || value === "resources" || value === "prompts" || value === "sampling") {
    return value;
  }
  throw new Error(`Invalid MCP capability: ${value}.`);
}

function parseRisk(value: unknown, id: string): TaskRisk {
  if (value === "low" || value === "medium" || value === "high" || value === "critical") {
    return value;
  }
  throw new Error(`Invalid MCP risk for ${id}.`);
}

function parseTransport(value: unknown): McpTransport {
  if (value === "stdio" || value === "http") {
    return value;
  }
  throw new Error(`Invalid MCP transport: ${String(value)}.`);
}

function parseId(value: unknown): string {
  if (typeof value === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(value)) {
    return value;
  }
  throw new Error("Invalid MCP server id.");
}

function parseEnvVarNames(value: unknown, id: string): string[] {
  const names = parseStringArray(value, `envVarNames for ${id}`);
  for (const name of names) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid MCP env var name for ${id}: ${name}.`);
    }
  }
  return [...new Set(names)];
}

function parseStringArray(value: unknown, label: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function parseOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseStringArray(value, label);
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  throw new Error(`Invalid ${label}.`);
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  throw new Error("Expected a non-empty string.");
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

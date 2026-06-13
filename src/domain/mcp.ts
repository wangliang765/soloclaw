import type { TaskRisk } from "./policy.js";
import type { Timestamp } from "./common.js";

export type McpServerId = string;
export type McpTransport = "stdio" | "http";
export type McpCapability = "tools" | "resources" | "prompts" | "sampling";

export type McpServerPolicy = {
  enabled: boolean;
  risk: TaskRisk;
  requireApproval: boolean;
  allowedProjects?: string[];
  allowedRooms?: string[];
};

export type McpServerRegistration = {
  id: McpServerId;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  envVarNames: string[];
  capabilities: McpCapability[];
  policy: McpServerPolicy;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

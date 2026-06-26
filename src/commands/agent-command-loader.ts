import { promises as fs } from "node:fs";
import path from "node:path";
import { parseAgentWorkProfile, type AgentWorkProfileName } from "../core/agent-work-profile.js";

export type AgentCommand = {
  name: string;
  description?: string;
  agentProfile?: AgentWorkProfileName;
  model?: string;
  subtask?: boolean;
  template: string;
  sourcePath: string;
};

export class AgentCommandLoader {
  async loadDirectory(directory: string): Promise<AgentCommand[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    const commands = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => this.loadFile(path.join(directory, entry.name))));
    return commands
      .filter((command): command is AgentCommand => command !== undefined)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async loadFile(filePath: string): Promise<AgentCommand | undefined> {
    const raw = await fs.readFile(filePath, "utf8").catch(() => "");
    if (!raw.trim()) {
      return undefined;
    }
    const parsed = parseFrontmatter(raw);
    return {
      name: path.basename(filePath, ".md"),
      description: parsed.data.description,
      agentProfile: parsed.data.agentProfile ? parseAgentWorkProfile(parsed.data.agentProfile) : undefined,
      model: parsed.data.model,
      subtask: parsed.data.subtask === "true",
      template: parsed.body.trim(),
      sourcePath: filePath,
    };
  }
}

function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { data: {}, body: raw };
  }
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    return { data: {}, body: raw };
  }
  const header = normalized.slice(4, end).trim();
  const body = normalized.slice(end + 4).replace(/^\n/, "");
  const data = Object.fromEntries(header.split("\n")
    .map((line) => line.split(":"))
    .filter((parts) => parts.length >= 2)
    .map(([key, ...value]) => [key.trim(), value.join(":").trim()]));
  return { data, body };
}

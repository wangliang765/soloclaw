import { promises as fs } from "node:fs";
import path from "node:path";
import { assertWorkspacePathAllowed } from "../hygiene/execution-hygiene.js";

export type AgentCommandServiceOptions = {
  workspaceRoot: string;
};

export type ExpandCommandInput = {
  template: string;
  argumentsText: string;
};

export class AgentCommandService {
  constructor(private readonly options: AgentCommandServiceOptions) {}

  async expand(input: ExpandCommandInput): Promise<string> {
    if (/!`[^`]+`/.test(input.template)) {
      throw new Error("Shell interpolation is not enabled for local agent commands.");
    }
    const args = splitArguments(input.argumentsText);
    const withArguments = input.template
      .replace(/\$ARGUMENTS/g, input.argumentsText)
      .replace(/\$(\d+)/g, (_match, index) => args[Number(index) - 1] ?? "");
    return this.expandFileReferences(withArguments);
  }

  private async expandFileReferences(template: string): Promise<string> {
    const refs = [...template.matchAll(/@([A-Za-z0-9_./\\-]+)/g)].map((match) => match[1]);
    let expanded = template;
    for (const ref of refs) {
      const normalized = ref.replace(/\\/g, "/");
      const root = path.resolve(this.options.workspaceRoot);
      const absolute = path.resolve(root, normalized);
      if (!isInsideOrEqual(absolute, root)) {
        throw new Error(`File reference escapes workspace: ${ref}`);
      }
      assertWorkspacePathAllowed(normalized, "read");
      const content = await fs.readFile(absolute, "utf8");
      expanded = expanded.replace(`@${ref}`, [`File: ${normalized}`, "```", content.trim(), "```"].join("\n"));
    }
    return expanded;
  }
}

function splitArguments(value: string): string[] {
  return value.trim() ? value.trim().split(/\s+/) : [];
}

function isInsideOrEqual(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

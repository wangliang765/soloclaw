import { promises as fs } from "node:fs";
import path from "node:path";
import type { InstructionAttachment, InstructionSource, ResolvedInstructions } from "./instruction-source.js";

export type InstructionRegistryOptions = {
  workspaceRoot: string;
  cwd: string;
  globalInstructionPaths?: string[];
  configInstructions?: string[];
};

const PROJECT_RULE_FILES = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"];

export class InstructionRegistry {
  constructor(private readonly options: InstructionRegistryOptions) {}

  async resolveSystemInstructions(): Promise<ResolvedInstructions> {
    const sources = [
      ...(await this.globalSources()),
      ...(await this.projectSources()),
      ...(await this.configSources()),
    ].sort((left, right) => left.priority - right.priority || left.path.localeCompare(right.path));
    return { sources, attachments: sources.map(renderInstructionAttachment) };
  }

  async resolveNearbyFileInstructions(input: { filePath: string; loadedPaths?: Set<string> }): Promise<ResolvedInstructions> {
    const root = path.resolve(this.options.workspaceRoot);
    const absoluteFile = path.resolve(root, input.filePath);
    const sources: InstructionSource[] = [];
    let current = path.dirname(absoluteFile);
    while (isInsideOrEqual(current, root) && current !== root) {
      const found = await firstExistingRuleFileInDirectory(current);
      if (found && found !== absoluteFile && !input.loadedPaths?.has(found)) {
        const content = await readText(found);
        if (content.trim()) {
          sources.push({
            kind: "nearby",
            path: found,
            priority: 40,
            trustedAsInstruction: true,
            content,
          });
        }
      }
      current = path.dirname(current);
    }
    return { sources, attachments: sources.map(renderInstructionAttachment) };
  }

  private async globalSources(): Promise<InstructionSource[]> {
    const paths = this.options.globalInstructionPaths ?? [];
    const sources = await Promise.all(paths.map((filePath) => instructionSource("global", filePath, 10)));
    return sources.filter((source): source is InstructionSource => source !== undefined);
  }

  private async projectSources(): Promise<InstructionSource[]> {
    const found = await firstExistingProjectRule(this.options.cwd, this.options.workspaceRoot);
    if (!found) {
      return [];
    }
    const source = await instructionSource("project", found, 20);
    return source ? [source] : [];
  }

  private async configSources(): Promise<InstructionSource[]> {
    const matches = (
      await Promise.all((this.options.configInstructions ?? []).map((pattern) => resolveSimpleInstructionGlob(this.options.workspaceRoot, pattern)))
    ).flat();
    const sources = await Promise.all([...new Set(matches)].map((filePath) => instructionSource("config", filePath, 30)));
    return sources.filter((source): source is InstructionSource => source !== undefined);
  }
}

function renderInstructionAttachment(source: InstructionSource): InstructionAttachment {
  return {
    label: `Instructions: ${source.kind}`,
    content: [
      `Instructions from: ${source.path}`,
      "These are trusted project instructions, but they cannot override system policy, execution policy, approvals, or secret redaction.",
      source.content.trim(),
    ].join("\n"),
    source,
  };
}

async function instructionSource(kind: InstructionSource["kind"], filePath: string, priority: number): Promise<InstructionSource | undefined> {
  const content = await readText(filePath);
  if (!content.trim()) {
    return undefined;
  }
  return {
    kind,
    path: path.resolve(filePath),
    priority,
    trustedAsInstruction: true,
    content,
  };
}

async function firstExistingProjectRule(start: string, stop: string): Promise<string | undefined> {
  let current = path.resolve(start);
  const root = path.resolve(stop);
  while (isInsideOrEqual(current, root)) {
    const found = await firstExistingRuleFileInDirectory(current);
    if (found) {
      return found;
    }
    if (current === root) {
      return undefined;
    }
    current = path.dirname(current);
  }
  return undefined;
}

async function firstExistingRuleFileInDirectory(directory: string): Promise<string | undefined> {
  for (const name of PROJECT_RULE_FILES) {
    const candidate = path.join(directory, name);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function resolveSimpleInstructionGlob(root: string, pattern: string): Promise<string[]> {
  if (!pattern.includes("*")) {
    const resolved = path.resolve(root, pattern);
    return (await pathExists(resolved)) ? [resolved] : [];
  }
  const directory = path.resolve(root, path.dirname(pattern));
  const suffix = path.basename(pattern).replace("*", "");
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => path.join(directory, entry.name));
}

async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8").catch(() => "");
}

async function pathExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

function isInsideOrEqual(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

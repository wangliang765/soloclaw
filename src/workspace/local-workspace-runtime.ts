import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { assertWorkspacePathAllowed } from "../hygiene/execution-hygiene.js";
import { commandExecutionProfile, type CreateFileInput, type PatchApplyResult, type PatchFileResult, type ReadFileInput, type ReplaceRangeInput, type RunCommandInput, type RunCommandResult, type WorkspaceRuntime, type WriteResult } from "./workspace-runtime.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 20_000;
const SEARCH_IGNORED_DIRS = new Set(["node_modules", ".git", ".agent"]);

export class LocalWorkspaceRuntime implements WorkspaceRuntime {
  constructor(private readonly root: string) {}

  async listFiles(inputPath: string): Promise<string[]> {
    assertWorkspacePathAllowed(inputPath, "read");
    const absolute = this.resolveInsideWorkspace(inputPath);
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    return entries
      .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== ".agent")
      .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${path.relative(this.root, path.join(absolute, entry.name)) || "."}`);
  }

  async readFile(input: ReadFileInput): Promise<string> {
    assertWorkspacePathAllowed(input.path, "read");
    const absolute = this.resolveInsideWorkspace(input.path);
    const content = await fs.readFile(absolute, "utf8");
    const lines = content.split(/\r?\n/);
    const start = Math.max((input.startLine ?? 1) - 1, 0);
    const end = input.endLine ? Math.min(input.endLine, lines.length) : lines.length;
    return lines.slice(start, end).map((line, index) => `${start + index + 1}: ${line}`).join("\n");
  }

  async searchText(query: string, glob?: string): Promise<string> {
    const args = ["--line-number", "--hidden", "--glob", "!node_modules", "--glob", "!.git", "--glob", "!.agent"];
    if (glob) {
      args.push("--glob", glob);
    }
    args.push(query, this.root);

    try {
      const result = await execFileAsync("rg", args, {
        cwd: this.root,
        maxBuffer: MAX_OUTPUT,
      });
      return truncate(result.stdout);
    } catch (error) {
      const maybe = error as { stdout?: string; stderr?: string; code?: number };
      if (maybe.code === 1) {
        return "";
      }
      const fallback = await searchTextFallback(this.root, query, glob);
      return fallback || truncate(`${maybe.stdout ?? ""}${maybe.stderr ?? ""}`);
    }
  }

  async runCommand(input: RunCommandInput): Promise<RunCommandResult> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const executionProfile = commandExecutionProfile(input.executionProfile);
      const child = spawn(input.command, {
        cwd: this.root,
        shell: true,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let exitCode: number | null = null;
      let settled = false;
      const timeoutMs = input.timeoutMs ?? 30_000;
      let exitGraceTimer: ReturnType<typeof setTimeout> | undefined;

      const scheduleFinish = (delayMs: number) => {
        if (exitGraceTimer) {
          clearTimeout(exitGraceTimer);
        }
        exitGraceTimer = setTimeout(finish, delayMs);
      };

      const killProcessTree = () => {
        if (process.platform === "win32" && child.pid) {
          execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true }, () => undefined);
          return;
        }
        child.kill();
      };

      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (exitGraceTimer) {
          clearTimeout(exitGraceTimer);
        }
        child.stdout.destroy();
        child.stderr.destroy();
        resolve({
          stdout,
          stderr,
          exitCode,
          timedOut,
          durationMs: Date.now() - startedAt,
          executionProfile,
        });
      };

      const finishAfterExit = (code: number | null) => {
        exitCode = code;
        if (!timedOut) {
          clearTimeout(timer);
        }
        scheduleFinish(timedOut ? 2_000 : 100);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killProcessTree();
        scheduleFinish(2_000);
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = truncate(stdout + chunk.toString());
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = truncate(stderr + chunk.toString());
      });
      child.on("error", (error) => {
        stderr = truncate(`${stderr}${error.message}`);
        finish();
      });
      child.on("exit", finishAfterExit);
      child.on("close", (code) => {
        exitCode = exitCode ?? code;
        finish();
      });
    });
  }

  async applyPatch(patch: string): Promise<PatchApplyResult> {
    const files = parseUnifiedDiff(patch);
    if (files.length === 0) {
      throw new Error("Patch has no unified diff file hunks.");
    }

    const plans: PatchWritePlan[] = [];
    for (const file of files) {
      const targetPath = patchTargetPath(file);
      assertWorkspacePathAllowed(targetPath, "write");
      if (file.oldPath) {
        assertWorkspacePathAllowed(file.oldPath, "write");
      }
      if (file.oldPath && file.newPath && file.oldPath !== file.newPath) {
        throw new Error(`Patch renames are not supported yet: ${file.oldPath} -> ${file.newPath}`);
      }

      const absolute = this.resolveInsideWorkspace(targetPath);
      const existing = await readOptional(absolute);
      const operation = patchOperation(file);
      if (operation !== "create" && existing === undefined) {
        throw new Error(`Patch target file does not exist: ${targetPath}`);
      }
      if (operation === "create" && existing !== undefined) {
        throw new Error(`Patch target file already exists: ${targetPath}`);
      }

      const beforeHash = existing === undefined ? undefined : hash(existing);
      const nextContent = operation === "delete" ? undefined : applyFileHunks(targetPath, existing ?? "", file.hunks, operation === "create");
      const afterHash = nextContent === undefined ? undefined : hash(nextContent);
      plans.push({
        path: targetPath,
        absolute,
        operation,
        beforeHash,
        afterHash,
        content: nextContent,
        hunkCount: file.hunks.length,
      });
    }

    for (const plan of plans) {
      if (plan.operation === "delete") {
        await fs.rm(plan.absolute, { force: true });
      } else {
        await fs.mkdir(path.dirname(plan.absolute), { recursive: true });
        await fs.writeFile(plan.absolute, plan.content ?? "", "utf8");
      }
    }

    const changedFiles: PatchFileResult[] = plans.map((plan) => ({
      path: plan.path,
      operation: plan.operation,
      beforeHash: plan.beforeHash,
      afterHash: plan.afterHash,
      summary: `${plan.operation} via ${plan.hunkCount} patch hunk(s)`,
    }));
    const hunkCount = plans.reduce((total, plan) => total + plan.hunkCount, 0);
    return {
      summary: `applied ${hunkCount} patch hunk(s) to ${plans.length} file(s)`,
      hunks: hunkCount,
      files: changedFiles,
    };
  }

  async createFile(input: CreateFileInput): Promise<WriteResult> {
    assertWorkspacePathAllowed(input.path, "write");
    const absolute = this.resolveInsideWorkspace(input.path);
    const existing = await readOptional(absolute);
    if (existing !== undefined && !input.overwrite) {
      throw new Error(`File already exists: ${input.path}`);
    }
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, input.content, "utf8");
    return {
      path: input.path,
      beforeHash: existing === undefined ? undefined : hash(existing),
      afterHash: hash(input.content),
      summary: existing === undefined ? "created file" : "overwrote file",
    };
  }

  async replaceRange(input: ReplaceRangeInput): Promise<WriteResult> {
    assertWorkspacePathAllowed(input.path, "write");
    if (input.startLine < 1 || input.endLine < input.startLine) {
      throw new Error("Invalid line range.");
    }
    const absolute = this.resolveInsideWorkspace(input.path);
    const existing = await fs.readFile(absolute, "utf8");
    const lines = existing.split(/\r?\n/);
    if (input.endLine > lines.length) {
      throw new Error(`Line range exceeds file length: ${input.endLine} > ${lines.length}`);
    }
    const replacement = input.content.split(/\r?\n/);
    const nextLines = [...lines.slice(0, input.startLine - 1), ...replacement, ...lines.slice(input.endLine)];
    const next = nextLines.join("\n");
    await fs.writeFile(absolute, next, "utf8");
    return {
      path: input.path,
      beforeHash: hash(existing),
      afterHash: hash(next),
      summary: `replaced lines ${input.startLine}-${input.endLine}`,
    };
  }

  private resolveInsideWorkspace(inputPath: string): string {
    const absolute = path.resolve(this.root, inputPath);
    const relative = path.relative(this.root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Path escapes workspace: ${inputPath}`);
    }
    return absolute;
  }
}

async function searchTextFallback(root: string, query: string, glob?: string): Promise<string> {
  const matches: string[] = [];
  const globMatcher = glob ? createGlobMatcher(glob) : undefined;
  await walkSearch(root, "", query, globMatcher, matches);
  return truncate(matches.join("\n"));
}

async function walkSearch(root: string, relativeDir: string, query: string, globMatcher: ((path: string) => boolean) | undefined, matches: string[]): Promise<void> {
  if (matches.join("\n").length >= MAX_OUTPUT) {
    return;
  }
  const absoluteDir = path.join(root, relativeDir);
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const relativePath = normalizeSearchPath(path.join(relativeDir, entry.name));
    if (!relativePath) {
      continue;
    }
    if (entry.isDirectory()) {
      if (SEARCH_IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      await walkSearch(root, relativePath, query, globMatcher, matches);
      continue;
    }
    if (!entry.isFile() || (globMatcher && !globMatcher(relativePath))) {
      continue;
    }
    await searchFile(path.join(root, relativePath), relativePath, query, matches);
  }
}

async function searchFile(absolutePath: string, relativePath: string, query: string, matches: string[]): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(absolutePath, "utf8");
  } catch {
    return;
  }
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.includes(query)) {
      matches.push(`${relativePath}:${index + 1}:${line}`);
      if (matches.join("\n").length >= MAX_OUTPUT) {
        return;
      }
    }
  }
}

function createGlobMatcher(glob: string): (inputPath: string) => boolean {
  const normalized = normalizeSearchPath(glob);
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\0/g, ".*");
  const regex = new RegExp(`^${escaped}$`);
  return (inputPath) => regex.test(normalizeSearchPath(inputPath));
}

function normalizeSearchPath(inputPath: string): string {
  return inputPath.replace(/\\/g, "/").replace(/^\.?\//, "");
}

async function readOptional(inputPath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(inputPath, "utf8");
  } catch (error) {
    const maybe = error as { code?: string };
    if (maybe.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function truncate(value: string): string {
  return value.length > MAX_OUTPUT ? `${value.slice(0, MAX_OUTPUT)}\n[truncated]` : value;
}

type ParsedPatchFile = {
  oldPath?: string;
  newPath?: string;
  hunks: ParsedPatchHunk[];
};

type ParsedPatchHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: ParsedPatchLine[];
};

type ParsedPatchLine = {
  kind: "context" | "add" | "delete";
  text: string;
};

type PatchWritePlan = {
  path: string;
  absolute: string;
  operation: PatchFileResult["operation"];
  beforeHash?: string;
  afterHash?: string;
  content?: string;
  hunkCount: number;
};

function parseUnifiedDiff(patch: string): ParsedPatchFile[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const files: ParsedPatchFile[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].startsWith("--- ")) {
      index += 1;
      continue;
    }

    const oldPath = parseDiffPath(lines[index], "--- ");
    index += 1;
    if (index >= lines.length || !lines[index].startsWith("+++ ")) {
      throw new Error("Invalid unified diff: missing +++ file header.");
    }
    const newPath = parseDiffPath(lines[index], "+++ ");
    index += 1;

    const file: ParsedPatchFile = {
      oldPath,
      newPath,
      hunks: [],
    };

    while (index < lines.length && !lines[index].startsWith("--- ")) {
      const line = lines[index];
      if (!line) {
        index += 1;
        continue;
      }
      if (!line.startsWith("@@ ")) {
        index += 1;
        continue;
      }

      const hunk = parseHunkHeader(line);
      index += 1;
      let oldSeen = 0;
      let newSeen = 0;
      while (index < lines.length && (oldSeen < hunk.oldCount || newSeen < hunk.newCount)) {
        const hunkLine = lines[index];
        if (hunkLine.startsWith("\\ No newline at end of file")) {
          index += 1;
          continue;
        }
        if (hunkLine.startsWith(" ")) {
          hunk.lines.push({ kind: "context", text: hunkLine.slice(1) });
          oldSeen += 1;
          newSeen += 1;
        } else if (hunkLine.startsWith("+")) {
          hunk.lines.push({ kind: "add", text: hunkLine.slice(1) });
          newSeen += 1;
        } else if (hunkLine.startsWith("-")) {
          hunk.lines.push({ kind: "delete", text: hunkLine.slice(1) });
          oldSeen += 1;
        } else {
          throw new Error(`Invalid unified diff hunk line: ${hunkLine}`);
        }
        index += 1;
      }
      validateHunkCounts(hunk);
      file.hunks.push(hunk);
    }

    if (file.hunks.length === 0) {
      throw new Error(`Patch file has no hunks: ${newPath ?? oldPath ?? "/dev/null"}`);
    }
    files.push(file);
  }

  return files;
}

function parseDiffPath(line: string, prefix: "--- " | "+++ "): string | undefined {
  const raw = line.slice(prefix.length).trim();
  if (raw === "/dev/null") {
    return undefined;
  }
  const withoutTimestamp = raw.split("\t")[0].trim();
  const unquoted = withoutTimestamp.startsWith("\"") && withoutTimestamp.endsWith("\"")
    ? withoutTimestamp.slice(1, -1)
    : withoutTimestamp;
  return unquoted.replace(/^(a|b)\//, "");
}

function parseHunkHeader(line: string): ParsedPatchHunk {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) {
    throw new Error(`Invalid unified diff hunk header: ${line}`);
  }
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
    lines: [],
  };
}

function validateHunkCounts(hunk: ParsedPatchHunk): void {
  const oldCount = hunk.lines.filter((line) => line.kind === "context" || line.kind === "delete").length;
  const newCount = hunk.lines.filter((line) => line.kind === "context" || line.kind === "add").length;
  if (oldCount !== hunk.oldCount || newCount !== hunk.newCount) {
    throw new Error(`Unified diff hunk line counts do not match header: expected -${hunk.oldCount} +${hunk.newCount}, got -${oldCount} +${newCount}`);
  }
}

function patchTargetPath(file: ParsedPatchFile): string {
  const targetPath = file.newPath ?? file.oldPath;
  if (!targetPath) {
    throw new Error("Patch file cannot have both old and new path set to /dev/null.");
  }
  return targetPath;
}

function patchOperation(file: ParsedPatchFile): PatchFileResult["operation"] {
  if (!file.oldPath) {
    return "create";
  }
  if (!file.newPath) {
    return "delete";
  }
  return "modify";
}

function applyFileHunks(filePath: string, existingContent: string, hunks: ParsedPatchHunk[], isNewFile: boolean): string {
  const { lines: originalLines, trailingNewline } = splitContent(existingContent);
  const nextLines: string[] = [];
  let sourceIndex = 0;

  for (const hunk of hunks) {
    const hunkStart = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
    if (hunkStart < sourceIndex) {
      throw new Error(`Patch hunks overlap or are out of order for ${filePath}.`);
    }
    nextLines.push(...originalLines.slice(sourceIndex, hunkStart));
    sourceIndex = hunkStart;

    for (const line of hunk.lines) {
      if (line.kind === "add") {
        nextLines.push(line.text);
        continue;
      }

      assertPatchLineMatches(filePath, originalLines[sourceIndex], line.text);
      if (line.kind === "context") {
        nextLines.push(line.text);
      }
      sourceIndex += 1;
    }
  }

  nextLines.push(...originalLines.slice(sourceIndex));
  return joinContent(nextLines, isNewFile || trailingNewline);
}

function splitContent(content: string): { lines: string[]; trailingNewline: boolean } {
  const normalized = content.replace(/\r\n/g, "\n");
  const trailingNewline = normalized.endsWith("\n");
  const body = trailingNewline ? normalized.slice(0, -1) : normalized;
  return {
    lines: body.length === 0 ? [] : body.split("\n"),
    trailingNewline,
  };
}

function joinContent(lines: string[], trailingNewline: boolean): string {
  return `${lines.join("\n")}${trailingNewline ? "\n" : ""}`;
}

function assertPatchLineMatches(filePath: string, actual: string | undefined, expected: string): void {
  if (actual !== expected) {
    throw new Error(`Patch context mismatch in ${filePath}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual ?? "<end of file>")}`);
  }
}

import { promises as fs } from "node:fs";
import path from "node:path";

export type WorkspaceAccessKind = "read" | "write";

export type HygieneFinding = {
  severity: "info" | "warning" | "error";
  path: string;
  rule: string;
  message: string;
};

const PROTECTED_ROOTS = new Set([".git", ".agent"]);
const AGENT_ALLOWED_PREFIXES = [".agent/tmp"];
const SCAN_IGNORES = new Set(["node_modules", ".git", "dist", "coverage"]);

export function assertWorkspacePathAllowed(inputPath: string, access: WorkspaceAccessKind): void {
  const normalized = normalizeWorkspacePath(inputPath);
  if (!normalized) {
    return;
  }
  const root = normalized.split("/")[0];
  if (!PROTECTED_ROOTS.has(root)) {
    return;
  }
  if (root === ".agent" && AGENT_ALLOWED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    return;
  }
  throw new Error(`Protected workspace path cannot be ${access === "read" ? "read" : "modified"} by agent tools: ${inputPath}`);
}

export function commandTouchesProtectedPath(command: string): boolean {
  const normalized = command.replace(/\\/g, "/").toLowerCase();
  return /(^|[\s"'`])\.git(\/|[\s"'`]|$)/.test(normalized) || /(^|[\s"'`])\.agent(\/|[\s"'`]|$)/.test(normalized);
}

export async function scanExecutionHygiene(root: string): Promise<HygieneFinding[]> {
  const findings: HygieneFinding[] = [];
  await walk(root, "", findings);
  return findings.sort((left, right) => left.path.localeCompare(right.path));
}

async function walk(root: string, relativeDir: string, findings: HygieneFinding[]): Promise<void> {
  const absoluteDir = path.join(root, relativeDir);
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const relative = normalizeWorkspacePath(path.join(relativeDir, entry.name));
    if (!relative) {
      continue;
    }
    if (entry.isDirectory()) {
      if (SCAN_IGNORES.has(entry.name) || relative === ".agent/tmp") {
        continue;
      }
      await walk(root, relative, findings);
      continue;
    }
    const finding = classifyPotentialResidue(relative);
    if (finding) {
      findings.push(finding);
    }
  }
}

function classifyPotentialResidue(relativePath: string): HygieneFinding | undefined {
  const basename = path.posix.basename(relativePath).toLowerCase();
  const allowedTemp = relativePath === ".agent/tmp" || relativePath.startsWith(".agent/tmp/") || relativePath.startsWith("tmp/") || relativePath.startsWith("temp/");
  if (allowedTemp) {
    return undefined;
  }
  if (/\.(tmp|temp|bak|orig|rej|log)$/.test(basename) || /^(tmp-|debug-|scratch-)/.test(basename)) {
    return {
      severity: "warning",
      path: relativePath,
      rule: "temporary-file-residue",
      message: "Temporary/debug residue should live under .agent/tmp or be deleted before finishing.",
    };
  }
  if (/\.(tmp|scratch|debug)\.(test|spec)\.[cm]?[jt]sx?$/.test(basename)) {
    return {
      severity: "warning",
      path: relativePath,
      rule: "temporary-test-residue",
      message: "Temporary tests should be deleted after verification or promoted into a permanent regression test.",
    };
  }
  return undefined;
}

function normalizeWorkspacePath(inputPath: string): string {
  const normalized = path.posix.normalize(inputPath.replace(/\\/g, "/"));
  return normalized === "." ? "" : normalized.replace(/^\.?\//, "");
}

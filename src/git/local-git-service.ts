import { spawn } from "node:child_process";
import type { ActorRef, AuditEvent, GitProvider, PullRequestRef } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore } from "../store/agent-store.js";

export type GitStatus = {
  insideWorkTree: boolean;
  branch?: string;
  headSha?: string;
  remoteUrl?: string;
  provider?: GitProvider;
  repositorySlug?: string;
  dirtyFiles: string[];
};

export type PreparePullRequestInput = {
  title: string;
  body?: string;
  branch?: string;
  base?: string;
  remote?: string;
  provider?: GitProvider;
  commitMessage?: string;
  commit?: boolean;
  push?: boolean;
  dryRun?: boolean;
};

export type PreparedPullRequest = {
  status: GitStatus;
  provider?: GitProvider;
  base: string;
  branch: string;
  title: string;
  body: string;
  commitSha?: string;
  pushed: boolean;
  dryRun: boolean;
  createUrl?: string;
  pushCommand?: string;
  pullRequestRef?: PullRequestRef;
  steps: string[];
};

export class LocalGitService {
  constructor(
    private readonly cwd: string,
    private readonly store?: AgentStore,
    private readonly actor: ActorRef = { type: "user", id: "local-user", displayName: "Local User" },
  ) {}

  async status(remote = "origin"): Promise<GitStatus> {
    const inside = await this.git(["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
    if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
      return { insideWorkTree: false, dirtyFiles: [] };
    }
    const [branch, headSha, remoteUrl, dirty] = await Promise.all([
      this.git(["branch", "--show-current"], { allowFailure: true }),
      this.git(["rev-parse", "HEAD"], { allowFailure: true }),
      this.git(["remote", "get-url", remote], { allowFailure: true }),
      this.git(["status", "--porcelain"], { allowFailure: true }),
    ]);
    const detected = detectGitRemote(remoteUrl.stdout.trim());
    const dirtyFiles = dirty.stdout
      .split(/\r?\n/)
      .map((line) => parsePorcelainPath(line))
      .filter((filePath): filePath is string => Boolean(filePath))
      .filter((filePath) => !isAgentPrivatePath(filePath));
    return {
      insideWorkTree: true,
      branch: branch.stdout.trim() || undefined,
      headSha: headSha.stdout.trim() || undefined,
      remoteUrl: remoteUrl.exitCode === 0 ? remoteUrl.stdout.trim() : undefined,
      provider: detected?.provider,
      repositorySlug: detected?.slug,
      dirtyFiles,
    };
  }

  async preparePullRequest(input: PreparePullRequestInput): Promise<PreparedPullRequest> {
    const remote = input.remote ?? "origin";
    const status = await this.status(remote);
    if (!status.insideWorkTree) {
      throw new Error("Current workspace is not inside a Git work tree.");
    }
    const base = input.base ?? "main";
    const branch = input.branch ?? `agent/${slugify(input.title)}-${new Date().toISOString().slice(0, 10)}`;
    const dryRun = input.dryRun ?? true;
    const steps: string[] = [];

    if (status.branch !== branch) {
      if (dryRun) {
        steps.push(`would create/switch branch ${branch}`);
      } else {
        const existing = await this.git(["rev-parse", "--verify", branch], { allowFailure: true });
        await this.git(existing.exitCode === 0 ? ["switch", branch] : ["switch", "-c", branch]);
        steps.push(existing.exitCode === 0 ? `switched branch ${branch}` : `created branch ${branch}`);
      }
    }

    let commitSha = status.headSha;
    if (input.commit) {
      if (dryRun) {
        steps.push(`would commit ${status.dirtyFiles.length} changed file(s)`);
      } else {
        if (status.dirtyFiles.length === 0) {
          steps.push("no changed files to commit");
        } else {
          await this.git(["add", "--all", "--", ...status.dirtyFiles]);
          await this.git(["commit", "-m", input.commitMessage ?? input.title]);
          const head = await this.git(["rev-parse", "HEAD"]);
          commitSha = head.stdout.trim();
          steps.push(`created commit ${commitSha}`);
        }
      }
    }

    const detected = detectGitRemote(status.remoteUrl ?? "");
    const provider = input.provider ?? detected?.provider;
    const slug = detected?.slug;
    const pushCommand = `git push -u ${remote} ${branch}`;
    let pushed = false;
    if (input.push) {
      if (dryRun) {
        steps.push(`would push with: ${pushCommand}`);
      } else {
        await this.git(["push", "-u", remote, branch]);
        pushed = true;
        steps.push(`pushed ${branch} to ${remote}`);
      }
    }

    const createUrl = provider && slug ? createPullRequestUrl(provider, slug, base, branch, input.title, input.body ?? "") : undefined;
    const pullRequestRef =
      provider && slug
        ? {
            provider,
            repositoryId: slug,
            branch,
            commitSha,
            url: createUrl,
            ciStatus: "unknown" as const,
          }
        : undefined;
    const result: PreparedPullRequest = {
      status,
      provider,
      base,
      branch,
      title: input.title,
      body: input.body ?? "",
      commitSha,
      pushed,
      dryRun,
      createUrl,
      pushCommand,
      pullRequestRef,
      steps,
    };
    await this.audit("pr.created", dryRun ? "Prepared PR draft in dry-run mode" : "Prepared PR draft", {
      provider,
      repositorySlug: slug,
      base,
      branch,
      title: input.title,
      commit: input.commit ?? false,
      push: input.push ?? false,
      dryRun,
      createUrl,
      steps,
    });
    return result;
  }

  private async git(args: string[], options: { allowFailure?: boolean } = {}): Promise<CommandResult> {
    const result = await run("git", args, this.cwd);
    if (result.exitCode !== 0 && !options.allowFailure) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
    }
    return result;
  }

  private async audit(type: AuditEvent["type"], summary: string, metadata: Record<string, unknown>): Promise<void> {
    await this.store?.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type,
      actor: this.actor,
      summary,
      metadata,
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    });
  }
}

type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

function run(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function detectGitRemote(remoteUrl: string): { provider: GitProvider; slug: string } | undefined {
  const normalized = remoteUrl.trim().replace(/\.git$/, "");
  const https = normalized.match(/^https:\/\/(?:www\.)?(github\.com|gitlab\.com)\/([^/]+\/[^/]+)$/i);
  if (https) {
    return {
      provider: https[1].toLowerCase().includes("github") ? "github" : "gitlab",
      slug: https[2],
    };
  }
  const ssh = normalized.match(/^git@(github\.com|gitlab\.com):([^/]+\/[^/]+)$/i);
  if (ssh) {
    return {
      provider: ssh[1].toLowerCase().includes("github") ? "github" : "gitlab",
      slug: ssh[2],
    };
  }
  return undefined;
}

function createPullRequestUrl(provider: GitProvider, slug: string, base: string, branch: string, title: string, body: string): string {
  const query = new URLSearchParams();
  if (provider === "github") {
    query.set("expand", "1");
    query.set("title", title);
    if (body) {
      query.set("body", body);
    }
    return `https://github.com/${slug}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?${query.toString()}`;
  }
  query.set("merge_request[source_branch]", branch);
  query.set("merge_request[target_branch]", base);
  query.set("merge_request[title]", title);
  if (body) {
    query.set("merge_request[description]", body);
  }
  return `https://gitlab.com/${slug}/-/merge_requests/new?${query.toString()}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "task";
}

function parsePorcelainPath(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }
  const pathPart = trimmed.slice(3);
  const renameIndex = pathPart.indexOf(" -> ");
  return renameIndex === -1 ? pathPart : pathPart.slice(renameIndex + 4);
}

function isAgentPrivatePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized === ".agent" || normalized.startsWith(".agent/");
}

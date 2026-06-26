import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SoloclawPlatformId = "windows" | "linux" | "macos" | "android-termux";

export type SoloclawPlatform = {
  id: SoloclawPlatformId;
  nodePlatform: NodeJS.Platform;
  isTermux: boolean;
};

export type SoloclawPlatformPaths = {
  homeDir: string;
  configDir: string;
  cacheDir: string;
  logDir: string;
  modelConfigPath: string;
  secretVaultPath: string;
  secretKeyPath: string;
  workspaceHistoryPath: string;
  legacyHomeDir?: string;
  legacyModelConfigPath?: string;
  legacyWorkspaceHistoryPath?: string;
};

export type SoloclawPlatformCapabilities = {
  platform: SoloclawPlatform;
  paths: SoloclawPlatformPaths;
  shellHints: {
    primary: "powershell" | "cmd" | "bash" | "zsh" | "sh";
    envExamples: {
      powershell: string;
      cmd: string;
      posix: string;
    };
  };
  commands: {
    node: CapabilityCommand;
    npm: CapabilityCommand;
    git: CapabilityCommand;
    rg: CapabilityCommand;
    cargo: CapabilityCommand;
    powershell: CapabilityCommand;
    cmd: CapabilityCommand;
    bash: CapabilityCommand;
    zsh: CapabilityCommand;
  };
  rustRunner: {
    available: boolean;
    path?: string;
    source: "env" | "repo-target" | "missing";
  };
};

export type CapabilityCommand = {
  available: boolean;
  command: string;
};

export type SoloclawPlatformDetectionOptions = {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  home?: string;
  repoRoot?: string;
  commandExists?: (command: string, args: string[]) => Promise<boolean>;
  fileExists?: (inputPath: string) => Promise<boolean>;
};

export function detectSoloclawPlatform(options: SoloclawPlatformDetectionOptions = {}): SoloclawPlatform {
  const env = options.env ?? process.env;
  const nodePlatform = options.platform ?? process.platform;
  const prefix = env.PREFIX ?? "";
  const isTermux = Boolean(env.TERMUX_VERSION || prefix.includes("com.termux"));
  if (isTermux) {
    return { id: "android-termux", nodePlatform, isTermux: true };
  }
  if (nodePlatform === "win32") {
    return { id: "windows", nodePlatform, isTermux: false };
  }
  if (nodePlatform === "darwin") {
    return { id: "macos", nodePlatform, isTermux: false };
  }
  return { id: "linux", nodePlatform, isTermux: false };
}

export function resolveSoloclawPaths(options: SoloclawPlatformDetectionOptions = {}): SoloclawPlatformPaths {
  const env = options.env ?? process.env;
  const platform = detectSoloclawPlatform(options);
  const p = pathApi(platform.nodePlatform);
  const home = options.home ?? os.homedir();
  const explicitHome = env.SOLOCLAW_HOME ? normalizePathForPlatform(p, env.SOLOCLAW_HOME) : undefined;

  if (explicitHome) {
    return withFiles(p, {
      homeDir: explicitHome,
      configDir: explicitHome,
      cacheDir: p.join(explicitHome, "cache"),
      logDir: p.join(explicitHome, "logs"),
    });
  }

  if (platform.id === "windows") {
    const appData = normalizePathForPlatform(p, env.APPDATA ?? p.join(home, "AppData", "Roaming"));
    const localAppData = normalizePathForPlatform(p, env.LOCALAPPDATA ?? appData);
    const configDir = p.join(appData, "soloclaw");
    return withFiles(p, {
      homeDir: configDir,
      configDir,
      cacheDir: p.join(localAppData, "soloclaw", "cache"),
      logDir: p.join(localAppData, "soloclaw", "logs"),
    });
  }

  if (platform.id === "macos") {
    const configDir = p.join(home, "Library", "Application Support", "soloclaw");
    return withFiles(p, {
      homeDir: configDir,
      configDir,
      cacheDir: p.join(home, "Library", "Caches", "soloclaw"),
      logDir: p.join(home, "Library", "Logs", "soloclaw"),
      legacyHomeDir: p.join(home, ".soloclaw"),
    });
  }

  const configBase = normalizePathForPlatform(p, env.XDG_CONFIG_HOME ?? p.join(home, ".config"));
  const cacheBase = normalizePathForPlatform(p, env.XDG_CACHE_HOME ?? p.join(home, ".cache"));
  const stateBase = normalizePathForPlatform(p, env.XDG_STATE_HOME ?? p.join(home, ".local", "state"));
  return withFiles(p, {
    homeDir: p.join(configBase, "soloclaw"),
    configDir: p.join(configBase, "soloclaw"),
    cacheDir: p.join(cacheBase, "soloclaw"),
    logDir: p.join(stateBase, "soloclaw", "logs"),
    legacyHomeDir: p.join(home, ".soloclaw"),
  });
}

export async function detectPlatformCapabilities(options: SoloclawPlatformDetectionOptions = {}): Promise<SoloclawPlatformCapabilities> {
  const platform = detectSoloclawPlatform(options);
  const paths = resolveSoloclawPaths(options);
  const commandExists = options.commandExists ?? defaultCommandExists;
  const [
    npm,
    git,
    rg,
    cargo,
    powershell,
    cmd,
    bash,
    zsh,
  ] = await Promise.all([
    commandExists("npm", ["--version"]),
    commandExists("git", ["--version"]),
    commandExists("rg", ["--version"]),
    commandExists("cargo", ["--version"]),
    commandExists("powershell", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]),
    commandExists("cmd", ["/c", "ver"]),
    commandExists("bash", ["--version"]),
    commandExists("zsh", ["--version"]),
  ]);
  const runner = await findSoloclawAgentRunner({
    ...options,
    platform: platform.nodePlatform,
  });

  return {
    platform,
    paths,
    shellHints: shellHints(platform.id),
    commands: {
      node: { available: true, command: process.execPath },
      npm: { available: npm, command: "npm" },
      git: { available: git, command: "git" },
      rg: { available: rg, command: "rg" },
      cargo: { available: cargo, command: "cargo" },
      powershell: { available: powershell, command: "powershell" },
      cmd: { available: cmd, command: "cmd" },
      bash: { available: bash, command: "bash" },
      zsh: { available: zsh, command: "zsh" },
    },
    rustRunner: {
      available: runner.available,
      path: runner.path,
      source: runner.source,
    },
  };
}

export async function findSoloclawAgentRunner(options: SoloclawPlatformDetectionOptions = {}): Promise<{ available: boolean; path?: string; source: "env" | "repo-target" | "missing" }> {
  const env = options.env ?? process.env;
  const platform = detectSoloclawPlatform(options);
  const p = pathApi(platform.nodePlatform);
  const fileExists = options.fileExists ?? defaultFileExists;
  if (env.SOLOCLAW_AGENT_RUNNER) {
    const runnerPath = normalizePathForPlatform(p, env.SOLOCLAW_AGENT_RUNNER);
    return { available: await fileExists(runnerPath), path: runnerPath, source: "env" };
  }
  const exe = platform.nodePlatform === "win32" ? "agent-runner.exe" : "agent-runner";
  for (const root of candidateRepoRoots(options.repoRoot)) {
    const candidate = p.join(root, "target", "debug", exe);
    if (await fileExists(candidate)) {
      return { available: true, path: candidate, source: "repo-target" };
    }
  }
  return { available: false, source: "missing" };
}

function withFiles(
  p: Pick<typeof path, "join">,
  paths: Omit<SoloclawPlatformPaths, "modelConfigPath" | "secretVaultPath" | "secretKeyPath" | "workspaceHistoryPath" | "legacyModelConfigPath" | "legacyWorkspaceHistoryPath">,
): SoloclawPlatformPaths {
  return {
    ...paths,
    modelConfigPath: p.join(paths.configDir, "model-providers.json"),
    secretVaultPath: p.join(paths.configDir, "secrets.vault.json"),
    secretKeyPath: p.join(paths.configDir, "secrets.key"),
    workspaceHistoryPath: p.join(paths.configDir, "workspaces.json"),
    legacyModelConfigPath: paths.legacyHomeDir ? p.join(paths.legacyHomeDir, "model-providers.json") : undefined,
    legacyWorkspaceHistoryPath: paths.legacyHomeDir ? p.join(paths.legacyHomeDir, "workspaces.json") : undefined,
  };
}

function shellHints(platformId: SoloclawPlatformId): SoloclawPlatformCapabilities["shellHints"] {
  const primary = platformId === "windows" ? "powershell" : platformId === "macos" ? "zsh" : "bash";
  return {
    primary,
    envExamples: {
      powershell: '$env:SOLOCLAW_HOME="<path>"',
      cmd: "set SOLOCLAW_HOME=<path>",
      posix: 'export SOLOCLAW_HOME="<path>"',
    },
  };
}

function candidateRepoRoots(repoRoot?: string): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const roots = [repoRoot, process.cwd(), path.resolve(moduleDir, "..", "..")].filter((entry): entry is string => Boolean(entry));
  return [...new Set(roots.map((entry) => path.resolve(entry)))];
}

function pathApi(platform: NodeJS.Platform): typeof path.win32 | typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

function normalizePathForPlatform(p: typeof path.win32 | typeof path.posix, value: string): string {
  return p.normalize(value);
}

async function defaultCommandExists(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 3_000, windowsHide: true });
    return true;
  } catch {
    if (process.platform === "win32" && !/\.(cmd|exe|bat)$/i.test(command)) {
      try {
        await execFileAsync("cmd", ["/c", command, ...args], { timeout: 3_000, windowsHide: true });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

async function defaultFileExists(inputPath: string): Promise<boolean> {
  const { promises: fs } = await import("node:fs");
  try {
    await fs.access(inputPath);
    return true;
  } catch {
    return false;
  }
}

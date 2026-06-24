import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { GlobalModelProfileStore } from "../model/global-model-profile-store.js";
import { resolveContextCompactionOptions } from "../platform/local-platform.js";
import { detectSoloclawPlatform, resolveSoloclawPaths } from "../platform/soloclaw-platform.js";

test("phase4 platform paths resolve across Windows Linux macOS and Termux", () => {
  const windows = resolveSoloclawPaths({
    platform: "win32",
    home: "C:\\Users\\Ada",
    env: {
      APPDATA: "C:\\Users\\Ada\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local",
    },
  });
  assert.equal(windows.configDir, "C:\\Users\\Ada\\AppData\\Roaming\\soloclaw");
  assert.equal(windows.cacheDir, "C:\\Users\\Ada\\AppData\\Local\\soloclaw\\cache");
  assert.equal(windows.logDir, "C:\\Users\\Ada\\AppData\\Local\\soloclaw\\logs");

  const linux = resolveSoloclawPaths({
    platform: "linux",
    home: "/home/ada",
    env: {
      XDG_CONFIG_HOME: "/xdg/config",
      XDG_CACHE_HOME: "/xdg/cache",
      XDG_STATE_HOME: "/xdg/state",
    },
  });
  assert.equal(linux.configDir, "/xdg/config/soloclaw");
  assert.equal(linux.cacheDir, "/xdg/cache/soloclaw");
  assert.equal(linux.logDir, "/xdg/state/soloclaw/logs");
  assert.equal(linux.legacyModelConfigPath, "/home/ada/.soloclaw/model-providers.json");

  const macos = resolveSoloclawPaths({ platform: "darwin", home: "/Users/ada", env: {} });
  assert.equal(macos.configDir, "/Users/ada/Library/Application Support/soloclaw");
  assert.equal(macos.cacheDir, "/Users/ada/Library/Caches/soloclaw");
  assert.equal(macos.logDir, "/Users/ada/Library/Logs/soloclaw");

  const termuxPlatform = detectSoloclawPlatform({
    platform: "linux",
    home: "/data/data/com.termux/files/home",
    env: { TERMUX_VERSION: "0.118" },
  });
  const termux = resolveSoloclawPaths({
    platform: "linux",
    home: "/data/data/com.termux/files/home",
    env: { TERMUX_VERSION: "0.118" },
  });
  assert.equal(termuxPlatform.id, "android-termux");
  assert.equal(termux.configDir, "/data/data/com.termux/files/home/.config/soloclaw");
});

test("phase4 SOLOCLAW_HOME overrides all global Soloclaw paths", () => {
  const paths = resolveSoloclawPaths({
    platform: "linux",
    home: "/home/ada",
    env: { SOLOCLAW_HOME: "/tmp/soloclaw-home" },
  });
  assert.equal(paths.configDir, "/tmp/soloclaw-home");
  assert.equal(paths.modelConfigPath, "/tmp/soloclaw-home/model-providers.json");
  assert.equal(paths.cacheDir, "/tmp/soloclaw-home/cache");
  assert.equal(paths.logDir, "/tmp/soloclaw-home/logs");
  assert.equal(paths.legacyModelConfigPath, undefined);
});

test("local platform parses context compaction threshold and summary env options", () => {
  const options = resolveContextCompactionOptions({}, {
    SOLOCLAW_CONTEXT_WINDOW_TOKENS: "1000",
    SOLOCLAW_CONTEXT_COMPACTION_THRESHOLD_PERCENT: "75",
    SOLOCLAW_CONTEXT_COMPACTION_SUMMARY_MODE: "model",
  });
  assert.equal(options?.contextWindowTokens, 1000);
  assert.equal(options?.thresholdPercent, 75);
  assert.equal(options?.summaryMode, "model");

  assert.throws(
    () => resolveContextCompactionOptions({}, { SOLOCLAW_CONTEXT_COMPACTION_SUMMARY_MODE: "invalid" }),
    /SOLOCLAW_CONTEXT_COMPACTION_SUMMARY_MODE must be heuristic, model, or auto/,
  );
});

test("local platform infers context window for automatic context compaction", () => {
  const defaultAuto = resolveContextCompactionOptions({
    provider: "openai",
    model: "gpt-4o-mini",
  }, {});
  assert.equal(defaultAuto?.contextWindowTokens, 128000);
  assert.equal(defaultAuto?.auto, true);

  const thresholdOnly = resolveContextCompactionOptions({
    provider: "openai",
    model: "gpt-4o-mini",
  }, {
    SOLOCLAW_CONTEXT_COMPACTION_THRESHOLD_PERCENT: "80",
  });
  assert.equal(thresholdOnly?.contextWindowTokens, 128000);
  assert.equal(thresholdOnly?.thresholdPercent, 80);

  const autoOnly = resolveContextCompactionOptions({
    provider: "anthropic",
    model: "claude-sonnet-4-5",
  }, {
    SOLOCLAW_CONTEXT_COMPACTION_AUTO: "true",
  });
  assert.equal(autoOnly?.contextWindowTokens, 200000);
  assert.equal(autoOnly?.auto, true);

  const disabled = resolveContextCompactionOptions({
    provider: "openai",
    model: "gpt-4o-mini",
  }, {
    SOLOCLAW_DISABLE_AUTOCOMPACT: "1",
  });
  assert.equal(disabled?.auto, false);
  assert.equal(disabled?.contextWindowTokens, undefined);

  const mock = resolveContextCompactionOptions({ provider: "mock", model: "mock" }, {});
  assert.equal(mock, undefined);
});

test("global model profiles read legacy config when new phase4 path is empty", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "soloclaw-phase4-legacy-"));
  const home = path.join(root, "new-home");
  const legacyHome = path.join(root, ".soloclaw");
  t.after(async () => {
    await removeTree(root);
  });

  await fs.mkdir(legacyHome, { recursive: true });
  await fs.writeFile(
    path.join(legacyHome, "model-providers.json"),
    JSON.stringify({
      version: 1,
      defaultProfile: "legacy-local",
      profiles: {
        "legacy-local": {
          id: "legacy-local",
          provider: "openai_compatible",
          protocol: "openai_chat",
          defaultBaseUrl: "http://localhost:11434/v1",
          defaultModel: "legacy-model",
          apiKeyEnvNames: [],
        },
      },
    }, null, 2),
    "utf8",
  );

  const store = new GlobalModelProfileStore(home, legacyHome);
  assert.equal(await store.usesLegacyConfig(), true);
  const profile = await store.resolveProfile("legacy-local");
  assert.equal(profile.defaultModel, "legacy-model");
  assert.equal(store.filePath, path.join(home, "model-providers.json"));
});

test("soloclaw config path json and phase4 verify expose safe platform metadata", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "soloclaw-phase4-cli-"));
  const home = path.join(workspace, ".agent");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  t.after(async () => {
    await removeTree(workspace);
  });
  await fs.writeFile(path.join(workspace, "package.json"), JSON.stringify({ name: "phase4-cli-fixture", type: "module" }, null, 2), "utf8");

  const env = {
    ...process.env,
    SOLOCLAW_HOME: home,
    PHASE4_SHOULD_NOT_LEAK: "sk-phase4secretvaluethatmustnotleak",
  };
  const config = await run(process.execPath, [cli, "config", "path", "--json"], workspace, env);
  assert.equal(config.exitCode, 0, config.stderr);
  assert.doesNotMatch(config.stdout, /sk-phase4secretvaluethatmustnotleak/);
  const configJson = JSON.parse(config.stdout) as { platform?: { id?: string }; paths?: { modelConfigPath?: string }; capabilities?: unknown };
  assert.equal(typeof configJson.platform?.id, "string");
  assert.equal(configJson.paths?.modelConfigPath, path.join(home, "model-providers.json"));
  assert.equal(Boolean(configJson.capabilities), true);

  const platformDoctor = await run(process.execPath, [cli, "platform", "doctor", "--json"], workspace, env);
  assert.equal(platformDoctor.exitCode, 0, platformDoctor.stderr);
  assert.doesNotMatch(platformDoctor.stdout, /sk-phase4secretvaluethatmustnotleak/);
  const platformDoctorJson = JSON.parse(platformDoctor.stdout) as { legacyConfig?: boolean; platform?: { id?: string }; paths?: { modelConfigPath?: string } };
  assert.equal(typeof platformDoctorJson.legacyConfig, "boolean");
  assert.equal(typeof platformDoctorJson.platform?.id, "string");
  assert.equal(platformDoctorJson.paths?.modelConfigPath, path.join(home, "model-providers.json"));

  const verify = await run(process.execPath, [cli, "phase4", "verify", "--workspace-runtime", "typescript", "--json"], workspace, env);
  assert.equal(verify.exitCode, 0, verify.stderr || verify.stdout);
  assert.doesNotMatch(verify.stdout, /sk-phase4secretvaluethatmustnotleak/);
  const parsed = JSON.parse(verify.stdout) as { phase?: string; status?: string; checks?: Array<{ id?: string; status?: string }> };
  assert.equal(parsed.phase, "phase4");
  assert.equal(parsed.status, "pass");
  assert.deepEqual(parsed.checks?.map((check) => check.id), [
    "platform-paths",
    "platform-capabilities",
    "cli-surface",
    "typescript-runtime-smoke",
    "rust-runtime-smoke",
    "secret-shape-scan",
  ]);
});

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env });
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

async function removeTree(inputPath: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    try {
      await fs.rm(inputPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (error) {
      lastError = error;
      if (!isBusyError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(250 * (attempt + 1), 1_000)));
    }
  }
  if (lastError) {
    throw lastError;
  }
}

function isBusyError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (
    (error as NodeJS.ErrnoException).code === "EBUSY" ||
    (error as NodeJS.ErrnoException).code === "EPERM" ||
    (error as NodeJS.ErrnoException).code === "ENOTEMPTY"
  );
}

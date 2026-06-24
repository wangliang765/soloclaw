# Soloclaw Platform Support

Phase 4A makes the local `soloclaw` command measurable across Windows, Linux, macOS, and Android Termux without adding native installers or OS service mutation.

## Paths

`SOLOCLAW_HOME` overrides all global Soloclaw paths. Model profiles live at `model-providers.json`; global secret vault files live beside it. Without `SOLOCLAW_HOME`:

- Windows uses `%APPDATA%\soloclaw` for config and `%LOCALAPPDATA%\soloclaw\cache|logs` for cache and logs.
- Linux uses `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, and `XDG_STATE_HOME`, falling back to `~/.config`, `~/.cache`, and `~/.local/state`.
- macOS uses `~/Library/Application Support/soloclaw`, `~/Library/Caches/soloclaw`, and `~/Library/Logs/soloclaw`.
- Android Termux is detected from `TERMUX_VERSION` or `PREFIX` containing `com.termux` and uses the Linux/XDG layout under Termux home.

Legacy `~/.soloclaw/model-providers.json` is read when the new config file is absent. Phase 4A does not automatically migrate secrets.

## Commands

```text
soloclaw platform doctor --json
soloclaw phase4 checklist
soloclaw phase4 verify --json
soloclaw phase4 matrix-template
soloclaw config path --json
```

`soloclaw run|ask|plan|build|goal` support optional workspace runtime selection:

```text
SOLOCLAW_WORKSPACE_RUNTIME=typescript|rust|auto
SOLOCLAW_AGENT_RUNNER=/path/to/agent-runner
soloclaw run --workspace-runtime auto "inspect this workspace"
```

`typescript` is the default supported runtime. `auto` falls back to TypeScript if no Rust runner is found. Explicit `rust` fails closed when `agent-runner` is unavailable.

Context-window compaction runs automatically for known built-in model profiles by inferring the active model's context window. Set a percentage threshold when you want compaction to happen before the default reserved-buffer boundary:

```text
SOLOCLAW_CONTEXT_COMPACTION_AUTO=true
SOLOCLAW_CONTEXT_COMPACTION_THRESHOLD_PERCENT=80
SOLOCLAW_CONTEXT_COMPACTION_SUMMARY_MODE=heuristic|model|auto
```

For custom or unknown model profiles, provide the window explicitly:

```text
SOLOCLAW_CONTEXT_WINDOW_TOKENS=200000
SOLOCLAW_CONTEXT_COMPACTION_BUFFER_TOKENS=20000
SOLOCLAW_CONTEXT_OUTPUT_RESERVE_TOKENS=8192
SOLOCLAW_CONTEXT_COMPACTION_KEEP_TOKENS=8000
```

Use `SOLOCLAW_DISABLE_AUTOCOMPACT=1`, `SOLOCLAW_CONTEXT_COMPACTION_AUTO=false`, or `--no-context-compaction` to disable the automatic path.

The same controls can be set per run or resume:

```text
soloclaw run --context-compaction-threshold-percent 80 "inspect this workspace"
agent resume <session-id> --context-window-tokens 200000 --context-compaction-summary-mode model
```

`heuristic` keeps the local deterministic summary. `model` asks the configured model for an opencode-style structured summary using a no-tool model request, then falls back to the heuristic summary if the summary is empty. `auto` currently follows the same model-first behavior when a summarizer is available. Repeated compactions parse the previous `<conversation-checkpoint>` summary and recent context, ask the model to update the anchored summary, and replace the active checkpoint instead of treating the old checkpoint as ordinary chat. Durable resumed runs also read the latest stored compaction checkpoint, while ordinary final-answer summaries remain reporting data and are not used as summary seeds.

## Manual Matrix

Run `soloclaw phase4 matrix-template` and record results for:

- Windows PowerShell
- Windows CMD
- Linux shell
- macOS shell
- Android Termux

Each target should run source install/build, `soloclaw doctor --json`, `soloclaw config path --json`, and `soloclaw phase4 verify --json`.

### Current Matrix Evidence 2026-06-21

Current boundary: the local Windows `soloclaw phase4 verify --workspace E:\code\agent --json` gate is a machine-checkable pass for this workspace. It does not close the fresh cross-OS matrix; macOS shell and Android Termux remain evidence collection items until their real-host captures are recorded.

| Target | Status | Evidence | Next action |
| --- | --- | --- | --- |
| Windows PowerShell | Pass | `powershell.exe -NoProfile -Command "npm.cmd run build"` passed. `doctor --json` returned `status=pass`. `config path --json` returned the Windows platform config path. `phase4 verify --workspace E:\code\agent --json` returned `status=pass` with platform paths, capabilities, CLI surface, TypeScript runtime smoke, Rust runtime smoke, and secret-shape scan passing. | Re-run before final release packaging. |
| Windows CMD | Pass | `cmd.exe /d /c npm.cmd run build` passed. `doctor --json` returned `status=pass`. `config path --json` returned the Windows platform config path. `phase4 verify --workspace E:\code\agent --json` returned `status=pass` with the same check set passing. | Re-run before final release packaging. |
| Linux shell | Pass | WSL Ubuntu was recovered with `wsl.exe --shutdown`. A user-local Linux Node `v24.13.1` tarball was installed under `/home/administrator/.local/soloclaw-node-v24.13.1`; `node -p "process.platform"` returned `linux`. With isolated `SOLOCLAW_HOME=/home/administrator/.cache/soloclaw-phase4-linux-smoke`, `npm run build`, `setup --mock`, `doctor --json`, `config path --json`, and `phase4 verify --json` all passed. `phase4 verify` reported platform `linux`, TypeScript runtime smoke pass, Rust runner warn/skip because cargo is not installed, and `secretMatches=0`. | Re-run on a fresh Linux host before release packaging. |
| macOS shell | Pending | No macOS host or macOS CI runner is available in the current workspace. | Run the matrix template on a real macOS host. |
| Android Termux | Pending | `adb devices` shows no attached Android device, and no Termux shell is available. | Connect a device or emulator with Termux, then run the matrix template inside Termux. |

Additional environment probes:

- Docker and Podman are not installed, so the Linux smoke used WSL Ubuntu instead of a Linux container.
- Git Bash is installed, but `node -p "process.platform"` reports `win32`; it is useful shell coverage but not a Linux platform-path smoke.
- Android SDK command-line tools are installed, but `C:\Android\Sdk\emulator\emulator.exe` is absent and `avdmanager list avd` reports no available Android Virtual Devices.

## External Smoke Capture

Use these scripts on the two remaining external targets. They write a local evidence directory that can be copied back into this repository or summarized in the matrix table. The scripts use `SOLOCLAW_HOME` under the evidence directory so global config, cache, logs, and mock model state do not disturb an existing user setup.

### macOS

Run from a checked-out copy of this repository on a real macOS shell:

```sh
set -eu
mkdir -p .agent/tmp/phase4-macos-smoke
export SOLOCLAW_HOME="$PWD/.agent/tmp/phase4-macos-smoke/soloclaw-home"
npm install 2>&1 | tee .agent/tmp/phase4-macos-smoke/01-npm-install.txt
npm run build 2>&1 | tee .agent/tmp/phase4-macos-smoke/02-build.txt
node dist/cli/index.js setup --mock --workspace "$PWD" 2>&1 | tee .agent/tmp/phase4-macos-smoke/03-setup.txt
node dist/cli/index.js doctor --workspace "$PWD" --json > .agent/tmp/phase4-macos-smoke/04-doctor.json
node dist/cli/index.js config path --json > .agent/tmp/phase4-macos-smoke/05-config-path.json
node dist/cli/index.js phase4 verify --workspace "$PWD" --json > .agent/tmp/phase4-macos-smoke/06-phase4-verify.json
node -e 'const fs=require("fs"); const v=JSON.parse(fs.readFileSync(".agent/tmp/phase4-macos-smoke/06-phase4-verify.json","utf8")); if(v.status!=="pass" || v.platform.id!=="macos") process.exit(1); console.log("phase4 macOS smoke pass");'
```

Record:

- Node and npm versions.
- `06-phase4-verify.json` status and platform id.
- Whether Rust runtime smoke passed or was skipped with a reason.
- Confirmation that no API key, bearer token, vault passphrase, or secret value was copied into the evidence.

### Android Termux

Run from a checked-out copy of this repository inside Termux:

```sh
set -eu
pkg install -y nodejs git ripgrep
mkdir -p .agent/tmp/phase4-termux-smoke
export SOLOCLAW_HOME="$PWD/.agent/tmp/phase4-termux-smoke/soloclaw-home"
npm install 2>&1 | tee .agent/tmp/phase4-termux-smoke/01-npm-install.txt
npm run build 2>&1 | tee .agent/tmp/phase4-termux-smoke/02-build.txt
node dist/cli/index.js setup --mock --workspace "$PWD" 2>&1 | tee .agent/tmp/phase4-termux-smoke/03-setup.txt
node dist/cli/index.js doctor --workspace "$PWD" --json > .agent/tmp/phase4-termux-smoke/04-doctor.json
node dist/cli/index.js config path --json > .agent/tmp/phase4-termux-smoke/05-config-path.json
node dist/cli/index.js phase4 verify --workspace "$PWD" --json > .agent/tmp/phase4-termux-smoke/06-phase4-verify.json
node -e 'const fs=require("fs"); const v=JSON.parse(fs.readFileSync(".agent/tmp/phase4-termux-smoke/06-phase4-verify.json","utf8")); if(v.status!=="pass" || v.platform.id!=="android-termux") process.exit(1); console.log("phase4 Termux smoke pass");'
```

Record:

- Termux version, Android device/emulator model if available, Node and npm versions.
- `06-phase4-verify.json` status, platform id, and path summary.
- Whether Rust runtime smoke passed or was skipped with a reason.
- Confirmation that no API key, bearer token, vault passphrase, or secret value was copied into the evidence.

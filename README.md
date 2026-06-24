# Agent Blueprint

TypeScript-first, Rust-later blueprint for a privately deployable professional coding agent platform.

The first milestone is a local agent loop that can:

1. receive a user task;
2. assemble workspace context;
3. call a model;
4. execute tool calls;
5. record tool results;
6. return a final answer.

## Quick Start

```bash
npm install
npm run dev
npm run dev -- doctor
npm run dev -- model setup --provider openai_compatible --base-url http://localhost:8000/v1 --model local-model --api-key-env LOCAL_LLM_API_KEY
```

Installed packages expose `soloclaw` as the primary command. `agent` remains a compatibility alias for existing scripts. Running `soloclaw` with no arguments opens the local terminal workspace:

```bash
soloclaw
soloclaw quickstart
soloclaw setup --wizard
soloclaw setup --workspace ../another-project --wizard
soloclaw setup
soloclaw setup --workspace ../another-project --mock
soloclaw setup --local --model local-model
soloclaw setup --ollama --model local-model
soloclaw setup local --model local-model
soloclaw setup --provider custom --base-url http://localhost:11434/v1 --model local-model --api-key-env LOCAL_LLM_API_KEY
soloclaw init
soloclaw init --local --model local-model
soloclaw init --provider openai_compatible --base-url http://localhost:8000/v1 --model local-model --api-key-env LOCAL_LLM_API_KEY
soloclaw init --provider custom --base-url http://localhost:11434/v1 --model local-model --api-key-env LOCAL_LLM_API_KEY
soloclaw tui
soloclaw ask "inspect this workspace"
soloclaw ask --workspace ../another-project "inspect this workspace"
soloclaw status
soloclaw smoke
soloclaw check
soloclaw doctor
soloclaw platform doctor
soloclaw providers
soloclaw workspace add .
soloclaw workspace list
soloclaw workspace use 1
soloclaw model list
soloclaw model env
soloclaw model check
soloclaw model local
soloclaw model use local
soloclaw model use mock
soloclaw config show
soloclaw phase4 verify
soloclaw phase4 matrix-template
soloclaw phase5 verify
agent remote register --control-url http://127.0.0.1:4317 --control-token local-dev-token
soloclaw room pull-agent <room-id> <agent-id>
agent remote invitations --control-url http://127.0.0.1:4317 --control-token local-dev-token
agent remote accept-room --control-url http://127.0.0.1:4317 --control-token local-dev-token --room <room-id>
agent remote run --control-url http://127.0.0.1:4317 --control-token local-dev-token --room <room-id> --cycles 20 --stop-when-idle --status-file .agent/tmp/remote-room-status.json
soloclaw phase5 matrix-template
soloclaw phase5 matrix-template --target linux-shell-agent
soloclaw phase5 evidence-plan
soloclaw phase5 collection-runbook --registered-pull-target linux-shell-agent
soloclaw phase5 collection-runbook --registered-pull-target linux-shell-agent --output phase5-collection-runbook.md
soloclaw phase5 collection-prepare --registered-pull-target linux-shell-agent
soloclaw phase5 registered-pull-operator-next --registered-pull-target linux-shell-agent
soloclaw phase5 registered-pull-evidence-patch --registered-pull-target linux-shell-agent --status-file .agent/tmp/phase5-registered-pull-status.json --pull-agent-file pull-agent.json --invitations-file invitations.json --accept-room-file accept-room.json --room-show-file room-show.json --delivery-status-file delivery-status.json
soloclaw phase5 collector-guide --target linux-shell-agent --registered-pull-target linux-shell-agent
soloclaw phase5 collector-guide --target linux-shell-agent --registered-pull-target linux-shell-agent --include-smoke-commands
soloclaw phase5 collector-pack
soloclaw phase5 collector-pack --target linux-shell-agent --registered-pull-target linux-shell-agent
soloclaw phase5 evidence-init
soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments
soloclaw phase5 evidence-template
soloclaw phase5 evidence-template --target linux-shell-agent
soloclaw phase5 evidence-check --file linux-fragment.json --target linux-shell-agent
soloclaw phase5 evidence-merge --file phase5-evidence.json --target-file linux-fragment.json --output phase5-evidence.merged.json
soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json
soloclaw phase5 evidence-check --file phase5-evidence.json
soloclaw --workspace ../another-project
```

`soloclaw quickstart` prints the shortest first-run checklist for the active workspace, with `soloclaw setup --wizard` as the easiest model setup path, plus local-model setup, environment-variable commands, model readiness check, and the first smoke task. A plain `soloclaw` opens the local terminal workspace and immediately shows the active workspace, model profile, model config path, readiness status, and next commands. `soloclaw setup --wizard` asks for provider, model, optional base URL, and API-key environment name, then writes the same editable JSON config as the explicit commands; choose `custom` and enter a URL for OpenAI-compatible providers that are not on the built-in list, or type `none` for the API-key environment when that local service does not require a key. `soloclaw setup --workspace <path> ...` initializes that target workspace from your current shell and records it as the active workspace. Global model config and workspace history use the Phase 4 platform path rules shown by `soloclaw platform doctor --json`; set `SOLOCLAW_HOME` to keep all global Soloclaw config/cache/log files under one directory. `soloclaw setup --local --model <model>` marks the current directory as the active workspace and writes the local OpenAI-compatible model profile in one step; `--ollama`, `--mock`, and `--custom` are shortcut flags for the same setup flow. `soloclaw init` marks the current directory as the active workspace and creates editable JSON config under the platform config path. `soloclaw workspace use <number|path>` marks another directory as the active workspace, so the next plain `soloclaw`, `soloclaw inspect`, `soloclaw doctor`, `soloclaw providers`, `soloclaw model|config`, and `soloclaw ask|run|plan|build|goal` use that workspace unless you pass `--workspace <path>`.

The short commands are aliases over the same local engine and JSON-backed configuration:

```bash
soloclaw providers --json
soloclaw init --provider openai --api-key-env OPENAI_API_KEY
soloclaw model setup local --model local-model
soloclaw model local
soloclaw model use local
soloclaw model setup custom --base-url http://localhost:11434/v1 --model local-model --api-key-env LOCAL_LLM_API_KEY
soloclaw model env custom
soloclaw model check
soloclaw inspect --workspace ../another-project --json
soloclaw smoke
soloclaw ask "explain this project"
soloclaw model setup --provider openai --api-key-env OPENAI_API_KEY
soloclaw model setup --provider openai_compatible --base-url http://localhost:8000/v1 --model local-model --api-key-env LOCAL_LLM_API_KEY
soloclaw config path
soloclaw config path --json
soloclaw platform doctor --json
soloclaw phase4 verify --json
soloclaw phase5 verify --json
agent remote register --control-url http://127.0.0.1:4317 --control-token local-dev-token --display-name builder --json
soloclaw room pull-agent room_xxxxxxxx agent_xxxxxxxx --alias builder --role executor --local-agent --json
agent remote invitations --control-url http://127.0.0.1:4317 --control-token local-dev-token --json
agent remote accept-room --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --json
agent remote run --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --cycles 20 --stop-when-idle --status-file .agent/tmp/remote-room-status.json --stop-file .agent/tmp/remote-room.stop --reply-template "@owner handled {messageId}" --json
soloclaw phase5 matrix-template --json
soloclaw phase5 matrix-template --target linux-shell-agent --json
soloclaw phase5 evidence-plan --json
soloclaw phase5 collection-runbook --registered-pull-target linux-shell-agent --json
soloclaw phase5 collection-runbook --registered-pull-target linux-shell-agent --output phase5-collection-runbook.md --force --json
soloclaw phase5 collection-prepare --registered-pull-target linux-shell-agent --json
soloclaw phase5 registered-pull-operator-next --registered-pull-target linux-shell-agent --json
soloclaw phase5 registered-pull-evidence-patch --registered-pull-target linux-shell-agent --status-file .agent/tmp/phase5-registered-pull-status.json --pull-agent-file pull-agent.json --invitations-file invitations.json --accept-room-file accept-room.json --room-show-file room-show.json --delivery-status-file delivery-status.json --json
soloclaw phase5 collector-guide --target linux-shell-agent --registered-pull-target linux-shell-agent --json
soloclaw phase5 collector-guide --target linux-shell-agent --registered-pull-target linux-shell-agent --include-smoke-commands --json
soloclaw phase5 collector-pack --json
soloclaw phase5 collector-pack --target linux-shell-agent --registered-pull-target linux-shell-agent --include-smoke-commands --json
soloclaw phase5 evidence-init --json
soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --json
soloclaw phase5 evidence-template --json
soloclaw phase5 evidence-template --target control-plane-host --json
soloclaw phase5 evidence-check --file control-fragment.json --target control-plane-host --json
soloclaw phase5 evidence-template --target linux-shell-agent --json
soloclaw phase5 evidence-check --file linux-fragment.json --target linux-shell-agent --json
soloclaw phase5 evidence-merge --file phase5-evidence.json --target-file linux-fragment.json --output phase5-evidence.merged.json --json
soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json
soloclaw phase5 evidence-check --file phase5-evidence.json --json
```

Phase 4A platform details, OS paths, optional Rust runner selection, and the manual Windows/Linux/macOS/Termux smoke matrix are documented in [docs/platform-support.md](docs/platform-support.md). The current cross-plan status ledger is [docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md](docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md).

Inside the terminal workspace:

```text
/quickstart
/setup
/setup --local --model local-model
/setup --ollama --model local-model
/setup local --model local-model
/setup --provider custom --base-url http://localhost:11434/v1 --model local-model --api-key-env LOCAL_LLM_API_KEY
/init
/init --local --model local-model
/init --provider custom --base-url http://localhost:11434/v1 --model local-model --api-key-env LOCAL_LLM_API_KEY
/ask inspect this workspace
/run inspect this workspace
/status
/check
/doctor
/inspect
/config
/config path
/providers
/model providers
/model
/model env
/model check
/model setup local --model local-model
/model setup openai_compatible --base-url http://localhost:8000/v1 --model local-model --api-key-env LOCAL_LLM_API_KEY
/model local
/model openai
/model use mock
/workspace
/workspace recent
/workspace 1
/workspace use 1
/workspace ../another-project
/exit
```

## Phase 1 Demo

The first deliverable is the local CLI project-reading agent. Run the local readiness check first:

```bash
npm run dev -- doctor
```

It verifies that the workspace snapshot can be collected, rendered for humans, exposed with bounded key-file previews, and injected into a mock local agent loop. The same check is available as structured output:

```bash
npm run dev -- doctor --json
```

The readiness output also prints the main first-run commands: `soloclaw quickstart`, `soloclaw init`, `soloclaw setup --wizard`, `soloclaw status`, `soloclaw smoke`, `soloclaw providers --json`, `soloclaw model env`, `soloclaw model check --json`, inspect commands, config commands, and a live-provider smoke command to run after setting an API key environment variable.

Then inspect the project context that the agent sees:

```bash
npm run dev -- inspect
npm run dev -- inspect --json
npm run dev -- inspect --include-key-files --max-key-files 3 --max-preview-lines 30
```

The mock provider keeps the demo free of external credentials:

```bash
npm run dev -- smoke
npm run dev -- ask "inspect this workspace"
```

For the live-provider smoke, set a provider key in the named environment variable and run one of the provider commands:

```bash
npm run dev -- ask --provider openai --api-key-env OPENAI_API_KEY "inspect this workspace"
npm run dev -- ask --provider deepseek --api-key-env DEEPSEEK_API_KEY "inspect this workspace"
```

Phase 1 is local CLI scope: it proves project reading, context assembly, provider routing, bounded local tools, sessions, approvals, audit, and usage reporting in local mode. The Web console is available for local control-plane inspection, but product-grade authenticated Web UI and distributed workers are later phases.

`agent inspect` prints the same compact read-only workspace snapshot that `agent run`, `agent plan`, and `agent goal` include by default, so project-reading tasks start with top-level files, a bounded directory outline, README/package metadata including `packageManager` and `engines`, Python `pyproject.toml` metadata including project name, `requires-python`, dependencies, and script entry points, Python `requirements.txt` metadata including requirement files and dependency names, Python `tox.ini` metadata including envlist and commands, Python `noxfile.py` metadata including sessions and commands, Rust `Cargo.toml` metadata including package name, version, edition, workspace members, and dependency names, Go `go.mod` metadata including module path, Go version, and dependency module names, Java Gradle metadata including build/settings files, root project name, included modules, and plugin IDs, Java Maven `pom.xml` metadata including project coordinates, packaging, and dependency coordinates, .NET metadata including SDK version, solution files, project SDK, target frameworks, and package references, Ruby `Gemfile` metadata including source, Ruby version, gem names, and groups, PHP `composer.json` metadata including package name, type, dependencies, dev dependencies, and scripts, Terraform metadata including configuration files, providers, resources, modules, variables, and outputs, Dockerfile metadata including base images, workdir, exposed ports, cmd, and entrypoint, Docker Compose metadata including compose files, services, images, build contexts, and ports, pre-commit metadata including repos, hook ids, and entries, ESLint configuration metadata including files, ignores, extends, plugins, rules, parser, source type, and ECMAScript version, Prettier configuration metadata including width, indentation, semicolon, quote, trailing comma, plugin, and override settings, Biome configuration metadata including file globs, formatter settings, linter settings, rule groups, and organize-imports mode, Next.js configuration metadata including output mode, dist/base paths, strict/trailing-slash flags, image settings, server external packages, and typed route experiments, Tailwind configuration metadata including content globs, dark mode, theme extensions, and plugins, PostCSS configuration metadata including plugins, parser, syntax, stringifier, and source map settings, Storybook configuration metadata including stories, addons, framework, and static directories, Vite configuration metadata including plugins, envDir, dev/preview server settings, and build output settings, Playwright configuration metadata including testDir, web server commands, base URLs, and projects, Vitest configuration metadata including environment, include/exclude globs, setup files, and coverage settings, Jest configuration metadata including test environment, test match globs, setup files, and coverage settings, Cypress configuration metadata including base URL, e2e/component spec patterns, support file, folders, and component dev server settings, Turborepo metadata including task names, task dependencies, inputs, outputs, cache flags, persistent flags, global dependencies, and environment mode, Nx metadata including scope, affected base, workspace layout, named inputs, target defaults, cache flags, and plugins, GitHub Actions metadata including workflow files, names, triggers, and job ids, Travis CI metadata including language, stages, and scripts, Bitbucket Pipelines metadata including pipelines, steps, and scripts, GitLab CI metadata including stages and top-level jobs, CircleCI metadata including workflows and jobs, Azure Pipelines metadata including stages and jobs, Jenkinsfile metadata including agent, stages, and shell steps, Makefile/Justfile/Taskfile metadata including targets, recipes, tasks, and commands, repository guidance files such as `AGENTS.md`, maintenance/process files such as `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `CODEOWNERS`, `LICENSE`, PR templates, and issue templates, bounded package script commands and workspace patterns, bounded child workspace package summaries from `package.json workspaces` or `pnpm-workspace.yaml` with script commands, file-type hints, detected languages/frameworks/test frameworks, monorepo/guidance/runtime/environment/CI/quality-tool hints, Node/Bun/Deno, Python uv/Poetry, Cargo, Go module, Java/Gradle/Maven, .NET, Ruby/Bundler, PHP/Composer, Terraform, Kubernetes, Helm, Prisma, Drizzle, SQL migration, Next.js, Tailwind/PostCSS, Storybook, OpenAPI/Swagger, GraphQL, devcontainer, runtime version manager, repository hygiene, and VS Code workspace signals, likely build/test/check commands, suggested files to inspect next, common docs entry points under `docs/`, common framework page/route entries, server entries, developer command files such as `Makefile`, `Justfile`, and `Taskfile.yml`, and safe Git status context before the model chooses deeper tool calls. Use `agent inspect --include-key-files` to append short previews of the suggested files, including workspace package manifests, repository guidance files, project process templates, project docs, API contract files such as OpenAPI/Swagger and GraphQL schemas/codegen configs, devcontainer and VS Code workspace configs, Node/Python/tool-version files such as `.nvmrc`, `.python-version`, `.tool-versions`, and `mise.toml`, Deno manifests, Python manifests and lockfiles, Rust/Go manifests and lock/checksum files, Java/Gradle/Maven manifests and wrappers, .NET solution/project files, Ruby Gemfiles/Rakefiles, PHP Composer/PHPUnit files, Terraform files, Kubernetes manifests, Helm charts, Prisma schemas, Drizzle configs, SQL migrations, Next.js, Tailwind/PostCSS configs, Vite, Storybook, Playwright, Vitest, Jest, and Cypress configs, runtime files, command runner files, repository hygiene files such as `.editorconfig`, `.gitignore`, and `.dockerignore`, quality configs such as ESLint/Prettier/Biome/Ruff/mypy/rustfmt/Clippy/golangci-lint, GitHub Actions workflow files, other CI configs, and safe env templates when present; real `.env*` contents are not previewed. Tune previews with `--max-key-files`, `--max-preview-lines`, and `--max-preview-chars`, or use `agent inspect --json` for a structured snapshot object plus rendered text. Task commands accept the same key-file preview flags when you want those previews injected into model context, and `--no-workspace-snapshot` starts from a bare prompt.

The structured snapshot also includes package entrypoint metadata from `package.json`, including `private`, `license`, `homepage`, `repository`, `publishConfig`, `main`, `module`, `types`, `browser`, `typesVersions`, `bin`, `exports`, `imports`, published `files`, `sideEffects`, `browserslist`, Volta toolchain pins, peer/optional dependency names, and npm/pnpm/Yarn dependency constraint keys from `overrides`, `pnpm.overrides`, and `resolutions`; standalone browser target files from `.browserslistrc` or `browserslist`; Node package manager configuration from `.npmrc`, including registries, scoped registries, common install settings, and redacted auth key names without auth values; Yarn configuration from `.yarnrc.yml`, including Yarn path, node linker, registries, scoped registries, plugins, common settings, and redacted auth key names without auth values; pnpm workspace metadata from `pnpm-workspace.yaml`, including package globs, default and named catalogs, catalog dependency names, and built-dependency allow/ignore lists; Bun configuration from `bunfig.toml`, including preload files, JSX settings, test preload/coverage settings, registry/scoped registry metadata, install settings, and redacted auth key names without auth values; Deno manifest metadata from `deno.json`/`deno.jsonc`, including tasks, task commands, imports, scopes, compiler options, and unstable feature flags; local runtime version metadata from `.nvmrc`, `.node-version`, `.python-version`, `.ruby-version`, `.tool-versions`, and `mise.toml`, including primary Node/Python/Ruby versions and tool-version mappings; EditorConfig formatting conventions from `.editorconfig`, including root mode, section globs, indentation, line endings, charset, trailing whitespace, final newline, and line length settings; plus root TypeScript compiler configuration metadata from `tsconfig.json`, including extends, target, module mode, module resolution, JSX mode, strict mode, root/output directories, emit/declaration/composite flags, path aliases, ambient types, libs, include/exclude globs, and project references.

The default provider is still `mock` for local smoke tests. Real HTTP providers are available through profiles:

```bash
npm run dev -- models setup --provider openai --api-key-env OPENAI_API_KEY
npm run dev -- models setup --provider deepseek --api-key-env DEEPSEEK_API_KEY
npm run dev -- models setup --provider openai_compatible --base-url http://localhost:8000/v1 --model local-model --api-key-env LOCAL_LLM_API_KEY
npm run dev -- model list --json
npm run dev -- model use openai_compatible
npm run dev -- config show --json
npm run dev -- ask --provider openai --api-key-env OPENAI_API_KEY "inspect this workspace"
npm run dev -- ask --provider deepseek --api-key-env DEEPSEEK_API_KEY "inspect this workspace"
npm run dev -- run --provider openai_compatible --base-url http://localhost:8000/v1 --api-key-secret sec_xxxxxxxx "inspect this workspace"
npm run dev -- run --require-model-ready --provider openai_compatible --base-url http://localhost:8000/v1 --api-key-env LOCAL_LLM_API_KEY "inspect this workspace"
npm run dev -- run --target-mode goal --model-call-budget 20 --model-circuit-break-after 3 "finish this bounded task"
npm run dev -- models usage --json
npm run dev -- models profiles set openai_compatible --base-url http://localhost:8000/v1 --model local-model --api-key-env LOCAL_LLM_API_KEY
```

Supported provider names are `openai`, `anthropic`, `gemini`, `kimi`, `grok`, `minimax`, `deepseek`, `glm`, `qwen`, `mimo`, `openai_compatible`, `anthropic_compatible`, and `mock`. In the TUI, `/model setup` opens a menu-style model setup flow with provider, base URL, model ID, and API key choices; pasted API keys are stored as encrypted local secret refs, while `.agent/model-providers.json` keeps only non-secret metadata. For first-run setup, `custom` maps to `openai_compatible`; `local` and `ollama` also map to `openai_compatible` and default to `http://localhost:11434/v1` unless you pass `--base-url`. `soloclaw model local`, `soloclaw model use local`, and TUI `/model local` select the same `openai_compatible` profile and persist the local base URL with no API key environment variable requirement.
Use `agent run|ask|plan|build|goal --require-model-ready ...` or `agent resume <session-id> --require-model-ready ...` when you want a real-model task to fail fast on missing base URL or API-key environment configuration before a session is opened or continued. The gate reuses the same metadata-only readiness view as `soloclaw model check`; `--api-key-secret` counts as a configured key reference without printing the secret id or value.
Provider profile overrides are stored in `.agent/model-providers.json` and contain only non-secret metadata such as protocol, base URL, default model, the default provider, API key environment variable names, and optional `apiKeySecretRef` identifiers. You can edit this JSON by hand:

```json
{
  "version": 1,
  "defaultProvider": "openai_compatible",
  "profiles": {
    "openai_compatible": {
      "name": "openai_compatible",
      "protocol": "openai_chat",
      "defaultBaseUrl": "http://localhost:8000/v1",
      "defaultModel": "local-model",
      "apiKeyEnvNames": ["LOCAL_LLM_API_KEY"],
      "apiKeySecretRef": "sec_xxxxxxxx"
    }
  }
}
```

## Current Local MVP Highlights

This repository is now a local-first TypeScript MVP, not only a skeleton. The current implementation includes:

- `plan`, `build`, and `goal` execution modes.
- SQLite-backed sessions, resume state, messages, tool calls, approvals, audit events, rooms, workers, assignments, specifications, knowledge records, artifacts, retention policies, skills, memory, and session summaries.
- Policy-gated workspace tools, file-level write locks, approval replay/resume including local worker-backed continuation, signed audit bundle export, and local execution hygiene checks.
- Provider profiles, encrypted API-key secret refs, transient retries, fallback providers, model-call budget/circuit guards, metadata-only `model.called` audit, `models usage` summaries, and session-level model usage in report/result/status/review/bundle views.
- Local secret vault and policy secret broker.
- Sub-agent child sessions, room-linked delegation, persistent skills/memory, session compaction, context-window-aware request preflight compaction with optional percentage threshold, CLI/env threshold controls, optional model-generated rolling checkpoint summaries across resumed runs, provider-overflow one-shot compaction retry, and lifecycle deletion.
- Agent rooms with invite tokens, signed messages, signed remote message-intent envelopes, observer roles, capability checks, mention-based wake-up routing, aliases/handles, routing diagnostics, remote inbox/say/ack/poll/run, remote run template replies, workspace-local remote-run status and stop files, token-safe remote runner service plans, remote enrollment, registered-agent pull communication evidence, one-file invite-bundle bootstrap evidence, revoked-invite admission checks, agent trust revocation through CLI/Web control-plane APIs, revoked-agent signed operation rejection checks, suspended-member routing/send denial checks, stale-agent health detection and `agents recover-stale` suspension/offline recovery, agent health, token-gated and room-filterable `/api/events` control-plane action plus safe `room.message.sent` event stream evidence, room-linked assignment/result and conflict-resolution transcript evidence, `soloclaw phase5 verify` local remote-room smoke evidence, `soloclaw phase5 matrix-template` cross-machine/four-target smoke and stop-marker commands, and `soloclaw phase5 evidence-check` for paste-safe real-machine matrix evidence.
- Token-gated local Web UI/control-plane bridge through `agent web`.
- Worker registry, signed heartbeat and lease envelopes, local broker adapter, scheduler loop, retry recovery, drain flow, and worker health summaries.
- Native spec workflow for goal mode: specs, tasks, dependencies, versions, diffs, generated plans, approval gates, clarifications, verification evidence, delegation, and worker dispatch.
- Knowledge RAG MVP with source/chunk ingestion, keyword retrieval, ACL filtering, safety modes, citation IDs, eval sets/runs, trend reports, and threshold gates.
- Plugin command manifests plus MCP server registry/planning and a policy-gated local stdio/HTTP MCP execution path for capability listing, low-risk tool calls, resource reads, approval continuation, and health diagnostics with bounded/redacted outputs.
- GitHub/GitLab dry-run PR/MR preparation with optional policy-checked local branch/commit/push.

Most of these capabilities are still local-mode implementations backed by SQLite, local files, local tokens, and foreground processes. See the replacement ledger before treating any local MVP path as production infrastructure.

## Product Mainline

Soloclaw's long-term product path is:

```text
soloclaw terminal entry
  -> local workspace agent with simple model configuration
  -> long-running local agent with daemon-ready lifecycle
  -> Windows/Linux/macOS/Android terminal builds
  -> room control plane for multiple machines
  -> agents join rooms, exchange routed messages, run assigned work, and report health/results
  -> native Windows/macOS desktop apps and Android companion/native app surfaces
  -> private distributed platform with production storage, auth, broker, sandboxing, and real-time UI
```

The primary product surface is the terminal/TUN experience. Each iteration should keep `soloclaw` easy to start, configure, inspect, and connect to a room before adding secondary surfaces. The first cross-platform targets are Windows PowerShell/CMD, Linux shells, macOS shells, and Android through Termux. Android native app work comes after the CLI/TUI protocol, config paths, daemon lifecycle, and room-control model are stable.

Native applications are planned as later product surfaces, not separate execution engines. Windows and macOS desktop apps should wrap the same local/room control plane for workspace selection, model configuration, task status, approvals, logs, health, and updates. The Android app starts as a room companion for monitoring, notifications, approvals, guided actions, and optional local-agent lifecycle control; deeper phone automation remains gated by the Phase 6 safety model.

Distributed collaboration is hub-and-room first. One control plane hosts rooms, identity registration, routed inboxes, signed message intents, signed acknowledgements, heartbeats, and operator state. Agents on Windows, Linux, macOS, and Android enroll into that control plane and wake only for routed room messages, assigned tasks, or explicit watcher roles. The intended experience is natural cross-device collaboration through the same room protocol, regardless of which supported OS an agent runs on. Direct peer-to-peer networking and NAT traversal are later optimizations, not the first distributed design.

Runtime integration rule: TS and Rust should be product-aggregated but runtime-decoupled. `soloclaw` remains one product and this repository remains one coordinated workspace, while Rust code enters through stable process/runtime contracts such as `WorkspaceRuntime` JSON-RPC instead of native bindings or a second orchestration stack. MCP stays the external capability protocol; Protobuf is a later transport encoding option, not a competing runner contract.

Android is split into two product tracks. The Termux track is a CLI/TUI room agent: it can join rooms, run model-backed tasks, send signed acknowledgements and heartbeats, and operate on explicitly available files, network APIs, and commands. The native companion track is for room monitoring, notifications, approvals, and guided user actions. Soloclaw does not treat autonomous third-party App control, checkout, payment, CAPTCHA handling, or security-prompt bypass as a default Android deliverable. Any phone UI automation must be explicit, user-approved, reversible where possible, and separated from payment or irreversible commerce confirmation unless a compliant first-party API and human confirmation are available.

## Usability Levels

The blueprint treats "usable agent" as four explicit maturity levels:

1. Local CLI agent for reading and inspecting projects.
   - Target user: one developer on one machine.
   - Done means `soloclaw` opens the local terminal workspace, `soloclaw ask|doctor|model|config` cover everyday use, `agent inspect` can show the project context that `agent run|plan|goal` will see, and task commands can assemble workspace context, call a real provider, use bounded local tools, preserve sessions, surface approvals, and record audit/model usage through the CLI.
   - Current state: Phase 1 local CLI deliverable implemented. Run `soloclaw doctor` or `agent phase1 verify` for local readiness and the printed live-provider smoke command after setting an API key env.
2. Long-running local coding agent for real repositories.
   - Target user: a developer willing to let the agent make supervised changes over longer tasks.
   - Done means the agent can plan, edit, test, pause/resume, handle approvals, show diffs and operator state, recover from interrupted work, use worker/scheduler loops, expose daemon-ready status/logs, and keep enough audit/context history to continue safely.
   - Current state: Phase 2 local alpha deliverable implemented for the documented sample-repository engineering flow; unified-diff `apply_patch` now has workspace-boundary validation, file locks, file-change records, command audit, command timeout/duration evidence, local command execution profile metadata, file-level diff stats, file summaries, and aggregate review profiles, `agent run --json --session-result --verify-session` for end-to-end session evidence, `agent run|ask|plan|build|goal --require-model-ready` and `agent resume --require-model-ready` for fail-fast real-model configuration gating before session creation or continuation, `agent resume --json --session-result --verify-session` for resumed-session evidence, `agent plan|build|goal --json --session-result --verify-session` for target-mode evidence, `agent approve <approval-id> --queue-resume <worker-id>` for worker-backed approval continuation after approved-tool replay, TUI `/approvals` / `/approve` / `/deny` for scoped manual approval decisions that record `tool.approved` / `tool.denied` audit events, `agent sessions --json --limit n` for a local session dashboard with per-session outcome, pending approvals, handoff state/next command, command/change counts, latest timeline, and review/result/next commands, `agent local status --json` / `soloclaw agent status --json` for a daemon-ready local agent snapshot across sessions, workers, assignments, approvals, scheduler/worker poll readiness, queue depth, active leases, capacity, a structured daemon runbook, and a metadata-only daemon service plan, `agent local logs --json` / `soloclaw agent logs --json` for a safe merged local execution log, `agent workers poll` and `agent scheduler run` for foreground daemon-loop lifecycle/metrics evidence, `agent session diff <session-id>` / token-gated `GET /api/sessions/:sessionId/diff` for persisted patch inspection, `agent session report <session-id> --json` / token-gated `GET /api/sessions/:sessionId/report` for consolidated engineering evidence including approvals, timed-out commands, command execution profiles, diff stats, file summaries, review profiles, and session-scoped model-call usage, `agent session status <session-id>` for daemon-ready status snapshots including operator next-action counts, handoff summary, inspection summary, and model-call counts, `agent session inspect <session-id>` / TUI `/session inspect <session-id>` / token-gated `GET /api/sessions/:sessionId/inspect` for a focused inspection state/issues/focus-path/next-action view shared by CLI, TUI, and the local control plane, the Web console Sessions list can open that inspection document as issue, next-action, and follow-up command rows, `agent session timeline|logs <session-id>` for ordered audit/file-change/approval logs, `agent session review <session-id>` for a single operator review package across checklist, changes, handoff summary, inspection summary, commands, approvals, diff stats, file summaries, review profiles, model-call counts, latest timeline, and next actions, `agent session result <session-id>` for a human-readable outcome/recovery/change/approval/timeout/profile/diff-stat/file-summary/review-profile/model-usage/inspection/handoff/next-action report, `agent session next <session-id>` / TUI `/session next <session-id>` / token-gated `GET /api/sessions/:sessionId/next` for a focused handoff/inspection/next-action command view shared by CLI, TUI, and Web, `agent session verify <session-id>` for machine-checkable engineering gates including required execution profiles, diff stats, review profiles, no-pending-approval handoff checks, and successful model-call evidence via `--require-model-call`, `agent session bundle <session-id> --json --output .agent/tmp/session-bundle.json` for an exportable diff/report/status/timeline/review/result/local-status/local-logs/verification evidence package with model usage, inspection, handoff, and next actions, and `agent phase2 verify --json --cleanup` for local failed-test recovery, mock agent-loop repair, workspace-write/dependency/Git/high-risk-shell approval boundaries, run-session, target-mode, and mock-repair model-call gate evidence, timeout/profile/diff-stat/file-summary/review-profile/timeline/status/session-list/session-inspection/session-inspect-command/session-next-command/control-plane-session-diff/control-plane-session-report/control-plane-session-inspection/control-plane-session-next/control-plane-session-timeline/local-agent-status/daemon-readiness/local-agent-runbook/local-daemon-service-plan/local-agent-logs/foreground-daemon-lifecycle/review/bundle/handoff/next-action evidence, diff/report/result/verification/run-session/resume/queued-approval-continuation/queued-approval-retry-backoff/TUI-approval-decision/pending-approval-gate-failure/no-pending-approval-handoff-gate/target-mode evidence, and pause/resume/cancel lifecycle smoke. The remaining production gaps are stronger execution isolation beyond local policy/audit profiles, managed daemon service installation/supervision, smoother real-model task driving, production broker-grade distributed approval retries beyond the local retry/backoff evidence, richer generated diff/result inspection, and richer real-time Web/TUI inspection.
   - Latest Phase 2 daemon UX increment: `agent local status --json` now includes a structured daemon `lifecyclePlan` and metadata-only `servicePlan`, while `agent local service --json` / `soloclaw agent service --json` / TUI `/agent service` expose the service plan directly. The plan names the platform service manager shape, foreground scheduler/worker entrypoints, health/log commands, readiness, blocked steps, and plan-only supervision policy; `agent phase2 verify --json --cleanup` records this as `local-daemon-lifecycle-plan-evidence` and `local-daemon-service-plan-evidence`. Managed service installation and production supervision are still future work.
   - Latest Phase 2 diff/result inspection increment: completed patch evidence now produces a structured `inspectionPlan` across `agent session diff`, `session report`, `session status`, `session review`, `session result`, and `session bundle`, ranking changed files with focus paths, review reasons, and follow-up commands; `agent phase2 verify --json --cleanup` records this as `session-diff-inspection-plan-evidence`.
   - Latest Phase 2 Web diff increment: token-gated Web `GET /api/sessions/:sessionId/diff` now exposes persisted patch text, diff stats, file summaries, review profile, inspection plan, changed paths, and follow-up commands; the Web Sessions panel can open it from Diff, and `agent phase2 verify --json --cleanup` records this as `control-plane-session-diff-evidence`.
   - Latest Phase 2 Web report increment: token-gated Web `GET /api/sessions/:sessionId/report` now exposes the same consolidated session evidence used by `agent session report`, including approvals, command events, tool results, diff stats, file summaries, review profile, inspection plan, and model-call usage; the Web Sessions panel can open it from Report, and `agent phase2 verify --json --cleanup` records this as `control-plane-session-report-evidence`.
   - Latest Phase 2 Web verification increment: token-gated Web `GET /api/sessions/:sessionId/verify?preset=handoff` now reuses the same session evidence gate as `agent session verify`, including required change, patch, recovery, timeout, diff-stat, review-profile, execution-profile, approval-action, model-call, no-pending-approval, and command checks; the Web Sessions panel can open it from Verify, and `agent phase2 verify --json --cleanup` records this as `control-plane-session-verification-evidence`.
   - Latest Phase 2 Web bundle increment: token-gated Web `GET /api/sessions/:sessionId/bundle?preset=handoff&limit=n` now returns a Web-oriented evidence package across diff, report, status, timeline, review, result, and verification sections, with a Sessions panel Bundle action and `agent phase2 verify --json --cleanup` coverage as `control-plane-session-bundle-evidence`.
   - Latest Phase 2 Web inspection refresh increment: the Web Session Inspect panel now keeps the active session view kind for status, result, diff, report, verify, bundle, inspect, next, timeline, and review, and the panel Refresh action reloads the same token-gated endpoint instead of forcing operators back through the session list; `agent phase2 verify --json --cleanup` records this as `control-plane-session-refresh-ui-evidence`.
   - Latest Phase 2 Web mutation refresh increment: Web approval decisions and session pause/resume/cancel actions now refresh any loaded session dashboard and reload the active session detail view when it belongs to the changed session; `agent phase2 verify --json --cleanup` records this as `control-plane-session-mutation-refresh-ui-evidence`.
   - Latest Phase 2 Web live refresh increment: the Web Session Inspect panel now has an optional `Live` toggle; when enabled, the existing `/api/state` poll also refreshes any loaded session dashboard and the active session detail view while leaving the default lightweight polling behavior unchanged. `agent phase2 verify --json --cleanup` records this as `control-plane-session-live-refresh-ui-evidence`.
   - Latest Phase 2 CLI/TUI handoff preset increment: CLI `agent session verify <session-id> --preset handoff`, TUI `/session verify <session-id> --preset handoff`, and `agent session bundle <session-id> --preset handoff` now reuse the same handoff preset as the local Web `verify?preset=handoff` endpoint, expanding required evidence gates from persisted session state for operator handoff.
   - Latest Phase 2 TUI handoff increment: TUI `/sessions [--json] [--limit n] [--status status] [--target-mode mode]` now renders the same recent-session dashboard as CLI `agent sessions`, TUI `/session report <session-id> [--json]` renders the same consolidated engineering evidence as CLI `agent session report`, TUI `/session verify <session-id> [verification options]` runs the same persisted evidence gate as CLI `agent session verify`, and TUI `/session bundle <session-id> [--json] [--output path] [--limit n] [verification options]` exports the same diff/report/status/timeline/review/result/local-status/local-logs/verification evidence package as CLI `agent session bundle`, including workspace-local JSON output for handoff.
   - Latest Phase 2 TUI session watch increment: TUI `/session watch <session-id> [status|inspect|next|review|timeline] --ticks n --interval-ms n` repeats a bounded session drilldown from the current workspace, so operators can watch status/inspection/timeline changes without leaving `soloclaw`; `agent phase2 verify --json --cleanup` records this as `tui-session-watch-evidence`.
   - Latest Phase 2 TUI sessions watch increment: TUI `/sessions watch --ticks n --interval-ms n [--limit n] [--status status] [--target-mode mode]` repeats the shared recent-session dashboard as a bounded foreground view, so operators can watch queue/outcome changes without opening a background watcher; `agent phase2 verify --json --cleanup` records this as `tui-sessions-watch-evidence`.
   - Latest Phase 2 operator TUI increment: TUI `/operator status [--json] [--rows] [--kind kind] [--status status] [--severity severity] [--id id] [--details] [--public] [--actor actor] [--limit n]` and `/operator show <item-id-or-ref-id> [--select n] [--json]` reuse the shared control-plane operator view, row filters, public/diagnostic projection, and linked detail builder already used by CLI and Web.
   - Latest Phase 2 next-action UX increment: `agent session next <session-id> [--json]`, TUI `/session next <session-id> [--json]`, and token-gated Web `GET /api/sessions/:sessionId/next` expose a focused handoff/inspection/next-action view for fast operator continuation, including review/status/inspect/timeline/verify follow-up commands; `agent phase2 verify --json --cleanup` records this as `session-next-evidence` and `control-plane-session-next-evidence`.
   - Latest Phase 2 Web dashboard increment: token-gated Web `GET /api/sessions` now exposes the shared session dashboard on demand, including `limit`, `status`, and `targetMode` filters, per-session outcome, pending approvals, handoff state/next command, command/change counts, next actions, and follow-up commands without adding the heavier dashboard work to `/api/state` polling; the Web Sessions panel can load the same filtered dashboard, and `agent phase2 verify --json --cleanup` records this as `control-plane-session-dashboard-evidence`.
   - Latest Phase 2 Web status increment: token-gated Web `GET /api/sessions/:sessionId/status?limit=n` now exposes a shared lightweight session status package with outcome, command/change counts, handoff state, inspection state, next actions, latest timeline rows, and follow-up commands; the Web Sessions panel can open it from Status, and `agent phase2 verify --json --cleanup` records this as `control-plane-session-status-evidence`.
   - Latest Phase 2 Web timeline increment: token-gated Web `GET /api/sessions/:sessionId/timeline?limit=n` now reuses the shared safe session timeline view, and the Web Sessions panel can open ordered audit, file-change, approval, and approval-decision rows beside inspection and next-action views; `agent phase2 verify --json --cleanup` records this as `control-plane-session-timeline-evidence`.
   - Latest Phase 2 Web review increment: token-gated Web `GET /api/sessions/:sessionId/review?limit=n` now exposes a shared lightweight session review package with checklist, changed paths, handoff state, next actions, latest timeline rows, and follow-up commands; the Web Sessions panel can open it from the new Review action, and `agent phase2 verify --json --cleanup` records this as `control-plane-session-review-evidence`.
   - Latest Phase 2 Web result increment: token-gated Web `GET /api/sessions/:sessionId/result` now exposes a shared lightweight result package with outcome, recovery, command results, changed paths, approvals, handoff state, inspection state, next actions, and follow-up commands; the Web Sessions panel can open it from Result, and `agent phase2 verify --json --cleanup` records this as `control-plane-session-result-evidence`.
   - Latest Phase 2 approval retry increment: queued approval continuation now records a retry/backoff smoke where an approved resume assignment expires, is rescheduled with `retryDelayMs` / `retryNotBefore`, is skipped by the worker until due, appears as `retry_delayed` in operator queue and assignment views, and completes after the retry becomes due; `agent phase2 verify --json --cleanup` records this as `queued-approval-retry-backoff-evidence`.
   - Latest Phase 2 Rust handoff increment: `agent phase2 verify --json --cleanup` now records `workspace-runtime-jsonrpc-rust-smoke` evidence by building the real Rust `agent-runner`, starting it over newline-delimited JSON-RPC stdio, and comparing `WorkspaceRuntime` read/write/patch/command behavior with `LocalWorkspaceRuntime`; it also records `workspace-runtime-jsonrpc-rust-tools-policy-audit` evidence proving the Rust-backed runtime still flows through TypeScript workspace tools, policy approval, file-change records, `tool.*` audit events, and `command.*` audit events. The JSON evidence includes covered method count, patch operations, `.git`/`.agent` protected-path rejections, `.agent/tmp` allowance, command exit, tool/command audit counts, file-change paths, policy/approval actions, and skipped/toolchain status.
3. Cross-machine room collaboration alpha.
   - Target user: one person or team running agents on Windows, Linux, macOS, and Android Termux machines.
   - Done means agents can enroll into a room control plane, join by invite or allowlist, receive routed room tasks, post transcript replies, submit signed acknowledgements and heartbeats, expose health/operator state, and run foreground or daemon remote loops without loading the entire room transcript.
   - Current state: local room/remote alpha supports invite enrollment, registered-agent pull/accept invitations with routed-message signed ack/reply evidence, one-file invite-bundle bootstrap with token-safe runner status evidence, token-gated Web invite-bundle generation through `POST /api/rooms/<room-id>/invite-bundle`, local `web-invite-bundle` verifier coverage for valid signed bundle shape plus `/api/state` and audit token-safety, revoked-invite admission rejection, `agents trust` / `POST /api/agents/:agentId/trust` trust-state updates, revoked-agent rejection for old signed message-intent, delivery-ack, and heartbeat envelopes, suspended-member routing/send denial, routed inbox, signed ack/heartbeat/message-intent replies, expired-heartbeat stale-agent health detection, stale-agent recovery through `agents recover-stale` / `POST /api/agents/recover-stale` that suspends the room member and marks heartbeat `offline`, foreground run loops, token-safe plan-only remote runner service plans through `agent remote service --json`, template reply smoke, workspace-local runner status/stop files with last-heartbeat and lifecycle summaries, health views, token-gated `/api/events` control-plane action, safe `room.message.sent`, safe `room.delivery.acknowledged` streaming with `session`, `room`, `agent`, and `type` filters, paste-safe `/api/rooms/<room-id>/delivery-status` per-agent pending/ack summaries, and `soloclaw phase5 verify --json` for a local HTTP control-plane exchange with two distinct remote-agent workspaces in one room, including local `room-assignment-result` evidence for a completed room-linked delegation assigned to an enrolled remote agent and local `room-handoff` evidence for source/target remote agents recording request, acceptance, and completion messages; `soloclaw phase5 evidence-check --file <path> --json` now also gates real-machine matrix evidence on per-target `one-file-room-bootstrap-evidence`, revoked-invite join rejection, `room.revokedAgent` signed-operation rejection, suspended-agent block evidence, control-plane event stream evidence including `room.message.sent` and `room.delivery.acknowledged` message-id summaries, control-plane delivery-status evidence with zero pending routed messages, `room.staleAgent` health evidence with `healthState: "stale"`, `heartbeatExpired: true`, and `responsive: false`, `room.staleRecovery` evidence with `memberStatusAfter: "suspended"` and `healthStateAfter: "offline"`, per-target `remote-service-plan-evidence`, per-target idle runner status summaries with last-heartbeat and lifecycle metrics, `room.assignmentResult` transcript evidence for a completed room-linked delegation, `room.conflictResolution` transcript evidence for two conflicting remote artifact messages plus one decision resolution, `room.resultSync` evidence for a remote result file copied to the control workspace, registered as a room artifact, and announced in the room transcript, `room.handoff` evidence for one remote agent handing work to another joined remote agent with request/acceptance/completion transcript messages, one stop-file `shutdown_requested` summary, operator-visible transcript, `/api/state` room, `/api/agents/health`, and room delivery-status coverage for every remote agent. Cross-platform packaging, managed daemon installation/supervision, stronger auth/key rotation, production broker-grade streaming, and end-to-end multi-machine soak tests remain.
   - Latest Phase 5 security increment: `agents rotate-key` / `POST /api/agents/:agentId/rotate-key` rotate a registered remote public key while preserving trust state and audit history; `soloclaw phase5 verify --json` now exercises a local `room-key-rotation` probe, and the manual matrix records `room.keyRotation` evidence for changed fingerprints, old-signature rejection, replacement-key message acceptance, and audit visibility.
   - Latest Phase 5 evidence increment: the manual matrix and `soloclaw phase5 evidence-check --file <path> --json` now require `room.registeredAgentPull` evidence for the control-host pull path: remote register, room pull-agent, invitation listing, accept-room, routed task handling through `remote run`, signed ack, signed reply, idle heartbeat, idle stop, and zero pending delivery.
4. Product-grade private agent platform.
   - Target user: a private team running authenticated users, remote agents, and distributed workers.
   - Done means production storage, migrations, auth/RBAC, policy service, broker/event stream, supervised daemons, sandboxed runners, object storage, production Git provider integrations, real-time UI, observability, backups, and upgrade paths are in place.
   - Current state: architecture and local contracts are established, but production replacements remain.

## Layout

```text
src/
  cli/          CLI entry
  core/         agent loop, events, context
  model/        model abstraction and providers
  protocol/     shared request/result types
  tools/        tool definitions and runtime
  workspace/    workspace boundary, local runtime, and JSON-RPC adapter
  mcp/          MCP registry, planner, and local runtime boundary

crates/
  agent-runner/   Rust JSON-RPC command-runner scaffold
  agent-indexer/  future Rust symbol/search indexer
  agent-diff/     Rust unified-diff patch engine scaffold
```

## Roadmap

- Phase 1: Local usable version.
  - Goal: `soloclaw` opens an agent work interface from PowerShell or a terminal, with workspace selection, model configuration, TUI, basic commands, task entry, configuration checks, and safety confirmations.
  - Accepted when `soloclaw`, `soloclaw quickstart`, `soloclaw setup --wizard`, `soloclaw doctor`, `soloclaw ask`, `soloclaw model`, `soloclaw config`, and `soloclaw smoke` work from a clean local workspace with mock-provider smoke coverage.
  - Runtime boundary: keep execution in the TypeScript local runtime while preserving the `WorkspaceRuntime` interface; do not introduce Rust as a required first-run dependency.
  - Closure gate: clean-workspace demo plus `npm run build`, `npm run check`, `npm test`, model JSON/config proof, mock task smoke, and Phase 1 security acceptance.
  - Current boundary: `agent phase1 verify --json` is the local readiness gate; a live-provider smoke with a real configured provider remains a release-before-shipping manual verification item.
- Phase 2: Engineering execution capability.
  - Goal: the agent can handle real code-project work by reading the project, planning, editing files, running tests, showing diffs, recovering from failures, and persisting task state.
  - Accepted when a sample repository code-change flow proves plan/build/goal task execution, diff/result inspection, pause/resume/cancel, failed-test recovery, and session/audit state.
  - Current local-alpha delivery smoke: `agent phase2 verify --json --cleanup` creates disposable sample repos, observes a failing test, records a timed-out command with local execution profile metadata, applies a unified diff patch, reruns the test, verifies persisted `sessions` / `session diff` / `session report` / `session status` / `session inspect` / `session next` / `session timeline` / `session review` / `session result` / `session verify` / `session verify --preset handoff` / `session bundle` evidence including file-level diff stats, file summaries, aggregate review profiles, model-call usage, local status/log snapshots, daemon runbook steps, daemon service-plan steps, foreground scheduler-run lifecycle/metrics, inspection command output, next-action command output, control-plane diff output, control-plane inspection output, control-plane next-action output, control-plane status output, control-plane timeline output, control-plane review output, operator handoff summaries, and operator next actions, exercises end-to-end `agent run`, `agent resume`, queued approval continuation through a local worker including retry/backoff visibility after an expired continuation lease, TUI approval list/approve/deny decisions with `tool.approved` / `tool.denied` audit evidence, TUI `/operator status` / `/operator show` shared operator-view evidence, TUI `/session watch` drilldown evidence, TUI `/sessions watch` dashboard evidence, plus a failing `--require-no-pending-approvals` gate while policy approvals remain pending and a passing handoff gate after approvals are resolved, and plan/build/goal target-mode session evidence paths, drives a mock agent-loop repair through real `run_command` / `apply_patch` / `run_command` tools, proves workspace-write/dependency-install/Git-mutation/high-risk-shell policy approval boundaries, covers fail-fast `--require-model-ready` real-model configuration gating for new and resumed sessions, runs pause/resume/cancel lifecycle smoke, and returns session-scoped file-change/audit/approval/timeout/profile/diff-stat/file-summary/review-profile/model-call-gate/timeline/status/session-list/session-inspection/session-inspect-command/session-next-command/session-handoff-preset-verification/control-plane-session-diff/control-plane-session-inspection/control-plane-session-next/control-plane-session-status/control-plane-session-timeline/control-plane-session-review/local-agent-status/daemon-readiness/local-agent-runbook/local-daemon-service-plan/local-agent-logs/foreground-daemon-lifecycle/review/bundle/handoff/next-action/queued-approval-retry-backoff/tui-session-watch/tui-sessions-watch evidence with target-mode and mock-repair model-call gate coverage and `phaseClosure: "local_alpha_deliverable"`.
  - Current Web verification smoke: `agent phase2 verify --json --cleanup` now also checks token-gated local Web `GET /api/sessions/:sessionId/verify?preset=handoff` and the Web-oriented `GET /api/sessions/:sessionId/bundle?preset=handoff&limit=n`, records `control-plane-session-verification-evidence` and `control-plane-session-bundle-evidence`, and verifies the returned handoff preset, required engineering checks, execution-profile evidence, approval-action evidence, bundle sections, timeline count, and follow-up session commands.
  - Current daemon lifecycle plan: `agent local status [--json]` derives a safe operator plan from persisted workers, assignments, approvals, scheduler readiness, and runbook data, so the local daemon view exposes whether the operator should resolve attention, register a worker, run scheduler/worker loops, keep a worker on standby, or stay idle. `agent local service [--json]`, `soloclaw agent service [--json]`, and TUI `/agent service` expose the derived daemon service plan directly: platform manager shape, service name, foreground entrypoints, health/log commands, readiness, blocked steps, and a plan-only supervision policy.
  - Current diff view: `agent session diff <session-id> [--json]`, TUI `/session diff <session-id> [--json]`, and local Web `GET /api/sessions/:sessionId/diff` extract successfully completed `apply_patch` unified diffs from session audit, map them to changed paths, report per-file additions/deletions plus change type, patch count, review size, review hint, aggregate review profile, and a priority-ordered inspection plan, and show the applied patch text for review.
  - Current Rust handoff boundary: `JsonRpcWorkspaceRuntime` can call a newline-delimited JSON-RPC 2.0 worker over stdio using the exported `workspace-runtime-jsonrpc.v1` schema, `crates/agent-runner` provides the first Rust worker scaffold, and `crates/agent-diff` now backs the runner's guarded `workspace/applyPatch` path for create/modify/delete unified diffs. The compatibility smoke starts the real Rust runner and compares read/write/patch/command behavior plus protected-path rules against `LocalWorkspaceRuntime`; a second tools/policy/audit smoke wraps that same Rust runtime in `createWorkspaceTools` and `withPolicy` to prove file-change, tool-audit, command-audit, and approval evidence stay in the TypeScript governance path. `agent phase2 verify --json --cleanup` records these as `workspace-runtime-jsonrpc-rust-smoke` and `workspace-runtime-jsonrpc-rust-tools-policy-audit`. MCP remains the external tool/capability protocol; Protobuf is reserved as a future transport encoding if runner traffic needs binary schemas or higher throughput.
  - Runtime boundary: all Rust runner work must remain behind `WorkspaceRuntime` compatibility tests; do not add a second tool execution API beside the TS tools/policy/audit path.
  - Current evidence view: `agent session report <session-id> [--json]`, TUI `/session report <session-id> [--json]`, and local Web `GET /api/sessions/:sessionId/report` summarize messages, tool results, file changes, changed paths, command audit, command durations/timeouts, command execution profiles, diff stats, file summaries, aggregate review profile, inspection plan, approvals, failed tools, failed commands, and metadata-only model usage for a persisted session.
  - Current session dashboard: `agent sessions [--json] [--limit n] [--status status] [--target-mode mode]`, TUI `/sessions [--json] [--limit n] [--status status] [--target-mode mode]`, and token-gated local Web `GET /api/sessions?limit=n&status=status&targetMode=mode` list recent sessions with outcome, pending approvals, handoff state/next command, command/change counts, latest safe timeline entries in CLI/TUI, and follow-up review/result/next commands.
  - Current local agent status: `agent local status [--json] [--limit n]`, `soloclaw agent status [--json] [--limit n]`, and TUI `/agent status` summarize local daemon-ready state across recent sessions, pending approvals, workers, assignments, queue load, scheduler/worker poll readiness, active leases, capacity, next commands, a structured runbook for required/recommended/blocked daemon actions, and a plan-only daemon service plan; TUI `/approvals [status]`, `/approve <approval-id> [reason]`, and `/deny <approval-id> [reason]` let a local operator list and decide approval requests through the same safe approval/audit path.
  - Current operator status: `agent operator status [--json] [--rows] [--kind kind] [--status status] [--severity severity] [--id id] [--details] [--public] [--actor actor] [--limit n]`, `agent operator show <item-id-or-ref-id> [--select n] [--json]`, and TUI `/operator status ...` / `/operator show ...` expose the shared control-plane operator view, row contract, projection rules, and linked drilldown for queue, approval, session, worker, agent, assignment, spec, MCP, artifact, retention, scheduler, and audit items.
  - Current local agent logs: `agent local logs [--json] [--limit n]`, `soloclaw agent logs [--json] [--limit n]`, and TUI `/agent logs` merge safe audit, file-change, approval, and approval-decision items across recent local sessions for operator/TUI reuse.
  - Current live-status view: `agent session status <session-id> [--json] [--limit n]`, TUI `/session status <session-id> [--json] [--limit n]`, and local Web `GET /api/sessions/:sessionId/status?limit=n` return outcome, command/change counts, approval counts, handoff summary, inspection summary, operator next-action counts, and latest timeline snapshots for daemon/TUI/Web reuse.
  - Current inspection view: `agent session inspect <session-id> [--json]`, TUI `/session inspect <session-id> [--json]`, and local Web `GET /api/sessions/:sessionId/inspect` return a focused inspection document with state, summary, required/warning/info issues, focus paths, safe signals, handoff summary, next actions, and review commands for CLI/TUI/Web reuse; the Web console can open this view directly from the Sessions list.
  - Current log view: `agent session timeline|logs <session-id> [--json] [--limit n]`, TUI `/session timeline|logs <session-id> [--json] [--limit n]`, and local Web `GET /api/sessions/:sessionId/timeline?limit=n` return ordered audit, file-change, approval, and approval-decision items with safe metadata for local supervision.
  - Current review view: `agent session review <session-id> [--json] [--limit n]`, TUI `/session review <session-id> [--json] [--limit n]`, and local Web `GET /api/sessions/:sessionId/review?limit=n` return operator review packages with review state, checklist, changed paths, handoff state/next command, latest safe timeline, next actions, and follow-up commands; CLI/TUI keep the heavier diff stats, patch excerpts, command results, recovery, and approval details.
  - Current result view: `agent session result <session-id> [--json]`, TUI `/session result <session-id> [--json]`, and local Web `GET /api/sessions/:sessionId/result` summarize task outcome, failed-command recovery, changed files, patch count, command results, command durations/timeouts, command execution profiles, approvals, inspection state/focus paths, handoff state/next command, next actions, and review commands for a persisted engineering session.
  - Current next-action view: `agent session next <session-id> [--json]`, TUI `/session next <session-id> [--json]`, and local Web `GET /api/sessions/:sessionId/next` return the focused handoff state, inspection state, next-action rows, statuses, and review/status/inspect/timeline/verify commands for fast operator handoff.
  - Current verification gate: `agent session verify <session-id> [--json] [--preset handoff] [--require-change] [--require-patch] [--require-recovery] [--require-timeout] [--require-diff-stat] [--require-review-profile] [--require-model-call] [--require-no-pending-approvals] [--require-execution-profile profile] [--require-approval-action action]` exits non-zero when required engineering, timeout, diff-stat, review-profile, successful model-call, no-pending-approval, execution-profile, or approval-action evidence is missing; TUI `/session verify <session-id> [--json] [verification options]` renders the same gate inside the interactive shell, and local Web `GET /api/sessions/:sessionId/verify?preset=handoff` renders the shared handoff gate for operator review.
  - Current bundle view: `agent session bundle <session-id> [--json] [--output path] [--preset handoff] [verification options]` and TUI `/session bundle <session-id> [--json] [--output path] [--limit n] [verification options]` export the same diff, report, status, timeline, review, result, local status/log snapshots, metadata-only model usage, inspection summary, handoff summary, next actions, and verification evidence in one workspace-local JSON package.
  - Current run evidence path: `agent run --json --session-result --verify-session "task"` returns the completed session, final answer, result summary, verification checks, and review commands in one response.
  - Current resume evidence path: `agent resume <session-id> --json --session-result --verify-session` returns the resumed session, final answer, result summary, verification checks, and review commands in one response; adding `--require-model-ready` checks provider/model/base URL/API-key readiness before the paused session is continued.
  - Current target-mode evidence path: `agent plan|build|goal --json --session-result --verify-session --allow-no-command "task"` returns target-mode sessions, outcomes, verification checks, and review commands.
  - Closure gate: supervised sample-repo change demo with policy-checked writes, shell, Git/dependency boundaries, failed-test recovery, and durable audit/session evidence.
- Phase 3: Visual control plane.
  - Goal: Web/control-plane surfaces expose task lists, execution logs, approval queues, row-oriented drilldown, model status, workspace status, and history through the same contracts used by CLI/TUI.
  - Accepted when `agent web`, Web state API smoke, approval queue actions, `agent operator status --rows --json`, and `/api/operator/rows/:ordinal/detail` all work through documented paths.
  - Runtime boundary: Web/TUI/CLI inspect sessions, approvals, workers, and runner status through the control plane; they must not call Rust runner internals directly.
  - Closure gate: Web/TUI/CLI share the same operator state, row detail, approval, status, history, and permission-projected detail contracts.
- Phase 4: Multi-platform local agent.
  - Goal: `soloclaw` runs consistently on Windows, Linux, macOS, and Android Termux with unified CLI/TUI behavior, platform capability detection, path handling, permission boundaries, and install/update documentation.
  - Accepted when Windows PowerShell/CMD, Linux shell, macOS shell, and Android Termux can each run install/setup smoke, `soloclaw doctor`, and `soloclaw config path`.
  - Runtime boundary: package Rust workers as optional/selected local subprocesses behind the same JSON-RPC contract; keep the `soloclaw` CLI UX identical across TS-only and Rust-backed local runtimes.
  - Closure gate: fresh install/source-run smoke succeeds on Windows, Linux, macOS, and Android Termux, with config/cache/log paths and secret-handling documented per OS.
  - Current boundary: `soloclaw phase4 verify --workspace E:\code\agent --json` is a local Windows gate; the fresh cross-OS macOS and Android Termux matrix remains an evidence collection item.
- Phase 5: Room collaboration network.
  - Goal: multiple devices and agents can join one room, identify themselves, exchange routed messages, receive task assignments, synchronize results, handle conflicts, and wake or hand off work across devices.
  - Accepted when one room can mix agents from Windows, Linux, macOS, and Android Termux, route work to a specific agent, verify signed acknowledgements and heartbeats, and show health/operator state.
  - Current local smoke: `soloclaw phase5 verify --json` creates a signed-invite room on a token-gated local HTTP control plane, enrolls two separate local-agent workspaces, proves a one-file invite-bundle join/run bootstrap writes idle runner status evidence, generates a Web invite bundle and verifies state/audit responses stay token-safe, opens `/api/events?room=<room-id>`, rejects a late join using a revoked probe invite, rotates one joined probe agent key and proves the old signed `remote say` is rejected while the replacement-key message and audit event are visible, creates a stale remote-agent health probe from an expired signed heartbeat, recovers that stale agent by suspending its room membership and marking heartbeat `offline`, routes one task to each active enrolled agent, verifies route isolation, signed ack/heartbeat, streamed room-scoped `control_plane.action` events for remote heartbeats, `room.message.sent` message-id/body-length summaries, `room.delivery.acknowledged` message-id/agent summaries without message bodies or ack signatures, per-agent `/api/rooms/<room-id>/delivery-status` pending/ack summaries, signed remote message-intent reply metadata, local `room-assignment-result` assignment/result transcript evidence, local `room-handoff` request/acceptance/completion transcript evidence, and scans JSON evidence for secret-shaped leaks.
  - Manual matrix: `soloclaw phase5 matrix-template --json` prints the source-install/control-plane/remote-run commands for Windows PowerShell, Windows CMD, Linux shell, macOS shell, and Android Termux agents; `--target <target-id>` such as `--target linux-shell-agent` prints just one host's commands for per-machine collection. The matrix includes `/api/events?room=<room-id>`, `/api/events?room=<room-id>&type=room.message.sent`, `/api/events?room=<room-id>&type=room.delivery.acknowledged`, and `/api/rooms/<room-id>/delivery-status` probes, revoked-invite probe, `agents trust <revoked-agent-id> revoked` probe with old signed say/ack/heartbeat rejection attempts, stale-agent heartbeat probe using `remote heartbeat --ttl 1` plus `agents health --now`, `agents recover-stale --now` recovery evidence, `remote service --json` plan-only supervision evidence, one `delegate --room --assigned-agent <assignment-target-agent-id>` room-linked assignment/result transcript probe, two remote artifact conflict probes plus one room decision resolution, one remote result-file probe copied back to the control workspace and registered with `artifacts add --room`, one remote-to-remote handoff request/acceptance/completion probe, stale stop-file cleanup, platform-specific stop-marker creation commands, and workspace-local stop-file shutdown control for foreground runners.
  - Collection plan: `soloclaw phase5 evidence-plan --json` prints a token-safe manifest for the control host with the expected fragment directory, base/merged evidence filenames, one row per required target, each target's fragment filename/path, per-target matrix/template/preflight commands, `collector-pack`, `collection-prepare`, and final merge/check commands. `soloclaw phase5 collection-runbook --json` prints the ordered control-host sequence from evidence initialization through guide generation, fragment status, target-dir merge, and the final evidence-check gate, with per-target guide/fragment/preflight paths and token-safe notes; add `--output phase5-collection-runbook.md` to write only the Markdown runbook for an existing workspace, with `--force` required for intentional replacement. Add `--registered-pull-target <remote-target-id>` to `collection-runbook`, `collection-prepare`, `collector-guide`, or `collector-pack` after choosing the one real remote target that will run `remote register`, accept the pulled room invitation, and process the routed registered-pull task. `collection-runbook`, the selected remote guide, the control-plane-host guide, `collector-pack`, and `registered-pull-operator-next` expose the same `evidenceFileHandoff` checklist for the selected target files, control-host JSON captures, `registered-pull-evidence-patch` inputs, patch output, and `room.registeredAgentPull` paste path. `soloclaw phase5 collection-prepare --json` writes the control-host collection workspace in one no-overwrite step: the base `phase5-evidence.json`, six token-safe `phase5-fragments/<target-id>.json` templates, six per-target Markdown guides under `phase5-collector-guides/`, `phase5-collection-runbook.md`, and, when a registered-pull target is selected, `phase5-registered-pull-operator-next.json`; add `--force` only when intentionally replacing those files. For an existing collection workspace that only needs the registered-pull machine-readable handoff, run `soloclaw phase5 registered-pull-operator-next --registered-pull-target <remote-target-id> --json`; it writes only the selected-target/control-host operator-next JSON and leaves base evidence, fragments, guides, and runbooks untouched. After the selected target has a runner status file, `soloclaw phase5 registered-pull-evidence-patch --registered-pull-target <remote-target-id> --status-file .agent/tmp/phase5-registered-pull-status.json --pull-agent-file pull-agent.json --invitations-file invitations.json --accept-room-file accept-room.json --room-show-file room-show.json --delivery-status-file delivery-status.json --json` turns that status plus optional command JSON, transcript, delivery-status, and control-host summary arguments into a paste-safe `room.registeredAgentPull` patch; it does not edit the base evidence or fragments unless `--output` is provided, and even then writes only the patch file. These commands do not create control tokens, invite tokens, private keys, signed envelopes, or raw SSE captures. `soloclaw phase5 collector-pack --json` writes token-safe per-target Markdown guide files under `phase5-collector-guides/` for distribution to machine operators without adding `.json` files to the fragment merge directory; add `--target <target-id>` to write only one machine operator's guide, and add `--include-smoke-commands` only for an execution handoff that should embed that target's matrix commands with placeholders. `soloclaw phase5 evidence-init --json` writes the default `phase5-evidence.json` base template plus one token-safe `phase5-fragments/<target-id>.json` fragment template per required target, refuses to overwrite existing files by default, and only replaces them with `--force`. `soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --json` reads the current base evidence plus any valid collected fragments, reports per-target `collectionStatus`, `roomStatus`, `invalidFragmentCount`, `fragmentErrors`, remaining target ids, and next commands without writing a merged evidence file; invalid fragments do not block the progress view, but the strict merge/check gates still require fixing or removing them.
  - Evidence gate: `soloclaw phase5 evidence-template --json` creates a paste-safe record shape, `--target <target-id>` such as `--target control-plane-host` or `--target linux-shell-agent` prints one target's fill-in fragment, `soloclaw phase5 evidence-check --file <fragment.json> --target <target-id> --json` lets the control host preflight its event-stream/operator-visibility plus shared room/global evidence fragment and each remote collector preflight its install/bootstrap/service-plan/runner fragment before merge, `soloclaw phase5 evidence-merge --file <base.json> --target-file <fragment.json> --output <merged.json> --json` merges per-machine fragments back into the full evidence file, and `--target-dir <fragments-dir>` loads all first-level `.json` fragments from a collection directory in filename order. Merge rejects duplicate target ids across fragment inputs instead of silently overwriting evidence, replaces shared `room` evidence from a control-plane-host fragment while preserving it for remote-only fragments, reports required/merged/remaining target ids plus `roomStatus`, sets `readyForFinalEvidenceCheck` only when targets and shared room evidence are both ready, and tolerates BOM-encoded JSON captures from Windows shells, and `soloclaw phase5 evidence-check --file <path> --json` requires all five remote targets plus the control-plane host to pass install/bootstrap/enroll/inbox/heartbeat/run/reply, one-file invite-bundle kind/signature and join/run flags from the `room join --json` `bootstrapEvidence` object, revoked-invite rejection, revoked-agent signed say/ack/heartbeat rejection through `room.revokedAgent`, control-plane event stream evidence including safe `room.message.sent` and `room.delivery.acknowledged` message-id summaries, control-plane delivery-status evidence with every remote agent id, ack message ids, and zero pending routed messages, stale-agent health detection through `room.staleAgent`, stale-agent recovery through `room.staleRecovery`, signed-exchange, `room.assignmentResult` assignment/result transcript evidence, `room.conflictResolution` conflict/decision transcript evidence, `room.resultSync` registered-artifact/message visibility evidence, `room.handoff` request/acceptance/completion transcript evidence, per-target remote service-plan evidence, per-target idle runner status with last-heartbeat and lifecycle summaries, one stop-file shutdown status, operator-visible transcript/state/health, and secret-shape checks. Failed JSON checks include a top-level `missingEvidence[]` list grouped by `target`, `room`, `control-plane`, or `matrix` scope so collectors can see the next fragment or room section to fill.
  - Current evidence boundary: `soloclaw phase5 verify --workspace E:\code\agent --json` is the local room smoke; `soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --registered-pull-target macos-shell-agent --json` remains incomplete until real control-host and per-machine fragments are collected. Template fragments and generated guides are scaffolding, not completion evidence.
  - Registered pull gate: `room.registeredAgentPull` is shared control-plane room evidence. It records the selected remote target id, pulled agent id, role/aliases, invitation listing and acceptance, routed task/reply message ids, handled message ids, signed ack, valid reply signature, idle heartbeat/stop, and zero pending delivery. `registered-pull-evidence-patch` reads only the selected target's token-safe runner status summary fields, optional whitelisted summaries from `room pull-agent`, `remote invitations`, `remote accept-room`, `rooms show`, and delivery-status JSON output files, plus explicit control-host summary arguments, reports any still-missing fields, and outputs a patch object whose `patch.room.registeredAgentPull` can be pasted into the control-plane fragment.
  - Evidence-check JSON also includes `summary.missingEvidenceByScope` with `matrix`, `target`, `room`, and `controlPlane` counters for automation that needs the next missing collection scope without scanning every failed check.
  - Merge JSON with `--output` includes `collectionStatus` per required target, showing each target's role, evidence status, whether it was merged in that run, and source fragment path when available. It also includes a lightweight `finalEvidenceCheck` summary with the final gate status, missing-evidence count, and scope counters for the just-written merged file; the full `phase5 evidence-check --file <merged.json> --json` command remains the closure gate.
  - Latest Phase 5 key-rotation increment: the local control plane now exposes `agents rotate-key` / `POST /api/agents/:agentId/rotate-key`; `soloclaw phase5 verify --json` now includes a local `room-key-rotation` smoke, and the manual matrix plus evidence gate require `room.keyRotation` proof that a joined remote agent's fingerprint changed, the old signed `remote say` is rejected, the replacement key can post a visible room message, and the rotation audit is visible. Production-grade authenticated rotation policy, rotation ceremonies, and long-running key lifecycle management remain future work.
  - Latest Phase 5 realtime/operator increment: room message writes now emit room-scoped `room.message.sent` SSE events, delivery acknowledgements emit room-scoped `room.delivery.acknowledged` SSE events through the local `/api/events` endpoint, `GET /api/rooms/<room-id>/delivery-status` returns per-agent routed/pending/last-ack summaries, and the Web console can generate a sensitive one-file remote invite bundle for the selected room. The paste-safe surfaces carry only ids, kinds, senders/agents, body length, routing summary, pending counts, and signed-intent/signed-ack booleans; they omit room bodies, ack envelopes, signatures, nonces, and tokens. Invite bundles intentionally contain the control token and invite token only in the immediate response/output and must not be copied into evidence. The Web console refreshes selected-room state from the SSE events and renders the selected room's per-agent delivery status, and `soloclaw phase5 verify --json` records event-stream ids, delivery-status evidence, and a `web-invite-bundle` signature/leak check.
  - Runtime boundary: distributed agents communicate through room/control-plane/broker contracts; Rust runners stay local to each worker and report through the same task/session/audit envelopes.
  - Closure gate: room demo proves invite/enroll, routed wake-up, signed ack/heartbeat, handoff, conflict/audit behavior, and multi-device health visibility.
- Phase 6: Advanced autonomous operation and safety governance.
  - Goal: stronger local/phone operations and native app surfaces exist only behind capability tiers, approvals, audit, secret protection, model-output constraints, and sensitive-action interception.
  - Accepted when policy regression tests, approval replay tests, secret/audit redaction tests, native app control-plane contract smoke, mobile-action policy simulation, commerce/payment/account/security-prompt denial or human-confirmation smoke, and incident/export drills pass.
  - Runtime boundary: hardened Rust/container/VM execution can replace local TS runtime internals only behind the same interface, policy, approval, audit, artifact, and teardown contracts.
  - Closure gate: native app and stronger automation surfaces prove capability policy, approval replay, redaction, incident/export, and mandatory human confirmation or denial for irreversible mobile/account/commerce/security actions.

The release-sized near-term plan is tracked in [docs/implementation-roadmap.md](docs/implementation-roadmap.md#near-term-execution-plan).

## Production Direction

The long-term product is a privately deployable professional agent platform with:

- MIT-licensed open source;
- Soloclaw terminal/TUN entry as the default workflow;
- Windows, Linux, macOS, and Android terminal deployment;
- distributed agents across machines;
- room-based multi-agent collaboration;
- hub-and-room control plane before peer-to-peer networking;
- multi-user organizations and permissions;
- GitHub/GitLab PR automation;
- long-term storage.

See:

- [docs/production-architecture.md](docs/production-architecture.md)
- [docs/execution-modes.md](docs/execution-modes.md)
- [docs/spec-driven-development.md](docs/spec-driven-development.md)
- [docs/agent-execution-standards.md](docs/agent-execution-standards.md)
- [docs/security-boundaries.md](docs/security-boundaries.md)
- [docs/agent-rooms.md](docs/agent-rooms.md)
- [docs/decisions.md](docs/decisions.md)
- [docs/secrets.md](docs/secrets.md)
- [docs/threat-model.md](docs/threat-model.md)
- [docs/plugins.md](docs/plugins.md)
- [docs/knowledge-rag.md](docs/knowledge-rag.md)
- [docs/operations.md](docs/operations.md)
- [docs/replacement-ledger.md](docs/replacement-ledger.md)
- [docs/implementation-roadmap.md](docs/implementation-roadmap.md)
- [docs/sub-agents.md](docs/sub-agents.md)
- [docs/skills-memory.md](docs/skills-memory.md)

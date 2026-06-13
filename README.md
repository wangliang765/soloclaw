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
soloclaw --workspace ../another-project
```

`soloclaw quickstart` prints the shortest first-run checklist for the active workspace, with `soloclaw setup --wizard` as the easiest model setup path, plus local-model setup, environment-variable commands, model readiness check, and the first smoke task. A plain `soloclaw` opens the local terminal workspace and immediately shows the active workspace, model profile, model config path, readiness status, and next commands. `soloclaw setup --wizard` asks for provider, model, optional base URL, and API-key environment name, then writes the same editable JSON config as the explicit commands; choose `custom` and enter a URL for OpenAI-compatible providers that are not on the built-in list, or type `none` for the API-key environment when that local service does not require a key. `soloclaw setup --workspace <path> ...` initializes that target workspace from your current shell, records it as the active workspace, and writes its model config under the target `.agent/` directory. `soloclaw setup --local --model <model>` marks the current directory as the active workspace and writes the local OpenAI-compatible model profile in one step; `--ollama`, `--mock`, and `--custom` are shortcut flags for the same setup flow. `soloclaw init` marks the current directory as the active workspace and creates editable JSON config under `.agent/`. `soloclaw workspace use <number|path>` marks another directory as the active workspace, so the next plain `soloclaw`, `soloclaw inspect`, `soloclaw doctor`, `soloclaw providers`, `soloclaw model|config`, and `soloclaw ask|run|plan|build|goal` use that workspace unless you pass `--workspace <path>`.

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
```

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

Supported provider names are `openai`, `anthropic`, `grok`, `minimax`, `deepseek`, `glm`, `mimo`, `openai_compatible`, `anthropic_compatible`, and `mock`. For first-run setup, `custom` maps to `openai_compatible`; `local` and `ollama` also map to `openai_compatible` and default to `http://localhost:11434/v1` unless you pass `--base-url`. `soloclaw model local`, `soloclaw model use local`, and TUI `/model local` select the same `openai_compatible` profile and persist the local base URL with no API key environment variable requirement.
Use `agent run|ask|plan|build|goal --require-model-ready ...` when you want a real-model task to fail fast on missing base URL or API-key environment configuration before a session is opened. The gate reuses the same metadata-only readiness view as `soloclaw model check`; `--api-key-secret` counts as a configured key reference without printing the secret id or value.
Provider profile overrides are stored in `.agent/model-providers.json` and contain only non-secret metadata such as protocol, base URL, default model, the default provider, and API key environment variable names. You can edit this JSON by hand:

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
      "apiKeyEnvNames": ["LOCAL_LLM_API_KEY"]
    }
  }
}
```

## Current Local MVP Highlights

This repository is now a local-first TypeScript MVP, not only a skeleton. The current implementation includes:

- `plan`, `build`, and `goal` execution modes.
- SQLite-backed sessions, resume state, messages, tool calls, approvals, audit events, rooms, workers, assignments, specifications, knowledge records, artifacts, retention policies, skills, memory, and session summaries.
- Policy-gated workspace tools, file-level write locks, approval replay/resume including local worker-backed continuation, signed audit bundle export, and local execution hygiene checks.
- Provider profiles, encrypted API-key secret refs, transient retries, fallback providers, model-call budget/circuit guards, metadata-only `model.called` audit, and `models usage` summaries.
- Local secret vault and policy secret broker.
- Sub-agent child sessions, room-linked delegation, persistent skills/memory, session compaction, and lifecycle deletion.
- Agent rooms with invite tokens, signed messages, observer roles, capability checks, mention-based wake-up routing, aliases/handles, routing diagnostics, remote inbox/ack/poll/run, remote enrollment, and agent health.
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

Distributed collaboration is hub-and-room first. One control plane hosts rooms, identity registration, routed inboxes, signed acknowledgements, heartbeats, and operator state. Agents on Windows, Linux, macOS, and Android enroll into that control plane and wake only for routed room messages, assigned tasks, or explicit watcher roles. The intended experience is natural cross-device collaboration through the same room protocol, regardless of which supported OS an agent runs on. Direct peer-to-peer networking and NAT traversal are later optimizations, not the first distributed design.

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
   - Current state: partially implemented; unified-diff `apply_patch` now has workspace-boundary validation, file locks, file-change records, command audit, command timeout/duration evidence, local command execution profile metadata, file-level diff stats and file summaries, `agent run --json --session-result --verify-session` for end-to-end session evidence, `agent run|ask|plan|build|goal --require-model-ready` for fail-fast real-model configuration gating before session creation, `agent resume --json --session-result --verify-session` for resumed-session evidence, `agent plan|build|goal --json --session-result --verify-session` for target-mode evidence, `agent approve <approval-id> --queue-resume <worker-id>` for worker-backed approval continuation after approved-tool replay, `agent sessions --json --limit n` for a local session dashboard with per-session outcome, pending approvals, command/change counts, latest timeline, and review commands, `agent local status --json` / `soloclaw agent status --json` for a daemon-ready local agent snapshot across sessions, workers, assignments, approvals, scheduler/worker poll readiness, queue depth, active leases, and capacity, `agent local logs --json` / `soloclaw agent logs --json` for a safe merged local execution log, `agent session diff <session-id>` for persisted patch inspection, `agent session report <session-id> --json` for consolidated engineering evidence including approvals, timed-out commands, command execution profiles, diff stats, and file summaries, `agent session status <session-id>` for daemon-ready status snapshots including operator next-action counts, `agent session timeline|logs <session-id>` for ordered audit/file-change/approval logs, `agent session review <session-id>` for a single operator review package across checklist, changes, commands, approvals, diff stats, file summaries, latest timeline, and next actions, `agent session result <session-id>` for a human-readable outcome/recovery/change/approval/timeout/profile/diff-stat/file-summary/next-action report, `agent session verify <session-id>` for machine-checkable engineering gates including required execution profiles and diff stats, `agent session bundle <session-id> --json --output .agent/tmp/session-bundle.json` for an exportable diff/report/status/timeline/review/result/verification evidence package with next actions, and `agent phase2 verify --json --cleanup` for local failed-test recovery, mock agent-loop repair, workspace-write/dependency/Git/high-risk-shell approval boundaries, timeout/profile/diff-stat/file-summary/timeline/status/session-list/local-agent-status/daemon-readiness/local-agent-logs/review/bundle/next-action evidence, diff/report/result/verification/run-session/resume/queued-approval-continuation/target-mode evidence, and pause/resume/cancel lifecycle smoke. The remaining gaps are stronger execution isolation beyond local policy/audit profiles, daemon service lifecycle UX, smoother real-model task driving, production-grade distributed approval retries, richer generated diff/result inspection, and better Web/TUI inspection.
3. Cross-machine room collaboration alpha.
   - Target user: one person or team running agents on Windows, Linux, macOS, and Android Termux machines.
   - Done means agents can enroll into a room control plane, join by invite or allowlist, receive routed room tasks, submit signed acknowledgements and heartbeats, expose health/operator state, and run foreground or daemon remote loops without loading the entire room transcript.
   - Current state: local room/remote prototypes exist; cross-platform packaging, daemon lifecycle, stronger auth, and end-to-end multi-machine soak tests remain.
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
  workspace/    workspace boundary and local runtime
  mcp/          MCP registry, planner, and local runtime boundary

crates/
  agent-runner/   future Rust command runner
  agent-indexer/  future Rust symbol/search indexer
  agent-diff/     future Rust patch/diff engine
```

## Roadmap

- Phase 1: Local usable version.
  - Goal: `soloclaw` opens an agent work interface from PowerShell or a terminal, with workspace selection, model configuration, TUI, basic commands, task entry, configuration checks, and safety confirmations.
  - Accepted when `soloclaw`, `soloclaw quickstart`, `soloclaw setup --wizard`, `soloclaw doctor`, `soloclaw ask`, `soloclaw model`, `soloclaw config`, and `soloclaw smoke` work from a clean local workspace with mock-provider smoke coverage.
  - Closure gate: clean-workspace demo plus `npm run build`, `npm run check`, `npm test`, model JSON/config proof, mock task smoke, and Phase 1 security acceptance.
- Phase 2: Engineering execution capability.
  - Goal: the agent can handle real code-project work by reading the project, planning, editing files, running tests, showing diffs, recovering from failures, and persisting task state.
  - Accepted when a sample repository code-change flow proves plan/build/goal task execution, diff/result inspection, pause/resume/cancel, failed-test recovery, and session/audit state.
  - Current partial smoke: `agent phase2 verify --json --cleanup` creates disposable sample repos, observes a failing test, records a timed-out command with local execution profile metadata, applies a unified diff patch, reruns the test, verifies persisted `sessions` / `session diff` / `session report` / `session status` / `session timeline` / `session review` / `session result` / `session verify` / `session bundle` evidence including file-level diff stats, file summaries, and operator next actions, exercises end-to-end `agent run`, `agent resume`, queued approval continuation through a local worker, and plan/build/goal target-mode session evidence paths, drives a mock agent-loop repair through real `run_command` / `apply_patch` / `run_command` tools, proves workspace-write/dependency-install/Git-mutation/high-risk-shell policy approval boundaries, covers fail-fast `--require-model-ready` real-model configuration gating, runs pause/resume/cancel lifecycle smoke, and returns session-scoped file-change/audit/approval/timeout/profile/diff-stat/file-summary/timeline/status/session-list/local-agent-status/daemon-readiness/local-agent-logs/review/bundle/next-action evidence with `phaseClosure: "partial"`.
  - Current diff view: `agent session diff <session-id> [--json]` extracts successfully completed `apply_patch` unified diffs from session audit, maps them to changed paths, reports per-file additions/deletions plus change type, patch count, review size, and review hint, and prints the applied patch text for review.
  - Current evidence view: `agent session report <session-id> --json` summarizes messages, tool results, file changes, changed paths, command audit, command durations/timeouts, command execution profiles, diff stats, approvals, failed tools, and failed commands for a persisted session.
  - Current session dashboard: `agent sessions [--json] [--limit n] [--status status] [--target-mode mode]` lists recent sessions with outcome, pending approvals, command/change counts, latest safe timeline entries, and follow-up review/result commands.
  - Current local agent status: `agent local status [--json] [--limit n]`, `soloclaw agent status [--json] [--limit n]`, and TUI `/agent status` summarize local daemon-ready state across recent sessions, pending approvals, workers, assignments, queue load, scheduler/worker poll readiness, active leases, capacity, and next commands.
  - Current local agent logs: `agent local logs [--json] [--limit n]`, `soloclaw agent logs [--json] [--limit n]`, and TUI `/agent logs` merge safe audit, file-change, approval, and approval-decision items across recent local sessions for operator/TUI reuse.
  - Current live-status view: `agent session status <session-id> [--json] [--limit n]` returns outcome, command, approval, execution-profile, operator next-action counts, and latest timeline snapshots for daemon/TUI/Web reuse.
  - Current log view: `agent session timeline|logs <session-id> [--json] [--limit n]` returns ordered audit, file-change, approval, and approval-decision items with safe metadata for local supervision.
  - Current review view: `agent session review <session-id> [--json] [--limit n]` returns one operator package with review state, checklist, changed paths, diff stats, patch excerpts, command results, recovery, approvals, latest safe timeline, next actions, and follow-up commands.
  - Current result view: `agent session result <session-id> [--json]` summarizes task outcome, failed-command recovery, changed files, patch count, diff stats, command results, command durations/timeouts, command execution profiles, approvals, next actions, and review commands for a persisted engineering session.
  - Current verification gate: `agent session verify <session-id> [--json] [--require-change] [--require-patch] [--require-recovery] [--require-timeout] [--require-diff-stat] [--require-execution-profile profile] [--require-approval-action action]` exits non-zero when required engineering, timeout, diff-stat, execution-profile, or approval-action evidence is missing.
  - Current bundle view: `agent session bundle <session-id> [--json] [--output path] [verification options]` exports the same diff, report, status, timeline, review, result, next actions, and verification evidence in one workspace-local JSON package.
  - Current run evidence path: `agent run --json --session-result --verify-session "task"` returns the completed session, final answer, result summary, verification checks, and review commands in one response.
  - Current resume evidence path: `agent resume <session-id> --json --session-result --verify-session` returns the resumed session, final answer, result summary, verification checks, and review commands in one response.
  - Current target-mode evidence path: `agent plan|build|goal --json --session-result --verify-session --allow-no-command "task"` returns target-mode sessions, outcomes, verification checks, and review commands.
  - Closure gate: supervised sample-repo change demo with policy-checked writes, shell, Git/dependency boundaries, failed-test recovery, and durable audit/session evidence.
- Phase 3: Visual control plane.
  - Goal: Web/control-plane surfaces expose task lists, execution logs, approval queues, row-oriented drilldown, model status, workspace status, and history through the same contracts used by CLI/TUI.
  - Accepted when `agent web`, Web state API smoke, approval queue actions, `agent operator status --rows --json`, and `/api/operator/rows/:ordinal/detail` all work through documented paths.
  - Closure gate: Web/TUI/CLI share the same operator state, row detail, approval, status, history, and permission-projected detail contracts.
- Phase 4: Multi-platform local agent.
  - Goal: `soloclaw` runs consistently on Windows, Linux, macOS, and Android Termux with unified CLI/TUI behavior, platform capability detection, path handling, permission boundaries, and install/update documentation.
  - Accepted when Windows PowerShell/CMD, Linux shell, macOS shell, and Android Termux can each run install/setup smoke, `soloclaw doctor`, and `soloclaw config path`.
  - Closure gate: fresh install/source-run smoke succeeds on Windows, Linux, macOS, and Android Termux, with config/cache/log paths and secret-handling documented per OS.
- Phase 5: Room collaboration network.
  - Goal: multiple devices and agents can join one room, identify themselves, exchange routed messages, receive task assignments, synchronize results, handle conflicts, and wake or hand off work across devices.
  - Accepted when one room can mix agents from Windows, Linux, macOS, and Android Termux, route work to a specific agent, verify signed acknowledgements and heartbeats, and show health/operator state.
  - Closure gate: room demo proves invite/enroll, routed wake-up, signed ack/heartbeat, handoff, conflict/audit behavior, and multi-device health visibility.
- Phase 6: Advanced autonomous operation and safety governance.
  - Goal: stronger local/phone operations and native app surfaces exist only behind capability tiers, approvals, audit, secret protection, model-output constraints, and sensitive-action interception.
  - Accepted when policy regression tests, approval replay tests, secret/audit redaction tests, native app control-plane contract smoke, mobile-action policy simulation, commerce/payment/account/security-prompt denial or human-confirmation smoke, and incident/export drills pass.
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

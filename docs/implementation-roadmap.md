# Implementation Roadmap

This roadmap tracks the path from the current local skeleton to the expected private-deployable professional agent platform.

## Iteration Size

One iteration means a coherent implementation slice that:

- compiles;
- has a CLI or API smoke test;
- leaves docs updated;
- does not require the next iteration to be useful.

## Current Progress Snapshot

The project has moved past the original skeleton and is now a broad local TypeScript MVP. The current implementation is useful for single-machine professional development experiments, but it is still not a private distributed production platform.

## Soloclaw Product Mainline

The product mainline is:

```text
soloclaw terminal entry
  -> local workspace agent that is easy to configure
  -> long-running daemon-ready local agent
  -> Windows/Linux/macOS/Android terminal builds
  -> room control plane for multiple machines
  -> agents join rooms, exchange routed messages, run assigned work, and report health/results
  -> native Windows/macOS desktop apps and Android companion/native app surfaces
  -> private distributed platform with production storage, auth, broker, sandboxing, and real-time UI
```

This mainline is the priority filter for future iterations. A change is higher priority when it makes `soloclaw` easier to start, configure, inspect, package, or connect to a room from another machine. Features that do not improve that path should either stay behind existing local contracts or be deferred.

The terminal/TUN experience is not a side project. It is the primary product surface for the next milestones:

- `soloclaw` with no arguments opens the local terminal workspace.
- `soloclaw ask`, `soloclaw doctor`, `soloclaw model`, and `soloclaw config` provide short commands for everyday use.
- Future iterations should keep adding product-grade terminal commands before exposing the same capability through Web or daemon automation.
- Windows PowerShell/CMD, Linux shells, and macOS shells are first-class targets.
- Android starts with a Termux-compatible CLI/TUI path, then can grow into a wrapper app and later a native UI.

Native applications are a later productization layer, not the first execution substrate. The planned sequence is:

- **Windows desktop app**: wraps the local/room control plane, exposes workspace selection, task status, approvals, logs, model configuration, and update management while delegating execution to the same local agent service.
- **macOS desktop app**: follows the same control-plane contract as Windows, with macOS-specific keychain, notification, launch, sandbox, and update integration.
- **Android app**: starts as a companion for room monitoring, notifications, approvals, guided actions, and optional local-agent lifecycle control; deeper Android automation remains behind explicit Phase 6 safety governance.
- **Shared app contract**: all apps must use the same authenticated control-plane APIs, permission projections, audit events, and approval flows as CLI/TUI/Web instead of inventing separate privileged paths.

Android has an explicit capability boundary:

- **Termux agent**: joins rooms, runs CLI/TUI tasks, signs acknowledgements and heartbeats, calls models, uses configured APIs, and operates on files/commands available to Termux.
- **Native companion**: shows rooms, task state, notifications, approvals, and guided actions; it may deep-link to another App or browser flow when the user is expected to continue.
- **Restricted phone automation**: broad Accessibility, ADB, Shizuku, root, device-owner, or third-party App UI automation is not a default product target. It can only be considered as an explicitly enabled integration with visible user consent, clear safety boundaries, audit, and human confirmation for irreversible actions.
- **Commerce and payment**: autonomous checkout, payment confirmation, CAPTCHA handling, security prompt bypass, or account automation is out of scope unless a compliant first-party API exists and the final purchase/payment confirmation remains with the user.

The distributed collaboration shape is intentionally hub-and-room first, not peer-to-peer first:

- one control plane hosts rooms, identity registration, routed inboxes, signed acknowledgement, heartbeats, and operator state;
- Windows, Linux, macOS, and Android agents enroll into the control plane, join rooms by invite or allowlist, and receive only routed wake-up messages;
- all supported OS targets collaborate through the same room protocol, so a room can naturally mix desktop, server, and mobile-terminal agents;
- room transcript is shared context, while per-agent inboxes are the execution trigger;
- P2P, direct device discovery, and NAT traversal are later optimizations after the control-plane protocol is stable.

Product phases:

1. **Local usable version**: `soloclaw` works from PowerShell or a terminal as the primary agent work surface, with workspace selection, model configuration, TUI, basic commands, task entry, configuration checks, and safety confirmations.
2. **Engineering execution capability**: the agent can handle real code-project work by reading the project, making plans, editing files, running tests, showing diffs, recovering from failures, and persisting task state.
3. **Visual control plane**: Web/control-plane surfaces expose task lists, execution logs, approval queues, row-oriented drilldown, model status, workspace status, and history while sharing contracts with CLI/TUI.
4. **Multi-platform local agent**: `soloclaw` runs consistently on Windows, Linux, macOS, and Android Termux with unified CLI/TUI behavior, platform capability detection, path handling, local permission models, and install/update paths.
5. **Room collaboration network**: multiple devices and agents can join the same room, identify themselves, exchange protocol messages, receive routed task assignments, synchronize files/results, handle conflicts, and wake or hand off work across devices.
6. **Advanced autonomous operation and safety governance**: stronger local/phone operations and native app surfaces are introduced only behind explicit safety boundaries, including capability tiers, approvals, audit logs, sensitive-action interception, model-output constraints, and protected secret handling. Android may plan Accessibility, Intent, notification, clipboard, and browser integrations, but payment, ordering, messaging, deletion, authorization, CAPTCHA, and security-prompt flows require human confirmation.

## Phase Acceptance Targets

Each phase has to end with something a user or operator can run, inspect, and judge. A phase is not accepted by architecture alone; it needs commands, docs, tests, a clear demo path, and the applicable safety controls from `docs/security-boundaries.md`.

| Phase | Name | Acceptance target | Verification commands or demos | Non-goals / guardrails |
| --- | --- | --- | --- | --- |
| 1 | Local usable version | A developer can type `soloclaw`, choose or confirm a workspace, configure or view a model provider, use the TUI/basic commands, submit a task, run configuration checks, and see safety confirmation paths for sensitive operations. | `npm test`; `soloclaw`; `soloclaw quickstart`; `soloclaw setup --wizard`; `soloclaw doctor`; `soloclaw model list --json`; `soloclaw config show --json`; `soloclaw smoke`; `soloclaw ask "inspect this workspace"`. | No production daemon, no cross-machine guarantee, no autonomous phone/App control. |
| 2 | Engineering execution capability | The agent can perform supervised repository work: inspect project context, create a plan, edit files, run checks/tests, show diffs/results, recover from failures or pauses, and preserve task/session state. | Code-change smoke in a sample repo; plan/build/goal CLI task; diff/result inspection; pause/resume/cancel smoke; failed-test recovery smoke; audit/session state check. | Still single-machine/local-first; production auth/storage/broker may remain behind interfaces. |
| 3 | Visual control plane | Web/control-plane and TUI/CLI share the same operator contracts for task lists, logs, approvals, row-oriented drilldown, model/workspace status, and history. | `agent web`; Web state API smoke; approval queue action; `agent operator status --rows --json`; `/api/operator/rows/:ordinal/detail`; model/workspace status screens. | Web can remain local-token protected; not yet a production authenticated multi-user UI. |
| 4 | Multi-platform local agent | Windows, Linux, macOS, and Android Termux can each run `soloclaw` with consistent command behavior, platform capability detection, config/cache/log conventions, and install/update documentation. | Fresh install/source-run smoke on Windows PowerShell/CMD, Linux shell, macOS shell, and Android Termux; `soloclaw doctor`; `soloclaw config path`; platform doctor output. | Native Windows/macOS desktop apps, native Android app, broad phone UI automation, OS service installation, and production update channels can remain later work. |
| 5 | Room collaboration network | One room can mix multiple devices/agents, route tasks to intended agents, exchange messages, synchronize results, handle conflicts, and wake or hand off work across Windows/Linux/macOS/Android Termux agents. | Start control plane; create room; invite/enroll agents from target OSes; send direct and role-routed messages; verify signed ack, signed heartbeat, health, transcript/operator state, and handoff flow. | No P2P/NAT traversal requirement; Android is Termux room-agent plus companion planning, not broad third-party App UI automation or payment. |
| 6 | Advanced autonomy and safety governance | Stronger local/phone operations and native app surfaces exist only under capability tiers, approvals, audit, secret protection, model-output constraints, and sensitive-action interception. Mobile integrations are explicit, opt-in, reversible where possible, and human-confirmed for irreversible actions. | Capability policy regression tests; approval replay tests; secret/audit redaction tests; native app control-plane contract smoke; mobile-action policy simulation; commerce/payment/account/security-prompt denial or human-confirmation smoke; incident/export drill. | No separate privileged app backdoor, CAPTCHA bypass, security-prompt bypass, hidden background phone control, autonomous payment/checkout, or account automation. |

Phase acceptance checklist:

- The documented verification commands run from a clean checkout or clean install path.
- The phase has at least one human demo flow and one machine-checkable smoke path.
- Docs describe what is complete, what is intentionally local-only, and what is deferred.
- Security-sensitive capabilities have policy, audit, redaction, and regression coverage.
- Security-sensitive capabilities are mapped to `docs/security-boundaries.md` with allow/ask/deny behavior and phase-specific acceptance.
- Cross-platform phases prove Windows, Linux, macOS, and Android Termux behavior explicitly instead of assuming Node compatibility is enough.

## Phase Closure Gates

These are the release gates for declaring a phase deliverable. A phase is closed only when its user promise, demo path, automated checks, safety boundary, and explicit non-goals are all documented and verified.

| Phase | Closed when | Required evidence |
| --- | --- | --- |
| 1. Local usable version | A user can install or run the project locally, type `soloclaw`, configure a model through commands or editable JSON, choose a workspace, submit a task, inspect readiness, and understand safety prompts without reading implementation internals. | Clean-workspace demo; `npm run build`; `npm run check`; `npm test`; `soloclaw quickstart`; `soloclaw setup --wizard`; `soloclaw doctor`; `soloclaw model list --json`; `soloclaw config show --json`; `soloclaw smoke`; mock `soloclaw ask` smoke; Phase 1 security acceptance. |
| 2. Engineering execution capability | A supervised local coding task can run end to end on a sample repo: inspect, plan, edit, test, show diff/result, recover from a failed check, pause/resume/cancel, and leave durable task/audit state. | Sample repo change demo; plan/build/goal smoke; diff inspection; failed-test recovery evidence; pause/resume/cancel smoke; session/audit persistence check; policy tests for writes, shell, Git, and dependency installs. |
| 3. Visual control plane | Web/control-plane, TUI, and CLI expose the same operator state and permission-filtered details for tasks, logs, approvals, model/workspace status, history, and row-oriented drilldown. | `agent web` demo; API smoke tests; approval queue action; row list plus `/api/operator/rows/:ordinal/detail`; unauthorized/public projection tests; Web/TUI/CLI consistency checks. |
| 4. Multi-platform local agent | The same `soloclaw` workflow runs on Windows, Linux, macOS, and Android Termux with documented install, config/cache/log paths, platform capability detection, and local permission behavior. | Fresh install/source-run smoke on all four OS targets; `soloclaw doctor`; `soloclaw config path`; model setup smoke; platform doctor output; packaging/update notes; no secret leakage in editable config. |
| 5. Room collaboration network | Multiple devices/agents can join one room, receive only routed wake-up messages, exchange signed acknowledgements and heartbeats, hand off work, synchronize results, and expose health/operator state. | Control-plane room demo with at least two machines and planned four-OS soak; invite/enroll flow; direct/role route tests; signed ack and heartbeat verification; stale/revoked agent behavior; conflict/handoff audit evidence. |
| 6. Advanced autonomous operation and safety governance | Native app surfaces and stronger local/mobile operations are available only through capability tiers, explicit approvals, audit, redaction, secret protection, policy simulation, and human confirmation for irreversible actions. | Native app contract smoke; policy regression suite; approval replay tests; secret/audit redaction tests; mobile-action simulation; commerce/payment/account/security-prompt denial or human-confirmation tests; incident/export drill. |

Phase 1 is the only phase currently being closed for first delivery. Later-phase prototypes can exist in the repository, but they do not count as phase closure until the matching gate above passes through documented demos and automated evidence.

The roadmap uses four usability levels so progress is not measured by a single vague "agent is usable" claim:

| Level | User promise | Required capabilities | Current status |
| --- | --- | --- | --- |
| 1. Local CLI project-reading agent | A single developer can ask Soloclaw to inspect a workspace from the terminal. | `soloclaw` terminal workspace, `soloclaw ask`, `soloclaw doctor`, `soloclaw inspect`, CLI task entrypoints, default read-only workspace snapshot, optional bounded key-file previews, context assembly, real provider profiles, bounded local tools, sessions, approvals, audit, and usage summaries. | Phase 1 local CLI deliverable implemented; use `soloclaw doctor` or compatibility `agent phase1 verify` plus a live-provider smoke command for release verification. |
| 2. Long-running local coding agent | A single developer can supervise longer changes to real repositories. | Durable plans/goals, robust patch/diff editing, test execution, pause/resume/cancel, approval replay, worker/scheduler loops, operator drilldown, recovery after interruption, retention/compaction, clear diff/result inspection, and daemon-ready `soloclaw` status/log commands. | Partially implemented; worker/scheduler/operator/spec flows exist locally, unified-diff `apply_patch` now has a local failed-test recovery smoke via `agent phase2 verify --json --cleanup`, that verifier also checks persisted `sessions` / `session diff` / `session report` / `session status` / `session inspect` / `session timeline` / `session review` / `session result` / `session verify` / `session bundle` evidence, end-to-end `agent run` and `agent resume` session-evidence paths, plan/build/goal target-mode evidence, fail-fast `agent run|ask|plan|build|goal --require-model-ready` and `agent resume --require-model-ready` real-model configuration gating, workspace-write/dependency/Git/high-risk-shell approval boundaries, command timeout/duration/profile/diff-stat/file-summary/review-profile/model-call/session-list/session-inspection/session-inspect-command/control-plane-session-inspection/local-agent-status/daemon-readiness/local-agent-runbook/local-agent-logs/foreground-daemon-lifecycle/operator-handoff/operator-next-action evidence, a mock agent-loop repair that drives real `run_command` / `apply_patch` / `run_command` tools, and lifecycle pause/resume/cancel audit evidence, `agent run --json --session-result --verify-session`, `agent resume --json --session-result --verify-session`, and `agent plan|build|goal --json --session-result --verify-session` return session/result/verification metadata, `agent sessions --json --limit n` exposes a local session dashboard with outcome, pending approvals, command/change counts, latest safe timeline, and review commands, `agent local status --json` / `soloclaw agent status --json` / TUI `/agent status` expose a local agent status snapshot across sessions, workers, assignments, approvals, scheduler/worker poll readiness, queue depth, active leases, capacity, and a structured daemon runbook, `agent local logs --json` / `soloclaw agent logs --json` / TUI `/agent logs` expose merged safe execution logs, `agent workers poll` and `agent scheduler run` expose foreground daemon-loop lifecycle/metrics snapshots, `agent session diff <session-id>` exposes persisted patch review plus per-file additions/deletions, change type, patch count, review size, review hint, and aggregate review profile, `agent session report <session-id> --json` summarizes session evidence including approvals, timed-out commands, command execution profiles, diff stats, file summaries, review profiles, and metadata-only model usage, `agent session status <session-id>` exposes daemon-ready status snapshots with inspection, handoff, next-action, and model-call counts, `agent session inspect <session-id>` and token-gated `GET /api/sessions/:sessionId/inspect` expose a focused inspection state/issues/focus-path/next-action package through the shared session view, and the Web console Sessions list can render that package as issue and next-action rows, `agent session timeline|logs <session-id>` exposes ordered safe engineering logs, `agent session review <session-id>` gives an operator review package across checklist, changes, handoff state/next command, inspection issues/focus paths, diff stats, file summaries, review profiles, commands, recovery, approvals, model-call counts, latest timeline, and next actions, `agent session result <session-id>` gives a human-readable outcome/recovery/change/approval/timeout/profile/diff-stat/file-summary/review-profile/model-usage/inspection/handoff/next-action summary, `agent session verify <session-id>` provides a non-zero-exit engineering evidence gate including required execution profiles, diff stats, review profiles, no-pending-approval handoff checks, and `--require-model-call`, and `agent session bundle <session-id>` exports diff/report/status/timeline/review/result/local-status/local-logs/model-usage/inspection/handoff/verification/next-action evidence in one workspace-local JSON package; `agent phase2 verify` now applies the model-call gate to run-session, target-mode, and mock-repair paths and proves the no-pending-approval gate fails while approval requests remain unresolved before proving it passes after approvals are resolved. Stronger isolation beyond local policy/audit profiles, daemon service lifecycle UX, richer generated diff/result inspection, and smoother real-model task driving remain the main gaps. |
| 3. Cross-machine room collaboration alpha | Multiple agents on Windows, Linux, macOS, and Android Termux can join the same room and coordinate work through a control plane. | Installable cross-platform CLI/TUI builds, room enrollment, routed inbox, signed ack, signed heartbeat, agent health, foreground or daemon remote runners, operator views, and clear invite/trust UX. | Local room/remote prototypes exist; cross-platform packaging, daemon lifecycle, stronger auth, and end-to-end multi-machine soak tests remain. |
| 4. Product-grade private agent platform | A team can run authenticated users, remote agents, and distributed workers safely. | PostgreSQL and versioned migrations, tenant-aware auth/RBAC/policy service, broker/event stream, supervised daemons, mandatory signatures and revocation, sandboxed Rust/container runners, object storage, production Git integrations, real-time UI, observability, backups, and upgrades. | Domain contracts and local prototypes exist; production replacements remain. |

Implemented local MVP capabilities:

- CLI-driven agent loop with `plan`, `build`, and `goal` target modes.
- Soloclaw product entry with `soloclaw` terminal workspace, `soloclaw tui`, `soloclaw ask`, `soloclaw doctor`, `soloclaw model`, and `soloclaw config`, while keeping `agent` as a compatibility alias.
- `soloclaw doctor` and compatibility `agent phase1 verify` local readiness checks for the first deliverable, covering workspace snapshot collection, human-readable rendering, bounded key-file previews, mock agent-loop context injection, and live-provider smoke instructions without making an unsolicited external model call.
- `agent inspect` plus default read-only workspace snapshot injection for local CLI project-reading tasks, including structured `agent inspect --json` output, a bounded directory outline, bounded package script command, package manager and engine metadata, Python `pyproject.toml` metadata including project name, `requires-python`, dependencies, and script entry points, Python `requirements.txt` metadata including requirement files and dependency names, Python `tox.ini` metadata including envlist and commands, Python `noxfile.py` metadata including sessions and commands, Rust `Cargo.toml` metadata including package name, version, edition, workspace members, and dependency names, Go `go.mod` metadata including module path, Go version, and dependency module names, Java Gradle metadata including build/settings files, root project name, included modules, and plugin IDs, Java Maven `pom.xml` metadata including project coordinates, packaging, and dependency coordinates, .NET metadata including SDK version, solution files, project SDK, target frameworks, and package references, Ruby `Gemfile` metadata including source, Ruby version, gem names, and groups, PHP `composer.json` metadata including package name, type, dependencies, dev dependencies, and scripts, Terraform metadata including configuration files, providers, resources, modules, variables, and outputs, Dockerfile metadata including base images, workdir, exposed ports, cmd, and entrypoint, Docker Compose metadata including compose files, services, images, build contexts, and ports, pre-commit metadata including repos, hook ids, and entries, ESLint configuration metadata including files, ignores, extends, plugins, rules, parser, source type, and ECMAScript version, Prettier configuration metadata including width, indentation, semicolon, quote, trailing comma, plugin, and override settings, Next.js configuration metadata including output mode, dist/base paths, strict/trailing-slash flags, image settings, server external packages, and typed route experiments, Tailwind configuration metadata including content globs, dark mode, theme extensions, and plugins, PostCSS configuration metadata including plugins, parser, syntax, stringifier, and source map settings, Storybook configuration metadata including stories, addons, framework, and static directories, Vite configuration metadata including plugins, envDir, dev/preview server settings, and build output settings, Playwright configuration metadata including testDir, web server commands, base URLs, and projects, Vitest configuration metadata including environment, include/exclude globs, setup files, and coverage settings, Jest configuration metadata including test environment, test match globs, setup files, and coverage settings, Cypress configuration metadata including base URL, e2e/component spec patterns, support file, folders, and component dev server settings, GitHub Actions metadata including workflow files, names, triggers, and job ids, Travis CI metadata including language, stages, and scripts, Bitbucket Pipelines metadata including pipelines, steps, and scripts, GitLab CI metadata including stages and top-level jobs, CircleCI metadata including workflows and jobs, Azure Pipelines metadata including stages and jobs, Jenkinsfile metadata including agent, stages, and shell steps, Makefile/Justfile/Taskfile metadata including targets, recipes, tasks, and commands, workspace-patterns from `package.json workspaces` and `pnpm-workspace.yaml`, and child workspace package summaries with script commands, tunable `--include-key-files` previews for both inspection and task-command model context including workspace package manifests, repository guidance files such as `AGENTS.md`, maintenance/process files such as `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `CODEOWNERS`, `LICENSE`, GitHub PR templates, and issue templates, common docs entry points under `docs/`, API contract files such as OpenAPI/Swagger and GraphQL schemas/codegen configs, devcontainer and VS Code workspace configs, Node/Python/tool-version files such as `.nvmrc`, `.python-version`, `.tool-versions`, and `mise.toml`, Deno manifests, Python manifests and uv/Poetry lockfiles, Rust/Go manifests and lock/checksum files, Java/Gradle/Maven manifests and wrappers, .NET solution/project files, Ruby Gemfiles/Rakefiles, PHP Composer/PHPUnit files, Terraform files, Kubernetes manifests, Helm charts, Prisma schemas, Drizzle configs, SQL migrations, Next.js, Tailwind/PostCSS configs, Vite, Storybook, Playwright, Vitest, Jest, and Cypress configs, runtime files, developer command files such as `Makefile`, `Justfile`, and `Taskfile.yml`, repository hygiene files such as `.editorconfig`, `.gitignore`, and `.dockerignore`, quality configs such as ESLint/Prettier/Biome/Ruff/mypy/rustfmt/Clippy/golangci-lint, GitHub Actions workflow files, other CI configs, and safe env templates, detected language/framework/test-framework, monorepo, guidance, project process, Node/Bun/Deno/Python/Rust/Go/Java/Kotlin/.NET/Ruby/PHP/Terraform/Kubernetes/Helm/Prisma/Drizzle/Next.js/Tailwind/Storybook/OpenAPI/GraphQL, devcontainer, VS Code, runtime version-manager, and repository hygiene runtime, environment, quality, database schema, API contract, frontend styling, and CI signals without previewing real `.env*` contents, likely build/test/check commands, suggested next files to inspect, common framework page/route and server entry hints, safe Git status context, and `--no-workspace-snapshot` for bare prompts.
- `package.json` entrypoint, publishing, browser-target, and dependency-policy metadata is summarized statically with `private`, `license`, `homepage`, `repository`, `publishConfig`, `main`, `module`, `types`, `browser`, `typesVersions`, `bin`, `exports`, `imports`, published `files`, `sideEffects`, `browserslist`, Volta toolchain pins, peer/optional dependency names, and npm/pnpm/Yarn constraint keys from `overrides`, `pnpm.overrides`, and `resolutions`; standalone browser target files from `.browserslistrc` or `browserslist` are summarized as project environment hints.
- `.npmrc` package manager configuration is summarized statically with registries, scoped registries, common install settings, and redacted auth key names without auth values.
- `.yarnrc.yml` package manager configuration is summarized statically with Yarn path, node linker, registries, scoped registries, plugins, common settings, and redacted auth key names without auth values.
- `pnpm-workspace.yaml` workspace metadata is summarized statically with package globs, default and named catalogs, catalog dependency names, and built-dependency allow/ignore lists.
- `bunfig.toml` package manager and runtime configuration is summarized statically with preload files, JSX settings, test preload/coverage settings, registry/scoped registry metadata, install settings, and redacted auth key names without auth values.
- `turbo.json` task graph metadata is summarized statically with task names, task dependencies, inputs, outputs, cache flags, persistent flags, global dependencies, and environment mode.
- `nx.json` workspace metadata is summarized statically with npm scope, affected default base, workspace layout, named inputs, target defaults, cache flags, and plugins.
- `biome.json` and `biome.jsonc` quality-tool metadata is summarized statically with file globs, formatter settings, linter settings, rule groups, and organize-imports mode.
- Local runtime version metadata is summarized statically from `.nvmrc`, `.node-version`, `.python-version`, `.ruby-version`, `.tool-versions`, and `mise.toml`, including primary Node/Python/Ruby versions and tool-version mappings.
- `deno.json` and `deno.jsonc` manifests are summarized statically with tasks, task commands, imports, scopes, compiler options, and unstable feature flags.
- `.editorconfig` formatting conventions are summarized statically with root mode, section globs, indentation, line endings, charset, trailing whitespace, final newline, and line length settings.
- Root `tsconfig.json` is summarized statically with extends, target, module mode, module resolution, JSX mode, strict mode, root/output directories, emit/declaration/composite flags, path aliases, ambient types, libs, include/exclude globs, and project references.
- SQLite-backed sessions, messages, tool calls, audit events, approvals, rooms, workers, assignments, specifications, knowledge records, memory, and lifecycle metadata.
- Provider profiles for OpenAI, Anthropic, Grok/xAI, MiniMax, DeepSeek, GLM, MiMo, OpenAI-compatible, Anthropic-compatible, and mock providers, including local overrides, encrypted secret refs, retries, fallback routing, budget/circuit guards, model-call audit, and usage summaries.
- Policy and approval flow for workspace tools, secrets, plugins, MCP connection planning, room approvals, and high-risk actions, including synchronous approval replay/resume and local worker-backed approval continuation.
- SQLite file-level workspace locks, local write tools, file-change records, and hygiene checks.
- Local secret vault, secret broker, redaction baseline, and model-key resolution without storing raw provider secrets in model profile files.
- Sub-agent child sessions, room-linked delegation, skills, manual persistent memory, session summaries, session compaction, deletion, artifact metadata, retention policies, audit export, and signed audit verification.
- Agent rooms with invites, signed room messages, observer/read-only roles, capability checks, approval events, task progress events, mention-based wake-up routing, aliases/handles, routing diagnostics, remote inbox/ack/poll/run, remote enrollment, and agent health.
- Local Web UI/control-plane bridge for rooms, invites, approvals, sessions, artifacts, retention, audit, workers, assignments, routed inboxes, and health views.
- Git status and dry-run-first GitHub/GitLab PR/MR preparation, with optional policy-checked branch/commit/push.
- Native spec-driven workflow with specs, tasks, dependencies, versions, diffs, generated plans, plan approval gates, clarifications, verification evidence, worker dispatch, scheduler dispatch, and optional room progress projection.
- Plugin manifest execution, MCP server registry/planning, and a policy-gated local stdio/HTTP MCP execution path for capability listing, low-risk tool calls, and resource reads through bounded/redacted result handling, secret leases, and safe audit summaries.
- Knowledge RAG MVP with sources, chunks, keyword search, ACL filtering, prompt-injection safety modes, citation IDs, eval sets/runs, trend reports, threshold gates, artifacts, and automatic local task recall.
- Local worker registry, signed heartbeat/lease envelopes, nonce replay checks, task broker adapter, worker runner, scheduler loop, retry recovery, drain flow, and worker/agent health summaries.

In progress but still local-only:

- Policy, approvals, workers, rooms, RAG, specs, model routing, session compaction, retention, and audit export all prove the domain contracts locally but still depend on SQLite, in-process services, local files, local tokens, and foreground CLI/server loops.
- The Web UI is a local control console, not a production authenticated multi-user application.
- Room and worker signatures exist locally, but production still needs mandatory distributed verification, revocation, key rotation, and authenticated agent sessions.
- Git PR/MR automation can prepare local plans and URLs, but production provider APIs, stored PR refs, webhooks, CI loops, and isolated worktrees are not complete.
- MCP is no longer registry-only and has a local CLI smoke execution path with approval continuation and health diagnostics, but it still needs sandboxed transports, Web/API surfaces, and agent-tool integration before broad ordinary agent use.

Production replacements still required:

- PostgreSQL store, versioned migrations, tenant isolation, authenticated users/groups/service accounts, role templates, revocation, and policy-service-backed RBAC/ABAC.
- Redis/NATS/Postgres broker, event streaming, distributed locks/leases, durable worker/scheduler daemons, queue metrics, visibility timeouts, poison queues, and graceful handoff.
- Object storage for large artifacts/transcripts/reports, lifecycle workers, legal hold, immutable audit export, SIEM sinks, and production signing key custody.
- Rust/container runner, robust patch engine, resource limits, network policy, sandboxed plugin/MCP execution, and stronger redaction/artifact scanning.
- Production RAG with full-text/vector hybrid retrieval, embedding providers, reranking, permission-leak tests, citation precision checks, signed eval reports, freshness checks, and CI regression gates.
- GitHub App/GitLab OAuth integrations, webhook ingestion, CI evidence ingestion, PR/MR update loops, and isolated branch/worktree orchestration.
- Real TUI, authenticated Web UI, native Windows/macOS desktop apps, Android companion/native app, deployment packaging, migrations, upgrade flow, backups, observability, and operational runbooks.

Recommended next slices:

1. Keep improving the Soloclaw terminal/TUN product surface: short commands, local workspace selection, model setup, config inspection, first-run guidance, logs/status, and installable Windows/Linux/macOS/Android-Termux paths.
2. Harden local execution standards and tests: prompt-injection fixtures, RAG poisoned-document fixtures, model-context secret-leak tests, plugin isolation tests, and room/agent replay tests.
3. Freeze the production boundary abstractions that other alpha work must target: migrations, object storage, broker/event stream, search adapter, MCP runtime, and the existing store/policy/secret/workspace/model interfaces.
4. Turn the MCP stdio/HTTP runtime into a policy-gated execution MVP with secret leases, sandboxed transports, per-tool grants, and audit through the shared runtime boundary.
5. Expand RAG accuracy: hybrid search adapter, embedding provider interface, reranker interface, citation precision eval, and permission-leak eval.
6. Promote workers/scheduler and remote room runners from foreground local commands into daemon-ready services with health endpoints, metrics, logs, and graceful shutdown.
7. Advance the Web UI and TUI/CLI operator surfaces in parallel for room timelines, approvals, health, specs, MCP diagnostics, and task execution inspection.
8. After the control-plane and room contracts stabilize, design native Windows/macOS desktop apps and the Android companion/native app around the same APIs, permission projections, approvals, audit, and update channels.

## Near-Term Execution Plan

This section narrows the broad roadmap into the next release-sized plan. Treat it as the working plan for the next local professional alpha unless product priorities change.

### Release 0.2: Soloclaw Local Professional Alpha

Goal: make the local MVP feel like a usable Soloclaw product from the terminal while making it safer, easier to inspect, and ready for the first production-boundary replacements without changing the current local-first deployment shape.

Scope decision: Release 0.2 is a larger alpha milestone and includes all seven slices below. Soloclaw terminal usability is the product wrapper for the release. Security hardening and production boundary abstractions come before broader external execution, MCP execution follows those shared boundaries, and the release is not complete until RAG, daemon-readiness, and operator UI slices are also represented.

Priority order:

1. Soloclaw terminal/TUN usability baseline.
2. Security and adversarial regression expansion.
3. Production boundary interface freeze.
4. MCP execution MVP.
5. RAG accuracy alpha.
6. Daemon-ready worker, scheduler, and remote room runner shape.
7. TUI/Web execution inspection.

Done means:

- `npm test` passes and includes the new regression fixtures for the completed slice.
- The slice has at least one CLI or local API smoke path.
- Any temporary implementation added during the slice is recorded in `docs/replacement-ledger.md`.
- Any new cross-cutting contract is represented as an interface or service boundary before feature code depends on implementation details.
- README or the relevant topic doc is updated with the current behavior and the remaining production gap.

### Slice 1: Soloclaw Terminal/TUN Usability

Purpose: make the default product path feel natural from PowerShell, Linux shells, macOS shells, and Android Termux while keeping `agent` as a compatibility alias.

Deliverables:

- First-run flow that opens a workspace-oriented terminal surface when the user runs `soloclaw`.
- Short commands for everyday use: `ask`, `doctor`, `model`, `config`, `room`, `agent status`, and later daemon lifecycle commands.
- Model setup flow with common provider defaults, editable `.agent/model-providers.json`, custom base URL support, and clear secret handling through environment variables or secret refs.
- Workspace selection commands that let the user switch roots without memorizing long flags.
- Consistent output conventions for human mode and `--json` mode.
- Install guidance for Windows and Linux, plus a Termux-compatible Android path.
- Smoke tests for no-arg terminal entry, model config, doctor, ask, and any new short command.

Acceptance criteria:

- A fresh user can run `soloclaw`, configure a model, inspect config, run a mock task, and see the health check without reading deep docs.
- The same command vocabulary works on Windows PowerShell/CMD, Linux shells, and macOS shells; Android Termux differences are documented until packaged.
- `agent` remains available for old scripts, but docs and examples lead with `soloclaw`.
- New usability commands call the same underlying services as the long-form commands instead of creating parallel behavior.

Out of scope for this slice:

- Native Android app.
- Autonomous Android third-party App UI automation or payment.
- Fully packaged installers.
- Production daemon service managers.
- Production multi-user authentication.

### Slice 2: Security and Adversarial Tests

Purpose: raise confidence in the local MVP before adding more external capability execution.

Deliverables:

- Prompt-injection repository fixtures that verify untrusted workspace content cannot override protected path, secret, approval, or tool-policy rules.
- Poisoned RAG fixtures that verify unsafe chunks are annotated or excluded according to the selected safety mode.
- Model-context secret-leak tests that verify prompts, summaries, audit events, and signed bundles do not contain raw secret values.
- Plugin isolation tests for undeclared filesystem, network, shell, and secret capabilities.
- Room and remote-agent replay tests for stale signatures, nonce reuse, revoked or inactive actors, ambiguous mentions, and policy-denied wide routing.

Acceptance criteria:

- The test suite fails if raw secrets appear in model audit metadata, exported audit bundles, RAG context attachments, or room routing diagnostics.
- The test suite fails if a prompt-injection fixture can cause protected `.git` or `.agent` access through workspace tools.
- The test suite fails if a plugin can use an undeclared capability without a policy decision.
- The test suite fails if stale or replayed room, delivery, agent-heartbeat, worker-heartbeat, or lease envelopes are accepted.

Out of scope for this slice:

- Full sandboxing.
- Production auth.
- Distributed nonce windows.
- External red-team corpus automation.

### Slice 3: Production Boundary Interface Freeze

Purpose: make later Postgres, broker, object storage, and daemon work additive instead of invasive.

Deliverables:

- Review and freeze the first production-facing versions of `AgentStore`, `TaskBroker`, `PolicyEngine`, `SecretBroker`, `WorkspaceRuntime`, `ModelClient`, `McpRuntime`, `GitProvider`, `ArtifactStore`, and `EventStream`.
- Add compatibility tests that run core workflows through memory/local implementations without depending on SQLite-specific behavior.
- Add an owner module or owning service to every broad temporary area in `docs/replacement-ledger.md`.
- Add a short migration note for how SQLite local mode coexists with `PostgresAgentStore`.
- Define the first migration runner, object storage, and broker abstraction boundaries before starting the production store implementation.

Acceptance criteria:

- Agent loop, worker runner, scheduler, spec dispatch, room routing, and MCP runtime depend on interfaces rather than concrete storage or transport classes.
- New production implementations can be introduced behind configuration without changing domain objects.
- The replacement ledger identifies the trigger and owner for every Release 0.2 temporary boundary.

Out of scope for this slice:

- Full `PostgresAgentStore` implementation.
- Full production migration runner implementation.
- Redis/NATS queue implementation.
- Production object storage implementation beyond interface shape.

Decision:

- Define migrations, object storage, and broker abstractions together before implementing `PostgresAgentStore`, so storage replacement does not outpace lifecycle, artifact, and queue semantics.

### Slice 4: MCP Execution MVP

Purpose: move MCP from safe registry/planning into limited execution while preserving platform policy boundaries.

Deliverables:

- `McpRuntime` interface with typed connect, list-capabilities, call-tool, read-resource, and disconnect operations.
- Initial stdio transport support for local development servers.
- Initial HTTP transport support through the same policy, secret, timeout, redaction, and audit path as stdio.
- Secret delivery through `PolicySecretBroker` using environment variable names from `.agent/mcp-servers.json`, never raw values in registry metadata.
- Per-server and per-capability grants for `tools` and `resources`.
- Audit events for connection, capability discovery, tool/resource request, policy result, execution result summary, timeout, and failure.
- CLI smoke commands for listing live capabilities and calling one low-risk tool/resource through policy.

Acceptance criteria:

- MCP execution is denied by default unless the server is enabled, allowlisted for the current project or room, and permitted by `mcp.connect` plus the specific capability policy.
- MCP tool/resource outputs are size-limited and pass through redaction before audit or model context.
- A failed or timed-out MCP call records safe metadata and does not leak secrets.
- MCP execution can be disabled globally without deleting registry entries.

Out of scope for this slice:

- Remote production MCP servers with shared team credentials.
- Container or WASM isolation.
- MCP sampling support.
- Treating MCP servers as room members.

Decision:

- Release 0.2 includes both stdio and HTTP MCP execution. HTTP must not get a separate bypass path; if the shared runtime boundary is not ready, the slice is not done.

### Slice 5: RAG Accuracy Alpha

Purpose: move knowledge retrieval beyond keyword-only MVP while keeping ACL and safety filtering first-class.

Deliverables:

- Independent search adapter interface that can support keyword, full-text, vector, and hybrid retrieval.
- Embedding provider interface with local mock/test implementation and provider metadata that avoids storing raw document text in model audit events.
- Hybrid merge strategy with deterministic tests.
- Optional reranker interface with a mock/test implementation.
- Citation precision eval cases in addition to recall and MRR.
- Permission-leak eval cases where inaccessible chunks are relevant but must not be returned.

Acceptance criteria:

- ACL filtering happens before final context packing and cannot be bypassed by hybrid merge or reranking.
- Eval reports include recall, MRR, empty-result rate, citation precision, and permission-leak status.
- Existing keyword-only local behavior remains available for offline local mode behind the search adapter boundary.

Out of scope for this slice:

- Production vector database selection.
- Large-scale ingestion jobs.
- Model-graded answer quality.
- Enterprise connector catalog.

Decision:

- Introduce an independent search adapter early. SQLite FTS can still be one implementation, but RAG accuracy work should not couple retrieval strategy directly to `SqliteAgentStore`.

### Slice 6: Daemon-Ready Worker, Scheduler, and Remote Room Runner

Purpose: prepare workers, scheduler, and remote room runners for unattended local runs before distributed production infrastructure lands.

Deliverables:

- Worker runner, scheduler, and remote room runner service APIs that separate loop lifecycle from CLI command parsing.
- Health endpoint contract for worker, scheduler, remote agent, queue pressure, routed inbox, retry, and drain state.
- Graceful shutdown path that stops claiming new work or routed room messages, preserves active leases, and records drain metadata.
- Metrics event shape for queue depth, active leases, routed inbox polls, acknowledged messages, retries, failures, heartbeat age, and loop latency.
- Local foreground CLI commands continue to work through the same service APIs.

Acceptance criteria:

- A worker can enter drain mode and stop accepting new assignments while preserving auditable status.
- Scheduler ticks can report why work was or was not dispatched.
- A remote room runner can stop and restart without reprocessing acknowledged routed messages.
- Existing `agent workers`, `agent assignments`, and `agent scheduler` tests still pass.

Out of scope for this slice:

- OS service installation.
- Production supervisor integration.
- Redis/NATS/Postgres broker implementation.
- Distributed stale-worker recovery.

### Slice 7: TUI/Web Execution Inspection

Purpose: make local execution state easier for a human operator to understand.

Deliverables:

- TUI or CLI-interactive first pass for sessions, rooms, approvals, workers, assignments, and spec tasks.
- Web UI improvements for room timeline, task/spec progress, pending approvals, worker health, and recent audit events.
- Parallel TUI and Web UI planning so shared control-plane view models, status labels, and inspection concepts stay consistent.
- Clear display of paused, blocked, waiting-for-approval, draining, stale, retry-delayed, and failed states.

Acceptance criteria:

- A local operator can identify why a task is not progressing without reading SQLite tables or raw audit rows.
- Approval requests show enough context to approve or deny without exposing raw secrets.
- Worker and agent health views distinguish idle, stale, draining, saturated, and error states.

Out of scope for this slice:

- Authenticated multi-user Web UI.
- Desktop app.
- Real-time event streaming unless it is cheap to add after the service boundary is ready.

## Resolved Release 0.2 Planning Decisions

These decisions define the current Release 0.2 scope:

1. Product mainline: `soloclaw` terminal/TUN usability and cross-platform room collaboration are first-class roadmap drivers, not later polish.
2. Cross-machine shape: use a hub-and-room control plane before attempting direct peer-to-peer networking.
3. Storage sequence: define migrations, object storage, and broker abstractions before starting `PostgresAgentStore`.
4. MCP scope: support stdio and HTTP in the first execution MVP through one shared runtime boundary.
5. Local search backend: introduce an independent search adapter early; SQLite FTS is allowed only as an adapter implementation.
6. UI priority: advance Web UI and TUI in parallel, with shared status vocabulary and control-plane view models where possible.
7. Release boundary: Release 0.2 is a near-term slice bundle, not a separate product phase; it should harden Phase 1 and pull forward the Phase 2/3 foundations that make the local agent easier to inspect and operate.

## Remaining Questions

The release sequence is now clear enough to execute. The remaining questions are implementation choices that can be settled inside the relevant slice rather than blocking Release 0.2:

1. Migration tooling: keep the in-repo `MigrationRunner` contract as the first boundary, then decide whether PostgreSQL work needs an external migration library.
2. Durable local search: keep `LocalKeywordSearchAdapter` as the offline baseline, then add SQLite FTS only as a `SearchAdapter` implementation if the accuracy slice needs a durable local index.
3. Cross-platform packaging: start with npm/source and documented shell entrypoints, then choose dedicated Windows/Linux/macOS packaging and Android Termux packaging when daemon and config paths stabilize; native Windows/macOS/Android apps come after the control-plane contracts, security model, and update story are stable.
4. UI coordination: create operator view models in this order: approvals, worker/scheduler health, assignment/spec timeline, MCP health, audit summaries.

## Recommended Release 0.2 Sequence

Use this sequence for implementation. The order is deliberately biased toward making the product path usable, then reducing risk before adding more execution surface area.

### Step 0: Baseline and Task Split

Purpose: create a stable starting point for the larger alpha.

Do first:

- Run the full test suite and record the baseline command and result in the release notes or planning issue.
- Split the current large test file by domain only if it helps the first security slice; avoid broad test reorganization before new coverage lands.
- Create release tracking tasks for all seven slices and link each one to its acceptance criteria in this document.

Exit criteria:

- Baseline `npm test` is green.
- Release 0.2 has seven trackable work items with owners or owner modules.
- Any known failing, flaky, or skipped test is explicitly recorded.

### Step 1: Soloclaw Terminal/TUN Product Path

Purpose: make the path a user actually types in PowerShell, a Linux shell, a macOS shell, or Android Termux obvious and reliable before deeper distributed work lands.

Current progress:

- `package.json` exposes `soloclaw` as the primary binary and keeps `agent` as a compatibility alias.
- Running `soloclaw` with no arguments opens the local terminal workspace.
- `soloclaw tui`, `soloclaw ask`, `soloclaw doctor`, `soloclaw model list|use|setup`, and `soloclaw config path|show` provide short everyday commands over existing local services.
- Model provider defaults and custom compatible providers are stored in editable `.agent/model-providers.json` without raw API keys.

Implement next in this order:

1. Add workspace selection and recent-workspace commands to the terminal surface.
2. Add `soloclaw room` convenience commands over the existing `rooms` and `remote` flows.
3. Add `soloclaw agent status`, logs, and lifecycle vocabulary that can later back daemon mode.
4. Normalize human output and `--json` output across new short commands.
5. Document and smoke-test Windows PowerShell/CMD, Linux shell, macOS shell, and Android Termux usage.
6. Prepare packaging notes for install, config, cache, logs, and update paths.

Exit criteria:

- A fresh user can enter `soloclaw`, pick or confirm a workspace, configure a model, run `doctor`, and run a mock `ask` task without reading deep docs.
- Every short command calls the same underlying service path as its long-form command.
- Docs lead with `soloclaw`; `agent` remains documented as a compatibility alias.
- Cross-platform differences are explicit instead of implicit.

### Step 2: Security and Adversarial Regression Layer

Purpose: make the current local MVP harder to regress before MCP execution, search adapters, and UI surfaces expand the attack and inspection surface.

Current progress:

- Protected workspace path checks now normalize `.` / `..` segments before evaluating `.git` and `.agent` access, so `.agent/tmp/../...` cannot bypass the protected-path rule.
- Workspace text search excludes `.agent` as well as `.git`, preventing private agent state from appearing in search results.
- Regression coverage verifies dot-dot protected-path attempts and `.agent` search exclusion while preserving the `.agent/tmp` exception.

Implement in this order:

1. Secret-leak assertions for audit bundles, model metadata, RAG context attachments, room diagnostics, and summaries.
2. Prompt-injection workspace fixtures for protected path and policy bypass attempts.
3. RAG poisoned-document fixtures for annotate and exclude modes.
4. Plugin undeclared-capability tests.
5. Replay/tamper tests for room delivery, agent heartbeat, worker heartbeat, and task lease envelopes.

Exit criteria:

- New adversarial fixtures fail against at least one intentionally unsafe local test double or negative case.
- All current local policy and redaction paths have direct regression coverage.
- The suite remains fast enough for ordinary local development.

### Step 3: Production Boundary Design Pass

Purpose: define the interfaces that later slices should target, before MCP, RAG, worker, and UI work hard-code local implementation details.

Current progress:

- Added first-class `ArtifactStore`, `EventStream`, `MigrationRunner`, `SearchAdapter`, and `McpRuntime` contract files.
- Added contract coverage proving the new boundaries can express artifact content references, event subscription filtering, dry-run migrations, search adapter results, and MCP connection/tool/resource operations.

Implement in this order:

1. Review existing `AgentStore`, `TaskBroker`, `PolicyEngine`, `SecretBroker`, `WorkspaceRuntime`, and `ModelClient` contracts for accidental SQLite/local-process assumptions.
2. Finish broker semantics for claim, visibility timeout, delayed retry, poison/final failure, drain, and queue pressure.
3. Finish artifact semantics for local files, object-storage pointers, content hashes, retention metadata, and redaction/scanning status.
4. Finish migration semantics for SQLite local mode and future PostgreSQL private mode.
5. Update the replacement ledger with owner modules and replacement triggers for every Release 0.2 boundary.

Exit criteria:

- Later Release 0.2 slices can depend on interfaces instead of concrete SQLite, local HTTP, or filesystem-specific classes.
- `docs/replacement-ledger.md` names owner modules for new temporary boundaries.
- Contract tests exist for at least broker, artifact store, MCP runtime, and search adapter behavior.

### Step 4: MCP Execution MVP

Purpose: add external capability execution after the policy and boundary layer is ready.

Current progress:

- `McpRuntime` has shared request/result types and contract coverage.
- `LocalMcpRuntime` implements stdio and HTTP JSON-RPC paths for `initialize`, `tools/list`, `tools/call`, `resources/list`, and `resources/read`.
- Runtime outputs are bounded and passed through the local redactor; leased env values supplied at connection time are registered as known secrets and are not exposed in connection metadata.
- `McpExecutionService` wraps the runtime with `McpConnectionPlanner`, `PolicySecretBroker`, `mcp.tool.call` / `mcp.resource.read` policy checks, lease revocation, and `mcp.executed` audit summaries.
- CLI smoke paths exist for `agent mcp capabilities`, `agent mcp call-tool`, and `agent mcp read-resource`; env-var secrets are supplied by explicit secret refs such as `--secret-env MCP_TOKEN=sec_xxxxxxxx` or `MCP_SECRET_MCP_TOKEN`.
- `AGENT_MCP_EXECUTION=disabled` globally blocks execution without deleting registry entries; the service still records a safe blocked audit event after planning.
- Timeout and transport failures are classified in `mcp.executed` audit metadata without raw output or secret values, and initialize failures clean up stdio subprocesses.
- `ask` decisions create MCP-specific approval requests with a bound continuation payload; `agent approve <approval-id> --auto-replay` can resume the approved MCP operation.
- `McpHealthService` and `agent mcp health <server-id> [--json]` provide safe status diagnostics for healthy, disabled, blocked, timeout, and failed server states without exposing raw tool/resource output.
- Regression coverage verifies stdio tool/resource execution, HTTP tool/resource execution, shared capability listing, output redaction, safe connection metadata, service-level secret lease/audit behavior, CLI execution smoke paths, global disable, timeout failure audit, and ask/approve/replay continuation.

Implement next in this order:

1. Add agent-tool integration behind explicit capability grants rather than exposing MCP servers as direct room members.
2. Add sandbox/process/network constraints around stdio and HTTP transports.
3. Add Web/API execution surfaces once shared operator view models are ready.
4. Add signed approval envelopes and stronger quorum continuation for production rooms.

Exit criteria:

- MCP execution is denied by default.
- stdio and HTTP use the same policy and audit path.
- Tool/resource outputs are bounded, redacted, and audited by summary.
- Registry/planning-only behavior still works when execution is disabled.

### Step 5: RAG Search Adapter and Accuracy Alpha

Purpose: decouple retrieval strategy from storage and add accuracy checks without weakening ACL or safety filtering.

Current progress:

- Added `LocalKeywordSearchAdapter` as the first real `SearchAdapter` implementation.
- `KnowledgeService.search` now builds ACL-filtered search documents before invoking the adapter, preserving the rule that inaccessible chunks are filtered before ranking and final context packing.
- Adapter diagnostics now feed search audit metadata for unsafe candidates, safety exclusions, and search mode.
- Regression coverage verifies that adapter-backed retrieval still honors ACL filtering before the adapter sees documents.
- `KnowledgeService.evaluate`, persisted eval runs, trend deltas, and CLI output now include citation precision plus permission-leak rate/count gates. Eval cases can declare `forbiddenSourceIds` or `forbiddenChunkIds`.

Implement in this order:

1. Add a durable local implementation choice, preferably SQLite FTS only as an adapter, not as direct `SqliteAgentStore` coupling.
2. Add hybrid merge and deterministic ranking tests.
3. Add embedding provider and reranker interfaces with mock implementations.
4. Extend eval fixtures toward answer-level citation precision, source freshness, and prompt-injection corpora.
5. Add signed or tamper-evident eval report shape once the artifact boundary is ready.

Exit criteria:

- ACL filtering still happens before final context packing.
- Keyword-only local mode remains available.
- Hybrid retrieval can be tested without committing to a production vector backend.
- Eval output reports recall, MRR, empty-result rate, citation precision, and permission-leak status.

### Step 6: Daemon-Ready Worker, Scheduler, and Remote Room Runner

Purpose: prepare for unattended local and cross-machine room execution while avoiding premature production supervisor decisions.

Decision: implement daemon-ready lifecycle APIs now, plus a minimal wrapper shape for testing and documentation. Defer OS service installation, native Android service integration, external supervisors, and production deployment wiring.

Current progress:

- Added `DaemonLifecycleController` with shared scheduler/worker lifecycle phases, start/tick/idle/drain/shutdown/stop events, stop reasons, and loop metrics.
- `LocalSchedulerService.run` now accepts an optional lifecycle controller, reports lifecycle snapshots, honors explicit shutdown requests, and attaches aggregate run metrics.
- Scheduler tick results now include duration and metrics for loop latency, recovered leases, retries, drain blockers, heartbeat rejections, health warning counts, worker polling, assignment completions, and idle detection.
- `LocalWorkerRunner.poll` now reports lifecycle snapshots and aggregate metrics, emits idle lifecycle events, and honors explicit shutdown requests before claiming new work.
- `LocalWorkerRunner.runOnce` can run under the same lifecycle controller for supervised single-assignment execution.
- Worker in-flight shutdown policy is explicit: preserve the running lease, release the lease while leaving the target runnable, or pause the target.
- Scheduler lifecycle metrics now include queue depth, active leases, delayed retries, and max worker heartbeat age when a worker health summary provider is available.
- Regression coverage verifies scheduler and worker idle-stop lifecycle events, shutdown-before-claim handling, all three in-flight shutdown policies, and health-derived scheduler metrics without spawning a long-lived process.

Implement in this order:

1. Keep existing foreground CLI commands wired through the same APIs.
2. Add remote room runner lifecycle snapshots, heartbeat/log/status reporting, and clean shutdown semantics.
3. Keep scheduler, worker, and remote runner lifecycle snapshots feeding the shared operator view model from Step 7.

Exit criteria:

- CLI behavior remains compatible.
- Worker, scheduler, and remote runner loops can be tested without spawning long-lived shell processes.
- Operators can see why work is idle, delayed, blocked, draining, or failed.
- No production service manager is required for Release 0.2.

### Step 7: Shared Operator View Models

Purpose: let Web UI and TUI move in parallel without duplicating state interpretation.

Current progress:

- Added `src/operator/operator-view-models.ts` as the first shared interpretation layer for Web UI and TUI.
- The shared model maps approvals, assignments, workers, agents, sessions, specification progress, scheduler tick audit summaries, recent audit summaries, artifacts, retention policies, local queue pressure, and optional MCP health checks into common operator statuses: `waiting_for_approval`, `queued`, `running`, `paused`, `retry_delayed`, `draining`, `blocked`, `saturated`, `stale`, `failed`, `completed`, `offline`, and related health states.
- `ControlPlaneService.getState()` now exposes `/api/state.operator` alongside the raw local state, so Web and TUI clients can start from the same status vocabulary, queue diagnosis, and MCP health projection.
- `ControlPlaneService.getOperatorDetail()` and `src/operator/operator-detail.ts` provide the shared linked-drilldown path for Web and CLI/TUI clients, including stable `detailSections`, type-specific worker/agent/assignment/spec/MCP sections, `sourceSummaries`, raw source records, and MCP-specific registry/latest-health sources.
- The local Web UI now renders an operator summary, queue diagnosis, worker list, assignment list, spec progress, scheduler tick summaries, recent audit summaries, agent-health item list, artifact warnings, retention policy warnings, and MCP health items from `/api/state.operator`, uses operator view items for approval/session status, reason, and next-action text, can fetch `/api/operator/items/:itemId` to inspect the selected item through prioritized type-specific detail panels, source summary rows, and collapsible raw source records, and exposes an explicit MCP health refresh action for operator-triggered probes.
- `src/operator/operator-rows.ts` defines the shared row/filter contract for Web and TUI clients. `agent operator status --rows --json` and `GET /api/operator/rows` both return the same `{ ordinal, section, item }` order, filters, per-section limit behavior, and permission-filtered item projection.
- `agent operator status [--json] [--limit n]` is the CLI-interactive first pass for the same model; text mode groups queue, approvals, sessions, assignments, workers, agents, specs, scheduler, audit, artifacts, retention, and MCP items, supports `--kind`, `--status`, `--severity`, `--id`, and `--details`, and prints stable visible-row numbers for keyboard-friendly selection, while JSON mode returns either the full shared operator view, filtered item lists, or `--rows --json` records with the same `{ ordinal, section, item }` order a richer TUI needs.
- `agent operator show <item-id-or-ref-id> [--json]` and `agent operator show --select <n> [--kind kind] [--status status] [--severity severity] [--json]` use the same linked drilldown builder: operators can jump from a shared status item, referenced source id, or nth visible filtered status row into source summaries plus related session, worker, agent, assignment, artifact, retention, room, spec, and audit records when present.
- `src/operator/operator-access.ts` defines the first shared operator projection boundary: diagnostic mode preserves refs, metadata, and raw source records for local operators, while public mode removes item refs/metadata, Refs/Metadata sections, raw source records, and missing-ref diagnostics for future permission-filtered Web/TUI surfaces. The local control-plane API exposes this through `?operatorView=public`, and CLI/TUI exposes it through `agent operator ... --public`; actor-aware requests through `operatorActor` or `--actor` now downgrade non-local actors to public unless they hold `operator.diagnostic` on the first-class `operator:local` capability scope.
- The control plane reads the local MCP registry and runs bounded `McpHealthService` checks for operator state without recording polling-driven plan audit events; disabled, blocked, timeout, failed, and healthy results map into `/api/state.operator.mcp`, with short-lived cache entries, exponential backoff for failed/timeout probes, and `POST /api/operator/mcp/:serverId/refresh` for explicit operator-triggered refreshes that are audited as control-plane actions.
- Regression coverage verifies pure status mapping, MCP health projection, registry-backed control-plane MCP health projection, MCP health cache reuse without polling audit churn, explicit MCP health refresh, MCP detail sources, shared type-specific detail sections, queue pressure projection, Web state exposure, Web template/detail hooks, CLI operator rendering/filtering/details/show drilldowns, and the control-plane `/api/state.operator` smoke path.

Implement in this order:

1. Replace local token auth with real authenticated users/agents before exposing the Web UI beyond local development.
2. Expand the row-oriented TUI contract into interactive navigation once the terminal UI shell exists.

Exit criteria:

- Web UI and TUI show the same meaning for paused, blocked, waiting-for-approval, draining, stale, retry-delayed, saturated, and failed states.
- Approval views expose enough context for decisions without raw secrets.
- A local operator can diagnose a stuck task without reading raw SQLite rows.

### Step 8: Release Closure

Purpose: make the larger alpha coherent rather than seven unrelated feature branches.

Do last:

- Run full tests.
- Run CLI smoke paths for MCP, knowledge eval, workers/scheduler, approvals, rooms, specs, and Web state API.
- Update README highlights if the user-facing behavior changed.
- Update topic docs and `docs/replacement-ledger.md` for every temporary implementation introduced.
- Add a short Release 0.2 status note to this roadmap: completed, deferred, or intentionally partial for each slice.

Exit criteria:

- All seven slice acceptance criteria are met or explicitly deferred with reason.
- Replacement ledger is current.
- No new execution capability lacks policy, audit, redaction, and tests.
- The next milestone can start from production storage/broker implementation rather than another planning cleanup pass.

## Milestone A: Local Professional MVP

Expected: 6-8 iterations total.

Status: in progress.

1. Project skeleton and local agent loop.
   - Status: done.
   - Includes CLI, model abstraction, workspace tools, local runtime.

2. Production domain foundation.
   - Status: done.
   - Includes org/project/session/agent/room/policy/audit/secret/git types.

3. SQLite persistence and resume.
   - Status: done.
   - Includes `.agent/agent.db`, sessions, messages, tool calls, room tables.

4. Policy enforcement and audit.
   - Status: in progress.
   - Gate shell/write/secret/plugin actions before execution.
   - Record policy decisions and tool audit events.
   - Current: policy wrapper gates workspace tools, records audit events, and creates approval requests. CLI can list, approve, and deny approvals.
   - Current: approved tool calls can be replayed by approval id and still record file changes/audit events.
   - Current: room-scoped tool approval requests, decisions, and replay results are posted into room transcripts.
   - Current: room-scoped approval decisions require `tool.approve` capability from the deciding room member.
   - Current: capability grants are integrated into the runtime policy engine for org/project/room/session scoped actions; `strict` mode still forces approval, while `agent.super_approve` is required to bypass critical-risk approval prompts.
   - Current: agent sessions pause on `approval_required`; `approve --auto-replay --auto-resume` executes the approved tool, appends the real tool result, and resumes the session, while `approve --queue-resume <worker-id>` replays the approved tool and queues the paused session through the local task broker for worker continuation.
   - Current: CLI resume supports `--workspace`, `--json`, `--session-result`, and `--verify-session`, so resumed work can return a machine-checkable outcome package.
   - Current: local CLI can list and export audit events with filters to JSONL, JSON, or signed bundle JSON.
   - Current: signed audit export bundles include filter metadata, event count, SHA-256 over canonical event JSON, local-agent Ed25519 signature, and `agent audit verify <bundle-path>` tamper checks.
   - Next: productionize approval continuation with broker visibility timeouts, retry/failure policy, and distributed lease enforcement, then add retention-aware export jobs, SIEM sinks, legal hold integration, and admin review workflows.

5. Patch/write workflow.
   - Status: in progress.
   - Add robust `apply_patch` or file-range edit tools.
   - Add file-level write locks.
   - Record file changes.
   - Current: `create_file` and `replace_range` tools support policy checks, file-level locks, hashes, and `file_changes` records.
   - Current: `apply_patch` accepts conservative unified diffs for create/modify/delete inside the workspace, validates protected paths and hunk context before writing, rejects renames for now, and returns per-file before/after hashes.
    - Current: workspace `apply_patch` tool records session-scoped `patch` file changes, uses the same file lock path as other writes, and command execution records `command.started`/`command.finished` audit events with exit code, output byte counts, duration, timeout metadata, and local execution profile metadata.
    - Current: `agent session diff <session-id> [--json]` and TUI `/session diff <session-id> [--json]` reuse session audit to inspect successfully completed `apply_patch` unified diffs, changed paths, per-file additions/deletions, change type, patch count, review size, review hint, and aggregate review profile for review, excluding pending approval requests that have not executed.
    - Current: `agent session status <session-id> [--json] [--limit n]` and TUI `/session status <session-id> [--json] [--limit n]` return a daemon-ready snapshot of outcome, command counts, pending approvals, execution profiles, handoff summary, inspection summary, and latest safe timeline items.
    - Current: `agent session inspect <session-id> [--json]`, TUI `/session inspect <session-id> [--json]`, and token-gated `GET /api/sessions/:sessionId/inspect` return a focused inspection package with state, summary, required/warning/info issues, focus paths, safe signals, next actions, and review commands for CLI/TUI/Web reuse; the Web console can open it from the Sessions list.
    - Current: `agent sessions [--json] [--limit n] [--status status] [--target-mode mode]` builds a local session dashboard from the same session status view, returning per-session outcome, pending approvals, command/change counts, latest timeline items, and review commands for CLI/TUI reuse.
    - Current: `agent local status [--json] [--limit n]`, `soloclaw agent status [--json] [--limit n]`, and TUI `/agent status` aggregate recent sessions, pending approvals, worker registrations, assignment queue/load state, next commands, and a structured required/recommended/blocked runbook into one daemon-ready local status view; TUI `/approvals [status]`, `/approve <approval-id> [reason]`, and `/deny <approval-id> [reason]` list and manually decide approval requests through the same scoped approval/audit path.
    - Current: `agent local logs [--json] [--limit n]`, `soloclaw agent logs [--json] [--limit n]`, and TUI `/agent logs` merge safe audit, file-change, approval, and approval-decision items across recent local sessions for foreground supervision and future TUI/Web log panels.
    - Current: `agent session timeline|logs <session-id> [--json] [--limit n]` and TUI `/session timeline|logs <session-id> [--json] [--limit n]` combine audit events, file changes, approval requests, and approval decisions into an ordered engineering log with safe metadata.
    - Current: `agent session review <session-id> [--json] [--limit n]` and TUI `/session review <session-id> [--json] [--limit n]` package review state, checklist, changed paths, diff stats, file summaries, review profile, patch excerpts, commands, recovery, approvals, handoff state/next command, latest timeline, operator next actions, and follow-up commands for operator handoff.
    - Current: `agent session result <session-id> [--json]` and TUI `/session result <session-id> [--json]` combine session report and diff evidence into an operator-facing outcome, recovery, command, approval, patch, diff-stat, file-summary, review-profile, changed-file, handoff, and next-action summary.
   - Current: `agent session verify <session-id> [--json] [--require-change] [--require-patch] [--require-recovery] [--require-timeout] [--require-diff-stat] [--require-review-profile] [--require-model-call] [--require-no-pending-approvals] [--require-execution-profile profile] [--require-approval-action action]` turns persisted engineering evidence into a non-zero-exit verification gate for CI and release smoke use, including timeout, diff-stat, review-profile, successful model-call, no-pending-approval, execution-profile, and specific approval-action requirements.
   - Current: `agent run --json --session-result --verify-session` returns the completed session, final answer, session result, verification checks, and follow-up review commands from one end-to-end run invocation.
   - Current: `agent run|ask|plan|build|goal --require-model-ready` checks provider/model/base URL/API-key env or secret-ref readiness before opening a session and returns a blocked JSON/text result when real-model configuration is incomplete.
    - Current: `agent resume <session-id> --require-model-ready` checks the same provider/model/base URL/API-key env or secret-ref readiness before a paused session is continued, returning blocked metadata without advancing the session when configuration is incomplete.
    - Current: `agent resume <session-id> --json --session-result --verify-session` returns the resumed session, final answer, session result, verification checks, and follow-up review commands from a durable paused session.
    - Current: `agent plan|build|goal --json --session-result --verify-session --allow-no-command` returns target-mode sessions, outcomes, verification checks, and follow-up review commands.
    - Current: workspace command policy distinguishes safe shell, dependency installs, raw Git mutations, and high-risk shell commands, requiring approval for dependency/Git/high-risk boundaries in trusted and balanced execution modes; balanced workspace writes also require approval.
    - Current: `agent session report <session-id>`, `agent session result <session-id>`, and `agent session inspect <session-id>` include session-scoped approval counts, pending approval details, command durations, timed-out command counts, command execution profile counts, diff stats, file summaries, review profiles, metadata-only model usage, and an inspection summary with blocking/warning/info issues and focus paths; `agent session status`, `agent session review`, `agent session result`, and `agent session bundle` also include handoff state/next-command metadata alongside operator next actions.
    - Current: `agent phase2 verify --json --cleanup` exercises disposable sample repos from failing test to patch to passing test, including mock agent-loop repair, resume evidence, queued approval continuation, TUI approval list/approve/deny decisions with `tool.approved` / `tool.denied` audit evidence, a failing no-pending-approval verification gate while policy approvals remain unresolved, and a passing no-pending-approval handoff gate after approvals are resolved, plan/build/goal target-mode paths, fail-fast real-model readiness gating for new and resumed sessions, command timeout/profile/diff-stat/file-summary/review-profile/model-call-gate/timeline/status/session-list/session-inspection/session-inspect-command/control-plane-session-inspection/local-agent-status/daemon-readiness/local-agent-runbook/local-agent-logs/foreground-daemon-lifecycle/review/bundle/operator-handoff/operator-next-action evidence, and workspace-write/dependency-install/Git-mutation/high-risk-shell policy approval evidence, and reports `phaseClosure: "partial"` with file-change, command-audit, tool-audit, approval, timeout, profile, diff-stat, file-summary, review-profile, model-call, timeline, status, inspect, control-plane inspection, session-list, local-agent status/logs, daemon-readiness, daemon-runbook, foreground scheduler-run lifecycle/metrics, review, bundle, handoff, next-action, and tool-result evidence. The session bundle now includes local status/log snapshots, and the model-call gate is applied to run-session, plan/build/goal target-mode, and mock agent-loop repair paths.
   - Current: local file-level locks use SQLite-backed leases in `.agent/agent.db`, so separate CLI/agent processes coordinate same-file writers.

6. Real model providers.
   - OpenAI-compatible and Anthropic-compatible hardening.
   - Add provider configs for OpenAI, Anthropic, DeepSeek, GLM, MiniMax, Grok, MiMo.
   - Add retries, rate-limit handling, fallback routing.
   - Current: provider profiles for OpenAI, Anthropic, Grok/xAI, MiniMax, DeepSeek, GLM, MiMo, OpenAI-compatible, and Anthropic-compatible endpoints register real HTTP clients with default base URLs, default model names, and API key env aliases.
   - Current: `agent models profiles list/set/remove` manages local `.agent/model-providers.json` overrides for protocol, base URL, default model, and API key env names without storing raw secrets.
   - Current: OpenAI-compatible and Anthropic-compatible providers can read API keys from encrypted local secret refs with `--api-key-secret`; known OpenAI-compatible profiles use the same broker path when selected.
   - Current: `agent run|ask|plan|build|goal --require-model-ready` and `agent resume --require-model-ready` reuse the metadata-only model readiness check and treat `--api-key-secret` as a configured key reference without printing the secret id or value.
   - Current: OpenAI-compatible and Anthropic-compatible HTTP clients retry transient network, 408/409/425/429, and 5xx failures with bounded exponential backoff and `Retry-After` support; non-retryable provider errors fail immediately.
   - Current: `agent run` accepts `--model-retries`, `--model-retry-base-ms`, `--model-retry-max-ms`, and repeated `--fallback-provider` entries; fallback routing only handles transient provider errors and does not mask bad credentials or request/configuration failures.
   - Current: `agent run` accepts local guard knobs `--model-call-budget`, `--model-failure-budget`, `--model-circuit-break-after`, and `--model-circuit-open-ms`; `GuardedModelClient` blocks exhausted budgets and opens an in-process circuit after repeated failures.
   - Current: HTTP model clients attach safe provider telemetry metadata when available: provider request id, provider response id, provider response model, and provider-reported token usage.
   - Current: `AgentLoop` records `model.called` audit events for plan/build/goal calls with actor, session scope, provider/model labels, fallback provider list, target mode, input/output size metadata, duration, success/failure, response type, safe error class, provider request ids, and token usage without storing prompts, responses, tool inputs, or secret material.
   - Current: `agent models usage` summarizes local `model.called` audit events by provider/model, including calls, failures, provider-reported token usage, duration, and optional caller-supplied cost estimates; session report/result/status/review/bundle views also aggregate the same metadata by session id.
   - Next: provider-specific adapters for DeepSeek/GLM/MiniMax/Grok/MiMo where APIs diverge, tenant-scoped provider registry, distributed rate-limit budgets, durable metrics, provider price tables, streaming responses, and policy-aware model routing.

7. TUI and session UX.
   - Show sessions, active task, tool calls, approvals.
   - Pause/resume/cancel commands.
   - Current: CLI has pause/cancel commands, resume records audit and rejects completed/cancelled sessions.
   - Current: local control-plane API exposes session pause/resume/cancel and audits operator actions.
   - Current: approval-blocked sessions are paused instead of incorrectly completing, and can be resumed after approved tool replay.
   - Current: `agent session diff <session-id> [--json]` and TUI `/session diff <session-id> [--json]` extract persisted `apply_patch` unified diffs from session audit, map them to changed paths, report per-file additions/deletions, change type, patch count, review size, review hint, and aggregate review profile, and print patch text for review.
    - Current: `agent sessions [--json] [--limit n] [--status status] [--target-mode mode]` gives daemon/TUI/Web callers a recent-session dashboard with the same outcome and review-command vocabulary as `agent session status`.
    - Current: `agent local status [--json] [--limit n]` / `soloclaw agent status [--json] [--limit n]` / TUI `/agent status` gives everyday operators a single local status surface across sessions, workers, assignments, approvals, queue load, follow-up commands, and a daemon runbook; TUI `/approvals`, `/approve`, and `/deny` let the same operator list and manually decide approvals without leaving the interactive shell.
    - Current: `agent local logs [--json] [--limit n]` / `soloclaw agent logs [--json] [--limit n]` / TUI `/agent logs` gives everyday operators a merged safe log across local session audit, file-change, and approval evidence.
    - Current: `agent session report <session-id> [--json]` summarizes persisted engineering evidence for a session, including messages, tool results, file changes, changed paths, command audit, command durations/timeouts, command execution profiles, diff stats, file summaries, aggregate review profile, approvals, failed tool results, failed command exits, and metadata-only model usage.
    - Current: `agent session status <session-id> [--json] [--limit n]` and TUI `/session status <session-id> [--json] [--limit n]` give daemon/TUI/Web callers a compact status document with handoff summary, latest timeline entries, and review commands.
    - Current: `agent session inspect <session-id> [--json]`, TUI `/session inspect <session-id> [--json]`, and `GET /api/sessions/:sessionId/inspect` give daemon/TUI/Web callers a narrow inspection document with issue severity counts, focus paths, safe signals, next actions, and follow-up review commands, with Web panel rendering for recent sessions and a direct interactive TUI command.
    - Current: `agent session timeline|logs <session-id> [--json] [--limit n]` and TUI `/session timeline|logs <session-id> [--json] [--limit n]` give operators an ordered safe log across audit events, file changes, approvals, and approval decisions.
    - Current: `agent session review <session-id> [--json] [--limit n]` and TUI `/session review <session-id> [--json] [--limit n]` give operators one review package across checklist, changes, diff stats, file summaries, commands, recovery, approvals, handoff state/next command, latest safe timeline, operator next actions, and follow-up commands.
    - Current: `agent session result <session-id> [--json]` and TUI `/session result <session-id> [--json]` summarize persisted engineering outcomes for a session, including succeeded/failed/paused/cancelled status, whether failed commands recovered, changed files, patch count, diff stats, file summaries, command exits, command durations/timeouts, command execution profiles, approvals, metadata-only model usage, inspection issues/focus paths, handoff state/next command, next actions, and review commands.
    - Current: `agent session verify <session-id> [--json] [--require-change] [--require-patch] [--require-recovery] [--require-timeout] [--require-diff-stat] [--require-review-profile] [--require-model-call] [--require-no-pending-approvals] [--require-execution-profile profile] [--require-approval-action action]` reports individual pass/fail evidence checks and exits non-zero when the requested gate is not satisfied.
    - Current: `agent session bundle <session-id> [--json] [--output path] [verification options]` exports diff, report, session status, timeline, review, result, local status/log snapshots, metadata-only model usage, inspection summary, handoff summary, next actions, and verification evidence in one workspace-local JSON package.
   - Current: `agent run --json --session-result --verify-session` closes the loop from task invocation to persisted session, outcome summary, verification result, and review commands without requiring the user to discover the session id separately.
   - Current: `agent resume <session-id> --json --session-result --verify-session` gives the same outcome and verification package after a paused session is continued; `--require-model-ready` can gate resumed real-model work before any continuation.
   - Current: `agent plan|build|goal --json --session-result --verify-session --allow-no-command` proves all local target modes can produce persisted sessions and verification packages.

8. Sub-agent delegated sessions.
   - Status: in progress.
   - Spawn child sessions for subtasks.
   - Keep child transcripts separate from parent context.
   - Return compact child result summaries.
   - Prepare room-linked delegation events.
   - Current: local CLI delegation creates a child session and records subtask/session link data.
   - Current: `delegate --room <room-id>` adds the assigned agent as room executor and writes assignment/result messages to the room transcript.

9. Skills and basic persistent memory.
   - Status: in progress.
   - Load local/builtin skills.
   - Store session summaries and manual project memories.
   - Retrieve relevant safe memories during context assembly.
   - Current: local `.agent/skills` loader, SQLite skill store, manual memory add/list/delete, session summary storage, and context injection with `--skill`.
   - Current: session compaction can generate durable summaries and remove hot message/tool-call transcripts.
   - Current: `agent session compact` and retention sweep provide a local manual/policy-triggered compaction path.
   - Next: add context-window-aware automatic compaction, incremental model-generated summaries, summary quality checks, and resumable context assembly that injects summaries before recent hot messages.

10. Local secret hardening.
   - OS keychain integration or encrypted local fallback.
   - Redaction pipeline around tool outputs and model context.
   - Current: `EncryptedFileSecretStore` stores local secrets in `.agent/secrets.vault.json` using AES-256-GCM and `AGENT_SECRETS_PASSPHRASE`.
   - Current: CLI supports `agent secrets put/list/get/delete`; secret values are hidden unless `--reveal` is explicit.
   - Current: `PolicySecretBroker` gates local secret reads through `secret.read`, records `secret.accessed` / `secret.denied` audit events, redacts sensitive request metadata, and is used by `agent secrets get` plus model `--api-key-secret` resolution.
   - Next: persistent redaction registration, OS keychain backend, per-session/per-agent credential routing, production approval continuation for secret reads, rotation, and distributed lease revocation.

## Milestone B: Local Team Alpha

Expected: additional 5-7 iterations.

11. Room MVP.
   - Create room, invite by fingerprint, join approval, transcript.
   - Humans can speak or observe.
   - Link room tasks to parent/child sessions.
   - Current: local CLI supports room create/list/show, join request, join approval, active-member messages, observer read-only enforcement, and persisted transcripts.
   - Current: room transcript includes local sub-agent delegation assignment/result events.
   - Current: local agent room messages are Ed25519 signed, and `rooms verify` checks transcript signatures.
   - Current: fingerprint allowlist rooms can auto-activate registered agents by fingerprint.
   - Current: invite tokens are persisted by hash and can activate joining members with role/TTL/max-use limits through CLI or local control-plane API; local-agent-issued invites store signed envelopes over immutable invite metadata without raw tokens; rooms can require valid signed invite envelopes before token activation; `agent rooms invites` reports signature status; `agent rooms revoke-invite` and the control-plane API can revoke active invites through `room.member.invite`, blocking later token joins and emitting `room.invite.revoked`.
   - Current: room transcript records local tool approval request/decision/replay events.
   - Current: local role-to-capability checks gate room invites, join approvals, messages, and room-scoped tool approvals.

12. Agent identity.
   - Generate keypair, fingerprint, signed heartbeats, trust states.
   - Current: local Ed25519 identity generation, SQLite agent registration, `identity show`, `agents`, and default sub-agent identity wiring.
   - Current: local identity signs agent room messages, task lease envelopes, and worker heartbeat envelopes; revocation remains future work.
   - Current: local identity fingerprint can be inserted into room allowlists with `--allow-local-agent`.
   - Current: local control-plane API can register remote agent public identities as `pending`, recompute fingerprints, list/fetch agents, and reject same-agent key takeover attempts.
   - Current: `agent remote enroll` wraps the local cross-machine bootstrap flow by registering the caller's public identity with a control-plane URL and joining a room via invite token as that agent.
   - Current: `RemoteRoomRunner` backs `agent remote inbox`, `agent remote ack`, bounded `agent remote poll`, and foreground supervised `agent remote run`, letting an enrolled remote agent consume only its routed @/role/wide-policy wake-up messages, submit signed delivery acknowledgements, stop on idle cycles, and retry transient control-plane failures with backoff without loading the full room transcript into its execution loop.
   - Current: professional rooms default to `mentions_only` attention, so ordinary transcript messages do not wake every active agent unless the room explicitly opts into broadcast behavior.
   - Current: routed room inbox messages include a derived `activationContext` with wake reason, matched routing target, current message, bounded recent transcript window, and acknowledgement policy for agent execution loops.
   - Current: room messages with unresolved, ambiguous, inactive, unknown, or empty wake targets carry signed `routingDiagnostics`, print CLI warnings, render Web UI transcript warnings, and emit `room.routing.warning` audit events without waking fallback agents.
   - Current: `agent remote heartbeat`, `POST /api/agents/:agentId/heartbeat`, and `RemoteRoomRunner.run` submit signed `AgentHeartbeatEnvelope` records for remote-agent health; the local control plane verifies signatures, rejects nonce replay, updates SQLite agent health fields, and audits summary metadata.
   - Current: `AgentHealthService`, `agent agents health`, `GET /api/agents/health`, and `/api/state.agentHealth` derive local `online` / `idle` / `running` / `error` / `stale` / `offline` / `unknown` summaries from heartbeat rows for room-console monitoring.
   - Next: add production remote-agent daemon sessions, health streaming, stale-agent recovery, signed key rotation/revocation, and Web UI status views.

13. Local room Web UI.
   - Dedicated local port showing rooms, joined rooms, active discussion, approvals.
   - Current: `agent web` starts a Node HTTP local console with token-gated room list, invites, members, transcript, derived agent health panel, shared-operator summary, operator-backed worker/agent/assignment/spec/scheduler/audit/artifact/retention status panels, pending approvals, recent sessions, room message send, invite revocation, approval/deny actions, and session pause/resume/cancel controls.
   - Current: the web console is backed by a reusable local control-plane service that exposes JSON endpoints for health, state, rooms, sessions, session lifecycle, approvals, artifacts, retention policies, and audit events.
   - Next: add real-time updates, room-scoped approval envelopes, and richer task/session inspection.

14. GitHub/GitLab PR workflow.
   - Branch/worktree, commit, push, open PR/MR.
   - PAT for personal mode; app/token abstraction for production.
   - Current: local CLI `agent git status` detects branch, dirty files, remote provider, and repository slug.
   - Current: local CLI `agent pr prepare` creates a dry-run PR/MR plan, can optionally create/switch branch, commit, push, generates GitHub/GitLab create URLs, records audit, and policy-checks real Git mutations.
   - Next: provider API adapters for GitHub/GitLab, stored PR/MR refs, webhook/CI iteration, isolated worktrees.

15. Task operations.
   - Pause/resume/cancel with durable checkpoints.
   - Retry policies and workspace leases.
   - Current: local task lifecycle service records pause/cancel/resume audit events and centralizes resumability rules.
   - Current: manual pause/cancel releases active session assignment leases and worker load when the platform task service is wired to the local assignment service.
   - Current: control-plane pause/cancel uses the same assignment-release path; control-plane resume marks a session runnable and can optionally auto-run the local agent.
   - Current: sessions persist `targetMode = plan|build|goal`; `plan` disables tools and produces a plan only, `build` keeps the existing bounded tool loop, and `goal` uses a goal-oriented prompt plus a higher local step limit.
   - Next: add durable goal plans, specifications, checkpoints, blockers, budget/stop policy, and worker-driven goal continuation.

16. Spec-driven development.
   - Native specification, plan, task, and verification workflow for goal mode.
   - Compatible with `github/spec-kit` without making it a core dependency.
   - Current: design documented in `docs/spec-driven-development.md`; integration boundary is `.agent` native state plus optional `.specify` import/export.
   - Current: local native skeleton has `Specification` / `SpecificationTask` / `SpecificationVersion` / `SpecificationPlan` / `SpecificationClarification` / structured verification domain types, SQLite/memory store support, `SpecificationService`, `agent spec create/list/show/version/versions/diff/plan/plans/request-plan-approval/clarify/clarifications/answer/task/tasks/validate/next/status/verify/evidence/verifications/delegate/dispatch`, spec audit events, and `agent goal --spec <id>` context injection.
   - Current: `agent spec delegate <spec-id> <task-id>` creates an executable subtask plus paused child goal session; assignment completion/failure updates the linked spec task.
   - Current: spec task dependencies must reference existing tasks in the same spec, and delegation is blocked until every dependency is `completed`.
   - Current: `agent spec next <spec-id>` lists pending tasks whose dependencies are complete.
   - Current: `agent spec dispatch <spec-id> --worker <worker-id>` delegates ready tasks and assigns them to a worker.
   - Current: `agent spec dispatch <spec-id> --auto-select-worker` chooses an online, non-full, project-eligible worker by lowest load ratio.
   - Current: spec dispatch supports pre-delegation local backpressure with max projected load ratio and max active assignments per worker; scheduler dispatch can pass the same guards.
   - Current: `agent scheduler tick|run --dispatch-spec <spec-id>` can dispatch ready spec tasks before worker polling.
   - Current: `agent spec verify <spec-id> <task-id> passed|failed <evidence>` records durable local verification records; tasks with `verification` requirements are blocked from completion until persisted passed evidence exists.
   - Current: `agent spec evidence <spec-id> <task-id>` records structured GitHub/GitLab/generic provider evidence, maps successful conclusions to passed verification, and registers report artifacts for run URLs.
   - Current: `agent spec version <spec-id>` creates a durable local snapshot of the spec and tasks; `agent spec clarify/answer/clarifications` tracks planning questions through open, answered, and resolved states.
   - Current: `agent spec diff <spec-id>` compares frozen versions or a frozen version against current state, reporting spec field changes and added/removed/changed tasks; `--save-artifact` persists that diff as an auditable report artifact with SHA-256 and room progress refs.
   - Current: `agent spec plan <spec-id>` creates a durable local generated plan from current spec state or a frozen version, including dependency-ordered steps, verification hints, risk hints, and open clarification blockers.
   - Current: `agent spec request-plan-approval <spec-id> <plan-id>` creates a scoped approval request, and dispatch can require an active approved plan via `--plan <plan-id> --require-plan-approval`; plan dispatch can require distinct-approver quorum from `--required-plan-approvals` or the room policy.
   - Current: room-scoped specs project local progress messages into room transcripts for creation, task changes, versions, plans, clarifications, and verification, with structured `eventEnvelope` metadata and local-agent Ed25519 signatures when available.
   - Current: `agent spec validate <spec-id>` and execution gates validate the full task dependency DAG for missing dependencies, self-dependencies, duplicate dependencies, and cycles.
   - Next: add richer model/tool-generated technical plans, object-storage diff payloads, signed plan approval envelopes/state machine, webhook/API-backed CI provider ingestion, broker-native signed room progress streams, broker-native queue metrics, and production scheduler daemon integration.
   - Later: import/export `.specify/specs/*` and add optional `plugin.spec-kit.*`.

17. Plugin MVP.
   - Manifest loader, command plugins, MCP registration.
   - Plugin capability grants and audit events.
   - Current: local `.agent/plugins/*/plugin.json` command plugins can be listed, inspected, run from CLI, exposed as agent tools, policy-gated with `plugin.execute`, and audited with `plugin.executed`.
   - Current: local `agent mcp list/register/show/remove` manages `.agent/mcp-servers.json` as an MCP server registry with non-secret connection metadata, declared capabilities, risk/approval policy, project/room allowlists, and `mcp.server_registered` / `mcp.server_removed` audit events. `agent mcp plan` evaluates a non-side-effecting connection plan through `mcp.connect`, project/room allowlists, execution mode, risk, and server approval policy, emitting `mcp.connection_planned` audit events. `agent mcp capabilities|call-tool|read-resource` execute through `McpExecutionService`, `LocalMcpRuntime`, `PolicySecretBroker` leases, `mcp.tool.call` / `mcp.resource.read` checks, bounded/redacted outputs, and `mcp.executed` audit summaries.
   - Next: add signed plugin packages, sandboxed execution controls, Web/API execution surfaces, agent-tool integration, persistent capability grants, signed approval envelopes, and quorum continuation.

18. Knowledge RAG MVP.
   - Enterprise knowledge sources, chunks, search, and MCP-ready connector boundary.
   - Current: `KnowledgeSource` / `KnowledgeChunk` domain records, SQLite/local memory store methods, `KnowledgeService.ingestText/search/evaluate`, local keyword scoring, optional ACL filtering before knowledge scoring/context injection, optional prompt-injection safety scanning with annotate/exclude modes, CLI `agent knowledge ingest/list/search/eval-set/eval-sets/eval/eval-runs/eval-trend`, stable source/chunk citation IDs in search results and agent context attachments, persisted `KnowledgeEvalSet` / `KnowledgeEvalRun` records, golden retrieval eval with Recall@k/MRR/empty-result metrics, threshold gates for recall/MRR/empty-result rate, trend summary/regression detection, optional eval and trend report artifacts, and automatic local `agent run` knowledge recall by task text.
   - Next: add full-text search, embedding provider interface, vector index adapter, hybrid merge, reranker interface, citation precision checks, signed reports, CI report templates, and richer trend visualizations.
   - Accuracy plan: see `docs/knowledge-rag.md`.

19. Security test suite.
   - Prompt injection, secret redaction, lock conflicts, revoked agent messages.
   - Current: `npm test` runs Node's built-in test runner against secret redaction, room observer/inactive capability denial, workspace write-lock conflicts, high-risk plugin approval, lifecycle deletion/compaction policy, Git `.agent/` commit exclusion, worker registry audit/heartbeat behavior, local control-plane token enforcement, model provider/profile/usage behavior, MCP registry/planning policy, RAG eval/trend behavior, spec workflow gates, scheduler/worker runner flows, room handles, and mention-routing diagnostics.
   - Next: add prompt-injection fixtures, model-context secret leak tests, plugin capability isolation tests, revoked distributed-agent message replay tests, RAG poisoned-document tests, retrieval permission-leak tests, and CI enforcement.

## Milestone C: Private Distributed Platform Alpha

Expected: additional 7-9 iterations.

20. Control plane modular monolith.
   - API, auth, organizations, projects, sessions, workers, rooms.
   - Current: local CLI/store supports organizations, projects, scoped capability grants, runtime policy enforcement, scoped approval authorization, and audit events for org/project/grant creation.
   - Current: local `ControlPlaneService` centralizes read/write operations used by `agent web` and remote agent CLI commands, including token-gated JSON API routes for agent identity registration/listing, rooms, routed room inbox/cursor acknowledgement, invite-token joins, room invite revocation, sessions, session lifecycle, approvals, artifacts, retention, and audit.
   - Next: production auth, user directory, groups, role templates, revocation, distributed policy evaluation, CSRF protection, and event streaming.

21. PostgreSQL store.
   - Replace SQLite for private team mode.
   - Keep SQLite for local mode and tests.

22. Broker and distributed workers.
   - Worker registration, heartbeat, task assignment, room event streaming.
   - Current: local `WorkerRegistryService` can register workers, record heartbeats/load/status, persist them in SQLite, attach local Ed25519-signed heartbeat envelopes in metadata, record heartbeat nonces to reject signed nonce replay, explicitly drain workers with reason metadata via `agent workers drain` and `POST /api/workers/:workerId/drain`, complete drain to `offline` only after active assignments are gone via `agent workers complete-drain` and `POST /api/workers/:workerId/complete-drain`, allow scheduler-driven idle drain completion via `agent scheduler tick --complete-drained-workers` and `POST /api/scheduler/tick` with `completeDrainedWorkers`, clean expired nonce records with `agent workers cleanup-nonces` and `POST /api/workers/cleanup-nonces`, recover expired workers to `offline` with `agent workers recover-expired` and `POST /api/workers/recover-expired`, expose workers in `agent workers` and the local control-plane API, verify heartbeat signatures with `agent workers verify-heartbeat`, and audit registration/heartbeat/drain/expiry events.
   - Current: local `TaskAssignmentService` can lease sessions/subtasks to workers, refresh assignment leases, complete/fail/cancel assignments, update target status, release worker load, clean expired task lease nonce records, expose `agent assignments` plus local control-plane API routes, and audit assignment events.
   - Current: `TaskBroker` defines enqueue/claim/complete/recover semantics, with `LocalAssignmentTaskBroker` adapting the existing SQLite assignment table.
   - Current: broker claims write a `leaseEnvelope` metadata record containing assignment, worker, owner, expiry, nonce, and claimant; local platform claims can attach an Ed25519 signature from the local agent identity, record signed lease nonces to reject local replay, and worker execution can optionally require a valid signed lease before running the target session.
   - Current: `agent assignments recover-expired` and `POST /api/assignments/recover-expired` can expire stale leases, release old worker load, pause exhausted targets, auto-select a retry worker by project/load, and schedule retry assignments with attempt counts plus `retryNotBefore` backoff metadata.
   - Current: local `LocalWorkerRunner`, `agent workers run-once/poll`, and `POST /api/workers/:workerId/run-once|poll` can claim broker-backed local assignments, optionally require signed lease envelopes before execution, resume sessions, complete/fail/cancel assignments, stop on paused sessions, and stop polling when a worker is no longer `online`.
   - Current: local `LocalSchedulerService`, `agent scheduler tick`, `agent scheduler run`, and `POST /api/scheduler/tick` can recover expired worker heartbeats before polling, optionally require valid signed worker heartbeat envelopes before polling, report heartbeat rejections in tick summaries, recover stale leases through the broker boundary, schedule delayed retries, poll online workers, optionally complete drained workers with no active assignments, emit health warnings for recovered/active expired leases, blocked drains, load saturation, and queue pressure, return tick summaries, and run a foreground loop with max-tick, idle, and signal stop conditions.
   - Current: local `WorkerHealthService`, `agent workers health`, and `GET /api/workers/health` derive worker capacity, load, expired heartbeat, blocked drain, assignment status, active expired lease, delayed/due retry, and per-worker pressure metrics from SQLite rows.
   - Current: room-scoped assignments append local transcript events for assignment, expiry, retry scheduling, and completion/failure/cancellation, so room participants can see task progress.
   - Next: replace the local broker adapter and derived worker/agent health summaries with Redis/NATS/Postgres queues plus broker/control-plane-native metrics, make control-plane lease/heartbeat signature verification mandatory for production workers and agents, add distributed nonce replay windows, graceful worker shutdown handoff, room event streaming, retry state machines, and supervised stale-worker/agent recovery.

23. DB-backed locks and leases.
   - File-level write locks across machines.
   - Git-state serialization.
   - Current: local SQLite-backed workspace leases coordinate same-machine processes with TTL and heartbeat support.
   - Next: Postgres/control-plane leases, worker heartbeat ownership, stale-owner recovery, and Git-state serialization.

24. Secret broker.
   - Vault/KMS/keychain backends.
   - Short-lived secret leases.

25. Object storage and retention.
   - Large logs, diffs, screenshots, traces.
   - Summaries, artifact lifecycle, deletion, retention-aware signed audit export.
   - Current: local CLI can create/list/assign/apply project retention policies, register/list/delete artifact metadata, compact/delete sessions, soft-delete artifacts, delete old project audit events during manual retention sweep, and create tamper-evident signed audit export bundles.
   - Next: move lifecycle application and session compaction into scheduled workers, externalize large artifacts to object storage, add retention-aware export jobs, and implement legal hold.

26. Container/Rust runner.
   - Rust command runner.
   - Optional container sandbox.

27. Production Git integrations.
   - GitHub App.
   - GitLab OAuth/scoped tokens.
   - Webhooks and CI iteration.

28. Deployment packaging.
   - Docker Compose.
   - Private deployment config.
   - Upgrade/migration flow.

## Practical Estimate

```text
Soloclaw local terminal MVP: implemented, with usability still being actively improved
Local professional MVP: mostly implemented locally, with hardening and daemon UX still required
Cross-machine room alpha: local room/remote contracts exist, cross-platform packaging and soak tests remain
Local team alpha: partially implemented as local SQLite/control-plane prototypes
Private distributed alpha: domain contracts are started, production infrastructure remains
Production hardening: ongoing after alpha
```

The most important near-term chain is:

```text
Soloclaw terminal/TUN usability
  -> Windows/Linux/macOS/Android-Termux command path
  -> security/adversarial test expansion
  -> production boundary abstractions
  -> MCP stdio/HTTP execution MVP
  -> RAG accuracy upgrade
  -> daemon-ready worker/scheduler/remote room runner
  -> parallel Web UI + TUI/CLI execution inspection
  -> cross-machine room alpha
  -> Postgres/private deployment alpha
```

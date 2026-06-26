# Soloclaw AI Coding Product Maturation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Soloclaw from a safety-first local/multi-agent engineering platform toward a mature AI coding product with a daily-use workbench, open extension system, model/provider ecosystem, stable API surfaces, and release-grade distribution.

**Architecture:** Keep the existing safety, policy, audit, memory, room, and evidence contracts as the product foundation. Add product layers around them in small, independently shippable workstreams: CLI modularization, unified configuration, richer TUI workbench, tool registry, provider catalog, session UX, permissions UX, public API/SDK, packaging, and documentation. No product surface may bypass the existing `WorkspaceRuntime`, policy engine, approval/audit path, secret redaction, memory boundary, or Phase 4.5/5.5 evidence gates.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing SQLite/memory stores, existing CLI/TUI/control-plane modules, Markdown docs, local `.agent` configuration, JSON schema, existing model clients, existing tools/policy/audit stack, future optional package boundaries.

## Global Constraints

- Preserve Phase 1-5 local gates and Phase 4.5/5.5 real-environment evidence boundaries.
- Do not describe Phase 6 production autonomy, production native apps, production mobile automation, or production distributed autonomy until the roadmap gates allow it.
- Keep all filesystem, shell, patch, plugin, MCP, and future LSP/web tools behind existing policy, approval, audit, and runtime contracts.
- Keep memories, retrieved knowledge, room messages, command output, tool output, and external docs lower priority than system policy, project instructions, skills, approvals, and secret redaction.
- Treat cross-platform room interop as a product foundation, not as a later UI feature. Windows, Linux, macOS, and Android Termux agents must use the same room/control-plane protocol.
- The room transcript is shared context only. A routed inbox message is the wake-up and execution trigger for remote agents.
- Remote execution must preserve signed agent identity, signed delivery acknowledgements, signed heartbeats, nonce replay protection, revocation, delivery-status visibility, and stale-agent recovery.
- Do not add direct peer-to-peer, native app, plugin, SDK, or daemon paths that bypass room membership, routed delivery cursors, policy, approval, audit, or control-plane health state.
- Prefer small, independently testable product slices over a large monorepo rewrite.
- Avoid introducing heavy dependencies until the specific workstream proves the product value and integration boundary.
- Every user-facing product surface must expose verification status when it can modify the workspace.
- All new product features must have help text, docs, focused tests, and at least one CLI or TUI smoke path.

---

## Global Cross-Agent Invariants

Every workstream in this plan must preserve the cross-platform agent interop contract:

- **Hub-and-room first:** the control plane owns room membership, routed inbox cursors, acknowledgements, heartbeats, health, approvals, operator views, and audit. Direct peer-to-peer can only be a later optimization, and any direct channel must mirror safe events back to the control plane.
- **Transcript is not activation:** ordinary room messages are visible context. Agents execute only from routed inbox messages addressed by immutable agent id, unique alias, role route, approved wide route, or an explicitly assigned room task.
- **No broadcast fallback execution:** unresolved, ambiguous, inactive, stale, unknown, or empty routing targets must produce diagnostics and audit events without waking fallback agents.
- **Identity is not authority:** signed agent identity proves who sent the message, heartbeat, acknowledgement, or task result. Capability grants and room policy decide what it may do.
- **Evidence is token-safe:** room invite bundles, control tokens, invite tokens, private keys, raw signed envelopes, raw prompts, raw responses, and secret-shaped text must not appear in evidence, artifacts, docs, event streams, or audit metadata.
- **Agent capabilities are explicit:** routing, task assignment, tool exposure, and work profiles must consider platform id, shell kind, workspace roots, model profiles, tool availability, LSP/browser/Git capability, daemon support, service manager shape, path conventions, and room role.
- **Remote results are attributable:** every remote child session, task result, artifact, handoff, conflict resolution, and delivery acknowledgement must be attributable to agent id, machine id, platform id, room id, assignment id, session id, and safe artifact id when present.
- **Mobile stays constrained:** Android Termux agents participate through CLI/TUI, approved APIs, visible room state, and explicit user approvals. Native companion or phone UI automation remains outside production claims until the roadmap allows it.

These invariants are part of the product interface. Any follow-up plan that touches config, tools, TUI, sessions, permissions, subagents, rooms, APIs, packaging, or docs must include a short "cross-agent impact" section and at least one test or gate proving the invariant it depends on.

## Scope Boundary

This is an umbrella product-maturation plan. It intentionally covers multiple subsystems, so each major workstream below should become its own detailed execution plan before implementation begins. The first implementation wave should focus on local daily-use product quality, not Web/Desktop/SDK polish.

## Product North Star

Soloclaw should become a mature AI coding product that a developer can use every day:

- start with `soloclaw` and immediately understand workspace, model, session, tools, and safety state;
- configure providers, profiles, Responses API base URLs, and fallback models without editing internals;
- run planning, building, reviewing, debugging, testing, and documentation workflows from a coherent TUI/CLI;
- inspect diffs, approvals, tool calls, memory usage, costs, sessions, and verification evidence;
- extend capabilities through project tools, skills, commands, MCP, and plugins;
- safely run on Windows, Linux, macOS, and Android Termux, then later surface the same control-plane contracts through Web/Desktop/mobile companions;
- collaborate across rooms and machines without weakening local policy, audit, or evidence guarantees.

The product should feel like one coherent AI coding tool, but its internal shape is a mixed-agent network: a local user may ask from Windows, delegate a repo check to Linux, pull in a macOS shell agent for platform evidence, keep an Android Termux agent as a constrained room participant, and still inspect one safe control-plane history.

## Current Strengths To Preserve

- Phase verify discipline, local gates, and evidence status boundaries.
- Room, remote runner, signed agent identity, routed message, heartbeat, and multi-agent foundations.
- Policy, approval, audit, secret redaction, retention, and memory safety boundaries.
- Spec, task, worker, scheduler, knowledge, and MCP local prototypes.
- Minimal dependency footprint and understandable TypeScript core.

## Major Product Gaps Versus Mature AI Coding Tools

- Daily-use workbench is still narrow compared with a full TUI product.
- CLI entrypoint is too large and mixes product commands, phase gates, config, model setup, and runtime wiring.
- Configuration is functional but not yet one schema-backed product contract.
- Tooling lacks dynamic project tools, LSP tools, web fetch/search tools, richer output truncation, and per-agent/model tool filtering.
- Model support works but lacks a provider/model catalog, recommendations, status, small-model/default-model roles, and clean onboarding.
- Session UX is more like execution records than a managed work asset with fork/archive/revert/share/search.
- Permission UX is safety-strong but less ergonomic than rule-based once/always/reject/corrected flows.
- Subagents and rooms are powerful infrastructure but not yet a natural first-class task tool in normal coding sessions.
- API/SDK/Web/Desktop packaging remains below mature product expectations.
- Docs explain phases deeply but do not yet read like a complete product manual and quickstart.

---

## Workstream 1: Modular CLI And Product Command Boundary

**Outcome:** `src/cli/index.ts` becomes a thin router, and product commands move into focused command modules that can be tested independently.

**Current slices:** `docs/superpowers/plans/2026-06-25-soloclaw-cli-modularization-slice-1.md` starts this workstream by adding a tested `CommandRouter` and routing global help through it. `docs/superpowers/plans/2026-06-25-soloclaw-cli-modularization-slice-2.md` then extracts help command registration into `src/cli/commands/help.ts`. `docs/superpowers/plans/2026-06-25-soloclaw-cli-modularization-slice-3.md` moves `quickstart` execution into `src/cli/commands/quickstart.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-4.md` moves `status` execution into `src/cli/commands/workbench.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-5.md` moves `platform doctor|check` execution into `src/cli/commands/workbench.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-6.md` moves `doctor` / `check` readiness execution into `src/cli/commands/workbench.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-7.md` moves `inspect` execution into `src/cli/commands/workbench.ts`. The current Workstream 1 increment adds focused modules for `providers` / `model`, legacy `models`, `config path|show`, `secrets`, `sessions` / `show-session`, `session`, top-level `pause` / `cancel`, top-level `changes`, top-level `resume`, top-level `artifacts`, read-only top-level `approvals`, top-level `approve` / `deny`, top-level `replay`, top-level `commands`, top-level `skills`, `tool`, `knowledge`, `plugins`, `mcp`, top-level `audit`, top-level `memory`, top-level `web`, and top-level `workspace`, each with command-module tests. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-8.md` moves legacy `models` execution into `src/cli/commands/model.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-9.md` moves `secrets` execution into `src/cli/commands/config.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-10.md` moves `session diff|report|status|inspect|timeline|logs|review|bundle|result|next|verify|compact|delete` execution into `src/cli/commands/session.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-11.md` moves top-level `pause` / `cancel` execution into `src/cli/commands/session.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-12.md` moves top-level `changes` execution into `src/cli/commands/session.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-13.md` moves top-level `resume` execution into `src/cli/commands/session.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-14.md` moves top-level `artifacts` execution into `src/cli/commands/session.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-15.md` moves read-only top-level `approvals` execution into `src/cli/commands/session.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-16.md` moves top-level `replay` execution into `src/cli/commands/session.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-17.md` moves top-level `approve` / `deny` execution into `src/cli/commands/session.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-18.md` moves top-level `commands` execution into `src/cli/commands/tools.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-19.md` moves top-level `skills` execution into `src/cli/commands/tools.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-20.md` moves top-level `knowledge`, `plugins`, and `mcp` execution into `src/cli/commands/tools.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-21.md` moves top-level `audit` execution into `src/cli/commands/session.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-22.md` moves top-level `memory` execution into `src/cli/commands/memory.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-23.md` moves top-level `web` execution into `src/cli/commands/web.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-24.md` moves top-level `workspace` execution into `src/cli/commands/workspace.ts`. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-25.md` moves remaining onboarding/workbench commands, admin/org/git/PR commands, and worker/scheduler/operator/assignment commands into focused modules. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-26.md` moves `spec`, `identity`, and `agents` command flow into focused modules. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-27.md` moves `delegate` and `subtasks` command flow into a focused subagents command module. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-28.md` moves room convenience, `rooms`, and `remote` command flow into focused room/remote command modules. `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-29.md` routes Phase 1-5 gates and `hygiene` through focused command modules while preserving existing evidence handlers. `docs/architecture.md` records the current CLI module boundary.

**Files:**
- Modify: `src/cli/index.ts`
- Create: `src/cli/commands/model.ts`
- Create: `src/cli/commands/config.ts`
- Create: `src/cli/commands/session.ts`
- Create: `src/cli/commands/tools.ts`
- Create: `src/cli/commands/memory.ts`
- Create: `src/cli/commands/web.ts`
- Create: `src/cli/commands/workspace.ts`
- Create: `src/cli/commands/workbench.ts`
- Create: `src/cli/commands/admin.ts`
- Create: `src/cli/commands/workers.ts`
- Create: `src/cli/commands/agents.ts`
- Create: `src/cli/commands/spec.ts`
- Create: `src/cli/commands/subagents.ts`
- Create: `src/cli/commands/phases.ts`
- Create: `src/cli/commands/rooms.ts`
- Create: `src/cli/commands/remote.ts`
- Create: `src/cli/commands/hygiene.ts`
- Create: `src/cli/command-router.ts`
- Test: `src/__tests__/cli-command-router.test.ts`
- Test: `src/__tests__/cli-memory-command.test.ts`
- Test: `src/__tests__/cli-web-command.test.ts`
- Test: `src/__tests__/cli-workspace-command.test.ts`
- Test: `src/__tests__/cli-admin-command.test.ts`
- Test: `src/__tests__/cli-workers-command.test.ts`
- Test: `src/__tests__/cli-agents-command.test.ts`
- Test: `src/__tests__/cli-spec-command.test.ts`
- Test: `src/__tests__/cli-subagents-command.test.ts`
- Test: `src/__tests__/cli-rooms-command.test.ts`
- Test: `src/__tests__/cli-remote-command.test.ts`
- Test: `src/__tests__/cli-phases-command.test.ts`
- Test: `src/__tests__/cli-hygiene-command.test.ts`
- Test: `src/__tests__/workbench-help.test.ts`
- Docs: `docs/architecture.md`

**Acceptance:**
- `src/cli/index.ts` is reduced to process startup, router registration, global option parsing, and error formatting.
- Existing commands keep their user-facing names and JSON output contracts.
- Build, check, and full tests pass.
- Help output remains stable for Phase 1-5, model setup, workbench, memory, skills, rooms, and MCP commands.

**Steps:**
- [x] Inventory all top-level command groups currently handled in `src/cli/index.ts`.
- [x] Create a `CommandModule` interface with name, aliases, help, and execute function.
- [x] Move one low-risk command group first, preferably workbench/help, and preserve tests.
- [x] Move `quickstart` into a focused command module.
- [x] Move `status` into a focused workbench command module.
- [x] Move `platform doctor|check` into a focused workbench command module.
- [x] Move `doctor` / `check` into a focused workbench command module.
- [x] Move `inspect` into a focused workbench command module.
- [x] Move `providers` and `model` into a focused model command module.
- [x] Move legacy `models` into the focused model command module.
- [x] Move `config path|show` into a focused config command module.
- [x] Move `secrets` into the focused config command module.
- [x] Move low-risk `sessions` and `show-session` read paths into a focused session command module.
- [x] Move `tool` into a focused tools command module while preserving existing policy/tool wiring.
- [x] Move deep `session` inspection, lifecycle, bundle, and verification commands into the focused session command module.
- [x] Move top-level `pause` / `cancel` session-control commands into the focused session command module.
- [x] Move top-level `changes` into the focused session command module.
- [x] Move top-level `resume` into the focused session command module.
- [x] Move top-level `artifacts` into the focused session command module.
- [x] Move read-only top-level `approvals` into the focused session command module.
- [x] Move top-level `replay` into the focused session command module.
- [x] Move top-level approval decisions (`approve`, `deny`) into the focused session command module.
- [x] Move top-level `commands` into the focused tools command module.
- [x] Move top-level `skills` into the focused tools command module.
- [x] Continue migrating remaining tools-adjacent groups: `knowledge`, `plugins`, and `mcp`.
- [x] Move top-level `audit` into the focused session command module.
- [x] Move top-level `memory` into a focused memory command module while preserving reviewed memory lifecycle behavior.
- [x] Move top-level `web` into a focused web command module while preserving local Web console startup behavior.
- [x] Move top-level `workspace` into a focused workspace command module while preserving recent-workspace behavior.
- [x] Move remaining onboarding/workbench commands (`init` / `setup`, `tui`, `local` / `agent`, `smoke`, and `workbench verify`) into the focused workbench command module.
- [x] Move admin command groups (`orgs`, `retention`, `git`, and `pr`) into a focused admin command module.
- [x] Move worker/scheduler/operator command groups (`workers`, `scheduler`, `assignments`, and `operator`) into a focused workers command module.
- [x] Move native `spec` workflow commands into a focused spec command module.
- [x] Move local `identity` commands into a focused agent identity command module.
- [x] Move top-level `agents` list, health, stale recovery, trust, and key-rotation commands into a focused agent identity command module.
- [x] Move top-level `delegate` and `subtasks` command flow into a focused subagents command module.
- [x] Continue migrating remaining room/remote command groups before phase gates: room convenience, `rooms`, and `remote`.
- [x] Move phase gates last, because they carry evidence contracts.
- [x] Add router tests for unknown command, help, JSON error shape, and alias behavior.
- [x] Update `docs/architecture.md` with the CLI module boundary.

**Verification:**

```powershell
npm.cmd run build
npm.cmd run check
npm.cmd test
node dist\cli\index.js --help
node dist\cli\index.js phase1 verify --json
node dist\cli\index.js model --help
```

---

## Workstream 2: Unified Product Configuration Schema

**Outcome:** Soloclaw has one user-facing configuration contract for model profiles, default agent behavior, tool policy, work profiles, skills, memory, MCP, plugin, session, and output settings.

**Files:**
- Create: `src/config/product-config.ts`
- Create: `src/config/product-config-loader.ts`
- Create: `src/config/product-config-schema.ts`
- Modify: `src/model/global-model-profile-store.ts`
- Modify: `src/model/local-provider-profile-store.ts`
- Modify: `src/cli/tui/model-setup.ts`
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/product-config.test.ts`
- Docs: `docs/configuration.md`
- Docs: `docs/implementation-roadmap.md`

**Acceptance:**
- `agent config show --json` prints the merged effective config with source labels.
- `agent config doctor --json` validates schema, paths, provider profiles, secret refs, skills, memory, MCP, and policy settings.
- Existing model profile commands remain compatible.
- JSONC-like comments are either explicitly supported or explicitly rejected with a clear error.
- Config docs include safe examples for OpenAI Responses API custom base URL and openai-compatible profiles.
- Config includes an explicit local agent capability manifest shape with platform id, shell kind, workspace roots, model profile ids, available tool groups, room roles, service manager shape, path conventions, daemon support, and remote-runner support.
- Config doctor reports whether the current agent can safely join rooms, receive routed work, send signed acknowledgements, send signed heartbeats, and write workspace-local remote-runner status/stop files.

**Steps:**
- [ ] Define the first version of `ProductConfig` with conservative optional fields.
- [ ] Add schema validation with precise error paths.
- [ ] Load global config, project config, env overrides, and CLI overrides in a deterministic order.
- [ ] Attach source metadata for every merged field.
- [ ] Wire model setup to write through the config boundary where possible.
- [ ] Add config doctor checks for missing env vars, missing secret refs, unsafe paths, and incompatible provider settings.
- [ ] Add agent capability manifest loading and platform detection using the existing platform support contracts.
- [ ] Add config doctor checks for cross-agent readiness: identity present, workspace-local status/stop paths, supported shell, room enrollment readiness, and token-safe evidence settings.
- [ ] Document migration from current profile commands.

**Verification:**

```powershell
npm.cmd run build
node --test dist\__tests__\product-config.test.js
node dist\cli\index.js config show --json
node dist\cli\index.js config doctor --json
```

---

## Workstream 3: Daily-Use TUI Workbench

**Outcome:** The TUI becomes the primary local workbench for model selection, sessions, tasks, approvals, diff inspection, tool events, memory evidence, and verification status.

**Files:**
- Modify: `src/cli/tui/rich-shell.ts`
- Modify: `src/cli/tui/layout.ts`
- Modify: `src/cli/tui/state.ts`
- Modify: `src/cli/tui/model-setup.ts`
- Create: `src/cli/tui/session-panel.ts`
- Create: `src/cli/tui/tool-panel.ts`
- Create: `src/cli/tui/approval-panel.ts`
- Create: `src/cli/tui/diff-panel.ts`
- Create: `src/cli/tui/status-panel.ts`
- Test: `src/__tests__/rich-tui.test.ts`
- Test: `src/__tests__/tui-session-panel.test.ts`
- Docs: `docs/agent-execution-standards.md`

**Acceptance:**
- `soloclaw` opens a useful local workbench by default.
- TUI shows model/provider readiness, current workspace, active session, pending approvals, recent tool calls, verification state, and changed files.
- `/model setup` supports OpenAI Chat, OpenAI Responses API, Anthropic Messages, OpenAI-compatible, custom base URL, env var, and secret ref flows.
- TUI can list/resume/archive sessions and inspect recent session reports.
- TUI can show diff summary and final verification status without requiring manual JSON commands.
- TUI can show current room membership, routed inbox status, delivery-status summaries, remote agent health, stale/offline warnings, and pending room approvals when the session is room-scoped.
- TUI clearly distinguishes transcript-visible room messages from routed inbox messages that can wake an agent.

**Steps:**
- [ ] Define a single `WorkbenchViewState` built from existing session, model, approval, memory, and tool-report views.
- [ ] Add a status rail for model readiness, workspace, profile, and verification.
- [ ] Add session list, session detail, and resume actions.
- [ ] Add approval queue rendering and action shortcuts.
- [ ] Add tool event and changed-file panels.
- [ ] Add diff summary rendering from existing report/file-change data.
- [ ] Extend model setup tests for Responses API custom base URL.
- [ ] Add a room/agent status panel backed by control-plane state: memberships, routed inbox count, delivery-status pending/ack counts, and agent health summaries.
- [ ] Add rendering tests that verify unmentioned `mentions_only` transcript messages are displayed as context but not as runnable inbox work.

**Verification:**

```powershell
npm.cmd run build
node --test dist\__tests__\rich-tui.test.js
node --test dist\__tests__\tui-session-panel.test.js
node dist\cli\index.js tui smoke --json
```

---

## Workstream 4: Tool Registry, LSP, Web, And Project Tools

**Outcome:** Tools become a product extension layer rather than a fixed internal list.

**Files:**
- Create: `src/tools/tool-registry.ts`
- Create: `src/tools/tool-output-store.ts`
- Create: `src/tools/project-tool-loader.ts`
- Create: `src/tools/web-tools.ts`
- Create: `src/tools/lsp-tools.ts`
- Modify: `src/tools/workspace-tools.ts`
- Modify: `src/tools/skill-tools.ts`
- Modify: `src/platform/local-platform.ts`
- Modify: `src/policy/default-policy-engine.ts`
- Test: `src/__tests__/tool-registry.test.ts`
- Test: `src/__tests__/tool-output-store.test.ts`
- Test: `src/__tests__/project-tool-loader.test.ts`
- Test: `src/__tests__/lsp-tools.test.ts`
- Docs: `docs/plugins.md`
- Docs: `docs/agent-execution-standards.md`

**Acceptance:**
- Builtin tools, skill tools, plugin tools, MCP tools, and project tools register through one registry.
- Registry can filter tools by work profile, policy mode, provider capability, and agent role.
- Registry can filter tools by agent capability manifest: platform id, shell kind, workspace root, available binaries, LSP support, browser support, Git support, network policy, and room role.
- Large tool outputs are summarized and stored with retrievable artifact IDs.
- Project tools require explicit trust and policy grants.
- LSP tool MVP supports diagnostics, hover, definition, references, and document symbols for TypeScript projects when available.
- Web fetch/search tools are off by default and require explicit config/policy enablement.

**Steps:**
- [ ] Introduce `ToolRegistry` without changing current tool behavior.
- [ ] Move builtin workspace tools into registry registration.
- [ ] Add output truncation and artifact-backed retrieval for long command/read/search outputs.
- [ ] Add project tool discovery under `.agent/tools` or configured directories with trust checks.
- [ ] Add LSP client boundary and read-only LSP operations first.
- [ ] Add web fetch/search tools behind explicit config and policy.
- [ ] Add platform-aware command templates and tool gating for Windows PowerShell, Windows CMD, POSIX shells, macOS shells, and Android Termux.
- [ ] Add tests proving a tool enabled on one agent platform is not exposed to a different platform without a matching capability grant.
- [ ] Add docs for tool trust, permissions, and output retention.

**Verification:**

```powershell
npm.cmd run build
node --test dist\__tests__\tool-registry.test.js
node --test dist\__tests__\tool-output-store.test.js
node --test dist\__tests__\project-tool-loader.test.js
node --test dist\__tests__\lsp-tools.test.js
npm.cmd test
```

---

## Workstream 5: Provider And Model Catalog

**Outcome:** Model configuration becomes guided, discoverable, and status-aware while keeping current explicit profile behavior.

**Files:**
- Create: `src/model/provider-catalog.ts`
- Create: `src/model/model-catalog.ts`
- Create: `src/model/model-selection.ts`
- Modify: `src/model/provider-profiles.ts`
- Modify: `src/model/configured-model-client.ts`
- Modify: `src/model/http-model-clients.ts`
- Modify: `src/cli/tui/model-setup.ts`
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/model-catalog.test.ts`
- Test: `src/__tests__/global-model-profiles.test.ts`
- Docs: `docs/model-configuration.md`

**Acceptance:**
- `agent model catalog --json` lists known providers, protocols, default base URLs, required credentials, and supported setup fields.
- `agent model recommend --task <kind> --json` returns a deterministic local recommendation from available configured profiles.
- OpenAI Responses API is represented as a first-class protocol with custom base URL support.
- Default model and small model roles are supported in config.
- Missing credentials block readiness without creating session DB state in smoke tests.

**Steps:**
- [ ] Add provider catalog records for OpenAI Chat, OpenAI Responses, Anthropic Messages, and OpenAI-compatible profiles.
- [ ] Add model role selection for default, small, planning, review, and fallback roles.
- [ ] Add setup menu entries for protocol-specific fields, including Responses custom base URL.
- [ ] Add model catalog command and JSON output contract.
- [ ] Add readiness diagnostics that explain whether the failure is credential, base URL, protocol, or model id.
- [ ] Document provider setup examples and precedence rules.

**Verification:**

```powershell
npm.cmd run build
node --test dist\__tests__\model-catalog.test.js
node --test dist\__tests__\global-model-profiles.test.js
node dist\cli\index.js model catalog --json
node dist\cli\index.js model doctor --json
```

---

## Workstream 6: Session UX, Diff, Revert, Fork, And Archive

**Outcome:** Sessions become durable work assets that users can search, resume, compare, fork, archive, and safely revert.

**Files:**
- Modify: `src/domain/session.ts`
- Modify: `src/sessions/session-timeline-view.ts`
- Modify: `src/sessions/session-inspection-view.ts`
- Create: `src/sessions/session-diff-service.ts`
- Create: `src/sessions/session-revert-service.ts`
- Create: `src/sessions/session-search-service.ts`
- Modify: `src/store/agent-store.ts`
- Modify: `src/store/sqlite-agent-store.ts`
- Modify: `src/store/memory-agent-store.ts`
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/session-diff-revert.test.ts`
- Test: `src/__tests__/session-search.test.ts`
- Docs: `docs/operations.md`

**Acceptance:**
- User can run `agent sessions list|show|search|archive|fork|diff|revert`.
- Revert is based on recorded file changes and refuses unsafe or stale reversions.
- Fork creates a child session with parent metadata and does not mutate the parent transcript.
- Archive hides sessions from default lists but preserves audit/history.
- TUI can display session list and details from the same services.
- Room-linked and remote child sessions expose safe provenance: room id, assignment id, parent session id, agent id, machine id, platform id, workspace root label, artifact ids, and delivery acknowledgement ids.
- Revert refuses remote-origin changes unless the artifact or copied result file is present in the current workspace and the current file content matches the recorded preimage.

**Steps:**
- [ ] Add session metadata for archived state, parent session, title, tags, summary, and cost/token fields when available.
- [ ] Add session search over title, summary, task, tags, and recent transcript summaries.
- [ ] Add diff service based on persisted file-change records.
- [ ] Add conservative revert service that checks current file content before applying reverse patches.
- [ ] Add fork service that creates a paused child session with copied context pointers.
- [ ] Add CLI commands and TUI hooks.
- [ ] Add remote provenance fields to session reports and session search facets.
- [ ] Add tests for room-assigned child sessions, remote artifact provenance, and stale remote revert denial.
- [ ] Document safe revert limits.

**Verification:**

```powershell
npm.cmd run build
node --test dist\__tests__\session-diff-revert.test.js
node --test dist\__tests__\session-search.test.js
node dist\cli\index.js sessions list --json
```

---

## Workstream 7: Ergonomic Permission Rules

**Outcome:** The safety system keeps strong audit guarantees while gaining user-friendly rules for repeated daily workflows.

**Files:**
- Create: `src/policy/policy-rule-config.ts`
- Create: `src/policy/policy-rule-matcher.ts`
- Modify: `src/policy/default-policy-engine.ts`
- Modify: `src/domain/approval.ts`
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/policy-rule-matcher.test.ts`
- Test: `src/__tests__/security.test.ts`
- Docs: `docs/security-boundaries.md`
- Docs: `docs/agent-execution-standards.md`

**Acceptance:**
- Users can define allow/ask/deny rules for command patterns, paths, tool names, plugin names, MCP servers, and risk levels.
- Approval responses support once, always for matching rule, reject, and corrected instruction.
- All rule matches and approval decisions are audited.
- Deny rules always win over broad allow rules.
- Protected paths remain protected regardless of user convenience rules.
- Permission rules can be scoped to agent id, machine id, platform id, room id, project id, workspace root, tool name, MCP server, plugin id, and assignment id.
- Wide-route, role-route, remote task assignment, key rotation, revocation, stale recovery, and room-scoped approval decisions require explicit capabilities and produce audit summaries.

**Steps:**
- [ ] Define a small rule schema with explicit action, pattern, scope, risk, and reason fields.
- [ ] Implement deterministic rule matching and precedence.
- [ ] Wire rule matches into the existing policy engine as an input, not a replacement.
- [ ] Add approval decision persistence for once/always/reject/corrected flows.
- [ ] Add CLI commands for listing and removing remembered approvals.
- [ ] Add cross-agent policy tests for deny precedence across room routes, remote task assignment, stale agents, suspended members, and revoked keys.
- [ ] Update security tests for protected paths and deny precedence.

**Verification:**

```powershell
npm.cmd run build
node --test dist\__tests__\policy-rule-matcher.test.js
node --test dist\__tests__\security.test.js
```

---

## Workstream 8: Cross-Platform Agent Interop Contract

**Outcome:** Cross-platform room interop becomes a first-class product module with a small interface and strong tests, so CLI, TUI, SDK, Web, tools, subagents, and future native apps all share the same agent capability, routing, delivery, health, and provenance semantics.

**Files:**
- Create: `src/agents/agent-capability-manifest.ts`
- Create: `src/agents/agent-platform-capabilities.ts`
- Create: `src/rooms/agent-interop-contract.ts`
- Create: `src/rooms/room-routing-contract.ts`
- Create: `src/rooms/remote-task-assignment-contract.ts`
- Modify: `src/rooms/room-capabilities.ts`
- Modify: `src/rooms/message-routing.ts`
- Modify: `src/remote/remote-room-runner.ts`
- Modify: `src/control-plane/control-plane-service.ts`
- Test: `src/__tests__/agent-capability-manifest.test.ts`
- Test: `src/__tests__/cross-agent-interop-contract.test.ts`
- Test: `src/__tests__/room-routing-contract.test.ts`
- Test: `src/__tests__/remote-task-assignment-contract.test.ts`
- Docs: `docs/agent-rooms.md`
- Docs: `docs/platform-support.md`
- Docs: `docs/security-boundaries.md`

**Interfaces:**
- Produces: `AgentCapabilityManifest`, `AgentInteropEnvelopeSummary`, `RoomRoutingDecision`, `RemoteTaskAssignmentContract`, and `RemoteProvenanceRef`.
- Consumes: existing agent identities, platform detection, room membership, routed inbox, delivery ack, heartbeat, task assignment, audit, and artifact records.

**Acceptance:**
- Every local or remote agent can report a safe capability manifest with platform id, machine id, shell kind, workspace labels, model profile ids, tool groups, service manager shape, daemon support, LSP/browser/Git support, and room roles.
- Routing decisions return explicit outcomes: `deliver`, `diagnostic_only`, `denied`, `ambiguous`, `stale`, `suspended`, `unknown`, or `wide_route_cap_required`.
- Remote tasks are represented as room assignments with accepted/running/blocked/completed/failed/expired states, not as direct model-to-agent execution.
- Remote execution records safe provenance for agent id, machine id, platform id, room id, assignment id, session id, delivery ack id, heartbeat summary, and artifact ids.
- Contract tests prove transcript messages do not wake agents, routed inbox messages do, no-broadcast fallback is preserved, stale/suspended/revoked agents do not execute, and delivery-status can reach zero pending.

**Steps:**
- [ ] Define `AgentCapabilityManifest` with conservative fields and safe serialization.
- [ ] Add platform capability derivation for Windows PowerShell, Windows CMD, Linux shell, macOS shell, and Android Termux.
- [ ] Extract routing result logic into `RoomRoutingDecision` so CLI, TUI, Web, SDK, and runners can show the same diagnostics.
- [ ] Define remote task assignment state transitions and remote provenance references.
- [ ] Wire the manifest into control-plane state, room agent health, tool filtering, and TUI status.
- [ ] Add interop tests for signed ack/heartbeat summaries, nonce replay denial summaries, stale recovery, suspended member denial, revoked old signature denial, and delivery-status zero-pending.
- [ ] Update docs to make this contract the required foundation for future P2P, daemon, Web, Desktop, SDK, and Android companion work.

**Verification:**

```powershell
npm.cmd run build
node --test dist\__tests__\agent-capability-manifest.test.js
node --test dist\__tests__\cross-agent-interop-contract.test.js
node --test dist\__tests__\room-routing-contract.test.js
node --test dist\__tests__\remote-task-assignment-contract.test.js
node dist\cli\index.js phase5 verify --workspace E:\code\agent --json
```

---

## Workstream 9: Subagent Task Tool And Room-Native Workflows

**Outcome:** Subagents and rooms become natural tools in regular coding sessions, not only separate phase infrastructure.

**Files:**
- Modify: `src/subagents/local-subagent-service.ts`
- Modify: `src/tasks/task-operations-service.ts`
- Modify: `src/rooms/room-service.ts`
- Create: `src/tools/task-tool.ts`
- Create: `src/tools/room-tools.ts`
- Modify: `src/platform/local-platform.ts`
- Test: `src/__tests__/subagent-task-tool.test.ts`
- Test: `src/__tests__/remote-room-runner.test.ts`
- Docs: `docs/sub-agents.md`
- Docs: `docs/agent-rooms.md`

**Acceptance:**
- Model can call a `task` tool to launch a scoped foreground or background subagent.
- Background task returns a task id and can be continued or inspected.
- Child sessions inherit safe context, permissions, and room/project scope without inheriting raw secrets.
- Room tools can send scoped progress, request handoff, and inspect assigned room tasks.
- `task` tool supports explicit target selection: local, room, agent id, unique alias, or role route, using Workstream 8 routing decisions and capability manifests.
- Remote `task` execution creates a room assignment and waits for signed acknowledgement/acceptance before treating the task as running.
- Subagent outputs that cross machine boundaries return safe summaries and artifact ids, not raw control tokens, invite bundles, private keys, or raw signed envelopes.
- Phase 5 evidence boundaries remain unchanged.

**Steps:**
- [ ] Define `task` tool schema with prompt, mode, background flag, allowed tools, and expected output shape.
- [ ] Create child session linkage and task id lookup.
- [ ] Add continuation and inspection commands.
- [ ] Project subagent lifecycle events into room transcript when room context exists.
- [ ] Route remote tasks through the remote assignment contract and record accepted/running/completed/failed/expired transitions.
- [ ] Add remote-to-remote handoff and remote artifact result-sync tests through the `task` tool path.
- [ ] Add safety tests for secret redaction and permission inheritance.
- [ ] Document when to use subagents versus normal tool calls.

**Verification:**

```powershell
npm.cmd run build
node --test dist\__tests__\subagent-task-tool.test.js
node --test dist\__tests__\remote-room-runner.test.js
node dist\cli\index.js phase5 verify --workspace E:\code\agent --json
```

---

## Workstream 10: Local API, SDK, And Event Stream

**Outcome:** CLI, TUI, Web, Desktop, and future SDKs share a stable local control-plane contract.

**Files:**
- Modify: `src/control-plane/control-plane-service.ts`
- Modify: `src/web/local-room-web-server.ts`
- Create: `src/control-plane/openapi.ts`
- Create: `src/control-plane/event-stream-service.ts`
- Create: `src/sdk/local-client.ts`
- Test: `src/__tests__/control-plane-api.test.ts`
- Test: `src/__tests__/control-plane-event-stream.test.ts`
- Docs: `docs/api.md`

**Acceptance:**
- Local control plane exposes stable JSON routes for sessions, approvals, tools, model status, config status, rooms, workers, memory search, and artifacts.
- Event stream emits safe summaries for session events, tool calls, approvals, room messages, and worker/agent health.
- OpenAPI or equivalent route manifest can be generated from the route definitions.
- Minimal TypeScript SDK can query status and subscribe to event stream.
- API exposes stable v1 routes for agent capability manifests, room routing diagnostics, routed inbox cursors, delivery-status, signed ack summaries, heartbeat summaries, stale recovery, key rotation summaries, remote assignment status, and remote provenance refs.
- Event stream supports reconnect-safe cursors and never treats replayed events as execution triggers.

**Steps:**
- [ ] Inventory current local web/control-plane endpoints.
- [ ] Define stable v1 route names and response DTOs.
- [ ] Add route manifest generation.
- [ ] Add event stream service with redacted summary events.
- [ ] Add local SDK wrapper used by tests.
- [ ] Add reconnect and idempotency tests for routed inbox cursors, ack retries, heartbeat updates, and event-stream resume.
- [ ] Add SDK methods for delivery-status, remote assignments, agent health, and routing diagnostics.
- [ ] Document auth token behavior and local-only boundary.

**Verification:**

```powershell
npm.cmd run build
node --test dist\__tests__\control-plane-api.test.js
node --test dist\__tests__\control-plane-event-stream.test.js
```

---

## Workstream 11: Packaging, Installation, And Release Channels

**Outcome:** Soloclaw becomes installable and updatable through predictable local developer paths.

**Files:**
- Modify: `package.json`
- Create: `scripts/package-local.ps1`
- Create: `scripts/package-local.sh`
- Create: `scripts/smoke-installed-cli.ps1`
- Create: `scripts/smoke-installed-cli.sh`
- Create: `docs/installation.md`
- Modify: `docs/platform-support.md`
- Test: `src/__tests__/package-metadata.test.ts`

**Acceptance:**
- Installation docs cover Windows PowerShell, Windows CMD, Linux shell, macOS shell, and Android Termux source-run path.
- Package metadata includes stable binary names and version output.
- Local package smoke can install or link the CLI in a temp location and run `soloclaw --version`, `soloclaw doctor`, and `soloclaw model --help`.
- Release checklist includes live-provider smoke, Phase 1-5 local gates, Phase 4.5/5.5 evidence status, and secret audit.
- Install smoke includes agent identity creation, capability manifest output, room join readiness, workspace-local remote-runner status/stop path validation, and platform-specific command rendering.
- Release checklist requires mixed-agent room evidence status before any release claim that mentions cross-machine collaboration.

**Steps:**
- [ ] Add `soloclaw --version` and machine-readable version output.
- [ ] Add install smoke scripts for Windows and POSIX shells.
- [ ] Document npm/source install first; defer package managers until versioning is stable.
- [ ] Add release checklist docs.
- [ ] Add package metadata tests.
- [ ] Add platform-specific source-run snippets for room invite, join, remote run, status-file evidence, stop-file shutdown, and token-safe evidence handoff.
- [ ] Run source-run smoke on local Windows environment.

**Verification:**

```powershell
npm.cmd run build
node --test dist\__tests__\package-metadata.test.js
.\scripts\smoke-installed-cli.ps1
```

---

## Workstream 12: Product Documentation And Onboarding

**Outcome:** Docs explain the product as a usable AI coding tool, not only as a phase/evidence ledger.

**Files:**
- Create: `docs/quickstart.md`
- Create: `docs/model-configuration.md`
- Create: `docs/daily-workflows.md`
- Create: `docs/session-management.md`
- Create: `docs/tooling.md`
- Create: `docs/troubleshooting.md`
- Modify: `README.md`
- Modify: `docs/implementation-roadmap.md`

**Acceptance:**
- README first screen explains what Soloclaw does, how to install/run, how to configure a model, and how to run a safe coding task.
- Phase/evidence details remain available but move below product onboarding.
- Docs include daily workflows for plan, build, debug, review, test, docs, memory, and room handoff.
- Troubleshooting covers missing API keys, bad base URL, Responses API setup, Windows command differences, protected paths, pending approvals, and failed verification.
- Docs include a "mixed-agent room quickstart" that explains control host, invite bundle sensitivity, remote join, routed task, signed ack/heartbeat, delivery-status, status-file evidence, stop-file shutdown, and zero-pending closeout.
- Troubleshooting covers stale agents, suspended members, revoked keys, ambiguous aliases, no-broadcast fallback diagnostics, Termux foreground-run constraints, and token-safe evidence handoff.

**Steps:**
- [ ] Rewrite README top section around product value and quickstart.
- [ ] Add model setup docs with OpenAI Responses API custom base URL examples.
- [ ] Add daily workflow docs mapped to CLI/TUI commands.
- [ ] Add session management docs for resume/archive/fork/revert when implemented.
- [ ] Add troubleshooting docs from common gate failures.
- [ ] Add cross-platform room interop docs with one control host plus Windows/Linux/macOS/Android Termux target roles and paste-safe evidence rules.
- [ ] Keep evidence and roadmap docs linked but not dominant.

**Verification:**

```powershell
npm.cmd run build
npm.cmd test
git diff --check
```

---

## Recommended Execution Order

1. **CLI modularization** because it lowers the cost of every later product feature.
2. **Unified config schema** because model setup, tools, permissions, skills, and TUI need one contract.
3. **Provider/model catalog** because model onboarding is the first daily-use blocker.
4. **TUI workbench** because it makes the product feel usable.
5. **Tool registry and LSP/web/project tools** because coding capability depends on richer tools.
6. **Session UX** because users need durable work assets.
7. **Permission rules** because repeated daily work needs less friction without less safety.
8. **Cross-platform agent interop contract** because rooms, subagents, SDK, TUI, and packaging need one shared remote-agent interface.
9. **Subagent task tool** because it turns existing room/subagent infrastructure into everyday capability through the interop contract.
10. **Local API/SDK/event stream** because Web/Desktop/SDK should wrap stable contracts.
11. **Packaging and docs** once the local product loop is coherent.

## Milestones

### Milestone A: Local Product Core

**Target:** A developer can install/source-run Soloclaw, configure a provider, start TUI, run a coding task, inspect changed files, see verification, and resume the session.

**Included workstreams:** 1, 2, 3, 5, 12.

**Gate:**

```powershell
npm.cmd run build
npm.cmd run check
npm.cmd test
node dist\cli\index.js model doctor --json
node dist\cli\index.js tui smoke --json
node dist\cli\index.js phase1 verify --json
node dist\cli\index.js phase2 verify --workspace E:\code\agent --json --cleanup
node dist\cli\index.js phase3 gate --workspace E:\code\agent --json
```

### Milestone B: Coding Capability Core

**Target:** Soloclaw can perform richer local coding work with registry tools, LSP context, project tools, safer output handling, managed sessions, and ergonomic permissions.

**Included workstreams:** 4, 6, 7.

**Gate:**

```powershell
npm.cmd run build
npm.cmd run check
npm.cmd test
node dist\cli\index.js sessions list --json
node dist\cli\index.js tools list --json
node dist\cli\index.js phase3 long-task-gate --workspace E:\code\agent --json
```

### Milestone C: Multi-Agent Product Loop

**Target:** The existing room/subagent system becomes a normal mixed-agent coding workflow: launch local or remote background task, inspect child session, route work to another platform, receive signed acknowledgement, sync result artifacts, hand off room work, and recover safely.

**Included workstreams:** 8, 9, and required Phase 5.5 evidence collection.

**Gate:**

```powershell
npm.cmd run build
npm.cmd run check
npm.cmd test
node dist\cli\index.js phase5 verify --workspace E:\code\agent --json
node dist\cli\index.js phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --registered-pull-target macos-shell-agent --json
```

**Mixed-Agent Product Gate:**

- control-plane host plus at least two remote agents from different OS families;
- one registered-agent pull path;
- one direct routed task by immutable agent id;
- one role-routed task;
- one remote-to-remote handoff request, acceptance, and completion;
- one stale heartbeat detection and recovery;
- one key rotation with old-signature rejection and replacement-key success;
- one remote artifact result sync with sha256 and room binding;
- final delivery-status shows zero pending routed messages for every active remote agent;
- evidence contains no control token, invite token, raw invite bundle, private key, raw signed envelope, raw prompt, raw response, or secret-shaped text.

### Milestone D: Platform Surface

**Target:** CLI/TUI/Web/Desktop/future SDK can share one local API and event stream, and release packaging has a repeatable smoke path.

**Included workstreams:** 10, 11, 12.

**Gate:**

```powershell
npm.cmd run build
npm.cmd run check
npm.cmd test
node dist\cli\index.js doctor --json
.\scripts\smoke-installed-cli.ps1
```

## Explicit Non-Goals For This Plan

- No production native desktop app before the control-plane API and packaging contract are stable.
- No production Android automation beyond the existing Termux/companion boundary.
- No production distributed autonomy before Phase 4.5 and Phase 5.5 evidence is closed.
- No replacement of the policy/audit/runtime boundary with direct UI or plugin execution.
- No direct peer-to-peer agent execution path before the room/control-plane interop contract, event mirroring, revocation, replay protection, and audit semantics are production-ready.
- No remote tool, plugin, MCP, SDK, native app, or daemon execution path may use raw room transcript messages as wake-up triggers.
- No marketplace or remote skill/plugin install before local trust, signing, and permission rules are ready.

## Self-Review

- Spec coverage: This plan covers the opencode comparison gaps plus Soloclaw-specific cross-platform room requirements: product workbench, CLI modularity, config schema, provider/model catalog, tool registry, LSP/web/project tools, permission UX, session UX, cross-agent interop contract, subagent task tool, API/SDK, packaging, and docs.
- Placeholder scan: The plan does not use TBD/TODO placeholders; later work is explicitly scoped as future work with gates.
- Type consistency: File and service names introduced here are stable proposal names for follow-up detailed plans.
- Phase boundary: The plan preserves Phase 4.5/5.5 evidence requirements and does not claim production Phase 6 capability.

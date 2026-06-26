# Architecture Blueprint

## Layering

```text
CLI / UI
  -> AgentLoop
  -> ModelClient
  -> ToolRuntime
  -> WorkspaceRuntime
```

The core rule is that the agent orchestration layer never talks directly to the filesystem or shell. It calls tools, and tools call a workspace runtime. Today the runtime is TypeScript. Later it can be replaced by a Rust worker without changing the agent loop.

## Packages Later

```text
@agent/core       AgentLoop, ContextManager, Planner
@agent/model      ModelClient and providers
@agent/tools      Tool definitions
@agent/workspace  permissions, snapshots, runtime
@agent/session    SQLite session store
@agent/cli        terminal UX
@agent/ui         web app
```

## CLI Product Command Boundary

Workstream 1 of the product maturation plan turns `src/cli/index.ts` into a thin startup and routing layer. The CLI boundary is:

```text
src/cli/index.ts
  -> process startup, no-arg TUI startup, early global option parsing
  -> CommandRouter
  -> src/cli/commands/*.ts
  -> existing domain services, stores, renderers, and verification gates
```

Command modules own command matching and error-to-exit-code behavior. They may receive existing builders/renderers through dependency injection while the legacy implementations are still being moved. They must not bypass `WorkspaceRuntime`, policy, approval, audit, secret redaction, memory priority, room routing, or evidence gates.

Current migrated modules:

| Module | Commands | Notes |
| --- | --- | --- |
| `src/cli/commands/help.ts` | `help`, `--help`, `-h` | Owns help command registration; the renderer still lives in `src/cli/index.ts`. |
| `src/cli/commands/quickstart.ts` | `quickstart` | Owns quickstart execution shell; view construction and rendering still live in `src/cli/index.ts`. |
| `src/cli/commands/workbench.ts` | `init`/`setup`, `tui`, `local`/`agent`, `smoke`, `workbench verify`, `doctor`/`check`, `status`, `platform doctor|check`, `inspect` | Owns product onboarding, TUI startup, local-agent status/service/logs, smoke, completion-gate, readiness, status, platform, and inspect execution shells; builders/renderers still live in `src/cli/index.ts`. |
| `src/cli/commands/model.ts` | `providers`, `model`, `models` | Owns global model profile command control flow plus legacy workspace model provider profiles and usage summaries while using existing profile stores, setup builders, usage stores, and renderers. |
| `src/cli/commands/config.ts` | `config path`, `config show`, `secrets` | Owns current config inspection command flow and local secret CLI control flow while using existing platform capability detection, global profile store, secret store, secret broker, and redaction contracts. |
| `src/cli/commands/session.ts` | `sessions`, `show-session`, `session diff|report|status|inspect|timeline|logs|review|bundle|result|next|verify|compact|delete`, `pause`, `cancel`, `changes`, `resume`, `artifacts`, `approvals`, `approve`, `deny`, `replay`, `audit` | Owns session dashboard/read paths, legacy payload reads, inspection/evidence views, verification, bundle export, compaction, deletion, low-risk pause/cancel command flow, read-only file-change listing, resume command flow, artifact command flow, approval listing/decision flow, approved-tool replay, and audit list/export/verify flow while `src/cli/index.ts` still injects existing builders, renderers, task/lifecycle services, stores, agent resume, model-readiness, artifact lifecycle, workspace-local bundle writer, scoped approval helper, MCP continuation, workspace/plugin tools, replay service, task broker, audit export service, and local identity. |
| `src/cli/commands/tools.ts` | `tool`, `commands`, `skills`, `knowledge`, `plugins`, `mcp` | Owns single-tool command control flow, local `.agent/commands` list/show/run command-template flow, skill list/load/show flow, knowledge ingest/search/eval flow, plugin list/show/run flow, and MCP registry/planning/execution/health flow while `src/cli/index.ts` still injects existing workspace-tool, policy, command-loader, command-service, model-profile, skill loader/store, knowledge, plugin, MCP registry/runtime, redaction, secret broker, local platform, and audit wiring. |
| `src/cli/commands/memory.ts` | `memory` | Owns reviewed persistent-memory command flow for add/delete/summary/extract/candidates/approve/reject/search/usage/snapshot/eval/list while `src/cli/index.ts` still injects existing local platform, retrieval service, snapshot service, local actor, and file/output helpers. |
| `src/cli/commands/web.ts` | `web` | Owns local Web console startup, host/port/token parsing, startup URL output, and signal shutdown wiring while `src/cli/index.ts` still injects the existing Web server startup and process hooks. |
| `src/cli/commands/workspace.ts` | `workspace` | Owns recent-workspace list/add/use command flow while `src/cli/index.ts` still injects existing workspace history helpers, path resolution, selector resolution, and history rendering. |
| `src/cli/commands/admin.ts` | `orgs`, `retention`, `git`, `pr` | Owns organization/project/grant, retention policy, git status, and PR preparation command flow while `src/cli/index.ts` still injects existing parsers, policy checks, and platform services. |
| `src/cli/commands/workers.ts` | `workers`, `scheduler`, `assignments`, `operator` | Owns worker registration/heartbeat/polling, scheduler tick/run, assignment lifecycle, and operator projection command flow while `src/cli/index.ts` still injects existing parsers, renderers, control-plane construction, actor parsing, and signal hooks. |
| `src/cli/commands/spec.ts` | `spec` | Owns native specification, task, plan, clarification, verification, evidence, delegation, and dispatch command flow while `src/cli/index.ts` still injects existing specification services, parsers, actor, and output helpers. |
| `src/cli/commands/agents.ts` | `identity`, `agents` | Owns local identity show/init plus agent listing, health, stale recovery, trust, and key-rotation command flow while `src/cli/index.ts` still injects existing identity, control-plane, actor parsing, trust parsing, and file-read helpers. |
| `src/cli/commands/subagents.ts` | `delegate`, `subtasks` | Owns top-level child-session delegation and subtask list command flow while `src/cli/index.ts` still injects run-argument parsing, local subagent service, actor attribution, and store access. |
| `src/cli/commands/rooms.ts` | `rooms`, `room` convenience help/normalization | Owns local room CRUD, invites, invite bundles, roster/handles, routed inbox, delivery cursor acknowledgement, member role/status/alias updates, room messages, and shortcut normalization while preserving room routing diagnostics and signed invite behavior. |
| `src/cli/commands/remote.ts` | `remote` | Owns remote registration, enrollment, invite-bundle bootstrap, room invitations, accept-room, inbox, say, ack, poll, heartbeat, service-plan, and foreground runner command flow while preserving token-safe output, status-file, stop-file, signed ack, and heartbeat behavior. |
| `src/cli/commands/phases.ts` | `phase1`, `phase2`, `phase3`, `phase4`, `phase5` | Owns top-level phase command dispatch. Phase 1 control flow lives in the module; Phase 2-5 route through existing evidence handlers so verifier internals and Phase 4.5/5.5 boundaries remain unchanged. |
| `src/cli/commands/hygiene.ts` | `hygiene` | Owns execution-hygiene scan output, JSON summary shape, and error exit behavior. |

Remaining top-level command inventory in `src/cli/index.ts`:

| Target module | Current command groups |
| --- | --- |
| Keep in entry startup | no-arg TUI start, leading `--workspace`, pre-router `room help` shortcut, `room` shortcut normalization call, unknown-command JSON/text error formatting, and natural-language `run` / `ask` / target-mode dispatch |
| `config.ts` | later product config doctor/show commands |

Migration order stayed risk-weighted: small read-only and product-onboarding commands moved first, then model/config/session/tools groups, then room/remote commands, and phase gates last because they carry evidence contracts.

## Rust Migration Boundary

Start with:

```text
TS AgentLoop
  -> WorkspaceRuntime interface
  -> LocalWorkspaceRuntime implementation
```

Then replace with:

```text
TS AgentLoop
  -> JsonRpcWorkspaceRuntime
  -> Rust worker over stdio
```

The first concrete protocol is newline-delimited JSON-RPC 2.0 over stdio. The schema lives in `src/workspace/workspace-runtime-jsonrpc-schema.ts`, the TypeScript adapter lives in `src/workspace/json-rpc-workspace-runtime.ts`, the Rust worker scaffold lives in `crates/agent-runner`, and the initial Rust patch engine scaffold lives in `crates/agent-diff`. The shared smoke tests cover both raw `WorkspaceRuntime` compatibility and the higher tools/policy/audit path. See `docs/workspace-runtime-jsonrpc.md`.

This is a deliberately decoupled boundary. TypeScript keeps orchestration, policy, sessions, approvals, audit, control-plane views, and model calls. Rust workers implement narrowly scoped runtime capabilities behind the same `WorkspaceRuntime` method set and are wrapped by the same `createWorkspaceTools` / `withPolicy` path before use. MCP remains the external tool/capability protocol, not the default internal runner protocol; Protobuf can be added later as a versioned binary encoding if runner traffic needs it.

Best first Rust modules:

1. `agent-runner`: command execution, timeouts, output truncation, permission checks.
2. `agent-indexer`: tree-sitter symbols and large-repo indexing.
3. `agent-diff`: robust patch parsing and application.

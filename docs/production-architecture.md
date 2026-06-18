# Production Architecture

## Product Positioning

This project targets a privately deployable professional agent platform.

Core assumptions:

- Cross-platform deployment: Windows, macOS, Linux, Android Termux, containers, and later native Windows/macOS/Android app surfaces.
- MIT-licensed open source.
- Private deployment first: self-hosted team or organization installation.
- Distributed agents: agents running on different machines can communicate and coordinate.
- Multi-user organizations: users, orgs, projects, roles, permissions, and audit trails.
- Git provider automation: GitHub and GitLab PR/MR creation and update.
- Long-term storage is allowed for sessions, traces, artifacts, code indexes, and audit records.
- Web UI and TUI/CLI operator surfaces advance in parallel during the local professional alpha, sharing control-plane view models and status vocabulary; native Windows/macOS desktop apps and the Android companion/native app come later as wrappers over the same control-plane contracts.

Security architecture is part of the product contract. Every deployment shape must preserve the boundaries in `docs/security-boundaries.md`: default-deny capability expansion, scoped policy grants, human approval for irreversible actions, secret leases, sandboxing, signed cross-machine identity, routed room wake-up, safe audit, and explicit Android/mobile limits.

Native applications must not become a separate privileged path. The Windows desktop app, macOS desktop app, and Android companion/native app should authenticate to the same local or room control plane, render the same permission-filtered views, submit the same approval decisions, record the same audit events, and delegate execution to the supervised agent/runtime layer. Platform-specific integrations such as notifications, keychain/credential storage, launch agents, update channels, Android intents, and guided mobile actions are product surfaces around the control plane, not replacements for policy.

## Deployment Shapes

### Local Professional Mode

```text
Desktop / CLI
  -> local agent server
  -> local workspace runtime
  -> SQLite
  -> local artifacts
```

Use this for single-user development and offline-first workflows.

### Private Team Mode

```text
Web UI / CLI
  -> control plane API
  -> PostgreSQL
  -> object storage
  -> queue / event bus
  -> agent workers
       -> workspace runtimes
       -> repositories / worktrees
```

Use this for organizations, shared projects, long-running tasks, PR automation, and auditability.

Current local implementation note: `agent web` hosts a token-gated local control-plane API and room console on a configurable host/port. It reuses the same SQLite-backed platform services as the CLI and exposes local JSON endpoints for room state, the filterable on-demand session dashboard, lightweight session diff packages, consolidated session report packages, lightweight session status snapshots, focused session inspection, focused session next actions, safe session timelines, lightweight session review packages, lightweight session result packages, shared session verification packages, session lifecycle actions, approvals, artifacts, retention policies, audit events, and worker registration/heartbeat. This is a bridge toward the private-team control plane, not the production API boundary.

### Distributed Agent Mesh

```text
control plane
  -> agent registry
  -> message broker
  -> machine A agent
  -> machine B agent
  -> machine C agent
```

Each machine agent registers capabilities, health, location, workspace bindings, and policy constraints. The control plane assigns work and mediates communication. Peer-to-peer communication can come later; start with brokered communication through the control plane.

Current local implementation note: `agent workers register/list/heartbeat/drain/complete-drain/verify-heartbeat/recover-expired/cleanup-nonces/health/run-once/poll`, `agent scheduler tick/run`, `agent assignments ...`, and the matching local control-plane API store worker registrations and task assignment leases in SQLite. A `TaskBroker` interface now defines enqueue/claim/complete/recover semantics, with `LocalAssignmentTaskBroker` adapting the SQLite assignment table for local mode. Broker claims write a `leaseEnvelope` metadata record and local platform claims can sign that envelope with the local agent Ed25519 key; signed lease nonces are stored in SQLite to reject local replay, expired lease nonce records can be cleaned with an audited local operation, and worker execution can optionally require a valid signed lease envelope before running the target session. Worker heartbeats attach a signed `heartbeatEnvelope` metadata record when the local agent identity matches the worker, signed heartbeat nonces are stored in SQLite to reject local replay, expired nonce records can be cleaned with an audited local operation, explicit drain marks a worker draining with reason metadata plus audit records, complete-drain moves a worker offline only after active assignments are gone, and scheduler ticks can optionally auto-complete drained workers with no active assignments while reporting blocked draining workers. `agent workers health` and `GET /api/workers/health` derive local capacity, load, expired heartbeat, blocked drain, retry, and queue-pressure metrics from worker/assignment rows. Worker recovery can mark stale online/draining workers offline and clear local load. `run-once` can consume one owned assignment, `poll` can consume a bounded batch until limit, idle, pause, or worker drain/offline state, assignment `recover-expired` can expire stale leases, auto-select retry workers, and delay retry visibility with `retryNotBefore` metadata. `scheduler tick` combines recovery plus worker polling into one pass, can optionally require valid signed worker heartbeat envelopes before polling, can pass signed lease enforcement to worker polling, supports pre-delegation spec dispatch backpressure by projected load ratio and active assignment count, can optionally complete idle draining workers, and emits `healthWarnings` for recovered or active expired leases, blocked drains, worker saturation, and queue pressure. `scheduler run` repeats those passes with max-tick, idle, and signal stop conditions. This proves the worker execution contract, but production must replace it with authenticated agent registration, mandatory signed heartbeat/lease verification, Redis/NATS/Postgres-backed assignment, supervised scheduler/worker daemons, retry orchestration, broker-native queue pressure metrics, backoff policy, distributed nonce replay windows, and supervised stale-worker recovery plus graceful drain completion.

## Core Services

```text
control-plane-api
  - auth
  - organizations
  - projects
  - sessions
  - specifications and goal plans
  - task orchestration
  - policy decisions
  - GitHub/GitLab integrations

agent-worker
  - runs agent loops
  - executes tools
  - reports events
  - owns one or more workspace runtimes

agent-runner
  - shell execution
  - filesystem operations
  - patch application
  - sandbox boundaries

agent-indexer
  - repository indexing
  - symbol extraction
  - semantic search

web-ui
  - task timeline
  - specification / plan / task views
  - tool call trace
  - diff review
  - approval requests
  - PR status
  - room collaboration and local room visibility
```

The local `ControlPlaneService` is the first modular-monolith boundary for this shape. Production should keep the service boundary but replace local token auth with authenticated users/agents, tenant-aware authorization, CSRF protection for browser sessions, rate limits, signed approval envelopes, and SSE/WebSocket event delivery.

## Security Control Plane

Engineering-grade Soloclaw deployments should treat security as a cross-cutting control plane:

```text
request
  -> authenticate actor or agent
  -> resolve org/project/room/session scope
  -> classify capability and risk
  -> evaluate managed policy plus scoped grants
  -> allow, ask, deny, or allow_with_constraints
  -> execute through sandbox/secret/tool boundary
  -> record safe audit and operator state
```

Core mechanisms:

- policy engine for allow/ask/deny decisions;
- capability grants scoped to org, project, room, session, tool, and secret purpose;
- approval service with bound continuation payloads;
- secret broker with short-lived leases and no raw secret audit;
- sandbox/workspace runtime with protected paths, locks, and network policy;
- signed agent, worker, room-message, ack, heartbeat, and lease envelopes;
- redaction and artifact capture for tool/model/plugin/MCP outputs;
- operator views for blocked, paused, stale, revoked, draining, waiting-for-approval, failed, and retry-delayed states.

See `docs/security-boundaries.md` for the phase-by-phase acceptance gates.

## Storage

Use storage by responsibility, not one database for everything.

```text
PostgreSQL
  - users
  - organizations
  - roles
  - projects
  - sessions
  - messages
  - tool calls
  - plans
  - specifications
  - specification tasks
  - approvals
  - audit events
  - Git provider installations
  - repository metadata

Redis / broker
  - queues
  - leases
  - locks
  - short-lived coordination state
  - streaming task events

Object storage
  - command logs
  - large diffs
  - screenshots
  - browser traces
  - generated reports
  - archived transcripts

Search / vector index
  - repository chunks
  - symbols
  - embeddings
  - enterprise knowledge sources and chunks
  - long-term memory
```

For private deployment, object storage can be S3, MinIO, or filesystem-backed storage.

Enterprise knowledge retrieval is a core platform capability. The production RAG path should use ACL-filtered hybrid retrieval, reranking, citation-aware context packing, and an evaluation harness with project/org-specific golden sets. MCP servers are connectors/capabilities, not trusted shortcuts around ingestion, policy, redaction, or audit. See `docs/knowledge-rag.md`.

Spec-driven development is a goal-planning capability, not a replacement for sessions or task leases. The platform should keep native specifications and task records, then optionally import/export `github/spec-kit` style `.specify` workspaces. Direct spec-kit CLI execution belongs in an optional plugin and remains subject to policy, sandboxing, and audit. See `docs/spec-driven-development.md`.

MCP is part of the capability plane, not a trusted bypass around platform policy. The current local TypeScript implementation stores non-secret MCP registry metadata in `.agent/mcp-servers.json`; `agent mcp list/register/show/remove` manages server definitions, and `agent mcp plan` evaluates enabled state, project/room allowlists, execution mode, declared risk, server approval policy, and `mcp.connect` policy without connecting to the server. Registry and planning actions emit safe audit events such as `mcp.server_registered`, `mcp.server_removed`, and `mcp.connection_planned`. `LocalMcpRuntime` plus `McpExecutionService` now provide a local stdio/HTTP JSON-RPC execution path for capability listing, tool calls, and resource reads with `PolicySecretBroker` leases, per-operation policy checks, bounded/redacted results, `AGENT_MCP_EXECUTION=disabled` global blocking, timeout/transport/runtime failure classification, `mcp.executed` audit summaries, and local `agent approve --auto-replay` continuation for `ask` decisions. `McpHealthService` and `agent mcp health` provide safe local diagnostics for healthy, disabled, blocked, timeout, and failed states. Production paths still need sandboxed process/network policy, Web/API execution surfaces, agent-tool integration behind explicit grants, signed approval envelopes, quorum continuation, and stronger room/session-scoped audit before MCP tools are broadly available.

Long-term data lifecycle:

```text
hot transcript
  -> summarized session memory
  -> archived artifacts
  -> project retention policy
  -> user/admin deletion or export
```

Enterprise deployments must support audit log export. The local CLI currently provides JSONL/JSON export plus signed bundle JSON from the active store. Local bundles include filter metadata, event count, SHA-256 over canonical event JSON, and a local-agent Ed25519 signature. Production export should move that contract into retention-policy-aware jobs with tamper-evident manifests, immutable storage, legal hold, and optional SIEM sinks.

Current local implementation note: `agent retention`, `agent artifacts`, and `agent session compact/delete` provide a SQLite-backed lifecycle MVP. Artifacts are metadata records with optional local file pointers, session compaction removes hot transcript rows after writing summaries, and retention sweep is manually triggered per project. Production must replace this with scheduled workers, object storage lifecycle policies, legal hold, and signed deletion/export manifests.

## Database Recommendation

Keep SQLite for local mode and tests. Add PostgreSQL for team/private production mode.

The code should expose:

```ts
interface AgentStore {
  createSession(...): Promise<Session>;
  appendMessage(...): Promise<void>;
  recordToolCall(...): Promise<void>;
  recordApproval(...): Promise<void>;
  recordAuditEvent(...): Promise<void>;
}
```

Implementations:

```text
SqliteAgentStore
PostgresAgentStore
```

Do not let agent logic depend on either SQLite or PostgreSQL directly.

## Identity and Permissions

Model:

```text
Organization
  -> Project
  -> Repository
  -> Workspace
  -> Session
```

Actors:

```text
User
ServiceAccount
AgentWorker
GitProviderInstallation
RoomObserver
```

Permissions:

```text
org.admin
project.admin
repo.read
repo.write
session.create
session.approve_tool
session.cancel
pr.create
pr.merge
secret.read
room.create
room.invite_agent
room.approve_join
room.delegate_task
agent.super_approve
```

Every tool call should evaluate policy before execution.

Current local implementation note: `agent orgs` manages SQLite-backed organizations, projects, and scoped capability grants. Creating an organization grants `org.admin` to the creator, creating a project grants `project.admin`, and explicit grants such as `tool.approve` can be assigned to users, agents, or service accounts. Production deployments still need authenticated users, tenant isolation, role templates, revocation, and a policy engine backed by the control plane.

## Agent-to-Agent Communication

Start with control-plane-mediated communication. Support both direct agent messages and multi-agent rooms.

```text
agent A
  -> emits event / request
  -> control plane validates policy
  -> broker routes message
  -> agent B receives task/message
```

For group collaboration, create an agent room:

```text
room
  -> members: agents, users, service accounts
  -> policy: who can join, speak, approve, delegate, execute
  -> transcript: messages, decisions, tool requests, approvals
  -> artifacts: patches, logs, screenshots, PR links
```

The room model should feel like several agents standing in the same workspace conversation, while every message and capability escalation is signed, authorized, and auditable.

Humans can join rooms either as active participants or read-only observers.

Large rooms should use mention-based wake-up routing, and newly created professional rooms should default to `mentions_only`. Messages remain part of the shared transcript for authorized readers, but agents only auto-respond when routed to them through `@agent:<id>`, a unique room alias, a policy-gated `@role:<role>` / `@all`, a task assignment, or an approval request. The routing envelope must be structured, signed with the room message, audited, and enforced by worker polling before loading room context. This keeps multi-agent rooms scalable without losing replayability.

The wake-up payload should be a bounded activation context, not the whole room. The local TypeScript implementation derives `activationContext` for routed inbox messages with the matched reason, triggering target, current message, recent transcript window, and acknowledgement policy. Production brokers should preserve that contract while moving context-window construction, unread state, and delivery fanout into authenticated streaming infrastructure.

The Web UI/TUI should make agent identity mentionable without ambiguity: show alias, immutable agent id, display name, fingerprint, machine, status, current load, and last-seen time. Unresolved or ambiguous mentions should be visible to the sender and should not wake a fallback agent. Non-addressed agents may receive summaries or subscription digests later, but those feeds must not trigger execution unless policy explicitly grants a watcher role.

Routing observability is part of the protocol. The local implementation stores signed `metadata.routingDiagnostics` and `room.routing.warning` audit events for unresolved, ambiguous, inactive, unknown, or empty wake targets. Production should make those diagnostics first-class typed events so senders, operators, and audit exporters can distinguish "message visible in transcript" from "no agent was actually woken".

The local TypeScript `RemoteRoomRunner` is the first implementation boundary for that wake-up contract: it reads a remote agent's routed inbox, submits signed delivery acknowledgements, runs bounded polling for development, and provides a foreground supervised loop with idle-stop and transient-error backoff. Production should keep the contract but host it in a supervised daemon or streaming worker with authenticated agent sessions, health checks, durable backoff state, drain/shutdown handling, and distributed delivery cursors.

Remote agents also need an identity-level heartbeat that is separate from worker capacity heartbeats. The local control plane accepts signed `AgentHeartbeatEnvelope` records at `POST /api/agents/:agentId/heartbeat`, updates `lastSeenAt`, heartbeat status, expiry, room id, and last error metadata, and rejects replayed nonces. `AgentHealthService`, `agent agents health`, `GET /api/agents/health`, and `/api/state.agentHealth` derive the room-console view from those rows: live, idle, running, error, stale, offline, unknown, responsive counts, and machine/room grouping. Production should move this into authenticated agent sessions with stream-level liveness, distributed nonce windows, stale-agent recovery, revocation, health time-series, and Web UI health timelines.

Message types:

```text
task.assign
task.status
task.result
agent.ask
agent.reply
room.create
room.invite
room.join.request
room.join.approve
room.message
room.decision
capability.announce
workspace.lock.request
workspace.lock.release
approval.request
approval.result
```

Each agent should have:

```text
agent_id
machine_id
org_id
capabilities
allowed_projects
workspace_bindings
heartbeat
current_load
```

Join methods:

```text
manual_approval
invite_token
public_key_fingerprint
admin_approval
quorum_approval
same_org_policy
```

Trust states:

```text
pending
trusted
suspended
revoked
expired
```

Do not grant blanket trust. Pair agent identity trust with explicit capability grants.

```text
trust = this agent is who it claims to be
capability = this agent may perform specific actions in this room/project
```

See `docs/agent-rooms.md` for the dedicated room design.

## GitHub and GitLab Automation

Preferred workflow:

```text
clone or fetch repository
create isolated branch/worktree
run agent task
apply patch
run tests
commit changes
push branch
open PR/MR
update PR/MR description
listen to CI results
iterate if allowed
```

Store:

```text
provider
installation_id
repo_id
branch
commit_sha
pr_number / mr_iid
ci_status
webhook deliveries
```

Do not let workers store long-lived Git provider tokens directly. Use the control plane to mint short-lived credentials or scoped job tokens.

Current local implementation note: `agent git status` and `agent pr prepare` provide a dry-run-first local Git workflow that can generate GitHub/GitLab PR/MR creation URLs and optionally branch/commit/push under policy checks. Production deployments still need provider API adapters, stored PR/MR refs, webhook ingestion, and isolated worktree execution.

## Workspace Isolation

Local mode:

```text
workspace path + git worktree + permission prompts
```

Team production mode:

```text
one task -> one isolated worktree or container workspace
```

High-security mode:

```text
ephemeral container / VM
network policy
secret policy
artifact capture
automatic teardown
```

Locking policy:

```text
repository: allows concurrent sessions
file: only one agent may write the same file at a time
branch/worktree: isolated per task when Git automation is enabled
room: shared coordination, not a write lock by itself
```

Retries:

```text
transient tool failure: retry with exponential backoff
model/provider failure: retry or route to fallback provider
patch conflict: reread file, rebase patch, retry once
test failure: continue only if task policy allows repair iteration
permission denial: do not retry automatically
destructive operation failure: do not retry automatically
```

Current local model reliability implements the first provider step for HTTP models: OpenAI, Anthropic, Gemini, Kimi/Moonshot, Grok/xAI, MiniMax, DeepSeek, GLM/Z.AI, Qwen/DashScope, MiMo, OpenAI-compatible, and Anthropic-compatible endpoints are registered through provider profiles. Non-Anthropic commercial providers currently use the OpenAI-compatible chat adapter with provider-specific default base URLs, model names, and API key env aliases. Local `.agent/model-providers.json` overrides can edit protocol, base URL, default model, API key env names, and encrypted local secret refs without storing raw secrets; TUI `/model setup` exposes the common provider/base URL/model/key flow. Transient network failures, 408/409/425/429, and 5xx responses can retry with bounded backoff and `Retry-After`; `FallbackModelClient` can route to configured backup providers only for transient provider errors. `GuardedModelClient` adds local in-process model call budgets, failure budgets, and consecutive-failure circuit breaking through CLI knobs. Authentication, authorization, malformed request, and other non-retryable provider failures must fail visibly and must not be hidden by fallback routing. Production should replace local profile files and in-process guards with a tenant-scoped provider registry, distributed quota service, shared circuit breaker state, and provider-specific clients where APIs diverge.

## Auditability

Persist these events long term:

```text
session.created
session.paused
session.resumed
session.cancelled
session.compacted
session.deleted
model.called
tool.requested
tool.approved
tool.denied
tool.completed
file.changed
command.started
command.finished
pr.created
pr.updated
policy.denied
secret.accessed
secret.denied
agent.message_sent
agent.message_received
agent.heartbeat
agent.health_changed
room.created
room.join_requested
room.join_approved
room.invite.created
room.invite.revoked
room.message
room.routing.warning
room.routing.wide
room.delivery.acked
task.assigned
task.lease_expired
task.retry_scheduled
task.completed
task.failed
task.cancelled
worker.registered
worker.heartbeat
worker.drained
worker.expired
assignment.claimed
assignment.completed
assignment.failed
spec.created
spec.task_changed
spec.plan_created
spec.plan_approval_requested
spec.verified
knowledge.ingested
knowledge.searched
knowledge.eval_run
artifact.registered
artifact.deleted
retention.policy_applied
mcp.server_registered
mcp.server_removed
mcp.connection_planned
mcp.executed
plugin.executed
```

Local `model.called` events are metadata-only: actor, session scope, provider/model labels, fallback providers, target mode, message/tool counts, approximate input size, duration, success/failure, response type, safe error class metadata for budget/circuit failures, provider request/response ids, provider response model, and provider-reported token usage when available. They must not include prompt text, model response text, tool inputs, retrieved document text, API keys, or other secret material. `agent models usage` can summarize those local audit rows by provider/model and can estimate cost only when the operator supplies token prices. Local signed export bundles preserve the same no-prompt/no-response boundary. Production can add managed cost calculation, provider price tables, quota decision ids, metric sinks, and centralized export signing.

Audit records should include actor, org, project, session, timestamp, input summary, output summary, and artifact pointers.

## Recommended Implementation Order

The local TypeScript MVP has already advanced through many early protocol and domain slices. The first Rust handoff boundary is now explicit: `JsonRpcWorkspaceRuntime` can call a newline-delimited JSON-RPC 2.0 worker over stdio using the `workspace-runtime-jsonrpc.v1` schema, `crates/agent-runner` is the Rust scaffold for that worker shape, `crates/agent-diff` provides the initial guarded unified-diff patch path behind `workspace/applyPatch`, and the Rust-backed tools/policy/audit smoke proves that runner use still flows through TypeScript file-change, audit, and approval records. Treat the following order as the productionization sequence from the current state:

1. Expand the adversarial/security test suite around prompt injection, secret exfiltration, poisoned RAG, forged room/agent messages, plugin isolation, MCP boundaries, and retention deletion/export.
2. Freeze core interfaces that must survive production replacement: store, broker, migrations, object storage, policy, secret broker, workspace runtime, `workspace-runtime-jsonrpc.v1`, model provider, MCP runtime, Git provider, artifact store, event stream, and search adapter.
3. Wire the MCP stdio/HTTP runtime into policy, secret leases, sandboxed transports, per-tool/resource grants, Web/API diagnostics, and complete audit through one shared runtime boundary.
4. Upgrade RAG to ACL-filtered hybrid retrieval with embeddings, full-text search adapters, reranking, citation precision checks, permission-leak eval, freshness checks, and CI trend gates.
5. Promote worker, scheduler, and remote-agent runners into supervised-daemon-ready services with authenticated agent sessions, mandatory heartbeat/lease verification, key rotation, revocation, drain/shutdown, and health streaming.
6. Advance authenticated Web UI and TUI surfaces together for rooms, approvals, specs, sessions, workers, health, MCP diagnostics, artifacts, and audit export.
7. Add production storage and coordination replacements: versioned migrations, `PostgresAgentStore`, object storage adapter, Redis/NATS/Postgres-backed queue semantics, visibility timeout, delayed retry, poison queue, metrics, signed leases, and compatibility tests that keep SQLite local mode intact.
8. Implement GitHub App/GitLab OAuth adapters, isolated worktrees, stored PR/MR refs, webhook/CI ingestion, and repair iteration policy.
9. Add production permission filtering, real-time event delivery, and admin workflows to the Web/TUI surfaces.
10. Add Rust/container runner, resource limits, network policy, artifact capture, and workspace teardown.
11. Package private deployment: Docker Compose, config templates, migrations, backups, upgrades, observability, and operational runbooks.

## Non-Negotiable Boundaries

- Agent orchestration must not depend on local filesystem APIs directly.
- Tool execution must go through policy checks.
- Rust runner implementations must stay behind `WorkspaceRuntime` / JSON-RPC compatibility tests plus the tools/policy/audit smoke; they must not create a second orchestration, policy, approval, or audit path.
- MCP is the external capability protocol, not the internal workspace-runner replacement protocol.
- Protobuf can be introduced only as a versioned transport encoding beside the same semantic runner contract, not as a competing method set.
- Long outputs and artifacts must not be stored inline in hot database tables.
- Distributed agents must authenticate as agents, not as users.
- Git provider tokens must be scoped, encrypted, and rotated.
- Every code change must be traceable to a session, actor, and tool call.

# Task Operations

## Long-Running Tasks

Tasks support:

```text
pause
resume
cancel
timeout
retry
handoff
```

Task state must be durable:

```text
session
plan
current step
tool calls
workspace locks
artifacts
approval requests
room messages
```

## Approval Resume Flow

Current local CLI flow:

```text
agent run --execution-mode strict "task"
  -> tool action requires approval
  -> session is paused
  -> approval request and pending tool call keep session/tool ids

agent approve <approval-id> --auto-replay --auto-resume "reason"
  -> approval is marked approved
  -> approved pending tool is executed
  -> real tool result is appended to the original session transcript
  -> session resumes from durable messages
```

`--auto-resume` implies `--auto-replay`. Denied approvals keep the session paused for now; production workers should move the session into a clear waiting, failed, or replanning state depending on policy.

MCP approvals use the same decision command. When `agent mcp capabilities`, `agent mcp call-tool`, or `agent mcp read-resource` returns an approval request, `agent approve <approval-id> --auto-replay` continues the bound MCP operation through the MCP planner, secret broker, redaction, and `mcp.executed` audit path. MCP approvals do not resume an agent session unless a later agent-tool integration creates a session-scoped MCP request.

## Audit Export

Current local CLI flow:

```text
agent audit list --limit 20
agent audit list --type tool.completed --actor local-user
agent audit export --format jsonl --output .agent/tmp/audit-export.jsonl --limit 1000
agent audit export --format json --output .agent/tmp/audit-export.json --from 2026-06-01T00:00:00.000Z
agent audit export --format bundle --output .agent/tmp/audit-export.bundle.json --limit 1000
agent audit verify .agent/tmp/audit-export.bundle.json
```

Supported filters are `--limit`, `--type`, `--actor`, `--session`, `--room`, `--project`, `--from`, and `--to`. `--format bundle` writes a tamper-evident JSON bundle with filter metadata, event count, SHA-256 over canonical event JSON, and a local-agent Ed25519 signature. `agent audit verify` recomputes the event hash and verifies the registered agent public key. Local export is intended for development and private single-machine use; enterprise export still needs scheduled retention-aware jobs, immutable storage, legal hold, and SIEM forwarding.

## Workspace Locks

Default locking:

```text
same file: single writer
different files in same project: concurrent writers allowed
repository metadata: serialized when touching git state
branch/worktree: isolated per task for PR automation
```

Locks should have leases and heartbeats so crashed agents do not block forever.

Current local mode uses `SqliteWorkspaceLockManager` and stores workspace leases in `.agent/agent.db`. This coordinates separate local CLI/agent processes for the same workspace. Production mode should move the same contract to Postgres/control-plane leases with worker heartbeats and stale-owner recovery.

## Worker Registry

Current local CLI flow:

```text
agent workers register --display-name "Local Worker" --cap workspace.exec --project proj_xxxxxxxx --max-tasks 2 --ttl 120
agent workers list --status online
agent workers heartbeat worker_xxxxxxxx --load 1 --status draining --ttl 120
agent workers drain worker_xxxxxxxx "planned maintenance" --ttl 120
agent workers complete-drain worker_xxxxxxxx "maintenance complete"
agent workers verify-heartbeat worker_xxxxxxxx
agent workers recover-expired
agent workers cleanup-nonces --before 2026-01-01T00:00:00.000Z --limit 1000
agent workers health --limit 1000
```

Local worker records include agent id, machine id, capabilities, allowed projects, status, current load, max concurrent tasks, heartbeat time, optional expiry, and a `metadata.heartbeatEnvelope` when the local agent identity can sign the heartbeat. Signed heartbeat nonces are recorded locally; reusing the same signed nonce is rejected as replay. `drain` marks a worker `draining`, stores `drainingAt` and optional `drainReason`, and emits a dedicated audit event. `complete-drain` moves a draining worker to `offline` only when it has no active assignments, stores `drainCompletedAt`, and emits a completion audit event. `recover-expired` marks stale online/draining workers offline, clears local load, and emits audit events. `cleanup-nonces` removes expired signed-heartbeat nonce records by `expiresAt` and records an audit event. `health` derives a local JSON summary from worker and assignment rows: worker status counts, online capacity/load/available slots, expired heartbeats, blocked draining workers, assignment status counts, active expired leases, delayed/due retries, queue pressure, and per-worker load.

This is a discovery and coordination MVP. Production workers should authenticate with agent identities, require signed heartbeat verification, reject nonce replays across distributed control-plane nodes, enforce a configured nonce replay window, receive task leases through a broker/control plane, and use drain/offline states for safe shutdown.

## Task Assignments

Current local CLI flow:

```text
agent assignments assign-session sess_xxxxxxxx --worker worker_xxxxxxxx --ttl 300
agent assignments assign-subtask subtask_xxxxxxxx --worker worker_xxxxxxxx --priority 10
agent assignments list --worker worker_xxxxxxxx
agent assignments heartbeat assign_xxxxxxxx --worker worker_xxxxxxxx --ttl 300
agent assignments complete assign_xxxxxxxx --worker worker_xxxxxxxx "completed in child runtime"
agent assignments fail assign_xxxxxxxx --worker worker_xxxxxxxx "runner crashed"
agent assignments cancel assign_xxxxxxxx --worker worker_xxxxxxxx "superseded"
agent assignments recover-expired --retry-worker worker_xxxxxxxx --max-attempts 3 --ttl 300
agent assignments recover-expired --auto-select-worker --backoff-ms 1000 --max-backoff-ms 60000 --jitter-ms 250
agent assignments cleanup-nonces --before 2026-01-01T00:00:00.000Z --limit 1000
```

Assignments lease a session or subtask to one worker. A live assignment prevents a second worker from taking the same target. Heartbeats extend the lease and move the assignment to `running`; completion/failure/cancellation updates the target status and releases worker load. The local platform now wraps these operations in a `TaskBroker` interface so worker runner, scheduler, and control-plane assignment routes share the same enqueue/claim/complete/recover contract. A broker claim also writes a `leaseEnvelope` into assignment metadata; local platform claims can sign it with the local agent Ed25519 key, records signed lease nonces to reject local replay, and audits replay rejections. `--require-signed-lease` makes the local runner verify the claimed lease envelope before executing and reject unsigned or invalid leases without running the target session. `cleanup-nonces` removes expired signed lease nonce records by `leaseExpiresAt` and records an audit event.

When an assignment is scoped to a room, the local task service also appends room transcript events for assignment, lease expiry, retry scheduling, and terminal completion/failure/cancellation. These messages are a human/agent-visible projection of the durable assignment and audit rows; they are not the source of truth.

`recover-expired` scans active assignments whose lease has expired, marks them `expired`, releases the old worker load, and optionally schedules a retry assignment on `--retry-worker`. With `--auto-select-worker`, it picks an online, non-full worker allowed for the target project, preferring the lowest load ratio. `--backoff-ms`, `--max-backoff-ms`, and `--jitter-ms` write a `retryNotBefore` timestamp into assignment metadata; local workers skip retry assignments until that timestamp is due. If no retry is scheduled or the assignment has reached `--max-attempts`, session targets are paused by default so a human or scheduler can decide the next move; `--exhausted-status failed` can fail them instead.

This is still a local control-plane MVP. Production should replace the local assignment-backed broker adapter and best-effort room transcript projection with Redis/NATS/Postgres queues, durable retries, mandatory signed worker leases, nonce replay protection, stale lease recovery, signed room event envelopes, and SSE/WebSocket task status streams.

## Local Worker Runner

Current local CLI flow:

```text
agent workers run-once worker_xxxxxxxx --ttl 300
agent workers run-once worker_xxxxxxxx --require-signed-lease --ttl 300
agent workers poll worker_xxxxxxxx --limit 5 --idle-limit 1 --interval-ms 1000 --ttl 300
agent scheduler tick --runs-per-worker 1 --backoff-ms 1000 --max-backoff-ms 60000 --jitter-ms 250
agent scheduler tick --require-signed-heartbeat --runs-per-worker 1
agent scheduler tick --require-signed-lease --runs-per-worker 1
agent scheduler tick --complete-drained-workers --runs-per-worker 1
agent scheduler tick --warn-load-ratio 0.8 --warn-queue-ratio 1
agent scheduler run --interval-ms 1000 --max-ticks 10 --stop-when-idle --runs-per-worker 1
```

`run-once` heartbeats the worker, picks the highest-priority active assignment owned by that worker, heartbeats the assignment into `running`, resumes the target session, and completes/fails/cancels the assignment based on the resumed session status. If the session pauses for approval or human input, the assignment remains active so a later runner pass can continue it after the pause is resolved.

`poll` repeats the same execution path until it reaches `--limit`, sees enough idle polls, hits a paused assignment, observes the worker is no longer `online`, receives an abort signal, or is run with a daemon lifecycle controller that has requested shutdown. This gives local development a bounded daemon-like loop without hiding the fact that production needs a real worker process.

`LocalWorkerRunner.poll` and `LocalWorkerRunner.runOnce` can be supervised with the same `DaemonLifecycleController` used by the scheduler. Poll results include a lifecycle snapshot plus aggregate metrics for tick count, idle polls, terminal assignments, active leases, failures, and loop latency. A shutdown request stops the worker before claiming new work, preserving existing leases for later recovery or continuation.

If shutdown is requested while an assignment is in flight, the runner uses an explicit local policy:

```text
preserve_lease  -> leave the assignment running for the same worker to continue later
release_lease   -> pause the assignment and release worker load while leaving the target runnable
mark_paused     -> pause the assignment and mark the target session paused
```

`preserve_lease` is the default because it avoids silently changing target state during local foreground runs. Production daemons should make this policy configurable per worker pool, assignment type, and shutdown reason.

Manual lifecycle commands coordinate with assignments:

```text
agent pause sess_xxxxxxxx "operator pause"
  -> session becomes paused
  -> active assignment becomes paused
  -> worker load is released

agent cancel sess_xxxxxxxx "operator cancel"
  -> session becomes cancelled
  -> active assignment becomes cancelled
  -> worker load is released
```

The same lifecycle path is exposed through the local control plane:

```text
POST /api/sessions/:sessionId/pause
POST /api/sessions/:sessionId/resume
POST /api/sessions/:sessionId/cancel
```

`pause` and `cancel` release active assignment leases and worker load. `resume` marks the session runnable again by default; `autoRun: true` asks the local agent loop to continue immediately.

Approval-driven pauses inside an active worker run still keep the assignment leased for later continuation, because the worker may resume the same session after the approval is replayed.

This is a single-process development runner. Production should replace it with a long-running worker daemon that consumes broker leases, signs worker events, honors drain/shutdown state, applies explicit in-flight shutdown policy, uses durable retry policy, and delegates risky execution to the Rust/container runner.

`scheduler tick` is a bounded local scheduler pass. It runs expired-lease recovery with auto-selected retry workers, can dispatch ready specification tasks, then polls online workers with a per-worker run limit. `--require-signed-heartbeat` filters runnable workers through the local Ed25519 heartbeat verifier first and reports skipped workers in `workerHeartbeatRejections`. `--require-signed-lease` passes lease verification through to worker polling so the runner refuses unsigned or invalid claimed leases. `--complete-drained-workers` asks the scheduler to finish draining workers after recovery and polling; workers with active assignments stay `draining` and are reported in `workerDrainBlocked`, while workers with no active assignments move to `offline` and are reported in `workerDrainCompletions`. Tick results include `healthWarnings` derived from worker health metrics and from recovery work performed in that tick. `--warn-load-ratio` defaults to `0.9`; `--warn-queue-ratio` defaults to `1`. This is the local shape of the future daemon loop:

```text
recover expired leases
  -> schedule delayed retries
  -> dispatch ready spec tasks
  -> optionally verify signed worker heartbeats
  -> poll runnable workers
  -> optionally verify signed task leases before execution
  -> optionally complete drained workers with no active assignments
  -> emit health warnings for expired leases, blocked drains, capacity, and queue pressure
  -> report tick summary
```

Spec dispatch during scheduler ticks is opt-in:

```bash
agent scheduler tick --dispatch-spec spec_xxxxxxxx --dispatch-limit 2 --runs-per-worker 1
```

When `--dispatch-spec` is set without `--dispatch-worker`, the scheduler asks the spec workflow to auto-select an online, non-full, project-eligible worker.

`scheduler run` repeats the same tick loop with a configurable interval. Use `--max-ticks` for bounded smoke runs, `--stop-when-idle` with `--idle-ticks` to stop after consecutive idle passes, and Ctrl+C/SIGTERM for graceful local shutdown. The run summary includes aggregate recovered/retry/completion counts, aggregated `healthWarnings`, plus every tick result. It also includes a daemon-ready lifecycle snapshot and aggregate metrics for tick count, idle count, loop latency, recovered leases, retries, drain blockers, failures, assignment completions, queue depth, active leases, delayed retries, and max worker heartbeat age when worker health is wired. Health warnings do not by themselves prevent `--stop-when-idle`; they are observability signals, not proof that work was performed.

The scheduler and worker services can also be run with a `DaemonLifecycleController` in process. That controller emits start, tick, idle, drain-request, shutdown-request, and stopped events and can request shutdown without deleting assignments or worker records. This is the local lifecycle API shape for future supervised daemons; the foreground CLI remains the smoke path.

This is still a foreground local daemon MVP. Production should run scheduler and worker loops as supervised services with health checks, drain/shutdown semantics, broker leases, metrics, and persistent retry state.

## Retry Policy

```text
transient IO/network: exponential backoff with jitter
model rate limit: provider backoff or fallback model
worker crash: resume from durable checkpoint
patch conflict: reread, regenerate patch, retry once
test failure: continue only if auto-repair is enabled
permission denied: stop and request approval
high-risk/destructive failure: no automatic retry
```

Local model guard knobs:

```text
--model-call-budget N             stop after N model calls in this local run
--model-failure-budget N          stop after N failed model calls in this local run
--model-circuit-break-after N     open a local circuit after N consecutive model failures
--model-circuit-open-ms N         keep the local circuit open for N milliseconds
```

These are process-local guardrails for CLI and local worker runs. Production deployments should enforce shared tenant/project/session quotas, centralized circuit breaker state, cost budgets, and provider-specific rate-limit telemetry in the control plane.

## Git PR Preparation

Current local CLI flow:

```text
agent git status
agent pr prepare --title "Improve planner" --branch agent/improve-planner
agent pr prepare --title "Improve planner" --body-file .agent/tmp/pr-body.md --provider github
agent pr prepare --title "Improve planner" --commit --push --apply --execution-mode full_access
```

`agent pr prepare` defaults to dry-run mode. It detects the current branch, dirty files, remote provider, and repository slug, then generates a GitHub/GitLab PR or MR creation URL. Real branch creation, commit, and push only happen with `--apply`, and those mutations are policy checked.

Production Git automation should replace this local layer with isolated worktrees, short-lived credentials, provider API adapters, stored PR/MR refs, CI webhooks, and retry/rollback rules.

## Organizations And Capability Grants

Current local CLI flow:

```text
agent orgs create "Local Team"
agent orgs project-create org_xxxxxxxx --default-role member "Core Agent"
agent orgs grant project proj_xxxxxxxx agent:builder tool.approve
agent orgs grant project proj_xxxxxxxx agent:builder workspace.write
agent orgs grant operator local user:viewer operator.diagnostic
agent orgs grants --scope-type project --scope-id proj_xxxxxxxx
agent orgs can project proj_xxxxxxxx agent:builder tool.approve
```

Organization creation grants `org.admin` to the creator. Project creation grants `project.admin` to the creator. Explicit capability grants are scoped to `organization`, `project`, `room`, or `session`, and can target `user`, `agent`, or `service_account` subjects.

Runtime policy checks now use these grants when `agent run`, `agent tool`, or approval flows carry an org/project/room/session scope:

```text
agent run --project proj_xxxxxxxx --execution-mode balanced "make a safe project edit"
agent tool create_file --project proj_xxxxxxxx --execution-mode balanced '{"path":"tmp/example.txt","content":"hello"}'
agent approve appr_xxxxxxxx --actor agent:builder --auto-replay
```

`strict` mode still requires approval for every tool action. Critical-risk requests require `agent.super_approve`; ordinary action grants such as `workspace.write` are not enough to silently bypass critical approval prompts.

Production deployments should add authenticated users, groups, revocation, role templates, distributed policy evaluation, and admin audit views.

## Local Control Plane Web API

The local control plane is the first hub in the Soloclaw cross-machine room model. In development it is started with `agent web` or, in the productized path, a future `soloclaw room serve` command. Windows, Linux, macOS, and Android Termux agents should connect to that hub through the same enroll, routed inbox, signed acknowledgement, heartbeat, and remote-run contracts.

Operational direction:

- keep `soloclaw` as the product entry and `agent` as the compatibility command;
- prefer hub-and-room coordination before P2P networking;
- treat the room transcript as shared context and the routed inbox as the execution trigger;
- make remote runners daemon-ready before adding OS service installers;
- verify cross-platform behavior with one control plane and at least one Windows, Linux, macOS, and Android Termux client before calling the distributed room alpha usable.

Current local flow:

```text
agent web --host 127.0.0.1 --port 4317
agent web --port 4317 --token local-dev-token
agent remote enroll --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --invite-token rinv_xxxxxxxx --alias builder
agent remote inbox --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --json
agent remote ack --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx
agent remote poll --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --limit 5 --idle-limit 1 --interval-ms 1000
agent remote heartbeat --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --status online --ttl 60
agent remote run --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --cycles 100 --stop-when-idle --idle-cycles 3 --backoff-ms 1000 --max-backoff-ms 30000 --heartbeat-ttl 60
agent agents health --json
agent operator status --limit 3
agent operator status --kind spec --status blocked --details
agent operator status --public --json
agent operator status --actor user:viewer --json
agent operator status --rows --json
agent operator show --kind queue --select 1 --json
agent operator show queue:local --json
agent operator status --json
```

`agent web` now starts a small local control-plane API and room console. The command prints a URL containing a generated token unless `--token` or `AGENT_WEB_TOKEN` is provided. API requests must send either `x-agent-control-token` or the `?token=` query parameter. The console can send room messages, edit member aliases/roles/statuses, decide approvals, pause/resume/cancel recent sessions, and show the derived agent health panel from `/api/state.agentHealth`. `/api/state` also includes `operator`, a shared Web/TUI view model that maps approvals, sessions, assignments, workers, agents, specification progress, scheduler tick audit summaries, recent audit summaries, artifacts, retention policies, MCP health, and local queue pressure into common local operator statuses such as `waiting_for_approval`, `retry_delayed`, `draining`, `saturated`, `stale`, and `failed`. The Web UI renders the operator summary, queue diagnosis, workers, assignments, specs, scheduler ticks, recent audit events, agent item list, artifact warnings, retention policy warnings, and registry-backed MCP health items from that shared model; MCP health probes are cached briefly and failed/timeout probes use exponential backoff so `/api/state` polling does not hammer servers or audit logs. Operators can use the Web `Refresh MCP` action or `POST /api/operator/mcp/:serverId/refresh` to bypass the cache for an explicit, audited probe. The Web UI uses operator approval/session items for status, reason, and next-action text, and can drill into operator items through `/api/operator/items/:itemId`. Operator details render shared type-specific `detailSections` as prioritized Web panels for worker, agent, assignment, spec, and MCP items, show `sourceSummaries` as scan-friendly source rows, and keep raw source records in a collapsible section for diagnosis, including MCP registry and latest health sources for MCP items. API callers can request `/api/operator/rows?kind=queue&limit=5` for the same `{ ordinal, section, item }` row order used by `agent operator status --rows --json`, then request `/api/operator/rows/1/detail?kind=queue&limit=5` to open the nth visible row with the same filters as `agent operator show --select n`. API callers can request `?operatorView=public` on `/api/state`, `/api/operator/rows`, `/api/operator/rows/:ordinal/detail`, or `/api/operator/items/:itemId` to remove item refs, metadata, raw source records, missing-ref diagnostics, and Refs/Metadata detail sections while preserving status summaries and safe detail panels. API callers can also pass `operatorActor=user:viewer`; non-local actors requesting diagnostic views are downgraded to public unless they have `operator.diagnostic` on `operator:local`. The page includes a control actor field that defaults to `user:local-user`; set it to an active authorized member such as `user:owner` or `agent:agent-id` when operating rooms created by another actor.

`agent operator status` is the CLI-interactive first pass for the same operator model used by Web. Text mode prints grouped, numbered status rows for local stuck-task diagnosis; `--kind`, `--status`, `--severity`, and `--id` filter the view; `--details` expands refs and safe metadata; `--public` applies the same reduced operator projection used by `?operatorView=public`; `--actor user:id|agent:id` asks the control plane to choose public or diagnostic projection for that actor; `--json` returns either the complete shared model or filtered item lists for scripting; `--rows --json` returns the same visible row order as text mode as `{ ordinal, section, item }` records for a future richer TUI. Use `agent operator show <item-id-or-ref-id> [--json]` to drill into a specific status item or referenced source id, or `agent operator show --select <n>` with the same filters used by `status` to open the nth visible row. Drilldowns inspect shared source summaries plus related session, worker, agent, assignment, artifact, retention, room, spec, and audit records when available unless the selected projection is public.

Current local API surface:

```text
GET  /api/health
GET  /api/state
GET  /api/operator/rows
GET  /api/operator/rows/:ordinal/detail
GET  /api/operator/items/:itemId
POST /api/operator/mcp/:serverId/refresh
GET  /api/rooms/:roomId
GET  /api/rooms/:roomId/agent-inbox?agentId=<agent-id>
POST /api/rooms/:roomId/agent-inbox/ack
POST /api/rooms/:roomId/join-invite
POST /api/rooms/:roomId/messages
POST /api/rooms/:roomId/members/:actorId/approve
POST /api/rooms/:roomId/members/:actorId/aliases
POST /api/rooms/:roomId/members/:actorId/role
POST /api/rooms/:roomId/members/:actorId/status
POST /api/rooms/:roomId/invites/:inviteId/revoke
GET  /api/sessions/:sessionId
POST /api/sessions/:sessionId/pause
POST /api/sessions/:sessionId/resume
POST /api/sessions/:sessionId/cancel
POST /api/approvals/:approvalId/approve
POST /api/approvals/:approvalId/deny
GET  /api/artifacts
GET  /api/retention/policies
GET  /api/audit
GET  /api/workers
GET  /api/workers/health
GET  /api/agents
GET  /api/agents/health
GET  /api/agents/:agentId
POST /api/agents/register
POST /api/workers/register
POST /api/workers/recover-expired
POST /api/workers/cleanup-nonces
POST /api/workers/:workerId/heartbeat
POST /api/workers/:workerId/drain
POST /api/workers/:workerId/complete-drain
POST /api/workers/:workerId/run-once
POST /api/workers/:workerId/poll
GET  /api/assignments
POST /api/scheduler/tick
POST /api/assignments/assign
POST /api/assignments/recover-expired
POST /api/assignments/cleanup-nonces
POST /api/assignments/:assignmentId/heartbeat
POST /api/assignments/:assignmentId/complete
POST /api/assignments/:assignmentId/fail
POST /api/assignments/:assignmentId/cancel
```

`POST /api/rooms/:roomId/agent-inbox/ack` accepts `agentId`, optional `messageId`, optional `actor`, and optional `ackEnvelope`. A target local agent self-ack is signed automatically; remote agent self-ack should submit a signed envelope so the control plane can verify identity and reject nonce replay.

`POST /api/rooms/:roomId/join-invite` accepts `token`, optional `actor`, and optional `aliases`. It uses the same invite-token service path as the CLI, enforces `requireSignedInvites` when configured, and records only non-secret admission metadata in audit events.

`POST /api/agents/register` accepts `agentId`, `machineId`, `publicKeyPem`, optional `fingerprint`, optional `displayName`, optional `capabilities`, and optional `allowedProjects`. The local control plane recomputes the SHA-256 public-key fingerprint, stores new remote identities as `pending`, refreshes same-key registrations, and rejects same-agent key changes until a signed key-rotation flow exists.

`agent remote enroll` is the CLI wrapper for the local cross-machine bootstrap path. It generates or reuses the caller's `.agent/identity` keypair, calls `POST /api/agents/register`, then calls `POST /api/rooms/:roomId/join-invite` as that agent. The invite token is sent only to the control plane join endpoint and is not persisted or printed by the command.

`agent remote inbox` is the remote-agent wake-up view. It calls `GET /api/rooms/:roomId/agent-inbox` with the caller's local agent id, so an enrolled agent sees only messages routed to it by structured @ mentions, aliases, role routes, or approved wide routes. `agent remote ack` signs a `RoomDeliveryAckEnvelope` with the caller's local Ed25519 identity and posts it to `POST /api/rooms/:roomId/agent-inbox/ack`. If `--message-id` is omitted, the command acknowledges the newest currently routed inbox message.

Inbox responses include `activationContext` for each routed message. It records the wake reason, matched target, current message, bounded recent transcript window, and acknowledgement policy that an execution loop should use before loading any larger context.

When `agent rooms say` accepts a message whose mentions do not resolve to active wake targets, it prints `routing-warning` lines and stores the same signed diagnostics under `message.metadata.routingDiagnostics`. The Web UI renders those diagnostics below the transcript message, and the audit log records `room.routing.warning`.

`agent remote poll` is the bounded remote-agent runner shape. It repeatedly reads the caller's routed inbox, signs acknowledgements for every accepted message, and stops after `--limit` messages or `--idle-limit` empty polls. It is intentionally still a CLI development loop; production should replace it with a supervised authenticated daemon or streaming consumer using the same per-agent delivery cursor and signed acknowledgement contract.

`agent remote heartbeat` signs and submits an `AgentHeartbeatEnvelope` to `POST /api/agents/:agentId/heartbeat`. The local control plane verifies the registered public key, rejects nonce replay, updates the agent's `lastSeenAt`, heartbeat status, expiry, room id, and last error metadata, and records an audit summary without private key material.

`agent agents health` and `GET /api/agents/health` derive a local health summary from agent identity heartbeat rows. The summary reports `online`, `idle`, `running`, `error`, `stale`, `offline`, and `unknown` states, counts responsive agents separately from suspended/revoked/expired identities, and groups active records by machine and last room. This is the local room-console view for distinguishing quiet agents from stale or failing remote agents.

`agent remote run` wraps the bounded poller in a foreground supervised loop. It supports `--cycles`, `--stop-when-idle`, `--idle-cycles`, `--backoff-ms`, `--max-backoff-ms`, `--max-errors`, and `--heartbeat-ttl`, so operators can test remote-agent lifecycle behavior before the production daemon exists. Use it for local cross-machine soak tests; production should add authenticated agent sessions, durable health state, durable backoff state, drain/shutdown handling, and event streaming.

`POST /api/rooms/:roomId/members/:actorId/aliases` accepts `aliases: string[]` and optional `actor`. It uses the same `room.member.alias` capability gate as `agent rooms alias`, normalizes aliases, rejects collisions, and writes room alias audit events.

`POST /api/rooms/:roomId/members/:actorId/role` accepts `role` and optional `actor`; `POST /api/rooms/:roomId/members/:actorId/status` accepts `status` and optional `actor`. They use `room.member.role` and `room.member.status`, write dedicated audit events, and reject changes that would remove the last active owner.

`POST /api/rooms/:roomId/invites/:inviteId/revoke` accepts optional `actor`. It uses `room.member.invite`, marks the invite `revoked`, writes `room.invite.revoked`, and prevents future joins with that token.

Room invite responses include `signatureStatus` when served through the control plane. Local-agent-issued invites should verify as `valid`; user-issued invites are currently `unsigned` until signed user identity lands. Rooms created with `--require-signed-invites` reject unsigned, unknown-agent, or invalid invite envelopes before token activation.

The local API maps common service failures to stable HTTP statuses: unauthenticated token failures return 401, room capability failures return 403, missing resources return 404, malformed or invalid requests return 400, and state conflicts such as replayed nonces or removing the last active owner return 409. Unexpected failures still return 500.

This API is still a local single-process MVP backed by SQLite. Production deployments should replace the token with real user/agent authentication, CSRF protection for browser sessions, permission-filtered responses, signed approval envelopes, SSE/WebSocket event streaming, and tenant-aware routing.

## Retention And Artifacts

Current local CLI flow:

```text
agent retention create "local 30/90/365" --hot-days 30 --artifact-days 90 --audit-days 365
agent retention assign proj_xxxxxxxx ret_xxxxxxxx
agent artifacts add .agent/tmp/audit-export.jsonl --kind report --project proj_xxxxxxxx
agent artifacts list --project proj_xxxxxxxx
agent session compact sess_xxxxxxxx
agent session delete sess_xxxxxxxx --force
agent retention apply proj_xxxxxxxx
```

Local retention policies control hot transcript compaction, artifact soft-delete, audit row deletion, user deletion allowance, and audit export allowance. `session compact` writes a durable session summary before removing hot messages and tool-call rows. `artifacts delete` soft-deletes metadata by default; `--delete-file` also removes the pointed local file after workspace path checks.

This is a local lifecycle MVP. Production deployments should run retention from scheduled workers, externalize large artifacts to object storage, support legal hold, move signed audit bundles into retention-aware export jobs, and make deletion decisions tamper-evident.

## Automation Switches

Configurable by org, project, room, and session:

```text
auto_read
auto_write
auto_run_tests
auto_install_dependencies
auto_create_branch
auto_commit
auto_push
auto_open_pr
auto_update_pr
auto_iterate_on_ci_failure
auto_agent_approval
```

Defaults should favor safety over autonomy.

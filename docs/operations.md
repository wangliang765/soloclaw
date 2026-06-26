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

agent approve <approval-id> --queue-resume <worker-id> "reason"
  -> approved pending tool is executed
  -> real tool result is appended to the original session transcript
  -> session is assigned to the local worker queue for continuation
```

`--auto-resume` implies `--auto-replay`. Denied approvals keep the session paused for now; production workers should move the session into a clear waiting, failed, or replanning state depending on policy.

MCP approvals use the same decision command. When `agent mcp capabilities`, `agent mcp call-tool`, or `agent mcp read-resource` returns an approval request, `agent approve <approval-id> --auto-replay` continues the bound MCP operation through the MCP planner, secret broker, redaction, and `mcp.executed` audit path. MCP approvals do not resume an agent session unless a later agent-tool integration creates a session-scoped MCP request.

## Session Evidence Bundle

Current local CLI flow:

```text
agent sessions --json --limit 5
agent sessions --status paused --target-mode build
agent local status --json --limit 10
agent local logs --limit 20
soloclaw agent status --json
soloclaw agent logs --limit 20
agent approvals pending
agent approve <approval-id> "approved after review"
agent deny <approval-id> "not safe to continue"
agent run --require-model-ready --provider openai_compatible --base-url http://localhost:8000/v1 --api-key-env LOCAL_LLM_API_KEY "inspect this workspace"
agent resume <session-id> --require-model-ready --provider openai_compatible --base-url http://localhost:8000/v1 --api-key-env LOCAL_LLM_API_KEY
agent session diff <session-id>
agent session status <session-id> --json --limit 10
agent session inspect <session-id> --json
agent session next <session-id> --json
agent session timeline <session-id> --limit 20
agent session review <session-id> --limit 20
agent session result <session-id>
agent session bundle <session-id> --json --output .agent/tmp/session-bundle.json
agent session bundle <session-id> --json --require-change --require-patch --require-recovery --require-diff-stat --require-execution-profile local-safe
```

`agent sessions` is the local recent-session dashboard. It reuses the session status view for each returned session, so JSON callers get outcome, pending approval count, handoff state/next command, command/change counts, latest safe timeline items, and follow-up review/result/next commands without opening each session manually. The local Web/control-plane `GET /api/sessions` route exposes the same handoff dashboard shape on demand, supports `limit`, `status`, and `targetMode` query filters, validates invalid filter values as request errors, and stays separate from the lightweight `/api/state` poll.

`agent local status` is the daemon-ready local agent snapshot. It aggregates the recent session dashboard with pending approvals, worker registrations, assignment queue/load state, scheduler/worker poll readiness, active leases, capacity, attention reasons, next commands, and a structured daemon runbook with required, recommended, blocked, and optional steps. `soloclaw agent status` is the same product-facing alias for the active workspace selected by `soloclaw workspace use`.

`agent local service [--json]` is the metadata-only daemon service plan. It reuses persisted local status to show the platform manager shape, service name, foreground scheduler/worker entrypoints, health/log commands, readiness, blocked steps, and a plan-only supervision policy. It does not register, start, stop, or mutate an operating-system service.

`agent local logs` is the merged local execution log. It combines safe audit events, file changes, approval requests, and approval decisions across recent sessions, attaching session ids/statuses when available. It is intended for foreground supervision, TUI reuse, and future daemon log panels; it does not imply an installed OS service.

The interactive `soloclaw` shell exposes the same views as `/agent status`, `/agent service`, `/agent logs`, `/sessions [--json] [--limit n] [--status status] [--target-mode mode]`, `/sessions watch [--ticks n] [--interval-ms n] [--limit n] [--status status] [--target-mode mode]`, `/approvals [status]`, `/approve <approval-id> [reason]`, `/deny <approval-id> [reason]`, `/session diff <session-id> [--json]`, `/session status <session-id> [--json] [--limit n]`, `/session inspect <session-id> [--json]`, `/session watch <session-id> [status|inspect|next|review|timeline] [--ticks n] [--interval-ms n]`, `/session next <session-id> [--json]`, `/session timeline|logs <session-id> [--json] [--limit n]`, `/session review <session-id> [--json] [--limit n]`, and `/session result <session-id> [--json]`, with `/agent` defaulting to status. These commands use the currently selected workspace, so operators can switch with `/workspace ...`, inspect the matching local agent state, inspect the daemon service plan, decide approval requests with `tool.approved` / `tool.denied` audit evidence, or open focused session status, inspection, next-action, timeline, diff, review, result, dashboard, or bounded watch drilldowns without leaving the TUI. TUI `/session watch` and `/sessions watch` repeat a finite number of reads in the foreground and do not install a background watcher. TUI approval decisions are manual approve/deny only; use `agent approve --auto-replay`, `--auto-resume`, or `--queue-resume` when replay or continuation should run immediately.

For supervised real-model tasks, add `--require-model-ready` to `agent run`, `agent ask`, `agent plan`, `agent build`, `agent goal`, or `agent resume`. The command checks the selected provider, model, base URL, API-key environment names, and configured secret-ref state before the local platform/session is opened or a paused session is continued; failures return `status=blocked` in JSON mode or a `Model readiness gate failed.` text block with the same fields as `soloclaw model check`.

`agent session diff`, `agent session report`, `agent session status`, `agent session inspect`, `agent session next`, `agent session timeline|logs`, `agent session review`, and `agent session result` are focused views for a persisted session. They reuse the same safe session evidence as bundle, but narrow output respectively to the persisted patch diff, consolidated engineering report, status snapshot, inspection state/issues/focus paths/handoff/next actions, handoff/inspection/next-action continuation, ordered safe timeline, operator review package, and result summary. Diff/report/status/review/result views include a shared `inspectionPlan` when completed patch evidence exists, ranking changed files with focus paths, review reasons, and follow-up commands. The next-action view includes review/status/inspect/timeline/verify follow-up commands so handoff can jump straight to logs or evidence gates. TUI `/sessions`, `/sessions watch`, `/session diff`, `/session report`, `/session status`, `/session inspect`, `/session watch`, `/session next`, `/session timeline|logs`, `/session review`, and `/session result` use the same views for the current workspace, and the local control plane exposes the session dashboard, diff, report, status, inspection, next-action, timeline, lightweight review, lightweight result, and Web-oriented bundle JSON shapes at token-gated `GET /api/sessions`, `GET /api/sessions/:sessionId/diff`, `GET /api/sessions/:sessionId/report`, `GET /api/sessions/:sessionId/status?limit=n`, `GET /api/sessions/:sessionId/inspect`, `GET /api/sessions/:sessionId/next`, `GET /api/sessions/:sessionId/timeline?limit=n`, `GET /api/sessions/:sessionId/review?limit=n`, `GET /api/sessions/:sessionId/result`, and `GET /api/sessions/:sessionId/bundle?preset=handoff&limit=n`.

The bundle combines the same diff, report, status, timeline, review, result, and verification views used by the narrower `agent session ...` commands. Diff/report/review/result/status summaries include per-file additions/deletions, change type, patch count, review size, a short review hint and inspection plan when the session contains completed `apply_patch` evidence, an inspection state with required/warning/info issues and focus paths, and operator next actions such as resolving pending approvals, reviewing diffs, running evidence gates, inspecting a session, or exporting the bundle. `--output` writes the JSON bundle inside the current workspace so operators can archive or attach one file while still preserving the underlying SQLite audit/session records.

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

`poll` repeats the same execution path until it reaches `--limit`, sees enough idle polls, hits a paused assignment, observes the worker is no longer `online`, receives an abort signal, or is run with a daemon lifecycle controller that has requested shutdown. The CLI JSON output includes the worker loop lifecycle snapshot and aggregate metrics so foreground runs can be inspected the same way as service-level smoke tests. This gives local development a bounded daemon-like loop without hiding the fact that production needs a real worker process.

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
curl -N -H "x-agent-control-token: local-dev-token" "http://127.0.0.1:4317/api/events?room=<room-id>"
agent rooms create --local-agent --join-policy invite_token --require-signed-invites "phase5 room"
soloclaw room invite-agent room_xxxxxxxx --control-url http://127.0.0.1:4317 --control-token local-dev-token --alias builder --display-name builder --json > room-invite.json
soloclaw room join --invite-bundle room-invite.json --json
soloclaw room join --invite-bundle room-invite.json --run --status-file .agent/tmp/remote-room-status.json --stop-file .agent/tmp/remote-room.stop --reply-template "@owner handled {messageId}" --json
agent remote register --control-url http://127.0.0.1:4317 --control-token local-dev-token --display-name builder --json
agent rooms pull-agent room_xxxxxxxx agent_xxxxxxxx --alias builder --role executor --local-agent --json
agent remote invitations --control-url http://127.0.0.1:4317 --control-token local-dev-token --json
agent remote accept-room --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --json
agent remote run --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --cycles 20 --stop-when-idle --idle-cycles 2 --status-file .agent/tmp/remote-room-status.json --stop-file .agent/tmp/remote-room.stop --reply-template "@owner handled {messageId}" --json
agent remote inbox --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --json
agent remote ack --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx
agent remote poll --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --limit 5 --idle-limit 1 --interval-ms 1000
agent remote heartbeat --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --status online --ttl 60
agent remote heartbeat --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --status online --ttl 1
agent agents health --now <iso-after-ttl-expiry> --json
agent agents recover-stale --now <iso-after-ttl-expiry> --local-agent --json
agent remote service --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --status-file .agent/tmp/remote-room-status.json --stop-file .agent/tmp/remote-room.stop --json
agent remote run --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --cycles 100 --stop-when-idle --idle-cycles 3 --backoff-ms 1000 --max-backoff-ms 30000 --heartbeat-ttl 60 --status-file .agent/tmp/remote-room-status.json --stop-file .agent/tmp/remote-room.stop
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

Use `agent remote register` plus `agent rooms pull-agent` when the control host already knows which remote identity should join the room. The remote machine registers its public identity without consuming an invite token, the room owner marks that identity as an `invited` member with role and aliases, and the remote machine can inspect `agent remote invitations` before accepting with `agent remote accept-room`. Accepting the invitation sends a signed heartbeat; after the member is active, route a task to that agent and run `agent remote run` with a workspace-local status file to collect signed ack, signed reply, idle heartbeat, and idle stop evidence. `soloclaw phase5 verify --json` exercises this locally, and the real matrix now records the same paste-safe proof under `room.registeredAgentPull` before `soloclaw phase5 evidence-check --file <path> --json` can pass. The final gate verifies that the registered-pull `agentId` belongs to the declared registered-pull `targetId`, so copied evidence from another remote target is rejected. This is the current local development shape for "pull this cross-machine agent into this room."

For Phase 5 collection handoffs, keep the default `soloclaw phase5 collector-guide` and `collector-pack` outputs token-safe. After choosing the one real remote machine that will prove the registered-agent pull path, pass `--registered-pull-target <remote-target-id>` to `collection-runbook`, `collection-prepare`, `collector-guide`, or `collector-pack`; the selected remote guide is marked as the registered-pull target, the control-plane-host guide includes the control-host `registeredPullControlHostRunbook` for `room pull-agent`, routed task, delivery-status, and `room.registeredAgentPull` capture, and the other remote guides warn operators not to run registered-pull-only commands. Each selected remote `registeredPullRunbook` stage and each control-host runbook stage includes a `commandHint` with placeholders and `AGENT_CONTROL_TOKEN` environment-variable token references instead of raw tokens or `<control-token>`, so the remote operator can run the register/invitations/accept/run/status-file sequence and the control host can run the pull/routed-task/delivery-status sequence without leaking credentials. Those runbooks also include `evidenceFieldHints[]`, mapping each `room.registeredAgentPull.*` field to the source side, runbook stage, and command name; text and Markdown guides render the same mapping as `Registered-agent pull evidence field hints`. Remote target hints use the selected target's shell syntax: `$env:AGENT_CONTROL_TOKEN` for Windows PowerShell, `%AGENT_CONTROL_TOKEN%` for Windows CMD, and `$AGENT_CONTROL_TOKEN` for Linux, macOS, and Android Termux shells. `collection-runbook`, the control-plane `collector-guide`, and `evidence-status` `nextRoomEvidence[]` show the control-host command shape; text-mode `collection-runbook` and its generated Markdown include target-scoped operator command blocks for the selected remote and `control-plane-host`, text-mode `evidence-status` expands `nextRoomEvidence` runbook stages with token-safe `commandHint` lines plus field hints with missing fields sorted first, and the selected remote `collector-guide`, selected target `nextTargetEvidence[]`, and generated Markdown guide show the target command shape. `evidence-status --json` also exposes `registeredPullOperatorNext` with separate selected-target and control-host `operatorNextCommands[]`, missing fields, field hints, merge, and final-check commands, so a control-host script can resume the pull evidence path from one JSON object. `collection-prepare --registered-pull-target <remote-target-id>` writes `phase5-registered-pull-operator-next.json` with that same selected-target/control-host resume object, includes `registeredPullOperatorNextFile` and `registeredPullOperatorNext` in JSON output, and prints `registeredPullOperatorNext=phase5-registered-pull-operator-next.json` in text output for console-driven handoffs. If the collection workspace already exists and only that handoff needs to be created or refreshed, use `soloclaw phase5 registered-pull-operator-next --registered-pull-target <remote-target-id> --json`; it writes only the standalone operator-next file, supports `--output` and `--force`, and leaves the base evidence, fragments, guides, and runbook untouched. The selected remote guide and the control-plane-host guide also include `operatorNextCommands[]`, and generated Markdown writes the same sequence under `## Operator Next Commands`, so the distributed guide files carry the template command, registered-pull command hints, fragment preflight, status, merge, and final-check commands in run order. `collection-runbook --json`, `collector-pack --json`, and `collection-prepare --json` copy that same sequence onto the selected remote and control-plane-host rows, letting control-host distribution scripts hand off the right command block without opening guide files. Each `evidence-plan` target row, `collection-runbook` target guide row, `collection-prepare` fragment row, `evidence-init --json` `fragments[]` row, and per-target guide's return-to-control-host block includes target-specific scaffold commands; the status commands include `--target <guide-target-id>` so the receiving operator can check that one machine's missing evidence without changing the full-matrix `finalEvidenceCheck` summary. The `evidence-plan` and `collection-runbook` rows also include `collectorGuideCommand`, preserving the selected registered-pull target, so the control host can regenerate one machine's handoff without re-reading the full guide pack. `evidence-init --registered-pull-target <remote-target-id> --json` carries that selected target into each fragment row's `templateCommand`, `statusCommand`, and `collectorGuideCommand`, so the control host can distribute one fragment plus matching commands immediately after initialization. `collection-prepare` prints the same per-fragment handoff commands in text output after writing the workspace, which makes a console-only control-host run usable for distributing one fragment plus one matching guide command per machine. Add `--include-smoke-commands` only when preparing an execution guide for the operator who will replace placeholders and run that target's matrix commands; control-plane-host execution guides keep the registered-pull control commands, while non-selected remote execution guides omit them. While fragments are arriving, use `evidence-status` and its `nextEvidenceScopes[]` triage to decide whether to collect or preflight more target fragments first, refresh the control-plane-host room fragment, or fix matrix-level evidence shape/secret issues before the strict merge. Use `nextRoomEvidence[]` when `room.registeredAgentPull` is missing or incomplete; it gives the control host the selected target/control fragment paths, target/control guide commands, control-plane template/preflight/status commands, merge/final-check commands, missing fields, field hints, and the registered-pull control-host runbook for the room pull, routed task, delivery status, and transcript/runner capture sequence. The `registeredPullOperatorNext` summary repeats that incomplete-room recovery path as one automation-friendly object with selected-target and control-host command blocks. Those registered-pull room commands are promoted to the front of global `nextCommands[]`, ahead of the broader collection and merge commands, so the control host can resume the room pull evidence path from the status output alone. Use `nextTargetEvidence[]` to hand one machine operator their current target-specific missing checks, field names, fragment path/source path, `templateCommand`, `statusCommand`, preflight command, `collectorGuideCommand`, and `returnToControlHost` copy/merge/final-check commands without making them inspect the full final gate; when that machine is the selected registered-pull target, the row also carries the remote `registeredPullRunbook`, and text output expands it as `remote registered-agent-pull stages` with token-safe command hints and field hints. Add `--target <target-id>` to show only that machine's operator-facing status while keeping `finalEvidenceCheck` as the full-matrix summary. In that target-filtered view, `nextCommands[]` starts with the target's guide command and fragment template command; if the target is the selected registered-pull machine, the remote runbook command hints are inserted next before the target preflight, and if the target is `control-plane-host`, the control-host registered-pull command hints are inserted before the control-plane preflight. Add `--include-missing-evidence` only when the operator needs exact token-safe check and field names for the current in-memory merge; it is still a progress diagnostic, not the final acceptance gate. If `evidence-status --registered-pull-target <remote-target-id>` reports `registeredPullTargetOverride`, use its reconciliation commands to either refresh untouched scaffolding with `collection-prepare --force` before collection or regenerate the control-plane fragment target fields after real evidence exists. Do not return a filled execution guide as evidence.

After the selected registered-pull target has `.agent/tmp/phase5-registered-pull-status.json`, `soloclaw phase5 registered-pull-evidence-patch --registered-pull-target <remote-target-id> --status-file .agent/tmp/phase5-registered-pull-status.json --pull-agent-file pull-agent.json --invitations-file invitations.json --accept-room-file accept-room.json --room-show-file room-show.json --delivery-status-file delivery-status.json --json` builds a paste-safe `patch.room.registeredAgentPull` object from whitelisted runner status fields, whitelisted `room pull-agent` / `remote invitations` / `remote accept-room` / `rooms show` / delivery-status JSON summaries, plus explicit control-host summary arguments. It reports `missingFields`, supports `--output` and `--force`, and writes only the patch file; it never edits the base evidence, fragments, guides, or runbook and never copies control tokens, invite tokens, private keys, signed envelopes, message bodies, or raw SSE text from those input files.

Use the TTL=1 heartbeat plus `agents health --now <iso-after-ttl-expiry> --json` as the manual stale-agent smoke: the selected joined remote should appear with `healthState: "stale"`, `heartbeatExpired: true`, `responsive: false`, and the expected room id. Phase 5 matrix evidence records this under `room.staleAgent`. Then run `agents recover-stale --now <iso-after-ttl-expiry> --json` from a room owner/moderator or another actor with `room.member.status`; the recovery result kind is `soloclaw.agent_stale_recovery`, and Phase 5 evidence records `memberStatusAfter: "suspended"`, `heartbeatStatusAfter: "offline"`, and `healthStateAfter: "offline"` under `room.staleRecovery`.

Use `agent remote service --json` before a long foreground run to record token-safe, plan-only supervision metadata for the remote room runner. The JSON kind is `soloclaw.remote_room_service_plan`, `supervision.installState` is `plan_only`, and the entrypoint uses `<control-token>` / `AGENT_CONTROL_TOKEN` instead of echoing the local development token. Phase 5 matrix evidence records this per remote target as `remote-service-plan-evidence`; it is not an OS service installation.

Use `GET /api/events` while the control plane is running to watch safe local SSE events. It streams agent-run events and control-plane audit actions such as remote agent heartbeats and stale recovery. The endpoint accepts `session`, `room`, `agent`, and `type` query filters; for Phase 5 matrix evidence prefer `GET /api/events?room=<room-id>` so the stream is scoped to the cross-machine room. Keep the raw stream and control token out of the evidence file; record only `eventStreamConnected: true`, `eventStreamControlActionTypes` containing `control_plane.action`, and `eventStreamAgentIds` covering the enrolled remote agent ids under the control-plane host evidence.

`agent web` now starts a small local control-plane API and room console. The command prints a URL containing a generated token unless `--token` or `AGENT_WEB_TOKEN` is provided. API requests must send either `x-agent-control-token` or the `?token=` query parameter. The console can send room messages, edit member aliases/roles/statuses, decide approvals, pause/resume/cancel recent sessions, load the on-demand session dashboard with status and target-mode filters, inspect a recent session from the Sessions list, open its persisted diff, open its consolidated report, open its status snapshot, open its focused next-action view, open its safe timeline, open its review checklist, open its result summary, open its Web bundle package, and show the derived agent health panel from `/api/state.agentHealth`. `/api/events` is the lightweight local SSE stream for safe agent-run rows and control-plane action events; it accepts `session`, `room`, `agent`, and `type` filters, and the Web console's Room Events panel reconnects to the selected room so remote-agent heartbeats, joins, messages, and stale recovery stay scoped to that room. It is useful for current operator visibility and Phase 5 evidence, but production still needs authenticated broker/WebSocket streaming. `/api/state` also includes `operator`, a shared Web/TUI view model that maps approvals, sessions, assignments, workers, agents, specification progress, scheduler tick audit summaries, recent audit summaries, artifacts, retention policies, MCP health, and local queue pressure into common local operator statuses such as `waiting_for_approval`, `retry_delayed`, `draining`, `saturated`, `stale`, and `failed`. `GET /api/sessions` returns the same handoff dashboard shape as the local session dashboard without adding that heavier work to `/api/state` polling, and accepts `limit`, `status`, and `targetMode` query filters for API callers and the Web Sessions panel. `GET /api/sessions/:sessionId/diff` returns the Web-oriented persisted patch package with patch text, changed paths, diff stats, file summaries, review profile, inspection plan, and review commands; `GET /api/sessions/:sessionId/report` returns the consolidated engineering report with file changes, command events, tool results, approvals, model usage, diff stats, inspection plan, and recent safe audit rows; `GET /api/sessions/:sessionId/status?limit=n` returns the Web-oriented status package with outcome, command/change counts, handoff state, inspection state, next actions, latest timeline rows, and review commands; `GET /api/sessions/:sessionId/inspect` returns the same focused inspection JSON as `agent session inspect --json`, including state, issues, focus paths, next actions, and review commands; `GET /api/sessions/:sessionId/next` returns the same handoff/inspection/next-action JSON as `agent session next --json`; `GET /api/sessions/:sessionId/timeline?limit=n` returns the same ordered safe timeline as `agent session timeline --json`; `GET /api/sessions/:sessionId/review?limit=n` returns the Web-oriented review package with checklist, changed paths, handoff state, next actions, latest timeline rows, and review commands; `GET /api/sessions/:sessionId/result` returns the Web-oriented result package with outcome, recovery, command results, approvals, changed paths, handoff state, inspection state, next actions, and review commands; and `GET /api/sessions/:sessionId/bundle?preset=handoff&limit=n` returns a Web-oriented evidence package across diff, report, status, timeline, review, result, and verification sections. The Web panel renders those documents as status, issue, next-action, follow-up command, timeline, checklist, diff, report, bundle-section, verification, command-result, approval, or recovery rows; its optional `Live` toggle keeps any loaded session dashboard and active session detail synchronized on the existing poll when enabled. The Web UI renders the operator summary, queue diagnosis, workers, assignments, specs, scheduler ticks, recent audit events, agent item list, artifact warnings, retention policy warnings, and registry-backed MCP health items from that shared model; MCP health probes are cached briefly and failed/timeout probes use exponential backoff so `/api/state` polling does not hammer servers or audit logs. Operators can use the Web `Refresh MCP` action or `POST /api/operator/mcp/:serverId/refresh` to bypass the cache for an explicit, audited probe. The Web UI uses operator approval/session items for status, reason, and next-action text, and can drill into operator items through `/api/operator/items/:itemId`. Operator details render shared type-specific `detailSections` as prioritized Web panels for worker, agent, assignment, spec, and MCP items, show `sourceSummaries` as scan-friendly source rows, and keep raw source records in a collapsible section for diagnosis, including MCP registry and latest health sources for MCP items. API callers can request `/api/operator/rows?kind=queue&limit=5` for the same `{ ordinal, section, item }` row order used by `agent operator status --rows --json`, then request `/api/operator/rows/1/detail?kind=queue&limit=5` to open the nth visible row with the same filters as `agent operator show --select n`. API callers can request `?operatorView=public` on `/api/state`, `/api/operator/rows`, `/api/operator/rows/:ordinal/detail`, or `/api/operator/items/:itemId` to remove item refs, metadata, raw source records, missing-ref diagnostics, and Refs/Metadata detail sections while preserving status summaries and safe detail panels. API callers can also pass `operatorActor=user:viewer`; non-local actors requesting diagnostic views are downgraded to public unless they have `operator.diagnostic` on `operator:local`. The page includes a control actor field that defaults to `user:local-user`; set it to an active authorized member such as `user:owner` or `agent:agent-id` when operating rooms created by another actor.

`GET /api/sessions/:sessionId/verify?preset=handoff` returns the same handoff verification package as `agent session verify`, using safe persisted session evidence for required engineering checks, execution profiles, approval actions, and follow-up commands. The Web Sessions panel opens this from Verify and renders the verification checks beside the other focused session views.

`GET /api/sessions/:sessionId/bundle?preset=handoff&limit=n` returns a local Web bundle package with `diff`, `report`, `status`, `timeline`, `review`, `result`, and `verification` sections, plus a summary with verification status, changed paths, diff stats, timeline counts, handoff state, and next-action counts. It is intended for local operator inspection and handoff inside the Web console; the CLI `agent session bundle` remains the export path that also includes local status/log snapshots.

The Web Session Inspect panel keeps track of which focused session document is open. Use its Refresh action to reload the same status, result, diff, report, verify, bundle, inspect, next, timeline, or review endpoint after a worker tick, approval decision, or manual lifecycle action.

When an operator decides an approval or pauses, resumes, or cancels a session from the Web console, the console refreshes any loaded session dashboard and reloads the active session detail panel when it belongs to the changed session.

Use `agent session verify <session-id> --preset handoff --json` or TUI `/session verify <session-id> --preset handoff --json` when you want the terminal path to apply the same handoff preset as the Web endpoint. `agent session bundle <session-id> --preset handoff --json --output .agent/tmp/session-bundle.json` embeds that same verification preset in the exported handoff package.

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
POST /api/rooms/:roomId/members/:actorId/invite
POST /api/rooms/:roomId/members/:actorId/accept-invitation
POST /api/rooms/:roomId/members/:actorId/aliases
POST /api/rooms/:roomId/members/:actorId/role
POST /api/rooms/:roomId/members/:actorId/status
POST /api/rooms/:roomId/invites/:inviteId/revoke
GET  /api/sessions?limit=&status=&targetMode=
GET  /api/sessions/:sessionId
GET  /api/sessions/:sessionId/diff
GET  /api/sessions/:sessionId/report
GET  /api/sessions/:sessionId/status?limit=
GET  /api/sessions/:sessionId/inspect
GET  /api/sessions/:sessionId/next
GET  /api/sessions/:sessionId/timeline?limit=
GET  /api/sessions/:sessionId/review?limit=
GET  /api/sessions/:sessionId/result
GET  /api/sessions/:sessionId/verify?preset=handoff
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
GET  /api/agents/:agentId/room-invitations
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

`GET /api/agents/:agentId/room-invitations` returns the rooms where that agent is currently an `invited` or `pending` member. `POST /api/rooms/:roomId/members/:actorId/invite` is the control-host pull path: an actor with `room.member.invite` adds a registered, non-revoked agent identity as an invited room member with optional role and aliases. `POST /api/rooms/:roomId/members/:actorId/accept-invitation` must be called as the invited `agent:<actorId>` and activates that room membership. The CLI wrappers are `agent remote register`, `agent rooms pull-agent`, `agent remote invitations`, and `agent remote accept-room`.

`POST /api/agents/:agentId/trust` accepts `trustStatus`, optional `reason`, and optional `actor`. The CLI wrapper is `agent agents trust <agent-id> pending|trusted|suspended|revoked|expired [--reason text] [--local-agent|--actor user:id|agent:id] [--json]`. It updates the registered identity trust state and writes a `control_plane.action` audit event. A revoked, suspended, or expired identity can remain visible in the room roster and health views, but old signed remote message-intent, delivery-ack, and heartbeat envelopes are rejected with HTTP 403 and a short trust-status error.

`agent remote enroll` is the CLI wrapper for the local cross-machine bootstrap path. It generates or reuses the caller's `.agent/identity` keypair, calls `POST /api/agents/register`, then calls `POST /api/rooms/:roomId/join-invite` as that agent. The invite token is sent only to the control plane join endpoint and is not persisted or printed by the command.

`agent remote inbox` is the remote-agent wake-up view. It calls `GET /api/rooms/:roomId/agent-inbox` with the caller's local agent id, so an enrolled agent sees only messages routed to it by structured @ mentions, aliases, role routes, or approved wide routes. `agent remote ack` signs a `RoomDeliveryAckEnvelope` with the caller's local Ed25519 identity and posts it to `POST /api/rooms/:roomId/agent-inbox/ack`. If `--message-id` is omitted, the command acknowledges the newest currently routed inbox message.

Inbox responses include `activationContext` for each routed message. It records the wake reason, matched target, current message, bounded recent transcript window, and acknowledgement policy that an execution loop should use before loading any larger context.

When `agent rooms say` accepts a message whose mentions do not resolve to active wake targets, it prints `routing-warning` lines and stores the same signed diagnostics under `message.metadata.routingDiagnostics`. The Web UI renders those diagnostics below the transcript message, and the audit log records `room.routing.warning`.

`agent remote poll` is the bounded remote-agent runner shape. It repeatedly reads the caller's routed inbox, signs acknowledgements for every accepted message, and stops after `--limit` messages or `--idle-limit` empty polls. It is intentionally still a CLI development loop; production should replace it with a supervised authenticated daemon or streaming consumer using the same per-agent delivery cursor and signed acknowledgement contract.

`agent remote heartbeat` signs and submits an `AgentHeartbeatEnvelope` to `POST /api/agents/:agentId/heartbeat`. The local control plane verifies the registered public key, rejects nonce replay, updates the agent's `lastSeenAt`, heartbeat status, expiry, room id, and last error metadata, and records an audit summary without private key material.

`agent agents health` and `GET /api/agents/health` derive a local health summary from agent identity heartbeat rows. The summary reports `online`, `idle`, `running`, `error`, `stale`, `offline`, and `unknown` states, counts responsive agents separately from suspended/revoked/expired identities, and groups active records by machine and last room. This is the local room-console view for distinguishing quiet agents from stale or failing remote agents.

`agent remote run` wraps the bounded poller in a foreground supervised loop. It supports `--cycles`, `--stop-when-idle`, `--idle-cycles`, `--backoff-ms`, `--max-backoff-ms`, `--max-errors`, `--heartbeat-ttl`, `--status-file`, and `--stop-file`, so operators can test remote-agent lifecycle behavior before the production daemon exists. `agent remote service --json` derives the token-safe plan that an operator or future OS supervisor would wrap around that foreground command, including workspace-local status/stop paths and blocked `wrap-os-supervisor` steps without installing anything. The JSON run result includes the shared daemon lifecycle snapshot, metrics, and last heartbeat summary for the `remote-room-runner` service kind, so foreground runs expose tick count, idle count, processed messages, failures, stop reason, last heartbeat status/expiry, and pre-poll `shutdown_requested` handling the same way local scheduler/worker loops do. The status file stays inside the remote workspace and records only runner summary fields, not control tokens, invite tokens, raw bundles, private keys, or stop-file contents. The stop file must also stay inside the remote workspace; creating it requests graceful shutdown and records `stopReason: "shutdown_requested"`. Use the normal status file for per-agent idle cross-machine soak evidence, then use the separate stop-file smoke from `soloclaw phase5 matrix-template --json` to record one paste-safe `room.stopFileShutdown` summary. `soloclaw phase5 evidence-check --file <path> --json` requires each remote target to report plan-only `soloclaw.remote_room_service_plan` evidence, idle runner status-file evidence with last-heartbeat and lifecycle metrics, one registered-agent pull communication summary under `room.registeredAgentPull`, one revoked-agent signed-operation rejection summary, one suspended-agent block summary, control-plane event-stream summary, stale-agent health and recovery summaries, and one stop-file shutdown summary with `runnerStopReason: "shutdown_requested"`. Production should add authenticated agent sessions, durable health state, durable backoff state, durable service shutdown handling, OS service installation/supervision, and broker-grade event streaming.

`POST /api/rooms/:roomId/members/:actorId/aliases` accepts `aliases: string[]` and optional `actor`. It uses the same `room.member.alias` capability gate as `agent rooms alias`, normalizes aliases, rejects collisions, and writes room alias audit events.

`POST /api/rooms/:roomId/members/:actorId/role` accepts `role` and optional `actor`; `POST /api/rooms/:roomId/members/:actorId/status` accepts `status` and optional `actor`. They use `room.member.role` and `room.member.status`, write dedicated audit events, and reject changes that would remove the last active owner.

`POST /api/rooms/:roomId/invites/:inviteId/revoke` accepts optional `actor`. It uses `room.member.invite`, marks the invite `revoked`, writes `room.invite.revoked`, and prevents future joins with that token.

The Phase 5 matrix uses that endpoint through `soloclaw rooms revoke-invite` as an admission-control smoke. The control host creates a separate revoked-invite bundle, revokes its invite id, and one remote target attempts `soloclaw room join --invite-bundle <revoked-invite-bundle-file> --json`; the expected result is a rejected join with a revoked-invite error. Record only `room.revokedInvite.targetId`, the attempted agent id, `joinBlocked: true`, and a short revoked rejection summary in `phase5 evidence-template`; do not paste the revoked bundle, invite token, or raw invite id into evidence.

The Phase 5 matrix uses `agent agents trust <revoked-agent-id> revoked --reason "phase5 revoked agent smoke" --json` as the already-enrolled identity revocation smoke. After the trust update, the selected remote target should attempt a signed `remote say`, a signed `remote heartbeat`, and a `remote run` against a routed ack probe; all three should fail with a trust-status rejection. Record only `room.revokedAgent.targetId`, the agent id, `trustStatus: "revoked"`, `trustUpdated: true`, `signedSayBlocked: true`, `signedAckBlocked: true`, `signedHeartbeatBlocked: true`, and a short rejection summary. Do not paste signed envelope JSON, private keys, control tokens, or raw terminal output containing secrets.

The Phase 5 matrix also uses the member-status endpoint as a governance smoke for already-enrolled agents. After a probe agent has joined, the control host runs `soloclaw rooms status <room-id> <suspended-agent-id> suspended --local-agent --json`, sends a routed probe to that agent, and verifies that the agent has no routed inbox messages and that its `remote say` attempt is rejected by status/capability checks. Record this as `room.suspendedAgent` with the target id, agent id, routed probe message id, `status: "suspended"`, `inboxMessageCount: 0`, `remoteSayBlocked: true`, and a short rejection summary; do not paste control tokens or raw command output.

`POST /api/agents/recover-stale` accepts optional `now`, `limit`, and `actor`. It scans the derived agent health view for `healthState: "stale"`, requires the actor to have `room.member.status` in each stale agent's last room, suspends the matching room member, marks the agent heartbeat `offline`, and writes a control-plane audit summary. The CLI wrapper is `agent agents recover-stale [--now iso] [--limit n] [--local-agent|--actor user:id|agent:id] [--json]`. Record the paste-safe result under `room.staleRecovery`; do not paste control tokens or raw heartbeat envelopes.

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

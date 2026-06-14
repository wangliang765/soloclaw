# Security Boundaries and Guardrails

Soloclaw is an engineering-grade agent platform. It can read code, call models, run tools, coordinate across machines, and eventually operate as a private distributed system. That makes security a product feature, not only an implementation detail.

This document defines the positive safety boundary: what the agent is allowed to do, what must be denied by default, what requires human approval, and how each phase is accepted.

## Security Principles

1. **Default deny for capability expansion**: new tools, network paths, secrets, write scopes, room routes, plugins, MCP servers, mobile integrations, and Git provider actions start denied until policy grants them.
2. **Least privilege by scope**: permissions are scoped to organization, project, repository, workspace, room, session, task, tool, and secret purpose.
3. **Identity is not authority**: a trusted agent identity proves who the agent is; capability grants decide what it may do.
4. **Human confirmation for irreversible actions**: destructive filesystem changes, protected Git changes, production deploys, credential use, purchases, payments, account actions, and mobile security prompts require explicit approval.
5. **Untrusted context stays untrusted**: repository text, room messages, tool output, MCP output, plugin output, RAG chunks, browser pages, and mobile UI state are evidence, not instructions that can override policy.
6. **Every sensitive action leaves safe evidence**: audit records store actor, scope, policy decision, safe summaries, artifact pointers, and signatures where needed, but never raw secrets or full private prompts.
7. **Local convenience cannot become production trust**: local tokens, SQLite rows, local files, and foreground loops are MVP surfaces; production requires authenticated users/agents, revocation, distributed replay protection, and durable audit.

## Trust Zones

| Zone | Examples | Default trust | Required controls |
| --- | --- | --- | --- |
| User intent | CLI prompt, TUI input, Web action, room message from user | Authenticated intent only after identity/policy check | Actor identity, room/session/project capability, audit |
| Model output | LLM response, tool plan, code suggestion | Untrusted recommendation | Tool policy, schema validation, bounded execution, approval gates |
| Workspace content | source files, docs, tests, logs, dependency metadata | Untrusted data | protected paths, prompt-injection scanning, bounded previews, redaction |
| Tool output | shell stdout/stderr, MCP response, plugin output, browser result | Untrusted data | size limits, redaction, provenance, no direct policy override |
| Secrets | API keys, provider tokens, Git tokens, mobile tokens | Never prompt-visible by default | secret broker, short leases, purpose checks, audit, redaction |
| Room transcript | messages, routed tasks, approvals, progress | Shared context, not wake trigger by itself | signed routing envelope, capability checks, per-agent inbox |
| Remote agent | Windows/Linux/macOS/Android agent identity | Identity proof only | signed heartbeat, signed ack, nonce replay windows, revocation |
| Mobile device | Android Termux, companion app, guided UI flow | Highly constrained endpoint | explicit opt-in, visible consent, no autonomous payment/security bypass |

## Execution Modes

Execution modes combine target behavior, sandboxing, reviewer policy, and capability grants.

| Mode | Intended use | Default capabilities | Approval rule |
| --- | --- | --- | --- |
| `plan` | analyze and propose without changes | read-only project context, no tools that mutate state | no writes or shell execution |
| `build` | supervised local code changes | workspace writes, tests, bounded shell, local artifacts | ask for high-risk commands, protected paths, secrets, network expansion |
| `goal` | longer multi-step work | build capabilities plus durable plans/spec context | same as build, with stricter budgets and progress checkpoints |
| `remote-runner` | agent consuming routed room work | only assigned/routed session capabilities | requires signed identity, ack, heartbeat, and scoped room/project grants |
| `full_access` | local admin break-glass | broad local tools | explicit user/admin choice, high-risk audit, never default |

First-class sandbox modes should be added as implementation matures:

```text
read_only
workspace_write
isolated_worktree
container
ephemeral_vm
full_access
```

## Capability Taxonomy

Capabilities should be named by action and scope. Broad roles are templates; runtime checks use concrete capabilities.

```text
workspace.read
workspace.write
workspace.shell
workspace.network
workspace.protected_path
git.branch
git.commit
git.push
git.pr.create
secret.read
model.call
mcp.connect
mcp.tool.call
mcp.resource.read
plugin.execute
room.message.send
room.route.broadcast
room.delivery.ack
room.member.invite
room.member.approve
task.delegate
task.assign
worker.run
agent.heartbeat
agent.revoke
operator.diagnostic
mobile.companion.notify
mobile.guided_action.open
mobile.ui_automation.experimental
commerce.prepare
commerce.confirm
```

`mobile.ui_automation.experimental` and `commerce.confirm` are intentionally separate. A mobile UI integration may help prepare or open a flow, but final purchase/payment confirmation remains a separate human-confirmed capability.

## Risk Levels and Decisions

| Risk | Examples | Default decision |
| --- | --- | --- |
| Low | read project metadata, inspect sessions, list model profiles, query room handles | allow if actor has read scope |
| Medium | write normal workspace files, run project tests, call configured model, read low-risk MCP resource | allow or ask depending on project policy |
| High | install dependencies, network fetch, Git mutation, write generated code, call MCP tool, reveal secret-derived output | ask unless explicitly allowed by managed policy |
| Critical | delete data, force push, deploy, access raw secret, modify protected paths, revoke identities, mobile UI automation, commerce/payment | deny by default; require explicit admin/human approval and strong audit |

Policy decisions:

```text
allow
ask
deny
allow_with_constraints
```

Constraints can include time limits, max calls, max files, network destinations, allowed commands, artifact capture, approval quorum, and required verification.

## Human Approval Boundaries

Human approval is required for:

- raw or high-value secret access;
- destructive filesystem or database operations;
- protected path writes under `.git`, `.agent`, credentials, or configured deny paths;
- dependency install or remote code execution;
- network expansion beyond allowlisted domains;
- Git push, PR merge, tag creation, release publication, deployment;
- room-wide wake-up, quorum decisions, or role/status changes that affect trust;
- identity revocation, key rotation, invite trust policy changes;
- mobile UI automation experiments;
- commerce, payment, account, CAPTCHA, or security-prompt workflows.

Approval records must include:

```text
approval id
requesting actor/session
scope
risk
requested capability
safe reason
bounded input summary
artifact pointers when needed
decision actor
decision time
decision result
continuation payload hash
```

Approvals should be replayable only through a bound continuation payload so the approved action cannot be silently swapped.

## Workspace and Code Safety

Required mechanisms:

- protected path rules for `.git/**`, `.agent/**`, real `.env*`, credential stores, and configured project-private paths;
- `.agent/tmp/**` as the only default agent-private temporary area;
- file-level write locks and branch/worktree isolation;
- bounded file previews and command outputs;
- patch/diff review before broad edits;
- required verification gates for build/test/lint when project signals exist;
- stop hooks or completion gates for temporary files, temporary tests, protected path changes, and missing verification evidence.

Production work should prefer one task per isolated worktree or container workspace. High-security tasks should run in ephemeral containers or VMs with network and secret policy.

## Secrets and Credentials

Secrets must not be stored in model profiles, MCP registries, room messages, audit metadata, model prompts, or exported bundles.

Required mechanisms:

- secret broker with purpose-scoped `secret.read`;
- short-lived leases;
- redaction of known values and provider-key patterns;
- environment variable names and secret refs instead of raw values in editable config;
- audit of access/denial with no raw secret value;
- revocation and rotation path for production;
- no fallback routing that hides authentication or authorization failures.

## Model and RAG Safety

Required mechanisms:

- model-call audit metadata only, without prompt or response text by default;
- model call budgets, failure budgets, retry limits, and circuit breakers;
- prompt-injection scanning for workspace and knowledge chunks;
- ACL filtering before ranking and context packing;
- citation IDs and source provenance;
- eval gates for recall, MRR, empty-result rate, citation precision, and permission leaks;
- safe fallback behavior only for transient provider failures.

Model output cannot authorize tools, change policy, or downgrade risk.

## MCP and Plugin Safety

MCP servers and plugins are capability providers, not trusted extensions of the platform.

Required mechanisms:

- registry metadata contains no secrets;
- server/plugin enabled state, risk, declared capabilities, and project/room allowlists;
- `mcp.connect`, `mcp.tool.call`, `mcp.resource.read`, and `plugin.execute` policy checks;
- secret leases injected only at execution time;
- bounded/redacted outputs;
- execution disable switch;
- health diagnostics that do not expose raw tool/resource output;
- sandbox/process/network constraints before broad ordinary agent use;
- Web/API surfaces only after the shared policy/audit path exists.

## Cross-Machine Room Safety

Required mechanisms:

- registered agent public identity and machine id;
- signed room messages, signed delivery acknowledgements, signed heartbeats, and signed task leases;
- nonce replay protection and cleanup;
- short heartbeat TTLs and stale-agent recovery;
- invite tokens stored by hash, signed invite envelopes, revocation, and expiry;
- `mentions_only` default for professional rooms;
- structured routing envelope signed with the message;
- per-agent routed inbox as wake-up trigger;
- bounded activation context rather than whole transcript;
- explicit wide-route capability and max routed-agent cap;
- operator diagnostics for unresolved, ambiguous, inactive, stale, or failed agents.

The room transcript is shared context. It is not by itself permission to execute.

## Mobile and Android Boundary

Android has two planned product tracks:

1. **Termux room agent**: CLI/TUI agent that joins rooms, signs acknowledgements and heartbeats, runs configured tasks, and works within Termux-visible files, commands, and APIs.
2. **Native companion**: UI for room monitoring, notifications, approvals, guided actions, and optional local agent lifecycle control.

Not default product targets:

- broad third-party App UI automation;
- hidden background tapping;
- payment confirmation;
- checkout confirmation;
- CAPTCHA handling;
- account security prompt handling;
- bypassing Android permission, biometric, or platform security gates.

Any future phone UI automation must be a separately reviewed integration with explicit opt-in, visible consent, clear scopes, audit, and human confirmation for irreversible actions.

## Observability, Audit, and Incident Response

Engineering-grade operation requires more than logs.

Required mechanisms:

- audit event for every policy decision and sensitive state change;
- tamper-evident export bundles;
- artifact pointers for large outputs instead of hot prompt context;
- operator state that explains blocked, paused, waiting-for-approval, retry-delayed, stale, draining, saturated, failed, and revoked states;
- health summaries for agents, workers, queues, rooms, MCP servers, and model providers;
- incident actions: suspend agent, revoke invite, revoke capability grant, rotate key, drain worker, pause session, export audit bundle.

## Phase Security Acceptance

| Phase | Security acceptance |
| --- | --- |
| 1. Local usable version | Protected paths, mock-safe smoke, provider config without raw keys, metadata-only model audit, hygiene check, explicit confirmation for sensitive local actions, and secret redaction tests exist. |
| 2. Engineering execution capability | Workspace writes, shell commands, dependency installs, Git mutations, diff handling, failure recovery, pause/resume, and verification gates are policy-checked, audited, and covered by regression tests. |
| 3. Visual control plane | Web/control-plane views use the same permission projections as CLI/TUI; approval actions, row-oriented drilldown, operator details, model/workspace status, and logs redact secrets and downgrade unauthorized actors to public views. |
| 4. Multi-platform local agent | Config/cache/log paths are documented per OS; secrets remain outside editable config; Windows/Linux/macOS/Android Termux install smoke verifies doctor/config without leaking local credentials. |
| 5. Room collaboration network | Four-OS room smoke proves signed enroll/ack/heartbeat, routed inbox, invite revocation, stale-agent health, no broadcast fallback execution, and auditable handoff/conflict events. |
| 6. Advanced autonomy and safety governance | Capability tiers, approval replay, audit export, secret handling, model-output constraints, mobile-action policy, incident controls, and commerce/payment/account/security-prompt human-confirmation or denial are tested. |

Current Phase 2 implementation note: workspace command policy classifies `run_command` calls into safe shell, dependency install, raw Git mutation, and high-risk shell actions. Dependency installs, raw Git mutations, high-risk shell commands, and balanced-mode workspace writes require approval, are audited as policy/tool events, are visible in `agent session report` / `agent session inspect` / `agent session review` / `agent session result` / `agent session bundle`, and are exercised by `agent phase2 verify --json --cleanup`. Approved session-scoped tool calls can be replayed and either resumed synchronously with `agent approve --auto-replay --auto-resume` or queued for a local worker lease with `agent approve --queue-resume <worker-id>`, so approval continuation evidence is visible through the same task assignment and session audit paths. Workspace command finishes also record duration, timeout, and local execution profile metadata (`local-safe`, `local-workspace-write`, `local-network`, or `local-full-access`) so bounded execution failures and declared execution boundaries are visible in the same session evidence path. `agent run|ask|plan|build|goal --require-model-ready` and `agent resume --require-model-ready` check real-model provider/base URL/API-key env or secret-ref readiness before opening or continuing a session; blocked output is metadata-only and `--api-key-secret` is reported only as configured. `agent session report`, `agent session status`, `agent session inspect`, token-gated `GET /api/sessions/:sessionId/inspect`, `agent session review`, `agent session result`, and `agent session bundle` aggregate session-scoped `model.called` counts, failures, provider-reported token usage, and duration from safe audit metadata without exposing prompt text, response text, tool inputs, or secret material; `agent session verify --require-model-call` can make a successful model call part of the machine gate, and `agent session verify --require-no-pending-approvals` can fail a handoff while approval requests remain unresolved. `agent session diff`, `agent session report`, `agent session status`, `agent session inspect`, TUI `/session inspect`, `GET /api/sessions/:sessionId/inspect`, `agent session review`, `agent session result`, `agent session bundle`, `agent session verify --require-diff-stat`, and `agent session verify --require-review-profile` expose machine-readable file/addition/deletion diff stats plus per-file change type, patch count, review size, review hint, aggregate review profile, inspection issue/focus-path metadata, and operator next-action metadata from successfully completed patch/session audit, while `agent sessions`, `agent local status`, `agent local logs`, `soloclaw agent status`, `soloclaw agent logs`, TUI `/agent status`, TUI `/agent logs`, TUI `/session inspect`, `agent session status`, `agent session inspect`, local control-plane session inspection, `agent session timeline|logs`, `agent session review`, and `agent session bundle` expose daemon-ready dashboard/status/log/review views from persisted audit, file-change, worker, assignment, and approval evidence using safe metadata instead of replaying raw tool inputs except bounded patch excerpts for explicit review. `agent workers poll` and `agent scheduler run` expose foreground daemon-loop lifecycle snapshots and aggregate metrics, and the phase2 verifier records a scheduler-run lifecycle smoke so local daemon UX can be checked without adding an unattended service. `agent session bundle` embeds local status and local log sections so exported handoff evidence carries the same daemon/operator snapshot as the live CLI views. Local status now includes structured scheduler/worker poll readiness, queue depth, active leases, capacity, attention reasons, and a required/recommended/blocked runbook so operators can see whether bounded foreground daemon loops are ready to run and which command should happen next. Explicitly requesting a wider command execution profile raises the policy action before the command can run; these profiles, local status/log views, readiness gates, daemon-readiness hints, next-action hints, daemon runbooks, foreground daemon lifecycle metrics, inspection summaries, TUI inspection views, local control-plane inspection views, and local worker leases are local policy/audit boundaries, not a replacement for the future sandboxed runner or production distributed broker.

## Open Implementation Work

- Add first-class sandbox mode separate from target mode and execution mode.
- Add managed policy layer and command allow/ask/deny engine.
- Add lifecycle hooks for pre-tool, post-tool, stop, and verification gates.
- Add production auth/RBAC/ABAC and revocation.
- Add distributed nonce replay windows.
- Add sandboxed runner and network policy.
- Add Android companion policy surface without granting default phone automation.

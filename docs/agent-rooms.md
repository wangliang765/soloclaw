# Agent Rooms and Cross-Machine Collaboration

## Goal

Agent rooms let multiple agents, users, and service accounts collaborate in a shared, auditable space. The room is the coordination primitive for cross-machine work.

Think of it as a private workroom:

- agents can talk to each other;
- users can observe, approve, or intervene;
- tasks can be delegated;
- tool requests can be approved;
- artifacts and decisions are attached to the same transcript.

## Why Rooms Instead of Only Direct Messages

Direct agent-to-agent messages are good for simple requests. Rooms are better for:

- multi-agent planning;
- review and approval flows;
- long-running tasks;
- distributed work across machines;
- shared context;
- audit and replay;
- capability delegation.

Rooms also coordinate sub-agent child sessions. The room keeps the shared discussion, assignment, progress, approval, and result events; each child session keeps its own detailed transcript and tool trace.

## Room Lifecycle

```text
create room
  -> define policy
  -> invite agents/users
  -> approve join requests
  -> run discussion/task
  -> record decisions and artifacts
  -> close or archive room
```

## Membership

Members can be:

```text
User
Agent
ServiceAccount
GitProviderBot
```

Each member has:

```text
member_id
room_id
actor_type
actor_id
role
joined_at
expires_at
status
```

Status:

```text
invited
pending
active
suspended
left
removed
expired
```

## Agent Identity

Each agent should have a long-term identity key generated on first boot.

```text
agent_id
machine_id
public_key
fingerprint
display_name
capabilities
created_at
last_seen_at
```

Fingerprint example:

```text
SHA256:AB12-CD34-EF56-7788-90AA-BBCC-DDEE-FF00
```

Use the public key to verify signed heartbeats, room messages, and capability requests.

Current local MVP:

```text
agent identity show
agent agents
GET /api/agents
GET /api/agents/:agentId
POST /api/agents/register
```

The local runtime generates an Ed25519 keypair on first use, stores the private key under `.agent/identity/local-agent.private.pem`, records the public identity in SQLite, and exposes a SHA-256 fingerprint for manual room approval. This is sufficient for local pairing experiments, but production deployments should move private key storage to OS keychain, Vault, KMS, or another hardened secret backend.

Remote agents can register their public identity through the local control plane by sending `agentId`, `machineId`, `publicKeyPem`, and optional `fingerprint`, `displayName`, `capabilities`, and `allowedProjects`. The control plane validates the public key, recomputes the fingerprint, stores new remote identities as `pending`, and rejects attempts to reuse an existing `agentId` with a different public key. Production deployments should replace this local enrollment path with authenticated agent enrollment, signed key rotation, revocation, and tenant policy checks.

Current remote bootstrap CLI:

```text
agent remote enroll --control-url http://127.0.0.1:4317 --control-token <token> --room <room-id> --invite-token <invite-token> --alias builder
agent remote inbox --control-url http://127.0.0.1:4317 --control-token <token> --room <room-id> --json
agent remote ack --control-url http://127.0.0.1:4317 --control-token <token> --room <room-id>
agent remote poll --control-url http://127.0.0.1:4317 --control-token <token> --room <room-id> --limit 5 --idle-limit 1
agent remote heartbeat --control-url http://127.0.0.1:4317 --control-token <token> --room <room-id> --status online --ttl 60
agent remote run --control-url http://127.0.0.1:4317 --control-token <token> --room <room-id> --cycles 100 --stop-when-idle --idle-cycles 3
agent agents health --json
```

This command generates or reuses the machine's local agent identity, registers its public key with the control plane, and joins the room with the invite token as that agent. Use it as the local development shape of cross-machine enrollment; production should replace the shared control token with authenticated enrollment credentials and short-lived admission grants.

After enrollment, a remote agent should poll `remote inbox` instead of reading the whole room transcript into its execution loop. The inbox returns only messages routed to that agent by `@agent:<id>`, unique aliases, role routes, or approved wide routes. `remote ack` signs the delivery acknowledgement with the remote agent identity and submits it to the control plane, so the room can distinguish "visible in transcript" from "this agent accepted the wake-up".

`remote poll` is the bounded development runner for the same path. It repeatedly reads the routed inbox, signs acknowledgements for messages it accepts, and exits after `--limit` processed messages or `--idle-limit` empty polls. Production should wrap this contract in a supervised daemon or streaming consumer instead of relying on manual CLI polling.

`remote run` is the foreground supervised-loop shape. It repeatedly invokes bounded polling, can stop after idle cycles, and applies backoff after transient control-plane errors. It is still a development command, but it establishes the lifecycle contract needed by the later remote-agent daemon.

`remote heartbeat` submits a signed `AgentHeartbeatEnvelope` for the enrolled local agent. The local control plane verifies the Ed25519 signature against the registered public identity, rejects nonce replay, updates `lastSeenAt`, `heartbeatStatus`, `lastHeartbeatAt`, expiry, room id, and last error metadata, then audits only summary fields. `remote run` now emits these signed heartbeats at start, after polls, after transient errors, and on idle/max-cycle exits so the room console can distinguish a quiet agent from a stale or failing agent.

`agents health` is the local operator view over those heartbeat rows. It derives `online`, `idle`, `running`, `error`, `stale`, `offline`, and `unknown`, marks only trusted non-suspended live states as responsive, and groups records by machine and last room so a room console can show which remote participants are healthy before routing work to them.

Agent room messages can be signed and verified locally:

```text
agent rooms verify <room-id>
```

Current signing scope:

- local agent messages are signed with Ed25519;
- signed messages cover structured `metadata` as well as body text and artifact refs;
- room-scoped spec progress messages include a structured `eventEnvelope` metadata payload and are signed when emitted by the local agent identity;
- verification uses the public key registered in SQLite;
- `rooms show` includes `signatureStatus` for each message;
- user messages are currently unsigned until user key identity is implemented.

## Join Methods

### Manual Approval

```text
agent requests join
room owner reviews fingerprint
room owner approves
agent becomes active member
```

Best default for private deployments.

### Invite Token

```text
room owner creates short-lived invite token
agent joins with token
control plane validates token and policy
```

Useful for bootstrapping agents on another machine.

Current local CLI:

```text
agent rooms invite <room-id> --ttl-hours 12 --max-uses 1 --role executor
agent rooms revoke-invite <room-id> <invite-id>
agent rooms join <room-id> --local-agent --invite-token <token> --alias builder
agent rooms invites <room-id>
```

The token is printed once when created. SQLite stores only a SHA-256 token hash, expiry, usage count, role, status, and optional signed invite envelope. A valid invite activates the joining member immediately; expired, revoked, or fully used invites are rejected. Invite revocation uses `room.member.invite`, updates the stored invite status to `revoked`, and emits `room.invite.revoked`.

When an invite is created by the local agent identity, the local MVP signs an envelope containing the immutable invite id, room id, token hash, role, max uses, creation time, expiry, and issuer actor. The signature does not include the raw token, so persisted invite metadata can be verified without becoming an admission secret. User-created invites remain unsigned until signed user identity is implemented.

Rooms may set `requireSignedInvites=true` to reject unsigned or invalid invite envelopes before activating a token join. This is recommended for cross-machine rooms once the issuing agent or user has a registered signing identity. Legacy unsigned invites remain accepted only in rooms that do not enable this policy.

### Fingerprint Allowlist

```text
room policy includes allowed fingerprints
matching agents can join
```

Useful for pre-provisioned machines.

Current local CLI:

```text
agent rooms create --join-policy fingerprint_allowlist --allow-fingerprint <fingerprint> <name>
agent rooms create --join-policy fingerprint_allowlist --allow-local-agent <name>
agent rooms join <room-id> --local-agent --alias builder
```

If the joining agent's registered fingerprint matches the room allowlist, the member becomes `active` immediately. Otherwise the member remains `pending` and needs manual approval.

### Quorum Approval

```text
join request requires N approvals from trusted members
```

Useful for high-risk rooms.

### Same Organization Policy

```text
agents registered to the same org may auto-join low-risk rooms
```

Useful for internal automation.

## Room Roles

```text
owner
moderator
participant
observer
executor
reviewer
approver
```

Roles should not directly imply all permissions. Use capability grants for actions.

## Capability Grants

Capabilities are room-scoped or project-scoped permissions.

```text
room.message.send
room.route.broadcast
room.member.invite
room.member.approve
room.member.alias
room.member.role
room.member.status
room.delivery.ack
task.delegate
tool.request
tool.approve
workspace.read
workspace.write
shell.run.safe
shell.run.high_risk
git.branch.create
git.commit.create
git.pr.create
secret.read
```

Example:

```text
agent A is trusted
agent A can send room messages
agent A can read workspace
agent A cannot write files
agent A cannot approve shell commands
```

## Room Policy

```ts
type RoomPolicy = {
  joinPolicy: "manual" | "invite_token" | "fingerprint_allowlist" | "quorum" | "same_org";
  requiredApprovals?: number;
  allowedFingerprints?: string[];
  defaultCapabilities: string[];
  agentResponseMode?: "broadcast" | "mentions_only";
  wideMentionPolicy?: "disabled" | "moderators" | "members";
  maxRoutedAgentTargets?: number;
  requireSignedInvites?: boolean;
  maxMembers?: number;
  expiresAt?: string;
  transcriptRetentionDays?: number;
};
```

Policies can be inherited:

```text
organization policy
  -> project policy
  -> room policy
  -> task policy
```

## Room Messages

Message categories:

```text
chat
task
decision
tool_request
approval
artifact
system
```

Every message should include:

```text
message_id
room_id
sender_id
sender_type
kind
body
structured_routing
signature
created_at
parent_message_id
artifact_refs
```

### Attention And Mention Routing

Large rooms must not wake every agent for every message. The transcript remains visible to authorized members, but automatic agent responses are controlled by structured routing.

The product rule is: room messages are shared context; routed messages are wake-up events. Agents should only enter an execution loop when a message reaches their routed inbox, when they own an assigned task, or when room policy grants them an explicit watcher/moderator responsibility. Ordinary conversation stays transcript-visible but non-waking in `mentions_only` rooms.

Default product stance:

```text
new professional rooms default to mentions_only
ordinary messages are transcript-only
@agent, task assignment, and approval request are wake-up events
wide wake-ups are exceptional, policy-gated, capped, and audited
```

This makes a room scale like a real team room: everyone can review the transcript, but only the people or agents being addressed are expected to respond.

Supported local mention forms:

```text
@agent:<agent_id>      wake one agent
@user:<user_id>        address a human participant
@role:<room_role>      wake active agents with that room role
@all                  wake all active agents
@<unique_actor_id>     resolve a unique room member by id
@<room_alias>          resolve a unique room-scoped member alias
```

Room policy can set:

```text
agentResponseMode=mentions_only  ordinary messages are transcript-only unless explicitly routed; default for professional rooms
agentResponseMode=broadcast      ordinary messages may wake agents; useful only for tiny/debug rooms
wideMentionPolicy=disabled       @all and @role routes are rejected
wideMentionPolicy=moderators     @all and @role require room.route.broadcast
wideMentionPolicy=members        any sender with room.message.send may use @all and @role
maxRoutedAgentTargets=N          reject messages that would wake more than N active agents
```

The routing envelope is parsed into structured message data and included in the signed room message payload. This prevents an attacker from changing the target set without invalidating the signature.

Room aliases are scoped to one room, case-insensitive, and stored on the `room_members` row. They are convenience names only: parsed routing stores the resolved immutable actor id, so historical signed messages are not reinterpreted if an alias changes later. The local service rejects aliases that duplicate another member alias, collide with another actor id, use a reserved route word such as `all` or `role`, or fail the safe alias pattern. If stored alias state is ambiguous, `@alias` remains unresolved and no arbitrary agent is woken.

Messages with unresolved, ambiguous, inactive, unknown, or empty routed targets keep their transcript entry but include signed `metadata.routingDiagnostics`. The local CLI prints `routing-warning` lines after `rooms say`, the Web UI shows warnings under the transcript message, and the store records a `room.routing.warning` audit event. This gives the sender visible feedback without falling back to accidental broadcast behavior.

Wide routes (`@all`, `@role:<room_role>`, and explicit broadcast routing) are policy-gated before the message is signed or stored. The local default is `wideMentionPolicy=moderators`, so owners and moderators can coordinate broad wake-ups through `room.route.broadcast`, while ordinary participants must use precise `@agent:<agent_id>` routing. Accepted wide routes emit a `room.routing.wide` audit event with the message id, raw targets, and routed active-agent count.

Local routed inbox:

```text
agent rooms handles <room-id> [--json]
agent rooms inbox <room-id> --agent-id <agent-id>
agent rooms inbox <room-id> --local-agent --include-delivered --json
agent rooms inbox-ack <room-id> --agent-id <agent-id> --message-id <message-id>
agent remote inbox --control-url <url> --control-token <token> --room <room-id> --json
agent remote ack --control-url <url> --control-token <token> --room <room-id> --message-id <message-id>
agent remote poll --control-url <url> --control-token <token> --room <room-id> --limit <n> --idle-limit <n>
agent remote heartbeat --control-url <url> --control-token <token> --room <room-id> --status online --ttl <seconds>
agent remote run --control-url <url> --control-token <token> --room <room-id> --cycles <n> --stop-when-idle --heartbeat-ttl <seconds>
GET /api/rooms/:roomId/agent-inbox?agentId=<agent-id>
POST /api/rooms/:roomId/agent-inbox/ack
GET /api/rooms/:roomId/handles
GET /api/agents/health
POST /api/agents/:agentId/heartbeat
POST /api/rooms/:roomId/join-invite
POST /api/rooms/:roomId/members/:actorId/aliases
POST /api/rooms/:roomId/members/:actorId/role
POST /api/rooms/:roomId/members/:actorId/status
POST /api/rooms/:roomId/invites/:inviteId/revoke
```

`rooms show` remains the audit view of the complete room transcript. `rooms handles` is the address book for a room: it lists each member's stable typed mention, stable actor-id mention, room aliases, role route, wake status, and agent fingerprint/machine/trust metadata when available. `rooms inbox` is the delivery/wake-up view for one agent and only returns messages that should trigger that agent according to structured routing. The local implementation also stores a per-agent delivery cursor, so `rooms inbox` defaults to unacknowledged routed messages. Use `--include-delivered` for debugging or replay views.

Each routed inbox message also includes an `activationContext` envelope. The envelope tells the receiving agent why it woke (`direct_mention`, `role_mention`, `all_mention`, `broadcast`, or `legacy_broadcast`), which structured routing target matched, the current message, a small recent transcript window, and whether acknowledgement is expected. This keeps large rooms cheap: the full transcript remains auditable, but an agent execution loop starts from a bounded wake-up context instead of blindly loading every room message.

The local control-plane alias API accepts `aliases: string[]` and optional `actor`, then delegates to the same `room.member.alias` capability check and alias normalization used by the CLI.

`POST /api/rooms/:roomId/join-invite` accepts `token`, optional `actor`, and optional `aliases`. It never stores or audits the raw token, activates valid invite holders through the same service path as `agent rooms join --invite-token`, and enforces `requireSignedInvites` when the room policy requires signed admission.

The local member governance APIs accept `role` or `status` plus optional `actor`. Role changes require `room.member.role`, status changes require `room.member.status`, and the service rejects any change that would leave the room without at least one active owner. Both paths emit dedicated audit events.

Acknowledgement rule:

```text
target agent may ack its own inbox cursor
owner/moderator may ack another agent's cursor through room.delivery.ack
ordinary participants cannot ack another agent's cursor
```

Target-agent acknowledgement should be signed when it crosses a process or machine boundary. The local implementation auto-signs `inbox-ack --local-agent` with the agent Ed25519 identity, stores the last ack envelope on the cursor, and records a nonce so replaying the same signed acknowledgement is rejected. Owner/moderator delegated acknowledgement is intentionally separate: it advances the cursor through `room.delivery.ack`, but it does not claim that the target agent personally handled the message.

API clients may submit a signed envelope:

```json
{
  "agentId": "agent_...",
  "messageId": "msg_...",
  "actor": "agent:agent_...",
  "ackEnvelope": {
    "version": 1,
    "roomId": "room_...",
    "agentId": "agent_...",
    "messageId": "msg_...",
    "acknowledgedAt": "2026-06-08T00:00:00.000Z",
    "acknowledgedBy": { "type": "agent", "id": "agent_..." },
    "nonce": "uuid",
    "signature": "ed25519:..."
  }
}
```

Recommended production behavior:

- use `mentions_only` for rooms with many agents;
- treat `mentions_only` as the default for newly created professional rooms, with `broadcast` as an explicit opt-in;
- require stable display aliases that resolve to immutable actor ids;
- show every agent's room alias, immutable agent id, typed mention handle, display name, fingerprint, machine, status, and current load in CLI/TUI/Web UI;
- show each member's immutable actor id, fingerprint, display name, and room alias so humans can mention the right target without trusting mutable names alone;
- send a sender-visible warning when a mention is unresolved, ambiguous, inactive, empty, or policy-denied, and do not wake any fallback agent;
- support message priority as metadata, but never let priority bypass routing, capability, or approval policy;
- allow agents to subscribe to explicit task streams or watcher roles only through room policy, not through passive transcript presence;
- maintain optional digest/summarization feeds for non-addressed agents so they can catch up without responding to every message;
- support `@me`, `@here`, or subscription-style wake-ups only as explicit future policy extensions, not as implicit broadcast behavior;
- allow `@all` and role-wide routes only by policy, cap routed target counts, rate limit them, and audit who used them;
- treat unresolved, ambiguous, inactive, or empty routed targets as non-waking and surface them to the sender/UI;
- let task assignment, approval requests, and direct mentions wake agents;
- keep ordinary discussion transcript-visible but non-waking;
- show routing targets and room mention handles in CLI/TUI/Web UI;
- let worker polling filter room events by routing before loading context;
- replace local inbox filtering with broker/control-plane delivery cursors for distributed agents;
- keep signed ack envelopes and nonce replay windows distributed across control-plane nodes.

## Approval Flow

```text
agent requests action
  -> policy engine evaluates
  -> if approval needed, room receives approval.request
  -> approver signs approval
  -> control plane records approval
  -> tool execution proceeds
```

High-risk approvals can require quorum:

```text
delete files: 1 approver
run migration: 2 approvers
production secret access: org admin approval
force push: denied by default
```

Current local CLI:

```text
agent tool create_file --execution-mode balanced --room <room-id> --input-file <json>
agent approvals pending
agent approve <approval-id> "reason"
agent approve <approval-id> --auto-replay --auto-resume "reason"
agent approve <approval-id> --queue-resume <worker-id> "reason"
agent replay <approval-id>
agent spec dispatch <spec-id> --plan <plan-id> --require-plan-approval
agent spec dispatch <spec-id> --plan <plan-id> --required-plan-approvals 2
agent rooms show <room-id>
agent web --port 4317
```

When a room-scoped tool call requires approval, the room transcript records:

- `tool_request`: approval id, tool, action, reason, approver hint;
- `approval`: approved or denied decision;
- `approval`: replay execution completion or failure.

This is the local coordination path for human or super-agent approval. Current local approval commands enforce room capability checks before a member can approve or deny a room-scoped tool request. Spec plan dispatch can also require a distinct-approver quorum, either from `room.policy.requiredApprovals` or `--required-plan-approvals`. Production mode should replace the hard-coded local role map and approval rows with configurable RBAC/capability grants, signed human approvals, a durable quorum state machine, and automatic resume after approval.

## Current Local Capability Checks

The local MVP maps room roles to capabilities:

```text
owner       -> room.message.send, room.route.broadcast, room.member.invite, room.member.approve, room.member.alias, room.member.role, room.member.status, room.delivery.ack, task.delegate, tool.request, tool.approve
moderator   -> room.message.send, room.route.broadcast, room.member.invite, room.member.approve, room.member.alias, room.member.status, room.delivery.ack, task.delegate, tool.request
approver    -> room.message.send, tool.approve
reviewer    -> room.message.send, tool.request
executor    -> room.message.send, task.delegate, tool.request
participant -> room.message.send, tool.request
observer    -> none
```

Currently enforced actions:

- `agent rooms invite` requires `room.member.invite`;
- `agent rooms approve` requires `room.member.approve`;
- `agent rooms alias` requires `room.member.alias`;
- `agent rooms role` requires `room.member.role`;
- `agent rooms status` requires `room.member.status`;
- `agent rooms say` requires `room.message.send`;
- `@all`, `@role:<role>`, and explicit broadcast routing require room policy permission and usually `room.route.broadcast`;
- `agent rooms inbox-ack` requires the target agent itself or `room.delivery.ack`;
- `agent approve` / `agent deny` for room-scoped tool requests requires `tool.approve`.

This keeps the local room collaboration model usable now while leaving production policy flexible enough for org/project/room inherited grants later.

## Communication Topology

Start with brokered rooms:

```text
agent
  -> control plane
  -> broker
  -> room subscribers
```

Later, allow direct connections after policy approval:

```text
agent A
  -> signed direct channel
  -> agent B
  -> events mirrored to control plane
```

Do not start with pure peer-to-peer. It makes policy, replay, and audit harder.

## Suggested Tables

```text
machines
agents
agent_keys
agent_trusts
agent_capabilities
rooms
room_members
room_invites
room_messages
room_artifacts
room_approvals
room_decisions
agent_messages
subtasks
session_links
```

## Minimal First Version

Build this first:

```text
create room
invite agent by fingerprint
agent join request
admin approve join
send signed room messages
record transcript
grant room capabilities
request tool approval in room
```

Leave direct peer-to-peer and quorum approval for later.

## Current Local MVP

The first local implementation provides the room coordination skeleton through CLI commands:

```text
agent rooms create <name>
agent rooms create --alias owner "release review"
agent rooms create --agent-response mentions_only <name>
agent rooms create --agent-response mentions_only --wide-mention-policy moderators --max-routed-agent-targets 5 <name>
agent rooms create --join-policy invite_token --require-signed-invites "signed admission"
agent remote enroll --control-url http://127.0.0.1:4317 --control-token <token> --room room_xxxxxxxx --invite-token rinv_xxxxxxxx --alias builder
agent remote inbox --control-url http://127.0.0.1:4317 --control-token <token> --room room_xxxxxxxx --json
agent remote ack --control-url http://127.0.0.1:4317 --control-token <token> --room room_xxxxxxxx
agent remote poll --control-url http://127.0.0.1:4317 --control-token <token> --room room_xxxxxxxx --limit 5 --idle-limit 1
agent remote heartbeat --control-url http://127.0.0.1:4317 --control-token <token> --room room_xxxxxxxx --status online --ttl 60
agent remote run --control-url http://127.0.0.1:4317 --control-token <token> --room room_xxxxxxxx --cycles 100 --stop-when-idle --idle-cycles 3 --heartbeat-ttl 60
agent rooms list
agent rooms show <room-id>
agent rooms handles <room-id> [--json]
agent rooms inbox <room-id> --agent-id <agent-id>
agent rooms inbox-ack <room-id> --agent-id <agent-id> --message-id <message-id>
agent rooms invite <room-id> --ttl-hours 12
agent rooms invites <room-id>   # prints signature=valid|unsigned|unknown_agent|invalid
agent rooms revoke-invite <room-id> <invite-id>
agent rooms join <room-id> --actor agent:<id> --role executor --alias builder
agent rooms join <room-id> --local-agent --invite-token <token> --alias builder
agent rooms approve <room-id> <actor-id>
agent rooms alias <room-id> agent_builder --alias builder --alias build.bot
agent rooms role <room-id> agent_builder reviewer
agent rooms status <room-id> agent_builder suspended
agent rooms say <room-id> --actor agent:<id> --kind task <message>
agent rooms say <room-id> "@builder please inspect the failing test"
agent rooms say <room-id> "@agent:<agent-id> please inspect the failing test"
agent web [--host 127.0.0.1] [--port 4317]
```

## Cross-Platform Room Mainline

Rooms are the collaboration spine for Soloclaw agents across machines. The intended product path is:

```text
Windows/Linux/macOS/Android agent starts from soloclaw
  -> agent has a local identity and model/workspace config
  -> agent enrolls with a room control plane
  -> room invite or fingerprint allowlist activates membership
  -> routed room messages enter the agent's inbox
  -> agent signs acknowledgement and heartbeat envelopes
  -> agent runs assigned work and posts progress/results back to the room
```

The first distributed shape is hub-and-room, not peer-to-peer. A control plane owns room membership, routed inbox cursors, signed acknowledgements, heartbeats, health summaries, approvals, and operator views. This keeps Windows, Linux, macOS, and Android Termux agents on the same protocol without requiring early NAT traversal, device discovery, or direct P2P trust negotiation. The product goal is natural mixed-OS collaboration: any supported machine can join the same room, receive routed work, and report progress through the same signed protocol.

Platform targets:

- **Windows**: PowerShell/CMD `soloclaw` entry, local workspace access, room enroll/run commands, later Windows service wrapper.
- **Linux**: shell `soloclaw` entry, server/workstation daemon path, systemd packaging later.
- **macOS**: shell `soloclaw` entry, local workspace access, developer workstation daemon path, launchd packaging later.
- **Android**: Termux `soloclaw` CLI/TUI first for room-agent behavior, then companion/native UI for room monitoring, notifications, approvals, guided actions, and optional local-agent lifecycle control.

Android room agents are not assumed to have general control over the phone. A Termux agent can participate in rooms, run configured commands, call approved APIs, and report status, but it cannot automatically operate arbitrary third-party Android Apps by default. Any future Accessibility, ADB, Shizuku, root, device-owner, or App-UI automation integration must be opt-in, visibly authorized, auditable, and separated from irreversible commerce/payment confirmation. For workflows like ordering food or buying a drink, the intended product behavior is to gather options, prepare or open a guided flow, request approval, and leave final checkout/payment confirmation to the user unless a compliant first-party API explicitly supports safer delegation.

Every room feature should preserve this split:

- transcript messages are shared context;
- routed inbox messages are the wake-up trigger;
- signed acknowledgements prove delivery handling;
- signed heartbeats prove agent liveness;
- operator views explain why an agent is idle, stale, running, blocked, or failed.

Current guarantees:

- room metadata, members, and messages are persisted in SQLite;
- owners are active immediately when creating a room;
- short-lived invite tokens can activate joining members immediately through CLI or local control-plane API, local-agent-issued invites carry signed envelopes, rooms can require valid signed invite envelopes, and authorized owners/moderators can revoke active invites;
- joining creates a pending member;
- fingerprint allowlist rooms can auto-activate matching registered agents;
- approval activates a pending member across CLI processes;
- room-scoped tool approvals are recorded in the room transcript;
- room messages include signed mention routing metadata and routing diagnostics for agent wake-up decisions;
- room-scoped aliases can be assigned on create/join, updated through `room.member.alias`, audited, and resolved to immutable actor ids before signing;
- member role/status can be updated through local capability-gated CLI/Web APIs, audited, and guarded so every room keeps at least one active owner;
- `agent rooms handles` and `GET /api/rooms/:roomId/handles` expose the local mention address book;
- `agent rooms inbox`, `agent rooms inbox-ack`, `GET /api/rooms/:roomId/agent-inbox`, and `POST /api/rooms/:roomId/agent-inbox/ack` expose the local routed wake-up view and per-agent delivery cursor;
- `agent remote inbox`, `agent remote ack`, `agent remote poll`, `agent remote heartbeat`, and `agent remote run` expose the same routed wake-up, signed acknowledgement, and signed health path for an enrolled agent running from another working directory or machine;
- room role capability checks gate invite creation, join approval, message sending, and room-scoped tool approval decisions;
- observers can be represented as read-only room members;
- `agent delegate --room <room-id>` records subtask assignment and result events in the room transcript;
- local agent identity is generated and registered automatically; default room delegation uses that agent id;
- `agent web` starts a local room console showing rooms, invites, members, aliases, transcripts, derived agent health, pending approvals, and recent sessions. The console can send room messages, revoke active invites, edit member aliases/roles/statuses, approve/deny pending approval requests, and pause/resume/cancel sessions through the local control plane API. Its control actor field defaults to `user:local-user` and can be set to another authorized active room member for local operations.

Next production steps:

- `soloclaw room` convenience commands over the current `rooms` and `remote` flows;
- cross-platform smoke scripts for Windows, Linux, macOS, and Android Termux agents joining one local room;
- daemon lifecycle for remote room runners, including status, logs, clean shutdown, and resume;
- authenticated control-plane sessions instead of local development tokens;
- real-time room event streaming for Web/TUI and daemon consumers;
- user identity keys and signed human approvals;
- quorum approval;
- distributed room-linked sub-agent delegation;
- authenticated, real-time room Web UI with signed approval envelopes.



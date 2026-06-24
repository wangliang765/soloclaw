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

For local Phase 5 smoke coverage, `agent agents rotate-key <agent-id> --public-key-file path --local-agent --json` and `POST /api/agents/:agentId/rotate-key` replace a registered remote public key after validating the replacement fingerprint. Rotation preserves the existing trust status and capabilities, records the previous fingerprint in audit metadata, and makes old signed room operations fail against the new stored public key. The manual matrix records only fingerprints, rejection summaries, audit visibility, and message ids; private keys and signed envelopes stay out of evidence.

Current remote bootstrap CLI:

```text
agent rooms create --local-agent --join-policy invite_token --require-signed-invites "phase5 room"
soloclaw room invite-agent <room-id> --control-url http://<control-host>:4317 --control-token <token> --alias builder --display-name builder --json > room-invite.json
soloclaw room join --invite-bundle room-invite.json --json
soloclaw room join --invite-bundle room-invite.json --run --status-file .agent/tmp/remote-room-status.json --stop-file .agent/tmp/remote-room.stop --reply-template "@owner handled {messageId}" --json
agent remote register --control-url http://<control-host>:4317 --control-token <token> --display-name builder --json
agent rooms pull-agent <room-id> <agent-id> --alias builder --role executor --local-agent --json
agent remote invitations --control-url http://<control-host>:4317 --control-token <token> --json
agent remote accept-room --control-url http://<control-host>:4317 --control-token <token> --room <room-id> --json
agent remote run --control-url http://<control-host>:4317 --control-token <token> --room <room-id> --cycles 20 --stop-when-idle --idle-cycles 2 --status-file .agent/tmp/remote-room-status.json --stop-file .agent/tmp/remote-room.stop --reply-template "@owner handled {messageId}" --json
agent remote inbox --control-url http://127.0.0.1:4317 --control-token <token> --room <room-id> --json
agent remote say --control-url http://127.0.0.1:4317 --control-token <token> --room <room-id> "@owner hello from this machine"
agent remote ack --control-url http://127.0.0.1:4317 --control-token <token> --room <room-id>
agent remote poll --control-url http://127.0.0.1:4317 --control-token <token> --room <room-id> --limit 5 --idle-limit 1
agent remote heartbeat --control-url http://127.0.0.1:4317 --control-token <token> --room <room-id> --status online --ttl 60
agent remote run --control-url http://127.0.0.1:4317 --control-token <token> --room <room-id> --cycles 100 --stop-when-idle --idle-cycles 3 --status-file .agent/tmp/remote-room-status.json --stop-file .agent/tmp/remote-room.stop --reply-template "@owner handled {messageId}"
soloclaw phase5 verify --json
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
soloclaw phase5 evidence-init --registered-pull-target linux-shell-agent --json
soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --json
soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --target linux-shell-agent --registered-pull-target linux-shell-agent --json
soloclaw phase5 evidence-template --json
soloclaw phase5 evidence-template --target control-plane-host --json
soloclaw phase5 evidence-check --file control-fragment.json --target control-plane-host --json
soloclaw phase5 evidence-template --target linux-shell-agent --json
soloclaw phase5 evidence-check --file linux-fragment.json --target linux-shell-agent --json
soloclaw phase5 evidence-merge --file phase5-evidence.json --target-file linux-fragment.json --output phase5-evidence.merged.json --json
soloclaw phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json
soloclaw phase5 evidence-check --file phase5-evidence.json --json
agent agents health --json
```

`soloclaw room invite-agent` creates a signed invite using the control host's local agent identity and emits a sensitive JSON bundle containing the control URL, control token, room id, invite token, default remote-run settings, and paste-ready `soloclaw room join` commands. The bundle's run command includes workspace-local `--status-file .agent/tmp/remote-room-status.json` and `--stop-file .agent/tmp/remote-room.stop` defaults so the remote machine can immediately produce runner evidence and still accept an operator stop marker; the human-readable bundle output also names the status file to read and the stop marker to create. Copy that bundle to the remote machine as `room-invite.json`; do not commit it or paste it into evidence logs. `soloclaw room join` generates or reuses the remote machine's local agent identity, registers its public key with the control plane, joins the room, and sends a signed `online` heartbeat. With `--run`, it immediately starts the foreground routed-inbox loop and can post signed template replies; invalid workspace-local run controls such as an out-of-workspace `--stop-file` fail before registration, join, or heartbeat side effects. These convenience commands wrap `agent rooms invite-bundle` and `agent remote join-bundle`; production should replace the shared control token with authenticated enrollment credentials and short-lived admission grants.

For already-known machines, `agent remote register` publishes the remote machine's local public identity to the control plane without joining a room. A room owner or moderator can then run `agent rooms pull-agent <room-id> <agent-id>` to add that registered identity as an `invited` room member with a role and aliases. On the remote machine, `agent remote invitations` lists pending room invitations for the local identity, and `agent remote accept-room --room <room-id>` accepts the invitation and sends a signed `online` heartbeat. After the member is active, route a task to that agent and run `agent remote run` with a workspace-local status file to collect signed ack, signed reply, idle heartbeat, and idle stop evidence. This is the Phase 5 "pull a cross-machine agent into a room" path; `soloclaw phase5 evidence-check --file <path> --json` now gates the real matrix on the same paste-safe proof under `room.registeredAgentPull`. It still relies on the local development control token and should become a signed, authenticated invitation ceremony in production.

The local Web console exposes the same one-file bundle shape for operators using `agent web`: `POST /api/rooms/<room-id>/invite-bundle` creates a signed invite and returns a `soloclaw.room_invite` bundle for the selected room. The Web UI's "Invite Remote Agent" panel fills the control token from the authenticated Web session, writes the bundle JSON only to the immediate response/output box, refreshes the room invite list, and audits only paste-safe metadata such as invite id, role, aliases, expiry, max uses, and signature status. The returned bundle is still sensitive because it contains both the control token and invite token; copy it to the remote machine as `room-invite.json`, but do not paste it into Phase 5 evidence, audit notes, issue comments, or logs.

After enrollment, a remote agent should poll `remote inbox` instead of reading the whole room transcript into its execution loop. The inbox returns only messages routed to that agent by `@agent:<id>`, unique aliases, role routes, or approved wide routes. `remote ack` signs the delivery acknowledgement with the remote agent identity and submits it to the control plane, so the room can distinguish "visible in transcript" from "this agent accepted the wake-up".

`remote say` posts a message back to the room through the control plane as the enrolled local agent. This gives a different machine a first-class transcript path without direct SQLite access. Remote messages now carry a signed `RoomMessageIntentEnvelope` over the agent id, room id, kind, body, optional routing/artifact fields, sender, timestamp, and nonce. The local control plane verifies the Ed25519 signature against the registered public identity, rejects nonce replay, persists only signature status/nonce metadata on the stored room message, and still lets the server generate the final message id and persistence timestamp.

`remote poll` is the bounded development runner for the same path. It repeatedly reads the routed inbox, signs acknowledgements for messages it accepts, and exits after `--limit` processed messages or `--idle-limit` empty polls. Production should wrap this contract in a supervised daemon or streaming consumer instead of relying on manual CLI polling.

`remote run` is the foreground supervised-loop shape. It repeatedly invokes bounded polling, can stop after idle cycles, and applies backoff after transient control-plane errors. Adapter code can attach an `onMessage` handler for each routed message after signed acknowledgement. The CLI `--reply-template` option uses that hook to post a signed room reply for source-install smoke tests; supported placeholders are `{messageId}`, `{kind}`, `{body}`, `{createdAt}`, `{roomId}`, and `{agentId}`. `--status-file` writes a workspace-local JSON summary with kind `soloclaw.remote_room_runner_status`, room/agent ids, processed-message counts, last ack metadata, stop reason, last heartbeat summary, lifecycle snapshot, and error count without storing the control token, invite token, raw bundle, or private key. `--stop-file` watches for a workspace-local marker file and translates its presence into the shared daemon lifecycle's `shutdown_requested` stop before claiming more inbox work; the runner never reads or records the marker contents. `RemoteRoomRunner.run` now also returns the shared daemon lifecycle snapshot, loop metrics, and last heartbeat summary used by scheduler/worker foreground loops, including idle stop, failure counts, processed-message counts, and `shutdown_requested` stops. It is still a development command, but it establishes the lifecycle contract needed by the later remote-agent daemon.

`agent remote service --json` prints a metadata-only service plan for wrapping `remote run` with the target OS supervisor. The plan has kind `soloclaw.remote_room_service_plan`, `installState: "plan_only"`, the platform service manager shape, a token-redacted foreground entrypoint that uses `<control-token>` / `AGENT_CONTROL_TOKEN`, workspace-local status and stop file paths, and required/recommended/blocked runbook steps. It validates `--status-file` and `--stop-file` stay inside the remote workspace, never writes files, never contacts the control plane, and does not register or mutate an operating-system service.

`soloclaw room join --run` is the one-step remote form of enrollment plus foreground run. It uses the bundle defaults for cycles, polling limits, idle stop, backoff, and heartbeat TTL unless CLI flags override them. The JSON output includes a paste-safe `bootstrapEvidence` object with `inviteBundleKind`, `inviteSignatureStatus`, `joinedFromInviteBundle`, and `ranFromInviteBundle`; copy those fields into the Phase 5 target evidence instead of copying the raw invite bundle or tokens.

`soloclaw phase5 verify --json` is the current machine-checkable source-install smoke for this contract. It creates a control workspace and two separate remote-agent workspaces, starts the token-gated local HTTP control plane, opens the room-scoped `/api/events?room=<room-id>` stream, creates a signed-invite room, enrolls both remote identities, writes and reads a sensitive one-file invite bundle for a third bootstrap identity, joins that identity through the bundle path, runs an idle foreground `RemoteRoomRunner`, and records token-safe runner status-file evidence with idle stop and idle last-heartbeat status. It also registers an already-known remote identity without an invite token, pulls that identity into the room as an invited member, confirms the remote invitation listing, accepts the room invitation, routes a task to the pulled agent, and verifies the pulled agent handles exactly that routed message with a signed delivery ack, signed room reply, and runner heartbeat. It then generates a Web invite bundle through `POST /api/rooms/<room-id>/invite-bundle`, verifies the bundle kind/signature and enroll/run commands, and proves `/api/state` plus control-plane audit do not leak the invite token, control token, or control URL. It then revokes a separate probe invite and proves a late remote identity cannot join with it, rotates a joined probe agent key and proves the old signed `remote say` is rejected while a replacement-key message plus rotation audit are visible, suspends an already-joined probe agent and proves it receives no routed inbox messages and cannot send through `remote say`, creates a separate stale-agent probe by submitting an expired signed heartbeat and checking `/api/agents/health` reports `healthState: "stale"`, `heartbeatExpired: true`, `responsive: false`, and the expected room id, then calls `POST /api/agents/recover-stale` to prove the stale agent is suspended in the room and its heartbeat state becomes `offline`. It then sends one routed task message to each active enrolled remote agent, runs each foreground remote adapter with a reply template, verifies each agent only handles its own routed task, posts an ordinary unmentioned chat message in the `mentions_only` room, verifies that message remains transcript-visible while every remote inbox, runner pass, and delivery-status pending count stays at zero, verifies signed delivery acknowledgements, signed heartbeats, streamed room-scoped `control_plane.action` events for those remote agents, streamed `room.message.sent` message-id/body-length summaries for the routed messages without raw bodies, streamed `room.delivery.acknowledged` message-id/agent summaries without signed ack envelopes, per-agent `GET /api/rooms/<room-id>/delivery-status` pending/ack summaries without ack envelopes, valid signed remote message-intent metadata, then creates a room-linked delegation assigned to one enrolled remote agent and verifies the task/result transcript messages plus completed child session ids without copying task bodies into evidence. It then runs a peer exchange where agent A sends a signed routed task to agent B, B signs a routed reply back to A, and A acknowledges that reply from its own routed inbox. It runs a remote-to-remote handoff where the source agent routes a handoff request to the target, the target signs acceptance and completion decisions back, and the source acknowledges those routed handoff replies. The verifier also records two conflicting remote artifact messages plus an owner resolution decision, copies a remote result file into the control workspace as a room-scoped `report` artifact and announces that artifact in the room, checks that operator-visible control-plane surfaces can see the full room transcript through room/state APIs, both active remote agents through health APIs, and every active remote agent through delivery-status with zero pending routed messages, then requests a foreground runner stop through a workspace-local stop marker and verifies token-safe `shutdown_requested` runner status-file evidence before scanning the JSON evidence for secret-shaped leaks. It is a local proof plus one-file bootstrap, registered-agent pull communication, Web invite-bundle leak check, revoked-invite, key-rotation, suspended-member, stale-health, stale-recovery, no-broadcast fallback execution, room-assignment/result, conflict-resolution, result-sync, room-handoff, stop-file shutdown, local event-stream, and local delivery-status checks, not a replacement for real multi-machine or four-OS soak tests.

`soloclaw phase5 matrix-template --json` prints the manual smoke matrix for the real cross-machine pass: one control-plane host plus Windows PowerShell, Windows CMD, Linux shell, macOS shell, and Android Termux remote agents. Use `--target <target-id>` to print only the commands for one collector, for example `soloclaw phase5 matrix-template --target linux-shell-agent --json` on the Linux host. The template now makes the control host generate a per-target `room-invite.json` with `soloclaw room invite-agent`, generate and revoke a separate `<revoked-invite-bundle-file>` probe invite, open `GET /api/events?room=<room-id>` with the control token in a separate terminal, capture `GET /api/rooms/<room-id>/delivery-status` after routed runs and after the no-broadcast fallback probe complete, then has each remote run `soloclaw room join`, record the `bootstrapEvidence` summary from `soloclaw room join --run --json`, optionally attempt the revoked bundle and record the expected join rejection, remove any stale `.agent/tmp/phase5-remote-room.stop` marker, run `agent remote service --json` for token-safe plan-only supervision evidence, and run `soloclaw room join --run --status-file .agent/tmp/phase5-remote-room-status.json --stop-file .agent/tmp/phase5-remote-room.stop`. The local SSE endpoint also accepts `session`, `agent`, and `type` query filters for focused operator probes, including `type=room.message.sent` when the operator needs message-id/kind/sender/body-length append evidence without raw room text and `type=room.delivery.acknowledged` when the operator needs acknowledged message ids and agent ids without signed ack envelopes; the delivery-status endpoint supplies per-agent routed counts, pending counts, last routed message id, last ack message id, and signed-ack booleans without bodies or envelopes. Record `eventStreamAckMessageIds` so they include every `deliveryStatusAckMessageIds` value. Production broker/WebSocket streaming remains a later replacement. The control-host commands include `agents trust <revoked-agent-id> revoked` plus a routed ack probe, and the selected revoked remote target then attempts old signed `remote say`, `remote heartbeat`, and `remote run` acknowledgement probes that should be rejected before any signed operation is accepted. The control-host commands also include a suspended-agent probe using `rooms status <room-id> <suspended-agent-id> suspended` plus a routed probe message that should not wake that agent. The control-host commands include one ordinary unmentioned chat probe under `<no-broadcast-fallback-message-id>` and require recording that same id under control-host `eventStreamRoomMessageIds`; after that message is transcript-visible, every remote target runs a `noBroadcastFallback` inbox probe and idle-run probe and records zero messages under `room.noBroadcastFallback`. For stale-health evidence, the template includes `<stale-agent-id>` and `<stale-health-check-now-iso>` placeholders, asks one joined remote to submit `remote heartbeat --ttl 1`, then has the control host run `agents health --now <stale-health-check-now-iso> --json` and record the expected stale result, followed by `agents recover-stale --now <stale-health-check-now-iso> --json` to record `soloclaw.agent_stale_recovery` evidence with suspended membership and offline health. The control-host commands also include `agent delegate --room <room-id> --assigned-agent <assignment-target-agent-id>`; record the returned subtask/child-session ids and the task/decision message ids from `rooms show` under `room.assignmentResult`. For conflict evidence, choose two joined remote agents, have both post an `artifact` message for the same `<conflict-result-key>`, then record the control-host `decision` message id that chooses `<conflict-winning-agent-id>` under `room.conflictResolution`. For result-sync evidence, choose one joined remote agent, have it write `.agent/tmp/phase5-result-sync.json`, copy that file into the control workspace, register it there with `artifacts add --room <room-id>`, and announce the registered artifact id in a room `artifact` message under `room.resultSync`; this is a paste-safe manual sync proof, not the production file-sync service. For handoff evidence, choose two distinct joined remote agents, have the source post a routed handoff `task` to the target, then have the target post visible acceptance and completion `decision` messages under `room.handoff`. The matrix prints platform-specific stop-marker creation commands plus a separate stop-file shutdown smoke that writes `.agent/tmp/phase5-remote-room-stop-status.json` with `stopReason: "shutdown_requested"`. It still includes explicit `remote say` commands for one real agent-to-agent exchange and final status-file reads for last heartbeat, lifecycle, and local runner evidence.

For registered-agent pull evidence, choose one real remote target as `<registered-pull-target-id>`. That target runs `remote register` and records `<registered-pull-agent-id>`, the control host runs `room pull-agent`, the remote confirms `remote invitations`, accepts with `remote accept-room`, and then handles the control-host routed task through `remote run`. Record invitation listing, acceptance, role/aliases, `<registered-pull-message-id>`, `<registered-pull-reply-message-id>`, handled message ids, signed ack, valid reply signature, idle heartbeat, idle stop, zero pending delivery, and task/reply transcript kinds under `room.registeredAgentPull`. After the selected target has `.agent/tmp/phase5-registered-pull-status.json`, `soloclaw phase5 registered-pull-evidence-patch --registered-pull-target <registered-pull-target-id> --status-file .agent/tmp/phase5-registered-pull-status.json --pull-agent-file pull-agent.json --invitations-file invitations.json --accept-room-file accept-room.json --room-show-file room-show.json --delivery-status-file delivery-status.json --json` can combine that token-safe runner summary, whitelisted command JSON summaries, transcript summary, delivery summary, and explicit control-host summary arguments into `patch.room.registeredAgentPull` and report any fields still missing before you paste it into the control-plane fragment. The final full-matrix `evidence-check` also verifies that `room.registeredAgentPull.agentId` matches the collected `agentId` for the declared `room.registeredAgentPull.targetId`.

For key-rotation evidence, choose one joined remote as `<key-rotation-agent-id>`, record its current fingerprint, prepare replacement key material for the same agent id on that remote, copy only the replacement public key to the control host as `<key-rotation-public-key-file>`, then run `agents rotate-key` from the control workspace. Before switching the remote workspace to the replacement private key, its old signed `remote say` must fail. After switching to the replacement key, a new signed `remote say` must appear in `rooms show`, and `audit list --type control_plane.action --room <room-id>` must show the rotation audit.

`soloclaw phase5 evidence-plan --json` prints a token-safe collection manifest for the control host. It lists the expected `phase5-fragments` directory, base/merged evidence filenames, one row per required target, each target's fragment filename/path, per-target matrix/template/preflight/status commands, per-target `collectorGuideCommand`, `collector-pack`, `collection-prepare`, and the final target-dir merge plus full evidence-check commands. `soloclaw phase5 collection-runbook --json` prints the ordered control-host sequence for the same collection: initialize the base evidence file, write collector guides, distribute per-target materials, collect fragments, watch status, merge the fragment directory, and run the final evidence-check gate. It also lists each target guide path, fragment path, preflight command, target-filtered status command, and one-guide regeneration command without expanding control-token or invite-bundle placeholders. Add `--registered-pull-target <remote-target-id>` to `collection-runbook`, `collection-prepare`, `collector-guide`, or `collector-pack` after choosing the one real remote target that will run the registered-agent pull ceremony; the selected guide is marked `isRegisteredPullTarget: true`, includes a token-safe `registeredPullRunbook` with the register, pull-wait, invitation-list, accept-room, remote-run, and status-file evidence stages, and the other guides explicitly tell their operators not to run registered-pull-only commands. The selected `collection-runbook --json` also includes `registeredPullControlHostRunbook`, a token-safe control-host counterpart that names the selected guide/fragment paths and stages for waiting on remote registration, running `rooms pull-agent`, waiting for acceptance, sending the routed task, checking delivery status, inspecting transcript/runner summaries, and filling the control-plane fragment's `room.registeredAgentPull` object. `soloclaw phase5 collection-prepare --json` writes the control-host collection workspace in one no-overwrite step: the base `phase5-evidence.json`, one token-safe `phase5-fragments/<target-id>.json` template per required target, one Markdown guide per required target under `phase5-collector-guides/`, and `phase5-collection-runbook.md`. Its text output also lists each fragment path plus the target's template, preflight, status, and one-guide regeneration commands so a console-only run can still hand one machine operator the matching fragment and commands. Use `--force` only when intentionally replacing those files; the command does not generate control tokens, invite tokens, private keys, signed envelopes, or raw SSE captures. `soloclaw phase5 collector-guide --target <target-id> --json` prints a single target's token-safe collector handoff: target label/role, fragment path, matrix/template/preflight commands, return-to-control-host copy path, target-filtered status command, merge command, final check command, and paste-safe evidence notes. That return-to-control-host status command includes `--target <target-id>` so the receiving operator sees this machine's current missing checks while `finalEvidenceCheck` still summarizes the full matrix. Use it when sending instructions to one remote machine operator; it deliberately does not expand raw matrix commands that contain control-token or invite-bundle placeholders unless you add `--include-smoke-commands` for a separate execution handoff. `soloclaw phase5 collector-pack --json` writes one Markdown guide per required target under `phase5-collector-guides/` and reports each guide's fragment path plus preflight, target-filtered status, and one-guide regeneration commands in `guides[]`; add `--target <target-id>` to write only one guide when distributing instructions one machine at a time, and add `--include-smoke-commands` only when the guide should embed the target's matrix commands with placeholders. Keep filled JSON fragments under `phase5-fragments/` so status and merge commands do not ingest guide files as evidence. `soloclaw phase5 evidence-init --json` writes the default `phase5-evidence.json` base template plus one token-safe `phase5-fragments/<target-id>.json` fragment template per required target, reports the written paths, per-fragment `templateCommand`, `preflightCommand`, `statusCommand`, `collectorGuideCommand`, and next commands, and refuses to overwrite existing files unless `--force` is passed intentionally. When `--registered-pull-target <remote-target-id>` is passed, those per-fragment scaffold commands carry the same selected registered-pull target so each operator receives matching guide/status commands. It does not generate control tokens, invite tokens, private keys, signed envelopes, or raw SSE captures. `soloclaw phase5 evidence-template --json` prints the paste-safe result file shape for that manual pass. Use `--target <target-id>` to print only one collector's fill-in fragment, for example `soloclaw phase5 evidence-template --target control-plane-host --json` on the control host or `soloclaw phase5 evidence-template --target linux-shell-agent --json` next to the Linux matrix commands. After filling the control-host fragment, run `soloclaw phase5 evidence-check --file control-fragment.json --target control-plane-host --json` to preflight control-plane event-stream, delivery-status, transcript/state/health, operator-visibility, shared `room.*` evidence, and secret-shape evidence without requiring the remote target fragments yet; the final full-matrix gate still checks remote target/agent id consistency after merge. After filling one remote fragment, run `soloclaw phase5 evidence-check --file linux-fragment.json --target linux-shell-agent --json` on that collector to preflight install/bootstrap/enroll/inbox/heartbeat/run/reply, signed reply, invite-bundle bootstrap, remote service-plan, runner status-file, and secret-shape evidence before sending it back to the control host. Use `soloclaw phase5 evidence-merge --file phase5-evidence.json --target-file linux-fragment.json --output phase5-evidence.merged.json --json` on the control host to replace matching `targets[]` entries with filled per-machine fragments before running the final evidence check; `--target-dir phase5-fragments` can load all first-level `.json` fragments from a collection directory in filename order while ignoring non-JSON notes. Merge rejects duplicate target ids across fragment inputs instead of silently overwriting evidence. When the fragment contains `control-plane-host`, merge also replaces the shared `room` section from that control-host fragment, while remote-only fragments preserve the current `room` section. Merge reports `requiredTargetIds`, `mergedTargetIds`, `remainingTargetIds`, `targetStatus`, and `roomStatus`; `readyForFinalEvidenceCheck` is true only when all required targets are passing and the shared room evidence has come from the control-plane fragment or already looks collected. The merge command accepts UTF-8/UTF-16 BOM-encoded JSON files produced by Windows shell capture. Fill it after running the matrix, recording only room ids, agent ids, message ids, pass/fail states, processed-message counts, heartbeat status, signed acknowledgement evidence, `remoteIntentSignatureStatus`, one-file bootstrap summary fields for every remote target (`checks.bootstrap: "pass"`, `inviteBundleKind: "soloclaw.room_invite"`, `inviteSignatureStatus: "valid"`, `joinedFromInviteBundle: true`, and `ranFromInviteBundle: true`), runner status-file summary fields including `runnerLastHeartbeatStatus`, `runnerLastHeartbeatAt`, `runnerHeartbeatExpiresAt`, `runnerLifecyclePhase`, `runnerMetricTickCount`, and `runnerMetricMessagesProcessed`, remote service-plan summary fields, control-plane transcript/state/agent-health counts, control-plane delivery-status summaries (`deliveryStatusVisible`, `deliveryStatusAgentIds`, `deliveryStatusPendingCounts`, and `deliveryStatusAckMessageIds`), control-plane event stream summaries under the control-host target (`eventStreamConnected`, `eventStreamControlActionTypes`, `eventStreamAgentIds`, `eventStreamRoomMessageEventTypes`, `eventStreamRoomMessageIds`, `eventStreamDeliveryAckEventTypes`, and `eventStreamAckMessageIds` covering every `deliveryStatusAckMessageIds` value), `room.revokedInvite` join-rejection evidence without raw invite ids or tokens, `room.revokedAgent` evidence with `trustStatus: "revoked"`, `trustUpdated: true`, `signedSayBlocked: true`, `signedAckBlocked: true`, `signedHeartbeatBlocked: true`, and a short trust-status rejection summary, `room.suspendedAgent` evidence with `status: "suspended"`, `inboxMessageCount: 0`, `remoteSayBlocked: true`, and a short capability/status rejection summary, `room.noBroadcastFallback` evidence with one ordinary unmentioned chat message id that also appears in the control-host `eventStreamRoomMessageIds` safe summary list, `messageVisible: true`, every remote agent id, and zero values in `inboxCounts`, `runMessagesProcessed`, and `deliveryStatusPendingCounts`, `room.staleAgent` evidence with the target/agent ids, `heartbeatStatus: "online"`, `healthState: "stale"`, `heartbeatExpired: true`, `responsive: false`, `lastRoomId`, and a health-check timestamp taken after the TTL=1 heartbeat expires, `room.staleRecovery` evidence with `recoveryKind: "soloclaw.agent_stale_recovery"`, `recovered: true`, `memberStatusAfter: "suspended"`, `heartbeatStatusAfter: "offline"`, and `healthStateAfter: "offline"`, the `room.peerExchange` sender/receiver/message/reply evidence, `room.assignmentResult` evidence for one completed room-linked delegation addressed to a joined remote agent, `room.conflictResolution` evidence for two conflicting remote artifact messages plus one resolved decision, `room.resultSync` evidence for one remote result file copied to the control workspace, registered as an active room-scoped `report` artifact with sha256/size, and announced by a visible room `artifact` message, `room.handoff` evidence for one source remote agent handing work to a distinct target remote agent with visible request/acceptance/completion messages and `resultStatus: "completed"`, and one `room.stopFileShutdown` runner summary showing `runnerStopReason: "shutdown_requested"`. Do not record the control token, invite token, API keys, bearer tokens, vault passphrases, private keys, raw SSE text, signed envelope bodies, message bodies from `room.message.sent`, signed ack envelopes from `room.delivery.acknowledged`, or raw command output containing those values. `soloclaw phase5 evidence-check --file <path> --json` then requires the control-plane host plus Windows PowerShell, Windows CMD, Linux, macOS, Android Termux remote targets, valid one-file room bootstrap evidence, valid `soloclaw.remote_room_service_plan` evidence with `installState: "plan_only"` for each remote target, valid idle `soloclaw.remote_room_runner_status` evidence with heartbeat and lifecycle summaries for each remote runner, a revoked-invite join rejection, revoked-agent signed-operation rejection, suspended-agent block evidence, no-broadcast fallback evidence proving the unmentioned message stayed transcript-visible, appeared in the control-host safe `room.message.sent` event summary ids, and left every remote inbox, idle-run, and delivery-status pending count at zero, control-plane event stream evidence including at least one safe `room.message.sent` summary id and safe `room.delivery.acknowledged` summary ids covering every delivery-status ack id, delivery-status evidence showing every remote agent id, at least one ack message id per remote target, and zero pending routed messages, stale-agent health detection, stale-agent recovery evidence, one valid stop-file shutdown summary, one signed agent-to-agent exchange, one visible room assignment/result transcript pair, one visible conflict/resolution transcript set, one visible room result-sync artifact registration/message pair, one visible room handoff request/acceptance/completion transcript set, and operator-visible transcript/state/health evidence for every remote agent to pass before the manual matrix can count as Phase 5 evidence. Failed JSON output includes a top-level `missingEvidence[]` list grouped by `target`, `room`, `control-plane`, or `matrix` scope, with `targetId`, `checkId`, and missing field/check names where available.

`soloclaw phase5 collection-runbook --output <path> [--force] --json` refreshes only the Markdown runbook for an existing collection workspace. It does not write or replace the base evidence file, target fragments, collector guides, or `phase5-registered-pull-operator-next.json`; use it when the runbook text needs to catch up with an already prepared workspace.

`soloclaw phase5 evidence-check --file <path> --json` emits `registered-agent-pull-communication-evidence` for this path. The check fails when `room.registeredAgentPull` is missing or does not show registration, invitation listing, acceptance, routed task handling, signed ack, valid signed reply, idle heartbeat, idle stop, zero pending delivery evidence, or an `agentId` that belongs to the declared registered-pull `targetId`.

When a registered-pull target is selected, `soloclaw phase5 collector-guide --target control-plane-host --registered-pull-target <remote-target-id> --json` includes `registeredPullControlHostRunbook` for the control-plane operator. That runbook mirrors the selected remote guide from the control side: wait for `remote register`, run `room pull-agent`, wait for remote invitation acceptance, send the routed task, check delivery status, inspect transcript/runner summaries, and copy only paste-safe fields into the control-plane fragment's `room.registeredAgentPull`. The selected remote guide's `registeredPullRunbook` and the control-host runbook both carry token-safe `commandHint` fields; hints use placeholders and `AGENT_CONTROL_TOKEN` environment-variable references, not raw tokens or `<control-token>`. They also carry `evidenceFieldHints[]`, mapping each paste-safe `room.registeredAgentPull.*` field to the collection source, runbook stage, and command name; guide text and generated Markdown render those mappings as `Registered-agent pull evidence field hints`. Remote target hints use `$env:AGENT_CONTROL_TOKEN` for Windows PowerShell, `%AGENT_CONTROL_TOKEN%` for Windows CMD, and `$AGENT_CONTROL_TOKEN` for Linux, macOS, and Android Termux. The control-host hints are surfaced through `collection-runbook` and `evidence-status` `nextRoomEvidence[]` when the room evidence is incomplete; text-mode `collection-runbook` and its generated Markdown include target-scoped operator command blocks for the selected remote and `control-plane-host`, and text-mode `evidence-status` expands room stages under the `registered-agent-pull stages` heading plus prioritized `registered-agent-pull field hints` so a console operator can resume the pull/run/capture sequence without opening JSON. `evidence-status --json` also exposes `registeredPullOperatorNext`, a top-level resume object that combines the selected target command block, the control-host command block, missing fields, field hints, merge command, and final-check command for control-host automation. When `collection-prepare --registered-pull-target <remote-target-id>` writes the workspace, it also writes `phase5-registered-pull-operator-next.json` with the same selected-target/control-host `registeredPullOperatorNext` shape and reports it as `registeredPullOperatorNextFile`; text output prints `registeredPullOperatorNext=phase5-registered-pull-operator-next.json` so a console-only control host can hand the machine-readable pull plan to automation. When the collection workspace already exists, `soloclaw phase5 registered-pull-operator-next --registered-pull-target <remote-target-id> --json` writes only that same standalone handoff file and leaves evidence templates, fragments, guides, and runbooks untouched. When the selected target has produced the registered-pull runner status, `soloclaw phase5 registered-pull-evidence-patch --registered-pull-target <remote-target-id> --status-file .agent/tmp/phase5-registered-pull-status.json --pull-agent-file pull-agent.json --invitations-file invitations.json --accept-room-file accept-room.json --room-show-file room-show.json --delivery-status-file delivery-status.json --json` reads only whitelisted status summary fields, optional command JSON summaries, transcript/delivery summaries, and control-host summary arguments such as task/reply ids and delivery pending count, reports `missingFields`, and optionally writes only the patch file with `--output`. The selected remote hints are written into that target's JSON and Markdown collector guides, and both the selected remote guide and the control-plane-host guide expose an `operatorNextCommands[]` sequence plus a generated Markdown `## Operator Next Commands` block with the template, runbook hints, preflight, status, merge, and final-check commands in operator order. `collection-runbook --json`, `collector-pack --json`, and `collection-prepare --json` copy that sequence onto the selected remote and control-plane-host rows, so a control-host distribution script can route the commands without parsing Markdown. The selected target's `evidence-status --target <remote-target-id> --registered-pull-target <remote-target-id>` output includes the same remote `registeredPullRunbook` under `nextTargetEvidence[]` with text-mode `remote registered-agent-pull stages` and field hints. If `--include-smoke-commands` is used for execution handoffs, the control-plane-host guide keeps the registered-pull `room pull-agent` and routed-task commands; only non-selected remote guides omit registered-pull-only commands.

The registered-pull collection surfaces expose the same file-handoff contract for automation: `collection-runbook --json` publishes top-level `registeredPullEvidenceFileHandoff`, the selected remote and control-plane-host guide rows carry `evidenceFileHandoff`, `collector-guide` JSON/text/Markdown and `collector-pack` JSON/generated Markdown render the same checklist, and `registered-pull-operator-next` includes it beside the operator command sequence. The checklist names the selected target status file, control-host command captures, `registered-pull-evidence-patch` inputs, patch output path, and final `room.registeredAgentPull` paste location without copying tokens or raw command logs.

Failed JSON output also includes `summary.missingEvidenceByScope` counts for `matrix`, `target`, `room`, and `controlPlane`, which lets collection scripts decide whether to request more host fragments or a refreshed control-plane room fragment.

When `soloclaw phase5 evidence-merge --output <merged.json> --json` writes a merged file, its JSON response includes `collectionStatus` with one row per required target, including target role, evidence status, whether the row was merged in that run, and the source fragment path when available. It also includes `finalEvidenceCheck` with the final gate status, missing-evidence count, and the same scope counters for that output file. Treat both as merge-time triage; the explicit `phase5 evidence-check --file <merged.json> --json` run remains the final acceptance command.

Use `soloclaw phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --json` on the control host while fragments are arriving. It tolerates a missing or empty fragment directory, reads first-level `.json` fragments that are present, reports invalid JSON or structurally invalid fragments under `fragmentErrors[]`, and still preserves progress from the valid fragments in `collectionStatus`, `roomStatus`, remaining target ids, and token-safe next commands. `collectionStatus.mergedCount` counts fragment files read in the current status pass, while `collectionStatus.passedCount` and `collectionStatus.pendingCount` count required targets whose evidence has or has not passed, so a directory full of untouched templates is visible as merged but still pending. It does not write `phase5-evidence.merged.json`. Its JSON also includes `finalEvidenceCheck`, the same token-safe final gate summary used by merge output: gate status, missing-evidence count, and missing counts by `matrix`, `target`, `room`, and `controlPlane` scope for the current valid in-memory merge. JSON and text output also include `nextEvidenceScopes[]`, a token-safe triage list derived from the final gate's missing evidence with per-scope counts, related check ids, safe target ids when applicable, and guidance such as collecting target fragments first or refreshing the control-plane-host room fragment. When `room.registeredAgentPull` is missing or incomplete and a registered-pull target is known, they include `nextRoomEvidence[]` with a `registered-agent-pull` item: current missing fields, selected target/control fragment paths, selected target/control guide commands, control-plane template/preflight/status commands, merge/final-check commands, `evidenceFieldHints[]` with the missing fields sorted first, and the same control-host runbook used by `collection-runbook`; text output expands that runbook into readable stage lines with token-safe `commandHint` values plus field-hint lines, and those room commands are also promoted to the front of global `nextCommands[]` before the broader collection/merge commands. The same incomplete room item is summarized as top-level `registeredPullOperatorNext`, which carries separate `controlHost.operatorNextCommands[]` and `selectedTarget.operatorNextCommands[]` arrays plus missing fields and field hints so automation can resume both sides of the pull sequence without joining several status arrays. They also include `nextTargetEvidence[]`, which groups target-scoped final-gate gaps by required machine with role, current fragment status/source path, fragment path, missing check ids, missing field names, that target's `templateCommand` for regenerating the fragment template, `statusCommand` for rechecking the same operator-facing view, preflight command, `collectorGuideCommand` for regenerating the target handoff with the active registered-pull selection, and `returnToControlHost` copy/merge/final-check commands matching the collector-guide handoff. When the row is the selected registered-pull target, `nextTargetEvidence[]` also carries the remote `registeredPullRunbook`, and text output expands it as `remote registered-agent-pull stages` and field hints so that operator can run register, invitation list, accept-room, remote-run, and status-file inspection from the target-filtered status view. Add `--target <target-id>` to filter the operator-facing `nextEvidenceScopes[]`, `nextTargetEvidence[]`, optional `missingEvidence[]`, and target preflight command list to one machine while leaving `finalEvidenceCheck` as the full-matrix gate summary; the target-filtered `nextCommands[]` starts with that machine's `collector-guide` command, then its `evidence-template` command. When the target is the selected registered-pull machine, it inserts the remote runbook's token-safe `commandHint` lines before the target preflight; when the target is `control-plane-host`, it inserts the control-host registered-pull command hints before the control-plane preflight. Add `--include-missing-evidence` when you need the full token-safe `missingEvidence[]` list from that in-memory final gate, with scope, target id where applicable, check id, and missing field names, without writing a merged evidence file. If you pass `--registered-pull-target <target-id>` only to steer the suggested control-host next commands and per-target template/status/guide commands, the JSON includes `registeredPullTargetOverride` whenever that requested target differs from the evidence file's current `room.registeredAgentPull.targetId`; `roomStatus` still reflects the evidence file and `registeredPullTargetOverride.evidenceUnchanged` remains `true`. That override includes guidance plus `reconcileCommands.refreshScaffoldBeforeCollection` for an intentional `collection-prepare --force` refresh before collection, and `reconcileCommands.updateControlPlaneFragment` for regenerating the control-plane room fragment target fields after collecting real evidence. Treat it as a progress view; invalid fragments must still be fixed or removed before strict `evidence-merge --target-dir` and the explicit full `phase5 evidence-check --file <merged.json> --json` acceptance gate.

Current boundary: `soloclaw phase5 verify --json` is a local room smoke, not real multi-machine evidence. `phase5 evidence-status` should remain incomplete until real control-host and per-target fragments are filled from the Windows PowerShell/CMD, Linux, macOS, and Android Termux collection runs; untouched template fragments, generated collector guides, and generated runbooks are scaffolding only and do not count as completed evidence.

`room.keyRotation` evidence records the selected target/agent id, previous and rotated `SHA256:` fingerprints, `trustStatusAfter: "trusted"`, `rotationRecorded: true`, `oldSignedSayBlocked: true`, `newSignedSayAccepted: true`, `auditEventVisible: true`, the visible replacement-key message id, a short old-signature rejection summary, and transcript event kind `chat`. The `room-key-rotation-evidence` gate fails when the fingerprints do not change, the old signed operation is not blocked, the replacement-key message is not visible, or the audit event is missing.

`remote heartbeat` submits a signed `AgentHeartbeatEnvelope` for the enrolled local agent. The local control plane verifies the Ed25519 signature against the registered public identity, rejects nonce replay, updates `lastSeenAt`, `heartbeatStatus`, `lastHeartbeatAt`, expiry, room id, and last error metadata, then audits only summary fields. `remote run` now emits these signed heartbeats at start, after polls, after transient errors, and on idle/max-cycle exits so the room console can distinguish a quiet agent from a stale or failing agent.

`agents health` is the local operator view over those heartbeat rows. It derives `online`, `idle`, `running`, `error`, `stale`, `offline`, and `unknown`, marks only trusted non-suspended live states as responsive, and groups records by machine and last room so a room console can show which remote participants are healthy before routing work to them. `agents trust <agent-id> revoked` and token-gated `POST /api/agents/:agentId/trust` update the identity trust state and audit the change; after `revoked`, `suspended`, or `expired`, the control plane rejects old signed remote message-intent, delivery-ack, and heartbeat envelopes with a 403 response instead of treating them as server errors.

For Phase 5 stale-agent evidence, use a joined remote identity, submit `remote heartbeat --ttl 1`, wait until the expiry has passed, then run `agents health --now <stale-health-check-now-iso> --json` from the control workspace. The paste-safe health evidence belongs under `room.staleAgent`, and the evidence gate reports it as `stale-agent-health-detected`. Then run `agents recover-stale --now <stale-health-check-now-iso> --json` from an actor with `room.member.status`; record the paste-safe `room.staleRecovery` summary showing the agent recovered with `memberStatusAfter: "suspended"` and `healthStateAfter: "offline"`.

Agent room messages can be signed and verified locally:

```text
agent rooms verify <room-id>
```

Current signing scope:

- local agent messages are signed with Ed25519;
- remote `say` messages include a signed message-intent envelope before the control plane persists the room message;
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
soloclaw room invite-agent <room-id> --control-url <url> --control-token <token> --alias builder --json > room-invite.json
soloclaw room join --invite-bundle room-invite.json --json
soloclaw room join --invite-bundle room-invite.json --run --status-file .agent/tmp/remote-room-status.json --stop-file .agent/tmp/remote-room.stop --reply-template "@owner handled {messageId}" --json
agent remote inbox --control-url <url> --control-token <token> --room <room-id> --json
agent remote say --control-url <url> --control-token <token> --room <room-id> [--kind chat|task|decision|tool_request|approval|artifact|system] <message>
agent remote ack --control-url <url> --control-token <token> --room <room-id> --message-id <message-id>
agent remote poll --control-url <url> --control-token <token> --room <room-id> --limit <n> --idle-limit <n>
agent remote heartbeat --control-url <url> --control-token <token> --room <room-id> --status online --ttl <seconds>
agent remote run --control-url <url> --control-token <token> --room <room-id> --cycles <n> --stop-when-idle --heartbeat-ttl <seconds> --status-file .agent/tmp/remote-room-status.json --stop-file .agent/tmp/remote-room.stop --reply-template "@owner handled {messageId}"
soloclaw phase5 verify --json
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
agent rooms create --local-agent --join-policy invite_token --require-signed-invites "signed admission"
soloclaw room invite-agent room_xxxxxxxx --control-url http://127.0.0.1:4317 --control-token <token> --alias builder --display-name builder --json > room-invite.json
soloclaw room join --invite-bundle room-invite.json --json
soloclaw room join --invite-bundle room-invite.json --run --status-file .agent/tmp/remote-room-status.json --stop-file .agent/tmp/remote-room.stop --reply-template "@owner handled {messageId}" --json
agent remote inbox --control-url http://127.0.0.1:4317 --control-token <token> --room room_xxxxxxxx --json
agent remote say --control-url http://127.0.0.1:4317 --control-token <token> --room room_xxxxxxxx "@owner hello from this machine"
agent remote ack --control-url http://127.0.0.1:4317 --control-token <token> --room room_xxxxxxxx
agent remote poll --control-url http://127.0.0.1:4317 --control-token <token> --room room_xxxxxxxx --limit 5 --idle-limit 1
agent remote heartbeat --control-url http://127.0.0.1:4317 --control-token <token> --room room_xxxxxxxx --status online --ttl 60
agent remote run --control-url http://127.0.0.1:4317 --control-token <token> --room room_xxxxxxxx --cycles 100 --stop-when-idle --idle-cycles 3 --heartbeat-ttl 60 --status-file .agent/tmp/remote-room-status.json --stop-file .agent/tmp/remote-room.stop --reply-template "@owner handled {messageId}"
soloclaw phase5 verify --json
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
- `soloclaw room invite-agent` and `soloclaw room join` provide the one-file cross-machine bootstrap path over the existing signed invite/enroll/heartbeat contracts, with `agent rooms invite-bundle` and `agent remote join-bundle` remaining as lower-level equivalents;
- `agent remote inbox`, `agent remote say`, `agent remote ack`, `agent remote poll`, `agent remote heartbeat`, `agent remote service`, and `agent remote run` expose the same routed wake-up, transcript reply, signed message-intent, signed acknowledgement, signed template reply smoke, signed health path, token-safe plan-only service supervision metadata, workspace-local `--status-file` runner summary, and workspace-local `--stop-file` graceful shutdown control for an enrolled agent running from another working directory or machine;
- `soloclaw phase5 verify --json` proves the local HTTP control-plane path end to end with two remote-agent workspaces in one room, including signed invite enrollment, one-file invite-bundle bootstrap with idle runner status-file evidence, registered-agent pull communication with invitation listing/acceptance plus signed ack/reply evidence, Web invite-bundle signature/leak probing, revoked-invite rejection, local key-rotation smoke with old-signature rejection and replacement-key transcript/audit visibility, suspended-agent routing/send denial, stale-agent health detection and recovery, routed delivery, route isolation, no broadcast fallback execution for unmentioned `mentions_only` chat, signed ack/heartbeat, streamed room-scoped `control_plane.action` events and safe `room.message.sent` message summaries from `/api/events?room=<room-id>`, signed remote message-intent reply metadata, local `room-assignment-result` transcript evidence for a completed delegation assigned to an enrolled remote agent, a signed agent-to-agent routed exchange, local `room-handoff` request/acceptance/completion evidence between two enrolled remote agents, operator-visible transcript and agent-health evidence, and secret-shaped leak scanning;
- `soloclaw phase5 matrix-template --json` prints the control-plane and Windows PowerShell/CMD, Linux, macOS, and Android Termux remote-agent smoke matrix, including `/api/events?room=<room-id>` stream probe commands, revoked-invite probe commands, revoked-agent trust commands plus old signed say/ack/heartbeat rejection probes, suspended-agent status/probe commands, no-broadcast fallback transcript-only chat plus matching control-host `eventStreamRoomMessageIds` capture and remote inbox/idle-run probes, stale-agent `remote heartbeat --ttl 1` plus `agents health --now` and `agents recover-stale --now` commands, token-safe `remote service` plan commands, `delegate --room --assigned-agent` assignment/result transcript commands, remote artifact conflict probes plus a control-host decision resolution, a remote result-file probe copied back to the control workspace and registered with `artifacts add --room`, remote-to-remote handoff request/acceptance/completion commands, `remote say`, reply-target placeholders, and platform-specific stop-marker commands for real agent-to-agent and stop-file shutdown evidence, that should be filled with real-machine evidence before declaring Phase 5 closed;
- `soloclaw phase5 collection-runbook --json` prints the token-safe control-host sequence for initializing the collection, writing per-target guides, monitoring fragments, merging `phase5-fragments/`, and running the final full evidence-check gate; add `--output <path>` to write only the Markdown runbook for an existing workspace, with `--force` required for replacement;
- `soloclaw phase5 collection-prepare --json` writes the default token-safe control-host collection workspace, including `phase5-evidence.json`, six fragment templates under `phase5-fragments/`, six per-target guides under `phase5-collector-guides/`, and `phase5-collection-runbook.md`, refusing existing files unless `--force` is passed;
- registered-pull runbook, guide, pack, and operator-next outputs share the same token-safe `evidenceFileHandoff` checklist for the selected target status file, control-host captures, patch inputs/output, and final `room.registeredAgentPull` paste location;
- `soloclaw phase5 evidence-template --json`, `soloclaw phase5 evidence-template --target <target-id> --json`, `soloclaw phase5 evidence-check --file <fragment.json> --target <target-id> --json`, `soloclaw phase5 evidence-merge --file <base.json> --target-file <fragment.json> --output <merged.json> --json`, and `soloclaw phase5 evidence-check --file <path> --json` provide the paste-safe evidence format and gate for those real-machine results, including control-plane-host event-stream/operator-visibility plus shared room/global preflight, per-target `one-file-room-bootstrap-evidence`, `room.registeredAgentPull`, `room.revokedInvite`, `room.revokedAgent`, `room.suspendedAgent`, `room.noBroadcastFallback`, `room.staleAgent`, `room.staleRecovery`, `room.peerExchange`, `room.assignmentResult`, `room.conflictResolution`, `room.resultSync`, `room.handoff`, `room.stopFileShutdown`, per-target `remote-service-plan-evidence`, per-target runner last-heartbeat/lifecycle summaries, plus control-plane event stream evidence, transcript, `/api/state` room, and `/api/agents/health` visibility for every remote agent;
- `agent agents rotate-key` and `POST /api/agents/:agentId/rotate-key` provide the local key-rotation smoke path for remote identities; Phase 5 evidence now gates one paste-safe `room.keyRotation` summary with changed fingerprints, old signed say rejection, replacement-key message visibility, and control-plane audit visibility;
- room role capability checks gate invite creation, join approval, message sending, and room-scoped tool approval decisions;
- observers can be represented as read-only room members;
- `agent delegate --room <room-id>` records subtask assignment and result events in the room transcript, and Phase 5 evidence now gates one paste-safe `room.assignmentResult` summary against a joined remote agent id;
- `agent artifacts add <path> --room <room-id>` registers a copied remote result file as a room-scoped artifact, and Phase 5 evidence now gates one paste-safe `room.resultSync` summary with artifact id, sha256, size, room binding, and visible `artifact` transcript message;
- `agent remote say --kind task|decision` can record a remote-to-remote handoff in the room transcript, and Phase 5 evidence now gates one paste-safe `room.handoff` summary with distinct source/target agents and visible request, acceptance, and completion message ids;
- local agent identity is generated and registered automatically; default room delegation uses that agent id;
- `agent web` starts a local room console showing rooms, invites, members, aliases, transcripts, selected-room delivery status, derived agent health, pending approvals, and recent sessions. The console can generate sensitive one-file remote invite bundles for the selected room, send room messages, revoke active invites, edit member aliases/roles/statuses, approve/deny pending approval requests, and pause/resume/cancel sessions through the local control plane API. Its control actor field defaults to `user:local-user` and can be set to another authorized active room member for local operations.

Next production steps:

- `soloclaw room` convenience commands over the current `rooms` and `remote` flows;
- real Windows, Linux, macOS, and Android Termux soak evidence using the `phase5 matrix-template` commands against one shared control-plane room, including at least one stale-agent health probe, one remote key-rotation probe, and one remote agent-to-agent exchange recorded through `phase5 evidence-template` and checked with `phase5 evidence-check`;
- production daemon lifecycle for remote room runners, including authenticated daemon sessions, logs, durable service shutdown, resume, and OS service installation beyond the current `plan_only` service metadata;
- authenticated control-plane sessions instead of local development tokens;
- production-grade real-time room event streaming for Web/TUI and daemon consumers beyond the current local `/api/events` control-plane action and safe room-message summary stream;
- user identity keys and signed human approvals;
- quorum approval;
- distributed room-linked sub-agent delegation;
- authenticated, real-time room Web UI with signed approval envelopes.



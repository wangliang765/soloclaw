# Security Threat Model

Security is a primary design concern. The agent runs code, reads repositories, calls models, stores long-term traces, and may coordinate across machines.

This document lists threats and controls. The engineering-grade safety boundary, capability taxonomy, approval rules, and phase acceptance gates are defined in `docs/security-boundaries.md`.

## Key Threats

### Prompt Injection from Repositories

Risk:

```text
malicious README/test/log tells agent to leak secrets or bypass policy
```

Controls:

```text
treat repo content as untrusted data
scan retrieved knowledge for prompt-injection patterns before context packing
allow high-risk retrieved chunks to be annotated or excluded
never let repo text override system policy
separate instructions from evidence
require policy checks for tool calls
redact before model context
```

### Secret Exfiltration

Risk:

```text
tool output, command logs, room messages, plugins, or model prompts leak secrets
```

Controls:

```text
PolicySecretBroker gate for secret.read
short-lived leases
secret.accessed / secret.denied audit events without raw values
model --api-key-secret resolution through broker
redaction pipeline
deny direct .env reads by default
artifact scanning
audit secret access
```

### Forged Agent Messages

Risk:

```text
malicious machine impersonates trusted agent
```

Controls:

```text
agent keypair
fingerprint verification
recompute fingerprints from public keys during enrollment
reject same-agent public-key takeover without a signed key-rotation flow
signed heartbeats
signed room messages
signed agent heartbeat envelopes
agent heartbeat nonce replay rejection
revocation list
capability grants
```

### Room Routing Abuse

Risk:

```text
malicious sender tampers with mention targets, wakes too many agents with broad routing, or hides a task by changing routing metadata
malicious member registers a confusing alias to spoof another agent or hijack @mentions
ambiguous alias state causes the wrong agent to act on a task
mention spam or accidental broadcast wakes excessive agents and overloads model/tool budgets
malicious participant advances another agent's delivery cursor so routed work is skipped
malicious relay replays a previously valid agent acknowledgement to fake fresh handling
leaked or stale invite token admits an unintended agent after trust changes
```

Controls:

```text
include routing envelopes in room message signatures
store routing as structured data, not only raw text
require room.message.send capability before sending
prefer mentions_only in large rooms
default professional rooms to mentions_only and require explicit opt-in for broadcast behavior
keep aliases room-scoped, unique, case-insensitive, and separate from immutable actor ids
reject alias collisions with existing aliases, actor ids, and reserved route words
store resolved actor targets in signed routing envelopes, not mutable alias references
leave ambiguous aliases unresolved instead of waking an arbitrary agent
gate @all and role-wide routes with room policy and room.route.broadcast
cap routed active-agent target counts per room
rate-limit @all and role-wide routes in production
do not let priority metadata, digest subscriptions, or passive transcript membership trigger execution by themselves
audit routed targets, alias changes, and unresolved mentions
require target-agent identity or room.delivery.ack capability before cursor acknowledgement
require signed target-agent ack envelopes for cross-machine self-ack
record ack nonces and reject replay within the configured replay window
separate delegated owner/moderator cursor advancement from target-agent signed acknowledgement
audit cursor acknowledgement actor, target agent, and message id
gate role changes separately from status changes
reject member governance changes that leave no active room owner
audit role/status before-and-after values with immutable target actor ids
store invite tokens by hash only
sign local-agent-issued invite envelopes over immutable metadata without raw tokens
verify invite envelope signatures before trusting replicated invite metadata
allow authorized invite revocation and reject revoked token joins
audit invite revocation with immutable invite id and previous status
propagate invite revocation through the distributed control plane in production
```

### Android Phone Automation and Commerce

Risk:

```text
agent overclaims Android control from Termux and attempts to operate arbitrary third-party Apps
agent uses Accessibility, ADB, Shizuku, root, or device-owner power without clear consent
agent places orders, confirms payments, bypasses CAPTCHA/security prompts, or automates accounts without human confirmation
third-party App UI changes cause the agent to click the wrong control or leak personal data
mobile automation hides irreversible actions from the user or from audit trails
```

Controls:

```text
define Android Termux as a CLI/TUI room-agent target, not a general phone-control target
define Android native app work first as companion UI for rooms, notifications, approvals, and guided actions
do not make broad third-party App UI automation a default product milestone
require explicit opt-in, visible user consent, audit events, and narrow scopes for any mobile UI automation integration
keep final payment, checkout, account-security, CAPTCHA, and irreversible commerce confirmation with the user unless a compliant first-party API and human approval flow exist
prefer official APIs, deep links, and user-guided flows over screen scraping or blind tapping
separate recommendation/preparation from purchase/payment confirmation
block hidden background automation of sensitive Apps by default
```

### Forged Or Stale Worker Heartbeats

Risk:

```text
malicious or crashed worker remains visible as healthy and receives tasks
```

Controls:

```text
agent identity authentication
signed heartbeat envelope
signed task lease envelope
heartbeat nonce cache
expired heartbeat nonce cleanup
short heartbeat TTL
drain/offline states
task leases tied to worker id
nonce replay protection for distributed leases
stale-worker recovery
audit worker registration and heartbeat
```

### Forged Or Stale Agent Heartbeats

Risk:

```text
malicious actor marks a remote agent online, hides stale/failing state, or replays an old heartbeat to keep an agent trusted in a room
```

Controls:

```text
registered agent public identity
signed agent heartbeat envelope
heartbeat actor must be the target agent
machine id must match the registered identity
heartbeat nonce cache
short heartbeat TTL
stale-agent recovery in production
audit heartbeat summary without private keys or raw secrets
```

### Malicious Plugins

Risk:

```text
plugin reads files, runs shell, or exfiltrates data beyond its purpose
```

Controls:

```text
plugin manifest permissions
sandboxed execution
network policy
capability grants
plugin audit events
plugin output redaction
```

### Unsafe Code Execution

Risk:

```text
tests or install scripts execute hostile code
```

Controls:

```text
execution mode policy
container sandbox for high-risk tasks
network restrictions
approval for dependency install
timeout and resource limits
```

### Permission Escalation

Risk:

```text
agent obtains an overly broad grant or reuses a stale approval to bypass project policy
```

Controls:

```text
scope every grant to organization/project/room/session
keep strict mode approval-only
require agent.super_approve for critical-risk bypass
audit grant creation and approval decisions
expire temporary grants
```

### Cross-Tenant Knowledge Leakage

Risk:

```text
retrieval returns another project, organization, user, agent, or room's private knowledge
```

Controls:

```text
filter knowledge ACLs before scoring, ranking, and context packing
require knowledge.read capability for organization/project/repository scopes
allow room knowledge only to active room members or explicit room grants
record filtered counts in search audit metadata
include permission-leak cases in retrieval eval suites
```

### Exposed Control Plane

Risk:

```text
local web API is bound to a network interface or token leaks through logs/history/referrers
```

Controls:

```text
bind to 127.0.0.1 by default
require x-agent-control-token or explicit token query
do not treat local token as production auth
audit mutating control-plane actions
add CSRF and real auth before team deployment
```

### Race Conditions Across Agents

Risk:

```text
multiple agents edit the same file or push conflicting branches
multiple workers claim the same task/session lease
```

Controls:

```text
file-level write lock
single active assignment lease per target
branch/worktree isolation
workspace lease
patch conflict detection
```

### Retention and Deletion Abuse

Risk:

```text
user or agent deletes sessions, artifacts, or audit rows to hide unsafe behavior
```

Controls:

```text
project-level retention policy
deletion audit events
soft-delete artifact metadata
force flag for local admin overrides
retention-aware audit export
signed audit export bundles with event-count and canonical-event SHA-256 verification
legal hold in production
```

## Required Security Tests

Current automated suite:

```text
npm test
  -> secret redaction patterns and known-secret redaction
  -> room observer and inactive-member capability denial
  -> same-file write lock conflict and non-owner release denial
  -> SQLite-backed workspace leases coordinate same-file writers across manager instances
  -> high-risk plugin execution approval requirement
  -> scoped capability grants allow balanced actions without weakening strict or critical mode
  -> lifecycle service compacts sessions, soft-deletes artifacts, and enforces deletion policy
  -> Git PR preparation excludes .agent private files from commit candidates
  -> worker registry records registration, heartbeat, and audit events
  -> explicit worker drain records reason metadata, prevents new local polling, and completes only after active assignments are gone
  -> worker heartbeat nonce cleanup removes expired replay-window records with audit events
  -> scheduler can require valid signed worker heartbeat envelopes before polling
  -> worker runner can require valid signed task lease envelopes before execution
  -> signed task lease nonces are recorded to reject local replay and cleaned after expiry
  -> task assignments lease a session to one worker, reject duplicate active leases, and audit lease heartbeat/completion
  -> local broker claims attach task lease envelopes with assignment/worker/expiry/nonce metadata and optional Ed25519 signatures
  -> manual pause/cancel releases active session assignment leases and worker load
  -> control-plane pause/resume/cancel writes operator audit events and shares the assignment-release path
  -> expired assignment recovery releases stale worker load and can schedule bounded, delayed retry assignments on eligible workers
  -> room-scoped task assignments emit transcript lifecycle events without granting members additional room or approval capabilities
  -> local-agent-issued room invite envelopes verify across SQLite restart and fail after metadata tampering
  -> room invite revocation blocks later token joins and records audit evidence
  -> signed audit export bundles verify cleanly and fail after event or hash tampering
  -> local worker runner completes assigned sessions, keeps paused sessions leased for later continuation, and stops polling when a worker is draining
  -> scheduler tick combines stale lease recovery, optional signed heartbeat gating, optional signed lease gating, and bounded worker polling, while scheduler run can be bounded by max ticks, idle detection, or abort signals
  -> local control-plane API rejects requests without the access token
  -> plan target mode does not expose or execute tools
  -> workspace tools cannot read or modify protected .git/.agent paths outside .agent/tmp
  -> hygiene scan flags temporary/debug/test residue outside approved temp roots
```

Required expansion:

```text
prompt injection cannot bypass policy
secret values are redacted from stdout/stderr
plugins cannot access undeclared capabilities
revoked agents cannot send room messages
revoked invites cannot admit new room members
rooms can require valid signed invite envelopes before token-based activation
two agents cannot acquire write lock on same file
high-risk command requires approval in balanced mode
ordinary grants cannot bypass critical-risk prompts
retention deletion cannot remove audit evidence without an audit event
audit exports are tamper-evident after leaving the store
model context never receives raw secret values
temporary tests are deleted or promoted before completion
protected agent-private paths cannot be accessed through workspace tools
```

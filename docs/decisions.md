# Architecture Decisions

## Product Direction

The product is an MIT-licensed, privately deployable professional agent platform, not only a local CLI.

Required long-term capabilities:

- cross-platform deployment;
- distributed agents across machines;
- room-based multi-agent collaboration;
- multi-user organizations and permissions;
- GitHub/GitLab PR automation;
- long-term storage;
- configurable execution isolation and approval levels.
- delegated sub-agent sessions for subtasks.
- skills and persistent memory.
- Web UI and TUI/CLI operator surfaces should advance in parallel for the local professional alpha, sharing control-plane view models and status vocabulary.
- Desktop app can come later after the Web/TUI inspection model is stable.
- A local room Web UI should expose active rooms, joined rooms, discussions, approvals, local agent participation, worker health, specs, MCP diagnostics, and operator drilldowns.

## Model Providers

Decision: support multiple model providers from the start through provider adapters.

Default provider targets:

```text
OpenAI
Grok
Anthropic
MiniMax
DeepSeek
GLM
MiMo
OpenAI-compatible custom endpoint
Anthropic-compatible custom endpoint
```

Agent logic must depend on `ModelClient`, not provider SDKs directly.

Current local implementation uses typed provider profiles for OpenAI, Anthropic, Grok/xAI, MiniMax, DeepSeek, GLM, MiMo, OpenAI-compatible custom endpoints, and Anthropic-compatible custom endpoints. The non-Anthropic commercial providers currently run through the OpenAI-compatible chat adapter with provider-specific base URLs, default model names, and API key environment aliases. Local `.agent/model-providers.json` overrides allow operators to edit non-secret profile metadata through `agent models profiles`; production can replace individual profiles with provider-specific adapters or a tenant-scoped provider registry without changing the agent loop.

## Control Plane

Decision: build as a modular monolith first, designed with cloud-service boundaries.

Reason:

- easier private deployment;
- faster iteration;
- fewer operational requirements;
- still allows later service extraction.

Future service boundaries:

```text
api
worker
indexer
git integration
event broker
artifact service
```

## Agent Communication

Decision: start with control-plane-mediated communication, then add agent rooms.

Direct peer-to-peer is allowed later only after trust pairing and policy approval.

Sub-agent delegation should create child sessions. Rooms coordinate assignments, progress, and approvals; child sessions store detailed subtask context.

Room join methods:

```text
manual approval
invite token
public key fingerprint
admin approval
quorum approval
same organization policy
```

Humans can join rooms as speaking members or read-only observers. High-risk approvals usually require human approval, but organizations may grant super-approval capability to trusted agents.

## Execution Isolation

Decision: make isolation configurable.

Modes:

```text
strict
balanced
trusted
full_access
```

Risk levels:

```text
low
medium
high
critical
```

Effective policy is derived from organization, project, workspace, task risk, and user override.

Automation should be configurable:

```text
auto_read
auto_write_safe_files
auto_run_safe_commands
auto_create_branch
auto_commit
auto_push
auto_open_pr
auto_iterate_on_ci_failure
auto_agent_approval
```

Defaults should be conservative.

## Storage

Decision:

```text
local mode: SQLite + local artifacts
private production mode: PostgreSQL + Redis/broker + object storage
```

Long outputs and large artifacts should be stored outside hot relational tables.

Long-term data should be periodically summarized and compacted. Users can delete sessions and artifacts. Enterprise deployments need audit log export and project-level retention policies.

## Git Providers

Decision:

```text
personal mode: PAT allowed
production GitHub: GitHub App
production GitLab: OAuth application and scoped group/project tokens
```

Workers should receive short-lived credentials, not long-lived provider tokens.

## Audit and Permissions

Decision: every meaningful action is policy checked and audit logged.

This includes:

```text
agent join
room message
capability grant
tool request
tool approval
file change
command execution
PR creation/update
secret access
```

## Plugins

Decision: plugin compatibility is open. Third-party and custom plugins are supported, but plugins are not room members.

Plugins are capabilities mounted onto agents. A room can see that an agent has a capability, but the plugin itself does not speak or approve.

Plugin execution must be permission-isolated and policy checked.

## Skills and Memory

Decision: skills are packaged instructions/assets/tools selected by policy. Persistent memory is scoped, inspectable, deletable, and lower priority than system policy.

Memory scopes:

```text
user
project
repository
organization
room
agent
```

Skills and memories must be auditable when used.

# Agent Execution Standards

## Goal

Agents should be useful without leaving a messy or unsafe workspace behind. This document defines execution standards and the first mechanical guards for this project.

The broader engineering-grade security boundary, including capability taxonomy, approval boundaries, cross-machine identity, mobile limits, and phase security acceptance, is tracked in `docs/security-boundaries.md`.

These standards are informed by:

- Codex: sandbox modes, approval policy, protected paths, `AGENTS.md`, and lifecycle hooks.
- opencode: specialized agents such as Build and Plan agents, with per-agent permissions.
- Claude Code: layered settings, permission allow/deny/ask rules, hooks, read-only/default approval behavior, and managed enterprise policy.

References:

- Codex manual: https://developers.openai.com/codex/codex-manual.md
- opencode agents: https://opencode.ai/docs/agents/
- Claude Code settings: https://docs.anthropic.com/en/docs/claude-code/settings.md
- Claude Code hooks: https://docs.anthropic.com/en/docs/claude-code/hooks.md
- Claude Code security: https://docs.anthropic.com/en/docs/claude-code/security.md

## Execution Dimensions

Keep these dimensions separate:

```text
target mode      plan | build | goal
permission mode  strict | balanced | trusted | full_access
sandbox mode     read_only | workspace_write | full_access
reviewer         human | auto_reviewer | policy_only
```

Current implementation:

```text
targetMode = plan | build | goal
executionMode = strict | balanced | trusted | full_access
```

Future implementation should add first-class sandbox mode and reviewer selection.

## Market Pattern Summary

### Codex

Useful patterns:

- Sandbox and approval policy are separate controls.
- Default local work should prefer workspace write plus on-request approval.
- Read-only is the correct mode for planning or chatting without changes.
- Protected paths such as VCS and agent-private config should stay read-only.
- Hooks can run on lifecycle events such as pre-tool, post-tool, compaction, and stop.
- Repository instructions are layered through `AGENTS.md` and closer files override broader files.

Adopted here:

- `plan` mode disables tools.
- Tool policy already separates permission approval from target mode.
- `.git` and `.agent` private paths are protected from workspace tools.
- `.agent/tmp` is the allowed temporary workspace.

### opencode

Useful patterns:

- Agents can be specialized by role.
- Plan agent is for analysis/planning without changes.
- Build agent is for development with broader tools.
- Permissions can deny unselected capabilities.

Adopted here:

- `plan`, `build`, and `goal` are first-class target modes.
- Future subagents should inherit mode-specific tool capability templates.

### Claude Code

Useful patterns:

- Settings have scopes: managed, command-line, local, project, user.
- Permission rules can allow, ask, or deny specific tools and command patterns.
- Sensitive files can be excluded by deny rules.
- Hooks can block tools before execution and validate work at stop time.
- Managed settings enforce enterprise policy and cannot be overridden.
- Default security posture is read-only / permission-based, with explicit approval for edits and commands.

Adopted here:

- Protected path deny behavior for `.git` and `.agent`.
- Hygiene scan can become a Stop hook / completion gate later.
- Replacement ledger tracks the need for managed policy and hook trust.

## Workspace Hygiene Rules

### Temporary Files

Rules:

- Use `.agent/tmp/` for local temporary files created by agents.
- Delete throwaway files before finishing.
- If a temporary output is worth keeping, register it as an artifact or move it to a durable project location.
- Do not create temporary files in `src/`, `docs/`, or repository root unless the task explicitly requires it.

Current guard:

```bash
agent hygiene check
```

This flags likely temporary residue outside allowed temp folders.

### Temporary Tests

Rules:

- Temporary tests written only to reproduce an issue should be deleted after verification.
- If the test protects against a real regression, promote it into the normal test suite with a stable name.
- Do not leave files named like `*.tmp.test.ts`, `*.scratch.test.ts`, or `*.debug.spec.ts`.

Decision rule:

```text
Would a future failure of this test indicate a product regression?
  yes -> keep and polish it
  no  -> delete it before finishing
```

### Generated Artifacts

Rules:

- Large logs, screenshots, traces, and reports should be artifacts, not hot prompt context.
- Generated files should include enough metadata to know the session, actor, and purpose.
- Do not commit agent-private state, vaults, local DBs, or control tokens.

### Protected Paths

Current protected paths:

```text
.git/**
.agent/**
```

Exception:

```text
.agent/tmp/**
```

Workspace tools cannot read or write protected paths except the temporary area. Shell commands that touch `.git` or `.agent` are treated as high risk and route through policy.

Spec-driven development files are deliberately outside this private runtime boundary:

```text
.specify/**
```

`.specify` is project content, not agent-private state. Agents may read or write it only through explicit spec workflows, normal workspace locks, policy checks, audit events, and retention rules.

## Command Hygiene

High-risk command categories:

```text
destructive delete
git reset / git clean
dependency install
network fetch
permission change
protected path access
secret or credential probing
```

Rules:

- Use explicit commands, not broad shell globs.
- Prefer project scripts over ad hoc command chains.
- Keep command output bounded and redacted.
- Do not pipe untrusted remote content into shells.
- Network commands require approval unless explicitly permitted by policy.

## Completion Hygiene

Before finishing a `build` or `goal` session, the agent should know:

```text
what changed
what was verified
what temporary files remain
what tests were temporary vs permanent
what risks or follow-ups remain
```

Current manual command:

```bash
agent hygiene check
```

Future Stop hook:

```text
Stop
  -> scan temp/test residue
  -> scan protected path changes
  -> check required verification evidence
  -> block final answer or feed findings back to agent
```

## Configuration Roadmap

Add layered configuration similar to mature agent tools:

```text
managed policy
  > command-line flags
  > local project config
  > project config
  > user config
```

Suggested files:

```text
.agent/config.json
.agent/config.local.json
.agent/policy.json
.agent/hooks.json
~/.agent/config.json
enterprise managed policy
```

Policy examples:

```json
{
  "workspace": {
    "allowedTempRoots": [".agent/tmp"],
    "protectedPaths": [".git/**", ".agent/**", "!.agent/tmp/**"]
  },
  "hygiene": {
    "warnTemporaryTests": true,
    "blockOnTemporaryResidue": false
  },
  "commands": {
    "deny": ["curl * | sh", "rm -rf *"],
    "ask": ["npm install *", "git clean *"]
  }
}
```

## Implementation Status

Implemented now:

- `targetMode = plan|build|goal` on sessions.
- Plan mode disables tools.
- Protected `.git` / `.agent` workspace-tool access, with `.agent/tmp` exception.
- Shell commands touching `.git` / `.agent` are high risk.
- `agent hygiene check` reports temporary/debug/test residue.

Next:

- Map every new execution capability to `docs/security-boundaries.md` before implementation.
- Configurable protected paths and allowed temp roots.
- Stop hook integration.
- PreToolUse/PostToolUse hook API.
- Managed policy layer.
- Command allow/ask/deny pattern engine.
- Required verification gates per project.

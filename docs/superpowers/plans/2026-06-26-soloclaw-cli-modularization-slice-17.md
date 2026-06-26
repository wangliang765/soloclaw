# Soloclaw CLI Modularization Slice 17 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving top-level `approve` / `deny` into the focused session command module while preserving scoped approval policy, MCP continuation, approved-tool auto replay, auto-resume, queued worker resume, output text, error handling, and store cleanup.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Extend `src/cli/commands/session.ts` with `createApprovalDecisionCommand(deps)` and register it from `src/cli/index.ts`. The entrypoint still injects the existing approval argument parser, local platform factory, scoped decision helper, MCP approved execution factory, workspace/plugin tool factories, replay service, and local actor behavior. This slice removes the direct `if (command === "approve" || command === "deny")` branch from `main()` without changing approval store methods, policy/capability checks, MCP execution internals, room messages, audit recording, task broker behavior, or agent resume behavior.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing approval store, existing policy/room/org approval helper, existing MCP execution service, existing workspace/plugin tools, no new runtime dependencies.

## Global Constraints

- Preserve top-level `agent approve <approval-id> [reason...]` and `agent deny <approval-id> [reason...]`.
- Preserve options: `--actor`, `--local-agent`, `--auto-replay`, `--auto-resume`, `--queue-resume <worker-id>`, and `--enqueue-resume <worker-id>`.
- Preserve missing approval id behavior: print `Missing approval id.` and exit 1 before opening platform state.
- Preserve mutual exclusion between `--auto-resume` and `--queue-resume`.
- Preserve MCP queue-resume denial: `--queue-resume` is only supported for session-scoped workspace/plugin tool approvals.
- Preserve decision output: `<approval-id>\t<status>\t<action>\t<decisionReason|empty>`.
- Preserve auto replay output as `{ replay: ... }`, MCP continuation output as `{ mcp: ... }`, auto-resume final answer output, and queued resume output as `queued_resume\t<assignment-id>\t<worker-id>\t<session-id>`.
- Close the store after decisions and on error paths.
- Do not alter approval store internals, scoped authorization, room transcript behavior, audit behavior, MCP execution internals, replay internals, worker queue semantics, memory, model, phase behavior, or cross-agent routing.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/session.ts`
  - Adds `createApprovalDecisionCommand(deps)` for top-level `approve` / `deny`.
- Modify: `src/__tests__/cli-session-command.test.ts`
  - Adds module tests for missing approval id, simple approve/deny decisions, mutual-exclusion errors, non-MCP auto replay wiring, queue resume, and store cleanup.
- Modify: `src/cli/index.ts`
  - Registers `createApprovalDecisionCommand` in the early router and removes the direct approve/deny branch.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Approval Decision Command Module

- [x] **Step 1: Write failing approval decision command tests**

Evidence: `npm.cmd run build` failed because `createApprovalDecisionCommand` was not exported from `src/cli/commands/session.ts`. Type inference for the new test dependencies also failed until the command dependency shape existed.

- [x] **Step 2: Implement approval decision command module**

Implemented `createApprovalDecisionCommand(deps): CommandModule<void>` with injected parser, local platform, scoped approval decision helper, MCP continuation, workspace/plugin tool creation, replay service, local agent resume, task broker queueing, text/JSON/error writers, and exit-code setter. The module closes the store in `finally`.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-session-command.test.js
```

Evidence: build and check passed; `cli-session-command.test.js` passed 28/28.

## Task 2: Route Approve/Deny Through The Early Router

- [x] **Step 1: Add approve/deny command to `buildEarlyCliCommandRouter()`**

`src/cli/index.ts` now imports and registers `createApprovalDecisionCommand` with the existing platform, decision helper, MCP, replay, workspace/plugin tool, and writer dependencies.

- [x] **Step 2: Remove the old top-level approve/deny branch**

The direct `if (command === "approve" || command === "deny")` branch was removed from `main()`. Approval decision command flow now lives in `src/cli/commands/session.ts`.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-session-command.test.js
node dist\cli\index.js approve; if ($LASTEXITCODE -eq 1) { exit 0 } else { exit 1 }
node dist\cli\index.js deny; if ($LASTEXITCODE -eq 1) { exit 0 } else { exit 1 }
```

Evidence: build passed; `cli-session-command.test.js` passed 28/28; `node dist\cli\index.js approve` and `node dist\cli\index.js deny` printed the expected missing approval id error and returned exit code 1, with wrappers exiting 0.

## Task 3: Close Slice 17

- [x] **Step 1: Record Slice 17 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 17 as the approval decision command extraction increment.

- [x] **Step 2: Run final slice verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-session-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js approve; if ($LASTEXITCODE -eq 1) { exit 0 } else { exit 1 }
node dist\cli\index.js deny; if ($LASTEXITCODE -eq 1) { exit 0 } else { exit 1 }
git diff --check
```

Evidence: build and check passed; `cli-command-router.test.js` passed 4/4; `cli-session-command.test.js` passed 28/28; `workbench-help.test.js` passed 9/9; `node dist\cli\index.js approve` and `node dist\cli\index.js deny` returned the expected exit code 1 for missing approval id and the wrappers exited 0; `git diff --check` exited 0. The approve/deny smokes emitted Node's existing experimental SQLite warning plus the expected usage error, and Git reported existing LF/CRLF normalization warnings but no diff-check failures.

## Final Acceptance Gate

Slice 17 is complete when:

- `src/cli/commands/session.ts` owns top-level `approve` / `deny` command execution.
- `src/cli/index.ts` routes `approve` / `deny` through `CommandRouter`.
- Manual decision, MCP auto replay, workspace/plugin auto replay, auto-resume, queue-resume, usage errors, and store cleanup are preserved.
- Build, check, focused router/session/workbench tests, CLI missing-approval-id smokes, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates the complete approval decision branch and does not split auto replay/resume semantics away from the user command that owns them.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createApprovalDecisionCommand` returns `CommandModule<void>` and receives existing approval decision dependencies through injection.
- Phase boundary: No phase verifier, room protocol, remote runner, model provider, memory, policy decision semantics, approval audit semantics, MCP continuation semantics, worker queue semantics, or cross-agent behavior is intentionally changed.

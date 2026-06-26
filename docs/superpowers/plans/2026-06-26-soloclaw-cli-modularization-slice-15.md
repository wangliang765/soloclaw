# Soloclaw CLI Modularization Slice 15 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the read-only top-level `approvals` command into the focused session command module while preserving approval status filtering, tab-delimited output, error handling, and store cleanup.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Extend `src/cli/commands/session.ts` with `createApprovalsCommand(deps)` and register it from `src/cli/index.ts`. The entrypoint still injects the local platform factory and writers. This slice removes only the direct `if (command === "approvals")` branch from `main()`; `approve`, `deny`, and `replay` remain in `src/cli/index.ts` for later slices because they trigger policy checks, MCP continuation, tool replay, auto-resume, and worker queue behavior.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing approval store, no new runtime dependencies.

## Global Constraints

- Preserve top-level `agent approvals [pending|approved|denied|expired|cancelled]`.
- Preserve output shape: `<approval-id>\t<status>\t<action>\t<createdAt>\t<toolName|->\t<reason>`.
- Preserve optional status filtering by passing the optional status to `store.listApprovalRequests`.
- Close the store after listing approvals and on error paths.
- Do not alter `approve`, `deny`, `replay`, policy decisions, approval audit, MCP continuation, tool replay, auto-resume, worker queueing, rooms, memory, model, or phase behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/session.ts`
  - Adds `createApprovalsCommand(deps)` for read-only `approvals`.
- Modify: `src/__tests__/cli-session-command.test.ts`
  - Adds module tests for status filtering, output formatting, default all-status listing, error handling, and store cleanup.
- Modify: `src/cli/index.ts`
  - Registers `createApprovalsCommand` in the early router and removes the direct `approvals` branch.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Approvals Command Module

- [x] **Step 1: Write failing approvals command tests**

Evidence: `npm.cmd run build` failed because `createApprovalsCommand` was not exported from `src/cli/commands/session.ts`.

- [x] **Step 2: Implement approvals command module**

Implemented `createApprovalsCommand(deps): CommandModule<void>` with injected local platform, approval store, text/error writers, and exit-code setter. The module closes the store in `finally`.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-session-command.test.js
```

Evidence: build passed and `cli-session-command.test.js` passed 19/19.

## Task 2: Route Approvals Through The Early Router

- [x] **Step 1: Add approvals command to `buildEarlyCliCommandRouter()`**

`src/cli/index.ts` now imports and registers `createApprovalsCommand` with the existing store dependency.

- [x] **Step 2: Remove the old top-level approvals branch**

The direct `if (command === "approvals")` branch was removed from `main()`. Read-only approvals listing now lives in `src/cli/commands/session.ts`.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-session-command.test.js
node dist\cli\index.js approvals pending
```

Evidence: build passed; `cli-session-command.test.js` passed 19/19; `node dist\cli\index.js approvals pending` exited 0 and printed current pending approval rows from the local store.

## Task 3: Close Slice 15

- [x] **Step 1: Record Slice 15 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 15 as the read-only approvals command extraction increment.

- [x] **Step 2: Run final slice verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-session-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js approvals pending
git diff --check
```

Evidence: build and check passed; `cli-command-router.test.js` passed 4/4; `cli-session-command.test.js` passed 19/19; `workbench-help.test.js` passed 9/9; `node dist\cli\index.js approvals pending` exited 0; `git diff --check` exited 0. The approvals smoke emitted Node's existing experimental SQLite warning and printed local pending approval rows; Git reported existing LF/CRLF normalization warnings but no diff-check failures.

## Final Acceptance Gate

Slice 15 is complete when:

- `src/cli/commands/session.ts` owns top-level read-only `approvals` command execution.
- `src/cli/index.ts` routes `approvals` through `CommandRouter`.
- Status filtering, output formatting, errors, and store cleanup are preserved.
- Build, check, focused router/session/workbench tests, CLI approvals smoke, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates only read-only approval listing and leaves approval decisions/replay for later slices.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createApprovalsCommand` returns `CommandModule<void>` and receives existing approval list dependencies through injection.
- Phase boundary: No phase verifier, room protocol, remote runner, model provider, memory, policy, approval decision, audit, replay, or cross-agent behavior is changed.

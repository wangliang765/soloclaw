# Soloclaw CLI Modularization Slice 11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the low-risk top-level `pause` and `cancel` session-control commands into the focused session command module while preserving assignment-release behavior, actor attribution, reason parsing, output text, error handling, and store cleanup.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Extend `src/cli/commands/session.ts` with a focused `createSessionControlCommand(deps)` module registered as `pause` with `cancel` as an alias. `src/cli/index.ts` still injects the existing workspace resolver, workspace-option stripper, local platform factory, local actor factory, and text/error writers. This slice removes the direct `if (command === "pause" || command === "cancel")` branch from `main()` without changing task services, assignment release, session lifecycle semantics, audit, policy, rooms, memory, or phase behavior.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing task service/session store, no new runtime dependencies.

## Global Constraints

- Preserve top-level `agent pause <session-id> [reason]` and `agent cancel <session-id> [reason]`.
- Preserve reason parsing from non-workspace arguments after the session id.
- Preserve output shape: `<session-id>\t<status>\t<updatedAt>\t<objective>`.
- Preserve local user actor attribution through the existing actor factory.
- Preserve store cleanup in success and error paths.
- Do not alter `resume`, approvals, replay, changes, artifacts, lifecycle services, task services, policy, approval, audit, room, memory, model, or phase behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/session.ts`
  - Adds `createSessionControlCommand(deps)` for `pause`/`cancel`.
- Modify: `src/__tests__/cli-session-command.test.ts`
  - Adds module tests for pause, cancel alias behavior, missing session ids, reason parsing, and store cleanup.
- Modify: `src/cli/index.ts`
  - Registers `createSessionControlCommand` in the early router and removes the direct `pause`/`cancel` branch.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Session Control Command Module

- [x] **Step 1: Write failing pause/cancel command tests**

Evidence: `npm.cmd run build` failed because `createSessionControlCommand` was not exported from `src/cli/commands/session.ts`.

- [x] **Step 2: Implement pause/cancel command module**

Added a small injected command module that dispatches based on `input.command`, calls `tasks.pause` or `tasks.cancel`, writes the existing tab-delimited output, and closes the platform store in `finally`.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-session-command.test.js
```

Evidence: build passed and `cli-session-command.test.js` passed 9/9.

## Task 2: Route Pause/Cancel Through The Early Router

- [x] **Step 1: Add pause/cancel command to `buildEarlyCliCommandRouter()`**

Register `createSessionControlCommand` in `src/cli/index.ts` with existing task-service dependencies.

- [x] **Step 2: Remove the old top-level pause/cancel branch**

Delete the direct `if (command === "pause" || command === "cancel")` branch from `main()`.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-session-command.test.js
```

Evidence: build passed and `cli-session-command.test.js` passed 9/9 after routing through the early router.

## Task 3: Close Slice 11

- [x] **Step 1: Record Slice 11 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 11 as the pause/cancel command extraction increment.

- [x] **Step 2: Run final slice verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-session-command.test.js
node --test dist\__tests__\workbench-help.test.js
git diff --check
```

Evidence: build and check passed; `cli-command-router.test.js` passed 4/4; `cli-session-command.test.js` passed 9/9; `workbench-help.test.js` passed 9/9; `git diff --check` exited 0.

## Final Acceptance Gate

Slice 11 is complete when:

- `src/cli/commands/session.ts` owns top-level `pause` and `cancel` command execution.
- `src/cli/index.ts` routes `pause`/`cancel` through `CommandRouter`.
- Output text, reason parsing, actor attribution, task-service calls, and store cleanup are preserved.
- Build, check, focused router/session/workbench tests, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates only the low-risk pause/cancel branch and leaves resume and approvals for later slices.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createSessionControlCommand` returns `CommandModule<void>` with `cancel` as an alias.
- Phase boundary: No phase verifier, room protocol, remote runner, model provider, memory, policy, approval, audit, or cross-agent behavior is changed.

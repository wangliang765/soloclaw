# Soloclaw CLI Modularization Slice 12 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the read-only top-level `changes` command into the focused session command module while preserving file-change listing output and optional session filtering.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Extend `src/cli/commands/session.ts` with `createChangesCommand(deps)` registered as top-level `changes`. `src/cli/index.ts` still injects the local platform factory and writer functions. This slice removes the direct `if (command === "changes")` branch from `main()` without changing file-change records, session storage, audit, policy, rooms, memory, model, artifacts, or phase behavior.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing session file-change store, no new runtime dependencies.

## Global Constraints

- Preserve top-level `agent changes [session-id]`.
- Preserve output shape: `<change-id>\t<kind>\t<createdAt>\t<path>\t<summary>`.
- Preserve optional session filtering by passing the optional session id to `store.listFileChanges`.
- Close the store after listing changes.
- Do not alter artifact lifecycle, file-change persistence, session reports, diff builders, audit, policy, rooms, memory, model, or phase behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/session.ts`
  - Adds `createChangesCommand(deps)` for `changes`.
- Modify: `src/__tests__/cli-session-command.test.ts`
  - Adds module tests for optional session filtering, output formatting, and store cleanup.
- Modify: `src/cli/index.ts`
  - Registers `createChangesCommand` in the early router and removes the direct `changes` branch.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Changes Command Module

- [x] **Step 1: Write failing changes command tests**

Evidence: `npm.cmd run build` failed because `createChangesCommand` was not exported from `src/cli/commands/session.ts`.

- [x] **Step 2: Implement changes command module**

Added a small injected command module that calls `store.listFileChanges(sessionId)`, writes each change with the existing tab-delimited format, handles errors consistently with other modules, and closes the store in `finally`.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-session-command.test.js
```

Evidence: build passed and `cli-session-command.test.js` passed 11/11.

## Task 2: Route Changes Through The Early Router

- [x] **Step 1: Add changes command to `buildEarlyCliCommandRouter()`**

Register `createChangesCommand` in `src/cli/index.ts` with the existing local platform dependency.

- [x] **Step 2: Remove the old top-level changes branch**

Delete the direct `if (command === "changes")` branch from `main()`.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-session-command.test.js
```

Evidence: build passed and `cli-session-command.test.js` passed 11/11 after routing through the early router.

## Task 3: Close Slice 12

- [x] **Step 1: Record Slice 12 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 12 as the changes command extraction increment.

- [x] **Step 2: Run final slice verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-session-command.test.js
node --test dist\__tests__\workbench-help.test.js
git diff --check
```

Evidence: build and check passed; `cli-command-router.test.js` passed 4/4; `cli-session-command.test.js` passed 11/11; `workbench-help.test.js` passed 9/9; `git diff --check` exited 0. Git reported existing LF/CRLF normalization warnings but no diff-check failures.

## Final Acceptance Gate

Slice 12 is complete when:

- `src/cli/commands/session.ts` owns top-level `changes` command execution.
- `src/cli/index.ts` routes `changes` through `CommandRouter`.
- Output formatting and optional session filtering are preserved.
- Build, check, focused router/session/workbench tests, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates only the read-only changes branch and leaves artifacts for a later lifecycle slice.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createChangesCommand` returns `CommandModule<void>`.
- Phase boundary: No phase verifier, room protocol, remote runner, model provider, memory, policy, approval, audit, or cross-agent behavior is changed.

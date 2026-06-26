# Soloclaw CLI Modularization Slice 13 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the top-level `resume` command into the focused session command module while preserving model-readiness gating, resumed final-answer output, JSON result and verification payloads, review command hints, verification exit-code behavior, and store cleanup.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Extend `src/cli/commands/session.ts` with `createResumeCommand(deps)` and register it from `src/cli/index.ts`. The entrypoint still injects the existing workspace resolver, resume parser, model-readiness builder/renderer, local platform factory, session result/verification builders, renderers, writers, and clock. This slice removes the direct `if (command === "resume")` branch from `main()` without changing `AgentLoop.resume`, session storage, model clients, policy, approval, audit, memory, rooms, remote runner, or phase behavior.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing local platform/session inspection builders, no new runtime dependencies.

## Global Constraints

- Preserve top-level `agent resume <session-id>`.
- Preserve `--json`, `--session-result`, `--verify-session`, `--require-model-ready`, model/provider options, context-compaction options, and verification flags.
- Preserve model readiness blocking before opening/resuming platform state when configuration is incomplete.
- Preserve JSON output keys for generated time, workspace, session, final answer, result, verification, and review commands.
- Preserve non-zero exit behavior when model readiness blocks or verification status is `fail`.
- Close the store after resume success and error paths.
- Do not alter approvals/replay, artifacts, session lifecycle, policy, approval, audit, room, memory, model, or phase behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/session.ts`
  - Adds `createResumeCommand(deps)` for `resume`.
- Modify: `src/__tests__/cli-session-command.test.ts`
  - Adds module tests for missing session ids, model-readiness blocking, JSON result/verification output, review command hints, and store cleanup.
- Modify: `src/cli/index.ts`
  - Registers `createResumeCommand` in the early router and removes the direct `resume` branch.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Resume Command Module

- [x] **Step 1: Write failing resume command tests**

Evidence: `npm.cmd run build` failed because `createResumeCommand` was not exported from `src/cli/commands/session.ts`.

- [x] **Step 2: Implement resume command module**

Implemented `createResumeCommand(deps): CommandModule<void>` with injected parser, model-readiness gate, local platform, agent resume method, session result/verification builders, renderers, JSON writer, error writer, exit-code setter, and clock. The module closes the session store in `finally`.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-session-command.test.js
```

Evidence: build passed and `cli-session-command.test.js` passed 14/14.

## Task 2: Route Resume Through The Early Router

- [x] **Step 1: Add resume command to `buildEarlyCliCommandRouter()`**

`src/cli/index.ts` now imports and registers `createResumeCommand` with existing resume dependencies.

- [x] **Step 2: Remove the old top-level resume branch**

The direct `if (command === "resume")` branch was removed from `main()`. Resume command flow now lives in `src/cli/commands/session.ts`.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-session-command.test.js
node dist\cli\index.js resume; if ($LASTEXITCODE -ne 1) { exit 1 }
```

Evidence: build passed; `cli-session-command.test.js` passed 14/14; `node dist\cli\index.js resume` printed `Missing session id.` and returned the expected exit code 1.

## Task 3: Close Slice 13

- [x] **Step 1: Record Slice 13 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 13 as the resume command extraction increment.

- [x] **Step 2: Run final slice verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-session-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js resume; if ($LASTEXITCODE -ne 1) { exit 1 }
git diff --check
```

Evidence: build and check passed; `cli-command-router.test.js` passed 4/4; `cli-session-command.test.js` passed 14/14; `workbench-help.test.js` passed 9/9; `node dist\cli\index.js resume` returned the expected exit code 1; `git diff --check` exited 0. The resume smoke emitted Node's existing experimental SQLite warning plus the expected `Missing session id.` error, and Git reported existing LF/CRLF normalization warnings but no diff-check failures.

## Final Acceptance Gate

Slice 13 is complete when:

- `src/cli/commands/session.ts` owns top-level `resume` command execution.
- `src/cli/index.ts` routes `resume` through `CommandRouter`.
- Model-readiness blocking, resume JSON output, session result, verification, review commands, and non-zero verification exit behavior are preserved.
- Build, check, focused router/session/workbench tests, CLI missing-session smoke, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates only the resume branch and leaves approvals/replay and artifacts for later session slices.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createResumeCommand` returns `CommandModule<void>` and receives existing resume dependencies through injection.
- Phase boundary: No phase verifier, room protocol, remote runner, model provider, memory, policy, approval, audit, or cross-agent behavior is changed.

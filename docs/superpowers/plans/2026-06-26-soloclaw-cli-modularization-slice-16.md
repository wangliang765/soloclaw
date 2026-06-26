# Soloclaw CLI Modularization Slice 16 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the top-level `replay` command into the focused session command module while preserving approved tool replay, workspace/plugin tool wiring, JSON output, missing-id behavior, and store cleanup.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Extend `src/cli/commands/session.ts` with `createReplayCommand(deps)` and register it from `src/cli/index.ts`. The entrypoint still injects the local platform factory, local actor factory, workspace tool factory, plugin tool factory, replay service, and writers. This slice removes only the direct `if (command === "replay")` branch from `main()`; `approve` and `deny` remain in `src/cli/index.ts` for later slices because they still combine policy decisions, MCP continuation, auto-replay, auto-resume, and worker queue behavior.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing workspace tools, existing plugin tools, existing approved tool replay service, no new runtime dependencies.

## Global Constraints

- Preserve top-level `agent replay <approval-id>`.
- Preserve missing approval id behavior: print `Missing approval id.` and exit 1 before opening platform state.
- Preserve tool ordering for replay: workspace tools first, plugin tools second.
- Preserve JSON output from `replayApprovedTool`.
- Close the store after replay and on error paths.
- Do not alter `approve`, `deny`, policy decisions, approval audit, MCP continuation, auto-resume, worker queueing, rooms, memory, model, phase behavior, or `replayApprovedTool` internals.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/session.ts`
  - Adds `createReplayCommand(deps)` for top-level `replay`.
- Modify: `src/__tests__/cli-session-command.test.ts`
  - Adds module tests for missing approval id, workspace/plugin tool wiring, JSON replay output, and store cleanup.
- Modify: `src/cli/index.ts`
  - Registers `createReplayCommand` in the early router and removes the direct `replay` branch.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Replay Command Module

- [x] **Step 1: Write failing replay command tests**

Evidence: `npm.cmd test -- src/__tests__/cli-session-command.test.ts` failed during build because `createReplayCommand` was not exported from `src/cli/commands/session.ts`. Type inference for the new test dependencies also failed until the command dependency shape existed.

- [x] **Step 2: Implement replay command module**

Implemented `createReplayCommand(deps): CommandModule<void>` with injected local platform, local actor, workspace tool creation, plugin tool creation, replay service, JSON/error writers, and exit-code setter. The module closes the store in `finally`.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-session-command.test.js
```

Evidence: build and check passed; `cli-session-command.test.js` passed 21/21.

## Task 2: Route Replay Through The Early Router

- [x] **Step 1: Add replay command to `buildEarlyCliCommandRouter()`**

`src/cli/index.ts` now imports and registers `createReplayCommand` with the existing workspace tool and replay dependencies.

- [x] **Step 2: Remove the old top-level replay branch**

The direct `if (command === "replay")` branch was removed from `main()`. Replay command flow now lives in `src/cli/commands/session.ts`.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-session-command.test.js
node dist\cli\index.js replay; if ($LASTEXITCODE -eq 1) { exit 0 } else { exit 1 }
```

Evidence: build passed; `cli-session-command.test.js` passed 21/21; `node dist\cli\index.js replay` printed the expected missing approval id error and returned exit code 1, with the wrapper exiting 0.

## Task 3: Close Slice 16

- [x] **Step 1: Record Slice 16 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 16 as the replay command extraction increment.

- [x] **Step 2: Run final slice verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-session-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js replay; if ($LASTEXITCODE -eq 1) { exit 0 } else { exit 1 }
git diff --check
```

Evidence: build and check passed; `cli-command-router.test.js` passed 4/4; `cli-session-command.test.js` passed 21/21; `workbench-help.test.js` passed 9/9; `node dist\cli\index.js replay` returned the expected exit code 1 for missing approval id and the wrapper exited 0; `git diff --check` exited 0. The replay smoke emitted Node's existing experimental SQLite warning plus the expected usage error, and Git reported existing LF/CRLF normalization warnings but no diff-check failures.

## Final Acceptance Gate

Slice 16 is complete when:

- `src/cli/commands/session.ts` owns top-level `replay` command execution.
- `src/cli/index.ts` routes `replay` through `CommandRouter`.
- Missing-id behavior, workspace/plugin tool ordering, JSON replay output, errors, and store cleanup are preserved.
- Build, check, focused router/session/workbench tests, CLI missing-replay-id smoke, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates only plain `replay` and leaves approval decisions plus auto replay/resume behavior for later session slices.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createReplayCommand` returns `CommandModule<void>` and receives existing replay dependencies through injection.
- Phase boundary: No phase verifier, room protocol, remote runner, model provider, memory, policy decision, approval decision, audit, MCP continuation, worker queue, or cross-agent behavior is changed.

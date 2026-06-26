# Soloclaw CLI Modularization Slice 14 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the top-level `artifacts` command group into the focused session command module while preserving artifact registration, listing filters, deletion options, actor attribution, output text, error handling, and store cleanup.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Extend `src/cli/commands/session.ts` with `createArtifactsCommand(deps)` and register it from `src/cli/index.ts`. The entrypoint still injects the existing artifact argument parser, local platform factory, lifecycle service, store, local actor factory, and writers. This slice removes the direct `if (command === "artifacts")` branch from `main()` without changing artifact records, lifecycle retention/deletion semantics, audit, policy, rooms, memory, model, or phase behavior.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing lifecycle service and artifact store, no new runtime dependencies.

## Global Constraints

- Preserve top-level `agent artifacts add <path> [--kind kind] [--name name] [--project id] [--session id] [--room id] [--uri uri]`.
- Preserve top-level `agent artifacts list [--project id] [--session id] [--status active|deleted]`.
- Preserve top-level `agent artifacts delete <artifact-id> [--delete-file] [--force]`.
- Preserve output shapes for add/list/delete.
- Preserve local user actor attribution for lifecycle mutations.
- Preserve store cleanup in success and error paths.
- Do not alter retention policy, artifact lifecycle internals, session reports, audit, policy, rooms, memory, model, or phase behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/session.ts`
  - Adds `createArtifactsCommand(deps)` for `artifacts`.
- Modify: `src/__tests__/cli-session-command.test.ts`
  - Adds module tests for list filters/output, add actor attribution/output, delete options/output, usage errors, and store cleanup.
- Modify: `src/cli/index.ts`
  - Registers `createArtifactsCommand` in the early router and removes the direct `artifacts` branch.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Artifacts Command Module

- [x] **Step 1: Write failing artifacts command tests**

Evidence: `npm.cmd run build` failed because `createArtifactsCommand` was not exported from `src/cli/commands/session.ts`.

- [x] **Step 2: Implement artifacts command module**

Implemented `createArtifactsCommand(deps): CommandModule<void>` with injected parser, local platform, artifact lifecycle, store list path, local actor factory, text/error writers, and exit-code setter. The module closes the store in `finally`.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-session-command.test.js
```

Evidence: build passed and `cli-session-command.test.js` passed 17/17.

## Task 2: Route Artifacts Through The Early Router

- [x] **Step 1: Add artifacts command to `buildEarlyCliCommandRouter()`**

`src/cli/index.ts` now imports and registers `createArtifactsCommand` with existing artifact dependencies.

- [x] **Step 2: Remove the old top-level artifacts branch**

The direct `if (command === "artifacts")` branch was removed from `main()`. Artifact command flow now lives in `src/cli/commands/session.ts`.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-session-command.test.js
node dist\cli\index.js artifacts delete; if ($LASTEXITCODE -ne 1) { exit 1 }
```

Evidence: build passed; `cli-session-command.test.js` passed 17/17; `node dist\cli\index.js artifacts delete` printed the expected usage error and returned exit code 1.

## Task 3: Close Slice 14

- [x] **Step 1: Record Slice 14 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 14 as the artifacts command extraction increment.

- [x] **Step 2: Run final slice verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-session-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js artifacts delete; if ($LASTEXITCODE -ne 1) { exit 1 }
git diff --check
```

Evidence: build and check passed; `cli-command-router.test.js` passed 4/4; `cli-session-command.test.js` passed 17/17; `workbench-help.test.js` passed 9/9; `node dist\cli\index.js artifacts delete` returned the expected exit code 1; `git diff --check` exited 0. The artifacts smoke emitted Node's existing experimental SQLite warning plus the expected usage error, and Git reported existing LF/CRLF normalization warnings but no diff-check failures.

## Final Acceptance Gate

Slice 14 is complete when:

- `src/cli/commands/session.ts` owns top-level `artifacts` command execution.
- `src/cli/index.ts` routes `artifacts` through `CommandRouter`.
- Add/list/delete output, filters, actor attribution, delete options, usage errors, and store cleanup are preserved.
- Build, check, focused router/session/workbench tests, CLI missing-artifact-id smoke, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates only the artifacts branch and leaves approvals/replay and audit for later session slices.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createArtifactsCommand` returns `CommandModule<void>` and receives existing artifact dependencies through injection.
- Phase boundary: No phase verifier, room protocol, remote runner, model provider, memory, policy, approval, audit, or cross-agent behavior is changed.

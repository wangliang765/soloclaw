# Soloclaw CLI Modularization Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the read-only `status` command execution into a focused workbench command module while preserving current text and JSON behavior.

**Architecture:** Keep `CommandRouter` as the command dispatch interface. Add `src/cli/commands/workbench.ts` with dependency injection for workspace resolution, status view building, text rendering, JSON output, error output, and exit-code setting. `src/cli/index.ts` still owns `buildSoloclawStatus` and `printSoloclawStatus`; this slice only removes the `status` command branch from `main()`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing CLI entrypoint, no new runtime dependencies.

## Global Constraints

- Preserve `soloclaw status [--workspace path] [--json]` behavior.
- Do not move status view construction or rendering functions in this slice.
- Do not alter setup, model, phase, room, memory, tool, remote runner, policy, approval, audit, or cross-agent behavior.
- Use TDD for the new command module before production module code.

---

## File Structure

- Create: `src/cli/commands/workbench.ts`
  - Owns `createStatusCommand(deps)` and the `status` command execution shell.
- Test: `src/__tests__/cli-workbench-command.test.ts`
  - Verifies text output, JSON output, workspace resolution, and error exit-code behavior using injected dependencies.
- Modify: `src/cli/index.ts`
  - Imports `createStatusCommand`, includes it in the early router, and removes the direct `status` branch from `main()`.
- Modify: `src/__tests__/workbench-help.test.ts`
  - Adds CLI smoke coverage for `status --json`.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Status Command Module

**Files:**
- Create: `src/cli/commands/workbench.ts`
- Test: `src/__tests__/cli-workbench-command.test.ts`

- [x] **Step 1: Write failing status command tests**

Evidence: `npm.cmd run build` failed because `src/cli/commands/workbench.ts` did not exist.

- [x] **Step 2: Implement status command module**

Implemented `createStatusCommand(deps): CommandModule<void>` with injected workspace resolution, status builder, renderers, error writer, and exit-code setter.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-workbench-command.test.js
```

## Task 2: Route Status Through The Early Router

**Files:**
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/workbench-help.test.ts`

- [x] **Step 1: Add status command to `buildEarlyCliCommandRouter()`**

`src/cli/index.ts` now imports `createStatusCommand` and registers it in the early `CommandRouter`.

- [x] **Step 2: Add CLI smoke for status JSON**

`src/__tests__/workbench-help.test.ts` now checks that `status --json` emits product status JSON with the existing quickstart command reference under `readiness.commands`.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-workbench-command.test.js
node --test dist\__tests__\workbench-help.test.js
node --test dist\__tests__\cli-command-router.test.js
node dist\cli\index.js status --json
```

## Task 3: Close Slice 4

- [x] **Step 1: Record Slice 4 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 4 as a small Workstream 1 increment.

- [x] **Step 2: Run final slice verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-help-command.test.js
node --test dist\__tests__\cli-quickstart-command.test.js
node --test dist\__tests__\cli-workbench-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js quickstart
node dist\cli\index.js quickstart --json
node dist\cli\index.js status --json
git diff --check
```

## Final Acceptance Gate

Slice 4 is complete when:

- `src/cli/commands/workbench.ts` exists and owns `status` command execution.
- `src/cli/index.ts` routes `status` through `CommandRouter`.
- `status --json` still behaves as before.
- Build, check, focused router/help/quickstart/workbench tests, CLI smoke commands, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates one more low-risk read-only command branch out of `main()` while keeping view construction and rendering stable.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createStatusCommand` returns `CommandModule<void>` and receives injected dependencies with stable names.
- Phase boundary: No phase verifier, model provider, memory, room, remote runner, policy, approval, audit, or cross-agent behavior is changed.

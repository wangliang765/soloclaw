# Soloclaw CLI Modularization Slice 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the read-only `doctor` / `check` readiness command execution into the workbench command module while preserving current text, JSON, alias, and exit-code behavior.

**Architecture:** Keep `CommandRouter` as the command dispatch interface. Extend `src/cli/commands/workbench.ts` with dependency injection for workspace resolution, workspace-option stripping, readiness verification, text rendering, JSON output, error output, and exit-code setting. `src/cli/index.ts` still owns `verifyPhaseOneReadiness` and `printPhaseOneReadiness`; this slice only removes the `doctor` / `check` branch from `main()`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing CLI entrypoint, no new runtime dependencies.

## Global Constraints

- Preserve `soloclaw doctor [--workspace path] [--json]` behavior.
- Preserve `soloclaw check` as an alias for `doctor`.
- Preserve the current behavior where a readiness result with `status=fail` is printed without forcing a nonzero exit code; only execution errors set exit code 1.
- Do not move readiness verification or rendering functions in this slice.
- Do not alter setup, model, phase, room, memory, tool, remote runner, policy, approval, audit, or cross-agent behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/workbench.ts`
  - Adds `createDoctorCommand(deps)` and the `doctor` / `check` command execution shell.
- Test: `src/__tests__/cli-workbench-command.test.ts`
  - Verifies text output, JSON output through the `check` alias, and error exit-code behavior using injected dependencies.
- Modify: `src/cli/index.ts`
  - Imports `createDoctorCommand`, includes it in the early router, and removes the direct `doctor` / `check` branch from `main()`.
- Modify: `src/__tests__/workbench-help.test.ts`
  - Adds CLI smoke coverage for `doctor --json`.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Doctor Command Module

- [x] **Step 1: Write failing doctor command tests**

Evidence: `npm.cmd run build` failed because `createDoctorCommand` was not exported from `src/cli/commands/workbench.ts`.

- [x] **Step 2: Implement doctor command module**

Implemented `createDoctorCommand(deps): CommandModule<void>` with injected workspace resolution, option stripping, readiness verifier, renderer, error writer, and exit-code setter.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-workbench-command.test.js
```

## Task 2: Route Doctor Through The Early Router

- [x] **Step 1: Add doctor command to `buildEarlyCliCommandRouter()`**

`src/cli/index.ts` now imports `createDoctorCommand` and registers it in the early `CommandRouter` with `check` as an alias.

- [x] **Step 2: Add CLI smoke for doctor JSON**

`src/__tests__/workbench-help.test.ts` now checks that `doctor --json` emits readiness JSON.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-workbench-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js doctor --json
```

## Task 3: Close Slice 6

- [x] **Step 1: Record Slice 6 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 6 as a small Workstream 1 increment.

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
node dist\cli\index.js doctor --json
node dist\cli\index.js status --json
node dist\cli\index.js platform doctor --json
git diff --check
```

## Final Acceptance Gate

Slice 6 is complete when:

- `src/cli/commands/workbench.ts` owns `doctor` / `check` command execution.
- `src/cli/index.ts` routes `doctor` / `check` through `CommandRouter`.
- `doctor --json` still behaves as before.
- Build, check, focused router/help/quickstart/workbench tests, CLI smoke commands, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates one more low-risk read-only command branch out of `main()` while keeping readiness verification and rendering stable.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createDoctorCommand` returns `CommandModule<void>` and receives injected dependencies with stable names.
- Phase boundary: No phase verifier, model provider, memory, room, remote runner, policy, approval, audit, or cross-agent behavior is changed.

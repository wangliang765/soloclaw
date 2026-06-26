# Soloclaw CLI Modularization Slice 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the read-only `platform doctor|check` command execution into the workbench command module while preserving current text, JSON, usage, and exit-code behavior.

**Architecture:** Keep `CommandRouter` as the command dispatch interface. Extend `src/cli/commands/workbench.ts` with dependency injection for platform capability detection, legacy-config lookup, JSON view building, text rendering, error output, and exit-code setting. `src/cli/index.ts` still owns `buildPlatformDoctorView` and `printPlatformDoctor`; this slice only removes the `platform` command branch from `main()`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing CLI entrypoint, no new runtime dependencies.

## Global Constraints

- Preserve `soloclaw platform doctor [--json]` and `soloclaw platform check [--json]` behavior.
- Preserve the existing usage error for unknown platform subcommands.
- Do not move platform view construction or rendering functions in this slice.
- Do not alter setup, model, phase, room, memory, tool, remote runner, policy, approval, audit, or cross-agent behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/workbench.ts`
  - Adds `createPlatformCommand(deps)` and the `platform` command execution shell.
- Test: `src/__tests__/cli-workbench-command.test.ts`
  - Verifies text output, JSON output, and unknown-subcommand exit behavior using injected dependencies.
- Modify: `src/cli/index.ts`
  - Imports `createPlatformCommand`, includes it in the early router, and removes the direct `platform` branch from `main()`.
- Modify: `src/__tests__/workbench-help.test.ts`
  - Adds CLI smoke coverage for `platform doctor --json`.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Platform Command Module

- [x] **Step 1: Write failing platform command tests**

Evidence: `npm.cmd run build` failed because `createPlatformCommand` was not exported from `src/cli/commands/workbench.ts`.

- [x] **Step 2: Implement platform command module**

Implemented `createPlatformCommand(deps): CommandModule<void>` with injected platform detection, legacy-config lookup, JSON view builder, renderer, error writer, and exit-code setter.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-workbench-command.test.js
```

## Task 2: Route Platform Through The Early Router

- [x] **Step 1: Add platform command to `buildEarlyCliCommandRouter()`**

`src/cli/index.ts` now imports `createPlatformCommand` and registers it in the early `CommandRouter`.

- [x] **Step 2: Add CLI smoke for platform JSON**

`src/__tests__/workbench-help.test.ts` now checks that `platform doctor --json` emits platform diagnostics JSON.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-workbench-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js platform doctor --json
```

## Task 3: Close Slice 5

- [x] **Step 1: Record Slice 5 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 5 as a small Workstream 1 increment.

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
node dist\cli\index.js platform doctor --json
git diff --check
```

## Final Acceptance Gate

Slice 5 is complete when:

- `src/cli/commands/workbench.ts` owns `platform` command execution.
- `src/cli/index.ts` routes `platform` through `CommandRouter`.
- `platform doctor --json` still behaves as before.
- Build, check, focused router/help/quickstart/workbench tests, CLI smoke commands, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates one more low-risk read-only command branch out of `main()` while keeping view construction and rendering stable.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createPlatformCommand` returns `CommandModule<void>` and receives injected dependencies with stable names.
- Phase boundary: No phase verifier, model provider, memory, room, remote runner, policy, approval, audit, or cross-agent behavior is changed.

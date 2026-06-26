# Soloclaw CLI Modularization Slice 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the read-only `inspect` command execution into the workbench command module while preserving current text and JSON behavior.

**Architecture:** Keep `CommandRouter` as the command dispatch interface. Extend `src/cli/commands/workbench.ts` with dependency injection for workspace resolution, workspace-option stripping, inspect option parsing, workspace snapshot collection, optional key-file preview collection, rendering, JSON output, error output, and exit-code setting. `src/cli/index.ts` still owns `parseInspectArgs` and imports the existing workspace snapshot helpers; this slice only removes the `inspect` branch from `main()`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing CLI entrypoint, no new runtime dependencies.

## Global Constraints

- Preserve `soloclaw inspect [--workspace path] [--json] [--include-key-files]` behavior.
- Preserve JSON fields: `generatedAt`, `root`, `snapshot`, optional `keyFilePreviews`, and `text`.
- Do not alter workspace snapshot collection, key-file preview rendering, model, phase, room, memory, tool, remote runner, policy, approval, audit, or cross-agent behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/workbench.ts`
  - Adds `createInspectCommand(deps)` and the `inspect` command execution shell.
- Test: `src/__tests__/cli-workbench-command.test.ts`
  - Verifies text output, JSON output with key-preview limit forwarding, and error exit-code behavior using injected dependencies.
- Modify: `src/cli/index.ts`
  - Imports `createInspectCommand`, includes it in the early router, and removes the direct `inspect` branch from `main()`.
- Modify: `src/__tests__/workbench-help.test.ts`
  - Adds CLI smoke coverage for `inspect --workspace <cwd> --json`.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Inspect Command Module

- [x] **Step 1: Write failing inspect command tests**

Evidence: `npm.cmd run build` failed because `createInspectCommand` was not exported from `src/cli/commands/workbench.ts`.

- [x] **Step 2: Implement inspect command module**

Implemented `createInspectCommand(deps): CommandModule<void>` with injected workspace resolution, option parsing, snapshot collection, key-file preview collection, renderers, JSON/text writers, error writer, and exit-code setter.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-workbench-command.test.js
```

## Task 2: Route Inspect Through The Early Router

- [x] **Step 1: Add inspect command to `buildEarlyCliCommandRouter()`**

`src/cli/index.ts` now imports `createInspectCommand` and registers it in the early `CommandRouter`.

- [x] **Step 2: Add CLI smoke for inspect JSON**

`src/__tests__/workbench-help.test.ts` now checks that `inspect --workspace <cwd> --json` emits workspace snapshot JSON.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-workbench-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js inspect --workspace E:\code\agent --json
```

## Task 3: Close Slice 7

- [x] **Step 1: Record Slice 7 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 7 as a small Workstream 1 increment.

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
node dist\cli\index.js inspect --workspace E:\code\agent --json
git diff --check
```

Evidence refreshed on 2026-06-26 before Slice 8 work: all commands above exited 0.

## Final Acceptance Gate

Slice 7 is complete when:

- `src/cli/commands/workbench.ts` owns `inspect` command execution.
- `src/cli/index.ts` routes `inspect` through `CommandRouter`.
- `inspect --workspace E:\code\agent --json` still behaves as before.
- Build, check, focused router/help/quickstart/workbench tests, CLI smoke commands, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates one more low-risk read-only command branch out of `main()` while keeping workspace snapshot helpers stable.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createInspectCommand` returns `CommandModule<void>` and receives injected dependencies with stable names.
- Phase boundary: No phase verifier, model provider, memory, room, remote runner, policy, approval, audit, or cross-agent behavior is changed.

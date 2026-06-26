# Soloclaw CLI Modularization Slice 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the legacy `models` command execution into the focused model command module while preserving local provider-profile and model-usage behavior.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Extend `src/cli/commands/model.ts` with a legacy `models` command module that owns the `models profiles`, `models setup`, and `models usage` control flow. `src/cli/index.ts` still injects the existing parser, local provider store, model usage service, prompt helper, provider-name parser, and formatting helpers. This slice removes the direct `if (command === "models")` branch from `main()` without changing model stores, audit stores, policy, room, or phase behavior.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing local provider profile store, existing model usage service, no new runtime dependencies.

## Global Constraints

- Preserve `soloclaw models profiles list [--json]`.
- Preserve `soloclaw models profiles set|remove|delete` usage, output, and exit-code behavior.
- Preserve `soloclaw models setup` provider defaulting and output.
- Preserve `soloclaw models usage [--json]` output and close local platform resources after usage summary collection.
- Do not alter global `soloclaw model` / `providers` behavior.
- Do not alter room, phase, memory, policy, approval, audit, remote runner, or cross-agent behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/model.ts`
  - Adds `createLegacyModelsCommand(deps)` and the legacy `models` command execution shell.
- Modify: `src/__tests__/cli-model-command.test.ts`
  - Adds module tests for legacy profile JSON, setup/default behavior, usage text/resource closure, and unknown area errors.
- Modify: `src/cli/index.ts`
  - Registers `createLegacyModelsCommand` in the early router and removes the direct `models` branch.
- Modify: `src/__tests__/workbench-help.test.ts`
  - Adds CLI smoke coverage for `models profiles list --json` and `models usage --json`.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Legacy Models Command Module

- [x] **Step 1: Write failing legacy models command tests**

Evidence: `npm.cmd run build` failed because `createLegacyModelsCommand` was not exported from `src/cli/commands/model.ts`.

- [x] **Step 2: Implement legacy models command module**

Implemented `createLegacyModelsCommand(deps): CommandModule<void>` with injected local profile store, profile parser, provider parser, prompt helper, local alias handling, API key env resolution, usage parser, usage summarizer, usage formatters, writers, and exit-code setter.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-model-command.test.js
```

## Task 2: Route Legacy Models Through The Early Router

- [x] **Step 1: Add legacy models command to `buildEarlyCliCommandRouter()`**

`src/cli/index.ts` now imports `createLegacyModelsCommand`, registers it in the early `CommandRouter`, and injects existing local model profile and usage dependencies.

- [x] **Step 2: Add CLI smoke for legacy models JSON**

`src/__tests__/workbench-help.test.ts` now checks that `models profiles list --json` emits provider profile JSON and `models usage --json` emits model usage summary JSON.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-model-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js models profiles list --json
node dist\cli\index.js models usage --json
```

## Task 3: Close Slice 8

- [x] **Step 1: Record Slice 8 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 8 as the legacy model command extraction increment.

- [x] **Step 2: Run final slice verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-help-command.test.js
node --test dist\__tests__\cli-quickstart-command.test.js
node --test dist\__tests__\cli-model-command.test.js
node --test dist\__tests__\cli-config-command.test.js
node --test dist\__tests__\cli-session-command.test.js
node --test dist\__tests__\cli-tools-command.test.js
node --test dist\__tests__\cli-workbench-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js models profiles list --json
node dist\cli\index.js models usage --json
git diff --check
```

Evidence refreshed on 2026-06-26: all final slice verification commands above exited 0. Full `npm.cmd test` also passed with 729/729 tests.

## Final Acceptance Gate

Slice 8 is complete when:

- `src/cli/commands/model.ts` owns legacy `models` command execution.
- `src/cli/index.ts` routes `models` through `CommandRouter`.
- `models profiles list --json` and `models usage --json` still behave as before.
- Build, check, focused router/help/quickstart/model/config/session/tools/workbench tests, CLI smoke commands, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates the legacy model command branch out of `main()` while preserving local provider profiles and model usage summaries.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createLegacyModelsCommand` returns `CommandModule<void>` and receives injected dependencies with stable names.
- Phase boundary: No phase verifier, room protocol, remote runner, memory, policy, approval, audit, or cross-agent behavior is changed.

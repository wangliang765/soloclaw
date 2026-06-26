# Soloclaw CLI Modularization Slice 9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the `secrets` command execution into the focused config command module while preserving secret store, broker, redaction, lease revocation, and output behavior.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Extend `src/cli/commands/config.ts` with a `secrets` command module that owns `secrets put|get|delete|list` control flow. `src/cli/index.ts` still injects the existing parser, secret value reader, local platform, secret store, policy secret broker, redactor, and writer functions. This slice removes the direct `if (command === "secrets")` branch from `main()` without changing secret storage, policy checks, redaction, audit, model, room, or phase behavior.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing secret store and policy secret broker, no new runtime dependencies.

## Global Constraints

- Preserve `agent secrets list`.
- Preserve `agent secrets put <name> --value-env ENV` defaults and output.
- Preserve `agent secrets get <secret-id>` lease output, `--reveal` behavior, and lease revocation.
- Preserve `agent secrets delete <secret-id>` output.
- Do not print secret values unless `--reveal` is explicitly requested.
- Do not alter policy secret broker, redactor, audit, room, phase, model, or cross-agent behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/config.ts`
  - Adds `createSecretsCommand(deps)` and the `secrets` command execution shell.
- Modify: `src/__tests__/cli-config-command.test.ts`
  - Adds module tests for list/store/redaction/get/revoke/reveal behavior.
- Modify: `src/cli/index.ts`
  - Registers `createSecretsCommand` in the early router and removes the direct `secrets` branch.
- Modify: `src/__tests__/workbench-help.test.ts`
  - Adds CLI smoke coverage for `secrets list`.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Secrets Command Module

- [x] **Step 1: Write failing secrets command tests**

Evidence: `npm.cmd run build` failed because `createSecretsCommand` was not exported from `src/cli/commands/config.ts`.

- [x] **Step 2: Implement secrets command module**

Implemented `createSecretsCommand(deps): CommandModule<void>` with injected parser, secret value reader, local platform, writer functions, and exit-code setter. The module revokes leases in `finally` and closes the platform store in `finally`.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-config-command.test.js
```

## Task 2: Route Secrets Through The Early Router

- [x] **Step 1: Add secrets command to `buildEarlyCliCommandRouter()`**

`src/cli/index.ts` now imports `createSecretsCommand`, registers it in the early `CommandRouter`, and injects existing secret parsing and platform dependencies.

- [x] **Step 2: Add CLI smoke for secrets list**

`src/__tests__/workbench-help.test.ts` now checks that `secrets list` exits successfully through the command module without exposing output in assertions.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-config-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js secrets list
```

## Task 3: Close Slice 9

- [x] **Step 1: Record Slice 9 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 9 as the secrets command extraction increment.

- [ ] **Step 2: Run final slice verification**

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
node dist\cli\index.js secrets list
git diff --check
```

## Final Acceptance Gate

Slice 9 is complete when:

- `src/cli/commands/config.ts` owns `secrets` command execution.
- `src/cli/index.ts` routes `secrets` through `CommandRouter`.
- `secrets list` still behaves as before.
- Secret get still revokes leases and reveals values only under `--reveal`.
- Build, check, focused router/help/quickstart/model/config/session/tools/workbench tests, CLI smoke commands, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates the secret command branch out of `main()` while preserving secret store, broker, redaction, and lease semantics.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createSecretsCommand` returns `CommandModule<void>` and receives injected dependencies with stable names.
- Phase boundary: No phase verifier, room protocol, remote runner, model provider, memory, policy, approval, audit, or cross-agent behavior is changed.

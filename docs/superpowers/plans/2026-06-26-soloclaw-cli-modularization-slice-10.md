# Soloclaw CLI Modularization Slice 10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the top-level `session` command group into the focused session command module while preserving session inspection, verification, bundle export, compaction, deletion, JSON output, and exit-code behavior.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Extend `src/cli/commands/session.ts` with `createSessionCommand(deps)` so `session diff|report|status|inspect|timeline|logs|review|bundle|result|next|verify|compact|delete` owns command control flow outside `src/cli/index.ts`. The entrypoint still injects the existing session builders, renderers, verification options parser, local platform, lifecycle service, local actor, and workspace-local bundle writer. This slice removes the direct `if (command === "session")` branch from `main()` without changing session storage, audit, approvals, rooms, phase verifiers, memory, policy, or cross-agent behavior.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing session inspection/report/bundle builders, no new runtime dependencies.

## Global Constraints

- Preserve all existing `agent session ...` subcommand names and aliases.
- Preserve JSON output contracts for `diff`, `report`, `status`, `inspect`, `timeline`/`logs`, `review`, `bundle`, `result`, `next`, and `verify`.
- Preserve `agent session verify` non-zero exit behavior when verification status is not `pass`.
- Preserve workspace-local `--output` bundle writing.
- Preserve `compact` and `delete` lifecycle behavior, including actor attribution and force/summary options.
- Do not alter session store schemas, session inspection logic, lifecycle service semantics, policy, approval, audit, room, remote runner, memory, model, or phase behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/session.ts`
  - Adds `createSessionCommand(deps)` and shared session lifecycle option wiring.
- Modify: `src/__tests__/cli-session-command.test.ts`
  - Adds module tests for status JSON, failing verification exit behavior, and compact/delete lifecycle wiring.
- Modify: `src/cli/index.ts`
  - Registers `createSessionCommand` in the early router and removes the direct `session` branch.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Session Command Module

- [x] **Step 1: Write failing session command tests**

Evidence: `npm.cmd run build` failed because `createSessionCommand` was not exported from `src/cli/commands/session.ts`.

- [x] **Step 2: Implement session command module**

Implemented `createSessionCommand(deps): CommandModule<void>` with injected parser, local platform, session builders, renderers, lifecycle service, actor factory, bundle writer, JSON writer, error writer, and exit-code setter. The module closes the session store in `finally`.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-session-command.test.js
```

## Task 2: Route Session Through The Early Router

- [x] **Step 1: Add session command to `buildEarlyCliCommandRouter()`**

`src/cli/index.ts` now imports `createSessionCommand`, registers it in the early `CommandRouter`, and injects the existing session builders/renderers and lifecycle dependencies.

- [x] **Step 2: Remove the old top-level session branch**

The direct `if (command === "session")` branch was removed from `main()`. Session command flow now lives in `src/cli/commands/session.ts`.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-session-command.test.js
node dist\cli\index.js session status missing-session --json; if ($LASTEXITCODE -ne 1) { exit 1 }
node dist\cli\index.js session verify missing-session --json; if ($LASTEXITCODE -ne 1) { exit 1 }
```

Evidence: build passed, `cli-session-command.test.js` passed 6/6, and both missing-session smoke paths returned the expected exit code 1 with `Session not found: missing-session`.

## Task 3: Close Slice 10

- [x] **Step 1: Record Slice 10 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 10 as the session command extraction increment.

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
node dist\cli\index.js session status missing-session --json; if ($LASTEXITCODE -ne 1) { exit 1 }
node dist\cli\index.js session verify missing-session --json; if ($LASTEXITCODE -ne 1) { exit 1 }
git diff --check
npm.cmd test
```

Evidence: build and check passed; focused router/help/quickstart/model/config/session/tools/workbench tests passed; `workbench-help.test.js` passed 9/9; both missing-session smoke paths returned expected exit code 1; `git diff --check` exited 0; full `npm.cmd test` passed 737/737.

## Final Acceptance Gate

Slice 10 is complete when:

- `src/cli/commands/session.ts` owns `session diff|report|status|inspect|timeline|logs|review|bundle|result|next|verify|compact|delete` command execution.
- `src/cli/index.ts` routes top-level `session` through `CommandRouter`.
- Existing session JSON and text output paths still use the current builders/renderers.
- `session verify` still exits non-zero when verification fails.
- Build, check, focused router/help/quickstart/model/config/session/tools/workbench tests, CLI smoke commands, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates the session command branch out of `main()` while preserving session inspection, evidence bundle, verification, compaction, and deletion behavior.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createSessionCommand` returns `CommandModule<void>` and receives injected dependencies with stable names.
- Phase boundary: No phase verifier, room protocol, remote runner, model provider, memory, policy, approval, audit, or cross-agent behavior is changed.

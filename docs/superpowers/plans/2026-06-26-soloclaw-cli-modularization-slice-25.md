# Soloclaw CLI Modularization Slice 25 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the remaining onboarding/workbench commands, admin commands, and worker/operator commands into focused command modules while preserving command names, text output, JSON output, policy checks, control-plane projection behavior, and scheduler signal cleanup.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Extend `src/cli/commands/workbench.ts` for product-onboarding and local-agent commands, add `src/cli/commands/admin.ts` for organization/retention/git/PR command flow, and add `src/cli/commands/workers.ts` for workers, scheduler, assignments, and operator views. The entrypoint still injects existing stores, parsers, renderers, policy checks, control-plane service construction, and platform services. This slice removes only the direct `init`/`setup`, `tui`, `local`/`agent`, `smoke`, `workbench verify`, `orgs`, `retention`, `git`, `pr`, `workers`, `scheduler`, `assignments`, and `operator` branches from `main()`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing command router, existing local platform services, existing control-plane service, existing scheduler/worker/assignment services, and Markdown docs. No new runtime dependencies.

## Global Constraints

- Preserve top-level command names and aliases: `init`, `setup`, `tui`, `local`, `agent`, `smoke`, `workbench verify`, `orgs`, `retention`, `git`, `pr`, `workers`, `scheduler`, `assignments`, and `operator`.
- Preserve existing JSON output contracts for status, health, operator, git, and PR commands.
- Preserve existing text output lines and usage/error messages for migrated command branches.
- Preserve PR policy checks before branch creation, commit, and push when `pr prepare` is not a dry run.
- Preserve scheduler `SIGINT`/`SIGTERM` abort wiring and cleanup.
- Preserve operator public/diagnostic projection behavior and detail lookup behavior.
- Do not alter room protocol, remote runners, phase gates, evidence contracts, policy semantics, memory behavior, plugin execution, MCP runtime, or cross-agent behavior.
- Use focused command-module tests for the moved control flow.

---

## File Structure

- Modify: `src/cli/commands/workbench.ts`
  - Adds `createInitCommand`, `createTuiCommand`, `createLocalAgentCommand`, `createSmokeCommand`, and `createWorkbenchVerifyCommand`.
- Create: `src/cli/commands/admin.ts`
  - Adds `createOrgsCommand`, `createRetentionCommand`, `createGitCommand`, and `createPrCommand`.
- Create: `src/cli/commands/workers.ts`
  - Adds `createWorkersCommand`, `createSchedulerCommand`, `createAssignmentsCommand`, and `createOperatorCommand`.
- Modify: `src/cli/index.ts`
  - Registers the new command modules in the early router and removes the direct branches.
- Modify: `src/__tests__/cli-workbench-command.test.ts`
  - Adds onboarding, smoke, local-agent, and workbench verification module tests.
- Create: `src/__tests__/cli-admin-command.test.ts`
  - Adds admin/org/retention/git/PR command module tests.
- Create: `src/__tests__/cli-workers-command.test.ts`
  - Adds workers/scheduler/assignments/operator command module tests.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Workbench And Onboarding Commands

- [x] **Step 1: Add focused workbench command tests**

Covered `init`/`setup` text/JSON/error paths, `tui` startup/error paths, `local`/`agent` status/service/logs/unknown subcommands, `smoke` default/rich TUI/real-provider failure/error paths, and `workbench verify` JSON/text/block/usage behavior.

- [x] **Step 2: Implement workbench command factories**

Implemented product-entry command factories in `src/cli/commands/workbench.ts`, with existing workspace resolution, TUI startup, local-agent builders/renderers, smoke runners, session report, and completion gate logic injected from `src/cli/index.ts`.

- [x] **Step 3: Route through `CommandRouter`**

`src/cli/index.ts` now registers the workbench/onboarding command factories in the early router and no longer owns direct branches for these commands.

## Task 2: Admin Commands

- [x] **Step 1: Add focused admin command tests**

Covered organization creation, grant listing filters, missing project-create arguments, retention policy creation/apply behavior, git status JSON output, PR dry-run behavior, and PR apply policy checks for branch/commit/push.

- [x] **Step 2: Implement admin command module**

Implemented `src/cli/commands/admin.ts` with focused command factories for `orgs`, `retention`, `git`, and `pr`, while injecting existing parsers, policy checks, local platform services, and output writers.

- [x] **Step 3: Route admin commands through `CommandRouter`**

`src/cli/index.ts` now registers the admin command factories and no longer owns direct `orgs`, `retention`, `git`, or `pr` branches.

## Task 3: Worker, Scheduler, Assignment, And Operator Commands

- [x] **Step 1: Add focused worker/operator command tests**

Covered worker registration, worker heartbeat verification, missing poll worker id errors, scheduler run signal hooks, assignment creation, lease nonce cleanup, operator JSON status projection, and operator show usage behavior.

- [x] **Step 2: Implement workers command module**

Implemented `src/cli/commands/workers.ts` with focused command factories for `workers`, `scheduler`, `assignments`, and `operator`, while injecting existing parsers, renderers, local platform services, actor parsing, control-plane construction, and process signal hooks.

- [x] **Step 3: Route through `CommandRouter`**

`src/cli/index.ts` now registers the workers/operator command factories and no longer owns direct `workers`, `scheduler`, `assignments`, or `operator` branches.

## Task 4: Verification

- [x] **Step 1: Build**

```powershell
npm.cmd run build
```

Evidence: build exited 0 after the Slice 25 migrations.

- [x] **Step 2: Focused module tests**

```powershell
node --test dist\__tests__\cli-workbench-command.test.js
node --test dist\__tests__\cli-admin-command.test.js
node --test dist\__tests__\cli-workers-command.test.js
```

Evidence: `cli-workbench-command.test.js` passed 28/28, `cli-admin-command.test.js` passed 8/8, and `cli-workers-command.test.js` passed 8/8.

## Final Acceptance Gate

Slice 25 is complete when:

- `src/cli/commands/workbench.ts` owns the moved product-entry command flow.
- `src/cli/commands/admin.ts` owns the moved admin command flow.
- `src/cli/commands/workers.ts` owns the moved worker/scheduler/assignment/operator command flow.
- `src/cli/index.ts` routes those command groups through `CommandRouter`.
- Existing command names, output contracts, policy checks, scheduler signal cleanup, and operator projection behavior are preserved.
- Build and focused command-module tests pass.

## Self-Review

- Spec coverage: This slice migrates onboarding/workbench, admin, and worker/operator command groups before rooms/spec/phase gates, matching Workstream 1's low-risk-before-phase-gates migration order.
- Placeholder scan: The plan includes exact files, commands, behavior contracts, and verification.
- Type consistency: Command factories return `CommandModule<void>` and receive existing helpers/services through dependency injection.
- Phase boundary: No phase verifier, room routing protocol, remote runner, MCP runtime, memory priority, policy decision semantic, plugin execution semantic, or evidence contract is intentionally changed.

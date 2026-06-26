# Soloclaw CLI Modularization Slice 29 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Workstream 1's top-level command migration by routing phase gates and the hygiene check through focused command modules while preserving evidence contracts.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Add `src/cli/commands/phases.ts` to own top-level `phase1`, `phase2`, `phase3`, `phase4`, and `phase5` command matching. The module delegates to existing phase gate handlers/builders so Phase 1-5 evidence behavior remains unchanged. Add `src/cli/commands/hygiene.ts` for the top-level execution hygiene check.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing command router, existing phase gate functions, existing hygiene scanner, and Markdown docs. No new runtime dependencies.

## Global Constraints

- Preserve Phase 1-5 command names, aliases, JSON output, text output, exit codes, and evidence semantics.
- Preserve Phase 4.5/5.5 real-environment evidence boundaries.
- Preserve `hygiene check` output and error exit behavior.
- Do not alter room protocol, remote runner contracts, policy decisions, MCP runtime, memory priority, or phase verifier internals.
- Use focused command-module tests for moved control flow.

## File Structure

- Create: `src/cli/commands/phases.ts`
- Create: `src/cli/commands/hygiene.ts`
- Modify: `src/cli/index.ts`
- Create: `src/__tests__/cli-phases-command.test.ts`
- Create: `src/__tests__/cli-hygiene-command.test.ts`
- Modify: product maturation, roadmap, and architecture docs.

## Task 1: Phase Commands

- [x] **Step 1: Add focused phase command tests**

Covered `phase1 verify --json`, phase handler delegation with cwd, and phase1 usage errors.

- [x] **Step 2: Implement phase command module**

Implemented `createPhaseCommands` in `src/cli/commands/phases.ts`. Phase 1 command control flow lives in the module; Phase 2-5 route through injected existing handlers.

- [x] **Step 3: Route through `CommandRouter`**

`src/cli/index.ts` now registers phase command modules and no longer owns direct `phase1` through `phase5` command branches. The large Phase 2 branch was mechanically extracted into `handlePhaseTwoCommand(rest, cwd)`.

## Task 2: Hygiene Command

- [x] **Step 1: Add focused hygiene command tests**

Covered clean text output, JSON findings with error exit, and unknown subcommands.

- [x] **Step 2: Implement hygiene command module**

Implemented `createHygieneCommand` in `src/cli/commands/hygiene.ts`.

- [x] **Step 3: Route through `CommandRouter`**

`src/cli/index.ts` now registers `createHygieneCommand` and no longer owns a direct `hygiene` branch.

## Task 3: Verification

- [x] **Step 1: Build**

```powershell
npm.cmd run build
```

Evidence: build exited 0 after the Slice 29 command migrations.

- [x] **Step 2: Focused module tests**

```powershell
node --test dist\__tests__\cli-hygiene-command.test.js dist\__tests__\cli-phases-command.test.js
```

Evidence: focused hygiene/phase tests passed.

## Final Acceptance Gate

Slice 29 is complete when:

- `src/cli/commands/phases.ts` owns top-level phase command dispatch.
- `src/cli/commands/hygiene.ts` owns `hygiene check`.
- `src/cli/index.ts` routes these command groups through `CommandRouter`.
- Existing Phase 1-5 evidence contracts and hygiene output behavior are preserved.
- Build and focused command-module tests pass.

## Self-Review

- Spec coverage: This slice migrates phase gate dispatch last, after room/remote commands.
- Placeholder scan: The plan includes exact files, commands, behavior contracts, and verification.
- Type consistency: Command factories return `CommandModule<void>` and receive existing helpers/services through dependency injection.
- Phase boundary: Phase verifier internals and real-environment evidence gates are not changed.

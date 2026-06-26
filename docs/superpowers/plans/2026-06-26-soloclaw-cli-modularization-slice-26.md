# Soloclaw CLI Modularization Slice 26 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving low-risk specification and agent identity command flow into focused command modules before the larger room/remote command migration and before phase gates.

**Architecture:** Keep `CommandRouter` as the dispatch interface. `src/cli/commands/spec.ts` owns native spec workflow command matching while `src/cli/index.ts` injects existing specification services and parsers. `src/cli/commands/agents.ts` owns local identity display/initialization and agent identity health/trust/key-rotation command flow while `src/cli/index.ts` injects existing platform, control-plane, actor, parser, file-read, and output wiring. This slice does not change room routing, remote runner execution, signed envelope verification, stale recovery semantics, or phase evidence gates.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing command router, existing local platform, existing control-plane service, existing specification service, and Markdown docs. No new runtime dependencies.

## Global Constraints

- Preserve top-level command names: `spec`, `identity`, and `agents`.
- Preserve existing JSON output shape for `identity show/init`, `agents health`, `agents recover-stale`, `agents trust`, and `agents rotate-key`.
- Preserve existing text output and usage messages for migrated agent identity command branches.
- Preserve signed identity, trust, revocation, key-rotation, heartbeat, and stale recovery behavior by keeping these operations behind the existing `ControlPlaneService` and local identity services.
- Do not alter room protocol, remote runner commands, routed inbox semantics, policy semantics, memory priority, plugin execution, MCP runtime, phase verifiers, or evidence contracts.
- Use focused command-module tests for the moved control flow.

---

## File Structure

- Create: `src/cli/commands/agents.ts`
  - Adds `createIdentityCommand` and `createAgentsCommand`.
- Modify: `src/cli/commands/spec.ts`
  - Keeps the focused `createSpecCommand` command module as the owner of spec command flow.
- Modify: `src/cli/index.ts`
  - Registers `identity`, `agents`, and `spec` through `CommandRouter` and removes direct `identity` / `agents` branches.
- Create: `src/__tests__/cli-agents-command.test.ts`
  - Adds identity and agent identity command-module tests.
- Modify: `src/__tests__/cli-spec-command.test.ts`
  - Keeps focused spec command-module coverage.
- Modify: product maturation, roadmap, and architecture docs.

## Task 1: Spec Command Module Closeout

- [x] **Step 1: Keep focused spec command tests**

Covered spec create/list/show, JSON bundle output, DAG validation, task delegation, and dispatch usage behavior through `src/__tests__/cli-spec-command.test.ts`.

- [x] **Step 2: Route spec through `CommandRouter`**

`src/cli/index.ts` registers `createSpecCommand` and injects the existing specification service, actor, parsers, output helpers, and store close behavior.

## Task 2: Agent Identity Commands

- [x] **Step 1: Add focused identity/agents command tests**

Covered `identity show`, `identity init --display-name`, default `agents` list, `agents health --json`, `agents recover-stale --json`, `agents trust`, and `agents rotate-key`.

- [x] **Step 2: Implement agent identity command module**

Implemented `src/cli/commands/agents.ts` with focused command factories for `identity` and `agents`, while injecting existing platform, control-plane, actor parsing, trust parsing, public-key file reads, and output writers.

- [x] **Step 3: Route identity/agents through `CommandRouter`**

`src/cli/index.ts` now registers `createIdentityCommand` and `createAgentsCommand` and no longer owns direct `identity` or `agents` command branches.

## Task 3: Verification

- [x] **Step 1: Build**

```powershell
npm.cmd run build
```

Evidence: build exited 0 after the Slice 26 command migrations.

- [x] **Step 2: Focused module tests**

```powershell
node --test dist\__tests__\cli-spec-command.test.js
node --test dist\__tests__\cli-agents-command.test.js
```

Evidence: `cli-spec-command.test.js` passed 7/7 and `cli-agents-command.test.js` passed 7/7.

- [x] **Step 3: Workstream verification gate**

```powershell
npm.cmd run check
node --test dist\__tests__\cli-agents-command.test.js dist\__tests__\cli-spec-command.test.js dist\__tests__\cli-command-router.test.js
git diff --check
npm.cmd test
node dist\cli\index.js --help
node dist\cli\index.js phase1 verify --json
node dist\cli\index.js model --help
```

Evidence: `check` exited 0; focused agents/spec/router tests passed 18/18; `git diff --check` exited 0; full `npm.cmd test` passed 830/830; `--help`, `phase1 verify --json`, and `model --help` exited 0, with `phase1 verify` reporting `status: "pass"`.

## Final Acceptance Gate

Slice 26 is complete when:

- `src/cli/commands/spec.ts` owns spec command flow through the router.
- `src/cli/commands/agents.ts` owns identity and agent identity command flow.
- `src/cli/index.ts` routes `spec`, `identity`, and `agents` through `CommandRouter`.
- Existing command names, output contracts, trust/key-rotation/stale-recovery semantics, and close behavior are preserved.
- Build and focused command-module tests pass.

## Self-Review

- Spec coverage: This slice migrates spec and lower-risk agent identity command groups before room/remote commands and phase gates, matching Workstream 1's low-risk-before-phase-gates migration order.
- Placeholder scan: The plan includes exact files, commands, behavior contracts, and verification.
- Type consistency: Command factories return `CommandModule<void>` and receive existing helpers/services through dependency injection.
- Phase boundary: No phase verifier, room routing protocol, remote runner, MCP runtime, memory priority, policy decision semantic, plugin execution semantic, or evidence contract is intentionally changed.

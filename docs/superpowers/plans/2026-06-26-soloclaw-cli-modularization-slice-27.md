# Soloclaw CLI Modularization Slice 27 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the low-risk `delegate` and `subtasks` command flow into a focused command module before migrating the larger room/remote command groups and before phase gates.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Add `src/cli/commands/subagents.ts` for top-level sub-agent delegation commands. The entrypoint still injects existing run-argument parsing, local platform creation, local user actor attribution, subagent service, store access, and output writers. This slice removes only direct `delegate` and `subtasks` branches from `main()`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing command router, existing local platform, existing `LocalSubagentService`, existing subtask store, and Markdown docs. No new runtime dependencies.

## Global Constraints

- Preserve top-level command names: `delegate` and `subtasks`.
- Preserve `delegate` JSON output shape: `subtaskId`, `status`, `childSessionId`, and `summary`.
- Preserve `subtasks` text output lines and optional parent-session filtering.
- Preserve run-argument parsing for `--parent-session`, `--room`, `--assigned-agent`, and `--execution-mode`.
- Preserve room-linked delegation semantics by keeping execution behind `LocalSubagentService`.
- Do not alter room protocol, remote runner commands, routed inbox semantics, policy semantics, memory priority, plugin execution, MCP runtime, phase verifiers, or evidence contracts.
- Use focused command-module tests for the moved control flow.

---

## File Structure

- Create: `src/cli/commands/subagents.ts`
  - Adds `createDelegateCommand` and `createSubtasksCommand`.
- Modify: `src/cli/index.ts`
  - Registers `delegate` and `subtasks` through `CommandRouter` and removes direct branches.
- Create: `src/__tests__/cli-subagents-command.test.ts`
  - Adds delegate/subtasks command-module tests.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Delegate Command

- [x] **Step 1: Add focused delegate command tests**

Covered missing objective behavior, parsed option forwarding, legacy JSON output shape, store close behavior, and default `trusted` execution mode.

- [x] **Step 2: Implement delegate command factory**

Implemented `createDelegateCommand` in `src/cli/commands/subagents.ts`, with existing run parser, local platform, actor, subagent delegation service, and output writer injected from `src/cli/index.ts`.

- [x] **Step 3: Route through `CommandRouter`**

`src/cli/index.ts` now registers `createDelegateCommand` and no longer owns a direct `delegate` branch.

## Task 2: Subtasks Command

- [x] **Step 1: Add focused subtasks command tests**

Covered optional parent session filtering, legacy tab-separated text rows, child/parent placeholders, and store close behavior.

- [x] **Step 2: Implement subtasks command factory**

Implemented `createSubtasksCommand` in `src/cli/commands/subagents.ts`, with existing store list behavior injected from `src/cli/index.ts`.

- [x] **Step 3: Route through `CommandRouter`**

`src/cli/index.ts` now registers `createSubtasksCommand` and no longer owns a direct `subtasks` branch.

## Task 3: Verification

- [x] **Step 1: Build**

```powershell
npm.cmd run build
```

Evidence: build exited 0 after the Slice 27 command migrations.

- [x] **Step 2: Focused module tests**

```powershell
node --test dist\__tests__\cli-subagents-command.test.js
```

Evidence: `cli-subagents-command.test.js` passed 4/4.

## Final Acceptance Gate

Slice 27 is complete when:

- `src/cli/commands/subagents.ts` owns `delegate` and `subtasks` command flow.
- `src/cli/index.ts` routes `delegate` and `subtasks` through `CommandRouter`.
- Existing command names, output contracts, parsing behavior, room-linked delegation semantics, and close behavior are preserved.
- Build and focused command-module tests pass.

## Self-Review

- Spec coverage: This slice migrates the remaining low-risk subagent command group before larger room/remote commands and phase gates.
- Placeholder scan: The plan includes exact files, commands, behavior contracts, and verification.
- Type consistency: Command factories return `CommandModule<void>` and receive existing helpers/services through dependency injection.
- Phase boundary: No phase verifier, room routing protocol, remote runner, MCP runtime, memory priority, policy decision semantic, plugin execution semantic, or evidence contract is intentionally changed.

# Soloclaw CLI Modularization Slice 24 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving top-level `workspace` into a focused workspace command module while preserving recent-workspace list/add/use behavior, JSON output, text output, selector resolution, and history-file contracts.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Add `src/cli/commands/workspace.ts` with `createWorkspaceCommand(deps)` and register it from `src/cli/index.ts`. The entrypoint still injects current working directory, workspace history readers/writers, path resolution, selector resolution, history rendering, text/JSON/error writers, and exit-code handling. This slice removes only the direct `if (command === "workspace")` branch from `main()`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing workspace history helpers, platform path resolution, and Markdown docs. No new runtime dependencies.

## Global Constraints

- Preserve top-level `agent workspace list|ls|recent [--json]`.
- Preserve top-level `agent workspace add <path>`.
- Preserve top-level `agent workspace use|select <number|path>`.
- Preserve JSON shape: `{ configPath, activeWorkspace, entries }`.
- Preserve text output lines for add/use/select and existing history rendering for list.
- Preserve workspace history file location and selector semantics through existing injected helpers.
- Do not alter TUI startup, workspace resolution, platform path contracts, local platform behavior, room protocol, remote runners, phase gates, policy decisions, memory behavior, plugin execution, MCP runtime, or cross-agent behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Create: `src/cli/commands/workspace.ts`
  - Adds `createWorkspaceCommand(deps)` for top-level `workspace`.
- Create: `src/__tests__/cli-workspace-command.test.ts`
  - Adds module tests for JSON list, add output, use/select output, and missing argument errors.
- Modify: `src/cli/index.ts`
  - Registers `createWorkspaceCommand` in the early router and removes the direct `workspace` branch.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Workspace Command Module

- [x] **Step 1: Write failing workspace command tests**

Evidence: `npm.cmd run build` failed because `../cli/commands/workspace.js` was missing, proving the new tests exercised a missing command-module boundary.

- [x] **Step 2: Implement workspace command module**

Implemented `createWorkspaceCommand(deps): CommandModule<void>` with injected history root, history reader, history path resolver, path resolver, history recorder, selector resolver, history renderer, text/JSON/error writers, and exit-code setter. The module owns workspace subcommand matching, JSON list shape, add/use output, missing argument errors, unknown subcommand errors, and error-to-exit-code behavior.

- [x] **Step 3: Route workspace through the early router**

`src/cli/index.ts` now imports and registers `createWorkspaceCommand` with existing workspace history helpers and path resolution dependencies. The old direct `if (command === "workspace")` branch was removed from `src/cli/index.ts`.

## Task 2: Verification

- [x] **Step 1: Focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-workspace-command.test.js
```

Evidence: build passed; `cli-workspace-command.test.js` passed 4/4, covering JSON list, add output, use/select output, and missing add path errors.

- [x] **Step 2: CLI smoke verification**

```powershell
node dist\cli\index.js workspace list --json
npm.cmd run check
```

Evidence: `workspace list --json` exited 0 and printed `{ configPath, activeWorkspace, entries }` through the early router. `npm.cmd run check` passed. The read-only smoke emitted Node's existing experimental SQLite warning.

## Final Acceptance Gate

Slice 24 is complete when:

- `src/cli/commands/workspace.ts` owns top-level `workspace` command execution.
- `src/cli/index.ts` routes `workspace` through `CommandRouter`.
- Existing list/add/use/select names, JSON shape, text output, history path behavior, selector behavior, and error behavior are preserved.
- Build, check, focused workspace command tests, and CLI list smoke pass.

## Self-Review

- Spec coverage: This slice migrates only recent-workspace CLI behavior and leaves init/setup, tui, local/agent, smoke, workbench, rooms, workers/scheduler/operator, admin/org/git/PR, spec, and phase gates for later slices.
- Placeholder scan: The plan includes exact files, commands, expected output contracts, and verification.
- Type consistency: `createWorkspaceCommand` returns `CommandModule<void>` and receives existing workspace history helpers through dependency injection.
- Phase boundary: No phase verifier, TUI startup, workspace history format, platform path contract, room protocol, remote runner, memory priority, audit event schema, model provider, policy decision semantic, plugin execution semantic, MCP runtime semantic, or cross-agent behavior is intentionally changed.

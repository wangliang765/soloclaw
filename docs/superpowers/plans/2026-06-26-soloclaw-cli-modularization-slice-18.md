# Soloclaw CLI Modularization Slice 18 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving top-level `commands` into the focused tools command module while preserving `.agent/commands` list/show/run behavior, workspace option handling, command template expansion, model profile defaults, run-with-session output, audit recording, error handling, and store cleanup.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Extend `src/cli/commands/tools.ts` with `createAgentCommandsCommand(deps)` and register it from `src/cli/index.ts`. The entrypoint still injects workspace resolution, command loading, command service expansion, default model profile lookup, local platform creation, audit id/time helpers, and writers. This slice removes only the direct `if (command === "commands")` branch from `main()`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing command loader/service, existing local platform, no new runtime dependencies.

## Global Constraints

- Preserve top-level `agent commands list [--workspace path]`.
- Preserve top-level `agent commands show <name> [--workspace path]`.
- Preserve top-level `agent commands run <name> [args...] [--workspace path]`.
- Preserve list output: `<name>\t<agentProfile|->\t<description|empty>`.
- Preserve show JSON output for the selected command.
- Preserve missing/unknown command errors for show/run.
- Preserve run output: final answer, then a blank line and `session: <session-id>` when a session is returned.
- Preserve audit event `agent.command_template_executed` when a run creates a session.
- Close the platform store after `run` success and failure paths that open platform state.
- Do not alter command loader/service internals, agent run behavior, model profile lookup, policy, memory, rooms, or phase behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/tools.ts`
  - Adds `createAgentCommandsCommand(deps)` for top-level `commands`.
- Modify: `src/__tests__/cli-tools-command.test.ts`
  - Adds module tests for list, show, missing/unknown command, run expansion/audit/output, expand failure, and store cleanup.
- Modify: `src/cli/index.ts`
  - Registers `createAgentCommandsCommand` in the early router and removes the direct `commands` branch.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Agent Commands Command Module

- [x] **Step 1: Write failing commands command tests**

Evidence: `npm.cmd run build` failed because `createAgentCommandsCommand` was not exported from `src/cli/commands/tools.ts`.

- [x] **Step 2: Implement commands command module**

Implemented `createAgentCommandsCommand(deps): CommandModule<void>` with injected workspace resolution, command directory lookup, command loading, command service expansion, default model profile lookup, local platform creation, audit id/time helpers, split-word helper, and text/JSON/error writers. The module closes the store in `finally` for run paths that open platform state.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-tools-command.test.js
```

Evidence: build and check passed; `cli-tools-command.test.js` passed 8/8.

## Task 2: Route Commands Through The Early Router

- [x] **Step 1: Add commands command to `buildEarlyCliCommandRouter()`**

`src/cli/index.ts` now imports and registers `createAgentCommandsCommand` with the existing workspace resolution, loader, command service, model profile, local platform, audit, and writer dependencies.

- [x] **Step 2: Remove the old top-level commands branch**

The direct `if (command === "commands")` branch was removed from `main()`. Agent command template CLI flow now lives in `src/cli/commands/tools.ts`.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-tools-command.test.js
node dist\cli\index.js commands show; if ($LASTEXITCODE -eq 1) { exit 0 } else { exit 1 }
```

Evidence: build passed; `cli-tools-command.test.js` passed 8/8; `node dist\cli\index.js commands show` printed the expected missing command name error and returned exit code 1, with the wrapper exiting 0.

## Task 3: Close Slice 18

- [x] **Step 1: Record Slice 18 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 18 as the agent command template CLI extraction increment.

- [x] **Step 2: Run final slice verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-tools-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js commands show; if ($LASTEXITCODE -eq 1) { exit 0 } else { exit 1 }
git diff --check
```

Evidence: build and check passed; `cli-command-router.test.js` passed 4/4; `cli-tools-command.test.js` passed 8/8; `workbench-help.test.js` passed 9/9; `node dist\cli\index.js commands show` returned the expected exit code 1 for missing command name and the wrapper exited 0; `git diff --check` exited 0. The commands smoke emitted Node's existing experimental SQLite warning plus the expected usage error, and Git reported existing LF/CRLF normalization warnings but no diff-check failures.

## Final Acceptance Gate

Slice 18 is complete when:

- `src/cli/commands/tools.ts` owns top-level `commands` command execution.
- `src/cli/index.ts` routes `commands` through `CommandRouter`.
- List/show/run output, workspace handling, expansion failures, audit recording, and store cleanup are preserved.
- Build, check, focused router/tools/workbench tests, CLI missing-command smoke, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates only command template CLI behavior and leaves skills, knowledge, plugins, MCP, rooms, workers, admin, spec, web, audit, and phase gates for later slices.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createAgentCommandsCommand` returns `CommandModule<void>` and receives existing command-template dependencies through injection.
- Phase boundary: No phase verifier, room protocol, remote runner, model provider, memory, policy, plugin, MCP, or cross-agent behavior is intentionally changed.

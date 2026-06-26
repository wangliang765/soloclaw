# Soloclaw CLI Modularization Slice 19 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving top-level `skills` into the focused tools command module while preserving skill load/list/show behavior, tab-delimited output, JSON show output, missing/not-found errors, and store cleanup.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Extend `src/cli/commands/tools.ts` with `createSkillsCommand(deps)` and register it from `src/cli/index.ts`. The entrypoint still injects the local platform factory and workspace-local `.agent/skills` directory construction. This slice removes only the direct `if (command === "skills")` branch from `main()`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing local skill loader/catalog store, no new runtime dependencies.

## Global Constraints

- Preserve top-level `agent skills`.
- Preserve top-level `agent skills load`.
- Preserve top-level `agent skills show <name>`.
- Preserve list/load output: `<name>@<version>\t<scope>\t<description>`.
- Preserve show JSON output for the selected skill.
- Preserve missing skill name and not-found error messages.
- Close the store after success and error paths.
- Do not alter skill loading internals, skill catalog data, memory, model, policy, plugins, MCP, rooms, or phase behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/tools.ts`
  - Adds `createSkillsCommand(deps)` for top-level `skills`.
- Modify: `src/__tests__/cli-tools-command.test.ts`
  - Adds module tests for list, load, show, missing name, not-found, and store cleanup.
- Modify: `src/cli/index.ts`
  - Registers `createSkillsCommand` in the early router and removes the direct `skills` branch.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Skills Command Module

- [x] **Step 1: Write failing skills command tests**

Evidence: `npm.cmd run build` failed because `createSkillsCommand` was not exported from `src/cli/commands/tools.ts`.

- [x] **Step 2: Implement skills command module**

Implemented `createSkillsCommand(deps): CommandModule<void>` with injected local platform, skill directory resolver, text/JSON/error writers, and exit-code setter. The module closes the store in `finally`.

- [x] **Step 3: Run focused module verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-tools-command.test.js
```

Evidence: build and check passed; `cli-tools-command.test.js` passed 12/12.

## Task 2: Route Skills Through The Early Router

- [x] **Step 1: Add skills command to `buildEarlyCliCommandRouter()`**

`src/cli/index.ts` now imports and registers `createSkillsCommand` with the existing local platform and skill directory dependencies.

- [x] **Step 2: Remove the old top-level skills branch**

The direct `if (command === "skills")` branch was removed from `main()`. Skill CLI flow now lives in `src/cli/commands/tools.ts`.

- [x] **Step 3: Run focused integration verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-tools-command.test.js
node dist\cli\index.js skills show; if ($LASTEXITCODE -eq 1) { exit 0 } else { exit 1 }
```

Evidence: build passed; `cli-tools-command.test.js` passed 12/12; `node dist\cli\index.js skills show` printed the expected missing skill name error and returned exit code 1, with the wrapper exiting 0.

## Task 3: Close Slice 19

- [x] **Step 1: Record Slice 19 status**

This plan, the product maturation plan, roadmap, architecture doc, and plan ledger record Slice 19 as the skills CLI extraction increment.

- [x] **Step 2: Run final slice verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-tools-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js skills show; if ($LASTEXITCODE -eq 1) { exit 0 } else { exit 1 }
git diff --check
```

Evidence: build and check passed; `cli-command-router.test.js` passed 4/4; `cli-tools-command.test.js` passed 12/12; `workbench-help.test.js` passed 9/9; `node dist\cli\index.js skills show` returned the expected exit code 1 for missing skill name and the wrapper exited 0; `git diff --check` exited 0. The skills smoke emitted Node's existing experimental SQLite warning plus the expected usage error, and Git reported existing LF/CRLF normalization warnings but no diff-check failures.

## Final Acceptance Gate

Slice 19 is complete when:

- `src/cli/commands/tools.ts` owns top-level `skills` command execution.
- `src/cli/index.ts` routes `skills` through `CommandRouter`.
- Load/list/show output, missing/not-found errors, and store cleanup are preserved.
- Build, check, focused router/tools/workbench tests, CLI missing-skill-name smoke, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates only skill CLI behavior and leaves knowledge, plugins, MCP, rooms, workers, admin, spec, web, audit, and phase gates for later slices.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: `createSkillsCommand` returns `CommandModule<void>` and receives existing skill dependencies through injection.
- Phase boundary: No phase verifier, room protocol, remote runner, model provider, memory, policy, plugin, MCP, or cross-agent behavior is intentionally changed.

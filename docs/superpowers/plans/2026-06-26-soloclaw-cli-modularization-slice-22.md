# Soloclaw CLI Modularization Slice 22 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving top-level `memory` into a focused memory command module while preserving reviewed persistent-memory lifecycle behavior, JSON/text output contracts, retrieval ACL enforcement, snapshot behavior, eval gates, and resource cleanup.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Add `src/cli/commands/memory.ts` with `createMemoryCommand(deps)` and register it from `src/cli/index.ts`. The entrypoint still injects local platform creation, memory retrieval, snapshot service construction, local actor construction, file reads, text/JSON/error writers, and exit-code handling. This slice removes only the direct `if (command === "memory")` branch and local memory parser from `main()`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing memory service, retrieval service, snapshot service, store, audit, ACL, and safety-scanning paths. No new runtime dependencies.

## Global Constraints

- Preserve top-level `agent memory add|delete|summary|extract|candidates|approve|reject|search|usage|snapshot|eval|list`.
- Preserve text and JSON output contracts used by current memory CLI tests.
- Keep memory retrieval behind existing ACL enforcement and safety-mode behavior.
- Keep memory extraction, candidate review, usage audit, snapshot export/import/status, and eval gates on the existing memory services.
- Close the store after success and error paths.
- Do not alter memory priority, memory safety semantics, audit event schemas, room protocol, remote runners, phase gates, policy decisions, model providers, plugin execution, MCP runtime, or cross-agent behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Create: `src/cli/commands/memory.ts`
  - Adds `createMemoryCommand(deps)` for top-level `memory`.
- Create: `src/__tests__/cli-memory-command.test.ts`
  - Adds module tests for list filtering, JSON search routing, usage errors, and cleanup behavior.
- Modify: `src/cli/index.ts`
  - Registers `createMemoryCommand` in the early router and removes the direct `memory` branch plus local memory parser.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Memory Command Module

- [x] **Step 1: Write failing memory command tests**

Evidence: `npm.cmd run build` failed because `../cli/commands/memory.js` was missing, proving the new tests exercised a missing command-module boundary.

- [x] **Step 2: Implement memory command module**

Implemented `createMemoryCommand(deps): CommandModule<void>` with injected local platform, retrieval service, snapshot service, actor, UTF-8 reader, text/JSON/error writers, and exit-code setter. The module owns memory argument parsing, memory scope/status/safety parsing, text/JSON output selection, error handling, eval exit code, and store cleanup.

- [x] **Step 3: Route memory through the early router**

`src/cli/index.ts` now imports and registers `createMemoryCommand` with existing `createLocalPlatform`, `MemoryRetrievalService`, `MemorySnapshotService`, `localUserActor`, and `readUtf8` dependencies. The old direct `if (command === "memory")` branch and old `parseMemoryArgs` helpers were removed from `src/cli/index.ts`.

## Task 2: Verification

- [x] **Step 1: Focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-memory-command.test.js
```

Evidence: build passed; `cli-memory-command.test.js` passed 3/3, covering list routing, JSON search routing, usage error handling, and store cleanup.

- [x] **Step 2: CLI integration verification**

```powershell
node --test dist\__tests__\memory-cli.test.js
```

Evidence: `memory-cli.test.js` passed 3/3, covering extract/review/search/usage JSON flow, snapshot export/status, eval gates, and help text.

## Final Acceptance Gate

Slice 22 is complete when:

- `src/cli/commands/memory.ts` owns top-level `memory` command execution.
- `src/cli/index.ts` routes `memory` through `CommandRouter`.
- Existing command names, output contracts, ACL/safety paths, snapshot behavior, eval behavior, and cleanup behavior are preserved.
- Build, focused memory command tests, and memory CLI integration tests pass.

## Self-Review

- Spec coverage: This slice migrates only persistent memory CLI behavior and leaves rooms, workers/scheduler/operator, admin/org/git/PR, spec, web, onboarding/workbench, and phase gates for later slices.
- Placeholder scan: The plan includes exact files, commands, expected output contracts, and verification.
- Type consistency: `createMemoryCommand` returns `CommandModule<void>` and receives existing memory services through dependency injection.
- Phase boundary: No phase verifier, room protocol, remote runner, memory priority, memory safety rule, audit event schema, model provider, policy decision semantic, plugin execution semantic, MCP runtime semantic, or cross-agent behavior is intentionally changed.

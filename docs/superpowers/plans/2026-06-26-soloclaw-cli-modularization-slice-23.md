# Soloclaw CLI Modularization Slice 23 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving top-level `web` into a focused web command module while preserving local Web console startup, host/port/token parsing, startup output, signal shutdown behavior, and CLI smoke coverage.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Add `src/cli/commands/web.ts` with `createWebCommand(deps)` and register it from `src/cli/index.ts`. The entrypoint still injects current working directory, `startLocalRoomWebServer`, process signal registration, process exit, and output/error/exit-code handling. This slice removes only the direct `if (command === "web")` branch and local web parser from `main()`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing local Web server, local control-plane service, SQLite-backed local platform, and Markdown docs. No new runtime dependencies.

## Global Constraints

- Preserve top-level `agent web [--host host] [--port port] [--token token]`.
- Preserve startup output: `Room Web UI: <url>`.
- Preserve SIGINT and SIGTERM shutdown behavior: close server and exit 0.
- Preserve host, port, and token option parsing, including port validation.
- Keep Web API behavior, token protection, control-plane routes, room semantics, approvals, sessions, audit, remote runners, and phase gates unchanged.
- Do not alter Web server internals, control-plane contracts, room protocol, remote runner behavior, memory priority, policy decision semantics, plugin execution semantics, MCP runtime semantics, or cross-agent behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Create: `src/cli/commands/web.ts`
  - Adds `createWebCommand(deps)` for top-level `web`.
- Create: `src/__tests__/cli-web-command.test.ts`
  - Adds module tests for parsed startup options, SIGINT/SIGTERM shutdown, and invalid port errors.
- Modify: `src/cli/index.ts`
  - Registers `createWebCommand` in the early router and removes the direct `web` branch plus local web parser.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Web Command Module

- [x] **Step 1: Write failing web command tests**

Evidence: `npm.cmd run build` failed because `../cli/commands/web.js` was missing, proving the new tests exercised a missing command-module boundary.

- [x] **Step 2: Implement web command module**

Implemented `createWebCommand(deps): CommandModule<void>` with injected CWD, server starter, signal registration, process exit, text/error writers, and exit-code setter. The module owns host/port/token parsing, port validation, startup URL output, signal shutdown handlers, and error handling.

- [x] **Step 3: Route web through the early router**

`src/cli/index.ts` now imports and registers `createWebCommand` with existing `startLocalRoomWebServer`, process signal registration, and output dependencies. The old direct `if (command === "web")` branch and old `parseWebArgs` helper were removed from `src/cli/index.ts`.

## Task 2: Verification

- [x] **Step 1: Focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-web-command.test.js
```

Evidence: build passed; `cli-web-command.test.js` passed 3/3, covering parsed startup options, SIGTERM shutdown, and invalid port errors.

- [x] **Step 2: CLI smoke verification**

```powershell
node -e "<spawn dist\\cli\\index.js web --port 0 --token smoke, wait for URL, then SIGTERM>"
node dist\cli\index.js web --port 99999
npm.cmd run check
```

Evidence: `web --port 0 --token smoke` printed a local Web UI URL and exited 0 after SIGTERM. `web --port 99999` exited 1 and printed `Invalid port: 99999`. `npm.cmd run check` passed. The smoke emitted Node's existing experimental SQLite warning.

## Final Acceptance Gate

Slice 23 is complete when:

- `src/cli/commands/web.ts` owns top-level `web` command execution.
- `src/cli/index.ts` routes `web` through `CommandRouter`.
- Startup output, host/port/token parsing, invalid port handling, and signal shutdown behavior are preserved.
- Build, check, focused web command tests, and CLI smoke paths pass.

## Self-Review

- Spec coverage: This slice migrates only local Web console startup and leaves rooms, workers/scheduler/operator, admin/org/git/PR, spec, onboarding/workbench, and phase gates for later slices.
- Placeholder scan: The plan includes exact files, commands, expected output contracts, and verification.
- Type consistency: `createWebCommand` returns `CommandModule<void>` and receives existing Web server startup through dependency injection.
- Phase boundary: No phase verifier, Web API route, control-plane contract, room protocol, remote runner, memory priority, memory safety rule, audit event schema, model provider, policy decision semantic, plugin execution semantic, MCP runtime semantic, or cross-agent behavior is intentionally changed.

# Soloclaw CLI Modularization Slice 21 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving top-level `audit` into the focused session command module while preserving audit list, export, verify, retention-export denial, signed bundle status, output-file behavior, and resource cleanup.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Extend `src/cli/commands/session.ts` with `createAuditCommand(deps)` and register it from `src/cli/index.ts`. The entrypoint still injects local platform creation, `AuditExportService`, identity, file reads, file writes, raw stdout, text/error writers, and exit-code handling. This slice removes only the direct `if (command === "audit")` branch and its local parser from `main()`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing audit store, local identity service, audit export service, retention policy checks, and Markdown docs. No new runtime dependencies.

## Global Constraints

- Preserve top-level `agent audit list`.
- Preserve top-level `agent audit export`.
- Preserve top-level `agent audit verify`.
- Preserve list output: `<createdAt>\t<type>\t<actor-type>:<actor-id>\t<session-id|->\t<room-id|->\t<summary>`.
- Preserve export formats `jsonl`, `json`, and `bundle`.
- Preserve output-file behavior and signed/unsigned status line.
- Preserve bundle verification output and exit code 2 for non-valid bundles.
- Preserve retention policy export denial for projects whose retention policy disables audit export.
- Close the store after success and error paths.
- Do not alter audit event schemas, export bundle signing, retention policy semantics, rooms, remote runners, phase gates, policy decisions, MCP, plugins, memory, or model behavior.
- Use TDD for the new command module behavior before production module code.

---

## File Structure

- Modify: `src/cli/commands/session.ts`
  - Adds `createAuditCommand(deps)` for top-level `audit`.
- Modify: `src/__tests__/cli-session-command.test.ts`
  - Adds module tests for list filtering, export output files, verify invalid exit code, and cleanup behavior.
- Modify: `src/cli/index.ts`
  - Registers `createAuditCommand` in the early router and removes the direct `audit` branch plus local audit parser.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Audit Command Module

- [x] **Step 1: Write failing audit command tests**

Evidence: `npm.cmd run build` failed because `createAuditCommand` was not exported from `src/cli/commands/session.ts`, proving the new tests exercised a missing command-module boundary.

- [x] **Step 2: Implement audit command module**

Implemented `createAuditCommand(deps): CommandModule<void>` with injected local platform, export service, UTF-8 reader, output-file writer, raw stdout writer, text/error writers, and exit-code setter. The module owns audit argument parsing, audit event line formatting, retention export guard, list/export/verify flow, and store cleanup.

- [x] **Step 3: Route audit through the early router**

`src/cli/index.ts` now imports and registers `createAuditCommand` with existing `AuditExportService`, identity, store, file read/write, and output dependencies. The old direct `if (command === "audit")` branch and old `parseAuditArgs` / `ensureAuditExportAllowed` helpers were removed from `src/cli/index.ts`.

## Task 2: Verification

- [x] **Step 1: Focused module verification**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-session-command.test.js
```

Evidence: build passed; `cli-session-command.test.js` passed 31/31, including the new audit list/export/verify module tests.

- [x] **Step 2: CLI smoke verification**

```powershell
node dist\cli\index.js audit list --limit 1
$p = Join-Path $env:TEMP "soloclaw-audit-smoke-$PID.json"; node dist\cli\index.js audit export --limit 1 --format bundle --output $p; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node dist\cli\index.js audit verify $p; $code = $LASTEXITCODE; Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue; exit $code
```

Evidence: `audit list --limit 1` exited 0 and printed a recent audit row. The export/verify smoke exited 0, wrote a signed bundle to a temp file, and `audit verify` returned `valid` with event count and SHA-256. The smoke emitted Node's existing experimental SQLite warning.

## Final Acceptance Gate

Slice 21 is complete when:

- `src/cli/commands/session.ts` owns top-level `audit` command execution.
- `src/cli/index.ts` routes `audit` through `CommandRouter`.
- Audit list/export/verify output contracts, signed bundle behavior, retention export guard, and cleanup behavior are preserved.
- Build, check, focused session/router tests, audit CLI smoke paths, whitespace check, and full tests pass.

## Self-Review

- Spec coverage: This slice migrates only top-level `audit` CLI behavior and leaves rooms, workers/scheduler/operator, admin/org/git/PR, spec, web, memory, onboarding/workbench, and phase gates for later slices.
- Placeholder scan: The plan includes exact files, commands, expected output contracts, and verification.
- Type consistency: `createAuditCommand` returns `CommandModule<void>` and receives existing audit services through dependency injection.
- Phase boundary: No phase verifier, room protocol, remote runner, audit event schema, retention policy semantics, model provider, memory priority, policy decision semantics, plugin execution semantics, MCP runtime semantics, or cross-agent behavior is intentionally changed.

# Soloclaw CLI Modularization Slice 20 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the remaining tools-adjacent top-level command groups, `knowledge`, `plugins`, and `mcp`, into the focused tools command module while preserving their existing output contracts, policy/audit paths, resource cleanup, and CLI smoke paths.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Extend `src/cli/commands/tools.ts` with `createKnowledgeCommand(deps)`, `createPluginsCommand(deps)`, and `createMcpCommand(deps)`, and register them from `src/cli/index.ts`. The entrypoint still injects existing platform creation, policy wrappers, MCP registry/runtime services, knowledge service access, actor construction, audit id generation, file reads, and text/JSON/error writers. This slice removes only the direct `knowledge`, `plugins`, and `mcp` branches from `main()`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing knowledge, plugin, MCP, policy, audit, redaction, and local platform services. No new runtime dependencies.

## Global Constraints

- Preserve top-level `agent knowledge` subcommands and their text/JSON output contracts.
- Preserve top-level `agent plugins list|show|run` behavior, plugin tool naming, policy wrapping, and plugin execution audit path.
- Preserve top-level `agent mcp list|show|plan|capabilities|health|call-tool|read-resource|register|remove` behavior, MCP approval/policy checks, audit events, safe metadata, and resource cleanup.
- Keep all filesystem, plugin, MCP, tool, and knowledge operations behind existing policy, approval, audit, runtime, and redaction contracts.
- Keep retrieved knowledge lower priority than system policy, project instructions, skills, approvals, and secret redaction.
- Do not alter room protocol, remote runners, phase gates, memory semantics, model providers, plugin internals, MCP runtime internals, or cross-agent behavior.
- Use focused command-module tests before relying on integration smoke.

---

## File Structure

- Modify: `src/cli/commands/tools.ts`
  - Adds `createKnowledgeCommand(deps)`, `createPluginsCommand(deps)`, and `createMcpCommand(deps)`.
- Modify: `src/__tests__/cli-tools-command.test.ts`
  - Adds module tests for representative knowledge search, plugin list, and MCP JSON list/resource cleanup behavior.
- Modify: `src/cli/index.ts`
  - Registers the three commands in `buildEarlyCliCommandRouter()` and removes the old direct branches.
- Modify: product maturation, roadmap, architecture, and plan ledger docs.

## Task 1: Tools-Adjacent Command Modules

- [x] **Step 1: Add focused command-module tests**

Evidence: `node --test dist\__tests__\cli-tools-command.test.js` passes 15/15 after adding coverage for `createKnowledgeCommand`, `createPluginsCommand`, and `createMcpCommand`.

- [x] **Step 2: Implement `knowledge`, `plugins`, and `mcp` command modules**

Implemented dependency-injected command modules in `src/cli/commands/tools.ts`. Knowledge owns ingest/list/search/eval command flow and closes the store. Plugins owns list/show/run command flow, keeps plugin execution behind `withPolicy`, and closes the store. MCP owns list/show/plan/capabilities/health/call-tool/read-resource/register/remove command flow, keeps safe audit metadata, uses existing MCP services, and closes platform resources.

- [x] **Step 3: Route the commands through the early router**

`src/cli/index.ts` now registers `createKnowledgeCommand`, `createPluginsCommand`, and `createMcpCommand` from `buildEarlyCliCommandRouter()` with existing local platform, policy, MCP registry/runtime, redactor, secret broker, and audit dependencies. The old direct top-level branches for these command groups were removed.

## Task 2: Focused Verification

- [x] **Step 1: Build and focused tests**

```powershell
npm.cmd run build
node --test dist\__tests__\cli-tools-command.test.js
node --test dist\__tests__\cli-command-router.test.js
```

Evidence: build passed; `cli-tools-command.test.js` passed 15/15; `cli-command-router.test.js` passed 4/4.

- [x] **Step 2: Run final slice verification**

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-tools-command.test.js
node --test dist\__tests__\cli-command-router.test.js
node dist\cli\index.js knowledge search modularization --limit 1
node dist\cli\index.js plugins list
node dist\cli\index.js mcp list --json
git diff --check
```

Evidence: build and check passed; `cli-tools-command.test.js` passed 15/15; `cli-command-router.test.js` passed 4/4; `knowledge search modularization --limit 1`, `plugins list`, and `mcp list --json` all exited 0 through the early router. The smoke commands emitted Node's existing experimental SQLite warning, `mcp list --json` returned an empty `servers` array with `E:\code\agent\.agent\mcp-servers.json`, and `git diff --check` exited 0 with existing LF/CRLF normalization warnings only.

## Final Acceptance Gate

Slice 20 is complete when:

- `src/cli/commands/tools.ts` owns top-level `knowledge`, `plugins`, and `mcp` command execution.
- `src/cli/index.ts` routes `knowledge`, `plugins`, and `mcp` through `CommandRouter`.
- Existing command names, output contracts, policy/audit paths, and cleanup behavior are preserved.
- Build, check, focused router/tools tests, CLI smoke paths, and whitespace check pass.

## Self-Review

- Spec coverage: This slice migrates only tools-adjacent CLI behavior and leaves rooms, workers/scheduler/operator, admin/org/git/PR, spec, web, audit, memory, onboarding/workbench, and phase gates for later slices.
- Placeholder scan: The plan includes exact files, commands, and expected verification.
- Type consistency: New command creators return `CommandModule<void>` and receive existing services through dependency injection.
- Phase boundary: No phase verifier, room protocol, remote runner, model provider, memory priority, policy decision semantics, plugin execution semantics, MCP runtime semantics, or cross-agent behavior is intentionally changed.

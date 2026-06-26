# Soloclaw CLI Modularization Slice 28 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving room convenience routing, `rooms`, and `remote` command flow into focused command modules before phase gates.

**Architecture:** Keep `CommandRouter` as the dispatch interface. Add `src/cli/commands/rooms.ts` for room CRUD, invites, roster/inbox, member updates, message send, and `room` shortcut normalization/help. Add `src/cli/commands/remote.ts` for remote registration, enrollment, invite-bundle join, invitations, accepted room invitations, inbox/say/ack/poll/heartbeat, service plan, and foreground runner flow. Existing room protocol, routed inbox, signed ack/heartbeat, invite bundle, stop-file, status-file, and token-redaction semantics remain unchanged.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing command router, existing local platform, `ControlPlaneService`, `RemoteRoomRunner`, room services, and Markdown docs. No new runtime dependencies.

## Global Constraints

- Preserve top-level `rooms` and `remote` command names.
- Preserve `room` convenience shortcuts: `invite-agent`, `pull-agent`, `join`, `run`, `service`, and `remote-say`.
- Preserve token-safe invite bundle and service-plan output.
- Preserve signed remote heartbeat, acknowledgement, routed inbox, stale/revoked/suspended semantics, and no-broadcast fallback behavior.
- Do not alter phase verifiers, policy decisions, room protocol, remote runner contracts, MCP runtime, memory priority, or evidence gates.
- Use focused command-module tests for the moved control flow.

## File Structure

- Create: `src/cli/commands/rooms.ts`
- Create: `src/cli/commands/remote.ts`
- Modify: `src/cli/index.ts`
- Create: `src/__tests__/cli-rooms-command.test.ts`
- Create: `src/__tests__/cli-remote-command.test.ts`
- Modify: product maturation, roadmap, and architecture docs.

## Task 1: Room Commands

- [x] **Step 1: Add focused room command tests**

Covered room creation with local-agent policy options, usage errors, platform cleanup, and room shortcut normalization.

- [x] **Step 2: Implement room command module**

Implemented `createRoomsCommand` in `src/cli/commands/rooms.ts`, plus `printRoomConvenienceHelp` and `normalizeRoomConvenienceCommand`.

- [x] **Step 3: Route through `CommandRouter`**

`src/cli/index.ts` now registers `createRoomsCommand`, normalizes `room` shortcuts before router dispatch, and no longer owns a direct `rooms` command branch.

## Task 2: Remote Commands

- [x] **Step 1: Add focused remote command tests**

Covered metadata-only service plan JSON and usage errors that must not open platform state.

- [x] **Step 2: Implement remote command module**

Implemented `createRemoteCommand` in `src/cli/commands/remote.ts`, preserving registration, enrollment, invite-bundle bootstrap, inbox, messaging, signed acknowledgement, heartbeat, service-plan, and runner behavior.

- [x] **Step 3: Route through `CommandRouter`**

`src/cli/index.ts` now registers `createRemoteCommand` and no longer owns a direct `remote` command branch.

## Task 3: Verification

- [x] **Step 1: Build**

```powershell
npm.cmd run build
```

Evidence: build exited 0 after the Slice 28 command migrations.

- [x] **Step 2: Focused module tests**

```powershell
node --test dist\__tests__\cli-rooms-command.test.js dist\__tests__\cli-remote-command.test.js
```

Evidence: focused room/remote tests passed.

## Final Acceptance Gate

Slice 28 is complete when:

- `src/cli/commands/rooms.ts` owns `rooms` command flow and `room` shortcut normalization/help.
- `src/cli/commands/remote.ts` owns `remote` command flow.
- `src/cli/index.ts` routes both command groups through `CommandRouter`.
- Existing command names, output contracts, token-safe evidence behavior, room routing semantics, signed delivery semantics, and close behavior are preserved.
- Build and focused command-module tests pass.

## Self-Review

- Spec coverage: This slice migrates the remaining room/remote command groups before phase gates.
- Placeholder scan: The plan includes exact files, commands, behavior contracts, and verification.
- Type consistency: Command factories return `CommandModule<void>` and receive existing helpers/services through dependency injection.
- Phase boundary: No phase verifier, room routing protocol, remote runner evidence contract, MCP runtime, memory priority, policy decision semantic, or plugin execution semantic is intentionally changed.

# Workspace Runtime JSON-RPC

This document defines the first Rust-ready boundary for `WorkspaceRuntime`.

The goal is interchangeability:

```text
TypeScript AgentLoop / tools / policy
  -> WorkspaceRuntime interface
  -> LocalWorkspaceRuntime
  -> or JsonRpcWorkspaceRuntime
       -> JSON-RPC over stdio
       -> Rust agent-runner process
```

The TypeScript orchestration layer remains the owner of sessions, approvals, audit, model calls, worker leases, and policy decisions. Rust owns only the runtime work delegated through this boundary. Rust-backed runtimes must still be invoked through the same TypeScript `createWorkspaceTools` and `withPolicy` chain, so file-change records, `tool.*` audit, `command.*` audit, and approval requests stay in one governance path.

The Rust worker must preserve the TypeScript workspace boundary: `.git/**` and `.agent/**` are protected from direct runner reads/writes, while `.agent/tmp/**` remains the default agent-private temporary exception. The shared compatibility smoke checks these protected-path rules against `LocalWorkspaceRuntime`, and the tools/policy/audit smoke checks that a Rust-backed `apply_patch` / `run_command` still records TypeScript file-change, audit, and approval evidence.

## Transport

- Protocol: JSON-RPC 2.0.
- Framing: newline-delimited JSON, one request or response per UTF-8 line.
- Client: TypeScript `JsonRpcWorkspaceRuntime`.
- Server: Rust `agent-runner` or any compatible worker.
- `stdout`: JSON-RPC responses only.
- `stderr`: diagnostic logs only.

The schema is exported from `src/workspace/workspace-runtime-jsonrpc-schema.ts` as `WORKSPACE_RUNTIME_JSONRPC_SCHEMA`.

## Version

Current protocol version:

```text
workspace-runtime-jsonrpc.v1
```

Versioning rule: add optional fields first. Any breaking semantic change should create a new protocol version and a compatibility test that proves the old TypeScript local runtime and the new JSON-RPC runtime still agree for the supported method set.

## Methods

All method params mirror the current TypeScript `WorkspaceRuntime` input types. All result shapes mirror the current TypeScript result types.

```text
workspace/listFiles
workspace/readFile
workspace/searchText
workspace/runCommand
workspace/applyPatch
workspace/createFile
workspace/replaceRange
```

Example request:

```json
{"jsonrpc":"2.0","id":1,"method":"workspace/readFile","params":{"path":"README.md","startLine":1,"endLine":5}}
```

Example response:

```json
{"jsonrpc":"2.0","id":1,"result":"1: # Project\n2: ..."}
```

## Protocol Choice

JSON-RPC over stdio is the initial internal runner protocol because it is easy to debug, easy to fixture in tests, works naturally across TypeScript and Rust processes, and does not force a long-lived network server into local mode.

MCP is not the primary runner protocol. MCP remains the external tool/capability protocol for third-party servers, resources, and tools. A future adapter can expose runner operations through MCP if that is useful, but the core workspace runner should stay smaller and stricter than a general MCP server.

Protocol Buffers are a possible later transport encoding, not the first boundary. Protobuf becomes attractive when runner traffic needs compact binary payloads, streaming artifact metadata, or language-wide generated types. Until then, stable method names, schema snapshots, and compatibility tests give the smoother migration path. If Protobuf is added, it should preserve the same semantic method set and run beside JSON-RPC during a compatibility window.

## Phase Rules

Runtime integration follows this rule across the roadmap: product-aggregated, runtime-decoupled.

- Phase 1 keeps Rust optional and out of the first-run path.
- Phase 2 freezes this schema, adapter, compatibility tests, and tools/policy/audit smoke before moving more execution into Rust.
- Phase 3 UI surfaces consume control-plane/session/operator views rather than runner internals.
- Phase 4 packages Rust workers per platform without changing the user-facing `soloclaw` command shape.
- Phase 5 keeps room/control-plane/broker protocols separate from local runner protocols.
- Phase 6 hardens Rust/container/VM execution behind the same policy, approval, audit, artifact, and teardown contracts.

## Rust Crate Split

`agent-runner` owns command execution, path handling, timeouts, and runtime process boundaries.

`agent-diff` owns the current guarded create/modify/delete unified-diff application used by `agent-runner` for `workspace/applyPatch`. It is still a scaffold, not the final production diff engine: richer conflict recovery, rename handling, binary patches, and fuzz/adversarial coverage remain future hardening work.

`agent-indexer` should own tree-sitter and large repository indexing. It should not replace the runtime protocol; it can be invoked as a separate worker or behind a later search/index adapter.

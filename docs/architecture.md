# Architecture Blueprint

## Layering

```text
CLI / UI
  -> AgentLoop
  -> ModelClient
  -> ToolRuntime
  -> WorkspaceRuntime
```

The core rule is that the agent orchestration layer never talks directly to the filesystem or shell. It calls tools, and tools call a workspace runtime. Today the runtime is TypeScript. Later it can be replaced by a Rust worker without changing the agent loop.

## Packages Later

```text
@agent/core       AgentLoop, ContextManager, Planner
@agent/model      ModelClient and providers
@agent/tools      Tool definitions
@agent/workspace  permissions, snapshots, runtime
@agent/session    SQLite session store
@agent/cli        terminal UX
@agent/ui         web app
```

## Rust Migration Boundary

Start with:

```text
TS AgentLoop
  -> WorkspaceRuntime interface
  -> LocalWorkspaceRuntime implementation
```

Then replace with:

```text
TS AgentLoop
  -> JsonRpcWorkspaceRuntime
  -> Rust worker over stdio
```

The first concrete protocol is newline-delimited JSON-RPC 2.0 over stdio. The schema lives in `src/workspace/workspace-runtime-jsonrpc-schema.ts`, the TypeScript adapter lives in `src/workspace/json-rpc-workspace-runtime.ts`, the Rust worker scaffold lives in `crates/agent-runner`, and the initial Rust patch engine scaffold lives in `crates/agent-diff`. The shared smoke tests cover both raw `WorkspaceRuntime` compatibility and the higher tools/policy/audit path. See `docs/workspace-runtime-jsonrpc.md`.

This is a deliberately decoupled boundary. TypeScript keeps orchestration, policy, sessions, approvals, audit, control-plane views, and model calls. Rust workers implement narrowly scoped runtime capabilities behind the same `WorkspaceRuntime` method set and are wrapped by the same `createWorkspaceTools` / `withPolicy` path before use. MCP remains the external tool/capability protocol, not the default internal runner protocol; Protobuf can be added later as a versioned binary encoding if runner traffic needs it.

Best first Rust modules:

1. `agent-runner`: command execution, timeouts, output truncation, permission checks.
2. `agent-indexer`: tree-sitter symbols and large-repo indexing.
3. `agent-diff`: robust patch parsing and application.

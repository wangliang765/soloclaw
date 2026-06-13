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

Best first Rust modules:

1. `agent-runner`: command execution, timeouts, output truncation, permission checks.
2. `agent-indexer`: tree-sitter symbols and large-repo indexing.
3. `agent-diff`: robust patch parsing and application.

# Rust Crates

Keep Rust out of the first product loop. Add crates when the TypeScript runtime boundary is stable.

Planned crates:

- `agent-runner`: command execution, permissions, timeouts.
- `agent-indexer`: tree-sitter symbols, imports, large repository index.
- `agent-diff`: patch parsing and application.

Current crate scaffold:

- `agent-runner`: JSON-RPC-over-stdio worker shape for the `WorkspaceRuntime` boundary.
- `agent-diff`: guarded create/modify/delete unified-diff application used by `agent-runner` for `workspace/applyPatch`.

The TypeScript side communicates with Rust workers through newline-delimited JSON-RPC 2.0 over stdio first. This keeps the runner process isolated and replaceable while preserving the existing TypeScript agent loop, policy, session, approval, and audit layers. The Rust-backed tools/policy/audit smoke wraps `agent-runner` in the normal TypeScript `createWorkspaceTools` and `withPolicy` path to prove those layers are still used. Native bindings can come later if profiling proves the need.

Protocol notes:

- JSON-RPC is the core internal runner protocol because it is simple to inspect, test, and route over stdio.
- MCP remains the external tool/capability protocol. Do not make the workspace runner pretend to be an MCP server unless a future adapter intentionally exposes it that way.
- Protobuf can be added later as a versioned transport encoding if large binary artifacts or very high-throughput runner traffic justify it. Keep the method names and semantic result shapes stable first.

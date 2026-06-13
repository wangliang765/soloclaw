# Rust Crates Placeholder

Keep Rust out of the first product loop. Add crates when the TypeScript runtime boundary is stable.

Planned crates:

- `agent-runner`: command execution, permissions, timeouts.
- `agent-indexer`: tree-sitter symbols, imports, large repository index.
- `agent-diff`: patch parsing and application.

The TypeScript side should communicate with future Rust workers through JSON-RPC over stdio first. Native bindings can come later if profiling proves the need.

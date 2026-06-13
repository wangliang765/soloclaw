# Plugin Strategy

## Goal

Plugins extend agent capabilities. They are not independent room participants.

```text
room member = user or agent
plugin = capability attached to an agent
```

## Compatibility

Support open plugin compatibility:

```text
local TypeScript/JavaScript plugins
external command plugins
MCP servers
future WASM plugins
custom private plugins
```

## Manifest

```json
{
  "name": "example-plugin",
  "version": "0.1.0",
  "permissions": [
    "workspace.read",
    "network.fetch"
  ],
  "tools": [
    "example.search"
  ]
}
```

Current local command-plugin manifests live at:

```text
.agent/plugins/<plugin-name>/plugin.json
```

Example:

```json
{
  "name": "example",
  "version": "0.1.0",
  "description": "Local echo plugin.",
  "permissions": ["shell.run"],
  "commands": [
    {
      "name": "echo",
      "description": "Echo JSON input from stdin.",
      "command": "node",
      "args": ["echo.mjs"],
      "risk": "low",
      "timeoutMs": 5000
    }
  ]
}
```

The tool name becomes:

```text
plugin.example.echo
```

CLI:

```text
agent plugins list
agent plugins show example
agent plugins run plugin.example.echo '{"message":"hello"}'
agent plugins run plugin.example.echo --execution-mode strict '{"message":"approval smoke"}'
```

Command plugins receive JSON input on stdin. The local runner spawns the command without a shell, sets plugin metadata in environment variables, truncates large output, redacts common secret patterns, records `plugin.executed` audit events, and exposes the tool to the agent loop. Plugins do not receive room authority; when a plugin is run with `--room`, the invoking user or agent writes the room artifact event.

## Isolation

Default plugin policy:

```text
no filesystem access unless declared
no network access unless declared
no secret access unless declared and approved
no shell access unless declared and approved
outputs pass through redaction
all tool executions are audited
```

Isolation options:

```text
same process for trusted built-ins
child process for local plugins
container for untrusted/high-risk plugins
WASM sandbox later
```

## Room Interaction

Plugins cannot join rooms directly.

Allowed:

```text
agent invokes plugin
plugin returns result
agent posts summary or artifact to room
room transcript records plugin execution
```

Denied:

```text
plugin sends room messages directly
plugin approves tool calls directly
plugin receives room transcript without agent permission
```

## MCP Registry and Runtime Boundary

MCP support starts with a registry and a separate runtime boundary. The local MVP stores non-secret server metadata in `.agent/mcp-servers.json`:

```text
agent mcp register filesystem --transport stdio --command mcp-filesystem --arg --root --arg . --env-var MCP_FS_TOKEN --cap resources --cap tools
agent mcp register docs --transport http --url https://mcp.example.test/rpc --env-var MCP_DOCS_TOKEN --cap resources --risk high
agent mcp list --json
agent mcp show filesystem
agent mcp plan filesystem --execution-mode trusted --project proj_local --json
agent mcp capabilities filesystem --execution-mode full_access --secret-env MCP_FS_TOKEN=sec_xxxxxxxx --json
agent mcp call-tool filesystem fs.list --input-json "{\"path\":\".\"}" --execution-mode full_access --secret-env MCP_FS_TOKEN=sec_xxxxxxxx
agent mcp read-resource docs docs://status --execution-mode full_access --secret-env MCP_DOCS_TOKEN=sec_xxxxxxxx
agent mcp health filesystem --json
agent mcp remove filesystem
```

The registry records:

- stable server id and display name;
- transport: `stdio` or `http`;
- stdio command/args or HTTP URL;
- environment variable names only, never raw secret values;
- declared capabilities: `tools`, `resources`, `prompts`, `sampling`;
- local policy metadata: enabled flag, risk, approval requirement, allowed project ids, and allowed room ids.

Registration and removal emit `mcp.server_registered` and `mcp.server_removed` audit events with safe metadata. `agent mcp plan` creates a non-side-effecting connection plan: it checks whether the server is enabled, whether the current project/room is allowed, whether `mcp.connect` passes policy for the requested execution mode and risk, and whether the server requires approval. The plan emits `mcp.connection_planned` audit metadata and returns `allow`, `ask`, or `deny`.

The registry and planner still do not execute servers directly. `LocalMcpRuntime` is the first execution boundary implementation for stdio and HTTP JSON-RPC capability calls. It can initialize a server, list tools/resources, call a tool, read a resource, bound textual outputs, and redact leased env secrets supplied at connection time.

`McpExecutionService` is the policy-gated execution entrypoint. It runs `McpConnectionPlanner` first, resolves required env var names through `PolicySecretBroker` leases, evaluates `mcp.tool.call` or `mcp.resource.read` for tool/resource operations, revokes leases after execution, and records `mcp.executed` audit summaries without raw output or secret values. Secret env mappings can be supplied through `--secret-env NAME=sec_xxxxxxxx` or `MCP_SECRET_NAME=sec_xxxxxxxx`.

When MCP policy returns `ask`, the service creates an approval request with a bound MCP continuation payload. `agent approve <approval-id> --auto-replay` can continue the approved MCP operation and still runs through planning, secret leases, redaction, and `mcp.executed` audit.

Set `AGENT_MCP_EXECUTION=disabled` to globally block MCP execution without deleting registry entries. Disabled, timeout, transport, and runtime failures record safe `mcp.executed` metadata; raw tool/resource output and secret values stay out of audit rows.

`agent mcp health <server-id>` runs the safe planning/probe path and reports `healthy`, `disabled`, `blocked`, `timeout`, or `failed` status for local diagnostics. Health results are intended for Web/TUI display and avoid raw tool/resource output.

Remaining production work: Web/API execution surfaces, agent-tool integration behind explicit grants, sandbox/process/network constraints, signed approval envelopes, and stronger quorum continuation.

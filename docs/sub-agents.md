# Sub-Agents and Delegated Sessions

## Goal

Sub-agents execute delegated subtasks in separate sessions so the main agent does not carry all subtask context in its own prompt.

This is useful for:

- long-running subtasks;
- parallel investigation;
- code review or verification;
- isolating risky exploration;
- reducing main session context size;
- assigning work to agents on the same machine or another machine.

## Core Idea

```text
main session
  -> creates child session
  -> assigns subtask to sub-agent
  -> sub-agent works independently
  -> child session stores full transcript/tool trace
  -> main session receives compact result summary + artifact refs
```

The child session owns detailed context. The parent session stores only:

```text
subtask objective
child session id
status
result summary
artifact refs
decision notes
```

## Relationship to Rooms

Sub-agents and rooms should be linked.

```text
room
  -> main agent
  -> child agent A
  -> child agent B
  -> human observer/approver
```

The room is the coordination and audit surface. Child sessions are execution records.

Room events:

```text
subtask.created
subtask.assigned
subtask.status
subtask.result
subtask.cancelled
subtask.failed
```

## Local Main Agent + Local Sub-Agent

For local professional mode:

```text
main agent
  -> spawn child session in same process
  -> use same workspace runtime
  -> use file-level locks
  -> write child transcript to SQLite
```

Different child agents may work on different files concurrently. The lock manager prevents two agents from writing the same file.

## Distributed Sub-Agent

For private distributed mode:

```text
main agent
  -> room task assignment
  -> control plane selects capable agent worker
  -> remote child session starts
  -> room receives progress events
  -> result summary returns to parent
```

## Delegation Policy

Delegation should be policy checked.

Capabilities:

```text
task.delegate
subagent.spawn.local
subagent.spawn.remote
subagent.cancel
subagent.read_result
subagent.merge_result
```

Delegation metadata:

```text
parent_session_id
child_session_id
room_id
assigned_agent_id
objective
allowed_tools
execution_mode
risk
status
created_at
completed_at
```

## Result Contract

Every child agent must return a compact result:

```text
status
summary
changed_files
tests_run
open_questions
artifact_refs
recommended_parent_action
```

The parent can request more detail by opening the child session, but the default parent context receives only the compact result.

## Suggested Tables

```text
subtasks
subtask_events
session_links
```

`session_links` can represent:

```text
parent_child
room_session
handoff
review_of
```

## Minimal First Version

Build this first:

```text
agent delegate "subtask"
  -> creates child session
  -> runs child agent loop
  -> stores child transcript
  -> returns summary to parent
```

Then connect it to rooms:

```text
room task assignment
  -> child session
  -> room progress events
  -> room result event
```

## Current Local Room Link

The CLI can now delegate a subtask into a room:

```text
agent delegate --room <room-id> --assigned-agent <agent-id> "subtask"
```

Current behavior:

- the assigned agent is added to the room as an active `executor`;
- the room transcript receives a `task` message when the subtask is assigned;
- the child agent runs in a separate session;
- the room transcript receives a `decision` message with the child session id and compact result summary;
- the subtask row stores `room_id`, `assigned_agent_id`, status, child session id, and result summary.

This is still local-only. Production distributed delegation must replace the direct child-session call with worker assignment, heartbeats, durable checkpoints, and signed room events.

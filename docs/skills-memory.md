# Skills and Persistent Memory

## Goal

Skills make agents better at repeatable workflows. Persistent memory lets agents retain useful project, user, and organization knowledge over time without keeping every old transcript in the active prompt.

## Skills

A skill is a packaged capability description plus optional assets, scripts, templates, and tool requirements.

Examples:

```text
frontend-review
security-audit
rust-runner-debug
github-pr-polish
database-migration-check
```

Skill package:

```text
SKILL.md
manifest.json
assets/
scripts/
templates/
tests/
```

Manifest:

```json
{
  "name": "frontend-review",
  "version": "0.1.0",
  "description": "Review frontend changes and verify UI behavior.",
  "permissions": [
    "workspace.read",
    "shell.run.safe",
    "browser.inspect"
  ],
  "tools": [
    "read_file",
    "search_text",
    "run_command"
  ]
}
```

## Skill Loading

Skills should be loaded by policy, not blindly.

Skill scopes:

```text
builtin
user
project
organization
plugin
```

Skill resolution:

```text
task intent
  -> available skills
  -> policy filter
  -> selected skills
  -> compact skill instructions injected into context
```

The full skill files should not always enter the prompt. Load only the needed sections or a precomputed summary.

## Skill Safety

Skills can influence model behavior, so treat third-party skills as untrusted instructions.

Controls:

```text
manifest permissions
signature or checksum
source trust level
policy checks before tool use
skill content separated from system policy
audit selected skills
```

## Persistent Memory

Memory should be structured and scoped.

Scopes:

```text
user memory
project memory
repository memory
organization memory
room memory
agent memory
```

Memory types:

```text
preference
project_fact
architecture_note
decision
bug_pattern
workflow
credential_reference
do_not_do
```

Memory record:

```text
id
scope_type
scope_id
kind
content
summary
source_session_id
confidence
created_at
updated_at
expires_at
last_used_at
```

## Memory Lifecycle

```text
session transcript
  -> summarizer extracts candidate memories
  -> policy/privacy filter
  -> user or auto approval depending on scope
  -> memory store
  -> retrieval during future tasks
```

Long-term transcripts should be compacted:

```text
raw messages
  -> session summary
  -> durable memories
  -> artifact archive
```

Current local status:

```text
agent session compact <session-id>
  -> writes session_summaries
  -> removes hot messages and tool-call rows
  -> records session.compacted audit event

retention apply <project-id>
  -> compacts sessions according to the project retention policy
```

Production compaction should also trigger when a session approaches the model context window, when a long-running task reaches a checkpoint, or when retention policy moves hot transcript data into colder storage. Summaries should be incremental, versioned, auditable, and safe to inject back into resume context before recent uncompressed messages.

## Retrieval

Use layered retrieval:

```text
exact project/repo facts
  -> recent session summaries
  -> keyword search
  -> semantic search later
```

Avoid over-injecting memory. The context manager should include only memories that are relevant to the current task and safe for the current actor.

## Memory Safety

Controls:

```text
memory is never higher priority than system policy
repo-derived memories are marked untrusted unless validated
secret-like content is denied or stored as secret reference
users can inspect/delete memories
project retention policy applies
```

## Suggested Tables

```text
skills
skill_versions
skill_sources
skill_usage_events
memories
memory_sources
memory_usage_events
session_summaries
```

## Minimal First Version

Skills:

```text
load local skills from .agent/skills and builtins
validate manifest
inject selected skill summary
audit skill usage
```

Memory:

```text
store session summaries
allow manual memory add/list/delete
retrieve project memories by keyword
```

Later:

```text
automatic memory extraction
semantic retrieval
organization memory governance
skill marketplace / plugin skills
```

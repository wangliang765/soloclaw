# Execution Target Modes

Agent sessions have a target mode that describes how the agent should treat the user's objective.

This is separate from execution permission mode:

```text
target_mode: plan | build | goal
execution_mode: strict | balanced | trusted | full_access
```

`target_mode` controls workflow behavior. `execution_mode` controls approval and tool permission policy.

## Plan Mode

```text
agent plan "objective"
agent run --target-mode plan "objective"
```

Plan mode:

- creates a session with `targetMode = plan`;
- does not expose tools to the model;
- does not execute tools;
- asks the model for a concrete implementation plan, risks, and verification steps;
- completes after producing the plan.

Use it when the user wants design, decomposition, review, or clarification before allowing workspace changes.

## Build Mode

```text
agent build "task"
agent run --target-mode build "task"
agent run "task"
```

Build mode is the default local behavior.

Build mode:

- creates a session with `targetMode = build`;
- runs the normal tool loop;
- follows the current prompt as the task boundary;
- stops when the model returns a final answer, needs approval, fails, or reaches the step limit.

Use it for bounded implementation tasks.

## Goal Mode

```text
agent goal "objective"
agent run --target-mode goal "objective"
```

Goal mode:

- creates a session with `targetMode = goal`;
- runs the normal tool loop;
- instructs the agent to form and follow a plan;
- uses a higher default step limit than build mode;
- continues until the objective is completed, blocked by required input, paused for approval, stopped by policy, or reaches the step limit.

Use it for longer objectives where the agent should keep pushing toward completion rather than only answering the immediate prompt.

## Current Implementation

Current local MVP:

```text
plan -> one model call, tools disabled
build -> existing tool loop
goal -> existing tool loop + goal-oriented prompt + higher max steps
```

Sessions persist `targetMode` in SQLite and memory stores. Existing sessions and older local databases default to `build`.

## Production Additions

Goal mode should later add durable goal state:

```text
goals
goal_plan_steps
goal_checkpoints
goal_blockers
goal_budget
goal_resume_policy
```

Spec-driven goal mode should use a durable specification as its planning source:

```text
specification
  -> clarification
  -> plan
  -> tasks
  -> goal execution
  -> verification
```

`github/spec-kit` compatibility should live at the import/export/plugin layer. The native goal records remain the source of truth during execution. See `docs/spec-driven-development.md`.

Production goal mode should support:

- resumable plan checkpoints;
- explicit completed/blocked status transitions;
- budget and stop policies;
- scheduler/worker continuation;
- room-visible progress updates;
- child sub-agent delegation;
- verification gates before completion.

# Spec-Driven Development Integration

## Position

`github/spec-kit` is useful as a specification-driven development workflow, but it should not become a required core runtime dependency.

This project should adopt the method and provide compatibility, while keeping the platform-native contracts in `.agent`, sessions, rooms, policy, audit, workers, and artifacts.

## Non-Conflict Decision

Use this boundary:

```text
.agent/
  platform-private runtime state
  sessions, policy, rooms, secrets, artifacts, workers

.specify/
  optional external spec-kit-compatible workspace
  specs, plans, tasks, constitution
```

Rules:

- `.agent` remains private platform state and is protected by workspace-tool hygiene.
- `.specify` is project content and may be read/written only when the user opts into spec workflows.
- Spec-kit files never bypass policy, approval, retention, audit, room permissions, workspace locks, or target modes.
- Spec-kit task files are inputs to our scheduler/goal planner, not a replacement for our task assignment leases.
- External spec-kit CLI execution, if supported, must run as a plugin/tool under normal policy.

Protocol boundaries:

- Rooms should reference specs by native `specId` plus optional source path; `.specify` markdown files are not room protocol messages.
- Task assignment leases stay native broker/control-plane records; imported checklist items become planned tasks before any worker can claim them.
- Plugin tools must use a namespaced shape such as `plugin.spec-kit.*`; they do not gain direct access to `.agent` state, room membership, or secret material.
- RAG may index spec artifacts as project knowledge, but retrieved spec text remains cited context and cannot override system, policy, or room instructions.
- Audit events record every import, export, generated task, external CLI run, and goal execution transition.

## Three-Layer Integration

### Layer 1: Adopt The Method

Adopt the workflow inside our native model:

```text
constitution
  -> spec
  -> clarification
  -> technical plan
  -> tasks
  -> goal execution
  -> verification
```

Mapping:

```text
constitution -> project execution standards + org/project policy
spec         -> durable goal specification
plan         -> goal plan/checkpoints
tasks        -> subtasks / task assignments
implement    -> goal mode worker execution
```

How target modes use it:

```text
plan  -> produce or refine spec/plan only, no tools
build -> execute the current prompt, optionally using a spec as context
goal  -> execute tasks from spec/plan until the goal is complete or blocked
```

Native commands to add:

```bash
agent spec init
agent spec create "feature objective"
agent spec clarify <spec-id>
agent spec plan <spec-id>
agent spec tasks <spec-id>
agent goal --spec <spec-id>
```

### Layer 2: Compatibility Layer

Support reading and writing spec-kit-compatible folders without making them mandatory.

Import:

```text
.specify/specs/<feature>/spec.md
.specify/specs/<feature>/plan.md
.specify/specs/<feature>/tasks.md
.specify/memory/constitution.md
```

Export:

```text
native goal/spec state
  -> .specify/specs/<feature>/spec.md
  -> .specify/specs/<feature>/plan.md
  -> .specify/specs/<feature>/tasks.md
```

Compatibility commands:

```bash
agent spec import .specify/specs/001-feature
agent spec export <spec-id> --format specify
agent spec status
```

Compatibility rules:

- Preserve source paths and section headings.
- Keep imported task IDs stable when possible.
- Store import/export provenance in metadata.
- Do not assume spec-kit's generated tasks are safe to execute without policy.
- Imported tasks become planned work; they do not automatically run.

### Layer 3: Optional Plugin

Provide a plugin for users already invested in `github/spec-kit`.

Plugin shape:

```text
plugin.spec-kit.import
plugin.spec-kit.export
plugin.spec-kit.run
plugin.spec-kit.validate
```

Plugin rules:

- Plugin is optional.
- It can call external `specify`/spec-kit CLI only under normal plugin policy.
- It cannot read secrets or `.agent` private state.
- It cannot directly join rooms.
- It emits artifacts and audit events through the host platform.
- It must be sandboxable before production use.

## Data Model Additions

Recommended native records:

```text
specifications
spec_versions
spec_clarifications
spec_plans
spec_tasks
spec_task_dependencies
spec_imports
spec_exports
```

Minimal TypeScript domain:

```ts
type Specification = {
  id: string;
  orgId?: string;
  projectId?: string;
  roomId?: string;
  title: string;
  objective: string;
  status: "draft" | "planned" | "ready" | "in_progress" | "completed" | "blocked" | "archived";
  source: "native" | "specify_import" | "plugin";
  createdBy: ActorRef;
  createdAt: string;
  updatedAt: string;
};

type SpecificationTask = {
  id: string;
  specId: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  parallelizable: boolean;
  paths: string[];
  dependsOn: string[];
  verification?: string;
};
```

## Room And Sub-Agent Integration

Rooms should treat specs as shared planning artifacts:

```text
room
  -> spec proposed
  -> clarifications discussed
  -> tasks approved
  -> subtasks delegated
  -> progress events posted
```

Sub-agents can consume individual spec tasks:

```text
spec task
  -> subtask
  -> child session
  -> compact result
  -> spec task status update
```

Do not let multiple agents edit the same spec task artifact concurrently without the same workspace lock rules used for files.

## Policy And Security

Spec workflows must obey existing platform policy:

- Creating or editing `.specify/**` is a workspace write.
- Running external spec-kit commands is plugin or shell execution.
- Generated tasks are untrusted until reviewed or produced by trusted policy.
- Task execution still goes through `executionMode` and room/org grants.
- Secret values must not be written into specs, plans, tasks, or generated artifacts.
- Prompt injection inside imported specs is treated as untrusted document text.

## Compatibility With Current Design

No conflicts found with current core concepts:

| Current concept | Spec integration |
| --- | --- |
| `targetMode=plan` | produces/refines spec and plan without tools |
| `targetMode=build` | can use a spec as context but stays prompt-scoped |
| `targetMode=goal` | consumes spec tasks as durable goal plan |
| sub-agents | execute spec tasks as child sessions |
| rooms | coordinate spec discussion, approvals, and progress |
| workspace locks | protect spec files and implementation files |
| policy engine | gates all spec file writes and external commands |
| plugins | optional spec-kit adapter, not a room member |
| RAG | can index specs as project knowledge with citations |
| retention | specs are project artifacts subject to retention/legal hold |

## Implementation Phases

### Phase 1: Native SDD Skeleton

Implemented locally:

- `Specification` and `SpecificationTask` domain types.
- `SpecificationVersion` snapshots and `SpecificationClarification` records.
- `SpecificationPlan` records generated from the current spec or a frozen spec version.
- SQLite and memory store methods.
- `SpecificationService`.
- `agent spec create/list/show/version/versions/diff/plan/plans/request-plan-approval/clarify/clarifications/answer/task/tasks/validate/next/status/verify/evidence/delegate/dispatch`.
- `agent goal --spec <id>` spec context injection.
- `agent spec version <spec-id>` freezes the current spec and task list into a durable local snapshot.
- `agent spec diff <spec-id>` compares frozen versions or a frozen version against current spec state.
- `agent spec diff <spec-id> --save-artifact` persists the diff as a `report` artifact with JSON metadata, SHA-256, audit refs, and room progress projection.
- `agent spec plan <spec-id>` creates a durable generated plan with dependency-ordered steps, verification hints, risk hints, and open clarification blockers.
- `agent spec request-plan-approval <spec-id> <plan-id>` creates a scoped approval request for dispatching against a generated plan.
- `agent spec dispatch <spec-id> --plan <plan-id> --require-plan-approval` requires an active plan with approved `spec.plan.approve` requests before ready tasks are delegated.
- Plan dispatch approval gates count distinct approvers; `--required-plan-approvals <n>` overrides the threshold, otherwise room-scoped specs inherit `room.policy.requiredApprovals` and non-room specs default to one approver.
- `agent spec clarify <spec-id>` and `agent spec answer <spec-id> <clarification-id>` track open, answered, and resolved planning questions.
- Spec-task-to-subtask delegation with a paused child goal session that worker assignments can resume.
- Assignment completion/failure updates the linked spec task.
- Delegation is dependency-aware: `dependsOn` task IDs must exist in the same spec, and every dependency must be `completed` before delegation.
- `agent spec next <spec-id>` lists pending tasks whose dependencies are complete.
- `agent spec validate <spec-id>` checks the full task dependency DAG for missing dependencies, self-dependencies, duplicate dependencies, and cycles.
- `agent spec dispatch <spec-id> --worker <worker-id>` delegates ready tasks and assigns them to the worker.
- `agent spec dispatch <spec-id> --auto-select-worker` picks an online, non-full, project-eligible worker with the lowest load ratio.
- `agent spec dispatch` supports local backpressure guards with `--max-load-ratio` and `--max-queued-per-worker`, applied before delegation so blocked dispatch does not create orphan child sessions.
- `agent scheduler tick|run --dispatch-spec <spec-id>` can dispatch ready spec tasks before worker polling.
- `agent scheduler tick|run --dispatch-spec <spec-id>` can pass dispatch backpressure via `--dispatch-max-load-ratio` and `--dispatch-max-queued-per-worker`.
- `agent spec verify <spec-id> <task-id> passed|failed <evidence>` records structured local verification evidence.
- `agent spec evidence <spec-id> <task-id> --provider github|gitlab|generic --conclusion ...` records structured CI/provider evidence and registers linked report artifacts when a run URL is provided.
- `agent spec verifications <spec-id> [task-id]` lists durable verification history.
- Tasks with `verification` requirements are blocked on assignment completion until a persisted passed verification record exists.
- Room-scoped specs emit transcript progress messages for spec creation, task creation/status, versions, plans, clarifications, and verification; each message carries a structured `eventEnvelope` in room-message metadata, and local-agent senders can Ed25519-sign the full message including that envelope.
- `spec.created`, `spec.version_created`, `spec.plan_created`, `spec.plan_approval_requested`, `spec.clarification_created`, `spec.clarification_updated`, `spec.task_created`, `spec.task_delegated`, `spec.task_verified`, and `spec.task_updated` audit events.

Remaining before production:

- Richer generated technical plans backed by model/tool evaluation.
- Object-storage diff payloads, signed plan approval envelopes/state machine, and import/export provenance.
- Webhook/API-backed CI/provider integrations and tamper-resistant evidence bundles.
- Broker-native signed room event envelopes and replay-safe progress streams.
- Broker-native queue metrics, signed progress streams, and production scheduler daemon integration.

### Phase 2: spec-kit Compatibility

- Import `.specify/specs/*`.
- Export native specs to `.specify`.
- Parse task checkboxes, dependency notes, parallel markers, and file paths.
- Add tests for import/export round trips.

### Phase 3: Optional spec-kit Plugin

- Add `plugin.spec-kit.*`.
- Run external CLI through plugin policy.
- Register generated files as artifacts.
- Add sandbox and signed plugin package requirements before production.

## Recommendation

Adopt the spec-kit workflow immediately as a native SDD design, add `.specify` compatibility in the next local-team iterations, and keep direct spec-kit CLI integration optional through the plugin system.

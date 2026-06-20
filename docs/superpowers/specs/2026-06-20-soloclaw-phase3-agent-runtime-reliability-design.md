# Soloclaw Phase 3 Agent Runtime Reliability Design

## Purpose

Phase 2 made Soloclaw usable as a dedicated TUI with model setup, live event rows, Plan/Build/Goal mode selection, and real-provider smoke coverage. Phase 3 turns that shell into a reliable local coding runtime: when a user gives Soloclaw a real project task, the agent should make observable progress, stop with a resumable state when it must stop, recover from common command/test failures, and leave machine-checkable evidence.

This design intentionally uses the current conversation's Phase 3 meaning: **agent runtime reliability**. The older repository roadmap also has a "Phase 3 Visual control plane" label. That roadmap remains useful for product sequencing, but this branch's deliverable is the current Soloclaw execution line: make long local engineering tasks complete more reliably before expanding visual control-plane work.

## User Promise

A user can type `soloclaw`, choose `Build` or `Goal`, ask for a small-to-medium change in a real workspace such as `E:\code\tafang`, watch safe progress rows while the task runs, and trust Soloclaw to either:

- finish with changed files plus verification evidence;
- pause with a clear approval or policy reason;
- stop at a budget boundary with a precise resume instruction and enough session state to continue;
- fail visibly without crashing the shell or hiding what happened.

## Scope

Phase 3 covers the local runtime path used by CLI and rich TUI:

- `src/core/agent-loop.ts`
- `src/core/agent-events.ts`
- `src/core/agent-message-projector.ts`
- `src/cli/tui/*`
- `src/cli/index.ts`
- `src/sessions/session-inspection-view.ts`
- focused tests in `src/__tests__/security.test.ts`, `src/__tests__/rich-tui.test.ts`, and `src/__tests__/agent-events.test.ts`

The phase also adds Phase 3-specific smoke and gate commands so reliability claims are backed by repeatable evidence.

## Non-Goals

- Do not build the Web visual control plane in this phase.
- Do not introduce a second runtime stack or bypass `WorkspaceRuntime`, policy, audit, or session storage.
- Do not expose raw command bodies, raw command output, patch bodies, API keys, vault passphrases, bearer tokens, or Authorization headers in the default TUI progress lane.
- Do not make Goal mode run forever without explicit user continuation or a configured worker/scheduler policy.
- Do not require Rust, Docker, or external services to pass the local Phase 3 gate.

## Requirements

### R1. Step-Budget Stops Become First-Class Runtime Stops

When the agent reaches its step budget, the runtime must record and surface a structured stop state rather than only returning a plain final string. The stop state must include:

- `kind=step_budget`
- session id when available;
- target mode;
- max steps;
- resume command;
- short reason safe for TUI display.

The TUI must show the stop as a run state and keep `/continue` or `/resume` available.

### R2. Resume Must Preserve Continuation Context

Resume must tell the model that the session is continuing after a stop or pause. The continuation prompt must include:

- previous objective;
- last known stop reason when available;
- instruction to continue from existing messages rather than restart discovery;
- instruction to verify before claiming completion.

Resume should continue through the same event stream and should not duplicate a new user task unless the session has no usable messages.

### R3. Goal Mode Needs Durable Progress Signals

Goal mode must persist enough structured progress to inspect whether it is actively moving toward completion. The first Phase 3 increment can store these signals as session audit metadata rather than adding new database tables:

- objective;
- target mode;
- stop reason;
- last step count;
- suggested next action;
- latest safe activity title.

Later durable goal tables remain compatible with this shape.

### R4. Recovery Must Be Verifiable

Common recoverable failures must be visible and machine-checkable:

- Windows-incompatible shell command followed by a successful platform-appropriate command;
- failed verification command followed by a successful verification command;
- failed tool result followed by successful progress;
- model empty-final repair followed by a visible final answer.

`agent session verify` already has recovery and model-call gates. Phase 3 should add a higher-level gate that runs representative C4/C5/C6 scenarios and reports which requirement failed.

### R5. Rich TUI Shows Reliability State

The Work Ledger interface must show:

- `Run: Stopped` for step-budget stops;
- `Next: /continue or /resume` when the active session can continue;
- safe activity rows for retries and resumed progress;
- final result rows when the resumed task completes.

The TUI must never crash to a raw stack trace for model, secret, policy, tool, or step-budget failures. Failures should become visible system rows and run health updates.

### R6. Phase 3 Gate Uses Real Project Evidence

The local gate must produce repeatable evidence against a real workspace path. The standard sample workspace is `E:\code\tafang` when it exists. If it is missing, the gate may create a disposable sample under `.agent/tmp`, but the report must clearly say that the real workspace was unavailable.

The gate must include:

- C4: a small real-project Build task completes with a change and verification;
- C5: a budget-stopped Goal task resumes and completes the same objective;
- C6: a recoverable failure occurs and is followed by successful verification;
- final checks: `npm.cmd run check`, focused tests, rich TUI smoke, and secret-shape scan.

## Architecture

### Runtime Stop Snapshot

Add a small runtime stop model near the core agent loop. It should be serializable and safe to record in audit metadata:

```ts
export type AgentRuntimeStopKind = "step_budget" | "approval_required" | "model_error" | "tool_error";

export type AgentRuntimeStop = {
  kind: AgentRuntimeStopKind;
  sessionId?: string;
  targetMode: ExecutionTargetMode;
  maxSteps?: number;
  step?: number;
  reason: string;
  resumeCommand?: string;
};
```

The first implementation only needs to create `step_budget` stops from the step loop. Existing approval pauses remain separate session lifecycle events but can be mapped later.

### Event Stream

Extend `AgentRunEvent` with a safe runtime-stop event:

```ts
{
  type: "runtime_stopped";
  reason: string;
  stopKind: AgentRuntimeStopKind;
  targetMode?: ExecutionTargetMode;
  maxSteps?: number;
  resumeCommand?: string;
}
```

`step_limit_reached` can stay for compatibility; `runtime_stopped` is the richer Phase 3 signal consumed by TUI and session inspection.

### Resume Prompt

Before calling `runContext` on a resumed session, append a continuation user message:

```text
Continue this existing Soloclaw session.

Previous objective:
<objective>

Continuation reason:
<reason>

Continue from the existing transcript. Do not restart project discovery unless needed. Verify the remaining task before claiming completion.
```

This keeps resume behavior explicit without needing a new model API.

### Session Inspection

Session report and verification should count runtime-stop audit events and expose:

- `runtimeStops`;
- `lastRuntimeStopKind`;
- `lastRuntimeStopReason`;
- `resumeCommand`.

This enables a Phase 3 gate to fail when a stop is not resumable.

### Phase 3 CLI

Add a Phase 3 command group following the Phase 2 pattern but smaller:

```text
soloclaw phase3 checklist
soloclaw phase3 smoke --workspace E:\code\tafang --json
soloclaw phase3 gate --workspace E:\code\tafang --json
```

`phase3 smoke` should create and clean its own reversible evidence. It must not leave sample markers in the target project.

## Acceptance Evidence

### C4. Real Project Build Completion

Evidence must show:

- target workspace;
- session id;
- target mode `build`;
- at least one persisted file change;
- at least one successful verification command;
- visible final answer;
- cleanup restored the target workspace when the smoke created a reversible marker.

### C5. Goal Stop And Resume Completion

Evidence must show:

- target mode `goal`;
- first run stopped due to `step_budget`;
- TUI or CLI output includes resume guidance;
- resume continues the same session id;
- resumed run completes with visible final answer;
- session verify passes with appropriate flags.

### C6. Recovery Completion

Evidence must show:

- at least one failed command or failed tool result;
- later successful command verifies the objective;
- session inspection reports recovery;
- session verify passes with `--require-recovery`.

## Verification Commands

The final Phase 3 gate should run:

```powershell
npm.cmd run check
npm.cmd test
node dist\cli\index.js smoke --rich-tui --workspace E:\code\agent
node dist\cli\index.js phase3 gate --workspace E:\code\tafang --json
git diff --check
```

Real-provider long-task smoke should remain a recommended manual or operator check when the configured provider is available:

```powershell
node dist\cli\index.js smoke --rich-tui-real-provider-long-task --workspace E:\code\agent
```

## Safety

All new event and gate output must pass the existing redaction expectations:

- no plaintext API keys;
- no vault passphrases;
- no bearer tokens;
- no Authorization headers;
- no raw `.agent` secret file contents.

Phase 3 smoke output should report counts, statuses, paths, and session ids only.

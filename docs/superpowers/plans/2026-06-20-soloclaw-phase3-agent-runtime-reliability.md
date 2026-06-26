# Soloclaw Phase 3 Agent Runtime Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Soloclaw's local agent runtime reliably complete, stop, resume, and verify real project tasks through machine-checkable Phase 3 gates.

**Architecture:** Add a small structured runtime-stop layer to the existing `AgentLoop`, project it through the safe event stream, make resume continuation explicit, expose stop/resume evidence in session inspection, and add Phase 3 smoke/gate commands that exercise C4/C5/C6 against a real workspace. Keep the existing TUI, policy, audit, and workspace-runtime contracts intact.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing SQLite/memory `AgentStore`, existing Soloclaw rich TUI, existing workspace tools, existing session verification/report views.

---

## File Structure

- Create `src/core/agent-runtime-stop.ts`: serializable runtime stop types and formatting helpers.
- Modify `src/core/agent-events.ts`: add a safe `runtime_stopped` event.
- Modify `src/core/agent-loop.ts`: emit and record structured step-budget stops; append resume continuation context.
- Modify `src/core/agent-message-projector.ts`: project runtime stops into assistant/status parts when session timelines are rendered.
- Modify `src/cli/tui/event-renderer.ts`: render `runtime_stopped` as a folded, safe row.
- Modify `src/cli/tui/rich-shell.ts` and `src/cli/tui/state.ts` only if runtime-stop events do not already set stopped health and resume guidance through existing `step_limit_reached`.
- Modify `src/sessions/session-inspection-view.ts`: expose runtime stop counts and resumability fields in report/inspect/verify outputs.
- Modify `src/cli/index.ts`: add `phase3 checklist`, `phase3 smoke`, and `phase3 gate`.
- Test in `src/__tests__/agent-events.test.ts`: runtime-stop event defaults, redaction metadata, and projection.
- Test in `src/__tests__/rich-tui.test.ts`: runtime stop row and resume guidance.
- Test in `src/__tests__/security.test.ts`: AgentLoop stop/resume behavior, session inspection fields, and Phase 3 CLI smoke/gate.

## Task 1: Runtime Stop Event Model

**Files:**
- Create: `src/core/agent-runtime-stop.ts`
- Modify: `src/core/agent-events.ts`
- Modify: `src/core/agent-loop.ts`
- Test: `src/__tests__/agent-events.test.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write the failing event type test**

Add a test in `src/__tests__/agent-events.test.ts` that creates a `runtime_stopped` event with `withEventDefaults` and asserts the safe fields are preserved:

```ts
test("runtime stopped events keep safe resumability metadata", () => {
  const event = withEventDefaults({
    type: "runtime_stopped",
    runId: "run_phase3",
    sessionId: "sess_phase3",
    stopKind: "step_budget",
    targetMode: "goal",
    maxSteps: 2,
    reason: "Step budget reached before final answer.",
    resumeCommand: "agent resume sess_phase3",
  });

  assert.equal(event.type, "runtime_stopped");
  assert.equal(event.sessionId, "sess_phase3");
  assert.equal(event.stopKind, "step_budget");
  assert.equal(event.targetMode, "goal");
  assert.equal(event.maxSteps, 2);
  assert.equal(event.resumeCommand, "agent resume sess_phase3");
  assert.equal(typeof event.createdAt, "string");
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js --test-name-pattern "runtime stopped" }
```

Expected: TypeScript build fails because `runtime_stopped` is not in `AgentRunEvent`.

- [x] **Step 3: Add the runtime stop type file**

Create `src/core/agent-runtime-stop.ts`:

```ts
import type { ExecutionTargetMode } from "../domain/index.js";

export type AgentRuntimeStopKind = "step_budget" | "approval_required" | "model_error" | "tool_error";

export type AgentRuntimeStop = {
  kind: AgentRuntimeStopKind;
  sessionId?: string;
  targetMode: ExecutionTargetMode;
  step?: number;
  maxSteps?: number;
  reason: string;
  resumeCommand?: string;
};

export function formatRuntimeStopAnswer(stop: AgentRuntimeStop): string {
  const lines = [
    stop.kind === "step_budget"
      ? `Stopped after ${stop.maxSteps ?? "the configured"} steps without a final answer.`
      : `Stopped: ${stop.reason}`,
    stop.reason,
  ];
  if (stop.sessionId) {
    lines.push(`session: ${stop.sessionId}`);
  }
  if (stop.resumeCommand) {
    lines.push(`resume: ${stop.resumeCommand}`);
  }
  return lines.join("\n");
}

export function stepBudgetRuntimeStop(input: {
  sessionId?: string;
  targetMode: ExecutionTargetMode;
  maxSteps: number;
}): AgentRuntimeStop {
  return {
    kind: "step_budget",
    sessionId: input.sessionId,
    targetMode: input.targetMode,
    maxSteps: input.maxSteps,
    reason: "The agent reached its step budget before the model returned a final response.",
    resumeCommand: input.sessionId ? `agent resume ${input.sessionId}` : undefined,
  };
}
```

- [x] **Step 4: Add `runtime_stopped` to `AgentRunEvent`**

Update `src/core/agent-events.ts` union with:

```ts
  | (AgentRunEventBase & {
      type: "runtime_stopped";
      stopKind: AgentRuntimeStopKind;
      targetMode?: ExecutionTargetMode;
      maxSteps?: number;
      reason: string;
      resumeCommand?: string;
    })
```

and import:

```ts
import type { AgentRuntimeStopKind } from "./agent-runtime-stop.js";
```

- [x] **Step 5: Emit the event from the step limit path**

In `src/core/agent-loop.ts`, replace the final step-limit block with a `stepBudgetRuntimeStop` helper call. Keep the existing `step_limit_reached` event for compatibility, then emit `runtime_stopped`:

```ts
const stop = stepBudgetRuntimeStop({
  sessionId: session?.id,
  targetMode: this.targetMode,
  maxSteps: this.maxSteps,
});
await this.emitProgress({ type: "step_limit_reached", maxSteps: this.maxSteps, sessionId: session?.id });
await this.emitProgress({
  type: "runtime_stopped",
  sessionId: session?.id,
  stopKind: stop.kind,
  targetMode: stop.targetMode,
  maxSteps: stop.maxSteps,
  reason: stop.reason,
  resumeCommand: stop.resumeCommand,
});
return formatRuntimeStopAnswer(stop);
```

- [x] **Step 6: Update event metadata redaction**

In `safeAgentRunEventMetadata`, add:

```ts
case "runtime_stopped":
  return {
    ...base,
    stopKind: event.stopKind,
    targetMode: event.targetMode,
    maxSteps: event.maxSteps,
    reason: redactAgentEventText(event.reason),
    resumeCommand: event.resumeCommand,
  };
```

- [x] **Step 7: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js --test-name-pattern "runtime stopped" }
```

Expected: focused test passes.

Task 1 verification on 2026-06-20:

- RED: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js --test-name-pattern "runtime stopped" }` failed because `runtime_stopped` was not part of `AgentRunEvent`.
- GREEN: the same command passed with 15/15 tests in `agent-events.test.js`.
- Behavior check: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "agent loop step budget stop records" }` passed with 344/344 tests in `security.test.js`; the updated AgentLoop test confirms `runtime_stopped` audit metadata and resume guidance.

## Task 2: Explicit Resume Continuation Context

**Files:**
- Modify: `src/core/agent-loop.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing resume prompt test**

Add a test in `src/__tests__/security.test.ts` that creates a paused or failed session with existing messages, resumes it with a recording model, and asserts the resumed model request contains `Continue this existing Soloclaw session` and the original objective.

Use the existing in-file helpers for temporary workspace and local platform creation. The model should return a visible final answer and no tool calls.

- [x] **Step 2: Run focused RED**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "resume.*continuation" }
```

Expected: test fails because `AgentLoop.resume` currently rebuilds context from stored messages without appending continuation guidance.

- [x] **Step 3: Add continuation prompt helper**

In `src/core/agent-loop.ts`, add:

```ts
const RESUME_CONTINUATION_PROMPT = `Continue this existing Soloclaw session.

Previous objective:
{objective}

Continuation reason:
{reason}

Continue from the existing transcript. Do not restart project discovery unless needed. Verify the remaining task before claiming completion.`;

function formatResumeContinuationPrompt(session: Session, reason: string): string {
  return RESUME_CONTINUATION_PROMPT
    .replace("{objective}", session.objective)
    .replace("{reason}", reason);
}
```

- [x] **Step 4: Append continuation guidance during resume**

After `markResumed`, append the continuation message to the context and store:

```ts
const continuation = formatResumeContinuationPrompt(session, "CLI resume");
const context = ContextManager.fromMessages(messages);
context.addUser(continuation);
await this.store.appendMessage({
  sessionId,
  message: { role: "user", content: continuation },
});
return this.runContext(context, resumed);
```

- [x] **Step 5: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "resume.*continuation" }
```

Expected: focused test passes and the recorded model request includes continuation guidance.

Task 2 verification on 2026-06-20:

- RED: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "resume adds explicit continuation" }` failed because the resumed model prompt did not include `Continue this existing Soloclaw session`.
- GREEN: the same command passed with 345/345 tests in `security.test.js`; the new test confirms the continuation prompt reaches the model request and is persisted as a session user message.

## Task 3: TUI And Projection For Runtime Stops

**Files:**
- Modify: `src/core/agent-message-projector.ts`
- Modify: `src/cli/tui/event-renderer.ts`
- Modify: `src/cli/tui/rich-shell.ts`
- Test: `src/__tests__/agent-events.test.ts`
- Test: `src/__tests__/rich-tui.test.ts`

- [x] **Step 1: Write failing renderer test**

Add a test in `src/__tests__/rich-tui.test.ts` that passes a `runtime_stopped` event through the rich shell event handling and asserts the latest frame contains:

```text
Run: Stopped
Next: /continue or /resume
Step budget
```

- [x] **Step 2: Run focused RED**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "runtime stop|Step budget" }
```

Expected: build or test fails because `runtime_stopped` is not rendered and may not update state.

- [x] **Step 3: Render runtime stop rows**

In `src/cli/tui/event-renderer.ts`, add:

```ts
case "runtime_stopped": {
  const title = event.stopKind === "step_budget" ? `Step budget reached: ${event.maxSteps ?? "-"}` : event.reason;
  const tail = event.resumeCommand ? `Next: /continue or /resume` : undefined;
  return clip(`${ansi.orange}!${ansi.reset} ${title}${tail ? ` (${tail})` : ""}`, width);
}
```

- [x] **Step 4: Project runtime stop parts**

In `src/core/agent-message-projector.ts`, map `runtime_stopped` into an error/status part with a safe title. Use the existing projected part shape already used for `step_limit_reached` or errors.

- [x] **Step 5: Ensure rich-shell run health stays stopped**

In `src/cli/tui/rich-shell.ts`, update the event handler so `runtime_stopped` sets:

```ts
state.runHealth = "stopped";
state.currentActivity = event.stopKind === "step_budget" ? "Step budget reached" : event.reason;
```

Do not show `event.resumeCommand` as the only user path; keep the existing public guidance `/continue or /resume`.

- [x] **Step 6: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "runtime stop|Step budget" }
```

Expected: focused rich TUI test passes.

Task 3 verification on 2026-06-20:

- Runtime stop rendering was required by the TypeScript exhaustive event consumers introduced in Task 1.
- GREEN: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "runtime stop|safe activity and step status|stopped runs show resume" }` passed with 72/72 tests in `rich-tui.test.js`.
- The added assertions cover the event row, projected stopped part, `Run: Stopped`, `Step budget reached: 30`, and `/continue or /resume` guidance.

## Task 4: Session Inspection Runtime-Stop Evidence

**Files:**
- Modify: `src/sessions/session-inspection-view.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing report/verify test**

Add a test in `src/__tests__/security.test.ts` that records a `runtime_stopped` audit event for a session and asserts `agent session report --json` exposes:

```json
{
  "summary": {
    "runtimeStops": 1,
    "lastRuntimeStopKind": "step_budget",
    "resumeCommand": "agent resume sess_x"
  }
}
```

- [x] **Step 2: Run focused RED**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "runtime stop.*session report" }
```

Expected: test fails because session summaries do not include runtime-stop fields.

- [x] **Step 3: Summarize runtime-stop audit events**

In `buildSessionReportView`, filter `auditEvents` for `event.type === "agent.event"` and `metadata.eventType === "runtime_stopped"`. Sort by `createdAt`, then expose:

```ts
const runtimeStopEvents = auditEvents.filter(isRuntimeStoppedAuditEvent);
const lastRuntimeStop = runtimeStopEvents.at(-1);
```

Add to `summary`:

```ts
runtimeStops: runtimeStopEvents.length,
lastRuntimeStopKind: runtimeStopKind(lastRuntimeStop?.metadata),
lastRuntimeStopReason: runtimeStopReason(lastRuntimeStop?.metadata),
resumeCommand: runtimeStopResumeCommand(lastRuntimeStop?.metadata),
```

- [x] **Step 4: Add small metadata helpers**

Near existing metadata helpers, add:

```ts
function isRuntimeStoppedAuditEvent(event: AuditEvent): boolean {
  return event.type === "agent.event" && event.metadata?.eventType === "runtime_stopped";
}

function runtimeStopKind(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.stopKind === "string" ? metadata.stopKind : undefined;
}

function runtimeStopReason(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.reason === "string" ? metadata.reason : undefined;
}

function runtimeStopResumeCommand(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.resumeCommand === "string" ? metadata.resumeCommand : undefined;
}
```

- [x] **Step 5: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "runtime stop.*session report" }
```

Expected: focused test passes.

Task 4 verification on 2026-06-20:

- RED: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "session report exposes runtime stop" }` failed because `summary.runtimeStops` was undefined.
- GREEN: the same command passed with 346/346 tests in `security.test.js`; `buildSessionReportView` and the shared inspection snapshot now expose runtime stop count, kind, reason, and resume command.

## Task 5: Phase 3 CLI Checklist, Smoke, And Gate

**Files:**
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing CLI checklist test**

Add tests in `src/__tests__/security.test.ts` for:

```powershell
node dist\cli\index.js phase3 checklist
node dist\cli\index.js phase3 gate --workspace <temp-workspace> --json
```

Assert checklist mentions C4, C5, and C6. Assert gate JSON has `status`, `checks`, and `secretMatches`.

- [x] **Step 2: Run focused RED**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase3 checklist|phase3 gate" }
```

Expected: CLI reports unknown `phase3` command.

- [x] **Step 3: Add `phase3` command dispatch**

In `src/cli/index.ts`, add a command block near the `phase2` command block:

```ts
if (command === "phase3") {
  await handlePhaseThreeCommand(rest, process.cwd());
  return;
}
```

- [x] **Step 4: Implement checklist output**

Add:

```ts
async function handlePhaseThreeCommand(args: string[], cwd: string): Promise<void> {
  const subcommand = args[0] ?? "checklist";
  if (subcommand === "checklist") {
    console.log(formatPhaseThreeChecklist());
    return;
  }
  if (subcommand === "smoke" || subcommand === "gate") {
    const options = parsePhaseThreeArgs(args.slice(1), cwd);
    const result = await runPhaseThreeGate(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printPhaseThreeGate(result);
    }
    if (result.status !== "pass") {
      process.exitCode = 1;
    }
    return;
  }
  throw new Error("Usage: soloclaw phase3 checklist|smoke|gate [--workspace path] [--json]");
}
```

- [x] **Step 5: Implement a minimal gate result**

For the first green pass, the gate can run metadata and secret-shape checks plus report missing C4/C5/C6 as failed checks. The next task fills real C4/C5/C6 execution.

Return shape:

```ts
{
  phase: "phase3",
  status: "fail" | "pass",
  workspace,
  checks: [
    { id: "C4", status: "fail", summary: "C4 smoke not implemented in this increment." },
    { id: "C5", status: "fail", summary: "C5 smoke not implemented in this increment." },
    { id: "C6", status: "fail", summary: "C6 smoke not implemented in this increment." }
  ],
  secretMatches: 0
}
```

This is not the final gate; it establishes the command contract so subsequent tasks can turn failed checks green one by one.

- [x] **Step 6: Run GREEN verification for command contract**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase3 checklist|phase3 gate" }
```

Expected: checklist and JSON contract tests pass; gate status remains `fail` until C4/C5/C6 implementations are added.

Task 5 verification on 2026-06-20:

- RED: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase3 checklist and gate" }` failed because `phase3` was an unknown command.
- GREEN: the same command passed with 347/347 tests in `security.test.js`; `soloclaw phase3 checklist` prints C4/C5/C6, and `soloclaw phase3 gate --json` returns structured fail-state JSON with `secretMatches=0`.

## Task 6: C4 Real Project Build Smoke

**Files:**
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing C4 gate test**

Add a temporary workspace fixture with a small `index.html`. Run:

```powershell
node dist\cli\index.js phase3 gate --workspace <fixture> --json
```

Assert check `C4` passes, includes a `sessionId`, reports `targetMode=build`, reports `changedPaths > 0`, and cleanup removes the marker.

- [x] **Step 2: Run focused RED**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase3.*C4" }
```

Expected: C4 is still fail from Task 5.

- [x] **Step 3: Implement C4 smoke**

Add `runPhaseThreeBuildSmoke(workspace)` that:

1. Creates a local platform with `targetMode: "build"` and mock provider.
2. Runs a bounded task that adds a reversible marker to `index.html`.
3. Verifies the marker with a shell-safe Node command.
4. Runs `agent session verify <session-id> --require-change --require-diff-stat --require-model-call`.
5. Removes the marker and verifies absence.

- [x] **Step 4: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase3.*C4" }
```

Expected: C4 test passes and leaves no marker.

Task 6 verification on 2026-06-20:

- RED: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase3 gate C4" }` failed because C4 was still reported as `fail`.
- GREEN: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase3 gate C4" }` passed; the C4 check now reports `targetMode=build`, a `sessionId`, `changedPaths > 0`, `verificationStatus=pass`, and `markerPresentAfterCleanup=false`.
- Real workspace evidence: `node dist\cli\index.js phase3 gate --workspace E:\code\tafang --json` later reported C4 `session=sess_q00aj7wy`, `changedPaths=1`, `verification=pass`, and cleanup restored `index.html` with no marker.

## Task 7: C5 Step-Budget Resume Smoke

**Files:**
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing C5 gate test**

Add a test that runs Phase 3 gate against a temp fixture and asserts C5 includes:

- same session id for stop and resume;
- first outcome includes `step_budget`;
- resume outcome is completed;
- final answer visible.

- [x] **Step 2: Run focused RED**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase3.*C5|step budget.*resume" }
```

Expected: C5 fails because no smoke implementation exists.

- [x] **Step 3: Implement a deterministic budget-stop model path**

Use a small test-only model setup inside the Phase 3 smoke helper: first call returns tool calls until max steps is exhausted; resumed call returns a visible final answer after one safe read or verification. Keep this helper local to the CLI smoke code so production model behavior is unchanged.

- [x] **Step 4: Verify session inspection sees runtime stop**

After the first stopped run, call the session report helper and require:

```ts
summary.runtimeStops >= 1
summary.lastRuntimeStopKind === "step_budget"
summary.resumeCommand?.includes(sessionId)
```

- [x] **Step 5: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase3.*C5|step budget.*resume" }
```

Expected: C5 test passes.

Task 7 verification on 2026-06-20:

- RED: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test --test-name-pattern "phase3 gate C5" dist\__tests__\security.test.js }` failed because C5 was still reported as `fail`.
- GREEN: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test --test-name-pattern "phase3 checklist and gate|phase3 gate C5" dist\__tests__\security.test.js }` passed; C5 now records a Goal session stopped by `step_budget`, resumes the same session id, exposes `runtimeStops >= 1`, and finishes with a visible answer.
- Real workspace evidence: `node dist\cli\index.js phase3 gate --workspace E:\code\tafang --json` later reported C5 `session=sess_xqaw195w`, `resumedSessionId=sess_xqaw195w`, `runtimeStops=1`, `stopKind=step_budget`, and `verification=pass`.

## Task 8: C6 Recovery Smoke

**Files:**
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing C6 gate test**

Add a test that asserts C6 passes only when a session has:

- at least one failed command or failed tool result;
- a later successful command;
- `agent session verify --require-recovery --require-model-call` passes.

- [x] **Step 2: Run focused RED**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase3.*C6|recovery smoke" }
```

Expected: C6 fails because no recovery smoke implementation exists.

- [x] **Step 3: Implement C6 smoke**

Use a deterministic mock model task that first runs a known failing command, then recovers with a successful project-file verification command. The original suggested Windows-incompatible command was:

```powershell
powershell -NoProfile -Command "Get-Content -Path index.html -TotalCount 5 | Out-Null"
```

The final answer must mention recovery without exposing raw command output.

- [x] **Step 4: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase3.*C6|recovery smoke" }
```

Expected: C6 test passes.

Task 8 verification on 2026-06-20:

- RED: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test --test-name-pattern "phase3 gate C6" dist\__tests__\security.test.js }` failed because C6 was still reported as `fail`.
- GREEN: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test --test-name-pattern "phase3 gate C6" dist\__tests__\security.test.js }` passed; C6 now records at least one failed command, a later successful command, `recovered=true`, `verificationStatus=pass`, and a visible final answer.
- Real workspace evidence: `node dist\cli\index.js phase3 gate --workspace E:\code\tafang --json` later reported C6 `session=sess_dc2967hz`, `commandsFinished=2`, `failedCommands=1`, `recovered=true`, and `verification=pass`.

## Task 9: Final Phase 3 Gate Sweep

**Files:**
- Modify: `docs/superpowers/plans/2026-06-20-soloclaw-phase3-agent-runtime-reliability.md`

- [x] **Step 1: Run focused Phase 3 tests**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js dist\__tests__\rich-tui.test.js dist\__tests__\security.test.js --test-name-pattern "runtime stopped|runtime stop|resume.*continuation|phase3|C4|C5|C6|recovery smoke" }
```

Expected: all focused tests pass.

- [x] **Step 2: Run standard checks**

Run:

```powershell
npm.cmd run check
npm.cmd test
node dist\cli\index.js smoke --rich-tui --workspace E:\code\agent
node dist\cli\index.js phase3 gate --workspace E:\code\tafang --json
git diff --check
```

Expected:

- TypeScript check exits 0.
- Full test suite exits 0.
- Rich TUI smoke exits 0 with `ok=true`.
- Phase 3 gate exits 0 with `status=pass`, `C4=pass`, `C5=pass`, `C6=pass`, and `secretMatches=0`.
- `git diff --check` exits 0 except for known CRLF conversion warnings if Git prints them.

- [x] **Step 3: Record verification evidence in this plan**

Append a dated `Verification` section with:

- command list;
- exit status;
- C4/C5/C6 session ids;
- cleanup evidence for `E:\code\tafang`;
- secret-shape scan result.

- [x] **Step 4: Final workspace hygiene check**

Run:

```powershell
git status -sb
Get-ChildItem -Recurse -File -Include *.tmp,*.bak,*.old,*.orig,*.rej,*.log,*.tsbuildinfo -Exclude node_modules,dist,.git,.agent
```

Expected: no unintended temp artifacts outside ignored or generated folders.

## Verification 2026-06-20

Focused Phase 3 tests:

- `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test --test-name-pattern "runtime stopped|runtime stop|resume.*continuation|phase3|C4|C5|C6|recovery smoke" dist\__tests__\agent-events.test.js dist\__tests__\rich-tui.test.js dist\__tests__\security.test.js }`
- Exit status: 0.
- Result: 9 tests passed, 0 failed.

Standard checks:

- `npm.cmd run check`
- Exit status: 0.
- `npm.cmd test`
- Exit status: 0.
- Result: 442 tests passed, 0 failed.
- `node dist\cli\index.js smoke --rich-tui --workspace E:\code\agent`
- Exit status: 0, `ok=true`.
- `git diff --check`
- Exit status: 0; Git printed only CRLF conversion warnings.

Real workspace gate:

- `node dist\cli\index.js phase3 gate --workspace E:\code\tafang --json`
- Exit status: 0.
- Result: `status=pass`, `secretMatches=0`.
- C4: `session=sess_fm9vsjdg`, `targetMode=build`, `changedPaths=1`, `verification=pass`, `markerPresentAfterCleanup=false`.
- C5: `session=sess_7unswi2t`, `resumedSessionId=sess_7unswi2t`, `targetMode=goal`, `runtimeStops=1`, `stopKind=step_budget`, `verification=pass`.
- C6: `session=sess_chvqyive`, `targetMode=build`, `commandsFinished=2`, `failedCommands=1`, `recovered=true`, `verification=pass`.
- Cleanup evidence: direct marker scan of `E:\code\tafang\index.html` returned `marker-absent`.

Workspace hygiene:

- `git status -sb` shows the expected Phase 3 source/doc changes on `codex/phase3-agent-runtime`.
- `Get-ChildItem -Recurse -File -Include *.tmp,*.bak,*.old,*.orig,*.rej,*.log,*.tsbuildinfo ...` returned no unignored temp artifacts.

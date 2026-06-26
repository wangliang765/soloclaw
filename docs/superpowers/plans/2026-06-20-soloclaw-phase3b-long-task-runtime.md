# Soloclaw Phase 3B Long Task Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Soloclaw's Plan, Build, and Goal modes support real long-running coding work that can continue for hours through safe checkpoints, resume, pause, cancel, context compaction, and worker supervision.

**Architecture:** Keep opencode's useful separation: modes are agent policies, not separate runtimes; the event stream and session runner are the execution backbone; low default step caps are replaced by explicit budgets and guardrails. Add Codex-style Goal semantics on top: a durable objective has status, progress, repeated-blocker detection, optional budget accounting, and can only be marked complete when the objective is actually satisfied.

**Tech Stack:** TypeScript, Node.js test runner, existing `AgentLoop`, SQLite and memory `AgentStore`, existing rich TUI event lane, existing worker/scheduler/assignment services, existing session inspection and verification views.

---

## Reference Summary

### opencode Plan

opencode's `plan` is a primary agent policy. In `E:\code\opencode\packages\opencode\src\agent\agent.ts`, the default `build` agent allows `plan_enter`, while the `plan` agent allows `plan_exit`, denies general edits, and only allows edits to plan files such as `.opencode/plans/*.md` or the global plans directory. `E:\code\opencode\packages\opencode\src\session\prompt\plan-mode.txt` then reinforces the same contract at prompt level: read-only exploration, write only the plan file, and exit through the explicit plan approval path. Plan is therefore a permissioned mode on the same session runtime, not a separate planning runtime.

Soloclaw target:

- `Plan` is read-only by default.
- `Plan` may write only plan artifacts under approved plan paths such as `.agent/plans/*.md` or `docs/superpowers/plans/*.md`.
- Plan approval creates an explicit transition record, then switches the same session to `Build` without losing transcript context.

### opencode Build

opencode's `build` is the default primary agent. `E:\code\opencode\packages\opencode\src\agent\agent.ts` gives it normal tool permissions plus `question` and `plan_enter`. `E:\code\opencode\packages\opencode\src\session\prompt\build-switch.txt` is the prompt-level transition marker from plan to build. In the local opencode copy reviewed on 2026-06-20, the V2 session runner still has a bounded single-drain loop (`MAX_STEPS = 25` in `E:\code\opencode\packages\core\src\session\runner\llm.ts`), and the prompt runner uses `agent.steps ?? Infinity` in `E:\code\opencode\packages\opencode\src\session\prompt.ts`. Around those loops, opencode persists session input, messages, step events, tool progress, todos, compaction, and continuation state. The useful lesson is not "one infinite loop"; it is "bounded chunks over durable session state, with visible progress and resumability."

Soloclaw target:

- `Build` is the normal execution mode.
- It should not stop after 30 or 80 steps unless the user or runtime policy configured that limit.
- It still needs guardrails: repeated identical tool calls, model-call budgets, elapsed-time budgets, cost/token budgets, approvals, cancellation, and policy stops.
- A foreground run may stop at an explicit chunk boundary, but that stop must be resumable, supervised, and visible instead of becoming a silent failure.

### Goal

opencode does not have a built-in `goal` mode. For Soloclaw, `Goal` should follow Codex-style semantics:

- A goal has an explicit objective.
- A token/model-call/time budget may exist, but budget exhaustion is a stop condition, not success.
- The goal is `complete` only when the objective has actually been achieved and verification evidence supports that claim.
- The goal is `blocked` only when the same blocker repeats across consecutive continuation attempts. Use a threshold of 3 blocker observations, matching the Codex-style "do not call blocked too early" rule.
- The agent should continue from the existing transcript after resume/compaction instead of restarting discovery.
- The UI should show objective, current status, progress, usage, blocker, next action, and active session.

### Long-Task Runtime Shape

The durable long-task design should combine opencode's session architecture with Codex-style goal semantics:

- Keep every run attached to a session id, active mode, model, event stream, and persisted transcript.
- Treat step limits as chunk budgets. A chunk can pause or yield, but the supervisor owns continuation until the goal completes, is cancelled, or is genuinely blocked.
- Emit safe events for thinking/progress, commands, file edits, tool results, runtime stops, budget checkpoints, guardrails, compaction, and goal updates. The TUI can render these without exposing raw command bodies, patch bodies, secret values, or noisy output by default.
- Maintain a task ledger/todo list for multi-step Build work and a durable goal ledger for Goal work. Todos track local execution steps; Goals track objective-level completion, blocker history, usage, and verification evidence.
- Compact context before overflow and resume from compacted history plus recent transcript. Compaction is a continuation mechanism, not a restart.
- Make completion verifiable: Build should finish with checks appropriate to the project; Goal should only become `complete` when the objective has evidence, and `blocked` only after the same blocker repeats across 3 continuation attempts.

Concrete opencode source anchors:

- Modes and permissions: `E:\code\opencode\packages\opencode\src\agent\agent.ts`
- Plan prompt contract: `E:\code\opencode\packages\opencode\src\session\prompt\plan-mode.txt`
- Build transition prompt: `E:\code\opencode\packages\opencode\src\session\prompt\build-switch.txt`
- Prompt-loop step handling: `E:\code\opencode\packages\opencode\src\session\prompt.ts`
- V2 bounded runner chunk: `E:\code\opencode\packages\core\src\session\runner\llm.ts`
- Todo ledger and event: `E:\code\opencode\packages\opencode\src\session\todo.ts`
- Model-facing todo tool: `E:\code\opencode\packages\opencode\src\tool\todo.ts`
- Context compaction: `E:\code\opencode\packages\opencode\src\session\compaction.ts`

## Final Mode Contract

Plan, Build, and Goal should remain three operator-visible modes over the same durable session runtime, not three unrelated products.

### Plan Mode

Plan is the "understand and design" lane. It should:

- read the workspace and conversation;
- ask focused clarification questions when needed;
- write only approved plan artifacts;
- never mutate product files, install dependencies, run risky commands, commit, or push;
- end by producing a concrete plan and an explicit approval/switch point into Build.

opencode reference: `E:\code\opencode\packages\opencode\src\agent\agent.ts` configures `plan` as a primary agent that denies edit tools except plan files and allows `plan_exit`; `E:\code\opencode\packages\opencode\src\session\prompt\plan-mode.txt` describes the same read-only workflow at prompt level.

### Build Mode

Build is the normal engineering lane. It should:

- inspect, edit, run commands, and verify inside policy;
- keep a visible task ledger for multi-step work;
- stream safe progress events while hiding raw command bodies, patch bodies, secrets, and noisy output by default;
- continue until the requested task is complete, blocked by policy/user input, cancelled, or stopped by an explicit configured budget;
- treat chunk stops as resumable runtime stops, not as final failure.

opencode reference: `E:\code\opencode\packages\opencode\src\agent\agent.ts` defines `build` as the default primary agent with normal tool permissions and `plan_enter`. `E:\code\opencode\packages\core\src\session\runner\llm.ts` still bounds an individual V2 drain loop, while `E:\code\opencode\packages\opencode\src\session\prompt.ts` uses `agent.steps ?? Infinity` for the prompt runner. Durable session state, event publication, compaction, tool settlement, and resumability make the user experience long-running rather than "30 steps then gone."

### Goal Mode

Goal is Soloclaw's durable objective lane. opencode does not ship this as a separate mode, so Soloclaw should use Codex-style semantics:

- a Goal has one explicit objective and one durable ledger;
- completion requires evidence that the objective is actually achieved;
- budget exhaustion is only a resumable stop, never success;
- blocked status requires the same blocker to repeat for 3 consecutive continuation attempts;
- resume and compaction must continue the existing objective instead of restarting discovery;
- the TUI should show objective, status, budget usage, blocker history, checkpoints, and next action.

### True Long-Task Acceptance

A Soloclaw run should count as truly long-task capable only when all of the following are true:

- foreground TUI shows live progress, tool activity, current model, active mode, context/budget state, todos, and goal status;
- Build and Goal have no low implicit step cap;
- explicit budgets stop safely with a resume command;
- the supervisor can continue across chunks for hours;
- context compaction preserves objective, decisions, blockers, files, commands, and next actions;
- todos and goal checkpoints persist in SQLite and survive process restart;
- worker/scheduler paths can resume paused or stopped Goal sessions;
- final session report shows evidence, changed files, verification commands, runtime stops, todos, and goal state;
- real-provider smoke on `E:\code\tafang` passes without secret leakage.

## File Structure

- Create `src/core/agent-mode-policy.ts`: canonical Plan/Build/Goal policies, default budgets, and mode descriptions.
- Create `src/core/run-budget.ts`: explicit runtime budget model and controller for steps, model calls, elapsed time, repeated tool calls, and idle progress.
- Create `src/core/doom-loop-detector.ts`: repeated identical tool-call detection with stable tool/input fingerprints.
- Create `src/core/context-compactor.ts`: session-message compaction and continuation prompts for long transcripts.
- Create `src/goals/goal-service.ts`: durable goal lifecycle, progress ledger, blocker counting, and completion rules.
- Create `src/domain/goal.ts`: goal state and checkpoint domain types.
- Modify `src/domain/index.ts`: export goal domain types.
- Modify `src/store/agent-store.ts`: add goal persistence methods.
- Modify `src/store/memory-agent-store.ts`: implement in-memory goal persistence for tests.
- Modify `src/store/sqlite-agent-store.ts`: add `goals` and `goal_checkpoints` tables and methods.
- Create `src/domain/session-todo.ts`: session todo status, priority, and ordered item types.
- Modify `src/store/agent-store.ts`: add session todo replace/list methods.
- Modify `src/store/memory-agent-store.ts`: persist ordered session todos for tests and in-memory runs.
- Modify `src/store/sqlite-agent-store.ts`: add ordered `session_todos` persistence for durable runs.
- Modify `src/tools/workspace-tools.ts`: add `todowrite` as a model-facing long-task task ledger tool.
- Modify `src/sessions/session-inspection-view.ts`: expose todo counts and ordered todos in session reports.
- Modify `src/core/agent-events.ts`: add `goal_updated`, `run_budget_checkpoint`, and `guardrail_tripped` events.
- Modify `src/core/agent-loop.ts`: replace low default `maxSteps` with explicit budgets, guardrails, compaction hooks, and goal updates.
- Modify `src/platform/local-platform.ts`: pass mode policies and run budgets into the agent loop and worker-created agents.
- Modify `src/workers/local-worker-runner.ts`: treat resumable Goal stops as paused/runnable work instead of failed completion.
- Modify `src/scheduler/local-scheduler-service.ts`: expose long-task run metrics and stop reasons.
- Modify `src/sessions/session-inspection-view.ts`: include goal state, checkpoints, blocker count, budget usage, and next action.
- Modify `src/cli/tui/rich-shell.ts`, `src/cli/tui/layout.ts`, `src/cli/tui/event-renderer.ts`, and `src/cli/tui/state.ts`: show long-task state and add pause/cancel/background controls.
- Modify `src/cli/index.ts`: add long-task CLI options and `phase3 long-task-gate`.
- Create `src/cli/phase3-long-task-prompts.ts`: real-provider long-task prompt helpers that prevent workspace-folder path drift in read-only Goal validation.
- Test in `src/__tests__/agent-events.test.ts`: safe event metadata.
- Test in `src/__tests__/security.test.ts`: mode policies, long step runs, goal lifecycle, compaction, worker resume, CLI gate.
- Test in `src/__tests__/rich-tui.test.ts`: Work Ledger long-task status, pause/cancel/background, goal state, and guardrail rows.

## Task 1: Canonical Plan, Build, Goal Policies

**Files:**
- Create: `src/core/agent-mode-policy.ts`
- Modify: `src/core/agent-loop.ts`
- Modify: `src/platform/local-platform.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing mode-policy tests**

Add tests that assert:

```ts
test("build mode has no low default step cap", async () => {
  const model = new CountingToolModel({ toolTurns: 35, final: "completed after many steps" });
  const platform = await createTestPlatform({ model, targetMode: "build" });
  const result = await platform.agent.runWithSession("exercise more than thirty tool turns");
  assert.match(result.finalAnswer, /completed after many steps/);
  assert.equal(model.calls, 36);
});

test("goal mode has no low default step cap", async () => {
  const model = new CountingToolModel({ toolTurns: 85, final: "goal completed after many steps" });
  const platform = await createTestPlatform({ model, targetMode: "goal" });
  const result = await platform.agent.runWithSession("complete a durable objective");
  assert.match(result.finalAnswer, /goal completed/);
  assert.equal(model.calls, 86);
});

test("plan mode does not expose workspace edit tools", async () => {
  const seenTools: string[][] = [];
  const model = {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      seenTools.push(request.tools.map((tool) => tool.name).sort());
      return { type: "message", content: "Plan only." };
    },
  };
  const platform = await createTestPlatform({ model, targetMode: "plan" });
  await platform.agent.runWithSession("plan a small change");
  assert.deepEqual(seenTools[0], []);
});
```

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "mode.*step cap|plan mode does not expose" }
```

Expected: the build/goal tests fail because current defaults stop at 30/60 steps.

- [x] **Step 2: Add `agent-mode-policy.ts`**

Create:

```ts
import type { ExecutionTargetMode } from "../domain/index.js";

export type AgentModePolicy = {
  mode: ExecutionTargetMode;
  label: "Plan" | "Build" | "Goal";
  description: string;
  allowTools: boolean;
  allowWorkspaceWrites: boolean;
  durableObjective: boolean;
  defaultBudget: {
    maxSteps?: number;
    maxModelCalls?: number;
    maxDurationMs?: number;
    maxRepeatedToolCalls: number;
    maxIdleSteps: number;
  };
};

export function agentModePolicy(mode: ExecutionTargetMode): AgentModePolicy {
  if (mode === "plan") {
    return {
      mode,
      label: "Plan",
      description: "Read-only planning",
      allowTools: false,
      allowWorkspaceWrites: false,
      durableObjective: false,
      defaultBudget: { maxSteps: 8, maxRepeatedToolCalls: 3, maxIdleSteps: 4 },
    };
  }
  if (mode === "goal") {
    return {
      mode,
      label: "Goal",
      description: "Durable objective",
      allowTools: true,
      allowWorkspaceWrites: true,
      durableObjective: true,
      defaultBudget: { maxRepeatedToolCalls: 3, maxIdleSteps: 10 },
    };
  }
  return {
    mode: "build",
    label: "Build",
    description: "Workspace execution",
    allowTools: true,
    allowWorkspaceWrites: true,
    durableObjective: false,
    defaultBudget: { maxRepeatedToolCalls: 3, maxIdleSteps: 8 },
  };
}
```

- [x] **Step 3: Wire policy into `AgentLoop`**

Change the constructor so `this.maxSteps` no longer defaults to `30` or `60`. Keep explicit `options.maxSteps` supported:

```ts
const modePolicy = agentModePolicy(this.targetMode);
this.budget = createRunBudget({
  ...modePolicy.defaultBudget,
  maxSteps: options.maxSteps ?? modePolicy.defaultBudget.maxSteps,
});
```

Plan mode remains `runPlan`, so it still calls the model with `tools: []`.

- [x] **Step 4: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "mode.*step cap|plan mode does not expose" }
```

Expected: focused tests pass.

Progress note 2026-06-20: Added `agentModePolicy`, removed low default step caps for Build and Goal, and verified `build and goal modes do not have low default step caps`.

## Task 2: Explicit Run Budget Controller

**Files:**
- Create: `src/core/run-budget.ts`
- Modify: `src/core/agent-runtime-stop.ts`
- Modify: `src/core/agent-events.ts`
- Modify: `src/core/agent-loop.ts`
- Modify: `src/platform/local-platform.ts`
- Test: `src/__tests__/agent-events.test.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing budget tests**

Add tests for explicit limits:

```ts
test("explicit maxSteps still stops with a resumable runtime stop", async () => {
  const events: AgentRunEvent[] = [];
  const model = new CountingToolModel({ toolTurns: 10, final: "not reached" });
  const platform = await createTestPlatform({
    model,
    targetMode: "goal",
    maxSteps: 3,
    onAgentProgress: (event) => events.push(event),
  });
  const result = await platform.agent.runWithSession("bounded run");
  assert.match(result.finalAnswer, /Stopped after 3 steps/);
  assert.equal(events.some((event) => event.type === "runtime_stopped" && event.stopKind === "step_budget"), true);
});

test("explicit model-call budget stops before runaway model usage", async () => {
  const model = new CountingToolModel({ toolTurns: 10, final: "not reached" });
  const platform = await createTestPlatform({
    model,
    targetMode: "goal",
    modelMaxCalls: 4,
  });
  const result = await platform.agent.runWithSession("bounded model calls");
  assert.match(result.finalAnswer, /model call budget/i);
});
```

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "budget stops|model-call budget" }
```

Expected: model-call budget is not surfaced as a runtime stop.

- [x] **Step 2: Create `run-budget.ts`**

Create:

```ts
import type { AgentRuntimeStop } from "./agent-runtime-stop.js";
import type { ExecutionTargetMode } from "../domain/index.js";

export type AgentRunBudget = {
  maxSteps?: number;
  maxModelCalls?: number;
  maxDurationMs?: number;
  maxRepeatedToolCalls?: number;
  maxIdleSteps?: number;
};

export type RunBudgetUsage = {
  steps: number;
  modelCalls: number;
  startedAtMs: number;
  idleSteps: number;
};

export class RunBudgetController {
  readonly usage: RunBudgetUsage;

  constructor(
    readonly budget: AgentRunBudget,
    private readonly targetMode: ExecutionTargetMode,
    private readonly sessionId?: string,
    nowMs = Date.now(),
  ) {
    this.usage = { steps: 0, modelCalls: 0, startedAtMs: nowMs, idleSteps: 0 };
  }

  beforeStep(nowMs = Date.now()): AgentRuntimeStop | undefined {
    if (this.budget.maxSteps !== undefined && this.usage.steps >= this.budget.maxSteps) {
      return this.stop("step_budget", `The run reached the configured step budget of ${this.budget.maxSteps}.`);
    }
    if (this.budget.maxModelCalls !== undefined && this.usage.modelCalls >= this.budget.maxModelCalls) {
      return this.stop("model_call_budget", `The run reached the configured model call budget of ${this.budget.maxModelCalls}.`);
    }
    if (this.budget.maxDurationMs !== undefined && nowMs - this.usage.startedAtMs >= this.budget.maxDurationMs) {
      return this.stop("duration_budget", `The run reached the configured duration budget of ${this.budget.maxDurationMs}ms.`);
    }
    if (this.budget.maxIdleSteps !== undefined && this.usage.idleSteps >= this.budget.maxIdleSteps) {
      return this.stop("idle_budget", `The run did not make visible progress for ${this.budget.maxIdleSteps} step(s).`);
    }
    return undefined;
  }

  recordStepStarted(): void {
    this.usage.steps += 1;
  }

  recordModelCall(): void {
    this.usage.modelCalls += 1;
  }

  recordProgress(progress: boolean): void {
    this.usage.idleSteps = progress ? 0 : this.usage.idleSteps + 1;
  }

  stop(kind: AgentRuntimeStop["kind"], reason: string): AgentRuntimeStop {
    return {
      kind,
      sessionId: this.sessionId,
      targetMode: this.targetMode,
      step: this.usage.steps,
      maxSteps: this.budget.maxSteps,
      reason,
      resumeCommand: this.sessionId ? `agent resume ${this.sessionId}` : undefined,
    };
  }
}

export function createRunBudget(input: AgentRunBudget): AgentRunBudget {
  return {
    ...input,
    maxRepeatedToolCalls: input.maxRepeatedToolCalls ?? 3,
    maxIdleSteps: input.maxIdleSteps ?? 8,
  };
}
```

- [x] **Step 3: Extend runtime stop kinds**

Update `src/core/agent-runtime-stop.ts`:

```ts
export type AgentRuntimeStopKind =
  | "step_budget"
  | "model_call_budget"
  | "duration_budget"
  | "idle_budget"
  | "doom_loop"
  | "approval_required"
  | "model_error"
  | "tool_error";
```

- [x] **Step 4: Emit budget checkpoints**

Add `run_budget_checkpoint` to `AgentRunEvent`:

```ts
| (AgentRunEventBase & {
    type: "run_budget_checkpoint";
    sessionId?: string;
    targetMode?: ExecutionTargetMode;
    steps: number;
    modelCalls: number;
    elapsedMs: number;
    maxSteps?: number;
    maxModelCalls?: number;
    maxDurationMs?: number;
  })
```

Emit it every 10 steps and before a runtime stop.

- [x] **Step 5: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js dist\__tests__\security.test.js --test-name-pattern "budget|runtime stopped" }
```

Expected: budget and existing runtime-stop tests pass.

## Task 3: Doom-Loop Guardrail

**Files:**
- Create: `src/core/doom-loop-detector.ts`
- Modify: `src/core/agent-loop.ts`
- Modify: `src/core/agent-events.ts`
- Modify: `src/cli/tui/event-renderer.ts`
- Test: `src/__tests__/security.test.ts`
- Test: `src/__tests__/rich-tui.test.ts`

- [x] **Step 1: Write failing repeated-tool-call test**

Add:

```ts
test("repeated identical tool calls stop with doom-loop guardrail", async () => {
  const events: AgentRunEvent[] = [];
  const model = new RepeatingToolModel({
    toolName: "read_file",
    input: { path: "package.json" },
    turns: 5,
  });
  const platform = await createTestPlatform({
    model,
    targetMode: "build",
    onAgentProgress: (event) => events.push(event),
  });
  const result = await platform.agent.runWithSession("repeat a read");
  assert.match(result.finalAnswer, /repeated identical tool call/i);
  assert.equal(events.some((event) => event.type === "guardrail_tripped" && event.guardrail === "doom_loop"), true);
});
```

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "doom-loop|repeated identical" }
```

Expected: test fails because repeated identical tool calls continue until another budget stops them.

- [x] **Step 2: Add detector**

Create:

```ts
import type { ToolCall } from "../protocol/types.js";

export type DoomLoopHit = {
  toolName: string;
  fingerprint: string;
  count: number;
};

export class DoomLoopDetector {
  private lastFingerprint = "";
  private repeated = 0;

  constructor(private readonly threshold: number) {}

  record(calls: ToolCall[]): DoomLoopHit | undefined {
    if (calls.length !== 1) {
      this.lastFingerprint = "";
      this.repeated = 0;
      return undefined;
    }
    const call = calls[0];
    const fingerprint = `${call.name}:${stableJson(call.arguments)}`;
    this.repeated = fingerprint === this.lastFingerprint ? this.repeated + 1 : 1;
    this.lastFingerprint = fingerprint;
    if (this.repeated >= this.threshold) {
      return { toolName: call.name, fingerprint, count: this.repeated };
    }
    return undefined;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
```

- [x] **Step 3: Add event**

Add:

```ts
| (AgentRunEventBase & {
    type: "guardrail_tripped";
    sessionId?: string;
    guardrail: "doom_loop" | "idle_budget";
    reason: string;
    toolName?: string;
    count?: number;
    resumeCommand?: string;
  })
```

- [x] **Step 4: Stop safely in `AgentLoop`**

After model tool calls are received and before executing tools:

```ts
const doom = this.doomLoop.record(response.toolCalls);
if (doom) {
  const reason = `Stopped repeated identical tool call: ${doom.toolName} repeated ${doom.count} time(s).`;
  const stop = budget.stop("doom_loop", reason);
  await this.emitProgress({
    type: "guardrail_tripped",
    sessionId: session?.id,
    guardrail: "doom_loop",
    reason,
    toolName: doom.toolName,
    count: doom.count,
    resumeCommand: stop.resumeCommand,
  });
  await this.emitRuntimeStopped(stop);
  return formatRuntimeStopAnswer(stop);
}
```

- [x] **Step 5: Render guardrail row**

In `src/cli/tui/event-renderer.ts` render:

```ts
case "guardrail_tripped":
  return clip(`${ansi.orange}!${ansi.reset} Guardrail: ${event.reason}`, width);
```

- [x] **Step 6: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js dist\__tests__\rich-tui.test.js --test-name-pattern "doom-loop|guardrail|repeated identical" }
```

Expected: focused tests pass.

Progress note 2026-06-20: Added `DoomLoopDetector`, `guardrail_tripped` events, AgentLoop doom-loop stop before repeated tool execution, safe event projection/TUI/Web rendering, and verified with `npm.cmd run build` plus `node --test dist\__tests__\security.test.js dist\__tests__\rich-tui.test.js --test-name-pattern "doom-loop|guardrail|repeated identical"` (427 pass, 0 fail).

Progress note 2026-06-20: Added `RunBudgetController`, wired `AgentLoopOptions.runBudget`, emitted `run_budget_checkpoint`, updated safe event projection/TUI/Web rendering, and verified with `npm run build` plus `node --test dist\__tests__\agent-events.test.js dist\__tests__\security.test.js --test-name-pattern "run budget|budget checkpoints|agent loop step budget stop|model call budget"` (369 pass, 0 fail).

## Task 4: Durable Goal Ledger

**Files:**
- Create: `src/domain/goal.ts`
- Modify: `src/domain/index.ts`
- Modify: `src/store/agent-store.ts`
- Modify: `src/store/memory-agent-store.ts`
- Modify: `src/store/sqlite-agent-store.ts`
- Create: `src/goals/goal-service.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing goal lifecycle tests**

Add:

```ts
test("goal ledger marks complete only with explicit completion evidence", async () => {
  const store = new MemoryAgentStore();
  const service = new GoalService(store);
  const session = await store.createSession({
    objective: "finish a verified change",
    targetMode: "goal",
    status: "running",
    risk: "medium",
    createdBy: { type: "user", id: "u1" },
  });
  const goal = await service.startForSession(session, { tokenBudget: 1000 });
  await service.recordCheckpoint(goal.id, {
    kind: "progress",
    summary: "read project files",
    sessionId: session.id,
  });
  const beforeVerify = await service.tryMarkComplete(goal.id, { verified: false, summary: "model claimed done" });
  assert.equal(beforeVerify.status, "active");
  const afterVerify = await service.tryMarkComplete(goal.id, { verified: true, summary: "session verification passed" });
  assert.equal(afterVerify.status, "complete");
});

test("goal ledger marks blocked after the same blocker repeats three times", async () => {
  const store = new MemoryAgentStore();
  const service = new GoalService(store);
  const session = await store.createSession({
    objective: "wait for missing approval",
    targetMode: "goal",
    status: "running",
    risk: "medium",
    createdBy: { type: "user", id: "u1" },
  });
  const goal = await service.startForSession(session);
  await service.recordBlocker(goal.id, "approval:appr_1", "Approval appr_1 is required.");
  await service.recordBlocker(goal.id, "approval:appr_1", "Approval appr_1 is still required.");
  const blocked = await service.recordBlocker(goal.id, "approval:appr_1", "Approval appr_1 is still required.");
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.repeatedBlockers, 3);
});
```

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "goal ledger" }
```

Expected: build fails because goal types and service do not exist.

- [x] **Step 2: Add domain types**

Create:

```ts
import type { ActorRef, SessionId, Timestamp } from "./common.js";

export type GoalStatus = "active" | "complete" | "blocked" | "cancelled";
export type GoalCheckpointKind = "progress" | "verification" | "blocker" | "budget" | "resume";

export type GoalRun = {
  id: string;
  sessionId: SessionId;
  objective: string;
  status: GoalStatus;
  tokenBudget?: number;
  tokenUsed: number;
  modelCalls: number;
  repeatedBlockerKey?: string;
  repeatedBlockers: number;
  createdBy: ActorRef;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
};

export type GoalCheckpoint = {
  id: string;
  goalId: string;
  sessionId: SessionId;
  kind: GoalCheckpointKind;
  summary: string;
  blockerKey?: string;
  metadata: Record<string, unknown>;
  createdAt: Timestamp;
};
```

- [x] **Step 3: Add store methods**

Extend `AgentStore`:

```ts
createGoalRun(goal: GoalRun): Promise<void>;
updateGoalRun(goal: GoalRun): Promise<void>;
getGoalRun(goalId: string): Promise<GoalRun | undefined>;
getGoalRunBySession(sessionId: string): Promise<GoalRun | undefined>;
listGoalRuns(input?: { status?: GoalRun["status"]; limit?: number }): Promise<GoalRun[]>;
addGoalCheckpoint(checkpoint: GoalCheckpoint): Promise<void>;
listGoalCheckpoints(goalId: string, limit?: number): Promise<GoalCheckpoint[]>;
```

- [x] **Step 4: Add SQLite tables**

In `initialize`, add:

```sql
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  token_budget INTEGER,
  token_used INTEGER NOT NULL,
  model_calls INTEGER NOT NULL,
  repeated_blocker_key TEXT,
  repeated_blockers INTEGER NOT NULL,
  created_by_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS goal_checkpoints (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  blocker_key TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
);
```

Add indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_goals_status_updated ON goals(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_goal_checkpoints_goal_created ON goal_checkpoints(goal_id, created_at);
```

- [x] **Step 5: Implement `GoalService`**

Create methods:

```ts
async startForSession(session: Session, input: { tokenBudget?: number } = {}): Promise<GoalRun>
async recordCheckpoint(goalId: string, input: Omit<CreateGoalCheckpointInput, "goalId">): Promise<GoalRun>
async recordBlocker(goalId: string, blockerKey: string, summary: string): Promise<GoalRun>
async tryMarkComplete(goalId: string, input: { verified: boolean; summary: string }): Promise<GoalRun>
async cancel(goalId: string, summary: string): Promise<GoalRun>
```

`recordBlocker` sets `blocked` only when the same `blockerKey` reaches 3 consecutive observations.

- [x] **Step 6: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "goal ledger" }
```

Expected: focused tests pass for memory and SQLite stores.

Progress note 2026-06-20: Added durable goal domain/store APIs, Memory and SQLite persistence, `GoalService`, completion verification rule, repeated-blocker counting, and SQLite checkpoint persistence. Verified with `npm.cmd run build` plus `node --test dist\__tests__\security.test.js --test-name-pattern "goal ledger"` (357 pass, 0 fail).

## Task 5: Goal-Aware Agent Loop

**Files:**
- Modify: `src/core/agent-loop.ts`
- Modify: `src/core/agent-events.ts`
- Modify: `src/platform/local-platform.ts`
- Modify: `src/sessions/session-inspection-view.ts`
- Test: `src/__tests__/security.test.ts`
- Test: `src/__tests__/agent-events.test.ts`

- [x] **Step 1: Write failing goal update tests**

Add:

```ts
test("goal mode creates and updates a durable goal run", async () => {
  const events: AgentRunEvent[] = [];
  const platform = await createTestPlatform({
    targetMode: "goal",
    model: new CountingToolModel({ toolTurns: 2, final: "verified goal complete" }),
    onAgentProgress: (event) => events.push(event),
  });
  const result = await platform.agent.runWithSession("make a verified tiny change");
  assert.match(result.finalAnswer, /verified goal complete/);
  const goal = await platform.store.getGoalRunBySession(result.session!.id);
  assert.equal(goal?.status, "complete");
  assert.equal(events.some((event) => event.type === "goal_updated" && event.status === "complete"), true);
});
```

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "goal mode creates" }
```

Expected: test fails because goal mode does not create a goal run.

- [x] **Step 2: Add event type**

Add:

```ts
| (AgentRunEventBase & {
    type: "goal_updated";
    sessionId?: string;
    goalId: string;
    status: "active" | "complete" | "blocked" | "cancelled";
    objective: string;
    summary: string;
    repeatedBlockers?: number;
    tokenUsed?: number;
    modelCalls?: number;
  })
```

Redact `objective` and `summary` in `safeAgentRunEventMetadata`.

- [x] **Step 3: Start goal on session creation**

When `targetMode === "goal"` and a session exists:

```ts
const goal = await this.goalService?.startForSession(session, this.goalOptions);
await this.emitProgress({
  type: "goal_updated",
  sessionId: session.id,
  goalId: goal.id,
  status: goal.status,
  objective: goal.objective,
  summary: "Goal started.",
});
```

- [x] **Step 4: Record progress checkpoints**

After successful tool results or assistant final answers, call:

```ts
await this.goalService?.recordCheckpoint(goal.id, {
  kind: "progress",
  sessionId: session.id,
  summary: publicProgressSummary,
  metadata: { step: stepNumber },
});
```

- [x] **Step 5: Mark complete only after verification predicate**

Use a conservative predicate in the first implementation:

```ts
const verified = response.type === "message" && response.content.trim().length > 0 && !hasPendingApprovals;
```

If the session includes file changes or commands, require `buildSessionVerification` to pass before `GoalService.tryMarkComplete(... verified: true ...)`. If verification cannot run, keep the goal `active` and include next action in the final answer.

- [x] **Step 6: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js dist\__tests__\security.test.js --test-name-pattern "goal_updated|goal mode creates" }
```

Expected: focused tests pass.

Progress note 2026-06-20: Wired Goal mode into `AgentLoop`, added `goal_updated` events, recorded durable progress checkpoints after successful tools, updated model-call usage, marked durable goals complete on verified final answers, and projected/rendered safe goal progress in CLI/TUI/Web event streams. Verified with `npm.cmd run build` plus `node --test dist\__tests__\agent-events.test.js dist\__tests__\security.test.js --test-name-pattern "goal_updated|goal mode creates"` (375 pass, 0 fail).

## Task 6: Context Compaction And Auto-Continuation Prompt

**Files:**
- Create: `src/core/context-compactor.ts`
- Modify: `src/core/context-manager.ts`
- Modify: `src/core/agent-loop.ts`
- Modify: `src/store/agent-store.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing compaction test**

Add:

```ts
test("goal resume uses compacted summary and continues existing objective", async () => {
  const store = new MemoryAgentStore();
  const session = await createLongGoalSession(store, { messageCount: 120 });
  const model = new RecordingModel({ final: "continued from compacted context" });
  const platform = await createTestPlatform({ store, model, targetMode: "goal" });
  const answer = await platform.agent.resume(session.id);
  assert.match(answer, /continued from compacted context/);
  const requestText = model.requests.at(-1)!.messages.map((message) => message.content).join("\n");
  assert.match(requestText, /Compacted prior context/);
  assert.match(requestText, /Continue this existing Soloclaw session/);
});
```

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "compacted summary" }
```

Expected: request includes all messages and no compaction summary.

- [x] **Step 2: Add compactor**

Create:

```ts
import type { AgentMessage } from "../protocol/types.js";

export type ContextCompactionResult = {
  compacted: boolean;
  messages: AgentMessage[];
  summary?: string;
};

export function compactMessagesForGoal(input: {
  messages: AgentMessage[];
  keepLast: number;
  maxChars: number;
}): ContextCompactionResult {
  const totalChars = input.messages.reduce((sum, message) => sum + message.content.length, 0);
  if (totalChars <= input.maxChars || input.messages.length <= input.keepLast) {
    return { compacted: false, messages: input.messages };
  }
  const head = input.messages.slice(0, -input.keepLast);
  const tail = input.messages.slice(-input.keepLast);
  const summary = head
    .map((message) => `${message.role}: ${message.content.replace(/\s+/g, " ").slice(0, 240)}`)
    .join("\n")
    .slice(0, Math.max(1000, Math.floor(input.maxChars / 3)));
  return {
    compacted: true,
    summary,
    messages: [
      {
        role: "system",
        content: `Compacted prior context:\n${summary}`,
      },
      ...tail,
    ],
  };
}
```

- [x] **Step 3: Apply on resume and long active runs**

Before `ContextManager.fromMessages(messages)` in `resume`, call:

```ts
const compacted = compactMessagesForGoal({ messages, keepLast: 30, maxChars: this.contextMaxChars });
const context = ContextManager.fromMessages(compacted.messages);
if (compacted.compacted && session) {
  await this.store.addSessionSummary({
    id: makeId("sum"),
    sessionId: session.id,
    summary: compacted.summary!,
    createdAt: new Date().toISOString(),
  });
}
```

- [x] **Step 4: Add auto-continuation prompt for compaction**

When compaction happens, append:

```text
Continue after context compaction. Do not restart project discovery. Use the compacted context and recent transcript to finish the existing objective.
```

- [x] **Step 5: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "compacted summary|context compaction" }
```

Expected: focused tests pass.

Progress note 2026-06-20: Added `compactMessagesForGoal`, applied Goal resume compaction with a saved session summary, preserved the original system prompt plus recent transcript, and appended an explicit continuation-after-compaction instruction. Verified with `npm.cmd run build` plus `node --test dist\__tests__\security.test.js --test-name-pattern "compacted summary|context compaction"` (359 pass, 0 fail).

## Task 7: Goal Supervisor For Multi-Hour Continuation

**Files:**
- Create: `src/core/agent-run-supervisor.ts`
- Modify: `src/platform/local-platform.ts`
- Modify: `src/workers/local-worker-runner.ts`
- Modify: `src/scheduler/local-scheduler-service.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing supervisor test**

Add:

```ts
test("goal supervisor auto-continues stopped chunks until complete", async () => {
  const model = new ChunkedGoalModel({
    chunks: [
      { toolTurns: 3, stopByBudget: true },
      { toolTurns: 3, stopByBudget: true },
      { toolTurns: 1, final: "goal complete after continuations" },
    ],
  });
  const platform = await createTestPlatform({
    model,
    targetMode: "goal",
    maxSteps: 3,
  });
  const result = await platform.goalSupervisor.run({
    objective: "finish across chunks",
    autoContinue: true,
    maxContinuations: 5,
  });
  assert.equal(result.status, "complete");
  assert.match(result.finalAnswer, /goal complete after continuations/);
  assert.equal(result.continuations, 2);
});
```

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "goal supervisor" }
```

Expected: build fails because supervisor does not exist.

- [x] **Step 2: Create supervisor**

Create:

```ts
export type AgentRunSupervisorInput = {
  objective: string;
  sessionId?: string;
  autoContinue: boolean;
  maxContinuations?: number;
  maxDurationMs?: number;
  signal?: AbortSignal;
};

export type AgentRunSupervisorResult = {
  status: "complete" | "stopped" | "blocked" | "cancelled" | "failed";
  sessionId?: string;
  goalId?: string;
  finalAnswer: string;
  continuations: number;
};
```

The supervisor loop:

1. Run `agent.runWithSession(objective)` for a new session or `agent.resume(sessionId)` for an existing session.
2. Inspect the session report.
3. If complete, return `complete`.
4. If stopped by a resumable runtime stop and `autoContinue` is true, append a goal checkpoint and resume.
5. If the same blocker repeats 3 times, return `blocked`.
6. If `signal.aborted`, return `cancelled`.

- [x] **Step 3: Expose from local platform**

Return `goalSupervisor` from `createLocalPlatform`:

```ts
goalSupervisor: new AgentRunSupervisor({
  store,
  createAgent: createMainAgent,
  goalService,
  buildSessionReport: (sessionId) => buildSessionReportView(store, sessionId),
})
```

- [x] **Step 4: Make worker runner preserve resumable goal work**

In `LocalWorkerRunner.executeAssignment`, if final answer contains a runtime stop and the session remains `paused` or `running`, return `completed: false` so `poll` stops as `paused_assignment` instead of marking failed/completed incorrectly.

- [x] **Step 5: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "goal supervisor|paused_assignment" }
```

Expected: focused tests pass.

Progress note 2026-06-20: Added `AgentRunSupervisor`, exposed `goalSupervisor` from the local platform, auto-continued resumable Goal runtime stops until durable completion, and taught `LocalWorkerRunner` to keep resumable Goal runtime stops leased for continuation instead of completing the assignment as failed. Added focused `long-task-runtime.test.ts` because `security.test.ts` is too broad for reliable narrow runtime verification. Verified with `npm.cmd run build` plus `node --test dist\__tests__\long-task-runtime.test.js` (2 pass, 0 fail).

## Task 8: Rich TUI Long-Task Controls

**Files:**
- Modify: `src/cli/tui/state.ts`
- Modify: `src/cli/tui/commands.ts`
- Modify: `src/cli/tui/rich-shell.ts`
- Modify: `src/cli/tui/layout.ts`
- Modify: `src/cli/tui/event-renderer.ts`
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/rich-tui.test.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing TUI tests**

Add assertions that the Work Ledger shows:

```text
Goal: active
Progress:
Budget: model calls
Next: /pause /cancel /background
```

And that commands work:

```ts
await shell.submit("/pause waiting for user review");
assert.match(shell.latestFrame(), /Run: Paused/);

await shell.submit("/cancel no longer needed");
assert.match(shell.latestFrame(), /Run: Cancelled/);

await shell.submit("/background");
assert.match(shell.latestFrame(), /queued for worker/);
```

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "long-task|pause|background|goal status" }
```

Expected: tests fail because the commands and rows are missing.

- [x] **Step 2: Extend state**

Add:

```ts
goal?: {
  id: string;
  status: "active" | "complete" | "blocked" | "cancelled";
  objective: string;
  checkpoints: number;
  repeatedBlockers: number;
  modelCalls: number;
  tokenUsed: number;
};
runBudget?: {
  steps: number;
  modelCalls: number;
  elapsedMs: number;
  maxSteps?: number;
  maxModelCalls?: number;
  maxDurationMs?: number;
};
```

- [x] **Step 3: Add commands**

Add command palette entries:

```ts
{ name: "/pause [reason]", command: "/pause", description: "Pause the active session" }
{ name: "/cancel [reason]", command: "/cancel", description: "Cancel the active session" }
{ name: "/background", command: "/background", description: "Queue the active Goal session for worker continuation" }
{ name: "/goal status", command: "/goal status", description: "Show durable Goal progress" }
```

- [x] **Step 4: Wire command handlers**

Use existing control/session operations:

```ts
context.pauseSession?.({ sessionId, reason });
context.cancelSession?.({ sessionId, reason });
context.backgroundSession?.({ sessionId });
context.goalStatus?.({ sessionId });
```

Keep raw audit metadata hidden; show only status, session id, and next action.

- [x] **Step 5: Render long-task rows**

In `layout.ts`, under `CHECKS`, show:

```text
Goal: active | complete | blocked
Progress: <checkpoint-count> checkpoints
Budget: <modelCalls> calls, <elapsed>
Next: /pause /cancel /background
```

- [x] **Step 6: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "long-task|pause|background|goal status" }
```

Expected: focused TUI tests pass.

Progress note 2026-06-20: Added long-task TUI state, `/pause`, `/cancel`, `/background`, and `/goal status` command handling, rendered Goal/Budget/Next rows in the Soloclaw TUI, and verified with `node --test dist\__tests__\rich-tui.test.js --test-name-pattern "long-task|pause|background|goal status|rich shell supports an injected TTY smoke flow"` (75 pass, 0 fail).

## Task 9: CLI And Worker Long-Task Gate

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/cli/phase2-closure-status.ts` only if shared rendering helpers are reused.
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing gate test**

Add:

```ts
test("phase3 long-task gate verifies no low step cap and worker continuation", async () => {
  const result = await runCliJson([
    "phase3",
    "long-task-gate",
    "--workspace",
    fixture.workspace,
    "--json",
  ]);
  assert.equal(result.status, "pass");
  assert.equal(result.checks.find((check) => check.id === "L1")?.status, "pass");
  assert.equal(result.checks.find((check) => check.id === "L2")?.status, "pass");
  assert.equal(result.checks.find((check) => check.id === "L3")?.status, "pass");
  assert.equal(result.secretMatches, 0);
});
```

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "long-task gate" }
```

Expected: CLI reports unknown `phase3 long-task-gate`.

- [x] **Step 2: Add command**

Add:

```text
soloclaw phase3 long-task-gate --workspace <path> --json
```

Checks:

- `L1`: Build completes more than 30 tool turns without explicit step cap.
- `L2`: Goal completes more than 80 tool turns without explicit step cap.
- `L3`: Explicit `maxSteps=3` stops, supervisor auto-continues, and final session completes.
- `L4`: Doom-loop stops before repeated tool calls exceed threshold.
- `L5`: Worker assignment resumes a paused/stopped Goal session and completes it.
- `L6`: TUI smoke sees Goal state, budget checkpoint, todo rows, and pause/cancel/background rows.
- `L7`: secret-shape scan returns 0.

- [x] **Step 3: Implement deterministic smoke models**

Use local deterministic models inside the gate helper:

```ts
class ManyStepModel implements ModelClient {
  constructor(private readonly steps: number, private readonly final: string) {}
  calls = 0;
  async complete(): Promise<ModelResponse> {
    this.calls += 1;
    if (this.calls <= this.steps) {
      return { type: "tool_calls", content: "", toolCalls: [{ id: `call_${this.calls}`, name: "list_files", arguments: { path: "." } }] };
    }
    return { type: "message", content: this.final };
  }
}
```

- [x] **Step 4: Run GREEN verification**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "long-task gate|ManyStepModel" }
```

Expected: focused tests pass.

Progress note 2026-06-20: Added `phase3 long-task-gate` and deterministic smoke models. The gate now verifies Build over 30 tool turns, Goal over 80 tool turns, supervised chunk continuation, doom-loop guardrail, worker continuation, TUI long-task rows/commands, and secret-shape scan. Verified with `node dist\cli\index.js phase3 long-task-gate --workspace E:\code\agent --json` returning `status=pass` for L1-L7.

## Task 10: Real-Provider Long-Task Validation

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `docs/superpowers/plans/2026-06-20-soloclaw-phase3b-long-task-runtime.md`

- [x] **Step 1: Add operator command**

Add:

```text
soloclaw phase3 long-task-real-provider --workspace E:\code\tafang --json
```

The command should:

1. Check configured model readiness.
2. Run a read-only Goal task that requires at least 8 tool events and a visible final answer.
3. Run a small reversible Build task and clean it up.
4. Run a supervised Goal task with explicit small chunk limit and auto-continuation.
5. Run `session verify` for every produced session.
6. Scan `.agent` for secret-shaped strings.

- [x] **Step 2: Execute against `E:\code\tafang`**

Run:

```powershell
npm.cmd run check
node dist\cli\index.js phase3 long-task-gate --workspace E:\code\agent --json
node dist\cli\index.js phase3 long-task-real-provider --workspace E:\code\tafang --json
git diff --check
```

Expected:

- `npm.cmd run check` exits 0.
- long-task gate returns `status=pass`.
- real-provider command returns `status=pass`, provider/model metadata, session ids, event counts, verification statuses, and `secretMatches=0`.
- `git diff --check` exits 0 except existing LF/CRLF warnings.

- [x] **Step 3: Record evidence**

Append a dated verification section to this plan with:

- command list;
- exit status;
- L1-L7 status;
- real-provider session ids;
- event/tool counts;
- cleanup evidence for `E:\code\tafang`;
- secret scan result.

Progress note 2026-06-20: Added `phase3 long-task-real-provider` and executed it against `E:\code\tafang` with the configured DeepSeek provider. The command verified real-provider readiness, read-only Goal work, reversible Build work with cleanup, supervised Goal continuation, session verification, and `.agent` secret scanning.

## Task 11: opencode-Style Todo Ledger For Long Build Work

**Files:**
- Create: `src/domain/session-todo.ts`
- Modify: `src/domain/index.ts`
- Modify: `src/store/agent-store.ts`
- Modify: `src/store/memory-agent-store.ts`
- Modify: `src/store/sqlite-agent-store.ts`
- Modify: `src/tools/workspace-tools.ts`
- Modify: `src/sessions/session-inspection-view.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing todo-ledger tests**

Add tests that assert:

```ts
test("workspace todowrite tool persists ordered session todos for long tasks", async () => {
  const store = new MemoryAgentStore();
  const session = await store.createSession({
    objective: "track a long build task",
    status: "running",
    risk: "medium",
    createdBy: { type: "user", id: "todo-user", displayName: "Todo User" },
    targetMode: "build",
  });
  const tools = createWorkspaceTools(new LocalWorkspaceRuntime(process.cwd()), {
    store,
    actor: { type: "user", id: "todo-user", displayName: "Todo User" },
    sessionId: session.id,
  });
  const todowrite = tools.find((tool) => tool.name === "todowrite");

  assert.ok(todowrite);
  const result = await todowrite.handler({
    todos: [
      { content: "Read project structure", status: "completed", priority: "high" },
      { content: "Implement long-task continuation", status: "in_progress", priority: "high" },
      { content: "Run verification gate", status: "pending", priority: "medium" },
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(await store.listSessionTodos(session.id), [
    { content: "Read project structure", status: "completed", priority: "high" },
    { content: "Implement long-task continuation", status: "in_progress", priority: "high" },
    { content: "Run verification gate", status: "pending", priority: "medium" },
  ]);
});

test("session report exposes persisted todo ledger summary", async () => {
  const store = new MemoryAgentStore();
  const session = await store.createSession({
    objective: "report todo state",
    status: "completed",
    risk: "medium",
    createdBy: { type: "user", id: "todo-report-user", displayName: "Todo Report User" },
    targetMode: "build",
  });
  await store.replaceSessionTodos(session.id, [
    { content: "Plan change", status: "completed", priority: "high" },
    { content: "Run gate", status: "pending", priority: "medium" },
  ]);

  const report = await buildSessionReportView(store, session.id);

  assert.equal(report.summary.todos.total, 2);
  assert.equal(report.summary.todos.completed, 1);
  assert.equal(report.summary.todos.pending, 1);
  assert.deepEqual(report.todos.map((todo) => todo.content), ["Plan change", "Run gate"]);
});
```

Run:

```powershell
npm.cmd run build
```

Expected before implementation: build fails because `listSessionTodos`, `replaceSessionTodos`, `report.summary.todos`, and `report.todos` do not exist.

- [x] **Step 2: Add session todo domain types**

Create `src/domain/session-todo.ts`:

```ts
export type SessionTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type SessionTodoPriority = "high" | "medium" | "low";

export type SessionTodo = {
  content: string;
  status: SessionTodoStatus;
  priority: SessionTodoPriority;
};
```

Export it from `src/domain/index.ts`.

- [x] **Step 3: Add store methods**

Add to `AgentStore`:

```ts
replaceSessionTodos(sessionId: string, todos: SessionTodo[]): Promise<void>;
listSessionTodos(sessionId: string): Promise<SessionTodo[]>;
```

Implement in memory store with a `Map<string, SessionTodo[]>` and defensive copies.

Implement in SQLite with:

```sql
CREATE TABLE IF NOT EXISTS session_todos (
  session_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  PRIMARY KEY (session_id, position),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

Write by deleting existing todos for the session and inserting the new ordered list inside one transaction.

- [x] **Step 4: Add `todowrite` workspace tool**

Add a model-facing tool named `todowrite` to `createWorkspaceTools`.

Tool rules:

- requires a store and session id;
- accepts only non-empty todo content;
- accepts statuses `pending`, `in_progress`, `completed`, `cancelled`;
- accepts priorities `high`, `medium`, `low`;
- persists the full ordered list by calling `replaceSessionTodos`;
- returns the ordered list as JSON;
- uses hidden display details with title `Update task list`.

- [x] **Step 5: Expose todos in session reports**

In `buildSessionReportView`, read todos from the store and return:

```ts
summary: {
  todos: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    cancelled: number;
  };
}
todos: SessionTodo[];
```

- [x] **Step 6: Run GREEN verification**

Run:

```powershell
npm.cmd run build
node --test dist\__tests__\security.test.js --test-name-pattern "todowrite|todo ledger"
```

Expected: build passes and todo-ledger tests pass.

Progress note 2026-06-20: Added `SessionTodo`, memory and SQLite persistence, the `todowrite` workspace tool, and session-report todo summaries. Verification ran `npm.cmd run build` successfully and `node --test dist\__tests__\security.test.js --test-name-pattern "todowrite|todo ledger"`, which executed the full security file in this setup with 366 pass, 0 fail.

Fresh local gate after Task 11:

```powershell
npm.cmd run check
git diff --check
node dist\cli\index.js phase3 long-task-gate --workspace E:\code\agent --json
```

Results:

- `npm.cmd run check`: pass.
- `git diff --check`: pass with only LF/CRLF working-copy warnings.
- Local long-task gate: `status=pass`; L1 Build 35 tool turns; L2 Goal 85 tool turns; L3 supervised continuation completed after 2 continuations; L4 doom-loop guardrail; L5 worker keeps resumable Goal leased; L6 TUI rows present; L7 secret scan `0`.

## Task 12: Surface Todo Ledger In The Soloclaw TUI

**Files:**
- Modify: `src/__tests__/rich-tui.test.ts`
- Modify: `src/cli/tui/state.ts`
- Modify: `src/cli/tui/layout.ts`
- Modify: `src/cli/tui/rich-shell.ts`
- Modify: `src/cli/index.ts`

- [x] **Step 1: Write failing TUI todo visibility tests**

Add tests that provide `state.todos` and assert the conversation screen renders:

```text
Todos: 1 active, 1 pending, 1 done
TODO   active Implement long-task continuation
TODO   next Run verification gate
```

Add a submit-path test that returns `todos` from the task runner and asserts `state.todos` is updated.

Run:

```powershell
npm.cmd run build
node --test dist\__tests__\rich-tui.test.js --test-name-pattern "session todos"
```

Expected before implementation: build or test fails because `RichTuiState`/task result does not expose todos and layout does not render them.

- [x] **Step 2: Add TUI todo state and rendering**

Add `RichTuiSessionTodo` and `todos?: RichTuiSessionTodo[]` to `RichTuiState`.

Render in the work ledger:

```text
TODO   active <in-progress task>
TODO   next <pending task>
```

Render in checks:

```text
Todos: <active> active, <pending> pending, <done> done
```

- [x] **Step 3: Propagate report todos into the rich shell**

Add `todos?: RichTuiState["todos"]` to `RichTuiTaskRunResult`.

In `submitRichTuiInput` and `/resume`, clear stale todos at run start and set `state.todos = result.todos` after completion.

In `runRichTuiAgentTask` and `resumeRichTuiAgentSession`, read `buildSessionReportView(...).todos` and return it to the rich shell.

- [x] **Step 4: Strengthen the local long-task gate**

Update `phase3 long-task-gate` L6 so its TUI smoke requires todo summary and active todo rows, not only Goal/Budget/Next rows.

- [x] **Step 5: Run GREEN verification**

Run:

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\rich-tui.test.js --test-name-pattern "session todos|stores todos"
node dist\cli\index.js phase3 long-task-gate --workspace E:\code\agent --json
```

Results:

- `npm.cmd run build`: pass.
- `npm.cmd run check`: pass.
- TUI focused command: 77 pass, 0 fail in this Node test setup.
- Local long-task gate: `status=pass`; L6 now reports `visibleRows=6/6`, including todo summary and active todo rows; L7 secret scan `0`.

## Task 13: Expose Goal Ledger In Session Reports

**Files:**
- Modify: `src/sessions/session-inspection-view.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write the failing report test**

Add this test near the existing session-report and goal-ledger tests:

```ts
test("session report exposes durable goal ledger and recent checkpoints", async () => {
  const store = new MemoryAgentStore();
  const session = await store.createSession({
    objective: "ship a true long task",
    status: "running",
    risk: "medium",
    createdBy: { type: "user", id: "goal-report-user", displayName: "Goal Report User" },
    targetMode: "goal",
  });
  const service = new GoalService(store);
  const goal = await service.startForSession(session, { tokenBudget: 5000 });
  await service.updateUsage(goal.id, { tokenUsed: 1200, modelCalls: 4 });
  await service.recordCheckpoint(goal.id, {
    kind: "progress",
    sessionId: session.id,
    summary: "Read project files and identified the runtime boundary.",
    metadata: { filesRead: 7 },
  });
  await service.recordBlocker(goal.id, "approval:appr_1", "Waiting for an approval decision.");

  const report = await buildSessionReportView(store, session.id);

  assert.equal(report.summary.goal?.status, "active");
  assert.equal(report.summary.goal?.objective, "ship a true long task");
  assert.equal(report.summary.goal?.tokenBudget, 5000);
  assert.equal(report.summary.goal?.tokenUsed, 1200);
  assert.equal(report.summary.goal?.modelCalls, 4);
  assert.equal(report.summary.goal?.checkpoints, 3);
  assert.equal(report.goal?.id, goal.id);
  assert.equal(report.goalCheckpoints.some((checkpoint) => checkpoint.kind === "progress"), true);
  assert.equal(
    report.goalCheckpoints.some((checkpoint) => checkpoint.summary.includes("runtime boundary")),
    true,
  );
});
```

Run:

```powershell
npm.cmd run build
node --test dist\__tests__\security.test.js --test-name-pattern "session report exposes durable goal ledger"
```

Expected before implementation: TypeScript or the focused test fails because `summary.goal`, `goal`, and `goalCheckpoints` are not exposed by `buildSessionReportView`.

- [x] **Step 2: Add safe report types**

In `src/sessions/session-inspection-view.ts`, import the goal domain types and add report-safe shapes:

```ts
import type { AuditEvent, FileChange, GoalCheckpoint, GoalRun, PolicyAction, Session, SessionTodo } from "../domain/index.js";

type SessionReportGoalSummary = {
  id: string;
  objective: string;
  status: GoalRun["status"];
  tokenBudget?: number;
  tokenUsed: number;
  modelCalls: number;
  repeatedBlockerKey?: string;
  repeatedBlockers: number;
  checkpoints: number;
  blockerCheckpoints: number;
  verificationCheckpoints: number;
  updatedAt: string;
  completedAt?: string;
};

type SessionReportGoalCheckpoint = Pick<
  GoalCheckpoint,
  "id" | "goalId" | "sessionId" | "kind" | "summary" | "blockerKey" | "metadata" | "createdAt"
>;
```

- [x] **Step 3: Read goal state and checkpoints in `buildSessionReportView`**

After loading todos, load the goal ledger:

```ts
const goal = await store.getGoalRunBySession(sessionId);
const goalCheckpoints = goal ? await store.listGoalCheckpoints(goal.id, 20) : [];
```

Add this to `summary`:

```ts
goal: summarizeSessionGoal(goal, goalCheckpoints),
```

Add top-level report fields after `todos`:

```ts
goal: goal ? summarizeGoalRunForReport(goal) : undefined,
goalCheckpoints: goalCheckpoints.map(summarizeGoalCheckpointForReport),
```

- [x] **Step 4: Add summary helpers**

Add helpers near `summarizeSessionTodos`:

```ts
function summarizeSessionGoal(
  goal: GoalRun | undefined,
  checkpoints: GoalCheckpoint[],
): SessionReportGoalSummary | undefined {
  if (!goal) return undefined;
  return {
    ...summarizeGoalRunForReport(goal),
    checkpoints: checkpoints.length,
    blockerCheckpoints: checkpoints.filter((checkpoint) => checkpoint.kind === "blocker").length,
    verificationCheckpoints: checkpoints.filter((checkpoint) => checkpoint.kind === "verification").length,
  };
}

function summarizeGoalRunForReport(goal: GoalRun) {
  return {
    id: goal.id,
    objective: goal.objective,
    status: goal.status,
    tokenBudget: goal.tokenBudget,
    tokenUsed: goal.tokenUsed,
    modelCalls: goal.modelCalls,
    repeatedBlockerKey: goal.repeatedBlockerKey,
    repeatedBlockers: goal.repeatedBlockers,
    updatedAt: goal.updatedAt,
    completedAt: goal.completedAt,
  };
}

function summarizeGoalCheckpointForReport(checkpoint: GoalCheckpoint): SessionReportGoalCheckpoint {
  return {
    id: checkpoint.id,
    goalId: checkpoint.goalId,
    sessionId: checkpoint.sessionId,
    kind: checkpoint.kind,
    summary: checkpoint.summary,
    blockerKey: checkpoint.blockerKey,
    metadata: checkpoint.metadata,
    createdAt: checkpoint.createdAt,
  };
}
```

- [x] **Step 5: Run GREEN verification**

Run:

```powershell
npm.cmd run build
node --test dist\__tests__\security.test.js --test-name-pattern "session report exposes durable goal ledger|goal ledger"
npm.cmd run check
node dist\cli\index.js phase3 long-task-gate --workspace E:\code\agent --json
git diff --check
```

Expected:

- build passes;
- focused goal-report tests pass;
- existing goal-ledger tests still pass;
- local long-task gate still returns `status=pass`;
- `git diff --check` reports no new whitespace errors.

Progress note 2026-06-20: Implemented. `buildSessionReportView` now exposes `summary.goal`, top-level `goal`, and recent `goalCheckpoints`, so long Goal sessions carry objective-level status, usage, blocker, and checkpoint evidence into handoff reports. Also updated the long-task gate security assertion from `visibleRows=4` to `visibleRows=6` to match the already-expanded TUI todo visibility gate.

Task 13 verification:

```powershell
npm.cmd run build
node --test dist\__tests__\security.test.js --test-name-pattern "session report exposes durable goal ledger|agent phase3 long-task gate verifies"
npm.cmd run check
npm.cmd test
node dist\cli\index.js phase3 long-task-gate --workspace E:\code\agent --json
node dist\cli\index.js phase3 long-task-real-provider --workspace E:\code\tafang --json
git diff --check
```

Results:

- `npm.cmd run build`: pass.
- Security related-pattern run: 367 pass, 0 fail in this Node test setup; includes `session report exposes durable goal ledger and recent checkpoints` and `agent phase3 long-task gate verifies no low step cap and continuation controls`.
- `npm.cmd run check`: pass.
- `npm.cmd test`: pass; 468 pass, 0 fail.
- Local long-task gate: `status=pass`; L1-L7 pass; L6 `visibleRows=6/6`; L7 secret scan `0`.
- Real-provider long-task gate: `status=pass`; provider `deepseek`; model `deepseek-v4-flash`; R1 session `sess_p0ctzv21`, `toolEvents=8`, `verification=pass`, `changedPaths=0`; R2 session `sess_sol9gn59`, `toolEvents=14`, cleanup removed `.agent/tmp/phase3-real-provider-build-marker.txt`; R3 session `sess_sn6g12bq`, `continuations=1`, `runtimeStops=1`, `verification=pass`; R4 `secretMatches=0`.
- `E:\code\tafang` is not a git repository, so there is no git status to report there; direct marker check confirmed `.agent/tmp/phase3-real-provider-build-marker.txt` is absent after cleanup.
- `git diff --check`: pass with only existing LF/CRLF warnings.

## Verification Evidence 2026-06-20

Commands already run:

```powershell
npm.cmd run build
npm.cmd run check
git diff --check
node --test dist\__tests__\rich-tui.test.js --test-name-pattern "long-task|pause|background|goal status|rich shell supports an injected TTY smoke flow"
node --test dist\__tests__\long-task-runtime.test.js
node --test dist\__tests__\security.test.js
node --test dist\__tests__\security.test.js --test-name-pattern "todowrite|todo ledger"
node dist\cli\index.js phase3 long-task-gate --workspace E:\code\agent --json
node dist\cli\index.js phase3 long-task-real-provider --workspace E:\code\tafang --json
```

Results:

- `npm.cmd run build`: pass.
- `npm.cmd run check`: pass.
- `git diff --check`: pass, with only existing LF/CRLF warnings.
- TUI long-task focused test: 75 pass, 0 fail.
- `long-task-runtime.test.js`: 2 pass, 0 fail.
- `security.test.js`: 363 pass, 0 fail in the earlier full run.
- Todo-ledger focused command: 366 pass, 0 fail in this Node test setup because the whole security file is loaded and executed.
- Local long-task gate: `status=pass`; L1 Build 35 tool turns; L2 Goal 85 tool turns; L3 supervised explicit-step-budget continuation; L4 doom-loop guardrail; L5 worker keeps resumable Goal leased; L6 TUI long-task rows/commands/todos; L7 secret-shape scan `0`.
- Real-provider gate against `E:\code\tafang`: `status=pass`; provider `deepseek`; model `deepseek-v4-flash`; R1 session `sess_thuif7wt` with 10 tool events and verification pass; R2 session `sess_em8s5mzd` changed `.agent/tmp/phase3-real-provider-build-marker.txt`, then cleanup removed the marker and verification passed; R3 session `sess_q38ut0i4` had 1 continuation and 1 runtime stop with verification pass; R4 secret scan `0`.

### Follow-up Stabilization 2026-06-20

Observed failure:

- `node dist\cli\index.js phase3 long-task-real-provider --workspace E:\code\tafang --json` initially failed R1 on session `sess_7dz7zh1y`.
- Root cause: the real model prefixed read-only file paths with the workspace folder name (`tafang/index.html`, etc.), then recovered by listing files and reading the correct files. Session verification still failed because early `read_file` errors left `failedToolResults=4` and `outcome=failed`.

Fix:

- Added `formatPhaseThreeReadOnlyGoalPrompt` in `src/cli/phase3-long-task-prompts.ts`.
- R1 now explicitly says the workspace root is already selected, paths must be passed exactly as workspace-relative paths such as `index.html`, paths must not be prefixed with the workspace folder name, and `run_command` must not be used for the read-only check.
- Added a deterministic test, `phase3 real-provider read-only prompt prevents workspace-folder path drift`.

Fresh verification after the fix:

```powershell
npm.cmd run build
node --test dist\__tests__\security.test.js --test-name-pattern "phase3 real-provider read-only prompt prevents workspace-folder path drift"
node dist\cli\index.js phase3 long-task-real-provider --workspace E:\code\tafang --json
node dist\cli\index.js phase3 long-task-gate --workspace E:\code\agent --json
git diff --check
```

Results:

- `npm.cmd run build`: pass.
- Security test run: 364 pass, 0 fail.
- Real-provider gate: `status=pass`; provider `deepseek`; model `deepseek-v4-flash`; R1 session `sess_736v1t98`, `toolEvents=8`, `verification=pass`, `changedPaths=0`; R2 session `sess_2tzf21jl`, cleanup removed `.agent/tmp/phase3-real-provider-build-marker.txt`; R3 session `sess_fbgk0h6t`, `continuations=1`, `runtimeStops=1`, `verification=pass`; R4 `secretMatches=0`.
- Local long-task gate: `status=pass`; L1-L7 pass; secret scan `0`.
- `git diff --check`: pass with only existing LF/CRLF warnings.

### Fresh Resume Verification 2026-06-20

Commands run after resuming this long-task goal:

```powershell
npm.cmd run build
npm.cmd run check
npm.cmd test
node dist\cli\index.js phase3 long-task-gate --workspace E:\code\agent --json
node dist\cli\index.js phase3 long-task-real-provider --workspace E:\code\tafang --json
node dist\cli\index.js smoke --rich-tui --workspace E:\code\agent
node dist\cli\index.js phase3 gate --workspace E:\code\tafang --json
git diff --check
```

Results:

- `npm.cmd run build`: pass.
- `npm.cmd run check`: pass.
- `npm.cmd test`: pass; 468 pass, 0 fail.
- Local long-task gate: `status=pass`; L1 Build 35 tool turns; L2 Goal 85 tool turns; L3 supervisor completed after 2 continuations and 2 runtime stops; L4 doom-loop guardrail; L5 worker keeps resumable Goal leased; L6 TUI long-task rows/todos/commands; L7 secret scan `0`.
- Real-provider long-task gate: `status=pass`; provider `deepseek`; model `deepseek-v4-flash`; R1 read-only Goal session `sess_cdqf1zy8`, `toolEvents=8`, `verification=pass`, `changedPaths=0`; R2 reversible Build session `sess_utio7839`, cleanup removed `.agent/tmp/phase3-real-provider-build-marker.txt`; R3 supervised Goal session `sess_sdhunlvu`, `continuations=1`, `runtimeStops=1`, `verification=pass`; R4 `secretMatches=0`.
- Rich TUI smoke: `ok=true`; saw welcome, mode, input, progress, answer, context, resume, phase2 evidence, and exit rows.
- Phase 3 gate: `status=pass`; C4 real project build, C5 stop/resume, C6 recovery, and secret hygiene all passed.
- `git diff --check`: pass with only existing LF/CRLF warnings.
- Direct cleanup check confirmed `E:\code\tafang\.agent\tmp\phase3-real-provider-build-marker.txt` is absent.

### Final Closeout Verification 2026-06-21

Additional closeout work:

- Configured the real-model profile for the requested OpenAI-compatible endpoint without writing the raw API key into model JSON. Global Soloclaw config and the `E:\code\tafang` workspace config both point to provider `openai_compatible`, base URL `https://vsllm.com/v1`, model `gpt-5.5`, and encrypted secret refs.
- Tightened Phase 3 real-provider Goal prompts so a model cannot satisfy the gate by returning a plain text plan before using tools.
- Tightened R3 supervised Goal validation so completion requires observed tool events in addition to continuation/runtime-stop evidence.

Commands run:

```powershell
npm.cmd run build
node --test dist\__tests__\security.test.js --test-name-pattern "phase3 real-provider read-only prompt prevents workspace-folder path drift"
node dist\cli\index.js phase3 long-task-real-provider --workspace E:\code\tafang --json
node dist\cli\index.js phase3 long-task-gate --workspace E:\code\agent --json
node dist\cli\index.js phase3 gate --workspace E:\code\tafang --json
node dist\cli\index.js smoke --rich-tui --workspace E:\code\agent
git diff --check
npm.cmd test
```

Results:

- `npm.cmd run build`: pass.
- Security test command: pass; 368 pass, 0 fail in this Node test setup.
- Real-provider long-task gate against `E:\code\tafang`: `status=pass`; provider `openai_compatible`; model `gpt-5.5`; R1 read-only Goal `toolEvents=10`, `changedPaths=0`; R2 reversible Build cleanup removed `.agent/tmp/phase3-real-provider-build-marker.txt`; R3 supervised Goal `continuations=1`, `runtimeStops=1`, `toolEventCount=2`; R4 secret scan `0`.
- Local long-task gate: `status=pass`; L1-L7 pass; secret scan `0`.
- Phase 3 gate: `status=pass`; C4/C5/C6 and secret hygiene pass against `E:\code\tafang`.
- Rich TUI smoke: `ok=true`.
- `git diff --check`: pass with only LF/CRLF working-copy warnings.
- `npm.cmd test`: pass; 503 pass, 0 fail.
- Direct cleanup check confirmed `E:\code\tafang\.agent\tmp\phase3-real-provider-build-marker.txt` is absent.

## Acceptance Criteria

- `Build` and `Goal` no longer have low default step caps.
- Explicit budgets still work and produce structured runtime stops.
- Repeated identical tool calls stop through a guardrail before wasting a long run.
- `Goal` creates durable goal state and checkpoints.
- Goal completion requires evidence, not just a confident sentence.
- Goal blocked state requires the same blocker to repeat 3 consecutive times.
- Resume and compaction continue the existing objective instead of restarting.
- TUI shows objective, goal status, budget usage, next action, and safe progress rows.
- `/pause`, `/cancel`, `/background`, `/goal status`, and `/resume` operate on the active session.
- Worker/scheduler paths can continue a Goal session after a foreground run stops.
- `soloclaw phase3 long-task-gate --json` passes with deterministic local evidence.
- Real-provider long-task smoke passes against `E:\code\tafang` when model readiness is available.
- No raw API keys, bearer tokens, vault passphrases, command bodies, raw outputs, or patch bodies are shown by default.

## Verification Commands

```powershell
npm.cmd run build
npm.cmd run check
npm.cmd test
node dist\cli\index.js smoke --rich-tui --workspace E:\code\agent
node dist\cli\index.js phase3 gate --workspace E:\code\tafang --json
node dist\cli\index.js phase3 long-task-gate --workspace E:\code\agent --json
node dist\cli\index.js phase3 long-task-real-provider --workspace E:\code\tafang --json
git diff --check
```

## Self-Review Notes

- Spec coverage: Plan, Build, and Goal each have target semantics and tests. Long-task runtime includes no-low-step-cap, explicit budgets, doom-loop guardrail, durable goal state, compaction, supervisor continuation, TUI controls, worker continuation, local gate, and real-provider validation.
- Placeholder scan: this plan intentionally contains no unresolved placeholder steps. Every task has target files, test commands, and expected results.
- Type consistency: `GoalRun`, `GoalCheckpoint`, `AgentRunBudget`, `RunBudgetController`, `AgentRunSupervisorResult`, and new event names are used consistently across tasks.

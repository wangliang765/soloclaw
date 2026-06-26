# Soloclaw Chat-First TUI Status Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the rich TUI into a chat-first interface with a narrow right status rail for plan progress, model context, run state, and minimal workspace status.

**Architecture:** Keep the existing string-rendered TypeScript TUI and event projection pipeline. Replace the current `MISSION / LEDGER / CHECKS` conversation layout with a two-column layout on wide terminals: left transcript/action lane, right compact status rail. Collapse the rail into a single footer summary on narrow terminals.

**Tech Stack:** TypeScript, Node.js terminal streams, ANSI escape sequences, existing `src/cli/tui` render helpers, existing `node:test` rich TUI tests.

---

## Target Design

The new default conversation screen should feel like a chat surface first:

```text
Soloclaw  Build  deepseek-v4-flash                         context 18%

You
  褰撳墠椤圭洰鐨?TUI 鐣岄潰涓嶇編瑙傦紝鎬庝箞璋冩暣锛?
Soloclaw
  鎴戜細鎸夎亰澶╀紭鍏堢殑鏂瑰紡閲嶅仛涓诲睆锛氬乏渚у睍绀哄璇濄€佸伐鍏疯皟鐢ㄣ€?  鏂囦欢缂栬緫鍜岃繍琛屽弽棣堬紱鍙充晶鍙繚鐣欒鍒掕繘灞曚笌妯″瀷鐘舵€併€?
  鈹?read  src/cli/tui/layout.ts
  鈹?grep  renderConversationScreen
  鈹?edit  src/cli/tui/layout.ts
  鈹?test  rich-tui.test.ts passed

> 缁х画璋冩暣鍙充晶璁″垝鏍?..

                                                        Plan
                                                        3 / 5 done
                                                        Now
                                                        Polish layout

                                                        Remaining
                                                        - Input dock
                                                        - Tests

                                                        Model
                                                        DeepSeek
                                                        deepseek-v4-flash
                                                        36K / 200K
                                                        18%

                                                        Run
                                                        Build
                                                        Working
                                                        step 2
```

Design rules:

- Left lane is the primary reading area: user messages, assistant text, safe tool/action summaries, edit/test feedback, stop/error rows.
- Right rail is secondary and narrow: plan progress, current step, remaining steps, model/context, run mode/health, compact workspace state.
- No raw command body, raw stdout/stderr, raw patch body, API key, authorization header, or secret-like value is shown by default.
- Wide terminals render two columns. Narrow terminals hide the rail and show a compact footer such as `Build 路 Working 路 Plan 3/5 路 deepseek-v4-flash 路 36K/200K 路 ctrl+p`.
- Welcome and model setup screens can remain mostly unchanged in this pass, except for wording that should match the new chat-first vocabulary.

## File Structure

- Modify `src/cli/tui/layout.ts`
  - Owns the new chat-first conversation layout, column split, right rail, transcript rows, action rows, input dock, and narrow fallback.
- Modify `src/cli/tui/event-renderer.ts`
  - Keep existing safe event rendering, but add compact action labels suitable for inline transcript rows if needed.
- Modify `src/cli/tui/state.ts`
  - Add optional plan progress state only if existing state cannot express the right rail: total steps, completed steps, current step title, remaining step titles.
- Modify `src/cli/tui/rich-shell.ts`
  - Populate plan progress fields from pending plan approval, projected assistant parts, current activity, or existing run state without changing task execution semantics.
- Modify `src/__tests__/rich-tui.test.ts`
  - Replace Work Ledger assertions with chat-first layout assertions and add wide/narrow rail tests.
- Modify `src/cli/tui/rich-smoke.ts`
  - Update scripted smoke markers from `INPUT DOCK` / Work Ledger wording to stable chat-first markers.

## Task 1: Lock The Layout Contract In Tests

**Files:**
- Modify: `src/__tests__/rich-tui.test.ts`

- [x] **Step 1: Add a wide-layout test for chat-first conversation**

Add a test that renders `renderConversationScreen` at `columns: 140, rows: 34` with user/assistant messages, projected tool parts, context, run health, and workspace status. Assert that:

- The screen contains `Soloclaw`.
- The screen contains `You` and `Soloclaw` message labels.
- The screen contains compact action rows such as `read`, `edit`, or existing safe event text.
- The screen contains right rail headings: `Plan`, `Model`, `Run`.
- The screen does not contain `MISSION`, `LEDGER`, `CHECKS`, or `INPUT DOCK`.
- Every visible line stays within terminal width using `visibleLength`.

Example assertion shape:

```ts
const screen = renderConversationScreen(state, { columns: 140, rows: 34 });
assert.match(screen, /Soloclaw/);
assert.match(screen, /You/);
assert.match(screen, /Plan/);
assert.match(screen, /Model/);
assert.match(screen, /Run/);
assert.doesNotMatch(screen, /MISSION|LEDGER|CHECKS|INPUT DOCK/);
assert.equal(screen.split("\n").every((line) => visibleLength(line) <= 140), true);
```

- [x] **Step 2: Add a narrow-layout test**

Render the same state at `columns: 72, rows: 24`. Assert that:

- The right rail headings are hidden.
- The footer contains compact status: mode, run health, model, context summary, and command hint.
- Conversation text remains visible.
- All lines fit within width.

- [x] **Step 3: Run the focused tests and confirm failure**

Run:

```powershell
npm.cmd run build
node --test dist\__tests__\rich-tui.test.js --test-name-pattern "chat-first|right rail|narrow"
```

Expected before implementation: tests fail because the current renderer still emits Work Ledger labels.

## Task 2: Build The Chat-First Layout Renderer

**Files:**
- Modify: `src/cli/tui/layout.ts`

- [x] **Step 1: Replace `renderWorkLedgerScreen` with a chat-first screen**

Introduce a wide/narrow branch in `renderConversationScreen`:

- Wide: `width >= 110` renders left lane plus right rail.
- Narrow: `width < 110` renders left lane only plus compact footer.

Implementation structure:

```ts
function renderChatScreen(state: RichTuiState, width: number, height: number): string[] {
  const dock = renderChatInput(state, width);
  const bodyLimit = Math.max(0, height - dock.length);
  const wide = width >= 110;
  const railWidth = wide ? Math.min(32, Math.max(26, Math.floor(width * 0.26))) : 0;
  const gap = wide ? 2 : 0;
  const leftWidth = wide ? width - railWidth - gap : width;
  const leftRows = renderChatLane(state, leftWidth, bodyLimit);
  const railRows = wide ? renderStatusRail(state, railWidth, bodyLimit) : [];
  const body = wide ? joinColumns(leftRows, railRows, leftWidth, railWidth, gap, bodyLimit) : leftRows.slice(0, bodyLimit);
  while (body.length < bodyLimit) body.push("");
  return [...body, ...dock].slice(0, height);
}
```

- [x] **Step 2: Add column joining helpers**

Add helpers in `layout.ts` using existing `clip`, `padRight`, and width-aware helpers:

```ts
function joinColumns(left: string[], right: string[], leftWidth: number, rightWidth: number, gap: number, maxRows: number): string[] {
  const rows: string[] = [];
  for (let index = 0; index < maxRows; index += 1) {
    const leftLine = padRight(clip(left[index] ?? "", leftWidth), leftWidth);
    const rightLine = clip(right[index] ?? "", rightWidth);
    rows.push(`${leftLine}${" ".repeat(gap)}${rightLine}`);
  }
  return rows;
}
```

- [x] **Step 3: Render the left chat lane**

The left lane should include:

- Top compact header: `Soloclaw  <mode>  <provider>/<model>  <context>`.
- Recent messages with labels `You`, `Soloclaw`, `System`.
- Folded projected assistant/tool rows under assistant activity.
- Safe recent event rows.
- Stop/error/approval rows as visible conversation feedback.

Rules:

- Do not show `MISSION`, `LEDGER`, `CHECKS`.
- Keep labels short and mixed-case.
- Assistant text should be readable before operational metadata.
- Continue using `selectVisibleMessages`, `renderProjectedAssistantRows`, and `renderEventRow` behavior where possible.

- [x] **Step 4: Render the input dock as chat input**

Replace the heavy `INPUT DOCK` label with a lightweight prompt:

```text
> current input
Build 路 Working 路 Plan 3/5 路 deepseek-v4-flash 路 context 18% 路 ctrl+p commands 路 f2 mode 路 esc exit
```

If the input is empty, show the existing placeholder meaning in simpler form:

```text
> Ask Soloclaw to inspect, change, test, or explain
```

- [x] **Step 5: Run focused layout tests**

Run:

```powershell
npm.cmd run build
node --test dist\__tests__\rich-tui.test.js --test-name-pattern "chat-first|right rail|narrow"
```

Expected: new layout tests pass or fail only on right rail data not implemented yet.

## Task 3: Add The Right Status Rail

**Files:**
- Modify: `src/cli/tui/layout.ts`
- Modify: `src/cli/tui/state.ts` only if needed

- [x] **Step 1: Define optional plan progress state**

If existing fields are insufficient, add this optional shape:

```ts
export type RichTuiPlanProgress = {
  total: number;
  completed: number;
  current?: string;
  remaining: string[];
};
```

Add to `RichTuiState`:

```ts
planProgress?: RichTuiPlanProgress;
```

- [x] **Step 2: Render rail sections**

Add `renderStatusRail(state, width, maxRows)` with these sections:

```text
Plan
3 / 5 done
Now
Polish layout
Remaining
- Input dock
- Tests

Model
DeepSeek
deepseek-v4-flash
36K / 200K
18%

Run
Build
Working
step 2

Workspace
agent
3 changed
```

Fallbacks:

- If `planProgress` is missing, show `Plan` then `No active plan` or `Plan needs approval` when `pendingPlanApproval` exists.
- If context is missing, show `context n/a`.
- If workspace path is long, show only the final folder name.
- If dirty count is unavailable, omit the dirty row.

- [x] **Step 3: Add rail tests**

Test cases:

- Full plan progress: `3 / 5 done`, current step, remaining list.
- Missing context: shows `context n/a`.
- Dirty workspace: shows short folder plus `N changed`.
- Pending plan approval: shows `Plan needs approval`.

- [x] **Step 4: Run tests**

Run:

```powershell
npm.cmd run build
node --test dist\__tests__\rich-tui.test.js --test-name-pattern "right rail|context unavailable|pending plan|workspace"
```

Expected: all focused rail tests pass.

## Task 4: Feed Plan Progress Without Changing Agent Semantics

**Files:**
- Modify: `src/cli/tui/rich-shell.ts`
- Modify: `src/__tests__/rich-tui.test.ts`

- [x] **Step 1: Populate basic plan progress**

When a Plan-mode result creates `pendingPlanApproval`, derive simple progress:

```ts
state.planProgress = {
  total: 2,
  completed: 1,
  current: "Awaiting approval",
  remaining: ["Approve plan", "Execute build"],
};
```

When Build or Goal starts, clear or update the plan progress to:

```ts
state.planProgress = {
  total: 3,
  completed: 1,
  current: state.currentActivity ?? "Working",
  remaining: ["Apply changes", "Verify result"],
};
```

This is intentionally conservative for the first pass. Do not parse arbitrary markdown plans into steps in this task.

- [x] **Step 2: Update progress from run events**

On `tool_finished` with `status: "ok"`, increment completed progress only if `planProgress` exists and completed is below total. Keep current step aligned with `activityForToolName(event.toolName)` or the event title.

- [x] **Step 3: Preserve existing mode behavior**

Do not change:

- Plan mode write-blocking behavior.
- Build mode execution.
- Goal resume/session behavior.
- Secret redaction.
- Event persistence.

- [x] **Step 4: Add tests for progress state**

Add focused tests around `submitRichTuiInput` and `applyAgentRunEventToRichState`:

- Plan mode result shows `Awaiting approval` in the rail.
- Tool completion updates the current rail activity.
- `/clear` clears `planProgress`.

- [x] **Step 5: Run tests**

Run:

```powershell
npm.cmd run build
node --test dist\__tests__\rich-tui.test.js --test-name-pattern "plan progress|approval|clear"
```

Expected: focused progress tests pass.

## Task 5: Update Smoke Markers And Compatibility Tests

**Files:**
- Modify: `src/cli/tui/rich-smoke.ts`
- Modify: `src/__tests__/rich-tui.test.ts`

- [x] **Step 1: Replace old smoke wait markers**

Change smoke waits that look for `INPUT DOCK`, `MISSION`, `LEDGER`, or `CHECKS` to stable new markers:

- `Soloclaw`
- `> Ask Soloclaw`
- `ctrl+p commands`
- `Plan` only where wide terminal rail is expected

- [x] **Step 2: Keep model setup tests stable**

Do not require model setup wizard to adopt the new layout in this pass. It can continue rendering `Model setup` and provider choices.

- [x] **Step 3: Run scripted rich smoke**

Run:

```powershell
npm.cmd run build
node dist\cli\index.js smoke --rich-tui
```

Expected: smoke exits 0 and still observes welcome, mode switch, input, progress, answer, context, resume, phase2, evidence-record, evidence-check, and exit coverage.

## Task 6: Full Verification

**Files:**
- No source changes unless verification exposes a failure.

- [x] **Step 1: Run type check**

Run:

```powershell
npm.cmd run check
```

Expected: exits 0.

- [x] **Step 2: Run full test suite**

Run:

```powershell
npm.cmd test
```

Expected: exits 0.

- [x] **Step 3: Run rich TUI smoke**

Run:

```powershell
node dist\cli\index.js smoke --rich-tui
```

Expected: exits 0.

- [x] **Step 4: Check whitespace**

Run:

```powershell
git diff --check
```

Expected: exits 0, allowing only existing CRLF conversion warnings if they are already present.

## Acceptance Criteria

- The conversation screen is chat-first on wide and narrow terminals.
- The old `MISSION / LEDGER / CHECKS / INPUT DOCK` visual language is removed from the conversation screen.
- Wide terminals show a narrow right rail with plan progress, model/context, run state, and compact workspace state.
- Narrow terminals collapse right rail information into a single compact footer.
- Tool calls and edits appear in the left lane as safe, folded summaries.
- Raw commands, raw output, raw patches, tool JSON, API keys, bearer tokens, and secret-like values remain hidden by default.
- Existing model setup, command palette, mode switching, `/status`, `/sessions`, `/resume`, Plan approval, and rich smoke flows still work.
- `npm.cmd run check`, `npm.cmd test`, and `node dist\cli\index.js smoke --rich-tui` pass.

## Closeout Evidence 2026-06-20

Commands run after implementation:

```powershell
npm.cmd run build
npm.cmd test
node dist\cli\index.js smoke --rich-tui --workspace E:\code\agent
git diff --check
```

Results:

- `npm.cmd run build`: pass.
- `npm.cmd test`: pass; 503 pass, 0 fail in the latest full run.
- Rich TUI smoke: pass in the Phase 3 resume verification recorded by the long-task runtime plan; it observed welcome, mode, input, progress, answer, context, resume, phase2 evidence, and exit rows.
- `git diff --check`: pass with only LF/CRLF working-copy warnings on Windows.

## Implementation Notes

- Prefer small helper functions in `layout.ts` before creating new files. Split into a new renderer file only if `layout.ts` becomes hard to scan.
- Keep all UI strings ASCII unless existing tests already require Chinese prompt content.
- Keep terminal width safety as a first-class requirement: every rendered line must pass `visibleLength(line) <= columns`.
- Treat the right rail as informational only. It must not drive task execution or approval semantics.
- The first implementation should not parse markdown plans into exact checklist steps. Use simple progress fields and event-derived current activity; richer plan parsing can be a later feature.

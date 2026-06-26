# Soloclaw Rich TUI And Event Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `soloclaw` open a polished, dedicated terminal interface with a chat input, active model/workspace status, and live folded execution progress comparable to Codex/opencode.

**Architecture:** Add a safe agent event protocol between `AgentLoop`, workspace tools, session evidence, and the TUI. Render a rich full-screen TUI for interactive terminals, keep a plain line-mode fallback for non-TTY tests and pipes, and expose the same event stream through a local subscribe endpoint for web/desktop UI in Task 10.

**Tech Stack:** TypeScript, Node.js readline/raw terminal input, ANSI escape sequences, existing SQLite `AgentStore`, existing model clients, existing workspace tools. No git commit in this plan unless the user explicitly asks.

---

## Design Reference

The reference screenshot is an opencode-style first screen:

- Large centered product mark.
- Centered prompt box.
- Status row with mode, configured model, provider/persona, and effort indicator.
- Small shortcut row such as `tab agents` and `ctrl+p commands`.
- Bottom tip line.

The second reference screenshot is an opencode-style normal conversation screen:

- Left side contains the submitted prompt, public progress rows, and the assistant response.
- Right side contains context usage, spend, LSP status, working directory, and product version.
- Bottom line keeps the active mode, model, context use, and command shortcut visible while the task runs.
- The interface stays sparse and readable; it does not print raw command bodies, raw patches, tool output, or secrets into the main transcript by default.

The latest user-provided normal-conversation reference is `C:\Users\Administrator\Desktop\2.png`. It shows the desired persistent conversation state more clearly than the welcome screenshot: the submitted prompt stays pinned in the transcript, the agent exposes a compact public `Thought`/progress row, the right rail carries context and environment state, and the bottom bar keeps mode/model/context shortcuts visible. Soloclaw should keep this information hierarchy while using its own labels and interaction language.

The opencode source shows the deeper architecture:

- `E:\code\opencode\packages\core\src\session\event.ts:175` defines `Step`, `Text`, `Reasoning`, and `Tool` events.
- `E:\code\opencode\packages\opencode\src\session\llm\ai-sdk.ts:82` converts model `fullStream` parts into internal LLM events.
- `E:\code\opencode\packages\opencode\src\session\processor.ts:631` persists tool success, patch, text, and reasoning parts.
- `E:\code\opencode\packages\core\src\session\message-updater.ts:188` projects events into UI-friendly assistant messages.
- `E:\code\opencode\packages\opencode\src\server\routes\instance\httpapi\handlers\event.ts:25` streams events through SSE.

Soloclaw should copy the architecture pattern, not the exact implementation style.

## Conversation Screen Design

The second reference screenshot shows the normal working state after a prompt is submitted. Soloclaw should have two rich TUI states:

- **Welcome state:** centered logo, prompt box, model/workspace status, shortcut hints, and setup tip.
- **Conversation state:** transcript on the left, live execution events folded under the active assistant turn, persistent input box at the bottom, and a right-side status rail.

The conversation state should make long tasks feel observable without exposing unsafe details:

- Left transcript:
  - User message block with a colored left rail.
  - Assistant progress rows such as `Thinking 499ms`, `Read README.md`, `Run command`, `Edit src/game.js`.
  - Assistant final answer.
  - Current input box anchored at the bottom.
- Bottom status row:
  - Active mode: `Plan`, `Build`, or `Goal`.
  - Active provider/model, for example `DeepSeek - deepseek-v4-flash`.
  - Last run duration.
  - Context summary, for example `9.6K (5%)`.
  - Shortcut hints: `tab focus`, `ctrl+p commands`, `f2 mode`.
- Right status rail:
  - Current objective or latest user prompt.
  - Context tokens, percent used, optional window limit, and estimated spend if available.
  - Model readiness and secret readiness.
  - LSP status, shown as disabled until a real LSP integration exists.
  - Workspace path and Soloclaw version.

Mode behavior:

- `Plan`: the agent should inspect and propose a plan, but avoid file writes unless the user explicitly approves the plan.
- `Build`: the agent can execute the approved/default task loop with tools.
- `Goal`: the agent should keep a durable objective and continue across longer runs with step-budget summaries.

The first implementation can model the modes in the UI and pass the selected mode into the task runner. Enforcement can start conservative: `Plan` uses planning instructions and write-blocking policy; `Build` preserves current behavior; `Goal` uses the existing goal/session machinery where available and clearly shows when the run stops because of a step budget.

## Soloclaw Conversation UI V2 Addendum

This addendum captures the desired Soloclaw-specific version of the opencode conversation layout. It should guide the next UI polish pass and the final acceptance checklist.

### Visual Personality

Soloclaw should feel like a dedicated task cockpit, not a generic REPL:

- Use the Soloclaw name as the first visible brand signal on the welcome and conversation screens.
- Keep the layout calm and information-dense: a roomy transcript on the left, a narrow operational rail on the right, and a stable input/status area at the bottom.
- Prefer concise operational labels over explanatory prose. The UI should show state directly instead of teaching the user how the product works.
- Avoid making the interface look like a clone of opencode. Borrow the information architecture, but keep Soloclaw's own wording and mode semantics.
- Default to a medium-density **cockpit** layout: richer than a plain chat window, lighter than an IDE. The design should still be adjustable later toward a simpler chat-first layout or a more professional expandable-logs layout if the user chooses that direction.

### Conversation Cockpit Ideas

The normal conversation screenshot suggests a useful information hierarchy: transcript first, run metadata second, shortcuts last. Soloclaw should keep that hierarchy while giving the interface its own vocabulary:

- **Mission strip:** show the current objective, active mode, and run health near the right rail top. In `Goal` mode this becomes the durable goal; in `Plan` and `Build` it mirrors the latest user prompt.
- **Context gauge:** show tokens and percent used when usage is available, with a stable `context n/a` fallback when the provider does not return usage. Later this can include estimated cost only when pricing data is explicit.
- **Run pulse:** show the current phase as a compact public status such as `Thinking`, `Reading`, `Editing`, `Testing`, `Waiting approval`, `Stopped`, or `Done`. This replaces hidden chain-of-thought with safe, useful state.
- **Event lane:** show folded rows for actions under the active assistant turn: `Read file`, `Search workspace`, `Run command`, `Edit file`, `Tests passed`. The detailed command, raw output, and patch body remain hidden unless a future explicit expand control is added.
- **Mode switcher:** keep `Plan`, `Build`, and `Goal` always visible in the bottom row. `F2` cycles modes in real terminals; `/mode plan`, `/mode build`, and `/mode goal` select directly. The injected test harness may still send `ctrl+m`, but real terminal guidance should use `F2` because `Ctrl+M` is indistinguishable from Enter in common terminal input.
- **Mode semantics:** explain the active mode in status surfaces, not only as a label. `Plan` displays `read-only planning`, `Build` displays `workspace execution`, and `Goal` displays `durable objective`. The selected rich TUI mode is passed into the task runner and mapped to the core `targetMode`.
- **Resume loop:** keep long-task continuation inside Soloclaw. `/resume` resumes the active session shown in the right rail, and `/resume <session-id>` resumes a specific session without dropping back to the plain CLI. When a run is stopped with an active session, the right rail and `/status` show `Next: /resume`.
- **Model badge:** show provider and model as a compact badge, for example `DeepSeek / deepseek-v4-flash`, plus readiness. If the API key is missing, the badge should say `needs setup` and the command palette should make `/model setup` obvious.
- **Workspace badge:** show the current folder and a short dirty-state summary when available, for example `E:\code\agent · 18 changed`.
- **Session footer:** keep elapsed time, step count or budget stop, context summary, and `ctrl+p commands` visible while the agent is working.

These are content targets, not a requirement to copy the exact opencode layout. The first Soloclaw implementation can render them as text-first terminal panels; later desktop/web surfaces can subscribe to the same event stream and give the same data a richer treatment.

### Left Transcript

The transcript should distinguish four kinds of rows:

- User prompt rows: colored left rail, full prompt text, no timestamp unless there is room.
- Assistant text rows: streamed answer text, updated as deltas arrive.
- Public progress rows: safe summaries such as `Thinking 499ms`, `Read README.md`, `Edit src/game.js`, `Run command`, `Tests passed`.
- Stop/error rows: explicit stop reasons such as `Step budget reached`, `Model failed`, `Secret approval required`, or `Plan needs approval`.

Progress rows must remain folded by default. The default UI must not show raw command strings, raw command output, raw patch bodies, raw tool JSON, API keys, vault passphrases, or provider authorization headers.

### Right Status Rail

The rail should answer "is this run healthy and what environment is it using?":

- Objective: latest user prompt or durable Goal objective.
- Run health: `Ready`, `Working`, `Needs approval`, `Stopped`, `Failed`, or `Done`.
- Context: token count, percent used when a context window is known, and `context n/a` when usage is unavailable.
- Spend: estimated spend only when safe usage and pricing data are available; otherwise omit the row.
- Model: provider, model id, readiness, and whether the API key is available through env or vault.
- Workspace: current workspace path and dirty-state summary when available.
- LSP: disabled for now, later upgraded to actual language-server status.
- Session: active session id, step count, and last run duration when available.
- Version: Soloclaw version.

### Bottom Status And Controls

The bottom row should stay visible during editing and during long task runs:

- Active mode: `Plan`, `Build`, or `Goal`.
- Active provider and model.
- Last run duration.
- Context summary such as `9.6K (5%)` or `context n/a`.
- Key hints: `ctrl+p commands`, `f2 mode`, `tab focus`, `esc exit`.

The prompt box above it should remain the active chat input. It may show a short placeholder on the welcome screen, but once the user starts typing, typed text takes priority and must not be overwritten by progress output.

### Modes

Mode semantics should become visible and enforceable:

- `Plan`: read, inspect, and propose. File writes and high-impact commands require explicit user approval.
- `Build`: execute the task loop with normal workspace tools and verification.
- `Goal`: keep the durable objective visible, make step-budget stops resumable, and show the reason when the run pauses.

Mode switching should work through both `/mode [plan|build|goal]` and `F2`.

### Command Palette

`ctrl+p` should open a compact command palette. The first useful entries are:

- `/model setup`: configure provider/model/API key.
- `/mode [plan|build|goal]`: switch task mode.
- `/status`: show workspace, model, context, and run health.
- `/sessions`: show recent sessions.
- `/resume [session-id]`: resume the active or selected session.
- `/help`: show available commands.
- `/exit`: quit Soloclaw.

The current implementation renders a compact in-place command palette with a visible cursor. `ctrl+p` opens it, Up/Down move the cursor, Space inserts the selected command into the input, and Enter executes the selected command.

### Native Model Setup Target

The rich UI now has a native Soloclaw setup flow for the happy path, with the previous tested menu retained as a fallback:

- Provider picker with arrow-key movement and Space/Enter selection.
- Base URL shown beside each provider.
- Custom OpenAI-compatible and Anthropic-compatible providers prompt for a base URL before model selection, with the preset URL as the default.
- API key, docs, and pricing links shown after a provider is selected when the provider preset includes them.
- Model picker for known provider models plus a custom model id option.
- API key input that accepts pasted plaintext, stores only an encrypted secret reference, and never echoes or writes the raw key to profile JSON.
- Return to the conversation screen with provider, model, and readiness refreshed.

### Acceptance Checks

The UI work is not complete until these are true:

- Running `soloclaw` in a real TTY opens the rich Soloclaw screen by default.
- A user can configure a model, then submit a natural-language task without leaving the Soloclaw flow.
- Model output streams into the assistant turn.
- Progress events appear live and folded under the active turn.
- Plan/Build/Goal are visible and switchable.
- Context usage appears when the provider returns usage and falls back clearly when unavailable.
- Step-budget stops and model failures are visible in the transcript instead of crashing the shell.
- API keys, passphrases, raw Authorization headers, command bodies, raw tool inputs, and raw patch bodies are not printed by default.
- Escape or Ctrl+C restores the terminal cursor and exits cleanly.

## Current State

The current branch started with partial progress work:

- `src/core/agent-loop.ts` has `AgentLoopProgressEvent`.
- `src/platform/local-platform.ts` passes `onAgentProgress`.
- `src/cli/index.ts` prints simple progress lines during natural-language TUI tasks.
- `src/__tests__/security.test.ts` covers basic TUI progress and step-budget stop guidance.

This plan upgrades that into a full UI/event system.

Verified snapshot on 2026-06-18:

- Event protocol, redaction helpers, tool display metadata, event persistence, timeline surfacing, local event bus, and web SSE endpoint are implemented in the working tree.
- Rich TUI rendering, welcome/conversation layouts, right status rail, context display fallback, command list, `/mode`, `F2` mode switching, `/model setup` handoff, and natural-language task runner wiring are implemented in the working tree.
- Conversation UI polish now includes a right-rail run health status, safe current activity labels, step count display, last public event titles, workspace branch/dirty-state summary, rich `/status`, `/model check`, and `/sessions` summaries, readable multi-line system messages, a keyboard-driven command palette, a testable key-handling controller, injected-terminal shell smoke tests for natural-language tasks, approval errors, native model setup, unknown-context fallback before provider usage arrives, assistant-text event projection into the transcript, a CLI-level `soloclaw smoke --rich-tui` scripted rich-shell smoke, and CJK-aware terminal width helpers for Chinese prompts.
- Rich TUI submit handling is now testable outside the raw terminal loop: `/status`, `/sessions`, `/mode`, `/model setup`, and natural-language task dispatch are covered without relying on manual keypress smoke tests.
- Native rich model setup state is implemented for provider selection, custom compatible-provider base URL entry, provider docs/API-key/pricing links, model selection, custom model input, masked API-key entry, and encrypted-vault profile saving. The previous line/menu setup remains as a fallback.
- OpenAI-compatible and Anthropic-compatible streaming paths have focused tests; Anthropic tool-call streaming still intentionally falls back to non-streaming for tool requests.
- `npm run build` passed.
- Focused rich TUI tests passed with 34 tests after adding workspace dirty-state and unknown-context status coverage.
- `soloclaw smoke --rich-tui` passed and reported `ok=true` with welcome, mode, input, progress, answer, context, and exit coverage.
- `npm test` passed with 351 tests after the CLI-level rich TUI smoke was added.
- `git diff --check` reported only CRLF conversion warnings.
- Temporary-file scan found no `.tmp`, `.bak`, `.log`, `.old`, `.orig`, `.rej`, or `.tsbuildinfo` files in the workspace.
- A real interactive TTY smoke test is still required before calling the full objective complete.

Verified snapshot on 2026-06-19 after adding `/clear` and real-terminal-safe `F2` mode switching:

- `npm.cmd run build` passed.
- `npm.cmd run check` passed.
- `npm.cmd test` passed with 352 tests.
- `git diff --check` reported only CRLF conversion warnings and no whitespace errors.
- Temporary-file scan found no `.tmp`, `.bak`, `.log`, `.old`, `.orig`, `.rej`, or `.tsbuildinfo` files in the workspace.
- `node dist\cli\index.js status` passed for workspace `E:\code\agent`; readiness is `pass`, active model is `mock`, and the command reported branch `codex/phase2-deliverable` with 22 changed files.
- `node dist\cli\index.js smoke --rich-tui` passed and reported `ok=true` with welcome, mode, input, progress, answer, context, and exit coverage.
- Focused evidence showed Node parses `Ctrl+M` as `return`, so the visible shortcut was changed to `F2 mode` while `/mode [plan|build|goal]` remains available.
- `F2` mode switching is covered by `rich-tui.test.ts`, and the CLI rich smoke now presses `F2` before submitting the scripted task.
- Rich TUI status surfaces now show explicit mode semantics: `Plan - read-only planning`, `Build - workspace execution`, and `Goal - durable objective`. Tests cover `/status`, the right status rail, and passing the selected mode to the task runner.
- Rich TUI now includes `/resume`: it resumes the active session id when available, accepts `/resume <session-id>` for explicit continuation, streams resumed progress through the same event lane, reports a clear prompt when no session id is available, and shows `Next: /resume` when a stopped run can be continued.
- A temporary `.agent/tmp/conpty-smoke` .NET 6 ConPTY verifier was built and removed. It could create a pseudoconsole, but every child process tested through it, including `cmd.exe /k echo HELLO`, exited with `0xC0000142` and produced no screen output across the tested pipe/handle inheritance combinations. This means automated real-TTY validation is blocked by the current Codex host environment, not by a Soloclaw test failure.
- A real external interactive TTY smoke test is still required before calling the full objective complete. Current automated evidence covers injected TTY behavior and CLI-level scripted smoke, but not a human-driven terminal session.

Verified snapshot on 2026-06-19 after extending the scripted rich TUI smoke through `/resume`:

- The rich TUI smoke now drives a natural-language task, receives a session id, enters `/resume` in the same full-screen shell, streams resumed progress through the event lane, receives a resumed assistant answer, and exits cleanly.
- `npm.cmd run build` passed.
- `node --test dist\__tests__\security.test.js --test-name-pattern "rich TUI scripted flow"` passed for the compiled test file; Node still enumerated the full file and reported 302 passing tests.
- `node dist\cli\index.js smoke --rich-tui` passed and reported `ok=true` with `saw=welcome,mode,input,progress,answer,context,resume,exit`.
- A real external interactive TTY smoke test is still required before calling the full objective complete.

## Remaining Work Plan

The current working tree has the event-stream and rich-TUI foundation in place. The remaining work below is the completion plan for bringing Soloclaw closer to the mature opencode interaction model while preserving Soloclaw's own task-cockpit identity.

### Current Completion Board (2026-06-21)

Use this board as the source of truth for the legacy Phase 2 closeout. The event-stream foundation, dedicated Soloclaw TUI input/navigation work, Plan/Build approval flow, Goal continuation, later chat-first TUI status rail, and Phase 3/3B runtime gates are implemented. The remaining Phase 2 blockers are still manual evidence: a real external terminal smoke and one real-provider task run through the real Soloclaw terminal path. Later automated real-provider gates prove model/runtime capability, but they do not replace the original C1/C2/C3 manual review contract. Do not create a git commit until the user explicitly asks.

#### Opencode-style event stream status

- [x] E1 replayable assistant-part projection is implemented through `src/core/agent-message-projector.ts` and consumed by the rich TUI.
- [x] E2 public reasoning lifecycle is implemented as `reasoning_started`, `reasoning_delta`, and `reasoning_finished` events without exposing raw reasoning text.
- [x] E3 Anthropic-compatible streamed tool calls are implemented in `src/model/http-model-clients.ts`.
- [x] E4 safe expanded details are implemented with whitelisted metadata only: paths, status, exit code, duration, and stdout/stderr byte counts.
- [x] E5 web/desktop subscriber visibility is implemented through the token-backed `Agent Event Stream` lane in `src/web/local-room-web-server.ts`.
- [x] E-FINAL final event-stream regression has been rerun as part of the latest full automated gate:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js }
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "web dashboard html|api/events" }
node dist\cli\index.js smoke --rich-tui
git diff --check
```

Expected: tests pass, smoke reports `ok=true` with `saw=welcome,mode,input,progress,answer,context,resume,exit`, and `git diff --check` reports no whitespace errors other than the existing CRLF conversion warnings.

#### Soloclaw dedicated TUI status

- [x] U1 real external terminal smoke is complete. C1 now has dated external-terminal evidence, reviewed closure, and strict evidence-check coverage.
- [x] U2 task-cockpit layout polish is implemented: left transcript/task stream, right status rail, bottom mode/input bar, CJK width coverage, and projected assistant parts.
- [x] U7 Soloclaw visual differentiation pass is implemented. The opencode-like centered welcome logo/input and right status rail were replaced with a top `SOLOCLAW Workbench` strip, `MISSION / LEDGER / CHECKS` main area, safe folded activity rows, and a bottom `INPUT DOCK`.
- [x] U3 input editing and transcript navigation is implemented:
  - [x] Input history exists through `inputHistory`, `inputHistoryIndex`, and `inputHistoryDraft`.
  - [x] Shift+Enter multiline and transcript scroll edits are built and tested.
  - [x] `renderPromptBox()` renders multiline input as bounded prompt rows instead of clipping the whole prompt as one line.
  - [x] `renderConversationMain()` applies `transcriptScrollOffset` when selecting visible transcript rows.
  - [x] A redraw-preservation test proves typed text survives progress-event redraws while an agent run is active.
- [x] U4 Plan -> Build approval workflow is implemented in the rich TUI: Plan runs produce `Needs approval`, `/approve plan` switches to Build, and the original task is executed only after explicit approval.
- [x] U5 Goal mode continuation is implemented: stopped Goal runs show `/continue or /resume`, `/continue` resumes the active session, and manual `/resume` remains available.
- [x] U6 real-provider model setup hardening and manual closeout are complete. C2 now has dated real-provider Soloclaw task evidence, reviewed closure, and secret leak checks.
- [x] U-FINAL full Phase 2 gate is complete. C1/C2/C3 evidence is recorded and reviewed, `phase2 gate` reports `ready_for_completion`, and `phase2 final-gate` reports `status=pass`.

#### Recommended next execution order

1. Keep the recorded C1/C2/C3 evidence intact and do not add secrets to the plan.
2. Treat Phase 2 as closed by the gate evidence below.
3. Continue Phase 4 cross-platform smoke work before calling the broader Phase2-4 deliverable complete.

Latest automated gate snapshot on 2026-06-19:

- `npm.cmd run check` passed.
- `npm.cmd test` passed with 377 tests.
- `node dist\cli\index.js smoke --rich-tui` passed with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,exit`.
- `git diff --check` exited 0 with only existing CRLF conversion warnings and no whitespace errors.
- Temporary-file scan found no `.tmp`, `.bak`, `.log`, `.old`, `.orig`, `.rej`, or `.tsbuildinfo` files outside `.git` and `node_modules`.
- Search found no reusable external terminal automation beyond the already-recorded ConPTY attempt. The remaining U1 evidence still requires a real human-driven external terminal session.

Continuation cleanup snapshot on 2026-06-19 15:59:16 +08:00:

- Historical Task 1-11 implementation checkboxes below were normalized to match the current source/test evidence. Manual TTY and manual real-provider smoke steps remain unchecked.
- `npm.cmd run build` passed.
- `node --test dist\__tests__\agent-events.test.js` passed with 14 tests, 14 pass, 0 fail.
- `node --test dist\__tests__\rich-tui.test.js` passed with 61 tests, 61 pass, 0 fail.
- `node --test dist\__tests__\security.test.js --test-name-pattern "TUI|agent event|model setup|vaulted|step budget|timeline"` passed with 318 tests, 318 pass, 0 fail.
- `npm.cmd run check` passed.
- `npm.cmd test` passed with 398 tests, 398 pass, 0 fail.
- `node dist\cli\index.js smoke --rich-tui` passed with `ok=true`, `provider=mock`, `model=mock`, and `saw=welcome,mode,input,progress,answer,context,resume,phase2,evidence-record,evidence-check,exit`.
- `node dist\cli\index.js smoke --rich-tui-real-provider` passed with `ok=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `readiness=ready_for_manual_run`, `saw=welcome,readiness,input,progress,answer,exit`, and session `sess_6y22rfsw`.
- `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings and no whitespace errors.
- Temporary-file scan printed no paths for `.tmp`, `.bak`, `.log`, `.old`, `.orig`, `.rej`, or `.tsbuildinfo` files outside `.git`, `.agent`, and `node_modules`.
- `.agent` secret-shape scan found 0 matches for raw `sk-*` keys, `Authorization: Bearer`, or `AGENT_SECRETS_PASSPHRASE=...`.
- `node dist\cli\index.js phase2 evidence-check --strict --json` still exits 1 with `status=incomplete_closure_tasks`, `secretMatches=0`, and only `c1ClosureTaskComplete`, `c2ClosureTaskComplete`, and `c3ClosureTaskComplete` failing.
- `node dist\cli\index.js phase2 gate --json` still exits 1 with `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=incomplete_closure_tasks`, and blockers `C1,C2,C3`.

Plan reconciliation snapshot on 2026-06-21:

- `docs/superpowers/plans/2026-06-20-soloclaw-chat-first-tui-status-rail.md` has no unchecked steps and records closeout evidence.
- `docs/superpowers/plans/2026-06-20-soloclaw-phase3-agent-runtime-reliability.md` has no unchecked steps and records Phase 3 gate evidence.
- `docs/superpowers/plans/2026-06-20-soloclaw-phase3b-long-task-runtime.md` has no unchecked steps and records final real-provider closeout evidence.
- `docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md` now tracks the current plan index and open work queue.
- Phase 4A local code/tests are implemented; Windows PowerShell, Windows CMD, and WSL Ubuntu Linux matrix smoke pass, while macOS/Termux real smoke remains pending in `docs/platform-support.md`.

Phase 2 closeout snapshot on 2026-06-21:

- `node dist\cli\index.js phase2 evidence-check --workspace E:\code\agent --strict --json` exited 0 with `status=paste_safe_pending_manual_review`, `secretMatches=0`, and all C1/C2/C3 dated-evidence and closure-task checks passing.
- `node dist\cli\index.js phase2 gate --workspace E:\code\agent --json` exited 0 with `status=ready_for_completion`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=paste_safe_pending_manual_review`, and no blockers.
- `node dist\cli\index.js phase2 final-gate --workspace E:\code\agent --json` exited 0 with `status=pass`: typecheck pass, 503/503 tests pass, mock rich TUI smoke pass, real-provider rich TUI smoke pass, `git diff --check` pass with only LF/CRLF warnings, and temp-file scan pass.

External terminal launch attempt on 2026-06-19 16:08:36 +08:00:

- `node dist\cli\index.js phase2 launch-terminal --workspace E:\code\agent` exited 0 and printed `launched=true`.
- Follow-up process check showed new `powershell.exe` processes started at 2026-06-19 16:08:36.
- This proves the external terminal launcher ran, but it does not satisfy C1 or C2 by itself. C1/C2 still require human observation inside that real terminal and paste-safe evidence recording.

Continuation cleanup snapshot on 2026-06-19 16:30:00 +08:00:

- The DeepSeek testing key supplied by the user was refreshed into the local encrypted vault. `.agent/model-providers.json` still stores only provider metadata plus `apiKeySecretRef`; no plaintext API key was written to tracked files.
- `git check-ignore -v .agent .agent\local-test.env .agent\secrets.vault.json` confirmed `.agent/` is ignored by git.
- `.agent` secret-shape scan found no files containing raw `sk-*` keys, `Authorization: Bearer`, or `AGENT_SECRETS_PASSPHRASE=...`.
- `node dist\cli\index.js model list` shows DeepSeek as the default provider with `model=deepseek-v4-flash`, `baseUrl=https://api.deepseek.com`, and `secret=configured`.
- `npm.cmd run build` exited 0.
- `node --test dist\__tests__\security.test.js --test-name-pattern "launch-terminal prints"` exited 0 and reported 318 tests, 318 pass, 0 fail.
- `node dist\cli\index.js phase2 launch-terminal --workspace E:\code\agent` exited 0 and printed `launched=true`, `method=powershell-start-process`, and `pid=8892`.
- Follow-up process checks showed `powershell.exe` pid `8892` remained alive and had a child `node.exe` running `dist\cli\index.js` from `E:\code\agent`.
- `node dist\cli\index.js smoke --rich-tui-real-provider` exited 0 with `ok=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `readiness=ready_for_manual_run`, `saw=welcome,readiness,input,progress,answer,exit`, and session `sess_2hfj2r2l`.
- `node dist\cli\index.js phase2 readiness --workspace E:\code\agent --json` exited 0 with `status=ready_for_manual_run`, `activeProvider=deepseek`, `model=deepseek-v4-flash`, `baseUrl=https://api.deepseek.com`, and `secretLeakScan=pass`.
- `node dist\cli\index.js phase2 evidence-check --workspace E:\code\agent --strict --json` still exits 1 with `status=incomplete_closure_tasks`, `secretMatches=0`, and only `c1ClosureTaskComplete`, `c2ClosureTaskComplete`, and `c3ClosureTaskComplete` failing.
- `node dist\cli\index.js phase2 gate --workspace E:\code\agent --json` still exits 1 with `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=incomplete_closure_tasks`, and blockers `C1,C2,C3`.
- This snapshot improves the automated preflight and launcher reliability evidence, but it does not satisfy C1/C2/C3. C1 still needs human observation inside a real external terminal; C2 still needs the user-path manual record from the rich TUI; C3 must run after C1 and C2 are recorded.

Continuation regression snapshot on 2026-06-19 16:40:00 +08:00:

- `npm.cmd run check` exited 0.
- `npm.cmd test` exited 0 with 398 tests, 398 pass, 0 fail.
- `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true`, `provider=mock`, `model=mock`, and `saw=welcome,mode,input,progress,answer,context,resume,phase2,evidence-record,evidence-check,exit`.
- `node dist\cli\index.js smoke --rich-tui-real-provider` exited 0 with `ok=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `readiness=ready_for_manual_run`, `saw=welcome,readiness,input,progress,answer,exit`, and session `sess_s7t28tmz`.
- `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings and no whitespace errors.
- Temporary-file scan found no `.tmp`, `.bak`, `.log`, `.old`, `.orig`, `.rej`, or `.tsbuildinfo` files outside `.git`, `.agent`, `dist`, and `node_modules`.
- `.agent` secret-shape scan again found no files containing raw `sk-*` keys, `Authorization: Bearer`, or `AGENT_SECRETS_PASSPHRASE=...`.
- `node dist\cli\index.js phase2 evidence-check --workspace E:\code\agent --strict --json` still exits 1 with `status=incomplete_closure_tasks`, `secretMatches=0`, and only `c1ClosureTaskComplete`, `c2ClosureTaskComplete`, and `c3ClosureTaskComplete` failing.
- `node dist\cli\index.js phase2 gate --workspace E:\code\agent --json` still exits 1 with `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=incomplete_closure_tasks`, and blockers `C1,C2,C3`.
- Current workspace dirt is intentional Phase 2 implementation state. No git commit or staging has been performed.

Closeout-guide continuation snapshot on 2026-06-19 17:19:55 +08:00:

- Added `soloclaw phase2 closeout-guide` as a concise step-by-step manual acceptance path for C1/C2/C3. It prints the external-terminal launch command, the rich-TUI commands to run, paste-safe C1/C2/C3 evidence-record examples, final automated gate commands, and closeout confirmation commands.
- `soloclaw phase2 checklist` now points to `soloclaw phase2 closeout-guide` so the shorter guided path is discoverable from the existing manual checklist.
- TDD evidence: `agent phase2 closeout-guide prints a step-by-step manual acceptance path` was added first and failed because the subcommand was rejected by the old phase2 usage text; after implementation it passed.
- TDD evidence: the existing checklist test was tightened to require `soloclaw phase2 closeout-guide`; it failed against the old checklist output, then passed after the checklist text was updated.
- Verification: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase2 checklist prints|closeout-guide" }` exited 0 and reported 319 tests, 319 pass, 0 fail.
- Verification: `npm.cmd run check` exited 0.
- Direct smoke: `node dist\cli\index.js phase2 closeout-guide` exited 0 and printed Step 1 through Step 5 without secret-looking values.
- Hygiene: `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings and no whitespace errors; the temp-file scan printed `temp-files=none`; the `.agent` secret-shape scan printed `leak-files=none`.
- Strict evidence snapshot: `node dist\cli\index.js phase2 evidence-check --workspace E:\code\agent --strict --json` still exits 1 with `status=incomplete_closure_tasks`, `secretMatches=0`, and only `c1ClosureTaskComplete`, `c2ClosureTaskComplete`, and `c3ClosureTaskComplete` failing. The new guide improves the manual closeout path but does not itself satisfy C1/C2/C3.

Rich TUI closeout-guide continuation snapshot on 2026-06-19 17:27:52 +08:00:

- Added `/phase2 closeout-guide` to the rich TUI command palette and slash-command handler, with `/phase2 guide` as a short alias. This lets the operator open the C1/C2/C3 manual acceptance guide from inside the dedicated Soloclaw interface instead of leaving the rich TUI.
- TDD evidence: `rich TUI submit shows phase2 closeout guide` was added first and failed because `TUI_COMMANDS` did not include `/phase2 closeout-guide`; after registering the command and rendering `renderPhaseTwoCloseoutGuide()` from `rich-shell.ts`, it passed.
- Verification: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 closeout guide" }` exited 0 and reported 62 tests, 62 pass, 0 fail.
- Verification: `npm.cmd run check` exited 0.
- Verification: `node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 closeout guide|phase2 checklist|phase2 gate summary"` exited 0 and reported 62 tests, 62 pass, 0 fail.
- Verification: `node --test dist\__tests__\security.test.js --test-name-pattern "phase2 checklist prints|closeout-guide"` exited 0 and reported 319 tests, 319 pass, 0 fail.
- Hygiene: `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings and no whitespace errors; the temp-file scan printed `temp-files=none`; the `.agent` secret-shape scan printed `leak-files=none`.
- Gate snapshot: `node dist\cli\index.js phase2 gate --workspace E:\code\agent --json` still exits 1 with `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=incomplete_closure_tasks`, and blockers `C1,C2,C3`. This remains expected until the human-observed external terminal evidence and closure checkboxes are completed.

#### Phase 2 Closure Tasks (2026-06-19)

Use this short closure list for the next continuation. The older task sections below remain as implementation history; do not redo checked work unless a regression is found. Do not create a git commit until the user explicitly asks.

Fresh automated preflight on 2026-06-19 10:50:17 +08:00, before manual C1/C2 evidence:

- `npm.cmd run check` passed.
- `npm.cmd test` passed with 377 tests, 377 pass, 0 fail.
- `node dist\cli\index.js smoke --rich-tui` passed with `ok=true`, `provider=mock`, `model=mock`, and `saw=welcome,mode,input,progress,answer,context,resume,exit`.
- `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings and no whitespace errors.
- Temporary-file scan printed no paths for `.tmp`, `.bak`, `.log`, `.old`, `.orig`, `.rej`, or `.tsbuildinfo` files outside `.git` and `node_modules`.
- `.agent` secret-shape scan found 0 matches for raw `sk-*` keys, 0 `Authorization: Bearer` entries, and 0 `AGENT_SECRETS_PASSPHRASE=...` entries.
- This snapshot proves the current automated baseline is healthy, but it does not satisfy C1, C2, or C3 because the real external terminal smoke and real-provider run are still missing.

Workspace dirt audit on 2026-06-19 after the automated preflight:

- Tracked source changes are Phase 2 implementation files, grouped as rich TUI, event projection/streaming, model-provider setup, secret vault handling, platform event publishing, web event visibility, and regression tests.
- Untracked source additions are expected Phase 2 deliverables: `src/cli/tui/*`, `src/core/agent-events.ts`, `src/core/agent-event-redaction.ts`, `src/core/agent-message-projector.ts`, `src/events/local-event-bus.ts`, `src/__tests__/agent-events.test.ts`, and `src/__tests__/rich-tui.test.ts`.
- `docs/superpowers/plans/2026-06-18-soloclaw-rich-tui-event-stream.md` is intentionally untracked until the user asks for git staging or a commit.
- Ignored directories remain runtime/build state: `.agent/`, `dist/`, `node_modules/`, and `target/`.
- `.agent/tmp` exists but contains 0 files and 0 directories, so no private temp cleanup was needed.
- No `.tmp`, `.bak`, `.log`, `.old`, `.orig`, `.rej`, or `.tsbuildinfo` residue was found outside `.git` and `node_modules`.

User-pain-point regression audit on 2026-06-19:

- The earlier `Stopped after 30 steps without a final answer` failure is now mitigated in rich TUI runs by `TUI_RUN_MAX_STEPS = 80`; core `AgentLoop` still defaults to 30 for normal runs and 60 for Goal mode, so non-TUI callers can still hit a step budget by design.
- Step-budget events are projected as `Step budget reached: <n>` and rich TUI status surfaces show `Next: /continue or /resume` for stopped sessions.
- Rich TUI tests cover stopped-run resume guidance, `/continue`, and active-session resume behavior.
- Secret-read approval failures are covered by rich TUI tests that keep the shell alive and show `Needs approval` instead of crashing out of the UI.
- Model setup tests cover provider/model/API-key selection, masked API key display, encrypted secret refs, custom Anthropic-compatible base URLs, and no leaked pasted key in setup output/config/vault key files.
- Focused verification for this audit passed: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "continue|stopped runs show resume|approval errors|native model setup|model setup wizard|api key" }` reported 54 tests, 54 pass, 0 fail.
- This audit is source/test evidence only; the real external-terminal and real-provider checks are still required because they prove terminal behavior and live provider behavior, not just code paths.

Phase 2 engineering verifier snapshot on 2026-06-19 10:59:03 +08:00:

- `node dist\cli\index.js phase2 verify --json --cleanup` exited 0 and reported `status=pass`.
- The verifier reported `phaseClosure=local_alpha_deliverable`.
- Sample workspace creation, failing-test observation, command-timeout evidence, patch application, recovered test, file-change evidence, tool/command audit evidence, and policy-boundary approval evidence all reported `pass`.
- Session evidence reported `sessionVerificationStatus=pass`, `sessionBundleVerificationStatus=pass`, and handoff/session bundle sections including diff, report, result, review, status, timeline, and verification.
- Run/resume/repair evidence reported successful sessions with verification passing, including `agentRepairVerificationStatus=pass` and `resumeVerificationStatus=pass`.
- Target mode evidence reported `plan`, `build`, and `goal` sessions all `succeeded` with verification `pass`.
- Rust WorkspaceRuntime JSON-RPC smoke and Rust tools/policy/audit smoke both reported `ok=true`.
- Model readiness gates intentionally reported `missing_api_key` for synthetic environment variables; this is expected for the local verifier and does not satisfy the real-provider C2 manual run.
- `--cleanup` was true; after the verifier, `.agent/tmp` listed no entries, and the temp-file scan printed no `.tmp`, `.bak`, `.log`, `.old`, `.orig`, `.rej`, or `.tsbuildinfo` paths outside `.git` and `node_modules`.
- This strengthens automated Phase 2 engineering evidence but still does not satisfy C1, C2, or C3 because C1 and C2 require a human-driven external terminal and a real provider/API key.

Completion audit on 2026-06-19 11:01:24 +08:00:

| Requirement | Current status | Evidence | Remaining gap |
| --- | --- | --- | --- |
| Dedicated Soloclaw rich TUI opens instead of a cold command line | Partially proven | Scripted rich TUI smoke passed with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,exit`; renderer/key-handler tests cover layout, mode, prompt, palette, and redraw behavior. | C1 still needs a real Windows Terminal/PowerShell run because injected/scripted TTY evidence cannot prove native terminal rendering, cursor restore, or human keyboard behavior. |
| Opencode-style event stream shows what the agent is doing without leaking unsafe details | Proven by automated evidence | Event protocol, projector, redaction, folded tool rows, reasoning lifecycle, SSE/web event lane, and expanded safe details are covered by `agent-events.test.ts`, `rich-tui.test.ts`, `security.test.ts`, rich smoke, and `phase2 verify`. | No known automated gap; keep included in final C3 regression. |
| Model setup is menu driven: provider -> model -> API key, with compact rows and base URL visibility | Partially proven | Rich TUI tests cover provider picker rows, model picker, API key masking, known provider presets, custom OpenAI-compatible, custom Anthropic-compatible, and no leaked pasted key in setup output/config/vault key files. | C2 still needs one real external-terminal setup with a live provider/API key. |
| Secret storage is safe after API key paste | Partially proven | Automated tests verify encrypted secret refs and no plaintext in setup output/config/vault key files; `.agent` secret-shape scan found 0 raw `sk-*`, 0 `Authorization: Bearer`, and 0 `AGENT_SECRETS_PASSPHRASE=...` matches. | C2 must repeat leak check after a real key is pasted. |
| Natural-language task execution works in the rich UI | Partially proven | Rich shell scripted flow and `phase2 verify` prove natural-language/mock task execution, progress rows, final answer, session evidence, repair, resume, and target modes. | C2 must prove a live provider can answer a small natural-language task through the same user path. |
| Long/stopped tasks are understandable and resumable | Proven by automated evidence for UI behavior | Step-budget projection, `/continue`, `/resume`, stopped-run guidance, and active-session resume are covered by rich TUI tests; `phase2 verify` covers resume evidence. | Real user terminal observation remains part of C1/C2, but no separate code gap is known. |
| Plan/Build/Goal modes are visible and usable | Proven by automated evidence for code paths | Rich TUI tests cover mode cycling and mode-specific task dispatch; `phase2 verify` target-mode evidence reports `plan`, `build`, and `goal` sessions succeeded with verification pass. | C1 must verify `F2` mode cycling in a real terminal. |
| Workspace hygiene is acceptable before completion | Partially proven | `git diff --check` exited 0 with only LF-to-CRLF warnings; temp-file scans printed no residue; `.agent/tmp` was empty after verifier cleanup. | Re-run as part of C3 after C1/C2. |
| Full Phase 2 completion gate | Not complete | Automated preflight, focused rich TUI audit, rich smoke, and `phase2 verify` are recorded above. | C1, C2, then C3 remain required before marking U1, U6, U-FINAL, or the thread goal complete. |

Fresh lightweight gate for this audit:

- `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true`, `provider=mock`, `model=mock`, and `saw=welcome,mode,input,progress,answer,context,resume,exit`.
- `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings and no whitespace errors.
- Temp-file scan printed no paths for `.tmp`, `.bak`, `.log`, `.old`, `.orig`, `.rej`, or `.tsbuildinfo` outside `.git` and `node_modules`.

Manual closure checklist command on 2026-06-19 11:33:00 +08:00:

- Added `agent phase2 checklist` / `node dist\cli\index.js phase2 checklist` to print the C1 external-terminal rich TUI steps, C2 real-provider setup/leak-scan steps, and C3 automated completion gate from the CLI.
- The checklist is intentionally read-only: it does not open a provider connection, does not prompt for an API key, and does not record C1/C2 evidence by itself.
- TDD evidence: the new `security.test.ts` case first failed because `phase2 checklist` was rejected with the old `Usage: agent phase2 verify...` message, then passed after implementation.
- Verification after implementation: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase2 checklist" }` exited 0 and reported 305 tests, 305 pass, 0 fail.
- Direct smoke: `node dist\cli\index.js phase2 checklist` exited 0 and printed C1/C2/C3 without raw API keys or bearer tokens; `node dist\cli\index.js smoke --rich-tui` still reported `ok=true`; `git diff --check` exited 0 with only LF-to-CRLF warnings; temp-file scan printed no paths.
- This makes the manual closeout easier to run from a real terminal, but it does not satisfy C1, C2, or C3.

Soloclaw-first checklist polish on 2026-06-19 11:39:31 +08:00:

- Updated checklist and unknown-subcommand usage to show `soloclaw phase2 checklist` first while preserving `agent phase2 checklist` as a compatibility alias.
- TDD evidence: the existing checklist test was tightened to require `soloclaw phase2 checklist`; it failed against the previous output, then passed after the CLI text update.
- Verification: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase2 checklist" }` exited 0 and reported 305 tests, 305 pass, 0 fail.
- Direct smoke: `node dist\cli\index.js phase2 checklist` now prints `Run this any time with: soloclaw phase2 checklist`; `node dist\cli\index.js phase2 nope` prints usage with `soloclaw phase2 verify`, `soloclaw phase2 checklist`, and `agent phase2 checklist`.
- `node dist\cli\index.js smoke --rich-tui` still reported `ok=true`; `git diff --check` exited 0 with only LF-to-CRLF warnings; temp-file scan printed no paths.
- This is discoverability polish only and still does not satisfy C1, C2, or C3.

Checklist evidence-template polish on 2026-06-19 11:47:49 +08:00:

- Added an `Evidence notes template` section to `soloclaw phase2 checklist` with fields for C1 terminal evidence, C2 provider/model/task/leak-check evidence, and C3 final gate evidence.
- The template explicitly says never to record API keys, key prefixes, bearer tokens, vault passphrases, or Authorization headers.
- TDD evidence: the checklist test was tightened to require `Evidence notes template`, `C1 evidence`, `Terminal`, `C2 evidence`, `Provider`, `Leak check`, and `C3 evidence`; it failed against the previous output, then passed after implementation.
- Verification: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase2 checklist" }` exited 0 and reported 305 tests, 305 pass, 0 fail.
- Direct smoke: `node dist\cli\index.js phase2 checklist` now prints the evidence template; `node dist\cli\index.js smoke --rich-tui` still reported `ok=true`; `git diff --check` exited 0 with only LF-to-CRLF warnings; temp-file scan printed no paths.
- This reduces evidence-recording risk but still does not satisfy C1, C2, or C3.

Standalone evidence-template command on 2026-06-19:

- Added `soloclaw phase2 evidence-template` with compatibility alias `agent phase2 evidence` to print only paste-safe C1/C2/C3 evidence notes, separate from the longer manual checklist.
- The template includes terminal/shell/Node/version fields for C1, provider/model/base URL/model-check/task/leak-check fields for C2, and check/test/rich-smoke/whitespace/temp-scan fields for C3.
- The template explicitly warns never to record API keys, key prefixes, bearer tokens, vault passphrases, or Authorization headers.
- TDD evidence: `agent phase2 evidence-template prints paste-safe manual closure notes` was added first and failed because the subcommand did not exist; after implementation it passed.
- Verification: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase2 evidence-template|phase2 checklist" }` exited 0 and reported 306 tests, 306 pass, 0 fail.
- Direct smoke: `node dist\cli\index.js phase2 evidence-template` exited 0 and printed the paste-safe C1/C2/C3 template; `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,exit`; `git diff --check` exited 0 with only existing LF-to-CRLF warnings.
- This improves the manual closeout workflow but still does not satisfy C1, C2, or C3 because it records no external terminal or real-provider evidence by itself.

Manual closeout status command on 2026-06-19:

- Added `soloclaw phase2 status [--json]` to report the Phase 2 closure state without running any external-provider checks or pretending manual evidence exists.
- Text output reports `status=pending_manual_evidence`, `phaseClosure=manual_closeout_required`, blockers `C1,C2,C3`, C1/C2 as `pending`, and C3 as `waiting_for_C1_C2`.
- JSON output exposes the same status, blocker list, check list, and next commands for future UI or automation use.
- TDD evidence: `agent phase2 status reports manual evidence blockers without leaking secrets` was added first and failed because the subcommand did not exist; after implementation it passed.
- Verification: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase2 status|phase2 evidence-template|phase2 checklist" }` exited 0 and reported 307 tests, 307 pass, 0 fail.
- Direct smoke: `node dist\cli\index.js phase2 status` and `node dist\cli\index.js phase2 status --json` both exited 0 and reported pending manual evidence; `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,exit`; `git diff --check` exited 0 with only existing LF-to-CRLF warnings.
- This improves closeout observability but still does not satisfy C1, C2, or C3.

Rich TUI Phase 2 status command on 2026-06-19:

- Extracted the Phase 2 closure status model into `src/cli/phase2-closure-status.ts` so CLI and rich TUI render the same status text.
- Added `/phase2 status` to the rich TUI command palette and slash-command handler. It appends the pending manual-evidence status to the transcript without leaving the Soloclaw screen.
- TDD evidence: `rich TUI submit shows phase2 closure status` was added first and failed because `/phase2 status` was not in `TUI_COMMANDS`; after implementation it passed.
- Verification: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 closure status" }` exited 0 and reported 55 tests, 55 pass, 0 fail.
- CLI regression: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase2 status|phase2 evidence-template|phase2 checklist" }` exited 0 and reported 307 tests, 307 pass, 0 fail.
- Direct smoke: `node dist\cli\index.js phase2 status` exited 0 with `status=pending_manual_evidence`; `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,exit`; `git diff --check` exited 0 with only existing LF-to-CRLF warnings; temp-file scan printed no paths.
- This keeps Phase 2 closeout visible inside the dedicated Soloclaw interface, but it still does not satisfy C1, C2, or C3.

Rich TUI smoke coverage for Phase 2 status on 2026-06-19:

- Extended the scripted rich TUI smoke to submit `/phase2 status` after the resume path and require the rendered frame to include `status=pending_manual_evidence` plus the C1 pending external-terminal row.
- Updated the smoke result contract so `saw=` now includes `phase2`; `ok=true` requires `welcome,mode,input,progress,answer,context,resume,phase2,exit`.
- TDD evidence: the `soloclaw smoke can exercise the rich TUI scripted flow` test was tightened first to require `phase2`; it failed while the smoke still reported `saw=welcome,mode,input,progress,answer,context,resume,exit`, then passed after the smoke script submitted `/phase2 status`.
- Verification: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "rich TUI scripted flow" }` exited 0 and reported 307 tests, 307 pass, 0 fail.
- Direct smoke: `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,phase2,exit`; `git diff --check` exited 0 with only existing LF-to-CRLF warnings; temp-file scan printed no paths.
- This strengthens automated rich-shell evidence, but it still does not satisfy C1 or C2 because it is an injected terminal with mock provider credentials.

Rich TUI manual closeout commands on 2026-06-19 12:29:58 +08:00:

- Added `/phase2 checklist` and `/phase2 evidence-template` to the rich TUI command palette and slash-command handler so the required manual closeout steps can be viewed without leaving the Soloclaw interface.
- The rich TUI checklist renders the same C1 external-terminal, C2 real-provider setup, and C3 automated gate instructions as `soloclaw phase2 checklist`.
- The rich TUI evidence template renders the same paste-safe notes as `soloclaw phase2 evidence-template` and repeats that API keys, key prefixes, bearer tokens, vault passphrases, and Authorization headers must never be recorded.
- TDD evidence: `rich TUI submit shows phase2 checklist and evidence template` was added first and failed because `/phase2 checklist` and `/phase2 evidence-template` were not in `TUI_COMMANDS`; after implementation it passed.
- Verification: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 checklist and evidence|phase2 closure status" }` exited 0 and reported 56 tests, 56 pass, 0 fail.
- CLI regression: `node --test dist\__tests__\security.test.js --test-name-pattern "phase2 status|phase2 evidence-template|phase2 checklist|rich TUI scripted flow"` exited 0 and reported 307 tests, 307 pass, 0 fail.
- Direct smoke: `node dist\cli\index.js phase2 checklist`, `node dist\cli\index.js phase2 evidence-template`, and `node dist\cli\index.js smoke --rich-tui` exited 0; the rich smoke reported `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,phase2,exit`.
- Hygiene: `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings; the temp-file scan printed no paths.
- This improves the in-product closeout workflow but still does not satisfy C1, C2, or C3 because no external terminal or real-provider evidence was recorded.

External terminal launcher helper on 2026-06-19 12:44:20 +08:00:

- Added `soloclaw phase2 launch-terminal [--workspace path] [--print]` as a C1 helper. Without `--print` on Windows it attempts to open a real PowerShell window in the target workspace and run `node dist\cli\index.js`; with `--print` it prints the exact safe command without launching a window.
- `soloclaw phase2 status` now lists `soloclaw phase2 launch-terminal` in `Next commands`, and `soloclaw phase2 checklist` includes both the launch command and the `--print` variant.
- TDD evidence: `agent phase2 launch-terminal prints safe external terminal instructions` was added first and failed because the subcommand was rejected by the old phase2 usage text; after implementation it passed.
- Verification: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase2 launch-terminal|phase2 status|phase2 checklist|phase2 evidence-template|rich TUI scripted flow" }` exited 0 and reported 308 tests, 308 pass, 0 fail.
- Direct smoke: `node dist\cli\index.js phase2 launch-terminal --print` exited 0 and printed a PowerShell command for `E:\code\agent`; `node dist\cli\index.js phase2 status` exited 0 and listed the launcher; `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,phase2,exit`.
- Hygiene: `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings; the temp-file scan printed no paths.
- This reduces friction for C1 but still does not satisfy C1, C2, or C3 because no human-observed external terminal run or real-provider task evidence was recorded.

Real-provider readiness helper on 2026-06-19 12:57:33 +08:00:

- Added `soloclaw phase2 readiness [--workspace path] [--json]` as a C2 preflight helper. It reads local model-provider metadata, encrypted-secret presence, and secret-shape hygiene without calling any provider, decrypting API keys for display, or printing secret values.
- The readiness statuses distinguish `missing_real_provider`, `missing_api_key_reference`, `missing_secret_storage`, `secret_leak_detected`, and `ready_for_manual_run`.
- `soloclaw phase2 status` now lists `soloclaw phase2 readiness` in `Next commands`, and `soloclaw phase2 checklist` tells the operator to run readiness before the manual real-provider task.
- TDD evidence: two `phase2 readiness` tests were added first and failed because the subcommand was rejected by the old phase2 usage text; after implementation they passed. The tests cover the current mock-only state and a temporary DeepSeek profile with an encrypted secret ref.
- Verification: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase2 readiness|phase2 launch-terminal|phase2 status|phase2 checklist|phase2 evidence-template|rich TUI scripted flow" }` exited 0 and reported 310 tests, 310 pass, 0 fail.
- Direct smoke: `node dist\cli\index.js phase2 readiness` exited 0 for `E:\code\agent` and reported `status=missing_real_provider`, `activeProvider=mock`, `realProviderConfigured=fail`, and `secretLeakScan=pass`; `node dist\cli\index.js phase2 readiness --json` reported the same state in JSON.
- Additional smoke: `node dist\cli\index.js phase2 status --json` listed `readiness=soloclaw phase2 readiness`; `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,phase2,exit`.
- Hygiene: `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings; the temp-file scan printed no paths.
- This improves C2 observability but still does not satisfy C2 because the current workspace is still on the mock provider and no real external-terminal provider task has been run.

Real-provider secret storage and hosted-shell smoke on 2026-06-19 13:06:24 +08:00:

- Stored the user-provided DeepSeek API key only in the local encrypted vault under `.agent`, configured the active provider as `deepseek`, model `deepseek-v4-flash`, and base URL `https://api.deepseek.com`.
- Confirmed `.agent/`, `.agent/model-providers.json`, `.agent/secrets.vault.json`, and `.agent/secrets.key` are ignored by git through `.gitignore:3`.
- `node dist\cli\index.js phase2 readiness --json` exited 0 and reported `status=ready_for_manual_run`, `activeProvider=deepseek`, `model=deepseek-v4-flash`, `baseUrl=https://api.deepseek.com`, `apiKeyReference=pass`, `secretStorage=pass`, and `secretLeakScan=pass`.
- `node dist\cli\index.js model check --json` exited 0 and reported `ready=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `usesApiKeySecretRef=true`, and no missing API key env names.
- Hosted-shell real-provider smoke: `node dist\cli\index.js ask "请只回答一句：soloclaw real provider smoke ok。不要调用工具，不要修改文件。"` exited 0 and returned `soloclaw real provider smoke ok`; session `sess_l5t3mrv1` was recorded.
- Hosted-shell C2 task rehearsal: `node dist\cli\index.js ask "请查看 package.json，告诉我 scripts 里有哪些 test/check 命令，不要修改文件。"` exited 0 and reported the `check` and `test` scripts; session `sess_3370dxrb` was recorded.
- Leak scan after storage and hosted-shell task runs: `rg -n --hidden "sk-[A-Za-z0-9_-]{12,}|Authorization:\s*Bearer|AGENT_SECRETS_PASSPHRASE=.+'?" .agent` exited 1 with no matches, meaning no plaintext key, bearer token, or passphrase-shaped value was found in `.agent`.
- Post-storage rich TUI smoke: `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true` and `provider=mock`, confirming the scripted smoke remains isolated from the real provider.
- This is strong C2 preflight evidence and proves the provider/API key work in the hosted shell, but it still does not fully satisfy C2 because C2 requires the same path to be observed inside a real external Soloclaw terminal session with dated manual evidence.

Rich TUI readiness command and shared readiness cleanup on 2026-06-19 13:19:08 +08:00:

- Added `/phase2 readiness` to the rich TUI command palette and slash-command handler so C2 readiness can be checked from inside the dedicated Soloclaw screen, not only from the cold CLI.
- Refactored `soloclaw phase2 readiness` and `/phase2 readiness` to share `buildPhaseTwoRealProviderReadiness` and `renderPhaseTwoRealProviderReadiness` from `src/cli/phase2-closure-status.ts`; this prevents CLI and TUI readiness output from drifting.
- Kept the user-provided DeepSeek key only in ignored local runtime state under `.agent`; do not record the key, key prefix, bearer token, vault passphrase, or Authorization header in this plan or in tracked files.
- Verification: `npm.cmd run build` exited 0.
- Verification: `node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 real-provider readiness|phase2 closure status|phase2 checklist"` exited 0 and reported 57 tests, 57 pass, 0 fail.
- Local secret-ignore check: `git check-ignore -v .agent .agent\model-providers.json .agent\secrets.vault.json .agent\secrets.key` confirmed all four paths are ignored by `.gitignore:3`.
- Local `.agent` leak check printed `secret_shape_matches=0` for plaintext API-key, bearer-token, and passphrase-env shapes.
- Direct readiness smoke: `node dist\cli\index.js phase2 readiness --json` exited 0 and reported `status=ready_for_manual_run`, `activeProvider=deepseek`, `model=deepseek-v4-flash`, `baseUrl=https://api.deepseek.com`, and `secretLeakScan=pass`.
- Direct model check: `node dist\cli\index.js model check --json` exited 0 and reported `ready=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `usesApiKeySecretRef=true`, and no missing API key env names.
- Security regression: `node --test dist\__tests__\security.test.js --test-name-pattern "phase2 readiness|phase2 launch-terminal|phase2 status|phase2 checklist|phase2 evidence-template|rich TUI scripted flow"` exited 0 and reported 310 tests, 310 pass, 0 fail.
- Rich smoke: `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true`, `provider=mock`, `model=mock`, and `saw=welcome,mode,input,progress,answer,context,resume,phase2,exit`.
- Hygiene: `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings; the temp-file scan printed no paths.
- This improves C2 visibility inside the product path, but it still does not satisfy C2 until a real external Soloclaw terminal run records dated evidence.

Real-provider rich TUI scripted smoke on 2026-06-19 13:39:09 +08:00:

- Added `soloclaw smoke --rich-tui-real-provider` as an injected rich-TUI smoke that uses the currently configured real provider instead of the mock task runner.
- The smoke submits `/phase2 readiness`, then a read-only natural-language task asking for package.json scripts whose names include `test` or `check`, and requires rich-TUI evidence for welcome, readiness, input, progress, answer, and cursor-restoring exit.
- The command fails closed when no real provider is configured and tells the operator to run `soloclaw phase2 readiness` and `/model setup`; it does not print API keys, bearer tokens, vault passphrases, or Authorization headers.
- `soloclaw phase2 checklist`, `soloclaw phase2 status`, `soloclaw phase2 evidence-template`, and CLI help now list `node dist\cli\index.js smoke --rich-tui-real-provider` as a C2/C3 preflight/regression command.
- TDD evidence: `soloclaw real-provider rich TUI smoke fails closed when no real provider is configured` was added first and failed because the old `smoke` command treated `--rich-tui-real-provider` as the normal mock smoke; after implementation it passed.
- TDD evidence: the phase2 checklist test was tightened to require `smoke --rich-tui-real-provider`; it failed against the old checklist, then passed after the checklist/status/help text was updated.
- Real-provider smoke evidence: `node dist\cli\index.js smoke --rich-tui-real-provider` exited 0 with `ok=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `readiness=ready_for_manual_run`, `saw=welcome,readiness,input,progress,answer,exit`, and session `sess_bri049ir`. The answer preview reported the `check` and `test` scripts from package.json without printing any secret values.
- Verification: `npm.cmd run check` exited 0.
- Verification: `node --test dist\__tests__\security.test.js --test-name-pattern "phase2 checklist prints|real-provider rich TUI smoke fails closed"` exited 0 and reported 311 tests, 311 pass, 0 fail.
- Regression smoke: `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true`, `provider=mock`, `model=mock`, and `saw=welcome,mode,input,progress,answer,context,resume,phase2,exit`.
- Local `.agent` leak check printed `secret_shape_matches=0` for plaintext API-key, bearer-token, and passphrase-env shapes.
- Hygiene: `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings; the temp-file scan printed no paths.
- This is stronger C2 preflight evidence than the hosted-shell `ask` run because it exercises the rich-TUI event/rendering path with the configured real provider, but it still does not satisfy C2 by itself because C2 requires a human-observed external Soloclaw terminal run.

Evidence safety checker on 2026-06-19 13:55:44 +08:00:

- Added `soloclaw phase2 evidence-check [--workspace path] [--file path] [--json]` to scan Phase 2 evidence notes before they are used for completion bookkeeping.
- The checker verifies that the evidence file is readable, that C1/C2/C3 evidence sections or closure placeholders are present, and that plaintext API-key, bearer-token, or passphrase-assignment shapes are not present.
- To avoid false positives from implementation examples and regex snippets inside the long plan, evidence-check ignores fenced Markdown code blocks and inline code while scanning for secret-looking text. It still scans normal evidence prose.
- The checker never echoes matched secret-looking text; it only reports `secretMatches=<count>` and fails closed on `secret_leak_detected`, missing files, or missing required sections.
- TDD evidence: `agent phase2 evidence-check accepts paste-safe evidence files` and `agent phase2 evidence-check rejects secret-looking evidence without echoing matches` were added first and failed because the subcommand did not exist; after implementation they passed.
- Verification: `node --test dist\__tests__\security.test.js --test-name-pattern "phase2 evidence-check|phase2 checklist|phase2 status|real-provider rich TUI smoke fails closed"` exited 0 and reported 313 tests, 313 pass, 0 fail.
- Direct evidence check: `node dist\cli\index.js phase2 evidence-check --json` exited 0 and reported `status=paste_safe_pending_manual_review`, `secretMatches=0`, and all five checks passing for this plan file.
- Verification: `npm.cmd run check` exited 0.
- Real-provider rich smoke: `node dist\cli\index.js smoke --rich-tui-real-provider` exited 0 with `ok=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `readiness=ready_for_manual_run`, `saw=welcome,readiness,input,progress,answer,exit`, and session `sess_ecmvrnv6`.
- Local `.agent` leak check printed `secret_shape_matches=0`.
- Hygiene: `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings; the temp-file scan printed no paths.
- This reduces the risk of unsafe C1/C2/C3 evidence notes, but it still does not satisfy C1, C2, or C3 by itself.

Rich TUI evidence-check command on 2026-06-19 14:23:20 +08:00:

- Added `/phase2 evidence-check` to the rich TUI command palette and slash-command handler so the evidence safety checker can be run from inside the Soloclaw interface.
- The command reuses the same `buildPhaseTwoEvidenceCheck` and `renderPhaseTwoEvidenceCheck` path as `soloclaw phase2 evidence-check`, so CLI and TUI evidence status stay aligned.
- The scripted rich TUI smoke now exercises `/phase2 evidence-check` after `/phase2 status` and requires `saw=welcome,mode,input,progress,answer,context,resume,phase2,evidence-check,exit`.
- The scripted smoke input helper now types with per-character yielding and clears the long Phase 2 status transcript before the evidence check, which keeps the injected terminal flow stable without changing product behavior.
- TDD evidence: `rich TUI submit shows phase2 evidence check` was added first and failed because `/phase2 evidence-check` was not registered in `TUI_COMMANDS`; after implementation it passed.
- TDD evidence: `soloclaw smoke can exercise the rich TUI scripted flow` was tightened to require the new `evidence-check` observation; it failed with the old `saw=...phase2,exit` output, then passed after the smoke flow was extended.
- Verification: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node dist\cli\index.js smoke --rich-tui }` exited 0 with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,phase2,evidence-check,exit`.
- Verification: `node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 evidence check"` exited 0 and reported 58 tests, 58 pass, 0 fail.
- Verification: `node --test dist\__tests__\security.test.js --test-name-pattern "rich TUI scripted flow"` exited 0 and reported 314 tests, 314 pass, 0 fail.
- Direct evidence check: `node dist\cli\index.js phase2 evidence-check --json` exited 0 with `status=paste_safe_pending_manual_review`, `secretMatches=0`, and all five checks passing for this plan file.
- Real-provider rich smoke: `node dist\cli\index.js smoke --rich-tui-real-provider` exited 0 with `ok=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `readiness=ready_for_manual_run`, `saw=welcome,readiness,input,progress,answer,exit`, and session `sess_cmshwcfe`.
- Verification: `npm.cmd run check` exited 0.
- Hygiene: `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings; the temp-file scan printed no paths.
- This improves the in-product C3 evidence workflow, but it still does not satisfy C1, C2, or C3 because external-terminal and real-provider manual evidence have not been recorded.

Strict evidence-check hardening on 2026-06-19 14:34:43 +08:00:

- Added rich TUI support for `/phase2 evidence-check --strict`; the command palette label now shows `/phase2 evidence-check [--strict]` while Space still inserts the safe base command.
- Fixed a strict-mode false positive: empty `Date:` placeholders could previously be treated as dated evidence because the date matcher crossed line boundaries.
- Strict mode now also checks the Phase 2 closure task checkboxes when they are present. If `- [ ] **C1`, `- [ ] **C2`, or `- [ ] **C3` remains unchecked, strict mode reports `c1ClosureTaskComplete`, `c2ClosureTaskComplete`, or `c3ClosureTaskComplete` as `fail`.
- TDD evidence: `rich TUI submit supports strict phase2 evidence check` was added first and failed because `/phase2 evidence-check --strict` was routed as a natural-language task; after implementation it passed.
- TDD evidence: the same rich TUI test was tightened to require the visible `[--strict]` command-palette label; it failed before the label change and passed after.
- Bug regression: `agent phase2 evidence-check strict mode rejects unchecked closure tasks` was added first and failed because strict mode had no closure-checkbox checks; after implementation it passed.
- Verification: `node --test dist\__tests__\security.test.js --test-name-pattern "unchecked closure tasks"` exited 0 and reported 315 tests, 315 pass, 0 fail.
- Verification: `node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 evidence check"` exited 0 and reported 59 tests, 59 pass, 0 fail.
- Verification: `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,phase2,evidence-check,exit`.
- Current-plan strict gate: `node dist\cli\index.js phase2 evidence-check --strict` exited 1 with `status=incomplete_closure_tasks`, `secretMatches=0`, dated-evidence checks passing, and `c1ClosureTaskComplete`, `c2ClosureTaskComplete`, and `c3ClosureTaskComplete` failing because the closure tasks are still unchecked. This is the expected state before manual C1/C2/C3 completion.
- Non-strict evidence scan: `node dist\cli\index.js phase2 evidence-check --json` exited 0 with `status=paste_safe_pending_manual_review` and `secretMatches=0`.
- Real-provider rich smoke: `node dist\cli\index.js smoke --rich-tui-real-provider` exited 0 with `ok=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `readiness=ready_for_manual_run`, `saw=welcome,readiness,input,progress,answer,exit`, and session `sess_ruyw7l38`.
- Verification: `npm.cmd run check` exited 0.
- Hygiene: `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings; the temp-file scan printed no paths.
- This makes the final C3 gate safer, but it still does not satisfy C1, C2, or C3 because the external-terminal and real-provider manual evidence still has to be recorded and the closure checkboxes still have to be intentionally checked.

Strict evidence-check status refinement on 2026-06-19 14:43:27 +08:00:

- Split strict-mode failure reasons so unchecked C1/C2/C3 closure tasks now report `status=incomplete_closure_tasks` instead of the older, less accurate `missing_dated_evidence`.
- Fixed evidence-section extraction to prefer the real `### C1/C2/C3 ... evidence` headings and only stop when a different C section begins. This prevents the closure task checkbox line from truncating the evidence section before its dated note.
- TDD evidence: `agent phase2 evidence-check strict mode rejects unchecked closure tasks` was first tightened to expect `status=incomplete_closure_tasks`; it failed while the implementation still returned `missing_dated_evidence`, then passed after the status split and section extraction fix.
- Verification: `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "unchecked closure tasks" }` exited 0 and reported 315 tests, 315 pass, 0 fail.
- Current-plan strict gate: `node dist\cli\index.js phase2 evidence-check --strict` exited 1 with `status=incomplete_closure_tasks`, `secretMatches=0`, dated-evidence checks passing, and C1/C2/C3 closure task checks failing. This is expected until the manual evidence tasks are completed and checked.
- Verification: `node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 evidence check"` exited 0 and reported 59 tests, 59 pass, 0 fail.
- Verification: `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,phase2,evidence-check,exit`.
- Non-strict evidence scan: `node dist\cli\index.js phase2 evidence-check --json` exited 0 with `status=paste_safe_pending_manual_review` and `secretMatches=0`.
- Real-provider rich smoke: `node dist\cli\index.js smoke --rich-tui-real-provider` exited 0 with `ok=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `readiness=ready_for_manual_run`, `saw=welcome,readiness,input,progress,answer,exit`, and session `sess_7s7nh9dp`.
- Verification: `npm.cmd run check` exited 0.
- Hygiene: `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings; the temp-file scan printed no paths.
- This improves the final gate's diagnostic accuracy, but it still does not satisfy C1, C2, or C3.

Phase 2 gate summary command on 2026-06-19 15:00:20 +08:00:

- Added `soloclaw phase2 gate [--workspace path] [--json]` and rich TUI `/phase2 gate` as the single closeout summary for real-provider readiness, strict evidence status, blockers, and next actions.
- The gate reports `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=incomplete_closure_tasks`, and blockers `C1,C2,C3` in the current workspace. This is expected because the real external-terminal evidence and closure checkboxes are still intentionally incomplete.
- Tightened the C3 next-action wording so it no longer suggests an impossible order. C3 now says to run the final automated gate, record dated C3 evidence, check the C3 closure task, then rerun strict evidence-check and `soloclaw phase2 gate`.
- TDD evidence: `agent phase2 gate summarizes blockers and next actions` and `rich TUI submit shows phase2 gate summary` cover the CLI and rich TUI gate surfaces, blocker list, strict evidence status, and paste-safe output.
- Verification: `npm.cmd run build` exited 0.
- Verification: `npm.cmd run check` exited 0.
- Verification: `node --test dist\__tests__\security.test.js --test-name-pattern "phase2 gate summarizes"` exited 0 and reported 316 tests, 316 pass, 0 fail.
- Verification: `node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 gate summary"` exited 0 and reported 60 tests, 60 pass, 0 fail.
- Verification: `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,phase2,evidence-check,exit`.
- Verification: `node dist\cli\index.js smoke --rich-tui-real-provider` exited 0 with `ok=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `readiness=ready_for_manual_run`, `saw=welcome,readiness,input,progress,answer,exit`, and session `sess_4urh85mm`.
- Gate snapshot: `node dist\cli\index.js phase2 gate --json` exited 1 with `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=incomplete_closure_tasks`, and blockers `C1,C2,C3`.
- Strict evidence snapshot: `node dist\cli\index.js phase2 evidence-check --strict` exited 1 with `status=incomplete_closure_tasks` and `secretMatches=0`, with only `c1ClosureTaskComplete`, `c2ClosureTaskComplete`, and `c3ClosureTaskComplete` failing.
- Non-strict evidence scan: `node dist\cli\index.js phase2 evidence-check --json` exited 0 with `status=paste_safe_pending_manual_review` and `secretMatches=0`.
- Hygiene: `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings; the temp-file scan printed no paths; the local `.agent` secret-shape scan printed no matches.
- This gives the user a single in-product closeout command, but it still does not satisfy C1, C2, or C3 because manual external-terminal evidence has not been recorded and the closure tasks remain unchecked.

Paste-safe evidence-record command on 2026-06-19 15:19:47 +08:00:

- Added `soloclaw phase2 evidence-record --section C1|C2|C3` with compatibility alias `record-evidence` to append paste-safe manual evidence bullets into this plan file.
- The command supports C1 fields such as terminal, shell, Node version, result, and rendering issues; C2 fields such as provider, model, base URL, `/model setup`, `/model check`, task result, live progress, and leak check; and C3 fields such as check/test/smoke/evidence-check/git-diff/temp-scan results.
- The command does not check C1/C2/C3 completion boxes and does not mark Phase 2 complete. It only records evidence text after scanning all supplied input fields and the rendered evidence block for API-key, bearer-token, and passphrase-assignment shapes.
- Safety regression found during implementation: the first pass scanned only rendered evidence lines, so a secret-looking value passed in an option not rendered for that section could be ignored instead of rejected. Fixed by scanning every supplied input field before rendering, and by recording C2's generic `--result` field instead of silently ignoring it.
- `soloclaw phase2 checklist`, `soloclaw phase2 gate`, usage text, and full help now mention `evidence-record` so the manual closeout path is discoverable.
- TDD evidence: `agent phase2 evidence-record appends paste-safe manual notes` and `agent phase2 evidence-record rejects secret-looking notes without echoing them` cover safe append, post-write evidence-check, refusal on secret-shaped input, no echo of rejected secret-looking text, and no write on rejection.
- Verification: `npm.cmd run build` exited 0.
- Verification: `npm.cmd run check` exited 0.
- Verification: `node --test dist\__tests__\security.test.js --test-name-pattern "phase2 evidence-record|phase2 checklist|phase2 gate summarizes|phase2 status"` exited 0 and reported 318 tests, 318 pass, 0 fail.
- Direct checks: `node dist\cli\index.js phase2 checklist --workspace E:\code\agent` printed the new evidence-record command; `node dist\cli\index.js phase2 evidence-check --workspace E:\code\agent --json` exited 0 with `status=paste_safe_pending_manual_review` and `secretMatches=0`; `node dist\cli\index.js phase2 gate --workspace E:\code\agent` still exited 1 with the expected blockers `C1,C2,C3`.
- This reduces C1/C2/C3 evidence-recording risk, but it still does not satisfy C1, C2, or C3 because the external-terminal and real-provider manual observations have not been performed and the closure tasks remain unchecked.

Rich TUI evidence-record command on 2026-06-19 15:29:08 +08:00:

- Added `/phase2 evidence-record` to the rich TUI command palette and slash-command handler so C1/C2/C3 evidence can be recorded from inside the dedicated Soloclaw interface during the real external-terminal closeout run.
- The rich TUI command supports quoted field values such as `/phase2 evidence-record --section C1 --terminal "Windows Terminal" --shell "PowerShell 7" --result "Rich TUI worked"` and routes through the same `recordPhaseTwoEvidence` safety path as the CLI command.
- Error handling keeps failures inside the transcript as system messages instead of crashing the rich shell, and the shared record path still refuses secret-shaped input.
- TDD evidence: `rich TUI submit records paste-safe phase2 evidence` was added first and failed because `/phase2 evidence-record` was not registered in `TUI_COMMANDS`; after implementation it passed and verified that the command wrote C1 evidence into a temporary plan with `secretMatches=0`.
- Verification: `npm.cmd run build` exited 0.
- Verification: `npm.cmd run check` exited 0.
- Verification: `node --test dist\__tests__\rich-tui.test.js --test-name-pattern "records paste-safe phase2 evidence"` exited 0 and reported 61 tests, 61 pass, 0 fail.
- Verification: `node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 evidence|phase2 checklist|phase2 gate summary"` exited 0 and reported 61 tests, 61 pass, 0 fail.
- Verification: `node --test dist\__tests__\security.test.js --test-name-pattern "phase2 evidence-record|phase2 checklist|phase2 gate summarizes|phase2 status"` exited 0 and reported 318 tests, 318 pass, 0 fail.
- Direct checks: `node dist\cli\index.js phase2 evidence-check --workspace E:\code\agent --json` exited 0 with `status=paste_safe_pending_manual_review` and `secretMatches=0`; `node dist\cli\index.js phase2 gate --workspace E:\code\agent --json` still exited 1 with `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=incomplete_closure_tasks`, and blockers `C1,C2,C3`.
- Hygiene: `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings; the temp-file scan printed no paths; the local `.agent` secret-shape scan printed no matches.
- This improves the real-terminal closeout workflow, but it still does not satisfy C1, C2, or C3 because the manual observations and closure checkboxes remain incomplete.

Phase 2 reviewed closure-task helper on 2026-06-19:

- Added `soloclaw phase2 closure-task --section C1|C2|C3 --confirm-reviewed` and rich TUI `/phase2 closure-task --section C1|C2|C3 --confirm-reviewed` so reviewed manual evidence can check exactly one closure checkbox without hand-editing the plan.
- The helper requires `--confirm-reviewed`, refuses to run if strict dated evidence for the requested section is missing, refuses secret-looking evidence text, and does not mark Phase 2 complete by itself.
- Updated `soloclaw phase2 closeout-guide` and rich TUI `/phase2 closeout-guide` to show the closure-task commands after the matching C1/C2/C3 evidence-record commands.
- TDD evidence: closeout-guide tests were tightened first and failed because the guide did not mention `phase2 closure-task --section C1 --confirm-reviewed`; after the guide text was updated, the focused closeout/closure-task tests passed.
- Verification: `npm.cmd run build` exited 0.
- Verification: `node --test dist\__tests__\security.test.js --test-name-pattern "closure-task|closeout-guide"` exited 0 and reported 321 tests, 321 pass, 0 fail.
- Verification: `node --test dist\__tests__\rich-tui.test.js --test-name-pattern "closure task|closeout guide"` exited 0 and reported 63 tests, 63 pass, 0 fail.
- Real-provider scripted smoke: `node dist\cli\index.js smoke --rich-tui-real-provider --workspace E:\code\agent` exited 0 with `ok=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `readiness=ready_for_manual_run`, `saw=welcome,readiness,input,progress,answer,exit`, and session `sess_yc49skmq`.
- Hygiene after the saved DeepSeek test key: `.agent` secret-shape scan printed `leak-files=none`; `git diff --check` exited 0 with only LF-to-CRLF conversion warnings; temp-file scan printed `temp-files=none`.
- Current expected state is still not complete: C1, C2, and C3 remain unchecked until the user has observed the real external terminal flow, recorded paste-safe evidence, and explicitly runs the closure-task command for each section.

Status polish and workspace cleanup on 2026-06-19:

- Cleaned two stale Node test processes from 2026-06-18 that were still running `security.test.js` after an interrupted focused test. No active Soloclaw terminal process was stopped.
- Fixed git dirty-path parsing in both `collectWorkspaceSnapshot()` and `LocalGitService.status()`. Root cause: the parser called `trim()` before slicing porcelain status columns, so a tracked modified path such as `src/tracked.ts` could render as `rc/tracked.ts`.
- Fixed `soloclaw status --json` readiness metadata so the real-provider smoke recommendation follows the configured default provider. With the current DeepSeek vault-backed profile, status now reports `configured default provider deepseek (deepseek-v4-flash) uses encrypted secret reference` and recommends `soloclaw smoke --rich-tui-real-provider` instead of a stale OpenAI env example.
- TDD evidence: `git dirty summaries preserve tracked modified file path prefixes` was added first and failed against the old parser; `soloclaw status readiness follows the configured default real provider` was added first and failed against the old env-only readiness logic. Both passed after implementation.
- Verification: `npm.cmd run check` exited 0.
- Verification: `npm.cmd test` exited 0 and reported 405 tests, 405 pass, 0 fail.
- Direct status check: `node dist\cli\index.js status --workspace E:\code\agent --json` showed `activeProvider=deepseek`, `defaultProvider=deepseek`, `model=deepseek-v4-flash`, `realProviderSmoke=soloclaw smoke --rich-tui-real-provider`, `hasBadRc=false`, and dirty paths beginning with `src/...`.
- Real-provider scripted smoke: `node dist\cli\index.js smoke --rich-tui-real-provider --workspace E:\code\agent` exited 0 with `ok=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `readiness=ready_for_manual_run`, `saw=welcome,readiness,input,progress,answer,exit`, and session `sess_nffgljs3`.
- Hygiene: `.agent` secret-shape scan printed `agent-secret-shape-files=none`; `git diff --check` exited 0 with only LF-to-CRLF conversion warnings; temp-file scan printed `temp-files=none`.
- Current expected state remains not complete: the code and automated evidence are healthier, but C1, C2, and C3 still require human-reviewed external-terminal evidence before the closure tasks are checked.

- [x] **C1: Record a real external terminal rich-TUI smoke**

Run from a real Windows Terminal or PowerShell window outside the Codex hosted shell:

```powershell
Set-Location E:\code\agent
node dist\cli\index.js
```

Optional launcher from the current shell:

```powershell
node dist\cli\index.js phase2 launch-terminal
```

To inspect the launch command without opening a window:

```powershell
node dist\cli\index.js phase2 launch-terminal --print
```

Manual checks to complete before marking C1 done:

- The Soloclaw rich screen opens by default in a TTY.
- Current workspace, current provider/model, mode, context/status rail, and prompt are visible.
- Typed Chinese text remains visible while the screen redraws.
- `F2` cycles `Plan -> Build -> Goal -> Plan`.
- `ctrl+p` opens the command palette; arrow keys move the selected row; Space inserts the selected command; Enter confirms/submits.
- Escape or Ctrl+C exits cleanly and restores the terminal cursor.
- Preferred one-sitting closeout after C1/C2/C3 observations are done: run `soloclaw phase2 closeout-wizard --all`; it records dated evidence, shows the redacted evidence back for review, and checks each closure task only after explicit confirmation.
- Section-only path: run `soloclaw phase2 closeout-wizard --section C1` after C1 if you want to record one section at a time.
- Fallback only if the wizard is not usable: record with `soloclaw phase2 evidence-record --section C1`, review with `soloclaw phase2 evidence-show --section C1`, then run `soloclaw phase2 closure-task --section C1 --confirm-reviewed`.

- C1 evidence:
  - Date: 2026-06-19
  - Terminal: Windows Terminal
  - Shell: PowerShell
  - Node version: v24.13.1
  - Result: External Soloclaw TUI rendered Workbench with MISSION/LEDGER/CHECKS, model/status/workspace visible; F2 cycled Build/Goal/Build; ctrl+p palette opened; arrow keys moved selection; Space selected a command; Enter submitted a selected command; Esc returned from palette/input state; Ctrl+C is the intended exit path per operator correction.
  - Secret notes: no API key, key prefix, bearer token, vault passphrase, or Authorization header recorded

- [x] **C2: Record one real-provider setup and natural-language run**

Run this preflight first:

```powershell
node dist\cli\index.js phase2 readiness
```

Run in the same real external terminal:

```text
/phase2 readiness
/model setup if readiness reports a problem; otherwise skip setup
/model check
请查看 package.json，告诉我 scripts 里有哪些 test/check 命令，不要修改文件。
```

Manual checks to complete before marking C2 done:

- `/model setup` uses the polished provider picker: provider first, model id second, API key last.
- `/phase2 readiness` renders inside the rich TUI transcript and does not print or reveal the API key.
- Provider rows show the base URL in the row, and the model picker uses arrows, Space, and Enter without text crowding.
- API key entry accepts pasted plaintext but never echoes the plaintext key after entry.
- `.agent/model-providers.json` contains provider metadata plus `apiKeySecretRef`, not a raw API key.
- `.agent/secrets.vault.json` is encrypted JSON and does not contain the plaintext API key.
- `.agent/secrets.key` exists when the local vault passphrase file path is used and does not contain the API key.
- The natural-language prompt produces visible live progress rows and a final assistant answer instead of silently exiting or stopping after the step limit.
- Preferred one-sitting closeout after C1/C2/C3 observations are done: run `soloclaw phase2 closeout-wizard --all`.
- Section-only path: run `soloclaw phase2 closeout-wizard --section C2` after C2 if you want to record one section at a time. Do not write the API key or any key prefix into the plan.
- Fallback only if the wizard is not usable: record with `soloclaw phase2 evidence-record --section C2`, review with `soloclaw phase2 evidence-show --section C2`, then run `soloclaw phase2 closure-task --section C2 --confirm-reviewed`.

Run this leak scan after the provider check:

```powershell
rg -n --hidden "sk-[A-Za-z0-9_-]{12,}|Authorization:\s*Bearer|AGENT_SECRETS_PASSPHRASE=.+" .agent
```

Expected: no plaintext API key and no bearer token. If a false positive appears in encrypted ciphertext, inspect only enough to confirm it is ciphertext and record that as the leak-check result without copying secret-looking text into this plan.

Optional automated C2 preflight after `/model check`:

```powershell
node dist\cli\index.js smoke --rich-tui-real-provider
```

Expected: `ok=true` with `saw=welcome,readiness,input,progress,answer,exit`. This is not a replacement for the required external-terminal C2 observation.

- C2 evidence:
  - Date: 2026-06-19
  - Provider: deepseek
  - Model: deepseek-v4-flash
  - Base URL: https://api.deepseek.com
  - /model check result: TUI /phase2 readiness showed ready_for_manual_run and /model check showed readiness pass
  - Result: Real-provider task completed in the Soloclaw rich TUI with live Ledger/Checks updates and DeepSeek model status visible.
  - Task result: External rich TUI read-only task inspected package.json and reported check=tsc -p tsconfig.json --noEmit and test=npm run build && node --test dist/__tests__/*.test.js; no files modified; session=sess_5smdf11n
  - Leak check: TUI readiness reported secretLeakScan pass; no plaintext API-key, bearer-token, or passphrase shapes found in .agent
  - Secret notes: no API key, key prefix, bearer token, vault passphrase, or Authorization header recorded

- [x] **C3: Re-run the full automated completion gate after C1 and C2**

Run:

```powershell
npm.cmd run check
npm.cmd test
node dist\cli\index.js smoke --rich-tui
node dist\cli\index.js smoke --rich-tui-real-provider
node dist\cli\index.js phase2 gate
node dist\cli\index.js phase2 evidence-check
git diff --check
Get-ChildItem -Force -Recurse -File | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.git\\' -and $_.Name -match '\.(tmp|bak|log|old|orig|rej|tsbuildinfo)$' } | Select-Object -ExpandProperty FullName
```

Expected:

- `npm.cmd run check` passes.
- `npm.cmd test` passes.
- Rich TUI smoke reports `ok=true` and includes `saw=welcome,mode,input,progress,answer,context,resume,phase2,evidence-check,exit`.
- Real-provider rich TUI smoke reports `ok=true` and includes `saw=welcome,readiness,input,progress,answer,exit`.
- Before C3 is checked, `phase2 gate` can still report `blocked_manual_evidence` with blocker `C3`; after the final gate passes, run `soloclaw phase2 closeout-wizard --all` if C1/C2/C3 are all ready to record, or `soloclaw phase2 closeout-wizard --section C3` if C1/C2 were already checked. Then rerun `node dist\cli\index.js phase2 evidence-check --strict` and `node dist\cli\index.js phase2 gate`.
- Evidence check reports `status=paste_safe_pending_manual_review` and `secretMatches=0`.
- `git diff --check` reports no whitespace errors, ignoring only the existing CRLF conversion warnings.
- The temporary-file scan prints no paths.
- The C3 wizard records a dated final gate snapshot under this section, shows the redacted evidence back for review, and checks C3 only after explicit confirmation.
- After C3 is checked, strict evidence-check should report `status=paste_safe_pending_manual_review` with `secretMatches=0`, and `phase2 gate` should report `status=ready_for_completion`.
- Fallback only if the wizard is not usable: record with `soloclaw phase2 evidence-record --section C3`, review with `soloclaw phase2 evidence-show --section C3`, then run `soloclaw phase2 closure-task --section C3 --confirm-reviewed`.

- C3 evidence:
  - Date: 2026-06-19
  - Result: Final automated gate passed: npm.cmd run check exit 0; npm.cmd test passed 434/434; rich TUI smoke ok=true; real-provider rich TUI smoke ok=true with DeepSeek session sess_zt7qexj6; git diff --check exit 0 with only LF/CRLF warnings; temp-file scan pass.
  - Secret notes: no API key, key prefix, bearer token, vault passphrase, or Authorization header recorded

- [x] **C4: Mark Phase 2 complete only after evidence is present**

Current evidence confirms this section has dated C1, C2, and C3 evidence plus reviewed closure tasks. U1, U6, and U-FINAL are checked above.

#### Must-Finish Work Snapshot (2026-06-21)

This is the required finish list for the legacy Phase 2 closeout. Treat these items as blocking for Phase 2 completion even though the later automated Phase 3/3B and Phase 4A gates are healthy.

- [x] **MF1: External terminal rich-TUI evidence**

  Required because the Codex hosted shell cannot prove real Windows Terminal rendering, cursor restore, or human key handling.

  Run:

  ```powershell
  Set-Location E:\code\agent
  node dist\cli\index.js
  ```

  Optional helper:

  ```powershell
  node dist\cli\index.js phase2 launch-terminal
  ```

  Record a dated evidence bullet in C1 with terminal app, shell, Node version, observed model/status rail, `F2` mode cycling result, `ctrl+p` palette result, arrow/Space/Enter behavior, and Escape/Ctrl+C cursor-restore result.

- [x] **MF2: Real provider setup and first natural-language task**

  Required because automated real-provider gates do not prove the intended human terminal path: `soloclaw -> /phase2 readiness -> /model check -> optional /model setup -> natural-language task`.

  Run inside the rich TUI:

  ```text
  /phase2 readiness
  /model setup
  /model check
  请查看 package.json，告诉我 scripts 里有哪些 test/check 命令，不要修改文件。
  ```

  Record a dated evidence bullet in C2 with provider name, model id, base URL, `/model check` result, task result, and leak-scan result. Do not record the API key, key prefix, bearer token, vault passphrase, or Authorization header.

  Leak scan:

  ```powershell
  rg -n --hidden "sk-[A-Za-z0-9_-]{12,}|Authorization:\s*Bearer|AGENT_SECRETS_PASSPHRASE=.+" .agent
  ```

- [x] **MF3: Fix any regression found by MF1 or MF2 before final gate**

  No new MF1/MF2 regression remains open in the final Phase 2 gate evidence. Earlier regressions were fixed in the dated implementation notes above.

- [x] **MF4: Final automated completion gate after MF1 and MF2**

  Run only after the manual terminal and real-provider terminal evidence exists:

  ```powershell
  npm.cmd run check
  npm.cmd test
  node dist\cli\index.js smoke --rich-tui
  node dist\cli\index.js smoke --rich-tui-real-provider
  node dist\cli\index.js phase2 evidence-check
  git diff --check
  Get-ChildItem -Force -Recurse -File | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.git\\' -and $_.Name -match '\.(tmp|bak|log|old|orig|rej|tsbuildinfo)$' } | Select-Object -ExpandProperty FullName
  ```

  Record a dated evidence bullet in C3 with pass/fail status, test count, mock rich-smoke `saw=` values, real-provider rich-smoke `saw=` values, evidence-check result, whitespace-check result, and temp-file scan result.

- [x] **MF5: Completion bookkeeping**

  MF1, MF2, MF4, U1, U6, U-FINAL, C1, C2, C3, and C4 are checked. The working tree remains uncommitted unless the user explicitly asks for staging or a commit.

### Event Stream Remaining Work

**Task E1: Add replayable assistant-part projection**

**Files:**
- Modify: `src/core/agent-events.ts`
- Create: `src/core/agent-message-projector.ts`
- Modify: `src/cli/tui/state.ts`
- Modify: `src/cli/tui/rich-shell.ts`
- Modify: `src/cli/tui/event-renderer.ts`
- Test: `src/__tests__/agent-events.test.ts`
- Test: `src/__tests__/rich-tui.test.ts`

- [x] **Step 1: Write the failing projection test**

Add a test that feeds a `step_started`, `assistant_text`, `tool_started`, `tool_finished`, and `model_finished` sequence into a projector and expects one assistant turn containing text plus folded tool parts. The assertion must prove raw command strings, raw tool input JSON, raw patch bodies, and secret-looking values are absent from the projected message.

- [x] **Step 2: Run the focused test and verify red**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js --test-name-pattern "projects agent events" }
```

Expected: failure because `agent-message-projector.ts` does not exist or the projection API is missing.

- [x] **Step 3: Implement the projector**

Create a pure projector that converts safe `AgentRunEvent` sequences into UI-ready assistant parts: `text`, `tool`, `status`, and `error`. The projector must only use already-redacted event fields such as `title`, `paths`, `status`, `durationMs`, and `detailsHidden`.

- [x] **Step 4: Verify green**

Run the same focused command and confirm the projection test passes.

Completed on 2026-06-19:

- Added `projectAgentRunEventsToAssistantMessages()` in `src/core/agent-message-projector.ts`.
- Added replay-safe assistant parts: `text`, `tool`, `status`, and `error`.
- Rich TUI now keeps `agentRunEvents` as the replay source and `projectedAssistantMessages` as the shared projection while preserving the existing `events` activity lane.
- Added `renderProjectedAssistantPartRow()` so future TUI/Web consumers can render projected parts without returning to raw events.
- Verified red first with missing `agent-message-projector.ts`.
- Verified green with:
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js --test-name-pattern "projects agent events" }`
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js }`
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js }`
  - `node dist\cli\index.js smoke --rich-tui` -> `ok=true`, `saw=welcome,mode,input,progress,answer,context,resume,exit`
  - `git diff --check` -> exit 0 with only existing CRLF warnings.

**Acceptance:** timeline, TUI, and future web/desktop clients can consume the same replayable assistant-part shape instead of rebuilding partial UI state independently.

**Task E2: Add public reasoning lifecycle events**

**Files:**
- Modify: `src/model/model-client.ts`
- Modify: `src/core/agent-events.ts`
- Modify: `src/core/agent-loop.ts`
- Modify: `src/cli/tui/event-renderer.ts`
- Test: `src/__tests__/agent-events.test.ts`
- Test: `src/__tests__/rich-tui.test.ts`

- [x] **Step 1: Write failing tests for reasoning summaries**

Add tests for `reasoning_started`, `reasoning_delta`, and `reasoning_finished` events. The expected TUI row should be a public summary such as `Thinking 499ms`, never raw chain-of-thought text.

- [x] **Step 2: Verify red**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js dist\__tests__\rich-tui.test.js --test-name-pattern "reasoning|Thinking" }
```

Expected: failure because public reasoning lifecycle events are not implemented.

- [x] **Step 3: Implement lifecycle events and renderer rows**

Map model `reasoning_delta` stream parts into safe public lifecycle events. Keep raw reasoning text out of persisted audit, timeline, and default TUI output. Store only timing, step, and a redacted public summary.

- [x] **Step 4: Verify green**

Run the same focused command and confirm the reasoning lifecycle tests pass.

Completed on 2026-06-19:

- Added safe `reasoning_started`, `reasoning_delta`, and `reasoning_finished` agent events.
- Changed streaming `reasoning_delta` handling so raw model reasoning text is not emitted as `assistant_note`.
- Persisted only safe public reasoning metadata: step, public summary, delta count, elapsed time, and duration.
- Updated rich TUI activity state, event rows, and assistant-part projection to show public `Thinking` progress without raw reasoning content.
- Verified red first with missing reasoning event types.
- Verified green with:
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js dist\__tests__\rich-tui.test.js --test-name-pattern "reasoning|Thinking" }`
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js }`
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js }`
  - `node dist\cli\index.js smoke --rich-tui` -> `ok=true`, `saw=welcome,mode,input,progress,answer,context,resume,exit`
  - `git diff --check` -> exit 0 with only existing CRLF warnings.

**Acceptance:** Soloclaw shows observable thinking state without exposing hidden reasoning content.

**Task E3: Complete Anthropic tool-call streaming**

**Files:**
- Modify: `src/model/http-model-clients.ts`
- Test: `src/__tests__/agent-events.test.ts` or provider-focused test file already covering model clients

- [x] **Step 1: Write failing Anthropic tool streaming test**

Add an SSE fixture with `content_block_start` for `tool_use`, streamed `input_json_delta` fragments, `content_block_stop`, and `message_stop`. Expect `streamComplete()` to yield a final `tool_calls` response with the parsed tool call and usage metadata.

- [x] **Step 2: Verify red**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js --test-name-pattern "Anthropic.*tool" }
```

Expected: failure because Anthropic tool-call streaming currently intentionally falls back to non-streaming for tool requests.

- [x] **Step 3: Implement Anthropic streamed tool-call assembly**

Parse streamed tool-use blocks by index/id, concatenate JSON deltas, parse tool input at block end, preserve text deltas, and emit a final `tool_calls` response with `toolCalls`.

- [x] **Step 4: Verify green and fallback safety**

Run the focused test and then `npm.cmd test`.

Completed on 2026-06-19:

- Removed the Anthropic-compatible streaming fallback that called non-streaming `complete()` whenever tools were present.
- Added parser support for `content_block_start`, `content_block_delta` with `input_json_delta`, and `content_block_stop` chunks.
- Streamed text deltas are preserved, streamed tool input JSON is assembled by content block index, and the final response is `tool_calls` with usage metadata.
- Verified red first: the new SSE test failed because the fallback tried to parse the event stream as JSON.
- Verified green with:
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js --test-name-pattern "anthropic compatible client streams tool" }`
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js }`
  - `node dist\cli\index.js smoke --rich-tui` -> `ok=true`, `saw=welcome,mode,input,progress,answer,context,resume,exit`
  - `git diff --check` -> exit 0 with only existing CRLF warnings.

**Acceptance:** Anthropic-compatible providers can stream both text and tool calls through the same event lane as OpenAI-compatible providers.

**Task E4: Add explicit safe-detail expansion model**

**Files:**
- Modify: `src/core/agent-events.ts`
- Modify: `src/core/agent-event-redaction.ts`
- Modify: `src/sessions/session-timeline-view.ts`
- Modify: `src/cli/tui/rich-shell.ts`
- Modify: `src/cli/tui/event-renderer.ts`
- Test: `src/__tests__/agent-events.test.ts`
- Test: `src/__tests__/rich-tui.test.ts`

- [x] **Step 1: Write failing tests for safe expanded details**

Add tests proving the collapsed row hides details by default and an expanded projection can show safe metadata such as file paths, exit code, duration, and output byte count while still hiding command bodies, raw output, raw patch bodies, and secrets.

- [x] **Step 2: Verify red**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js dist\__tests__\rich-tui.test.js --test-name-pattern "expanded details|details hidden" }
```

Expected: failure because there is no explicit expansion state or safe expanded-detail projection.

- [x] **Step 3: Implement safe expansion state**

Add a per-event expansion flag to rich TUI state and render only whitelisted metadata. Do not render raw shell commands, raw stdout/stderr, raw patch hunks, raw JSON tool input, API keys, vault passphrases, or Authorization headers.

- [x] **Step 4: Verify green**

Run the focused tests and confirm expanded detail output remains redacted.

Completed on 2026-06-19:

- Extended `ToolDisplay`, `tool_started`, `tool_finished`, and projected assistant tool parts with safe detail metadata.
- Added `stdoutBytes` and `stderrBytes` to workspace command/tool metadata so expanded views can show useful size information without exposing raw output.
- Kept default rendering collapsed while allowing explicit expanded rendering to show only the whitelist: paths, exit code, timeout, duration, stdout bytes, stderr bytes.
- Confirmed raw command text, raw stdout/stderr, raw patch text, and API-key-like values stay absent from projected content.
- Verified red first with missing `safeDetails` / expanded renderer support.
- Verified green with:
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js dist\__tests__\rich-tui.test.js --test-name-pattern "expanded|safe tool details|safe projected tool details" }`
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js }`
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js }`
  - `node dist\cli\index.js smoke --rich-tui` -> `ok=true`, `saw=welcome,mode,input,progress,answer,context,resume,exit`
  - `git diff --check` -> exit 0 with only existing CRLF warnings.

**Acceptance:** users can inspect what happened at a higher fidelity without compromising the default safety posture.

**Task E5: Build a minimal event subscriber view for web/desktop reuse**

**Files:**
- Modify: `src/web/local-room-web-server.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing web event-view test**

Add a test that starts the local web server and verifies the browser dashboard exposes a visible, token-backed agent event subscriber lane. The existing SSE endpoint test continues to verify token protection and redacted event data.

- [x] **Step 2: Verify red**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "api/events" }
```

Expected: failure for the missing event-view behavior if the current endpoint cannot satisfy replay or display requirements.

- [x] **Step 3: Add a minimal operator event lane**

Expose a tiny web/operator panel backed by the token-protected event stream. Keep it read-only and project only safe event fields.

- [x] **Step 4: Verify green**

Run the focused web test and `npm.cmd test`.

Completed on 2026-06-19:

- Added a right-rail `Agent Event Stream` section to the local web dashboard.
- Added `connectAgentEventStream()` using `EventSource('/api/events?token=' + encodeURIComponent(controlToken))`.
- Added a browser-side `projectAgentEventForWeb()` projection that renders only safe fields: event type, title, tool status, step, session id, paths, duration, exit code, and public reasoning summary.
- The lane is read-only, bounded to the latest 12 events, and defaults to `No agent events yet`.
- Verified red first with missing dashboard event subscriber assertions.
- Verified green with:
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "web dashboard html" }`
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js }`
  - `node dist\cli\index.js smoke --rich-tui` -> `ok=true`, `saw=welcome,mode,input,progress,answer,context,resume,exit`
  - `git diff --check` -> exit 0 with only existing CRLF warnings.

**Acceptance:** the event stream is not only a backend endpoint; it has a small visible consumer path for future desktop/web UI.

### Soloclaw TUI Remaining Work

**Task U1: Run and record real external terminal smoke**

**Files:**
- Modify: `docs/superpowers/plans/2026-06-18-soloclaw-rich-tui-event-stream.md`

- [x] **Step 1: Open a real terminal outside the Codex hosted shell**

Run from `E:\code\agent`:

```powershell
node dist\cli\index.js
```

- [x] **Step 2: Exercise the rich UI manually**

Verify: welcome screen appears, cursor is visible in the prompt, `F2` cycles `Plan -> Build -> Goal`, `ctrl+p` opens commands, arrows move the cursor, Space inserts a command, Enter executes a command, Esc exits and restores the cursor.

- [x] **Step 3: Exercise model setup manually**

Run `/model setup`, select DeepSeek or another real provider, choose a model id, paste an API key, return to the conversation screen, and run `/model check`. Confirm no API key text appears in the screen or config files.

- [x] **Step 4: Exercise natural-language task and resume**

Submit a small task such as `在README里添加一行测试说明`, watch progress rows appear, then use `/resume` if the run stops with a session id.

- [x] **Step 5: Record result in this plan**

Add a dated verification snapshot with terminal, shell, provider, model, commands exercised, and any rendering issues.

**Acceptance:** the full objective can only be called complete after this real terminal run is recorded.

**Task U2: Polish the task-cockpit layout**

**Files:**
- Modify: `src/cli/tui/layout.ts`
- Modify: `src/cli/tui/state.ts`
- Test: `src/__tests__/rich-tui.test.ts`

- [x] **Step 1: Write failing layout tests**

Add tests for a 140x32 conversation frame asserting three stable zones: left transcript, right status rail, and bottom mode/input bar. Assert no row exceeds terminal width and CJK prompts do not overlap the rail.

- [x] **Step 2: Verify red**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "cockpit|CJK|right status rail" }
```

Expected: failure for missing cockpit-specific assertions or layout refinements.

- [x] **Step 3: Refine layout rendering**

Keep Soloclaw brand visible, move objective/run health/context/model/workspace into a predictable right-rail order, keep the input box stable at the bottom, and reduce noisy labels in the transcript.

- [x] **Step 4: Verify green**

Run the focused tests and `node dist\cli\index.js smoke --rich-tui`.

Completed on 2026-06-19:

- Added cockpit layout coverage for a 140-column conversation frame with CJK input and projected assistant parts.
- The conversation main lane now renders a bounded `Task Stream` from replayable assistant-part projection before the folded raw event lane.
- The right rail remains stable for run health, mode, activity, context, model, LSP, workspace, and resume guidance.
- Verified row width stays within the terminal width while rendering CJK prompts and projected tool rows.
- Verified red first because projected assistant parts were not rendered in the main lane.
- Verified green with:
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "cockpit renders projected" }`
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js }`
  - `node dist\cli\index.js smoke --rich-tui` -> `ok=true`, `saw=welcome,mode,input,progress,answer,context,resume,exit`
  - `git diff --check` -> exit 0 with only existing CRLF warnings.

**Acceptance:** the normal conversation screen reads as a dedicated Soloclaw task cockpit rather than a raw log view.

**Task U3: Improve input editing and transcript navigation**

**Files:**
- Modify: `src/cli/tui/rich-shell.ts`
- Modify: `src/cli/tui/state.ts`
- Test: `src/__tests__/rich-tui.test.ts`

- [x] **Step 1: Write failing key-handling tests**

Add tests for multiline input, command history Up/Down when the command palette is closed, transcript scroll focus, and preserving typed text while progress events redraw.

- [x] **Step 2: Verify red**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "multiline|history|scroll|preserve typed" }
```

Expected: failure because the current input model is intentionally basic.

- [x] **Step 3: Implement input state improvements**

Add history storage, multiline buffer rendering, scroll offset state, and redraw-safe input preservation. Keep command palette key behavior unchanged.

- [x] **Step 4: Verify green**

Run the focused tests and the scripted rich smoke.

Partial progress on 2026-06-19:

- Added input history state: `inputHistory`, `inputHistoryIndex`, and `inputHistoryDraft`.
- Up/Down now recall previous prompts when the command palette is closed and restore the current draft after moving past the newest history entry.
- Typing or backspace exits history browsing so the user can edit normally.
- Verified red first because Up/Down returned `none` and did not recall history.
- Verified green with:
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "input history" }`
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js }`
  - `node dist\cli\index.js smoke --rich-tui` -> `ok=true`, `saw=welcome,mode,input,progress,answer,context,resume,exit`
  - `git diff --check` -> exit 0 with only existing CRLF warnings.
- Still remaining for full U3: multiline input rendering, transcript scroll focus, and explicit typed-text preservation tests during progress redraw.

Completed on 2026-06-19:

- Added `RichTuiKey.shift` and Shift+Enter multiline input handling.
- Added `transcriptScrollOffset` to `RichTuiState`; transcript focus Up/Down now scrolls transcript history without changing the input draft or command history.
- `renderPromptBox()` now renders up to three prompt rows from multiline input instead of leaking embedded newlines through one clipped string.
- `renderConversationMain()` selects visible transcript messages from `transcriptScrollOffset`, so scrolling changes the rendered transcript window.
- Busy long-running task redraws no longer discard typed draft text; normal characters, backspace, and multiline editing remain available while Enter is suppressed until the active run finishes.
- Verified red first for transcript window rendering and busy redraw draft preservation.
- Verified green with:
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "preserves typed draft|multiline|transcript scroll|input history" }`
  - `node --test dist\__tests__\rich-tui.test.js`
  - `node dist\cli\index.js smoke --rich-tui` -> `ok=true`, `saw=welcome,mode,input,progress,answer,context,resume,exit`.

**Acceptance:** users can write longer prompts and inspect prior transcript content without losing typed input during long-running progress.

**Task U4: Complete Plan -> Build approval workflow**

**Files:**
- Modify: `src/core/agent-loop.ts`
- Modify: `src/cli/tui/rich-shell.ts`
- Modify: `src/cli/tui/layout.ts`
- Test: `src/__tests__/rich-tui.test.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing workflow tests**

Add a test where Plan mode produces a plan and the UI shows `Plan needs approval`; a follow-up approval command switches to Build and runs the task with tools enabled.

- [x] **Step 2: Verify red**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js dist\__tests__\security.test.js --test-name-pattern "Plan needs approval|approve plan" }
```

Expected: failure because the approval transition is not yet modeled as a first-class rich TUI workflow.

- [x] **Step 3: Implement approval command and state**

Add a compact command such as `/approve plan` that records the approved plan text/session id and re-runs or continues in Build mode. Writes remain blocked in Plan mode before approval.

- [x] **Step 4: Verify green**

Run focused tests and `npm.cmd test`.

Completed on 2026-06-19:

- Added `pendingPlanApproval` to `RichTuiState` with the original task, generated plan text, and plan session id.
- Added `/approve plan` to the command palette.
- Plan-mode natural-language submission now keeps the generated plan visible, sets `runHealth` to `Needs approval`, and surfaces `Plan needs approval: /approve plan` in status output.
- `/approve plan` clears the pending approval, switches the rich TUI to Build mode, and executes the original task through the same event stream without re-asking the user to paste the task.
- Command-palette tests now target commands by command id instead of relying on fixed row offsets.
- Verified red first with missing `pendingPlanApproval` state.
- Verified green with:
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "command palette|selected command|plan mode requires approval|approve plan" }`
  - `node --test dist\__tests__\rich-tui.test.js`
  - `node dist\cli\index.js smoke --rich-tui` -> `ok=true`, `saw=welcome,mode,input,progress,answer,context,resume,exit`.

**Acceptance:** Plan mode becomes a real guided workflow, not only a mode label plus conservative tool policy.

**Task U5: Make Goal mode resumable beyond manual `/resume`**

**Files:**
- Modify: `src/cli/tui/rich-shell.ts`
- Modify: `src/core/agent-loop.ts`
- Test: `src/__tests__/rich-tui.test.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing Goal continuation test**

Add a test where Goal mode reaches the step budget, shows `Stopped` with `Next: /resume`, and offers a visible continue action. A second command should continue the same session and update the same objective.

- [x] **Step 2: Verify red**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js dist\__tests__\security.test.js --test-name-pattern "Goal.*resume|Next: /resume" }
```

Expected: failure for any missing Goal-specific continuation behavior.

- [x] **Step 3: Implement Goal continuation affordance**

Keep manual `/resume`, and add a visible prompt or command-palette item that targets the active Goal session. Do not auto-run indefinitely without an explicit user action.

- [x] **Step 4: Verify green**

Run focused tests and scripted rich smoke.

Completed on 2026-06-19:

- Added `/continue` to the rich TUI command palette as the visible continuation action for stopped Goal sessions.
- Updated resume guidance from only `/resume` to `/continue or /resume` in the right rail and `/status` output.
- `/continue` reuses the active session id and the existing resume event stream; `/resume` and `/resume <session-id>` remain supported.
- Verified red first because `/continue` was not rendered and did not call `resumeSession`.
- Verified green with:
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "continue|stopped runs show resume|submit resumes" }`
  - `node --test dist\__tests__\rich-tui.test.js`
  - `node dist\cli\index.js smoke --rich-tui` -> `ok=true`, `saw=welcome,mode,input,progress,answer,context,resume,exit`.

**Acceptance:** long goals feel durable and easy to continue while preserving operator control.

**Task U6: Real-provider model setup hardening**

**Files:**
- Modify: `src/cli/tui/model-setup.ts`
- Modify: `src/model/provider-profiles.ts`
- Test: `src/__tests__/rich-tui.test.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Write failing provider setup tests**

Add tests for DeepSeek, Qwen, Kimi, GLM, Gemini, OpenAI-compatible custom, and Anthropic-compatible custom paths. Each test must assert provider base URL visibility, model id selection, masked key input, encrypted secret storage, and no plaintext key in stdout/stderr/config/vault key files.

- [x] **Step 2: Verify red for any missing provider path**

Run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js dist\__tests__\security.test.js --test-name-pattern "model setup|provider" }
```

Expected: failure for providers or custom-compatible paths that are not fully covered.

- [x] **Step 3: Complete provider presets and menu polish**

Ensure each known provider has a direct API base URL, default model list, docs/API-key/pricing links when known, and a compact picker row that does not wrap messily.

- [x] **Step 4: Verify green and run one real-provider manual check**

Run focused tests, scripted rich smoke, then manually test one real provider with a real key in an external terminal.

Automated hardening progress on 2026-06-19:

- Rich model setup wizard covers known provider presets with bounded rows: OpenAI, Anthropic, Gemini, Kimi, DeepSeek, GLM, Qwen, MiniMax, custom OpenAI-compatible, and custom Anthropic-compatible.
- Rich wizard supports custom Anthropic-compatible base URL entry and preserves the `anthropic_messages` protocol.
- Plain/stdin `/model setup` menu now prompts for a custom base URL for both `openai_compatible` and `anthropic_compatible` instead of silently using `http://localhost:8000/v1`.
- Plain/stdin and TUI model setup paths store pasted API keys as encrypted local secret refs and keep plaintext keys out of stdout, stderr, `model-providers.json`, `secrets.vault.json`, and `secrets.key`.
- Verified red first because plain/stdin custom Anthropic-compatible setup did not prompt for Base URL and mis-parsed the next input as a model choice.
- Verified green with:
  - `npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "Anthropic-compatible base URL" }`
  - `node --test dist\__tests__\rich-tui.test.js --test-name-pattern "model setup wizard|model setup menu|api key|custom Anthropic|provider presets"`
  - `node dist\cli\index.js smoke --rich-tui` -> `ok=true`, `saw=welcome,mode,input,progress,answer,context,resume,exit`
  - `git diff --check` -> exit 0 with only existing CRLF conversion warnings.
- Still required for full U6 acceptance: a real-provider manual check in an external terminal with a real API key, recorded without leaking the key.

**Acceptance:** the setup flow is reliable enough for the desired `soloclaw -> configure model -> natural-language task` path.

### Phase 2 completion gate

Do not mark this phase complete until all of the following are true:

- `npm.cmd run check` passes.
- `npm.cmd test` passes.
- `node dist\cli\index.js smoke --rich-tui` reports `saw=welcome,mode,input,progress,answer,context,resume,exit`.
- `git diff --check` exits 0, ignoring only existing CRLF conversion warnings.
- Temporary-file scan finds no `.tmp`, `.bak`, `.log`, `.old`, `.orig`, `.rej`, or `.tsbuildinfo` files in the workspace.
- A real external terminal smoke snapshot is recorded in this plan.
- A real model-provider setup and natural-language task run are recorded without leaking API keys.

## File Structure

### New Files

- `src/core/agent-events.ts`
  Owns the public event protocol used by `AgentLoop`, TUI, tests, and the SSE/WebSocket subscription surfaces.

- `src/core/agent-event-redaction.ts`
  Redacts API keys, secrets, command output snippets, and tool inputs before display or event persistence.

- `src/cli/tui/ansi.ts`
  Tiny ANSI helper layer: clear screen, cursor movement, color, width clipping, border drawing.

- `src/cli/tui/layout.ts`
  Pure layout functions for the Soloclaw welcome screen, conversation screen, status rail, mode/status bar, chat transcript, event list, and input box.

- `src/cli/tui/rich-shell.ts`
  Interactive TTY shell that owns redraw, key handling, command dispatch, and agent event rendering.

- `src/cli/tui/event-renderer.ts`
  Converts safe agent events into folded, human-readable rows.

- `src/cli/tui/state.ts`
  Small state model for transcript messages, active run, current model, workspace, context metrics, mode, focus, pending input, and selected command palette item.

- `src/cli/tui/commands.ts`
  Registry for slash commands and command palette entries.

- `src/__tests__/rich-tui.test.ts`
  Pure renderer tests for the welcome screen, status display, folding, redaction, and terminal-size fallbacks.

- `src/__tests__/agent-events.test.ts`
  Unit tests for event redaction, tool display metadata, command/file summaries, and persistence-safe shapes.

### Modified Files

- `src/protocol/types.ts`
  Extend `ToolResult` with optional safe display metadata.

- `src/core/agent-loop.ts`
  Replace ad-hoc progress events with the richer protocol from `agent-events.ts`.

- `src/platform/local-platform.ts`
  Continue to pass progress callbacks and add optional event persistence settings.

- `src/tools/workspace-tools.ts`
  Populate tool display metadata for file reads, searches, commands, patches, file creation, and range replacement.

- `src/cli/index.ts`
  Use rich TUI when `stdin.isTTY && stdout.isTTY`; keep existing line-mode path for non-TTY.

- `src/__tests__/security.test.ts`
  Adjust existing TUI tests to assert fallback mode still works and that progress events do not leak secrets.

---

## Task 1: Define The Safe Event Protocol

**Files:**
- Create: `src/core/agent-events.ts`
- Create: `src/core/agent-event-redaction.ts`
- Modify: `src/protocol/types.ts`
- Test: `src/__tests__/agent-events.test.ts`

- [x] **Step 1: Write failing protocol tests**

Add `src/__tests__/agent-events.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { redactAgentEventText, summarizeToolInput } from "../core/agent-event-redaction.js";
import type { AgentRunEvent } from "../core/agent-events.js";

test("agent event redaction removes api keys from display text", () => {
  const value = redactAgentEventText("use sk-testsecretvalue1234567890 in command");
  assert.equal(value.includes("sk-testsecretvalue1234567890"), false);
  assert.match(value, /\[REDACTED:api_key\]/);
});

test("tool input summary hides command details by default", () => {
  const summary = summarizeToolInput("run_command", {
    command: "powershell -Command $env:SECRET='sk-testsecretvalue1234567890'; npm test",
    timeoutMs: 1000,
  });
  assert.equal(summary.title, "Run command");
  assert.equal(summary.detailsHidden, true);
  assert.equal(JSON.stringify(summary).includes("sk-testsecretvalue1234567890"), false);
});

test("agent run event type supports folded tool rows", () => {
  const event: AgentRunEvent = {
    type: "tool_finished",
    runId: "run_test",
    sessionId: "sess_test",
    step: 1,
    callId: "call_test",
    toolName: "run_command",
    title: "Run command",
    status: "ok",
    durationMs: 12,
    detailsHidden: true,
  };
  assert.equal(event.type, "tool_finished");
  assert.equal(event.detailsHidden, true);
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
npm run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js }
```

Expected: TypeScript fails because `agent-events.ts` and `agent-event-redaction.ts` do not exist.

- [x] **Step 3: Add event protocol**

Create `src/core/agent-events.ts`:

```ts
import type { ModelResponse } from "../protocol/types.js";

export type AgentRunEventBase = {
  runId: string;
  sessionId?: string;
  createdAt?: string;
};

export type AgentRunEvent =
  | (AgentRunEventBase & { type: "session_started"; sessionId: string; objective: string })
  | (AgentRunEventBase & { type: "step_started"; step: number; model?: string; provider?: string })
  | (AgentRunEventBase & {
      type: "model_finished";
      step: number;
      responseType: ModelResponse["type"];
      toolCallCount: number;
      durationMs: number;
    })
  | (AgentRunEventBase & { type: "assistant_text"; step: number; text: string; final?: boolean })
  | (AgentRunEventBase & { type: "assistant_note"; step: number; text: string })
  | (AgentRunEventBase & {
      type: "tool_started";
      step: number;
      callId: string;
      toolName: string;
      title: string;
      detailsHidden: boolean;
      paths?: string[];
    })
  | (AgentRunEventBase & {
      type: "tool_finished";
      step: number;
      callId: string;
      toolName: string;
      title: string;
      status: "ok" | "failed";
      durationMs?: number;
      detailsHidden: boolean;
      errorCode?: string;
      paths?: string[];
      exitCode?: number | null;
      timedOut?: boolean;
    })
  | (AgentRunEventBase & { type: "file_changed"; step: number; path: string; change: "create" | "modify" | "delete" | "patch" })
  | (AgentRunEventBase & { type: "step_limit_reached"; maxSteps: number })
  | (AgentRunEventBase & { type: "run_failed"; message: string });

export type AgentRunEventSink = (event: AgentRunEvent) => void | Promise<void>;

export function withEventDefaults(event: AgentRunEvent): AgentRunEvent {
  return {
    createdAt: new Date().toISOString(),
    ...event,
  };
}
```

- [x] **Step 4: Extend tool result display metadata**

Modify `src/protocol/types.ts`:

```ts
export type ToolDisplay = {
  title: string;
  detailsHidden?: boolean;
  paths?: string[];
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs?: number;
};

export type ToolResult = {
  callId: string;
  ok: boolean;
  output?: string;
  data?: unknown;
  display?: ToolDisplay;
  error?: {
    code: string;
    message: string;
  };
  truncated?: boolean;
};
```

- [x] **Step 5: Add redaction helpers**

Create `src/core/agent-event-redaction.ts`:

```ts
import type { JsonObject, ToolDisplay } from "../protocol/types.js";

const API_KEY_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
];

export function redactAgentEventText(value: string): string {
  return API_KEY_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED:api_key]"), value);
}

export function summarizeToolInput(toolName: string, input: JsonObject): ToolDisplay {
  switch (toolName) {
    case "read_file":
      return { title: `Read ${safeString(input.path)}`, paths: safePathList(input.path), detailsHidden: true };
    case "search_text":
      return { title: `Search ${safeString(input.query)}`, detailsHidden: true };
    case "list_files":
      return { title: `List ${safeString(input.path) || "."}`, paths: safePathList(input.path), detailsHidden: true };
    case "run_command":
      return { title: "Run command", detailsHidden: true };
    case "apply_patch":
      return { title: "Apply patch", detailsHidden: true };
    case "create_file":
      return { title: `Create ${safeString(input.path)}`, paths: safePathList(input.path), detailsHidden: true };
    case "replace_range":
      return { title: `Edit ${safeString(input.path)}`, paths: safePathList(input.path), detailsHidden: true };
    default:
      return { title: toolName, detailsHidden: true };
  }
}

function safeString(value: unknown): string {
  return redactAgentEventText(typeof value === "string" ? value : "");
}

function safePathList(value: unknown): string[] | undefined {
  return typeof value === "string" && value ? [redactAgentEventText(value)] : undefined;
}
```

- [x] **Step 6: Run event tests**

Run:

```powershell
npm run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js }
```

Expected: PASS.

---

## Task 2: Emit Rich Events From AgentLoop

**Files:**
- Modify: `src/core/agent-loop.ts`
- Modify: `src/platform/local-platform.ts`
- Test: `src/__tests__/agent-events.test.ts`

- [x] **Step 1: Add failing AgentLoop event test**

Append to `src/__tests__/agent-events.test.ts`:

```ts
import { AgentLoop } from "../core/agent-loop.js";
import { MemoryAgentStore } from "../store/memory-agent-store.js";
import type { ModelClient } from "../model/model-client.js";
import type { RegisteredTool } from "../protocol/types.js";

test("agent loop emits rich safe events for tool execution", async () => {
  const events: AgentRunEvent[] = [];
  const store = new MemoryAgentStore();
  const model: ModelClient = {
    async complete(request) {
      const hasTool = request.messages.some((message) => message.role === "tool");
      return hasTool
        ? { type: "message", content: "done" }
        : {
            type: "tool_calls",
            content: "I will inspect files.",
            toolCalls: [{ id: "call_list", name: "list_files", input: { path: "." } }],
          };
    },
  };
  const tools: RegisteredTool[] = [
    {
      name: "list_files",
      description: "List files.",
      inputSchema: {},
      handler: async () => ({
        callId: "list_files",
        ok: true,
        output: "README.md",
        display: { title: "List .", paths: ["."], detailsHidden: true },
      }),
    },
  ];
  const agent = new AgentLoop({
    model,
    tools,
    systemPrompt: "system",
    store,
    actor: { type: "user", id: "tester" },
    onProgress: (event) => events.push(event as AgentRunEvent),
  });

  const answer = await agent.run("inspect");

  assert.equal(answer, "done");
  assert.equal(events.some((event) => event.type === "session_started"), true);
  assert.equal(events.some((event) => event.type === "step_started"), true);
  assert.equal(events.some((event) => event.type === "assistant_note"), true);
  assert.equal(events.some((event) => event.type === "tool_started" && event.title === "List ."), true);
  assert.equal(events.some((event) => event.type === "tool_finished" && event.status === "ok"), true);
  assert.equal(events.some((event) => event.type === "assistant_text" && event.final), true);
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
npm run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js }
```

Expected: FAIL because `AgentLoop` still emits the old coarse event names.

- [x] **Step 3: Replace `AgentLoopProgressEvent` with `AgentRunEvent`**

In `src/core/agent-loop.ts`:

```ts
import { summarizeToolInput } from "./agent-event-redaction.js";
import type { AgentRunEvent, AgentRunEventSink } from "./agent-events.js";
import { withEventDefaults } from "./agent-events.js";
```

Replace the local `AgentLoopProgressEvent` union with:

```ts
export type AgentLoopProgressEvent = AgentRunEvent;
```

Change `AgentLoopOptions.onProgress` to:

```ts
onProgress?: AgentRunEventSink;
```

Add a private field:

```ts
private readonly runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
```

Update `emitProgress`:

```ts
private async emitProgress(event: Omit<AgentRunEvent, "runId"> & { runId?: string }): Promise<void> {
  await this.onProgress?.(withEventDefaults({ runId: this.runId, ...event } as AgentRunEvent));
}
```

- [x] **Step 4: Emit step and assistant events**

In `runContext`, emit:

```ts
await this.emitProgress({ type: "step_started", step: stepNumber, sessionId: session?.id });
```

When `response.type === "message"`, before returning:

```ts
await this.emitProgress({
  type: "assistant_text",
  step: stepNumber,
  sessionId: session?.id,
  text: response.content,
  final: true,
});
```

When tool calls include assistant content:

```ts
if (assistantMessage.content.trim()) {
  await this.emitProgress({
    type: "assistant_note",
    step: stepNumber,
    sessionId: session?.id,
    text: assistantMessage.content,
  });
}
```

- [x] **Step 5: Emit tool events with display metadata**

Before each tool runs:

```ts
const display = summarizeToolInput(toolCall.name, toolCall.input);
await this.emitProgress({
  type: "tool_started",
  step: stepNumber,
  sessionId: session?.id,
  callId: toolCall.id,
  toolName: toolCall.name,
  title: display.title,
  detailsHidden: display.detailsHidden ?? true,
  paths: display.paths,
});
```

After each tool runs:

```ts
const resultDisplay = result.display ?? display;
await this.emitProgress({
  type: "tool_finished",
  step: stepNumber,
  sessionId: session?.id,
  callId: toolCall.id,
  toolName: toolCall.name,
  title: resultDisplay.title,
  status: result.ok ? "ok" : "failed",
  detailsHidden: resultDisplay.detailsHidden ?? true,
  errorCode: result.error?.code,
  paths: resultDisplay.paths,
  exitCode: resultDisplay.exitCode,
  timedOut: resultDisplay.timedOut,
  durationMs: resultDisplay.durationMs,
});
```

- [x] **Step 6: Run event tests**

Run:

```powershell
npm run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js }
```

Expected: PASS.

---

## Task 3: Add Display Metadata To Workspace Tools

**Files:**
- Modify: `src/tools/workspace-tools.ts`
- Test: `src/__tests__/security.test.ts`
- Test: `src/__tests__/agent-events.test.ts`

- [x] **Step 1: Add failing workspace display metadata test**

Append to `src/__tests__/agent-events.test.ts`:

```ts
import { createWorkspaceTools } from "../tools/workspace-tools.js";
import { LocalWorkspaceRuntime } from "../workspace/local-workspace-runtime.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

test("workspace tools return safe display metadata", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-tool-display-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(dir, "README.md"), "# Tool Display\n", "utf8");
  const tools = createWorkspaceTools(new LocalWorkspaceRuntime(dir));
  const read = tools.find((tool) => tool.name === "read_file");
  assert(read);

  const result = await read.handler({ path: "README.md" });

  assert.equal(result.ok, true);
  assert.equal(result.display?.title, "Read README.md");
  assert.deepEqual(result.display?.paths, ["README.md"]);
  assert.equal(result.display?.detailsHidden, true);
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
npm run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js }
```

Expected: FAIL because workspace tools do not populate `display`.

- [x] **Step 3: Add display-aware wrapper**

In `src/tools/workspace-tools.ts`, replace `wrap` with:

```ts
async function wrap(
  callId: string,
  action: () => Promise<string>,
  display?: ToolResult["display"],
): Promise<ToolResult> {
  try {
    return {
      callId,
      ok: true,
      output: await action(),
      display,
    };
  } catch (error) {
    return {
      callId,
      ok: false,
      display,
      error: {
        code: "tool_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
```

- [x] **Step 4: Populate display for read/search/list**

Change handlers:

```ts
handler: async (input) => {
  const filePath = stringInput(input, "path");
  return wrap("read_file", async () =>
    workspace.readFile({
      path: filePath,
      startLine: numberInput(input, "startLine"),
      endLine: numberInput(input, "endLine"),
    }),
    { title: `Read ${filePath}`, paths: [filePath], detailsHidden: true },
  );
}
```

Use equivalent metadata for:

- `list_files`: `{ title: `List ${path}`, paths: [path], detailsHidden: true }`
- `search_text`: `{ title: `Search ${query}`, detailsHidden: true }`

- [x] **Step 5: Populate display for command results**

After `workspace.runCommand`, parse result into display:

```ts
const display = {
  title: "Run command",
  detailsHidden: true,
  exitCode: result.exitCode,
  timedOut: result.timedOut,
  durationMs: result.durationMs,
};
```

Return this display with the tool result. Do not put the raw command in the title.

- [x] **Step 6: Populate display for write tools**

For `apply_patch`, use target paths:

```ts
const paths = extractPatchTargetPaths(patch);
return wrap("apply_patch", async () => { ... }, {
  title: `Apply patch (${paths.length} file${paths.length === 1 ? "" : "s"})`,
  paths,
  detailsHidden: true,
});
```

For `create_file`:

```ts
{ title: `Create ${filePath}`, paths: [filePath], detailsHidden: true }
```

For `replace_range`:

```ts
{ title: `Edit ${filePath}`, paths: [filePath], detailsHidden: true }
```

- [x] **Step 7: Run tests**

Run:

```powershell
npm run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js }
```

Expected: PASS.

---

## Task 4: Build The Pure ANSI Layout Renderer

**Files:**
- Create: `src/cli/tui/ansi.ts`
- Create: `src/cli/tui/state.ts`
- Create: `src/cli/tui/layout.ts`
- Test: `src/__tests__/rich-tui.test.ts`

- [x] **Step 1: Write failing renderer tests**

Create `src/__tests__/rich-tui.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { renderConversationScreen, renderWelcomeScreen } from "../cli/tui/layout.js";
import type { RichTuiState } from "../cli/tui/state.js";

test("rich tui welcome screen shows logo prompt model and workspace", () => {
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Build",
    input: "",
    messages: [],
    events: [],
  };
  const screen = renderWelcomeScreen(state, { columns: 100, rows: 30 });
  assert.match(screen, /soloclaw/i);
  assert.match(screen, /Ask anything/);
  assert.match(screen, /Build/);
  assert.match(screen, /deepseek-v4-flash/);
  assert.match(screen, /E:\\code\\agent/);
});

test("rich tui layout falls back gracefully on narrow terminals", () => {
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "mock",
    model: "mock",
    readiness: "fail",
    mode: "Build",
    input: "hello",
    messages: [],
    events: [],
  };
  const screen = renderWelcomeScreen(state, { columns: 40, rows: 12 });
  assert.equal(screen.includes("\n"), true);
  assert.match(screen, /soloclaw/i);
});

test("rich tui conversation screen shows context mode and right status rail", () => {
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    readiness: "pass",
    mode: "Plan",
    input: "Add a lightning tower",
    messages: [
      { role: "user", text: "你好" },
      { role: "assistant", text: "你好！有什么可以帮你的吗？" },
    ],
    events: [],
    context: { tokens: 9584, percentUsed: 5, spentUsd: 0 },
    lsp: { enabled: false, label: "LSPs are disabled" },
    objective: "新增闪电塔",
    version: "0.2.0",
  };
  const screen = renderConversationScreen(state, { columns: 140, rows: 34 });
  assert.match(screen, /Plan/);
  assert.match(screen, /Context/);
  assert.match(screen, /9\.6K/);
  assert.match(screen, /5%/);
  assert.match(screen, /LSPs are disabled/);
  assert.match(screen, /deepseek-v4-flash/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
npm run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js }
```

Expected: TypeScript fails because TUI files do not exist.

- [x] **Step 3: Add ANSI helpers**

Create `src/cli/tui/ansi.ts`:

```ts
export const ansi = {
  clear: "\x1b[2J\x1b[H",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  faint: "\x1b[2m",
  purple: "\x1b[38;5;99m",
  orange: "\x1b[38;5;208m",
  gray: "\x1b[38;5;245m",
  black: "\x1b[38;5;16m",
};

export type TerminalSize = {
  columns: number;
  rows: number;
};

export function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

export function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

export function clip(value: string, width: number): string {
  const plain = stripAnsi(value);
  if (plain.length <= width) return value;
  if (width <= 1) return plain.slice(0, width);
  return `${plain.slice(0, width - 3)}...`;
}

export function center(value: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - visibleLength(value)) / 2));
  return `${" ".repeat(pad)}${value}`;
}
```

- [x] **Step 4: Add TUI state types**

Create `src/cli/tui/state.ts`:

```ts
import type { AgentRunEvent } from "../../core/agent-events.js";

export type RichTuiMessage = {
  role: "user" | "assistant" | "system";
  text: string;
};

export type RichTuiContextMetrics = {
  tokens: number;
  percentUsed: number;
  windowTokens?: number;
  spentUsd?: number;
};

export type RichTuiLspStatus = {
  enabled: boolean;
  label: string;
};

export type RichTuiState = {
  workspace: string;
  provider: string;
  model: string;
  readiness: string;
  mode: "Build" | "Plan" | "Goal";
  input: string;
  messages: RichTuiMessage[];
  events: AgentRunEvent[];
  context?: RichTuiContextMetrics;
  lsp?: RichTuiLspStatus;
  objective?: string;
  version?: string;
  focus?: "input" | "transcript" | "sidebar" | "commands";
  lastRunDurationMs?: number;
  activeSessionId?: string;
  statusLine?: string;
};
```

- [x] **Step 5: Add welcome layout**

Create `src/cli/tui/layout.ts`:

```ts
import { ansi, center, clip, type TerminalSize } from "./ansi.js";
import type { RichTuiState } from "./state.js";

const LOGO = [
  "           __           __              ",
  "  ___ ___ / /__  ____  / /___ __      __",
  " (_-</ _ `/ / _ \\/ __/ / / __ `/ | /|/ /",
  "/___/\\_,_/_/\\___/\\__/ /_/\\_,_/|__/|__/ ",
];

export function renderWelcomeScreen(state: RichTuiState, size: TerminalSize): string {
  const width = Math.max(size.columns, 32);
  const height = Math.max(size.rows, 10);
  const lines: string[] = [];
  const topPad = height >= 24 ? 4 : 1;
  for (let index = 0; index < topPad; index += 1) lines.push("");
  const logoLines = width >= 72 ? LOGO : ["soloclaw"];
  for (const line of logoLines) lines.push(center(`${ansi.bold}${line}${ansi.reset}`, width));
  lines.push("");
  lines.push(...renderPromptBox(state, width));
  lines.push("");
  lines.push(center(`${ansi.bold}tab${ansi.reset} agents   ${ansi.bold}ctrl+p${ansi.reset} commands   ${ansi.bold}/model setup${ansi.reset} configure`, width));
  while (lines.length < height - 2) lines.push("");
  lines.push(center(`${ansi.orange}Tip${ansi.reset} Run ${ansi.bold}/model setup${ansi.reset} to configure providers and API keys`, width));
  return lines.map((line) => clip(line, width)).join("\n");
}

export function renderConversationScreen(state: RichTuiState, size: TerminalSize): string {
  const width = Math.max(size.columns, 48);
  const height = Math.max(size.rows, 14);
  const railWidth = width >= 112 ? 30 : 0;
  const gapWidth = railWidth > 0 ? 2 : 0;
  const mainWidth = width - railWidth - gapWidth;
  const main = renderConversationMain(state, mainWidth, height);
  if (railWidth === 0) return main.map((line) => clip(line, width)).join("\n");
  const rail = renderStatusRail(state, railWidth, height);
  return main.map((line, index) => `${clip(line, mainWidth)}  ${clip(rail[index] ?? "", railWidth)}`).join("\n");
}

function renderConversationMain(state: RichTuiState, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push(`${ansi.bold}soloclaw${ansi.reset}`);
  lines.push("");
  for (const message of state.messages.slice(-8)) {
    const rail = message.role === "user" ? ansi.orange : message.role === "assistant" ? ansi.purple : ansi.gray;
    lines.push(`${rail}|${ansi.reset} ${clip(message.text, width - 3)}`);
    lines.push("");
  }
  for (const event of state.events.slice(-6)) {
    lines.push(clip(formatInlineEvent(event), width));
  }
  while (lines.length < height - 5) lines.push("");
  lines.push(...renderPromptBox(state, width));
  lines.push(renderBottomStatus(state, width));
  return lines.slice(0, height);
}

function renderStatusRail(state: RichTuiState, width: number, height: number): string[] {
  const context = state.context;
  const lines = [
    `${ansi.bold}${clip(state.objective || "Current session", width)}${ansi.reset}`,
    "",
    `${ansi.bold}Context${ansi.reset}`,
    context ? `${formatTokens(context.tokens)} tokens` : "not measured",
    context ? `${context.percentUsed}% used` : "",
    context?.windowTokens ? `${formatTokens(context.windowTokens)} window` : "",
    context?.spentUsd !== undefined ? `$${context.spentUsd.toFixed(2)} spent` : "",
    "",
    `${ansi.bold}Model${ansi.reset}`,
    `${state.provider}`,
    `${state.model}`,
    `readiness: ${state.readiness}`,
    "",
    `${ansi.bold}LSP${ansi.reset}`,
    state.lsp?.label ?? "LSPs are disabled",
    "",
    `${ansi.bold}Workspace${ansi.reset}`,
    clip(state.workspace, width),
    "",
    state.version ? `${ansi.gray}Soloclaw ${state.version}${ansi.reset}` : "",
  ].filter((line) => line !== "");
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

function renderBottomStatus(state: RichTuiState, width: number): string {
  const context = state.context ? `${formatTokens(state.context.tokens)} (${state.context.percentUsed}%)` : "context n/a";
  const duration = state.lastRunDurationMs === undefined ? "" : ` - ${(state.lastRunDurationMs / 1000).toFixed(1)}s`;
  return clip(`${ansi.orange}${state.mode}${ansi.reset} - ${state.provider} ${state.model}${duration} - ${context} - ctrl+p commands - f2 mode`, width);
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : String(tokens);
}

function formatInlineEvent(event: RichTuiState["events"][number]): string {
  if (event.type === "tool_finished") return `${event.status === "ok" ? "OK" : "ERR"} ${event.title}`;
  if (event.type === "step_started") return `Thinking step ${event.step}`;
  if (event.type === "assistant_note") return event.text;
  return event.type;
}

function renderPromptBox(state: RichTuiState, width: number): string[] {
  const boxWidth = Math.min(Math.max(52, width - 24), 96);
  const left = " ".repeat(Math.max(0, Math.floor((width - boxWidth) / 2)));
  const prompt = state.input || 'Ask anything... "Add a lightning tower"';
  const status = `${ansi.purple}${state.mode}${ansi.reset} - ${state.provider} ${state.model} - ${state.readiness} - ${clip(state.workspace, 28)}`;
  return [
    `${left}${ansi.purple}|${ansi.reset}${" ".repeat(boxWidth - 1)}`,
    `${left}${ansi.purple}|${ansi.reset} ${ansi.gray}${clip(prompt, boxWidth - 4)}${ansi.reset}`,
    `${left}${ansi.purple}|${ansi.reset}${" ".repeat(boxWidth - 1)}`,
    `${left}${ansi.purple}|${ansi.reset} ${clip(status, boxWidth - 4)}`,
  ];
}
```

- [x] **Step 6: Run renderer tests**

Run:

```powershell
npm run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js }
```

Expected: PASS.

---

## Task 5: Render Folded Execution Events

**Files:**
- Create: `src/cli/tui/event-renderer.ts`
- Modify: `src/cli/tui/layout.ts`
- Test: `src/__tests__/rich-tui.test.ts`

- [x] **Step 1: Add failing folded event tests**

Append to `src/__tests__/rich-tui.test.ts`:

```ts
import { renderEventRow } from "../cli/tui/event-renderer.js";

test("event renderer hides command details by default", () => {
  const row = renderEventRow({
    type: "tool_finished",
    runId: "run_test",
    step: 2,
    callId: "call_test",
    toolName: "run_command",
    title: "Run command",
    status: "ok",
    detailsHidden: true,
    exitCode: 0,
    durationMs: 34,
  });
  assert.match(row, /Run command/);
  assert.match(row, /hidden/);
  assert.equal(row.includes("npm test"), false);
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
npm run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js }
```

Expected: FAIL because `event-renderer.ts` does not exist.

- [x] **Step 3: Add event renderer**

Create `src/cli/tui/event-renderer.ts`:

```ts
import type { AgentRunEvent } from "../../core/agent-events.js";
import { ansi, clip } from "./ansi.js";

export function renderEventRow(event: AgentRunEvent, width = 100): string {
  switch (event.type) {
    case "session_started":
      return clip(`${ansi.purple}>${ansi.reset} Session ${event.sessionId}`, width);
    case "step_started":
      return clip(`${ansi.gray}.${ansi.reset} Thinking step ${event.step}`, width);
    case "assistant_note":
      return clip(`${ansi.gray}-${ansi.reset} ${event.text}`, width);
    case "assistant_text":
      return clip(`${ansi.purple}>${ansi.reset} ${event.text}`, width);
    case "tool_started":
      return clip(`${ansi.gray}.${ansi.reset} ${event.title}${event.detailsHidden ? " (details hidden)" : ""}`, width);
    case "tool_finished": {
      const icon = event.status === "ok" ? "OK" : "ERR";
      const tail = [
        event.exitCode !== undefined ? `exit=${event.exitCode ?? "-"}` : undefined,
        event.timedOut ? "timed out" : undefined,
        event.durationMs !== undefined ? `${event.durationMs}ms` : undefined,
        event.detailsHidden ? "details hidden" : undefined,
      ].filter(Boolean).join(", ");
      return clip(`${event.status === "ok" ? ansi.purple : ansi.orange}${icon}${ansi.reset} ${event.title}${tail ? ` (${tail})` : ""}`, width);
    }
    case "file_changed":
      return clip(`${ansi.purple}FILE${ansi.reset} ${event.change} ${event.path}`, width);
    case "model_finished":
      return clip(`${ansi.gray}.${ansi.reset} Model ${event.responseType} in ${event.durationMs}ms`, width);
    case "step_limit_reached":
      return clip(`${ansi.orange}!${ansi.reset} Step budget reached: ${event.maxSteps}`, width);
    case "run_failed":
      return clip(`${ansi.orange}ERR${ansi.reset} ${event.message}`, width);
  }
}
```

- [x] **Step 4: Upgrade conversation event rows**

In `src/cli/tui/layout.ts`, add:

```ts
import { renderEventRow } from "./event-renderer.js";
```

In `renderConversationMain`, replace the simple inline formatter:

```ts
const recentEvents = state.events.slice(-6);
for (const event of recentEvents) {
  lines.push(clip(renderEventRow(event, width), width));
}
```

Remove `formatInlineEvent` after the replacement.

- [x] **Step 5: Run renderer tests**

Run:

```powershell
npm run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js }
```

Expected: PASS.

---

## Task 6: Add Rich TUI Shell With Plain Fallback

**Files:**
- Create: `src/cli/tui/rich-shell.ts`
- Create: `src/cli/tui/commands.ts`
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Add failing fallback test**

Add to `src/__tests__/security.test.ts` near existing TUI tests:

```ts
test("soloclaw uses plain TUI fallback for piped input", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-plain-tui-fallback-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(dir, "README.md"), "# Plain TUI Fallback\n", "utf8");
  const cli = path.join(process.cwd(), "dist", "cli", "index.js");
  const result = await runWithInput(process.execPath, [cli], dir, "/status\n/exit\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Soloclaw/);
  assert.match(result.stdout, /soloclaw>/);
  assert.doesNotMatch(result.stdout, /\x1b\[2J/);
});
```

- [x] **Step 2: Add failing rich shell selection test**

Add a pure selection helper for the implementation in this task:

```ts
test("rich TUI is selected only for interactive terminals", async () => {
  const { shouldUseRichTui } = await import("../cli/tui/rich-shell.js");
  assert.equal(shouldUseRichTui({ stdinIsTTY: true, stdoutIsTTY: true, forcePlain: false }), true);
  assert.equal(shouldUseRichTui({ stdinIsTTY: false, stdoutIsTTY: true, forcePlain: false }), false);
  assert.equal(shouldUseRichTui({ stdinIsTTY: true, stdoutIsTTY: true, forcePlain: true }), false);
});
```

- [x] **Step 3: Run tests to verify failure**

Run:

```powershell
npm run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "plain TUI fallback|rich TUI is selected" }
```

Expected: FAIL because `rich-shell.ts` does not exist.

- [x] **Step 4: Add command registry**

Create `src/cli/tui/commands.ts`:

```ts
export type TuiCommand = {
  name: string;
  description: string;
};

export const TUI_COMMANDS: TuiCommand[] = [
  { name: "/model setup", description: "Configure model provider and API key" },
  { name: "/model check", description: "Check active model readiness" },
  { name: "/status", description: "Show workspace and model status" },
  { name: "/sessions", description: "Show recent agent sessions" },
  { name: "/help", description: "Show commands" },
  { name: "/exit", description: "Quit Soloclaw" },
];
```

- [x] **Step 5: Add rich shell skeleton**

Create `src/cli/tui/rich-shell.ts`:

```ts
import { stdin, stdout } from "node:process";
import { emitKeypressEvents } from "node:readline";
import type { LocalProviderProfileStore } from "../../model/local-provider-profile-store.js";
import type { ModelProviderName } from "../../model/model-client.js";
import { ansi, type TerminalSize } from "./ansi.js";
import { renderWelcomeScreen } from "./layout.js";
import type { RichTuiState } from "./state.js";

export type RichTuiSelectionInput = {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  forcePlain: boolean;
};

export type RichShellContext = {
  workspace: string;
  provider: ModelProviderName;
  model: string;
  readiness: string;
  version: string;
  profileStore: LocalProviderProfileStore;
};

export function shouldUseRichTui(input: RichTuiSelectionInput): boolean {
  return input.stdinIsTTY && input.stdoutIsTTY && !input.forcePlain;
}

export async function startRichTuiShell(context: RichShellContext): Promise<void> {
  const state: RichTuiState = {
    workspace: context.workspace,
    provider: context.provider,
    model: context.model,
    readiness: context.readiness,
    mode: "Build",
    input: "",
    messages: [],
    events: [],
    context: { tokens: 0, percentUsed: 0, spentUsd: 0 },
    lsp: { enabled: false, label: "LSPs are disabled" },
    version: context.version,
    focus: "input",
  };
  const size = terminalSize();
  stdout.write(ansi.hideCursor);
  try {
    redraw(state, size);
    await waitForExitKey();
  } finally {
    stdout.write(ansi.showCursor);
    stdout.write("\n");
  }
}

function redraw(state: RichTuiState, size: TerminalSize): void {
  stdout.write(ansi.clear);
  stdout.write(renderWelcomeScreen(state, size));
}

function terminalSize(): TerminalSize {
  return {
    columns: stdout.columns ?? 100,
    rows: stdout.rows ?? 30,
  };
}

async function waitForExitKey(): Promise<void> {
  emitKeypressEvents(stdin);
  const rawInput = stdin as typeof stdin & { setRawMode?: (mode: boolean) => typeof stdin };
  const wasRaw = rawInput.isRaw;
  rawInput.setRawMode?.(true);
  stdin.resume();
  await new Promise<void>((resolve) => {
    const onKeypress = (_value: string, key: { ctrl?: boolean; name?: string } = {}) => {
      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        stdin.off("keypress", onKeypress);
        resolve();
      }
    };
    stdin.on("keypress", onKeypress);
  });
  rawInput.setRawMode?.(wasRaw);
}
```

- [x] **Step 6: Wire rich shell selection into CLI**

In `src/cli/index.ts`, import:

```ts
import { shouldUseRichTui, startRichTuiShell } from "./tui/rich-shell.js";
```

In `startTui`, before creating `readline`, add:

```ts
const activeProfile = (await profileStore.list()).find((profile) => profile.name === provider);
if (shouldUseRichTui({
  stdinIsTTY: stdin.isTTY === true,
  stdoutIsTTY: stdout.isTTY === true,
  forcePlain: process.env.SOLOCLAW_PLAIN_TUI === "1",
})) {
  await startRichTuiShell({
    workspace,
    provider,
    model: activeProfile?.defaultModel ?? provider,
    readiness: status.readiness.status,
    version: "dev",
    profileStore,
  });
  return;
}
```

- [x] **Step 7: Run fallback tests**

Run:

```powershell
npm run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "plain TUI fallback|rich TUI is selected" }
```

Expected: PASS.

---

## Task 7: Make The Rich Shell Actually Chat

**Files:**
- Modify: `src/cli/tui/rich-shell.ts`
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/rich-tui.test.ts`
- Test: manual TTY smoke

- [x] **Step 1: Extract task runner from legacy TUI**

Move natural-language task execution from `src/cli/index.ts` into a reusable helper:

```ts
export type TuiTaskRunnerInput = {
  workspace: string;
  provider: ModelProviderName;
  profileStore: LocalProviderProfileStore;
  task: string;
  mode: "Plan" | "Build" | "Goal";
  onEvent: AgentRunEventSink;
};

export async function runTuiAgentTask(input: TuiTaskRunnerInput): Promise<{ answer: string; sessionId?: string }> {
  await ensureTuiModelSecretReady(inputReader, input.profileStore, input.provider, input.workspace);
  const platform = await createLocalPlatform(input.workspace, {
    provider: input.provider,
    knowledgeQuery: `${input.mode}: ${input.task}`,
    maxSteps: TUI_RUN_MAX_STEPS,
    onAgentProgress: input.onEvent,
  });
  try {
    const result = await platform.agent.runWithSession(input.task);
    return { answer: result.finalAnswer, sessionId: result.session?.id };
  } finally {
    platform.locks.close?.();
    platform.store.close();
  }
}
```

Implementation note: do not literally use `inputReader` in rich mode. Split `ensureTuiModelSecretReady` so rich mode can call a non-interactive readiness check and direct users to `/model setup` when a secret is missing.

- [x] **Step 2: Add raw input editing**

In `startRichTuiShell`, handle:

- Normal printable characters append to `state.input`.
- Backspace removes one character.
- Enter submits the current input.
- `ctrl+c` or Escape exits.
- `ctrl+p` appends a small command list into `state.messages`.
- `F2` cycles mode in this order: `Plan -> Build -> Goal -> Plan`.
- Tab cycles the focused panel between input, recent messages, and command hints.

Use:

```ts
if (key.name === "backspace") state.input = state.input.slice(0, -1);
else if (key.name === "return" || key.name === "enter") await submit();
else if (key.ctrl && key.name === "m") state.mode = nextMode(state.mode);
else if (value && value >= " " && value !== "\x7f") state.input += value;
```

Add:

```ts
function nextMode(mode: RichTuiState["mode"]): RichTuiState["mode"] {
  if (mode === "Plan") return "Build";
  if (mode === "Build") return "Goal";
  return "Plan";
}
```

- [x] **Step 3: Render chat transcript**

Update `renderWelcomeScreen` or add `renderChatScreen` so that after first user message the center region shows:

- Recent user prompts.
- Assistant final answer.
- Recent folded events.
- Right rail with context usage, model readiness, LSP status, workspace, and version.
- Bottom status row with mode, provider/model, run duration, context summary, and shortcuts.
- Bottom input box always visible.

- [x] **Step 4: Run manual TTY smoke**

Run:

```powershell
npm run build
node dist\cli\index.js
```

Manual expected:

- Full-screen Soloclaw UI appears.
- Current workspace and active model are visible.
- Typing text appears in the input box.
- Enter submits.
- Live folded progress appears.
- Final answer appears.
- Escape or Ctrl+C exits cleanly and restores cursor.

---

## Task 8: Add Streaming Model Support

**Files:**
- Modify: `src/model/model-client.ts`
- Modify: `src/model/mock-model-client.ts`
- Modify: `src/model/http-model-clients.ts`
- Modify: `src/core/agent-loop.ts`
- Test: `src/__tests__/agent-events.test.ts`

- [x] **Step 1: Add failing streaming test**

Add to `src/__tests__/agent-events.test.ts`:

```ts
test("agent loop emits assistant text deltas from streaming models", async () => {
  const events: AgentRunEvent[] = [];
  const model: ModelClient = {
    async complete() {
      return { type: "message", content: "fallback" };
    },
    async *streamComplete() {
      yield { type: "text_delta", text: "hel" };
      yield { type: "text_delta", text: "lo" };
      yield { type: "message", content: "hello" };
    },
  };
  const agent = new AgentLoop({
    model,
    tools: [],
    systemPrompt: "system",
    onProgress: (event) => events.push(event as AgentRunEvent),
  });
  const answer = await agent.run("say hello");
  assert.equal(answer, "hello");
  assert.equal(events.some((event) => event.type === "assistant_text" && event.text === "hel" && !event.final), true);
  assert.equal(events.some((event) => event.type === "assistant_text" && event.text === "hello" && event.final), true);
});
```

- [x] **Step 2: Extend model types**

In `src/model/model-client.ts`, add:

```ts
export type ModelStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call_delta"; callId: string; name?: string; inputDelta?: string }
  | ModelResponse;

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
  streamComplete?(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}
```

- [x] **Step 3: Use streaming when available**

In `AgentLoop.completeModel`, if `this.model.streamComplete` exists, consume it:

- Emit `assistant_text` for `text_delta`.
- Buffer final `ModelResponse`.
- If no final response arrives, convert buffered text to `{ type: "message", content: bufferedText }`.
- Fall back to `complete` for clients without streaming.

- [x] **Step 4: Add OpenAI-compatible streaming**

In `src/model/http-model-clients.ts`, implement `streamComplete` for OpenAI-compatible profiles:

- Send `stream: true`.
- Parse SSE `data:` lines.
- Emit text deltas from `choices[0].delta.content`.
- Accumulate tool call deltas if present.
- Emit a final `ModelResponse`.

Safety requirement: never include Authorization header or raw API key in thrown stream errors.

- [x] **Step 5: Add Anthropic-compatible streaming**

Add a minimal Anthropic event parser:

- `content_block_delta` text -> `text_delta`.
- `message_stop` -> final response.
- Tool-use deltas can be added after OpenAI-compatible is stable.

- [x] **Step 6: Run streaming tests**

Run:

```powershell
npm run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\agent-events.test.js }
```

Expected: PASS.

---

## Task 9: Persist And Replay Events In Session Timeline

**Files:**
- Modify: `src/core/agent-loop.ts`
- Modify: `src/sessions/session-timeline-view.ts`
- Modify: `src/__tests__/security.test.ts`

- [x] **Step 1: Add failing timeline test**

Add to `src/__tests__/security.test.ts`:

```ts
test("session timeline includes safe agent run progress events", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-event-timeline-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const platform = await createLocalPlatform(dir, { provider: "mock" });
  try {
    const result = await platform.agent.runWithSession("inspect this workspace");
    assert(result.session);
    const timeline = await buildSessionTimeline(platform.store, result.session.id, { limit: 20 });
    assert.equal(timeline.items.some((item) => item.title.includes("agent.event.tool_finished")), true);
    assert.equal(JSON.stringify(timeline).includes("sk-"), false);
  } finally {
    platform.locks.close?.();
    platform.store.close();
  }
});
```

- [x] **Step 2: Persist events through audit records**

In `AgentLoop.emitProgress`, after calling `onProgress`, record a safe audit event when `this.store` and `event.sessionId` exist:

```ts
await this.store?.recordAuditEvent({
  id: makeId<"ArtifactId">("audit"),
  type: "agent.event",
  actor: this.actor ?? { type: "system", id: "agent-loop" },
  sessionId: event.sessionId,
  summary: `agent.event.${event.type}`,
  metadata: event,
  artifactRefs: [],
  createdAt: new Date().toISOString(),
});
```

Do not include raw command text, raw patch text, tool output, or API keys in event metadata.

- [x] **Step 3: Surface agent events in timeline**

In `src/sessions/session-timeline-view.ts`, update `safeTimelineMetadata` to include:

```ts
"runId",
"step",
"toolName",
"title",
"status",
"detailsHidden",
"paths",
"exitCode",
"timedOut",
"durationMs"
```

- [x] **Step 4: Run timeline test**

Run:

```powershell
npm run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "session timeline includes safe agent run progress events" }
```

Expected: PASS.

---

## Task 10: Add Event Subscribe Surface For Web/Desktop UI

**Files:**
- Create: `src/events/local-event-bus.ts`
- Modify: `src/platform/local-platform.ts`
- Modify: `src/web/local-room-web-server.ts` or existing control-plane web API
- Test: `src/__tests__/security.test.ts`

- [x] **Step 1: Add local event bus**

Create `src/events/local-event-bus.ts`:

```ts
import type { AgentRunEvent } from "../core/agent-events.js";

export type LocalEvent = AgentRunEvent;
export type LocalEventListener = (event: LocalEvent) => void;

export class LocalEventBus {
  private readonly listeners = new Set<LocalEventListener>();

  publish(event: LocalEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: LocalEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
```

- [x] **Step 2: Wire platform event bus**

Add optional `eventBus` to `LocalPlatformOptions`:

```ts
eventBus?: LocalEventBus;
```

When `onAgentProgress` fires, also publish into the event bus.

- [x] **Step 3: Add SSE endpoint**

Add a local-only endpoint:

```txt
GET /events
Content-Type: text/event-stream
```

Each event line:

```txt
event: message
data: {"type":"tool_finished",...}
```

Filter by workspace/session if query params are provided.

- [x] **Step 4: Add SSE test**

Use a local server test that:

- Opens `/events`.
- Starts a mock agent run.
- Reads one `session_started` event and one `tool_finished` event.
- Asserts event payload has no secret-looking values.

---

## Task 11: Model Setup And Status Integration In Rich UI

**Files:**
- Modify: `src/cli/tui/rich-shell.ts`
- Modify: `src/cli/tui/commands.ts`
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/rich-tui.test.ts`

- [x] **Step 1: Add status model builder**

Create a helper in `rich-shell.ts`:

```ts
export type RichTuiStatus = {
  provider: string;
  model: string;
  readiness: string;
  workspace: string;
  contextTokens: number;
  contextPercentUsed: number;
  spentUsd?: number;
  lspLabel: string;
  version: string;
};
```

Build it from existing `buildSoloclawStatus` and `LocalProviderProfileStore`.

Use `process.env.npm_package_version ?? "dev"` for the first implementation. If the packaged CLI does not set `npm_package_version`, keep `dev`; do not block the UI on package metadata.

- [x] **Step 2: Support `/model setup` from rich UI**

When user types `/model setup`:

- Temporarily restore cursor and leave full-screen mode.
- Call existing menu setup flow.
- Re-enter rich screen after setup.
- Refresh status row.

This keeps the existing tested model setup menu and avoids duplicating secret input logic in the first rich UI pass.

- [x] **Step 3: Support `/model check` and `/status`**

Render results as system messages inside the transcript:

```txt
Model readiness: pass
Provider: deepseek
Model: deepseek-v4-flash
Context: 9.6K tokens (5%)
LSP: LSPs are disabled
Workspace: E:\code\agent
```

- [x] **Step 4: Keep context metrics current**

When a model response finishes, update `state.context` from available usage metadata. If the provider does not return usage, keep the last known value and show `context n/a` in the bottom status row.

Add a focused renderer test:

```ts
test("bottom status shows context unavailable when usage is missing", () => {
  const state: RichTuiState = {
    workspace: "E:\\code\\agent",
    provider: "mock",
    model: "mock",
    readiness: "pass",
    mode: "Build",
    input: "",
    messages: [],
    events: [],
    lsp: { enabled: false, label: "LSPs are disabled" },
  };
  const screen = renderConversationScreen(state, { columns: 120, rows: 24 });
  assert.match(screen, /context n\/a/);
});
```

- [x] **Step 5: Run manual model setup smoke**

Run:

```powershell
npm run build
node dist\cli\index.js
```

Manual expected:

- Rich UI opens.
- `/model setup` opens the existing menu.
- After setup, rich UI returns.
- Status row shows new provider/model.
- `F2` cycles `Plan`, `Build`, and `Goal`.
- Conversation screen shows context usage or `context n/a`.
- Right rail shows model readiness, LSP status, workspace, and version.
- A natural-language task uses the configured model.

---

## Task 12: Final Verification

**Files:**
- All modified files

- [x] **Step 1: Run focused tests**

Run:

```powershell
npm run build
node --test dist\__tests__\agent-events.test.js
node --test dist\__tests__\rich-tui.test.js
node --test dist\__tests__\security.test.js --test-name-pattern "TUI|agent event|model setup|vaulted|step budget|timeline"
```

Expected: all focused tests pass.

- [x] **Step 2: Run full type check**

Run:

```powershell
npm run check
```

Expected: TypeScript passes with no errors.

- [x] **Step 3: Run full test suite**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [x] **Step 4: Run whitespace check**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors.

- [x] **Step 5: Manual interactive smoke**

Run in a real terminal:

```powershell
node dist\cli\index.js
```

Manual checklist:

- Rich UI opens by default in TTY.
- `SOLOCLAW_PLAIN_TUI=1 node dist\cli\index.js` opens plain mode.
- Current workspace visible.
- Current provider/model visible.
- Plan/Build/Goal mode visible and switchable with `F2`.
- Context usage visible when available; otherwise `context n/a` is shown.
- Right rail shows model readiness, LSP status, workspace, and version.
- Input box accepts natural language.
- Agent progress is visible live.
- Commands and patch details are folded by default.
- `/model setup` still works.
- API key is not printed.
- Ctrl+C/Escape restores cursor and exits cleanly.

## Self-Review

- Spec coverage: covers rich entry screen, current model display, chat input, live execution progress, hidden command/file details, model streaming, event persistence, and SSE/Web UI reuse.
- Marker scan: clean; no deferred-work markers were found.
- Type consistency: event protocol uses `AgentRunEvent`; tool display metadata uses `ToolDisplay`; TUI state uses `RichTuiState`; model streaming uses `ModelStreamEvent`.

## Execution Recommendation

Implement in this order:

1. Task 1 through Task 3 first. This gives a safe event protocol and good progress metadata without touching full-screen rendering.
2. Task 4 through Task 7 next. This gives the beautiful Soloclaw terminal interface.
3. Task 8 through Task 10 after the TUI is stable. This makes the implementation complete: streaming model deltas, replayable events, and web/desktop subscription.
4. Task 11 through Task 12 last. This ties setup/status into the rich UI and verifies the whole flow.

Do not commit until the user explicitly asks.

## Phase 2 next-action helper on 2026-06-19

Implemented a small closeout navigation helper without marking any manual evidence complete:

- Added `soloclaw phase2 next [--workspace path] [--json]`.
- Added `/phase2 next` and `/phase2 next-action` inside the rich TUI.
- Added the `/phase2 next` command palette entry.
- The helper reuses the strict gate summary and renders only the first pending action.

Current local output points to C1:

- `status=blocked_manual_evidence`
- `blocker=C1`
- `realProviderReadiness=ready_for_manual_run`
- `strictEvidence=incomplete_closure_tasks`
- Next action: run `soloclaw phase2 launch-terminal`, verify the real Soloclaw TTY, record C1 evidence, then check the C1 closure task after review.

Verification run:

```powershell
npm.cmd run build
node --test dist\__tests__\security.test.js --test-name-pattern "agent phase2 next shows only the next unfinished closeout action"
node --test dist\__tests__\rich-tui.test.js --test-name-pattern "rich TUI submit shows the next phase2 closeout action"
node dist\cli\index.js phase2 next --workspace E:\code\agent
node dist\cli\index.js phase2 next --workspace E:\code\agent --json
```

Result:

- Build passed.
- Focused CLI and rich TUI tests passed.
- Current gate remains intentionally blocked on reviewed C1/C2/C3 closure tasks.

## Phase 2 review board helper on 2026-06-19

Implemented a closeout review board without marking manual evidence complete:

- Added `soloclaw phase2 review [--workspace path] [--json]`.
- Added `/phase2 review` and `/phase2 review-board` inside the rich TUI.
- Added the `/phase2 review` command palette entry.
- The board summarizes C1/C2/C3 as `evidence=recorded|missing|undated` and `review=checked|needs_review|waiting_for_evidence`.
- The board renders the exact next reviewed closure command for the first unfinished review item.

Current local output:

- `status=blocked_manual_evidence`
- `realProviderReadiness=ready_for_manual_run`
- `strictEvidence=incomplete_closure_tasks`
- `secretMatches=0`
- C1/C2/C3 all show `evidence=recorded review=needs_review`
- Next review action: review saved C1 evidence, then run `soloclaw phase2 closure-task --section C1 --confirm-reviewed`

Verification run:

```powershell
npm.cmd run build
node --test dist\__tests__\security.test.js --test-name-pattern "agent phase2 review summarizes C1 C2 C3 evidence and review commands"
node --test dist\__tests__\rich-tui.test.js --test-name-pattern "rich TUI submit shows the phase2 review board"
node dist\cli\index.js phase2 review --workspace E:\code\agent
npm.cmd run check
git diff --check
npm.cmd test
```

Result:

- Build passed.
- Focused CLI and rich TUI tests passed.
- Type check passed.
- Whitespace check passed with only CRLF normalization warnings.
- Full test suite passed: 409 tests, 409 pass, 0 fail.
- `.agent` secret-shape scan found no plaintext API-key, bearer-token, or Authorization-header shapes.
- Current gate remains intentionally blocked on reviewed C1/C2/C3 closure tasks.

## Phase 2 final-gate helper on 2026-06-19

Implemented a C3 final-gate helper without marking C3 complete automatically:

- Added `soloclaw phase2 final-gate [--workspace path] [--print]`.
- Added compatibility alias `soloclaw phase2 c3-gate`.
- `--print` shows the exact automated C3 command sequence without running it.
- The run path executes `npm.cmd run check`, `npm.cmd test`, `node dist\cli\index.js smoke --rich-tui`, `node dist\cli\index.js smoke --rich-tui-real-provider`, `git diff --check`, and the built-in temp-file scan.
- The helper prints the paste-safe C3 evidence and closure commands after the automated gate.
- It intentionally does not record evidence or check the C3 closure task by itself.

Verification run:

```powershell
node --test dist\__tests__\security.test.js --test-name-pattern "agent phase2 final-gate print shows the C3 automated command sequence"
```

Result:

- Focused final-gate print test passed.
- Current gate remains intentionally blocked on reviewed C1/C2/C3 closure tasks.

## Local DeepSeek testing secret on 2026-06-19

The user supplied a DeepSeek API key for local testing. It has been refreshed through the encrypted local vault path:

- `.agent/secrets.vault.json` stores the encrypted secret value.
- `.agent/model-providers.json` stores only provider metadata plus the active `apiKeySecretRef`.
- `.agent/TESTING-SECRETS.md` records only local testing notes and the non-secret ref id.
- `.agent/` is ignored by `.gitignore`, and this local testing material must remain uncommitted.
- No plaintext API key, bearer token, Authorization header, vault passphrase, or key fragment should be copied into tracked files or evidence notes.

Current local model target:

- Provider: `deepseek`
- Base URL: `https://api.deepseek.com`
- Model: `deepseek-v4-flash`
- Secret location: encrypted local vault only

## Remaining Phase 2 closeout as of 2026-06-19

Complete these in order before marking Phase 2 done:

- **C1: Real external-terminal rich TUI review**

Run:

```powershell
soloclaw phase2 launch-terminal
```

Verify the dedicated Soloclaw screen in a real Windows Terminal or PowerShell window: layout renders, workspace/model/status rail is visible, `F2` cycles Plan/Build/Goal, `Ctrl+P` opens the palette, arrow/Space/Enter selection works, input accepts natural language, and cursor state is restored on exit.

After reviewing the saved dated C1 evidence, run:

```powershell
soloclaw phase2 closure-task --section C1 --confirm-reviewed
```

- **C2: Real-provider task through the rich TUI**

Inside the real Soloclaw terminal, run:

```text
/phase2 readiness
/model check
Inspect package.json and report only the npm scripts whose names include test or check. Do not modify files.
```

If the provider needs to be reconfigured, run `/model setup` first and use the DeepSeek profile above. Record only paste-safe evidence: provider, model, base URL, `/model check` result, live progress result, task answer summary, and leak-scan result. Never record the API key.

After reviewing the saved dated C2 evidence, run:

```powershell
soloclaw phase2 closure-task --section C2 --confirm-reviewed
```

- **C3: Final automated gate after C1 and C2**

Inspect the command sequence first:

```powershell
soloclaw phase2 final-gate --workspace E:\code\agent --print
```

Then run the gate:

```powershell
soloclaw phase2 final-gate --workspace E:\code\agent
```

After it passes, record and review C3:

```powershell
soloclaw phase2 evidence-record --section C3 --result "Final automated gate passed; see local terminal output"
soloclaw phase2 closure-task --section C3 --confirm-reviewed
```

Final confirmation:

```powershell
node dist\cli\index.js phase2 evidence-check --workspace E:\code\agent --strict
soloclaw phase2 gate --workspace E:\code\agent
```

Expected before closure: `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=incomplete_closure_tasks`, blockers `C1,C2,C3`, and `secretMatches=0`.

Expected after reviewed C1/C2/C3 closure: `phase2 gate` reports `ready_for_completion`, with no secret-shape matches.

## Fresh automated preflight on 2026-06-19 19:11:59 +08:00

Ran the automated baseline again after refreshing the local DeepSeek testing secret:

```powershell
npm.cmd run check
node dist\cli\index.js smoke --rich-tui --workspace E:\code\agent
node dist\cli\index.js smoke --rich-tui-real-provider --workspace E:\code\agent
npm.cmd test
git diff --check
rg -n --hidden --glob '!.git/**' 'sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|Authorization:' .agent
node dist\cli\index.js phase2 evidence-check --workspace E:\code\agent --strict --json
node dist\cli\index.js phase2 readiness --workspace E:\code\agent
node dist\cli\index.js phase2 final-gate --workspace E:\code\agent --print
rg --files -g "*.tmp" -g "*.bak" -g "*.log" -g "*.old" -g "*.orig" -g "*.rej" -g "*.tsbuildinfo" -g "!.git/**" -g "!node_modules/**" -g "!.agent/tmp/**"
```

Result:

- TypeScript check passed.
- Mock rich TUI smoke passed with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,phase2,evidence-record,evidence-check,exit`.
- Real-provider rich TUI smoke passed with `ok=true`, provider `deepseek`, model `deepseek-v4-flash`, readiness `ready_for_manual_run`, session `sess_xbsaja93`, and `saw=welcome,readiness,input,progress,answer,exit`.
- Full test suite passed: 410 tests, 410 pass, 0 fail.
- `git diff --check` exited 0 with only LF-to-CRLF normalization warnings.
- `.agent` secret-shape scan exited 1 with no output, meaning no plaintext API-key, bearer-token, or Authorization-header shapes were found in local ignored agent files.
- Strict evidence-check still exits 1 with `status=incomplete_closure_tasks`, `secretMatches=0`, and only `c1ClosureTaskComplete`, `c2ClosureTaskComplete`, and `c3ClosureTaskComplete` failing.
- Readiness reports `status=ready_for_manual_run`, active provider `deepseek`, base URL `https://api.deepseek.com`, encrypted secret reference configured, and local vault files present.
- Final-gate print shows the C3 command sequence and paste-safe evidence commands.
- Temp-file scan exited 1 with no output, meaning no matching temporary residue files were found outside excluded directories.

This improves the automated evidence baseline and proves the scripted real-provider rich TUI path works with the refreshed local DeepSeek credential. It still does not satisfy C1 or C2 because those require human observation in a real external Soloclaw terminal. It also does not satisfy C3 because the final automated gate must be run after C1 and C2 are reviewed.

## Rich TUI final-gate plan entry on 2026-06-19 19:18:39 +08:00

Added a dedicated Soloclaw rich TUI entry for viewing the C3 final automated gate plan:

- Added `/phase2 final-gate` to the rich TUI command palette.
- Added `/phase2 final-gate` and `/phase2 c3-gate` handling in the rich TUI submit path.
- Moved the final-gate plan renderer into the shared Phase 2 closure module so CLI `phase2 final-gate --print` and rich TUI `/phase2 final-gate` use the same command sequence.
- The rich TUI command is intentionally print-only. The actual long-running final gate should still be run in a normal terminal after C1 and C2 are reviewed.

Verification run:

```powershell
npm.cmd run check
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 final-gate" }
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "agent phase2 final-gate print shows the C3 automated command sequence" }
node dist\cli\index.js phase2 final-gate --workspace E:\code\agent --print
node dist\cli\index.js phase2 gate --workspace E:\code\agent --json
git diff --check
rg -n --hidden --glob '!.git/**' 'sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|Authorization:' .agent
```

Result:

- TypeScript check passed.
- Rich TUI final-gate command-plan test passed.
- CLI final-gate print compatibility test passed.
- CLI final-gate print shows the expected C3 command sequence and paste-safe evidence commands.
- `git diff --check` exited 0 with only LF-to-CRLF normalization warnings.
- `.agent` secret-shape scan exited 1 with no output.
- Phase 2 gate still reports `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=incomplete_closure_tasks`, blockers `C1,C2,C3`, and `secretMatches=0`.

This reduces C3 closeout friction inside the dedicated Soloclaw interface, but it does not satisfy C1, C2, or C3 by itself.

## Rich TUI launch-terminal plan entry on 2026-06-19 19:24:43 +08:00

Added a dedicated Soloclaw rich TUI entry for viewing the C1 external terminal launch command:

- Added `/phase2 launch-terminal` to the rich TUI command palette.
- Added `/phase2 launch-terminal` and `/phase2 terminal` handling in the rich TUI submit path.
- Moved the external-terminal launch renderer into the shared Phase 2 closure module so CLI `phase2 launch-terminal --print` and rich TUI `/phase2 launch-terminal` use the same safe command and manual closeout instructions.
- The rich TUI command is print-only. The operator still needs to run the printed command in Windows Terminal or PowerShell and observe the real Soloclaw screen for C1.

Verification run:

```powershell
npm.cmd run check
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 external terminal launch" }
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "agent phase2 launch-terminal prints safe external terminal instructions" }
node dist\cli\index.js phase2 launch-terminal --workspace E:\code\agent --print
node dist\cli\index.js phase2 gate --workspace E:\code\agent --json
git diff --check
rg -n --hidden --glob '!.git/**' 'sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|Authorization:' .agent
```

Result:

- TypeScript check passed.
- Rich TUI external-terminal launch command test passed.
- CLI launch-terminal print compatibility test passed.
- CLI launch-terminal print shows the expected PowerShell command and paste-safe manual closeout instructions.
- `git diff --check` exited 0 with only LF-to-CRLF normalization warnings.
- `.agent` secret-shape scan exited 1 with no output.
- Phase 2 gate still reports `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=incomplete_closure_tasks`, blockers `C1,C2,C3`, and `secretMatches=0`.

This reduces C1 closeout friction inside the dedicated Soloclaw interface, but it does not satisfy C1, C2, or C3 by itself.

## Workspace cleanup pass on 2026-06-19 19:30:09 +08:00

Reviewed the current dirty workspace state and cleaned one small duplicate implementation:

- Confirmed the dirty worktree is dominated by Phase 2 implementation files and the Phase 2 plan, not build residue.
- Confirmed the temporary-file scan still prints no matching `.tmp`, `.bak`, `.log`, `.old`, `.orig`, `.rej`, or `.tsbuildinfo` files outside excluded directories.
- Moved the PowerShell `Start-Process` command builder for `phase2 launch-terminal` into the shared Phase 2 closure module.
- Removed the duplicate PowerShell quote/escape helper copies from `src/cli/index.ts`; CLI launch and rich TUI launch-command display now share the same launch metadata and quoting implementation.

Verification run:

```powershell
rg -n "function quotePowerShellSingle|function escapePowerShellDouble|quotePowerShellSingle\(|escapePowerShellDouble\(|buildPhaseTwoExternalTerminalStartProcessCommand" src\cli\index.ts src\cli\phase2-closure-status.ts
npm.cmd run check
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "agent phase2 launch-terminal prints safe external terminal instructions" }
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 external terminal launch" }
node dist\cli\index.js phase2 launch-terminal --workspace E:\code\agent --print
node dist\cli\index.js phase2 gate --workspace E:\code\agent --json
git diff --check
rg -n --hidden --glob '!.git/**' 'sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|Authorization:' .agent
```

Result:

- Duplicate quote/escape helpers are now only present in `src\cli\phase2-closure-status.ts`; `src\cli\index.ts` calls `buildPhaseTwoExternalTerminalStartProcessCommand`.
- TypeScript check passed.
- CLI launch-terminal print compatibility test passed.
- Rich TUI external-terminal launch command test passed.
- CLI launch-terminal print still shows the expected PowerShell command and paste-safe manual closeout instructions.
- `git diff --check` exited 0 with only LF-to-CRLF normalization warnings.
- `.agent` secret-shape scan exited 1 with no output.
- Phase 2 gate still reports `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=incomplete_closure_tasks`, blockers `C1,C2,C3`, and `secretMatches=0`.

This is a hygiene pass only. It makes the dirty Phase 2 worktree less redundant, but it does not satisfy C1, C2, or C3 by itself.

## C2 gate next-action wording on 2026-06-19 19:38:02 +08:00

Tightened the Phase 2 gate's C2 next-action wording so it reflects the actual provider readiness state:

- When real-provider readiness is missing, the gate still tells the operator to run `/model setup` before `/model check`.
- When real-provider readiness is already `ready_for_manual_run`, the gate now tells the operator to skip `/model setup` unless `/phase2 readiness` reports a problem.
- Added a regression test covering a temporary DeepSeek profile with an encrypted secret ref so this wording does not regress.

Verification run:

```powershell
npm.cmd run check
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase2 gate" }
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 gate" }
node dist\cli\index.js phase2 gate --workspace E:\code\agent
git diff --check
rg -n --hidden --glob '!.git/**' 'sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|Authorization:' .agent
rg --files -g "*.tmp" -g "*.bak" -g "*.log" -g "*.old" -g "*.orig" -g "*.rej" -g "*.tsbuildinfo" -g "!.git/**" -g "!node_modules/**" -g "!.agent/tmp/**"
```

Result:

- TypeScript check passed.
- Phase 2 gate security tests passed, including the new ready-provider next-action regression.
- Rich TUI phase2 gate test passed.
- Current workspace gate now reports C2 as: run `/phase2 readiness`, skip `/model setup` unless readiness reports a problem, then run `/model check` and the read-only package.json task.
- `git diff --check` exited 0 with only LF-to-CRLF normalization warnings.
- `.agent` secret-shape scan exited 1 with no output.
- Temp-file scan exited 1 with no output.
- Phase 2 gate still reports `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=incomplete_closure_tasks`, blockers `C1,C2,C3`, and `secretMatches=0`.

This reduces C2 operator confusion now that the local DeepSeek provider is already configured, but it does not satisfy C1, C2, or C3 by itself.

## DeepSeek test-key storage and wording verification on 2026-06-19 19:49:35 +08:00

Recorded the user-provided DeepSeek testing key only in the ignored local encrypted vault:

- `.agent/` is covered by `.gitignore`.
- `.agent/model-providers.json` keeps only provider metadata and an encrypted secret reference.
- `.agent/secrets.vault.json`, `.agent/secrets.key`, `.agent/model-providers.json`, and `.agent/TESTING-SECRETS.md` are ignored by Git.
- No plaintext API key, bearer token, or Authorization header shape was found in `.agent`.
- `soloclaw phase2 readiness` reports `ready_for_manual_run` for provider `deepseek`, model `deepseek-v4-flash`, and base URL `https://api.deepseek.com`.
- `soloclaw model check` reports the DeepSeek provider as ready with `apiKeySecretRef=configured`.
- `node dist\cli\index.js smoke --rich-tui-real-provider --workspace E:\code\agent` passed against the configured real provider and completed the read-only package.json task.

Verification run:

```powershell
npm.cmd run check
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase2 checklist|phase2 closeout-guide|phase2 readiness|phase2 launch-terminal" }
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 checklist|phase2 closeout-guide|phase2 external terminal launch" }
node dist\cli\index.js phase2 checklist
node dist\cli\index.js phase2 closeout-guide
node dist\cli\index.js phase2 launch-terminal --workspace E:\code\agent --print
node dist\cli\index.js phase2 gate --workspace E:\code\agent
node dist\cli\index.js phase2 readiness --workspace E:\code\agent --json
node dist\cli\index.js model check --workspace E:\code\agent
node dist\cli\index.js smoke --rich-tui-real-provider --workspace E:\code\agent
git check-ignore -v .agent .agent\model-providers.json .agent\secrets.vault.json .agent\secrets.key .agent\TESTING-SECRETS.md
git diff --check
rg -n --hidden --glob '!.git/**' 'sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|Authorization:' .agent
rg --files -g "*.tmp" -g "*.bak" -g "*.log" -g "*.old" -g "*.orig" -g "*.rej" -g "*.tsbuildinfo" -g "!.git/**" -g "!node_modules/**" -g "!.agent/tmp/**"
```

Result:

- TypeScript check passed.
- Phase 2 checklist, closeout-guide, readiness, and launch-terminal security tests passed.
- Rich TUI checklist, closeout-guide, and external terminal launch tests passed.
- Direct checklist, closeout-guide, launch-terminal, readiness, model-check, and real-provider smoke output matched the current C2 flow: run readiness first, skip `/model setup` unless readiness reports a problem, then run `/model check` and the read-only task.
- `git diff --check` exited 0 with only LF-to-CRLF normalization warnings.
- `.agent` secret-shape scan exited 1 with no output.
- Temp-file scan exited 1 with no output.
- Phase 2 gate still reports `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=incomplete_closure_tasks`, blockers `C1,C2,C3`, and `secretMatches=0`.

This proves the stored testing key is usable for automated real-provider preflight and remains outside Git, but it still does not replace the required manual C1/C2/C3 closeout observations.

## Remaining Phase 2 closeout plan as of 2026-06-19 19:49:35 +08:00

These tasks must stay unchecked until the operator has personally reviewed the evidence. Later Phase 3/3B real-provider gates and Phase 4A platform checks do not close these review tasks by themselves. Do not record API keys, key prefixes, bearer tokens, vault passphrases, or Authorization headers.

- [x] C1 external terminal rich TUI review
  - Run `soloclaw phase2 launch-terminal` from a real Windows Terminal or PowerShell window.
  - Confirm the dedicated Soloclaw screen renders, including workspace, active model, status rail, prompt cursor, and conversation area.
  - Confirm F2 cycles Plan/Build/Goal, Ctrl+P opens the command palette, arrow keys move selection, Space selects, Enter confirms, and Esc/Ctrl+C restore the cursor cleanly.
  - Preferred one-sitting closeout after all observations are done: `soloclaw phase2 closeout-wizard --all`.
  - Section-only path: record, review, and check paste-safe evidence with `soloclaw phase2 closeout-wizard --section C1`.
  - Use `soloclaw phase2 evidence-record --section C1` only as the lower-level fallback if the wizard is not usable.

- [x] C2 real-provider Soloclaw task review
  - Inside the same real Soloclaw screen, run `/phase2 readiness`.
  - If readiness reports a problem, run `/model setup`; otherwise skip setup.
  - Run `/model check`.
  - Ask: `Inspect package.json and report only the npm scripts whose names include test or check. Do not modify files.`
  - Confirm live progress rows appear, the final answer is visible, and no API key text is echoed.
  - Run the `.agent` leak scan from `soloclaw phase2 checklist`; record only pass/fail.
  - Preferred one-sitting closeout after all observations are done: `soloclaw phase2 closeout-wizard --all`.
  - Section-only path: record, review, and check paste-safe evidence with `soloclaw phase2 closeout-wizard --section C2`.
  - Use `soloclaw phase2 evidence-record --section C2` only as the lower-level fallback if the wizard is not usable.

- [x] C3 final automated gate review
  - After C1 and C2 are reviewed, run `soloclaw phase2 final-gate --workspace E:\code\agent`.
  - Confirm `npm.cmd run check`, `npm.cmd test`, `node dist\cli\index.js smoke --rich-tui`, `node dist\cli\index.js smoke --rich-tui-real-provider`, `git diff --check`, and temp-file scanning all pass or have only the documented LF-to-CRLF warnings.
  - Preferred one-sitting closeout after all observations are done: `soloclaw phase2 closeout-wizard --all`.
  - Section-only path: record, review, and check paste-safe evidence with `soloclaw phase2 closeout-wizard --section C3`.
  - Use `soloclaw phase2 evidence-record --section C3 --result "Final automated gate passed; see local terminal output"` only as the lower-level fallback if the wizard is not usable.
  - Run `node dist\cli\index.js phase2 evidence-check --workspace E:\code\agent --strict`.
  - Run `soloclaw phase2 gate --workspace E:\code\agent` and confirm it no longer reports C1/C2/C3 blockers.

## Phase 2 gate next-action precision on 2026-06-19 20:02:41 +08:00

Tightened the gate and next-action renderer so it no longer tells the operator to rerun C1/C2/C3 when dated evidence is already present and only manual review remains:

- `phase2 gate` now points C1/C2/C3 to the matching `soloclaw phase2 closure-task --section ... --confirm-reviewed` command when evidence is recorded but unchecked.
- `phase2 next` now shows the same review-first action as the review board for the first pending section.
- Real-provider setup guidance still appears when the real-provider readiness blocker is present.
- Added a regression test for recorded-but-unreviewed evidence.
- Updated rich TUI assertions so `/phase2 gate` and `/phase2 next` match the CLI behavior.

Verification run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase2 gate|phase2 next|phase2 review" }
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 gate|phase2 next|phase2 review" }
node dist\cli\index.js phase2 gate --workspace E:\code\agent
node dist\cli\index.js phase2 next --workspace E:\code\agent
npm.cmd run check
git diff --check
rg -n --hidden --glob '!.git/**' 'sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|Authorization:' .agent
rg --files -g "*.tmp" -g "*.bak" -g "*.log" -g "*.old" -g "*.orig" -g "*.rej" -g "*.tsbuildinfo" -g "!.git/**" -g "!node_modules/**" -g "!.agent/tmp/**"
node dist\cli\index.js phase2 launch-terminal --workspace E:\code\agent --print
```

Result:

- Security test group passed, including the new recorded-evidence gate regression.
- Rich TUI gate/next/review test group passed.
- Current workspace `phase2 gate` now reports blockers C1/C2/C3 with next actions to review saved evidence and run the matching closure-task commands.
- Current workspace `phase2 next` now points to C1 evidence review instead of rerunning `soloclaw phase2 launch-terminal`.
- TypeScript check passed.
- `git diff --check` exited 0 with only LF-to-CRLF normalization warnings.
- `.agent` secret-shape scan exited 1 with no output.
- Temp-file scan exited 1 with no output.
- Exact user-provided test key scan over workspace files outside `.git`, `node_modules`, and `dist` found no matches.
- `phase2 launch-terminal --print` still prints the external PowerShell launch command and manual closeout path.

This makes the closeout flow more precise, but C1/C2/C3 still require human review before their closure tasks are checked.

## Phase 2 evidence review and dated-evidence correction on 2026-06-19 20:28:21 +08:00

Added a safer evidence review path and corrected an evidence-gate false positive:

- Added `soloclaw phase2 evidence-show --section C1|C2|C3` with aliases `show-evidence` and `evidence-review`.
- Added rich TUI `/phase2 evidence C1` and `/phase2 evidence-show --section C1` so evidence can be reviewed inside the dedicated Soloclaw interface.
- The evidence review output redacts secret-looking API keys, bearer tokens, and passphrase assignments before display.
- `evidence-show` now reports `missing_dated_evidence` and points to `soloclaw phase2 evidence-record --section ...` when a section has only checklist text but no dated evidence.
- Fixed strict evidence extraction so older progress-log text mentioning C1/C2/C3 with dates is not misread as human closure evidence.
- Current workspace gate is now stricter and more accurate: it reports `strictEvidence=missing_dated_evidence`, not `incomplete_closure_tasks`, because C1/C2/C3 still need formal dated evidence entries before review.

Verification run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase2 evidence-show|old progress notes" }
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "safe phase2 evidence section" }
node dist\cli\index.js phase2 gate --workspace E:\code\agent
node dist\cli\index.js phase2 next --workspace E:\code\agent
node dist\cli\index.js phase2 evidence-show --workspace E:\code\agent --section C1
node dist\cli\index.js phase2 review --workspace E:\code\agent
npm.cmd run check
git diff --check
rg -n --hidden --glob '!.git/**' 'sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|Authorization:' .agent
rg --files -g "*.tmp" -g "*.bak" -g "*.log" -g "*.old" -g "*.orig" -g "*.rej" -g "*.tsbuildinfo" -g "!.git/**" -g "!node_modules/**" -g "!.agent/tmp/**"
```

Result:

- Security test group passed, including evidence-show, secret redaction, and the old-progress-notes false-positive regression.
- Rich TUI evidence section test passed.
- TypeScript check passed.
- Current `phase2 gate` reports C1/C2/C3 blockers with `strictEvidence=missing_dated_evidence`.
- Current `phase2 next` points to C1 external-terminal observation and `soloclaw phase2 evidence-record --section C1`.
- Current `phase2 evidence-show --section C1` reports `status=missing_dated_evidence` and `next=soloclaw phase2 evidence-record --section C1`.
- Current `phase2 review` reports C1/C2/C3 as `evidence=undated review=waiting_for_evidence`.
- `git diff --check` exited 0 with only LF-to-CRLF normalization warnings.
- `.agent` secret-shape scan exited 1 with no output.
- Temp-file scan exited 1 with no output.

This deliberately moves the gate backward from "review saved evidence" to the more truthful state: C1/C2/C3 still need dated manual evidence entries before any closure-task command should be run.

## Phase 2 non-launch preflight after interrupted turn on 2026-06-19 20:58:11 +08:00

After an interrupted continuation, rechecked the current state without opening a new terminal window:

- No active Soloclaw rich TUI process was found from the interrupted turn.
- `phase2 gate --json` still reports `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=missing_dated_evidence`, and blockers `C1,C2,C3`.
- `phase2 next` points to C1 external-terminal observation and `soloclaw phase2 evidence-record --section C1`.
- `phase2 launch-terminal --print` prints the PowerShell launch command without opening a window.
- `smoke --rich-tui` passed with `ok=true` and saw `welcome,mode,input,progress,answer,context,resume,phase2,evidence-record,evidence-check,exit`.
- `smoke --rich-tui-real-provider` passed with DeepSeek, `readiness=ready_for_manual_run`, and saw `welcome,readiness,input,progress,answer,exit`.
- `model check` reports provider `deepseek`, model `deepseek-v4-flash`, base URL `https://api.deepseek.com`, and `apiKeySecretRef=configured`.

Verification run:

```powershell
node dist\cli\index.js phase2 gate --workspace E:\code\agent --json
node dist\cli\index.js phase2 next --workspace E:\code\agent
node dist\cli\index.js phase2 launch-terminal --workspace E:\code\agent --print
node dist\cli\index.js smoke --rich-tui --workspace E:\code\agent
node dist\cli\index.js smoke --rich-tui-real-provider --workspace E:\code\agent
node dist\cli\index.js model check --workspace E:\code\agent
npm.cmd run check
git diff --check
rg -n --hidden --glob '!.git/**' 'sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|Authorization:' .agent
```

Result:

- TypeScript check passed.
- `git diff --check` exited 0 with only LF-to-CRLF normalization warnings.
- `.agent` secret-shape scan exited 1 with no output.
- Exact user-provided test key scan over workspace files outside `.git`, `node_modules`, and `dist` found no matches.

This keeps the C1/C2 path ready, but it does not satisfy C1/C2/C3: no real external terminal observation was recorded, no dated manual evidence was added, and no closure task was checked.

## Phase 2 operator-runbook helper on 2026-06-19 21:10:03 +08:00

Added a one-sitting closeout helper so the operator does not have to piece together C1/C2/C3 from several separate commands:

- Added `soloclaw phase2 operator-runbook` with alias `soloclaw phase2 runbook`.
- Added rich TUI `/phase2 operator-runbook` with alias `/phase2 runbook`.
- The runbook prints current workspace, gate status, strict evidence status, blockers, active provider, model, base URL, and readiness guidance.
- The C2 guidance now reflects the current DeepSeek readiness state: skip `/model setup` unless `/phase2 readiness` reports a problem.
- The runbook includes the external terminal launch command, C1 visual checks, C2 real-provider commands, C1/C2 evidence-record commands, evidence-show review commands, C3 final-gate commands, and the final strict evidence/gate checks.
- Added CLI and rich TUI regression tests to ensure the runbook remains paste-safe and does not include secret-looking API keys, bearer tokens, vault passphrases, or authorization headers.

Verification run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "operator-runbook|operator runbook"; node --test dist\__tests__\rich-tui.test.js --test-name-pattern "operator runbook" }
node dist\cli\index.js phase2 operator-runbook --workspace E:\code\agent
node dist\cli\index.js phase2 gate --workspace E:\code\agent --json
```

Result:

- The new CLI operator-runbook regression passed.
- The new rich TUI operator-runbook regression passed.
- `phase2 operator-runbook` now shows the current DeepSeek path as `ready_for_manual_run` and lists the C1/C2/C3 commands in execution order.
- The current gate still truthfully reports `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=missing_dated_evidence`, and blockers `C1,C2,C3`.

This reduces closeout friction, but it still does not satisfy C1, C2, or C3: no real external terminal observation was recorded, no dated manual evidence was added, and no closure task was checked.

## Phase 2 closeout-wizard helper on 2026-06-19 21:30:43 +08:00

Added an interactive closeout helper for the remaining manual evidence path:

- Added `soloclaw phase2 closeout-wizard --section C1|C2|C3` with alias `soloclaw phase2 evidence-wizard`.
- The wizard asks the operator to confirm the matching manual observation before writing any evidence.
- It records dated evidence through the existing `recordPhaseTwoEvidence` path, so secret-looking text is rejected before writing.
- It displays the saved evidence through the existing redacted `evidence-show` path.
- It only checks the requested closure task after the operator types yes to confirm they personally reviewed the displayed evidence.
- Added stable non-TTY input handling so the wizard can be tested or scripted without readline losing buffered input.
- Added rich TUI `/phase2 closeout-wizard` as a guide that points to the outer-terminal wizard commands.
- Updated checklist, closeout-guide, and operator-runbook output so the guided C1/C2/C3 path is discoverable.
- Added CLI tests for successful C1 evidence record + review + closure, and for secret-looking evidence rejection without echoing the secret.
- Added rich TUI coverage for the closeout-wizard guide.

Verification run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "closeout-wizard" }
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase2 checklist|phase2 closeout-guide|operator-runbook|closeout-wizard|evidence-record|closure-task|evidence-show"; node --test dist\__tests__\rich-tui.test.js --test-name-pattern "closeout wizard|closeout guide|operator runbook" }
node dist\cli\index.js phase2 operator-runbook --workspace E:\code\agent
node dist\cli\index.js phase2 gate --workspace E:\code\agent --json
```

Result:

- The closeout-wizard tests passed.
- Phase 2 checklist, closeout-guide, operator-runbook, evidence-record, closure-task, and evidence-show test group passed.
- Rich TUI closeout wizard, closeout guide, and operator-runbook test group passed.
- `phase2 operator-runbook` now lists `soloclaw phase2 closeout-wizard --section C1`, `--section C2`, and `--section C3`.
- The current gate still truthfully reports `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=missing_dated_evidence`, and blockers `C1,C2,C3`.

This makes the manual closeout path safer and shorter, but it still does not satisfy C1, C2, or C3 by itself: the operator still must observe the real terminal, run the real-provider task, run the final gate, and type confirmations in the wizard.

## Phase 2 next/review wizard routing on 2026-06-19 21:42:07 +08:00

Tightened the closeout guidance now that `closeout-wizard` exists:

- `phase2 next` now recommends `soloclaw phase2 closeout-wizard --section C1` when C1 evidence is missing or undated, instead of pointing to the lower-level `evidence-record` command.
- `phase2 review` now lists `closeout-wizard` as the next command for C1/C2/C3 sections that still need dated evidence.
- Gate next actions still preserve the separate review path when dated evidence already exists: recorded-but-unchecked sections continue to point to `closure-task --confirm-reviewed`.
- Added CLI and rich TUI regressions for the missing-dated-evidence path so the guidance does not drift back to the lower-level command.

Verification run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "next and review prefer closeout-wizard"; node --test dist\__tests__\rich-tui.test.js --test-name-pattern "prefers closeout-wizard" }
node dist\cli\index.js phase2 next --workspace E:\code\agent
node dist\cli\index.js phase2 review --workspace E:\code\agent
```

Result:

- The new CLI next/review wizard-routing regression passed.
- The new rich TUI next wizard-routing regression passed.
- Current `phase2 next` now says: run `soloclaw phase2 launch-terminal`, verify the real Soloclaw TTY, then run `soloclaw phase2 closeout-wizard --section C1`.
- Current `phase2 review` now shows `next=soloclaw phase2 closeout-wizard --section C1|C2|C3` for undated evidence sections.

This improves the operator path but still does not satisfy C1/C2/C3: the manual observations and wizard confirmations have not been performed in the real terminal.

## Phase 2 readiness closeout-wizard guidance on 2026-06-19 21:57:56 +08:00

Refreshed the local DeepSeek test key and tightened the remaining Phase 2 guidance:

- Refreshed the workspace-local encrypted DeepSeek secret and updated the local `deepseek` profile to use the new secret ref.
- Confirmed `.agent/` remains ignored by Git; the local testing note records only the active secret ref, never plaintext.
- `phase2 readiness` now includes `nextCommands.closeoutWizard` in JSON output.
- `phase2 readiness` text output now recommends `soloclaw phase2 closeout-wizard --section C1|C2|C3` for evidence recording/review, while keeping `evidence-template` as paste-safe reference material.
- Rich TUI `/phase2 readiness` receives the same shared wording through `renderPhaseTwoRealProviderReadiness`.
- Updated the remaining closeout plan to make `closeout-wizard` the preferred path and `evidence-record` only the lower-level fallback.

Verification run:

```powershell
npm.cmd run build
node --test dist\__tests__\security.test.js --test-name-pattern "phase2 readiness"
node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 real-provider readiness"
npm.cmd run check
node dist\cli\index.js smoke --rich-tui --workspace E:\code\agent
node dist\cli\index.js smoke --rich-tui-real-provider --workspace E:\code\agent
node dist\cli\index.js phase2 readiness --workspace E:\code\agent --json
git diff --check
git check-ignore -v .agent\TESTING-SECRETS.md .agent\secrets.vault.json .agent\model-providers.json .agent\secrets.key
node dist\cli\index.js phase2 gate --workspace E:\code\agent --json
```

Result:

- Build and TypeScript check passed.
- The readiness regression tests passed after first failing against the missing `closeoutWizard` guidance.
- Mock rich TUI smoke passed with `ok=true` and saw `welcome,mode,input,progress,answer,context,resume,phase2,evidence-record,evidence-check,exit`.
- Real-provider rich TUI smoke passed with DeepSeek, `readiness=ready_for_manual_run`, and saw `welcome,readiness,input,progress,answer,exit`.
- `phase2 readiness --json` reports `activeProvider=deepseek`, `model=deepseek-v4-flash`, `apiKeySecretRef=configured`, `secretLeakScan=pass`, and `nextCommands.closeoutWizard`.
- `git diff --check` exited 0 with only LF-to-CRLF normalization warnings.
- The exact plaintext DeepSeek key scan over workspace files outside `.git`, `node_modules`, and `dist` found zero matches.
- `phase2 gate --json` still exits 1 as expected with `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=missing_dated_evidence`, blockers `C1,C2,C3`, and `secretMatches=0`.

This keeps the project ready for manual C1/C2/C3 closeout, but it still does not satisfy those sections: the operator must run the real external terminal, observe the real-provider task, run the final gate after C1/C2, and confirm each section through `closeout-wizard`.

## Phase 2 wizard-first closeout consistency on 2026-06-19 22:11:56 +08:00

Cleaned up the remaining confusing closeout guidance so the operator path consistently prefers `closeout-wizard`:

- `phase2 evidence-show --section C1|C2|C3` now points missing/undated evidence to `soloclaw phase2 closeout-wizard --section ...` instead of the lower-level `evidence-record` command.
- `phase2 final-gate --print` now tells the operator to record, review, and check C3 through `soloclaw phase2 closeout-wizard --section C3`.
- `phase2 final-gate --print` still documents `evidence-record` as a fallback manual command, but labels it as fallback only.
- `phase2 operator-runbook` now labels C1/C2 manual `evidence-record` commands as fallback commands and gives the same fallback treatment to C3.
- The active C1/C2/C3 checklist text in this plan was updated to match the wizard-first flow.

Verification run:

```powershell
npm.cmd run build
node --test dist\__tests__\security.test.js --test-name-pattern "evidence-show points|final-gate print|operator-runbook"
node --test dist\__tests__\rich-tui.test.js --test-name-pattern "phase2 final-gate command plan"
node dist\cli\index.js phase2 final-gate --workspace E:\code\agent --print
node dist\cli\index.js phase2 operator-runbook --workspace E:\code\agent
node dist\cli\index.js phase2 evidence-show --workspace E:\code\agent --section C1
```

Result:

- Build passed.
- The CLI regression group passed and covered evidence-show, final-gate, and operator-runbook.
- The rich TUI final-gate regression passed.
- Direct output now shows `closeout-wizard` as the primary path and marks `evidence-record` as fallback where it remains visible.
- C1/C2/C3 still remain incomplete because the required real external-terminal observations and wizard confirmations have not been performed.

## Phase 2 final-gate Windows command execution on 2026-06-19 22:27:40 +08:00

Fixed the remaining automated closeout blocker in `phase2 final-gate` on Windows:

- Root cause: Node v24 on this Windows host throws synchronous `spawn EINVAL` when `spawn("npm.cmd", ..., { shell: false })` is used directly.
- Confirmed ordinary executables like `node` and `git` still work with `shell: false`; only `.cmd`/`.bat` steps need a Windows command shim.
- Added a Windows-only final-gate regression that creates a fake `npm.cmd` and proves the final-gate runner can execute `.cmd` steps without `spawn EINVAL`.
- Updated the final-gate command runner so Windows `.cmd`/`.bat` steps execute through `cmd.exe /d /s /c`, while normal executables keep the existing direct spawn path.
- Updated successful final-gate output so C3 points first to `soloclaw phase2 closeout-wizard --section C3`; the lower-level `evidence-record` command remains visible only as fallback.

Verification run:

```powershell
npm.cmd run build
node --test dist\__tests__\security.test.js --test-name-pattern "final-gate executes Windows cmd"
node dist\cli\index.js phase2 final-gate --workspace E:\code\agent
node dist\cli\index.js phase2 gate --workspace E:\code\agent --json
```

Result:

- Build passed.
- The new regression first failed against the old `spawn EINVAL` behavior, then passed after the command shim fix.
- The focused security test run reported 336/336 passing tests.
- The real `phase2 final-gate` now exits 0 and reports `status=pass`.
- Final-gate checks passed: `typecheck`, full `npm.cmd test` with 426/426 tests, mock rich TUI smoke, real-provider DeepSeek rich TUI smoke, `git diff --check`, and the temp-file scan.
- Successful final-gate output now says `Next: soloclaw phase2 closeout-wizard --section C3`.
- Current `phase2 gate --json` still correctly exits 1 with `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=missing_dated_evidence`, blockers `C1,C2,C3`, and `secretMatches=0`.

This removes the automated C3 runner bug, but it still does not satisfy C1/C2/C3: the operator must run the real external terminal, observe the real-provider task, run C3 in order, and confirm each section through `closeout-wizard`.

## Phase 2 one-sitting closeout wizard on 2026-06-19 22:37:51 +08:00

Reduced the remaining manual closeout friction without fabricating any evidence:

- Added `soloclaw phase2 closeout-wizard --all`, with positional alias `soloclaw phase2 closeout-wizard all`.
- `--all` walks C1, C2, and C3 in order through the same existing safe flow: confirm observation, collect paste-safe fields, record dated evidence, show the redacted evidence back, and check the closure task only after explicit review confirmation.
- The single-section commands still work for operators who want to record C1, C2, or C3 separately.
- Updated the rich TUI closeout-wizard guide so `/phase2 closeout-wizard` shows the new `--all` command.
- Updated `phase2 next` / rich TUI next-action guidance so the immediate C1 action still stays concrete, while also advertising `soloclaw phase2 closeout-wizard --all` for one-sitting closeout after all observations are ready.
- Updated the active manual closeout instructions in this plan to prefer `--all` after all observations are ready, while keeping section-only and lower-level fallback commands visible.

Verification run:

```powershell
npm.cmd run build
node --test dist\__tests__\security.test.js --test-name-pattern "closeout-wizard can walk all"
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "closeout wizard guide" }
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "next and review prefer closeout-wizard"; node --test dist\__tests__\rich-tui.test.js --test-name-pattern "prefers closeout-wizard" }
```

Result:

- Build passed.
- The new `--all` regression first failed with `Unknown phase2 closeout-wizard option: --all`, then passed after implementation.
- The focused security test run reported 337/337 passing tests and proved `--all` checks C1, C2, and C3 on a temporary plan after explicit confirmations.
- The rich TUI guide regression reported 71/71 passing tests and now requires `soloclaw phase2 closeout-wizard --all` to appear in the guide.
- The next-action regression first failed until `phase2 next` included `soloclaw phase2 closeout-wizard --all`, then passed for both CLI and rich TUI.
- This still does not satisfy C1/C2/C3 for the real workspace. The operator must still make the real external-terminal observations, run the real-provider task, run the final gate in order, and type the `--all` confirmations themselves.

## Phase 2 closeout command visibility pass on 2026-06-19 22:59:03 +08:00

Finished the consistency pass for the one-sitting closeout helper:

- `phase2 status --json` and the text status now expose `closeoutWizardAll=soloclaw phase2 closeout-wizard --all`.
- `phase2 readiness --json` and the text readiness now expose the same one-sitting closeout command while keeping the section-by-section command for compatibility.
- `phase2 checklist` now lists both the one-sitting closeout command and the section-by-section guided evidence command.
- The configured real provider remains DeepSeek with `model=deepseek-v4-flash`, `baseUrl=https://api.deepseek.com`, and an encrypted local secret reference.
- `.agent/` remains git-ignored, and the local secret-shape scan found 0 raw API-key, bearer-token, or passphrase-assignment matches.

Verification run:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "phase2 checklist|phase2 readiness|phase2 status" }
node --test dist\__tests__\rich-tui.test.js --test-name-pattern "closeout wizard guide|prefers closeout-wizard"
npm.cmd run check
node dist\cli\index.js model check --workspace E:\code\agent --json
git check-ignore -v .agent\TESTING-SECRETS.md .agent\secrets.vault.json .agent\model-providers.json .agent\secrets.key
node dist\cli\index.js phase2 gate --workspace E:\code\agent --json
git diff --check
```

Result:

- Build passed.
- The focused CLI regression first failed because status, readiness, and checklist did not show `--all`; it now reports 337/337 passing tests.
- The rich TUI closeout guidance regression reports 71/71 passing tests.
- `npm.cmd run check` passed.
- `npm.cmd test` passed with 427/427 tests.
- `model check` reports `ready=true`, provider `deepseek`, and `usesApiKeySecretRef=true`.
- Git ignore checks confirm the local testing-secret and vault files stay under ignored `.agent/`.
- `phase2 gate --json` still correctly exits 1 with `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=missing_dated_evidence`, blockers `C1,C2,C3`, and `secretMatches=0`.
- `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings and no whitespace errors.

Remaining blocker is unchanged: the user/operator still needs to run and record real C1, C2, and C3 evidence, then use `soloclaw phase2 closeout-wizard --all` to review and check the closure tasks.

## External Soloclaw terminal launch on 2026-06-20 00:03:57 +08:00

Opened a fresh external PowerShell/Soloclaw window for the remaining manual C1/C2 verification path:

```powershell
node dist\cli\index.js phase2 launch-terminal --workspace E:\code\agent
```

Result:

- Launcher exited 0 with `launched=true`.
- The launched parent process was `powershell.exe` pid `26888`.
- Follow-up process inspection showed the parent still alive with a `node.exe` child running `dist\cli\index.js`.
- This confirms the real-terminal entry point is open for operator observation, but it does not satisfy C1 or C2 by itself.

Next operator actions in that external window:

1. Confirm C1 rendering, cursor restore, `F2` mode cycling, `ctrl+p` command palette, arrow/Space/Enter behavior, and exit behavior.
2. Run `/phase2 readiness`; it should be ready for DeepSeek unless local config changes.
3. Run `/model check`.
4. Ask the read-only package task: `Inspect package.json and report only the npm scripts whose names include test or check. Do not modify files.`
5. After C1/C2/C3 observations are all available, run `soloclaw phase2 closeout-wizard --all` and record paste-safe evidence only.

Do not record API keys, key prefixes, bearer tokens, vault passphrases, or Authorization headers.

## External terminal visual inspection on 2026-06-20 00:16:55 +08:00

Captured and inspected a real Windows Terminal/Soloclaw window without recording secrets:

- Screenshot artifact: `.agent/tmp/soloclaw-window-20260620-visual.png` (ignored by git).
- Direct window capture artifact: `.agent/tmp/soloclaw-window-direct-12124440.png` (ignored by git).
- Visible UI: Soloclaw welcome/conversation surface rendered in Windows Terminal, with the Soloclaw logo, input area, shortcut hints, and status row.
- Visible status row: `Build - deepseek deepseek-v4-flash - pass - E:\code\agent`.
- `/phase2 readiness` was executed in the external terminal via clipboard paste after direct key sending dropped the `2 ` characters from `/phase2 readiness`.
- Direct window capture showed readiness output: `status=ready_for_manual_run`, `activeProvider=deepseek`, `model=deepseek-v4-flash`, `baseUrl=https://api.deepseek.com`, `realProviderConfigured=pass`, `apiKeyReference=pass`, `secretStorage=pass`, and `secretLeakScan=pass`.
- Node version for the workspace shell is `v24.13.1`.

This is useful C1/C2 preflight evidence, but it is intentionally not marked as C1 or C2 closure evidence. The following still require real operator observation before checking any closure task:

- C1: `F2` mode cycling, `ctrl+p` command palette, arrow/Space/Enter selection, typed input behavior, and Escape/Ctrl+C cursor restore.
- C2: `/model check` and one real-provider read-only natural-language task observed through the external Soloclaw terminal.
- C3: final automated gate after C1 and C2 have been reviewed.

Additional automation findings:

- `WScript.Shell.SendKeys('/phase2 readiness')` was unreliable: it displayed `/phasereadiness`, dropping the `2 ` characters.
- Clipboard paste into the already-focused Soloclaw terminal successfully submitted `/phase2 readiness`.
- Later attempts to force-focus the Windows Terminal window from the hosted shell were blocked by the desktop focus rules; foreground remained on another window.
- Traditional `AttachConsole` / `WriteConsoleInput` did not work against the Windows Terminal pseudoconsole and returned invalid handle.

Practical next step: the operator should use the visible external Soloclaw window directly for the remaining C1/C2 checks, then run `soloclaw phase2 closeout-wizard --all`.

## External terminal title hardening on 2026-06-20 00:26:52 +08:00

Improved the C1/C2 launch path so the external Soloclaw terminal is easier to identify for the operator and for screenshot-based verification:

- `soloclaw phase2 launch-terminal --print` now prints `windowTitle=Soloclaw Phase 2 - <workspace>`.
- The printed and launched PowerShell command now sets `[Console]::Title = 'Soloclaw Phase 2 - <workspace>'` before changing directory and starting `node dist\cli\index.js`.
- The launch output still shows the exact command and the same manual C1/C2 closeout path.
- Direct launch on this workspace returned `pid=27068`.
- Window enumeration found a visible `CASCADIA_HOSTING_WINDOW_CLASS` window titled `Soloclaw Phase 2 - E:\code\agent`.
- Screenshot artifact: `.agent/tmp/soloclaw-window-20260620-titled.png` (ignored by git).
- The screenshot shows the Soloclaw welcome screen, prompt area, shortcut hints, and `Build - deepseek deepseek-v4-flash - pass - E:\code\agent`.

TDD and verification:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\security.test.js --test-name-pattern "launch-terminal prints" }
node dist\cli\index.js phase2 launch-terminal --workspace E:\code\agent --print
npm.cmd run check
git diff --check
```

Result:

- The focused regression first failed because the old launch output did not include `windowTitle` and did not set `[Console]::Title`.
- After implementation, the focused regression reported 337/337 passing tests.
- The direct `--print` output includes `windowTitle=Soloclaw Phase 2 - E:\code\agent` and the title-setting PowerShell command.
- `npm.cmd run check` passed.
- `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings and no whitespace errors.

This improves C1 discoverability and future screenshot reliability, but it still does not satisfy C1/C2/C3. The operator must still perform the real keyboard checks, `/model check`, the real-provider read-only task, and the guided closeout confirmations.

## Automated baseline refresh on 2026-06-20 00:41:22 +08:00

Refreshed the Phase 2 state without changing implementation or recording secrets:

- `npm.cmd run check` exited 0.
- `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,phase2,evidence-record,evidence-check,exit`.
- `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings and no whitespace errors.
- `node dist\cli\index.js phase2 readiness --workspace E:\code\agent --json` exited 0 with `status=ready_for_manual_run`, `activeProvider=deepseek`, `model=deepseek-v4-flash`, `baseUrl=https://api.deepseek.com`, and `secretLeakScan=pass`.
- `node dist\cli\index.js model check --workspace E:\code\agent --json` exited 0 with `ready=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `baseUrl=https://api.deepseek.com`, and `usesApiKeySecretRef=true`.
- `node dist\cli\index.js smoke --rich-tui-real-provider` exited 0 with DeepSeek and `saw=welcome,readiness,input,progress,answer,exit`; the scripted read-only package task returned an answer and session `sess_fzki0xjt`.
- A local `.agent` secret-shape scan found 0 plaintext API-key, bearer-token, or passphrase assignment matches.
- `.agent/` is ignored by `.gitignore`, including `.agent\TESTING-SECRETS.md`, `.agent\secrets.vault.json`, `.agent\model-providers.json`, and `.agent\tmp\*.png`.
- Temp-file scan outside `.git`, `.agent`, `dist`, and `node_modules` found no `.tmp`, `.bak`, `.log`, `.old`, `.orig`, `.rej`, or `.tsbuildinfo` files.

Workspace dirt remains intentional Phase 2 implementation state. The modified tracked files and untracked Phase 2 modules are not cleanup candidates unless the implementation direction changes.

The user requested a TUI redesign that does not look immediately like opencode. A Soloclaw-specific `Work Ledger` direction has been proposed: remove the centered logo/input and right rail, use a top status strip, `MISSION / LEDGER / CHECKS` main area, safe folded activity rows, and a bottom input dock. Implementation is intentionally pending explicit user approval because it changes the visual direction.

This refresh still does not satisfy C1/C2/C3. The gate correctly remains blocked until the operator records real external-terminal C1 evidence, real rich-TUI C2 evidence, then C3 final-gate evidence through `soloclaw phase2 closeout-wizard --all`.

## Work Ledger TUI differentiation on 2026-06-20 01:12:10 +08:00

Implemented the approved Soloclaw-specific Work Ledger visual pass:

- Replaced the centered welcome logo and centered prompt box with a top `SOLOCLAW Workbench` strip and bottom `INPUT DOCK`.
- Replaced the conversation right rail with in-flow `MISSION`, `LEDGER`, and `CHECKS` sections.
- Kept run health, activity, context, model, LSP, workspace, session, resume guidance, and Plan approval status visible in `CHECKS`.
- Kept command output, raw patches, tool inputs, and secrets folded/hidden by default; the existing event renderer and redaction path remain in use.
- Adjusted ledger block fitting so long system command results keep their heading/status lines visible, while older projected progress cannot hide fresh command output.
- Updated the rich TUI smoke to wait for the new `INPUT DOCK` marker and for resume completion before typing the next command.

TDD evidence:

- The Work Ledger tests were written first and failed against the old layout because `SOLOCLAW Workbench`, `MISSION`, `LEDGER`, and `CHECKS` were missing and the old `Ask anything` prompt/logo remained.
- After implementation, the focused rich TUI test run reported 71/71 passing tests.

Verification:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node --test dist\__tests__\rich-tui.test.js --test-name-pattern "workbench|work ledger|phase2|context unavailable|transcript scroll" }
npm.cmd run build; if ($LASTEXITCODE -eq 0) { node dist\cli\index.js smoke --rich-tui }
node dist\cli\index.js smoke --rich-tui-real-provider
npm.cmd test
npm.cmd run check
git diff --check
node dist\cli\index.js phase2 gate --workspace E:\code\agent --json
```

Result:

- Focused rich TUI test run passed with 71/71 tests.
- `node dist\cli\index.js smoke --rich-tui` exited 0 with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,phase2,evidence-record,evidence-check,exit`.
- `node dist\cli\index.js smoke --rich-tui-real-provider` exited 0 with DeepSeek, `readiness=ready_for_manual_run`, `saw=welcome,readiness,input,progress,answer,exit`, and session `sess_n8h34jki`.
- `npm.cmd test` passed with 427/427 tests.
- `npm.cmd run check` exited 0.
- `git diff --check` exited 0 with only existing LF-to-CRLF conversion warnings and no whitespace errors.
- `phase2 gate --json` still correctly exits 1 with `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=missing_dated_evidence`, blockers `C1,C2,C3`, and `secretMatches=0`.

U7 is complete by automated evidence. C1/C2/C3 remain incomplete because they require real external-terminal observation, real user-path rich-TUI evidence, and final gate evidence recorded through `soloclaw phase2 closeout-wizard --all`.

## Tafang plan/build/goal real-project verification on 2026-06-20 02:36:42 +08:00

Verified the three Soloclaw task modes against the real game workspace `E:\code\tafang` instead of only the agent repository:

- `plan` mode session `sess_qdwnnt5v` inspected the task and produced a visible final answer without using tools or modifying files; `session verify` passed.
- `build` mode session `sess_b1zaexth` made a tiny reversible edit to `index.html`, verified it through a local-safe Node check, and produced a visible final answer; `session verify` passed. The smoke edit was then removed.
- `goal` mode session `sess_z30whzfo` inspected `index.html` and `js/config.js`, created `.agent/tmp/soloclaw-goal-tafang-smoke.txt`, verified it through a local-safe Node check, and produced a visible final answer; `session verify` passed. The temporary file was then removed.

Cleanup evidence for `E:\code\tafang`:

- `index.html` SHA256 after cleanup: `575E84A8BAC01490827B1426EABB64F9D328C31C07FADBA2C963E8A3D98E3A28`.
- The temporary marker `soloclaw-build-tafang-smoke` is absent.
- `.agent/tmp/soloclaw-goal-tafang-smoke.txt` is absent.

Related fixes verified by this run:

- `.agent/tmp` is allowed for local workspace temporary files without triggering a high-risk shell approval.
- Build/goal prompts now require successful verification commands to exit `0` only when the target is actually satisfied.
- Non-`apply_patch` file changes now contribute lightweight diff/review evidence.
- Empty assistant final answers are no longer accepted silently; the loop asks once for a visible final response, and `session verify` fails empty final answers.

Automated verification after the `tafang` run:

- `npm.cmd test` passed with 434/434 tests.
- `npm.cmd run check` exited 0.
- `node dist\cli\index.js smoke --rich-tui` exited 0.
- `node dist\cli\index.js smoke --rich-tui-real-provider` exited 0 with DeepSeek, session `sess_co3ntlsg`.
- `node dist\cli\index.js smoke --rich-tui-real-provider-long-task --workspace E:\code\agent` exited 0 with DeepSeek, session `sess_fzayv9sx`, `events=1334`, and `toolEvents=14`.
- `git diff --check` exited 0 with only existing LF-to-CRLF warnings.
- `phase2 gate --json` still correctly reports `status=blocked_manual_evidence`, `strictEvidence=missing_dated_evidence`, blockers `C1,C2,C3`.

This confirms `plan`, `build`, and `goal` are effective on a real target workspace and that scripted long-task rich-TUI execution works with the configured real provider. It still does not complete C1/C2/C3 because those require operator-observed external-terminal evidence and final closeout through `soloclaw phase2 closeout-wizard --all`.

## Fresh tafang mode rerun and long-task smoke on 2026-06-20 02:46:49 +08:00

Re-ran the `plan`, `build`, and `goal` checks against `E:\code\tafang` with the target workspace's configured DeepSeek profile. Session verification must be launched from the target workspace directory for these target-workspace sessions; placing `--workspace` before `session verify` enters the rich TUI instead of verifying the session.

Fresh `tafang` mode results:

- `model check --workspace E:\code\tafang --json` reported `ready=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `baseUrl=https://api.deepseek.com`, and `usesApiKeySecretRef=true`.
- `plan` mode session `sess_x7mmiuhu` produced a visible read-only implementation plan with `modelCalls=1`, no tool calls, no file changes, and `session verify --allow-no-command --json` returned `status=pass`.
- `build` mode session `sess_dk3reeb5` inserted `<!-- soloclaw-build-smoke-20260620 -->` into `index.html`, verified it with a local-safe PowerShell command, produced a visible final answer, and `session verify --require-change --require-diff-stat --require-model-call --json` returned `status=pass`.
- `build` recovery behavior was also exercised: the first Unix-style `head -5 index.html` command failed on Windows, then the agent recovered with a PowerShell `Get-Content` command and completed the task.
- `goal` mode session `sess_aqlykpyt` read `index.html` and `js/config.js`, created `.agent/tmp/soloclaw-goal-smoke-20260620.txt`, verified the content with a local-safe command, produced a visible final answer, and `session verify --require-change --require-diff-stat --require-model-call --json` returned `status=pass`.
- `goal` recovery behavior was exercised: the Unix-style `mkdir -p .agent/tmp` command failed on Windows, then the agent recovered and completed the task.

Fresh cleanup evidence for `E:\code\tafang`:

- `index.html` SHA256 after cleanup: `575E84A8BAC01490827B1426EABB64F9D328C31C07FADBA2C963E8A3D98E3A28`.
- `Select-String` confirmed `soloclaw-build-smoke-20260620` is absent from `index.html`.
- `Test-Path .agent\tmp\soloclaw-goal-smoke-20260620.txt` returned `False`.
- A top-level smoke/temp scan found no `.bak`, `.tmp`, `.old`, `.orig`, `.rej`, or `*smoke*` residue in `E:\code\tafang`.

Fresh long-task rich-TUI real-provider smoke:

- `node dist\cli\index.js smoke --rich-tui-real-provider-long-task --workspace E:\code\agent` exited 0.
- Result: `ok=true`, `provider=deepseek`, `model=deepseek-v4-flash`, `readiness=ready_for_manual_run`, session `sess_iioqp6xh`, `events=1152`, `toolEvents=22`.
- The scripted task was read-only and inspected multiple Soloclaw files before returning an answer preview, so the event stream and progress projection were exercised on a non-trivial task.

Additional finding:

- Running several target-workspace session checks concurrently can produce a transient SQLite `database is locked` error. The reliable operator path is to run session verification sequentially from the target workspace directory.

This fresh rerun strengthens the automated evidence that `plan`, `build`, and `goal` are real and that the long-task event stream works with the live configured provider. Later closeout evidence on 2026-06-21 completed C1/C2/C3 and moved `phase2 gate` to `ready_for_completion`.

## Final automated sweep on 2026-06-20 02:46:49 +08:00

After restoring the active Soloclaw workspace back to `E:\code\agent`, ran the final automated sweep:

- `node dist\cli\index.js workspace use E:\code\agent` restored the active workspace.
- `node dist\cli\index.js smoke --rich-tui --workspace E:\code\agent` exited 0 with `ok=true` and `saw=welcome,mode,input,progress,answer,context,resume,phase2,evidence-record,evidence-check,exit`.
- `npm.cmd run check` exited 0.
- `npm.cmd test` passed with 434/434 tests.
- `git diff --check` exited 0 with only existing LF-to-CRLF warnings on tracked files.
- `phase2 gate --workspace E:\code\agent --json` still exits 1 by design with `status=blocked_manual_evidence`, `realProviderReadiness=ready_for_manual_run`, `strictEvidence=missing_dated_evidence`, blockers `C1,C2,C3`, and `secretMatches=0`.

No Git commit or staging was performed.

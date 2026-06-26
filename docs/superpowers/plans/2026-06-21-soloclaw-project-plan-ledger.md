# Soloclaw Project Plan Ledger

> **For agentic workers:** This is the current plan index, not a feature implementation plan. Use it to choose the next open plan before changing source code. Do not mark a plan or smoke target complete without fresh evidence in the referenced plan or support document.

**Goal:** Keep all active Soloclaw plans reconciled with the current working tree.

**Architecture:** Completed implementation plans stay in their original files with closeout evidence. Open work is tracked here as a short ledger that points to the source plan and the exact remaining gate.

**Tech Stack:** Markdown plan files, existing Soloclaw CLI gates, Node.js test runner, Windows PowerShell/CMD, Linux/macOS/Termux manual smoke environments.

---

## Plan Status As Of 2026-06-25

- [x] **Phase 2 rich TUI and event stream closeout**
  - Source: `docs/superpowers/plans/2026-06-18-soloclaw-rich-tui-event-stream.md`
  - Implementation state: event stream projection, rich TUI, model setup hardening, Plan/Build approval, Goal continuation, chat-first follow-up UI, and later Phase 3 runtime work are implemented.
  - Evidence: `phase2 evidence-check --strict --json` returns `status=paste_safe_pending_manual_review` with all C1/C2/C3 dated-evidence and closure-task checks passing; `phase2 gate --json` returns `status=ready_for_completion`; `phase2 final-gate --json` returns `status=pass`.
  - Residual risk: none tracked in the Phase 2 plan.

- [x] **Chat-first TUI status rail**
  - Source: `docs/superpowers/plans/2026-06-20-soloclaw-chat-first-tui-status-rail.md`
  - Evidence: closeout section records `npm.cmd run build`, `npm.cmd test`, rich TUI smoke, and `git diff --check` results.
  - Residual risk: none tracked in the plan.

- [x] **Phase 3 agent runtime reliability**
  - Source: `docs/superpowers/plans/2026-06-20-soloclaw-phase3-agent-runtime-reliability.md`
  - Evidence: verification section records focused Phase 3 tests, standard checks, rich TUI smoke, and `phase3 gate --workspace E:\code\tafang --json` returning `status=pass`.
  - Residual risk: none tracked in the plan.

- [x] **Phase 3B long-task runtime**
  - Source: `docs/superpowers/plans/2026-06-20-soloclaw-phase3b-long-task-runtime.md`
  - Evidence: final closeout records `npm.cmd run build`, focused security test, `phase3 long-task-real-provider --workspace E:\code\tafang --json`, local long-task gate, Phase 3 gate, rich TUI smoke, `git diff --check`, and `npm.cmd test`.
  - Residual risk: none tracked in the plan.

- [ ] **Phase 4A cross-platform local Soloclaw agent**
  - Source: `docs/platform-support.md` and `docs/superpowers/plans/2026-06-25-soloclaw-real-environment-evidence-closure.md`
  - Implementation state: platform path/capability abstraction, global config path migration, workspace runtime selector, optional Rust runner support, `soloclaw platform doctor`, and `soloclaw phase4 checklist|verify|matrix-template` are implemented and locally tested.
  - Evidence present: Windows PowerShell, Windows CMD, and WSL Ubuntu Linux matrix smoke pass on this workstation; `phase4-platform.test.js`, `workspace-runtime-jsonrpc.test.js`, and `phase4 verify --workspace E:\code\agent --json` pass.
  - Remaining blocker: real macOS shell and Android Termux smoke evidence is not complete. No macOS host is configured; ADB is installed but no Android device is attached; Android SDK has no emulator executable or AVD. `docs/platform-support.md` now includes copy-paste smoke capture scripts for both external targets.

- [ ] **Phase 5 cross-machine room collaboration alpha**
  - Source: `docs/agent-rooms.md`, `docs/implementation-roadmap.md`, `docs/superpowers/plans/2026-06-25-soloclaw-real-environment-evidence-closure.md`, and the Phase 5 CLI verifier in `src/cli/index.ts`.
  - Implementation state: local HTTP room control plane, signed invite bundles, `soloclaw room invite-agent`, `soloclaw room join --invite-bundle --run`, registered-agent pull communication through `agent remote register`, `soloclaw room pull-agent` / `agent rooms pull-agent`, `agent remote invitations`, `agent remote accept-room`, routed task handling through `agent remote run`, signed delivery ack, and signed room reply evidence, routed remote inbox/say/ack/poll/run, signed remote message intents, signed delivery acknowledgements, signed heartbeats, key rotation, trust revocation, suspended-member denial, stale-agent recovery, delivery status, room-scoped event stream, room-linked assignment/result evidence, conflict/result sync evidence, remote-to-remote handoff evidence, `soloclaw phase5 matrix-template --target <target-id>` per-host command filtering, `soloclaw phase5 evidence-plan` / `collection-plan` token-safe control-host collection manifest, `soloclaw phase5 collection-runbook` / `runbook` token-safe control-host collection sequence, `soloclaw phase5 collection-prepare` / `prepare` token-safe one-command control-host collection workspace writer, `soloclaw phase5 collector-guide` / `collection-guide --target <target-id>` token-safe per-target collection handoff, `soloclaw phase5 collector-pack` / `collection-pack --target <target-id>` token-safe per-target Markdown guide writer under `phase5-collector-guides`, `soloclaw phase5 evidence-init` / `collection-init` token-safe base/fragment template initializer with default no-overwrite behavior, `soloclaw phase5 evidence-status` / `collection-status` read-only collection progress summary with invalid-fragment diagnostics that preserve valid progress, `soloclaw phase5 evidence-template --target <target-id>` per-host evidence fragment filtering, `phase5 evidence-check --target <target-id>` per-host fragment preflight including control-plane-host event-stream/operator-visibility plus shared room/global evidence preflight, `soloclaw phase5 evidence-merge` per-host fragment merging with remaining-target plus `collectionStatus`, `roomStatus`, and `finalEvidenceCheck` summaries, `phase5 evidence-merge --target-dir <fragments-dir>` batch fragment directory loading with duplicate-target rejection, current `phase5 checklist` and top-level `soloclaw --help` per-target collector guidance, BOM-tolerant evidence JSON reads, and `phase5 evidence-check --json` missing-evidence summaries are implemented and locally tested.
  - Evidence present: `node --test dist\__tests__\remote-room-runner.test.js` passes, including the registered-agent pull path from remote registration through room invitation listing, acceptance, signed heartbeat, routed task handling through `remote run`, signed delivery ack, and signed room reply evidence. The Phase 5 collector flow is implemented for evidence plan, collection runbook/prepare, collector guide/pack, evidence init/status/template/check/merge, target-dir batch merge, BOM-tolerant JSON reads, missing-evidence summaries, control-plane-host shared room preflight, and remote-target preflight. `node dist\cli\index.js phase5 verify --workspace E:\code\agent --json` returns `status=pass`; `npm.cmd test` passes 644/644 in the current Phase 1-5 closeout commit.
  - Remaining blocker: real cross-machine matrix evidence has not been collected on separate Windows PowerShell/CMD, Linux, macOS, and Android Termux hosts. `soloclaw phase5 evidence-plan --json`, `soloclaw phase5 collection-runbook --json`, `soloclaw phase5 collection-prepare --json`, `soloclaw phase5 collector-guide --target <target-id> --json`, `soloclaw phase5 collector-pack --json`, `soloclaw phase5 evidence-init --json`, `soloclaw phase5 evidence-status --file <base> --target-dir <fragments-dir> --json`, `soloclaw phase5 matrix-template --json`, `soloclaw phase5 matrix-template --target <target-id> --json`, `soloclaw phase5 evidence-template --json`, `soloclaw phase5 evidence-template --target <target-id> --json`, `soloclaw phase5 evidence-check --file <fragment> --target <target-id> --json`, `soloclaw phase5 evidence-merge --file <base> --target-file <fragment> --output <merged> --json`, and `soloclaw phase5 evidence-merge --file <base> --target-dir <fragments-dir> --output <merged> --json` provide the control-host/remote capture, preflight, status, and merge shape; `soloclaw phase5 evidence-check --file <path> --json` remains the closure gate for paste-safe real-machine evidence.

- [ ] **Phase 4.5/5.5 real-environment evidence closure**
  - Source: `docs/superpowers/plans/2026-06-25-soloclaw-real-environment-evidence-closure.md`
  - Implementation state: no new product capability is required up front; this is an evidence and release-boundary closure plan over the existing Phase 1-5 gates.
  - Evidence present: the plan now defines the local baseline refresh, Phase 4 macOS/Termux capture, Phase 5 full real-machine collection, release live-provider gate, and Phase 6 admission boundaries.
  - Remaining blocker: run the plan tasks on real macOS, real Android Termux, and the separate Phase 5 machine targets, then update the platform, room, roadmap, and ledger docs with paste-safe results.

- [x] **Phase 5.6 local agent workbench hardening**
  - Source: `docs/superpowers/plans/2026-06-25-soloclaw-local-agent-workbench-hardening.md`
  - Implementation state: implemented locally. Trusted instruction discovery, builtin preset skills, lazy `load_skill`, work profiles, command templates, completion gate, and workbench verification CLI are present.
  - Evidence present: `npm.cmd run build`, `npm.cmd run check`, focused workbench tests, `npm.cmd test`, and `git diff --check` pass in the Phase 5.6/5.7 closeout run.
  - Remaining blocker: none for the local Phase 5.6 capability lane.
  - Boundary: this does not close Phase 4.5/5.5 real-machine evidence and does not admit Phase 6 beyond local policy simulation.

- [x] **Phase 5.7 persistent memory hardening**
  - Source: `docs/superpowers/plans/2026-06-25-soloclaw-persistent-memory-hardening.md`
  - Implementation state: implemented locally. Reviewed memory candidates, safety/privacy filtering, ACL-aware retrieval, usage audit, compaction extraction hooks, curated memory snapshots, memory CLI, and memory eval gates are present.
  - Evidence present: `npm.cmd run build`, `npm.cmd run check`, focused memory lifecycle/retrieval/snapshot/CLI tests, `npm.cmd test`, and `git diff --check` pass in the Phase 5.6/5.7 closeout run.
  - Remaining blocker: none for the local Phase 5.7 capability lane.
  - Boundary: memory remains lower priority than rules, skills, policy, approvals, and secret redaction; this does not close Phase 4.5/5.5 real-machine evidence and does not admit Phase 6 beyond local policy simulation.

- [x] **Product maturation overlay / Workstream 1 CLI modularization**
  - Source: `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md`
  - Slice plans: `docs/superpowers/plans/2026-06-25-soloclaw-cli-modularization-slice-1.md`, `docs/superpowers/plans/2026-06-25-soloclaw-cli-modularization-slice-2.md`, `docs/superpowers/plans/2026-06-25-soloclaw-cli-modularization-slice-3.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-4.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-5.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-6.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-7.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-8.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-9.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-10.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-11.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-12.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-13.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-14.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-15.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-16.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-17.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-18.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-19.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-20.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-21.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-22.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-23.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-24.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-25.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-26.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-27.md`, `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-28.md`, and `docs/superpowers/plans/2026-06-26-soloclaw-cli-modularization-slice-29.md`.
  - Implementation state: Workstream 1 command routing is complete for the current top-level inventory. `src/cli/index.ts` now owns process startup, no-arg/leading-workspace TUI startup, pre-router room shortcut normalization/help, router registration, unknown-command JSON/text error formatting, and natural-language `run` / `ask` / target-mode dispatch. Focused command modules own help, quickstart, workbench/onboarding, model/config/session/tools/memory/web/workspace/admin/workers/spec/agents/subagents, room/remote, phase gates, and hygiene command flow.
  - Evidence present: focused router/help/quickstart/model/config/session/tools/workbench/memory/web/workspace/admin/workers/spec/agents/subagents/rooms/remote/phases/hygiene tests, unknown-command JSON error-shape test, CLI `quickstart` text/JSON smoke, CLI `doctor --json` smoke, CLI `status --json` smoke, CLI `platform doctor --json` smoke, CLI `inspect --workspace E:\code\agent --json` smoke, CLI `models profiles list --json` smoke, CLI `models usage --json` smoke, CLI `secrets list` smoke, CLI `session status` / `session verify` smoke paths, Workstream smoke commands (`--help`, `phase1 verify --json`, and `model --help`), and full `npm.cmd test` runs during Workstream 1 implementation.
  - Remaining blocker: none for Workstream 1 CLI modularization; future cleanup can move injected builders/renderers out of `src/cli/index.ts`.
  - Boundary: no phase verifier, Web API route, control-plane contract, room protocol, remote runner, workspace history format, memory priority, memory safety rule, policy decision semantics, approval audit semantics, MCP continuation semantics, worker queue semantics, plugin execution semantics, skill loading semantics, or cross-agent behavior is intentionally changed by slices 1-29.

## Open Work Queue

- [x] Record Phase 2 C1 external terminal rich TUI review.
- [x] Record Phase 2 C2 real-provider Soloclaw task review.
- [x] Run and record Phase 2 C3 final automated gate after C1 and C2 are reviewed.
- [x] Re-run Phase 4A Linux shell smoke on a working Linux shell or repaired WSL environment.
- [x] Execute `docs/superpowers/plans/2026-06-25-soloclaw-local-agent-workbench-hardening.md` to strengthen the local agent workbench before broader Phase 6 implementation.
- [x] Execute `docs/superpowers/plans/2026-06-25-soloclaw-persistent-memory-hardening.md` after or alongside the workbench hardening plan to add the reviewed persistent memory lifecycle.
- [x] Continue `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md` Workstream 1 after CLI modularization Slice 19 by migrating knowledge, plugins, and MCP into the tools command module.
- [x] Continue `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md` Workstream 1 after CLI modularization Slice 20 by migrating audit into the session command module.
- [x] Continue `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md` Workstream 1 after CLI modularization Slice 21 by migrating memory into a focused command module.
- [x] Continue `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md` Workstream 1 after CLI modularization Slice 22 by migrating web into a focused command module.
- [x] Continue `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md` Workstream 1 after CLI modularization Slice 23 by migrating workspace into a focused command module.
- [x] Continue `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md` Workstream 1 after CLI modularization Slice 24 by migrating remaining onboarding/workbench, admin/org/git/PR, and workers/scheduler/operator/assignment commands into focused modules.
- [x] Continue `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md` Workstream 1 after CLI modularization Slice 25 by migrating spec plus identity/agents command flow into focused modules.
- [x] Continue `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md` Workstream 1 after CLI modularization Slice 26 by migrating delegate/subtasks command flow into a focused module.
- [x] Continue `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md` Workstream 1 after CLI modularization Slice 27 by migrating room convenience, `rooms`, and `remote` before phase gates.
- [x] Finish `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md` Workstream 1 by routing phase gates and hygiene through focused command modules.
- [ ] Execute `docs/superpowers/plans/2026-06-25-soloclaw-real-environment-evidence-closure.md` Task 1 to refresh the local baseline and release-boundary ledger.
- [ ] Run Phase 4A macOS shell smoke on a real macOS host or CI runner.
- [ ] Run Phase 4A Android Termux smoke on a real device or emulator with Termux.
- [ ] After macOS/Termux evidence exists, update `docs/platform-support.md` and this ledger.
- [ ] Run Phase 5 real cross-machine room matrix on separate Windows PowerShell/CMD, Linux, macOS, and Android Termux targets.
- [ ] After Phase 5 matrix evidence exists, run `soloclaw phase5 evidence-check --file <path> --json` and update `docs/agent-rooms.md`, `docs/implementation-roadmap.md`, and this ledger.
- [ ] After Phase 4.5 and Phase 5.5 close, allow Phase 6 work beyond local policy simulation according to the evidence-gated subphase rules in `docs/implementation-roadmap.md`.

## Evidence Commands Used During This Reconciliation

```powershell
npm run build
node --test dist\__tests__\phase4-platform.test.js
node --test dist\__tests__\workspace-runtime-jsonrpc.test.js
node dist\cli\index.js phase4 verify --workspace E:\code\agent --json
node --test dist\__tests__\remote-room-runner.test.js
node --test dist\__tests__\remote-room-runner.test.js --test-name-pattern "registered remote agent can be pulled"
node dist\cli\index.js phase5 evidence-plan --json
node dist\cli\index.js phase5 collection-runbook --json
node dist\cli\index.js phase5 collection-prepare --json
node dist\cli\index.js phase5 collector-guide --target linux-shell-agent --json
node dist\cli\index.js phase5 collector-pack --json
node dist\cli\index.js phase5 collector-pack --target linux-shell-agent --json
node dist\cli\index.js phase5 evidence-init --json
node dist\cli\index.js phase5 evidence-status --file <base> --target-dir <fragments-dir> --json
node dist\cli\index.js phase5 matrix-template --target linux-shell-agent --json
node dist\cli\index.js phase5 evidence-template --target linux-shell-agent --json
node dist\cli\index.js phase5 evidence-check --file <fragment> --target linux-shell-agent --json
node dist\cli\index.js phase5 evidence-merge --file <base> --target-file <fragment> --json
node dist\cli\index.js phase5 evidence-merge --file <base> --target-file <fragment> --output <merged> --json
node dist\cli\index.js phase5 evidence-merge --file <base> --target-dir <fragments-dir> --output <merged> --json
node dist\cli\index.js phase5 verify --workspace E:\code\agent --json
node --test dist\__tests__\remote-room-runner.test.js --test-name-pattern "phase5 checklist CLI describes"
node --test dist\__tests__\remote-room-runner.test.js --test-name-pattern "soloclaw help exposes Phase 5 evidence"
node --test dist\__tests__\remote-room-runner.test.js --test-name-pattern "collection-runbook"
node --test dist\__tests__\remote-room-runner.test.js --test-name-pattern "collection-prepare"
node --test dist\__tests__\remote-room-runner.test.js --test-name-pattern "collector-guide"
node --test dist\__tests__\remote-room-runner.test.js --test-name-pattern "collector-pack"
node --test dist\__tests__\remote-room-runner.test.js --test-name-pattern "duplicate target fragments"
node --test dist\__tests__\remote-room-runner.test.js --test-name-pattern "phase5 evidence-merge --output reports"
node --test dist\__tests__\remote-room-runner.test.js --test-name-pattern "evidence-plan"
node --test dist\__tests__\remote-room-runner.test.js --test-name-pattern "evidence-init"
node --test dist\__tests__\remote-room-runner.test.js --test-name-pattern "evidence-status"
git diff --check
npm test
node dist\cli\index.js phase2 evidence-check --workspace E:\code\agent --strict --json
node dist\cli\index.js phase2 gate --workspace E:\code\agent --json
node dist\cli\index.js phase2 final-gate --workspace E:\code\agent --json
powershell.exe -NoProfile -Command "npm.cmd run build"
powershell.exe -NoProfile -Command "node dist\cli\index.js doctor --workspace E:\code\agent --json"
powershell.exe -NoProfile -Command "node dist\cli\index.js config path --json"
powershell.exe -NoProfile -Command "node dist\cli\index.js phase4 verify --workspace E:\code\agent --json"
cmd.exe /d /c npm.cmd run build
cmd.exe /d /c "node dist\cli\index.js doctor --workspace E:\code\agent --json"
cmd.exe /d /c "node dist\cli\index.js config path --json"
cmd.exe /d /c "node dist\cli\index.js phase4 verify --workspace E:\code\agent --json"
wsl.exe --list --verbose
wsl.exe -d Ubuntu -- echo hi
wsl.exe --shutdown
wsl.exe -d Ubuntu -- bash -lc 'set -euo pipefail; export PATH=/home/administrator/.local/soloclaw-node-v24.13.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; export SOLOCLAW_HOME=/home/administrator/.cache/soloclaw-phase4-linux-smoke; cd /mnt/e/code/agent; npm run build; node dist/cli/index.js setup --mock --workspace /mnt/e/code/agent; node dist/cli/index.js doctor --workspace /mnt/e/code/agent --json; node dist/cli/index.js config path --json; node dist/cli/index.js phase4 verify --workspace /mnt/e/code/agent --json'
adb devices
docker version
docker images --format "{{.Repository}}:{{.Tag}}"
"C:\Program Files\Git\bin\bash.exe" -lc 'cd /e/code/agent && node -p "process.platform"'
"C:\Android\Sdk\emulator\emulator.exe" -list-avds
"C:\Android\Sdk\cmdline-tools\latest\bin\avdmanager.bat" list avd
```

Observed results:

- Build passes in the default shell, nested PowerShell, and CMD.
- Phase 2 evidence-check passes with strict C1/C2/C3 evidence and reviewed closure tasks.
- Phase 2 gate returns `ready_for_completion`.
- Phase 2 final-gate returns `status=pass` with typecheck, 503/503 tests, rich TUI smokes, whitespace, and temp-file scan passing.
- Phase 4 platform tests pass: `phase4-platform.test.js` 4/4, `workspace-runtime-jsonrpc.test.js` 7/7.
- Windows PowerShell and CMD `phase4 verify` return `status=pass`.
- Phase 5 focused tests pass: `remote-room-runner.test.js` 87/87, including registered-agent pull into room communication (`remote register`, `rooms pull-agent`, `remote invitations`, `remote accept-room`, routed task, `remote run`, signed ack, signed reply), top-level help and checklist guidance for the per-target evidence workflow, control-host `evidence-plan` / `collection-plan` manifest output, control-host `collection-runbook` / `runbook` sequence output, control-host `collection-prepare` / `prepare` one-command workspace writer output, per-target `collector-guide` / `collection-guide` handoff output, `collector-pack` / `collection-pack` per-target Markdown guide generation, single-target `collector-pack --target` generation, force/no-overwrite behavior, control-host `evidence-init` / `collection-init` base and per-target fragment template generation with default no-overwrite behavior, read-only `evidence-status` / `collection-status` progress output including missing fragment directory handling and invalid-fragment diagnostics that preserve valid progress, per-target matrix-template/evidence-template filtering, remote and control-plane-host per-target evidence-check preflight, control-plane-host shared room/global evidence preflight, evidence fragment merge with control-plane room replacement, remote-only room preservation, target-dir batch fragment loading with duplicate-target rejection, `collectionStatus`, `roomStatus`, `finalEvidenceCheck`, and final-ready summary guards, remaining-target summary, unknown-target rejection, BOM-encoded evidence JSON reads, and failed-gate `missingEvidence[]` summaries.
- Phase 5 local verifier returns `status=pass`, proving local HTTP control-plane invite enrollment, one-file bundle join/run, two active remote agents in one room, routed task isolation, signed acknowledgements/heartbeats/message intents, room delivery status, room-scoped event stream summaries, no-broadcast fallback, stale recovery, key rotation, assignment/result, agent-to-agent exchange, remote-to-remote handoff, conflict/result sync, stop-file shutdown, and secret-shape scan.
- `phase5 matrix-template --target linux-shell-agent --json` returns only the Linux target command set for per-machine collection.
- `phase5 evidence-template --target control-plane-host --json` returns only the control-plane-host evidence fragment plus the shared `room` section for control-host collection.
- `phase5 evidence-template --target linux-shell-agent --json` returns only the Linux target evidence fragment for per-machine collection.
- `phase5 evidence-plan --json` returns a token-safe control-host collection manifest with `phase5-fragments`, `phase5-evidence.json`, `phase5-evidence.merged.json`, all six required target ids, per-target fragment paths, per-target matrix/template/preflight commands, a target-dir merge command, and final evidence-check command.
- `phase5 collection-runbook --json` returns the token-safe control-host sequence with initialize, collector-guide writing, fragment status, target-dir merge, final evidence-check commands, per-target guide/fragment/preflight paths, ordered steps, and final-acceptance notes.
- `phase5 collection-prepare --json` writes the default no-overwrite control-host collection workspace with the base evidence file, six fragment templates, six per-target guides, and `phase5-collection-runbook.md`; `--force` replaces all scaffold files intentionally and the JSON/text output remains token-safe.
- `phase5 collector-guide --target linux-shell-agent --json` returns a token-safe single-target handoff with target label/role, fragment path, matrix/template/preflight commands, return-to-control-host status/merge/final-check commands, operator steps, and secret-hygiene notes.
- `phase5 collector-pack --json` writes six token-safe per-target Markdown guide files under `phase5-collector-guides/`, `phase5 collector-pack --target linux-shell-agent --json` writes only the Linux guide, keeps guides out of the strict `phase5-fragments/*.json` merge directory, refuses existing outputs unless `--force` is used, and reports selected `targetIds` plus next evidence-init/status/merge/check commands.
- `phase5 evidence-init --json` writes the default base evidence file and six per-target fragment templates under `phase5-fragments`, returns token-safe next status/merge/check commands, and refuses to overwrite existing files unless `--force` is used.
- `phase5 evidence-status --file <base> --target-dir <fragments-dir> --json` returns a read-only control-host collection progress view with per-target `collectionStatus`, `roomStatus`, `invalidFragmentCount`, `fragmentErrors`, merged/remaining target ids, and next commands without writing a merged file; missing or empty fragment directories are treated as zero collected fragments, and malformed fragments are reported without hiding progress from valid fragments.
- `phase5 evidence-check --file <fragment> --target control-plane-host --json` validates one control-plane-host fragment as `gate=target-evidence`, returning target/room-scoped missing event-stream, operator-visibility, and shared room/global evidence without requiring remote target fragments; full matrix check still enforces remote target/agent id consistency after merge.
- `phase5 evidence-check --file <fragment> --target linux-shell-agent --json` validates one remote fragment as `gate=target-evidence`, returning target-scoped missing evidence without requiring room/global matrix sections.
- `phase5 evidence-merge --file <base> --target-file <fragment> --json` merges filled target fragments into a six-target base evidence document, replaces the shared `room` section from a control-plane-host fragment, preserves the current `room` section for remote-only fragments, reports required/merged/remaining target ids plus per-target `collectionStatus`, `roomStatus`, and `finalEvidenceCheck` when writing `--output --json`, keeps `readyForFinalEvidenceCheck=false` until target and shared room evidence are both ready, accepts PowerShell-written BOM-encoded JSON inputs, and supports `--target-dir <fragments-dir>` for batch-loading first-level `.json` fragments while ignoring non-JSON notes and rejecting duplicate target ids.
- `phase5 evidence-check --file <template> --json` returns failed `missingEvidence[]` summaries grouped by scope so collectors can see missing target fragments and room/control-plane sections without reading every check manually.
- Failed `phase5 evidence-check --json` output also includes `summary.missingEvidenceByScope` counters for `matrix`, `target`, `room`, and `controlPlane`.
- Full `npm test` passes 610/610 after the latest Phase 5 registered-agent pull evidence increment.
- WSL initially listed Ubuntu but direct command execution exited 1 with `Wsl/Service/E_UNEXPECTED`; `wsl.exe --shutdown` recovered the distro.
- Linux WSL smoke passes with native Linux Node `v24.13.1`, isolated `SOLOCLAW_HOME`, platform `linux`, TypeScript runtime smoke pass, Rust runner warn/skip because cargo is not installed, and `secretMatches=0`.
- Docker and Podman are not installed, so a Linux container smoke is not available from this workstation.
- Git Bash exists but reports Node `process.platform=win32`, so it cannot substitute for Linux smoke.
- `adb devices` shows no attached devices, `C:\Android\Sdk\emulator\emulator.exe` is absent, and `avdmanager list avd` reports no AVDs, so Termux smoke cannot be run from this workstation yet.

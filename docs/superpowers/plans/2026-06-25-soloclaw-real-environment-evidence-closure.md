# Soloclaw Real-Environment Evidence Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining release-grade evidence gap between the Phase 1-5 local gates and real macOS, Android Termux, live-provider, and multi-machine room operation.

**Architecture:** Keep the existing Phase 1-5 code as the baseline and add no new product capability unless a real-environment gate exposes a defect. Evidence is collected through the existing CLI gates, target-specific Phase 4 smoke scripts, Phase 5 collector fragments, and documentation updates that distinguish local smoke from release closure. Phase 6 work is admitted only after the real-environment closure gates are satisfied or is explicitly labelled as local policy simulation.

**Tech Stack:** Markdown plans, existing Soloclaw CLI, Node.js test runner, Windows PowerShell/CMD, WSL/Linux shell, macOS shell, Android Termux, Phase 5 evidence JSON fragments.

## Global Constraints

- Do not count generated Phase 5 template fragments, collector guides, or runbooks as completed real-machine evidence.
- Do not record API keys, bearer tokens, invite tokens, control tokens, vault passphrases, private keys, raw signed envelopes, raw SSE bodies, or full room message bodies in committed docs.
- Keep `phase5-collection-runbook.md`, `phase5-collector-guides/`, `phase5-evidence.json`, `phase5-evidence.merged.json`, `phase5-fragments/`, and `phase5-registered-pull-operator-next.json` ignored local collection workspace outputs.
- Use exact Phase 5 target ids: `control-plane-host`, `windows-powershell-agent`, `windows-cmd-agent`, `linux-shell-agent`, `macos-shell-agent`, and `android-termux-agent`.
- Use `linux-shell-agent` as the default registered-agent pull target for this closure pass unless the operator intentionally chooses another real remote target and regenerates all Phase 5 collection files with the same chosen target.
- Phase 1 local readiness is a local gate; the live-provider smoke is a release-before-shipping gate.
- Phase 4 local Windows/Linux evidence is not a substitute for macOS shell and Android Termux real-host evidence.
- Phase 5 local room smoke is not a substitute for real multi-machine matrix evidence.
- Phase 6 native app, mobile-action, sandboxed-runner, or advanced autonomy work must not be claimed beyond local policy simulation until this plan's Phase 4 and Phase 5 real-environment gates are closed.

---

## File Structure

- Create: `docs/superpowers/plans/2026-06-25-soloclaw-real-environment-evidence-closure.md`
  - Owns the execution checklist for real-environment evidence closure.
- Modify: `docs/implementation-roadmap.md`
  - Adds the supplemental closure lane and Phase 6 admission rule.
- Modify: `docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md`
  - Points the open work queue at this plan.
- Modify after evidence is collected: `docs/platform-support.md`
  - Records macOS and Android Termux Phase 4 matrix results.
- Modify after evidence is collected: `docs/agent-rooms.md`
  - Records the Phase 5 real-machine room matrix status and evidence boundary.

## Task 1: Refresh The Local Baseline Before External Collection

**Files:**
- Modify: `docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md`

**Interfaces:**
- Consumes: existing CLI gates from `dist/cli/index.js`
- Produces: a dated baseline entry in the project plan ledger that later external evidence can compare against

- [ ] **Step 1: Run the standard local gates**

Run from `E:\code\agent`:

```powershell
npm.cmd run build
npm.cmd run check
npm.cmd test
git diff --check
```

Expected: build and check exit 0, test summary reports zero failures, and `git diff --check` reports no whitespace errors. LF-to-CRLF warnings are acceptable on Windows.

- [ ] **Step 2: Run the Phase 1-5 local gates**

Run from `E:\code\agent`:

```powershell
node dist\cli\index.js phase1 verify --json
node dist\cli\index.js phase2 verify --workspace E:\code\agent --json --cleanup
node dist\cli\index.js phase3 gate --workspace E:\code\agent --json
node dist\cli\index.js phase3 long-task-gate --workspace E:\code\agent --json
node dist\cli\index.js phase4 verify --workspace E:\code\agent --json
node dist\cli\index.js phase5 verify --workspace E:\code\agent --json
node dist\cli\index.js phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --registered-pull-target linux-shell-agent --json
```

Expected: Phase 1-5 local gates exit 0 and the final Phase 5 evidence-status command reports incomplete real-machine evidence until the collection workspace has real fragments.

- [ ] **Step 3: Add the baseline note to the ledger**

Append this shape under `Evidence Commands Used During This Reconciliation` or a new dated subsection in `docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md`:

```markdown
## Real-Environment Closure Baseline 2026-06-25

- Local gates: `npm.cmd run build`, `npm.cmd run check`, `npm.cmd test`, and `git diff --check` passed.
- Phase gates: `phase1 verify`, `phase2 verify --cleanup`, `phase3 gate`, `phase3 long-task-gate`, `phase4 verify`, and `phase5 verify` passed on `E:\code\agent`.
- Phase 5 real-machine evidence status remains incomplete until real target fragments are collected; generated templates are not completion evidence.
```

- [ ] **Step 4: Commit the baseline-only docs update**

```powershell
git add docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md
git commit -m "docs: record real-environment closure baseline"
```

## Task 2: Close Phase 4 macOS And Android Termux Evidence

**Files:**
- Modify: `docs/platform-support.md`
- Modify: `docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md`

**Interfaces:**
- Consumes: Phase 4 external smoke scripts already documented in `docs/platform-support.md`
- Produces: updated Phase 4 matrix rows for `macOS shell` and `Android Termux`

- [ ] **Step 1: Run the macOS smoke on a real macOS checkout**

Run from a checked-out copy of this repository on macOS:

```sh
set -eu
mkdir -p .agent/tmp/phase4-macos-smoke
export SOLOCLAW_HOME="$PWD/.agent/tmp/phase4-macos-smoke/soloclaw-home"
npm install 2>&1 | tee .agent/tmp/phase4-macos-smoke/01-npm-install.txt
npm run build 2>&1 | tee .agent/tmp/phase4-macos-smoke/02-build.txt
node dist/cli/index.js setup --mock --workspace "$PWD" 2>&1 | tee .agent/tmp/phase4-macos-smoke/03-setup.txt
node dist/cli/index.js doctor --workspace "$PWD" --json > .agent/tmp/phase4-macos-smoke/04-doctor.json
node dist/cli/index.js config path --json > .agent/tmp/phase4-macos-smoke/05-config-path.json
node dist/cli/index.js phase4 verify --workspace "$PWD" --json > .agent/tmp/phase4-macos-smoke/06-phase4-verify.json
node -e 'const fs=require("fs"); const v=JSON.parse(fs.readFileSync(".agent/tmp/phase4-macos-smoke/06-phase4-verify.json","utf8")); if(v.status!=="pass" || v.platform.id!=="macos") process.exit(1); console.log("phase4 macOS smoke pass");'
```

Expected: the final command prints `phase4 macOS smoke pass`.

- [ ] **Step 2: Run the Android Termux smoke on a real Termux checkout**

Run from a checked-out copy of this repository inside Termux:

```sh
set -eu
pkg install -y nodejs git ripgrep
mkdir -p .agent/tmp/phase4-termux-smoke
export SOLOCLAW_HOME="$PWD/.agent/tmp/phase4-termux-smoke/soloclaw-home"
npm install 2>&1 | tee .agent/tmp/phase4-termux-smoke/01-npm-install.txt
npm run build 2>&1 | tee .agent/tmp/phase4-termux-smoke/02-build.txt
node dist/cli/index.js setup --mock --workspace "$PWD" 2>&1 | tee .agent/tmp/phase4-termux-smoke/03-setup.txt
node dist/cli/index.js doctor --workspace "$PWD" --json > .agent/tmp/phase4-termux-smoke/04-doctor.json
node dist/cli/index.js config path --json > .agent/tmp/phase4-termux-smoke/05-config-path.json
node dist/cli/index.js phase4 verify --workspace "$PWD" --json > .agent/tmp/phase4-termux-smoke/06-phase4-verify.json
node -e 'const fs=require("fs"); const v=JSON.parse(fs.readFileSync(".agent/tmp/phase4-termux-smoke/06-phase4-verify.json","utf8")); if(v.status!=="pass" || v.platform.id!=="android-termux") process.exit(1); console.log("phase4 Termux smoke pass");'
```

Expected: the final command prints `phase4 Termux smoke pass`.

- [ ] **Step 3: Record only paste-safe Phase 4 summaries**

Update the `Current Matrix Evidence` table in `docs/platform-support.md`:

```markdown
| macOS shell | Pass | Real macOS shell smoke passed on 2026-06-25 or the actual capture date recorded by the operator. `phase4 verify --json` returned `status=pass`, `platform.id=macos`, platform path checks passed, TypeScript runtime smoke passed, Rust runtime smoke passed or was skipped with a documented reason, and `secretMatches=0`. | Re-run before release packaging. |
| Android Termux | Pass | Real Termux smoke passed on 2026-06-25 or the actual capture date recorded by the operator. `phase4 verify --json` returned `status=pass`, `platform.id=android-termux`, platform path checks passed, TypeScript runtime smoke passed, Rust runtime smoke passed or was skipped with a documented reason, and `secretMatches=0`. | Re-run before release packaging. |
```

- [ ] **Step 4: Update the ledger**

Change the Phase 4A ledger item to checked only after both rows are recorded:

```markdown
- [x] **Phase 4A cross-platform local Soloclaw agent**
```

Keep a residual release note if packaging is still source-run only:

```markdown
- Residual risk: source-run smoke is complete; native installers, managed services, and update channels remain later productization work.
```

- [ ] **Step 5: Commit Phase 4 external evidence docs**

```powershell
git add docs/platform-support.md docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md
git commit -m "docs: close phase4 real platform evidence"
```

## Task 3: Collect Phase 5 Real Multi-Machine Room Evidence

**Files:**
- Modify after evidence is collected: `docs/agent-rooms.md`
- Modify after evidence is collected: `docs/implementation-roadmap.md`
- Modify after evidence is collected: `docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md`

**Interfaces:**
- Consumes: `soloclaw phase5 collection-prepare`, per-target collector guides, per-target evidence fragments, and `phase5 evidence-check`
- Produces: a paste-safe merged evidence file that passes the full Phase 5 evidence gate

- [ ] **Step 1: Prepare the ignored control-host collection workspace**

Run from `E:\code\agent`:

```powershell
node dist\cli\index.js phase5 collection-prepare --registered-pull-target linux-shell-agent --force --json
node dist\cli\index.js phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --registered-pull-target linux-shell-agent --json
```

Expected: the first command writes ignored local collection files, and the second command reports all required target ids with incomplete collection status.

- [ ] **Step 2: Distribute exact collector guides**

Send these files to the matching operators without committing them:

```text
phase5-collector-guides/control-plane-host.md
phase5-collector-guides/windows-powershell-agent.md
phase5-collector-guides/windows-cmd-agent.md
phase5-collector-guides/linux-shell-agent.md
phase5-collector-guides/macos-shell-agent.md
phase5-collector-guides/android-termux-agent.md
```

Expected: each operator receives only the guide for their target id plus the matching fragment file from `phase5-fragments/`.

- [ ] **Step 3: Preflight every returned fragment before merge**

Run from `E:\code\agent` after each fragment is filled:

```powershell
node dist\cli\index.js phase5 evidence-check --file phase5-fragments\control-plane-host.json --target control-plane-host --json
node dist\cli\index.js phase5 evidence-check --file phase5-fragments\windows-powershell-agent.json --target windows-powershell-agent --json
node dist\cli\index.js phase5 evidence-check --file phase5-fragments\windows-cmd-agent.json --target windows-cmd-agent --json
node dist\cli\index.js phase5 evidence-check --file phase5-fragments\linux-shell-agent.json --target linux-shell-agent --json
node dist\cli\index.js phase5 evidence-check --file phase5-fragments\macos-shell-agent.json --target macos-shell-agent --json
node dist\cli\index.js phase5 evidence-check --file phase5-fragments\android-termux-agent.json --target android-termux-agent --json
```

Expected: each target preflight exits 0 only after that fragment contains paste-safe evidence for its scope.

- [ ] **Step 4: Merge and run the final Phase 5 evidence gate**

Run from `E:\code\agent`:

```powershell
node dist\cli\index.js phase5 evidence-status --file phase5-evidence.json --target-dir phase5-fragments --registered-pull-target linux-shell-agent --json
node dist\cli\index.js phase5 evidence-merge --file phase5-evidence.json --target-dir phase5-fragments --output phase5-evidence.merged.json --json
node dist\cli\index.js phase5 evidence-check --file phase5-evidence.merged.json --json
```

Expected: `evidence-check` exits 0 only when the merged evidence includes real control-plane-host and per-target evidence for the full matrix.

- [ ] **Step 5: Record only the safe summary in docs**

Add a dated Phase 5 real-machine evidence section to `docs/agent-rooms.md` with this shape:

```markdown
## Phase 5 Real-Machine Matrix Evidence 2026-06-25

- Full evidence check: `node dist\cli\index.js phase5 evidence-check --file phase5-evidence.merged.json --json` exited 0.
- Targets covered: `control-plane-host`, `windows-powershell-agent`, `windows-cmd-agent`, `linux-shell-agent`, `macos-shell-agent`, and `android-termux-agent`.
- Registered-agent pull target: `linux-shell-agent`.
- Evidence remained paste-safe: no control tokens, invite tokens, private keys, raw signed envelopes, raw SSE bodies, API keys, bearer tokens, or full room message bodies were committed.
- Remaining production non-goals: P2P/NAT traversal, managed OS service installation, production broker/WebSocket streaming, production auth/key rotation ceremonies, and native Android app automation.
```

- [ ] **Step 6: Mark Phase 5 closed in the ledger**

Change the Phase 5 ledger item to checked only after the final evidence gate exits 0:

```markdown
- [x] **Phase 5 cross-machine room collaboration alpha**
```

Keep this residual risk line:

```markdown
- Residual risk: real room matrix evidence is complete for alpha; production broker, managed daemon installation, private deployment auth, and P2P/NAT traversal remain later platform work.
```

- [ ] **Step 7: Commit Phase 5 evidence docs**

```powershell
git add docs/agent-rooms.md docs/implementation-roadmap.md docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md
git commit -m "docs: close phase5 real room evidence"
```

## Task 4: Add The Release Live-Provider Gate

**Files:**
- Modify: `docs/implementation-roadmap.md`
- Modify: `docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md`

**Interfaces:**
- Consumes: Phase 1 readiness and existing real-provider smoke command
- Produces: a release checklist entry separate from Phase 1 local completion

- [ ] **Step 1: Run readiness with the release provider configured**

Run from `E:\code\agent` after the release provider API key is available through an environment variable or local secret ref:

```powershell
node dist\cli\index.js phase1 verify --json
node dist\cli\index.js phase2 readiness --workspace E:\code\agent --json
```

Expected: readiness reports the provider as ready without printing raw credentials.

- [ ] **Step 2: Run the real-provider smoke**

Run from `E:\code\agent`:

```powershell
node dist\cli\index.js smoke --rich-tui-real-provider --workspace E:\code\agent
```

Expected: the smoke exits 0, reaches `answer`, and does not print a secret-looking value.

- [ ] **Step 3: Add release-gate wording to the roadmap**

Add this text near the Phase closure gates in `docs/implementation-roadmap.md`:

```markdown
## Release Gate Overlay

Phase 1 and Phase 2 local completion do not require committing live-provider credentials, but every release candidate must run one live-provider readiness check and one real-provider smoke with the configured release provider. The release record stores provider name, model id, command exit status, and secret-scan result only; it must not store API keys, key prefixes, bearer tokens, vault passphrases, raw prompts, or raw model responses.
```

- [ ] **Step 4: Commit the release-gate doc update**

```powershell
git add docs/implementation-roadmap.md docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md
git commit -m "docs: add release live-provider gate"
```

## Task 5: Enforce Phase 6 Admission Boundaries

**Files:**
- Modify: `docs/implementation-roadmap.md`
- Modify: `docs/security-boundaries.md`
- Modify: `docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md`

**Interfaces:**
- Consumes: Phase 4 and Phase 5 real-environment closure status
- Produces: a Phase 6 entry rule and subphase split that prevents native/mobile/autonomy work from outrunning evidence

- [ ] **Step 1: Add Phase 6 subphases to the roadmap**

Add this subsection under the Phase 6 description in `docs/implementation-roadmap.md`:

```markdown
Phase 6 is split into evidence-gated subphases:

- **6A Safety policy hardening**: capability tiers, approval replay, redaction, audit export, denial tests, and incident drills. This can proceed as local simulation after Phase 1-5 local gates pass.
- **6B Sandboxed runner hardening**: Rust/container/VM runner policy, resource limits, teardown, network policy, and artifact boundaries. This can prototype locally, but cannot replace local runtime defaults until Phase 4 real OS evidence is closed.
- **6C Native desktop contract**: Windows and macOS app shells wrap the existing control-plane APIs without privileged backdoors. This requires Phase 4 real OS evidence.
- **6D Android companion and mobile-action policy**: companion monitoring, notifications, approvals, and policy simulation for Intent/clipboard/browser flows. This requires Phase 4 Termux evidence and must deny autonomous payment, checkout, CAPTCHA, account, deletion, authorization, and security-prompt flows by default.
- **6E Distributed autonomy soak**: multi-agent recovery, incident response, broker-backed queues, and long-running room operations. This requires Phase 5 real multi-machine evidence.
```

- [ ] **Step 2: Add an admission rule**

Add this rule to `docs/implementation-roadmap.md`:

```markdown
Phase 6 admission rule: before Phase 4 macOS and Android Termux evidence plus Phase 5 real multi-machine evidence are closed, Phase 6 work may only be labelled `local policy simulation`, `design`, or `prototype`. It must not be described as production native app support, production mobile automation, production sandbox replacement, or production distributed autonomy.
```

- [ ] **Step 3: Mirror the deny-list in security boundaries**

Add this line to the Phase 6 section of `docs/security-boundaries.md`:

```markdown
Phase 6 mobile and native surfaces must default-deny autonomous payment, checkout, CAPTCHA, account recovery, account security changes, message sending on behalf of the user, destructive deletion, authorization prompts, security-prompt bypass, and hidden background phone control unless a compliant first-party API plus explicit final human confirmation exists.
```

- [ ] **Step 4: Commit Phase 6 boundary docs**

```powershell
git add docs/implementation-roadmap.md docs/security-boundaries.md docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md
git commit -m "docs: gate phase6 on real environment evidence"
```

## Task 6: Final Reconciliation

**Files:**
- Modify: `docs/implementation-roadmap.md`
- Modify: `docs/platform-support.md`
- Modify: `docs/agent-rooms.md`
- Modify: `docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md`

**Interfaces:**
- Consumes: Task 1-5 evidence and docs
- Produces: final plan ledger state for Phase 4.5/5.5 closure and Phase 6 entry

- [ ] **Step 1: Run final verification**

Run from `E:\code\agent`:

```powershell
npm.cmd run build
npm.cmd run check
npm.cmd test
git diff --check
node dist\cli\index.js phase4 verify --workspace E:\code\agent --json
node dist\cli\index.js phase5 verify --workspace E:\code\agent --json
node dist\cli\index.js phase5 evidence-check --file phase5-evidence.merged.json --json
```

Expected: local build/check/test/Phase 4/Phase 5 gates pass and the final Phase 5 real evidence check exits 0.

- [ ] **Step 2: Update the roadmap snapshot**

Update the `Current Progress Snapshot` in `docs/implementation-roadmap.md` so it says:

```markdown
Phase 4 real macOS and Android Termux evidence is closed. Phase 5 real multi-machine evidence is closed. Phase 6 can now proceed beyond local policy simulation according to the evidence-gated subphase rules.
```

- [ ] **Step 3: Update the open work queue**

In `docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md`, check off:

```markdown
- [x] Run Phase 4A macOS shell smoke on a real macOS host or CI runner.
- [x] Run Phase 4A Android Termux smoke on a real device or emulator with Termux.
- [x] Run Phase 5 real cross-machine room matrix on separate Windows PowerShell/CMD, Linux, macOS, and Android Termux targets.
- [x] After Phase 5 matrix evidence exists, run `soloclaw phase5 evidence-check --file phase5-evidence.merged.json --json` and update `docs/agent-rooms.md`, `docs/implementation-roadmap.md`, and this ledger.
```

- [ ] **Step 4: Commit final reconciliation**

```powershell
git add docs/implementation-roadmap.md docs/platform-support.md docs/agent-rooms.md docs/superpowers/plans/2026-06-21-soloclaw-project-plan-ledger.md
git commit -m "docs: reconcile real environment closure"
```

## Self-Review

- Spec coverage: Phase 1 live-provider release gate, Phase 4 macOS/Termux evidence, Phase 5 real multi-machine evidence, and Phase 6 admission boundaries all have tasks.
- Placeholder scan: commands use exact repository paths, exact target ids, and exact output files; generated room ids and control tokens stay inside ignored local evidence files and are not committed.
- Type consistency: Phase 5 target ids match the existing collector workflow; registered-agent pull target is consistently `linux-shell-agent` for this plan.

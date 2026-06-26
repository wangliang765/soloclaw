# Soloclaw CLI Modularization Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving the global help command registration into a focused command module while preserving existing help behavior.

**Architecture:** Keep `CommandRouter` from Slice 1 as the routing interface. Add `src/cli/commands/help.ts` as the first command module factory. `src/cli/index.ts` will still own the large help renderer for now, but it will pass that renderer into the help command module so later slices can move rendering or add additional command modules without expanding `main()`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing CLI entrypoint, existing help rendering, no new runtime dependencies.

## Global Constraints

- Preserve `soloclaw help`, `soloclaw --help`, and `soloclaw -h` output.
- Do not move `printHelp` or `printFullHelp` in this slice; only move command registration.
- Do not alter room, phase, model, memory, or tool behavior.
- Use TDD for the new command module test before production module code.

---

## File Structure

- Create: `src/cli/commands/help.ts`
  - Owns `createHelpCommand(renderHelp)` and aliases for `help`, `--help`, and `-h`.
- Test: `src/__tests__/cli-help-command.test.ts`
  - Verifies the module invokes the provided renderer with forwarded args and supports aliases.
- Modify: `src/cli/index.ts`
  - Imports `createHelpCommand` and builds the early router from that module.
- Modify: `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md`
  - Records Slice 2 as the current Workstream 1 slice after verification.

## Task 1: Help Command Module

**Files:**
- Create: `src/cli/commands/help.ts`
- Test: `src/__tests__/cli-help-command.test.ts`

**Interfaces:**
- Produces: `createHelpCommand(renderHelp): CommandModule<void>`.
- Consumes: existing `CommandModule` type and a `renderHelp(args: string[]) => void` function.

- [x] **Step 1: Write failing help command tests**

Create `src/__tests__/cli-help-command.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { createHelpCommand } from "../cli/commands/help.js";
import { CommandRouter } from "../cli/command-router.js";

test("createHelpCommand renders help with forwarded args", async () => {
  const calls: string[][] = [];
  const command = createHelpCommand((args) => {
    calls.push(args);
  });

  const result = await command.execute({ command: "help", args: ["--all"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(calls, [["--all"]]);
});

test("createHelpCommand exposes help aliases through CommandRouter", async () => {
  const calls: string[][] = [];
  const router = new CommandRouter([createHelpCommand((args) => calls.push(args))]);

  const result = await router.execute({ command: "-h", args: ["model"], context: undefined });

  assert.equal(result.matched, true);
  assert.deepEqual(calls, [["model"]]);
});
```

Run:

```powershell
npm.cmd run build
```

Expected before implementation: TypeScript build fails because `src/cli/commands/help.ts` does not exist.

- [x] **Step 2: Implement help command module**

Create `src/cli/commands/help.ts`:

```typescript
import type { CommandModule } from "../command-router.js";

export function createHelpCommand(renderHelp: (args: string[]) => void): CommandModule<void> {
  return {
    name: "help",
    aliases: ["--help", "-h"],
    summary: "Show Soloclaw help",
    execute: async ({ args }) => {
      renderHelp(args);
      return { matched: true };
    },
  };
}
```

- [x] **Step 3: Run focused module verification**

Run:

```powershell
npm.cmd run build
node --test dist\__tests__\cli-help-command.test.js
```

Expected: build exits 0 and the help command module tests pass.

## Task 2: Use Help Command Module In CLI Entry

**Files:**
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/workbench-help.test.ts`
- Test: `src/__tests__/cli-command-router.test.ts`

**Interfaces:**
- Consumes: `createHelpCommand(printHelp)`.
- Produces: no user-facing help behavior change.

- [x] **Step 1: Replace inline help module construction**

In `src/cli/index.ts`, import:

```typescript
import { createHelpCommand } from "./commands/help.js";
```

Remove `type CommandModule` from the command-router import if it is no longer needed.

Replace the inline module array in `buildEarlyCliCommandRouter()` with:

```typescript
function buildEarlyCliCommandRouter(): CommandRouter<CliCommandContext> {
  return new CommandRouter([createHelpCommand(printHelp)]);
}
```

- [x] **Step 2: Run focused integration verification**

Run:

```powershell
npm.cmd run build
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-help-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js help
node dist\cli\index.js --help
node dist\cli\index.js -h
```

Expected: tests pass and all help aliases print the existing help surface.

## Task 3: Close Slice 2

**Files:**
- Modify: `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md`
- Modify: `docs/superpowers/plans/2026-06-25-soloclaw-cli-modularization-slice-2.md`

- [x] **Step 1: Record Slice 2 status**

In the Workstream 1 status note, mention Slice 2:

```markdown
`docs/superpowers/plans/2026-06-25-soloclaw-cli-modularization-slice-2.md` then extracts help command registration into `src/cli/commands/help.ts`.
```

- [x] **Step 2: Run final slice verification**

Run:

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-help-command.test.js
node --test dist\__tests__\workbench-help.test.js
git diff --check
```

Expected: all commands exit 0.

## Final Acceptance Gate

Slice 2 is complete when:

- `src/cli/commands/help.ts` exists and registers the help command plus aliases.
- `src/cli/index.ts` builds the early router from `createHelpCommand(printHelp)`.
- Help output remains stable for `help`, `--help`, and `-h`.
- Build, check, focused router/help tests, and whitespace check pass.

## Self-Review

- Spec coverage: This slice moves the first command registration out of `src/cli/index.ts`, continuing Workstream 1 without touching risky command groups.
- Placeholder scan: The plan includes exact files, code snippets, commands, and expected outputs.
- Type consistency: `createHelpCommand` returns `CommandModule<void>` and is used by `CommandRouter<void>`.
- Phase boundary: No phase verifier, model provider, memory, room, remote runner, or cross-agent behavior is changed by this slice.

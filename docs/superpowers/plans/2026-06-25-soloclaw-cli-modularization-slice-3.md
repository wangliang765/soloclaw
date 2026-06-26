# Soloclaw CLI Modularization Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue Workstream 1 by moving `quickstart` command execution into a focused command module while preserving current text and JSON behavior.

**Architecture:** Keep `CommandRouter` as the command dispatch interface. Add `src/cli/commands/quickstart.ts` with dependency injection for workspace resolution, workspace option stripping, view building, text rendering, JSON output, error output, and exit-code setting. `src/cli/index.ts` continues to own the current `buildSoloclawQuickstart` and `printSoloclawQuickstart` implementations; this slice only removes the command branch from `main()`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing CLI entrypoint, no new runtime dependencies.

## Global Constraints

- Preserve `soloclaw quickstart [--workspace path] [--json]` behavior.
- Do not move quickstart view construction or rendering functions in this slice.
- Do not alter setup, model, phase, room, memory, tool, remote runner, or cross-agent behavior.
- Use TDD for the new command module before production module code.

---

## File Structure

- Create: `src/cli/commands/quickstart.ts`
  - Owns `createQuickstartCommand(deps)` and the `quickstart` command execution shell.
- Test: `src/__tests__/cli-quickstart-command.test.ts`
  - Verifies text output, JSON output, workspace option stripping, workspace resolution, and error exit-code behavior using injected dependencies.
- Modify: `src/cli/index.ts`
  - Imports `createQuickstartCommand`, includes it in the early router, and removes the direct `quickstart` branch from `main()`.
- Modify: `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md`
  - Records Slice 3 as current Workstream 1 progress after verification.

## Task 1: Quickstart Command Module

**Files:**
- Create: `src/cli/commands/quickstart.ts`
- Test: `src/__tests__/cli-quickstart-command.test.ts`

**Interfaces:**
- Produces: `createQuickstartCommand(deps): CommandModule<void>`.
- Consumes:
  - `cwd(): string`
  - `resolveWorkspace(cwd, args): Promise<string>`
  - `stripWorkspaceOption(args): string[]`
  - `buildQuickstart(cwd, workspace): Promise<unknown>`
  - `renderQuickstart(view): void`
  - `writeJson(value): void`
  - `writeError(message): void`
  - `setExitCode(code): void`

- [x] **Step 1: Write failing quickstart command tests**

Create `src/__tests__/cli-quickstart-command.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { createQuickstartCommand } from "../cli/commands/quickstart.js";

test("createQuickstartCommand renders text view with resolved workspace", async () => {
  const events: string[] = [];
  const command = createQuickstartCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async (cwd, args) => {
      events.push(`resolve:${cwd}:${args.join(",")}`);
      return "C:/repo/project";
    },
    stripWorkspaceOption: (args) => args.filter((arg) => arg !== "--workspace" && arg !== "project"),
    buildQuickstart: async (cwd, workspace) => ({ cwd, workspace, kind: "view" }),
    renderQuickstart: (view) => events.push(`render:${JSON.stringify(view)}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "quickstart", args: ["--workspace", "project"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "resolve:C:/repo:--workspace,project",
    'render:{"cwd":"C:/repo","workspace":"C:/repo/project","kind":"view"}',
  ]);
});

test("createQuickstartCommand writes json when --json survives workspace stripping", async () => {
  const events: string[] = [];
  const command = createQuickstartCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => "C:/repo",
    stripWorkspaceOption: (args) => args,
    buildQuickstart: async () => ({ ready: true }),
    renderQuickstart: () => events.push("render"),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "quickstart", args: ["--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ['json:{"ready":true}']);
});

test("createQuickstartCommand reports errors and sets exit code", async () => {
  const events: string[] = [];
  const command = createQuickstartCommand({
    cwd: () => "C:/repo",
    resolveWorkspace: async () => {
      throw new Error("workspace missing");
    },
    stripWorkspaceOption: (args) => args,
    buildQuickstart: async () => ({ ready: true }),
    renderQuickstart: () => events.push("render"),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await command.execute({ command: "quickstart", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:workspace missing", "exit:1"]);
});
```

Run:

```powershell
npm.cmd run build
```

Expected before implementation: TypeScript build fails because `src/cli/commands/quickstart.ts` does not exist.

- [x] **Step 2: Implement quickstart command module**

Create `src/cli/commands/quickstart.ts`:

```typescript
import type { CommandModule } from "../command-router.js";

export type QuickstartCommandDeps<TView> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  stripWorkspaceOption(args: string[]): string[];
  buildQuickstart(cwd: string, workspace: string): Promise<TView>;
  renderQuickstart(view: TView): void;
  writeJson(value: TView): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createQuickstartCommand<TView>(deps: QuickstartCommandDeps<TView>): CommandModule<void> {
  return {
    name: "quickstart",
    summary: "Print first-run setup steps",
    execute: async ({ args }) => {
      try {
        const cwd = deps.cwd();
        const workspace = await deps.resolveWorkspace(cwd, args);
        const strippedArgs = deps.stripWorkspaceOption(args);
        const view = await deps.buildQuickstart(cwd, workspace);
        if (strippedArgs.includes("--json")) {
          deps.writeJson(view);
        } else {
          deps.renderQuickstart(view);
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}
```

- [x] **Step 3: Run focused module verification**

Run:

```powershell
npm.cmd run build
node --test dist\__tests__\cli-quickstart-command.test.js
```

Expected: build exits 0 and quickstart command tests pass.

## Task 2: Route Quickstart Through The Early Router

**Files:**
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/workbench-help.test.ts`
- Test: `src/__tests__/cli-quickstart-command.test.ts`

**Interfaces:**
- Consumes: `createQuickstartCommand`.
- Produces: no user-facing quickstart behavior change.

- [x] **Step 1: Add quickstart command to `buildEarlyCliCommandRouter()`**

In `src/cli/index.ts`, import:

```typescript
import { createQuickstartCommand } from "./commands/quickstart.js";
```

Update `buildEarlyCliCommandRouter()`:

```typescript
function buildEarlyCliCommandRouter(): CommandRouter<CliCommandContext> {
  return new CommandRouter([
    createHelpCommand(printHelp),
    createQuickstartCommand({
      cwd: () => process.cwd(),
      resolveWorkspace: resolveInitialWorkspace,
      stripWorkspaceOption,
      buildQuickstart: buildSoloclawQuickstart,
      renderQuickstart: printSoloclawQuickstart,
      writeJson: (value) => console.log(JSON.stringify(value, null, 2)),
      writeError: (message) => console.error(message),
      setExitCode: (code) => {
        process.exitCode = code;
      },
    }),
  ]);
}
```

Remove the direct `if (command === "quickstart")` branch from `main()`.

- [x] **Step 2: Add CLI smoke for quickstart aliases**

Add or extend a focused test file with:

```typescript
test("quickstart command still renders first-run setup text", async () => {
  const result = await runCli(["quickstart"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /quickstart/i);
  assert.match(result.stdout, /model/i);
});
```

If an existing CLI helper already covers process spawning, put this in `src/__tests__/workbench-help.test.ts` for this slice.

- [x] **Step 3: Run focused integration verification**

Run:

```powershell
npm.cmd run build
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-help-command.test.js
node --test dist\__tests__\cli-quickstart-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js quickstart
node dist\cli\index.js quickstart --json
```

Expected: tests pass; `quickstart` renders text; `quickstart --json` prints JSON.

## Task 3: Close Slice 3

**Files:**
- Modify: `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md`
- Modify: `docs/superpowers/plans/2026-06-25-soloclaw-cli-modularization-slice-3.md`

- [x] **Step 1: Record Slice 3 status**

In the Workstream 1 status note, mention Slice 3:

```markdown
`docs/superpowers/plans/2026-06-25-soloclaw-cli-modularization-slice-3.md` moves `quickstart` execution into `src/cli/commands/quickstart.ts`.
```

- [x] **Step 2: Run final slice verification**

Run:

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-help-command.test.js
node --test dist\__tests__\cli-quickstart-command.test.js
node --test dist\__tests__\workbench-help.test.js
git diff --check
```

Expected: all commands exit 0.

## Final Acceptance Gate

Slice 3 is complete when:

- `src/cli/commands/quickstart.ts` exists and owns `quickstart` command execution.
- `src/cli/index.ts` routes `quickstart` through `CommandRouter`.
- `quickstart` and `quickstart --json` still behave as before.
- Build, check, focused router/help/quickstart tests, and whitespace check pass.

## Closeout Evidence

Evidence recorded on 2026-06-26:

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\cli-help-command.test.js
node --test dist\__tests__\cli-quickstart-command.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js quickstart
node dist\cli\index.js quickstart --json
git diff --check
```

## Self-Review

- Spec coverage: This slice migrates one more low-risk command branch out of `main()` while keeping view construction and rendering stable.
- Placeholder scan: The plan includes exact files, code snippets, commands, and expected outputs.
- Type consistency: `createQuickstartCommand` returns `CommandModule<void>` and receives injected dependencies with stable names.
- Phase boundary: No phase verifier, model provider, memory, room, remote runner, or cross-agent behavior is changed by this slice.

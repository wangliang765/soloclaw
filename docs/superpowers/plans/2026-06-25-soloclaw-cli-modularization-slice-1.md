# Soloclaw CLI Modularization Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start Workstream 1 by introducing a tested CLI command router and routing the global help command through it without changing existing command behavior.

**Architecture:** Add a small `CommandRouter` module under `src/cli/` with a stable `CommandModule` interface. The first production integration is deliberately narrow: `src/cli/index.ts` keeps existing command implementations, but global `help`, `--help`, and `-h` dispatch through the router. Later slices can move model, config, session, tools, workbench, and phase commands into separate modules behind the same interface.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing CLI entrypoint, existing help rendering, no new runtime dependencies.

## Global Constraints

- Preserve existing CLI command names, aliases, help output, JSON behavior, and exit-code behavior.
- Do not refactor phase gates in this slice; Phase 1-5 evidence commands remain in `src/cli/index.ts`.
- Keep the product maturation overlay linked from `docs/implementation-roadmap.md`.
- Keep cross-agent invariants intact: no room, remote runner, routed inbox, or control-plane behavior changes in this slice.
- Use TDD for production code: write the router test first, watch it fail, then implement the router.

---

## File Structure

- Create: `src/cli/command-router.ts`
  - Owns `CommandModule`, `CommandExecutionInput`, `CommandExecutionResult`, and `CommandRouter`.
- Test: `src/__tests__/cli-command-router.test.ts`
  - Verifies aliases, ordered module matching, argument forwarding, unknown command behavior, and duplicate command rejection.
- Modify: `src/cli/index.ts`
  - Imports `CommandRouter` and routes only global help through it in this slice.
- Modify: `docs/implementation-roadmap.md`
  - Records the product maturation overlay. This is already completed before starting router implementation.
- Future slice: `src/cli/commands/*.ts`
  - Not created in this slice except by a later detailed plan.

## Task 1: Link Product Maturation Overlay Into Roadmap

**Files:**
- Modify: `docs/implementation-roadmap.md`

**Interfaces:**
- Consumes: `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md`.
- Produces: a roadmap paragraph that identifies the product maturation plan as a cross-phase overlay, not a replacement for Phase 1-6.

- [x] **Step 1: Add roadmap overlay paragraph**

Add this paragraph after the Phase 5.7 persistent memory hardening paragraph:

```markdown
Product maturation overlay: `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md` is the cross-phase plan for turning the local and room-agent MVP into a mature AI coding product. It does not replace the Phase 1-6 evidence model; instead it maps product workstreams onto the phase roadmap: CLI modularization, unified product configuration, provider/model catalog, TUI workbench, tool registry, session UX, permission rules, cross-platform agent interop, subagent task tooling, local API/SDK/event streams, packaging, and product onboarding. Its cross-agent invariants are mandatory for follow-up plans: rooms stay hub-and-control-plane first, routed inbox messages are the execution trigger, remote work preserves signed ack/heartbeat/revocation/stale recovery, and mixed-agent product claims require token-safe Phase 5.5 evidence.
```

- [x] **Step 2: Verify the roadmap reference exists**

Run:

```powershell
rg -n "Product maturation overlay|ai-coding-product-maturation" docs\implementation-roadmap.md
```

Expected: one match for the overlay paragraph.

## Task 2: Command Router Foundation

**Files:**
- Create: `src/cli/command-router.ts`
- Test: `src/__tests__/cli-command-router.test.ts`

**Interfaces:**
- Produces:
  - `type CommandExecutionInput<TContext>`
  - `type CommandExecutionResult`
  - `type CommandModule<TContext>`
  - `class CommandRouter<TContext>`
- Consumes: command name, argument list, context object, and registered modules.

- [x] **Step 1: Write the failing router tests**

Create `src/__tests__/cli-command-router.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { CommandRouter, type CommandModule } from "../cli/command-router.js";

type TestContext = {
  events: string[];
};

test("CommandRouter dispatches by command name and forwards args and context", async () => {
  const module: CommandModule<TestContext> = {
    name: "help",
    aliases: ["--help", "-h"],
    summary: "Show help",
    execute: async ({ args, context }) => {
      context.events.push(`help:${args.join(",")}`);
      return { matched: true, exitCode: 0 };
    },
  };
  const context: TestContext = { events: [] };
  const router = new CommandRouter([module]);

  const result = await router.execute({ command: "help", args: ["model"], context });

  assert.deepEqual(result, { matched: true, exitCode: 0 });
  assert.deepEqual(context.events, ["help:model"]);
});

test("CommandRouter dispatches aliases to the same module", async () => {
  const context: TestContext = { events: [] };
  const router = new CommandRouter<TestContext>([
    {
      name: "help",
      aliases: ["--help", "-h"],
      summary: "Show help",
      execute: async ({ command, context }) => {
        context.events.push(command);
        return { matched: true };
      },
    },
  ]);

  const result = await router.execute({ command: "--help", args: [], context });

  assert.equal(result.matched, true);
  assert.deepEqual(context.events, ["--help"]);
});

test("CommandRouter returns unmatched result for unknown commands", async () => {
  const router = new CommandRouter<TestContext>([]);

  const result = await router.execute({ command: "missing", args: ["x"], context: { events: [] } });

  assert.deepEqual(result, { matched: false });
});

test("CommandRouter rejects duplicate command names and aliases", () => {
  assert.throws(
    () => new CommandRouter<TestContext>([
      {
        name: "help",
        aliases: ["h"],
        summary: "Show help",
        execute: async () => ({ matched: true }),
      },
      {
        name: "model",
        aliases: ["h"],
        summary: "Model commands",
        execute: async () => ({ matched: true }),
      },
    ]),
    /Duplicate CLI command registration: h/,
  );
});
```

Run:

```powershell
npm.cmd run build
```

Expected before implementation: TypeScript build fails because `src/cli/command-router.ts` does not exist.

- [x] **Step 2: Implement the command router**

Create `src/cli/command-router.ts`:

```typescript
export type CommandExecutionInput<TContext> = {
  command: string;
  args: string[];
  context: TContext;
};

export type CommandExecutionResult = {
  matched: boolean;
  exitCode?: number;
};

export type CommandModule<TContext> = {
  name: string;
  aliases?: string[];
  summary: string;
  execute(input: CommandExecutionInput<TContext>): Promise<CommandExecutionResult>;
};

export class CommandRouter<TContext> {
  private readonly modulesByCommand = new Map<string, CommandModule<TContext>>();

  constructor(modules: CommandModule<TContext>[]) {
    for (const module of modules) {
      this.register(module.name, module);
      for (const alias of module.aliases ?? []) {
        this.register(alias, module);
      }
    }
  }

  async execute(input: CommandExecutionInput<TContext>): Promise<CommandExecutionResult> {
    const module = this.modulesByCommand.get(input.command);
    if (!module) {
      return { matched: false };
    }
    return module.execute(input);
  }

  listModules(): CommandModule<TContext>[] {
    return [...new Set(this.modulesByCommand.values())];
  }

  private register(command: string, module: CommandModule<TContext>): void {
    if (this.modulesByCommand.has(command)) {
      throw new Error(`Duplicate CLI command registration: ${command}`);
    }
    this.modulesByCommand.set(command, module);
  }
}
```

- [x] **Step 3: Run focused router verification**

Run:

```powershell
npm.cmd run build
node --test dist\__tests__\cli-command-router.test.js
```

Expected: build exits 0 and the router tests pass.

## Task 3: Route Global Help Through The Router

**Files:**
- Modify: `src/cli/index.ts`
- Test: `src/__tests__/workbench-help.test.ts`

**Interfaces:**
- Consumes: `CommandRouter<void>` and existing `printHelp(rest)`.
- Produces: no user-facing behavior change; `help`, `--help`, and `-h` still print existing help.

- [x] **Step 1: Add a behavior test for help aliases**

Extend `src/__tests__/workbench-help.test.ts` with:

```typescript
test("global help aliases render the same workbench help surface", async () => {
  for (const alias of ["--help", "-h"]) {
    const result = await runCli([alias]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /agent commands list/);
    assert.match(result.stdout, /agent workbench verify/);
  }
});
```

Run:

```powershell
npm.cmd run build
node --test dist\__tests__\workbench-help.test.js
```

Expected before implementation: this may already pass through existing direct `if` handling. If it passes, keep the test as a regression test before the refactor; this is an existing-behavior lock rather than a new-behavior red test.

- [x] **Step 2: Wire global help through `CommandRouter`**

In `src/cli/index.ts`, import:

```typescript
import { CommandRouter, type CommandModule } from "./command-router.js";
```

Add near the top-level functions:

```typescript
type CliCommandContext = void;

function buildEarlyCliCommandRouter(): CommandRouter<CliCommandContext> {
  const modules: CommandModule<CliCommandContext>[] = [
    {
      name: "help",
      aliases: ["--help", "-h"],
      summary: "Show Soloclaw help",
      execute: async ({ args }) => {
        printHelp(args);
        return { matched: true };
      },
    },
  ];
  return new CommandRouter(modules);
}
```

Replace the direct help block in `main()`:

```typescript
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp(rest);
    return;
  }
```

with:

```typescript
  const earlyCommandResult = await buildEarlyCliCommandRouter().execute({ command, args: rest, context: undefined });
  if (earlyCommandResult.matched) {
    if (typeof earlyCommandResult.exitCode === "number") {
      process.exitCode = earlyCommandResult.exitCode;
    }
    return;
  }
```

- [x] **Step 3: Run focused CLI help verification**

Run:

```powershell
npm.cmd run build
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\workbench-help.test.js
node dist\cli\index.js help
node dist\cli\index.js --help
```

Expected: build exits 0, both tests pass, and both help commands print the existing help surface.

## Task 4: Close Slice 1

**Files:**
- Modify: `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md`
- Modify: `docs/superpowers/plans/2026-06-25-soloclaw-cli-modularization-slice-1.md`

**Interfaces:**
- Consumes: router test and help verification output.
- Produces: a clear status note that Workstream 1 is started, not complete.

- [x] **Step 1: Record status in the product maturation plan**

Under Workstream 1 in `docs/superpowers/plans/2026-06-25-soloclaw-ai-coding-product-maturation.md`, add a status note:

```markdown
**Current slice:** `docs/superpowers/plans/2026-06-25-soloclaw-cli-modularization-slice-1.md` starts this workstream by adding a tested `CommandRouter` and routing global help through it. The large command groups remain in `src/cli/index.ts` until later slices migrate them one at a time.
```

- [x] **Step 2: Run final slice verification**

Run:

```powershell
npm.cmd run build
npm.cmd run check
node --test dist\__tests__\cli-command-router.test.js
node --test dist\__tests__\workbench-help.test.js
git diff --check
```

Expected: all commands exit 0.

## Final Acceptance Gate

Slice 1 is complete when:

- `docs/implementation-roadmap.md` links the product maturation overlay.
- `src/cli/command-router.ts` exists and is covered by `src/__tests__/cli-command-router.test.ts`.
- `src/cli/index.ts` uses `CommandRouter` for global help dispatch.
- `help`, `--help`, and `-h` still render the existing help surface.
- `npm.cmd run build`, `npm.cmd run check`, focused router/help tests, and `git diff --check` pass.

## Self-Review

- Spec coverage: This slice covers the roadmap hook and the first Workstream 1 implementation step: a tested command-router interface plus a low-risk help integration.
- Placeholder scan: The plan includes exact files, code snippets, commands, and expected outputs.
- Type consistency: The public names `CommandRouter`, `CommandModule`, `CommandExecutionInput`, and `CommandExecutionResult` match across tests, implementation, and integration.
- Phase boundary: No phase verifier, room protocol, remote runner, model provider, tool policy, memory, or cross-agent behavior is changed by this slice.

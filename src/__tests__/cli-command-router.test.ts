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

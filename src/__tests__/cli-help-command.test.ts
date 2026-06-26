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

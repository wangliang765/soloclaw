import assert from "node:assert/strict";
import test from "node:test";
import { createPhaseCommands } from "../cli/commands/phases.js";

test("createPhaseCommands runs phase1 json verification", async () => {
  const events: string[] = [];
  const [phase1] = createPhaseCommands({
    cwd: () => "C:/repo",
    verifyPhaseOneReadiness: async (cwd) => {
      events.push(`verify:${cwd}`);
      return { ok: true };
    },
    renderPhaseOneReadiness: (result) => events.push(`render:${JSON.stringify(result)}`),
    handlePhaseTwoCommand: async () => {
      events.push("phase2");
    },
    handlePhaseThreeCommand: async () => {
      events.push("phase3");
    },
    handlePhaseFourCommand: async () => {
      events.push("phase4");
    },
    handlePhaseFiveCommand: async () => {
      events.push("phase5");
    },
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await phase1.execute({ command: "phase1", args: ["verify", "--json"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["verify:C:/repo", 'json:{"ok":true}']);
});

test("createPhaseCommands delegates phase handlers with cwd", async () => {
  const events: string[] = [];
  const commands = createPhaseCommands({
    cwd: () => "C:/repo",
    verifyPhaseOneReadiness: async () => ({ ok: true }),
    renderPhaseOneReadiness: () => events.push("render"),
    handlePhaseTwoCommand: async (args, cwd) => {
      events.push(`phase2:${cwd}:${args.join(",")}`);
    },
    handlePhaseThreeCommand: async (args, cwd) => {
      events.push(`phase3:${cwd}:${args.join(",")}`);
    },
    handlePhaseFourCommand: async (args, cwd) => {
      events.push(`phase4:${cwd}:${args.join(",")}`);
    },
    handlePhaseFiveCommand: async (args, cwd) => {
      events.push(`phase5:${cwd}:${args.join(",")}`);
    },
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  await commands[1].execute({ command: "phase2", args: ["status", "--json"], context: undefined });
  await commands[2].execute({ command: "phase3", args: ["gate"], context: undefined });
  await commands[3].execute({ command: "phase4", args: ["verify"], context: undefined });
  await commands[4].execute({ command: "phase5", args: ["checklist"], context: undefined });

  assert.deepEqual(events, [
    "phase2:C:/repo:status,--json",
    "phase3:C:/repo:gate",
    "phase4:C:/repo:verify",
    "phase5:C:/repo:checklist",
  ]);
});

test("createPhaseCommands reports phase1 usage", async () => {
  const events: string[] = [];
  const [phase1] = createPhaseCommands({
    cwd: () => "C:/repo",
    verifyPhaseOneReadiness: async () => ({ ok: true }),
    renderPhaseOneReadiness: () => events.push("render"),
    handlePhaseTwoCommand: async () => {
      events.push("phase2");
    },
    handlePhaseThreeCommand: async () => {
      events.push("phase3");
    },
    handlePhaseFourCommand: async () => {
      events.push("phase4");
    },
    handlePhaseFiveCommand: async () => {
      events.push("phase5");
    },
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  });

  const result = await phase1.execute({ command: "phase1", args: ["wat"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Usage: agent phase1 verify [--json]", "exit:1"]);
});
